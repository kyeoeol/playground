import { api } from './api.js';
import { ICON, esc } from '../ui/html.js';

/*
 * In-app dialogs in the same glass style as the rest of the UI (not the browser's or the
 * system's): a folder picker for connecting a house, and a confirm box.
 * While one is open, #ui has the class 'modal' and the game ignores the keyboard.
 */

/** Ask the main process and wait for its answer (a reply channel matched by reqId). */
function ask(channel, replyChannel, data) {
  const reqId = Math.random().toString(36).slice(2);
  return new Promise((resolve) => {
    const off = api.on(replyChannel, (d) => {
      if (d.reqId !== reqId) return;
      off();
      resolve(d);
    });
    api.send(channel, { ...data, reqId });
  });
}

/** Open a modal: a backdrop with one glass panel. Returns { root, panel, close }. */
function modal(className, html, onKey) {
  const ui = document.getElementById('ui');
  const root = document.createElement('div');
  root.className = 'modal-backdrop';
  root.innerHTML = `<section class="modal glass ${className}" role="dialog" aria-modal="true">${html}</section>`;
  ui.appendChild(root);
  ui.classList.add('modal');
  const key = (e) => onKey(e);
  addEventListener('keydown', key, true);
  return {
    root,
    panel: root.firstElementChild,
    close() {
      removeEventListener('keydown', key, true);
      root.remove();
      if (!ui.querySelector('.modal-backdrop')) ui.classList.remove('modal');
    },
  };
}

/** A yes/no question. Resolves true for yes. */
export function askConfirm({ title, body = '', ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const m = modal('confirm-modal', `
      <h2>${esc(title)}</h2>
      ${body ? `<p>${esc(body)}</p>` : ''}
      <footer><button class="btn" data-a="no">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-a="yes">${esc(ok)}</button></footer>`,
    (e) => {
      e.stopPropagation(); // the game does not get keys while the box is open
      if (e.key === 'Escape') { e.preventDefault(); done(false); return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      // Enter presses the focused button (Tab moves between them); with none focused it says
      // yes, except to something that destroys
      const focused = document.activeElement?.closest?.('[data-a]');
      if (focused && m.panel.contains(focused)) { e.preventDefault(); done(focused.dataset.a === 'yes'); }
      else if (!danger) { e.preventDefault(); done(true); }
    });
    const done = (v) => { m.close(); resolve(v); };
    m.root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a) done(a === 'yes');
      else if (e.target === m.root) done(false);
    });
    m.panel.querySelector(danger ? '[data-a="no"]' : '[data-a="yes"]').focus();
  });
}

/** Path for display: the home folder as ~. */
const pretty = (p, home) => (home && (p === home || p.startsWith(home + '/')) ? '~' + p.slice(home.length) : p);

/** The typed path split at its last '/': the folder whose list shows, and the name being typed. */
function splitQuery(q) {
  if (q === '~') q = '~/';
  const i = q.lastIndexOf('/');
  return i < 0 ? { dir: '~/', leaf: q } : { dir: q.slice(0, i + 1), leaf: q.slice(i + 1) };
}

/**
 * Choose the folder for a house. Resolves { dir, name }, or null if cancelled.
 * One path field over the list of the folder it names (as in T3 Code): click a folder to go
 * into it, type to narrow the list, Tab to complete, Enter to connect the folder in the field.
 * Folders that are already a house's cannot be connected; a folder inside or around another
 * house's folder gets a warning, and the button says so.
 */
