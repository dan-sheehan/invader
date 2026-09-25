// Agent setup: what claude and codex are told when they start in the open
// folder. Their instructions, settings and permissions, what they run on their
// own, their connections, skills, commands and helpers. The lesson from
// cockpit-v2: much of what shapes the agent sits in hidden files, some of them
// outside the folder.
//
// Outside the open folder and ~/kit, it reads only these files: ~/.claude and ~/.codex (or CLAUDE_CONFIG_DIR and
// CODEX_HOME), ~/.claude.json, ~/.agents/skills, instruction files in the
// folders above the open folder, and the managed settings an administrator
// may set. It only reads them. Files outside the open folder are shown with
// secrets hidden, and only files the last scan found can be shown.
//
// It also counts, in words, what each agent reads at the start of a session:
// its instruction files, with the files they bring in with @, and the names
// and descriptions of its skills, commands and helpers. A file brought in is
// read only to count it; it is not shown.

const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Lexer } = require('marked');
const { parseToml } = require('./toml');
const { redact, redactArgs, redactJson, redactToml } = require('./redact');

const MAX_BYTES = 1024 * 1024;
const MAX_STATE_BYTES = 32 * 1024 * 1024; // ~/.claude.json keeps a long record
const MAX_ITEMS = 600;
const MAX_IMPORT_HOPS = 5; // as deep as Claude Code follows @ imports

// Plain words for what starts a Claude Code hook.
const EVENTS = {
  PreToolUse: 'before it uses a tool',
  PostToolUse: 'after it uses a tool',
  PostToolUseFailure: 'after a tool fails',
  UserPromptSubmit: 'when you send a message',
  SessionStart: 'when a session starts',
  SessionEnd: 'when a session ends',
  Stop: 'when it finishes answering',
  SubagentStart: 'when a helper starts',
  SubagentStop: 'when a helper finishes',
  Notification: 'when it notifies you',
  PreCompact: 'before it shortens the conversation',
  PermissionRequest: 'when it asks for permission',
};

const CLAUDE_MODES = {
  default: 'asks before changing files or running commands',
  acceptEdits: 'changes files without asking, asks before commands',
  plan: 'plans only, changes nothing',
  bypassPermissions: 'does anything without asking',
  dontAsk: 'does only what is allowed, never asks',
};

const CODEX_APPROVAL = {
  untrusted: 'asks before any command not known to be safe',
  'on-failure': 'asks when a command fails in its sandbox',
  'on-request': 'decides itself when to ask',
  never: 'never asks',
};

const CODEX_SANDBOX = {
  'read-only': 'may only read files',
  'workspace-write': 'may change files in this folder only',
  'danger-full-access': 'may change anything on this computer',
};

const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const strs = (v) => (Array.isArray(v) ? v.filter((s) => typeof s === 'string') : []);
const str = (v) => (typeof v === 'string' && v.trim() ? v : null);
const list = (label, items, max = 12) =>
  items.length ? label + ': ' + items.slice(0, max).map(redact).join(', ') + (items.length > max ? ', and ' + (items.length - max) + ' more' : '') : null;

// A file's text, or null when it is missing, not a file, too large or binary.
async function readText(abs, max = MAX_BYTES) {
  try {
    const info = await fs.stat(abs);
    if (!info.isFile() || info.size > max) return null;
    const buffer = await fs.readFile(abs);
    return buffer.includes(0) ? null : buffer.toString('utf8');
  } catch {
    return null;
  }
}

async function entries(dir) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

async function isDir(abs) {
  try {
    return (await fs.stat(abs)).isDirectory();
  } catch {
    return false;
  }
}

async function exists(abs) {
  try {
    await fs.lstat(abs);
    return true;
  } catch {
    return false;
  }
}

const words = (text) => (String(text).match(/\S+/g) || []).length;

// The files a CLAUDE.md brings in with @, like `@HARNESS.md` or
// `@~/notes/me.md`, not counting any inside code. Relative paths are from the
// file's own folder.
function importsIn(text, file, home) {
  const out = [];
  const plain = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const m of plain.matchAll(/(?:^|\s)@((?:~\/|\.{0,2}\/)?[A-Za-z0-9_.~\/-]+)/gm)) {
    const p = m[1].replace(/[.,;:]+$/, '');
    if (!p) continue;
    out.push(p.startsWith('~/') ? path.join(home, p.slice(2)) : path.resolve(path.dirname(file), p));
  }
  return out;
}

