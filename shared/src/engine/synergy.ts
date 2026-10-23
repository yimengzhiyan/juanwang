// 流派羁绊（DESIGN 12.1 / 12.2）：阵营 2/4/6 三档、职业 2/4 两档，档位逐级叠加（4 个时 2 个档的效果仍然生效）。
// 本文件只做统计与描述；具体效果分散在 battle.ts（战斗）和 shop.ts（商店阶段）里实现，查 tierOf()。
import {
  FACTIONS, ROLES,
  type Faction, type GameData, type Role, type SynergyKey, type SynergyKind, type SynergyState, type UnitDef, type UnitInst,
} from '../types';

export const FACTION_THRESHOLDS = [2, 4, 6] as const;
export const ROLE_THRESHOLDS = [2, 4] as const;

export const SYNERGY_NAME: Record<SynergyKey, string> = {
  open: '开源', closed: '闭源', compute: '算力', folk: '民间',
  researcher: '研究员', trader: '商人', idol: '偶像', engineer: '工程师',
};

/** 各档效果描述（与门槛对齐） */
export const SYNERGY_DESCS: Record<SynergyKey, string[]> = {
  open: ['开战时开源单位 +1/+1', '任一开源单位被购买时，全体开源单位永久 +1/+1', '开源单位每回合开始永久 +1/+1'],
  closed: ['开战时前排获得 3 护盾', '闭源单位获得 1/3 血量的护盾，护盾被打碎时反弹 2 伤害', '护盾不会被技能穿透，反弹 = 攻击者攻击力'],
  compute: ['装备最多的单位 +2 攻', '算力单位的装备效果 ×2', '装备最多的单位每次攻击额外攻击 1 次'],
  folk: ['开战召唤 1 个水军', '召唤物继承召唤者 50% 属性；友军阵亡召唤 1 个水军', '召唤物阵亡时对敌方全体造成 1 伤害'],
  researcher: ['回合结束研究员永久 +1 攻', '研究员技能触发两次'],
  trader: ['每回合 +1 算力', '每回合 +2 算力，且商店价格 -1'],
  idol: ['偶像阵亡时全队 +1 攻', '开战时随机复制一名偶像的属性给最弱友军'],
  engineer: ['进化时额外 +1/+1', '每回合首次刷新免费，进化时全队 +1/+1'],
};

/** 战斗开场横幅的口号（"开源 ×4：共享升级！"） */
export const SYNERGY_SHOUT: Record<SynergyKey, string[]> = {
  open: ['开源共享！', '共享升级！', '全民开源！'],
  closed: ['护栏上线！', '铜墙铁壁！', '绝对闭源！'],
  compute: ['堆卡！', '算力翻倍！', '一卡顶一队！'],
  folk: ['水军出动！', '人海战术！', '连环爆炸！'],
  researcher: ['发论文！', '研究突破！'],
  trader: ['做生意！', '垄断市场！'],
  idol: ['应援！', '偶像光环！'],
  engineer: ['加班！', '工程奇迹！'],
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

/** 统计一组单位定义的阵营/职业个数 */
export function countLines(defs: readonly (UnitDef | undefined)[]): Record<SynergyKey, number> {
  const c = { open: 0, closed: 0, compute: 0, folk: 0, researcher: 0, trader: 0, idol: 0, engineer: 0 } as Record<SynergyKey, number>;
  for (const d of defs) {
    if (!d) continue;
    c[d.faction]++;
    if (d.role) c[d.role]++;
  }
  return c;
}

/** 羁绊人数加成（赛场「春晚舞台」、头条 synergyBonus） */
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
 * 计算队伍的 8 条流派线状态（阵营 4 条在前、职业 4 条在后，固定顺序，含未激活的），客户端直接显示进度。
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
