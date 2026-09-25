// The terminals: each a shell of its own in the main process, drawn by
// xterm.js. What is typed into one goes to its shell only, and what a shell
// prints comes back to its own terminal. Each is named by its id in every
// call to main, so typing, resizing and closing never reach another.
//
// Only the terminal chosen, the one shown, has the keyboard and can move the
// window to another folder, when I cd in it. The others keep running and keep
// their own folder, which their tab names when it is not the folder shown.

// Colours tuned to the window: soft enough to read for hours, bright enough
// that claude's and codex's colours still tell things apart.
const TERM_OPTIONS = {
  fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
  fontSize: 13,
  lineHeight: 1.25,
  letterSpacing: 0,
  cursorBlink: true,
  cursorStyle: 'bar',
  cursorWidth: 2,
  macOptionIsMeta: true,
  macOptionClickForcesSelection: true,
  scrollback: 20000,
  smoothScrollDuration: 0,
  minimumContrastRatio: 3,
  theme: {
    background: '#141414',
    foreground: '#d8d8d8',
    cursor: '#e8e8e8',
    cursorAccent: '#141414',
    selectionBackground: '#3a4a60',
    selectionInactiveBackground: '#2c2c2c',
    black: '#1e1e1e', brightBlack: '#6a6a6a',
    red: '#ee6b6b', brightRed: '#ff8f8f',
    green: '#8fcf7a', brightGreen: '#aee39b',
    yellow: '#e2c08d', brightYellow: '#f0d6a8',
    blue: '#6aa8ff', brightBlue: '#94c0ff',
    magenta: '#c49af0', brightMagenta: '#d9b8ff',
    cyan: '#5cc4d4', brightCyan: '#86dbe6',
    white: '#cfcfcf', brightWhite: '#ffffff',
  },
};

// Every terminal, in the order of its tab. Each is
// { id, term, fit, box, ended, cwd, name, run, segs, quiet }.
const terms = [];
let active = null;
const early = new Map(); // id -> what its shell printed before its tab was ready

const byId = (id) => terms.find((t) => t.id === id) || null;
const activeTerm = () => active;

// A terminal's own xterm, in a box of its own inside #term. Only the chosen
// one's box is shown; the others keep what they printed while hidden.
function makeTerm() {
  const box = el('div', 'term-box');
  $('term').append(box);
  const term = new Terminal(TERM_OPTIONS);
  const fit = new FitAddon.FitAddon();
  term.loadAddon(fit);
  term.open(box);
  const t = { id: null, term, fit, box, ended: false, cwd: null, name: '', run: {}, segs: [], quiet: { timer: null, last: 0, since: 0 } };
  term.onData((data) => typed(t, data));
  term.onResize(({ cols, rows }) => t.id != null && !t.ended && window.terminal.resize(t.id, cols, rows));
  // The terminal has the keyboard: its bar says so, so I know where my typing goes.
  term.textarea?.addEventListener('focus', () => t === active && $('terminal').classList.add('focused'));
  term.textarea?.addEventListener('blur', () => $('terminal').classList.remove('focused'));
  links(t);
  return t;
}

// A new shell, started in the folder shown. Nothing is typed into it.
async function newTerminal({ focus = true } = {}) {
  if (terminalHidden() || mapOnly()) showTerminal(true, { quiet: !focus });
  const t = makeTerm();
  const was = active;
  terms.push(t);
  showTerm(t);
  const res = await window.terminal.start(t.term.cols, t.term.rows);
  if (!res.ok) {
    terms.splice(terms.indexOf(t), 1);
    t.term.dispose();
    t.box.remove();
    if (was) showTerm(was);
    drawTermBar();
    say('A new terminal could not start: ' + res.error);
    return null;
  }
  started(t, res.value);
  chooseTerm(t, { focus });
  return t;
}

// The shell main started for a terminal: its id, and the folder it began in.
function started(t, { id, cwd }) {
  t.id = id;
  t.ended = false;
  t.cwd = cwd;
  t.run = {};
  t.segs = [];
  mark(t, { cwd, checked: true, moved: false });
  for (const data of early.get(id) || []) t.term.write(data);
  early.delete(id);
}

function showTerm(t) {
  for (const other of terms) other.box.hidden = other !== t;
  if ($('term').clientWidth > 0) t.fit.fit();
}

