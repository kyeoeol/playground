import * as THREE from 'three';
import { makeLiftStation } from './props.js';
import { Kit } from './meshKit.js';
import { clamp } from '../core/rand.js';
import { toSW } from './coords.js';

const SAG = 0.45;
const R = 1.0; // half the distance between the up and down cables (bullwheel radius)
const BOARD_P = 0.7; // loop position (= s on the up line) of the load line, where a chair picks a rider up
const LOAD_SEAT = 0; // the seat the load line is under (seat 0 hangs at lat R - 0.4)
// The head of the queue steps onto the load line only if it can stand there this many
// seconds before the next chair; otherwise it waits a step behind and goes after that chair.
const LOAD_MARGIN = 0.6;
const READY = 0.12; // how close to the load spot a rider must stand to be picked up
const HUT_LAT = -R - 3.0; // the operator hut stands on the down-line side, away from queue/unload
const HUT_HALF = 1.3; // half its size (0.75 × a 3.3 station) plus a little room
/** Operating hours (in-game clock). */
export const LIFT_HOURS = { open: 7.5, close: 21.5, label: '07:30 – 21:30' };

// ---- 16-bit look: crane-style lattice in a saturated paint, steel, Swiss-red chairs
const PAINT = '#f2a516'; // yellow-orange lattice
const PAINT_LO = '#cf7a14'; // diagonals, a shade darker so the lattice reads in depth
const PAINT_HI = '#ffd04a'; // top caps and edges
const STEEL = '#6c727b', STEEL_LO = '#3b4048', STEEL_HI = '#aab1bb';
const IRON = '#26282e';
const RED = '#d8283c', RED_LO = '#9e1c2c', WHITE = '#f4f7fc';
const CONCRETE = '#a7adb6';

/** Sheave train: a short beam along the cable with three wheels under it. */
function sheaves(k, x, y) {
  k.box(STEEL_LO, 0.16, 0.14, 1.0, x, y + 0.2, 0);
  for (const z of [-0.32, 0, 0.32]) {
    k.cyl(IRON, 0.13, 0.08, 'x', x, y + 0.06, z, 10);
    k.cyl(STEEL_HI, 0.05, 0.1, 'x', x, y + 0.06, z, 6); // hub
  }
}

/**
 * Lift tower like a crane mast: four corner posts, X-bracing on every face, a ladder,
 * a concrete footing with a red plate, and a truss crossarm with sheave trains.
 */
function latticeTower(h) {
  const k = new Kit();
  const W2 = 0.3; // half width of the mast
  const top = h - 0.15;
  // footing (sinks into the slope) and the red base plate
  k.box(CONCRETE, 1.1, 1.0, 1.1, 0, -0.35, 0);
  k.box(RED, 0.86, 0.1, 0.86, 0, 0.2, 0);
  k.box(RED_LO, 0.9, 0.04, 0.9, 0, 0.13, 0);
  // corner posts
  for (const x of [-W2, W2]) for (const z of [-W2, W2]) k.box(PAINT, 0.13, top - 0.2, 0.13, x, (top + 0.2) / 2, z);
  // panels: a ring of horizontals and an X on every face
  const n = Math.max(3, Math.round((top - 0.25) / 0.62));
  const step = (top - 0.25) / n;
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  for (let i = 0; i <= n; i++) {
    const y = 0.25 + i * step;
    k.box(PAINT, 2 * W2, 0.08, 0.08, 0, y, -W2).box(PAINT, 2 * W2, 0.08, 0.08, 0, y, W2);
    k.box(PAINT, 0.08, 0.08, 2 * W2, -W2, y, 0).box(PAINT, 0.08, 0.08, 2 * W2, W2, y, 0);
    if (i === n) break;
    const y1 = y + step;
    for (const z of [-W2, W2]) { k.bar(PAINT_LO, 0.06, V(-W2, y, z), V(W2, y1, z)); k.bar(PAINT_LO, 0.06, V(W2, y, z), V(-W2, y1, z)); }
    for (const x of [-W2, W2]) { k.bar(PAINT_LO, 0.06, V(x, y, -W2), V(x, y1, W2)); k.bar(PAINT_LO, 0.06, V(x, y, W2), V(x, y1, -W2)); }
  }
  // ladder on the downhill face
  const lz = -W2 - 0.12;
  for (const x of [-0.13, 0.13]) k.box(STEEL, 0.05, top - 0.3, 0.05, x, (top + 0.3) / 2, lz);
  for (let y = 0.5; y < top - 0.1; y += 0.25) k.box(STEEL_HI, 0.26, 0.04, 0.04, 0, y, lz);
  // cap and the truss crossarm (two chords with zigzag webs, front and back)
  k.box(PAINT_HI, 2 * W2 + 0.16, 0.1, 2 * W2 + 0.16, 0, top + 0.02, 0);
  const span = R + 0.42, ay = h + 0.28;
  for (const z of [-0.12, 0.12]) {
    k.box(PAINT, 2 * span, 0.09, 0.09, 0, ay + 0.2, z); // top chord
    k.box(PAINT, 2 * span, 0.09, 0.09, 0, ay - 0.08, z); // bottom chord
    const m = 8;
    for (let i = 0; i < m; i++) {
      const x0 = -span + (2 * span * i) / m, x1 = -span + (2 * span * (i + 1)) / m;
      const up = i % 2 === 0;
      k.bar(PAINT_LO, 0.05, V(x0, up ? ay - 0.08 : ay + 0.2, z), V(x1, up ? ay + 0.2 : ay - 0.08, z));
    }
  }
  for (const x of [-span, span]) k.box(PAINT_HI, 0.1, 0.38, 0.34, x, ay + 0.06, 0); // end plates
  // the mast meets the arm: a short red collar
  k.box(RED, 2 * W2 + 0.1, 0.2, 2 * W2 + 0.1, 0, ay - 0.25, 0);
  for (const x of [-R, R]) sheaves(k, x, h - 0.12);
  return k.build();
}

