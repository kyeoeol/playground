const ICONS = {
  sun: '<span class="orb"></span>',
  sunset: '<span class="orb orb-low"></span>',
  moon: '<svg viewBox="0 0 48 48" class="glyph"><path d="M31 6a18 18 0 1 0 11 27A15 15 0 0 1 31 6Z" fill="currentColor"/></svg>',
  cloud: '<svg viewBox="0 0 64 48" class="glyph wide"><path d="M18 40a12 12 0 0 1-2-24 16 16 0 0 1 31-1 12.5 12.5 0 0 1 1 25Z" fill="currentColor"/></svg>',
  rain: '<svg viewBox="0 0 64 48" class="glyph wide"><path d="M18 30a10 10 0 0 1-2-20 14 14 0 0 1 28-1 10.5 10.5 0 0 1 1 21Z" fill="currentColor"/><path d="M20 35l-2 7M32 35l-2 7M44 35l-2 7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
};

/** The sky panel and its toggle button. */
export class Ui {
  constructor(sky) {
    this.sky = sky;
    this.shown = {};
    const $ = (id) => document.getElementById(id);
    this.el = {
      panel: $('sky-panel'), toggle: $('sky-toggle'), toggleIcon: $('sky-toggle-icon'),
      timeIcon: $('time-icon'), timeLabel: $('time-label'), clock: $('clock'),
      weatherIcon: $('weather-icon'), weatherLabel: $('weather-label'),
    };
    this.el.toggle.addEventListener('click', () => this.togglePanel());
    $('sky-close').addEventListener('click', () => this.togglePanel(false));
    $('time-prev').addEventListener('click', () => sky.stepTime(-1));
    $('time-next').addEventListener('click', () => sky.stepTime(1));
    $('weather-prev').addEventListener('click', () => sky.stepWeather(-1));
    $('weather-next').addEventListener('click', () => sky.stepWeather(1));
    $('follow-day').addEventListener('change', (e) => { sky.followDay = e.target.checked; });
    $('auto-weather').addEventListener('change', (e) => { sky.autoWeather = e.target.checked; });
  }

  togglePanel(force) {
    const { panel, toggle } = this.el;
    const open = force ?? panel.hidden;
    panel.hidden = !open;
    toggle.setAttribute('aria-pressed', open);
  }

  /** Mirrors sky state into the panel; only touches the DOM when something changed. */
  update() {
    const { sky, el, shown } = this;
    const time = sky.timeLabel();
    if (shown.time !== time.id) {
      shown.time = time.id;
      el.timeLabel.textContent = time.label;
      el.timeIcon.innerHTML = ICONS[time.icon];
      el.toggleIcon.innerHTML = ICONS[time.icon];
    }
    const clockText = sky.clockText();
    if (shown.clock !== clockText) {
      shown.clock = clockText;
      el.clock.textContent = clockText;
    }
    if (shown.weather !== sky.weather.id) {
      shown.weather = sky.weather.id;
      el.weatherLabel.textContent = sky.weather.label;
      el.weatherIcon.innerHTML = ICONS[sky.weather.icon];
    }
  }
}
