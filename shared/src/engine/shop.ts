// 商店阶段引擎：newRun / shopAction 及回合推进（纯函数：输入状态 → 新状态，内部 structuredClone 后修改）。
import { Rng } from '../rng';
import { clone } from '../clone';
import {
  ENEMY_TARGETS,
  type Ability, type EventEffect, type FreeReason, type TargetFilter, type GameData, type HeadlineDef, type ItemDef, type Level, type Modifiers,
  type RunState, type ShopActionInput, type ShopSlot, type Tier, type Trigger, type UnitDef, type UnitInst,
} from '../types';

// ───────────────────────── 常量 ─────────────────────────
export const TEAM_SIZE = 5;
export const START_LIVES = 5;
export const WIN_TROPHIES = 10;
export const MAX_TURNS = 20;
export const BASE_GOLD = 10;
export const UNIT_PRICE = 3;
export const REROLL_PRICE = 1;
export const MAX_XP = 5;
export const LOG_LIMIT = 200;

/** 当前回合解锁的最高阶：T1 回合1，T2 回合3，T3 回合5，T4 回合7，T5 回合9，T6 回合11 */
export function maxTierForTurn(turn: number): Tier {
  return Math.min(6, 1 + Math.floor((Math.max(1, turn) - 1) / 2)) as Tier;
}
/** 商店单位槽：3（回合5起 4，回合9起 5） */
export function unitSlotsForTurn(turn: number): number {
  return turn >= 9 ? 5 : turn >= 5 ? 4 : 3;
}
/** 商店基建槽：1（回合3起 2） */
export function itemSlotsForTurn(turn: number): number {
  return turn >= 3 ? 2 : 1;
}
/** 基建阶级解锁：T1 回合1，T2 回合5，T3 回合9 */
export function maxItemTierForTurn(turn: number): 1 | 2 | 3 {
  return turn >= 9 ? 3 : turn >= 5 ? 2 : 1;
}
/** 商店权重：阶 t 的权重 = t（最高阶最高，低阶线性递减） */
export function tierWeights(maxTier: number): number[] {
  return Array.from({ length: maxTier }, (_, i) => i + 1);
}
/** xp → 等级（Lv2 需 3 份 = xp2，Lv3 需 6 份 = xp5） */
export function levelForXp(xp: number): Level {
  return xp >= 5 ? 3 : xp >= 2 ? 2 : 1;
}
/** 升到某级所需最少 xp */
export function xpForLevel(level: Level): number {
  return level === 3 ? 5 : level === 2 ? 2 : 0;
}
/** 是否偶数回合有头条（引导局用 tutorial.headlineTurn 替代） */
export function isHeadlineTurn(turn: number, state?: Pick<RunState, 'tutorial'>, data?: GameData): boolean {
  if (state?.tutorial && data?.tutorial) {
    const ht = data.tutorial.headlineTurn ?? 3;
    const fixedTurns = Math.max(0, ...data.tutorial.turns.map((t) => t.turn));
    if (turn <= Math.max(fixedTurns, ht)) return turn === ht;
  }
  return turn % 2 === 0;
}

export function emptyModifiers(): Modifiers {
  return {
    unitPriceMod: 0, itemPriceMod: 0, extraUnitSlots: 0, rerollFree: false, freeRerolls: 0, enemyAtkDebuff: 0,
    nextTurnGold: 0, nextFreeRerolls: 0, nextUnitPriceMod: 0, battleSwapAll: 0, battlePullFront: [],
  };
}

// ───────────────────────── 上下文 ─────────────────────────

/** 引擎内部可变上下文。所有 mutate* 函数都直接改 ctx.s。 */
export interface Ctx {
  s: RunState;
  data: GameData;
  rng: Rng;
  /** 机器人模拟时为 true：不出头条/突发，不写日志 */
  sim?: boolean;
}

export function makeCtx(s: RunState, data: GameData, sim = false): Ctx {
  return { s, data, rng: Rng.fromState(s.rng), sim };
}
function commit(ctx: Ctx): RunState {
  ctx.s.rng = ctx.rng.state;
  return ctx.s;
}
export function log(ctx: Ctx, msg: string): void {
  if (ctx.sim) return;
  ctx.s.log.push(msg);
  if (ctx.s.log.length > LOG_LIMIT) ctx.s.log.splice(0, ctx.s.log.length - LOG_LIMIT);
}
const unitName = (ctx: Ctx, defId: string): string => ctx.data.unitsById[defId]?.name ?? defId;

export function newUnit(ctx: Ctx, defId: string): UnitInst {
  const def = ctx.data.unitsById[defId];
  return {
    uid: `u${ctx.s.nextUid++}`,
    defId,
    atk: def?.atk ?? 1,
    hp: def?.hp ?? 1,
    level: 1,
    xp: 0,
    shield: 0,
    tempAtk: 0,
    tempHp: 0,
  };
}

// ───────────────────────── 随机抽取 ─────────────────────────

