import * as THREE from 'three';
import { toSW, fromSW } from '../world/coords.js';
import { rand, randInt } from '../core/rand.js';
import { byId, footprintOf } from './catalog.js';
import { api } from './api.js';
import { pickFolder } from './Dialogs.js';

const SNAP = 0.5; // build positions snap to half tiles
const QUARTER = Math.PI / 2;
const TURN = Math.PI * 2;
const AVATAR_R = 0.4; // the avatar's collision radius (Player._move)

/** Free the GPU buffers made for one build model. Shared (cached) geometry and materials stay. */
function disposeModel(obj, { materials = false } = {}) {
  obj.traverse((o) => {
    if (!o.isMesh) return;
    if (o.geometry?.userData.owned) o.geometry.dispose();
    if (materials) for (const m of [o.material].flat()) m.dispose(); // own clones only (the ghost)
  });
}

/*
 * The town the user builds.
 *  - Houses: each one is a Claude Code session in a folder. A name tag floats over the
 *    roof and shows its state (working, new answer); a click opens its chat (onOpen).
 *  - Decorations (trees, benches, lamps, ...): only for the look. A click on one offers
 *    to turn it or clear it away (onDecor).
 *  - place(): a ghost follows the pointer over the valley floor, green where it fits and
 *    red where it does not. A house asks for a folder when it is put down; decorations
 *    can be put down one after another until Esc.
 */
/**
 * What a house is doing, for its name tag: { kind, label }.
 * kind: 'working' | 'ask' (waits for the user) | 'starting' | 'unread' | 'error' | ''
 */
export function houseState(b) {
  if (b.needsTrust) return { kind: 'ask', label: 'Trust folder?' };
  if (b.status === 'blocked') return { kind: 'ask', label: 'Needs you' };
  if (b.status === 'stuck') return { kind: 'ask', label: 'Check in Rex' };
  if (b.status === 'working') return { kind: 'working', label: 'Working' };
  if (b.status === 'starting') return { kind: 'starting', label: 'Starting' };
  const err = !!b.messages?.at(-1)?.error;
  if (b.unread) return { kind: err ? 'error' : 'unread', label: 'New reply' };
  return { kind: err ? 'error' : '', label: '' };
}

export class Village {
  constructor({ world, player, scene, camera, canvas, tagLayer, onOpen, onDecor, onChange, toast }) {
    Object.assign(this, { world, player, scene, camera, canvas, tagLayer, onOpen, onDecor, onChange, toast });
    this.builds = new Map(); // id -> { data, item, obj, handle, tag, top }
    this.ghost = null; // placement state
    this.claude = undefined; // path of the claude CLI, null if missing (set on load)
    this.rex = undefined; // path of the rex CLI, null if missing (set on load)
    this.ray = new THREE.Raycaster();
    this._ndc = new THREE.Vector2();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this._v = new THREE.Vector3();

    api.on('village:data', ({ builds, claude, rex }) => {
      if (claude !== undefined) this.claude = claude;
      if (rex !== undefined) this.rex = rex;
      for (const b of builds) this._upsert(b);
      this.player?.unstick(); // the saved town may stand where the avatar starts
      this.onChange?.();
    });
    api.on('build:changed', (b) => {
      this._upsert(b);
      if (this.ghost) this._fitGhost(); // the spot may be taken now
      if (b.done) this.toast?.(`${b.name} · ${b.messages.at(-1)?.error ? 'Task stopped' : 'Task done'}`);
      this.onChange?.(b.id);
      if (b.id === this.pendingOpen) { this.pendingOpen = null; this.onOpen?.(b.id); }
    });
    api.on('build:removed', ({ id }) => { this._drop(id); this.onChange?.(id); });
    // the main process refused a new house (its folder is already another house's):
    // take back the one put on the map ahead of time
    api.on('build:rejected', ({ id, reason }) => {
      if (id === this.pendingOpen) this.pendingOpen = null;
      this._drop(id);
      this.onChange?.(id);
      this.toast?.(reason);
    });
    api.send('village:load');
  }

  get(id) { return this.builds.get(id)?.data; }
  isHouse(id) { return !!this.builds.get(id)?.item.session; }

  // ---------------------------------------------------------------- builds

