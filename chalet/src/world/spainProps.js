import * as THREE from 'three';
import { box, glowMat } from './props.js';
import { seeded } from '../core/rand.js';
import {
  PAL, SNOW_C, flat, ramp4, stoneMat, plankMat, glass, coneShingleMat, addDoor, addGableRoof, mergeStatic, finish,
  patternTex, patMat,
} from './pixelKit.js';

/*
 * Madrid and Barcelona in the snow: houses (each one a Claude Code session) and street
 * decorations, in the same 16-texel pixel kit as the rest of the world.
 *
 *  Madrid:    stucco corralas with iron balconies and green shutters, red-brick neo-mudéjar
 *             houses, Habsburg slate spires, Plaza-Mayor arcades, whitewashed casitas.
 *  Barcelona: chamfered Eixample blocks, modernista mosaic houses, Gothic-quarter stone,
 *             narrow pastel Barceloneta houses with laundry on the balconies.
 *
 * Every house faces local +z; the camera sees the front (+z) and the right side (+x).
 * make(v) takes a variant number: the same house in another colour scheme.
 */

const IRON = '#2a2d36';
const WHITE = '#f4efe6';
const S = () => flat(SNOW_C);
const pick = (list, v) => list[((v % list.length) + list.length) % list.length];

// ---- materials ---------------------------------------------------------------------

/** Brick courses: 8×3 bricks, light mortar, staggered. */
const brickMat = (R, mortar = '#e8d9bf') => patMat('brk' + R + mortar, () => patternTex(16, 16, (x, y) => {
  const row = y >> 2, ly = y & 3, off = row % 2 ? 4 : 0, lx = (x + off) & 7, blk = ((x + off) >> 3) + row;
  if (ly === 3 || lx === 7) return mortar;
  if (ly === 0) return R[0];
  return blk % 3 === 2 ? R[2] : R[1];
}));

/** Curved clay roof tiles (teja árabe) for roof slabs: u runs down the slope, v along the eave. */
const tejaMat = (R) => patMat('teja' + R, () => patternTex(16, 16, (x, y) => {
  const k = y & 3, row = x & 7;
  if (row === 0) return R[3];
  if (row === 1) return k === 1 ? R[2] : R[3];
  return [R[2], R[0], R[1], R[2]][k];
}));

/** Slate tiles, small and grey-blue, for Madrid roofs and spires. */
const slateMat = (R = PAL.slate) => patMat('slt' + R, () => patternTex(16, 16, (x, y) => {
  const row = x >> 2, k = x & 3, off = row % 2 ? 2 : 0;
  if (k === 0) return R[3];
  if ((y + off) % 4 === 0) return R[2];
  return k === 3 ? R[0] : R[1];
}));

/** Louvred wooden shutters (persianas): horizontal slats. */
const louverMat = (color) => {
  const R = ramp4(color);
  return patMat('lv' + color, () => patternTex(8, 4, (x, y) => (y === 3 ? R[3] : y === 0 ? R[0] : x === 0 ? R[2] : R[1])));
};

/** Trencadís: broken-tile mosaic, bright shards in white grout. */
const mosaicMat = (pal, seed = 1) => patMat('mos' + pal + seed, () => {
  const r = seeded(seed), pts = [];
  for (let i = 0; i < 9; i++) pts.push([r() * 16, r() * 16, Math.floor(r() * pal.length)]);
  return patternTex(16, 16, (x, y) => {
    let d1 = 1e9, d2 = 1e9, c = 0;
    for (const [px, py, k] of pts) {
      for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
        const d = Math.hypot(x + 0.5 - px - ox, y + 0.5 - py - oy);
        if (d < d1) { d2 = d1; d1 = d; c = k; } else if (d < d2) d2 = d;
      }
    }
    if (d2 - d1 < 1.1) return '#f2efe6';
    return d1 < 1.6 ? ramp4(pal[c])[0] : pal[c];
  });
});

/** Plain stucco with a faint, regular trowel pattern, so big walls are not flat. */
const stuccoMat = (color) => {
  const R = ramp4(color);
  return patMat('stc' + color, () => patternTex(16, 16, (x, y) => ((x * 5 + y * 3) % 23 === 0 ? R[2] : (x * 7 + y * 11) % 31 === 0 ? R[0] : color)));
};

const GOLD_STONE = ['#efd9ac', '#d2b583', '#aa8c5c', '#735d3c'];
const GRANITE = ['#e6e8ec', '#c3c7cf', '#999eaa', '#686c78'];
const TERRACOTTA = ['#f28a5a', '#cf5d34', '#9c3f24', '#62261a'];

// ---- geometry helpers ----------------------------------------------------------------

/** Vertical prism from a floor plan (points in x, z), from y0 up h. */
function prism(points, h, material, y0 = 0) {
  const sh = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, -z)));
  const geo = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false }).rotateX(-Math.PI / 2).translate(0, y0, 0);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/**
 * A wall slab facing +z with arched openings cut through it: arches [{ x, w, h }]
 * (h to the springing line; the round top adds w/2). The slab is w × h, depth thick.
 */
function archWall(w, h, depth, arches, material) {
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(w / 2, h); sh.lineTo(-w / 2, h); sh.closePath();
  for (const a of arches) {
    const p = new THREE.Path();
    p.moveTo(a.x - a.w / 2, a.y ?? 0);
    p.lineTo(a.x + a.w / 2, a.y ?? 0);
    p.lineTo(a.x + a.w / 2, a.h);
    p.absarc(a.x, a.h, a.w / 2, 0, Math.PI, false);
    p.lineTo(a.x - a.w / 2, a.y ?? 0);
    sh.holes.push(p);
  }
  const geo = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: false, curveSegments: 4 }).translate(0, 0, -depth / 2);
  const m = new THREE.Mesh(geo, material);
  m.castShadow = m.receiveShadow = true;
  return m;
}

/**
 * Hipped roof over a w × d top at wallTop: four tiled slopes (ridge along the long side),
 * a snow cap on the upper part of every slope, an eave cornice. Returns the ridge height.
 */
