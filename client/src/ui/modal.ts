// 通用弹窗 + 单位/基建详情卡。
import gsap from 'gsap';
import { EQUIP_SLOTS, type GameData, type SynergyState, type UnitDef, type UnitInst } from '@juanwang/shared';
import { abilityText, esc, FACTION_NAME, SLOT_NAME, SYN_COLOR, skillTitle, synIconHtml, synName, TIER_NAME, unitCard } from './cards';
import { assetUrl, ui } from '../assets';
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

/** 详情面板底部按钮（如队伍卡的「出售」） */
export interface DetailAction {
  label: string;
  cls?: string;
  kind?: string;
  onClick: (close: () => void) => void;
}

/** 技能全文：去掉 desc 开头重复的"技能名：" */
function skillBody(def: UnitDef): string {
  const nm = skillTitle(def);
  const t = abilityText(def);
  const m = /^([^：:]{1,10})[：:]\s*(.+)$/s.exec(t);
  return m && (m[1] === nm || m[1] === def.ability?.name) ? m[2] : t;
}

/** 某条流派线在详情里的一行：图标 名字 · 当前 N 个 · 档位 · 生效/下一档说明 */
function synLine(key: string, kindLabel: string, st?: SynergyState): string {
  const name = synName(key);
  if (!st) return `<div class="ds-row" style="--sc:${SYN_COLOR[key] ?? '#9B6BFF'}">${synIconHtml(key, 'ds-ico')}<div><b>${esc(name)}<small>${kindLabel}</small></b></div></div>`;
  const on = st.tier > 0;
  const now = on ? `${st.descs[st.tier - 1] ?? ''}` : '';
  const next = st.tier < st.thresholds.length ? `再 ${st.thresholds[st.tier] - st.count} 个 → ${st.descs[st.tier] ?? ''}` : '已满档';
  const pips = st.thresholds.map((t, i) => `<i class="${st.tier > i ? 'on' : ''}">${t}</i>`).join('');
  return `<div class="ds-row${on ? ' is-on' : ''}" style="--sc:${SYN_COLOR[key] ?? '#9B6BFF'}">${synIconHtml(key, 'ds-ico')}<div>
    <b>${esc(name)}<small>${kindLabel}</small><span class="ds-cnt">当前 ${st.count} 个${on ? ` · ${st.tier} 档` : ''}</span><span class="ds-pips">${pips}</span></b>
    ${now ? `<span class="ds-now">${esc(now)}</span>` : ''}<span class="ds-next">${esc(next)}</span></div></div>`;
}

/**
 * 单位详情：技能名 + 完整描述、阵营/打法（含当前羁绊档位）、阶级、属性、装备三格、台词。
 * stats = 含装备的有效属性；synergies = 当前队伍羁绊（传了才显示档位）；allSlots = 装备三格全显示（空槽也画）；actions = 底部按钮。
 */
export function showUnitDetail(
  data: GameData,
  defId: string,
  inst?: Pick<UnitInst, 'atk' | 'hp' | 'level'> & Partial<UnitInst>,
  opts: { stats?: { atk: number; hp: number }; extra?: HTMLElement; synergies?: SynergyState[]; allSlots?: boolean; actions?: DetailAction[] } = {},
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
  const base = inst && opts.stats && (opts.stats.atk !== inst.atk || opts.stats.hp !== inst.hp) ? `<small class="detail-base">基础 ${inst.atk}/${inst.hp}</small>` : '';
  right.innerHTML = `
    <div class="detail-name">${esc(def.name)}</div>
    <div class="detail-chips">
      <span class="chip chip--tier tier-${def.tier}">${def.token ? '召唤物' : TIER_NAME[def.tier]}</span>
      <span class="chip chip--fac fac-${def.faction}"><img src="${assetUrl(`ui/faction_${def.faction}.svg`)}" alt="">${FACTION_NAME[def.faction]}</span>
      ${def.role ? `<span class="chip chip--role">${synIconHtml(def.role)}${esc(synName(def.role))}</span>` : ''}
      ${inst ? `<span class="chip">Lv${inst.level}</span>` : ''}
    </div>
    <div class="detail-stats"><img src="${ui('atk')}" alt="攻击"><b>${atk}</b><img src="${ui('hp')}" alt="血量"><b>${hp}</b>${base}</div>
    ${temp}`;
  const skill = document.createElement('div');
  skill.className = 'detail-skill';
  skill.innerHTML = def.ability ? `<b>${esc(skillTitle(def))}</b>${esc(skillBody(def))}` : `<b>无技能</b>${esc(abilityText(def))}`;
  const eqs = document.createElement('div');
  eqs.className = 'detail-eqs';
  const list = EQUIP_SLOTS.map((slot) => {
    const e = inst?.equips?.[slot];
    const d = e ? data.equipsById[e.defId] : undefined;
    if (!d || !e) return opts.allSlots ? `<div class="detail-eq is-empty"><img src="${ui(`slot_${slot}`)}" alt=""><div><b>${SLOT_NAME[slot]}槽 · 空</b><span>把商店或仓库里的${SLOT_NAME[slot]}拖到它身上</span></div></div>` : '';
    return `<div class="detail-eq${e.gold ? ' is-gold' : ''}"><img src="${assetUrl(d.icon)}" alt=""><div><b>${e.gold ? '金·' : ''}${esc(d.name)}</b><small>${SLOT_NAME[slot]}</small><span>${esc(e.gold ? d.goldDesc : d.desc)}</span></div></div>`;
  }).join('');
  eqs.innerHTML = list;
  const top = document.createElement('div');
  top.className = 'detail-top';
  top.append(left, right);
  body.append(top, skill);
  if (opts.synergies || def.role) {
    const syn = document.createElement('div');
    syn.className = 'detail-syn';
    const find = (k?: string): SynergyState | undefined => (k ? opts.synergies?.find((x) => x.key === k) : undefined);
    syn.innerHTML = `${synLine(def.faction, '阵营', find(def.faction))}${def.role ? synLine(def.role, '打法', find(def.role)) : ''}`;
    body.appendChild(syn);
  }
  if (list) body.appendChild(eqs);
  const all = [...(def.lines?.general ?? []), ...(def.lines?.onSynergy ?? [])];
  if (all.length) {
    const lines = document.createElement('div');
    lines.className = 'detail-lines';
    lines.innerHTML = all.map((l) => `<span class="say">“${esc(l)}”</span>`).join('');
    body.appendChild(lines);
  }
  if (opts.extra) body.appendChild(opts.extra);
  let handle: ModalHandle | null = null;
  if (opts.actions?.length) {
    const acts = document.createElement('div');
    acts.className = 'detail-acts';
    for (const a of opts.actions) {
      const b = document.createElement('button');
      b.className = `btn btn--sm ${a.cls ?? ''}`;
      if (a.kind) b.dataset.kind = a.kind;
      b.innerHTML = a.label;
      b.onclick = () => a.onClick(() => handle?.close());
      acts.appendChild(b);
    }
    body.appendChild(acts);
  }
  handle = openModal({ body, cls: 'modal--detail' });
  return handle;
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
