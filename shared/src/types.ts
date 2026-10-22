// 《卷王自走棋》共享类型（DESIGN.md 第 4 节为准，细节决定见 docs/ENGINE_NOTES.md）。
// 纯类型文件：前端、服务端、测试都可以直接 import。

export type Faction = 'open' | 'closed' | 'compute' | 'folk';
export const FACTIONS: readonly Faction[] = ['open', 'closed', 'compute', 'folk'];
export type Tier = 1 | 2 | 3 | 4 | 5 | 6;
export type Level = 1 | 2 | 3;
export type Side = 'me' | 'enemy';

// ───────────────────────── 技能 ─────────────────────────

export const TRIGGERS = [
  'startBattle', 'beforeAttack', 'hurt', 'faint', 'friendFaint', 'kill',
  'friendSummoned', 'buy', 'sell', 'levelUp', 'friendBought',
  'startTurn', 'endTurn', 'eatItem', 'enemySummoned', 'hurtFront',
] as const;
export type Trigger = (typeof TRIGGERS)[number];

/** 在战斗中生效的触发器（其余在商店阶段生效） */
export const BATTLE_TRIGGERS: readonly Trigger[] = [
  'startBattle', 'beforeAttack', 'hurt', 'faint', 'friendFaint', 'kill', 'friendSummoned', 'enemySummoned', 'hurtFront',
];
/** 在商店阶段生效的触发器 */
export const SHOP_TRIGGERS: readonly Trigger[] = ['buy', 'sell', 'levelUp', 'friendBought', 'startTurn', 'endTurn', 'eatItem'];
/** friendSummoned 同时在战斗和商店（基建/技能召唤）中生效 */

export const EFFECTS = [
  'damage', 'buff', 'shield', 'summon', 'copyStats', 'swapPosition', 'gold', 'destroy',
  'heal', 'reroll', 'discount', 'pushBack', 'pullFront', 'multiAttack',
] as const;
export type Effect = (typeof EFFECTS)[number];

export const TARGETS = [
  'self', 'frontFriend', 'backFriend', 'adjacentFriends', 'randomFriend', 'allFriends', 'lowestHpFriend',
  'frontEnemy', 'backEnemy', 'randomEnemy', 'allEnemies', 'lowestHpEnemy', 'highestAtkEnemy',
  'killer', 'summoned', 'boughtUnit',
] as const;
/** randomFriend / randomEnemy 的数量写在 Ability.n（JSON 里也可写 "randomFriend(2)"，校验时会规范化） */
export type Target = (typeof TARGETS)[number];
export const ENEMY_TARGETS: readonly Target[] = ['frontEnemy', 'backEnemy', 'randomEnemy', 'allEnemies', 'lowestHpEnemy', 'highestAtkEnemy'];

/** 目标筛选（DESIGN 11.1）：候选单位先按条件过滤再选 */
export interface TargetFilter { faction?: Faction; minTier?: number; maxTier?: number }

/** 随机形态（DESIGN 11.8）：触发时从 choices 里等概率选一个，覆盖到基础技能上再结算 */
export type AbilityChoice = Partial<Omit<Ability, 'trigger' | 'choices'>>;

export interface Ability {
  trigger: Trigger;
  effect: Effect;
  target: Target;
  /** 主数值：damage/shield/heal/gold/reroll/discount 的量；buff 未写 atk/hp 时攻血都 +amount；multiAttack 的总攻击次数 */
  amount?: number;
  /** buff / copyStats 专用：分别加攻、加血（写了任一个就不再用 amount） */
  atk?: number;
  hp?: number;
  /** buff：是否永久（商店阶段写到 atk/hp；战斗中记到 BattleResult.permanentBuffs，赛后写回我方队伍） */
  permanent?: boolean;
  /** 等级缩放：Lv2 ×2、Lv3 ×3。缺省 true（multiAttack 缺省 false） */
  perLevel?: boolean;
  /** randomFriend / randomEnemy 选几个，缺省 1 */
  n?: number;
  /** summon 召唤的单位 id（缺省 token_shuijun） */
  unitId?: string;
  /** summon 召唤几个，缺省 1 */
  count?: number;
  /** 目标筛选：阵营 / 阶级范围 */
  filter?: TargetFilter;
  /** copyStats：复制后吞并目标（目标移除），属性 = 两者较高值 + amount（缺省 0，按等级缩放） */
  consume?: boolean;
  /** destroy：仅当目标当前血量 ≤ 阈值时直接击杀，否则改为造成"阈值"点伤害 */
  maxHp?: number;
  /** destroy 阈值每级增加多少（缺省 0）：阈值 = maxHp + (level-1) × maxHpPerLevel */
  maxHpPerLevel?: number;
  /** 随机形态：触发时等概率选一个覆盖到本技能上（例如 GPT 娘回合开始随机 +2 攻 / +2 血 / 降价） */
  choices?: AbilityChoice[];
  /** 一句话描述，客户端直接显示 */
  desc: string;
}

