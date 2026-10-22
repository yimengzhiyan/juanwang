// 道具特效：通用开场（图标从玩家头顶弹出 + 光环 + 名称）→ 各道具专属动画。
// 注意（DESIGN 9.5）：导弹命中后的降级由事件队列随后的 downgrade 事件播放（这里只记下命中格，降级时直接爆炸）。
import gsap from 'gsap';
import { Graphics, Sprite } from 'pixi.js';
import { hasTex, tex } from '../assets';
import { C } from '../theme';
import type { FxContext } from './context';
import { downgradeCtx } from './build';
import { popText } from './kit';
import { playJailExit } from './overlay';

const ITEM_COLOR: Record<string, number> = {
  roadblock: C.warning,
  missile: C.danger,
  rocket: 0xff9a3c,
  turtle: C.success,
  shield: 0x5fd4ff,
  teleport: C.violet,
  jailfree: C.gold,
};

function itemSprite(ctx: FxContext, itemId: string, size: number): Sprite {
  const s = new Sprite(hasTex('items/' + itemId) ? tex('items/' + itemId) : ctx.particles.texture('spark'));
  s.anchor.set(0.5);
  s.width = s.height = size;
  s.zIndex = 4000;
  ctx.board.layers.fx.addChild(s);
  return s;
}

