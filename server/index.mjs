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
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
};

const MAX_JSON = 256 * 1024;
const MAX_UPLOAD = 15 * 1024 * 1024;
const PHOTO_PREFIX = 'photos/';

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
  if (!k.startsWith(PHOTO_PREFIX)) return null;
  if (k.includes('..') || k.includes('//') || k.includes('\\')) return null;
  if (!/^photos\/[a-z0-9/._-]+$/i.test(k)) return null;
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
  ok(res, { notes: db.notes });
});

on('POST', /^\/api\/notes$/, async (req, res) => {
  const body = await readJSON(req);
  const value = text(body.text, 600);
  if (!value) return bad(res, 400, '写点什么吧');
  const note = await store.mutate((db) => {
    const n = {
      id: store.newId(),
      text: value,
      author: req.user.id,
      authorName: req.user.name,
      avatar: req.user.avatar,
      createdAt: new Date().toISOString(),
    };
    db.notes.unshift(n);
    db.notes = db.notes.slice(0, 500);
    return n;
  });
  ok(res, { note });
});

on('DELETE', /^\/api\/notes\/([a-f0-9]{16})$/, async (req, res, m) => {
  await store.mutate((db) => {
    db.notes = db.notes.filter((n) => n.id !== m[1]);
  });
  ok(res);
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

// 预签名上传
on('POST', /^\/api\/uploads\/presign$/, async (req, res) => {
  const body = await readJSON(req);
  const type = text(body.contentType, 80) || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp|avif|gif)$/i.test(type)) return bad(res, 400, '只收 jpg / png / webp / avif / gif');
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' })[type.toLowerCase()] || 'jpg';
  const now = new Date();
  const key = `${PHOTO_PREFIX}${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${crypto.randomUUID()}.${ext}`;

  if (!r2Ready()) {
    return ok(res, {
      mode: 'local',
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
  if (!safeKey(key)) return bad(res, 400, '图片地址不合法');
  const type = String(req.headers['content-type'] || '');
  const target = path.join(UPLOAD_DIR, key);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  let size = 0;
  const tmp = `${target}.${Date.now()}.part`;
  const out = fs.createWriteStream(tmp);
  try {
    await new Promise((resolve, reject) => {
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_UPLOAD) reject(Object.assign(new Error('图片太大了'), { status: 413 }));
      });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    });
    if (!/^image\//i.test(type)) throw Object.assign(new Error('只收图片'), { status: 400 });
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
  if (!safeKey(key)) return bad(res, 400, '图片地址不合法');
  const target = path.join(UPLOAD_DIR, key);
  let stat;
  try {
    stat = await fsp.stat(target);
  } catch {
    return bad(res, 404, '照片不见了');
  }
  res.writeHead(200, baseHeaders({
    'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
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
