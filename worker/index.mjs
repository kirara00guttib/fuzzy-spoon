// 日记本 · Cloudflare Workers 版后端
// 接口和本地 Node 版完全一致（前端一行都不用改），只是把
//   data/store.json → KV      data/uploads → R2（预签名直传）
import { accounts, parseCookies, readToken, issueToken, cookieFor, clearCookie, verifyCredentials, otherAccountWithPassword, tooManyAttempts, noteFailure, clearFailures, COOKIE_NAME } from './auth.mjs';
import { read, mutate, newId, PET_STAGES } from './store.mjs';
import { presignPut, presignGet, presignDelete, r2Config, encodeKey } from './sigv4.mjs';

const PHOTO_PREFIX = 'photos/';
const MAX_PHOTO = 20 * 1024 * 1024;

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy':
    "default-src 'self'; img-src 'self' blob: data: https:; media-src 'self' blob: https:; " +
    "style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self' https:; " +
    "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...SECURITY_HEADERS, ...extra },
  });

const ok = (data = {}, extra = {}) => json({ ok: true, ...data }, 200, extra);
const bad = (status, message) => json({ ok: false, error: message }, status);

const text = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const int = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null;
};

function safeKey(key) {
  const k = String(key || '');
  if (!k.startsWith(PHOTO_PREFIX)) return null;
  if (k.includes('..') || k.includes('//') || k.includes('\\')) return null;
  if (!/^photos\/[a-z0-9/._-]+$/i.test(k)) return null;
  return k;
}

// 读取链接：桶绑了公开域名就直接用，否则每次签一条 6 小时的 GET
const urlCache = new Map();
async function mediaUrl(env, key) {
  const hit = urlCache.get(key);
  if (hit && hit.expiresAt - Date.now() > 20 * 60 * 1000) return hit.url;
  const signed = await presignGet(env, key);
  urlCache.set(key, signed);
  return signed.url;
}

async function withUrl(env, photo) {
  return { ...photo, url: await mediaUrl(env, photo.key) };
}

async function deleteObject(env, key) {
  try {
    const { url } = await presignDelete(env, key);
    await fetch(url, { method: 'DELETE' });
  } catch (err) {
    console.warn('[r2] 删除失败', key, err && err.message);
  }
}

// ── 各个接口 ────────────────────────────────────────────
async function handleLogin(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  if (tooManyAttempts(ip)) return bad(429, '试太多次啦，等五分钟再来');
  let body;
  try {
    body = await request.json();
  } catch {
    return bad(400, '请求格式不对');
  }
  const username = text(body.username, 80);
  const password = String(body.password ?? '');
  const account = verifyCredentials(env, username, password);
  if (!account) {
    const other = otherAccountWithPassword(env, username, password);
    if (other) return bad(401, `这是${other.name}的密码哦，上面「你是谁」换成${other.name}再试`);
    noteFailure(ip);
    return bad(401, '账号或密码不对哦');
  }
  clearFailures(ip);
  const token = await issueToken(env, account.id);
  const secure = new URL(request.url).protocol === 'https:';
  return ok(
    { user: { id: account.id, name: account.name, avatar: account.avatar } },
    { 'set-cookie': cookieFor(token, secure) },
  );
}

function handleLogout(request) {
  const secure = new URL(request.url).protocol === 'https:';
  return ok({}, { 'set-cookie': clearCookie(secure) });
}

function accountList(env) {
  return accounts(env).map((a) => ({ id: a.id, name: a.name, avatar: a.avatar }));
}

async function handleBootstrap(env, user) {
  const db = await read(env);
  return ok({
    user,
    settings: db.settings,
    storage: { mode: r2Config(env).configured ? 'r2' : 'unconfigured' },
    counts: { notes: db.notes.length, moments: db.moments.length, photos: db.photos.length, events: db.events.length },
  });
}

