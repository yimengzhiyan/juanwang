// 商店阶段核心（就地修改 ctx.s 的 mutate* 函数 + applyAction）。对外的纯函数入口 newRun / shopAction 在 run.ts。
// 机器人直接复用 applyAction（ctx.sim = true：不出头条/突发、不写日志）。
import { Rng } from '../rng';
import {
  ENEMY_TARGETS, EQUIP_SLOTS, type InvEquip,
  type Ability, type ArenaRules, type BattleEvent, type EventEffect, type FreeReason, type GameData, type HeadlineDef, type Level, type Modifiers,
  type RunState, type ShopActionInput, type ShopSlot, type ShopSlotKind, type TargetFilter, type Tier, type Trigger, type UnitDef, type UnitInst,
} from '../types';
import { SYNERGY_TUNING, stateBonus, teamTiers, type TierMap } from './synergy';
import { INVENTORY_SIZE, attachEquip, attachOutcome, canAttach, equipInstRefund, equipRefund, equipMultFor, equipTotals, mergeEquips } from './equip';
import { DIFFICULTY } from './difficulty';

// ───────────────────────── 常量 ─────────────────────────
export const TEAM_SIZE = 5;
export const START_HP = 20;
export const MAX_TURNS = 20;
export const BASE_GOLD = 10;
/** 起始算力曲线：前期少给，减少"全买了"的无脑感；回合 1~2：7，3~4：8，5~6：9，7+：10 */
export function baseGoldForTurn(turn: number): number {
  if (turn <= 2) return 7;
  if (turn <= 4) return 8;
  if (turn <= 6) return 9;
  return BASE_GOLD;
}
export const UNIT_PRICE = 3;
export const REROLL_PRICE = 1;
export const MAX_XP = 5;
export const LOG_LIMIT = 200;
export const SHOP_UNIT_SLOTS = 4;
export const SHOP_EQUIP_SLOTS = 2;
export const SHOP_CONSUMABLE_SLOTS = 1;
export const UPGRADE_PRICE = 4;
export const MAX_SHOP_LEVEL = 2;

/** 按回合解锁的最高阶：T1 回合1，T2 回合3，T3 回合5，T4 回合7，T5 回合9，T6 回合11 */
export function maxTierForTurn(turn: number): Tier {
  return Math.min(6, 1 + Math.floor((Math.max(1, turn) - 1) / 2)) as Tier;
}
/** 商店当前最高阶 = max(按回合, 升级商店提前解锁的阶) */
export function shopMaxTier(s: Pick<RunState, 'turn' | 'shopTier'>): Tier {
  return Math.min(6, Math.max(maxTierForTurn(s.turn), s.shopTier ?? 0)) as Tier;
}
/** 商店阶级权重（DESIGN 17 / 20）：当前最高阶 5、次高阶 2、其余 1（下标 i = 阶 i+1） */
export function tierWeights(maxTier: number): number[] {
  if (SHOP_ROLL.legacyTierWeights) return Array.from({ length: maxTier }, (_, i) => i + 1);
  return Array.from({ length: maxTier }, (_, i) => (i === maxTier - 1 ? SHOP_ROLL.topWeight : i === maxTier - 2 ? 2 : 1));
}
/** 最高阶 ≥ 这个值时，每次刷新保证至少 1 个最高阶单位（DESIGN 20） */
export const GUARANTEE_TOP_FROM_TIER = 3;
/** 已在队伍中的单位（同 defId）在商店里的权重倍数（DESIGN 17；仓库无关） */
export const OWNED_UNIT_WEIGHT = 2.5;
/** 最高阶的权重（DESIGN 20：5） */
export const TOP_TIER_WEIGHT = 5;
/**
 * 商店抽卡参数（模拟脚本对比用）：2.0 口径 {ownedWeight:1, legacyTierWeights:true, guaranteeTop:false, upgradeRerollAll:false}；
 * 2.1 初版 {topWeight:3, guaranteeTop:false, upgradeRerollAll:false}
 */
export const SHOP_ROLL = { ownedWeight: OWNED_UNIT_WEIGHT, legacyTierWeights: false, topWeight: TOP_TIER_WEIGHT, guaranteeTop: true, upgradeRerollAll: true };
/**
 * 商店刷单位的逐单位权重：阶的总权重按 tierWeights 平均分给该阶的单位，已在队伍中的 defId 再 × OWNED_UNIT_WEIGHT。
 * 返回 [{id, weight}]（客户端可据此显示"出现概率"；概率 = weight / 总和）。
 */
export function unitRollWeights(
  data: GameData, maxTier: number, owned: Iterable<string> = [], filt: (u: UnitDef) => boolean = () => true,
): { id: string; weight: number }[] {
  const own = new Set(owned);
  const out: { id: string; weight: number }[] = [];
  tierWeights(maxTier).forEach((w, i) => {
    const pool = (data.shopUnitsByTier[i + 1] ?? []).filter(filt);
    for (const u of pool) out.push({ id: u.id, weight: (w / pool.length) * (own.has(u.id) ? SHOP_ROLL.ownedWeight : 1) });
  });
  return out;
}
/** xp → 等级（Lv2 需 3 份 = xp2，Lv3 需 6 份 = xp5） */
export function levelForXp(xp: number): Level {
  return xp >= 5 ? 3 : xp >= 2 ? 2 : 1;
}
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
    unitPriceMod: 0, itemPriceMod: 0, extraUnitSlots: 0, rerollFree: false, freeRerolls: 0, rerollsThisTurn: 0, enemyAtkDebuff: 0,
    nextTurnGold: 0, nextFreeRerolls: 0, nextUnitPriceMod: 0, battleSwapAll: 0, battlePullFront: [], battle: {},
  };
}

// ───────────────────────── 上下文 ─────────────────────────

export interface Ctx {
  s: RunState;
  data: GameData;
  rng: Rng;
  /** 机器人模拟时为 true：不出头条/突发，不写日志 */
  sim?: boolean;
}

/** 仓库（旧存档缺 inventory 时补 []） */
export function inventoryOf(s: RunState): InvEquip[] {
  return (s.inventory ??= []);
}
export const INVENTORY_FULL = `仓库已满（最多 ${INVENTORY_SIZE} 件），先卖掉或装上一件吧`;
export const INVENTORY_FULL_REPLACE = '仓库已满，换下的旧装备放不下：先卖掉仓库里的装备，或先把旧装备卸下/装到别人身上';

