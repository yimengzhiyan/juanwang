// 难度参数（集中在这里调；运行时可直接修改 DIFFICULTY 的字段）。调参依据见 docs/ENGINE_NOTES.md「难度」。
export const DIFFICULTY = {
  /** 离线对手：前 earlyTurns 回合属性 × earlyScale */
  earlyTurns: 4,
  earlyScale: 0.75,
  /** 之后随玩家热搜线性回升：scale = earlyScale + (maxScale - earlyScale) × min(1, 热搜 / fullScaleAtTrophies) */
  maxScale: 0.85,
  fullScaleAtTrophies: 10,
  /** 橡皮筋：玩家信心 ≤ lowLivesThreshold 时再 × lowLivesScale */
  lowLivesThreshold: 3,
  lowLivesScale: 0.85,
  /** 机器人每 botBonusPerTrophies 个热搜每回合多 1 算力，上限 botBonusMax */
  botBonusPerTrophies: 3,
  botBonusMax: 2,
  /** 机器人每回合刷新次数 = botRerollBase + floor(热搜 / botRerollPerTrophies) */
  botRerollBase: 1,
  botRerollPerTrophies: 3,
  /** 回合 ≥ lateGameTurn 时输一场掉 lateGameLifeLoss 信心（之前掉 1） */
  lateGameTurn: 12,
  lateGameLifeLoss: 2,
  /** 奇数回合结算后突发概率 */
  surpriseChance: 0.3,
};
export type Difficulty = typeof DIFFICULTY;

/** 离线对手的属性系数（只作用于机器人对手，不作用于真人快照） */
export function opponentScale(turn: number, trophies: number, lives?: number): number {
  const d = DIFFICULTY;
  let s = turn <= d.earlyTurns ? d.earlyScale : d.earlyScale + (d.maxScale - d.earlyScale) * Math.min(1, Math.max(0, trophies) / d.fullScaleAtTrophies);
  if (lives !== undefined && lives <= d.lowLivesThreshold) s *= d.lowLivesScale;
  return s;
}
