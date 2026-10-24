// 内容数据校验（纯函数，不用 fs；前端 JSON import 后直接传进来）。
// 宽松规范化（别名/缺省值/按 id 回退到内置默认）+ 严格报错（未知触发器、缺字段、引用不存在的 id）。
// 非致命问题写进 GameData.warnings（缺 2.0 新文件、缺 role、效果写法读不懂而回退默认……）。
import {
  ATTACK_TARGETS, EFFECTS, ENEMY_TARGETS, EQUIP_SLOTS, FACTIONS, ROLES, TARGETS, TRIGGERS, TUTORIAL_STEPS,
  type Ability, type AbilityChoice, type ArenaDef, type ArenaRules, type Archetype, type AttackTarget, type ConsumableDef, type ConsumableEffect,
  type EquipDef, type EquipEffect, type EquipSlot, type EventEffect, type Faction, type GameData, type HeadlineDef, type OpponentPreset,
  type PveDef, type PveRewardSpec, type PveUnit, type Role, type Side, type SynergyKey, type SurpriseDef, type Target, type TargetFilter, type Tier, type TutorialDef, type UnitDef, type UnitLines,
} from './types';
import { DEFAULT_ARENAS, DEFAULT_CONSUMABLES, DEFAULT_EQUIPS, DEFAULT_OPPONENTS, DEFAULT_PVE, DEFAULT_PVE_POOL } from './defaults';

export class DataError extends Error {
  constructor(public readonly problems: string[]) {
    super(`游戏数据校验失败（${problems.length} 处）：\n- ${problems.join('\n- ')}`);
    this.name = 'DataError';
  }
}

export interface RawGameData {
  units: unknown;
  headlines: unknown;
  surprises: unknown;
  tutorial?: unknown;
  equips?: unknown;
  consumables?: unknown;
  arenas?: unknown;
  opponents?: unknown;
  pve?: unknown;
  /** 1.0 的基建，2.0 不再使用（传了只给提醒） */
  items?: unknown;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const num = (v: unknown, d: number): number => (isNum(v) ? v : d);

/** 顶层可以是数组，也可以是 {units: [...]} 这种单数组包装（允许带 _schema 之类的说明字段） */
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
export function faction(v: unknown): Faction | null {
  if (typeof v !== 'string') return null;
  return FACTION_ALIAS[v] ?? FACTION_ALIAS[v.toLowerCase()] ?? null;
}
const ROLE_ALIAS: Record<string, Role> = {
  multi: 'multi', '多刀': 'multi', multiattack: 'multi',
  shield: 'shield', '护盾': 'shield',
  summon: 'summon', '召唤': 'summon',
  explode: 'explode', '自爆': 'explode', explosion: 'explode',
  growth: 'growth', '成长': 'growth', grow: 'growth',
  economy: 'economy', '经济': 'economy', eco: 'economy',
};
/** 2.0 的旧职业（2.1 起废弃，DESIGN 16）：校验时给出明确的迁移提示 */
export const LEGACY_ROLES: Record<string, string> = {
  researcher: '研究员', '研究员': '研究员', trader: '商人', '商人': '商人', idol: '偶像', '偶像': '偶像', engineer: '工程师', '工程师': '工程师',
};
export const ROLE_HINT = 'multi/shield/summon/explode/growth/economy（多刀/护盾/召唤/自爆/成长/经济）';
export function role(v: unknown): Role | null {
  if (typeof v !== 'string') return null;
  return ROLE_ALIAS[v] ?? ROLE_ALIAS[v.toLowerCase()] ?? null;
}
/** 非法 role 的报错文案（旧职业给出迁移提示） */
export function roleProblem(at: string, field: string, v: unknown): string {
  const legacy = typeof v === 'string' ? LEGACY_ROLES[v] ?? LEGACY_ROLES[v.toLowerCase()] : undefined;
  if (legacy) return `${at}: ${field} "${String(v)}" 是 2.0 的旧职业（${legacy}），2.1 已改为打法关键词，请改成 ${ROLE_HINT} 之一（DESIGN 第 16 节）`;
  return `${at}: ${field} 应为 ${ROLE_HINT}，收到 "${String(v)}"`;
}
/** 羁绊线 key（阵营或关键词）；非法时写 problem 并返回 null */
function synergyKeyOf(v: unknown, at: string, field: string, p: string[]): SynergyKey | null {
  const k = (faction(v) ?? role(v)) as SynergyKey | null;
  if (k) return k;
  p.push(typeof v === 'string' && (LEGACY_ROLES[v] ?? LEGACY_ROLES[v.toLowerCase()]) ? roleProblem(at, field, v) : `${at}: ${field} 应为阵营 open/closed/compute/folk 或打法关键词 ${ROLE_HINT}，收到 "${String(v)}"`);
  return null;
}

/** "randomFriend(2)" → {target:'randomFriend', n:2} */
export function parseTarget(v: unknown): { target: Target; n?: number } | null {
  if (typeof v !== 'string') return null;
  const m = /^(\w+)(?:\((\d+)\))?$/.exec(v.trim());
  if (!m) return null;
  if (!(TARGETS as readonly string[]).includes(m[1])) return null;
  return { target: m[1] as Target, n: m[2] ? Number(m[2]) : undefined };
}

function normFilter(raw: unknown, at: string, p: string[]): TargetFilter | undefined {
  if (!isObj(raw)) {
    p.push(`${at}: filter 应为对象`);
    return undefined;
  }
  const f: TargetFilter = {};
  if (raw.faction !== undefined) {
    const fa = faction(raw.faction);
    if (!fa) p.push(`${at}: filter.faction 非法`);
    else f.faction = fa;
  }
  if (raw.role !== undefined) {
    const r = role(raw.role);
    if (!r) p.push(roleProblem(at, 'filter.role', raw.role));
    else f.role = r;
  }
  for (const k of ['minTier', 'maxTier'] as const) {
    const v = raw[k];
    if (v !== undefined) {
      if (!isNum(v) || v < 1 || v > 6) p.push(`${at}: filter.${k} 应为 1~6`);
      else f[k] = v;
    }
  }
  return f;
}

/** 解析技能的可选字段（基础技能与 choices 共用） */
function normAbilityExtras(raw: Obj, a: Partial<Ability>, at: string, p: string[]): void {
  for (const k of ['amount', 'atk', 'hp', 'n', 'count', 'maxHp', 'maxHpPerLevel'] as const) {
    if (raw[k] !== undefined) {
      if (!isNum(raw[k])) p.push(`${at}: ${k} 应为数字`);
      else a[k] = raw[k] as number;
    }
  }
  for (const k of ['permanent', 'perLevel', 'consume'] as const) {
    if (raw[k] !== undefined) {
      if (typeof raw[k] !== 'boolean') p.push(`${at}: ${k} 应为布尔`);
      else a[k] = raw[k] as boolean;
    }
  }
  const unitId = raw.unitId ?? raw.unit ?? raw.summon;
  if (typeof unitId === 'string') a.unitId = unitId;
  if (raw.filter !== undefined) {
    const f = normFilter(raw.filter, at, p);
    if (f) a.filter = f;
  }
}

function normAbility(raw: unknown, at: string, p: string[]): Ability | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (!isObj(raw)) return void p.push(`${at}: ability 应为对象`);
  const trigger = raw.trigger as string;
  const effect = raw.effect as string;
  if (!(TRIGGERS as readonly string[]).includes(trigger)) p.push(`${at}: 未知 trigger "${String(trigger)}"`);
  if (!(EFFECTS as readonly string[]).includes(effect)) p.push(`${at}: 未知 effect "${String(effect)}"（可选：${EFFECTS.join('/')}）`);
  const t = parseTarget(raw.target ?? 'self');
  if (!t) p.push(`${at}: 未知 target "${String(raw.target)}"`);
  if (!isStr(raw.desc)) p.push(`${at}: ability 缺少 desc`);
  const a: Ability = {
    trigger: trigger as Ability['trigger'],
    effect: effect as Ability['effect'],
    target: t?.target ?? 'self',
    desc: isStr(raw.desc) ? raw.desc : '',
  };
  if (isStr(raw.name)) a.name = raw.name;
  if (isStr(raw.shortDesc)) a.shortDesc = raw.shortDesc;
  normAbilityExtras(raw, a, at, p);
  const n = t?.n ?? a.n;
  if (n !== undefined) a.n = n;
  if (raw.choices !== undefined) {
    if (!Array.isArray(raw.choices) || raw.choices.length === 0) p.push(`${at}: choices 应为非空数组`);
    else {
      a.choices = raw.choices.map((c: unknown, k: number) => {
        const cat = `${at}.choices[${k}]`;
        if (!isObj(c)) {
          p.push(`${cat} 应为对象`);
          return {};
        }
        const out: AbilityChoice = {};
        if (c.effect !== undefined) {
          if (!(EFFECTS as readonly string[]).includes(c.effect as string)) p.push(`${cat}: 未知 effect "${String(c.effect)}"`);
          else out.effect = c.effect as Ability['effect'];
        }
        if (c.target !== undefined) {
          const ct = parseTarget(c.target);
          if (!ct) p.push(`${cat}: 未知 target "${String(c.target)}"`);
          else {
            out.target = ct.target;
            if (ct.n !== undefined) out.n = ct.n;
          }
        }
        if (isStr(c.desc)) out.desc = c.desc;
        normAbilityExtras(c, out, cat, p);
        return out;
      });
    }
  }
  return a;
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : isStr(v) ? [v] : []);

