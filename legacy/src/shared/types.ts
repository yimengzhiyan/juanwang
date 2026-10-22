// 《大玩家》共享类型 —— 以 docs/DESIGN.md 第 4 节、5.1 节为准，引擎 / 客户端 / 数据三方共用。
// 这里只放纯类型与常量，前端（Vite）与服务端（Node）都可直接 import。

/* ========================= 静态数据 ========================= */

export type CellType =
  | 'start'
  | 'property'
  | 'compute'
  | 'utility'
  | 'chance'
  | 'fate'
  | 'tax'
  | 'jail'
  | 'gotojail'
  | 'free';

export interface Cell {
  id: number; // 0..39，顺时针，0 在右下角（经典布局）
  type: CellType;
  name: string; // 显示名（≤6 个汉字最佳）
  short?: string; // 短名（≤3 字），手机端 / 桌面端长名时显示（DESIGN 9.1）
  desc?: string; // 一句话戏仿说明
  group?: string; // property 时的颜色组 id
  price?: number; // property/compute/utility 购买价
  rents?: number[]; // property: 长度 6 [lv0,lv1,lv2,lv3,lv4,旗舰]
  upgradeCost?: number; // property: 每级升级费（旗舰也按此）
  tax?: number; // tax
  icon?: string; // 可选图标文件名（client/public/assets/cells/）
}

export type GroupId = 'brown' | 'lightblue' | 'pink' | 'orange' | 'red' | 'yellow' | 'green' | 'darkblue';

export interface ColorGroup {
  id: string;
  name: string;
  color: string; // #hex
  cells: number[];
}

export interface BoardData {
  cells: Cell[];
  groups: ColorGroup[];
  startBonus: number;
  jailFine: number;
}

export type ItemId = 'roadblock' | 'missile' | 'rocket' | 'turtle' | 'shield' | 'teleport' | 'jailfree';

/** 卡牌效果（DESIGN.md 3.5） */
export type CardEffect =
  | { type: 'money'; amount: number } // 正负 Token（负数不够则清算）
  | { type: 'moneyFromEach'; amount: number } // 每位其他玩家给你 amount（可为负=你给每人）
  | { type: 'moveTo'; cellId: number; collectStart?: boolean } // 移到某格（经过融资轮是否发钱）
  | { type: 'moveBy'; steps: number } // 前进/后退 n 格（负数后退，不经融资轮）
  | { type: 'gotoJail' }
  | { type: 'item'; itemId: ItemId } // 获得道具
  | { type: 'repairs'; perLevel: number; perFlagship: number } // 按建筑交维护费
  | { type: 'nearest'; cellType: 'compute' | 'utility'; rentMul: number } // 到最近算力/公用，若有主则按倍数付费
  | { type: 'rentMod'; factor: number; rounds: number } // 全局 API 调用费倍率，持续 n 轮
  | { type: 'upgradeCostMod'; factor: number; rounds: number } // 全局升级费倍率
  | { type: 'downgradeAll'; levels: number } // 所有玩家所有建筑降级
  | { type: 'levelUpRandom' } // 自己随机一块基建 +1 级
  | { type: 'swapPosition'; with: 'random' } // 与随机对手换位置
  | { type: 'potToPlayer' }; // 拿走奖池

export type CardEffectType = CardEffect['type'];

export interface Card {
  id: string;
  deck: 'chance' | 'fate';
  title: string;
  text: string;
  effect: CardEffect;
  icon?: string;
}

export interface CharacterLines {
  roll: string[];
  buy: string[];
  rent: string[];
  pay: string[];
  jail: string[];
  bankrupt: string[];
  win: string[];
}

export interface Character {
  id: string;
  name: string; // 显示名（外号 / 娘化名）
  title: string; // 头衔，如"闭源教父"
  flavor: string; // 一句人设
  color: string; // 棋子主色 #hex
  avatar: string; // 'characters/<id>.png' 若存在则用，否则回退 'characters/<id>.svg'
  lines: CharacterLines; // 每项 2~3 条短语
}

export type ItemTargetKind = 'none' | 'cellAhead' | 'enemyPropertyAhead' | 'player' | 'ownProperty';

export interface Item {
  id: string;
  name: string;
  desc: string;
  icon: string;
  targetKind: ItemTargetKind;
  range?: number;
}

export interface DiceSkin {
  id: string;
  name: string;
  desc: string;
}

/** 全部静态数据（服务端启动时加载，随 welcome 下发给客户端） */
export interface GameData {
  board: BoardData;
  cards: Card[];
  characters: Character[];
  items: Item[];
  diceSkins: DiceSkin[];
}

