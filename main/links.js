// Links that point at nothing: in the open folder's Markdown files, a link to
// a file that is not there, a path like ~/notes or /Users/me/notes that is not
// on this computer (outside the agents' own folders), and a file a CLAUDE.md
// brings in with @ that is not there.
// Projects get renamed and moved, and these go stale without a sound.
//
// It reads Markdown files in the open folder, and outside it only asks
// whether a named path exists; it never reads or shows what is there.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Lexer } = require('marked');
const { importsIn } = require('./setup');

const MAX_FILES = 2000;
const MAX_BYTES = 1024 * 1024;
const MAX_FOUND = 200;
const SKIP = new Set(['.git', 'node_modules']);
const MARKDOWN = /\.(md|markdown)$/i;

// A path written out in text: ~/something or /Users/someone/something. One
// with <, *, {, $ or … in it is a pattern or a placeholder, not a path.
const WRITTEN_PATH = /(?:^|[\s`'"(=:])((?:~|\/Users\/[^/\s`'"()<>]+)\/[^\s`'"()\]]*)/g;
const PLACEHOLDER = /[<>*{}$…]|\.\.\.$/;

// What a Markdown file points to: links, as written, and paths written out
// anywhere in it, code included.
function pointsIn(text) {
  const links = [];
  const walk = (tokens) => {
    for (const t of tokens || []) {
      if ((t.type === 'link' || t.type === 'image') && t.href) links.push(t.href);
      walk(t.tokens);
      walk(t.items);
      for (const row of t.rows || []) for (const cell of row) walk(cell.tokens);
      for (const cell of t.header || []) walk(cell.tokens);
    }
  };
  try {
    const tokens = Lexer.lex(text);
    walk(tokens);
    for (const def of Object.values(tokens.links || {})) if (def?.href) links.push(def.href);
  } catch {}
  // A link's own address is a link, not a written path.
  const linked = new Set(links.map((l) => l.replace(/^<|>$/g, '')));
  const written = new Set();
  for (const m of text.matchAll(WRITTEN_PATH)) {
    const p = m[1].replace(/[.,;:!?]+$/, '').replace(/(.)\/+$/, '$1');
    if (p.length > 2 && !PLACEHOLDER.test(p) && !linked.has(p)) written.add(p);
  }
  return { links: [...new Set(links)], written: [...written] };
}

// A link as a path on the disk, or null when it is a web address, a section of
// the same page or something else that is not a file.
function linkPath(href, file, root, home) {
  let h = href.trim().replace(/^<|>$/g, '');
  if (!h || h.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//')) return null;
  h = h.replace(/[?#].*$/, '');
  try {
    h = decodeURI(h);
  } catch {}
  if (!h) return null;
  if (h.startsWith('~/')) return [path.join(home, h.slice(2))];
  // A link starting with / may mean the top of the disk or the top of the
  // project, as it does on GitHub; either will do.
  if (h.startsWith('/')) return [h, path.join(root, h)];
  return [path.resolve(path.dirname(file), h)];
}

async function exists(abs) {
  try {
    await fs.stat(abs);
    return true;
  } catch {
    return false;
  }
}

// The Markdown files in the open folder, without .git and node_modules, not
// following symlinks, up to MAX_FILES.
async function markdownFiles(root) {
  const out = [];
  const folders = [root];
  while (folders.length && out.length < MAX_FILES) {
    const dir = folders.shift();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory() && !SKIP.has(e.name)) folders.push(abs);
      else if (e.isFile() && MARKDOWN.test(e.name) && out.length < MAX_FILES) out.push(abs);
    }
  }
  return out;
}

// What was read, by file, so a file that did not change is not read again.
const cache = new Map();

// The Markdown files found the last time the open folder was walked. Walking
// a big folder like ~ takes a second, so the list is kept until the window
// says the folder changed.
let walked = { root: null, files: [] };

async function pointsInFile(abs) {
  let info;
  try {
    info = await fs.stat(abs);
  } catch {
    return null;
  }
  if (info.size > MAX_BYTES) return null;
  const had = cache.get(abs);
  if (had && had.mtime === info.mtimeMs && had.size === info.size) return had.points;
  let points = null;
  try {
    const text = await fs.readFile(abs, 'utf8');
    points = { ...pointsIn(text), imports: /^CLAUDE(\.local)?\.md$/.test(path.basename(abs)) ? importsIn(text, abs, os.homedir()) : [] };
  } catch {}
  cache.set(abs, { mtime: info.mtimeMs, size: info.size, points });
  return points;
}

// Every link, written path and @ import in the open folder's Markdown that
// points at nothing: { file, target, kind }, file relative to the open folder,
// kind 'link', 'path' or 'import'. With walk false, the Markdown files found
// last time are looked at again without walking the folder.
//
// A path written out under the agents' own folders, like ~/.claude or
// ~/.codex, is left out: files there are optional, so a note that names one
// usually describes it rather than points at it, and the agent setup page
// shows what is really there. Links and @ imports into them still count.
async function brokenLinks(root, { home = os.homedir(), env = process.env, walk = true } = {}) {
  const broken = [];
  const agentDirs = [
    env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude'),
    env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex'),
    path.join(home, '.agents'),
  ];
  const agents = (abs) => agentDirs.some((d) => abs === d || abs.startsWith(d + path.sep));
  if (walk || walked.root !== root) walked = { root, files: await markdownFiles(root) };
  const files = walked.files;
  const known = new Map();
  const there = async (abs) => {
    if (!known.has(abs)) known.set(abs, exists(abs));
    return known.get(abs);
  };
  for (const abs of files) {
    if (broken.length >= MAX_FOUND) break;
    const points = await pointsInFile(abs);
    if (!points) continue;
    const file = path.relative(root, abs);
    for (const href of points.links) {
      const tries = linkPath(href, abs, root, home);
      if (!tries) continue;
      let ok = false;
      for (const t of tries) if (!ok && (await there(t))) ok = true;
      if (!ok) broken.push({ file, target: href, kind: 'link' });
    }
    for (const p of points.written) {
      const abs = p.startsWith('~/') ? path.join(home, p.slice(2)) : p;
      if (!agents(abs) && !(await there(abs))) broken.push({ file, target: p, kind: 'path' });
    }
    for (const imp of points.imports) {
      if (!(await there(imp))) broken.push({ file, target: '@' + path.relative(path.dirname(abs), imp), kind: 'import' });
    }
  }
  return { root, broken: broken.slice(0, MAX_FOUND), full: broken.length >= MAX_FOUND || files.length >= MAX_FILES };
}

module.exports = { brokenLinks, pointsIn, linkPath };