/** Bullwheel: rim, six spokes and a hub, lying flat at height y. */
function bullwheel(k, y) {
  const rim = new THREE.TorusGeometry(R, 0.08, 6, 24);
  k.geo(IRON, rim, 0, y, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i++) k.box(STEEL, 2 * R, 0.05, 0.07, 0, y, 0, 0, (i * Math.PI) / 3, 0);
  k.cyl(STEEL_HI, 0.18, 0.2, 'y', 0, y, 0, 8);
  k.cyl(STEEL_LO, 0.1, 0.9, 'y', 0, y + 0.5, 0, 8); // shaft up to the deck
}

/** Terminal: steel legs with X-bracing, a red deck with a snowy top, the bullwheel under it. */
function terminal(y) {
  const k = new Kit();
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  for (const lx of [-1.9, 1.9]) for (const lz of [-1.5, 1.5]) {
    k.box(STEEL, 0.22, y + 0.6, 0.22, lx, (y + 0.6) / 2, lz);
    k.box(CONCRETE, 0.4, 0.5, 0.4, lx, -0.1, lz); // footing
  }
  for (const lx of [-1.9, 1.9]) {
    k.bar(STEEL_LO, 0.08, V(lx, 0.2, -1.5), V(lx, y + 0.4, 1.5));
    k.bar(STEEL_LO, 0.08, V(lx, 0.2, 1.5), V(lx, y + 0.4, -1.5));
    k.box(STEEL_LO, 0.1, 0.1, 3.0, lx, y + 0.45, 0);
  }
  k.box(STEEL_LO, 4.5, 0.1, 4.0, 0, y + 0.56, 0); // steel band under the deck
  k.box(RED, 4.4, 0.3, 3.9, 0, y + 0.75, 0);
  k.box(RED_LO, 4.42, 0.06, 3.92, 0, y + 0.63, 0);
  k.box(WHITE, 4.44, 0.08, 3.94, 0, y + 0.88, 0); // white trim line
  k.box(WHITE, 4.3, 0.14, 3.8, 0, y + 0.97, 0); // snow on top
  bullwheel(k, y);
  return k.build();
}

/**
 * Double chair: grip on the cable, hanger down to a yoke, side frames, a red seat and
 * back with a white stripe, a closed safety bar and a footrest.
 */
