// 骰子（ART 6 #1）：两颗 CSS 3D 骰子从棋盘下方抛入 → 翻滚 → 落地弹两次 → 落定放大回弹 + 青色冲击环 + 轻震；
// 头顶弹出霓虹点数；双骰金色 "DOUBLE!" 横幅扫过 + 星芒爆开；火箭追加带火焰尾迹的 "+6"；乌龟隐藏第二颗骰子换成乌龟图标。
// 阻塞时长 1.1s（淡出不阻塞）。皮肤 h100 / furnace / mahjong / vram 的配色在 style.ts 的 .fx2-skin-*。
import gsap from 'gsap';
import { assetUrl } from '../assets';
import { C } from '../theme';
import type { FxContext } from './context';
import { htmlFx, starBurst, toLocal } from './kit';

const PIPS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[25, 25], [50, 50], [75, 75]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
};

/** 让某点数朝向观众的 [rotateX, rotateY] */
const FACE_ROT: Record<number, [number, number]> = { 1: [0, 0], 6: [0, 180], 3: [0, -90], 4: [0, 90], 2: [-90, 0], 5: [90, 0] };

const SKIN_GLOW: Record<string, number> = { h100: 0x9bf03a, furnace: 0xff9a3c, mahjong: 0xffffff, vram: 0x22e5ff };
const SKINS = new Set(['h100', 'furnace', 'mahjong', 'vram']);

export interface DiceOpts {
  rocket?: boolean;
  turtle?: boolean;
  doubles?: boolean;
}

function makeDie(skin: string, turtle: boolean): { wrap: HTMLElement; cube: HTMLElement; shadow: HTMLElement } {
  const wrap = document.createElement('div');
  wrap.className = `fx2-die fx2-skin-${skin}${turtle ? ' fx2-turtle' : ''}`;
  const cube = document.createElement('div');
  cube.className = 'fx2-cube';
  cube.innerHTML =
    [1, 6, 3, 4, 2, 5].map((n) => `<div class="fx2-face fx2-f${n}">${PIPS[n].map(([x, y]) => `<i style="left:${x}%;top:${y}%"></i>`).join('')}</div>`).join('');
  wrap.append(cube);
  const shadow = document.createElement('div');
  shadow.className = 'fx2-dshadow';
  return { wrap, cube, shadow };
}

// 关键时刻（秒，相对每颗骰子自身的起点）
const T1 = 0.4; // 第一次落地
const T2 = 0.62; // 第二次落地
const T3 = 0.78; // 落定
const TOTAL_AT = 0.84;
const BLOCK = 1.05;

