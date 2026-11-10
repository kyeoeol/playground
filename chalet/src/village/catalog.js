import * as THREE from 'three';
import {
  makeCorrala, makeBrickHouse, makeSpireHouse, makeArcadeHouse, makeCasita,
  makeEixample, makeModernista, makeGothic, makeBarceloneta,
  makePlaneTree, makePalm, makeOrangeTree, makeCypress, makeFlowerPots,
  makeMadridLamp, makeBarcelonaLamp, makeParkBench, makeMosaicBench, makeFountain, makeKiosk, makeCafeTable, makeFlowerStall,
  makeLightArch, makeGifts,
} from '../world/spainProps.js';
import { makeXmasTree, makeSnowman } from '../world/villageProps.js';
import { nightGlow } from '../world/props.js';

/*
 * What you can build.
 *  - Houses (session: true): each one is a Claude Code session in one folder.
 *  - Decorations: trees, benches, lamps, ... just for the look of the town.
 * make(v) takes a colour variant; `variants` says how many there are.
 */
const ICON = {
  all: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/></svg>',
  madrid: '<svg viewBox="0 0 24 24"><path d="M4 20V10l4-2 4 2v10"/><path d="M12 20v-8h8v8"/><path d="M8 8V4.5"/><path d="M3 20h18"/><path d="M14.5 15h3"/></svg>',
  bcn: '<svg viewBox="0 0 24 24"><path d="M5 20V8.5c0-2 1.5-3.5 3.5-3.5S12 6.5 12 8.5V20"/><path d="M12 20v-7c0-1.7 1.3-3 3-3h0c1.7 0 3 1.3 3 3v7"/><path d="M3 20h18"/></svg>',
  nature: '<svg viewBox="0 0 24 24"><path d="M12 21v-6"/><path d="M12 3.5c3.6 0 6 2.8 6 6.2 0 3-2.4 5.3-6 5.3s-6-2.3-6-5.3c0-3.4 2.4-6.2 6-6.2z"/></svg>',
  street: '<svg viewBox="0 0 24 24"><path d="M9 21V7.5"/><path d="M9 7.5c0-2 1.4-3.5 3.5-3.5S16 5.5 16 7.5"/><path d="M14 9.5h4l-.7 2.5h-2.6z"/><path d="M6.5 21h5"/></svg>',
  festive: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2 4 4.3.6-3.1 3 .7 4.3L12 13.4l-3.9 2 .7-4.3-3.1-3 4.3-.6z"/><path d="M12 16.5V21"/></svg>',
};

export const CATEGORIES = [
  { id: 'all', label: 'All', icon: ICON.all },
  { id: 'madrid', label: 'Madrid', icon: ICON.madrid },
  { id: 'bcn', label: 'Barcelona', icon: ICON.bcn },
  { id: 'nature', label: 'Nature', icon: ICON.nature },
  { id: 'street', label: 'Street', icon: ICON.street },
  { id: 'festive', label: 'Festive', icon: ICON.festive },
];

// Placed builds carry no real lights: each new light recompiles every material in the
// scene (a visible hitch), and many of them slow every frame. Their bulbs still glow.
function dropLights(g) {
  const lights = [];
  g.traverse((o) => o.isLight && lights.push(o));
  for (const l of lights) {
    l.removeFromParent();
    const i = nightGlow.lights.findIndex((e) => e.light === l);
    if (i >= 0) nightGlow.lights.splice(i, 1);
  }
  return g;
}

const xmasTree = () => {
  const g = dropLights(makeXmasTree());
  g.scale.setScalar(0.85);
  g.userData.footprint = { w: 3.4, d: 3.4 };
  return g;
};
const snowman = () => {
  const g = makeSnowman();
  g.userData.footprint = { w: 0.9, d: 0.9 };
  return g;
};

const H = (id, cat, name, desc, make, variants) => ({ id, cat, name, desc, make, variants, session: true });
const D = (id, cat, name, desc, make, variants = 1) => ({ id, cat, name, desc, make, variants, session: false });

