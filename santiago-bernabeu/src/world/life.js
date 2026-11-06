import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBuilder, addInstances, addWorldMesh, makeRng, vertexMaterial } from '../core/builder.js';
import { HALF } from '../constants.js';
import { PARKS, PLAZA_LAMPS, PLAZA_TREES, ROADS, roadAxis, roadClearance } from './plan.js';
import { onStadium } from './stadium.js';

const dummy = new THREE.Object3D();
const colorTmp = new THREE.Color();
const LEAF_COLORS = ['#5d9440', '#4f8538', '#6ba347', '#467a36', '#79ad4d'];

// ------------------------------------------------------------------ trees

function makeTreeGeometry() {
  const blob = (x, y, z, r) => {
    const g = new THREE.IcosahedronGeometry(r, 1);
    g.scale(1, 0.86, 1);
    g.translate(x, y, z);
    g.computeVertexNormals();
    const pos = g.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      // One shade per facet: bright on top, deep in the underside.
      const mid = (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3;
      const t = THREE.MathUtils.clamp((mid - (y - r)) / (2 * r), 0, 1);
      colors.fill(0.45 + t * 0.75, i * 3, (i + 3) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.deleteAttribute('uv');
    return g;
  };
  // No end caps: the bottom sits on the ground and the top is buried in the foliage.
  const trunk = new THREE.CylinderGeometry(0.4, 0.55, 3.4, 6, 1, true).toNonIndexed();
  trunk.translate(0, 1.7, 0);
  trunk.computeVertexNormals();
  trunk.setAttribute('color', new THREE.BufferAttribute(new Float32Array(trunk.attributes.position.count * 3).fill(0.26), 3));
  trunk.deleteAttribute('uv');
  return mergeGeometries([trunk, blob(0, 5.4, 0, 3), blob(1.7, 4.5, 0.8, 2.1), blob(-1.4, 4.7, -1, 2.2)]);
}

export class Trees {
  constructor(scene, ground, courtyards) {
    this.ground = ground;
    this.courtyards = courtyards;
    this.rng = makeRng(11);
    this.mesh = new THREE.InstancedMesh(makeTreeGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true }), 1500);
    this.mesh.castShadow = this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.seed();
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  add(x, z, scale) {
    const n = this.mesh.count++;
    this.mesh.setColorAt(n, colorTmp.set(this.rng.pick(LEAF_COLORS)));
    dummy.position.set(x, 0, z);
    dummy.rotation.set(0, this.rng() * Math.PI * 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    this.mesh.setMatrixAt(n, dummy.matrix);
  }

  seedOne(x, z, scale) {
    if (this.ground.isFree(x, z) && !onStadium(x, z) && roadClearance(x, z) >= 2) this.add(x, z, scale);
  }

  line(x0, z0, x1, z1, spacing, scale = 1) {
    const len = Math.hypot(x1 - x0, z1 - z0), r = this.rng;
    for (let t = 0; t <= len; t += spacing) {
      const k = t / len;
      this.seedOne(x0 + (x1 - x0) * k + r.range(-1, 1), z0 + (z1 - z0) * k + r.range(-1, 1), scale * r.range(0.85, 1.25));
    }
  }

  cluster(x, z, radius, count) {
    const r = this.rng;
    for (let n = 0; n < count; n++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * radius;
      this.seedOne(x + Math.cos(a) * d, z + Math.sin(a) * d, r.range(0.9, 1.5));
    }
  }

  /** Street trees stand on the pavement, so they skip the tile checks used for parks. */
  streetRow(road) {
    const r = this.rng;
    const { a, len, dx, dz } = roadAxis(road);
    const offset = road.w / 2 + 1.4;
    const spacing = road.w >= 14 ? 8 : 11;
    for (const side of road.median ? [-1, 0, 1] : [-1, 1]) {
      for (let t = spacing * r(); t < len; t += spacing + r.range(-1.5, 2)) {
        const x = a[0] + dx * t - dz * offset * side, z = a[1] + dz * t + dx * offset * side;
        if (Math.abs(x) > HALF - 2 || Math.abs(z) > HALF - 2 || onStadium(x, z)) continue;
        if (side !== 0 && roadClearance(x, z) < 1) continue; // junctions
        if (r() < 0.14) continue;
        this.add(x, z, r.range(0.62, 0.92));
      }
    }
  }

  seed() {
    const r = this.rng;
    for (const road of ROADS) this.streetRow(road);
    // Double row along the stadium's east side, as in the photo
    this.line(128, -106, 128, 118, 7.5, 1.15);
    this.line(122.5, -70, 122.5, 90, 10, 1);
    this.line(-121.5, -100, -121.5, 100, 13, 0.85);
    this.line(-112, -107.5, 118, -107.5, 8.5, 0.95);
    for (const [x, z, radius] of this.courtyards) {
      this.seedOne(x, z, r.range(0.8, 1.2));
      if (radius > 6) {
        this.seedOne(x + radius * 0.6, z - radius * 0.5, r.range(0.7, 1.1));
        this.seedOne(x - radius * 0.7, z + radius * 0.4, r.range(0.7, 1.1));
      }
    }
    for (const p of PARKS) {
      const n = ((p.x1 - p.x0) * (p.z1 - p.z0)) / 170;
      for (let k = 0; k < n; k++) this.seedOne(r.range(p.x0, p.x1), r.range(p.z0, p.z1), r.range(0.95, 1.5));
    }
    this.cluster(-22, 192, 10, 6);
    this.cluster(78, 212, 9, 5);
    for (const [x, z] of PLAZA_TREES) this.add(x, z, r.range(0.75, 1.3));
  }
}

// ------------------------------------------------------------------ street lamps

export class Lamps {
  constructor(scene) {
    const spots = [...PLAZA_LAMPS];
    for (const road of ROADS) {
      const { a, len, dx, dz } = roadAxis(road);
      const off = road.w / 2 + 1;
      for (let t = 14, side = 1; t < len - 6; t += road.w >= 14 ? 30 : 44, side = -side) {
        const x = a[0] + dx * t - dz * off * side;
        const z = a[1] + dz * t + dx * off * side;
        if (Math.abs(x) < HALF && Math.abs(z) < HALF) spots.push([x, z]);
      }
    }
    const pole = new MeshBuilder();
    for (const [x, z] of spots) pole.box(x, 0, z, 0.55, 7, 0.55, '#3a3d42');
    addWorldMesh(scene, pole.build(), vertexMaterial(), { cast: false, receive: false });

    const at = (y) => spots.map(([x, z]) => [x, y, z]);
    this.headMaterial = new THREE.MeshBasicMaterial({ color: '#55585c' });
    addInstances(scene, new THREE.BoxGeometry(1.1, 0.8, 1.1), this.headMaterial, at(7.2));

    // Pools of light are additive decals on the street. A plain canvas on purpose: makeCanvas's
    // CPU-backed one rasterises this gradient differently, which shows on the lit streets.
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,214,140,1)');
    grad.addColorStop(0.5, 'rgba(255,190,110,0.35)');
    grad.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.glowMaterial = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0,
    });
    this.glows = addInstances(scene, new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2), this.glowMaterial, at(0.25));
    this.glows.renderOrder = 3;
    this.off = new THREE.Color('#55585c');
    this.on = new THREE.Color('#fff0c0').multiplyScalar(1.6);
  }

  update(night) {
    this.headMaterial.color.copy(this.off).lerp(this.on, night);
    this.glowMaterial.opacity = night * 0.42;
    this.glows.visible = night > 0.02;
  }
}
