// File: plain text, or Markdown rendered from tokens. Read-only, except that
// a Markdown file's plain text can be edited by hand and saved.

// home: whether it is shown on the open folder's own page, above what happened there.
async function openFile(rel, home = false) {
  if (!leaveEdit()) return;
  noteLeaving();
  state.page = null;
  state.home = home;
  state.openFile = rel;
  state.find = null;
  state.goLine = null;
  state.mapSel = null;
  state.mapView = 'rendered';
  markOpenFile();
  await renderFile();
}

async function renderFile() {
  const turn = nextTurn();
  const res = state.openFile ? await window.disk.readFile(state.openFile) : null;
  if (!isTurn(turn)) return;
  state.file = res;
  drawFile();
}

// The open file may have changed on disk: read it again. When what it shows
// is the same, nothing is drawn again; otherwise it is, and I stay where I was.
// A file with an edit not saved yet is left as I have it; if the disk moved
// on under it, the edit bar says so.
async function rereadFile() {
  if (state.page) return;
  const rel = state.openFile;
  const turn = middleTurn;
  const res = await window.disk.readFile(rel);
  if (!isTurn(turn) || rel !== state.openFile || JSON.stringify(res) === JSON.stringify(state.file)) return;
  if (isDraft(rel) && $('file-body').querySelector('textarea')) {
    state.file = res;
    drawEditBar();
    return;
  }
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
//
// An edit not saved yet is a draft: it stays with its file while I look at
// other tabs, and its tab shows a dot. A moment after I stop typing it is
// also kept for recovery in the app's own data folder (main/drafts.js), so a
// quit, a crash or a folder switch does not lose it; it comes back as an
// unsaved edit when the folder opens again. Only Save writes to the file.
// Discard, or closing its tab (which asks), drops it, from the recovery
// store too.
const lf = (text) => text.replace(/\r\n/g, '\n');
// path -> { text: what I typed, from: the file's text when I started,
// kept: when this text was kept for recovery, or 0 while it is not yet,
// error: why it could not be kept, recovered: when it was kept, if it came
// back from the recovery store }
state.drafts = new Map();

const isDraft = (rel) => state.drafts.has(rel);
const unsaved = () => state.drafts.size > 0;

// The editor's text into the drafts: kept while it differs from where it started.
function noteDraft(rel, text, from) {
  const had = state.drafts.get(rel);
  if (text !== lf(from)) {
    state.drafts.set(rel, { ...had, text, from, kept: 0, error: had?.error ?? null, recovered: had?.recovered ?? 0 });
    keepSoon(rel);
  } else if (had) {
    state.drafts.delete(rel);
    forgetKept(rel);
  }
  if (!!had !== isDraft(rel)) drawTabs();
  tellUnsaved();
}

// Keeping drafts for recovery, a moment after the last key, one write at a
// time per file.
const keepTimers = new Map();
const keeping = new Map(); // path -> the write under way
const KEEP_MS = 400;
function keepSoon(rel) {
  clearTimeout(keepTimers.get(rel));
  keepTimers.set(rel, setTimeout(() => keepNow(rel), KEEP_MS));
}
async function keepNow(rel) {
  clearTimeout(keepTimers.get(rel));
  keepTimers.delete(rel);
  await keeping.get(rel);
  const d = state.drafts.get(rel);
  if (!d || d.kept) return;
  const root = state.root;
  const write = window.drafts.keep(root, rel, d.text, d.from).then((res) => {
    if (state.root !== root || state.drafts.get(rel) !== d) return;
    if (res.ok) Object.assign(d, { kept: res.value, error: null });
    else d.error = res.error;
    tellUnsaved();
    if (state.openFile === rel) drawEditStatus();
  });
  keeping.set(rel, write);
  await write;
  if (keeping.get(rel) === write) keeping.delete(rel);
}
function forgetKept(rel) {
  clearTimeout(keepTimers.get(rel));
  keepTimers.delete(rel);
  const root = state.root;
  const drop = Promise.resolve(keeping.get(rel)).then(() => window.drafts.drop(root, rel));
  keeping.set(rel, drop);
  drop.then(() => keeping.get(rel) === drop && keeping.delete(rel));
}
// Every draft written to the recovery store now, as before leaving the
// folder or quitting. Says, for each, whether it is kept and why not.
async function keepAll() {
  await Promise.all([...state.drafts.keys()].map(keepNow));
  return [...state.drafts].map(([rel, d]) => ({ rel, kept: !!d.kept, error: d.error || null }));
}

// Main is told which files have an edit not saved yet, and whether each is
// kept, so quitting asks first and the window does not follow the terminal
// away from them.
let toldUnsaved = null;
function tellUnsaved() {
  const list = [...state.drafts].map(([rel, d]) => ({ rel, kept: !!d.kept, error: d.error || null }));
  const said = JSON.stringify(list);
  if (said === toldUnsaved) return;
  toldUnsaved = said;
  window.disk.setUnsaved(list);
}

// Before the middle shows something else. A draft is kept, so nothing is lost
// and nothing is asked; this stays so every way out goes through one place.
function leaveEdit() {
  return true;
}

// Before leaving the folder. Drafts are written to the recovery store and
// come back when the folder opens again, so nothing is asked unless one
// could not be kept; then it asks whether to discard it. Main is told there
// are none, so it lets the window go. When nothing opens after all, as when
// the terminal is busy or I cancel, keepEdits puts that back.
async function leaveAllEdits(what) {
  if (!unsaved()) return true;
  const list = await keepAll();
  const lost = list.filter((d) => !d.kept);
  if (lost.length) {
    const why = lost.find((d) => d.error)?.error;
    if (!confirm('Your unsaved edits to ' + lost.map((d) => d.rel).join(', ') + ' could not be kept for recovery' + (why ? ' (' + why + ')' : '') + '. Discard them and ' + what + '?')) return false;
  }
  toldUnsaved = null;
  window.disk.setUnsaved([]);
  return true;
}

function keepEdits() {
  toldUnsaved = undefined;
  tellUnsaved();
}

function dropDraft(rel) {
  state.drafts.delete(rel);
  forgetKept(rel);
  tellUnsaved();
  drawTabs();
}

// The drafts kept for this folder, back as unsaved edits, each with a tab.
// One whose file now holds exactly what I typed was saved after all, and
// goes quietly.
async function recoverDrafts() {
  const root = state.root;
  const res = await window.drafts.list();
  if (!res.ok || state.root !== root) return 0;
  let n = 0;
  for (const r of res.value) {
    if (state.drafts.has(r.rel)) continue;
    const now = await window.disk.readFile(r.rel);
    if (state.root !== root) return n;
    if (now.ok && now.value.text != null && lf(now.value.text) === r.text) {
      window.drafts.drop(root, r.rel);
      continue;
    }
    state.drafts.set(r.rel, { text: r.text, from: r.from, kept: r.at, error: null, recovered: r.at });
    if (!state.tabs.includes('file:' + r.rel)) state.tabs.push('file:' + r.rel);
    n++;
  }
  tellUnsaved();
  return n;
}

// Save every draft, as Save and Quit does. Each is saved only if its file
// still holds what the edit started from. Returns the ones not saved, and why;
// they stay drafts, and the first is shown with the reason.
async function saveAllDrafts() {
  const failed = [];
  for (const [rel, d] of [...state.drafts]) {
    const res = await window.disk.saveMarkdown(rel, withEndings(d.text, d.from), d.from);
    if (res.ok) {
      state.drafts.delete(rel);
      forgetKept(rel);
    } else {
      failed.push({ rel, error: /^Changed on disk/.test(res.error) ? 'it changed on disk since you started editing' : res.error });
    }
  }
  tellUnsaved();
  drawTabs();
  if (failed.length) {
    const first = failed[0];
    if (state.openFile !== first.rel) await openLinked(first.rel);
    if (state.openFile === first.rel) drawEditBar(first.rel + ' was not saved: ' + first.error + '. Your edit is still here.');
  }
  return { failed };
}
window.drafts.onQuit(keepAll, saveAllDrafts);

// A file written with \r\n on every line is saved with \r\n again; any
// other is saved with \n, as the editor holds it.
function withEndings(text, from) {
  const crlf = from.includes('\r\n') && !/(^|[^\r])\n/.test(from);
  return crlf ? text.replace(/\n/g, '\r\n') : text;
}

// The editor for a Markdown file. text is the file as it is on disk; a draft
// I left, if there is one, is put back in its place.
function drawEditor(head, body, text) {
  const rel = state.openFile;
  const draft = state.drafts.get(rel);
  const from = draft ? draft.from : text;
  const editor = el('textarea', 'mono plain');
  editor.value = draft ? draft.text : lf(text);
  editor.dataset.from = from;
  editor.spellcheck = false;
  editor.setAttribute('aria-label', 'Edit ' + rel);
  const bar = el('div', 'edit-bar');
  bar.hidden = true;
  const save = el('button', 'primary', 'Save');
  const discard = el('button', null, 'Discard');
  const status = el('span', 'edit-status');
  save.type = discard.type = 'button';
  save.title = 'Write your edit to ' + rel + ' (⌘S)';
  discard.title = 'Drop your edit and go back to the file as it is on disk';
  editor.addEventListener('input', () => {
    noteDraft(rel, editor.value, editor.dataset.from);
    drawEditStatus();
  });
  editor.addEventListener('keydown', (e) => {
    // Tab indents rather than leaving the text.
    if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      document.execCommand('insertText', false, e.shiftKey ? '' : '  ');
    }
  });
  save.addEventListener('click', () => saveEdit());
  discard.addEventListener('click', () => {
    if (!confirm('Discard your edit to ' + rel + '? It is not saved anywhere else.')) return;
    dropDraft(rel);
    renderFile();
  });
  const actions = el('span', 'edit-actions');
  actions.append(status, discard, save);
  const flip = head.querySelector('.switch');
  if (flip) flip.before(actions);
  else head.append(actions);
  body.append(bar, editor);
  drawEditStatus();
  drawEditBar();
}

