// Tests for how the benchmarks score an agent's work: each check passes the
// right result and fails a wrong one. No agent or model is started. Run with
// `npm test`.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createWriteStream } = require('node:fs');
const { buildMapRequest, makeCopy, runLimited, settle, TASKS, QUESTIONS, git } = require('./bench');

// A copy for one test, removed when the test ends.
async function copy(t, name) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'invader-bench-test-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const dir = path.join(base, name);
  await makeCopy(name, dir);
  return dir;
}

test('the map request is the one the Build map button types', async () => {
  const text = await buildMapRequest();
  assert.match(text, /^Write map\.json at the top of this folder for invader/);
  assert.match(text, /Write only map\.json and change nothing else\.$/);
  assert.ok(text.includes('invader checks that the named files and folders exist in the open folder and each quote occurs in its file, not whether the labels are true or important parts are missing.'));
});

test('each question accepts its answer and not a wrong one', () => {
  const right = ['main/disk.js', '8 seconds', 'window/paste.js', 'INVADER_KIT'];
  QUESTIONS.forEach(([, check], i) => {
    assert.ok(check.test(right[i]), right[i]);
    assert.ok(!check.test(right[(i + 1) % right.length]), right[(i + 1) % right.length]);
  });
});

test('map: invader\'s own map passes; a made-up path or another changed file fails', async (t) => {
  const dir = await copy(t, 'map');
  assert.equal((await TASKS.map.score(dir)).detail, 'wrote no map.json');
  await git(dir, 'checkout', 'HEAD~1', '--', 'map.json');
  await git(dir, 'reset', '-q');
  const good = await TASKS.map.score(dir);
  assert.ok(good.pass, good.detail);
  const map = JSON.parse(await fs.readFile(path.join(dir, 'map.json'), 'utf8'));
  map.groups[0].boxes[0].paths.push('nowhere.md');
  await fs.writeFile(path.join(dir, 'map.json'), JSON.stringify(map));
  assert.ok(!(await TASKS.map.score(dir)).pass);
  await git(dir, 'checkout', 'HEAD~1', '--', 'map.json');
  await git(dir, 'reset', '-q');
  await fs.appendFile(path.join(dir, 'README.md'), 'more\n');
  const other = await TASKS.map.score(dir);
  assert.ok(!other.pass);
  assert.match(other.detail, /also changed README\.md/);
});

test('find: right answers pass; one wrong answer fails', async (t) => {
  const dir = await copy(t, 'find');
  const file = path.join(dir, 'answers.txt');
  await fs.writeFile(file, '1. main/disk.js\n2. 8\n3. window/paste.js\n4. INVADER_KIT\n');
  assert.ok((await TASKS.find.score(dir)).pass);
  await fs.writeFile(file, '1. main/main.js\n2. 8\n3. window/paste.js\n4. INVADER_KIT\n');
  assert.equal((await TASKS.find.score(dir)).detail, '3/4 right');
});

test('fix: the planted bug fails; fixing the code passes; changing a test fails', async (t) => {
  const dir = await copy(t, 'fix');
  assert.ok(!(await TASKS.fix.score(dir)).pass);
  const file = path.join(dir, 'main', 'map.js');
  const code = await fs.readFile(file, 'utf8');
  await fs.writeFile(file, code.replace("p.endsWith('/') && found.dir", "p.endsWith('/') && !found.dir"));
  const fixed = await TASKS.fix.score(dir);
  assert.ok(fixed.pass, fixed.detail);
  await fs.appendFile(path.join(dir, 'main', 'map.test.js'), '\n');
  assert.ok(!(await TASKS.fix.score(dir)).pass);
});

test('a run stopped at the time limit fails, even when what it left passes', () => {
  const good = { pass: true, detail: '25/25 checked' };
  assert.deepEqual(settle(good, { code: 0, timedOut: false }), good);
  const late = settle(good, { code: null, timedOut: true });
  assert.equal(late.pass, false);
  assert.match(late.detail, /^stopped after 5 minutes; 25\/25 checked$/);
  assert.equal(settle(good, { code: 1, timedOut: false }).pass, true);
});

test('a program that ignores the first request to stop is made to stop, on time', async () => {
  const started = Date.now();
  const ran = await runLimited(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"], { ms: 300, grace: 200 });
  assert.equal(ran.timedOut, true);
  assert.ok(Date.now() - started < 3000, 'took ' + (Date.now() - started) + ' ms');
});

test('a run ends when the program does, and what it left running is stopped', async (t) => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'invader-bench-test-'));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const log = path.join(base, 'out.log');
  const out = createWriteStream(log);
  // It starts a program that holds its output for 30 seconds, says its pid and ends.
  const leaves = "const c = require('node:child_process').spawn('sleep', ['30'], { stdio: 'inherit' }); c.unref(); console.log(c.pid);";
  const started = Date.now();
  const ran = await runLimited(process.execPath, ['-e', leaves], { ms: 60000, out, grace: 200 });
  await new Promise((resolve) => out.end(resolve));
  assert.equal(ran.timedOut, false);
  assert.equal(ran.code, 0);
  assert.ok(Date.now() - started < 3000, 'took ' + (Date.now() - started) + ' ms');
  const pid = Number((await fs.readFile(log, 'utf8')).trim());
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.throws(() => process.kill(pid, 0), 'the program it left running is still there');
});