// The name and description in a Markdown file's front matter, the block
// between --- lines at its top.
function frontMatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return {};
  const out = {};
  for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
    const m = /^(name|description):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    let value = m[2].trim();
    if (/^[|>][-+]?$/.test(value)) {
      const more = [];
      while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1])) more.push(lines[++i].trim());
      value = more.join(' ');
    }
    out[m[1]] = value.replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

// The folders from the top of the disk down to dir, not counting / and dir.
function above(dir) {
  const out = [];
  for (let d = path.dirname(dir); d !== path.dirname(d); d = path.dirname(d)) out.unshift(d);
  return out;
}

// The sources the last scan found, by id: only these can be shown.
let sources = new Map();

async function scanSetup(root, { home = os.homedir(), env = process.env, managed = '/Library/Application Support/ClaudeCode' } = {}) {
  const items = [];
  const found = new Map();
  const shown = (abs) => (abs === home ? '~' : abs.startsWith(home + path.sep) ? '~' + abs.slice(home.length) : abs);
  const inRoot = (abs) => (abs === root || abs.startsWith(root + path.sep) ? path.relative(root, abs) : null);

  // One thing the agent is told. file is where it lives; pick names the part
  // of a shared file it is, like one connection in ~/.claude.json.
  function add(item, file, how, pick = null) {
    if (items.length >= MAX_ITEMS) return;
    const id = file + (pick ? '#' + pick : '');
    found.set(id, { file, how, pick });
    items.push({ lines: [], about: null, off: null, ...item, id, file: shown(file), rel: pick ? null : inRoot(file) });
  }

  // Claude Code.

  const claudeDir = env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude');
  const stateFile = env.CLAUDE_CONFIG_DIR && (await exists(path.join(claudeDir, '.claude.json')))
    ? path.join(claudeDir, '.claude.json') : path.join(home, '.claude.json');
  const claude = (item, file, how, pick) => add({ agent: 'claude', ...item }, file, how, pick);

  async function instructions(agent, file, scope, off = null) {
    const text = await readText(file);
    if (text === null) return false;
    const brought = agent === 'claude' ? await imported(text, file) : [];
    add({ agent, kind: 'instructions', name: path.basename(file), scope, off: off || (text.trim() ? null : 'empty'), words: words(text), imports: brought }, file, 'md');
    return !!text.trim();
  }

  // What a CLAUDE.md brings in with @, and what those bring in, each once:
  // where it is and how many words it holds.
  async function imported(text, file, hops = 1, done = new Set([file])) {
    const out = [];
    if (hops > MAX_IMPORT_HOPS) return out;
    for (const abs of importsIn(text, file, home)) {
      if (done.has(abs)) continue;
      done.add(abs);
      const more = await readText(abs);
      if (more === null) continue;
      out.push({ file: shown(abs), words: words(more) }, ...(await imported(more, abs, hops + 1, done)));
    }
    return out;
  }

  async function settings(file, scope) {
    const text = await readText(file);
    if (text === null) return;
    let data;
    try {
      data = obj(JSON.parse(text));
    } catch {
      claude({ kind: 'settings', name: path.basename(file), scope, off: 'cannot be read: not valid JSON' }, file, 'text');
      return;
    }
    const perms = obj(data.permissions);
    const mode = str(perms.defaultMode);
    claude({
      kind: 'settings', name: path.basename(file), scope,
      lines: [
        str(data.model) && 'model: ' + data.model,
        mode && 'mode: ' + (CLAUDE_MODES[mode] || mode),
        list('may do without asking', strs(perms.allow)),
        list('asks first', strs(perms.ask)),
        list('never', strs(perms.deny)),
        list('sets for its programs (values hidden)', Object.keys(obj(data.env))),
      ].filter(Boolean),
    }, file, 'json');
    for (const [event, groups] of Object.entries(obj(data.hooks))) {
      for (const group of Array.isArray(groups) ? groups : []) {
        const matcher = str(obj(group).matcher);
        for (const hook of Array.isArray(obj(group).hooks) ? group.hooks : []) {
          const h = obj(hook);
          const what = str(h.command) ? 'runs: ' + redact(h.command) : str(h.prompt) ? 'asks a model: ' + redact(h.prompt) : 'type: ' + (str(h.type) || 'unknown');
          claude({ kind: 'hook', name: (EVENTS[event] || event) + (matcher && matcher !== '*' ? ' · ' + matcher : ''), scope, lines: [what] }, file, 'json');
        }
      }
    }
    for (const [name, on] of Object.entries(obj(data.enabledPlugins))) {
      if (on === true) claude({ kind: 'plugin', name, scope, about: 'Can add its own skills, commands, hooks and connections.' }, file, 'json');
    }
  }

  async function skills(agent, dir, scope, lines = []) {
    for (const e of await entries(dir)) {
      if (e.name.startsWith('.')) continue;
      const file = path.join(dir, e.name, 'SKILL.md');
      const text = await readText(file);
      if (text === null) continue;
      const fm = frontMatter(text);
      add({ agent, kind: 'skill', name: fm.name || e.name, scope, about: fm.description || null, lines, words: words((fm.name || e.name) + ' ' + (fm.description || '')) }, file, 'md');
    }
  }

  // Skills and plugins Claude Code keeps in step with my claude.ai account,
  // in ~/.claude/skills/synced/<account>/ and ~/.claude/plugins/synced/<account>/.
  // It loads them in every folder, like my own.
  const SYNCED = ['synced from claude.ai'];
  async function synced() {
    for (const account of await entries(path.join(claudeDir, 'skills', 'synced'))) {
      if (!account.name.startsWith('.')) await skills('claude', path.join(claudeDir, 'skills', 'synced', account.name), 'everywhere', SYNCED);
    }
    for (const account of await entries(path.join(claudeDir, 'plugins', 'synced'))) {
      if (account.name.startsWith('.')) continue;
      for (const e of await entries(path.join(claudeDir, 'plugins', 'synced', account.name))) {
        const file = path.join(claudeDir, 'plugins', 'synced', account.name, e.name, '.claude-plugin', 'plugin.json');
        if (e.name.startsWith('.') || !(await exists(file))) continue;
        claude({ kind: 'plugin', name: e.name, scope: 'everywhere', about: 'Can add its own skills, commands, hooks and connections.', lines: SYNCED }, file, 'json');
      }
    }
  }

  // Commands and helpers are Markdown files, possibly in folders of their own.
  async function markdownTree(kind, dir, scope, prefix = '') {
    for (const e of await entries(dir)) {
      const abs = path.join(dir, e.name);
      if (e.name.startsWith('.')) continue;
      if (await isDir(abs)) await markdownTree(kind, abs, scope, prefix + e.name + ':');
      else if (/\.md$/i.test(e.name)) {
        const text = await readText(abs);
        if (text === null) continue;
        const fm = frontMatter(text);
        const base = e.name.replace(/\.md$/i, '');
        const name = kind === 'command' ? '/' + prefix + base : fm.name || base;
        claude({ kind, name, scope, about: fm.description || null, words: words(name + ' ' + (fm.description || '')) }, abs, 'md');
      }
    }
  }

  function connection(agent, name, raw, scope, file, how, pick, off = null) {
    const s = obj(raw);
    const envKeys = Object.keys(obj(s.env));
    const headerKeys = Object.keys({ ...obj(s.headers), ...obj(s.http_headers), ...obj(s.env_http_headers) });
    add({
      agent, kind: 'connection', name, scope,
      off: off || (s.enabled === false || s.disabled === true ? 'turned off' : null),
      lines: [
        str(s.command) && 'runs: ' + [s.command, ...redactArgs(strs(s.args))].map(redact).join(' '),
        str(s.url) && 'connects to: ' + redact(s.url),
        list('uses (values hidden)', [...envKeys, ...headerKeys]),
      ].filter(Boolean),
    }, file, how, pick);
  }

  const state = obj(safeJson(await readText(stateFile, MAX_STATE_BYTES)));
  const here = obj(obj(state.projects)[root]);

  // Set by an administrator, then mine everywhere, then the folders above,
  // then this folder: from the most general to the most particular.
  await instructions('claude', path.join(managed, 'CLAUDE.md'), 'managed');
  await settings(path.join(managed, 'managed-settings.json'), 'managed');
  await instructions('claude', path.join(claudeDir, 'CLAUDE.md'), 'everywhere');
  await settings(path.join(claudeDir, 'settings.json'), 'everywhere');
  for (const [name, raw] of Object.entries(obj(state.mcpServers))) {
    connection('claude', name, raw, 'everywhere', stateFile, 'state', 'mcpServers.' + name);
  }
  await skills('claude', path.join(claudeDir, 'skills'), 'everywhere');
  await synced();
  await markdownTree('command', path.join(claudeDir, 'commands'), 'everywhere');
  await markdownTree('helper', path.join(claudeDir, 'agents'), 'everywhere');
  for (const dir of above(root)) {
    await instructions('claude', path.join(dir, 'CLAUDE.md'), 'above');
    await instructions('claude', path.join(dir, 'CLAUDE.local.md'), 'above');
  }
  await instructions('claude', path.join(root, 'CLAUDE.md'), 'folder');
  await instructions('claude', path.join(root, '.claude', 'CLAUDE.md'), 'folder');
  await instructions('claude', path.join(root, 'CLAUDE.local.md'), 'mine-here');
  await settings(path.join(root, '.claude', 'settings.json'), 'folder');
  await settings(path.join(root, '.claude', 'settings.local.json'), 'mine-here');
  const mcpFile = path.join(root, '.mcp.json');
  const mcpText = await readText(mcpFile);
  if (mcpText !== null) {
    const off = new Set(strs(here.disabledMcpjsonServers));
    const on = new Set(strs(here.enabledMcpjsonServers));
    const all = here.enableAllProjectMcpServers === true;
    for (const [name, raw] of Object.entries(obj(obj(safeJson(mcpText)).mcpServers))) {
      const why = off.has(name) ? 'turned off' : all || on.has(name) ? null : 'claude asks you before using it';
      connection('claude', name, raw, 'folder', mcpFile, 'json', null, why);
    }
  }
  for (const [name, raw] of Object.entries(obj(here.mcpServers))) {
    connection('claude', name, raw, 'mine-here', stateFile, 'state', 'projects.' + root + '.mcpServers.' + name);
  }
  await skills('claude', path.join(root, '.claude', 'skills'), 'folder');
  await markdownTree('command', path.join(root, '.claude', 'commands'), 'folder');
  await markdownTree('helper', path.join(root, '.claude', 'agents'), 'folder');

  // Codex.

  const codexDir = env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex');
  const codex = (item, file, how, pick) => add({ agent: 'codex', ...item }, file, how, pick);

  // In each folder Codex reads AGENTS.override.md when it has something in
  // it, and AGENTS.md otherwise.
  async function agentsFiles(dir, scope) {
    const override = path.join(dir, 'AGENTS.override.md');
    const used = await instructions('codex', override, scope);
    await instructions('codex', path.join(dir, 'AGENTS.md'), scope, used ? 'not read: AGENTS.override.md is read instead' : null);
  }

  async function config(file, scope) {
    const text = await readText(file);
    if (text === null) return;
    const { data, errors } = parseToml(text);
    const trust = str(obj(obj(data.projects)[root]).trust_level);
    codex({
      kind: 'settings', name: path.basename(file), scope,
      lines: [
        str(data.model) && 'model: ' + data.model,
        str(data.approval_policy) && 'asking: ' + (CODEX_APPROVAL[data.approval_policy] || data.approval_policy),
        str(data.sandbox_mode) && 'sandbox: ' + (CODEX_SANDBOX[data.sandbox_mode] || data.sandbox_mode),
        trust && 'this folder is ' + (trust === 'trusted' ? 'trusted' : trust),
        errors.length && errors.length + (errors.length === 1 ? ' line' : ' lines') + ' invader cannot read',
      ].filter(Boolean),
    }, file, 'toml');
    const notify = strs(data.notify);
    if (notify.length) codex({ kind: 'hook', name: 'when it finishes a turn', scope, lines: ['runs: ' + redactArgs(notify).join(' ')] }, file, 'toml');
    for (const [name, raw] of Object.entries(obj(data.mcp_servers))) connection('codex', name, raw, scope, file, 'toml');
  }

  // Which commands Codex may run, must ask about, or must not run.
  async function rules(dir, scope) {
    for (const e of await entries(dir)) {
      if (!e.name.endsWith('.rules')) continue;
      const file = path.join(dir, e.name);
      const text = await readText(file);
      if (text === null) continue;
      const by = { allow: [], prompt: [], forbidden: [] };
      for (const line of text.split(/\r?\n/)) {
        if (!/^\s*prefix_rule\s*\(/.test(line)) continue;
        const pattern = /pattern\s*=\s*\[([^\]]*)\]/.exec(line)?.[1].match(/"(?:\\.|[^"\\])*"|'[^']*'/g)?.map((q) => q.slice(1, -1)).join(' ');
        const decision = /decision\s*=\s*["'](\w+)["']/.exec(line)?.[1];
        if (pattern && by[decision]) by[decision].push(pattern);
      }
      codex({
        kind: 'settings', name: 'rules/' + e.name, scope,
        lines: [list('may run without asking', by.allow), list('asks first', by.prompt), list('never', by.forbidden)].filter(Boolean),
      }, file, 'text');
    }
  }

  // Codex reads the folders from the top of the repository down to where it
  // starts; without a repository, only that folder.
  let top = root;
  for (const dir of [root, ...above(root).reverse()]) {
    if (await exists(path.join(dir, '.git'))) {
      top = dir;
      break;
    }
  }
  const project = top === root ? [] : above(root).filter((d) => d === top || d.startsWith(top + path.sep));

  await agentsFiles(codexDir, 'everywhere');
  await config(path.join(codexDir, 'config.toml'), 'everywhere');
  await rules(path.join(codexDir, 'rules'), 'everywhere');
  await skills('codex', path.join(codexDir, 'skills'), 'everywhere');
  await skills('codex', path.join(home, '.agents', 'skills'), 'everywhere');
  for (const dir of project) {
    await agentsFiles(dir, 'above');
    await skills('codex', path.join(dir, '.agents', 'skills'), 'above');
  }
  await agentsFiles(root, 'folder');
  await config(path.join(root, '.codex', 'config.toml'), 'folder');
  await rules(path.join(root, '.codex', 'rules'), 'folder');
  await skills('codex', path.join(root, '.agents', 'skills'), 'folder');

  sources = found;
  return { root, items, claude: await isDir(claudeDir), codex: await isDir(codexDir), full: items.length >= MAX_ITEMS };
}

