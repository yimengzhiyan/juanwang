// 机器人：按流派偏好贪心购物（同一套商店逻辑），生成 AI 对手队伍；也可以替玩家自动购物（模拟/测试/托管）。
import { Rng } from '../rng';
import { clone } from '../clone';
import { type Archetype, type BotMemo, type GameData, type OpponentPreset, type RunState, type UnitDef, type UnitInst } from '../types';
import {
  MAX_SHOP_LEVEL, TEAM_SIZE, UPGRADE_PRICE, applyAction, beginTurn, clearBattleTemps, emptyModifiers, makeCtx, shopMaxTier, teamUnits,
  START_HP, type Ctx,
} from './shop';
import { DIFFICULTY } from './difficulty';
import { equipCount } from './equip';
import { countLines } from './synergy';

/** 机器人的购物偏好 */
export interface BotProfile {
  archetype: Archetype;
  /** 核心单位（额外加分） */
  core?: string[];
  /** 偏好装备 */
  equips?: string[];
}
export function profileOf(p: OpponentPreset | Archetype): BotProfile {
  if ('archetype' in p) return { archetype: p.archetype, core: p.core, equips: p.equips };
  return { archetype: p };
}

const matches = (d: UnitDef | undefined, a: Archetype): boolean => !!d && ((!!a.faction && d.faction === a.faction) || (!!a.role && d.role === a.role));

/** 单位估值：阶 ×3 + 属性 + 等级；流派匹配 +14、核心 +4；与现有队伍同线 +1/个 */
function unitScore(ctx: Ctx, prof: BotProfile, defId: string, u?: UnitInst): number {
  const d = ctx.data.unitsById[defId];
  let v = (d?.tier ?? 1) * 3;
  v += u ? u.atk + u.hp + u.level * 4 + equipCount(u) * 3 : (d?.atk ?? 0) + (d?.hp ?? 0);
  if (matches(d, prof.archetype)) v += 14;
  if (prof.core?.includes(defId)) v += 4;
  if (d) {
    const c = countLines(teamUnits(ctx.s).filter((x) => x !== u).map((x) => ctx.data.unitsById[x.defId]));
    v += Math.min(3, c[d.faction]) + (d.role ? Math.min(3, c[d.role]) : 0);
  }
  return v;
}

/** 主力：流派内估值最高的单位（没有就全队最高） */
function carryIndex(ctx: Ctx, prof: BotProfile): number {
  let best = -1;
  let bv = -Infinity;
  ctx.s.team.forEach((u, i) => {
    if (!u) return;
    const v = unitScore(ctx, prof, u.defId, u) + (matches(ctx.data.unitsById[u.defId], prof.archetype) ? 20 : 0);
    if (v > bv) {
      bv = v;
      best = i;
    }
  });
  return best;
}

function tryEquip(ctx: Ctx, prof: BotProfile): boolean {
  const s = ctx.s;
  const slots = s.shop.map((sl, i) => ({ sl, i })).filter((x) => x.sl.kind === 'equip' && x.sl.price <= s.gold);
  if (!slots.length || !teamUnits(s).length) return false;
  // 偏好装备、金色、便宜的先
  slots.sort((a, b) => (prof.equips?.includes(b.sl.defId) ? 1 : 0) - (prof.equips?.includes(a.sl.defId) ? 1 : 0) || (b.sl.gold ? 1 : 0) - (a.sl.gold ? 1 : 0) || a.sl.price - b.sl.price);
  const order = [carryIndex(ctx, prof), ...s.team.map((_, i) => i)].filter((i, k, arr) => i >= 0 && s.team[i] && arr.indexOf(i) === k);
  for (const { sl, i } of slots) {
    const def = ctx.data.equipsById[sl.defId];
    if (!def) continue;
    for (const ti of order) {
      const cur = s.team[ti]!.equips?.[def.slot];
      // 空槽、或能合成金色
      if (!cur || (cur.defId === def.id && !cur.gold && !sl.gold)) {
        if (!applyAction(ctx, { type: 'equip', slot: i, unitIndex: ti })) return true;
      }
    }
  }
  return false;
}

function tryConsumable(ctx: Ctx): boolean {
  const s = ctx.s;
  const i = s.shop.findIndex((x) => x.kind === 'consumable' && x.price <= s.gold);
  if (i < 0) return false;
  const c = ctx.data.consumablesById[s.shop[i].defId];
  if (!c) return false;
  if (c.effect.type === 'levelUpRandom' && teamUnits(s).some((u) => u.level < 3) && s.gold - s.shop[i].price >= 0) return !applyAction(ctx, { type: 'useConsumable', slot: i });
  if (c.effect.type === 'freeRerolls' && s.gold >= 3) return !applyAction(ctx, { type: 'useConsumable', slot: i });
  if (c.effect.type === 'gold') return !applyAction(ctx, { type: 'useConsumable', slot: i });
  return false;
}