/** 固定角色 ID（DESIGN.md 第 4 节） */
export const CHARACTER_IDS = [
  'altman',
  'liang',
  'huang',
  'musk',
  'zuck',
  'dario',
  'ilya',
  'lecun',
  'deepseek_chan',
  'claude_chan',
  'gpt_chan',
  'gemini_chan',
  'qwen_chan',
  'doubao_chan',
] as const;

/** 固定棋盘结构（位置与类型不可变） */
export const BOARD_LAYOUT: readonly { type: CellType; group?: GroupId }[] = [
  { type: 'start' },
  { type: 'property', group: 'brown' },
  { type: 'fate' },
  { type: 'property', group: 'brown' },
  { type: 'tax' },
  { type: 'compute' },
  { type: 'property', group: 'lightblue' },
  { type: 'chance' },
  { type: 'property', group: 'lightblue' },
  { type: 'property', group: 'lightblue' },
  { type: 'jail' },
  { type: 'property', group: 'pink' },
  { type: 'utility' },
  { type: 'property', group: 'pink' },
  { type: 'property', group: 'pink' },
  { type: 'compute' },
  { type: 'property', group: 'orange' },
  { type: 'fate' },
  { type: 'property', group: 'orange' },
  { type: 'property', group: 'orange' },
  { type: 'free' },
  { type: 'property', group: 'red' },
  { type: 'chance' },
  { type: 'property', group: 'red' },
  { type: 'property', group: 'red' },
  { type: 'compute' },
  { type: 'property', group: 'yellow' },
  { type: 'property', group: 'yellow' },
  { type: 'utility' },
  { type: 'property', group: 'yellow' },
  { type: 'gotojail' },
  { type: 'property', group: 'green' },
  { type: 'property', group: 'green' },
  { type: 'fate' },
  { type: 'property', group: 'green' },
  { type: 'compute' },
  { type: 'chance' },
  { type: 'property', group: 'darkblue' },
  { type: 'tax' },
  { type: 'property', group: 'darkblue' },
];

export const BOARD_SIZE = 40;
export const START_CELL = 0;
export const JAIL_CELL = 10;
export const GOTO_JAIL_CELL = 30;
export const MAX_ITEMS = 6;
export const MAX_LEVEL = 5; // 5 = 旗舰 (AGI)
export const COMPUTE_RENTS = [25, 50, 100, 200] as const;
export const UTILITY_MUL_ONE = 4;
export const UTILITY_MUL_BOTH = 10;
export const MORTGAGE_INTEREST = 1.1; // 赎回 = 抵押值 × 110%
export const JAIL_MAX_TURNS = 3; // 第 3 次尝试仍失败则强制付费出狱
export const LOG_LIMIT = 50;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
/** maxRounds=0（不限）时的兜底：超过这么多轮仍未分出胜负则按身价结算 */
export const UNLIMITED_ROUND_CAP = 200;

/* ========================= 房间设置 ========================= */

export interface GameSettings {
  startMoney: number; // 默认 1500
  maxRounds: number; // 默认 30，0 = 不限
  turnTimeoutSec: number; // 默认 45，0 = 不限
}

export const DEFAULT_SETTINGS: GameSettings = {
  startMoney: 1500,
  maxRounds: 30,
  turnTimeoutSec: 45,
};

/** 设置的合法范围（服务端会把越界值夹到范围内） */
export const SETTINGS_LIMITS = {
  startMoney: { min: 500, max: 10000 },
  maxRounds: { min: 0, max: 200 },
  turnTimeoutSec: { min: 0, max: 300, minNonZero: 10 },
} as const;

/* ========================= 对局状态 ========================= */

export interface Player {
  id: string;
  name: string;
  characterId: string;
  color: string;
  money: number;
  pos: number;
  inJail: boolean;
  jailTurns: number; // 在监管审查中已尝试掷骰的次数
  items: ItemId[];
  bankrupt: boolean;
  connected: boolean;
  isBot: boolean; // 原生机器人（掉线真人不会变成 isBot，而是 connected=false 由机器人托管）
  shield: boolean; // 防火墙护盾
  turtle: boolean; // 被限流乌龟标记：下次掷骰固定为 1
  rocket: boolean; // 火箭加速：本回合掷骰 +6
  netWorth: number; // 身价（服务端每步重算）
  diceSkin?: string; // 骰子皮肤（纯外观，扩展字段）
}

export interface Owned {
  owner: string;
  level: number; // 0-5，5 = 旗舰
  mortgaged: boolean;
}

export type TurnPhase = 'preRoll' | 'moving' | 'landed' | 'postRoll';

