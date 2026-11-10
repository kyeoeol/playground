import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { box, mat, glowMat, nightGlow, makeIcicles } from './props.js';
import { hexToHsl, hslToHex, canvasTex, pixelTexture } from './pixelArt.js';
import { clamp } from '../core/rand.js';

/*
 * Retro 16-bit isometric building kit.
 *  - Scale: 1 world unit = 16 art pixels = 16 texels. Box UVs are in world units, so a
 *    pattern texture of N texels repeats every N/16 units and one texel is one art pixel.
 *  - Clean patterns only (logs, planks, shingles, stone courses): flat tones on a regular
 *    grid, no random speckle. Small parts (frames, sills, trims) are flat-coloured boxes,
 *    so each face is one tone and the outline pass gives crisp edges.
 *  - Ramps are 4 tones: [highlight, base, shade, seam].
 *
 * NOTE: props.js imports this module and this module imports props.js. Only call the
 * props.js helpers inside functions (never at module top level).
 */

export const TPU = 16; // texels per world unit
export const SNOW_C = '#f3f8fc';

export const PAL = {
  log: ['#eaa55e', '#c4743c', '#934c28', '#5a2a16'],
  red: ['#ff7f5e', '#dc4430', '#a32a24', '#601a1c'],
  teal: ['#6ad6cc', '#2f9e98', '#1d6a6e', '#123e4a'],
  orange: ['#ffbc5c', '#ec8030', '#b0521f', '#6a2c14'],
  slate: ['#9aa7c0', '#68748e', '#47506a', '#2a3048'],
  brown: ['#c88a50', '#985a32', '#693b20', '#3e2012'],
  shake: ['#8e6444', '#6a452c', '#4c2e1c', '#2e1a10'],
  stone: ['#d6dae6', '#a8adc2', '#7c819c', '#52566f'],
  barn: ['#f2644a', '#c9342b', '#8f2121', '#561418'],
  plank: ['#dc9c5c', '#b27242', '#824a2a', '#4e2a16'],
  metal: ['#c4ccda', '#959fb2', '#6a7288', '#40465c'],
  cream: ['#fff6e2', '#f1e6cc', '#d6c6a4', '#a8946e'],
};

/** A 4-tone ramp [hi, base, shade, seam] from any colour: lights warm, shades cool. */
export function ramp4(hex) {
  const o = hexToHsl(hex);
  const t = (dh, ds, dl) => hslToHex(o.h + dh, o.s + ds, clamp(o.l + dl, 0.03, 0.97));
  const warm = o.h > 0.6 || o.h < 0.12 ? 0.012 : -0.012; // nudge hue toward orange
  return [t(warm, 0.06, 0.13), hex, t(-warm, 0.04, -0.11), t(-warm * 2, 0.02, -0.21)];
}

/** Flat colour, no texture. Each face gets one tone from the light. */
export const flat = (color, extra = {}) => mat(color, { plain: true, ...extra });

// ---- pattern textures --------------------------------------------------------------

export function patternTex(w, h, fn) {
  const t = canvasTex(w, h, (ctx, px) => { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y, fn(x, y)); });
  t.repeat.set(TPU / w, TPU / h);
  return t;
}

const patCache = new Map();
export function patMat(key, make) {
  if (!patCache.has(key)) patCache.set(key, new THREE.MeshStandardMaterial({ map: make(), roughness: 0.92, metalness: 0, flatShading: true }));
  return patCache.get(key);
}

/** Vertical planks, 4 texels wide, with nail heads. */
export const plankMat = (R) => patMat('pl' + R, () => patternTex(16, 16, (x, y) => {
  const k = x & 3;
  if (k === 0) return R[3];
  if ((y === 2 || y === 13) && k === 2) return R[3];
  return k === 1 ? R[0] : R[1];
}));

/**
 * Roof shingles for the slabs from gableRoof(): rows run across texture u (down the slope),
 * 4 texels per row; tiles 6 texels wide along the ridge, staggered.
 */
export const shingleMat = (R) => patMat('sh' + R, () => patternTex(16, 24, (x, y) => {
  const row = x >> 2, k = x & 3;
  const off = row % 2 ? 3 : 0;
  if (k === 0) return R[3]; // shadow under the row above
  if ((y + off) % 6 === 0) return k === 3 ? R[2] : R[3]; // gap between tiles
  return k === 3 ? R[0] : k === 1 ? R[2] : R[1];
}));

