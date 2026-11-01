// 把切出来的食物/阶段素材渲染成一张 PNG 检查
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { FOODS, STAGES } from '../public/js/food-data.js';

function crc32(buf) {
  const t = [];
  for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = t[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const tb = Buffer.from(type, 'ascii');
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([len, tb, data, cb]);
};
function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) { raw[y * (width * 4 + 1)] = 0; rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const hex = (s) => { const v = s.replace('#', ''); return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)]; };

const items = [...FOODS, ...['egg', 'box', 'seed'].map((k) => ({ id: k, ...STAGES[k] }))].filter((a) => a && a.rows);
const SCALE = 6, PAD = 12;
const COLS = 6;
const cellW = Math.max(...items.map((i) => i.w)) * SCALE + PAD;
const cellH = Math.max(...items.map((i) => i.h)) * SCALE + PAD;
const rows = Math.ceil(items.length / COLS);
const width = COLS * cellW + PAD;
const height = rows * cellH + PAD;
const buf = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i += 1) { buf[i * 4] = 0xf6; buf[i * 4 + 1] = 0xef; buf[i * 4 + 2] = 0xe2; buf[i * 4 + 3] = 255; }

items.forEach((art, idx) => {
  const ox = PAD + (idx % COLS) * cellW;
  const oy = PAD + Math.floor(idx / COLS) * cellH;
  art.rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === '.') return;
    const [r, g, b] = hex(art.palette[ch]);
    for (let dy = 0; dy < SCALE; dy += 1) for (let dx = 0; dx < SCALE; dx += 1) {
      const px = ox + x * SCALE + dx, py = oy + y * SCALE + dy;
      if (px < 0 || py < 0 || px >= width || py >= height) continue;
      const i = (py * width + px) * 4;
      buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255;
    }
  }));
});

const out = process.argv[2] || path.join(process.cwd(), '.preview', 'foods.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(width, height, buf));
console.log(`写了 ${out} (${width}×${height})，共 ${items.length} 个`);
