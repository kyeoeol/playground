import * as THREE from 'three';
import { clamp, lerp } from '../core/rand.js';
import { fromSW } from './coords.js';

/**
 * Swiss pistes use the European colour scale: blue (easy), red (intermediate),
 * black (difficult). Control points are (s, w) — see coords.js — running from
 * the top station down to the valley.
 */
export const PISTE_DEFS = [
  {
    id: 1, name: 'Piste 1', level: 0, color: 'blue', hex: '#2c6be0', width: 5,
    sw: [[6.5, 4], [13.8, 0], [21.1, 4], [28.4, 0], [35.8, 3.5], [43, -1], [50.4, 3], [57.6, 0], [66.5, 1]],
  },
  {
    id: 2, name: 'Piste 2', level: 1, color: 'red', hex: '#e0362f', width: 4,
    sw: [[5.9, -1], [11, -7], [18.3, -13], [25.6, -10], [32.9, -17], [40.1, -12], [47.5, -18], [54.8, -14], [66.5, -12]],
  },
  {
    id: 3, name: 'Piste 3', level: 2, color: 'black', hex: '#1d1f26', width: 3.4,
    sw: [[8, 12.5], [15, 10], [22, 12.5], [29, 10], [36, 12.8], [43, 10.2], [50, 12.5], [57, 10.5], [66.5, 11]],
  },
];

export class Piste {
  constructor(def) {
    Object.assign(this, def);
    this.half = def.width / 2;
    const curve = new THREE.CatmullRomCurve3(
      def.sw.map(([s, w]) => { const p = fromSW(s, w); return new THREE.Vector3(p.x, 0, p.z); }), false, 'centripetal',
    );
    this.length = curve.getLength();
    const n = Math.ceil(this.length / 0.4);
    this.step = this.length / n;
    const pts = curve.getSpacedPoints(n);
    this.n = pts.length;
    this.x = new Float32Array(this.n);
    this.z = new Float32Array(this.n);
    this.tx = new Float32Array(this.n);
    this.tz = new Float32Array(this.n);
    pts.forEach((p, i) => { this.x[i] = p.x; this.z[i] = p.z; });
    for (let i = 0; i < this.n; i++) {
      const a = Math.max(0, i - 1), b = Math.min(this.n - 1, i + 1);
      const dx = this.x[b] - this.x[a], dz = this.z[b] - this.z[a];
      const l = Math.hypot(dx, dz) || 1;
      this.tx[i] = dx / l;
      this.tz[i] = dz / l;
    }
  }

  /**
   * Sample the centre line at distance s. Fills `out` with x, z,
   * tangent (tx, tz) and right-hand normal (nx, nz).
   */
  sample(s, out) {
    const f = clamp(s / this.step, 0, this.n - 1.0001);
    const i = Math.floor(f), t = f - i;
    const L = (arr) => lerp(arr[i], arr[i + 1], t);
    out.x = L(this.x);
    out.z = L(this.z);
    const tx = L(this.tx), tz = L(this.tz);
    const l = Math.hypot(tx, tz) || 1;
    out.tx = tx / l;
    out.tz = tz / l;
    out.nx = -out.tz;
    out.nz = out.tx;
    return out;
  }
}

export class Pistes {
  constructor() {
    this.list = PISTE_DEFS.map((d) => new Piste(d));
  }

  /** Nearest piste to a point (distance to its centre line, in world units). */
  nearest(x, z) {
    let best = { dist: Infinity, half: 0, piste: null };
    for (const p of this.list) {
      for (let i = 0; i < p.n; i += 2) {
        const d = Math.hypot(p.x[i] - x, p.z[i] - z);
        if (d - p.half < best.dist - best.half) best = { dist: d, half: p.half, piste: p };
      }
    }
    return best;
  }
}