// Beside Save and Discard: whether there is an edit, and what has happened
// to it. "not saved" is only in this window; "kept" is in the recovery
// store, not in the file; nothing claims more than happened.
function drawEditStatus() {
  const head = $('file-head');
  const status = head.querySelector('.edit-status');
  if (!status) return;
  const rel = state.openFile;
  const d = state.drafts.get(rel);
  for (const b of head.querySelectorAll('.edit-actions button')) b.hidden = !d;
  status.classList.toggle('dirty', !!d);
  status.classList.toggle('error', !!d?.error && !d.kept);
  if (!d) {
    status.textContent = 'editing';
    status.title = 'Type to edit. Nothing is written to the file until you press Save.';
  } else if (d.kept) {
    status.textContent = 'not saved · kept';
    status.title = 'Your edit is not in the file yet. next-invader has kept a copy in its own data folder, so it comes back if the app quits or stops. Save writes it to the file.';
  } else if (d.error) {
    status.textContent = 'not saved · not kept';
    status.title = 'Your edit is only in this window: ' + d.error;
  } else {
    status.textContent = 'not saved';
    status.title = 'Your edit is only in this window for the moment; a copy is kept for recovery once you pause.';
  }
}

// The bar over the editor: why the last save did not go through, or that the
// file changed on disk while I had an edit. It offers each way on, and only
// ever writes when I press Save mine.
function drawEditBar(failed = null) {
  const bar = $('file-body').querySelector('.edit-bar');
  const editor = $('file-body').querySelector('textarea');
  const rel = state.openFile;
  if (!bar || !editor) return;
  const disk = state.file?.ok ? state.file.value.text : null;
  const moved = isDraft(rel) && disk != null && disk !== editor.dataset.from;
  const d = state.drafts.get(rel);
  const recovered = d?.recovered && !d.seen ? d.recovered : 0;
  // The file went while the edit was open: say so now, not at Save.
  if (!failed && d && state.file && !state.file.ok) {
    failed = rel.split('/').pop() + ' is not there any more (' + state.file.error + '): it was moved, renamed or deleted. Your edit is still here and still kept, not saved. Copy it if you want to keep it, or discard it.';
  }
  if (!failed && !moved && !recovered) {
    bar.hidden = true;
    bar.replaceChildren();
    return;
  }
  const b = (label, title, fn) => {
    const button = el('button', null, label);
    button.type = 'button';
    button.title = title;
    button.addEventListener('click', fn);
    return button;
  };
  const when = recovered ? new Date(recovered).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
  const words = failed || (moved
    ? rel.split('/').pop() + ' changed on disk ' + (recovered ? 'since your unsaved edit was kept (' + when + ')' : 'while you were editing it, probably by the agent') + '. Your edit is still here, not saved.'
    : 'Recovered: your unsaved edit from ' + when + ', kept by next-invader. It is not in the file yet: Save writes it, Discard drops it.');
  const gone = !!(d && state.file && !state.file.ok);
  const buttons = gone ? [b('Discard the edit', 'Drop your edit; it is not saved anywhere else', () => {
    if (!confirm('Discard your edit to ' + rel + '? It is not saved anywhere else.')) return;
    dropDraft(rel);
    renderFile();
  })] : failed ? [] : !moved ? [b('OK', 'Hide this note; the edit stays unsaved', () => {
    d.seen = true;
    drawEditBar();
  })] : [
    b('Save mine over it', 'Write your edit to the file, replacing what changed on disk', () => saveEdit(true)),
    b('Load the disk version', 'Drop your edit and show the file as it is now', () => {
      if (!confirm('Drop your edit to ' + rel + ' and load the version on disk?')) return;
      dropDraft(rel);
      renderFile();
    }),
  ];
  bar.replaceChildren(el('span', 'edit-bar-said', words), ...buttons);
  bar.classList.toggle('error', !!failed);
  bar.classList.toggle('warn', !failed && moved);
  bar.hidden = false;
}

