// 全屏卡牌：径向暗化 + 旋转光芒背景 → 卡背从中心放大飞出 → 3D Y 轴翻转（翻转瞬间星芒 + 闪光）→
// 正面（热搜=品红 / 突发=橙红，卡边流光）标题逐字弹跳、图标发光脉动 → 点击或 2.5s 后缩小飞向玩家。
import gsap from 'gsap';
import type { Card } from '@dafuweng/shared';
import { escapeHtml } from '../util';
import type { FxContext } from './context';
import { htmlFx, isMobile, starBurst } from './kit';

const DECK_NAME = { chance: '热搜', fate: '突发' } as const;
const DECK_ICON = { chance: 'cells/chance', fate: 'cells/fate' } as const;

export async function playCard(ctx: FxContext, card: Card, iconUrl: (key: string) => string, targetPlayerId?: string): Promise<void> {
  const { rt, board } = ctx;
  const deck = card.deck === 'chance' ? 'chance' : 'fate';
  const back = htmlFx(ctx, `fx2-card-back fx2-card--${deck}${isMobile() ? '' : ' blur'}`);
  const title = [...card.title].map((ch) => `<span>${escapeHtml(ch)}</span>`).join('');
  back.el.innerHTML = `
    <div class="fx2-card-rays"></div>
    <div class="fx2-card">
      <div class="fx2-card-face fx2-card-rear"><div class="fx2-card-inner"><img src="${iconUrl(DECK_ICON[deck])}" alt=""><span>${DECK_NAME[deck]}</span></div></div>
      <div class="fx2-card-face fx2-card-front"><div class="fx2-card-inner">
        <div class="fx2-card-deck">${DECK_NAME[deck]}</div>
        <div class="fx2-card-iconwrap"><img src="${iconUrl(DECK_ICON[deck])}" alt=""></div>
        <div class="fx2-card-title">${title}</div>
        <div class="fx2-card-text">${escapeHtml(card.text)}</div>
        <div class="fx2-card-hint">点击任意处继续</div>
      </div></div>
    </div>`;
  const el = back.el.querySelector('.fx2-card') as HTMLElement;
  const rays = back.el.querySelector('.fx2-card-rays') as HTMLElement;
  const spans = back.el.querySelectorAll('.fx2-card-title span');
  const text = back.el.querySelector('.fx2-card-text') as HTMLElement;
  const hint = back.el.querySelector('.fx2-card-hint') as HTMLElement;

  // 点击卡牌：只关闭卡牌，不触发事件队列的“全部快进”（window 捕获阶段先于 document 捕获阶段）
  let close: (() => void) | null = null;
  const onDown = (e: Event) => {
    if (!back.el.isConnected || !back.el.contains(e.target as Node)) return;
    e.stopPropagation();
    close?.();
  };
  window.addEventListener('pointerdown', onDown, true);
  const unListen = rt.onSkip(() => window.removeEventListener('pointerdown', onDown, true));

  const tl = gsap.timeline();
  tl.fromTo(back.el, { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0);
  tl.fromTo(rays, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 0.55, duration: 0.5, ease: 'power2.out' }, 0);
  tl.fromTo(el, { scale: 0.12, rotationY: 180, rotation: -14, y: 30 }, { scale: 1.06, rotation: 0, y: 0, duration: 0.3, ease: 'power3.out' }, 0);
  tl.to(el, { rotationY: 0, scale: 1, duration: 0.3, ease: 'back.out(1.6)' }, 0.28);
  tl.call(() => {
    const r = el.getBoundingClientRect();
    starBurst(ctx, r.left + r.width / 2, r.top + r.height / 2, 16, r.width * 0.8, deck === 'fate');
  }, [], 0.38);
  tl.fromTo(spans, { opacity: 0, y: -18, scale: 0.2 }, { opacity: 1, y: 0, scale: 1, duration: 0.22, ease: 'back.out(3)', stagger: Math.min(0.045, 0.3 / Math.max(1, spans.length)) }, 0.48);
  tl.fromTo(text, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.25 }, 0.6);
  tl.fromTo(hint, { opacity: 0 }, { opacity: 1, duration: 0.2 }, 0.8);
  await rt.play(tl);
  await rt.until((done) => (close = done), 2500);
  close = null;
  // 缩小飞向玩家
  let tx = window.innerWidth / 2, ty = window.innerHeight;
  if (targetPlayerId) {
    const t = board.tokenSprite(targetPlayerId);
    if (t && t.visible) ({ x: tx, y: ty } = board.worldToScreen(t.position));
  }
  const r = el.getBoundingClientRect();
  const tl2 = gsap.timeline();
  tl2.to(el, { x: tx - (r.left + r.width / 2), y: ty - (r.top + r.height / 2), scale: 0.08, rotation: 25, opacity: 0.2, duration: 0.3, ease: 'power2.in' }, 0);
  tl2.to(back.el, { opacity: 0, duration: 0.28 }, 0.02);
  await rt.play(tl2);
  window.removeEventListener('pointerdown', onDown, true);
  unListen();
  back.done();
}