async function handleSettings(request, env) {
  const body = await request.json().catch(() => ({}));
  const updated = await mutate(env, (db) => {
    const s = db.settings;
    if (body.startedAt !== undefined) {
      const t = new Date(String(body.startedAt));
      if (!Number.isNaN(t.getTime())) s.startedAt = t.toISOString();
    }
    if (body.herName !== undefined) s.herName = text(body.herName, 24) || s.herName;
    if (body.hisName !== undefined) s.hisName = text(body.hisName, 24) || s.hisName;
    if (['auto', 'spring', 'summer', 'autumn', 'winter'].includes(body.season)) s.season = body.season;
    for (const who of ['birthdayHer', 'birthdayHim']) {
      const b = body[who];
      if (!b || typeof b !== 'object') continue;
      s[who] = {
        type: ['solar', 'lunar', 'lunar-leap', 'lunar-offset'].includes(b.type) ? b.type : s[who].type,
        month: int(b.month, 1, 12) ?? s[who].month,
        day: int(b.day, 1, 31) ?? s[who].day,
        plusDays: int(b.plusDays, 0, 7) ?? s[who].plusDays ?? 0,
      };
    }
    return s;
  });
  return ok({ settings: updated });
}

async function handlePresign(request, env) {
  const body = await request.json().catch(() => ({}));
  const type = text(body.contentType, 80) || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|avif|gif)$/i.test(type)) return bad(400, '只收 jpg / png / webp / avif / gif');
  if (!r2Config(env).configured) return bad(500, '云端版还没配置 R2，见 README 第三部分');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' }[type.toLowerCase()] || 'jpg';
  const now = new Date();
  const key = `${PHOTO_PREFIX}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;
  const signed = await presignPut(env, key, type);
  return ok({ mode: 'r2', key, method: 'PUT', headers: { 'Content-Type': type }, uploadUrl: signed.url, expiresAt: signed.expiresAt });
}

async function handlePhotos(env) {
  const db = await read(env);
  const photos = await Promise.all(db.photos.map((p) => withUrl(env, p)));
  return ok({ photos, storage: { mode: 'r2' } });
}

async function handleAddPhoto(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const key = safeKey(body.key);
  if (!key) return bad(400, '图片地址不合法');
  const photo = await mutate(env, (db) => {
    const p = {
      id: newId(),
      key,
      caption: text(body.caption, 200),
      author: user.id,
      authorName: user.name,
      createdAt: new Date().toISOString(),
      w: int(body.w, 0, 20000) ?? 0,
      h: int(body.h, 0, 20000) ?? 0,
      size: int(body.size, 0, MAX_PHOTO) ?? 0,
      type: text(body.type, 60) || 'image/*',
      momentId: text(body.momentId, 32) || null,
    };
    db.photos.unshift(p);
    return p;
  });
  return ok({ photo: await withUrl(env, photo) });
}

async function handleMoments(env) {
  const db = await read(env);
  const photos = Object.fromEntries(db.photos.map((p) => [p.id, p]));
  const moments = await Promise.all(
    db.moments.map(async (m) => {
      const own = [];
      for (const id of m.photoIds || []) {
        const photo = photos[id];
        if (photo) own.push(await withUrl(env, photo));
      }
      return { ...m, photos: own };
    }),
  );
  return ok({ moments });
}

async function handleAddMoment(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const value = text(body.text, 2000);
  const date = day(body.date) || new Date().toISOString().slice(0, 10);
  const photoIds = Array.isArray(body.photoIds) ? body.photoIds.filter((x) => /^[a-f0-9]{16}$/.test(x)).slice(0, 9) : [];
  if (!value && !photoIds.length) return bad(400, '写一句话或者放一张照片吧');
  const mood = ['开心', '想你', '累但幸福', '有点emo', '超期待'].includes(body.mood) ? body.mood : '';
  const created = await mutate(env, (db) => {
    const m = {
      id: newId(),
      date,
      text: value,
      mood,
      bgm: body.bgm && typeof body.bgm === 'object' && text(body.bgm.title, 80)
        ? { title: text(body.bgm.title, 80), url: text(body.bgm.url, 500) }
        : null,
      photoIds,
      author: user.id,
      authorName: user.name,
      avatar: user.avatar,
      createdAt: new Date().toISOString(),
    };
    for (const p of db.photos) if (photoIds.includes(p.id)) p.momentId = m.id;
    db.moments.unshift(m);
    db.moments = db.moments.slice(0, 400);
    return m;
  });
  const db = await read(env);
  const photos = [];
  for (const id of created.photoIds) {
    const photo = db.photos.find((p) => p.id === id);
    if (photo) photos.push(await withUrl(env, photo));
  }
  return ok({ moment: { ...created, photos } });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // 公开接口
  if (method === 'POST' && path === '/api/login') return handleLogin(request, env);
  if (method === 'POST' && path === '/api/logout') return handleLogout(request);
  if (method === 'GET' && path === '/api/session') {
    const cookies = parseCookies(request.headers.get('cookie') || '');
    const user = await readToken(env, cookies[COOKIE_NAME]);
    return ok({ user, accounts: accountList(env) });
  }
  if (method === 'GET' && path === '/api/health') {
    return ok({ service: 'riji', runtime: 'cloudflare-worker', storage: r2Config(env).configured ? 'r2' : 'unconfigured', kv: Boolean(env.STORE) });
  }

  // 以下都要登录
  const cookies = parseCookies(request.headers.get('cookie') || '');
  const user = await readToken(env, cookies[COOKIE_NAME]);
  if (!user) return bad(401, '先登录吧');

  if (method === 'GET' && path === '/api/bootstrap') return handleBootstrap(env, user);

  if (method === 'PUT' && path === '/api/settings') return handleSettings(request, env);

  if (method === 'GET' && path === '/api/notes') {
    const db = await read(env);
    return ok({ notes: db.notes });
  }
  if (method === 'POST' && path === '/api/notes') {
    const body = await request.json().catch(() => ({}));
    const value = text(body.text, 600);
    if (!value) return bad(400, '写点什么吧');
    const note = await mutate(env, (db) => {
      const n = { id: newId(), text: value, author: user.id, authorName: user.name, avatar: user.avatar, createdAt: new Date().toISOString() };
      db.notes.unshift(n);
      db.notes = db.notes.slice(0, 500);
      return n;
    });
    return ok({ note });
  }
  const noteDel = path.match(/^\/api\/notes\/([a-f0-9]{16})$/);
  if (noteDel && method === 'DELETE') {
    await mutate(env, (db) => {
      db.notes = db.notes.filter((n) => n.id !== noteDel[1]);
    });
    return ok();
  }

  if (method === 'GET' && path === '/api/photos') return handlePhotos(env);
  if (method === 'POST' && path === '/api/photos') return handleAddPhoto(request, env, user);
  const photoId = path.match(/^\/api\/photos\/([a-f0-9]{16})$/);
  if (photoId && method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const updated = await mutate(env, (db) => {
      const p = db.photos.find((x) => x.id === photoId[1]);
      if (!p) return null;
      if (body.caption !== undefined) p.caption = text(body.caption, 200);
      return p;
    });
    if (!updated) return bad(404, '照片不见了');
    return ok({ photo: await withUrl(env, updated) });
  }
  if (photoId && method === 'DELETE') {
    const removed = await mutate(env, (db) => {
      const p = db.photos.find((x) => x.id === photoId[1]);
      if (!p) return null;
      db.photos = db.photos.filter((x) => x.id !== photoId[1]);
      for (const m of db.moments) m.photoIds = (m.photoIds || []).filter((id) => id !== photoId[1]);
      return p;
    });
    if (!removed) return bad(404, '照片不见了');
    urlCache.delete(removed.key);
    await deleteObject(env, removed.key);
    return ok();
  }

  if (method === 'GET' && path === '/api/moments') return handleMoments(env);
  if (method === 'POST' && path === '/api/moments') return handleAddMoment(request, env, user);
  const momentId = path.match(/^\/api\/moments\/([a-f0-9]{16})$/);
  if (momentId && method === 'DELETE') {
    await mutate(env, (db) => {
      db.moments = db.moments.filter((x) => x.id !== momentId[1]);
      for (const p of db.photos) if (p.momentId === momentId[1]) p.momentId = null;
    });
    return ok();
  }

  if (method === 'GET' && path === '/api/events') {
    const db = await read(env);
    return ok({ events: db.events });
  }
  if (method === 'POST' && path === '/api/events') {
    const body = await request.json().catch(() => ({}));
    const date = day(body.date);
    const title = text(body.title, 60);
    if (!date || !title) return bad(400, '日期和名字都要有');
    const event = await mutate(env, (db) => {
      const e = {
        id: newId(),
        date,
        title,
        yearly: Boolean(body.yearly),
        hue: ['rose', 'teal', 'gold'].includes(body.hue) ? body.hue : 'rose',
        note: text(body.note, 200),
        author: user.id,
      };
      db.events.push(e);
      return e;
    });
    return ok({ event });
  }
  const eventId = path.match(/^\/api\/events\/([a-f0-9]{16})$/);
  if (eventId && method === 'DELETE') {
    await mutate(env, (db) => {
      db.events = db.events.filter((e) => e.id !== eventId[1]);
    });
    return ok();
  }

  if (path === '/api/cart' || path.startsWith('/api/cart/')) {
    const r = await handleCartApi(request, env, path, method, user);
    if (r) return r;
  }
  if (path === '/api/pet' || path.startsWith('/api/pet/')) {
    const r = await handlePetApi(request, env, path, method, user);
    if (r) return r;
  }

  if (method === 'GET' && path === '/api/tracks') {
    const db = await read(env);
    return ok({ tracks: db.tracks });
  }
  if (method === 'POST' && path === '/api/tracks') {
    const body = await request.json().catch(() => ({}));
    const title = text(body.title, 60);
    const link = text(body.url, 500);
    if (!title || !/^https?:\/\//i.test(link)) return bad(400, '歌名和 http(s) 链接都要有');
    const track = await mutate(env, (db) => {
      const t = { id: newId(), title, url: link, kind: 'link', addedBy: user.id };
      db.tracks.push(t);
      return t;
    });
    return ok({ track });
  }
  const trackId = path.match(/^\/api\/tracks\/([a-f0-9]{16})$/);
  if (trackId && method === 'DELETE') {
    await mutate(env, (db) => {
      db.tracks = db.tracks.filter((t) => t.id !== trackId[1]);
    });
    return ok();
  }

// ── 购物车：想一起做的事 ────────────────────────────────
const FOOD_POOL = ['burger', 'fries', 'cola', 'pizza', 'roastChicken', 'cake', 'cupcake', 'croissant', 'bubbleTea', 'lollipop'];
const DAY = 86400000;

function petView(db, user, now = Date.now()) {
  const pet = db.pet;
  const stage = PET_STAGES[pet.stage] || PET_STAGES[0];
  const start = pet.stageStartedAt ? new Date(pet.stageStartedAt).getTime() : now;
  const elapsed = Math.max(0, now - start);
  const total = stage.days * DAY;
  const careOk = ['water', 'weed', 'feed'].every((k) => (pet.care[k] || 0) >= stage.need[k]);
  return {
    status: pet.status,
    stageIndex: pet.stage,
    stage: { key: stage.key, name: stage.name, days: stage.days, need: stage.need },
    stageCount: PET_STAGES.length,
    care: pet.care,
    careOk,
    timeOk: elapsed >= total,
    canAdvance: pet.status === 'growing' && elapsed >= total && careOk,
    progress: Math.min(1, elapsed / total),
    daysLeft: Math.max(0, Math.ceil((total - elapsed) / DAY)),
    hoursLeft: Math.max(0, Math.ceil((total - elapsed) / 3600000)),
    myConsent: Boolean(pet.consent[user.id]),
    consent: Object.keys(pet.consent),
    messages: (pet.messages || []).slice(-30),
    foods: pet.foods || {},
    wishes: (pet.wishes || []).slice().reverse(),
    pending: pet.pending,
    cycles: pet.cycles || 0,
  };
}

function petTick(db, now = Date.now()) {
  const pet = db.pet;
  let changed = false;
  while (pet.status === 'growing') {
    const stage = PET_STAGES[pet.stage];
    if (!stage) break;
    const start = pet.stageStartedAt ? new Date(pet.stageStartedAt).getTime() : now;
    const due = now - start >= stage.days * DAY;
    const cared = ['water', 'weed', 'feed'].every((k) => (pet.care[k] || 0) >= stage.need[k]);
    if (!due || !cared) break;
    if (pet.stage < PET_STAGES.length - 1) {
      pet.stage += 1;
      pet.stageStartedAt = new Date(now).toISOString();
      pet.care = { water: 0, weed: 0, feed: 0 };
    } else {
      pet.status = 'ready';
      pet.pending = { foodId: FOOD_POOL[Math.floor(Math.random() * FOOD_POOL.length)], at: new Date(now).toISOString() };
      pet.cycles = (pet.cycles || 0) + 1;
    }
    changed = true;
  }
  return changed;
}

async function handleCartApi(request, env, path, method, user) {
  if (path === '/api/cart' && method === 'GET') {
    const db = await read(env);
    return ok({ cart: db.cart });
  }
  if (path === '/api/cart' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const value = text(body.text, 120);
    if (!value) return bad(400, '想做的事得写一句');
    const item = await mutate(env, (db) => {
      const c = {
        id: newId(), text: value, note: text(body.note, 200),
        author: user.id, authorName: user.name, avatar: user.avatar,
        createdAt: new Date().toISOString(), done: false, doneAt: null, doneBy: null,
      };
      db.cart.unshift(c);
      return c;
    });
    return ok({ item });
  }
  const m = path.match(/^\/api\/cart\/([a-f0-9]{16})$/);
  if (m && method === 'PUT') {
    const body = await request.json().catch(() => ({}));
    const updated = await mutate(env, (db) => {
      const c = db.cart.find((x) => x.id === m[1]);
      if (!c) return null;
      if (body.done !== undefined) {
        c.done = Boolean(body.done);
        c.doneAt = c.done ? new Date().toISOString() : null;
        c.doneBy = c.done ? user.name : null;
      }
      if (body.text !== undefined) c.text = text(body.text, 120) || c.text;
      if (body.note !== undefined) c.note = text(body.note, 200);
      return c;
    });
    if (!updated) return bad(404, '这条不见了');
    return ok({ item: updated });
  }
  if (m && method === 'DELETE') {
    await mutate(env, (db) => {
      db.cart = db.cart.filter((x) => x.id !== m[1]);
    });
    return ok();
  }
  return null;
}

async function handlePetApi(request, env, path, method, user) {
  if (path === '/api/pet' && method === 'GET') {
    const changed = await mutate(env, (db) => petTick(db));
    const db = await read(env);
    return ok({ pet: petView(db, user), advanced: changed, accounts: accountList(env) });
  }
  if (path === '/api/pet/consent' && method === 'POST') {
    const result = await mutate(env, (db) => {
      const pet = db.pet;
      if (pet.status === 'growing' || pet.status === 'ready') return { error: '已经在养啦' };
      pet.consent[user.id] = new Date().toISOString();
      const both = accounts(env).every((a) => pet.consent[a.id]);
      if (both) {
        pet.status = 'growing';
        pet.stage = 0;
        pet.stageStartedAt = new Date().toISOString();
        pet.startedAt = pet.stageStartedAt;
        pet.care = { water: 0, weed: 0, feed: 0 };
        pet.consent = {};
        pet.pending = null;
        return { started: true };
      }
      return { started: false };
    });
    if (result.error) return bad(400, result.error);
    const db = await read(env);
    return ok({ started: result.started, pet: petView(db, user) });
  }
  if (path === '/api/pet/care' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const kind = ['water', 'weed', 'feed'].includes(body.kind) ? body.kind : null;
    if (!kind) return bad(400, '不知道要做什么');
    const result = await mutate(env, (db) => {
      const pet = db.pet;
      if (pet.status !== 'growing') return { error: '现在没有在养' };
      const stage = PET_STAGES[pet.stage];
      if (pet.care[kind] >= stage.need[kind]) return { error: '这一项已经做够啦' };
      pet.care[kind] += 1;
      pet.lastCareAt = new Date().toISOString();
      return { ok: true };
    });
    if (result.error) return bad(400, result.error);
    await mutate(env, (db) => petTick(db));
    const db = await read(env);
    return ok({ pet: petView(db, user) });
  }
  if (path === '/api/pet/talk' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const value = text(body.text, 300);
    if (!value) return bad(400, '说点什么吧');
    const message = await mutate(env, (db) => {
      const m = { id: newId(), text: value, author: user.id, authorName: user.name, avatar: user.avatar, createdAt: new Date().toISOString(), seenBy: [] };
      db.pet.messages = [...(db.pet.messages || []), m].slice(-60);
      return m;
    });
    return ok({ message });
  }
  if (path === '/api/pet/talk/seen' && method === 'POST') {
    await mutate(env, (db) => {
      for (const m of db.pet.messages || []) {
        if (m.author === user.id) continue;
        if (!m.seenBy) m.seenBy = [];
        if (!m.seenBy.includes(user.id)) m.seenBy.push(user.id);
      }
    });
    return ok();
  }
  if (path === '/api/pet/open' && method === 'POST') {
    const foodId = await mutate(env, (db) => {
      const pet = db.pet;
      if (pet.status !== 'ready' || !pet.pending) return null;
      const id = pet.pending.foodId;
      pet.foods[id] = (pet.foods[id] || 0) + 1;
      pet.pending = null;
      pet.status = 'idle';
      pet.stage = 0;
      pet.stageStartedAt = null;
      return id;
    });
    if (!foodId) return bad(400, '还没有可以打开的箱子');
    const db = await read(env);
    return ok({ foodId, pet: petView(db, user) });
  }
  if (path === '/api/pet/wish' && method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const value = text(body.text, 120);
    if (!value) return bad(400, '愿望得写一句');
    const result = await mutate(env, (db) => {
      const pet = db.pet;
      const owned = Object.entries(pet.foods || {}).filter(([, n]) => n > 0);
      if (!owned.length) return { error: '还没有攒到吃的，先用一个再来许愿' };
      const [foodId] = body.foodId && (pet.foods[body.foodId] || 0) > 0 ? [body.foodId] : owned.sort((a, b) => b[1] - a[1])[0];
      pet.foods[foodId] -= 1;
      const wish = { id: newId(), text: value, foodId, from: user.id, fromName: user.name, createdAt: new Date().toISOString() };
      pet.wishes = [...(pet.wishes || []), wish].slice(-50);
      return wish;
    });
    if (result.error) return bad(400, result.error);
    const db = await read(env);
    return ok({ wish: result, pet: petView(db, user) });
  }
  return null;
}
  if (method === 'POST' && path === '/api/uploads/presign') return handlePresign(request, env);

  return bad(404, '没有这个接口');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env);
      } catch (err) {
        console.error('[api]', url.pathname, err && err.stack ? err.stack : err);
        return bad(500, (err && err.message) || '服务器出错了');
      }
    }

    // 其余全部交给静态资源
    const res = await env.ASSETS.fetch(request);
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) headers.set(k, v);
    if (url.pathname.endsWith('.html') || url.pathname === '/') headers.set('cache-control', 'no-cache');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
};
