import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { StylePass } from './StylePass.js';

/** Objects drawn by the rider layer only (the avatar on the lift and its chair). */
export const RIDER_LAYER = 1;

/**
 * A second art-resolution picture with only the avatar on the lift and its chair.
 *
 * The world picture is drawn from a camera on the art lattice and moved on screen by
 * the sub-pixel remainder, so the slope scrolls smoothly. One remainder cannot also keep
 * a moving chair still on screen: the chair would land on a new sub-pixel spot every
 * frame and its edges would crawl. This layer has its own camera, placed so that the
 * chair is always on a lattice point of it (its pixels stay the same from frame to
 * frame), and its own remainder (Present puts the two together).
 *
 * It reuses the world picture's shadow map, so the rider keeps the towers' shadows.
 */
export class RiderLayer {
  constructor(renderer, scene, mainStyle) {
    this.renderer = renderer;
    this.mainStyle = mainStyle;
    this.camera = new THREE.OrthographicCamera();
    this.composer = new EffectComposer(renderer);
    this.composer.renderToScreen = false;
    this.pixelPass = new RenderPixelatedPass(1, scene, this.camera, { normalEdgeStrength: 0.35, depthEdgeStrength: 0 });
    this.composer.addPass(this.pixelPass);
    this.style = new StylePass(this.camera, this.pixelPass._beautyRenderTarget.depthTexture);
    this.composer.addPass(this.style);
    this.composer.addPass(new OutputPass());
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  get texture() { return this.composer.readBuffer.texture; }
  get depth() { return this.pixelPass._beautyRenderTarget.depthTexture; }

  /**
   * Draw the layer. view: the world picture's camera (on the lattice); logical: where
   * the camera really is; anchor: a point that moves with the chair; axR/axU: the screen
   * axes; a: world units per art pixel. Returns the remainder, in art pixels, like
   * snapCamera.
   */
  render(view, logical, anchor, axR, axU, a) {
    const c = this.camera;
    c.copy(view, false);
    c.layers.set(RIDER_LAYER);
    // the anchor a whole number of art pixels from this camera, as near the logical camera as can be
    const ar = anchor.dot(axR), au = anchor.dot(axU);
    const kr = Math.round((ar - logical.dot(axR)) / a), ku = Math.round((au - logical.dot(axU)) / a);
    c.position
      .addScaledVector(axR, ar - kr * a - c.position.dot(axR))
      .addScaledVector(axU, au - ku * a - c.position.dot(axU));
    c.updateMatrixWorld();
    // the same look as the world picture
    const from = this.mainStyle.material.uniforms, to = this.style.material.uniforms;
    for (const k in from) if (!['tDiffuse', 'tDepth', 'resolution'].includes(k)) to[k].value = from[k].value;
    const sm = this.renderer.shadowMap, auto = sm.autoUpdate;
    sm.autoUpdate = false; // the world picture just drew it, rider included
    this.composer.render();
    sm.autoUpdate = auto;
    return {
      fa: (logical.dot(axR) - c.position.dot(axR)) / a,
      fb: (logical.dot(axU) - c.position.dot(axU)) / a,
    };
  }
}
