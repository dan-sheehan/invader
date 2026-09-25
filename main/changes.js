// Changes: the open folder is watched while it is open. In a Git repository,
// what changed is what Git says is not committed yet. Without Git, it is what
// the watcher saw since the folder was opened, told apart as new, changed or
// deleted against the names that were there when it was opened.
//
// Besides the terminal and shell.js's `lsof`, this is the only place the app
// runs programs: `git status`, `git log`, `git rev-parse` and `git config`,
// set so a repository cannot make them run anything of its own.

const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const fsWatch = require('node:fs').watch;
const path = require('node:path');
const { checkMap, locate } = require('./map');
const { mapStatus, changeWithoutGit } = require('./status');
const { KIT_REL, MAP_NAME, MAX_FILE_BYTES, inKit, isFinderFile, kitFolder } = require('./disk');

let root = null;            // the folder being watched
let tell = () => {};        // sends what changed to the window
let watchers = [];
let kitWatcher = null;      // ~/kit's watcher, one of watchers, once there is a kit
let gitTop = null;          // top folder of the repository the open folder is in
let branch = null;
let watchError = null;
let seen = new Map();       // without Git: path -> 'new' | 'changed' | 'deleted'
let atStart = null;         // without Git: a promise of what was there at the start
let touched = new Set();    // paths the watcher reported since the last update
let updateTimer = null;
let updating = false;
let latest = null;
let log = [];               // the last commits: { when, subject }

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

// Stop watching: every watcher is closed and nothing more is sent.
function stop() {
  watching++;
  watchers.forEach((w) => w.close());
  watchers = [];
  kitWatcher = null;
  clearTimeout(updateTimer);
}

// Watch folder, and send what changed through send, until watch is called
// again for another folder. When it is called again before this one is set
// up, this one gives up, so no watcher is left on a folder no longer open.
let watching = 0;
async function watch(folder, send) {
  stop();
  const mine = watching;
  root = folder;
  tell = send;
  seen = new Map();
  touched = new Set();
  watchError = null;
  branch = null;
  log = [];
  const top = await git('rev-parse', '--show-toplevel');
  if (mine !== watching) return;
  gitTop = top ? top.trim() : null;
  atStart = gitTop ? null : listAtStart(root);
  try {
    watchers.push(fsWatch(root, { recursive: true }, (_type, name) => name && saw(name.toString())));
    await watchKit();
    // A commit changes files inside .git, which may sit above the open folder.
    const gitDir = gitTop && (await git('rev-parse', '--absolute-git-dir'));
    if (mine !== watching) return;
    if (gitDir && !gitDir.trim().startsWith(root + path.sep)) {
      watchers.push(fsWatch(gitDir.trim(), () => saw('.git/')));
    }
    for (const w of watchers) w.on('error', (err) => { watchError = err.message; send(); });
  } catch (err) {
    watchError = err.message;
  }
  await update();
}

// My kit too, when there is one, so what the agent changes there shows live.
// Its paths are named ~/kit/...; they never count as changes in the open
// folder. Called again whenever the window looks, so a kit made while invader
// runs is watched from then on. Returns why the kit cannot be watched, or
// null.
async function watchKit() {
  if (kitWatcher || !root) return null;
  const kit = await kitFolder();
  if (!kit || kitWatcher) return null;
  try {
    kitWatcher = fsWatch(kit, { recursive: true }, (_type, name) => name && saw(KIT_REL + '/' + name.toString()));
    kitWatcher.on('error', (err) => { watchError = err.message; send(); });
    watchers.push(kitWatcher);
  } catch (err) {
    return err.message;
  }
  return null;
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
    if (rel.startsWith('..') || isFinderFile(rel)) continue;
    const kind = xy === '??' || xy.includes('A') ? 'new' : xy.includes('D') ? 'deleted' : 'changed';
    changes.set(rel, kind);
  }
  return changes;
}

// The last commits that touched the open folder, newest first: when, in
// seconds since 1970, and the first line of the message. The summary shows
// five; the rest tell which commits were made during an agent's session. log.showSignature is
// turned off so checking a signature cannot run a program.
async function gitLog() {
  const out = await git('-c', 'log.showSignature=false', 'log', '-n', '30', '--no-show-signature', '--format=%ct%x09%s', '--', '.');
  return (out || '').split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return { when: Number(line.slice(0, tab)), subject: line.slice(tab + 1) };
  });
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

function send() {
  if (latest) tell({ ...latest, watching: watchers.length > 0 && !watchError, watchError });
}

async function update() {
  if (updating) {
    clearTimeout(updateTimer);
    updateTimer = setTimeout(update, 150);
    return;
  }
  updating = true;
  try {
    const forRoot = root;
    const names = [...touched].filter((p) => !inGit(p) && !isFinderFile(p));
    const committed = !latest || latest.root !== root || [...touched].some(inGit);
    touched = new Set();
    let changes;
    let gitError = null;
    if (gitTop) {
      changes = await gitChanges();
      // When Git cannot say, the last list stays, and the next change asks again.
      if (!changes) {
        gitError = 'Git could not say what changed here, so this may be out of date. It asks again when something changes.';
        changes = latest && latest.root === root ? new Map(latest.list) : new Map();
      }
      if (committed) log = await gitLog();
    } else {
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
      latest = { root, git: !!gitTop, branch, list: [...changes], gitError, touched: names, map, log };
      send();
    }
  } finally {
    updating = false;
  }
}

module.exports = { watch, watchKit, stop };