export interface UnitRollOpts { maxTier?: number; tier?: number; faction?: string; exclude?: string }

/** 按阶权重抽一个商店单位 defId（tier 指定时只在该阶抽；对应池子为空时向低阶回退） */
export function rollUnitDef(ctx: Ctx, opts: UnitRollOpts = {}): string | null {
  const byTier = ctx.data.shopUnitsByTier;
  const filt = (list: UnitDef[]): UnitDef[] =>
    list.filter((u) => (!opts.faction || u.faction === opts.faction) && u.id !== opts.exclude);
  if (opts.tier) {
    for (let t = opts.tier; t >= 1; t--) {
      const pool = filt(byTier[t] ?? []);
      if (pool.length) return ctx.rng.pick(pool).id;
    }
    return null;
  }
  const maxTier = opts.maxTier ?? maxTierForTurn(ctx.s.turn);
  const pools: UnitDef[][] = [];
  const weights: number[] = [];
  tierWeights(maxTier).forEach((w, i) => {
    const pool = filt(byTier[i + 1] ?? []);
    if (pool.length) {
      pools.push(pool);
      weights.push(w);
    }
  });
  if (!pools.length) {
    const any = filt(ctx.data.units.filter((u) => !u.token));
    return any.length ? ctx.rng.pick(any).id : null;
  }
  return ctx.rng.pick(pools[ctx.rng.weighted(weights)]).id;
}

export function rollItemDef(ctx: Ctx): string | null {
  const maxT = maxItemTierForTurn(ctx.s.turn);
  const pools: ItemDef[][] = [];
  const weights: number[] = [];
  for (let t = 1; t <= maxT; t++) {
    const pool = ctx.data.items.filter((it) => it.tier === t);
    if (pool.length) {
      pools.push(pool);
      weights.push(t);
    }
  }
  if (!pools.length) return null;
  return ctx.rng.pick(pools[ctx.rng.weighted(weights)]).id;
}

// ───────────────────────── 商店 ─────────────────────────

export function slotPrice(ctx: Ctx, slot: Pick<ShopSlot, 'kind' | 'defId' | 'free'>): number {
  if (slot.free) return 0;
  const m = ctx.s.modifiers;
  if (slot.kind === 'unit') return Math.max(1, UNIT_PRICE + m.unitPriceMod);
  const base = ctx.data.itemsById[slot.defId]?.price ?? 3;
  return Math.max(Math.min(1, base), base + m.itemPriceMod);
}
export function repriceShop(ctx: Ctx): void {
  for (const sl of ctx.s.shop) sl.price = slotPrice(ctx, sl);
}
function mkSlot(ctx: Ctx, kind: 'unit' | 'item', defId: string, freeReason?: FreeReason): ShopSlot {
  const sl: ShopSlot = { kind, defId, price: 0, frozen: false };
  if (freeReason) {
    sl.free = true;
    sl.freeReason = freeReason;
  }
  sl.price = slotPrice(ctx, sl);
  return sl;
}
function sortShop(s: RunState): void {
  // 单位槽在前、基建槽在后；同类内保持原有顺序
  s.shop = [...s.shop.filter((x) => x.kind === 'unit'), ...s.shop.filter((x) => x.kind === 'item')];
}

/**
 * 刷新商店：保留冻结槽与（同回合内的）免费槽，其余重抽到满额。
 * initial=true 表示回合开始的那次（引导局固定商店只在这次生效）。
 */
export function rollShop(ctx: Ctx, initial = false): void {
  const s = ctx.s;
  const keep = s.shop.filter((x) => x.frozen || (!initial && x.free));
  const fixed = initial ? tutorialTurn(ctx) : undefined;
  let units: ShopSlot[];
  let items: ShopSlot[];
  const keptUnits = keep.filter((x) => x.kind === 'unit');
  const keptItems = keep.filter((x) => x.kind === 'item');
  if (fixed) {
    units = fixed.units.filter((id) => ctx.data.unitsById[id]).map((id) => mkSlot(ctx, 'unit', id));
    items = (fixed.items ?? []).filter((id) => ctx.data.itemsById[id]).map((id) => mkSlot(ctx, 'item', id));
  } else {
    const nUnits = Math.max(0, unitSlotsForTurn(s.turn) + s.modifiers.extraUnitSlots - keptUnits.filter((x) => !x.free).length);
    const nItems = Math.max(0, itemSlotsForTurn(s.turn) - keptItems.length);
    units = [];
    for (let i = 0; i < nUnits; i++) {
      const id = rollUnitDef(ctx);
      if (id) units.push(mkSlot(ctx, 'unit', id));
    }
    items = [];
    for (let i = 0; i < nItems; i++) {
      const id = rollItemDef(ctx);
      if (id) items.push(mkSlot(ctx, 'item', id));
    }
  }
  s.shop = [...keptUnits, ...units, ...keptItems, ...items];
  sortShop(s);
  repriceShop(ctx);
}

