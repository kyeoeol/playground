import * as THREE from 'three';
import { fbm, hash2 as hash } from '../core/noise.js';
import { clamp, lerp, smoothstep } from '../core/rand.js';
import { toSW, HALF } from './coords.js';
import { SNOW, ICE, TEAL, STONE, canvasTex, pixelTexture } from './pixelArt.js';
import { indexedGeo } from './meshKit.js';

/**
 * Tile terrain, like a diorama: an NX×NZ grid of 1-unit tiles.
 * The mountain is a smooth ramp; the valley is flat with stepped levels
 * (a sunken creek, a raised stone patio) that get crisp vertical walls.
 */
export const W = 56; // length of edges AB / CD
export const D = 105; // from edge AB (ridge) to edge CD (village)
export const NX = W;
export const NZ = D;
export const BOTTOM = -3;
export const SLOPE_END = 64; // s where the slope meets the valley floor
export const LEVEL = 0.45; // height of one terrain step
export const PX = 16; // ground-texture pixels per tile: 1 texel = 1 art pixel (16 px per unit)

export const K = { SNOW: 0, PISTE: 1, ROCK: 2, PATH: 3, PATIO: 4, PLOT: 5, CREEK: 6, BANK: 7 };
const RAGGED = new Set([K.SNOW, K.PISTE, K.ROCK, K.PATH, K.PLOT, K.BANK]);

/** Flattened ground on the slope (top station). */
export const PADS = [{ s: 5.5, w: 13.5, r: 3.4 }];

function mountain(s, w) {
  // ridge along edge AB (s = 0), falling toward the valley
  const t = clamp((SLOPE_END - s) / (SLOPE_END - 1));
  let h = 28 * Math.pow(t, 1.15);
  h += (0.4 + 3.5 * t) * (w / HALF) ** 2; // valley: the sides rise
  h += Math.max(0, 6.5 - Math.hypot(s - 0.5, w * 0.55) * 1.25); // the summit, mid-ridge
  return h;
}

