// 单位卡 / 基建卡 DOM（规格见 ART.md 第 4 节）。尺寸由父容器决定，内部用 cqw 等比缩放。
import type { FreeReason, GameData, ItemDef, Level, UnitDef } from '@juanwang/shared';
import { assetUrl, avatarUrl, isPhotoAvatar, ui } from '../assets';

export const FACTION_NAME: Record<string, string> = { open: '开源', closed: '闭源', compute: '算力', folk: '民间' };
export const TIER_NAME = ['', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];

export interface CardStats {
  atk: number;
  hp: number;
  level: Level;
  xp?: number;
  shield?: number;
  /** 本场临时加攻（数字变橙） */
  atkBuffed?: boolean;
  /** 受伤（数字变红） */
  hurt?: boolean;
}

/** 去掉字体可能缺失的 emoji（引擎文案里的 ⚡ 等） */
export const plain = (s: string): string => s.replace(/⚡/g, ' 算力').replace(/🔥/g, ' 热搜').replace(/❤️?/g, ' 信心').replace(/\s+/g, ' ').trim();
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export { esc };

export function unitCard(def: UnitDef, st: CardStats, opts: { enemy?: boolean; uid?: string } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = `ucard tier-${def.tier} fac-${def.faction}${opts.enemy ? ' is-enemy' : ''}${def.token ? ' is-token' : ''}`;
  el.dataset.def = def.id;
  if (opts.uid) el.dataset.uid = opts.uid;
  const photo = isPhotoAvatar(def);
  el.innerHTML = `
    <div class="uc-stars"><i></i><i></i><i></i><b class="uc-xp"><s></s></b></div>
    <img class="uc-fac" src="${ui(`faction_${def.faction}`)}" alt="${FACTION_NAME[def.faction]}" draggable="false">
    <div class="uc-ava"><img class="${photo ? 'is-photo' : ''}" src="${avatarUrl(def)}" alt="" draggable="false"><span class="uc-flash"></span></div>
    <div class="uc-name" style="--nl:${nameLen(def.name)}">${esc(def.name)}</div>
    <div class="uc-atk"><span></span></div>
    <div class="uc-hp"><span></span><em class="uc-shield"></em></div>`;
  setCardStats(el, st);
  return el;
}

/** 名字的"视觉长度"（中文 1、ASCII 0.58），用于自动缩字号 */
export function nameLen(name: string): number {
  let n = 0;
  for (const ch of name) n += /[\x00-\x7F]/.test(ch) ? 0.58 : 1;
  return Math.max(3, Math.round(n * 100) / 100);
}

export function setCardStats(el: HTMLElement, st: CardStats): void {
  const atk = el.querySelector('.uc-atk span') as HTMLElement;
  const hp = el.querySelector('.uc-hp span') as HTMLElement;
  atk.textContent = String(Math.max(0, st.atk));
  hp.textContent = String(Math.max(0, st.hp));
  atk.classList.toggle('is-buffed', !!st.atkBuffed);
  hp.classList.toggle('is-hurt', !!st.hurt);
  const stars = el.querySelectorAll('.uc-stars i');
  stars.forEach((s, i) => s.classList.toggle('on', i < st.level));
  const xpBar = el.querySelector('.uc-xp s') as HTMLElement;
  const xp = st.xp ?? (st.level === 3 ? 5 : st.level === 2 ? 2 : 0);
  const frac = st.level >= 3 ? 1 : st.level === 2 ? (xp - 2) / 3 : xp / 2;
  xpBar.style.width = `${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%`;
  (el.querySelector('.uc-xp') as HTMLElement).style.display = st.level >= 3 ? 'none' : '';
  setShield(el, st.shield ?? 0);
}

export function setShield(el: HTMLElement, n: number): void {
  el.classList.toggle('has-shield', n > 0);
  const s = el.querySelector('.uc-shield') as HTMLElement | null;
  if (s) s.textContent = n > 0 ? String(n) : '';
}

export function itemCard(def: ItemDef): HTMLElement {
  const el = document.createElement('div');
  el.className = `icard itier-${def.tier}`;
  el.dataset.item = def.id;
  el.innerHTML = `<img src="${assetUrl(def.icon)}" alt="" draggable="false"><div class="ic-name">${esc(def.name)}</div>${def.targetKind === 'team' ? '<b class="ic-team">全队</b>' : ''}`;
  return el;
}

/** 免费槽标签文案 */
export const FREE_LABEL: Record<FreeReason, string> = { levelUp: '进化奖励', event: '头条赠送' };

/** 价格胶囊（免费槽按来源显示「进化奖励」/「头条赠送」） */
export function priceTag(price: number, affordable: boolean, free: FreeReason | false = false): HTMLElement {
  const el = document.createElement('div');
  el.className = `price${affordable ? '' : ' is-poor'}${free ? ` is-free is-free--${free}` : ''}`;
  el.innerHTML = free ? FREE_LABEL[free] : `<img src="${ui('gold')}" alt="">${price}`;
  return el;
}

/** 技能描述（含随机形态） */
export function abilityText(def: UnitDef): string {
  if (!def.ability) return '没有技能，纯靠身板。';
  const a = def.ability;
  if (a.choices?.length) return `${a.desc}（${a.choices.map((c) => c.desc).filter(Boolean).join(' / ')}）`;
  return a.desc;
}

/** 一张小头像（列表/榜单用） */
export function miniAvatar(data: GameData, defId: string, cls = 'mini-ava'): string {
  const d = data.unitsById[defId];
  if (!d) return '';
  return `<span class="${cls} tier-${d.tier}"><img src="${avatarUrl(d)}" alt="${esc(d.name)}" class="${isPhotoAvatar(d) ? 'is-photo' : ''}"></span>`;
}
