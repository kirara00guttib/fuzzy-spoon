// 会话：签名 Cookie，HttpOnly + SameSite=Strict，30 天有效
import crypto from 'node:crypto';
import { SECRET, ACCOUNTS, COOKIE_SECURE } from './config.mjs';

export const COOKIE_NAME = 'walk_session';
const MAX_AGE = 60 * 60 * 24 * 30;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');

export function issueToken(userId) {
  const payload = b64(
    JSON.stringify({ u: userId, exp: Date.now() + MAX_AGE * 1000, n: crypto.randomBytes(6).toString('hex') }),
  );
  return `${payload}.${sign(payload)}`;
}

export function readToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, mac] = token.split('.');
  if (!payload || !mac) return null;
  const expected = sign(payload);
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!data || typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    const account = ACCOUNTS.find((x) => x.id === data.u);
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

export function cookieFor(token) {
  const bits = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${MAX_AGE}`,
  ];
  if (COOKIE_SECURE) bits.push('Secure');
  return bits.join('; ');
}

export function clearCookie() {
  const bits = [`${COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Strict', 'Max-Age=0'];
  if (COOKIE_SECURE) bits.push('Secure');
  return bits.join('; ');
}

// ── 登录限速：同一 IP 5 分钟内最多 10 次失败 ──────────────
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

export function verifyCredentials(username, password) {
  const account = ACCOUNTS.find((a) => a.id === username);
  const hash = crypto.createHash('sha256').update(String(password ?? '')).digest('hex');
  const candidate = Buffer.from(hash);
  // 账号不存在时也走一次比较，避免用耗时判断账号存在与否
  const target = Buffer.from(account ? account.passHash : accounts_decoy());
  const same = candidate.length === target.length && crypto.timingSafeEqual(candidate, target);
  return account && same ? account : null;
}

let decoy = null;
function accounts_decoy() {
  if (!decoy) decoy = crypto.createHash('sha256').update(crypto.randomBytes(32)).digest('hex');
  return decoy;
}

/**
 * 输错人时帮一句：这个密码其实是另一个人的。
 * （只有在密码本来就正确时才可能触发，所以不额外泄露什么）
 */
export function otherAccountWithPassword(username, password) {
  const hash = crypto.createHash('sha256').update(String(password ?? '')).digest('hex');
  const candidate = Buffer.from(hash);
  for (const account of ACCOUNTS) {
    if (account.id === username) continue;
    const target = Buffer.from(account.passHash);
    if (candidate.length === target.length && crypto.timingSafeEqual(candidate, target)) return account;
  }
  return null;
}
