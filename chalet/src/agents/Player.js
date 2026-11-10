import { PlayerModel } from './PlayerModel.js';
import { clamp, lerp, smoothstep, rand, angleDiff, turn } from '../core/rand.js';
import { toSW, UPHILL } from '../world/coords.js';
import { W, D, SLOPE_END } from '../world/Terrain.js';
import { LIFT_HOURS } from '../world/Lift.js';

const G = 15; // gravity used for the board physics (arcade-tuned)
export const KMH = 5.8; // world units/s → km/h
const WALK = 5.6; // walking pace (the old Shift run; there is no run key now)
const QUEUE_STEP = 3.4; // shuffling up in the lift queue
/** Yaw toward the camera (it looks from +x, +z, see VIEW_DIR in main.js). */
const FACE_CAMERA = Math.PI / 4;
const DISMOUNT = 0.6; // min s to step off a chair onto the exit ramp
// Hit blink, like a platformer's damage flash: after a hit on the board the avatar
// blinks on and off for BLINK seconds (after getting up, if the hit knocked you down),
// and cannot crash again in that time.
const BLINK = 2;
const BLINK_RATE = 0.07; // s on, s off
const HIT_SPEED = 4; // a bump below this speed is not a hit
// On foot you cannot climb the slope: above this line (s < WALL) walking never goes uphill.
// Take the lift up; on the slope you can only walk across or down.
const WALL = SLOPE_END - 1;
// The soft run-out snow at the foot of the slope starts here (s); it brakes even a fast rider
// to a stop within a few tiles, so the run ends (and the bindings come off) from this line on.
const RUNOUT = SLOPE_END - 2;

/**
 * The one avatar the user controls.
 * walk ⇄ (E at the lift) queue → lift → strap → ride ⇄ air / fallen → (stop at the bottom) walk
 */
export class Player {
  constructor(world) {
    this.world = world;
    this.model = new PlayerModel();
    this.pos = this.model.root.position;
    const start = world.spawn;
    this.pos.set(start.x, world.ground(start.x, start.z), start.z);
    this.heading = start.yaw; // where the body/board points
    this.travel = start.yaw; // direction of motion while riding
    this.speed = 0;
    this.vy = 0;
    this.state = 'walk';
    this.pose = { pose: 'stand', lean: 0, pitch: 0, edge: 0, tuck: false };
    this.timer = 0;
    this.stillT = 0;
    this.spin = 0;
    this.airTime = 0;
    this.stats = { runs: 0, top: 0, runStart: null, runTop: 0 };
    this.events = []; // toasts for the UI
    this.stampT = 0;
    this.lastStamp = null;
    this.sprayAcc = 0;
    this.hint = '';
    this.actions = []; // [{ key: 'E' | 'Space', label }] for the prompt
    this.blinkT = 0; // hit blink time left, s
    this.uphillT = 0; // > 0: just tried to walk up the slope (shows a hint)
  }

  get sw() { return toSW(this.pos.x, this.pos.z); }
  get onSlope() { return this.sw.s < SLOPE_END + 2; }
  /** Up on the slope proper (not the flat run-out at the lift base or the village): you can strap in here. */
  get canStrap() { return this.sw.s < SLOPE_END - 4; }
  /** Down in the run-out at the foot of the slope (where its braking snow starts) or past it: the run is over. */
  get atBase() { return this.sw.s > RUNOUT; }

  toast(text) { this.events.push(text); }

  // ------------------------------------------------------------ lift hooks

  onBoard() {
    this.state = 'lift';
    this.liftT = 0; // time on the chair: the ride's two notes take turns (_updatePrompt)
    this.lastStamp = null;
  }

  /** roll: the chair's sideways swing, so the avatar swings with the seat */
  seat(x, y, z, yaw, roll = 0) {
    this.pos.set(x, y, z);
    this.heading = yaw;
    this.roll = roll;
  }

