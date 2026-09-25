const test = require('node:test');
const assert = require('node:assert');
const { admit, forBrowser } = require('./address');

const ok = (input) => {
  const res = admit(input);
  assert.ok(res.ok, input + ': ' + res.why);
  return res.url;
};
const no = (input) => {
  const res = admit(input);
  assert.equal(res.ok, false, input + ' should not open, got ' + res.url);
  return res.why;
};

test('pages on this computer open, written out in full', () => {
  assert.equal(ok('http://localhost:5173'), 'http://localhost:5173/');
  assert.equal(ok('https://localhost:8443/app?x=1#top'), 'https://localhost:8443/app?x=1#top');
  assert.equal(ok('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000/');
  assert.equal(ok('http://127.4.5.6'), 'http://127.4.5.6/');
  assert.equal(ok('http://[::1]:4000/x'), 'http://[::1]:4000/x');
  assert.equal(ok('http://app.localhost:3000'), 'http://app.localhost:3000/');
  assert.equal(ok('HTTP://LOCALHOST:3000'), 'http://localhost:3000/');
});

test('the ways I might type one', () => {
  assert.equal(ok('5173'), 'http://localhost:5173/');
  assert.equal(ok('  localhost:5173/about '), 'http://localhost:5173/about');
  assert.equal(ok('127.0.0.1:8000'), 'http://127.0.0.1:8000/');
  assert.equal(ok('[::1]:8000'), 'http://[::1]:8000/');
});

test('numbers the parser reads as 127.0.0.1 count, since that is where it connects', () => {
  assert.equal(ok('http://2130706433/'), 'http://127.0.0.1/');
  assert.equal(ok('http://127.1:9/'), 'http://127.0.0.1:9/');
});

test('nothing off this computer opens', () => {
  no('https://example.com');
  no('http://192.168.1.10:3000');
  no('http://10.0.0.1');
  no('http://localhost.example.com');
  no('http://example.com/localhost');
  no('http://127.0.0.1.nip.io');
  no('http://[::ffff:127.0.0.1]/');
  no('http://evil.com#@localhost');
});

test('0.0.0.0 says which address to use instead', () => {
  assert.match(no('http://0.0.0.0:5173/'), /localhost:5173/);
});

test('other kinds of address do not open', () => {
  no('file:///etc/hosts');
  no('javascript:alert(1)');
  no('data:text/html,hi');
  no('ftp://localhost/');
  no('ws://localhost:5173');
  no('chrome://settings');
  no('vscode://file/x');
  no('about:blank');
  no('');
  no('not an address');
});

test('an address with a name or password does not open', () => {
  no('http://user:pass@localhost:3000/');
  no('http://user@localhost:3000/');
});

test('control characters are refused before parsing', () => {
  no('http://localhost:3000/\nx');
  no('http://local\thost:3000/');
});

test('the browser is offered only plain web addresses', () => {
  assert.equal(forBrowser('https://example.com/a'), 'https://example.com/a');
  assert.equal(forBrowser('http://localhost:3000'), 'http://localhost:3000/');
  assert.equal(forBrowser('file:///etc/hosts'), null);
  assert.equal(forBrowser('javascript:alert(1)'), null);
  assert.equal(forBrowser('https://me:pw@example.com/'), null);
  assert.equal(forBrowser('mailto:a@b.c'), null);
  assert.equal(forBrowser(undefined), null);
});
