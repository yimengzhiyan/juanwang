// 地产类特效：买地染色、建筑升级（光柱 + 弹性升起 + 冲击波 + 彩色粒子；旗舰：暗场 + 双倍金光柱 + 彩虹光环 + AGI 达成 + 星芒雨）、
// 降级（导弹爆炸：白闪 + 火球 + 建筑碎块 + 黑烟 + 裂纹；AI 泡沫破裂：全场建筑同时抖动冒烟）。
import gsap from 'gsap';
import { Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { C } from '../theme';
import type { FxContext } from './context';
import { htmlFx, popText, starRain, toScreen } from './kit';
import { banner } from './overlay';
import { flashBorder, flashCell } from './move';

/** 买地：主人色从颜色条一侧扫光染色 + 扩散环 + 主人色火花 */
export async function playBuy(ctx: FxContext, cellId: number, playerId: string): Promise<void> {
  const { board, rt, particles } = ctx;
  const color = board.playerColor(playerId);
  const u = board.u;
  const fx = board.layers.fx;
  board.setOwner(cellId, playerId);
  const r = board.cellRect(cellId);
  const c = board.cellCenter(cellId);
  flashCell(ctx, cellId, color, 0.9, 0.6);
  const tl = gsap.timeline();
  // 扫光
  const sweep = particles.hold(fx, 'flare', r.w + r.h, 0xffffff, true);
  const vertical = r.h > r.w;
  sweep.rotation = vertical ? 0 : Math.PI / 2;
  sweep.height = Math.max(r.w, r.h) * 0.25;
  sweep.width = Math.min(r.w, r.h) * 1.6;
  if (vertical) sweep.position.set(c.x, r.y);
  else sweep.position.set(r.x, c.y);
  tl.to(sweep.position, vertical ? { y: r.y + r.h, duration: 0.3, ease: 'power2.inOut' } : { x: r.x + r.w, duration: 0.3, ease: 'power2.inOut' }, 0);
  tl.to(sweep, { alpha: 0, duration: 0.12, onComplete: () => particles.release(sweep) }, 0.26);
  // 扩散描边
  const ring = new Graphics().roundRect(-r.w / 2, -r.h / 2, r.w, r.h, 0.12 * u).stroke({ width: 3, color: 0xffffff }).roundRect(-r.w / 2 - 3, -r.h / 2 - 3, r.w + 6, r.h + 6, 0.12 * u + 3).stroke({ width: 4, color, alpha: 0.8 });
  ring.position.set(c.x, c.y);
  fx.addChild(ring);
  const un = rt.onSkip(() => ring.destroy());
  tl.fromTo(ring.scale, { x: 1, y: 1 }, { x: 1.35, y: 1.35, duration: 0.36, ease: 'power2.out' }, 0.04);
  tl.fromTo(ring, { alpha: 1 }, { alpha: 0, duration: 0.36, onComplete: () => { un(); ring.destroy(); } }, 0.05);
  tl.call(() => {
    particles.burst(fx, c.x, c.y, { count: 10, kind: 'spark', colors: [color, 0xffffff, C.gold], dist: 0.9 * u, size: 0.24 * u, duration: 0.5, up: true });
    ctx.shake(100, 2);
  }, [], 0.08);
  await rt.play(tl);
}

/** 光柱（底部锚点在 (x,y)） */
function makeBeam(ctx: FxContext, x: number, y: number, width: number, height: number, color: number) {
  const { particles, board } = ctx;
  const outer = particles.hold(board.layers.fx, 'beam', height, color, true);
  outer.anchor.set(0.5, 1);
  outer.width = width;
  outer.height = height;
  outer.position.set(x, y);
  outer.zIndex = 3000;
  const core = particles.hold(board.layers.fx, 'beam', height, 0xffffff, true);
  core.anchor.set(0.5, 1);
  core.width = width * 0.32;
  core.height = height;
  core.position.set(x, y);
  core.zIndex = 3001;
  return { outer, core, release: () => { particles.release(outer); particles.release(core); } };
}

/** 地面冲击环（椭圆） */
function groundRing(ctx: FxContext, x: number, y: number, size: number, color: number, scaleTo = 2.6, dur = 0.45, delay = 0): void {
  const { particles, rt, board } = ctx;
  if (rt.skipping) return;
  const ring = particles.hold(board.layers.fx, 'ring', size, color, true);
  ring.position.set(x, y);
  ring.scale.y *= 0.42;
  ring.alpha = 0;
  const sx = ring.scale.x, sy = ring.scale.y;
  rt.fire(
    gsap.timeline({ delay, onComplete: () => particles.release(ring) })
      .set(ring, { alpha: 1 })
      .fromTo(ring.scale, { x: sx * 0.4, y: sy * 0.4 }, { x: sx * scaleTo, y: sy * scaleTo, duration: dur, ease: 'power2.out' }, 0)
      .to(ring, { alpha: 0, duration: dur, ease: 'power1.in' }, 0),
  );
}

/** 电弧（v4）：在建筑周围画几条闪烁的折线 */
function arcs(ctx: FxContext, x: number, y: number, h: number, tl: gsap.core.Timeline, at: number): void {
  const { board, rt } = ctx;
  const g = new Graphics();
  g.blendMode = 'add';
  g.zIndex = 3100;
  board.layers.fx.addChild(g);
  const un = rt.onSkip(() => g.destroy());
  const u = board.u;
  const draw = () => {
    g.clear();
    for (let k = 0; k < 3; k++) {
      const col = k % 2 ? C.accent : C.primary;
      let px = x + (Math.random() - 0.5) * 0.9 * u, py = y;
      g.moveTo(px, py);
      for (let s = 0; s < 6; s++) {
        px += (Math.random() - 0.5) * 0.35 * u;
        py -= h / 6;
        g.lineTo(px, py);
      }
      g.stroke({ width: 2, color: col, alpha: 0.95 });
    }
  };
  for (let i = 0; i < 5; i++) tl.call(draw, [], at + i * 0.06);
  tl.call(() => { un(); g.destroy(); }, [], at + 0.32);
}

/** 升级：地面升级圈 → 光柱从天而降 → 新建筑从地面弹性升起 + 冲击波 + 彩色粒子 → "vN!"；旗舰见 playFlagship */
export async function playBuild(ctx: FxContext, cellId: number, level: number): Promise<void> {
  if (level >= 5) return playFlagship(ctx, cellId);
  const { board, rt, particles } = ctx;
  const u = board.u;
  const fx = board.layers.fx;
  const g = board.cellGeom(cellId);
  const ax = g.buildingAnchor.x, ay = g.buildingAnchor.y;
  board.setLevel(cellId, level);
  const s = board.buildingSprite(cellId);
  flashBorder(ctx, cellId, C.primary, 0.9);
  const tl = gsap.timeline();
  // 升级圈（旋转六边形）
  const hex = particles.hold(fx, 'hex', 1.5 * u, C.primary, true);
  hex.position.set(ax, ay);
  hex.scale.y *= 0.42;
  hex.alpha = 0;
  const hs = hex.scale.x, hsy = hex.scale.y;
  tl.to(hex, { alpha: 0.9, duration: 0.1 }, 0);
  tl.fromTo(hex.scale, { x: hs * 0.3, y: hsy * 0.3 }, { x: hs, y: hsy, duration: 0.25, ease: 'back.out(2)' }, 0);
  tl.to(hex, { rotation: Math.PI, duration: 0.8, ease: 'power1.inOut' }, 0);
  tl.to(hex, { alpha: 0, duration: 0.25, onComplete: () => particles.release(hex) }, 0.65);
  // 光柱从天而降
  const beamH = 5 * u;
  const beam = makeBeam(ctx, ax, ay + 0.1 * u, 0.85 * u, beamH, C.primary);
  const bsy = beam.outer.scale.y, csy = beam.core.scale.y, bsx = beam.outer.scale.x, csx = beam.core.scale.x;
  beam.outer.scale.y = 0;
  beam.core.scale.y = 0;
  // 先从上方往下“伸长”：锚在底部，所以用 y 位置 + 高度模拟下落
  beam.outer.y = beam.core.y = ay - beamH;
  tl.to([beam.outer.scale, beam.core.scale], { y: (i: number) => (i === 0 ? bsy : csy), duration: 0.18, ease: 'power2.in' }, 0.05);
  tl.to([beam.outer, beam.core], { y: ay + 0.1 * u, duration: 0.18, ease: 'power2.in' }, 0.05);
  tl.to(beam.outer.scale, { x: bsx * 1.4, duration: 0.08 }, 0.23);
  tl.to([beam.outer.scale, beam.core.scale], { x: 0, duration: 0.3, ease: 'power2.in' }, 0.55);
  tl.call(beam.release, [], 0.86);
  void csx;
  // 建筑弹性升起
  if (s) {
    const sx = s.scale.x, sy = s.scale.y;
    s.scale.set(sx * 0.7, 0);
    tl.to(s.scale, { x: sx * 0.9, y: sy * 1.2, duration: 0.18, ease: 'power2.out' }, 0.23);
    tl.to(s.scale, { x: sx, y: sy, duration: 0.45, ease: 'elastic.out(1.1, 0.4)' }, 0.41);
  }
  tl.call(() => {
    ctx.shake(80, 2);
    groundRing(ctx, ax, ay, 0.9 * u, C.primary, 2.8, 0.45);
    groundRing(ctx, ax, ay, 0.9 * u, 0xffffff, 2.0, 0.35, 0.05);
    particles.burst(fx, ax, ay - 0.2 * u, { count: 16, kind: 'spark', colors: [C.primary, C.accent, C.gold, 0xffffff, C.violet], dist: 1.5 * u, size: 0.26 * u, duration: 0.7, up: true });
    particles.burst(fx, ax, ay, { count: 6, kind: 'dot', colors: [0xc9c3ff], dist: 0.7 * u, size: 0.25 * u, duration: 0.4, angle: -Math.PI / 2, spread: 3, scaleTo: 1.4, alpha: 0.6, add: false });
  }, [], 0.23);
  if (level === 4) arcs(ctx, ax, ay, 1.4 * u, tl, 0.3);
  tl.call(() => void popText(ctx, fx, ax, ay - 1.25 * u, `v${level}!`, C.primary, Math.max(18, 0.48 * u), 0.3, 0.6), [], 0.55);
  tl.to({}, { duration: 1.0 }, 0);
  await rt.play(tl);
  if (s && !s.destroyed) s.scale.set(Math.abs(s.scale.x), Math.abs(s.scale.y));
}

/** 旗舰：全屏暗场（聚光在建筑）→ 双倍金色光柱 → 建筑升起 → 彩虹光环从天而降套住 → "AGI 达成！" → 金色星芒雨 → 300ms 震动 */
async function playFlagship(ctx: FxContext, cellId: number): Promise<void> {
  const { board, rt, particles } = ctx;
  const u = board.u;
  const fx = board.layers.fx;
  const g = board.cellGeom(cellId);
  const ax = g.buildingAnchor.x, ay = g.buildingAnchor.y;
  board.setLevel(cellId, 5);
  const s = board.buildingSprite(cellId);
  // 暗场（HTML，盖过 HUD；建筑处留一个聚光洞）
  const sp = toScreen(ctx, { x: ax, y: ay - 0.6 * u });
  const dim = htmlFx(ctx, 'fx2-dim');
  const R = Math.max(60, 1.6 * u);
  dim.el.style.background = `radial-gradient(ellipse ${R}px ${R * 1.5}px at ${sp.x}px ${sp.y}px, rgba(4,2,16,0) 0%, rgba(4,2,16,0) 55%, rgba(4,2,16,.3) 100%)`;
  const tl = gsap.timeline();
  tl.fromTo(dim.el, { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0);
  flashBorder(ctx, cellId, C.gold, 1.6);
  // 双倍金色光柱
  const beamH = 7 * u;
  const beam = makeBeam(ctx, ax, ay + 0.1 * u, 1.8 * u, beamH, C.gold);
  const bsy = beam.outer.scale.y, csy = beam.core.scale.y;
  beam.outer.scale.y = beam.core.scale.y = 0;
  beam.outer.y = beam.core.y = ay - beamH;
  beam.core.width = 0.7 * u;
  const csx = beam.core.scale.x;
  tl.to([beam.outer.scale, beam.core.scale], { y: (i: number) => (i === 0 ? bsy : csy), duration: 0.22, ease: 'power2.in' }, 0.15);
  tl.to([beam.outer, beam.core], { y: ay + 0.1 * u, duration: 0.22, ease: 'power2.in' }, 0.15);
  // 光柱呼吸
  tl.to(beam.core.scale, { x: csx * 1.6, duration: 0.12, yoyo: true, repeat: 3 }, 0.4);
  tl.to([beam.outer.scale, beam.core.scale], { x: 0, duration: 0.35, ease: 'power2.in' }, 1.45);
  tl.call(beam.release, [], 1.82);
  // 建筑升起
  if (s) {
    const sx = s.scale.x, sy = s.scale.y;
    s.scale.set(sx * 0.6, 0);
    tl.to(s.scale, { x: sx * 0.9, y: sy * 1.25, duration: 0.22, ease: 'power2.out' }, 0.37);
    tl.to(s.scale, { x: sx, y: sy, duration: 0.6, ease: 'elastic.out(1.1, 0.35)' }, 0.59);
  }
  tl.call(() => {
    ctx.shake(300, 6);
    groundRing(ctx, ax, ay, 1.2 * u, C.gold, 3.6, 0.6);
    groundRing(ctx, ax, ay, 1.2 * u, 0xffffff, 2.6, 0.45, 0.06);
    groundRing(ctx, ax, ay, 1.2 * u, C.accent, 4.4, 0.7, 0.12);
    particles.burst(fx, ax, ay - 0.3 * u, { count: 32, kind: 'spark', colors: [C.gold, C.goldLight, 0xffffff, C.accent, C.primary], dist: 2.4 * u, size: 0.32 * u, duration: 0.9, up: true });
  }, [], 0.37);
  // 彩虹光环从天而降套住建筑
  const halo = particles.hold(fx, 'rainbow', 1.9 * u, 0xffffff, true);
  halo.zIndex = 3200;
  const hsx = halo.scale.x;
  halo.scale.y = hsx * 0.36;
  halo.position.set(ax, ay - 4 * u);
  halo.alpha = 0;
  const hsy = halo.scale.y;
  tl.to(halo, { alpha: 1, duration: 0.1 }, 0.55);
  tl.to(halo, { y: ay - 0.45 * u, duration: 0.42, ease: 'bounce.out' }, 0.55);
  tl.fromTo(halo.scale, { x: hsx * 1.6, y: hsy * 1.6 }, { x: hsx, y: hsy, duration: 0.42, ease: 'power2.out' }, 0.55);
  tl.to(halo, { rotation: 0.0, duration: 0.01 }, 0.97);
  tl.to(halo.scale, { x: hsx * 1.08, y: hsy * 1.08, duration: 0.18, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 1.0);
  tl.to(halo, { alpha: 0, y: ay - 1.2 * u, duration: 0.3, onComplete: () => particles.release(halo) }, 1.7);
  // 横幅 + 星芒雨
  const bannerAt = 0.75;
  let bannerP: Promise<void> = Promise.resolve();
  tl.call(() => {
    bannerP = banner(ctx, 'AGI 达成！', 'agi', 550, '旗舰数据中心上线', Math.max(80, sp.y - 2.2 * u));
    starRain(ctx, 40, 1.25, true);
  }, [], bannerAt);
  tl.to(dim.el, { opacity: 0, duration: 0.25, onComplete: dim.done }, 1.75);
  tl.to({}, { duration: 2.0 }, 0);
  await rt.play(tl);
  await bannerP;
  dim.done();
}

/* ============================== 降级 ============================== */

/** 降级的上下文：导弹刚飞到哪一格 / 是否处于 AI 泡沫破裂（卡牌 downgradeAll）批次中 */
export const downgradeCtx = {
  missileCell: -1,
  bubblePending: false,
  bubbleActive: false,
};

/** 建筑纹理切成 2×2 碎块 */
function buildingChunks(s: Sprite): Texture[] {
  const t = s.texture;
  const f = t.frame;
  const out: Texture[] = [];
  for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) out.push(new Texture({ source: t.source, frame: new Rectangle(f.x + (i * f.width) / 2, f.y + (j * f.height) / 2, f.width / 2, f.height / 2) }));
  return out;
}

/** 降级（导弹 / 清算）：白闪 → 火球（橙→品红）+ 冲击环 → 建筑碎成 4 块弹飞 → 换低一级贴图弹回 → 黑烟 + 红色裂纹 */
export async function playDowngrade(ctx: FxContext, cellId: number, level: number): Promise<void> {
  if (downgradeCtx.bubblePending || downgradeCtx.bubbleActive) return playBubbleDowngrade(ctx, cellId, level);
  downgradeCtx.missileCell = -1;
  const { board, rt, particles } = ctx;
  const u = board.u;
  const fx = board.layers.fx;
  const g = board.cellGeom(cellId);
  const ax = g.buildingAnchor.x, ay = g.buildingAnchor.y;
  const cy = ay - 0.4 * u;
  const old = board.buildingSprite(cellId);
  const tl = gsap.timeline();
  flashCell(ctx, cellId, 0xffffff, 1, 0.2);
  // 火球：白核 → 橙 → 品红
  const glowW = particles.hold(fx, 'glow', 1.2 * u, 0xffffff, true);
  const glowO = particles.hold(fx, 'glow', 2.4 * u, 0xff9a3c, true);
  const glowM = particles.hold(fx, 'glow', 3.4 * u, C.accent, true);
  for (const s of [glowM, glowO, glowW]) {
    s.position.set(ax, cy);
    s.zIndex = 3500;
  }
  const sW = glowW.scale.x, sO = glowO.scale.x, sM = glowM.scale.x;
  glowW.scale.set(0.1 * sW);
  glowO.scale.set(0.1 * sO);
  glowM.scale.set(0.1 * sM);
  tl.to(glowW.scale, { x: sW * 1.3, y: sW * 1.3, duration: 0.1, ease: 'power3.out' }, 0.04);
  tl.to(glowO.scale, { x: sO, y: sO, duration: 0.18, ease: 'power3.out' }, 0.06);
  tl.to(glowM.scale, { x: sM, y: sM, duration: 0.28, ease: 'power2.out' }, 0.08);
  tl.to(glowW, { alpha: 0, duration: 0.18 }, 0.14);
  tl.to(glowO, { alpha: 0, duration: 0.3 }, 0.22);
  tl.to(glowM, { alpha: 0, duration: 0.4, onComplete: () => { particles.release(glowW); particles.release(glowO); particles.release(glowM); } }, 0.26);
  tl.call(() => {
    ctx.shake(250, 8);
    if (rt.skipping) return;
    groundRing(ctx, ax, ay, 1.0 * u, 0xff9a3c, 3.2, 0.45);
    particles.burst(fx, ax, cy, { count: 20, kind: 'chip', colors: [0xff9a3c, C.danger, C.accent, 0xffd93d], dist: 1.6 * u, size: 0.16 * u, gravity: 0.7 * u, duration: 0.7, add: false });
    particles.burst(fx, ax, cy, { count: 10, kind: 'spark', colors: [0xffffff, 0xffd93d, 0xff9a3c], dist: 1.3 * u, size: 0.28 * u, duration: 0.4 });
    // 地面红色裂纹贴片，1s 淡出
    const crack = particles.hold(fx, 'crack', Math.min(g.rect.w, g.rect.h) * 1.0, C.danger, true);
    crack.position.set(ax, ay - 0.1 * u);
    crack.rotation = Math.random() * Math.PI;
    crack.zIndex = -1;
    rt.fire(gsap.timeline({ onComplete: () => particles.release(crack) }).fromTo(crack, { alpha: 1 }, { alpha: 0, duration: 1.0, delay: 0.2 }));
    flashCell(ctx, cellId, C.danger, 0.6, 0.8);
  }, [], 0.06);
  // 建筑碎成 4 块弹飞
  if (old && !rt.skipping) {
    const chunks = buildingChunks(old);
    const w = old.width, h = old.height;
    old.visible = false;
    chunks.forEach((ct, i) => {
      const s = new Sprite(ct);
      s.anchor.set(0.5);
      s.width = w / 2;
      s.height = h / 2;
      const ix = i % 2, iy = Math.floor(i / 2);
      const ox = (ix - 0.5) * (w / 2), oy = -h * 0.84 + (iy + 0.5) * (h / 2);
      s.position.set(ax + ox, ay + oy);
      s.zIndex = 3400;
      fx.addChild(s);
      const un = rt.onSkip(() => s.destroy());
      const dir = ix ? 1 : -1;
      tl.to(s, { x: s.x + dir * (0.8 + Math.random() * 0.6) * u, rotation: dir * (1.5 + Math.random() * 2), duration: 0.55, ease: 'power1.out' }, 0.08);
      tl.to(s, { y: s.y - (0.7 + (1 - iy) * 0.5) * u, duration: 0.22, ease: 'power2.out' }, 0.08);
      tl.to(s, { y: ay + 0.3 * u, duration: 0.32, ease: 'power2.in' }, 0.3);
      tl.to(s, { alpha: 0, duration: 0.15, onComplete: () => { un(); s.destroy(); } }, 0.5);
    });
  }
  // 换低一级贴图，从地面弹回（短暂变灰）
  tl.call(() => {
    board.setLevel(cellId, level);
    const ns = board.buildingSprite(cellId);
    if (ns && !rt.skipping) {
      ns.tint = 0x8a8899;
      const sx = ns.scale.x, sy = ns.scale.y;
      rt.fire(gsap.fromTo(ns.scale, { x: sx * 1.2, y: sy * 0.3 }, { x: sx, y: sy, duration: 0.45, ease: 'elastic.out(1, 0.4)' }));
      rt.fire(gsap.delayedCall(0.5, () => {
        if (!ns.destroyed) ns.tint = 0xffffff;
      }));
    }
  }, [], 0.36);
  // 黑烟缓慢上升（不阻塞）
  tl.call(() => {
    if (rt.skipping) return;
    for (let i = 0; i < 6; i++) {
      particles.emit(fx, ax + (Math.random() - 0.5) * 0.6 * u, cy, {
        kind: 'smoke',
        color: i % 2 ? 0x4a4060 : 0x6e5f8f,
        size: (0.6 + Math.random() * 0.4) * u,
        vx: (Math.random() - 0.5) * 0.6 * u,
        vy: -(0.9 + Math.random() * 0.8) * u,
        life: 0.8 + Math.random() * 0.4,
        scaleTo: 2.2,
        alpha: 0.85,
        spin: (Math.random() - 0.5) * 1.5,
      });
    }
  }, [], 0.4);
  tl.to({}, { duration: 0.85 }, 0);
  await rt.play(tl);
  board.refreshCell(cellId);
  const ns = board.buildingSprite(cellId);
  if (ns) ns.tint = 0xffffff;
}

/** AI 泡沫破裂（卡牌 downgradeAll）：第一次调用时全场所有建筑同时抖动冒烟（~0.9s），之后的每格只快速换贴图 */
async function playBubbleDowngrade(ctx: FxContext, cellId: number, level: number): Promise<void> {
  const { board, rt, particles } = ctx;
  const u = board.u;
  const fx = board.layers.fx;
  if (downgradeCtx.bubblePending) {
    downgradeCtx.bubblePending = false;
    downgradeCtx.bubbleActive = true;
    const tl = gsap.timeline();
    const ids: number[] = [];
    for (let i = 0; i < 40; i++) if (board.ownerOf(i) && board.buildingSprite(i) && board.levelOf(i) > 0) ids.push(i);
    if (!ids.includes(cellId)) ids.push(cellId);
    tl.call(() => ctx.shake(450, 6), [], 0);
    ids.forEach((id, k) => {
      const s = board.buildingSprite(id);
      const g = board.cellGeom(id);
      flashCell(ctx, id, C.danger, 0.55, 0.7);
      if (s) {
        const x0 = s.x;
        tl.to(s, { x: x0 + 0.06 * u, duration: 0.04, yoyo: true, repeat: 11, ease: 'none' }, k * 0.01);
        tl.to(s, { rotation: 0.08, duration: 0.06, yoyo: true, repeat: 5, ease: 'sine.inOut' }, k * 0.01);
        tl.set(s, { x: x0, rotation: 0 }, 0.5 + k * 0.01);
      }
      tl.call(() => {
        if (rt.skipping) return;
        for (let i = 0; i < 3; i++)
          particles.emit(fx, g.buildingAnchor.x + (Math.random() - 0.5) * 0.4 * u, g.buildingAnchor.y - 0.4 * u, {
            kind: 'smoke',
            color: i % 2 ? 0x4a4060 : 0x7a6a9a,
            size: 0.5 * u,
            vx: (Math.random() - 0.5) * 0.4 * u,
            vy: -(0.8 + Math.random() * 0.6) * u,
            life: 0.9,
            scaleTo: 2.2,
            alpha: 0.8,
          });
        particles.burst(fx, g.buildingAnchor.x, g.buildingAnchor.y - 0.4 * u, { count: 4, kind: 'chip', colors: [0xff9a3c, C.danger], dist: 0.6 * u, size: 0.12 * u, gravity: 0.4 * u, duration: 0.5, add: false });
      }, [], 0.1 + (k % 6) * 0.05);
    });
    tl.call(() => {
      const c = board.boardCenter();
      popText(ctx, fx, c.x, c.y - 0.5 * u, '泡沫破裂！', C.danger, Math.max(24, 0.7 * u), 0.4, 0.4);
    }, [], 0.05);
    tl.to({}, { duration: 0.85 }, 0);
    await rt.play(tl);
  }
  // 每格：快速换贴图 + 小烟
  const g = board.cellGeom(cellId);
  board.setLevel(cellId, level);
  const ns = board.buildingSprite(cellId);
  if (ns && !rt.skipping) {
    const sx = ns.scale.x, sy = ns.scale.y;
    rt.fire(gsap.fromTo(ns.scale, { x: sx * 1.15, y: sy * 0.5 }, { x: sx, y: sy, duration: 0.3, ease: 'back.out(2.5)' }));
  }
  particles.burst(fx, g.buildingAnchor.x, g.buildingAnchor.y - 0.3 * u, { count: 3, kind: 'smoke', colors: [0x6e5f8f], dist: 0.4 * u, size: 0.4 * u, duration: 0.5, up: true, scaleTo: 1.8, add: false, alpha: 0.7 });
  await rt.wait(70);
}