  /** Off the chair: step down onto the exit ramp at p (the 'dismount' state), not a jump there. */
  onUnload(p, where = 'top') {
    this.speed = 0;
    this.state = 'dismount'; // then walk (on the slope it straps in by itself, see update)
    this.from = { x: this.pos.x, y: this.pos.y, z: this.pos.z, heading: this.heading };
    // face the camera once strapped in: the ride pose turns the body a quarter turn off the
    // board and the torso back 0.5, so the board ends up across the slope, a little uphill
    // (it stays put until a key is pressed)
    const goofy = this.model.goofy;
    this.to = { x: p.x, z: p.z, heading: FACE_CAMERA + (Math.PI / 2 - 0.5) * goofy };
    // a longer way off the chair takes longer, so it reads as a glide and not a jump
    this.dismountT = this.timer = clamp(Math.hypot(p.x - this.pos.x, p.z - this.pos.z) / 4.5, DISMOUNT, 1.4);
    if (where === 'top') {
      this.stats.runStart = this.world.time;
      this.stats.runTop = 0;
      this.toast('Reached the top!');
    } else {
      this.toast('Off the lift');
    }
  }

  // ------------------------------------------------------------ actions

  get nearGate() {
    const gate = this.world.lift.queueSlot(0);
    return Math.hypot(gate.x - this.pos.x, gate.z - this.pos.z) < 3.2;
  }

  /** Lift key (E): join the queue. Walking off leaves it; getting off at the top is automatic. */
  action() {
    const w = this.world;
    if (this.state === 'lift') { this.toast('You get off automatically at the top'); return; }
    if ((this.state === 'walk' || (this.state === 'ride' && this.speed < 3)) && this.nearGate) {
      if (!w.liftOpen) { this.toast('The lift is closed now'); return; }
      this.state = 'queue';
      this.speed = 0;
      w.lift.join(this);
    }
  }

  jump() {
    if (this.state !== 'ride') return;
    this.state = 'air';
    this.vy = 4.6 + this.speed * 0.12;
    this.spin = 0;
    this.airTime = 0;
  }

  /** Back to the start. Not from a chair on the way up: the ride ends at the top. Returns whether it went. */
  respawn() {
    const w = this.world;
    if (this.state === 'lift') { this.toast('You get off automatically at the top'); return false; }
    w.lift.remove(this); // also off a chair, or the chair pulls the avatar back up
    const s = w.spawn;
    // the spawn point may be built over or walled in: the nearest free spot you can walk out from
    const p = w.freeSpot(s.x, s.z) || s;
    this.pos.set(p.x, w.ground(p.x, p.z), p.z);
    this.heading = this.travel = s.yaw;
    this.state = 'walk';
    this.speed = 0;
    this.blinkT = 0;
  }

  /** If a build stands where the avatar is (a saved town loaded over it), step out of it. */
  unstick() {
    if (this.state === 'lift' || this.state === 'queue') return;
    const w = this.world, { x, z } = this.pos;
    if (!w.boxes.some((b) => { const p = toSW(x, z); return Math.abs(p.s - b.s) < b.hs && Math.abs(p.w - b.w) < b.hw; })) return;
    const p = w.freeSpot(x, z);
    if (p) this.pos.set(p.x, w.ground(p.x, p.z), p.z);
  }

  /** A hit on the board: start the blink (not again while it runs). extra: s added on top. */
  hurt(extra = 0) {
    if (this.blinkT <= 0) this.blinkT = BLINK + extra;
  }

  // ------------------------------------------------------------ update

