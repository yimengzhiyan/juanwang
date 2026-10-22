// 金钱类特效：API 调用费（Token 金币沿弧线连射 + 尾迹；护盾时金币撞碎在六边形防火墙上）、余额浮字。
import gsap from 'gsap';
import { C } from '../theme';
import type { FxContext } from './context';
import { hudPing, isMobile, popText } from './kit';

/** 收费：付款方 "-xxT" → 金币（clamp(amt/25,5,20) 枚）沿弧线连射到收款方 → "+xxT" + 收款方弹一下 + 玩家条头像光环 */
export async function playRent(ctx: FxContext, fromId: string, toId: string, amount: number, shielded: boolean): Promise<void> {
  const { board, rt, particles } = ctx;
  const ta = board.tokenView(fromId);
  const tb = board.tokenView(toId);
  if (!ta || !tb) return;
  const u = board.u;
  const fx = board.layers.fx;
  const A = { x: ta.root.x, y: ta.root.y }, B = { x: tb.root.x, y: tb.root.y };
  let n = Math.max(5, Math.min(20, Math.round(amount / 25)));
  if (isMobile()) n = Math.max(5, Math.ceil(n * 0.6));
  const fs = Math.max(18, 0.46 * u);
  if (shielded) return playShielded(ctx, A, B, amount, n, fs);
  const tl = gsap.timeline();

  // 付款方：红字 + 左右抖
  tl.call(() => void popText(ctx, fx, A.x, A.y - 0.65 * u, `-${amount}T`, C.danger, fs, 0.35, 0.6), [], 0);
  tl.fromTo(ta.body, { x: -3 }, { x: 0, duration: 0.3, ease: 'elastic.out(1.2, 0.3)' }, 0);
  const dist = Math.hypot(B.x - A.x, B.y - A.y);
  const lift = Math.min(3 * u, dist * 0.35 + u * 0.6);
  const stagger = Math.min(0.03, 0.3 / n);
  const fly = 0.38;
  const trailEvery = isMobile() ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const coin = particles.hold(fx, 'coin', 0.52 * u);
    coin.position.set(A.x, A.y);
    coin.alpha = 0;
    coin.zIndex = 3500;
    const base = coin.scale.x;
    const p = { k: 0 };
    const jx = (Math.random() - 0.5) * 0.5 * u, jl = lift * (0.85 + Math.random() * 0.3);
    let frame = 0;
    const at = 0.08 + i * stagger;
    tl.set(coin, { alpha: 1 }, at);
    tl.to(
      p,
      {
        k: 1,
        duration: fly,
        ease: 'power1.inOut',
        onUpdate: () => {
          const k = p.k;
          const x = A.x + (B.x - A.x) * k + jx * Math.sin(Math.PI * k);
          const y = A.y + (B.y - A.y) * k - Math.sin(Math.PI * k) * jl;
          coin.position.set(x, y);
          coin.scale.x = base * (0.25 + 0.75 * Math.abs(Math.cos(k * 9 + i)));
          if (++frame % trailEvery === 0 && k < 0.95) particles.emit(fx, x, y, { kind: 'spark', color: i % 3 ? C.gold : 0xffffff, size: 0.32 * u, life: 0.26, scaleTo: 0.2, alpha: 0.9, add: true });
        },
        onComplete: () => {
          particles.release(coin);
          particles.emit(fx, B.x, B.y, { kind: 'glow', color: C.gold, size: 0.9 * u, life: 0.18, scaleTo: 1.4, alpha: 0.6, add: true });
        },
      },
      at,
    );
  }
  const endAt = 0.08 + (n - 1) * stagger + fly;
  const firstHit = 0.08 + fly;
  // 收款方：第一枚到达开始“吃金币”抖动，最后一枚到达时弹一下 + 绿字
  tl.to(tb.body.scale, { x: 1.08, y: 1.08, duration: 0.05, yoyo: true, repeat: Math.max(1, Math.floor((endAt - firstHit) / 0.1)) }, firstHit);
  tl.call(() => {
    popText(ctx, fx, B.x, B.y - 0.65 * u, `+${amount}T`, C.success, fs, 0.35, 0.6);
    particles.burst(fx, B.x, B.y, { count: 10, kind: 'spark', colors: [C.gold, C.success, 0xffffff], dist: 0.9 * u, size: 0.24 * u, duration: 0.45 });
    hudPing(ctx, toId, '#2EE59D', `+${amount}`);
    if (amount >= 300) ctx.shake(150, 4);
  }, [], endAt);
  tl.to(tb.body.scale, { x: 1.2, y: 1.2, duration: 0.06 }, endAt);
  tl.to(tb.body.scale, { x: 1, y: 1, duration: 0.22, ease: 'back.out(3)' }, endAt + 0.06);
  await rt.play(tl);
  ta.body.x = 0;
  tb.body.scale.set(1);
}