function addHipRoof(g, { w, d, wallTop, rise = 0.9, over = 0.3, roofMat, snow = 0.62, trim = WHITE }) {
  const W = w / 2 + over, D = d / 2 + over;
  const long = W >= D, a = long ? W - D : D - W;
  const r1 = long ? [-a, rise, 0] : [0, rise, -a], r2 = long ? [a, rise, 0] : [0, rise, a];
  const c = (x, z) => [x, 0, z];
  const faces = long
    ? [[c(-W, D), c(W, D), r2, r1, [0, 0, 1]], [c(W, -D), c(-W, -D), r1, r2, [0, 0, -1]], [c(W, D), c(W, -D), r2, null, [1, 0, 0]], [c(-W, -D), c(-W, D), r1, null, [-1, 0, 0]]]
    : [[c(-W, D), c(W, D), r2, null, [0, 0, 1]], [c(W, -D), c(-W, -D), r1, null, [0, 0, -1]], [c(W, D), c(W, -D), r1, r2, [1, 0, 0]], [c(-W, -D), c(-W, D), r2, r1, [-1, 0, 0]]];
  const build = (scale, lift) => {
    const pos = [], uv = [];
    const P = (p) => new THREE.Vector3(p[0] * scale, rise + (p[1] - rise) * scale + lift, p[2] * scale);
    for (const [e1, e2, t1, t2] of faces) {
      const A = P(e1), B = P(e2), C = P(t1), Dd = t2 && P(t2);
      const along = B.clone().sub(A).normalize();
      const n = new THREE.Vector3().subVectors(B, A).cross(new THREE.Vector3().subVectors(C, A)).normalize();
      const down = new THREE.Vector3().crossVectors(along, n).normalize().negate();
      if (down.y > 0) down.negate();
      const tris = Dd ? [[A, B, C], [A, C, Dd]] : [[A, B, C]];
      for (const tri of tris) for (const p of tri) {
        pos.push(p.x, p.y, p.z);
        const q = p.clone().sub(C);
        uv.push(q.dot(down), q.dot(along));
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    return geo.translate(0, wallTop, 0);
  };
  const roof = new THREE.Mesh(build(1, 0), roofMat);
  const cap = new THREE.Mesh(build(snow, 0.05), S());
  for (const m of [roof, cap]) { m.castShadow = m.receiveShadow = true; g.add(m); }
  g.add(box(w + 0.22, 0.12, d + 0.22, flat(trim), 0, wallTop - 0.04, 0)); // eave cornice
  return wallTop + rise;
}

/** Flat roof (azotea): snow on the slab, a parapet or an iron rail round the edge. */
function addFlatRoof(g, { w, d, top, wall, rail = false, parapet = 0.3 }) {
  g.add(box(w + 0.16, 0.1, d + 0.16, flat(WHITE), 0, top + 0.05, 0));
  g.add(box(w - 0.1, 0.08, d - 0.1, S(), 0, top + 0.14, 0));
  const t = 0.12, W = flat(wall);
  if (parapet > 0) {
    for (const [sx, sz, lx, lz] of [[0, 1, w, t], [0, -1, w, t], [1, 0, t, d], [-1, 0, t, d]]) {
      g.add(box(lx, parapet, lz, W, sx * (w / 2 - t / 2), top + 0.1 + parapet / 2, sz * (d / 2 - t / 2)));
      g.add(box(lx + 0.02, 0.05, lz + 0.02, S(), sx * (w / 2 - t / 2), top + 0.12 + parapet, sz * (d / 2 - t / 2)));
    }
  }
  if (rail) addRail(g, { w, d, y: top + 0.1 + parapet, h: 0.32 });
}

/** Iron railing round a w × d rectangle at height y. */
function addRail(g, { w, d, y, h = 0.34, sides = [1, 1, 1, 1] }) {
  const I = flat(IRON);
  const runs = [[0, 1, w, 'x'], [0, -1, w, 'x'], [1, 0, d, 'z'], [-1, 0, d, 'z']];
  runs.forEach(([sx, sz, len, ax], i) => {
    if (!sides[i]) return;
    const cx = sx * (w / 2 - 0.03), cz = sz * (d / 2 - 0.03);
    g.add(box(ax === 'x' ? len : 0.04, 0.04, ax === 'x' ? 0.04 : len, I, cx, y + h, cz));
    g.add(box(ax === 'x' ? len - 0.04 : 0.03, 0.03, ax === 'x' ? 0.03 : len - 0.04, S(), cx, y + h + 0.035, cz));
    for (let t = -len / 2 + 0.06; t <= len / 2 - 0.05; t += 0.1) {
      g.add(box(0.025, h, 0.025, I, ax === 'x' ? t : cx, y + h / 2, ax === 'x' ? cz : t));
    }
  });
}

/**
 * Tall window or balcony door facing +z, bottom at y: casing, glass, a mullion, a snowy
 * sill, optional louvred shutters folded open, a round arch on top, an iron grille.
 */
function tallWindow(g, { x = 0, y = 0, z = 0, rotY = 0, w = 0.48, h = 0.9, frame = WHITE, shutter = null, arch = false, grille = false, hood = true }) {
  const win = new THREE.Group();
  const F = flat(frame), Fd = flat(ramp4(frame)[2]);
  win.add(box(w, h, 0.04, glass(), 0, h / 2, -0.01));
  win.add(box(0.05, h, 0.06, F, 0, h / 2, 0));
  win.add(box(w, 0.05, 0.06, F, 0, h * 0.7, 0));
  for (const s of [-1, 1]) win.add(box(0.08, h + 0.08, 0.08, F, s * (w / 2 + 0.04), h / 2, 0.01));
  win.add(box(w + 0.24, 0.07, 0.15, Fd, 0, -0.035, 0.05));
  win.add(box(w + 0.2, 0.04, 0.12, S(), 0, 0.02, 0.05));
  if (arch) {
    const half = new THREE.Mesh(new THREE.CircleGeometry(w / 2, 6, 0, Math.PI), glass());
    half.position.set(0, h, -0.01);
    const ring = new THREE.Mesh(new THREE.RingGeometry(w / 2, w / 2 + 0.09, 6, 1, 0, Math.PI), F);
    ring.position.set(0, h, 0.03);
    win.add(half, ring);
    win.add(box(0.1, 0.06, 0.1, S(), 0, h + w / 2 + 0.1, 0.03));
  } else {
    win.add(box(w + 0.2, 0.09, 0.1, F, 0, h + 0.08, 0.02));
    if (hood) win.add(box(w + 0.16, 0.05, 0.09, S(), 0, h + 0.15, 0.02));
  }
  if (shutter) {
    const L = louverMat(shutter);
    for (const s of [-1, 1]) win.add(box(w * 0.5, h, 0.05, L, s * (w / 2 + 0.1 + w * 0.25), h / 2, 0));
  }
  if (grille) {
    const I = flat(IRON);
    for (let i = -1.5; i <= 1.5; i++) win.add(box(0.03, h + 0.05, 0.03, I, (i * w) / 4, h / 2, 0.1));
    for (const yy of [0.1, h / 2, h - 0.05]) win.add(box(w + 0.06, 0.03, 0.03, I, 0, yy, 0.1));
    win.add(box(w + 0.1, 0.03, 0.18, I, 0, 0.02, 0.06));
  }
  win.position.set(x, y, z);
  win.rotation.y = rotY;
  g.add(win);
  return win;
}

/** A small iron balcony facing +z: stone slab with snow, brackets, a railing. y is its floor. */
function balcony(g, { x = 0, y = 0, z = 0, rotY = 0, w = 0.8, dep = 0.34, pots = 0, potColors = ['#e23a3a', '#f2c94c'] }) {
  const b = new THREE.Group();
  b.add(box(w, 0.08, dep, stoneMat(GRANITE), 0, -0.04, dep / 2));
  b.add(box(w - 0.04, 0.04, dep - 0.04, S(), 0, 0.02, dep / 2));
  for (const s of [-1, 1]) b.add(box(0.07, 0.14, dep * 0.7, flat(GRANITE[2]), s * (w / 2 - 0.1), -0.14, dep * 0.4));
  addRail(b, { w, d: dep * 2, y: 0, h: 0.36, sides: [1, 0, 1, 1] }); // centred on the wall: the back half is hidden in it
  for (let i = 0; i < pots; i++) {
    const px = -w / 2 + 0.16 + (i * (w - 0.3)) / Math.max(1, pots - 1);
    b.add(box(0.13, 0.12, 0.13, flat(TERRACOTTA[1]), px, 0.1, dep - 0.12));
    b.add(box(0.15, 0.08, 0.15, flat('#2f7a52'), px, 0.2, dep - 0.12));
    b.add(box(0.06, 0.06, 0.06, flat(potColors[i % potColors.length]), px, 0.26, dep - 0.1));
  }
  b.position.set(x, y, z);
  b.rotation.y = rotY;
  g.add(b);
  return b;
}

/** Spanish chimney: a rendered stack with a little tiled hat. Returns the smoke point. */
function chimney(g, x, y, z, h = 0.9, color = WHITE, tile = TERRACOTTA) {
  g.add(box(0.36, h, 0.36, flat(color), x, y + h / 2, z));
  g.add(box(0.44, 0.06, 0.44, flat(ramp4(color)[2]), x, y + h + 0.03, z));
  for (const s of [-1, 1]) g.add(box(0.06, 0.16, 0.06, flat(color), x + s * 0.13, y + h + 0.14, z));
  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.2, 4).rotateY(Math.PI / 4), flat(tile[1]));
  hat.position.set(x, y + h + 0.32, z);
  g.add(hat);
  const snow = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.12, 4).rotateY(Math.PI / 4), S());
  snow.position.set(x, y + h + 0.39, z);
  g.add(snow);
  return new THREE.Vector3(x, y + h + 0.3, z);
}

/** Band round the walls (floor lines, cornices). */
const band = (g, w, d, y, color = WHITE, h = 0.08, out = 0.06) => g.add(box(w + out * 2, h, d + out * 2, flat(color), 0, y, 0));

/** Plinth: a stone footing round the base. */
const plinth = (g, w, d, h = 0.32, R = GRANITE) => g.add(box(w + 0.12, h, d + 0.12, stoneMat(R), 0, h / 2, 0));

// =====================================================================================
// Madrid houses
// =====================================================================================

