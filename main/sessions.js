// Last sessions: what claude and codex did in the open folder, read from the
// records they keep themselves. Claude Code keeps one file per session in
// ~/.claude/projects/<the folder, with every sign a dash>/, Codex in
// ~/.codex/sessions/<year>/<month>/<day>/ (or CLAUDE_CONFIG_DIR and
// CODEX_HOME). invader only reads them and keeps nothing. From each session
// it passes the window only when it ran, its name or the first line I typed
// (secrets hidden), the files it changed, with its own edit tools or with a
// shell command that names the file it writes, and how many shell commands it
// ran, since a command that works out a file's name as it runs is not seen.
// When I replay one, it passes its steps: when each happened, and which files
// in the open folder it read, changed, or named in a shell command. While one
// runs, it passes the same for its newest steps, every few seconds. Never
// the conversation, the commands themselves or what the agent said.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { redact } = require('./redact');

const MAX_BYTES = 64 * 1024 * 1024; // larger records are skipped
const MAX_CODEX_LOOKS = 400;        // Codex records looked at to find this folder's
const MAX_TYPED = 120;
const MAX_STEPS = 2000;             // steps of one session passed for a replay
const MAX_NAMED = 40;               // words of one command looked at as paths

const CLAUDE_EDITS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
// Codex runs a command as a call of its own in older versions, and as
// tools.exec_command(...) inside a script it writes in newer ones.
const CODEX_SHELL = new Set(['shell', 'shell_command', 'exec_command', 'local_shell']);
const CODEX_EXEC = /\bexec_command\(/g;
const PATCH_FILE = /\*\*\* (?:Add File|Update File|Delete File|Move to): ([^\\"\n]+)/g;

// The files a Codex record line changed with apply_patch: as a call of its
// own, inside a script it wrote (tools.apply_patch(...)), or in a shell
// command. A patch anywhere else, like one quoted in a message or printed by
// a command, changed nothing.
function patchedFiles(o) {
  const p = o.payload;
  if (o.type !== 'response_item' || !p) return [];
  const c = p.action?.command;
  const text = p.type === 'custom_tool_call' ? p.input
    : p.type === 'function_call' ? p.arguments
      : p.type === 'local_shell_call' ? (Array.isArray(c) ? c.join('\n') : c)
        : null;
  if (typeof text !== 'string' || !text.includes('*** ')) return [];
  if (p.name !== 'apply_patch' && !/\bapply_patch\b/.test(text)) return [];
  return [...text.matchAll(PATCH_FILE)].map((m) => m[1].trim());
}

// What was read, by file, so a record that did not change is not read again.
const cache = new Map();
// The record each session came from, and the sessions last listed for each
// folder: only those can be replayed.
const recordOf = new Map();
const listed = new Map();

// The request the Build map and Update map buttons type, which is the same
// every time, so a session that starts with it is named after the button.
const MAP_REQUEST = /^(Write|Update) (?:\S*\/)?map\.json\b[^.]*? for invader\b/;

// The first line of what I typed, without the blocks an app wraps around it,
// like <pasted_content> or <command-name>. A message that was only pasted
// gives the first line of what was pasted. A message that was only a command
// or other wrapped text gives null.
function typedLine(text) {
  if (typeof text !== 'string' || /^\s*# AGENTS\.md instructions/.test(text)) return null;
  const own = text.replace(/<([a-z][a-z_-]*)\b[^>]*>[\s\S]*?<\/\1\b[^>]*>/g, '');
  let line = firstLine(own);
  if (!line && /<pasted_content\b/.test(text)) line = firstLine(text.replace(/<\/?[a-z][a-z_-]*\b[^>]*>/g, ''));
  if (!line || /^\[Request interrupted/.test(line)) return null;
  const map = MAP_REQUEST.exec(line);
  if (map) return map[1] === 'Write' ? 'Build map request' : 'Update map request';
  line = redact(line);
  return line.length > MAX_TYPED ? line.slice(0, MAX_TYPED - 1) + '…' : line;
}

function firstLine(text) {
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s#>*-]+/, '').trim();
    if (line) return line;
  }
  return null;
}

// Every line of a record, parsed. Lines that are not JSON are skipped.
async function eachLine(file, fn) {
  const lines = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const raw of lines) {
    if (!raw) continue;
    let o;
    try {
      o = JSON.parse(raw);
    } catch {
      continue;
    }
    if (fn(o) === false) break;
  }
  lines.close();
}

async function realOrSame(p) {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return p;
  }
}

// A session as the window sees it, from what one record said. editedAt says
// when it last changed each file it edited. Which files are in the open
// folder is decided as a replay decides it.
async function finish(root, agent, file, s) {
  if (s.cwd == null || (await realOrSame(s.cwd)) !== root || !s.start) return null;
  const editedAt = {};
  let outside = 0;
  for (const { p, cwd, kind, t } of s.paths.values()) {
    const rel = await inFolder(root, cwd ?? s.cwd, p, kind, os.homedir());
    // A file a command wrote that is not in the open folder now is not
    // counted anywhere: it may never have been written.
    if (rel) editedAt[rel] = Math.max(editedAt[rel] || 0, t);
    else if (kind === 'changed') outside++;
  }
  return { agent, id: agent + ':' + path.basename(file, '.jsonl'), start: s.start, end: s.end, title: s.title, typed: s.typed, edited: Object.keys(editedAt), editedAt, outside, commands: s.commands };
}

// A file a session changed, and when; the last time counts. kind is
// 'changed' for its edit tools and 'wrote' for a shell command, which ran
// in cwd.
function edit(s, p, o, kind = 'changed', cwd = null) {
  const key = kind + '\n' + cwd + '\n' + p;
  const t = Math.max(s.paths.get(key)?.t || 0, Date.parse(o.timestamp) || 0);
  s.paths.set(key, { p, cwd, kind, t });
}

// The files the shell commands on one line of a record wrote.
function wroteOn(s, agent, o, ctx) {
  for (const r of lineSteps(agent, o, ctx)) if (r.kind === 'wrote') for (const p of r.paths) edit(s, p, o, 'wrote', r.cwd);
}

function seen(s, o) {
  const t = Date.parse(o.timestamp);
  if (!t) return;
  if (!s.start || t < s.start) s.start = t;
  if (!s.end || t > s.end) s.end = t;
}

async function readClaude(root, file) {
  const s = { cwd: null, start: 0, end: 0, title: null, typed: null, paths: new Map(), commands: 0 };
  const ctx = { cwd: null };
  await eachLine(file, (o) => {
    if (o.isSidechain) return;
    if (s.cwd == null && typeof o.cwd === 'string') s.cwd = o.cwd;
    seen(s, o);
    wroteOn(s, 'claude', o, ctx);
    if (o.type === 'custom-title' && typeof o.customTitle === 'string') s.title = redact(o.customTitle).slice(0, MAX_TYPED);
    if (o.type === 'user' && !o.isMeta && !s.typed) {
      const c = o.message?.content;
      s.typed = typedLine(typeof c === 'string' ? c : Array.isArray(c) ? c.find((b) => b?.type === 'text')?.text : null);
    }
    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        const p = b?.input?.file_path ?? b?.input?.notebook_path;
        if (b?.type === 'tool_use' && CLAUDE_EDITS.has(b.name) && typeof p === 'string') edit(s, p, o);
        if (b?.type === 'tool_use' && b.name === 'Bash') s.commands++;
      }
    }
  });
  return s.typed || s.title ? finish(root, 'claude', file, s) : null;
}

