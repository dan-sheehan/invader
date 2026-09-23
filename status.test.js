// Tests for what the status strip and the changed marks say. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { agentName, mapStatus, changeWithoutGit } = require('./status');

test('claude and codex are named, whatever else runs is not an agent', () => {
  assert.equal(agentName('2.1.280'), 'claude');
  assert.equal(agentName('claude'), 'claude');
  assert.equal(agentName('codex'), 'codex');
  assert.equal(agentName('vim'), null);
  assert.equal(agentName('node'), null);
  assert.equal(agentName('2.1'), null);
  assert.equal(agentName(null), null);
});

test('no map, and a map that cannot be read', () => {
  assert.equal(mapStatus(null).state, 'none');
  const bad = mapStatus({ error: 'Not valid JSON: oops' });
  assert.equal(bad.state, 'error');
  assert.match(bad.detail, /Not valid JSON: oops/);
});

test('a map where everything checks out counts boxes and arrows together', () => {
  const res = mapStatus({
    groups: [{ label: 'A', boxes: [{ id: 'a' }, { id: 'b' }] }, { label: 'B', boxes: [{ id: 'c' }] }],
    arrows: [{}, {}, {}],
    dropped: [],
  });
  assert.deepEqual([res.state, res.checked, res.total], ['ok', 6, 6]);
  assert.equal(res.detail, 'Boxes 3 of 3 and arrows 3 of 3 in map.json check out against the disk.');
});

test('what was dropped counts against the total', () => {
  const res = mapStatus({
    groups: [{ label: 'A', boxes: [{ id: 'a' }] }],
    arrows: [],
    dropped: [{ what: 'box' }, { what: 'arrow' }, { what: 'arrow' }],
  });
  assert.deepEqual([res.state, res.checked, res.total], ['dropped', 1, 4]);
  assert.equal(res.detail, 'Boxes 1 of 2 and arrows 0 of 2 in map.json check out against the disk.');
});

test('without Git, a file is new, changed or deleted against what was there at the start', () => {
  assert.equal(changeWithoutGit('file', 'file', true), 'changed');
  assert.equal(changeWithoutGit(undefined, 'file', true), 'new');
  assert.equal(changeWithoutGit('file', null, true), 'deleted');
});

test('without Git, folders and files that came and went are not listed', () => {
  assert.equal(changeWithoutGit(undefined, 'folder', true), null);
  assert.equal(changeWithoutGit('folder', 'folder', true), null);
  assert.equal(changeWithoutGit('folder', null, true), null);
  assert.equal(changeWithoutGit(undefined, null, true), null);
});

test('without Git, when the start was too big to list, nothing is called new', () => {
  assert.equal(changeWithoutGit(undefined, 'file', false), 'changed');
  assert.equal(changeWithoutGit(undefined, null, false), 'deleted');
});
