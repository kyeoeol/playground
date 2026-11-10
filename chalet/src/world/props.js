import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { seeded } from '../core/rand.js';
import { glassTexture, shade, pixelTexture } from './pixelArt.js';
import {
  PAL, SNOW_C, flat, stoneMat, ribMat, glass, addDoor, makeSign, mergeStatic, FONT,
} from './pixelKit.js';

// ---------------------------------------------------------------------------
// Materials & night glow registry
// ---------------------------------------------------------------------------

const matCache = new Map();
/** Flat colour, untextured material (cached per colour and options). */
export function mat(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  let m = matCache.get(key);
  if (!m) {
    const { plain, ...rest } = opts;
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, flatShading: true, ...rest });
    matCache.set(key, m);
  }
  return m;
}

/** Things that light up at night: windows, lanterns, point lights. */
export const nightGlow = { mats: [], lights: [] };

/**
 * Lit at night. Windows ({ glass: true }) show a cool pane with a glare by day;
 * lamps and bulbs show their own colour, dimmed, by day.
 */
const glowCache = new Map();
export function glowMat(color, strength = 2.2, { glass = false } = {}) {
  const key = `${color}|${strength}|${glass}`;
  let m = glowCache.get(key);
  if (!m) {
    m = glass
      ? new THREE.MeshStandardMaterial({ map: glassTexture, emissive: color, emissiveIntensity: 0, roughness: 0.4, flatShading: true })
      : new THREE.MeshStandardMaterial({ color: shade(color, -2), emissive: color, emissiveIntensity: 0, roughness: 0.6, flatShading: true });
    glowCache.set(key, m);
    nightGlow.mats.push({ mat: m, strength });
  }
  return m;
}

const geoCache = new Map();
/**
 * Box with UVs in world units (like ExtrudeGeometry's), so detail textures keep the
 * same texel size on every face of every box, big or small.
 */
export function boxGeo(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geoCache.has(k)) {
    const g = new THREE.BoxGeometry(w, h, d);
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const nx = n.getX(i), ny = n.getY(i), nz = n.getZ(i);
      if (Math.abs(nx) > 0.5) uv.setXY(i, -z * Math.sign(nx), y);
      else if (Math.abs(ny) > 0.5) uv.setXY(i, x, -z * Math.sign(ny));
      else uv.setXY(i, x * Math.sign(nz), y);
    }
    geoCache.set(k, g);
  }
  return geoCache.get(k);
}

/** A row of icicles under an eave, merged into one mesh. */
export function makeIcicles(len, seed = 1) {
  const r = seeded(seed);
  const geos = [];
  for (let z = -len / 2 + 0.12; z < len / 2 - 0.08; z += 0.16 + r() * 0.2) {
    const h = 0.1 + r() * 0.26;
    geos.push(new THREE.ConeGeometry(0.045, h, 4).rotateX(Math.PI).translate(0, -h / 2, z));
  }
  if (!geos.length) return new THREE.Group();
  const m = new THREE.Mesh(mergeGeometries(geos), mat('#bfeaf6', { plain: true, roughness: 0.25 }));
  m.castShadow = true;
  return m;
}