export class Terrain {
  constructor(pistes) {
    this.corner = new Float32Array((NX + 1) * (NZ + 1));
    this.level = new Int8Array(NX * NZ);
    this.kind = new Uint8Array(NX * NZ);
    this.pisteDist = new Float32Array(NX * NZ);

    for (let j = 0; j <= NZ; j++) {
      for (let i = 0; i <= NX; i++) {
        const { s, w } = toSW(i, j);
        let h = mountain(s, w); // the whole slope is smooth snow: no bumps
        for (const p of PADS) {
          const dd = Math.hypot(s - p.s, w - p.w);
          if (dd < p.r + 3) h = lerp(h, mountain(p.s, p.w), 1 - smoothstep(p.r, p.r + 3, dd));
        }
        h = lerp(h, 0, smoothstep(SLOPE_END - 2, SLOPE_END + 1, s));
        this.corner[j * (NX + 1) + i] = h;
      }
    }
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const near = pistes.nearest(i + 0.5, j + 0.5);
        this.pisteDist[j * NX + i] = near.dist - near.half;
        const { s } = toSW(i + 0.5, j + 0.5);
        let k = K.SNOW;
        if (near.dist < near.half && s < SLOPE_END + 1.5) k = K.PISTE; // no rock outcrops: a clean slope
        this.kind[j * NX + i] = k;
      }
    }
  }

  /** Set a tile's kind and step level (layout phase, before build()). */
  set(i, j, kind, level = null) {
    if (i < 0 || j < 0 || i >= NX || j >= NZ) return;
    this.kind[j * NX + i] = kind;
    if (level != null) this.level[j * NX + i] = level;
  }

  /** Paint every tile whose centre satisfies fn(s, w, x, z). */
  fill(fn, kind, level = null) {
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) {
      const x = i + 0.5, z = j + 0.5;
      const { s, w } = toSW(x, z);
      if (fn(s, w, x, z)) this.set(i, j, kind, level);
    }
  }

  kindAt(x, z) {
    const i = clamp(Math.floor(x), 0, NX - 1), j = clamp(Math.floor(z), 0, NZ - 1);
    return this.kind[j * NX + i];
  }

  /** Corner height of tile (i, j) including its step level. */
  _c(i, j, ci, cj) {
    return this.corner[cj * (NX + 1) + ci] + this.level[j * NX + i] * LEVEL;
  }

  /** Exact height on the rendered surface. */
  heightAt(x, z) {
    x = clamp(x, 0, NX - 1e-4);
    z = clamp(z, 0, NZ - 1e-4);
    const i = Math.floor(x), j = Math.floor(z);
    return this.heightIn(i, j, x - i, z - j);
  }

  /** Height on the surface of tile (i, j) at (fx, fz) in 0…1 inside it (its own edges included). */
  heightIn(i, j, fx, fz) {
    const h00 = this._c(i, j, i, j), h10 = this._c(i, j, i + 1, j);
    const h01 = this._c(i, j, i, j + 1), h11 = this._c(i, j, i + 1, j + 1);
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }

  gradient(x, z, e = 0.45) {
    return {
      x: (this.heightAt(x + e, z) - this.heightAt(x - e, z)) / (2 * e),
      z: (this.heightAt(x, z + e) - this.heightAt(x, z - e)) / (2 * e),
    };
  }

  /** Build meshes and the ground texture once the layout is final. */
  build() {
    this._paintGround();
    this.mesh = this._buildSurface();
    this.walls = this._buildWalls();
    this.sides = this._buildSides();
    const g = new THREE.Group();
    g.add(this.mesh, this.walls, this.sides);
    this.group = g;
    return g;
  }

  _buildSurface() {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const b = pos.length / 3;
        for (const [ci, cj] of [[i, j], [i + 1, j], [i, j + 1], [i + 1, j + 1]]) {
          pos.push(ci, this._c(i, j, ci, cj), cj);
          uv.push(ci / NX, 1 - cj / NZ);
        }
        idx.push(b, b + 2, b + 1, b + 2, b + 3, b + 1);
      }
    }
    const geo = indexedGeo(pos, uv, idx);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.groundTex, flatShading: true, roughness: 0.95 }));
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    return mesh;
  }

  /** Vertical faces between neighbouring tiles at different step levels. */
  _buildWalls() {
    const pos = [], uv = [], idx = [];
    const quad = (ax, az, bx, bz, a0, a1, b0, b1) => {
      // edge from (ax,az) to (bx,bz); a0/b0 = upper heights, a1/b1 = lower heights
      const k = pos.length / 3;
      pos.push(ax, a0, az, bx, b0, bz, ax, a1, az, bx, b1, bz);
      const u0 = ax + az, u1 = bx + bz;
      uv.push(u0 / 2, a0 / 2, u1 / 2, b0 / 2, u0 / 2, a1 / 2, u1 / 2, b1 / 2);
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    };
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        if (i + 1 < NX && this.level[j * NX + i] !== this.level[j * NX + i + 1]) {
          const a0 = this._c(i, j, i + 1, j), b0 = this._c(i, j, i + 1, j + 1);
          const a1 = this._c(i + 1, j, i + 1, j), b1 = this._c(i + 1, j, i + 1, j + 1);
          quad(i + 1, j, i + 1, j + 1, a0, a1, b0, b1);
        }
        if (j + 1 < NZ && this.level[j * NX + i] !== this.level[(j + 1) * NX + i]) {
          const a0 = this._c(i, j, i, j + 1), b0 = this._c(i, j, i + 1, j + 1);
          const a1 = this._c(i, j + 1, i, j + 1), b1 = this._c(i, j + 1, i + 1, j + 1);
          quad(i, j + 1, i + 1, j + 1, a0, a1, b0, b1);
        }
      }
    }
    const geo = indexedGeo(pos, uv, idx);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: stoneWallTexture(), flatShading: true, side: THREE.DoubleSide }));
    m.receiveShadow = true;
    return m;
  }

  /** The diorama's cut sides: snow lip on top, layered soil, ragged pixel bottom. */
  _buildSides() {
    const edges = [
      { n: NX, cells: (k) => [k, 0], a: (k) => [k, 0], b: (k) => [k + 1, 0] },
      { n: NX, cells: (k) => [k, NZ - 1], a: (k) => [k, NZ], b: (k) => [k + 1, NZ] },
      { n: NZ, cells: (k) => [0, k], a: (k) => [0, k], b: (k) => [0, k + 1] },
      { n: NZ, cells: (k) => [NX - 1, k], a: (k) => [NX, k], b: (k) => [NX, k + 1] },
    ];
    const LIP = 0.35, JAG = 0.75;
    // three bands per column, each with its own texture so nothing repeats oddly
    const bands = [
      { top: (t) => t, bot: (t) => t - LIP, v: (y, t) => 1 - (t - y) / LIP, tex: lipTexture() },
      { top: (t) => t - LIP, bot: () => BOTTOM + JAG, v: (y) => (y - BOTTOM) / 2, tex: soilTexture() },
      { top: () => BOTTOM + JAG, bot: () => BOTTOM, v: (y) => (y - BOTTOM) / JAG, tex: jagTexture(), alpha: true },
    ];
    const group = new THREE.Group();
    for (const band of bands) {
      const pos = [], uv = [], idx = [];
      for (const e of edges) {
        for (let k = 0; k < e.n; k++) {
          const [i, j] = e.cells(k);
          const [ax, az] = e.a(k), [bx, bz] = e.b(k);
          const ta = this._c(i, j, ax, az), tb = this._c(i, j, bx, bz);
          const ya0 = band.top(ta), ya1 = band.bot(ta), yb0 = band.top(tb), yb1 = band.bot(tb);
          if (ya0 <= ya1 + 1e-3 && yb0 <= yb1 + 1e-3) continue;
          const q = pos.length / 3;
          pos.push(ax, ya0, az, bx, yb0, bz, ax, ya1, az, bx, yb1, bz);
          const ua = (ax + az) / 4, ub = (bx + bz) / 4;
          uv.push(ua, band.v(ya0, ta), ub, band.v(yb0, tb), ua, band.v(ya1, ta), ub, band.v(yb1, tb));
          idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
      const geo = indexedGeo(pos, uv, idx);
      const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
        map: band.tex, flatShading: true, side: THREE.DoubleSide, roughness: 1, alphaTest: band.alpha ? 0.5 : 0,
      }));
      m.receiveShadow = true;
      group.add(m);
    }
    return group;
  }

  // ---- ground texture -----------------------------------------------------

  _paintGround() {
    const SX = NX * PX, SZ = NZ * PX;
    const c = document.createElement('canvas');
    c.width = SX;
    c.height = SZ;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(SX, SZ);
    const d = img.data;
    const S = SX;
    const col = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    const C = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, col(v)]));
    const sn = C(SNOW), ice = C(ICE), teal = C(TEAL), st = C(STONE);
    const soil = C({ l: '#8a5a3a', b: '#6b4630', d: '#4e3022', dd: '#3a2219' });
    const piste = C({ b: '#e9f6f9', g: '#d3ebf1' });
    const rock = C({ l2: '#b6c6cc', l1: '#8fa3ab', b: '#6f8590', d1: '#536a76', d2: '#3e5260' });
    const cobble = C({ l2: '#e6eef0', l1: '#d2dfe4', b: '#bccbd2', d1: '#a3b6be', d2: '#6f8590' });
    const stepping = C({ l2: '#f2f7f8', l1: '#dfe9ec', b: '#c8d6dc', d1: '#b3c4cb', d2: '#8197a1' });

    // Worley cells: which stone a pixel belongs to, and how close it is to a seam
    const cell = (x, y, size, salt) => {
      const gx = Math.floor(x / size), gy = Math.floor(y / size);
      let f1 = 1e9, f2 = 1e9, id = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const cx = gx + ox, cy = gy + oy;
        const fx = (cx + 0.2 + hash(cx * 3 + salt, cy * 5) * 0.6) * size, fy = (cy + 0.2 + hash(cx * 7 + salt, cy * 11 + 1) * 0.6) * size;
        const dd = (x - fx) ** 2 + (y - fy) ** 2;
        if (dd < f1) { f2 = f1; f1 = dd; id = cx * 7919 + cy; } else if (dd < f2) f2 = dd;
      }
      return { id, f1: Math.sqrt(f1), f2: Math.sqrt(f2) };
    };
    /** cobbles / stepping stones with a lit top-left edge and a dark seam */
    const stone = (x, y, size, salt, P, gap) => {
      const c0 = cell(x, y, size, salt);
      const inStone = (q) => (gap ? q.f1 < size * gap : q.f2 - q.f1 > 1.1);
      if (!inStone(c0)) return null;
      const up = cell(x - 1, y - 1, size, salt), dn = cell(x + 1, y + 1, size, salt);
      const tone = hash(c0.id, salt);
      if (!inStone(dn) || dn.id !== c0.id) return P.d2;
      if (!inStone(up) || up.id !== c0.id) return tone > 0.6 ? P.l2 : P.l1;
      return tone < 0.3 ? P.d1 : tone > 0.75 ? P.l1 : P.b;
    };

    // Low-frequency fields, sampled once per 4×4 texel block: they decide where the big
    // flat shapes go (snow shade, ice pools). Inside a shape every texel is the same tone.
    const BS = 4, BW = SX / BS, BH = SZ / BS;
    const drift = new Float32Array(BW * BH), pool = new Float32Array(BW * BH);
    for (let by = 0; by < BH; by++) for (let bx = 0; bx < BW; bx++) {
      const x = (bx * BS) / PX, z = (by * BS) / PX;
      drift[by * BW + bx] = (fbm(x * 0.22, z * 0.22, 2) + 1) * 0.5;
      pool[by * BW + bx] = (fbm(x * 0.4 + 3, z * 0.4, 2) + 1) * 0.5;
    }
    const field = (f, px, py) => f[Math.min(BH - 1, py >> 2) * BW + Math.min(BW - 1, px >> 2)];

    for (let py = 0; py < SZ; py++) {
      for (let px = 0; px < SX; px++) {
        let i = Math.floor(px / PX), j = Math.floor(py / PX);
        let kind = this.kind[j * NX + i];
        // stepped pixel edges between soft materials (2-texel steps, not noise)
        if (RAGGED.has(kind)) {
          const jx = Math.floor((hash(px >> 2, py >> 2) - 0.5) * 6), jy = Math.floor((hash((px >> 2) + 77, py >> 2) - 0.5) * 6);
          const ii = clamp(Math.floor((px + jx) / PX), 0, NX - 1), jj = clamp(Math.floor((py + jy) / PX), 0, NZ - 1);
          const k2 = this.kind[jj * NX + ii];
          if (RAGGED.has(k2) && this.level[jj * NX + ii] === this.level[j * NX + i]) { kind = k2; i = ii; j = jj; }
        }
        const x = px / PX, z = py / PX;
        const ly = py % PX;
        const snowAt = () => {
          // one flat tone; big soft shade shapes in a second tone, drift lines, rare sparkles
          const n = field(drift, px, py);
          let c = n > 0.62 ? sn.d1 : sn.b;
          // drift line: a lit crest over a cyan shadow, 8–12 texels long, one per 24×20 cell
          const cx = Math.floor(px / 24), cy = Math.floor(py / 20), mx = px % 24, my = py % 20;
          const hc = hash(cx * 3 + 1, cy * 5 + 2);
          if (hc < 0.12) {
            const y0 = 4 + Math.floor(hc * 100) % 12, x0 = 2 + Math.floor(hc * 170) % 8, len = 7 + Math.floor(hc * 110) % 5;
            if (my === y0 && mx >= x0 + 1 && mx < x0 + len) c = sn.l2;
            if (my === y0 + 1 && mx >= x0 && mx < x0 + len - 1) c = n > 0.62 ? sn.d2 : sn.d1;
          }
          // sparkle: a single white texel, very sparse
          if (hash(px, py) < 0.0015) c = sn.l2;
          return c;
        };
        let c;
        switch (kind) {
          case K.SNOW: {
            const { s } = toSW(x, z);
            c = snowAt();
            // in the valley, a few tiny teal grass tufts poke through (3 texels tall)
            if (s > SLOPE_END - 1) {
              const gx = Math.floor(px / 20), gy = Math.floor(py / 20), lx = px % 20, lyy = py % 20;
              if (hash(gx + 501, gy * 3) < 0.07) {
                if ((lx === 8 || lx === 10 || lx === 12) && lyy >= 9 && lyy < 12) c = lyy === 9 ? teal.b : teal.d1;
                if (lx === 10 && lyy === 8) c = teal.l1;
              }
            }
            break;
          }
          case K.PISTE:
            // groomed corduroy: ribs along the fall line (+z), one every 4 texels
            c = px % 4 === 0 ? piste.g : piste.b;
            if (hash(px, py) < 0.0012) c = sn.l2;
            break;
          case K.ROCK: {
            // big boulders (the slope stretches them), half buried under flat snow patches
            const r = stone(px, py, 16, 3, rock, 0) ?? rock.d2;
            c = field(drift, px, py) > 0.42 ? (r === rock.d2 ? sn.d1 : sn.b) : r;
            break;
          }
          case K.PATH: {
            // packed snow with separate rounded stepping stones, a shadow under each
            const r = stone(px, py, 12, 11, stepping, 0.32);
            if (r) c = r;
            else {
              const above = cell(px - 2, py - 2, 12, 11);
              c = above.f1 < 12 * 0.32 ? sn.d1 : sn.b;
            }
            break;
          }
          case K.PATIO: {
            const r = stone(px, py, 12, 23, cobble, 0);
            c = r ?? cobble.d2; // seams
            break;
          }
          case K.PLOT: {
            // furrows 8 texels: snowy ridge, cyan shade, soil, dark soil
            const row = ly % 8;
            c = row < 2 ? sn.l1 : row === 2 ? sn.d1 : row < 6 ? soil.b : soil.d;
            if (row === 3 && (px + Math.floor(py / 8) * 7) % 13 === 0) c = soil.l;
            break;
          }
          case K.CREEK: {
            // ice in three flat cyan tones, with short diagonal highlight streaks
            const n = field(pool, px, py);
            c = n > 0.6 ? ice.d1 : n > 0.4 ? ice.b : ice.l1;
            if (n > 0.72) c = ice.d2;
            const sx = px % 28, sy = py % 22, hs = hash(Math.floor(px / 28) + 9, Math.floor(py / 22));
            if (hs < 0.45 && n < 0.6) {
              const y0 = 4 + Math.floor(hs * 26);
              if (sy >= y0 && sy < y0 + 4 && sx === 6 + (sy - y0) * 2) c = ice.l2;
              if (sy >= y0 && sy < y0 + 4 && sx === 7 + (sy - y0) * 2) c = ice.l2;
            }
            break;
          }
          case K.BANK: {
            const r = stone(px, py, 14, 41, cobble, 0.4);
            if (r) {
              // snow on the top rows of each stone
              const up = cell(px, py - 3, 14, 41), here = cell(px, py, 14, 41);
              c = up.id !== here.id || up.f1 >= 14 * 0.4 ? sn.b : r;
            } else c = sn.d1;
            break;
          }
          default:
            c = sn.b;
        }
        const o = (py * S + px) * 4;
        d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.tctx = ctx;
    const pc = document.createElement('canvas');
    pc.width = pc.height = 4;
    const pctx = pc.getContext('2d');
    pctx.fillStyle = '#e9f6f9';
    pctx.fillRect(0, 0, 4, 4);
    pctx.fillStyle = '#d3ebf1';
    pctx.fillRect(0, 0, 1, 4); // ribs along the fall line, like the ground (px % 4 === 0)
    this.corduroy = ctx.createPattern(pc, 'repeat');
    this.groundTex = pixelTexture(c);
    this.dirty = false;
    this.flushT = 0;
  }

  /** A short board track. */
  stamp(x0, z0, x1, z1, width, alpha = 0.3) {
    if (this.kindAt(x1, z1) === K.CREEK || this.kindAt(x1, z1) === K.PATIO) return;
    const ctx = this.tctx;
    ctx.strokeStyle = `rgba(111,176,192,${alpha})`; // board track: teal-cyan shadow in the snow
    ctx.lineWidth = Math.max(1, width * PX);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0 * PX, z0 * PX);
    ctx.lineTo(x1 * PX, z1 * PX);
    ctx.stroke();
    this.dirty = true;
  }

  /** The snowcat restores corduroy on piste tiles. */
  groomAt(x, z, r) {
    const ctx = this.tctx;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x * PX, z * PX, r * PX, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = this.corduroy;
    ctx.fillRect((x - r) * PX, (z - r) * PX, r * 2 * PX, r * 2 * PX);
    ctx.restore();
    this.dirty = true;
  }

  /** Fresh snowfall slowly hides tracks on the slope. */
  dust(alpha) {
    const ctx = this.tctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, NX * PX, (SLOPE_END + 1) * PX);
    ctx.clip();
    ctx.fillStyle = `rgba(238,248,251,${alpha})`;
    ctx.fillRect(0, 0, NX * PX, NZ * PX);
    ctx.restore();
    this.dirty = true;
  }

  flush(dt) {
    this.flushT -= dt;
    if (this.dirty && this.flushT <= 0) {
      this.groundTex.needsUpdate = true;
      this.dirty = false;
      this.flushT = 0.1;
    }
  }
}

