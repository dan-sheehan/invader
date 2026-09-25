// Tests for the agent setup scan, against a made-up home folder. Run with
// `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanSetup, readSetup, frontMatter, importsIn } = require('./setup');
const { redactToml } = require('./redact');

const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// A throwaway folder holding the given files.
function folder(files) {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'invader-setup-')));
  made.push(top);
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(top, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return top;
}

const KEY = 'sk-ant-api03-abcdefghijklmnop';

function world() {
  const top = folder({
    'home/.claude/CLAUDE.md': '# Mine\nBe brief.',
    'home/.claude/settings.json': {
      model: 'opus',
      permissions: { defaultMode: 'acceptEdits', allow: ['Bash(npm test)'], deny: ['Bash(rm -rf *)'] },
      env: { SECRET_THING: 'plain-looking-value' },
      hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'npx prettier --write --token ' + KEY }] }] },
      enabledPlugins: { 'tidy@market': true, 'off@market': false },
    },
    'home/.claude/skills/deploy/SKILL.md': '---\nname: deploy\ndescription: >\n  Ships the app\n  to the server.\n---\nSteps.',
    'home/.claude/skills/synced/acct_user/manifest.json': { skills: [] },
    'home/.claude/skills/synced/acct_user/pdf/SKILL.md': '---\nname: pdf\ndescription: Reads and makes PDF files\n---\n',
    'home/.claude/skills/synced/.trash/old/SKILL.md': '---\nname: old\n---\n',
    'home/.claude/plugins/synced/acct_user/manifest.json': { plugins: [] },
    'home/.claude/plugins/synced/acct_user/helpers/.claude-plugin/plugin.json': { name: 'helpers' },
    'home/.claude/commands/tools/check.md': '---\ndescription: Runs the checks\n---\nRun them.',
    'home/.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: Reviews changes\n---\n',
    'home/.claude.json': {
      mcpServers: { docs: { command: 'npx', args: ['docs-mcp', '--api-key', 'abc123'], env: { DOCS_KEY: 'x' } } },
      projects: {},
      oauthAccount: { emailAddress: 'me@example.com' },
    },
    'home/.codex/AGENTS.md': 'Global codex rules.',
    'home/.codex/config.toml': 'model = "gpt-5"\napproval_policy = "on-request"\nsandbox_mode = "workspace-write"\nnotify = ["say", "done"]\n[mcp_servers.search]\nurl = "https://search.example/mcp"\n[mcp_servers.search.env]\nSEARCH_KEY = "zzz"\n',
    'home/.codex/rules/default.rules': 'prefix_rule(pattern=["git", "status"], decision="allow")\nprefix_rule(pattern=["rm"], decision="forbidden")\n',
    'home/work/CLAUDE.md': 'Work-wide rules.',
    'home/work/app/.git/HEAD': 'ref: refs/heads/main',
    'home/work/app/AGENTS.md': 'Repo rules.',
    'home/work/app/web/CLAUDE.md': 'Web rules.',
    'home/work/app/web/AGENTS.override.md': 'Override here.',
    'home/work/app/web/AGENTS.md': 'Shadowed.',
    'home/work/app/web/.claude/settings.local.json': { permissions: { ask: ['Bash(git push)'] } },
    'home/work/app/web/.mcp.json': { mcpServers: { db: { command: 'db-mcp' }, off: { command: 'x' } } },
    'home/work/app/web/.agents/skills/lint/SKILL.md': '---\ndescription: Lints\n---\n',
  });
  const home = path.join(top, 'home');
  const root = path.join(home, 'work', 'app', 'web');
  const state = JSON.parse(fs.readFileSync(path.join(home, '.claude.json')));
  state.projects[root] = { disabledMcpjsonServers: ['off'], mcpServers: { mine: { url: 'https://u:p@mine.example' } } };
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify(state));
  return { home, root, managed: path.join(top, 'managed'), env: {} };
}

const scan = (w) => scanSetup(w.root, w);
const find = (res, agent, kind, name) => res.items.find((i) => i.agent === agent && i.kind === kind && i.name === name);

test('front matter gives a name and a description, folded lines joined', () => {
  assert.deepEqual(frontMatter('---\nname: a\ndescription: >\n  one\n  two\n---\nbody'), { name: 'a', description: 'one two' });
  assert.deepEqual(frontMatter('no front matter'), {});
});

test('claude instructions come from everywhere, the folders above and this folder, in that order', async () => {
  const res = await scan(world());
  const files = res.items.filter((i) => i.agent === 'claude' && i.kind === 'instructions').map((i) => i.file + ' ' + i.scope);
  assert.deepEqual(files, ['~/.claude/CLAUDE.md everywhere', '~/work/CLAUDE.md above', '~/work/app/web/CLAUDE.md folder']);
});