/** 一个回合的贪心购物（就地修改 ctx.s，phase 需为 shop） */
export function botShopTurn(ctx: Ctx, prof: BotProfile, maxRerolls = DIFFICULTY.botRerolls): void {
  const s = ctx.s;
  let rerolls = 0;
  for (let guard = 0; guard < 60 && s.phase === 'shop'; guard++) {
    const units = s.shop.map((sl, i) => ({ sl, i })).filter((x) => x.sl.kind === 'unit' && x.sl.price <= s.gold);
    // 1. 合体优先
    const merge = units.find((x) => s.team.some((u) => u && u.defId === x.sl.defId && u.level < 3));
    if (merge && !applyAction(ctx, { type: 'buy', slot: merge.i })) continue;
    // 2. 空位买估值最高的
    const hasEmpty = s.team.some((u) => !u);
    units.sort((a, b) => unitScore(ctx, prof, b.sl.defId) - unitScore(ctx, prof, a.sl.defId));
    if (hasEmpty && units.length && !applyAction(ctx, { type: 'buy', slot: units[0].i })) continue;
    // 3. 满员：卖最弱换明显更强的；流派单位优先顶掉流派外的单位，流派内的单位只会被流派内的单位替换
    if (!hasEmpty && units.length) {
      const team = teamUnits(s).filter((x) => equipCount(x) === 0);
      const cand = units[0];
      const candIn = matches(ctx.data.unitsById[cand.sl.defId], prof.archetype);
      const pool = candIn && team.some((x) => !matches(ctx.data.unitsById[x.defId], prof.archetype))
        ? team.filter((x) => !matches(ctx.data.unitsById[x.defId], prof.archetype))
        : team.filter((x) => candIn || !matches(ctx.data.unitsById[x.defId], prof.archetype));
      if (pool.length) {
        const weakest = pool.reduce((a, b) => (unitScore(ctx, prof, b.defId, b) < unitScore(ctx, prof, a.defId, a) ? b : a));
        const margin = candIn && !matches(ctx.data.unitsById[weakest.defId], prof.archetype) ? -4 : 3;
        if (unitScore(ctx, prof, cand.sl.defId) > unitScore(ctx, prof, weakest.defId, weakest) + margin) {
          const idx = s.team.indexOf(weakest);
          if (!applyAction(ctx, { type: 'sell', index: idx }) && !applyAction(ctx, { type: 'buy', slot: cand.i, to: idx })) continue;
        }
      }
    }
    // 4. 装备往主力上堆
    if (tryEquip(ctx, prof)) continue;
    // 5. 消耗品
    if (tryConsumable(ctx)) continue;
    // 6. 升级商店（队伍满了、有余钱）
    if (s.turn >= DIFFICULTY.botUpgradeFromTurn && !hasEmpty && s.shopLevel < MAX_SHOP_LEVEL && shopMaxTier(s) < 6 && s.gold >= UPGRADE_PRICE + 3
      && !applyAction(ctx, { type: 'upgradeShop' })) continue;
    // 7. 刷新（流派成员不足 3 个时多刷 2 次找核心）
    const members = teamUnits(s).filter((x) => matches(ctx.data.unitsById[x.defId], prof.archetype)).length;
    const limit = maxRerolls + (members < 3 && (prof.archetype.faction || prof.archetype.role) ? 2 : 0);
    if (rerolls < limit && s.gold >= 2 && !applyAction(ctx, { type: 'reroll' })) {
      rerolls++;
      continue;
    }
    break;
  }
  arrangeTeam(ctx);
}

/** 排阵：血厚、带阵亡/受伤/复活技能、穿防具的在前；带开战技能、装武器的靠后 */
export function arrangeTeam(ctx: Ctx): void {
  const s = ctx.s;
  const front = (u: UnitInst) => {
    const ab = ctx.data.unitsById[u.defId]?.ability;
    const t = ab?.trigger;
    return u.hp + u.tempHp + (t === 'faint' || t === 'hurt' || t === 'hurtFront' ? 3 : 0) + (ab?.effect === 'revive' ? 4 : 0) + (u.equips?.armor ? 3 : 0)
      - (t === 'startBattle' ? 2 : 0) - (u.equips?.weapon ? 2 : 0);
  };
  const units = teamUnits(s).sort((a, b) => front(b) - front(a));
  s.team = [...units, ...Array(TEAM_SIZE - units.length).fill(null)];
}

