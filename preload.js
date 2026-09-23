// The only bridge between the window and the disk and terminal.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('disk', {
  folderInfo: () => ipcRenderer.invoke('folder:info'),
  chooseFolder: () => ipcRenderer.invoke('folder:choose'),
  listDir: (rel) => ipcRenderer.invoke('dir:list', rel),
  readFile: (rel) => ipcRenderer.invoke('file:read', rel),
  saveMarkdown: (rel, text, from) => ipcRenderer.invoke('file:save', rel, text, from),
  onFolderChanged: (fn) => ipcRenderer.on('folder:changed', (_e, root) => fn(root)),
  onFolderWaiting: (fn) => ipcRenderer.on('folder:waiting', (_e, folder) => fn(folder)),
  setUnsaved: (rel) => ipcRenderer.send('edit:unsaved', rel),
  onChanges: (fn) => ipcRenderer.on('changes', (_e, changes) => fn(changes)),
});

contextBridge.exposeInMainWorld('terminal', {
  start: (cols, rows) => ipcRenderer.send('term:start', cols, rows),
  input: (data) => ipcRenderer.send('term:input', data),
  program: () => ipcRenderer.invoke('term:program'),
  onProgram: (fn) => ipcRenderer.on('term:program', (_e, running) => fn(running)),
  resize: (cols, rows) => ipcRenderer.send('term:resize', cols, rows),
  onData: (fn) => ipcRenderer.on('term:data', (_e, data) => fn(data)),
  onExit: (fn) => ipcRenderer.on('term:exit', () => fn()),
});
