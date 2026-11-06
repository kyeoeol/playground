import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { HALF } from './constants.js';
import { makeRng } from './core/builder.js';

export const TIMES = [
  { id: 'morning', label: 'Morning', hour: 7.5, icon: 'sun' },
  { id: 'day', label: 'Midday', hour: 12.5, icon: 'sun' },
  { id: 'sunset', label: 'Sunset', hour: 18.1, icon: 'sunset' },
  { id: 'night', label: 'Night', hour: 23, icon: 'moon' },
];
export const WEATHERS = [
  { id: 'clear', label: 'Clear', cloud: 0, rain: 0, icon: 'clear' },
  { id: 'cloudy', label: 'Cloudy', cloud: 0.75, rain: 0, icon: 'cloud' },
  { id: 'rain', label: 'Drizzle', cloud: 1, rain: 0.55, icon: 'rain' },
  { id: 'storm', label: 'Shower', cloud: 1, rain: 1, icon: 'rain' },
];

// Keyframes over the 24-hour clock. Sun/moon share one directional light, which
// fades to zero at 5.5h and 20.5h when it swaps bodies, so the jump is invisible.
const k = (hour, sun, sunI, sky, gnd, hemiI, top, bot, tint, sat, night) => ({
  hour, sun: new THREE.Color(sun), sunI, sky: new THREE.Color(sky), gnd: new THREE.Color(gnd), hemiI,
  top: new THREE.Color(top), bot: new THREE.Color(bot), tint: new THREE.Color(tint), sat, night,
});
const KEYS = [
  k(0, '#a9c2ff', 1.6, '#86a0cc', '#55647e', 2.3, '#10162a', '#1c2740', '#cdd8f4', 0.9, 1),
  k(4.5, '#a9c2ff', 1.5, '#86a0cc', '#55647e', 2.3, '#141b33', '#27304c', '#cdd8f4', 0.9, 1),
  k(5.5, '#ffb78a', 0, '#7c7fa8', '#3e3a44', 1.0, '#39395c', '#b78b82', '#c9c0d8', 0.9, 0.85),
  k(7, '#ffc48e', 2.9, '#a9b6d4', '#6b6256', 0.72, '#fbeee0', '#f2d8c4', '#fff0dc', 1, 0.15),
  k(9, '#fff0da', 3.7, '#c2d4ea', '#7c7464', 0.7, '#fbfbf7', '#e7e7e2', '#ffffff', 1.06, 0),
  k(13, '#fff8ec', 3.9, '#c7d9ee', '#857d6a', 0.72, '#fdfdfb', '#e2e3e1', '#ffffff', 1.08, 0),
  k(16.5, '#ffe9c8', 3.7, '#c2cde0', '#7f7362', 0.7, '#fbf7ef', '#e6e0d6', '#fff8ec', 1.05, 0),
  k(18.5, '#ffa365', 3.3, '#b5a4b6', '#6e5a4c', 1.0, '#fcdcb8', '#f0b08e', '#ffe8d0', 1.1, 0.2),
  k(19.6, '#ff6f4a', 0.8, '#7f7096', '#463c4c', 0.95, '#6c5a86', '#d68a78', '#d8c0d0', 1.0, 0.75),
  k(20.5, '#a9c2ff', 0, '#7c8fbc', '#525c76', 2.1, '#232a4c', '#44466a', '#cdd2ea', 0.92, 1),
  k(21.5, '#a9c2ff', 1.6, '#86a0cc', '#55647e', 2.3, '#10162a', '#1c2740', '#cdd8f4', 0.9, 1),
  k(24, '#a9c2ff', 1.6, '#86a0cc', '#55647e', 2.3, '#10162a', '#1c2740', '#cdd8f4', 0.9, 1),
];

const smooth = (a, b, dt, rate) => a + (b - a) * (1 - Math.exp(-dt * rate));

export class Sky {
  constructor(scene, post) {
    this.post = post;
    this.hour = TIMES[1].hour;
    this.targetHour = this.hour;
    this.followDay = false;
    this.autoWeather = false;
    this.weather = WEATHERS[0];
    this.cloud = 0;
    this.rain = 0;
    this.weatherTimer = 50;
    this.values = {
      sun: new THREE.Color(), sky: new THREE.Color(), gnd: new THREE.Color(),
      top: new THREE.Color(), bot: new THREE.Color(), tint: new THREE.Color(),
      sunI: 0, hemiI: 0, sat: 1, night: 0,
    };

    this.hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const c = this.sun.shadow.camera;
    const extent = HALF * 1.7;
    c.left = -extent; c.right = extent; c.top = extent; c.bottom = -extent;
    c.near = 10; c.far = 1400;
    this.sun.shadow.bias = -0.0012;
    this.sun.shadow.normalBias = 0.9;
    scene.add(this.sun, this.sun.target);

    this.buildClouds(scene);
    this.buildRain(scene);
  }