function tutorialTurn(ctx: Ctx) {
  if (!ctx.s.tutorial || !ctx.data.tutorial) return undefined;
  return ctx.data.tutorial.turns.find((t) => t.turn === ctx.s.turn);
}

/** 往商店追加一个免费单位槽（进化奖励 levelUp / 头条突发 freeUnit = event） */
export function addFreeUnitSlot(ctx: Ctx, defId: string, reason: FreeReason): void {
  ctx.s.shop.push(mkSlot(ctx, 'unit', defId, reason));
  sortShop(ctx.s);
}

// ───────────────────────── 队伍工具 ─────────────────────────

export function teamUnits(s: RunState): UnitInst[] {
  return s.team.filter((u): u is UnitInst => !!u);
}
function indexOfUid(s: RunState, uid: string): number {
  return s.team.findIndex((u) => u?.uid === uid);
}
function firstEmpty(s: RunState, near = -1): number {
  if (near >= 0) {
    for (let i = near + 1; i < TEAM_SIZE; i++) if (!s.team[i]) return i;
    for (let i = near - 1; i >= 0; i--) if (!s.team[i]) return i;
    return -1;
  }
  return s.team.findIndex((u) => !u);
}
/** 把某个单位移动到 to（其余单位相对顺序不变，空位保留在末尾） */
function moveUnit(s: RunState, from: number, to: number): void {
  const u = s.team[from];
  if (!u) return;
  const rest = s.team.filter((x, i) => x && i !== from) as UnitInst[];
  rest.splice(Math.min(to, rest.length), 0, u);
  s.team = [...rest, ...Array(TEAM_SIZE - rest.length).fill(null)];
}
function clampHp(u: UnitInst): void {
  if (u.hp < 1) u.hp = 1;
  if (u.atk < 0) u.atk = 0;
  if (u.hp + u.tempHp < 1) u.tempHp = 1 - u.hp;
  if (u.atk + u.tempAtk < 0) u.tempAtk = -u.atk;
}
export function canMerge(a: UnitInst, b: UnitInst): boolean {
  return a.defId === b.defId && a.level < 3 && b.level < 3;
}

// ───────────────────────── 进化 ─────────────────────────

/**
 * 给 target 合并进 copies 份（每份 xp = other.xp + 1），属性 = 各份最高值 +1/+1（每次合并）。
 * 升级时触发 levelUp 技能，并在商店刷出一个高一阶免费单位。
 */
export function mergeInto(ctx: Ctx, idx: number, other: { atk: number; hp: number; xp: number }): void {
  const u = ctx.s.team[idx];
  if (!u) return;
  const before = u.level;
  u.atk = Math.max(u.atk, other.atk) + 1;
  u.hp = Math.max(u.hp, other.hp) + 1;
  u.xp = Math.min(MAX_XP, u.xp + other.xp + 1);
  u.level = levelForXp(u.xp);
  log(ctx, `${unitName(ctx, u.defId)} 合体（${u.xp + 1}/6）`);
  if (u.level > before) onLevelUp(ctx, u);
}

/** 直接升一级（基建/头条）：xp 补到下一级门槛，+1/+1 */
export function levelUpUnit(ctx: Ctx, u: UnitInst): boolean {
  if (u.level >= 3) return false;
  u.level = (u.level + 1) as Level;
  u.xp = Math.max(u.xp, xpForLevel(u.level));
  u.atk += 1;
  u.hp += 1;
  onLevelUp(ctx, u);
  return true;
}

function onLevelUp(ctx: Ctx, u: UnitInst): void {
  ctx.s.lastLevelUp = { uid: u.uid, level: u.level };
  if (ctx.s.tutorial) ctx.s.tutorial.merged = true;
  log(ctx, `${unitName(ctx, u.defId)} 进化到 Lv${u.level}！`);
  fireShop(ctx, 'levelUp', [u.uid], {});
  const tier = Math.min(6, maxTierForTurn(ctx.s.turn) + 1);
  const id = rollUnitDef(ctx, { tier });
  if (id) {
    addFreeUnitSlot(ctx, id, 'levelUp');
    log(ctx, `进化奖励：商店刷出免费的 ${unitName(ctx, id)}`);
  }
}

// ───────────────────────── 商店阶段技能 ─────────────────────────

interface ShopInfo { bought?: string; summoned?: string }

export function abilityMult(ab: Ability, level: number): number {
  if (ab.effect === 'multiAttack') return ab.perLevel === true ? level : 1;
  return ab.perLevel === false ? 1 : level;
}
const DEFAULT_AMOUNT: Partial<Record<Ability['effect'], number>> = { multiAttack: 2 };
export function abilityAmount(ab: Ability, level: number): number {
  return (ab.amount ?? DEFAULT_AMOUNT[ab.effect] ?? 1) * abilityMult(ab, level);
}
export function abilityBuff(ab: Ability, level: number): { atk: number; hp: number } {
  const m = abilityMult(ab, level);
  if (ab.atk !== undefined || ab.hp !== undefined) return { atk: (ab.atk ?? 0) * m, hp: (ab.hp ?? 0) * m };
  const a = (ab.amount ?? 1) * m;
  return { atk: a, hp: a };
}

