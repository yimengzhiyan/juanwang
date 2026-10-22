// 机器人：用同一套商店逻辑贪心购物，生成对手队伍。
import { Rng } from '../rng';
import type { GameData, ItemDef, RunState, UnitInst } from '../types';
import {
  BASE_GOLD, TEAM_SIZE, applyAction, beginTurn, clearBattleTemps, emptyModifiers, makeCtx, teamUnits, type Ctx,
} from './shop';

/** 热搜越高，机器人每回合多拿的算力（每 3 热搜 +1，上限 3） */
export function botBonusGold(trophies: number): number {
  return Math.min(3, Math.floor(Math.max(0, trophies) / 3));
}

function unitScore(data: GameData, defId: string, u?: UnitInst): number {
  const d = data.unitsById[defId];
  if (!u) return (d?.tier ?? 1) * 3 + (d?.atk ?? 0) + (d?.hp ?? 0);
  return (d?.tier ?? 1) * 3 + u.atk + u.hp + u.level * 4;
}

function itemTarget(ctx: Ctx, it: ItemDef): { target?: number; source?: number } | null {
  const s = ctx.s;
  const units = s.team.map((u, i) => ({ u, i })).filter((x) => x.u) as { u: UnitInst; i: number }[];
  if (it.targetKind === 'team') {
    if (it.effect.type === 'summonToken') return s.team.some((u) => !u) ? {} : null;
    if (it.effect.type === 'teamBuff') return units.length >= 3 ? {} : null;
    return {};
  }
  if (!units.length) return null;
  const best = units.reduce((a, b) => (unitScore(ctx.data, b.u.defId, b.u) > unitScore(ctx.data, a.u.defId, a.u) ? b : a));
  switch (it.effect.type) {
    case 'buff':
      return { target: best.i };
    case 'shield':
      return { target: units[0].i };
    case 'levelUp': {
      const c = units.filter((x) => x.u.level < 3);
      return c.length ? { target: c.reduce((a, b) => (unitScore(ctx.data, b.u.defId, b.u) > unitScore(ctx.data, a.u.defId, a.u) ? b : a)).i } : null;
    }
    case 'copyStatsFrom': {
      if (units.length < 2) return null;
      const weakest = units.reduce((a, b) => (b.u.atk + b.u.hp < a.u.atk + a.u.hp ? b : a));
      return weakest.i === best.i ? null : { target: weakest.i, source: best.i };
    }
    default:
      return null; // pullFront / transform 机器人不用
  }
}

/** 一个回合的贪心购物 */
function shopTurn(ctx: Ctx, rng: Rng, maxRerolls: number): void {
  const s = ctx.s;
  const data = ctx.data;
  let rerolls = 0;
  for (let guard = 0; guard < 40; guard++) {
    const units = s.shop.map((sl, i) => ({ sl, i })).filter((x) => x.sl.kind === 'unit' && x.sl.price <= s.gold);
    // 1. 合并
    const merge = units.find((x) => s.team.some((u) => u && u.defId === x.sl.defId && u.level < 3));
    if (merge && !applyAction(ctx, { type: 'buy', slot: merge.i })) continue;
    // 2. 空位买最强
    const hasEmpty = s.team.some((u) => !u);
    units.sort((a, b) => unitScore(data, b.sl.defId) - unitScore(data, a.sl.defId));
    if (hasEmpty && units.length && !applyAction(ctx, { type: 'buy', slot: units[0].i })) continue;
    // 3. 满员：卖最弱换更强
    if (!hasEmpty && units.length) {
      const team = teamUnits(s);
      const weakest = team.reduce((a, b) => (unitScore(data, b.defId, b) < unitScore(data, a.defId, a) ? b : a));
      if (unitScore(data, units[0].sl.defId) > unitScore(data, weakest.defId, weakest) + 2) {
        const idx = s.team.indexOf(weakest);
        if (!applyAction(ctx, { type: 'sell', index: idx }) && !applyAction(ctx, { type: 'buy', slot: units[0].i, to: idx })) continue;
      }
    }
    // 4. 基建
    const items = s.shop.map((sl, i) => ({ sl, i })).filter((x) => x.sl.kind === 'item' && x.sl.price <= s.gold);
    let used = false;
    for (const it of items) {
      const def = data.itemsById[it.sl.defId];
      if (!def) continue;
      const t = itemTarget(ctx, def);
      if (t && !applyAction(ctx, { type: 'useItem', slot: it.i, ...t })) {
        used = true;
        break;
      }
    }
    if (used) continue;
    // 5. 刷新
    if (rerolls < maxRerolls && s.gold >= 4 && !applyAction(ctx, { type: 'reroll' })) {
      rerolls++;
      continue;
    }
    break;
  }
  void rng;
}

/** 排阵：血厚的、带阵亡/受伤技能的放前排 */
function arrange(data: GameData, team: (UnitInst | null)[]): UnitInst[] {
  const front = (u: UnitInst) => {
    const t = data.unitsById[u.defId]?.ability?.trigger;
    return u.hp + u.tempHp + (t === 'faint' || t === 'hurt' || t === 'hurtFront' ? 3 : 0) - (t === 'startBattle' ? 2 : 0);
  };
  return team.filter((u): u is UnitInst => !!u).sort((a, b) => front(b) - front(a));
}

/**
 * 生成一支机器人队伍：从回合 1 模拟贪心购物到 turn。热搜越高，每回合额外算力越多、刷新越积极。
 * 完全确定性（同参数同结果）。
 */
export function generateBotTeam(turn: number, trophies: number, data: GameData, seed: string): UnitInst[] {
  const rng = new Rng(`${seed}:bot`);
  const s: RunState = {
    seed, turn: 0, gold: BASE_GOLD, lives: 5, trophies, team: Array(TEAM_SIZE).fill(null), shop: [], phase: 'shop',
    modifiers: emptyModifiers(), history: [], log: [], rng: rng.state, nextUid: 1, seenHeadlines: [], seenSurprises: [],
  };
  const ctx = makeCtx(s, data, true);
  const bonus = botBonusGold(trophies);
  const target = Math.max(1, Math.min(20, Math.floor(turn)));
  for (let t = 1; t <= target; t++) {
    beginTurn(ctx, t);
    s.gold += bonus;
    shopTurn(ctx, rng, 1 + Math.floor(trophies / 3));
    applyAction(ctx, { type: 'endShop' });
    if (t < target) {
      clearBattleTemps(s);
      s.phase = 'result';
    }
  }
  return arrange(data, s.team).map((u) => ({ ...u, uid: `bot${u.uid}` }));
}