// Write the open file's draft. over: write it even though the file changed on
// disk since the edit started, because I said so.
async function saveEdit(over = false) {
  const rel = state.openFile;
  const editor = $('file-body').querySelector('textarea');
  if (!editor || !isDraft(rel)) return;
  const turn = middleTurn;
  const saving = editor.value;
  let from = editor.dataset.from;
  if (over) {
    const now = await window.disk.readFile(rel);
    if (!now.ok || now.value.text == null) return drawEditBar(now.ok ? now.value.reason : now.error);
    from = now.value.text;
  }
  const out = withEndings(saving, from);
  const res = await window.disk.saveMarkdown(rel, out, from);
  // Once it is written, the draft is done, even if I have moved on, and so
  // is its copy kept for recovery; what I typed while it saved stays a draft
  // of the file as saved. A save that failed keeps both.
  if (res.ok) {
    const d = state.drafts.get(rel);
    if (d && d.text !== saving) {
      state.drafts.set(rel, { text: d.text, from: out, kept: 0, error: null, recovered: 0 });
      keepSoon(rel);
    } else {
      state.drafts.delete(rel);
      forgetKept(rel);
    }
    tellUnsaved();
    drawTabs();
    say('Saved ' + rel.split('/').pop() + '.', { fade: true });
  }
  if (!isTurn(turn) || rel !== state.openFile) return;
  if (!res.ok) {
    if (/^Changed on disk/.test(res.error)) {
      const now = await window.disk.readFile(rel);
      if (now.ok) state.file = now;
      return drawEditBar();
    }
    return drawEditBar(rel + ' was not saved: ' + res.error);
  }
  state.file = res;
  redrawInPlace();
}

