// @juanwang/shared 对外入口（纯 TS，前端/服务端通用，不依赖 Node API）。
export * from './types';
export * from './rng';
export { validateData, indexData, parseTarget, DataError, type RawGameData } from './data';
export {
  newRun, shopAction, maxTierForTurn, unitSlotsForTurn, itemSlotsForTurn, maxItemTierForTurn, tierWeights,
  levelForXp, xpForLevel, isHeadlineTurn, currentUnitSlots, rerollCost, canMerge, abilityAmount, abilityBuff, matchesFilter,
  TEAM_SIZE, START_LIVES, WIN_TROPHIES, MAX_TURNS, BASE_GOLD, UNIT_PRICE, REROLL_PRICE, type NewRunOpts,
} from './engine/shop';
export { simulateBattle, MAX_ROUNDS, MAX_FIELD, SYNERGY_THRESHOLD, SYNERGY_DESC } from './engine/battle';
export { applyBattleResult, livesLostOnDefeat, SURPRISE_CHANCE, LATE_GAME_TURN } from './engine/result';
export { generateBotTeam, botBonusGold } from './engine/bot';
export { tutorialStep, tutorialEnemy, offlineOpponent } from './tutorial';
export { battleForState, runTurnOffline } from './engine/helpers';
