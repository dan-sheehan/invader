// The only bridge between the window and the disk and terminal.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('disk', {
  folderInfo: () => ipcRenderer.invoke('folder:info'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  recentFolders: () => ipcRenderer.invoke('folder:recent'),
  openRecent: (folder) => ipcRenderer.invoke('folder:open', folder),
  listFiles: () => ipcRenderer.invoke('files:list'),
  listDir: (rel) => ipcRenderer.invoke('dir:list', rel),
  readFile: (rel) => ipcRenderer.invoke('file:read', rel),
  saveMarkdown: (rel, text, from) => ipcRenderer.invoke('file:save', rel, text, from),
  where: (p, from) => ipcRenderer.invoke('file:where', p, from),
  search: (query, opts) => ipcRenderer.invoke('search:text', query, opts),
  stopSearch: () => ipcRenderer.send('search:stop'),
  copy: (text) => ipcRenderer.invoke('clip:write', text),
  onFolderChanged: (fn) => ipcRenderer.on('folder:changed', (_e, root) => fn(root)),
  onFolderWaiting: (fn) => ipcRenderer.on('folder:waiting', (_e, folder) => fn(folder)),
  setUnsaved: (list) => ipcRenderer.send('edit:unsaved', list),
  onChanges: (fn) => ipcRenderer.on('changes', (_e, changes) => fn(changes)),
  setup: () => ipcRenderer.invoke('setup:scan'),
  readSetup: (id) => ipcRenderer.invoke('setup:read', id),
  sessions: () => ipcRenderer.invoke('sessions:last'),
  steps: (id) => ipcRenderer.invoke('sessions:steps', id),
  live: () => ipcRenderer.invoke('sessions:live'),
  brokenLinks: (walk) => ipcRenderer.invoke('links:broken', walk),
});

// Unsaved Markdown edits, kept for recovery in the app's own data folder.
// Each call names the folder it is for; main keeps only the open one's.
contextBridge.exposeInMainWorld('drafts', {
  keep: (root, rel, text, from) => ipcRenderer.invoke('draft:keep', root, rel, text, from),
  drop: (root, rel) => ipcRenderer.invoke('draft:drop', root, rel),
  list: () => ipcRenderer.invoke('drafts:list'),
  // As the app quits: write what is not kept yet and say what is; save all.
  onQuit: (flush, save) => {
    ipcRenderer.on('quit:flush', async (_e, id) => ipcRenderer.send('quit:reply', id, await flush()));
    ipcRenderer.on('quit:save', async (_e, id) => ipcRenderer.send('quit:reply', id, await save()));
  },
});

// What the window remembers between runs: the layout, and the tabs of the
// folder open. Main checks both and keeps them in its own data folder.
contextBridge.exposeInMainWorld('memory', {
  load: () => ipcRenderer.invoke('ui:load'),
  layout: (layout) => ipcRenderer.send('ui:layout', layout),
  workspace: (root, workspace) => ipcRenderer.send('ui:workspace', root, workspace),
});

// The menu's items and keys, which the window acts on.
contextBridge.exposeInMainWorld('menu', {
  on: (fn) => ipcRenderer.on('menu', (_e, cmd, arg, how) => fn(cmd, arg, how || {})),
});

// The terminals. Every call names the terminal it is for by its id.
contextBridge.exposeInMainWorld('terminal', {
  start: (cols, rows) => ipcRenderer.invoke('term:start', cols, rows),
  close: (id) => ipcRenderer.invoke('term:close', id),
  list: () => ipcRenderer.invoke('term:list'),
  choose: (id) => ipcRenderer.send('term:choose', id),
  input: (id, data) => ipcRenderer.send('term:input', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('term:resize', id, cols, rows),
  program: (id) => ipcRenderer.invoke('term:program', id),
  onProgram: (fn) => ipcRenderer.on('term:program', (_e, id, running) => fn(id, running)),
  onData: (fn) => ipcRenderer.on('term:data', (_e, id, data) => fn(id, data)),
  onExit: (fn) => ipcRenderer.on('term:exit', (_e, id, code) => fn(id, code)),
  onFolder: (fn) => ipcRenderer.on('term:folder', (_e, id, cwd) => fn(id, cwd)),
});

// The preview of a page served on this computer. The window only says where
// it goes and what to load; the page itself never reaches the window.
contextBridge.exposeInMainWorld('preview', {
  open: (url) => ipcRenderer.invoke('preview:open', url),
  place: (rect) => ipcRenderer.send('preview:place', rect),
  go: (what) => ipcRenderer.send('preview:go', what),
  close: () => ipcRenderer.send('preview:close'),
  external: (which) => ipcRenderer.invoke('preview:external', which),
  trust: () => ipcRenderer.invoke('preview:trust'),
  find: (text, step, matchCase) => ipcRenderer.send('preview:find', text, step, matchCase),
  stopFind: () => ipcRenderer.send('preview:stop-find'),
  focus: () => ipcRenderer.send('preview:focus'),
  onState: (fn) => ipcRenderer.on('preview:state', (_e, s) => fn(s)),
});
