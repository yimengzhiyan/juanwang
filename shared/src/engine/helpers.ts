// 便捷组合：客户端常用的"按当前局面开战"。
import type { BattleResult, GameData, RunState, UnitInst } from '../types';
import { simulateBattle } from './battle';
import { applyBattleResult } from './result';
import { offlineOpponent } from '../tutorial';
import { shopAction } from './shop';

/** 用局面里的修正（enemyDebuff 等）和确定性种子（seed + 回合）跑这回合的战斗 */
export function battleForState(state: RunState, enemyTeam: readonly (UnitInst | null)[], data: GameData): BattleResult {
  return simulateBattle(state.team, enemyTeam, data, `${state.seed}:t${state.turn}`, {
    enemyAtkMod: -state.modifiers.enemyAtkDebuff,
    meReverse: (state.modifiers.battleSwapAll ?? 0) % 2 === 1,
    mePullFront: state.modifiers.battlePullFront ?? [],
  });
}

/**
 * 离线快速推进一回合（测试 / 自动对局用）：endShop → 离线对手 → 战斗 → 结算 →（未结束则）continue。
 * 调用前 phase 必须是 'shop'。
 */
export function runTurnOffline(state: RunState, data: GameData, enemy?: UnitInst[]): { state: RunState; result: BattleResult } {
  let s = shopAction(state, { type: 'endShop' }, data);
  if (s.error) throw new Error(s.error);
  const result = battleForState(s, enemy ?? offlineOpponent(s, data), data);
  s = applyBattleResult(s, result, data);
  if (s.phase === 'result') s = shopAction(s, { type: 'continue' }, data);
  return { state: s, result };
}