async function readCodex(root, file) {
  const s = { cwd: null, start: 0, end: 0, title: null, typed: null, paths: new Map(), commands: 0 };
  const ctx = { cwd: null };
  await eachLine(file, (o) => {
    if (o.type === 'session_meta' && typeof o.payload?.cwd === 'string') s.cwd = o.payload.cwd;
    seen(s, o);
    wroteOn(s, 'codex', o, ctx);
    const p = o.payload;
    if (o.type === 'response_item' && p?.type === 'message' && p.role === 'user' && !s.typed && Array.isArray(p.content)) {
      for (const c of p.content) if (!s.typed && c?.type === 'input_text') s.typed = typedLine(c.text);
    }
    for (const f of patchedFiles(o)) edit(s, f, o);
    if (o.type === 'response_item') {
      if (p?.type === 'local_shell_call' || (p?.type === 'function_call' && CODEX_SHELL.has(p.name))) s.commands++;
      else if (p?.type === 'custom_tool_call' && typeof p.input === 'string') s.commands += (p.input.match(CODEX_EXEC) || []).length;
    }
  });
  return s.typed ? finish(root, 'codex', file, s) : null;
}

// What one record says, read again only when the file changed: its session,
// if it holds one, and whether it could not be read, being too big or
// failing to read. A record that has gone since it was listed is neither.
async function read(root, agent, file) {
  let info;
  try {
    info = await fsp.stat(file);
  } catch {
    return { session: null, failed: false };
  }
  if (!info.isFile()) return { session: null, failed: false };
  if (info.size > MAX_BYTES) return { session: null, failed: true };
  const key = root + '\n' + file;
  const had = cache.get(key);
  if (had && had.mtime === info.mtimeMs && had.size === info.size) return had;
  let session = null;
  let failed = false;
  try {
    session = await (agent === 'claude' ? readClaude : readCodex)(root, file);
  } catch {
    failed = true;
  }
  const entry = { mtime: info.mtimeMs, size: info.size, session, failed };
  // A read that failed is tried again next time.
  if (!failed) cache.set(key, entry);
  if (session) recordOf.set(root + '\n' + session.id, file);
  return entry;
}

