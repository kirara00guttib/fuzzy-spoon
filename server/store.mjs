// 两个人的共用数据：一个 JSON 文件 + 串行写入，重启不丢。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STORE_FILE, DATA_DIR } from './config.mjs';

const DEFAULTS = () => ({
  version: 1,
  settings: {
    // 可以随时在「恋爱时间」里改成你们真正的第一天
    startedAt: '2024-05-20T20:00:00+08:00',
    herName: 'neko',
    hisName: '金毛',
    // 她的生日：闰三月初三；我的生日：中秋后一天
    birthdayHer: { type: 'lunar-leap', month: 3, day: 3, plusDays: 0 },
    birthdayHim: { type: 'lunar-offset', month: 8, day: 15, plusDays: 1 },
    season: 'auto',
    nightUi: 'auto',
  },
  notes: [],
  moments: [],
  photos: [],
  events: [],
  tracks: [],
});

let cache = null;
let chain = Promise.resolve();

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    cache = { ...DEFAULTS(), ...parsed, settings: { ...DEFAULTS().settings, ...(parsed.settings || {}) } };
  } catch {
    cache = DEFAULTS();
  }
  return cache;
}

function persist(db) {
  const tmp = path.join(DATA_DIR, `.store-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, STORE_FILE);
}

export function read() {
  return structuredClone(load());
}

/** 串行化的读改写：同一时刻只有一个写入者，避免互相覆盖 */
export function mutate(fn) {
  const run = chain.then(async () => {
    const db = load();
    const result = await fn(db);
    persist(db);
    return structuredClone(result ?? null);
  });
  chain = run.catch(() => {});
  return run;
}

export const newId = () => crypto.randomBytes(8).toString('hex');