test('a file in the open folder carries its path inside it; others do not', async () => {
  const res = await scan(world());
  assert.equal(find(res, 'claude', 'instructions', 'CLAUDE.md').rel, null);
  assert.equal(res.items.find((i) => i.file === '~/work/app/web/CLAUDE.md').rel, 'CLAUDE.md');
});

test('settings are told in plain words, and env values never appear', async () => {
  const res = await scan(world());
  const s = res.items.find((i) => i.kind === 'settings' && i.file === '~/.claude/settings.json');
  assert.deepEqual(s.lines, [
    'model: opus',
    'mode: changes files without asking, asks before commands',
    'may do without asking: Bash(npm test)',
    'never: Bash(rm -rf *)',
    'sets for its programs (values hidden): SECRET_THING',
  ]);
  assert.ok(!JSON.stringify(res).includes('plain-looking-value'));
});

test('hooks are named by when they run, with secrets in the command hidden', async () => {
  const res = await scan(world());
  const hook = find(res, 'claude', 'hook', 'after it uses a tool · Edit');
  assert.ok(hook);
  assert.equal(hook.lines[0], 'runs: npx prettier --write --token [hidden]');
  assert.ok(!JSON.stringify(res).includes(KEY));
});

test('only plugins that are turned on are listed', async () => {
  const res = await scan(world());
  assert.ok(find(res, 'claude', 'plugin', 'tidy@market'));
  assert.ok(!find(res, 'claude', 'plugin', 'off@market'));
});

test('skills, commands and helpers carry their descriptions', async () => {
  const res = await scan(world());
  assert.equal(find(res, 'claude', 'skill', 'deploy').about, 'Ships the app to the server.');
  assert.equal(find(res, 'claude', 'command', '/tools:check').about, 'Runs the checks');
  assert.equal(find(res, 'claude', 'helper', 'reviewer').about, 'Reviews changes');
  assert.equal(find(res, 'codex', 'skill', 'lint').scope, 'folder');
});

test('connections: argument secrets hidden, turned-off and unapproved ones marked', async () => {
  const res = await scan(world());
  const docs = find(res, 'claude', 'connection', 'docs');
  assert.deepEqual(docs.lines, ['runs: npx docs-mcp --api-key [hidden]', 'uses (values hidden): DOCS_KEY']);
  assert.equal(find(res, 'claude', 'connection', 'off').off, 'turned off');
  assert.equal(find(res, 'claude', 'connection', 'db').off, 'claude asks you before using it');
  const mine = find(res, 'claude', 'connection', 'mine');
  assert.equal(mine.scope, 'mine-here');
  assert.equal(mine.lines[0], 'connects to: https://[hidden]@mine.example');
});

test('codex reads AGENTS files from the top of the repository down, an override winning', async () => {
  const res = await scan(world());
  const files = res.items.filter((i) => i.agent === 'codex' && i.kind === 'instructions').map((i) => [i.file, i.scope, i.off]);
  assert.deepEqual(files, [
    ['~/.codex/AGENTS.md', 'everywhere', null],
    ['~/work/app/AGENTS.md', 'above', null],
    ['~/work/app/web/AGENTS.override.md', 'folder', null],
    ['~/work/app/web/AGENTS.md', 'folder', 'not read: AGENTS.override.md is read instead'],
  ]);
});

test('codex settings, notify and rules in plain words', async () => {
  const res = await scan(world());
  assert.deepEqual(find(res, 'codex', 'settings', 'config.toml').lines, [
    'model: gpt-5', 'asking: decides itself when to ask', 'sandbox: may change files in this folder only',
  ]);
  assert.deepEqual(find(res, 'codex', 'hook', 'when it finishes a turn').lines, ['runs: say done']);
  assert.deepEqual(find(res, 'codex', 'settings', 'rules/default.rules').lines, ['may run without asking: git status', 'never: rm']);
  assert.deepEqual(find(res, 'codex', 'connection', 'search').lines, ['connects to: https://search.example/mcp', 'uses (values hidden): SEARCH_KEY']);
});

test('reading a source hides secrets, and shows only its own part of ~/.claude.json', async () => {
  const w = world();
  const res = await scan(w);
  const docs = await readSetup(find(res, 'claude', 'connection', 'docs').id, w.home);
  assert.deepEqual(JSON.parse(docs.text), { docs: { command: 'npx', args: ['docs-mcp', '--api-key', '[hidden]'], env: { DOCS_KEY: '[hidden]' } } });
  assert.ok(!docs.text.includes('me@example.com'));
  assert.ok(!docs.text.includes('abc123'));
  const mine = await readSetup(find(res, 'claude', 'connection', 'mine').id, w.home);
  assert.match(mine.text, /https:\/\/\[hidden\]@mine\.example/);
  const settings = await readSetup(res.items.find((i) => i.file === '~/.claude/settings.json').id, w.home);
  assert.ok(!settings.text.includes('plain-looking-value'));
  assert.ok(!settings.text.includes(KEY));
  const toml = await readSetup(find(res, 'codex', 'settings', 'config.toml').id, w.home);
  assert.ok(!toml.text.includes('zzz'));
  const skill = await readSetup(find(res, 'claude', 'skill', 'deploy').id, w.home);
  assert.ok(skill.tokens.length > 0);
});

