import * as THREE from 'three';
import { MeshBuilder, makeCanvas, makeRng, pixelTexture, vertexMaterial } from '../core/builder.js';
import { drawBitmapText, forEachBit, textBits } from '../core/pixelfont.js';

// The bowl is lofted around a rounded rectangle: offsetting it outward along its
// normal keeps the aisles perpendicular on the straights and fanning at the corners.
const BASE = { hx: 58, hz: 40, r: 14 };
const PITCH = { hx: 52.5, hz: 34, y: 0.5 };

const TIERS = [
  { d0: 1, h0: 2, d1: 16, h1: 12, rows: 18, row0: 38 }, // lower tier carries the lettering
  { d0: 18, h0: 15, d1: 30, h1: 24.5, rows: 14, row0: 24 },
  { d0: 32, h0: 28, d1: 49, h1: 46.5, rows: 24, row0: 0 },
];
const STAND_ROWS = 56;
const STAND_BANDS = [
  { d0: 0, h0: 0, d1: 0, h1: 2, color: '#16386f' },
  { d0: 0, h0: 2, d1: 1, h1: 2, color: '#8b887f' },
  { d0: 16, h0: 12, d1: 18, h1: 12, color: '#a39d8e' },
  { d0: 18, h0: 12, d1: 18, h1: 15, color: '#c4b99f' },
  { d0: 30, h0: 24.5, d1: 32, h1: 24.5, color: '#a39d8e' },
  { d0: 32, h0: 24.5, d1: 32, h1: 28, color: '#8f8c84' },
  { d0: 49, h0: 46.5, d1: 49, h1: 52, color: '#6f7176' },
];

const ROOF = { dIn: 17, dOut: 48, yIn: 53.5, yOut: 51 };
const BELT_D = 52;
// Barrel-vaulted cladding from the lattice band up to the eave: [offset, height]
const BELT_PROFILE = [[57.5, 30.5], [59, 34], [59, 39], [57, 44], [54, 47.5], [50.5, 50], [48, 51]];
const BELT_SHADES = ['#b2b1a8', '#c3c1b7', '#cfcdc2', '#d9d7cc', '#e1dfd5', '#dbd9cf'];
const TOWERS = [[-105, 87], [105, 87], [-98, -99], [98, -99]];
const TOWER_R = 13;
// The facade sign is one flat plane, so it stays straight where the facade starts to curve.
const SIGN = { text: 'ESTADIO SANTIAGO BERNABEU', bw: 0.85, bh: 1, top: 42.5, bold: 0.15, z: 101.5 };
const SIGN_HALF_WIDTH = (textBits(SIGN.text) * SIGN.bw) / 2;
// Ribs are lightened on these rows of BELT_PROFILE where the sign passes in front of them.
const SIGN_RIB_SHADES = { 1: '#bebcb1', 2: '#c9c7bc' };
const AD_COLORS = ['#c8202c', '#2a2d33', '#f0efe9', '#a82a3a', '#1c2f6a', '#e08a2a'];
const FLAT_Z = -44; // inner line of the flat-roofed stand, which fills the far (-z) side
const BLOCK_X = 84;

/** Is this plan-view point swallowed by the flat-roofed stand? */
const insideBlock = (x, z) => z < FLAT_Z && Math.abs(x) < BLOCK_X;

class Ring {
  constructor(dRef) {
    const sx = BASE.hx - BASE.r, sz = BASE.hz - BASE.r;
    const arc = (Math.PI / 2) * (BASE.r + dRef);
    this.dRef = dRef;
    this.arc = arc;
    this.parts = [
      { len: sz, line: [sx + BASE.r, 0, 0, 1], n: [1, 0] },
      { len: arc, center: [sx, sz], a0: 0 },
      { len: 2 * sx, line: [sx, sz + BASE.r, -1, 0], n: [0, 1] },
      { len: arc, center: [-sx, sz], a0: Math.PI / 2 },
      { len: 2 * sz, line: [-sx - BASE.r, sz, 0, -1], n: [-1, 0] },
      { len: arc, center: [-sx, -sz], a0: Math.PI },
      { len: 2 * sx, line: [-sx, -sz - BASE.r, 1, 0], n: [0, -1] },
      { len: arc, center: [sx, -sz], a0: Math.PI * 1.5 },
      { len: sz, line: [sx + BASE.r, -sz, 0, 1], n: [1, 0] },
    ];
    this.length = this.parts.reduce((sum, p) => sum + p.len, 0);
    let s = 0;
    for (const p of this.parts) { p.s0 = s; s += p.len; }
  }

