import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPixelatedPass } from 'three/addons/postprocessing/RenderPixelatedPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { StylePass } from './render/StylePass.js';
import { RiderLayer, RIDER_LAYER } from './render/RiderLayer.js';
import { Present } from './render/Present.js';
import { Clock } from './core/Clock.js';
import { World } from './world/World.js';
import { W, D, BOTTOM } from './world/Terrain.js';
import { Player } from './agents/Player.js';
import { UI } from './ui/UI.js';
import { Village } from './village/Village.js';
import { VillageUI } from './village/VillageUI.js';

/*
 * Pixel-art rendering on one clean grid:
 *  - The scene renders at "art" resolution (one buffer pixel = one art pixel) and Present
 *    scales it up by a whole number of device pixels. No pixel comes out wider than its
 *    neighbour.
 *  - Fixed scale, like a 16-bit game: one world unit (tile) is 16 art pixels, and one art
 *    pixel is 3 CSS px (2 on short windows). The camera follows the avatar. The zoom
 *    buttons step out to the whole map one level at a time, at scales where the textures'
 *    texels land on whole art pixels (see zoom levels).
 *  - The camera snaps to the art lattice. The sub-pixel remainder moves the picture by whole
 *    device pixels (Present), so panning is smooth and static edges do not crawl.
 *  - The avatar on the lift and its chair are drawn apart, with a camera of their own
 *    (RiderLayer), so they neither crawl nor shake while the slope scrolls past.
 *  - View: 30° above the horizon, where ground edges step 2 across, 1 up. The angle is
 *    fixed; a left drag pans, F (or the dock button) goes back to the avatar.
 */
const VIEW_DIR = new THREE.Vector3(1, Math.sqrt(2 / 3), 1).normalize(); // 30° elevation, 45° azimuth
const CAM_DIST = 300;
const MARGIN = 1; // spare art pixels around the canvas, for the sub-pixel shift
const pxCss = () => (innerHeight >= 720 ? 3 : 2); // on-screen art pixel size, CSS px
const OVERVIEW_PX = 2; // art pixel size in the whole-map view, CSS px
const UI_TOP = 92, UI_BOTTOM = 112, UI_SIDE = 24; // CSS px kept clear in the whole-map view
const SCENE_TOP = 37; // the summit
const dpr = () => window.devicePixelRatio || 1;

// ---- renderer ---------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); // the buffer is the art grid; CSS does the integer upscale
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.BasicShadowMap; // hard-edged shadows, like hand-drawn pixel art
renderer.toneMapping = THREE.NeutralToneMapping; // keeps the paper-white backdrop white
renderer.toneMappingExposure = 1.0;
const canvas = renderer.domElement;
Object.assign(canvas.style, { position: 'fixed', left: '0px', top: '0px' });
document.getElementById('app').appendChild(canvas);

// ---- scene & camera -----------------------------------------------------------
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 1000);
// the camera as the last frame was drawn (snapped to the art lattice, see snapCamera): name
// tags and clicks go through this one, so they sit still on the picture while it scrolls
const shownCamera = camera.clone();
scene.add(camera); // the sky card and stars are parented to the camera

const clock = new Clock(9);
const world = new World(scene, camera, clock);
const player = new Player(world);
scene.add(player.model.root);

