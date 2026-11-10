import { TIME_PRESETS } from '../core/Clock.js';
import { WEATHERS } from '../world/Environment.js';
import { LIFT_HOURS } from '../world/Lift.js';
import { KMH } from '../agents/Player.js';
import { rand, randInt } from '../core/rand.js';
import { ICON } from './html.js';

/** Short weather names for the picker (the full labels are too wide). */
const WEATHER_NAME = { clear: 'Clear', snow: 'Snow', storm: 'Blizzard', fog: 'Fog' };

const ARROWS = ['↑', '←', '↓', '→'];

const caps = (ks) => `<span class="keys">${ks.map((k) => `<kbd${k.length > 1 ? ' class="wide"' : ''}>${k}</kbd>`).join('')}</span>`;

/** Glass dock + panels, in the spirit of a cosy diorama toy. */
export class UI {
  constructor({ clock, world, player, onZoom, onRestart }) {
    this.clock = clock;
    this.world = world;
    this.player = player;
    this.timeScale = 1;
    this.weatherIdx = 0;
    this.autoWeather = false;
    this.weatherTimer = 0;

    const root = document.getElementById('ui');
    root.innerHTML = `
      <header class="hud glass">
        <div class="brand"><h1>Chalet</h1></div>
        <dl class="stats">
          <div><dt>Time</dt><dd id="s-time">09:00</dd></div>
          <div><dt>Runs</dt><dd id="s-runs">0</dd></div>
          <div><dt>Top</dt><dd id="s-top">0<small>km/h</small></dd></div>
        </dl>
      </header>
      <div class="speedo glass hidden" id="speedo"><b id="s-speed">0</b><small>km/h</small></div>
      <div class="toasts" id="toasts"></div>

      <section class="panel glass hidden" id="p-sky" aria-label="Sky">
        <header><h2>Changing sky</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></header>
        <div class="cols">
          <div class="col">
            <h3>Time of day</h3>
            <canvas class="orb" id="orb-time" width="48" height="48"></canvas>
            <div class="picker"><button class="icon-btn" id="t-prev" aria-label="Previous time of day">${ICON.prev}</button><strong id="t-label">Morning</strong><button class="icon-btn" id="t-next" aria-label="Next time of day">${ICON.next}</button></div>
            <label class="switch"><span>Time flows</span><input type="checkbox" id="t-flow" checked><i></i></label>
          </div>
          <div class="col">
            <h3>Weather</h3>
            <canvas class="orb" id="orb-weather" width="48" height="48"></canvas>
            <div class="picker"><button class="icon-btn" id="w-prev" aria-label="Previous weather">${ICON.prev}</button><strong id="w-label">Clear</strong><button class="icon-btn" id="w-next" aria-label="Next weather">${ICON.next}</button></div>
            <label class="switch"><span>Weather changes on its own</span><input type="checkbox" id="w-auto"><i></i></label>
          </div>
        </div>
        <footer>A day at the resort lasts 24 minutes. The lift runs ${LIFT_HOURS.label}.</footer>
      </section>

      <section class="panel glass hidden" id="p-help" aria-label="Controls">
        <header><h2>Controls</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></header>
        <div class="help">
          <h3>Walking</h3>
          <p>${caps(ARROWS)}<span>Walk</span></p>
          <h3>Lift · E</h3>
          <p>${caps(['E'])}<span>Board the lift at the station (moving while in the queue leaves it)</span></p>
          <p>${caps(['Auto'])}<span>You get off automatically at the top</span></p>
          <p>${caps(['Auto'])}<span>Your bindings strap in automatically at the top</span></p>
          <p>${caps(['Auto'])}<span>Your bindings come off when you stop at the bottom</span></p>
          <h3>Riding</h3>
          <p>${caps(ARROWS)}<span>Press the direction you want to go</span></p>
          <p>${caps(['Shift'])}<span>Tuck for more speed</span></p>
          <p>${caps(['Space'])}<span>Jump · spin with ← → in the air</span></p>
          <h3>Camera</h3>
          <p>${caps(['Drag'])}<span>Pan the view</span></p>
          <p>${caps(['F'])}<span>Reset a dragged view</span></p>
          <p>${caps(['Zoom in · out'])}<span>Zoom in or out one step (zoom all the way out for the full map)</span></p>
        </div>
      </section>

      <div class="bottom">
        <div class="prompt glass empty" id="prompt">
          <span class="spinner hidden" id="climb" role="status" aria-label="Lift"></span>
          <span class="hint" id="hint"></span>
          <span class="acts" id="acts"></span>
        </div>
        <nav class="dock glass" aria-label="Controls">
          <button class="dock-btn" id="b-zoom-in" data-tip="Zoom in">${ICON.zoomIn}</button>
          <button class="dock-btn" id="b-zoom-out" data-tip="Zoom out">${ICON.zoomOut}</button>
          <button class="dock-btn" id="b-sky" data-tip="Sky">${ICON.sky}</button>
          <button class="dock-btn" id="b-restart" data-tip="Restart">${ICON.restart}</button>
          <button class="dock-btn" id="b-help" data-tip="Controls">${ICON.more}</button>
        </nav>
      </div>`;

    const els = new Map(); // the HUD markup is built once, so lookups can be cached
    const $ = (id) => {
      if (!els.has(id)) els.set(id, document.getElementById(id));
      return els.get(id);
    };
    this.$ = $;

    // one zoom level per click; the last zoom-out level is the whole map
    $('b-zoom-in').onclick = () => onZoom(-1);
    $('b-zoom-out').onclick = () => onZoom(1);
    $('b-restart').onclick = () => { this.closePanels(); onRestart(); };
    $('b-sky').onclick = () => this.togglePanel('p-sky');
    $('b-help').onclick = () => this.togglePanel('p-help');
    root.querySelectorAll('[data-close]').forEach((b) => (b.onclick = () => this.closePanels()));
    $('acts').onclick = (e) => {
      const k = e.target.closest('[data-key]')?.dataset.key;
      if (k === 'E') player.action();
    };

    const stepTime = (d) => {
      const n = TIME_PRESETS.length;
      clock.setHour(TIME_PRESETS[(clock.presetIndex + d + n) % n].hour);
    };
    $('t-prev').onclick = () => stepTime(-1);
    $('t-next').onclick = () => stepTime(1);
    $('t-flow').onchange = (e) => (clock.follow = e.target.checked);
    $('w-prev').onclick = () => this.setWeather(this.weatherIdx - 1);
    $('w-next').onclick = () => this.setWeather(this.weatherIdx + 1);
    $('w-auto').onchange = (e) => { this.autoWeather = e.target.checked; this.weatherTimer = 60; };

    // buttons should not keep keyboard focus (Space would press them again); text fields must
    const typing = (el) => el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && /^(text|search|)$/.test(el.type));
    root.addEventListener('pointerup', () => { const el = document.activeElement; if (!typing(el)) el?.blur?.(); });
    this.drawOrbs();
  }

  setWeather(i) {
    const n = WEATHERS.length;
    this.weatherIdx = ((i % n) + n) % n;
    this.world.env.setWeather(WEATHERS[this.weatherIdx].id);
    this.drawOrbs();
  }

  togglePanel(id) {
    const open = this.$(id).classList.contains('hidden');
    this.closePanels();
    if (open) {
      document.getElementById('ui').classList.add('panel-open');
      this.$(id).classList.remove('hidden');
      this.$(id === 'p-sky' ? 'b-sky' : 'b-help').classList.add('on');
    }
  }

  closePanels() {
    document.getElementById('ui').classList.remove('panel-open');
    ['p-sky', 'p-help'].forEach((id) => this.$(id).classList.add('hidden'));
    ['b-sky', 'b-help'].forEach((id) => this.$(id).classList.remove('on'));
  }

  /** Level 0 is the play view, max the whole map; a button is off at its end. */
  setZoom(level, max) {
    this.$('b-zoom-in').disabled = level <= 0;
    this.$('b-zoom-out').disabled = level >= max;
  }

  toast(text) {
    const el = document.createElement('div');
    el.className = 'toast glass';
    el.textContent = text;
    this.$('toasts').replaceChildren(el);
    setTimeout(() => el.classList.add('out'), 1700);
    setTimeout(() => el.remove(), 2200);
  }

  /** Little dithered spheres, like pixel-art planets: the sun/moon and the weather. */
  drawOrbs() {
    const preset = TIME_PRESETS[this.clock.presetIndex].label;
    const weather = WEATHERS[this.weatherIdx].id;
    const tint = { Dawn: '#ffc9b0', Morning: '#fff4dc', Midday: '#ffffff', Afternoon: '#fff1d0', 'Golden hour': '#ffbf73', Evening: '#c9b6ff', Night: '#dfe8ff' }[preset];
    orb(this.$('orb-time'), tint, preset === 'Night' || preset === 'Evening' ? 'moon' : 'sun');
    orb(this.$('orb-weather'), { clear: '#ffffff', snow: '#e6efff', storm: '#a9b3c4', fog: '#e9e9e9' }[weather], weather);
    this.orbKey = preset + weather;
  }

  update(dt) {
    const { clock, player: p, $ } = this;

    // write only what changed: each write restyles the blurred HUD panels
    const text = (node, v) => { v = String(v); if (node.textContent !== v) node.textContent = v; };
    text($('s-time'), clock.label);
    text($('s-runs'), p.stats.runs);
    text($('s-top').firstChild, Math.round(p.stats.top));
    const riding = p.state === 'ride' || p.state === 'air';
    $('speedo').classList.toggle('hidden', !riding);
    if (riding) text($('s-speed'), Math.round(p.speed * KMH));

    const preset = TIME_PRESETS[clock.presetIndex].label, weather = WEATHERS[this.weatherIdx].id;
    text($('t-label'), preset);
    text($('w-label'), WEATHER_NAME[weather]);
    if (this.orbKey !== preset + weather) this.drawOrbs();

    if (this.autoWeather && (this.weatherTimer -= dt) <= 0) {
      this.weatherTimer = rand(70, 150);
      this.setWeather(this.weatherIdx + randInt(1, WEATHERS.length - 1));
    }

    // prompt: what to do now
    const acts = p.actions;
    const actKey = acts.map((a) => a.key + a.label).join('|');
    // a new hint fades in (the lift ride's two notes take turns)
    if ($('hint').textContent !== p.hint) {
      $('hint').textContent = p.hint;
      $('hint').classList.remove('swap');
      void $('hint').offsetWidth; // restart the animation
      $('hint').classList.add('swap');
    }
    $('climb').classList.toggle('hidden', p.state !== 'lift' && p.state !== 'queue'); // waiting in line or riding up: a spinner beside the hint
    if (actKey !== this.actKey) {
      this.actKey = actKey;
      $('acts').innerHTML = acts.map((a) => `<button class="act key-${a.key.toLowerCase()}${a.label ? '' : ' bare'}" data-key="${a.key}"><kbd>${a.key}</kbd>${a.label ? `<span>${a.label}</span>` : ''}</button>`).join('');
    }
    $('prompt').classList.toggle('empty', !p.hint && !acts.length);
    $('prompt').classList.toggle('solo', !acts.length);

    while (p.events.length) this.toast(p.events.shift());
  }
}

