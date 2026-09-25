// Tests for reading the last sessions, against a made-up home folder. Run with
// `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { lastSessions, sessionSteps, liveSteps, namedPaths, writtenPaths, typedLine } = require('./sessions');

const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const KEY = 'sk-ant-api03-abcdefghijklmnop';
const lines = (...objects) => objects.map((o) => JSON.stringify(o)).join('\n') + '\n';

function world() {
  const top = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'invader-sessions-')));
  made.push(top);
  const project = path.join(top, 'work', 'my-app');
  fs.mkdirSync(project, { recursive: true });
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(top, rel)), { recursive: true });
    fs.writeFileSync(path.join(top, rel), text);
  };
  const claudeDir = 'home/.claude/projects/' + project.replace(/[^A-Za-z0-9]/g, '-');
  write(claudeDir + '/one.jsonl', lines(
    { type: 'user', isMeta: true, cwd: project, timestamp: '2026-09-20T10:00:00Z', message: { content: 'Caveat: meta' } },
    { type: 'user', cwd: project, timestamp: '2026-09-20T10:00:05Z', message: { content: '<command-name>/model</command-name>' } },
    { type: 'user', cwd: project, timestamp: '2026-09-20T10:01:00Z', message: { content: 'Fix the login page\nand the footer, token ' + KEY } },
    { type: 'assistant', cwd: project, timestamp: '2026-09-20T10:02:00Z', message: { content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: path.join(project, 'src/login.js') } },
      { type: 'tool_use', name: 'Write', input: { file_path: path.join(project, 'src/footer.js') } },
      { type: 'tool_use', name: 'Read', input: { file_path: path.join(project, 'README.md') } },
      { type: 'tool_use', name: 'Edit', input: { file_path: path.join(top, 'elsewhere.txt') } },
      { type: 'tool_use', name: 'Bash', input: { command: 'sed -i s/a/b/ src/login.js' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
    ] } },
    { type: 'assistant', isSidechain: true, cwd: project, timestamp: '2026-09-25T10:00:00Z', message: { content: [] } },
    'not json',
    { type: 'custom-title', customTitle: 'Login fixes', sessionId: 'one' },
    { type: 'user', cwd: project, timestamp: '2026-09-20T11:00:00Z', message: { content: [{ type: 'tool_result', content: 'ok' }] } },
  ).replace('"not json"', 'not json'));
  write(claudeDir + '/two.jsonl', lines(
    { type: 'user', cwd: project, timestamp: '2026-09-21T09:00:00Z', message: { content: '\n<pasted_content id="1">\n# Findings from my notes\nmore\n</pasted_content id="1">' } },
  ));
  // A record in the same projects folder that says it ran somewhere else.
  write(claudeDir + '/other.jsonl', lines(
    { type: 'user', cwd: path.join(top, 'work'), timestamp: '2026-09-22T09:00:00Z', message: { content: 'Not here' } },
  ));
  write('home/.codex/sessions/2026/09/19/rollout-a.jsonl', lines(
    { type: 'session_meta', timestamp: '2026-09-19T08:00:00Z', payload: { cwd: project } },
    { type: 'response_item', timestamp: '2026-09-19T08:00:01Z', payload: { type: 'message', role: 'user', content: [
      { type: 'input_text', text: '# AGENTS.md instructions for ' + project + '\n\n<INSTRUCTIONS>be kind</INSTRUCTIONS>' },
      { type: 'input_text', text: '<environment_context>zsh</environment_context>' },
    ] } },
    { type: 'response_item', timestamp: '2026-09-19T08:00:02Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Add a map' }] } },
    { type: 'response_item', timestamp: '2026-09-19T08:05:00Z', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: map.json\n+{}\n*** Update File: ' + project + '/README.md\n*** End Patch' } },
    { type: 'response_item', timestamp: '2026-09-19T08:06:00Z', payload: { type: 'function_call', name: 'shell', arguments: '{"command":["ls"]}' } },
    { type: 'response_item', timestamp: '2026-09-19T08:07:00Z', payload: { type: 'custom_tool_call', name: 'exec', input: 'await Promise.all([tools.exec_command({cmd:"ls"}), tools.exec_command({cmd:"pwd"})])' } },
  ));
  write('home/.codex/sessions/2026/09/18/rollout-b.jsonl', lines(
    { type: 'session_meta', timestamp: '2026-09-18T08:00:00Z', payload: { cwd: path.join(top, 'work') } },
    { type: 'response_item', timestamp: '2026-09-18T08:00:02Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Elsewhere' }] } },
  ));
  return { top, project, home: path.join(top, 'home') };
}

