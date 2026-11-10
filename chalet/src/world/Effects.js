import * as THREE from 'three';

/** A small CPU particle pool rendered as pixel-sized points. */
export class ParticlePool {
  constructor(max, { color = '#ffffff', size = 2, opacity = 0.95, gravity = -9, drag = 1.6 } = {}) {
    this.max = max;
    this.count = 0;
    this.gravity = gravity;
    this.drag = drag;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.pos, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.attr);
    this.geo.setDrawRange(0, 0);
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({
      color, size, sizeAttenuation: false, transparent: true, opacity, depthWrite: false,
    }));
    this.points.frustumCulled = false;
  }

  emit(x, y, z, vx, vy, vz, life) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.life[i] = life;
  }

  update(dt) {
    const { pos, vel, life } = this;
    const damp = Math.exp(-this.drag * dt);
    let i = 0;
    while (i < this.count) {
      life[i] -= dt;
      if (life[i] <= 0) {
        const last = --this.count;
        if (i !== last) {
          pos.copyWithin(i * 3, last * 3, last * 3 + 3);
          vel.copyWithin(i * 3, last * 3, last * 3 + 3);
          life[i] = life[last];
        }
        continue;
      }
      const k = i * 3;
      vel[k] *= damp;
      vel[k + 2] *= damp;
      vel[k + 1] = vel[k + 1] * damp + this.gravity * dt;
      pos[k] += vel[k] * dt;
      pos[k + 1] += vel[k + 1] * dt;
      pos[k + 2] += vel[k + 2] * dt;
      i++;
    }
    this.geo.setDrawRange(0, this.count);
    if (this.count) this.attr.needsUpdate = true; // nothing alive: nothing drawn, nothing to upload
  }
}
