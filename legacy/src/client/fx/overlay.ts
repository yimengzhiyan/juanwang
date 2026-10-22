// 全屏提示类特效：横幅、轻提示、监管（警灯 + 栏杆落下 / 升起）、破产（像素碎裂）、胜利（WINNER + 王冠 + 彩带）。
import gsap from 'gsap';
import { Container, Rectangle, Sprite, Texture } from 'pixi.js';
import { JAIL_CELL } from '@dafuweng/shared';
import { charOf } from '../store';
import { C } from '../theme';
import { escapeHtml } from '../util';
import type { FxContext } from './context';
import { htmlFx, pc, popText, screenFlash, starBurst } from './kit';

export type BannerKind = 'primary' | 'danger' | 'gold' | 'accent';

/** 中央横幅：斜切光带从左扫入 + 扫光，停留，向右扫出 */
export async function banner(ctx: FxContext, text: string, kind: BannerKind | 'agi' = 'primary', holdMs = 500, sub = '', topPx?: number): Promise<void> {
  const { rt, board } = ctx;
  const w = htmlFx(ctx, 'fx2-banner-wrap');
  const c = board.worldToScreen(board.boardCenter());
  w.el.style.top = (topPx ?? c.y) + 'px';
  const cls = kind === 'agi' ? 'fx2-banner fx2-banner--gold fx2-banner--agi' : `fx2-banner fx2-banner--${kind}`;
  const fs = Math.round(Math.max(22, Math.min(34, board.size * 0.05)));
  w.el.innerHTML = `<div class="${cls}" style="--bfs:${fs}px"><b>${escapeHtml(text)}</b>${sub ? `<small>${escapeHtml(sub)}</small>` : ''}<i class="shine"></i></div>`;
  const b = w.el.firstElementChild as HTMLElement;
  const shine = w.el.querySelector('.shine') as HTMLElement;
  const tl = gsap.timeline();
  tl.fromTo(b, { x: -window.innerWidth * 0.7, opacity: 0, scaleY: 0.3, skewX: -24 }, { x: 0, opacity: 1, scaleY: 1, skewX: -12, duration: 0.2, ease: 'power3.out' });
  tl.fromTo(shine, { left: '-40%' }, { left: '120%', duration: 0.4, ease: 'power1.inOut' }, 0.12);
  tl.to({}, { duration: holdMs / 1000 });
  tl.to(b, { x: window.innerWidth * 0.5, opacity: 0, skewX: -24, duration: 0.16, ease: 'power2.in' });
  await rt.play(tl);
  w.done();
}

/** 轻通知（不阻塞队列）：在棋盘上方小条显示 */
export function notice(ctx: FxContext, text: string, color = 'var(--primary)'): void {
  const { overlay, board, rt } = ctx;
  const el = document.createElement('div');
  el.className = 'fx-notice';
  el.style.setProperty('--c', color);
  el.textContent = text;
  const r = board.screenRect();
  el.style.left = r.x + r.size / 2 + 'px';
  el.style.top = r.y + r.size * 0.3 + 'px';
  overlay.append(el);
  const tl = gsap.timeline({ onComplete: () => el.remove() });
  tl.fromTo(el, { y: 12, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2 });
  tl.to(el, { y: -16, opacity: 0, duration: 0.3 }, 1.3);
  rt.fire(tl);
}

/** 红蓝警灯闪 n 次（HTML，屏幕两侧 + 顶部灯条）；返回时间线（未播放） */
function policeLights(ctx: FxContext, n = 3, period = 0.3): { tl: gsap.core.Timeline; done: () => void } {
  const el = htmlFx(ctx, 'fx2-police', '<i class="l"></i><i class="r"></i><i class="t"></i>');
  const l = el.el.querySelector('.l')!, r = el.el.querySelector('.r')!, t = el.el.querySelector('.t')!;
  const tl = gsap.timeline();
  for (let i = 0; i < n; i++) {
    const a = i * period;
    tl.to(l, { opacity: 1, duration: 0.05 }, a).to(l, { opacity: 0, duration: 0.09 }, a + period / 2 - 0.05);
    tl.to(r, { opacity: 1, duration: 0.05 }, a + period / 2).to(r, { opacity: 0, duration: 0.09 }, a + period - 0.05);
    tl.to(t, { opacity: 1, duration: 0.03 }, a).to(t, { opacity: 0.2, duration: 0.05 }, a + 0.08);
  }
  return { tl, done: el.done };
}

