// 战斗结算（DESIGN 12.5 / 14）：扣血 / 其余对局 / 淘汰与名次 / PVE 奖励 / 突发 / 结局与成就。
import { clone } from '../clone';
import type { BattleResult, GameData, RunEnd, RunState, SurpriseDef, SynergyKey, UnitInst } from '../types';
import { MAX_TURNS, clearBattleTemps, emitEvent, log, makeCtx, teamUnits, type Ctx } from './shop';
import { DIFFICULTY } from './difficulty';
import { aliveCount, hpLossFor, processEliminations, rankByHp, resolveOtherMatches, stageBonus } from './lobby';
import { rollPveRewards } from './pve';
import { SYNERGY_NAME, computeSynergies, dominantSynergy, stateBonus } from './synergy';
import { effectiveStats } from './equip';

export { hpLossFor, stageBonus };
export { buildSummary } from './summary';

/** 成就 id → 中文名（客户端对比本地记录显示"首次达成"） */
export const ACHIEVEMENTS: Record<string, string> = {
  champion: '卷王：吃鸡',
  top4: '前四',
  survivor10: '活过 10 回合',
  goldEquip: '首件金色装备',
  lv3: '满级进化',
  pveAll: 'PVE 全胜',
  upgradeMax: '商店满升级',
  streak5: '五连胜',
  steal: '挖角成功',
  'tier:open:3': '流派·开源 ×6', 'tier:closed:3': '流派·闭源 ×6', 'tier:compute:3': '流派·算力 ×6', 'tier:folk:3': '流派·民间 ×6',
  'tier:researcher:2': '流派·研究员 ×4', 'tier:trader:2': '流派·商人 ×4', 'tier:idol:2': '流派·偶像 ×4', 'tier:engineer:2': '流派·工程师 ×4',
  'tier:open:2': '流派·开源 ×4', 'tier:closed:2': '流派·闭源 ×4', 'tier:compute:2': '流派·算力 ×4', 'tier:folk:2': '流派·民间 ×4',
};

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

/** 本局最强单位（有效攻 + 血 + 等级 ×4） */
export function bestUnitOf(team: readonly (UnitInst | null)[], data: GameData): UnitInst | undefined {
  const l = team.filter((u): u is UnitInst => !!u);
  if (!l.length) return undefined;
  const v = (u: UnitInst) => {
    const e = effectiveStats(u, data, team);
    return e.atk + e.hp + u.level * 4;
  };
  return l.reduce((a, b) => (v(b) > v(a) ? b : a));
}

/** 生成结局：名次、流派（最终阵容的最高羁绊档）、成就 */
export function computeRunEnd(s: RunState, data: GameData, rank: number, reason: RunEnd['reason']): RunEnd {
  const dom = dominantSynergy(computeSynergies(s.team, data, stateBonus(s, data)));
  const ach: string[] = [];
  if (rank === 1) ach.push('champion');
  if (rank <= 4) ach.push('top4');
  if (s.turn >= 10) ach.push('survivor10');
  if (s.stats.goldEquips > 0) ach.push('goldEquip');
  if (s.stats.lv3 > 0) ach.push('lv3');
  if (s.stats.upgrades >= 2) ach.push('upgradeMax');
  if (s.stats.bestStreak >= 5) ach.push('streak5');
  if (s.stats.steals > 0) ach.push('steal');
  const pveTotal = data.pve.filter((p) => p.turn <= s.turn).length;
  if (pveTotal >= 2 && s.stats.pveWins >= pveTotal) ach.push('pveAll');
  for (const [k, t] of Object.entries(s.stats.maxTiers) as [SynergyKey, number][]) {
    for (let x = 2; x <= (t ?? 0); x++) if (ACHIEVEMENTS[`tier:${k}:${x}`]) ach.push(`tier:${k}:${x}`);
  }
  const best = bestUnitOf(s.team, data);
  return {
    rank, won: rank === 1, reason, turns: s.turn, hp: Math.max(0, s.hp),
    archetype: dom ? dom.key : 'mixed', archetypeName: dom ? `${SYNERGY_NAME[dom.key]}流` : '杂牌军',
    achievements: ach,
    ...(best ? { bestUnit: best.defId } : {}),
  };
}

/**
 * 把这回合的战斗结果写回局面：扣血（12.5 公式）、其余对手互打、淘汰与名次、PVE 奖励、永久 buff、战斗收益、突发。
 * 返回 phase = 'result'（之后 shopAction({type:'continue'})，有 pending 时先 choosePveReward）或 'over'（state.end）。
 */