// Choose a terminal: it is shown, and it is the one the keyboard, Build map
// and moving the window follow. Choosing never moves the window by itself.
function chooseTerm(t, { focus = true } = {}) {
  if (!t) return;
  active = t;
  showTerm(t);
  if (t.id != null) window.terminal.choose(t.id);
  state.running = t.ended ? {} : t.run;
  $('terminal').classList.remove('focused');
  drawStrip();
  drawTermBar();
  if (focus && !terminalHidden()) t.term.focus();
}

function stepTerminal(by) {
  if (terms.length < 2) return;
  const at = terms.indexOf(active);
  chooseTerm(terms[(at + by + terms.length) % terms.length]);
}

// What a terminal's tab says: the name I gave it, else what runs in it.
// Two saying the same are told apart by a number, like shell 2.
const plainName = (t) => t.name || (t.ended ? 'ended' : t.run.agent || t.run.program || 'shell');
function termName(t) {
  const name = plainName(t);
  const same = terms.filter((o) => plainName(o) === name);
  return same.length > 1 && same.indexOf(t) > 0 ? name + ' ' + (same.indexOf(t) + 1) : name;
}

// Close a terminal. When something runs in it, closing stops it, so it asks
// first; a shell waiting at its prompt just closes.
async function closeTerminal(t = active) {
  if (!t) return;
  const what = !t.ended && (t.run.agent || t.run.program);
  if (what && !confirm(what + ' is running in this terminal. Close the terminal and stop ' + what + '?')) return;
  if (t.id != null && !t.ended) await window.terminal.close(t.id);
  const at = terms.indexOf(t);
  terms.splice(at, 1);
  clearTimeout(t.quiet.timer);
  t.term.dispose();
  t.box.remove();
  if (t === active) {
    active = null;
    state.running = {};
    const next = terms[Math.max(0, at - 1)];
    if (next) chooseTerm(next);
    else {
      drawStrip();
      drawTermBar();
    }
  } else drawTermBar();
}

// What I type into a terminal goes to its own shell.
function typed(t, data) {
  if (t.ended === 'starting') return;
  if (t.ended) {
    restart(t);
    return;
  }
  if (t.id == null) return;
  if (data.includes('\r')) {
    // The Build map note goes once I press Return, unless another took its place.
    const note = $('note');
    if (note.dataset.untilEnter && note.textContent === note.dataset.untilEnter) say('');
    noteReturn(t);
  }
  window.terminal.input(t.id, data);
}

// A shell that ended starts again, as a new shell in the folder shown, when
// a key is pressed in its terminal. Nothing that ran in it runs again.
async function restart(t) {
  t.ended = 'starting';
  const res = await window.terminal.start(t.term.cols, t.term.rows);
  if (!res.ok) {
    t.ended = true;
    t.term.write('\r\n\x1b[2m[A new shell could not start: ' + res.error + ']\x1b[0m\r\n');
    return;
  }
  t.term.reset();
  started(t, res.value);
  if (t === active) chooseTerm(t);
  else drawTermBar();
}

window.terminal.onData((id, data) => {
  const t = byId(id);
  if (!t) {
    // Printed before the tab heard its id back.
    if (!early.has(id)) early.set(id, []);
    early.get(id).push(data);
    return;
  }
  t.term.write(data);
  watchQuiet(t);
});
window.terminal.onExit((id) => {
  const t = byId(id);
  if (!t) return;
  t.ended = true;
  t.run = {};
  if (t === active) {
    state.running = {};
    drawStrip();
  }
  drawTermBar();
  t.term.write('\r\n\x1b[2m[The shell ended. Press any key to start a new one here.]\x1b[0m\r\n');
});
window.terminal.onProgram((id, run) => {
  const t = byId(id);
  if (!t) return;
  t.run = run;
  if (t === active) {
    state.running = run;
    // The notes beside the buttons are all about what runs in the terminal,
    // so they go when that changes.
    if (!$('note').classList.contains('ok')) say('');
    drawStrip();
  }
  drawTermBar();
});
window.terminal.onFolder((id, cwd) => {
  const t = byId(id);
  if (!t) return;
  folderSeen(t, cwd);
  drawTermBar();
});

// While hidden the terminals keep their size, so what runs in them is not squeezed.
new ResizeObserver(() => {
  if ($('term').clientWidth > 0) active?.fit.fit();
}).observe($('term'));