test('lists the sessions that ran in the folder, newest first', async () => {
  const { project, home } = world();
  const { root, sessions } = await lastSessions(project, { home, env: {}, max: 5 });
  assert.equal(root, project);
  assert.deepEqual(sessions.map((s) => [s.agent, s.title, s.typed]), [
    ['claude', null, 'Findings from my notes'],
    ['claude', 'Login fixes', 'Fix the login page'],
    ['codex', null, 'Add a map'],
  ]);
});

test('says when a session ran, from its first to its last line in the folder', async () => {
  const { project, home } = world();
  const one = (await lastSessions(project, { home, env: {}, max: 5 })).sessions[1];
  assert.equal(one.start, Date.parse('2026-09-20T10:00:00Z'));
  assert.equal(one.end, Date.parse('2026-09-20T11:00:00Z'));
});

test('lists the files a session changed with its edit tools, and counts those outside', async () => {
  const { project, home } = world();
  const [, claude, codex] = (await lastSessions(project, { home, env: {}, max: 5 })).sessions;
  assert.deepEqual(claude.edited, ['src/login.js', 'src/footer.js']);
  assert.deepEqual(claude.editedAt, { 'src/login.js': Date.parse('2026-09-20T10:02:00Z'), 'src/footer.js': Date.parse('2026-09-20T10:02:00Z') });
  assert.equal(claude.outside, 1);
  assert.deepEqual(codex.edited, ['map.json', 'README.md']);
  assert.equal(codex.outside, 0);
});

test('says when a session last changed each file, the latest edit counting', async () => {
  const { project, home } = world();
  const dir = path.join(home, '.claude/projects', project.replace(/[^A-Za-z0-9]/g, '-'));
  const edit = (t) => ({ type: 'assistant', cwd: project, timestamp: t, message: { content: [
    { type: 'tool_use', name: 'Edit', input: { file_path: path.join(project, 'app.js') } },
  ] } });
  fs.writeFileSync(path.join(dir, 'twice.jsonl'), lines(
    { type: 'user', cwd: project, timestamp: '2026-09-26T09:00:00Z', message: { content: 'Twice' } },
    edit('2026-09-26T09:05:00Z'),
    edit('2026-09-26T09:01:00Z'),
  ));
  const [latest] = (await lastSessions(project, { home, env: {}, max: 5 })).sessions;
  assert.deepEqual(latest.editedAt, { 'app.js': Date.parse('2026-09-26T09:05:00Z') });
});

test('counts the shell commands a session ran', async () => {
  const { project, home } = world();
  const [first, claude, codex] = (await lastSessions(project, { home, env: {}, max: 5 })).sessions;
  assert.equal(first.commands, 0);
  assert.equal(claude.commands, 2);
  assert.equal(codex.commands, 3);
});

test('shows only as many sessions as asked', async () => {
  const { project, home } = world();
  assert.equal((await lastSessions(project, { home, env: {}, max: 1 })).sessions.length, 1);
});

test('finds nothing where there are no records', async () => {
  const { top, home } = world();
  assert.deepEqual((await lastSessions(path.join(top, 'home'), { home, env: {} })).sessions, []);
  assert.deepEqual((await lastSessions(top, { home: path.join(top, 'nowhere'), env: {} })).sessions, []);
});

