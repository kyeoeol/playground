import * as THREE from 'three';
import { box, glowMat, nightGlow } from './props.js';
import { flat, mergeStatic, SNOW_C } from './pixelKit.js';
import { fromSW } from './coords.js';
import { indexedGeo } from './meshKit.js';
import { pixelTexture } from './pixelArt.js';
import { NX, NZ, SLOPE_END, PX } from './Terrain.js';
import { clamp, smoothstep } from '../core/rand.js';

/**
 * The edges of the ski area, like a real night-skiing slope:
 *  - a red safety net on each side of the open slope (the forest stays outside it)
 *  - floodlight masts just outside the nets; at night they light the snow in pools
 *
 * The floodlights do not use real lights (many point lights cost a lot per pixel).
 * They add an emissive "light map" to the ground: the snow's own colour, scaled by a
 * stepped mask of light pools, so the lit snow keeps its pixel detail.
 */
export const NET = {
  left: -23.6, // w of the left net (A–D side)
  right: 25.4, // w of the right net (B–C side)
  s0: 3.8, // the nets start under the ridge...
  s1: SLOPE_END - 1.5, // ...and end above the run-out at the base
};
const NET_H = 1.05;
const POST_STEP = 2.5;
const MAST_OUT = 0.9; // masts stand this far outside the net
const MASTS = {
  left: [8, 18, 28, 38, 48, 58],
  right: [13, 23, 33, 43, 53],
};
const FLOOD_STRENGTH = 0.95;

// ---- safety net ------------------------------------------------------------------

/** Red mesh net, 16 texels per unit: 1-texel strands, 4-texel holes, a solid top cord. */
function netTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = PX;
  const ctx = c.getContext('2d');
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) {
    let col = null;
    if (y <= 1) col = y === 0 ? '#ff6a4a' : '#c42a1e'; // top cord, lit on top
    else if (y === PX - 1) col = '#a8231a'; // bottom cord
    else if (x % 4 === 0 || y % 4 === 1) col = (x + y) % 8 < 4 ? '#e8452c' : '#d63a26';
    if (!col) continue;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, 1, 1);
  }
  const t = pixelTexture(c);
  t.anisotropy = 1;
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

/** One side's net: a terrain-following panel with posts every POST_STEP. */
function makeNet(terrain, w) {
  const g = new THREE.Group();
  const pos = [], uv = [], idx = [];
  const x = fromSW(0, w).x;
  const steps = Math.ceil((NET.s1 - NET.s0) / 0.5);
  for (let k = 0; k <= steps; k++) {
    const s = NET.s0 + ((NET.s1 - NET.s0) * k) / steps;
    const y = terrain.heightAt(x, s);
    pos.push(x, y + NET_H, s, x, y + 0.05, s);
    uv.push(s, 1, s, 0);
    if (k) {
      const a = (k - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const geo = indexedGeo(pos, uv, idx);
  // the camera sees the nets' shaded side; a little self-light keeps them reading red
  const tex = netTexture();
  const net = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    map: tex, emissiveMap: tex, emissive: '#ffffff', emissiveIntensity: 0.45,
    alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9, flatShading: true,
  }));
  net.receiveShadow = true;
  g.add(net);

  // posts: dark steel with a snow cap
  const posts = new THREE.Group();
  const steel = flat('#3b4048'), cap = flat(SNOW_C);
  for (let s = NET.s0; s <= NET.s1 + 1e-3; s += POST_STEP) {
    const y = terrain.heightAt(x, s);
    posts.add(box(0.1, NET_H + 0.15, 0.1, steel, x, y + (NET_H + 0.15) / 2 - 0.05, s));
    posts.add(box(0.12, 0.05, 0.12, cap, x, y + NET_H + 0.12, s));
  }
  const p = mergeStatic(posts);
  p.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  g.add(p);
  return g;
}

// ---- floodlight masts --------------------------------------------------------------

/**
 * A floodlight mast: concrete foot, tall grey pole, a crossbar with two lamps tilted
 * down toward local +x (the slope). The lamp faces glow at night.
 */
