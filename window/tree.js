// The open folder and its tree, with agent setup and ~/kit kept in reach under it.

// The open folder.

async function loadFolder() {
  const res = await window.disk.folderInfo();
  if (!res.ok) {
    $('root-name').textContent = res.error;
    return;
  }
  state.info = res.value;
  state.root = res.value.root;
  // Just the folder's name; the full path shows when the pointer rests on it.
  $('root-name').textContent = res.value.name;
  $('root').title = state.root + '\nSwitch folder (⌘O)';
  document.title = res.value.name + ' — next-invader';
  drawMapButton();
  await loadParts();
}

// The parts of the top map: which group each path a box names is in, so the
// tree, the tabs and the changes page can carry its colour.
async function loadParts() {
  const parts = [];
  if (state.info?.map) {
    const res = await window.disk.readFile('map.json');
    const map = res.ok && res.value.map;
    if (map && !map.error) {
      map.groups.forEach((g, part) => {
        for (const b of g.boxes) for (const p of b.paths) parts.push({ rel: p.rel, dir: p.dir, part, group: g.label, box: b.label, id: b.id });
      });
    }
  }
  if (JSON.stringify(parts) === JSON.stringify(state.parts)) return;
  state.parts = parts;
  markParts();
  drawTabs();
  drawChanges();
}

// The part a file is in: the box that names it, or else the box naming the
// closest folder holding it.
function partOf(rel) {
  const exact = state.parts.find((x) => x.rel === rel);
  if (exact) return exact;
  const holding = state.parts.filter((x) => x.dir && rel.startsWith(x.rel + '/'));
  return holding.sort((a, b) => b.rel.length - a.rel.length)[0] || null;
}

// Colour a row by its part. A folder a box names is coloured like a file; a
// folder that is not, but holds only one part's files, gets its colour as an
// outline.
function paintPart(row, rel, dir) {
  let x = rel && !rel.startsWith('~') ? partOf(rel) : null;
  let inside = false;
  if (!x && dir && rel && !rel.startsWith('~')) {
    const held = state.parts.filter((y) => y.rel.startsWith(rel + '/'));
    if (held.length && held.every((y) => y.part === held[0].part)) [x, inside] = [held[0], true];
  }
  if (x) row.style.setProperty('--g', partColour(x.part));
  else row.style.removeProperty('--g');
  row.classList.toggle('part-in', inside);
  row.title = !x ? '' : inside ? 'What the map names in here is all in ' + x.group : 'On the map: ' + x.box + ', in ' + x.group;
}

function markParts() {
  for (const row of $('tree').querySelectorAll('.row[data-path]')) paintPart(row, row.dataset.path, row.classList.contains('dir'));
}

// A different folder was opened: start fresh there, with the tabs and the
// unfolded folders I left it with, if I was here before. Only the tabs come
// back; what they show is read from the disk again.
async function openFolder() {
  nextTurn();
  stopReplay();
  closePalette(false);
  window.disk.stopSearch();
  resetNav();
  $('find').hidden = true;
  CSS.highlights.clear();
  $('file-body').replaceChildren();
  say('');
  state.status = null;
  drawStrip();
  state.changes = new Map();
  state.openedAt = Date.now();
  state.recent = new Map();
  state.looked = new Map();
  state.live = null;
  state.expanded = new Set();
  state.unhidden = new Set();
  state.openFile = null;
  state.file = null;
  state.page = null;
  state.tabs = ['home'];
  state.folder = null;
  state.shownFolder = null;
  state.setup = null;
  state.sessions = null;
  state.unreadRecords = 0;
  state.broken = null;
  state.brokenOpen = false;
  state.setupOpen = new Set();
  state.drafts = new Map();
  resetPreview();
  state.restoring = true;
  tellUnsaved();
  markFileListStale();
  await loadFolder();
  const mem = await window.memory.load();
  const ws = mem.ok && mem.value.root === state.root ? mem.value.workspace : null;
  if (ws) {
    // Only the address comes back: the page waits until I load it.
    resetPreview(ws.preview?.url || null);
    state.tabs = ws.tabs;
    state.expanded = new Set(ws.expanded);
    // Where I was reading in each tab; checked again against the file as it
    // is when the tab is drawn.
    state.places = new Map(Object.entries(ws.places || {}).map(([key, p]) => [key, { key, ...p }]));
  }
  // Unsaved edits kept for recovery come back, each in its tab.
  const recovered = await recoverDrafts();
  loadSetup();
  loadSessions();
  loadBroken();
  await renderTree();
  state.restoring = false;
  if (recovered) say('Recovered ' + count(recovered, 'unsaved edit', 'unsaved edits') + ' kept from before. ' + (recovered === 1 ? 'It is' : 'They are') + ' not saved to the file yet.');
  if (!ws || ws.active === 'home') return showRoot();
  await tabOf(ws.active)[1]();
  // A file that has gone since shows why; its tab can be closed.
}

