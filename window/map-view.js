// Drawing a checked map, and the Build map request.

// Map. Groups are columns of boxes; arrows are drawn between the boxes from
// the checked map only. What did not check out is listed under it.

const SVG = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

const PULSE_MS = 2400; // one beat of the pulse, as in style.css

function drawMap(map) {
  const wrap = el('div', 'map');
  if (map.error) {
    wrap.append(el('div', 'map-error error mono', 'map.json cannot be drawn. ' + map.error));
    wrap.append(el('div', 'map-check map-fix', 'Nothing from it is drawn until it is fixed. With claude or codex running in the terminal, Update map asks it to fix the file; Plain text shows what is in it now.'));
    return wrap;
  }
  const boxCount = map.groups.reduce((n, g) => n + g.boxes.length, 0);
  const summary = count(boxCount, 'box', 'boxes') + ' · ' + count(map.arrows.length, 'arrow', 'arrows');
  const sum = el('div', 'map-sum');
  const meta = el('div', 'map-meta');
  meta.append(el('span', 'mono map-count', summary), el('span', 'map-wide'));
  const check = el('div', 'map-check');
  check.textContent = 'Shown: files and folders found, quotes found in their files. Labels not checked; important parts may be missing.';
  sum.append(meta, check);
  wrap.append(sum);

  const canvas = el('div', 'map-canvas');
  canvas.append(svg('svg', { class: 'map-lines' }));
  for (const g of map.groups) {
    const col = el('div', 'map-group');
    col.style.setProperty('--g', partColour(map.groups.indexOf(g)));
    col.append(el('div', 'map-group-label', g.label));
    if (g.boxes.length === 0) col.append(el('div', 'dim', 'no boxes'));
    for (const b of g.boxes) {
      const box = el('button', 'map-box');
      box.type = 'button';
      box.dataset.id = b.id;
      box.dataset.paths = b.paths.map((p) => p.rel).join('\n');
      box.append(el('span', 'map-box-label', b.label));
      const folders = b.paths.filter((p) => p.dir).length;
      const files = b.paths.length - folders;
      const names = [files && count(files, 'file', 'files'), folders && count(folders, 'folder', 'folders')].filter(Boolean);
      box.append(el('span', 'map-path mono', names.join(' · ')));
      box.title = b.paths.map((p) => p.path).join('\n');
      if (b.paths.length === 1 && b.paths[0].dir) {
        const go = el('span', 'map-open link', 'open ›');
        go.title = 'Go into ' + b.paths[0].rel + '/';
        go.addEventListener('click', (e) => {
          e.stopPropagation();
          showFolder(b.paths[0].rel);
        });
        box.append(go);
      }
      box.addEventListener('click', () => selectOnMap({ box: b.id }));
      col.append(box);
    }
    canvas.append(col);
  }
  const detail = el('div', 'map-detail');
  detail.setAttribute('aria-label', 'Map selection');
  wrap.append(canvas, detail);

  if (map.dropped.length) {
    const boxes = map.dropped.filter((d) => d.what === 'box').length;
    const arrows = map.dropped.length - boxes;
    const list = el('div', 'map-dropped');
    const parts = [];
    if (boxes) parts.push(count(boxes, 'box', 'boxes'));
    if (arrows) parts.push(count(arrows, 'arrow', 'arrows'));
    list.append(el('div', 'error', 'Dropped, not drawn: ' + parts.join(', ') + '.'));
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

// What the button asks for, 'build' or 'update', as it was last drawn.
let mapAction = 'build';

function drawMapButton() {
  const target = mapTarget();
  const exists = target === state.openFile ? state.file?.ok !== false : !!state.info?.map;
  mapAction = exists ? 'update' : 'build';
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
    + 'invader checks that the named files and folders exist in the open folder and each quote occurs in its file, not whether the labels are true or important parts are missing. '
    + 'Leave out anything you are not sure of. Write only ' + oneLine(target) + ' and change nothing else.';
  if (mapAction === 'build') {
    const where = target === 'map.json' ? 'at the top of this folder' : 'in ' + folder;
    return 'Write map.json ' + where + ' for invader, a viewer that draws it as a map of how the project fits together. ' + rules;
  }
  let found = 'Check it against the folder as it is now.';
  const map = target === state.openFile && state.file?.ok ? state.file.value.map : null;
  if (map?.error) found = 'invader cannot read it: ' + oneLine(map.error) + '.';
  else if (map?.dropped.length) {
    const items = map.dropped.slice(0, 20).map((d) => d.what + ' ' + oneLine(d.name, 60) + ': ' + oneLine(d.reason));
    found = 'invader dropped these: ' + items.join('; ') + '.';
  } else if (map) found = 'The named files and folders were found, and each quote was found in its file.';
  return 'Update ' + oneLine(target) + ' for invader so it matches the folder as it is now. ' + found + ' Fix or remove what is wrong and add important parts that are missing. ' + rules;
}

// The request goes to the terminal where claude or codex runs; when that is
// not certain, I choose the terminal (mapTargets). It is typed, never sent:
// I read it and press Return myself.
async function askForMap() {
  const label = $('map-ask').textContent;
  const found = mapTargets();
  if (found.none) {
    say('Start claude or codex in a terminal, then press ' + label + ' again.');
    return;
  }
  if (found.target) return typeMapRequest(found.target);
  const rows = found.choose.map((t) => ({
    label: termName(t),
    detail: homeWord(t.cwd),
    note: t.run.agent ? t.run.agent : t.run.program + ', not claude or codex',
    mono: true,
    run: () => typeMapRequest(t),
  }));
  openPalette({
    placeholder: found.agents ? 'Which terminal should get the ' + label + ' request?' : 'No claude or codex found. Type the request into one of these?',
    foot: found.agents ? 'claude or codex runs in more than one terminal. The request is typed, not sent: you press Return. Esc to cancel.'
      : 'invader did not see claude or codex running. Choose only a terminal where your agent runs; the request is typed, not sent. Esc to cancel.',
    source: async (typed) => rows.filter((r) => !typed.trim() || (r.label + ' ' + r.note).toLowerCase().includes(typed.trim().toLowerCase())),
  });
}

function typeMapRequest(t) {
  if (!terms.includes(t) || t.ended) return say('That terminal has closed.', { fade: true });
  typeIntoTerminal(mapRequest(), t);
  say('The request is typed into ' + termName(t) + '. Read it, then press Return.', { untilEnter: true });
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
  // The same room on both sides, so the boxes sit in the middle of the pane.
  const side = (n > 1 && loops(map.groups[0])) || loops(map.groups[n - 1]) ? 72 : 8;
  const left = side;
  const right = side;
  const colOf = new Map(map.groups.flatMap((g, c) => g.boxes.map((b) => [b.id, c])));
  const long = map.arrows.some((a) => Math.abs(colOf.get(a.from) - colOf.get(a.to)) > 1);
  const room = $('file-body').clientWidth - 40; // .map has 20px each side
  const s = Math.min(1, (room - left - right) / (n * 224 + (n - 1) * 128));
  const col = Math.max(160, Math.round(224 * s));
  const gap = Math.max(72, Math.round(128 * s));
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
  // An old SVG must not keep the canvas wide after the window narrows.
  lines.setAttribute('width', 0);
  lines.setAttribute('height', 0);
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
    // Under the group: its last box, since a group's boxes sit in the middle
    // of its column, with room under them when it is short.
    ys.push(mapY(rs.length ? rs.at(-1).bottom : col.getBoundingClientRect().bottom) + 12);
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

    // An arrow takes the colour of the part it starts from, faintly.
    const g = svg('g', { class: 'arrow' });
    g.style.setProperty('--g', partColour(p.f.col));
    const path = svg('path', { d, class: 'line' });
    g.append(svg('path', { d, class: 'hit' }), path, svg('path', { d: head, class: 'line' }));
    lines.append(g);
    const len = path.getTotalLength();
    const pts = [];
    for (let at = 0; at <= len; at += 3) pts.push(path.getPointAtLength(at));
    const xs = pts.map((q) => q.x);
    const ys = pts.map((q) => q.y);
    const outline = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
    return { p, g, pts, outline };
  });

  // Each label sits on its own arrow, at the clearest place it can find:
  // covering as few other labels as it can, then groups, then lines, and
  // nearest the middle among places as clear. On a crowded map it may still
  // cover something.
  const groups = cols.map((col) => {
    const r = col.getBoundingClientRect();
    return { left: mapX(r.left), right: mapX(r.right), top: mapY(r.top), bottom: mapY(r.bottom) };
  });
  const placed = [];
  for (const me of drawn) {
    const { p, pts } = me;
    const g = svg('g', { class: 'arrow arrow-label' });
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
      if (part === g) {
        part.setAttribute('role', 'button');
        part.setAttribute('tabindex', '0');
        const label = (id) => map.groups.flatMap((group) => group.boxes).find((box) => box.id === id).label;
        part.setAttribute('aria-label', label(p.a.from) + ': ' + p.a.label + ' → ' + label(p.a.to));
        part.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectOnMap({ arrow: p.i });
          }
        });
      }
      part.classList.toggle('live', live.has(p.a.from) || live.has(p.a.to));
      part.addEventListener('click', () => selectOnMap({ arrow: p.i }));
      part.addEventListener('mouseenter', () => both.forEach((n) => n.classList.add('hover')));
      part.addEventListener('mouseleave', () => both.forEach((n) => n.classList.remove('hover')));
    }
  }
  markWide();
  markMap();
}

