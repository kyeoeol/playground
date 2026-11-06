import * as THREE from 'three';
import { HALF } from '../constants.js';
import { MeshBuilder, addWorldMesh, makeCanvas, makeRng, pixelTexture } from '../core/builder.js';
import { COURT, PARKS, PLAZA, PLAZA_TREES, ROADS, ROUNDABOUT, diagonalZ, roadAxis } from './plan.js';

const TEX = HALF * 4; // ground canvas size: 2 texels per metre
const toTex = (v) => (v + HALF) * (TEX / (HALF * 2));
const CELL = 4; // resolution of the building footprint grid
const GRID = (HALF * 2) / CELL;

/** The slab: painted streets on top, soil strata on its sides. */
export class Ground {
  constructor(scene) {
    this.scene = scene;
    this.solid = new Uint8Array(GRID * GRID);
    this.rng = makeRng(42);

    const { ctx, canvas } = makeCanvas(TEX, TEX);
    this.ctx = ctx;
    this.paintGround();

    const top = new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2, HALF * 2).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: pixelTexture(canvas) }),
    );
    top.receiveShadow = true;
    scene.add(top);
    this.buildSkirt();
  }

  /** Record a building's footprint so trees aren't placed inside it. */
  occupy(x, z, w, d, rot = 0) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const reach = Math.hypot(w, d) / 2 + CELL;
    const i0 = Math.max(0, Math.floor((x - reach + HALF) / CELL)), i1 = Math.min(GRID - 1, Math.floor((x + reach + HALF) / CELL));
    const j0 = Math.max(0, Math.floor((z - reach + HALF) / CELL)), j1 = Math.min(GRID - 1, Math.floor((z + reach + HALF) / CELL));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = (i + 0.5) * CELL - HALF - x, dz = (j + 0.5) * CELL - HALF - z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        if (Math.abs(lx) <= w / 2 + 1 && Math.abs(lz) <= d / 2 + 1) this.solid[i + j * GRID] = 1;
      }
    }
  }

  isFree(x, z) {
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
    return i >= 0 && j >= 0 && i < GRID && j < GRID && !this.solid[i + j * GRID];
  }

  // ---------------------------------------------------------------- painting

  paintGround() {
    const { ctx } = this;
    ctx.fillStyle = '#a8a193';
    ctx.fillRect(0, 0, TEX, TEX);

    // Paving seams
    ctx.fillStyle = 'rgba(70,64,54,0.16)';
    for (let i = 0; i < TEX; i += 12) { ctx.fillRect(i, 0, 1, TEX); ctx.fillRect(0, i, TEX, 1); }

    this.paintPlaza();
    for (const p of PARKS) this.fillPatch(p, '#4f7c37', '#5e8d3f', '#3f6a2d');
    this.paintCourt();

    // Roads: kerbs first so that later asphalt cuts them at junctions.
    ctx.lineCap = 'butt';
    const stroke = (pts, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width * 2;
      ctx.beginPath();
      ctx.moveTo(toTex(pts[0][0]), toTex(pts[0][1]));
      ctx.lineTo(toTex(pts[1][0]), toTex(pts[1][1]));
      ctx.stroke();
    };
    for (const road of ROADS) stroke(road.pts, road.w + 6, '#c2bcae');
    this.circle(ROUNDABOUT.x, ROUNDABOUT.z, ROUNDABOUT.r + 3, '#c2bcae');
    for (const road of ROADS) stroke(road.pts, road.w, '#3c3e43');
    this.circle(ROUNDABOUT.x, ROUNDABOUT.z, ROUNDABOUT.r, '#3c3e43');

    for (const road of ROADS) this.paintMarkings(road);
    this.circle(ROUNDABOUT.x, ROUNDABOUT.z, 13, '#c2bcae');
    this.circle(ROUNDABOUT.x, ROUNDABOUT.z, 11.5, '#567f3a');

    this.paintCrosswalks();
    this.addGrain();
  }

  /** Stone paving laid out on the stadium's axis, around a central circle. */
  paintPlaza() {
    const { ctx } = this;
    const { x: cx, z: cz, x0, x1, z0, ringRadius, axisHalfWidth, crossHalfWidth } = PLAZA;
    const rect = (l, r, t, b, color) => {
      ctx.fillStyle = color;
      ctx.fillRect(toTex(l), toTex(t), (r - l) * 2, (b - t) * 2);
    };
    const south = Math.max(diagonalZ(x0), diagonalZ(x1));

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(toTex(x0), toTex(z0));
    ctx.lineTo(toTex(x1), toTex(z0));
    ctx.lineTo(toTex(x1), toTex(diagonalZ(x1)));
    ctx.lineTo(toTex(x0), toTex(diagonalZ(x0)));
    ctx.closePath();
    ctx.clip();

    rect(x0, x1, z0, south, '#cfc7b6');
    const tile = 12;
    for (let i = Math.floor(x0 / tile); i * tile < x1; i++) {
      for (let j = Math.floor(z0 / tile); j * tile < south; j++) {
        if ((i + j) % 2 === 0) rect(i * tile, (i + 1) * tile, j * tile, (j + 1) * tile, '#c4bcab');
      }
    }
    // Walkways: one along the stadium's axis, one across the plaza
    rect(cx - axisHalfWidth, cx + axisHalfWidth, z0, south, '#b7ae9c');
    rect(cx - axisHalfWidth, cx - axisHalfWidth + 1, z0, south, '#9d9482');
    rect(cx + axisHalfWidth - 1, cx + axisHalfWidth, z0, south, '#9d9482');
    rect(x0, x1, cz - crossHalfWidth, cz + crossHalfWidth, '#b7ae9c');
    rect(x0, x1, cz - crossHalfWidth, cz - crossHalfWidth + 1, '#9d9482');
    rect(x0, x1, cz + crossHalfWidth - 1, cz + crossHalfWidth, '#9d9482');

    // The central circle with radiating bands
    this.circle(cx, cz, ringRadius, '#9d9482');
    this.circle(cx, cz, ringRadius - 1.2, '#dad3c3');
    ctx.strokeStyle = '#bfb6a4';
    ctx.lineWidth = 4;
    for (let n = 0; n < 24; n++) {
      const a = (n / 24) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(toTex(cx + Math.cos(a) * 15), toTex(cz + Math.sin(a) * 15));
      ctx.lineTo(toTex(cx + Math.cos(a) * (ringRadius - 1.2)), toTex(cz + Math.sin(a) * (ringRadius - 1.2)));
      ctx.stroke();
    }
    this.circle(cx, cz, 15, '#a89f8d');

    // Tree pits
    for (const [x, z] of PLAZA_TREES) {
      this.circle(x, z, 2.2, '#9d9482');
      this.circle(x, z, 1.6, '#5f4e3a');
    }
    ctx.restore();
  }

  fillPatch(p, base, light, dark) {
    const { ctx, rng } = this;
    const x = toTex(p.x0), y = toTex(p.z0), w = toTex(p.x1) - x, h = toTex(p.z1) - y;
    ctx.fillStyle = base;
    ctx.fillRect(x, y, w, h);
    for (let n = 0; n < (w * h) / 10; n++) {
      ctx.fillStyle = rng() < 0.5 ? light : dark;
      ctx.fillRect(x + rng() * w, y + rng() * h, 2, 2);
    }
  }

  circle(x, z, r, color) {
    const { ctx } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(toTex(x), toTex(z), r * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  paintMarkings(road) {
    const { ctx } = this;
    const { a, b, dx, dz } = roadAxis(road);
    const nx = -dz, nz = dx;
    const line =(offset, dash, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.setLineDash(dash);
      ctx.beginPath();
      ctx.moveTo(toTex(a[0] + nx * offset), toTex(a[1] + nz * offset));
      ctx.lineTo(toTex(b[0] + nx * offset), toTex(b[1] + nz * offset));
      ctx.stroke();
      ctx.setLineDash([]);
    };
    if (road.median) {
      line(0, [], '#c2bcae', 7);
      line(0, [], '#567f3a', 5);
    } else {
      line(0, [], '#d8d4c7', 2);
    }
    if (road.w >= 20) {
      line(road.w / 4, [8, 10], '#b5b2a6', 2);
      line(-road.w / 4, [8, 10], '#b5b2a6', 2);
    }
  }

  paintCrosswalks() {
    const zebra = (x, z, horizontal, length, width) => {
      this.ctx.fillStyle = '#e8e5da';
      for (let t = -length / 2; t < length / 2; t += 3.2) {
        if (horizontal) this.ctx.fillRect(toTex(x + t), toTex(z - width / 2), 3, width * 2);
        else this.ctx.fillRect(toTex(x - width / 2), toTex(z + t), width * 2, 3);
      }
    };
    for (const [x, z, h, l] of [
      [-134, -110, true, 14], [-134, -146, true, 14], [140, -111, true, 10], [192, -111, true, 8],
      [-124, -128, false, 28], [-144, -128, false, 28], [132, -128, false, 28],
      [-134, 178, true, 14], [40, -145, true, 10], [150, -145, true, 8],
      [-52, 188, true, 8], [152, 134, true, 8],
    ]) zebra(x, z, h, l, 5);
  }

  paintCourt() {
    const { ctx } = this;
    const c = COURT;
    const x = toTex(c.x0), y = toTex(c.z0), w = toTex(c.x1) - x, h = toTex(c.z1) - y;
    ctx.fillStyle = '#b9ae98';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#ece8dd';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      const cx = x + 8 + (i * (w - 16)) / 2, cw = (w - 24) / 2, cy = y + 10, ch = h - 20;
      ctx.strokeRect(cx, cy, cw, ch);
      ctx.beginPath();
      ctx.moveTo(cx, cy + ch / 2);
      ctx.lineTo(cx + cw, cy + ch / 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + cw / 2, cy + ch / 2, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  addGrain() {
    const image = this.ctx.getImageData(0, 0, TEX, TEX);
    const d = image.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (this.rng() - 0.5) * 14;
      d[i] += n; d[i + 1] += n; d[i + 2] += n;
    }
    this.ctx.putImageData(image, 0, 0);
  }

  /** The slab's cut faces. Deep enough to read as a solid chunk of ground. */
  buildSkirt() {
    const W = 544, H = 72;
    const { canvas, ctx } = makeCanvas(W, H);
    const r = makeRng(7);
    const bands = [[0, 2, '#7d7a72'], [2, 6, '#a68a60'], [8, 14, '#7a5a3a'], [22, 18, '#5d4329'], [40, 32, '#463523']];
    for (const [y, h, c] of bands) { ctx.fillStyle = c; ctx.fillRect(0, y, W, h); }
    for (let n = 0; n < 5200; n++) {
      ctx.fillStyle = r() < 0.5 ? 'rgba(255,225,180,0.14)' : 'rgba(25,14,6,0.28)';
      ctx.fillRect(r() * W, 2 + r() * (H - 2), r() < 0.2 ? 3 : 1, 1);
    }
    // Embedded rocks in the deepest layer
    for (let n = 0; n < 70; n++) {
      ctx.fillStyle = r() < 0.5 ? '#6b5b48' : '#574838';
      ctx.fillRect(r() * W, 42 + r() * 26, 2 + r() * 5, 2 + r() * 2);
    }
    const tex = pixelTexture(canvas, { repeat: true });
    const b = new MeshBuilder({ textured: true });
    const depth = 58, count = 60, tooth = [0, 4, 2, 6];
    const side = (ax, az, bx, bz, offset) => {
      for (let n = 0; n < count; n++) {
        const t0 = n / count, t1 = (n + 1) / count;
        const j0 = depth + tooth[n % 4], j1 = depth + tooth[(n + 1) % 4];
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0;
        const x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const u0 = (t0 * HALF * 2 + offset) / W, u1 = (t1 * HALF * 2 + offset) / W;
        b.quad([x0, -j0, z0], [x1, -j1, z1], [x1, 0, z1], [x0, 0, z0], '#ffffff',
          [[u0, 1 - j0 / H], [u1, 1 - j1 / H], [u1, 1], [u0, 1]]);
      }
    };
    side(-HALF, HALF, HALF, HALF, 0);
    side(HALF, HALF, HALF, -HALF, 140);
    side(HALF, -HALF, -HALF, -HALF, 280);
    side(-HALF, -HALF, -HALF, HALF, 420);
    addWorldMesh(this.scene, b.build(), new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }), { cast: false, receive: false });
  }
}
