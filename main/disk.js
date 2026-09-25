// Reading the open folder, and ~/kit beside it, for the window. Nothing in
// them is ever run. The one write is saving a Markdown file edited by hand.
// root is always the open folder's absolute path.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Lexer } = require('marked');
const { checkMap, locate } = require('./map');

const README_NAME = /^readme(\.(md|markdown|txt))?$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAP_NAME = 'map.json';
// The window cannot be sent anything nested deeper than 1000 levels. Markdown
// whose tokens nest deeper than this is sent as plain text only.
const MAX_DEPTH = 800;

// My kit: what I and the agent bring to the work. It is kept in reach from
// whichever folder is open, and the window names its paths ~/kit/...
const KIT_REL = '~/kit';
const kitPath = () => path.join(os.homedir(), 'kit');
const inKit = (rel) => rel === KIT_REL || !!rel?.startsWith(KIT_REL + '/');

// Whether there is a kit, as a real folder; null when there is none.
async function kitFolder() {
  const kit = await locate(kitPath(), '', '.');
  return !kit.problem && kit.dir ? kit.real : null;
}

// A path from the window as a real path inside the open folder, or inside
// the kit for a ~/kit/... path, or throw.
async function inside(root, rel) {
  const kit = inKit(rel);
  const found = kit ? await locate(kitPath(), '', rel.slice(KIT_REL.length + 1) || '.') : await locate(root, '', rel || '.');
  if (found.problem === 'outside') throw new Error(kit ? 'Leads outside the kit' : 'Leads outside the open folder');
  if (found.problem) throw new Error('Not found');
  return found;
}

