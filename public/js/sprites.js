// 两个像素小动物：neko（橘猫）和金毛（小金毛）。
// 图形来自 public/js/sprite-data.js —— 由 tools/make-sprite-data.mjs 从两张 AI 像素画里
// 提取出来（去背景 → 缩到像素网格 → 收成 14 色）。想换图就重新跑一次提取脚本。
import { CAT_ART, DOG_ART } from './sprite-data.js';

function build(art, meta) {
  return {
    ...meta,
    w: art.w,
    h: art.h,
    rows: art.rows,
    colors: art.palette,
  };
}

export const CAT = build(CAT_ART, { id: 'cat', name: 'neko' });
export const DOG = build(DOG_ART, { id: 'dog', name: '金毛' });
export const SPRITES = [CAT, DOG];

/** 整只小动物的高度（腿已经画在图里了） */
export const totalHeight = (c) => c.h;
export const LEG_H = 0;

export function validateSprites() {
  const problems = [];
  for (const c of SPRITES) {
    if (c.rows.length !== c.h) problems.push(`${c.id} 行数 ${c.rows.length} != ${c.h}`);
    c.rows.forEach((row, i) => {
      if (row.length !== c.w) problems.push(`${c.id} 第 ${i} 行宽度 ${row.length} != ${c.w}`);
      for (const ch of row) if (ch !== '.' && !(ch in c.colors)) problems.push(`${c.id} 缺颜色 ${ch}`);
    });
  }
  if (problems.length) console.warn('[像素动物自检]', problems);
  return problems;
}

/** 4 帧小跳：0,1,2,1 —— 抬起几像素由 phase 决定 */
export function hopLift(phase) {
  const frame = Math.floor((phase % 1) * 4) % 4;
  return [0, 1, 2, 1][frame];
}

const bodyCache = new Map();

/** 预渲染整只小动物，返回离屏 canvas */
export function bodyCanvas(character) {
  if (bodyCache.has(character.id)) return bodyCache.get(character.id);
  const canvas = document.createElement('canvas');
  canvas.width = character.w;
  canvas.height = character.h;
  const ctx = canvas.getContext('2d');
  character.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === ch) run += 1;
      ctx.fillStyle = character.colors[ch];
      ctx.fillRect(x, y, run, 1);
      x += run;
    }
  });
  bodyCache.set(character.id, canvas);
  return canvas;
}

/** 小头像：整只小动物 */
export function avatarDataUrl(character, scale = 3) {
  const body = bodyCanvas(character);
  const canvas = document.createElement('canvas');
  canvas.width = character.w * scale;
  canvas.height = character.h * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(body, 0, 0, character.w, character.h, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

/**
 * 画一只小动物
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x 左上角
 * @param {number} y 站直时的头顶（跳起来会自动往上）
 * @param {number} phase 0..1，由地面滚动距离驱动
 */
export function drawCharacter(ctx, character, x, y, phase) {
  const lift = hopLift(phase);
  ctx.drawImage(bodyCanvas(character), Math.round(x), Math.round(y - lift));
}
