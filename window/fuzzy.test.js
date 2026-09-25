// Tests for finding a file by typing part of its name. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { fuzzy, rank } = require('./fuzzy');

const paths = ['README.md', 'main/map.js', 'main/map.test.js', 'window/map-view.js', 'docs/plan.md', 'src/components/CartButton.tsx', 'main/main.js'];
const best = (q) => rank(q, paths, (p) => p).map((r) => r.item);

test('letters must all appear, in order', () => {
  assert.equal(fuzzy('xyz', 'main/map.js'), null);
  assert.equal(fuzzy('pam', 'map'), null);
  assert.ok(fuzzy('mmj', 'main/map.js'));
  assert.deepEqual(fuzzy('', 'anything'), { score: 0, hits: [] });
});

test('the file named is first, ahead of paths that only contain its letters', () => {
  assert.equal(best('map')[0], 'main/map.js');
  assert.equal(best('mapview')[0], 'window/map-view.js');
  assert.equal(best('readme')[0], 'README.md');
  assert.equal(best('plan')[0], 'docs/plan.md');
  assert.equal(best('main.js')[0], 'main/main.js');
});

test('the starts of words count, so initials find a file', () => {
  assert.equal(best('cb')[0], 'src/components/CartButton.tsx');
  assert.equal(best('mv')[0], 'window/map-view.js');
});

test('a folder in the query narrows by folder', () => {
  assert.equal(best('win map')[0], 'window/map-view.js');
  assert.equal(best('main/map')[0], 'main/map.js');
});

test('the places matched are given, to mark them', () => {
  const { hits } = fuzzy('plan', 'docs/plan.md');
  assert.deepEqual(hits, [5, 6, 7, 8]);
});
