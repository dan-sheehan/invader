// Tests for reading the open folder. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { listDir, readFile, saveMarkdown, listFiles, where, refToRel } = require('./disk');

const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function folder(files) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'invader-disk-')));
  made.push(root);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

const nested = (levels) => Array.from({ length: levels }, (_, i) => '  '.repeat(i) + '- level ' + i).join('\n');

test('Markdown is sent as tokens', async () => {
  const res = await readFile(folder({ 'a.md': '# Hi\n\ntext' }), 'a.md');
  assert.equal(res.markdown, true);
  assert.equal(res.tokens[0].type, 'heading');
  assert.equal(res.note, null);
});

test('Markdown nested too deeply for the window is sent as plain text, still editable', async () => {
  const root = folder({ 'deep.md': nested(400), 'fine.md': nested(40) });
  const deep = await readFile(root, 'deep.md');
  assert.equal(deep.tokens, null);
  assert.equal(deep.markdown, true);
  assert.match(deep.note, /Nested too deeply/);
  assert.ok((await readFile(root, 'fine.md')).tokens);
});

test('a hand edit is saved to its file and read back', async () => {
  const root = folder({ 'notes/a.md': 'one' });
  const res = await saveMarkdown(root, 'notes/a.md', 'mine', 'one');
  assert.equal(fs.readFileSync(path.join(root, 'notes/a.md'), 'utf8'), 'mine');
  assert.equal(res.path, 'notes/a.md');
  assert.equal(res.text, 'mine');
});

test('only Markdown files are saved', async () => {
  const root = folder({ 'a.txt': 'one' });
  await assert.rejects(saveMarkdown(root, 'a.txt', 'mine', 'one'), /Only Markdown/);
  assert.equal(fs.readFileSync(path.join(root, 'a.txt'), 'utf8'), 'one');
});

test('a hand edit is not saved over a change made on disk meanwhile', async () => {
  const root = folder({ 'a.md': 'one' });
  fs.writeFileSync(path.join(root, 'a.md'), 'two');
  await assert.rejects(saveMarkdown(root, 'a.md', 'mine', 'one'), /Changed on disk/);
  assert.equal(fs.readFileSync(path.join(root, 'a.md'), 'utf8'), 'two');
});

test('nothing outside the open folder can be read', async () => {
  const root = folder({ 'a.md': 'x' });
  await assert.rejects(readFile(root, '../outside.md'), /outside the open folder/);
});

test('the tree leaves out Finder\'s .DS_Store and nothing else', async () => {
  const root = folder({ '.DS_Store': 'x', 'docs/.DS_Store': 'x', 'docs/a.md': 'a', '.env.example': 'x' });
  assert.deepEqual((await listDir(root, '')).map((i) => i.name), ['docs', '.env.example']);
  assert.deepEqual((await listDir(root, 'docs')).map((i) => i.name), ['a.md']);
});

test('every file and folder is listed by path for going to one by name, without .git and node_modules', async () => {
  const root = folder({ 'a.md': 'a', 'src/b.js': 'b', 'src/deep/c.js': 'c', '.git/HEAD': 'x', 'node_modules/m/i.js': 'm', '.DS_Store': 'f' });
  const { files, more } = await listFiles(root, { withKit: false });
  assert.deepEqual(files.map((f) => f.path + (f.dir ? '/' : '')).sort(), ['a.md', 'src/', 'src/b.js', 'src/deep/', 'src/deep/c.js']);
  assert.equal(more, false);
});

test('a symlinked folder is listed but not walked into, so nothing outside is named', async () => {
  const outside = folder({ 'secret.txt': 's' });
  const root = folder({ 'a.md': 'a' });
  fs.symlinkSync(outside, path.join(root, 'link'));
  const { files } = await listFiles(root, { withKit: false });
  assert.ok(files.some((f) => f.path === 'link'));
  assert.ok(!files.some((f) => f.path.includes('secret')));
});

