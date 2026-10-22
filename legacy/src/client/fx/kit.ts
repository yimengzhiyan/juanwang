// 特效工具：HTML 覆盖元素（自动注册快进清理）、屏幕/棋盘坐标、星芒雨、HUD 头像弹跳、HTML 金币飞行、Pixi 大字。
import gsap from 'gsap';
import { Container, Text } from 'pixi.js';
import type { FxContext } from './context';
import { fxStyle, isMobile, pc } from './particles';

export { isMobile, pc };

export interface HtmlFx {
  el: HTMLElement;
  /** 移除元素并注销快进清理（可重复调用） */
  done: () => void;
}

/** 在覆盖层创建一个元素；快进时自动移除 */
export function htmlFx(ctx: FxContext, cls: string, html = '', parent: HTMLElement = ctx.overlay): HtmlFx {
  const el = document.createElement('div');
  el.className = cls;
  if (html) el.innerHTML = html;
  parent.append(el);
  const un = ctx.rt.onSkip(() => el.remove());
  let finished = false;
  return {
    el,
    done: () => {
      if (finished) return;
      finished = true;
      un();
      el.remove();
    },
  };
}

export const toScreen = (ctx: FxContext, p: { x: number; y: number }) => ctx.board.worldToScreen(p);
export const toLocal = (ctx: FxContext, p: { x: number; y: number }) => ctx.board.screenToWorld(p);

/** 棋盘本地坐标里，屏幕可见区域的矩形（用于全屏暗场 / 星雨） */
export function screenRectLocal(ctx: FxContext): { x: number; y: number; w: number; h: number } {
  const a = toLocal(ctx, { x: 0, y: 0 });
  const b = toLocal(ctx, { x: window.innerWidth, y: window.innerHeight });
  return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
}

/** 全屏金色星芒雨（HTML，盖过 HUD），不阻塞 */
export function starRain(ctx: FxContext, count = 40, dur = 1.4, gold = true): void {
  if (ctx.rt.skipping) return;
  const n = pc(count);
  const box = htmlFx(ctx, 'fx2-full');
  const W = window.innerWidth, H = window.innerHeight;
  const tl = gsap.timeline({ onComplete: box.done });
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.className = 'fx2-star' + (gold || i % 4 ? '' : ' w');
    box.el.append(s);
    const x = Math.random() * W;
    const sc = 0.5 + Math.random() * 1.1;
    const d = dur * (0.55 + Math.random() * 0.45);
    const at = Math.random() * (dur - d);
    gsap.set(s, { x, y: -30 - Math.random() * H * 0.3, scale: sc, rotation: Math.random() * 90, opacity: 0 });
    tl.to(s, { opacity: 1, duration: 0.12 }, at);
    tl.to(s, { y: H * (0.55 + Math.random() * 0.5), x: x + (Math.random() - 0.5) * 120, rotation: '+=' + (Math.random() > 0.5 ? 180 : -180), duration: d, ease: 'power1.in' }, at);
    tl.to(s, { opacity: 0, scale: sc * 0.3, duration: d * 0.35 }, at + d * 0.65);
  }
  ctx.rt.fire(tl);
}

/** 从屏幕点向四周爆开 HTML 星芒（盖过 HUD），不阻塞 */
export function starBurst(ctx: FxContext, x: number, y: number, count = 14, dist = 120, gold = true): void {
  if (ctx.rt.skipping) return;
  const n = pc(count);
  const box = htmlFx(ctx, 'fx2-full');
  const tl = gsap.timeline({ onComplete: box.done });
  for (let i = 0; i < n; i++) {
    const s = document.createElement('i');
    s.className = 'fx2-star' + (gold ? '' : ' w');
    box.el.append(s);
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const d = dist * (0.55 + Math.random() * 0.6);
    const sc = 0.6 + Math.random() * 0.9;
    gsap.set(s, { x, y, scale: 0.2, opacity: 1 });
    tl.to(s, { x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, scale: sc, rotation: 120, duration: 0.55, ease: 'power3.out' }, 0);
    tl.to(s, { opacity: 0, scale: 0.2, duration: 0.3 }, 0.4 + Math.random() * 0.15);
  }
  ctx.rt.fire(tl);
}

