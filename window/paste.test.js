// Tests for what a paste into the shell holds. Run with `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const { pasteCheck } = require('./paste');

test('one command goes straight in, with or without a Return after it', () => {
  assert.equal(pasteCheck('git status'), null);
  assert.equal(pasteCheck('git status\n'), null);
  assert.equal(pasteCheck('\n  npm test  \n\n'), null);
});

test('more than one line asks first', () => {
  assert.deepEqual(pasteCheck('cd app\r\nnpm install\n'), { lines: ['cd app', 'npm install'], commands: [], text: 'cd app\nnpm install' });
});

test('the whole paste keeps its blank lines inside, and leaves off those at either end', () => {
  const heredoc = '\n\ncat > notes.md <<EOF\n# Notes\n\n  indented\nEOF\n\n  \n';
  assert.equal(pasteCheck(heredoc).text, 'cat > notes.md <<EOF\n# Notes\n\n  indented\nEOF');
  assert.equal(pasteCheck('$ git status\n').text, '$ git status');
});

test('a copied prompt asks first, even on one line, and the commands come without it', () => {
  assert.deepEqual(pasteCheck('$ git status'), { lines: ['$ git status'], commands: ['git status'], text: '$ git status' });
  const copied = '% npm test\n> invader@0.1.0 test\n✔ 48 passed\n❯ git log --oneline\n4a162ff Count words';
  assert.deepEqual(pasteCheck(copied).commands, ['npm test', 'git log --oneline']);
  assert.equal(pasteCheck(copied).lines.length, 5);
});

test('a $ that is part of a command is not a prompt', () => {
  assert.equal(pasteCheck('echo $HOME'), null);
  assert.equal(pasteCheck('$HOME/bin/tool'), null);
});
