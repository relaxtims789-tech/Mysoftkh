// Draws the PWA icons (a QR-style mark on blue) as PNGs without any image library.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'apps', 'web', 'public', 'icons');
const BLUE = [0x1d, 0x4e, 0xd8];
const WHITE = [255, 255, 255];

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Same geometry as favicon.svg on a 64-unit grid. */
function inMark(u, v) {
  const box = (x0, y0, s) => u >= x0 && u < x0 + s && v >= y0 && v < y0 + s;
  const ring = (x0, y0) => box(x0, y0, 14) && !box(x0 + 4, y0 + 4, 6);
  return ring(14, 14) || ring(36, 14) || ring(14, 36) || box(36, 36, 5) || box(45, 36, 5) || box(40.5, 40.5, 5) || box(36, 45, 5) || box(45, 45, 5);
}

function icon(size, { rounded, inset }) {
  const scale = 64 / size;
  return png(size, (x, y) => {
    const u0 = (x + 0.5) * scale, v0 = (y + 0.5) * scale;
    // maskable icons keep the mark inside the 80% safe zone
    const u = inset ? 32 + (u0 - 32) / 0.7 : u0;
    const v = inset ? 32 + (v0 - 32) / 0.7 : v0;
    if (rounded) {
      const r = 14, cx = Math.min(Math.max(u0, r), 64 - r), cy = Math.min(Math.max(v0, r), 64 - r);
      if ((u0 - cx) ** 2 + (v0 - cy) ** 2 > r * r) return [0, 0, 0, 0];
    }
    return [...(inMark(u, v) ? WHITE : BLUE), 255];
  });
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'icon-192.png'), icon(192, { rounded: true }));
fs.writeFileSync(path.join(OUT, 'icon-512.png'), icon(512, { rounded: true }));
fs.writeFileSync(path.join(OUT, 'icon-maskable-512.png'), icon(512, { rounded: false, inset: true }));
fs.writeFileSync(path.join(OUT, 'apple-touch-icon.png'), icon(180, { rounded: false }));
console.log('icons written to', OUT);