/** HUD 玩家条头像：光环扩散 + 头像弹一下 + 小字 */
export function hudPing(ctx: FxContext, playerId: string, color: string, text?: string): void {
  if (ctx.rt.skipping) return;
  const p = ctx.board.hudPoint(playerId);
  const ring = htmlFx(ctx, 'fx2-hudring');
  ring.el.style.setProperty('--c', color);
  const tl = gsap.timeline({ onComplete: ring.done });
  tl.fromTo(ring.el, { x: p.x, y: p.y, scale: 0.5, opacity: 1 }, { scale: 1.7, opacity: 0, duration: 0.5, ease: 'power2.out' }, 0);
  if (text) {
    const t = htmlFx(ctx, 'fx2-hudtext');
    t.el.style.setProperty('--c', color);
    t.el.textContent = text;
    tl.fromTo(t.el, { x: p.x, y: p.y + 6, scale: 0.4, opacity: 0 }, { y: p.y - 26, scale: 1, opacity: 1, duration: 0.25, ease: 'back.out(2.5)' }, 0);
    tl.to(t.el, { y: p.y - 40, opacity: 0, duration: 0.3, onComplete: t.done }, 0.65);
  }
  // 头像本体弹一下（玩家条 <img>；只做临时 transform，结束后清除）
  const hit = document.elementFromPoint(p.x, p.y);
  if (hit instanceof HTMLImageElement && !ctx.overlay.contains(hit)) {
    const img = hit;
    const un = ctx.rt.onSkip(() => gsap.set(img, { clearProps: 'transform' }));
    tl.fromTo(img, { scale: 1 }, { scale: 1.3, duration: 0.12, ease: 'power2.out' }, 0);
    tl.to(img, { scale: 1, duration: 0.35, ease: 'elastic.out(1.2, 0.4)', onComplete: () => { un(); gsap.set(img, { clearProps: 'transform' }); } }, 0.12);
  }
  ctx.rt.fire(tl);
}

/** HTML 金币从屏幕点 A 沿弧线飞到 B（盖过 HUD）；返回时间线 */
export function htmlCoins(ctx: FxContext, a: { x: number; y: number }, b: { x: number; y: number }, count: number, dur = 0.5, stagger = 0.03): gsap.core.Timeline {
  const n = pc(count);
  const box = htmlFx(ctx, 'fx2-full');
  const tl = gsap.timeline({ onComplete: box.done });
  const lift = Math.min(220, Math.hypot(b.x - a.x, b.y - a.y) * 0.4 + 40);
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i');
    c.className = 'fx2-coin';
    c.textContent = 'T';
    box.el.append(c);
    c.style.transform = `translate(${a.x}px, ${a.y}px) scale(0)`;
    const p = { k: 0 };
    const jx = (Math.random() - 0.5) * 30, jy = (Math.random() - 0.5) * 20;
    const at = i * stagger;
    tl.to(p, {
      k: 1,
      duration: dur,
      ease: 'power1.in',
      onUpdate: () => {
        const k = p.k;
        const x = a.x + (b.x - a.x) * k + jx * Math.sin(Math.PI * k);
        const y = a.y + (b.y - a.y) * k - Math.sin(Math.PI * k) * lift + jy * Math.sin(Math.PI * k);
        c.style.transform = `translate(${x}px, ${y}px) scale(${Math.min(1, k * 6) * (1 - 0.35 * k)}) rotateY(${k * 720}deg)`;
      },
      onComplete: () => c.remove(),
    }, at);
  }
  return tl;
}

/** 全屏闪白（HTML） */
export function screenFlash(ctx: FxContext, color = '#fff', peak = 0.6, dur = 0.25): void {
  if (ctx.rt.skipping) return;
  const f = htmlFx(ctx, 'fx2-flash');
  f.el.style.background = color;
  ctx.rt.fire(gsap.fromTo(f.el, { opacity: peak }, { opacity: 0, duration: dur, ease: 'power2.out', onComplete: f.done }));
}

/** Pixi 大字（棋盘坐标），弹出 → 停留 → 上浮淡出；返回 Text（已加入 layer） */
export function popText(ctx: FxContext, layer: Container, x: number, y: number, text: string, color: number, size: number, hold = 0.5, rise = 0.6): Text | null {
  if (ctx.rt.skipping) return null;
  const t = new Text({ text, style: fxStyle(Math.round(size), color, 0x1a1240, Math.max(3, Math.round(size * 0.14))) });
  t.anchor.set(0.5);
  // 不要飘出棋盘边缘
  const half = t.width / 2 + 4;
  x = Math.max(half, Math.min(ctx.board.size - half, x));
  y = Math.max(t.height, y);
  t.position.set(x, y);
  t.zIndex = 6000;
  layer.addChild(t);
  t.scale.set(0.2);
  const tl = gsap.timeline({ onComplete: () => t.destroy() });
  tl.to(t.scale, { x: 1.25, y: 1.25, duration: 0.14, ease: 'back.out(3)' }, 0);
  tl.to(t.scale, { x: 1, y: 1, duration: 0.14, ease: 'power2.out' }, 0.14);
  tl.to(t, { y: y - size * rise, duration: hold + 0.3, ease: 'power1.out' }, 0.1);
  tl.to(t, { alpha: 0, duration: 0.25 }, 0.28 + hold);
  ctx.rt.fire(tl);
  return t;
}

/** 等待 n 秒的空 tween（用于给时间线补尾） */
export const pad = (tl: gsap.core.Timeline, sec: number) => tl.to({}, { duration: sec });