/** 单位定义是否满足目标筛选 */
export function matchesFilter(def: UnitDef | undefined, f?: TargetFilter): boolean {
  if (!f) return true;
  if (!def) return false;
  if (f.faction && def.faction !== f.faction) return false;
  if (f.minTier !== undefined && def.tier < f.minTier) return false;
  if (f.maxTier !== undefined && def.tier > f.maxTier) return false;
  return true;
}

/** 随机形态：有 choices 时等概率选一个覆盖到基础技能上 */
export function resolveChoice(ab: Ability, rng: Rng): Ability {
  if (!ab.choices?.length) return ab;
  const c = rng.pick(ab.choices);
  return { ...ab, ...c, desc: c.desc ?? ab.desc, choices: undefined };
}

/** copyStats(consume) 的额外加成：amount 缺省 0 */
export function consumeBonus(ab: Ability, level: number): number {
  return (ab.amount ?? 0) * abilityMult(ab, level);
}

/** destroy 的血量阈值（未设 maxHp = 无条件） */
export function destroyThreshold(ab: Ability, level: number): number {
  if (ab.maxHp === undefined) return Infinity;
  return ab.maxHp + (level - 1) * (ab.maxHpPerLevel ?? 0);
}

/**
 * 触发商店阶段技能。subjects = 拥有该触发的单位 uid（按攻击高→低、位置前→后结算）。
 */
export function fireShop(ctx: Ctx, trigger: Trigger, subjects: string[], info: ShopInfo): void {
  const list = subjects
    .map((uid) => ctx.s.team.find((u) => u?.uid === uid))
    .filter((u): u is UnitInst => !!u && ctx.data.unitsById[u.defId]?.ability?.trigger === trigger);
  const order = list
    .map((u) => ({ u, pos: indexOfUid(ctx.s, u.uid) }))
    .sort((a, b) => b.u.atk + b.u.tempAtk - (a.u.atk + a.u.tempAtk) || a.pos - b.pos);
  for (const { u } of order) {
    if (indexOfUid(ctx.s, u.uid) < 0) continue;
    runShopAbility(ctx, u, resolveChoice(ctx.data.unitsById[u.defId].ability!, ctx.rng), info);
  }
}
/** 对全队（可排除某些 uid）触发 */
function fireTeam(ctx: Ctx, trigger: Trigger, info: ShopInfo, exclude: string[] = []): void {
  fireShop(ctx, trigger, teamUnits(ctx.s).map((u) => u.uid).filter((x) => !exclude.includes(x)), info);
}

function shopTargets(ctx: Ctx, self: UnitInst, ab: Ability, info: ShopInfo): UnitInst[] {
  const ok = (u: UnitInst) => matchesFilter(ctx.data.unitsById[u.defId], ab.filter);
  // copyStats / swapPosition 的对象不会是自己（lowestHpFriend 等也在其他友军里选）
  const noSelf = ab.effect === 'copyStats' || ab.effect === 'swapPosition';
  const res = rawShopTargets(ctx, self, ab, info, teamUnits(ctx.s).filter((u) => ok(u) && !(noSelf && u.uid === self.uid)));
  return res.filter(ok);
}

function rawShopTargets(ctx: Ctx, self: UnitInst, ab: Ability, info: ShopInfo, all: UnitInst[]): UnitInst[] {
  const s = ctx.s;
  const everyone = teamUnits(s);
  const others = all.filter((u) => u.uid !== self.uid);
  const idx = indexOfUid(s, self.uid);
  if (ENEMY_TARGETS.includes(ab.target)) return [];
  switch (ab.target) {
    case 'self':
      return [self];
    case 'frontFriend':
      return others.slice(0, 1);
    case 'backFriend':
      return others.slice(-1);
    case 'adjacentFriends': {
      const out: UnitInst[] = [];
      for (let i = idx - 1; i >= 0; i--) if (s.team[i]) { out.push(s.team[i]!); break; }
      for (let i = idx + 1; i < TEAM_SIZE; i++) if (s.team[i]) { out.push(s.team[i]!); break; }
      return out;
    }
    case 'randomFriend':
      return ctx.rng.sample(others, ab.n ?? 1);
    case 'allFriends':
      return all;
    case 'lowestHpFriend':
      return all.length ? [all.reduce((m, u) => (u.hp + u.tempHp < m.hp + m.tempHp ? u : m))] : [];
    case 'boughtUnit': {
      const u = info.bought ? everyone.find((x) => x.uid === info.bought) : undefined;
      return u ? [u] : [];
    }
    case 'summoned': {
      const u = info.summoned ? everyone.find((x) => x.uid === info.summoned) : undefined;
      return u ? [u] : [];
    }
    default:
      return [];
  }
}

