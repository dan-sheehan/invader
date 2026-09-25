// What the app remembers between runs, in state.json in its own data folder,
// never in the folders it shows: the last folder open, the folders opened
// recently, the window's size and how its panes are laid out, and for each
// folder the tabs I had open there and the folders unfolded in its tree.
//
// Everything read back is checked here, so a damaged or hand-edited
// state.json can only lose what it remembers, never reach anything else.
// Tabs are only names: opening one asks the disk again, which checks its path.

const fs = require('node:fs/promises');
const path = require('node:path');
const { admit } = require('./address');

const MAX_RECENT = 12;
const MAX_FOLDERS = 30;
const MAX_TABS = 40;
const MAX_EXPANDED = 300;
const MAX_PATH = 4096;

// Control characters are never kept: a folder's path is typed into the
// terminal to move there, and the terminal acts on them.
const CONTROL = /[\x00-\x1f\x7f]/;
const isAbs = (p) => typeof p === 'string' && p.length < MAX_PATH && path.isAbsolute(p) && !CONTROL.test(p);

// A path inside the open folder, as the window names it: relative, with no
// step up. Or one inside the kit, named ~/kit/...
function isRel(p) {
  if (typeof p !== 'string' || p.length >= MAX_PATH || CONTROL.test(p) || p.startsWith('/')) return false;
  const parts = p.split('/');
  if (parts[0] === '~') {
    if (parts[1] !== 'kit') return false;
    parts.splice(0, 2);
  }
  return parts.every((part) => part !== '..' && part !== '.');
}

// A tab as the window names it: 'home', 'setup', 'changes', 'preview',
// 'file:<path>' or 'folder:<path>'.
function isTab(key) {
  if (key === 'home' || key === 'setup' || key === 'changes' || key === 'preview') return true;
  if (typeof key !== 'string') return false;
  const m = /^(file|folder):(.+)$/s.exec(key);
  return !!m && isRel(m[2]);
}

const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : null);

function cleanWindow(w) {
  if (!w || typeof w !== 'object') return null;
  const width = num(w.width, 600, 10000);
  const height = num(w.height, 400, 10000);
  if (width == null || height == null) return null;
  const out = { width, height, maximized: w.maximized === true };
  const x = num(w.x, -20000, 20000);
  const y = num(w.y, -20000, 20000);
  if (x != null && y != null) Object.assign(out, { x, y });
  return out;
}

// Pane widths in pixels, whether the terminal is folded away, and how much
// bigger or smaller everything is drawn, in zoom steps.
function cleanLayout(l) {
  const out = { left: 260, right: 460, termHidden: false, zoom: 0 };
  if (!l || typeof l !== 'object') return out;
  out.left = num(l.left, 160, 800) ?? out.left;
  out.right = num(l.right, 240, 1600) ?? out.right;
  out.termHidden = l.termHidden === true;
  if (typeof l.zoom === 'number' && Number.isFinite(l.zoom)) out.zoom = Math.max(-3, Math.min(5, Math.round(l.zoom * 2) / 2));
  return out;
}

function cleanPlaces(raw, tabs) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out = {};
  for (const key of tabs) {
    const p = Object.prototype.hasOwnProperty.call(raw, key) ? raw[key] : null;
    if (!p || typeof p !== 'object') continue;
    const top = num(p.top, 0, 1e7);
    if (top == null) continue;
    const place = { top };
    const line = num(p.line, 1, 1e7);
    if (line != null) place.line = line;
    if (Array.isArray(p.caret) && p.caret.length === 2) {
      const [a, b] = p.caret.map((n) => num(n, 0, 1e8));
      if (a != null && b != null) place.caret = [Math.min(a, b), Math.max(a, b)];
    }
    out[key] = place;
  }
  return Object.keys(out).length ? out : null;
}

function cleanWorkspace(w) {
  if (!w || typeof w !== 'object') return null;
  const tabs = Array.isArray(w.tabs) ? [...new Set(w.tabs.filter(isTab))].slice(0, MAX_TABS) : [];
  if (!tabs.includes('home')) tabs.unshift('home');
  const active = isTab(w.active) && tabs.includes(w.active) ? w.active : 'home';
  const expanded = Array.isArray(w.expanded) ? [...new Set(w.expanded.filter(isRel))].slice(0, MAX_EXPANDED) : [];
  const out = { tabs, active, expanded };
  // The address the preview last showed here, only if it could be shown
  // again. It is only an address: remembering it starts nothing.
  const url = typeof w.preview?.url === 'string' ? admit(w.preview.url) : null;
  if (url?.ok) out.preview = { url: url.url };
  // Where I was reading in each tab: how far down, the first line in view,
  // the editor's cursor. Only for tabs kept, and only numbers.
  const places = cleanPlaces(w.places, tabs);
  if (places) out.places = places;
  return out;
}

// The whole of state.json, checked. Anything that does not fit is dropped.
function clean(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const recent = Array.isArray(r.recent) ? [...new Set(r.recent.filter(isAbs))].slice(0, MAX_RECENT) : [];
  const folders = {};
  if (r.folders && typeof r.folders === 'object') {
    for (const [dir, w] of Object.entries(r.folders)) {
      if (!isAbs(dir) || Object.keys(folders).length >= MAX_FOLDERS) continue;
      const ws = cleanWorkspace(w);
      if (ws) folders[dir] = ws;
    }
  }
  return {
    folder: isAbs(r.folder) ? r.folder : null,
    recent,
    window: cleanWindow(r.window),
    layout: cleanLayout(r.layout),
    folders,
  };
}

// The recent folders with folder first, each once, the oldest dropped. The
// workspaces of folders no longer recent are forgotten with them.
function opened(mem, folder) {
  const recent = [folder, ...mem.recent.filter((p) => p !== folder)].slice(0, MAX_RECENT);
  const folders = {};
  for (const dir of recent) if (mem.folders[dir]) folders[dir] = mem.folders[dir];
  return { ...mem, folder, recent, folders };
}

// Forget a folder from the recent list, as when it is gone from the disk.
function forget(mem, folder) {
  const folders = { ...mem.folders };
  delete folders[folder];
  return { ...mem, recent: mem.recent.filter((p) => p !== folder), folders };
}

async function load(file) {
  try {
    return clean(JSON.parse(await fs.readFile(file, 'utf8')));
  } catch {
    return clean(null);
  }
}

// Written whole to a file beside it, then moved into place, so a crash
// mid-write never leaves half a state.json.
async function save(file, mem) {
  const tmp = file + '.tmp';
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(clean(mem), null, 1));
  await fs.rename(tmp, file);
}

module.exports = { clean, cleanWorkspace, cleanLayout, cleanWindow, isTab, isRel, opened, forget, load, save, MAX_RECENT };
