const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  startSnip: () => ipcRenderer.invoke('start-snip'),
  getHotkey: () => ipcRenderer.invoke('get-hotkey'),
  setHotkey: (hotkey) => ipcRenderer.invoke('set-hotkey', hotkey),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  onSnipCaptured: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('snip-captured', listener);
    return () => ipcRenderer.removeListener('snip-captured', listener);
  }
});