/** 护盾：付款方升起蓝色六边形防火墙 → 收款方射来的金币撞上护盾碎成蓝色碎片 → "防火墙生效！" */
async function playShielded(ctx: FxContext, A: { x: number; y: number }, B: { x: number; y: number }, amount: number, n: number, fs: number): Promise<void> {
  const { board, rt, particles } = ctx;
  const u = board.u;
  const fx = board.layers.fx;
  const R = 0.8 * u;
  const tl = gsap.timeline();
  const shield = particles.hold(fx, 'hex', R * 2.1, 0x5fd4ff, true);
  shield.position.set(A.x, A.y);
  shield.zIndex = 3600;
  const s0 = shield.scale.x;
  tl.fromTo(shield.scale, { x: 0, y: 0 }, { x: s0, y: s0, duration: 0.22, ease: 'back.out(2.5)' }, 0);
  tl.fromTo(shield, { alpha: 0 }, { alpha: 1, duration: 0.1 }, 0);
  const dx = A.x - B.x, dy = A.y - B.y;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const hit = { x: A.x - (dx / dist) * R * 0.95, y: A.y - (dy / dist) * R * 0.95 };
  const lift = Math.min(2 * u, dist * 0.25 + 0.4 * u);
  const cnt = Math.min(n, 10);
  const stagger = 0.03;
  for (let i = 0; i < cnt; i++) {
    const coin = particles.hold(fx, 'coin', 0.36 * u);
    coin.position.set(B.x, B.y);
    coin.alpha = 0;
    coin.zIndex = 3500;
    const base = coin.scale.x;
    const p = { k: 0 };
    const at = 0.12 + i * stagger;
    tl.set(coin, { alpha: 1 }, at);
    tl.to(
      p,
      {
        k: 1,
        duration: 0.34,
        ease: 'power1.in',
        onUpdate: () => {
          const k = p.k;
          coin.position.set(B.x + (hit.x - B.x) * k, B.y + (hit.y - B.y) * k - Math.sin(Math.PI * k) * lift);
          coin.scale.x = base * (0.25 + 0.75 * Math.abs(Math.cos(k * 8 + i)));
        },
        onComplete: () => {
          const x = coin.x, y = coin.y;
          particles.release(coin);
          particles.burst(fx, x, y, { count: 5, kind: 'chip', colors: [0x5fd4ff, 0xffffff, C.gold], dist: 0.6 * u, size: 0.12 * u, duration: 0.4, angle: Math.atan2(B.y - A.y, B.x - A.x), spread: 1.8, add: true });
          particles.emit(fx, x, y, { kind: 'glow', color: 0x5fd4ff, size: 0.9 * u, life: 0.18, scaleTo: 1.3, alpha: 0.8, add: true });
          if (rt.skipping) return;
          gsap.fromTo(shield.scale, { x: s0 * 1.08, y: s0 * 1.08 }, { x: s0, y: s0, duration: 0.12 });
        },
      },
      at,
    );
  }
  const endAt = 0.12 + (cnt - 1) * stagger + 0.34;
  tl.call(() => {
    popText(ctx, fx, A.x, A.y - 1.15 * u, '防火墙生效！', 0x5fd4ff, fs * 0.85, 0.4, 0.4);
    particles.burst(fx, A.x, A.y, { count: 12, kind: 'spark', colors: [0x5fd4ff, 0xffffff], dist: 1.2 * u, size: 0.24 * u, duration: 0.45 });
  }, [], endAt - 0.05);
  tl.to(shield, { alpha: 0, duration: 0.22, onComplete: () => particles.release(shield) }, endAt + 0.1);
  tl.to(shield.scale, { x: s0 * 1.3, y: s0 * 1.3, duration: 0.22 }, endAt + 0.1);
  void amount;
  await rt.play(tl);
}

/** 余额变化浮字（棋子上方）+ 玩家条头像光环，不长时间阻塞事件队列 */
export async function playMoney(ctx: FxContext, playerId: string, delta: number, _reason: string): Promise<void> {
  const { board, particles, rt } = ctx;
  const t = board.tokenSprite(playerId);
  if (!t || !t.visible || delta === 0) return;
  const u = board.u;
  const fx = board.layers.fx;
  const pos = delta > 0;
  popText(ctx, fx, t.x, t.y - 0.6 * u, `${pos ? '+' : ''}${delta}T`, pos ? C.success : C.danger, Math.max(16, 0.4 * u), 0.3, 0.6);
  if (pos) particles.burst(fx, t.x, t.y - 0.3 * u, { count: 5, kind: 'spark', colors: [C.success, 0xffffff, C.gold], dist: 0.6 * u, size: 0.2 * u, duration: 0.4 });
  hudPing(ctx, playerId, pos ? '#2EE59D' : '#FF4D6D');
  await rt.wait(200);
}
