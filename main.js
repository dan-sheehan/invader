// invader main process. It reads the open folder, and ~/kit beside it, and
// never runs anything in them. It writes in one place only: saving a Markdown
// file edited by hand in its plain-text view. The shell in the terminal runs
// what is typed there.
// Besides that, the app itself runs only `git status`, `git rev-parse` and
// `lsof`, to read what changed and where the shell is.

const { app, BrowserWindow, dialog, ipcMain, nativeTheme } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const fsWatch = require('node:fs').watch;
const os = require('node:os');
const path = require('node:path');
const { Lexer } = require('marked');
const pty = require('node-pty');
const { checkMap, locate } = require('./map');
const { agentName, mapStatus, changeWithoutGit } = require('./status');

const README_NAME = /^readme(\.(md|markdown|txt))?$/i;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAP_NAME = 'map.json';
// My kit: what I and the agent bring to the work. It is kept in reach from
// whichever folder is open, and the window names its paths ~/kit/...
const KIT = path.join(os.homedir(), 'kit');
const KIT_REL = '~/kit';
const inKit = (rel) => rel === KIT_REL || !!rel?.startsWith(KIT_REL + '/');

let root = null; // absolute path of the open folder
let win = null;

function toWindow(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// The last folder opened is remembered in the app's own data folder, not in
// the folder shown.
const stateFile = () => path.join(app.getPath('userData'), 'state.json');

async function startFolder() {
  // `npm start -- <folder>` opens that folder.
  const args = process.argv.slice(1).filter((a) => !a.startsWith('-'));
  if (!app.isPackaged) args.shift(); // the app's own folder, as in `electron .`
  const fromArgs = args.pop();
  const candidates = [fromArgs && path.resolve(fromArgs)];
  try {
    candidates.push(JSON.parse(await fs.readFile(stateFile(), 'utf8')).folder);
  } catch {}
  candidates.push(os.homedir());
  for (const c of candidates) {
    try {
      if (c && (await fs.stat(c)).isDirectory()) return await fs.realpath(c);
    } catch {}
  }
  return os.homedir();
}

// The folder to open next time no folder is given.
async function rememberFolder() {
  try {
    await fs.writeFile(stateFile(), JSON.stringify({ folder: root }));
  } catch {}
}

async function setRoot(folder) {
  root = await fs.realpath(folder);
  await rememberFolder();
  toWindow('folder:changed', root);
  await watch();
}

// A path from the window as a real path inside the open folder, or inside
// the kit for a ~/kit/... path, or throw.
async function inside(rel) {
  const kit = inKit(rel);
  const found = kit ? await locate(KIT, '', rel.slice(KIT_REL.length + 1) || '.') : await locate(root, '', rel || '.');
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
async function hasMap(rel) {
  const found = await locate(root, rel, MAP_NAME);
  return !found.problem && !found.dir;
}

// The folder's README: its name, and its first "# " heading, else its first
// non-empty line. Like hasMap, it reads nothing outside the open folder.
async function readme(rel) {
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
    const handle = await fs.open(file.real, 'r');
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(8192), 0, 8192, 0);
      text = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  } catch {
    return { name, title: null };
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const heading = lines.find((l) => /^#\s+\S/.test(l));
  if (heading) return { name, title: heading.replace(/^#\s+/, '').replace(/\s+#*\s*$/, '') };
  return { name, title: lines.find((l) => l.length > 0) || null };
}

// The open folder itself: where it is, and whether it has a map or README.
async function folderInfo() {
  const found = await readme('');
  const kit = await locate(KIT, '', '.');
  return { root, name: path.basename(root) || root, map: await hasMap(''), readme: found?.name ?? null, kit: !kit.problem && kit.dir };
}

// One level of the tree. Folders directly inside the open folder carry their
// README title.
async function listDir(rel) {
  const { real } = await inside(rel);
  const entries = await fs.readdir(real, { withFileTypes: true });
  const items = [];
  for (const e of entries) {
    const abs = path.join(real, e.name);
    const dir = await isDirectory(abs, e);
    const item = { name: e.name, path: path.join(rel, e.name), dir };
    item.map = dir && !inKit(rel) && (await hasMap(item.path));
    if (dir && !rel) item.title = (await readme(item.path))?.title ?? null;
    items.push(item);
  }
  items.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
  return items;
}

async function readFile(rel) {
  const { real, dir } = await inside(rel);
  if (dir) {
    if (inKit(rel)) return { path: rel, folder: true };
    return { path: rel, folder: true, map: await hasMap(rel), readme: (await readme(rel))?.name ?? null };
  }
  const info = await fs.stat(real);
  if (info.size > MAX_FILE_BYTES) {
    return { path: rel, size: info.size, text: null, reason: 'Larger than 2 MB, not shown.' };
  }
  const buffer = await fs.readFile(real);
  if (buffer.includes(0)) {
    return { path: rel, size: info.size, text: null, reason: 'Binary file, not shown.' };
  }
  const text = buffer.toString('utf8');
  // Markdown goes to the window as tokens, never as HTML. The window builds
  // the page from them and drops any HTML tokens.
  const tokens = /\.md$/i.test(rel) ? Lexer.lex(text) : null;
  // A map.json goes to the window already checked against the disk.
  const map = path.basename(rel) === MAP_NAME && !inKit(rel) ? await checkMap(root, rel, text) : null;
  return { path: rel, size: info.size, text, tokens, map };
}

// The one write: a Markdown file edited by hand, back to that same file. from
// is the text the edit started from; if the file no longer holds it, say so
// rather than overwrite what changed, like an agent's edit.
async function saveMarkdown(rel, text, from) {
  if (!/\.md$/i.test(rel)) throw new Error('Only Markdown files are saved');
  if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw new Error('Larger than 2 MB, not saved');
  const { real, dir } = await inside(rel);
  if (dir) throw new Error('Not a file');
  if ((await fs.readFile(real, 'utf8')) !== from) {
    throw new Error('Changed on disk since you started editing, not saved. Copy your edit, then Discard to see the new version.');
  }
  await fs.writeFile(real, text);
  return readFile(rel);
}

// Changes: the open folder is watched while it is open. In a Git repository,
// what changed is what Git says is not committed yet. Without Git, it is what
// the watcher saw since the folder was opened, told apart as new, changed or
// deleted against the names that were there when it was opened.

let watchers = [];
let gitTop = null;          // top folder of the repository the open folder is in
let branch = null;
let watchError = null;
let seen = new Map();       // without Git: path -> 'new' | 'changed' | 'deleted'
let atStart = null;         // without Git: a promise of what was there at the start
let touched = new Set();    // paths the watcher reported since the last update
let updateTimer = null;
let updating = false;

const MAX_TOUCHED = 2000;
const MAX_LISTED = 20000;

function run(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: root, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, maxBuffer: 64 * 1024 * 1024 },
      (err, out) => resolve(err ? null : out));
  });
}

