import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Retro 16-bit pixel-art look, applied to the art-resolution buffer:
 *
 *  1. Outline: the border pixel of a nearer object is drawn as a dark, saturated shade of
 *     its own colour (dark brown around yellow, dark red around red), never pure black.
 *     Lone pixels such as snowflakes are left alone.
 *  2. Hue-shifted shading: shadows lean cool (teal-blue), lights lean warm (yellow).
 *  3. Colour steps: brightness snaps to a few levels, so smooth lighting turns into flat,
 *     hand-shaded bands, like a limited palette.
 *
 * Runs before OutputPass, on linear colour.
 */
export class StylePass extends Pass {
  constructor(camera, depthTexture) {
    super();
    this.camera = camera;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        tDepth: { value: depthTexture },
        resolution: { value: new THREE.Vector4() },
        near: { value: 1 },
        far: { value: 1000 },
        outlineDepth: { value: 0.3 }, // world units of depth gap that count as an edge
        outlineShade: { value: 0.32 },
        outlineSat: { value: 1.5 },   // outline colour is more saturated than the fill
        bandMix: { value: 0.85 },     // how hard mid and light tones snap to the bands
        steps: { value: 7 },
        warmCool: { value: 1 },
        saturation: { value: 1.3 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec4 resolution;
        uniform float near, far, outlineDepth, outlineShade, outlineSat, bandMix, steps, warmCool, saturation;
        varying vec2 vUv;

        // orthographic: depth is linear in view distance
        float dist(vec2 uv) { return near + texture2D(tDepth, uv).x * (far - near); }

        float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

        void main() {
          vec4 src = texture2D(tDiffuse, vUv);
          vec3 c = src.rgb;
          float d = dist(vUv);
          bool sky = d > far - 20.0;

          if (!sky) {
            // --- hue-shifted, stepped shading ---
            float L = max(luma(c), 1e-4);
            float g = pow(L, 1.0 / 2.2);                       // perceptual brightness
            float q = (floor(g * steps) + 0.5) / steps;          // snap to a band
            // Band only the mid and light tones. Dark tones keep their own steps, or a
            // black beanie's quilting and a black board next to it melt into one blob.
            q = mix(g, q, bandMix * smoothstep(0.12, 0.35, g));
            c *= pow(q, 2.2) / L;
            float shadow = 1.0 - smoothstep(0.18, 0.62, g);
            float light = smoothstep(0.62, 0.98, g);
            c *= mix(vec3(1.0), vec3(0.8, 0.94, 1.1), shadow * warmCool);   // cool teal-blue shadows (winter)
            c *= mix(vec3(1.0), vec3(1.05, 1.01, 0.9), light * warmCool);    // warm lights
            float l2 = luma(c);
            c = max(vec3(0.0), mix(vec3(l2), c, saturation));

            // --- selective outline: am I the edge of something in front? ---
            // Depth on a flat surface changes linearly across the screen, so its second
            // difference is ~0 at any zoom. A jump to something farther behind makes it
            // large and positive: that pixel is the front edge of an object.
            vec2 px = resolution.zw;
            float dr = dist(vUv + vec2(px.x, 0.0)), dl = dist(vUv - vec2(px.x, 0.0));
            float du = dist(vUv + vec2(0.0, px.y)), dd = dist(vUv - vec2(0.0, px.y));
            float edge = max(dr + dl - 2.0 * d, du + dd - 2.0 * d);
            // lone pixels (snowflakes) are farther-bounded on all four sides: leave them
            float far4 = step(outlineDepth, dr - d) + step(outlineDepth, dl - d) + step(outlineDepth, du - d) + step(outlineDepth, dd - d);
            if (edge > outlineDepth && far4 < 3.5) {
              // a dark, saturated shade of the object's own colour; near-white things
              // (snow, white paint) get a cool blue-grey outline instead
              vec3 o = c * outlineShade;
              float lo = luma(o);
              o = max(vec3(0.0), mix(vec3(lo), o, outlineSat));
              float white = smoothstep(0.55, 0.85, luma(c)) * (1.0 - smoothstep(0.1, 0.3, max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b))));
              o = mix(o, vec3(0.09, 0.13, 0.2), white * 0.8);
              c = max(o, vec3(0.008, 0.012, 0.02));
            }
          }
          gl_FragColor = vec4(c, src.a);
        }`,
    });
    this.fsQuad = new FullScreenQuad(this.material);
  }

  setSize(width, height) {
    this.material.uniforms.resolution.value.set(width, height, 1 / width, 1 / height);
  }

  render(renderer, writeBuffer, readBuffer) {
    const u = this.material.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.near.value = this.camera.near;
    u.far.value = this.camera.far;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }

  dispose() {
    this.material.dispose();
    this.fsQuad.dispose();
  }
}