export function makeCtx(s: RunState, data: GameData, sim = false): Ctx {
  return { s, data, rng: Rng.fromState(s.rng), sim };
}
export function commit(ctx: Ctx): RunState {
  ctx.s.rng = ctx.rng.state;
  return ctx.s;
}
export function log(ctx: Ctx, msg: string): void {
  if (ctx.sim) return;
  ctx.s.log.push(msg);
  if (ctx.s.log.length > LOG_LIMIT) ctx.s.log.splice(0, ctx.s.log.length - LOG_LIMIT);
}
export function emitEvent(ctx: Ctx, e: BattleEvent): void {
  if (ctx.sim) return;
  (ctx.s.lastEvents ??= []).push(e);
}
export const unitName = (data: GameData, defId: string): string => data.unitsById[defId]?.name ?? defId;

export function arenaRules(s: Pick<RunState, 'arena'>, data: GameData): ArenaRules {
  return (s.arena && data.arenasById[s.arena]?.rules) || {};
}

export function newUnit(ctx: Ctx, defId: string): UnitInst {
  const def = ctx.data.unitsById[defId];
  return { uid: `u${ctx.s.nextUid++}`, defId, atk: def?.atk ?? 1, hp: def?.hp ?? 1, level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0, equips: {} };
}

export function tiersOf(ctx: Ctx): TierMap {
  return teamTiers(ctx.s.team, ctx.data, stateBonus(ctx.s, ctx.data));
}
const defOf = (ctx: Ctx, u: UnitInst): UnitDef | undefined => ctx.data.unitsById[u.defId];

// ───────────────────────── 随机抽取 ─────────────────────────

export interface UnitRollOpts { maxTier?: number; tier?: number; faction?: string; exclude?: string }

/** 按阶权重抽一个商店单位 defId（tier 指定时只在该阶抽；对应池子为空时向低阶回退） */
export function rollUnitDef(ctx: Ctx, opts: UnitRollOpts = {}): string | null {
  const byTier = ctx.data.shopUnitsByTier;
  const filt = (list: UnitDef[]): UnitDef[] => list.filter((u) => (!opts.faction || u.faction === opts.faction) && u.id !== opts.exclude);
  if (opts.tier) {
    for (let t = opts.tier; t >= 1; t--) {
      const pool = filt(byTier[t] ?? []);
      if (pool.length) return ctx.rng.pick(pool).id;
    }
    return null;
  }
  const maxTier = opts.maxTier ?? shopMaxTier(ctx.s);
  const owned = teamUnits(ctx.s).map((u) => u.defId);
  const list = unitRollWeights(ctx.data, maxTier, owned, (u) => filt([u]).length > 0);
  if (!list.length) {
    const any = filt(ctx.data.units.filter((u) => !u.token));
    return any.length ? ctx.rng.pick(any).id : null;
  }
  return list[ctx.rng.weighted(list.map((x) => x.weight))].id;
}

export function rollEquipDef(ctx: Ctx): string | null {
  const l = ctx.data.equips;
  return l.length ? ctx.rng.pick(l).id : null;
}
export function rollConsumableDef(ctx: Ctx): string | null {
  const l = ctx.data.consumables;
  return l.length ? ctx.rng.pick(l).id : null;
}

// ───────────────────────── 商店 ─────────────────────────

/** 单位实际价格（含头条修正、赛场、经济 ×4），最低 1 */
export function unitPrice(ctx: Ctx, defId: string, tiers?: TierMap): number {
  const m = ctx.s.modifiers;
  const a = arenaRules(ctx.s, ctx.data);
  const def = ctx.data.unitsById[defId];
  let p = UNIT_PRICE + m.unitPriceMod + (a.unitPriceMod ?? 0);
  if (def && a.factionPriceMod && def.faction === a.factionPriceMod.faction) p += a.factionPriceMod.amount;
  if (def && a.rolePriceMod && def.role === a.rolePriceMod.role) p += a.rolePriceMod.amount;
  if (((tiers ?? tiersOf(ctx)).economy ?? 0) >= 2) p -= 1;
  return Math.max(1, p);
}

export function slotPrice(ctx: Ctx, slot: Pick<ShopSlot, 'kind' | 'defId' | 'free'>, tiers?: TierMap): number {
  if (slot.free) return 0;
  const m = ctx.s.modifiers;
  if (slot.kind === 'unit') return unitPrice(ctx, slot.defId, tiers);
  if (slot.kind === 'equip') {
    const base = ctx.data.equipsById[slot.defId]?.price ?? 3;
    const a = arenaRules(ctx.s, ctx.data);
    return Math.max(Math.min(1, base), base + m.itemPriceMod + (a.equipPriceMod ?? 0));
  }
  const base = ctx.data.consumablesById[slot.defId]?.price ?? 1;
  return Math.max(Math.min(1, base), base + m.itemPriceMod);
}
export function repriceShop(ctx: Ctx): void {
  const tiers = tiersOf(ctx);
  for (const sl of ctx.s.shop) sl.price = slotPrice(ctx, sl, tiers);
}
export function mkSlot(ctx: Ctx, kind: ShopSlotKind, defId: string, freeReason?: FreeReason, gold?: boolean): ShopSlot {
  const sl: ShopSlot = { kind, defId, price: 0, frozen: false };
  if (freeReason) {
    sl.free = true;
    sl.freeReason = freeReason;
  }
  if (gold) sl.gold = true;
  sl.price = slotPrice(ctx, sl);
  return sl;
}
const KIND_ORDER: Record<ShopSlotKind, number> = { unit: 0, equip: 1, consumable: 2 };
export function sortShop(s: RunState): void {
  // 单位 → 装备 → 消耗品；同类内保持原有顺序（稳定排序）
  s.shop = s.shop.map((x, i) => ({ x, i })).sort((a, b) => KIND_ORDER[a.x.kind] - KIND_ORDER[b.x.kind] || a.i - b.i).map((v) => v.x);
}

