// 恋爱时间：在一起多久了，以及接下来的日子
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, formatDate, openModal, toast, viewHead, toLocalInputValue } from '../ui.js';
import { upcoming, daysAwayLabel, parseDayKey } from '../lunar.js';

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function breakdown(started) {
  const now = new Date();
  const diff = Math.max(0, now - started);
  const seconds = Math.floor(diff / 1000);
  return {
    totalSeconds: seconds,
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    mins: Math.floor((seconds % 3600) / 60),
    secs: seconds % 60,
  };
}

function nextAnniversary(started) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  let d = new Date(now.getFullYear(), started.getMonth(), started.getDate(), 12);
  if (d < today) d = new Date(now.getFullYear() + 1, started.getMonth(), started.getDate(), 12);
  const days = Math.round((d - today) / 86400000);
  return { date: d, days, years: d.getFullYear() - started.getFullYear() };
}

export async function render(root, ctx) {
  const { settings, counts } = ctx;
  const started = new Date(settings.startedAt);
  const b = breakdown(started);
  const anniv = nextAnniversary(started);
  const milestone = Math.ceil((b.days + 1) / 100) * 100;
  const milestoneFrom = milestone - 100;
  const progress = Math.round(((b.days - milestoneFrom) / 100) * 100);
  const restart = upcoming(new Date(), settings, ctx.events, 4);

  root.innerHTML = `
    ${viewHead({
      title: '恋爱时间',
      sub: `从 ${formatDate(started, { withWeekday: true })}开始算。这个日子随时可以改。`,
      actions: `<button class="btn" data-edit>${icon('plus', { size: 12 })}改一改</button>`,
    })}
    <div class="stack">
      <section class="card time-hero">
        <div>
          <p class="time-label">我们已经在一起</p>
          <p class="time-big"><span data-days>${b.days.toLocaleString('en-US')}</span><span class="time-unit">天</span></p>
          <p class="time-live">
            <span><b data-hours>${b.hours}</b> 小时</span>
            <span><b data-mins>${String(b.mins).padStart(2, '0')}</b> 分</span>
            <span><b data-secs>${String(b.secs).padStart(2, '0')}</b> 秒</span>
          </p>
        </div>
        <div class="time-side">
          <div class="mile-top"><span>下一个整百天</span><span>第 ${milestone} 天</span></div>
          <div class="mile-bar" role="progressbar" aria-label="距离第 ${milestone} 天的进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
            <span data-milefill style="width:${progress}%"></span>
          </div>
          <p class="mile-foot" data-milefoot>还有 ${milestone - b.days} 天</p>
        </div>
      </section>

      <div class="grid grid-2">
        <section class="card">
          <div class="card-head"><h2 class="card-title">我们的第一天</h2><span class="card-note">${WEEK[started.getDay()]}</span></div>
          <dl class="stat-list">
            <div class="stat-row"><dt>第一天</dt><dd>${formatDate(started)}</dd></div>
            <div class="stat-row"><dt>第一次见面到今天</dt><dd>${b.days.toLocaleString('en-US')}<small>天</small></dd></div>
            <div class="stat-row"><dt>下一次周年</dt><dd>${formatDate(anniv.date)}</dd></div>
            <div class="stat-row"><dt>距离那天</dt><dd>${daysAwayLabel(anniv.days)}</dd></div>
          </dl>
        </section>

        <section class="card">
          <div class="card-head"><h2 class="card-title">一起走过</h2><span class="card-note">这里存下的东西</span></div>
          <dl class="stat-list">
            <div class="stat-row"><dt>悄悄话</dt><dd>${counts.notes ?? 0}<small>句</small></dd></div>
            <div class="stat-row"><dt>日常分享</dt><dd>${counts.moments ?? 0}<small>篇</small></dd></div>
            <div class="stat-row"><dt>照片</dt><dd>${counts.photos ?? 0}<small>张</small></dd></div>
            <div class="stat-row"><dt>日历上的日子</dt><dd>${counts.events ?? 0}<small>个</small></dd></div>
          </dl>
        </section>
      </div>

      <section class="card">
        <div class="card-head"><h2 class="card-title">接下来的日子</h2><span class="card-note">生日、节日、周年</span></div>
        ${
          restart.length
            ? `<ul class="mini-list">${restart
                .map(
                  (item) => `<li class="mini-item">
                    <span class="mini-when">${item.date.slice(5).replace('-', ' / ')}</span>
                    <span class="mini-title">${esc(item.title)}</span>
                    <span class="tag tag-${item.hue || 'rose'}">${daysAwayLabel(item.daysAway)}</span>
                  </li>`,
                )
                .join('')}</ul>`
            : `<p class="card-note">日历上还没有日子，去「日历」里加一个吧。</p>`
        }
      </section>
    </div>`;

  // 每秒跳一下
  const timer = setInterval(() => {
    const nb = breakdown(started);
    const days = root.querySelector('[data-days]');
    if (!days) return;
    days.textContent = nb.days.toLocaleString('en-US');
    root.querySelector('[data-hours]').textContent = nb.hours;
    root.querySelector('[data-mins]').textContent = String(nb.mins).padStart(2, '0');
    root.querySelector('[data-secs]').textContent = String(nb.secs).padStart(2, '0');
    const fill = root.querySelector('[data-milefill]');
    const foot = root.querySelector('[data-milefoot]');
    const bar = root.querySelector('.mile-bar');
    const pct = Math.round(((nb.days - milestoneFrom) / 100) * 100);
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (bar) bar.setAttribute('aria-valuenow', String(pct));
    if (foot) foot.textContent = `还有 ${Math.max(0, milestone - nb.days)} 天`;
  }, 1000);

  root.querySelector('[data-edit]').addEventListener('click', async () => {
    const result = await openModal({
      title: '改一改',
      submitText: '存好',
      body: `
        <label class="field">
          <span class="field-label">我们在一起的第一天</span>
          <input class="input" type="datetime-local" name="startedAt" value="${toLocalInputValue(started)}" required>
          <span class="field-hint">选到分钟就行，秒不重要。</span>
        </label>
        <div class="grid grid-2">
          <label class="field"><span class="field-label">她的名字</span>
            <input class="input" name="herName" value="${esc(settings.herName)}" maxlength="24"></label>
          <label class="field"><span class="field-label">我的名字</span>
            <input class="input" name="hisName" value="${esc(settings.hisName)}" maxlength="24"></label>
        </div>
        <label class="field">
          <span class="field-label">背景的季节</span>
          <select class="select" name="season">
            ${[
              ['auto', '跟着真实季节变'],
              ['spring', '春天 · 樱花飘'],
              ['summer', '夏天 · 萤火虫'],
              ['autumn', '秋天 · 落叶'],
              ['winter', '冬天 · 下雪'],
            ]
              .map(([v, label]) => `<option value="${v}" ${settings.season === v ? 'selected' : ''}>${label}</option>`)
              .join('')}
          </select>
        </label>`,
      onSubmit: async (form) => {
        const data = new FormData(form);
        const raw = data.get('startedAt');
        if (!raw) throw new Error('选一个日子吧');
        const patch = {
          startedAt: new Date(raw).toISOString(),
          herName: data.get('herName'),
          hisName: data.get('hisName'),
          season: data.get('season'),
        };
        const res = await api.saveSettings(patch);
        ctx.settings = res.settings;
        if (ctx.onSettingsChanged) ctx.onSettingsChanged(res.settings);
        toast('改好了');
        return true;
      },
    });
    if (result) ctx.rerender();
  });

  return () => clearInterval(timer);
}
