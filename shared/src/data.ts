// 内容数据校验（纯函数，不用 fs；前端 JSON import 后直接传进来）。
// 宽松规范化（别名/缺省值）+ 严格报错（未知触发器、缺字段、引用不存在的 id）。
import {
  EFFECTS, FACTIONS, TARGETS, TRIGGERS, TUTORIAL_STEPS,
  type Ability, type EventEffect, type Faction, type GameData, type HeadlineDef, type ItemDef, type ItemEffect,
  type SurpriseDef, type Target, type Tier, type TutorialDef, type UnitDef,
} from './types';

export class DataError extends Error {
  constructor(public readonly problems: string[]) {
    super(`游戏数据校验失败（${problems.length} 处）：\n- ${problems.join('\n- ')}`);
    this.name = 'DataError';
  }
}

export interface RawGameData {
  units: unknown;
  items: unknown;
  headlines: unknown;
  surprises: unknown;
  tutorial?: unknown;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown, d: number): number => (isNum(v) ? v : d);

/** 顶层可以是数组，也可以是 {units: [...]} 这种单数组包装 */
function unwrapArray(raw: unknown): unknown[] | null {
  if (Array.isArray(raw)) return raw;
  if (isObj(raw)) {
    if (isObj(raw.default)) return unwrapArray(raw.default);
    if (Array.isArray(raw.default)) return raw.default;
    const arrays = Object.values(raw).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0] as unknown[];
  }
  return null;
}

const FACTION_ALIAS: Record<string, Faction> = {
  open: 'open', '开源': 'open', opensource: 'open',
  closed: 'closed', '闭源': 'closed', closedsource: 'closed',
  compute: 'compute', '算力': 'compute',
  folk: 'folk', '民间': 'folk',
};
function faction(v: unknown): Faction | null {
  if (typeof v !== 'string') return null;
  return FACTION_ALIAS[v] ?? FACTION_ALIAS[v.toLowerCase()] ?? null;
}

/** "randomFriend(2)" → {target:'randomFriend', n:2} */
export function parseTarget(v: unknown): { target: Target; n?: number } | null {
  if (typeof v !== 'string') return null;
  const m = /^(\w+)(?:\((\d+)\))?$/.exec(v.trim());
  if (!m) return null;
  if (!(TARGETS as readonly string[]).includes(m[1])) return null;
  return { target: m[1] as Target, n: m[2] ? Number(m[2]) : undefined };
}

function normAbility(raw: unknown, at: string, p: string[]): Ability | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) return void p.push(`${at}: ability 应为对象`);
  const trigger = raw.trigger as string;
  const effect = raw.effect as string;
  if (!(TRIGGERS as readonly string[]).includes(trigger)) p.push(`${at}: 未知 trigger "${String(trigger)}"`);
  if (!(EFFECTS as readonly string[]).includes(effect)) p.push(`${at}: 未知 effect "${String(effect)}"`);
  const t = parseTarget(raw.target ?? 'self');
  if (!t) p.push(`${at}: 未知 target "${String(raw.target)}"`);
  if (!isStr(raw.desc)) p.push(`${at}: ability 缺少 desc`);
  const a: Ability = {
    trigger: trigger as Ability['trigger'],
    effect: effect as Ability['effect'],
    target: t?.target ?? 'self',
    desc: isStr(raw.desc) ? raw.desc : '',
  };
  for (const k of ['amount', 'atk', 'hp', 'n', 'count'] as const) {
    if (raw[k] !== undefined) {
      if (!isNum(raw[k])) p.push(`${at}: ${k} 应为数字`);
      else a[k] = raw[k] as number;
    }
  }
  const n = t?.n ?? a.n;
  if (n !== undefined) a.n = n;
  if (typeof raw.permanent === 'boolean') a.permanent = raw.permanent;
  if (typeof raw.perLevel === 'boolean') a.perLevel = raw.perLevel;
  const unitId = raw.unitId ?? raw.unit ?? raw.summon;
  if (typeof unitId === 'string') a.unitId = unitId;
  return a;
}

