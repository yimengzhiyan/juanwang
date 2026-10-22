// 新手引导局：固定商店 / 固定对手 / 当前提示步骤。
import { generateBotTeam } from './engine/bot';
import type { GameData, RunState, TutorialStepId, UnitInst } from './types';

/**
 * 当前应提示的引导步骤：
 * buy → buyAgain → fight →（回合2）merge → item → freezeSell → fight →（回合3 头条）headline → done。
 * 非引导局返回 null；战斗/结算阶段返回 null（不显示气泡）。
 */
export function tutorialStep(state: RunState): TutorialStepId | null {
  const t = state.tutorial;
  if (!t) return null;
  if (state.phase === 'over') return 'done';
  if (t.headline) return 'done';
  if (state.phase === 'battle' || state.phase === 'result') return null;
  if (state.phase === 'headline') return 'headline';
  if (t.battles === 0) return t.buys === 0 ? 'buy' : t.buys === 1 ? 'buyAgain' : 'fight';
  if (t.battles === 1) {
    if (!t.merged) return 'merge';
    if (!t.usedItem) return 'item';
    if (!(t.froze && t.sold)) return 'freezeSell';
    return 'fight';
  }
  return 'fight';
}

/** 引导局本回合的固定对手；不是引导局或超出固定回合时返回 null */
export function tutorialEnemy(state: RunState, data: GameData): UnitInst[] | null {
  if (!state.tutorial || !data.tutorial) return null;
  const tt = data.tutorial.turns.find((x) => x.turn === state.turn);
  if (!tt) return null;
  return tt.enemy
    .filter((e) => data.unitsById[e.defId])
    .map((e, i) => {
      const d = data.unitsById[e.defId];
      const level = e.level ?? 1;
      return { uid: `tut${state.turn}_${i}`, defId: e.defId, atk: e.atk ?? d.atk, hp: e.hp ?? d.hp, level, xp: level === 3 ? 5 : level === 2 ? 2 : 0, shield: 0, tempAtk: 0, tempHp: 0 };
    });
}

/** 离线对手：引导局用固定弱队，否则用机器人（种子 = 局种子 + 回合） */
export function offlineOpponent(state: RunState, data: GameData): UnitInst[] {
  return tutorialEnemy(state, data) ?? generateBotTeam(state.turn, state.trophies, data, `${state.seed}:opp:${state.turn}`);
}