test('reads from CLAUDE_CONFIG_DIR and CODEX_HOME when they are set', async () => {
  const { top, project, home } = world();
  const env = { CLAUDE_CONFIG_DIR: path.join(home, '.claude'), CODEX_HOME: path.join(home, '.codex') };
  assert.equal((await lastSessions(project, { home: path.join(top, 'nowhere'), env, max: 5 })).sessions.length, 3);
});

test('the first line typed hides secrets and leaves out what an app wraps around it', () => {
  assert.equal(typedLine('Use ' + KEY + ' here'), 'Use [hidden] here');
  assert.equal(typedLine('<command-name>/clear</command-name>'), null);
  assert.equal(typedLine('[Request interrupted by user]'), null);
  assert.equal(typedLine('Look at this\n<pasted_content id="2">\nsecret stuff\n</pasted_content id="2">'), 'Look at this');
  assert.equal(typedLine('- ' + 'x'.repeat(200)).length, 120);
  assert.equal(typedLine(null), null);
});

test('a session that starts with the Build map or Update map request is named after the button', () => {
  assert.equal(typedLine('Write map.json at the top of this folder for invader, a viewer that draws it. Use this shape: {}'), 'Build map request');
  assert.equal(typedLine('Write map.json in projects/app/ for invader, a viewer that draws it.'), 'Build map request');
  assert.equal(typedLine('<pasted_content id="1">\nUpdate map.json for invader so it matches the folder as it is now.\n</pasted_content id="1">'), 'Update map request');
  assert.equal(typedLine('Update projects/app/map.json for invader so it matches the folder as it is now.'), 'Update map request');
  assert.equal(typedLine('Update map.json so the arrows read better'), 'Update map.json so the arrows read better');
});

test('finds the records of a folder whose name Claude Code cut short, and only that folder', async () => {
  const { top, home } = world();
  const deep = path.join(top, 'a'.repeat(120), 'b'.repeat(120));
  const other = path.join(top, 'a'.repeat(120), 'b'.repeat(120) + 'c');
  fs.mkdirSync(deep, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  const cut = deep.replace(/[^A-Za-z0-9]/g, '-').slice(0, 200);
  const record = (dir, cwd, text) => {
    fs.mkdirSync(path.join(home, '.claude/projects', dir), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude/projects', dir, 's.jsonl'), lines({ type: 'user', cwd, timestamp: '2026-09-22T09:00:00Z', message: { content: text } }));
  };
  record(cut + '-1x2y3z', deep, 'In the deep folder');
  record(cut + '-9q8r7s', other, 'In the other one');
  assert.deepEqual((await lastSessions(deep, { home, env: {} })).sessions.map((s) => s.typed), ['In the deep folder']);
});

test('a record made through a symlink counts for the folder it leads to', async () => {
  const { top, project, home } = world();
  const link = path.join(top, 'link');
  fs.symlinkSync(project, link);
  const dir = path.join(home, '.claude/projects', project.replace(/[^A-Za-z0-9]/g, '-'));
  fs.writeFileSync(path.join(dir, 'linked.jsonl'), lines({ type: 'user', cwd: link, timestamp: '2026-09-23T09:00:00Z', message: { content: 'Through the link' } }));
  assert.equal((await lastSessions(project, { home, env: {} })).sessions[0].typed, 'Through the link');
});

test('replays a claude session step by step: what it changed, read and named in a command, in the folder only', async () => {
  const { top, project, home } = world();
  fs.mkdirSync(path.join(project, 'src'));
  fs.writeFileSync(path.join(project, 'src/login.js'), '');
  fs.writeFileSync(path.join(project, 'README.md'), '');
  fs.writeFileSync(path.join(top, 'elsewhere.txt'), '');
  const claude = (await lastSessions(project, { home, env: {}, max: 5 })).sessions[1];
  const { steps } = await sessionSteps(project, claude.id, { home });
  const t = Date.parse('2026-09-20T10:02:00Z');
  assert.deepEqual(steps, [
    { t, kind: 'changed', paths: ['src/login.js'] },
    { t, kind: 'changed', paths: ['src/footer.js'] },
    { t, kind: 'read', paths: ['README.md'] },
    // sed -i writes the file it names.
    { t, kind: 'changed', paths: ['src/login.js'] },
  ]);
});

test('replays a codex session: files a patch changed and files its commands name, from the folder they ran in', async () => {
  const { project, home } = world();
  fs.mkdirSync(path.join(project, 'docs'));
  fs.writeFileSync(path.join(project, 'docs/plan.md'), '');
  fs.writeFileSync(path.join(project, 'app.js'), '');
  fs.writeFileSync(path.join(home, '.codex/sessions/2026/09/19/rollout-c.jsonl'), lines(
    { type: 'session_meta', timestamp: '2026-09-19T09:00:00Z', payload: { cwd: project } },
    { type: 'response_item', timestamp: '2026-09-19T09:00:01Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Tidy up' }] } },
    { type: 'response_item', timestamp: '2026-09-19T09:01:00Z', payload: { type: 'custom_tool_call', name: 'exec', input: 'text(await tools.exec_command({cmd:"sed -n 1,5p plan.md; cat \\"app.js\\"","workdir":"' + project + '/docs"}));' } },
    { type: 'response_item', timestamp: '2026-09-19T09:02:00Z', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'wc -l app.js'] }) } },
    { type: 'response_item', timestamp: '2026-09-19T09:03:00Z', payload: { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Update File: app.js\n*** End Patch' } },
  ));
  const codex = (await lastSessions(project, { home, env: {}, max: 5 })).sessions.find((s) => s.typed === 'Tidy up');
  const { steps } = await sessionSteps(project, codex.id, { home });
  assert.deepEqual(steps.map((s) => [s.kind, s.paths]), [
    ['command', ['docs/plan.md']],
    ['command', ['app.js']],
    ['changed', ['app.js']],
  ]);
});