export type PendingDecision =
  | null
  | { type: 'buy'; cellId: number }
  | { type: 'upgrade'; cellId: number }
  | { type: 'card'; card: Card }
  | { type: 'jail' };

export interface Modifiers {
  rentFactor: number;
  rentRounds: number;
  upgradeFactor: number;
  upgradeRounds: number;
}

export interface RankEntry {
  playerId: string;
  netWorth: number;
}

export interface GameState {
  phase: 'playing' | 'ended';
  round: number; // 从 1 开始
  turnIndex: number; // players 数组下标
  currentPlayerId: string;
  turnPhase: TurnPhase;
  players: Player[];
  owned: Record<number, Owned>;
  roadblocks: number[];
  pot: number;
  dice: [number, number] | null; // 最近一次掷骰
  doublesCount: number; // 本回合连续双骰次数（掷出非双骰时归 0）
  pending: PendingDecision;
  modifiers: Modifiers;
  log: string[]; // 最近 50 条
  winnerId?: string;
  ranking?: RankEntry[];
  // ---- 以下为扩展字段（DESIGN.md 未列出，客户端可用） ----
  settings: GameSettings;
  decks: { chance: string[]; fate: string[] }; // 剩余牌堆（卡牌 id 队列，抽完重洗）
  turnDeadline: number | null; // 当前决策超时的时间戳（ms，服务器时钟），null = 不限时
  turnCount: number; // 已开始的回合总数（每个玩家每个回合 +1）
  upgradedThisTurn: boolean; // 本回合是否已用过 upgradeAny（DESIGN 10.1，每回合最多 1 次）
}

/* ========================= 事件 ========================= */

export type JailExitHow = 'pay' | 'card' | 'doubles' | 'forced';

export type GameEvent =
  | { type: 'turnStart'; playerId: string; round: number }
  | {
      type: 'dice';
      playerId: string;
      dice: [number, number];
      total: number;
      doubles: boolean;
      rocket?: true;
      turtle?: true;
      jail?: true; // 监管审查中的出狱掷骰
    }
  | {
      type: 'move';
      playerId: string;
      from: number;
      to: number;
      path: number[]; // 依次经过的格子（不含 from，含 to）；teleport 时为 [to]
      passedStart: boolean;
      teleport?: true; // 瞬移（进监管、跳板机、换位置），无逐格动画
      backward?: true; // 后退
    }
  | { type: 'roadblockHit'; playerId: string; cellId: number }
  | { type: 'money'; playerId: string; delta: number; reason: string; balance: number }
  | { type: 'buy'; playerId: string; cellId: number; price: number }
  | { type: 'rent'; fromId: string; toId: string; cellId: number; amount: number; shielded: boolean }
  | { type: 'upgrade'; playerId: string; cellId: number; level: number; cost: number; free?: true; remote?: true }
  | { type: 'downgrade'; cellId: number; level: number; byId?: string; reason?: 'missile' | 'card' | 'liquidate' }
  | { type: 'card'; playerId: string; card: Card }
  | { type: 'tax'; playerId: string; amount: number; pot: number }
  | { type: 'pot'; playerId: string; amount: number }
  | { type: 'jail'; playerId: string }
  | { type: 'jailExit'; playerId: string; how: JailExitHow }
  | { type: 'item'; playerId: string; itemId: ItemId; targetCellId?: number; targetPlayerId?: string }
  | { type: 'itemGain'; playerId: string; itemId: ItemId; discarded: boolean }
  | { type: 'mortgage'; playerId: string; cellId: number; on: boolean; amount: number }
  | { type: 'modifier'; kind: 'rent' | 'upgrade'; factor: number; rounds: number }
  | { type: 'bankrupt'; playerId: string; creditorId?: string }
  | { type: 'gameOver'; winnerId: string; ranking: RankEntry[] }
  | { type: 'log'; text: string };

export type GameEventType = GameEvent['type'];

/* ========================= 动作 ========================= */

export interface ItemTarget {
  cellId?: number;
  playerId?: string;
}

export type GameAction =
  | { type: 'roll' }
  | { type: 'buy' }
  | { type: 'skipBuy' }
  | { type: 'upgrade' }
  | { type: 'skipUpgrade' }
  | { type: 'upgradeAny'; cellId: number } // preRoll（含监管中）远程升级任意自己的基建，每回合 1 次
  | { type: 'ackCard' }
  | { type: 'useItem'; itemId: ItemId; target?: ItemTarget }
  | { type: 'payJail' }
  | { type: 'useJailCard' }
  | { type: 'rollJail' }
  | { type: 'mortgage'; cellId: number }
  | { type: 'unmortgage'; cellId: number };

export type GameActionType = GameAction['type'];
