// Tests for finding text in the open folder. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { searchText, stop, matchText, preview, MAX_MATCHES, MAX_PER_FILE } = require('./search');

const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function folder(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'invader-search-')));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

test('each line that matches, with its number, column and where the matches are', () => {
  const { matches, more } = matchText('one\nfind me, find me\r\nnone\nFIND', 'find', false);
  assert.equal(more, 0);
  assert.deepEqual(matches.map((m) => [m.line, m.col, m.text]), [[2, 1, 'find me, find me'], [4, 1, 'FIND']]);
  assert.deepEqual(matches[0].hits, [[0, 4], [9, 13]]);
  assert.equal(matchText('FIND', 'find', true).matches.length, 0);
});

test('a long line is cut around the match, and leading spaces are left off', () => {
  const line = 'a'.repeat(300) + 'needle' + 'b'.repeat(300);
  const p = preview(line, [300], 6);
  assert.ok(p.text.length <= 162);
  assert.ok(p.text.startsWith('…') && p.text.endsWith('…'));
  assert.equal(p.text.slice(p.hits[0][0], p.hits[0][1]), 'needle');
  const q = preview('      indented thing', [6], 8);
  assert.equal(q.text, 'indented thing');
  assert.deepEqual(q.hits, [[0, 8]]);
});

test('a file with many matching lines keeps the first ones and counts the rest', () => {
  const text = Array.from({ length: MAX_PER_FILE + 7 }, () => 'hit').join('\n');
  const { matches, more } = matchText(text, 'hit', false);
  assert.equal(matches.length, MAX_PER_FILE);
  assert.equal(more, 7);
});

test('searches the folder and says what it left out: tool folders, binary, large, links out', async () => {
  const outside = folder({ 'secret.txt': 'needle outside' });
  const root = folder({
    'a.js': 'const needle = 1;',
    'docs/b.md': 'no\nneedle here',
    'node_modules/x/index.js': 'needle',
    'dist/bundle.js': 'needle',
    '.git/HEAD': 'needle',
    'img.png': Buffer.from([0x89, 0x50, 0x00, 0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65]),
    'big.log': 'needle\n'.repeat(400000),
  });
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'link.txt'));
  fs.symlinkSync(outside, path.join(root, 'linked-folder'));
  fs.symlinkSync(path.join(root, 'a.js'), path.join(root, 'same.js'));
  const r = await searchText(root, 'needle');
  assert.equal(r.root, root);
  assert.deepEqual(r.files.map((f) => f.path), ['a.js', 'same.js', 'docs/b.md']);
  assert.equal(r.files[2].matches[0].line, 2);
  assert.deepEqual(r.skipped.dirs.sort(), ['.git/', 'dist/', 'node_modules/']);
  assert.equal(r.skipped.binary, 1);
  assert.deepEqual(r.skipped.large, ['big.log']);
  // The file link and the folder link both lead outside; neither is read.
  assert.equal(r.skipped.outside, 2);
  assert.ok(!JSON.stringify(r).includes('needle outside'));
});

test('stops at the most matches it shows, and says so', async () => {
  const files = {};
  for (let i = 0; i < 20; i++) files['f' + String(i).padStart(2, '0') + '.txt'] = 'x\n'.repeat(40);
  const root = folder(files);
  const r = await searchText(root, 'x');
  assert.equal(r.total, MAX_MATCHES);
  assert.equal(r.stopped, true);
});

test('what cannot be searched for is refused', async () => {
  const root = folder({ 'a.txt': 'a' });
  await assert.rejects(searchText(root, '   '), /Type something/);
  await assert.rejects(searchText(root, 'a\nb'), /one line/);
  await assert.rejects(searchText(root, 'x'.repeat(201)), /longer/);
});

// Many small files, so a search takes several turns of the event loop.
function slowFolder() {
  const files = {};
  for (let i = 0; i < 400; i++) files['d' + (i % 20) + '/f' + i + '.txt'] = 'text\n'.repeat(50) + 'needle\n';
  return folder(files);
}

test('a new search stops the one before it, which answers that it was stopped', async () => {
  const a = slowFolder();
  const b = folder({ 'b.txt': 'needle in b' });
  const first = searchText(a, 'needle');
  const second = searchText(b, 'needle');
  const [one, two] = await Promise.all([first, second]);
  assert.equal(one.cancelled, true);
  assert.equal(one.root, a);
  assert.equal(one.files, undefined);
  assert.equal(two.cancelled, false);
  assert.deepEqual(two.files.map((f) => f.path), ['b.txt']);
});

test('switching folder stops a search still running, so it never answers with old results', async () => {
  const a = slowFolder();
  const running = searchText(a, 'needle');
  // What main does when the open folder changes.
  await new Promise((resolve) => setImmediate(resolve));
  stop();
  const r = await running;
  assert.equal(r.cancelled, true);
  assert.equal(r.files, undefined);
  // A search after that runs whole.
  const again = await searchText(a, 'needle');
  assert.equal(again.cancelled, false);
  assert.equal(again.files.length, 400);
});
