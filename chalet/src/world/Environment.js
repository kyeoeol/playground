import * as THREE from 'three';
import { clamp, lerp, seeded, rand } from '../core/rand.js';
import { nightGlow } from './props.js';
import { W, D, BOTTOM } from './Terrain.js';

export const WEATHERS = [
  { id: 'clear', label: 'Clear skies', snow: 0, clouds: 0, sun: 1, fog: 0, wind: 0.12 },
  { id: 'snow', label: 'Light snow', snow: 0.3, clouds: 0.65, sun: 0.62, fog: 0.2, wind: 0.3 },
  { id: 'storm', label: 'Snowstorm', snow: 1, clouds: 1, sun: 0.32, fog: 0.55, wind: 1 },
  { id: 'fog', label: 'Valley fog', snow: 0, clouds: 0.25, sun: 0.75, fog: 1, wind: 0.08 },
];

// Light & sky keyframes over the day (hour → look).
const K = (o) => ({
  ...o,
  top: new THREE.Color(o.top), mid: new THREE.Color(o.mid), bot: new THREE.Color(o.bot), sunC: new THREE.Color(o.sunC),
  sky: new THREE.Color(o.sky), ground: new THREE.Color(o.ground), fogC: new THREE.Color(o.fogC),
});
const NIGHT = { top: '#0b1020', mid: '#121a30', bot: '#1c2540', sunC: '#9fb0ec', sunI: 0.95, sky: '#5a6aa8', ground: '#2a3048', hemiI: 0.95, night: 1, fogC: '#1b2335' };
const DAY = { top: '#ffffff', mid: '#fbfbfb', bot: '#e3e3e3', sunC: '#fff3e0', sunI: 2.5, sky: '#cfe2ff', ground: '#6d7a8e', hemiI: 1.05, night: 0, fogC: '#d3dfeb' };
const KEYS = [
  [0, K(NIGHT)],
  [5.3, K(NIGHT)],
  [6.8, K({ top: '#fbf6f2', mid: '#f4e9e4', bot: '#e2d2cc', sunC: '#ffb488', sunI: 1.4, sky: '#b9b2d9', ground: '#5a5060', hemiI: 0.8, night: 0.35, fogC: '#cdb3c4' })],
  [9, K(DAY)],
  [15.5, K(DAY)],
  [17.4, K({ top: '#fff8ef', mid: '#f8eadb', bot: '#e6d0bc', sunC: '#ffa05c', sunI: 1.9, sky: '#d9a9b6', ground: '#5a4a58', hemiI: 0.82, night: 0.15, fogC: '#e3b59c' })],
  [19.4, K({ top: '#2a2f48', mid: '#33384f', bot: '#3e4258', sunC: '#9a90e6', sunI: 0.9, sky: '#6a6aa8', ground: '#2a2c44', hemiI: 0.85, night: 0.85, fogC: '#3a3f5e' })],
  [24, K(NIGHT)],
];

const GRAY_TOP = new THREE.Color('#c9cdd2');
const GRAY_BOT = new THREE.Color('#8b949f');

// Shadow box half-size and normal bias at the closest view (16 art pixels per world unit).
// Both scale with the art pixel, so every zoom level gets the same shadow detail
// (about two shadow texels per art pixel) and a box that covers the whole view.
const SHADOW_R = 34, NORMAL_BIAS = 0.04, CLOSE_ART = 1 / 16;
// The sun (its direction, colour and strength, and the lamps that follow it) moves in steps
// of this many in-game minutes. Moving it a little every frame made shadow edges and the
// shading bands on the snow flicker all the time; in steps, they change only at each step.
// The sky gradient still changes smoothly.
const SUN_STEP_MIN = 5;
const UP = new THREE.Vector3(0, 1, 0);
const CLOUD_DAY = new THREE.Color('#f2f5fa'), CLOUD_GREY = new THREE.Color('#9aa3ae');
// per-frame scratch
const _dir = new THREE.Vector3(), _lr = new THREE.Vector3(), _lu = new THREE.Vector3(), _c = new THREE.Vector3();
const _fogC = new THREE.Color();

