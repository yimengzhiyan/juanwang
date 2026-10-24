// 顶栏（热度血条 / 回合 / 商店阶 / 算力 / 静音）、羁绊条（8 条流派线）、我方 5 槽。
import {
  START_HP, computeSynergies, effectiveStats, shopMaxTier, stateBonus, teamTiers,
  type GameData, type RunState, type SynergyState, type UnitInst,
} from '@juanwang/shared';
import { ui } from '../assets';
import { settings } from '../store';
import { setMuted } from '../fx/sound';
import gsap from 'gsap';
import { esc, hpColor, SYN_COLOR, synergyChip, synergyDetailHtml, synIcon, unitCard } from './cards';
import { isOnline } from '../net';

export function topbar(opts: { codex?: () => void; muteIn?: boolean } = {}): HTMLElement {
  const el = document.createElement('header');
  el.className = 'topbar';
  el.innerHTML = `
    <div class="hud-chip hud-hp" data-hud="hp"><img src="${ui('lives')}" alt="热度"><div class="hud-hpbar"><i></i></div><b></b></div>
    <div class="hud-chip hud-tt"><span class="hud-turn" data-hud="turn"><small>回合</small><b></b></span><span class="hud-tier" data-hud="tier"><small>商店</small><b></b></span></div>
    <div class="hud-chip hud-gold" data-hud="gold"><img src="${ui('gold')}" alt="算力"><b></b></div>
    ${opts.codex ? '<button class="hud-codex" aria-label="图鉴"><b>图鉴</b></button>' : ''}
    ${opts.muteIn === false ? '' : '<button class="hud-mute" aria-label="静音"></button>'}`;
  if (opts.codex) (el.querySelector('.hud-codex') as HTMLElement).onclick = opts.codex;
  const mute = el.querySelector('.hud-mute') as HTMLButtonElement | null;
  if (mute) muteButton(mute);
  return el;
}

/** 静音按钮（顶栏 / 队伍标题行） */
export function muteButton(mute: HTMLElement): void {
  const syncMute = (): void => {
    mute.classList.toggle('is-muted', settings.muted);
    mute.innerHTML = settings.muted ? MUTED_SVG : SOUND_SVG;
  };
  mute.onclick = () => {
    setMuted(!settings.muted);
    syncMute();
  };
  syncMute();
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
  (chip.querySelector('b') as HTMLElement).innerHTML = `${v}<small>/${START_HP}</small>`;
}

