import * as THREE from 'three';
import { NX, NZ, LEVEL } from './Terrain.js';
import { pixelTexture } from './pixelArt.js';
import { indexedGeo } from './meshKit.js';

/*
 * Running water for the creek, in the 16-bit way: flat blue tones with ripple dashes,
 * one texel per art pixel, and the ripples move by whole texels on a timer (like an
 * animated tile), not by a smooth scroll.
 */
const TEX = 32; // texels per texture tile; the texture repeats every 2 world units (16 texels per unit)
const DEPTH = 0.16; // water surface below the bank top, world units

const C = {
  deep: '#1f5c9c',
  mid: '#2d78bd',
  light: '#4f9fdc',
  foam: '#d6eefc',
};

function waterTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = TEX;
  const g = cv.getContext('2d');
  g.fillStyle = C.mid;
  g.fillRect(0, 0, TEX, TEX);
  // darker bands, two per tile, so the water has depth
  g.fillStyle = C.deep;
  for (const y of [5, 6, 21, 22]) g.fillRect(0, y, TEX, 1);
  for (const [x, y, w] of [[3, 13, 9], [19, 29, 8], [24, 10, 6]]) g.fillRect(x, y, w, 1);
  // ripple dashes: a light dash with a foam pixel on its crest
  const ripple = (x, y, w) => {
    g.fillStyle = C.light;
    g.fillRect(x, y, w, 1);
    g.fillStyle = C.foam;
    g.fillRect(x + 1, y - 1, Math.max(1, w - 3), 1);
  };
  ripple(2, 3, 6);
  ripple(15, 9, 5);
  ripple(25, 17, 6);
  ripple(6, 18, 4);
  ripple(11, 27, 6);
  ripple(27, 26, 3);
  return pixelTexture(cv, { wrap: true });
}

export class Water {
  /**
   * @param terrain the Terrain
   * @param isWater (i, j) => true for the tiles that hold water
   */
  constructor(terrain, isWater) {
    const pos = [], uv = [], idx = [];
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        if (!isWater(i, j)) continue;
        // the bank top is one step above the creek floor
        const y = terrain.heightAt(i + 0.5, j + 0.5) + LEVEL - DEPTH;
        const n = pos.length / 3;
        for (const [dx, dz] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
          pos.push(i + dx, y, j + dz);
          uv.push((i + dx) / 2, -(j + dz) / 2);
        }
        idx.push(n, n + 2, n + 1, n, n + 3, n + 2);
      }
    }
    const geo = indexedGeo(pos, uv, idx);
    this.map = waterTexture();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: this.map, roughness: 0.4, metalness: 0 }));
    this.mesh.receiveShadow = true;
    this.t = 0;
    this.step = 0;
  }

  /** Move the ripples one texel at a time, downstream. */
  update(dt) {
    this.t += dt;
    const step = Math.floor(this.t / 0.18);
    if (step === this.step) return;
    this.step = step;
    this.map.offset.set((step % TEX) / TEX, 0);
  }
}
