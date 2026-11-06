import * as THREE from 'three';
import { HALF } from '../constants.js';
import { MeshBuilder, addWorldMesh, makeCanvas, makeRng, pixelTexture, vertexMaterial } from '../core/builder.js';
import { BLOCKS, DIAGONAL_ROT, LANDMARK_ZONES, PLAZA, diagonalZ, roadClearance } from './plan.js';
import { onStadium } from './stadium.js';

const FACADE_TILE = 24; // metres covered by one tile of facade texture

const STYLES = {
  brick: { base: '#a85a43', alt: '#9b5240', frame: '#d09b83', glass: '#2a2d36', kind: 'grid' },
  brickDark: { base: '#8c4a3a', alt: '#804436', frame: '#b98570', glass: '#24262e', kind: 'grid' },
  brickOrange: { base: '#c2744f', alt: '#b56a47', frame: '#e3ac8d', glass: '#2c2d33', kind: 'grid' },
  brickBand: { base: '#ad5d44', alt: '#e0d6c4', frame: '#d6a78f', glass: '#2a2d36', kind: 'band' },
  cream: { base: '#ddd3bd', alt: '#cfc5af', frame: '#ece4d2', glass: '#3a3d42', kind: 'grid' },
  beige: { base: '#c9b99d', alt: '#bdae93', frame: '#e2d6bf', glass: '#3a3d42', kind: 'grid' },
  stone: { base: '#cfc6b2', alt: '#bfb6a2', frame: '#e6dfcf', glass: '#34373c', kind: 'tall' },
  white: { base: '#e6e3da', alt: '#d2cfc5', frame: '#f4f2ea', glass: '#39404a', kind: 'ribbon' },
  grey: { base: '#8f908d', alt: '#858683', frame: '#a8a9a5', glass: '#2d3238', kind: 'cells' },
  darkOffice: { base: '#4a4e55', alt: '#3f4349', frame: '#6a6f77', glass: '#22252a', kind: 'ribbon' },
  glass: { base: '#2c3139', alt: '#343a44', frame: '#566070', glass: '#1d2127', kind: 'mullion' },
  fin: { base: '#e8e6df', alt: '#dedcd4', frame: '#f6f5f0', glass: '#6a6f78', kind: 'fin' },
  stack: { base: '#e5dfd0', alt: '#cfc9ba', frame: '#f2eee2', glass: '#3d3a38', kind: 'stack' },
  hotel: { base: '#ece9df', alt: '#dfdcd2', frame: '#f6f4ec', glass: '#6b6861', kind: 'ribbon' },
};
const ROOFS = {
  red: '#b5392b', tile: '#c2653d', tileDark: '#a54f31', slate: '#3b3e46', tan: '#b7a78c',
  grey: '#96958e', light: '#d3cfc3', copper: '#7ea18c',
};

function paintFacade(style, seed) {
  const SIZE = 32;
  const { canvas, ctx } = makeCanvas(SIZE, SIZE);
  const lit = makeCanvas(SIZE, SIZE);
  const r = makeRng(seed);
  const fill = (c, x, y, w, h) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  const glow = (x, y, w, h, chance) => {
    if (r() < chance) {
      lit.ctx.fillStyle = r.pick(['#ffd28a', '#ffc36a', '#ffe7b0']);
      lit.ctx.fillRect(x, y, w, h);
    }
  };
  fill(style.base, 0, 0, SIZE, SIZE);
  lit.ctx.fillStyle = '#000';
  lit.ctx.fillRect(0, 0, SIZE, SIZE);

  switch (style.kind) {
    case 'grid':
    case 'band':
      for (let y = 0; y < SIZE; y += 4) {
        if (style.kind === 'band' || (y / 4) % 2) fill(style.alt, 0, y + 3, SIZE, 1);
        for (let x = 0; x < SIZE; x += 4) {
          fill(style.frame, x + 1, y, 2, 3);
          fill(style.glass, x + 1, y, 2, 2);
          glow(x + 1, y, 2, 2, 0.3);
        }
      }
      break;
    case 'tall':
      for (let y = 0; y < SIZE; y += 8) {
        for (let x = 0; x < SIZE; x += 4) {
          fill(style.glass, x + 1, y + 1, 2, 5);
          glow(x + 1, y + 1, 2, 5, 0.22);
        }
        fill(style.alt, 0, y + 7, SIZE, 1);
      }
      break;
    case 'ribbon':
      for (let y = 0; y < SIZE; y += 4) {
        fill(style.glass, 0, y, SIZE, 2);
        fill(style.frame, 0, y + 2, SIZE, 1);
        for (let x = 0; x < SIZE; x += 2) glow(x, y, 2, 2, 0.25);
      }
      fill(style.alt, 0, 0, 1, SIZE);
      fill(style.alt, 16, 0, 1, SIZE);
      break;
    case 'cells':
      for (let y = 0; y < SIZE; y += 4) {
        for (let x = 0; x < SIZE; x += 4) {
          fill(style.glass, x, y, 3, 3);
          glow(x, y, 3, 3, 0.28);
        }
      }
      break;
    case 'mullion':
      for (let x = 0; x < SIZE; x += 2) fill(style.frame, x, 0, 1, SIZE);
      for (let y = 0; y < SIZE; y += 4) fill(style.glass, 0, y, SIZE, 1);
      for (let n = 0; n < 34; n++) glow(Math.floor(r() * 16) * 2 + 1, Math.floor(r() * 8) * 4 + 1, 1, 3, 0.7);
      break;
    case 'fin':
      for (let x = 0; x < SIZE; x += 2) fill(style.glass, x + 1, 0, 1, SIZE);
      for (let n = 0; n < 40; n++) glow(Math.floor(r() * 16) * 2 + 1, Math.floor(r() * 8) * 4, 1, 3, 0.6);
      break;
    case 'stack':
      // Balcony rails between dark recesses
      for (let y = 0; y < SIZE; y += 4) {
        fill(style.glass, 0, y, SIZE, 2);
        fill(style.frame, 0, y + 2, SIZE, 1);
        fill(style.alt, 0, y + 3, SIZE, 1);
        for (let x = 0; x < SIZE; x += 4) glow(x, y, 3, 2, 0.28);
      }
      break;
  }
  return { map: pixelTexture(canvas, { repeat: true }), emissiveMap: pixelTexture(lit.canvas, { repeat: true }) };
}