  /** Base-curve position and outward normal at arc-length s. */
  at(s) {
    s = ((s % this.length) + this.length) % this.length;
    for (const p of this.parts) {
      if (s > p.s0 + p.len && p !== this.parts[this.parts.length - 1]) continue;
      const t = s - p.s0;
      if (p.line) return { x: p.line[0] + p.line[2] * t, z: p.line[1] + p.line[3] * t, nx: p.n[0], nz: p.n[1] };
      const a = p.a0 + (t / p.len) * (Math.PI / 2);
      const nx = Math.cos(a), nz = Math.sin(a);
      return { x: p.center[0] + nx * BASE.r, z: p.center[1] + nz * BASE.r, nx, nz, cornerAngle: a - p.a0 };
    }
    return null;
  }

  point(s, d) {
    const q = this.at(s);
    return [q.x + q.nx * d, q.z + q.nz * d];
  }

  /** Arc-length range of a straight part; index 6 is the far stand, 0/8 and 4 the ends. */
  part(index) { return this.parts[index]; }
}

/** Signed distance to the rounded-rectangle base curve (positive = outside it). */
export function bowlDistance(x, z) {
  const qx = Math.abs(x) - (BASE.hx - BASE.r), qz = Math.abs(z) - (BASE.hz - BASE.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - BASE.r;
}

/** True when a plan-view point lies on the stadium or its forecourt. */
export function onStadium(x, z) {
  if (TOWERS.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < TOWER_R + 1)) return true;
  if (Math.abs(x) < 92 && z < -38 && z > -108) return true;
  return bowlDistance(x, z) < 63;
}

export class Stadium {
  constructor(scene) {
    this.scene = scene;
    this.rng = makeRng(1902);
    this.standRing = new Ring(25);
    this.beltRing = new Ring(BELT_D);
    this.roofRing = new Ring(35);

    this.concrete = new MeshBuilder();
    this.floodlights = [];
    this.buildStands();
    this.buildPitch();
    this.buildExterior();
    this.buildRoof();
    this.buildFlatStand();
    this.buildTowers();

    const mesh = new THREE.Mesh(this.concrete.build(), vertexMaterial());
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    scene.add(mesh);

    this.buildLights();
    this.flood = 0;
  }

  // ---------------------------------------------------------------- seating

  paintSeats() {
    const ring = this.standRing;
    const metre = 8; // texels per metre along the stand, fine enough to size the lettering freely
    const W = Math.round(ring.length * metre);
    const { canvas, ctx } = makeCanvas(W, STAND_ROWS);
    const r = this.rng;
    const seat = metre / 2;
    for (let y = 0; y < STAND_ROWS; y++) {
      for (let x = 0; x < W; x += seat) {
        const n = r();
        ctx.fillStyle = y % 2 ? (n < 0.1 ? '#2a6bc9' : '#1d59b4') : (n < 0.1 ? '#1d59b4' : '#184c9e');
        ctx.fillRect(x, y, seat, 1);
      }
    }
    // Radial aisles
    for (let m = 0; m < ring.length; m += 15.5) {
      ctx.fillStyle = '#d4682c';
      ctx.fillRect(Math.round(m * metre), 0, 1.5 * metre, STAND_ROWS);
    }
    // Vomitory openings in the upper tier
    for (let m = 7; m < ring.length; m += 21) {
      const mx = Math.round(m * metre);
      ctx.fillStyle = '#10131c';
      ctx.fillRect(mx, TIERS[2].row0 + TIERS[2].rows - 5, 3 * metre, 4);
      ctx.fillStyle = '#d9d5c8';
      ctx.fillRect(mx - metre / 2, TIERS[2].row0 + TIERS[2].rows - 6, 4 * metre, 1);
    }

    // REAL MADRID CF across the far stand's lower tier
    const far = ring.part(6);
    const text = 'REAL MADRID CF';
    const bw = 7; // 0.875 m per bit
    // Starts where the straight run does: the seat texture fans out and squeezes letters on the
    // corner to the left, while the roof's east end hides the stand further to the right.
    const startX = Math.round((far.s0 + 0.5) * metre);
    const t = TIERS[0];
    ctx.fillStyle = '#123a80';
    ctx.fillRect(startX - metre, t.row0 + 1, textBits(text) * bw + metre * 2, t.rows - 2);
    drawBitmapText(ctx, text, startX, t.row0 + 2, bw, 2, '#f4f6f8');

    const tex = pixelTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }

