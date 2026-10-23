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
  /** 装备装上：金属扣合 */
  equip: () => {
    tone({ type: 'square', freq: 880, to: 660, dur: 0.05, vol: 0.12 });
    tone({ type: 'triangle', freq: 1320, dur: 0.12, vol: 0.22, delay: 0.05 });
  },
  /** 合成金色装备 */
  goldEquip: () => [784, 988, 1319].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.16, vol: 0.24, delay: i * 0.06 })),
  /** 护盾碎裂：玻璃碎 */
  shieldBreak: () => {
    noise(0.14, 0.3, 0, 3000);
    tone({ type: 'triangle', freq: 1800, to: 900, dur: 0.12, vol: 0.15 });
  },
  /** 护盾挡住 */
  block: () => tone({ type: 'sine', freq: 1200, to: 1000, dur: 0.06, vol: 0.12 }),
  /** 反弹：弹簧 */
  reflect: () => tone({ type: 'sawtooth', freq: 300, to: 900, dur: 0.14, vol: 0.12 }),
  /** 偷取：嗖 */
  steal: () => {
    tone({ type: 'sine', freq: 400, to: 1400, dur: 0.22, vol: 0.2 });
    noise(0.12, 0.12, 0.08, 2500);
  },
  /** 爆炸 */
  explode: () => {
    noise(0.3, 0.45, 0, 150);
    tone({ type: 'sine', freq: 120, to: 40, dur: 0.3, vol: 0.45 });
  },
  /** 复活：上行琶音 */
  revive: () => [523, 784, 1047, 1568].forEach((f, i) => tone({ type: 'sine', freq: f, dur: 0.18, vol: 0.2, delay: i * 0.05 })),
  /** 连杀 */
  chain: () => tone({ type: 'square', freq: 660, to: 1320, dur: 0.1, vol: 0.12 }),
  /** 技能慢放大字 */
  bigSkill: () => {
    tone({ type: 'sawtooth', freq: 220, to: 440, dur: 0.25, vol: 0.12 });
    tone({ type: 'triangle', freq: 880, dur: 0.2, vol: 0.18, delay: 0.12 });
  },
  /** 羁绊升档 */
  tierUp: () => [659, 880, 1175].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.14, vol: 0.22, delay: i * 0.06 })),
  /** 有人淘汰 */
  eliminated: () => {
    tone({ type: 'square', freq: 330, to: 165, dur: 0.35, vol: 0.14 });
    noise(0.2, 0.15, 0.1, 600);
  },
  /** 吃鸡 */
  champion: () => {
    [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone({ type: 'triangle', freq: f, dur: 0.24, vol: 0.26, delay: i * 0.1 }));
    noise(0.4, 0.12, 0.8, 4000);
  },
  /** 掉热度 */
  hpLoss: () => tone({ type: 'sine', freq: 500, to: 200, dur: 0.25, vol: 0.25 }),
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
