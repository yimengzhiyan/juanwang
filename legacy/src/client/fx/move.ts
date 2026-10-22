// 移动类特效：逐格跳跃（路径光点预告 + 挤压拉伸 + 尘土）、路过融资轮（金币喷泉 + "+200T"）、
// 光柱传送、撞路障（急刹 + 路障碎裂 + "拦截！"）。
import gsap from 'gsap';
import { Rectangle, Sprite, Texture } from 'pixi.js';
import { hasTex, tex } from '../assets';
import { cellOf, groupColorOf } from '../store';
import { C, hex } from '../theme';
import type { FxContext } from './context';
import { htmlCoins, hudPing, popText, toScreen } from './kit';

const STEP = 0.18;

/** 本回合移动中已经播过“路过融资轮”演出的玩家（随后的 passStart 只补 HUD 金币） */
const passShown = new Set<string>();
export function resetMoveCtx(): void {
  passShown.clear();
}

/** 逐格跳跃：每格 0.18s，起跳拉长 1.15 → 抛物线 → 落地压扁 0.85 回弹；落地尘土 + 格子描边亮；最后一格冲击环 */
export async function playMove(ctx: FxContext, playerId: string, path: number[], backward = false): Promise<void> {
  const { board, rt, particles } = ctx;
  const t = board.tokenView(playerId);
  if (!t || path.length === 0) return;
  const u = board.u;
  const fx = board.layers.fx;
  const pcol = board.playerColor(playerId);
  t.root.zIndex = 2000;
  gsap.killTweensOf(t.root.position);
  gsap.killTweensOf(t.body.scale);
  // 路径预告：沿途依次亮起小光点，棋子到达时熄灭
  if (!rt.skipping) {
    path.forEach((cellId, i) => {
      const p = board.cellTokenCenter(cellId);
      particles.emit(fx, p.x, p.y, { kind: 'glow', color: pcol, size: 0.9 * u, life: 0.12 + i * STEP + 0.12, alpha: 0.75, alphaTo: 0.2, scaleTo: 0.7, fadeIn: 0.05, add: true, rotation: 0 });
      particles.emit(fx, p.x, p.y, { kind: 'spark', color: 0xffffff, size: 0.34 * u, life: 0.12 + i * STEP + 0.12, alpha: 1, alphaTo: 0.3, fadeIn: 0.05, add: true, rotation: 0 });
    });
  }
  const tl = gsap.timeline();
  let from = { x: t.root.x, y: t.root.y };
  const hop = 0.35 * u;
  path.forEach((cellId, i) => {
    const to = board.cellTokenCenter(cellId);
    const start = { ...from };
    const proxy = { k: 0 };
    const at = i * STEP;
    tl.to(t.body.scale, { x: 1.12, y: 0.86, duration: 0.03 }, at);
    tl.to(t.body.scale, { x: 0.9, y: 1.15, duration: 0.05 }, at + 0.03);
    tl.to(t.body.scale, { x: 1, y: 1, duration: 0.06 }, at + 0.08);
    tl.to(
      proxy,
      {
        k: 1,
        duration: STEP - 0.02,
        ease: 'none',
        onUpdate: () => {
          const k = proxy.k;
          t.root.position.set(start.x + (to.x - start.x) * k, start.y + (to.y - start.y) * k - Math.sin(Math.PI * k) * hop);
        },
      },
      at,
    );
    tl.to(t.body.scale, { x: 1.15, y: 0.85, duration: 0.03 }, at + STEP - 0.03);
    tl.to(t.body.scale, { x: 1, y: 1, duration: 0.07, ease: 'back.out(3)' }, at + STEP);
    tl.call(
      () => {
        const gc = groupColorOf(cellOf(cellId));
        particles.burst(fx, to.x, to.y + 0.3 * u, { count: 4, kind: 'dot', colors: [hex(gc, 0xa9a3d9), 0xffffff], size: 0.18 * u, dist: 0.45 * u, duration: 0.35, angle: -Math.PI / 2, spread: 3, scaleTo: 1.3, alpha: 0.8, add: false });
        flashBorder(ctx, cellId, gc ? hex(gc) : 0xffffff, 0.2);
        if (cellId === 0 && !backward && i < path.length) {
          passShown.add(playerId);
          passStartBurst(ctx, playerId);
        }
      },
      [],
      at + STEP - 0.02,
    );
    from = to;
  });
  const last = path[path.length - 1];
  const endAt = path.length * STEP;
  tl.to(t.body.scale, { x: 1.1, y: 1.1, duration: 0.05 }, endAt + 0.02);
  tl.to(t.body.scale, { x: 1, y: 1, duration: 0.08 }, endAt + 0.07);
  tl.call(() => {
    ctx.shake(60, 2);
    if (rt.skipping) return;
    const p = board.cellTokenCenter(last);
    const ring = particles.hold(fx, 'ring', 0.9 * u, pcol, true);
    ring.position.set(p.x, p.y + 0.3 * u);
    ring.scale.y *= 0.4;
    const sx = ring.scale.x, sy = ring.scale.y;
    rt.fire(gsap.timeline({ onComplete: () => particles.release(ring) })
      .to(ring.scale, { x: sx * 2.2, y: sy * 2.2, duration: 0.35, ease: 'power2.out' }, 0)
      .to(ring, { alpha: 0, duration: 0.35, ease: 'power1.in' }, 0));
  }, [], endAt - 0.02);
  await rt.play(tl);
  t.body.scale.set(1);
  board.setTokenCell(playerId, last);
  board.placeToken(playerId, true);
}

