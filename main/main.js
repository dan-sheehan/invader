// invader main process: starts the app and its window, and passes the
// window's requests to the files that do the work:
//   disk.js     reads the open folder and ~/kit, and saves hand-edited Markdown
//   changes.js  watches the folder and asks Git what changed
//   shell.js    runs the shell in each terminal
//   preview.js  shows a page served on this computer, apart from the window
//   map.js      checks a map.json against the disk
//   setup.js    finds what claude and codex are told in the open folder
//   sessions.js reads what claude and codex did in the open folder, step by
//               step, and what they are doing there now
//   links.js    finds links and paths in the folder's Markdown that point at nothing
//   memory.js   remembers the recent folders, the layout and each folder's tabs
//   search.js   finds text in the open folder's files, when asked
//   drafts.js   keeps unsaved Markdown edits in the app's data folder, for recovery

const { app, BrowserWindow, Menu, clipboard, dialog, ipcMain, nativeTheme, screen } = require('electron');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const disk = require('./disk');
const changes = require('./changes');
const shell = require('./shell');
const setup = require('./setup');
const sessions = require('./sessions');
const links = require('./links');
const memory = require('./memory');
const search = require('./search');
const preview = require('./preview');
const drafts = require('./drafts');

const APP = path.join(__dirname, '..');

let root = null; // absolute path of the open folder
let win = null;
// The files with an edit not saved yet, as the window tells it: [{ rel, kept,
// error }], kept when the edit as it is now is in the recovery store.
let unsavedEdits = [];
// Where the chosen terminal went while an edit was not saved, for the window
// to follow once it is; null when it has not gone anywhere.
let waitingFor = null;

function toWindow(channel, ...args) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
}

// What the app remembers between runs lives in its own data folder, never
// in the folder shown: see memory.js.
const stateFile = () => path.join(app.getPath('userData'), 'state.json');
let mem = memory.clean(null);
// Unsaved edits kept for recovery, in the same data folder: see drafts.js.
let keptStore = null;
const kept = () => (keptStore ||= drafts.store(path.join(app.getPath('userData'), 'drafts')));

async function startFolder() {
  // `npm start -- <folder>` opens that folder.
  const args = process.argv.slice(1).filter((a) => !a.startsWith('-'));
  if (!app.isPackaged) args.shift(); // the app's own folder, as in `electron .`
  const fromArgs = args.pop();
  const candidates = [fromArgs && path.resolve(fromArgs), mem.folder, os.homedir()];
  for (const c of candidates) {
    try {
      if (c && (await fs.stat(c)).isDirectory()) return await fs.realpath(c);
    } catch {}
  }
  return os.homedir();
}

// Written a moment after the last change, so dragging a pane or the window
// writes once. Why it could not be written, if it could not, goes to the
// window with the folder.
let rememberError = null;
let saveTimer = null;
async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try {
    await memory.save(stateFile(), mem);
    rememberError = null;
  } catch (err) {
    rememberError = err.message;
  }
}
function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

async function rememberFolder() {
  const before = mem.recent.join('\n');
  mem = memory.opened(mem, root);
  await saveNow();
  if (mem.recent.join('\n') !== before) buildMenu();
}

// The recent folders, the open one first, each with whether it is still
// there and its path as I would write it, starting ~ in my home folder.
async function recentFolders() {
  const home = os.homedir();
  const counts = await kept().counts().catch(() => ({}));
  return Promise.all(mem.recent.map(async (p) => {
    let there = false;
    try {
      there = (await fs.stat(p)).isDirectory();
    } catch {}
    const shown = p === home || p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
    return { path: p, name: path.basename(p) || p, there, shown, open: p === root, edits: counts[p] || 0 };
  }));
}

const watch = () => changes.watch(root, (c) => toWindow('changes', c));


async function setRoot(folder) {
  // A search still running was for the folder before; it stops, and says so.
  search.stop();
  const real = await fs.realpath(folder);
  // The preview belongs to the folder it was opened in: its page closes, and
  // its address is remembered with that folder's tabs.
  if (real !== root) preview.close();
  root = real;
  waitingFor = null;
  await rememberFolder();
  toWindow('folder:changed', root);
  await watch();
}

