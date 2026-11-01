// 购物车：想一起做的事，一件一件放进来，做完划掉
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, formatDate, emptyState, toast, viewHead, confirmBox } from '../ui.js';

export async function render(root, ctx) {
  const { user, avatars } = ctx;
  let cart = [];
  try {
    const res = await api.cart.list();
    cart = res.cart || [];
  } catch (err) {
    toast(err.message, 'err');
  }

  root.innerHTML = `
    ${viewHead({
      title: '购物车',
      sub: '想一起做的事都先放进车里，做完了划掉。',
      actions: '',
    })}
    <div class="stack">
      <form class="card composer" data-form>
        <label class="field">
          <span class="field-label">放进车里一件想做的事</span>
          <input class="input" name="text" maxlength="120" placeholder="例如：一起去看海、学会做提拉米苏、养一只猫" required>
        </label>
        <div class="composer-foot">
          <input class="input" name="note" maxlength="200" placeholder="想补充点什么？（可空）" style="flex:1;min-width:180px">
          <button class="btn btn-primary" type="submit">${icon('plus', { size: 12 })}加进车里</button>
        </div>
      </form>

      <div class="card cart-bar">
        <div class="cart-bar-main">
          <span class="cart-big" data-count>0</span>
          <span class="cart-label">件想做的事</span>
        </div>
        <div class="mile-bar cart-progress" role="progressbar" aria-label="完成进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <span data-fill style="width:0%"></span>
        </div>
        <span class="card-note" data-done-note>已经一起做了 0 件</span>
      </div>

      <section>
        <div class="card-head" style="border-bottom:none;margin:0 0 8px;padding:0">
          <h2 class="card-title">还想一起做</h2>
          <span class="card-note" data-pending-count></span>
        </div>
        <ul class="cart-list" data-list></ul>
      </section>

      <section data-done-wrap hidden>
        <div class="card-head" style="border-bottom:none;margin:0 0 8px;padding:0">
          <h2 class="card-title">已经一起做了</h2>
        </div>
        <ul class="cart-list" data-done-list></ul>
      </section>
    </div>`;

  function itemCard(item, done) {
    const side = item.avatar === 'dog' ? 'dog' : 'cat';
    return `<li class="cart-item${done ? ' is-done' : ''}" data-item="${item.id}">
      <button class="cart-check" data-toggle="${item.id}" aria-pressed="${done}" aria-label="${done ? '标记为没做' : '标记为做过'}">
        ${done ? icon('check', { size: 14 }) : ''}
      </button>
      <div class="cart-main">
        <p class="cart-text">${esc(item.text)}</p>
        ${item.note ? `<p class="cart-note">${esc(item.note)}</p>` : ''}
        <p class="cart-meta">
          <img class="cart-avatar" src="${avatars[side]}" alt="">
          <span>${esc(item.authorName || '')} 放进来的</span>
          <span>· ${formatDate(item.createdAt)}</span>
          ${done && item.doneBy ? `<span>· ${esc(item.doneBy)} 划掉的</span>` : ''}
        </p>
      </div>
      <button class="btn btn-icon btn-quiet btn-danger" data-del="${item.id}" aria-label="从车里拿掉">${icon('trash', { size: 12 })}</button>
    </li>`;
  }

  function paint() {
    const pending = cart.filter((c) => !c.done);
    const done = cart.filter((c) => c.done);
    root.querySelector('[data-list]').innerHTML = pending.length
      ? pending.map((c) => itemCard(c, false)).join('')
      : `<li>${emptyState({ title: '车里还是空的', text: '在上面写一件想一起做的事吧。' })}</li>`;
    const doneWrap = root.querySelector('[data-done-wrap]');
    doneWrap.hidden = !done.length;
    root.querySelector('[data-done-list]').innerHTML = done.map((c) => itemCard(c, true)).join('');
    root.querySelector('[data-count]').textContent = pending.length;
    root.querySelector('[data-done-note]').textContent = `已经一起做了 ${done.length} 件`;
    const pct = cart.length ? Math.round((done.length / cart.length) * 100) : 0;
    root.querySelector('[data-fill]').style.width = `${pct}%`;
    root.querySelector('.cart-progress').setAttribute('aria-valuenow', String(pct));
    root.querySelector('[data-pending-count]').textContent = pending.length ? `${pending.length} 件` : '';
    bind();
  }

  function bind() {
    root.querySelectorAll('[data-toggle]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const item = cart.find((c) => c.id === btn.dataset.toggle);
        if (!item) return;
        btn.disabled = true;
        try {
          const res = await api.cart.update(item.id, { done: !item.done });
          Object.assign(item, res.item);
          paint();
          toast(res.item.done ? '又一起做成一件' : '放回车里了');
        } catch (err) {
          toast(err.message, 'err');
        } finally {
          btn.disabled = false;
        }
      }),
    );
    root.querySelectorAll('[data-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const yes = await confirmBox('从车里拿掉？', '只是不再显示，做过的事该记的都已经记着了。');
        if (!yes) return;
        try {
          await api.cart.remove(btn.dataset.del);
          cart = cart.filter((c) => c.id !== btn.dataset.del);
          paint();
        } catch (err) {
          toast(err.message, 'err');
        }
      }),
    );
  }

  const form = root.querySelector('[data-form]');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const data = new FormData(form);
    const value = String(data.get('text') || '').trim();
    if (!value) {
      form.querySelector('[name="text"]').focus();
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await api.cart.add({ text: value, note: data.get('note') });
      cart.unshift(res.item);
      form.reset();
      paint();
      toast('放进车里了');
      form.querySelector('[name="text"]').focus();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  paint();
  void user;
}
