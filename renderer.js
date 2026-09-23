// The window. Everything from the disk is shown with textContent, never as HTML.

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
  mapSel: null,         // on the open map: { arrow: index }
  changes: new Map(),   // path -> 'new' | 'changed' | 'deleted', from the main process
  git: false,           // whether changes come from Git
  recent: new Map(),    // path -> when the watcher last saw it change
  status: null,         // the last changes message: watching, branch, list, map
  running: {},          // what runs in the terminal: { program, agent }
};

const RECENT_MS = 8000;

const $ = (id) => document.getElementById(id);

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

// The open folder.

async function loadFolder() {
  const res = await window.disk.folderInfo();
  if (!res.ok) {
    $('root').textContent = res.error;
    return;
  }
  state.info = res.value;
  state.root = res.value.root;
  // Just the folder's name; the full path shows when the pointer rests on it.
  $('root').textContent = res.value.name;
  $('root').title = state.root;
  drawMapButton();
}

// A different folder was opened: start fresh there.
async function openFolder() {
  $('file-body').replaceChildren();
  $('note').textContent = '';
  state.status = null;
  drawStrip();
  state.changes = new Map();
  state.recent = new Map();
  state.expanded = new Set();
  state.unhidden = new Set();
  state.openFile = null;
  state.file = null;
  await loadFolder();
  await renderTree();
  await showRoot();
}

// The open folder's map, else its README.
async function showRoot() {
  if (!leaveEdit()) return;
  const first = state.info?.map ? 'map.json' : state.info?.readme;
  if (first) return openFile(first);
  state.openFile = null;
  state.file = null;
  markOpenFile();
  drawFile();
  $('file-body').append(el('div', 'empty', 'No map.json or README in ' + state.root + '.'));
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
  const rows = [rootRow, children];
  if (state.info?.kit) {
    const kit = el('div', 'kit');
    kit.append(...(await kitRows()));
    rows.unshift(kit);
  }
  tree.replaceChildren(...rows);
  tree.scrollTop = top;
  markOpenFile();
  markChanges();
}

// My kit, ~/kit, kept in reach above whichever folder is open. It opens like
// any folder; when there is none, nothing shows.
async function kitRows() {
  const rel = '~/kit';
  const open = state.expanded.has(rel);
  const row = el('div', 'row dir mono' + (open ? ' open' : ''), rel + '/');
  row.dataset.path = rel;
  const sub = el('div');
  if (open) await fillDir(rel, sub, 1);
  row.addEventListener('click', async () => {
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

// Folders kept by tools rather than written by me. They are hidden, and a dim
// row at the end of the folder says so and shows them when clicked.
const HIDDEN = new Set(['.git', 'node_modules']);
const isHidden = (item) => item.dir && HIDDEN.has(item.name);

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
    if (item.title) row.append(folderTitle(item.title));
    if (item.map) row.append(mapMark(item.path + '/map.json'));
    container.append(row);

    if (item.dir) {
      const sub = el('div');
      container.append(sub);
      const open = state.expanded.has(item.path);
      row.classList.toggle('open', open);
      if (open) await fillDir(item.path, sub, depth + 1);
      row.addEventListener('click', async () => {
        if (state.expanded.has(item.path)) {
          state.expanded.delete(item.path);
          row.classList.remove('open');
          sub.replaceChildren();
        } else {
          state.expanded.add(item.path);
          row.classList.add('open');
          await fillDir(item.path, sub, depth + 1);
          markOpenFile();
          markChanges();
        }
      });
    } else {
      row.addEventListener('click', () => openFile(item.path));
    }
  }
  if (hidden.length) {
    const names = hidden.map((item) => item.name + '/').join(' ');
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
  for (const row of $('tree').querySelectorAll('.row[data-path]')) {
    row.classList.toggle('sel', row.dataset.path === state.openFile);
  }
}

// File: plain text, or Markdown rendered from tokens. Read-only, except that
// a Markdown file's plain text can be edited by hand and saved.

async function openFile(rel) {
  if (!leaveEdit()) return;
  state.openFile = rel;
  state.find = null;
  state.mapSel = null;
  state.mapView = 'rendered';
  markOpenFile();
  await renderFile();
}

async function renderFile() {
  state.file = state.openFile ? await window.disk.readFile(state.openFile) : null;
  drawFile();
}

// The open file may have changed on disk: read it again. When what it shows
// is the same, nothing is drawn again; otherwise it is, and I stay where I was.
// An edit not saved yet is left alone.
async function rereadFile() {
  if (unsaved()) return;
  const rel = state.openFile;
  const res = await window.disk.readFile(rel);
  if (rel !== state.openFile || unsaved() || JSON.stringify(res) === JSON.stringify(state.file)) return;
  state.file = res;
  redrawInPlace();
}

// Draw the open file again where I was: scrolled to the same place and, when
// I was editing, with the cursor where it was.
function redrawInPlace() {
  const body = $('file-body');
  const top = body.scrollTop;
  const left = body.scrollLeft;
  const was = body.querySelector('textarea');
  const cursor = was && document.activeElement === was ? [was.selectionStart, was.selectionEnd] : null;
  const find = state.find;
  state.find = null;
  drawFile();
  state.find = find;
  body.scrollTop = top;
  body.scrollLeft = left;
  const editor = body.querySelector('textarea');
  if (cursor && editor) {
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(...cursor);
  }
}

// Editing. The text area holds lines ending in \n; a file written with \r\n
// is saved with \r\n again.
const lf = (text) => text.replace(/\r\n/g, '\n');

function unsaved() {
  const editor = $('file-body').querySelector('textarea');
  return !!editor && editor.value !== lf(editor.dataset.from);
}

// Main is told which file has an unsaved edit, so quitting asks first and the
// window does not follow the terminal away from it.
let toldUnsaved = null;
function tellUnsaved() {
  const rel = unsaved() ? state.openFile : null;
  if (rel === toldUnsaved) return;
  toldUnsaved = rel;
  window.disk.setUnsaved(rel);
}

// Before the open file or view changes: true when nothing unsaved would be
// lost, or I said to discard it.
function leaveEdit() {
  if (!unsaved()) return true;
  if (!confirm('Discard your unsaved edit to ' + state.openFile + '?')) return false;
  const editor = $('file-body').querySelector('textarea');
  editor.value = lf(editor.dataset.from);
  return true;
}

function drawEditor(head, body, text) {
  const editor = el('textarea', 'mono plain');
  editor.value = text;
  editor.dataset.from = text;
  editor.spellcheck = false;
  const note = el('div', 'error save-note');
  const save = el('button', null, 'Save');
  const discard = el('button', null, 'Discard');
  save.type = discard.type = 'button';
  const show = () => {
    save.hidden = discard.hidden = !unsaved();
    if (!unsaved()) note.textContent = '';
    tellUnsaved();
  };
  const doSave = async () => {
    if (!unsaved()) return;
    const rel = state.openFile;
    const out = text.includes('\r\n') ? editor.value.replace(/\n/g, '\r\n') : editor.value;
    const res = await window.disk.saveMarkdown(rel, out, text);
    if (rel !== state.openFile) return;
    if (!res.ok) {
      note.textContent = res.error;
      return;
    }
    state.file = res;
    redrawInPlace();
  };
  editor.addEventListener('input', show);
  editor.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      doSave();
    }
  });
  save.addEventListener('click', doSave);
  discard.addEventListener('click', () => {
    editor.value = lf(text);
    renderFile();
  });
  show();
  const actions = el('span', 'edit-actions');
  actions.append(save, discard);
  head.querySelector('.switch').before(actions);
  body.append(note, editor);
}

