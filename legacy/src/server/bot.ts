// 机器人决策（纯函数）。掉线真人也由它托管。延迟（600~1200ms 思考 + 动画时长）由 room.ts 负责调度。
//
// 策略要点（目标：对局有张力但不拖沓）：
// - 现金储备 reserve = max(150, 对手单次最高可能收费)，买地 / 升级后尽量不跌破储备；
//   能凑齐同组、截胡对手同组、或高租金地段时放宽储备，弱地段收紧。
// - 升级按"集齐同组 / 租金增量 / 升级后档位"打分，好地段更激进；每回合掷骰前用 upgradeAny
//   远程升级评分最高、且升级后不跌破储备的一块。
// - 道具有针对性：导弹打对手最高等级建筑（优先领先者）；路障放在对手必经的自己高租金格上；
//   乌龟给离自己高价地最近的对手；前方危险时开护盾 / 用火箭跳过 / 跳板机逃回自己地。
// - 监管中钱多就付费出来，钱少就赖着掷骰（省钱也安全）。
import {
  calcRent,
  cellsAhead,
  itemTargets,
  canUpgradeAny,
  ownsWholeGroup,
  unmortgageCost,
  upgradeAnyTargets,
  upgradeCostOf,
  wrapPos,
  type GameAction,
  type GameData,
  type GameEvent,
  type GameState,
  type ItemId,
  type Player,
} from '@dafuweng/shared';
import { defaultAction } from './engine/index.js';
import type { RandomFn } from './engine/rng.js';

/** 两颗 d6 点数和为 t 的概率 */
const P2D6: number[] = Array.from({ length: 13 }, (_, t) => (t < 2 ? 0 : (6 - Math.abs(t - 7)) / 36));

const rentAt = (state: GameState, data: GameData, cellId: number, dice = 7) =>
  calcRent(data.board, state.owned, state.modifiers, cellId, dice);

/** 对手名下（未抵押）的格子 */
function isEnemyCell(state: GameState, me: Player, cellId: number): boolean {
  const o = state.owned[cellId];
  return !!o && o.owner !== me.id && !o.mortgaged;
}

/** 我名下（未抵押）的格子 */
function isMyCell(state: GameState, me: Player, cellId: number): boolean {
  const o = state.owned[cellId];
  return !!o && o.owner === me.id && !o.mortgaged;
}

/** 对手名下单次最高可能收费（公用按 12 点算），用于决定现金储备 */
export function maxEnemyRent(state: GameState, data: GameData, me: Player): number {
  let max = 0;
  for (const k of Object.keys(state.owned)) {
    const c = Number(k);
    if (!isEnemyCell(state, me, c)) continue;
    max = Math.max(max, rentAt(state, data, c, 12));
  }
  return max;
}

/** 现金储备：max(150, 对手单次最高收费) */
export function cashReserve(state: GameState, data: GameData, me: Player): number {
  return Math.max(150, maxEnemyRent(state, data, me));
}

/**
 * 从 from 出发掷骰（总点数 + bonus）后落地的期望花费（只算对手收费，按概率加权）。
 * 公用按实际点数计费。路障不计。
 */
function expectedCost(state: GameState, data: GameData, me: Player, from: number, bonus = 0): number {
  let e = 0;
  for (let t = 2; t <= 12; t++) {
    const c = wrapPos(from + t + bonus);
    if (!isEnemyCell(state, me, c)) continue;
    e += P2D6[t] * rentAt(state, data, c, t + bonus);
  }
  return e;
}

/** 前方 2..12 格内对手最高收费 */
function maxRentAhead(state: GameState, data: GameData, me: Player, from: number): number {
  let m = 0;
  for (const c of cellsAhead(from, 2, 12)) if (isEnemyCell(state, me, c)) m = Math.max(m, rentAt(state, data, c, 12));
  return m;
}

function itemRange(data: GameData, id: ItemId): number | undefined {
  return data.items.find((i) => i.id === id)?.range;
}

