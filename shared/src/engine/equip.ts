// 装备（DESIGN 12.3）：每个单位 武器/防具/饰品 3 个槽；同名同槽第二件 → 金色版；换装/出售时每件折算 1 算力（金色算 2 件）。
import { addEquipEffects, scaleEquipEffect } from '../data';
import {
  EQUIP_SLOTS,
  type EquipDef, type EquipEffect, type EquipInst, type EquipSlot, type GameData, type UnitDef, type UnitInst,
} from '../types';
import { teamTiers, type SynergyBonus, type TierMap } from './synergy';

/** 装备的生效效果（金色用 goldEffect） */
export function equipEffectOf(inst: EquipInst, data: GameData): EquipEffect {
  const def = data.equipsById[inst.defId];
  if (!def) return {};
  return inst.gold ? def.goldEffect : def.effect;
}

/** 这个单位的装备效果是否 ×2（算力 ×3：算力单位的装备效果翻倍） */
export function equipMultFor(def: UnitDef | undefined, tiers: TierMap | undefined): number {
  return def?.faction === 'compute' && (tiers?.compute ?? 0) >= 2 ? 2 : 1;
}

export interface EquipEntry { slot: EquipSlot; inst: EquipInst; def: EquipDef; eff: EquipEffect }

/** 单位身上的装备（已乘倍率），按 武器/防具/饰品 顺序；allGold = 头条 goldenEquips（全部按金色生效） */
export function equipEntries(u: Pick<UnitInst, 'equips'>, data: GameData, mult = 1, allGold = false): EquipEntry[] {
  const out: EquipEntry[] = [];
  for (const slot of EQUIP_SLOTS) {
    const inst = u.equips?.[slot];
    if (!inst) continue;
    const def = data.equipsById[inst.defId];
    if (!def) continue;
    const gold = inst.gold || allGold;
    out.push({ slot, inst: { ...inst, gold }, def, eff: scaleEquipEffect(gold ? def.goldEffect : def.effect, mult) });
  }
  return out;
}

/** 汇总：数值相加，布尔取或，revive 取更好的，copyNeighbor 取并集 */
export function equipTotals(u: Pick<UnitInst, 'equips'>, data: GameData, mult = 1, allGold = false): EquipEffect {
  return equipEntries(u, data, mult, allGold).reduce<EquipEffect>((t, e) => addEquipEffects(t, e.eff), {});
}

/** 装备件数（金色算 1 件，用于"装备最多的单位"） */
export function equipCount(u: Pick<UnitInst, 'equips'>): number {
  return EQUIP_SLOTS.filter((s) => !!u.equips?.[s]).length;
}
/** 折算算力：每件 1，金色 2 */
export function equipRefund(u: Pick<UnitInst, 'equips'>): number {
  let n = 0;
  for (const s of EQUIP_SLOTS) {
    const e = u.equips?.[s];
    if (e) n += e.gold ? 2 : 1;
  }
  return n;
}

/**
 * 显示用有效属性：基础 + 临时 + 装备静态加成（含算力 ×3 翻倍）。team 传入时按队伍羁绊计算倍率。
 * 战斗开场的属性与它一致（再叠加赛场/羁绊开战效果）。
 */
export function effectiveStats(u: UnitInst, data: GameData, team?: readonly (UnitInst | null)[], bonus?: SynergyBonus): { atk: number; hp: number } {
  const tiers = team ? teamTiers(team, data, bonus) : undefined;
  const t = equipTotals(u, data, equipMultFor(data.unitsById[u.defId], tiers));
  return {
    atk: Math.max(0, u.atk + (u.tempAtk ?? 0) + (t.atk ?? 0)),
    hp: Math.max(1, u.hp + (u.tempHp ?? 0) + (t.hp ?? 0)),
  };
}

export type EquipOutcome = 'new' | 'gold' | 'replace';

/**
 * 把一件装备装到单位上（就地修改）。同槽为空 → new；同槽同名普通版且新的也是普通 → 合成金色（gold）；
 * 否则替换（replace，旧装备按件折算 refund 算力）。
 */
export function attachEquip(u: UnitInst, def: EquipDef, gold = false): { outcome: EquipOutcome; refund: number; old?: EquipInst } {
  if (!u.equips) u.equips = {};
  const cur = u.equips[def.slot];
  if (!cur) {
    u.equips[def.slot] = { defId: def.id, gold };
    return { outcome: 'new', refund: 0 };
  }
  if (cur.defId === def.id && !cur.gold && !gold) {
    cur.gold = true;
    return { outcome: 'gold', refund: 0 };
  }
  u.equips[def.slot] = { defId: def.id, gold };
  return { outcome: 'replace', refund: cur.gold ? 2 : 1, old: cur };
}

/** 能不能装（同名金色再装同名 = 浪费，拒绝） */
export function canAttach(u: UnitInst, def: EquipDef, gold = false): string | null {
  const cur = u.equips?.[def.slot];
  if (cur && cur.defId === def.id && cur.gold) return gold ? '已经是金色版了' : '已经是金色版了，换一件别的吧';
  return null;
}

/** 队伍内合体：把 from 的装备并到 to 上（空槽直接移入；同名普通 → 金色；冲突时保留 to 的、from 的折算） */
export function mergeEquips(to: UnitInst, from: UnitInst, data: GameData): number {
  let refund = 0;
  for (const slot of EQUIP_SLOTS) {
    const e = from.equips?.[slot];
    if (!e) continue;
    const def = data.equipsById[e.defId];
    const cur = to.equips?.[slot];
    if (!def) continue;
    if (!cur) {
      to.equips[slot] = { ...e };
    } else if (cur.defId === e.defId && !cur.gold && !e.gold) {
      cur.gold = true;
    } else {
      refund += e.gold ? 2 : 1;
    }
  }
  return refund;
}
