// 一起听歌：七首在浏览器里现场合成的小曲（不转存任何版权音乐），
// 想听原曲就点「去音乐网站」，直接跳到网易云的搜索页。

const NOTE_INDEX = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function freq(note) {
  if (!note) return 0;
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(note);
  if (!m) return 0;
  const semis = NOTE_INDEX[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  const midi = (Number(m[3]) + 1) * 12 + semis;
  return 440 * 2 ** ((midi - 69) / 12);
}

const SEARCH = (q) => `https://music.163.com/#/search/m/?s=${encodeURIComponent(q)}&type=1`;

export const TRACKS = [
  {
    id: 'walk',
    title: '午后散步',
    en: 'Afternoon Walk',
    mood: '轻松',
    bpm: 92,
    search: SEARCH('午后散步 轻音乐'),
    melody: [
      null, 'C5', null, 'E5', null, 'G5', null, 'E5', null, 'A5', null, 'G5', null, 'E5', null, 'D5',
      null, 'C5', null, 'E5', null, 'G5', null, 'B5', null, 'C6', null, 'G5', null, 'E5', null, 'D5',
    ],
    bass: ['C3', null, null, null, null, null, null, null, 'A2', null, null, null, null, null, null, null,
      'F2', null, null, null, null, null, null, null, 'G2', null, null, null, null, null, null, null],
    pad: ['C4', 'A3', 'F3', 'G3'],
    wave: 'triangle',
    padWave: 'sine',
  },
  {
    id: 'cat',
    title: '猫咪进行曲',
    en: 'Kitty March',
    mood: '俏皮',
    bpm: 124,
    search: SEARCH('猫咪 进行曲 可爱 纯音乐'),
    melody: [
      'F5', null, 'A5', null, 'C6', null, 'A5', null, 'F5', null, 'G5', null, 'A5', null, null, null,
      'D5', null, 'F5', null, 'A5', null, 'F5', null, 'C5', null, 'E5', null, 'G5', null, null, null,
    ],
    bass: ['F2', null, null, 'F2', null, null, 'C3', null, 'D3', null, null, 'D3', null, null, 'C3', null,
      'F2', null, null, 'F2', null, null, 'C3', null, 'D3', null, null, 'D3', null, null, 'C3', null],
    pad: ['F3', 'C4', 'D4', 'C4'],
    wave: 'square',
    padWave: 'triangle',
    drums: true,
  },
  {
    id: 'night',
    title: '金色小夜曲',
    en: 'Golden Nocturne',
    mood: '安静',
    bpm: 72,
    search: SEARCH('小夜曲 温柔 钢琴 纯音乐'),
    melody: [
      null, null, 'A4', null, null, 'C5', null, null, null, 'E5', null, null, 'G5', null, null, null,
      null, null, 'E5', null, null, 'C5', null, null, null, 'A4', null, null, null, null, null, null,
    ],
    bass: ['A2', null, null, null, null, null, null, null, 'F2', null, null, null, null, null, null, null,
      'D3', null, null, null, null, null, null, null, 'E2', null, null, null, null, null, null, null],
    pad: ['A3', 'F3', 'D4', 'E3'],
    wave: 'sine',
    padWave: 'triangle',
  },
  {
    id: 'rain',
    title: '雨天的窗边',
    en: 'Rainy Window',
    mood: '安静',
    bpm: 76,
    search: SEARCH('雨声 安静 钢琴 纯音乐'),
    melody: [
      null, 'F#5', null, 'A5', null, 'D6', null, 'A5', null, 'F#5', null, 'E5', null, 'D5', null, null,
      null, 'B4', null, 'D5', null, 'F#5', null, 'A5', null, 'G5', null, 'F#5', null, 'E5', null, null,
    ],
    bass: [
      'D3', null, null, null, null, null, null, null, 'B2', null, null, null, null, null, null, null,
      'G2', null, null, null, null, null, null, null, 'A2', null, null, null, null, null, null, null,
    ],
    pad: ['D4', 'B3', 'G3', 'A3'],
    wave: 'sine',
    padWave: 'triangle',
  },
  {
    id: 'dusk',
    title: '散步到黄昏',
    en: 'Walk into Dusk',
    mood: '温暖',
    bpm: 88,
    search: SEARCH('黄昏 散步 温暖 纯音乐'),
    melody: [
      null, 'A5', null, 'C6', null, 'A5', null, 'F5', null, 'G5', null, 'A5', null, 'C6', null, null,
      null, 'D6', null, 'C6', null, 'A5', null, 'G5', null, 'F5', null, 'G5', null, 'A5', null, null,
    ],
    bass: [
      'F2', null, 'F2', null, 'C3', null, 'C3', null, 'D3', null, 'D3', null, 'C3', null, 'C3', null,
      'Bb2', null, 'Bb2', null, 'F2', null, 'F2', null, 'C3', null, 'C3', null, 'Bb2', null, 'C3', null,
    ],
    pad: ['F3', 'D4', 'Bb3', 'C4'],
    wave: 'triangle',
    padWave: 'sine',
  },
  {
    id: 'first',
    title: '第一次见面',
    en: 'The First Day',
    mood: '心动',
    bpm: 66,
    search: SEARCH('第一次见面 心动 钢琴 纯音乐'),
    melody: [
      'E5', null, null, 'G5', null, null, 'C6', null, null, 'B5', null, 'A5', null, 'G5', null, null,
      'A5', null, null, 'F5', null, null, 'A5', null, null, 'G5', null, 'F5', null, 'E5', null, null,
    ],
    bass: [
      'C3', null, null, null, null, null, null, null, 'A2', null, null, null, null, null, null, null,
      'F2', null, null, null, null, null, null, null, 'G2', null, null, null, null, null, null, null,
    ],
    pad: ['C4', 'A3', 'F3', 'G3'],
    wave: 'sine',
    padWave: 'sine',
  },
  {
    id: 'paws',
    title: '猫爪踩琴键',
    en: 'Paws on Keys',
    mood: '活泼',
    bpm: 132,
    search: SEARCH('活泼 可爱 跳跃 纯音乐'),
    melody: [
      'C6', null, 'E6', null, 'G6', null, 'A6', null, 'G6', null, 'E6', null, 'D6', null, 'C6', null,
      'F6', null, 'A6', null, 'C7', null, 'A6', null, 'G6', null, 'E6', null, 'C6', null, null, null,
    ],
    bass: [
      'C3', null, 'C3', null, 'G2', null, 'G2', null, 'A2', null, 'A2', null, 'F2', null, 'F2', null,
      'F2', null, 'F2', null, 'C3', null, 'C3', null, 'G2', null, 'G2', null, 'C3', null, 'C3', null,
    ],
    pad: ['C4', 'G3', 'A3', 'F3'],
    wave: 'square',
    padWave: 'triangle',
    drums: true,
  },
];

export function createPlayer({ onState } = {}) {
  let ctx = null;
  let master = null;
  let analyser = null;
  let timer = 0;
  let step = 0;
  let nextNoteTime = 0;
  let trackIndex = 0;
  let playing = false;
  let loop = true;
  let volume = 0.5;
  const listeners = new Set();
  const noiseBuffer = {};

  const state = () => ({
    playing,
    loop,
    volume,
    trackIndex,
    track: TRACKS[trackIndex],
    unlocked: Boolean(ctx),
  });

  function emit() {
    const s = state();
    listeners.forEach((fn) => fn(s));
    if (onState) onState(s);
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume * 0.6;
    analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    analyser.smoothingTimeConstant = 0.75;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 4200;
    master.connect(lpf);
    lpf.connect(analyser);
    analyser.connect(ctx.destination);
    return ctx;
  }

  function makeNoise() {
    if (noiseBuffer.buf) return noiseBuffer.buf;
    const len = Math.floor(ctx.sampleRate * 0.2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    noiseBuffer.buf = buf;
    return buf;
  }

  function tone(f, time, dur, wave, gain, detune = 0) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = wave;
    osc.frequency.value = f;
    if (detune) osc.detune.value = detune;
    env.gain.setValueAtTime(0.0001, time);
    env.gain.exponentialRampToValueAtTime(gain, time + 0.02);
    env.gain.exponentialRampToValueAtTime(gain * 0.6, time + dur * 0.5);
    env.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(env);
    env.connect(master);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  function shaker(time) {
    const src = ctx.createBufferSource();
    src.buffer = makeNoise();
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.05, time);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 6000;
    src.connect(hp);
    hp.connect(env);
    env.connect(master);
    src.start(time);
  }

  function scheduleStep(s, time) {
    const track = TRACKS[trackIndex];
    const stepDur = 60 / track.bpm / 4;
    const note = track.melody[s];
    if (note) {
      const f = freq(note);
      tone(f, time, stepDur * 3.4, track.wave, 0.16);
      tone(f * 2, time, stepDur * 1.2, 'sine', 0.03);
    }
    const bass = track.bass[s];
    if (bass) tone(freq(bass), time, stepDur * 7, 'triangle', 0.14);
    if (s % 8 === 0) {
      const chord = track.pad[(s / 8) % track.pad.length];
      if (chord) {
        const root = freq(chord);
        tone(root, time, stepDur * 8, track.padWave, 0.07);
        tone(root * 1.5, time, stepDur * 8, track.padWave, 0.045);
        tone(root * 2, time, stepDur * 8, track.padWave, 0.035);
      }
    }
    if (track.drums && s % 4 === 2) shaker(time);
  }

  function scheduler() {
    if (!ctx) return;
    const stepDur = 60 / TRACKS[trackIndex].bpm / 4;
    while (nextNoteTime < ctx.currentTime + 0.12) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += stepDur;
      step += 1;
      if (step >= 32) {
        step = 0;
        if (!loop) {
          stop();
          return;
        }
      }
    }
  }

  function unlock() {
    const c = ensureContext();
    if (!c) return false;
    if (c.state === 'suspended') c.resume();
    return true;
  }

  function play() {
    if (!unlock()) return;
    if (playing) return;
    playing = true;
    step = 0;
    nextNoteTime = ctx.currentTime + 0.08;
    clearInterval(timer);
    timer = setInterval(scheduler, 25);
    scheduler();
    emit();
  }

  function stop() {
    playing = false;
    clearInterval(timer);
    timer = 0;
    emit();
  }

  function pause() {
    stop();
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  function select(index) {
    const wasPlaying = playing;
    stop();
    trackIndex = ((index % TRACKS.length) + TRACKS.length) % TRACKS.length;
    step = 0;
    emit();
    if (wasPlaying) play();
  }

  function next() {
    select(trackIndex + 1);
  }

  function prev() {
    select(trackIndex - 1);
  }

  function setLoop(value) {
    loop = Boolean(value);
    emit();
  }

  function setVolume(v) {
    volume = Math.max(0, Math.min(1, Number(v)));
    if (master) master.gain.value = volume * 0.6;
    emit();
  }

  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return { unlock, play, pause, toggle, next, prev, select, setLoop, setVolume, subscribe, state, analyser: () => analyser, tracks: TRACKS };
}
