// 特效纹理：全部用 2D canvas 代码生成（渐变比 Graphics 叠圆柔和得多），首次使用时生成并缓存。
// 纹理一律为白色 / 灰度，使用时用 tint 上色；发光类配合 blendMode = 'add'。
import { Texture } from 'pixi.js';

export type FxTex =
  | 'spark' // 四角星 + 光晕
  | 'dot' // 软圆点
  | 'chip' // 像素小方块
  | 'coin' // Token 金币（自带颜色，不要 tint）
  | 'ring' // 细圆环
  | 'glow' // 大径向光晕
  | 'smoke' // 烟团
  | 'beam' // 竖直光柱（底部最亮）
  | 'hex' // 六边形护盾（蜂窝纹）
  | 'rainbow' // 彩虹光环（自带颜色）
  | 'flare' // 横向镜头光条
  | 'cage' // 监管栏杆（自带颜色）
  | 'crack'; // 地面裂纹

const cache = new Map<FxTex, Texture>();

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function radial(g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

function hexPath(g: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
}

const makers: Record<FxTex, () => HTMLCanvasElement> = {
  spark() {
    const [c, g] = canvas(64, 64);
    radial(g, 32, 32, 30, [[0, 'rgba(255,255,255,0.55)'], [0.35, 'rgba(255,255,255,0.15)'], [1, 'rgba(255,255,255,0)']]);
    g.fillStyle = '#fff';
    g.beginPath();
    const R = 31, k = 4.5;
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 - Math.PI / 2;
      const r = i % 2 === 0 ? R : k;
      const x = 32 + Math.cos(a) * r, y = 32 + Math.sin(a) * r;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.closePath();
    g.fill();
    return c;
  },
  dot() {
    const [c, g] = canvas(32, 32);
    radial(g, 16, 16, 16, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,0.75)'], [1, 'rgba(255,255,255,0)']]);
    return c;
  },
  chip() {
    const [c, g] = canvas(12, 12);
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 12, 12);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.fillRect(0, 9, 12, 3);
    g.fillRect(9, 0, 3, 12);
    return c;
  },
  coin() {
    const [c, g] = canvas(48, 48);
    radial(g, 24, 24, 24, [[0.7, 'rgba(255,210,80,0.5)'], [1, 'rgba(255,200,61,0)']]);
    g.fillStyle = '#B86E00';
    g.beginPath();
    g.arc(24, 25, 17, 0, Math.PI * 2);
    g.fill();
    const gr = g.createLinearGradient(10, 8, 38, 40);
    gr.addColorStop(0, '#FFF4C2');
    gr.addColorStop(0.45, '#FFC83D');
    gr.addColorStop(1, '#E08A00');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(24, 23, 16, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(24, 23, 12, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#9A5A00';
    g.font = '800 17px Fredoka, Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('T', 24, 24);
    return c;
  },
  ring() {
    const [c, g] = canvas(128, 128);
    for (let i = 0; i < 6; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.12 + (i === 5 ? 0.88 : i * 0.06)})`;
      g.lineWidth = 12 - i * 2;
      g.beginPath();
      g.arc(64, 64, 56, 0, Math.PI * 2);
      g.stroke();
    }
    return c;
  },
  glow() {
    const [c, g] = canvas(128, 128);
    radial(g, 64, 64, 64, [[0, 'rgba(255,255,255,1)'], [0.18, 'rgba(255,255,255,0.75)'], [0.45, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
    return c;
  },
  smoke() {
    const [c, g] = canvas(96, 96);
    const blobs = [
      [48, 50, 34],
      [34, 44, 24],
      [62, 40, 26],
      [44, 62, 24],
      [60, 60, 22],
    ];
    for (const [x, y, r] of blobs) radial(g, x, y, r, [[0, 'rgba(255,255,255,0.55)'], [0.6, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]);
    return c;
  },
  beam() {
    const [c, g] = canvas(64, 256);
    const h = g.createLinearGradient(0, 0, 64, 0);
    h.addColorStop(0, 'rgba(255,255,255,0)');
    h.addColorStop(0.3, 'rgba(255,255,255,0.35)');
    h.addColorStop(0.5, 'rgba(255,255,255,1)');
    h.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    h.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = h;
    g.fillRect(0, 0, 64, 256);
    // 顶部渐隐
    g.globalCompositeOperation = 'destination-in';
    const v = g.createLinearGradient(0, 0, 0, 256);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.45, 'rgba(0,0,0,0.75)');
    v.addColorStop(1, 'rgba(0,0,0,1)');
    g.fillStyle = v;
    g.fillRect(0, 0, 64, 256);
    return c;
  },
  hex() {
    const [c, g] = canvas(160, 160);
    hexPath(g, 80, 80, 74);
    const f = g.createRadialGradient(80, 80, 10, 80, 80, 76);
    f.addColorStop(0, 'rgba(255,255,255,0.05)');
    f.addColorStop(0.75, 'rgba(255,255,255,0.18)');
    f.addColorStop(1, 'rgba(255,255,255,0.45)');
    g.fillStyle = f;
    g.fill();
    g.save();
    hexPath(g, 80, 80, 74);
    g.clip();
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.lineWidth = 1.5;
    const r = 13;
    for (let row = -6; row <= 6; row++) {
      for (let col = -6; col <= 6; col++) {
        const x = 80 + col * r * 1.732 + (row % 2 ? r * 0.866 : 0);
        const y = 80 + row * r * 1.5;
        hexPath(g, x, y, r - 1);
        g.stroke();
      }
    }
    g.restore();
    hexPath(g, 80, 80, 74);
    g.strokeStyle = 'rgba(255,255,255,1)';
    g.lineWidth = 5;
    g.stroke();
    return c;
  },
  rainbow() {
    const [c, g] = canvas(256, 256);
    const ctx = g as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient };
    let grad: CanvasGradient | string = '#FFC83D';
    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(0, 128, 128);
      ['#FF3DCB', '#FF5470', '#FFA94D', '#FFE27A', '#3DDC97', '#22E5FF', '#5B6CFF', '#B36BFF', '#FF3DCB'].forEach((col, i, a) => cg.addColorStop(i / (a.length - 1), col));
      grad = cg;
    }
    g.lineCap = 'round';
    g.strokeStyle = grad;
    g.globalAlpha = 0.35;
    g.lineWidth = 26;
    g.beginPath();
    g.arc(128, 128, 104, 0, Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    g.lineWidth = 10;
    g.beginPath();
    g.arc(128, 128, 104, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(128, 128, 104, 0, Math.PI * 2);
    g.stroke();
    return c;
  },
  flare() {
    const [c, g] = canvas(256, 32);
    const h = g.createLinearGradient(0, 0, 256, 0);
    h.addColorStop(0, 'rgba(255,255,255,0)');
    h.addColorStop(0.5, 'rgba(255,255,255,1)');
    h.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = h;
    g.globalCompositeOperation = 'source-over';
    g.fillRect(0, 13, 256, 6);
    g.globalCompositeOperation = 'destination-in';
    const v = g.createLinearGradient(0, 0, 0, 32);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.5, 'rgba(0,0,0,1)');
    v.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = v;
    g.fillRect(0, 0, 256, 32);
    return c;
  },
  cage() {
    const [c, g] = canvas(96, 112);
    // 顶 / 底横梁 + 6 根竖栏（金属渐变）
    const metal = g.createLinearGradient(0, 0, 96, 0);
    metal.addColorStop(0, '#6C6A8E');
    metal.addColorStop(0.5, '#E8E6FF');
    metal.addColorStop(1, '#6C6A8E');
    for (let i = 0; i < 6; i++) {
      const x = 8 + i * 16;
      const bar = g.createLinearGradient(x - 3, 0, x + 3, 0);
      bar.addColorStop(0, '#5A5878');
      bar.addColorStop(0.45, '#F4F2FF');
      bar.addColorStop(1, '#5A5878');
      g.fillStyle = bar;
      g.fillRect(x - 3, 8, 6, 98);
    }
    g.fillStyle = metal;
    g.beginPath();
    g.roundRect(0, 0, 96, 12, 5);
    g.fill();
    g.beginPath();
    g.roundRect(0, 100, 96, 12, 5);
    g.fill();
    g.fillStyle = '#FF4D6D';
    g.beginPath();
    g.arc(48, 6, 4, 0, Math.PI * 2);
    g.fill();
    return c;
  },
  crack() {
    const [c, g] = canvas(128, 128);
    g.strokeStyle = '#fff';
    g.lineCap = 'round';
    const rnd = mulberry(7);
    for (let i = 0; i < 7; i++) {
      let x = 64, y = 64;
      let a = (i / 7) * Math.PI * 2 + rnd() * 0.5;
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        a += (rnd() - 0.5) * 0.9;
        const d = 8 + rnd() * 6;
        x += Math.cos(a) * d;
        y += Math.sin(a) * d;
        g.lineTo(x, y);
        g.lineWidth = Math.max(1, 4 - k * 0.7);
      }
      g.stroke();
    }
    return c;
  },
};

function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function fxTex(kind: FxTex): Texture {
  let t = cache.get(kind);
  if (!t) {
    t = Texture.from(makers[kind]());
    cache.set(kind, t);
  }
  return t;
}
