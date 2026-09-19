/* Draws assets/brand/icons/ui-launcher.png — the rail icon for the Apps page.
 *
 * Hand-drawn on the same 32x32 pixel grid as the rest of assets/brand/icons,
 * because PixelLab is not reachable from where this was written. Regenerate
 * with `node scripts/make-launcher-icon.js`; the palette below is the only
 * thing worth editing.
 *
 * A pure-Node PNG encoder rather than a dependency: npm ci on the target box
 * must never need a compiler, and this runs once at authoring time anyway.
 */
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const S = 32;
const px = new Uint8Array(S * S * 4);               // RGBA, transparent
const put = (x, y, [r, g, b]) => {
  if (x < 0 || y < 0 || x >= S || y >= S) return;
  const i = (y * S + x) * 4;
  px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
};

const INK   = [0x1b, 0x23, 0x1d];   // the dark outline the other icons share
const TILES = [
  [0x4e, 0x8f, 0x63],   // green
  [0xd7, 0xbb, 0x7c],   // brass
  [0x6f, 0x9c, 0xc4],   // blue
  [0xc4, 0x7d, 0x6f],   // clay
];
const HILITE = [0xff, 0xff, 0xff];

/** One app tile: a filled square with a dark outline and a light top edge —
 *  the same three-tone treatment the existing icons use. */
function tile(ox, oy, size, fill) {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const edge = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const corner = (x === 0 || x === size - 1) && (y === 0 || y === size - 1);
      if (corner) continue;                       // clipped corners = rounded
      put(ox + x, oy + y, edge ? INK : fill);
    }
  }
  // A one-pixel gleam inside the top-left, which is what makes these read as
  // objects rather than flat swatches at 22px in the rail.
  for (let x = 2; x < size - 2; x++) put(ox + x, oy + 1, HILITE);
  put(ox + 1, oy + 2, HILITE);
}

const SIZE = 12, GAP = 3, LEFT = 3, TOP = 3;
tile(LEFT,                 TOP,                 SIZE, TILES[0]);
tile(LEFT + SIZE + GAP,    TOP,                 SIZE, TILES[1]);
tile(LEFT,                 TOP + SIZE + GAP,    SIZE, TILES[2]);
tile(LEFT + SIZE + GAP,    TOP + SIZE + GAP,    SIZE, TILES[3]);

/* ---- PNG ---- */
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
};
let TABLE = null;
function crc32(buf) {
  if (!TABLE) {
    TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c;
    }
  }
  let c = -1;
  for (const b of buf) c = TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4);
ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;   // 8-bit RGBA

// Each scanline is prefixed with its filter type; 0 (none) keeps this readable.
const raw = Buffer.alloc((S * 4 + 1) * S);
for (let y = 0; y < S; y++) {
  raw[y * (S * 4 + 1)] = 0;
  Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1);
}

const out = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0))
]);

const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "..",
                       "assets", "brand", "icons", "ui-launcher.png");
fs.writeFileSync(dest, out);
console.log(`wrote ${dest} (${out.length} bytes, ${S}x${S})`);
