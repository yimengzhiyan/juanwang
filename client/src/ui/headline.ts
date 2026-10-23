// 头条弹窗（报纸风）+ 突发"号外"条幅 + 事件效果文案。
import gsap from 'gsap';
import { DIFFICULTY, type EventEffect, type HeadlineDef, type SurpriseDef } from '@juanwang/shared';
import { esc, FACTION_NAME, SLOT_NAME, synName } from './cards';
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
      const t = e.target === 'item' ? '装备' : e.target === 'all' ? '商品' : '单位';
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
      return `失去 ${DIFFICULTY.lifeTradeHp} 热度，换 +${e.amount} 算力和免费刷新`;
    case 'enemyBuff':
      return `本场敌方全体 ${stat(e.atk, e.hp)}`;
    case 'firstStrike':
      return e.side === 'me' ? '本场我方先手' : '本场敌方先手';
    case 'swapFronts':
      return '开战时双方前排互换阵营';
    case 'battleStatMul': {
      const who = e.side === 'me' ? '我方' : e.side === 'enemy' ? '敌方' : '双方';
      const parts: string[] = [];
      if (e.atk && e.atk !== 1) parts.push(`攻 ×${e.atk}`);
      if (e.hp && e.hp !== 1) parts.push(`血 ×${e.hp}`);
      return `本场${who}${parts.join(' ') || '属性不变'}`;
    }
    case 'addEnemyBoss':
      return `敌方多一个 ${e.atk}/${e.hp} Boss，赢了对手掉血 ×${e.rewardMul}`;
    case 'goldenEquips':
      return '本场我方装备全部按金色生效';
    case 'summonBuff':
      return `本场召唤物 ${stat(e.atk, e.hp)}`;
    case 'damageOpponent':
      return `${e.target === 'leader' ? '热度最高的对手' : '随机一名对手'}立即 -${e.amount} 热度`;
    case 'stealEnemy':
      return '开战时挖走一名敌人';
    case 'selfHpLoss':
      return `立即失去 ${e.amount} 热度`;
    case 'battleSummon':
      return `开战时${e.side === 'me' ? '我方' : '敌方'}召唤 ${e.count} 个单位`;
    case 'synergyBonus':
      return `本回合 ${synName(e.key)} 羁绊人数 +${e.amount}`;
    case 'wager':
      return `对赌：赢了下回合 +${e.winGold} 算力，输了多掉 ${e.loseHp} 热度`;
    case 'benchEnemy':
      return '开战时请一名敌人下场';
    case 'freeEquip':
      return `商店送一件免费${e.gold ? '金色' : ''}${e.slot ? SLOT_NAME[e.slot] : '装备'}`;
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