function opponents(state: GameState, me: Player): Player[] {
  return state.players.filter((p) => p.id !== me.id && !p.bankrupt);
}

/** 买地决策 */
function shouldBuy(state: GameState, data: GameData, me: Player, cellId: number): boolean {
  const board = data.board;
  const cell = board.cells[cellId];
  const price = cell.price ?? 0;
  const left = me.money - price;
  if (left < 0) return false;
  const reserve = cashReserve(state, data, me);
  // 开局前几轮对手还没什么地，储备可以低一点，先抢地盘
  let need = state.round <= 6 ? Math.min(reserve, 100) : reserve;
  if (cell.type === 'property' && cell.group) {
    const g = board.groups.find((x) => x.id === cell.group);
    const others = (g?.cells ?? []).filter((c) => c !== cellId);
    const mine = others.filter((c) => state.owned[c]?.owner === me.id).length;
    const enemyOwners = new Set(others.map((c) => state.owned[c]?.owner).filter((o) => o && o !== me.id));
    if (mine === others.length) need *= 0.3; // 凑齐同组
    else if (mine > 0 && enemyOwners.size === 0) need *= 0.6; // 离集齐更近
    else if (enemyOwners.size === 1 && others.every((c) => state.owned[c]?.owner && state.owned[c].owner !== me.id))
      need *= 0.5; // 截胡对手同组
  } else if (cell.type === 'compute') {
    const n = Object.entries(state.owned).filter(([k, o]) => o.owner === me.id && board.cells[Number(k)].type === 'compute').length;
    if (n >= 1) need *= 0.7;
  }
  return left >= need;
}

/** 升级决策：集齐同组 / 高租金地段更激进 */
function shouldUpgrade(state: GameState, data: GameData, me: Player, cellId: number): boolean {
  const board = data.board;
  const cell = board.cells[cellId];
  const o = state.owned[cellId];
  const cost = upgradeCostOf(board, state.modifiers, cellId);
  const left = me.money - cost;
  if (left < 0) return false;
  const rents = cell.rents ?? [];
  const next = rents[Math.min(o.level + 1, rents.length - 1)] ?? 0;
  const cur = rents[o.level] ?? 0;
  const gain = next - cur; // 每次被踩的增收
  const full = !!cell.group && ownsWholeGroup(board, state.owned, me.id, cell.group);
  let need = cashReserve(state, data, me);
  if (full) need *= 0.6;
  if (gain >= cost) need *= 0.7; // 回本只需被踩一次
  if (next >= 500) need *= 0.85; // 高租金档
  if (!full && next < 100) need = Math.max(need, 300); // 弱地段低档位，不急
  return left >= Math.max(80, need);
}

/** 升级价值评分：每被踩一次的增收 / 升级费，集齐同组翻倍（用于 upgradeAny 挑最值的一块） */
function upgradeScore(state: GameState, data: GameData, me: Player, cellId: number): number {
  const board = data.board;
  const cell = board.cells[cellId];
  const o = state.owned[cellId];
  const rents = cell.rents ?? [];
  const gain = (rents[Math.min(o.level + 1, rents.length - 1)] ?? 0) - (rents[o.level] ?? 0);
  const full = !!cell.group && ownsWholeGroup(board, state.owned, me.id, cell.group);
  return (gain * (full ? 2 : 1)) / Math.max(1, upgradeCostOf(board, state.modifiers, cellId));
}

/** 掷骰前远程升级（DESIGN 10.1）：在通过储备检查的基建里挑评分最高的一块 */
function pickUpgradeAny(state: GameState, data: GameData, me: Player): GameAction | null {
  if (!canUpgradeAny(state, me.id, data.board)) return null;
  const best = upgradeAnyTargets(data.board, state, me.id)
    .filter((c) => shouldUpgrade(state, data, me, c))
    .map((c) => ({ c, score: upgradeScore(state, data, me, c) }))
    .sort((a, b) => b.score - a.score || a.c - b.c)[0];
  return best ? { type: 'upgradeAny', cellId: best.c } : null;
}