function drawFile() {
  drawMapButton();
  const head = $('file-head');
  const body = $('file-body');
  head.replaceChildren();
  body.replaceChildren();
  tellUnsaved();
  head.classList.remove('error');
  const res = state.file;
  if (!res) return;
  if (!res.ok) {
    head.classList.add('error');
    head.append(el('span', 'mono', state.openFile + ' — ' + res.error));
    markChanges();
    return;
  }
  const { path, size, text, reason, tokens, map } = res.value;
  head.append(el('span', 'mono', path), el('span', 'mono dim', size.toLocaleString() + ' bytes'));
  if (text == null) {
    body.append(el('div', 'empty', reason));
    markChanges();
    return;
  }
  // A text quoted by an arrow is shown marked in the plain file.
  const find = state.find && text.includes(state.find) ? state.find : null;
  const view = find ? 'plain' : map ? state.mapView : state.view;
  if (tokens || map) head.append(viewSwitch(view, map ? 'Map' : 'Rendered', map ? 'mapView' : 'view'));
  body.scrollTop = 0;
  if (map && view === 'rendered') {
    body.append(drawMap(map));
  } else if (tokens && view === 'rendered') {
    body.append(blocks(tokens, el('article', 'md')));
  } else if (find) {
    const at = text.indexOf(find);
    const mark = el('mark', null, find);
    const pre = el('pre', 'mono plain');
    pre.append(text.slice(0, at), mark, text.slice(at + find.length));
    body.append(pre);
    mark.scrollIntoView({ block: 'center' });
  } else if (tokens) {
    drawEditor(head, body, text);
  } else {
    body.append(el('pre', 'mono plain', text));
  }
  markChanges();
  if (map && view === 'rendered') layoutMap();
}

function viewSwitch(current, renderedLabel, key) {
  const wrap = el('span', 'switch');
  for (const [view, label] of [['rendered', renderedLabel], ['plain', 'Plain text']]) {
    const b = el('button', view === current ? 'on' : '', label);
    b.type = 'button';
    b.addEventListener('click', () => {
      if (unsaved() && (view === current || !leaveEdit())) return;
      state[key] = view;
      state.find = null;
      drawFile();
    });
    wrap.append(b);
  }
  return wrap;
}

// A path on a map: a folder shows its map, else its README, as the open
// folder does; a file opens.
async function openOnMap(rel) {
  const res = await window.disk.readFile(rel);
  const folder = res.ok && res.value.folder ? res.value : null;
  const first = folder && (folder.map ? 'map.json' : folder.readme);
  openLinked(first ? (rel ? rel + '/' : '') + first : rel);
}

// Links. A relative link or an absolute path inside the open folder opens that file
// here, at the heading its #section names. A link to a #section of the file
// open goes to that heading. Anything else (the web, mail) is shown as text only.

function linkTarget(href) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  let p = href.split('#')[0].split('?')[0];
  if (!p) return null;
  try {
    p = decodeURI(p);
  } catch {
    return null;
  }
  let parts;
  if (p.startsWith('/')) {
    if (!state.root || !p.startsWith(state.root + '/')) return null;
    parts = p.slice(state.root.length + 1).split('/');
  } else {
    parts = state.openFile.split('/').slice(0, -1).concat(p.split('/'));
  }
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return null;
      out.pop();
    } else {
      out.push(part);
    }
  }
  return out.length ? out.join('/') : null;
}

// A heading's name in links, as GitHub makes it: lower case, spaces as
// hyphens, other punctuation left out.
const slug = (text) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

function goToSection(section) {
  let name = section;
  try {
    name = decodeURIComponent(section);
  } catch {}
  const heading = [...$('file-body').querySelectorAll('[data-slug]')].find((h) => h.dataset.slug === name.toLowerCase());
  heading?.scrollIntoView({ block: 'start' });
}

// Open a linked file, or a linked folder in the tree, and show where it sits.
// find: text to mark in the file, when it was cited by a map arrow.
// section: the heading to go to, from a link's #section.
async function openLinked(rel, find = null, section = null) {
  if (rel === '') return showRoot();
  const res = await window.disk.readFile(rel);
  const folder = res.ok && res.value.folder;
  if (!folder && !leaveEdit()) return;
  const parts = rel.split('/');
  const upTo = folder ? parts.length : parts.length - 1;
  for (let i = 1; i <= upTo; i++) {
    state.expanded.add(parts.slice(0, i).join('/'));
    if (HIDDEN.has(parts[i - 1])) state.unhidden.add(parts.slice(0, i - 1).join('/'));
  }
  if (!folder) {
    state.openFile = rel;
    state.file = res;
    state.find = find;
    state.mapSel = null;
    state.mapView = 'rendered';
  }
  await renderTree();
  drawFile();
  if (section) goToSection(section);
  const target = $('tree').querySelector(folder ? `.row[data-path="${CSS.escape(rel)}"]` : '.row.sel');
  target?.scrollIntoView({ block: 'nearest' });
}