export function pickFolder({ title = '' } = {}) {
  return new Promise((resolve) => {
    // listing: the folder shown; listingFor: the query text it was asked for ({ dir, prefix })
    const s = { query: lastQuery || '~/', home: '', listing: null, listingFor: null, error: '', hi: -1, rows: [], loading: null };
    const cache = new Map(); // folder text (+ prefix) → its listing, while the picker is open
    let gen = 0;
    const m = modal('folder-modal', `
      <header>
        <div><h2>Connect a folder</h2><p class="sub">${esc(title)}</p></div>
        <button class="icon-btn" data-a="cancel" aria-label="Close">${ICON.close}</button>
      </header>
      <div class="fp-box">
        <div class="fp-bar">
          <button class="icon-btn" data-a="up" title="Parent folder">${ICON.back}</button>
          <input class="fp-path" spellcheck="false" autocomplete="off" aria-label="Folder path">
        </div>
        <div class="fp-label"><span>Folders</span><span class="fp-keys"><kbd>Tab</kbd> open · <kbd>↵</kbd> connect</span></div>
        <div class="fp-list" role="listbox"></div>
      </div>
      <div class="fp-notice hidden"></div>
      <footer>
        <div class="fp-target"></div>
        <button class="btn" data-a="cancel">Cancel</button>
        <button class="btn primary" data-a="ok">Connect</button>
      </footer>`, onKey);
    const $ = (sel) => m.panel.querySelector(sel);
    const input = $('.fp-path');
    let closed = false;
    const finish = (v) => { if (closed) return; closed = true; m.close(); resolve(v); };
    /** A folder as the field shows it: from ~ when under home, always ending in '/'. */
    const slashed = (p) => { const t = pretty(p, s.home); return t.endsWith('/') ? t : `${t}/`; };

    /** A folder's listing, from the cache or the main process. */
    async function list(dir, prefix = '') {
      const key = `${dir}\n${prefix}`;
      let r = cache.get(key);
      if (!r) {
        r = await ask('folder:list', 'folder:listed', { path: dir, prefix });
        if (!r.error) cache.set(key, r);
      }
      return r;
    }

    function refresh() {
      s.loading = load();
      return s.loading;
    }

    async function load() {
      const { dir, leaf } = splitQuery(s.query);
      const my = ++gen;
      let prefix = '';
      let r = await list(dir);
      // too many folders to send them all: ask for the ones that start with what is typed
      if (!r.error && r.truncated && leaf) r = await list(dir, (prefix = leaf.toLowerCase()));
      if (my !== gen) return; // typed on meanwhile
      s.listing = r.error ? null : r;
      s.listingFor = { dir, prefix };
      s.error = r.error || '';
      if (r.home) s.home = r.home;
      render();
    }

    /** True if the listing shown is the one for the text in the field (not one still loading). */
    function current() {
      const f = s.listingFor, { dir, leaf } = splitQuery(s.query);
      if (!s.listing || !f || f.dir !== dir) return false;
      if (f.prefix) return leaf.toLowerCase().startsWith(f.prefix);
      return !s.listing.truncated || !leaf;
    }

    function setQuery(q) {
      s.query = q;
      s.hi = -1;
      input.value = q;
      input.focus();
      input.setSelectionRange(q.length, q.length);
      refresh();
    }

    /** '..' and the folders whose names start with what is typed (dot folders only for a '.'). */
    function rows() {
      const L = s.listing;
      if (!L) return [];
      const { leaf } = splitQuery(s.query), low = leaf.toLowerCase(), dots = leaf.startsWith('.');
      const out = L.parent && !leaf ? [{ up: true, name: '..', path: L.parent }] : [];
      for (const e of L.entries) if (e.name.toLowerCase().startsWith(low) && (dots || !e.name.startsWith('.'))) out.push(e);
      return out;
    }

    /** The folder Enter connects: the one in the field (its folder, or the folder named in full). */
    function target() {
      const L = s.listing;
      if (!current()) return null;
      const { leaf } = splitQuery(s.query);
      if (!leaf) return { path: L.path, name: L.path.split('/').filter(Boolean).pop() || '/', conflict: L.conflict };
      const e = L.entries.find((x) => x.name === leaf) || L.entries.find((x) => x.name.toLowerCase() === leaf.toLowerCase());
      return e ? { path: e.path, name: e.name, conflict: e.conflict } : null;
    }

    const into = (row) => setQuery(row.up ? slashed(row.path) : `${splitQuery(s.query).dir}${row.name}/`);

    function render() {
      const list = $('.fp-list');
      const R = (s.rows = rows());
      const { leaf } = splitQuery(s.query);
      // rebuild the rows only when they change: moving the highlight just moves a class
      const key = `${s.listing?.path}|${leaf}|${s.error}`;
      if (key !== list.dataset.key) {
        list.dataset.key = key;
        if (s.error) list.innerHTML = `<p class="fp-empty error">${esc(s.error)}</p>`;
        else if (!s.listing) list.innerHTML = '';
        else {
          list.innerHTML = R.map((e, i) => `
            <button class="fp-row${e.conflict?.kind === 'same' ? ' taken' : ''}" data-i="${i}" role="option" tabindex="-1">
              ${e.up ? ICON.parent : ICON.folder}<span class="nm">${esc(e.name)}</span>
              ${e.git ? '<em class="badge">git</em>' : ''}
              ${e.conflict?.kind === 'same' ? `<em class="badge house">${ICON.house}${esc(e.conflict.house.name)}</em>` : ''}
            </button>`).join('');
          if (!R.some((e) => !e.up)) list.insertAdjacentHTML('beforeend', `<p class="fp-empty">${leaf ? `No folders start with '${esc(leaf)}'.` : s.listing.conflict?.kind === 'same' ? 'No subfolders.' : 'No subfolders. You can connect this folder as it is.'}</p>`);
        }
      }
      list.querySelectorAll('.fp-row').forEach((r) => r.classList.toggle('on', +r.dataset.i === s.hi));
      $('[data-a="up"]').disabled = !s.listing?.parent;

      const t = target(), c = t?.conflict;
      const notice = $('.fp-notice');
      let msg = '';
      if (c?.kind === 'same') msg = `<b>This folder is already connected to '${esc(c.house.name)}'.</b> A folder can have only one house.`;
      else if (c?.kind === 'inside') msg = `<b>This folder is inside the folder of '${esc(c.house.name)}'.</b> Claude Code in both houses can edit the same files.`;
      else if (c?.kind === 'contains') msg = `<b>This folder contains the folder of '${esc(c.house.name)}'.</b> Claude Code in both houses can edit the same files.`;
      notice.innerHTML = msg;
      notice.className = `fp-notice${msg ? '' : ' hidden'}${c?.kind === 'same' ? ' bad' : ''}`;
      $('.fp-target').innerHTML = t ? `${ICON.folder}<span>${esc(pretty(t.path, s.home))}</span>` : '<span>Choose a folder to connect</span>';
      const ok = $('[data-a="ok"]');
      ok.disabled = !t || c?.kind === 'same';
      ok.textContent = c && c.kind !== 'same' ? 'Connect anyway' : 'Connect';
      ok.classList.toggle('warn', !!c && c.kind !== 'same');
    }

    async function connect() {
      if (!current()) await s.loading; // Enter right after typing: wait for this folder's list
      const t = target();
      if (closed || !t || t.conflict?.kind === 'same') return;
      lastQuery = slashed(t.path.slice(0, t.path.lastIndexOf('/')) || '/'); // next time, start beside it
      finish({ dir: t.path, name: t.name });
    }

    /** Shell-style Tab: one match goes into it, several extend the name to what they share. */
    function complete() {
      if (s.rows[s.hi]) return into(s.rows[s.hi]);
      const R = s.rows.filter((e) => !e.up);
      if (!R.length) return;
      if (R.length === 1) return into(R[0]);
      const { dir, leaf } = splitQuery(s.query);
      let n = 0;
      const a = R[0].name.toLowerCase();
      while (n < a.length && R.every((e) => e.name[n]?.toLowerCase() === a[n])) n++;
      if (n > leaf.length) setQuery(dir + R[0].name.slice(0, n));
    }

    function onKey(e) {
      e.stopPropagation(); // the game does not get keys while the picker is open
      if (e.isComposing || e.keyCode === 229) return; // Enter that ends a Korean syllable is typing
      const n = s.rows.length;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (s.hi >= 0) { s.hi = -1; render(); } else finish(null);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (n) s.hi = e.key === 'ArrowDown' ? Math.min(n - 1, s.hi + 1) : Math.max(-1, s.hi - 1);
        render();
        $(`.fp-row[data-i="${s.hi}"]`)?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Tab') {
        e.preventDefault();
        complete();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        // a highlighted row opens; otherwise (or with ⌘) the folder in the field connects
        if (s.rows[s.hi] && !e.metaKey && !e.ctrlKey) into(s.rows[s.hi]);
        else connect();
      } else if (e.target !== input && e.key.length === 1 && !e.metaKey && !e.ctrlKey) input.focus(); // typing goes to the field
    }

    input.addEventListener('input', () => { s.query = input.value; s.hi = -1; refresh(); });
    // keep the caret in the field when a row or button is pressed
    m.panel.addEventListener('mousedown', (e) => { if (e.target.closest('.fp-row, [data-a="up"]')) e.preventDefault(); });
    m.root.addEventListener('click', (e) => {
      if (e.target === m.root) return finish(null);
      const row = e.target.closest('.fp-row');
      if (row) return into(s.rows[+row.dataset.i]);
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'cancel') finish(null);
      if (a === 'ok') connect();
      if (a === 'up' && s.listing?.parent) setQuery(slashed(s.listing.parent));
    });

    setQuery(s.query);
  });
}

let lastQuery = null;