function runShopAbility(ctx: Ctx, self: UnitInst, ab: Ability, info: ShopInfo): void {
  const s = ctx.s;
  const targets = shopTargets(ctx, self, ab, info);
  const amt = abilityAmount(ab, self.level);
  const name = unitName(ctx, self.defId);
  switch (ab.effect) {
    case 'buff': {
      const b = abilityBuff(ab, self.level);
      for (const t of targets) {
        if (ab.permanent) {
          t.atk += b.atk;
          t.hp += b.hp;
        } else {
          t.tempAtk += b.atk;
          t.tempHp += b.hp;
        }
        clampHp(t);
      }
      break;
    }
    case 'heal':
      for (const t of targets) t.tempHp += amt;
      break;
    case 'shield':
      for (const t of targets) t.shield += amt;
      break;
    case 'gold':
      s.gold += amt;
      break;
    case 'reroll':
      s.modifiers.freeRerolls += amt;
      break;
    case 'discount':
      s.modifiers.unitPriceMod -= amt;
      repriceShop(ctx);
      break;
    case 'copyStats': {
      const t = targets.find((x) => x.uid !== self.uid);
      if (t) {
        const bonus = ab.consume ? consumeBonus(ab, self.level) : 0;
        self.atk = Math.max(self.atk, t.atk) + bonus;
        self.hp = Math.max(self.hp, t.hp) + bonus;
        if (ab.consume) {
          s.team[indexOfUid(s, t.uid)] = null;
          log(ctx, `${name} 吞并了 ${unitName(ctx, t.defId)}`);
        }
      }
      break;
    }
    case 'summon': {
      const count = ab.count ?? 1;
      for (let i = 0; i < count; i++) {
        const at = firstEmpty(s, indexOfUid(s, self.uid));
        if (at < 0) break;
        const tok = newUnit(ctx, ab.unitId ?? 'token_shuijun');
        const m = abilityMult(ab, self.level);
        tok.atk *= m;
        tok.hp *= m;
        s.team[at] = tok;
        fireTeam(ctx, 'friendSummoned', { summoned: tok.uid }, [tok.uid]);
      }
      break;
    }
    case 'pullFront':
      // DESIGN 11.5：商店阶段触发的 pullFront 记为战斗开始时生效
      for (const t of targets) s.modifiers.battlePullFront.push(t.uid);
      break;
    case 'pushBack':
      for (const t of targets) moveUnit(s, indexOfUid(s, t.uid), TEAM_SIZE - 1);
      break;
    case 'swapPosition': {
      const t = targets.find((x) => x.uid !== self.uid);
      if (t) {
        const a = indexOfUid(s, self.uid);
        const b = indexOfUid(s, t.uid);
        [s.team[a], s.team[b]] = [s.team[b], s.team[a]];
      }
      break;
    }
    // damage / destroy / multiAttack 只在战斗中有意义
    default:
      return;
  }
  log(ctx, `${name}：${ab.desc}`);
}

// ───────────────────────── 头条 / 突发效果 ─────────────────────────

export function applyEventEffect(ctx: Ctx, e: EventEffect): void {
  const s = ctx.s;
  const m = s.modifiers;
  const units = teamUnits(s);
  switch (e.type) {
    case 'gold':
      s.gold = Math.max(0, s.gold + e.amount);
      break;
    case 'priceMod':
      if (e.target !== 'item') m.unitPriceMod += e.amount;
      if (e.target !== 'unit') m.itemPriceMod += e.amount;
      repriceShop(ctx);
      break;
    case 'freeUnit': {
      const id = rollUnitDef(ctx, { tier: e.tier, faction: e.faction }) ?? rollUnitDef(ctx, { faction: e.faction });
      if (id) addFreeUnitSlot(ctx, id, 'event');
      break;
    }
    case 'buffTeam':
    case 'buffFaction':
      for (const u of units) {
        if (e.type === 'buffFaction' && ctx.data.unitsById[u.defId]?.faction !== e.faction) continue;
        if (e.permanent) {
          u.atk += e.atk;
          u.hp += e.hp;
        } else {
          u.tempAtk += e.atk;
          u.tempHp += e.hp;
        }
        clampHp(u);
      }
      break;
    case 'shopRerollFree':
      m.rerollFree = true;
      break;
    case 'extraSlot':
      m.extraUnitSlots += e.amount;
      for (let i = 0; i < e.amount; i++) {
        const id = rollUnitDef(ctx);
        if (id) s.shop.push(mkSlot(ctx, 'unit', id));
      }
      sortShop(s);
      break;
    case 'shieldAll':
      for (const u of units) u.shield += e.amount;
      break;
    case 'swapAll':
      // DESIGN 11.5：记为战斗开始时队伍反转（两次抵消）
      m.battleSwapAll += 1;
      break;
    case 'duplicate': {
      const at = firstEmpty(s);
      if (at >= 0 && units.length) {
        const src = ctx.rng.pick(units);
        const copy = newUnit(ctx, src.defId);
        Object.assign(copy, { atk: src.atk, hp: src.hp, level: src.level, xp: src.xp });
        s.team[at] = copy;
        fireTeam(ctx, 'friendSummoned', { summoned: copy.uid }, [copy.uid]);
      }
      break;
    }
    case 'sacrifice': {
      if (!units.length) break;
      const tierOf = (u: UnitInst) => ctx.data.unitsById[u.defId]?.tier ?? 1;
      const victim = units.reduce((a, b) => (tierOf(b) < tierOf(a) || (tierOf(b) === tierOf(a) && b.level < a.level) ? b : a));
      s.team[indexOfUid(s, victim.uid)] = null;
      s.gold += e.amount;
      log(ctx, `${unitName(ctx, victim.defId)} 被牺牲了`);
      break;
    }
    case 'nextTurnGold':
      m.nextTurnGold += e.amount;
      break;
    case 'enemyDebuff':
      m.enemyAtkDebuff += e.amount;
      break;
    case 'rerollShop':
      rollShop(ctx);
      break;
    case 'levelUpRandom': {
      const cands = units.filter((u) => u.level < 3);
      if (cands.length) levelUpUnit(ctx, ctx.rng.pick(cands));
      break;
    }
    case 'lifeTrade':
      if (s.lives > 1) {
        s.lives -= 1;
        s.gold += e.amount;
        m.freeRerolls += 1;
      } else {
        log(ctx, '信心只剩 1 颗，交易取消');
      }
      break;
  }
}

