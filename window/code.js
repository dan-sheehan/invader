// Reading a file by its lines: every file that is not rendered is shown with
// its line numbers, so a line can be gone to, chosen and named. Clicking a
// line's number chooses it, shift-clicking chooses the lines between, and
// Copy Reference (⌥⌘C) puts its name, like src/app.js:12, on the clipboard
// for the terminal or a prompt. Nothing is typed into the terminal.

// Lines are drawn in blocks of this many, so a long file can be drawn and
// gone into without laying out all of it.
const CHUNK = 400;

// A file's lines, numbered. Long lines wrap. quote: text to mark, from a map
// arrow; the view scrolls to it.
function codeView(text, quote = null) {
  const lines = text.split('\n');
  if (lines.length > 1 && lines.at(-1) === '') lines.pop();
  const code = el('div', 'code mono');
  code.style.setProperty('--digits', String(String(lines.length).length));
  code.dataset.lines = lines.length;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const chunk = el('div', 'code-chunk');
    if (lines.length > CHUNK * 4) {
      chunk.classList.add('lazy');
      chunk.style.containIntrinsicSize = 'auto ' + Math.min(CHUNK, lines.length - i) * 1.6 + 'em';
    }
    const end = Math.min(lines.length, i + CHUNK);
    for (let n = i; n < end; n++) {
      const ln = document.createElement('div');
      ln.className = 'ln';
      ln.dataset.n = n + 1;
      const t = lines[n];
      ln.textContent = t.endsWith('\r') ? t.slice(0, -1) : t;
      chunk.append(ln);
    }
    code.append(chunk);
  }
  code.addEventListener('mousedown', (e) => {
    const ln = e.target.closest?.('.ln');
    if (!ln || e.offsetX > gutterWidth(ln)) return;
    e.preventDefault();
    const n = Number(ln.dataset.n);
    const had = state.lines?.rel === state.openFile ? state.lines : null;
    const from = e.shiftKey && had ? had.anchor : n;
    state.lines = { rel: state.openFile, anchor: from, from: Math.min(from, n), to: Math.max(from, n) };
    getSelection()?.removeAllRanges();
    markLines();
  });
  if (state.lines?.rel === state.openFile) queueMicrotask(markLines);
  if (quote) queueMicrotask(() => {
    const at = text.indexOf(quote);
    if (at < 0 || !code.isConnected) return;
    const line = text.slice(0, at).split('\n').length;
    const lineStart = text.lastIndexOf('\n', at - 1) + 1;
    goToLine({ line, col: at - lineStart + 1, len: quote.length }, { choose: false });
  });
  return code;
}

// How wide the numbers at the start of each line are, in pixels.
const gutterWidth = (ln) => parseFloat(getComputedStyle(ln).paddingLeft) - 6;

// The nth line of the code shown, or null.
function lineNode(code, n) {
  const chunk = code.children[Math.floor((n - 1) / CHUNK)];
  return chunk?.children[(n - 1) % CHUNK] || null;
}

// The text from line and col on, len characters long, which may go on over
// more lines, as a range in the code shown.
function codeRange(code, line, col, len) {
  const spot = (n, at) => {
    const ln = lineNode(code, n);
    if (!ln) return null;
    const t = ln.firstChild;
    return t ? [t, Math.min(at, t.length)] : [ln, 0];
  };
  const start = spot(line, col - 1);
  if (!start) return null;
  let n = line;
  let left = len + col - 1;
  for (let ln = lineNode(code, n); ln && left > ln.textContent.length; ln = lineNode(code, n)) {
    left -= ln.textContent.length + 1;
    n++;
  }
  const end = spot(n, Math.max(0, left)) || start;
  const range = new Range();
  range.setStart(...start);
  range.setEnd(...end);
  return range;
}

// The chosen lines, marked. Only the lines in them are touched.
function markLines() {
  const code = $('file-body').querySelector('.code');
  if (!code) return;
  for (const ln of code.querySelectorAll('.ln.chosen')) ln.classList.remove('chosen');
  const sel = state.lines?.rel === state.openFile ? state.lines : null;
  if (sel) for (let n = sel.from; n <= Math.min(sel.to, sel.from + 5000); n++) lineNode(code, n)?.classList.add('chosen');
  drawLineWords();
}

