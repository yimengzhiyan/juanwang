// 结算页（覆盖在战斗页上，ART 9.8）：胜负 + 扣血动画 + 战后总结卡（MVP、伤害条、一句话归因、本场羁绊档位）+ 对手台词 +
// 其余对局 + 淘汰横幅 + PVE 三选一奖励 + 继续。
import gsap from 'gsap';
import { START_HP, pveForTurn, type BattleResult, type Level, type RunState, type Side } from '@juanwang/shared';
import { app, act, go } from '../store';
import { artUrl, avatarUrl, isPhotoAvatar, ui } from '../assets';
import { esc, hpColor, synergyChip } from '../ui/cards';
import { extraBanner } from '../ui/headline';
import { remainingBanner, type LobbyView } from '../ui/lobby';
import { pveRewardModal } from '../ui/pve';
import { toast } from '../ui/toast';
import { sfx } from '../fx/sound';
import { pendingExtra } from './game';

export interface UnitInfo {
  defId: string;
  level: Level;
  side: Side;
}
export interface ResultCtx {
  result: BattleResult;
  before: RunState;
  after: RunState;
  units: Map<string, UnitInfo>;
  lobby?: LobbyView;
}

/** 本场我方永久成长合计（BattleResult.permanentBuffs；缺省时按 buff 事件 permanent 统计我方） */
function growHtml(result: BattleResult): string {
  let atk = 0;
  let hp = 0;
  let n = 0;
  if (result.permanentBuffs?.length) {
    for (const b of result.permanentBuffs) {
      atk += b.atk;
      hp += b.hp;
      n++;
    }
  } else {
    for (const e of result.events) {
      if (e.type !== 'buff' || !e.permanent || e.unit.side !== 'me') continue;
      atk += e.atk;
      hp += e.hp;
      n++;
    }
  }
  if (!n || (atk <= 0 && hp <= 0)) return '';
  const v = atk && hp ? `+${atk}/+${hp}` : atk ? `+${atk} 攻` : `+${hp} 血`;
  return `<div class="sum-grow"><img src="${ui('star')}" alt="">本场永久成长 <b>${v}</b><small>${n} 次 · 已写回队伍</small></div>`;
}

/** 调试/自动化：结算页的 PVE 奖励选择 */
export const resultCtl = { pick: (_i: number): void => {} };