async function names(dir) {
  try {
    return (await fsp.readdir(dir)).sort().reverse();
  } catch {
    return [];
  }
}

// Claude Code names a folder's records after it, every sign a dash. A name
// longer than 200 is cut there and a hash of the path added, so every folder
// whose name starts with the cut name is read; each record says which folder
// it ran in, and only those that ran in this one are kept.
const CLAUDE_NAME_MAX = 200;

async function claudeDirs(root, claudeDir) {
  const projects = path.join(claudeDir, 'projects');
  const name = root.replace(/[^A-Za-z0-9]/g, '-');
  if (name.length <= CLAUDE_NAME_MAX) return [path.join(projects, name)];
  const cut = name.slice(0, CLAUDE_NAME_MAX) + '-';
  return (await names(projects)).filter((n) => n.startsWith(cut)).map((n) => path.join(projects, n));
}

// Claude Code's records for this folder, newest first.
async function claudeFiles(root, claudeDir, max) {
  const found = [];
  for (const dir of await claudeDirs(root, claudeDir)) for (const name of await names(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    try {
      found.push({ file: path.join(dir, name), mtime: (await fsp.stat(path.join(dir, name))).mtimeMs });
    } catch {}
  }
  return found.sort((a, b) => b.mtime - a.mtime).slice(0, max * 2).map((f) => f.file);
}

// The folder a record says it ran in, as written, from its first lines.
async function recordCwd(agent, file) {
  let cwd = null;
  let looked = 0;
  try {
    await eachLine(file, (o) => {
      const c = agent === 'claude' ? o.cwd : o.type === 'session_meta' ? o.payload?.cwd : null;
      if (typeof c === 'string') cwd = c;
      return cwd == null && ++looked < 50;
    });
  } catch {}
  return cwd;
}

async function recordFolder(agent, file) {
  const cwd = await recordCwd(agent, file);
  return cwd == null ? null : realOrSame(cwd);
}

// The folder a record ran in, remembered once known. A record just started
// may not say yet, as Claude Code's begins with lines naming no folder, so
// one that did not is looked at again once it has grown.
async function folderOf(agent, file) {
  const key = 'folder\n' + file;
  const had = cache.get(key);
  if (had?.folder != null) return had.folder;
  let size;
  try {
    size = (await fsp.stat(file)).size;
  } catch {
    return null;
  }
  if (had && had.size === size) return null;
  const folder = await recordFolder(agent, file);
  cache.set(key, { folder, size });
  return folder;
}

// Codex's records for this folder, newest first. Codex keeps every folder's
// sessions together by day, so the newest are looked at until enough are found.
async function codexFiles(root, codexDir, max, days = Infinity) {
  const top = path.join(codexDir, 'sessions');
  const found = [];
  let looked = 0;
  for (const year of await names(top))
    for (const month of await names(path.join(top, year)))
      for (const day of await names(path.join(top, year, month))) {
        if (days-- <= 0) return found;
        for (const name of await names(path.join(top, year, month, day))) {
          if (!name.endsWith('.jsonl')) continue;
          if (found.length >= max * 2 || looked++ >= MAX_CODEX_LOOKS) return found;
          const file = path.join(top, year, month, day, name);
          if ((await folderOf('codex', file)) === root) found.push(file);
        }
      }
  return found;
}

// The last few sessions of claude and codex in the open folder, newest first.
// Where claude and codex keep their records.
const agentDirs = (home, env) => ({
  claudeDir: env.CLAUDE_CONFIG_DIR ? path.resolve(env.CLAUDE_CONFIG_DIR) : path.join(home, '.claude'),
  codexDir: env.CODEX_HOME ? path.resolve(env.CODEX_HOME) : path.join(home, '.codex'),
});

async function lastSessions(root, { home = os.homedir(), env = process.env, max = 3 } = {}) {
  const { claudeDir, codexDir } = agentDirs(home, env);
  const [claude, codex] = await Promise.all([claudeFiles(root, claudeDir, max), codexFiles(root, codexDir, max)]);
  const records = await Promise.all([
    ...claude.map((f) => read(root, 'claude', f)),
    ...codex.map((f) => read(root, 'codex', f)),
  ]);
  const last = records.map((r) => r.session).filter(Boolean).sort((a, b) => b.end - a.end).slice(0, max);
  listed.set(root, new Set(last.map((s) => s.id)));
  // Records that could not be read may hide a session, so the window says how many.
  return { root, sessions: last, unread: records.filter((r) => r.failed).length };
}

// Replay. The words of a shell command that may name a file, like game.js in
// `sed -n 1,9p game.js`. Which of them are files in the open folder is
// decided later, on the disk.
function namedPaths(command) {
  if (typeof command !== 'string') return [];
  const found = new Set();
  for (const word of command.split(/[\s;|&<>()'"`=,{}[\]]+/)) {
    const p = word.replace(/:\d+(:\d+)?$/, '').replace(/^\.\//, '');
    if (!/[./]/.test(p) || /^\.+$/.test(p) || p.startsWith('-') || !/^[\w.~/@+-]+$/.test(p)) continue;
    found.add(p);
    if (found.size >= MAX_NAMED) break;
  }
  return [...found];
}

// The files a shell command writes, read from its words only, never run.
// The shell's own words: what a redirect (> or >>), tee, touch, sed -i, cp or
// mv writes to. A Python or Node script in it: what open(..., 'w'),
// write_text or writeFileSync writes to, when the script names the file
// there, or in a name it set to one, a list it goes through, or what a
// function of its own was called with. Which are files in the open folder is
// decided later, on the disk.
const QUOTED = /(['"`])((?:(?!\1)[^\\]|\\.)*)\1/g;
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1([^\n]*)\n[\s\S]*?\n[ \t]*\2(?=\n|$)/g;

function writtenPaths(command) {
  if (typeof command !== 'string') return [];
  const found = new Set();
  const add = (p) => {
    p = p.replace(/^\.\//, '');
    if (/[./]/.test(p) && /^[\w.~/@+-]+$/.test(p) && !/^\.+$/.test(p) && !p.startsWith('-') && !p.startsWith('/dev/')) found.add(p);
  };
  // What the shell reads: a heredoc's lines and quoted text are left out,
  // except a quoted name right after > or tee.
  const shell = command
    .replace(HEREDOC, '$3')
    .replace(QUOTED, (_q, _mark, body, at, all) => (/(?:>|\btee(?:\s+-a)?)\s*$/.test(all.slice(0, at)) ? body : '""'));
  const words = (s) => s.trim().split(/\s+/);
  for (const m of shell.matchAll(/(?:^|[^=<>\-\d&])[12&]?>>?(?!&)\s*([^\s&|;<>()]+)/g)) add(m[1]);
  for (const m of shell.matchAll(/\btee\s+(?:-a\s+)?([^\s&|;<>()]+)/g)) add(m[1]);
  for (const m of shell.matchAll(/\btouch((?:\s+[^\s&|;<>()]+)+)/g)) words(m[1]).forEach(add);
  for (const m of shell.matchAll(/\bsed\s+(?:-[a-zA-Z]*i[a-zA-Z]*|--in-place)((?:\s+[^\s&|;<>()]+)+)/g)) words(m[1]).forEach(add);
  for (const m of shell.matchAll(/\b(?:cp|mv)((?:\s+[^\s&|;<>()]+){2,})/g)) add(words(m[1]).pop());
  // What a Python or Node script handed to it writes to. A write inside the
  // script's own strings, like code it puts into a file, is not one.
  for (const code of scriptsIn(command)) {
    const plain = outsideStrings(code);
    // Matches whose call itself (the last group, or all of it) is code.
    const calls = (re) => [...code.matchAll(re)].filter((m) => {
      const call = m[2] ?? m[0];
      return plain.startsWith(call, m.index + m[0].length - call.length);
    });
    for (const m of calls(/\bopen\(/g)) {
      const [target, mode] = callArgs(code, m.index + m[0].length);
      const how = mode && /^\s*(?:mode\s*=\s*)?(['"])([^'"]*)\1\s*$/.exec(mode);
      if (target && how && /^[wax]/.test(how[2])) targetPaths(target, code, m.index).forEach(add);
    }
    for (const m of calls(/((?:\bPath\([^()\n]*\)|[A-Za-z_][\w.]*)(?:\s*\/\s*(?:"[^"\n]*"|'[^'\n]*'|[A-Za-z_]\w*))*)\s*(\.write_(?:text|bytes)\()/g)) {
      targetPaths(m[1], code, m.index).forEach(add);
    }
    for (const m of calls(/\b(?:writeFileSync|appendFileSync|writeFile|appendFile)\(/g)) {
      const [target] = callArgs(code, m.index + m[0].length);
      if (target) targetPaths(target, code, m.index).forEach(add);
    }
  }
  return [...found].slice(0, MAX_NAMED);
}

// The scripts a command hands to Python or Node: a heredoc it feeds them,
// and the text after -c or -e.
function scriptsIn(command) {
  const out = [];
  for (const m of command.matchAll(/\b(?:python3?|node)\b[^\n]*?<<-?\s*(['"]?)(\w+)\1[^\n]*\n([\s\S]*?)\n[ \t]*\2(?=\n|$)/g)) out.push(m[3]);
  for (const m of command.matchAll(/\b(?:python3?|node)\s+(?:-\w+\s+)*-[ce]\s+(['"])((?:(?!\1)[^\\]|\\.)*)\1/g)) {
    out.push(m[1] === '"' ? m[2].replace(/\\(["\\$`])/g, '$1') : m[2]);
  }
  return out;
}

// Code with what its strings hold blanked out, the same length, so a match
// in the blanked copy is known to be code and not text.
function outsideStrings(code) {
  let out = '';
  let quote = null;
  for (let i = 0; i < code.length; i++) {
    const three = code.slice(i, i + 3);
    if (!quote && (three === '"""' || three === "'''")) {
      quote = three;
      out += three;
      i += 2;
    } else if (!quote && '\'"`'.includes(code[i])) {
      quote = code[i];
      out += code[i];
    } else if (quote && code.startsWith(quote, i)) {
      out += quote;
      i += quote.length - 1;
      quote = null;
    } else if (quote && code[i] === '\\') {
      out += '  ';
      i++;
    } else {
      out += quote && code[i] !== '\n' ? ' ' : code[i];
    }
  }
  return out;
}

// The arguments of a call as text, from just after its opening bracket.
function callArgs(code, at) {
  const args = [];
  let depth = 0;
  let quote = null;
  let from = at;
  for (let i = at; i < code.length && i < at + 400; i++) {
    const ch = code[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch) && depth-- === 0) return [...args, code.slice(from, i)];
    else if (ch === ',' && depth === 0) {
      args.push(code.slice(from, i));
      from = i + 1;
    }
  }
  return args;
}

// The plain string literals in some code, like "src" and "game.js".
const literals = (code) => [...code.matchAll(QUOTED)].map((m) => m[2]).filter((v) => v && !/[\s{}$\\]/.test(v));

// The paths a script's expression for a file stands for: its literals joined,
// like os.path.join(root, "src", "game.js"), or, for a name, what the script
// set it to before at.
function targetPaths(expr, code, at, depth = 0) {
  const lits = literals(expr);
  if (lits.length) return [lits.join('/').replace(/\/+/g, '/')];
  const name = /^\s*([A-Za-z_]\w*)\s*$/.exec(expr)?.[1];
  if (!name || depth > 2) return [];
  const before = code.slice(0, at);
  const last = (re) => [...before.matchAll(re)].pop();
  const setting = (n) => new RegExp('(?:^|[\\s;(,])(?:const |let |var )?' + n + '\\s*=(?!=)\\s*([^\\n;]+)', 'g');
  const set = last(setting(name));
  const loop = last(new RegExp('\\bfor\\s+(?:const |let |var )?\\(?\\s*' + name + '\\s+(?:in|of)\\s+([^\\n:]+)', 'g'));
  const params = (d) => d[2].split(',').map((p) => p.trim().split(/[\s:=]/)[0]);
  const def = [...before.matchAll(/\b(?:def|function)\s+(\w+)\s*\(([^)]*)\)/g)].filter((d) => params(d).includes(name)).pop();
  const latest = [set, loop, def].filter(Boolean).sort((a, b) => b.index - a.index)[0];
  if (!latest) return [];
  if (latest === set) return targetPaths(set[1], code, set.index, depth + 1);
  if (latest === loop) {
    // Each item of the list it goes through, written there or set before.
    const each = literals(loop[1]);
    const list = /^\s*([A-Za-z_]\w*)/.exec(loop[1])?.[1];
    const listSet = !each.length && list && [...code.slice(0, loop.index).matchAll(setting(list))].pop();
    return each.length ? each : listSet ? literals(listSet[1]) : [];
  }
  const param = params(def).indexOf(name);
  // A parameter: what each call of that function passes there.
  const out = [];
  for (const call of code.matchAll(new RegExp('(?<!def |function )\\b' + def[1] + '\\(', 'g'))) {
    const arg = callArgs(code, call.index + call[0].length)[param];
    if (arg) out.push(...targetPaths(arg, code, call.index, depth + 1));
  }
  return out;
}

// The steps one line of a record holds: when, what kind, the paths as the
// agent wrote them and the folder it was in. ctx carries the folder from
// line to line. A helper's lines (isSidechain) count only when asked for.
// A shell command's files are 'wrote' when it writes them and 'command'
// when it only names them; 'wrote' shows as changed.
function lineSteps(agent, o, ctx, { helpers = false } = {}) {
  const raw = [];
  const add = (kind, paths, cwd) => {
    const t = Date.parse(o.timestamp);
    if (t && paths.length) raw.push({ t, kind, paths, cwd });
  };
  const shell = (command, cwd) => {
    const wrote = writtenPaths(command);
    add('wrote', wrote, cwd);
    add('command', namedPaths(command).filter((p) => !wrote.includes(p)), cwd);
  };
  if (agent === 'claude') {
    if (o.isSidechain && !helpers) return raw;
    if (typeof o.cwd === 'string') ctx.cwd = o.cwd;
    if (o.type !== 'assistant' || !Array.isArray(o.message?.content)) return raw;
    for (const b of o.message.content) {
      if (b?.type !== 'tool_use') continue;
      const p = b.input?.file_path ?? b.input?.notebook_path;
      if (CLAUDE_EDITS.has(b.name) && typeof p === 'string') add('changed', [p], ctx.cwd);
      else if (b.name === 'Read' && typeof p === 'string') add('read', [p], ctx.cwd);
      else if ((b.name === 'Grep' || b.name === 'Glob') && typeof b.input?.path === 'string') add('read', [b.input.path], ctx.cwd);
      else if (b.name === 'Bash') shell(b.input?.command, ctx.cwd);
    }
    return raw;
  }
  const p = o.payload;
  if (o.type === 'session_meta' && typeof p?.cwd === 'string') ctx.cwd = p.cwd;
  if (o.type !== 'response_item') return raw;
  add('changed', patchedFiles(o), ctx.cwd);
  if (p?.type === 'local_shell_call') {
    const c = p.action?.command;
    shell(Array.isArray(c) ? c.join(' ') : c, p.action?.working_directory || ctx.cwd);
  } else if (p?.type === 'function_call' && CODEX_SHELL.has(p.name)) {
    let args = {};
    try {
      args = JSON.parse(p.arguments);
    } catch {}
    const c = args.command ?? args.cmd;
    shell(Array.isArray(c) ? c.join(' ') : c, typeof args.workdir === 'string' ? args.workdir : ctx.cwd);
  } else if (p?.type === 'custom_tool_call' && typeof p.input === 'string') {
    // Newer Codex writes a script of tools.exec_command({cmd:"...","workdir":"..."}) calls.
    for (const call of p.input.split(CODEX_EXEC).slice(1)) {
      const text = (key) => {
        const m = new RegExp('\\b' + key + '"?\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"').exec(call);
        try {
          return m ? JSON.parse('"' + m[1] + '"') : null;
        } catch {
          return null;
        }
      };
      shell(text('cmd'), text('workdir') || ctx.cwd);
    }
  }
  return raw;
}

// Every step of a record, oldest first.
async function rawSteps(agent, file) {
  const raw = [];
  const ctx = { cwd: null };
  await eachLine(file, (o) => {
    raw.push(...lineSteps(agent, o, ctx));
  });
  return raw;
}

// A path that is not there, as it would be after following symlinks: its
// nearest folder that is there, followed, with the rest added back. Null
// when nothing on the way is there.
async function realIfGone(abs) {
  const rest = [];
  for (let dir = abs; ; dir = path.dirname(dir)) {
    try {
      return path.join(await fsp.realpath(dir), ...rest);
    } catch {}
    if (path.dirname(dir) === dir) return null;
    rest.unshift(path.basename(dir));
  }
}

// A path from a step as a path in the open folder, or null. Paths are
// checked after following symlinks, and a path read, or named or written by
// a command, must be a file that is there now. A file changed with the agent's edit
// tools counts even if it has gone since, when the folder it was in, after
// following symlinks, is in the open folder.
async function inFolder(root, cwd, p, kind, home) {
  const abs = path.resolve(cwd || root, p.startsWith('~/') ? path.join(home, p.slice(2)) : p);
  const inside = (q) => (q && q.startsWith(root + path.sep) && path.relative(root, q)) || null;
  try {
    const real = await fsp.realpath(abs);
    return (await fsp.stat(real)).isFile() ? inside(real) : null;
  } catch {
    return kind === 'changed' ? inside(await realIfGone(abs)) : null;
  }
}

// What the window calls a kind of step: a file a command wrote is changed.
const shownAs = (kind) => (kind === 'wrote' ? 'changed' : kind);

// A step's paths as files in the open folder, each once. known holds what
// each path turned out to be, so the same path is worked out only once.
async function stepPaths(root, r, home, known) {
  const paths = [];
  for (const p of r.paths) {
    const key = r.kind + '\n' + r.cwd + '\n' + p;
    if (!known.has(key)) known.set(key, await inFolder(root, r.cwd, p, r.kind, home));
    const rel = known.get(key);
    if (rel && !paths.includes(rel)) paths.push(rel);
  }
  return paths;
}

// The steps of one of the sessions last listed for the open folder, oldest
// first: when each happened, whether it read, changed or named files in a
// command, and those files in the folder. Steps with none are left out.
async function sessionSteps(root, id, { home = os.homedir() } = {}) {
  const file = listed.get(root)?.has(id) && recordOf.get(root + '\n' + id);
  if (!file) throw new Error('That session is not one of the last sessions here.');
  const known = new Map();
  const steps = [];
  for (const r of await rawSteps(id.split(':')[0], file)) {
    const paths = await stepPaths(root, r, home, known);
    if (paths.length) steps.push({ t: r.t, kind: shownAs(r.kind), paths });
    if (steps.length >= MAX_STEPS) break;
  }
  return { root, id, steps };
}

// Live: what claude and codex do in the open folder as they do it, wherever
// they run, from the newest lines of their records. Only records written to
// in the last few seconds are read, each from where it was read to last
// time, and the window gets only the steps of those seconds: when, what
// kind, which agent and the files in the open folder, as in a replay.
// Claude Code's helpers keep records of their own beside the session's.
const LIVE_MS = 10000;               // records and steps older than this are left alone
const LIVE_BACK = 256 * 1024;        // a record first seen is read from this far before its end
const LIVE_MAX_READ = 4 * 1024 * 1024;
const tails = new Map();             // record -> { offset, rest, ctx }

async function modified(file) {
  try {
    const info = await fsp.stat(file);
    return info.isFile() ? info : null;
  } catch {
    return null;
  }
}

// The records of this folder written to in the last LIVE_MS, with their size.
async function liveRecords(root, claudeDir, codexDir, now) {
  const found = [];
  const add = async (agent, file) => {
    const info = await modified(file);
    if (info && now - info.mtimeMs < LIVE_MS) found.push({ agent, file, size: info.size });
  };
  const newest = [];
  for (const dir of await claudeDirs(root, claudeDir)) for (const name of await names(dir)) {
    if (!name.endsWith('.jsonl')) continue;
    const info = await modified(path.join(dir, name));
    if (info) newest.push({ dir, id: name.slice(0, -'.jsonl'.length), mtime: info.mtimeMs });
  }
  for (const { dir, id } of newest.sort((a, b) => b.mtime - a.mtime).slice(0, 3)) {
    const file = path.join(dir, id + '.jsonl');
    if ((await folderOf('claude', file)) !== root) continue;
    await add('claude', file);
    const helpers = path.join(dir, id, 'subagents');
    for (const name of await names(helpers)) if (name.endsWith('.jsonl')) await add('claude', path.join(helpers, name));
  }
  for (const file of await codexFiles(root, codexDir, 3, 2)) await add('codex', file);
  return found;
}

// The whole lines written to a record since it was last read. A line still
// being written waits for the next read.
async function newLines(file, size) {
  let tail = tails.get(file);
  if (!tail || size < tail.offset) {
    tail = { offset: Math.max(0, size - LIVE_BACK), rest: Buffer.alloc(0), ctx: { cwd: null } };
    tails.set(file, tail);
  }
  if (size - tail.offset > LIVE_MAX_READ) {
    tail.offset = size - LIVE_MAX_READ;
    tail.rest = Buffer.alloc(0);
  }
  if (size === tail.offset) return { lines: [], ctx: tail.ctx };
  const buf = Buffer.alloc(size - tail.offset);
  const handle = await fsp.open(file, 'r');
  try {
    await handle.read(buf, 0, buf.length, tail.offset);
  } finally {
    await handle.close();
  }
  tail.offset = size;
  const all = Buffer.concat([tail.rest, buf]);
  const end = all.lastIndexOf(0x0a);
  tail.rest = all.subarray(end + 1);
  return { lines: end < 0 ? [] : all.subarray(0, end).toString('utf8').split('\n'), ctx: tail.ctx };
}

// The steps claude and codex took in the open folder in the last few
// seconds, oldest first: when, which agent, whether it read, changed or
// named files in a command, and those files.
async function liveSteps(root, { home = os.homedir(), env = process.env, now = Date.now() } = {}) {
  const { claudeDir, codexDir } = agentDirs(home, env);
  const known = new Map();
  const steps = [];
  for (const { agent, file, size } of await liveRecords(root, claudeDir, codexDir, now)) {
    let read;
    try {
      read = await newLines(file, size);
    } catch {
      continue;
    }
    if (read.ctx.cwd == null && agent === 'codex') read.ctx.cwd = await recordCwd(agent, file);
    for (const line of read.lines) {
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue;
      }
      for (const r of lineSteps(agent, o, read.ctx, { helpers: true })) {
        if (now - r.t > LIVE_MS) continue;
        const paths = await stepPaths(root, r, home, known);
        if (paths.length) steps.push({ t: r.t, agent, kind: shownAs(r.kind), paths });
      }
    }
  }
  return { root, steps: steps.sort((a, b) => a.t - b.t) };
}

module.exports = { lastSessions, sessionSteps, liveSteps, namedPaths, writtenPaths, typedLine };