// Go to a line of the file shown: { line, col, len }. Code scrolls to it and
// chooses it, marking the text from col when len is given. Rendered Markdown
// goes to the paragraph the line is in; the editor puts the cursor on it.
function goToLine({ line, col = null, len = null }, { choose = true } = {}) {
  const body = $('file-body');
  const code = body.querySelector('.code');
  const editor = body.querySelector('textarea:not([readonly])');
  const article = body.querySelector('article.md[data-from]');
  const last = code ? Number(code.dataset.lines) : editor ? editor.value.split('\n').length : null;
  if (last != null && line > last) {
    say(state.file?.value?.partial ? 'Line ' + num(line) + ' is past the part shown, which ends at line ' + num(last) + '.'
      : 'Line ' + num(line) + ' is past the end: ' + (state.openFile || '').split('/').pop() + ' has ' + count(last, 'line', 'lines') + '.', { fade: true });
    line = last;
    col = len = null;
  }
  if (code) {
    const ln = lineNode(code, line);
    if (!ln) return;
    if (choose) state.lines = { rel: state.openFile, anchor: line, from: line, to: line };
    markLines();
    const range = col && len ? codeRange(code, line, col, len) : null;
    if (range) CSS.highlights.set('target', new Highlight(range));
    // A long line wraps over many rows: the place in it is what is shown.
    const rect = range?.getBoundingClientRect();
    const body_ = body.getBoundingClientRect();
    if (rect && ln.offsetHeight > body.clientHeight / 2) body.scrollTop += rect.top - body_.top - body.clientHeight / 3;
    else ln.scrollIntoView({ block: 'center' });
    flash(ln);
  } else if (editor) {
    const starts = [0];
    for (let i = editor.value.indexOf('\n'); i !== -1 && starts.length < line; i = editor.value.indexOf('\n', i + 1)) starts.push(i + 1);
    const start = starts[line - 1] + (col ? col - 1 : 0);
    const end = len ? start + len : (editor.value.indexOf('\n', start) + 1 || editor.value.length + 1) - 1;
    editor.setSelectionRange(start, end);
    scrollEditorTo(editor, start);
  } else if (article) {
    // The last paragraph, heading or other block starting at or before the line.
    const blocks = [...article.children].filter((b) => b.dataset.line);
    const block = blocks.filter((b) => Number(b.dataset.line) <= line).at(-1) || blocks[0];
    if (!block) return;
    block.scrollIntoView({ block: 'center' });
    flash(block);
  }
}

// Mark a line or paragraph for a moment, so the eye finds it.
function flash(node) {
  node.classList.remove('flash');
  void node.offsetWidth;
  node.classList.add('flash');
  setTimeout(() => node.classList.remove('flash'), 1400);
}

// Scroll the middle so the text area's character at offset shows, a third of
// the way down. The text area grows with its text, so where a character sits
// is measured on a copy of it laid out the same way.
function scrollEditorTo(editor, offset) {
  const copy = el('div');
  const style = getComputedStyle(editor);
  for (const k of ['font', 'lineHeight', 'padding', 'whiteSpace', 'tabSize', 'letterSpacing', 'overflowWrap', 'wordBreak', 'boxSizing']) copy.style[k] = style[k];
  Object.assign(copy.style, { position: 'absolute', visibility: 'hidden', width: editor.offsetWidth + 'px', top: '0', left: '0' });
  copy.textContent = editor.value.slice(0, offset);
  const mark = el('span', null, '​');
  copy.append(mark);
  editor.parentNode.append(copy);
  const y = mark.offsetTop;
  copy.remove();
  const body = $('file-body');
  const top = editor.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  body.scrollTop = Math.max(0, top + y - body.clientHeight / 3);
}

// The lines a reference names now: text selected in the file, else the
// lines chosen by number, else the editor's cursor. [from, to], or null.
function referencedLines() {
  const body = $('file-body');
  const sel = getSelection();
  if (sel && !sel.isCollapsed && body.contains(sel.anchorNode) && body.contains(sel.focusNode)) {
    const lineOf = (node) => {
      const e = node.nodeType === 1 ? node : node.parentElement;
      const ln = e?.closest('.ln');
      if (ln) return Number(ln.dataset.n);
      const block = e?.closest('article.md > [data-line]');
      return block ? Number(block.dataset.line) : null;
    };
    const a = lineOf(sel.anchorNode);
    const b = lineOf(sel.focusNode);
    if (a && b) return [Math.min(a, b), Math.max(a, b)];
  }
  const editor = body.querySelector('textarea:not([readonly])');
  if (editor && document.activeElement === editor) {
    const lineAt = (i) => editor.value.slice(0, i).split('\n').length;
    return [lineAt(editor.selectionStart), lineAt(Math.max(editor.selectionStart, editor.selectionEnd - 1))];
  }
  if (state.lines?.rel === state.openFile && body.querySelector('.code')) return [state.lines.from, state.lines.to];
  return null;
}

