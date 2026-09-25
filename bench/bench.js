// Model benchmarks: how well a coding agent and its model do the work invader
// asks of them. Run by hand from the terminal; the app never runs this.
//
//   npm run bench -- claude:sonnet codex opencode:opencode/space-bunny-free
//   npm run bench -- claude:haiku --task find
//
// Each task runs in a throwaway copy of invader at a fixed commit, in the
// system's temporary folder, and is scored by checks that need no judgment,
// most of them invader's own. Only that copy of invader's code is sent to
// the model. Results are added to bench/results.md.

const { execFile, spawn } = require('node:child_process');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { checkMap } = require('../main/map');

const APP = path.join(__dirname, '..');
const RESULTS = path.join(__dirname, 'results.md');
// The commit every copy starts from. The answers below were read from it.
const FIXTURE = 'f4e723f';
const LIMIT_MS = 5 * 60 * 1000;
const SCORE_MS = 2 * 60 * 1000;  // scoring a task, like running its tests
const GRACE_MS = 5000;           // between asking a program to stop and making it

// How each agent takes one request with nobody at the keyboard. It may read
// and edit files in its copy and run npm test.
const OPENCODE_RULES = JSON.stringify({
  permission: { edit: 'allow', bash: { '*': 'deny', 'npm test': 'allow' }, webfetch: 'deny', external_directory: 'deny' },
});
const AGENTS = {
  claude: (model, prompt) => ['claude', ['-p', prompt, '--no-session-persistence', '--permission-mode', 'acceptEdits',
    '--allowedTools', 'Bash(npm test)', ...(model ? ['--model', model] : [])]],
  codex: (model, prompt, dir) => ['codex', ['exec', '--ephemeral', '--skip-git-repo-check', '-s', 'workspace-write', '-C', dir,
    ...(model ? ['-m', model] : []), prompt]],
  // opencode works where PWD says unless told the folder.
  opencode: (model, prompt, dir) => ['opencode', ['run', '--dir', dir, ...(model ? ['-m', model] : []), prompt], { OPENCODE_CONFIG_CONTENT: OPENCODE_RULES }],
};

const git = (dir, ...args) => new Promise((resolve, reject) => {
  execFile('git', ['-C', dir, '-c', 'user.name=bench', '-c', 'user.email=bench@localhost', ...args],
    (err, out) => (err ? reject(err) : resolve(out)));
});

// Files changed in the copy since its last commit, as git names them.
async function changedFiles(dir) {
  const out = await git(dir, 'status', '--porcelain', '-uall');
  return out.split('\n').filter(Boolean).map((line) => line.slice(3));
}

// What git says about a folder: what changed and how, so a change made
// while an agent ran shows.
async function folderState(dir) {
  return (await git(dir, 'status', '--porcelain', '-uall')) + (await git(dir, 'diff'));
}

// The request the Build map button types, taken from the window's own code
// so it cannot drift from what invader really asks.
async function buildMapRequest() {
  const code = await fs.readFile(path.join(APP, 'window', 'map-view.js'), 'utf8');
  const stub = new Proxy(function () {}, {
    get: () => stub,
    apply: () => stub,
    construct: () => stub,
  });
  const window = { $: () => stub, document: stub, ResizeObserver: stub, state: { openFile: null, info: {} } };
  vm.runInNewContext(code, window);
  return window.mapRequest();
}

// Questions whose answers are in the fixture, each with a check.
const QUESTIONS = [
  ['Which one file of the app writes to the disk? Give its path.', /main\/disk\.js/],
  ['For how many seconds does a file that changed count as just changed?', /\b8\b/],
  ['Which file decides whether a paste into the shell asks first? Give its path.', /window\/paste\.js/],
  ['Which environment variable does the terminal set to the path of the kit?', /INVADER_KIT/],
];

