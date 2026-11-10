
/*
 * The village's link to the main process (electron/rex.js). In a plain browser
 * (npm run dev) there is no main process: builds are kept in localStorage and
 * Claude Code is not available, so a prompt gets an explanation back.
 */
const KEY = 'village.builds';

function browserApi() {
  const handlers = new Map();
  const fire = (ch, d) => (handlers.get(ch) || []).forEach((fn) => fn(d));
  let builds = [];
  try { builds = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { builds = []; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(builds)); } catch { /* private window */ } };
  const find = (id) => builds.find((b) => b.id === id);
  const changed = (b) => { save(); fire('build:changed', { ...b, working: false }); };
  // the same rules as folderConflict in electron/rex.js, on the path text (no file system here)
  const norm = (p) => String(p || '').replace(/\/+$/, '').toLowerCase();
  const conflict = (dir) => {
    const c = norm(dir);
    let near = null;
    for (const b of builds) {
      if (b.decor || !b.cwd) continue;
      const o = norm(b.cwd), house = { id: b.id, name: b.name };
      if (o === c) return { kind: 'same', house };
      if (!near && c.startsWith(o + '/')) near = { kind: 'inside', house };
      if (!near && o.startsWith(c + '/')) near = { kind: 'contains', house };
    }
    return near;
  };
  const ops = {
    'village:load': () => fire('village:data', { builds, claude: null, rex: null }),
    // no main process here: the Vite dev server lists the folders (vite.config.js)
    'folder:list': async ({ reqId, path, prefix = '' }) => {
      let r;
      try {
        const res = await fetch(`/__folders?path=${encodeURIComponent(path || '~')}&prefix=${encodeURIComponent(prefix)}`);
        r = res.ok ? await res.json() : { error: 'The browser preview cannot list folders. Open the app with npm run app.' };
      } catch {
        r = { error: 'The browser preview cannot list folders. Open the app with npm run app.' };
      }
      if (r.error) return fire('folder:listed', { reqId, error: r.error });
      for (const e of r.entries) e.conflict = conflict(e.path);
      fire('folder:listed', { reqId, ...r, conflict: conflict(r.path) });
    },
    'folder:open': () => {},
    'build:add': (d) => {
      if (find(d.id)) return;
      const c = !d.decor && conflict(d.cwd);
      if (c?.kind === 'same') return fire('build:rejected', { id: d.id, reason: `'${c.house.name}' is already connected to this folder.` });
      const b = { ...d, mode: 'auto', sessionId: null, messages: [], createdAt: Date.now() };
      builds.push(b);
      changed(b);
    },
    'build:update': ({ id, patch }) => {
      const b = find(id);
      if (!b) return;
      if (patch.name) b.name = patch.name;
      if (patch.mode) b.mode = patch.mode;
      if (Number.isFinite(patch.rot)) b.rot = patch.rot;
      if (Number.isInteger(patch.variant)) b.variant = patch.variant;
      if (patch.newChat) b.messages = [];
      if (typeof patch.unread === 'boolean') b.unread = patch.unread;
      changed(b);
    },
    'build:remove': ({ id }) => { builds = builds.filter((b) => b.id !== id); save(); fire('build:removed', { id }); },
    'claude:send': ({ id, text }) => {
      const b = find(id);
      if (!b) return;
      b.messages.push({ role: 'user', text, at: Date.now() });
      b.messages.push({ role: 'claude', error: true, at: Date.now(), text: 'Claude Code runs only in the desktop app (npm run app).' });
      b.unread = true;
      changed(b);
    },
    'claude:stop': () => {},
  };
  return {
    isApp: false,
    send: (ch, d = {}) => setTimeout(() => ops[ch]?.(d), 0),
    on: (ch, fn) => {
      if (!handlers.has(ch)) handlers.set(ch, []);
      handlers.get(ch).push(fn);
      return () => handlers.set(ch, handlers.get(ch).filter((f) => f !== fn));
    },
  };
}

// In the Electron app, electron/preload.cjs provides window.native; a plain browser
// (npm run dev) gets the in-page stand-in above.
export const api = window.native ?? browserApi();