// Orbiting can put a tree or a roof between the camera and the avatar. Each avatar mesh
// gets a twin that draws only where it is hidden, as a flat silhouette, so you never
// lose yourself behind the scenery:
//  - the visible avatar marks its pixels in the stencil buffer (ref 1)
//  - the twin draws where the depth test fails (something is in front) and the pixel
//    is not the avatar itself, so the avatar's own back parts never tint its front.
/** The avatar's own meshes (not the ghost twins): they move to the rider layer on the lift. */
const avatarMeshes = [];
player.model.root.traverse((o) => o.isMesh && avatarMeshes.push(o));
{
  const ghost = new THREE.MeshBasicMaterial({
    color: '#e5483b', transparent: true, opacity: 0.5, depthWrite: false, depthFunc: THREE.GreaterDepth,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
  });
  const own = new Map(); // avatar-only copies of shared materials
  const meshes = [];
  player.model.root.traverse((o) => o.isMesh && o.visible && o.material.visible && !o.material.transparent && meshes.push(o));
  for (const m of meshes) {
    if (!own.has(m.material)) {
      const c = m.material.clone();
      Object.assign(c, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
      own.set(m.material, c);
    }
    m.material = own.get(m.material);
    const twin = new THREE.Mesh(m.geometry, ghost);
    twin.renderOrder = 10;
    twin.castShadow = twin.receiveShadow = false;
    m.add(twin);
  }
}

const axR = new THREE.Vector3(), axU = new THREE.Vector3(), axF = new THREE.Vector3();
function readAxes() {
  camera.updateMatrixWorld();
  axR.setFromMatrixColumn(camera.matrixWorld, 0);
  axU.setFromMatrixColumn(camera.matrixWorld, 1);
  axF.setFromMatrixColumn(camera.matrixWorld, 2);
}

/** The diorama box in camera axes (world units): size and centre. */
function diorama() {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], p = new THREE.Vector3();
  for (const x of [0, W]) for (const y of [BOTTOM, SCENE_TOP]) for (const z of [0, D]) {
    p.set(x, y, z);
    [p.dot(axR), p.dot(axU), p.dot(axF)].forEach((v, i) => { lo[i] = Math.min(lo[i], v); hi[i] = Math.max(hi[i], v); });
  }
  const mid = (i) => (lo[i] + hi[i]) / 2;
  return {
    w: hi[0] - lo[0], h: hi[1] - lo[1],
    center: new THREE.Vector3().addScaledVector(axR, mid(0)).addScaledVector(axU, mid(1)).addScaledVector(axF, mid(2)),
  };
}
/** Zoom is in CSS px per world unit. */
const fitZoom = (box) => Math.min((innerWidth - 2 * UI_SIDE) / box.w, (innerHeight - UI_TOP - UI_BOTTOM) / box.h);
// ---- zoom levels --------------------------------------------------------------------
// The zoom buttons move one level per click, with no animation: a smooth zoom renders
// the art grid at a new scale on every frame, so every edge and texel crawls.
// Level 0 is the closest view (16-pixel tiles), ZOOM_MAX the whole map fitted to the window.
// Textures have 16 texels per world unit, so the levels between use 16, 8 or 4 art pixels
// per unit: one, two or four texels on every art pixel (and mip levels 0, 1, 2 line up), so
// no texel comes out wider than its neighbour. Between those, the art pixel itself shrinks
// from pxCss to OVERVIEW_PX: 48 / 32 / 24 / 16 / 12 / 8 CSS px per unit on a normal window.
const ZOOM_MAX = 6;
const ZOOM_START = 1; // the default view: one step out from the closest level
let zoomLevel = ZOOM_START;
const wholeMap = () => zoomLevel === ZOOM_MAX;
/** The levels below the whole map: { art: art px per world unit, px: device px per art px, zoom }. */
function ladder() {
  const near = Math.max(1, Math.round(pxCss() * dpr()));
  let far = Math.max(1, Math.round(OVERVIEW_PX * dpr()));
  if (far >= near) far = Math.max(1, Math.round((near * 2) / 3)); // short windows: still two sizes
  const steps = [];
  for (const art of [16, 8, 4, 2]) for (const p of [near, far]) steps.push({ art, px: p, zoom: (art * p) / dpr() });
  // closest first; where two give the same zoom, keep the bigger art pixel
  steps.sort((a, b) => b.zoom - a.zoom || b.px - a.px);
  const out = steps.filter((s, i) => i === 0 || s.zoom !== steps[i - 1].zoom).slice(0, ZOOM_MAX);
  while (out.length < ZOOM_MAX) out.push(out[out.length - 1]);
  return out;
}
const zoomAt = (level, box) => (level >= ZOOM_MAX ? fitZoom(box) : ladder()[level].zoom);
const pxFor = (level) => (level >= ZOOM_MAX ? Math.max(1, Math.round(OVERVIEW_PX * dpr())) : ladder()[level].px);
let zoom = ladder()[0].zoom;
const _follow = new THREE.Vector3();
const followPoint = () => _follow.set(player.pos.x, player.pos.y + 0.8, player.pos.z);

// start on the avatar, at the fixed angle
camera.position.copy(followPoint()).addScaledVector(VIEW_DIR, CAM_DIST);
camera.lookAt(followPoint());
readAxes();

const controls = new OrbitControls(camera, canvas);
controls.target.copy(followPoint());
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.enableRotate = false; // fixed isometric angle
controls.enableZoom = false; // fixed pixel scale
controls.screenSpacePanning = true;
controls.keys = {}; // keyboard belongs to the avatar
// left drag (or one finger) pans; the other buttons do nothing
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: null, RIGHT: null };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: null };
controls.update();