// The chosen terminal moved to another folder. While an edit is not saved,
// the window stays where it is and says where the terminal went; it follows
// once the edit is saved or discarded.
async function followShell(folder) {
  // Back in the open folder: nothing to wait for any more.
  if (folder === root) {
    waitingFor = null;
    return toWindow('folder:waiting', null);
  }
  if (unsavedEdits.length) {
    waitingFor = folder;
    return toWindow('folder:waiting', folder);
  }
  await setRoot(folder);
}

shell.connect(toWindow, followShell);

// Opening a folder moves the chosen terminal there, and the window follows.
// While something runs in that terminal it cannot move, so nothing is opened.
// With no terminal running, the folder just opens.
async function openFolderAt(folder) {
  const id = shell.chosen();
  if (id == null) {
    await setRoot(folder);
    return 'opened';
  }
  // Its real path, as the shell will report it once there.
  return shell.moveTo(id, await fs.realpath(folder)) ? 'opened' : 'busy';
}

async function chooseFolder() {
  const res = await dialog.showOpenDialog(win, { defaultPath: root, properties: ['openDirectory'] });
  if (res.canceled || !res.filePaths[0]) return null;
  return openFolderAt(res.filePaths[0]);
}

// Only a folder already in the recent list opens this way; the window cannot
// name any other.
async function openRecent(folder) {
  if (!mem.recent.includes(folder)) throw new Error('Not a recent folder');
  try {
    if (!(await fs.stat(folder)).isDirectory()) throw new Error();
  } catch {
    mem = memory.forget(mem, folder);
    saveSoon();
    buildMenu();
    throw new Error(path.basename(folder) + ' is not there any more, so it was taken off the list');
  }
  return openFolderAt(folder);
}

ipcMain.on('edit:unsaved', (_e, list) => {
  unsavedEdits = Array.isArray(list)
    ? list.filter((d) => d && typeof d.rel === 'string').slice(0, 200).map((d) => ({ rel: d.rel.slice(0, 4096), kept: d.kept === true, error: typeof d.error === 'string' ? d.error.slice(0, 300) : null }))
    : [];
  if (!unsavedEdits.length && waitingFor) followShell(waitingFor);
});
ipcMain.on('ui:layout', (_e, layout) => {
  mem.layout = memory.cleanLayout({ ...layout, zoom: mem.layout.zoom });
  saveSoon();
});
// Only for the folder open now, so a late message never lands on another.
ipcMain.on('ui:workspace', (_e, forRoot, workspace) => {
  if (forRoot !== root) return;
  const ws = memory.cleanWorkspace(workspace);
  if (ws) mem.folders[root] = ws;
  saveSoon();
});
// Terminals, each named by its id. A new one starts in the open folder.
ipcMain.on('term:input', (_e, id, data) => shell.input(id, data));
ipcMain.on('term:resize', (_e, id, cols, rows) => shell.resize(id, cols, rows));
ipcMain.on('term:choose', (_e, id) => shell.choose(id));
// The preview's place in the window, and moving it back, forward or again.
ipcMain.on('preview:place', (_e, rect) => preview.place(rect));
ipcMain.on('preview:go', (_e, what) => preview.go(what));
ipcMain.on('preview:close', () => preview.close());
ipcMain.on('preview:find', (_e, text, step, matchCase) => preview.find(text, step, matchCase));
ipcMain.on('preview:stop-find', () => preview.stopFind());
ipcMain.on('preview:focus', () => preview.focus());

// Errors go back to the window as data so it can show them.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}