// ───────────────────────── 回合推进 ─────────────────────────

/** 进入某回合：重置算力与修正器 → 生成商店 →（待生效突发）→（头条 or 商店） */
export function beginTurn(ctx: Ctx, turn: number): void {
  const s = ctx.s;
  const m = s.modifiers;
  s.turn = turn;
  s.gold = BASE_GOLD + m.nextTurnGold;
  s.modifiers = { ...emptyModifiers(), freeRerolls: m.nextFreeRerolls, unitPriceMod: m.nextUnitPriceMod };
  s.shop = s.shop.filter((x) => x.frozen);
  s.pendingHeadline = undefined;
  s.lastLevelUp = undefined;
  rollShop(ctx, true);
  if (!ctx.sim) log(ctx, `—— 第 ${turn} 回合 ——`);
  if (s.surprisePending && s.lastSurprise) {
    for (const e of s.lastSurprise.effects ?? [s.lastSurprise.effect]) applyEventEffect(ctx, e);
    log(ctx, `突发生效：${s.lastSurprise.title}`);
    s.surprisePending = false;
  }
  const headline = ctx.sim ? undefined : pickHeadline(ctx);
  if (headline) {
    s.pendingHeadline = headline;
    s.phase = 'headline';
  } else {
    openShop(ctx);
  }
}

function pickHeadline(ctx: Ctx): HeadlineDef | undefined {
  const s = ctx.s;
  const list = ctx.data.headlines;
  if (!list.length || !isHeadlineTurn(s.turn, s, ctx.data)) return undefined;
  if (s.tutorial && ctx.data.tutorial && s.turn === (ctx.data.tutorial.headlineTurn ?? 3)) {
    return list.find((h) => h.id === ctx.data.tutorial!.headline) ?? list[0];
  }
  let pool = list.filter((h) => !s.seenHeadlines.includes(h.id));
  if (!pool.length) pool = list;
  const h = ctx.rng.pick(pool);
  s.seenHeadlines.push(h.id);
  return h;
}

export function openShop(ctx: Ctx): void {
  ctx.s.phase = 'shop';
  fireTeam(ctx, 'startTurn', {});
}

/** 战斗结束后的清理：临时加成、护盾、本回合修正 */
export function clearBattleTemps(s: RunState): void {
  for (const u of teamUnits(s)) {
    u.tempAtk = 0;
    u.tempHp = 0;
    u.shield = 0;
  }
}

// ───────────────────────── 对外 API ─────────────────────────

export interface NewRunOpts { tutorial?: boolean }

export function newRun(seed: string, data: GameData, opts: NewRunOpts = {}): RunState {
  const tut = !!opts.tutorial && !!data.tutorial;
  const realSeed = tut ? data.tutorial!.seed || seed : seed;
  const s: RunState = {
    seed: realSeed,
    turn: 1,
    gold: BASE_GOLD,
    lives: START_LIVES,
    trophies: 0,
    team: Array(TEAM_SIZE).fill(null),
    shop: [],
    phase: 'shop',
    modifiers: emptyModifiers(),
    history: [],
    log: [],
    rng: new Rng(`${realSeed}:run`).state,
    nextUid: 1,
    seenHeadlines: [],
    seenSurprises: [],
  };
  if (tut) s.tutorial = { buys: 0, battles: 0, merged: false, usedItem: false, froze: false, sold: false, headline: false };
  const ctx = makeCtx(s, data);
  beginTurn(ctx, 1);
  return commit(ctx);
}

function fail(state: RunState, msg: string): RunState {
  return { ...state, error: msg };
}

