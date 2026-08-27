#!/usr/bin/env node
/**
 * Generates VOXO's placeholder icon/splash/adaptive-icon PNGs from scratch,
 * with zero image-processing dependencies (pure Node + zlib) — this sandbox
 * has no ImageMagick/sharp/PIL available. Output is a real, valid PNG: a
 * solid brand-color background with a simple white ring mark (deliberately
 * NOT WhatsApp's phone-in-circle glyph — a distinct abstract mark instead,
 * per spec §45's "no WhatsApp branding" requirement).
 *
 * These are placeholders. Swap the files this script writes to
 * mobile/assets/ for real branded art before a production release — see
 * ARCHITECTURE.md §45.
 *
 * Usage: node scripts/generate-placeholder-icons.js
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BRAND = [0x4c, 0x3f, 0xe0]; // #4C3FE0 — a deep indigo, distinct from WhatsApp's green
const WHITE = [0xff, 0xff, 0xff];

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      t[n] = c >>> 0;
    }
    return t;
  })());
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/** paint(x, y) -> [r, g, b] */
function encodePng(width, height, paint) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let offset = 0;
  for (let y = 0; y < height; y++) {
    raw[offset++] = 0; // filter type 0 (none) per scanline
    for (let x = 0; x < width; x++) {
      const [r, g, b] = paint(x, y);
      raw[offset++] = r;
      raw[offset++] = g;
      raw[offset++] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Solid brand background with a centered white ring (radii as fractions of min(width,height)). */
function ringMark(width, height, { bg = BRAND, fg = WHITE, outerFrac = 0.32, innerFrac = 0.2 } = {}) {
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height);
  const outer = r * outerFrac;
  const inner = r * innerFrac;
  return (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= outer && dist >= inner ? fg : bg;
  };
}

function solid(color) {
  return () => color;
}

const assetsDir = path.join(__dirname, '..', 'assets');
fs.mkdirSync(assetsDir, { recursive: true });

const outputs = [
  { file: 'icon.png', size: 1024, paint: ringMark(1024, 1024) },
  { file: 'splash-icon.png', size: 1024, paint: ringMark(1024, 1024, { outerFrac: 0.22, innerFrac: 0.13 }) },
  { file: 'android-icon-foreground.png', size: 1024, paint: ringMark(1024, 1024, { outerFrac: 0.26, innerFrac: 0.16 }) },
  { file: 'android-icon-background.png', size: 1024, paint: solid(BRAND) },
  { file: 'android-icon-monochrome.png', size: 1024, paint: ringMark(1024, 1024, { bg: [0, 0, 0], fg: WHITE }) },
  { file: 'favicon.png', size: 48, paint: ringMark(48, 48) },
];

for (const { file, size, paint } of outputs) {
  const png = encodePng(size, size, paint);
  fs.writeFileSync(path.join(assetsDir, file), png);
  console.log(`Wrote ${file} (${size}x${size}, ${png.length} bytes)`);
}
