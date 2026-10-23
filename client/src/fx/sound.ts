// WebAudio 合成音效（无素材文件）：音量克制，可静音（状态存 localStorage）。
import { saveSettings, settings } from '../store';

let ac: AudioContext | null = null;
let master: GainNode | null = null;

function ctx(): AudioContext | null {
  if (settings.muted) return null;
  try {
    if (!ac) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = 0.22;
      master.connect(ac.destination);
    }
    if (ac.state === 'suspended') void ac.resume();
    return ac;
  } catch {
    return null;
  }
}

interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  to?: number;
  dur: number;
  vol?: number;
  delay?: number;
  attack?: number;
}
function tone(o: ToneOpts): void {
  const a = ctx();
  if (!a || !master) return;
  const t0 = a.currentTime + (o.delay ?? 0);
  const osc = a.createOscillator();
  const g = a.createGain();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t0 + o.dur);
  const v = o.vol ?? 0.5;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(v, t0 + (o.attack ?? 0.01));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

function noise(dur: number, vol = 0.3, delay = 0, hp = 800): void {
  const a = ctx();
  if (!a || !master) return;
  const t0 = a.currentTime + delay;
  const len = Math.floor(a.sampleRate * dur);
  const buf = a.createBuffer(1, len, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = hp;
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start(t0);
}

let lastHit = 0;
export const sfx = {
  click: () => tone({ type: 'triangle', freq: 660, to: 880, dur: 0.06, vol: 0.25 }),
  buy: () => {
    tone({ type: 'triangle', freq: 520, to: 780, dur: 0.09, vol: 0.35 });
    tone({ type: 'sine', freq: 1040, dur: 0.12, vol: 0.2, delay: 0.07 });
  },
  sell: () => {
    tone({ type: 'square', freq: 1200, dur: 0.05, vol: 0.12 });
    tone({ type: 'square', freq: 1600, dur: 0.08, vol: 0.12, delay: 0.06 });
  },
  reroll: () => tone({ type: 'triangle', freq: 300, to: 600, dur: 0.12, vol: 0.25 }),
  freeze: () => tone({ type: 'sine', freq: 1500, to: 1100, dur: 0.15, vol: 0.18 }),
  merge: () => {
    [523, 659, 784, 1047].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.18, vol: 0.3, delay: i * 0.07 }));
  },
  hit: () => {
    const now = performance.now();
    if (now - lastHit < 60) return;
    lastHit = now;
    noise(0.08, 0.35, 0, 1200);
    tone({ type: 'sine', freq: 180, to: 80, dur: 0.1, vol: 0.4 });
  },
  ability: () => tone({ type: 'sine', freq: 880, to: 1320, dur: 0.12, vol: 0.18 }),
  faint: () => {
    tone({ type: 'triangle', freq: 400, to: 120, dur: 0.3, vol: 0.3 });
  },
  win: () => {
    [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.22, vol: 0.28, delay: i * 0.09 }));
  },
  lose: () => {
    [392, 330, 262].forEach((f, i) => tone({ type: 'sine', freq: f, dur: 0.3, vol: 0.3, delay: i * 0.14 }));
  },
  headline: () => {
    noise(0.12, 0.2, 0, 2000);
    tone({ type: 'square', freq: 220, dur: 0.08, vol: 0.12, delay: 0.1 });
  },
  vs: () => {
    noise(0.15, 0.3, 0, 400);
    tone({ type: 'sawtooth', freq: 110, to: 60, dur: 0.2, vol: 0.2 });
  },
};

export function setMuted(m: boolean): void {
  settings.muted = m;
  saveSettings();
  if (m && ac) void ac.suspend();
}
