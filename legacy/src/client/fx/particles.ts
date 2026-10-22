// 粒子系统：对象池 + 单个 ticker 驱动（不为每颗粒子创建 gsap tween，避免每帧分配）。
// - 所有粒子精灵来自池（acquire / release），生命周期结束自动回收。
// - 受 rt.speed 影响（事件积压时加速），快进（skipAll）时立即清场。
// - 手机端（视口宽 < 760）粒子数量自动减半。
import { Container, Sprite, Text, TextStyle, type Application, type Texture } from 'pixi.js';
import gsap from 'gsap';
import type { FxRuntime } from './runtime';
import { FONT_NUM } from '../theme';
import { fxTex, type FxTex } from './textures';

export type ParticleKind = FxTex;

interface Live {
  s: Sprite;
  vx: number;
  vy: number;
  /** 重力加速度（px/s²） */
  g: number;
  /** 速度阻尼（每秒保留比例，1=无阻尼） */
  drag: number;
  life: number;
  age: number;
  vr: number;
  sc0: number;
  sc1: number;
  a0: number;
  a1: number;
  /** 前 fadeIn 比例渐显 */
  fadeIn: number;
  /** 硬币翻转：scale.x 按 |cos| 振荡 */
  flip: number;
}

export interface EmitOpts {
  kind?: ParticleKind;
  color?: number;
  size?: number;
  vx?: number;
  vy?: number;
  gravity?: number;
  drag?: number;
  life?: number;
  spin?: number;
  scaleTo?: number;
  alpha?: number;
  alphaTo?: number;
  fadeIn?: number;
  add?: boolean;
  rotation?: number;
  flip?: number;
}

export interface BurstOpts {
  count?: number;
  kind?: ParticleKind;
  colors?: number[];
  size?: number;
  /** 飞行距离（≈ 速度 × 寿命） */
  dist?: number;
  duration?: number;
  /** 下坠总位移（px），兼容旧接口 */
  gravity?: number;
  /** 向上喷射（扇形） */
  up?: boolean;
  /** 指定方向（弧度）+ 扇形宽度 */
  angle?: number;
  spread?: number;
  scaleTo?: number;
  add?: boolean;
  spin?: number;
  /** 不按手机减半 */
  exact?: boolean;
  /** 初始散布半径 */
  radius?: number;
  alpha?: number;
}

export const isMobile = (): boolean => window.innerWidth < 760;
/** 手机端粒子数减半 */
export const pc = (n: number): number => (isMobile() ? Math.max(1, Math.ceil(n * 0.5)) : n);

const styleCache = new Map<string, TextStyle>();
export function fxStyle(size: number, fill: number, strokeColor = 0x1a1240, strokeW = 4, weight: '700' | '800' = '800'): TextStyle {
  const key = `${size}|${fill}|${strokeColor}|${strokeW}|${weight}`;
  let s = styleCache.get(key);
  if (!s) {
    s = new TextStyle({
      fontFamily: FONT_NUM,
      fontSize: size,
      fontWeight: weight,
      fill,
      stroke: { color: strokeColor, width: strokeW, join: 'round' },
      align: 'center',
      dropShadow: { color: fill, blur: 8, distance: 0, alpha: 0.65, angle: 0 },
    });
    styleCache.set(key, s);
  }
  return s;
}

export class Particles {
  private pool: Sprite[] = [];
  private live: Live[] = [];
  /** 由效果函数手动管理的池化精灵（快进时一并回收） */
  private held = new Set<Sprite>();
  private pooled = new WeakSet<Sprite>();
  /** 调试冻结（?fxdemo 截图用） */
  paused = false;

  constructor(
    private app: Application,
    private rt: FxRuntime,
  ) {
    app.ticker.add(this.update, this);
    rt.onSkipAll(() => this.clear());
  }

  texture(kind: ParticleKind): Texture {
    return fxTex(kind);
  }

  /** 从池里取一个精灵（已重置：anchor 0.5、alpha 1、无旋转、normal 混合） */
  acquire(kind: ParticleKind, size: number, color = 0xffffff, add = false): Sprite {
    let s = this.pool.pop();
    while (s && s.destroyed) s = this.pool.pop();
    if (s) this.pooled.delete(s);
    if (!s) {
      s = new Sprite(fxTex(kind));
      s.anchor.set(0.5);
    } else s.texture = fxTex(kind);
    s.visible = true;
    s.alpha = 1;
    s.rotation = 0;
    s.zIndex = 0;
    s.scale.set(1);
    const tex = s.texture;
    const k = size / Math.max(tex.width, tex.height);
    s.scale.set(k);
    s.tint = kind === 'coin' || kind === 'rainbow' || kind === 'cage' ? 0xffffff : color;
    s.blendMode = add ? 'add' : 'normal';
    return s;
  }

  release(s: Sprite): void {
    this.held.delete(s);
    if (s.destroyed || this.pooled.has(s)) return;
    gsap.killTweensOf(s);
    gsap.killTweensOf(s.scale);
    s.removeFromParent();
    if (this.pool.length < 600) {
      this.pool.push(s);
      this.pooled.add(s);
    } else s.destroy();
  }

  /** 取一个由调用者用 gsap 驱动的池化精灵，放入 layer；用完调用 release()（快进时自动回收） */
  hold(layer: Container, kind: ParticleKind, size: number, color = 0xffffff, add = false): Sprite {
    const s = this.acquire(kind, size, color, add);
    layer.addChild(s);
    this.held.add(s);
    return s;
  }

