// 一起听歌：三首浏览器现合成的小曲 + 自己收藏的音乐网站链接
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, openModal, toast, viewHead, confirmBox } from '../ui.js';

const CASSETTE = `
<svg class="cassette" viewBox="0 0 60 38" role="img" aria-label="一台画出来的卡带机">
  <rect x="2" y="5" width="56" height="28" fill="#EDE2CC" stroke="#2E2536" stroke-width="1"/>
  <rect x="9" y="10" width="42" height="13" fill="#DCCFB6" stroke="#2E2536" stroke-width="1"/>
  <g class="reel" style="transform-origin:21px 16.5px">
    <rect x="20" y="12" width="2" height="9" fill="#2E2536"/>
    <rect x="16" y="16" width="9" height="2" fill="#2E2536"/>
    <rect x="20" y="15" width="2" height="2" fill="#C2506A"/>
  </g>
  <g class="reel" style="transform-origin:39px 16.5px">
    <rect x="38" y="12" width="2" height="9" fill="#2E2536"/>
    <rect x="34" y="16" width="9" height="2" fill="#2E2536"/>
    <rect x="38" y="15" width="2" height="2" fill="#C2506A"/>
  </g>
  <rect x="9" y="27" width="42" height="3" fill="#C9BBA0"/>
  <rect x="11" y="32" width="7" height="1" fill="#2E2536"/>
  <rect x="42" y="32" width="7" height="1" fill="#2E2536"/>
  <rect x="3" y="34" width="2" height="2" fill="#2E2536"/>
  <rect x="55" y="34" width="2" height="2" fill="#2E2536"/>
</svg>`;

