import * as THREE from 'three';

const tmpColor = new THREE.Color();

/** Seeded PRNG so the city comes out identical on every load. */
export function makeRng(seed = 1) {
  let s = seed >>> 0;
  const rng = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (a, b) => a + (b - a) * rng();
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  return rng;
}

export function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}

/** A canvas texture set up for chunky pixel-art sampling. */
export function pixelTexture(canvas, { repeat = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Adds a mesh spanning the world: it's always in view, so culling would only cost time. */
export function addWorldMesh(scene, geometry, material, { cast = true, receive = true } = {}) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/** Adds one instance of `geometry` at each [x, y, z]. */
export function addInstances(scene, geometry, material, points) {
  const mesh = new THREE.InstancedMesh(geometry, material, points.length);
  const m = new THREE.Matrix4();
  points.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m.makeTranslation(x, y, z)));
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

/**
 * Collects flat-shaded triangles into one non-indexed BufferGeometry.
 * Materials using this are DoubleSide, so winding only has to be self-consistent.
 * A textured mesh keeps UVs and no vertex colours; any other keeps colours and no UVs.
 */
export class MeshBuilder {
  constructor({ textured = false } = {}) {
    this.textured = textured;
    this.p = [];
    this.n = [];
    this.c = [];
    this.uv = [];
  }

  tri(a, b, c, color, ua = [0, 0], ub = [0, 0], uc = [0, 0]) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    const col = tmpColor.set(color);
    for (const [v, t] of [[a, ua], [b, ub], [c, uc]]) {
      this.p.push(v[0], v[1], v[2]);
      this.n.push(nx, ny, nz);
      if (this.textured) this.uv.push(t[0], t[1]);
      else this.c.push(col.r, col.g, col.b);
    }
  }

  /** a,b,c,d in loop order. `uvs` optionally gives one [u,v] per corner. */
  quad(a, b, c, d, color, uvs) {
    const [ua, ub, uc, ud] = uvs || [[0, 0], [0, 0], [0, 0], [0, 0]];
    this.tri(a, b, c, color, ua, ub, uc);
    this.tri(a, c, d, color, ua, uc, ud);
  }

  /** Axis-aligned box (optionally spun around Y) centred on x/z, spanning y0..y1. */
  box(x, y0, z, w, y1, d, color, { rot = 0, top = null } = {}) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const at = (dx, y, dz) => [x + dx * c + dz * s, y, z - dx * s + dz * c];
    const hw = w / 2, hd = d / 2;
    const a = at(-hw, y0, hd), b = at(hw, y0, hd), e = at(hw, y0, -hd), f = at(-hw, y0, -hd);
    const a2 = at(-hw, y1, hd), b2 = at(hw, y1, hd), e2 = at(hw, y1, -hd), f2 = at(-hw, y1, -hd);
    this.quad(a, b, b2, a2, color);
    this.quad(b, e, e2, b2, color);
    this.quad(e, f, f2, e2, color);
    this.quad(f, a, a2, f2, color);
    this.quad(a2, b2, e2, f2, top ?? color);
  }

  /** Beam between two arbitrary points with a square-ish section. */
  beam(p, q, t, color) {
    const dir = new THREE.Vector3(q[0] - p[0], q[1] - p[1], q[2] - p[2]).normalize();
    const up = Math.abs(dir.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const a = new THREE.Vector3().crossVectors(dir, up).normalize().multiplyScalar(t / 2);
    const b = new THREE.Vector3().crossVectors(dir, a).normalize().multiplyScalar(t / 2);
    const corner = (o, sa, sb) => [o[0] + a.x * sa + b.x * sb, o[1] + a.y * sa + b.y * sb, o[2] + a.z * sa + b.z * sb];
    const signs = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
    for (let i = 0; i < 4; i++) {
      const [s0, s1] = signs[i];
      const [s2, s3] = signs[(i + 1) % 4];
      this.quad(corner(p, s0, s1), corner(p, s2, s3), corner(q, s2, s3), corner(q, s0, s1), color);
    }
  }

  /** Vertical cylinder wall from y0 to y1. Optional cap on top; `uvScale` tiles textures by metres. */
  cylinder(x, z, r, y0, y1, seg, color, { cap = null, uvScale = 0, r1 = r } = {}) {
    for (let i = 0; i < seg; i++) {
      const t0 = (i / seg) * Math.PI * 2, t1 = ((i + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      const a = [x + c0 * r, y0, z + s0 * r], b = [x + c1 * r, y0, z + s1 * r];
      const e = [x + c1 * r1, y1, z + s1 * r1], f = [x + c0 * r1, y1, z + s0 * r1];
      let uvs;
      if (uvScale) {
        const u0 = (t0 * r) / uvScale, u1 = (t1 * r) / uvScale;
        uvs = [[u0, y0 / uvScale], [u1, y0 / uvScale], [u1, y1 / uvScale], [u0, y1 / uvScale]];
      }
      this.quad(a, b, e, f, color, uvs);
      if (cap !== null) this.tri([x, y1, z], f, e, cap);
    }
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    if (this.textured) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    else g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

/** Lambert material for vertex-coloured builder geometry. */
export function vertexMaterial(extra = {}) {
  return new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, ...extra });
}