/** 掷骰前尝试使用一个道具；返回 null 表示不用 */
function pickItemAction(state: GameState, data: GameData, me: Player): GameAction | null {
  const has = (id: ItemId) => me.items.includes(id);
  const targets = (id: ItemId) => itemTargets(data.board, state, me.id, id, itemRange(data, id));
  const opps = opponents(state, me);
  const leader = [...opps].sort((a, b) => b.netWorth - a.netWorth)[0];
  const bagFull = me.items.length >= 5;

  // 导弹：打对手最高等级建筑（同级打领先者 / 租金高的）
  if (has('missile')) {
    const cells = targets('missile').cells;
    if (cells.length) {
      const best = cells
        .map((c) => ({
          c,
          lv: state.owned[c].level,
          lead: state.owned[c].owner === leader?.id ? 1 : 0,
          rent: rentAt(state, data, c),
        }))
        .sort((a, b) => b.lv - a.lv || b.lead - a.lead || b.rent - a.rent)[0];
      if (best.lv >= 2 || bagFull || best.rent >= 200) return { type: 'useItem', itemId: 'missile', target: { cellId: best.c } };
    }
  }

  // 乌龟：给离自己高价地最近的对手（正好 1 格 → 必中；否则让其在雷区多停留一回合）
  if (has('turtle')) {
    const ps = targets('turtle').players;
    let best: { id: string; score: number } | null = null;
    for (const pid of ps) {
      const p = state.players.find((x) => x.id === pid)!;
      if (p.inJail) continue;
      let score = 0;
      for (let d = 1; d <= 12; d++) {
        const c = wrapPos(p.pos + d);
        if (!isMyCell(state, me, c)) continue;
        const r = rentAt(state, data, c);
        score += d === 1 ? r * 1.5 : r * (13 - d) / 24;
      }
      if (!best || score > best.score) best = { id: pid, score };
    }
    if (best && (best.score >= 120 || (bagFull && best.score > 0))) return { type: 'useItem', itemId: 'turtle', target: { playerId: best.id } };
    if (bagFull && leader && ps.includes(leader.id)) return { type: 'useItem', itemId: 'turtle', target: { playerId: leader.id } };
  }

  if (me.inJail) return null; // 以下道具在监管中意义不大（不移动）

  // 路障：放在对手必经的、自己的高租金格上（对手走到就停下交费；自己踩到还能升级）
  if (has('roadblock')) {
    let best: { c: number; score: number } | null = null;
    for (const c of targets('roadblock').cells) {
      if (!isMyCell(state, me, c)) continue;
      const rent = rentAt(state, data, c);
      let score = 0;
      for (const p of opps) {
        if (p.inJail) continue;
        const d = wrapPos(c - p.pos);
        if (d >= 1 && d <= 12) score += rent * (d <= 7 ? 1 : 0.6);
      }
      // 自己踩到也能升级
      const o = state.owned[c];
      if (data.board.cells[c].type === 'property' && o.level < 5) score += 40;
      if (!best || score > best.score) best = { c, score };
    }
    if (best && (best.score >= 100 || bagFull)) return { type: 'useItem', itemId: 'roadblock', target: { cellId: best.c } };
  }

  const eNow = expectedCost(state, data, me, me.pos);

  // 护盾：前方 12 格内有对手高租金格
  if (has('shield') && !me.shield) {
    const m = maxRentAhead(state, data, me, me.pos);
    if (m >= Math.max(150, me.money * 0.15) || (bagFull && m > 0)) return { type: 'useItem', itemId: 'shield' };
  }

  // 跳板机：前方危险时逃回自己最安全（最好还能顺路收益）的地
  if (has('teleport') && !me.shield) {
    const danger = eNow >= Math.max(60, me.money * 0.05) || maxRentAhead(state, data, me, me.pos) >= Math.max(300, me.money * 0.3);
    if (danger) {
      const cells = targets('teleport').cells;
      if (cells.length) {
        const safest = cells.map((c) => ({ c, e: expectedCost(state, data, me, c) })).sort((a, b) => a.e - b.e)[0];
        if (safest.e < eNow * 0.5) return { type: 'useItem', itemId: 'teleport', target: { cellId: safest.c } };
      } else if (expectedCost(state, data, me, 0) < eNow * 0.5) {
        return { type: 'useItem', itemId: 'teleport' };
      }
    }
  }

  // 火箭：+6 后期望花费明显更低时用
  if (has('rocket') && !me.rocket && !me.shield) {
    const eRocket = expectedCost(state, data, me, me.pos, 6);
    if ((eNow >= 30 && eRocket < eNow * 0.6) || (bagFull && eRocket <= eNow)) return { type: 'useItem', itemId: 'rocket' };
  }

  return null;
}