  buildClouds(scene) {
    const r = makeRng(31);
    const parts = [];
    const shape = [[0, 0, 0, 22], [24, -4, 4, 16], [-22, -5, -3, 17], [8, 8, -2, 15], [-8, -6, 12, 13]];
    for (const [x, y, z, s] of shape) {
      const g = new THREE.IcosahedronGeometry(s, 1);
      g.scale(1, 0.72, 1);
      g.translate(x, y, z);
      g.computeVertexNormals();
      g.deleteAttribute('uv');
      parts.push(g);
    }
    const geo = mergeGeometries(parts);
    this.cloudMaterial = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    this.clouds = new THREE.InstancedMesh(geo, this.cloudMaterial, 7);
    this.clouds.castShadow = true;
    this.clouds.frustumCulled = false;
    this.cloudData = [];
    for (let i = 0; i < 7; i++) {
      this.cloudData.push({
        // These lanes drift behind the stadium on screen, so they never cover it from the diamond view.
        x: r.range(-HALF * 1.5, HALF * 1.5), z: r.range(-HALF, -80), y: r.range(125, 160),
        scale: r.range(0.6, 0.95), speed: r.range(3, 7), threshold: i / 7,
      });
    }
    scene.add(this.clouds);
    this.dummy = new THREE.Object3D();
  }