export function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(boxGeo(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/** Valley lift station: stone base, ribbed metal walls, window band, red fascia, sign. */
export function makeLiftStation(sign) {
  const g = new THREE.Group();
  g.add(box(3.3, 0.6, 3.3, stoneMat(), 0, 0.3, 0));
  g.add(box(3.2, 1.4, 3.2, ribMat(PAL.metal), 0, 1.3, 0));
  // window band on the front and the right side
  for (const [rot, x, z] of [[0, 0, 1.6], [Math.PI / 2, 1.6, 0]]) {
    const band = new THREE.Group();
    band.add(box(2.8, 0.55, 0.05, glass(), 0, 0, 0));
    for (let i = 0; i <= 4; i++) band.add(box(0.07, 0.6, 0.08, flat(PAL.metal[3]), -1.4 + i * 0.7, 0, 0.01));
    band.add(box(2.9, 0.08, 0.14, flat(PAL.metal[2]), 0, -0.32, 0.04));
    band.add(box(2.86, 0.05, 0.1, flat(SNOW_C), 0, -0.26, 0.05));
    band.position.set(x, 1.45, z + (rot ? 0 : 0.02));
    if (rot) band.position.x += 0.02;
    band.rotation.y = rot;
    g.add(band);
  }
  // roof: dark slab, red fascia with a white stripe, snow
  g.add(box(3.8, 0.22, 3.8, flat('#3a3f48'), 0, 2.1, 0));
  for (const s of [-1, 1]) {
    g.add(box(3.84, 0.2, 0.06, flat('#c8102e'), 0, 2.08, s * 1.92));
    g.add(box(0.06, 0.2, 3.84, flat('#c8102e'), s * 1.92, 2.08, 0));
    g.add(box(3.86, 0.04, 0.07, flat('#ffffff'), 0, 2.08, s * 1.92));
    g.add(box(0.07, 0.04, 3.86, flat('#ffffff'), s * 1.92, 2.08, 0));
  }
  g.add(box(3.6, 0.16, 3.6, flat(SNOW_C), 0, 2.28, 0));
  // door on the right side
  addDoor(g, { x: 1.62, z: -0.9, y0: 0.6, rotY: Math.PI / 2, w: 0.7, h: 1.2, color: '#c8102e', frame: PAL.metal[3], lamp: true, step: false });
  if (sign) {
    const s = makeSign(sign, { bg: '#c8102e', fg: '#ffffff', frame: '#7a0a1c', maxW: 3.0 });
    s.position.set(0, 0.95 + 0.02, 1.68);
    g.add(s);
  }
  return mergeStatic(g);
}

// ---------------------------------------------------------------------------
// Village bits
// ---------------------------------------------------------------------------

/** Swiss flag on a white pole with a stone foot and a gold ball. */
export function makeFlag() {
  const g = new THREE.Group();
  g.add(box(0.3, 0.2, 0.3, stoneMat(), 0, 0.1, 0));
  g.add(box(0.07, 4.2, 0.07, flat('#e8ecf2'), 0, 2.2, 0));
  const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.08, 0), flat('#f2c040'));
  ball.position.y = 4.35;
  g.add(ball);
  const c = document.createElement('canvas');
  c.width = c.height = 18;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#d52b1e';
  ctx.fillRect(0, 0, 18, 18);
  ctx.fillStyle = '#a31c16'; // lower shade band
  ctx.fillRect(0, 16, 18, 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(7, 3, 4, 12);
  ctx.fillRect(3, 7, 12, 4);
  const t = pixelTexture(c);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 1.1).translate(0.55, 0, 0),
    new THREE.MeshStandardMaterial({ map: t, side: THREE.DoubleSide }),
  );
  flag.position.set(0.04, 3.6, 0);
  flag.castShadow = true;
  flag.userData.keep = true;
  g.add(flag);
  g.userData.flag = flag;
  return mergeStatic(g);
}

/** Piste sign: striped post, square board with the piste number in pixel digits. */
export function makePisteSign(piste) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) g.add(box(0.08, 0.25, 0.08, flat(i % 2 ? '#f4f4f4' : '#3a3f48'), 0, 0.125 + i * 0.25, 0));
  const { texture } = pixelNumber(piste.id, piste.hex);
  const face = new THREE.MeshStandardMaterial({ map: texture });
  const F = flat('#e8ecf2');
  const board = new THREE.Mesh(boxGeo(0.75, 0.75, 0.06), [F, F, F, F, face, face]);
  board.position.y = 1.55;
  board.castShadow = true;
  g.add(board);
  return mergeStatic(g);
}

/** 12×12 pixel number plate: coloured with a white border and 2×-scaled digits. */
function pixelNumber(n, hex) {
  const c = document.createElement('canvas');
  c.width = c.height = 12;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 12, 12);
  ctx.fillStyle = hex;
  ctx.fillRect(1, 1, 10, 10);
  const glyph = FONT[String(n)[0]] || FONT['0'];
  ctx.fillStyle = '#ffffff';
  glyph.forEach((row, y) => [...row].forEach((p, x) => { if (p === '#') ctx.fillRect(3 + x * 2, 1 + y * 2, 2, 2); }));
  const t = pixelTexture(c);
  // box UVs are in world units centred on the box: map the 0.75 face onto the 12 texels
  t.repeat.set(1 / 0.75, 1 / 0.75);
  t.offset.set(0.5, 0.5);
  return { texture: t };
}

