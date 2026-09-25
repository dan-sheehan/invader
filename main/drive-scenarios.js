// Scenarios the app's tests run in the real app (main/drive.js). Each gets a
// small kit of moves: js(code) runs in the window, key(code, modifiers)
// presses a key as the window receives it, shot(name) keeps a picture, and
// say(what, value) reports to the test.

module.exports = {
  // Opens, looks, and says what it sees.
  async look(k) {
    await k.wait(800);
    await k.shot('look');
    k.say('focused', await k.focused());
    k.say('title', await k.js('document.title'));
  },

  // Keys and focus: each command reaches the surface that has the keyboard,
  // once, and the terminals get only what is typed into them.
  async keys(k) {
    const { js, key, menu, until, wait, say, termText, typeTerm, focused } = k;
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    const prompt = (i) => until(async () => /[%#$] *$/m.test(await termText(i)), 'a prompt in terminal ' + i);
    await prompt(0);

    // The keys the menu gives each command.
    const want = [
      [['File', 'Go to File…'], 'CmdOrCtrl+P'], [['File', 'Switch Folder…'], 'CmdOrCtrl+O'], [['File', 'New Terminal'], 'CmdOrCtrl+T'],
      [['File', 'Save'], 'CmdOrCtrl+S'], [['File', 'Close Tab'], 'CmdOrCtrl+W'], [['Edit', 'Select All'], 'CmdOrCtrl+A'],
      [['Go', 'Find…'], 'CmdOrCtrl+F'], [['Go', 'Find Next'], 'CmdOrCtrl+G'], [['Go', 'Find Previous'], 'CmdOrCtrl+Shift+G'],
      [['Go', 'Find in Folder…'], 'CmdOrCtrl+Shift+F'], [['Go', 'Back'], 'CmdOrCtrl+['], [['View', 'Preview'], 'CmdOrCtrl+Alt+P'],
      [['View', 'Reload Preview'], 'CmdOrCtrl+R'], [['View', 'Terminal'], 'CmdOrCtrl+J'], [['View', 'Next Terminal'], 'Ctrl+`'],
      [['View', 'Clear Terminal'], 'CmdOrCtrl+K'],
    ];
    for (const [labels, accel] of want) check(k.item(...labels).accelerator === accel, labels.join(' › ') + ' is ' + accel);
    // No item reloads the window.
    const roles = [];
    const walk = (items) => items.forEach((i) => { if (i.role) roles.push(i.role); if (i.submenu) walk(i.submenu.items); });
    walk(require('electron').Menu.getApplicationMenu().items);
    check(!roles.some((r) => /reload/i.test(r)), 'no reload role');

    // A palette opened from the terminal gives the keyboard back to it.
    await js('activeTerm().term.focus(); true');
    await menu('File', 'Go to File…');
    await until(() => js('!$("palette").hidden'), 'the palette');
    check((await focused()) === 'palette-input', 'palette has the keyboard');
    await key('Escape');
    await until(() => js('$("palette").hidden'), 'the palette to close');
    check((await focused()) === 'xterm-helper-textarea', 'back in the terminal after Esc, not ' + (await focused()));
    say('palette-returns-to-terminal', true);

    // What is typed goes to the chosen terminal's shell.
    await typeTerm('echo KEYS-$((6*7))\r');
    await until(async () => (await termText()).includes('KEYS-42'), 'the shell to answer').catch(async (e) => {
      say('terminal-shows', await termText());
      throw e;
    });

    // ⌘K clears the terminal only while it has the keyboard.
    await js('focusMiddle(); true');
    await menu('View', 'Clear Terminal');
    await wait(200);
    check((await termText()).includes('KEYS-42'), '⌘K in the middle left the terminal alone');
    await js('activeTerm().term.focus(); true');
    await menu('View', 'Clear Terminal');
    await until(async () => !(await termText()).includes('KEYS-42'), '⌘K in the terminal to clear it');
    say('clear-follows-keyboard', true);

    // ⌘W closes a middle tab only while the keyboard is not in the terminal.
    await js('openLinked("README.md")');
    await until(() => js('state.tabs.length === 2'), 'a file tab');
    await js('activeTerm().term.focus(); true');
    await menu('File', 'Close Tab');
    check(await js('state.tabs.length === 2'), '⌘W in the terminal closed nothing');
    check((await focused()) === 'xterm-helper-textarea', 'still in the terminal');
    await js('focusMiddle(); true');
    await menu('File', 'Close Tab');
    await until(() => js('state.tabs.length === 1'), '⌘W in the middle to close the tab');
    say('close-follows-keyboard', true);

    // Select All in the terminal selects its output, not the window.
    await js('activeTerm().term.focus(); true');
    await typeTerm('echo SELECT-ME\r');
    await until(async () => (await termText()).includes('SELECT-ME'), 'output');
    await menu('Edit', 'Select All');
    check(await js('activeTerm().term.hasSelection() && activeTerm().term.getSelection().includes("SELECT-ME")'), 'the terminal selected its text');
    check(await js('String(getSelection()) === ""'), 'the window selected nothing');
    await js('activeTerm().term.clearSelection(); true');

    // A second terminal gets its own typing; switching sends nothing across.
    await menu('File', 'New Terminal');
    await until(() => js('terms.length === 2 && activeTerm() === terms[1]'), 'a second terminal');
    await prompt(1);
    check((await focused()) === 'xterm-helper-textarea', 'the new terminal has the keyboard');
    await typeTerm('echo SECOND-ONE\r');
    await until(async () => (await termText(1)).includes('SECOND-ONE'), 'the second to answer');
    await menu('View', 'Next Terminal');
    check(await js('activeTerm() === terms[0]'), 'Next Terminal chose the first');
    await typeTerm('echo FIRST-AGAIN\r');
    await until(async () => (await termText(0)).includes('FIRST-AGAIN'), 'the first to answer');
    check(!(await termText(0)).includes('SECOND-ONE') && !(await termText(1)).includes('FIRST-AGAIN'), 'no typing crossed terminals');
    say('terminals-apart', true);

    // Naming a terminal: the keys go to the name, and the name stays while a program runs.
    await js('document.querySelector(".term-tab.on .term-name").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); true');
    check((await focused()) === 'term-rename mono', 'the name box has the keyboard');
    await k.type('ser');
    // Output in another terminal redraws the bar; the name box stays.
    await js('drawTermBar(); true');
    await k.wait(1400);
    await k.type('ver');
    await key('Return');
    await until(() => js('activeTerm().name === "server"'), 'the name').catch(async (e) => {
      say('rename-after', await js('[activeTerm().name, document.querySelector(".term-rename")?.value ?? null, document.activeElement?.className]'));
      throw e;
    });
    check(!(await termText(0)).includes('server'), 'the name was not typed into the shell');
    await typeTerm('sleep 30\r');
    await until(() => js('activeTerm().run.program === "sleep"'), 'sleep to run');
    check(await js('document.querySelector(".term-tab.on .term-name").textContent === "server"'), 'the tab keeps its name');
    const strip = await js('$("strip").textContent');
    check(/sleep\s+running/.test(strip) && !/none/.test(strip), 'the strip says sleep is running: ' + strip);
    say('strip', strip);
    await k.shot('keys-terminals');

    // Typing into the preview's address box reaches no terminal.
    await menu('View', 'Preview');
    await until(() => js('document.activeElement?.id === "preview-address"'), 'the address box');
    await k.type('localhost:9');
    check(await js('$("preview-address").value === "localhost:9"'), 'the address was typed');
    check(!(await termText(0)).includes('localhost:9') && !(await termText(1)).includes('localhost:9'), 'no terminal got the address');
    await menu('Edit', 'Select All');
    check(await js('$("preview-address").selectionStart === 0 && $("preview-address").selectionEnd === 11'), 'Select All in the address box selects the address');
    await key('Escape');
    check(await js('$("preview-address").value === ""'), 'Esc put the address back');
    // ⌘K here does not clear a terminal either.
    await menu('View', 'Clear Terminal');
    check((await termText(0)).includes('FIRST-AGAIN'), 'the terminal kept its text');

    // Find in a file, then Esc: the keyboard goes back to the file.
    await js('openLinked("README.md")');
    await until(() => js('state.openFile === "README.md" && !!document.querySelector("#file-body article")'), 'README');
    await menu('Go', 'Find…');
    check((await focused()) === 'find-input', 'the find box has the keyboard');
    await k.type('Hello');
    await until(() => js('$("find-count").textContent === "1 of 1"'), 'a match');
    await key('Escape');
    check(await js('$("find").hidden'), 'Esc closed the find bar');
    check((await focused()) === 'file-body', 'the keyboard is back in the file');
    say('find-in-file', true);
    // Close the terminals so no sleep is left.
    await js('window.__answers.push(true); closeTerminal(terms[0])');
    await until(() => js('terms.length === 1'), 'one terminal left');
  },

  // The preview: a page served here, found in, the keyboard handed back to
  // it, a certificate trusted only when asked, and the browser only on a click.
  async preview(k) {
    const { js, key, menu, until, wait, say, termText, focused } = k;
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    const http = require('node:http');
    const https = require('node:https');
    const fs = require('node:fs');
    const preview = require('./preview');
    const page = '<!doctype html><title>Fixture page</title><h1>Tide table</h1><p>alpha one</p><p>beta</p><p>alpha two</p><input id="q">';
    const server = http.createServer((_req, res) => res.end(page));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    const focusCalls = [];
    const realFocus = preview.focus;
    preview.focus = () => {
      focusCalls.push(Date.now());
      realFocus();
    };
    try {
      await js(`openPreview(${JSON.stringify(url)})`);
      await until(() => js('state.preview.live && !state.preview.loading && state.preview.title === "Fixture page"'), 'the page to load');
      await wait(300);
      await k.shot('preview-loaded');

      // Find, on the preview tab, finds in the page.
      await menu('Go', 'Find…');
      check((await focused()) === 'find-input', 'the find box has the keyboard');
      check(await js('$("find-input").placeholder === "Find in the page"'), 'it says it finds in the page');
      await k.type('alpha');
      await until(() => js('$("find-count").textContent === "1 of 2"'), '1 of 2');
      await key('Return');
      await until(() => js('$("find-count").textContent === "2 of 2"'), 'Return to go to 2 of 2');
      await menu('Go', 'Find Previous');
      await until(() => js('$("find-count").textContent === "1 of 2"'), '⇧⌘G back to 1 of 2');
      await k.shot('preview-find');
      await js('$("find-input").select(); true');
      await k.type('zzz');
      await until(() => js('$("find-count").textContent === "not found"'), 'not found');
      const before = focusCalls.length;
      await key('Escape');
      check(await js('$("find").hidden'), 'Esc closed the find bar');
      await until(() => focusCalls.length > before, 'the keyboard handed back to the page');
      say('preview-find', true);

      // A palette opened while the page has the keyboard gives it back.
      const realFocused = preview.focused;
      preview.focused = () => true; // as when the page has the keyboard
      await menu('File', 'Go to File…');
      preview.focused = realFocused;
      await until(() => js('!$("palette").hidden'), 'the palette');
      check(await js('keyboardIn() === "palette"'), 'the palette has the keyboard');
      const n = focusCalls.length;
      await key('Escape');
      await until(() => focusCalls.length > n, 'the keyboard back to the page after Esc');
      say('palette-returns-to-page', true);

      // Reload reloads only the page, and only on the preview tab.
      await menu('View', 'Reload Preview');
      await until(() => js('!state.preview.loading && state.preview.title === "Fixture page"'), 'the reload');

      // The page keeps its place while I look at a file, and find there finds in the file.
      await js('openLinked("README.md")');
      await until(() => js('state.openFile === "README.md"'), 'README');
      await menu('Go', 'Find…');
      check(await js('$("find-input").placeholder === "Find in what is shown"'), 'find is back to the file');
      await key('Escape');
      await menu('View', 'Preview');
      await until(() => js('currentTab() === "preview" && state.preview.live'), 'the page again, still loaded');

      // Open in browser only when clicked, and only that address.
      k.edge.expect.openExternal = 1;
      await js('$("preview-external").click(); true');
      await until(() => k.edge.calls.some((c) => c.label === 'openExternal'), 'the browser to be asked');
      check(k.edge.calls.find((c) => c.label === 'openExternal').args[0] === url, 'the browser got the page address');
      say('external', true);
    } finally {
      server.close();
    }

    // https with a certificate the server made itself: refused and said so,
    // trusted only when asked, for that address and certificate.
    const certDir = process.env.DRIVE_CERTS;
    if (certDir) {
      const opts = (n) => ({ key: fs.readFileSync(certDir + '/key' + n + '.pem'), cert: fs.readFileSync(certDir + '/cert' + n + '.pem') });
      let secure = https.createServer(opts(1), (_q, r) => r.end('<title>Secure page</title><p>secure</p>'));
      await new Promise((r) => secure.listen(0, '127.0.0.1', r));
      const port = secure.address().port;
      const surl = 'https://127.0.0.1:' + port + '/';
      try {
        await js(`openPreview(${JSON.stringify(surl)})`);
        await until(() => js('!!state.preview.certificate && !!state.preview.error'), 'the certificate to be refused');
        check(await js('state.preview.title !== "Secure page"'), 'the page did not load');
        check(await js('document.querySelector(".preview-empty")?.textContent.includes("does not trust")'), 'the window says why');
        await k.shot('preview-certificate');
        say('certificate-refused', true);
        await js('trustCertificate()');
        await until(() => js('state.preview.title === "Secure page" && !state.preview.error'), 'the page, once trusted');
        say('certificate-trusted', true);
        // Another certificate at the same address is not trusted.
        secure.close();
        secure = https.createServer(opts(2), (_q, r) => r.end('<title>Other page</title>'));
        await new Promise((r) => secure.listen(port, '127.0.0.1', r));
        await js(`openPreview(${JSON.stringify(surl)})`);
        await until(() => js('!!state.preview.certificate && !!state.preview.error'), 'a new certificate to be refused');
        check(await js('state.preview.title !== "Other page"'), 'the other certificate was not trusted');
        say('other-certificate-refused', true);
      } finally {
        secure.close();
      }
    }
    await js('closeTab("preview"); true');
  },

  // The browser opened without the scenario expecting it must fail the run.
  async unexpectedExternal(k) {
    const http = require('node:http');
    const server = http.createServer((_q, r) => r.end('<title>x</title>'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    await k.js(`openPreview("http://127.0.0.1:${server.address().port}/")`);
    await k.until(() => k.js('state.preview.live && !state.preview.loading'), 'the page');
    await k.js('$("preview-external").click(); true');
    await k.wait(1000);
    server.close();
  },

  // Paths a terminal prints: a relative one opens directly only when one
  // file fits; printed from a subshell somewhere else, with the same name
  // here, the click asks which.
  async links(k) {
    const { js, key, until, wait, say, termText, typeTerm } = k;
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    await until(async () => /[%#$] *$/m.test(await termText()), 'a prompt');
    await js('activeTerm().term.focus(); true');
    // Linked rows: find the row holding text, and ask for its links.
    const linksOn = (text) => js(`(async () => {
      const t = activeTerm(); const b = t.term.buffer.active; let row = -1;
      for (let y = b.length - 1; y >= 0; y--) if (b.getLine(y).translateToString(true).trim() === ${JSON.stringify(text)}) { row = y; break; }
      if (row < 0) return null;
      const links = await termLinks(t, row + 1);
      window.__links = links;
      return links.map((l) => ({ text: l.text, tip: l.tip }));
    })()`);

    // Printed from a subshell in a/: notes.md here is not the file meant.
    await typeTerm('(cd a && ls notes.md)\r');
    await until(async () => (await termText()).split('\n').some((l) => l.trim() === 'notes.md'), 'the subshell output');
    await wait(1500); // the shell is looked at after Return
    let found = await linksOn('notes.md');
    check(found && found.length === 1, 'one link on the line: ' + JSON.stringify(found));
    check(/choose: 2 files here are named notes\.md/.test(found[0].tip), 'it says there is a choice: ' + found[0].tip);
    say('ambiguous-tip', found[0].tip);
    // A click without ⌘ does nothing; with ⌘ it asks, and opens nothing yet.
    await js('__links[0].activate({ metaKey: false }); true');
    check(await js('$("palette").hidden'), 'a plain click asks nothing');
    await js('__links[0].activate({ metaKey: true }); true');
    await until(() => js('!$("palette").hidden'), 'the choice');
    const rows = await js('[...document.querySelectorAll(".palette-row")].map((r) => r.textContent)');
    check(rows.length === 2 && rows[0].startsWith('notes.md') && /where the shell was/.test(rows[0]) && rows[1].startsWith('a/notes.md'), 'both files offered: ' + JSON.stringify(rows));
    check(await js('state.openFile !== "notes.md" && state.openFile !== "a/notes.md"'), 'nothing opened before choosing');
    await wait(500);
    await k.shot('links-choose');
    await key('Down');
    await key('Return');
    await until(() => js('state.openFile === "a/notes.md"'), 'the file chosen to open');
    check((await k.focused()) === 'xterm-helper-textarea', 'the keyboard went back to the terminal');
    say('ambiguous-choice', true);

    // Esc from the choice opens nothing and goes back to the terminal.
    await js('__links[0].activate({ metaKey: true }); true');
    await until(() => js('!$("palette").hidden'), 'the choice again');
    await key('Escape');
    check(await js('$("palette").hidden && state.openFile === "a/notes.md"'), 'Esc opened nothing');
    check((await k.focused()) === 'xterm-helper-textarea', 'back in the terminal');

    // A name only one file here has opens directly, read from where the shell was.
    await typeTerm('echo only-here.md\r');
    await until(async () => (await termText()).split('\n').some((l) => l.trim() === 'only-here.md'), 'output');
    await wait(1500);
    found = await linksOn('only-here.md');
    check(found && found.length === 1 && /^⌘-click to open only-here\.md/.test(found[0].tip) && /the only one here/.test(found[0].tip), 'a direct link: ' + JSON.stringify(found));
    await js('__links[0].activate({ metaKey: true }); true');
    await until(() => js('state.openFile === "only-here.md"'), 'it to open directly');
    check(await js('$("palette").hidden'), 'no choice asked');
    say('unique-direct', true);

    // A full path opens directly, whatever the shell's folder.
    const full = '~/project/a/notes.md:2';
    await typeTerm("echo '" + full + "'\r");
    await until(async () => (await termText()).includes(full + '\n') || (await termText()).split('\n').some((l) => l.trim() === full), 'output');
    await wait(1500);
    found = await linksOn(full);
    check(found && found.length === 1 && /^⌘-click to open a\/notes\.md, line 2/.test(found[0].tip), 'a full path links directly: ' + JSON.stringify(found) + ' ' + JSON.stringify(await js(`window.disk.where(${JSON.stringify(full.replace(/:2$/, ''))}, null)`)) + ' root ' + (await js('state.root')));
    say('full-direct', true);

    // After the shell moved during a command, where it printed from is not
    // known: a name one file has asks before opening.
    // The window follows the chosen terminal into a/.
    await typeTerm('cd a; echo notes.md\r');
    await until(() => js('state.root.endsWith("/project/a")'), 'the window to follow into a');
    await wait(800);
    found = await js(`(async () => {
      const t = activeTerm(); const b = t.term.buffer.active; let row = -1;
      for (let y = b.length - 1; y >= 0; y--) if (b.getLine(y).translateToString(true).trim() === 'notes.md') { row = y; break; }
      const links = await termLinks(t, row + 1); window.__links = links; return links.map((l) => l.tip);
    })()`);
    check(found.length === 1 && /not known/.test(found[0]), 'asks when the folder is not known: ' + JSON.stringify(found));
    await js('__links[0].activate({ metaKey: true }); true');
    await until(() => js('!$("palette").hidden'), 'a question before opening');
    await key('Escape');
    say('unknown-folder-asks', true);
    await typeTerm('cd ..\r');
  },

  // Build map types into a terminal only where it is certain which one is
  // meant, and never presses Return.
  async buildMap(k) {
    const { js, key, until, wait, say, termText, typeTerm } = k;
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    const prompt = (i) => until(async () => /[%#$] *$/m.test(await termText(i)), 'a prompt in ' + i);
    await prompt(0);
    // A dev server-like program in the only terminal: Build map asks, and Esc types nothing.
    await js('activeTerm().term.focus(); true');
    await typeTerm('sleep 60\r');
    await until(() => js('terms[0].run.program === "sleep"'), 'sleep');
    await js('askForMap()');
    await until(() => js('!$("palette").hidden'), 'a choice');
    check(/No claude or codex/.test(await js('$("palette-input").placeholder')), 'it says no agent was found');
    await key('Escape');
    await wait(300);
    check(!(await termText(0)).includes('map.json'), 'nothing typed into sleep');
    say('no-agent-asks', true);

    // Two terminals running claude, and a plain shell chosen: it asks which.
    const agent = k.dir + '/bin/claude';
    for (const i of [1, 2]) {
      await js('newTerminal().then(() => true)');
      await until(() => js('terms.length === ' + (i + 1)), 'terminal ' + i);
      await prompt(i);
      await typeTerm(agent + '\r');
      await until(() => js('terms[' + i + '].run.agent === "claude"'), 'claude in ' + i);
    }
    await js('newTerminal().then(() => true)');
    await until(() => js('terms.length === 4'), 'a plain shell');
    await prompt(3);
    await js('askForMap()');
    await until(() => js('!$("palette").hidden'), 'a choice of terminals');
    const rows = await js('[...document.querySelectorAll(".palette-row")].map((r) => r.textContent)');
    check(rows.length === 2 && rows.every((r) => r.includes('claude')), 'the two claude terminals: ' + JSON.stringify(rows));
    await wait(500);
    await k.shot('buildmap-choose');
    await key('Down');
    await key('Return');
    await until(() => js('activeTerm() === terms[2]'), 'the second claude chosen and shown');
    await until(async () => (await termText(2)).includes('map.json'), 'the request typed', 20000);
    await wait(500);
    const t2 = await termText(2);
    // cat repeats a line only after Return; the request shows once, as typed.
    check(t2.split('map.json').length === t2.split('map.json').length && !/\n.*Build|\n.*map\.json[\s\S]*\n[\s\S]*map\.json[\s\S]*map\.json/.test(''), 'typed');
    const typedOnce = (t2.match(/for invader/g) || []).length;
    check(typedOnce === 1, 'typed once and not sent (cat echoes only after Return): ' + typedOnce);
    check(!(await termText(1)).includes('map.json') && !(await termText(0)).includes('map.json') && !(await termText(3)).includes('map.json'), 'no other terminal got it');
    say('two-agents-asks', true);

    // With claude in the chosen terminal, it goes there without asking.
    await js('chooseTerm(terms[1]); true');
    await js('askForMap()');
    await wait(300);
    check(await js('$("palette").hidden'), 'no question');
    await until(async () => (await termText(1)).includes('for invader'), 'typed into the chosen claude', 20000);
    say('chosen-agent-direct', true);
    // Leave nothing running.
    for (let i = 0; i < 4; i++) await js('window.__answers.push(true); closeTerminal(terms[terms.length - 1])');
    await until(() => js('terms.length === 0'), 'every terminal closed');
  },

  // A command copied from a chat with what it printed, pasted into the shell:
  // the window asks, nothing reaches the shell until I choose, the command
  // alone goes on the line, and it runs only when I press Return.
  async paste(k) {
    const { js, key, until, wait, say, termText } = k;
    const fs = require('node:fs');
    const path = require('node:path');
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    const made = path.join(k.dir, 'pasted.txt');
    await js('activeTerm().term.focus(); true');
    await until(async () => /[%#$] *$/m.test(await termText()), 'a prompt');
    const before = await termText();
    await js(`(() => { const d = new DataTransfer(); d.setData('text/plain', ${JSON.stringify('$ touch pasted.txt\ncreated pasted.txt\n')}); activeTerm().term.textarea.dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true, cancelable: true })); return true; })()`);
    await until(() => js('!document.getElementById("paste-ask").hidden'), 'the paste question');
    say('paste-warning', await js(`(() => { const a = document.getElementById('paste-ask'); return { said: a.querySelector('.paste-said').textContent, about: a.querySelector('.muted')?.textContent || '', lines: a.querySelector('.paste-lines').textContent, buttons: [...a.querySelectorAll('button')].map((b) => b.textContent) }; })()`));
    await wait(500);
    check((await termText()) === before && !fs.existsSync(made), 'nothing reached the shell while it asks');
    await js('[...document.querySelectorAll("#paste-ask button")].find((b) => b.textContent === "Paste only the command").click(); true');
    await until(async () => /touch pasted\.txt *$/m.test(await termText()), 'the command on the line');
    await wait(500);
    check(!fs.existsSync(made), 'nothing ran before Return');
    check(!(await termText()).includes('created pasted.txt'), 'what it printed was not pasted');
    say('pasted-without-running', true);
    await key('Return');
    await until(() => fs.existsSync(made), 'the command to run after Return');
    say('ran-on-return', true);
    // End the shell and wait for it, as quitting does, so node-pty does not
    // call back while the app exits.
    await require('./shell').closeAll();
  },

  // An unsaved Markdown edit, kept for recovery; a quit cancelled with it
  // and a program running; a Save and Quit that fails; then a real quit.
  async draftEdit(k) {
    const { js, key, until, wait, say, termText, typeTerm } = k;
    const fs = require('node:fs');
    const path = require('node:path');
    const shell = require('./shell');
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    // A long file, read down to line 150.
    await js('openLinked("long.txt")');
    await until(() => js('state.openFile === "long.txt" && !!document.querySelector(".code")'), 'long.txt');
    await js('goToLine({ line: 150 }); true');
    await wait(300);
    // The edit.
    await js('openLinked("notes.md")');
    await until(() => js('state.openFile === "notes.md" && !!document.querySelector(".switch")'), 'notes.md');
    await js('[...document.querySelectorAll(".switch button")].find((b) => b.textContent === "Edit").click(); true');
    await until(() => js('!!document.querySelector("#file-body textarea:not([readonly])")'), 'the editor');
    await js('(() => { const e = document.querySelector("#file-body textarea"); e.focus(); const n = e.value.indexOf("Original line.") + "Original line.".length; e.setSelectionRange(n, n); return true; })()');
    await k.type(' Added by hand.');
    await until(() => js('document.querySelector(".edit-status").textContent === "not saved · kept"'), 'the edit to be kept');
    const store = path.join(k.data, 'drafts');
    const records = fs.readdirSync(store).filter((n) => n.endsWith('.json'));
    check(records.length === 1 && JSON.parse(fs.readFileSync(path.join(store, records[0]), 'utf8')).text.includes('Original line. Added by hand.'), 'one record holds the edit');
    check(!fs.readFileSync(path.join(k.dir, 'notes.md'), 'utf8').includes('Added'), 'the file itself is untouched');
    say('kept', true);
    await k.shot('draft-kept');
    // Away and back: the edit is still there.
    await js('openLinked("other.md")');
    await until(() => js('state.openFile === "other.md"'), 'other.md');
    check(await js('document.querySelector(".tab.draft")?.textContent.startsWith("notes.md")'), 'the tab shows it has an edit');
    await js('openLinked("notes.md")');
    await until(() => js('(document.querySelector("#file-body textarea")?.value || "").includes("Added by hand.")'), 'the edit on coming back');
    // A program running, and a preview address that is not served.
    await js('activeTerm().term.focus(); true');
    await until(async () => /[%#$] *$/m.test(await termText()), 'a prompt');
    await typeTerm('sleep 4711\r');
    await until(() => js('activeTerm().run.program === "sleep"'), 'sleep to run');
    await js('openPreview("http://127.0.0.1:9/")');
    await until(() => js('!!state.preview.error'), 'the preview to say nothing answered');
    await js('openLinked("notes.md")');
    await until(() => js('state.openFile === "notes.md"'), 'notes.md again');

    // Quit, and Cancel: everything stays.
    k.edge.dialogs.push({ match: 'notes\\.md is kept by next-invader[\\s\\S]*ends sleep running in a terminal', button: 'Cancel' });
    k.win.close();
    await until(() => k.edge.dialogs.length === 0, 'the question');
    await wait(800);
    check(!k.win.isDestroyed(), 'the window is still open');
    check(shell.list().some((t) => t.program === 'sleep'), 'sleep still runs');
    check(await js('(document.querySelector("#file-body textarea")?.value || "").includes("Added by hand.")'), 'the edit is still there');
    say('cancel-kept-everything', true);

    // Save and Quit when the file cannot be written: nothing quits or ends.
    fs.chmodSync(path.join(k.dir, 'notes.md'), 0o444);
    k.edge.dialogs.push({ button: 'Save and Quit' }, { match: 'did not quit[\\s\\S]*notes\\.md', button: 'OK' });
    k.win.close();
    await until(() => k.edge.dialogs.length === 0, 'both questions');
    await wait(800);
    fs.chmodSync(path.join(k.dir, 'notes.md'), 0o644);
    check(!k.win.isDestroyed(), 'still open after a failed save');
    check(shell.list().some((t) => t.program === 'sleep'), 'sleep still runs after a failed save');
    check(await js('isDraft("notes.md")'), 'the edit is still unsaved');
    check(await js('/was not saved/.test(document.querySelector(".edit-bar")?.textContent || "")'), 'the window says it was not saved');
    check(fs.readdirSync(store).filter((n) => n.endsWith('.json')).length === 1, 'the kept copy is still there');
    say('failed-save-kept-everything', true);
    await k.shot('draft-save-failed');

    // Quit for real.
    k.edge.dialogs.push({ button: 'Quit' });
    return () => k.win.close();
  },

  // Back after the quit: the edit, the places and the preview address, and
  // nothing started. Then the file changes on disk, the edit is dropped by
  // choice, and a second edit is kept just before the app is stopped hard.
  async draftRecover(k) {
    const { js, until, wait, say, termText, typeTerm } = k;
    const fs = require('node:fs');
    const path = require('node:path');
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    await until(() => js('state.openFile === "notes.md" && !!document.querySelector("#file-body textarea")'), 'notes.md, where I left off');
    check(await js('document.querySelector("#file-body textarea").value.includes("Original line. Added by hand.")'), 'the edit came back');
    check(await js('/^Recovered/.test(document.querySelector(".edit-bar")?.textContent || "")'), 'it says it was recovered');
    check(await js('document.querySelector(".edit-status").textContent === "not saved · kept"'), 'and not saved');
    check(!fs.readFileSync(path.join(k.dir, 'notes.md'), 'utf8').includes('Added'), 'the file is still untouched');
    check(await js('state.tabs.includes("file:long.txt") && state.tabs.includes("preview")'), 'the tabs came back');
    check(await js('state.preview.url === "http://127.0.0.1:9/" && !state.preview.live'), 'the preview address came back, not loaded');
    check(await js('terms.length === 1 && !activeTerm().run.program'), 'one new shell, nothing running');
    await k.shot('draft-recovered');
    say('recovered', true);
    // Where I was reading.
    await js('tabOf("file:long.txt")[1]()');
    await until(() => js('state.openFile === "long.txt" && !!document.querySelector(".code")'), 'long.txt');
    await wait(300);
    const line = await js('topLine(document.querySelector(".code"), $("file-body"))');
    check(line > 100 && line < 160, 'long.txt opens near line 150, not ' + line);
    say('place', line);
    // The file changes on disk under the edit.
    await js('openLinked("notes.md")');
    await until(() => js('state.openFile === "notes.md"'), 'notes.md');
    fs.writeFileSync(path.join(k.dir, 'notes.md'), '# Notes\n\nChanged by the agent.\n');
    await until(() => js('/changed on disk since your unsaved edit was kept/.test(document.querySelector(".edit-bar")?.textContent || "")'), 'the change to show');
    check(await js('document.querySelector("#file-body textarea").value.includes("Added by hand.")'), 'the edit is still there');
    await k.shot('draft-changed-on-disk');
    say('external-change-shown', true);
    // Dropped by choice: the kept copy goes too.
    await js('window.__answers.push(true); [...document.querySelectorAll(".edit-bar button")].find((b) => b.textContent === "Load the disk version").click(); true');
    await until(() => js('!isDraft("notes.md")'), 'the edit dropped');
    const store = path.join(k.data, 'drafts');
    await until(() => fs.readdirSync(store).filter((n) => n.endsWith('.json')).length === 0, 'the kept copy to go');
    say('discard-cleared', true);
    // A second edit, kept, then the app is stopped hard.
    await js('openLinked("other.md")');
    await until(() => js('state.openFile === "other.md" && !!document.querySelector(".switch")'), 'other.md');
    await js('[...document.querySelectorAll(".switch button")].find((b) => b.textContent === "Edit")?.click(); true');
    await until(() => js('!!document.querySelector("#file-body textarea")'), 'other.md in the editor');
    await js('(() => { const e = document.querySelector("#file-body textarea"); e.focus(); e.setSelectionRange(e.value.length, e.value.length); return true; })()');
    await k.type('Typed before the crash.');
    await until(() => js('document.querySelector(".edit-status").textContent === "not saved · kept"'), 'the second edit kept');
    await js('activeTerm().term.focus(); true');
    await until(async () => /[%#$] *$/m.test(await termText()), 'a prompt');
    await typeTerm('sleep 4712\r');
    await until(() => js('activeTerm().run.program === "sleep"'), 'sleep to run');
    say('ready-to-crash', true);
    await wait(60000);
  },

  // After the hard stop: the edit kept before it is back; the one dropped
  // stays dropped; a file gone keeps its edit readable until I discard it.
  async draftAfterCrash(k) {
    const { js, until, say } = k;
    const fs = require('node:fs');
    const path = require('node:path');
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    await until(() => js('isDraft("other.md")'), 'the edit kept before the crash');
    check(!(await js('isDraft("notes.md")')), 'the dropped edit stays dropped');
    await js('openLinked("other.md")');
    await until(() => js('(document.querySelector("#file-body textarea")?.value || "").includes("Typed before the crash.")'), 'its text');
    say('recovered-after-crash', true);
    // The file goes: the edit stays, to read and copy.
    fs.unlinkSync(path.join(k.dir, 'other.md'));
    await until(() => js('/not there any more/.test(document.querySelector(".edit-bar")?.textContent || "")'), 'it to say the file is gone');
    check(await js('document.querySelector("#file-body textarea").value.includes("Typed before the crash.")'), 'the text is still there');
    await k.shot('draft-file-gone');
    say('missing-file-kept', true);
    await js('window.__answers.push(true); [...document.querySelectorAll(".edit-bar button")].find((b) => b.textContent === "Discard the edit").click(); true');
    await until(() => js('!isDraft("other.md")'), 'dropped');
    await until(() => fs.readdirSync(path.join(k.data, 'drafts')).filter((n) => n.endsWith('.json')).length === 0, 'the kept copy to go');
    // Nothing to lose and nothing running: it quits without asking.
    return () => k.win.close();
  },

  // Going back and forth between folders, terminals and the preview many
  // times: nothing piles up, nothing is left running, and a narrow window
  // still fits.
  async switching(k) {
    const { js, until, wait, say, termText, typeTerm, menu } = k;
    const shell = require('./shell');
    const preview = require('./preview');
    const http = require('node:http');
    const path = require('node:path');
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    const other = path.join(path.dirname(k.dir), 'second');
    const server = http.createServer((_q, r) => r.end('<title>Switch page</title><p>page</p>'));
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const url = 'http://127.0.0.1:' + server.address().port + '/';
    try {
      await until(async () => /[%#$] *$/m.test(await termText()), 'a prompt');
      await js('newTerminal().then(() => true)');
      await until(async () => /[%#$] *$/m.test(await termText(1)), 'a second prompt');
      for (let round = 0; round < 3; round++) {
        // To the other folder by cd in the chosen terminal, and back.
        await js('chooseTerm(terms[0]); true');
        await typeTerm('cd ' + other + '\r');
        await until(() => js(`state.root === ${JSON.stringify(other)} && state.info?.root === ${JSON.stringify(other)}`), 'the window in the second folder');
        await js(`openPreview(${JSON.stringify(url)})`);
        await until(() => js('state.preview.live && state.preview.title === "Switch page"'), 'the page');
        await menu('View', 'Next Terminal');
        await menu('View', 'Previous Terminal');
        await js('openLinked("README.md")');
        await until(() => js('state.openFile === "README.md"'), 'README in the second folder');
        await typeTerm('cd ' + k.dir + '\r');
        await until(() => js(`state.root === ${JSON.stringify(k.dir)}`), 'the window back');
        // The page belonged to the other folder and closed with it; its address waits there.
        check(await js('!state.preview.live'), 'the page closed with its folder');
        check(!preview.contents(), 'no page left behind');
      }
      // Back in the second folder, its tabs and the preview address came back, unloaded.
      await typeTerm('cd ' + other + '\r');
      await until(() => js(`state.root === ${JSON.stringify(other)}`), 'the second folder again');
      await until(() => js('state.tabs.includes("preview") && state.tabs.includes("file:README.md")'), 'its tabs');
      check(await js(`state.preview.url === ${JSON.stringify(url)} && !state.preview.live`), 'its preview address, waiting for Load');
      await typeTerm('cd ' + k.dir + '\r');
      await until(() => js(`state.root === ${JSON.stringify(k.dir)}`), 'back again');
      check(shell.list().length === 2 && (await js('terms.length')) === 2, 'still two terminals, each once');
      check((await js('document.querySelectorAll(".term-box").length')) === 2, 'one box per terminal');
      check(k.win.contentView.children.length === 0, 'no page view left in the window');
      say('switching', true);

      // A narrow window: the panes give way, nothing spills sideways.
      await js(`openPreview(${JSON.stringify(url)})`);
      await until(() => js('state.preview.live && !state.preview.loading'), 'the page');
      await js('terms[0].name = "a terminal with a long name that should not push things around"; drawTermBar(); true');
      k.win.setSize(760, 560);
      await wait(600);
      const spill = await js(`(() => {
        const out = [];
        for (const id of ['file-head', 'tabbar', 'term-bar', 'strip']) { const n = document.getElementById(id); if (n && n.scrollWidth > n.clientWidth + 1 && getComputedStyle(n).overflowX !== 'auto' && getComputedStyle(n).overflowX !== 'scroll' && getComputedStyle(n).overflowX !== 'hidden') out.push(id); }
        if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push('page');
        const head = document.getElementById('file-head').getBoundingClientRect();
        const ext = document.getElementById('preview-external')?.getBoundingClientRect();
        if (ext && ext.right > head.right + 1) out.push('preview-external clipped');
        const tabs = document.getElementById('term-tabs').getBoundingClientRect();
        const on = document.querySelector('.term-tab.on').getBoundingClientRect();
        if (on.left < tabs.left - 1 || on.right > tabs.right + 1) out.push('the chosen terminal tab is out of view');
        const mid = document.getElementById('file').getBoundingClientRect().width;
        return { out, mid, header: document.querySelector('header').scrollWidth - document.querySelector('header').clientWidth };
      })()`);
      say('narrow', spill);
      await k.shot('narrow-preview');
      check(!spill.out.length, 'nothing spills at 760 wide: ' + JSON.stringify(spill));
      check(spill.mid >= 300, 'the middle keeps room: ' + spill.mid);
      k.win.setSize(1400, 900);
      await wait(300);
      await js('window.__answers.push(true); closeTerminal(terms[1])');
      await until(() => js('terms.length === 1'), 'one terminal');
      check(shell.list().length === 1, 'its shell ended');
    } finally {
      server.close();
    }
  },

  // The daily loop in one go, with pictures: two terminals, a server started
  // in one, its page in the preview and found in, a Markdown edit. Used for
  // the pictures in a handoff; each step is checked as it goes.
  async tour(k) {
    const { js, key, until, wait, say, termText, typeTerm, menu } = k;
    const check = (ok, what) => {
      if (!ok) throw new Error('Not as expected: ' + what);
    };
    k.win.setSize(1500, 900);
    await wait(400);
    await until(async () => /[%#$] *$/m.test(await termText()), 'a prompt');
    await js('newTerminal().then(() => true)');
    await until(async () => /[%#$] *$/m.test(await termText(1)), 'a second prompt');
    await js('document.querySelector(".term-tab.on .term-name").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); true');
    await k.type('server');
    await key('Return');
    await typeTerm('python3 -m http.server 8765 --bind 127.0.0.1\r');
    await until(async () => (await termText(1)).includes('Serving HTTP'), 'the server', 20000);
    await menu('View', 'Preview');
    await until(() => js('document.activeElement?.id === "preview-address"'), 'the address box');
    await k.type('8765');
    await key('Return');
    await until(() => js('state.preview.live && !state.preview.loading && state.preview.title === "Tide clock"'), 'the page');
    await menu('Go', 'Find…');
    await k.type('tide');
    await until(() => js('/of/.test($("find-count").textContent)'), 'found in the page');
    await wait(1500);
    await k.shot('tour-preview-find');
    say('find', await js('$("find-count").textContent'));
    await key('Escape');
    await js('chooseTerm(terms[0]); true');
    await js('openLinked("notes/ideas.md")');
    await until(() => js('state.openFile === "notes/ideas.md" && !!document.querySelector(".switch")'), 'ideas.md');
    await js('[...document.querySelectorAll(".switch button")].find((b) => b.textContent === "Edit").click(); true');
    await until(() => js('!!document.querySelector("#file-body textarea")'), 'the editor');
    await js('(() => { const e = document.querySelector("#file-body textarea"); e.focus(); e.setSelectionRange(e.value.length, e.value.length); return true; })()');
    await k.type('- Show the next high tide in the page title.');
    await until(() => js('document.querySelector(".edit-status").textContent === "not saved · kept"'), 'kept');
    await k.shot('tour-edit');
    await js('showRoot()');
    await until(() => js('!!document.querySelector(".map-canvas .map-lines path")'), 'the map drawn');
    await wait(800);
    await k.shot('tour-map');
    // The headings line up; a short group's boxes sit in the middle of the tall one's.
    const at = await js(`(() => {
      const cols = [...document.querySelectorAll('.map-canvas .map-group')];
      const span = (col) => { const b = [...col.querySelectorAll('.map-box')].map((n) => n.getBoundingClientRect()); return [b[0].top, b.at(-1).bottom]; };
      const heads = cols.map((c) => c.querySelector('.map-group-label').getBoundingClientRect().top);
      const [t0, b0] = span(cols[0]); const [t1, b1] = span(cols[1]);
      const pane = document.getElementById('file-body').getBoundingClientRect();
      const canvas = document.querySelector('.map-canvas').getBoundingClientRect();
      return { heads, tall: (t0 + b0) / 2, short: (t1 + b1) / 2, left: canvas.left - pane.left, right: pane.right - canvas.right };
    })()`);
    say('map-layout', at);
    check(at.heads.every((h) => Math.abs(h - at.heads[0]) < 1), 'the headings line up');
    check(Math.abs(at.tall - at.short) < 2, 'the short group sits in the middle: ' + JSON.stringify(at));
    check(Math.abs(at.left - at.right) < 24, 'the map sits in the middle of the pane: ' + JSON.stringify(at));
    // Stop the server, as I would: ⌃C in its terminal.
    await js('chooseTerm(terms[1]); true');
    await key('c', ['control']);
    await until(async () => /[%#$] *$/m.test(await termText(1)), 'the server to stop');
    k.edge.dialogs.push({ button: 'Quit' });
    return () => k.win.close();
  },
};