const TASKS = {
  map: {
    about: 'writes map.json from the Build map request; invader checks it',
    async prepare(dir) {
      await git(dir, 'rm', '-q', 'map.json');
      await git(dir, 'commit', '-q', '-m', 'Remove the map');
    },
    prompt: buildMapRequest,
    async score(dir) {
      const others = (await changedFiles(dir)).filter((p) => p !== 'map.json');
      let text;
      try {
        text = await fs.readFile(path.join(dir, 'map.json'), 'utf8');
      } catch {
        return { pass: false, detail: 'wrote no map.json' };
      }
      const map = await checkMap(dir, 'map.json', text);
      if (map.error) return { pass: false, detail: map.error };
      const boxes = map.groups.reduce((n, g) => n + g.boxes.length, 0);
      const total = boxes + map.arrows.length + map.dropped.length;
      const parts = [(total - map.dropped.length) + '/' + total + ' checked', boxes + ' boxes', map.arrows.length + ' arrows'];
      if (others.length) parts.push('also changed ' + others.join(' '));
      return { pass: !map.dropped.length && boxes >= 3 && map.arrows.length >= 1 && !others.length, detail: parts.join(', ') };
    },
  },
  find: {
    about: 'answers questions about the code without changing it',
    prompt: () => 'Answer these questions about the code in this folder. Write the answers to answers.txt, '
      + 'one line per question, numbered, as short as you can. Change nothing else.\n'
      + QUESTIONS.map(([q], i) => (i + 1) + '. ' + q).join('\n'),
    async score(dir) {
      const others = (await changedFiles(dir)).filter((p) => p !== 'answers.txt');
      let lines;
      try {
        lines = (await fs.readFile(path.join(dir, 'answers.txt'), 'utf8')).split('\n').filter((l) => l.trim());
      } catch {
        return { pass: false, detail: 'wrote no answers.txt' };
      }
      const right = QUESTIONS.filter(([, check], i) => check.test(lines[i] ?? '')).length;
      const parts = [right + '/' + QUESTIONS.length + ' right'];
      if (others.length) parts.push('also changed ' + others.join(' '));
      return { pass: right === QUESTIONS.length && !others.length, detail: parts.join(', ') };
    },
  },
  fix: {
    about: 'finds and fixes a bug that makes npm test fail, without touching the tests',
    async prepare(dir) {
      // A box path ending in / that is a folder is now wrongly dropped.
      const file = path.join(dir, 'main', 'map.js');
      const code = await fs.readFile(file, 'utf8');
      await fs.writeFile(file, code.replace("p.endsWith('/') && !found.dir", "p.endsWith('/') && found.dir"));
      await git(dir, 'commit', '-q', '-am', 'Tidy the map checks');
      // The tests need the app's packages; an APFS clone costs no space.
      await new Promise((resolve, reject) => execFile('cp', ['-cR', path.join(APP, 'node_modules'), dir], (err) => (err ? reject(err) : resolve())));
    },
    prompt: () => 'npm test fails in this folder. Find out why and fix the code so every test passes. Do not change any test file.',
    async score(dir) {
      const changed = await changedFiles(dir);
      const tests = changed.filter((p) => p.endsWith('.test.js'));
      const env = { ...process.env };
      delete env.NODE_TEST_CONTEXT; // set when this runs inside npm test itself
      const tested = await runLimited('node', ['--test'], { cwd: dir, env, ms: SCORE_MS });
      const passes = tested.code === 0 && !tested.timedOut;
      const said = tested.timedOut ? 'tests still running after ' + SCORE_MS / 60000 + ' minutes' : passes ? 'tests pass' : 'tests fail';
      const parts = [said, 'changed ' + (changed.join(' ') || 'nothing')];
      return { pass: passes && !tests.length, detail: parts.join(', ') };
    },
  },
};

// How to signal each program running now, each the first of a group of its
// own, so Ctrl-C can stop them and everything they started.
const running = new Set();

// Run cmd in dir for at most ms, its output written to out when given. It
// runs as a group of its own. When it ends, whatever it left running is
// stopped, so a run takes as long as the program did, not as long as
// something it started keeps going. At ms the whole group is asked to stop,
// and made to stop grace ms later. Resolves with its exit code, how many
// seconds it ran, and whether it hit the limit.
function runLimited(cmd, args, { cwd, env, ms, out = null, grace = GRACE_MS }) {
  return new Promise((resolve) => {
    const start = Date.now();
    const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', out ? 'pipe' : 'ignore', out ? 'pipe' : 'ignore'] });
    if (out) {
      child.stdout.pipe(out, { end: false });
      child.stderr.pipe(out, { end: false });
    }
    const signal = (name) => {
      try {
        process.kill(-child.pid, name);
      } catch {}
    };
    let killer = null;
    const stop = () => {
      signal('SIGTERM');
      killer ??= setTimeout(() => signal('SIGKILL'), grace);
    };
    running.add(signal);
    let timedOut = false;
    let exited = null;
    let ended = false;
    const timers = [];
    const done = () => {
      if (ended) return;
      ended = true;
      timers.forEach(clearTimeout);
      running.delete(signal);
      // Nothing of the group is left, so nothing needs making to stop.
      try {
        process.kill(-child.pid, 0);
      } catch {
        clearTimeout(killer);
      }
      const seconds = Math.round(((exited?.at ?? Date.now()) - start) / 1000);
      resolve({ code: exited ? exited.code : -1, seconds, timedOut });
    };
    timers.push(setTimeout(() => {
      timedOut = true;
      stop();
    }, ms));
    // Past the limit and the grace, it is over whatever still holds on.
    timers.push(setTimeout(done, ms + 2 * grace));
    child.on('error', (err) => {
      out?.write(String(err));
      done();
    });
    child.on('exit', (code, sig) => {
      exited = { code: code ?? sig, at: Date.now() };
      stop();
      // Its output ends once what it left running has stopped too.
      timers.push(setTimeout(done, grace + 1000));
    });
    child.on('close', done);
  });
}

