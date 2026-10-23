// @juanwang/shared 对外入口（纯 TS，前端/服务端通用，不依赖 Node API）。
export * from './types';
export * from './rng';
export { clone } from './clone';
export { validateData, indexData, parseTarget, DataError, scaleEquipEffect, addEquipEffects, FIXED_EQUIP_IDS, FIXED_CONSUMABLE_IDS, type RawGameData } from './data';
export { DEFAULT_EQUIPS, DEFAULT_CONSUMABLES, DEFAULT_ARENAS, DEFAULT_OPPONENTS, DEFAULT_PVE, DEFAULT_PVE_POOL } from './defaults';
export { newRun, shopAction, ARENA_CHOICES, type NewRunOpts } from './engine/run';
export {
  maxTierForTurn, shopMaxTier, tierWeights, levelForXp, xpForLevel, isHeadlineTurn, currentUnitSlots, shopSlotCounts, rerollCost, canUpgradeShop,
  canMerge, abilityAmount, abilityBuff, matchesFilter, turnIncome, arenaRules,
  TEAM_SIZE, START_HP, MAX_TURNS, BASE_GOLD, UNIT_PRICE, REROLL_PRICE, UPGRADE_PRICE, MAX_SHOP_LEVEL, SHOP_UNIT_SLOTS, SHOP_EQUIP_SLOTS, SHOP_CONSUMABLE_SLOTS,
} from './engine/shop';
export {
  computeSynergies, activeSynergies, dominantSynergy, teamTiers, tierForCount, stateBonus, synergiesFromDefs,
  SYNERGY_NAME, SYNERGY_DESCS, SYNERGY_SHOUT, FACTION_THRESHOLDS, ROLE_THRESHOLDS, type SynergyBonus, type TierMap,
} from './engine/synergy';
export { effectiveStats, equipTotals, equipEntries, equipCount, equipRefund, equipEffectOf, canAttach } from './engine/equip';
export { simulateBattle, MAX_ACTIONS, MAX_FIELD } from './engine/battle';
export { applyBattleResult, computeRunEnd, bestUnitOf, hpLossFor, stageBonus, buildSummary, ACHIEVEMENTS } from './engine/result';
export {
  createOpponents, injectHumanOpponents, archetypeOfTeam, prepareMatchup, aliveCount, rankByHp, LOBBY_SIZE, type HumanSnapshot,
} from './engine/lobby';
export { pveForTurn, pveTeam } from './engine/pve';
export { generateArchetypeTeam, generateBotTeam, botPlayTurn, scaleTeam, profileOf, type BotProfile } from './engine/bot';
export { DIFFICULTY, opponentScale, type Difficulty } from './engine/difficulty';
export { tutorialStep, tutorialEnemy, offlineOpponent } from './tutorial';
export { battleForState, battleOptionsFor, runTurnOffline } from './engine/helpers';
/** @deprecated 1.0 兼容导出，2.0 客户端迁移后删除 */
export { unitSlotsForTurn, itemSlotsForTurn, WIN_TROPHIES, SYNERGY_THRESHOLD, SYNERGY_DESC } from './compat';