export function updateTopbar(el: HTMLElement, s: RunState, showGold = true): void {
  setHpChip(el, s.hp);
  (el.querySelector('[data-hud=turn] b') as HTMLElement).textContent = String(s.turn);
  (el.querySelector('[data-hud=tier] b') as HTMLElement).textContent = `T${shopMaxTier(s)}`;
  const g = el.querySelector('[data-hud=gold]') as HTMLElement;
  g.style.display = showGold ? '' : 'none';
  (el.querySelector('[data-hud=tier]') as HTMLElement).style.display = showGold ? '' : 'none';
  (el.querySelector('.hud-tt') as HTMLElement).style.display = showGold ? '' : 'none';
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
        // 身上的装备格可单独拖（卸进仓库）/ 点开菜单
        c.querySelectorAll<HTMLElement>('.uc-eq.is-on').forEach((q) => (q.dataset.src = `ueq:${i}:${q.dataset.slot}`));
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

// ───────────── 羁绊面板（羁绊条下方常显一行；点开看全部 / 点徽章看某条的全部档位） ─────────────
export interface SynergyPanel {
  el: HTMLElement;
  update: (states: SynergyState[]) => void;
  /** 展开并聚焦某条羁绊（null = 展开全部列表） */
  open: (key: string | null) => void;
  close: () => void;
  isOpen: () => boolean;
  /** 达成新档：对应行高亮弹跳 */
  flash: (keys: string[]) => void;
}

const synSort = (a: SynergyState, b: SynergyState): number => b.tier - a.tier || b.count - a.count;

export function synergyPanel(): SynergyPanel {
  const el = document.createElement('div');
  el.className = 'syn-panel';
  el.dataset.tut = 'synergy-panel';
  el.innerHTML = '<div class="sp-line"><div class="sp-segs"></div><button class="sp-toggle" aria-label="展开羁绊说明">全部</button></div><div class="sp-pop"></div>';
  const segs = el.querySelector('.sp-segs') as HTMLElement;
  const pop = el.querySelector('.sp-pop') as HTMLElement;
  const toggle = el.querySelector('.sp-toggle') as HTMLElement;
  let states: SynergyState[] = [];
  let opened = false;
  let focus: string | null = null;
  let recent: string[] = [];

  const nextText = (st: SynergyState): string => (st.tier < st.thresholds.length ? `再 ${st.thresholds[st.tier] - st.count} 个 → ${st.descs[st.tier] ?? ''}` : '已满档');

  function renderLine(): void {
    const act = states.filter((s) => s.count > 0).sort((a, b) => Number(recent.includes(b.key)) - Number(recent.includes(a.key)) || synSort(a, b));
    if (!act.length) {
      segs.innerHTML = '<span class="sp-empty">凑 2 个同阵营 / 同职业即可点亮羁绊</span>';
      return;
    }
    segs.innerHTML = act
      .map((st) => {
        const on = st.tier > 0;
        const txt = on ? `${st.descs[st.tier - 1] ?? ''}` : nextText(st);
        return `<span class="sp-seg${on ? ' is-on' : ''}" data-key="${st.key}" style="--sc:${SYN_COLOR[st.key]}"><img src="${synIcon(st.key)}" alt=""><b>${esc(st.name)}${on ? `×${st.count}` : ` ${st.count}/${st.thresholds[0]}`}</b>${esc(txt)}</span>`;
      })
      .join('');
  }

  function renderPop(): void {
    el.classList.toggle('is-open', opened);
    toggle.textContent = opened ? '收起' : '全部';
    if (!opened) {
      pop.innerHTML = '';
      return;
    }
    const st = focus ? states.find((s) => s.key === focus) : undefined;
    if (st) {
      pop.innerHTML = `${synergyDetailHtml(st)}<button class="sp-back">← 全部羁绊</button>`;
      (pop.querySelector('.sp-back') as HTMLElement).onclick = (e) => {
        e.stopPropagation();
        focus = null;
        renderPop();
      };
      return;
    }
    const list = [...states].filter((s) => s.count > 0).sort(synSort);
    const rest = states.filter((s) => s.count === 0);
    pop.innerHTML = `${list.length ? '' : '<div class="sp-empty">队伍里还没有可以凑羁绊的单位</div>'}${list
      .map((s) => {
        const actives = s.descs.slice(0, s.tier).map((d, i) => `<li class="on"><i>${s.thresholds[i]}</i>${esc(d)}</li>`).join('');
        const nxt = s.tier < s.thresholds.length ? `<li class="next"><i>${s.thresholds[s.tier]}</i>再 ${s.thresholds[s.tier] - s.count} 个 → ${esc(s.descs[s.tier] ?? '')}</li>` : '<li class="max">已满档！</li>';
        return `<div class="sp-row${s.tier ? ' is-on' : ''}" data-key="${s.key}" style="--sc:${SYN_COLOR[s.key]}"><div class="sp-row-head"><img src="${synIcon(s.key)}" alt=""><b>${esc(s.name)}</b><span>${s.count} 个${s.tier ? ` · ${s.tier} 档` : ''}</span></div><ul>${actives}${nxt}</ul></div>`;
      })
      .join('')}${rest.length ? `<div class="sp-rest">未凑：${rest.map((s) => `<button class="sp-mini" data-key="${s.key}"><img src="${synIcon(s.key)}" alt="">${esc(s.name)}</button>`).join('')}</div>` : ''}`;
    pop.querySelectorAll<HTMLElement>('.sp-row, .sp-mini').forEach((r) => {
      r.onclick = (e) => {
        e.stopPropagation();
        focus = r.dataset.key ?? null;
        renderPop();
      };
    });
  }

  const api: SynergyPanel = {
    el,
    update(s) {
      states = s;
      renderLine();
      renderPop();
    },
    open(key) {
      if (opened && focus === key) return api.close();
      opened = true;
      focus = key;
      renderPop();
    },
    close() {
      opened = false;
      focus = null;
      renderPop();
    },
    isOpen: () => opened,
    flash(keys) {
      recent = keys;
      renderLine();
      renderPop();
      for (const k of keys) {
        el.querySelectorAll<HTMLElement>(`.sp-seg[data-key="${k}"], .sp-row[data-key="${k}"]`).forEach((n) => {
          n.classList.add('is-up');
          gsap.fromTo(n, { scale: 1, y: 0 }, { keyframes: [{ scale: 1.12, y: -4, duration: 0.14, ease: 'back.out(3)' }, { scale: 1, y: 0, duration: 0.3, ease: 'bounce.out' }] });
          setTimeout(() => n.classList.remove('is-up'), 2600);
        });
      }
      segs.scrollLeft = 0;
    },
  };
  el.querySelector('.sp-line')!.addEventListener('click', (e) => {
    const seg = (e.target as HTMLElement).closest('.sp-seg') as HTMLElement | null;
    if (seg) api.open(seg.dataset.key ?? null);
    else if (opened) api.close();
    else api.open(null);
  });
  return api;
}