/** lines：数组 = 通用台词；对象 = {onSynergy, 其余任意键的数组合并为通用}；也接受单位顶层的 onSynergy */
function normLines(raw: Obj): UnitLines | undefined {
  const general: string[] = [];
  let onSynergy: string[] = [];
  const l = raw.lines;
  if (Array.isArray(l)) general.push(...l.filter(isStr));
  else if (isObj(l)) {
    for (const [k, v] of Object.entries(l)) {
      if (k === 'onSynergy' || k === 'synergy') onSynergy.push(...strList(v));
      else general.push(...strList(v));
    }
  }
  if (raw.onSynergy !== undefined) onSynergy = [...onSynergy, ...strList(raw.onSynergy)];
  if (!general.length && !onSynergy.length) return undefined;
  const out: UnitLines = { general };
  if (onSynergy.length) out.onSynergy = onSynergy;
  return out;
}

function normUnit(raw: unknown, i: number, p: string[], w: string[]): UnitDef | null {
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
  if (raw.role !== undefined && raw.role !== null && raw.role !== '' && raw.role !== 'none') {
    const r = role(raw.role);
    if (!r) p.push(roleProblem(at, 'role', raw.role));
    else u.role = r;
  }
  const ab = normAbility(raw.ability, at, p);
  if (ab) u.ability = ab;
  const atkT = raw.attackTarget ?? (isObj(raw.ability) ? raw.ability.attackTarget : undefined);
  if (atkT !== undefined) {
    if (!(ATTACK_TARGETS as readonly string[]).includes(atkT as string)) p.push(`${at}: attackTarget 应为 ${ATTACK_TARGETS.join('/')}`);
    else u.attackTarget = atkT as AttackTarget;
  }
  const lines = normLines(raw);
  if (lines) u.lines = lines;
  if (raw.token === true) u.token = true;
  void w;
  return u;
}

// ───────────── 装备 / 消耗品 / 赛场 / 对手 / PVE ─────────────

const SLOT_ALIAS: Record<string, EquipSlot> = {
  weapon: 'weapon', '武器': 'weapon', arms: 'weapon',
  armor: 'armor', armour: 'armor', '防具': 'armor',
  trinket: 'trinket', accessory: 'trinket', '饰品': 'trinket',
};
const EQUIP_NUM_KEYS = ['atk', 'hp', 'splash', 'extraAttackChance', 'startShield', 'shieldReflect', 'immuneBelow', 'growAtk', 'growHp', 'abilityRepeat', 'sellGold', 'turnGold'] as const;

/**
 * 读装备效果。支持两种写法：
 * 1) 内容侧的类型写法 {type:'stat'|'extraAttack'|'retarget'|'startShield'|'revive'|'growth'|'copyNeighbor'|'abilityRepeat'|'income', …}
 *    （也可以是这些对象的数组，效果叠加）；
 * 2) 引擎的扁平写法 {atk, hp, startShield, revive:{hp}, …}（EquipEffect）。
 * 一个可识别字段都没有时返回 null（交给按 id 回退）。
 */
