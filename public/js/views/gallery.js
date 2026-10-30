// 照片墙：预签名直传 R2，这里只负责把它们摆好
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, toast, viewHead, confirmBox, emptyState, formatDate } from '../ui.js';

export async function render(root, ctx) {
  let photos = [];
  let storage = 'local';
  try {
    const res = await api.photos.list();
    photos = res.photos || [];
    storage = res.storage?.mode || 'local';
  } catch (err) {
    toast(err.message, 'err');
  }

  const storageLabel =
    storage === 'r2'
      ? 'Cloudflare R2 · 预签名直传'
      : storage === 'unconfigured'
        ? '云端存储还没配置 R2，见 DEPLOY.md 第二步'
        : '本机存储 · 配好 R2 自动切换';

  root.innerHTML = `
    ${viewHead({
      title: '照片墙',
      sub: '上传时浏览器只拿到一条 10 分钟后失效的链接，密钥一直在你自己的机器上。',
      actions: `<button class="btn btn-primary" data-upload>${icon('upload', { size: 12 })}上传照片</button>`,
    })}
    <div class="gallery-toolbar">
      <span class="storage-badge">${icon('picture', { size: 12 })}${esc(storageLabel)}</span>
      <span class="card-note" data-count>${photos.length} 张</span>
      <span class="card-note">· 也可以直接把照片拖进来</span>
    </div>
    <input type="file" accept="image/*" multiple hidden data-input>
    ${
      photos.length
        ? `<div class="tile-grid" data-grid>${photos.map(tile).join('')}</div>
           <p class="drop-hint" style="margin-top:16px">松手就上传 · jpg / png / webp / avif / gif</p>`
        : emptyState({
            title: '照片墙还是空的',
            text: '把照片拖到这个页面里，或者点右上角「上传照片」。jpg / png / webp / avif / gif 都行。',
            action: `<button class="btn btn-primary" data-upload>${icon('upload', { size: 12 })}选几张照片</button>`,
          })
    }`;

  function tile(p, index) {
    return `<button class="tile" data-photo="${p.id}" data-index="${index}" aria-label="打开照片 ${esc(p.caption || p.key)}">
      <img src="${esc(p.url)}" alt="${esc(p.caption || '我们的照片')}" loading="lazy" width="${p.w || 400}" height="${p.h || 400}">
      ${p.caption ? `<span class="tile-cap">${esc(p.caption)}</span>` : ''}
    </button>`;
  }

  const input = root.querySelector('[data-input]');

  async function uploadFiles(files) {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    const btn = root.querySelector('[data-upload]');
    if (btn) btn.disabled = true;
    let done = 0;
    for (const file of list) {
      done += 1;
      toast(`正在上传 ${done} / ${list.length}：${file.name.slice(0, 18)}`);
      try {
        await api.uploadPhoto(file);
      } catch (err) {
        toast(err.message, 'err');
      }
    }
    if (btn) btn.disabled = false;
    ctx.bumpCount('photos', list.length);
    ctx.rerender();
  }

  root.querySelectorAll('[data-upload]').forEach((btn) =>
    btn.addEventListener('click', () => input.click()),
  );
  input.addEventListener('change', () => uploadFiles(input.files));

  root.querySelectorAll('[data-photo]').forEach((btn) =>
    btn.addEventListener('click', () => openLightbox(Number(btn.dataset.index))),
  );

  let dragDepth = 0;
  const onDragEnter = (ev) => {
    if (![...(ev.dataTransfer?.types || [])].includes('Files')) return;
    ev.preventDefault();
    dragDepth += 1;
    document.body.classList.add('is-dropping');
  };
  const onDragOver = (ev) => {
    if (![...(ev.dataTransfer?.types || [])].includes('Files')) return;
    ev.preventDefault();
  };
  const onDragLeave = () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) document.body.classList.remove('is-dropping');
  };
  const onDrop = (ev) => {
    if (!ev.dataTransfer?.files?.length) return;
    ev.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('is-dropping');
    uploadFiles(ev.dataTransfer.files);
  };
  document.addEventListener('dragenter', onDragEnter);
  document.addEventListener('dragover', onDragOver);
  document.addEventListener('dragleave', onDragLeave);
  document.addEventListener('drop', onDrop);

  // ── 大图 ────────────────────────────────────────────
  const lightbox = document.getElementById('lightbox');
  let currentIndex = 0;

  function openLightbox(index) {
    if (!photos.length) return;
    currentIndex = Math.max(0, Math.min(photos.length - 1, index));
    const p = photos[currentIndex];
    lightbox.innerHTML = `
      <div class="modal-form">
        <header class="modal-head">
          <h2>${formatDate(p.createdAt)}</h2>
          <button type="button" class="btn btn-icon btn-quiet" data-close aria-label="关闭">${icon('close', { size: 14 })}</button>
        </header>
        <div class="lightbox-body">
          <img class="lightbox-img" src="${esc(p.url)}" alt="${esc(p.caption || '我们的照片')}">
          <div class="lightbox-bar">
            <button class="btn btn-icon" data-prev aria-label="上一张">${icon('prev', { size: 12 })}</button>
            <span class="card-note">${currentIndex + 1} / ${photos.length}</span>
            <button class="btn btn-icon" data-next aria-label="下一张"><span style="display:inline-flex;transform:scaleX(-1)">${icon('prev', { size: 12 })}</span></button>
            <input class="input" data-caption placeholder="给这张照片写一句话" value="${esc(p.caption || '')}" maxlength="200" style="flex:1;min-width:160px">
            <button class="btn btn-sm" data-save-caption>存一下</button>
            <button class="btn btn-sm btn-danger" data-del>${icon('trash', { size: 11 })}删掉</button>
          </div>
        </div>
      </div>`;
    if (!lightbox.open) lightbox.showModal();
    lightbox.querySelector('[data-close]').addEventListener('click', () => lightbox.close());
    lightbox.querySelector('[data-prev]').addEventListener('click', () => openLightbox(currentIndex - 1 < 0 ? photos.length - 1 : currentIndex - 1));
    lightbox.querySelector('[data-next]').addEventListener('click', () => openLightbox((currentIndex + 1) % photos.length));
    lightbox.querySelector('[data-save-caption]').addEventListener('click', async () => {
      const caption = lightbox.querySelector('[data-caption]').value;
      try {
        const res = await api.photos.update(p.id, { caption });
        photos[currentIndex] = res.photo;
        toast('写好了');
        ctx.rerender();
      } catch (err) {
        toast(err.message, 'err');
      }
    });
    lightbox.querySelector('[data-del]').addEventListener('click', async () => {
      const yes = await confirmBox('删掉这张照片？', '文件会一起被删掉（R2 或本机存储都会删）。');
      if (!yes) return;
      try {
        await api.photos.remove(p.id);
        photos = photos.filter((x) => x.id !== p.id);
        lightbox.close();
        ctx.bumpCount('photos', -1);
        ctx.rerender();
        toast('删掉了');
      } catch (err) {
        toast(err.message, 'err');
      }
    });
  }

  const keyHandler = (ev) => {
    if (!lightbox.open) return;
    if (ev.key === 'ArrowLeft') lightbox.querySelector('[data-prev]')?.click();
    if (ev.key === 'ArrowRight') lightbox.querySelector('[data-next]')?.click();
  };
  document.addEventListener('keydown', keyHandler);

  return () => {
    document.removeEventListener('dragenter', onDragEnter);
    document.removeEventListener('dragover', onDragOver);
    document.removeEventListener('dragleave', onDragLeave);
    document.removeEventListener('drop', onDrop);
    document.removeEventListener('keydown', keyHandler);
    document.body.classList.remove('is-dropping');
  };
}