/** 光柱传送：光柱罩下 → 棋子拉成光条被吸走 → 目标格光柱砸下 → 棋子从光里还原 + 冲击环 */
export async function playTeleport(ctx: FxContext, playerId: string, to: number, jailed?: boolean): Promise<void> {
  const { board, rt, particles } = ctx;
  const t = board.tokenView(playerId);
  if (!t) return;
  const u = board.u;
  const fx = board.layers.fx;
  const H = 4.2 * u;
  const mkBeam = (x: number, y: number) => {
    const b = particles.hold(fx, 'beam', H, C.primary, true);
    b.anchor.set(0.5, 1);
    b.width = 0.9 * u;
    b.height = H;
    b.position.set(x, y + 0.45 * u);
    b.zIndex = 3000;
    return b;
  };
  const core = (x: number, y: number) => {
    const b = particles.hold(fx, 'beam', H, 0xffffff, true);
    b.anchor.set(0.5, 1);
    b.width = 0.3 * u;
    b.height = H;
    b.position.set(x, y + 0.45 * u);
    b.zIndex = 3001;
    return b;
  };
  const x0 = t.root.x, y0 = t.root.y;
  const bA = mkBeam(x0, y0), cA = core(x0, y0);
  const tl = gsap.timeline({ onComplete: () => { particles.release(bA); particles.release(cA); } });
  const sxA = bA.scale.x, syA = bA.scale.y, cxA = cA.scale.x, cyA = cA.scale.y;
  tl.fromTo(bA.scale, { y: 0 }, { y: syA, duration: 0.1, ease: 'power3.in' }, 0);
  tl.fromTo(cA.scale, { y: 0 }, { y: cyA, duration: 0.1, ease: 'power3.in' }, 0);
  tl.to(t.body.scale, { x: 0.12, y: 1.7, duration: 0.16, ease: 'power2.in' }, 0.08);
  tl.to(t.body, { y: -0.7 * u, alpha: 0, duration: 0.16, ease: 'power2.in' }, 0.08);
  tl.call(() => particles.burst(fx, x0, y0, { count: 10, kind: 'spark', colors: [C.primary, C.violet, 0xffffff], size: 0.22 * u, dist: 1.2 * u, duration: 0.45, up: true }), [], 0.1);
  tl.to(bA.scale, { x: 0, duration: 0.1, ease: 'power2.in' }, 0.22);
  tl.to(cA.scale, { x: 0, duration: 0.1, ease: 'power2.in' }, 0.22);
  void sxA;
  void cxA;
  await rt.play(tl);
  board.setTokenCell(playerId, to, jailed);
  const rest = board.tokenRestPosition(playerId);
  gsap.killTweensOf(t.root.position);
  t.root.position.set(rest.x, rest.y);
  t.root.scale.set(rest.scale);
  const bB = mkBeam(rest.x, rest.y), cB = core(rest.x, rest.y);
  const syB = bB.scale.y, cyB = cB.scale.y, sxB = bB.scale.x, cxB = cB.scale.x;
  const tl2 = gsap.timeline({ onComplete: () => { particles.release(bB); particles.release(cB); } });
  tl2.fromTo(bB.scale, { y: 0 }, { y: syB, duration: 0.1, ease: 'power3.in' }, 0);
  tl2.fromTo(cB.scale, { y: 0 }, { y: cyB, duration: 0.1, ease: 'power3.in' }, 0);
  tl2.call(() => {
    ctx.shake(80, 3);
    if (rt.skipping) return;
    particles.burst(fx, rest.x, rest.y, { count: 14, kind: 'spark', colors: [C.primary, C.violet, 0xffffff], size: 0.24 * u, dist: 1.1 * u, duration: 0.45 });
    const ring = particles.hold(fx, 'ring', 0.8 * u, C.primary, true);
    ring.position.set(rest.x, rest.y + 0.35 * u);
    ring.scale.y *= 0.4;
    const rx = ring.scale.x, ry = ring.scale.y;
    rt.fire(gsap.timeline({ onComplete: () => particles.release(ring) }).to(ring.scale, { x: rx * 2.6, y: ry * 2.6, duration: 0.4, ease: 'power2.out' }, 0).to(ring, { alpha: 0, duration: 0.4 }, 0));
  }, [], 0.1);
  tl2.fromTo(t.body.scale, { x: 0.12, y: 1.7 }, { x: 1, y: 1, duration: 0.26, ease: 'back.out(2.5)' }, 0.1);
  tl2.fromTo(t.body, { y: -0.6 * u, alpha: 0 }, { y: 0, alpha: 1, duration: 0.18, ease: 'power2.out' }, 0.1);
  tl2.to(bB.scale, { x: 0, duration: 0.14, ease: 'power2.in' }, 0.22);
  tl2.to(cB.scale, { x: 0, duration: 0.14, ease: 'power2.in' }, 0.22);
  await rt.play(tl2);
  void sxB;
  void cxB;
  t.body.scale.set(1);
  t.body.y = 0;
  t.body.alpha = 1;
  board.placeToken(playerId, true);
}

