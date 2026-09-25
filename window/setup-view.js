// Agent setup: what claude and codex are told in the open folder, found by
// main/setup.js. A page in the middle, and a row above the tree. Files in the
// open folder open like any other; files outside it open read-only, with
// secrets hidden.

// In the order they are shown, each with a plain name and what it is.
const SETUP_KINDS = [
  ['instructions', 'Instructions', 'Read at the start of every session, from the most general to the most particular.'],
  ['hook', 'Runs on its own', 'Commands the agent runs by itself when something happens, without asking you first.'],
  ['settings', 'Settings and permissions', 'What it may do without asking, what it asks about first, and what it may never do.'],
  ['connection', 'Connections', 'Outside tools and services it can use (MCP servers).'],
  ['skill', 'Skills', 'Know-how it loads when a task calls for it.'],
  ['command', 'Commands', 'Shortcuts you can type in it, starting with /.'],
  ['helper', 'Helpers', 'Other agents it can hand part of a task to.'],
  ['plugin', 'Plugins', 'Add-ons that can bring skills, commands, hooks and connections of their own.'],
];

const SCOPES = {
  managed: 'set by an administrator',
  everywhere: 'you, in every folder',
  above: 'a folder above this one',
  folder: 'this folder',
  'mine-here': 'this folder, only you',
};

// Where the instructions an agent reads at the start come from, most
// particular first.
const FROM = [
  ['mine-here', 'from this folder, only yours'],
  ['folder', 'from this folder'],
  ['above', 'from folders above this one'],
  ['everywhere', 'from files that reach every folder'],
  ['managed', 'from files an administrator set'],
];

const DESCRIBED = ['skill', 'command', 'helper'];

// What one agent reads at the start of every session here, counted in words:
// its instructions, with what they bring in with @, by where they come from,
// and the names and descriptions of its skills, commands and helpers. Its
// connections and plugins add their own, which cannot be counted here.
function startWords(agent) {
  const items = (state.setup?.items || []).filter((i) => i.agent === agent && !i.off);
  const from = {};
  for (const i of items.filter((i) => i.kind === 'instructions')) {
    from[i.scope] = (from[i.scope] || 0) + i.words + (i.imports || []).reduce((sum, f) => sum + f.words, 0);
  }
  const described = items.filter((i) => DESCRIBED.includes(i.kind));
  const inDescriptions = described.reduce((sum, i) => sum + (i.words || 0), 0);
  const total = Object.values(from).reduce((a, b) => a + b, 0) + inDescriptions;
  return {
    total, from, described: described.length, inDescriptions,
    connections: items.filter((i) => i.kind === 'connection').length,
    plugins: items.filter((i) => i.kind === 'plugin').length,
  };
}

// The section at the top of the page: one item per agent.
function startSection() {
  const section = el('section', 'setup-kind');
  section.append(el('h2', null, 'Read before you type'),
    el('p', 'dim', 'What each agent reads at the start of every session here, counted in words, on top of its own built-in instructions. It all takes room the conversation could use.'));
  for (const agent of ['claude', 'codex']) {
    const w = startWords(agent);
    if (!w.total && !w.connections && !w.plugins) continue;
    const box = el('div', 'setup-item');
    const top = el('div', 'setup-top');
    const name = el('span', 'setup-name', 'about ' + num(w.total) + ' words');
    name.title = 'Roughly ' + num(Math.round((w.total * 4) / 3)) + ' tokens: a token is about three quarters of a word.';
    top.append(el('span', 'setup-agent mono ' + who(agent), agent), name);
    box.append(top);
    for (const [scope, words] of FROM) if (w.from[scope]) box.append(el('div', 'setup-line mono', num(w.from[scope]) + ' ' + words));
    if (w.described) {
      box.append(el('div', 'setup-line mono', num(w.inDescriptions) + ' in the names and descriptions of ' + count(w.described, 'skill, command or helper', 'skills, commands and helpers')));
    }
    const extra = [w.connections && count(w.connections, 'connection', 'connections'), w.plugins && count(w.plugins, 'plugin', 'plugins')].filter(Boolean);
    if (extra.length) {
      box.append(el('div', 'setup-line mono muted', extra.join(' and ') + (w.connections + w.plugins === 1 ? ' adds its' : ' add their') + ' own tools on top, which invader cannot count without starting them.'));
    }
    section.append(box);
  }
  return section.childElementCount > 2 ? section : null;
}

// How many items a section shows before "and N more".
const SETUP_SHOWN = 8;

// Scan again. The page and the row are drawn again only when what they show
// changed.
async function loadSetup() {
  const res = await window.disk.setup();
  if (!res.ok || res.value.root !== state.root || JSON.stringify(res.value) === JSON.stringify(state.setup)) return;
  state.setup = res.value;
  drawSetupRow();
  if (state.page === 'setup') redrawInPlace();
}

// A path the watcher saw that may change what the agent is told here.
const SETUP_PATH = /(^|\/)(CLAUDE(\.local)?\.md|AGENTS(\.override)?\.md|\.claude|\.codex|\.agents|\.mcp\.json)(\/|$)/;

