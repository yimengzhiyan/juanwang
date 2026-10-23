// 对外入口：newRun / shopAction（纯函数：输入状态 → 新状态，内部 clone 后修改，不抛异常）。
import { Rng } from '../rng';
import { clone } from '../clone';
import type { GameData, RunState, ShopActionInput } from '../types';
import { START_HP, applyAction, beginTurn, commit, emptyModifiers, log, makeCtx, type Ctx } from './shop';
import { createOpponents, prepareMatchup } from './lobby';
import { applyPveReward } from './pve';

export interface NewRunOpts {
  tutorial?: boolean;
  /** 直接指定赛场（跳过三选一）；null = 不要赛场 */
  arena?: string | null;
}

export const ARENA_CHOICES = 3;

export function newRun(seed: string, data: GameData, opts: NewRunOpts = {}): RunState {
  const tut = !!opts.tutorial && !!data.tutorial;
  const realSeed = tut ? data.tutorial!.seed || seed : seed;
  const s: RunState = {
    seed: realSeed, turn: 0, gold: 0, hp: START_HP, team: Array(5).fill(null), shop: [], phase: 'arena',
    shopLevel: 0, shopTier: 0, opponents: createOpponents(realSeed, data), modifiers: emptyModifiers(), history: [], lastEvents: [],
    stats: { maxTiers: {}, wins: 0, losses: 0, pveWins: 0, goldEquips: 0, lv3: 0, steals: 0, upgrades: 0, bestStreak: 0, streak: 0 },
    log: [], rng: new Rng(`${realSeed}:run`).state, nextUid: 1, seenHeadlines: [], seenSurprises: [],
  };
  if (tut) s.tutorial = { buys: 0, battles: 0, merged: false, usedItem: false, froze: false, sold: false, headline: false, synergy: false };
  const ctx = makeCtx(s, data);
  if (tut || opts.arena !== undefined) {
    if (opts.arena && data.arenasById[opts.arena]) s.arena = opts.arena;
    beginTurn(ctx, 1);
  } else {
    s.arenaOptions = ctx.rng.sample(data.arenas, Math.min(ARENA_CHOICES, data.arenas.length)).map((a) => a.id);
    if (!s.arenaOptions.length) beginTurn(ctx, 1);
  }
  return commit(ctx);
}

/** 商店阶段与回合推进的所有操作。非法操作返回原状态（浅拷贝）并带 error 文案，不抛异常。 */
export function shopAction(state: RunState, action: ShopActionInput, data: GameData): RunState {
  const s = clone(state);
  delete s.error;
  s.lastEvents = [];
  const ctx = makeCtx(s, data);
  const err = runAction(ctx, action);
  if (err) return { ...state, error: err };
  return commit(ctx);
}

function runAction(ctx: Ctx, a: ShopActionInput): string | null {
  const s = ctx.s;
  switch (a.type) {
    case 'chooseArena': {
      if (s.phase !== 'arena' || !s.arenaOptions) return '现在不是选赛场的时候';
      const id = s.arenaOptions[a.index];
      if (!id) return '没有这个赛场';
      s.arena = id;
      s.arenaOptions = undefined;
      log(ctx, `赛场：${ctx.data.arenasById[id]?.name ?? id}`);
      beginTurn(ctx, 1);
      return null;
    }
    case 'endShop': {
      const err = applyAction(ctx, a);
      if (err) return err;
      prepareMatchup(ctx);
      return null;
    }
    case 'choosePveReward': {
      if (!s.pending || s.pending.type !== 'pveReward') return '现在没有可选的奖励';
      const opt = s.pending.options[a.index];
      if (!opt) return '没有这个选项';
      applyPveReward(ctx, opt);
      log(ctx, `PVE 奖励：${opt.text}`);
      s.pending = undefined;
      return null;
    }
    case 'continue': {
      if (s.phase !== 'result') return '还没结算';
      if (s.pending) return '先选择奖励';
      beginTurn(ctx, s.turn + 1);
      return null;
    }
    default:
      return applyAction(ctx, a);
  }
}
