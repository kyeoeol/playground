import * as THREE from 'three';
import { pixelTexture } from '../world/pixelArt.js';

/*
 * Chibi halfpipe snowboarder, after the user's reference photo: a round metallic
 * purple helmet, a wide goggle strap and a magenta-to-gold mirror lens, a baggy black
 * jacket and pants, a blue-and-white race bib (five rings on the chest, a "1" on the
 * back, as the user asked), black gloves and boots, and a mint-teal board.
 *
 * Every mesh has ONE material (no material arrays): main.js clones each avatar
 * material once for the stencil silhouette, and it skips array materials.
 * Materials are never swapped after construction; poses only move groups.
 */

const ROOT_SCALE = 1.5;
const OLD_SCALE = 1.15; // the ground ring keeps its old world size

const geos = new Map();
function bx(w, h, d) {
  const k = `${w}|${h}|${d}`;
  if (!geos.has(k)) geos.set(k, new THREE.BoxGeometry(w, h, d));
  return geos.get(k);
}
function part(parent, w, h, d, material, x, y, z) {
  const m = new THREE.Mesh(bx(w, h, d), material);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  draw(g, (col, x, y, ww = 1, hh = 1) => { g.fillStyle = col; g.fillRect(x, y, ww, hh); });
  return pixelTexture(c);
}
/** Add a mesh with any geometry, placed and optionally scaled (sx, sy, sz). */
function shape(parent, geo, material, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
/** Open band (part of a cylinder) centred on the front (+z), thetaLength radians wide. */
function band(r0, r1, h, thetaLength, seg = 12) {
  return new THREE.CylinderGeometry(r0, r1, h, seg, 1, true, -thetaLength / 2, thetaLength);
}
const std = (opts) => new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.8, ...opts });

// ---- palette -------------------------------------------------------------------------
const J0 = '#1b1d24', J1 = '#2c2f39', J2 = '#454a58'; // black outerwear: shadow, base, lit edge
const GLOVE = '#15161b', SOLE = '#8d8f98';
const HELM = '#3a1a6a', HELM_HI = '#6a3aa0', HELM_LO = '#1c0c38', HELM_GLINT = '#c9a6ec';
const BLUE = '#2f4fc8', BLUE_LO = '#22389a', BIB_WHITE = '#f4f5f8', NAVY = '#16204a';
const MINT = '#7fd6cf', MINT_LO = '#4fb0aa', MINT_HI = '#b4ece6', BASE_EDGE = '#3a3d45';
const SKIN = '#f2c39a', SKIN_LO = '#d99a74', BLUSH = '#ec9c84';

// Textures are sized so one texel is about one art pixel at the fixed camera scale
// (16 art px per world unit x ROOT_SCALE 1.5 = 24 texels per model unit): flat tones.

// Mirror lens (12 x 4): magenta, coral, gold bands, a white glint, darker lower rim.
const lensTex = canvasTex(12, 4, (g, px) => {
  px('#e0479e', 0, 0, 12, 1);
  px('#f07a5a', 0, 1, 12, 1);
  px('#f2b34a', 0, 2, 12, 1);
  px('#c98a2e', 0, 3, 12, 1);
  px('#ffffff', 2, 0, 2, 1); // glint
  px('#ffffff', 3, 1, 1, 1);
});
// Race bib (11 x 8): blue yoke on top, white panel. The front carries the five rings
// (3 x 3 outline rings, interlocked: top row blue, black, red; bottom row yellow, green);
// the back carries a bold navy "1".
function bibBase(px) {
  px(BIB_WHITE, 0, 0, 11, 8);
  px(BLUE, 0, 0, 11, 1);
  px(BLUE_LO, 0, 1, 11, 1);
  px('#d9dce4', 0, 7, 11, 1); // lower hem in shade
}
function ring(px, col, x, y) {
  px(col, x, y, 3, 1);
  px(col, x, y + 2, 3, 1);
  px(col, x, y + 1, 1, 1);
  px(col, x + 2, y + 1, 1, 1);
}
const bibFrontTex = canvasTex(11, 8, (g, px) => {
  bibBase(px);
  ring(px, '#0081c8', 0, 2);
  ring(px, '#141414', 4, 2);
  ring(px, '#ee334e', 8, 2);
  ring(px, '#fcb131', 2, 4);
  ring(px, '#00a651', 6, 4);
  // interlock: the top ring passes over the lower ring at the left of each crossing
  px('#0081c8', 2, 4, 1, 1);
  px('#141414', 6, 4, 1, 1);
});
const bibBackTex = canvasTex(11, 8, (g, px) => {
  bibBase(px);
  px(NAVY, 5, 2, 2, 5); // "1": 2-px stem
  px(NAVY, 4, 2, 1, 1); // flag
  px(NAVY, 4, 6, 4, 1); // foot
});
// Board top (8 x 26): mint deck, white edge line, a shaded chevron and a light stripe.
const boardTex = canvasTex(8, 26, (g, px) => {
  px(MINT, 0, 0, 8, 26);
  px(MINT_HI, 2, 2, 1, 22); // light stripe
  for (let i = 0; i < 3; i++) { px(MINT_LO, 1 + i, 11 + i, 1, 1); px(MINT_LO, 6 - i, 11 + i, 1, 1); } // chevron
  px(MINT_LO, 1, 15, 6, 1);
  px('#ffffff', 0, 0, 1, 26); // white edge lines
  px('#ffffff', 7, 0, 1, 26);
  px('#ffffff', 0, 0, 8, 1);
  px('#ffffff', 0, 25, 8, 1);
});