test('a codex patch counts only when codex applied it, not when a message or output quotes one', async () => {
  const { project, home } = world();
  const patch = (file) => '*** Begin Patch\n*** Update File: ' + file + '\n*** End Patch';
  fs.writeFileSync(path.join(home, '.codex/sessions/2026/09/19/rollout-d.jsonl'), lines(
    { type: 'session_meta', timestamp: '2026-09-19T10:00:00Z', payload: { cwd: project } },
    { type: 'response_item', timestamp: '2026-09-19T10:00:01Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Look at this\n' + patch('typed.md') }] } },
    { type: 'response_item', timestamp: '2026-09-19T10:01:00Z', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: patch('said.md') }] } },
    { type: 'response_item', timestamp: '2026-09-19T10:02:00Z', payload: { type: 'custom_tool_call_output', output: patch('printed.md') } },
    { type: 'response_item', timestamp: '2026-09-19T10:03:00Z', payload: { type: 'function_call_output', output: patch('shown.md') } },
    { type: 'event_msg', timestamp: '2026-09-19T10:04:00Z', payload: { type: 'item_completed', item: { aggregated_output: patch('event.md') } } },
    { type: 'response_item', timestamp: '2026-09-19T10:05:00Z', payload: { type: 'custom_tool_call', name: 'exec', input: 'text(await tools.apply_patch(' + JSON.stringify(patch('script.js')) + '));' } },
    { type: 'response_item', timestamp: '2026-09-19T10:06:00Z', payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['apply_patch', patch('shell.js')] }) } },
    { type: 'response_item', timestamp: '2026-09-19T10:07:00Z', payload: { type: 'custom_tool_call', name: 'apply_patch', input: patch('own.js') } },
  ));
  const codex = (await lastSessions(project, { home, env: {}, max: 5 })).sessions.find((s) => s.typed === 'Look at this');
  assert.deepEqual(codex.edited, ['script.js', 'shell.js', 'own.js']);
  const { steps } = await sessionSteps(project, codex.id, { home });
  assert.deepEqual(steps.map((s) => [s.kind, s.paths]), [['changed', ['script.js']], ['changed', ['shell.js']], ['changed', ['own.js']]]);
});

