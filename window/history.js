// Where I have been, so I can go back: Back (⌘[) and Forward (⌘]) step
// through the places the middle showed, each where I was reading it. Every
// tab also keeps its own place, so going back to a tab finds it where I left
// it. None of this is kept after the window closes or the folder changes.
// Going back never drops an edit not saved: drafts stay with their file.

const nav = { back: [], forward: [], quiet: false, arrive: null };
const MAX_BACK = 100;
state.places = new Map(); // tab -> the place I was in it last

// Where I am now: the tab, how far down it, the first line in view of a
// file shown by lines, and the editor's cursor.
function here() {
  const body = $('file-body');
  const place = { key: currentTab(), top: body.scrollTop };
  const code = body.querySelector('.code');
  if (code) place.line = topLine(code, body);
  const editor = body.querySelector('textarea:not([readonly])');
  if (editor) place.caret = [editor.selectionStart, editor.selectionEnd];
  if (currentMap() && state.mapSel) place.mapSel = state.mapSel;
  return place;
}

// The first line whose bottom is in view.
function topLine(code, body) {
  const top = body.getBoundingClientRect().top;
  const chunk = [...code.children].find((c) => c.getBoundingClientRect().bottom > top);
  const ln = chunk && [...chunk.children].find((l) => l.getBoundingClientRect().bottom > top);
  return ln ? Number(ln.dataset.n) : null;
}

const samePlace = (a, b) => a && b && a.key === b.key && Math.abs(a.top - b.top) < 40;

// Called as the middle is about to show something else: the place I leave
// goes on the way back. Every way of opening something calls it first, so a
// call inside another finds the same place and adds nothing.
function noteLeaving() {
  if (state.restoring || !state.root || !$('file-body').childNodes.length) return;
  const now = here();
  state.places.set(now.key, now);
  if (nav.quiet || samePlace(nav.back.at(-1), now)) return;
  nav.back.push(now);
  if (nav.back.length > MAX_BACK) nav.back.shift();
  nav.forward = [];
  drawNav();
}

// After the middle is drawn: go to the line asked for, else, on arriving at
// a tab, to where I was in it.
let drawnKey = null;
function settle() {
  const key = currentTab();
  const arrived = key !== drawnKey;
  drawnKey = key;
  CSS.highlights.delete('target');
  const go = state.goLine;
  state.goLine = null;
  const place = nav.arrive || (arrived && !go && !state.find ? state.places.get(key) : null);
  nav.arrive = null;
  if (go) goToLine(go);
  else if (place) restorePlace(place);
  refreshFind();
  drawNav();
}

function restorePlace(place) {
  const body = $('file-body');
  const code = body.querySelector('.code');
  const ln = code && place.line ? lineNode(code, place.line) : null;
  if (ln) body.scrollTop += ln.getBoundingClientRect().top - body.getBoundingClientRect().top;
  else body.scrollTop = place.top;
  const editor = body.querySelector('textarea:not([readonly])');
  if (editor && place.caret) editor.setSelectionRange(...place.caret);
  if (place.mapSel && currentMap()) {
    state.mapSel = place.mapSel;
    markMap();
  }
}

// Go to a place from the way back or forward, without adding to either.
async function travel(place) {
  if (place.key === currentTab()) return restorePlace(place);
  nav.quiet = true;
  nav.arrive = place;
  const going = tabOf(place.key)[1]();
  nav.quiet = false;
  await going;
}

function goBack() {
  const now = here();
  // A place like the one I am in is no step back.
  while (samePlace(nav.back.at(-1), now)) nav.back.pop();
  const to = nav.back.pop();
  if (!to) return drawNav();
  state.places.set(now.key, now);
  nav.forward.push(now);
  drawNav();
  travel(to);
}

function goForward() {
  const to = nav.forward.pop();
  if (!to) return;
  const now = here();
  state.places.set(now.key, now);
  nav.back.push(now);
  drawNav();
  travel(to);
}

// A new folder starts with no way back.
function resetNav() {
  nav.back = [];
  nav.forward = [];
  nav.arrive = null;
  state.places = new Map();
  state.lines = null;
  drawnKey = null;
  drawNav();
}

// The ‹ › beside the tabs.
function drawNav() {
  const [back, fwd] = [$('nav-back'), $('nav-forward')];
  back.disabled = !nav.back.length;
  fwd.disabled = !nav.forward.length;
  const name = (p) => p ? tabOf(p.key)[0] + (p.line ? ':' + p.line : '') : '';
  back.title = 'Back (⌘[)' + (nav.back.length ? ' to ' + name(nav.back.at(-1)) : '');
  fwd.title = 'Forward (⌘])' + (nav.forward.length ? ' to ' + name(nav.forward.at(-1)) : '');
}

$('nav-back').addEventListener('click', goBack);
$('nav-forward').addEventListener('click', goForward);
// The mouse's own back and forward buttons.
window.addEventListener('mouseup', (e) => {
  if (e.button === 3) goBack();
  if (e.button === 4) goForward();
});

// Unfold the tree down to the file or folder shown and put it in view,
// without opening anything.
async function revealInTree() {
  const rel = state.page === 'folder' ? state.folder.rel : state.page ? null : state.openFile;
  if (rel == null) return say('Show in Tree works for a file or folder.', { fade: true });
  if (mapOnly()) showMapOnly(false);
  const parts = rel.split('/');
  const kit = rel.startsWith('~/kit');
  const isDir = state.page === 'folder' || state.file?.value?.folder;
  for (let i = kit ? 2 : 1; i <= parts.length - (isDir ? 0 : 1); i++) {
    state.expanded.add(parts.slice(0, i).join('/'));
    if (HIDDEN_DIRS.has(parts[i - 1])) state.unhidden.add(parts.slice(0, i - 1).join('/'));
  }
  if (!isDir && HIDDEN_FILES.has(parts.at(-1))) state.unhidden.add(parts.slice(0, -1).join('/'));
  saveWorkspaceSoon();
  await renderTree();
  const row = rel ? $('tree').querySelector(`.row[data-path="${CSS.escape(rel)}"]`) : $('tree').firstChild;
  if (!row) return;
  row.scrollIntoView({ block: 'center' });
  flash(row);
}

// The top map, with the box that names this file or the folder it is in
// chosen. Only what the checked map says: a file no box names is on no map.
async function showOnMap(rel = state.page === 'folder' ? state.folder.rel : state.openFile) {
  const part = rel && !rel.startsWith('~') ? partOf(rel) : null;
  if (!part) return say(state.info?.map ? 'No box on the map names ' + (rel || 'this') + ' or a folder holding it.' : 'This folder has no map.json.', { fade: true });
  await showRoot();
  if (!currentMap()) return;
  state.mapSel = { box: part.id };
  markMap();
  const box = document.querySelector(`.map-box[data-id="${CSS.escape(part.id)}"]`);
  box?.scrollIntoView({ block: 'nearest' });
  if (box) flash(box);
}
