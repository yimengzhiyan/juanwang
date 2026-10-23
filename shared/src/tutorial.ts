// 新手引导局：固定商店 / 固定对手 / 当前提示步骤。
import { DEFAULT_TUTORIAL_ORDER, type GameData, type RunState, type TutorialStepId, type UnitInst } from './types';

/**
 * 当前应提示的引导步骤：按 tutorial.order（缺省 buy → fight → equip → merge → synergy → fight → headline → fight → done）
 * 找第一个未完成的步骤。完成条件：buy = 买过单位；fight = 第 k 次出现时已打完 k 场；equip = 装过装备/用过消耗品；
 * merge = 有单位进化过；synergy = 点亮过羁绊；headline = 选过引导头条；item/freezeSell/buyAgain 为 1.0 兼容键。
 * 非引导局返回 null；战斗/结算阶段返回 null（不显示气泡）；phase=headline → 'headline'；结局 → 'done'。
 */
export function tutorialStep(state: RunState, data?: GameData): TutorialStepId | null {
  const t = state.tutorial;
  if (!t) return null;
  if (state.phase === 'over') return 'done';
  if (state.phase === 'battle' || state.phase === 'result') return null;
  const step = orderStep(state, data);
  if (step === 'done') return 'done';
  if (state.phase === 'headline') return 'headline';
  return step;
}

function orderStep(state: RunState, data?: GameData): TutorialStepId {
  const t = state.tutorial!;
  const order = data?.tutorial?.order?.length ? data.tutorial.order : DEFAULT_TUTORIAL_ORDER;
  let fights = 0;
  for (const step of order) {
    let done: boolean;
    switch (step) {
      case 'buy': done = t.buys >= 1 || t.battles > 0; break;
      case 'buyAgain': done = t.buys >= 2 || t.battles > 0; break;
      case 'fight': fights++; done = t.battles >= fights; break;
      case 'equip':
      case 'item': done = t.usedItem; break;
      case 'merge': done = t.merged; break;
      case 'synergy': done = !!t.synergy; break;
      case 'freezeSell': done = t.froze && t.sold; break;
      case 'headline': done = t.headline; break;
      case 'done': return 'done';
      default: done = true;
    }
    if (!done) return step;
  }
  return 'done';
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
      return { uid: `tut${state.turn}_${i}`, defId: e.defId, atk: e.atk ?? d.atk, hp: e.hp ?? d.hp, level, xp: level === 3 ? 5 : level === 2 ? 2 : 0, shield: 0, tempAtk: 0, tempHp: 0, equips: {} };
    });
}

/** 本回合对手阵容（endShop 后）：等同 state.matchup?.team */
export function offlineOpponent(state: RunState): UnitInst[] {
  return state.matchup?.team ?? [];
}
