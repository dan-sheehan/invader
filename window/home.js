// What happened here: the part of the open folder's own page under its map or
// README. The last few sessions of claude and codex here, the Markdown that
// points at nothing, and the last few commits. It is drawn again when any of
// that changes.

const HOME_COMMITS = 5;
const HOME_FILES = 4;

function homeSummary() {
  const box = el('div', 'home');
  const c = state.status;
  if (state.info?.rememberError) {
    box.append(el('p', 'error', 'invader could not note this as the last folder open, so next time it may open another: ' + state.info.rememberError));
  }

  if (state.sessions?.length || state.unreadRecords) box.append(homeSessions());

  if (state.broken?.length) box.append(homeBroken());

  if (c?.log?.length) {
    const commits = el('div', 'home-commits');
    commits.append(el('div', 'home-label', 'Last commits'));
    for (const commit of c.log.slice(0, HOME_COMMITS)) {
      const row = el('div', 'home-commit');
      row.title = commit.subject;
      row.append(el('span', 'home-when muted', ago(commit.when)), el('span', null, commit.subject));
      commits.append(row);
    }
    box.append(commits);
  }

  return box;
}

// The last few sessions: when each ran, which agent, its name or the first
// line I typed, then the files it changed, how many it changed outside this
// folder, how many commands it ran, the commits made while it ran, and a link
// to replay it.
function homeSessions() {
  const box = el('div', 'home-sessions');
  box.append(el('div', 'home-label', 'Last sessions'));
  for (const s of state.sessions) {
    const row = el('div', 'home-session');
    const said = el('div', 'home-said', s.title || s.typed);
    said.title = [s.title && s.typed, 'From ' + new Date(s.start).toLocaleString() + ' to ' + new Date(s.end).toLocaleString()]
      .filter(Boolean).join('\n');
    const text = el('div', 'home-text');
    text.append(said);
    row.append(el('span', 'home-when muted', ago(s.end / 1000)), el('span', 'home-who mono ' + who(s.agent), s.agent), text);
    box.append(row);

    const did = el('div', 'home-did dim');
    const parts = [];
    if (s.edited.length) {
      const files = el('span');
      files.append('changed ');
      s.edited.slice(0, HOME_FILES).forEach((rel, i) => {
        if (i) files.append(', ');
        const link = el('span', 'link mono', rel);
        link.addEventListener('click', () => openFile(rel));
        files.append(link);
      });
      if (s.edited.length > HOME_FILES) files.append(' and ' + (s.edited.length - HOME_FILES) + ' more');
      parts.push(files);
    }
    if (s.outside) parts.push(count(s.outside, 'file', 'files') + ' outside this folder');
    if (s.commands) {
      const ran = el('span', null, 'ran ' + count(s.commands, 'command', 'commands'));
      ran.title = 'Files a command changed are listed when the command names the file it writes. One that works out a name as it runs is not seen; if it committed those files, they are in the commits.';
      parts.push(ran);
    }
    const during = (state.status?.log || []).filter((c) => c.when * 1000 >= s.start && c.when * 1000 <= s.end + 60000);
    if (during.length) {
      const made = el('span', null, count(during.length, 'commit', 'commits'));
      made.title = during.map((c) => c.subject).join('\n');
      parts.push(made);
    }
    const replay = el('span', 'link', 'replay');
    replay.title = 'Play back what this session read and changed here, step by step';
    replay.addEventListener('click', () => startReplay(s));
    parts.push(replay);
    parts.forEach((part, i) => did.append(...(i ? [' · ', part] : [part])));
    text.append(did);
  }
  if (state.unreadRecords) {
    box.append(el('div', 'error', count(state.unreadRecords, 'record', 'records')
      + ' claude or codex kept of a session here could not be read, so a session may be missing.'));
  }
  return box;
}

// Read the last sessions again. The summary is drawn again only when what
// they say changed.
async function loadSessions() {
  const res = await window.disk.sessions();
  if (!res.ok || res.value.root !== state.root) return;
  if (JSON.stringify(res.value.sessions) === JSON.stringify(state.sessions) && res.value.unread === state.unreadRecords) return;
  state.sessions = res.value.sessions;
  state.unreadRecords = res.value.unread;
  drawChanges();
  if (state.home) drawHomeSummary();
}

// While the agent works its record grows, so it is read again a few seconds
// after files change, not on every change.
let sessionsTimer = null;
function loadSessionsSoon() {
  if (sessionsTimer) return;
  sessionsTimer = setTimeout(() => {
    sessionsTimer = null;
    loadSessions();
  }, 5000);
}

// Links and paths in the folder's Markdown that point at nothing. One line
// says how many files have some; clicking it lists them, one row per file.
// Clicking a file opens it with the first of them marked.
const BROKEN_SAYS = {
  link: (t) => 'links to ' + t + ', which is not there',
  path: (t) => 'names ' + t + ', which is not on this computer',
  import: (t) => 'brings in ' + t + ', which is not there',
};

function homeBroken() {
  const box = el('div', 'home-broken');
  const byFile = new Map();
  for (const b of state.broken) byFile.set(b.file, [...(byFile.get(b.file) || []), b]);
  const files = [...byFile];
  const toggle = (open) => {
    state.brokenOpen = open;
    drawHomeSummary();
  };
  if (!state.brokenOpen) {
    const line = el('div', 'home-label link', count(files.length, 'file points', 'files point') + ' at something that is not there');
    line.title = 'Links and paths in the Markdown here that lead nowhere. Click to list them.';
    line.addEventListener('click', () => toggle(true));
    box.append(line);
    return box;
  }
  const label = el('div', 'home-label link', 'Links and paths to nothing');
  label.title = 'Click to fold the list away';
  label.addEventListener('click', () => toggle(false));
  box.append(label);
  for (const [file, all] of files) {
    const row = el('div', 'home-commit');
    const name = el('span', 'home-file link mono', file);
    name.addEventListener('click', () => openLinked(file, all[0].target.replace(/^@/, '')));
    const targets = el('span', 'error mono', all.map((b) => b.target).join(', '));
    targets.title = all.map((b) => BROKEN_SAYS[b.kind](b.target)).join('\n');
    row.append(name, targets);
    box.append(row);
  }
  return box;
}

// Walking the folder for its Markdown files is the slow part, so it is done
// when the folder opens or its files come and go, not every time the window
// comes to the front.
async function loadBroken(walk = true) {
  const res = await window.disk.brokenLinks(walk);
  if (!res.ok || res.value.root !== state.root || JSON.stringify(res.value.broken) === JSON.stringify(state.broken)) return;
  state.broken = res.value.broken;
  if (state.home) drawHomeSummary();
}

let brokenTimer = null;
function loadBrokenSoon() {
  clearTimeout(brokenTimer);
  brokenTimer = setTimeout(() => loadBroken(true), 1500);
}

// Draw the summary again where it is, when what it says changed.
function drawHomeSummary() {
  const old = $('file-body').querySelector('.home');
  if (!old) return;
  const now = homeSummary();
  if (now.textContent !== old.textContent) old.replaceWith(now);
}