/** Bayer-dithered shaded sphere on a tiny canvas. */
function orb(canvas, color, kind) {
  const g = canvas.getContext('2d');
  const S = canvas.width, c = S / 2, R = S * 0.3;
  const B = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  g.clearRect(0, 0, S, S);
  const [r0, g0, b0] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5 - c) / R, dy = (y + 0.5 - c) / R, d2 = dx * dx + dy * dy;
    const th = B[(y % 4) * 4 + (x % 4)] / 16;
    let a = 0, shade = 1;
    if (d2 <= 1) {
      const nz = Math.sqrt(1 - d2);
      shade = 0.55 + 0.45 * Math.max(0, -0.45 * dx - 0.55 * dy + 0.7 * nz);
      if (kind === 'moon') { const mx = dx - 0.45, my = dy + 0.2; if (mx * mx + my * my < 0.8) shade *= 0.35; }
      a = 1;
      if (shade < 0.62 + th * 0.3) shade *= 0.82; // dithered terminator
    } else {
      // soft dithered glow, or bands of mist
      const glow = Math.max(0, 1 - (Math.sqrt(d2) - 1) / 0.9);
      if (kind === 'fog' || kind === 'storm') {
        const band = Math.abs(Math.sin((dy + 0.2) * 5.5));
        a = band < 0.25 && Math.abs(dx) < 1.7 && dy > -0.2 && th < 0.6 ? 0.7 : glow * glow > th + 0.3 ? 0.25 : 0;
      } else a = glow * glow * 0.9 > th + 0.12 ? 0.28 : 0;
    }
    if ((kind === 'snow' || kind === 'storm') && d2 > 0.2) {
      const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      if (h % (kind === 'storm' ? 23 : 41) === 0 && y > c - R * 0.2) { a = 1; shade = 1.1; }
    }
    if (a === 0) continue;
    g.fillStyle = `rgba(${Math.min(255, r0 * shade) | 0},${Math.min(255, g0 * shade) | 0},${Math.min(255, b0 * shade) | 0},${a})`;
    g.fillRect(x, y, 1, 1);
  }
}