// The line above the map offers to show only the map, with the tree, the
// terminal and the summary out of the way, and says so when the map is wider
// than the pane and scrolls sideways.
function markWide() {
  const wide = document.querySelector('.map-wide');
  if (!wide) return;
  const body = $('file-body');
  const only = mapOnly();
  const link = el('span', 'link', only ? 'show everything' : 'show only the map');
  link.title = only ? 'Or press Esc' : 'The tree, the terminal and the summary step aside until you come back';
  link.addEventListener('click', () => showMapOnly(!only));
  const scrolls = body.scrollWidth > body.clientWidth;
  wide.replaceChildren(link, !only && scrolls ? ' to see all of it' : '');
}

// Only the map, as big as the window allows. It ends with Esc, with the link,
// or when the middle shows something other than a map.
const mapOnly = () => document.querySelector('main').classList.contains('map-only');
function showMapOnly(on) {
  if (on === mapOnly()) return;
  document.querySelector('main').classList.toggle('map-only', on);
  applyLayout();
  markWide();
  if (!on && !terminalHidden()) activeTerm()?.term.focus();
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && mapOnly() && !e.defaultPrevented && !e.target.closest?.('textarea, input, #terminal, #palette')) {
    e.preventDefault();
    showMapOnly(false);
  }
});

