import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Puts the art-resolution pictures on the screen, one device pixel at a time.
 *
 * The canvas is the size of the screen in device pixels. Each art pixel covers px × px
 * of them, so a picture can be moved by a single device pixel: that is how the sub-pixel
 * remainder of a lattice camera becomes smooth motion. The world picture and the rider
 * layer each have their own remainder. Where both have something, the nearer one wins
 * (same view direction and depth range, so their depths compare directly).
 *
 * Input pictures are already in output colour (after OutputPass): this is a plain copy.
 */
export class Present {
  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tA: { value: null }, tAD: { value: null }, offA: { value: new THREE.Vector2() },
        tB: { value: null }, tBD: { value: null }, offB: { value: new THREE.Vector2() },
        useB: { value: false },
        px: { value: 1 },
      },
      vertexShader: /* glsl */ `
        void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D tA, tAD, tB, tBD;
        uniform vec2 offA, offB;
        uniform bool useB;
        uniform float px;
        ivec2 cell(sampler2D t, vec2 off) {
          ivec2 s = textureSize(t, 0);
          return clamp(ivec2(floor((floor(gl_FragCoord.xy) + off) / px)), ivec2(0), s - 1);
        }
        void main() {
          ivec2 a = cell(tA, offA);
          vec4 c = texelFetch(tA, a, 0);
          if (useB) {
            ivec2 b = cell(tB, offB);
            float db = texelFetch(tBD, b, 0).r;
            if (db < 1.0 && db <= texelFetch(tAD, a, 0).r) c = texelFetch(tB, b, 0);
          }
          gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
        }`,
      depthTest: false,
      depthWrite: false,
    });
    this.quad = new FullScreenQuad(this.material);
  }

  /**
   * world/rider: { texture, depth, fa, fb } (rider may be null). fa, fb: the remainder in
   * art pixels along the screen's right and up axes (see snapCamera); px: device pixels
   * per art pixel.
   */
  render(renderer, px, world, rider) {
    const u = this.material.uniforms;
    u.px.value = px;
    u.tA.value = world.texture;
    u.tAD.value = world.depth;
    u.offA.value.set(Math.round(world.fa * px), Math.round(world.fb * px));
    u.useB.value = !!rider;
    // Without a rider, bind nothing: binding the rider layer's textures while it is not
    // drawn would build its depth texture at a stale size after a resize, and the layer's
    // framebuffer would then stay incomplete (the rider would not show).
    u.tB.value = rider ? rider.texture : null;
    u.tBD.value = rider ? rider.depth : null;
    if (rider) u.offB.value.set(Math.round(rider.fa * px), Math.round(rider.fb * px));
    renderer.setRenderTarget(null);
    this.quad.render(renderer);
  }
}
