// Finding text. Find in File (⌘F) marks every place the text is in what the
// middle shows, and steps through them with Return, ⌘G and ⇧⌘G. Find in
// Folder (⇧⌘F) finds it in the open folder's files, through main
// (main/search.js), and opens the file picked at its line. Both find the
// text as written, ignoring case unless Match case is on.

// Find in File. In the preview it finds in the page instead, with the page's
// own find, as a browser does (main/preview.js): the same bar, keys and
// count, and never a file hidden behind the page.

const finder = { hits: [], at: -1, matchCase: false, timer: null, page: null };
const findsInPage = () => currentTab() === 'preview';

// The text in view, in order, with where each piece of it is on the page.
// Pieces in different lines or paragraphs are kept apart, so a find never
// runs from one into the next.
function textIndex(scope) {
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('textarea, svg, .find-skip') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  const nodes = [];
  let text = '';
  let last = null;
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const block = n.parentElement.closest('.ln, p, li, h1, h2, h3, h4, h5, h6, pre, td, th, div, button, blockquote');
    if (last && block !== last) text += '\n';
    last = block;
    nodes.push({ node: n, start: text.length });
    text += n.data;
  }
  return { text, nodes };
}

// A place in the text of textIndex as a node and an offset in it.
function spotAt({ nodes }, at, end) {
  let lo = 0;
  let hi = nodes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (nodes[mid].start < at || (!end && nodes[mid].start === at)) lo = mid;
    else hi = mid - 1;
  }
  return [nodes[lo].node, at - nodes[lo].start];
}

const MAX_MARKED = 5000;

function allAt(hay, needle, max = MAX_MARKED) {
  const out = [];
  for (let i = hay.indexOf(needle); i !== -1 && out.length < max; i = hay.indexOf(needle, i + needle.length)) out.push(i);
  return out;
}

// Open the find bar, with text in it when given. near: a line to start from.
function openFind(text = null, { near = null, focus = true } = {}) {
  const bar = $('find');
  const input = $('find-input');
  if (findsInPage() && (!state.preview.live || state.preview.error || state.preview.crashed)) {
    return say('Find looks in the page once it is loaded.', { fade: true });
  }
  input.placeholder = findsInPage() ? 'Find in the page' : 'Find in what is shown';
  input.setAttribute('aria-label', input.placeholder);
  bar.hidden = false;
  if (text == null) {
    // What is selected in the middle, when it is a few words, is what I want.
    const sel = String(getSelection() || '').trim();
    if (sel && !sel.includes('\n') && sel.length < 200 && $('file-body').contains(getSelection().anchorNode)) text = sel;
  }
  if (text != null) input.value = text;
  runFind({ near });
  if (focus) {
    input.focus();
    input.select();
  }
}

function closeFind() {
  $('find').hidden = true;
  finder.hits = [];
  stopPageFind();
  CSS.highlights.delete('find');
  CSS.highlights.delete('find-now');
  $('find-spot')?.remove();
  focusMiddle();
}

function stopPageFind() {
  if (finder.page) window.preview.stopFind();
  finder.page = null;
}

// What the page's find said: how many places, and which one is shown.
function pageFound({ matches, at }) {
  if (!finder.page) return;
  finder.page = { matches, at };
  $('find').classList.toggle('none', !matches && !!$('find-input').value);
  drawFindCount();
}

// The page was drawn again: mark what the find bar holds on it, from where I am.
function refreshFind() {
  if (!$('find').hidden) runFind({ scroll: false });
}

