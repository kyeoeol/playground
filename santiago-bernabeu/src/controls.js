import * as THREE from 'three';
import { HALF } from './constants.js';

const DEG = Math.PI / 180;
const FOV = 13; // a long lens: still reads as an isometric diamond, but with real depth
const QUARTER = 90 * DEG;
const DIAMOND = 45 * DEG;

/** Perspective orbit rig that always comes to rest on a diamond view of the slab. */
export class CameraRig {
  constructor() {
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 10, 6000);
    this.az = DIAMOND;
    this.targetAz = DIAMOND;
    this.el = 33 * DEG;
    this.zoom = 1;
    this.targetZoom = 1;
    this.target = new THREE.Vector3(0, -22, 0);
    this.aspect = 1;
  }

  resize(width, height) {
    this.aspect = width / height;
  }

  update(dt) {
    const k = 1 - Math.exp(-dt * 8);
    this.az += (this.targetAz - this.az) * k;
    this.zoom += (this.targetZoom - this.zoom) * k;
    const c = this.camera;
    const span = HALF * Math.SQRT2;
    // Half-height needed to fit the diamond, its soil and the towers rising at the back.
    const fit = Math.max((span * 1.08) / this.aspect, (span * 2 * Math.sin(this.el) + 95) * 0.6);
    const distance = fit / Math.tan((FOV * DEG) / 2);
    c.aspect = this.aspect;
    c.zoom = this.zoom;
    c.near = distance - span * 1.6;
    c.far = distance + span * 1.6;
    c.updateProjectionMatrix();
    const dir = new THREE.Vector3(Math.sin(this.az) * Math.cos(this.el), Math.sin(this.el), Math.cos(this.az) * Math.cos(this.el));
    c.position.copy(this.target).addScaledVector(dir, distance);
    c.lookAt(this.target);
  }

  rotateBy(rad) {
    this.targetAz += rad;
  }

  snapToDiamond() {
    this.targetAz = Math.round((this.targetAz - DIAMOND) / QUARTER) * QUARTER + DIAMOND;
  }

  zoomBy(factor) {
    this.targetZoom = THREE.MathUtils.clamp(this.targetZoom * factor, 1, 4);
  }
}

/** Drag turns the world (settling back on a diamond), the wheel zooms. */
export function attachCameraGestures(canvas, rig) {
  let lastX = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    lastX = e.clientX;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (lastX === null) return;
    rig.rotateBy(-(e.clientX - lastX) * 0.006);
    lastX = e.clientX;
  });
  const release = () => {
    if (lastX === null) return;
    lastX = null;
    rig.snapToDiamond();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    rig.zoomBy(Math.exp(-e.deltaY * 0.0014));
  }, { passive: false });
}
