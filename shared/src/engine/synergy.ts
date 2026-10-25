// 流派羁绊（DESIGN 12.1 / 16）：阵营 2/3/4 三档（2.1.1，原 2/3/5）、打法关键词 2/4 两档，档位逐级叠加（3 个时 2 个档的效果仍然生效）。
// 本文件只做统计与描述；具体效果分散在 battle.ts（战斗）和 shop.ts（商店阶段）里实现，查 tierOf()。
import {
  FACTIONS, ROLES,
  type Faction, type GameData, type Role, type SynergyKey, type SynergyKind, type SynergyState, type UnitDef, type UnitInst,
} from '../types';

export const FACTION_THRESHOLDS = [2, 3, 4] as const;
/** 打法关键词门槛（字段名沿用 ROLE_*） */
export const ROLE_THRESHOLDS = [2, 4] as const;

/** 打法关键词的显示信息（客户端图鉴 / 羁绊面板 / 卡面角标直接用） */
export interface RoleMeta {
  key: Role;
  /** 中文名（2 字） */
  name: string;
  /** 一句话定位 */
  tagline: string;
  /** 门槛 [2, 4] */
  thresholds: readonly number[];
  /** 各档效果（与 thresholds 对齐） */
  descs: [string, string];
  /** 战斗开场横幅口号（与 thresholds 对齐） */
  shouts: [string, string];
}

/** 关键词羁绊的可调数值（平衡用；ROLE_META 的说明文字按它生成） */
export const SYNERGY_TUNING = {
  /** 多刀 ×2：每次行动额外 1 段的概率 */
  multiChance: 0.25,
  /** 护盾 ×2：开战时护盾单位获得的护盾 */
  shieldStart: 4,
  /** 护盾 ×4：友军护盾碎裂时的反弹伤害 */
  shieldReflect: 3,
  /** 召唤 ×2 / ×4：召唤物 +n/+n */
  summonStat: [2, 3] as [number, number],
  /** 自爆 ×2：开战时自爆单位本场 +n/+n */
  explodeStart: 1,
  /** 自爆 ×2：爆炸伤害加成（2.1 平衡后为 0：对低攻自爆单位相当于翻倍） */
  explodeBonus: 0,
  /** 自爆 ×4：自爆单位阵亡时对敌方全体的余波伤害 */
  explodeAftershock: 1,
  /** 自爆 ×4：自爆单位阵亡时对敌方最前排的伤害 = 自身攻击 × explodeFrontMul（0 = 关闭） */
  explodeFrontMul: 1,
  /** 关键词 ×4 的战斗内永久成长量（多刀 +n 攻、护盾 +n/+2n、召唤 / 自爆 +n/+n） */
  growPerm: { multi: 1, shield: 1, summon: 2, explode: 1 },
  /** 经济 ×2 / ×4：每回合额外算力 */
  economyGold: [2, 3] as [number, number],
  /** 经济 ×4：每花掉多少算力触发一次"随机经济单位永久 +1/+1" */
  economyStep: 4,
};
const T = SYNERGY_TUNING;