  _model(b) {
    const { data, item } = b;
    const obj = item.make(data.variant || 0);
    const fp = footprintOf(obj, data.rot);
    b.obj = obj;
    b.fp = fp;
    b.handle = this.world.addBuild(obj, data.s, data.w, data.rot, fp.w, fp.d);
    obj.traverse((o) => { o.userData.buildId = data.id; });
    const box = new THREE.Box3().setFromObject(obj);
    b.top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y + 0.35, (box.min.z + box.max.z) / 2);
    b.key = `${data.rot}|${data.variant || 0}`;
  }

  _upsert(data) {
    let b = this.builds.get(data.id);
    if (!b) {
      const item = byId(data.type);
      if (!item) return;
      b = { data, item, tag: null, puff: 0 };
      this._model(b);
      if (item.session) {
        const tag = document.createElement('button');
        tag.className = 'build-tag';
        tag.innerHTML = '<i class="dot"></i><span class="name"></span><span class="state"></span>';
        tag.onclick = () => this.onOpen?.(data.id);
        this.tagLayer.appendChild(tag);
        b.tag = tag;
      }
      this.builds.set(data.id, b);
    }
    b.data = data;
    if (b.key !== `${data.rot}|${data.variant || 0}`) { // turned or repainted
      this.world.removeBuild(b.handle);
      disposeModel(b.obj);
      this._model(b);
    }
    const tag = b.tag;
    if (!tag) return;
    const st = houseState(data);
    tag.querySelector('.name').textContent = data.name;
    tag.querySelector('.state').textContent = st.label;
    for (const k of ['working', 'unread', 'error', 'ask', 'starting']) tag.classList.toggle(k, st.kind === k);
  }

  _drop(id) {
    const b = this.builds.get(id);
    if (!b) return;
    this.world.removeBuild(b.handle);
    disposeModel(b.obj);
    b.tag?.remove();
    this.builds.delete(id);
  }

  remove(id) { api.send('build:remove', { id }); }

  /** Is the avatar inside the box (s, w, hs, hw), counting its radius? */
  _avatarIn(s, w, hs, hw) {
    const p = this.player?.pos;
    if (!p) return false;
    const a = toSW(p.x, p.z);
    return Math.abs(a.s - s) < hs + AVATAR_R && Math.abs(a.w - w) < hw + AVATAR_R;
  }

  /** The house the avatar stands by (within reach of its walls), the nearest one; or null. */
  nearHouse(reach = 2.2) {
    const p = this.player?.pos;
    if (!p) return null;
    const a = toSW(p.x, p.z);
    let best = null, bestD = reach;
    for (const b of this.builds.values()) {
      if (!b.item.session || !b.fp) continue;
      const ds = Math.max(0, Math.abs(a.s - b.data.s) - b.fp.d / 2), dw = Math.max(0, Math.abs(a.w - b.data.w) - b.fp.w / 2);
      const d = Math.hypot(ds, dw);
      if (d < bestD) { bestD = d; best = b.data.id; }
    }
    return best;
  }

  /** Why a build with half sizes (hs, hw) cannot stand at (s, w): 'ground', 'avatar', or null if it fits. */
  _blocker(s, w, hs, hw) {
    if (!this.world.canBuild(s, w, hs, hw)) return 'ground';
    if (this._avatarIn(s, w, hs, hw)) return 'avatar';
    return null;
  }

  /** Turn a build a quarter, if it still fits. */
  turn(id) {
    const b = this.builds.get(id);
    if (!b) return;
    const rot = (b.data.rot + QUARTER) % TURN;
    const fp = footprintOf(b.obj, rot);
    const boxes = this.world.boxes, i = boxes.indexOf(b.handle.box);
    if (i >= 0) boxes.splice(i, 1); // not in its own way
    const why = this._blocker(b.data.s, b.data.w, fp.d / 2, fp.w / 2);
    if (i >= 0) boxes.splice(i, 0, b.handle.box);
    if (!why) api.send('build:update', { id, patch: { rot } });
    else this.toast?.(why === 'avatar' ? 'It would hit your avatar · step aside and rotate again' : 'It would hit its neighbor');
  }

  /** Next colour variant of a build. */
  repaint(id) {
    const b = this.builds.get(id);
    if (b && b.item.variants > 1) api.send('build:update', { id, patch: { variant: ((b.data.variant || 0) + 1) % b.item.variants } });
  }

  // ---------------------------------------------------------------- placement

  get placing() { return !!this.ghost; }

  /** Start placing a build of catalog item `type`. */
  place(type) {
    this.cancel();
    const item = byId(type);
    const group = new THREE.Group();
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#5fd16b', transparent: true, opacity: 0.38, depthWrite: false }));
    pad.renderOrder = 4;
    group.add(pad);
    group.visible = false;
    this.scene.add(group);
    this.ghost = { item, group, obj: null, pad, rot: 0, variant: randInt(0, item.variants - 1), s: 0, w: 0, ok: false, busy: false };
    this._ghostModel();
    this.onChange?.();
  }

  /** (Re)make the see-through model of the ghost, for its item and variant. */
  _ghostModel() {
    const g = this.ghost;
    if (g.obj) { g.group.remove(g.obj); disposeModel(g.obj, { materials: true }); }
    const obj = g.item.make(g.variant);
    // own see-through materials, so the real ones keep their look
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const mats = [o.material].flat().map((m) => {
        const c = m.clone();
        c.transparent = true;
        c.opacity = Math.min(c.opacity ?? 1, 0.72);
        c.depthWrite = false;
        return c;
      });
      o.material = Array.isArray(o.material) ? mats : mats[0];
      o.castShadow = false;
      o.renderOrder = 5;
    });
    g.obj = obj;
    g.group.add(obj);
    this._fitGhost();
  }

  cancel() {
    if (!this.ghost) return;
    const g = this.ghost;
    this.scene.remove(g.group);
    disposeModel(g.obj, { materials: true });
    g.pad.geometry.dispose();
    g.pad.material.dispose();
    this.ghost = null;
    this.onChange?.();
  }

  rotate() {
    if (!this.ghost || this.ghost.busy) return;
    this.ghost.rot = (this.ghost.rot + QUARTER) % TURN;
    this._fitGhost();
  }

  /** Next colour variant of the build being placed. */
  cycleVariant() {
    const g = this.ghost;
    if (!g || g.busy || g.item.variants < 2) return;
    g.variant = (g.variant + 1) % g.item.variants;
    this._ghostModel();
  }

  _fitGhost() {
    const g = this.ghost;
    const fp = footprintOf(g.obj, g.rot);
    g.fp = fp;
    g.obj.rotation.y = g.rot;
    g.pad.scale.set(fp.w, 1, fp.d);
    g.pad.position.y = 0.04;
    g.why = this._blocker(g.s, g.w, fp.d / 2, fp.w / 2);
    g.ok = !g.why;
    g.avatar = this._avatarIn(g.s, g.w, fp.d / 2, fp.w / 2); // update() refits when this changes
    g.pad.material.color.set(g.ok ? '#5fd16b' : '#e5483b');
    const bad = new THREE.Color('#ff6a5c');
    g.obj.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [o.material].flat()) {
        if (!m.color) continue;
        m.userData.base ??= m.color.clone();
        m.color.copy(m.userData.base);
        if (!g.ok) m.color.lerp(bad, 0.55);
      }
    });
  }

  /** Point this.ray from the camera through the pointer. */
  _aim(e) {
    const r = this.canvas.getBoundingClientRect();
    this._ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this._ndc, this.camera);
  }

  /** Where the pointer meets the valley floor, in (s, w); null off the board. */
  _groundAt(e) {
    this._aim(e);
    return this.ray.ray.intersectPlane(this.plane, this._v) ? toSW(this._v.x, this._v.z) : null;
  }

  pointerMove(e) {
    const g = this.ghost;
    if (!g || g.busy) return;
    const p = this._groundAt(e);
    if (!p) { g.group.visible = false; return; }
    // snap so the footprint's edges sit on the half-tile grid
    const sn = (v, size) => Math.round((v - size / 2) / SNAP) * SNAP + size / 2;
    const fp = footprintOf(g.obj, g.rot);
    const s = sn(p.s, fp.d), w = sn(p.w, fp.w);
    g.group.visible = true;
    if (s === g.s && w === g.w) return;
    g.s = s; g.w = w;
    const { x, z } = fromSW(s, w);
    g.group.position.set(x, 0, z);
    this._fitGhost();
  }

  /** A click on the map (not a drag). Returns true if the village used it. */
  async click(e) {
    const g = this.ghost;
    if (g) {
      this.pointerMove(e);
      if (g.busy) return true;
      this._fitGhost(); // check again now: the avatar may have walked in since the last move
      if (!g.ok) { this._refuse(g.why); return true; }
      const id = `b${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const base = { id, type: g.item.id, s: g.s, w: g.w, rot: g.rot, variant: g.variant, messages: [] };
      if (!g.item.session) {
        // a decoration: put it down and keep placing more of the same
        this._add({ ...base, decor: true, name: g.item.name });
        this._fitGhost(); // the spot is taken now
        return true;
      }
      g.busy = true;
      // the picker shows folders already connected and cannot pick them; the main process
      // checks again when the house is added (one folder, one house)
      const picked = await pickFolder({ title: `Choose a folder for ${g.item.name}` });
      if (this.ghost !== g) return true; // cancelled meanwhile
      g.busy = false;
      if (!picked) return true; // keep placing
      this._fitGhost();
      if (!g.ok) { this._refuse(g.why); return true; }
      this._add({ ...base, cwd: picked.dir, name: picked.name, mode: 'auto', sessionId: null });
      this.pendingOpen = id;
      this.cancel();
      return true;
    }
    const id = this.pick(e);
    if (!id) return false;
    if (this.isHouse(id)) this.onOpen?.(id);
    else this.onDecor?.(id);
    return true;
  }

  /** Put a build down: on the map at once, so the next click already finds the spot taken. */
  _add(data) {
    api.send('build:add', data);
    this._upsert(data); // the main process sends it back as 'build:changed'
    this.onChange?.(data.id);
  }

  _refuse(why) {
    this.toast?.(why === 'avatar' ? 'Your avatar is standing here · step aside and build again' : 'You cannot build here · choose flat, open snow');
  }

  /** The build under the pointer, if any. */
  pick(e) {
    this._aim(e);
    const hit = this.ray.intersectObjects([...this.builds.values()].map((b) => b.obj), true)[0];
    return hit?.object.userData.buildId ?? null;
  }

  /** Screen position (CSS px) of a world point, through the pixel canvas. */
  screenOf(p) {
    const cs = this.canvas.style;
    const left = parseFloat(cs.left) || 0, top = parseFloat(cs.top) || 0;
    const width = parseFloat(cs.width) || innerWidth, height = parseFloat(cs.height) || innerHeight;
    const v = this._v.copy(p).project(this.camera);
    return { x: left + ((v.x + 1) / 2) * width, y: top + ((1 - v.y) / 2) * height };
  }

  // ---------------------------------------------------------------- per frame

  update(dt) {
    // the avatar walks while a build is being placed: keep the ghost's colour true
    const g = this.ghost;
    if (g && !g.busy && g.group.visible && g.fp && this._avatarIn(g.s, g.w, g.fp.d / 2, g.fp.w / 2) !== !!g.avatar) this._fitGhost();

    for (const b of this.builds.values()) {
      if (!b.tag) continue;
      // name tags follow their roofs
      const { x, y } = this.screenOf(b.top);
      const off = x < -80 || x > innerWidth + 80 || y < -40 || y > innerHeight + 80;
      b.tag.style.visibility = off ? 'hidden' : '';
      // a roof near the top edge keeps its whole tag on screen
      if (!off) b.tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(Math.max(y, 36))}px) translate(-50%, -100%)`;

      // while Claude works, the chimney puffs hard and sparks fly from the roof
      if (b.data.working) {
        b.puff -= dt;
        if (b.puff <= 0) {
          b.puff = 0.12;
          const c = b.handle.chimney || b.top;
          this.world.smoke.emit(c.x + rand(-0.1, 0.1), c.y + 0.1, c.z, rand(-0.2, 0.2), rand(0.9, 1.4), rand(-0.2, 0.2), rand(2.5, 4));
          this.world.spray.emit(b.top.x + rand(-0.6, 0.6), b.top.y - 0.2, b.top.z + rand(-0.6, 0.6), rand(-0.6, 0.6), rand(1.5, 2.6), rand(-0.6, 0.6), rand(0.5, 0.9));
        }
      }
    }
  }
}