/** 商店阶段的所有操作。非法操作返回原状态（浅拷贝）并带 error 文案，不抛异常。 */
export function shopAction(state: RunState, action: ShopActionInput, data: GameData): RunState {
  const s = clone(state);
  delete s.error;
  const ctx = makeCtx(s, data);
  const err = applyAction(ctx, action);
  if (err) return fail(state, err);
  return commit(ctx);
}

/** 内部：就地执行动作，返回错误文案或 null（机器人复用） */
export function applyAction(ctx: Ctx, a: ShopActionInput): string | null {
  const s = ctx.s;
  const data = ctx.data;
  const needShop = (): string | null => (s.phase === 'shop' ? null : '现在不是商店阶段');
  switch (a.type) {
    case 'buy': {
      const e = needShop();
      if (e) return e;
      const slot = s.shop[a.slot];
      if (!slot || slot.kind !== 'unit') return '没有这个单位';
      if (slot.price > s.gold) return `算力不够，需要 ${slot.price} 算力`;
      let to = a.to ?? -1;
      let merge = false;
      if (a.to !== undefined) {
        if (to < 0 || to >= TEAM_SIZE) return '位置不对';
        const cur = s.team[to];
        if (cur) {
          if (cur.defId !== slot.defId) return '那里已经有单位了';
          if (cur.level >= 3) return '已经满级了';
          merge = true;
        }
      } else {
        to = s.team.findIndex((u) => !!u && u.defId === slot.defId && u.level < 3);
        if (to >= 0) merge = true;
        else to = firstEmpty(s);
        if (to < 0) return '队伍满了，先卖掉一个吧';
      }
      s.gold -= slot.price;
      s.shop.splice(a.slot, 1);
      const def = data.unitsById[slot.defId];
      let uid: string;
      if (merge) {
        uid = s.team[to]!.uid;
        log(ctx, `买下 ${def?.name ?? slot.defId}`);
        mergeInto(ctx, to, { atk: def?.atk ?? 1, hp: def?.hp ?? 1, xp: 0 });
      } else {
        const u = newUnit(ctx, slot.defId);
        s.team[to] = u;
        uid = u.uid;
        log(ctx, `买下 ${def?.name ?? slot.defId}`);
      }
      if (s.tutorial) s.tutorial.buys++;
      fireShop(ctx, 'buy', [uid], { bought: uid });
      fireTeam(ctx, 'friendBought', { bought: uid }, [uid]);
      return null;
    }
    case 'sell': {
      const e = needShop();
      if (e) return e;
      const u = s.team[a.index];
      if (!u) return '这里没有单位';
      fireShop(ctx, 'sell', [u.uid], {});
      const at = indexOfUid(s, u.uid);
      if (at >= 0) s.team[at] = null;
      s.gold += u.level;
      if (s.tutorial) s.tutorial.sold = true;
      log(ctx, `卖掉 ${unitName(ctx, u.defId)}，+${u.level} 算力`);
      return null;
    }
    case 'reroll': {
      const e = needShop();
      if (e) return e;
      const m = s.modifiers;
      if (m.rerollFree) {
        /* 免费 */
      } else if (m.freeRerolls > 0) m.freeRerolls--;
      else if (s.gold >= REROLL_PRICE) s.gold -= REROLL_PRICE;
      else return '算力不够刷新';
      rollShop(ctx);
      return null;
    }
    case 'freeze': {
      const e = needShop();
      if (e) return e;
      const slot = s.shop[a.slot];
      if (!slot) return '没有这个槽位';
      slot.frozen = !slot.frozen;
      if (slot.frozen && s.tutorial) s.tutorial.froze = true;
      return null;
    }
    case 'swap': {
      const e = needShop();
      if (e) return e;
      if (a.a < 0 || a.a >= TEAM_SIZE || a.b < 0 || a.b >= TEAM_SIZE) return '位置不对';
      [s.team[a.a], s.team[a.b]] = [s.team[a.b], s.team[a.a]];
      return null;
    }
    case 'merge': {
      const e = needShop();
      if (e) return e;
      const from = s.team[a.from];
      const to = s.team[a.to];
      if (!from || !to || a.from === a.to) return '需要两个单位';
      if (!canMerge(from, to)) return from.defId !== to.defId ? '只有同名单位可以合体' : '已经满级了';
      s.team[a.from] = null;
      mergeInto(ctx, a.to, { atk: from.atk, hp: from.hp, xp: from.xp });
      const t = s.team[a.to]!;
      t.tempAtk += from.tempAtk;
      t.tempHp += from.tempHp;
      t.shield += from.shield;
      return null;
    }
    case 'useItem':
      return useItem(ctx, a.slot, a.target, a.source);
    case 'chooseHeadline': {
      if (s.phase !== 'headline' || !s.pendingHeadline) return '现在没有头条';
      const opt = s.pendingHeadline.options[a.option];
      if (!opt) return '没有这个选项';
      log(ctx, `头条「${s.pendingHeadline.title}」：${opt.label}`);
      for (const e of opt.effects ?? [opt.effect]) applyEventEffect(ctx, e);
      s.pendingHeadline = undefined;
      if (s.tutorial) s.tutorial.headline = true;
      openShop(ctx);
      return null;
    }
    case 'endShop': {
      const e = needShop();
      if (e) return e;
      fireTeam(ctx, 'endTurn', {});
      s.phase = 'battle';
      return null;
    }
    case 'continue': {
      if (s.phase !== 'result') return '还没结算';
      beginTurn(ctx, s.turn + 1);
      return null;
    }
    default:
      return '未知操作';
  }
}