export async function render(root, ctx) {
  const { player } = ctx;
  let custom = [];
  try {
    const res = await api.tracks.list();
    custom = res.tracks || [];
  } catch {
    custom = [];
  }

  const state = player.state();

  root.innerHTML = `
    ${viewHead({
      title: '一起听歌',
      actions: `<button class="btn" data-add-link>${icon('plus', { size: 12 })}添加链接</button>`,
    })}
    <div class="stack">
      <section class="card player ${state.playing ? 'is-playing' : ''}" data-player>
        <div class="player-top">
          <div class="cover">${CASSETTE}</div>
          <div class="player-info">
            <p class="player-title" data-title>${esc(state.track.title)}</p>
            <p class="player-sub" data-sub>${esc(state.track.mood)} · 循环着放</p>
            <div class="player-controls">
              <button class="btn btn-icon" data-prev aria-label="上一首">${icon('prev', { size: 12 })}</button>
              <button class="btn btn-primary" data-play>${icon(state.playing ? 'pause' : 'play', { size: 12 })}<span data-play-label>${state.playing ? '暂停' : '播放'}</span></button>
              <button class="btn btn-icon" data-next aria-label="下一首"><span style="display:inline-flex;transform:scaleX(-1)">${icon('prev', { size: 12 })}</span></button>
              <button class="btn ${state.loop ? '' : 'btn-quiet'}" data-loop aria-pressed="${state.loop}">${state.loop ? '循环开' : '循环关'}</button>
            </div>
          </div>
          <div class="player-side">
            <span class="card-note" data-loop-note>${state.loop ? '正在循环' : '只放一遍'}</span>
            <span class="player-count" data-count>${state.trackIndex + 1} / ${player.tracks.length}</span>
          </div>
        </div>
        <canvas class="viz" data-viz width="320" height="44" aria-hidden="true"></canvas>
        <label class="volume">
          <span class="vol-label">音量</span>
          <input class="range" type="range" min="0" max="100" value="${Math.round(state.volume * 100)}" data-volume aria-label="音量">
        </label>
      </section>

      <section class="card">
        <div class="card-head"><h2 class="card-title">曲目</h2><span class="card-note">点「去音乐网站」听原曲</span></div>
        <ul class="track-list" data-tracks>
          ${player.tracks
            .map(
              (t, i) => `<li class="track-row ${i === state.trackIndex ? 'is-current' : ''}" data-track="${i}">
                <div class="track-main">
                  <span class="track-name">${esc(t.title)}</span>
                  <span class="track-meta">${esc(t.en)} · ${esc(t.mood)} · ${t.bpm} BPM</span>
                </div>
                <div class="track-actions">
                  <button class="btn btn-sm btn-quiet" data-select="${i}">播放</button>
                  <a class="link-out" href="${esc(t.search)}" target="_blank" rel="noopener noreferrer">去音乐网站</a>
                </div>
              </li>`,
            )
            .join('')}
          ${custom
            .map(
              (t) => `<li class="track-row">
                <div class="track-main">
                  <span class="track-name">${esc(t.title)}</span>
                  <span class="track-meta">你收藏的链接</span>
                </div>
                <div class="track-actions">
                  <a class="link-out" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">打开</a>
                  <button class="btn btn-sm btn-quiet btn-danger" data-del-link="${t.id}" aria-label="删掉 ${esc(t.title)}">${icon('trash', { size: 12 })}</button>
                </div>
              </li>`,
            )
            .join('')}
        </ul>
      </section>
    </div>`;

  const playerCard = root.querySelector('[data-player]');
  const viz = root.querySelector('[data-viz]');
  const playBtn = root.querySelector('[data-play]');
  const titleEl = root.querySelector('[data-title]');
  const subEl = root.querySelector('[data-sub]');
  const loopBtn = root.querySelector('[data-loop]');

  function paint(s) {
    playerCard.classList.toggle('is-playing', s.playing);
    playBtn.innerHTML = `${icon(s.playing ? 'pause' : 'play', { size: 12 })}<span data-play-label>${s.playing ? '暂停' : '播放'}</span>`;
    titleEl.textContent = s.track.title;
    subEl.textContent = `${s.track.mood} · ${s.track.bpm} BPM`;
    loopBtn.textContent = s.loop ? '循环开' : '循环关';
    loopBtn.setAttribute('aria-pressed', String(s.loop));
    loopBtn.classList.toggle('btn-quiet', !s.loop);
    const loopNote = root.querySelector('[data-loop-note]');
    if (loopNote) loopNote.textContent = s.loop ? '正在循环' : '只放一遍';
    const count = root.querySelector('[data-count]');
    if (count) count.textContent = `${s.trackIndex + 1} / ${player.tracks.length}`;
    root.querySelectorAll('[data-track]').forEach((row) => {
      row.classList.toggle('is-current', Number(row.dataset.track) === s.trackIndex);
    });
  }

  const unsubscribe = player.subscribe(paint);

  playBtn.addEventListener('click', () => player.toggle());
  root.querySelector('[data-prev]').addEventListener('click', () => player.prev());
  root.querySelector('[data-next]').addEventListener('click', () => player.next());
  loopBtn.addEventListener('click', () => player.setLoop(!player.state().loop));
  root.querySelector('[data-volume]').addEventListener('input', (ev) => player.setVolume(Number(ev.target.value) / 100));
  root.querySelectorAll('[data-select]').forEach((btn) =>
    btn.addEventListener('click', () => {
      player.select(Number(btn.dataset.select));
      if (!player.state().playing) player.play();
    }),
  );

  root.querySelector('[data-add-link]').addEventListener('click', async () => {
    const ok = await openModal({
      title: '收藏一首歌的链接',
      submitText: '存起来',
      body: `
        <label class="field"><span class="field-label">歌名</span>
          <input class="input" name="title" maxlength="60" required placeholder="例如：风起地"></label>
        <label class="field"><span class="field-label">音乐网站链接</span>
          <input class="input" name="url" type="url" required placeholder="https://music.163.com/...">
          <span class="field-hint">只存链接，不下载、不转存。</span></label>`,
      onSubmit: async (form) => {
        const data = new FormData(form);
        await api.tracks.add({ title: data.get('title'), url: data.get('url') });
        toast('存好了');
        return true;
      },
    });
    if (ok) ctx.rerender();
  });

  root.querySelectorAll('[data-del-link]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const yes = await confirmBox('删掉这条链接？', '只是从收藏里移掉，不影响音乐网站上的歌。');
      if (!yes) return;
      try {
        await api.tracks.remove(btn.dataset.delLink);
        ctx.rerender();
      } catch (err) {
        toast(err.message, 'err');
      }
    }),
  );

  // 频谱：没有音频时就画一条呼吸的线
  let raf = 0;
  const vctx = viz.getContext('2d');
  function drawViz() {
    const w = viz.width;
    const h = viz.height;
    const analyser = player.analyser();
    vctx.clearRect(0, 0, w, h);
    const bars = 22;
    const bw = 8;
    const gap = Math.floor((w - bars * bw) / (bars + 1));
    let data = null;
    if (analyser && player.state().playing) {
      data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
    }
    const t = performance.now() / 420;
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c2506a';
    const dim = getComputedStyle(document.documentElement).getPropertyValue('--paper-3').trim() || '#ecdec4';
    for (let i = 0; i < bars; i += 1) {
      const base = data ? data[Math.floor((i / bars) * data.length)] / 255 : 0.12 + 0.1 * Math.abs(Math.sin(t + i * 0.6));
      const bh = Math.max(2, Math.round((base * (h - 6)) / 2) * 2);
      const x = gap + i * (bw + gap);
      vctx.fillStyle = dim;
      vctx.fillRect(x, h - 2, bw, -((h - 6) / 2));
      vctx.fillStyle = accent;
      vctx.fillRect(x, h - 2 - bh, bw, bh);
    }
    raf = requestAnimationFrame(drawViz);
  }
  drawViz();

  return () => {
    unsubscribe();
    cancelAnimationFrame(raf);
  };
}