export class Environment {
  constructor(scene, camera, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    this.center = new THREE.Vector3(W / 2, 8, D / 2);
    /** where the camera looks; the shadow box and the fog centre on it (set by main) */
    this.focus = this.center.clone();
    /** world units per art pixel (set by main); the shadow box scales with it */
    this.artSize = CLOSE_ART;
    this.weather = WEATHERS[0];
    this.w = { snow: 0, clouds: 0, sun: 1, fog: 0, wind: 0.12 };
    this.look = K(DAY);
    this.light = K(DAY); // the look at the sun's last step (see SUN_STEP_MIN)
    this.night = 0;

    this.hemi = new THREE.HemisphereLight('#cfe2ff', '#6d7a8e', 1);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff', 2.5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    // The shadow box follows the view (see focus), so it can be small and sharp:
    // about two shadow texels per art pixel. Its size follows the zoom (_fitShadowBox).
    sc.near = 1; sc.far = 340;
    this.sun.shadow.bias = -0.0004;
    this.shadowR = 0;
    this._fitShadowBox();
    this.sun.target.position.copy(this.center);
    scene.add(this.sun, this.sun.target);

    // Sky: a gradient card pinned behind everything, always filling the view.
    this.camera = camera;
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, bot: { value: new THREE.Color() } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec2 vUv;
        float bayer(vec2 p) {
          vec2 q = mod(floor(p), 4.0);
          float i = q.x + q.y * 4.0;
          return mod(i * 7.0 + floor(i / 4.0) * 3.0, 16.0) / 16.0;
        }
        void main() {
          float y = vUv.y;
          vec3 c = mix(bot, mid, smoothstep(0.0, 0.55, y));
          c = mix(c, top, smoothstep(0.45, 1.0, y));
          c += (bayer(gl_FragCoord.xy) - 0.5) * 0.012; // ordered dither: smooth, pixel-art friendly
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.skyMat);
    this.sky.position.z = -990;
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    camera.add(this.sky);

    scene.fog = new THREE.Fog('#d3dfeb', 1000, 1200);

    this._buildStars(camera);
    this._buildClouds();
    this._buildSnow();
  }

  setWeather(id) {
    this.weather = WEATHERS.find((w) => w.id === id) ?? WEATHERS[0];
  }

