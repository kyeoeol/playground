/**
 * The world is a 56×105 tile board seen from its bottom corner (a diamond on
 * screen). Corner A (top) is (0, 0) and corner B (right) is (56, 0), so edge
 * AB is z = 0. The mountain ridge runs along AB and the slope falls toward +z.
 *
 * Layout uses two axes:
 *   s – along the fall line: distance from edge AB (= z, 0…105)
 *   w – across the slope: x − 28 (−28 at the A side … +28 at the B side)
 */
export const HALF = 28;

export function toSW(x, z) {
  return { s: z, w: x - HALF };
}

export function fromSW(s, w) {
  return { x: w + HALF, z: s };
}

/** Yaw that makes an object's local +z face down the slope (+s). */
export const FACE_FRONT = 0;
/** Yaw pointing straight down the fall line / straight up it. */
export const DOWNHILL = 0;
export const UPHILL = Math.PI;