export interface UnitDef {
  id: string;
  name: string;
  tier: Tier;
  faction: Faction;
  atk: number;
  hp: number;
  ability?: Ability;
  /** 1~3 条台词，开战/击杀/阵亡时冒泡 */
  lines?: string[];
  /** 'characters/<id>.png' 或 'units/<id>.svg'（相对素材根目录，URL = '/' + avatar） */
  avatar: string;
  /** 召唤物，不进商店 */
  token?: boolean;
}

// ───────────────────────── 基建 ─────────────────────────

export type ItemEffect =
  | { type: 'buff'; atk: number; hp: number; permanent: boolean }
  | { type: 'shield'; amount: number }
  | { type: 'copyStatsFrom' }
  | { type: 'levelUp' }
  | { type: 'gold'; amount: number }
  | { type: 'summonToken'; unitId: string }
  | { type: 'teamBuff'; atk: number; hp: number; permanent: boolean }
  | { type: 'pullFront' }
  | { type: 'transformRandomSameTier' };
export type ItemEffectType = ItemEffect['type'];

export interface ItemDef {
  id: string;
  name: string;
  desc: string;
  price: number;
  targetKind: 'unit' | 'team';
  effect: ItemEffect;
  icon: string;
  tier: 1 | 2 | 3;
}

// ───────────────────────── 头条 / 突发 ─────────────────────────

export type EventEffect =
  | { type: 'gold'; amount: number }
  /** target 缺省 'unit'；amount 正数涨价、负数降价 */
  | { type: 'priceMod'; target: 'unit' | 'item' | 'all'; amount: number }
  | { type: 'freeUnit'; faction?: Faction; tier?: Tier }
  | { type: 'buffTeam'; atk: number; hp: number; permanent: boolean }
  | { type: 'buffFaction'; faction: Faction; atk: number; hp: number; permanent: boolean }
  | { type: 'shopRerollFree' }
  | { type: 'extraSlot'; amount: number }
  | { type: 'shieldAll'; amount: number }
  | { type: 'swapAll' }
  | { type: 'duplicate' }
  | { type: 'sacrifice'; amount: number }
  | { type: 'nextTurnGold'; amount: number }
  | { type: 'enemyDebuff'; amount: number }
  | { type: 'rerollShop' }
  | { type: 'levelUpRandom' }
  | { type: 'lifeTrade'; amount: number };
export type EventEffectType = EventEffect['type'];

/** effect = 第一个效果（兼容旧数据）；effects = 全部效果，按顺序结算（validateData 后总是存在） */
export interface HeadlineOption { label: string; effect: EventEffect; effects?: EventEffect[] }
export interface HeadlineDef {
  id: string;
  title: string;
  news: string;
  options: [HeadlineOption, HeadlineOption];
  icon?: string;
}
export interface SurpriseDef {
  id: string;
  title: string;
  news: string;
  effect: EventEffect;
  effects?: EventEffect[];
  good: boolean;
  icon?: string;
}

// ───────────────────────── 引导局 ─────────────────────────

export type TutorialStepId = 'buy' | 'buyAgain' | 'fight' | 'merge' | 'item' | 'freezeSell' | 'headline' | 'done';
export const TUTORIAL_STEPS: readonly TutorialStepId[] = ['buy', 'buyAgain', 'fight', 'merge', 'item', 'freezeSell', 'headline', 'done'];

export interface TutorialEnemyUnit { defId: string; atk?: number; hp?: number; level?: Level }
export interface TutorialTurn {
  turn: number;
  /** 本回合固定商店单位（defId，按顺序） */
  units: string[];
  /** 本回合固定商店基建（itemId） */
  items?: string[];
  /** 本回合固定对手（前排在前） */
  enemy: TutorialEnemyUnit[];
}
export interface TutorialStepText { text: string; target?: string }
export interface TutorialDef {
  seed: string;
  /** 前若干回合的固定内容（一般 3 回合） */
  turns: TutorialTurn[];
  /** 引导局的头条在哪个回合出现（替代"偶数回合"），缺省 3 */
  headlineTurn?: number;
  /** 引导局头条 id（缺省取第一张） */
  headline?: string;
  /** 每一步的气泡文案与高亮目标（客户端用） */
  steps: Partial<Record<TutorialStepId, TutorialStepText>>;
}