// Find the text in what is shown and mark it. The one gone to is the first
// at or after near, a line, else at or below the top of what is in view.
function runFind({ near = null, scroll = true } = {}) {
  CSS.highlights.delete('find');
  CSS.highlights.delete('find-now');
  $('find-spot')?.remove();
  const query = $('find-input').value;
  const body = $('file-body');
  finder.hits = [];
  finder.at = -1;
  $('find').classList.remove('none');
  if (findsInPage()) {
    if (!query || !state.preview.live) {
      stopPageFind();
      return drawFindCount();
    }
    finder.page = { matches: null, at: 0 };
    window.preview.find(query, 0, finder.matchCase);
    return drawFindCount();
  }
  stopPageFind();
  if (!query) return drawFindCount();
  const fold = (t) => (finder.matchCase ? t : t.toLowerCase());
  const editor = body.querySelector('textarea:not([readonly])');
  if (editor) {
    // In the editor the text is the text area's; it cannot be marked in
    // place, so the one gone to is outlined over it.
    finder.hits = allAt(fold(editor.value), fold(query)).map((i) => ({ editor, start: i, end: i + query.length }));
  } else {
    const index = textIndex(body);
    finder.hits = allAt(fold(index.text), fold(query)).map((i) => {
      const range = new Range();
      range.setStart(...spotAt(index, i, false));
      range.setEnd(...spotAt(index, i + query.length, true));
      return { range };
    });
    if (finder.hits.length) CSS.highlights.set('find', new Highlight(...finder.hits.map((h) => h.range)));
  }
  if (!finder.hits.length) {
    $('find').classList.add('none');
    return drawFindCount();
  }
  finder.at = startHit(near, body, editor);
  showHit(scroll);
}

// The hit to start on.
function startHit(near, body, editor) {
  if (editor) {
    const lines = editor.value.split('\n');
    if (near) {
      const from = lines.slice(0, near - 1).join('\n').length + (near > 1 ? 1 : 0);
      const i = finder.hits.findIndex((h) => h.start >= from);
      return i >= 0 ? i : 0;
    }
    const i = finder.hits.findIndex((h) => h.start >= editor.selectionStart);
    return i >= 0 ? i : 0;
  }
  if (near) {
    const i = finder.hits.findIndex((h) => {
      const ln = h.range.startContainer.parentElement.closest('.ln, article.md > [data-line]');
      return ln && Number(ln.dataset.n || ln.dataset.line) >= near;
    });
    if (i >= 0) {
      // In rendered Markdown the line starts a paragraph; the hit may be in the one before.
      const block = finder.hits[i].range.startContainer.parentElement.closest('article.md > [data-line]');
      const prev = block?.previousElementSibling;
      if (prev && Number(block.dataset.line) > near && i > 0 && prev.contains(finder.hits[i - 1].range.startContainer)) return i - 1;
      return i;
    }
  }
  const top = body.getBoundingClientRect().top;
  const i = finder.hits.findIndex((h) => h.range.getBoundingClientRect().bottom > top);
  return i >= 0 ? i : 0;
}

function showHit(scroll = true) {
  const hit = finder.hits[finder.at];
  drawFindCount();
  $('find-spot')?.remove();
  if (!hit) return;
  const body = $('file-body');
  if (hit.editor) {
    if (scroll) scrollEditorTo(hit.editor, hit.start);
    outlineInEditor(hit);
    return;
  }
  CSS.highlights.set('find-now', new Highlight(hit.range));
  if (!scroll) return;
  const view = body.getBoundingClientRect();
  let r = hit.range.getBoundingClientRect();
  if (r.top < view.top + 20 || r.bottom > view.bottom - 20) {
    body.scrollTop += r.top - view.top - body.clientHeight / 3;
    r = hit.range.getBoundingClientRect();
  }
  if (r.left < view.left || r.right > view.right) body.scrollLeft += r.left - view.left - 40;
}

