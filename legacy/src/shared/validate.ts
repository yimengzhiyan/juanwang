// 静态数据校验（纯函数，前后端都可用）。
import { BOARD_LAYOUT, BOARD_SIZE, type Card, type GameData, type ItemId } from './types.js';

const ITEM_IDS: readonly ItemId[] = ['roadblock', 'missile', 'rocket', 'turtle', 'shield', 'teleport', 'jailfree'];
const CELL_TYPES = ['start', 'property', 'compute', 'utility', 'chance', 'fate', 'tax', 'jail', 'gotojail', 'free'];

export class GameDataError extends Error {
  constructor(public readonly problems: string[]) {
    super(`游戏数据校验失败（${problems.length} 处）：\n- ${problems.join('\n- ')}`);
    this.name = 'GameDataError';
  }
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** 若 JSON 顶层是 {xxx: [...]} 这种单数组包装，自动解包 */
function unwrapArray(raw: unknown): unknown {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const arrays = Object.values(raw).filter(Array.isArray);
    if (arrays.length === 1) return arrays[0];
  }
  return raw;
}

function checkEffect(card: Card, p: string[]): void {
  const e = card.effect as unknown as Record<string, unknown> | undefined;
  const at = `卡牌 ${card.id}`;
  if (!e || typeof e !== 'object') return void p.push(`${at}: 缺少 effect`);
  switch (e.type) {
    case 'money':
    case 'moneyFromEach':
      if (!isNum(e.amount)) p.push(`${at}: amount 应为数字`);
      break;
    case 'moveTo':
      if (!isNum(e.cellId) || e.cellId < 0 || e.cellId >= BOARD_SIZE) p.push(`${at}: cellId 越界`);
      break;
    case 'moveBy':
      if (!isNum(e.steps) || e.steps === 0) p.push(`${at}: steps 应为非 0 数字`);
      break;
    case 'item':
      if (!ITEM_IDS.includes(e.itemId as ItemId)) p.push(`${at}: 未知道具 ${String(e.itemId)}`);
      break;
    case 'repairs':
      if (!isNum(e.perLevel) || !isNum(e.perFlagship)) p.push(`${at}: perLevel/perFlagship 应为数字`);
      break;
    case 'nearest':
      if (e.cellType !== 'compute' && e.cellType !== 'utility') p.push(`${at}: cellType 应为 compute/utility`);
      if (!isNum(e.rentMul)) p.push(`${at}: rentMul 应为数字`);
      break;
    case 'rentMod':
    case 'upgradeCostMod':
      if (!isNum(e.factor) || e.factor < 0) p.push(`${at}: factor 应为非负数字`);
      if (!isNum(e.rounds) || e.rounds < 1) p.push(`${at}: rounds 应 ≥ 1`);
      break;
    case 'downgradeAll':
      if (!isNum(e.levels) || e.levels < 1) p.push(`${at}: levels 应 ≥ 1`);
      break;
    case 'gotoJail':
    case 'levelUpRandom':
    case 'swapPosition':
    case 'potToPlayer':
      break;
    default:
      p.push(`${at}: 未知效果类型 ${String(e.type)}`);
  }
}

/**
 * 校验并规范化原始 JSON，返回 GameData；有问题抛 GameDataError（列出全部问题）。
 */