  buildRain(scene) {
    const r = makeRng(9);
    this.rainCount = 1100;
    this.rainDrops = [];
    const pos = new Float32Array(this.rainCount * 6);
    for (let i = 0; i < this.rainCount; i++) {
      this.rainDrops.push({ x: r.range(-HALF, HALF), z: r.range(-HALF, HALF), y: r.range(0, 170), v: r.range(150, 210) });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rainLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#d7e6f2', transparent: true, opacity: 0.6, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.rainLines.renderOrder = 5;
    scene.add(this.rainLines);

    const splashGeo = new THREE.BufferGeometry();
    this.splashCount = 260;
    splashGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.splashCount * 3), 3));
    this.splashes = new THREE.Points(splashGeo, new THREE.PointsMaterial({ color: '#e7f1f8', size: 1, sizeAttenuation: false, transparent: true, opacity: 0.75, depthWrite: false }));
    this.splashes.frustumCulled = false;
    this.splashes.visible = false;
    scene.add(this.splashes);
    this.splashRng = makeRng(3);
  }

  timeLabel() {
    const h = ((this.targetHour % 24) + 24) % 24;
    let best = TIMES[0], bestDist = 99;
    for (const t of TIMES) {
      const d = Math.min(Math.abs(t.hour - h), 24 - Math.abs(t.hour - h));
      if (d < bestDist) { best = t; bestDist = d; }
    }
    return best;
  }

  clockText() {
    const h = ((this.hour % 24) + 24) % 24;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  /** Step to the next/previous named time of day, always travelling forward through the clock. */
  stepTime(dir) {
    const current = TIMES.indexOf(this.timeLabel());
    const next = TIMES[(current + dir + TIMES.length) % TIMES.length];
    let base = next.hour;
    if (dir > 0) while (base <= this.targetHour) base += 24;
    else while (base >= this.targetHour) base -= 24;
    this.targetHour = base;
  }

  stepWeather(dir) {
    const i = WEATHERS.indexOf(this.weather);
    this.weather = WEATHERS[(i + dir + WEATHERS.length) % WEATHERS.length];
  }

  sample(hour) {
    const h = ((hour % 24) + 24) % 24;
    let a = KEYS[0], b = KEYS[1];
    for (let i = 0; i < KEYS.length - 1; i++) {
      if (h >= KEYS[i].hour && h <= KEYS[i + 1].hour) { a = KEYS[i]; b = KEYS[i + 1]; break; }
    }
    const t = (h - a.hour) / (b.hour - a.hour || 1);
    const v = this.values;
    for (const key of ['sun', 'sky', 'gnd', 'top', 'bot', 'tint']) v[key].copy(a[key]).lerp(b[key], t);
    v.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
    v.hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);
    v.sat = THREE.MathUtils.lerp(a.sat, b.sat, t);
    v.night = THREE.MathUtils.lerp(a.night, b.night, t);
    return h;
  }

  update(dt) {
    if (this.followDay) {
      // One day lasts 24 minutes, so an in-game hour is one real minute.
      this.targetHour += dt / 60;
      this.hour = smooth(this.hour, this.targetHour, dt, 4);
    } else {
      this.hour = smooth(this.hour, this.targetHour, dt, 2.2);
    }
    if (this.autoWeather) {
      this.weatherTimer -= dt;
      if (this.weatherTimer <= 0) {
        this.weatherTimer = 45 + Math.random() * 60;
        this.weather = WEATHERS[Math.floor(Math.random() * WEATHERS.length)];
      }
    }
    this.cloud = smooth(this.cloud, this.weather.cloud, dt, 0.9);
    this.rain = smooth(this.rain, this.weather.rain, dt, 1.2);

    const h = this.sample(this.hour);
    const v = this.values;
    const grey = new THREE.Color('#a7adb4');

    // Light
    const dimSun = 1 - 0.62 * this.cloud - 0.2 * this.rain;
    this.sun.color.copy(v.sun);
    this.sun.intensity = v.sunI * Math.max(0.05, dimSun);
    this.hemi.color.copy(v.sky).lerp(grey, this.cloud * 0.45);
    this.hemi.groundColor.copy(v.gnd);
    this.hemi.intensity = v.hemiI * (1 - this.rain * 0.14);

    let dir;
    if (h >= 5.5 && h <= 20.5) {
      const a = ((h - 5.5) / 15) * Math.PI;
      // Stays on the camera's left, so the two visible faces of every building differ in tone.
      dir = new THREE.Vector3(Math.cos(a) * 0.6 - 0.15, 0.25 + Math.sin(a) * 0.62, 0.95);
    } else {
      const moon = (h < 5.5 ? h + 24 : h) - 20.5;
      dir = new THREE.Vector3(0.8 - (moon / 9) * 1.3, 0.95, 0.55);
    }
    dir.normalize();
    this.sun.position.copy(dir).multiplyScalar(620);

    // Post
    const u = this.post.uniforms;
    const overcast = this.cloud * (1 - v.night * 0.8);
    u.bgTop.value.copy(v.top).lerp(grey, overcast * 0.45);
    u.bgBottom.value.copy(v.bot).lerp(grey, overcast * 0.6);
    u.tint.value.copy(v.tint);
    u.saturation.value = v.sat * (1 - 0.18 * this.cloud);
    u.stars.value = Math.max(0, v.night - 0.4) * (1 - this.cloud) * 1.6;

    this.updateClouds(dt);
    this.updateRain(dt);
  }

  updateClouds(dt) {
    const d = this.dummy;
    const v = this.values;
    // Clouds lit from the side read better than ones that pick up the full sun.
    this.cloudMaterial.color.setRGB(1, 1, 1).lerp(new THREE.Color('#7f8996'), this.rain * 0.8);
    this.clouds.visible = this.cloud > 0.02;
    if (!this.clouds.visible) return;
    this.cloudData.forEach((c, i) => {
      c.x += c.speed * dt * (1 + this.rain);
      if (c.x > HALF * 1.6) c.x = -HALF * 1.6;
      const show = THREE.MathUtils.clamp((this.cloud - c.threshold * 0.8) * 4, 0, 1);
      d.position.set(c.x, c.y, c.z);
      d.scale.setScalar(Math.max(0.0001, c.scale * show));
      d.updateMatrix();
      this.clouds.setMatrixAt(i, d.matrix);
    });
    this.clouds.instanceMatrix.needsUpdate = true;
    this.cloudMaterial.emissive.copy(v.sky).multiplyScalar(0.12);
  }

  updateRain(dt) {
    const active = this.rain > 0.03;
    this.rainLines.visible = this.splashes.visible = active;
    if (!active) return;
    const count = Math.floor(this.rainCount * this.rain);
    const attr = this.rainLines.geometry.attributes.position;
    for (let i = 0; i < count; i++) {
      const drop = this.rainDrops[i];
      drop.y -= drop.v * dt;
      if (drop.y < 0) drop.y += 170;
      attr.setXYZ(i * 2, drop.x, drop.y, drop.z);
      attr.setXYZ(i * 2 + 1, drop.x + 0.7, drop.y + 5, drop.z + 0.3);
    }
    attr.needsUpdate = true;
    this.rainLines.geometry.setDrawRange(0, count * 2);
    const splash = this.splashes.geometry.attributes.position;
    const r = this.splashRng;
    const splashCount = Math.floor(this.splashCount * this.rain);
    for (let i = 0; i < splashCount; i++) splash.setXYZ(i, r.range(-HALF, HALF), 0.4, r.range(-HALF, HALF));
    splash.needsUpdate = true;
    this.splashes.geometry.setDrawRange(0, splashCount);
  }
}
