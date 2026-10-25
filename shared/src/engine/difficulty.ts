// 难度参数（集中在这里调；运行时可直接修改 DIFFICULTY 的字段）。调参依据见 docs/ENGINE_NOTES.md「难度」。
export const DIFFICULTY = {
  /** AI 对手（与玩家交战时）的属性系数：前 earlyTurns 回合 × earlyScale */
  earlyTurns: 4,
  earlyScale: 0.9,
  /** 之后每回合线性回升，rampTurns 回合后到 maxScale */
  rampTurns: 6,
  maxScale: 1.03,
  /** 橡皮筋：玩家热度 ≤ lowHpThreshold 时再 × lowHpScale */
  lowHpThreshold: 6,
  lowHpScale: 0.9,
  /** 机器人每回合刷新次数上限 */
  botRerolls: 2,
  /** 机器人从第几回合起会考虑升级商店（有余钱时） */
  botUpgradeFromTurn: 3,
  /** 奇数回合结算后突发概率 */
  surpriseChance: 0.3,
  /** 头条 lifeTrade 扣多少热度 */
  lifeTradeHp: 3,
};
export type Difficulty = typeof DIFFICULTY;

/** AI 对手与玩家交战时的属性系数（不作用于真人快照、不作用于 AI 之间的对战） */
export function opponentScale(turn: number, playerHp?: number): number {
  const d = DIFFICULTY;
  let s: number;
  if (turn <= d.earlyTurns) s = d.earlyScale;
  else s = d.earlyScale + (d.maxScale - d.earlyScale) * Math.min(1, (turn - d.earlyTurns) / Math.max(1, d.rampTurns));
  if (playerHp !== undefined && playerHp <= d.lowHpThreshold) s *= d.lowHpScale;
  return s;
}
