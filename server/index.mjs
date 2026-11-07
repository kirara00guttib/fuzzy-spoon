// 日记本 · 服务端
// 零依赖：Node 内置模块 + 手写 SigV4 预签名。前端永远拿不到 R2 密钥。
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { PORT, HOST, PUBLIC_DIR, UPLOAD_DIR, R2, ACCOUNTS } from './config.mjs';
import * as auth from './auth.mjs';
import * as store from './store.mjs';
import { PET_STAGES } from './store.mjs';
import { presignPut, presignGet, presignObject, r2Ready } from './r2.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
  '.ogg': 'audio/ogg',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_JSON = 256 * 1024;
const MAX_UPLOAD = 15 * 1024 * 1024;
const MAX_AUDIO = 24 * 1024 * 1024;
const PHOTO_PREFIX = 'photos/';
const AUDIO_PREFIX = 'audio/';

// ── 小工具 ─────────────────────────────────────────────
function baseHeaders(extra = {}) {
  return {
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' blob: data: https:; media-src 'self' blob: https:; " +
      "style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self' https:; " +
      "base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    ...extra,
  };
}

function sendJSON(res, status, body, extra = {}) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  res.writeHead(status, baseHeaders({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...extra,
  }));
  res.end(payload);
}

const ok = (res, data = {}) => sendJSON(res, 200, { ok: true, ...data });
const bad = (res, status, message) => sendJSON(res, status, { ok: false, error: message });

async function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('内容太大了'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJSON(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw Object.assign(new Error('请求格式不对'), { status: 400 });
  }
}

const text = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const day = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null);
const int = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : null;
};

function safeKey(key) {
  const k = String(key || '');
  if (!k.startsWith(PHOTO_PREFIX) && !k.startsWith(AUDIO_PREFIX)) return null;
  if (k.includes('..') || k.includes('//') || k.includes('\\')) return null;
  if (!/^(photos|audio)\/[a-z0-9/._-]+$/i.test(k)) return null;
  return k;
}

// ── 读取链接（本地模式或 R2 预签名 GET）───────────────
const urlCache = new Map();
function mediaUrl(key) {
  if (!r2Ready()) {
    return `/api/media/${key.split('/').map(encodeURIComponent).join('/')}`;
  }
  const hit = urlCache.get(key);
  if (hit && hit.expiresAt - Date.now() > 20 * 60 * 1000) return hit.url;
  const signed = presignGet(key);
  urlCache.set(key, signed);
  return signed.url;
}

function publicPhoto(p) {
  return { ...p, url: mediaUrl(p.key) };
}

// 悄悄话里的录音：只把地址给出去，key 不直接暴露
function publicNote(n) {
  return {
    ...n,
    audioUrl: n.audio && n.audio.key ? mediaUrl(n.audio.key) : null,
  };
}

function audioMeta(v) {
  if (!v || typeof v !== 'object') return null;
  const key = safeKey(v.key);
  if (!key || !key.startsWith(AUDIO_PREFIX)) return null;
  return {
    key,
    mime: text(v.mime, 60) || 'audio/webm',
    seconds: int(v.seconds, 0, 900) ?? 0,
    size: int(v.size, 0, MAX_AUDIO) ?? 0,
  };
}

function publicMoment(m, photos) {
  return {
    ...m,
    photos: (m.photoIds || [])
      .map((id) => photos.find((p) => p.id === id))
      .filter(Boolean)
      .map(publicPhoto),
  };
}

// ── 路由 ───────────────────────────────────────────────
const routes = [];
const on = (method, pattern, handler, opts = {}) => routes.push({ method, pattern, handler, ...opts });

on('POST', /^\/api\/login$/, async (req, res) => {
  const ip = req.socket.remoteAddress || 'unknown';
  if (auth.tooManyAttempts(ip)) return bad(res, 429, '试太多次啦，等五分钟再来');
  const body = await readJSON(req);
  const account = auth.verifyCredentials(text(body.username, 80), String(body.password ?? ''));
  if (!account) {
    const other = auth.otherAccountWithPassword(text(body.username, 80), String(body.password ?? ''));
    if (other) {
      return bad(res, 401, `这是${other.name}的密码哦，上面「你是谁」换成${other.name}再试`);
    }
    auth.noteFailure(ip);
    return bad(res, 401, '账号或密码不对哦');
  }
  auth.clearFailures(ip);
  sendJSON(res, 200, { ok: true, user: { id: account.id, name: account.name, avatar: account.avatar } }, {
    'Set-Cookie': auth.cookieFor(auth.issueToken(account.id)),
  });
});