function parseEquipEffect(raw: unknown, at: string, p: string[]): EquipEffect | null {
  if (Array.isArray(raw)) {
    const parts = raw.map((r, i) => parseEquipEffect(r, `${at}[${i}]`, p)).filter((x): x is EquipEffect => !!x);
    return parts.length ? parts.reduce((a, b) => addEquipEffects(a, b), {}) : null;
  }
  if (!isObj(raw)) return null;
  const e: EquipEffect = {};
  const n = (k: string, v: unknown): number | undefined => {
    if (v === undefined) return undefined;
    if (!isNum(v)) {
      p.push(`${at}: ${k} 应为数字`);
      return undefined;
    }
    return v;
  };
  const set = <K extends keyof EquipEffect>(k: K, v: EquipEffect[K] | undefined) => {
    if (v !== undefined) e[k] = v;
  };
  if (isStr(raw.type)) {
    switch (raw.type) {
      case 'stat':
        set('atk', n('atk', raw.atk));
        set('hp', n('hp', raw.hp));
        set('splash', n('splash', raw.splash));
        set('immuneBelow', n('immuneAtMost', raw.immuneAtMost ?? raw.immuneBelow));
        if (raw.ignoreShield === true) e.ignoreShield = true;
        break;
      case 'extraAttack':
        set('extraAttackChance', n('chance', raw.chance));
        break;
      case 'retarget':
        if (!(ATTACK_TARGETS as readonly string[]).includes(raw.target as string)) p.push(`${at}: retarget.target 应为 ${ATTACK_TARGETS.join('/')}`);
        else e.retarget = raw.target as AttackTarget;
        set('atk', n('atk', raw.atk));
        break;
      case 'startShield':
        set('startShield', n('amount', raw.amount));
        set('shieldReflect', n('reflect', raw.reflect));
        break;
      case 'revive': {
        const r: NonNullable<EquipEffect['revive']> = {};
        const hp = n('hp', raw.hp);
        const ratio = n('hpRatio', raw.hpRatio ?? raw.ratio);
        if (hp !== undefined) r.hp = hp;
        if (ratio !== undefined) r.ratio = ratio;
        if (hp === undefined && ratio === undefined) r.hp = 1;
        r.to = raw.to === 'same' ? 'same' : 'back';
        e.revive = r;
        break;
      }
      case 'growth':
        set('growAtk', n('atk', raw.atk));
        set('growHp', n('hp', raw.hp));
        break;
      case 'copyNeighbor': {
        const st = (Array.isArray(raw.stats) ? raw.stats : [raw.stats ?? 'atk']).filter((x): x is 'atk' | 'hp' => x === 'atk' || x === 'hp');
        if (!st.length) p.push(`${at}: copyNeighbor.stats 应为 ["atk"] 或 ["atk","hp"]`);
        else e.copyNeighbor = st;
        break;
      }
      case 'abilityRepeat':
        set('abilityRepeat', n('times', raw.times ?? raw.amount));
        break;
      case 'income':
        set('turnGold', n('perTurn', raw.perTurn));
        set('sellGold', n('onSell', raw.onSell));
        break;
      default:
        p.push(`${at}: 未知装备效果 type "${raw.type}"（可选：stat/extraAttack/retarget/startShield/revive/growth/copyNeighbor/abilityRepeat/income）`);
        return null;
    }
    return e;
  }
  // 扁平写法
  let known = 0;
  for (const [k, v] of Object.entries(raw)) {
    if ((EQUIP_NUM_KEYS as readonly string[]).includes(k)) {
      const x = n(k, v);
      if (x !== undefined) (e as Record<string, number>)[k] = x;
      known++;
    } else if (k === 'ignoreShield') {
      e.ignoreShield = v === true;
      known++;
    } else if (k === 'retarget' && (ATTACK_TARGETS as readonly string[]).includes(v as string)) {
      e.retarget = v as AttackTarget;
      known++;
    } else if (k === 'revive' && isObj(v)) {
      e.revive = { ...(isNum(v.hp) ? { hp: v.hp } : {}), ...(isNum(v.ratio) ? { ratio: v.ratio } : {}), to: v.to === 'same' ? 'same' : 'back' };
      known++;
    } else if (k === 'copyNeighbor' && Array.isArray(v)) {
      e.copyNeighbor = v.filter((x): x is 'atk' | 'hp' => x === 'atk' || x === 'hp');
      known++;
    }
  }
  return known ? e : null;
}

/** 两个装备效果叠加（数值相加，其余取后者/并集） */
export function addEquipEffects(a: EquipEffect, b: EquipEffect): EquipEffect {
  const t: EquipEffect = { ...a };
  for (const key of EQUIP_NUM_KEYS) {
    const v = b[key];
    if (v !== undefined) (t as Record<string, number>)[key] = ((t as Record<string, number>)[key] ?? 0) + v;
  }
  if (b.ignoreShield) t.ignoreShield = true;
  if (b.retarget) t.retarget = b.retarget;
  if (b.revive) {
    const best = (r?: EquipEffect['revive']) => (r ? Math.max(r.hp ?? 0, (r.ratio ?? 0) * 100) : -1);
    if (best(b.revive) > best(t.revive)) t.revive = b.revive;
  }
  if (b.copyNeighbor) t.copyNeighbor = [...new Set([...(t.copyNeighbor ?? []), ...b.copyNeighbor])];
  if (t.extraAttackChance !== undefined) t.extraAttackChance = Math.min(1, t.extraAttackChance);
  return t;
}