// Outline the hit gone to over the editor, measured on a copy of it.
function outlineInEditor({ editor, start, end }) {
  const style = getComputedStyle(editor);
  const copy = el('div');
  for (const k of ['font', 'lineHeight', 'padding', 'whiteSpace', 'tabSize', 'letterSpacing', 'overflowWrap', 'wordBreak', 'boxSizing']) copy.style[k] = style[k];
  Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', width: editor.offsetWidth + 'px', top: '0', left: '0' });
  const mark = el('span', null, editor.value.slice(start, end));
  copy.append(editor.value.slice(0, start), mark);
  editor.parentNode.append(copy);
  const box = copy.getBoundingClientRect();
  const rects = [...mark.getClientRects()];
  copy.remove();
  const at = editor.getBoundingClientRect();
  const body = $('file-body').getBoundingClientRect();
  const spot = el('div', 'find-spot');
  spot.id = 'find-spot';
  const r = rects[0];
  if (!r) return;
  Object.assign(spot.style, {
    top: at.top - body.top + $('file-body').scrollTop + (r.top - box.top) + 'px',
    left: at.left - body.left + (r.left - box.left) + 'px',
    width: r.width + 'px',
    height: r.height + 'px',
  });
  $('file-body').append(spot);
}

function drawFindCount() {
  const n = finder.hits.length;
  const words = $('find-count');
  if (finder.page && $('find-input').value) {
    const { matches, at } = finder.page;
    words.textContent = matches == null ? '' : !matches ? 'not found' : num(at) + ' of ' + num(matches);
    return;
  }
  if (!$('find-input').value) words.textContent = '';
  else if (!n) words.textContent = 'not found';
  else words.textContent = num(finder.at + 1) + ' of ' + num(n) + (n >= MAX_MARKED ? '+' : '');
}

function stepFind(by) {
  if ($('find').hidden) return openFind();
  if (findsInPage()) {
    const query = $('find-input').value;
    if (!query || !state.preview.live) return;
    if (!finder.page) return runFind();
    return window.preview.find(query, by, finder.matchCase);
  }
  if (!finder.hits.length) return runFind();
  finder.at = (finder.at + by + finder.hits.length) % finder.hits.length;
  showHit();
}

$('find-input').addEventListener('input', () => {
  clearTimeout(finder.timer);
  finder.timer = setTimeout(() => {
    finder.timer = null;
    runFind();
  }, 120);
});
$('find-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(finder.timer);
    if (finder.timer && !finder.hits.length && !findsInPage()) runFind();
    if (finder.timer && findsInPage()) runFind();
    else stepFind(e.shiftKey ? -1 : 1);
    finder.timer = null;
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeFind();
  }
});
$('find-next').addEventListener('click', () => stepFind(1));
$('find-prev').addEventListener('click', () => stepFind(-1));
$('find-close').addEventListener('click', closeFind);
$('find-case').addEventListener('click', () => {
  finder.matchCase = !finder.matchCase;
  $('find-case').setAttribute('aria-pressed', String(finder.matchCase));
  runFind();
});

// Find in Folder. The last search in this folder, and the row I picked, come
// back when it opens again, searched afresh.

const folderSearch = { root: null, query: '', matchCase: false, picked: null };
const MIN_QUERY = 2;

