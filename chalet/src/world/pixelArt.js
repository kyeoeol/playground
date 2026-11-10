import * as THREE from 'three';
import { clamp } from '../core/rand.js';

/*
 * Pixel-art colour helpers in the cosy farm-sim style:
 *  - hue-shifted shades: darker shades drift toward blue/purple, lighter shades toward
 *    warm yellow (never pure black or grey)
 *  - canvas pixel textures (pixelTexture, canvasTex)
 * Textures use NearestFilter and are mapped at 16 texels per world unit (32 texels at
 * repeat 0.5 on world-unit UVs): one texel per art pixel (the view draws 16 px per unit).
 */

export function hexToHsl(hex) {
  const c = new THREE.Color(hex);
  const o = {};
  c.getHSL(o, THREE.SRGBColorSpace);
  return o;
}

export function hslToHex(h, s, l) {
  return '#' + new THREE.Color().setHSL(((h % 1) + 1) % 1, clamp(s), clamp(l), THREE.SRGBColorSpace).getHexString(THREE.SRGBColorSpace);
}

/** Move hue a toward b (both 0..1, circular) by at most `step`. */
function hueToward(a, b, step) {
  let d = b - a;
  if (d > 0.5) d -= 1;
  if (d < -0.5) d += 1;
  return a + Math.sign(d) * Math.min(Math.abs(d), step);
}

// winter: highlights drift warm, shadows drift toward teal/cyan (not grey, not purple)
const WARM = 45 / 360, COOL = 196 / 360;

/** One hue-shifted step lighter (k > 0) or darker (k < 0). */
export function shade(hex, k, { light = 0.075, hue = 0.022 } = {}) {
  const { h, s, l } = hexToHsl(hex);
  if (k === 0) return hex;
  const nh = hueToward(h, k > 0 ? WARM : COOL, hue * Math.abs(k) * (s < 0.08 ? 0.5 : 1));
  const ns = k > 0 ? s - 0.025 * k : s + 0.05 * -k + (s < 0.06 ? 0.06 : 0);
  return hslToHex(nh, ns, l + light * k);
}

/** Winter snow and ice, from the style reference. */
export const SNOW = { l2: '#ffffff', l1: '#f7fcfd', b: '#eef8fb', d1: '#cfe9f0', d2: '#a9d3df', d3: '#6fb0c0' };
export const ICE = { l2: '#ffffff', l1: '#bfeaf6', b: '#7fd0e8', d1: '#3f9fd0', d2: '#2a6fa8' };
export const WOOD = { l2: '#ecb877', l1: '#d99a5b', b: '#b8723c', d1: '#8a4f2a', d2: '#4a2a1a' };
export const TEAL = { l2: '#8fd0d4', l1: '#56aab4', b: '#2f7f8c', d1: '#1f5a66', d2: '#143e4a' };
export const STONE = { l2: '#e2ecef', l1: '#c8d6dc', b: '#9fb2ba', d1: '#7a8f98', d2: '#5a6f78' };

/**
 * Texture for pixel art drawn on a canvas. Close up (magnification) it is plain "nearest".
 * Seen from afar, the art is finer than one screen pixel (quilting on the beanie, log
 * seams, cobbles in the overview), and plain "nearest" picks a random texel per pixel:
 * noisy mush. Mipmaps pre-average the texture down to the size it is shown at, and
 * "nearest mipmap nearest" still keeps every pixel a single flat colour.
 */
export function pixelTexture(canvas, { wrap = false } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapNearestFilter;
  t.anisotropy = 4;
  if (wrap) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A repeating w×h pixel texture; draw(ctx, px) paints it, px(x, y, colour) sets one texel. */
export function canvasTex(w, h, draw, { repeat = 0.5 } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); });
  const t = pixelTexture(c, { wrap: true });
  t.repeat.set(repeat, repeat);
  return t;
}

/** Window glass: deep blue pane with a warm wooden frame line and a diagonal glare. */
export const glassTexture = canvasTex(4, 4, (ctx, px) => {
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    let c = y < 2 ? '#2f5f8a' : '#244b70';
    if (x === 0 || y === 0) c = WOOD.d2;
    if ((x === 2 && y === 1) || (x === 1 && y === 2)) c = '#bfe8f4';
    if (x === 2 && y === 1) c = '#ffffff';
    px(x, y, c);
  }
}, { repeat: 1 / 0.36 });
