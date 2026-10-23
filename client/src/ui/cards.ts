// 单位卡 / 装备卡 / 消耗品卡 / 羁绊徽章 DOM（规格见 ART.md 第 4 节与 9.3、9.4）。尺寸由父容器决定，内部用 cqw 等比缩放。
import {
  EQUIP_SLOTS, SYNERGY_NAME,
  type Archetype, type ConsumableDef, type EquipDef, type EquipSlot, type FreeReason, type GameData, type Level, type SynergyKey,
  type SynergyState, type UnitDef, type UnitEquips,
} from '@juanwang/shared';
import { assetUrl, avatarUrl, isPhotoAvatar, ui } from '../assets';

export const FACTION_NAME: Record<string, string> = { open: '开源', closed: '闭源', compute: '算力', folk: '民间' };
export const ROLE_NAME: Record<string, string> = { researcher: '研究员', trader: '商人', idol: '偶像', engineer: '工程师' };
export const TIER_NAME = ['', 'T1', 'T2', 'T3', 'T4', 'T5', 'T6'];
export const SLOT_NAME: Record<EquipSlot, string> = { weapon: '武器', armor: '防具', trinket: '饰品' };

/** 流派线主色 / 影色（阵营 4 + 职业 4） */
export const SYN_COLOR: Record<string, string> = {
  open: '#58C65C', closed: '#2F80ED', compute: '#FF8C42', folk: '#FF7EB6',
  researcher: '#9B6BFF', trader: '#FFC53D', idol: '#FF7EB6', engineer: '#2F80ED',
};
export const SYN_DARK: Record<string, string> = {
  open: '#3E9E44', closed: '#1F5FC0', compute: '#D9692A', folk: '#D85A92',
  researcher: '#7A4FE0', trader: '#E0A21E', idol: '#D85A92', engineer: '#1F5FC0',
};
export const isFactionKey = (k: string): boolean => k in FACTION_NAME;
export const synIcon = (key: string): string => ui(isFactionKey(key) ? `faction_${key}` : `role_${key}`);
export const synName = (key: string): string => SYNERGY_NAME[key as SynergyKey] ?? (key === 'mixed' ? '杂牌军' : key);
/** 流派（对手 archetype）→ 代表线 key */
export const archetypeKey = (a?: Archetype | null): string | null => a?.faction ?? a?.role ?? null;

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
  equips?: UnitEquips;
}

/** 去掉字体可能缺失的 emoji（引擎文案里的 ⚡ 等） */
export const plain = (s: string): string => s.replace(/⚡/g, ' 算力').replace(/🔥/g, ' 热度').replace(/❤️?/g, ' 热度').replace(/\s+/g, ' ').trim();
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export { esc };

let dataRef: GameData | null = null;
/** 卡片渲染装备图标需要装备定义；入口处设置一次 */
export function setCardData(d: GameData): void {
  dataRef = d;
}

export interface CardOpts {
  enemy?: boolean;
  uid?: string;
  /** 羁绊档位底色：0~3（阵营线档位） */
  synTier?: number;
  /** 不显示装备槽（图鉴等） */
  noEquips?: boolean;
}

export function unitCard(def: UnitDef, st: CardStats, opts: CardOpts = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = `ucard tier-${def.tier} fac-${def.faction}${opts.enemy ? ' is-enemy' : ''}${def.token ? ' is-token' : ''}${opts.noEquips ? ' no-eq' : ''}`;
  el.dataset.def = def.id;
  if (opts.uid) el.dataset.uid = opts.uid;
  if (opts.synTier) el.dataset.syn = String(opts.synTier);
  el.style.setProperty('--fc', SYN_COLOR[def.faction]);
  const photo = isPhotoAvatar(def);
  el.innerHTML = `
    <div class="uc-stars"><i></i><i></i><i></i><b class="uc-xp"><s></s></b></div>
    ${def.role ? `<img class="uc-role" src="${ui(`role_${def.role}`)}" alt="${ROLE_NAME[def.role]}" draggable="false">` : ''}
    <img class="uc-fac" src="${ui(`faction_${def.faction}`)}" alt="${FACTION_NAME[def.faction]}" draggable="false">
    <div class="uc-ava"><img class="${photo ? 'is-photo' : ''}" src="${avatarUrl(def)}" alt="" draggable="false"><span class="uc-flash"></span></div>
    <div class="uc-name" style="--nl:${nameLen(def.name)}">${esc(def.name)}</div>
    ${opts.noEquips ? '' : `<div class="uc-eqs">${EQUIP_SLOTS.map((s) => `<i class="uc-eq" data-slot="${s}"></i>`).join('')}</div>`}
    <div class="uc-atk"><span></span></div>
    <div class="uc-hp"><span></span><em class="uc-shield"></em></div>`;
  setCardStats(el, { ...st, equips: st.equips ?? {} });
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
  if (st.equips) setEquips(el, st.equips);
}

/** 装备小格：空槽显示 slot_* 占位，已装备显示图标，金色用 gold_frame 边框 */
export function setEquips(el: HTMLElement, eq: UnitEquips): void {
  el.querySelectorAll<HTMLElement>('.uc-eq').forEach((c) => {
    const slot = c.dataset.slot as EquipSlot;
    const e = eq[slot];
    const def = e ? dataRef?.equipsById[e.defId] : undefined;
    const key = e ? `${e.defId}:${e.gold ? 1 : 0}` : '-';
    if (c.dataset.k === key) return;
    c.dataset.k = key;
    c.classList.toggle('is-on', !!def);
    c.classList.toggle('is-gold', !!e?.gold);
    c.innerHTML = def ? `<img src="${assetUrl(def.icon)}" alt="${esc(def.name)}" draggable="false">` : '';
    c.title = def ? `${def.name}${e?.gold ? '（金）' : ''}` : SLOT_NAME[slot];
  });
}

