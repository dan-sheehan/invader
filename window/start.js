// Starting the window: what it does when main sends news, and the buttons.
// Loaded last.

window.disk.onChanges(async (c) => {
  if (c.root !== state.root) return;
  state.status = c;
  state.changes = new Map(c.list);
  state.git = c.git;
  const now = Date.now();
  for (const p of c.touched) state.recent.set(p, now);
  for (const [p, t] of state.recent) if (now - t > RECENT_MS) state.recent.delete(p);
  drawStrip();
  if (state.home) drawHomeSummary();
  drawChanges();
  markChanges();
  expireRecentSoon();
  // The map at the top came or went. When it just appeared, show it, unless
  // I am reading something else.
  if (c.touched.includes('map.json')) {
    const had = state.info?.map;
    const reading = state.openFile && (state.openFile !== state.info?.readme || isDraft(state.openFile));
    await loadFolder();
    if (!had && state.info?.map && !reading) await showRoot();
  }
  if (c.touched.some((p) => SETUP_PATH.test(p))) loadSetup();
  if (c.touched.length) {
    loadSessionsSoon();
    markFileListStale();
  }
  // A Markdown file, or what may be a folder holding some, came, went or
  // changed. Git's own files and node_modules are never looked in.
  const markdownMayChange = (p) => !/(^|\/)(\.git|node_modules)(\/|$)/.test(p) && (/\.(md|markdown)$/i.test(p) || !/\.[^/]*$/.test(p));
  if (c.touched.some(markdownMayChange)) loadBrokenSoon();
  if (c.touched.length) {
    refreshTreeSoon();
    const open = state.openFile;
    const onMap = currentMap() || state.file?.value?.map;
    if (open && (c.touched.includes(open) || onMap)) await rereadFile();
  }
});

$('root').addEventListener('click', switchFolder);
$('goto').addEventListener('click', goToFile);
$('term-open').addEventListener('click', () => showTerminal(true));
// What the agent is told may change outside the folder, which is not
// watched; it is looked at again whenever the window comes to the front.
window.addEventListener('focus', loadSetup);
// So is what the agent did, which it records outside the folder too.
window.addEventListener('focus', loadSessions);
// A path a Markdown file names may have come or gone anywhere on the computer.
// The folder's own Markdown files are the ones found last time.
window.addEventListener('focus', () => loadBroken(false));
// A kit made while invader runs shows once the window comes to the front, and
// so does whether it can be watched.
window.addEventListener('focus', async () => {
  const had = [state.info?.kit, state.info?.kitError];
  await loadFolder();
  if (state.info?.kit !== had[0] || state.info?.kitError !== had[1]) renderTree();
});
$('map-ask').addEventListener('click', askForMap);
window.disk.onFolderChanged(async () => {
  await openFolder();
  drawTermBar();
});
window.preview.onState(() => drawTabs());
// The terminal is in another folder while I have edits not saved here; null
// when it has come back.
let waitingSaid = null;
window.disk.onFolderWaiting((folder) => {
  if (!folder) {
    if (waitingSaid && $('note').textContent === waitingSaid) say('');
    waitingSaid = null;
    return;
  }
  waitingSaid = 'The terminal moved to ' + folder.split('/').pop() + '. Save or Discard your edits and the window follows.';
  say(waitingSaid);
});

// The menu's items, and their keys, which work wherever the focus is.
// Commands about what is shown act on the surface that has the keyboard: the
// terminal's own keys stay the terminal's, and a key pressed there never
// closes a tab or clears anything else by accident.
const MENU = {
  'quick-open': goToFile,
  'switch-folder': switchFolder,
  'choose-folder': chooseFolder,
  'open-recent': openRecentFolder,
  save: () => saveEdit(),
  'close-tab': () => (keyboardIn() === 'terminal'
    ? say('⌘W closes the tab in the middle, and the keyboard is in the terminal. Press ⌘J to go to the middle first, or close the terminal with the × on its tab.', { fade: true })
    : closeTab()),
  overview: showRoot,
  changes: showChanges,
  setup: showSetup,
  tab: (by) => goToTab({ by }),
  'tab-at': (at) => goToTab({ at }),
  terminal: () => (keyboardIn() === 'terminal' && !terminalHidden() ? focusMiddle() : focusTerminal()),
  'toggle-terminal': () => showTerminal(terminalHidden() || mapOnly()),
  'clear-terminal': () => (keyboardIn() === 'terminal' ? clearTerminal() : say('⌘K clears the terminal while it has the keyboard. Press ⌘J to go there.', { fade: true })),
  'new-terminal': () => newTerminal(),
  'close-terminal': () => closeTerminal(),
  'terminal-step': stepTerminal,
  preview: showPreview,
  'preview-go': (what) => currentTab() === 'preview' && (what === 'reload' ? reloadPreview() : window.preview.go(what)),
  back: goBack,
  forward: goForward,
  find: () => openFind(),
  'find-step': stepFind,
  'find-folder': findInFolder,
  'go-line': () => (currentTab() === 'preview' ? $('preview-address')?.select() : askForLine()),
  reveal: revealInTree,
  'show-on-map': () => showOnMap(),
  'copy-ref': copyReference,
  'map-only': () => {
    if (mapOnly()) return showMapOnly(false);
    if (currentMap()) showMapOnly(true);
    else say('Show only the map works while a map is shown.', { fade: true });
  },
};

// Where the keyboard is: 'page' (the preview's page, as main said when the
// last menu key came), 'terminal', 'palette', 'field' (a box to type in), 'middle' or
// 'other'.
let menuFromPage = false;
function keyboardIn() {
  if (menuFromPage) return 'page';
  const a = document.activeElement;
  if (!a || a === document.body) return 'other';
  if ($('palette').contains(a)) return 'palette';
  if ($('terminal').contains(a)) return a.closest('.xterm') ? 'terminal' : 'field';
  if (a.matches('input, textarea')) return 'field';
  if ($('file').contains(a)) return 'middle';
  return 'other';
}

// Select All selects in what has the keyboard only: the terminal's output,
// the box being typed in, or what the middle shows, never the whole window.
function selectAll() {
  const where = keyboardIn();
  const a = document.activeElement;
  if (where === 'terminal') return activeTerm()?.term.selectAll();
  if (a && a.matches('input, textarea')) return a.select();
  const range = new Range();
  range.selectNodeContents($('file-body'));
  getSelection().removeAllRanges();
  getSelection().addRange(range);
}

window.menu.on((cmd, arg, how) => {
  if (cmd === 'select-all') return selectAll();
  // The palette answers only to its own keys while it is open, except the
  // keys that open a palette, which swap it.
  if (palette && cmd !== 'quick-open' && cmd !== 'switch-folder' && cmd !== 'find-folder') return;
  // Kept until the next command or a click in the window, so a command that
  // waits for the disk before opening its palette still knows.
  menuFromPage = !!how.fromPage;
  activeAtMenu = document.activeElement;
  MENU[cmd]?.(arg);
});
// The keyboard came back to the window: a click, or focus moving to
// something other than what it held when the key came (main giving the
// window the keyboard back puts it on that same element).
let activeAtMenu = null;
document.addEventListener('pointerdown', () => (menuFromPage = false), true);
document.addEventListener('focusin', (e) => e.target !== activeAtMenu && (menuFromPage = false), true);

loadLayout().then(async () => {
  await openFolder();
  await startTerminals();
});