  buildStands() {
    const ring = this.standRing;
    const stands = new MeshBuilder();
    const segs = Math.round(ring.length / 2.4);
    for (let i = 0; i < segs; i++) {
      const s0 = (i / segs) * ring.length, s1 = ((i + 1) / segs) * ring.length;
      const u0 = i / segs, u1 = (i + 1) / segs;
      for (const t of TIERS) {
        const [ax, az] = ring.point(s0, t.d0), [bx, bz] = ring.point(s1, t.d0);
        const [cx, cz] = ring.point(s1, t.d1), [dx, dz] = ring.point(s0, t.d1);
        const v0 = 1 - (t.row0 + t.rows) / STAND_ROWS, v1 = 1 - t.row0 / STAND_ROWS;
        stands.quad([ax, t.h0, az], [bx, t.h0, bz], [cx, t.h1, cz], [dx, t.h1, dz], '#ffffff',
          [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]);
      }
      for (const band of STAND_BANDS) {
        const [ax, az] = ring.point(s0, band.d0), [bx, bz] = ring.point(s1, band.d0);
        const [cx, cz] = ring.point(s1, band.d1), [dx, dz] = ring.point(s0, band.d1);
        this.concrete.quad([ax, band.h0, az], [bx, band.h0, bz], [cx, band.h1, cz], [dx, band.h1, dz], band.color);
      }
    }
    const mesh = new THREE.Mesh(stands.build(), new THREE.MeshLambertMaterial({ map: this.paintSeats(), side: THREE.DoubleSide }));
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- pitch

  buildPitch() {
    const ring = this.standRing;
    const y = 0.3;
    const segs = 160;
    for (let i = 0; i < segs; i++) {
      const s0 = (i / segs) * ring.length, s1 = ((i + 1) / segs) * ring.length;
      const [ax, az] = ring.point(s0, -4), [bx, bz] = ring.point(s1, -4);
      const [cx, cz] = ring.point(s1, 0), [dx, dz] = ring.point(s0, 0);
      this.concrete.quad([ax, y, az], [bx, y, bz], [cx, y, cz], [dx, y, dz], '#1b4d9b');
      this.concrete.tri([0, y, 0], [ax, y, az], [bx, y, bz], '#2c6e36');
    }

    const SCALE = 4;
    const W = PITCH.hx * 2 * SCALE, H = PITCH.hz * 2 * SCALE;
    const { canvas, ctx } = makeCanvas(W, H);
    const stripe = 9.5 * SCALE;
    for (let x = 0, n = 0; x < W; x += stripe, n++) {
      ctx.fillStyle = n % 2 ? '#3f8f37' : '#54a644';
      ctx.fillRect(x, 0, stripe + 1, H);
    }
    this.paintLines(ctx, W, H, SCALE);

    const b = new MeshBuilder();
    const { hx, hz, y: py } = PITCH;
    b.quad([-hx, py, -hz], [-hx, py, hz], [hx, py, hz], [hx, py, -hz], '#ffffff', [[0, 1], [0, 0], [1, 0], [1, 1]]);
    const mesh = new THREE.Mesh(b.build(), new THREE.MeshLambertMaterial({ map: pixelTexture(canvas), side: THREE.DoubleSide }));
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);

    for (const sx of [-1, 1]) {
      const x = sx * (hx + 0.2);
      this.concrete.box(x, py, -4, 0.9, 3.4, 0.9, '#ffffff');
      this.concrete.box(x, py, 4, 0.9, 3.4, 0.9, '#ffffff');
      this.concrete.box(x, 3.0, 0, 0.9, 3.4, 8.9, '#ffffff');
    }
  }

  paintLines(ctx, W, H, S) {
    ctx.strokeStyle = '#eef3e6';
    ctx.lineWidth = 4;
    const rectStroke = (x, y, w, h) => ctx.strokeRect(x, y, w, h);
    rectStroke(2, 2, W - 4, H - 4);
    ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
    ctx.beginPath(); ctx.arc(W / 2, H / 2, 9.15 * S, 0, Math.PI * 2); ctx.stroke();
    const boxD = 16.5 * S, boxW = 40.3 * S, smallD = 5.5 * S, smallW = 18.3 * S;
    rectStroke(2, H / 2 - boxW / 2, boxD, boxW);
    rectStroke(W - 2 - boxD, H / 2 - boxW / 2, boxD, boxW);
    rectStroke(2, H / 2 - smallW / 2, smallD, smallW);
    rectStroke(W - 2 - smallD, H / 2 - smallW / 2, smallD, smallW);
    ctx.beginPath(); ctx.arc(11 * S, H / 2, 9.15 * S, -0.92, 0.92); ctx.stroke();
    ctx.beginPath(); ctx.arc(W - 11 * S, H / 2, 9.15 * S, Math.PI - 0.92, Math.PI + 0.92); ctx.stroke();
  }