on('POST', /^\/api\/logout$/, async (req, res) => {
  sendJSON(res, 200, { ok: true }, { 'Set-Cookie': auth.clearCookie() });
});

on('GET', /^\/api\/session$/, async (req, res) => {
  if (!req.user) return sendJSON(res, 200, { ok: true, user: null, accounts: ACCOUNTS.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar })) });
  ok(res, { user: req.user, accounts: ACCOUNTS.map((a) => ({ id: a.id, name: a.name, avatar: a.avatar })) });
});

on('GET', /^\/api\/health$/, async (req, res) => {
  ok(res, { service: 'riji', runtime: 'node', storage: r2Ready() ? 'r2' : 'local', kv: false });
});

on('GET', /^\/api\/bootstrap$/, async (req, res) => {
  const db = store.read();
  ok(res, {
    user: req.user,
    settings: db.settings,
    storage: { mode: r2Ready() ? 'r2' : 'local' },
    counts: {
      notes: db.notes.length,
      moments: db.moments.length,
      photos: db.photos.length,
      events: db.events.length,
    },
  });
});

on('PUT', /^\/api\/settings$/, async (req, res) => {
  const body = await readJSON(req);
  const updated = await store.mutate((db) => {
    const s = db.settings;
    if (body.startedAt !== undefined) {
      const t = new Date(String(body.startedAt));
      if (!Number.isNaN(t.getTime())) s.startedAt = t.toISOString();
    }
    if (body.herName !== undefined) s.herName = text(body.herName, 24) || s.herName;
    if (body.hisName !== undefined) s.hisName = text(body.hisName, 24) || s.hisName;
    if (body.season !== undefined && ['auto', 'spring', 'summer', 'autumn', 'winter'].includes(body.season)) {
      s.season = body.season;
    }
    for (const who of ['birthdayHer', 'birthdayHim']) {
      const b = body[who];
      if (!b || typeof b !== 'object') continue;
      const type = ['solar', 'lunar', 'lunar-leap', 'lunar-offset'].includes(b.type) ? b.type : s[who].type;
      s[who] = {
        type,
        month: int(b.month, 1, 12) ?? s[who].month,
        day: int(b.day, 1, 31) ?? s[who].day,
        plusDays: int(b.plusDays, 0, 7) ?? s[who].plusDays ?? 0,
      };
    }
    return s;
  });
  ok(res, { settings: updated });
});

// 悄悄话
on('GET', /^\/api\/notes$/, async (req, res) => {
  const db = store.read();
  ok(res, { notes: db.notes.map(publicNote) });
});

on('POST', /^\/api\/notes$/, async (req, res) => {
  const body = await readJSON(req);
  const value = text(body.text, 600);
  const audio = audioMeta(body.audio);
  if (body.audio && !audio) return bad(res, 400, '录音地址不合法');
  if (!value && !audio) return bad(res, 400, '写点什么，或者录一段吧');
  const note = await store.mutate((db) => {
    const n = {
      id: store.newId(),
      text: value,
      audio,
      author: req.user.id,
      authorName: req.user.name,
      avatar: req.user.avatar,
      createdAt: new Date().toISOString(),
    };
    db.notes.unshift(n);
    db.notes = db.notes.slice(0, 500);
    return n;
  });
  ok(res, { note: publicNote(note) });
});

// 删悄悄话要两个人都点头：一人一次投票，凑齐才真删
const ACCOUNT_IDS = ACCOUNTS.map((a) => a.id);
const votesOf = (n) => (Array.isArray(n.deleteVotes) ? n.deleteVotes : []);

