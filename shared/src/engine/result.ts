// 战斗结算：热搜 / 信心 / 胜负判定 / 突发。
import { clone } from '../clone';
import type { BattleResult, GameData, RunState, SurpriseDef } from '../types';
import { MAX_TURNS, WIN_TROPHIES, clearBattleTemps, log, makeCtx, type Ctx } from './shop';

import { DIFFICULTY } from './difficulty';

/** 默认值快照（实际以 DIFFICULTY 为准，可运行时修改） */
export const SURPRISE_CHANCE = DIFFICULTY.surpriseChance;
/** 回合 ≥ 该值输一场掉 2 信心 */
export const LATE_GAME_TURN = DIFFICULTY.lateGameTurn;

/** 输一场掉几颗信心 */
export function livesLostOnDefeat(turn: number): number {
  return turn >= DIFFICULTY.lateGameTurn ? DIFFICULTY.lateGameLifeLoss : 1;
}

function pickSurprise(ctx: Ctx): SurpriseDef | undefined {
  const s = ctx.s;
  const list = ctx.data.surprises;
  if (!list.length || s.turn % 2 === 0) return undefined;
  if (s.tutorial && ctx.data.tutorial && s.turn <= Math.max(...ctx.data.tutorial.turns.map((t) => t.turn))) return undefined;
  if (!ctx.rng.chance(DIFFICULTY.surpriseChance)) return undefined;
  let pool = list.filter((x) => !s.seenSurprises.includes(x.id));
  if (!pool.length) pool = list;
  const sp = ctx.rng.pick(pool);
  s.seenSurprises.push(sp.id);
  return sp;
}

/**
 * 把战斗结果写回局面：热搜/信心、永久 buff、战斗收益、清理临时加成、胜负判定、突发。
 * 返回 phase = 'result'（之后 shopAction({type:'continue'}) 进下一回合）或 'over'。
 */
export function applyBattleResult(state: RunState, result: BattleResult, data: GameData): RunState {
  if (state.phase !== 'battle') return { ...state, error: '现在不是战斗阶段（先 endShop）' };
  const s = clone(state);
  delete s.error;
  const ctx = makeCtx(s, data);
  const w = result.winner;
  if (w === 'me') {
    s.trophies += 1;
    log(ctx, `胜利！热搜 +1（${s.trophies}/${WIN_TROPHIES}）`);
  } else if (w === 'enemy') {
    const lost = livesLostOnDefeat(s.turn);
    s.lives = Math.max(0, s.lives - lost);
    log(ctx, `失败，信心 -${lost}（剩 ${s.lives}）`);
  } else {
    log(ctx, '和局，不加热搜不掉信心');
  }
  const strip = (u: { defId: string; atk: number; hp: number; level: 1 | 2 | 3; tempAtk?: number; tempHp?: number }) => ({
    defId: u.defId, atk: u.atk + (u.tempAtk ?? 0), hp: u.hp + (u.tempHp ?? 0), level: u.level,
  });
  s.history.push({
    turn: s.turn,
    winner: w,
    myTeam: s.team.filter((u) => !!u).map((u) => strip(u!)),
    enemyTeam: result.enemyTeam.map(strip),
    trophies: s.trophies,
    lives: s.lives,
  });
  for (const pb of result.permanentBuffs) {
    const u = s.team.find((x) => x?.uid === pb.uid);
    if (u) {
      u.atk = Math.max(0, u.atk + pb.atk);
      u.hp = Math.max(1, u.hp + pb.hp);
    }
  }
  s.modifiers.nextTurnGold += result.bonus.gold;
  s.modifiers.nextFreeRerolls += result.bonus.rerolls;
  s.modifiers.nextUnitPriceMod -= result.bonus.discount;
  clearBattleTemps(s);
  if (s.tutorial) s.tutorial.battles++;
  s.lastSurprise = undefined;
  s.surprisePending = false;

  if (s.trophies >= WIN_TROPHIES) {
    s.phase = 'over';
    s.won = true;
    s.endReason = 'trophies';
    log(ctx, '登顶热搜榜！');
  } else if (s.lives <= 0) {
    s.phase = 'over';
    s.won = false;
    s.endReason = 'lives';
    log(ctx, '信心归零，出局');
  } else if (s.turn >= MAX_TURNS) {
    s.phase = 'over';
    s.won = false;
    s.endReason = 'turnLimit';
    log(ctx, `已到第 ${MAX_TURNS} 回合，按热搜数结算：${s.trophies}`);
  } else {
    s.phase = 'result';
    const sp = pickSurprise(ctx);
    if (sp) {
      s.lastSurprise = sp;
      s.surprisePending = true;
      log(ctx, `突发：${sp.title}`);
    }
  }
  s.rng = ctx.rng.state;
  return s;
}
