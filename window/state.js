// The window's shared state and small helpers. The window's other files
// build on these. Everything from the disk is shown with textContent, never
// as HTML.

const state = {
  root: null,           // absolute path of the open folder
  info: null,           // the open folder: { root, name, map, readme }
  expanded: new Set(),  // relative paths of folders expanded in the tree
  unhidden: new Set(),  // relative paths of folders showing their hidden folders
  openFile: null,       // relative path of the file being read
  file: null,           // last read of openFile, from the disk
  view: 'rendered',     // how Markdown is shown: 'rendered' or 'plain'
  mapView: 'rendered',  // how the open map is shown; a map always opens as a map
  find: null,           // text to mark in openFile, when opened from an arrow
  mapSel: null,         // on the open map: { box: id } or { arrow: index }
  changes: new Map(),   // path -> 'new' | 'changed' | 'deleted', from the main process
  git: false,           // whether changes come from Git
  openedAt: 0,          // when the open folder was opened, in milliseconds
  recent: new Map(),    // path -> when the watcher last saw it change
  looked: new Map(),    // path -> when the agent's record last showed it read or named in a command
  live: null,           // the agent's newest step here: { agent, kind, paths, t, seen }
  status: null,         // the last changes message: watching, branch, list, map
  running: {},          // what runs in the terminal: { program, agent }
  home: false,          // whether the middle shows the open folder's own page
  page: null,           // a page in the middle instead of a file: 'setup', 'outside', 'changes' or 'folder'
  tabs: ['home'],       // the tabs over the middle: 'home', 'file:<path>', 'folder:<path>', 'setup' or 'changes'
  setup: null,          // the last agent setup scan: { items, claude, codex, full }
  sessions: null,       // the last few claude and codex sessions in the open folder
  unreadRecords: 0,     // how many of their newest records could not be read
  broken: null,         // links and paths in the folder's Markdown that point at nothing
  brokenOpen: false,    // whether the summary lists the files with one
  setupOpen: new Set(), // kinds on the setup page showing all their items
  outside: null,        // the setup file outside the folder being read: { item, res }
  replay: null,         // a session being replayed: { session, steps, at, playing, timer, madeOnly }
  parts: [],            // what the top map's boxes name: { rel, dir, part, group, box }
  folder: null,         // the folder page shown: { rel, res, readmeRel, about }
  shownFolder: null,    // the folder last opened from the tree, and the tab it opened: { rel, tab }
  walking: false,       // whether what opens next came from going into or up a folder
  lastTab: null,        // the tab shown last
};

const RECENT_MS = 8000;

// What the middle shows changes in turns: opening a file, a page or a folder
// starts one. A reply waited for is used only while its turn is the latest,
// so a slow reply never shows over what was asked for after it.
let middleTurn = 0;
const nextTurn = () => ++middleTurn;
const isTurn = (turn) => turn === middleTurn;

const $ = (id) => document.getElementById(id);

// A short note beside the buttons at the top. untilEnter: it goes once I press
// Return in the terminal. fade: it goes by itself after a moment, for news
// like Saved.
let sayTimer = null;
function say(text, { untilEnter = false, fade = false } = {}) {
  const note = $('note');
  clearTimeout(sayTimer);
  note.textContent = text;
  note.dataset.untilEnter = untilEnter ? text : '';
  note.classList.toggle('ok', fade);
  if (fade && text) sayTimer = setTimeout(() => note.textContent === text && say(''), 2500);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function errorRow(message, depth = 0) {
  const row = el('div', 'row error mono', message);
  row.style.paddingLeft = 12 + depth * 16 + 'px';
  return row;
}

// A number as it is read, like 4,200.
const num = (n) => n.toLocaleString('en-US');
const count = (n, one, many) => num(n) + ' ' + (n === 1 ? one : many);

// How long ago a time in seconds since 1970 was, in plain words.
function ago(seconds) {
  const s = Math.max(0, Date.now() / 1000 - seconds);
  const unit = (n, one) => n + ' ' + one + (n === 1 ? '' : 's') + ' ago';
  if (s < 60) return 'just now';
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86400) return unit(Math.floor(s / 3600), 'hour');
  if (s < 2 * 86400) return 'yesterday';
  if (s < 30 * 86400) return unit(Math.floor(s / 86400), 'day');
  return new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

// The colour of a map's nth group, its part, from style.css. After the fifth
// they start again.
const partColour = (i) => 'var(--part-' + ((i % 5) + 1) + ')';

// The class that colours an agent's name, like who-claude.
const who = (agent) => 'who-' + agent;

// A colour token from style.css, like colour('--changed').
const colour = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
