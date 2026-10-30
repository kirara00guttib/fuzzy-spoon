// 把 AI 生成的像素画（webp，白底）变成游戏里能用的精灵：
// 1) 从四边泛洪去掉背景（含角落的「AI 生成」水印和地面投影）
// 2) 裁到内容外框、去掉四周空行 3) 「众数采样」缩到目标宽度
// 4) 中位切分（median cut）收成 14 色 —— 保证深色描边和眼睛不会被丢掉
const params = new URLSearchParams(location.search);
const targetW = Number(params.get('w') || 26);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('加载失败 ' + src));
    img.src = src;
  });
}

// 背景 = 近白，或者「淡紫灰」的地面投影（奶油色偏黄，b 会比 r 小，所以不会被误删）
function isBg(r, g, b) {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  if (min >= 226 && max - min <= 18) return true;
  if (min >= 198 && b >= r - 4 && max - min <= 28) return true;
  return false;
}

const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

/** 中位切分：把一堆颜色按色块体积切成 n 份，每份取加权平均 */
function medianCut(entries, n) {
  const boxes = [entries];
  const rangeOf = (box) => {
    let minR = 255; let minG = 255; let minB = 255;
    let maxR = 0; let maxG = 0; let maxB = 0;
    for (const e of box) {
      if (e.r < minR) minR = e.r;
      if (e.g < minG) minG = e.g;
      if (e.b < minB) minB = e.b;
      if (e.r > maxR) maxR = e.r;
      if (e.g > maxG) maxG = e.g;
      if (e.b > maxB) maxB = e.b;
    }
    const rr = maxR - minR;
    const rg = maxG - minG;
    const rb = maxB - minB;
    const channel = rr >= rg && rr >= rb ? 'r' : rg >= rb ? 'g' : 'b';
    return { channel, size: Math.max(rr, rg, rb) };
  };
  while (boxes.length < n) {
    let target = -1;
    let bestScore = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const weight = box.reduce((s, e) => s + e.n, 0);
      const score = rangeOf(box).size * Math.log2(1 + weight);
      if (score > bestScore) {
        bestScore = score;
        target = i;
      }
    });
    if (target < 0) break;
    const box = boxes[target];
    const { channel } = rangeOf(box);
    const sorted = [...box].sort((a, b) => a[channel] - b[channel]);
    const total = sorted.reduce((s, e) => s + e.n, 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length; i += 1) {
      acc += sorted[i].n;
      if (acc >= total / 2) {
        cut = Math.max(1, Math.min(sorted.length - 1, i + 1));
        break;
      }
    }
    boxes.splice(target, 1, sorted.slice(0, cut), sorted.slice(cut));
  }
  return boxes.map((box) => {
    const total = box.reduce((s, e) => s + e.n, 0) || 1;
    const r = box.reduce((s, e) => s + e.r * e.n, 0) / total;
    const g = box.reduce((s, e) => s + e.g * e.n, 0) / total;
    const b = box.reduce((s, e) => s + e.b * e.n, 0) / total;
    return { box, hex: toHex(r, g, b), r, g, b };
  });
}

