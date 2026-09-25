// Tests for which session changed each changed file. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { whoseChanges } = require('./whose');

const older = { id: 'claude:a', editedAt: { 'a.js': 100, 'both.js': 300 } };
const newer = { id: 'codex:b', editedAt: { 'b.js': 200, 'both.js': 250 } };
const ids = (groups) => groups.map((g) => [g.session?.id ?? null, g.list.map(([p]) => p)]);

test('each changed file goes under the session that changed it, sessions in the order given, the rest last', () => {
  const list = [['a.js', 'changed'], ['b.js', 'new'], ['c.js', 'changed']];
  assert.deepEqual(ids(whoseChanges(list, [newer, older], 0)), [
    ['codex:b', ['b.js']],
    ['claude:a', ['a.js']],
    [null, ['c.js']],
  ]);
});

test('a file two sessions changed goes under the one that changed it last', () => {
  assert.deepEqual(ids(whoseChanges([['both.js', 'changed']], [newer, older], 0)), [['claude:a', ['both.js']]]);
});

test('a change a session made before the last commit, or before the folder was opened, does not count', () => {
  const list = [['a.js', 'changed'], ['both.js', 'changed']];
  assert.deepEqual(ids(whoseChanges(list, [newer, older], 150)), [['claude:a', ['both.js']], [null, ['a.js']]]);
  assert.deepEqual(ids(whoseChanges(list, [newer, older], 400)), [[null, ['a.js', 'both.js']]]);
});

test('with no sessions, or none that say when they changed a file, everything is the rest', () => {
  const list = [['a.js', 'changed']];
  assert.deepEqual(ids(whoseChanges(list, null, 0)), [[null, ['a.js']]]);
  assert.deepEqual(ids(whoseChanges(list, [{ id: 'x', edited: ['a.js'] }], 0)), [[null, ['a.js']]]);
  assert.deepEqual(whoseChanges([], [older], 0), []);
});
