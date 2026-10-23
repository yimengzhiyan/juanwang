// 便捷组合：客户端常用的"按当前局面开战"与测试/模拟用的自动推进。
import type { BattleOptions, BattleResult, GameData, RunState, UnitInst } from '../types';
import { simulateBattle } from './battle';
import { applyBattleResult } from './result';
import { shopAction } from './run';

/** 本回合战斗的选项（赛场、头条 enemyDebuff、队形修正、战场类事件） */
export function battleOptionsFor(state: RunState): BattleOptions {
  const m = state.modifiers;
  return {
    enemyAtkMod: -m.enemyAtkDebuff,
    meReverse: (m.battleSwapAll ?? 0) % 2 === 1,
    mePullFront: m.battlePullFront ?? [],
    arena: state.arena,
    mods: m.battle ?? {},
  };
}

/**
 * 用局面里的修正和确定性种子（seed + 回合）跑这回合的战斗。
 * enemy 缺省 = state.matchup.team（endShop 后确定）；传入则覆盖（一般不需要，真人快照请用 injectHumanOpponents）。
 */
export function battleForState(state: RunState, data: GameData, enemy?: readonly (UnitInst | null)[]): BattleResult {
  return simulateBattle(state.team, enemy ?? state.matchup?.team ?? [], data, `${state.seed}:t${state.turn}`, battleOptionsFor(state));
}

/**
 * 离线快速推进一回合（测试 / 自动对局用）：endShop → 战斗 → 结算 →（PVE 奖励选 pick）→（未结束则）continue。
 * 调用前 phase 必须是 'shop'。
 */
export function runTurnOffline(state: RunState, data: GameData, opts: { enemy?: UnitInst[]; pick?: number } = {}): { state: RunState; result: BattleResult } {
  let s = shopAction(state, { type: 'endShop' }, data);
  if (s.error) throw new Error(s.error);
  const result = battleForState(s, data, opts.enemy);
  s = applyBattleResult(s, result, data);
  if (s.pending) s = shopAction(s, { type: 'choosePveReward', index: opts.pick ?? 0 }, data);
  if (s.phase === 'result') s = shopAction(s, { type: 'continue' }, data);
  return { state: s, result };
}
