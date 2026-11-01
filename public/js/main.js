// 日记本 · 主程序：登录、导航、底部卡带机、世界与视线的联动
import { createWorld } from './scene.js';
import { CAT, DOG, avatarDataUrl, validateSprites } from './sprites.js';
import { icon, validateIcons } from './icons.js';
import { createPlayer } from './music.js';
import { api } from './api.js';
import { $, toast, esc, formatDate } from './ui.js';
import { lunarOf } from './lunar.js';
import * as timeView from './views/time.js';
import * as musicView from './views/music.js';
import * as wordsView from './views/words.js';
import * as momentsView from './views/moments.js';
import * as galleryView from './views/gallery.js';
import * as calendarView from './views/calendar.js';
import * as cartView from './views/cart.js';
import * as petView from './views/pet.js';

const ROUTES = [
  { id: 'time', label: '恋爱时间', short: '时间', icon: 'heart', view: timeView },
  { id: 'music', label: '一起听歌', short: '听歌', icon: 'note', view: musicView },
  { id: 'words', label: '悄悄话', short: '说话', icon: 'bubble', view: wordsView },
  { id: 'moments', label: '日常分享', short: '日常', icon: 'camera', view: momentsView },
  { id: 'gallery', label: '照片墙', short: '照片', icon: 'picture', view: galleryView },
  { id: 'calendar', label: '日历', short: '日历', icon: 'calendar', view: calendarView },
  { id: 'cart', label: '购物车', short: '购物', icon: 'cart', view: cartView },
  { id: 'pet', label: '培养', short: '培养', icon: 'sprout', view: petView },
];

validateSprites();
validateIcons();

const avatars = { cat: avatarDataUrl(CAT, 3), dog: avatarDataUrl(DOG, 3) };
const world = createWorld($('#world'), { onTick: (info) => onWorldTick(info) });
const player = createPlayer({ onState: paintPocket });

const ctx = {
  user: null,
  accounts: [],
  settings: {},
  counts: {},
  events: [],
  avatars,
  player,
  world,
  rerender,
  bumpCount,
  navigate,
};

let cleanup = null;
let rendering = false;

// ── 世界 → 界面 ─────────────────────────────────────────
function bandNote(info) {
  const lunar = lunarOf(info.date);
  const clock = info.date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(info.date, { withWeekday: true })} · ${clock}