function normUnit(raw: unknown, i: number, p: string[]): UnitDef | null {
  if (!isObj(raw)) return void p.push(`units[${i}] 不是对象`), null;
  const at = `单位 ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) p.push(`units[${i}]: 缺少 id`);
  if (!isStr(raw.name)) p.push(`${at}: 缺少 name`);
  const tier = raw.tier;
  if (!isNum(tier) || tier < 1 || tier > 6 || !Number.isInteger(tier)) p.push(`${at}: tier 应为 1~6`);
  const f = faction(raw.faction);
  if (!f) p.push(`${at}: faction 应为 open/closed/compute/folk`);
  if (!isNum(raw.atk) || raw.atk < 0) p.push(`${at}: atk 应为非负数字`);
  if (!isNum(raw.hp) || raw.hp < 1) p.push(`${at}: hp 应 ≥ 1`);
  const u: UnitDef = {
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    tier: (isNum(tier) ? tier : 1) as Tier,
    faction: f ?? 'folk',
    atk: num(raw.atk, 1),
    hp: num(raw.hp, 1),
    avatar: isStr(raw.avatar) ? raw.avatar : `units/${String(raw.id)}.svg`,
  };
  const ab = normAbility(raw.ability, at, p);
  if (ab) u.ability = ab;
  if (Array.isArray(raw.lines)) u.lines = raw.lines.filter(isStr);
  if (raw.token === true) u.token = true;
  return u;
}

function normItemEffect(raw: unknown, at: string, p: string[]): ItemEffect {
  if (!isObj(raw) || !isStr(raw.type)) {
    p.push(`${at}: effect 缺少 type`);
    return { type: 'gold', amount: 0 };
  }
  switch (raw.type) {
    case 'buff':
    case 'teamBuff': {
      const amt = num(raw.amount, 0);
      const hasAH = raw.atk !== undefined || raw.hp !== undefined;
      return { type: raw.type, atk: hasAH ? num(raw.atk, 0) : amt, hp: hasAH ? num(raw.hp, 0) : amt, permanent: raw.permanent !== false };
    }
    case 'shield':
    case 'gold':
      if (!isNum(raw.amount ?? raw.n)) p.push(`${at}: ${raw.type} 需要 amount`);
      return { type: raw.type, amount: num(raw.amount ?? raw.n, 0) };
    case 'summonToken': {
      const unitId = raw.unitId ?? raw.unit;
      if (!isStr(unitId)) p.push(`${at}: summonToken 需要 unitId`);
      return { type: 'summonToken', unitId: String(unitId) };
    }
    case 'copyStatsFrom':
    case 'levelUp':
    case 'pullFront':
    case 'transformRandomSameTier':
      return { type: raw.type };
    default:
      p.push(`${at}: 未知基建效果 "${raw.type}"`);
      return { type: 'gold', amount: 0 };
  }
}

const EVENT_TYPES = [
  'gold', 'priceMod', 'freeUnit', 'buffTeam', 'buffFaction', 'shopRerollFree', 'extraSlot', 'shieldAll', 'swapAll',
  'duplicate', 'sacrifice', 'nextTurnGold', 'enemyDebuff', 'rerollShop', 'levelUpRandom', 'lifeTrade',
] as const;

export function normEventEffect(raw: unknown, at: string, p: string[]): EventEffect {
  if (!isObj(raw) || !isStr(raw.type)) {
    p.push(`${at}: effect 缺少 type`);
    return { type: 'gold', amount: 0 };
  }
  const amount = num(raw.amount ?? raw.n, NaN);
  const need = (d?: number): number => {
    if (Number.isNaN(amount)) {
      if (d === undefined) p.push(`${at}: ${String(raw.type)} 需要 amount`);
      return d ?? 0;
    }
    return amount;
  };
  switch (raw.type) {
    case 'gold':
    case 'sacrifice':
    case 'nextTurnGold':
    case 'lifeTrade':
    case 'shieldAll':
      return { type: raw.type, amount: need() };
    case 'enemyDebuff':
      return { type: 'enemyDebuff', amount: Math.abs(need(1)) };
    case 'extraSlot':
      return { type: 'extraSlot', amount: need(1) };
    case 'priceMod': {
      const target = raw.target === 'item' || raw.target === 'all' ? raw.target : 'unit';
      return { type: 'priceMod', target, amount: need() };
    }
    case 'freeUnit': {
      const e: EventEffect = { type: 'freeUnit' };
      if (raw.faction !== undefined) {
        const f = faction(raw.faction);
        if (!f) p.push(`${at}: freeUnit.faction 非法`);
        else e.faction = f;
      }
      if (raw.tier !== undefined) {
        if (!isNum(raw.tier) || raw.tier < 1 || raw.tier > 6) p.push(`${at}: freeUnit.tier 应为 1~6`);
        else e.tier = raw.tier as Tier;
      }
      return e;
    }
    case 'buffTeam':
    case 'buffFaction': {
      const hasAH = raw.atk !== undefined || raw.hp !== undefined;
      const a = hasAH ? num(raw.atk, 0) : need();
      const h = hasAH ? num(raw.hp, 0) : a;
      const permanent = raw.permanent === true;
      if (raw.type === 'buffTeam') return { type: 'buffTeam', atk: a, hp: h, permanent };
      const f = faction(raw.faction);
      if (!f) p.push(`${at}: buffFaction 需要 faction`);
      return { type: 'buffFaction', faction: f ?? 'open', atk: a, hp: h, permanent };
    }
    case 'shopRerollFree':
    case 'swapAll':
    case 'duplicate':
    case 'rerollShop':
    case 'levelUpRandom':
      return { type: raw.type };
    default:
      p.push(`${at}: 未知事件效果 "${raw.type}"（可选：${EVENT_TYPES.join('/')}）`);
      return { type: 'gold', amount: 0 };
  }
}

function normItem(raw: unknown, i: number, p: string[]): ItemDef | null {
  if (!isObj(raw)) return void p.push(`items[${i}] 不是对象`), null;
  const at = `基建 ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) p.push(`items[${i}]: 缺少 id`);
  if (!isStr(raw.name)) p.push(`${at}: 缺少 name`);
  if (!isStr(raw.desc)) p.push(`${at}: 缺少 desc`);
  const effect = normItemEffect(raw.effect, at, p);
  const teamTypes = ['gold', 'teamBuff', 'summonToken'];
  let targetKind = raw.targetKind;
  if (targetKind !== 'unit' && targetKind !== 'team') {
    if (targetKind !== undefined) p.push(`${at}: targetKind 应为 unit/team`);
    targetKind = teamTypes.includes(effect.type) ? 'team' : 'unit';
  }
  const tier = raw.tier === 2 || raw.tier === 3 ? raw.tier : 1;
  return {
    id: String(raw.id),
    name: String(raw.name ?? raw.id),
    desc: String(raw.desc ?? ''),
    price: Math.max(0, num(raw.price, 3)),
    targetKind: targetKind as 'unit' | 'team',
    effect,
    icon: isStr(raw.icon) ? raw.icon : `items/${String(raw.id)}.svg`,
    tier,
  };
}