export function setShield(el: HTMLElement, n: number): void {
  el.classList.toggle('has-shield', n > 0);
  const s = el.querySelector('.uc-shield') as HTMLElement | null;
  if (s) s.textContent = n > 0 ? String(n) : '';
}

/** 商店装备卡（金色版用 gold_frame） */
export function equipCard(def: EquipDef, gold = false): HTMLElement {
  const el = document.createElement('div');
  el.className = `icard ecard slot-${def.slot}${gold ? ' is-gold' : ''}`;
  el.dataset.equip = def.id;
  el.innerHTML = `<img class="ic-img" src="${assetUrl(def.icon)}" alt="" draggable="false"><div class="ic-name">${gold ? '金·' : ''}${esc(def.name)}</div><b class="ic-slot"><img src="${ui(`slot_${def.slot}`)}" alt="">${SLOT_NAME[def.slot]}</b>`;
  return el;
}

/** 商店消耗品卡 */
export function consumableCard(def: ConsumableDef): HTMLElement {
  const el = document.createElement('div');
  el.className = 'icard ccard';
  el.dataset.cons = def.id;
  el.innerHTML = `<img class="ic-img" src="${assetUrl(def.icon)}" alt="" draggable="false"><div class="ic-name">${esc(def.name)}</div><b class="ic-team">${def.targetKind === 'unit' ? '选单位' : '即用'}</b>`;
  return el;
}

/** 免费槽标签文案 */
export const FREE_LABEL: Record<FreeReason, string> = { levelUp: '进化奖励', event: '头条赠送', pve: 'PVE 奖励' };

/** 价格胶囊（免费槽按来源显示） */
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

const EFFECT_NAME: Record<string, string> = {
  steal: '挖角', explode: '自爆', doubleStats: '属性翻倍', revive: '复活', chain: '连杀', summon: '召唤', destroy: '秒杀',
  copyStats: '吞并', multiAttack: '连击', damage: '突袭', buff: '加持', shield: '护盾', heal: '回血', gold: '进账', reroll: '刷新',
  discount: '打折', pushBack: '后撤', pullFront: '上前', swapPosition: '换位',
};
/** 大字技能名：描述里"名字：效果"的前半段（≤8 字），否则按效果类型 */
export function skillName(def: UnitDef | undefined, effect?: string): string {
  const d = def?.ability?.desc ?? '';
  const m = /^([^：:，,（(]{2,8})[：:]/.exec(d);
  if (m && !/^(开战|阵亡|受伤|击杀|购买|出售|进化|回合|友军|装上|攻击|被|敌方|每|召唤)/.test(m[1])) return m[1];
  return EFFECT_NAME[effect ?? def?.ability?.effect ?? ''] ?? def?.name ?? '技能';
}

/** 一张小头像（列表/榜单用） */
export function miniAvatar(data: GameData, defId: string, cls = 'mini-ava'): string {
  const d = data.unitsById[defId];
  if (!d) return '';
  return `<span class="${cls} tier-${d.tier}"><img src="${avatarUrl(d)}" alt="${esc(d.name)}" class="${isPhotoAvatar(d) ? 'is-photo' : ''}"></span>`;
}

/** 档位盾图标 */
export const tierShield = (tier: number, cls = 'tier-shield'): string => (tier > 0 ? `<img class="${cls}" src="${ui(`tier_${Math.min(3, tier)}`)}" alt="${tier} 档">` : '');

/** 羁绊胶囊：图标 + 名字 + 计数/下一档 + 档位盾（ART 9.4） */
export function synergyChip(st: SynergyState, opts: { compact?: boolean } = {}): HTMLElement {
  const el = document.createElement('button');
  const max = st.thresholds[st.thresholds.length - 1];
  const nextAt = st.tier < st.thresholds.length ? st.thresholds[st.tier] : max;
  el.className = `syn syn--t${st.tier}${st.count ? '' : ' is-zero'}${opts.compact ? ' is-compact' : ''}`;
  el.dataset.key = st.key;
  el.style.setProperty('--sc', SYN_COLOR[st.key]);
  el.innerHTML = `<img class="syn-ico" src="${synIcon(st.key)}" alt="">${opts.compact ? '' : `<span class="syn-name">${esc(st.name)}</span>`}<b>${st.tier >= st.thresholds.length ? Math.min(st.count, 9) : `${Math.min(st.count, 9)}/${nextAt}`}</b>${tierShield(st.tier)}`;
  return el;
}

/** 羁绊详情：各档说明（点徽章看） */
export function synergyDetailHtml(st: SynergyState): string {
  const rows = st.thresholds
    .map((t, i) => `<li class="${st.tier > i ? 'on' : ''}">${tierShield(i + 1, 'tier-shield sm')}<b>${t} 个</b><span>${esc(st.descs[i] ?? '')}</span></li>`)
    .join('');
  const next = st.next ? `再凑 ${st.next} 个升到下一档` : st.tier ? '已满档！' : '';
  return `<div class="syn-detail"><div class="syn-detail-head"><img src="${synIcon(st.key)}" alt=""><b>${esc(st.name)}</b><span>当前 ${st.count} 个${next ? ` · ${next}` : ''}</span></div><ul>${rows}</ul></div>`;
}

/** 热度血条颜色（>50% 绿、>25% 金、其余红） */
export const hpColor = (hp: number, max = 20): string => (hp / max > 0.5 ? '#58C65C' : hp / max > 0.25 ? '#FFC53D' : '#F25757');