const snapFloor = (h) => Math.max(6, Math.round(h / 3) * 3);

/** A local coordinate frame, so buildings can be turned without changing their recipe. */
class Frame {
  constructor(x, z, rot = 0) {
    this.x = x; this.z = z; this.rot = rot;
    this.c = Math.cos(rot); this.s = Math.sin(rot);
  }
  p(lx, lz) { return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c]; }
  /** The four corners of a rectangle centred at lx/lz, in loop order. */
  corners(lx, lz, hw, hd) {
    return [this.p(lx - hw, lz + hd), this.p(lx + hw, lz + hd), this.p(lx + hw, lz - hd), this.p(lx - hw, lz - hd)];
  }
}

export class City {
  constructor(scene, ground) {
    this.scene = scene;
    this.ground = ground;
    this.r = makeRng(2026);
    this.walls = {};
    for (const key of Object.keys(STYLES)) this.walls[key] = new MeshBuilder({ textured: true });
    this.detail = new MeshBuilder();
    this.courtyards = [];

    for (const block of BLOCKS) this.fillBlock(block);
    this.addFarLeftLandmarks();
    this.addFarCentre();
    this.addFarRight();
    this.addEastLandmarks();
    this.addPlaza();
    this.addChurch();
    this.addHotel();
    this.addSchool();
    this.addPoster();

    this.materials = [];
    Object.entries(STYLES).forEach(([key, style], n) => {
      const { map, emissiveMap } = paintFacade(style, 100 + n);
      const material = new THREE.MeshLambertMaterial({
        map, emissiveMap, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, side: THREE.DoubleSide,
      });
      this.materials.push(material);
      addWorldMesh(scene, this.walls[key].build(), material);
    });
    addWorldMesh(scene, this.detail.build(), vertexMaterial());
  }

  /** Windows come on as the sky darkens. */
  update(night) {
    for (const m of this.materials) m.emissiveIntensity = night * 1.05;
  }

  // ---------------------------------------------------------------- primitives

