// Draws the app icon (a pixel-art snowflake) and writes:
//   build/icon.png      1024 px master, for electron-builder
//   build/icon.icns     macOS app icon (made with iconutil)
//   public/favicon.svg  the snowflake tile (no BETA tag) as crisp vector rects
//   public/favicon.png  64 px fallback
//   build/background.png, build/background@2x.png  the dmg installer window
// Run: node tools/make-icon.mjs
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { deflateSync, crc32 } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- the art grid -------------------------------------------------------------------
// The tile is TILE x TILE art pixels.
const TILE = 25;
const PAL = {
  bgTop: '#4aa3b8',
  bgBottom: '#1f5a70',
  rim: '#7cc4d4', // top-edge highlight
  edge: '#173f52', // bottom edge
  flake: '#ffffff',
  ice: '#bfe8f5', // pale blue accents in the flake
  speck: '#8fd0de', // faint snow specks in the sky
  pill: '#e5483b', // the BETA tag: the avatar's red puffer
  pillShade: '#b8342a',
  pillText: '#ffffff',
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const deg = (a) => (a * Math.PI) / 180;
const at = (r, a) => [r * Math.cos(deg(a)), r * Math.sin(deg(a))];
const key = (x, y) => `${x},${y}`;

// A six-armed snowflake centred on pixel (cx, cy), arms `arm` pixels long. Returns key -> colour.
function snowflake(cx, cy, arm) {
  const flake = new Map();
  // Plot in the quadrant x >= 0, y >= 0 (y up, relative to the centre), mirror to all four.
  const plot = (x, y, colour = PAL.flake) => {
    for (const sx of [1, -1]) for (const sy of [1, -1]) {
      const k = key(cx + sx * x, cy - sy * y);
      if (!flake.has(k) || colour === PAL.flake) flake.set(k, colour);
    }
  };
  // A one-pixel line: one pixel per step along the major axis.
  const line = (x0, y0, x1, y1) => {
    const steps = Math.round(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      plot(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
    }
  };
  const k = arm / 9; // branch layout is tuned for 9-pixel arms
  // The vertical arm and the 30° arm, mirrored, give six arms. Two pairs of branches on each.
  for (const a of [90, 30]) {
    const [ex, ey] = at(arm, a);
    line(0, 0, ex, ey);
    for (const [r, len] of [[4.5 * k, 2.2 * k], [7 * k, 1.4 * k]]) {
      const [bx, by] = at(r, a);
      for (const side of [60, -60]) {
        const [dx, dy] = at(len, a + side);
        line(bx, by, bx + dx, by + dy);
      }
    }
  }
  // The heart: a small ring of ice round a white core, and ice at the arm tips.
  for (const [x, y] of [[1, 1], [2, 0], [1, 0], [0, 1]]) plot(x, y, PAL.ice);
  plot(0, 0);
  for (const a of [90, 30]) {
    const [ex, ey] = at(arm, a);
    plot(Math.round(ex), Math.round(ey), PAL.ice);
  }
  return flake;
}

// 5-row pixel letters for the tag (BETA is 18 wide with 1-pixel gaps, so the pill centres exactly).
const FONT = {
  B: ['###.', '#..#', '###.', '#..#', '###.'],
  E: ['####', '#...', '###.', '#...', '####'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  A: ['.##.', '#..#', '####', '#..#', '#..#'],
};

// The tile as rows of [r,g,b] (null outside it), plus `fine`: the BETA pill, drawn on a grid of
// half-size pixels (key "x,y" in half pixels -> colour) so it stays small next to the snowflake.
//   beta:    lift the snowflake and put a red BETA pill under it
//   corners: stepped pixel corners (the favicon); the app icon is masked to the macOS shape instead
function makeGrid({ beta, corners }) {
  const CORNER = corners ? [3, 2, 1] : []; // pixels cut from each row at the corners
  const inTile = (x, y) => {
    if (x < 0 || y < 0 || x >= TILE || y >= TILE) return false;
    const cut = CORNER[Math.min(y, TILE - 1 - y)] ?? 0;
    return x >= cut && x < TILE - cut;
  };
  const C = (TILE - 1) / 2;
  const flake = snowflake(C, beta ? C - 1 : C, 9);

  const grid = [];
  const BANDS = 6;
  for (let y = 0; y < TILE; y++) {
    grid.push([]);
    for (let x = 0; x < TILE; x++) {
      if (!inTile(x, y)) { grid[y].push(null); continue; }
      const band = Math.floor((y / TILE) * BANDS) / (BANDS - 1);
      let c = mix(hex(PAL.bgTop), hex(PAL.bgBottom), band);
      if (!inTile(x, y - 1)) c = hex(PAL.rim);
      else if (!inTile(x, y + 1)) c = hex(PAL.edge);
      grid[y].push(c);
    }
  }
  // Faint specks of falling snow.
  for (const [x, y] of [[4, 5], [20, 4], [3, 17], [21, 19], [7, 21], [18, 8]]) {
    if (!flake.has(key(x, y))) grid[y][x] = hex(PAL.speck);
  }
  for (const [k, colour] of flake) {
    const [x, y] = k.split(',').map(Number);
    grid[y][x] = hex(colour);
  }
  const fine = new Map();
  if (beta) {
    // Pill 22 x 7 half pixels: round ends, a darker bottom row, BETA in the middle.
    const text = 'BETA', gap = 1;
    const tw = [...text].reduce((w, ch) => w + FONT[ch][0].length, 0) + gap * (text.length - 1);
    const pw = tw + 4, ph = 7, px0 = TILE - pw / 2, py0 = TILE * 2 - 2 - ph; // centred, above the bottom edge
    for (let j = 0; j < ph; j++) for (let i = 0; i < pw; i++) {
      if ((i === 0 || i === pw - 1) && (j === 0 || j === ph - 1)) continue;
      fine.set(key(px0 + i, py0 + j), hex(j === ph - 1 ? PAL.pillShade : PAL.pill));
    }
    let tx = px0 + 2;
    for (const ch of text) {
      FONT[ch].forEach((row, j) => [...row].forEach((bit, i) => {
        if (bit === '#') fine.set(key(tx + i, py0 + 1 + j), hex(PAL.pillText));
      }));
      tx += FONT[ch][0].length + gap;
    }
  }
  return { grid, fine };
}
const { grid, fine } = makeGrid({ beta: true, corners: false }); // app icon
const favGrid = makeGrid({ beta: false, corners: true }).grid; // browser tab

// ---- raster output --------------------------------------------------------------------
// macOS icon layout (Big Sur and later): the icon body is an 824 px rounded square centred in a
// 1024 canvas. macOS 26 puts an icon whose body does not fill that shape inside a grey frame,
// so the body fills the shape exactly and the art grid (800 px, 32 px per art pixel) sits on it.
// Outside the grid, the nearest grid pixel's colour carries on to the shape's edge.
const SIZE = 1024, CELL = 32, OFF = (SIZE - TILE * CELL) / 2; // 112 px
const BODY = 824, BODY_OFF = (SIZE - BODY) / 2, RADIUS = 185; // Apple's icon template

// Coverage (0..1) of the pixel at (x, y) by the rounded square, 4 x 4 supersampled.
function coverage(x, y) {
  let n = 0;
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const px = x + (i + 0.5) / 4 - BODY_OFF, py = y + (j + 0.5) / 4 - BODY_OFF;
    if (px < 0 || py < 0 || px > BODY || py > BODY) continue;
    const dx = Math.max(RADIUS - px, px - (BODY - RADIUS), 0);
    const dy = Math.max(RADIUS - py, py - (BODY - RADIUS), 0);
    if (dx * dx + dy * dy <= RADIUS * RADIUS) n++;
  }
  return n / 16;
}

function render1024() {
  const px = new Uint8Array(SIZE * SIZE * 4);
  const clamp = (v) => Math.min(TILE - 1, Math.max(0, v));
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    const a = coverage(x, y);
    if (!a) continue;
    const c = fine.get(key(Math.floor((x - OFF) / (CELL / 2)), Math.floor((y - OFF) / (CELL / 2))))
      ?? grid[clamp(Math.floor((y - OFF) / CELL))][clamp(Math.floor((x - OFF) / CELL))];
    const o = (y * SIZE + x) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = Math.round(a * 255);
  }
  return px;
}
// Area-average downscale by an integer factor (premultiplied, so edges stay clean).
function downscale(src, size, f) {
  const n = size / f, out = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
      const o = ((y * f + j) * size + x * f + i) * 4, al = src[o + 3];
      r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al; a += al;
    }
    const o = (y * n + x) * 4;
    if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
    out[o + 3] = a / (f * f);
  }
  return out;
}
const png = (px, size) => pngWH(px, size, size);
function pngWH(px, w, h) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) Buffer.from(px.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const master = render1024();
const at1x = (s) => (s === SIZE ? master : downscale(master, SIZE, SIZE / s));

mkdirSync(join(ROOT, 'build'), { recursive: true });
mkdirSync(join(ROOT, 'public'), { recursive: true });
writeFileSync(join(ROOT, 'build/icon.png'), png(master, SIZE));

// icns via iconutil (macOS only)
const set = join(ROOT, 'build/icon.iconset');
rmSync(set, { recursive: true, force: true });
mkdirSync(set);
for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(join(set, `icon_${s}x${s}.png`), png(at1x(s), s));
  writeFileSync(join(set, `icon_${s}x${s}@2x.png`), png(at1x(s * 2), s * 2));
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(ROOT, 'build/icon.icns')]);
rmSync(set, { recursive: true });

