// The palette: a box over the window to go somewhere by typing part of its
// name. ⌘P goes to any file or folder in the open folder; ⌘O, or clicking the
// folder's name, switches to a recent folder. It only opens what the tree and
// Open folder… already could.

// The box itself. Only one is open at a time.
let palette = null;

// Open the palette. source(query) returns the rows to show, each
// { label, detail, hits, dim, head, lead, note, key, run }, or
// { rows, foot, empty } to say more, or null when the query has moved on.
// The row picked runs; a head row, like a file's name over its lines, and a
// dim row cannot be picked.
// value: the text to start with. want: the key of the row to start on.
// wide: for rows of text. keys: more keys the input answers to, by name
// like 'Alt+c'. busy: said when the rows take a moment to come.
function openPalette({ placeholder, source, foot = '', value = '', want = null, wide = false, keys = {}, busy = null }) {
  // Swapping one palette for the other keeps where the focus was before both.
  // Opened while the preview's page had the keyboard, it gives it back there.
  const back = palette ? palette.back : keyboardIn() === 'page' ? 'page' : document.activeElement;
  if (palette) closePalette(false);
  const box = $('palette');
  const input = $('palette-input');
  palette = { source, rows: [], at: 0, back, foot, want, keys, busy, empty: null };
  input.value = value;
  input.placeholder = placeholder;
  box.querySelector('.palette-box').classList.toggle('wide', wide);
  setFoot(foot);
  box.hidden = false;
  input.focus();
  input.select();
  fillPalette();
}

function setFoot(foot) {
  const node = $('palette-foot');
  if (typeof foot === 'string') node.textContent = foot;
  else node.replaceChildren(foot);
}

const pickable = (r) => r && !r.dim && !r.head && !!r.run;

// back: return the focus to where it was, when nothing was picked.
function closePalette(back = true) {
  if (!palette) return;
  const was = palette.back;
  palette = null;
  $('palette').hidden = true;
  $('palette-list').replaceChildren();
  if (!back) return;
  if (was === 'page') {
    if (currentTab() === 'preview') requestAnimationFrame(() => window.preview.focus());
  } else if (was?.isConnected) was.focus();
}

async function fillPalette() {
  if (!palette) return;
  const p = palette;
  const query = $('palette-input').value;
  const slow = p.busy && setTimeout(() => {
    if (p !== palette || query !== $('palette-input').value) return;
    $('palette-list').classList.add('busy');
    setFoot(p.busy);
  }, 150);
  let got;
  try {
    got = await p.source(query);
  } finally {
    clearTimeout(slow);
  }
  if (got == null || p !== palette || query !== $('palette-input').value) return;
  $('palette-list').classList.remove('busy');
  const rows = Array.isArray(got) ? got : got.rows;
  p.rows = rows;
  p.empty = Array.isArray(got) ? null : got.empty || null;
  setFoot(Array.isArray(got) || got.foot == null ? p.foot : got.foot);
  const wanted = p.want != null ? rows.findIndex((r) => r.key === p.want && pickable(r)) : -1;
  p.want = null;
  p.at = wanted >= 0 ? wanted : rows.findIndex(pickable);
  drawPalette();
}

// Text with the matched letters marked.
function marked(text, hits, from) {
  const span = el('span');
  let last = 0;
  for (const h of hits) {
    const at = h - from;
    if (at < 0 || at >= text.length) continue;
    if (at > last) span.append(text.slice(last, at));
    span.append(el('b', null, text[at]));
    last = at + 1;
  }
  span.append(text.slice(last));
  return span;
}

