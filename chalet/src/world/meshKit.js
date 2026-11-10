import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Builds detailed props (lattice towers, chairs, machines) out of many small boxes and
 * cylinders, then merges them into one mesh per material, so a tower with 150 members
 * is still only a few draw calls.
 *
 * Colours become flat, untextured materials: the 16-bit look comes from 2–3 clean
 * tones per surface (top / side / shadow side) and the post pass outlines.
 */

/** Indexed mesh geometry from flat position / uv / index arrays, with smooth normals. */
export function indexedGeo(pos, uv, idx) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const flatCache = new Map();
/** Flat-shaded, untextured material for one colour. */
export function flat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!flatCache.has(key)) {
    flatCache.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, flatShading: true, ...opts }));
  }
  return flatCache.get(key);
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1);

export class Kit {
  constructor() {
    this.parts = new Map(); // material -> geometries
  }

  /** File a placed geometry under its material; all parts share one attribute layout for merging. */
  _push(material, g) {
    const m = material.isMaterial ? material : flat(material);
    if (!this.parts.has(m)) this.parts.set(m, []);
    this.parts.get(m).push(g.index ? g.toNonIndexed() : g);
    return this;
  }

  /** Add a geometry, placed by position and Euler rotation (radians). */
  geo(material, g, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _e.set(rx, ry, rz);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s);
    g.applyMatrix4(_m);
    return this._push(material, g);
  }

  box(material, w, h, d, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    return this.geo(material, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz);
  }

  /** A straight bar of square section w from point a to point b. */
  bar(material, w, a, b) {
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const g = new THREE.BoxGeometry(w, len, w);
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    _m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s);
    g.applyMatrix4(_m);
    return this._push(material, g);
  }

  /** Cylinder with its axis along x, y or z. */
  cyl(material, r, len, axis, x = 0, y = 0, z = 0, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    const rot = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
    return this.geo(material, g, x, y, z, ...rot);
  }

  /** One mesh per material, added to a new group (or the given one). */
  build(group = new THREE.Group(), { shadow = true } = {}) {
    for (const [m, list] of this.parts) {
      const merged = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(merged, m);
      mesh.castShadow = shadow;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    this.parts.clear();
    return group;
  }
}