/** Corrala: three storeys of warm stucco, iron balconies, green shutters, a clay hip roof. */
export function makeCorrala(v = 0) {
  const wall = pick(['#e2a85a', '#e58f6c', '#efd6a2', '#d9785a'], v);
  const shut = pick(['#2f6b3f', '#2f5f7a', '#2f6b3f', '#6b3a2a'], v);
  const g = new THREE.Group();
  const w = 4.0, d = 3.2, base = 0.3, fh = 1.1, n = 3, top = base + fh * n;
  plinth(g, w, d);
  g.add(box(w, fh * n, d, stuccoMat(wall), 0, base + (fh * n) / 2, 0));
  for (let f = 1; f < n; f++) band(g, w, d, base + fh * f, WHITE, 0.07, 0.04);
  addDoor(g, { x: -1.1, z: d / 2 + 0.02, y0: base, color: '#3f5f3a', frame: '#5a3218', lamp: true, wreath: v % 2 === 0, pane: false });
  tallWindow(g, { x: 0.35, y: base + 0.22, z: d / 2 + 0.02, w: 0.62, h: 0.72, grille: true });
  tallWindow(g, { x: 1.35, y: base + 0.22, z: d / 2 + 0.02, w: 0.5, h: 0.72, grille: true });
  for (let f = 1; f < n; f++) {
    const y = base + fh * f + 0.08;
    for (const x of [-1.2, 0, 1.2]) {
      tallWindow(g, { x, y, z: d / 2 + 0.02, w: 0.46, h: 0.82, shutter: shut });
      balcony(g, { x, y, z: d / 2, w: 0.78, pots: f === 1 ? 2 : 0 });
    }
    for (const z of [-0.8, 0.8]) {
      tallWindow(g, { x: w / 2 + 0.02, y, z, rotY: Math.PI / 2, w: 0.44, h: 0.8, shutter: shut });
      if (f === n - 1) balcony(g, { x: w / 2, y, z, rotY: Math.PI / 2, w: 0.7 });
    }
  }
  tallWindow(g, { x: w / 2 + 0.02, y: base + 0.25, z: 0, rotY: Math.PI / 2, w: 0.44, h: 0.66, grille: true });
  const ridge = addHipRoof(g, { w, d, wallTop: top, rise: 1.0, roofMat: tejaMat(TERRACOTTA) });
  g.userData.chimney = chimney(g, 1.0, top + 0.4, -0.6, ridge - top);
  chimney(g, -1.2, top + 0.3, 0.5, ridge - top - 0.1);
  return finish(g, w, d);
}

/** Neo-mudéjar brick house: red brick, round-arched windows, a crenellated flat roof. */
export function makeBrickHouse(v = 0) {
  const R = pick([['#e07a52', '#b8502f', '#8a3a24', '#5a2418'], ['#e8945e', '#c4663a', '#924828', '#5e2c18'], ['#d86a58', '#a9443a', '#7c2f2a', '#4e1c1c']], v);
  const g = new THREE.Group();
  const w = 3.6, d = 3.2, base = 0.28, fh = 1.15, n = 2, top = base + fh * n;
  plinth(g, w, d, base, GRANITE);
  g.add(box(w, fh * n, d, brickMat(R), 0, base + (fh * n) / 2, 0));
  band(g, w, d, base + fh, WHITE, 0.1, 0.04);
  // a band of white diamonds in the brick, mudéjar style
  for (let i = -3; i <= 3; i++) {
    const dm = box(0.16, 0.16, 0.04, flat(WHITE), i * 0.5, top - 0.25, d / 2 + 0.02);
    dm.rotation.z = Math.PI / 4;
    g.add(dm);
    if (Math.abs(i) <= 2) {
      const ds = box(0.04, 0.16, 0.16, flat(WHITE), w / 2 + 0.02, top - 0.25, i * 0.55);
      ds.rotation.x = Math.PI / 4;
      g.add(ds);
    }
  }
  addDoor(g, { x: 0, z: d / 2 + 0.02, y0: base, w: 0.72, h: 1.0, color: '#6a3a22', frame: WHITE, lamp: true, pane: false });
  g.add(box(0.9, 0.1, 0.1, flat(WHITE), 0, base + 1.2, d / 2 + 0.03));
  for (const x of [-1.15, 1.15]) tallWindow(g, { x, y: base + 0.25, z: d / 2 + 0.02, w: 0.46, h: 0.6, arch: true, grille: true });
  for (const x of [-1.15, 0, 1.15]) {
    tallWindow(g, { x, y: base + fh + 0.15, z: d / 2 + 0.02, w: 0.44, h: 0.62, arch: true });
    if (x === 0) balcony(g, { x, y: base + fh + 0.15, z: d / 2, w: 0.8, pots: 2 });
  }
  for (const z of [-0.8, 0.8]) for (const f of [0, 1]) tallWindow(g, { x: w / 2 + 0.02, y: base + fh * f + 0.2, z, rotY: Math.PI / 2, w: 0.42, h: 0.6, arch: true });
  addFlatRoof(g, { w, d, top, wall: R[1], parapet: 0.22 });
  // stepped merlons on the parapet
  for (let x = -w / 2 + 0.2; x <= w / 2 - 0.1; x += 0.45) g.add(box(0.2, 0.22, 0.14, brickMat(R), x, top + 0.43, d / 2 - 0.06));
  for (let z = -d / 2 + 0.2; z <= d / 2 - 0.1; z += 0.45) g.add(box(0.14, 0.22, 0.2, brickMat(R), w / 2 - 0.06, top + 0.43, z));
  g.userData.chimney = chimney(g, -1.1, top, -0.8, 0.8, R[1]);
  return finish(g, w, d);
}

/** Habsburg mansion: brick with granite corners, a slate roof and two slate spires. */
export function makeSpireHouse(v = 0) {
  const R = pick([['#d9775a', '#a94a36', '#7c3428', '#4c1e1a'], ['#d88c5e', '#a85c38', '#7a4028', '#4a2618']], v);
  const g = new THREE.Group();
  const w = 5.0, d = 3.8, base = 0.32, fh = 1.15, top = base + fh * 2;
  plinth(g, w, d);
  g.add(box(w, fh * 2, d, brickMat(R, '#efe2cc'), 0, base + fh, 0));
  band(g, w, d, base + fh, GRANITE[1], 0.1);
  // granite quoins
  for (let y = base + 0.12, i = 0; y < top; y += 0.26, i++) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      g.add(box(i % 2 ? 0.22 : 0.38, 0.22, 0.05, flat(GRANITE[1]), sx * (w / 2 - (i % 2 ? 0.11 : 0.19)), y, sz * (d / 2 + 0.02)));
      g.add(box(0.05, 0.22, i % 2 ? 0.38 : 0.22, flat(GRANITE[1]), sx * (w / 2 + 0.02), y, sz * (d / 2 - (i % 2 ? 0.19 : 0.11))));
    }
  }
  // stone portal with a balcony above
  g.add(box(1.2, 1.4, 0.12, stoneMat(GRANITE), 0, base + 0.7, d / 2 + 0.04));
  addDoor(g, { x: 0, z: d / 2 + 0.1, y0: base, w: 0.74, h: 1.1, color: '#4a2a18', frame: GRANITE[2], lamp: false, wreath: true, pane: false });
  balcony(g, { x: 0, y: base + fh + 0.1, z: d / 2, w: 1.3, pots: 2 });
  tallWindow(g, { x: 0, y: base + fh + 0.1, z: d / 2 + 0.02, w: 0.56, h: 0.9, frame: GRANITE[0] });
  for (const x of [-1.25, 1.25]) for (const f of [0, 1]) tallWindow(g, { x, y: base + fh * f + 0.2, z: d / 2 + 0.02, w: 0.44, h: 0.72, frame: GRANITE[0], grille: f === 0 });
  for (const z of [-0.6, 0.7]) for (const f of [0, 1]) tallWindow(g, { x: w / 2 + 0.02, y: base + fh * f + 0.2, z, rotY: Math.PI / 2, w: 0.42, h: 0.7, frame: GRANITE[0] });
  addHipRoof(g, { w, d, wallTop: top, rise: 1.0, roofMat: slateMat(), trim: GRANITE[0] });
  // corner towers with slate spires and a gold ball
  for (const sx of [-1, 1]) {
    const tx = sx * (w / 2 - 0.55), tz = d / 2 - 0.55, th = top + 1.25;
    g.add(box(1.2, th - base, 1.2, brickMat(R, '#efe2cc'), tx, base + (th - base) / 2, tz));
    g.add(box(1.34, 0.12, 1.34, flat(GRANITE[0]), tx, th, tz));
    tallWindow(g, { x: tx, y: top + 0.3, z: tz + 0.61, w: 0.36, h: 0.56, frame: GRANITE[0] });
    tallWindow(g, { x: tx + 0.61, y: top + 0.3, z: tz, rotY: Math.PI / 2, w: 0.36, h: 0.56, frame: GRANITE[0] });
    const spire = new THREE.Mesh(new THREE.ConeGeometry(0.92, 1.9, 4).rotateY(Math.PI / 4), coneShingleMat(PAL.slate, 4, 6));
    spire.position.set(tx, th + 0.06 + 0.95, tz);
    g.add(spire);
    const sn = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 4).rotateY(Math.PI / 4), S());
    sn.position.set(tx, th + 0.06 + 1.5, tz);
    g.add(sn);
    g.add(box(0.05, 0.5, 0.05, flat(IRON), tx, th + 2.2, tz));
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), flat('#f2c94c'));
    ball.position.set(tx, th + 2.2, tz);
    g.add(ball);
  }
  g.userData.chimney = chimney(g, -0.6, top + 0.3, -0.9, 0.9, R[1]);
  return finish(g, w, d);
}