// ---- post: pixel art ------------------------------------------------------------
const composer = new EffectComposer(renderer);
const pixelPass = new RenderPixelatedPass(1, scene, camera, { normalEdgeStrength: 0.35, depthEdgeStrength: 0 }); // light ridge lines on convex edges; outlines: StylePass
pixelPass._beautyRenderTarget.texture.type = THREE.HalfFloatType; // avoid banding at night
// stencil for the avatar silhouette (see above)
pixelPass._beautyRenderTarget.stencilBuffer = true;
pixelPass._beautyRenderTarget.depthTexture.format = THREE.DepthStencilFormat;
pixelPass._beautyRenderTarget.depthTexture.type = THREE.UnsignedInt248Type;
composer.addPass(pixelPass);
// No ambient occlusion: its soft, noisy halo turned into grey speckles around everything
// standing on the snow. Contact reads from the sun's hard shadows and the outlines.
// farm-sim pixel-art look: selective outlines, hue-shifted shading, colour steps
const stylePass = new StylePass(camera, pixelPass._beautyRenderTarget.depthTexture);
composer.addPass(stylePass);
composer.addPass(new OutputPass());
composer.renderToScreen = false; // Present puts it on the screen
// the avatar on the lift and its chair (see RiderLayer); they still cast their shadows
const riderLayer = new RiderLayer(renderer, scene, stylePass);
world.env.sun.shadow.camera.layers.enable(RIDER_LAYER);
// the scene's lights (sky, sun, snowcat) light the rider too; placed builds carry no lights (catalog.js)
scene.traverse((o) => { if (o.isLight) o.layers.enable(RIDER_LAYER); });
const present = new Present();

// ---- art buffer ---------------------------------------------------------------------
let mode = 'follow'; // camera mode, see below
let px = 0; // device px per art pixel (integer)
let artW = 0, artH = 0, layoutKey = '';
/** world units per art pixel */
const art = () => px / (zoom * dpr());

function layout() {
  px = pxFor(zoomLevel); // see zoom levels
  const key = `${px}|${innerWidth}|${innerHeight}|${dpr()}`;
  if (key !== layoutKey) {
    layoutKey = key;
    const r = dpr();
    artW = Math.ceil((innerWidth * r) / px) + 2 * MARGIN;
    artH = Math.ceil((innerHeight * r) / px) + 2 * MARGIN;
    renderer.setSize(artW * px, artH * px, false); // device pixels: Present scales the art up
    composer.setSize(artW, artH);
    riderLayer.setSize(artW, artH);
    canvas.style.width = `${(artW * px) / r}px`;
    canvas.style.height = `${(artH * px) / r}px`;
    // the spare art pixels hang off the top left; the sub-pixel shift happens in Present
    canvas.style.left = canvas.style.top = `${(-MARGIN * px) / r}px`;
  }
  const a = art();
  camera.left = (-artW * a) / 2;
  camera.right = (artW * a) / 2;
  camera.top = (artH * a) / 2;
  camera.bottom = (-artH * a) / 2;
  camera.zoom = 1;
  camera.updateProjectionMatrix();
}
layout();

// ---- camera modes -------------------------------------------------------------------
// 'follow': keep the avatar in the middle of the window
// 'free'  : the user panned (left drag); stay put until F or a move key
// At the last zoom level (the whole map) the camera holds the map in the middle instead,
// and dragging is off. Move keys do not change the zoom.
function setMode(m) {
  mode = m;
}
function setZoom(d) {
  const was = wholeMap();
  zoomLevel = Math.min(ZOOM_MAX, Math.max(0, zoomLevel + d));
  controls.enablePan = !wholeMap(); // no dragging in the whole-map view
  if (was && !wholeMap()) setMode('follow'); // out of the whole map: back to the avatar
  ui.setZoom(zoomLevel, ZOOM_MAX);
}
const ui = new UI({
  clock, world, player,
  onZoom: setZoom,
  onRestart: () => { if (player.respawn() !== false) setMode('follow'); },
});
ui.setZoom(zoomLevel, ZOOM_MAX);

// ---- the village: builds on the map, each one a Claude Code session in a folder ----------
const villageUI = new VillageUI({ onMenu: () => ui.closePanels() });
const village = new Village({
  world, player, scene, camera: shownCamera, canvas,
  tagLayer: villageUI.tagLayer,
  onOpen: (id) => { ui.closePanels(); villageUI.openChat(id); }, // the camera stays where it is
  onDecor: (id) => { ui.closePanels(); villageUI.openDecor(id); },
  onChange: (id) => villageUI.changed(id),
  toast: (t) => ui.toast(t),
});
villageUI.village = village;
// the sky and help panels share the bottom of the screen with the build menu
for (const id of ['b-sky', 'b-help']) document.getElementById(id).addEventListener('click', () => villageUI.toggleMenu(false));
// the hint's Space button does what the key does
document.getElementById('acts').addEventListener('click', (e) => {
  const near = e.target.closest('[data-key="Space"]') && village.nearHouse();
  if (near) villageUI.openAsk(near);
});