export const CATALOG = [
  // Madrid
  H('mad-corrala', 'madrid', 'Corrala tenement', 'Iron balconies, green shutters, tiled roof', makeCorrala, 4),
  H('mad-brick', 'madrid', 'Red brick house', 'Neo-Mudéjar arches, sawtooth parapet', makeBrickHouse, 3),
  H('mad-spire', 'madrid', 'Spire mansion', 'Two slate spires, granite corners', makeSpireHouse, 2),
  H('mad-arcade', 'madrid', 'Plaza arcade house', 'A small shop under an arcade', makeArcadeHouse, 4),
  H('mad-casita', 'madrid', 'White casita', 'Window grilles, geraniums in blue pots', makeCasita, 4),
  // Barcelona
  H('bcn-eixample', 'bcn', 'Eixample apartments', 'Cut-corner block, rooftop terrace', makeEixample, 4),
  H('bcn-modernista', 'bcn', 'Modernisme house', 'Trencadís mosaic and a domed roof', makeModernista, 3),
  H('bcn-gothic', 'bcn', 'Gothic Quarter stone house', 'Arched doorway and a small bell tower', makeGothic, 3),
  H('bcn-barceloneta', 'bcn', 'Barceloneta narrow house', 'Pastel walls, laundry on the balcony', makeBarceloneta, 4),
  // decorations
  D('plane-tree', 'nature', 'Plane tree', 'Winter street tree, mottled trunk', makePlaneTree, 3),
  D('palm', 'nature', 'Palm tree', 'Snow-covered Canary palm', makePalm, 3),
  D('orange-tree', 'nature', 'Orange tree', 'Oranges in a terracotta pot', makeOrangeTree),
  D('cypress', 'nature', 'Cypress', 'Tall, slim evergreen', makeCypress, 3),
  D('flower-pots', 'nature', 'Flower pots', 'A cluster of geranium pots', makeFlowerPots, 3),
  D('lamp-madrid', 'street', 'Madrid streetlamp', 'Cast-iron post, square lantern', makeMadridLamp),
  D('lamp-bcn', 'street', 'Barcelona streetlamp', 'Mosaic base, two-arm lantern', makeBarcelonaLamp),
  D('bench-park', 'street', 'Park bench', 'Wooden seat, cast-iron legs', makeParkBench),
  D('bench-mosaic', 'street', 'Mosaic bench', 'Wavy trencadís bench', makeMosaicBench, 2),
  D('fountain', 'street', 'Fountain', 'Frozen granite fountain', makeFountain),
  D('kiosk', 'street', 'Newsstand', 'Green iron kiosk', makeKiosk),
  D('cafe-table', 'street', 'Café terrace', 'Table and chairs under a parasol', makeCafeTable, 4),
  D('flower-stall', 'street', 'Flower stall', 'A flower stand from La Rambla', makeFlowerStall),
  D('xmas-tree', 'festive', 'Christmas tree', 'The star turns slowly', xmasTree),
  D('light-arch', 'festive', 'Light arch', 'Christmas lights over the street', makeLightArch, 3),
  D('snowman', 'festive', 'Snowman', 'Carrot nose and scarf', snowman),
  D('gifts', 'festive', 'Gift pile', 'Presents stacked on the snow', makeGifts, 3),
];

/** Old saved types (from before the Spanish town) open as a house of the same size. */
const LEGACY = { 'cabin-red': 'mad-casita', 'cabin-orange': 'mad-casita', 'cabin-teal': 'mad-casita', 'cabin-slate': 'mad-casita', chalet: 'mad-corrala', lodge: 'mad-spire', shop: 'mad-arcade', cafe: 'bcn-gothic', bakery: 'bcn-barceloneta', greenhouse: 'mad-casita', barn: 'mad-brick', chapel: 'bcn-gothic' };

export const byId = (id) => CATALOG.find((c) => c.id === (LEGACY[id] || id));

/** Footprint (w across, d along) after a turn of rot (a multiple of 90°). */
export function footprintOf(obj, rot) {
  const fp = obj.userData.footprint || { w: 3, d: 3 };
  const s = obj.scale.x;
  const odd = Math.round(rot / (Math.PI / 2)) % 2 !== 0;
  return odd ? { w: fp.d * s, d: fp.w * s } : { w: fp.w * s, d: fp.d * s };
}

/**
 * Small pixel-art pictures of every build, for the build menu. Rendered once with a
 * throwaway renderer at a low resolution; CSS scales them up with crisp pixels.
 */
export function renderThumbnails(size = 64) {
  const out = {};
  let r;
  try {
    r = new THREE.WebGLRenderer({ antialias: false, alpha: true, preserveDrawingBuffer: true });
  } catch {
    return out;
  }
  r.setPixelRatio(1);
  r.setSize(size, size, false);
  r.toneMapping = THREE.NeutralToneMapping;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#ffffff', '#8aa0b4', 1.6));
  const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(4, 8, 6);
  scene.add(sun);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const dir = new THREE.Vector3(1, Math.sqrt(2 / 3), 1).normalize(); // the game's view angle
  const box = new THREE.Box3(), sphere = new THREE.Sphere();
  for (const item of CATALOG) {
    const obj = item.make(0);
    scene.add(obj);
    box.setFromObject(obj).getBoundingSphere(sphere);
    const R = sphere.radius * 0.86;
    Object.assign(cam, { left: -R, right: R, top: R, bottom: -R });
    cam.updateProjectionMatrix();
    cam.position.copy(sphere.center).addScaledVector(dir, 50);
    cam.lookAt(sphere.center);
    r.render(scene, cam);
    out[item.id] = r.domElement.toDataURL();
    scene.remove(obj);
  }
  r.dispose();
  r.forceContextLoss?.();
  return out;
}