export function showResult(host: HTMLElement, c: ResultCtx): void {
  const data = app.data;
  const { result, before, after } = c;
  const sum = result.summary;
  const mu = before.matchup;
  const pve = mu?.kind === 'pve';
  const pv = pve ? pveForTurn(before.turn, data) : undefined;
  const opp = mu && !pve ? before.opponents.find((o) => o.id === mu.opponentId) : undefined;
  const oppAfter = opp ? after.opponents.find((o) => o.id === opp.id) : undefined;
  const mask = document.createElement('div');
  mask.className = 'result-mask';
  const w = result.winner;
  const title = w === 'me' ? (pve ? '击退怪物！' : '胜利！') : w === 'enemy' ? (pve ? '没打过' : '惜败') : '平局';
  const over = after.phase === 'over';
  const myLoss = after.lastEvents.find((e) => e.type === 'hpLoss' && e.who === 'me');
  const oppLoss = opp ? after.lastEvents.find((e) => e.type === 'hpLoss' && e.who === opp.id) : undefined;
  // MVP 与伤害条（我方）
  const mine = [...c.units.entries()].filter(([uid, u]) => u.side === 'me' || !uid.startsWith('e_'));
  const dmg = mine.map(([uid, u]) => ({ uid, ...u, d: sum.damageByUid[uid] ?? 0 })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
  const maxD = Math.max(1, ...dmg.map((x) => x.d));
  const mvp = sum.mvpUid ? c.units.get(sum.mvpUid) : undefined;
  const mvpDef = mvp ? data.unitsById[mvp.defId] : sum.mvpDefId ? data.unitsById[sum.mvpDefId] : undefined;
  const mvpDmg = sum.mvpUid ? sum.damageByUid[sum.mvpUid] ?? 0 : 0;
  const preset = opp?.presetId ? data.opponents.find((p) => p.id === opp.presetId) : undefined;
  const taunt = w === 'enemy' ? preset?.taunt?.victory : w === 'me' ? preset?.taunt?.defeated : undefined;
  const others = after.lastEvents.filter((e) => e.type === 'hpLoss' && e.who !== 'me' && e.who !== opp?.id);
  const hpRow = (label: string, avatar: string, hp0: number, hp1: number, loss?: number): string => `
    <div class="rs-hp">
      ${avatar}
      <span class="rs-hp-name">${label}</span>
      <span class="lb-bar wide"><i data-from="${(Math.min(START_HP, Math.max(0, hp0)) / START_HP) * 100}" data-to="${(Math.min(START_HP, Math.max(0, hp1)) / START_HP) * 100}" style="width:${(Math.min(START_HP, Math.max(0, hp0)) / START_HP) * 100}%;background:${hpColor(hp1)}"></i></span>
      <b class="rs-hp-num">${Math.max(0, hp1)}</b>${loss ? `<em class="rs-hp-loss">-${loss}</em>` : ''}
    </div>`;
  const myAva = '<span class="lb-ava lb-ava--me sm">你</span>';
  const oppAva = opp?.avatar ? `<span class="lb-ava sm"><img src="${artUrl(opp.avatar)}" alt=""></span>` : `<span class="lb-ava lb-ava--txt sm">${esc(Array.from(mu?.name ?? '?')[0] ?? '?')}</span>`;
  mask.innerHTML = `
    <div class="result panel panel--paper result--${w}">
      <div class="result-title">${title}</div>
      <div class="result-sub">${pve ? `PVE · ${esc(mu?.name ?? '')} · 不扣热度` : mu ? `对手：<b>${esc(mu.name)}</b>${mu.isHuman ? ' <span class="chip chip--xs">真人</span>' : ''}` : ''}</div>
      ${!pve ? `<div class="rs-hps">${opp ? hpRow(esc(mu!.name), oppAva, opp.hp, oppAfter?.hp ?? opp.hp, oppLoss?.type === 'hpLoss' ? oppLoss.amount : 0) : ''}${hpRow('你', myAva, before.hp, after.hp, myLoss?.type === 'hpLoss' ? myLoss.amount : 0)}</div>` : ''}
      <div class="sum-card">
        ${mvpDef ? `<div class="sum-mvp">
          <span class="sum-ava"><img class="${isPhotoAvatar(mvpDef) ? 'is-photo' : ''}" src="${avatarUrl(mvpDef)}" alt=""><b class="sum-mvp-tag">MVP</b></span>
          <div class="sum-mvp-info"><b>${mvp && mvp.level > 1 ? `Lv${mvp.level} ` : ''}${esc(mvpDef.name)}</b><small>造成 ${mvpDmg} 伤害</small></div>
        </div>` : ''}
        ${growHtml(result)}
        ${sum.reason ? `<div class="sum-reason"><i>“</i>${esc(sum.reason)}<i>”</i></div>` : ''}
        ${dmg.length ? `<div class="sum-bars">${dmg
          .slice(0, 5)
          .map((x) => {
            const d = data.unitsById[x.defId];
            return `<div class="sum-bar"><span class="mini-ava tier-${d?.tier ?? 1}">${d ? `<img class="${isPhotoAvatar(d) ? 'is-photo' : ''}" src="${avatarUrl(d)}" alt="">` : ''}</span><span class="sum-bar-name">${x.level > 1 ? `<small>Lv${x.level}</small>` : ''}${esc(d?.name ?? '?')}</span><span class="sum-bar-track"><i style="--w:${(x.d / maxD) * 100}%"></i></span><b>${x.d}</b></div>`;
          })
          .join('')}</div>` : ''}
        <div class="sum-syn"></div>
      </div>
      ${taunt ? `<div class="result-taunt">${oppAva}<span>“${esc(taunt)}”</span></div>` : ''}
      ${others.length ? `<div class="result-others"><small>其余对局</small>${others.map((e) => (e.type === 'hpLoss' ? `<span>${esc(e.name)} <em>-${e.amount}</em></span>` : '')).join('')}</div>` : ''}
      <div class="result-extra"></div>
      <button class="btn btn--go btn--wide result-go">${over ? '查看结局' : '继续'}</button>
    </div>`;
  const synEl = mask.querySelector('.sum-syn') as HTMLElement;
  for (const st of sum.synergyTiers) synEl.appendChild(synergyChip(st));
  if (!sum.synergyTiers.length) synEl.remove();
  if (after.lastSurprise && after.surprisePending) {
    (mask.querySelector('.result-extra') as HTMLElement).appendChild(extraBanner(after.lastSurprise, true));
  }
  host.appendChild(mask);
  const card = mask.querySelector('.result') as HTMLElement;
  const goBtn = mask.querySelector('.result-go') as HTMLButtonElement;
  gsap.fromTo(mask, { opacity: 0 }, { opacity: 1, duration: 0.2 });
  gsap.fromTo(card, { y: 60, scale: 0.9 }, { y: 0, scale: 1, rotate: -1, duration: 0.35, ease: 'back.out(2)' });
  // 扣血动画：血条缩短 + 数字闪红
  mask.querySelectorAll<HTMLElement>('.rs-hp .lb-bar i').forEach((bar) => {
    const from = Number(bar.dataset.from);
    const to = Number(bar.dataset.to);
    if (to < from) gsap.fromTo(bar, { width: `${from}%` }, { width: `${to}%`, duration: 0.5, delay: 0.45, ease: 'power2.out' });
  });
  mask.querySelectorAll<HTMLElement>('.rs-hp-loss').forEach((e) => gsap.fromTo(e, { scale: 0, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, delay: 0.5, ease: 'back.out(3)' }));
  gsap.fromTo(mask.querySelectorAll('.sum-bar-track i'), { width: 0 }, { width: (_i, t: HTMLElement) => t.style.getPropertyValue('--w'), duration: 0.45, stagger: 0.06, delay: 0.3, ease: 'power2.out' });
  const ex = mask.querySelector('.extra');
  if (ex) gsap.fromTo(ex, { x: -40, opacity: 0, rotate: -3 }, { x: 0, opacity: 1, rotate: -1, duration: 0.4, delay: 0.35, ease: 'back.out(2)' });

  // 淘汰横幅（"还剩 N 人"）
  const elim = after.lastEvents.filter((e) => e.type === 'eliminated' && e.who !== 'me');
  if (elim.length) {
    gsap.delayedCall(1.3, () => {
      sfx.eliminated();
      void remainingBanner(host, after.lastEvents, after, data);
    });
  }

  // PVE 三选一
  let pending = !!after.pending;
  const openReward = (): void => {
    const s = app.run!;
    if (!s.pending) return;
    pveRewardModal(data, pv, s.pending.options, (i) => pickReward(i));
  };
  const pickReward = (i: number): void => {
    const n = act({ type: 'choosePveReward', index: i });
    if (n.error) {
      toast(n.error);
      return;
    }
    pending = false;
    const opt = after.pending?.options[i];
    toast(opt?.type === 'gold' ? `下回合 +${opt.amount} 算力` : '奖励已放进下回合商店（免费、冻结）', 'good', 2200);
    goBtn.textContent = over ? '查看结局' : '继续';
  };
  resultCtl.pick = pickReward;
  if (pending) {
    goBtn.textContent = '选择奖励';
    gsap.delayedCall(0.9, () => {
      if (pending && document.body.contains(mask)) openReward();
    });
  }

  goBtn.onclick = () => {
    sfx.click();
    if (pending) {
      openReward();
      return;
    }
    if (over || app.run?.phase === 'over') {
      go('over');
      return;
    }
    if (after.lastSurprise && after.surprisePending) pendingExtra.s = after.lastSurprise;
    const n = act({ type: 'continue' });
    if (n.error) {
      toast(n.error);
      return;
    }
    go('game');
  };
}