// the wheel does nothing (and does not scroll the page)
canvas.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });

// a left drag pans and leaves the follow view; a plain click does not
let dragFrom = null;
canvas.addEventListener('pointerdown', (e) => { if (e.button === 0) { dragFrom = { x: e.clientX, y: e.clientY }; } });
canvas.addEventListener('pointermove', (e) => {
  // no panning in the whole-map view
  if (dragFrom && mode === 'follow' && !wholeMap() && Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) > 3) setMode('free');
  village.pointerMove(e);
  if (!village.placing && !dragFrom) canvas.style.cursor = village.pick(e) ? 'pointer' : '';
});
// a click (no drag) places the build being placed, or opens the build under the pointer
canvas.addEventListener('pointerup', (e) => {
  if (e.button !== 0 || !dragFrom || Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) > 4) return;
  villageUI.toggleMenu(false);
  villageUI.closeDecor();
  village.click(e);
});
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); village.cancel(); });
addEventListener('pointerup', () => { dragFrom = null; });

// ---- input -------------------------------------------------------------------
const keys = new Set();
const MOVE_KEYS = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright']; // arrow keys only
/**
 * Key name from the physical key (e.code), so shortcuts work in any input language:
 * with a non-Latin input source (Korean, Russian, ...), the E key types another letter but its code is still 'KeyE'.
 */