  // ---------------------------------------------------------------- outer shell

  buildExterior() {
    const b = this.concrete;
    const ring = this.beltRing;
    const bayCount = Math.round(ring.length / 10.5);
    const bayLen = ring.length / bayCount;
    const sub = 6;
    const flagSets = [['#c8102e', '#f6c800'], ['#f4f4f0', '#f4f4f0'], ['#2f5fb0', '#f4f4f0'], ['#c8102e', '#f4f4f0']];
    const rows = BELT_PROFILE.length - 1;
    const bulge = (t) => 1.9 * Math.sin(Math.PI * t);

    for (let bay = 0; bay < bayCount; bay++) {
      const sMid = (bay + 0.5) * bayLen;
      const [mx, mz] = ring.point(sMid, BELT_D);
      if (insideBlock(mx, mz)) continue;

      for (let k = 0; k < sub; k++) {
        const t0 = k / sub, t1 = (k + 1) / sub;
        const s0 = (bay + t0) * bayLen, s1 = (bay + t1) * bayLen;
        const isRib = k === 0 || k === sub - 1;
        const behindSign = mz > 0 && Math.abs(mx) < SIGN_HALF_WIDTH + bayLen / 2;

        // The vault: each bay swells outward between dark ribs.
        for (let p = 0; p < rows; p++) {
          const [d0, h0] = BELT_PROFILE[p], [d1, h1] = BELT_PROFILE[p + 1];
          const fade0 = Math.sin((p / rows) * Math.PI) ** 0.5, fade1 = Math.sin(((p + 1) / rows) * Math.PI) ** 0.5;
          const [ax, az] = ring.point(s0, d0 + bulge(t0) * fade0), [bx, bz] = ring.point(s1, d0 + bulge(t1) * fade0);
          const [cx, cz] = ring.point(s1, d1 + bulge(t1) * fade1), [dx, dz] = ring.point(s0, d1 + bulge(t0) * fade1);
          b.quad([ax, h0, az], [bx, h0, bz], [cx, h1, cz], [dx, h1, dz], isRib ? ((behindSign && SIGN_RIB_SHADES[p]) || '#74777a') : BELT_SHADES[p]);
        }

        // Dark concourses behind, with a glazed plinth at street level.
        const [wax, waz] = ring.point(s0, 49.5), [wbx, wbz] = ring.point(s1, 49.5);
        b.quad([wax, 0, waz], [wbx, 0, wbz], [wbx, 5, wbz], [wax, 5, waz], k % 3 === 1 ? '#4d7a80' : '#669498');
        b.quad([wax, 5, waz], [wbx, 5, wbz], [wbx, 31, wbz], [wax, 31, waz], '#24262a');

        const [oax, oaz] = ring.point(s0, 57), [obx, obz] = ring.point(s1, 57);
        for (const deck of [6.5, 13.5, 20.5]) {
          b.quad([wax, deck, waz], [wbx, deck, wbz], [obx, deck, obz], [oax, deck, oaz], '#6d6c66');
          b.quad([oax, deck - 1.3, oaz], [obx, deck - 1.3, obz], [obx, deck, obz], [oax, deck, oaz], '#bdbab0');
        }

        // Thin lattice band under the vaults
        const [lax, laz] = ring.point(s0, 57.5), [lbx, lbz] = ring.point(s1, 57.5);
        b.quad([lax, 28, laz], [lbx, 28, lbz], [lbx, 30.6, lbz], [lax, 30.6, laz], k % 2 ? '#d6d4ca' : '#8c8c86');
      }

      // Paired pillars on every rib
      const [px, pz] = ring.point(bay * bayLen, 57.8);
      b.box(px, 0, pz, 1.9, 29, 1.9, '#c6c3b8');
      const [qx, qz] = ring.point(bay * bayLen, 52);
      b.box(qx, 0, qz, 1.5, 29, 1.5, '#9f9d94');

      // Tall metal drums in alternating bays, hung above the plinth
      if (bay % 2 === 1) {
        const [sx, sz] = ring.point(sMid, 55.5);
        b.cylinder(sx, sz, 3.3, 7, 26, 12, '#c9cbca', { cap: '#ecece8' });
        b.cylinder(sx, sz, 3.5, 6, 7.2, 12, '#7c7d7b');
      }

      // Flags along the pavement
      if (bay % 3 === 0) {
        const s = sMid;
        const [fx, fz] = ring.point(s, 62.5), [gx, gz] = ring.point(s + 2.4, 62.5);
        const [hi, lo] = flagSets[bay % flagSets.length];
        b.box(fx, 2, fz, 0.4, 16.5, 0.4, '#dcdcd8');
        b.quad([fx, 15.3, fz], [gx, 15.3, gz], [gx, 16.5, gz], [fx, 16.5, fz], hi);
        b.quad([fx, 14.1, fz], [gx, 14.1, gz], [gx, 15.3, gz], [fx, 15.3, fz], lo);
      }
    }
    this.buildFacadeSign();
  }

