// 日记本 — 配置与账号（只读，来自 .env）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const DATA_DIR = path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const STORE_FILE = path.join(DATA_DIR, 'store.json');

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(ROOT, '.env'));
export function env(name, fallback = '') {
  const v = process.env[name];
  if (v !== undefined && v !== '') return v;
  const f = fileEnv[name];
  return f !== undefined && f !== '' ? f : fallback;
}

export const PORT = Number(env('PORT', '5173')) || 5173;
export const HOST = env('HOST', '127.0.0.1');
export const COOKIE_SECURE = env('COOKIE_SECURE', '0') === '1';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sessionSecret() {
  const fromEnv = env('AUTH_SECRET');
  if (fromEnv) return fromEnv;
  const file = path.join(DATA_DIR, 'session-secret');
  if (fs.existsSync(file)) {
    const s = fs.readFileSync(file, 'utf8').trim();
    if (s.length >= 32) return s;
  }
  const secret = crypto.randomBytes(48).toString('base64url');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
export const SECRET = sessionSecret();

const rawAccounts = [
  { id: env('USER1_ID'), name: env('USER1_NAME', 'neko'), pass: env('USER1_PASS') },
  { id: env('USER2_ID'), name: env('USER2_NAME', '金毛'), pass: env('USER2_PASS') },
];

export const ACCOUNTS = rawAccounts
  .filter((a) => a.id && a.pass)
  .map((a, i) => ({
    id: a.id,
    name: a.name || a.id,
    passHash: crypto.createHash('sha256').update(a.pass).digest('hex'),
    avatar: i === 0 ? 'cat' : 'dog',
  }));

if (ACCOUNTS.length < 2) {
  console.warn('[warn] .env 里没读到两个账号（USER1_* / USER2_*），登录可能不可用。');
}

export const R2 = {
  accountId: env('R2_ACCOUNT_ID'),
  accessKeyId: env('R2_ACCESS_KEY_ID'),
  secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
  bucket: env('R2_BUCKET'),
  region: env('R2_REGION', 'auto'),
  // 换用别的 S3 兼容服务（OSS / COS / B2 / MinIO）时填它们的域名，并把桶名风格调对
  endpoint: env('S3_ENDPOINT').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  pathStyle: env('S3_PATH_STYLE', '1') !== '0',
  publicBase: env('R2_PUBLIC_BASE').replace(/\/+$/, ''),
  get configured() {
    const hasKey = Boolean(this.accessKeyId && this.secretAccessKey && this.bucket);
    return hasKey && Boolean(this.endpoint || this.accountId);
  },
};