test('a changed file that has gone counts only when its folder, after following symlinks, is in the open folder', async () => {
  const { top, project, home } = world();
  fs.mkdirSync(path.join(top, 'outside'));
  fs.symlinkSync(path.join(top, 'outside'), path.join(project, 'link'));
  fs.symlinkSync(project, path.join(top, 'alias'));
  fs.writeFileSync(path.join(project, 'kept.js'), '');
  const alias = path.join(top, 'alias');
  const edit = (cwd, file, at) => ({ type: 'assistant', cwd, timestamp: '2026-09-26T10:0' + at + ':00Z', message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: file } }] } });
  fs.writeFileSync(path.join(home, '.claude/projects', project.replace(/[^A-Za-z0-9]/g, '-'), 'gone.jsonl'), lines(
    { type: 'user', cwd: alias, timestamp: '2026-09-26T10:00:00Z', message: { content: 'Tidy links' } },
    edit(alias, path.join(alias, 'removed.js'), 1),
    edit(alias, path.join(project, 'link/gone.js'), 2),
    edit(alias, path.join(project, 'kept.js'), 3),
    edit(path.join(top, 'outside'), path.join(top, 'outside/gone.js'), 4),
  ));
  const session = (await lastSessions(project, { home, env: {}, max: 5 })).sessions.find((s) => s.typed === 'Tidy links');
  assert.deepEqual(session.edited, ['removed.js', 'kept.js']);
  assert.equal(session.outside, 2);
  const { steps } = await sessionSteps(project, session.id, { home });
  assert.deepEqual(steps.map((s) => s.paths), [['removed.js'], ['kept.js']]);
});

test('a record that cannot be read is counted, not taken for no session', async () => {
  const { project, home } = world();
  assert.equal((await lastSessions(project, { home, env: {}, max: 5 })).unread, 0);
  const locked = path.join(home, '.claude/projects', project.replace(/[^A-Za-z0-9]/g, '-'), 'locked.jsonl');
  fs.writeFileSync(locked, lines({ type: 'user', cwd: project, timestamp: '2026-09-26T09:00:00Z', message: { content: 'Hidden' } }));
  fs.chmodSync(locked, 0o000);
  try {
    const res = await lastSessions(project, { home, env: {}, max: 5 });
    assert.equal(res.unread, 1);
    assert.ok(!res.sessions.some((s) => s.typed === 'Hidden'));
  } finally {
    fs.chmodSync(locked, 0o600);
  }
  assert.equal((await lastSessions(project, { home, env: {}, max: 5 })).unread, 0);
});

test('only a session the summary last listed for the folder can be replayed', async () => {
  const { top, project, home } = world();
  await assert.rejects(sessionSteps(project, 'claude:one', { home }), /not one of the last sessions/);
  const [first] = (await lastSessions(project, { home, env: {}, max: 1 })).sessions;
  await sessionSteps(project, first.id, { home });
  await assert.rejects(sessionSteps(project, 'claude:one', { home }), /not one of the last sessions/);
  await assert.rejects(sessionSteps(path.join(top, 'work'), first.id, { home }), /not one of the last sessions/);
});

test('a command naming a file through a symlink that leads out of the folder is left out', async () => {
  const { top, project, home } = world();
  fs.writeFileSync(path.join(top, 'secret.txt'), '');
  fs.symlinkSync(path.join(top, 'secret.txt'), path.join(project, 'inside.txt'));
  const dir = path.join(home, '.claude/projects', project.replace(/[^A-Za-z0-9]/g, '-'));
  fs.writeFileSync(path.join(dir, 'three.jsonl'), lines(
    { type: 'user', cwd: project, timestamp: '2026-09-24T09:00:00Z', message: { content: 'Look around' } },
    { type: 'assistant', cwd: project, timestamp: '2026-09-24T09:01:00Z', message: { content: [
      { type: 'tool_use', name: 'Bash', input: { command: 'cat inside.txt ../../secret.txt' } },
      { type: 'tool_use', name: 'Read', input: { file_path: path.join(project, 'inside.txt') } },
    ] } },
  ));
  const [latest] = (await lastSessions(project, { home, env: {}, max: 5 })).sessions;
  assert.deepEqual((await sessionSteps(project, latest.id, { home })).steps, []);
});

