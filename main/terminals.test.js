// Tests for several terminals: each its own shell, named by its id, and only
// the chosen one moving the window. They start real shells: zsh, with its
// settings read from an empty folder, so no one's own are. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'invader-terms-')));
fs.mkdirSync(path.join(top, 'a'));
fs.mkdirSync(path.join(top, 'b'));
fs.mkdirSync(path.join(top, 'zdot'));
process.env.SHELL = '/bin/zsh';
process.env.ZDOTDIR = path.join(top, 'zdot');
const shell = require('./shell');

let out = new Map(); // id -> what it printed
let folders = []; // [id, folder] as main tells the window
let moved = []; // folders the window was told to follow
shell.connect((channel, id, data) => {
  if (channel === 'term:data') out.set(id, (out.get(id) || '') + data);
  if (channel === 'term:folder') folders.push([id, data]);
}, (folder) => moved.push(folder));

async function until(check, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail('timed out waiting for ' + what);
}

test.afterEach(() => shell.closeAll());
test.after(() => {
  shell.closeAll();
  fs.rmSync(top, { recursive: true, force: true });
});

test('each terminal has its own id, shell and output, and typing reaches only the one named', async () => {
  const a = shell.start(80, 24, top);
  const b = shell.start(80, 24, top);
  assert.notEqual(a.id, b.id);
  assert.equal(a.cwd, top);
  shell.input(a.id, 'echo only-$((40+2))-here\r');
  await until(() => (out.get(a.id) || '').includes('only-42-here'), 'output in a');
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(!(out.get(b.id) || '').includes('only-42-here'));
  // Nothing is sent anywhere for an id that is not a terminal.
  shell.input(9999, 'echo nowhere\r');
  shell.resize(9999, 10, 10);
  assert.equal(shell.close(9999), false);
  shell.close(a.id);
  shell.close(b.id);
});

test('only the chosen terminal moves the window when its shell changes folder', async () => {
  moved = [];
  folders = [];
  const a = shell.start(80, 24, top);
  const b = shell.start(80, 24, top);
  shell.choose(a.id);
  assert.equal(shell.chosen(), a.id);
  shell.input(b.id, 'cd b\r');
  await until(() => folders.some(([id, f]) => id === b.id && f === path.join(top, 'b')), 'b to be seen in b');
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(moved, [], 'a terminal not chosen never moves the window');
  shell.input(a.id, 'cd a\r');
  await until(() => moved.includes(path.join(top, 'a')), 'the window to follow a');
  // Pressing Return in a terminal that did not move does not move the window.
  moved = [];
  shell.input(a.id, 'true\r');
  await new Promise((r) => setTimeout(r, 1400));
  assert.deepEqual(moved, []);
  // Each terminal's paths are read only from folders that terminal was in.
  assert.equal(shell.wasIn(b.id, path.join(top, 'b')), true);
  assert.equal(shell.wasIn(a.id, path.join(top, 'b')), false);
  assert.equal(shell.wasIn(a.id, path.join(top, 'a')), true);
  shell.close(a.id);
  shell.close(b.id);
  assert.equal(shell.chosen(), null, 'a closed terminal is no longer chosen');
});

test('a folder asked for is followed even when the terminal is there already, or no longer chosen', async () => {
  moved = [];
  const a = shell.start(80, 24, top);
  const b = shell.start(80, 24, top);
  shell.choose(a.id);
  await new Promise((r) => setTimeout(r, 400)); // the shell reaches its prompt
  assert.equal(shell.moveTo(a.id, top), true);
  await until(() => moved.includes(top), 'following a folder the shell was already in');
  moved = [];
  assert.equal(shell.moveTo(a.id, path.join(top, 'a')), true);
  shell.choose(b.id);
  await until(() => moved.includes(path.join(top, 'a')), 'following after choosing another');
  shell.close(a.id);
  shell.close(b.id);
});

test('a terminal with a program running does not move, and closing it stops that program and nothing else', async () => {
  const a = shell.start(80, 24, top);
  const b = shell.start(80, 24, top);
  shell.input(a.id, 'sleep 60\r');
  shell.input(b.id, 'sleep 61\r');
  const child = (id) => {
    const pid = shell.get(id).shell.pid;
    try {
      return execFileSync('/usr/bin/pgrep', ['-P', String(pid)]).toString().trim();
    } catch {
      return '';
    }
  };
  await until(() => child(a.id) && child(b.id), 'both sleeps to start');
  await until(() => shell.what(a.id).program === 'sleep', 'sleep to be in front');
  assert.equal(shell.moveTo(a.id, top), false);
  const sleepA = Number(child(a.id));
  const sleepB = Number(child(b.id));
  shell.close(a.id);
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  await until(() => !alive(sleepA), 'the program in the closed terminal to stop');
  assert.equal(alive(sleepB), true, 'the other terminal\'s program keeps running');
  assert.deepEqual(shell.list().map((t) => t.id), [b.id]);
  shell.close(b.id);
  await until(() => !alive(sleepB), 'the second program to stop');
});

test('no more terminals than the limit start', () => {
  const ids = [];
  for (let i = 0; i < shell.MAX_TERMINALS; i++) ids.push(shell.start(80, 24, top).id);
  assert.throws(() => shell.start(80, 24, top), /Close one first/);
  ids.forEach(shell.close);
});

test('a cd in a terminal left for another before main looked does not move the window', async () => {
  moved = [];
  const a = shell.start(80, 24, top);
  const b = shell.start(80, 24, top);
  shell.choose(a.id);
  shell.input(a.id, 'cd a\r');
  shell.choose(b.id); // chosen again before the first look, 250 ms after Return
  await until(() => folders.some(([id, f]) => id === a.id && f === path.join(top, 'a')), 'a to be seen in a');
  await new Promise((r) => setTimeout(r, 1300));
  assert.deepEqual(moved, []);
});

test('a terminal closed right after Return says nothing more and moves nothing', async () => {
  moved = [];
  folders = [];
  const a = shell.start(80, 24, top);
  shell.choose(a.id);
  shell.input(a.id, 'cd b\r');
  shell.close(a.id);
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual(moved, []);
  assert.deepEqual(folders.filter(([id]) => id === a.id), []);
  assert.equal(shell.wasIn(a.id, top), false);
});