function useItem(ctx: Ctx, slotIdx: number, target?: number, source?: number): string | null {
  const s = ctx.s;
  if (s.phase !== 'shop') return '现在不是商店阶段';
  const slot = s.shop[slotIdx];
  if (!slot || slot.kind !== 'item') return '没有这个基建';
  const item = ctx.data.itemsById[slot.defId];
  if (!item) return '未知基建';
  if (slot.price > s.gold) return `算力不够，需要 ${slot.price} 算力`;
  const tu = target !== undefined ? s.team[target] : null;
  if (item.targetKind === 'unit' && !tu) return '请选择一个单位';
  const ef = item.effect;
  // 先校验，后扣钱
  switch (ef.type) {
    case 'levelUp':
      if (tu!.level >= 3) return '已经满级了';
      break;
    case 'copyStatsFrom': {
      const src = source !== undefined ? s.team[source] : null;
      if (!src || src === tu) return '请再选一个被复制的单位';
      break;
    }
    case 'summonToken':
      if (firstEmpty(s) < 0) return '队伍满了';
      if (!ctx.data.unitsById[ef.unitId]) return '未知召唤物';
      break;
    case 'transformRandomSameTier': {
      const def = ctx.data.unitsById[tu!.defId];
      if (!(ctx.data.shopUnitsByTier[def?.tier ?? 1] ?? []).some((u) => u.id !== tu!.defId)) return '没有可以变的单位';
      break;
    }
    default:
      break;
  }
  s.gold -= slot.price;
  s.shop.splice(slotIdx, 1);
  log(ctx, `使用 ${item.name}${tu ? ` → ${unitName(ctx, tu.defId)}` : ''}`);
  const all = teamUnits(s);
  switch (ef.type) {
    case 'buff':
      if (ef.permanent) {
        tu!.atk += ef.atk;
        tu!.hp += ef.hp;
      } else {
        tu!.tempAtk += ef.atk;
        tu!.tempHp += ef.hp;
      }
      clampHp(tu!);
      break;
    case 'teamBuff':
      for (const u of all) {
        if (ef.permanent) {
          u.atk += ef.atk;
          u.hp += ef.hp;
        } else {
          u.tempAtk += ef.atk;
          u.tempHp += ef.hp;
        }
        clampHp(u);
      }
      break;
    case 'shield':
      tu!.shield += ef.amount;
      break;
    case 'copyStatsFrom': {
      const src = s.team[source!]!;
      tu!.atk = Math.max(tu!.atk, src.atk);
      tu!.hp = Math.max(tu!.hp, src.hp);
      break;
    }
    case 'levelUp':
      levelUpUnit(ctx, tu!);
      break;
    case 'gold':
      s.gold += ef.amount;
      break;
    case 'summonToken': {
      const at = firstEmpty(s);
      const tok = newUnit(ctx, ef.unitId);
      s.team[at] = tok;
      fireTeam(ctx, 'friendSummoned', { summoned: tok.uid }, [tok.uid]);
      break;
    }
    case 'pullFront':
      s.modifiers.battlePullFront.push(tu!.uid);
      break;
    case 'transformRandomSameTier': {
      const old = ctx.data.unitsById[tu!.defId];
      const id = rollUnitDef(ctx, { tier: old?.tier ?? 1, exclude: tu!.defId })!;
      const nd = ctx.data.unitsById[id];
      tu!.atk = Math.max(0, nd.atk + (tu!.atk - (old?.atk ?? 0)));
      tu!.hp = Math.max(1, nd.hp + (tu!.hp - (old?.hp ?? 0)));
      tu!.defId = id;
      log(ctx, `变成了 ${nd.name}`);
      break;
    }
  }
  if (s.tutorial) s.tutorial.usedItem = true;
  if (item.targetKind === 'unit' && tu && indexOfUid(s, tu.uid) >= 0) fireShop(ctx, 'eatItem', [tu.uid], {});
  else if (item.targetKind === 'team') fireTeam(ctx, 'eatItem', {});
  return null;
}

/** 当前回合商店单位数量上限（含头条 extraSlot） */
export function currentUnitSlots(s: RunState): number {
  return unitSlotsForTurn(s.turn) + s.modifiers.extraUnitSlots;
}
/** 当前刷新价格（0 = 免费） */
export function rerollCost(s: RunState): number {
  return s.modifiers.rerollFree || s.modifiers.freeRerolls > 0 ? 0 : REROLL_PRICE;
}