function normHeadline(raw: unknown, i: number, p: string[]): HeadlineDef | null {
  if (!isObj(raw)) return void p.push(`headlines[${i}] 不是对象`), null;
  const at = `头条 ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) p.push(`headlines[${i}]: 缺少 id`);
  if (!isStr(raw.title)) p.push(`${at}: 缺少 title`);
  if (!Array.isArray(raw.options) || raw.options.length !== 2) {
    p.push(`${at}: options 必须恰好 2 个`);
    return null;
  }
  const options = raw.options.map((o: unknown, k: number) => {
    const oo = isObj(o) ? o : {};
    if (!isStr(oo.label)) p.push(`${at}: options[${k}] 缺少 label`);
    return { label: String(oo.label ?? ''), effect: normEventEffect(oo.effect, `${at}.options[${k}]`, p) };
  }) as HeadlineDef['options'];
  const h: HeadlineDef = { id: String(raw.id), title: String(raw.title ?? ''), news: String(raw.news ?? ''), options };
  if (isStr(raw.icon)) h.icon = raw.icon;
  return h;
}

function normSurprise(raw: unknown, i: number, p: string[]): SurpriseDef | null {
  if (!isObj(raw)) return void p.push(`surprises[${i}] 不是对象`), null;
  const at = `突发 ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) p.push(`surprises[${i}]: 缺少 id`);
  if (!isStr(raw.title)) p.push(`${at}: 缺少 title`);
  const s: SurpriseDef = {
    id: String(raw.id),
    title: String(raw.title ?? ''),
    news: String(raw.news ?? ''),
    effect: normEventEffect(raw.effect, at, p),
    good: raw.good !== false,
  };
  if (isStr(raw.icon)) s.icon = raw.icon;
  return s;
}