function normEquip(raw: unknown, i: number, p: string[], w: string[]): EquipDef | null {
  if (!isObj(raw)) return void p.push(`equips[${i}] 不是对象`), null;
  const at = `装备 ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) return void p.push(`equips[${i}]: 缺少 id`), null;
  const def = DEFAULT_EQUIPS.find((d) => d.id === raw.id);
  const slot = SLOT_ALIAS[String(raw.slot ?? '').toLowerCase()] ?? SLOT_ALIAS[String(raw.slot ?? '')] ?? def?.slot;
  if (!slot) p.push(`${at}: slot 应为 weapon/armor/trinket`);
  if (!isStr(raw.name)) p.push(`${at}: 缺少 name`);
  let effect = parseEquipEffect(raw.effect, `${at}.effect`, p);
  let goldEffect = parseEquipEffect(raw.goldEffect ?? raw.gold_effect ?? raw.gold, `${at}.goldEffect`, p);
  if (!effect) {
    if (def) {
      effect = def.effect;
      if (raw.effect !== undefined) w.push(`${at}: effect 写法引擎读不懂，按 id 使用内置效果（字段见 ENGINE_NOTES「装备效果」）`);
    } else {
      p.push(`${at}: effect 缺少可识别字段（atk/hp/startShield/revive/…，见 ENGINE_NOTES）`);
      effect = {};
    }
  }
  if (!goldEffect) {
    if (def) {
      goldEffect = def.goldEffect;
      if ((raw.goldEffect ?? raw.gold_effect) !== undefined) w.push(`${at}: goldEffect 写法引擎读不懂，按 id 使用内置金色效果`);
    } else {
      // 没写金色效果：数值 ×2
      goldEffect = doubleEquipEffect(effect);
    }
  }
  return {
    id: raw.id,
    name: String(raw.name ?? def?.name ?? raw.id),
    slot: slot ?? 'weapon',
    desc: isStr(raw.desc) ? raw.desc : def?.desc ?? '',
    goldDesc: isStr(raw.goldDesc) ? raw.goldDesc : isStr(raw.gold_desc) ? raw.gold_desc : def?.goldDesc ?? '金色：效果 ×2',
    ...(isStr(raw.shortDesc) ? { shortDesc: raw.shortDesc } : {}),
    ...(isStr(raw.goldShortDesc) ? { goldShortDesc: raw.goldShortDesc } : {}),
    price: Math.max(0, num(raw.price, def?.price ?? 3)),
    effect,
    goldEffect,
    icon: isStr(raw.icon) ? raw.icon : `items/${raw.id}.svg`,
  };
}

/** 数值类效果 ×k（概率封顶 1；布尔/枚举不变） */
export function scaleEquipEffect(e: EquipEffect, k: number): EquipEffect {
  if (k === 1) return e;
  const out: EquipEffect = { ...e };
  for (const key of EQUIP_NUM_KEYS) {
    const v = e[key];
    if (v !== undefined) (out as Record<string, number>)[key] = v * k;
  }
  if (out.extraAttackChance !== undefined) out.extraAttackChance = Math.min(1, out.extraAttackChance);
  return out;
}
export function doubleEquipEffect(e: EquipEffect): EquipEffect {
  return scaleEquipEffect(e, 2);
}

function normConsumableEffect(raw: unknown): ConsumableEffect | null {
  if (!isObj(raw) || !isStr(raw.type)) return null;
  const amount = num(raw.amount ?? raw.n, NaN);
  switch (raw.type) {
    case 'freeRerolls':
    case 'rerollFree':
    case 'reroll':
      return { type: 'freeRerolls', amount: Number.isNaN(amount) ? 3 : amount };
    case 'levelUp':
    case 'levelUpRandom':
      return { type: 'levelUpRandom' };
    case 'transform':
    case 'transformRandomSameTier':
      return { type: 'transform' };
    case 'gold':
      return Number.isNaN(amount) ? null : { type: 'gold', amount };
    case 'buff':
      return { type: 'buff', atk: num(raw.atk, num(raw.amount, 0)), hp: num(raw.hp, num(raw.amount, 0)), permanent: raw.permanent !== false };
    default:
      return null;
  }
}

function normConsumable(raw: unknown, i: number, p: string[], w: string[]): ConsumableDef | null {
  if (!isObj(raw)) return void p.push(`consumables[${i}] 不是对象`), null;
  const at = `消耗品 ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) return void p.push(`consumables[${i}]: 缺少 id`), null;
  const def = DEFAULT_CONSUMABLES.find((d) => d.id === raw.id);
  let effect = normConsumableEffect(raw.effect);
  if (!effect) {
    if (def) {
      effect = def.effect;
      if (raw.effect !== undefined) w.push(`${at}: effect 写法引擎读不懂，按 id 使用内置效果`);
    } else {
      p.push(`${at}: effect.type 应为 freeRerolls/levelUpRandom/transform/gold/buff`);
      effect = { type: 'gold', amount: 0 };
    }
  }
  let targetKind = raw.targetKind;
  if (targetKind !== 'unit' && targetKind !== 'team') targetKind = def?.targetKind ?? (effect.type === 'transform' || effect.type === 'buff' ? 'unit' : 'team');
  return {
    id: raw.id,
    name: String(raw.name ?? def?.name ?? raw.id),
    desc: isStr(raw.desc) ? raw.desc : def?.desc ?? '',
    price: Math.max(0, num(raw.price, def?.price ?? 1)),
    targetKind: targetKind as 'unit' | 'team',
    effect,
    icon: isStr(raw.icon) ? raw.icon : `items/${raw.id}.svg`,
  };
}


/**
 * 赛场规则：接受内容侧的 effect（单个或数组）：
 *   priceMod{kind:'unit'|'equip', amount, filter?{faction|role}}、statAll{atk,hp}、economy{goldPerTurn?,unitSlots?,rerollFree?,unitPriceMod?}、
 *   rerollBuff{slot,atk,hp}、shopSlots{kind:'unit'|'equip',amount}、summonBuff{atk,hp}、synergyBonus{key,amount}、startShield{amount,filter?}
 * 也接受引擎的 rules 对象（ArenaRules 字段）。
 */
