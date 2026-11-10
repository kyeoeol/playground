// Runs in the page before its scripts. Exposes a small, fixed API as window.native.
// The page talks to the main process only through this (see src/village/api.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('native', {
  isApp: true,
  // Send a message to the main process on a named channel.
  send: (channel, data) => ipcRenderer.send('bridge:send', channel, data),
  // Listen for messages from the main process on a named channel. Returns an unsubscribe function.
  on: (channel, fn) => {
    const handler = (_event, ch, data) => { if (ch === channel) fn(data); };
    ipcRenderer.on('bridge:event', handler);
    return () => ipcRenderer.off('bridge:event', handler);
  },
});
