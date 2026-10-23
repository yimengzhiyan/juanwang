// 战后总结（DESIGN 14）：MVP + 一句话归因 + 本场羁绊档位。
import type { BattleSummary, GameData, Level, SynergyState } from '../types';

export interface SummaryInput {
  /** 我方（含召唤物、偷来的）单位：uid → {defId, level} */
  mine: Map<string, { defId: string; level: Level }>;
  /** 我方开场阵容顺序（uid），用于"前排"兜底 */
  myOrder: string[];
  damageByUid: Record<string, number>;
  /** 我方各单位被普通攻击命中的次数 */
  hitsTaken: Record<string, number>;
  /** 我方反弹伤害总和 */
  myReflect: number;
  /** 我方本场召唤物数量 */
  mySummons: number;
  synergies: SynergyState[];
}

const label = (data: GameData, u: { defId: string; level: Level }) => `${u.level > 1 ? `Lv${u.level} ` : ''}${data.unitsById[u.defId]?.name ?? u.defId}`;

/**
 * 归因规则（按顺序取第一条命中的）：
 * 1. MVP 伤害占我方总伤害 ≥ 50% → "X 一人打出 N 点伤害"
 * 2. 民间 ≥ 4 且我方召唤物 ≥ 4 → "民间 ×n 的水军潮淹没对手"
 * 3. 闭源 ≥ 4 且反弹伤害 ≥ 总伤害 30% → "闭源 ×n：对手撞死在盾上"
 * 4. 否则 → "前排 X 硬扛了 N 枪"（被普通攻击命中最多的我方单位）
 */
export function buildSummary(inp: SummaryInput, data: GameData): BattleSummary {
  const active = inp.synergies.filter((s) => s.tier > 0);
  const count = (k: string) => inp.synergies.find((s) => s.key === k)?.count ?? 0;
  let total = 0;
  let mvpUid: string | undefined;
  for (const uid of inp.mine.keys()) {
    const d = inp.damageByUid[uid] ?? 0;
    total += d;
    if (d > 0 && (!mvpUid || d > (inp.damageByUid[mvpUid] ?? 0))) mvpUid = uid;
  }
  const out: BattleSummary = { damageByUid: { ...inp.damageByUid }, reason: '', synergyTiers: active };
  if (mvpUid) {
    out.mvpUid = mvpUid;
    out.mvpDefId = inp.mine.get(mvpUid)!.defId;
  }
  const mvpDmg = mvpUid ? inp.damageByUid[mvpUid] ?? 0 : 0;
  if (mvpUid && total > 0 && mvpDmg / total >= 0.5) {
    out.reason = `${label(data, inp.mine.get(mvpUid)!)} 一人打出 ${mvpDmg} 点伤害`;
  } else if (count('folk') >= 4 && inp.mySummons >= 4) {
    out.reason = `民间 ×${count('folk')} 的水军潮淹没对手`;
  } else if (count('closed') >= 4 && total > 0 && inp.myReflect >= total * 0.3) {
    out.reason = `闭源 ×${count('closed')}：对手撞死在盾上`;
  } else {
    let tank = inp.myOrder[0];
    for (const uid of inp.mine.keys()) if ((inp.hitsTaken[uid] ?? 0) > (inp.hitsTaken[tank] ?? 0)) tank = uid;
    const u = tank ? inp.mine.get(tank) : undefined;
    out.reason = u ? `前排 ${label(data, u)} 硬扛了 ${inp.hitsTaken[tank] ?? 0} 枪` : '我方无人上场';
  }
  return out;
}
