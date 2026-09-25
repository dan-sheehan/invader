// Tests for unsaved edits kept for recovery, and what quitting asks. Run
// with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { store, isDraftPath, quitQuestion, MAX_KEPT } = require('./drafts');

const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'invader-drafts-'));

test('an edit is kept for its folder and file, comes back, and goes only when dropped', async () => {
  const dir = fresh();
  const s = store(dir);
  const at = await s.keep('/p/one', 'notes.md', 'mine', 'theirs');
  assert.ok(at > 0);
  await s.keep('/p/two', 'notes.md', 'other folder', 'x');
  await s.keep('/p/one', '~/kit/me.md', 'kit edit', 'k');
  assert.deepEqual((await s.list('/p/one')).map((d) => [d.rel, d.text, d.from]).sort(), [['notes.md', 'mine', 'theirs'], ['~/kit/me.md', 'kit edit', 'k']]);
  // The kit's edits come back in every folder; a folder's only in its own.
  assert.deepEqual((await s.list('/p/two')).map((d) => d.text).sort(), ['kit edit', 'other folder']);
  assert.deepEqual(await s.counts(), { '/p/one': 1, '/p/two': 1 });
  // Kept again, the newest text wins.
  await s.keep('/p/one', 'notes.md', 'mine, later', 'theirs');
  assert.equal((await s.list('/p/one')).find((d) => d.rel === 'notes.md').text, 'mine, later');
  assert.equal(await s.drop('/p/one', 'notes.md'), true);
  assert.equal(await s.drop('/p/one', 'notes.md'), false);
  assert.deepEqual((await s.list('/p/one')).map((d) => d.rel), ['~/kit/me.md']);
  // Nothing half-written is left beside them.
  assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
  fs.rmSync(dir, { recursive: true });
});

test('only a Markdown file inside the folder or the kit is kept', async () => {
  const s = store(fresh());
  for (const rel of ['../x.md', '/etc/x.md', 'a/../../x.md', 'notes.txt', 'a\nb.md', '', '~/other/x.md', 'a/~/x.md']) {
    assert.equal(isDraftPath(rel), false, rel);
    await assert.rejects(s.keep('/p', rel, 't', 'f'));
  }
  assert.equal(isDraftPath('docs/a b.MD'), true);
  await assert.rejects(s.keep('/p', 'big.md', 'x'.repeat(2 * 1024 * 1024 + 1), ''), /2 MB/);
});

test('when the space is full a new edit is refused, and none kept is dropped to make room', async () => {
  const dir = fresh();
  const s = store(dir);
  for (let i = 0; i < MAX_KEPT; i++) await s.keep('/p', 'n' + i + '.md', 'text ' + i, '');
  await assert.rejects(s.keep('/p', 'one-more.md', 'lost?', ''), /full/);
  const kept = await s.list('/p');
  assert.equal(kept.length, MAX_KEPT);
  assert.ok(kept.some((d) => d.rel === 'n0.md'));
  // An edit already kept can still be kept again while full.
  await s.keep('/p', 'n0.md', 'changed', '');
  fs.rmSync(dir, { recursive: true });
});

test('a damaged or hand-made record is not trusted', async () => {
  const dir = fresh();
  const s = store(dir);
  await s.keep('/p', 'good.md', 'good', '');
  fs.writeFileSync(path.join(dir, 'a'.repeat(40) + '.json'), JSON.stringify({ v: 1, root: '/p', rel: '../../etc/x.md', text: 'bad', from: '' }));
  fs.writeFileSync(path.join(dir, 'b'.repeat(40) + '.json'), '{ not json');
  // A good record under another's name is not taken for it.
  fs.writeFileSync(path.join(dir, 'c'.repeat(40) + '.json'), JSON.stringify({ v: 1, root: '/p', rel: 'other.md', text: 'moved', from: '' }));
  assert.deepEqual((await s.list('/p')).map((d) => d.rel), ['good.md']);
  fs.rmSync(dir, { recursive: true });
});

test('writes to one file go in the order asked, so the last edit is the one kept', async () => {
  const dir = fresh();
  const s = store(dir);
  await Promise.all(Array.from({ length: 20 }, (_, i) => s.keep('/p', 'n.md', 'v' + i, '')));
  assert.equal((await s.list('/p'))[0].text, 'v19');
  await Promise.all([s.keep('/p', 'n.md', 'again', ''), s.drop('/p', 'n.md')]);
  assert.deepEqual(await s.list('/p'), []);
  fs.rmSync(dir, { recursive: true });
});

test('quitting asks once about edits and running programs, and says what is kept and what is not', () => {
  assert.equal(quitQuestion([], []), null);
  const running = quitQuestion([], ['claude', 'node', 'claude']);
  assert.deepEqual(running.buttons, ['Quit', 'Cancel']);
  assert.match(running.detail, /ends claude, node running in 3 terminals/);
  const both = quitQuestion([{ rel: 'a.md', kept: true }, { rel: 'b.md', kept: false, error: 'The space for unsaved edits is full.' }], ['claude']);
  assert.deepEqual(both.buttons, ['Save and Quit', 'Quit', 'Cancel']);
  assert.equal(both.cancelId, 2);
  assert.match(both.detail, /a\.md is kept by next-invader and comes back/);
  assert.match(both.detail, /b\.md is not kept for recovery \(The space for unsaved edits is full\), and is lost/);
  assert.match(both.detail, /ends claude running in a terminal/);
});