// Tabs over the middle, as alabs had them: the folder's own page first and
// always there, then each file or page I open, until I close it.
function currentTab() {
  if (state.page === 'setup' || state.page === 'outside') return 'setup';
  if (state.page === 'changes') return 'changes';
  if (state.page === 'preview') return 'preview';
  if (state.home) return 'home';
  if (state.page === 'folder') return 'folder:' + state.folder.rel;
  if (!state.openFile) return 'home';
  return 'file:' + state.openFile;
}

// A tab's name and how to open it again.
function tabOf(key) {
  if (key === 'home') return ['Overview', showRoot];
  if (key === 'setup') return ['agent setup', showSetup];
  if (key === 'changes') return ['changes', showChanges];
  if (key === 'preview') return ['preview', showPreview];
  if (key.startsWith('folder:')) {
    const rel = key.slice('folder:'.length);
    return [rel.split('/').pop() + '/', () => showFolder(rel)];
  }
  // A README or map is named with its folder, since every folder has its own.
  const rel = key.slice('file:'.length);
  const parts = rel.split('/');
  const name = parts.length > 1 && parts.at(-1) === 'map.json' ? parts.at(-2) + ' map'
    : parts.length > 1 && /^readme(\.md|\.markdown)?$/i.test(parts.at(-1)) ? parts.slice(-2).join('/') : parts.at(-1);
  return [name, () => openLinked(rel)];
}

