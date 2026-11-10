import * as THREE from 'three';
import { box, glowMat, nightGlow } from './props.js';
import { TEAL } from './pixelArt.js';
import { PAL, SNOW_C, flat, plankMat, mergeStatic } from './pixelKit.js';

// Retro 16-bit winter village props. Every building's front faces local +z; the camera
// sees the front (+z) and the right side (+x).

/** Snowman with coal eyes and buttons, carrot nose, striped scarf and a banded top hat. */
export function makeSnowman() {
  const g = new THREE.Group();
  const snow = flat('#f6f9fd');
  for (const [r, y] of [[0.42, 0.35], [0.32, 0.92], [0.24, 1.35]]) {
    const s = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), snow);
    s.position.y = y;
    g.add(s);
  }
  const coal = flat('#1d1f26');
  g.add(box(0.06, 0.06, 0.04, coal, -0.08, 1.41, 0.21));
  g.add(box(0.06, 0.06, 0.04, coal, 0.08, 1.41, 0.21));
  for (const [y, z] of [[0.98, 0.31], [0.82, 0.3], [0.5, 0.4]]) g.add(box(0.06, 0.06, 0.04, coal, 0, y, z));
  for (let i = 0; i < 4; i++) g.add(box(0.04, 0.04, 0.03, coal, -0.09 + i * 0.06, 1.27 - (i === 0 || i === 3 ? 0 : 0.03), 0.22));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.24, 4), flat('#ff8a1a'));
  nose.rotation.x = Math.PI / 2;
  nose.position.set(0, 1.34, 0.32);
  g.add(nose);
  // scarf: red with white stripes, hanging tail
  g.add(box(0.52, 0.1, 0.44, flat('#d0302a'), 0, 1.13, 0));
  for (const y of [1.08, 0.94, 0.8]) g.add(box(0.12, 0.1, 0.07, flat(y === 0.94 ? '#f6f1e6' : '#d0302a'), 0.16, y, 0.2));
  // hat with a band and a sprig
  g.add(box(0.36, 0.04, 0.36, coal, 0, 1.57, 0));
  g.add(box(0.24, 0.24, 0.24, coal, 0, 1.7, 0));
  g.add(box(0.25, 0.06, 0.25, flat('#c8342b'), 0, 1.63, 0));
  g.add(box(0.06, 0.06, 0.04, flat('#2f7a52'), 0.08, 1.66, 0.13));
  for (const s of [-1, 1]) {
    const arm = box(0.04, 0.5, 0.04, flat('#6b4a2f'), s * 0.42, 1.0, 0);
    arm.rotation.z = -s * 0.9;
    g.add(arm);
    const f = box(0.03, 0.14, 0.03, flat('#6b4a2f'), s * 0.62, 1.2, 0);
    f.rotation.z = -s * 0.2;
    g.add(f);
  }
  return mergeStatic(g);
}

/** The village Christmas tree: tiers with snow, baubles, a gold garland, star and presents. */
export function makeXmasTree() {
  const g = new THREE.Group();
  // planter tub with a red ribbon
  g.add(box(0.9, 0.5, 0.9, plankMat(PAL.plank), 0, 0.25, 0));
  g.add(box(0.94, 0.1, 0.94, flat('#d0302a'), 0, 0.3, 0));
  g.add(box(0.4, 0.4, 0.4, flat('#5a3a24'), 0, 0.6, 0));
  const greens = [TEAL.d1, TEAL.b, '#23646f', '#3a8f9a'];
  let y = 0.7;
  const lights = ['#ff5a4a', '#ffd34a', '#4ab6ff', '#7dff8a', '#ff7ad9'];
  const lightMats = lights.map((c) => glowMat(c, 4));
  const gold = flat('#f2c040');
  for (let i = 0; i < 5; i++) {
    const r = 2.0 - i * 0.36, h = 1.5 - i * 0.12;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), flat(greens[i % 4]));
    cone.position.y = y + h / 2;
    g.add(cone);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(r * 0.62, h * 0.45, 8), flat(SNOW_C));
    cap.position.y = y + h * 0.75;
    g.add(cap);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + i;
      g.add(box(0.15, 0.15, 0.15, lightMats[(k + i) % lightMats.length], Math.cos(a) * r * 0.82, y + 0.2, Math.sin(a) * r * 0.82));
      // gold garland bead between the bulbs
      const b = a + Math.PI / 9;
      g.add(box(0.09, 0.09, 0.09, gold, Math.cos(b) * r * 0.78, y + 0.3, Math.sin(b) * r * 0.78));
    }
    y += h * 0.6;
  }
  // star: an extruded 5-point star, glowing
  const st = new THREE.Shape();
  for (let k = 0; k < 10; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / 5, rr = k % 2 ? 0.18 : 0.42;
    k ? st.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : st.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  const star = new THREE.Mesh(new THREE.ExtrudeGeometry(st, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06),
    new THREE.MeshStandardMaterial({ color: '#ffd34a', emissive: '#ffcf3a', emissiveIntensity: 1.5, flatShading: true }));
  star.position.y = y + 0.6;
  star.rotation.y = Math.PI / 4;
  star.userData.keep = true;
  g.add(star);
  g.userData.star = star;
  // presents
  for (const [x, z, c, r] of [[1.3, 0.9, '#d0302a', '#f2c040'], [0.7, 1.4, '#2f6e9a', '#f6f1e6'], [1.5, -0.2, '#2f7a52', '#d0302a'], [-0.6, 1.4, '#f2c040', '#d0302a']]) {
    const s = 0.34 + ((x * 7) % 0.1);
    g.add(box(s, s * 0.8, s, flat(c), x, s * 0.4, z));
    g.add(box(s + 0.02, s * 0.8 + 0.02, 0.07, flat(r), x, s * 0.4, z));
    g.add(box(0.07, s * 0.8 + 0.02, s + 0.02, flat(r), x, s * 0.4, z));
    g.add(box(0.16, 0.08, 0.16, flat(r), x, s * 0.8 + 0.04, z));
  }
  const l = new THREE.PointLight('#ffd9a0', 0, 12, 1.4);
  l.position.y = 3;
  g.add(l);
  nightGlow.lights.push({ light: l, strength: 14 });
  return mergeStatic(g);
}

/** Arched wooden plank bridge (spans local z). */
export function makeBridge(len = 5, width = 2.4) {
  const g = new THREE.Group();
  const n = Math.round(len / 0.36);
  for (let i = 0; i < n; i++) {
    const z = -len / 2 + (i + 0.5) * (len / n);
    const arch = Math.sin(((i + 0.5) / n) * Math.PI) * 0.35;
    g.add(box(width, 0.1, len / n - 0.05, flat(PAL.plank[i % 2 ? 0 : 1]), 0, 0.12 + arch, z));
  }
  const P = flat(PAL.log[2]);
  for (const x of [-width / 2, width / 2]) {
    for (let i = 0; i <= 3; i++) {
      const z = -len / 2 + (i / 3) * len;
      const arch = Math.sin((i / 3) * Math.PI) * 0.35;
      g.add(box(0.14, 0.75, 0.14, P, x, 0.45 + arch, z));
      g.add(box(0.16, 0.06, 0.16, flat(SNOW_C), x, 0.85 + arch, z));
    }
    g.add(box(0.09, 0.09, len, flat(PAL.log[1]), x, 0.95, 0));
    g.add(box(0.08, 0.04, len - 0.2, flat(SNOW_C), x, 1.01, 0));
  }
  return mergeStatic(g);
}