function drawPalette() {
  const list = $('palette-list');
  const { rows, at } = palette;
  if (!rows.length) {
    list.replaceChildren(el('div', 'palette-empty', palette.empty ?? 'Nothing here by that name.'));
    return;
  }
  list.replaceChildren(...rows.map((r, i) => {
    const row = el('div', 'palette-row' + (i === at ? ' on' : '') + (r.dim ? ' dim' : '') + (r.head ? ' palette-head' : '') + (r.lead != null ? ' palette-text' : ''));
    row.setAttribute('role', r.head ? 'presentation' : 'option');
    row.setAttribute('aria-selected', String(i === at));
    if (r.square) row.style.setProperty('--g', r.square);
    if (r.lead != null) row.append(el('span', 'palette-lead mono', r.lead));
    const label = el('span', 'palette-label' + (r.mono === false ? '' : ' mono'));
    label.append(r.hits ? marked(r.label, r.hits, r.labelFrom ?? 0) : r.label);
    row.append(label);
    if (r.detail) {
      const detail = el('span', 'palette-detail mono');
      detail.append(r.hits && r.detailFrom != null ? marked(r.detail, r.hits, r.detailFrom) : r.detail);
      row.append(detail);
    }
    if (r.note) row.append(el('span', 'palette-note', r.note));
    row.addEventListener('mousemove', () => {
      if (palette.at === i || !pickable(r)) return;
      palette.at = i;
      drawPalette();
    });
    row.addEventListener('mousedown', (e) => e.preventDefault());
    row.addEventListener('click', () => pick(i));
    return row;
  }));
  list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
}

function pick(i) {
  const r = palette?.rows[i];
  if (!pickable(r)) return;
  closePalette(false);
  r.run();
}

function movePalette(by) {
  const { rows } = palette;
  if (!rows.some(pickable)) return;
  let i = palette.at;
  do i = (i + by + rows.length) % rows.length; while (!pickable(rows[i]));
  palette.at = i;
  drawPalette();
}

$('palette-input').addEventListener('input', fillPalette);
$('palette-input').addEventListener('keydown', (e) => {
  const keys = {
    ArrowDown: () => movePalette(1),
    ArrowUp: () => movePalette(-1),
    Enter: () => pick(palette.at),
    Escape: () => closePalette(),
  };
  if (e.ctrlKey && (e.key === 'n' || e.key === 'p')) keys[e.key] = () => movePalette(e.key === 'n' ? 1 : -1);
  // The palette's own keys, like ⌥C to match case, by the key pressed, not
  // the character ⌥ makes of it.
  const own = palette && e.altKey && !e.metaKey && !e.ctrlKey && palette.keys['Alt+' + e.code.replace(/^Key/, '').toLowerCase()];
  if (own) keys[e.key] = own;
  if (!keys[e.key] || !palette) return;
  e.preventDefault();
  e.stopPropagation();
  keys[e.key]();
});
$('palette').addEventListener('mousedown', (e) => {
  if (e.target === $('palette')) closePalette();
});
$('palette-input').addEventListener('blur', () => setTimeout(() => {
  if (palette && !$('palette').contains(document.activeElement)) closePalette(false);
}, 0));

// Go to a file or folder here. The list of names is read when the palette
// opens, and again only after something changed in the folder.
let fileList = null;
let fileListStale = true;
const markFileListStale = () => { fileListStale = true; };

// The names in the open folder and the kit, read again only after something
// changed: { files, more }, more when the list stopped short.
async function namesHere() {
  if (fileListStale || fileList?.root !== state.root) {
    const res = await window.disk.listFiles();
    if (res.ok) {
      fileList = res.value;
      fileListStale = false;
    }
  }
  return fileList?.root === state.root ? fileList : { files: [], more: true };
}