// A tab that shows a folder: a drawn one, or one with its own map.
const isFolderTab = (key) => !!key && (key.startsWith('folder:') || (key.startsWith('file:') && key.endsWith('/map.json')));

function drawTabs() {
  const now = currentTab();
  if (!state.tabs.includes(now)) {
    // Walking from one folder to another stays in the same tab.
    const at = state.tabs.indexOf(state.lastTab);
    if (state.walking && isFolderTab(state.lastTab) && at > 0) state.tabs[at] = now;
    else state.tabs.push(now);
  }
  state.walking = false;
  state.lastTab = now;
  $('tabs').replaceChildren(...state.tabs.map((key) => {
    const [name, open] = tabOf(key);
    const tab = el('button', 'tab' + (key === now ? ' on' : '') + (key === 'home' ? ' home' : '') + (key.startsWith('file:') || key.startsWith('folder:') ? ' file' : ''));
    const part = (key.startsWith('file:') || key.startsWith('folder:')) && partOf(key.slice(key.indexOf(':') + 1));
    if (part) tab.style.setProperty('--g', partColour(part.part));
    tab.type = 'button';
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(key === now));
    tab.title = key.startsWith('file:') || key.startsWith('folder:') ? key.slice(key.indexOf(':') + 1) : key === 'home' ? (state.info?.name ?? 'The folder') + ': its map or README, and what happened here'
      : key === 'preview' ? 'A page served on this computer' + (state.preview.url ? ': ' + state.preview.url : '') : name;
    tab.append(el('span', 'tab-name' + (key.startsWith('file:') || key.startsWith('folder:') ? ' mono' : ''), name));
    tab.addEventListener('click', () => key !== currentTab() && open());
    const draft = key.startsWith('file:') && isDraft(key.slice(5));
    tab.classList.toggle('draft', draft);
    if (draft) tab.title += '\nEdited, not saved';
    if (key !== 'home') {
      const close = el('span', 'tab-close', '×');
      close.title = draft ? 'Close, and discard the edit' : 'Close (⌘W)';
      close.addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(key);
      });
      tab.append(close);
    }
    return tab;
  }));
  $('tabs').querySelector('.tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  saveWorkspaceSoon();
}

// Closing the tab I am in opens the one before it. Closing a file with an
// edit not saved asks first, and drops the edit.
function closeTab(key = currentTab()) {
  const at = state.tabs.indexOf(key);
  if (at <= 0) return;
  const rel = key.startsWith('file:') ? key.slice(5) : null;
  if (rel && isDraft(rel)) {
    if (!confirm('Close ' + rel + ' and discard your unsaved edit?')) return;
    dropDraft(rel);
  }
  if (key === 'preview') closePreviewPage();
  if (key !== currentTab()) {
    state.tabs.splice(at, 1);
    drawTabs();
    return;
  }
  state.tabs.splice(at, 1);
  // A tab closed is not a place to go back to.
  nav.quiet = true;
  tabOf(state.tabs[at - 1])[1]();
  nav.quiet = false;
}

// Go to the tab by steps from the one shown, or to the nth.
function goToTab({ by, at }) {
  const now = state.tabs.indexOf(currentTab());
  const i = at != null ? Math.min(at, state.tabs.length - 1) : (now + by + state.tabs.length) % state.tabs.length;
  if (i === now) return;
  tabOf(state.tabs[i])[1]();
}

