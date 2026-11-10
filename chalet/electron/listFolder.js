/*
 * One folder's subfolders, for the folder picker. No Electron here, so the Vite dev server
 * (vite.config.js) can serve the same list to the browser preview as the app's main process
 * (electron/folders.js) does.
 */
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, resolve, isAbsolute } from 'node:path';

const MAX_ENTRIES = 500;

/** '~' and '~/x' to the home folder, a bare name under it; no trailing slash. */
export function expand(p) {
  const home = homedir();
  if (!p || p === '~') return home;
  if (p.startsWith('~/')) return resolve(home, p.slice(2));
  return isAbsolute(p) ? resolve(p) : resolve(home, p);
}

/** Folders that hold apps, not projects: not listed. */
function skipped(path) {
  return path === '/Applications' || path === join(homedir(), 'Applications');
}

/**
 * { path, parent, home, entries: [{ name, path, git, conflict }], truncated, conflict }.
 * Hidden folders are listed too (the page shows them only when the typed name starts with '.').
 * prefix: only the folders whose names start with it (any case). At most MAX_ENTRIES come
 * back, the first in name order; truncated says some were left out, so the page asks again
 * with what the user typed as the prefix.
 * conflictOf(path) gives the house a folder already belongs to, if any.
 */
export async function listFolder(path, conflictOf = () => null, prefix = '') {
  const dir = expand(path);
  const st = await stat(dir);
  if (!st.isDirectory()) throw Object.assign(new Error('Not a folder.'), { code: 'ENOTDIR' });
  const low = prefix.toLowerCase();
  const names = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (low && !e.name.toLowerCase().startsWith(low)) continue;
    const p = join(dir, e.name);
    if (skipped(p)) continue;
    let isDir = e.isDirectory();
    if (!isDir && e.isSymbolicLink()) isDir = await stat(p).then((s) => s.isDirectory(), () => false);
    if (isDir) names.push(e.name);
  }
  // sort before cutting, and check .git and houses only for the folders that are sent
  names.sort((a, b) => a.localeCompare(b, 'ko', { numeric: true, sensitivity: 'base' }));
  const entries = names.slice(0, MAX_ENTRIES).map((name) => {
    const p = join(dir, name);
    return { name, path: p, git: existsSync(join(p, '.git')), conflict: conflictOf(p) };
  });
  return {
    path: dir, parent: dirname(dir) !== dir ? dirname(dir) : null, home: homedir(),
    entries, truncated: names.length > MAX_ENTRIES, conflict: conflictOf(dir),
  };
}

/** The user-facing message for a failed listing. */
export function listError(e) {
  if (e.code === 'EACCES' || e.code === 'EPERM') return 'No permission to read this folder.';
  if (e.code === 'ENOENT') return 'Folder not found.';
  return String(e.message || e);
}