/** All marker poles of one piste merged into a single mesh: banded, coloured on top. */
export function makePisteMarkers(piste, terrain) {
  const geos = [];
  const pole = new THREE.CylinderGeometry(0.05, 0.05, 1.0, 4, 4).toNonIndexed();
  const o = {};
  const col = new THREE.Color(piste.color === 'black' ? '#22242b' : piste.hex);
  const white = new THREE.Color('#f2f2f2');
  for (let s = 2; s < piste.length - 2; s += 4.5) {
    piste.sample(s, o);
    for (const side of [-1, 1]) {
      const x = o.x + o.nx * (piste.half + 0.4) * side;
      const z = o.z + o.nz * (piste.half + 0.4) * side;
      const g = pole.clone();
      const colors = [];
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i += 3) {
        const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3;
        const band = Math.floor((cy + 0.5) / 0.25); // 0..3 from the bottom
        const c = band === 3 || band === 1 ? col : white;
        for (let q = 0; q < 3; q++) colors.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      g.translate(x, terrain.heightAt(x, z) + 0.5, z);
      geos.push(g);
    }
  }
  const m = new THREE.Mesh(mergeGeometries(geos), new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }));
  m.castShadow = true;
  return m;
}

// ---------------------------------------------------------------------------
// Trees & rocks (instanced)
// ---------------------------------------------------------------------------

/*
 * Nature props in a clean 16-bit style: every face gets one flat colour from a small ramp,
 * picked by which way it faces. The view looks from +x+z, so +z faces are the lit
 * screen-left side and +x faces the shaded screen-right side, like hand-drawn iso art.
 * Instances are not rotated, so that baked light stays on the correct side.
 */
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _n = new THREE.Vector3();
/** Colour every triangle of a geometry by its face normal: pick(n) returns a colour. */
export function faceColors(geo, pick) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let f = 0; f < pos.count; f += 3) {
    _a.fromBufferAttribute(pos, f); _b.fromBufferAttribute(pos, f + 1); _c.fromBufferAttribute(pos, f + 2);
    _n.subVectors(_b, _a).cross(_c.sub(_a)).normalize();
    c.set(pick(_n));
    for (let q = 0; q < 3; q++) col.set([c.r, c.g, c.b], (f + q) * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}
/** -1 (shaded, screen-right) .. +1 (lit, screen-left) */
const side = (n) => (n.z - n.x) / Math.SQRT2;
const tone3 = (n, lit, mid, dark, under) => (n.y < -0.3 ? under : side(n) > 0.25 ? lit : side(n) < -0.25 ? dark : mid);

const NEEDLE = { lit: '#2f7f8c', mid: '#1f5a66', dark: '#143e4a', under: '#0f3440' };
const SNOWC = { lit: '#ffffff', mid: '#eef8fb', dark: '#cfe9f0', under: '#a9d3df' };
const BARK = { lit: '#8a5a3a', mid: '#6b4329', dark: '#4a2a1a', under: '#3a2219' };

/** Cone with a scalloped hem: every other rim vertex lifted and pulled in. */
function skirt(radius, height, segs, lift, phase = 1) {
  const g = new THREE.ConeGeometry(radius, height, segs, 1, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    if (y > -height / 2 + 1e-4 || Math.hypot(x, z) < 1e-3) continue;
    const k = Math.round(Math.atan2(z, x) / ((Math.PI * 2) / segs));
    if (((k % 2) + 2) % 2 === phase) {
      // a lifted scallop also tucks in; a drip stays on the cone's slope (moves out as it drops)
      const pull = lift > 0 ? 0.88 : (height - lift) / height;
      p.setY(i, y + lift);
      p.setX(i, x * pull);
      p.setZ(i, z * pull);
    }
  }
  return g;
}

/**
 * Stacked-tier conifer: brown trunk, 3–5 needle tiers (lit / mid / dark faces, a dark
 * scalloped hem) and a white snow cap on the upper part of every tier.
 */
function coniferGeometry(seed, height) {
  const r = seeded(seed);
  const parts = [];
  const trunk = new THREE.BoxGeometry(0.34, 1.0, 0.34).translate(0, 0.5, 0);
  parts.push(faceColors(trunk, (n) => (n.y > 0.5 ? BARK.mid : tone3(n, BARK.lit, BARK.mid, BARK.dark, BARK.under))));
  const tiers = height < 5 ? 3 : height < 6.8 ? 4 : 5;
  // unit layout: tier k has radius rk, height 0.95·rk; the next tier starts 50% up
  const rs = [], hs = [], ys = [];
  let y = 0;
  for (let k = 0; k < tiers; k++) {
    const rk = 1 - (k / tiers) * 0.62 + (r() - 0.5) * 0.06;
    rs.push(rk); hs.push(rk * 0.95); ys.push(y);
    y += rk * 0.95 * (k === tiers - 1 ? 1 : 0.5);
  }
  const unitTop = y;
  const base = 0.75; // tiers start above the trunk foot
  const sy = (height - base) / unitTop; // vertical scale to reach the tree height
  const sx = 1.05 + height * 0.035; // width of the bottom tier, world units
  for (let k = 0; k < tiers; k++) {
    const R = rs[k] * sx, H = hs[k] * sy, y0 = base + ys[k] * sy;
    const tier = skirt(R, H, 16, H * 0.16).translate(0, y0 + H / 2, 0);
    parts.push(faceColors(tier, (n) => tone3(n, NEEDLE.lit, NEEDLE.mid, NEEDLE.dark, NEEDLE.under)));
    // snow on the upper part of the tier: same slope, a hair bigger, a drippy hem.
    // The next tier starts halfway up and overhangs it, so only the lower band shows:
    // a dark needle hem, then white snow.
    const f = k === tiers - 1 ? 0.45 : 0.7; // fraction of the tier height covered
    const sR = R * f * 1.06, sH = H * f * 1.02;
    const cap = skirt(sR, sH, 16, -sH * 0.1, 0).translate(0, y0 + H - sH / 2 + 0.03, 0); // drips between the needle scallops
    parts.push(faceColors(cap, (n) => tone3(n, SNOWC.lit, SNOWC.mid, SNOWC.dark, SNOWC.under)));
  }
  return mergeGeometries(parts);
}

export function makeForest(spots) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 });
  const variants = [coniferGeometry(1, 6.5), coniferGeometry(2, 5.2), coniferGeometry(3, 7.5), coniferGeometry(4, 4.2), coniferGeometry(5, 6.0), coniferGeometry(6, 4.8)];
  const buckets = variants.map(() => []);
  spots.forEach((s) => buckets[s.variant ?? Math.floor(Math.abs(Math.sin(s.x * 12.9 + s.z * 7.1)) * variants.length) % variants.length].push(s));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  variants.forEach((geo, k) => {
    const list = buckets[k];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((s, i) => {
      v.set(s.x, s.y - 0.05, s.z);
      sc.set(s.scale, s.scale, s.scale);
      m4.compose(v, q, sc); // no rotation: the lit side is baked in
      im.setMatrixAt(i, m4);
      s.im = im; s.index = i; // so a tree can be hidden later (a build cleared the spot)
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  });
  return group;
}

/** Little snowy shrubs over the valley: three teal stems and a white cap. */
export function makeTufts(spots) {
  const leaf = (n) => tone3(n, '#3f939e', '#2f7f8c', '#1f5a66', '#143e4a');
  const parts = [
    faceColors(new THREE.BoxGeometry(0.18, 0.34, 0.18).translate(-0.12, 0.17, 0.06), leaf),
    faceColors(new THREE.BoxGeometry(0.2, 0.44, 0.2).translate(0.05, 0.22, -0.06), leaf),
    faceColors(new THREE.BoxGeometry(0.16, 0.28, 0.16).translate(0.16, 0.14, 0.14), leaf),
    faceColors(new THREE.BoxGeometry(0.3, 0.07, 0.26).translate(0.02, 0.46, -0.04), (n) => tone3(n, SNOWC.lit, SNOWC.mid, SNOWC.dark, SNOWC.under)),
  ];
  const geo = mergeGeometries(parts);
  const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true }), spots.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  spots.forEach((s, i) => {
    m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale, s.scale));
    im.setMatrixAt(i, m4);
    s.im = im; s.index = i; // so a build can clear it
  });
  im.castShadow = true;
  return im;
}