handle('folder:info', async () => {
  const kitError = await changes.watchKit();
  return { ...(await disk.folderInfo(root)), kitError, rememberError };
});
handle('folder:choose', chooseFolder);
handle('folder:recent', recentFolders);
handle('folder:open', openRecent);
handle('files:list', () => disk.listFiles(root));
// The layout and the open folder's tabs, as the window left them.
handle('ui:load', () => ({ root, layout: mem.layout, workspace: mem.folders[root] || null }));
handle('dir:list', (rel) => disk.listDir(root, rel));
handle('file:read', (rel) => disk.readFile(root, rel));
handle('file:save', (rel, text, from) => disk.saveMarkdown(root, rel, text, from));
// Unsaved edits kept for recovery, only for the folder open now, so a late
// message never lands on another. Keeping one never writes to the folder.
handle('draft:keep', (forRoot, rel, text, from) => {
  if (forRoot !== root) throw new Error('That folder is no longer open');
  return kept().keep(root, rel, text, from);
});
handle('draft:drop', (forRoot, rel) => {
  if (forRoot !== root && !mem.recent.includes(forRoot)) throw new Error('Not a folder opened here');
  return kept().drop(forRoot, rel);
});
handle('drafts:list', () => kept().list(root));
// A path printed in the terminal, checked: where it leads in the open folder
// or the kit, or an error.
// A relative path is read from the folder the terminal that printed it was
// in, and only a folder main saw that terminal in; the window cannot name
// another. Without one, only a full path can lead anywhere.
handle('file:where', (p, from) => {
  const base = from && Number.isInteger(from.term) && typeof from.cwd === 'string' && shell.wasIn(from.term, from.cwd) ? from.cwd : null;
  return disk.where(root, p, base);
});
// Text search in the open folder, and stopping it. The answer names the
// folder it was for, so the window can drop one for a folder since left.
handle('search:text', (query, opts) => search.searchText(root, query, { matchCase: opts?.matchCase === true }));
ipcMain.on('search:stop', () => search.stop());
// A reference to a file, like src/app.js:12, onto the clipboard: one line of
// plain text, never anything else.
handle('clip:write', (text) => {
  if (typeof text !== 'string' || !text || text.length > 4096 || /[\x00-\x1f\x7f]/.test(text)) throw new Error('Not a reference');
  clipboard.writeText(text);
});
handle('term:start', (cols, rows) => shell.start(cols, rows, root));
handle('term:close', (id) => shell.close(id));
handle('term:list', () => shell.list());
handle('term:program', (id) => shell.what(id));
// Load a page served on this computer; address.js says which may load.
handle('preview:open', (url) => preview.open(url));
handle('preview:external', (which) => preview.external(which));
handle('preview:trust', () => preview.trust());
handle('setup:scan', () => setup.scanSetup(root));
handle('setup:read', (id) => setup.readSetup(id));
handle('sessions:last', () => sessions.lastSessions(root));
handle('sessions:steps', (id) => sessions.sessionSteps(root, id));
handle('sessions:live', () => sessions.liveSteps(root));
handle('links:broken', (walk) => links.brokenLinks(root, { walk: walk !== false }));

// The window opens where it was last, if that is still on a screen.
function lastBounds() {
  const w = mem.window;
  if (!w) return { width: 1600, height: 950 };
  const b = { width: w.width, height: w.height };
  if (w.x != null) {
    const area = screen.getDisplayMatching({ x: w.x, y: w.y, width: w.width, height: w.height }).workArea;
    const visible = w.x < area.x + area.width - 80 && w.x + w.width > area.x + 80 && w.y >= area.y - 20 && w.y < area.y + area.height - 80;
    if (visible) Object.assign(b, { x: w.x, y: w.y });
  }
  return b;
}

function rememberBounds() {
  if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return;
  mem.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
  saveSoon();
}

