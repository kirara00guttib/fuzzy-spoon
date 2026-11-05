// 悄悄话：对彼此说的话，带日期，一条一条存着；也可以录一段说给对方听
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, formatDate, emptyState, toast, viewHead, confirmBox } from '../ui.js';
import {
  MAX_SECONDS,
  VoiceRecorder,
  bindVoicePlayers,
  formatClock,
  probeDuration,
  voicePlayer,
  voiceSupported,
} from '../voice.js';

export async function render(root, ctx) {
  const { user, avatars } = ctx;
  let notes = [];
  try {
    const res = await api.notes.list();
    notes = res.notes || [];
  } catch (err) {
    toast(err.message, 'err');
  }

  const canRecord = voiceSupported();
  let recorder = null;
  let clock = null;
  let ticker = null;
  let preview = null; // { blob, url, seconds, mime }

  root.innerHTML = `
    ${viewHead({
      title: '悄悄话',
      actions: '',
    })}
    <div class="stack">
      <form class="card composer" data-form>
        <label class="field">
          <textarea class="textarea" name="text" maxlength="600" placeholder="今天想说的话…"></textarea>
        </label>
        <div class="rec-slot" data-rec-slot></div>
        <input class="rec-file" type="file" accept="audio/*" data-rec-file hidden />
        <div class="composer-foot">
          <span class="tag tag-${user.avatar === 'cat' ? 'teal' : 'gold'}">
            ${esc(user.name)} · ${formatDate(new Date(), { withWeekday: true })}
          </span>
          <div class="composer-tools">
            <button class="btn" type="button" data-rec>${icon('mic', { size: 12 })}${canRecord ? '录音' : '选录音'}</button>
            <button class="btn btn-primary" type="submit">${icon('check', { size: 12 })}放进去</button>
          </div>
        </div>
        ${canRecord ? '' : `<p class="rec-hint">http 打开时浏览器不给网页开麦克风，点「选录音」传一段上来。</p>`}
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
    const hasText = Boolean(note.text && note.text.trim());
    return `<li class="note from-${side}" data-note="${note.id}">
      <img class="avatar" src="${avatars[side]}" alt="">
      <div class="note-bubble${note.audioUrl ? ' has-voice' : ''}">
        <div class="note-meta">
          <b>${esc(note.authorName || '')}</b>
          <time datetime="${esc(note.createdAt)}">${formatDate(note.createdAt, { withWeekday: true, withTime: true })}</time>
        </div>
        ${hasText ? `<p class="note-text">${esc(note.text)}</p>` : ''}
        ${note.audioUrl ? voicePlayer(note.audioUrl, { label: `${note.authorName || ''} 的录音` }) : ''}
      </div>
      <button class="btn btn-icon btn-quiet note-del" data-del="${note.id}" aria-label="删掉这句悄悄话">${icon('trash', { size: 12 })}</button>
    </li>`;
  }

  bindVoicePlayers(root);

  // ── 录音 ───────────────────────────────────────────────
  const form = root.querySelector('[data-form]');
  const textarea = form.querySelector('textarea');
  const recBtn = form.querySelector('[data-rec]');
  const slot = form.querySelector('[data-rec-slot]');
  const fileInput = form.querySelector('[data-rec-file]');

  function clearPreview() {
    if (preview?.url) URL.revokeObjectURL(preview.url);
    preview = null;
    slot.innerHTML = '';
  }

  function paintPreview() {
    if (!preview) {
      slot.innerHTML = '';
      return;
    }
    slot.innerHTML = `<div class="rec-preview">
      ${voicePlayer(preview.url, { label: '刚才录的' })}
      <button class="btn btn-quiet btn-sm" type="button" data-rec-drop>删掉</button>
    </div>`;
    bindVoicePlayers(slot);
  }

  function paintRecording(seconds) {
    slot.innerHTML = `<div class="rec-live">
      <span class="rec-dot" aria-hidden="true"></span>
      <span class="rec-wave" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
      <span class="rec-clock" data-rec-clock>${formatClock(seconds)}</span>
      <button class="btn btn-sm" type="button" data-rec-stop>${icon('stop', { size: 12 })}停下</button>
    </div>`;
    slot.querySelector('[data-rec-stop]').addEventListener('click', stopRecording);
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
    clock = null;
  }

  async function startRecording() {
    if (!canRecord) {
      fileInput.click();
      return;
    }
    clearPreview();
    recorder = new VoiceRecorder();
    try {
      await recorder.start();
    } catch (err) {
      recorder = null;
      if (err && err.name === 'NotAllowedError') toast('没拿到麦克风权限，是不是点了拒绝？', 'err');
      else if (err && err.name === 'NotFoundError') toast('找不到麦克风', 'err');
      else toast(err.message || '录不了音，换「选录音」试试', 'err');
      return;
    }
    recBtn.classList.add('is-live');
    recBtn.innerHTML = `${icon('stop', { size: 12 })}录着`;
    let started = performance.now();
    paintRecording(0);
    ticker = setInterval(() => {
      const seconds = (performance.now() - started) / 1000;
      const el = slot.querySelector('[data-rec-clock]');
      if (el) el.textContent = formatClock(seconds);
      if (seconds >= MAX_SECONDS) stopRecording();
    }, 250);
  }

  async function stopRecording() {
    stopTicker();
    recBtn.classList.remove('is-live');
    recBtn.innerHTML = `${icon('mic', { size: 12 })}${canRecord ? '重录' : '选录音'}`;
    if (!recorder) {
      slot.innerHTML = '';
      return;
    }
    const result = await recorder.stop();
    recorder = null;
    if (!result || result.seconds < 1) {
      clearPreview();
      toast('太短了，再说一句吧');
      return;
    }
    preview = { ...result, url: URL.createObjectURL(result.blob) };
    paintPreview();
  }

  function stopEverything() {
    stopTicker();
    if (recorder) {
      recorder.cancel();
      recorder = null;
    }
  }

  recBtn.addEventListener('click', () => {
    if (recorder) stopRecording();
    else startRecording();
  });

  slot.addEventListener('click', (ev) => {
    const drop = ev.target.closest('[data-rec-drop]');
    if (!drop) return;
    clearPreview();
    recBtn.innerHTML = `${icon('mic', { size: 12 })}${canRecord ? '录音' : '选录音'}`;
  });

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    if (!/^audio\//.test(file.type || '')) {
      toast('选一个音频文件吧', 'err');
      return;
    }
    if (file.size > 24 * 1024 * 1024) {
      toast('这个文件有点大（超过 24MB）', 'err');
      return;
    }
    const url = URL.createObjectURL(file);
    const seconds = await probeDuration(url);
    if (seconds > MAX_SECONDS + 30) {
      URL.revokeObjectURL(url);
      toast(`录得太长了，留 ${Math.round(MAX_SECONDS / 60)} 分钟以内吧`, 'err');
      return;
    }
    if (preview?.url) URL.revokeObjectURL(preview.url);
    preview = { blob: file, url, seconds, mime: (file.type || 'audio/mpeg').split(';')[0] };
    paintPreview();
    recBtn.innerHTML = `${icon('mic', { size: 12 })}${canRecord ? '重录' : '重选'}`;
  });

  // ── 放进去 ─────────────────────────────────────────────
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const value = textarea.value.trim();
    if (!value && !preview) {
      textarea.focus();
      toast('写一句，或者录一段');
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    if (recorder) await stopRecording();
    const label = btn.innerHTML;
    try {
      let audio = null;
      if (preview) {
        btn.innerHTML = '传录音…';
        audio = await api.uploadAudio(preview.blob, preview.seconds);
      }
      const res = await api.notes.add(value, audio);
      const list = root.querySelector('[data-list]');
      const empty = list.querySelector('.empty');
      if (empty) empty.closest('li').remove();
      list.insertAdjacentHTML('afterbegin', noteCard(res.note));
      bindVoicePlayers(list.firstElementChild);
      bindDelete(root.querySelector(`[data-note="${res.note.id}"] [data-del]`));
      textarea.value = '';
      clearPreview();
      recBtn.innerHTML = `${icon('mic', { size: 12 })}${canRecord ? '录音' : '选录音'}`;
      root.querySelector('[data-count]').textContent = `${list.querySelectorAll('.note').length} 句`;
      toast(audio ? '录好了，带过去了' : '放进去了');
      ctx.bumpCount('notes', 1);
      textarea.focus();
    } catch (err) {
      toast(err.message, 'err');
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
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

  return () => {
    stopEverything();
    if (preview?.url) URL.revokeObjectURL(preview.url);
  };
}