on('POST', /^\/api\/notes\/([a-f0-9]{16})\/vote$/, async (req, res, m) => {
  const result = await store.mutate((db) => {
    const n = db.notes.find((x) => x.id === m[1]);
    if (!n) return { missing: true };
    const votes = new Set(votesOf(n));
    votes.add(req.user.id);
    n.deleteVotes = [...votes];
    const everyone = ACCOUNT_IDS.every((id) => n.deleteVotes.includes(id));
    if (everyone) {
      db.notes = db.notes.filter((x) => x.id !== n.id);
      return { removed: true, note: n };
    }
    return { removed: false, note: n };
  });
  if (result.missing) return bad(res, 404, '这句已经不在了');
  if (result.removed && result.note.audio && result.note.audio.key) {
    urlCache.delete(result.note.audio.key);
    await deleteObject(result.note.audio.key);
  }
  ok(res, { removed: result.removed, note: publicNote(result.note) });
});

on('DELETE', /^\/api\/notes\/([a-f0-9]{16})\/vote$/, async (req, res, m) => {
  const note = await store.mutate((db) => {
    const n = db.notes.find((x) => x.id === m[1]);
    if (!n) return null;
    n.deleteVotes = votesOf(n).filter((id) => id !== req.user.id);
    return n;
  });
  if (!note) return bad(res, 404, '这句已经不在了');
  ok(res, { note: publicNote(note) });
});

// 照片
on('GET', /^\/api\/photos$/, async (req, res) => {
  const db = store.read();
  ok(res, { photos: db.photos.map(publicPhoto), storage: { mode: r2Ready() ? 'r2' : 'local' } });
});

on('POST', /^\/api\/photos$/, async (req, res) => {
  const body = await readJSON(req);
  const key = safeKey(body.key);
  if (!key) return bad(res, 400, '图片地址不合法');
  const photo = await store.mutate((db) => {
    const p = {
      id: store.newId(),
      key,
      caption: text(body.caption, 200),
      author: req.user.id,
      authorName: req.user.name,
      createdAt: new Date().toISOString(),
      w: int(body.w, 0, 20000) ?? 0,
      h: int(body.h, 0, 20000) ?? 0,
      size: int(body.size, 0, MAX_UPLOAD) ?? 0,
      type: text(body.type, 60) || 'image/*',
      momentId: text(body.momentId, 32) || null,
    };
    db.photos.unshift(p);
    return p;
  });
  ok(res, { photo: publicPhoto(photo) });
});

on('PUT', /^\/api\/photos\/([a-f0-9]{16})$/, async (req, res, m) => {
  const body = await readJSON(req);
  const updated = await store.mutate((db) => {
    const p = db.photos.find((x) => x.id === m[1]);
    if (!p) return null;
    if (body.caption !== undefined) p.caption = text(body.caption, 200);
    return p;
  });
  if (!updated) return bad(res, 404, '照片不见了');
  ok(res, { photo: publicPhoto(updated) });
});

on('DELETE', /^\/api\/photos\/([a-f0-9]{16})$/, async (req, res, m) => {
  const removed = await store.mutate((db) => {
    const p = db.photos.find((x) => x.id === m[1]);
    if (!p) return null;
    db.photos = db.photos.filter((x) => x.id !== m[1]);
    for (const mo of db.moments) mo.photoIds = (mo.photoIds || []).filter((id) => id !== m[1]);
    return p;
  });
  if (!removed) return bad(res, 404, '照片不见了');
  urlCache.delete(removed.key);
  await deleteObject(removed.key);
  ok(res);
});

// 日常
on('GET', /^\/api\/moments$/, async (req, res) => {
  const db = store.read();
  ok(res, { moments: db.moments.map((m) => publicMoment(m, db.photos)) });
});

on('POST', /^\/api\/moments$/, async (req, res) => {
  const body = await readJSON(req);
  const value = text(body.text, 2000);
  const date = day(body.date) || new Date().toISOString().slice(0, 10);
  const photoIds = Array.isArray(body.photoIds) ? body.photoIds.filter((x) => /^[a-f0-9]{16}$/.test(x)).slice(0, 9) : [];
  if (!value && !photoIds.length) return bad(res, 400, '写一句话或者放一张照片吧');
  const mood = ['开心', '想你', '累但幸福', '有点emo', '超期待'].includes(body.mood) ? body.mood : '';
  const created = await store.mutate((db) => {
    const m = {
      id: store.newId(),
      date,
      text: value,
      mood,
      bgm: body.bgm && typeof body.bgm === 'object' && text(body.bgm.title, 80)
        ? { title: text(body.bgm.title, 80), url: text(body.bgm.url, 500) }
        : null,
      photoIds,
      author: req.user.id,
      authorName: req.user.name,
      avatar: req.user.avatar,
      createdAt: new Date().toISOString(),
    };
    for (const p of db.photos) if (photoIds.includes(p.id)) p.momentId = m.id;
    db.moments.unshift(m);
    db.moments = db.moments.slice(0, 400);
    return m;
  });
  const db = store.read();
  ok(res, { moment: publicMoment(created, db.photos) });
});

