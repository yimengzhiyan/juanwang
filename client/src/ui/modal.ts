// 通用弹窗 + 单位/基建详情卡。
import gsap from 'gsap';
import { EQUIP_SLOTS, type GameData, type UnitInst } from '@juanwang/shared';
import { abilityText, esc, FACTION_NAME, ROLE_NAME, SLOT_NAME, TIER_NAME, unitCard } from './cards';
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

/** 单位详情：技能、阵营/职业、阶级、装备、台词、当前属性（stats = 含装备的有效属性） */
export function showUnitDetail(
  data: GameData,
  defId: string,
  inst?: Pick<UnitInst, 'atk' | 'hp' | 'level'> & Partial<UnitInst>,
  opts: { stats?: { atk: number; hp: number }; extra?: HTMLElement } = {},
): ModalHandle | null {
  const def = data.unitsById[defId];
  if (!def) return null;
  sfx.click();
  const body = document.createElement('div');
  body.className = 'detail';
  const atk = opts.stats?.atk ?? (inst?.atk ?? def.atk) + (inst?.tempAtk ?? 0);
  const hp = opts.stats?.hp ?? (inst?.hp ?? def.hp) + (inst?.tempHp ?? 0);
  const card = unitCard(def, { atk, hp, level: inst?.level ?? 1, xp: inst?.xp, shield: inst?.shield, atkBuffed: !!inst?.tempAtk, equips: inst?.equips });
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
      ${def.role ? `<span class="chip"><img src="${assetUrl(`ui/role_${def.role}.svg`)}" alt="">${ROLE_NAME[def.role]}</span>` : ''}
      ${inst ? `<span class="chip">Lv${inst.level}</span>` : ''}
    </div>
    <div class="detail-stats">攻击 <b>${atk}</b> · 血量 <b>${hp}</b></div>
    ${temp}`;
  const skill = document.createElement('div');
  skill.className = 'detail-skill';
  skill.innerHTML = `<b>技能</b>${esc(abilityText(def))}`;
  const eqs = document.createElement('div');
  eqs.className = 'detail-eqs';
  const list = EQUIP_SLOTS.map((slot) => {
    const e = inst?.equips?.[slot];
    const d = e ? data.equipsById[e.defId] : undefined;
    if (!d || !e) return '';
    return `<div class="detail-eq${e.gold ? ' is-gold' : ''}"><img src="${assetUrl(d.icon)}" alt=""><div><b>${e.gold ? '金·' : ''}${esc(d.name)}</b><small>${SLOT_NAME[slot]}</small><span>${esc(e.gold ? d.goldDesc : d.desc)}</span></div></div>`;
  }).join('');
  eqs.innerHTML = list;
  const lines = document.createElement('div');
  lines.className = 'detail-lines';
  const all = [...(def.lines?.general ?? []), ...(def.lines?.onSynergy ?? [])];
  lines.innerHTML = all.map((l) => `<span class="say">“${esc(l)}”</span>`).join('');
  const top = document.createElement('div');
  top.className = 'detail-top';
  top.append(left, right);
  body.append(top, skill);
  if (list) body.appendChild(eqs);
  body.appendChild(lines);
  if (opts.extra) body.appendChild(opts.extra);
  return openModal({ body, cls: 'modal--detail' });
}

/** 装备 / 消耗品详情 */
export function showItemDetail(data: GameData, kind: 'equip' | 'consumable', id: string, gold = false): ModalHandle | null {
  const body = document.createElement('div');
  body.className = 'detail item-detail';
  if (kind === 'equip') {
    const d = data.equipsById[id];
    if (!d) return null;
    body.innerHTML = `<div class="detail-top"><div class="item-ico${gold ? ' is-gold' : ''}"><img src="${assetUrl(d.icon)}" alt=""></div><div class="detail-info"><div class="detail-name">${gold ? '金·' : ''}${esc(d.name)}</div><div class="detail-chips"><span class="chip"><img src="${assetUrl(`ui/slot_${d.slot}.svg`)}" alt="">${SLOT_NAME[d.slot]}</span><span class="chip">${d.price} 算力</span></div></div></div>
      <div class="detail-skill"><b>效果</b>${esc(gold ? d.goldDesc : d.desc)}</div>${gold ? '' : `<div class="detail-skill gold"><b>金色</b>${esc(d.goldDesc)}</div>`}
      <p class="item-tip">同名两件合成金色版；卖掉单位时每件折算 1 算力（金色 2）。</p>`;
  } else {
    const d = data.consumablesById[id];
    if (!d) return null;
    body.innerHTML = `<div class="detail-top"><div class="item-ico"><img src="${assetUrl(d.icon)}" alt=""></div><div class="detail-info"><div class="detail-name">${esc(d.name)}</div><div class="detail-chips"><span class="chip">消耗品</span><span class="chip">${d.targetKind === 'unit' ? '选一个单位' : '买下立即生效'}</span></div></div></div>
      <div class="detail-skill"><b>效果</b>${esc(d.desc)}</div>`;
  }
  sfx.click();
  return openModal({ body, cls: 'modal--detail' });
}

/** 确认框 */
export function confirmBox(text: string, ok: string, onOk: () => void): ModalHandle {
  const body = document.createElement('div');
  body.className = 'confirm';
  body.innerHTML = `<p>${esc(text)}</p><div class="confirm-btns"><button class="btn btn--white btn--sm c-no">取消</button><button class="btn btn--go btn--sm c-ok">${esc(ok)}</button></div>`;
  const m = openModal({ body, cls: 'modal--confirm', closeButton: false });
  (body.querySelector('.c-no') as HTMLElement).onclick = () => m.close();
  (body.querySelector('.c-ok') as HTMLElement).onclick = () => {
    m.close();
    onOk();
  };
  return m;
}
