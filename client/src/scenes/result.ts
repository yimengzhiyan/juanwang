// 结算页（覆盖在战斗页上）：胜负、对手、永久加成汇总、下回合收益、突发号外、继续。
import gsap from 'gsap';
import type { BattleResult, RunState } from '@juanwang/shared';
import { app, act, go } from '../store';
import { esc, miniAvatar } from '../ui/cards';
import { extraBanner } from '../ui/headline';
import { sfx } from '../fx/sound';
import { ui } from '../assets';
import { pendingExtra } from './game';
import type { OpponentInfo } from '../store';

export interface ResultCtx {
  result: BattleResult;
  before: RunState;
  after: RunState;
  opp: OpponentInfo;
}

export function showResult(host: HTMLElement, c: ResultCtx): void {
  const data = app.data;
  const { result, before, after, opp } = c;
  const mask = document.createElement('div');
  mask.className = 'result-mask';
  const w = result.winner;
  const title = w === 'me' ? '胜利！' : w === 'enemy' ? '失败' : '平局';
  const sub =
    w === 'me'
      ? opp.real
        ? `你击败了 <b>${esc(opp.name)}</b> 的队伍`
        : `你击败了 ${esc(opp.name)}`
      : w === 'enemy'
        ? `${opp.real ? `<b>${esc(opp.name)}</b> 的队伍` : esc(opp.name)}赢了这一场`
        : '两边同归于尽，不加热搜也不掉信心';
  const dLives = after.lives - before.lives;
  const dTro = after.trophies - before.trophies;
  const buffs = result.permanentBuffs
    .map((pb) => {
      const u = before.team.find((x) => x?.uid === pb.uid);
      if (!u) return '';
      const d = data.unitsById[u.defId];
      return `<li>${miniAvatar(data, u.defId)}<span>${esc(d?.name ?? '')}</span><b>${pb.atk >= 0 ? '+' : ''}${pb.atk}/${pb.hp >= 0 ? '+' : ''}${pb.hp}</b><small>永久</small></li>`;
    })
    .filter(Boolean)
    .join('');
  const bonus: string[] = [];
  if (result.bonus.gold) bonus.push(`下回合 +${result.bonus.gold} 算力`);
  if (result.bonus.rerolls) bonus.push(`+${result.bonus.rerolls} 次免费刷新`);
  if (result.bonus.discount) bonus.push(`下回合单位 -${result.bonus.discount} 算力`);
  const over = after.phase === 'over';
  mask.innerHTML = `
    <div class="result panel panel--paper result--${w}">
      <div class="result-title">${title}</div>
      <div class="result-sub">${sub}</div>
      <div class="result-stats">
        <span class="rs"><img src="${ui('fire')}" alt="">${after.trophies}/10${dTro ? ` <em class="up">+${dTro}</em>` : ''}</span>
        <span class="rs"><img src="${ui('lives')}" alt="">${after.lives}${dLives ? ` <em class="down">${dLives}</em>` : ''}</span>
        <span class="rs">回合 ${before.turn}</span>
      </div>
      ${buffs ? `<div class="result-sec"><h4>本场永久成长</h4><ul class="result-buffs">${buffs}</ul></div>` : ''}
      ${bonus.length ? `<div class="result-sec"><h4>下回合收益</h4><p>${bonus.join(' · ')}</p></div>` : ''}
      <div class="result-extra"></div>
      <button class="btn btn--go btn--wide result-go">${over ? '查看结局' : '继续'}</button>
    </div>`;
  if (after.lastSurprise && after.surprisePending) {
    (mask.querySelector('.result-extra') as HTMLElement).appendChild(extraBanner(after.lastSurprise, true));
  }
  host.appendChild(mask);
  const card = mask.querySelector('.result') as HTMLElement;
  gsap.fromTo(mask, { opacity: 0 }, { opacity: 1, duration: 0.2 });
  gsap.fromTo(card, { y: 60, scale: 0.9 }, { y: 0, scale: 1, duration: 0.35, ease: 'back.out(2)' });
  const ex = mask.querySelector('.extra');
  if (ex) gsap.fromTo(ex, { x: -40, opacity: 0, rotate: -3 }, { x: 0, opacity: 1, rotate: -1, duration: 0.4, delay: 0.35, ease: 'back.out(2)' });
  (mask.querySelector('.result-go') as HTMLElement).onclick = () => {
    sfx.click();
    if (over) {
      go('over');
      return;
    }
    if (after.lastSurprise && after.surprisePending) pendingExtra.s = after.lastSurprise;
    act({ type: 'continue' });
    go('game');
  };
}
