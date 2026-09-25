// Tests for the map checks. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { checkMap, locate } = require('./map');

const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// A throwaway folder: { 'a/b.md': 'text', 'link': { symlink: '/elsewhere' } }.
function folder(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'invader-test-')));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    if (content && content.symlink) fs.symlinkSync(content.symlink, abs);
    else if (content === null) fs.mkdirSync(abs, { recursive: true });
    else fs.writeFileSync(abs, content);
  }
  return root;
}

const check = (root, map, at = 'map.json') => checkMap(root, at, JSON.stringify(map));

const box = (id, ...paths) => ({ id, label: id, paths });
const reasons = (res) => res.dropped.map((d) => d.name + ': ' + d.reason);

test('a file that is not JSON is refused whole', async () => {
  const res = await checkMap(folder({}), 'map.json', '{ nope');
  assert.match(res.error, /^Not valid JSON/);
});

test('groups are required', async () => {
  const res = await check(folder({}), { arrows: [] });
  assert.equal(res.error, '"groups" must be a list.');
});

test('a box id used twice is a shape error', async () => {
  const root = folder({ 'a.md': '' });
  const res = await check(root, { groups: [{ label: 'G', boxes: [box('x', 'a.md'), box('x', 'a.md')] }] });
  assert.equal(res.error, 'Box id "x" is used twice.');
});

test('boxes whose paths exist are kept, others dropped with the reason', async () => {
  const root = folder({ 'a.md': '', 'src/x.js': '' });
  const res = await check(root, {
    groups: [{ label: 'G', boxes: [box('a', 'a.md', 'src/'), box('gone', 'b.md'), box('slash', 'a.md/')] }],
  });
  assert.deepEqual(res.groups[0].boxes.map((b) => b.id), ['a']);
  assert.deepEqual(res.groups[0].boxes[0].paths.map((p) => [p.rel, p.dir]), [['a.md', false], ['src', true]]);
  assert.deepEqual(reasons(res), ['gone: b.md does not exist', 'slash: a.md/ is not a folder']);
});

test('a path that climbs out of the open folder is dropped', async () => {
  const root = folder({ 'a.md': '' });
  const res = await check(root, { groups: [{ label: 'G', boxes: [box('up', '../a.md')] }] });
  assert.deepEqual(reasons(res), ['up: ../a.md is outside the open folder']);
});

test('a symlink that leads outside the open folder is dropped', async () => {
  const outside = folder({ 'secret.md': 'the text' });
  const root = folder({
    'a.md': '',
    'out': { symlink: outside },
    'secret.md': { symlink: path.join(outside, 'secret.md') },
  });
  const res = await check(root, {
    groups: [{ label: 'G', boxes: [box('a', 'a.md'), box('dir', 'out/'), box('file', 'secret.md')] }],
    arrows: [{ from: 'a', to: 'a', label: 'reads', file: 'out/secret.md', text: 'the text' }],
  });
  assert.deepEqual(reasons(res), [
    'dir: out/ is outside the open folder',
    'file: secret.md is outside the open folder',
    'a → a: out/secret.md is outside the open folder',
  ]);
});

test('a symlink that stays inside the open folder holds', async () => {
  const root = folder({ 'real/a.md': 'hello', 'alias': { symlink: 'real' } });
  const res = await check(root, {
    groups: [{ label: 'G', boxes: [box('a', 'alias/a.md')] }],
    arrows: [{ from: 'a', to: 'a', label: 'says', file: 'alias/a.md', text: 'hello' }],
  });
  assert.deepEqual(reasons(res), []);
  assert.equal(res.arrows[0].rel, 'alias/a.md');
});

test('arrows hold only when both boxes, the file and the text hold', async () => {
  const root = folder({ 'a.md': 'Read and follow [B](b.md)', 'b.md': '' });
  const res = await check(root, {
    groups: [{ label: 'G', boxes: [box('a', 'a.md'), box('b', 'b.md'), box('gone', 'c.md')] }],
    arrows: [
      { from: 'a', to: 'b', label: 'sends to', file: 'a.md', text: 'Read and follow [B](b.md)' },
      { from: 'a', to: 'b', label: 'quotes', file: 'a.md', text: 'not in the file' },
      { from: 'a', to: 'gone', label: 'x', file: 'a.md', text: 'Read' },
      { from: 'a', to: 'nobody', label: 'x', file: 'a.md', text: 'Read' },
      { from: 'a', to: 'b', label: 'x', file: 'missing.md', text: 'Read' },
    ],
  });
  assert.deepEqual(res.arrows.map((a) => a.label), ['sends to']);
  assert.deepEqual(reasons(res).slice(1), [
    'a → b: text not found in a.md',
    'a → gone: box "gone" was dropped',
    'a → nobody: no box has id "nobody"',
    'a → b: missing.md does not exist',
  ]);
});

test('paths in a map are relative to the folder the map sits in', async () => {
  const root = folder({ 'sub/map.json': '', 'sub/a.md': 'x', 'top.md': '' });
  const res = await check(root, { groups: [{ label: 'G', boxes: [box('a', 'a.md'), box('top', '../top.md')] }] }, 'sub/map.json');
  assert.deepEqual(res.groups[0].boxes.map((b) => b.paths[0].rel), ['sub/a.md', 'top.md']);
});

test('locate follows symlinks and reports where a path leads', async () => {
  const outside = folder({ 'x.md': '' });
  const root = folder({ 'a.md': '', 'out': { symlink: outside } });
  assert.deepEqual(await locate(root, '', 'a.md'), { rel: 'a.md', real: path.join(root, 'a.md'), dir: false });
  assert.equal((await locate(root, '', '')).rel, '');
  assert.equal((await locate(root, '', 'out/x.md')).problem, 'outside');
  assert.equal((await locate(root, '', '../x')).problem, 'outside');
  assert.equal((await locate(root, '', 'nope.md')).problem, 'missing');
});