const M = {
  j0: std({ color: J0, roughness: 0.9 }),
  j1: std({ color: J1, roughness: 0.85 }),
  j2: std({ color: J2, roughness: 0.85 }),
  glove: std({ color: GLOVE, roughness: 0.9 }),
  sole: std({ color: SOLE, roughness: 0.8 }),
  helm: std({ color: HELM, roughness: 0.3, metalness: 0.35 }),
  helmHi: std({ color: HELM_HI, roughness: 0.3, metalness: 0.35 }),
  helmLo: std({ color: HELM_LO, roughness: 0.4 }),
  helmGlint: std({ color: HELM_GLINT, roughness: 0.2 }),
  strap: std({ color: '#22242c', roughness: 0.8 }),
  frame: std({ color: '#121318', roughness: 0.6 }),
  lens: std({ map: lensTex, roughness: 0.25 }),
  skin: std({ color: SKIN, roughness: 0.9 }),
  mouth: std({ color: '#6e3428', roughness: 0.9 }),
  neck: std({ color: SKIN_LO, roughness: 0.9 }),
  blush: std({ color: BLUSH, roughness: 0.9 }),
  bibFront: std({ map: bibFrontTex, roughness: 0.8 }),
  bibBack: std({ map: bibBackTex, roughness: 0.8 }),
  blue: std({ color: BLUE, roughness: 0.8 }),
  board: std({ map: boardTex, roughness: 0.4 }),
  mint: std({ color: MINT, roughness: 0.4 }),
  baseEdge: std({ color: BASE_EDGE, roughness: 0.5 }),
  binding: std({ color: GLOVE, roughness: 0.6 }),
  highback: std({ color: J1, roughness: 0.6 }),
};


const HIP = 0.24;

/**
 * root (position, yaw) → tilt (pitch/roll) → body (stance) → legs / torso → arms, head
 */