function chairMesh() {
  const k = new Kit();
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  k.box(IRON, 0.2, 0.18, 0.4, 0, 0.0, 0); // grip
  k.box(STEEL_HI, 0.12, 0.08, 0.3, 0, 0.12, 0); // clamp top
  k.box(STEEL_LO, 0.08, 1.05, 0.08, 0, -0.6, 0); // hanger
  k.box(STEEL_LO, 1.66, 0.08, 0.08, 0, -1.08, 0); // yoke
  for (const x of [-0.8, 0.8]) {
    k.box(STEEL_LO, 0.07, 0.68, 0.07, x, -1.4, -0.06); // side frame
    k.box(STEEL, 0.07, 0.07, 0.6, x, -1.72, 0.04); // armrest under the seat edge
  }
  // seat: frame, cushion, front lip
  k.box(STEEL_LO, 1.56, 0.05, 0.56, 0, -1.79, 0.03);
  k.box(RED, 1.5, 0.1, 0.5, 0, -1.72, 0.03);
  k.box(RED_LO, 1.5, 0.05, 0.06, 0, -1.75, 0.29);
  // back, leaning back a little, with a white stripe
  k.box(RED, 1.5, 0.48, 0.08, 0, -1.44, -0.25, -0.12, 0, 0);
  k.box(WHITE, 1.52, 0.07, 0.09, 0, -1.34, -0.24, -0.12, 0, 0);
  k.box(RED_LO, 1.5, 0.05, 0.085, 0, -1.68, -0.22, -0.12, 0, 0);
  // safety bar: arms from the yoke forward, a crossbar, two drop bars and the footrest
  for (const x of [-0.78, 0.78]) k.bar(STEEL, 0.05, V(x, -1.1, 0), V(x, -1.22, 0.42));
  k.box(STEEL, 1.56, 0.05, 0.05, 0, -1.22, 0.42);
  for (const x of [-0.32, 0.32]) k.bar(STEEL, 0.045, V(x, -1.22, 0.42), V(x, -2.02, 0.5));
  k.box(IRON, 0.9, 0.05, 0.2, 0, -2.04, 0.52);
  return k.build();
}

/**
 * A detachable-style double chairlift. Chairs run on a loop: up line,
 * top bullwheel, down line, bottom bullwheel. Riders board from a queue at
 * the bottom. Every rider gets off at the top station, on their own. The bottom exit only
 * catches a rider who is somehow still seated on the way down.
 */
export class ChairLift {
  constructor(terrain, { bx, bz, tx, tz, name = 'Sesselbahn' }) {
    this.terrain = terrain;
    this.bx = bx;
    this.bz = bz;
    const dx = tx - bx, dz = tz - bz;
    this.L = Math.hypot(dx, dz);
    this.dir = { x: dx / this.L, z: dz / this.L };
    this.side = { x: this.dir.z, z: -this.dir.x }; // up line is on the slope's inner side
    this.P = 2 * this.L + 2 * Math.PI * R;
    // loop positions where chairs pass the two exit ramps
    this.exits = { top: this.L - 0.9, base: 2 * this.L + Math.PI * R - 1.0 };
    this.speed = 2.6;
    this.offset = 0;
    this.running = true; // chairs moving
    this.boarding = true; // gate open
    this.queue = [];
    this.loader = null; // the rider allowed onto the load line, waiting for the next chair
    this.group = new THREE.Group();

    this._buildSupports();
    this._buildStructures(name);
    this._buildCables();
    this._buildChairs();
  }

  /** What the avatar bumps into: the towers (circles in x, z) and the operator hut (a box in s, w). */
  obstacles() {
    const circles = this.sup.filter((sp) => sp.tower).map((sp) => {
      const g = this.groundAt(sp.s);
      return { x: g.x, z: g.z, r: 0.35 };
    });
    const hut = this.groundAt(0, HUT_LAT);
    return { circles, boxes: [{ ...toSW(hut.x, hut.z), hs: HUT_HALF, hw: HUT_HALF }] };
  }

  groundAt(s, lat = 0) {
    const x = this.bx + this.dir.x * s + this.side.x * lat;
    const z = this.bz + this.dir.z * s + this.side.z * lat;
    return { x, z, y: this.terrain.heightAt(x, z) };
  }

  _buildSupports() {
    const gy = (s) => this.groundAt(s).y;
    const sup = [{ s: 0, y: gy(0) + 3.4 }];
    const n = Math.max(2, Math.round(this.L / 9));
    for (let k = 1; k < n; k++) {
      const s = (this.L * k) / n;
      sup.push({ s, y: gy(s) + 5.0, tower: true });
    }
    sup.push({ s: this.L, y: gy(this.L) + 3.4 });
    // Raise towers until the sagging cable clears the snow everywhere.
    for (let it = 0; it < 4; it++) {
      for (let k = 0; k < sup.length - 1; k++) {
        const a = sup[k], b = sup[k + 1];
        for (let s = a.s; s <= b.s; s += 0.5) {
          const t = (s - a.s) / (b.s - a.s);
          const y = a.y + (b.y - a.y) * t - SAG * Math.sin(Math.PI * t);
          const need = gy(s) + 3.1;
          if (y < need) {
            if (a.tower) a.y += need - y;
            if (b.tower) b.y += need - y;
          }
        }
      }
    }
    this.sup = sup;
  }

