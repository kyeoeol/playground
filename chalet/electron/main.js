import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadStore, flushStore, makeChannels, startWatching, stopWatching } from './rex.js';
import { makeFolderChannels } from './folders.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEV_URL = process.env.VITE_DEV_SERVER_URL; // set by tools/electron-dev.mjs

/*
 * Bridge channels: the page calls window.native.send(channel, data) and the handler here runs.
 * reply(channel, data) sends a message back to that page (window.native.on(channel, fn)).
 * broadcast(channel, data) sends it to every window.
 */
const broadcast = (ch, payload) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('bridge:event', ch, payload);
};
const channels = {
  ...makeChannels({ broadcast, openFolder: (dir) => shell.openPath(dir) }),
  ...makeFolderChannels(), // the in-app folder picker browses folders through these
};

ipcMain.on('bridge:send', (event, channel, data) => {
  const reply = (ch, payload) => event.sender.send('bridge:event', ch, payload);
  const handler = channels[channel];
  // inside then(): a handler that throws synchronously is caught here too, not only a rejection
  if (handler) Promise.resolve().then(() => handler(data ?? {}, reply)).catch((e) => console.error(`[bridge] ${channel}:`, e));
  else console.warn(`[bridge] no handler for channel "${channel}"`);
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Chalet Beta',
    backgroundColor: '#ffffff',
    show: false,
    webPreferences: {
      preload: join(ROOT, 'electron/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());

  // Open external links in the default browser, never in the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(join(ROOT, 'dist/index.html'));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(async () => {
    // In dev the Dock shows the Electron icon; use ours. The packaged app gets it from the bundle.
    if (DEV_URL && process.platform === 'darwin') app.dock.setIcon(join(ROOT, 'build/icon.png'));
    await loadStore();
    startWatching(); // the houses' Claude Code sessions on the Rex server
    createWindow();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on('window-all-closed', () => app.quit());
  // Quitting leaves the houses' Claude Code running on the Rex server.
  // Hold the quit until the store is on disk, then quit for real.
  let stored = false;
  app.on('before-quit', (e) => {
    stopWatching();
    if (stored) return;
    e.preventDefault();
    flushStore()
      .catch((err) => console.error('[store]', err))
      .finally(() => { stored = true; app.quit(); });
  });
}