export async function playDice(ctx: FxContext, a: number, b: number, skinIn: string, opts: DiceOpts = {}): Promise<void> {
  const { rt, board, particles } = ctx;
  const skin = SKINS.has(skinIn) ? skinIn : 'h100';
  const turtle = !!opts.turtle || b <= 0;
  const center = board.worldToScreen(board.boardCenter());
  const size = Math.round(Math.max(50, Math.min(88, board.size * 0.125)));
  const groundY = size * 0.45;
  const stage = htmlFx(ctx, 'fx2-dice');
  stage.el.style.left = center.x + 'px';
  stage.el.style.top = center.y + 'px';
  stage.el.style.setProperty('--die', size + 'px');

  const plate = document.createElement('div');
  plate.className = 'fx2-dice-plate';
  stage.el.append(plate);
  const values = turtle ? [Math.max(1, a || 1)] : [a, b];
  const dice = values.map(() => makeDie(skin, turtle));
  for (const d of dice) stage.el.append(d.shadow);
  for (const d of dice) stage.el.append(d.wrap);
  const glow = turtle ? C.success : SKIN_GLOW[skin] ?? C.primary;

  const throwH = Math.min(board.size * 0.42, 280);
  const st = dice.map((_, i) => {
    const xf = turtle ? -size * 0.62 : (i === 0 ? -1 : 1) * size * 0.72;
    const side = i === 0 ? -1 : 1;
    const [rxT, ryT] = FACE_ROT[values[i]] ?? [0, 0];
    const spinsX = 2 + i, spinsY = 1 + ((i + 1) % 2);
    return {
      delay: i * 0.05,
      xf,
      x0: xf + side * size * 2.3,
      y0: throwH,
      H: throwH * 0.5 + size * 0.8,
      rxT: rxT + 360 * spinsX * (i % 2 ? -1 : 1),
      ryT: ryT + 360 * spinsY * (i % 2 ? 1 : -1),
      rz0: (Math.random() - 0.5) * 540,
      lastEmit: -1,
    };
  });

  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
  const bump = (d: number, w: number) => (d >= 0 && d < w ? Math.sin((Math.PI * d) / w) : 0);
  const fx = board.layers.fx;

  const render = (t: number) => {
    dice.forEach((d, i) => {
      const s = st[i];
      const ti = t - s.delay;
      if (ti < 0) {
        d.wrap.style.opacity = '0';
        d.shadow.style.opacity = '0';
        return;
      }
      let y: number;
      if (ti < T1) {
        const k = ti / T1;
        y = s.y0 * (1 - k) - s.H * 4 * k * (1 - k);
      } else if (ti < T2) {
        const k = (ti - T1) / (T2 - T1);
        y = -size * 0.9 * 4 * k * (1 - k);
      } else if (ti < T3) {
        const k = (ti - T2) / (T3 - T2);
        y = -size * 0.32 * 4 * k * (1 - k);
      } else y = 0;
      const kx = clamp01(ti / T3);
      const x = s.x0 + (s.xf - s.x0) * (1 - Math.pow(1 - kx, 2));
      const r = 1 - Math.pow(1 - clamp01(ti / (T3 + 0.04)), 3);
      const rx = s.rxT * r;
      const ry = s.ryT * r;
      const rz = s.rz0 * (1 - r);
      const sq = bump(ti - T1, 0.08) * 0.16 + bump(ti - T2, 0.07) * 0.1 + bump(ti - T3, 0.06) * 0.06;
      const sy = 1 - sq, sx = 1 + sq * 0.8;
      const ent = Math.min(1, 0.45 + (ti / 0.12) * 0.55);
      const pop = ti > T3 ? 1 + 0.25 * Math.sin(Math.PI * clamp01((ti - T3) / 0.2)) * (ti - T3 < 0.1 ? 1 : Math.max(0, 1 - (ti - T3 - 0.1) / 0.1)) : 1;
      const sc = ent * pop;
      const yy = groundY + y + (size * (1 - sy)) / 2;
      d.wrap.style.opacity = '1';
      d.wrap.style.transform = `translate(${x}px, ${yy}px) scale(${sx * sc}, ${sy * sc})`;
      d.cube.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg) rotateZ(${rz}deg)`;
      const hk = Math.max(0.25, 1 - -y / (size * 3));
      d.shadow.style.opacity = String(0.75 * hk);
      d.shadow.style.transform = `translate(${x}px, ${groundY + size * 0.5}px) scale(${hk})`;
      // 抛入阶段的拖影（Pixi，画在骰子后面）
      if (ti < T1 && ti - s.lastEmit > 0.016 && !rt.skipping) {
        s.lastEmit = ti;
        const p = toLocal(ctx, { x: center.x + x, y: center.y + yy });
        particles.emit(fx, p.x, p.y, { kind: 'dot', color: glow, size: size * 0.9, life: 0.22, scaleTo: 0.3, alpha: 0.45, add: true });
      }
    });
  };

  const groundLocal = (i: number) => toLocal(ctx, { x: center.x + st[i].xf, y: center.y + groundY + size * 0.45 });
  const dust = (n: number) => {
    dice.forEach((_, i) => {
      const p = groundLocal(i);
      particles.burst(fx, p.x, p.y, { count: n, kind: 'dot', colors: [0xc9c3ff, 0xffffff], size: size * 0.28, dist: size * 0.7, duration: 0.4, angle: -Math.PI / 2, spread: 2.6, scaleTo: 1.4, alpha: 0.7, add: false });
    });
  };

  const proxy = { t: 0 };
  const tl = gsap.timeline();
  tl.to(proxy, { t: BLOCK, duration: BLOCK, ease: 'none', onUpdate: () => render(proxy.t) }, 0);
  tl.fromTo(plate, { opacity: 0, scale: 0.6 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out' }, 0);
  const avgDelay = (st.length - 1) * 0.025;
  tl.call(() => { dust(8); ctx.shake(80, 3); }, [], T1 + avgDelay);
  tl.call(() => { dust(4); ctx.shake(60, 2); }, [], T2 + avgDelay);
  tl.call(() => {
    ctx.shake(120, 4);
    if (rt.skipping) return;
    const mid = toLocal(ctx, { x: center.x + (turtle ? 0 : 0), y: center.y + groundY + size * 0.3 });
    for (let k = 0; k < 2; k++) {
      const ring = particles.hold(fx, 'ring', size * 0.8, C.primary, true);
      ring.position.set(mid.x, mid.y);
      ring.scale.y *= 0.45;
      const sx = ring.scale.x, sy = ring.scale.y;
      rt.fire(gsap.timeline({ onComplete: () => particles.release(ring) })
        .fromTo(ring.scale, { x: sx * 0.6, y: sy * 0.6 }, { x: sx * (4 + k * 1.5), y: sy * (4 + k * 1.5), duration: 0.45 + k * 0.1, ease: 'power2.out' }, k * 0.06)
        .fromTo(ring, { alpha: 1 }, { alpha: 0, duration: 0.45 + k * 0.1, ease: 'power1.in' }, k * 0.06));
    }
    particles.burst(fx, mid.x, mid.y, { count: 12, kind: 'spark', colors: [C.primary, 0xffffff, glow], size: size * 0.22, dist: size * 1.6, duration: 0.45 });
  }, [], T3 + avgDelay + 0.01);

  // 点数大字
  const total = (turtle ? values[0] : a + b) + (opts.rocket ? 6 : 0);
  const num = document.createElement('div');
  num.className = 'fx2-total';
  num.style.setProperty('--fs', Math.round(size * 1.1) + 'px');
  if (turtle) num.innerHTML = `<span>${values[0]}</span><small>限流中</small>`;
  else if (opts.rocket) num.innerHTML = `<span>${a + b}</span><span class="fx2-rocket">+6</span><span class="eq">=${total}</span>`;
  else num.innerHTML = `<span>${total}</span>`;
  num.style.opacity = '0';
  stage.el.append(num);
  const numY = -size * 1.05;
  tl.fromTo(num, { x: 0, y: numY + 20, xPercent: -50, yPercent: -50, scale: 0.2, opacity: 0 }, { y: numY, scale: 1, opacity: 1, duration: 0.24, ease: 'back.out(2.6)' }, TOTAL_AT);
  if (opts.rocket && !turtle) {
    const r = num.querySelector('.fx2-rocket') as HTMLElement;
    const eq = num.querySelector('.eq') as HTMLElement;
    tl.fromTo(r, { x: size * 2.2, opacity: 0 }, { x: 0, opacity: 1, duration: 0.2, ease: 'power3.out' }, TOTAL_AT + 0.04);
    tl.fromTo(eq, { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, duration: 0.14, ease: 'back.out(3)' }, TOTAL_AT + 0.2);
    tl.call(() => {
      if (rt.skipping) return;
      const rr = r.getBoundingClientRect();
      const p = toLocal(ctx, { x: rr.left + rr.width * 0.3, y: rr.top + rr.height * 0.5 });
      particles.burst(fx, p.x, p.y, { count: 14, kind: 'spark', colors: [0xff9a3c, C.gold, 0xff5b1f, 0xffffff], size: size * 0.2, dist: size * 1.1, duration: 0.45, angle: 0, spread: 1.4 });
    }, [], TOTAL_AT + 0.2);
  }
  // 乌龟：第二颗骰子的位置换成乌龟图标，从上方掉下来摇摆
  if (turtle) {
    const img = document.createElement('img');
    img.className = 'fx2-turtleicon';
    img.src = assetUrl('items/turtle');
    img.alt = '';
    stage.el.append(img);
    const tx = size * 0.72;
    gsap.set(img, { x: tx, y: -size * 3, opacity: 0, rotation: -30 });
    tl.to(img, { opacity: 1, duration: 0.08 }, 0.22);
    tl.to(img, { y: groundY, duration: 0.3, ease: 'bounce.out' }, 0.22);
    tl.to(img, { rotation: 12, duration: 0.12, yoyo: true, repeat: 3, ease: 'sine.inOut' }, 0.52);
    tl.to(img, { rotation: 0, duration: 0.1 }, 1.0);
  }
  // 双骰：金色横幅扫过 + 星芒爆开
  if (opts.doubles && !turtle) {
    const ban = document.createElement('div');
    ban.className = 'fx2-banner-wrap';
    ban.innerHTML = '<div class="fx2-banner fx2-banner--gold" style="--bfs:' + Math.round(size * 0.62) + 'px"><b>DOUBLE!</b><i class="shine"></i></div>';
    ban.style.left = -center.x + 'px';
    ban.style.width = window.innerWidth + 'px';
    ban.style.top = size * 1.55 + 'px';
    stage.el.append(ban);
    const bb = ban.firstElementChild as HTMLElement;
    const shine = ban.querySelector('.shine') as HTMLElement;
    tl.fromTo(bb, { x: -window.innerWidth * 0.7, opacity: 0, scaleY: 0.4, skewX: -24 }, { x: 0, opacity: 1, scaleY: 1, skewX: -12, duration: 0.2, ease: 'power3.out' }, TOTAL_AT - 0.02);
    tl.fromTo(shine, { left: '-40%' }, { left: '120%', duration: 0.35, ease: 'power1.inOut' }, TOTAL_AT + 0.12);
    tl.call(() => {
      const c = board.boardCenter();
      particles.burst(fx, c.x, c.y + groundY * 0.5, { count: 24, kind: 'spark', colors: [C.gold, C.goldLight, 0xffffff], size: size * 0.32, dist: board.size * 0.24, duration: 0.6 });
      starBurst(ctx, center.x, center.y + numY, 12, size * 2.2);
    }, [], TOTAL_AT);
  }
  await rt.play(tl);
  board.setDice(turtle ? values[0] : a, turtle ? 0 : b, opts.rocket ? ' +6' : '');
  if (rt.skipping) {
    stage.done();
    return;
  }
  // 淡出不阻塞（棋子已经可以开始走）
  rt.fire(gsap.to(stage.el, { opacity: 0, y: -10, duration: 0.3, delay: 0.25, onComplete: stage.done }));
}
