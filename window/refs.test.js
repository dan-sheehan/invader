// Tests for reading file references in terminal output and Markdown links.
// Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { findRefs, linkTarget, reference } = require('./refs');

const refs = (text) => findRefs(text).map((r) => [r.path, r.line, r.col, text.slice(r.index, r.index + r.length)]);

test('paths with a line, and a column, as tools print them', () => {
  assert.deepEqual(refs('src/app.js:12'), [['src/app.js', 12, null, 'src/app.js:12']]);
  assert.deepEqual(refs('    at tick (/Users/me/p/src/clock.js:12:5)'), [['/Users/me/p/src/clock.js', 12, 5, '/Users/me/p/src/clock.js:12:5']]);
  assert.deepEqual(refs('error in ./lib/format.ts(3,7): bad'), [['./lib/format.ts', 3, 7, './lib/format.ts(3,7)']]);
  assert.deepEqual(refs('File "app/main.py", line 42, in <module>'), [['app/main.py', 42, null, 'app/main.py", line 42']]);
  assert.deepEqual(refs('README.md#L3'), [['README.md', 3, null, 'README.md#L3']]);
  assert.deepEqual(refs('~/kit/notes.md:9'), [['~/kit/notes.md', 9, null, '~/kit/notes.md:9']]);
});

test('a path with no line, inside other text', () => {
  assert.deepEqual(refs('⏺ Update(src/tides.js)'), [['src/tides.js', null, null, 'src/tides.js']]);
  assert.deepEqual(refs('see docs/guide.md.'), [['docs/guide.md', null, null, 'docs/guide.md']]);
  assert.deepEqual(refs('edited package.json and map.json'), [['package.json', null, null, 'package.json'], ['map.json', null, null, 'map.json']]);
});

test('web addresses, numbers, versions and plain words are not paths', () => {
  assert.deepEqual(refs('https://example.com/a/b.js:3'), []);
  assert.deepEqual(refs('see http://localhost:3000/index.html now'), []);
  assert.deepEqual(refs('version 1.2.3 took 4.5s'), []);
  assert.deepEqual(refs('hello world, nothing here'), []);
  assert.deepEqual(refs('// a comment'), []);
});

test('the path starts at a word boundary, so a:b and x/y:1 are read whole', () => {
  // Anything that looks like a path is only a candidate: main says whether
  // it is really in the open folder, and it is a link only then.
  assert.deepEqual(refs('a/src/x.js b/src/x.js').map((r) => r[0]), ['a/src/x.js', 'b/src/x.js']);
  assert.deepEqual(refs('foo:bar/baz.js:2').map((r) => r[0]), []);
});

test('a Markdown link leads from the document holding it', () => {
  assert.deepEqual(linkTarget('../README.md#setup', 'docs/guide.md', '/r'), { path: 'README.md', section: 'setup', line: null });
  assert.deepEqual(linkTarget('guide.md', 'docs/index.md', '/r'), { path: 'docs/guide.md', section: null, line: null });
  assert.deepEqual(linkTarget('./a%20b.md', 'x/y.md', '/r'), { path: 'x/a b.md', section: null, line: null });
  assert.deepEqual(linkTarget('src/app.js#L12', 'README.md', '/r'), { path: 'src/app.js', section: null, line: 12 });
  assert.deepEqual(linkTarget('/r/src/app.js', 'README.md', '/r'), { path: 'src/app.js', section: null, line: null });
});

test('a link never steps out of the open folder or the kit, and web links stay text', () => {
  assert.equal(linkTarget('../../x.md', 'docs/guide.md', '/r'), null);
  assert.equal(linkTarget('../x.md', 'README.md', '/r'), null);
  assert.equal(linkTarget('/etc/passwd', 'README.md', '/r'), null);
  assert.equal(linkTarget('/rother/x.md', 'README.md', '/r'), null);
  assert.equal(linkTarget('https://example.com/x.md', 'README.md', '/r'), null);
  assert.equal(linkTarget('mailto:me@example.com', 'README.md', '/r'), null);
  assert.equal(linkTarget('#section', 'README.md', '/r'), null);
  assert.deepEqual(linkTarget('../y.md', '~/kit/n/a.md', '/r'), { path: '~/kit/y.md', section: null, line: null });
  assert.equal(linkTarget('../../y.md', '~/kit/a.md', '/r'), null);
});

test('a document from outside the folder and the kit has no relative links', () => {
  assert.equal(linkTarget('x.md', null, '/r'), null);
});

test('a reference names the lines when there are some', () => {
  assert.equal(reference('src/app.js'), 'src/app.js');
  assert.equal(reference('src/app.js', 12), 'src/app.js:12');
  assert.equal(reference('src/app.js', 12, 12), 'src/app.js:12');
  assert.equal(reference('src/app.js', 12, 18), 'src/app.js:12-18');
});

const { findLocalUrls } = require('./refs');
const { admit } = require('../main/address');

test('addresses on this computer in terminal output are found, and nothing else', () => {
  const line = '  ➜  Local:   http://localhost:5173/  Network: http://192.168.1.4:5173/ docs at https://vite.dev.';
  assert.deepEqual(findLocalUrls(line).map((u) => u.url), ['http://localhost:5173/']);
  assert.deepEqual(findLocalUrls('ready at http://127.0.0.1:3000.').map((u) => u.url), ['http://127.0.0.1:3000/']);
  assert.deepEqual(findLocalUrls('(see http://[::1]:8080/app)').map((u) => u.url), ['http://[::1]:8080/app']);
  assert.deepEqual(findLocalUrls('"http://user:pw@localhost:3000/" file:///etc/hosts ftp://localhost/ http://0.0.0.0:3000'), []);
  const [u] = findLocalUrls('open http://localhost:4000/a?b=1, then');
  assert.equal(u.index, 5);
  assert.equal(u.length, 'http://localhost:4000/a?b=1'.length);
});

test('every address offered to the preview from the terminal is one main admits', () => {
  const text = 'http://localhost:1/ https://app.localhost:2/x http://127.9.9.9:3 http://[::1]:4/ http://2130706433/ http://example.com/ http://localhost.evil.com/';
  for (const u of findLocalUrls(text)) assert.ok(admit(u.url).ok, u.url);
  assert.equal(findLocalUrls(text).length, 5);
});

test('a relative path printed in a terminal could mean every file here with that name', () => {
  const { refCandidates } = require('./refs');
  const files = [
    { path: 'notes.md', dir: false },
    { path: 'a', dir: true },
    { path: 'a/notes.md', dir: false },
    { path: 'a/b/notes.md', dir: false },
    { path: 'mynotes.md', dir: false },
    { path: 'src', dir: true },
    { path: 'src/app.js', dir: false },
    { path: '~/kit/notes.md', dir: false },
  ];
  assert.deepEqual(refCandidates('notes.md', files), ['notes.md', 'a/notes.md', 'a/b/notes.md', '~/kit/notes.md']);
  assert.deepEqual(refCandidates('./a/notes.md', files), ['a/notes.md']);
  assert.deepEqual(refCandidates('b/notes.md', files), ['a/b/notes.md']);
  assert.deepEqual(refCandidates('src/', files), ['src']);
  assert.deepEqual(refCandidates('app.js', files), ['src/app.js']);
  assert.deepEqual(refCandidates('other.md', files), []);
  // A step up, or a full path, is not matched by name.
  assert.equal(refCandidates('../notes.md', files), null);
  assert.equal(refCandidates('a/../notes.md', files), null);
  assert.equal(refCandidates('/notes.md', files), null);
  assert.equal(refCandidates('~/kit/notes.md', files), null);
});