export class PlayerModel {
  constructor() {
    this.root = new THREE.Group();
    this.root.scale.setScalar(ROOT_SCALE);
    this.tilt = new THREE.Group();
    this.root.add(this.tilt);
    this.body = new THREE.Group();
    this.tilt.add(this.body);

    // Round, low-segment shapes: the pixel pass turns them into soft sprite silhouettes
    // with 2–3 flat tones per part (flat shading).

    // ---- legs: two short capsules (baggy black pants), a cuff ring, round boots
    this.legs = [];
    const legGeo = new THREE.CapsuleGeometry(0.075, 0.08, 3, 8);
    const cuffGeo = new THREE.TorusGeometry(0.075, 0.025, 4, 10).rotateX(Math.PI / 2);
    const bootGeo = new THREE.SphereGeometry(0.085, 8, 5);
    const soleGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.025, 10);
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.1, HIP, 0);
      shape(leg, legGeo, M.j1, 0, -0.09, 0);
      shape(leg, cuffGeo, M.j2, 0, -0.165, 0.005); // baggy cuff over the boot
      shape(leg, bootGeo, M.glove, 0, -0.205, 0.035, 1, 0.6, 1.35); // boot
      shape(leg, soleGeo, M.sole, 0, -0.245, 0.035, 1, 1, 1.35); // grey sole
      this.body.add(leg);
      this.legs.push(leg);
    }

    // ---- torso: narrow round jacket, a little wider at the hips; curved bib panels
    this.torso = new THREE.Group();
    this.torso.position.y = HIP;
    this.body.add(this.torso);
    const profile = [[0.0, 0.0], [0.2, 0.0], [0.225, 0.05], [0.215, 0.2], [0.19, 0.3], [0.15, 0.36], [0.0, 0.385]]
      .map(([r, y]) => new THREE.Vector2(r, y));
    shape(this.torso, new THREE.LatheGeometry(profile, 10), M.j1);
    shape(this.torso, new THREE.TorusGeometry(0.215, 0.03, 4, 12).rotateX(Math.PI / 2), M.j0, 0, 0.03, 0); // loose hem
    shape(this.torso, new THREE.TorusGeometry(0.11, 0.03, 4, 10).rotateX(Math.PI / 2), M.j0, 0, 0.36, 0); // collar
    // bib: a slightly conical band hugging the jacket, front (rings) and back ("1")
    shape(this.torso, band(0.188, 0.232, 0.28, 1.9), M.bibFront, 0, 0.18, 0);
    const back = shape(this.torso, band(0.188, 0.232, 0.28, 1.9), M.bibBack, 0, 0.18, 0);
    back.rotation.y = Math.PI;
    for (const side of [-1, 1]) shape(this.torso, new THREE.SphereGeometry(0.06, 6, 4), M.blue, side * 0.15, 0.33, 0, 1, 0.55, 1.2); // blue shoulders

    // ---- arms: thin capsules hanging at the sides, cuff ring, round mitts
    this.arms = [];
    const armGeo = new THREE.CapsuleGeometry(0.058, 0.13, 3, 8);
    const sleeveCuff = new THREE.TorusGeometry(0.056, 0.022, 4, 10).rotateX(Math.PI / 2);
    const mittGeo = new THREE.SphereGeometry(0.065, 8, 6);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.22, 0.31, 0);
      const hang = new THREE.Group(); // a small outward angle, kept inside the arm (poses reset arm rotation)
      hang.rotation.z = side * 0.14;
      arm.add(hang);
      shape(hang, armGeo, M.j1, 0, -0.1, 0);
      shape(hang, sleeveCuff, M.j0, 0, -0.2, 0);
      shape(hang, mittGeo, M.glove, 0, -0.26, 0.01);
      this.torso.add(arm);
      this.arms.push(arm);
    }

    // ---- head: round face under a hemisphere helmet; goggles on a curved band
    this.head = new THREE.Group();
    this.head.position.y = 0.36;
    this.torso.add(this.head);
    shape(this.head, new THREE.SphereGeometry(0.235, 10, 8), M.skin, 0, 0.2, 0.01, 1, 0.95, 1); // face
    shape(this.head, new THREE.BoxGeometry(0.07, 0.016, 0.02), M.mouth, 0, 0.065, 0.2); // mouth
    shape(this.head, new THREE.CylinderGeometry(0.08, 0.09, 0.08, 8), M.neck, 0, 0.0, 0); // neck in shade
    for (const side of [-1, 1]) shape(this.head, new THREE.SphereGeometry(0.03, 5, 3), M.blush, side * 0.12, 0.1, 0.17, 1, 0.6, 0.5); // cheeks
    // helmet: dome, darker rim, a lit crown cap and one highlight spot on the upper left
    shape(this.head, new THREE.SphereGeometry(0.28, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), M.helm, 0, 0.25, -0.01);
    shape(this.head, new THREE.CylinderGeometry(0.29, 0.295, 0.05, 12), M.helmLo, 0, 0.245, -0.01); // rim / short brim
    shape(this.head, new THREE.SphereGeometry(0.17, 10, 4, 0, Math.PI * 2, 0, Math.PI / 2), M.helmHi, -0.02, 0.4, 0.0, 1, 0.75, 1); // lit crown
    shape(this.head, new THREE.SphereGeometry(0.045, 6, 4), M.helmGlint, -0.13, 0.45, 0.12, 1, 0.6, 1); // highlight
    // goggles: strap round the helmet, dark frame band at the front, mirror lens
    shape(this.head, band(0.292, 0.292, 0.09, Math.PI * 2, 14), M.strap, 0, 0.3, -0.01);
    shape(this.head, band(0.3, 0.3, 0.17, 2.2), M.frame, 0, 0.29, -0.01);
    shape(this.head, band(0.308, 0.308, 0.14, 1.65), M.lens, 0, 0.29, -0.01);

    // ---- board: mint top deck, dark base edge, black bindings
    this.board = new THREE.Group();
    this.tilt.add(this.board);
    part(this.board, 0.36, 0.03, 1.25, M.board, 0, 0.005, 0); // top deck
    part(this.board, 0.37, 0.02, 1.26, M.baseEdge, 0, -0.018, 0); // base edge
    for (const z of [-0.66, 0.66]) {
      const tip = part(this.board, 0.32, 0.04, 0.12, M.mint, 0, 0.025, z);
      tip.rotation.x = z > 0 ? -0.45 : 0.45;
    }
    for (const z of [-0.22, 0.22]) {
      part(this.board, 0.3, 0.04, 0.14, M.binding, 0, 0.035, z); // base plate
      part(this.board, 0.32, 0.05, 0.05, M.binding, 0, 0.075, z + 0.03); // strap
      part(this.board, 0.26, 0.12, 0.03, M.highback, 0, 0.1, z - 0.07); // highback
    }

    // the ring keeps its old world size
    const k = OLD_SCALE / ROOT_SCALE;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.42 * k, 0.5 * k, 24).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#ffd59a', transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.ring.position.y = 0.03;
    this.root.add(this.ring);

    this.walkPhase = 0;
    this.time = 0;
    this.goofy = -1; // stance: on the fall line the chest faces +x, toward the lift (right side of the slope)
  }

  /** p: { pose, lean, pitch, spin, edge, tuck } */
  update(dt, p) {
    this.time += dt;
    const { legs, arms, torso, body, tilt, board } = this;
    body.position.set(0, 0, 0);
    body.rotation.set(0, 0, 0);
    torso.rotation.set(0, 0, 0);
    torso.position.y = HIP;
    this.head.rotation.set(0, 0, 0);
    for (const l of legs) { l.rotation.set(0, 0, 0); l.position.set(Math.sign(l.position.x) * 0.1, HIP, 0); }
    for (const a of arms) a.rotation.set(0, 0, 0);
    tilt.rotation.set(0, 0, 0);
    tilt.position.y = 0;
    board.position.set(0, 0.02, 0);
    board.rotation.set(0, 0, 0);
    this.ring.visible = p.pose !== 'lift';
    const stance = -Math.PI / 2 * this.goofy;

    switch (p.pose) {
      case 'walk':
      case 'stand': {
        const moving = p.pose === 'walk';
        if (moving) this.walkPhase += dt * 10;
        const s = moving ? Math.sin(this.walkPhase) * 0.55 : 0;
        legs[0].rotation.x = s;
        legs[1].rotation.x = -s;
        arms[0].rotation.x = -s * 0.8;
        body.position.y = moving ? Math.abs(Math.cos(this.walkPhase)) * 0.035 : 0;
        // big head bobs a little behind the body, like a bobblehead
        this.head.rotation.z = moving ? Math.sin(this.walkPhase) * 0.05 : 0;
        if (!moving) {
          torso.rotation.x = Math.sin(this.time * 1.6) * 0.02;
          this.head.rotation.y = Math.sin(this.time * 0.5) * 0.25;
        }
        // board held upright at the side, like the figurine
        arms[1].rotation.set(0.1, 0, 0.12);
        board.position.set(0.5, 0.72, 0.06); // tail clear of the snow and the plaza paving
        board.rotation.set(Math.PI / 2 - 0.1, 0, -0.14);
        tilt.rotation.x = (p.pitch || 0) * 0.3;
        break;
      }
      case 'ride': {
        body.rotation.y = stance;
        body.position.y = -0.04;
        for (const l of legs) l.position.x = Math.sign(l.position.x) * 0.2;
        torso.rotation.y = 0.5 * this.goofy;
        torso.rotation.x = 0.18 + (p.edge || 0) * 0.25;
        arms[0].rotation.z = -1.0;
        arms[1].rotation.z = 1.0;
        arms[0].rotation.x = arms[1].rotation.x = -0.2;
        this.head.rotation.y = -0.35 * this.goofy; // look down the fall line
        if (p.tuck) { body.position.y = -0.09; torso.rotation.x += 0.35; arms[0].rotation.z = arms[1].rotation.z = 0; }
        tilt.rotation.set(p.pitch || 0, 0, p.lean || 0);
        break;
      }
      case 'air': {
        body.rotation.y = stance;
        body.position.y = 0.08;
        for (const l of legs) { l.position.x = Math.sign(l.position.x) * 0.2; l.rotation.x = -0.6; }
        torso.rotation.y = 0.5 * this.goofy;
        torso.rotation.x = 0.45;
        arms[1].rotation.x = -1.2; // grab
        arms[0].rotation.z = -1.4;
        board.position.y = 0.18;
        tilt.rotation.set(-0.1, 0, p.lean || 0);
        break;
      }
      case 'lift': {
        body.position.y = -0.22;
        for (const l of legs) l.rotation.x = -1.45;
        for (const a of arms) a.rotation.x = -0.6;
        board.position.set(0.1, 0.0, 0.36);
        board.rotation.set(0.2, 0, 0.1);
        break;
      }
      case 'strap': {
        body.rotation.y = stance;
        body.position.y = -0.22;
        for (const l of legs) { l.position.x = Math.sign(l.position.x) * 0.2; l.rotation.x = -1.2; }
        arms[0].rotation.x = arms[1].rotation.x = -1.1;
        torso.rotation.x = 0.4 + Math.sin(this.time * 7) * 0.08;
        break;
      }
      case 'fallen': {
        tilt.rotation.x = -1.35;
        tilt.position.y = 0.2;
        arms[0].rotation.z = -1.3;
        arms[1].rotation.z = 1.3;
        board.position.set(0, 0.0, 0.55);
        break;
      }
    }
  }
}