/** Plaza-Mayor house: a granite arcade on the ground floor, red-ochre storeys, balconies, a slate gable. */
export function makeArcadeHouse(v = 0) {
  const wall = pick(['#b5523a', '#c9764a', '#a8463a', '#d39a5a'], v);
  const g = new THREE.Group();
  const w = 4.4, d = 3.4, base = 0.15, ah = 1.35, fh = 1.05, top = base + ah + fh * 2;
  g.add(box(w, base, d, stoneMat(GRANITE), 0, base / 2, 0));
  // the shop wall stands back; the arcade carries the storeys above
  g.add(box(w - 0.2, ah, d - 0.9, stuccoMat('#efe2c8'), 0, base + ah / 2, -0.45));
  const arc = archWall(w, ah, 0.22, [-1.45, 0, 1.45].map((x) => ({ x, w: 1.0, h: ah - 0.55 })), stoneMat(GRANITE));
  arc.position.set(0, base, d / 2 - 0.11);
  g.add(arc);
  g.add(box(0.22, ah, d, stoneMat(GRANITE), w / 2 - 0.11, base + ah / 2, 0));
  addDoor(g, { x: -1.45, z: d / 2 - 0.88, y0: base, color: '#2f5f7a', frame: WHITE, lamp: false, pane: true });
  tallWindow(g, { x: 0.4, y: base + 0.25, z: d / 2 - 0.88, w: 1.2, h: 0.7, frame: '#2f5f7a' });
  g.add(box(1.6, 0.26, 0.06, flat('#2f5f7a'), 0.4, base + 1.18, d / 2 - 0.88)); // shop board
  for (let i = 0; i < 4; i++) g.add(box(0.2, 0.06, 0.07, flat('#f2c94c'), -0.05 + i * 0.3, base + 1.18, d / 2 - 0.84));
  const y0 = base + ah;
  g.add(box(w, fh * 2, d, stuccoMat(wall), 0, y0 + fh, 0));
  band(g, w, d, y0, GRANITE[0], 0.12, 0.05);
  band(g, w, d, y0 + fh, WHITE, 0.06, 0.03);
  for (let f = 0; f < 2; f++) {
    const y = y0 + fh * f + 0.12;
    for (const x of [-1.45, 0, 1.45]) {
      tallWindow(g, { x, y, z: d / 2 + 0.02, w: 0.46, h: 0.8 });
      balcony(g, { x, y, z: d / 2, w: 0.8, pots: f === 0 && x !== 0 ? 1 : 0 });
    }
    for (const z of [-0.8, 0.8]) tallWindow(g, { x: w / 2 + 0.02, y, z, rotY: Math.PI / 2, w: 0.44, h: 0.78 });
  }
  // the gable roof's ridge runs along z: build it turned, so the ridge runs along the facade
  const roof = new THREE.Group();
  const { ridgeY } = addGableRoof(roof, { w: d, d: w, wallTop: top, roofMat: slateMat(), trim: WHITE, over: 0.25, overZ: 0.2, rise: 1.0, brackets: false, kingPost: false });
  roof.rotation.y = Math.PI / 2;
  g.add(roof);
  for (const sx of [-1, 1]) { // the gable ends
    const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, 1.0)]);
    const m = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: 0.1, bevelEnabled: false }), stuccoMat(wall));
    m.rotation.y = Math.PI / 2;
    m.position.set(sx * (w / 2 - 0.05) - 0.05, top, 0);
    g.add(m);
  }
  // dormers on the front slope
  for (const x of [-1.2, 1.2]) {
    g.add(box(0.6, 0.6, 0.6, flat(WHITE), x, top + 0.45, d / 2 - 0.4));
    tallWindow(g, { x, y: top + 0.25, z: d / 2 - 0.09, w: 0.32, h: 0.4, hood: false });
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.36, 4).rotateY(Math.PI / 4), slateMat());
    cap.position.set(x, top + 0.93, d / 2 - 0.4);
    g.add(cap);
    const cs = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.2, 4).rotateY(Math.PI / 4), S());
    cs.position.set(x, top + 1.02, d / 2 - 0.4);
    g.add(cs);
  }
  g.userData.chimney = chimney(g, 1.5, top + 0.3, -0.7, ridgeY - top);
  return finish(g, w, d);
}

/** Casita: a whitewashed one-storey house with a coloured skirting, iron grilles and geraniums. */
export function makeCasita(v = 0) {
  const trim = pick(['#2f6fae', '#e2a53a', '#3f8f6a', '#c24a3a'], v);
  const g = new THREE.Group();
  const w = 3.2, d = 2.8, base = 0.12, h = 1.45, top = base + h;
  g.add(box(w + 0.08, base, d + 0.08, stoneMat(GRANITE), 0, base / 2, 0));
  g.add(box(w, h, d, stuccoMat('#f6f1e6'), 0, base + h / 2, 0));
  g.add(box(w + 0.04, 0.32, d + 0.04, flat(trim), 0, base + 0.16, 0)); // zócalo
  addDoor(g, { x: -0.7, z: d / 2 + 0.02, y0: base, w: 0.62, h: 1.0, color: '#7a4a26', frame: trim, lamp: true, wreath: v % 2 === 1, pane: false });
  tallWindow(g, { x: 0.65, y: base + 0.4, z: d / 2 + 0.02, w: 0.56, h: 0.62, frame: trim, grille: true });
  tallWindow(g, { x: w / 2 + 0.02, y: base + 0.4, z: 0.2, rotY: Math.PI / 2, w: 0.5, h: 0.6, frame: trim, grille: true });
  // blue pots of red geraniums hung on the front wall
  for (const [x, y] of [[-1.3, 1.05], [0.2, 1.2], [1.25, 1.2], [-0.15, 0.9]]) {
    g.add(box(0.16, 0.14, 0.12, flat('#2f6fae'), x, base + y, d / 2 + 0.08));
    g.add(box(0.2, 0.1, 0.16, flat('#2f7a52'), x, base + y + 0.12, d / 2 + 0.1));
    g.add(box(0.07, 0.07, 0.07, flat('#e23a3a'), x - 0.04, base + y + 0.19, d / 2 + 0.14));
  }
  g.add(box(0.12, 0.12, 0.12, flat('#f2c94c'), 1.0, base + 0.3, d / 2 + 0.3));
  const { ridgeY } = addGableRoof(g, { w, d, wallTop: top, wallMat: stuccoMat('#f6f1e6'), roofMat: tejaMat(TERRACOTTA), trim: '#f6f1e6', over: 0.25, overZ: 0.22, rise: 0.75, brackets: false, kingPost: false });
  g.userData.chimney = chimney(g, 0.75, top + 0.2, -0.5, ridgeY - top);
  return finish(g, w, d);
}

// =====================================================================================
// Barcelona houses
// =====================================================================================

