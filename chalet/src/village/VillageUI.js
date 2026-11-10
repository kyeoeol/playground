import { CATEGORIES, CATALOG, renderThumbnails } from './catalog.js';
import { api } from './api.js';
import { askConfirm } from './Dialogs.js';
import { ICON, esc } from '../ui/html.js';

const TRUST_DELAY = 1500; // electron/rex.js: the trust question needs a moment to appear

const MODES = [
  { id: 'auto', label: 'Auto', tip: 'Does safe actions right away and skips risky ones' },
  { id: 'acceptEdits', label: 'Accept edits', tip: 'Edits files right away; commands follow your settings' },
  { id: 'default', label: 'Ask every time', tip: 'Asks before each tool use · approve in the Rex app' },
];

/** A little Markdown: code blocks, inline code, bold, headings, bullets. Everything is escaped first. */
function md(text) {
  const parts = String(text).split(/```[^\n]*\n?/);
  return parts.map((p, i) => {
    if (i % 2) return `<pre><code>${esc(p.replace(/\n$/, ''))}</code></pre>`;
    return esc(p)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/^#{1,6} (.+)$/gm, '<b class="h">$1</b>')
      .replace(/^(\s*)[-*] /gm, '$1• ');
  }).join('');
}

const clock = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Build menu (bottom left), the placing hint, and the chat panel of one build (right).
 */
export class VillageUI {
  constructor({ village = null, onMenu }) {
    this.village = village; // may be set later: handlers read this.village
    this.cat = 'all';
    this.openId = null;
    this._thumbs = null;

    const root = document.getElementById('ui');
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="build-tags" id="build-tags"></div>
      <div class="place-hint glass hidden" id="place-hint">
        <span id="place-name"></span>
        <span class="sep"></span>
        <span class="chip static"><kbd>Click</kbd> build</span>
        <button class="chip" id="place-rotate"><kbd>R</kbd> rotate</button>
        <button class="chip" id="place-paint"><kbd>C</kbd> recolor</button>
        <button class="chip" id="place-cancel"><kbd class="wide">Esc</kbd> cancel</button>
      </div>
      <section class="build-menu glass hidden" id="build-menu" aria-label="Build">
        <nav class="rail" id="build-rail">${CATEGORIES.map((c) => `<button data-cat="${c.id}">${c.icon}<span>${c.label}</span></button>`).join('')}</nav>
        <div class="build-list" id="build-list"></div>
      </section>
      <button class="build-btn glass" id="build-btn">${ICON.plus}<span>Build</span></button>
      <div class="decor-pop glass hidden" id="decor-pop">
        <b id="decor-name"></b>
        <button class="chip" id="decor-turn">${ICON.rotate}<span>Rotate</span></button>
        <button class="chip" id="decor-paint">${ICON.paint}<span>Recolor</span></button>
        <button class="chip danger" id="decor-remove">${ICON.trash}<span>Remove</span></button>
      </div>
      <aside class="chat glass hidden" id="chat" aria-label="Claude Code">
        <header>
          <div class="who">
            <img class="thumb" id="chat-thumb" alt="">
            <div>
              <input id="chat-name" spellcheck="false" maxlength="40" aria-label="Building name">
              <button class="path" id="chat-path" title="Open in Finder">${ICON.folder}<span></span></button>
            </div>
          </div>
          <button class="icon-btn" id="chat-close" aria-label="Close">${ICON.close}</button>
        </header>
        <div class="chat-tools">
          <div class="pick" id="chat-mode">
            <button class="pick-btn" id="chat-mode-btn" aria-haspopup="listbox" aria-expanded="false" aria-label="Permissions"><span id="chat-mode-label"></span>${ICON.chevron}</button>
            <div class="pick-menu hidden" id="chat-mode-menu" role="listbox">${MODES.map((m) => `
              <button class="pick-opt" role="option" data-mode="${m.id}"><span><b>${m.label}</b><small>${m.tip}</small></span>${ICON.check}</button>`).join('')}
            </div>
          </div>
          <span class="grow"></span>
          <button class="tool" id="chat-rex" title="View this session in the Rex app">${ICON.terminal}<span>Rex</span></button>
          <button class="tool" id="chat-new" title="New conversation (clears the previous conversation and session)">${ICON.fresh}<span>New chat</span></button>
          <button class="tool danger" id="chat-remove" title="Demolish the building">${ICON.trash}<span>Demolish</span></button>
        </div>
        <div class="msgs" id="chat-msgs"></div>
        <div class="chat-notice hidden" id="chat-notice"></div>
        <form class="composer" id="chat-form">
          <textarea id="chat-input" rows="1" placeholder="Ask anything." spellcheck="false"></textarea>
          <button type="submit" class="send" id="chat-send" aria-label="Send">${ICON.send}</button>
        </form>
      </aside>`;
    root.append(...wrap.children);
    // the prompt bar (Space by a house): where the hint above the dock shows (src/ui/UI.js)
    const ask = document.createElement('form');
    ask.className = 'ask glass hidden';
    ask.id = 'ask';
    ask.innerHTML = `<img class="thumb" id="ask-thumb" alt=""><b id="ask-name"></b>
      <input id="ask-input" spellcheck="false" autocomplete="off" aria-label="Task">
      <button type="submit" class="send" id="ask-send" aria-label="Send">${ICON.send}</button>`;
    root.querySelector('.bottom').prepend(ask);
    const $ = (id) => document.getElementById(id);
    this.$ = $;
    this.tagLayer = $('build-tags');
    root.prepend(this.tagLayer); // under the panels, menus and chat

    // ---- build menu
    $('build-btn').onclick = () => {
      const open = $('build-menu').classList.contains('hidden');
      onMenu?.(); // other panels close
      this.toggleMenu(open);
    };
    $('build-rail').onclick = (e) => {
      const b = e.target.closest('[data-cat]');
      if (b) { this.cat = b.dataset.cat; this.renderMenu(); }
    };
    $('build-list').onclick = (e) => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      this.toggleMenu(false);
      this.closeChat();
      this.village.place(b.dataset.type);
    };
    $('place-rotate').onclick = () => this.village.rotate();
    $('place-paint').onclick = () => this.village.cycleVariant();

    // ---- decoration popover
    $('decor-turn').onclick = () => this.decorId && this.village.turn(this.decorId);
    $('decor-paint').onclick = () => this.decorId && this.village.repaint(this.decorId);
    $('decor-remove').onclick = () => { if (this.decorId) { this.village.remove(this.decorId); this.closeDecor(); } };
    $('place-cancel').onclick = () => this.village.cancel();

    // ---- chat
    $('chat-close').onclick = () => this.closeChat();
    $('chat-path').onclick = () => this.openId && api.send('folder:open', { id: this.openId });
    $('chat-name').onchange = (e) => this.openId && api.send('build:update', { id: this.openId, patch: { name: e.target.value } });
    $('chat-name').onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) e.target.blur(); };
    $('chat-rex').onclick = () => this.openId && api.send('rex:open', { id: this.openId });
    $('chat-notice').onclick = (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act || !this.openId) return;
      if (act === 'trust') { e.target.closest('button').disabled = true; api.send('claude:trust', { id: this.openId }); }
      if (act === 'rex') api.send('rex:open', { id: this.openId });
    };
    // ---- permission mode: a menu in the panel's style (not the browser's select)
    this.modeHi = -1; // the option the keyboard is on
    $('chat-mode-btn').onclick = () => this.toggleModeMenu();
    $('chat-mode-menu').onclick = (e) => {
      const opt = e.target.closest('[data-mode]');
      if (opt) this.pickMode(opt.dataset.mode);
    };
    $('chat-mode-menu').onpointermove = (e) => {
      const opt = e.target.closest('[data-mode]');
      if (opt) this.hiMode(MODES.findIndex((m) => m.id === opt.dataset.mode));
    };
    addEventListener('pointerdown', (e) => { if (this.modeOpen && !e.target.closest('#chat-mode')) this.toggleModeMenu(false); }, true);
    addEventListener('keydown', (e) => {
      if (!this.modeOpen) return;
      e.stopPropagation(); // the game and the chat do not get keys while the menu is open
      if (e.key === 'Escape') { e.preventDefault(); this.toggleModeMenu(false); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = MODES.length;
        this.hiMode(((this.modeHi < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : this.modeHi) + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
      } else if ((e.key === 'Enter' || e.key === ' ') && this.modeHi >= 0) { e.preventDefault(); this.pickMode(MODES[this.modeHi].id); }
    }, true);
    $('chat-new').onclick = () => {
      const b = this.village.get(this.openId);
      if (!b || b.working) return;
      askConfirm({ title: `Start a new conversation in '${b.name}'?`, body: 'The current conversation will no longer show in this house, and a new Claude Code session will start.', ok: 'New chat' })
        .then((yes) => yes && api.send('build:update', { id: b.id, patch: { newChat: true } }));
    };
    $('chat-remove').onclick = () => {
      const b = this.village.get(this.openId);
      if (!b) return;
      askConfirm({ title: `Demolish '${b.name}'?`, body: 'The Claude Code session of this house also closes. The folder and its files stay as they are.', ok: 'Demolish', danger: true })
        .then((yes) => { if (yes) { this.closeChat(); this.village.remove(b.id); } });
    };
    const input = $('chat-input');
    const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(160, input.scrollHeight)}px`; };
    input.oninput = grow;
    input.onkeydown = (e) => {
      // Enter sends, Shift+Enter is a new line. Not while composing Korean (IME) text.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); this.submit(); }
      // Esc closes the chat, text and all (not the Esc that ends a Korean syllable)
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); this.closeChat(); }
    };
    $('chat-form').onsubmit = (e) => { e.preventDefault(); this.submit(); };
    this._grow = grow;

    // ---- prompt bar
    this.askId = null;
    this.drafts = new Map(); // house id -> text typed but not sent
    const askInput = $('ask-input');
    askInput.onkeydown = (e) => {
      if (e.isComposing || e.keyCode === 229) return; // Enter that ends a Korean syllable is typing
      if (e.key === 'Enter') { e.preventDefault(); this.sendAsk(); }
      if (e.key === 'Escape') { e.preventDefault(); this.closeAsk(); }
    };
    askInput.onblur = () => this.closeAsk(); // clicking elsewhere puts it away (the text is kept)
    ask.onsubmit = (e) => { e.preventDefault(); this.sendAsk(); };
    ask.onmousedown = (e) => { if (e.target !== askInput) e.preventDefault(); }; // keep the caret in the field
  }

  // ---------------------------------------------------------------- build menu

  toggleMenu(open) {
    const m = this.$('build-menu');
    m.classList.toggle('hidden', !open);
    this.$('build-btn').classList.toggle('on', open);
    if (open) {
      this.renderMenu();
    }
  }

  /** Catalog thumbnails (data URLs by type), rendered the first time they are needed. */
  get thumbs() { return (this._thumbs ??= renderThumbnails()); }

  renderMenu() {
    this.$('build-rail').querySelectorAll('[data-cat]').forEach((b) => b.classList.toggle('on', b.dataset.cat === this.cat));
    const items = CATALOG.filter((c) => this.cat === 'all' || c.cat === this.cat);
    const row = (c) => `
      <button class="build-item" data-type="${c.id}">
        <span class="pic">${this.thumbs[c.id] ? `<img src="${this.thumbs[c.id]}" alt="">` : ''}</span>
        <span class="txt"><b>${esc(c.name)}</b><small>${esc(c.desc)}</small></span>
      </button>`;
    const houses = items.filter((c) => c.session), decor = items.filter((c) => !c.session);
    this.$('build-list').innerHTML =
      (houses.length ? `<h4>${ICON.claude}<span>Houses · each one is a Claude Code session</span></h4>${houses.map(row).join('')}` : '')
      + (decor.length ? `<h4><span>Decorations · place several in a row</span></h4>${decor.map(row).join('')}` : '');
    this.$('build-list').scrollTop = 0;
  }

  // ---------------------------------------------------------------- prompt bar

  get asking() { return !!this.askId; }

  /** Open the prompt bar for a house (Space by it). */
  openAsk(id) {
    const b = this.village.get(id);
    if (!b) return;
    this.toggleMenu(false);
    this.closeDecor();
    this.askId = id;
    this.$('ask-thumb').src = this.thumbs[b.type] || '';
    const input = this.$('ask-input');
    input.value = this.drafts.get(id) || '';
    this.renderAsk(b);
    this.$('ask').classList.remove('hidden');
    document.getElementById('ui').classList.add('asking');
    input.focus();
  }

  closeAsk() {
    if (!this.askId) return;
    const input = this.$('ask-input');
    if (input.value.trim()) this.drafts.set(this.askId, input.value);
    else this.drafts.delete(this.askId);
    this.askId = null;
    this.$('ask').classList.add('hidden');
    document.getElementById('ui').classList.remove('asking');
    input.blur();
  }

  /** Why the house cannot take a prompt now, or '' if it can. */
  askBlocked(b) {
    if (b.working) return 'Working · write again when it is done';
    if (b.needsTrust) return 'The folder needs your trust · click the house';
    if (b.status === 'stuck') return 'Needs a check in Rex · click the house';
    if (b.status === 'starting') return 'Starting Claude Code';
    if (this.waiting(b)) return 'Waiting on the request you sent';
    return '';
  }

  renderAsk(b) {
    const why = this.askBlocked(b);
    this.$('ask-name').textContent = b.name;
    this.$('ask-input').placeholder = why || 'Ask anything.';
    this.$('ask').classList.toggle('blocked', !!why);
    this.$('ask-send').disabled = !!why;
  }

  sendAsk() {
    const b = this.askId && this.village.get(this.askId);
    const input = this.$('ask-input');
    const text = input.value.trim();
    if (!b || !text || this.askBlocked(b)) return;
    api.send('claude:send', { id: b.id, text });
    input.value = '';
    this.closeAsk();
    this.village.toast?.(`Sent to '${b.name}'`);
  }

  // ---------------------------------------------------------------- chat

  openChat(id) {
    const b = this.village.get(id);
    if (!b) return;
    this.toggleMenu(false);
    this.closeDecor();
    this.openId = id;
    this.$('chat').classList.remove('hidden');
    document.getElementById('ui').classList.add('chat-open');
    this.$('chat-thumb').src = this.thumbs[b.type] || '';
    this.renderChat(true);
    this.$('chat-input').focus();
  }

  get modeOpen() { return !this.$('chat-mode-menu').classList.contains('hidden'); }

  toggleModeMenu(open = !this.modeOpen) {
    const b = this.openId && this.village.get(this.openId);
    this.$('chat-mode-menu').classList.toggle('hidden', !open);
    this.$('chat-mode-btn').setAttribute('aria-expanded', String(open));
    this.$('chat-mode').classList.toggle('open', open);
    this.hiMode(open && b ? MODES.findIndex((m) => m.id === (b.mode || 'auto')) : -1);
  }

  hiMode(i) {
    this.modeHi = i;
    this.$('chat-mode-menu').querySelectorAll('.pick-opt').forEach((o, j) => o.classList.toggle('hi', j === i));
  }

  pickMode(mode) {
    this.toggleModeMenu(false);
    const b = this.openId && this.village.get(this.openId);
    if (!b || (b.mode || 'auto') === mode) return;
    api.send('build:update', { id: b.id, patch: { mode } });
    this.renderMode(mode); // at once; the house's update follows
  }

  renderMode(mode) {
    const m = MODES.find((x) => x.id === mode) || MODES[0];
    this.$('chat-mode-label').textContent = m.label;
    this.$('chat-mode-btn').title = m.tip;
    this.$('chat-mode-menu').querySelectorAll('.pick-opt').forEach((o) => o.classList.toggle('on', o.dataset.mode === m.id));
  }

  closeChat() {
    this.toggleModeMenu(false);
    const input = this.$('chat-input');
    if (document.activeElement === input) input.blur();
    input.value = ''; // closing drops what was being typed
    this._grow?.();
    this.openId = null;
    this.$('chat').classList.add('hidden');
    document.getElementById('ui').classList.remove('chat-open');
  }


  submit() {
    const b = this.village.get(this.openId);
    const input = this.$('chat-input');
    const text = input.value.trim();
    if (!b) return;
    if (b.working) { api.send('claude:stop', { id: b.id }); return; }
    if (!text || this.waiting(b)) return;
    api.send('claude:send', { id: b.id, text });
    input.value = '';
    this._grow();
  }

  /** A prompt cannot go in yet: Claude Code is starting, asking something, or one is queued. */
  waiting(b) {
    return b.status === 'starting' || b.status === 'stuck' || b.needsTrust || b.messages.some((m) => m.queued);
  }

  /** The bar over the input: what the house's Claude Code waits for, with what to do. */
  renderNotice(b) {
    const el = this.$('chat-notice');
    const rexBtn = `<button class="chip" data-act="rex">${ICON.terminal}<span>View in Rex</span></button>`;
    let html = '';
    if (api.isApp && this.village.rex === null) {
      html = '<p>Could not find the rex command. Install Rex to run Claude Code in a Rex session for each house.</p>';
    } else if (b.needsTrust) {
      const ready = Date.now() - (b.launchedAt || 0) >= TRUST_DELAY;
      html = `<p><b>This folder is new to Claude Code.</b> Claude Code asks whether to trust this folder. Start only if you made the folder or you trust it.</p>
        <div class="acts"><button class="chip primary" data-act="trust"${ready ? '' : ' disabled'}>Trust and start</button>${rexBtn}</div>`;
    } else if (b.status === 'blocked') {
      html = `<p><b>Claude Code is waiting for your approval.</b>${b.blocked?.msg ? ` ${esc(b.blocked.msg)}` : ''} Answer in the Rex app.</p><div class="acts">${rexBtn}</div>`;
    } else if (b.status === 'stuck') {
      html = `<p><b>Claude Code is waiting for something in the terminal.</b> Check the Rex app.</p><div class="acts">${rexBtn}</div>`;
    } else if (b.notice?.text) {
      html = `<p>${esc(b.notice.text)}</p>`;
    }
    if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
    el.classList.toggle('hidden', !html);
  }

  /** Redraw the open chat (after any change to its build). */
  renderChat(scroll = false) {
    const b = this.village.get(this.openId);
    if (!b) { this.closeChat(); return; }
    const $ = this.$;
    if (document.activeElement !== $('chat-name')) $('chat-name').value = b.name;
    // home as ~, and only the last folders when the path is long
    const parts = b.cwd.replace(/^\/Users\/[^/]+/, '~').split('/');
    $('chat-path').querySelector('span').textContent = parts.length > 4 ? `…/${parts.slice(-3).join('/')}` : parts.join('/');
    $('chat-path').title = `${b.cwd}\nOpen in Finder`;
    this.renderMode(b.mode || 'auto');
    $('chat-new').disabled = !!b.working || b.status === 'starting';
    this.renderNotice(b);

    const msgs = $('chat-msgs');
    const atBottom = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 40;
    const noClaude = this.village.claude === null && api.isApp;
    const empty = !b.messages.length ? `
      <div class="empty">
        <p>Claude Code lives in <b>${esc(b.name)}</b>.</p>
        <p>Send it a task. It works in this folder and tells you the result when it is done.</p>
        <p>Tasks run on the Rex server, so they continue when you quit this app, and you can see the same session in the Rex app.</p>
        ${noClaude ? '<p class="warn">Could not find the claude command. Check that <code>claude --version</code> works in a terminal.</p>' : ''}
      </div>` : '';
    const busy = b.working || b.status === 'starting';
    const key = `${b.messages.length}|${b.status}|${b.working}|${b.messages.at(-1)?.at}|${b.messages.at(-1)?.queued}`;
    if (key !== this.chatKey || scroll) {
      this.chatKey = key;
      msgs.innerHTML = empty + b.messages.map((m) => m.role === 'user'
        ? `<div class="msg user${m.queued ? ' queued' : ''}">${esc(m.text)}</div>`
        : `<div class="msg claude${m.error ? ' error' : ''}"><div class="body">${md(m.text)}</div>${m.ms ? `<small>took ${clock(m.ms)}</small>` : ''}</div>`).join('')
        + (busy ? `<div class="msg working"><span class="bricks"><i></i><i></i><i></i></span><span>${b.status === 'starting' ? 'Starting' : 'Working'}</span>${b.working ? `<small id="chat-elapsed">${clock(Date.now() - (b.startedAt || Date.now()))}</small>` : ''}</div>` : '');
      if (scroll || atBottom || busy) msgs.scrollTop = msgs.scrollHeight;
    }
    $('chat-send').innerHTML = b.working ? ICON.stop : ICON.send;
    $('chat-send').classList.toggle('stop', !!b.working);
    $('chat-send').setAttribute('aria-label', b.working ? 'Stop' : 'Send');
    $('chat-send').disabled = !b.working && this.waiting(b);
    // the answer is on screen: it is read
    if (b.unread && !b.working) api.send('build:update', { id: b.id, patch: { unread: false } });
  }

  /** Called when the village changes (a build added, changed or removed). */
  changed(id) {
    if (this.openId && (!id || id === this.openId)) this.renderChat();
    if (this.askId && (!id || id === this.askId)) {
      const b = this.village.get(this.askId);
      if (b) this.renderAsk(b); else this.closeAsk(); // the house was pulled down
    }
    const v = this.village;
    this.$('place-hint').classList.toggle('hidden', !v.placing);
    if (v.placing) {
      this.$('place-name').textContent = v.ghost.item.name;
      this.$('place-paint').classList.toggle('hidden', v.ghost.item.variants < 2);
    }
    if (this.decorId && !v.get(this.decorId)) this.closeDecor();
    if (this.decorId) this.$('decor-paint').classList.toggle('hidden', !(v.builds.get(this.decorId)?.item.variants > 1));
    document.getElementById('ui').classList.toggle('placing', v.placing);
  }

  // ---------------------------------------------------------------- decorations

  openDecor(id) {
    const b = this.village.builds.get(id);
    if (!b) return;
    this.toggleMenu(false);
    this.closeChat();
    this.decorId = id;
    this.$('decor-name').textContent = b.item.name;
    this.$('decor-pop').classList.remove('hidden');
    this.changed(id);
    this.update();
  }

  closeDecor() {
    this.decorId = null;
    this.$('decor-pop').classList.add('hidden');
  }

  update() {
    if (this.decorId) { // the popover sits over its decoration
      const b = this.village.builds.get(this.decorId);
      if (b) {
        const { x, y } = this.village.screenOf(b.top);
        this.$('decor-pop').style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      }
    }
    const b = this.openId && this.village.get(this.openId);
    if (b?.needsTrust && Date.now() - (b.launchedAt || 0) >= TRUST_DELAY) this.renderNotice(b); // the trust button turns on
    const el = b?.working && document.getElementById('chat-elapsed');
    if (el) {
      const t = clock(Date.now() - (b.startedAt || Date.now()));
      if (el.textContent !== t) el.textContent = t;
    }
  }
}