export const ROLE_META: Record<Role, RoleMeta> = {
  multi: {
    key: 'multi', name: '多刀', tagline: '一回合砍好几刀，越砍越快', thresholds: ROLE_THRESHOLDS,
    descs: [`多刀单位攻击时 ${Math.round(T.multiChance * 100)}% 概率额外攻击 1 次`, `多刀单位每次攻击必定额外攻击 1 次；额外攻击命中后该单位永久 +${T.growPerm.multi} 攻`],
    shouts: ['连砍！', '刀刀暴击！'],
  },
  shield: {
    key: 'shield', name: '护盾', tagline: '先挨打，再反弹，越打越硬', thresholds: ROLE_THRESHOLDS,
    descs: [`开战时护盾单位获得 ${T.shieldStart} 护盾`, `友军护盾碎裂时反弹 ${T.shieldReflect} 伤害；护盾单位每被打碎一次护盾，永久 +${T.growPerm.shield}/+${2 * T.growPerm.shield}`],
    shouts: ['举盾！', '盾反！'],
  },
  summon: {
    key: 'summon', name: '召唤', tagline: '小弟越摇越多', thresholds: ROLE_THRESHOLDS,
    descs: [`召唤物 +${T.summonStat[0]}/+${T.summonStat[0]}`, `召唤物 +${T.summonStat[1]}/+${T.summonStat[1]}，开战额外召唤 1 个水军；每次召唤，召唤者永久 +${T.growPerm.summon}/+${T.growPerm.summon}`],
    shouts: ['摇人！', '人山人海！'],
  },
  explode: {
    key: 'explode', name: '自爆', tagline: '死也要带走一片', thresholds: ROLE_THRESHOLDS,
    descs: [`开战时自爆单位 +${T.explodeStart}/+${T.explodeStart}`, `自爆单位阵亡时额外对敌方最前排造成等于自身攻击的伤害、对敌方全体 ${T.explodeAftershock} 伤害；每次爆炸后，其余自爆友军永久 +${T.growPerm.explode}/+${T.growPerm.explode}`],
    shouts: ['点火！', '连环爆炸！'],
  },
  growth: {
    key: 'growth', name: '成长', tagline: '每回合都在变强', thresholds: ROLE_THRESHOLDS,
    descs: ['成长单位每次获得永久加成时额外 +1/+1', '成长单位获得永久加成时，相邻友军获得同样加成（互相成长）；回合结束全队永久 +1/+1'],
    shouts: ['卷起来！', '全员进化！'],
  },
  economy: {
    key: 'economy', name: '经济', tagline: '钱多就是道理', thresholds: ROLE_THRESHOLDS,
    descs: [`每回合 +${T.economyGold[0]} 算力`, `每回合 +${T.economyGold[1]} 算力，单位价格 -1；每花掉 ${T.economyStep} 算力，随机一名经济单位永久 +1/+1`],
    shouts: ['搞钱！', '垄断市场！'],
  },
};

export const SYNERGY_NAME: Record<SynergyKey, string> = {
  open: '开源', closed: '闭源', compute: '算力', folk: '民间',
  multi: ROLE_META.multi.name, shield: ROLE_META.shield.name, summon: ROLE_META.summon.name,
  explode: ROLE_META.explode.name, growth: ROLE_META.growth.name, economy: ROLE_META.economy.name,
};

/** 各档效果描述（与门槛对齐） */
export const SYNERGY_DESCS: Record<SynergyKey, string[]> = {
  open: ['开战时开源单位 +1/+1', '任一开源单位被购买时，全体开源单位永久 +1/+1', '开源单位每回合开始永久 +1/+1'],
  closed: ['开战时前排获得 3 护盾', '闭源单位获得 1/3 血量的护盾，护盾被打碎时反弹 2 伤害', '护盾不会被技能穿透，反弹 = 攻击者攻击力'],
  compute: ['装备最多的单位 +2 攻', '算力单位的装备效果 ×2', '装备最多的单位每次攻击额外攻击 1 次'],
  folk: ['开战召唤 1 个水军', '召唤物继承召唤者 50% 属性；友军阵亡召唤 1 个水军', '召唤物阵亡时对敌方全体造成 1 伤害'],
  ...(Object.fromEntries(ROLES.map((r) => [r, [...ROLE_META[r].descs]])) as Record<Role, string[]>),
};

/** 战斗开场横幅的口号（"开源 ×3：共享升级！"） */
export const SYNERGY_SHOUT: Record<SynergyKey, string[]> = {
  open: ['开源共享！', '共享升级！', '全民开源！'],
  closed: ['护栏上线！', '铜墙铁壁！', '绝对闭源！'],
  compute: ['堆卡！', '算力翻倍！', '一卡顶一队！'],
  folk: ['水军出动！', '人海战术！', '连环爆炸！'],
  ...(Object.fromEntries(ROLES.map((r) => [r, [...ROLE_META[r].shouts]])) as Record<Role, string[]>),
};

export function synergyKind(key: SynergyKey): SynergyKind {
  return (FACTIONS as readonly string[]).includes(key) ? 'faction' : 'role';
}
export function thresholdsOf(key: SynergyKey): readonly number[] {
  return synergyKind(key) === 'faction' ? FACTION_THRESHOLDS : ROLE_THRESHOLDS;
}
/** 个数 → 档位 */
export function tierForCount(key: SynergyKey, count: number): number {
  return thresholdsOf(key).filter((t) => count >= t).length;
}

/** 某局面的羁绊加成：赛场 synergyBonus（永久）+ 本回合头条/突发 synergyBonus */
export function stateBonus(s: { arena?: string; modifiers?: { battle?: { synergyBonus?: SynergyBonus } } }, data: GameData): SynergyBonus {
  const ar = s.arena ? data.arenasById[s.arena]?.rules.synergyBonus : undefined;
  const fromArena: SynergyBonus = {};
  for (const b of ar ?? []) fromArena[b.key] = (fromArena[b.key] ?? 0) + b.amount;
  return mergeBonus(fromArena, s.modifiers?.battle?.synergyBonus);
}