/** Eixample block: chamfered corner (xamfrà), four storeys of balconies, a roof terrace. */
export function makeEixample(v = 0) {
  const wall = pick(['#e7d3ae', '#e2bfa0', '#d6dcc6', '#ecd9b8'], v);
  const shut = pick(['#2f6b3f', '#7a5a3a', '#2f5f7a', '#2f6b3f'], v);
  const g = new THREE.Group();
  const w = 4.0, d = 4.0, c = 1.3, base = 0.3, fh = 1.0, n = 4, top = base + fh * n;
  const plan = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2 - c], [w / 2 - c, d / 2], [-w / 2, d / 2]];
  g.add(prism(plan.map(([x, z]) => [x * 1.03, z * 1.03]), base, stoneMat(GOLD_STONE)));
  g.add(prism(plan, fh * n, stuccoMat(wall), base));
  for (let f = 1; f <= n; f++) {
    const sl = prism(plan.map(([x, z]) => [x * 1.02 + Math.sign(x) * 0.02, z * 1.02 + Math.sign(z) * 0.02]), 0.07, flat(WHITE), base + fh * f - 0.035);
    g.add(sl);
  }
  const cx = w / 2 - c / 2, cz = d / 2 - c / 2, q = Math.PI / 4;
  const out = (k) => [cx + Math.SQRT1_2 * k, cz + Math.SQRT1_2 * k];
  // ground floor: a shop on the corner, a door in front
  addDoor(g, { x: -1.3, z: d / 2 + 0.02, y0: base, w: 0.66, h: 1.0, color: '#5a3a22', frame: WHITE, lamp: true, pane: true });
  tallWindow(g, { x: -0.1, y: base + 0.1, z: d / 2 + 0.02, w: 0.8, h: 0.75, frame: '#7a2a2a' });
  { const [x, z] = out(0.02); tallWindow(g, { x, y: base + 0.1, z, rotY: q, w: 0.8, h: 0.75, frame: '#7a2a2a' }); }
  tallWindow(g, { x: w / 2 + 0.02, y: base + 0.1, z: -0.4, rotY: Math.PI / 2, w: 0.8, h: 0.75, frame: '#7a2a2a' });
  for (let f = 1; f < n; f++) {
    const y = base + fh * f + 0.08;
    for (const x of [-1.35, -0.25]) { tallWindow(g, { x, y, z: d / 2 + 0.02, w: 0.42, h: 0.74, shutter: shut }); balcony(g, { x, y, z: d / 2, w: 0.74, pots: f === 1 ? 1 : 0 }); }
    for (const z of [-1.35, -0.25]) { tallWindow(g, { x: w / 2 + 0.02, y, z, rotY: Math.PI / 2, w: 0.42, h: 0.74, shutter: shut }); balcony(g, { x: w / 2, y, z, rotY: Math.PI / 2, w: 0.74 }); }
    const [x, z] = out(0.02);
    tallWindow(g, { x, y, z, rotY: q, w: 0.48, h: 0.78, shutter: shut });
    balcony(g, { x, y, z, rotY: q, w: 1.2, pots: 2, potColors: ['#e23a3a', '#d14fa0'] });
  }
  // terrace: a slab, snow on it, an iron rail, the stair hut and a water tank
  g.add(prism(plan.map(([x, z]) => [x * 1.03, z * 1.03]), 0.1, flat(WHITE), top));
  g.add(prism(plan.map(([x, z]) => [x * 0.98, z * 0.98]), 0.08, S(), top + 0.1));
  g.add(box(1.2, 0.8, 1.0, stuccoMat(wall), -1.1, top + 0.5, -1.2));
  g.add(box(1.3, 0.08, 1.1, S(), -1.1, top + 0.94, -1.2));
  g.add(box(0.5, 0.7, 0.06, flat('#5a3a22'), -1.1, top + 0.45, -0.68));
  const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8), flat('#c9ccd4'));
  tank.position.set(0.9, top + 0.42, -1.3);
  g.add(tank);
  addRail(g, { w: w - 0.1, d: d - 0.1, y: top + 0.1, h: 0.3, sides: [0, 1, 0, 1] });
  g.userData.chimney = chimney(g, 0.2, top + 0.1, -1.4, 0.7, wall);
  return finish(g, w, d);
}

/** Modernista house: mosaic walls, wavy stone ground floor, curling balconies, a humped tiled roof. */
export function makeModernista(v = 0) {
  const pal = pick([['#5fb0c9', '#3f8fb0', '#8fd0c8', '#2f6f9a', '#e9c46a'], ['#7cc49a', '#3f9a6a', '#c7e08a', '#2f7a5a', '#f2a65a'], ['#e48fb0', '#b85a8a', '#f2c94c', '#8a5ab0', '#5fb0c9']], v);
  const g = new THREE.Group();
  const w = 3.6, d = 3.2, base = 0.2, gh = 1.3, fh = 1.0, top = base + gh + fh * 2;
  g.add(box(w, base, d, stoneMat(GOLD_STONE), 0, base / 2, 0));
  g.add(box(w - 0.3, gh, d - 0.3, stuccoMat('#efe2c8'), 0, base + gh / 2, -0.1));
  const arc = archWall(w, gh, 0.26, [{ x: -0.9, w: 1.1, h: 0.55 }, { x: 0.75, w: 1.3, h: 0.45 }], stoneMat(GOLD_STONE));
  arc.position.set(0, base, d / 2 - 0.13);
  g.add(arc);
  g.add(box(0.26, gh, d, stoneMat(GOLD_STONE), w / 2 - 0.13, base + gh / 2, 0));
  addDoor(g, { x: -0.9, z: d / 2 - 0.27, y0: base, w: 0.7, h: 1.05, color: '#6a4a2a', frame: GOLD_STONE[2], lamp: false, pane: true });
  tallWindow(g, { x: 0.75, y: base + 0.1, z: d / 2 - 0.27, w: 1.0, h: 0.75, frame: GOLD_STONE[2] });
  const y0 = base + gh;
  g.add(box(w, fh * 2, d, mosaicMat(pal, v + 3), 0, y0 + fh, 0));
  band(g, w, d, y0, GOLD_STONE[0], 0.1, 0.05);
  // windows framed by bone-like stone columns; curling iron balconies
  for (let f = 0; f < 2; f++) {
    const y = y0 + fh * f + 0.12;
    for (const x of [-1.0, 1.0]) {
      tallWindow(g, { x, y, z: d / 2 + 0.02, w: 0.62, h: 0.7, frame: GOLD_STONE[1], arch: f === 1 });
      for (const s of [-1, 1]) {
        const col = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.78, 6), flat(GOLD_STONE[0]));
        col.position.set(x + s * 0.46, y + 0.39, d / 2 + 0.08);
        g.add(col);
      }
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.34, 8, 1, true, -Math.PI / 2, Math.PI), flat(IRON, { side: THREE.DoubleSide }));
      shell.position.set(x, y + 0.08, d / 2 + 0.02);
      g.add(shell);
      g.add(box(0.7, 0.04, 0.34, S(), x, y - 0.06, d / 2 + 0.2));
    }
    tallWindow(g, { x: w / 2 + 0.02, y, z: 0, rotY: Math.PI / 2, w: 0.6, h: 0.7, frame: GOLD_STONE[1], arch: f === 1 });
  }
  // the roof: a humped spine of glazed scales, mosaic chimneys
  g.add(box(w + 0.1, 0.12, d + 0.1, flat(GOLD_STONE[0]), 0, top + 0.06, 0));
  const scales = mosaicMat([pal[1], pal[3], pal[4], pal[0]], v + 11);
  const hump = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, w, 10, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), scales);
  hump.scale.set(1, 0.55, 1);
  hump.position.set(0, top + 0.12, 0);
  g.add(hump);
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, w + 0.1, 6).rotateZ(Math.PI / 2), flat(pal[4]));
  ridge.position.set(0, top + 0.12 + (d / 2) * 0.55, 0);
  g.add(ridge);
  for (let i = -2; i <= 2; i++) {
    const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.14, 0), S());
    knob.position.set(i * 0.7, top + 0.12 + (d / 2) * 0.55 + 0.14, 0);
    g.add(knob);
  }
  for (const [x, z, k] of [[-1.25, -1.1, 0], [1.3, -1.0, 2]]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.24, 1.0, 6), mosaicMat(pal, 20 + k));
    st.position.set(x, top + 0.9, z);
    g.add(st);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.4, 6), flat(pal[k]));
    cap.position.set(x, top + 1.6, z);
    g.add(cap);
    const cs = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.18, 6), S());
    cs.position.set(x, top + 1.72, z);
    g.add(cs);
  }
  g.userData.chimney = new THREE.Vector3(-1.25, top + 1.4, -1.1);
  return finish(g, w, d);
}

/** Gothic-quarter house: golden stone, a round-arched portal, twin windows, a bell gable. */
export function makeGothic(v = 0) {
  const R = pick([GOLD_STONE, ['#e3d6bd', '#c4b494', '#9c8a6a', '#6a5c44'], ['#e6c9a4', '#c8a27a', '#9e7a54', '#6a4e34']], v);
  const g = new THREE.Group();
  const w = 3.0, d = 3.2, base = 0.2, fh = 1.15, n = 3, top = base + fh * n;
  g.add(box(w + 0.1, base, d + 0.1, stoneMat(GRANITE), 0, base / 2, 0));
  g.add(box(w, fh * n, d, stoneMat(R), 0, base + (fh * n) / 2, 0));
  const portal = archWall(1.4, 1.5, 0.16, [{ x: 0, w: 0.8, h: 0.95 }], stoneMat(R.map((c) => ramp4(c)[0])));
  portal.position.set(-0.55, base, d / 2 + 0.06);
  g.add(portal);
  g.add(box(0.8, 1.35, 0.05, plankMat(['#9a6a3a', '#7a4a26', '#5a321a', '#3a1e10']), -0.55, base + 0.67, d / 2 - 0.0));
  tallWindow(g, { x: 0.85, y: base + 0.4, z: d / 2 + 0.02, w: 0.4, h: 0.6, frame: R[2], grille: true });
  for (let f = 1; f < n; f++) {
    const y = base + fh * f + 0.12;
    // twin arched windows with a slim column
    for (const x of [-0.55, 0.85]) {
      for (const s of [-1, 1]) tallWindow(g, { x: x + s * 0.2, y, z: d / 2 + 0.02, w: 0.3, h: 0.66, frame: R[2], arch: true });
      g.add(box(0.06, 0.66, 0.08, flat(R[0]), x, y + 0.33, d / 2 + 0.06));
      if (f === 1 && x < 0) balcony(g, { x, y, z: d / 2, w: 0.9, pots: 3, potColors: ['#e23a3a', '#f2c94c', '#d14fa0'] });
    }
    tallWindow(g, { x: w / 2 + 0.02, y, z: 0.4, rotY: Math.PI / 2, w: 0.38, h: 0.66, frame: R[2], arch: true });
    if (f === 2) balcony(g, { x: w / 2, y, z: 0.4, rotY: Math.PI / 2, w: 0.64, pots: 2 });
  }
  addFlatRoof(g, { w, d, top, wall: R[1], parapet: 0.35 });
  // bell gable (espadaña) over the front
  const gable = archWall(1.0, 1.1, 0.18, [{ x: 0, w: 0.4, h: 0.6, y: 0.3 }], stoneMat(R));
  gable.position.set(0.4, top + 0.1, d / 2 - 0.1);
  g.add(gable);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 0.24, 6), flat('#c9a24a'));
  bell.position.set(0.4, top + 0.62, d / 2 - 0.1);
  g.add(bell);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.3, 4).rotateY(Math.PI / 4), flat(R[2]));
  cap.scale.set(1, 1, 0.3);
  cap.position.set(0.4, top + 1.32, d / 2 - 0.1);
  g.add(cap);
  g.add(box(0.7, 0.05, 0.16, S(), 0.4, top + 1.22, d / 2 - 0.1));
  g.userData.chimney = chimney(g, -0.9, top + 0.1, -1.0, 0.8, R[1]);
  return finish(g, w, d);
}

