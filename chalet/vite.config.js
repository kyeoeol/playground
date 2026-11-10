import { defineConfig } from 'vite';
import { listFolder, listError } from './electron/listFolder.js';

/*
 * The browser preview (npm run dev) has no main process, so the dev server lists folders
 * for the folder picker instead: GET /__folders?path=~/x&prefix=ab. Dev server only, not in a build.
 */
const folderList = {
  name: 'folder-list',
  configureServer(server) {
    server.middlewares.use('/__folders', async (req, res) => {
      const q = new URL(req.url, 'http://x').searchParams;
      let body;
      try { body = await listFolder(q.get('path') || '~', undefined, q.get('prefix') || ''); } catch (e) { body = { error: listError(e) }; }
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
    });
  },
};

export default defineConfig({
  // Relative asset paths, so the built page also loads from file:// inside the Electron app.
  base: './',
  plugins: [folderList],
});