/** 格子闪一下（填充，board.cellFlashLayer） */
export function flashCell(ctx: FxContext, cellId: number, color: number, alpha = 0.5, duration = 0.3): void {
  const { board, rt } = ctx;
  const g = board.cellFlashLayer(cellId);
  const r = board.cellRect(cellId);
  gsap.killTweensOf(g);
  g.clear();
  g.roundRect(r.x, r.y, r.w, r.h, 0.12 * board.u).fill(color);
  g.alpha = alpha;
  rt.fire(gsap.to(g, { alpha: 0, duration, ease: 'power1.out', onComplete: () => void (g.destroyed || g.clear()) }));
}

/** 格子描边发光一下 */
export function flashBorder(ctx: FxContext, cellId: number, color: number, duration = 0.25): void {
  const { board, rt } = ctx;
  const g = board.cellFlashLayer(cellId);
  const r = board.cellRect(cellId);
  const k = 0.12 * board.u;
  gsap.killTweensOf(g);
  g.clear();
  g.roundRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2, k).fill({ color, alpha: 0.18 }).stroke({ width: 3, color, alpha: 1 });
  g.roundRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2, k + 1).stroke({ width: 4, color: 0xffffff, alpha: 0.35 });
  g.alpha = 1;
  rt.fire(gsap.to(g, { alpha: 0, duration, ease: 'power1.in', onComplete: () => void (g.destroyed || g.clear()) }));
}

/** 融资轮格：金光 + 金币喷泉 + "+200T" 金色大字（不阻塞） */
function passStartBurst(ctx: FxContext, playerId: string, amount?: number): void {
  const { board, particles, rt } = ctx;
  if (rt.skipping) return;
  const u = board.u;
  const fx = board.layers.fx;
  const c = board.cellCenter(0);
  flashCell(ctx, 0, C.gold, 0.75, 0.7);
  const glow = particles.hold(fx, 'glow', 3 * u, C.gold, true);
  glow.position.set(c.x, c.y);
  rt.fire(gsap.fromTo(glow, { alpha: 0.9 }, { alpha: 0, duration: 0.6, onComplete: () => particles.release(glow) }));
  // 金币喷泉：向上喷出再落下，硬币翻转
  const n = window.innerWidth < 760 ? 8 : 16;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.3;
    const v = (4.2 + Math.random() * 2.2) * u;
    particles.emit(fx, c.x, c.y, { kind: 'coin', size: 0.36 * u, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 1.5, gravity: 13 * u, life: 0.8 + Math.random() * 0.25, flip: 10 + Math.random() * 8, rotation: 0, alpha: 1 });
  }
  particles.burst(fx, c.x, c.y, { count: 12, kind: 'spark', colors: [C.gold, C.goldLight, 0xffffff], size: 0.26 * u, dist: 1.3 * u, duration: 0.55, up: true });
  const amt = amount ?? 200;
  popText(ctx, fx, c.x, c.y - 0.9 * u, `+${amt}T`, C.gold, Math.max(22, 0.62 * u), 0.45, 0.8);
  void playerId;
}

