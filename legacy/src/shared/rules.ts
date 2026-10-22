// 纯规则函数：引擎与客户端共用（不依赖 Node API）。
import {
  BOARD_SIZE,
  COMPUTE_RENTS,
  MAX_LEVEL,
  MORTGAGE_INTEREST,
  UTILITY_MUL_BOTH,
  UTILITY_MUL_ONE,
  type BoardData,
  type Cell,
  type GameAction,
  type GameState,
  type ItemId,
  type Modifiers,
  type Owned,
  type RankEntry,
} from './types.js';

/** 规范化格子下标到 0..39 */
export function wrapPos(pos: number): number {
  return ((pos % BOARD_SIZE) + BOARD_SIZE) % BOARD_SIZE;
}

/** 可被购买的格子（基建 / 算力 / 公用） */
export function isOwnable(cell: Cell): boolean {
  return cell.type === 'property' || cell.type === 'compute' || cell.type === 'utility';
}

/** 某玩家是否拥有整个颜色组（只看所有者，被抵押也算，见 DESIGN 8.8） */
export function ownsWholeGroup(board: BoardData, owned: Record<number, Owned>, ownerId: string, groupId: string): boolean {
  const group = board.groups.find((g) => g.id === groupId);
  if (!group || group.cells.length === 0) return false;
  return group.cells.every((c) => owned[c]?.owner === ownerId);
}

/** 某玩家持有的某类格子数量（算力 / 公用计费用） */
export function countOwnedOfType(board: BoardData, owned: Record<number, Owned>, ownerId: string, type: Cell['type']): number {
  return board.cells.filter((c) => c.type === type && owned[c.id]?.owner === ownerId).length;
}

/**
 * 基础 API 调用费（不含全局倍率、不判断护盾）。
 * - 基建：rents[level]；level 0 且集齐同组 ×2
 * - 算力：按持有数量 [25,50,100,200]
 * - 公用：骰子点数 ×4，持有 2 个 ×10
 * 被抵押或无主返回 0。
 */
export function baseRent(board: BoardData, owned: Record<number, Owned>, cellId: number, diceTotal: number): number {
  const cell = board.cells[cellId];
  const o = owned[cellId];
  if (!cell || !o || o.mortgaged) return 0;
  switch (cell.type) {
    case 'property': {
      const rents = cell.rents ?? [];
      const level = Math.max(0, Math.min(o.level, rents.length - 1));
      let rent = rents[level] ?? 0;
      if (level === 0 && cell.group && ownsWholeGroup(board, owned, o.owner, cell.group)) rent *= 2;
      return rent;
    }
    case 'compute': {
      const n = countOwnedOfType(board, owned, o.owner, 'compute');
      return n <= 0 ? 0 : COMPUTE_RENTS[Math.min(n, COMPUTE_RENTS.length) - 1];
    }
    case 'utility': {
      const n = countOwnedOfType(board, owned, o.owner, 'utility');
      return Math.max(0, diceTotal) * (n >= 2 ? UTILITY_MUL_BOTH : UTILITY_MUL_ONE);
    }
    default:
      return 0;
  }
}

/** 实际应付 API 调用费 = 基础费 × 全局倍率 × 额外倍数（卡牌 nearest），四舍五入 */
export function calcRent(
  board: BoardData,
  owned: Record<number, Owned>,
  modifiers: Modifiers,
  cellId: number,
  diceTotal: number,
  extraMul = 1,
): number {
  return Math.round(baseRent(board, owned, cellId, diceTotal) * modifiers.rentFactor * extraMul);
}

/** 当前升级费（含全局升级费倍率） */
export function upgradeCostOf(board: BoardData, modifiers: Modifiers, cellId: number): number {
  const cell = board.cells[cellId];
  return Math.round((cell?.upgradeCost ?? 0) * modifiers.upgradeFactor);
}

/** 抵押可得 = 购买价一半 */
export function mortgageValue(cell: Cell): number {
  return Math.floor((cell.price ?? 0) / 2);
}

/** 赎回费用 = 抵押值 × 110%（向上取整） */
export function unmortgageCost(cell: Cell): number {
  // 用整数运算避免 50×1.1=55.000000000000007 这类浮点误差
  return Math.ceil((mortgageValue(cell) * Math.round(MORTGAGE_INTEREST * 100)) / 100);
}