/**
 * 给出机器人此刻的一个动作；不是它的回合返回 null。
 * 保证返回的动作在当前状态下合法（否则 room 会退回 defaultAction）。
 * rng 参数保留以兼容调用方（目前策略是确定性的）。
 */
export function decideBotAction(state: GameState, data: GameData, playerId: string, _rng?: RandomFn): GameAction | null {
  if (state.phase !== 'playing' || state.currentPlayerId !== playerId) return null;
  const me = state.players.find((p) => p.id === playerId);
  if (!me || me.bankrupt) return null;
  const pending = state.pending;
  const board = data.board;

  switch (pending?.type) {
    case 'buy':
      return shouldBuy(state, data, me, pending.cellId) ? { type: 'buy' } : { type: 'skipBuy' };
    case 'upgrade':
      return shouldUpgrade(state, data, me, pending.cellId) ? { type: 'upgrade' } : { type: 'skipUpgrade' };
    case 'card':
      return { type: 'ackCard' };
    case 'jail': {
      const up = pickUpgradeAny(state, data, me);
      if (up) return up;
      const item = pickItemAction(state, data, me);
      if (item) return item;
      if (me.items.includes('jailfree')) return { type: 'useJailCard' };
      // 钱多就付费出来（早点出去买地 / 踩自己的地升级）；钱紧就赖着掷骰
      const reserve = cashReserve(state, data, me);
      if (me.money >= board.jailFine + reserve) return { type: 'payJail' };
      return { type: 'rollJail' };
    }
    default:
      break;
  }

  if (state.turnPhase !== 'preRoll') return defaultAction(state);

  // 钱多时赎回抵押（优先赎回能收费的贵地）
  const reserve = cashReserve(state, data, me);
  const mortgaged = Object.entries(state.owned)
    .filter(([, o]) => o.owner === me.id && o.mortgaged)
    .map(([k]) => Number(k))
    .sort((a, b) => (board.cells[b].price ?? 0) - (board.cells[a].price ?? 0));
  for (const c of mortgaged) {
    if (me.money - unmortgageCost(board.cells[c]) >= reserve + 100) return { type: 'unmortgage', cellId: c };
  }

  return pickUpgradeAny(state, data, me) ?? pickItemAction(state, data, me) ?? { type: 'roll' };
}

/** 估算一批事件在客户端播放动画的时长（ms），用于让机器人 / 超时等待动画播完 */
export function estimateAnimMs(events: readonly GameEvent[]): number {
  let ms = 0;
  for (const e of events) {
    switch (e.type) {
      case 'dice':
        ms += 1400; // 骰子翻滚 ≥0.9s + 落定停顿 + 点数展示
        break;
      case 'move':
        ms += e.teleport ? 500 : 180 * e.path.length + 250;
        break;
      case 'card':
        ms += 2600;
        break;
      case 'turnStart':
      case 'roadblockHit':
      case 'buy':
      case 'tax':
        ms += 600;
        break;
      case 'upgrade':
      case 'downgrade':
      case 'modifier':
      case 'pot':
      case 'item':
      case 'itemGain':
      case 'rent':
        ms += 800;
        break;
      case 'jail':
      case 'jailExit':
        ms += 1000;
        break;
      case 'bankrupt':
        ms += 1500;
        break;
      default:
        break;
    }
  }
  return Math.min(ms, 15000);
}