/** 监管：警灯 + 棋子头顶警灯旋转 + 横幅 → 棋子被拖进关押区 → 铁栏杆从上方落下罩住（落地扬尘 + 震动） */
export async function playJail(ctx: FxContext, playerId: string): Promise<void> {
  const { rt, board, particles } = ctx;
  const u = board.u;
  const fx = board.layers.fx;
  const p = board.player(playerId);
  const police = policeLights(ctx, 3, 0.3);
  const bannerP = banner(ctx, '监管审查！', 'danger', 420, p ? `${p.name} 被请去喝茶` : '');
  const t = board.tokenView(playerId);
  const tl = police.tl;
  // 头顶红蓝信标
  if (t) {
    const red = particles.hold(fx, 'glow', 1.4 * u, 0xff2846, true);
    const blue = particles.hold(fx, 'glow', 1.4 * u, 0x3d5afe, true);
    const follow = () => {
      red.position.set(t.root.x - 0.25 * u, t.root.y - 0.2 * u);
      blue.position.set(t.root.x + 0.25 * u, t.root.y - 0.2 * u);
    };
    follow();
    red.alpha = blue.alpha = 0;
    const beacon = gsap.timeline({ onUpdate: follow, onComplete: () => { particles.release(red); particles.release(blue); } });
    for (let i = 0; i < 4; i++) {
      beacon.to(red, { alpha: 0.9, duration: 0.06 }, i * 0.24).to(red, { alpha: 0, duration: 0.1 }, i * 0.24 + 0.1);
      beacon.to(blue, { alpha: 0.9, duration: 0.06 }, i * 0.24 + 0.12).to(blue, { alpha: 0, duration: 0.1 }, i * 0.24 + 0.22);
    }
    tl.add(beacon, 0);
  }
  // 拖进关押区（聚光灯跟随）
  board.setTokenCell(playerId, JAIL_CELL, true);
  if (t) {
    gsap.killTweensOf(t.root.position);
    const rest = board.tokenRestPosition(playerId);
    t.root.zIndex = 2000;
    tl.to(t.root.position, { x: rest.x, y: rest.y, duration: 0.3, ease: 'power3.inOut' }, 0.35);
    tl.to(t.root.scale, { x: rest.scale, y: rest.scale, duration: 0.3 }, 0.35);
    // 栏杆落下
    const d = 0.95 * u * Math.max(0.8, rest.scale);
    const cage = particles.hold(fx, 'cage', d * 1.25);
    cage.zIndex = 3000;
    cage.position.set(rest.x, rest.y - 3 * u);
    cage.alpha = 0;
    tl.to(cage, { alpha: 1, duration: 0.08 }, 0.62);
    tl.to(cage, { y: rest.y, duration: 0.3, ease: 'bounce.out' }, 0.62);
    tl.call(() => {
      ctx.shake(120, 4);
      particles.burst(fx, rest.x, rest.y + d * 0.55, { count: 6, kind: 'dot', colors: [0xc9c3ff, 0xffffff], size: 0.3 * u, dist: 0.7 * u, duration: 0.4, angle: -Math.PI / 2, spread: 2.8, scaleTo: 1.4, alpha: 0.7, add: false });
    }, [], 0.76);
    tl.to(cage, { alpha: 0, duration: 0.2, onComplete: () => particles.release(cage) }, 1.05);
  }
  await Promise.all([rt.play(tl), bannerP]);
  police.done();
  board.placeToken(playerId, false);
}