/** 拆一级建筑回收 = 升级费（原价）一半 */
export function buildingSellValue(cell: Cell): number {
  return Math.floor((cell.upgradeCost ?? 0) / 2);
}

/** 身价 = 现金 + 基建原价 + 建筑投入（按原价）；抵押的基建按半价 */
export function calcNetWorth(board: BoardData, state: Pick<GameState, 'players' | 'owned'>, playerId: string): number {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || p.bankrupt) return 0;
  let worth = p.money;
  for (const [key, o] of Object.entries(state.owned)) {
    if (o.owner !== playerId) continue;
    const cell = board.cells[Number(key)];
    if (!cell) continue;
    const value = (cell.price ?? 0) + o.level * (cell.upgradeCost ?? 0);
    worth += o.mortgaged ? Math.floor(value / 2) : value;
  }
  return worth;
}

/** 按身价排名（破产者垫底） */
export function calcRanking(board: BoardData, state: Pick<GameState, 'players' | 'owned'>): RankEntry[] {
  return state.players
    .map((p, idx) => ({ p, idx, w: calcNetWorth(board, state, p.id) }))
    .sort((a, b) => {
      if (a.p.bankrupt !== b.p.bankrupt) return a.p.bankrupt ? 1 : -1;
      if (b.w !== a.w) return b.w - a.w;
      if (b.p.money !== a.p.money) return b.p.money - a.p.money;
      return a.idx - b.idx;
    })
    .map(({ p, w }) => ({ playerId: p.id, netWorth: w }));
}

export interface PathResult {
  path: number[]; // 不含起点，含终点
  to: number;
  passedStart: boolean; // 经过或停在融资轮
  roadblock: number | null; // 被路障拦下的格子
}

/**
 * 计算逐格路径。steps>0 前进，<0 后退（后退不算经过融资轮）。
 * roadblocks 仅对前进生效：走到有路障的格子立即停下。
 */
export function computePath(from: number, steps: number, roadblocks: readonly number[] = []): PathResult {
  const path: number[] = [];
  let pos = from;
  let passedStart = false;
  let roadblock: number | null = null;
  const dir = steps >= 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(steps); i++) {
    pos = wrapPos(pos + dir);
    path.push(pos);
    if (dir > 0 && pos === 0) passedStart = true;
    if (dir > 0 && roadblocks.includes(pos)) {
      roadblock = pos;
      break;
    }
  }
  return { path, to: pos, passedStart, roadblock };
}

/** 从 from 前进到 to 的路径（不含 from，含 to）；from===to 时绕一圈 */
export function pathTo(from: number, to: number): number[] {
  let steps = wrapPos(to - from);
  if (steps === 0) steps = BOARD_SIZE;
  return computePath(from, steps).path;
}

/** 前方 min..max 格的格子 id 列表 */
export function cellsAhead(from: number, min: number, max: number): number[] {
  const out: number[] = [];
  for (let k = min; k <= max; k++) out.push(wrapPos(from + k));
  return out;
}

/** 前方最近的某类格子 */
export function nearestCellOfType(board: BoardData, from: number, type: Cell['type']): number | null {
  for (let k = 1; k <= BOARD_SIZE; k++) {
    const id = wrapPos(from + k);
    if (board.cells[id]?.type === type) return id;
  }
  return null;
}

/** 道具默认射程（items.json 的 range 优先） */
export const DEFAULT_ITEM_RANGE: Partial<Record<ItemId, number>> = { roadblock: 8, missile: 10 };

/**
 * 某道具当前可选目标（客户端用于高亮，服务端用于校验）。
 * - kind 'none'：无需目标
 * - cells：可选格子；players：可选玩家
 */
