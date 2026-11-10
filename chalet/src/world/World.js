import * as THREE from 'three';
import { Pistes } from './Pistes.js';
import { Terrain, NX, NZ, K, SLOPE_END, PADS } from './Terrain.js';
import { ChairLift, LIFT_HOURS } from './Lift.js';
import { ParticlePool } from './Effects.js';
import { Environment } from './Environment.js';
import { Water } from './Water.js';
import { buildSlopeEdges, NET } from './SlopeEdges.js';
import { toSW, fromSW, FACE_FRONT, DOWNHILL, HALF } from './coords.js';
import { makeFlag, makePisteSign, makePisteMarkers, makeForest, makeTufts, makeRocks } from './props.js';
import { makeBridge } from './villageProps.js';
import { Snowcat } from '../agents/Snowcat.js';
import { seeded, rand, chance } from '../core/rand.js';

/*
 * Layout in (s, w): s runs from edge AB (ridge, s = 0) to edge CD (s = 105),
 * w runs across, −28 (A–D side) … +28 (B–C side). The village keeps to |w| < 24;
 * forest fills the strips outside it.
 *
 *   s  0 – 64   the slope: three pistes and the chairlift on clean snow (no trees, no buildings),
 *               safety nets and floodlight masts along both sides, forest outside them
 *   s 64 – 69   ski base: the lift station
 *   s ≈ 70      frozen creek with three bridges
 *   s 70 – 105  open snow for the town the user builds (see src/village), a frozen pond
 *               by edge CD. Nothing stands here at the start.
 */
const LIFT_W = 17; // the chairlift runs up the right side of the slope
const PARK = { s: 53.4, w: 22 }; // the snowcat's parking spot on the slope
const CREEK = [[69.4, -29], [69.6, -25], [70.4, -17], [69.5, -9], [70.8, -1], [69.8, 7], [71, 15], [70, 25], [69.6, 29]];
const POND = { s: 102.3, w: -4, rs: 1.9, rw: 6.2 }; // frozen skating pond by edge CD
const BRIDGES = [9.5, -6.3, -18.5];
const SMOKE_C = new THREE.Color('#d6dbe2'), SPRAY_C = new THREE.Color('#ffffff');

export class World {
  constructor(scene, camera, clock) {
    this.scene = scene;
    this.clock = clock;
    this.time = 0;
    this.liftOpen = true;
    this.chimneys = [];
    this.flags = [];
    this.circles = []; // round obstacles {x, z, r}
    this.boxes = []; // (s, w)-aligned obstacles {s, w, hs, hw}
    this.decks = []; // bridge decks {s, w, hs, hw, y}
    this.buildHandles = []; // user builds on the map (see addBuild)

    this.pistes = new Pistes();
    const T = (this.terrain = new Terrain(this.pistes));
    this.creek = sampleCreek();
    this.creekS0 = Math.min(...this.creek.map((p) => p.s));
    this.creekS1 = Math.max(...this.creek.map((p) => p.s));
    this._layoutGround();
    scene.add(T.build());
    // running water in the creek (the skating pond stays frozen)
    this.water = new Water(T, (i, j) => this.isCreekTile(i, j));
    scene.add(this.water.mesh);

    this.env = new Environment(scene, camera, T);
    this.spray = new ParticlePool(1200, { color: '#ffffff', size: 2, gravity: -8, drag: 1.8 });
    this.smoke = new ParticlePool(500, { color: '#d6dbe2', size: 2, opacity: 0.5, gravity: 0.25, drag: 0.4 });
    scene.add(this.spray.points, this.smoke.points);

    const b = fromSW(65.5, LIFT_W), t = fromSW(4.2, LIFT_W);
    this.lift = new ChairLift(T, { bx: b.x, bz: b.z, tx: t.x, tz: t.z, name: 'GLIMMERHORN' });
    scene.add(this.lift.group);
    const liftObs = this.lift.obstacles();
    this.circles.push(...liftObs.circles);
    this.boxes.push(...liftObs.boxes);

    this._buildSlope();
    this._buildBase();
    this._buildNature();

    const sp = fromSW(86, 2); // in the middle of the empty valley
    this.spawn = { ...sp, yaw: Math.PI / 4 }; // face the camera (it looks from +x +z)
    this.snowcat = new Snowcat(this, this.garage);
    scene.add(this.snowcat.model);
  }