/** 出狱：栏杆升起 + 绿色星芒（不阻塞） */
export function playJailExit(ctx: FxContext, playerId: string): void {
  const { rt, board, particles } = ctx;
  if (rt.skipping) return;
  const t = board.tokenView(playerId);
  if (!t) return;
  const u = board.u;
  const fx = board.layers.fx;
  const x = t.root.x, y = t.root.y;
  const cage = particles.hold(fx, 'cage', 0.95 * u * 1.25 * Math.max(0.8, t.root.scale.x));
  cage.zIndex = 3000;
  cage.position.set(x, y);
  const tl = gsap.timeline({ onComplete: () => particles.release(cage) });
  tl.to(cage, { y: y + 0.08 * u, duration: 0.08 });
  tl.to(cage, { y: y - 2.6 * u, alpha: 0, duration: 0.45, ease: 'power2.in' });
  tl.call(() => particles.burst(fx, x, y, { count: 12, kind: 'spark', colors: [C.success, 0xffffff, C.gold], size: 0.3 * u, dist: 1.1 * u, duration: 0.5 }), [], 0.1);
  rt.fire(tl);
}

/** 把一个显示对象渲染成纹理并切成 n×n 小块（像素碎裂用） */
function shatterPieces(ctx: FxContext, target: Container, n: number): { tex: Texture; pieces: { t: Texture; ox: number; oy: number; w: number; h: number }[] } | null {
  try {
    const b = target.getLocalBounds();
    if (b.width <= 0 || b.height <= 0) return null;
    const tex = ctx.app.renderer.generateTexture({ target, resolution: 1, frame: new Rectangle(b.x, b.y, b.width, b.height) });
    const pieces: { t: Texture; ox: number; oy: number; w: number; h: number }[] = [];
    const pw = tex.frame.width / n, ph = tex.frame.height / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const fr = new Rectangle(tex.frame.x + i * pw, tex.frame.y + j * ph, pw, ph);
        pieces.push({ t: new Texture({ source: tex.source, frame: fr }), ox: b.x + (i + 0.5) * (b.width / n), oy: b.y + (j + 0.5) * (b.height / n), w: b.width / n, h: b.height / n });
      }
    return { tex, pieces };
  } catch {
    return null;
  }
}