  /** 兼容旧接口：新精灵（未加入舞台，调用者负责 destroy） */
  sprite(kind: ParticleKind, size: number, color = 0xffffff): Sprite {
    const s = new Sprite(fxTex(kind));
    s.anchor.set(0.5);
    s.width = s.height = size;
    if (kind !== 'coin') s.tint = color;
    return s;
  }

  /** 发射单颗粒子（速度单位 px/s） */
  emit(layer: Container, x: number, y: number, o: EmitOpts = {}): void {
    if (this.rt.skipping || layer.destroyed) return;
    const s = this.acquire(o.kind ?? 'spark', o.size ?? 10, o.color ?? 0xffffff, o.add ?? false);
    s.position.set(x, y);
    s.rotation = o.rotation ?? Math.random() * Math.PI * 2;
    const sc = s.scale.x;
    s.alpha = o.alpha ?? 1;
    layer.addChild(s);
    this.live.push({
      s,
      vx: o.vx ?? 0,
      vy: o.vy ?? 0,
      g: o.gravity ?? 0,
      drag: o.drag ?? 1,
      life: Math.max(0.05, o.life ?? 0.6),
      age: 0,
      vr: o.spin ?? 0,
      sc0: sc,
      sc1: sc * (o.scaleTo ?? 1),
      a0: o.alpha ?? 1,
      a1: o.alphaTo ?? 0,
      fadeIn: o.fadeIn ?? 0,
      flip: o.flip ?? 0,
    });
  }

  /** 从 (x,y) 爆开 */
  burst(layer: Container, x: number, y: number, opt: BurstOpts = {}): void {
    if (this.rt.skipping) return;
    const { kind = 'spark', colors = [0xffffff], size = 10, dist = 40, duration = 0.6, gravity = 0, up = false, scaleTo = 0.4, add = kind === 'spark' || kind === 'glow', spin = 6, radius = 0 } = opt;
    const count = opt.exact ? (opt.count ?? 10) : pc(opt.count ?? 10);
    for (let i = 0; i < count; i++) {
      let a: number;
      if (opt.angle !== undefined) a = opt.angle + (Math.random() - 0.5) * (opt.spread ?? 1);
      else if (up) a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      else a = Math.random() * Math.PI * 2;
      const d = dist * (0.45 + Math.random() * 0.75);
      const life = duration * (0.75 + Math.random() * 0.5);
      // 指数阻尼下位移 ≈ v / k，取阻尼 k=3 → v = d*3 / (1 - e^{-3·life}) 近似
      const k = 3;
      const v = (d * k) / (1 - Math.exp(-k * life));
      const r0 = radius * Math.random();
      this.emit(layer, x + Math.cos(a) * r0, y + Math.sin(a) * r0, {
        kind,
        color: colors[i % colors.length],
        size: size * (0.6 + Math.random() * 0.7),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        drag: Math.exp(-k),
        gravity: gravity > 0 ? (2 * gravity) / (life * life) : 0,
        life,
        spin: (Math.random() - 0.5) * spin,
        scaleTo,
        add,
        alpha: opt.alpha ?? 1,
      });
    }
  }

  private update(): void {
    if (this.live.length === 0 || this.paused) return;
    const dt = Math.min(0.05, this.app.ticker.deltaMS / 1000) * this.rt.speed;
    let w = 0;
    for (let i = 0; i < this.live.length; i++) {
      const p = this.live[i];
      p.age += dt;
      const s = p.s;
      if (s.destroyed || !s.parent || p.age >= p.life) {
        this.release(s);
        continue;
      }
      const t = p.age / p.life;
      if (p.drag !== 1) {
        const f = Math.pow(p.drag, dt);
        p.vx *= f;
        p.vy *= f;
      }
      p.vy += p.g * dt;
      s.x += p.vx * dt;
      s.y += p.vy * dt;
      s.rotation += p.vr * dt;
      const sc = p.sc0 + (p.sc1 - p.sc0) * t;
      s.scale.set(p.flip ? sc * Math.abs(Math.cos(p.age * p.flip)) + sc * 0.08 : sc, sc);
      const fade = p.fadeIn > 0 && t < p.fadeIn ? t / p.fadeIn : 1;
      // 后 40% 才开始淡出，保持亮度
      const at = t < 0.6 ? 0 : (t - 0.6) / 0.4;
      s.alpha = (p.a0 + (p.a1 - p.a0) * at) * fade;
      this.live[w++] = p;
    }
    this.live.length = w;
  }

  /** 清场：所有粒子与 hold 精灵回收 */
  clear(): void {
    for (const p of this.live) this.release(p.s);
    this.live.length = 0;
    for (const s of [...this.held]) this.release(s);
  }

  get liveCount(): number {
    return this.live.length;
  }

  /** 浮字（Pixi 版，棋盘坐标）：弹出放大 → 上升 → 淡出 */
  floatText(layer: Container, x: number, y: number, text: string, color: number, size = 18, rise = 36, duration = 0.9): Text | null {
    if (this.rt.skipping) return null;
    const t = new Text({ text, style: fxStyle(Math.round(size), color) });
    t.anchor.set(0.5);
    t.position.set(x, y);
    t.zIndex = 5000;
    layer.addChild(t);
    t.scale.set(0.3);
    const tl = gsap.timeline({ onComplete: () => t.destroy() });
    tl.to(t.scale, { x: 1.15, y: 1.15, duration: 0.14, ease: 'back.out(3)' }, 0);
    tl.to(t.scale, { x: 1, y: 1, duration: 0.12 }, 0.14);
    tl.to(t, { y: y - rise, duration, ease: 'power2.out' }, 0);
    tl.to(t, { alpha: 0, duration: duration * 0.35 }, duration * 0.65);
    this.rt.fire(tl);
    return t;
  }
}
