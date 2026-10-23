// PVE 怪物回合（DESIGN 12.7）：不扣热度；玩家打赢 → 三选一奖励（pending），对手同回合也打（只模拟，赢了下回合 +算力）。
import type { GameData, PveDef, PveRewardOption, RunState, UnitInst } from '../types';
import { addFreeUnitSlot, mkSlot, rollUnitDef, shopMaxTier, sortShop, type Ctx } from './shop';

export function pveForTurn(turn: number, data: GameData): PveDef | undefined {
  return data.pve.find((p) => p.turn === turn);
}

/** PVE 怪物队（前排在前） */
export function pveTeam(pv: PveDef, data: GameData): UnitInst[] {
  return pv.units
    .filter((u) => data.unitsById[u.defId])
    .map((u, i) => {
      const d = data.unitsById[u.defId];
      const level = u.level ?? 1;
      return { uid: `${pv.id}_${i}`, defId: u.defId, atk: u.atk ?? d.atk, hp: u.hp ?? d.hp, level, xp: level === 3 ? 5 : level === 2 ? 2 : 0, shield: 0, tempAtk: 0, tempHp: 0, equips: {} };
    });
}

/** 生成三选一奖励（从奖励池里不重复抽 pick 个） */
export function rollPveRewards(ctx: Ctx, pv: PveDef): PveRewardOption[] {
  const pool = ctx.rng.sample(pv.rewards.pool, Math.min(pv.rewards.pick, pv.rewards.pool.length));
  const out: PveRewardOption[] = [];
  for (const r of pool) {
    if (r.type === 'unit') {
      const tier = Math.min(6, shopMaxTier(ctx.s) + r.tierBonus);
      const id = rollUnitDef(ctx, { tier });
      if (id) out.push({ type: 'unit', defId: id, text: `${ctx.data.unitsById[id]?.name ?? id}（T${ctx.data.unitsById[id]?.tier ?? tier}，免费）` });
    } else if (r.type === 'goldEquip') {
      if (!ctx.data.equips.length) continue;
      const e = ctx.rng.pick(ctx.data.equips);
      out.push({ type: 'equip', defId: e.id, gold: true, text: `金色${e.name}：${e.goldDesc}` });
    } else {
      out.push({ type: 'gold', amount: r.amount, text: `+${r.amount} 算力` });
    }
  }
  return out;
}

/**
 * 领取奖励：单位 / 金色装备 → 商店里的免费槽（已冻结，下回合开局还在）；算力 → 下回合 +n（回合开始时到账）。
 */
export function applyPveReward(ctx: Ctx, opt: PveRewardOption): void {
  const s: RunState = ctx.s;
  if (opt.type === 'unit') {
    addFreeUnitSlot(ctx, opt.defId, 'pve');
    const sl = s.shop.find((x) => x.free && x.freeReason === 'pve' && x.defId === opt.defId && !x.frozen);
    if (sl) sl.frozen = true;
  } else if (opt.type === 'equip') {
    const sl = mkSlot(ctx, 'equip', opt.defId, 'pve', true);
    sl.frozen = true;
    s.shop.push(sl);
    sortShop(s);
  } else {
    s.modifiers.nextTurnGold += opt.amount;
  }
}