// favicon: the tile only (no macOS margin), one rect per art pixel
const rects = [];
for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
  const c = favGrid[y][x];
  if (c) rects.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}"/>`);
}
writeFileSync(join(ROOT, 'public/favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${TILE} ${TILE}" shape-rendering="crispEdges">${rects.join('')}</svg>\n`);
// 64 px PNG of the tile: crop the 800 px tile from the master, then shrink (800 -> 64 is not integral,
// so draw the grid straight at 2 px per art pixel plus 7 px margin).
{
  const S = 64, cell = 2, off = (S - TILE * cell) / 2 | 0, px = new Uint8Array(S * S * 4);
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const c = favGrid[y][x];
    if (!c) continue;
    for (let j = 0; j < cell; j++) for (let i = 0; i < cell; i++) {
      const o = ((off + y * cell + j) * S + off + x * cell + i) * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
  }
  writeFileSync(join(ROOT, 'public/favicon.png'), png(px, S));
}
// ---- dmg window background ----------------------------------------------------------
// The installer window is 540 x 380 pt (see "dmg" in package.json): the app at x 140,
// Applications at x 400, both at y 150. Finder's path and status bars can cover the bottom ~60 pt. Drawn on a grid of 4 pt art pixels.
{
  const AP = 4, GW = 540 / AP, GH = 380 / AP; // 135 x 95 art pixels
  const g = Array.from({ length: GH }, () => Array(GW).fill(null));
  const skyTop = hex('#cfe9f2'), skyBottom = hex('#f7fbfd');
  for (let y = 0; y < GH; y++) {
    const band = Math.floor((y / GH) * 7) / 6;
    for (let x = 0; x < GW; x++) g[y][x] = mix(skyTop, skyBottom, band);
  }
  // Snowy hills: two layers of rounded mounds. The far layer carries a few snow-capped pines.
  // A mound is [centre x, top y, half width]; its slope is a parabola, so the top is round.
  const ridge = (mounds, x) => {
    let best = { y: Infinity, side: 0 };
    for (const [cx, top, hw] of mounds) {
      const t = (x - cx) / hw;
      const y = Math.round(top + 26 * t * t);
      if (y < best.y) best = { y, side: t };
    }
    return best;
  };
  const FAR = [[6, 55, 26], [52, 59, 24], [92, 56, 22], [128, 53, 26]];
  const NEAR = [[24, 63, 34], [84, 61, 38], [140, 66, 22]];
  const farTop = [], nearTop = [];
  for (let x = 0; x < GW; x++) {
    const f = ridge(FAR, x), n = ridge(NEAR, x);
    farTop.push(f.y); nearTop.push(n.y);
    for (let y = Math.max(f.y, 0); y < GH; y++) {
      // lit left slopes, shaded right slopes
      g[y][x] = hex(y === f.y ? '#b4d6e2' : f.side > 0.15 && y < f.y + 5 ? '#cfe4ec' : '#dbecf2');
    }
    for (let y = Math.max(n.y, 0); y < GH; y++) {
      g[y][x] = hex(y === n.y ? '#c7e0ea' : n.side > 0.15 && y < n.y + 5 ? '#eaf4f8' : '#ffffff');
    }
  }
  // Pines: snow on each tier, a darker right half. Kept clear of the icon labels.
  const PINE = ['...w...', '..wLD..', '..LLD..', '.wLLDw.', '.LLLDD.', 'wLLLDDw', 'LLLLDDD', '...b...'];
  for (const x0 of [1, 9, 47, 56, 114, 123]) {
    const base = farTop[x0 + 3] + 1; // trunk sinks one pixel into the snow
    PINE.forEach((row, j) => [...row].forEach((ch, i) => {
      const x = x0 + i, y = base - (PINE.length - 1 - j);
      if (ch === '.' || x >= GW || y >= nearTop[x]) return; // hidden behind the near hills
      g[y][x] = hex({ w: '#ffffff', b: '#5a4636', L: '#3a8090', D: '#2a6270' }[ch]);
    }));
  }
  // Falling snow, kept clear of the two icons and their labels.
  const clear = (x, y) => [35, 100].some((cx) => Math.abs(x - cx) < 18 && y > 20 && y < 58)
    || (Math.abs(x - 67) < 12 && Math.abs(y - 37) < 9); // the arrow
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rnd() * GW), y = Math.floor(rnd() * 50);
    if (!clear(x, y)) g[y][x] = hex(rnd() < 0.5 ? '#ffffff' : '#a9d6e3');
  }
  // A pixel arrow from the app to Applications, in the icon's teal, with a soft shadow.
  // Shaft 5 rows tall, head a filled triangle 11 rows tall.
  const arrow = [];
  for (let j = 0; j <= 10; j++) {
    const head = 6 - Math.abs(j - 5); // head width on this row
    for (let i = 0; i < 11 + head; i++) if (i >= 11 || (j >= 3 && j <= 7)) arrow.push([i, j]);
  }
  const ax = Math.round(GW / 2 - 8), ay = 37 - 5; // centred on y 150 pt (row 37)
  for (const [i, j] of arrow) g[ay + j + 1][ax + i] = mix(g[ay + j + 1][ax + i], hex('#1f5a70'), 0.22);
  for (const [i, j] of arrow) g[ay + j][ax + i] = hex(j <= 5 ? '#5cb3c6' : '#3f93a8');

  for (const [scale, name] of [[1, 'background.png'], [2, 'background@2x.png']]) {
    const cell = AP * scale, W = GW * cell, H = GH * cell, px = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const c = g[(y / cell) | 0][(x / cell) | 0], o = (y * W + x) * 4;
      px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
    }
    writeFileSync(join(ROOT, 'build', name), pngWH(px, W, H));
  }
}
console.log('wrote build/icon.png, build/icon.icns, build/background*.png, public/favicon.svg, public/favicon.png');