function parseArenaRules(raw: unknown, at: string, p: string[]): ArenaRules | null {
  if (raw === undefined || raw === null) return null;
  if (isObj(raw) && !isStr(raw.type)) {
    // 引擎 ArenaRules 写法：直接认已知字段
    const keys = ['unitPriceMod', 'factionPriceMod', 'rolePriceMod', 'equipPriceMod', 'goldPerTurn', 'unitSlotsMod', 'equipSlotsMod', 'rerollFree',
      'rerollFrontBuff', 'rerollFrontCap', 'battleBuff', 'summonBuff', 'synergyBonus', 'startShield'];
    const r = Object.fromEntries(Object.entries(raw).filter(([k]) => keys.includes(k))) as ArenaRules;
    if (r.rolePriceMod) {
      const ro = role(r.rolePriceMod.role);
      if (!ro) p.push(roleProblem(at, 'rolePriceMod.role', r.rolePriceMod.role));
      else r.rolePriceMod = { ...r.rolePriceMod, role: ro };
    }
    if (r.synergyBonus) {
      r.synergyBonus = (Array.isArray(r.synergyBonus) ? r.synergyBonus : []).flatMap((b) => {
        const key = synergyKeyOf(b?.key, at, 'synergyBonus.key', p);
        return key ? [{ key, amount: num(b.amount, 1) }] : [];
      });
    }
    if (r.startShield?.filter) {
      const f = normFilter(r.startShield.filter, at, p);
      r.startShield = { ...r.startShield, ...(f ? { filter: f } : {}) };
    }
    return Object.keys(r).length ? r : null;
  }
  const items = (Array.isArray(raw) ? raw : [raw]).filter(isObj);
  const r: ArenaRules = {};
  let known = 0;
  const filt = (v: unknown) => (v === undefined ? undefined : normFilter(v, at, p));
  for (const it of items) {
    known++;
    switch (it.type) {
      case 'priceMod': {
        const amount = num(it.amount, -1);
        const f = isObj(it.filter) ? it.filter : {};
        const fa = faction(f.faction ?? it.faction);
        const roRaw = f.role ?? it.role;
        const ro = role(roRaw);
        if (roRaw !== undefined && !ro) p.push(roleProblem(at, 'priceMod.filter.role', roRaw));
        if (it.kind === 'equip' || it.kind === 'item') r.equipPriceMod = (r.equipPriceMod ?? 0) + amount;
        else if (fa) r.factionPriceMod = { faction: fa, amount };
        else if (ro) r.rolePriceMod = { role: ro, amount };
        else r.unitPriceMod = (r.unitPriceMod ?? 0) + amount;
        break;
      }
      case 'statAll':
        r.battleBuff = { atk: num(it.atk, 0), hp: num(it.hp, 0) };
        break;
      case 'economy':
        if (isNum(it.goldPerTurn)) r.goldPerTurn = it.goldPerTurn;
        if (isNum(it.unitSlots)) r.unitSlotsMod = it.unitSlots;
        if (isNum(it.equipSlots)) r.equipSlotsMod = it.equipSlots;
        if (it.rerollFree === true) r.rerollFree = true;
        if (isNum(it.unitPriceMod)) r.unitPriceMod = (r.unitPriceMod ?? 0) + it.unitPriceMod;
        if (isNum(it.equipPriceMod)) r.equipPriceMod = (r.equipPriceMod ?? 0) + it.equipPriceMod;
        break;
      case 'rerollBuff':
        r.rerollFrontBuff = { atk: num(it.atk, 1), hp: num(it.hp, 1) };
        if (isNum(it.cap)) r.rerollFrontCap = it.cap;
        break;
      case 'shopSlots':
        if (it.kind === 'equip') r.equipSlotsMod = (r.equipSlotsMod ?? 0) + num(it.amount, 1);
        else r.unitSlotsMod = (r.unitSlotsMod ?? 0) + num(it.amount, 1);
        break;
      case 'summonBuff':
        r.summonBuff = { atk: num(it.atk, 1), hp: num(it.hp, 1) };
        break;
      case 'synergyBonus': {
        const key = synergyKeyOf(it.key, at, 'synergyBonus.key', p);
        if (key) (r.synergyBonus ??= []).push({ key, amount: num(it.amount, 1) });
        break;
      }
      case 'startShield': {
        const ss: NonNullable<ArenaRules['startShield']> = { amount: num(it.amount, 2) };
        const f = filt(it.filter);
        if (f) ss.filter = f;
        r.startShield = ss;
        break;
      }
      default:
        known--;
        p.push(`${at}: 未知赛场效果 type "${String(it.type)}"（可选：priceMod/statAll/economy/rerollBuff/shopSlots/summonBuff/synergyBonus/startShield）`);
    }
  }
  return known ? r : null;
}

function normArena(raw: unknown, i: number, p: string[], w: string[]): ArenaDef | null {
  if (!isObj(raw)) return void p.push(`arenas[${i}] 不是对象`), null;
  const at = `赛场 ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) return void p.push(`arenas[${i}]: 缺少 id`), null;
  const def = DEFAULT_ARENAS.find((d) => d.id === raw.id || d.name === raw.name);
  let rules = parseArenaRules(raw.rules ?? raw.effects ?? raw.effect, at, p);
  if (!rules) {
    if (def) {
      rules = def.rules;
      w.push(`${at}: rules 写法引擎读不懂，按 id/名字使用内置「${def.name}」规则`);
    } else {
      w.push(`${at}: 没有可识别的 rules（字段见 ENGINE_NOTES「赛场」），本赛场无效果`);
      rules = {};
    }
  }
  const a: ArenaDef = { id: raw.id, name: String(raw.name ?? def?.name ?? raw.id), desc: isStr(raw.desc) ? raw.desc : def?.desc ?? '', rules };
  if (isStr(raw.icon)) a.icon = raw.icon;
  if (isStr(raw.hint)) a.hint = raw.hint;
  else if (def?.hint) a.hint = def.hint;
  return a;
}

function parseArchetype(raw: Obj, at: string, p: string[]): Archetype {
  const a: Archetype = {};
  const src = raw.archetype;
  const tryKey = (v: unknown) => {
    if (typeof v !== 'string') return;
    for (const part of v.split(/[+,/|:\s]+/)) {
      const f = faction(part);
      const r = role(part);
      if (f) a.faction = f;
      if (r) a.role = r;
      if (!f && !r && (LEGACY_ROLES[part] ?? LEGACY_ROLES[part.toLowerCase()])) p.push(roleProblem(at, 'archetype', part));
    }
  };
  if (isObj(src)) {
    tryKey(src.faction);
    tryKey(src.role);
    tryKey(src.key);
  } else tryKey(src);
  tryKey(raw.faction);
  tryKey(raw.role);
  return a;
}

function normOpponent(raw: unknown, i: number, p: string[]): OpponentPreset | null {
  if (!isObj(raw)) return void p.push(`opponents[${i}] 不是对象`), null;
  const at = `对手 ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) return void p.push(`opponents[${i}]: 缺少 id`), null;
  if (!isStr(raw.name)) p.push(`${at}: 缺少 name`);
  const archetype = parseArchetype(raw, at, p);
  if (!archetype.faction && !archetype.role) p.push(`${at}: archetype 需要 faction 或 role（如 {"faction":"compute"} 或 {"role":"summon"}）`);
  const o: OpponentPreset = { id: raw.id, name: String(raw.name ?? raw.id), avatar: isStr(raw.avatar) ? raw.avatar : 'units/botnet.svg', archetype };
  const eq = strList(raw.equips ?? raw.equipBias);
  if (eq.length) o.equips = eq;
  const core = strList(raw.core);
  if (core.length) o.core = core;
  if (isObj(raw.taunt)) o.taunt = { ...(isStr(raw.taunt.defeated) ? { defeated: raw.taunt.defeated } : {}), ...(isStr(raw.taunt.victory) ? { victory: raw.taunt.victory } : {}) };
  if (isStr(raw.desc)) o.desc = raw.desc;
  return o;
}