  /**
   * input: { mx, mz } camera-relative move vector (walking),
   *        steer (-1..1), push (W), brake (S), run (Shift: tuck on the board)
   */
  update(dt, input) {
    const w = this.world;
    switch (this.state) {
      case 'walk':
        // the binding is automatic: up on the slope (off the lift at the top) the board goes on;
        // it comes off again when the ride comes to rest at the bottom (end of _ride)
        if (this.canStrap) { this.state = 'strap'; this.timer = 0.9; this.travel = this.heading; break; }
        this._walk(dt, input);
        break;
      case 'queue': {
        // a move key steps out of the line (and walks on from there)
        if (Math.hypot(input.mx, input.mz) > 0.01) { w.lift.leave(this); this.state = 'walk'; this._walk(dt, input); break; }
        const slot = w.lift.standingSpot(this, QUEUE_STEP);
        if (!slot) { this.state = 'walk'; break; }
        const dx = slot.x - this.pos.x, dz = slot.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.05) {
          const step = Math.min(d, QUEUE_STEP * dt);
          this.pos.x += (dx / d) * step;
          this.pos.z += (dz / d) * step;
          this.heading = turn(this.heading, Math.atan2(dx, dz), dt * 10);
          this.pose.pose = 'walk';
        } else {
          this.heading = turn(this.heading, UPHILL, dt * 6);
          this.pose.pose = 'stand';
        }
        this.pos.y = w.ground(this.pos.x, this.pos.z);
        if (!w.liftOpen) { w.lift.leave(this); this.state = 'walk'; }
        break;
      }
      case 'lift': this.pose.pose = 'lift'; this.liftT += dt; break;
      case 'dismount': {
        // from the seat to the ramp in a smooth hop, turning to the stance it stops in
        this.timer -= dt;
        const k = clamp(1 - this.timer / this.dismountT, 0, 1), e = smoothstep(0, 1, k);
        const f = this.from;
        this.pos.x = lerp(f.x, this.to.x, e);
        this.pos.z = lerp(f.z, this.to.z, e);
        this.pos.y = f.y + (w.ground(this.pos.x, this.pos.z) - f.y) * e + Math.sin(Math.PI * k) * 0.25;
        this.heading = this.travel = f.heading + angleDiff(f.heading, this.to.heading) * e;
        this.pose.pose = k < 1 ? 'walk' : 'stand';
        if (k >= 1) { this.state = 'walk'; this.pos.y = w.ground(this.pos.x, this.pos.z); }
        break;
      }
      case 'strap':
        this.pose.pose = 'strap';
        this.pos.y = w.ground(this.pos.x, this.pos.z);
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'ride'; this.speed = 0; this.travel = this.heading; }
        break;
      case 'ride': this._ride(dt, input); break;
      case 'air': this._air(dt, input); break;
      case 'fallen':
        this.pose.pose = 'fallen';
        this.timer -= dt;
        if (this.timer <= 0) { this.state = 'ride'; this.speed = 0; this.lastStamp = null; }
        break;
    }

    this.blinkT = Math.max(0, this.blinkT - dt);
    this.uphillT = Math.max(0, this.uphillT - dt);
    this.model.root.visible = this.blinkT <= 0 || Math.floor(this.blinkT / BLINK_RATE) % 2 === 0;
    this.model.root.rotation.y = this.heading;
    this.model.root.rotation.z = this.state === 'lift' ? this.roll ?? 0 : 0;
    this.model.update(dt, this.pose);
    this._updatePrompt();
  }

  _walk(dt, input) {
    const w = this.world;
    const len = Math.hypot(input.mx, input.mz);
    if (len > 0.01) {
      const dirX = input.mx / len, dirZ = input.mz / len;
      let speed = WALK;
      const g = w.terrain.gradient(this.pos.x, this.pos.z);
      const uphill = g.x * dirX + g.z * dirZ;
      speed *= clamp(1 - uphill * 0.6, 0.35, 1.2);
      this._move(dirX * speed * dt, dirZ * speed * dt, false);
      this.heading = turn(this.heading, Math.atan2(dirX, dirZ), dt * 12);
      this.pose.pose = 'walk';
    } else this.pose.pose = 'stand';
    const prevY = this.pos.y;
    this.pos.y = w.ground(this.pos.x, this.pos.z);
    this.pose.pitch = clamp((prevY - this.pos.y) * 4, -0.3, 0.3);
  }

  _ride(dt, input) {
    const w = this.world;
    const t = w.terrain;
    // steering is screen-relative: point the keys where you want to carve
    let steer = 0;
    const want = Math.hypot(input.mx, input.mz) > 0.01;
    if (want) {
      const diff = angleDiff(this.heading, Math.atan2(input.mx, input.mz));
      const rate = 1.8 + Math.min(this.speed, 10) * 0.13;
      this.heading += clamp(diff, -rate * dt, rate * dt);
      steer = clamp(diff / 0.6, -1, 1); // > 0: turning left
    }
    this.travel = this.heading;

    const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
    const g = t.gradient(this.pos.x, this.pos.z);
    const downhill = -(g.x * fx + g.z * fz);
    this.speed += G * downhill * 0.62 * dt;
    // snow friction + air drag; tucking reduces drag, braking skids
    const tuck = input.run && this.speed > 3;
    const drag = tuck ? 0.0018 : 0.0045;
    this.speed -= (0.35 + drag * this.speed * this.speed) * dt;
    this.speed -= Math.abs(steer) * 0.8 * dt; // carving scrubs a little speed
    // soft run-out snow below the slope: even a 100 km/h finish stops within ~10 tiles,
    // before the first buildings of the village
    const runout = this.pos.z - RUNOUT;
    if (runout > 0) this.speed -= (2.2 + this.speed * 1.4) * Math.min(1, runout / 2) * dt;
    if (want && this.speed < 2.2) this.speed += 2.6 * dt; // skate a little on the flats
    this.speed = Math.max(0, this.speed);

    this._move(fx * this.speed * dt, fz * this.speed * dt, true);
    if (this.state !== 'ride') return;
    const prevY = this.pos.y;
    this.pos.y = w.ground(this.pos.x, this.pos.z);

    // pose
    const moved = this.speed * dt;
    this.pose.pose = 'ride';
    this.pose.tuck = tuck;
    this.pose.pitch = moved > 1e-3 ? clamp(Math.atan2(prevY - this.pos.y, moved) * 0.85, -0.3, 0.8) : this.pose.pitch;
    const targetLean = -steer * clamp(this.speed / 9, 0.15, 0.75);
    this.pose.lean += (targetLean - this.pose.lean) * Math.min(1, dt * 8);
    this.pose.edge = Math.sign(this.pose.lean) * this.model.goofy;

    const kmh = this.speed * KMH;
    this.stats.top = Math.max(this.stats.top, kmh);
    this.stats.runTop = Math.max(this.stats.runTop, kmh);

    // spray on hard carves and when braking
    const carve = Math.abs(steer) * this.speed;
    if (carve > 4 && this.speed > 1.5) {
      this.sprayAcc += dt * carve * 3;
      const side = -Math.sign(steer || 1);
      while (this.sprayAcc > 1) {
        this.sprayAcc -= 1;
        w.spray.emit(this.pos.x, this.pos.y + 0.1, this.pos.z,
          fz * side * rand(1, 3) + rand(-0.4, 0.4), rand(1.2, 3), -fx * side * rand(1, 3) + rand(-0.4, 0.4), rand(0.3, 0.6));
      }
    }
    this._stamp(dt, 0.28);

    // finishing a run: down in the run-out from the top
    if (this.atBase && this.stats.runStart != null) {
      const secs = this.world.time - this.stats.runStart;
      this.stats.runs++;
      this.toast(`Run ${this.stats.runs} done · ${fmtTime(secs)} · top ${Math.round(this.stats.runTop)}km/h`);
      this.stats.runStart = null;
    }
    // come to rest at the bottom (run-out or village) → step off the board
    if (this.atBase && this.speed < 0.2) {
      this.stillT += dt;
      if (this.stillT > 0.8) { this.state = 'walk'; this.stillT = 0; }
    } else this.stillT = 0;
  }

  _air(dt, input) {
    const w = this.world;
    this.airTime += dt;
    // spin with the steering keys
    const spinRate = 7;
    const d = -input.steer * spinRate * dt;
    this.heading += d;
    this.spin += d;
    this._move(Math.sin(this.travel) * this.speed * dt, Math.cos(this.travel) * this.speed * dt, true);
    this.vy -= G * 1.15 * dt;
    this.pos.y += this.vy * dt;
    this.pose.pose = 'air';
    this.pose.lean = clamp(-input.steer * 0.4, -0.4, 0.4);
    const ground = w.ground(this.pos.x, this.pos.z);
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      // the board is symmetric: landing forwards or switch both work
      let off = Math.abs(angleDiff(this.travel, this.heading)) % Math.PI;
      off = Math.min(off, Math.PI - off);
      const turns = Math.round(Math.abs(this.spin) / Math.PI) * 180;
      if (off < 0.65) {
        this.heading = this.travel;
        this.state = 'ride';
        const air = this.airTime;
        if (turns >= 180) this.toast(`${turns}°! · ${air.toFixed(1)}s air`);
        else if (air > 0.9) this.toast(`Big air · ${air.toFixed(1)}s`);
      } else {
        this.fall();
      }
      for (let i = 0; i < 10; i++) w.spray.emit(this.pos.x, this.pos.y + 0.1, this.pos.z, rand(-1.5, 1.5), rand(1, 2.5), rand(-1.5, 1.5), rand(0.3, 0.6));
    }
  }

  fall(hit = false) {
    this.state = 'fallen';
    this.timer = 1.8;
    if (hit) this.hurt(this.timer); // keep blinking after you get up
    this.speed = 0;
    this.toast('Wipeout!');
    const w = this.world;
    for (let i = 0; i < 28; i++) w.spray.emit(this.pos.x, this.pos.y + 0.2, this.pos.z, rand(-2.5, 2.5), rand(1.5, 4), rand(-2.5, 2.5), rand(0.4, 0.9));
  }

  /** Move with collisions against obstacles and the diorama edge. */
  _move(dx, dz, riding) {
    const w = this.world;
    let nx = clamp(this.pos.x + dx, 0.5, W - 0.5);
    let nz = clamp(this.pos.z + dz, 0.5, D - 0.5);
    if ((nx !== this.pos.x + dx || nz !== this.pos.z + dz) && riding) { // the diorama edge
      if (this.speed > HIT_SPEED) this.hurt();
      this.speed *= 0.3;
    }
    const hit = w.collide(nx, nz, 0.4);
    if (hit) {
      // a big obstacle at speed knocks you down, unless you are still blinking from a hit
      if (riding && hit.big && this.speed > 6 && this.state === 'ride' && this.blinkT <= 0) {
        this.fall(true);
        return;
      }
      nx = hit.x;
      nz = hit.z;
      if (riding) {
        if (this.speed > HIT_SPEED) this.hurt();
        this.speed *= 0.5;
      }
    }
    // water: only the bridges cross it. Slide along the bank if one axis is free.
    if (w.inWater(nx, nz, 0.3)) {
      if (!w.inWater(nx, this.pos.z, 0.3)) nz = this.pos.z;
      else if (!w.inWater(this.pos.x, nz, 0.3)) nx = this.pos.x;
      else { nx = this.pos.x; nz = this.pos.z; }
      if (riding) this.speed *= 0.3;
    }
    // on foot: no walking up the slope (uphill is −z)
    if (!riding) {
      const minZ = Math.min(this.pos.z, WALL);
      if (nz < minZ) { nz = minZ; this.uphillT = 1.2; }
    }
    this.pos.x = nx;
    this.pos.z = nz;
  }

  _stamp(dt, width) {
    this.stampT -= dt;
    if (this.stampT > 0) return;
    this.stampT = 0.05;
    const { x, z } = this.pos;
    if (this.lastStamp && this.onSlope) this.world.terrain.stamp(this.lastStamp[0], this.lastStamp[1], x, z, width);
    this.lastStamp = [x, z];
  }

  _updatePrompt() {
    const w = this.world;
    const nearGate = this.nearGate;
    // e: what the E (lift) key does now. '' shows the key alone beside the hint; undefined hides it
    let hint = '', e;
    switch (this.state) {
      case 'walk':
        if (nearGate) { hint = w.liftOpen ? 'Lift boarding' : `Lift closed (${LIFT_HOURS.label})`; if (w.liftOpen) e = ''; }
        if (this.uphillT > 0) hint = 'You cannot walk up the slope';
        break;
      case 'queue': hint = 'Waiting for the lift'; break; // with a spinner (UI)
      case 'lift': // the climb itself shows as a spinner (UI); the two notes take turns, 3 s each
        hint = Math.floor(this.liftT / 3) % 2 ? 'Your bindings strap in automatically at the top' : 'You get off automatically at the top';
        break;
      case 'strap': hint = 'Strapping in'; break;
      case 'ride':
        if (this.speed < 3 && nearGate) { hint = 'Lift boarding'; e = ''; }
        else if (this.speed < 0.3 && this.onSlope) hint = 'Press a downhill direction to go';
        else hint = 'Steer with the arrow keys';
        break;
      case 'air': hint = 'Spin with ← → in the air'; break;
      case 'fallen': hint = 'You fell'; break;
    }
    this.hint = hint;
    this.actions = [];
    if (e !== undefined) this.actions.push({ key: 'E', label: e });
  }

}

function fmtTime(sec) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
