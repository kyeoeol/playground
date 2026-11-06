import * as THREE from 'three';
import { PixelPipeline } from './core/pipeline.js';
import { CameraRig, attachCameraGestures } from './controls.js';
import { Sky } from './sky.js';
import { Ui } from './ui.js';
import { Ground } from './world/ground.js';
import { Lamps, Trees } from './world/life.js';
import { City } from './world/city.js';
import { Stadium } from './world/stadium.js';

const canvas = document.getElementById('scene');
const pipeline = new PixelPipeline(canvas);
const scene = new THREE.Scene();
const rig = new CameraRig();

const ground = new Ground(scene);
const stadium = new Stadium(scene);
const city = new City(scene, ground);
const trees = new Trees(scene, ground, city.courtyards);
const lamps = new Lamps(scene);
const sky = new Sky(scene, pipeline);
const ui = new Ui(sky);

attachCameraGestures(canvas, rig);

let needsDraw = true;

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  pipeline.resize(w, h);
  rig.resize(pipeline.target.width, pipeline.target.height);
  needsDraw = true; // resizing wipes the canvas
}
window.addEventListener('resize', resize);
resize();

const CLOUD_SHADOW_INTERVAL = 1 / 20; // clouds drift slowly enough that 20 updates a second looks smooth

// The city is static, so the costly shadow pass only runs when the light or clouds move.
const lastSun = new THREE.Vector3(Infinity, 0, 0);
let cloudShadowsShown = false;
let cloudShadowAge = 0;

function shadowsDirty(dt) {
  const sunMoved = lastSun.distanceToSquared(sky.sun.position) > 0.01;
  if (sunMoved) lastSun.copy(sky.sun.position);
  cloudShadowAge += dt;
  // One more pass after the clouds fade, or their last shadows would stay on the ground.
  const cloudsMoved = cloudShadowsShown !== sky.clouds.visible || (sky.clouds.visible && cloudShadowAge >= CLOUD_SHADOW_INTERVAL);
  if (cloudsMoved) {
    cloudShadowsShown = sky.clouds.visible;
    cloudShadowAge = 0;
  }
  return sunMoved || cloudsMoved;
}

// A losing GPU context takes the canvas and the shadow map with it, so both need redrawing.
canvas.addEventListener('webglcontextrestored', () => {
  needsDraw = true;
  lastSun.x = Infinity;
});

let previous = performance.now();
let flood = 0;

// Once the view, light and weather have settled the picture can't change, so nothing is redrawn.
const SETTLED = 1e-4;
let drawn = [];
function sceneChanged() {
  const state = [rig.az, rig.zoom, sky.hour, sky.cloud, sky.rain, flood];
  const changed = needsDraw || sky.animated || state.some((value, i) => Math.abs(value - drawn[i]) >= SETTLED);
  if (changed) {
    drawn = state;
    needsDraw = false;
  }
  return changed;
}

function frame() {
  // Moving to a screen with another pixel density doesn't always fire a resize event.
  if (window.devicePixelRatio !== pipeline.dpr) resize();

  const now = performance.now();
  const dt = Math.min((now - previous) / 1000, 0.1);
  previous = now;

  rig.update(dt);
  sky.update(dt);
  const night = sky.values.night;

  flood += ((night > 0.45 ? 1 : 0) - flood) * Math.min(1, dt * 3.5);
  stadium.update(flood);
  city.update(night);
  lamps.update(night);
  ui.update();

  if (sceneChanged()) {
    pipeline.renderer.shadowMap.needsUpdate = shadowsDirty(dt);
    pipeline.render(scene, rig.camera);
  }
  requestAnimationFrame(frame);
}
frame();
// Waits a tick so the fade starts from the sky background rather than being skipped.
requestAnimationFrame(() => canvas.classList.add('ready'));

if (import.meta.env.DEV) window.__diorama = { sky, rig, pipeline, trees };