function normTutorial(raw: unknown, p: string[]): TutorialDef | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (isObj(raw) && isObj(raw.default)) raw = raw.default;
  if (!isObj(raw)) return void p.push('tutorial 应为对象');
  if (!Array.isArray(raw.turns) || raw.turns.length === 0) p.push('tutorial.turns 应为非空数组');
  const turns = (Array.isArray(raw.turns) ? raw.turns : []).map((t: unknown, k: number) => {
    const tt = isObj(t) ? t : {};
    if (!Array.isArray(tt.units)) p.push(`tutorial.turns[${k}].units 应为数组`);
    if (!Array.isArray(tt.enemy)) p.push(`tutorial.turns[${k}].enemy 应为数组`);
    return {
      turn: num(tt.turn, k + 1),
      units: (Array.isArray(tt.units) ? tt.units : []).map(String),
      items: (Array.isArray(tt.items) ? tt.items : []).map(String),
      enemy: (Array.isArray(tt.enemy) ? tt.enemy : []).map((e: unknown) => {
        if (typeof e === 'string') return { defId: e };
        const ee = isObj(e) ? e : {};
        const out: { defId: string; atk?: number; hp?: number; level?: 1 | 2 | 3 } = { defId: String(ee.defId ?? ee.id ?? '') };
        if (isNum(ee.atk)) out.atk = ee.atk;
        if (isNum(ee.hp)) out.hp = ee.hp;
        if (ee.level === 2 || ee.level === 3) out.level = ee.level;
        return out;
      }),
    };
  });
  const steps: TutorialDef['steps'] = {};
  if (isObj(raw.steps)) {
    for (const [k, v] of Object.entries(raw.steps)) {
      if (!(TUTORIAL_STEPS as readonly string[]).includes(k)) p.push(`tutorial.steps: 未知步骤 "${k}"`);
      else if (typeof v === 'string') steps[k as keyof typeof steps] = { text: v };
      else if (isObj(v) && isStr(v.text)) steps[k as keyof typeof steps] = { text: v.text, ...(isStr(v.target) ? { target: v.target } : {}) };
      else p.push(`tutorial.steps.${k} 需要 text`);
    }
  }
  const t: TutorialDef = { seed: isStr(raw.seed) ? raw.seed : 'tutorial', turns, steps };
  if (isNum(raw.headlineTurn)) t.headlineTurn = raw.headlineTurn;
  if (isStr(raw.headline)) t.headline = raw.headline;
  return t;
}

function normList<T>(name: string, raw: unknown, fn: (r: unknown, i: number, p: string[]) => T | null, p: string[]): T[] {
  const arr = unwrapArray(raw);
  if (!arr) {
    p.push(`${name} 应为数组`);
    return [];
  }
  const out: T[] = [];
  arr.forEach((r, i) => {
    const v = fn(r, i, p);
    if (v) out.push(v);
  });
  return out;
}

