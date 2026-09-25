// Drives the real app for its tests (main/app.test.js), never for use. It is
// started as Electron's entry in place of main.js, in a made-up home folder
// with its own data folder, and runs one scenario by name, printing what it
// finds as lines starting DRIVE, then quits. Nothing here ships in the
// packaged app.
//
// Before main.js loads, everything that would reach past the app to the
// computer is replaced: opening the browser, a file or Finder, the clipboard
// and dialogs. Each replacement fails the scenario unless the scenario said
// to expect it. If a replacement does not hold, the scenario stops before the
// app starts, so a test can never fall through to the real thing.

const path = require('node:path');
const fs = require('node:fs');
const electron = require('electron');

const { app, shell, clipboard, dialog, BrowserWindow, webContents } = electron;

const say = (what, value) => process.stdout.write('DRIVE ' + JSON.stringify({ what, value }) + '\n');
const fail = (why) => {
  say('fail', String(why && why.stack ? why.stack : why));
  process.exitCode = 1;
  app.exit(1);
};

const home = process.env.DRIVE_HOME;
const data = process.env.DRIVE_DATA;
if (!home || !data || !process.env.DRIVE_SCENARIO) {
  process.stderr.write('drive.js runs only from main/app.test.js, with DRIVE_HOME, DRIVE_DATA and DRIVE_SCENARIO set.\n');
  process.exit(2);
}
app.setPath('userData', data);
app.setName('next-invader-test');

// What the scenario said to expect, and what reached the computer's edge.
const edge = { expect: {}, calls: [], clipboard: '', dialogs: [], checking: false };
function guard(obj, name, label, fake) {
  const replacement = (...args) => {
    edge.calls.push({ label, args: args.map((a) => (typeof a === 'string' ? a : typeof a)) });
    if (edge.checking) throw new Error('Blocked in the test: ' + label);
    if (!edge.expect[label]) {
      fail('Unexpected ' + label + '(' + JSON.stringify(args[0] ?? null).slice(0, 200) + ')');
      throw new Error('Blocked in the test: ' + label);
    }
    edge.expect[label]--;
    return fake(...args);
  };
  try {
    obj[name] = replacement;
  } catch {}
  if (obj[name] !== replacement) {
    process.stderr.write('Could not replace ' + label + '; stopping before the app starts.\n');
    process.exit(3);
  }
}
guard(shell, 'openExternal', 'openExternal', async () => {});
guard(shell, 'openPath', 'openPath', async () => '');
guard(shell, 'showItemInFolder', 'showItemInFolder', () => {});
guard(shell, 'trashItem', 'trashItem', async () => {});
// The clipboard is kept here, so a test never touches the real one.
guard(clipboard, 'writeText', 'clipboard.writeText', (t) => {
  edge.clipboard = t;
});
guard(clipboard, 'readText', 'clipboard.readText', () => edge.clipboard);
// Dialogs answer from the scenario's queue: { match, button } in order.
const answer = (label) => (_win, opts) => {
  const o = opts || _win;
  const next = edge.dialogs.shift();
  const said = { message: o.message, detail: o.detail, buttons: o.buttons };
  say('dialog', said);
  if (!next) {
    fail('A dialog nobody expected: ' + o.message);
    return o.cancelId ?? 1;
  }
  if (next.match && !new RegExp(next.match).test(o.message + '\n' + (o.detail || ''))) fail('Dialog did not match ' + next.match + ': ' + o.message);
  const i = o.buttons.indexOf(next.button);
  if (i < 0) fail('No button ' + next.button + ' in ' + o.buttons.join(', '));
  return label.endsWith('Sync') ? i : Promise.resolve({ response: i });
};
for (const name of ['showMessageBoxSync', 'showMessageBox']) {
  const fn = answer(name);
  dialog[name] = (...args) => {
    edge.expect[name] = (edge.expect[name] || 0) + 1;
    return fn(...args);
  };
}
guard(dialog, 'showOpenDialog', 'showOpenDialog', async () => ({ canceled: true, filePaths: [] }));
guard(dialog, 'showOpenDialogSync', 'showOpenDialogSync', () => undefined);
guard(dialog, 'showSaveDialog', 'showSaveDialog', async () => ({ canceled: true }));
guard(dialog, 'showErrorBox', 'showErrorBox', () => {});

// Check the guards hold before anything else runs.
edge.checking = true;
for (const [obj, name, arg] of [[shell, 'openExternal', 'https://example.com/'], [shell, 'openPath', home], [clipboard, 'writeText', 'x']]) {
  let stopped = false;
  try {
    obj[name](arg);
  } catch {
    stopped = true;
  }
  if (!stopped) {
    process.stderr.write('The guard on ' + name + ' did not stop a call; stopping before the app starts.\n');
    process.exit(3);
  }
}
edge.checking = false;
edge.calls = [];

const main = require('./main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, what, ms = 8000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      last = await check();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await wait(60);
  }
  throw new Error('Timed out waiting for ' + what + (last instanceof Error ? ': ' + last.message : ''));
}

function theWindow() {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) || null;
}