function createWindow() {
  win = new BrowserWindow({
    ...lastBounds(),
    minWidth: 720,
    minHeight: 460,
    title: 'next-invader',
    backgroundColor: '#161616',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (mem.window?.maximized) win.maximize();
  win.webContents.on('did-finish-load', () => win.webContents.setZoomLevel(mem.layout.zoom || 0));
  for (const e of ['resize', 'move', 'maximize', 'unmaximize']) win.on(e, rememberBounds);
  // Links and new windows stay closed; the window only shows its own page.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(APP, 'window', 'index.html'));
  preview.connect(win, toWindow);
  // A window drawn again starts with no page in its preview.
  win.webContents.on('did-start-loading', () => preview.close());
  // Quitting with an edit not saved, or while something runs in a terminal,
  // asks first, once, before anything ends: see confirmQuit.
  win.on('close', (event) => {
    if (quitConfirmed) return;
    event.preventDefault();
    confirmQuit();
  });
}

// Asking the window something as the app quits: it answers on quit:reply, or
// after a moment not at all, as when its page has stopped.
let asked = 0;
const replies = new Map();
ipcMain.on('quit:reply', (_e, id, value) => replies.get(id)?.(value));
function askWindow(what, ms) {
  if (!win || win.isDestroyed() || win.webContents.isCrashed()) return Promise.resolve(null);
  const id = ++asked;
  return new Promise((resolve) => {
    const timer = setTimeout(() => done(null), ms);
    const done = (value) => {
      clearTimeout(timer);
      replies.delete(id);
      resolve(value);
    };
    replies.set(id, done);
    win.webContents.send('quit:' + what, id);
  });
}

// Quitting, by closing the window or with ⌘Q. First the window writes each
// unsaved edit to the recovery store and says which are kept. Then one
// question covers the edits and the programs running in terminals. Cancel
// leaves the window, the edits and every terminal as they were; nothing has
// been ended. Save and Quit saves every edit first, and quits only if every
// one was saved; otherwise it stays, and the window shows why.
let quitConfirmed = false;
let quitAsking = false;
async function confirmQuit() {
  if (quitAsking) return;
  quitAsking = true;
  try {
    const told = await askWindow('flush', 3000);
    const edits = Array.isArray(told) ? told.map((d) => ({ rel: String(d.rel), kept: d.kept === true, error: d.error ? String(d.error) : null })) : unsavedEdits.map((d) => ({ ...d, kept: false }));
    const running = shell.list().filter((t) => t.program).map((t) => t.agent || t.program);
    const q = drafts.quitQuestion(edits, running);
    if (q) {
      const { response } = await dialog.showMessageBox(win, { type: 'question', ...q });
      const choice = q.buttons[response];
      if (choice === 'Cancel') return;
      if (choice === 'Save and Quit') {
        const res = await askWindow('save', 15000);
        const failed = Array.isArray(res?.failed) ? res.failed : null;
        if (!failed || failed.length) {
          const which = failed?.length ? failed.map((f) => f.rel + ': ' + f.error).join('\n') : 'The window did not say whether your edits were saved.';
          await dialog.showMessageBox(win, { type: 'warning', message: 'next-invader did not quit', detail: 'Not everything was saved, so nothing was ended.\n\n' + which, buttons: ['OK'] });
          return;
        }
      }
    }
    quitConfirmed = true;
    app.quit();
  } finally {
    quitAsking = false;
  }
}

// Everything in the window, the terminal too, bigger or smaller, in half
// steps, remembered with the layout.
function zoom(by) {
  mem.layout.zoom = by === 0 ? 0 : Math.max(-3, Math.min(5, (mem.layout.zoom || 0) + by * 0.5));
  win?.webContents.setZoomLevel(mem.layout.zoom);
  saveSoon();
}

// The menu. Its keys work wherever the focus is, the terminal included; each
// item only asks the window to do what its own buttons do. There is no
// Reload, so no key can wipe the window, and Close Window is not ⌘W, which
// closes a tab.
// Each gives the keyboard back to the window first, since the preview's page
// may have it, and tells the window whether it did, so a palette closed
// without a choice gives it back to the page, and Find finds in the page.
// Reload Preview and Select All act where the keyboard is instead.
const send = (cmd, arg) => () => {
  const fromPage = preview.focused();
  if (cmd !== 'preview-go') win?.webContents.focus();
  toWindow('menu', cmd, arg, { fromPage });
};
// Select All selects in whatever has the keyboard: the page, the terminal
// (which the window's own select would miss) or the window's text.
function selectAll() {
  if (preview.focused()) return preview.contents()?.selectAll();
  toWindow('menu', 'select-all', null, { fromPage: false });
}
function buildMenu() {
  const recent = mem.recent.filter((p) => p !== root);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { label: 'Go to File…', accelerator: 'CmdOrCtrl+P', click: send('quick-open') },
        { label: 'Switch Folder…', accelerator: 'CmdOrCtrl+O', click: send('switch-folder') },
        { label: 'Open Folder…', accelerator: 'CmdOrCtrl+Shift+O', click: send('choose-folder') },
        { label: 'New Terminal', accelerator: 'CmdOrCtrl+T', click: send('new-terminal') },
        {
          label: 'Open Recent',
          enabled: recent.length > 0,
          submenu: recent.map((p) => ({ label: path.basename(p) + '  —  ' + p.replace(os.homedir(), '~'), click: send('open-recent', p) })),
        },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
        { label: 'Close Terminal', click: send('close-terminal') },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', click: selectAll },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: send('back') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: send('forward') },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: send('find') },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: send('find-step', 1) },
        { label: 'Find Previous', accelerator: 'CmdOrCtrl+Shift+G', click: send('find-step', -1) },
        { label: 'Find in Folder…', accelerator: 'CmdOrCtrl+Shift+F', click: send('find-folder') },
        { label: 'Go to Line…', accelerator: 'CmdOrCtrl+L', click: send('go-line') },
        { type: 'separator' },
        { label: 'Show in Tree', click: send('reveal') },
        { label: 'Show on Map', click: send('show-on-map') },
        { label: 'Copy Reference', accelerator: 'CmdOrCtrl+Alt+C', click: send('copy-ref') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Overview', accelerator: 'CmdOrCtrl+1', click: send('overview') },
        { label: 'Changes', accelerator: 'CmdOrCtrl+Shift+C', click: send('changes') },
        { label: 'Agent Setup', accelerator: 'CmdOrCtrl+Shift+A', click: send('setup') },
        { label: 'Preview', accelerator: 'CmdOrCtrl+Alt+P', click: send('preview') },
        { label: 'Reload Preview', accelerator: 'CmdOrCtrl+R', click: send('preview-go', 'reload') },
        { type: 'separator' },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', click: send('tab', 1) },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', click: send('tab', -1) },
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: send('tab', 1), visible: false, acceleratorWorksWhenHidden: true },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: send('tab', -1), visible: false, acceleratorWorksWhenHidden: true },
        ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ label: 'Tab ' + n, accelerator: 'CmdOrCtrl+' + n, click: send('tab-at', n - 1), visible: false, acceleratorWorksWhenHidden: true })),
        { type: 'separator' },
        { label: 'Terminal', accelerator: 'CmdOrCtrl+J', click: send('terminal') },
        { label: 'Hide or Show Terminal', accelerator: 'CmdOrCtrl+Shift+J', click: send('toggle-terminal') },
        { label: 'Next Terminal', accelerator: 'Ctrl+`', click: send('terminal-step', 1) },
        { label: 'Previous Terminal', accelerator: 'Ctrl+Shift+`', click: send('terminal-step', -1) },
        { label: 'Clear Terminal', accelerator: 'CmdOrCtrl+K', click: send('clear-terminal') },
        { label: 'Show Only the Map', accelerator: 'CmdOrCtrl+Shift+M', click: send('map-only') },
        { type: 'separator' },
        { label: 'Text Bigger', accelerator: 'CmdOrCtrl+=', click: () => zoom(1) },
        { label: 'Text Smaller', accelerator: 'CmdOrCtrl+-', click: () => zoom(-1) },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ]));
}

nativeTheme.themeSource = 'dark';

app.whenReady().then(async () => {
  app.dock?.setIcon(path.join(APP, 'icon.png'));
  mem = await memory.load(stateFile());
  root = await startFolder();
  await rememberFolder();
  buildMenu();
  createWindow();
  win.webContents.once('did-finish-load', watch);
});
// However the app quits, closing its window or with ⌘Q, it first closes the
// preview and every terminal, waiting a moment for their shells to end, and
// writes the last change it has not written yet.
let finished = false;
app.on('will-quit', (event) => {
  if (finished) return;
  event.preventDefault();
  finished = true;
  preview.close();
  changes.stop();
  Promise.all([shell.closeAll(), saveTimer ? saveNow() : null]).finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
