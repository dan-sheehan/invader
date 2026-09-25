// Terminals: each a shell of its own, started in the open folder, running
// only what is typed into it. Each has an id, and every call names the one it
// is for, so typing, resizing and closing never reach another.
//
// The window follows a terminal: when I press Return in the terminal I have
// chosen and its shell has moved to another folder, the window shows that
// folder. A terminal I have not chosen never moves the window.

const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const pty = require('node-pty');
const { agentName } = require('./status');

// The shell: as set, or, when the app was opened from the Finder or the Dock
// with nothing set, my login shell from the system's user list.
function loginShell() {
  if (process.env.SHELL) return process.env.SHELL;
  try {
    const own = os.userInfo().shell;
    if (own && path.isAbsolute(own) && fs.existsSync(own)) return own;
  } catch {}
  return '/bin/zsh';
}
const SHELL = loginShell();
const MAX_TERMINALS = 12;

const terms = new Map(); // id -> { id, shell, cwd, seen, told, timers, programTimer }
let nextId = 1;
let chosenId = null; // the id of the terminal the window shows
let hooks = { toWindow: () => {}, moved: () => {} };

// toWindow(channel, ...args) talks to the window; moved(folder) is called
// when the chosen terminal's shell has moved to another folder.
function connect(toWindow, moved) {
  hooks = { toWindow, moved };
}

// Settings left by whatever started invader, like Electron or a Claude Code
// session, would make claude in this terminal think it runs inside that
// session, so the shell does not get them; the login shell sets up what it
// needs again. CLAUDE_CONFIG_DIR stays: it says where claude keeps its
// settings and records, and invader reads them from the same place.
const dropped = (key) => (key.startsWith('ELECTRON_') || key.startsWith('CLAUDE')) && key !== 'CLAUDE_CONFIG_DIR';

function utf8Locale() {
  let tag = 'en-US';
  try {
    tag = Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {}
  const m = /^([a-z]{2})-([A-Z]{2})\b/.exec(tag);
  return (m ? m[1] + '_' + m[2] : 'en_US') + '.UTF-8';
}

// A new shell in cwd. Returns its id and folder, or throws why it could not start.
function start(cols, rows, cwd) {
  if (terms.size >= MAX_TERMINALS) throw new Error('There are ' + MAX_TERMINALS + ' terminals already. Close one first.');
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'invader' };
  // Where my kit is, if I keep one, so an agent told to look there finds it
  // from whichever folder the terminal is in.
  const kit = path.join(os.homedir(), 'kit');
  if (fs.statSync(kit, { throwIfNoEntry: false })?.isDirectory()) env.INVADER_KIT = kit;
  for (const key of Object.keys(env)) if (dropped(key)) delete env[key];
  // Opened from the Finder, the app is given no language, and programs in
  // the terminal would then garble anything not plain ASCII. Like Terminal,
  // the shell is given one, in UTF-8, unless one is set already.
  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = utf8Locale();
  const size = (n, d) => (Number.isInteger(n) && n > 0 && n < 1000 ? n : d);
  const shell = pty.spawn(SHELL, ['-l'], { name: 'xterm-256color', cols: size(cols, 80), rows: size(rows, 24), cwd, env });
  const t = { id: nextId++, shell, cwd, seen: new Set([cwd]), told: null, timers: [], programTimer: null };
  t.exited = new Promise((resolve) => (t.gone = resolve));
  terms.set(t.id, t);
  t.listening = shell.onData((data) => {
    hooks.toWindow('term:data', t.id, data);
    checkProgramSoon(t);
  });
  shell.onExit(({ exitCode }) => {
    t.gone();
    if (terms.get(t.id) !== t) return;
    forget(t);
    hooks.toWindow('term:exit', t.id, exitCode);
  });
  return { id: t.id, cwd };
}

function forget(t) {
  t.timers.forEach(clearTimeout);
  clearTimeout(t.programTimer);
  terms.delete(t.id);
  if (chosenId === t.id) chosenId = null;
}

const get = (id) => terms.get(id) || null;

function input(id, data) {
  const t = get(id);
  if (!t || typeof data !== 'string') return;
  t.shell.write(data);
  if (data.includes('\r')) lookSoon(t);
}

function resize(id, cols, rows) {
  const t = get(id);
  if (!t || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) return;
  try {
    t.shell.resize(cols, rows);
  } catch {}
}