function findInFolder() {
  const name = state.info?.name ?? 'this folder';
  const sel = String(getSelection() || '').trim();
  const fromSel = sel && !sel.includes('\n') && sel.length < 200 && $('file-body').contains(getSelection().anchorNode) ? sel : null;
  if (folderSearch.root !== state.root) Object.assign(folderSearch, { root: state.root, query: '', picked: null });
  const caseButton = () => {
    const b = el('button', 'quiet palette-case' + (folderSearch.matchCase ? ' on' : ''), 'Match case' + (folderSearch.matchCase ? ': on' : ': off'));
    b.type = 'button';
    b.title = 'Match upper and lower case as typed (⌥C)';
    b.setAttribute('aria-pressed', String(folderSearch.matchCase));
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', toggleCase);
    return b;
  };
  const toggleCase = () => {
    folderSearch.matchCase = !folderSearch.matchCase;
    fillPalette();
  };
  const foot = (said) => {
    const line = el('span', 'palette-foot-line');
    line.append(caseButton(), ...(said ? [el('span', null, said)] : []));
    return line;
  };
  openPalette({
    placeholder: 'Find text in the files of ' + name,
    value: fromSel ?? folderSearch.query,
    want: fromSel ? null : folderSearch.picked,
    wide: true,
    keys: { 'Alt+c': toggleCase },
    busy: 'Searching ' + name + '…',
    foot: foot('Plain text, found as written, in ' + name + ' only. ↑↓ to choose · Return to open'),
    source: async (query) => {
      if (query.trim().length < MIN_QUERY) {
        return { rows: [], empty: query.trim() ? 'Type at least ' + MIN_QUERY + ' characters.' : 'Type text to find in the files of ' + name + '.', foot: foot('Plain text, found as written, in ' + name + ' only, not ~/kit.') };
      }
      // Wait for a pause in typing before searching.
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (!palette || $('palette-input').value !== query) return null;
      const root = state.root;
      const matchCase = folderSearch.matchCase;
      const res = await window.disk.search(query, { matchCase });
      // A folder opened since, or a search since, makes this one old.
      if (root !== state.root || !palette || $('palette-input').value !== query) return null;
      if (!res.ok) return { rows: [], empty: 'Could not search: ' + res.error, foot: foot('') };
      const r = res.value;
      if (r.cancelled || r.root !== state.root || r.matchCase !== folderSearch.matchCase) return null;
      folderSearch.query = query;
      return { rows: searchRows(r), empty: 'Not found in the ' + count(r.searched, 'file', 'files') + ' searched.', foot: foot(searchSaid(r)) };
    },
  });
}

function searchRows(r) {
  const rows = [];
  for (const f of r.files) {
    const part = partOf(f.path);
    const n = f.matches.length + f.more;
    rows.push({ head: true, label: f.path, note: count(n, 'line', 'lines'), square: part ? partColour(part.part) : null });
    for (const m of f.matches) {
      const hits = [];
      for (const [a, b] of m.hits) for (let i = a; i < b; i++) hits.push(i);
      rows.push({
        lead: String(m.line),
        label: m.text,
        hits,
        key: f.path + ':' + m.line,
        run: () => openFound(f.path, m, r.query),
      });
    }
    if (f.more) rows.push({ dim: true, mono: false, label: 'and ' + count(f.more, 'more line', 'more lines') + ' in this file' });
  }
  return rows;
}

// What was searched and, as plainly, what was not.
function searchSaid(r) {
  const parts = [count(r.total, 'line', 'lines') + ' in ' + count(r.files.length, 'file', 'files') + ', of ' + count(r.searched, 'file', 'files') + ' searched'];
  if (r.stopped) parts.push('stopped at ' + num(r.total) + ': type more to narrow it');
  const not = [];
  const dirs = [...new Set(r.skipped.dirs)];
  if (dirs.length) not.push(dirs.slice(0, 3).join(' ') + (dirs.length > 3 ? ' and ' + (dirs.length - 3) + ' more folders' : '') + ' (tools make them)');
  if (r.skipped.large.length) not.push(r.skipped.large.length === 1 ? r.skipped.large[0] + ' (over 2 MB)' : count(r.skipped.large.length, 'file', 'files') + ' over 2 MB');
  if (r.skipped.binary) not.push(count(r.skipped.binary, 'binary file', 'binary files'));
  if (r.skipped.outside) not.push(count(r.skipped.outside, 'link', 'links') + ' leading outside');
  if (r.skipped.unreadable) not.push(count(r.skipped.unreadable, 'file', 'files') + ' that could not be read');
  if (not.length) parts.push('not searched: ' + not.join(', '));
  return parts.join(' · ');
}

// Open a line found, with the find bar holding the text, so ⌘G goes on to
// the next place in the file.
async function openFound(rel, m, query) {
  folderSearch.picked = rel + ':' + m.line;
  finder.matchCase = folderSearch.matchCase;
  $('find-case').setAttribute('aria-pressed', String(finder.matchCase));
  $('find-input').value = query;
  $('find').hidden = false;
  await openLinked(rel, null, null, { line: m.line, col: m.col, len: query.length });
  if (state.openFile !== rel) return;
  runFind({ near: m.line, scroll: false });
  focusMiddle();
}
