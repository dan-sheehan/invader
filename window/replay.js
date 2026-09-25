// Replay: one of the last sessions of claude or codex played back step by
// step, on the map, or on the tree when there is no map. The steps come from
// the records the agents keep: each lights the files it read, changed or
// named in a shell command, and what the session changed so far stays
// marked. The bar above the file says when and what, and steps, pauses and
// stops it; its timeline goes to any step. The marks of what changes now come back when it stops.

const REPLAY_MS = 20000; // shared out between the steps, each shown 0.15 to 0.8 s
const stepMs = () => Math.max(150, Math.min(800, REPLAY_MS / state.replay.steps.length));

const STEP_SAYS = { changed: 'changed', read: 'read', command: 'ran a command naming' };

// What the session had changed by the step shown.
function replayChanges() {
  const changes = new Map();
  for (const step of state.replay.steps.slice(0, state.replay.at + 1)) {
    if (step.kind === 'changed') for (const p of step.paths) changes.set(p, 'changed');
  }
  return changes;
}

async function startReplay(session) {
  const res = await window.disk.steps(session.id);
  if (!res.ok) {
    say(res.error);
    return;
  }
  if (res.value.root !== state.root) return;
  if (!res.value.steps.length) {
    say('That session read or changed nothing here that invader can see.');
    return;
  }
  stopReplay();
  say('');
  // On the folder's own page, the map gets the whole window while it plays.
  const madeOnly = !!currentMap() && state.home && !mapOnly();
  state.replay = { session, steps: res.value.steps, at: 0, playing: true, timer: null, madeOnly };
  state.replay.timeline = timeline(state.replay);
  if (madeOnly) showMapOnly(true);
  showStep();
}

function stopReplay() {
  const r = state.replay;
  if (!r) return;
  clearTimeout(r.timer);
  r.timeline.stop();
  state.replay = null;
  drawReplayBar();
  if (r.madeOnly) showMapOnly(false);
  markChanges();
}

function showStep() {
  const r = state.replay;
  clearTimeout(r.timer);
  if (r.playing && r.at >= r.steps.length - 1) r.playing = false;
  drawReplayBar();
  markChanges();
  if (!r.playing) return;
  r.timer = setTimeout(() => {
    if (state.replay !== r) return;
    r.at++;
    showStep();
  }, stepMs());
}

// Go to step i, or as near as there is one, and pause there.
function goToStep(i) {
  const r = state.replay;
  r.playing = false;
  r.at = Math.max(0, Math.min(r.steps.length - 1, i));
  showStep();
}

const stepBy = (n) => goToStep(state.replay.at + n);

function playOrPause() {
  const r = state.replay;
  if (!r.playing && r.at === r.steps.length - 1) r.at = 0;
  r.playing = !r.playing;
  showStep();
}

// When a step happened: the time, and the day when it was not today.
function stepWhen(t) {
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return time;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' }) + ' ' + time;
}

function drawReplayBar() {
  const bar = $('replay');
  const r = state.replay;
  bar.hidden = !r;
  if (!r) {
    bar.replaceChildren();
    return;
  }
  const top = el('div', 'replay-top');
  const said = el('span', 'replay-said', r.session.title || r.session.typed);
  said.title = r.session.title || r.session.typed;
  const controls = el('span', 'replay-controls');
  const control = (text, title, fn) => {
    const link = el('span', 'link', text);
    link.title = title;
    link.addEventListener('click', fn);
    return link;
  };
  const end = r.at === r.steps.length - 1;
  controls.append(
    control('back', 'Or press ←', () => stepBy(-1)), ' · ',
    control(r.playing ? 'pause' : end ? 'again' : 'play', 'Or press the space bar', playOrPause), ' · ',
    control('next', 'Or press →', () => stepBy(1)), ' · ',
    control('stop', 'Or press Esc', stopReplay),
  );
  top.append(el('span', 'muted', 'Replaying'), el('span', 'mono ' + who(r.session.agent), r.session.agent), said, controls);

  const step = r.steps[r.at];
  const line = el('div', 'replay-step');
  const files = step.paths.slice(0, 3).join(', ') + (step.paths.length > 3 ? ' and ' + (step.paths.length - 3) + ' more' : '');
  line.append(
    el('span', 'muted', stepWhen(step.t)),
    el('span', step.kind === 'changed' ? 'chg-word' : null, STEP_SAYS[step.kind]),
    el('span', 'mono', files),
    el('span', 'dim', 'step ' + (r.at + 1) + ' of ' + r.steps.length),
  );
  line.title = step.paths.join('\n');
  r.timeline.show(r.at);
  // The timeline stays where it is, so a drag along it is not cut short.
  if (r.timeline.node.parentNode !== bar) bar.replaceChildren(top, line, r.timeline.node);
  else {
    bar.children[0].replaceWith(top);
    bar.children[1].replaceWith(line);
  }
}

