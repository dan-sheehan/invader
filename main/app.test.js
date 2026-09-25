// Tests that run the real app (Electron) on made-up folders, in a made-up
// home folder with a data folder of its own, through main/drive.js. Nothing
// reaches the real home folder, browser, clipboard or dialogs. Run with
// `npm test`; set INVADER_APP_TESTS=0 to leave them out.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ELECTRON = require('electron');
const skip = process.env.INVADER_APP_TESTS === '0' || process.platform !== 'darwin';

// A made-up home, data folder and project. files: { 'a/b.md': 'text' }.
function place(files = {}) {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'invader-app-')));
  const home = path.join(top, 'home');
  const data = path.join(top, 'data');
  const dir = path.join(home, 'project');
  fs.mkdirSync(path.join(home, 'zdot'), { recursive: true });
  fs.mkdirSync(data);
  fs.mkdirSync(dir);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  return { top, home, data, dir };
}

// Run one scenario. Resolves with { code, said: [{ what, value }], out }.
function drive(scenario, where, { env = {}, timeout = 90000, kill = null } = {}) {
  return new Promise((resolve) => {
    const shots = process.env.INVADER_SHOTS || '';
    const child = spawn(ELECTRON, [path.join(__dirname, 'drive.js'), where.dir], {
      env: {
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        HOME: where.home,
        SHELL: '/bin/zsh',
        ZDOTDIR: path.join(where.home, 'zdot'),
        LANG: 'en_US.UTF-8',
        TMPDIR: os.tmpdir(),
        DRIVE_HOME: where.home,
        DRIVE_DATA: where.data,
        DRIVE_FIXTURE: where.dir,
        DRIVE_SCENARIO: scenario,
        DRIVE_TIMEOUT: String(timeout - 5000),
        DRIVE_SHOTS: shots,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const said = [];
    let buffered = '';
    child.stdout.on('data', (d) => {
      out += d;
      buffered += d;
      let nl;
      while ((nl = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, nl);
        buffered = buffered.slice(nl + 1);
        if (!line.startsWith('DRIVE ')) continue;
        const msg = JSON.parse(line.slice(6));
        said.push(msg);
        if (kill && kill(msg)) child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, said, out });
    });
  });
}

const value = (r, what) => r.said.find((s) => s.what === what)?.value;
const values = (r, what) => r.said.filter((s) => s.what === what).map((s) => s.value);
function ok(r) {
  const failed = r.said.find((s) => s.what === 'fail');
  assert.ok(!failed, failed?.value + '\n' + r.out.slice(-3000));
  assert.equal(r.code, 0, r.out.slice(-3000));
  assert.ok(value(r, 'done'), 'the scenario did not finish\n' + r.out.slice(-3000));
}


test('the app opens a project in a made-up home', { skip }, async () => {
  const where = place({ 'README.md': '# Fixture\n\nHello.\n' });
  const r = await drive('look', where);
  ok(r);
  assert.match(value(r, 'title'), /project/);
});

test('keys and commands reach the surface that has the keyboard, once', { skip }, async () => {
  const r = await drive('keys', place({ 'README.md': '# Fixture\n\nHello there.\n' }));
  ok(r);
  for (const what of ['palette-returns-to-terminal', 'clear-follows-keyboard', 'close-follows-keyboard', 'terminals-apart', 'find-in-file']) assert.equal(value(r, what), true, what);
});

// Two certificates a server makes for itself, for 127.0.0.1.
function certificates(top) {
  const dir = path.join(top, 'certs');
  fs.mkdirSync(dir);
  for (const n of [1, 2]) {
    require('node:child_process').execFileSync('/usr/bin/openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=127.0.0.1',
      '-keyout', path.join(dir, 'key' + n + '.pem'), '-out', path.join(dir, 'cert' + n + '.pem')], { stdio: 'ignore' });
  }
  return dir;
}

test('the preview finds in the page, hands the keyboard back, and trusts a certificate only when asked', { skip }, async () => {
  const where = place({ 'README.md': '# Fixture\n\nHello there.\n' });
  const r = await drive('preview', where, { env: { DRIVE_CERTS: certificates(where.top) } });
  ok(r);
  for (const what of ['preview-find', 'palette-returns-to-page', 'external', 'certificate-refused', 'certificate-trusted', 'other-certificate-refused']) assert.equal(value(r, what), true, what);
});

test('opening the browser when a test did not expect it fails the test, and nothing reaches the real browser', { skip }, async () => {
  const r = await drive('unexpectedExternal', place({ 'README.md': '# F\n' }));
  assert.notEqual(r.code, 0);
  assert.match(value(r, 'fail'), /Unexpected openExternal/);
});

test('a relative path a terminal printed from somewhere else is never opened as if its folder were known', { skip }, async () => {
  const where = place({ 'notes.md': '# Top notes\n', 'a/notes.md': '# Notes in a\nline two\n', 'only-here.md': '# Only\n' });
  const r = await drive('links', where);
  ok(r);
  for (const what of ['ambiguous-choice', 'unique-direct', 'full-direct', 'unknown-folder-asks']) assert.equal(value(r, what), true, what);
});

// A stand-in for claude: a program named claude that, like cat, repeats a
// line only after Return. Built with the system's compiler, when there is one.
function fakeAgent(dir) {
  fs.mkdirSync(path.join(dir, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bin', 'claude.c'), '#include <unistd.h>\nint main(void) { char b[4096]; ssize_t n; while ((n = read(0, b, sizeof b)) > 0) write(1, b, n); return 0; }\n');
  try {
    require('node:child_process').execFileSync('/usr/bin/cc', ['-o', path.join(dir, 'bin', 'claude'), path.join(dir, 'bin', 'claude.c')], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
const canBuild = !skip && fs.existsSync('/usr/bin/cc');

test('Build map types into the terminal meant, asks when that is not certain, and never presses Return', { skip: skip || !canBuild }, async () => {
  const where = place({ 'README.md': '# F\n' });
  assert.ok(fakeAgent(where.dir), 'the stand-in for claude could not be built');
  const r = await drive('buildMap', where, { timeout: 150000 });
  ok(r);
  for (const what of ['no-agent-asks', 'two-agents-asks', 'chosen-agent-direct']) assert.equal(value(r, what), true, what);
});

test('a command pasted with what it printed asks first, pastes only what I choose, and runs only on Return', { skip }, async () => {
  const where = place({ 'README.md': '# F\n' });
  const r = await drive('paste', where);
  ok(r);
  for (const what of ['pasted-without-running', 'ran-on-return']) assert.equal(value(r, what), true, what);
  const warning = value(r, 'paste-warning');
  assert.equal(warning.said, 'Paste 2 lines into the shell?');
  assert.deepEqual(warning.buttons, ['Paste only the command', 'Paste all 2 lines', 'Cancel']);

  if (process.env.INVADER_JEV_TESTS === '1' && process.env.TYPESAFE_API_KEY) {
    // An experiment: how clearly the warning the app drew reads, then made-up
    // versions of its detail, to compare. Never fails the test.
    const variants = {
      actual: warning.about,
      'missing-explanation': '',
      misleading: 'All pasted lines are safe and will run automatically.',
      explicit: 'The shell treats each pasted line as its own command. Choose what you want to paste. Nothing runs until you press Return.',
    };
    for (const [name, detail] of Object.entries(variants)) {
      const p = await jev({
        warning: { title: warning.said, detail, linesShown: warning.lines },
        buttons: warning.buttons,
        // What the shell does, and what the scenario checked the app does.
        truth: {
          shellRunsEachPastedLineAsItsOwnCommand: true,
          pastedCommandOutputMayBeRunAsCommands: true,
          nothingRunsBecauseTheWarningAppears: true,
          userChoosesWhatToPasteAndMustStillPressReturn: true,
        },
      }, 'Does this warning clearly communicate the risk of pasting multiple shell lines and what the user controls before anything runs?');
      console.log('JEV paste ' + name + ' clarity=' + p.toFixed(2));
    }
  }
});

// Whether a process whose command is exactly this runs, from ps.
const running = (command) => require('node:child_process').execFileSync('/bin/ps', ['-axo', 'command='], { encoding: 'utf8' }).split('\n').some((l) => l.trim() === command);

async function gone(pattern, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (!running(pattern)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

test('an unsaved edit survives a cancelled quit, a failed save, a quit and a crash, and is gone only when discarded', { skip }, async () => {
  const long = Array.from({ length: 300 }, (_, i) => 'line ' + (i + 1)).join('\n') + '\n';
  const where = place({ 'notes.md': '# Notes\n\nOriginal line.\n', 'other.md': '# Other\n\n', 'long.txt': long });
  const first = await drive('draftEdit', where);
  ok(first);
  for (const what of ['kept', 'cancel-kept-everything', 'failed-save-kept-everything']) assert.equal(value(first, what), true, what);
  // Quitting asked once, then once for the failed save, then once more.
  assert.equal(values(first, 'dialog').length, 4);
  assert.ok(await gone('sleep 4711'), 'quitting ended what ran in the terminal');
  const state = JSON.parse(fs.readFileSync(path.join(where.data, 'state.json'), 'utf8'));
  assert.ok(state.folders[where.dir].places['file:long.txt'].line > 100, 'the place in long.txt was remembered');

  const second = await drive('draftRecover', where, { kill: (m) => m.what === 'ready-to-crash' });
  assert.equal(second.signal, 'SIGKILL', second.out.slice(-1500));
  for (const what of ['recovered', 'external-change-shown', 'discard-cleared']) assert.equal(value(second, what), true, what + '\n' + second.out.slice(-2000));
  assert.ok(!second.said.some((s) => s.what === 'fail'), second.out.slice(-2000));
  assert.ok(await gone('sleep 4712'), 'a program in a terminal does not outlive the app');

  const third = await drive('draftAfterCrash', where);
  ok(third);
  for (const what of ['recovered-after-crash', 'missing-file-kept']) assert.equal(value(third, what), true, what);
  assert.equal(values(third, 'dialog').length, 0, 'nothing to lose, so nothing asked');

  if (process.env.INVADER_JEV_TESTS === '1' && process.env.TYPESAFE_API_KEY) {
    // The real dialog, then made-up versions of its detail, to see whether
    // the answer tells a clear dialog from a worse one.
    const real = values(first, 'dialog')[0];
    const variants = {
      actual: real.detail,
      'missing-detail': '',
      misleading: 'Your changes have been saved to the original file.',
      explicit: 'Your edit has not been saved to the original file. If you quit, next-invader will keep a recovery copy so the unsaved edit can be restored when you return.',
    };
    for (const [name, detail] of Object.entries(variants)) {
      console.log('JEV ' + name + ' clarity=' + (await jevQuitDialog({ ...real, detail })).toFixed(2));
    }
  }
});

// An experiment, only with INVADER_JEV_TESTS=1 and TYPESAFE_API_KEY set: asks
// TypeSafe's Jev whether a quit dialog reads clearly, and returns the
// probability. It never fails the test on the answer.
const jevQuitDialog = (dialog) => jev({
  dialog: { message: dialog.message, detail: dialog.detail, buttons: dialog.buttons },
  // What draftEdit checked on disk before this dialog was shown.
  truth: { editSavedToOriginalFile: false, recoveryCopyInNextInvaderDataFolder: true },
}, 'Does this dialog clearly communicate that the edit is not saved to the original file but will remain recoverable if the user quits?');

// One Noul question to Jev about this state; the probability of yes.
async function jev(state, question) {
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + process.env.TYPESAFE_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', state, questions: { clarity: { type: 'noul', instructions: question } } }),
    signal: AbortSignal.timeout(30000),
  });
  const body = await res.text();
  assert.ok(res.ok, 'Jev answered ' + res.status + ': ' + body.slice(0, 500));
  const answer = JSON.parse(body);
  const p = answer.answers?.clarity?.noul;
  assert.equal(typeof p, 'number', 'Jev gave no probability: ' + body.slice(0, 500));
  return p;
}

const hasPython = !skip && (() => {
  try {
    require('node:child_process').execFileSync('/usr/bin/python3', ['-c', 'import http.server'], { stdio: 'ignore', timeout: 20000 });
    return true;
  } catch {
    return false;
  }
})();

test('the daily loop: a server started in a terminal, its page in the preview and found in, a Markdown edit kept, and a quit', { skip: skip || !hasPython }, async () => {
  // One tall group and short ones, as most maps are.
  const map = { groups: [
    { label: 'Main parts', boxes: [
      { id: 'page', label: 'The page', paths: ['index.html'] }, { id: 'style', label: 'Its look', paths: ['style.css'] },
      { id: 'ideas', label: 'Ideas', paths: ['notes/'] }, { id: 'data', label: 'Tide data', paths: ['data/'] },
      { id: 'tools', label: 'Tools', paths: ['tools/'] },
    ] },
    { label: 'About it', boxes: [{ id: 'readme', label: 'What it is', paths: ['README.md'] }] },
    { label: 'Inside the notes', boxes: [{ id: 'idea-list', label: 'The list of ideas', paths: ['notes/ideas.md'] }] },
  ], arrows: [
    { from: 'page', to: 'style', label: 'is styled by', file: 'index.html', text: 'style.css' },
    { from: 'readme', to: 'page', label: 'describes', file: 'README.md', text: 'index.html' },
    { from: 'idea-list', to: 'data', label: 'asks for', file: 'notes/ideas.md', text: 'tide station' },
  ] };
  const where = place({
    'data/tides.csv': 'time,height\n',
    'tools/fetch.sh': 'echo\n',
    'README.md': '# Tide clock\n\nA small page, `index.html`, that shows the tides.\n',
    'index.html': '<!doctype html><title>Tide clock</title><link rel="stylesheet" href="style.css"><h1>Tide clock</h1><p>Next high tide: 14:32</p><p>Next low tide: 20:51</p>',
    'style.css': 'body { font: 18px system-ui; margin: 40px; background: #f4f1ea; } h1 { color: #1d4e89; }',
    'notes/ideas.md': '# Ideas\n\n- A second tide station.\n',
    'map.json': JSON.stringify(map, null, 1),
  });
  const r = await drive('tour', where, { timeout: 150000 });
  ok(r);
  assert.equal(value(r, 'find'), '1 of 3');
  assert.match(values(r, 'dialog')[0].detail, /notes\/ideas\.md is kept/);
  assert.ok(await gone('python3 -m http.server 8765 --bind 127.0.0.1'));
});

// The app as built by `npm run app`, opened the way the Finder opens it:
// no terminal behind it, so no SHELL, no LANG and the system's short PATH.
// Its shell must still start as a login shell, read my profile, and find a
// command the profile puts on the PATH. The made-up home holds the profile
// and the app's data folder (CFFIXED_USER_HOME points the Mac's own
// Library there), so nothing real is read or written.
const APP = path.join(__dirname, '..', 'dist', 'next-invader-darwin-' + process.arch, 'next-invader.app');
const built = fs.existsSync(APP);
const fresh = built && ['main/main.js', 'main/shell.js', 'window/terminal.js', 'window/file.js'].every((f) =>
  fs.readFileSync(path.join(APP, 'Contents/Resources/app', f), 'utf8') === fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
test('the built app starts with nothing from a terminal, and its shell reads the profile and finds commands', { skip: skip ? true : !built ? 'not built: npm run app' : !fresh ? 'built from older code: npm run app' : false }, async () => {
  const where = place({ 'README.md': '# Packaged\n' });
  const bin = path.join(where.home, 'fixture-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'fixturecmd'), '#!/bin/sh\nenv > "$HOME/terminal-env.txt"\npwd >> "$HOME/terminal-env.txt"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(where.home, '.zprofile'), 'export PATH="$HOME/fixture-bin:$PATH"\nexport FIXTURE_PROFILE=read\n');
  fs.writeFileSync(path.join(where.home, '.zshrc'), 'fixturecmd\n');
  const child = spawn(path.join(APP, 'Contents/MacOS/next-invader'), [where.dir], {
    env: { HOME: where.home, CFFIXED_USER_HOME: where.home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: os.tmpdir(), USER: os.userInfo().username },
    stdio: 'ignore',
  });
  const marker = path.join(where.home, 'terminal-env.txt');
  const stateFile = path.join(where.home, 'Library/Application Support/next-invader/state.json');
  try {
    const end = Date.now() + 30000;
    while (Date.now() < end && !(fs.existsSync(marker) && fs.existsSync(stateFile))) await new Promise((r) => setTimeout(r, 200));
    assert.ok(fs.existsSync(marker), 'the shell in the app ran the command from the profile');
    const env = fs.readFileSync(marker, 'utf8');
    assert.match(env, /^FIXTURE_PROFILE=read$/m, 'the login shell read the profile');
    assert.match(env, new RegExp('^PATH=' + bin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':', 'm'), 'the profile put its folder on the PATH');
    assert.match(env, /^LANG=[a-z]{2}_[A-Z]{2}\.UTF-8$/m, 'the shell was given a UTF-8 language');
    assert.match(env, /^TERM=xterm-256color$/m);
    assert.match(env, /^TERM_PROGRAM=invader$/m);
    assert.doesNotMatch(env, /^ELECTRON_/m);
    assert.ok(env.trim().endsWith(where.dir), 'the shell started in the folder opened');
    // The window drew and told main its tabs, into the made-up home's data folder.
    const end2 = Date.now() + 10000;
    while (Date.now() < end2 && !fs.existsSync(stateFile)) await new Promise((r) => setTimeout(r, 200));
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.equal(state.folder, where.dir);
  } finally {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
});

test('switching folders, terminals and the preview again and again leaves nothing behind, and a narrow window fits', { skip }, async () => {
  const where = place({ 'README.md': '# First\n' });
  fs.mkdirSync(path.join(where.home, 'second'));
  fs.writeFileSync(path.join(where.home, 'second', 'README.md'), '# Second\n');
  const r = await drive('switching', where, { timeout: 150000 });
  ok(r);
  assert.equal(value(r, 'switching'), true);
});