// Markdown. Built node by node with textContent. HTML tokens are dropped,
// images are shown as their alt text, and nothing is fetched.

function blocks(tokens, parent) {
  for (const t of tokens || []) {
    const node = block(t);
    if (node) parent.append(node);
  }
  return parent;
}

function block(t) {
  switch (t.type) {
    case 'heading': {
      const h = inline(t.tokens, el('h' + t.depth));
      h.dataset.slug = slug(h.textContent);
      return h;
    }
    case 'paragraph':
      return inline(t.tokens, el('p'));
    case 'text':
      return t.tokens ? inline(t.tokens, el('span')) : document.createTextNode(decode(t.text));
    case 'code': {
      const pre = el('pre', 'mono');
      pre.append(el('code', null, t.text));
      return pre;
    }
    case 'blockquote':
      return blocks(t.tokens, el('blockquote'));
    case 'list': {
      const list = el(t.ordered ? 'ol' : 'ul');
      if (t.ordered && typeof t.start === 'number') list.start = t.start;
      for (const item of t.items) list.append(blocks(item.tokens, el('li', item.task ? 'task' : '')));
      return list;
    }
    case 'checkbox':
      return checkbox(t);
    case 'table':
      return table(t);
    case 'hr':
      return el('hr');
    case 'html':
    case 'space':
    case 'def':
      return null;
    default:
      return t.raw ? el('p', null, t.raw) : null;
  }
}

function inline(tokens, parent) {
  for (const t of tokens || []) {
    const node = inlineNode(t);
    if (node) parent.append(node);
  }
  return parent;
}

function inlineNode(t) {
  switch (t.type) {
    case 'text':
      return t.tokens ? inline(t.tokens, document.createDocumentFragment()) : document.createTextNode(decode(t.text));
    case 'escape':
      return document.createTextNode(t.text);
    case 'strong':
    case 'em':
    case 'del':
      return inline(t.tokens, el(t.type));
    case 'codespan':
      return el('code', 'mono', t.text);
    case 'br':
      return el('br');
    case 'link':
      return link(t);
    case 'image':
      return el('span', 'dim', t.text ? '[image: ' + t.text + ']' : '[image]');
    case 'checkbox':
      return checkbox(t);
    case 'html':
      return null;
    default:
      return t.raw ? document.createTextNode(t.raw) : null;
  }
}

function link(t) {
  const target = linkTarget(t.href);
  const section = t.href?.includes('#') ? t.href.slice(t.href.indexOf('#') + 1) : null;
  if (target) {
    const a = inline(t.tokens, el('span', 'link'));
    a.title = target + (section ? '#' + section : '');
    a.addEventListener('click', () => openLinked(target, null, section));
    return a;
  }
  if (t.href?.startsWith('#') && section) {
    const a = inline(t.tokens, el('span', 'link'));
    a.title = t.href;
    a.addEventListener('click', () => goToSection(section));
    return a;
  }
  const span = inline(t.tokens, el('span'));
  if (t.href && t.href !== t.text) span.append(el('span', 'mono dim', ' <' + t.href + '>'));
  return span;
}

function checkbox(t) {
  return el('span', 'mono muted', t.checked ? '[x] ' : '[ ] ');
}

function table(t) {
  const tbl = el('table');
  const cell = (c, tag, i) => {
    const node = inline(c.tokens, el(tag));
    if (t.align[i]) node.style.textAlign = t.align[i];
    return node;
  };
  const head = el('tr');
  t.header.forEach((c, i) => head.append(cell(c, 'th', i)));
  tbl.append(head);
  for (const row of t.rows) {
    const tr = el('tr');
    row.forEach((c, i) => tr.append(cell(c, 'td', i)));
    tbl.append(tr);
  }
  return tbl;
}

// Markdown text keeps entities like &amp; as written; show the character.
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', mdash: '—', ndash: '–', hellip: '…' };

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(n);
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// Map. Groups are columns of boxes; arrows are drawn between the boxes from
// the checked map only. What did not check out is listed under it.

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const count = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const PULSE_MS = 2400; // one beat of the pulse, as in style.css

function drawMap(map) {
  const wrap = el('div', 'map');
  if (map.error) {
    wrap.append(el('div', 'map-error error mono', 'map.json cannot be drawn. ' + map.error));
    return wrap;
  }
  const boxCount = map.groups.reduce((n, g) => n + g.boxes.length, 0);
  const summary = count(boxCount, 'box', 'boxes') + ' · ' + count(map.arrows.length, 'arrow', 'arrows');
  const sum = el('div', 'map-sum mono dim', summary + (map.dropped.length ? '' : ' · all checked against the disk'));
  sum.append(el('span', 'map-wide'));
  wrap.append(sum);

  const canvas = el('div', 'map-canvas');
  canvas.append(svg('svg', { class: 'map-lines' }));
  for (const g of map.groups) {
    const col = el('div', 'map-group');
    col.append(el('div', 'map-group-label', g.label));
    if (g.boxes.length === 0) col.append(el('div', 'dim', 'no boxes'));
    for (const b of g.boxes) {
      const box = el('div', 'map-box');
      box.dataset.id = b.id;
      box.dataset.paths = b.paths.map((p) => p.rel).join('\n');
      box.append(el('div', 'map-box-label', b.label));
      for (const p of b.paths) {
        const line = el('div', 'map-path mono link', p.path);
        line.title = p.rel || state.root;
        line.addEventListener('click', (e) => {
          e.stopPropagation();
          openOnMap(p.rel);
        });
        box.append(line);
      }
      box.addEventListener('click', () => openOnMap(b.paths[0].rel));
      col.append(box);
    }
    canvas.append(col);
  }
  wrap.append(canvas, el('div', 'map-detail'));

  if (map.dropped.length) {
    const boxes = map.dropped.filter((d) => d.what === 'box').length;
    const arrows = map.dropped.length - boxes;
    const list = el('div', 'map-dropped');
    const parts = [];
    if (boxes) parts.push(count(boxes, 'box', 'boxes'));
    if (arrows) parts.push(count(arrows, 'arrow', 'arrows'));
    list.append(el('div', 'error', 'Did not check out, not drawn: ' + parts.join(', ') + '.'));
    for (const d of map.dropped) {
      list.append(el('div', 'mono error', d.what + ' ' + d.name + ' "' + d.label + '": ' + d.reason));
    }
    wrap.append(list);
  }
  return wrap;
}

