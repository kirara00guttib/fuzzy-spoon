// 云端版的数据存储：整份 JSON 存在一个 KV 键里（两个人的量，几十 KB 到几 MB 都够）
// 写入是「读-改-写」，两个人同时改的极端情况下可能丢一次，这里用重试 + 时效兜底。

const KEY = 'db';
const TTL_FALLBACK = 60 * 60 * 24 * 365;

export function defaults() {
  return {
    version: 1,
    settings: {
      startedAt: '2024-05-20T20:00:00+08:00',
      herName: 'neko',
      hisName: '金毛',
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
    cart: [],
    pet: {
      status: 'idle',
      stage: 0,
      consent: {},
      startedAt: null,
      stageStartedAt: null,
      care: { water: 0, weed: 0, feed: 0 },
      messages: [],
      foods: {},
      wishes: [],
      pending: null,
      cycles: 0,
    },
  };
}

/** 三个培养阶段：每个阶段一周，照顾次数够了才能长大 */
export const PET_STAGES = [
  { key: 'egg', name: '鸡蛋', days: 7, need: { water: 6, weed: 2, feed: 2 } },
  { key: 'seed', name: '种子', days: 7, need: { water: 6, weed: 3, feed: 3 } },
  { key: 'box', name: '小箱子', days: 7, need: { water: 4, weed: 2, feed: 4 } },
];

function normalize(raw) {
  const base = defaults();
  if (!raw || typeof raw !== 'object') return base;
  return {
    ...base,
    ...raw,
    settings: { ...base.settings, ...(raw.settings || {}) },
    notes: Array.isArray(raw.notes) ? raw.notes : [],
    moments: Array.isArray(raw.moments) ? raw.moments : [],
    photos: Array.isArray(raw.photos) ? raw.photos : [],
    events: Array.isArray(raw.events) ? raw.events : [],
    tracks: Array.isArray(raw.tracks) ? raw.tracks : [],
    cart: Array.isArray(raw.cart) ? raw.cart : [],
    pet: { ...base.pet, ...(raw.pet || {}) },
  };
}

export async function read(env) {
  const raw = await env.STORE.get(KEY);
  if (!raw) return defaults();
  try {
    return normalize(JSON.parse(raw));
  } catch {
    return defaults();
  }
}

export async function write(env, db) {
  await env.STORE.put(KEY, JSON.stringify(db), { expirationTtl: TTL_FALLBACK });
  return db;
}

export async function mutate(env, fn) {
  const db = await read(env);
  const result = await fn(db);
  await write(env, db);
  return result ?? null;
}

export const newId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