function dupCheck(name: string, list: { id: string }[], p: string[]): void {
  const seen = new Set<string>();
  for (const x of list) {
    if (seen.has(x.id)) p.push(`${name}: 重复 id "${x.id}"`);
    seen.add(x.id);
  }
}

/** 建立索引（validateData 内部用；测试里拼数据也可用） */
export function indexData(d: Pick<GameData, 'units' | 'items' | 'headlines' | 'surprises' | 'tutorial'>): GameData {
  const unitsById: Record<string, UnitDef> = {};
  const itemsById: Record<string, ItemDef> = {};
  const shopUnitsByTier: Record<number, UnitDef[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const u of d.units) {
    unitsById[u.id] = u;
    if (!u.token) shopUnitsByTier[u.tier].push(u);
  }
  for (const it of d.items) itemsById[it.id] = it;
  return { ...d, unitsById, itemsById, shopUnitsByTier };
}

/** 校验并规范化原始 JSON，返回类型化 GameData；有错误时抛 DataError（problems 列出全部问题） */
export function validateData(raw: RawGameData): GameData {
  const p: string[] = [];
  const units = normList('units', raw.units, normUnit, p);
  const items = normList('items', raw.items, normItem, p);
  const headlines = normList('headlines', raw.headlines, normHeadline, p);
  const surprises = normList('surprises', raw.surprises, normSurprise, p);
  const tutorial = normTutorial(raw.tutorial, p);
  dupCheck('units', units, p);
  dupCheck('items', items, p);
  dupCheck('headlines', headlines, p);
  dupCheck('surprises', surprises, p);
  const data = indexData({ units, items, headlines, surprises, tutorial });

  // 引用检查
  for (const u of units) {
    if (u.ability?.effect === 'summon') {
      const id = u.ability.unitId ?? 'token_shuijun';
      if (!data.unitsById[id]) p.push(`单位 ${u.id}: summon 的 unitId "${id}" 不存在`);
    }
  }
  for (const it of items) {
    if (it.effect.type === 'summonToken' && !data.unitsById[it.effect.unitId]) p.push(`基建 ${it.id}: summonToken 的 unitId "${it.effect.unitId}" 不存在`);
  }
  const checkEv = (e: EventEffect, at: string): void => {
    if (e.type === 'freeUnit') {
      const pool = units.filter((u) => !u.token && (!e.faction || u.faction === e.faction) && (!e.tier || u.tier === e.tier));
      if (units.length && pool.length === 0) p.push(`${at}: freeUnit 找不到符合条件的单位`);
    }
  };
  headlines.forEach((h) => h.options.forEach((o, k) => checkEv(o.effect, `头条 ${h.id}.options[${k}]`)));
  surprises.forEach((s) => checkEv(s.effect, `突发 ${s.id}`));
  if (!units.some((u) => !u.token && u.tier === 1)) p.push('units: 至少需要一个 T1 商店单位');
  if (!data.unitsById.token_shuijun) p.push('units: 缺少民间羁绊召唤物 token_shuijun');
  if (tutorial) {
    for (const t of tutorial.turns) {
      for (const id of t.units) if (!data.unitsById[id]) p.push(`tutorial 回合 ${t.turn}: 未知单位 "${id}"`);
      for (const id of t.items ?? []) if (!data.itemsById[id]) p.push(`tutorial 回合 ${t.turn}: 未知基建 "${id}"`);
      for (const e of t.enemy) if (!data.unitsById[e.defId]) p.push(`tutorial 回合 ${t.turn}: 未知敌方单位 "${e.defId}"`);
    }
    if (tutorial.headline && !headlines.some((h) => h.id === tutorial.headline)) p.push(`tutorial.headline "${tutorial.headline}" 不存在`);
  }
  if (p.length) throw new DataError(p);
  return data;
}

export { FACTIONS };
