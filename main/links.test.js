// Tests for finding links and paths that point at nothing. Run with
// `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { brokenLinks, pointsIn, linkPath } = require('./links');

const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function folder(files) {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'invader-links-')));
  made.push(top);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(top, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return top;
}

test('a Markdown file points to its links and to paths written out in its text and code', () => {
  const text = [
    'See [the guide](GUIDE.md#start) and ![icon](icon.png), and [web](https://example.com).',
    'My notes live in ~/notes/today.md, and old ones in `/Users/me/old` and /Users/me/old/.',
    '- [ref][r] in a list, with `~/kit`',
    '',
    '```bash',
    'cd ~/staging/app && ls',
    '```',
    '',
    'Patterns are not paths: ~/.claude/projects/<folder>/ and ~/src/*.js and ~/...',
    'A link [to a path](~/linked.md) is a link, not a written path.',
    '',
    '[r]: docs/ref.md',
  ].join('\n');
  const { links, written } = pointsIn(text);
  assert.deepEqual(links.sort(), ['GUIDE.md#start', 'docs/ref.md', 'https://example.com', 'icon.png', '~/linked.md']);
  assert.deepEqual(written.sort(), ['/Users/me/old', '~/kit', '~/notes/today.md', '~/staging/app']);
});

test('a link is a path on the disk unless it is a web address or a section of the same page', () => {
  assert.equal(linkPath('https://a.b/c', '/p/README.md', '/p', '/h'), null);
  assert.equal(linkPath('mailto:me@a.b', '/p/README.md', '/p', '/h'), null);
  assert.equal(linkPath('#top', '/p/README.md', '/p', '/h'), null);
  assert.deepEqual(linkPath('docs/a%20b.md#x', '/p/sub/README.md', '/p', '/h'), ['/p/sub/docs/a b.md']);
  assert.deepEqual(linkPath('~/kit/me.md', '/p/README.md', '/p', '/h'), ['/h/kit/me.md']);
  assert.deepEqual(linkPath('/docs/a.md', '/p/README.md', '/p', '/h'), ['/docs/a.md', '/p/docs/a.md']);
});

test('finds what points at nothing in the folder, and leaves out what is there', async () => {
  const home = folder({ 'kit/me.md': 'me' });
  const root = folder({
    'README.md': '[guide](GUIDE.md) [gone](OLD.md) [top](/docs/a.md) [kit](~/kit/me.md) [gone kit](~/kit/gone.md)\n\nIn `~/kit` and `~/moved/away`.',
    'GUIDE.md': 'fine',
    'docs/a.md': '[up](../README.md) [missing](b.md)',
    'CLAUDE.md': '@GUIDE.md and @rules.md',
    'node_modules/x/README.md': '[nothing](nothing.md)',
    '.git/notes.md': '[nothing](nothing.md)',
  });
  const res = await brokenLinks(root, { home });
  assert.equal(res.root, root);
  assert.deepEqual(res.broken, [
    { file: 'CLAUDE.md', target: '@rules.md', kind: 'import' },
    { file: 'README.md', target: 'OLD.md', kind: 'link' },
    { file: 'README.md', target: '~/kit/gone.md', kind: 'link' },
    { file: 'README.md', target: '~/moved/away', kind: 'path' },
    { file: 'docs/a.md', target: 'b.md', kind: 'link' },
  ]);
  assert.equal(res.full, false);
});

test('a path written out under the agents\' own folders is left out, and a link there is not', async () => {
  const home = folder({ '.claude/settings.json': '{}' });
  const root = folder({
    'README.md': 'Put it in `~/.codex/requirements.toml` or ~/.claude/CLAUDE.md or ~/.agents/skills/x, not ~/.claudette/x.\n\n[rules](~/.claude/CLAUDE.md)',
  });
  assert.deepEqual((await brokenLinks(root, { home, env: {} })).broken, [
    { file: 'README.md', target: '~/.claude/CLAUDE.md', kind: 'link' },
    { file: 'README.md', target: '~/.claudette/x', kind: 'path' },
  ]);
  const moved = path.join(home, 'config');
  const other = folder({ 'README.md': 'In ~/config/CLAUDE.md, not ~/.claude/CLAUDE.md.' });
  assert.deepEqual((await brokenLinks(other, { home, env: { CLAUDE_CONFIG_DIR: moved } })).broken.map((b) => b.target), ['~/.claude/CLAUDE.md']);
});

test('a file changed on disk is read again', async () => {
  const root = folder({ 'README.md': '[a](a.md)' });
  assert.equal((await brokenLinks(root)).broken.length, 1);
  fs.writeFileSync(path.join(root, 'README.md'), '[a](README.md) and more');
  assert.equal((await brokenLinks(root)).broken.length, 0);
});

test('without walking, the files found last time are checked again, and a target that came is seen', async () => {
  const root = folder({ 'README.md': '[a](a.md)' });
  assert.equal((await brokenLinks(root)).broken.length, 1);
  fs.writeFileSync(path.join(root, 'a.md'), 'here now');
  fs.writeFileSync(path.join(root, 'NEW.md'), '[b](b.md)');
  assert.deepEqual((await brokenLinks(root, { walk: false })).broken, []);
  assert.deepEqual((await brokenLinks(root)).broken, [{ file: 'NEW.md', target: 'b.md', kind: 'link' }]);
});

test('without walking, another folder is still walked the first time', async () => {
  const one = folder({ 'README.md': 'fine' });
  const two = folder({ 'README.md': '[gone](gone.md)' });
  await brokenLinks(one);
  assert.equal((await brokenLinks(two, { walk: false })).broken.length, 1);
});