// A repository's own settings must not make `git status` run a program:
// core.fsmonitor is turned off, hooks point at no folder, and
// GIT_OPTIONAL_LOCKS=0 (set in run) keeps git from writing its index, which
// would fire a hook. Filters are handled in gitChanges.
const git = (...args) => run('git', ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', ...args]);

// `git status` runs a filter's program when it rereads a changed file. The
// filters the repository sets itself are read by name, which runs nothing, and
// blanked out; those in my own Git settings, like Git LFS, are left alone.
async function ownFilters() {
  const out = await git('config', '--show-scope', '--name-only', '--get-regexp', '^filter\\.');
  const drivers = new Set();
  for (const line of (out || '').split('\n')) {
    const [scope, name] = line.split('\t');
    if (name && scope !== 'global' && scope !== 'system') drivers.add(name.slice('filter.'.length, name.lastIndexOf('.')));
  }
  return [...drivers].flatMap((d) => ['clean=', 'smudge=', 'process=', 'required=false'].flatMap((set) => ['-c', `filter.${d}.${set}`]));
}

async function watch() {
  watchers.forEach((w) => w.close());
  watchers = [];
  clearTimeout(updateTimer);
  seen = new Map();
  touched = new Set();
  watchError = null;
  branch = null;
  const top = await git('rev-parse', '--show-toplevel');
  gitTop = top ? top.trim() : null;
  atStart = gitTop ? null : listAtStart(root);
  try {
    watchers.push(fsWatch(root, { recursive: true }, (_type, name) => name && saw(name.toString())));
    // My kit too, when there is one, so what the agent changes there shows
    // live. Its paths are named ~/kit/...; they never count as changes in the
    // open folder.
    const kit = await locate(KIT, '', '.');
    if (!kit.problem && kit.dir) {
      watchers.push(fsWatch(kit.real, { recursive: true }, (_type, name) => name && saw(KIT_REL + '/' + name.toString())));
    }
    // A commit changes files inside .git, which may sit above the open folder.
    const gitDir = gitTop && (await git('rev-parse', '--absolute-git-dir'));
    if (gitDir && !gitDir.trim().startsWith(root + path.sep)) {
      watchers.push(fsWatch(gitDir.trim(), () => saw('.git/')));
    }
    for (const w of watchers) w.on('error', (err) => { watchError = err.message; send(); });
  } catch (err) {
    watchError = err.message;
  }
  await update();
}

function saw(name) {
  if (touched.size < MAX_TOUCHED) touched.add(name);
  clearTimeout(updateTimer);
  updateTimer = setTimeout(update, 150);
}

const inGit = (p) => p === '.git' || p.startsWith('.git/');
const inNodeModules = (p) => /(^|\/)node_modules(\/|$)/.test(p);

// `git status` for the open folder, as paths relative to it.
async function gitChanges() {
  const out = await git(...(await ownFilters()), 'status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--', '.');
  if (out === null) return null;
  const changes = new Map();
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    if (entry.startsWith('## ')) {
      branch = entry.slice(3).replace(/^No commits yet on /, '').split('...')[0];
      continue;
    }
    const xy = entry.slice(0, 2);
    const rel = path.relative(root, path.join(gitTop, entry.slice(3)));
    if (xy[0] === 'R' || xy[0] === 'C') i++; // the old name follows
    if (rel.startsWith('..')) continue;
    const kind = xy === '??' || xy.includes('A') ? 'new' : xy.includes('D') ? 'deleted' : 'changed';
    changes.set(rel, kind);
  }
  return changes;
}

