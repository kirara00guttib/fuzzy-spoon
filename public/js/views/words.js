// 悄悄话：对彼此说的话，带日期，一条一条存着
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, formatDate, emptyState, toast, viewHead, confirmBox } from '../ui.js';

export async function render(root, ctx) {
  const { user, avatars } = ctx;
  let notes = [];
  try {
    const res = await api.notes.list();
    notes = res.notes || [];
  } catch (err) {
    toast(err.message, 'err');
  }

  root.innerHTML = `
    ${viewHead({
      title: '悄悄话',
      sub: '两个人的留言板。写下来的会带着日期一直留着。',
      actions: '',
    })}
    <div class="stack">
      <form class="card composer" data-form>
        <label class="field">
          <span class="field-label">写给 ${esc(user.name === ctx.settings.herName ? ctx.settings.hisName : ctx.settings.herName)}，也写给以后的我们</span>
          <textarea class="textarea" name="text" maxlength="600" placeholder="今天想说的话…" required></textarea>
        </label>
        <div class="composer-foot">
          <span class="tag tag-${user.avatar === 'cat' ? 'teal' : 'gold'}">
            ${esc(user.name)} · ${formatDate(new Date(), { withWeekday: true })}
          </span>
          <button class="btn btn-primary" type="submit">${icon('check', { size: 12 })}放进去</button>
        </div>
      </form>

      <section>
        <div class="card-head" style="border-bottom:none;margin:0 0 8px;padding:0">
          <h2 class="card-title">全部悄悄话</h2>
          <span class="card-note" data-count>${notes.length} 句</span>
        </div>
        <ul class="note-list" data-list>
          ${
            notes.length
              ? notes.map(noteCard).join('')
              : `<li>${emptyState({ title: '还没有悄悄话', text: '上面写一句，就是这里的第一句了。' })}</li>`
          }
        </ul>
      </section>
    </div>`;

  function noteCard(note) {
    const side = note.avatar === 'dog' ? 'dog' : 'cat';
    return `<li class="note from-${side}" data-note="${note.id}">
      <img class="avatar" src="${avatars[side]}" alt="">
      <div class="note-bubble">
        <div class="note-meta">
          <b>${esc(note.authorName || '')}</b>
          <time datetime="${esc(note.createdAt)}">${formatDate(note.createdAt, { withWeekday: true, withTime: true })}</time>
        </div>
        <p class="note-text">${esc(note.text)}</p>
      </div>
      <button class="btn btn-icon btn-quiet note-del" data-del="${note.id}" aria-label="删掉这句悄悄话">${icon('trash', { size: 12 })}</button>
    </li>`;
  }

  const form = root.querySelector('[data-form]');
  const textarea = form.querySelector('textarea');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const value = textarea.value.trim();
    if (!value) {
      textarea.focus();
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const res = await api.notes.add(value);
      const list = root.querySelector('[data-list]');
      if (list.querySelector('.empty')) list.innerHTML = '';
      list.insertAdjacentHTML('afterbegin', noteCard(res.note));
      bindDelete(root.querySelector(`[data-note="${res.note.id}"] [data-del]`));
      textarea.value = '';
      root.querySelector('[data-count]').textContent = `${list.querySelectorAll('.note').length} 句`;
      toast('放进去了');
      ctx.bumpCount('notes', 1);
      textarea.focus();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
    }
  });

  function bindDelete(btn) {
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const yes = await confirmBox('删掉这一句？', '删掉就找不回来了。');
      if (!yes) return;
      try {
        await api.notes.remove(btn.dataset.del);
        btn.closest('.note').remove();
        const list = root.querySelector('[data-list]');
        root.querySelector('[data-count]').textContent = `${list.querySelectorAll('.note').length} 句`;
        ctx.bumpCount('notes', -1);
        if (!list.querySelector('.note')) {
          list.innerHTML = `<li>${emptyState({ title: '还没有悄悄话', text: '上面写一句，就是这里的第一句了。' })}</li>`;
        }
        toast('删掉了');
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  }

  root.querySelectorAll('[data-del]').forEach(bindDelete);
}