/** 机器人记忆的初始值 */
export function newBotMemo(seed: string): BotMemo {
  return { rng: new Rng(seed).state, nextUid: 1, shopLevel: 0, shopTier: 0, bonusGold: 0, frozen: [] };
}

/** 用机器人记忆搭一个模拟局面（不出头条/突发） */
function simState(seed: string, team: UnitInst[], memo: BotMemo, arena?: string): RunState {
  const t = [...team.map((u) => clone(u))];
  while (t.length < TEAM_SIZE) t.push(null as unknown as UnitInst);
  return {
    seed, turn: 0, gold: 0, hp: START_HP, team: t, shop: clone(memo.frozen), phase: 'shop', arena, shopLevel: memo.shopLevel, shopTier: memo.shopTier,
    opponents: [], modifiers: { ...emptyModifiers(), nextTurnGold: memo.bonusGold }, history: [], lastEvents: [],
    stats: { maxTiers: {}, wins: 0, losses: 0, pveWins: 0, goldEquips: 0, lv3: 0, steals: 0, upgrades: 0, bestStreak: 0, streak: 0 },
    log: [], rng: memo.rng, nextUid: memo.nextUid, seenHeadlines: [], seenSurprises: [],
  };
}

/**
 * 推进一名机器人一个回合：回合开始 → 购物 → endShop。返回本回合阵容（含本回合临时加成，前排在前）与新的记忆。
 */
export function advanceBot(team: UnitInst[], memo: BotMemo, turn: number, prof: BotProfile, data: GameData, arena?: string, seed = 'bot'): { team: UnitInst[]; memo: BotMemo } {
  const s = simState(seed, team, memo, arena);
  clearBattleTemps(s);
  const ctx = makeCtx(s, data, true);
  beginTurn(ctx, turn);
  botShopTurn(ctx, prof);
  applyAction(ctx, { type: 'endShop' });
  return {
    team: teamUnits(s),
    memo: { rng: ctx.rng.state, nextUid: s.nextUid, shopLevel: s.shopLevel, shopTier: s.shopTier, bonusGold: 0, frozen: s.shop.filter((x) => x.frozen) },
  };
}

/**
 * 按流派生成一支机器人队伍：从回合 1 模拟购物到 turn（完全确定性）。
 * opts.scale：属性系数（作为离线对手时用 opponentScale）；opts.arena：赛场。
 */
export function generateArchetypeTeam(
  archetype: Archetype | BotProfile,
  turn: number,
  seed: string,
  data: GameData,
  opts: { scale?: number; arena?: string } = {},
): UnitInst[] {
  const prof: BotProfile = 'archetype' in archetype ? archetype : { archetype };
  let team: UnitInst[] = [];
  let memo = newBotMemo(`${seed}:bot`);
  const target = Math.max(1, Math.min(20, Math.floor(turn)));
  for (let t = 1; t <= target; t++) {
    const r = advanceBot(team, memo, t, prof, data, opts.arena, seed);
    team = r.team;
    memo = r.memo;
  }
  const out = team.map((u) => ({ ...u, uid: `bot${u.uid}` }));
  return opts.scale !== undefined ? scaleTeam(out, opts.scale) : out;
}

/** 无流派偏好的机器人（兼容 1.0 用法） */
export function generateBotTeam(turn: number, data: GameData, seed: string, opts: { scale?: number; arena?: string } = {}): UnitInst[] {
  return generateArchetypeTeam({}, turn, seed, data, opts);
}

/** 按系数缩放队伍属性（含临时加成），攻击最低 0、血量最低 1 */
export function scaleTeam(team: UnitInst[], factor: number): UnitInst[] {
  if (factor === 1) return team;
  return team.map((u) => ({
    ...u,
    atk: Math.max(0, Math.round((u.atk + u.tempAtk) * factor) - u.tempAtk),
    hp: Math.max(1, Math.round((u.hp + u.tempHp) * factor) - u.tempHp),
  }));
}

/**
 * 替玩家自动购物一回合（机器人水平；用于模拟、测试、"托管"）。phase 为 headline 时先选第 0 项。
 * 返回新状态（仍是 shop 阶段，调用方再 endShop）。
 */
export function botPlayTurn(state: RunState, data: GameData, prof: BotProfile): RunState {
  const s = clone(state);
  delete s.error;
  s.lastEvents = [];
  const ctx = makeCtx(s, data);
  if (s.phase === 'headline') applyAction(ctx, { type: 'chooseHeadline', option: 0 });
  if (s.phase === 'shop') botShopTurn(ctx, prof);
  s.rng = ctx.rng.state;
  return s;
}

