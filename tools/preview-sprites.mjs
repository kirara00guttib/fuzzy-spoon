// 把提取出来的像素小动物渲染成 PNG，看看效果
// 用法：node tools/preview-sprites.mjs [输出路径]
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { CAT, DOG, validateSprites, hopLift } from '../public/js/sprites.js';

validateSprites();

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (s) => {
  if (!s) return [0, 0, 0, 0];
  const v = s.replace('#', '');
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16), 255];
};

const SCALE = 8;
const GAP = 10;
const FRAMES = 4;
const CELL_W = Math.max(CAT.w, DOG.w) + 2;
const CELL_H = Math.max(CAT.h, DOG.h) + 5;

function drawSprite(canvas, canvasW, character, ox, oy, frame) {
  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= canvasW) return;
    const idx = (y * canvasW + x) * 4;
    canvas[idx] = color[0];
    canvas[idx + 1] = color[1];
    canvas[idx + 2] = color[2];
    canvas[idx + 3] = 255;
  };
  const lift = hopLift(frame / FRAMES);
  character.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      put(ox + x, oy + y - lift, hex(character.colors[ch]));
    });
  });
}

const cells = [CAT, DOG];
const width = FRAMES * (CELL_W * SCALE + GAP) + GAP;
const height = cells.length * (CELL_H * SCALE + GAP) + GAP;
const buffer = Buffer.alloc(width * height * 4);
for (let i = 0; i < width * height; i += 1) {
  buffer[i * 4] = 0x2b;
  buffer[i * 4 + 1] = 0x24;
  buffer[i * 4 + 2] = 0x36;
  buffer[i * 4 + 3] = 255;
}

cells.forEach((character, rowIndex) => {
  for (let frame = 0; frame < FRAMES; frame += 1) {
    const ox = GAP + frame * (CELL_W * SCALE + GAP);
    const oy = GAP + rowIndex * (CELL_H * SCALE + GAP);
    const small = Buffer.alloc(CELL_W * CELL_H * 4);
    drawSprite(small, CELL_W, character, 0, 2, frame);
    for (let y = 0; y < CELL_H; y += 1) {
      for (let x = 0; x < CELL_W; x += 1) {
        const si = (y * CELL_W + x) * 4;
        if (small[si + 3] === 0) continue;
        for (let dy = 0; dy < SCALE; dy += 1) {
          for (let dx = 0; dx < SCALE; dx += 1) {
            const di = ((oy + y * SCALE + dy) * width + ox + x * SCALE + dx) * 4;
            buffer[di] = small[si];
            buffer[di + 1] = small[si + 1];
            buffer[di + 2] = small[si + 2];
            buffer[di + 3] = 255;
          }
        }
      }
    }
  }
});

const out = process.argv[2] || path.join(process.cwd(), '.preview', 'sprites.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePng(width, height, buffer));
console.log(`写了 ${out} (${width}×${height})`);
