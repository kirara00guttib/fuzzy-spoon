// 日常分享：一段文字 + 几张照片 + 心情 + 「戴上耳机」的那首歌
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, formatDate, emptyState, toast, viewHead, openModal, confirmBox, shortDate } from '../ui.js';

const MOODS = ['开心', '想你', '累但幸福', '有点emo', '超期待'];

function momentCard(m, avatars) {
  const side = m.avatar === 'dog' ? 'dog' : 'cat';
  const photos = m.photos || [];
  return `<article class="card moment" data-moment="${m.id}">
    <header class="moment-head">
      <img class="avatar" src="${avatars[side]}" alt="">
      <b>${esc(m.authorName || '')}</b>
      <span class="moment-date">${formatDate(m.date, { withWeekday: true })}</span>
      ${m.mood ? `<span class="tag tag-rose">${esc(m.mood)}</span>` : ''}
    </header>
    ${m.text ? `<p class="moment-text">${esc(m.text)}</p>` : ''}
    ${
      photos.length
        ? `<div class="moment-photos ${photos.length === 1 ? 'single' : ''}">${photos
            .map(
              (p) =>
                `<img src="${esc(p.url)}" alt="${esc(p.caption || '我们的照片')}" loading="lazy" width="${p.w || 400}" height="${p.h || 400}">`,
            )
            .join('')}</div>`
        : ''
    }
    <footer class="moment-foot">
      ${
        m.bgm
          ? `<a class="tag tag-gold" href="${esc(m.bgm.url || '#')}" target="_blank" rel="noopener noreferrer" style="text-decoration:none">
              ${icon('note', { size: 10 })} 戴上耳机 · ${esc(m.bgm.title)}</a>`
          : '<span class="card-note">没有配乐</span>'
      }
      <button class="btn btn-sm btn-quiet btn-danger" data-del="${m.id}">${icon('trash', { size: 11 })}删掉</button>
    </footer>
  </article>`;
}

export async function render(root, ctx) {
  const { avatars, user } = ctx;
  let moments = [];
  try {
    const res = await api.moments.list();
    moments = res.moments || [];
  } catch (err) {
    toast(err.message, 'err');
  }

  root.innerHTML = `
    ${viewHead({
      title: '日常分享',
      actions: `<button class="btn btn-primary" data-add>${icon('plus', { size: 12 })}记一笔</button>`,
    })}
    ${
      moments.length
        ? `<div class="moment-cols" data-list>${moments.map((m) => momentCard(m, avatars)).join('')}</div>`
        : emptyState({
            title: '还没有日常',
            text: '点右上角「记一笔」，写下今天的第一条。',
            action: `<button class="btn btn-primary" data-add>${icon('plus', { size: 12 })}记一笔</button>`,
          })
    }`;

  root.querySelectorAll('[data-add]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const created = await openModal({
        title: '记一笔',
        submitText: '存进日常',
        wide: true,
        body: `
          <div class="grid grid-2">
            <label class="field"><span class="field-label">哪一天</span>
              <input class="input" type="date" name="date" value="${todayKey}" required></label>
            <div class="field">
              <span class="field-label">今天的心情</span>
              <div class="mood-row">
                ${MOODS.map(
                  (m, i) =>
                    `<label class="mood"><input type="radio" name="mood" value="${m}" ${i === 0 ? 'checked' : ''}><span>${m}</span></label>`,
                ).join('')}
              </div>
            </div>
          </div>
          <label class="field"><span class="field-label">发生了什么</span>
            <textarea class="textarea" name="text" maxlength="2000" placeholder="随便写，反正只有我们两个人看得到。"></textarea></label>
          <label class="field"><span class="field-label">照片（最多 3 张）</span>
            <input class="input" type="file" name="photos" accept="image/*" multiple></label>
          <div class="picked-photos" data-preview></div>
          <fieldset class="field" style="border:2px solid var(--line-soft);padding:12px">
            <legend class="field-label" style="padding:0 6px">${icon('note', { size: 11 })} 戴上耳机</legend>
            <div class="grid grid-2">
              <label class="field"><span class="field-label">歌名</span>
                <input class="input" name="bgmTitle" maxlength="80" placeholder="例如：午后散步"></label>
              <label class="field"><span class="field-label">链接（可空）</span>
                <input class="input" name="bgmUrl" type="url" placeholder="https://music.163.com/..."></label>
            </div>
          </fieldset>
          <p class="field-hint" data-upload-state></p>`,
        onSubmit: async (form, dialog) => {
          const data = new FormData(form);
          const text = String(data.get('text') || '').trim();
          const files = [...(form.querySelector('[name="photos"]').files || [])].slice(0, 3);
          if (!text && !files.length) throw new Error('写一句话或者放一张照片吧');
          const state = dialog.querySelector('[data-upload-state]');
          const photoIds = [];
          for (const [i, file] of files.entries()) {
            state.textContent = `正在上传第 ${i + 1} / ${files.length} 张照片…`;
            const photo = await api.uploadPhoto(file);
            photoIds.push(photo.id);
          }
          state.textContent = '';
          const bgmTitle = String(data.get('bgmTitle') || '').trim();
          const res = await api.moments.add({
            date: data.get('date'),
            text,
            mood: data.get('mood') || '',
            photoIds,
            bgm: bgmTitle ? { title: bgmTitle, url: String(data.get('bgmUrl') || '').trim() } : null,
          });
          toast('记好了');
          ctx.bumpCount('moments', 1);
          return res.moment;
        },
      });

      if (created) {
        ctx.bumpCount('photos', (created.photos || []).length);
        const list = root.querySelector('[data-list]');
        if (list) list.insertAdjacentHTML('afterbegin', momentCard(created, avatars));
        else ctx.rerender();
        bindDeletes(root, ctx);
      }
    }),
  );

  const preview = root.querySelector('[data-preview]');
  root.querySelector('[name="photos"]')?.addEventListener('change', (ev) => {
    const files = [...ev.target.files].slice(0, 3);
    preview.innerHTML = files.map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join('');
  });

  bindDeletes(root, ctx);
}

function bindDeletes(root, ctx) {
  root.querySelectorAll('[data-del]').forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', async () => {
      const yes = await confirmBox('删掉这条日常？', '照片会留在照片墙里，这里只是不再显示。');
      if (!yes) return;
      try {
        await api.moments.remove(btn.dataset.del);
        btn.closest('.moment')?.remove();
        ctx.bumpCount('moments', -1);
        if (!root.querySelector('.moment')) ctx.rerender();
        toast('删掉了');
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  });
}