  // ------------------------------------------------------------ helpers

  ground(x, z) {
    let h = this.terrain.heightAt(x, z);
    const d = this.deckAt(x, z);
    return d ? Math.max(h, d.y) : h;
  }

  /** The bridge deck over (x, z), if any. */
  deckAt(x, z) {
    const { s, w } = toSW(x, z);
    return this.decks.find((d) => Math.abs(s - d.s) < d.hs && Math.abs(w - d.w) < d.hw);
  }

  /** A creek tile holds water (the pond is a creek-kind tile too, but frozen). */
  isCreekTile(i, j) {
    const x = i + 0.5, z = j + 0.5;
    if (this.terrain.kindAt(x, z) !== K.CREEK) return false;
    const { s, w } = toSW(x, z);
    return this.pondDist(s, w) >= 0;
  }

  /** True if a circle of radius r at (x, z) touches water that is not under a bridge deck. */
  inWater(x, z, r = 0) {
    for (const [ox, oz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      const px = x + ox, pz = z + oz;
      if (this.isCreekTile(Math.floor(px), Math.floor(pz)) && !this.deckAt(px, pz)) return true;
    }
    return false;
  }

  /** True if (s, w) is within r of the creek's centre line. */
  nearCreek(s, w, r) {
    if (s < this.creekS0 - r || s > this.creekS1 + r) return false; // the creek runs across the slope in a narrow band of s
    return this.creek.some((p) => Math.hypot(p.s - s, p.w - w) < r);
  }

  /** 0 at the pond's rim, < 0 inside it (in pond radii). */
  pondDist(s, w) {
    return Math.hypot((s - POND.s) / POND.rs, (w - POND.w) / POND.rw) - 1;
  }

  creekAt(w) {
    let best = this.creek[0];
    for (const p of this.creek) if (Math.abs(p.w - w) < Math.abs(best.w - w)) best = p;
    return best.s;
  }

  /** Place obj at (s, w). A building blocks its own footprint unless `block` overrides it. */
  put(obj, s, w, { rot = FACE_FRONT, block = null, circle = 0, y = null } = {}) {
    const fp = obj.userData.footprint;
    block ??= fp && [fp.w, fp.d];
    const { x, z } = fromSW(s, w);
    obj.position.set(x, y ?? this.terrain.heightAt(x, z), z);
    obj.rotation.y = rot;
    this.scene.add(obj);
    if (block) this.boxes.push({ s, w, hs: block[1] / 2, hw: block[0] / 2 });
    if (circle) this.circles.push({ x, z, r: circle });
    if (obj.userData.chimney) {
      obj.updateMatrixWorld(true);
      this.chimneys.push(obj.localToWorld(obj.userData.chimney.clone()));
    }
    return obj;
  }

  collide(x, z, r) {
    let hit = false, big = false;
    for (const c of this.circles) {
      const dx = x - c.x, dz = z - c.z;
      const d = Math.hypot(dx, dz), min = c.r + r;
      if (d < min && d > 1e-6) { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; hit = true; big ||= c.r >= 0.25; }
    }
    // the snowcat (it moves): two circles along its length
    const sc = this.snowcat;
    if (sc) {
      const fx = Math.sin(sc.yaw), fz = Math.cos(sc.yaw);
      for (const k of [-1.1, 1.1]) {
        const cx = sc.pos.x + fx * k, cz = sc.pos.z + fz * k;
        const dx = x - cx, dz = z - cz, d = Math.hypot(dx, dz), min = 1.25 + r;
        if (d < min && d > 1e-6) { x = cx + (dx / d) * min; z = cz + (dz / d) * min; hit = true; big = true; }
      }
    }
    let { s, w } = toSW(x, z);
    for (const b of this.boxes) {
      const ds = s - b.s, dw = w - b.w;
      const ps = b.hs + r - Math.abs(ds), pw = b.hw + r - Math.abs(dw);
      if (ps > 0 && pw > 0) {
        if (ps < pw) s += Math.sign(ds || 1) * ps;
        else w += Math.sign(dw || 1) * pw;
        hit = true;
        big = true;
      }
    }
    return hit ? { ...fromSW(s, w), big } : null;
  }

  // ------------------------------------------------------------ ground plan (tiles)

  _layoutGround() {
    const T = this.terrain;
    T.fill((s) => Math.abs(s - 64.8) < 0.95, K.PATH); // run-out lane along the bottom of the slope
    // the creek and the skating pond are sunk one level, with stony banks
    T.fill((s, w) => this.nearCreek(s, w, 1.75), K.BANK);
    T.fill((s, w) => this.nearCreek(s, w, 0.95), K.CREEK, -1);
    T.fill((s, w) => this.pondDist(s, w) < 0.32, K.BANK);
    T.fill((s, w) => this.pondDist(s, w) < 0, K.CREEK, -1);
  }

  // ------------------------------------------------------------ slope

  _buildSlope() {
    for (const p of this.pistes.list) {
      this.scene.add(makePisteMarkers(p, this.terrain));
      const o = {};
      p.sample(1.2, o);
      const sx = o.x - o.nx * (p.half + 0.7), sz = o.z - o.nz * (p.half + 0.7);
      const sign = makePisteSign(p);
      sign.scale.setScalar(0.75);
      sign.position.set(sx, this.terrain.heightAt(sx, sz), sz);
      sign.rotation.y = FACE_FRONT;
      this.scene.add(sign);
    }
    const f = this.put(makeFlag(), 3.6, 4.5);
    f.scale.setScalar(0.7);
    this.flags.push(f.userData.flag);
    buildSlopeEdges(this); // safety nets + night floodlights
  }

  // ------------------------------------------------------------ ski base between slope and creek

  _buildBase() {
    // The snowcat stays on the slope: it parks on open snow right of the lift line,
    // facing downhill, and never drives into the village.
    const g = fromSW(PARK.s, PARK.w);
    this.garage = { x: g.x, z: g.z, yaw: DOWNHILL };
    for (const w of BRIDGES) {
      const s = this.creekAt(w);
      const br = makeBridge(3.6, 1.6);
      br.scale.setScalar(0.9);
      const { x, z } = fromSW(s, w);
      br.position.set(x, -0.15, z);
      br.rotation.y = FACE_FRONT;
      this.scene.add(br);
      this.decks.push({ s, w, hs: 1.8, hw: 0.9, y: 0.12 });
    }
  }

  // ------------------------------------------------------------ trees, tufts, rocks

  _buildNature() {
    const T = this.terrain;
    const rnd = seeded(42);
    const trees = [], tufts = [], rocks = [];
    const blocked = (x, z, r) => this.collide(x, z, r) !== null;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const x = i + 0.2 + rnd() * 0.6, z = j + 0.2 + rnd() * 0.6;
        const { s, w } = toSW(x, z);
        const y = T.heightAt(x, z);
        const k = T.kindAt(x, z);
        if (k !== K.SNOW && k !== K.ROCK) continue;
        const pd = T.pisteDist[j * NX + i];
        const nearLift = Math.abs(w - LIFT_W) < 2.6 && s > 3;
        const nearPad = PADS.some((p) => Math.hypot(s - p.s, w - p.w) < p.r + 1.5);
        const nearPark = Math.hypot(s - PARK.s, w - PARK.w) < 4.2; // keep the snowcat's spot clear
        if (nearLift || nearPad || nearPark || pd < 1.0) continue;
        const back = Math.min(x, z); // distance to the back edges (A–D side and AB)
        const side = HALF - Math.abs(w);
        let p;
        // on the slope, trees line only its edges: the open snow in between stays clean
        const inNets = s > NET.s0 - 0.5 && w > NET.left - 0.8 && w < NET.right + 0.8;
        if (s < SLOPE_END - 1) p = inNets ? 0 : back < 3.2 ? 0.85 : side < 3.5 ? 0.75 : back < 6 || side < 6 ? 0.4 : 0;
        // beside the village: a dense forest strip on the far (A–D) side; the near (B–C) side
        // faces the camera, so only a few trees there, and none in front of the ski base
        else if (w < -24.6 && s < 98.4) p = 0.55;
        else if (w > 24.6 && s > 73 && s < 98.4) p = 0.12;
        else p = 0; // the open valley stays clear for the town
        if (s < 4 && Math.abs(w) < 7) p = 0; // keep the summit clear
        if (this.nearCreek(s, w, 2.4) || this.pondDist(s, w) < 0.6) p = 0;
        if (rnd() < p && !blocked(x, z, 0.6)) {
          trees.push({ x, y, z, scale: 0.8 + rnd() * 0.35, rot: rnd() * 6.28 });
          continue;
        }
        if (k === K.ROCK && rnd() < 0.25) rocks.push({ x, y: y - 0.05, z, scale: 0.3 + rnd() * 0.4, rot: rnd() * 6 });
        // the valley's snow stays bare (no scattered tufts); the draws a tuft used are still
        // taken, so the trees and rocks after it keep their places
        if (s > SLOPE_END - 1 && k === K.SNOW && rnd() < (Math.abs(w) > 24 ? 0.1 : 0.025) && !blocked(x, z, 0.3)) { rnd(); rnd(); }
      }
    }
    // fuzz the front edges (CD and the valley part of BC) with tufts
    const edge = [];
    for (let x = 0; x < NX; x += 0.7) edge.push([x, NZ - 0.15]);
    for (let z = SLOPE_END; z < NZ; z += 0.7) edge.push([NX - 0.15, z]);
    for (const [x, z] of edge) {
      if (T.kindAt(x, z) !== K.SNOW || rnd() < 0.35) continue;
      tufts.push({ x, y: T.heightAt(x, z), z, scale: 0.7 + rnd() * 0.6, rot: rnd() * 6 });
    }
    for (const t of trees) this.circles.push((t.circle = { x: t.x, z: t.z, r: 0.3 * t.scale, tree: t }));
    this.scene.add(makeForest(trees));
    this.trees = trees;
    if (tufts.length) this.scene.add(makeTufts(tufts));
    for (const t of tufts) t.circle = { x: t.x, z: t.z, r: 0.2, tuft: true };
    this.tufts = tufts;
    if (rocks.length) this.scene.add(makeRocks(rocks));
  }

  // ------------------------------------------------------------ builds (placed by the user)

  /**
   * Can a building with half sizes (hs, hw) stand at (s, w)? It needs flat valley ground
   * (snow or a garden plot: no street, creek, bank, raised patio or slope) and no other
   * building or prop in the way. Trees do not count: building there clears them.
   */
  canBuild(s, w, hs, hw) {
    const T = this.terrain;
    if (s - hs < SLOPE_END + 1.6 || s + hs > NZ - 0.2 || Math.abs(w) + hw > HALF - 0.2) return false;
    const ok = new Set([K.SNOW, K.PLOT]);
    // every tile the footprint covers (a tile it only touches does not count)
    const x0 = w - hw + HALF, x1 = w + hw + HALF, z0 = s - hs, z1 = s + hs, e = 1e-6;
    for (let j = Math.floor(z0 + e); j < z1 - e; j++) {
      for (let i = Math.floor(x0 + e); i < x1 - e; i++) {
        if (!ok.has(T.kindAt(i + 0.5, j + 0.5))) return false;
        // the part of the tile under the footprint, in tile coordinates (0…1)
        const a0 = Math.max(x0 - i, 0), a1 = Math.min(x1 - i, 1), b0 = Math.max(z0 - j, 0), b1 = Math.min(z1 - j, 1);
        // the tile is two flat triangles split along fx + fz = 1, so the surface is highest
        // and lowest at the corners of that part or where the split crosses its edges
        const pts = [[a0, b0], [a1, b0], [a0, b1], [a1, b1], [a0, 1 - a0], [a1, 1 - a1], [1 - b0, b0], [1 - b1, b1]];
        for (const [fx, fz] of pts) {
          if (fx < a0 - e || fx > a1 + e || fz < b0 - e || fz > b1 + e) continue;
          if (Math.abs(T.heightIn(i, j, fx, fz)) > 0.04) return false;
        }
      }
    }
    for (const b of this.boxes) if (Math.abs(s - b.s) < hs + b.hs && Math.abs(w - b.w) < hw + b.hw) return false;
    for (const c of this.circles) {
      if (c.tree) continue;
      const p = toSW(c.x, c.z);
      if (Math.abs(s - p.s) < hs + c.r && Math.abs(w - p.w) < hw + c.r) return false;
    }
    if (this.decks.some((d) => Math.abs(s - d.s) < hs + d.hs && Math.abs(w - d.w) < hw + d.hw)) return false;
    return true;
  }

  /** Does the box {s, w, hs, hw} touch tree (or tuft) t? */
  _covers(box, t) {
    const p = toSW(t.x, t.z), r = t.circle.r + 0.25;
    return Math.abs(box.s - p.s) < box.hs + r && Math.abs(box.w - p.w) < box.hw + r;
  }

  /** Trees (and snowy tufts) whose circle touches the box, and that no build hides yet. */
  treesIn(box) {
    return [...(this.trees || []), ...(this.tufts || [])].filter((t) => !t.hiddenBy && this._covers(box, t));
  }

  /** Show or hide one forest tree (and its trunk collision). */
  _setTree(t, visible) {
    const m4 = new THREE.Matrix4();
    t.im.getMatrixAt(t.index, m4);
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
    m4.decompose(p, q, sc);
    sc.setScalar(visible ? t.scale : 0);
    t.im.setMatrixAt(t.index, m4.compose(p, q, sc));
    t.im.instanceMatrix.needsUpdate = true;
    t.im.computeBoundingSphere();
    if (t.circle.tuft) return; // tufts never block
    const i = this.circles.indexOf(t.circle);
    if (visible && i < 0) this.circles.push(t.circle);
    if (!visible && i >= 0) this.circles.splice(i, 1);
  }

  /**
   * Put a user build on the map: blocks its footprint, clears trees under it, adds its
   * chimney smoke. (fw, fd) is the footprint already turned by rot. Returns a handle for removeBuild.
   */
  addBuild(obj, s, w, rot, fw, fd) {
    const box = { s, w, hs: fd / 2, hw: fw / 2 };
    const trees = this.treesIn(box);
    const h = { obj, box, trees, chimney: null, star: obj.userData.star || null };
    for (const t of trees) { t.hiddenBy = h; this._setTree(t, false); }
    const n = this.chimneys.length;
    this.put(obj, s, w, { rot, block: false });
    this.boxes.push(h.box);
    this.buildHandles.push(h);
    if (this.chimneys.length > n) h.chimney = this.chimneys[n];
    if (h.star) (this.stars ||= []).push(h.star);
    return h;
  }

  removeBuild(h) {
    this.scene.remove(h.obj);
    const drop = (list, x) => { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); };
    drop(this.boxes, h.box);
    drop(this.buildHandles, h);
    if (h.chimney) drop(this.chimneys, h.chimney);
    if (h.star) drop(this.stars, h.star);
    for (const t of h.trees) {
      // a neighbour may stand over the same tree: then it stays hidden, under that build
      const other = this.buildHandles.find((o) => this._covers(o.box, t));
      if (other) { t.hiddenBy = other; other.trees.push(t); }
      else { t.hiddenBy = null; this._setTree(t, true); }
    }
  }

  /**
   * The free spot nearest (x, z) that the avatar can walk to from the bridges: not in a
   * build, a tree trunk or the water, and not in a yard that builds wall in all round.
   * Searched on a half-tile grid over the valley. Null if there is none.
   */
  freeSpot(x, z) {
    const STEP = 0.5, s0 = SLOPE_END + 1, w0 = -HALF + 0.5;
    const ns = Math.floor((NZ - 0.5 - s0) / STEP) + 1, nw = Math.floor((HALF - 0.5 - w0) / STEP) + 1;
    const at = (k) => fromSW(s0 + Math.floor(k / nw) * STEP, w0 + (k % nw) * STEP);
    const free = (k) => { const p = at(k); return !this.collide(p.x, p.z, 0.4) && !this.inWater(p.x, p.z, 0.3); };
    const seen = new Uint8Array(ns * nw);
    const queue = [];
    for (const d of this.decks) { // the bridges: builds never stand on them
      const k = Math.round((d.s - s0) / STEP) * nw + Math.round((d.w - w0) / STEP);
      if (k >= 0 && k < seen.length && !seen[k]) { seen[k] = 1; if (free(k)) queue.push(k); }
    }
    let best = null, bestD = Infinity;
    for (let q = 0; q < queue.length; q++) {
      const k = queue[q], p = at(k), d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = p; }
      const a = Math.floor(k / nw), b = k % nw;
      for (const [na, nb] of [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]]) {
        if (na < 0 || na >= ns || nb < 0 || nb >= nw) continue;
        const nk = na * nw + nb;
        if (seen[nk]) continue;
        seen[nk] = 1;
        if (free(nk)) queue.push(nk);
      }
    }
    return best;
  }

  update(dt) {
    this.time += dt;
    this.liftOpen = this.clock.between(LIFT_HOURS.open, LIFT_HOURS.close);
    this.lift.boarding = this.liftOpen;
    this.lift.running = this.liftOpen || this.lift.hasRiders();
    this.lift.update(dt);
    this.snowcat.update(dt, this.time);

    for (const c of this.chimneys) {
      if (chance(dt * (1.2 + this.env.night * 2))) {
        this.smoke.emit(c.x + rand(-0.1, 0.1), c.y, c.z, 0.3 + this.env.w.wind * 1.5, 0.5, 0, rand(4, 6));
      }
    }
    this.smoke.points.material.color.copy(SMOKE_C).multiplyScalar(1 - 0.7 * this.env.night);
    this.spray.points.material.color.copy(SPRAY_C).multiplyScalar(1 - 0.55 * this.env.night);
    this.water.update(dt);
    this.spray.update(dt);
    this.smoke.update(dt);

    for (const f of this.flags) f.rotation.y = Math.sin(this.time * 2.2 + f.id) * 0.25 - this.env.w.wind * 0.5;
    for (const st of this.stars || []) st.rotation.y += dt * 1.2;
    if (this.env.w.snow > 0.15) {
      this.dustT = (this.dustT ?? 0) - dt;
      if (this.dustT <= 0) { this.dustT = 1; this.terrain.dust(0.012 * this.env.w.snow); }
    }
    this.terrain.flush(dt);
  }
}

function sampleCreek() {
  const curve = new THREE.CatmullRomCurve3(CREEK.map(([s, w]) => new THREE.Vector3(s, 0, w)), false, 'centripetal');
  return curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.3)).map((v) => ({ s: v.x, w: v.z }));
}