function keyName(e) {
  const c = e.code || '';
  if (c.startsWith('Key')) return c.slice(3).toLowerCase(); // KeyE -> 'e'
  if (c === 'Space') return ' ';
  if (c.startsWith('Arrow') || c === 'Escape') return c.toLowerCase();
  if (c.startsWith('Shift')) return 'shift';
  return e.key.toLowerCase();
}
addEventListener('keydown', (e) => {
  if (document.getElementById('ui').classList.contains('modal')) return; // a dialog has the keyboard
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) {
    if (e.key === 'Escape' && !e.isComposing) e.target.blur();
    return;
  }
  const k = keyName(e);
  if (village.placing && (k === 'r' || k === 'c' || k === 'escape')) {
    if (k === 'r' && !e.repeat) village.rotate();
    if (k === 'c' && !e.repeat) village.cycleVariant();
    if (k === 'escape') village.cancel();
    return;
  }
  if ([...MOVE_KEYS, ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (MOVE_KEYS.includes(k) && mode !== 'follow') setMode('follow'); // walking brings the camera back
  if (e.repeat) return;
  if (k === 'e') player.action(); // lift
  if (k === ' ') {
    // by a house, Space opens the prompt bar for it; on the board it jumps
    const near = player.state === 'walk' && !village.placing && !villageUI.openId && village.nearHouse(); // not while the chat is open
    if (near) villageUI.openAsk(near);
    else player.jump();
  }
  if (k === 'r') player.respawn();
  if (k === 'f') setMode('follow'); // back to the avatar
  if (k === 'escape') { ui.closePanels(); villageUI.toggleMenu(false); villageUI.closeChat(); villageUI.closeDecor(); }
});
addEventListener('keyup', (e) => keys.delete(keyName(e)));
addEventListener('blur', () => keys.clear());

const fwd = new THREE.Vector3();
const right = new THREE.Vector3();
function readInput() {
  const up = keys.has('arrowup');
  const down = keys.has('arrowdown');
  const left = keys.has('arrowleft');
  const rightK = keys.has('arrowright');
  // camera-relative walking directions on the ground plane
  camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  right.set(-fwd.z, 0, fwd.x);
  const f = (up ? 1 : 0) - (down ? 1 : 0);
  const r = (rightK ? 1 : 0) - (left ? 1 : 0);
  return {
    mx: fwd.x * f + right.x * r,
    mz: fwd.z * f + right.z * r,
    steer: r,
    push: up,
    brake: down,
    run: keys.has('shift'),
  };
}

addEventListener('resize', () => layout());

// ---- camera snap ------------------------------------------------------------------
const logical = new THREE.Vector3();
/** Move the camera onto the art lattice; return the remainder in art pixels. */
function snapCamera() {
  logical.copy(camera.position);
  const a = art();
  const ra = logical.dot(axR) / a, rb = logical.dot(axU) / a;
  const fa = ra - Math.round(ra), fb = rb - Math.round(rb);
  camera.position.addScaledVector(axR, -fa * a).addScaledVector(axU, -fb * a);
  camera.updateMatrixWorld();
  return { fa, fb };
}
/**
 * The shift that puts world point p on the art lattice (whole art pixels along the screen
 * axes). The camera snap keeps still things steady; moving things (the lift chairs) use
 * this so their edges do not crawl. Returns a reused vector.
 */
const _latticeD = new THREE.Vector3();
function latticeDelta(p) {
  const a = art();
  const r = p.dot(axR) / a, u = p.dot(axU) / a;
  return _latticeD.copy(axR).multiplyScalar((Math.round(r) - r) * a).addScaledVector(axU, (Math.round(u) - u) * a);
}
/*
 * The avatar on the lift and its chair go to the rider layer (RiderLayer): they leave the
 * world picture, which keeps casting their shadows (the sun's shadow camera sees both layers).
 * The ghost twins stay on layer 0, so the world picture still shows the avatar's
 * silhouette where the scenery hides it.
 */
let riderChair = null; // the chair now on the rider layer
function setRiderLayer(chair) {
  if (chair === riderChair) return;
  const layer = chair ? RIDER_LAYER : 0;
  for (const m of avatarMeshes) m.layers.set(layer);
  riderChair?.mesh.traverse((o) => o.layers.set(0));
  chair?.mesh.traverse((o) => o.layers.set(RIDER_LAYER));
  riderChair = chair;
}

// ---- loop -----------------------------------------------------------------------
const followDelta = new THREE.Vector3();
let last = performance.now();
let realTime = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  realTime += dt;

  const simDt = dt * ui.timeScale;
  const steps = Math.max(1, Math.ceil(simDt / 0.1));
  for (let i = 0; i < steps; i++) {
    clock.update(simDt / steps);
    world.update(simDt / steps);
  }
  player.update(dt, readInput());

  // the zoom level, and where the camera looks: the avatar, or the middle of the map
  const box = diorama();
  zoom = zoomAt(zoomLevel, box);
  if (wholeMap()) {
    const goal = box.center.addScaledVector(axU, (UI_BOTTOM - UI_TOP) / 2 / zoom);
    followDelta.copy(goal).sub(controls.target).multiplyScalar(Math.min(1, dt * 5));
  } else if (mode === 'follow') {
    followDelta.copy(followPoint()).sub(controls.target).multiplyScalar(Math.min(1, dt * 6));
  } else followDelta.set(0, 0, 0);
  controls.target.add(followDelta);
  camera.position.add(followDelta);
  controls.update();
  readAxes();
  layout();

  const rem = snapCamera();
  shownCamera.copy(camera);
  world.env.focus.copy(controls.target);
  world.env.artSize = art(); // the shadow box scales with the zoom
  world.env.update(clock.hour, dt, realTime);
  setRiderLayer(player.state === 'lift' ? world.lift.chairOf(player) : null);
  world.lift.snapToLattice(latticeDelta, riderChair); // the rider's chair keeps its true place
  composer.render();
  world.lift.unsnap();
  let rider = null;
  if (riderChair) {
    const r = riderLayer.render(camera, logical, riderChair.mesh.position, axR, axU, art());
    rider = { texture: riderLayer.texture, depth: riderLayer.depth, ...r };
  }
  camera.position.copy(logical);
  camera.updateMatrixWorld();
  present.render(renderer, px, { texture: composer.readBuffer.texture, depth: pixelPass._beautyRenderTarget.depthTexture, ...rem }, rider);
  // by a house: its name and the Space key in the hint above the dock (not while the chat is open)
  const near = player.state === 'walk' && !village.placing && !villageUI.asking && !villageUI.openId ? village.nearHouse() : null;
  if (near) { player.hint = village.get(near).name; player.actions.push({ key: 'Space', label: '' }); } // just the key, beside the house's name
  ui.update(dt);
  village.update(dt);
  villageUI.update();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// handy for poking at the simulation from the console
Object.assign(window, {
  world, clock, camera, controls, ui, player, keys, stylePass, riderLayer, village, villageUI,
  view: { get zoom() { return zoom; }, get zoomLevel() { return zoomLevel; }, get px() { return px; }, get mode() { return mode; }, art, setMode, setZoom },
});