on('DELETE', /^\/api\/moments\/([a-f0-9]{16})$/, async (req, res, m) => {
  await store.mutate((db) => {
    db.moments = db.moments.filter((x) => x.id !== m[1]);
    for (const p of db.photos) if (p.momentId === m[1]) p.momentId = null;
  });
  ok(res);
});

// 自定义的纪念日
on('GET', /^\/api\/events$/, async (req, res) => {
  const db = store.read();
  ok(res, { events: db.events });
});

on('POST', /^\/api\/events$/, async (req, res) => {
  const body = await readJSON(req);
  const date = day(body.date);
  const title = text(body.title, 60);
  if (!date || !title) return bad(res, 400, '日期和名字都要有');
  const event = await store.mutate((db) => {
    const e = {
      id: store.newId(),
      date,
      title,
      yearly: Boolean(body.yearly),
      hue: ['rose', 'teal', 'gold'].includes(body.hue) ? body.hue : 'rose',
      note: text(body.note, 200),
      author: req.user.id,
    };
    db.events.push(e);
    return e;
  });
  ok(res, { event });
});

on('DELETE', /^\/api\/events\/([a-f0-9]{16})$/, async (req, res, m) => {
  await store.mutate((db) => {
    db.events = db.events.filter((e) => e.id !== m[1]);
  });
  ok(res);
});

// 自己加的曲子（链接，不转存版权音乐）
on('GET', /^\/api\/tracks$/, async (req, res) => {
  const db = store.read();
  ok(res, { tracks: db.tracks });
});

on('POST', /^\/api\/tracks$/, async (req, res) => {
  const body = await readJSON(req);
  const title = text(body.title, 60);
  const url = text(body.url, 500);
  if (!title || !/^https?:\/\//i.test(url)) return bad(res, 400, '歌名和 http(s) 链接都要有');
  const track = await store.mutate((db) => {
    const t = { id: store.newId(), title, url, kind: 'link', addedBy: req.user.id };
    db.tracks.push(t);
    return t;
  });
  ok(res, { track });
});

on('DELETE', /^\/api\/tracks\/([a-f0-9]{16})$/, async (req, res, m) => {
  await store.mutate((db) => {
    db.tracks = db.tracks.filter((t) => t.id !== m[1]);
  });
  ok(res);
});

// ── 购物车：想一起做的事 ────────────────────────────────
on('GET', /^\/api\/cart$/, async (req, res) => {
  const db = store.read();
  ok(res, { cart: db.cart });
});

on('POST', /^\/api\/cart$/, async (req, res) => {
  const body = await readJSON(req);
  const value = text(body.text, 120);
  if (!value) return bad(res, 400, '想做的事得写一句');
  const item = await store.mutate((db) => {
    const c = {
      id: store.newId(),
      text: value,
      note: text(body.note, 200),
      author: req.user.id,
      authorName: req.user.name,
      avatar: req.user.avatar,
      createdAt: new Date().toISOString(),
      done: false,
      doneAt: null,
      doneBy: null,
    };
    db.cart.unshift(c);
    return c;
  });
  ok(res, { item });
});

on('PUT', /^\/api\/cart\/([a-f0-9]{16})$/, async (req, res, match) => {
  const body = await readJSON(req);
  const updated = await store.mutate((db) => {
    const c = db.cart.find((x) => x.id === match[1]);
    if (!c) return null;
    if (body.done !== undefined) {
      c.done = Boolean(body.done);
      c.doneAt = c.done ? new Date().toISOString() : null;
      c.doneBy = c.done ? req.user.name : null;
    }
    if (body.text !== undefined) c.text = text(body.text, 120) || c.text;
    if (body.note !== undefined) c.note = text(body.note, 200);
    return c;
  });
  if (!updated) return bad(res, 404, '这条不见了');
  ok(res, { item: updated });
});

on('DELETE', /^\/api\/cart\/([a-f0-9]{16})$/, async (req, res, match) => {
  await store.mutate((db) => {
    db.cart = db.cart.filter((x) => x.id !== match[1]);
  });
  ok(res);
});

// ── 培养系统 ────────────────────────────────────────────
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
    partner: null,
  };
}