/**
 * Shingle rows for a cone / hipped roof (default cylinder UVs: u around, v up). repU and
 * repV set how many 16×4 tiles fit around and up the roof.
 */
export function coneShingleMat(R, repU, repV) {
  const t = patternTex(16, 4, (x, y) => {
    if (y === 3) return R[3];
    if (x % 8 === 0) return R[2];
    return y === 0 ? R[0] : R[1];
  });
  t.repeat.set(repU, repV);
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, flatShading: true });
}

/** Stone courses: 8×4 blocks, staggered, lit top-left, dark seams. */
export const stoneMat = (R = PAL.stone) => patMat('st' + R, () => patternTex(16, 16, (x, y) => {
  const row = y >> 2, ly = y & 3;
  const off = row % 2 ? 4 : 0;
  const lx = (x + off) & 7, blk = ((x + off) >> 3) + row * 2;
  if (ly === 3 || lx === 7) return R[3];
  if (ly === 0 || lx === 0) return R[0];
  return blk % 3 === 1 ? R[2] : R[1];
}));

/** Ribbed metal / roller door: 4-texel ribs. */
export const ribMat = (R = PAL.metal, horizontal = false) => patMat('rib' + R + horizontal, () => patternTex(16, 16, (x, y) => {
  const k = (horizontal ? y : x) & 3;
  return k === 0 ? R[0] : k === 3 ? R[3] : R[1];
}));

let glassM = null;
/** Window glass: deep blue pane with a diagonal glare; glows warm at night. */
export function glass() {
  if (!glassM) {
    const map = patternTex(16, 16, (x, y) => {
      const d = (x + y) % 16;
      if (d === 4 || d === 5) return '#d8f3ff';
      if (d === 7) return '#9ccdea';
      return y < 6 ? '#4f86b8' : '#3a6a9c';
    });
    glassM = new THREE.MeshStandardMaterial({ map, emissive: '#ffbf66', emissiveIntensity: 0, roughness: 0.35, flatShading: true });
    nightGlow.mats.push({ mat: glassM, strength: 2.6 });
  }
  return glassM;
}

// ---- pixel font (3×5) ------------------------------------------------------------------

export const FONT = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], B: ['##.', '#.#', '##.', '#.#', '##.'], C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'], E: ['###', '#..', '##.', '#..', '###'], F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'], H: ['#.#', '#.#', '###', '#.#', '#.#'], I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'], K: ['#.#', '#.#', '##.', '#.#', '#.#'], L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'], O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'], Q: ['.#.', '#.#', '#.#', '##.', '.##'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], W: ['#.#', '#.#', '###', '###', '#.#'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'], Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'], 2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'], 4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'], 8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'], '-': ['...', '...', '###', '...', '...'], '·': ['.', '.', '#', '.', '.'],
  '▲': ['...', '.#.', '.#.', '###', '...'], "'": ['#', '#', '.', '.', '.'], '.': ['.', '.', '.', '.', '#'],
  ' ': ['..', '..', '..', '..', '..'],
};
const ACCENT = { Ä: ['A', '#.#'], Ö: ['O', '#.#'], Ü: ['U', '#.#'], È: ['E', '.#.'], É: ['E', '.#.'], À: ['A', '.#.'] };

/**
 * Pixel-text sign texture: 3×5 glyphs, 1 texel per art pixel, bevelled 1-texel border.
 * Returns { texture, w, h } in texels.
 */
export function pixelLabel(text, { bg = '#1c2230', fg = '#ffffff', border = null, pad = 3 } = {}) {
  const chars = [...text.toUpperCase()].map((ch) => {
    const a = ACCENT[ch];
    return { g: FONT[a ? a[0] : ch] || FONT[' '], accent: a ? a[1] : null };
  });
  const tw = chars.reduce((s, c) => s + c.g[0].length + 1, -1);
  const w = tw + pad * 2 + 2, h = 5 + 4 + 2; // 2 rows above for accents, 2 below, 1-texel border
  const R = ramp4(bg);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = border || R[3];
  ctx.fillRect(0, 0, w, 1); ctx.fillRect(0, h - 1, w, 1); ctx.fillRect(0, 0, 1, h); ctx.fillRect(w - 1, 0, 1, h);
  ctx.fillStyle = R[0]; // bevel: lit inner top edge
  ctx.fillRect(1, 1, w - 2, 1);
  let x = pad + 1;
  for (const { g, accent } of chars) {
    ctx.fillStyle = fg;
    g.forEach((row, y) => [...row].forEach((p, i) => { if (p === '#') ctx.fillRect(x + i, 3 + y, 1, 1); }));
    if (accent) [...accent].forEach((p, i) => { if (p === '#') ctx.fillRect(x + i, 2, 1, 1); });
    x += g[0].length + 1;
  }
  return { texture: pixelTexture(c), w, h };
}