export interface TutorialProgress {
  buys: number;
  battles: number;
  merged: boolean;
  usedItem: boolean;
  froze: boolean;
  sold: boolean;
  headline: boolean;
}

// ───────────────────────── 数据集合 ─────────────────────────

export interface GameData {
  units: UnitDef[];
  items: ItemDef[];
  headlines: HeadlineDef[];
  surprises: SurpriseDef[];
  tutorial?: TutorialDef;
  unitsById: Record<string, UnitDef>;
  itemsById: Record<string, ItemDef>;
  /** 可进商店的单位按阶分组：shopUnitsByTier[t] */
  shopUnitsByTier: Record<number, UnitDef[]>;
}

// ───────────────────────── 局内状态 ─────────────────────────

export interface UnitInst {
  uid: string;
  defId: string;
  atk: number;
  hp: number;
  level: Level;
  /** 0..5：Lv1 = 0~1，Lv2 = 2~4，Lv3 = 5 */
  xp: number;
  /** 本回合战斗的护盾（战后清零） */
  shield: number;
  /** 本回合战斗的临时加成（战后清零） */
  tempAtk: number;
  tempHp: number;
}

export interface ShopSlot {
  kind: 'unit' | 'item';
  defId: string;
  /** 当前实际价格（已含修正，免费槽为 0） */
  price: number;
  frozen: boolean;
  /** 进化奖励 / 头条送的免费槽：价格 0，刷新不会被替换，回合结束未冻结则消失 */
  free?: boolean;
}

export interface Modifiers {
  /** 本回合单位/基建价格修正（负数为降价） */
  unitPriceMod: number;
  itemPriceMod: number;
  /** 本回合商店额外单位槽 */
  extraUnitSlots: number;
  /** 本回合刷新全部免费 */
  rerollFree: boolean;
  /** 剩余免费刷新次数（优先于花算力） */
  freeRerolls: number;
  /** 本回合战斗敌方全队攻击 -n */
  enemyAtkDebuff: number;
  /** 下回合开始时生效的加成（战斗中技能、头条 nextTurnGold 等） */
  nextTurnGold: number;
  nextFreeRerolls: number;
  nextUnitPriceMod: number;
  /** 商店阶段触发的 swapAll 次数（奇数 = 本场战斗开始时队伍反转，DESIGN 11.5） */
  battleSwapAll: number;
  /** 商店阶段触发的 pullFront：本场战斗开始时依次把这些 uid 拉到最前（最后一个最终在最前） */
  battlePullFront: string[];
}

export interface BattleRecord {
  turn: number;
  winner: 'me' | 'enemy' | 'draw';
  /** 对手名字（真人快照）或 'bot' */
  opponent?: string;
  myTeam: { defId: string; atk: number; hp: number; level: Level }[];
  enemyTeam: { defId: string; atk: number; hp: number; level: Level }[];
  trophies: number;
  lives: number;
}

export type Phase = 'headline' | 'shop' | 'battle' | 'result' | 'over';
export type EndReason = 'trophies' | 'lives' | 'turnLimit';

export interface RunState {
  seed: string;
  turn: number;
  gold: number;
  lives: number;
  trophies: number;
  /** 长度恒为 5，下标 0 = 最前排 */
  team: (UnitInst | null)[];
  shop: ShopSlot[];
  phase: Phase;
  pendingHeadline?: HeadlineDef;
  /** 最近一次突发（结算后出现，进入下一回合时生效），客户端在结算页展示 */
  lastSurprise?: SurpriseDef;
  /** lastSurprise 是否尚未生效（下一回合开始时生效后置 false） */
  surprisePending?: boolean;
  modifiers: Modifiers;
  history: BattleRecord[];
  won?: boolean;
  endReason?: EndReason;
  log: string[];
  /** 上一个 shopAction 失败的原因（成功的动作会清掉） */
  error?: string;
  /** mulberry32 内部状态（保证可重放） */
  rng: number;
  /** uid 自增计数 */
  nextUid: number;
  /** 已出现过的头条 / 突发（尽量不重复） */
  seenHeadlines: string[];
  seenSurprises: string[];
  tutorial?: TutorialProgress;
  /** 最近一次进化（客户端播放动画用）：{uid, level} */
  lastLevelUp?: { uid: string; level: Level };
}