// The terminals already running, when the window is drawn again while the
// app runs; otherwise one new shell.
async function startTerminals() {
  const res = await window.terminal.list();
  const running = res.ok ? res.value : [];
  for (const r of running) {
    const t = makeTerm();
    terms.push(t);
    started(t, r);
    t.run = { program: r.program, agent: r.agent };
    t.term.write('\x1b[2m[This terminal was already running. What it printed before is not shown here.]\x1b[0m\r\n');
  }
  if (terms.length) chooseTerm(terms[0]);
  else await newTerminal();
}

// Hide the terminal to give the file and map the room, or show it again.
// The shells and whatever runs in them keep running while it is hidden.
const terminalHidden = () => document.querySelector('main').classList.contains('term-hidden');
function showTerminal(show, { quiet = false } = {}) {
  if (show) showMapOnly(false);
  document.querySelector('main').classList.toggle('term-hidden', !show);
  applyLayout();
  if (show && active) active.fit.fit();
  terms.forEach(watchQuiet);
  if (!quiet) saveLayout();
  if (show && !quiet) active?.term.focus();
}

// The bar over the terminals: a tab for each, what runs in it or its name,
// and its own folder when that is not the folder shown; then + for a new one,
// the chosen terminal's folder, and Hide.
let renaming = false; // while a terminal's name is typed, the bar waits
function drawTermBar() {
  if (renaming) return;
  const tabs = $('term-tabs');
  const home = (p) => (p || '').replace(/^\/Users\/[^/]+/, '~');
  tabs.replaceChildren(...terms.map((t) => {
    const tab = el('span', 'term-tab' + (t === active ? ' on' : '') + (t.ended ? ' ended' : ''));
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(t === active));
    tab.tabIndex = -1;
    const name = termName(t);
    const label = el('span', 'term-name mono' + (t.run.agent && !t.name && !t.ended ? ' ' + who(t.run.agent) : ''), name);
    tab.append(label);
    const away = t.cwd && t.cwd !== state.root;
    if (away) tab.append(el('span', 'term-dir mono', t.cwd.split('/').pop() || '/'));
    tab.title = name + (t.ended ? '' : t.run.program ? ' running' : '') + ' in ' + home(t.cwd)
      + (away ? '\nNot the folder shown. Typing cd here moves the window only while this terminal is chosen.' : '')
      + '\nDouble-click to name it';
    const close = el('button', 'term-close quiet', '×');
    close.type = 'button';
    close.title = t.run.program && !t.ended ? 'Close, and stop ' + name : 'Close this terminal';
    close.setAttribute('aria-label', 'Close ' + name);
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeTerminal(t);
    });
    tab.append(close);
    tab.addEventListener('click', () => (t === active ? t.term.focus() : chooseTerm(t)));
    tab.addEventListener('dblclick', (e) => {
      if (e.target === close) return;
      renameTerminal(t, tab, label);
    });
    return tab;
  }));
  // In a narrow pane the tabs scroll; the chosen one is kept in view.
  tabs.querySelector('.term-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const where = $('term-where');
  const dir = active ? active.cwd : null;
  const parts = home(dir).split('/');
  where.textContent = !active ? '' : parts.length > 3 ? '…/' + parts.slice(-2).join('/') : parts.join('/');
  where.title = dir || '';
  $('term-empty').hidden = terms.length > 0;
}

// A name I give a terminal, like `server`, in place of what runs in it.
// It lives only while the window is open.
function renameTerminal(t, tab, label) {
  const input = el('input', 'term-rename mono');
  input.value = t.name || plainName(t);
  input.setAttribute('aria-label', 'Name this terminal');
  input.spellcheck = false;
  let done = false;
  const finish = (keep) => {
    if (done) return;
    done = true;
    renaming = false;
    if (keep) t.name = input.value.trim().slice(0, 40);
    drawTermBar();
    if (t === active) t.term.focus();
  };
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') finish(true);
    if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
  label.replaceWith(input);
  renaming = true;
  input.focus();
  input.select();
}

function focusTerminal() {
  if (terminalHidden() || mapOnly()) showTerminal(true);
  if (active) active.term.focus();
  else newTerminal();
}