const canvasTexture = (w, h, draw) => canvasTex(w, h, draw, { repeat: 1 });

// warm earth strata, from the top: lighter loam down to dark clay (flat bands)
const SOIL = ['#8a5a3a', '#7a4e30', '#6b4329', '#5e3a25', '#4e2f1c', '#5e3a25'];
const SOIL_LINE = '#3a2219'; // dark line under each band
const PEBBLE = { l: '#c8d6dc', b: '#9fb2ba', d: '#5a6f78' };

/** Soil strata: flat bands with a stepped (not noisy) wavy border, a few pebbles. */
function soilPixel(x, y, h) {
  const bandH = h / SOIL.length;
  // the border between bands steps up and down every 6 texels
  const wave = [0, 1, 1, 0, -1, -1][Math.floor(x / 6) % 6];
  const yy = y + wave;
  const band = Math.floor(yy / bandH);
  let c = SOIL[((band % SOIL.length) + SOIL.length) % SOIL.length];
  if (((yy % bandH) + bandH) % bandH >= bandH - 1) c = SOIL_LINE;
  // pebbles: a 3×2 stone with a lit top, one per 16×16 cell in some cells
  const cx = Math.floor(x / 16), cy = Math.floor(y / 16), hc = hash(cx * 5 + 1, cy * 9 + 4);
  if (hc < 0.45) {
    const px0 = 3 + Math.floor(hc * 20) % 10, py0 = 3 + Math.floor(hc * 37) % 10;
    const lx = (x % 16) - px0, ly = (y % 16) - py0;
    if (lx >= 0 && lx < 3 && ly >= 0 && ly < 2) c = ly === 0 ? (lx === 0 ? PEBBLE.l : PEBBLE.b) : PEBBLE.d;
  }
  return c;
}