/** 破产：棋子变灰 → 碎裂成像素块飘散 → "破产" 红字砸下 → 出局横幅 */
export async function playBankrupt(ctx: FxContext, playerId: string): Promise<void> {
  const { board, rt, particles } = ctx;
  const t = board.tokenView(playerId);
  const p = board.player(playerId);
  const u = board.u;
  const fx = board.layers.fx;
  let bannerP: Promise<void> | null = null;
  if (t && t.root.visible && !rt.skipping) {
    const { x, y } = t.root.position;
    const sc = t.root.scale.x;
    // 变灰（头像 + 色环）
    const tl = gsap.timeline();
    const grey = { k: 0 };
    tl.to(grey, {
      k: 1,
      duration: 0.3,
      onUpdate: () => {
        const v = Math.round(255 - 120 * grey.k);
        const tint = (v << 16) | (v << 8) | v;
        t.avatar.tint = tint;
        t.ring.tint = tint;
      },
    });
    tl.to(t.body, { x: 2, duration: 0.04, yoyo: true, repeat: 5 }, 0.05);
    await rt.play(tl);
    // 像素碎裂（棋子 body 渲染为纹理后切块）
    const n = window.innerWidth < 760 ? 6 : 8;
    const sh = shatterPieces(ctx, t.body, n);
    const holder = new Container();
    holder.position.set(x, y);
    holder.scale.set(sc);
    holder.zIndex = 4000;
    fx.addChild(holder);
    const un = rt.onSkip(() => { if (!holder.destroyed) holder.destroy({ children: true }); sh?.tex.destroy(true); });
    t.body.visible = false;
    t.label.visible = false;
    t.shadow.visible = false;
    bannerP = banner(ctx, '已出局 · 404', 'danger', 400, p ? `${p.name} 的服务器宕机了` : '');
    const tl2 = gsap.timeline();
    if (sh) {
      sh.pieces.forEach((pc0, i) => {
        const s = new Sprite(pc0.t);
        s.anchor.set(0.5);
        s.position.set(pc0.ox, pc0.oy);
        s.width = pc0.w + 0.5;
        s.height = pc0.h + 0.5;
        holder.addChild(s);
        const dx = pc0.ox * 2.2 + (Math.random() - 0.5) * u * 1.2;
        const dy = -u * (0.6 + Math.random() * 1.4) + pc0.oy * 0.6;
        const at = (i % n) * 0.012 + Math.random() * 0.08;
        tl2.to(s, { x: pc0.ox + dx, y: pc0.oy + dy, rotation: (Math.random() - 0.5) * 4, duration: 0.7 + Math.random() * 0.25, ease: 'power2.out' }, at);
        tl2.to(s, { alpha: 0, duration: 0.3 }, at + 0.4 + Math.random() * 0.25);
      });
    }
    tl2.call(() => {
      particles.burst(fx, x, y, { count: 24, kind: 'chip', colors: [0x888899, C.danger, 0xffffff, board.playerColor(playerId)], dist: 1.4 * u, size: 0.16 * u, gravity: 0.6 * u, duration: 0.9, add: false });
      particles.burst(fx, x, y, { count: 6, kind: 'smoke', colors: [0x6e5f8f, 0x4a4060], size: 0.9 * u, dist: 0.6 * u, duration: 1.0, up: true, scaleTo: 1.8, add: false, alpha: 0.7 });
      ctx.shake(300, 6);
    }, [], 0);
    tl2.call(() => void popText(ctx, fx, x, y - 0.4 * u, '破产', C.danger, Math.max(26, 0.75 * u), 0.5, 0.4), [], 0.1);
    await rt.play(tl2);
    un();
    if (!holder.destroyed) holder.destroy({ children: true });
    sh?.tex.destroy(true);
    // 还原（setBankrupt 会隐藏整枚棋子）
    t.avatar.tint = 0xffffff;
    t.ring.tint = 0xffffff;
    t.body.visible = true;
    t.shadow.visible = true;
    t.body.x = 0;
  }
  board.setBankrupt(playerId);
  await (bannerP ?? banner(ctx, '已出局 · 404', 'danger', 400, p ? `${p.name} 的服务器宕机了` : ''));
}