// Run one agent on one request in dir, its output kept in log. Settings left
// by whatever started this, like a Claude Code session, are left out, as the
// terminal does.
async function runAgent(contender, prompt, dir, log) {
  const [agent, model] = contender.split(/:(.*)/s);
  const [cmd, args, extra] = AGENTS[agent](model, prompt, dir);
  const env = { ...process.env, ...extra, PWD: dir };
  delete env.INIT_CWD; // npm's, pointing at this folder
  for (const key of Object.keys(env)) if (key.startsWith('ELECTRON_') || key.startsWith('CLAUDE')) delete env[key];
  // Written as it comes, so a run can be watched.
  const out = createWriteStream(log);
  const ran = await runLimited(cmd, args, { cwd: dir, env, ms: LIMIT_MS, out });
  await new Promise((resolve) => out.end(resolve));
  return ran;
}

// The score, given how the run ended. A run stopped at the time limit fails,
// whatever it left behind.
function settle(score, ran) {
  if (ran.timedOut) return { pass: false, detail: 'stopped after ' + LIMIT_MS / 60000 + ' minutes; ' + score.detail };
  if (ran.code !== 0) return { ...score, detail: 'agent ended with ' + ran.code + '; ' + score.detail };
  return score;
}

// A throwaway copy of invader at the fixture, ready for a task, with no way
// back to this folder.
async function makeCopy(name, dir) {
  await new Promise((resolve, reject) => execFile('git', ['clone', '-q', APP, dir], (err) => (err ? reject(err) : resolve())));
  await git(dir, 'checkout', '-q', FIXTURE);
  await git(dir, 'remote', 'remove', 'origin');
  await TASKS[name].prepare?.(dir);
}

async function runTask(contender, name, runDir) {
  const task = TASKS[name];
  const dir = path.join(runDir, contender.replace(/[^\w.-]+/g, '_') + '-' + name);
  await makeCopy(name, dir);
  // An agent that wanders out of its copy into this folder stops the run.
  const before = await folderState(APP);
  const ran = await runAgent(contender, await task.prompt(), dir, dir + '.log');
  if ((await folderState(APP)) !== before) {
    throw new Error(contender + ' changed files in ' + APP + ' instead of its copy. See ' + dir + '.log and git status there.');
  }
  const score = settle(await task.score(dir), ran);
  return { contender, task: name, ...score, seconds: ran.seconds };
}

// Rows are only ever added, so runs side by side cannot lose each other's.
async function addResults(rows) {
  const head = '# Benchmark results\n\nAdded by `npm run bench`, newest last. Not committed.\n\n'
    + '| When | Agent and model | Task | Result | Detail | Seconds |\n| --- | --- | --- | --- | --- | --- |\n';
  await fs.writeFile(RESULTS, head, { flag: 'wx' }).catch(() => {});
  const when = new Date().toLocaleString('sv-SE').slice(0, 16); // local time, like 2026-09-23 18:02
  await fs.appendFile(RESULTS, rows.map((r) => `| ${when} | ${r.contender} | ${r.task} | ${r.pass ? 'pass' : 'fail'} | ${r.detail.replace(/\|/g, '/')} | ${r.seconds} |\n`).join(''));
}

async function main() {
  const args = process.argv.slice(2);
  const tasks = args.flatMap((a, i) => (args[i - 1] === '--task' ? [a] : []));
  const contenders = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--task');
  const unknown = [...contenders.filter((c) => !AGENTS[c.split(':')[0]]), ...tasks.filter((t) => !TASKS[t])];
  if (!contenders.length || unknown.length) {
    console.log('Usage: npm run bench -- <agent[:model]>... [--task <task>]...');
    console.log('Agents: ' + Object.keys(AGENTS).join(', ') + '. Tasks:');
    for (const [name, t] of Object.entries(TASKS)) console.log('  ' + name + ': ' + t.about);
    if (unknown.length) console.log('Not known: ' + unknown.join(', '));
    process.exitCode = 1;
    return;
  }
  // The agents run as groups of their own, so Ctrl-C would not reach them.
  process.on('SIGINT', () => {
    for (const signal of running) signal('SIGKILL');
    process.exit(130);
  });
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), 'invader-bench-'));
  console.log('Copies and agent output: ' + runDir);
  const rows = [];
  for (const contender of contenders) {
    for (const name of tasks.length ? tasks : Object.keys(TASKS)) {
      process.stdout.write(contender + ' ' + name + ' … ');
      const row = await runTask(contender, name, runDir);
      console.log((row.pass ? 'pass' : 'fail') + ', ' + row.detail + ', ' + row.seconds + ' s');
      rows.push(row);
    }
  }
  await addResults(rows);
  console.log('Added to bench/results.md');
}

if (require.main === module) main();

module.exports = { buildMapRequest, makeCopy, runLimited, settle, TASKS, QUESTIONS, git };