  _buildStars(camera) {
    const r = seeded(11);
    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(r() - 0.5) * 520, (r() - 0.5) * 320, -980], i * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.frustumCulled = false;
    camera.add(this.stars); // pinned behind the diorama whatever the view angle
  }

  _buildClouds() {
    const r = seeded(5);
    this.cloudMat = new THREE.MeshStandardMaterial({ color: '#f2f5fa', flatShading: true, roughness: 1 });
    this.clouds = [];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group();
      const puffs = 5 + Math.floor(r() * 5);
      for (let k = 0; k < puffs; k++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.0 + r() * 1.1, 1), this.cloudMat);
        m.position.set((k - puffs / 2) * 1.5 + r(), r() * 1.2, (r() - 0.5) * 2.2);
        m.scale.y = 0.75;
        m.castShadow = true;
        g.add(m);
      }
      const c = { group: g, x: r() * (W + 30) - 15, y: 20 + r() * 8, z: 4 + r() * (D - 8), speed: 0.6 + r() * 0.8, size: 0.8 + r() * 0.6, threshold: i / 8 };
      g.position.set(c.x, c.y, c.z);
      g.scale.setScalar(0.001);
      this.scene.add(g);
      this.clouds.push(c);
    }
  }

  _buildSnow() {
    this.snowMax = 1600;
    const pos = new Float32Array(this.snowMax * 3);
    this.snowVel = new Float32Array(this.snowMax);
    for (let i = 0; i < this.snowMax; i++) {
      pos.set([rand(-4, W + 4), rand(0, 34), rand(-4, D + 4)], i * 3);
      this.snowVel[i] = rand(0.7, 1.3);
    }
    const g = new THREE.BufferGeometry();
    this.snowAttr = new THREE.BufferAttribute(pos, 3);
    this.snowAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.snowAttr);
    g.setDrawRange(0, 0);
    this.snow = new THREE.Points(g, new THREE.PointsMaterial({
      color: '#ffffff', size: 1, sizeAttenuation: false, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  _sample(hour, L = this.look) {
    let i = 0;
    while (i < KEYS.length - 2 && hour >= KEYS[i + 1][0]) i++;
    const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
    const t = clamp((hour - h0) / (h1 - h0));
    for (const k of ['top', 'mid', 'bot', 'sunC', 'sky', 'ground', 'fogC']) L[k].copy(a[k]).lerp(b[k], t);
    for (const k of ['sunI', 'hemiI', 'night']) L[k] = lerp(a[k], b[k], t);
    return L;
  }

  /** Size the shadow box (and the normal bias, which is in world units) to the art pixel. */
  _fitShadowBox() {
    const k = this.artSize / CLOSE_ART;
    const R = SHADOW_R * k;
    if (R === this.shadowR) return;
    this.shadowR = R;
    const sc = this.sun.shadow.camera;
    sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R;
    sc.updateProjectionMatrix();
    this.sun.shadow.normalBias = NORMAL_BIAS * k;
  }

  update(hour, dt, time) {
    // ease weather parameters toward the target
    const k = Math.min(1, dt * 0.35);
    for (const key of Object.keys(this.w)) this.w[key] += (this.weather[key] - this.w[key]) * k;
    const w = this.w;
    const L = this._sample(hour); // sky, fog, stars
    const sunHour = (Math.floor((hour * 60) / SUN_STEP_MIN) * SUN_STEP_MIN) / 60;
    const S = this._sample(sunHour, this.light); // sun, sky light, lamps
    const gloom = w.clouds * 0.55 + w.fog * 0.25;

    // sun arc: east → west over the day, moon on the same path at night
    const ang = ((sunHour - 6) / 12) * Math.PI;
    const dir = _dir.set(Math.cos(ang) * 0.75, 0.45 + Math.abs(Math.sin(ang)) * 0.6, 0.55).normalize();
    // Centre the shadow box on the focus, snapped to whole shadow texels in the light's
    // own axes, so shadow edges do not crawl when the camera moves.
    this._fitShadowBox();
    const texel = (2 * this.shadowR) / this.sun.shadow.mapSize.x;
    const lr = _lr.crossVectors(UP, dir).normalize();
    const lu = _lu.crossVectors(dir, lr);
    const c = _c.set(0, 0, 0)
      .addScaledVector(lr, Math.round(this.focus.dot(lr) / texel) * texel)
      .addScaledVector(lu, Math.round(this.focus.dot(lu) / texel) * texel)
      .addScaledVector(dir, this.focus.dot(dir));
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(dir, 140);
    this.sun.color.copy(S.sunC);
    this.sun.intensity = S.sunI * w.sun;
    this.hemi.color.copy(S.sky);
    this.hemi.groundColor.copy(S.ground);
    this.hemi.intensity = S.hemiI * (1 - gloom * 0.25);

    this.night = clamp(S.night + gloom * 0.3 * (1 - S.night));
    for (const g of nightGlow.mats) g.mat.emissiveIntensity = g.strength * this.night;
    for (const l of nightGlow.lights) l.light.intensity = l.strength * clamp((this.night - 0.15) / 0.6);
    this.starMat.opacity = clamp((L.night - 0.5) * 2) * (1 - w.clouds * 0.9) * (1 - w.fog * 0.8);
    this.stars.visible = this.starMat.opacity > 0.01; // else the pixel pass outlines them

    // fog: from the view distance, denser with fog/storm weather
    const fogC = _fogC.copy(L.fogC).lerp(GRAY_BOT, w.clouds * 0.3);
    this.scene.fog.color.copy(fogC);
    const camDist = this.camera.position.distanceTo(this.focus);
    const f = Math.max(w.fog, w.snow * 0.6);
    this.scene.fog.near = camDist - 30 + (1 - f) * 600;
    this.scene.fog.far = this.scene.fog.near + 150 - f * 70;

    // sky gradient, greyed by clouds and washed out by fog
    const cam = this.camera;
    this.sky.scale.set((cam.right - cam.left) / cam.zoom * 1.02, (cam.top - cam.bottom) / cam.zoom * 1.02, 1);
    const grey = w.clouds * 0.5 * (1 - L.night * 0.6);
    this.skyMat.uniforms.top.value.copy(L.top).lerp(GRAY_TOP, grey);
    this.skyMat.uniforms.mid.value.copy(L.mid).lerp(GRAY_BOT, grey).lerp(fogC, w.fog * 0.5);
    this.skyMat.uniforms.bot.value.copy(L.bot).lerp(GRAY_BOT, grey * 0.8).lerp(fogC, w.fog * 0.8);

    // clouds drift across; the number visible follows the weather
    this.cloudMat.color.copy(CLOUD_DAY).lerp(CLOUD_GREY, clamp(w.snow * 0.8 + L.night * 0.5));
    for (const c of this.clouds) {
      c.x += c.speed * (0.4 + w.wind * 2) * dt;
      if (c.x > W + 22) c.x = -22;
      const target = w.clouds > c.threshold ? c.size * clamp((w.clouds - c.threshold) * 4) : 0;
      const s = c.group.scale.x + (target - c.group.scale.x) * Math.min(1, dt * 0.8);
      c.group.scale.setScalar(Math.max(0.001, s));
      c.group.visible = s > 0.01;
      c.group.position.set(c.x, c.y + Math.sin(time * 0.3 + c.z) * 0.4, c.z);
    }

    // snowfall
    const active = Math.floor(this.snowMax * w.snow);
    this.snow.geometry.setDrawRange(0, active);
    if (active > 0) {
      const p = this.snowAttr.array;
      const fall = 2.4 + w.wind * 3.5;
      const drift = w.wind * 6;
      for (let i = 0; i < active; i++) {
        const j = i * 3;
        p[j] += (drift + Math.sin(time * 1.3 + i) * 0.6) * dt;
        p[j + 1] -= fall * this.snowVel[i] * dt;
        p[j + 2] += Math.cos(time * 1.1 + i * 0.7) * 0.4 * dt;
        if (p[j] > W + 4) p[j] -= W + 8;
        const x = p[j], z = p[j + 2];
        const inside = x >= 0 && x <= W && z >= 0 && z <= D;
        const floor = inside ? this.terrain.heightAt(x, z) : BOTTOM - 4;
        if (p[j + 1] < floor) {
          p[j] = rand(-4, W + 4);
          p[j + 1] = rand(26, 36);
          p[j + 2] = rand(-4, D + 4);
        }
      }
      this.snowAttr.needsUpdate = true;
    }
  }
}