// What Copy Reference copies now: the file open, or the folder shown, with
// its lines. null on pages that are not a file or folder.
function currentReference() {
  if (state.page === 'folder') return state.folder.rel ? state.folder.rel + '/' : null;
  if (state.page || !state.openFile || !state.file?.ok) return null;
  if (state.file.value.folder) return state.openFile + '/';
  const lines = referencedLines();
  return reference(state.openFile, lines?.[0], lines?.[1]);
}

async function copyReference() {
  const ref = currentReference();
  if (!ref) return say('Open a file or folder to copy a reference to it.', { fade: true });
  const res = await window.disk.copy(ref);
  say(res.ok ? 'Copied ' + ref + '. Paste it into the terminal or a prompt.' : 'Not copied: ' + res.error, { fade: true });
}

// Beside a file's name: the lines chosen, where it is on the map, and ways
// to find it in the tree and name it.
function headTools(rel) {
  const tools = el('span', 'head-tools');
  tools.append(el('span', 'line-words mono dim'));
  const part = !rel.startsWith('~') && partOf(rel);
  if (part && !(state.home && rel === 'map.json')) {
    const chip = el('button', 'quiet on-map');
    chip.type = 'button';
    chip.style.setProperty('--g', partColour(part.part));
    chip.append(el('span', 'on-map-box', part.box));
    chip.title = 'On the map: ' + part.box + ', in ' + part.group + '. Show it on the map.';
    chip.addEventListener('click', () => showOnMap(rel));
    tools.append(chip);
  }
  const tree = el('button', 'quiet tool-tree', 'Show in tree');
  tree.type = 'button';
  tree.title = 'Unfold the tree to where this is';
  tree.addEventListener('click', () => revealInTree());
  const copy = el('button', 'quiet tool-copy', 'Copy reference');
  copy.type = 'button';
  copy.title = 'Copy its path, with the lines chosen, for the terminal or a prompt (⌥⌘C)';
  copy.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selected
  copy.addEventListener('click', copyReference);
  tools.append(tree, copy);
  queueMicrotask(drawLineWords);
  return tools;
}

// The lines chosen, beside the file's name.
function drawLineWords() {
  const words = $('file-head').querySelector('.line-words');
  if (!words) return;
  const sel = state.lines?.rel === state.openFile && $('file-body').querySelector('.code') ? state.lines : null;
  words.textContent = !sel ? '' : sel.from === sel.to ? 'line ' + num(sel.from) : 'lines ' + num(sel.from) + '–' + num(sel.to);
}

// Go to a line of the file open, by its number (⌘L).
function askForLine() {
  const code = $('file-body').querySelector('.code');
  const editor = $('file-body').querySelector('textarea:not([readonly])');
  const article = $('file-body').querySelector('article.md[data-from]');
  if (state.page || !state.openFile || (!code && !editor && !article)) return say('Go to Line works in a file.', { fade: true });
  const last = code ? Number(code.dataset.lines) : editor ? editor.value.split('\n').length : null;
  const name = state.openFile.split('/').pop();
  openPalette({
    placeholder: 'Go to line in ' + name + (last ? ' (1–' + num(last) + ')' : ''),
    foot: 'Type a line number, or line:column · Return to go · Esc to go back',
    source: async (query) => {
      const m = /^\s*(\d+)(?:\s*[:,]\s*(\d+))?\s*$/.exec(query);
      if (!m) return [{ label: query.trim() ? 'Type a line number' : 'Line number…', mono: false, dim: true }];
      const line = Math.max(1, Number(m[1]));
      const col = m[2] ? Number(m[2]) : null;
      return [{
        label: 'Go to line ' + num(line) + (col ? ', column ' + col : ''),
        mono: false,
        run: () => {
          noteLeaving();
          goToLine({ line, col, len: null });
          focusMiddle();
        },
      }];
    },
  });
}