// Build map / Update map. invader does not write maps or start agents: it
// types a request into the claude or codex already running in the terminal,
// and I press Enter.

const MAP_SHAPE = '{"groups":[{"label":"...","boxes":[{"id":"...","label":"...","paths":["..."]}]}],'
  + '"arrows":[{"from":"box id","to":"box id","label":"...","file":"...","text":"..."}]}';

// The map the button is about: the one open, else the one at the top.
function mapTarget() {
  const open = state.openFile;
  return open && (open === 'map.json' || open.endsWith('/map.json')) ? open : 'map.json';
}

function drawMapButton() {
  const target = mapTarget();
  const exists = target === state.openFile ? state.file?.ok !== false : !!state.info?.map;
  $('map-ask').textContent = exists ? 'Update map' : 'Build map';
}

// Text from the disk goes into the request as one plain line: no control
// characters, so it can never press Return or move the terminal's cursor.
const oneLine = (s, max = 200) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').slice(0, max);

function mapRequest() {
  const target = mapTarget();
  const folder = target === 'map.json' ? 'this folder' : oneLine(target.slice(0, -'map.json'.length));
  const rules = 'Use this shape: ' + MAP_SHAPE + '. '
    + 'Group the important parts into a few boxes, about 5 to 12, with labels in plain words someone without an engineering background understands. '
    + 'Put the folders at the top of ' + folder + ' together in one group, and what sits inside them in groups of their own. '
    + 'Every path is relative to ' + folder + ' and must exist; a folder path ends in /. '
    + 'Each arrow connects two boxes; its text must be copied exactly from its file and must show the connection its label claims. '
    + 'Leave out anything you are not sure of. Write only ' + oneLine(target) + ' and change nothing else.';
  if ($('map-ask').textContent === 'Build map') {
    const where = target === 'map.json' ? 'at the top of this folder' : 'in ' + folder;
    return 'Write map.json ' + where + ' for invader, a viewer that draws it as a map of how the project fits together. ' + rules;
  }
  let found = 'Check it against the folder as it is now.';
  const map = target === state.openFile && state.file?.ok ? state.file.value.map : null;
  if (map?.error) found = 'invader cannot read it: ' + oneLine(map.error) + '.';
  else if (map?.dropped.length) {
    const items = map.dropped.slice(0, 20).map((d) => d.what + ' ' + oneLine(d.name, 60) + ': ' + oneLine(d.reason));
    found = 'invader dropped these because they did not check out: ' + items.join('; ') + '.';
  } else if (map) found = 'Everything in it checks out now; add important parts that are missing and fix anything no longer true.';
  return 'Update ' + oneLine(target) + ' for invader so it matches the folder as it is now. ' + found + ' Fix or remove what is wrong and add important parts that are missing. ' + rules;
}

async function askForMap() {
  const label = $('map-ask').textContent;
  const res = await window.terminal.program();
  const run = res.ok ? res.value : {};
  if (!run.program) {
    $('note').textContent = 'Start claude or codex in the terminal, then press ' + label + ' again.';
    return;
  }
  pasteIntoTerminal(mapRequest());
  $('note').textContent = 'The request is typed into ' + (run.agent || run.program) + '. Read it, then press Enter.';
}

function currentMap() {
  const v = state.file?.ok && state.file.value.map;
  return v && !v.error ? v : null;
}

// The map fits the middle pane: its columns and the space between them
// narrow together, down to widths that still read, and then the whole map is
// drawn smaller, down to 80%. A map with more columns than that scrolls
// sideways. Returns the space between columns, the room kept on the left and
// right for arrows that loop back into the first or last column, and how much
// smaller it is drawn. Room is kept at the bottom for long arrows that pass
// under a group.
function fitMap(canvas, map) {
  const n = map.groups.length;
  const loops = (g) => {
    const ids = new Set(g?.boxes.map((b) => b.id));
    return map.arrows.some((a) => ids.has(a.from) && ids.has(a.to));
  };
  const left = n > 1 && loops(map.groups[0]) ? 96 : 0;
  const right = loops(map.groups[n - 1]) ? 96 : 8;
  const colOf = new Map(map.groups.flatMap((g, c) => g.boxes.map((b) => [b.id, c])));
  const long = map.arrows.some((a) => Math.abs(colOf.get(a.from) - colOf.get(a.to)) > 1);
  const room = $('file-body').clientWidth - 40; // .map has 20px each side
  const s = Math.min(1, (room - left - right) / (n * 220 + (n - 1) * 160));
  const col = Math.max(150, Math.round(220 * s));
  const gap = Math.max(72, Math.round(160 * s));
  const zoom = Math.max(0.8, Math.min(1, room / (left + n * col + (n - 1) * gap + right)));
  canvas.style.setProperty('--col', col + 'px');
  canvas.style.setProperty('--gap', gap + 'px');
  canvas.style.paddingLeft = left + 'px';
  canvas.style.paddingRight = right + 'px';
  canvas.style.paddingBottom = long ? '28px' : '';
  canvas.style.zoom = zoom < 1 ? zoom : '';
  return { gap, left, right, zoom };
}

// An arrow's label, on as many lines as it takes to be no wider than max.
function labelLines(text, label, max) {
  text.textContent = label;
  if (text.getComputedTextLength() <= max) return;
  const lines = [];
  let line = '';
  for (const word of label.split(/\s+/)) {
    text.textContent = line ? line + ' ' + word : word;
    if (line && text.getComputedTextLength() > max) {
      lines.push(line);
      line = word;
    } else {
      line = text.textContent;
    }
  }
  lines.push(line);
  text.replaceChildren(...lines.map((l, i) => {
    const span = svg('tspan', { x: text.getAttribute('x'), dy: i ? '1.2em' : -(lines.length - 1) * 0.6 + 'em' });
    span.textContent = l;
    return span;
  }));
}

