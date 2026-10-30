// 农历 / 节日 / 生日：用浏览器自带的 Intl 中国历法（毫秒级，不用查表）
const MONTH_NAMES = {
  正月: 1, 一月: 1,
  二月: 2, 三月: 3, 四月: 4, 五月: 5, 六月: 6,
  七月: 7, 八月: 8, 九月: 9, 十月: 10,
  十一月: 11, 冬月: 11, 十二月: 12, 腊月: 12,
};

export const LUNAR_OK = (() => {
  try {
    new Intl.DateTimeFormat('zh-CN-u-ca-chinese').format(new Date());
    return true;
  } catch {
    return false;
  }
})();

const lunarFmt = LUNAR_OK
  ? new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' })
  : null;

const cache = new Map();

/** { month: 1..12, day: 1..30, leap: bool, monthLabel, dayLabel } */
export function lunarOf(date) {
  const key = dayKey(date);
  if (cache.has(key)) return cache.get(key);
  if (!lunarFmt) {
    const fallback = { month: 1, day: 1, leap: false, monthLabel: '—', dayLabel: '—', ok: false };
    cache.set(key, fallback);
    return fallback;
  }
  const parts = lunarFmt.formatToParts(date);
  const rawMonth = parts.find((p) => p.type === 'month')?.value || '';
  const rawDay = Number(parts.find((p) => p.type === 'day')?.value || 1);
  const leap = rawMonth.startsWith('闰');
  const bare = rawMonth.replace(/^闰/, '');
  const month = MONTH_NAMES[bare] || 1;
  const out = {
    month,
    day: rawDay,
    leap,
    monthLabel: rawMonth,
    dayLabel: lunarDayName(rawDay),
    ok: true,
  };
  cache.set(key, out);
  return out;
}

export function lunarDayName(n) {
  const ones = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (n === 10) return '初十';
  if (n === 20) return '二十';
  if (n === 30) return '三十';
  if (n < 10) return `初${ones[n]}`;
  if (n < 20) return `十${ones[n - 10]}`;
  if (n < 30) return `廿${ones[n - 20]}`;
  return '三十';
}

export function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function weekdayName(date) {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
}

const FESTIVALS_LUNAR = [
  { month: 1, day: 1, title: '春节', hue: 'rose' },
  { month: 1, day: 15, title: '元宵节', hue: 'rose' },
  { month: 5, day: 5, title: '端午节', hue: 'teal' },
  { month: 7, day: 7, title: '七夕', hue: 'rose' },
  { month: 8, day: 15, title: '中秋节', hue: 'gold' },
  { month: 9, day: 9, title: '重阳节', hue: 'teal' },
  { month: 12, day: 8, title: '腊八节', hue: 'teal' },
];

const FESTIVALS_SOLAR = [
  { month: 1, day: 1, title: '元旦', hue: 'teal' },
  { month: 2, day: 14, title: '情人节', hue: 'rose' },
  { month: 5, day: 20, title: '520', hue: 'rose' },
  { month: 6, day: 1, title: '儿童节', hue: 'gold' },
  { month: 12, day: 24, title: '平安夜', hue: 'teal' },
  { month: 12, day: 25, title: '圣诞节', hue: 'rose' },
  { month: 12, day: 31, title: '跨年夜', hue: 'gold' },
];

function birthdaySpec(config, who) {
  if (!config) return null;
  const type = config.type || 'solar';
  return {
    who,
    type,
    month: Number(config.month) || 1,
    day: Number(config.day) || 1,
    plusDays: Number(config.plusDays) || 0,
    title: who === 'her' ? '她的生日' : '我的生日',
  };
}

const yearCache = new Map();

/**
 * 一整年的「特别的日子」
 * @returns {Map<string, Array<{date,title,kind,hue,note?}>>}
 */