async function process(src, width) {
  const img = await loadImage(src);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const W = canvas.width;
  const H = canvas.height;
  const data = ctx.getImageData(0, 0, W, H).data;

  const seen = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = y * W + x;
    if (seen[i]) return;
    const p = i * 4;
    if (data[p + 3] < 40) return;
    if (!isBg(data[p], data[p + 1], data[p + 2])) return;
    seen[i] = 1;
    stack.push(i);
  };
  for (let x = 0; x < W; x += 1) {
    push(x, 0);
    push(x, H - 1);
  }
  for (let y = 0; y < H; y += 1) {
    push(0, y);
    push(W - 1, y);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % W;
    const y = (i - x) / W;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = y * W + x;
      if (seen[i]) continue;
      const p = i * 4;
      if (data[p + 3] < 40) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error('没找到主体');
  const bw = maxX - minX + 1;
  const bh = maxY - minY + 1;
  const outW = width;
  const outH = Math.max(4, Math.round((bh / bw) * width));

  const key = (r, g, b) => `${r >> 3},${g >> 3},${b >> 3}`;
  const rows = [];
  for (let ty = 0; ty < outH; ty += 1) {
    const line = [];
    for (let tx = 0; tx < outW; tx += 1) {
      const x0 = minX + Math.floor((tx * bw) / outW);
      const x1 = minX + Math.max(1, Math.floor(((tx + 1) * bw) / outW));
      const y0 = minY + Math.floor((ty * bh) / outH);
      const y1 = minY + Math.max(1, Math.floor(((ty + 1) * bh) / outH));
      const counts = new Map();
      let total = 0;
      let solid = 0;
      for (let y = y0; y < Math.min(y1, maxY + 1); y += 1) {
        for (let x = x0; x < Math.min(x1, maxX + 1); x += 1) {
          const i = y * W + x;
          total += 1;
          if (seen[i]) continue;
          const p = i * 4;
          if (data[p + 3] < 60) continue;
          solid += 1;
          const k = key(data[p], data[p + 1], data[p + 2]);
          const rec = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 };
          rec.n += 1;
          rec.r += data[p];
          rec.g += data[p + 1];
          rec.b += data[p + 2];
          counts.set(k, rec);
        }
      }
      if (!total || solid / total < 0.5 || !counts.size) {
        line.push(null);
        continue;
      }
      let best = null;
      for (const rec of counts.values()) if (!best || rec.n > best.n) best = rec;
      line.push({ r: best.r / best.n, g: best.g / best.n, b: best.b / best.n, n: best.n });
    }
    rows.push(line);
  }

  // 去掉四周空行/空列
  const solidRow = (line) => line.some((c) => c);
  while (rows.length && !solidRow(rows[0])) rows.shift();
  while (rows.length && !solidRow(rows[rows.length - 1])) rows.pop();
  let left = Infinity;
  let right = -1;
  rows.forEach((line) => {
    line.forEach((c, i) => {
      if (!c) return;
      if (i < left) left = i;
      if (i > right) right = i;
    });
  });
  const trimmed = rows.map((line) => line.slice(left, right + 1));

  // 收集所有格子颜色做中位切分
  const hist = new Map();
  trimmed.forEach((line) => {
    line.forEach((c) => {
      if (!c) return;
      const k = key(c.r, c.g, c.b);
      const rec = hist.get(k) || { n: 0, r: 0, g: 0, b: 0, count: 0 };
      rec.count += 1;
      hist.set(k, rec);
    });
  });
  const entries = [...hist.keys()].map((k) => {
    const [q, w, v] = k.split(',').map(Number);
    // 用格子颜色的近似值（每桶里所有格子的平均在下面算）
    return { k, r: q * 8 + 4, g: w * 8 + 4, b: v * 8 + 4, n: hist.get(k).count };
  });
  const boxes = medianCut(entries, 14);

  // 每个桶的第一个代表色
  const paletteHex = boxes.map((b) => b.hex);
  const chars = 'abcdefghijklmn'.split('');
  const palette = {};
  paletteHex.forEach((hex, i) => {
    palette[chars[i]] = hex;
  });
  const nearestChar = (c) => {
    let best = 0;
    let bestD = Infinity;
    boxes.forEach((b, i) => {
      const d = (b.r - c.r) ** 2 + (b.g - c.g) ** 2 + (b.b - c.b) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return chars[best];
  };
  const outRows = trimmed.map((line) => line.map((c) => (c ? nearestChar(c) : '.')).join(''));

  return {
    w: outRows[0].length,
    h: outRows.length,
    rows: outRows,
    palette,
  };
}

window.__done = (async () => {
  const catW = Number(params.get('catW') || targetW);
  const dogW = Number(params.get('dogW') || targetW);
  const [cat, dog] = await Promise.all([process('cat.webp', catW), process('dog.webp', dogW)]);
  document.getElementById('log').textContent = JSON.stringify({ cat, dog }, null, 1);
  return { cat, dog };
})().catch((err) => ({ error: String(err && err.message ? err.message : err) }));