// Live: a record the agent is writing to now, in the made-up home.
function liveWorld() {
  const w = world();
  for (const f of ['src/app.js', 'src/old.js', 'README.md', 'notes.md']) {
    fs.mkdirSync(path.dirname(path.join(w.project, f)), { recursive: true });
    fs.writeFileSync(path.join(w.project, f), '');
  }
  w.claudeDir = path.join(w.home, '.claude/projects', w.project.replace(/[^A-Za-z0-9]/g, '-'));
  w.record = path.join(w.claudeDir, 'live.jsonl');
  w.at = (ago) => new Date(Date.now() - ago).toISOString();
  w.read = (file, ago = 1000, extra = {}) => ({ type: 'assistant', cwd: w.project, timestamp: w.at(ago), ...extra,
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: path.join(w.project, file) } }] } });
  return w;
}

test('live: the newest steps of a record being written, each passed once', async () => {
  const w = liveWorld();
  fs.writeFileSync(w.record, lines(
    { type: 'user', cwd: w.project, timestamp: w.at(60000), message: { content: 'Start' } },
    w.read('src/old.js', 60000),
    w.read('src/app.js'),
  ));
  const first = await liveSteps(w.project, { home: w.home, env: {} });
  assert.equal(first.root, w.project);
  assert.deepEqual(first.steps.map((s) => [s.agent, s.kind, s.paths]), [['claude', 'read', ['src/app.js']]]);
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps, []);
  fs.appendFileSync(w.record, lines(
    { type: 'assistant', cwd: w.project, timestamp: w.at(500), message: { content: [
      { type: 'tool_use', name: 'Edit', input: { file_path: path.join(w.project, 'README.md') } },
      { type: 'tool_use', name: 'Bash', input: { command: 'wc -l notes.md' } },
    ] } },
  ));
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps.map((s) => [s.kind, s.paths]), [
    ['changed', ['README.md']],
    ['command', ['notes.md']],
  ]);
});

test('live: a line still being written waits until it is whole', async () => {
  const w = liveWorld();
  fs.writeFileSync(w.record, lines({ type: 'user', cwd: w.project, timestamp: w.at(5000), message: { content: 'Start' } }));
  await liveSteps(w.project, { home: w.home, env: {} });
  const line = lines(w.read('README.md'));
  fs.appendFileSync(w.record, line.slice(0, 40));
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps, []);
  fs.appendFileSync(w.record, line.slice(40));
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps.map((s) => s.paths), [['README.md']]);
});

test('live: a record not written to in the last few seconds, or from another folder, is left alone', async () => {
  const w = liveWorld();
  fs.writeFileSync(w.record, lines(w.read('src/app.js')));
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(w.record, old, old);
  fs.writeFileSync(path.join(w.claudeDir, 'elsewhere.jsonl'), lines(w.read('src/app.js', 1000, { cwd: path.join(w.top, 'work') })));
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps, []);
});

