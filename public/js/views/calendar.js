// 日历：节日、两个人生日、还有我们自己记下的日子
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, toast, viewHead, openModal, formatDate } from '../ui.js';
import { buildMonth, upcoming, daysAwayLabel, parseDayKey, dayKey, lunarOf, weekdayName } from '../lunar.js';

const HUE_ICON = { rose: 'heart', gold: 'cake', teal: 'star' };

export async function render(root, ctx) {
  let events = ctx.events || [];
  try {
    const res = await api.events.list();
    events = res.events || [];
    ctx.events = events;
  } catch (err) {
    toast(err.message, 'err');
  }

  const today = new Date();
  const state = { year: today.getFullYear(), month: today.getMonth() + 1, selected: dayKey(today) };

  root.innerHTML = `
    ${viewHead({
      title: '日历',
      sub: '节日、生日、我们一起走过的那一天，都会自己标出来。',
      actions: `<button class="btn" data-birthday>${icon('cake', { size: 12 })}生日设置</button>
                <button class="btn btn-primary" data-add>${icon('plus', { size: 12 })}加一个日子</button>`,
    })}
    <div class="cal-wrap">
      <section class="card">
        <div class="cal-head">
          <button class="btn btn-icon" data-prev aria-label="上个月">${icon('chevron', { size: 12 })}</button>
          <p class="cal-month" data-month>${state.year} 年 ${state.month} 月</p>
          <button class="btn btn-icon" data-next aria-label="下个月"><span style="display:inline-flex;transform:scaleX(-1)">${icon('chevron', { size: 12 })}</span></button>
          <button class="btn btn-sm btn-quiet" data-today>回到今天</button>
        </div>
        <div class="cal-week" aria-hidden="true">
          <span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span>
        </div>
        <div class="cal-grid" data-grid role="grid" aria-label="月历"></div>
        <div class="cal-legend" style="margin-top:12px">
          <span>${icon('cake', { size: 11 })}生日</span>
          <span>${icon('heart', { size: 11 })}纪念日</span>
          <span>${icon('star', { size: 11 })}节日</span>
        </div>
      </section>

      <aside class="cal-side">
        <section class="card">
          <div class="card-head"><h2 class="card-title">这个月</h2><span class="card-note" data-month-count></span></div>
          <div data-month-list></div>
        </section>
        <section class="card">
          <div class="card-head"><h2 class="card-title">接下来</h2><span class="card-note">最近 4 个</span></div>
          <div data-upcoming></div>
        </section>
      </aside>
    </div>`;

  function paint() {
    const month = buildMonth(state.year, state.month, ctx.settings, events);
    root.querySelector('[data-month]').textContent = `${state.year} 年 ${state.month} 月`;
    const grid = root.querySelector('[data-grid]');
    grid.innerHTML = month
      .map((cell) => {
        if (!cell) return '<div class="cal-cell is-empty" aria-hidden="true"></div>';
        const isToday = cell.key === dayKey(new Date());
        const isSelected = cell.key === state.selected;
        const marks = cell.specials.slice(0, 2);
        const more = cell.specials.length - marks.length;
        return `<button class="cal-cell${isToday ? ' is-today' : ''}${isSelected ? ' is-selected' : ''}${cell.weekend ? ' is-weekend' : ''}"
            role="gridcell" data-day="${cell.key}" aria-label="${cell.key} ${cell.specials.map((s) => s.title).join(' ')}">
          <span class="cal-day">${cell.day}</span>
          <span class="cal-lunar">${esc(cell.lunarLabel)}</span>
          <span class="cal-marks">
            ${marks
              .map(
                (s) =>
                  `<span class="cal-mark cal-mark-${s.hue || 'rose'}">${icon(HUE_ICON[s.hue] || 'star', { size: 9 })}${esc(s.title)}</span>`,
              )
              .join('')}
            ${more > 0 ? `<span class="cal-mark">+${more}</span>` : ''}
          </span>
        </button>`;
      })
      .join('');

    const monthItems = [];
    for (const cell of month) {
      if (!cell) continue;
      for (const s of cell.specials) monthItems.push({ ...s, day: cell.day, key: cell.key });
    }
    root.querySelector('[data-month-count]').textContent = monthItems.length ? `${monthItems.length} 个` : '';
    root.querySelector('[data-month-list]').innerHTML = monthItems.length
      ? monthItems
          .map((s) => {
            const away = Math.round((parseDayKey(s.key) - new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)) / 86400000);
            return `<div class="special-item">
              <span class="special-date">${s.day} 日<br>${weekdayName(parseDayKey(s.key))}</span>
              <span class="special-main">
                <span class="special-title">${esc(s.title)}</span>
                ${s.note ? `<span class="special-note">${esc(s.note)}</span>` : ''}
              </span>
              <span class="special-away">${esc(daysAwayLabel(away))}</span>
            </div>`;
          })
          .join('')
      : `<p class="card-note">这个月还是普通的日子。</p>`;

    const next = upcoming(new Date(), ctx.settings, events, 4);
    root.querySelector('[data-upcoming]').innerHTML = next.length
      ? next
          .map(
            (s) => `<div class="special-item">
              <span class="special-date">${s.date.slice(5).replace('-', ' / ')}</span>
              <span class="special-main">
                <span class="special-title">${esc(s.title)}</span>
                ${s.note ? `<span class="special-note">${esc(s.note)}</span>` : ''}
              </span>
              <span class="special-away">${esc(daysAwayLabel(s.daysAway))}</span>
            </div>`,
          )
          .join('')
      : `<p class="card-note">还没有记下什么日子。</p>`;

    grid.querySelectorAll('[data-day]').forEach((btn) =>
      btn.addEventListener('click', () => {
        state.selected = btn.dataset.day;
        paint();
        openDay(btn.dataset.day);
      }),
    );
  }

  async function openDay(key) {
    const date = parseDayKey(key);
    const lunar = lunarOf(date);
    const map = buildMonth(state.year, state.month, ctx.settings, events);
    const cell = [...map].filter(Boolean).find((c) => c.key === key);
    const specials = cell ? cell.specials : [];
    const dayEvents = events.filter((e) => e.date === key || (e.yearly && e.date.slice(5) === key.slice(5)));

    await openModal({
      title: `${formatDate(date)} ${weekdayName(date)}`,
      hideSubmit: true,
      cancelText: '关掉',
      body: `
        <p class="card-note">农历 ${esc(lunar.monthLabel)}${esc(lunar.dayLabel)}${lunar.leap ? '（闰月）' : ''}</p>
        ${
          specials.length || dayEvents.length
            ? `<ul class="day-events">
                ${specials
                  .map(
                    (s) => `<li class="day-event">
                      <span class="tag tag-${s.hue || 'rose'}">${esc(s.title)}</span>
                      ${s.note ? `<span class="special-note">${esc(s.note)}</span>` : ''}
                    </li>`,
                  )
                  .join('')}
                ${dayEvents
                  .map(
                    (e) => `<li class="day-event">
                      <span class="tag tag-${e.hue || 'rose'}">${esc(e.title)}</span>
                      ${e.note ? `<span class="special-note">${esc(e.note)}</span>` : ''}
                      <button class="btn btn-sm btn-quiet btn-danger" data-del-event="${e.id}" aria-label="删掉 ${esc(e.title)}">${icon('trash', { size: 11 })}</button>
                    </li>`,
                  )
                  .join('')}
              </ul>`
            : `<p class="card-note">这天还没有特别的事。</p>`
        }
        <button class="btn" data-quick-add>${icon('plus', { size: 12 })}在这天加一个日子</button>`,
    });

    const dialog = document.getElementById('modal');
    dialog.querySelector('[data-quick-add]')?.addEventListener('click', () => {
      dialog.close();
      openEventForm(key).then((saved) => {
        if (saved) {
          events.push(saved);
          paint();
          ctx.bumpCount('events', 1);
        }
      });
    });
    dialog.querySelectorAll('[data-del-event]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await api.events.remove(btn.dataset.delEvent);
          events = events.filter((e) => e.id !== btn.dataset.delEvent);
          ctx.events = events;
          btn.closest('.day-event').remove();
          paint();
          ctx.bumpCount('events', -1);
          toast('删掉了');
        } catch (err) {
          toast(err.message, 'err');
        }
      }),
    );
  }

  async function openEventForm(presetDate) {
    let saved = null;
    const day = presetDate || state.selected || dayKey(new Date());
    await openModal({
      title: '加一个日子',
      submitText: '加进日历',
      body: `
        <label class="field"><span class="field-label">是什么日子</span>
          <input class="input" name="title" maxlength="60" required placeholder="例如：第一次一起看海"></label>
        <div class="grid grid-2">
          <label class="field"><span class="field-label">哪一天</span>
            <input class="input" type="date" name="date" value="${day}" required></label>
          <label class="field"><span class="field-label">颜色</span>
            <select class="select" name="hue">
              <option value="rose">玫瑰 · 纪念日</option>
              <option value="gold">金色 · 生日</option>
              <option value="teal">青色 · 别的</option>
            </select></label>
        </div>
        <label class="field" style="display:flex;gap:8px;align-items:center">
          <input type="checkbox" name="yearly" checked>
          <span class="field-label" style="margin:0">每年都提醒</span>
        </label>
        <label class="field"><span class="field-label">备注（可空）</span>
          <input class="input" name="note" maxlength="200"></label>`,
      onSubmit: async (form) => {
        const data = new FormData(form);
        const res = await api.events.add({
          title: data.get('title'),
          date: data.get('date'),
          yearly: data.get('yearly') === 'on',
          hue: data.get('hue'),
          note: data.get('note'),
        });
        saved = res.event;
        toast('加好了');
        return true;
      },
    });
    return saved;
  }

  root.querySelector('[data-prev]').addEventListener('click', () => {
    state.month -= 1;
    if (state.month < 1) {
      state.month = 12;
      state.year -= 1;
    }
    paint();
  });
  root.querySelector('[data-next]').addEventListener('click', () => {
    state.month += 1;
    if (state.month > 12) {
      state.month = 1;
      state.year += 1;
    }
    paint();
  });
  root.querySelector('[data-today]').addEventListener('click', () => {
    const now = new Date();
    state.year = now.getFullYear();
    state.month = now.getMonth() + 1;
    state.selected = dayKey(now);
    paint();
  });
  root.querySelector('[data-add]').addEventListener('click', async () => {
    const saved = await openEventForm();
    if (saved) {
      events.push(saved);
      ctx.events = events;
      paint();
      ctx.bumpCount('events', 1);
    }
  });
  root.querySelector('[data-birthday]').addEventListener('click', () => openBirthdayForm());

  async function openBirthdayForm() {
    const her = ctx.settings.birthdayHer || { type: 'lunar-leap', month: 3, day: 3, plusDays: 0 };
    const him = ctx.settings.birthdayHim || { type: 'lunar-offset', month: 8, day: 15, plusDays: 1 };
    const typeOptions = (current) =>
      [
        ['lunar-leap', '农历闰月（优先闰月）'],
        ['lunar', '农历'],
        ['solar', '公历'],
        ['lunar-offset', '农历中秋节后一天'],
      ]
        .map(([v, label]) => `<option value="${v}" ${current === v ? 'selected' : ''}>${label}</option>`)
        .join('');

    const result = await openModal({
      title: '生日设置',
      submitText: '存好',
      wide: true,
      body: `
        <p class="field-hint">农历的日子会自动换算成当年的公历。遇到闰月会优先用闰月；这一年没有闰月，就按普通那个月过，日历上会写清楚。</p>
        <fieldset class="field" style="border:2px solid var(--line-soft);padding:12px">
          <legend class="field-label" style="padding:0 6px">她的生日</legend>
          <div class="grid grid-3">
            <label class="field"><span class="field-label">规则</span>
              <select class="select" name="herType">${typeOptions(her.type)}</select></label>
            <label class="field"><span class="field-label">月</span>
              <input class="input" type="number" name="herMonth" min="1" max="12" value="${her.month}"></label>
            <label class="field"><span class="field-label">日</span>
              <input class="input" type="number" name="herDay" min="1" max="31" value="${her.day}"></label>
          </div>
        </fieldset>
        <fieldset class="field" style="border:2px solid var(--line-soft);padding:12px">
          <legend class="field-label" style="padding:0 6px">我的生日</legend>
          <div class="grid grid-3">
            <label class="field"><span class="field-label">规则</span>
              <select class="select" name="hisType">${typeOptions(him.type)}</select></label>
            <label class="field"><span class="field-label">月</span>
              <input class="input" type="number" name="hisMonth" min="1" max="12" value="${him.month}"></label>
            <label class="field"><span class="field-label">日</span>
              <input class="input" type="number" name="hisDay" min="1" max="31" value="${him.day}"></label>
          </div>
          <p class="field-hint">现在的设置是「中秋节的第二天」，所以默认 8 月 15 日往后推 1 天。</p>
        </fieldset>`,
      onSubmit: async (form) => {
        const data = new FormData(form);
        const patch = {
          birthdayHer: {
            type: data.get('herType'),
            month: Number(data.get('herMonth')),
            day: Number(data.get('herDay')),
            plusDays: 0,
          },
          birthdayHim: {
            type: data.get('hisType'),
            month: Number(data.get('hisMonth')),
            day: Number(data.get('hisDay')),
            plusDays: data.get('hisType') === 'lunar-offset' ? 1 : 0,
          },
        };
        const res = await api.saveSettings(patch);
        ctx.settings = res.settings;
        if (ctx.onSettingsChanged) ctx.onSettingsChanged(res.settings);
        toast('存好了');
        return true;
      },
    });
    if (result) ctx.rerender();
  }

  paint();
}