// The timeline under the bar: one tick per step, evenly apart, tall and in
// the changed colour where the step changed files, short and dim where it
// read them or named them in a command. The step shown is marked in the
// colour for where you are. Clicking or dragging along it goes to the step
// there and pauses. Resting the pointer on it says which step is there.
function timeline(r) {
  const n = r.steps.length;
  const node = el('div', 'replay-line');
  const canvas = el('canvas');
  const at = el('div', 'replay-at');
  node.append(canvas, at);
  const place = (i) => (n === 1 ? 0.5 : i / (n - 1));

  const draw = () => {
    const w = node.clientWidth;
    const h = node.clientHeight;
    if (!w || !h) return;
    const scale = devicePixelRatio;
    canvas.width = w * scale;
    canvas.height = h * scale;
    const g = canvas.getContext('2d');
    g.scale(scale, scale);
    const tint = { changed: colour('--changed'), other: colour('--dim') };
    // A hairline along the bottom; a tick as wide as the room between steps
    // allows, from 1 to 3 pixels.
    g.fillStyle = colour('--line');
    g.fillRect(0, h - 1, w, 1);
    const wide = Math.max(1, Math.min(3, Math.floor(w / n) - 2));
    r.steps.forEach((step, i) => {
      const changed = step.kind === 'changed';
      const tall = changed ? h : Math.round(h / 2);
      g.fillStyle = changed ? tint.changed : tint.other;
      g.fillRect(Math.max(0, Math.min(w - wide, Math.round(place(i) * w - wide / 2))), h - tall, wide, tall);
    });
  };
  const sizes = new ResizeObserver(draw);
  sizes.observe(node);

  const stepAt = (e) => {
    const box = node.getBoundingClientRect();
    return Math.round(Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)) * (n - 1));
  };
  node.addEventListener('pointerdown', (e) => {
    node.setPointerCapture(e.pointerId);
    goToStep(stepAt(e));
  });
  node.addEventListener('pointermove', (e) => {
    const i = stepAt(e);
    if (node.hasPointerCapture(e.pointerId)) {
      if (i !== state.replay?.at) goToStep(i);
      return;
    }
    const step = r.steps[i];
    node.title = 'Step ' + (i + 1) + ', ' + stepWhen(step.t) + ': ' + STEP_SAYS[step.kind] + ' ' + step.paths.join(', ');
  });

  return {
    node,
    show: (i) => at.style.setProperty('left', 'calc(' + place(i) * 100 + '% - 1px)'),
    stop: () => sizes.disconnect(),
  };
}

document.addEventListener('keydown', (e) => {
  if (!state.replay || e.defaultPrevented) return;
  // Keys typed into the terminal, a box or the palette are theirs, Escape
  // too: it is how claude is interrupted.
  if (e.target.closest?.('textarea, input, #terminal, #palette')) return;
  if (e.key === 'Escape') return stopReplay();
  const keys = { ArrowLeft: () => stepBy(-1), ArrowRight: () => stepBy(1), ' ': playOrPause };
  if (!keys[e.key]) return;
  e.preventDefault();
  keys[e.key]();
});