async function isDirectory(abs, dirent) {
  if (dirent.isDirectory()) return true;
  if (!dirent.isSymbolicLink()) return false;
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

// rel: a folder's path inside the open folder, as the window uses it.
async function hasMap(root, rel) {
  const found = await locate(root, rel, MAP_NAME);
  return !found.problem && !found.dir;
}

// The first bytes of a file, as text.
async function head(real, bytes = 8192) {
  const handle = await fs.open(real, 'r');
  try {
    const { buffer, bytesRead } = await handle.read(Buffer.alloc(bytes), 0, bytes, 0);
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally {
    await handle.close();
  }
}

// The folder's README: its name, and its first "# " heading, else its first
// non-empty line. Like hasMap, it reads nothing outside the open folder.
async function readme(root, rel) {
  const folder = await locate(root, rel, '.');
  if (folder.problem || !folder.dir) return null;
  let entries;
  try {
    entries = await fs.readdir(folder.real, { withFileTypes: true });
  } catch {
    return null;
  }
  const entry = entries.find((e) => !e.isDirectory() && README_NAME.test(e.name));
  if (!entry) return null;
  const name = entry.name;
  const file = await locate(root, rel, name);
  if (file.problem || file.dir) return null;

  let text;
  try {
    text = await head(file.real);
  } catch {
    return { name, title: null };
  }
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const heading = lines.find((l) => /^#\s+\S/.test(l));
  if (heading) return { name, title: heading.replace(/^#\s+/, '').replace(/\s+#*\s*$/, '') };
  return { name, title: lines.find((l) => l.length > 0) || null };
}

// The open folder itself: where it is, and whether it has a map, README or kit.
async function folderInfo(root) {
  const found = await readme(root, '');
  return { root, name: path.basename(root) || root, map: await hasMap(root, ''), readme: found?.name ?? null, kit: !!(await kitFolder()) };
}

// One level of the tree. Folders carry their README title, except in the kit
// and in node_modules.
// Finder's own record of how a folder looks, which it drops in every folder
// it opens. It is never mine, so the tree and the changes leave it out.
const isFinderFile = (p) => path.basename(p) === '.DS_Store';

async function listDir(root, rel) {
  const { real } = await inside(root, rel);
  const entries = await fs.readdir(real, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    if (isFinderFile(e.name)) continue;
    const abs = path.join(real, e.name);
    const dir = await isDirectory(abs, e);
    const item = { name: e.name, path: path.join(rel, e.name), dir };
    item.map = dir && !inKit(rel) && (await hasMap(root, item.path));
    if (dir && !inKit(rel) && !/(^|\/)node_modules(\/|$)/.test(item.path)) item.title = (await readme(root, item.path))?.title ?? null;
    items.push(item);
  }
  items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return items;
}

// Whether value nests deeper than max objects and lists.
function tooDeep(value, max) {
  if (max < 0) return true;
  if (!value || typeof value !== 'object') return false;
  for (const v of Array.isArray(value) ? value : Object.values(value)) if (tooDeep(v, max - 1)) return true;
  return false;
}

async function readFile(root, rel) {
  const { real, dir } = await inside(root, rel);
  if (dir) {
    if (inKit(rel)) return { path: rel, folder: true };
    return { path: rel, folder: true, map: await hasMap(root, rel), readme: (await readme(root, rel))?.name ?? null };
  }
  const info = await fs.stat(real);
  // A file over 2 MB, like a log, shows its first 2 MB, up to the last whole
  // line, to read only: it is never drawn as Markdown or a map, or edited.
  if (info.size > MAX_FILE_BYTES) {
    const text = await head(real, MAX_FILE_BYTES);
    if (text.includes('\0')) return { path: rel, size: info.size, text: null, reason: 'Binary file, not shown.' };
    const cut = text.lastIndexOf('\n');
    return { path: rel, size: info.size, text: cut > 0 ? text.slice(0, cut + 1) : text, partial: true, tokens: null, map: null, markdown: false, note: null };
  }
  const buffer = await fs.readFile(real);
  if (buffer.includes(0)) {
    return { path: rel, size: info.size, text: null, reason: 'Binary file, not shown.' };
  }
  const text = buffer.toString('utf8');
  // Markdown goes to the window as tokens, never as HTML. The window builds
  // the page from them and drops any HTML tokens.
  const markdown = /\.md$/i.test(rel);
  let tokens = markdown ? Lexer.lex(text) : null;
  let note = null;
  if (tokens && tooDeep(tokens, MAX_DEPTH)) {
    tokens = null;
    note = 'Nested too deeply to show rendered, so it is shown as plain text.';
  }
  // A map.json goes to the window already checked against the disk.
  const map = path.basename(rel) === MAP_NAME && !inKit(rel) ? await checkMap(root, rel, text) : null;
  return { path: rel, size: info.size, text, tokens, map, markdown, note };
}

// The one write: a Markdown file edited by hand, back to that same file. from
// is the text the edit started from; if the file no longer holds it, say so
// rather than overwrite what changed, like an agent's edit.
async function saveMarkdown(root, rel, text, from) {
  if (!/\.md$/i.test(rel)) throw new Error('Only Markdown files are saved');
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('Larger than 2 MB, not saved');
  const { real, dir } = await inside(root, rel);
  if (dir) throw new Error('Not a file');
  if ((await fs.readFile(real, 'utf8')) !== from) {
    throw new Error('Changed on disk since you started editing, not saved.');
  }
  await fs.writeFile(real, text);
  return readFile(root, rel);
}

// Every file and folder in the open folder, and in the kit, by path, for
// going to one by name. Only names are read. .git and node_modules are left
// out and symlinks are not followed, so nothing leads outside. Walking stops
// at MAX_LISTED, and says so.
const MAX_LISTED = 20000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

async function walkNames(top, prefix, out) {
  const folders = [''];
  while (folders.length && out.length < MAX_LISTED) {
    const rel = folders.shift();
    let entries;
    try {
      entries = await fs.readdir(path.join(top, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      if (out.length >= MAX_LISTED) break;
      if (isFinderFile(e.name)) continue;
      const p = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        folders.push(p);
        out.push({ path: prefix + p, dir: true });
      } else if (e.isFile() || e.isSymbolicLink()) {
        out.push({ path: prefix + p, dir: false });
      }
    }
  }
}

// A path as a program in the terminal printed it, like src/app.js,
// ./src/app.js, ~/kit/notes.md or /Users/me/project/src/app.js, as the path
// the window uses: relative to the open folder, or ~/kit/... . A relative
// path is taken from base, the folder the terminal that printed it was in,
// which may not be the open folder. Only a path that leads to something
// inside the open folder or the kit, after following symlinks, is returned;
// anything else throws, and nothing is guessed.
function refToRel(root, home, p, base = root) {
  if (typeof p !== 'string' || !p || p.length > 4096 || /[\x00-\x1f\x7f]/.test(p)) return null;
  const kit = path.join(home, 'kit');
  const relative = !(p === '~' || p.startsWith('~/') || path.isAbsolute(p));
  if (relative && (typeof base !== 'string' || !path.isAbsolute(base))) return null;
  const abs = p === '~' || p.startsWith('~/') ? path.join(home, p.slice(2)) : path.resolve(base, p);
  const under = (top) => abs === top || abs.startsWith(top + path.sep);
  if (under(root)) return path.relative(root, abs).split(path.sep).join('/');
  if (under(kit)) return (KIT_REL + '/' + path.relative(kit, abs).split(path.sep).join('/')).replace(/\/$/, '');
  return null;
}

async function where(root, p, base = root) {
  let rel = refToRel(root, os.homedir(), p, base);
  // An absolute path may reach the open folder another way, like /tmp for
  // /private/tmp; it counts only when its real path is inside.
  if (rel == null && typeof p === 'string' && path.isAbsolute(p)) {
    try {
      rel = refToRel(root, os.homedir(), await fs.realpath(p));
    } catch {}
  }
  if (rel == null) throw new Error('Not in the open folder');
  const found = await inside(root, rel);
  return { rel, dir: found.dir };
}

async function listFiles(root, { withKit = true } = {}) {
  const out = [];
  const { real } = await inside(root, '');
  await walkNames(real, '', out);
  const kit = withKit && (await kitFolder());
  if (kit && out.length < MAX_LISTED) await walkNames(kit, KIT_REL + '/', out);
  return { root, files: out, more: out.length >= MAX_LISTED };
}

module.exports = { KIT_REL, MAP_NAME, MAX_FILE_BYTES, inKit, isFinderFile, kitFolder, folderInfo, listDir, readFile, saveMarkdown, listFiles, refToRel, where };
