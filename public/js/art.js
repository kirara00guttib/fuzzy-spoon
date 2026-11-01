// 把「字符网格 + 色板」的像素素材画成 <img>（data URL），浏览器负责放大，边缘是硬的
const cache = new Map();

export function artUrl(art) {
  if (!art || !art.rows) return '';
  if (cache.has(art.id)) return cache.get(art.id);
  const canvas = document.createElement('canvas');
  canvas.width = art.w;
  canvas.height = art.h;
  const ctx = canvas.getContext('2d');
  art.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.') {
        x += 1;
        continue;
      }
      let run = 1;
      while (row[x + run] === ch) run += 1;
      ctx.fillStyle = art.palette[ch] || '#000';
      ctx.fillRect(x, y, run, 1);
      x += run;
    }
  });
  const url = canvas.toDataURL('image/png');
  cache.set(art.id, url);
  return url;
}

/** 生成一个像素图的 <img>；scale = 放大倍数 */
export function artImg(art, scale = 4, className = '', alt = '') {
  if (!art || !art.rows) return '';
  return `<img class="px-art ${className}" src="${artUrl(art)}" width="${art.w * scale}" height="${art.h * scale}" alt="${alt}" draggable="false">`;
}
