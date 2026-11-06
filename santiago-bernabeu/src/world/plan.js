import { HALF } from '../constants.js';
import { makeRng } from '../core/builder.js';

// The site plan, traced from the aerial photo: a wide avenue behind the far stand,
// a narrow congested street on the left, a diagonal road and roundabout in front.

export const ROUNDABOUT = { x: -134, z: 205, r: 22 };

export const diagonalZ = (x) => 205 - 0.2926 * (x + 104);
export const DIAGONAL_ROT = Math.atan(0.2926);

export const ROADS = [
  { w: 28, pts: [[-HALF, -128], [HALF, -128]], median: true },
  { w: 14, pts: [[-134, -HALF], [-134, 183]] },
  { w: 10, pts: [[-134, 227], [-134, HALF]] },
  { w: 10, pts: [[140, -114], [140, diagonalZ(140)]] },
  { w: 18, pts: [[-112, diagonalZ(-112)], [HALF, diagonalZ(HALF)]] },
  { w: 10, pts: [[40, -HALF], [40, -142]] },
  { w: 8, pts: [[150, -HALF], [150, -142]] },
  { w: 8, pts: [[-HALF, -40], [-141, -40]] },
  { w: 8, pts: [[-HALF, 46], [-141, 46]] },
  { w: 8, pts: [[-HALF, 126], [-141, 126]] },
  { w: 8, pts: [[-190, -114], [-190, 126]] },
  { w: 8, pts: [[-HALF, 170], [-155, 200]] },
  { w: 8, pts: [[145, -36], [HALF, -36]] },
  { w: 8, pts: [[145, 36], [HALF, 36]] },
  { w: 8, pts: [[192, -114], [192, diagonalZ(192)]] },
  { w: 8, pts: [[-52, diagonalZ(-52)], [-52, HALF]] },
  { w: 8, pts: [[152, diagonalZ(152)], [152, HALF]] },
];

/** A road's endpoints, length and unit direction. */
export function roadAxis(road) {
  const [a, b] = road.pts;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return { a, b, len, dx: (b[0] - a[0]) / len, dz: (b[1] - a[1]) / len };
}

function segmentDistance(px, pz, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(px - a[0] - t * dx, pz - a[1] - t * dz);
}

/** Distance from a point to the nearest road edge (negative = on the road). */
export function roadClearance(x, z) {
  let best = Math.hypot(x - ROUNDABOUT.x, z - ROUNDABOUT.z) - ROUNDABOUT.r;
  for (const road of ROADS) best = Math.min(best, segmentDistance(x, z, road.pts[0], road.pts[1]) - road.w / 2);
  return best;
}

const BRICK = ['brick', 'brick', 'brickDark', 'brickOrange', 'brickBand'];
const MIXED = ['brick', 'brickDark', 'brickOrange', 'brickBand', 'cream', 'beige'];

/**
 * City blocks, packed wall-to-wall by city.js, each stopping at its street's pavement.
 * `rot` turns the block's own frame; base sets the height its skyline steps around.
 */
export const BLOCKS = [
  // West of the stadium: the dense brick quarter
  { x: -217.5, z: -79, w: 42, d: 65, base: 27, styles: BRICK },
  { x: -163.5, z: -79, w: 40, d: 65, base: 33, styles: BRICK },
  { x: -217.5, z: 3, w: 42, d: 73, base: 24, styles: BRICK },
  { x: -163.5, z: 3, w: 40, d: 73, base: 36, styles: BRICK },
  { x: -217.5, z: 86, w: 42, d: 67, base: 27, styles: BRICK },
  { x: -163.5, z: 86, w: 40, d: 67, base: 30, styles: BRICK },
  // South-west, turned to follow the street running into the roundabout
  { x: -192, z: 152, w: 96, d: 40, rot: -0.339, base: 24, styles: BRICK },
  { x: -196, z: 216, w: 84, d: 46, rot: -0.339, base: 21, styles: BRICK },
  { x: -92, z: 232, w: 68, d: 40, rot: DIAGONAL_ROT, base: 18, styles: BRICK },
  // East of the stadium
  { x: 166.5, z: -57.5, w: 38, d: 30, base: 24, styles: MIXED },
  { x: 218.5, z: -77, w: 40, d: 69, base: 33, styles: MIXED },
  { x: 166.5, z: 0, w: 38, d: 59, base: 27, styles: MIXED },
  { x: 218.5, z: 0, w: 40, d: 59, base: 30, styles: MIXED },
  { x: 166.5, z: 77, w: 38, d: 69, base: 24, styles: MIXED },
  { x: 218.5, z: 68, w: 40, d: 51, base: 27, styles: MIXED },
  // Behind the avenue, around the landmarks
  { x: -190, z: -205, w: 96, d: 66, base: 21, styles: MIXED },
  { x: -32, z: -218, w: 128, d: 40, base: 30, styles: MIXED },
  { x: 20, z: -172, w: 26, d: 52, base: 21, styles: BRICK },
  { x: 96, z: -217, w: 100, d: 44, base: 30, styles: MIXED },
  { x: 197, z: -226, w: 84, d: 24, base: 24, styles: MIXED },
  // In front, around the hotel and the church
  { x: 104, z: 222, w: 92, d: 32, base: 18, styles: MIXED },
  { x: 40, z: 226, w: 34, d: 22, base: 15, styles: BRICK },
];