// The boxes the agent is working in right now: files in them changed in the
// last few seconds, or, in a replay, the step shown works in. Their arrows
// are drawn brighter.
const liveBoxes = () => new Set([...document.querySelectorAll('.map-box.recent, .map-box.step, .map-box.looked')].map((n) => n.dataset.id));

function selectOnMap(sel) {
  const same = state.mapSel && sel.box === state.mapSel.box && sel.arrow === state.mapSel.arrow;
  state.mapSel = same ? null : sel;
  markMap();
}

// Keep the map in view while inspecting a part or the text behind an arrow.
function markMap() {
  const map = currentMap();
  const sel = state.mapSel;
  const detail = document.querySelector('.map-detail');
  if (!map || !detail) return;
  const boxes = map.groups.flatMap((g) => g.boxes);
  const box = boxes.find((b) => b.id === sel?.box);
  const arrow = sel?.arrow != null ? map.arrows[sel.arrow] : null;
  const related = new Set(box ? [box.id] : arrow ? [arrow.from, arrow.to] : []);
  if (box) for (const a of map.arrows) {
    if (a.from === box.id) related.add(a.to);
    if (a.to === box.id) related.add(a.from);
  }
  const live = liveBoxes();
  for (const g of document.querySelectorAll('.map-lines .arrow')) {
    const i = Number(g.dataset.i);
    const a = map.arrows[i];
    if (!a) continue;
    const on = arrow ? sel.arrow === i : box && (a.from === box.id || a.to === box.id);
    g.classList.toggle('on', !!on);
    if (g.getAttribute('role') === 'button') g.setAttribute('aria-pressed', String(arrow && sel.arrow === i || false));
    g.classList.toggle('quiet', !!(box || arrow) && !on);
    g.classList.toggle('live', live.has(a.from) || live.has(a.to));
  }
  for (const node of document.querySelectorAll('.map-box')) {
    const id = node.dataset.id;
    node.classList.toggle('on', related.has(id));
    node.setAttribute('aria-pressed', String(box?.id === id));
  }
  // Live marks update often. Leave the selection's links and keyboard focus alone.
  const key = JSON.stringify([box || null, arrow || null]);
  if (detail.dataset.selection === key) return;
  detail.dataset.selection = key;
  detail.replaceChildren();
  detail.classList.toggle('selected', !!(box || arrow));
  if (!box && !arrow) return;
  const heading = el('div', 'map-detail-head');
  const clear = el('button', null, 'Clear selection');
  clear.addEventListener('click', () => { state.mapSel = null; markMap(); });
  const label = (id) => boxes.find((b) => b.id === id).label;
  heading.append(el('strong', null, box ? box.label : label(arrow.from) + ' → ' + label(arrow.to)), clear);
  detail.append(heading);
  const fileLink = (text, rel, quote) => {
    const link = el('button', 'map-file mono link', text);
    link.title = rel || state.root;
    link.addEventListener('click', () => quote == null ? openOnMap(rel) : openLinked(rel, quote));
    return link;
  };
  if (box) {
    const content = el('div', 'map-detail-content');
    const files = el('div', 'map-files');
    for (const p of box.paths) files.append(fileLink(p.path, p.rel));
    const connections = el('div', 'map-connections');
    map.arrows.forEach((a, i) => {
      if (a.from !== box.id && a.to !== box.id) return;
      const link = el('button', 'map-connection', '');
      const outgoing = a.from === box.id;
      link.append(el('span', 'map-connection-end', (outgoing ? 'To ' : 'From ') + label(outgoing ? a.to : a.from)),
        el('span', 'muted', a.label));
      link.addEventListener('click', () => selectOnMap({ arrow: i }));
      connections.append(link);
    });
    if (!connections.childNodes.length) connections.append(el('span', 'muted', 'No arrows for this box in this map.'));
    content.append(files, connections);
    detail.append(content);
  } else {
    detail.append(el('div', 'map-relation', arrow.label));
    detail.append(fileLink(arrow.file, arrow.rel, arrow.text), el('span', 'muted', ' contains this quote:'));
    detail.append(el('pre', 'mono map-quote', arrow.text));
  }
}

new ResizeObserver(() => layoutMap()).observe($('file-body'));