// The map at the top of the open folder, checked against the disk, for the
// status strip. Read with the same path check as everything else.
async function topMap() {
  const found = await locate(root, '', MAP_NAME);
  if (found.problem || found.dir) return mapStatus(null);
  try {
    if ((await fs.stat(found.real)).size > MAX_FILE_BYTES) return mapStatus({ error: 'Larger than 2 MB.' });
    return mapStatus(await checkMap(root, MAP_NAME, await fs.readFile(found.real, 'utf8')));
  } catch (err) {
    return mapStatus({ error: err.message });
  }
}

// Without Git: the names of the files and folders in the open folder when it
// was opened, so a new file can be told from a changed one. Names only, never
// contents. It skips node_modules and .git, does not follow symlinks, and
// stops after MAX_LISTED names; then complete is false.
async function listAtStart(top) {
  const found = new Map();
  const folders = [''];
  while (folders.length) {
    const rel = folders.pop();
    let entries;
    try {
      entries = await fs.readdir(path.join(top, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (found.size >= MAX_LISTED) return { found, complete: false };
      const p = path.join(rel, e.name);
      found.set(p, e.isDirectory() ? 'folder' : 'file');
      if (e.isDirectory() && !inGit(p) && !inNodeModules(p)) folders.push(p);
    }
  }
  return { found, complete: true };
}

// What a path in the open folder is now: 'file', 'folder' or null when gone.
async function whatIs(rel) {
  try {
    return (await fs.lstat(path.join(root, rel))).isDirectory() ? 'folder' : 'file';
  } catch {
    return null;
  }
}

let latest = null;
function send() {
  if (latest) toWindow('changes', { ...latest, watching: watchers.length > 0 && !watchError, watchError });
}

async function update() {
  if (updating) {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 150);
    return;
  }
  updating = true;
  const forRoot = root;
  const names = [...touched].filter((p) => !inGit(p));
  touched = new Set();
  let changes = gitTop ? await gitChanges() : null;
  if (!changes) {
    // Only what the watcher saw needs the start list, so nothing waits for it
    // until something changes.
    const start = names.length ? await atStart : null;
    for (const p of names) {
      if (inNodeModules(p) || inKit(p)) continue;
      const kind = changeWithoutGit(start.found.get(p), await whatIs(p), start.complete);
      if (kind) seen.set(p, kind);
      else seen.delete(p);
    }
    changes = seen;
  }
  const map = await topMap();
  if (forRoot === root) {
    latest = { root, git: !!gitTop, branch, list: [...changes], touched: names, map };
    send();
  }
  updating = false;
}

// Terminal: one shell, started in the open folder. The window follows the
// shell: when it changes folder, the window shows that folder.

let shell = null;
// The file with an edit not saved yet, as the window tells it; null when none.
let unsavedEdit = null;
const SHELL = process.env.SHELL || '/bin/zsh';

function startShell(cols, rows) {
  if (shell) return;
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'invader' };
  // Where my kit is, if I keep one, so an agent told to look there finds it
  // from whichever folder the terminal is in.
  if (require('node:fs').statSync(KIT, { throwIfNoEntry: false })?.isDirectory()) env.INVADER_KIT = KIT;
  // Settings left by whatever started invader, like Electron or a Claude Code
  // session, would make claude in this terminal think it runs inside that
  // session. The login shell sets up what it needs again.
  for (const key of Object.keys(env)) if (key.startsWith('ELECTRON_') || key.startsWith('CLAUDE')) delete env[key];
  try {
    shell = pty.spawn(SHELL, ['-l'], { name: 'xterm-256color', cols, rows, cwd: root, env });
  } catch (err) {
    toWindow('term:data', 'The shell could not start: ' + err.message + '\r\n');
    toWindow('term:exit');
    return;
  }
  const mine = shell;
  shell.onData((data) => {
    toWindow('term:data', data);
    checkProgramSoon();
  });
  shell.onExit(() => {
    if (shell !== mine) return;
    shell = null;
    toWindow('term:exit');
    checkProgramSoon();
  });
}