// Close a terminal: its shell is sent a hangup, as when a terminal window
// closes, and what runs in it in front is sent one too by the system. Only the
// shell invader started is signalled.
function close(id) {
  const t = get(id);
  if (!t) return false;
  forget(t);
  t.listening.dispose();
  try {
    t.shell.kill();
  } catch {}
  return true;
}

// Close every terminal, as when the app quits, and wait, up to a moment, for
// their shells to end: node-pty must not call back after the app has gone.
function closeAll() {
  const ending = [...terms.values()].map((t) => t.exited);
  for (const id of [...terms.keys()]) close(id);
  return Promise.race([Promise.all(ending), new Promise((resolve) => setTimeout(resolve, 1500))]);
}

function choose(id) {
  if (terms.has(id)) chosenId = id;
}

const chosen = () => (terms.has(chosenId) ? chosenId : null);

// The terminals running, for a window that was drawn again while they ran.
function list() {
  return [...terms.values()].map((t) => ({ id: t.id, cwd: t.cwd, ...what(t.id) }));
}

// Whether a folder is one this terminal's shell has been in: only then is a
// path it printed read from there.
const wasIn = (id, dir) => !!get(id)?.seen.has(dir);

// The shell's current folder, from the system's list of open files.
function folderOf(t) {
  return new Promise((resolve) => {
    execFile('/usr/sbin/lsof', ['-a', '-p', String(t.shell.pid), '-d', 'cwd', '-Fn'], (err, out) => {
      const line = !err && out.split('\n').find((l) => l.startsWith('n'));
      resolve(line ? line.slice(1) : null);
    });
  });
}

// Look where the shell is. The window is told each time, so it knows which
// folder a command's output came from; when the terminal I chose has moved,
// the window follows.
async function look(t) {
  const now = await folderOf(t);
  if (!now || terms.get(t.id) !== t) return;
  const moved = now !== t.cwd;
  t.cwd = now;
  if (t.seen.size < 200) t.seen.add(now);
  hooks.toWindow('term:folder', t.id, now);
  // A move I asked for with Open folder is followed once the shell is there,
  // even if it was there already or I chose another terminal meanwhile.
  const asked = t.asked && now === t.asked;
  if (asked) t.asked = null;
  if ((moved && chosenId === t.id) || asked) hooks.moved(now);
}

// After Return is pressed the shell may have changed folder; look twice,
// soon and a little later.
function lookSoon(t) {
  t.timers.forEach(clearTimeout);
  t.timers = [250, 1200].map((ms) => setTimeout(() => look(t), ms));
}

// Is the shell waiting at its prompt, with nothing else running in it?
const idle = (t) => path.basename(t.shell.process) === path.basename(SHELL);

// What is running in a terminal, such as claude or codex; program is null
// when it is only the shell.
function what(id) {
  const t = get(id);
  const program = t && !idle(t) ? path.basename(t.shell.process) : null;
  return { program, agent: agentName(program) };
}

// The window is told what runs in a terminal when it changes. A program
// starting or ending prints something, so it is looked at a moment after the
// shell prints, and no more than about three times a second. When a program
// ends, the shell is looked at again, since a command may have moved it.
function checkProgramSoon(t) {
  if (t.programTimer) return;
  t.programTimer = setTimeout(() => {
    t.programTimer = null;
    if (terms.get(t.id) !== t) return;
    const now = what(t.id);
    if (now.program === t.told) return;
    const ended = t.told && !now.program;
    t.told = now.program;
    hooks.toWindow('term:program', t.id, now);
    if (ended) look(t);
  }, 300);
}

const quoted = (p) => "'" + p.replace(/'/g, "'\\''") + "'";

// Move a terminal's shell to a folder: clear any half-typed line, then change
// folder. Only while it waits at its prompt; returns false when something
// runs in it. A path holding a control character is never typed, since the
// terminal would act on it rather than pass it to cd.
function moveTo(id, dir) {
  if (/[\x00-\x1f\x7f]/.test(dir)) throw new Error('That folder\'s name holds a character the terminal would act on, so it is not typed there. cd to it yourself.');
  const t = get(id);
  if (!t || !idle(t)) return false;
  t.shell.write('\x15cd ' + quoted(dir) + '\r');
  t.asked = dir;
  lookSoon(t);
  return true;
}

module.exports = { SHELL, utf8Locale, connect, start, input, resize, close, closeAll, choose, chosen, list, get, what, wasIn, moveTo, dropped, MAX_TERMINALS };