/** 胜利：暗场 + 旋转光芒 → 胜者头像放大 + 彩虹光环 + 王冠砸下 → 霓虹 "WINNER" 逐字点亮 → 角色名 → 全屏彩带 + 星芒；3s 后交给结算页 */
export async function playGameOver(ctx: FxContext, winnerId: string, avatarUrl: string, winnerName: string): Promise<void> {
  const { rt, board } = ctx;
  const p = board.player(winnerId);
  const ch = charOf(p?.characterId);
  const av = Math.round(Math.min(window.innerWidth * 0.42, window.innerHeight * 0.3, 260));
  const w = htmlFx(ctx, 'fx2-win');
  w.el.style.setProperty('--av', av + 'px');
  w.el.innerHTML = `
    <div class="fx2-win-bg"></div>
    <div class="fx2-win-rays"></div>
    <div class="fx2-win-center">
      <div class="fx2-win-halo"></div>
      <img class="fx2-win-avatar" src="${avatarUrl}" alt="">
      <img class="fx2-win-crown" src="/assets/fx/crown.svg" alt="">
    </div>
    <div class="fx2-win-text">
      <div class="fx2-win-neon">${'WINNER'.split('').map((c) => `<span>${c}</span>`).join('')}</div>
      <div class="fx2-win-char">${escapeHtml(ch ? `${ch.title} · ${ch.name}` : '大玩家')}</div>
      <div class="fx2-win-name">${escapeHtml(winnerName)}</div>
    </div>`;
  const q = (s: string) => w.el.querySelector(s) as HTMLElement;
  // 彩带 / 彩纸（独立一层，结束后继续飘一会，不阻塞）
  const conf = htmlFx(ctx, 'fx2-full');
  const colors = ['#22E5FF', '#FF3DCB', '#FFC83D', '#FFFFFF', '#8B5CF6', '#2EE59D'];
  const W = window.innerWidth, H = window.innerHeight;
  const confTl = gsap.timeline({ onComplete: conf.done });
  const n = pc(110);
  for (let i = 0; i < n; i++) {
    const c = document.createElement('i');
    c.className = 'fx2-confetti' + (i % 3 === 0 ? ' rib' : '');
    c.style.background = colors[i % colors.length];
    conf.el.append(c);
    // 两侧礼炮喷出 → 飘落
    const left = i % 2 === 0;
    const x0 = left ? -10 : W + 10, y0 = H * 0.75;
    const xm = left ? W * (0.1 + Math.random() * 0.55) : W * (0.35 + Math.random() * 0.55);
    const ym = H * (0.02 + Math.random() * 0.35);
    const at = 0.45 + (i % 20) * 0.025 + Math.random() * 0.15;
    gsap.set(c, { x: x0, y: y0, rotation: Math.random() * 360, opacity: 1 });
    confTl.to(c, { x: xm, y: ym, duration: 0.5, ease: 'power2.out' }, at);
    confTl.to(c, { y: H + 40, x: xm + (Math.random() - 0.5) * 160, rotation: '+=' + (360 + Math.random() * 540), rotationX: 720 * Math.random(), duration: 2.2 + Math.random() * 1.2, ease: 'power1.in' }, at + 0.5);
  }
  rt.fire(confTl);

  const tl = gsap.timeline();
  tl.fromTo(q('.fx2-win-bg'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 0);
  tl.fromTo(q('.fx2-win-rays'), { opacity: 0, scale: 0.5 }, { opacity: 1, scale: 1, duration: 0.6 }, 0.1);
  tl.fromTo(q('.fx2-win-avatar'), { y: H * 0.5, scale: 0.25 }, { y: 0, scale: 1, duration: 0.55, ease: 'back.out(1.5)' }, 0.2);
  tl.fromTo(q('.fx2-win-halo'), { opacity: 0, scale: 0.3 }, { opacity: 0.9, scale: 1, duration: 0.5, ease: 'back.out(2)' }, 0.5);
  tl.fromTo(q('.fx2-win-crown'), { y: -H * 0.5, rotation: -25, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.35, ease: 'power3.in' }, 0.75);
  tl.to(q('.fx2-win-crown'), { scaleY: 0.82, scaleX: 1.12, duration: 0.07, yoyo: true, repeat: 1 }, 1.1);
  tl.call(() => {
    ctx.shake(200, 5);
    const r = q('.fx2-win-crown').getBoundingClientRect();
    starBurst(ctx, r.left + r.width / 2, r.top + r.height * 0.6, 14, av * 0.9);
  }, [], 1.1);
  q('.fx2-win-neon').querySelectorAll('span').forEach((s, i) => {
    tl.fromTo(s, { opacity: 0, scale: 2.4, y: -30 }, { opacity: 1, scale: 1, y: 0, duration: 0.18, ease: 'power3.in' }, 1.15 + i * 0.07);
    // 霓虹接触不良式闪一下
    tl.to(s, { opacity: 0.25, duration: 0.04, yoyo: true, repeat: 1 }, 1.7 + ((i * 37) % 5) * 0.05);
  });
  tl.call(() => screenFlash(ctx, '#FF3DCB', 0.25, 0.3), [], 1.55);
  tl.fromTo(q('.fx2-win-char'), { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.3, ease: 'back.out(2)' }, 1.65);
  tl.fromTo(q('.fx2-win-name'), { opacity: 0 }, { opacity: 1, duration: 0.3 }, 1.8);
  tl.to({}, { duration: 0.95 }, 2.05);
  await rt.play(tl);
  // 3.0s：快速淡出，交给结算页（彩纸继续飘）
  const fade = gsap.to(w.el, { opacity: 0, duration: 0.25, onComplete: w.done });
  await rt.play(fade);
  w.done();
}
