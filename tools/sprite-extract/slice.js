// 从「多宫格」像素画里自动找出每一个独立图案（连通块），逐个去白底 → 缩到像素网格 → 中位切分收色
// 比按等分格子切稳得多：图案大小不一、位置不齐都没关系
const params = new URLSearchParams(location.search);

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('加载失败 ' + src));
    img.src = src;
  });
}

const isBg = (r, g, b) => {
  const min = Math.min(r, g, b);
  const max = Math.max(r, g, b);
  if (min >= 226 && max - min <= 18) return true;
  if (min >= 198 && b >= r - 4 && max - min <= 28) return true;
  return false;
};

const toHex = (r, g, b) =>
  '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

function medianCut(entries, n) {
  const boxes = [entries];
  const rangeOf = (box) => {
    let minR = 255, minG = 255, minB = 255, maxR = 0, maxG = 0, maxB = 0;
    for (const e of box) {
      if (e.r < minR) minR = e.r;
      if (e.g < minG) minG = e.g;
      if (e.b < minB) minB = e.b;
      if (e.r > maxR) maxR = e.r;
      if (e.g > maxG) maxG = e.g;
      if (e.b > maxB) maxB = e.b;
    }
    const rr = maxR - minR, rg = maxG - minG, rb = maxB - minB;
    const channel = rr >= rg && rr >= rb ? 'r' : rg >= rb ? 'g' : 'b';
    return { channel, size: Math.max(rr, rg, rb) };
  };
  while (boxes.length < n) {
    let target = -1, best = -1;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const weight = box.reduce((s, e) => s + e.n, 0);
      const score = rangeOf(box).size * Math.log2(1 + weight);
      if (score > best) { best = score; target = i; }
    });
    if (target < 0) break;
    const box = boxes[target];
    const { channel } = rangeOf(box);
    const sorted = [...box].sort((a, b) => a[channel] - b[channel]);
    const total = sorted.reduce((s, e) => s + e.n, 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < sorted.length; i += 1) {
      acc += sorted[i].n;
      if (acc >= total / 2) { cut = Math.max(1, Math.min(sorted.length - 1, i + 1)); break; }
    }
    boxes.splice(target, 1, sorted.slice(0, cut), sorted.slice(cut));
  }
  return boxes.map((box) => {
    const total = box.reduce((s, e) => s + e.n, 0) || 1;
    return {
      r: box.reduce((s, e) => s + e.r * e.n, 0) / total,
      g: box.reduce((s, e) => s + e.g * e.n, 0) / total,
      b: box.reduce((s, e) => s + e.b * e.n, 0) / total,
    };
  });
}

/** 找出图里所有独立图案（8 邻域连通） */
function findBlobs(img, minArea) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;

  const solid = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    const p = i * 4;
    solid[i] = data[p + 3] > 40 && !isBg(data[p], data[p + 1], data[p + 2]) ? 1 : 0;
  }

  const seen = new Uint8Array(W * H);
  const blobs = [];
  const stack = [];
  for (let start = 0; start < W * H; start += 1) {
    if (!solid[start] || seen[start]) continue;
    seen[start] = 1;
    stack.push(start);
    let minX = W, minY = H, maxX = -1, maxY = -1, area = 0;
    while (stack.length) {
      const i = stack.pop();
      const x = i % W, y = (i - x) / W;
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const ni = ny * W + nx;
          if (!solid[ni] || seen[ni]) continue;
          seen[ni] = 1;
          stack.push(ni);
        }
      }
    }
    if (area >= minArea) blobs.push({ minX, minY, maxX, maxY, area, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
  }
  return { blobs, data, W, H };
}

