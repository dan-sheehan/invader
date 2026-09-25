// Tests for which settings the terminal's shell does not get. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { dropped, moveTo } = require('./shell');

test('settings from Electron or a Claude Code session are dropped', () => {
  assert.equal(dropped('ELECTRON_RUN_AS_NODE'), true);
  assert.equal(dropped('CLAUDECODE'), true);
  assert.equal(dropped('CLAUDE_CODE_SESSION_ID'), true);
  assert.equal(dropped('CLAUDE_CODE_ENTRYPOINT'), true);
});

test('where claude keeps its settings and records stays, like everything else', () => {
  assert.equal(dropped('CLAUDE_CONFIG_DIR'), false);
  assert.equal(dropped('CODEX_HOME'), false);
  assert.equal(dropped('HOME'), false);
  assert.equal(dropped('PATH'), false);
});

test('a folder whose path holds a control character is never typed into the terminal', () => {
  for (const bad of ['/tmp/a\x03touch x #', '/tmp/b\nrm -rf x', '/tmp/c\x1b[A', '/tmp/d\x7f']) {
    assert.throws(() => moveTo(1, bad), /not typed/);
  }
  // With no such terminal, a plain path is refused only because nothing waits at a prompt.
  assert.equal(moveTo(99, '/tmp/plain folder'), false);
});
