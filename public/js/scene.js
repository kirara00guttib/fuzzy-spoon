// 世界：天空随真实时间变色，草木随季节变色，两个小人一直在走。
// 全部画在「虚拟像素」网格上再整体放大，所以边缘一定是硬的。
import { CAT, DOG, drawCharacter, totalHeight } from './sprites.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const rgb2hex = (r, g, b) =>
  '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');

function mix(a, b, t) {
  const A = hex2rgb(a);
  const B = hex2rgb(b);
  return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
function shade(c, amount) {
  const [r, g, b] = hex2rgb(c);
  return rgb2hex(r * (1 - amount), g * (1 - amount), b * (1 - amount));
}
function luma(c) {
  const [r, g, b] = hex2rgb(c);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

// ── 一天里的光 ─────────────────────────────────────────
// light: 0（深夜）→ 1（正午），季节的颜色都会跟着这个值明暗变化。
const TIME_KEYS = [
  [0, { sky1: '#151129', sky2: '#2A2546', haze: '#3A3459', hillFar: '#2B2749', hillNear: '#211E3A', light: 0.1, star: 1.0, sun: '#EFE3C4' }],
  [4.6, { sky1: '#2A2450', sky2: '#6B4F7E', haze: '#8A6A8C', hillFar: '#463D62', hillNear: '#332C4C', light: 0.28, star: 0.68, sun: '#F6D9B0' }],
  [6.2, { sky1: '#6E7FA8', sky2: '#F6B08C', haze: '#FFD3AE', hillFar: '#7A6F8E', hillNear: '#5A4F6E', light: 0.52, star: 0.14, sun: '#FFD2A0' }],
  [7.6, { sky1: '#9CC6E8', sky2: '#FFE9CC', haze: '#FDF0DC', hillFar: '#93B29A', hillNear: '#6E937A', light: 0.82, star: 0, sun: '#FFF2C8' }],
  [11, { sky1: '#8AC7EE', sky2: '#E2F2F5', haze: '#EEF8F2', hillFar: '#9DBFA6', hillNear: '#7AA383', light: 1, star: 0, sun: '#FFFCE6' }],
  [15, { sky1: '#98CCE8', sky2: '#FFEED2', haze: '#FFF5E0', hillFar: '#A2BEA4', hillNear: '#7FA287', light: 0.96, star: 0, sun: '#FFF4D4' }],
  [17.4, { sky1: '#8FA8CE', sky2: '#FFD9AE', haze: '#FFE6C6', hillFar: '#8E9C9C', hillNear: '#6C7C82', light: 0.78, star: 0.04, sun: '#FFDCAE' }],
  [18.9, { sky1: '#6A5A96', sky2: '#EE9A70', haze: '#F5B58C', hillFar: '#5E5378', hillNear: '#48405E', light: 0.44, star: 0.24, sun: '#FFB482' }],
  [20.2, { sky1: '#33275A', sky2: '#7C4E6E', haze: '#8A5E74', hillFar: '#3D3358', hillNear: '#2B2440', light: 0.26, star: 0.7, sun: '#F5DEB8' }],
  [22, { sky1: '#1C1734', sky2: '#3A3055', haze: '#453A63', hillFar: '#2A2547', hillNear: '#201C38', light: 0.14, star: 0.94, sun: '#F0E4C4' }],
  [24, null],
];
TIME_KEYS[TIME_KEYS.length - 1][1] = TIME_KEYS[0][1];

const SEASONS = {
  spring: {
    id: 'spring',
    name: '春',
    tree: '#E6A6C0',
    treeAlt: '#D28CA8',
    ground: '#8EBE84',
    groundAlt: '#A2CC96',
    flower: '#FFE1EA',
    particle: 'petal',
    particleColors: ['#FFD3E1', '#F7B9CD', '#FFF0F4'],
  },
  summer: {
    id: 'summer',
    name: '夏',
    tree: '#4C9463',
    treeAlt: '#3C7F52',
    ground: '#79B26C',
    groundAlt: '#8CC17C',
    flower: '#FFF08A',
    particle: 'firefly',
    particleColors: ['#FFF3A8', '#E9F5B0'],
  },
  autumn: {
    id: 'autumn',
    name: '秋',
    tree: '#D9903F',
    treeAlt: '#C0702F',
    ground: '#BEA663',
    groundAlt: '#D2BA74',
    flower: '#F3CE7E',
    particle: 'leaf',
    particleColors: ['#E09A4A', '#C4763A', '#F0C070'],
  },
  winter: {
    id: 'winter',
    name: '冬',
    tree: '#A7B6BC',
    treeAlt: '#8A9AA2',
    ground: '#DDE8EC',
    groundAlt: '#EDF5F7',
    flower: '#FFFFFF',
    particle: 'snow',
    particleColors: ['#FFFFFF', '#E8F2F6'],
  },
};

export function seasonForDate(date) {
  const m = date.getMonth() + 1;
  if (m >= 3 && m <= 5) return SEASONS.spring;
  if (m >= 6 && m <= 8) return SEASONS.summer;
  if (m >= 9 && m <= 11) return SEASONS.autumn;
  return SEASONS.winter;
}

export function phaseForHour(hour) {
  if (hour < 4.5) return { key: 'deep-night', name: '深夜', night: true };
  if (hour < 6) return { key: 'dawn', name: '黎明', night: true };
  if (hour < 9) return { key: 'morning', name: '清晨', night: false };
  if (hour < 11.5) return { key: 'forenoon', name: '上午', night: false };
  if (hour < 13.5) return { key: 'noon', name: '正午', night: false };
  if (hour < 17) return { key: 'afternoon', name: '午后', night: false };
  if (hour < 19) return { key: 'dusk', name: '黄昏', night: false };
  if (hour < 21.5) return { key: 'evening', name: '夜晚', night: true };
  return { key: 'night', name: '深夜', night: true };
}

function skyPalette(hour) {
  let i = 0;
  while (i < TIME_KEYS.length - 1 && TIME_KEYS[i + 1][0] <= hour) i += 1;
  const [h1, a] = TIME_KEYS[i];
  const [h2, b] = TIME_KEYS[Math.min(i + 1, TIME_KEYS.length - 1)];
  const span = h2 - h1 || 1;
  const t = clamp((hour - h1) / span, 0, 1);
  const out = {};
  for (const k of Object.keys(a)) {
    out[k] = typeof a[k] === 'number' ? a[k] + (b[k] - a[k]) * t : mix(a[k], b[k], t);
  }
  return out;
}

export function createWorld(canvas, { onTick } = {}) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const back = document.createElement('canvas');
  const bctx = back.getContext('2d');

  let unit = 3;
  let W = 480;
  let H = 300;
  let cssW = 0;
  let cssH = 0;
  let scroll = 0;
  let raf = 0;
  let last = 0;
  let running = false;
  let reduced = false;
  let seasonOverride = 'auto';
  let backKey = '';
  // 预览用：?hour=22&season=winter 可以直接看夜晚和冬天（不影响真实时间）
  const preview = new URLSearchParams(location.search);
  const forcedHour = preview.has('hour') && Number.isFinite(Number(preview.get('hour')))
    ? clamp(Number(preview.get('hour')), 0, 23.99)
    : null;
  const forcedSeason = ['spring', 'summer', 'autumn', 'winter'].includes(preview.get('season'))
    ? preview.get('season')
    : null;
  if (forcedSeason) seasonOverride = forcedSeason;
  const currentTime = () => {
    const d = new Date();
    if (forcedHour !== null) {
      d.setHours(Math.floor(forcedHour), Math.round((forcedHour % 1) * 60), 0, 0);
    }
    return d;
  };
  let now = currentTime();
  let pal = skyPalette(now.getHours() + now.getMinutes() / 60);
  let season = seasonForDate(now);
  let stars = [];
  let clouds = [];
  let tufts = [];
  let flowers = [];
  let particles = [];
  const heart = { t: 0, next: 5200, active: undefined };
  const anchors = {};

  /** 季节色跟着一天的光走：夜里往月光蓝里收，白天是自己的颜色 */
  function lit(color) {
    return mix(pal.hillFar, color, clamp(pal.light * 1.05, 0.08, 1));
  }

  /** 手机上有底部标签栏，小动物要站在它上方那条「世界带」里 */
  function bottomChrome() {
    if (!window.matchMedia('(max-width: 900px)').matches) return 0;
    const nav = document.querySelector('.nav');
    if (!nav) return 0;
    const rect = nav.getBoundingClientRect();
    return rect.height > 0 ? rect.height : 0;
  }

  function computeAnchors() {
    anchors.horizon = Math.round(H * 0.5);
    anchors.groundTop = Math.round(H * 0.545);
    const bottom = bottomChrome();
    anchors.feet = Math.round((cssH - bottom - 26) / unit);
    anchors.path = clamp(anchors.feet, Math.round(H * 0.62), H - 4);
    anchors.unit = unit;
  }

  function seedWorld() {
    const r = rng(20240520);
    stars = Array.from({ length: 90 }, () => ({
      x: Math.floor(r() * W),
      y: Math.floor(r() * anchors.horizon * 0.9),
      s: r() > 0.92 ? 2 : 1,
      p: r() * Math.PI * 2,
    }));
    clouds = Array.from({ length: 6 }, () => ({
      x: r() * W,
      y: Math.round(anchors.horizon * (0.08 + r() * 0.55)),
      w: 12 + Math.floor(r() * 26),
      h: 2 + Math.floor(r() * 3),
      speed: 1.4 + r() * 2.0,
    }));
    tufts = Array.from({ length: 90 }, () => ({ x: r() * W, y: 0, depth: r(), kind: r(), size: 1 + Math.floor(r() * 2) }));
    flowers = Array.from({ length: 26 }, () => ({ x: r() * W, depth: r() }));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    unit = clamp(Math.round(Math.min(cssW / 470, cssH / 290)), 2, 4);
    W = Math.ceil(cssW / unit);
    H = Math.ceil(cssH / unit);
    canvas.width = W;
    canvas.height = H;
    back.width = W;
    back.height = H;
    ctx.imageSmoothingEnabled = false;
    bctx.imageSmoothingEnabled = false;
    computeAnchors();
    seedWorld();
    backKey = '';
    drawBack(true);
    draw();
  }

  const ridge = (x, yBase, amp, f1, f2, off) =>
    yBase -
    (Math.sin(x * f1 + off) * 0.62 + Math.sin(x * f2 + off * 1.7) * 0.26 + Math.sin(x * f1 * 2.7 + off * 0.6) * 0.12) * amp;

  const nearRidge = (x) => ridge(x, Math.round(anchors.horizon + H * 0.06), 14, 0.033, 0.012, 5.1);

  function ditherRow(x0, x1, y, color, phase = 0) {
    bctx.fillStyle = color;
    for (let x = x0; x < x1; x += 2) bctx.fillRect(x + ((x / 2 + phase) % 2), y, 1, 1);
  }

  function drawBack(force = false) {
    const hour = now.getHours() + now.getMinutes() / 60;
    const key = `${W}x${H}:${Math.floor(hour * 8)}:${season.id}:${seasonOverride}`;
    if (!force && key === backKey) return;
    backKey = key;
    bctx.clearRect(0, 0, W, H);

    // 天空：分成 14 段 + 交界处棋盘抖动，像老游戏
    const horizon = anchors.horizon;
    const groundTop = anchors.groundTop;
    const steps = 14;
    const bandH = Math.max(1, horizon / steps);
    for (let s = 0; s < steps; s += 1) {
      const t = s / (steps - 1);
      const y0 = Math.round(s * bandH);
      const y1 = s === steps - 1 ? horizon : Math.round((s + 1) * bandH);
      bctx.fillStyle = mix(pal.sky1, pal.sky2, t);
      bctx.fillRect(0, y0, W, y1 - y0);
      if (s < steps - 1) {
        ditherRow(0, W, y1, mix(pal.sky1, pal.sky2, (s + 1) / (steps - 1)), s);
      }
    }

    // 地平线到地面之间铺一层雾，顺便保证这一条不会漏出底色
    bctx.fillStyle = pal.haze;
    bctx.fillRect(0, horizon, W, Math.max(0, groundTop - horizon) + 10);
    bctx.fillStyle = mix(pal.sky2, pal.haze, 0.6);
    bctx.fillRect(0, horizon, W, 2);

    // 远山（淡、偏天空色，制造空气感），底下用雾色兜住
    bctx.fillStyle = mix(pal.hillFar, pal.haze, 0.45);
    for (let x = 0; x < W; x += 1) {
      const y = Math.round(ridge(x, horizon + 4, 20, 0.021, 0.009, 1.7));
      bctx.fillRect(x, y, 1, H - y);
    }
    // 雪线
    if (season.id === 'winter') {
      bctx.fillStyle = '#EFF6F8';
      for (let x = 0; x < W; x += 1) {
        const y = Math.round(ridge(x, horizon + 4, 20, 0.021, 0.009, 1.7));
        if (y < horizon - 3) bctx.fillRect(x, y, 1, 1);
      }
    }

    // 近山
    bctx.fillStyle = mix(pal.hillNear, pal.haze, 0.18);
    for (let x = 0; x < W; x += 1) {
      const y = Math.round(nearRidge(x));
      bctx.fillRect(x, y, 1, H - y);
    }
    // 山脚一层更亮的草坡，把山和地面接起来
    bctx.fillStyle = mix(lit(season.ground), pal.haze, 0.22);
    for (let x = 0; x < W; x += 1) {
      const y = Math.round(groundTop + Math.sin(x * 0.045 + 2.2) * 2 + Math.sin(x * 0.013) * 3);
      bctx.fillRect(x, y, 1, H - y);
    }

    // 树：沿近山线排开
    const treeColor = lit(seasonOverride === 'auto' ? season.tree : SEASONS[seasonOverride].tree);
    const treeAlt = lit(seasonOverride === 'auto' ? season.treeAlt : SEASONS[seasonOverride].treeAlt);
    for (let i = 0; i < 18; i += 1) {
      const r = rng(i * 7919 + 31);
      const x = Math.floor((i / 18) * W + r() * 11);
      const baseY = Math.round(nearRidge(x));
      const th = 5 + Math.floor(r() * 5);
      const tw = 5 + Math.floor(r() * 4);
      bctx.fillStyle = mix(pal.hillNear, '#000000', 0.25);
      bctx.fillRect(x + Math.floor(tw / 2), baseY - 2, 1, 4);
      bctx.fillStyle = i % 3 === 0 ? treeAlt : treeColor;
      for (let y = 0; y < th; y += 1) {
        const w = Math.max(1, tw - Math.abs(y - Math.floor(th / 2)) * 1.2);
        bctx.fillRect(x + Math.floor((tw - w) / 2), baseY - 3 - th + y, Math.ceil(w), 1);
      }
      if (season.id === 'winter') {
        bctx.fillStyle = '#F2F8FA';
        bctx.fillRect(x + Math.floor(tw / 2) - 1, baseY - 3 - th, 3, 1);
      }
      if (season.id === 'spring') {
        bctx.fillStyle = '#FFE1EA';
        bctx.fillRect(x + 1, baseY - 4 - Math.floor(th / 2), 1, 1);
        bctx.fillRect(x + tw - 1, baseY - 5 - Math.floor(th / 2), 1, 1);
      }
    }

    // 地面：四层色带，越近越暗，形成纵深
    const g = lit(seasonOverride === 'auto' ? season.ground : SEASONS[seasonOverride].ground);
    const gAlt = lit(seasonOverride === 'auto' ? season.groundAlt : SEASONS[seasonOverride].groundAlt);
    const bands = [
      [0.0, 0.22, mix(g, pal.haze, 0.26)],
      [0.22, 0.58, g],
      [0.58, 1.0, shade(mix(g, gAlt, 0.25), 0.06)],
    ];
    for (let b = 0; b < bands.length; b += 1) {
      const [, , color] = bands[b];
      const y0 = Math.round(groundTop + (H - groundTop) * bands[b][0]);
      const y1 = b === bands.length - 1 ? H : Math.round(groundTop + (H - groundTop) * bands[b][1]);
      bctx.fillStyle = color;
      bctx.fillRect(0, y0, W, y1 - y0);
      if (b > 0) ditherRow(0, W, y0, bands[b - 1][2], b);
    }

    // 灌木和小石头：给空旷的草地一点东西看
    const bushBase = mix(lit(seasonOverride === 'auto' ? season.ground : SEASONS[seasonOverride].ground), treeColor, 0.5);
    const bush = shade(bushBase, 0.16);
    for (let i = 0; i < 8; i += 1) {
      const r = rng(i * 5231 + 91);
      const x = Math.floor(r() * W);
      const y = Math.round(groundTop + (H - groundTop) * (0.22 + r() * 0.58));
      const w = 5 + Math.floor(r() * 5);
      const h = 3 + Math.floor(r() * 2);
      bctx.fillStyle = shade(bush, 0.22);
      bctx.fillRect(x, y + h, w, 1);
      bctx.fillStyle = bush;
      for (let k = 0; k < h; k += 1) {
        const ww = Math.max(2, w - k);
        bctx.fillRect(x + Math.floor((w - ww) / 2), y + h - k, ww, 1);
      }
      bctx.fillStyle = mix(bush, '#FFFFFF', 0.18);
      bctx.fillRect(x + 1, y + h - h + 1, 2, 1);
      if (season.id === 'winter') {
        bctx.fillStyle = '#F4FAFC';
        bctx.fillRect(x + Math.floor(w / 2) - 1, y, 2, 1);
      }
    }
    for (let i = 0; i < 10; i += 1) {
      const r = rng(i * 977 + 13);
      const x = Math.floor(r() * W);
      const y = Math.round(groundTop + (H - groundTop) * (0.16 + r() * 0.62));
      const w = 1 + Math.floor(r() * 3);
      bctx.fillStyle = mix(lit(season.ground), '#6B6478', 0.45);
      bctx.fillRect(x, y, w, 1);
      bctx.fillRect(x + (w > 1 ? 1 : 0), y + 1, Math.max(1, w - 1), 1);
    }

    // 小路：一条浅浅的土路，正好落在小人脚下
    const pathTop = anchors.path - 4;
    const pathBottom = Math.min(H - 3, anchors.path + 6);
    const pathColor = mix(lit('#D9C69B'), pal.haze, 0.12);
    bctx.fillStyle = pathColor;
    bctx.fillRect(0, pathTop, W, pathBottom - pathTop);
    ditherRow(0, W, pathTop - 1, pathColor, 0);
    ditherRow(0, W, pathBottom, shade(pathColor, 0.18), 1);
    bctx.fillStyle = shade(pathColor, 0.12);
    bctx.fillRect(0, pathBottom - 1, W, 1);

    // 最前面一条草边，压住画面
    const fg = shade(lit(season.ground), 0.22);
    bctx.fillStyle = fg;
    bctx.fillRect(0, H - Math.max(3, Math.round(H * 0.018)), W, H);
  }

  function drawStars() {
    if (pal.star <= 0.02) return;
    const t = performance.now() / 900;
    for (const s of stars) {
      const tw = 0.55 + 0.45 * Math.sin(t + s.p);
      ctx.fillStyle = `rgba(255,250,235,${(pal.star * tw).toFixed(2)})`;
      if (s.s === 2) {
        ctx.fillRect(s.x, s.y, 2, 1);
        ctx.fillRect(s.x, s.y - 1, 1, 1);
      } else ctx.fillRect(s.x, s.y, 1, 1);
    }
  }

  function drawCelestial() {
    const hour = now.getHours() + now.getMinutes() / 60;
    const horizon = anchors.horizon;
    const disc = (cx, cy, R, color) => {
      ctx.fillStyle = color;
      for (let dy = -R; dy <= R; dy += 1) {
        const span = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
        ctx.fillRect(cx - span, cy + dy, span * 2, 1);
      }
    };
    const halo = (cx, cy, R, color) => {
      ctx.fillStyle = color;
      for (let dy = -R; dy <= R; dy += 1) {
        const span = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
        for (let x = cx - span; x < cx + span; x += 2) ctx.fillRect(x + (dy % 2), cy + dy, 1, 1);
      }
    };

    if (hour >= 6 && hour < 18.4) {
      const t = clamp((hour - 6) / 12.4, 0, 1);
      const x = Math.round(W * (0.09 + 0.82 * t));
      const y = Math.round(horizon - Math.sin(Math.PI * t) * (horizon * 0.72));
      const R = Math.max(3, Math.round(H * 0.02));
      halo(x, y, R + 5, 'rgba(255,246,214,0.16)');
      disc(x, y, R, pal.sun);
    } else {
      const hourNight = hour < 6 ? hour + 24 : hour;
      const t = clamp((hourNight - 18.4) / 11.2, 0, 1);
      const x = Math.round(W * (0.14 + 0.7 * t));
      const y = Math.round(horizon - Math.sin(Math.PI * t) * (horizon * 0.66));
      const R = Math.max(2, Math.round(H * 0.016));
      halo(x, y, R + 6, 'rgba(240,235,210,0.12)');
      disc(x, y, R, '#F6EBD0');
      // 用当地天空色咬出月牙
      disc(x + Math.max(1, Math.round(R * 0.8)), y - Math.max(1, Math.round(R * 0.35)), R, mix(pal.sky1, pal.sky2, clamp(y / horizon, 0, 1)));
    }
  }

  function drawClouds(dt) {
    const night = pal.star > 0.45;
    const body = night ? mix('#5A5280', pal.sky2, 0.25) : '#FFFFFF';
    const edge = night ? mix('#6E6690', pal.sky2, 0.2) : '#F1F6F9';
    for (const c of clouds) {
      if (!reduced) c.x -= c.speed * dt * 0.006;
      if (c.x < -c.w - 6) c.x = W + c.w;
      const x = Math.round(c.x);
      ctx.fillStyle = body;
      ctx.fillRect(x, c.y + c.h, c.w, c.h);
      ctx.fillRect(x + 3, c.y, Math.round(c.w * 0.5), c.h);
      ctx.fillRect(x + Math.round(c.w * 0.42), c.y + 1, Math.round(c.w * 0.44), c.h);
      ctx.fillStyle = edge;
      ctx.fillRect(x, c.y + c.h * 2, c.w, 1);
    }
  }

  function drawGroundDetail() {
    const top = anchors.groundTop;
    const depthY = (d) => Math.round(top + (H - top) * (0.12 + d * 0.84));
    // 草簇
    for (let i = 0; i < tufts.length; i += 1) {
      const t = tufts[i];
      const y = depthY(t.depth);
      const par = 0.25 + t.depth * 1.15;
      const x = Math.round((((t.x - scroll * par) % (W + 8)) + W + 8) % (W + 8) - 4);
      const lit1 = lit(seasonOverride === 'auto' ? season.groundAlt : SEASONS[seasonOverride].groundAlt);
      ctx.fillStyle = t.kind > 0.62 ? shade(lit1, 0.28) : mix(lit1, '#FFFFFF', 0.1);
      ctx.fillRect(x, y, 1, 1);
      if (t.size > 1 && t.depth > 0.35) {
        ctx.fillRect(x + 1, y - 1, 1, 2);
        ctx.fillRect(x - 1, y, 1, 1);
      }
    }
    // 小花与雪堆
    for (let i = 0; i < flowers.length; i += 1) {
      const f = flowers[i];
      const y = depthY(f.depth) - 1;
      const par = 0.3 + f.depth * 1.2;
      const x = Math.round((((f.x - scroll * par) % (W + 10)) + W + 10) % (W + 10) - 5);
      ctx.fillStyle = lit(seasonOverride === 'auto' ? season.flower : SEASONS[seasonOverride].flower);
      ctx.fillRect(x, y, 1, 1);
      if (f.depth > 0.5) {
        ctx.fillStyle = shade(lit(season.ground), 0.3);
        ctx.fillRect(x, y + 1, 1, 1);
      }
    }
  }

  function spawnParticle() {
    if (particles.length > 48) return;
    const kind = season.particle;
    const color = season.particleColors[Math.floor(Math.random() * season.particleColors.length)];
    if (kind === 'firefly') {
      particles.push({ x: Math.random() * W, y: anchors.path - 4 - Math.random() * H * 0.14, vx: (Math.random() - 0.5) * 3, vy: (Math.random() - 0.5) * 2, life: 3200, t: 0, color, kind });
    } else if (kind === 'snow') {
      particles.push({ x: Math.random() * W, y: -2, vx: (Math.random() - 0.5) * 2, vy: 4 + Math.random() * 6, life: 20000, t: 0, color, kind });
    } else {
      particles.push({ x: Math.random() * W, y: -2 - Math.random() * 20, vx: -2 - Math.random() * 4, vy: 3 + Math.random() * 3, life: 12000, t: 0, color, kind });
    }
  }

  function updateParticles(dt) {
    if (reduced) return;
    if (Math.random() < (season.particle === 'snow' ? 0.07 : 0.04)) spawnParticle();
    for (let i = particles.length - 1; i >= 0; i -= 1) {
      const p = particles[i];
      p.t += dt;
      p.x += p.vx * dt * 0.012;
      p.y += p.vy * dt * 0.012;
      if (p.kind === 'firefly') {
        p.x += Math.sin(p.t / 700 + p.y) * 0.3;
        p.y += Math.cos(p.t / 900) * 0.2;
      }
      if (p.kind === 'leaf' || p.kind === 'petal') p.x += Math.sin(p.t / 620 + p.y * 0.2) * 0.4;
      if (p.t > p.life || p.y > H + 4 || p.x < -6) particles.splice(i, 1);
    }
  }

  function drawParticles(front) {
    for (const p of particles) {
      const near = p.y > anchors.path - 8;
      if (front !== near) continue;
      if (p.kind === 'firefly') {
        const flicker = 0.5 + 0.5 * Math.sin(p.t / 220 + p.x);
        ctx.fillStyle = `rgba(255,247,180,${(0.35 + 0.5 * flicker).toFixed(2)})`;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
        if (flicker > 0.72) {
          ctx.fillStyle = 'rgba(255,250,210,0.2)';
          ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y), 3, 1);
        }
      } else {
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.kind === 'snow' ? 1 : 2, 1);
      }
    }
  }

  function drawCouple(dt) {
    const feet = anchors.path;
    const baseX = Math.round(W * 0.44 - 24);
    const phase = (scroll / 13) % 1;
    const catTop = feet - totalHeight(CAT);
    const dogTop = feet - totalHeight(DOG);
    const dogX = baseX + CAT.w + 3;

    // 夜里给它们一小圈暖光
    if (pal.light < 0.4) {
      const cx = baseX + Math.round((CAT.w + DOG.w) / 2);
      const cy = feet - 9;
      const strength = (0.4 - pal.light) / 0.4;
      const R = 16;
      for (let dy = -R; dy <= R; dy += 1) {
        const span = Math.round(Math.sqrt(Math.max(0, R * R - dy * dy)));
        for (let x = cx - span; x < cx + span; x += 2) {
          ctx.fillStyle = `rgba(255,214,140,${(0.11 * strength).toFixed(3)})`;
          ctx.fillRect(x + (dy % 2), cy + dy, 1, 1);
        }
      }
    }

    drawCharacter(ctx, CAT, baseX, catTop, phase);
    drawCharacter(ctx, DOG, dogX, dogTop, (phase + 0.5) % 1);

    heart.t += dt;
    if (heart.t > heart.next) {
      heart.t = 0;
      heart.next = 7000 + Math.random() * 6000;
      heart.active = 0;
    }
    if (heart.active !== undefined) {
      heart.active += dt;
      const life = 1700;
      if (heart.active > life) heart.active = undefined;
      else {
        const p = heart.active / life;
        const hx = baseX + Math.round((CAT.w + DOG.w) / 2) - 1;
        const hy = Math.min(catTop, dogTop) - 5 - Math.round(p * 15);
        ctx.fillStyle = `rgba(226,102,134,${(0.9 * (1 - p)).toFixed(2)})`;
        ctx.fillRect(hx, hy, 3, 1);
        ctx.fillRect(hx, hy + 1, 3, 1);
        ctx.fillRect(hx + 1, hy + 2, 1, 1);
      }
    }
  }

  function draw(dt = 16) {
    // 先铺一层底色：任何一层没画到的地方都不会露出黑
    ctx.fillStyle = pal.haze;
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(back, 0, 0);
    drawStars();
    drawCelestial();
    drawClouds(dt);
    drawGroundDetail();
    drawParticles(false);
    drawCouple(dt);
    drawParticles(true);
  }

  function refreshTime() {
    if (forcedHour !== null) return;
    now = currentTime();
    pal = skyPalette(now.getHours() + now.getMinutes() / 60);
    season = seasonForDate(now);
    drawBack();
    if (onTick) onTick(info());
  }

  function info() {
    const hour = now.getHours() + now.getMinutes() / 60;
    const phase = phaseForHour(hour);
    const active = seasonOverride === 'auto' ? season : SEASONS[seasonOverride];
    return { hour, phase, season: active, night: phase.night, date: now, light: pal.light };
  }

  function frame(ts) {
    if (!running) return;
    const dt = Math.min(60, ts - (last || ts));
    last = ts;
    if (!reduced) scroll += dt * 0.024;
    updateParticles(dt);
    draw(dt);
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    running = false;
    cancelAnimationFrame(raf);
  }

  function onResize() {
    const rect = canvas.getBoundingClientRect();
    if (Math.round(rect.width) === cssW && Math.round(rect.height) === cssH) return;
    resize();
  }

  let resizeTimer = 0;
  const resizeHandler = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(onResize, 120);
  };
  window.addEventListener('resize', resizeHandler);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else start();
  });

  const clock = setInterval(() => {
    if (forcedHour !== null) return;
    const before = `${now.getHours()}:${Math.floor(now.getMinutes() / 10)}`;
    now = currentTime();
    if (before !== `${now.getHours()}:${Math.floor(now.getMinutes() / 10)}`) refreshTime();
  }, 20000);

  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    resize();
    start();
    if (onTick) onTick(info());
  });

  return {
    start,
    stop,
    info,
    refresh: refreshTime,
    /** 界面结构变了（比如登录后出现底部标签栏）时重新算一次站位 */
    relayout() {
      computeAnchors();
      backKey = '';
      drawBack(true);
      draw();
    },
    setSeason(value) {
      seasonOverride = value;
      backKey = '';
      drawBack(true);
    },
    setReduced(value) {
      reduced = value;
    },
    destroy() {
      stop();
      clearInterval(clock);
      window.removeEventListener('resize', resizeHandler);
    },
  };
}