/**
 * A sign board: dark frame box plus the pixel-text face (+z). Sized so one texel is about
 * one art pixel after the 45° view squeezes it (wider by √2, taller by 1/cos30°), so the
 * 3×5 letters stay readable. Capped at maxW world units.
 */
export function makeSign(text, { bg = '#5a3417', fg = '#ffe3b0', frame = '#3a2010', maxW = 99 } = {}) {
  const { texture, w, h } = pixelLabel(text, { bg, fg });
  const pw = Math.min(maxW, (w / TPU) * 1.41), ph = (h / TPU) * 1.15;
  const g = new THREE.Group();
  g.add(box(pw + 0.12, ph + 0.12, 0.06, flat(frame), 0, 0, -0.01));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.8 }));
  face.position.z = 0.025;
  g.add(face);
  g.userData.size = { w: pw + 0.12, h: ph + 0.12 };
  return g;
}

// ---- building parts ------------------------------------------------------------------------

const dark = (hex, k = 1) => ramp4(hex)[1 + k];

/**
 * Door facing +z with casing, raised panels, a small pane, a brass knob, a stone step
 * and an optional wall lantern. y0 is the floor level of the door.
 */
export function addDoor(g, { x = 0, z = 0, y0 = 0.3, rotY = 0, w = 0.66, h = 1.08, color = '#a03a26', frame = '#5a3218', lamp = true, wreath = false, step = true, pane = true } = {}) {
  const d = new THREE.Group();
  const F = flat(frame), C = flat(color), Cd = flat(dark(color));
  d.add(box(w, h, 0.05, C, 0, h / 2, -0.01));
  for (const s of [-1, 1]) d.add(box(0.08, h + 0.08, 0.09, F, s * (w / 2 + 0.04), (h + 0.08) / 2, 0.01));
  d.add(box(w + 0.24, 0.1, 0.11, F, 0, h + 0.09, 0.02));
  d.add(box(w + 0.2, 0.05, 0.1, flat(SNOW_C), 0, h + 0.165, 0.02));
  d.add(box(w - 0.22, h * 0.3, 0.06, Cd, 0, h * 0.27, 0.0));
  if (pane) d.add(box(w - 0.24, h * 0.22, 0.06, glass(), 0, h * 0.72, 0.0));
  else d.add(box(w - 0.22, h * 0.3, 0.06, Cd, 0, h * 0.68, 0.0));
  d.add(box(0.07, 0.07, 0.1, flat('#f2c94c'), w * 0.3, h * 0.48, 0.03));
  if (step) {
    d.add(box(w + 0.42, 0.14, 0.42, stoneMat(), 0, -0.07, 0.2));
    d.add(box(w + 0.36, 0.04, 0.3, flat(SNOW_C), 0, 0.02, 0.26));
  }
  if (lamp) {
    const lx = w / 2 + 0.26;
    d.add(box(0.05, 0.05, 0.16, flat('#2b2f38'), lx, h * 0.86, 0.08));
    d.add(box(0.16, 0.2, 0.16, glowMat('#ffcf7a', 3), lx, h * 0.8, 0.16));
    d.add(box(0.2, 0.05, 0.2, flat('#2b2f38'), lx, h * 0.92, 0.16));
  }
  if (wreath) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.055, 4, 8), flat('#2f7a52'));
    ring.position.set(0, h * 0.7, 0.06);
    d.add(ring);
    d.add(box(0.12, 0.08, 0.04, flat('#e0302a'), 0, h * 0.56, 0.08));
  }
  d.position.set(x, y0, z);
  d.rotation.y = rotY;
  g.add(d);
  return d;
}

/**
 * Gable roof over a w×d box whose wall top is at wallTop (ridge along z): gable
 * triangles (wallMat), shingle slabs, carved bargeboards and eave fascia in `trim`,
 * a snow blanket with a clean lip, a snowy ridge cap, brackets and icicles.
 * Returns { rise, ridgeY }.
 */