// A small kit of moves for scenarios.
function kit(win) {
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);
  // A key pressed as the window gets it: down, the character, up. The menu
  // hears it only if the page does not take it, as with a real key.
  const key = async (keyCode, modifiers = [], target = wc) => {
    if (/^[A-Z]$/.test(keyCode) && !modifiers.includes('shift')) modifiers = [...modifiers, 'shift'];
    target.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    if (keyCode.length === 1 && !modifiers.some((m) => m === 'meta' || m === 'cmd' || m === 'control' || m === 'ctrl')) target.sendInputEvent({ type: 'char', keyCode, modifiers });
    target.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(80);
  };
  const type = async (text, target = wc) => {
    for (const ch of text) await key(ch, [], target);
  };
  const shot = async (name) => {
    const dir = process.env.DRIVE_SHOTS;
    if (!dir) return;
    const img = await win.capturePage();
    fs.writeFileSync(path.join(dir, name + '.png'), img.toPNG());
    // The preview's page is a view of its own, not in the window's picture.
    // It is kept beside it, with where it sits, so the two can be put
    // together and labelled as put together.
    const pv = require('./preview').contents();
    if (pv && !pv.isDestroyed()) {
      try {
        let p = null;
        for (let i = 0; i < 6 && !p; i++) {
          try {
            p = await pv.capturePage();
          } catch (err) {
            if (i === 5) throw err;
            await wait(500);
          }
        }
        if (p.isEmpty()) say('shot-note', name + ': the page picture came back empty');
        else {
          fs.writeFileSync(path.join(dir, name + '.preview.png'), p.toPNG());
          // Put together: the page drawn where the window places it. Labelled
          // composite, since it is two pictures, not one.
          const out = await js(`(async () => {
            const slot = document.getElementById('preview-slot');
            if (!slot) return null;
            const r = slot.getBoundingClientRect();
            const load = async (b64) => createImageBitmap(new Blob([Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))], { type: 'image/png' }));
            const [w, pg] = await Promise.all([load(${JSON.stringify(img.toPNG().toString('base64'))}), load(${JSON.stringify(p.toPNG().toString('base64'))})]);
            const k = w.width / window.innerWidth;
            const c = new OffscreenCanvas(w.width, w.height);
            const g = c.getContext('2d');
            g.drawImage(w, 0, 0);
            g.drawImage(pg, r.left * k, r.top * k, r.width * k, r.height * k);
            const blob = await c.convertToBlob({ type: 'image/png' });
            const bytes = new Uint8Array(await blob.arrayBuffer());
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            return btoa(bin);
          })()`);
          if (out) fs.writeFileSync(path.join(dir, name + '.composite.png'), Buffer.from(out, 'base64'));
        }
      } catch (err) {
        say('shot-note', name + ': ' + err.message);
      }
    }
  };
  // A menu item, by its labels, like menu('Go', 'Find…'): what its key does.
  const item = (...labels) => {
    let items = electron.Menu.getApplicationMenu().items;
    let found = null;
    for (const label of labels) {
      found = items.find((i) => i.label === label);
      if (!found) throw new Error('No menu item ' + labels.join(' › '));
      items = found.submenu?.items || [];
    }
    return found;
  };
  const menu = async (...labels) => {
    const found = item(...labels);
    found.click(undefined, win, wc);
    await wait(150);
  };
  // The text a terminal shows, by its place in the tabs, or the chosen one.
  const termText = (i = null) => js(`(() => { const t = ${i == null ? 'activeTerm()' : 'terms[' + i + ']'}; const b = t.term.buffer.active; const out = []; for (let y = 0; y < b.length; y++) out.push(b.getLine(y).translateToString(true)); return out.join(String.fromCharCode(10)); })()`);
  // Type into the terminal that has the keyboard, as keys.
  const typeTerm = async (text) => {
    for (const ch of text) {
      if (ch === '\r') await key('Return');
      else await key(ch);
    }
  };
  const focused = () => js('(() => { const a = document.activeElement; return a ? (a.id || a.className || a.tagName) : null; })()');
  return { win, wc, js, key, type, shot, focused, until, wait, say, edge, item, menu, termText, typeTerm };
}

const scenarios = require('./drive-scenarios.js');

app.whenReady().then(async () => {
  const name = process.env.DRIVE_SCENARIO;
  const run = scenarios[name];
  if (!run) return fail('No scenario ' + name);
  const timer = setTimeout(() => fail('Scenario ' + name + ' took too long'), Number(process.env.DRIVE_TIMEOUT || 90000));
  try {
    const win = await until(() => {
      const w = theWindow();
      return w && !w.webContents.isLoading() ? w : null;
    }, 'the window');
    const k = kit(win);
    // Anything the window's own scripts report as an error fails the scenario.
    const errors = [];
    win.webContents.on('console-message', (e, level, message) => {
      const lvl = e?.level ?? level;
      const msg = e?.message ?? message;
      if (lvl === 'error' || lvl === 3) errors.push(msg);
    });
    k.errors = errors;
    Object.assign(k, { dir: process.env.DRIVE_FIXTURE, home, data });
    await until(() => k.js('!!(typeof state !== "undefined" && state.root && document.querySelector("#term .xterm"))'), 'the window to draw');
    // The renderer's own confirm() is answered from the same queue as
    // main's dialogs, and says what it asked.
    await k.js(`window.__confirms = []; window.__answers = []; window.confirm = (m) => { window.__confirms.push(m); const a = window.__answers.shift(); if (a === undefined) { window.__unexpected = m; return false; } return a; }; true`);
    // A scenario may end by returning how it quits, as a real quit would.
    const quitting = await run(k, { main, home, data, dir: process.env.DRIVE_FIXTURE });
    const unexpected = await k.js('window.__unexpected || null').catch(() => null);
    if (unexpected) throw new Error('An unexpected confirm(): ' + unexpected);
    if (errors.length) throw new Error('The window reported errors: ' + errors.join(' | '));
    clearTimeout(timer);
    say('done', { edge: edge.calls });
    if (process.exitCode) return;
    if (typeof quitting === 'function') return quitting();
    if (!process.env.DRIVE_KEEP) app.exit(0);
  } catch (err) {
    clearTimeout(timer);
    fail(err);
  }
});
