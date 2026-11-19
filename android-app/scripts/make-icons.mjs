/* make-icons.mjs — membuat ikon launcher Android, ikon notifikasi,
   ikon Play Store 512px, dan feature graphic 1024x500 tanpa dependensi eksternal. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');

const RED = [220, 38, 38];
const WHITE = [255, 255, 255];

/* ---------- encoder PNG minimal ---------- */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- penggambar ikon (supersampling 4x agar tepi halus) ---------- */
function insideRoundedSquare(x, y, size, radius) {
  if (x < 0 || y < 0 || x > size || y > size) return false;
  const rx = Math.min(x, size - x);
  const ry = Math.min(y, size - y);
  if (rx >= radius || ry >= radius) return true;
  const dx = radius - rx;
  const dy = radius - ry;
  return dx * dx + dy * dy <= radius * radius;
}

/* Bagian tengah ikon selalu berupa palang putih; gradien hanya pada latar. */

function insideCross(x, y, size, halfArm) {
  const cx = size / 2;
  const cy = size / 2;
  const arm = size * 0.155;
  const reach = size * 0.33;
  const inVertical = Math.abs(x - cx) <= arm && Math.abs(y - cy) <= reach;
  const inHorizontal = Math.abs(y - cy) <= arm && Math.abs(x - cx) <= reach;
  return inVertical || inHorizontal;
}

function drawIcon(size, { shape = 'rounded', background = RED, cross = WHITE, crossScale = 1, alpha = 255 } = {}) {
  const ss = 4;
  const big = size * ss;
  const radius = shape === 'circle' ? big / 2 : big * 0.22;
  const out = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const px = x * ss + sx + 0.5;
          const py = y * ss + sy + 0.5;
          const inShape = shape === 'circle'
            ? (Math.pow(px - big / 2, 2) + Math.pow(py - big / 2, 2)) <= Math.pow(big / 2, 2)
            : insideRoundedSquare(px, py, big, radius);
          if (!inShape) continue;
          const color = insideCross(px, py, big, big * 0.155 * crossScale) ? cross : background;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const samples = ss * ss;
      const idx = (y * size + x) * 4;
      if (a === 0) {
        out[idx + 3] = 0;
        continue;
      }
      out[idx] = Math.round(r / a);
      out[idx + 1] = Math.round(g / a);
      out[idx + 2] = Math.round(b / a);
      out[idx + 3] = Math.round((a / samples) * alpha);
    }
  }
  return out;
}

/* ---------- ikon launcher ----------
   Ikon launcher dan ikon Play Store berasal dari emblem di
   play-store/icon-512.png, bukan digambar di sini. Untuk membuat ulang:
       python scripts/make-launcher-icons.py
   Skrip ini hanya membuat ikon notifikasi dan feature graphic. */
const MIPMAPS = [
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192]
];

/* ---------- ikon notifikasi ----------
   Dibuat oleh scripts/make-launcher-icons.py (siluet ambulans putih),
   bukan di sini, agar tidak menimpa ikon yang sudah disesuaikan. */

/* ---------- feature graphic Play Store ---------- */
{
  const width = 1024;
  const height = 500;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = (x / width) * 0.75 + (y / height) * 0.25;
      const idx = (y * width + x) * 4;
      // gradien merah tua -> merah terang
      rgba[idx] = Math.round(120 + t * 110);
      rgba[idx + 1] = Math.round(18 + t * 24);
      rgba[idx + 2] = Math.round(24 + t * 22);
      rgba[idx + 3] = 255;
      // aksen lingkaran halus
      const dx = x - width * 0.82;
      const dy = y - height * 0.2;
      if (dx * dx + dy * dy < Math.pow(height * 0.34, 2)) {
        rgba[idx] = Math.min(255, rgba[idx] + 26);
        rgba[idx + 1] = Math.min(255, rgba[idx + 1] + 10);
        rgba[idx + 2] = Math.min(255, rgba[idx + 2] + 8);
      }
    }
  }
  // tempel ikon putih di kiri
  const badge = 260;
  const icon = drawIcon(badge, { shape: 'rounded', background: WHITE, cross: RED });
  const ox = 120;
  const oy = Math.round((height - badge) / 2);
  for (let y = 0; y < badge; y++) {
    for (let x = 0; x < badge; x++) {
      const src = (y * badge + x) * 4;
      const a = icon[src + 3] / 255;
      if (a === 0) continue;
      const dst = ((oy + y) * width + ox + x) * 4;
      for (let c = 0; c < 3; c++) {
        rgba[dst + c] = Math.round(icon[src + c] * a + rgba[dst + c] * (1 - a));
      }
    }
  }
  mkdirSync(path.join(appDir, 'play-store'), { recursive: true });
  writeFileSync(path.join(appDir, 'play-store/feature-graphic-1024x500.png'), encodePng(width, height, rgba));
  console.log('[icons] play-store/feature-graphic-1024x500.png');
}