export function itemTargets(
  board: BoardData,
  state: Pick<GameState, 'players' | 'owned' | 'roadblocks'>,
  playerId: string,
  itemId: ItemId,
  range?: number,
): { kind: 'none' | 'cell' | 'player'; cells: number[]; players: string[] } {
  const me = state.players.find((p) => p.id === playerId);
  const none = { kind: 'none' as const, cells: [], players: [] };
  if (!me) return none;
  const r = range ?? DEFAULT_ITEM_RANGE[itemId] ?? 0;
  switch (itemId) {
    case 'roadblock':
      return { kind: 'cell', cells: cellsAhead(me.pos, 1, r || 8).filter((c) => !state.roadblocks.includes(c)), players: [] };
    case 'missile':
      return {
        kind: 'cell',
        cells: cellsAhead(me.pos, 1, r || 10).filter((c) => {
          const o = state.owned[c];
          return !!o && o.owner !== playerId && o.level > 0 && board.cells[c]?.type === 'property';
        }),
        players: [],
      };
    case 'turtle':
      return {
        kind: 'player',
        cells: [],
        players: state.players.filter((p) => p.id !== playerId && !p.bankrupt && !p.turtle).map((p) => p.id),
      };
    case 'teleport':
      return {
        kind: 'cell',
        cells: Object.entries(state.owned)
          .filter(([, o]) => o.owner === playerId)
          .map(([k]) => Number(k))
          .sort((a, b) => a - b),
        players: [],
      };
    default:
      return none;
  }
}

/**
 * upgradeAny 可选的基建（DESIGN 10.1）：自己的、未抵押、level<5 的 property，且钱够付升级费。
 * 不判断回合阶段 / upgradedThisTurn（见 canUpgradeAny）。
 */
export function upgradeAnyTargets(board: BoardData, state: Pick<GameState, 'players' | 'owned' | 'modifiers'>, playerId: string): number[] {
  const p = state.players.find((x) => x.id === playerId);
  if (!p || p.bankrupt) return [];
  return Object.entries(state.owned)
    .filter(([k, o]) => {
      const c = Number(k);
      return (
        o.owner === playerId &&
        !o.mortgaged &&
        o.level < MAX_LEVEL &&
        board.cells[c]?.type === 'property' &&
        p.money >= upgradeCostOf(board, state.modifiers, c)
      );
    })
    .map(([k]) => Number(k))
    .sort((a, b) => a - b);
}

/**
 * 是否处于某玩家自己的"掷骰前"阶段（可用道具 / 抵押 / 赎回 / 远程升级的时机）：
 * 对局进行中、轮到他、turnPhase=preRoll 且没有待决策（监管审查 pending=jail 也算）。
 */
export function isPreRoll(state: Pick<GameState, 'phase' | 'currentPlayerId' | 'turnPhase' | 'pending'>, playerId: string): boolean {
  return (
    state.phase === 'playing' &&
    state.currentPlayerId === playerId &&
    state.turnPhase === 'preRoll' &&
    (state.pending === null || state.pending.type === 'jail')
  );
}

/** 此刻能否 upgradeAny：轮到自己、preRoll（含监管中）、本回合未用过。传 board 时还要求有可升级且付得起的基建 */
export function canUpgradeAny(state: GameState, playerId: string, board?: BoardData): boolean {
  if (state.upgradedThisTurn || !isPreRoll(state, playerId)) return false;
  if (board) return upgradeAnyTargets(board, state, playerId).length > 0;
  return Object.values(state.owned).some((o) => o.owner === playerId && !o.mortgaged && o.level < MAX_LEVEL);
}

/** 当前玩家此刻可执行的动作类型（客户端据此显示按钮）。传 board 时 'upgradeAny' 的判断更精确 */
export function legalActionTypes(state: GameState, playerId: string, board?: BoardData): GameAction['type'][] {
  if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return [];
  const p = state.players.find((x) => x.id === playerId);
  if (!p) return [];
  const extra: GameAction['type'][] = canUpgradeAny(state, playerId, board) ? ['upgradeAny'] : [];
  switch (state.pending?.type) {
    case 'buy':
      return ['buy', 'skipBuy'];
    case 'upgrade':
      return ['upgrade', 'skipUpgrade'];
    case 'card':
      return ['ackCard'];
    case 'jail': {
      const out: GameAction['type'][] = ['payJail', 'rollJail', 'useItem', 'mortgage', 'unmortgage'];
      if (p.items.includes('jailfree')) out.push('useJailCard');
      return [...out, ...extra];
    }
    default:
      return state.turnPhase === 'preRoll' ? ['roll', 'useItem', 'mortgage', 'unmortgage', ...extra] : [];
  }
}