  /** Four textured walls of a rectangular mass, centred at lx/lz in frame F. */
  mass(F, lx, lz, w, d, y0, y1, style) {
    const b = this.walls[style];
    const c = F.corners(lx, lz, w / 2, d / 2);
    const lengths = [w, d, w, d];
    let run = this.r() * 8;
    for (let n = 0; n < 4; n++) {
      const p = c[n], q = c[(n + 1) % 4];
      const u0 = run / FACADE_TILE, u1 = (run + lengths[n]) / FACADE_TILE;
      b.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], '#ffffff',
        [[u0, y0 / FACADE_TILE], [u1, y0 / FACADE_TILE], [u1, y1 / FACADE_TILE], [u0, y1 / FACADE_TILE]]);
      run += lengths[n];
    }
  }

  /** Flat cap at height y, with an optional parapet and rooftop clutter. */
  flatRoof(F, lx, lz, w, d, y, color, { parapet = 1, lip = '#d6d0c0', clutter = true } = {}) {
    const c = F.corners(lx, lz, w / 2, d / 2);
    const at =(n, yy) => [c[n][0], yy, c[n][1]];
    this.detail.quad(at(0, y), at(1, y), at(2, y), at(3, y), color);
    if (parapet) {
      for (let n = 0; n < 4; n++) {
        const m = (n + 1) % 4;
        this.detail.quad(at(n, y), at(m, y), at(m, y + parapet), at(n, y + parapet), lip);
      }
    }
    if (clutter) this.roofClutter(F, lx, lz, w, d, y);
  }

  /** Stair heads, water tanks and AC units: most of what you see of a flat Madrid roof. */
  roofClutter(F, lx, lz, w, d, y) {
    const r = this.r;
    const count = Math.max(1, Math.floor((w * d) / 160)) + (r() < 0.5 ? 1 : 0);
    for (let n = 0; n < count; n++) {
      const [px, pz] = F.p(lx + r.range(-w * 0.34, w * 0.34), lz + r.range(-d * 0.34, d * 0.34));
      const kind = r();
      if (kind < 0.55) {
        const size = r.range(2.2, Math.max(2.4, Math.min(5.5, Math.min(w, d) * 0.4)));
        this.detail.box(px, y, pz, size, y + r.range(1.8, 3.4), size * r.range(0.8, 1.5), r.pick(['#d8d4c8', '#c2bfb4', '#a8a69c', '#e4e0d4']), { rot: F.rot });
      } else if (kind < 0.8) {
        this.detail.cylinder(px, pz, r.range(0.9, 1.4), y, y + 2.4, 7, '#b9bab6', { cap: '#d9dad6' });
      } else {
        this.detail.box(px, y, pz, 1.8, y + 1.3, 1.8, '#8c8f92', { rot: F.rot });
      }
    }
  }

  /** Hipped roof with its ridge along the longer side. */
  hipRoof(F, lx, lz, w, d, y, h, color, gableColor = color) {
    const hw = w / 2, hd = d / 2;
    const pt = (dx, dz, yy) => { const [x, z] = F.p(lx + dx, lz + dz); return [x, yy, z]; };
    const a = pt(-hw, hd, y), b = pt(hw, hd, y), c = pt(hw, -hd, y), e = pt(-hw, -hd, y);
    if (w >= d) {
      const r0 = pt(-hw + hd * 0.8, 0, y + h), r1 = pt(hw - hd * 0.8, 0, y + h);
      this.detail.quad(a, b, r1, r0, color);
      this.detail.quad(c, e, r0, r1, color);
      this.detail.tri(b, c, r1, gableColor);
      this.detail.tri(e, a, r0, gableColor);
    } else {
      const r0 = pt(0, -hd + hw * 0.8, y + h), r1 = pt(0, hd - hw * 0.8, y + h);
      this.detail.quad(b, c, r0, r1, color);
      this.detail.quad(e, a, r1, r0, color);
      this.detail.tri(a, b, r1, gableColor);
      this.detail.tri(c, e, r0, gableColor);
    }
  }

  /** Slate mansard: a steep sloped storey, a flat top and a row of dormers. */
  mansard(F, lx, lz, w, d, y, h, color = ROOFS.slate) {
    const hw = w / 2, hd = d / 2, inset = Math.min(2.6, Math.min(w, d) * 0.22);
    const low = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
    const high = [[-hw + inset, hd - inset], [hw - inset, hd - inset], [hw - inset, -hd + inset], [-hw + inset, -hd + inset]];
    const pt = ([dx, dz], yy) => { const [x, z] = F.p(lx + dx, lz + dz); return [x, yy, z]; };
    for (let n = 0; n < 4; n++) {
      const m = (n + 1) % 4;
      this.detail.quad(pt(low[n], y), pt(low[m], y), pt(high[m], y + h), pt(high[n], y + h), color);
    }
    this.detail.quad(pt(high[0], y + h), pt(high[1], y + h), pt(high[2], y + h), pt(high[3], y + h), '#4a4d55');
    const along = w >= d;
    const len = along ? w : d;
    for (let t = -len / 2 + 4; t < len / 2 - 3; t += 5.5) {
      for (const side of [-1, 1]) {
        const off = (along ? hd : hw) - inset * 0.55;
        const [px, pz] = along ? F.p(lx + t, lz + side * off) : F.p(lx + side * off, lz + t);
        this.detail.box(px, y + 0.3, pz, 1.5, y + h * 0.82, 1.5, '#d9d5c8', { rot: F.rot, top: '#555860' });
      }
    }
  }

  /** Cream columns of stacked balconies climbing the faces of a slab. */
  balconies(F, lx, lz, w, d, h) {
    const r = this.r;
    const spacing = r.range(9, 13), width = r.range(3.6, 5), depth = 1.3;
    const bottom = 3.6, top = h - r.pick([0, 0, 3]);
    if (top - bottom < 6) return;
    const faces = [];
    if (w >= 12) faces.push(['x', 1], ['x', -1]);
    if (d >= 12) faces.push(['z', 1], ['z', -1]);
    for (const [axis, side] of faces) {
      const len = axis === 'x' ? w : d;
      for (let t = -len / 2 + spacing * 0.6; t < len / 2 - 2; t += spacing) {
        const fx = axis === 'x' ? lx + t : lx + side * (w / 2 + depth / 2);
        const fz = axis === 'x' ? lz + side * (d / 2 + depth / 2) : lz + t;
        const bw = axis === 'x' ? width : depth, bd = axis === 'x' ? depth : width;
        this.mass(F, fx, fz, bw, bd, bottom, top, 'stack');
        this.flatRoof(F, fx, fz, bw, bd, top, '#e8e3d6', { parapet: 0, clutter: false });
      }
    }
  }

  /** A dark band of shopfronts around the base of a mass. */
  shopfront(F, lx, lz, w, d) {
    const r = this.r;
    const c = F.corners(lx, lz, w / 2 + 0.15, d / 2 + 0.15);
    const colors =['#2f3338', '#3b4046', '#25282c', '#6d3d2d', '#4b6a6e'];
    for (let n = 0; n < 4; n++) {
      const p = c[n], q = c[(n + 1) % 4];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const parts = Math.max(1, Math.floor(len / 7));
      for (let k = 0; k < parts; k++) {
        const t0 = k / parts, t1 = (k + 1) / parts;
        const ax = p[0] + (q[0] - p[0]) * t0, az = p[1] + (q[1] - p[1]) * t0;
        const bx = p[0] + (q[0] - p[0]) * t1, bz = p[1] + (q[1] - p[1]) * t1;
        this.detail.quad([ax, 0, az], [bx, 0, bz], [bx, 3.4, bz], [ax, 3.4, az], r.pick(colors));
      }
    }
  }

  /** One apartment slab: walls, balconies, shops and one of several roof recipes. */
  slab(F, lx, lz, w, d, h, style) {
    const r = this.r;
    this.mass(F, lx, lz, w, d, 0, h, style);
    this.shopfront(F, lx, lz, w, d);
    if (style !== 'cream' || r() < 0.5) this.balconies(F, lx, lz, w, d, h);
    const roll = r();
    const lip = STYLES[style].frame;
    if (roll < 0.34) {
      // Red flat roof, as on most of the blocks in the photo
      this.flatRoof(F, lx, lz, w, d, h, ROOFS.red, { lip });
    } else if (roll < 0.5) {
      this.flatRoof(F, lx, lz, w, d, h, r.pick([ROOFS.tan, ROOFS.grey, ROOFS.light]), { lip });
    } else if (roll < 0.68) {
      // Set-back top floor under a tile roof, with a terrace around it
      this.flatRoof(F, lx, lz, w, d, h, ROOFS.tan, { lip, clutter: false });
      const iw = w - 4, id = d - 4;
      if (iw > 5 && id > 5) {
        this.mass(F, lx, lz, iw, id, h, h + 3, style);
        this.hipRoof(F, lx, lz, iw, id, h + 3, Math.min(iw, id) * 0.22, ROOFS.tile, ROOFS.tileDark);
      }
    } else if (roll < 0.86) {
      this.mansard(F, lx, lz, w, d, h, 3.2);
    } else {
      this.hipRoof(F, lx, lz, w, d, h, Math.min(w, d) * 0.24, ROOFS.tile, ROOFS.tileDark);
    }
    this.occupy(F, lx, lz, w, d);
  }

  occupy(F, lx, lz, w, d) {
    const [x, z] = F.p(lx, lz);
    this.ground.occupy(x, z, w, d, F.rot);
  }

  /** Is this footprint safely off the roads, the stadium and the slab's edge? */
  fits(F, lx, lz, w, d, margin = 2.2) {
    for (let fx = -1; fx <= 1; fx += 0.5) {
      for (let fz = -1; fz <= 1; fz += 0.5) {
        const [x, z] = F.p(lx + (fx * w) / 2, lz + (fz * d) / 2);
        if (roadClearance(x, z) < margin || onStadium(x, z)) return false;
        if (Math.abs(x) > HALF - 1.5 || Math.abs(z) > HALF - 1.5) return false;
        if (LANDMARK_ZONES.some((L) => x > L.x0 && x < L.x1 && z > L.z0 && z < L.z1)) return false;
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- block packing

  /**
   * Recursively split a block into abutting slabs of different heights, which is
   * what makes the skyline step instead of reading as one box. Pieces that don't
   * touch the block's edge become courtyards.
   */
  fillBlock({ x, z, w, d, rot = 0, base, styles }) {
    const F = new Frame(x, z, rot);
    const complexStyle = this.r.pick(styles);
    const leaves = [];
    const split = (x0, x1, z0, z1, depth) => {
      const lw = x1 - x0, ld = z1 - z0;
      if (depth > 0 && (Math.max(lw, ld) > 44 || Math.min(lw, ld) > 24)) {
        const gap = this.r() < 0.16 ? 2 : 0;
        const t = this.r.range(0.36, 0.64);
        if (lw >= ld) {
          const cut = x0 + lw * t;
          split(x0, cut - gap / 2, z0, z1, depth - 1);
          split(cut + gap / 2, x1, z0, z1, depth - 1);
        } else {
          const cut = z0 + ld * t;
          split(x0, x1, z0, cut - gap / 2, depth - 1);
          split(x0, x1, cut + gap / 2, z1, depth - 1);
        }
      } else {
        leaves.push({ x0, x1, z0, z1 });
      }
    };
    split(-w / 2, w / 2, -d / 2, d / 2, 5);

    const place = ({ x0, x1, z0, z1 }) => {
      const lw = x1 - x0, ld = z1 - z0;
      const lx = (x0 + x1) / 2, lz = (z0 + z1) / 2;
      if (!this.fits(F, lx, lz, lw, ld)) {
        // Near a road or a landmark, try again with the piece cut in half.
        if (Math.max(lw, ld) < 15) return;
        if (lw >= ld) {
          place({ x0, x1: lx, z0, z1 });
          place({ x0: lx, x1, z0, z1 });
        } else {
          place({ x0, x1, z0, z1: lz });
          place({ x0, x1, z0: lz, z1 });
        }
        return;
      }
      const interior = x0 > -w / 2 + 1 && x1 < w / 2 - 1 && z0 > -d / 2 + 1 && z1 < d / 2 - 1;
      if (interior && lw > 10 && ld > 10) {
        this.courtyard(F, lx, lz, lw, ld);
        return;
      }
      const slim = Math.min(lw, ld) < 15 && Math.max(lw, ld) < 22;
      const jump = this.r() < 0.13 ? this.r.range(12, 24) : this.r.pick([-6, -3, 0, 0, 3, 6, 9]);
      const h = snapFloor(base + jump + (slim ? 3 : 0));
      const style = this.r() < 0.62 ? complexStyle : (slim && this.r() < 0.5 ? 'cream' : this.r.pick(styles));
      this.slab(F, lx, lz, lw - 0.3, ld - 0.3, h, style);
    };
    leaves.forEach(place);
  }

  courtyard(F, lx, lz, w, d) {
    const roll = this.r();
    if (roll < 0.45) {
      // Single-storey annexes filling the yard, tiled or planted on top
      const h = this.r.range(4, 7);
      this.mass(F, lx, lz, w - 1, d - 1, 0, h, 'brick');
      this.flatRoof(F, lx, lz, w - 1, d - 1, h, this.r.pick([ROOFS.tile, ROOFS.copper, ROOFS.light, '#5a8040']), { parapet: 0.6, clutter: false });
      this.occupy(F, lx, lz, w - 1, d - 1);
    } else {
      const y = 0.12;
      const [c0, c1, c2, c3] = F.corners(lx, lz, w / 2, d / 2).map(([x, z]) => [x, y, z]);
      this.detail.quad(c0, c1, c2, c3, roll < 0.8 ? '#4f7c37' : '#b5ad9c');
      const [x, z] = F.p(lx, lz);
      this.courtyards.push([x, z, Math.min(w, d) * 0.35]);
    }
  }

  // ---------------------------------------------------------------- landmarks: far left

  addFarLeftLandmarks() {
    // Ribbed white tower
    const P = new Frame(-214, -208, 0);
    this.mass(P, 0, 0, 34, 34, 8, 84, 'fin');
    for (const [dx, dz] of [[-15, 15], [15, 15], [15, -15], [-15, -15]]) {
      const [x, z] = P.p(dx, dz);
      this.detail.box(x, 0, z, 3, 9, 3, '#d8d6cf');
    }
    this.mass(P, 0, 0, 16, 16, 0, 9, 'darkOffice');
    this.flatRoof(P, 0, 0, 34, 34, 84, ROOFS.light, { lip: '#f4f2ec', parapet: 2 });
    this.occupy(P, 0, 0, 34, 34);

    // Twin dark cylinders with a crown and a small red sign
    const b = this.walls.glass;
    const x = -160, z = -196, r = 15, h = 74;
    for (const dx of [-10, 10]) {
      const cz = z + (dx > 0 ? 5 : -5);
      b.cylinder(x + dx, cz, r, 0, h, 20, '#ffffff', { uvScale: FACADE_TILE });
      this.detail.cylinder(x + dx, cz, r + 0.5, h, h + 1.2, 20, '#7f8590');
      this.detail.cylinder(x + dx, cz, r - 2, h + 1.2, h + 5, 18, '#23262c', { cap: '#42454c' });
    }
    this.detail.box(x + 10, h + 5, z + 5, 11, h + 8.5, 1.6, '#c43a2f');
    this.ground.occupy(x, z, 44, 42);

    // Long dark office slab on a podium, facing the avenue
    const S = new Frame(-192, -159, 0);
    this.mass(S, 0, 0, 90, 22, 0, 8, 'grey');
    this.flatRoof(S, 0, 0, 90, 22, 8, ROOFS.grey, { clutter: false });
    this.mass(S, -4, -1, 78, 14, 8, 32, 'darkOffice');
    this.flatRoof(S, -4, -1, 78, 14, 32, ROOFS.grey, { lip: '#6a6f77' });
    this.occupy(S, 0, 0, 90, 22);
  }

  // ---------------------------------------------------------------- landmarks: far centre

  addFarCentre() {
    // Low hall with a large sloped tan roof and a circular plate
    const F = new Frame(-46, -172, 0);
    this.mass(F, -18, 8, 62, 34, 0, 13, 'beige');
    this.shopfront(F, -18, 8, 62, 34);
    this.flatRoof(F, -18, 8, 62, 34, 13, ROOFS.tan, { clutter: false });
    const [cx, cz] = F.p(-28, 10);
    this.detail.cylinder(cx, cz, 9, 13, 14.2, 18, '#4a4845', { cap: '#3a3836' });
    // The big sloped roof, stepping up towards the back
    const hw = 30, hd = 15;
    const pt = (dx, dz, y) => { const [x, z] = F.p(18 + dx, -14 + dz); return [x, y, z]; };
    this.mass(F, 18, -14, hw * 2, hd * 2, 0, 16, 'beige');
    this.detail.quad(pt(-hw, hd, 16), pt(hw, hd, 16), pt(hw, -hd, 26), pt(-hw, -hd, 26), '#c8a989');
    this.detail.quad(pt(-hw, -hd, 16), pt(hw, -hd, 16), pt(hw, -hd, 26), pt(-hw, -hd, 26), '#a68c70');
    this.detail.tri(pt(-hw, hd, 16), pt(-hw, -hd, 16), pt(-hw, -hd, 26), '#b89a7c');
    this.detail.tri(pt(hw, hd, 16), pt(hw, -hd, 16), pt(hw, -hd, 26), '#b89a7c');
    this.mass(F, 34, 14, 22, 16, 0, 11, 'white');
    this.flatRoof(F, 34, 14, 22, 16, 11, ROOFS.light);
    this.occupy(F, 0, 0, 104, 44);

    // Tall white slab behind it, seen end-on at the top of the photo
    const T = new Frame(-22, -224, 0);
    this.mass(T, 0, 0, 34, 24, 0, 66, 'white');
    this.flatRoof(T, 0, 0, 34, 24, 66, ROOFS.light, { lip: '#f4f2ea' });
    this.occupy(T, 0, 0, 34, 24);
  }

  // ---------------------------------------------------------------- landmarks: far right

  addFarRight() {
    // Orange brick tower with dark vertical balcony slots
    const O = new Frame(70, -176, 0);
    this.mass(O, 0, 0, 40, 30, 0, 54, 'brickOrange');
    for (const dx of [-13, -4, 5, 14]) this.mass(O, dx, 15.4, 4, 0.8, 4, 54, 'darkOffice');
    this.flatRoof(O, 0, 0, 40, 30, 54, ROOFS.slate, { lip: '#d6a78f' });
    this.mass(O, 0, 19, 46, 8, 0, 5, 'grey');
    this.flatRoof(O, 0, 19, 46, 8, 5, ROOFS.grey, { clutter: false });
    this.occupy(O, 0, 3, 46, 38);

    // Corner building carrying the huge red banner
    const I = new Frame(120, -172, 0);
    this.mass(I, 0, 0, 40, 34, 0, 34, 'white');
    this.flatRoof(I, 0, 0, 40, 34, 34, ROOFS.red, { lip: '#f4f2ea' });
    const z = -172 + 17.3;
    this.detail.quad([100.5, 4, z], [130, 4, z], [130, 31, z], [100.5, 31, z], '#cb2329');
    this.detail.quad([104, 24, z + 0.1], [114, 24, z + 0.1], [114, 28, z + 0.1], [104, 28, z + 0.1], '#f6ece6');
    this.detail.quad([103, 8, z + 0.1], [126, 16, z + 0.1], [126, 18, z + 0.1], [103, 10, z + 0.1], '#ee8b7c');
    this.detail.quad([103, 12, z + 0.1], [126, 12, z + 0.1], [126, 13, z + 0.1], [103, 13, z + 0.1], '#ee8b7c');
    this.occupy(I, 0, 0, 40, 34);

    this.addNeoclassical();
  }

  /** Huge symmetrical stone ministry: wide central range, two pale towers and a portico. */
  addNeoclassical() {
    const F = new Frame(197, -182, 0);
    this.mass(F, 0, -14, 78, 28, 0, 42, 'stone');
    this.flatRoof(F, 0, -14, 78, 28, 42, ROOFS.tan, { lip: '#b5392b' });
    this.mass(F, 0, -14, 20, 16, 42, 47, 'stone');
    this.flatRoof(F, 0, -14, 20, 16, 47, ROOFS.light, { lip: '#e6dfcf' });
    for (const side of [-1, 1]) {
      this.mass(F, side * 32, 12, 16, 26, 0, 36, 'stone');
      this.flatRoof(F, side * 32, 12, 16, 26, 36, ROOFS.light, { lip: '#ece6d8' });
    }
    // Portico
    this.mass(F, 0, 4, 34, 10, 0, 9, 'stone');
    this.flatRoof(F, 0, 4, 34, 10, 9, '#ddd6c5', { parapet: 0.8, clutter: false });
    for (let t = -14; t <= 14; t += 4) {
      const [x, z] = F.p(t, 9.6);
      this.detail.box(x, 0, z, 1.2, 8.5, 1.2, '#efe9db');
    }
    this.occupy(F, 0, -2, 80, 54);
  }

  // ---------------------------------------------------------------- east

  addEastLandmarks() {
    // Grey grid tower with red side banners, right across the street from the stadium
    const G = new Frame(166, -92, 0);
    this.mass(G, 0, 0, 32, 34, 0, 58, 'grey');
    this.flatRoof(G, 0, 0, 32, 34, 58, ROOFS.grey, { lip: '#a8a9a5', parapet: 1.4 });
    this.mass(G, 0, 0, 30, 32, 58, 61, 'grey');
    this.flatRoof(G, 0, 0, 30, 32, 61, ROOFS.tan, { lip: '#a8a9a5' });
    const x = 166 - 16.3;
    this.detail.quad([x, 18, -102], [x, 18, -84], [x, 42, -84], [x, 42, -102], '#c8282e');
    this.detail.quad([x, 44, -102], [x, 44, -84], [x, 54, -84], [x, 54, -102], '#efe9e0');
    this.occupy(G, 0, 0, 32, 34);
  }

  // ---------------------------------------------------------------- the plaza in front of the stadium

  addPlaza() {
    const b = this.detail;
    const { x, z } = PLAZA;
    const stone = '#ddd8ca', shade = '#bdb7a7';

    // Fountain: a wide basin and a stacked central column
    b.cylinder(x, z, 12.5, 0, 1.1, 28, stone, { cap: stone });
    b.cylinder(x, z, 11.2, 1.1, 1.16, 28, '#3f93b8', { cap: '#3f93b8' });
    b.cylinder(x, z, 4, 1.16, 2.2, 14, shade, { cap: stone });
    b.cylinder(x, z, 1.2, 2.2, 5, 10, stone);
    b.cylinder(x, z, 1.4, 5, 5.8, 12, stone, { r1: 3.6, cap: '#6fb6d2' });
    b.cylinder(x, z, 0.6, 5.8, 8, 8, '#cfe9f3', { r1: 0.15, cap: '#eef8fb' });
    this.ground.occupy(x, z, 25, 25);

    // Benches around the circle, leaving the walkways clear
    for (let n = 0; n < 12; n++) {
      const a = ((n + 0.5) / 12) * Math.PI * 2;
      const r = PLAZA.ringRadius - 7;
      const [bx, bz] = [x + Math.cos(a) * r, z + Math.sin(a) * r];
      b.box(bx, 0, bz, 4.4, 0.9, 1, '#7f6a54', { rot: -a + Math.PI / 2, top: '#94806a' });
    }
  }

  // ---------------------------------------------------------------- bottom of the photo

  addChurch() {
    // Huge dark faceted roof with a slim brick bell tower standing beside it.
    const x = -8, z = 214, r = 24;
    const sides = 8;
    this.walls.brickDark.cylinder(x, z, r - 2, 0, 9, sides, '#ffffff', { uvScale: FACADE_TILE });
    this.detail.cylinder(x, z, r, 9, 21, sides, '#2d2f35', { r1: 3.5, cap: '#26282d' });
    // A lower wing and a red-roofed sacristy
    const W = new Frame(x + 15, z + 14, 0.4);
    this.mass(W, 0, 0, 22, 16, 0, 8, 'brickDark');
    this.hipRoof(W, 0, 0, 22, 16, 8, 5, '#2d2f35', '#26282d');
    const R = new Frame(x - 22, z + 16, 0);
    this.mass(R, 0, 0, 14, 16, 0, 7, 'brick');
    this.hipRoof(R, 0, 0, 14, 16, 7, 4, '#c43a2f', '#a93227');
    const [tx, tz] = [x - 25, z - 16];
    this.walls.brickDark.cylinder(tx, tz, 2.6, 0, 40, 4, '#ffffff', { uvScale: FACADE_TILE });
    this.detail.cylinder(tx, tz, 3, 40, 42, 4, '#6e3a2c', { cap: '#3b2a24' });
    this.ground.occupy(x, z, r * 2, r * 2);
    this.ground.occupy(tx, tz, 6, 6);

    // Small slate-roofed brick house beside the green
    const H = new Frame(30, 216, 0.5);
    this.mass(H, 0, 0, 22, 14, 0, 11, 'brick');
    this.hipRoof(H, 0, 0, 22, 14, 11, 5, ROOFS.slate, '#4a4d55');
    this.occupy(H, 0, 0, 22, 14);
  }

  /** White hotel: ribboned balcony wings with rounded ends and stepped roof terraces. */
  addHotel() {
    const z = diagonalZ(108) + 9 + 3 + 12;
    const F = new Frame(108, z, DIAGONAL_ROT);
    const main = { w: 70, d: 18, h: 30 };
    this.mass(F, 0, 0, main.w, main.d, 3, main.h, 'hotel');
    this.mass(F, 0, 0, main.w - 2, main.d - 2, 0, 3.2, 'darkOffice');
    this.flatRoof(F, 0, 0, main.w, main.d, main.h, '#6f5344', { lip: '#f6f4ec', parapet: 1.4 });
    // Rounded end, stepping terraces on the roof
    const [ex, ez] = F.p(-main.w / 2, 0);
    this.walls.hotel.cylinder(ex, ez, main.d / 2, 3, main.h, 14, '#ffffff', { uvScale: FACADE_TILE });
    this.detail.cylinder(ex, ez, main.d / 2, main.h, main.h + 1.2, 14, '#f6f4ec', { cap: '#6f5344' });
    this.mass(F, 8, 0, 34, 10, main.h, main.h + 5, 'hotel');
    this.flatRoof(F, 8, 0, 34, 10, main.h + 5, '#f0ede4', { lip: '#f6f4ec', clutter: true });

    // Rear wing running away from the road
    const W = 18, D = 40;
    this.mass(F, 22, main.d / 2 + D / 2 - 1, W, D, 3, 24, 'hotel');
    this.flatRoof(F, 22, main.d / 2 + D / 2 - 1, W, D, 24, '#6f5344', { lip: '#f6f4ec', parapet: 1.4 });
    const [rx, rz] = F.p(22, main.d / 2 + D - 1);
    this.walls.hotel.cylinder(rx, rz, W / 2, 3, 24, 12, '#ffffff', { uvScale: FACADE_TILE });
    this.detail.cylinder(rx, rz, W / 2, 24, 25, 12, '#f6f4ec', { cap: '#6f5344' });
    this.occupy(F, 0, 0, main.w + 8, main.d);
    this.occupy(F, 22, main.d / 2 + D / 2 + 3, W, D + 8);

    // Lawn with a looping path, just off the road
    const lawnX = 48, lawnZ = 186;
    this.detail.cylinder(lawnX, lawnZ, 13, 0, 0.14, 18, '#c9c3b3', { cap: '#c9c3b3' });
    this.detail.cylinder(lawnX, lawnZ, 11.4, 0.14, 0.2, 18, '#5a9140', { cap: '#5a9140' });
  }

  /** The school along the right edge: slate mansards, a corner drum and a sports yard. */
  addSchool() {
    const z = diagonalZ(200) + 9 + 3 + 8;
    const F = new Frame(200, z, DIAGONAL_ROT);
    this.mass(F, 0, 0, 64, 16, 0, 16, 'cream');
    this.mansard(F, 0, 0, 64, 16, 16, 5);
    this.occupy(F, 0, 0, 64, 16);

    const W = new Frame(170, 196, 0);
    this.mass(W, 0, 0, 18, 66, 0, 16, 'cream');
    this.mansard(W, 0, 0, 18, 66, 16, 5);
    this.occupy(W, 0, 0, 18, 66);

    const dx = 170, dz = 158;
    this.walls.cream.cylinder(dx, dz, 12, 0, 18, 16, '#ffffff', { uvScale: FACADE_TILE });
    this.detail.cylinder(dx, dz, 12.6, 18, 26, 16, ROOFS.slate, { r1: 1.5, cap: ROOFS.slate });
    this.ground.occupy(dx, dz, 24, 24);
  }

  /** The tall portrait poster on the brick quarter's flank, facing the stadium. */
  addPoster() {
    const x = -141.2;
    const b = this.detail;
    const panel = (z0, y0, z1, y1, color) => b.quad([x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0], color);
    panel(-104, 11, -82, 34, '#2c3440');
    panel(-98, 18, -88, 30, '#b48e74');
    panel(-98, 26, -88, 30, '#2a2422');
    panel(-96, 11, -86, 18, '#39424f');
  }
}