test('live: a record first seen before it names its folder is looked at again once it grows', async () => {
  const w = liveWorld();
  fs.writeFileSync(w.record, lines({ type: 'queue-operation', operation: 'enqueue', timestamp: w.at(3000) }));
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps, []);
  fs.appendFileSync(w.record, lines({ type: 'user', cwd: w.project, timestamp: w.at(2000), message: { content: 'Start' } }, w.read('notes.md')));
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps.map((s) => s.paths), [['notes.md']]);
  const day = path.join(w.home, '.codex/sessions/2099/01/02');
  fs.mkdirSync(day, { recursive: true });
  const codex = path.join(day, 'rollout-new.jsonl');
  fs.writeFileSync(codex, '');
  assert.ok(!(await lastSessions(w.project, { home: w.home, env: {}, max: 5 })).sessions.some((s) => s.typed === 'Just started'));
  fs.appendFileSync(codex, lines(
    { type: 'session_meta', timestamp: w.at(2000), payload: { cwd: w.project } },
    { type: 'response_item', timestamp: w.at(1000), payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Just started' }] } },
  ));
  assert.ok((await lastSessions(w.project, { home: w.home, env: {}, max: 5 })).sessions.some((s) => s.typed === 'Just started'));
});

test('live: what claude\'s helpers read counts, from their own records', async () => {
  const w = liveWorld();
  fs.writeFileSync(w.record, lines({ type: 'user', cwd: w.project, timestamp: w.at(5000), message: { content: 'Look' } }));
  fs.mkdirSync(path.join(w.claudeDir, 'live/subagents'), { recursive: true });
  fs.writeFileSync(path.join(w.claudeDir, 'live/subagents/agent-1.jsonl'), lines(w.read('notes.md', 1000, { isSidechain: true })));
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps.map((s) => s.paths), [['notes.md']]);
});

test('live: a codex command names files from the folder it ran in', async () => {
  const w = liveWorld();
  const day = path.join(w.home, '.codex/sessions/2099/01/01');
  fs.mkdirSync(day, { recursive: true });
  fs.writeFileSync(path.join(day, 'rollout-live.jsonl'), lines(
    { type: 'session_meta', timestamp: w.at(60000), payload: { cwd: w.project } },
    { type: 'response_item', timestamp: w.at(1000), payload: { type: 'function_call', name: 'shell', arguments: JSON.stringify({ command: ['bash', '-lc', 'sed -n 1,9p app.js'], workdir: path.join(w.project, 'src') }) } },
  ));
  assert.deepEqual((await liveSteps(w.project, { home: w.home, env: {} })).steps.map((s) => [s.agent, s.kind, s.paths]), [['codex', 'command', ['src/app.js']]]);
});

test('the files a shell command writes, from its words', () => {
  // The shell's own ways of writing.
  assert.deepEqual(writtenPaths("cat > game.js <<'EOF'\nconst a = b > c;\necho x > not-this.js\nEOF"), ['game.js']);
  assert.deepEqual(writtenPaths('npm test 2>&1 | tee test.log; echo done >> notes/log.md'), ['notes/log.md', 'test.log']);
  assert.deepEqual(writtenPaths("sed -i '' 's/a/b/' src/app.js src/b.js && touch NEW.md"), ['NEW.md', 'src/app.js', 'src/b.js']);
  assert.deepEqual(writtenPaths('cp template.html index.html; mv old.js new.js'), ['index.html', 'new.js']);
  assert.deepEqual(writtenPaths('echo "a > b" > "out file.txt"'), []);
  // A script's ways of writing, and the names it set.
  assert.deepEqual(writtenPaths(`python3 - <<'EOF'\nfrom pathlib import Path\np = Path("game.js")\ns = p.read_text()\np.write_text(s.replace("a", "b"))\nEOF`), ['game.js']);
  assert.deepEqual(writtenPaths(`python3 - <<'EOF'\nimport os\nwith open(os.path.join("src", "data.json"), "w") as f:\n    f.write("{}")\nEOF`), ['src/data.json']);
  assert.deepEqual(writtenPaths(`python3 - <<'EOF'\ndef edit(p, pairs):\n    s = open(p).read()\n    open(p, 'w').write(s)\nedit('main/a.js', [])\nedit("window/b.js", [])\nEOF`), ['main/a.js', 'window/b.js']);
  assert.deepEqual(writtenPaths(`python3 -c "for name in ['a.md', 'b.md']:\n    open(name, 'a').write('x')"`), ['a.md', 'b.md']);
  assert.deepEqual(writtenPaths(`node -e "const fs = require('fs'); const out = 'dist/app.js'; fs.writeFileSync(out, 'x')"`), ['dist/app.js']);
  // Code a script puts into a file is text, not what the script writes.
  assert.deepEqual(writtenPaths(`python3 - <<'EOF'\np = 'main/x.test.js'\ns = open(p).read()\ns += """fs.writeFileSync(path.join(top, 'README.md'), '');\\nopen('b.js', 'w')"""\nopen(p, 'w').write(s)\nEOF`), ['main/x.test.js']);
  assert.deepEqual(writtenPaths("cat > tool.js <<'EOF'\nfs.writeFileSync('other.js', 'x')\nEOF"), ['tool.js']);
  // Not writing: comparisons and arrows in scripts, reading, and nowhere.
  assert.deepEqual(writtenPaths(`node -e "const f = (x) => x.length > 2; console.log(f(a.b))" 2>&1 >/dev/null`), []);
  assert.deepEqual(writtenPaths(`python3 - <<'EOF'\nif len(s) > 3: print(open('a.js').read())\nEOF`), []);
  assert.deepEqual(writtenPaths(`python3 -c "import sys; open(sys.argv[1], 'w').write('x')" out.txt`), []);
  assert.deepEqual(writtenPaths('grep -n x src/a.js | head'), []);
  assert.deepEqual(writtenPaths(null), []);
});

