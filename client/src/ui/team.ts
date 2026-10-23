// 顶栏（信心/热搜/回合/算力/静音）、羁绊条、我方 5 槽。
import { FACTIONS, SYNERGY_DESC, SYNERGY_THRESHOLD, WIN_TROPHIES, type GameData, type RunState, type UnitInst } from '@juanwang/shared';
import { ui } from '../assets';
import { settings } from '../store';
import { setMuted } from '../fx/sound';
import { FACTION_NAME, unitCard } from './cards';
import { isOnline } from '../net';

export function topbar(): HTMLElement {
  const el = document.createElement('header');
  el.className = 'topbar';
  el.innerHTML = `
    <div class="hud-chip hud-lives" data-hud="lives"><img src="${ui('lives')}" alt="信心"><b></b></div>
    <div class="hud-chip hud-trophy" data-hud="trophies"><img src="${ui('fire')}" alt="热搜"><div class="hud-cells"></div><b></b></div>
    <div class="hud-chip hud-turn" data-hud="turn"><small>回合</small><b></b></div>
    <div class="hud-chip hud-gold" data-hud="gold"><img src="${ui('gold')}" alt="算力"><b></b></div>
    <button class="hud-mute" aria-label="静音"></button>
    <div class="net-tag">离线模式</div>`;
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
  const cells = el.querySelector('.hud-cells')!;
  for (let i = 0; i < WIN_TROPHIES; i++) cells.appendChild(document.createElement('i'));
  return el;
}

export const SOUND_SVG =
  '<svg viewBox="0 0 32 32" width="26" height="26"><path d="M5 12h5l7-6v20l-7-6H5z" fill="#fff" stroke="#3B2A1A" stroke-width="2.5" stroke-linejoin="round"/><path d="M21 11c2 2.5 2 7.5 0 10M24.5 8c4 4.5 4 11.5 0 16" fill="none" stroke="#3B2A1A" stroke-width="2.5" stroke-linecap="round"/></svg>';
export const MUTED_SVG =
  '<svg viewBox="0 0 32 32" width="26" height="26"><path d="M5 12h5l7-6v20l-7-6H5z" fill="#C9D3DE" stroke="#3B2A1A" stroke-width="2.5" stroke-linejoin="round"/><path d="M21 12l7 8M28 12l-7 8" stroke="#F25757" stroke-width="3" stroke-linecap="round"/></svg>';

export function updateTopbar(el: HTMLElement, s: Pick<RunState, 'lives' | 'trophies' | 'turn' | 'gold'>, showGold = true): void {
  (el.querySelector('[data-hud=lives] b') as HTMLElement).textContent = String(s.lives);
  (el.querySelector('[data-hud=trophies] b') as HTMLElement).textContent = `${s.trophies}/${WIN_TROPHIES}`;
  el.querySelectorAll('.hud-cells i').forEach((c, i) => c.classList.toggle('on', i < s.trophies));
  (el.querySelector('[data-hud=turn] b') as HTMLElement).textContent = String(s.turn);
  const g = el.querySelector('[data-hud=gold]') as HTMLElement;
  g.style.display = showGold ? '' : 'none';
  (g.querySelector('b') as HTMLElement).textContent = String(s.gold);
  el.classList.toggle('is-offline', !isOnline());
}

/** 羁绊条：四阵营徽章 + 进度 */
export function renderSynergy(el: HTMLElement, team: (UnitInst | null)[], data: GameData, onTap?: (text: string) => void): void {
  const counts: Record<string, number> = { open: 0, closed: 0, compute: 0, folk: 0 };
  for (const u of team) if (u) counts[data.unitsById[u.defId]?.faction ?? 'folk']++;
  el.innerHTML = '';
  for (const f of FACTIONS) {
    const n = counts[f];
    const on = n >= SYNERGY_THRESHOLD;
    const chip = document.createElement('button');
    chip.className = `syn fac-${f}${on ? ' is-on' : ''}${n ? '' : ' is-zero'}`;
    chip.dataset.fac = f;
    chip.innerHTML = `<img src="${ui(`faction_${f}`)}" alt=""><span>${FACTION_NAME[f]}</span><b>${Math.min(n, 9)}/${SYNERGY_THRESHOLD}</b>`;
    chip.onclick = () => onTap?.(`${FACTION_NAME[f]} ${n}/${SYNERGY_THRESHOLD}：${SYNERGY_DESC[f]}${on ? '（已激活）' : ''}`);
    el.appendChild(chip);
  }
}

/** 队伍 5 槽（data-drop="team:i"，卡片 data-src="team:i"） */
export function renderTeam(row: HTMLElement, team: (UnitInst | null)[], data: GameData): void {
  row.innerHTML = '';
  team.forEach((u, i) => {
    const slot = document.createElement('div');
    slot.className = `tslot${u ? '' : ' slot is-empty'}`;
    slot.dataset.drop = `team:${i}`;
    slot.dataset.index = String(i);
    if (u) {
      const def = data.unitsById[u.defId];
      if (def) {
        const c = unitCard(def, { atk: u.atk + u.tempAtk, hp: u.hp + u.tempHp, level: u.level, xp: u.xp, shield: u.shield, atkBuffed: u.tempAtk > 0 }, { uid: u.uid });
        c.dataset.src = `team:${i}`;
        slot.appendChild(c);
      }
    } else {
      slot.innerHTML = `<span class="slot-no">${i + 1}</span>`;
    }
    row.appendChild(slot);
  });
}
