// 账号与会话（Cloudflare Workers 版）：签名 Cookie，30 天有效

export const COOKIE_NAME = 'riji_session';
const MAX_AGE = 60 * 60 * 24 * 30;

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (s) => {
  const pad = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(pad + '='.repeat((4 - (pad.length % 4)) % 4));
};

const enc = new TextEncoder();

async function hmacB64(secret, payload) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return b64url(sig);
}

export function accounts(env) {
  const list = [
    { id: env.USER1_ID, name: env.USER1_NAME || 'neko', pass: env.USER1_PASS, avatar: 'cat' },
    { id: env.USER2_ID, name: env.USER2_NAME || '金毛', pass: env.USER2_PASS, avatar: 'dog' },
  ];
  return list.filter((a) => a.id && a.pass);
}

export async function issueToken(env, userId) {
  const payload = b64url(enc.encode(JSON.stringify({ u: userId, exp: Date.now() + MAX_AGE * 1000, n: crypto.randomUUID() })));
  return `${payload}.${await hmacB64(env.AUTH_SECRET, payload)}`;
}

export async function readToken(env, token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = await hmacB64(env.AUTH_SECRET, payload);
  if (expected !== mac) return null;
  try {
    const data = JSON.parse(fromB64url(payload));
    if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    const account = accounts(env).find((a) => a.id === data.u);
    if (!account) return null;
    return { id: account.id, name: account.name, avatar: account.avatar };
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieFor(token, secure = true) {
  const bits = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${MAX_AGE}`];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

export function clearCookie(secure = true) {
  const bits = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 校验账号密码；账号不存在时也走一次比较，避免用耗时判断 */
export function verifyCredentials(env, username, password) {
  const account = accounts(env).find((a) => a.id === username);
  const pass = String(password ?? '');
  if (!account) {
    safeEqual(pass, `decoy-${username}`);
    return null;
  }
  return safeEqual(pass, account.pass) ? account : null;
}

/** 输错人时帮一句：这密码其实是另一个人的 */
export function otherAccountWithPassword(env, username, password) {
  const pass = String(password ?? '');
  return accounts(env).find((a) => a.id !== username && safeEqual(pass, a.pass)) || null;
}

// ── 登录限速：同一个 IP 5 分钟最多 10 次失败（isolate 内存级，够用） ──
const attempts = new Map();
const WINDOW = 5 * 60 * 1000;
const LIMIT = 10;

export function tooManyAttempts(ip) {
  const rec = attempts.get(ip);
  if (!rec) return false;
  if (Date.now() - rec.first > WINDOW) {
    attempts.delete(ip);
    return false;
  }
  return rec.count >= LIMIT;
}

export function noteFailure(ip) {
  const rec = attempts.get(ip);
  if (!rec || Date.now() - rec.first > WINDOW) attempts.set(ip, { first: Date.now(), count: 1 });
  else rec.count += 1;
}

export function clearFailures(ip) {
  attempts.delete(ip);
}