/** 时间到了、照顾也够了，就自动长大（懒推进，访问时才算） */
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

on('GET', /^\/api\/pet$/, async (req, res) => {
  const changed = await store.mutate((db) => petTick(db));
  const db = store.read();
  ok(res, { pet: petView(db, req.user), advanced: changed, accounts: ACCOUNTS.map((a) => ({ id: a.id, name: a.name })) });
});

on('POST', /^\/api\/pet\/consent$/, async (req, res) => {
  const result = await store.mutate((db) => {
    const pet = db.pet;
    if (pet.status === 'growing' || pet.status === 'ready') return { error: '已经在养啦' };
    pet.consent[req.user.id] = new Date().toISOString();
    const both = ACCOUNTS.every((a) => pet.consent[a.id]);
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
  if (result.error) return bad(res, 400, result.error);
  const db = store.read();
  ok(res, { started: result.started, pet: petView(db, req.user) });
});

on('POST', /^\/api\/pet\/care$/, async (req, res) => {
  const body = await readJSON(req);
  const kind = ['water', 'weed', 'feed'].includes(body.kind) ? body.kind : null;
  if (!kind) return bad(res, 400, '不知道要做什么');
  const result = await store.mutate((db) => {
    const pet = db.pet;
    if (pet.status !== 'growing') return { error: '现在没有在养' };
    const stage = PET_STAGES[pet.stage];
    if (pet.care[kind] >= stage.need[kind]) return { error: '这一项已经做够啦' };
    pet.care[kind] += 1;
    pet.lastCareAt = new Date().toISOString();
    return { ok: true };
  });
  if (result.error) return bad(res, 400, result.error);
  await store.mutate((db) => petTick(db));
  const db = store.read();
  ok(res, { pet: petView(db, req.user) });
});

on('POST', /^\/api\/pet\/talk$/, async (req, res) => {
  const body = await readJSON(req);
  const value = text(body.text, 300);
  if (!value) return bad(res, 400, '说点什么吧');
  const message = await store.mutate((db) => {
    const m = {
      id: store.newId(),
      text: value,
      author: req.user.id,
      authorName: req.user.name,
      avatar: req.user.avatar,
      createdAt: new Date().toISOString(),
      seenBy: [],
    };
    db.pet.messages = [...(db.pet.messages || []), m].slice(-60);
    return m;
  });
  ok(res, { message });
});

on('POST', /^\/api\/pet\/talk\/seen$/, async (req, res) => {
  await store.mutate((db) => {
    for (const m of db.pet.messages || []) {
      if (m.author === req.user.id) continue;
      if (!m.seenBy) m.seenBy = [];
      if (!m.seenBy.includes(req.user.id)) m.seenBy.push(req.user.id);
    }
  });
  ok(res);
});

on('POST', /^\/api\/pet\/open$/, async (req, res) => {
  const foodId = await store.mutate((db) => {
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
  if (!foodId) return bad(res, 400, '还没有可以打开的箱子');
  const db = store.read();
  ok(res, { foodId, pet: petView(db, req.user) });
});

on('POST', /^\/api\/pet\/wish$/, async (req, res) => {
  const body = await readJSON(req);
  const value = text(body.text, 120);
  if (!value) return bad(res, 400, '愿望得写一句');
  const result = await store.mutate((db) => {
    const pet = db.pet;
    const owned = Object.entries(pet.foods || {}).filter(([, n]) => n > 0);
    if (!owned.length) return { error: '还没有攒到吃的，先用一个再来许愿' };
    const [foodId] = body.foodId && (pet.foods[body.foodId] || 0) > 0
      ? [body.foodId]
      : owned.sort((a, b) => b[1] - a[1])[0];
    pet.foods[foodId] -= 1;
    const wish = {
      id: store.newId(),
      text: value,
      foodId,
      from: req.user.id,
      fromName: req.user.name,
      createdAt: new Date().toISOString(),
    };
    pet.wishes = [...(pet.wishes || []), wish].slice(-50);
    return wish;
  });
  if (result.error) return bad(res, 400, result.error);
  const db = store.read();
  ok(res, { wish: result, pet: petView(db, req.user) });
});

// 预签名上传
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
const AUDIO_EXT = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
};

on('POST', /^\/api\/uploads\/presign$/, async (req, res) => {
  const body = await readJSON(req);
  const type = (text(body.contentType, 80) || 'image/jpeg').split(';')[0].trim().toLowerCase();
  const isAudio = type.startsWith('audio/');
  const ext = (isAudio ? AUDIO_EXT : IMAGE_EXT)[type];
  if (!ext) {
    return bad(res, 400, isAudio ? '只收 webm / m4a / mp3 / ogg / wav 的录音' : '只收 jpg / png / webp / avif / gif');
  }
  const now = new Date();
  const dir = isAudio ? AUDIO_PREFIX : PHOTO_PREFIX;
  const key = `${dir}${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;

  if (!r2Ready()) {
    return ok(res, {
      mode: 'local',
      kind: isAudio ? 'audio' : 'image',
      key,
      method: 'PUT',
      headers: { 'Content-Type': type },
      uploadUrl: `/api/media/${key.split('/').map(encodeURIComponent).join('/')}`,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });
  }
  const signed = presignPut(key, type);
  ok(res, {
    mode: 'r2',
    kind: isAudio ? 'audio' : 'image',
    key,
    method: 'PUT',
    headers: { 'Content-Type': type },
    uploadUrl: signed.url,
    expiresAt: signed.expiresAt,
  });
});

// 本地存储模式：直传 / 读取
on('PUT', /^\/api\/media\/(.+)$/, async (req, res, match) => {
  if (r2Ready()) return bad(res, 404, '照片存在 R2 里');
  const key = decodeURIComponent(match[1]);
  if (!safeKey(key)) return bad(res, 400, '地址不合法');
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const isAudio = /^audio\//.test(type);
  const limit = isAudio ? MAX_AUDIO : MAX_UPLOAD;
  const target = path.join(UPLOAD_DIR, key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  let size = 0;
  const tmp = `${target}.${Date.now()}.part`;
  const out = fs.createWriteStream(tmp);
  try {
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > limit) reject(Object.assign(new Error(isAudio ? '录音太长了' : '图片太大了'), { status: 413 }));
      });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    });
    if (!isAudio && !/^image\//i.test(type)) throw Object.assign(new Error('只收图片或录音'), { status: 400 });
    if (isAudio && !AUDIO_EXT[type]) throw Object.assign(new Error('这种录音格式不认'), { status: 400 });
    await fsp.rename(tmp, target);
  } catch (err) {
    out.destroy();
    await fsp.rm(tmp, { force: true });
    return bad(res, err.status || 500, err.message || '上传失败');
  }
  ok(res, { key, size });
});

on('GET', /^\/api\/media\/(.+)$/, async (req, res, match) => {
  if (r2Ready()) return bad(res, 404, '照片存在 R2 里');
  const key = decodeURIComponent(match[1]);
  if (!safeKey(key)) return bad(res, 400, '地址不合法');
  const target = path.join(UPLOAD_DIR, key);
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return bad(res, 404, '这个文件不见了');
  }
  const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
  const total = stat.size;

  // 录音要支持 Range，不然手机上拖进度条会跳回去
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (range) {
    let start = range[1] ? Number(range[1]) : 0;
    let end = range[2] ? Number(range[2]) : total - 1;
    if (!range[1] && range[2]) {
      start = Math.max(0, total - Number(range[2]));
      end = total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= total || start > end) {
      res.writeHead(416, baseHeaders({ 'Content-Range': `bytes */${total}` }));
      return res.end();
    }
    end = Math.min(end, total - 1);
    res.writeHead(206, baseHeaders({
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=3600',
    }));
    return fs.createReadStream(target, { start, end }).pipe(res);
  }

  res.writeHead(200, baseHeaders({
    'Content-Type': type,
    'Content-Length': total,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }));
  fs.createReadStream(target).pipe(res);
});

async function deleteObject(key) {
  if (r2Ready()) {
    try {
      const { url } = presignObject({ method: 'DELETE', key, expires: 300 });
      await fetch(url, { method: 'DELETE' });
    } catch (err) {
      console.warn('[r2] 删除对象失败', key, err.message);
    }
    return;
  }
  await fsp.rm(path.join(UPLOAD_DIR, key), { force: true });
}

// ── 静态文件 ───────────────────────────────────────────
// 每次启动换一个版本号：index.html 里的 css/js 链接会带上它，手机就不会一直吃旧缓存
const ASSET_VERSION = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const indexCache = { html: null, version: null };

function stampTags(html) {
  const v = '?v=' + ASSET_VERSION;
  return html
    .replace(/(href="\/css\/[^"]+?)"/g, '$1' + v + '"')
    .replace(/(src="\/js\/[^"]+?)"/g, '$1' + v + '"')
    .replace(/(href="\/fonts\/[^"]+?)"/g, '$1' + v + '"');
}

/** 给 index.html 里的 css/js/font 链接带上版本号 */
function versionedIndex(html) {
  if (indexCache.version === ASSET_VERSION) return indexCache.html;
  indexCache.html = stampTags(html);
  indexCache.version = ASSET_VERSION;
  return indexCache.html;
}
async function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';
  const target = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!target.startsWith(PUBLIC_DIR)) return bad(res, 403, 'no');
  let stat;
  try {
    stat = await fsp.stat(target);
    if (stat.isDirectory()) throw new Error('dir');
  } catch {
    if (!path.extname(rel)) return serveStatic(req, res, '/index.html');
    res.writeHead(404, baseHeaders({ 'Content-Type': 'text/plain; charset=utf-8' }));
    return res.end('404');
  }
  const ext = path.extname(target).toLowerCase();
  if (ext === '.html') {
    const html = versionedIndex(await fsp.readFile(target, 'utf8'));
    const buf = Buffer.from(html, 'utf8');
    res.writeHead(200, baseHeaders({
      'Content-Type': MIME[ext],
      'Content-Length': buf.length,
      'Cache-Control': 'no-cache',
    }));
    if (req.method === 'HEAD') return res.end();
    return res.end(buf);
  }
  const immutable = ext === '.woff2';
  res.writeHead(200, baseHeaders({
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  }));
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target).pipe(res);
}

// ── 启动 ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const started = Date.now();
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    return bad(res, 400, 'bad url');
  }
  const cors = req.headers.origin && req.headers.origin !== `http://${req.headers.host}`;

  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return bad(res, 405, 'method not allowed');
      return await serveStatic(req, res, url.pathname);
    }
    if (cors) return bad(res, 403, 'cross-origin request blocked');

    const cookies = auth.parseCookies(req.headers.cookie || '');
    req.user = auth.readToken(cookies[auth.COOKIE_NAME]) || null;

    const route = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!route) return bad(res, 404, '没有这个接口');
    const isPublic = ['/api/login', '/api/session', '/api/logout', '/api/health'].includes(url.pathname);
    if (!isPublic && !req.user) return bad(res, 401, '先登录吧');

    const match = url.pathname.match(route.pattern);
    await route.handler(req, res, match);
  } catch (err) {
    if (!res.headersSent) bad(res, err.status || 500, err.message || '服务器出错了');
    else res.end();
    if (!err.status) console.error('[500]', req.method, req.url, err);
  } finally {
    if (process.env.DEBUG) console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
  }
});

server.listen(PORT, HOST, () => {
  const mode = r2Ready() ? `Cloudflare R2 · ${R2.bucket}` : '本机存储（未配置 R2）';
  const host = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  console.log(`日记本 running → http://${host}:${PORT}`);
  console.log(`  照片存储: ${mode}`);
  console.log(`  账号: ${ACCOUNTS.map((a) => a.id).join(' / ') || '(未配置)'}`);
  if (HOST === '0.0.0.0') {
    const nets = os.networkInterfaces();
    for (const list of Object.values(nets)) {
      for (const net of list || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`  局域网上也能开: http://${net.address}:${PORT}`);
      }
    }
  }
});
