// Changes. The main process watches the open folder and sends what changed:
// from Git, what is not committed yet; without Git, what changed since the
// folder was opened. They are listed on the changes page, so the tree and the
// map stay plain to work in. What changed in the last few seconds is marked
// in the tree, on the map and on the open file, and so is what the agent read
// or named in a command, from its record; those marks fade.

const WORD = { new: 'new', changed: 'changed', deleted: 'deleted' };

const under = (dir, p) => dir === '' || p === dir || p.startsWith(dir + '/');
const isRecent = (p) => Date.now() - (state.recent.get(p) ?? 0) < RECENT_MS;
const anyUnder = (paths, dir) => [...paths].some((p) => under(dir, p));

// What the tree, the map and the open file's name show: what changed in the
// last few seconds, and what the agent read or named in a command in those
// seconds. While a session is replayed: what it had changed by the step
// shown, and the files that step changed, or read or named in a command.
function shownMarks() {
  const r = state.replay;
  if (!r) {
    const now = new Set([...state.recent.keys()].filter(isRecent));
    return { changes: new Map(), now, looked: new Set([...state.looked.keys()].filter((p) => !now.has(p))) };
  }
  const step = r.steps[r.at];
  const paths = new Set(step.paths);
  const changed = step.kind === 'changed';
  return { changes: replayChanges(), now: changed ? paths : new Set(), looked: changed ? new Set() : paths };
}

// Motion. Marks fade in when they appear and out when they go; nothing else
// moves. The tree and the map are often built anew as files change, so the
// marks on the page after each pass are remembered: a mark that was already
// there is drawn still, and only a new one fades in. With reduce motion set
// in the system, marks change at once.

const still = matchMedia('(prefers-reduced-motion: reduce)');
const FADE_IN_MS = 400;
const FADE_OUT_MS = 1000; // as long as the pulse takes to fade out

