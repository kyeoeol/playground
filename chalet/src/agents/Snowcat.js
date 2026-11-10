import * as THREE from 'three';
import { box, glowMat } from '../world/props.js';
import { Kit } from '../world/meshKit.js';
import { turn } from '../core/rand.js';
import { toSW } from '../world/coords.js';
import { SLOPE_END } from '../world/Terrain.js';
import { LIFT_HOURS } from '../world/Lift.js';

/**
 * Piste groomer. Works at night: drives up and down every piste, and the
 * tiller behind it lays fresh corduroy, wiping out the day's tracks.
 * It stays on the slope: it parks there and never drives past the slope's foot.
 */
export class Snowcat {
  constructor(world, garage) {
    this.world = world;
    this.garage = garage; // { x, z, yaw }
    this.model = this._build();
    this.pos = this.model.position;
    this.pos.set(garage.x, world.terrain.heightAt(garage.x, garage.z), garage.z);
    this.yaw = garage.yaw;
    this.route = [];
    this.working = false;
    this.lightsOn = 0;
    this.groomT = 0;
  }

  _build() {
    const g = new THREE.Group();
    const k = new Kit();
    const RED = '#d63a2a', RED_LO = '#9c2420', WHITE = '#f4f7fc';
    const TRACK = '#24272d', CLEAT = '#4a4f58', WHEEL = '#8d939c', HUB = '#2e3138';
    const STEEL = '#c9ced6', STEEL_LO = '#8d939c', DARK = '#1b1d22';

    // ---- tracks: belt with round ends, cleats on top, road wheels on the outer side
    for (const sx of [-1, 1]) {
      const x = sx * 0.95;
      k.box(TRACK, 0.5, 0.5, 2.5, x, 0.3, 0);
      for (const z of [-1.25, 1.25]) k.cyl(TRACK, 0.25, 0.5, 'x', x, 0.3, z, 10);
      for (let z = -1.3; z <= 1.31; z += 0.2) k.box(CLEAT, 0.52, 0.05, 0.08, x, 0.57, z);
      for (const z of [-0.9, -0.3, 0.3, 0.9]) {
        k.cyl(WHEEL, 0.17, 0.06, 'x', x + sx * 0.26, 0.28, z, 10);
        k.cyl(HUB, 0.07, 0.08, 'x', x + sx * 0.28, 0.28, z, 6);
      }
      for (const z of [-1.25, 1.25]) k.cyl(WHEEL, 0.19, 0.06, 'x', x + sx * 0.26, 0.3, z, 10); // sprocket / idler
    }

    // ---- hull with a white stripe, rear deck
    k.box(RED, 1.5, 0.6, 2.5, 0, 0.82, 0);
    k.box(WHITE, 1.52, 0.1, 2.52, 0, 0.92, 0);
    k.box(RED_LO, 1.52, 0.06, 2.52, 0, 0.55, 0);
    k.box(STEEL_LO, 1.3, 0.1, 0.95, 0, 1.17, -0.75); // rear deck
    for (const x of [-0.6, 0.6]) k.box(DARK, 0.06, 0.25, 0.9, x, 1.32, -0.75); // deck rails

    // ---- cab: red frame, glass panes with pillars, dark roof, light bar, beacon
    k.box(RED, 1.3, 0.3, 1.25, 0, 1.27, 0.45); // cab base
    k.box(RED, 1.3, 0.1, 1.25, 0, 1.92, 0.45); // cab top rail
    for (const x of [-0.62, 0, 0.62]) k.box(RED, 0.08, 0.55, 0.08, x, 1.65, 1.04); // front pillars
    for (const x of [-0.62, 0.62]) for (const z of [-0.14, 0.45]) k.box(RED, 0.08, 0.55, 0.08, x, 1.65, z); // side pillars
    k.box(RED, 1.3, 0.55, 0.08, 0, 1.65, -0.14); // back wall
    k.box(DARK, 1.38, 0.08, 1.33, 0, 2.0, 0.45); // roof
    k.box(DARK, 1.2, 0.08, 0.14, 0, 2.08, 0.95); // light bar
    for (const x of [-0.5, 0.5]) k.box(DARK, 0.1, 0.1, 0.1, x, 2.05, 1.05); // mirror stubs

    // ---- blade: two tilted plates (reads curved), a dark top edge, hydraulic arms
    k.box(STEEL, 3.0, 0.36, 0.14, 0, 0.58, 1.78, -0.25, 0, 0);
    k.box(STEEL, 3.0, 0.3, 0.14, 0, 0.27, 1.84, 0.2, 0, 0);
    k.box(DARK, 3.02, 0.06, 0.16, 0, 0.77, 1.73);
    for (const sx of [-1, 1]) k.box(RED_LO, 0.08, 0.36, 0.14, sx * 1.5, 0.45, 1.8); // end plates
    for (const x of [-0.5, 0.5]) k.bar(STEEL_LO, 0.1, new THREE.Vector3(x, 0.75, 1.2), new THREE.Vector3(x, 0.55, 1.72));

    // ---- tiller: arm, housing with ribs, rubber finisher flap
    k.box(STEEL_LO, 0.3, 0.15, 0.55, 0, 0.6, -1.45);
    k.box(STEEL_LO, 2.6, 0.38, 0.6, 0, 0.38, -1.8);
    k.box(DARK, 2.62, 0.06, 0.62, 0, 0.58, -1.8);
    for (let x = -1.1; x <= 1.11; x += 0.44) k.box(STEEL, 0.06, 0.04, 0.6, x, 0.62, -1.8);
    k.box(DARK, 2.6, 0.06, 0.42, 0, 0.18, -2.22, 0.5, 0, 0); // finisher
    k.build(g);

    const glass = glowMat('#ffe7b0', 1.2, { glass: true });
    g.add(box(1.16, 0.5, 0.04, glass, 0, 1.65, 1.05));
    for (const x of [-0.63, 0.63]) g.add(box(0.04, 0.5, 1.12, glass, x, 1.65, 0.45));
    this.beaconMat = new THREE.MeshStandardMaterial({ color: '#552200', emissive: '#ff8a1a', emissiveIntensity: 0, flatShading: true });
    g.add(box(0.2, 0.18, 0.2, this.beaconMat, 0, 2.13, 0.1));
    this.headMat = new THREE.MeshStandardMaterial({ color: '#c9ced6', emissive: '#fff4d6', emissiveIntensity: 0, flatShading: true });
    for (const x of [-0.42, -0.14, 0.14, 0.42]) g.add(box(0.16, 0.1, 0.05, this.headMat, x, 2.08, 1.04)); // roof lights
    for (const x of [-0.55, 0.55]) g.add(box(0.2, 0.12, 0.05, this.headMat, x, 1.0, 1.26)); // hull lights

    this.spot = new THREE.SpotLight('#fff1d0', 0, 22, 0.6, 0.55, 1.2);
    this.spot.position.set(0, 2.0, 1.0);
    this.spot.target.position.set(0, -1.5, 9);
    g.add(this.spot, this.spot.target);
    g.scale.setScalar(1.1);
    return g;
  }