function safeJson(text) {
  try {
    return text === null ? null : JSON.parse(text);
  } catch {
    return null;
  }
}

// Pick the part of a parsed file a dotted pick names, like
// "projects./a/b.mcpServers.docs"; a project path may hold dots.
function pickFrom(data, pick) {
  const [head, ...rest] = pick.split('.');
  if (head === 'projects') {
    const projects = obj(data.projects);
    const key = Object.keys(projects).find((k) => rest.join('.').startsWith(k + '.mcpServers.'));
    if (!key) return undefined;
    const name = rest.join('.').slice(key.length + '.mcpServers.'.length);
    return obj(obj(projects[key]).mcpServers)[name];
  }
  return obj(data[head])[rest.join('.')];
}

// One source from the last scan, to read: its text with secrets hidden, and
// Markdown tokens when it is Markdown. Nothing else can be read this way.
async function readSetup(id, home = os.homedir()) {
  const source = sources.get(id);
  if (!source) throw new Error('Not part of the agent setup any more. Look again.');
  const { file, how, pick } = source;
  const shown = file.startsWith(home + path.sep) ? '~' + file.slice(home.length) : file;
  const text = await readText(file, how === 'state' ? MAX_STATE_BYTES : MAX_BYTES);
  if (text === null) throw new Error('Cannot be read any more.');
  if (how === 'state') {
    const part = pickFrom(obj(safeJson(text)), pick);
    if (part === undefined) throw new Error('No longer in ' + shown + '.');
    const name = pick.split('.').pop();
    return { path: shown, text: JSON.stringify({ [name]: redactJson(part) }, null, 2), note: 'Only this connection is shown; the rest of ' + shown + ' is Claude Code\'s own record. Values under env and headers are hidden.' };
  }
  if (how === 'json') {
    const data = safeJson(text);
    if (data === null) return { path: shown, text: redact(text), note: 'Not valid JSON. What looks like a key or password is hidden.' };
    return { path: shown, text: JSON.stringify(redactJson(data), null, 2), note: 'Shown tidied, with values under env and headers hidden.' };
  }
  if (how === 'toml') return { path: shown, text: redactToml(text), note: 'Values under env and headers are hidden.' };
  const clean = redact(text);
  const note = clean === text ? null : 'What looks like a key or password is hidden.';
  return { path: shown, text: clean, tokens: how === 'md' ? Lexer.lex(clean) : null, note };
}

module.exports = { scanSetup, readSetup, frontMatter, importsIn };
