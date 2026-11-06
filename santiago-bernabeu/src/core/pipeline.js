import * as THREE from 'three';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Everything that makes it read as pixel art lives here: silhouette outlines
// from the depth buffer, ordered dithering and a reduced colour depth.
const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform vec2 resolution;
  uniform float near;
  uniform float far;
  uniform float focusDistance;
  uniform float hazeRange;
  uniform float outlineThreshold;
  uniform vec3 bgTop;
  uniform vec3 bgBottom;
  uniform vec3 tint;
  uniform float saturation;
  uniform float stars;
  uniform float levels;

  float linearDepth(vec2 uv) {
    return near * far / (far - texture2D(tDepth, uv).x * (far - near));
  }

  const vec2 AO_DIRS[8] = vec2[8](
    vec2(1.0, 0.0), vec2(0.7, 0.7), vec2(0.0, 1.0), vec2(-0.7, 0.7),
    vec2(-1.0, 0.0), vec2(-0.7, -0.7), vec2(0.0, -1.0), vec2(0.7, -0.7)
  );

  // Screen-space ambient occlusion: how many samples sit in front of this pixel's plane.
  // Darkens the bases of walls and the street canyons, which is most of what sells depth.
  float ambientOcclusion(vec2 uv, vec2 px, float d, float l, float r, float u, float b) {
    float gx = abs(r - d) < abs(d - l) ? r - d : d - l;
    float gy = abs(u - d) < abs(d - b) ? u - d : d - b;
    float sum = 0.0;
    for (int ring = 0; ring < 2; ring++) {
      float radius = ring == 0 ? 3.0 : 7.0;
      for (int i = 0; i < 8; i++) {
        vec2 offset = AO_DIRS[i] * radius;
        float expected = d + gx * offset.x + gy * offset.y;
        float diff = expected - linearDepth(uv + offset * px);
        sum += smoothstep(0.8, 5.0, diff) * (1.0 - smoothstep(20.0, 60.0, diff));
      }
    }
    return sum / 16.0;
  }

  float bayer4(vec2 p) {
    int x = int(mod(p.x, 4.0));
    int y = int(mod(p.y, 4.0));
    int idx = x + y * 4;
    if (idx == 0) return 0.0;   if (idx == 1) return 8.0;   if (idx == 2) return 2.0;   if (idx == 3) return 10.0;
    if (idx == 4) return 12.0;  if (idx == 5) return 4.0;   if (idx == 6) return 14.0;  if (idx == 7) return 6.0;
    if (idx == 8) return 3.0;   if (idx == 9) return 11.0;  if (idx == 10) return 1.0;  if (idx == 11) return 9.0;
    if (idx == 12) return 15.0; if (idx == 13) return 7.0;  if (idx == 14) return 13.0; return 5.0;
  }

  float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

  void main() {
    vec2 px = 1.0 / resolution;
    float raw = texture2D(tDepth, vUv).x;
    vec3 c;
    vec2 cell = floor(vUv * resolution);

    if (raw >= 0.99999) {
      c = mix(bgBottom, bgTop, smoothstep(0.0, 0.85, vUv.y));
      if (stars > 0.01 && hash(cell) > 0.9975) c += vec3(0.75) * stars * hash(cell + 3.0);
    } else {
      vec3 linear = texture2D(tColor, vUv).rgb;
      float d = linearDepth(vUv);
      float l = linearDepth(vUv - vec2(px.x, 0.0));
      float r = linearDepth(vUv + vec2(px.x, 0.0));
      float u = linearDepth(vUv + vec2(0.0, px.y));
      float b = linearDepth(vUv - vec2(0.0, px.y));
      float edge = step(outlineThreshold, l + r + u + b - 4.0 * d);
      // One-pixel features such as truss members would vanish into their own outline.
      bool thinX = l - d > outlineThreshold && r - d > outlineThreshold;
      bool thinY = u - d > outlineThreshold && b - d > outlineThreshold;
      if (thinX || thinY) edge = 0.0;

      float ao = ambientOcclusion(vUv, px, d, l, r, u, b);
      c = pow(max(linear, vec3(0.0)), vec3(1.0 / 2.2));
      c *= 1.0 - ao * 0.62;
      float g = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(vec3(g), c, saturation) * tint;
      c *= 1.0 - edge * 0.52;
      // Aerial perspective: the far corner of the slab fades slightly into the sky.
      float haze = clamp((d - focusDistance) / hazeRange, 0.0, 1.0);
      c = mix(c, bgTop, haze * 0.2);
    }

    float threshold = (bayer4(cell) + 0.5) / 16.0 - 0.5;
    c = floor(c * levels + threshold + 0.5) / levels;
    gl_FragColor = vec4(c, 1.0);
  }
`;

/** Renders the scene to a low-resolution target, then upscales it with nearest sampling. */
export class PixelPipeline {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.BasicShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.setClearColor(0x000000, 0);

    this.uniforms = {
      tColor: { value: null },
      tDepth: { value: null },
      resolution: { value: new THREE.Vector2(1, 1) },
      near: { value: 1 },
      far: { value: 2 },
      focusDistance: { value: 1 },
      hazeRange: { value: 340 },
      outlineThreshold: { value: 2.6 },
      bgTop: { value: new THREE.Color('#ffffff') },
      bgBottom: { value: new THREE.Color('#dddddd') },
      tint: { value: new THREE.Color('#ffffff') },
      saturation: { value: 1 },
      stars: { value: 0 },
      levels: { value: 30 },
    };
    this.quadScene = new THREE.Scene();
    this.quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    tri.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    const quad = new THREE.Mesh(tri, new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: this.uniforms, depthTest: false, depthWrite: false }));
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  resize(width, height) {
    const dpr = window.devicePixelRatio || 1;
    this.dpr = dpr;
    // Every art pixel must cover the same whole number of device pixels, or some rows and
    // columns come out wider than the rest and one-pixel lines turn into two.
    const block = Math.max(1, Math.round(dpr * (dpr >= 2 ? 1.5 : 2)));
    const w = Math.max(1, Math.ceil(Math.round(width * dpr) / block));
    const h = Math.max(1, Math.ceil(Math.round(height * dpr) / block));
    // The canvas stays at art resolution and CSS does the nearest upscale, so the final pass
    // shades each art pixel once. It may overhang the window by less than one art pixel.
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${(w * block) / dpr}px`;
    this.renderer.domElement.style.height = `${(h * block) / dpr}px`;
    this.target?.depthTexture?.dispose();
    this.target?.dispose();
    this.target = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.HalfFloatType,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(w, h, THREE.UnsignedIntType),
    });
    this.target.depthTexture.minFilter = THREE.NearestFilter;
    this.target.depthTexture.magFilter = THREE.NearestFilter;
    this.uniforms.tColor.value = this.target.texture;
    this.uniforms.tDepth.value = this.target.depthTexture;
    this.uniforms.resolution.value.set(w, h);
  }

  render(scene, camera) {
    this.uniforms.near.value = camera.near;
    this.uniforms.far.value = camera.far;
    this.uniforms.focusDistance.value = camera.position.length();
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCamera);
  }
}