// The open folder's own page: where I left off, then its map, else its README.
async function showRoot() {
  if (!leaveEdit()) return;
  if (state.info?.map) return openFile('map.json', true);
  await showFolderPage('', state.info?.readme, true);
}

// Tree: the open folder, read one level at a time as folders are opened.
// It is built aside and swapped in, so it keeps its place on screen.

async function renderTree() {
  const tree = $('tree');
  const top = tree.scrollTop;
  const rootRow = el('div', 'row dir open mono', (state.info?.name ?? '') + '/');
  rootRow.dataset.path = '';
  rootRow.addEventListener('click', showRoot);
  if (state.info?.map) rootRow.append(mapMark('map.json'));
  const children = el('div');
  await fillDir('', children, 1);
  const places = el('div', 'places');
  places.append(setupRow());
  if (state.info?.kit) places.append(...(await kitRows()));
  const rows = [rootRow, children, places];
  tree.replaceChildren(...rows);
  tree.scrollTop = top;
  drawSetupRow();
  markOpenFile();
  markChanges();
}

// My kit, ~/kit, kept in reach under whichever folder is open. It opens like
// any folder; when there is none, nothing shows.
async function kitRows() {
  const rel = '~/kit';
  const open = state.expanded.has(rel);
  const row = el('div', 'row dir mono' + (open ? ' open' : ''), rel + '/');
  row.dataset.path = rel;
  if (state.info.kitError) {
    const not = el('span', 'error', ' not watched');
    not.title = 'What changes in ~/kit is not marked as it happens: ' + state.info.kitError;
    row.append(not);
  }
  const sub = el('div');
  if (open) await fillDir(rel, sub, 1);
  row.addEventListener('click', async () => {
    saveWorkspaceSoon();
    if (state.expanded.has(rel)) {
      state.expanded.delete(rel);
      row.classList.remove('open');
      sub.replaceChildren();
    } else {
      state.expanded.add(rel);
      row.classList.add('open');
      await fillDir(rel, sub, 1);
      markOpenFile();
      markChanges();
    }
  });
  return [row, sub];
}

// A folder in the middle, as a map I can walk into. A folder with its own
// map.json shows that map. Any other is drawn from the folder: a box for each
// folder in it, then its files, then its README.
async function showFolder(rel) {
  if (rel === '') return showRoot();
  noteLeaving();
  state.walking = true;
  const turn = nextTurn();
  const res = await window.disk.readFile(rel);
  if (!isTurn(turn)) return;
  const folder = res.ok && res.value.folder ? res.value : null;
  // The tree stays where it was, with the folder I clicked in view.
  const top = $('tree').scrollTop;
  if (folder?.map) await openLinked(rel + '/map.json');
  else await showFolderPage(rel, folder?.readme);
  $('tree').scrollTop = top;
  state.shownFolder = { rel, tab: currentTab() };
  state.walking = false;
}

// home: shown as the open folder's own page, the Overview tab.
async function showFolderPage(rel, readme, home = false) {
  if (!leaveEdit()) return;
  noteLeaving();
  const turn = nextTurn();
  const readmeRel = readme ? (rel ? rel + '/' : '') + readme : null;
  const [res, about] = await Promise.all([window.disk.listDir(rel), readmeRel ? window.disk.readFile(readmeRel) : null]);
  if (!isTurn(turn)) return;
  state.page = 'folder';
  state.home = home;
  state.openFile = null;
  state.file = null;
  state.folder = { rel, res, readmeRel, about };
  // Unfold the way down to it, so the tree shows where I am.
  const parts = rel ? rel.split('/') : [];
  for (let i = 1; i <= parts.length; i++) state.expanded.add(parts.slice(0, i).join('/'));
  await renderTree();
  if (!isTurn(turn)) return;
  drawFile();
}