/** 本回合商店各类格数（含赛场 / 头条修正） */
export function shopSlotCounts(s: Pick<RunState, 'arena' | 'modifiers'>, data: GameData): { units: number; equips: number; consumables: number } {
  const a = arenaRules(s, data);
  return {
    units: Math.max(1, SHOP_UNIT_SLOTS + (a.unitSlotsMod ?? 0) + s.modifiers.extraUnitSlots),
    equips: Math.max(0, SHOP_EQUIP_SLOTS + (a.equipSlotsMod ?? 0)),
    consumables: SHOP_CONSUMABLE_SLOTS,
  };
}

/**
 * 刷新商店：保留冻结槽与（同回合内的）免费槽，其余重抽到满额。
 * initial=true 表示回合开始的那次（引导局固定商店只在这次生效）。only='unit' 只重抽单位（升级商店用）。
 */
export function rollShop(ctx: Ctx, initial = false, only?: ShopSlotKind): void {
  const s = ctx.s;
  const keep = s.shop.filter((x) => x.frozen || (!initial && x.free) || (only && x.kind !== only));
  const fixed = initial ? tutorialTurn(ctx) : undefined;
  const kept = (k: ShopSlotKind) => keep.filter((x) => x.kind === k && !x.free).length;
  const fresh: ShopSlot[] = [];
  if (fixed) {
    for (const id of fixed.units) if (ctx.data.unitsById[id]) fresh.push(mkSlot(ctx, 'unit', id));
    for (const id of fixed.items ?? []) {
      if (ctx.data.equipsById[id]) fresh.push(mkSlot(ctx, 'equip', id));
      else if (ctx.data.consumablesById[id]) fresh.push(mkSlot(ctx, 'consumable', id));
    }
  } else {
    const c = shopSlotCounts(s, ctx.data);
    const want: [ShopSlotKind, number, () => string | null][] = [
      ['unit', c.units, () => rollUnitDef(ctx)],
      ['equip', c.equips, () => rollEquipDef(ctx)],
      ['consumable', c.consumables, () => rollConsumableDef(ctx)],
    ];
    for (const [kind, n, roll] of want) {
      if (only && kind !== only) continue;
      for (let i = kept(kind); i < n; i++) {
        const id = roll();
        if (id) fresh.push(mkSlot(ctx, kind, id));
      }
    }
    ensureTopTier(ctx, keep, fresh);
  }
  s.shop = [...keep, ...fresh];
  sortShop(s);
  repriceShop(ctx);
}

/**
 * 保底（DESIGN 20）：最高阶 ≥ T3 时，刷新后商店里至少有 1 个最高阶单位（含保留下来的冻结/免费槽）；
 * 没有的话把一个新刷出的单位格换成随机最高阶单位。
 */
