const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('automato', {
  command: (command, args) => ipcRenderer.invoke('automato:command', command, args),
  bounds: value => ipcRenderer.send('automato:bounds', value),
  choose: () => ipcRenderer.invoke('automato:choose'),
  attach: path => ipcRenderer.invoke('automato:attach', path),
  folder: type => ipcRenderer.invoke('automato:folder', type),
  resize: (action, token) => ipcRenderer.invoke('automato:resize', action, token),
  closeAppearance: () => ipcRenderer.invoke('automato:appearance-close'),
  storageInfo: () => ipcRenderer.invoke('automato:storage-info'),
  chooseStorage: () => ipcRenderer.invoke('automato:storage-choose'),
  saveStorage: folder => ipcRenderer.invoke('automato:storage-save', folder),
  retryStorage: () => ipcRenderer.invoke('automato:storage-retry'),
  openStorage: () => ipcRenderer.invoke('automato:storage-open'),
  onSettingsTab: callback => ipcRenderer.on('automato:settings-tab', (_event, tab) => callback(tab)),
  onState: callback => ipcRenderer.on('automato:state', (_event, state) => callback(state))
});