  /** ESTADIO SANTIAGO BERNABEU on a straight sign across the long front facade, plaque below. */
  buildFacadeSign() {
    const b = this.concrete;
    const { text, bw, bh, top, bold, z: signZ } = SIGN;
    forEachBit(text, (bx, by) => {
      const x0 = -SIGN_HALF_WIDTH + bx * bw - bold, x1 = x0 + bw + bold * 2;
      const y1 = top - by * bh, y0 = y1 - bh;
      b.quad([x0, y0, signZ], [x1, y0, signZ], [x1, y1, signZ], [x0, y1, signZ], '#1c2146');
    });
    const z = BASE.hz + 60.2;
    b.box(-16, 15, z, 8.5, 26, 0.5, '#2b2d33');
    b.box(-16, 18, z + 0.4, 4.4, 23, 0.4, '#c9a64a');
  }

  // ---------------------------------------------------------------- roof

  paintRoof() {
    const ring = this.roofRing;
    const S = 8; // texels per metre: fine enough for smooth lettering once mipmapped
    const W = Math.round(ring.length * S);
    const H = Math.round((ROOF.dOut - ROOF.dIn) * S);
    const { canvas, ctx } = makeCanvas(W, H);
    ctx.fillStyle = '#eff0f0';
    ctx.fillRect(0, 0, W, H);
    // Top of the canvas is the outer edge (v = 1)
    ctx.fillStyle = '#c7cacd';
    ctx.fillRect(0, 0, W, 1 * S);
    ctx.fillStyle = '#d8dadb';
    ctx.fillRect(0, H - 1 * S, W, 1 * S);
    // Panel seams
    ctx.fillStyle = '#ccd0d3';
    for (let m = 0; m < ring.length; m += 10.5) ctx.fillRect(Math.round(m * S), 0, 0.7 * S, H);

    // Each end's straight run is centred on z = 0, so the wordmark sits at the middle of it.
    const left = ring.part(4);
    this.paintWordmark(ctx, (left.s0 + left.len / 2) * S, H / 2, S, left.len);
    // The right-hand run straddles s = 0, so paint it on both ends of the canvas.
    this.paintWordmark(ctx, 0, H / 2, S, left.len);
    this.paintWordmark(ctx, W, H / 2, S, left.len);

    // Unlike the other textures this one is smoothed: nearest sampling broke the strokes apart.
    const tex = pixelTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 16;
    return tex;
  }