test('a file over 2 MB shows its first 2 MB, whole lines only, to read only', async () => {
  const line = 'x'.repeat(99) + '\n';
  const root = folder({ 'big.log': line.repeat(30000), 'big.md': '# Big\n' + line.repeat(30000) });
  const res = await readFile(root, 'big.log');
  assert.equal(res.partial, true);
  assert.equal(res.size, 3000000);
  assert.ok(res.text.length <= 2 * 1024 * 1024);
  assert.ok(res.text.endsWith('\n'));
  assert.equal(res.text.length % 100, 0);
  const md = await readFile(root, 'big.md');
  assert.equal(md.partial, true);
  assert.equal(md.markdown, false);
  assert.equal(md.tokens, null);
  await assert.rejects(saveMarkdown(root, 'big.md', 'x', md.text), /Changed on disk/);
});

test('a path from the terminal is found in the open folder, however it is written', async () => {
  const root = folder({ 'src/app.js': 'a', 'README.md': 'b' });
  assert.deepEqual(await where(root, 'src/app.js'), { rel: 'src/app.js', dir: false });
  assert.deepEqual(await where(root, './src/../src/app.js'), { rel: 'src/app.js', dir: false });
  assert.deepEqual(await where(root, path.join(root, 'README.md')), { rel: 'README.md', dir: false });
  assert.deepEqual(await where(root, 'src'), { rel: 'src', dir: true });
});

test('a path from the terminal that leads outside the open folder, or nowhere, is refused', async () => {
  const outside = folder({ 'secret.txt': 's' });
  const root = folder({ 'a.txt': 'a' });
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(root, 'escape.txt'));
  fs.symlinkSync(outside, path.join(root, 'escape'));
  await assert.rejects(where(root, '../' + path.basename(outside) + '/secret.txt'), /Not in the open folder/);
  await assert.rejects(where(root, path.join(outside, 'secret.txt')), /Not in the open folder/);
  await assert.rejects(where(root, '/etc/hosts'), /Not in the open folder/);
  await assert.rejects(where(root, 'escape.txt'), /outside/);
  await assert.rejects(where(root, 'escape/secret.txt'), /outside/);
  await assert.rejects(where(root, 'missing.js'), /Not found/);
  await assert.rejects(where(root, 'a.txt\u001b[2J'), /Not in the open folder/);
  await assert.rejects(where(root, ''), /Not in the open folder/);
});

test('a full path that reaches the open folder another way counts, after following links', async () => {
  const root = folder({ 'a.txt': 'a' });
  const alias = fs.mkdtempSync(path.join(os.tmpdir(), 'invader-alias-'));
  made.push(alias);
  fs.symlinkSync(root, path.join(alias, 'here'));
  assert.deepEqual(await where(root, path.join(alias, 'here', 'a.txt')), { rel: 'a.txt', dir: false });
});

test('a path in the kit is named ~/kit/..., and only its own files count', () => {
  const home = '/home/me';
  assert.equal(refToRel('/p', home, '~/kit/notes.md'), '~/kit/notes.md');
  assert.equal(refToRel('/p', home, '/home/me/kit/a/b.md'), '~/kit/a/b.md');
  assert.equal(refToRel('/p', home, '~/kit'), '~/kit');
  assert.equal(refToRel('/p', home, '~/kitchen/x.md'), null);
  assert.equal(refToRel('/p', home, '~/.ssh/id_rsa'), null);
  assert.equal(refToRel('/p', home, '/pother/x'), null);
  assert.equal(refToRel('/p', home, 'x/../../y'), null);
});

test('a relative path is read from the folder of the terminal that printed it, never the open folder by default', async () => {
  const root = folder({ 'README.md': 'root', 'src/app.js': 'a', 'src/README.md': 'src' });
  const other = folder({ 'README.md': 'other' });
  // Printed in src: README.md there is src/README.md, not the open folder's.
  assert.deepEqual(await where(root, 'README.md', path.join(root, 'src')), { rel: 'src/README.md', dir: false });
  assert.deepEqual(await where(root, '../README.md', path.join(root, 'src')), { rel: 'README.md', dir: false });
  // Printed by a terminal in another project: its README.md is not this one.
  await assert.rejects(where(root, 'README.md', other), /Not in the open folder/);
  // With no folder known for it, a relative path leads nowhere; a full one still does.
  await assert.rejects(where(root, 'README.md', null), /Not in the open folder/);
  await assert.rejects(where(root, 'README.md', 'relative/base'), /Not in the open folder/);
  assert.deepEqual(await where(root, path.join(root, 'src/app.js'), null), { rel: 'src/app.js', dir: false });
});