export function addGableRoof(g, { w, d, wallTop, wallMat = null, roof = PAL.red, roofMat = null, trim = '#f1e6cc', over = 0.45, overZ = 0.4, rise = null, snow = 0.55, seed = 1, brackets = true, thick = 0.14, kingPost = true }) {
  rise ??= Math.min(w, d) * 0.42;
  if (wallMat) {
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2, 0);
    shape.lineTo(w / 2, 0);
    shape.lineTo(0, rise);
    shape.closePath();
    const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: d, bevelEnabled: false }).translate(0, 0, -d / 2), wallMat);
    gable.position.y = wallTop;
    gable.castShadow = gable.receiveShadow = true;
    g.add(gable);
  }
  const a = Math.atan2(rise, w / 2);
  const run = w / 2 + over;
  const L = run / Math.cos(a);
  const D = d + 2 * overZ;
  const T = flat(trim), S = flat(SNOW_C);
  const roofM = roofMat ?? shingleMat(roof);
  for (const side of [-1, 1]) {
    const piv = new THREE.Group();
    piv.position.set(0, wallTop + rise + thick / 2 / Math.cos(a), 0);
    piv.rotation.z = -side * a;
    const f = new THREE.Group(); // local +x runs down the slope
    f.rotation.y = side > 0 ? 0 : Math.PI;
    piv.add(f);
    f.add(box(L, thick, D, roofM, L / 2, 0, 0));
    const sl = L * snow;
    f.add(box(sl, 0.13, D - 0.06, S, sl / 2, thick / 2 + 0.065, 0));
    f.add(box(0.14, 0.2, D - 0.04, S, sl, thick / 2 + 0.06, 0)); // rounded lip of the snow
    for (const zz of [-1, 1]) f.add(box(L + 0.06, thick + 0.12, 0.08, T, L / 2 - 0.02, -0.03, zz * (D / 2 + 0.04))); // bargeboards
    f.add(box(0.08, thick + 0.12, D + 0.16, T, L + 0.03, -0.03, 0)); // fascia
    g.add(piv);
    const ice = makeIcicles(D - 0.1, seed * 7 + side);
    ice.position.set(side * (run + 0.03), wallTop + rise - Math.tan(a) * run - 0.03, 0);
    g.add(ice);
    if (brackets) {
      for (const zz of [-1, 1]) {
        const br = box(0.08, 0.5, 0.08, flat(dark(trim, 1)), side * (w / 2 + 0.17), wallTop - 0.12, zz * (d / 2 - 0.08));
        br.rotation.z = -side * 0.75;
        g.add(br);
      }
    }
  }
  const ridgeY = wallTop + rise + thick / Math.cos(a);
  g.add(box(0.34, 0.16, D - 0.02, S, 0, ridgeY + 0.06, 0));
  // gable-end decoration: a little king post under the ridge on the front gable
  if (kingPost) g.add(box(0.08, rise * 0.55, 0.06, T, 0, wallTop + rise * 0.62, d / 2 + overZ + 0.02));
  return { rise, ridgeY };
}

// ---- merge ---------------------------------------------------------------------------------

/** Give a building its placement footprint (walls plus a 0.3 margin) and merge it. */
export function finish(g, w, d) {
  g.userData.footprint = { w: w + 0.6, d: d + 0.6 };
  return mergeStatic(g);
}

/**
 * Merge every static, opaque, single-material mesh of a building into one mesh per
 * material (far fewer draw calls). Meshes under an object with userData.keep, with vertex
 * colours, or with several materials stay as they are.
 */
export function mergeStatic(g) {
  g.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(g.matrixWorld).invert();
  const byMat = new Map(), done = [];
  g.traverse((o) => {
    if (!o.isMesh || o.children.length || Array.isArray(o.material)) return;
    const m = o.material;
    if (m.transparent || m.vertexColors) return;
    for (let p = o; p && p !== g; p = p.parent) if (p.userData.keep) return;
    let geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
    if (!geo.attributes.uv || !geo.attributes.normal) return;
    geo.morphAttributes = {};
    geo.clearGroups();
    geo.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!byMat.has(m)) byMat.set(m, []);
    byMat.get(m).push(geo);
    done.push(o);
  });
  for (const o of done) o.removeFromParent();
  for (const [m, geos] of byMat) {
    const merged = mergeGeometries(geos);
    merged.userData.owned = true; // made for this group only: safe to dispose with it
    const mesh = new THREE.Mesh(merged, m);
    mesh.castShadow = mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}