/** 统计一组单位定义的阵营/关键词个数 */
export function countLines(defs: readonly (UnitDef | undefined)[]): Record<SynergyKey, number> {
  const c = Object.fromEntries([...FACTIONS, ...ROLES].map((k) => [k, 0])) as Record<SynergyKey, number>;
  for (const d of defs) {
    if (!d) continue;
    c[d.faction]++;
    if (d.role) c[d.role]++;
  }
  return c;
}

/** 羁绊人数加成（赛场 synergyBonus、头条 synergyBonus） */
export type SynergyBonus = Partial<Record<SynergyKey, number>>;
function addBonus(c: Record<SynergyKey, number>, bonus?: SynergyBonus): Record<SynergyKey, number> {
  if (bonus) for (const [k, v] of Object.entries(bonus) as [SynergyKey, number][]) if (c[k] !== undefined) c[k] += v ?? 0;
  return c;
}
/** 合并多个加成 */
export function mergeBonus(...bs: (SynergyBonus | undefined)[]): SynergyBonus {
  const out: SynergyBonus = {};
  for (const b of bs) if (b) for (const [k, v] of Object.entries(b) as [SynergyKey, number][]) out[k] = (out[k] ?? 0) + (v ?? 0);
  return out;
}

/** 各线档位（快速查询用） */
export type TierMap = Record<SynergyKey, number>;
export function tierMap(defs: readonly (UnitDef | undefined)[], bonus?: SynergyBonus): TierMap {
  const c = addBonus(countLines(defs), bonus);
  const out = {} as TierMap;
  for (const k of Object.keys(c) as SynergyKey[]) out[k] = tierForCount(k, c[k]);
  return out;
}
export function teamDefs(team: readonly (UnitInst | null | undefined)[], data: GameData): UnitDef[] {
  return team.filter((u): u is UnitInst => !!u).map((u) => data.unitsById[u.defId]).filter((d): d is UnitDef => !!d);
}
export function teamTiers(team: readonly (UnitInst | null | undefined)[], data: GameData, bonus?: SynergyBonus): TierMap {
  return tierMap(teamDefs(team, data), bonus);
}

/**
 * 计算队伍的 10 条流派线状态（阵营 4 条在前、关键词 6 条在后，固定顺序，含未激活的），客户端直接显示进度。
 */
export function computeSynergies(team: readonly (UnitInst | null | undefined)[], data: GameData, bonus?: SynergyBonus): SynergyState[] {
  return synergiesFromDefs(teamDefs(team, data), bonus);
}
export function synergiesFromDefs(defs: readonly UnitDef[], bonus?: SynergyBonus): SynergyState[] {
  const c = addBonus(countLines(defs), bonus);
  const keys: SynergyKey[] = [...FACTIONS, ...ROLES];
  return keys.map((key) => {
    const thresholds = [...thresholdsOf(key)];
    const tier = tierForCount(key, c[key]);
    const st: SynergyState = { kind: synergyKind(key), key, name: SYNERGY_NAME[key], count: c[key], tier, thresholds, descs: SYNERGY_DESCS[key] };
    if (tier < thresholds.length) st.next = thresholds[tier] - c[key];
    return st;
  });
}

/** 只要激活的（tier > 0） */
export function activeSynergies(team: readonly (UnitInst | null | undefined)[], data: GameData, bonus?: SynergyBonus): SynergyState[] {
  return computeSynergies(team, data, bonus).filter((s) => s.tier > 0);
}

/** 按羁绊最高档判定流派：最高档 → 个数 → 阵营优先；全部未激活返回 null（= 'mixed'） */
export function dominantSynergy(states: readonly SynergyState[]): SynergyState | null {
  const act = states.filter((s) => s.tier > 0);
  if (!act.length) return null;
  return act.reduce((best, s) => {
    const k = (x: SynergyState) => [x.tier, x.count, x.kind === 'faction' ? 1 : 0];
    const a = k(s);
    const b = k(best);
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] > b[i] ? s : best;
    return best;
  });
}

export function isFaction(k: SynergyKey): k is Faction {
  return (FACTIONS as readonly string[]).includes(k);
}
export function isRole(k: SynergyKey): k is Role {
  return (ROLES as readonly string[]).includes(k);
}