// The page: a line saying what it is, a box for each folder, a row for each
// file, and the README.
function drawFolderPage(head, body) {
  const { rel, res, readmeRel, about } = state.folder;
  head.append(crumbs(rel));
  body.append(...folderView(rel, res, readmeRel, about));
  markChanges();
}

const DRAWN_SAYS = 'No map.json here, so invader drew this from the folder: a box for each folder in it, named by its README. Click one to go in.';

// A folder drawn from the disk: its counts and what they are, a box for each
// folder in it, a row for each file, then its README.
function folderView(rel, res, readmeRel, about, says = DRAWN_SAYS) {
  if (!res.ok) return [el('div', 'empty error', res.error)];
  const items = res.value.filter((item) => !isHidden(item));
  const dirs = items.filter((item) => item.dir);
  const files = items.filter((item) => !item.dir);
  const page = el('div', 'map folder-map');
  const sum = el('div', 'map-sum');
  const meta = el('div', 'map-meta');
  meta.append(el('span', 'mono map-count', count(dirs.length, 'folder', 'folders') + ' · ' + count(files.length, 'file', 'files')));
  sum.append(meta, el('div', 'map-check', says));
  page.append(sum);
  if (dirs.length) {
    const grid = el('div', 'folder-boxes');
    for (const item of dirs) {
      const box = el('button', 'map-box');
      box.type = 'button';
      box.dataset.id = 'dir:' + item.path;
      box.dataset.paths = item.path;
      paintPart(box, item.path, true);
      box.append(el('span', 'map-box-label', item.title || item.name));
      const foot = el('span', 'map-path mono', item.name + '/');
      if (item.map) foot.append(el('span', 'folder-has-map', ' · has a map'));
      box.append(foot);
      box.addEventListener('click', () => showFolder(item.path));
      grid.append(box);
    }
    page.append(grid);
  }
  if (files.length) {
    const list = el('div', 'folder-files');
    list.append(el('div', 'map-group-label', 'Files here'));
    for (const item of files) {
      const row = el('div', 'row mono', item.name);
      row.dataset.path = item.path;
      paintPart(row, item.path, false);
      row.addEventListener('click', () => openLinked(item.path));
      list.append(row);
    }
    page.append(list);
  }
  if (!items.length) page.append(el('div', 'empty', 'Nothing in this folder.'));
  const out = [page];
  if (about?.ok && about.value.tokens) {
    const readme = el('div', 'folder-readme');
    const name = el('span', 'link mono', readmeRel.split('/').pop());
    name.title = 'Open it, to read it on its own or edit it';
    name.addEventListener('click', () => openLinked(readmeRel));
    readme.append(name, blocks(about.value.tokens, el('article', 'md'), readmeRel));
    out.push(readme);
  }
  return out;
}

// Under a map that cannot be drawn, the folder it sits in, drawn from the
// disk, so the folder is still a place to work until the map is fixed.
async function drawnFolderInto(spot, dir) {
  const info = dir ? await window.disk.readFile(dir) : { ok: true, value: { readme: state.info?.readme } };
  const readmeRel = info.ok && info.value.readme ? (dir ? dir + '/' : '') + info.value.readme : null;
  const [res, about] = await Promise.all([window.disk.listDir(dir), readmeRel ? window.disk.readFile(readmeRel) : null]);
  if (!spot.isConnected) return;
  spot.replaceChildren(...folderView(dir, res, readmeRel, about, 'Until the map is fixed, this is the folder drawn from the disk: a box for each folder in it. Click one to go in.'));
  markChanges();
}

// Where something sits, as a trail I can go back up: the open folder, each
// folder on the way, and the last one, a file or folder, in strong text. A
// map.json ends in "map".
function crumbs(rel) {
  const trail = el('span', 'crumbs mono');
  const kit = rel === '~/kit' || rel.startsWith('~/kit/');
  // The kit is not inside the open folder, so its trail starts at ~/kit.
  const parts = kit ? ['~/kit', ...rel.slice('~/kit'.length).split('/').filter(Boolean)] : rel ? rel.split('/') : [];
  if (!kit) {
    const root = el('span', parts.length ? 'link' : 'crumb-here', state.info?.name ?? 'folder');
    if (parts.length) root.addEventListener('click', showRoot);
    trail.append(root);
  }
  parts.forEach((part, i) => {
    if (trail.childNodes.length) trail.append(el('span', 'crumb-gap', '›'));
    if (i === parts.length - 1) {
      trail.append(el('span', 'crumb-here', part === 'map.json' ? 'map' : part));
      return;
    }
    const at = kit ? ['~/kit', ...parts.slice(1, i + 1)].join('/') : parts.slice(0, i + 1).join('/');
    const step = el('span', 'link', part);
    step.addEventListener('click', () => showFolder(at));
    trail.append(step);
  });
  return trail;
}

