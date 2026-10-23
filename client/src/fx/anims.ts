// GSAP 动效工具：浮字、抖动、短震、全屏效果互斥、可跳过的等待。
import gsap from 'gsap';

const mq = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
export const reducedMotion = (): boolean => !!mq?.matches;
export const timeScale = (): number => gsap.globalTimeline.timeScale();
export function setTimeScale(v: number): void {
  gsap.globalTimeline.timeScale(v);
}

let shell: HTMLElement;
let fxLayer: HTMLElement;
let flashEl: HTMLElement;
export function mountAnims(shellEl: HTMLElement): void {
  shell = shellEl;
  fxLayer = document.createElement('div');
  fxLayer.className = 'fx-layer';
  shellEl.appendChild(fxLayer);
  flashEl = document.createElement('div');
  flashEl.className = 'edge-flash';
  shellEl.appendChild(flashEl);
}
export const getShell = (): HTMLElement => shell;
export const getFxLayer = (): HTMLElement => fxLayer;

/** 页面坐标 → shell 内坐标 */
export function toShell(x: number, y: number): [number, number] {
  const r = shell.getBoundingClientRect();
  return [x - r.left, y - r.top];
}
export function center(el: Element): [number, number] {
  const r = el.getBoundingClientRect();
  return [r.left + r.width / 2, r.top + r.height / 2];
}

// ───────────── 可跳过的等待 ─────────────
const pending = new Set<{ call: gsap.core.Tween; resolve: () => void }>();
/** 受 timeScale 影响的等待；skipWaits() 时立即结束 */
export function wait(sec: number): Promise<void> {
  return new Promise((resolve) => {
    const entry = { call: null as unknown as gsap.core.Tween, resolve };
    entry.call = gsap.delayedCall(sec, () => {
      pending.delete(entry);
      resolve();
    });
    pending.add(entry);
  });
}
export function skipWaits(): void {
  for (const e of [...pending]) {
    e.call.kill();
    pending.delete(e);
    e.resolve();
  }
}

// ───────────── 浮字 ─────────────
/** 在页面坐标 (x,y) 冒一个浮字：彩色字 + 深棕描边，上浮渐隐 */
export function floatText(x: number, y: number, text: string, color: string, size = 26, rise = 30): void {
  const [lx, ly] = toShell(x, y);
  const el = document.createElement('div');
  el.className = 'float-text';
  el.textContent = text;
  el.style.color = color;
  el.style.fontSize = `${size}px`;
  el.style.left = `${lx}px`;
  el.style.top = `${ly}px`;
  fxLayer.appendChild(el);
  const tl = gsap.timeline({ onComplete: () => el.remove() });
  tl.fromTo(el, { scale: 0, xPercent: -50, yPercent: -50 }, { scale: 1.3, duration: 0.12, ease: 'back.out(3)' })
    .to(el, { scale: 1, duration: 0.08 })
    .to(el, { y: -rise, duration: 0.5, ease: 'power1.out' }, 0.1)
    .to(el, { opacity: 0, duration: 0.25 }, 0.4);
}

/** 受击抖动 */
export function shake(el: Element, amp = 6, times = 2): gsap.core.Timeline {
  const tl = gsap.timeline();
  if (reducedMotion()) return tl;
  for (let i = 0; i < times; i++) tl.to(el, { x: amp, duration: 0.04 }).to(el, { x: -amp, duration: 0.04 });
  tl.to(el, { x: 0, duration: 0.04 });
  return tl;
}

/** 弹跳一下 */
export function pop(el: Element, s = 1.15): gsap.core.Timeline {
  return gsap.timeline().to(el, { scale: s, duration: 0.1, ease: 'power2.out' }).to(el, { scale: 1, duration: 0.25, ease: 'elastic.out(1,0.5)' });
}

// ───────────── 全屏效果（同一时刻最多一个） ─────────────
let fullFx: gsap.core.Animation | null = null;
export function fullscreen(make: () => gsap.core.Animation | null): void {
  if (fullFx && fullFx.isActive()) fullFx.progress(1);
  fullFx = make();
}

/** 整个 shell 短震 ±4px ×3 */
export function screenShake(): void {
  if (reducedMotion()) return;
  fullscreen(() => gsap.timeline().to(shell, { x: 4, duration: 0.025 }).to(shell, { x: -4, duration: 0.05, repeat: 2, yoyo: true }).to(shell, { x: 0, duration: 0.025 }));
}

/** 失败：实心 inset 红框闪一次 */
export function edgeFlash(): void {
  fullscreen(() => gsap.timeline().set(flashEl, { opacity: 0 }).to(flashEl, { opacity: 1, duration: 0.1 }).to(flashEl, { opacity: 0, duration: 0.3 }));
}

/** 元素克隆飞行（页面矩形 from → to），返回 Promise */
export function flyGhost(src: HTMLElement, from: DOMRect, to: DOMRect, opts: { lift?: number; duration?: number; scaleTo?: number; fade?: boolean } = {}): Promise<void> {
  const ghost = src.cloneNode(true) as HTMLElement;
  ghost.classList.add('fly-ghost');
  const [fx, fy] = toShell(from.left, from.top);
  const [tx, ty] = toShell(to.left + (to.width - from.width) / 2, to.top + (to.height - from.height) / 2);
  Object.assign(ghost.style, { left: `${fx}px`, top: `${fy}px`, width: `${from.width}px`, height: `${from.height}px` });
  fxLayer.appendChild(ghost);
  const d = reducedMotion() ? 0.15 : (opts.duration ?? 0.25);
  const lift = opts.lift ?? 40;
  return new Promise((resolve) => {
    const tl = gsap.timeline({
      onComplete: () => {
        ghost.remove();
        resolve();
      },
    });
    tl.to(ghost, { x: tx - fx, duration: d, ease: 'power2.inOut' }, 0)
      .to(ghost, { y: Math.min(0, ty - fy) - lift, duration: d / 2, ease: 'power2.out' }, 0)
      .to(ghost, { y: ty - fy, duration: d / 2, ease: 'power2.in' }, d / 2)
      .to(ghost, { scale: opts.scaleTo ?? 0.9, duration: d }, 0);
    if (opts.fade) tl.to(ghost, { opacity: 0, duration: d * 0.4 }, d * 0.6);
  });
}

/** 标签胶囊（如 "Lv2!"）在元素上方弹出后上浮消失 */
export function tagPop(el: Element, text: string, cls = 'tag-pop'): void {
  const [x, y] = center(el);
  const r = el.getBoundingClientRect();
  const [lx, ly] = toShell(x, y - r.height / 2);
  const t = document.createElement('div');
  t.className = cls;
  t.textContent = text;
  t.style.left = `${lx}px`;
  t.style.top = `${ly}px`;
  fxLayer.appendChild(t);
  gsap
    .timeline({ onComplete: () => t.remove() })
    .fromTo(t, { scale: 0, xPercent: -50, yPercent: -50 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' })
    .to(t, { y: -28, opacity: 0, duration: 0.35, ease: 'power1.in' }, '+=0.4');
}