${info.phase.name} · ${info.season.name} · 农历${lunar.monthLabel}${lunar.dayLabel}`;
}

let lastNight = null;
function onWorldTick(info) {
  const note = $('#band-note');
  if (note) note.textContent = bandNote(info);
  const night = info.night ? 'on' : 'off';
  if (night !== lastNight) {
    lastNight = night;
    document.documentElement.dataset.night = night;
  }
}

// ── 底部卡带机 ──────────────────────────────────────────
function paintPocket(state) {
  const glow = state.playing ? 'pause' : 'play';
  const label = state.playing ? '暂停' : '播放';
  const btn = $('#pocket-play');
  if (btn) {
    btn.innerHTML = icon(glow, { size: 14 });
    btn.setAttribute('aria-label', label);
  }
  const head = $('#head-play');
  if (head) {
    head.innerHTML = icon(glow, { size: 13 });
    head.setAttribute('aria-label', label);
  }
  const titleEl = $('#pocket-title');
  if (titleEl) titleEl.textContent = state.track.title;
  const subEl = $('#pocket-sub');
  if (subEl) subEl.textContent = state.playing ? '正在循环' : '点一下播放';
  $('#pocket')?.classList.toggle('is-playing', state.playing);
}

$('#pocket-play').addEventListener('click', () => {
  player.toggle();
});
$('#head-play')?.addEventListener('click', () => {
  player.toggle();
});
$('#pocket-next').addEventListener('click', () => player.next());
$('#pocket-meta')?.addEventListener('click', () => navigate('music'));

// ── 登录 ────────────────────────────────────────────────
function renderWhoPick(accounts) {
  const host = $('#who-pick');
  if (!host) return;
  host.innerHTML = accounts
    .map(
      (a, i) => `<label class="who-option">
        <input type="radio" name="who" value="${esc(a.id)}" ${i === 0 ? 'checked' : ''}>
        <img src="${avatars[a.avatar] || avatars.cat}" alt="">
        <span>${esc(a.name)}</span>
      </label>`,
    )
    .join('');
}

function showLogin(message = '') {
  $('#app').hidden = true;
  $('#login').hidden = false;
  const err = $('#login-error');
  if (message) {
    err.textContent = message;
    err.hidden = false;
    $('#login-card').classList.remove('login-shake');
    void $('#login-card').offsetWidth;
    $('#login-card').classList.add('login-shake');
  } else {
    err.hidden = true;
  }
  requestAnimationFrame(() => world.relayout());
  setTimeout(() => $('#login-pass')?.focus(), 120);
}

async function enterApp(user) {
  ctx.user = user;
  const boot = await api.bootstrap();
  ctx.settings = boot.settings;
  ctx.counts = boot.counts || {};
  ctx.user = boot.user || user;
  world.setSeason(ctx.settings.season || 'auto');
  applySettings();
  $('#login').hidden = true;
  $('#app').hidden = false;
  buildNav();
  requestAnimationFrame(() => world.relayout());
  routeFromHash();
  window.addEventListener('hashchange', routeFromHash);
}

function applySettings() {
  const s = ctx.settings;
  $('#brand-sub').textContent = `${s.herName} & ${s.hisName} 的日记本`;
  const who = $('#whoami');
  who.innerHTML = `<img src="${avatars[ctx.user.avatar] || avatars.cat}" alt="">
    <div><b>${esc(ctx.user.name)}</b><span>今天也一起走走</span></div>`;
}

$('#login-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const btn = $('#login-submit');
  const who = new FormData(ev.target).get('who');
  const password = $('#login-pass').value;
  btn.disabled = true;
  btn.textContent = '正在开门…';
  try {
    const res = await api.login(who, password);
    player.unlock();
    await enterApp(res.user);
    player.setVolume(0.42);
    player.play();
    toast(`${res.user.name}回来啦`);
  } catch (err) {
    showLogin(err.message || '进不去');
    $('#login-pass').value = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '推门进去';
  }
});

$('#logout').addEventListener('click', async () => {
  try {
    await api.logout();
  } catch {
    /* 忽略 */
  }
  player.pause();
  window.removeEventListener('hashchange', routeFromHash);
  ctx.user = null;
  showLogin('门关上了');
});

// ── 导航与渲染 ──────────────────────────────────────────
function buildNav() {
  const nav = $('#nav');
  nav.innerHTML = ROUTES.map(
    (r) => `<button class="nav-item" data-route="${r.id}">
      ${icon(r.icon, { size: 16 })}<span class="nav-full">${r.label}</span><span class="nav-short">${r.short}</span>
    </button>`,
  ).join('');
  nav.querySelectorAll('[data-route]').forEach((btn) =>
    btn.addEventListener('click', () => {
      navigate(btn.dataset.route);
    }),
  );
}

function navigate(id) {
  const target = `#/${id}`;
  if (location.hash === target) routeFromHash();
  else location.hash = target;
}

function routeFromHash() {
  if (!ctx.user) return;
  const id = (location.hash.replace(/^#\/?/, '') || 'time').split('?')[0];
  const route = ROUTES.find((r) => r.id === id) || ROUTES[0];
  document.querySelectorAll('[data-route]').forEach((btn) => {
    if (btn.dataset.route === route.id) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  });
  renderRoute(route);
}

async function renderRoute(route) {
  if (rendering) return;
  rendering = true;
  const view = $('#view');
  try {
    if (typeof cleanup === 'function') cleanup();
    cleanup = null;
    view.innerHTML = `<div class="empty"><span class="spinner"></span></div>`;
    view.setAttribute('aria-busy', 'true');
    const out = await route.view.render(view, ctx);
    cleanup = typeof out === 'function' ? out : null;
    const scroller = $('#canvas');
    if (scroller) scroller.scrollTop = 0;
    view.focus({ preventScroll: true });
  } catch (err) {
    if (err.status === 401) {
      showLogin('要重新登录一下');
    } else {
      view.innerHTML = `<div class="empty"><p class="empty-title">这个房间暂时打不开</p>
        <p class="empty-text">${esc(err.message || '未知错误')}</p></div>`;
    }
  } finally {
    view.removeAttribute('aria-busy');
    rendering = false;
  }
}

function rerender() {
  routeFromHash();
}

function bumpCount(key, delta) {
  ctx.counts[key] = Math.max(0, (ctx.counts[key] || 0) + delta);
}

ctx.onSettingsChanged = (settings) => {
  ctx.settings = settings;
  world.setSeason(settings.season || 'auto');
  applySettings();
};

// ── 启动 ────────────────────────────────────────────────
(async function boot() {
  let session = null;
  try {
    session = await api.session();
  } catch {
    showLogin('服务好像没启动');
    return;
  }
  ctx.accounts = session.accounts || [];
  renderWhoPick(ctx.accounts);
  if (session.user) {
    try {
      await enterApp(session.user);
    } catch (err) {
      showLogin(err.message || '进不去');
    }
  } else {
    showLogin();
  }
})();