function extract(img, blob, targetW, data, W) {
  const bw = blob.maxX - blob.minX + 1;
  const bh = blob.maxY - blob.minY + 1;
  const outW = targetW;
  const outH = Math.max(4, Math.round((bh / bw) * targetW));
  const key = (r, g, b) => `${r >> 3},${g >> 3},${b >> 3}`;
  const rows = [];
  for (let ty = 0; ty < outH; ty += 1) {
    const line = [];
    for (let tx = 0; tx < outW; tx += 1) {
      const x0 = blob.minX + Math.floor((tx * bw) / outW);
      const x1 = blob.minX + Math.max(1, Math.floor(((tx + 1) * bw) / outW));
      const y0 = blob.minY + Math.floor((ty * bh) / outH);
      const y1 = blob.minY + Math.max(1, Math.floor(((ty + 1) * bh) / outH));
      const counts = new Map();
      let total = 0, solid = 0;
      for (let y = y0; y < Math.min(y1, blob.maxY + 1); y += 1) {
        for (let x = x0; x < Math.min(x1, blob.maxX + 1); x += 1) {
          const p = (y * W + x) * 4;
          total += 1;
          if (data[p + 3] < 60) continue;
          if (isBg(data[p], data[p + 1], data[p + 2])) continue;
          solid += 1;
          const k = key(data[p], data[p + 1], data[p + 2]);
          const rec = counts.get(k) || { n: 0, r: 0, g: 0, b: 0 };
          rec.n += 1; rec.r += data[p]; rec.g += data[p + 1]; rec.b += data[p + 2];
          counts.set(k, rec);
        }
      }
      if (!total || solid / total < 0.42 || !counts.size) { line.push(null); continue; }
      let best = null;
      for (const rec of counts.values()) if (!best || rec.n > best.n) best = rec;
      line.push({ r: best.r / best.n, g: best.g / best.n, b: best.b / best.n });
    }
    rows.push(line);
  }
  while (rows.length && rows[0].every((c) => !c)) rows.shift();
  while (rows.length && rows[rows.length - 1].every((c) => !c)) rows.pop();
  let left = Infinity, right = -1;
  rows.forEach((line) => line.forEach((c, i) => { if (!c) return; if (i < left) left = i; if (i > right) right = i; }));
  if (!rows.length || right < 0) return null;
  const trimmed = rows.map((line) => line.slice(left, right + 1));

  const hist = new Map();
  trimmed.forEach((line) => line.forEach((c) => {
    if (!c) return;
    const k = key(c.r, c.g, c.b);
    hist.set(k, (hist.get(k) || 0) + 1);
  }));
  const entries = [...hist.keys()].map((k) => {
    const [q, w, v] = k.split(',').map(Number);
    return { k, r: q * 8 + 4, g: w * 8 + 4, b: v * 8 + 4, n: hist.get(k) };
  });
  const boxes = medianCut(entries, 12);
  const chars = 'abcdefghijkl'.split('');
  const palette = {};
  boxes.forEach((b, i) => { palette[chars[i]] = toHex(b.r, b.g, b.b); });
  const nearest = (c) => {
    let bi = 0, bd = Infinity;
    boxes.forEach((b, i) => {
      const d = (b.r - c.r) ** 2 + (b.g - c.g) ** 2 + (b.b - c.b) ** 2;
      if (d < bd) { bd = d; bi = i; }
    });
    return chars[bi];
  };
  const outRows = trimmed.map((line) => line.map((c) => (c ? nearest(c) : '.')).join(''));
  return { w: outRows[0].length, h: outRows.length, rows: outRows, palette };
}

/** 按「先上后下、从左到右」排序 */
function sortReading(blobs) {
  const heights = blobs.map((b) => b.maxY - b.minY + 1).sort((a, b) => a - b);
  const tolerance = (heights[Math.floor(heights.length / 2)] || 100) * 0.6;
  return [...blobs].sort((a, b) => {
    if (Math.abs(a.cy - b.cy) > tolerance) return a.cy - b.cy;
    return a.cx - b.cx;
  });
}

window.__done = (async () => {
  const specs = (params.get('specs') || 'food.webp:24').split('|');
  const out = {};
  for (const spec of specs) {
    const [src, w] = spec.split(':');
    const img = await loadImage(src);
    const { blobs, data, W } = findBlobs(img, 400);
    const ordered = sortReading(blobs);
    out[src] = ordered.map((b) => extract(img, b, Number(w), data, W));
  }
  document.getElementById('log').textContent = 'done: ' + Object.entries(out).map(([k, v]) => k + '=' + v.filter(Boolean).length).join(', ');
  return out;
})().catch((err) => ({ error: String(err && err.message ? err.message : err) }));