/** Snow lip, 6 texels: bright crust, a lit face, cyan shade, then little drips into the soil. */
function lipTexture() {
  const w = 4 * PX, h = 6;
  return canvasTexture(w, h, (ctx) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const drip = [0, 0, 1, 2, 1, 0, 0, 0, 1, 0, 0, 2, 3, 2, 0, 0][x % 16]; // how far the snow hangs down
      let c;
      if (y === 0) c = SNOW.l2;
      else if (y === 1 || y === 2) c = SNOW.b;
      else if (y === 3) c = SNOW.d1;
      else if (y - 4 < drip - 1) c = SNOW.d1;
      else if (y - 4 < drip) c = SNOW.d2;
      else c = soilPixel(x, y - 4, 2 * PX);
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

/** Layered soil, 4 × 2 units, tiles seamlessly. */
function soilTexture() {
  const w = 4 * PX, h = 2 * PX;
  return canvasTexture(w, h, (ctx) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      ctx.fillStyle = soilPixel(x, y, h);
      ctx.fillRect(x, y, 1, 1);
    }
  });
}

/** Bottom band: soil ending in a stepped pixel edge (columns of set depth, no dither). */
function jagTexture() {
  const w = 4 * PX, h = 12;
  return canvasTexture(w, h, (ctx) => {
    for (let x = 0; x < w; x++) {
      // depth per 2-texel column, in a staircase pattern
      const depth = 3 + Math.floor(hash(x >> 1, 91) * 9);
      for (let y = 0; y < h; y++) {
        if (y >= depth) continue; // transparent
        ctx.fillStyle = y === depth - 1 ? SOIL_LINE : soilPixel(x, y + 10, 2 * PX);
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

/** Retaining wall: grey-blue blocks in courses, lit tops, dark seams, snow on some tops. */
function stoneWallTexture() {
  return canvasTexture(32, 32, (ctx) => {
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const row = y >> 3, ly = y & 7;
        const xx = (x + (row % 2 ? 5 : 0)) % 32;
        const edges = [0, 11, 22, 32];
        let b = 0;
        while (xx >= edges[b + 1]) b++;
        const lx = xx - edges[b], bw = edges[b + 1] - edges[b];
        const tone = (b * 2 + row) % 3;
        let c = tone === 0 ? STONE.b : tone === 1 ? STONE.d1 : STONE.l1;
        if (ly === 7 || lx === bw - 1) c = STONE.d2;
        else if (ly === 0 || lx === 0) c = tone === 2 ? STONE.l2 : STONE.l1;
        if (ly === 0 && (b + row) % 4 === 0) c = SNOW.l2; // snow on some block tops
        ctx.fillStyle = c;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
}