/** Chunky faceted rocks: lit / mid / dark stone faces and a snow cap on the top faces. */
export function makeRocks(spots) {
  const stone = (n) => {
    if (n.y > 0.5) return side(n) < -0.3 ? SNOWC.dark : side(n) > 0.3 ? SNOWC.lit : SNOWC.mid;
    return tone3(n, '#a3b6be', '#7a8f98', '#5a6f78', '#3a4e5c');
  };
  const chunk = new THREE.BoxGeometry(1, 0.8, 1, 1, 1, 1);
  { // pull the top in and twist it a little: a boulder, not a crate
    const p = chunk.attributes.position;
    for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * 0.7 + 0.06); p.setZ(i, p.getZ(i) * 0.65 - 0.04); }
  }
  const variants = [
    new THREE.DodecahedronGeometry(0.6, 0).scale(1, 0.72, 0.9),
    new THREE.IcosahedronGeometry(0.6, 0).scale(1.1, 0.7, 1),
    chunk.scale(0.95, 0.85, 0.9),
  ].map((g) => faceColors(g, stone));
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true });
  const group = new THREE.Group();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  variants.forEach((geo, k) => {
    const list = spots.filter((_, i) => i % variants.length === k);
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((s, i) => {
      m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale * 0.85, s.scale));
      im.setMatrixAt(i, m4);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    group.add(im);
  });
  return group;
}