function ensureTopTier(ctx: Ctx, keep: ShopSlot[], fresh: ShopSlot[]): void {
  if (!SHOP_ROLL.guaranteeTop) return;
  const top = shopMaxTier(ctx.s);
  if (top < GUARANTEE_TOP_FROM_TIER || !(ctx.data.shopUnitsByTier[top] ?? []).length) return;
  const tierOf = (sl: ShopSlot) => ctx.data.unitsById[sl.defId]?.tier ?? 0;
  if ([...keep, ...fresh].some((sl) => sl.kind === 'unit' && tierOf(sl) === top)) return;
  const idx = fresh.map((sl, i) => (sl.kind === 'unit' && !sl.free ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return;
  const at = ctx.rng.pick(idx);
  const id = rollUnitDef(ctx, { tier: top });
  if (id) fresh[at] = mkSlot(ctx, 'unit', id);
}

function tutorialTurn(ctx: Ctx) {
  if (!ctx.s.tutorial || !ctx.data.tutorial) return undefined;
  return ctx.data.tutorial.turns.find((t) => t.turn === ctx.s.turn);
}

/** 往商店追加一个免费单位槽（进化奖励 / 头条突发 freeUnit / PVE 奖励） */
export function addFreeUnitSlot(ctx: Ctx, defId: string, reason: FreeReason): void {
  ctx.s.shop.push(mkSlot(ctx, 'unit', defId, reason));
  sortShop(ctx.s);
}

// ───────────────────────── 队伍工具 ─────────────────────────

export function teamUnits(s: Pick<RunState, 'team'>): UnitInst[] {
  return s.team.filter((u): u is UnitInst => !!u);
}
export function indexOfUid(s: RunState, uid: string): number {
  return s.team.findIndex((u) => u?.uid === uid);
}
export function firstEmpty(s: RunState, near = -1): number {
  if (near >= 0) {
    for (let i = near + 1; i < TEAM_SIZE; i++) if (!s.team[i]) return i;
    for (let i = near - 1; i >= 0; i--) if (!s.team[i]) return i;
    return -1;
  }
  return s.team.findIndex((u) => !u);
}
function moveUnit(s: RunState, from: number, to: number): void {
  const u = s.team[from];
  if (!u) return;
  const rest = s.team.filter((x, i) => x && i !== from) as UnitInst[];
  rest.splice(Math.min(to, rest.length), 0, u);
  s.team = [...rest, ...Array(TEAM_SIZE - rest.length).fill(null)];
}
export function clampHp(u: UnitInst): void {
  if (u.hp < 1) u.hp = 1;
  if (u.atk < 0) u.atk = 0;
  if (u.hp + u.tempHp < 1) u.tempHp = 1 - u.hp;
  if (u.atk + u.tempAtk < 0) u.tempAtk = -u.atk;
}
function permBuff(u: UnitInst, atk: number, hp: number): void {
  u.atk += atk;
  u.hp += hp;
  clampHp(u);
}
/**
 * 永久加成（技能 / 羁绊 / 装备 / 赛场 / 头条 / 消耗品）：成长 ×2 时成长单位每次额外 +1/+1（DESIGN 16）。
 * 合体、进化、召唤物出生属性不算"加成"，不走这里。
 */
export function permGrow(ctx: Ctx, u: UnitInst, atk: number, hp: number, tiers?: TierMap, noSpread = false): void {
  permBuff(u, atk, hp);
  if (!(atk > 0 || hp > 0) || defOf(ctx, u)?.role !== 'growth') return;
  const gt = (tiers ?? tiersOf(ctx)).growth ?? 0;
  if (gt >= 1) permBuff(u, 1, 1);
  // 成长 ×4：相邻友军获得同样的加成（互相成长，不再继续传递）
  if (gt >= 2 && !noSpread) for (const n of adjacentUnits(ctx.s, u)) permGrow(ctx, n, atk, hp, tiers, true);
}
/** 队伍里左右最近的单位（跳过空位） */
export function adjacentUnits(s: Pick<RunState, 'team'>, u: UnitInst): UnitInst[] {
  const idx = s.team.findIndex((x) => x?.uid === u.uid);
  if (idx < 0) return [];
  const out: UnitInst[] = [];
  for (let i = idx - 1; i >= 0; i--) if (s.team[i]) { out.push(s.team[i]!); break; }
  for (let i = idx + 1; i < s.team.length; i++) if (s.team[i]) { out.push(s.team[i]!); break; }
  return out;
}
/** 扣算力（买 / 刷新 / 装备 / 消耗品 / 升级商店）；经济 ×4 时累计花费进度 */
export function spendGold(ctx: Ctx, n: number): void {
  const s = ctx.s;
  s.gold -= n;
  if (n <= 0) return;
  const tiers = tiersOf(ctx);
  if ((tiers.economy ?? 0) < 2) return;
  s.economySpent = (s.economySpent ?? 0) + n;
  while (s.economySpent >= SYNERGY_TUNING.economyStep) {
    s.economySpent -= SYNERGY_TUNING.economyStep;
    const eco = teamUnits(s).filter((u) => defOf(ctx, u)?.role === 'economy');
    if (!eco.length) continue;
    const u = ctx.rng.pick(eco);
    permGrow(ctx, u, 1, 1, tiers);
    log(ctx, `经济 ×4：${unitName(ctx.data, u.defId)} 永久 +1/+1`);
  }
}
export function canMerge(a: UnitInst, b: UnitInst): boolean {
  return a.defId === b.defId && a.level < 3 && b.level < 3;
}

// ───────────────────────── 进化 ─────────────────────────

/** 给 idx 的单位合并进一份（xp = other.xp + 1），属性 = 两者最高值 +1/+1。升级时触发进化相关效果。 */
export function mergeInto(ctx: Ctx, idx: number, other: { atk: number; hp: number; xp: number }): void {
  const u = ctx.s.team[idx];
  if (!u) return;
  const before = u.level;
  u.atk = Math.max(u.atk, other.atk) + 1;
  u.hp = Math.max(u.hp, other.hp) + 1;
  u.xp = Math.min(MAX_XP, u.xp + other.xp + 1);
  u.level = levelForXp(u.xp);
  log(ctx, `${unitName(ctx.data, u.defId)} 合体（${u.xp + 1}/6）`);
  if (u.level > before) onLevelUp(ctx, u);
}

/** 直接升一级（消耗品/头条）：xp 补到下一级门槛，+1/+1 */
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
  const s = ctx.s;
  s.lastLevelUp = { uid: u.uid, level: u.level };
  if (s.tutorial) s.tutorial.merged = true;
  if (u.level === 3 && s.stats) s.stats.lv3++;
  log(ctx, `${unitName(ctx.data, u.defId)} 进化到 Lv${u.level}！`);
  fireShop(ctx, 'levelUp', [u.uid], {});
  const tier = Math.min(6, shopMaxTier(s) + 1);
  const id = rollUnitDef(ctx, { tier });
  if (id) {
    addFreeUnitSlot(ctx, id, 'levelUp');
    log(ctx, `进化奖励：商店刷出免费的 ${unitName(ctx.data, id)}`);
  }
}

// ───────────────────────── 技能数值工具 ─────────────────────────

interface ShopInfo { bought?: string; summoned?: string }

/** 缺省不随等级缩放的效果 */
const NO_LEVEL_DEFAULT: ReadonlySet<Ability['effect']> = new Set(['multiAttack', 'revive', 'chain', 'explode', 'steal', 'doubleStats']);
export function abilityMult(ab: Ability, level: number): number {
  if (NO_LEVEL_DEFAULT.has(ab.effect)) return ab.perLevel === true ? level : 1;
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
export function matchesFilter(def: UnitDef | undefined, f?: TargetFilter): boolean {
  if (!f) return true;
  if (!def) return false;
  if (f.faction && def.faction !== f.faction) return false;
  if (f.role && def.role !== f.role) return false;
  if (f.minTier !== undefined && def.tier < f.minTier) return false;
  if (f.maxTier !== undefined && def.tier > f.maxTier) return false;
  return true;
}
export function resolveChoice(ab: Ability, rng: Rng): Ability {
  if (!ab.choices?.length) return ab;
  const c = rng.pick(ab.choices);
  return { ...ab, ...c, desc: c.desc ?? ab.desc, choices: undefined };
}
export function consumeBonus(ab: Ability, level: number): number {
  return (ab.amount ?? 0) * abilityMult(ab, level);
}
export function destroyThreshold(ab: Ability, level: number): number {
  if (ab.maxHp === undefined) return Infinity;
  return ab.maxHp + (level - 1) * (ab.maxHpPerLevel ?? 0);
}

/** 技能触发次数：1 + 微调（含算力 ×3 翻倍） */
export function abilityRepeats(def: UnitDef | undefined, u: Pick<UnitInst, 'equips'>, tiers: TierMap, data: GameData): number {
  let n = 1;
  n += equipTotals(u, data, equipMultFor(def, tiers)).abilityRepeat ?? 0;
  return Math.max(1, Math.min(5, Math.round(n)));
}

// ───────────────────────── 商店阶段技能 ─────────────────────────

export function fireShop(ctx: Ctx, trigger: Trigger, subjects: string[], info: ShopInfo): void {
  const list = subjects
    .map((uid) => ctx.s.team.find((u) => u?.uid === uid))
    .filter((u): u is UnitInst => !!u && ctx.data.unitsById[u.defId]?.ability?.trigger === trigger);
  const order = list
    .map((u) => ({ u, pos: indexOfUid(ctx.s, u.uid) }))
    .sort((a, b) => b.u.atk + b.u.tempAtk - (a.u.atk + a.u.tempAtk) || a.pos - b.pos);
  for (const { u } of order) {
    if (indexOfUid(ctx.s, u.uid) < 0) continue;
    const def = ctx.data.unitsById[u.defId];
    const reps = abilityRepeats(def, u, tiersOf(ctx), ctx.data);
    for (let r = 0; r < reps; r++) {
      if (indexOfUid(ctx.s, u.uid) < 0) break;
      runShopAbility(ctx, u, resolveChoice(def.ability!, ctx.rng), info);
    }
  }
}
export function fireTeam(ctx: Ctx, trigger: Trigger, info: ShopInfo, exclude: string[] = []): void {
  fireShop(ctx, trigger, teamUnits(ctx.s).map((u) => u.uid).filter((x) => !exclude.includes(x)), info);
}

function shopTargets(ctx: Ctx, self: UnitInst, ab: Ability, info: ShopInfo): UnitInst[] {
  const ok = (u: UnitInst) => matchesFilter(ctx.data.unitsById[u.defId], ab.filter);
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

/** 商店阶段召唤一个单位到 near 附近空位（赛场 summonBuff、民间 ×3 继承 50%） */
export function shopSummon(ctx: Ctx, unitId: string, near: number, mult = 1, summoner?: UnitInst): UnitInst | null {
  const s = ctx.s;
  const at = firstEmpty(s, near);
  if (at < 0 || !ctx.data.unitsById[unitId]) return null;
  const tok = newUnit(ctx, unitId);
  tok.atk *= mult;
  tok.hp *= mult;
  const sb = arenaRules(s, ctx.data).summonBuff;
  if (sb) permBuff(tok, sb.atk, sb.hp);
  const tiers = tiersOf(ctx);
  // 召唤 ×2 / ×4：召唤物 +1/+1 / +2/+2；×4 召唤者永久 +1/+1
  if (tiers.summon >= 1) {
    const n = SYNERGY_TUNING.summonStat[tiers.summon >= 2 ? 1 : 0];
    permBuff(tok, n, n);
  }
  const gu = SYNERGY_TUNING.growPerm.summon;
  if (summoner && tiers.summon >= 2 && gu > 0 && indexOfUid(s, summoner.uid) >= 0) permGrow(ctx, summoner, gu, gu, tiers);
  if (summoner && tiers.folk >= 2) {
    tok.atk += Math.floor(summoner.atk / 2);
    tok.hp += Math.floor(summoner.hp / 2);
  }
  s.team[at] = tok;
  fireTeam(ctx, 'friendSummoned', { summoned: tok.uid }, [tok.uid]);
  return tok;
}

function runShopAbility(ctx: Ctx, self: UnitInst, ab: Ability, info: ShopInfo): void {
  const s = ctx.s;
  const targets = shopTargets(ctx, self, ab, info);
  const amt = abilityAmount(ab, self.level);
  const name = unitName(ctx.data, self.defId);
  switch (ab.effect) {
    case 'buff': {
      const b = abilityBuff(ab, self.level);
      for (const t of targets) {
        if (ab.permanent) {
          permGrow(ctx, t, b.atk, b.hp);
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
          s.gold += equipRefund(t);
          log(ctx, `${name} 吞并了 ${unitName(ctx.data, t.defId)}`);
        }
      }
      break;
    }
    case 'summon': {
      const count = ab.count ?? 1;
      for (let i = 0; i < count; i++) {
        if (!shopSummon(ctx, ab.unitId ?? 'token_shuijun', indexOfUid(s, self.uid), abilityMult(ab, self.level), self)) break;
      }
      break;
    }
    case 'pullFront':
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
    // damage / destroy / multiAttack / steal / explode / doubleStats / revive / chain 只在战斗中有意义
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
          permGrow(ctx, u, e.atk, e.hp);
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
      if (e.side === 'enemy') m.battle.enemyReverse = !m.battle.enemyReverse;
      else m.battleSwapAll += 1;
      break;
    case 'enemyBuff': {
      const b = m.battle.enemyBuff ?? { atk: 0, hp: 0 };
      m.battle.enemyBuff = { atk: b.atk + e.atk, hp: b.hp + e.hp };
      break;
    }
    case 'firstStrike':
      m.battle.first = e.side;
      break;
    case 'swapFronts':
      m.battle.swapFronts = !m.battle.swapFronts;
      break;
    case 'battleStatMul':
      for (const side of e.side === 'both' ? (['me', 'enemy'] as const) : [e.side]) {
        const cur = (m.battle.statMul ??= {})[side] ?? { atk: 1, hp: 1 };
        m.battle.statMul[side] = { atk: cur.atk * (e.atk ?? 1), hp: cur.hp * (e.hp ?? 1) };
      }
      break;
    case 'addEnemyBoss':
      (m.battle.enemyBoss ??= []).push({ unitId: e.unitId, atk: e.atk, hp: e.hp });
      m.rewardMul = Math.max(m.rewardMul ?? 1, e.rewardMul);
      break;
    case 'goldenEquips':
      m.battle.goldenEquips = true;
      break;
    case 'summonBuff': {
      const b = m.battle.summonBuff ?? { atk: 0, hp: 0 };
      m.battle.summonBuff = { atk: b.atk + e.atk, hp: b.hp + e.hp };
      break;
    }
    case 'damageOpponent': {
      const alive = (s.opponents ?? []).filter((o) => o.alive);
      if (!alive.length) break;
      const o = e.target === 'leader' ? alive.reduce((a, b) => (b.hp > a.hp ? b : a)) : ctx.rng.pick(alive);
      const amount = Math.min(e.amount, o.hp - 1);
      if (amount <= 0) break;
      o.hp -= amount;
      log(ctx, `${o.name} -${amount} 热度`);
      emitEvent(ctx, { type: 'hpLoss', who: o.id, name: o.name, amount, hp: o.hp, by: 'me', text: `${o.name} 热度 -${amount}` });
      break;
    }
    case 'stealEnemy':
      (m.battle.stealEnemy ??= []).push(e.target);
      break;
    case 'benchEnemy':
      (m.battle.benchEnemy ??= []).push(e.target);
      break;
    case 'selfHpLoss': {
      const amount = Math.min(e.amount, s.hp - 1);
      if (amount <= 0) break;
      s.hp -= amount;
      emitEvent(ctx, { type: 'hpLoss', who: 'me', name: '你', amount, hp: s.hp, text: `热度 -${amount}` });
      break;
    }
    case 'battleSummon':
      (m.battle.battleSummon ??= []).push({ side: e.side, unitId: e.unitId, count: e.count });
      break;
    case 'synergyBonus':
      (m.battle.synergyBonus ??= {})[e.key] = (m.battle.synergyBonus[e.key] ?? 0) + e.amount;
      repriceShop(ctx);
      break;
    case 'wager':
      m.wager = { winGold: (m.wager?.winGold ?? 0) + e.winGold, loseHp: (m.wager?.loseHp ?? 0) + e.loseHp };
      break;
    case 'freeEquip': {
      const pool = ctx.data.equips.filter((q) => !e.slot || q.slot === e.slot);
      if (!pool.length) break;
      s.shop.push(mkSlot(ctx, 'equip', ctx.rng.pick(pool).id, 'event', e.gold));
      sortShop(s);
      break;
    }
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
      s.gold += e.amount + equipRefund(victim);
      log(ctx, `${unitName(ctx.data, victim.defId)} 被牺牲了`);
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
    case 'lifeTrade': {
      const cost = DIFFICULTY.lifeTradeHp;
      if (s.hp > cost) {
        s.hp -= cost;
        s.gold += e.amount;
        m.freeRerolls += 1;
      } else {
        log(ctx, '热度太低，交易取消');
      }
      break;
    }
  }
}

// ───────────────────────── 回合推进 ─────────────────────────

/** 每回合固定收入：基础（按回合曲线 7→10）+ 下回合加成 + 赛场 + 经济羁绊 + 融资装备 */
export function turnIncome(ctx: Ctx): { total: number; economy: number; funding: number; arena: number } {
  const tiers = tiersOf(ctx);
  const economy = tiers.economy >= 2 ? SYNERGY_TUNING.economyGold[1] : tiers.economy >= 1 ? SYNERGY_TUNING.economyGold[0] : 0;
  let funding = 0;
  for (const u of teamUnits(ctx.s)) funding += equipTotals(u, ctx.data, equipMultFor(defOf(ctx, u), tiers)).turnGold ?? 0;
  const arena = arenaRules(ctx.s, ctx.data).goldPerTurn ?? 0;
  const base = ctx.s.tutorial ? BASE_GOLD : baseGoldForTurn(ctx.s.turn); // 引导局固定 10，脚本需要
  return { total: base + ctx.s.modifiers.nextTurnGold + economy + funding + arena, economy, funding, arena };
}

/** 进入某回合：重置算力与修正器 → 生成商店 →（待生效突发）→（头条 or 商店） */
export function beginTurn(ctx: Ctx, turn: number): void {
  const s = ctx.s;
  const m = s.modifiers;
  s.turn = turn;
  const inc = turnIncome(ctx);
  s.gold = inc.total;
  s.modifiers = { ...emptyModifiers(), freeRerolls: m.nextFreeRerolls, unitPriceMod: m.nextUnitPriceMod };
  s.shop = s.shop.filter((x) => x.frozen);
  s.pendingHeadline = undefined;
  s.lastLevelUp = undefined;
  s.matchup = undefined;
  rollShop(ctx, true);
  log(ctx, `—— 第 ${turn} 回合 ——`);
  if (inc.economy) log(ctx, `经济羁绊：+${inc.economy} 算力`);
  if (inc.funding) log(ctx, `融资：+${inc.funding} 算力`);
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

/** 进入商店：startTurn 技能 + 开源 ×4（开源单位永久 +1/+1） */
export function openShop(ctx: Ctx): void {
  ctx.s.phase = 'shop';
  fireTeam(ctx, 'startTurn', {});
  if (tiersOf(ctx).open >= 3) {
    for (const u of teamUnits(ctx.s)) if (defOf(ctx, u)?.faction === 'open') permGrow(ctx, u, 1, 1);
    log(ctx, '开源 ×4：开源单位永久 +1/+1');
  }
  repriceShop(ctx);
}

/** 回合结束（endShop）：endTurn 技能 → RLHF 成长 → 成长 ×4（全队永久 +1/+1） */
export function endTurnEffects(ctx: Ctx): void {
  fireTeam(ctx, 'endTurn', {});
  const tiers = tiersOf(ctx);
  for (const u of teamUnits(ctx.s)) {
    const def = defOf(ctx, u);
    const t = equipTotals(u, ctx.data, equipMultFor(def, tiers));
    if (t.growAtk || t.growHp) permGrow(ctx, u, t.growAtk ?? 0, t.growHp ?? 0, tiers);
  }
  if (tiers.growth >= 2) {
    for (const u of teamUnits(ctx.s)) permGrow(ctx, u, 1, 1, tiers);
    log(ctx, '成长 ×4：全队永久 +1/+1');
  }
}

/** 战斗结束后的清理：临时加成、护盾 */
export function clearBattleTemps(s: RunState): void {
  for (const u of teamUnits(s)) {
    u.tempAtk = 0;
    u.tempHp = 0;
    u.shield = 0;
  }
}

// ───────────────────────── 商店动作 ─────────────────────────

/** 就地执行商店阶段动作，返回错误文案或 null（机器人复用）。chooseArena / choosePveReward / continue 在 run.ts 处理。 */
export function applyAction(ctx: Ctx, a: ShopActionInput): string | null {
  const err = applyActionInner(ctx, a);
  if (!err) repriceShop(ctx);
  return err;
}

function applyActionInner(ctx: Ctx, a: ShopActionInput): string | null {
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
      spendGold(ctx, slot.price);
      s.shop.splice(a.slot, 1);
      const def = data.unitsById[slot.defId];
      let uid: string;
      log(ctx, `买下 ${def?.name ?? slot.defId}`);
      if (merge) {
        uid = s.team[to]!.uid;
        mergeInto(ctx, to, { atk: def?.atk ?? 1, hp: def?.hp ?? 1, xp: 0 });
      } else {
        const u = newUnit(ctx, slot.defId);
        s.team[to] = u;
        uid = u.uid;
      }
      if (s.tutorial) {
        s.tutorial.buys++;
        const t = tiersOf(ctx);
        if (Object.values(t).some((x) => x > 0)) s.tutorial.synergy = true;
      }
      fireShop(ctx, 'buy', [uid], { bought: uid });
      fireTeam(ctx, 'friendBought', { bought: uid }, [uid]);
      // 开源 ×3：任一开源单位被购买时，全体开源单位永久 +1/+1
      if (def?.faction === 'open' && tiersOf(ctx).open >= 2) {
        for (const u of teamUnits(s)) if (defOf(ctx, u)?.faction === 'open') permGrow(ctx, u, 1, 1);
        log(ctx, '开源 ×3：全体开源单位永久 +1/+1');
      }
      return null;
    }
    case 'sell': {
      const e = needShop();
      if (e) return e;
      const u = s.team[a.index];
      if (!u) return '这里没有单位';
      const tiers = tiersOf(ctx);
      fireShop(ctx, 'sell', [u.uid], {});
      const at = indexOfUid(s, u.uid);
      if (at >= 0) s.team[at] = null;
      const funding = equipTotals(u, data, equipMultFor(defOf(ctx, u), tiers)).sellGold ?? 0;
      // 装备进仓库（按 武器/防具/饰品 顺序），放不下的按件折算
      const inv = inventoryOf(s);
      let refund = 0;
      let stored = 0;
      for (const sl of EQUIP_SLOTS) {
        const eq = u.equips?.[sl];
        if (!eq) continue;
        if (inv.length < INVENTORY_SIZE) {
          inv.push({ defId: eq.defId, gold: eq.gold });
          stored++;
        } else refund += equipInstRefund(eq);
      }
      s.gold += u.level + refund + funding;
      if (s.tutorial) s.tutorial.sold = true;
      log(ctx, `卖掉 ${unitName(data, u.defId)}，+${u.level + refund + funding} 算力${stored ? `（${stored} 件装备进仓库）` : ''}${refund ? `（仓库满，装备折算 ${refund}）` : ''}${funding ? `（融资 ${funding}）` : ''}`);
      return null;
    }
    case 'reroll': {
      const e = needShop();
      if (e) return e;
      const m = s.modifiers;
      const ar = arenaRules(s, data);
      if (m.rerollFree || ar.rerollFree) {
        /* 免费 */
      } else if (m.freeRerolls > 0) m.freeRerolls--;
      else if (s.gold >= REROLL_PRICE) spendGold(ctx, REROLL_PRICE);
      else return '算力不够刷新';
      m.rerollsThisTurn++;
      rollShop(ctx);
      // 赛场「1 号位光环」
      if (ar.rerollFrontBuff && m.rerollsThisTurn <= (ar.rerollFrontCap ?? 5)) {
        const front = teamUnits(s)[0];
        if (front) permGrow(ctx, front, ar.rerollFrontBuff.atk, ar.rerollFrontBuff.hp);
      }
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
      const refund = mergeEquips(to, from, data);
      s.gold += refund;
      mergeInto(ctx, a.to, { atk: from.atk, hp: from.hp, xp: from.xp });
      const t = s.team[a.to]!;
      t.tempAtk += from.tempAtk;
      t.tempHp += from.tempHp;
      t.shield += from.shield;
      return null;
    }
    case 'equip': {
      const e = needShop();
      if (e) return e;
      const slot = s.shop[a.slot];
      if (!slot || slot.kind !== 'equip') return '没有这件装备';
      const def = data.equipsById[slot.defId];
      if (!def) return '未知装备';
      const u = s.team[a.unitIndex];
      if (!u) return '请选择一个单位';
      if (slot.price > s.gold) return `算力不够，需要 ${slot.price} 算力`;
      const bad = canAttach(u, def, !!slot.gold);
      if (bad) return bad;
      const inv = inventoryOf(s);
      if (attachOutcome(u, def, !!slot.gold) === 'replace' && inv.length >= INVENTORY_SIZE) return INVENTORY_FULL_REPLACE;
      spendGold(ctx, slot.price);
      s.shop.splice(a.slot, 1);
      const r = attachEquip(u, def, !!slot.gold);
      if (r.old) inv.push({ defId: r.old.defId, gold: r.old.gold });
      if (r.outcome === 'gold' || slot.gold) s.stats.goldEquips++;
      if (s.tutorial) s.tutorial.usedItem = true;
      log(ctx, `${unitName(data, u.defId)} 装上 ${def.name}${r.outcome === 'gold' || slot.gold ? '（金色！）' : ''}${r.old ? `，换下的 ${data.equipsById[r.old.defId]?.name ?? r.old.defId} 进仓库` : ''}`);
      fireShop(ctx, 'eatItem', [u.uid], {});
      return null;
    }
    case 'buyEquipToInventory': {
      const e = needShop();
      if (e) return e;
      const slot = s.shop[a.slot];
      if (!slot || slot.kind !== 'equip') return '没有这件装备';
      const def = data.equipsById[slot.defId];
      if (!def) return '未知装备';
      if (slot.price > s.gold) return `算力不够，需要 ${slot.price} 算力`;
      const inv = inventoryOf(s);
      if (inv.length >= INVENTORY_SIZE) return INVENTORY_FULL;
      spendGold(ctx, slot.price);
      s.shop.splice(a.slot, 1);
      inv.push({ defId: def.id, gold: !!slot.gold, fresh: true });
      if (slot.gold) s.stats.goldEquips++;
      log(ctx, `买下 ${def.name}${slot.gold ? '（金色）' : ''}，放进仓库`);
      return null;
    }
    case 'unequip': {
      const e = needShop();
      if (e) return e;
      const u = s.team[a.unitIndex];
      if (!u) return '这里没有单位';
      if (!(EQUIP_SLOTS as readonly string[]).includes(a.slot)) return '没有这个装备槽';
      const cur = u.equips?.[a.slot];
      if (!cur) return '这个槽没有装备';
      const inv = inventoryOf(s);
      if (inv.length >= INVENTORY_SIZE) return INVENTORY_FULL;
      delete u.equips[a.slot];
      inv.push({ defId: cur.defId, gold: cur.gold });
      log(ctx, `${unitName(data, u.defId)} 卸下 ${data.equipsById[cur.defId]?.name ?? cur.defId}，放进仓库`);
      return null;
    }
    case 'equipFromInventory': {
      const e = needShop();
      if (e) return e;
      const inv = inventoryOf(s);
      const item = inv[a.invIndex];
      if (!item) return '仓库里没有这件装备';
      const def = data.equipsById[item.defId];
      if (!def) return '未知装备';
      const u = s.team[a.unitIndex];
      if (!u) return '请选择一个单位';
      const bad = canAttach(u, def, item.gold);
      if (bad) return bad;
      // 换下的旧装备放回原位（仓库件数不变，不会溢出）
      const r = attachEquip(u, def, item.gold);
      if (r.old) inv[a.invIndex] = { defId: r.old.defId, gold: r.old.gold };
      else inv.splice(a.invIndex, 1);
      if (r.outcome === 'gold') s.stats.goldEquips++;
      log(ctx, `${unitName(data, u.defId)} 从仓库装上 ${def.name}${r.outcome === 'gold' ? '（金色！）' : ''}${r.old ? `，换下的 ${data.equipsById[r.old.defId]?.name ?? r.old.defId} 进仓库` : ''}`);
      if (item.fresh) {
        if (s.tutorial) s.tutorial.usedItem = true;
        fireShop(ctx, 'eatItem', [u.uid], {});
      }
      return null;
    }
    case 'sellInventory': {
      const e = needShop();
      if (e) return e;
      const inv = inventoryOf(s);
      const item = inv[a.invIndex];
      if (!item) return '仓库里没有这件装备';
      inv.splice(a.invIndex, 1);
      const g = equipInstRefund(item);
      s.gold += g;
      log(ctx, `卖掉仓库里的 ${data.equipsById[item.defId]?.name ?? item.defId}${item.gold ? '（金色）' : ''}，+${g} 算力`);
      return null;
    }
    case 'useConsumable':
      return useConsumable(ctx, a.slot, a.target);
    case 'upgradeShop': {
      const e = needShop();
      if (e) return e;
      if (s.shopLevel >= MAX_SHOP_LEVEL) return `每局最多升级 ${MAX_SHOP_LEVEL} 次`;
      const cur = shopMaxTier(s);
      if (cur >= 6) return '已经是最高阶了';
      if (s.gold < UPGRADE_PRICE) return `算力不够，需要 ${UPGRADE_PRICE} 算力`;
      spendGold(ctx, UPGRADE_PRICE);
      s.shopLevel++;
      s.shopTier = cur + 1;
      s.stats.upgrades++;
      // DESIGN 20：升级后立即免费重刷整个商店（冻结 / 免费槽保留），并保证有新阶单位
      rollShop(ctx, false, SHOP_ROLL.upgradeRerollAll ? undefined : 'unit');
      log(ctx, `升级商店：提前解锁 T${s.shopTier}`);
      emitEvent(ctx, { type: 'shopLevelUp', shopLevel: s.shopLevel, tier: s.shopTier, text: `商店升级！提前解锁 T${s.shopTier}` });
      return null;
    }
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
      endTurnEffects(ctx);
      s.phase = 'battle';
      return null;
    }
    default:
      return '未知操作';
  }
}

function useConsumable(ctx: Ctx, slotIdx: number, target?: number): string | null {
  const s = ctx.s;
  if (s.phase !== 'shop') return '现在不是商店阶段';
  const slot = s.shop[slotIdx];
  if (!slot || slot.kind !== 'consumable') return '没有这个消耗品';
  const c = ctx.data.consumablesById[slot.defId];
  if (!c) return '未知消耗品';
  if (slot.price > s.gold) return `算力不够，需要 ${slot.price} 算力`;
  const tu = target !== undefined ? s.team[target] : null;
  const ef = c.effect;
  // 先校验，后扣钱
  if ((c.targetKind === 'unit' || ef.type === 'transform' || ef.type === 'buff') && !tu) return '请选择一个单位';
  let lvTarget: UnitInst | undefined;
  if (ef.type === 'levelUpRandom') {
    if (tu) {
      if (tu.level >= 3) return '已经满级了';
      lvTarget = tu;
    } else {
      const cands = teamUnits(s).filter((u) => u.level < 3);
      if (!cands.length) return '没有可以升级的单位';
    }
  }
  if (ef.type === 'transform') {
    const def = ctx.data.unitsById[tu!.defId];
    if (!(ctx.data.shopUnitsByTier[def?.tier ?? 1] ?? []).some((u) => u.id !== tu!.defId)) return '没有可以变的单位';
  }
  spendGold(ctx, slot.price);
  s.shop.splice(slotIdx, 1);
  log(ctx, `使用 ${c.name}${tu ? ` → ${unitName(ctx.data, tu.defId)}` : ''}`);
  const touched: UnitInst[] = [];
  switch (ef.type) {
    case 'freeRerolls':
      s.modifiers.freeRerolls += ef.amount;
      break;
    case 'gold':
      s.gold += ef.amount;
      break;
    case 'buff':
      if (ef.permanent) permGrow(ctx, tu!, ef.atk, ef.hp);
      else {
        tu!.tempAtk += ef.atk;
        tu!.tempHp += ef.hp;
        clampHp(tu!);
      }
      touched.push(tu!);
      break;
    case 'levelUpRandom': {
      const u = lvTarget ?? ctx.rng.pick(teamUnits(s).filter((x) => x.level < 3));
      levelUpUnit(ctx, u);
      touched.push(u);
      break;
    }
    case 'transform': {
      const u = tu!;
      const old = ctx.data.unitsById[u.defId];
      const id = rollUnitDef(ctx, { tier: old?.tier ?? 1, exclude: u.defId })!;
      const nd = ctx.data.unitsById[id];
      u.atk = Math.max(0, nd.atk + (u.atk - (old?.atk ?? 0)));
      u.hp = Math.max(1, nd.hp + (u.hp - (old?.hp ?? 0)));
      u.defId = id;
      log(ctx, `变成了 ${nd.name}`);
      touched.push(u);
      break;
    }
  }
  if (s.tutorial) s.tutorial.usedItem = true;
  for (const u of touched) if (indexOfUid(s, u.uid) >= 0) fireShop(ctx, 'eatItem', [u.uid], {});
  return null;
}

// ───────────────────────── 查询 ─────────────────────────

/** 当前回合商店单位数量上限（含赛场与头条 extraSlot） */
export function currentUnitSlots(s: RunState, data: GameData): number {
  return shopSlotCounts(s, data).units;
}
/** 当前刷新价格（0 = 免费） */
export function rerollCost(s: RunState, data: GameData): number {
  const m = s.modifiers;
  if (m.rerollFree || arenaRules(s, data).rerollFree || m.freeRerolls > 0) return 0;
  return REROLL_PRICE;
}
/** 升级商店是否可用（客户端按钮状态） */
export function canUpgradeShop(s: RunState): boolean {
  return s.phase === 'shop' && s.shopLevel < MAX_SHOP_LEVEL && shopMaxTier(s) < 6 && s.gold >= UPGRADE_PRICE;
}
