// 粒子层：一张 canvas + 对象池 + 单个 rAF 循环。明亮配色、深棕描边、无发光（无 shadowBlur / lighter）。
// 全局活跃上限 120（低端机减半），超出时丢弃最老的；prefers-reduced-motion 时不发射。
import { reducedMotion, timeScale } from './anims';

export const FX_COLORS = ['#FFC53D', '#2F80ED', '#58C65C', '#F25757', '#9B6BFF', '#FF7EB6', '#FFFFFF'];
const OUTLINE = '#3B2A1A';

export type PKind = 'dot' | 'square' | 'star' | 'confetti';

interface P {
  kind: PKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  drag: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  life: number;
  age: number;
  /** 彩纸翻转相位 */
  flip: number;
}

const LIMIT = (navigator.hardwareConcurrency ?? 8) <= 4 ? 60 : 120;

class Particles {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private live: P[] = [];
  private pool: P[] = [];
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private host!: HTMLElement;

  mount(host: HTMLElement): void {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'fx-canvas';
    host.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(host);
    this.resize();
  }

  private resize(): void {
    const r = this.host.getBoundingClientRect();
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
  }

  /** 把页面坐标（clientX/Y）转成画布坐标 */
  local(x: number, y: number): [number, number] {
    const r = this.host.getBoundingClientRect();
    return [x - r.left, y - r.top];
  }

  get count(): number {
    return this.live.length;
  }

  spawn(o: Partial<P> & { x: number; y: number }): void {
    if (reducedMotion()) return;
    if (this.live.length >= LIMIT) {
      const old = this.live.shift()!;
      this.pool.push(old);
    }
    const p = this.pool.pop() ?? ({} as P);
    p.kind = o.kind ?? 'dot';
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.g = o.g ?? 0;
    p.drag = o.drag ?? 1;
    p.size = o.size ?? 6;
    p.color = o.color ?? '#FFFFFF';
    p.rot = o.rot ?? Math.random() * Math.PI * 2;
    p.vr = o.vr ?? 0;
    p.life = o.life ?? 0.6;
    p.age = 0;
    p.flip = Math.random() * Math.PI * 2;
    this.live.push(p);
    if (!this.raf) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  /** 放射爆发（页面坐标） */
  burst(clientX: number, clientY: number, o: { count: number; kind?: PKind; colors?: string[]; size?: number; dist?: number; life?: number; g?: number; up?: boolean; spin?: number }): void {
    const [x, y] = this.local(clientX, clientY);
    const life = o.life ?? 0.5;
    const dist = o.dist ?? 60;
    for (let i = 0; i < o.count; i++) {
      const a = o.up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.6 : (i / o.count) * Math.PI * 2 + Math.random() * 0.5;
      const sp = (dist / life) * (0.6 + Math.random() * 0.6);
      const colors = o.colors ?? FX_COLORS;
      this.spawn({
        kind: o.kind ?? 'dot',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        drag: 0.05,
        g: o.g ?? 0,
        size: (o.size ?? 6) * (0.75 + Math.random() * 0.5),
        color: colors[i % colors.length],
        vr: (Math.random() - 0.5) * (o.spin ?? 6),
        life: life * (0.8 + Math.random() * 0.4),
      });
    }
  }

  /** 彩纸：从 (x,y) 以角度 angle 扇形喷出，抛物线下落 */
  confetti(clientX: number, clientY: number, count: number, angle = -Math.PI / 2, spread = 0.8, speed = 700): void {
    const [x, y] = this.local(clientX, clientY);
    for (let i = 0; i < count; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const sp = speed * (0.6 + Math.random() * 0.5);
      this.spawn({
        kind: 'confetti',
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        g: 900,
        drag: 0.4,
        size: 9 + Math.random() * 5,
        color: FX_COLORS[Math.floor(Math.random() * 6)],
        vr: (Math.random() - 0.5) * 10,
        life: 1.6 + Math.random() * 0.6,
      });
    }
  }

  /** 顶部落下的彩纸雨（画布坐标） */
  rain(count: number): void {
    for (let i = 0; i < count; i++) {
      this.spawn({
        kind: 'confetti',
        x: Math.random() * this.w,
        y: -10,
        vx: (Math.random() - 0.5) * 60,
        vy: 120 + Math.random() * 120,
        g: 60,
        drag: 0.9,
        size: 9 + Math.random() * 5,
        color: FX_COLORS[Math.floor(Math.random() * 6)],
        vr: (Math.random() - 0.5) * 6,
        life: 3.2,
      });
    }
  }

  clear(): void {
    this.pool.push(...this.live);
    this.live = [];
    this.ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private tick = (now: number): void => {
    const dt = Math.min(0.05, (now - this.last) / 1000) * timeScale();
    this.last = now;
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    const keep: P[] = [];
    for (const p of this.live) {
      p.age += dt;
      if (p.age >= p.life || p.y > this.h + 40) {
        this.pool.push(p);
        continue;
      }
      const k = Math.pow(p.drag, dt);
      p.vx *= k;
      p.vy = p.vy * k + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      keep.push(p);
      this.draw(c, p);
    }
    this.live = keep;
    if (keep.length) this.raf = requestAnimationFrame(this.tick);
    else {
      this.raf = 0;
      c.clearRect(0, 0, this.w, this.h);
    }
  };

  private draw(c: CanvasRenderingContext2D, p: P): void {
    const t = p.age / p.life;
    const alpha = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
    const s = p.kind === 'star' ? p.size * (1 - t * 0.4) : p.size;
    c.save();
    c.globalAlpha = alpha;
    c.translate(p.x, p.y);
    c.rotate(p.rot);
    c.fillStyle = p.color;
    c.strokeStyle = OUTLINE;
    c.lineWidth = 2;
    c.lineJoin = 'round';
    const outline = s > 6;
    c.beginPath();
    switch (p.kind) {
      case 'dot':
        c.arc(0, 0, s / 2, 0, Math.PI * 2);
        break;
      case 'square':
        c.roundRect(-s / 2, -s / 2, s, s, s * 0.25);
        break;
      case 'star': {
        const r = s / 2;
        const q = r * 0.32;
        c.moveTo(0, -r);
        c.quadraticCurveTo(q, -q, r, 0);
        c.quadraticCurveTo(q, q, 0, r);
        c.quadraticCurveTo(-q, q, -r, 0);
        c.quadraticCurveTo(-q, -q, 0, -r);
        break;
      }
      case 'confetti': {
        const fx = Math.cos(p.flip + p.age * 9);
        c.scale(1, Math.max(0.15, Math.abs(fx)));
        c.rect(-s / 2, -s / 4, s, s / 2);
        break;
      }
    }
    c.fill();
    if (outline) c.stroke();
    c.restore();
  }
}

export const particles = new Particles();
