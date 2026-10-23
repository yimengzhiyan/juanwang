// 头条弹窗（报纸风）+ 突发"号外"条幅 + 事件效果文案。
import gsap from 'gsap';
import type { EventEffect, HeadlineDef, SurpriseDef } from '@juanwang/shared';
import { esc, FACTION_NAME } from './cards';
import { sfx } from '../fx/sound';
import { reducedMotion } from '../fx/anims';

const sign = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);
function stat(atk: number, hp: number): string {
  if (atk === hp) return `${sign(atk)}/${sign(hp)}`;
  const parts: string[] = [];
  if (atk) parts.push(`${sign(atk)} 攻`);
  if (hp) parts.push(`${sign(hp)} 血`);
  return parts.join(' ');
}

export function effectText(e: EventEffect): string {
  switch (e.type) {
    case 'gold':
      return `立即 ${sign(e.amount)} 算力`;
    case 'priceMod': {
      const t = e.target === 'item' ? '基建' : e.target === 'all' ? '商品' : '单位';
      return `本回合${t}价格 ${sign(e.amount)}`;
    }
    case 'freeUnit':
      return `商店送 1 个免费${e.tier ? `T${e.tier} ` : ''}${e.faction ? FACTION_NAME[e.faction] : ''}单位`;
    case 'buffTeam':
      return `全队${e.permanent ? '永久' : '本回合'} ${stat(e.atk, e.hp)}`;
    case 'buffFaction':
      return `${FACTION_NAME[e.faction]}单位${e.permanent ? '永久' : '本回合'} ${stat(e.atk, e.hp)}`;
    case 'shopRerollFree':
      return '本回合刷新免费';
    case 'extraSlot':
      return `本回合商店多 ${e.amount} 格`;
    case 'shieldAll':
      return `全队获得 ${e.amount} 点护盾`;
    case 'swapAll':
      return '开战时队伍前后反转';
    case 'duplicate':
      return '复制一个随机单位到空位';
    case 'sacrifice':
      return `失去最低阶单位，+${e.amount} 算力`;
    case 'nextTurnGold':
      return `下回合 ${sign(e.amount)} 算力`;
    case 'enemyDebuff':
      return `本回合敌方全队 ${sign(-e.amount)} 攻`;
    case 'rerollShop':
      return '立即免费刷新商店';
    case 'levelUpRandom':
      return '随机一个单位进化 +1 级';
    case 'lifeTrade':
      return `失去 1 信心，换 +${e.amount} 算力和免费刷新`;
  }
}
export const effectsText = (list: EventEffect[]): string => list.map(effectText).join('，');

/** 头条弹窗：选中后回调 option，并播放退出动画 */
export function showHeadline(root: HTMLElement, h: HeadlineDef, onChoose: (opt: 0 | 1) => void): HTMLElement {
  const mask = document.createElement('div');
  mask.className = 'headline-mask';
  mask.innerHTML = `
    <div class="newspaper" data-tut="headline">
      <div class="np-stamp">头条</div>
      <div class="np-masthead">AI 圈日报 · 今日要闻</div>
      <div class="np-title">${esc(h.title)}</div>
      <div class="np-news">${esc(h.news)}</div>
      <div class="np-options"></div>
    </div>`;
  const opts = mask.querySelector('.np-options') as HTMLElement;
  const paper = mask.querySelector('.newspaper') as HTMLElement;
  let chosen = false;
  h.options.forEach((o, i) => {
    const b = document.createElement('button');
    b.className = `btn np-opt ${i === 0 ? 'btn--blue' : 'btn--purple'}`;
    b.dataset.opt = String(i);
    b.innerHTML = `<span class="np-label">${esc(o.label)}</span><span class="np-eff">${esc(effectsText(o.effects ?? [o.effect]))}</span>`;
    b.onclick = () => {
      if (chosen) return;
      chosen = true;
      sfx.click();
      gsap
        .timeline({
          onComplete: () => {
            mask.remove();
            onChoose(i as 0 | 1);
          },
        })
        .to(b, { scale: 0.94, duration: 0.08, yoyo: true, repeat: 1 })
        .to(paper, { y: 40, opacity: 0, duration: 0.25, ease: 'power2.in' })
        .to(mask, { opacity: 0, duration: 0.15 }, '-=0.1');
    };
    opts.appendChild(b);
  });
  root.appendChild(mask);
  sfx.headline();
  const rm = reducedMotion();
  const tl = gsap.timeline();
  tl.fromTo(mask, { backgroundColor: 'rgba(31,42,68,0)' }, { backgroundColor: 'rgba(31,42,68,0.45)', duration: 0.2 });
  if (rm) tl.fromTo(paper, { opacity: 0 }, { opacity: 1, duration: 0.15 }, 0);
  else tl.fromTo(paper, { yPercent: -120, rotate: -14 }, { yPercent: 0, rotate: -2, duration: 0.5, ease: 'back.out(1.6)' }, 0);
  tl.fromTo(mask.querySelector('.np-stamp'), { scale: 2.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.15, ease: 'power4.out' })
    .to(mask.querySelector('.np-stamp'), { x: 2, duration: 0.03, yoyo: true, repeat: 3 })
    .fromTo(opts.children, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, stagger: 0.06 }, '-=0.1');
  return mask;
}

/** 号外条幅（突发） */
export function extraBanner(s: SurpriseDef, pending: boolean): HTMLElement {
  const el = document.createElement('div');
  el.className = `extra ${s.good ? 'is-good' : 'is-bad'}`;
  el.innerHTML = `<span class="extra-tag">号外</span><div class="extra-body"><b>${esc(s.title)}</b> ${esc(s.news)}<em>${pending ? '下回合生效：' : '已生效：'}${esc(effectsText(s.effects ?? [s.effect]))}</em></div>`;
  return el;
}
