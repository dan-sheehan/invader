// Tests for what the app remembers between runs. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { clean, isTab, opened, forget, load, save, MAX_RECENT } = require('./memory');

test('an old state.json holding only the last folder still opens it', () => {
  const mem = clean({ folder: '/Users/me/project' });
  assert.equal(mem.folder, '/Users/me/project');
  assert.deepEqual(mem.recent, []);
  assert.deepEqual(mem.layout, { left: 260, right: 460, termHidden: false, zoom: 0 });
  assert.equal(mem.window, null);
});

test('anything damaged or of the wrong kind is dropped, not trusted', () => {
  const mem = clean({
    folder: 'relative/path',
    recent: ['/a', 5, '/a', 'b', null],
    window: { width: 'wide', height: 900 },
    layout: { left: 99999, right: -5, termHidden: 'yes', zoom: 40 },
    folders: { 'not-absolute': { tabs: ['home'] }, '/a': { tabs: ['file:../../etc/passwd', 'file:/etc/hosts', 'file:src/a.js', 'nonsense', 'setup'], active: 'file:../x', expanded: ['src', '../up', '/abs'] } },
  });
  assert.equal(mem.folder, null);
  assert.deepEqual(mem.recent, ['/a']);
  assert.equal(mem.window, null);
  assert.deepEqual(mem.layout, { left: 800, right: 240, termHidden: false, zoom: 5 });
  assert.deepEqual(Object.keys(mem.folders), ['/a']);
  assert.deepEqual(mem.folders['/a'], { tabs: ['home', 'file:src/a.js', 'setup'], active: 'home', expanded: ['src'] });
  assert.deepEqual(clean('not an object').recent, []);
});

test('a path holding a control character is never kept, since switching folder types it into the terminal', () => {
  const mem = clean({ folder: '/tmp/a\x03touch x #', recent: ['/ok', '/tmp/a\x03touch x #', '/tmp/b\nrm', '/tmp/c\x7f'], folders: { '/ok': { tabs: ['home', 'file:a\x1bb.md'] } } });
  assert.equal(mem.folder, null);
  assert.deepEqual(mem.recent, ['/ok']);
  assert.deepEqual(mem.folders['/ok'].tabs, ['home']);
});

test('tabs are only the kinds the window opens, inside the folder or the kit', () => {
  for (const ok of ['home', 'setup', 'changes', 'file:README.md', 'folder:src/deep', 'file:~/kit/notes.md', 'file:src/map.json']) assert.ok(isTab(ok), ok);
  for (const bad of ['file:', 'file:/etc/hosts', 'file:a/../../b', 'folder:~/other/x', 'file:./a', 'outside', 42]) assert.ok(!isTab(bad), String(bad));
});

test('opening a folder puts it first in the recent list, once, and keeps the list short', () => {
  let mem = clean({});
  for (let i = 0; i < MAX_RECENT + 3; i++) mem = opened(mem, '/p' + i);
  mem = opened(mem, '/p5');
  assert.equal(mem.recent[0], '/p5');
  assert.equal(mem.recent.length, MAX_RECENT);
  assert.equal(new Set(mem.recent).size, MAX_RECENT);
  assert.equal(mem.folder, '/p5');
});

test('a folder that falls off the recent list, or is forgotten, loses its tabs too', () => {
  let mem = clean({ recent: ['/old'], folders: { '/old': { tabs: ['home', 'file:a.md'] } } });
  for (let i = 0; i < MAX_RECENT; i++) mem = opened(mem, '/p' + i);
  assert.equal(mem.folders['/old'], undefined);
  mem = clean({ recent: ['/a', '/b'], folders: { '/a': { tabs: ['home'] } } });
  mem = forget(mem, '/a');
  assert.deepEqual(mem.recent, ['/b']);
  assert.equal(mem.folders['/a'], undefined);
});

test('state.json is written whole and read back; a missing or broken one reads as empty', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invader-memory-'));
  try {
    const file = path.join(dir, 'state.json');
    assert.deepEqual((await load(file)).recent, []);
    const mem = opened(clean({}), '/a');
    mem.folders['/a'] = { tabs: ['home', 'file:x.md'], active: 'file:x.md', expanded: ['docs'] };
    await save(file, mem);
    assert.deepEqual(await load(file), clean(mem));
    assert.ok(!fs.existsSync(file + '.tmp'));
    fs.writeFileSync(file, '{ broken');
    assert.deepEqual((await load(file)).recent, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the preview address is kept only when the preview could show it', () => {
  const ws = (preview, tabs = ['home', 'preview']) => clean({ folders: { '/a': { tabs, active: 'preview', preview } } }).folders['/a'];
  assert.deepEqual(ws({ url: 'http://localhost:5173' }).preview, { url: 'http://localhost:5173/' });
  assert.deepEqual(ws({ url: 'http://localhost:5173' }).tabs, ['home', 'preview']);
  assert.equal(ws({ url: 'http://localhost:5173' }).active, 'preview');
  for (const bad of ['https://example.com/', 'file:///etc/hosts', 'javascript:alert(1)', 'http://u:p@localhost/', 42, null]) {
    assert.equal(ws({ url: bad }).preview, undefined, String(bad));
  }
  assert.equal(ws('http://localhost:3000').preview, undefined);
  assert.equal(ws(undefined).preview, undefined);
});

test('a state.json from before the preview and several terminals still loads as it was', () => {
  const mem = clean({ folder: '/a', recent: ['/a'], folders: { '/a': { tabs: ['home', 'file:README.md'], active: 'file:README.md', expanded: ['src'] } } });
  assert.deepEqual(mem.folders['/a'], { tabs: ['home', 'file:README.md'], active: 'file:README.md', expanded: ['src'] });
  assert.equal(isTab('preview'), true);
  assert.equal(isTab('preview:http://localhost'), false);
});

test('each tab keeps where I was reading, checked; an older state.json without places still loads', () => {
  const old = clean({ folders: { '/a': { tabs: ['home', 'file:README.md'], active: 'file:README.md', expanded: [] } } });
  assert.equal(old.folders['/a'].places, undefined);
  const mem = clean({ folders: { '/a': {
    tabs: ['home', 'file:README.md', 'file:src/a.js'],
    active: 'file:src/a.js',
    expanded: [],
    places: {
      'file:README.md': { top: 1200.4, caret: [30, 12] },
      'file:src/a.js': { top: 50, line: 200 },
      'file:gone.js': { top: 5 },
      home: { top: 'far' },
      __proto__: { top: 1 },
      'file:../x': { top: 1 },
    },
  } } });
  assert.deepEqual(mem.folders['/a'].places, {
    'file:README.md': { top: 1200, caret: [12, 30] },
    'file:src/a.js': { top: 50, line: 200 },
  });
  // Nothing but numbers comes through, and never for a tab not kept.
  const odd = clean({ folders: { '/a': { tabs: ['home'], places: { home: { top: -5, line: 'x', caret: [1] }, 'file:a': { top: 1 } } } } });
  assert.deepEqual(odd.folders['/a'].places, { home: { top: 0 } });
  assert.equal(clean({ folders: { '/a': { tabs: ['home'], places: ['x'] } } }).folders['/a'].places, undefined);
});