// While it is hidden, the strip says when the agent in a terminal has gone
// quiet for a moment: it has finished, or it is asking something.
// A short burst of output, like a redraw, is not the agent working again:
// the mark clears once output has kept coming for a second.
const QUIET_MS = 2000;
let waitingFor = null;
function watchQuiet(t) {
  const q = t.quiet;
  const now = Date.now();
  if (now - q.last > 300) q.since = now;
  q.last = now;
  clearTimeout(q.timer);
  if (!terminalHidden()) return markWaiting(null);
  if (now - q.since >= 1000 && waitingFor === t) markWaiting(null);
  q.timer = setTimeout(() => {
    if (terminalHidden() && t.run.agent && !t.ended && terms.includes(t)) markWaiting(t);
  }, QUIET_MS);
}
function markWaiting(t) {
  waitingFor = t;
  const strip = $('term-open');
  strip.classList.toggle('waiting', !!t);
  strip.textContent = t ? 'Terminal · ' + t.run.agent + ' is waiting' : 'Terminal';
}
$('term-toggle').addEventListener('click', () => showTerminal(false));
$('term-open').addEventListener('click', () => showTerminal(true));
$('term-new').addEventListener('click', () => newTerminal());
$('term-empty').addEventListener('click', () => newTerminal());

// Pasting into the shell asks first when the paste is more than one line or
// carries a copied prompt (window/paste.js). Only while the chosen terminal's
// shell itself is in front: claude, codex and other programs take pastes as
// they come.
const PASTE_SHOWN = 12;
$('term').addEventListener('paste', (event) => {
  const t = active;
  if (!t || t.run.program || t.ended) return;
  const found = pasteCheck(event.clipboardData?.getData('text/plain') ?? '');
  if (!found) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  askBeforePaste(t, found);
}, true);

function askBeforePaste(t, { lines, commands, text }) {
  const ask = $('paste-ask');
  const done = (text) => {
    ask.hidden = true;
    ask.replaceChildren();
    document.removeEventListener('keydown', onKey, true);
    if (text != null && terms.includes(t) && !t.ended) t.term.paste(text);
    active?.term.focus();
  };
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    done(null);
  };
  const button = (label, text) => {
    const b = el('button', null, label);
    b.type = 'button';
    b.addEventListener('click', () => done(text));
    return b;
  };

  const one = lines.length === 1;
  const said = one ? 'Paste this into the shell?' : 'Paste ' + lines.length + ' lines into the shell?';
  let about = one ? '' : 'The shell runs each line as its own command. ';
  if (commands.length === lines.length) {
    about += (one ? 'It starts' : 'They start') + ' with a prompt, like $, copied along with the command. The shell does not understand the prompt.';
  } else if (commands.length) {
    about += count(commands.length, 'line starts', 'lines start') + ' with a prompt, like $, so ' + (commands.length === 1 ? 'it is a command' : 'they are commands')
      + '. The other ' + (lines.length - commands.length) + ' look like what the commands printed, which the shell would try to run too.';
  }
  const shown = lines.slice(0, PASTE_SHOWN).join('\n') + (lines.length > PASTE_SHOWN ? '\nand ' + (lines.length - PASTE_SHOWN) + ' more' : '');
  const buttons = el('div', 'paste-buttons');
  if (commands.length) {
    buttons.append(button(commands.length === lines.length ? (one ? 'Paste without the prompt' : 'Paste them without the prompt') : 'Paste only ' + (commands.length === 1 ? 'the command' : 'the ' + commands.length + ' commands'), commands.join('\n')));
  }
  buttons.append(button(one ? 'Paste as it is' : 'Paste all ' + lines.length + ' lines', text), button('Cancel', null));
  ask.replaceChildren(el('p', 'paste-said', said), ...(about ? [el('p', 'muted', about)] : []), el('pre', 'paste-lines mono', shown), buttons);
  ask.hidden = false;
  document.addEventListener('keydown', onKey, true);
  buttons.firstChild.focus();
}

// Put text on a terminal's line as if typed, without pressing Return. The
// terminal is shown and chosen, so the text can be read before Return is
// pressed. It goes a few characters at a time: claude folds a paste, or a
// long burst it takes for one, into [Pasted text #1], which cannot be read
// before Return.
const TYPED_AT_ONCE = 8;
const TYPING_MS = 4;
async function typeIntoTerminal(text, t = active) {
  if (!t || t.id == null) return;
  showTerminal(true);
  chooseTerm(t);
  const id = t.id;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i += TYPED_AT_ONCE) {
    if (t.id !== id || t.ended) return;
    window.terminal.input(id, chars.slice(i, i + TYPED_AT_ONCE).join(''));
    await new Promise((resolve) => setTimeout(resolve, TYPING_MS));
  }
}