  /** One shift: every piste uphill then downhill, then back to the garage. */
  planShift() {
    const r = [];
    const o = {};
    const add = (p) => { if (toSW(o.x, o.z).s <= SLOPE_END - 0.5) r.push({ x: o.x, z: o.z, groom: p.half * 0.9 }); };
    for (const p of this.world.pistes.list) {
      for (let s = p.length - 0.5; s > 0.5; s -= 1.5) { p.sample(s, o); add(p); }
      for (let s = 0.5; s < p.length - 0.5; s += 1.5) { p.sample(s, o); add(p); }
    }
    r.push({ x: this.garage.x, z: this.garage.z, groom: 0 });
    this.route = r;
  }

  update(dt, time) {
    const w = this.world;
    const night = w.clock.between(LIFT_HOURS.close, 7.0);
    // between routes: work through the night, park by day (planShift ends at the garage)
    if (!this.route.length) {
      this.working = night;
      if (night) this.planShift();
    }

    // lights
    const want = this.working ? 1 : 0;
    this.lightsOn += (want - this.lightsOn) * Math.min(1, dt * 2);
    this.spot.intensity = 60 * this.lightsOn * (0.4 + w.env.night * 0.6);
    this.headMat.emissiveIntensity = 3 * this.lightsOn;
    this.beaconMat.emissiveIntensity = this.lightsOn * (Math.sin(time * 9) > 0 ? 4 : 0.2);

    if (!this.route.length) return;
    const speed = 4.2;
    let dist = speed * dt;
    while (dist > 0 && this.route.length) {
      const t = this.route[0];
      const dx = t.x - this.pos.x, dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-3) this.yaw = turn(this.yaw, Math.atan2(dx, dz), dt * 3);
      if (d <= dist) {
        this.pos.x = t.x; this.pos.z = t.z;
        this.route.shift();
        dist -= d;
      } else {
        this.pos.x += (dx / d) * dist;
        this.pos.z += (dz / d) * dist;
        dist = 0;
      }
      if (t.groom) {
        this.groomT -= dt;
        if (this.groomT <= 0) {
          this.groomT = 0.05;
          // tiller sits behind the machine
          const bx = this.pos.x - Math.sin(this.yaw) * 2, bz = this.pos.z - Math.cos(this.yaw) * 2;
          w.terrain.groomAt(bx, bz, t.groom);
        }
      }
    }
    const { terrain } = w;
    this.pos.y = terrain.heightAt(this.pos.x, this.pos.z);
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const ahead = terrain.heightAt(this.pos.x + fx * 1.4, this.pos.z + fz * 1.4);
    const behind = terrain.heightAt(this.pos.x - fx * 1.4, this.pos.z - fz * 1.4);
    this.model.rotation.set(0, 0, 0);
    this.model.rotation.order = 'YXZ';
    this.model.rotation.y = this.yaw;
    this.model.rotation.x = -Math.atan2(ahead - behind, 2.8);
  }
}
