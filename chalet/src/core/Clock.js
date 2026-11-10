/**
 * In-game clock. One ski day lasts 24 real minutes, so one real second is
 * one in-game minute (at time scale 1).
 */
export const TIME_PRESETS = [
  { label: 'Dawn', hour: 6.6 },
  { label: 'Morning', hour: 9.0 },
  { label: 'Midday', hour: 12.5 },
  { label: 'Afternoon', hour: 15.0 },
  { label: 'Golden hour', hour: 17.3 },
  { label: 'Evening', hour: 19.6 },
  { label: 'Night', hour: 23.0 },
];

export class Clock {
  constructor(startHour = 9) {
    this.minutes = startHour * 60;
    this.follow = true; // "Follow the day": when false, the sky is frozen
  }

  /** dt in real seconds (already multiplied by time scale). */
  update(dt) {
    if (!this.follow) return;
    this.minutes = (this.minutes + dt) % 1440;
  }

  setHour(h) {
    this.minutes = ((h % 24) + 24) % 24 * 60;
  }

  get hour() {
    return this.minutes / 60;
  }

  get label() {
    const m = Math.floor(this.minutes);
    const hh = String(Math.floor(m / 60)).padStart(2, '0');
    const mm = String(m % 60).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /** Index of the preset closest to the current hour. */
  get presetIndex() {
    const h = this.hour;
    let best = 0, bestD = Infinity;
    TIME_PRESETS.forEach((p, i) => {
      let d = Math.abs(p.hour - h);
      d = Math.min(d, 24 - d);
      if (d < bestD) { bestD = d; best = i; }
    });
    return best;
  }

  between(a, b) {
    const h = this.hour;
    return a <= b ? h >= a && h < b : h >= a || h < b;
  }
}