export function validateGameData(raw: {
  board: unknown;
  cards: unknown;
  characters: unknown;
  items: unknown;
  diceSkins: unknown;
}): GameData {
  const p: string[] = [];
  const board = raw.board as GameData['board'];
  const cards = unwrapArray(raw.cards) as Card[];
  const characters = unwrapArray(raw.characters) as GameData['characters'];
  const items = unwrapArray(raw.items) as GameData['items'];
  const diceSkins = unwrapArray(raw.diceSkins) as GameData['diceSkins'];

  // ---- 棋盘 ----
  if (!board || !Array.isArray(board.cells)) {
    p.push('board.cells 缺失');
  } else {
    if (board.cells.length !== BOARD_SIZE) p.push(`board.cells 应有 ${BOARD_SIZE} 格，实际 ${board.cells.length}`);
    board.cells.forEach((c, i) => {
      const at = `格子 ${i}`;
      const expect = BOARD_LAYOUT[i];
      if (c.id !== i) p.push(`${at}: id 应为 ${i}`);
      if (!CELL_TYPES.includes(c.type)) p.push(`${at}: 未知类型 ${c.type}`);
      if (expect && c.type !== expect.type) p.push(`${at}: 类型应为 ${expect.type}，实际 ${c.type}`);
      if (!isStr(c.name)) p.push(`${at}: 缺少 name`);
      if (c.type === 'property') {
        if (expect?.group && c.group !== expect.group) p.push(`${at}: group 应为 ${expect.group}`);
        if (!isNum(c.price) || c.price <= 0) p.push(`${at}: price 无效`);
        if (!Array.isArray(c.rents) || c.rents.length !== 6 || !c.rents.every(isNum)) p.push(`${at}: rents 应为长度 6 的数字数组`);
        if (!isNum(c.upgradeCost) || c.upgradeCost <= 0) p.push(`${at}: upgradeCost 无效`);
      }
      if ((c.type === 'compute' || c.type === 'utility') && (!isNum(c.price) || c.price <= 0)) p.push(`${at}: price 无效`);
      if (c.type === 'tax' && (!isNum(c.tax) || c.tax < 0)) p.push(`${at}: tax 无效`);
    });
    if (!Array.isArray(board.groups)) p.push('board.groups 缺失');
    else {
      for (const g of board.groups) {
        const expected = BOARD_LAYOUT.map((l, i) => (l.group === g.id ? i : -1)).filter((i) => i >= 0);
        if (expected.length === 0) p.push(`颜色组 ${g.id}: 未知组`);
        else if (!Array.isArray(g.cells) || [...g.cells].sort((a, b) => a - b).join() !== expected.join())
          p.push(`颜色组 ${g.id}: cells 应为 ${expected.join(',')}`);
      }
      for (const gid of new Set(BOARD_LAYOUT.map((l) => l.group).filter(Boolean))) {
        if (!board.groups.some((g) => g.id === gid)) p.push(`缺少颜色组 ${gid}`);
      }
    }
    if (!isNum(board.startBonus)) p.push('board.startBonus 无效');
    if (!isNum(board.jailFine)) p.push('board.jailFine 无效');
  }

  // ---- 卡牌 ----
  if (!Array.isArray(cards)) p.push('cards 应为数组');
  else {
    const ids = new Set<string>();
    for (const c of cards) {
      if (!isStr(c.id)) p.push('卡牌缺少 id');
      else if (ids.has(c.id)) p.push(`卡牌 id 重复：${c.id}`);
      ids.add(c.id);
      if (c.deck !== 'chance' && c.deck !== 'fate') p.push(`卡牌 ${c.id}: deck 应为 chance/fate`);
      if (!isStr(c.title)) p.push(`卡牌 ${c.id}: 缺少 title`);
      checkEffect(c, p);
    }
    if (!cards.some((c) => c.deck === 'chance')) p.push('没有热搜（chance）卡');
    if (!cards.some((c) => c.deck === 'fate')) p.push('没有突发（fate）卡');
  }

  // ---- 角色 ----
  if (!Array.isArray(characters) || characters.length === 0) p.push('characters 应为非空数组');
  else
    for (const ch of characters) {
      if (!isStr(ch.id) || !isStr(ch.name)) p.push(`角色缺少 id/name：${JSON.stringify(ch).slice(0, 60)}`);
      if (!isStr(ch.color)) p.push(`角色 ${ch.id}: 缺少 color`);
    }

  // ---- 道具 ----
  if (!Array.isArray(items)) p.push('items 应为数组');
  else
    for (const id of ITEM_IDS) {
      if (!items.some((it) => it.id === id)) p.push(`缺少道具定义 ${id}`);
    }

  if (!Array.isArray(diceSkins)) p.push('diceSkins 应为数组');

  if (p.length) throw new GameDataError(p);
  return { board, cards, characters, items, diceSkins };
}