// The terminals Build map could type into. The chosen one when claude or
// codex runs in it; else the one terminal where one of them runs. When two
// or more run one, or none does but some other program runs, it is not
// certain which is meant, and the list comes back for me to choose from:
// a dev server must never get the request by a guess. Empty when nothing
// runs anywhere.
function mapTargets() {
  const live = terms.filter((t) => !t.ended && t.id != null);
  if (active && live.includes(active) && active.run.agent) return { target: active };
  const agents = live.filter((t) => t.run.agent);
  if (agents.length === 1) return { target: agents[0] };
  if (agents.length > 1) return { choose: agents, agents: true };
  const running = live.filter((t) => t.run.program);
  return running.length ? { choose: running, agents: false } : { none: true };
}

// Which folder each line a terminal printed came from, so a relative path in
// it is read from there, and never from another terminal's folder or the
// folder shown. Each Return starts a stretch of output, marked where it
// starts, with the folder the shell was in. Main looks where the shell is
// after each Return and when a program ends; if the shell moved during the
// stretch, the folder its lines came from is not certain, and only full
// paths in them become links. A stretch not looked at yet counts as not
// certain too.
function mark(t, info) {
  const marker = t.term.registerMarker(0);
  if (!marker) return;
  t.segs.push({ marker, info });
  if (t.segs.length > 5000) t.segs.shift().marker.dispose();
}
function noteReturn(t) {
  mark(t, { cwd: t.cwd, checked: false, moved: false });
}
function folderSeen(t, cwd) {
  const last = t.segs.at(-1)?.info;
  if (last) {
    last.checked = true;
    if (cwd !== last.cwd) last.moved = true;
  }
  t.cwd = cwd;
}
// The folder the line at buffer row y came from, or null when not certain.
function folderAt(t, y) {
  for (let i = t.segs.length - 1; i >= 0; i--) {
    const { marker, info } = t.segs[i];
    if (marker.isDisposed || marker.line < 0 || marker.line > y) continue;
    return info.checked && !info.moved ? info.cwd : null;
  }
  return null;
}
// Clearing the terminal keeps the folder of the stretch it is in.
function clearTerminal() {
  const t = active;
  if (!t) return;
  const last = t.segs.at(-1)?.info;
  t.term.clear();
  if (last) mark(t, last);
}

// File references in what a terminal printed, like src/app.js:12:5. A path
// is a link only when main says it leads to something in the open folder or
// the kit; a relative path is read from the folder that terminal was in when
// it was printed, and not at all when that is not certain. ⌘-click opens it
// in the middle at its line; a plain click is left to the terminal, for
// selecting. An address on this computer, like http://localhost:5173/,
// opens in the preview on ⌘-click. Nothing is typed into the terminal, and
// the keyboard stays where it was.
const whereCache = new Map(); // root, folder and path -> { at, res }
function whereIs(t, p, cwd) {
  const key = state.root + '\n' + t.id + '\n' + cwd + '\n' + p;
  const had = whereCache.get(key);
  if (had && Date.now() - had.at < 5000) return had.res;
  const res = window.disk.where(p, { term: t.id, cwd });
  whereCache.set(key, { at: Date.now(), res });
  if (whereCache.size > 500) whereCache.delete(whereCache.keys().next().value);
  return res;
}

// The line of output holding row y, which may wrap over several rows: its
// text, the row it starts on, and for each character in it the cell it is
// drawn in, 1-based, since a wide character takes two cells.
function wrappedLine(term, y) {
  const buffer = term.buffer.active;
  let start = y;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
  let end = y;
  while (buffer.getLine(end + 1)?.isWrapped) end++;
  let text = '';
  const cells = [];
  const cell = buffer.getNullCell();
  for (let i = start; i <= end; i++) {
    const line = buffer.getLine(i);
    for (let x = 0; x < line.length; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue;
      const chars = cell.getChars() || ' ';
      for (let k = 0; k < chars.length; k++) cells.push({ x: x + 1, y: i + 1 });
      text += chars;
    }
  }
  return { text, start, cells };
}

function links(t) {
  t.term.registerLinkProvider({
    async provideLinks(row, done) {
      const out = await termLinks(t, row);
      done(out.length ? out : undefined);
    },
  });
}

