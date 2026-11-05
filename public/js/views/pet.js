// 培养系统：双方同意才领养 → 鸡蛋 / 种子 / 小箱子，每个阶段一周 → 打开收获零食 → 用零食许愿
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, formatDate, toast, viewHead, openModal, relativeTime } from '../ui.js';
import { artImg } from '../art.js';
import { FOODS, STAGES } from '../food-data.js';

const FOOD_BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f]));
const STAGE_ART = {
  egg: { ...STAGES.egg, id: 'stage-egg' },
  seed: { ...STAGES.seed, id: 'stage-seed' },
  box: { ...STAGES.box, id: 'stage-box' },
};
const CARE = [
  { key: 'water', label: '浇水', icon: 'leaf' },
  { key: 'weed', label: '除草', icon: 'sprout' },
  { key: 'feed', label: '喂食物', icon: 'cake' },
];
const POOL = ['burger', 'fries', 'cola', 'pizza', 'roastChicken', 'cake', 'cupcake', 'croissant', 'bubbleTea', 'lollipop'];

export async function render(root, ctx) {
  let pet = null;
  let accounts = ctx.accounts || [];
  let justOpened = null;

  async function load() {
    const res = await api.pet.get();
    pet = res.pet;
    if (res.accounts) accounts = res.accounts;
  }

  try {
    await load();
  } catch (err) {
    toast(err.message, 'err');
  }

  root.innerHTML = `
    ${viewHead({
      title: '培养',
      actions: '',
    })}
    <div class="pet-grid">
      <section class="card pet-stage" data-stage-area></section>
      <div class="pet-side">
        <section class="card" data-talk></section>
        <section class="card" data-shop></section>
      </div>
    </div>`;

  const partnerName = () => {
    const other = accounts.find((a) => a.id !== ctx.user.id);
    return other ? other.name : '对方';
  };

  // ── 主舞台 ───────────────────────────────────────────
  function stageArea() {
    if (!pet) return '<p class="card-note">读不到状态，刷新试试。</p>';
    const p = pet;
    if (justOpened) {
      const food = FOOD_BY_ID[justOpened];
      return `<div class="pet-scene is-open">${artImg(food, 7, 'pet-art', food ? food.name : '')}</div>
        <h2 class="pet-title">开出来了：${esc(food ? food.name : '一份小零食')}</h2>
        <p class="pet-sub">它已经放进零食柜了。攒着它，可以跟${esc(partnerName())}换一个愿望。</p>
        <div class="pet-actions"><button class="btn btn-primary" data-again>再养一个</button></div>`;
    }
    if (p.status === 'ready') {
      return `<div class="pet-scene is-ready">${artImg(STAGE_ART.box, 7, 'pet-art', '小箱子')}</div>
        <h2 class="pet-title">小箱子鼓鼓的</h2>
        <p class="pet-sub">照顾了这么久，打开看看里面是什么。</p>
        <div class="pet-actions"><button class="btn btn-primary" data-open>${icon('plus', { size: 12 })}打开小箱子</button></div>`;
    }
    if (p.status === 'growing') {
      const art = STAGE_ART[p.stage.key] || STAGE_ART.egg;
      const careRows = CARE.map((c) => {
        const have = p.care[c.key] || 0;
        const need = p.stage.need[c.key] || 0;
        const done = have >= need;
        return `<button class="care-btn${done ? ' is-done' : ''}" data-care="${c.key}" ${done ? 'disabled' : ''}>
          <span class="care-top">${icon(c.icon, { size: 14 })}<span class="care-name">${c.label}</span></span>
          <span class="care-count">${have}<span class="care-of">/${need}</span></span>
          <span class="care-bar"><span style="width:${Math.min(100, (have / need) * 100)}%"></span></span>
        </button>`;
      }).join('');
      const missing = CARE.filter((c) => (p.care[c.key] || 0) < p.stage.need[c.key])
        .map((c) => `${c.label}还差 ${p.stage.need[c.key] - (p.care[c.key] || 0)} 次`)
        .join('、');
      const tip = !p.careOk
        ? `还需要：${missing}`
        : p.timeOk
          ? '照顾够了，它就快长大了！'
          : '照顾够了，剩下交给时间。';
      return `<div class="pet-scene">${artImg(art, 7, 'pet-art', p.stage.name)}</div>
        <div class="pet-stage-head">
          <h2 class="pet-title">${esc(p.stage.name)}</h2>
          <span class="tag tag-rose">第 ${p.stageIndex + 1} / ${p.stageCount} 阶段</span>
        </div>
        <div class="mile-top"><span>这一周</span><span>${p.daysLeft > 0 ? `还有 ${p.daysLeft} 天` : '时间到了'}</span></div>
        <div class="mile-bar" role="progressbar" aria-label="这一阶段的进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.progress * 100)}">
          <span style="width:${Math.round(p.progress * 100)}%"></span>
        </div>
        <div class="pet-care">${careRows}</div>
        <p class="pet-tip">${esc(tip)}</p>`;
    }
    // idle：还没开始 / 想再养一个
    const myConsent = p.myConsent;
    const partnerConsent = p.consent.some((id) => id !== ctx.user.id);
    return `<div class="pet-scene is-egg">${artImg(STAGE_ART.egg, 7, 'pet-art', '鸡蛋')}</div>
      <h2 class="pet-title">一只蛋在等你</h2>
      <ul class="consent-list">
        <li class="consent-row${myConsent ? ' is-ok' : ''}">
          <span class="consent-who">我</span>
          <span class="consent-state">${myConsent ? '已同意' : '还没同意'}</span>
          ${myConsent ? icon('check', { size: 14 }) : `<button class="btn btn-sm" data-consent>同意领养</button>`}
        </li>
        <li class="consent-row${partnerConsent ? ' is-ok' : ''}">
          <span class="consent-who">${esc(partnerName())}</span>
          <span class="consent-state">${partnerConsent ? '已同意' : '还没同意'}</span>
          ${partnerConsent ? icon('check', { size: 14 }) : '<span class="card-note">等 TA 点头</span>'}
        </li>
      </ul>
      <p class="pet-tip">${p.cycles ? `你们已经养成了 ${p.cycles} 个。` : '养之前先说好，谁负责浇水。'}</p>`;
  }

  // ── 说给它听 ─────────────────────────────────────────
  function talkArea() {
    const messages = (pet && pet.messages) || [];
    const rows = messages.slice(-8).map((m) => {
      const mine = m.author === ctx.user.id;
      const seen = (m.seenBy || []).includes('__both__') || ((m.seenBy || []).length > 0 && !mine);
      return `<li class="talk-item${mine ? ' is-mine' : ''}">
        <div class="talk-bubble">
          <p class="talk-text">${esc(m.text)}</p>
          <p class="talk-meta">${esc(m.authorName)} · ${relativeTime(m.createdAt)}${mine && seen ? ' · 已带到' : ''}</p>
        </div>
      </li>`;
    }).join('');
    return `<div class="card-head"><h2 class="card-title">说给它听</h2><span class="card-note">它会替你带给${esc(partnerName())}</span></div>
      <form class="talk-form" data-talk-form>
        <input class="input" name="text" maxlength="300" placeholder="对着它说一句…" required>
        <button class="btn btn-primary" type="submit">${icon('talk', { size: 12 })}说</button>
      </form>
      ${rows ? `<ul class="talk-list">${rows}</ul>` : '<p class="card-note" style="margin-top:12px">还没有人跟它说过话。</p>'}`;
  }

  // ── 零食柜 + 愿望 ────────────────────────────────────
  function shopArea() {
    const foods = (pet && pet.foods) || {};
    const owned = POOL.filter((id) => (foods[id] || 0) > 0);
    const cells = owned.length
      ? owned
          .map((id) => {
            const f = FOOD_BY_ID[id];
            return `<div class="shop-item">
              ${artImg(f, 4, '', f.name)}
              <span class="shop-name">${esc(f.name)}</span>
              <span class="shop-count">×${foods[id]}</span>
            </div>`;
          })
          .join('')
      : '<p class="card-note">还是空的，等第一个小箱子打开。</p>';
    const wishes = ((pet && pet.wishes) || [])
      .slice(0, 6)
      .map((w) => {
        const f = FOOD_BY_ID[w.foodId];
        return `<li class="wish-item">
          <span class="wish-food">${artImg(f, 2, '', f ? f.name : '')}</span>
          <span class="wish-main">
            <span class="wish-text">${esc(w.text)}</span>
            <span class="wish-meta">${esc(w.fromName)} 用 ${esc(f ? f.name : '一个零食')} 换的 · ${relativeTime(w.createdAt)}</span>
          </span>
        </li>`;
      })
      .join('');
    return `<div class="card-head"><h2 class="card-title">零食柜</h2><span class="card-note">${owned.length ? `${owned.reduce((s, id) => s + foods[id], 0)} 个` : '空'}</span></div>
      <div class="shop-grid">${cells}</div>
      <button class="btn btn-wide" data-wish ${owned.length ? '' : 'disabled'} style="margin-top:12px">${icon('heart', { size: 12 })}用零食换一个愿望</button>
      ${wishes ? `<ul class="wish-list">${wishes}</ul>` : ''}`;
  }

  // ── 渲染 & 事件 ──────────────────────────────────────
  async function paint() {
    root.querySelector('[data-stage-area]').innerHTML = stageArea();
    root.querySelector('[data-talk]').innerHTML = talkArea();
    root.querySelector('[data-shop]').innerHTML = shopArea();
    bind();
    // 对方的留言标为已读
    if (pet && pet.messages.some((m) => m.author !== ctx.user.id && !(m.seenBy || []).length)) {
      api.pet.seen().catch(() => {});
    }
  }

  function bind() {
    root.querySelector('[data-consent]')?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        const res = await api.pet.consent();
        pet = res.pet;
        toast(res.started ? '开始养啦！' : '已同意，等 TA 点头');
        paint();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    root.querySelectorAll('[data-care]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const res = await api.pet.care(btn.dataset.care);
          pet = res.pet;
          paint();
        } catch (err) {
          toast(err.message, 'err');
          btn.disabled = false;
        }
      }),
    );
    root.querySelector('[data-open]')?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        const res = await api.pet.open();
        justOpened = res.foodId;
        pet = res.pet;
        const food = FOOD_BY_ID[res.foodId];
        toast(`开出了 ${food ? food.name : '小零食'}！`);
        paint();
      } catch (err) {
        toast(err.message, 'err');
        ev.target.disabled = false;
      }
    });
    root.querySelector('[data-again]')?.addEventListener('click', () => {
      justOpened = null;
      paint();
    });
    root.querySelector('[data-talk-form]')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.target;
      const value = String(new FormData(form).get('text') || '').trim();
      if (!value) return;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await api.pet.talk(value);
        form.reset();
        await load();
        paint();
        toast('它记住了');
      } catch (err) {
        toast(err.message, 'err');
      } finally {
        btn.disabled = false;
      }
    });
    root.querySelector('[data-wish]')?.addEventListener('click', () => openWish());
  }

  async function openWish() {
    const foods = (pet && pet.foods) || {};
    const owned = POOL.filter((id) => (foods[id] || 0) > 0);
    if (!owned.length) return toast('先攒到一个零食吧', 'err');
    const options = owned
      .map((id) => `<option value="${id}">${esc(FOOD_BY_ID[id].name)} ×${foods[id]}</option>`)
      .join('');
    const saved = await openModal({
      title: `向${partnerName()}许一个愿`,
      submitText: '许下',
      body: `
        <p class="card-note">用掉一个零食，换 ${esc(partnerName())} 帮你做一件事。</p>
        <label class="field"><span class="field-label">用哪个零食换</span>
          <select class="select" name="foodId">${options}</select></label>
        <label class="field"><span class="field-label">你的愿望</span>
          <textarea class="textarea" name="text" maxlength="120" placeholder="例如：这周末陪我去吃火锅、唱歌给我听…" required></textarea></label>`,
      onSubmit: async (form) => {
        const data = new FormData(form);
        const value = String(data.get('text') || '').trim();
        if (!value) throw new Error('写下愿望吧');
        const res = await api.pet.wish(value, data.get('foodId'));
        pet = res.pet;
        toast('愿望已经送出去了');
        return true;
      },
    });
    if (saved) paint();
  }

  await paint();
  return () => {};
}
