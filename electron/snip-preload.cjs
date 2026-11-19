const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('snipAPI', {
  onScreenData: (callback) => {
    ipcRenderer.on('snip-screen-data', (_event, payload) => callback(payload));
  },
  completeSnip: (payload) => ipcRenderer.send('snip-complete', payload),
  cancelSnip: () => ipcRenderer.send('snip-cancel')
});
