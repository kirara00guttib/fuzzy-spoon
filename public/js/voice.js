// 录音与语音播放：悄悄话里「说一段给你听」。
// 录音只在安全上下文（https 或 localhost）能用；纯 http 的 IP 访问会给一个「选文件」的退路。
import { icon } from './icons.js';
import { esc } from './ui.js';

const PREFERRED = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/ogg;codecs=opus',
];

/** 最长录多久（秒） */
export const MAX_SECONDS = 180;

export function voiceSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

export function formatClock(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 一小条播放器：播放键 + 走针 + 时长 */
export function voicePlayer(url, { label = '录音' } = {}) {
  if (!url) return '';
  return `<div class="voice-player" data-voice="${esc(url)}" role="group" aria-label="${esc(label)}">
      <button class="voice-btn" type="button" data-voice-play aria-label="播放这句话">${icon('play', { size: 12 })}</button>
      <span class="voice-time" data-voice-time>0:00</span>
      <span class="voice-bar" data-voice-bar><span class="voice-fill" data-voice-fill></span></span>
      <span class="voice-dur" data-voice-dur>--:--</span>
    </div>`;
}

let current = null;

/** 给 root 里所有播放器接上线（重复调用安全） */
export function bindVoicePlayers(root) {
  if (!root) return;
  root.querySelectorAll('[data-voice]').forEach((el) => {
    if (el.dataset.voiceReady) return;
    el.dataset.voiceReady = '1';

    const audio = new Audio(el.dataset.voice);
    audio.preload = 'metadata';
    const btn = el.querySelector('[data-voice-play]');
    const bar = el.querySelector('[data-voice-bar]');
    const fill = el.querySelector('[data-voice-fill]');
    const time = el.querySelector('[data-voice-time]');
    const dur = el.querySelector('[data-voice-dur]');

    audio.addEventListener('loadedmetadata', () => {
      dur.textContent = Number.isFinite(audio.duration) ? formatClock(audio.duration) : '--:--';
    });
    audio.addEventListener('timeupdate', () => {
      time.textContent = formatClock(audio.currentTime);
      if (fill) fill.style.width = `${audio.duration ? (audio.currentTime / audio.duration) * 100 : 0}%`;
    });
    audio.addEventListener('play', () => {
      if (current && current !== audio) current.pause();
      current = audio;
      btn.innerHTML = icon('pause', { size: 12 });
      btn.setAttribute('aria-label', '暂停');
      el.classList.add('is-playing');
    });
    audio.addEventListener('pause', () => {
      btn.innerHTML = icon('play', { size: 12 });
      btn.setAttribute('aria-label', '播放这句话');
      el.classList.remove('is-playing');
    });
    audio.addEventListener('ended', () => {
      if (fill) fill.style.width = '0%';
      time.textContent = '0:00';
    });
    audio.addEventListener('error', () => el.classList.add('is-broken'));

    btn.addEventListener('click', () => {
      if (audio.paused) audio.play().catch(() => el.classList.add('is-broken'));
      else audio.pause();
    });

    if (bar) {
      bar.addEventListener('click', (ev) => {
        if (!audio.duration) return;
        const box = bar.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (ev.clientX - box.left) / box.width));
        audio.currentTime = audio.duration * ratio;
      });
    }
  });
}

/** 读本地音频的时长（选文件那条路上用） */
export function probeDuration(url) {
  return new Promise((resolve) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    audio.addEventListener('loadedmetadata', () => resolve(Math.round(audio.duration || 0)));
    audio.addEventListener('error', () => resolve(0));
    audio.src = url;
  });
}

/** 浏览器录音机：start() 要麦克风权限，stop() 给出 blob */
export class VoiceRecorder {
  constructor() {
    this.recorder = null;
    this.stream = null;
    this.chunks = [];
    this.startedAt = 0;
  }

  async start() {
    if (!voiceSupported()) throw new Error('这个浏览器不能在网页里录音');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeType = PREFERRED.find((type) => {
      try {
        return window.MediaRecorder.isTypeSupported(type);
      } catch {
        return false;
      }
    });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, mimeType ? { mimeType } : undefined);
    this.recorder.addEventListener('dataavailable', (ev) => {
      if (ev.data && ev.data.size) this.chunks.push(ev.data);
    });
    this.recorder.start(200);
    this.startedAt = performance.now();
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.recorder || this.recorder.state === 'inactive') {
        this.cleanup();
        resolve(null);
        return;
      }
      this.recorder.addEventListener(
        'stop',
        () => {
          const type = (this.recorder && this.recorder.mimeType) || 'audio/webm';
          const blob = new Blob(this.chunks, { type });
          const seconds = Math.round((performance.now() - this.startedAt) / 1000);
          this.cleanup();
          resolve(blob.size ? { blob, mime: type.split(';')[0].trim(), seconds } : null);
        },
        { once: true },
      );
      this.recorder.stop();
    });
  }

  cancel() {
    try {
      if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    } catch {
      /* 已经停了就算了 */
    }
    this.cleanup();
  }

  cleanup() {
    if (this.stream) this.stream.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.recorder = null;
  }
}