// Put the keyboard in the middle, so the arrows scroll what is shown.
function focusMiddle() {
  if (palette) return;
  if (currentTab() === 'preview' && state.preview.live && !state.preview.error) {
    document.activeElement?.blur();
    return window.preview.focus();
  }
  $('file-body').focus({ preventScroll: true });
}

function drawFile() {
  drawMiddle();
  settle();
}

function drawMiddle() {
  drawMapButton();
  drawTabs();
  const head = $('file-head');
  const body = $('file-body');
  head.replaceChildren();
  body.replaceChildren();
  tellUnsaved();
  head.classList.remove('error', 'preview-head');
  body.classList.remove('preview-body');
  // Only the map stays on while the middle shows a map.
  if (state.page || !state.file?.ok || !state.file.value.map) showMapOnly(false);
  if (state.page === 'setup') return drawSetup(head, body);
  if (state.page === 'outside') return drawOutside(head, body);
  if (state.page === 'changes') return drawChangesPage(head, body);
  if (state.page === 'preview') return drawPreviewPage(head, body);
  if (state.page === 'folder') {
    drawFolderPage(head, body);
    if (state.home) body.append(homeSummary());
    return;
  }
  drawOpenFile(head, body);
  // The folder's own page is a place to work: its map or README comes first,
  // and what happened here follows under it.
  if (state.home) body.append(homeSummary());
}

function drawOpenFile(head, body) {
  const res = state.file;
  if (!res) {
    if (state.home) body.append(el('div', 'empty', 'No map.json or README in this folder.'));
    return;
  }
  if (!res.ok) {
    head.classList.add('error');
    head.append(el('span', 'mono', state.openFile + ': ' + res.error));
    // A draft whose file went, moved or renamed under it is still shown, so it
    // can be copied out; it can only be dropped by saying so.
    const draft = state.drafts.get(state.openFile);
    if (draft) {
      const gone = el('div', 'edit-bar error');
      const drop = el('button', null, 'Discard the edit');
      drop.type = 'button';
      drop.addEventListener('click', () => {
        if (!confirm('Discard your edit to ' + state.openFile + '? It is not saved anywhere.')) return;
        dropDraft(state.openFile);
        renderFile();
      });
      gone.append(el('span', 'edit-bar-said', state.openFile + ' is not there any more, so your unsaved edit cannot be saved to it. Copy it from below if you want to keep it.'), drop);
      const text = el('textarea', 'mono plain');
      text.value = draft.text;
      text.readOnly = true;
      body.append(gone, text);
    } else if (res.error === 'Not found') {
      // A tab kept from last time, or open while its file went, says why it is empty.
      const gone = el('div', 'empty');
      const close = el('button', null, 'Close this tab');
      close.type = 'button';
      close.addEventListener('click', () => closeTab());
      gone.append(el('p', null, state.openFile + ' is not there any more: it was moved, renamed or deleted.'), close);
      body.append(gone);
    }
    markChanges();
    return;
  }
  const { path, size, text, reason, tokens, map, markdown, note, partial } = res.value;
  head.append(crumbs(path), el('span', 'mono dim file-size', size.toLocaleString() + ' bytes'));
  head.append(headTools(path));
  if (text == null) {
    body.append(el('div', 'empty', reason));
    markChanges();
    return;
  }
  // A text quoted by an arrow is shown marked in the plain file, and so is a
  // line gone to in a map.
  const find = state.find && text.includes(state.find) ? state.find : null;
  const view = find || (map && state.goLine) ? 'plain' : map ? state.mapView : isDraft(state.openFile) ? 'plain' : state.view;
  if (tokens || map) head.append(viewSwitch(view, map ? 'Map' : 'Rendered', map ? 'mapView' : 'view', markdown ? 'Edit' : 'Plain text'));
  body.scrollTop = 0;
  if (note) body.append(el('div', 'file-note muted', note));
  if (partial) body.append(el('div', 'file-note muted', 'Showing the first ' + mb(text.length) + ' of ' + mb(size) + ', to read only. Find in File looks only at this part.'));
  if (!(map && view === 'rendered')) showMapOnly(false);
  if (map && view === 'rendered') {
    body.append(drawMap(map));
    if (map.error) {
      const spot = el('div', 'map-fallback');
      body.append(spot);
      drawnFolderInto(spot, path.split('/').slice(0, -1).join('/'));
    }
  } else if (tokens && view === 'rendered') {
    body.append(blocks(tokens, el('article', 'md'), path));
  } else if (markdown && !find) {
    drawEditor(head, body, text);
  } else {
    body.append(codeView(text, find));
  }
  markChanges();
  if (map && view === 'rendered') layoutMap();
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1).replace(/\.0$/, '') + ' MB';