// The shell's current folder, from the system's list of open files.
function shellFolder() {
  return new Promise((resolve) => {
    if (!shell) return resolve(null);
    execFile('/usr/sbin/lsof', ['-a', '-p', String(shell.pid), '-d', 'cwd', '-Fn'], (err, out) => {
      const line = !err && out.split('\n').find((l) => l.startsWith('n'));
      resolve(line ? line.slice(1) : null);
    });
  });
}

// While an edit is not saved, the window stays where it is and says where the
// terminal went; it follows once the edit is saved or discarded.
async function followShell() {
  const folder = await shellFolder();
  if (!folder || folder === root) return;
  if (unsavedEdit) toWindow('folder:waiting', folder);
  else await setRoot(folder);
}

// After Return is pressed the shell may have changed folder; look twice,
// soon and a little later.
let followTimers = [];
function followSoon() {
  followTimers.forEach(clearTimeout);
  followTimers = [250, 1200].map((ms) => setTimeout(followShell, ms));
}

// Is the shell waiting at its prompt, with nothing else running in it?
const shellIdle = () => shell && path.basename(shell.process) === path.basename(SHELL);

// What is running in the terminal, such as claude or codex; null when it is
// only the shell.
const shellProgram = () => (shell && !shellIdle() ? path.basename(shell.process) : null);

// The window is told what runs in the terminal when it changes. A program
// starting or ending prints something, so it is looked at a moment after the
// shell prints, and no more than about three times a second.
let program = null;
let programTimer = null;
function running() {
  const now = shellProgram();
  return { program: now, agent: agentName(now) };
}

function checkProgramSoon() {
  if (programTimer) return;
  programTimer = setTimeout(() => {
    programTimer = null;
    const now = running();
    if (now.program === program) return;
    program = now.program;
    toWindow('term:program', now);
  }, 300);
}

const quoted = (p) => "'" + p.replace(/'/g, "'\\''") + "'";

// Opening a folder moves the terminal there, and the window follows.
async function chooseFolder() {
  const res = await dialog.showOpenDialog(win, { defaultPath: root, properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  const folder = res.filePaths[0];
  if (!shell) {
    await setRoot(folder);
    return 'opened';
  }
  if (!shellIdle()) return 'busy';
  // Clear any half-typed line, then change folder.
  shell.write('\x15cd ' + quoted(folder) + '\r');
  followSoon();
  return 'opened';
}

ipcMain.on('edit:unsaved', (_e, rel) => {
  unsavedEdit = rel || null;
  if (!unsavedEdit) followShell();
});
ipcMain.on('term:start', (_e, cols, rows) => startShell(cols, rows));
ipcMain.on('term:input', (_e, data) => {
  shell?.write(data);
  if (data.includes('\r')) followSoon();
});
ipcMain.on('term:resize', (_e, cols, rows) => {
  try {
    shell?.resize(cols, rows);
  } catch {}
});

// Errors go back to the window as data so it can show them.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

handle('folder:info', folderInfo);
handle('folder:choose', chooseFolder);
handle('dir:list', listDir);
handle('file:read', readFile);
handle('file:save', saveMarkdown);
handle('term:program', running);

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 950,
    title: 'invader',
    backgroundColor: '#1b1b1b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  // Links and new windows stay closed; the window only shows its own page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'index.html'));
  // Quitting with an edit not saved asks first.
  win.on('close', (event) => {
    if (!unsavedEdit) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      message: 'You have an unsaved edit to ' + unsavedEdit + '. Quit anyway?',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    if (choice === 1) event.preventDefault();
  });
}

nativeTheme.themeSource = 'dark';

app.whenReady().then(async () => {
  app.dock?.setIcon(path.join(__dirname, 'icon.png'));
  root = await startFolder();
  rememberFolder();
  createWindow();
  win.webContents.once('did-finish-load', watch);
});
app.on('window-all-closed', () => {
  shell?.kill();
  app.quit();
});
