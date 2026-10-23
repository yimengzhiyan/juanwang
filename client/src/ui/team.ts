// 顶栏（热度血条 / 回合 / 商店阶 / 算力 / 静音）、羁绊条（8 条流派线）、我方 5 槽。
import {
  START_HP, computeSynergies, effectiveStats, shopMaxTier, stateBonus, teamTiers,
  type GameData, type RunState, type SynergyState, type UnitInst,
} from '@juanwang/shared';
import { ui } from '../assets';
import { settings } from '../store';
import { setMuted } from '../fx/sound';
import { hpColor, synergyChip, unitCard } from './cards';
import { isOnline } from '../net';

export function topbar(): HTMLElement {
  const el = document.createElement('header');
  el.className = 'topbar';
  el.innerHTML = `
    <div class="hud-chip hud-hp" data-hud="hp"><img src="${ui('lives')}" alt="热度"><div class="hud-hpbar"><i></i></div><b></b></div>
    <div class="hud-chip hud-turn" data-hud="turn"><small>回合</small><b></b></div>
    <div class="hud-chip hud-tier" data-hud="tier"><small>商店</small><b></b></div>
    <div class="hud-chip hud-gold" data-hud="gold"><img src="${ui('gold')}" alt="算力"><b></b></div>
    <button class="hud-mute" aria-label="静音"></button>`;
  const mute = el.querySelector('.hud-mute') as HTMLButtonElement;
  const syncMute = (): void => {
    mute.classList.toggle('is-muted', settings.muted);
    mute.innerHTML = settings.muted ? MUTED_SVG : SOUND_SVG;
  };
  mute.onclick = () => {
    setMuted(!settings.muted);
    syncMute();
  };
  syncMute();
  return el;
}

export const SOUND_SVG =
  '<svg viewBox="0 0 32 32" width="26" height="26"><path d="M5 12h5l7-6v20l-7-6H5z" fill="#fff" stroke="#3B2A1A" stroke-width="2.5" stroke-linejoin="round"/><path d="M21 11c2 2.5 2 7.5 0 10M24.5 8c4 4.5 4 11.5 0 16" fill="none" stroke="#3B2A1A" stroke-width="2.5" stroke-linecap="round"/></svg>';
export const MUTED_SVG =
  '<svg viewBox="0 0 32 32" width="26" height="26"><path d="M5 12h5l7-6v20l-7-6H5z" fill="#C9D3DE" stroke="#3B2A1A" stroke-width="2.5" stroke-linejoin="round"/><path d="M21 12l7 8M28 12l-7 8" stroke="#F25757" stroke-width="3" stroke-linecap="round"/></svg>';

export function setHpChip(el: HTMLElement, hp: number): void {
  const chip = el.matches('[data-hud=hp]') ? el : (el.querySelector('[data-hud=hp]') as HTMLElement);
  const v = Math.max(0, hp);
  const bar = chip.querySelector('.hud-hpbar i') as HTMLElement;
  bar.style.width = `${Math.round((Math.min(START_HP, v) / START_HP) * 100)}%`;
  bar.style.background = hpColor(v);
  (chip.querySelector('b') as HTMLElement).textContent = `${v}/${START_HP}`;
}

export function updateTopbar(el: HTMLElement, s: RunState, showGold = true): void {
  setHpChip(el, s.hp);
  (el.querySelector('[data-hud=turn] b') as HTMLElement).textContent = String(s.turn);
  (el.querySelector('[data-hud=tier] b') as HTMLElement).textContent = `T${shopMaxTier(s)}`;
  const g = el.querySelector('[data-hud=gold]') as HTMLElement;
  g.style.display = showGold ? '' : 'none';
  (el.querySelector('[data-hud=tier]') as HTMLElement).style.display = showGold ? '' : 'none';
  (g.querySelector('b') as HTMLElement).textContent = String(s.gold);
  el.classList.toggle('is-offline', !isOnline());
}

/** 当前局面的 8 条流派线（含赛场/头条人数加成） */
export function runSynergies(s: RunState, data: GameData): SynergyState[] {
  return computeSynergies(s.team, data, stateBonus(s, data));
}

/** 羁绊条：激活的在前（档位高→低），其余按个数；0 个的只显示图标 */
export function renderSynergy(el: HTMLElement, states: SynergyState[], onTap?: (st: SynergyState) => void): void {
  el.innerHTML = '';
  const sorted = [...states].sort((a, b) => b.tier - a.tier || b.count - a.count);
  for (const st of sorted) {
    const chip = synergyChip(st, { compact: st.count === 0 });
    chip.onclick = () => onTap?.(st);
    el.appendChild(chip);
  }
}

/** 队伍 5 槽（data-drop="team:i"，卡片 data-src="team:i"）；属性显示含装备的 effectiveStats */
export function renderTeam(row: HTMLElement, s: RunState, data: GameData): void {
  row.innerHTML = '';
  const bonus = stateBonus(s, data);
  const tiers = teamTiers(s.team, data, bonus);
  s.team.forEach((u, i) => {
    const slot = document.createElement('div');
    slot.className = `tslot${u ? '' : ' slot is-empty'}`;
    slot.dataset.drop = `team:${i}`;
    slot.dataset.index = String(i);
    if (u) {
      const def = data.unitsById[u.defId];
      if (def) {
        const c = teamCard(u, s.team, data, tiers[def.faction], bonus);
        c.dataset.src = `team:${i}`;
        slot.appendChild(c);
      }
    } else {
      slot.innerHTML = `<span class="slot-no">${i + 1}</span>`;
    }
    row.appendChild(slot);
  });
}

/** 一张带装备与有效属性的队伍卡 */
export function teamCard(u: UnitInst, team: readonly (UnitInst | null)[], data: GameData, synTier = 0, bonus?: ReturnType<typeof stateBonus>, enemy = false): HTMLElement {
  const def = data.unitsById[u.defId];
  const st = effectiveStats(u, data, team, bonus);
  return unitCard(def, { atk: st.atk, hp: st.hp, level: u.level, xp: u.xp, shield: u.shield, atkBuffed: u.tempAtk > 0, equips: u.equips }, { uid: u.uid, synTier, enemy });
}