// Where each arrow meets its boxes, and the curve between them.
function layoutMap() {
  const map = currentMap();
  const canvas = document.querySelector('.map-canvas');
  if (!map || !canvas) return;
  const { gap, left, right, zoom } = fitMap(canvas, map);
  const lines = canvas.querySelector('.map-lines');
  lines.replaceChildren();
  lines.setAttribute('width', canvas.scrollWidth);
  lines.setAttribute('height', canvas.scrollHeight);

  // Places on screen, in the map's own units: a map drawn smaller reports
  // them smaller.
  const origin = canvas.getBoundingClientRect();
  const mapX = (screenX) => (screenX - origin.left) / zoom;
  const mapY = (screenY) => (screenY - origin.top) / zoom;
  const boxes = new Map();
  const cols = [...canvas.querySelectorAll('.map-group')];
  const colLeft = cols.map((col) => mapX(col.getBoundingClientRect().left));
  const colRight = cols.map((col) => mapX(col.getBoundingClientRect().right));
  // Where a long arrow can cross a column without passing behind a box: the
  // space between two boxes, or under the group.
  const lanes = cols.map((col) => {
    const rs = [...col.querySelectorAll('.map-box')].map((node) => node.getBoundingClientRect());
    const ys = rs.slice(1).map((r, k) => mapY((rs[k].bottom + r.top) / 2));
    ys.push(mapY(col.getBoundingClientRect().bottom) + 12);
    return ys;
  });
  const laneUse = new Map();
  cols.forEach((col, ci) => {
    for (const node of col.querySelectorAll('.map-box')) {
      const r = node.getBoundingClientRect();
      boxes.set(node.dataset.id, {
        col: ci,
        left: mapX(r.left),
        right: mapX(r.right),
        top: mapY(r.top),
        h: r.height / zoom,
        mid: mapY(r.top + r.height / 2),
      });
    }
  });

  // Each arrow leaves one side of a box and enters one side of another.
  const ends = new Map();
  const plans = map.arrows.map((a, i) => {
    const f = boxes.get(a.from);
    const t = boxes.get(a.to);
    let fromSide = 'right';
    let toSide = 'left';
    if (f.col > t.col) [fromSide, toSide] = ['left', 'right'];
    // A loop within one column goes out on the right, or on the left of the
    // first column, where no other arrow leaves or arrives.
    if (f.col === t.col) [fromSide, toSide] = f.col === 0 && left ? ['left', 'left'] : ['right', 'right'];
    const plan = { i, a, f, t, fromSide, toSide, west: fromSide === 'left' && f.col === t.col };
    for (const [box, side, other, key] of [[f, fromSide, t, 'p0'], [t, toSide, f, 'p3']]) {
      const k = a[key === 'p0' ? 'from' : 'to'] + ':' + side;
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push({ plan, key, box, side, order: other.mid });
    }
    return plan;
  });
  for (const list of ends.values()) {
    list.sort((x, y) => x.order - y.order);
    list.forEach((e, n) => {
      const y = e.box.top + (e.box.h * (n + 1)) / (list.length + 1);
      e.plan[e.key] = { x: e.side === 'right' ? e.box.right : e.box.left, y };
    });
  }

  // Every line is drawn first and the labels after them, so no line is drawn
  // over a label.
  const live = liveBoxes();
  const drawn = plans.map((p) => {
    const { p0, p3 } = p;
    // The curves the arrow is made of. Between them it runs straight.
    const curve = (s, e) => {
      const dx = (e.x - s.x) / 2;
      return { s, c1: { x: s.x + dx, y: s.y }, c2: { x: e.x - dx, y: e.y }, e };
    };
    let curves;
    if (p.f.col === p.t.col) {
      // Out past the group's edge and back, so the curve clears the group.
      const room = p.west ? left : p.f.col === colRight.length - 1 ? right : gap;
      const out = 16 + Math.max(0, Math.min(60, room / 2 - 16, Math.abs(p3.y - p0.y) * 0.2));
      const x = p.west ? colLeft[0] - out : colRight[p.f.col] + out;
      curves = [{ s: p0, c1: { x, y: p0.y }, c2: { x, y: p3.y }, e: p3 }];
    } else {
      // A long arrow crosses each column in between through the space nearest
      // its path, a little apart from any other arrow already there.
      const step = Math.sign(p.t.col - p.f.col);
      const pts = [p0];
      for (let c = p.f.col + step; c !== p.t.col; c += step) {
        const want = p0.y + ((p3.y - p0.y) * (c - p.f.col)) / (p.t.col - p.f.col);
        const lane = lanes[c].reduce((a, b) => (Math.abs(b - want) < Math.abs(a - want) ? b : a));
        const used = laneUse.get(c + ':' + lane) || 0;
        laneUse.set(c + ':' + lane, used + 1);
        const y = lane + [0, 4, -4][used % 3];
        const [a, b] = step > 0 ? [colLeft[c], colRight[c]] : [colRight[c], colLeft[c]];
        pts.push({ x: a, y }, { x: b, y });
      }
      pts.push(p3);
      curves = [];
      for (let k = 0; k < pts.length; k += 2) curves.push(curve(pts[k], pts[k + 1]));
    }
    const d = 'M' + p0.x + ',' + p0.y + curves
      .map((q, k) => (k ? ` L${q.s.x},${q.s.y}` : '') + ` C${q.c1.x},${q.c1.y} ${q.c2.x},${q.c2.y} ${q.e.x},${q.e.y}`)
      .join('');
    const c2 = curves[curves.length - 1].c2;
    const angle = Math.atan2(p3.y - c2.y, p3.x - c2.x);
    const head = [-0.45, 0.45]
      .map((s) => `M${p3.x},${p3.y} L${p3.x - 7 * Math.cos(angle + s)},${p3.y - 7 * Math.sin(angle + s)}`)
      .join(' ');

    const g = svg('g', { class: 'arrow' });
    const path = svg('path', { d, class: 'line' });
    g.append(svg('path', { d, class: 'hit' }), path, svg('path', { d: head, class: 'line' }));
    lines.append(g);
    const len = path.getTotalLength();
    const pts = [];
    for (let at = 0; at <= len; at += 3) pts.push(path.getPointAtLength(at));
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const outline = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    return { p, g, path, len, pts, outline };
  });

  // Each label sits on its own arrow, at the place nearest the middle where
  // it covers no other label, group or line.
  const groups = cols.map((col) => {
    const r = col.getBoundingClientRect();
    return { left: mapX(r.left), right: mapX(r.right), top: mapY(r.top), bottom: mapY(r.bottom) };
  });
  const placed = [];
  for (const me of drawn) {
    const { p, pts } = me;
    const g = svg('g', { class: 'arrow' });
    const text = svg('text', { x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    const back = svg('rect', { class: 'label-back' });
    g.append(back, text);
    lines.append(g);
    // Wrapped as wide as its room allows, or narrower on more lines when
    // that finds a clearer place.
    const room = p.west ? left : p.f.col === p.t.col && p.f.col === colRight.length - 1 ? right : gap;
    const widths = [...new Set([room - 12, Math.min(room - 12, 90)])];
    let best = null;
    widths.forEach((max, narrow) => {
      labelLines(text, p.a.label, max);
      const bb = text.getBBox();
      const w = bb.width + 8;
      const h = bb.height + 2;
      for (let k = Math.round(pts.length * 0.1); k <= pts.length * 0.9; k++) {
        const pt = pts[k];
        const at = k / (pts.length - 1);
        // Beside a loop within one column, clear of the group's edge.
        let x = pt.x;
        if (p.west) x = Math.min(x, colLeft[0] - 4 - w / 2);
        else if (p.f.col === p.t.col) x = Math.max(x, colRight[p.f.col] + 4 + w / 2);
        const y = pt.y;
        const box = { left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 };
        const covers = (r, m) => box.left - m < r.right && r.left < box.right + m && box.top - m < r.bottom && r.top < box.bottom + m;
        const onPoint = (q) => box.left - 2 < q.x && q.x < box.right + 2 && box.top - 2 < q.y && q.y < box.bottom + 2;
        // Other lines are checked last, and only where the place could still be best.
        let cost = placed.filter((r) => covers(r, 2)).length * 1000
          + groups.filter((r) => covers(r, 0)).length * 100
          + narrow * 0.5
          + Math.abs(at - 0.5);
        if (best && cost >= best.cost) continue;
        cost += drawn.filter((o) => o !== me && covers(o.outline, 2) && o.pts.some(onPoint)).length * 10;
        if (!best || cost < best.cost) best = { cost, max, x, y, w, h, box };
      }
    });
    labelLines(text, p.a.label, best.max);
    const { w, h } = best;
    placed.push(best.box);
    text.setAttribute('x', best.x);
    text.setAttribute('y', best.y);
    for (const span of text.children) span.setAttribute('x', best.x);
    back.setAttribute('x', best.box.left);
    back.setAttribute('y', best.box.top);
    back.setAttribute('width', w);
    back.setAttribute('height', h);

    // The line and its label act as one arrow.
    const both = [me.g, g];
    for (const part of both) {
      part.dataset.i = p.i;
      part.classList.toggle('live', live.has(p.a.from) || live.has(p.a.to));
      part.addEventListener('click', () => selectOnMap({ arrow: p.i }));
      part.addEventListener('mouseenter', () => both.forEach((n) => n.classList.add('hover')));
      part.addEventListener('mouseleave', () => both.forEach((n) => n.classList.remove('hover')));
    }
  }
  markWide();
  markMap();
}

// A map wider than the pane, even drawn smaller, scrolls sideways. While the
// terminal is shown, the line above the map says so and offers to hide it.
function markWide() {
  const wide = document.querySelector('.map-wide');
  if (!wide) return;
  const body = $('file-body');
  wide.replaceChildren();
  if (body.scrollWidth <= body.clientWidth || document.querySelector('main').classList.contains('term-hidden')) return;
  const hide = el('span', 'link', 'hide the terminal');
  hide.addEventListener('click', () => showTerminal(false));
  wide.append(' · ', hide, ' to see all of it');
}

// The boxes the agent is working in right now: files in them changed in the
// last few seconds. Their arrows are drawn brighter.
const liveBoxes = () => new Set([...document.querySelectorAll('.map-box.recent')].map((n) => n.dataset.id));

function selectOnMap(sel) {
  const same = state.mapSel && sel.arrow === state.mapSel.arrow;
  state.mapSel = same ? null : sel;
  markMap();
}

// A picked arrow marks its boxes and shows the file and text that hold it up.
function markMap() {
  const map = currentMap();
  const sel = state.mapSel;
  const detail = document.querySelector('.map-detail');
  if (!map || !detail) return;
  const arrow = sel && sel.arrow != null ? map.arrows[sel.arrow] : null;
  const live = liveBoxes();
  for (const g of document.querySelectorAll('.map-lines .arrow')) {
    const i = Number(g.dataset.i);
    const a = map.arrows[i];
    if (!a) continue; // drawn from the map shown before, not redrawn yet
    g.classList.toggle('on', sel?.arrow === i);
    g.classList.toggle('live', live.has(a.from) || live.has(a.to));
  }
  for (const node of document.querySelectorAll('.map-box')) {
    const id = node.dataset.id;
    node.classList.toggle('on', arrow != null && (arrow.from === id || arrow.to === id));
  }
  detail.replaceChildren();
  if (!arrow) {
    detail.append(el('span', 'dim', 'Click a box to go to it, or an arrow to see what holds it up.'));
    return;
  }
  const label = (id) => map.groups.flatMap((g) => g.boxes).find((b) => b.id === id).label;
  const file = el('span', 'mono link', arrow.file);
  file.title = arrow.rel;
  file.addEventListener('click', () => openLinked(arrow.rel, arrow.text));
  detail.append(
    el('span', null, label(arrow.from) + ' ' + arrow.label + ' ' + label(arrow.to) + '. '),
    file,
    el('span', 'dim', ' contains '),
    el('span', 'mono quote', arrow.text),
  );
}

new ResizeObserver(() => layoutMap()).observe($('file-body'));

// Changes. The main process watches the open folder and sends what changed:
// from Git, what is not committed yet; without Git, what changed since the
// folder was opened. They are marked in the tree, on the map, on the open
// file and in the list. What changed in the last few seconds is marked more.

const WORD = { new: 'new', changed: 'changed', deleted: 'deleted' };

const under = (dir, p) => dir === '' || p === dir || p.startsWith(dir + '/');
const isRecent = (p) => Date.now() - (state.recent.get(p) ?? 0) < RECENT_MS;
const countUnder = (dir) => [...state.changes.keys()].filter((p) => under(dir, p)).length;
const recentUnder = (dir) => [...state.recent.keys()].some((p) => under(dir, p) && isRecent(p));

// Motion. Marks fade in when they appear and out when they go; nothing else
// moves. The tree and the map are often built anew as files change, so the
// marks on the page after each pass are remembered: a mark that was already
// there is drawn still, and only a new one fades in. With reduce motion set
// in the system, marks change at once.

const still = matchMedia('(prefers-reduced-motion: reduce)');
const FADE_IN_MS = 400;
const FADE_OUT_MS = 1000; // as long as the pulse takes to fade out
const colour = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function fade(node, keyframes, ms, options = {}) {
  return node.animate(keyframes, { duration: still.matches ? 0 : ms, easing: 'ease', ...options });
}

const appear = (node) => fade(node, [{ opacity: 0 }, { opacity: 1 }], FADE_IN_MS);

// Fade node out where it is, then take it off the page.
function vanish(node, then) {
  node.classList.add('going');
  const done = () => {
    node.remove();
    then?.();
  };
  fade(node, [{ opacity: 1 }, { opacity: 0 }], FADE_OUT_MS, { fill: 'forwards' }).finished.then(done, done);
}

let marksShown = new Set(); // marks on the page after the last pass
let marksNow = new Set();   // marks made in this pass

// Note a mark made in this pass; true when it was not there before.
function isNew(key) {
  marksNow.add(key);
  return !marksShown.has(key);
}

// The changed word in node, such as "changed" or "3 changed". Returns
// 'added' or 'removed' when one came or went.
function setWord(node, text, key, { tag = 'span', place = (w) => node.append(w), gone } = {}) {
  const had = [...node.children].find((c) => c.classList.contains('chg') && !c.classList.contains('going'));
  if (!text) {
    if (!had) return null;
    vanish(had, gone);
    return 'removed';
  }
  const fresh = isNew('word:' + key);
  if (had) {
    had.textContent = text;
    return null;
  }
  const word = el(tag, 'chg', text);
  place(word);
  if (fresh) appear(word);
  return 'added';
}

// The left edge on a row that changed in the last few seconds. key is given
// for rows that are built anew, like the tree's.
function setEdge(node, on, key) {
  const was = node.classList.contains('recent');
  node.classList.toggle('recent', on);
  if (on && (key ? isNew('edge:' + key) : !was)) {
    fade(node, [{ borderLeftColor: 'transparent', offset: 0 }], FADE_IN_MS);
  } else if (!on && was) {
    fade(node, [{ borderLeftColor: colour('--changed'), offset: 0 }], FADE_OUT_MS);
  }
}

function markChanges() {
  marksNow = new Set();
  for (const row of $('tree').querySelectorAll('.row[data-path]')) {
    const p = row.dataset.path;
    const dir = row.classList.contains('dir');
    const n = dir ? countUnder(p) : 0;
    setWord(row, dir ? (n ? n + ' changed' : null) : WORD[state.changes.get(p)], 'tree:' + p);
    setEdge(row, dir ? recentUnder(p) && !row.classList.contains('open') : isRecent(p), 'tree:' + p);
  }

  let boxesChanged = false;
  for (const node of document.querySelectorAll('.map-box')) {
    if (markBox(node)) boxesChanged = true;
  }
  // A box that grew moves the arrows; otherwise only their marks change.
  if (boxesChanged) layoutMap();
  else markMap();

  const head = $('file-head');
  const kind = state.openFile && state.changes.get(state.openFile);
  if (head.firstChild) {
    setWord(head, WORD[kind], 'head:' + state.openFile, { place: (w) => head.firstChild.after(w) });
  }
  marksShown = marksNow;
}

// A map box: its border and count when its files changed, and its pulse
// while the agent works in it. Returns whether it grew, which moves arrows.
// When its count goes, the arrows are moved once it has faded.
function markBox(node) {
  const id = node.dataset.id;
  const rels = node.dataset.paths.split('\n');
  const n = [...state.changes.keys()].filter((p) => rels.some((r) => under(r, p))).length;
  const wasChanged = node.classList.contains('changed');
  node.classList.toggle('changed', n > 0);
  if (n && isNew('box:' + id)) fade(node, [{ borderColor: colour('--border'), offset: 0 }], FADE_IN_MS);
  else if (!n && wasChanged) fade(node, [{ borderColor: colour('--changed'), offset: 0 }], FADE_OUT_MS);
  const word = setWord(node, n ? n + ' changed' : null, 'box:' + id, { tag: 'div', gone: layoutMap });

  // The pulse runs only while it shows, and on while it fades out. It keeps
  // time with the clock, so a box drawn again keeps its beat.
  const was = node.classList.contains('recent');
  const now = rels.some((r) => recentUnder(r));
  node.classList.toggle('recent', now);
  const pulse = { pseudoElement: '::after' };
  if (now) {
    if (!was && !node.classList.contains('fading')) node.style.setProperty('--beat', -(Date.now() % PULSE_MS) + 'ms');
    // A fade-out still running from before would hide it.
    if (!was) {
      for (const a of node.getAnimations({ subtree: true })) {
        if (!(a instanceof CSSAnimation) && a.effect.pseudoElement === '::after') a.cancel();
      }
    }
    if (isNew('pulse:' + id)) fade(node, [{ opacity: 0 }, { opacity: 1 }], FADE_OUT_MS, pulse);
  } else if (was) {
    node.classList.add('fading');
    const done = () => node.classList.remove('fading');
    fade(node, [{ opacity: 1 }, { opacity: 0 }], FADE_OUT_MS, pulse).finished.then(done, () => {});
  }
  return word === 'added';
}

// The changed list. Rows stay put while they are listed; a new one fades
// in and one that goes fades out where it was.
function drawChanges() {
  const box = $('changes');
  const list = [...state.changes].sort((a, b) => a[0].localeCompare(b[0]));
  const since = state.git ? 'since the last commit' : 'since this folder was opened';
  const head = box.querySelector('.changes-head') || el('div', 'changes-head');
  head.textContent = list.length ? list.length + ' changed ' + since : 'Nothing changed ' + since + '.';
  const old = new Map([...box.querySelectorAll('.row[data-key]:not(.going)')].map((r) => [r.dataset.key, r]));
  const shown = list.slice(0, 500);
  const rows = [];
  for (const [p, kind] of shown) {
    let row = old.get(p);
    old.delete(p);
    if (!row) {
      row = el('div', 'row mono');
      row.dataset.key = p;
      row.title = p;
      row.append(el('span', 'chg'), document.createTextNode(p));
      row.addEventListener('click', () => row.dataset.path && openLinked(p));
      appear(row);
    }
    row.firstChild.textContent = WORD[kind];
    row.classList.toggle('gone', kind === 'deleted');
    if (kind === 'deleted') delete row.dataset.path;
    else row.dataset.path = p;
    setEdge(row, isRecent(p));
    rows.push(row);
  }
  for (const row of old.values()) vanish(row);
  rows.push(...box.querySelectorAll('.row.going'));
  rows.sort((a, b) => a.dataset.key.localeCompare(b.dataset.key));
  const more = list.length - shown.length;
  box.replaceChildren(head, ...rows, ...(more > 0 ? [el('div', 'row dim', 'and ' + more + ' more')] : []));
}

// The status strip: what runs in the terminal, whether the folder is
// watched, the branch, how many files changed and how much of the top map
// checked out. A cell whose words change is drawn anew; the others stay.
function drawStrip() {
  const cells = [];
  const run = state.running;
  cells.push(['agent', [['label', 'agent'], [run.agent ? 'value' : 'value dim', run.agent || 'none']],
    run.agent ? run.agent + ' is running in the terminal.'
      : run.program ? run.program + ' is running in the terminal. It is not claude or codex.'
        : 'Nothing is running in the terminal. Start claude or codex there.']);

  const c = state.status;
  if (c) {
    if (c.watchError) cells.push(['watch', [['value error', 'not watching']], c.watchError]);
    else if (c.watching) cells.push(['watch', [['value', 'watching']], 'Changes in this folder are marked as they happen.']);
    else cells.push(['watch', [['value dim', 'not watching']], 'Changes in this folder are not being marked.']);

    if (c.git) cells.push(['branch', [['label', 'branch'], ['value', c.branch || 'none']], 'The Git branch this folder is on.']);
    else cells.push(['branch', [['value dim', 'no Git']], 'This folder is not in a Git repository.']);

    const n = c.list.length;
    cells.push(['changed', [[n ? 'value chg' : 'value dim', String(n)], ['label', 'changed']],
      count(n, 'file', 'files') + ' changed ' + (c.git ? 'since the last commit.' : 'since this folder was opened.')]);

    const m = c.map;
    if (m.state === 'none') cells.push(['map', [['value dim', 'no map']], m.detail]);
    else if (m.state === 'error') cells.push(['map', [['label', 'map'], ['value error', 'cannot be read']], m.detail]);
    else {
      cells.push(['map', [['label', 'map'], [m.state === 'ok' ? 'value' : 'value error', m.checked + '/' + m.total],
        ['label', 'checked']], m.detail]);
    }
  }

  const strip = $('strip');
  const old = new Map([...strip.children].map((node) => [node.dataset.key, node]));
  strip.replaceChildren(...cells.map(([key, parts, title]) => {
    const words = JSON.stringify(parts);
    let cell = old.get(key);
    if (!cell || cell.dataset.words !== words) {
      cell = el('span', 'cell');
      cell.dataset.key = key;
      cell.dataset.words = words;
      for (const [cls, text] of parts) cell.append(el('span', cls, text), ' ');
      cell.lastChild.remove();
      if (key === 'map' && state.status.map.state !== 'none') {
        cell.classList.add('go');
        cell.addEventListener('click', () => openLinked('map.json'));
      }
      appear(cell);
    }
    cell.title = title;
    return cell;
  }));
}

let treeTimer = null;
function refreshTreeSoon() {
  if (treeTimer) return;
  treeTimer = setTimeout(async () => {
    treeTimer = null;
    await renderTree();
  }, 300);
}

// Each file loses its recent mark when its own few seconds are up.
let fadeTimer = null;
function expireRecentSoon() {
  clearTimeout(fadeTimer);
  if (state.recent.size === 0) return;
  const next = Math.min(...state.recent.values()) + RECENT_MS;
  fadeTimer = setTimeout(() => {
    const now = Date.now();
    for (const [p, t] of state.recent) if (now - t >= RECENT_MS) state.recent.delete(p);
    drawChanges();
    markChanges();
    expireRecentSoon();
  }, Math.max(0, next - Date.now()) + 50);
}

window.disk.onChanges(async (c) => {
  if (c.root !== state.root) return;
  state.status = c;
  state.changes = new Map(c.list);
  state.git = c.git;
  const now = Date.now();
  for (const p of c.touched) state.recent.set(p, now);
  for (const [p, t] of state.recent) if (now - t > RECENT_MS) state.recent.delete(p);
  drawStrip();
  drawChanges();
  markChanges();
  expireRecentSoon();
  // The map at the top came or went. When it just appeared, show it, unless
  // I am reading something else.
  if (c.touched.includes('map.json')) {
    const had = state.info?.map;
    const reading = state.openFile && state.openFile !== state.info?.readme;
    await loadFolder();
    if (!had && state.info?.map && !reading) await showRoot();
  }
  if (c.touched.length) {
    refreshTreeSoon();
    const open = state.openFile;
    const onMap = currentMap() || state.file?.value?.map;
    if (open && (c.touched.includes(open) || onMap)) await rereadFile();
  }
});

$('open').addEventListener('click', async () => {
  const res = await window.disk.chooseFolder();
  $('note').textContent = res.ok && res.value === 'busy'
    ? 'Something is running in the terminal. Quit it, then open the folder again.'
    : '';
});
$('root').addEventListener('click', showRoot);
$('map-ask').addEventListener('click', askForMap);
window.disk.onFolderChanged(openFolder);
window.disk.onFolderWaiting((folder) => {
  const note = $('file-body').querySelector('.save-note');
  if (note) note.textContent = 'The terminal moved to ' + folder.split('/').pop() + '. Save or Discard your edit and the window follows.';
});
// The notes beside the buttons are all about what runs in the terminal, so
// they go when that changes.
window.terminal.onProgram((run) => {
  state.running = run;
  $('note').textContent = '';
  drawStrip();
});
window.terminal.program().then((res) => {
  if (res.ok) state.running = res.value;
  drawStrip();
});
openFolder();