export function buildYear(year, settings = {}, events = []) {
  const cacheKey = JSON.stringify([
    year,
    settings.startedAt,
    settings.birthdayHer,
    settings.birthdayHim,
    events.map((e) => [e.id, e.date, e.title, e.yearly, e.hue]),
  ]);
  if (yearCache.has(cacheKey)) return yearCache.get(cacheKey);

  const map = new Map();
  const add = (dateKey, item) => {
    if (!map.has(dateKey)) map.set(dateKey, []);
    if (!map.get(dateKey).some((x) => x.title === item.title)) map.get(dateKey).push(item);
  };

  const her = birthdaySpec(settings.birthdayHer, 'her');
  const him = birthdaySpec(settings.birthdayHim, 'him');

  // 生日：农历要按「今年有没有这个月」判断
  const herLunar = { normal: null, leap: null };
  const himBase = [];
  const started = settings.startedAt ? new Date(settings.startedAt) : null;

  const cursor = new Date(year, 0, 1, 12);
  const end = new Date(year, 11, 31, 12);
  while (cursor <= end) {
    const l = lunarOf(cursor);
    const key = dayKey(cursor);

    if (l.ok) {
      for (const f of FESTIVALS_LUNAR) {
        if (l.day === f.day && l.month === f.month) {
          add(key, { date: key, title: f.title, kind: 'festival', hue: f.hue, lunar: true });
        }
      }
      // 除夕：第二天是正月初一
      const tomorrow = new Date(cursor.getTime() + 86400000);
      const tl = lunarOf(tomorrow);
      if (tl.ok && tl.month === 1 && tl.day === 1 && !tl.leap) {
        add(key, { date: key, title: '除夕', kind: 'festival', hue: 'rose', lunar: true });
      }
    }

    if (her && her.type === 'lunar-leap') {
      if (l.day === her.day && l.month === her.month) {
        if (l.leap) herLunar.leap = key;
        else herLunar.normal = key;
      }
    }
    if (her && her.type === 'lunar') {
      if (!l.leap && l.day === her.day && l.month === her.month && !herLunar.normal) herLunar.normal = key;
    }
    if (her && her.type === 'solar') {
      if (cursor.getMonth() + 1 === her.month && cursor.getDate() === her.day) herLunar.normal = key;
    }
    if (him && him.type === 'lunar-offset') {
      if (!l.leap && l.day === him.day && l.month === him.month) himBase.push(key);
    }
    if (him && him.type === 'lunar') {
      if (!l.leap && l.day === him.day && l.month === him.month) himBase.push(key);
    }
    if (him && him.type === 'solar') {
      if (cursor.getMonth() + 1 === him.month && cursor.getDate() === him.day) himBase.push(key);
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  if (her) {
    const useKey = herLunar.leap || herLunar.normal;
    const shifted = useKey ? addDays(useKey, her.plusDays) : null;
    if (shifted) {
      add(shifted, {
        date: shifted,
        title: her.title,
        kind: 'birthday',
        hue: 'gold',
        note: herLunar.leap
          ? `农历${lunarOf(parseDayKey(useKey)).monthLabel}${lunarOf(parseDayKey(useKey)).dayLabel}`
          : useKey
            ? `今年没有闰${monthNameCn(her.month)}，先按${monthNameCn(her.month)}${lunarDayName(her.day)}过`
            : '',
      });
    }
  }

  if (him && himBase.length) {
    const base = himBase[0];
    const shifted = addDays(base, him.plusDays);
    if (shifted) {
      add(shifted, {
        date: shifted,
        title: him.title,
        kind: 'birthday',
        hue: 'teal',
        note: him.plusDays ? `中秋节的第二天（${base}）` : '',
      });
    }
  }

  for (const f of FESTIVALS_SOLAR) {
    const key = `${year}-${String(f.month).padStart(2, '0')}-${String(f.day).padStart(2, '0')}`;
    add(key, { date: key, title: f.title, kind: 'festival', hue: f.hue });
  }

  if (started && !Number.isNaN(started.getTime())) {
    const key = `${year}-${String(started.getMonth() + 1).padStart(2, '0')}-${String(started.getDate()).padStart(2, '0')}`;
    const years = year - started.getFullYear();
    if (years >= 1) {
      add(key, { date: key, title: `在一起 ${years} 年`, kind: 'anniversary', hue: 'rose' });
    }
  }

  for (const e of events) {
    if (!e || !e.date) continue;
    if (e.yearly) {
      const [, m, d] = e.date.split('-');
      add(`${year}-${m}-${d}`, { ...e, date: `${year}-${m}-${d}`, kind: 'custom' });
    } else if (e.date.startsWith(String(year))) {
      add(e.date, { ...e, kind: 'custom' });
    }
  }

  yearCache.set(cacheKey, map);
  return map;
}

export function monthNameCn(n) {
  return ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二'][n - 1] || '';
}

function addDays(key, n) {
  if (!n) return key;
  const d = parseDayKey(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
}

/** 某个月的日格：每格带农历与特别的日子 */
export function buildMonth(year, month, settings, events) {
  const map = buildYear(year, settings, events);
  const first = new Date(year, month - 1, 1, 12);
  const startOffset = (first.getDay() + 6) % 7; // 从周一开始
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let i = 0; i < startOffset; i += 1) cells.push(null);
  for (let d = 1; d <= daysInMonth; d += 1) {
    const date = new Date(year, month - 1, d, 12);
    const key = dayKey(date);
    const l = lunarOf(date);
    cells.push({
      date,
      key,
      day: d,
      lunar: l,
      lunarLabel: l.day === 1 ? l.monthLabel : lunarDayName(l.day),
      specials: map.get(key) || [],
      weekend: date.getDay() === 0 || date.getDay() === 6,
    });
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/** 从某天往后找最近的 n 个特别的日子（含今天之后 400 天） */
export function upcoming(from, settings, events, n = 5) {
  const out = [];
  const today = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 12);
  const cursor = new Date(today);
  for (let i = 0; i < 400 && out.length < n; i += 1) {
    const map = buildYear(cursor.getFullYear(), settings, events);
    const items = map.get(dayKey(cursor)) || [];
    for (const item of items) {
      if (out.length >= n) break;
      if (out.some((x) => x.title === item.title && x.date === item.date)) continue;
      const diff = Math.round((parseDayKey(item.date) - today) / 86400000);
      out.push({ ...item, daysAway: diff });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** 「还有几天」的中文说法 */
export function daysAwayLabel(days) {
  if (days === 0) return '就是今天';
  if (days === 1) return '明天';
  if (days === 2) return '后天';
  if (days < 0) return `${-days} 天前`;
  return `还有 ${days} 天`;
}