function normPve(raw: unknown, i: number, p: string[], w: string[]): PveDef | null {
  if (!isObj(raw)) return void p.push(`pve[${i}] 不是对象`), null;
  const at = `PVE ${String(raw.id ?? `#${i}`)}`;
  if (!isStr(raw.id)) return void p.push(`pve[${i}]: 缺少 id`), null;
  if (!isNum(raw.turn) || raw.turn < 1 || raw.turn > 20) p.push(`${at}: turn 应为 1~20`);
  const unitsRaw = raw.team ?? raw.units ?? raw.enemy;
  if (!Array.isArray(unitsRaw) || !unitsRaw.length) p.push(`${at}: team 应为非空数组`);
  const units: PveUnit[] = (Array.isArray(unitsRaw) ? unitsRaw : []).flatMap((e: unknown): PveUnit[] => {
    if (typeof e === 'string') return [{ defId: e }];
    if (!isObj(e)) return [];
    const u: PveUnit = { defId: String(e.defId ?? e.id ?? '') };
    if (isNum(e.atk)) u.atk = e.atk;
    if (isNum(e.hp)) u.hp = e.hp;
    if (e.level === 2 || e.level === 3) u.level = e.level;
    const n = isNum(e.count) ? Math.max(1, Math.min(7, e.count)) : 1;
    return Array.from({ length: n }, () => ({ ...u }));
  });
  const defs: UnitDef[] = [];
  if (Array.isArray(raw.defs)) {
    raw.defs.forEach((d, k) => {
      const u = normUnit(d, k, p, w);
      if (u) defs.push({ ...u, token: true });
    });
  }
  const pv: PveDef = { id: raw.id, turn: num(raw.turn, 4), name: String(raw.name ?? raw.id), desc: String(raw.desc ?? ''), units, rewards: { pick: 3, pool: DEFAULT_PVE_POOL } };
  if (defs.length) pv.defs = defs;
  if (isStr(raw.avatar)) pv.avatar = raw.avatar;
  if (isStr(raw.tip)) pv.tip = raw.tip;
  if (isObj(raw.boss) && isStr(raw.boss.defId)) {
    pv.boss = { defId: raw.boss.defId };
    if (isStr(raw.boss.skillName)) pv.boss.skillName = raw.boss.skillName;
    if (isStr(raw.boss.skillDesc)) pv.boss.skillDesc = raw.boss.skillDesc;
  }
  if (raw.rewards !== undefined) {
    const rw = isObj(raw.rewards) ? raw.rewards : {};
    const pool: PveRewardSpec[] = [];
    (Array.isArray(rw.pool) ? rw.pool : []).forEach((x: unknown, k: number) => {
      if (!isObj(x)) return;
      if (x.type === 'unit') pool.push({ type: 'unit', tierBonus: num(x.tierBonus, 1), ...(isStr(x.desc) ? { desc: x.desc } : {}) });
      else if (x.type === 'goldEquip') pool.push({ type: 'goldEquip', ...(isStr(x.desc) ? { desc: x.desc } : {}) });
      else if (x.type === 'gold') pool.push({ type: 'gold', amount: num(x.amount, 6), ...(isStr(x.desc) ? { desc: x.desc } : {}) });
      else p.push(`${at}: rewards.pool[${k}].type 应为 unit/goldEquip/gold`);
    });
    if (!pool.length) p.push(`${at}: rewards.pool 不能为空`);
    else pv.rewards = { pick: Math.max(1, Math.min(pool.length, num(rw.pick, 3))), pool };
  } else if (isNum(raw.rewardGold)) {
    pv.rewards = { pick: 3, pool: DEFAULT_PVE_POOL.map((x) => (x.type === 'gold' ? { ...x, amount: raw.rewardGold as number } : x)) };
  }
  if (pv.boss && !units.some((u) => u.defId === pv.boss!.defId)) p.push(`${at}: boss.defId "${pv.boss.defId}" 不在 team 里`);
  return pv;
}

// ───────────── 头条 / 突发 / 引导 ─────────────

const EVENT_TYPES = [
  'gold', 'priceMod', 'freeUnit', 'buffTeam', 'buffFaction', 'shopRerollFree', 'extraSlot', 'shieldAll', 'swapAll',
  'duplicate', 'sacrifice', 'nextTurnGold', 'enemyDebuff', 'rerollShop', 'levelUpRandom', 'lifeTrade',
  'enemyBuff', 'firstStrike', 'swapFronts', 'battleStatMul', 'addEnemyBoss', 'goldenEquips', 'summonBuff', 'damageOpponent',
  'stealEnemy', 'selfHpLoss', 'battleSummon', 'synergyBonus', 'wager', 'benchEnemy', 'freeEquip',
] as const;
const sideOf = (v: unknown): Side | null => (v === 'me' || v === 'enemy' ? v : null);

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
      const target = raw.target === 'item' || raw.target === 'all' || raw.target === 'equip' ? (raw.target === 'equip' ? 'item' : raw.target) : 'unit';
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
    case 'swapAll': {
      if (raw.side !== undefined && !sideOf(raw.side)) p.push(`${at}: swapAll.side 应为 me/enemy`);
      return raw.side === 'enemy' ? { type: 'swapAll', side: 'enemy' } : { type: 'swapAll' };
    }
    case 'duplicate':
    case 'rerollShop':
    case 'levelUpRandom':
    case 'swapFronts':
    case 'goldenEquips':
      return { type: raw.type };
    case 'enemyBuff':
    case 'summonBuff':
      return { type: raw.type, atk: num(raw.atk, 0), hp: num(raw.hp, 0) };
    case 'firstStrike': {
      const side = sideOf(raw.side);
      if (!side) p.push(`${at}: firstStrike.side 应为 me/enemy`);
      return { type: 'firstStrike', side: side ?? 'me' };
    }
    case 'battleStatMul': {
      const side = raw.side === 'both' ? 'both' : sideOf(raw.side);
      if (!side) p.push(`${at}: battleStatMul.side 应为 me/enemy/both`);
      if (raw.atk === undefined && raw.hp === undefined) p.push(`${at}: battleStatMul 需要 atk 或 hp 倍率`);
      return { type: 'battleStatMul', side: side ?? 'both', ...(isNum(raw.atk) ? { atk: raw.atk } : {}), ...(isNum(raw.hp) ? { hp: raw.hp } : {}) };
    }
    case 'addEnemyBoss':
      if (!isStr(raw.unitId)) p.push(`${at}: addEnemyBoss 需要 unitId`);
      return { type: 'addEnemyBoss', unitId: String(raw.unitId ?? ''), atk: num(raw.atk, 8), hp: num(raw.hp, 20), rewardMul: num(raw.rewardMul, 1) };
    case 'damageOpponent':
      if (raw.target !== undefined && raw.target !== 'random' && raw.target !== 'leader') p.push(`${at}: damageOpponent.target 应为 random/leader`);
      return { type: 'damageOpponent', amount: need(), target: raw.target === 'leader' ? 'leader' : 'random' };
    case 'stealEnemy':
    case 'benchEnemy': {
      const t = parseTarget(raw.target ?? 'randomEnemy');
      if (!t || !ENEMY_TARGETS.includes(t.target)) p.push(`${at}: ${raw.type}.target 应为敌方目标（${ENEMY_TARGETS.join('/')}）`);
      const target = t && ENEMY_TARGETS.includes(t.target) ? t.target : 'randomEnemy';
      return raw.type === 'stealEnemy' ? { type: 'stealEnemy', target } : { type: 'benchEnemy', target };
    }
    case 'selfHpLoss':
      return { type: 'selfHpLoss', amount: need() };
    case 'battleSummon': {
      const side = sideOf(raw.side);
      if (!side) p.push(`${at}: battleSummon.side 应为 me/enemy`);
      if (!isStr(raw.unitId)) p.push(`${at}: battleSummon 需要 unitId`);
      return { type: 'battleSummon', side: side ?? 'me', unitId: String(raw.unitId ?? 'token_shuijun'), count: num(raw.count, 1) };
    }
    case 'synergyBonus': {
      const key = synergyKeyOf(raw.key, at, 'synergyBonus.key', p);
      return { type: 'synergyBonus', key: key ?? 'open', amount: num(raw.amount, 1) };
    }
    case 'wager':
      return { type: 'wager', winGold: num(raw.winGold, 0), loseHp: num(raw.loseHp, 0) };
    case 'freeEquip': {
      const e: EventEffect = { type: 'freeEquip' };
      if (raw.gold === true) e.gold = true;
      if (raw.slot !== undefined) {
        const sl = SLOT_ALIAS[String(raw.slot)];
        if (!sl) p.push(`${at}: freeEquip.slot 应为 weapon/armor/trinket`);
        else e.slot = sl;
      }
      return e;
    }
    default:
      p.push(`${at}: 未知事件效果 "${raw.type}"（可选：${EVENT_TYPES.join('/')}）`);
      return { type: 'gold', amount: 0 };
  }
}