test('config.toml values under env and headers stay hidden however they are written', () => {
  const shown = redactToml([
    'model = "gpt-5"',
    '[mcp_servers.a]',
    'command = "npx"',
    'env = { K = "s1" } # a note',
    'env.OTHER = "s2"',
    'http_headers = {',
    '  Authorization = "s3",',
    '}',
    "[mcp_servers.b.'env']",
    'K = "s4"',
    '[mcp_servers.c.env]',
    'K = """first',
    's5',
    '[not.a.table]',
    '"""',
    "L = '''s6",
    "'''",
    '[mcp_servers.d]',
    'about = """a note that names',
    '[mcp_servers.e.env]',
    '"""',
    'url = "https://d.example"',
  ].join('\n'));
  for (const secret of ['s1', 's2', 's3', 's4', 's5', 's6']) assert.ok(!shown.includes(secret), secret);
  assert.deepEqual(shown.split('\n'), [
    'model = "gpt-5"',
    '[mcp_servers.a]',
    'command = "npx"',
    'env = { [hidden] }',
    'env.OTHER = "[hidden]"',
    'http_headers = { [hidden] }',
    '[hidden]',
    '[hidden]',
    "[mcp_servers.b.'env']",
    'K = "[hidden]"',
    '[mcp_servers.c.env]',
    'K = "[hidden]"',
    '[hidden]',
    '[hidden]',
    '[hidden]',
    'L = "[hidden]"',
    '[hidden]',
    '[mcp_servers.d]',
    'about = """a note that names',
    '[mcp_servers.e.env]',
    '"""',
    'url = "https://d.example"',
  ]);
});

test('only what the last scan found can be read', async () => {
  const w = world();
  await scan(w);
  await assert.rejects(readSetup(path.join(w.home, '.ssh', 'id_rsa'), w.home), /Not part of the agent setup/);
});

test('the files a CLAUDE.md brings in with @ are found, but not in code or an email address', () => {
  const text = 'See @HARNESS.md and @~/me.md.\nMail me@example.com, not `@code.md`\n```\n@block.md\n```\n@../up.md';
  assert.deepEqual(importsIn(text, '/a/b/CLAUDE.md', '/home/me'), ['/a/b/HARNESS.md', '/home/me/me.md', '/a/up.md']);
});

test('instructions are counted in words, with what they bring in with @, each once', async () => {
  const w = world();
  fs.writeFileSync(path.join(w.home, 'work/CLAUDE.md'), 'Work rules: @notes/a.md and @~/me.md and @gone.md');
  fs.mkdirSync(path.join(w.home, 'work/notes'));
  fs.writeFileSync(path.join(w.home, 'work/notes/a.md'), 'one two three @../CLAUDE.md @~/me.md');
  fs.writeFileSync(path.join(w.home, 'me.md'), 'four five');
  const res = await scan(w);
  const work = res.items.find((i) => i.file === '~/work/CLAUDE.md');
  assert.equal(work.words, 7);
  assert.deepEqual(work.imports, [{ file: '~/work/notes/a.md', words: 5 }, { file: '~/me.md', words: 2 }]);
  assert.deepEqual(find(res, 'codex', 'instructions', 'AGENTS.md').imports, []);
});

test('skills, commands and helpers count the words of their name and description', async () => {
  const res = await scan(world());
  assert.equal(find(res, 'claude', 'skill', 'deploy').words, 7);
  assert.equal(find(res, 'claude', 'command', '/tools:check').words, 4);
});

test('skills and plugins synced from claude.ai are listed and say so, and the skills are counted', async () => {
  const res = await scan(world());
  const pdf = find(res, 'claude', 'skill', 'pdf');
  assert.deepEqual([pdf.scope, pdf.lines, pdf.words], ['everywhere', ['synced from claude.ai'], 6]);
  assert.ok(!find(res, 'claude', 'skill', 'old'));
  assert.ok(!find(res, 'claude', 'skill', 'synced'));
  assert.deepEqual(find(res, 'claude', 'plugin', 'helpers').lines, ['synced from claude.ai']);
});

test('a folder with no agent setup anywhere gives nothing', async () => {
  const top = folder({ 'home/x': '', 'project/readme.txt': 'hi' });
  const res = await scanSetup(path.join(top, 'project'), { home: path.join(top, 'home'), env: {}, managed: path.join(top, 'none') });
  assert.deepEqual(res.items, []);
  assert.equal(res.claude, false);
});