function makeMast() {
  const g = new THREE.Group();
  const pole = flat('#8d939c'), dark = flat('#2e3138'), plate = flat('#6c727b');
  const H = 7.6; // the lamps clear the forest canopy
  g.add(box(0.5, 0.3, 0.5, flat('#a7adb6'), 0, 0.1, 0));
  g.add(box(0.52, 0.04, 0.52, flat(SNOW_C), 0, 0.26, 0));
  g.add(box(0.2, H, 0.2, pole, 0, H / 2, 0));
  for (let y = 0.8; y < H - 0.6; y += 1.2) g.add(box(0.2, 0.06, 0.2, plate, 0, y, 0)); // pole joints
  g.add(box(0.14, 0.12, 1.9, dark, 0.05, H, 0)); // crossbar along the net
  const face = glowMat('#fff3d6', 4.5);
  for (const z of [-0.62, 0.62]) {
    const lamp = new THREE.Group();
    lamp.add(box(0.36, 0.48, 0.6, dark, 0, 0, 0)); // housing
    lamp.add(box(0.04, 0.38, 0.5, face, 0.2, 0, 0)); // glass, facing +x
    lamp.add(box(0.4, 0.05, 0.64, flat(SNOW_C), -0.02, 0.26, 0)); // snow on top
    lamp.position.set(0.3, H + 0.05, z);
    lamp.rotation.z = -0.55; // tilt the glass down at the snow
    g.add(lamp);
  }
  const m = mergeStatic(g);
  m.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return m;
}

/** Where each mast stands: { s, w, side } (side = +1 left, the slope is at +w; −1 right). */
export function mastSpots() {
  return [
    ...MASTS.left.map((s) => ({ s, w: NET.left - MAST_OUT, side: 1 })),
    ...MASTS.right.map((s) => ({ s, w: NET.right + MAST_OUT, side: -1 })),
  ];
}

/**
 * Light mask for the ground, 4 texels per tile, in stepped levels (pixel-art banding):
 * a base glow over the open slope between the nets, plus a pool in front of every mast.
 */
function floodMask() {
  const R = 4; // mask texels per tile
  const MW = NX * R, MH = NZ * R;
  const v = new Float32Array(MW * MH);
  const pools = mastSpots().map((m) => ({ s: m.s + 1.5, w: m.w + m.side * 8.5 }));
  for (let py = 0; py < MH; py++) for (let px = 0; px < MW; px++) {
    const s = (py + 0.5) / R, w = (px + 0.5) / R - NX / 2;
    // only on the slope: fades out over the run-out
    const onSlope = 1 - smoothstep(SLOPE_END - 2, SLOPE_END + 1.5, s);
    if (onSlope <= 0) continue;
    const inside = w > NET.left && w < NET.right && s > NET.s0 - 1 ? 1 : 0;
    let l = inside * 0.38;
    for (const p of pools) {
      const d = Math.hypot((s - p.s) / 1.35, w - p.w); // pools stretch along the fall line
      l += 0.85 * Math.max(0, 1 - d / 12) ** 1.6;
    }
    l = clamp(l) * onSlope;
    v[py * MW + px] = Math.floor(l * 5 + 0.15) / 5; // five flat steps
  }
  const data = new Uint8Array(MW * MH * 4);
  for (let i = 0; i < MW * MH; i++) {
    const b = Math.round(v[i] * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, MW, MH, THREE.RGBAFormat);
  t.flipY = false; // row 0 = s 0; the terrain's v runs 1 − z/NZ, flipped below
  t.repeat.set(1, -1);
  t.offset.set(0, 1);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}

/**
 * Put the nets and masts in the world and light the slope's ground at night.
 * Returns obstacle data: nets as thin (s, w) boxes, masts as circles.
 */
export function buildSlopeEdges(world) {
  const { terrain, scene } = world;
  const g = new THREE.Group();
  for (const w of [NET.left, NET.right]) {
    g.add(makeNet(terrain, w));
    world.boxes.push({ s: (NET.s0 + NET.s1) / 2, w, hs: (NET.s1 - NET.s0) / 2, hw: 0.08 });
  }
  const mast = makeMast();
  for (const m of mastSpots()) {
    const o = mast.clone();
    const { x, z } = fromSW(m.s, m.w);
    o.position.set(x, terrain.heightAt(x, z), z);
    o.rotation.y = m.side > 0 ? 0 : Math.PI; // local +x faces the slope
    g.add(o);
    world.circles.push({ x, z, r: 1.0 }); // also keeps the trees back from the mast
  }
  scene.add(g);

  // floodlit ground: emissive = snow colour × light mask, faded in by the night glow
  const mat = terrain.mesh.material;
  mat.emissive = new THREE.Color('#fff4e2');
  mat.emissiveMap = floodMask();
  mat.emissiveIntensity = 0;
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= diffuseColor.rgb; // light the snow, keep its detail',
    );
  };
  mat.needsUpdate = true;
  nightGlow.mats.push({ mat, strength: FLOOD_STRENGTH });
  return g;
}