/** Barceloneta house: narrow and tall, pastel, washing hung on every balcony. */
export function makeBarceloneta(v = 0) {
  const wall = pick(['#86c9bb', '#f2a7a0', '#f2cf6a', '#9ab7e0'], v);
  const shut = pick(['#2f6b3f', '#2f5f7a', '#a03a26', '#2f6b3f'], v);
  const g = new THREE.Group();
  const w = 2.4, d = 3.0, base = 0.25, fh = 1.0, n = 4, top = base + fh * n;
  plinth(g, w, d, base);
  g.add(box(w, fh * n, d, stuccoMat(wall), 0, base + (fh * n) / 2, 0));
  for (let f = 1; f < n; f++) band(g, w, d, base + fh * f, WHITE, 0.06, 0.03);
  addDoor(g, { x: -0.5, z: d / 2 + 0.02, y0: base, w: 0.6, h: 0.98, color: shut, frame: WHITE, lamp: false, pane: true });
  tallWindow(g, { x: 0.55, y: base + 0.25, z: d / 2 + 0.02, w: 0.46, h: 0.62, grille: true });
  const clothes = ['#e23a3a', '#ffffff', '#2f6fae', '#f2c94c', '#3f9a6a', '#d14fa0'];
  for (let f = 1; f < n; f++) {
    const y = base + fh * f + 0.08;
    tallWindow(g, { x: 0, y, z: d / 2 + 0.02, w: 0.48, h: 0.76, shutter: shut });
    balcony(g, { x: 0, y, z: d / 2, w: 1.5, dep: 0.38, pots: f === 3 ? 2 : 0 });
    // a washing line across the balcony
    g.add(box(1.4, 0.02, 0.02, flat('#d8dce4'), 0, y + 0.58, d / 2 + 0.34));
    for (let i = 0; i < 3; i++) {
      const cx = -0.5 + i * 0.45 + ((f * 7 + i) % 3) * 0.04;
      g.add(box(0.26, 0.24 + ((f + i) % 2) * 0.08, 0.02, flat(clothes[(f * 2 + i + v) % clothes.length]), cx, y + 0.44, d / 2 + 0.34));
    }
    tallWindow(g, { x: w / 2 + 0.02, y, z: -0.5, rotY: Math.PI / 2, w: 0.4, h: 0.7, shutter: shut });
  }
  addFlatRoof(g, { w, d, top, wall, parapet: 0.12, rail: true });
  g.add(box(0.04, 0.9, 0.04, flat(IRON), 0.7, top + 0.6, -0.9)); // tv aerial
  g.add(box(0.6, 0.03, 0.03, flat(IRON), 0.7, top + 0.95, -0.9));
  g.userData.chimney = chimney(g, -0.6, top + 0.1, -0.9, 0.6, wall);
  return finish(g, w, d);
}

// =====================================================================================
// Decorations (no session): trees, benches, lamps, fountains, ...
// =====================================================================================

const deco = (g, w, d) => { g.userData.footprint = { w, d }; return mergeStatic(g); };

/** Winter plane tree (plátano): mottled trunk, bare branches with snow, a few seed balls. */
export function makePlaneTree(v = 0) {
  const r = seeded(31 + v * 7);
  const g = new THREE.Group();
  const bark = patMat('bark-plane', () => patternTex(8, 8, (x, y) => ((x * 3 + y * 5) % 7 < 2 ? '#d8d0b0' : (x + y * 2) % 5 === 0 ? '#7a7a5a' : '#a8a080')));
  g.add(box(0.8, 0.12, 0.8, stoneMat(GRANITE), 0, 0.06, 0)); // tree pit kerb
  g.add(box(0.62, 0.06, 0.62, S(), 0, 0.14, 0));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.17, 1.9, 6), bark);
  trunk.position.y = 1.05;
  g.add(trunk);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + r() * 0.5, len = 0.9 + r() * 0.5, tilt = 0.5 + r() * 0.35;
    const br = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.07, len, 5), bark);
    br.position.set(Math.sin(a) * Math.sin(tilt) * len * 0.5, 1.9 + Math.cos(tilt) * len * 0.5, Math.cos(a) * Math.sin(tilt) * len * 0.5);
    br.rotation.set(Math.cos(a) * tilt, 0, -Math.sin(a) * tilt);
    g.add(br);
    const tip = br.position.clone().multiplyScalar(2).sub(new THREE.Vector3(0, 1.9, 0));
    g.add(box(0.14, 0.05, 0.14, S(), tip.x * 0.85, tip.y * 0.97 + 0.03, tip.z * 0.85));
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), flat('#8a6a3a'));
    ball.position.set(tip.x * 0.7, tip.y * 0.9 - 0.12, tip.z * 0.7);
    g.add(ball);
  }
  return deco(g, 0.9, 0.9);
}

/** Canary palm (Barcelona): a scaly trunk and a crown of fronds dusted with snow. */
export function makePalm(v = 0) {
  const g = new THREE.Group();
  const scale = patMat('palm-bark', () => patternTex(8, 8, (x, y) => ((x + (y >> 2) * 4) % 8 < 1 || (y & 3) === 3 ? '#6a4a2a' : (y & 3) === 0 ? '#b88a5a' : '#9a6e42')));
  const h = 2.6 + (v % 3) * 0.3;
  g.add(box(0.7, 0.14, 0.7, stoneMat(GOLD_STONE), 0, 0.07, 0));
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, h, 7), scale);
  trunk.position.y = h / 2;
  g.add(trunk);
  const knob = new THREE.Mesh(new THREE.IcosahedronGeometry(0.3, 0), flat('#5a7a2a'));
  knob.position.y = h + 0.05;
  g.add(knob);
  const leaf = flat('#3f8a3a'), leafD = flat('#2f6a2f');
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const f = new THREE.Group();
    f.position.y = h + 0.08;
    f.rotation.y = a;
    const fr = new THREE.Group();
    fr.rotation.x = 0.55 + (i % 3) * 0.18;
    f.add(fr);
    fr.add(box(0.05, 0.04, 1.3, i % 2 ? leaf : leafD, 0, 0, 0.65));
    fr.add(box(0.36, 0.03, 0.9, i % 2 ? leaf : leafD, 0, 0, 0.75));
    fr.add(box(0.2, 0.03, 0.5, S(), 0, 0.03, 0.55));
    g.add(f);
  }
  return deco(g, 0.8, 0.8);
}

/** Bitter orange tree in a square clay planter, oranges against the snow. */
export function makeOrangeTree() {
  const g = new THREE.Group();
  g.add(box(0.7, 0.45, 0.7, flat(TERRACOTTA[1]), 0, 0.225, 0));
  g.add(box(0.76, 0.06, 0.76, flat(TERRACOTTA[0]), 0, 0.48, 0));
  g.add(box(0.6, 0.04, 0.6, S(), 0, 0.5, 0));
  g.add(box(0.1, 0.6, 0.1, flat('#6a4a2a'), 0, 0.8, 0));
  const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), flat('#2f7a3f'));
  crown.position.y = 1.35;
  g.add(crown);
  const cap = new THREE.Mesh(new THREE.IcosahedronGeometry(0.4, 0), S());
  cap.scale.y = 0.45;
  cap.position.y = 1.72;
  g.add(cap);
  const r = seeded(5);
  for (let i = 0; i < 9; i++) {
    const a = r() * Math.PI * 2, y = 1.1 + r() * 0.45;
    g.add(box(0.1, 0.1, 0.1, flat('#f28a1e'), Math.sin(a) * 0.5, y, Math.cos(a) * 0.5));
  }
  return deco(g, 0.8, 0.8);
}