function normEffects(o: Obj, at: string, p: string[]): EventEffect[] {
  if (Array.isArray(o.effects) && o.effects.length) return o.effects.map((e, i) => normEventEffect(e, `${at}.effects[${i}]`, p));
  return [normEventEffect(o.effect, at, p)];
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
    const effects = normEffects(oo, `${at}.options[${k}]`, p);
    return { label: String(oo.label ?? ''), effect: effects[0], effects };
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
  const effects = normEffects(raw, at, p);
  const s: SurpriseDef = { id: String(raw.id), title: String(raw.title ?? ''), news: String(raw.news ?? ''), effect: effects[0], effects, good: raw.good !== false };
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
    const items = [...(Array.isArray(tt.items) ? tt.items : []), ...(Array.isArray(tt.equips) ? tt.equips : []), ...(Array.isArray(tt.consumables) ? tt.consumables : [])];
    return {
      turn: num(tt.turn, k + 1),
      units: (Array.isArray(tt.units) ? tt.units : []).map(String),
      items: (Array.isArray(items) ? items : []).map(String),
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
  if (raw.order !== undefined) {
    if (!Array.isArray(raw.order)) p.push('tutorial.order 应为数组');
    else {
      const bad = raw.order.filter((k) => !(TUTORIAL_STEPS as readonly string[]).includes(k as string));
      if (bad.length) p.push(`tutorial.order: 未知步骤 ${bad.join(', ')}`);
      t.order = raw.order.filter((k) => (TUTORIAL_STEPS as readonly string[]).includes(k as string)) as TutorialDef['order'];
    }
  }
  return t;
}

// ───────────── 汇总 ─────────────

function normList<T>(name: string, raw: unknown, fn: (r: unknown, i: number, p: string[], w: string[]) => T | null, p: string[], w: string[]): T[] {
  const arr = unwrapArray(raw);
  if (!arr) {
    p.push(`${name} 应为数组`);
    return [];
  }
  const out: T[] = [];
  arr.forEach((r, i) => {
    const v = fn(r, i, p, w);
    if (v) out.push(v);
  });
  return out;
}

/** 2.0 新文件：缺失时用内置默认（并提醒） */
function optList<T>(name: string, raw: unknown, fn: (r: unknown, i: number, p: string[], w: string[]) => T | null, defaults: T[], p: string[], w: string[]): T[] {
  if (raw === undefined || raw === null) {
    w.push(`缺少 ${name}.json，使用引擎内置默认（${defaults.length} 条）`);
    return defaults.map((x) => structuredCloneSafe(x));
  }
  return normList(name, raw, fn, p, w);
}
function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function dupCheck(name: string, list: { id: string }[], p: string[]): void {
  const seen = new Set<string>();
  for (const x of list) {
    if (seen.has(x.id)) p.push(`${name}: 重复 id "${x.id}"`);
    seen.add(x.id);
  }
}

type IndexInput = Pick<GameData, 'units' | 'headlines' | 'surprises'> & Partial<Pick<GameData, 'equips' | 'consumables' | 'arenas' | 'opponents' | 'pve' | 'tutorial' | 'warnings'>>;

/** 建立索引（validateData 内部用；测试里拼数据也可用）。缺的 2.0 集合用内置默认；PVE 的 defs 合并进 units（token） */
export function indexData(d: IndexInput): GameData {
  const pve = d.pve ?? DEFAULT_PVE;
  const units = [...d.units];
  for (const pv of pve) for (const def of pv.defs ?? []) if (!units.some((u) => u.id === def.id)) units.push({ ...def, token: true });
  const unitsById: Record<string, UnitDef> = {};
  const shopUnitsByTier: Record<number, UnitDef[]> = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
  for (const u of units) {
    unitsById[u.id] = u;
    if (!u.token) shopUnitsByTier[u.tier].push(u);
  }
  const equips = d.equips ?? DEFAULT_EQUIPS;
  const consumables = d.consumables ?? DEFAULT_CONSUMABLES;
  const arenas = d.arenas ?? DEFAULT_ARENAS;
  const byId = <T extends { id: string }>(l: T[]) => Object.fromEntries(l.map((x) => [x.id, x])) as Record<string, T>;
  return {
    units, equips, consumables, arenas, opponents: d.opponents ?? DEFAULT_OPPONENTS, pve,
    headlines: d.headlines, surprises: d.surprises, tutorial: d.tutorial,
    unitsById, equipsById: byId(equips), consumablesById: byId(consumables), arenasById: byId(arenas), shopUnitsByTier,
    warnings: d.warnings ?? [],
  };
}

export const FIXED_EQUIP_IDS = DEFAULT_EQUIPS.map((e) => e.id);
export const FIXED_CONSUMABLE_IDS = DEFAULT_CONSUMABLES.map((e) => e.id);

/** 校验并规范化原始 JSON，返回类型化 GameData；有错误时抛 DataError（problems 列出全部问题） */
export function validateData(raw: RawGameData): GameData {
  const p: string[] = [];
  const w: string[] = [];
  const units = normList('units', raw.units, normUnit, p, w);
  const headlines = normList('headlines', raw.headlines, (r, i, pp) => normHeadline(r, i, pp), p, w);
  const surprises = normList('surprises', raw.surprises, (r, i, pp) => normSurprise(r, i, pp), p, w);
  const tutorial = normTutorial(raw.tutorial, p);
  const equips = optList('equips', raw.equips, normEquip, DEFAULT_EQUIPS, p, w);
  const consumables = optList('consumables', raw.consumables, normConsumable, DEFAULT_CONSUMABLES, p, w);
  const arenas = optList('arenas', raw.arenas, normArena, DEFAULT_ARENAS, p, w);
  const opponents = optList('opponents', raw.opponents, (r, i, pp) => normOpponent(r, i, pp), DEFAULT_OPPONENTS, p, w);
  const pve = optList('pve', raw.pve, normPve, DEFAULT_PVE, p, w);
  if (raw.items !== undefined) w.push('items.json 是 1.0 的基建，2.0 已由 equips.json / consumables.json 取代，引擎忽略它');
  dupCheck('units', units, p);
  dupCheck('equips', equips, p);
  dupCheck('consumables', consumables, p);
  dupCheck('arenas', arenas, p);
  dupCheck('opponents', opponents, p);
  dupCheck('pve', pve, p);
  dupCheck('headlines', headlines, p);
  dupCheck('surprises', surprises, p);
  const data = indexData({ units, equips, consumables, arenas, opponents, pve, headlines, surprises, tutorial, warnings: w });

  // 引用检查
  for (const u of data.units) {
    const ab = u.ability;
    if (!ab) continue;
    for (const v of [ab, ...(ab.choices ?? [])]) {
      if ((v.effect ?? ab.effect) === 'summon') {
        const id = v.unitId ?? ab.unitId ?? 'token_shuijun';
        if (!data.unitsById[id]) p.push(`单位 ${u.id}: summon 的 unitId "${id}" 不存在`);
      }
    }
  }
  const checkEv = (e: EventEffect, at: string): void => {
    if ((e.type === 'addEnemyBoss' || e.type === 'battleSummon') && !data.unitsById[e.unitId]) p.push(`${at}: 单位 "${e.unitId}" 不存在`);
    if (e.type === 'freeUnit') {
      const pool = units.filter((u) => !u.token && (!e.faction || u.faction === e.faction) && (!e.tier || u.tier === e.tier));
      if (units.length && pool.length === 0) p.push(`${at}: freeUnit 找不到符合条件的单位`);
    }
  };
  headlines.forEach((h) => h.options.forEach((o, k) => (o.effects ?? [o.effect]).forEach((e) => checkEv(e, `头条 ${h.id}.options[${k}]`))));
  surprises.forEach((s) => (s.effects ?? [s.effect]).forEach((e) => checkEv(e, `突发 ${s.id}`)));
  if (!units.some((u) => !u.token && u.tier === 1)) p.push('units: 至少需要一个 T1 商店单位');
  if (!data.unitsById.token_shuijun) p.push('units: 缺少民间羁绊召唤物 token_shuijun');
  for (const pv of pve) for (const pu of pv.units) if (!data.unitsById[pu.defId]) p.push(`PVE ${pv.id}: 未知单位 "${pu.defId}"（可在 defs 里定义 PVE 专用单位）`);
  for (const o of opponents) for (const e of o.equips ?? []) if (!data.equipsById[e]) w.push(`对手 ${o.id}: 偏好装备 "${e}" 不存在，忽略`);
  for (const id of FIXED_EQUIP_IDS) if (!data.equipsById[id]) w.push(`equips: 缺少固定装备 "${id}"（DESIGN 12.3）`);
  for (const e of equips) if (!(EQUIP_SLOTS as readonly string[]).includes(e.slot)) p.push(`装备 ${e.id}: slot 非法`);
  if (arenas.length < 3) w.push(`arenas: 只有 ${arenas.length} 个赛场，开局三选一会不足 3 张`);
  if (opponents.length < 7) w.push(`opponents: 只有 ${opponents.length} 个预设，不足 7 个时会重复使用（名字加编号）`);
  const shop = units.filter((u) => !u.token);
  const noRole = shop.filter((u) => !u.role);
  if (noRole.length) w.push(`units: ${noRole.length} 个商店单位没有 role（打法关键词羁绊不会计入；DESIGN 16 要求每个单位恰好 1 个）：${noRole.slice(0, 8).map((u) => u.id).join(', ')}${noRole.length > 8 ? ' …' : ''}`);
  for (const r of ROLES) {
    const list = shop.filter((u) => u.role === r);
    if (shop.length < 20) continue;
    if (list.length < 5 || list.length > 6) w.push(`units: 关键词 ${r} 有 ${list.length} 个（DESIGN 16 建议 5~6）`);
    if (list.length && list.filter((u) => u.tier <= 2).length < 2) w.push(`units: 关键词 ${r} 的 T1~T2 单位少于 2 个，前期难以成型（DESIGN 16）`);
  }
  for (const f of FACTIONS) if (shop.length >= 20 && shop.filter((u) => u.faction === f).length < 6) w.push(`units: 阵营 ${f} 少于 6 个，6 档羁绊很难凑齐`);
  if (tutorial) {
    for (const t of tutorial.turns) {
      for (const id of t.units) if (!data.unitsById[id]) p.push(`tutorial 回合 ${t.turn}: 未知单位 "${id}"`);
      for (const id of t.items ?? []) if (!data.equipsById[id] && !data.consumablesById[id]) p.push(`tutorial 回合 ${t.turn}: 未知装备/消耗品 "${id}"`);
      for (const e of t.enemy) if (!data.unitsById[e.defId]) p.push(`tutorial 回合 ${t.turn}: 未知敌方单位 "${e.defId}"`);
    }
    if (tutorial.headline && !headlines.some((h) => h.id === tutorial.headline)) p.push(`tutorial.headline "${tutorial.headline}" 不存在`);
  }
  if (p.length) throw new DataError(p);
  return data;
}

export { FACTIONS, ROLES };