// Footprints kept clear of the block packing, for the landmarks city.js builds by hand.
export const LANDMARK_ZONES = [
  { x0: -233, x1: -195, z0: -227, z1: -189 }, // ribbed tower
  { x0: -186, x1: -134, z0: -222, z1: -172 }, // twin cylinders
  { x0: -238, x1: -144, z0: -172, z1: -146 }, // office slab
  { x0: -100, x1: 8, z0: -196, z1: -148 }, // low hall
  { x0: -41, x1: -3, z0: -238, z1: -210 }, // white slab
  { x0: 47, x1: 93, z0: -194, z1: -150 }, // orange tower
  { x0: 98, x1: 142, z0: -191, z1: -153 }, // banner building
  { x0: 154, x1: 240, z0: -214, z1: -150 }, // ministry
  { x0: 148, x1: 184, z0: -111, z1: -73 }, // grey tower
  { x0: -38, x1: 42, z0: 188, z1: 240 }, // church and house
  { x0: 60, x1: 150, z0: 148, z1: 208 }, // hotel
  { x0: 158, x1: 240, z0: 120, z1: 240 }, // school and yard
];

// The plaza fills the front of the stadium, from its facade to the diagonal road.
export const PLAZA = {
  x: 0, z: 134, x0: -127, x1: 135, z0: 100,
  ringRadius: 30, axisHalfWidth: 9, crossHalfWidth: 5,
};

/** Trees scattered over the plaza, some alone and some in loose groups, clear of the walkways. */
export const PLAZA_TREES = (() => {
  const r = makeRng(1947);
  const spots = [];
  const usable = (x, z) => x > PLAZA.x0 + 4 && x < PLAZA.x1 - 6 && z > PLAZA.z0 + 8
    && roadClearance(x, z) >= 3
    && Math.hypot(x - PLAZA.x, z - PLAZA.z) > PLAZA.ringRadius + 3
    && Math.abs(x - PLAZA.x) > PLAZA.axisHalfWidth + 3
    && Math.abs(z - PLAZA.z) > PLAZA.crossHalfWidth + 3
    && spots.every(([sx, sz]) => Math.hypot(x - sx, z - sz) > 8.5);
  for (let tries = 0; spots.length < 22 && tries < 2000; tries++) {
    const beside = spots.length > 0 && r() < 0.45 ? r.pick(spots) : null;
    const a = r() * Math.PI * 2, d = r.range(9, 15);
    const x = beside ? beside[0] + Math.cos(a) * d : r.range(PLAZA.x0, PLAZA.x1);
    const z = beside ? beside[1] + Math.sin(a) * d : r.range(PLAZA.z0, 190);
    if (usable(x, z)) spots.push([x, z]);
  }
  return spots;
})();

export const PLAZA_LAMPS = [
  ...[-1, 1].flatMap((side) => [108, 118, 152, 160].map((z) => [side * (PLAZA.axisHalfWidth + 1.5), z])),
  ...[-92, -60, 60, 92].flatMap((x) => [PLAZA.z - PLAZA.crossHalfWidth - 1.5, PLAZA.z + PLAZA.crossHalfWidth + 1.5].map((z) => [x, z])),
].filter(([x, z]) => roadClearance(x, z) >= 2);

export const PARKS = [
  { x0: 123, x1: 134, z0: -112, z1: 128 },
  { x0: -125, x1: -98, z0: -238, z1: -146 },
  { x0: 28, x1: 62, z0: 172, z1: 198 },
];
export const COURT = { x0: 186, x1: 238, z0: 176, z1: 238 };