  cableY(s) {
    const sup = this.sup;
    s = clamp(s, 0, this.L);
    let k = 0;
    while (k < sup.length - 2 && s > sup[k + 1].s) k++;
    const a = sup[k], b = sup[k + 1];
    const t = (s - a.s) / (b.s - a.s);
    return a.y + (b.y - a.y) * t - SAG * Math.sin(Math.PI * t);
  }

  /** Point on the cable loop for loop parameter p in [0, P). */
  loopPoint(p, out) {
    const { L } = this;
    const arc = Math.PI * R;
    let s, lat;
    if (p < L) { s = p; lat = R; }
    else if (p < L + arc) { const th = (p - L) / R; s = L + Math.sin(th) * R; lat = Math.cos(th) * R; }
    else if (p < 2 * L + arc) { s = L - (p - L - arc); lat = -R; }
    else { const th = (p - 2 * L - arc) / R; s = -Math.sin(th) * R; lat = -Math.cos(th) * R; }
    out.set(
      this.bx + this.dir.x * s + this.side.x * lat,
      this.cableY(s),
      this.bz + this.dir.z * s + this.side.z * lat,
    );
    return out;
  }

  _buildStructures(name) {
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    for (const sp of this.sup) {
      if (!sp.tower) continue;
      const g = this.groundAt(sp.s);
      const t = latticeTower(sp.y - g.y);
      t.position.set(g.x, g.y, g.z);
      t.rotation.y = yaw;
      this.group.add(t);
    }
    const term = (s, label, withHut) => {
      const g = this.groundAt(s);
      const y = this.cableY(s) - g.y;
      const t = terminal(y);
      if (withHut) {
        const hut = makeLiftStation(label);
        hut.scale.setScalar(0.75);
        hut.position.set(HUT_LAT, 0, 0); // local x runs along this.side
        t.add(hut);
      }
      t.position.set(g.x, g.y, g.z);
      t.rotation.y = yaw;
      this.group.add(t);
      return t;
    };
    this.baseTerminal = term(0, `${name} ▲`, true);
    this.topTerminal = term(this.L, '', false);
  }