async function goToFile() {
  const files = (await namesHere()).files;
  const openNow = new Set(state.tabs.filter((k) => k.startsWith('file:') || k.startsWith('folder:')).map((k) => k.slice(k.indexOf(':') + 1)));
  // line: from a name typed with :12 after it, to go to that line.
  const row = ({ path: p, dir }, hits, note, line = null) => {
    const shown = dir ? p + '/' : p;
    const cut = shown.lastIndexOf('/', shown.length - 2) + 1;
    const part = partOf(p);
    return {
      label: shown.slice(cut),
      labelFrom: cut,
      detail: cut ? shown.slice(0, cut - 1) : '',
      detailFrom: cut ? 0 : null,
      hits,
      note,
      square: part ? partColour(part.part) : null,
      run: () => (dir ? showFolder(p) : openLinked(p, null, null, line ? { line } : null)).then(focusMiddle),
    };
  };
  openPalette({
    placeholder: 'Go to a file or folder in ' + (state.info?.name ?? 'this folder'),
    foot: fileList?.more ? 'Only the first ' + num(fileList.files.length) + ' names here are searched.' : '↑↓ to choose · Return to open · name:12 to go to line 12 · Esc to go back',
    source: async (typed) => {
      const at = /^(.*[^\s:]):(\d+)(?::\d+)?\s*$/.exec(typed);
      const query = at ? at[1] : typed;
      const line = at ? Number(at[2]) : null;
      if (!query.trim()) {
        // What is open first, then what changed, then the top of the folder.
        const byPath = new Map(files.map((f) => [f.path, f]));
        const first = [...openNow].map((p) => byPath.get(p)).filter(Boolean);
        const changed = [...state.changes.keys()].filter((p) => byPath.has(p) && !openNow.has(p)).map((p) => byPath.get(p));
        const seen = new Set([...first, ...changed]);
        const rest = files.filter((f) => !seen.has(f)).slice(0, 40);
        return [
          ...first.map((f) => row(f, null, 'open')),
          ...changed.map((f) => row(f, null, state.changes.get(f.path))),
          ...rest.map((f) => row(f, null)),
        ];
      }
      return rank(query, files, (f) => (f.dir ? f.path + '/' : f.path)).map(({ item, hits }) =>
        row(item, hits, line && !item.dir ? 'line ' + line : openNow.has(item.path) ? 'open' : state.changes.get(item.path), item.dir ? null : line));
    },
  });
}

// Switch to a recent folder, or choose another. The terminal moves there,
// and the window follows, as Open folder… always did.
async function switchFolder() {
  const res = await window.disk.recentFolders();
  const recent = res.ok ? res.value : [];
  const choose = {
    label: 'Open another folder…',
    mono: false,
    note: '⇧⌘O',
    run: chooseFolder,
  };
  const rows = recent.map((f) => ({
    label: f.name,
    detail: f.shown,
    note: (f.open ? 'open now' : f.there ? '' : 'not found') + (f.edits && !f.open ? (f.there ? '' : ' · ') + count(f.edits, 'unsaved edit', 'unsaved edits') + ' kept' : ''),
    dim: f.open || !f.there,
    run: () => openRecentFolder(f.path),
  }));
  openPalette({
    placeholder: 'Switch to a recent folder',
    foot: 'The terminal moves to the folder you pick, and the window follows it. Unsaved edits here are kept and come back when you return.',
    source: async (query) => {
      if (!query.trim()) return [...rows, choose];
      return [...rank(query, recent, (f) => f.shown).map(({ item }) => rows[recent.indexOf(item)]), choose];
    },
  });
}

async function chooseFolder() {
  if (!(await leaveAllEdits('open another folder'))) return;
  sayOpened(await window.disk.chooseFolder());
}

async function openRecentFolder(folder) {
  if (!(await leaveAllEdits('switch folder'))) return;
  sayOpened(await window.disk.openRecent(folder));
}

// When no other folder opened, drafts I agreed to drop stay after all. When
// the terminal was sent there, the window follows once the shell has moved;
// if it never does, they stay too.
function sayOpened(res) {
  const from = state.root;
  if (!res.ok || res.value !== 'opened') keepEdits();
  else setTimeout(() => state.root === from && keepEdits(), 4000);
  const program = state.running?.agent || state.running?.program;
  say(!res.ok ? res.error
    : res.value === 'busy' ? (program || 'Something') + ' is running in this terminal, so it cannot move. Choose a terminal waiting at its prompt, or open a new one (⌘T), then switch again.'
      : '');
}