/** Italian cypress: tall, narrow, dark, with snow caught in its tiers. */
export function makeCypress(v = 0) {
  const g = new THREE.Group();
  const h = 2.6 + (v % 3) * 0.35;
  g.add(box(0.12, 0.3, 0.12, flat('#5a3a22'), 0, 0.15, 0));
  for (let i = 0; i < 4; i++) {
    const r = 0.36 - i * 0.06, hh = h / 3.2, y = 0.3 + i * hh * 0.7;
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, hh, 6), flat(i % 2 ? '#2a5a3a' : '#23503a'));
    c.position.y = y + hh / 2;
    g.add(c);
    const s = new THREE.Mesh(new THREE.ConeGeometry(r * 0.55, hh * 0.35, 6), S());
    s.position.y = y + hh * 0.85;
    g.add(s);
  }
  return deco(g, 0.6, 0.6);
}

/** A cluster of clay pots with geraniums and a little rosemary. */
export function makeFlowerPots(v = 0) {
  const g = new THREE.Group();
  const flowers = pick([['#e23a3a', '#d14fa0', '#f2c94c'], ['#e23a3a', '#ffffff', '#e23a3a'], ['#9a5ad0', '#d14fa0', '#f2a65a']], v);
  for (const [x, z, s, k] of [[-0.25, 0.1, 1, 0], [0.22, -0.15, 0.8, 1], [0.2, 0.28, 0.65, 2], [-0.1, -0.3, 0.7, 0]]) {
    g.add(box(0.28 * s, 0.3 * s, 0.28 * s, flat(TERRACOTTA[1]), x, 0.15 * s, z));
    g.add(box(0.32 * s, 0.05, 0.32 * s, flat(TERRACOTTA[0]), x, 0.3 * s, z));
    g.add(box(0.3 * s, 0.14, 0.3 * s, flat('#2f7a52'), x, 0.36 * s, z));
    for (const [dx, dz] of [[-0.06, 0.05], [0.07, -0.04], [0, 0.08]]) g.add(box(0.07, 0.07, 0.07, flat(flowers[(k + Math.round(dx * 50)) % 3] || flowers[k]), x + dx * s, 0.45 * s, z + dz * s));
    g.add(box(0.2 * s, 0.03, 0.2 * s, S(), x, 0.45 * s + 0.05, z));
  }
  return deco(g, 0.9, 0.9);
}

/** Madrid street lamp: a cast-iron column on a fluted base and a four-sided lantern. */
export function makeMadridLamp() {
  const g = new THREE.Group();
  const I = flat(IRON), Il = flat('#454a58');
  g.add(box(0.36, 0.12, 0.36, stoneMat(GRANITE), 0, 0.06, 0));
  g.add(box(0.26, 0.4, 0.26, I, 0, 0.32, 0));
  g.add(box(0.32, 0.06, 0.32, Il, 0, 0.53, 0));
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 1.7, 6), I);
  col.position.y = 1.4;
  g.add(col);
  for (const y of [0.9, 1.8]) g.add(box(0.14, 0.05, 0.14, Il, 0, y, 0));
  g.add(box(0.06, 0.05, 0.5, I, 0, 2.2, 0)); // crossbar (for the lamplighter's ladder)
  g.add(box(0.2, 0.06, 0.2, Il, 0, 2.28, 0));
  const lantern = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.13, 0.36, 4, 1).rotateY(Math.PI / 4), glowMat('#ffcf7a', 3.2));
  lantern.position.y = 2.5;
  g.add(lantern);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.03, 0.38, 0.03, I, sx * 0.12, 2.5, sz * 0.12));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.2, 4).rotateY(Math.PI / 4), I);
  cap.position.y = 2.78;
  g.add(cap);
  const snow = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.1, 4).rotateY(Math.PI / 4), S());
  snow.position.y = 2.84;
  g.add(snow);
  g.add(box(0.05, 0.12, 0.05, Il, 0, 2.94, 0));
  return deco(g, 0.4, 0.4);
}

/** Barcelona modernista lamp: a mosaic bench-base, a green iron mast, two curling arms. */
export function makeBarcelonaLamp() {
  const g = new THREE.Group();
  const G = flat('#2f5a4a'), Gl = flat('#3f7a62');
  g.add(box(0.5, 0.35, 0.5, mosaicMat(['#3f8fb0', '#e9c46a', '#c24a3a', '#7cc49a'], 7), 0, 0.175, 0));
  g.add(box(0.56, 0.05, 0.56, flat(WHITE), 0, 0.37, 0));
  g.add(box(0.44, 0.04, 0.44, S(), 0, 0.41, 0));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.09, 2.4, 6), G);
  mast.position.y = 1.55;
  g.add(mast);
  g.add(box(0.14, 0.06, 0.14, Gl, 0, 1.2, 0));
  for (const s of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 4, 8, Math.PI), G);
    arm.rotation.y = s > 0 ? 0 : Math.PI;
    arm.position.set(s * 0.28, 2.6, 0);
    g.add(arm);
    const lamp = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), glowMat('#ffd890', 3.2));
    lamp.position.set(s * 0.56, 2.45, 0);
    g.add(lamp);
    g.add(box(0.12, 0.05, 0.12, G, s * 0.56, 2.6, 0));
    g.add(box(0.09, 0.03, 0.09, S(), s * 0.56, 2.64, 0));
  }
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), Gl);
  top.position.y = 2.95;
  g.add(top);
  return deco(g, 0.6, 0.6);
}

/** Park bench: wooden slats on cast-iron sides, snow on the seat. */
export function makeParkBench() {
  const g = new THREE.Group();
  const I = flat(IRON), wood = flat('#a8683a');
  for (const s of [-1, 1]) {
    g.add(box(0.07, 0.42, 0.42, I, s * 0.68, 0.21, 0));
    g.add(box(0.07, 0.5, 0.06, I, s * 0.68, 0.65, -0.2));
  }
  for (let i = 0; i < 3; i++) g.add(box(1.5, 0.05, 0.11, wood, 0, 0.42, -0.14 + i * 0.13));
  for (let i = 0; i < 2; i++) g.add(box(1.5, 0.1, 0.04, wood, 0, 0.6 + i * 0.16, -0.22));
  g.add(box(1.3, 0.04, 0.3, S(), 0, 0.46, 0.02));
  return deco(g, 1.6, 0.6);
}

/** Mosaic bench: a curving run of trencadís seat blocks with a rolled back. */
export function makeMosaicBench(v = 0) {
  const pal = pick([['#3f8fb0', '#e9c46a', '#c24a3a', '#7cc49a', '#f2efe6'], ['#e48fb0', '#5fb0c9', '#f2c94c', '#3f9a6a', '#f2efe6']], v);
  const g = new THREE.Group();
  const M = mosaicMat(pal, 40 + v), B = mosaicMat([pal[0], pal[3], pal[1], pal[0]], 50 + v);
  const R = 2.2, n = 7, span = 0.75; // a slice of a wide curve, seen from its outer side
  for (let i = 0; i < n; i++) {
    const a = -span / 2 + (i / (n - 1)) * span;
    const seg = new THREE.Group();
    seg.position.set(Math.sin(a) * R, 0, Math.cos(a) * R - R);
    seg.rotation.y = a;
    seg.add(box(0.36, 0.4, 0.42, M, 0, 0.2, 0.05));
    seg.add(box(0.34, 0.04, 0.36, S(), 0, 0.42, 0.07));
    const lift = 0.06 * Math.cos((i / (n - 1) - 0.5) * Math.PI); // the back swells in the middle
    seg.add(box(0.36, 0.5 + lift, 0.12, B, 0, 0.6 + lift / 2, -0.2));
    seg.add(box(0.36, 0.12, 0.2, B, 0, 0.88 + lift, -0.16)); // rolled top
    seg.add(box(0.32, 0.04, 0.16, S(), 0, 0.96 + lift, -0.16));
    g.add(seg);
  }
  return deco(g, 1.8, 0.8);
}

