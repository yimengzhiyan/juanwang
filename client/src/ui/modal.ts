// 通用弹窗 + 单位/基建详情卡。
import gsap from 'gsap';
import type { GameData, UnitInst } from '@juanwang/shared';
import { abilityText, esc, FACTION_NAME, TIER_NAME, unitCard } from './cards';
import { assetUrl } from '../assets';
import { sfx } from '../fx/sound';

let root: HTMLElement;
export function mountModals(shell: HTMLElement): void {
  root = document.createElement('div');
  root.className = 'overlay-root';
  shell.appendChild(root);
}

export interface ModalOpts {
  title?: string;
  body: HTMLElement | string;
  cls?: string;
  /** 点遮罩可关闭（默认 true） */
  dismissable?: boolean;
  closeButton?: boolean;
  onClose?: () => void;
}
export interface ModalHandle {
  el: HTMLElement;
  card: HTMLElement;
  close: () => void;
}

export function openModal(o: ModalOpts): ModalHandle {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  const card = document.createElement('div');
  card.className = `modal panel ${o.cls ?? ''}`;
  if (o.title) {
    const h = document.createElement('div');
    h.className = 'modal-title';
    h.textContent = o.title;
    card.appendChild(h);
  }
  if (o.closeButton !== false) {
    const x = document.createElement('button');
    x.className = 'modal-x';
    x.setAttribute('aria-label', '关闭');
    x.textContent = '×';
    x.onclick = () => close();
    card.appendChild(x);
  }
  const body = document.createElement('div');
  body.className = 'modal-body';
  if (typeof o.body === 'string') body.innerHTML = o.body;
  else body.appendChild(o.body);
  card.appendChild(body);
  mask.appendChild(card);
  root.appendChild(mask);
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    gsap.to(mask, { opacity: 0, duration: 0.15, onComplete: () => mask.remove() });
    o.onClose?.();
  };
  if (o.dismissable !== false) {
    mask.addEventListener('pointerdown', (e) => {
      if (e.target === mask) close();
    });
  }
  gsap.fromTo(mask, { opacity: 0 }, { opacity: 1, duration: 0.15 });
  gsap.fromTo(card, { scale: 0.85, y: 20 }, { scale: 1, y: 0, duration: 0.3, ease: 'back.out(2)' });
  return { el: mask, card, close };
}

export function hasModal(): boolean {
  return !!root?.children.length;
}
export function closeAllModals(): void {
  if (root) root.innerHTML = '';
}

/** 单位详情：技能描述、阵营、阶级、台词、当前属性 */
export function showUnitDetail(data: GameData, defId: string, inst?: Pick<UnitInst, 'atk' | 'hp' | 'level'> & Partial<UnitInst>, extra?: HTMLElement): ModalHandle | null {
  const def = data.unitsById[defId];
  if (!def) return null;
  sfx.click();
  const body = document.createElement('div');
  body.className = 'detail';
  const atk = (inst?.atk ?? def.atk) + (inst?.tempAtk ?? 0);
  const hp = (inst?.hp ?? def.hp) + (inst?.tempHp ?? 0);
  const card = unitCard(def, { atk, hp, level: inst?.level ?? 1, xp: inst?.xp, shield: inst?.shield, atkBuffed: !!inst?.tempAtk });
  const left = document.createElement('div');
  left.className = 'detail-card';
  left.appendChild(card);
  const right = document.createElement('div');
  right.className = 'detail-info';
  const temp = inst && (inst.tempAtk || inst.tempHp || inst.shield)
    ? `<div class="detail-temp">本回合：${inst.tempAtk ? `攻 ${inst.tempAtk > 0 ? '+' : ''}${inst.tempAtk} ` : ''}${inst.tempHp ? `血 ${inst.tempHp > 0 ? '+' : ''}${inst.tempHp} ` : ''}${inst.shield ? `护盾 ${inst.shield}` : ''}</div>`
    : '';
  right.innerHTML = `
    <div class="detail-name">${esc(def.name)}</div>
    <div class="detail-chips">
      <span class="chip chip--tier tier-${def.tier}">${def.token ? '召唤物' : TIER_NAME[def.tier]}</span>
      <span class="chip chip--fac fac-${def.faction}"><img src="${assetUrl(`ui/faction_${def.faction}.svg`)}" alt="">${FACTION_NAME[def.faction]}</span>
      ${inst ? `<span class="chip">Lv${inst.level}</span>` : ''}
    </div>
    <div class="detail-stats">攻击 <b>${atk}</b> · 血量 <b>${hp}</b></div>
    ${temp}`;
  const skill = document.createElement('div');
  skill.className = 'detail-skill';
  skill.innerHTML = `<b>技能</b>${esc(abilityText(def))}`;
  const lines = document.createElement('div');
  lines.className = 'detail-lines';
  lines.innerHTML = (def.lines ?? []).map((l) => `<span class="say">“${esc(l)}”</span>`).join('');
  const top = document.createElement('div');
  top.className = 'detail-top';
  top.append(left, right);
  body.append(top, skill, lines);
  if (extra) body.appendChild(extra);
  return openModal({ body, cls: 'modal--detail' });
}