function viewSwitch(current, renderedLabel, key, plainLabel = 'Plain text') {
  const wrap = el('span', 'switch');
  const draft = key === 'view' && isDraft(state.openFile);
  for (const [view, label] of [['rendered', renderedLabel], ['plain', plainLabel]]) {
    const b = el('button', view === current ? 'on' : '', label);
    b.type = 'button';
    if (draft && view === 'rendered') {
      b.disabled = true;
      b.title = 'Save or Discard your edit to see it rendered';
    }
    b.addEventListener('click', () => {
      if (view === current) return;
      state[key] = view;
      state.find = null;
      drawFile();
      if (view === 'plain') $('file-body').querySelector('textarea')?.focus();
    });
    wrap.append(b);
  }
  return wrap;
}

// A path on a map: a folder opens as its map; a file opens.
async function openOnMap(rel) {
  const turn = nextTurn();
  const res = await window.disk.readFile(rel);
  if (!isTurn(turn)) return;
  if (res.ok && res.value.folder) showFolder(rel);
  else openLinked(rel);
}

// Links. A relative link or an absolute path inside the open folder opens that file
// here, at the heading its #section names, or the line its #L12 names. A link
// to a #section of the file open goes to that heading. Anything else (the
// web, mail) is shown as text only. Where a link leads is read in
// window/refs.js, from the document holding it.

// A heading's name in links, as GitHub makes it: lower case, spaces as
// hyphens, other punctuation left out.
const slug = (text) => text.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-');

function goToSection(section, { note = true } = {}) {
  if (note) noteLeaving();
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
// go: the line to go to, { line, col, len }, from search, the terminal or a
// #L12 link. ifThere: when it is not there, say so and stay, rather than
// open a tab saying so.
async function openLinked(rel, find = null, section = null, go = null, { ifThere = false } = {}) {
  if (rel === '') return showRoot();
  noteLeaving();
  const turn = nextTurn();
  const res = await window.disk.readFile(rel);
  if (!isTurn(turn)) return;
  if (ifThere && !res.ok) {
    say(rel + (res.error === 'Not found' ? ' is not there.' : ': ' + res.error), { fade: true });
    return;
  }
  const folder = res.ok && res.value.folder;
  if (!folder && !leaveEdit()) return;
  const parts = rel.split('/');
  const upTo = folder ? parts.length : parts.length - 1;
  for (let i = 1; i <= upTo; i++) {
    state.expanded.add(parts.slice(0, i).join('/'));
    if (HIDDEN_DIRS.has(parts[i - 1])) state.unhidden.add(parts.slice(0, i - 1).join('/'));
  }
  if (!folder && HIDDEN_FILES.has(parts.at(-1))) state.unhidden.add(parts.slice(0, -1).join('/'));
  if (!folder) {
    state.page = null;
    state.home = false;
    state.openFile = rel;
    state.file = res;
    state.find = find;
    state.goLine = go;
    state.mapSel = null;
    state.mapView = 'rendered';
  }
  await renderTree();
  if (!isTurn(turn)) return;
  drawFile();
  if (section) goToSection(section, { note: false });
  const target = $('tree').querySelector(folder ? `.row[data-path="${CSS.escape(rel)}"]` : '.row.sel');
  target?.scrollIntoView({ block: 'nearest' });
}