// Counts for each agent, like "claude 12 · codex 3".
function setupCounts() {
  const items = state.setup?.items || [];
  return ['claude', 'codex']
    .map((a) => [a, items.filter((i) => i.agent === a && !i.off).length])
    .filter(([, n]) => n)
    .map(([a, n]) => a + ' ' + n)
    .join(' · ');
}

// The row under the tree that opens the page.
function drawSetupRow() {
  const row = $('tree').querySelector('.setup-row');
  if (!row) return;
  const counts = setupCounts();
  row.replaceChildren('agent setup', el('span', 'title', counts || 'nothing found'));
  row.classList.toggle('sel', state.page === 'setup' || state.page === 'outside');
}

function setupRow() {
  const row = el('div', 'row mono setup-row');
  row.title = 'What claude and codex are told in this folder';
  row.addEventListener('click', showSetup);
  return row;
}

async function showSetup() {
  if (!leaveEdit()) return;
  noteLeaving();
  nextTurn();
  state.page = 'setup';
  state.home = false;
  state.openFile = null;
  state.file = null;
  markOpenFile();
  drawFile();
  loadSetup();
}

// The page.
function drawSetup(head, body) {
  head.append(el('span', 'mono', 'agent setup'), el('span', 'dim', 'what claude and codex are told in ' + (state.info?.name ?? 'this folder')));
  const setup = state.setup;
  if (!setup) {
    body.append(el('div', 'empty', 'Looking…'));
    return;
  }
  const page = el('div', 'setup');
  if (!setup.claude && !setup.codex) page.append(el('p', 'muted', 'Neither ~/.claude nor ~/.codex is on this computer, so claude and codex have not been set up here yet.'));
  const start = startSection();
  if (start) page.append(start);
  const none = [];
  for (const [kind, title, about] of SETUP_KINDS) {
    const items = setup.items.filter((i) => i.kind === kind);
    if (!items.length) {
      none.push(title.toLowerCase());
      continue;
    }
    const section = el('section', 'setup-kind');
    section.append(el('h2', null, title), el('p', 'dim', about));
    const open = state.setupOpen.has(kind);
    const shown = open ? items : items.slice(0, SETUP_SHOWN);
    for (const item of shown) section.append(setupItem(item));
    if (items.length > shown.length) {
      const more = el('div', 'setup-more link', 'and ' + (items.length - shown.length) + ' more');
      more.addEventListener('click', () => {
        state.setupOpen.add(kind);
        redrawInPlace();
      });
      section.append(more);
    }
    page.append(section);
  }
  if (none.length) page.append(el('p', 'dim', 'None here: ' + none.join(', ') + '.'));
  if (setup.full) page.append(el('p', 'dim', 'There is more than invader lists.'));
  body.append(page);
}

function setupItem(item) {
  const box = el('div', 'setup-item' + (item.off ? ' off' : ''));
  const top = el('div', 'setup-top');
  top.append(el('span', 'setup-agent mono ' + who(item.agent), item.agent), el('span', 'setup-name', item.name), el('span', 'setup-scope', SCOPES[item.scope] || item.scope));
  box.append(top);
  if (item.off) box.append(el('div', 'setup-line muted', item.off));
  if (item.about) box.append(el('div', 'setup-line muted', item.about));
  for (const line of item.lines) box.append(el('div', 'setup-line mono', line));
  if (item.kind === 'instructions' && !item.off) {
    box.append(el('div', 'setup-line mono', count(item.words, 'word', 'words')));
    for (const f of item.imports || []) box.append(el('div', 'setup-line mono', 'brings in ' + f.file + ': ' + count(f.words, 'word', 'words')));
  }
  const file = el('div', 'setup-line mono link setup-file', item.rel ?? item.file);
  file.title = item.rel != null ? 'Open it' : 'Read it. It is outside this folder, so it opens read-only.';
  file.addEventListener('click', () => (item.rel != null ? openLinked(item.rel) : showOutside(item)));
  box.append(file);
  return box;
}

// A setup file outside the open folder: read-only, with secrets hidden.
async function showOutside(item) {
  noteLeaving();
  const turn = nextTurn();
  const res = await window.disk.readSetup(item.id);
  if (!isTurn(turn)) return;
  state.page = 'outside';
  state.outside = { item, res };
  drawFile();
}

function drawOutside(head, body) {
  const { item, res } = state.outside;
  const back = el('span', 'link setup-back', 'back to agent setup');
  back.addEventListener('click', showSetup);
  if (!res.ok) {
    head.classList.add('error');
    head.append(el('span', 'mono', item.file + ': ' + res.error));
    return;
  }
  head.append(el('span', 'mono', res.value.path), el('span', 'dim', 'outside this folder, read-only'), back);
  if (res.value.note) body.append(el('div', 'setup-note muted', res.value.note));
  if (res.value.tokens) body.append(blocks(res.value.tokens, el('article', 'md'), null));
  else body.append(el('pre', 'mono plain', res.value.text));
}
