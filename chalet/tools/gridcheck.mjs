// Pixel-grid check for a screenshot (PNG), after the "find the real grid" method:
//  1. edge profile: per column, how much the colour changes from the previous column
//  2. comb / Fourier: which spacing fits the edge spikes best -> the real block size
//  3. regularity: in a clean integer upscale every same-colour run is a multiple of
//     the block size; runs that are not mean blocks got doubled or dropped.
// usage: node tools/gridcheck.mjs shot.png [x0 y0 x1 y1]
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

function decodePNG(buf) {
  let p = 8, w, h, ct, bd, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; if (d[12]) throw new Error('interlaced PNG'); }
    if (type === 'IDAT') idat.push(d);
    if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8 || (ct !== 2 && ct !== 6)) throw new Error(`unsupported PNG (bit depth ${bd}, colour type ${ct})`);
  const bpp = ct === 6 ? 4 : 3, stride = w * bpp, raw = inflateSync(Buffer.concat(idat));
  const out = new Uint8Array(w * h * 3), prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) out[(y * w + x) * 3 + k] = cur[x * bpp + k];
    prev.set(cur);
  }
  return { w, h, px: out };
}

const [file, ...box] = process.argv.slice(2);
const img = decodePNG(readFileSync(file));
const [x0, y0, x1, y1] = box.length === 4 ? box.map(Number) : [0, 0, img.w, img.h];
const at = (x, y) => (y * img.w + x) * 3;
const TOL = Number(process.env.TOL ?? 6); // ignore 1–2 step noise (browser dithering)
const rawDiff = (i, j) => Math.abs(img.px[i] - img.px[j]) + Math.abs(img.px[i + 1] - img.px[j + 1]) + Math.abs(img.px[i + 2] - img.px[j + 2]);
const diff = (i, j) => { const d = rawDiff(i, j); return d > TOL ? d : 0; };

function analyse(axis) {
  const [n, m] = axis === 'x' ? [x1 - x0, y1 - y0] : [y1 - y0, x1 - x0];
  const idx = (a, b) => (axis === 'x' ? at(x0 + a, y0 + b) : at(x0 + b, y0 + a));
  // 1. edge profile
  const E = new Float64Array(n);
  for (let a = 1; a < n; a++) for (let b = 0; b < m; b++) E[a] += diff(idx(a, b), idx(a - 1, b));
  const total = E.reduce((s, v) => s + v, 0) || 1;
  // 2. comb: |sum E[a] e^(-2 pi i a / p)| / sum E, for each tooth spacing p
  const score = (p) => { let re = 0, im = 0; for (let a = 0; a < n; a++) { const t = (2 * Math.PI * a) / p; re += E[a] * Math.cos(t); im -= E[a] * Math.sin(t); } return Math.hypot(re, im) / total; };
  let best = 0; const scores = [];
  for (let p = 1.5; p <= 16.001; p += 0.01) { const s = score(p); scores.push([p, s]); best = Math.max(best, s); }
  // p/2, p/3 ... fit the same spikes, so take the widest spacing that still fits well
  const [period, fit] = scores.filter(([, s]) => s >= 0.9 * best).at(-1);
  // 3. regularity of same-colour runs
  const k = Math.round(period); let runs = 0, bad = 0; const hist = {};
  for (let b = 0; b < m; b++) {
    // runs cut by the crop edges are partial blocks, so skip the first and last
    let len = 1, first = true;
    for (let a = 1; a < n; a++) {
      if (diff(idx(a, b), idx(a - 1, b)) === 0) { len++; continue; }
      if (!first && len < 6 * k) { runs++; hist[len] = (hist[len] || 0) + 1; if (len % k) bad++; }
      first = false;
      len = 1;
    }
  }
  const top = Object.entries(hist).sort((p, q) => q[1] - p[1]).slice(0, 6).map(([l, c]) => `${l}px×${c}`).join(' ');
  return { period: period.toFixed(2), fit: fit.toFixed(3), offGrid: ((100 * bad) / Math.max(1, runs)).toFixed(1) + '%', runs, top };
}

console.log(file, `${x1 - x0}x${y1 - y0}`);
for (const axis of ['x', 'y']) console.log(axis, analyse(axis));