export async function playItem(ctx: FxContext, playerId: string, itemId: string, itemName: string, targetCellId?: number, targetPlayerId?: string): Promise<void> {
  const { board, rt, particles } = ctx;
  const u = board.u;
  const fx = board.layers.fx;
  const tok = board.tokenSprite(playerId);
  const from = tok ? { x: tok.x, y: tok.y } : board.boardCenter();
  const color = ITEM_COLOR[itemId] ?? C.primary;
  // 通用开场：图标弹出 + 背后光晕 + 名称
  const icon = itemSprite(ctx, itemId, 0.8 * u);
  const unIcon = rt.onSkip(() => icon.destroy());
  const killIcon = () => {
    unIcon();
    if (!icon.destroyed) icon.destroy();
  };
  icon.position.set(from.x, from.y - 0.6 * u);
  const halo = particles.hold(fx, 'glow', 1.8 * u, color, true);
  halo.position.copyFrom(icon.position);
  halo.zIndex = 3999;
  const base = icon.scale.x;
  const tl = gsap.timeline();
  tl.fromTo(icon.scale, { x: 0, y: 0 }, { x: base * 1.6, y: base * 1.6, duration: 0.22, ease: 'back.out(2.5)' }, 0);
  tl.to(icon, { y: from.y - 1.05 * u, duration: 0.22, ease: 'power2.out' }, 0);
  tl.to(halo, { y: from.y - 1.05 * u, duration: 0.22, ease: 'power2.out' }, 0);
  tl.fromTo(halo.scale, { x: 0, y: 0 }, { x: halo.scale.x, y: halo.scale.y, duration: 0.25 }, 0);
  tl.to(halo, { alpha: 0, duration: 0.3, onComplete: () => particles.release(halo) }, 0.25);
  tl.call(() => {
    particles.burst(fx, from.x, from.y - 1.05 * u, { count: 8, kind: 'spark', colors: [color, 0xffffff], dist: 0.8 * u, size: 0.22 * u, duration: 0.4 });
    popText(ctx, fx, from.x, from.y - 1.9 * u, itemName, color, Math.max(15, 0.36 * u), 0.5, 0.3);
  }, [], 0.05);
  tl.to(icon.scale, { x: base * 1.3, y: base * 1.3, duration: 0.1 }, 0.25);
  await rt.play(tl);

  const tc = targetCellId !== undefined ? board.cellCenter(targetCellId) : null;
  const tl2 = gsap.timeline();
  switch (itemId) {
    case 'roadblock':
      if (tc) {
        // 图标从高空落到目标格，弹两下，警示灯闪
        tl2.to(icon, { alpha: 0, y: icon.y - 0.8 * u, duration: 0.12 }, 0);
        tl2.set(icon, { x: tc.x, y: tc.y - 3.5 * u, alpha: 1 }, 0.14);
        tl2.set(icon.scale, { x: base * 1.2, y: base * 1.2 }, 0.14);
        tl2.to(icon, { y: tc.y, duration: 0.42, ease: 'bounce.out' }, 0.14);
        tl2.call(() => {
          ctx.shake(80, 3);
          particles.burst(fx, tc.x, tc.y + 0.3 * u, { count: 8, kind: 'dot', colors: [0xc9c3ff, 0xffffff], dist: 0.7 * u, size: 0.24 * u, duration: 0.4, angle: -Math.PI / 2, spread: 3, scaleTo: 1.4, alpha: 0.7, add: false });
        }, [], 0.29);
        tl2.call(() => board.addRoadblock(targetCellId!), [], 0.56);
        const lamp = particles.hold(fx, 'glow', 2 * u, C.warning, true);
        lamp.position.set(tc.x, tc.y);
        lamp.alpha = 0;
        for (let i = 0; i < 2; i++) tl2.to(lamp, { alpha: 0.85, duration: 0.06 }, 0.56 + i * 0.16).to(lamp, { alpha: 0, duration: 0.08 }, 0.64 + i * 0.16);
        tl2.call(() => particles.release(lamp), [], 0.9);
        tl2.to(icon, { alpha: 0, duration: 0.1 }, 0.56);
      }
      break;
    case 'missile':
      if (tc) {
        // 目标格红色准星
        const ret = new Graphics();
        const rr = 0.55 * u;
        ret.circle(0, 0, rr).stroke({ width: 3, color: C.danger }).circle(0, 0, rr * 0.45).stroke({ width: 2, color: C.danger });
        for (let k = 0; k < 4; k++) {
          const a = (k * Math.PI) / 2;
          ret.moveTo(Math.cos(a) * rr * 0.6, Math.sin(a) * rr * 0.6).lineTo(Math.cos(a) * rr * 1.3, Math.sin(a) * rr * 1.3);
        }
        ret.stroke({ width: 3, color: C.danger });
        ret.position.set(tc.x, tc.y);
        ret.zIndex = 3900;
        fx.addChild(ret);
        const unRet = rt.onSkip(() => ret.destroy());
        tl2.fromTo(ret.scale, { x: 2.2, y: 2.2 }, { x: 1, y: 1, duration: 0.25, ease: 'power3.out' }, 0);
        tl2.fromTo(ret, { alpha: 0, rotation: -1 }, { alpha: 1, rotation: 0.6, duration: 0.6 }, 0);
        // 抛物线弹道 + 拖烟 + 尾焰
        const p = { k: 0 };
        const sx = icon.x, sy = icon.y;
        const lift = Math.min(3.5 * u, Math.hypot(tc.x - sx, tc.y - sy) * 0.4 + 1.2 * u);
        let px = sx, py = sy;
        tl2.to(icon.scale, { x: base, y: base, duration: 0.1 }, 0.05);
        tl2.to(p, {
          k: 1,
          duration: 0.55,
          ease: 'power1.in',
          onUpdate: () => {
            const k = p.k;
            const x = sx + (tc.x - sx) * k, y = sy + (tc.y - sy) * k - Math.sin(Math.PI * k) * lift;
            const ang = Math.atan2(y - py, x - px);
            if (k > 0) icon.rotation = ang + Math.PI / 4;
            icon.position.set(x, y);
            // 按飞行距离均匀拖烟（与帧率无关）
            const seg = Math.hypot(x - px, y - py);
            const step = 0.14 * u;
            const n = Math.min(12, Math.floor(seg / step));
            for (let j = 1; j <= n; j++) {
              const f = j / n;
              const bx = px + (x - px) * f - Math.cos(ang) * 0.3 * u, by = py + (y - py) * f - Math.sin(ang) * 0.3 * u;
              particles.emit(fx, bx, by, { kind: 'smoke', color: 0x9a90b8, size: 0.34 * u, life: 0.55, scaleTo: 2.4, alpha: 0.5, vx: (Math.random() - 0.5) * 0.3 * u, vy: -0.25 * u });
              if (j === n) particles.emit(fx, bx, by, { kind: 'glow', color: 0xff9a3c, size: 0.6 * u, life: 0.12, scaleTo: 0.3, alpha: 0.95, add: true });
            }
            if (n > 0 || k === 0) {
              px = x;
              py = y;
            }
          },
        }, 0.05);
        tl2.call(() => {
          downgradeCtx.missileCell = targetCellId!;
          icon.visible = false;
          particles.emit(fx, tc.x, tc.y, { kind: 'glow', color: 0xffffff, size: 2 * u, life: 0.15, scaleTo: 1.4, alpha: 1, add: true });
          unRet();
          ret.destroy();
        }, [], 0.6);
      }
      break;
    case 'turtle': {
      const tgt = targetPlayerId ? board.tokenView(targetPlayerId) : null;
      if (tgt) {
        const T = { x: tgt.root.x, y: tgt.root.y - 0.55 * u };
        const p = { k: 0 };
        const sx = icon.x, sy = icon.y;
        const lift = Math.min(3 * u, Math.hypot(T.x - sx, T.y - sy) * 0.5 + 1.5 * u);
        tl2.to(p, {
          k: 1,
          duration: 0.5,
          ease: 'none',
          onUpdate: () => icon.position.set(sx + (T.x - sx) * p.k, sy + (T.y - sy) * p.k - Math.sin(Math.PI * p.k) * lift),
        }, 0);
        tl2.to(icon, { rotation: Math.PI * 4, duration: 0.5, ease: 'none' }, 0);
        tl2.to(icon.scale, { x: base * 0.9, y: base * 0.9, duration: 0.5 }, 0);
        tl2.call(() => {
          ctx.shake(60, 2);
          particles.burst(fx, T.x, T.y, { count: 8, kind: 'spark', colors: [C.success, 0xffffff], dist: 0.8 * u, size: 0.22 * u, duration: 0.4 });
          popText(ctx, fx, T.x, T.y - 0.8 * u, '限流中', C.success, Math.max(16, 0.4 * u), 0.45, 0.4);
        }, [], 0.5);
        tl2.fromTo(tgt.body.scale, { x: 1.25, y: 0.75 }, { x: 1, y: 1, duration: 0.4, ease: 'elastic.out(1.2, 0.35)', immediateRender: false }, 0.5);
        tl2.fromTo(icon.scale, { x: base * 1.15, y: base * 0.7 }, { x: base * 0.9, y: base * 0.9, duration: 0.3, ease: 'back.out(3)', immediateRender: false }, 0.5);
        tl2.to(icon, { rotation: Math.PI * 4 + 0.25, duration: 0.08, yoyo: true, repeat: 3 }, 0.55);
        tl2.to(icon, { alpha: 0, duration: 0.18 }, 0.82);
      }
      break;
    }
    case 'shield': {
      // 蓝色六边形护盾从脚下升起包住棋子，涟漪两次后淡出
      tl2.to(icon, { alpha: 0, duration: 0.15 }, 0);
      const sh = particles.hold(fx, 'hex', 1.8 * u, 0x5fd4ff, true);
      sh.position.set(from.x, from.y + 0.35 * u);
      sh.zIndex = 3600;
      const s0 = sh.scale.x;
      tl2.fromTo(sh.scale, { x: s0 * 0.6, y: s0 * 0.12 }, { x: s0, y: s0 * 0.25, duration: 0.15 }, 0);
      tl2.to(sh, { y: from.y, duration: 0.25, ease: 'back.out(2)' }, 0.15);
      tl2.to(sh.scale, { y: s0, duration: 0.25, ease: 'back.out(2)' }, 0.15);
      tl2.call(() => {
        particles.burst(fx, from.x, from.y, { count: 12, kind: 'spark', colors: [0x5fd4ff, 0xffffff], dist: 1.2 * u, size: 0.22 * u, duration: 0.45 });
        const ring = particles.hold(fx, 'ring', 1.6 * u, 0x5fd4ff, true);
        ring.position.set(from.x, from.y);
        const r0 = ring.scale.x;
        rt.fire(gsap.timeline({ onComplete: () => particles.release(ring) }).to(ring.scale, { x: r0 * 1.8, y: r0 * 1.8, duration: 0.4 }, 0).to(ring, { alpha: 0, duration: 0.4 }, 0));
      }, [], 0.38);
      tl2.to(sh, { alpha: 0.5, duration: 0.12, yoyo: true, repeat: 3 }, 0.42);
      tl2.to(sh, { alpha: 0, duration: 0.18, onComplete: () => particles.release(sh) }, 0.8);
      break;
    }
    case 'rocket': {
      // 棋子点火：脚下喷火 + 抖动上蹿 + "+6" 火焰字
      const t = board.tokenView(playerId);
      tl2.to(icon, { y: icon.y - 1.5 * u, alpha: 0, duration: 0.3, ease: 'power2.in' }, 0);
      const p = { k: 0 };
      tl2.to(p, {
        k: 1,
        duration: 0.6,
        onUpdate: () => {
          const x = t ? t.root.x : from.x, y = (t ? t.root.y : from.y) + 0.4 * u;
          for (let i = 0; i < 2; i++)
            particles.emit(fx, x + (Math.random() - 0.5) * 0.3 * u, y, { kind: i ? 'glow' : 'spark', color: i ? 0xff5b1f : C.gold, size: (i ? 0.7 : 0.3) * u, vx: (Math.random() - 0.5) * u, vy: (1.5 + Math.random()) * u, life: 0.25, scaleTo: 0.2, alpha: 0.95, add: true });
        },
      }, 0);
      if (t) {
        tl2.to(t.body, { x: 2, duration: 0.03, yoyo: true, repeat: 9 }, 0);
        tl2.to(t.body, { y: -0.35 * u, duration: 0.15, ease: 'power2.out' }, 0.3);
        tl2.to(t.body, { y: 0, x: 0, duration: 0.2, ease: 'bounce.out' }, 0.45);
      }
      tl2.call(() => {
        ctx.shake(100, 3);
        popText(ctx, fx, from.x + 0.7 * u, from.y - 0.9 * u, '+6', 0xff9a3c, Math.max(24, 0.7 * u), 0.4, 0.5);
      }, [], 0.3);
      break;
    }
    case 'teleport': {
      // 充能：紫青粒子向棋子汇聚 + 漩涡环（随后的 move teleport 事件播放光柱传送）
      tl2.to(icon, { alpha: 0, duration: 0.2 }, 0);
      tl2.to(icon.scale, { x: 0, y: 0, duration: 0.2 }, 0);
      const p = { k: 0 };
      tl2.to(p, {
        k: 1,
        duration: 0.5,
        onUpdate: () => {
          const a = Math.random() * Math.PI * 2, r = (1.1 + Math.random() * 0.4) * u;
          particles.emit(fx, from.x + Math.cos(a) * r, from.y + Math.sin(a) * r, { kind: 'spark', color: Math.random() > 0.5 ? C.violet : C.primary, size: 0.22 * u, vx: -Math.cos(a) * r * 3.2, vy: -Math.sin(a) * r * 3.2, life: 0.3, scaleTo: 0.3, add: true });
        },
      }, 0);
      const sw = particles.hold(fx, 'ring', 1.4 * u, C.violet, true);
      sw.position.set(from.x, from.y + 0.2 * u);
      sw.scale.y *= 0.4;
      const s0x = sw.scale.x, s0y = sw.scale.y;
      tl2.fromTo(sw.scale, { x: s0x * 1.5, y: s0y * 1.5 }, { x: s0x * 0.3, y: s0y * 0.3, duration: 0.5, ease: 'power2.in' }, 0);
      tl2.to(sw, { alpha: 0, duration: 0.1, onComplete: () => particles.release(sw) }, 0.45);
      break;
    }
    case 'jailfree': {
      // 金卡闪光 + "豁免" 绿章 + 栏杆弹开
      tl2.to(icon.scale, { x: base * 2.2, y: base * 2.2, duration: 0.2, ease: 'back.out(2)' }, 0);
      tl2.call(() => {
        particles.emit(fx, icon.x, icon.y, { kind: 'glow', color: C.gold, size: 2.4 * u, life: 0.35, scaleTo: 1.5, alpha: 1, add: true });
        particles.burst(fx, icon.x, icon.y, { count: 14, kind: 'spark', colors: [C.gold, C.success, 0xffffff], size: 0.26 * u, dist: 1.3 * u, duration: 0.5 });
        popText(ctx, fx, icon.x, icon.y, '豁免', C.success, Math.max(24, 0.7 * u), 0.35, 0.2);
        if (board.player(playerId)?.inJail) playJailExit(ctx, playerId);
      }, [], 0.2);
      tl2.to(icon, { alpha: 0, duration: 0.25 }, 0.45);
      break;
    }
    default:
      tl2.to(icon, { alpha: 0, duration: 0.25 });
  }
  await rt.play(tl2);
  killIcon();
}