/** 经过融资轮：格子演出（若移动中已播则略过）→ 金币飞向玩家条头像 */
export async function playPassStart(ctx: FxContext, playerId: string, amount: number): Promise<void> {
  const { board, rt } = ctx;
  const shown = passShown.delete(playerId);
  if (!shown) passStartBurst(ctx, playerId, amount);
  if (rt.skipping) return;
  const from = toScreen(ctx, board.cellCenter(0));
  const to = board.hudPoint(playerId);
  const tl = htmlCoins(ctx, from, to, 8, 0.45, 0.03);
  tl.call(() => hudPing(ctx, playerId, '#FFC83D', `+${amount}`));
  rt.fire(tl);
  await rt.wait(shown ? 200 : 450);
}

/** 把纹理切成 n×n 块 */
function sliceTexture(src: Texture, n: number): Texture[] {
  const out: Texture[] = [];
  const f = src.frame;
  const w = f.width / n, h = f.height / n;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out.push(new Texture({ source: src.source, frame: new Rectangle(f.x + i * w, f.y + j * h, w, h) }));
  return out;
}

/** 撞上路障：急刹（后仰 + 回弹）→ 路障碎裂飞散 → 红色 "拦截！" + 红闪 + 震动 */
export async function playRoadblockHit(ctx: FxContext, playerId: string, cellId: number): Promise<void> {
  const { board, particles, rt } = ctx;
  const u = board.u;
  const fx = board.layers.fx;
  const c = board.cellCenter(cellId);
  const g = board.cellGeom(cellId);
  board.removeRoadblock(cellId);
  flashCell(ctx, cellId, C.danger, 0.75, 0.5);
  const tl = gsap.timeline();
  // 路障碎片
  if (hasTex('items/roadblock') && !rt.skipping) {
    const src = tex('items/roadblock');
    const n = 3;
    const size = Math.min(g.rect.w, g.rect.h) * 0.6;
    const pieces = sliceTexture(src, n);
    pieces.forEach((pt, i) => {
      const s = new Sprite(pt);
      s.anchor.set(0.5);
      s.width = s.height = size / n;
      const ix = i % n, iy = Math.floor(i / n);
      const ox = (ix - (n - 1) / 2) * (size / n), oy = (iy - (n - 1) / 2) * (size / n);
      s.position.set(c.x + ox, c.y + oy);
      s.zIndex = 3500;
      fx.addChild(s);
      const un = rt.onSkip(() => s.destroy());
      const a = Math.atan2(oy || -0.5, ox || (Math.random() - 0.5)) + (Math.random() - 0.5) * 0.6;
      const d = (1.0 + Math.random() * 0.9) * u;
      tl.to(s, { x: s.x + Math.cos(a) * d, duration: 0.55, ease: 'power2.out' }, 0);
      tl.to(s, { y: s.y + Math.sin(a) * d * 0.7 - 0.6 * u, duration: 0.25, ease: 'power2.out' }, 0);
      tl.to(s, { y: '+=' + 1.0 * u, duration: 0.3, ease: 'power2.in' }, 0.25);
      tl.to(s, { rotation: (Math.random() - 0.5) * 8, duration: 0.55 }, 0);
      tl.to(s, { alpha: 0, duration: 0.2, onComplete: () => { un(); s.destroy(); } }, 0.38);
    });
  }
  tl.call(() => {
    ctx.shake(150, 5);
    particles.burst(fx, c.x, c.y, { count: 14, kind: 'chip', colors: [C.warning, 0xff9a3c, 0xffffff, C.danger], dist: 1.1 * u, size: 0.14 * u, gravity: 0.5 * u, duration: 0.55, add: false });
    particles.burst(fx, c.x, c.y, { count: 8, kind: 'spark', colors: [C.danger, 0xffffff], dist: 0.9 * u, size: 0.24 * u, duration: 0.4 });
    popText(ctx, fx, c.x, c.y - 0.75 * u, '拦截！', C.danger, Math.max(22, 0.6 * u), 0.35, 0.5);
  }, [], 0);
  // 急刹：后仰 + 回弹
  const t = board.tokenView(playerId);
  if (t) {
    tl.fromTo(t.body, { rotation: -0.35, x: -0.18 * u }, { rotation: 0, x: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.35)' }, 0);
    tl.fromTo(t.body.scale, { x: 1.18, y: 0.82 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' }, 0);
  }
  tl.to({}, { duration: 0.6 }, 0);
  await rt.play(tl);
  if (t) {
    t.body.rotation = 0;
    t.body.x = 0;
    t.body.scale.set(1);
  }
}