// A folder's README title, cut to its first two words so it fits beside the
// name. All of it shows when the pointer rests on it.
function folderTitle(title) {
  const span = el('span', 'title', title.split(/\s+/).slice(0, 2).join(' ').replace(/[.,;:]$/, ''));
  span.title = title;
  return span;
}

// The "map" mark on a folder opens that folder's map.
function mapMark(rel) {
  const mark = el('span', 'mark link', 'map');
  mark.addEventListener('click', (e) => {
    e.stopPropagation();
    openLinked(rel);
  });
  return mark;
}

// Folders and files kept for tools rather than written to read. They are
// hidden, and a dim row at the end of the folder says so and shows them when
// clicked.
const HIDDEN_DIRS = new Set(['.git', 'node_modules']);
const HIDDEN_FILES = new Set(['.gitignore']);
const isHidden = (item) => (item.dir ? HIDDEN_DIRS : HIDDEN_FILES).has(item.name);

async function fillDir(rel, container, depth) {
  const res = await window.disk.listDir(rel);
  container.replaceChildren();
  if (!res.ok) {
    container.append(errorRow(res.error, depth));
    return;
  }
  if (res.value.length === 0) {
    const empty = el('div', 'row dim mono', 'empty');
    empty.style.paddingLeft = 12 + depth * 16 + 'px';
    container.append(empty);
  }
  const hidden = res.value.filter(isHidden);
  const unhidden = state.unhidden.has(rel);
  for (const item of res.value) {
    if (isHidden(item) && !unhidden) continue;
    const row = el('div', 'row mono' + (item.dir ? ' dir' : '') + (isHidden(item) ? ' hidden' : ''), item.dir ? item.name + '/' : item.name);
    row.style.paddingLeft = 12 + depth * 16 + 'px';
    row.dataset.path = item.path;
    // The tree names only the top folders by their README, so it stays plain.
    if (item.title && depth === 1) row.append(folderTitle(item.title));
    if (item.map) row.append(mapMark(item.path + '/map.json'));
    container.append(row);

    if (item.dir) {
      const sub = el('div');
      container.append(sub);
      const open = state.expanded.has(item.path);
      row.classList.toggle('open', open);
      if (open) await fillDir(item.path, sub, depth + 1);
      // Clicking a folder opens it in the middle, as alabs did; clicking it
      // again while it is the one shown folds it away.
      row.addEventListener('click', async () => {
        const shown = state.shownFolder?.rel === item.path && state.shownFolder.tab === currentTab();
        saveWorkspaceSoon();
        if (state.expanded.has(item.path) && shown) {
          state.expanded.delete(item.path);
          row.classList.remove('open');
          sub.replaceChildren();
          return;
        }
        if (!state.expanded.has(item.path)) {
          state.expanded.add(item.path);
          row.classList.add('open');
          await fillDir(item.path, sub, depth + 1);
          markOpenFile();
          markChanges();
        }
        showFolder(item.path);
      });
    } else {
      row.addEventListener('click', () => openFile(item.path));
      row.addEventListener('dblclick', focusMiddle);
    }
  }
  if (hidden.length) {
    const names = hidden.map((item) => item.dir ? item.name + '/' : item.name).join(' ');
    const note = el('div', 'row mono hidden-note', unhidden ? 'hide ' + names : hidden.length + ' hidden: ' + names);
    note.style.paddingLeft = 12 + depth * 16 + 'px';
    note.addEventListener('click', async () => {
      if (unhidden) state.unhidden.delete(rel);
      else state.unhidden.add(rel);
      await fillDir(rel, container, depth);
      markOpenFile();
      markChanges();
    });
    container.append(note);
  }
}

function markOpenFile() {
  const folder = state.page === 'folder' ? state.folder.rel : undefined;
  for (const row of $('tree').querySelectorAll('.row[data-path]')) {
    row.classList.toggle('sel', row.dataset.path === state.openFile || row.dataset.path === folder);
  }
  markParts();
  drawSetupRow();
}