/** Fountain: a round granite basin with a frozen pool and a tiered column. */
export function makeFountain() {
  const g = new THREE.Group();
  const St = stoneMat(GRANITE);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.2, 0.45, 12), St);
  rim.position.y = 0.225;
  g.add(rim);
  const ice = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.06, 12), flat('#a8d8ec', { roughness: 0.2 }));
  ice.position.y = 0.42;
  g.add(ice);
  const snowRim = new THREE.Mesh(new THREE.CylinderGeometry(1.16, 1.16, 0.05, 12, 1, true), S());
  snowRim.position.y = 0.47;
  g.add(snowRim);
  const col = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.22, 1.1, 8), St);
  col.position.y = 0.95;
  g.add(col);
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.2, 0.22, 10), St);
  bowl.position.y = 1.45;
  g.add(bowl);
  const bowlSnow = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 10), S());
  bowlSnow.position.y = 1.57;
  g.add(bowlSnow);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.45, 6), St);
  top.position.y = 1.8;
  g.add(top);
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), St);
  ball.position.y = 2.08;
  g.add(ball);
  // icicles where the water froze over the bowl's lip
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const ic = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.24, 4).rotateX(Math.PI), flat('#cdeefa'));
    ic.position.set(Math.sin(a) * 0.48, 1.24, Math.cos(a) * 0.48);
    g.add(ic);
  }
  return deco(g, 2.4, 2.4);
}

/** Newspaper kiosk: green iron, a roof with a lip of snow, magazines in the window. */
export function makeKiosk() {
  const g = new THREE.Group();
  const G = flat('#2f5a4a'), Gl = flat('#3f7a62');
  g.add(box(1.4, 0.12, 1.1, stoneMat(GRANITE), 0, 0.06, 0));
  g.add(box(1.2, 1.3, 0.9, G, 0, 0.77, 0));
  g.add(box(0.9, 0.5, 0.05, glass(), 0, 1.05, 0.46));
  const mags = ['#e23a3a', '#f2c94c', '#2f6fae', '#ffffff', '#d14fa0', '#3f9a6a'];
  for (let i = 0; i < 6; i++) g.add(box(0.12, 0.16, 0.04, flat(mags[i]), -0.36 + i * 0.145, 0.62, 0.47));
  g.add(box(1.0, 0.06, 0.24, Gl, 0, 0.5, 0.55));
  g.add(box(0.05, 0.4, 0.8, glass(), 0.61, 1.05, 0));
  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.45, 4).rotateY(Math.PI / 4), G);
  roof.scale.set(1.15, 1, 0.95);
  roof.position.y = 1.65;
  g.add(roof);
  const sn = new THREE.Mesh(new THREE.ConeGeometry(0.8, 0.32, 4).rotateY(Math.PI / 4), S());
  sn.scale.set(1.15, 1, 0.95);
  sn.position.y = 1.76;
  g.add(sn);
  g.add(box(1.3, 0.2, 0.04, flat('#f2c94c'), 0, 1.5, 0.52));
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), flat('#f2c94c'));
  ball.position.y = 2.0;
  g.add(ball);
  return deco(g, 1.5, 1.3);
}

/** Café terrace: a round table, two bistro chairs and a parasol. */
export function makeCafeTable(v = 0) {
  const g = new THREE.Group();
  const I = flat(IRON);
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 10), flat('#e8e2d4'));
  top.position.y = 0.62;
  g.add(top);
  g.add(box(0.05, 0.6, 0.05, I, 0, 0.3, 0));
  g.add(box(0.3, 0.04, 0.3, I, 0, 0.02, 0));
  const cups = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.07, 6), flat('#ffffff'));
  cups.position.set(0.1, 0.68, 0.05);
  g.add(cups);
  for (const s of [-1, 1]) {
    const cx = s * 0.55;
    g.add(box(0.36, 0.05, 0.36, flat('#a8683a'), cx, 0.42, 0));
    for (const dx of [-0.15, 0.15]) for (const dz of [-0.15, 0.15]) g.add(box(0.03, 0.42, 0.03, I, cx + dx, 0.21, dz));
    g.add(box(0.03, 0.4, 0.34, I, cx + s * 0.17, 0.64, 0));
    g.add(box(0.3, 0.03, 0.3, S(), cx, 0.46, 0));
  }
  const color = pick(['#c8302a', '#2f6fae', '#2f7a52', '#e2a53a'], v);
  g.add(box(0.05, 1.7, 0.05, flat('#d8d4c8'), 0, 0.85, 0));
  const para = new THREE.Mesh(new THREE.ConeGeometry(1.0, 0.36, 8), flat(color));
  para.position.y = 1.82;
  g.add(para);
  const ps = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.22, 8), S());
  ps.position.y = 1.92;
  g.add(ps);
  return deco(g, 1.5, 1.0);
}

/** Flower stall, as on the Rambla: a green cabin under an awning, buckets of flowers out front. */
export function makeFlowerStall() {
  const g = new THREE.Group();
  const G = flat('#2f5a4a');
  g.add(box(1.6, 1.2, 0.9, G, 0, 0.6, -0.2));
  g.add(box(1.8, 0.08, 1.4, flat('#e8e2d4'), 0, 1.6, 0.05));
  g.add(box(1.7, 0.06, 1.3, S(), 0, 1.67, 0.05));
  for (const s of [-1, 1]) g.add(box(0.06, 1.6, 0.06, G, s * 0.85, 0.8, 0.7));
  const cols = ['#e23a3a', '#f2c94c', '#d14fa0', '#ffffff', '#f28a1e', '#9a5ad0'];
  for (let row = 0; row < 2; row++) for (let i = 0; i < 5; i++) {
    const x = -0.6 + i * 0.3, z = 0.35 + row * 0.25, y = 0.25 + (1 - row) * 0.3;
    g.add(box(0.2, 0.2, 0.18, flat('#7a7f8c'), x, y - 0.1, z));
    g.add(box(0.2, 0.1, 0.18, flat('#2f7a52'), x, y + 0.04, z));
    g.add(box(0.1, 0.08, 0.1, flat(cols[(i + row * 2) % cols.length]), x, y + 0.13, z));
    g.add(box(0.08, 0.08, 0.08, flat(cols[(i + row * 3 + 1) % cols.length]), x + 0.06, y + 0.1, z + 0.04));
  }
  g.add(box(1.2, 0.22, 0.04, flat('#f2c94c'), 0, 1.4, 0.26));
  return deco(g, 1.9, 1.5);
}

/** Christmas light arch, like the ones strung over Madrid's streets. */
export function makeLightArch(v = 0) {
  const g = new THREE.Group();
  const col = pick(['#ffd890', '#a8d8ff', '#ff9a8a'], v);
  const I = flat(IRON);
  for (const s of [-1, 1]) {
    g.add(box(0.12, 2.6, 0.12, I, s * 1.5, 1.3, 0));
    g.add(box(0.26, 0.1, 0.26, stoneMat(GRANITE), s * 1.5, 0.05, 0));
  }
  const arc = new THREE.Mesh(new THREE.TorusGeometry(1.5, 0.05, 4, 16, Math.PI), I);
  arc.position.y = 2.6;
  g.add(arc);
  const bulb = glowMat(col, 3.4);
  for (let i = 0; i <= 12; i++) {
    const a = (i / 12) * Math.PI;
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), bulb);
    b.position.set(Math.cos(a) * 1.5, 2.6 + Math.sin(a) * 1.5, 0.05);
    g.add(b);
  }
  // a star in the middle
  const st = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? 0.14 : 0.32;
    k ? st.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : st.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 0.06, bevelEnabled: false }), bulb);
  star.position.set(0, 3.55, 0);
  g.add(star);
  return deco(g, 3.4, 0.5);
}

/** A heap of wrapped presents in the snow. */
export function makeGifts(v = 0) {
  const g = new THREE.Group();
  const r = seeded(9 + v);
  const cols = ['#c8302a', '#2f7a52', '#2f6fae', '#f2c94c', '#d14fa0', '#ffffff'];
  for (let i = 0; i < 6; i++) {
    const s = 0.2 + r() * 0.18, x = (r() - 0.5) * 0.6, z = (r() - 0.5) * 0.6, y = i > 3 ? 0.32 : 0;
    const c = cols[Math.floor(r() * cols.length)], rib = c === '#f2c94c' ? '#c8302a' : '#f2c94c';
    g.add(box(s, s, s, flat(c), x, y + s / 2, z));
    g.add(box(s + 0.01, s + 0.01, 0.04, flat(rib), x, y + s / 2, z));
    g.add(box(0.04, s + 0.01, s + 0.01, flat(rib), x, y + s / 2, z));
    g.add(box(0.1, 0.06, 0.1, flat(rib), x, y + s + 0.03, z));
  }
  return deco(g, 0.9, 0.9);
}
