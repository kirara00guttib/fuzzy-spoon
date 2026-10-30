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
  };
}

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