export function applyBattleResult(state: RunState, result: BattleResult, data: GameData): RunState {
  if (state.phase !== 'battle') return { ...state, error: '现在不是战斗阶段（先 endShop）' };
  const s = clone(state);
  delete s.error;
  s.lastEvents = [];
  const ctx = makeCtx(s, data);
  const mu = s.matchup;
  const w = result.winner;
  const isPve = mu?.kind === 'pve';
  let hpLoss = 0;
  const opp = mu?.kind === 'pvp' ? s.opponents.find((o) => o.id === mu.opponentId) : undefined;

  // 1. 玩家这一场
  if (isPve) {
    s.pve = { ...(s.pve ?? { pveId: mu!.opponentId, turn: s.turn }), won: w === 'me' };
    if (w === 'me') {
      s.stats.pveWins++;
      const pv = data.pve.find((p) => p.id === mu!.opponentId);
      if (pv) {
        const options = rollPveRewards(ctx, pv);
        if (options.length) {
          s.pending = { type: 'pveReward', pveId: pv.id, options };
          emitEvent(ctx, { type: 'pveReward', pveId: pv.id, options, text: `击败「${pv.name}」！三选一奖励` });
        }
      }
      log(ctx, `PVE 胜利：${mu!.name}`);
    } else log(ctx, `PVE 失败：${mu!.name}（不扣热度）`);
  } else if (w === 'me') {
    const loss = hpLossFor(s.turn, result.survivors) * (s.modifiers.rewardMul ?? 1);
    if (opp) {
      opp.hp -= loss;
      opp.lastResult = 'loss';
      emitEvent(ctx, { type: 'hpLoss', who: opp.id, name: opp.name, amount: loss, hp: Math.max(0, opp.hp), by: 'me', text: `${opp.name} 热度 -${loss}` });
    }
    log(ctx, `胜利！${mu?.name ?? '对手'} -${loss} 热度`);
  } else if (w === 'enemy') {
    hpLoss = hpLossFor(s.turn, result.survivors) + (s.modifiers.wager?.loseHp ?? 0);
    s.hp -= hpLoss;
    if (opp) opp.lastResult = 'win';
    emitEvent(ctx, { type: 'hpLoss', who: 'me', name: '你', amount: hpLoss, hp: Math.max(0, s.hp), by: opp?.id, text: `热度 -${hpLoss}` });
    log(ctx, `失败，热度 -${hpLoss}（剩 ${Math.max(0, s.hp)}）`);
  } else {
    if (opp) opp.lastResult = 'draw';
    log(ctx, '和局，双方不掉热度');
  }
  if (!isPve) {
    if (w === 'me') {
      s.stats.wins++;
      s.stats.streak++;
      s.stats.bestStreak = Math.max(s.stats.bestStreak, s.stats.streak);
      if (s.modifiers.wager) s.modifiers.nextTurnGold += s.modifiers.wager.winGold;
    } else if (w === 'enemy') {
      s.stats.losses++;
      s.stats.streak = 0;
    }
  }
  for (const st of result.summary.synergyTiers) s.stats.maxTiers[st.key] = Math.max(s.stats.maxTiers[st.key] ?? 0, st.tier);
  if (result.events.some((e) => e.type === 'steal' && e.to.side === 'me')) s.stats.steals++;

  // 2. 其余对局 / PVE 模拟
  resolveOtherMatches(ctx, opp?.id, isPve);

  // 3. 记录、永久 buff、战斗收益、清理
  const strip = (u: { defId: string; atk: number; hp: number; level: 1 | 2 | 3; tempAtk?: number; tempHp?: number }) => ({
    defId: u.defId, atk: u.atk + (u.tempAtk ?? 0), hp: u.hp + (u.tempHp ?? 0), level: u.level,
  });
  s.history.push({
    turn: s.turn, winner: w, kind: isPve ? 'pve' : 'pvp', opponentId: mu?.opponentId ?? '', opponentName: mu?.name ?? '',
    myTeam: teamUnits(s).map(strip), enemyTeam: result.enemyTeam.map(strip), hp: Math.max(0, s.hp), hpLoss, summary: result.summary,
  });
  s.lastSummary = result.summary;
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

  // 4. 淘汰 / 结局
  const myPlace = processEliminations(ctx);
  if (myPlace !== undefined) {
    s.phase = 'over';
    s.pending = undefined;
    s.end = computeRunEnd(s, data, myPlace, 'eliminated');
    log(ctx, `热度归零，第 ${myPlace} 名`);
  } else if (aliveCount(s) === 1) {
    s.phase = 'over';
    s.pending = undefined;
    s.end = computeRunEnd(s, data, 1, 'champion');
    log(ctx, '吃鸡！你是最后的卷王');
  } else if (s.turn >= MAX_TURNS) {
    s.phase = 'over';
    s.pending = undefined;
    const rank = rankByHp(s);
    s.end = computeRunEnd(s, data, rank, 'turnLimit');
    log(ctx, `已到第 ${MAX_TURNS} 回合，按热度排名：第 ${rank} 名`);
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