  /**
   * "Real" in a regular weight running into a slightly heavier "madrid". It is sized to
   * stay on the straight run, since the roof's texture bends with it around the corners;
   * stretching it across the roof wins back some of the height that costs.
   */
  paintWordmark(ctx, cx, cy, S, runLength) {
    const font = (weight, size) => `${weight} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    const measure = (size) => {
      ctx.font = font(500, size);
      const real = ctx.measureText('Real').width;
      ctx.font = font(700, size);
      return { real, madrid: ctx.measureText('madrid').width };
    };
    const probe = measure(100);
    const size = (100 * (runLength - 3) * S) / (probe.real + probe.madrid);
    const { real, madrid } = measure(size);
    const stretch = 1.35;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, stretch);
    ctx.fillStyle = ctx.strokeStyle = '#122a78';
    ctx.lineJoin = 'round';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    const x = -(real + madrid) / 2, y = size * 0.36;
    ctx.font = font(700, size);
    ctx.lineWidth = 0.3 * S;
    ctx.fillText('madrid', x + real, y);
    ctx.strokeText('madrid', x + real, y);
    ctx.font = font(500, size);
    ctx.lineWidth = 0.1 * S;
    ctx.fillText('Real', x, y);
    ctx.strokeText('Real', x, y);
    ctx.restore();
  }

  buildRoof() {
    const ring = this.roofRing;
    const top = new MeshBuilder();
    const under = this.concrete;
    const segs = Math.round(ring.length / 2.2);
    const span = ROOF.dOut - ROOF.dIn;
    const yAt = (d) => ROOF.yIn + ((d - ROOF.dIn) / span) * (ROOF.yOut - ROOF.yIn);
    const innerAt = (s) => {
      // The white roof tapers to a rounded tip where it meets the flat-roofed stand.
      const q = ring.at(s);
      if (q.z >= -26 || q.cornerAngle === undefined) return ROOF.dIn;
      const angleFromSide = q.nz < 0 ? Math.asin(-q.nz) : 0;
      const t = Math.min(1, angleFromSide / 0.87);
      return ROOF.dIn + (ROOF.dOut - ROOF.dIn - 3) * t * t;
    };
    const blocked = (s) => {
      const [x, z] = ring.point(s, ROOF.dOut);
      return insideBlock(x, z);
    };

    for (let i = 0; i < segs; i++) {
      const s0 = (i / segs) * ring.length, s1 = ((i + 1) / segs) * ring.length;
      if (blocked((s0 + s1) / 2)) continue;
      const d0 = innerAt(s0), d1 = innerAt(s1);
      const u0 = i / segs, u1 = (i + 1) / segs;
      const v = (d) => (d - ROOF.dIn) / span;
      const [ax, az] = ring.point(s0, d0), [bx, bz] = ring.point(s1, d1);
      const [cx, cz] = ring.point(s1, ROOF.dOut), [dx, dz] = ring.point(s0, ROOF.dOut);
      top.quad([ax, yAt(d0), az], [bx, yAt(d1), bz], [cx, ROOF.yOut, cz], [dx, ROOF.yOut, dz], '#ffffff',
        [[u0, v(d0)], [u1, v(d1)], [u1, 1], [u0, 1]]);
      // Underside and front lip
      under.quad([ax, yAt(d0) - 1.6, az], [bx, yAt(d1) - 1.6, bz], [cx, ROOF.yOut - 1.2, cz], [dx, ROOF.yOut - 1.2, dz], '#3b3e44');
      const q = ring.at(s0);
      const hasAds = q.nz > 0 && Math.abs(q.x) > 30; // advertising boards hang under the corners
      const lip = hasAds ? 3.4 : 1.6;
      const lipColor = hasAds ? AD_COLORS[Math.floor(i / 4) % AD_COLORS.length] : '#d3d5d6';
      under.quad([ax, yAt(d0) - lip, az], [bx, yAt(d1) - lip, bz], [bx, yAt(d1), bz], [ax, yAt(d0), az], lipColor);
      if (i % 3 === 0) {
        this.floodlights.push([(ax + bx) / 2, yAt(d0) - 2, (az + bz) / 2]);
      }
    }
    const material = new THREE.MeshLambertMaterial({ map: this.paintRoof(), side: THREE.DoubleSide });
    // Sample a sharper mip than the default, so the lettering holds up at full-slab zoom.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv, -1.4 )'),
      );
    };
    const mesh = new THREE.Mesh(top.build(), material);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    this.buildCanopy();
  }

  /** White flat roof reaching over the long front stand, its trusses exposed on top. */
  buildCanopy() {
    const b = this.concrete;
    const X = 50, zIn = 49, zOut = BASE.hz + 36, y = 54.4, rise = 4.6, white = '#f6f6f3', t = 0.75;
    for (let x = -X; x < X; x += 6.25) {
      b.quad([x, y, zIn], [x + 6.25, y, zIn], [x + 6.25, y, zOut], [x, y, zOut], Math.round((x + X) / 6.25) % 2 ? '#f2f2ee' : '#e6e7e3');
      b.quad([x, y - 1, zIn], [x + 6.25, y - 1, zIn], [x + 6.25, y - 1, zOut], [x, y - 1, zOut], '#44474d');
    }
    b.quad([-X, y - 1, zIn], [X, y - 1, zIn], [X, y, zIn], [-X, y, zIn], '#c9cbc9');
    for (let x = -X; x <= X; x += 12.5) {
      const zMid = (zIn + zOut) / 2;
      b.beam([x, y + 0.3, zIn], [x, y + 0.3, zOut], t, white);
      b.beam([x, y + 0.3, zIn], [x, y + rise, zOut], t, white);
      b.beam([x, y + rise / 2, zMid], [x, y + 0.3, zIn + (zOut - zIn) * 0.25], t * 0.7, white);
      b.beam([x, y + rise / 2, zMid], [x, y + 0.3, zOut], t * 0.7, white);
      b.beam([x, y + 0.3, zOut], [x, y + rise, zOut], t * 0.8, white);
      if (x < X) {
        b.beam([x, y + rise, zOut], [x + 12.5, y + rise, zOut], t * 0.8, white);
        b.beam([x, y + rise / 2, zMid], [x + 12.5, y + rise / 2, zMid], t * 0.7, white);
        b.beam([x, y + 0.3, zIn], [x + 12.5, y + 0.3, zIn], t, white);
      }
    }
  }

  // ---------------------------------------------------------------- the flat-roofed stand

  buildFlatStand() {
    const b = this.concrete;
    const X = 78, zIn = FLAT_Z + 2, zOut = -92, y = 50;

    // Grey roof sheet with seams
    for (let x = -X; x < X; x += 13) {
      const shade = Math.round((x + X) / 13) % 2 ? '#a3a5a6' : '#999b9d';
      b.quad([x, y, zIn], [x + 13, y, zIn], [x + 13, y, zOut], [x, y, zOut], shade);
      b.quad([x, y - 1.5, zIn], [x + 13, y - 1.5, zIn], [x + 13, y - 1.5, zOut], [x, y - 1.5, zOut], '#3b3e44');
    }
    // Rolled metal cornice along the outside edge
    const R = 3.4;
    const steps = [[-0.2, '#8d9094'], [0.5, '#c5c8cb'], [1.1, '#f2f3f3'], [1.7, '#dfe1e3'], [2.3, '#9da1a6']];
    for (let n = 0; n < steps.length - 1; n++) {
      const [a0, color] = steps[n], [a1] = steps[n + 1];
      const y0 = y - R + Math.sin(a0 + 0.2) * R, z0 = zOut - Math.cos(a0 + 0.2) * R + 1;
      const y1 = y - R + Math.sin(a1 + 0.2) * R, z1 = zOut - Math.cos(a1 + 0.2) * R + 1;
      b.quad([-X, y0, z0], [X, y0, z0], [X, y1, z1], [-X, y1, z1], color);
    }

    // Sloped metal facade, panel by panel
    const panel = 9;
    const topZ = zOut - 2.5, topY = y - 3.2, botZ = zOut - 12, botY = 7;
    for (let x = -X, i = 0; x < X; x += panel, i++) {
      const hi = i % 2 ? '#62666d' : '#585c63';
      const lo = i % 2 ? '#4a4d53' : '#42454b';
      const midY = (topY + botY) * 0.55, midZ = topZ + (botZ - topZ) * ((topY - midY) / (topY - botY));
      b.quad([x, topY, topZ], [x + panel, topY, topZ], [x + panel, midY, midZ], [x, midY, midZ], hi);
      b.quad([x, midY, midZ], [x + panel, midY, midZ], [x + panel, botY, botZ], [x, botY, botZ], lo);
      // Plinth
      b.quad([x, botY, botZ], [x + panel, botY, botZ], [x + panel, 0, botZ - 1], [x, 0, botZ - 1], i % 3 === 1 ? '#2e3136' : '#8f8d85');
    }

    // Silver pylons closing both ends
    for (const sign of [-1, 1]) {
      const px = sign * 85;
      b.box(px, 0, -72, 14, 57, 62, '#b4b8bc', { top: '#d1d4d6' });
      for (let z = -44; z > -102; z -= 6.5) {
        b.box(px + sign * 7.1, 2, z, 0.5, 55, 1, '#8c9095');
      }
      // Lattice crown holding the truss
      const crownY = 57;
      for (const [dx, dz] of [[-6, -42], [6, -42], [-6, -52], [6, -52]]) {
        b.beam([px + dx, crownY, dz], [px + dx * 0.5, crownY + 7, dz], 0.8, '#eceded');
      }
      b.beam([px - 6, crownY + 7, -42], [px + 6, crownY + 7, -42], 0.8, '#eceded');
      b.beam([px - 6, crownY + 7, -52], [px + 6, crownY + 7, -52], 0.8, '#eceded');
    }

    // The long white space-frame truss along the roof's inner edge
    const trussZ = FLAT_Z + 1, base = y + 0.5, tall = 7, deep = 7, t = 0.9, white = '#f4f5f5';
    const zA = trussZ - deep / 2, zB = trussZ + deep / 2;
    b.beam([-79, base, zA], [79, base, zA], t, white);
    b.beam([-79, base, zB], [79, base, zB], t, white);
    b.beam([-79, base + tall, trussZ], [79, base + tall, trussZ], t, white);
    for (let x = -78, i = 0; x < 78; x += 6, i++) {
      const xm = x + 3;
      b.beam([x, base, zA], [xm, base + tall, trussZ], t * 0.8, white);
      b.beam([x + 6, base, zA], [xm, base + tall, trussZ], t * 0.8, white);
      b.beam([x, base, zB], [xm, base + tall, trussZ], t * 0.8, white);
      b.beam([x + 6, base, zB], [xm, base + tall, trussZ], t * 0.8, white);
      b.beam([x, base, zA], [x, base, zB], t * 0.8, white);
      if (i % 2 === 0) this.floodlights.push([x, y - 2, zIn]);
    }
  }

  // ---------------------------------------------------------------- spiral ramp towers

  buildTowers() {
    for (const [x, z] of TOWERS) this.buildRampTower(x, z);
  }

  /** A helical concrete ramp, an open storey of columns, then a railed plant deck. */
  buildRampTower(x, z) {
    const b = this.concrete;
    const r = TOWER_R, core = r - 3.6;
    const seg = 26, turns = 6, pitch = 4.5, band = 3, base = 3.2;
    const top = base + turns * pitch;
    b.cylinder(x, z, core, 0, top + 6, 16, '#2f3135');
    b.cylinder(x, z, r + 0.5, 0, base, 26, '#e6e3d9', { cap: '#c9c6bb' });
    const at = (a, rad, y) => [x + Math.cos(a) * rad, y, z + Math.sin(a) * rad];
    for (let n = 0; n < turns * seg; n++) {
      const a0 = (n / seg) * Math.PI * 2, a1 = ((n + 1) / seg) * Math.PI * 2;
      const y0 = base + (n / seg) * pitch, y1 = base + ((n + 1) / seg) * pitch;
      b.quad(at(a0, r, y0), at(a1, r, y1), at(a1, r, y1 + band), at(a0, r, y0 + band), '#dedbd0');
      b.quad(at(a0, core, y0), at(a1, core, y1), at(a1, r, y1), at(a0, r, y0), '#a6a39a');
      b.quad(at(a0, core, y0 + band), at(a1, core, y1 + band), at(a1, r, y1 + band), at(a0, r, y0 + band), '#c6c3b8');
    }
    for (let n = 0; n < 12; n++) {
      const a = (n / 12) * Math.PI * 2;
      b.box(x + Math.cos(a) * (r - 1), top + 2, z + Math.sin(a) * (r - 1), 1.2, top + 8, 1.2, '#cbc8bd');
    }
    b.cylinder(x, z, r + 0.9, top + 8, top + 9, 26, '#d9d6cb', { cap: '#8f8d85' });
    b.cylinder(x, z, r + 0.9, top + 9, top + 11, 26, '#34363b');
    const rng = this.rng;
    for (let n = 0; n < 8; n++) {
      const a = rng() * Math.PI * 2, rad = rng() * (r - 5);
      const px = x + Math.cos(a) * rad, pz = z + Math.sin(a) * rad;
      b.box(px, top + 9, pz, 2.8, top + 9 + rng.range(1.8, 3.6), 2.4, rng.pick(['#e2e2de', '#b5b8bb', '#8d9095']));
    }
  }

  // ---------------------------------------------------------------- lights

  buildLights() {
    const geo = new THREE.BoxGeometry(2.8, 1, 1.4);
    this.lampMaterial = new THREE.MeshBasicMaterial({ color: '#50545a' });
    const lamps = new THREE.InstancedMesh(geo, this.lampMaterial, this.floodlights.length);
    const m = new THREE.Matrix4();
    this.floodlights.forEach(([x, y, z], i) => lamps.setMatrixAt(i, m.makeTranslation(x, y, z)));
    lamps.frustumCulled = false;
    this.scene.add(lamps);

    this.pitchLight = new THREE.PointLight('#f4f7ff', 0, 170, 0);
    this.pitchLight.position.set(0, 46, 0);
    this.scene.add(this.pitchLight);
    this.lampOff = new THREE.Color('#50545a');
    this.lampOn = new THREE.Color('#fffbe6').multiplyScalar(2);
  }

  /** flood: 0..1 floodlight level. */
  update(flood) {
    this.lampMaterial.color.copy(this.lampOff).lerp(this.lampOn, flood);
    this.pitchLight.intensity = flood * 3.4;
  }
}
