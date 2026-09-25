// The layout: how wide the folder and the terminal are, dragged by the lines
// between the panes, and whether the terminal is folded away. It is
// remembered in the app's own data folder, with the tabs each folder had.

const layout = { left: 260, right: 460, termHidden: false };
const DEFAULT = { left: 260, right: 460 };
const MIN = { left: 160, right: 240, middle: 360 };

// The widths drawn: what I chose, narrowed when the window is too small to
// give the middle its room, the terminal first, then the folder.
function applyLayout() {
  const main = document.querySelector('main');
  const room = main.clientWidth || window.innerWidth;
  const hidden = terminalHidden();
  let left = layout.left;
  let right = hidden ? 0 : layout.right;
  const over = left + right + MIN.middle - room;
  if (over > 0 && !hidden) right = Math.max(MIN.right, right - over);
  const still = left + right + MIN.middle - room;
  if (still > 0) left = Math.max(MIN.left, left - still);
  main.style.setProperty('--left', left + 'px');
  main.style.setProperty('--right', right + 'px');
}

let layoutTimer = null;
const sendLayout = () => {
  layoutTimer = null;
  window.memory.layout({ ...layout, termHidden: terminalHidden() });
};
function saveLayout() {
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(sendLayout, 300);
}

// Drag the line beside a pane to make it wider or narrower; double-click it
// to put it back.
function splitter(id, side) {
  const line = $(id);
  line.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    line.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing');
    line.classList.add('on');
    const main = document.querySelector('main');
    const startX = e.clientX;
    // From the width drawn, which may be narrower than the one chosen.
    const start = parseInt(main.style.getPropertyValue('--' + side), 10) || layout[side];
    const move = (ev) => {
      const d = ev.clientX - startX;
      const room = main.clientWidth;
      const other = side === 'left' ? (terminalHidden() ? 28 : layout.right) : layout.left;
      const max = room - other - MIN.middle;
      layout[side] = Math.round(Math.max(MIN[side], Math.min(max, side === 'left' ? start + d : start - d)));
      applyLayout();
    };
    const up = () => {
      line.removeEventListener('pointermove', move);
      line.removeEventListener('pointerup', up);
      line.removeEventListener('pointercancel', up);
      document.body.classList.remove('resizing');
      line.classList.remove('on');
      saveLayout();
    };
    line.addEventListener('pointermove', move);
    line.addEventListener('pointerup', up);
    line.addEventListener('pointercancel', up);
  });
  line.addEventListener('dblclick', () => {
    layout[side] = DEFAULT[side];
    applyLayout();
    saveLayout();
  });
}

splitter('split-left', 'left');
splitter('split-right', 'right');
window.addEventListener('resize', applyLayout);

// The layout I left, before anything is drawn.
async function loadLayout() {
  const res = await window.memory.load();
  if (!res.ok) return applyLayout();
  Object.assign(layout, { left: res.value.layout.left, right: res.value.layout.right });
  if (res.value.layout.termHidden) showTerminal(false, { quiet: true });
  applyLayout();
}

// The open folder's tabs and unfolded folders, sent a moment after they
// change. Not while a folder is being opened, when they are only half there.
let workspaceTimer = null;
function sendWorkspace() {
  workspaceTimer = null;
  if (state.restoring || !state.root) return saveWorkspaceSoon();
  const preview = state.preview.url ? { url: state.preview.url } : undefined;
  // Where I am in each open tab, the one shown as it is now. Only the place:
  // the scroll, the first line in view and the editor's cursor.
  if ($('file-body').childNodes.length && currentTab() !== 'preview') {
    const now = here();
    state.places.set(now.key, now);
  }
  const places = {};
  for (const key of state.tabs) {
    const p = state.places.get(key);
    if (p) places[key] = { top: p.top, ...(p.line ? { line: p.line } : {}), ...(p.caret ? { caret: p.caret } : {}) };
  }
  window.memory.workspace(state.root, { tabs: state.tabs, active: currentTab(), expanded: [...state.expanded], preview, places });
}
function saveWorkspaceSoon() {
  clearTimeout(workspaceTimer);
  workspaceTimer = setTimeout(sendWorkspace, 400);
}

// Scrolling or typing in the middle moves my place in it.
for (const e of ['scroll', 'keyup', 'pointerup']) $('file-body').addEventListener(e, () => !state.restoring && saveWorkspaceSoon(), { passive: true });

// Quitting sends what has not been sent yet.
window.addEventListener('beforeunload', () => {
  if (layoutTimer) {
    clearTimeout(layoutTimer);
    sendLayout();
  }
  if (workspaceTimer && !state.restoring) {
    clearTimeout(workspaceTimer);
    sendWorkspace();
  }
});