test('a file a command wrote counts as changed, in the summary and the replay, when it is in the folder now', async () => {
  const { project, home } = world();
  fs.writeFileSync(path.join(project, 'game.js'), '');
  fs.writeFileSync(path.join(project, 'style.css'), '');
  const exec = (at, cmd) => ({ type: 'response_item', timestamp: '2026-09-19T11:0' + at + ':00Z', payload: { type: 'custom_tool_call', name: 'exec',
    input: 'text(await tools.exec_command({cmd:' + JSON.stringify(cmd) + ',"workdir":' + JSON.stringify(project) + '}));' } });
  fs.writeFileSync(path.join(home, '.codex/sessions/2026/09/19/rollout-w.jsonl'), lines(
    { type: 'session_meta', timestamp: '2026-09-19T11:00:00Z', payload: { cwd: project } },
    { type: 'response_item', timestamp: '2026-09-19T11:00:01Z', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Make the game' }] } },
    exec(1, "cat > game.js <<'EOF'\nlet score = 0;\nEOF"),
    exec(2, "python3 - <<'EOF'\nfrom pathlib import Path\nPath('style.css').write_text('body{}')\nEOF"),
    exec(3, 'cat game.js > never-there.js; rm never-there.js'),
    exec(4, 'sed -n 1,5p game.js'),
  ));
  const codex = (await lastSessions(project, { home, env: {}, max: 5 })).sessions.find((s) => s.typed === 'Make the game');
  assert.deepEqual(codex.edited, ['game.js', 'style.css']);
  assert.equal(codex.outside, 0);
  const { steps } = await sessionSteps(project, codex.id, { home });
  assert.deepEqual(steps.map((s) => [s.kind, s.paths]), [
    ['changed', ['game.js']],
    ['changed', ['style.css']],
    ['command', ['game.js']],
    ['command', ['game.js']],
  ]);
});

test('the words of a command that may name a file', () => {
  assert.deepEqual(namedPaths("sed -n 92,99p game.js | cut -c1-300; grep -n 'x' ./game.js"), ['game.js']);
  assert.deepEqual(namedPaths("cat >> tests.js <<'EOF'"), ['tests.js']);
  assert.deepEqual(namedPaths('node --check src/app.js:12 --flag=a.b https://a.b/c *.js $HOME/x ..'), ['src/app.js', 'a.b']);
  assert.deepEqual(namedPaths('npm test'), []);
  assert.deepEqual(namedPaths(null), []);
});