// The links on row y (1-based) of a terminal: addresses for the preview, and
// file references. A full path opens what main finds there. A relative path
// opens directly only when the folder the shell was in when it printed it is
// known, main finds it there, and no other file here has that name; a
// command may have run somewhere else, as in a subshell, so where two or
// more could be meant, or the folder is not known, ⌘-click asks which one.
async function termLinks(t, row) {
  const { text, start, cells } = wrappedLine(t.term, row - 1);
  const inRow = (r) => {
    const range = { start: cells[r.index], end: cells[r.index + r.length - 1] };
    return range.end.y < row || range.start.y > row ? null : range;
  };
  const out = [];
  const link = (r, range, tip, activate) => ({
    range,
    text: text.slice(r.index, r.index + r.length),
    decorations: { underline: true, pointerCursor: false },
    activate: (e) => {
      if (!e.metaKey) return;
      hideTermTip();
      activate();
    },
    hover: (e) => showTermTip(e, tip),
    leave: hideTermTip,
    tip,
  });
  for (const u of findLocalUrls(text).slice(0, 5)) {
    const range = inRow(u);
    if (range) out.push(link(u, range, '⌘-click to open in the preview: ' + u.url, () => openPreview(u.url)));
  }
  const refs = findRefs(text).slice(0, 20);
  const cwd = folderAt(t, start);
  const root = state.root;
  await Promise.all(refs.map(async (r) => {
    const range = inRow(r);
    if (!range) return;
    const go = r.line ? { line: r.line, col: r.col, len: null } : null;
    const at = r.line ? ', line ' + r.line : '';
    const open = ({ rel, dir }) => (dir ? showFolder(rel) : openLinked(rel, null, null, go, { ifThere: true }));
    if (r.path.startsWith('/') || r.path.startsWith('~/')) {
      const res = await whereIs(t, r.path, cwd);
      if (!res.ok || state.root !== root) return;
      out.push(link(r, range, '⌘-click to open ' + res.value.rel + at, () => open(res.value)));
      return;
    }
    const [res, names] = await Promise.all([cwd ? whereIs(t, r.path, cwd) : null, namesHere()]);
    if (state.root !== root) return;
    const here = res?.ok ? res.value : null;
    const dirOf = new Map(names.files.map((f) => [f.path, f.dir]));
    const others = (refCandidates(r.path, names.files) || []).filter((c) => c !== here?.rel).map((rel) => ({ rel, dir: !!dirOf.get(rel) }));
    if (here && !others.length && !names.more) {
      out.push(link(r, range, '⌘-click to open ' + here.rel + at + '\nRead from ' + homeWord(cwd) + ', where the shell was; it is the only one here by that name', () => open(here)));
    } else if (here || others.length) {
      const n = others.length + (here ? 1 : 0);
      const tip = n > 1 ? '⌘-click to choose: ' + count(n, 'file here is', 'files here are') + ' named ' + r.path + ', and the command may have printed it from any folder'
        : '⌘-click to open ' + (here || others[0]).rel + at + ' after checking: where this was printed from is not known';
      out.push(link(r, range, tip, () => chooseRef(r.path, here, others, cwd, open)));
    }
  }));
  return out;
}

const homeWord = (p) => (p || '').replace(/^\/Users\/[^/]+/, '~');

// Which file a relative path printed in a terminal means, when that is not
// certain: the one read from where the shell was first, if main found one,
// then every other file here with that name. Nothing opens until I pick one,
// and Esc goes back to the terminal.
function chooseRef(p, here, others, cwd, open) {
  const back = document.activeElement;
  const rows = [...(here ? [{ ...here, note: 'where the shell was' }] : []), ...others].map((c) => ({
    label: c.dir ? c.rel + '/' : c.rel,
    note: c.note || '',
    run: async () => {
      await open(c);
      if (back?.isConnected && back.closest('#terminal')) back.focus();
    },
  }));
  openPalette({
    placeholder: 'Which ' + p + ' did the terminal mean?',
    foot: (here ? 'The shell was in ' + homeWord(cwd) + ', but a command can print a path from another folder, so invader does not know. '
      : 'Where the terminal printed this from is not known. ') + '↑↓ to choose · Return to open · Esc to go back',
    source: async (typed) => rows.filter((row) => !typed.trim() || row.label.toLowerCase().includes(typed.trim().toLowerCase())),
  });
}

function showTermTip(e, text) {
  const tip = $('term-tip');
  tip.textContent = text;
  tip.hidden = false;
  const box = $('terminal').getBoundingClientRect();
  tip.style.left = Math.max(4, Math.min(e.clientX - box.left, box.width - tip.offsetWidth - 4)) + 'px';
  tip.style.top = e.clientY - box.top + 16 + 'px';
}
function hideTermTip() {
  $('term-tip').hidden = true;
}