function fade(node, keyframes, ms, options = {}) {
  // A replay moves on every fraction of a second, so its marks come and go faster.
  const duration = still.matches ? 0 : state.replay ? Math.min(ms, 150) : ms;
  return node.animate(keyframes, { duration, easing: 'ease', ...options });
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

// The left edge on a row that changed in the last few seconds, or with look
// set, that the agent read or named in a command. key is given for rows that
// are built anew, like the tree's.
function setEdge(node, on, key, look = false) {
  const cls = look ? 'looked' : 'recent';
  const was = node.classList.contains(cls);
  node.classList.toggle(cls, on);
  if (on && (key ? isNew((look ? 'look:' : 'edge:') + key) : !was)) {
    fade(node, [{ borderLeftColor: 'transparent', offset: 0 }], FADE_IN_MS);
  } else if (!on && was) {
    fade(node, [{ borderLeftColor: colour(look ? '--text' : '--changed'), offset: 0 }], FADE_OUT_MS);
  }
}

function markChanges() {
  marksNow = new Set();
  const m = shownMarks();
  for (const row of $('tree').querySelectorAll('.row[data-path]')) {
    const p = row.dataset.path;
    const dir = row.classList.contains('dir');
    const closed = dir && !row.classList.contains('open');
    const n = dir ? [...m.changes.keys()].filter((q) => under(p, q)).length : 0;
    setWord(row, dir ? (n ? n + ' changed' : null) : WORD[m.changes.get(p)], 'tree:' + p);
    const now = dir ? closed && anyUnder(m.now, p) : m.now.has(p);
    setEdge(row, now, 'tree:' + p);
    // The open file's row keeps its own edge.
    const looked = !now && !row.classList.contains('sel') && (dir ? closed && anyUnder(m.looked, p) : m.looked.has(p));
    setEdge(row, looked, 'tree:' + p, true);
  }

  let boxesChanged = false;
  for (const node of document.querySelectorAll('.map-box')) {
    if (markBox(node, m)) boxesChanged = true;
  }
  // A box that grew moves the arrows; otherwise only their marks change.
  if (boxesChanged) layoutMap();
  else markMap();

  const head = $('file-head');
  const kind = state.openFile && m.changes.get(state.openFile);
  // The line under the open file's name, while the agent is writing to it.
  head.classList.toggle('recent', !!state.openFile && m.now.has(state.openFile));
  if (head.firstChild) {
    setWord(head, WORD[kind], 'head:' + state.openFile, { place: (w) => head.firstChild.after(w) });
  }
  marksShown = marksNow;
}

// A map box: its border and count when its files changed, and its pulse
// while the agent works in it. While a session is replayed, the box the step
// shown works in gets a steady outline instead. Returns whether it grew,
// which moves arrows. When its count goes, the arrows are moved once it has
// faded.
function markBox(node, m) {
  const id = node.dataset.id;
  const rels = node.dataset.paths.split('\n');
  const n = [...m.changes.keys()].filter((p) => rels.some((r) => under(r, p))).length;
  const wasChanged = node.classList.contains('changed');
  node.classList.toggle('changed', n > 0);
  if (n && isNew('box:' + id)) fade(node, [{ borderColor: colour('--border'), offset: 0 }], FADE_IN_MS);
  else if (!n && wasChanged) fade(node, [{ borderColor: colour('--changed'), offset: 0 }], FADE_OUT_MS);
  const word = setWord(node, n ? n + ' changed' : null, 'box:' + id, { tag: 'div', gone: layoutMap });

  // The pulse runs only while it shows, and on while it fades out. It keeps
  // time with the clock, so a box drawn again keeps its beat.
  const working = rels.some((r) => anyUnder(m.now, r));
  node.classList.toggle('step', !!state.replay && working);
  const pulse = { pseudoElement: '::after' };
  // A box whose files the agent read or named in a command gets a steady
  // outline, fading in and out like the other marks.
  const looked = rels.some((r) => anyUnder(m.looked, r));
  const wasLooked = node.classList.contains('looked');
  node.classList.toggle('looked', looked);
  if (looked && isNew('look:' + id)) fade(node, [{ opacity: 0 }, { opacity: 1 }], FADE_IN_MS, pulse);
  else if (!looked && wasLooked && !working) {
    node.classList.add('unlooking');
    const done = () => node.classList.remove('unlooking');
    fade(node, [{ opacity: 1 }, { opacity: 0 }], FADE_OUT_MS, pulse).finished.then(done, done);
  }
  const was = node.classList.contains('recent');
  const now = !state.replay && working;
  node.classList.toggle('recent', now);
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

// The changed list, on the changes page. Rows stay put while they are listed; a new one fades
// in and one that goes fades out where it was. When one of the last sessions
// changed some of them, they are listed under it, and the rest last.
function drawChanges() {
  const box = $('changes');
  if (!box) return;
  const list = [...state.changes].sort((a, b) => a[0].localeCompare(b[0]));
  const since = state.git ? 'since the last commit' : 'since this folder was opened';
  const head = box.querySelector('.changes-head') || el('div', 'changes-head');
  head.textContent = list.length ? list.length + ' changed ' + since : 'Nothing changed ' + since + '.';
  const old = new Map([...box.querySelectorAll('.row[data-key]:not(.going)')].map((r) => [r.dataset.key, r]));
  const oldHeads = new Map([...box.querySelectorAll('.changes-group')].map((h) => [h.dataset.group, h]));
  const shown = list.slice(0, 500);
  // A row no longer listed fades out where it was, in its group.
  const listed = new Set(shown.map(([p]) => p));
  for (const [p, row] of old) {
    if (listed.has(p)) continue;
    vanish(row);
    old.delete(p);
  }
  const going = [...box.querySelectorAll('.row.going')];
  const groups = whoseChanges(shown, state.sessions, changesSince());
  const headed = groups.some((g) => g.session);
  const parts = [];
  for (const g of groups) {
    const key = g.session ? g.session.id : 'rest';
    if (headed) parts.push(groupHead(g.session, oldHeads.get(key)));
    const rows = [];
    for (const [p, kind] of g.list) {
      let row = old.get(p);
      if (!row) {
        row = el('div', 'row mono');
        row.dataset.key = p;
        row.title = p;
        row.append(el('span', 'chg'), document.createTextNode(p));
        row.addEventListener('click', () => row.dataset.path && openLinked(p));
        appear(row);
      }
      row.dataset.group = key;
      paintPart(row, p, false);
      row.firstChild.textContent = WORD[kind];
      row.classList.toggle('gone', kind === 'deleted');
      if (kind === 'deleted') delete row.dataset.path;
      else row.dataset.path = p;
      setEdge(row, isRecent(p));
      rows.push(row);
    }
    rows.push(...going.filter((r) => r.dataset.group === key));
    rows.sort((a, b) => a.dataset.key.localeCompare(b.dataset.key));
    parts.push(...rows);
  }
  // One going from a group that has gone fades out at the end.
  const keys = new Set(groups.map((g) => (g.session ? g.session.id : 'rest')));
  parts.push(...going.filter((r) => !keys.has(r.dataset.group)));
  const more = list.length - shown.length;
  box.replaceChildren(head, ...parts, ...(more > 0 ? [el('div', 'row dim', 'and ' + more + ' more')] : []));
}

// The changes page, a tab opened from the strip's count.
async function showChanges() {
  if (!leaveEdit()) return;
  noteLeaving();
  nextTurn();
  state.page = 'changes';
  state.home = false;
  state.openFile = null;
  state.file = null;
  markOpenFile();
  drawFile();
}

function drawChangesPage(head, body) {
  head.append(el('span', 'mono', 'changes'), el('span', 'dim', state.git ? 'what is not committed yet' : 'what changed since this folder was opened'));
  const list = el('div');
  list.id = 'changes';
  body.append(list);
  drawChanges();
}

// The time a change must come after to be a session's: the last commit, or
// without Git, when the folder was opened.
function changesSince() {
  if (!state.git) return state.openedAt;
  const last = state.status?.log?.[0];
  return last ? last.when * 1000 : 0;
}

// The line over the files one session changed: its agent, when it ended,
// its name or the first line I typed, and a link to replay it. Over the rest,
// a line saying they are not from those sessions. A line already there is
// kept, so it does not fade in again.
function groupHead(session, had) {
  const head = had || el('div', 'changes-group');
  if (!had) appear(head);
  head.dataset.group = session ? session.id : 'rest';
  if (!session) {
    head.replaceChildren(el('span', 'dim', 'other changes'));
    head.title = 'Changed by hand, by a command that did not name the file, or by a session not listed on the folder\'s page.';
    return head;
  }
  const said = el('span', 'changes-said', session.title || session.typed);
  const replay = el('span', 'link', 'replay');
  replay.title = 'Play back what this session read and changed here, step by step';
  replay.addEventListener('click', () => startReplay(session));
  head.replaceChildren(el('span', 'mono ' + who(session.agent), session.agent), el('span', null, ago(session.end / 1000)), said, replay);
  head.title = session.agent + ': ' + (session.title || session.typed) + '\nChanged these files, with its edit tools or a command, '
    + (state.git ? 'after the last commit.' : 'after this folder was opened.');
  return head;
}

// The status strip: what runs in the terminal, if anything, whether the
// folder is not watched, the branch, how many files changed and how much of
// the top map checked out. A cell whose words change is drawn anew; the others stay.
function drawStrip() {
  const cells = [];
  const run = state.running;
  // Said only while something runs in the terminal.
  // What runs in the chosen terminal, by name: claude or codex in their
  // colour, anything else, like a dev server, plainly. A shell waiting at its
  // prompt says nothing.
  if (run.agent) cells.push(['agent', [['value ' + who(run.agent), run.agent], ['label', 'running']], run.agent + ' is running in the chosen terminal.']);
  else if (run.program) cells.push(['agent', [['value', run.program], ['label', 'running']], run.program + ' is running in the chosen terminal.']);

  // What the agent's newest step here did, from its record: it may run in
  // this terminal or anywhere else.
  const live = state.live;
  if (live) {
    const [first, ...more] = live.paths;
    const name = first.split('/').pop() + (more.length ? ' +' + more.length : '');
    cells.push(['live', [['value ' + who(live.agent), live.agent], ['label', STEP_SAYS[live.kind]], ['value file', name]],
      live.agent + ' is working in this folder. Its newest step ' + STEP_SAYS[live.kind] + ' ' + live.paths.join(', ')
      + '.\nWhat it read or named in a command in the last few seconds is outlined in the tree and on the map.', true]);
  }

  const c = state.status;
  if (c) {
    // Watching is the normal case, so only not watching is said.
    if (c.watchError) cells.push(['watch', [['value error', 'not watching']], c.watchError]);
    else if (!c.watching) cells.push(['watch', [['value dim', 'not watching']], 'Changes in this folder are not being marked.']);

    if (c.git) cells.push(['branch', [['label', 'branch'], ['value', c.branch || 'none']], 'The Git branch this folder is on.']);
    else cells.push(['branch', [['value dim', 'no Git']], 'This folder is not in a Git repository.']);

    const n = c.list.length;
    if (c.gitError) cells.push(['changed', [['label', 'changed'], ['value error', 'cannot be read']], c.gitError]);
    else cells.push(['changed', [[n ? 'value' : 'value dim', String(n)], ['label', 'changed']],
      count(n, 'file', 'files') + ' changed ' + (c.git ? 'since the last commit.' : 'since this folder was opened.') + ' Click to list them.']);

    const m = c.map;
    if (m.state === 'none') cells.push(['map', [['value dim', 'no map']], m.detail]);
    else if (m.state === 'error') cells.push(['map', [['label', 'map'], ['value error', 'cannot be read']], m.detail]);
    else {
      cells.push(['map', [['label', 'map'], [m.state === 'ok' ? 'value' : 'value error', m.checked + '/' + m.total],
        ['label', 'kept']], m.detail]);
    }
  }

  const strip = $('strip');
  const old = new Map([...strip.children].map((node) => [node.dataset.key, node]));
  // A cell marked still, like the agent's newest step, changes its words
  // where it is, so it does not fade in again at every step.
  strip.replaceChildren(...cells.map(([key, parts, title, still]) => {
    const words = JSON.stringify(parts);
    let cell = old.get(key);
    if (!cell || cell.dataset.words !== words) {
      const fresh = !cell || !still;
      if (fresh) cell = el('span', 'cell ' + key);
      else cell.replaceChildren();
      cell.dataset.key = key;
      cell.dataset.words = words;
      for (const [cls, text] of parts) cell.append(el('span', cls, text), ' ');
      cell.lastChild.remove();
      if (fresh && key === 'map' && state.status.map.state !== 'none') {
        cell.classList.add('go');
        cell.addEventListener('click', showRoot);
      }
      if (fresh && key === 'changed') {
        cell.classList.add('go');
        cell.addEventListener('click', showChanges);
      }
      if (fresh) appear(cell);
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

// The agent's trail. Every two seconds while the window shows, main reads the
// newest lines of the records claude and codex keep for this folder, wherever
// they run. What a step read or named in a command is outlined for a few
// seconds, and the strip says what the newest step did.
const LIVE_POLL_MS = 2000;
let polling = false;
async function pollLive() {
  if (polling || document.hidden || !state.root) return;
  polling = true;
  try {
    const res = await window.disk.live();
    const before = liveWords();
    const now = Date.now();
    // A poll that failed brings nothing new, but what is shown still fades.
    const steps = res.ok && res.value.root === state.root ? res.value.steps : [];
    for (const step of steps) {
      if (step.kind !== 'changed') for (const p of step.paths) state.looked.set(p, now);
      state.live = { ...step, seen: now };
    }
    for (const [p, t] of state.looked) if (now - t >= RECENT_MS) state.looked.delete(p);
    if (state.live && now - state.live.seen >= RECENT_MS) state.live = null;
    if (liveWords() === before) return;
    drawStrip();
    markChanges();
  } finally {
    polling = false;
  }
}
const liveWords = () => JSON.stringify([[...state.looked.keys()], state.live]);
setInterval(pollLive, LIVE_POLL_MS);