export type ShopActionInput =
  /** slot = 商店下标；to = 队伍下标（可选：空位放入 / 同名合并；缺省优先合并到同名，否则第一个空位） */
  | { type: 'buy'; slot: number; to?: number }
  | { type: 'sell'; index: number }
  | { type: 'reroll' }
  | { type: 'freeze'; slot: number }
  | { type: 'swap'; a: number; b: number }
  /** 把队伍 from 合并进 to（同名、未满级） */
  | { type: 'merge'; from: number; to: number }
  /** unit 型基建需要 target（队伍下标）；copyStatsFrom 还要 source（被复制的单位下标） */
  | { type: 'useItem'; slot: number; target?: number; source?: number }
  | { type: 'chooseHeadline'; option: 0 | 1 }
  | { type: 'endShop' }
  /** 结算页 → 下一回合 */
  | { type: 'continue' };

// ───────────────────────── 战斗 ─────────────────────────

/** 事件里引用一个单位时的通用字段 */
export interface UnitRef {
  uid: string;
  defId: string;
  side: Side;
  /** 事件发生时在本方队列中的位置（0 = 最前排）；已移除的单位为阵亡前位置 */
  pos: number;
}
export interface UnitSnap extends UnitRef {
  atk: number;
  hp: number;
  level: Level;
  shield: number;
}

export type BattleEvent =
  | { type: 'start'; me: UnitSnap[]; enemy: UnitSnap[]; text: string }
  | { type: 'synergy'; side: Side; faction: Faction; count: number; text: string }
  | { type: 'ability'; unit: UnitRef; trigger: Trigger | 'synergy'; effect: Effect; targets: UnitRef[]; text: string }
  | { type: 'attack'; round: number; me: UnitRef & { atk: number; hits: number }; enemy: UnitRef & { atk: number; hits: number }; text: string }
  | { type: 'damage'; unit: UnitRef; source?: UnitRef; amount: number; blocked: number; hp: number; shield: number; kind: 'attack' | 'ability'; text: string }
  | { type: 'heal'; unit: UnitRef; source?: UnitRef; amount: number; hp: number; text: string }
  | { type: 'buff'; unit: UnitRef; source?: UnitRef; atk: number; hp: number; newAtk: number; newHp: number; permanent: boolean; text: string }
  | { type: 'shield'; unit: UnitRef; source?: UnitRef; amount: number; total: number; text: string }
  /** consumed = 被友军 copyStats(consume) 吞并 */
  | { type: 'faint'; unit: UnitRef; killer?: UnitRef; consumed?: boolean; text: string }
  | { type: 'summon'; unit: UnitSnap; source?: UnitRef; text: string }
  /** 位置变化：order 为该方变化后的完整队列（uid，前排在前） */
  | { type: 'move'; side: Side; unit: UnitRef; from: number; to: number; order: string[]; text: string }
  | { type: 'multiAttack'; unit: UnitRef; source?: UnitRef; hits: number; text: string }
  /** 战斗中获得的商店收益（只对 me 方有意义，赛后在下回合生效） */
  | { type: 'bonus'; side: Side; unit: UnitRef; kind: 'gold' | 'reroll' | 'discount'; amount: number; text: string }
  | { type: 'say'; unit: UnitRef; line: string; text: string }
  | { type: 'end'; winner: 'me' | 'enemy' | 'draw'; rounds: number; me: string[]; enemy: string[]; text: string };
export type BattleEventType = BattleEvent['type'];

export interface BattleOptions {
  /** 敌方全队攻击修正（头条 enemyDebuff 传负数，例如 -1） */
  enemyAtkMod?: number;
  /** 战斗开始时我方队伍反转（商店阶段的 swapAll） */
  meReverse?: boolean;
  /** 战斗开始时依次拉到最前的我方 uid（商店阶段的 pullFront） */
  mePullFront?: string[];
}

export interface BattleResult {
  winner: 'me' | 'enemy' | 'draw';
  events: BattleEvent[];
  /** 对手阵容（战前，紧凑无空位） */
  enemyTeam: UnitInst[];
  rounds: number;
  /** 战斗中触发的永久 buff（我方原队伍 uid → 增量），applyBattleResult 写回 */
  permanentBuffs: { uid: string; atk: number; hp: number }[];
  /** 战斗中我方技能产生的下回合收益 */
  bonus: { gold: number; rerolls: number; discount: number };
}