  _buildCables() {
    const m = new THREE.LineBasicMaterial({ color: '#23262c' });
    const pts = [];
    const v = new THREE.Vector3();
    for (let p = 0; p <= this.P; p += 0.6) pts.push(this.loopPoint(p % this.P, v).clone());
    pts.push(pts[0].clone());
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m);
    this.group.add(line);
  }

  _buildChairs() {
    const count = Math.floor(this.P / 6.5);
    this.spacing = this.P / count;
    this.chairs = [];
    const proto = chairMesh(); // clones share its geometry and materials
    for (let i = 0; i < count; i++) {
      const g = proto.clone();
      this.group.add(g);
      this.chairs.push({ mesh: g, p: 0, riders: [null, null], yaw: 0 });
    }
    this._place(0);
  }

  /** Ground position where a queue slot stands (slot 0 is at the gate, a step behind the load line). */
  queueSlot(k) {
    const row = Math.floor(k / 6), col = k % 6;
    const s = BOARD_P - 1.4 - (row % 2 ? 5 - col : col) * 0.85; // snake back and forth
    return this.groundAt(s, R + row * 0.7);
  }

  /** The spot on the load line right under the seat a chair picks the rider up with. */
  loadSpot() {
    return this.groundAt(BOARD_P, R + (LOAD_SEAT ? 0.4 : -0.4));
  }

  /** Seconds until the next chair crosses the load line. */
  nextChairIn() {
    if (!this.running) return Infinity;
    const d = (((BOARD_P - this.offset) % this.spacing) + this.spacing) % this.spacing;
    return d / this.speed;
  }

  /**
   * Where a queued rider should stand now (null: not in the queue). The head steps onto the
   * load line when it can stand there LOAD_MARGIN s before the next chair, so the chair comes
   * to the rider; until then it waits at the gate. walkSpeed: the rider's shuffle pace.
   */
  standingSpot(rider, walkSpeed) {
    const i = this.queue.indexOf(rider);
    if (i < 0) return null;
    if (i === 0) {
      const load = this.loadSpot();
      if (this.loader !== rider) {
        const t = Math.hypot(load.x - rider.pos.x, load.z - rider.pos.z) / walkSpeed;
        if (t + LOAD_MARGIN < this.nextChairIn()) this.loader = rider;
      }
      if (this.loader === rider) return load;
    }
    return this.queueSlot(i);
  }

  /** Where riders step off: at the top (up side) or back at the bottom (down side). */
  unloadPoint(i = 0, where = 'top') {
    if (where === 'base') return this.groundAt(1.4, -(R + 1.3 + i * 0.6));
    // well clear of the up line and its last tower, on open snow beside the top station
    return this.groundAt(this.L - 1.0, R + 6.0 + i * 0.7);
  }

  join(rider) {
    this.queue.push(rider);
    return this.queue.length - 1;
  }

  leave(rider) {
    const i = this.queue.indexOf(rider);
    if (i >= 0) this.queue.splice(i, 1);
    if (this.loader === rider) this.loader = null;
  }

  /** Take a rider off the lift completely: out of the queue and off any chair (respawn). */
  remove(rider) {
    this.leave(rider);
    for (const c of this.chairs) c.riders.forEach((r, k) => { if (r === rider) c.riders[k] = null; });
  }

  _place(dt) {
    const a = _a, b = _b;
    for (let i = 0; i < this.chairs.length; i++) {
      const c = this.chairs[i];
      const prev = c.p;
      c.p = (this.offset + i * this.spacing) % this.P;
      this.loopPoint(c.p, a);
      this.loopPoint((c.p + 0.2) % this.P, b);
      c.mesh.position.copy(a);
      c.yaw = Math.atan2(b.x - a.x, b.z - a.z);
      c.mesh.rotation.y = c.yaw;
      c.mesh.rotation.z = Math.sin(this.offset * 0.7 + i) * 0.03;
      if (dt > 0 && this.running) {
        if (this.boarding && crossed(prev, c.p, BOARD_P)) this._board(c);
        if (crossed(prev, c.p, this.exits.top)) this._unload(c, 'top');
        if (crossed(prev, c.p, this.exits.base)) this._unload(c, 'base');
      }
      if (!c.riders[0] && !c.riders[1]) continue;
      // the seat swings with the chair: place riders through the chair's own transform
      c.mesh.updateMatrix();
      for (let k = 0; k < 2; k++) {
        const r = c.riders[k];
        if (!r) continue;
        _seat.set(k ? 0.4 : -0.4, -1.68, 0).applyMatrix4(c.mesh.matrix);
        r.seat(_seat.x, _seat.y, _seat.z, c.yaw, c.mesh.rotation.z);
      }
    }
  }

  /**
   * For one rendered frame, move every chair onto the art lattice so its thin bars keep
   * the same pixels from frame to frame. A chair's riders move by the same amount, so
   * they stay in their seats. deltaFor(p) returns the shift for world point p (a reused
   * vector is fine); skip: a chair to leave where it is (drawn by the rider layer).
   * Call unsnap() after the render: the simulation uses true positions.
   */
  snapToLattice(deltaFor, skip = null) {
    for (const c of this.chairs) {
      const d = (c.snap ??= new THREE.Vector3());
      if (c === skip) { d.set(0, 0, 0); continue; }
      d.copy(deltaFor(c.mesh.position));
      c.mesh.position.add(d);
      for (const r of c.riders) if (r) r.pos.add(d);
    }
  }

  unsnap() {
    for (const c of this.chairs) {
      if (!c.snap) continue;
      c.mesh.position.sub(c.snap);
      for (const r of c.riders) if (r) r.pos.sub(c.snap);
      c.snap.set(0, 0, 0);
    }
  }

  /** A chair crosses the load line: it takes the rider standing there, if one is (not one still on the way). */
  _board(c) {
    const r = this.loader;
    if (!r || c.riders[LOAD_SEAT]) return;
    const load = this.loadSpot();
    if (Math.hypot(load.x - r.pos.x, load.z - r.pos.z) > READY) return; // not there yet: the next chair
    this.leave(r);
    c.riders[LOAD_SEAT] = r;
    r.onBoard(this);
  }

  _unload(c, where) {
    c.riders.forEach((r, k) => {
      if (!r) return; // everyone gets off
      c.riders[k] = null;
      r.onUnload(this.unloadPoint(k, where), where);
    });
  }

  /** The chair a rider sits on, or null. */
  chairOf(rider) {
    return this.chairs.find((c) => c.riders[0] === rider || c.riders[1] === rider) ?? null;
  }

  hasRiders() {
    return this.chairs.some((c) => c.riders[0] || c.riders[1]);
  }

  update(dt) {
    if (this.running) this.offset = (this.offset + this.speed * dt) % this.P;
    this._place(dt);
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _seat = new THREE.Vector3();

function crossed(a, b, x) {
  return b >= a ? a < x && x <= b : x > a || x <= b;
}
