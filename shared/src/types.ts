// 《卷王自走棋》共享类型（2.0：DESIGN.md 第 12~15 节为准，细节决定见 docs/ENGINE_NOTES.md）。
// 纯类型文件：前端、服务端、测试都可以直接 import。

export type Faction = 'open' | 'closed' | 'compute' | 'folk';
export const FACTIONS: readonly Faction[] = ['open', 'closed', 'compute', 'folk'];
/** 职业（DESIGN 12.2），单位可以没有职业 */
export type Role = 'researcher' | 'trader' | 'idol' | 'engineer';
export const ROLES: readonly Role[] = ['researcher', 'trader', 'idol', 'engineer'];
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
/** 在商店阶段生效的触发器（eatItem = 被装上装备 / 被用消耗品） */
export const SHOP_TRIGGERS: readonly Trigger[] = ['buy', 'sell', 'levelUp', 'friendBought', 'startTurn', 'endTurn', 'eatItem'];

export const EFFECTS = [
  'damage', 'buff', 'shield', 'summon', 'copyStats', 'swapPosition', 'gold', 'destroy',
  'heal', 'reroll', 'discount', 'pushBack', 'pullFront', 'multiAttack',
  // 2.0（DESIGN 13）
  'steal', 'explode', 'doubleStats', 'revive', 'chain',
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
/** 普通攻击可改写的目标（UnitDef.attackTarget / 装备「热搜」） */
export type AttackTarget = 'frontEnemy' | 'backEnemy' | 'randomEnemy' | 'lowestHpEnemy' | 'highestAtkEnemy';
export const ATTACK_TARGETS: readonly AttackTarget[] = ['frontEnemy', 'backEnemy', 'randomEnemy', 'lowestHpEnemy', 'highestAtkEnemy'];

/** 目标筛选（DESIGN 11.1）：候选单位先按条件过滤再选 */
export interface TargetFilter { faction?: Faction; role?: Role; minTier?: number; maxTier?: number }

/** 随机形态（DESIGN 11.8）：触发时从 choices 里等概率选一个，覆盖到基础技能上再结算 */
export type AbilityChoice = Partial<Omit<Ability, 'trigger' | 'choices'>>;

export interface Ability {
  trigger: Trigger;
  effect: Effect;
  target: Target;
  /** 主数值：damage/shield/heal/gold/reroll/discount 的量；buff 未写 atk/hp 时攻血都 +amount；multiAttack 的总攻击次数；
   *  revive 的复活血量（缺省 1）；explode 的伤害倍率（缺省 1 = 等于自身攻击）；chain 的追击次数（缺省 1） */
  amount?: number;
  /** buff / copyStats 专用：分别加攻、加血（写了任一个就不再用 amount） */
  atk?: number;
  hp?: number;
  /** buff：是否永久（商店阶段写到 atk/hp；战斗中记到 BattleResult.permanentBuffs，赛后写回我方队伍） */
  permanent?: boolean;
  /** 等级缩放：Lv2 ×2、Lv3 ×3。缺省 true（multiAttack / revive / chain / explode / steal / doubleStats 缺省 false） */
  perLevel?: boolean;
  /** randomFriend / randomEnemy 选几个，缺省 1 */
  n?: number;
  /** summon 召唤的单位 id（缺省 token_shuijun） */
  unitId?: string;
  /** summon 召唤几个，缺省 1 */
  count?: number;
  /** 目标筛选：阵营 / 职业 / 阶级范围 */
  filter?: TargetFilter;
  /** copyStats：复制后吞并目标（目标移除），属性 = 两者较高值 + amount（缺省 0，按等级缩放） */
  consume?: boolean;
  /** destroy：仅当目标当前血量 ≤ 阈值时直接击杀，否则改为造成"阈值"点伤害 */
  maxHp?: number;
  /** destroy 阈值每级增加多少（缺省 0）：阈值 = maxHp + (level-1) × maxHpPerLevel */
  maxHpPerLevel?: number;
  /** 随机形态：触发时等概率选一个覆盖到本技能上 */
  choices?: AbilityChoice[];
  /** 一句话描述，客户端直接显示 */
  desc: string;
}

/** 台词：general = 开战/击杀/阵亡时冒泡；onSynergy = 羁绊触发时（DESIGN 13） */
export interface UnitLines {
  general: string[];
  onSynergy?: string[];
}

export interface UnitDef {
  id: string;
  name: string;
  tier: Tier;
  faction: Faction;
  /** 职业（0~1 个） */
  role?: Role;
  atk: number;
  hp: number;
  ability?: Ability;
  /** 普通攻击目标改写（缺省 frontEnemy = 敌方最前排） */
  attackTarget?: AttackTarget;
  lines?: UnitLines;
  /** 'characters/<id>.png' 或 'units/<id>.svg'（相对素材根目录，URL = '/' + avatar） */
  avatar: string;
  /** 召唤物 / PVE 怪物，不进商店 */
  token?: boolean;
}

// ───────────────────────── 装备 / 消耗品（DESIGN 12.3） ─────────────────────────

export type EquipSlot = 'weapon' | 'armor' | 'trinket';
export const EQUIP_SLOTS: readonly EquipSlot[] = ['weapon', 'armor', 'trinket'];

/**
 * 装备效果（数据驱动，所有字段可选、可组合）。数值类字段在算力 ×3 羁绊下翻倍（概率封顶 1）。
 * 内容侧可以直接写这个结构；也可以只写 id，引擎用内置的 12 件默认效果（见 defaults.ts）。
 */
export interface EquipEffect {
  /** 静态属性（装上即计入，卸下即移除） */
  atk?: number;
  hp?: number;
  /** 普通攻击无视护盾 */
  ignoreShield?: boolean;
  /** 普通攻击命中后，对目标身后的单位造成 n 点溅射伤害 */
  splash?: number;
  /** 每次行动额外攻击 1 次的概率（0~1） */
  extraAttackChance?: number;
  /** 普通攻击目标改写（热搜：lowestHpEnemy） */
  retarget?: AttackTarget;
  /** 开战获得护盾 */
  startShield?: number;
  /** 自己的护盾被打碎时对攻击者反弹 n 点伤害 */
  shieldReflect?: number;
  /** 单次伤害 ≤ n 时免疫 */
  immuneBelow?: number;
  /** 阵亡后复活一次：hp = 固定血量，ratio = 按战前血量比例（取较大者，至少 1）；to = 复活位置（缺省 back 最后排） */
  revive?: { hp?: number; ratio?: number; to?: 'back' | 'same' };
  /** 回合结束（endShop）时永久成长 */
  growAtk?: number;
  growHp?: number;
  /** 开战时攻击（/血量）追平左右相邻友军中的最高值 */
  copyNeighbor?: ('atk' | 'hp')[];
  /** 技能触发时额外触发 n 次 */
  abilityRepeat?: number;
  /** 被出售时额外 +n 算力 */
  sellGold?: number;
  /** 每回合开始 +n 算力 */
  turnGold?: number;
}

export interface EquipDef {
  id: string;
  name: string;
  slot: EquipSlot;
  desc: string;
  /** 金色版描述 */
  goldDesc: string;
  price: number;
  effect: EquipEffect;
  goldEffect: EquipEffect;
  icon: string;
}

/** 装在单位身上的装备 */
export interface EquipInst {
  defId: string;
  gold: boolean;
}
export type UnitEquips = Partial<Record<EquipSlot, EquipInst>>;

export type ConsumableEffect =
  /** 本回合 n 次免费刷新 */
  | { type: 'freeRerolls'; amount: number }
  /** 随机一个（或指定）单位 +1 等级 */
  | { type: 'levelUpRandom' }
  /** 指定单位变成同阶随机单位（保留额外属性与装备） */
  | { type: 'transform' }
  | { type: 'gold'; amount: number }
  | { type: 'buff'; atk: number; hp: number; permanent: boolean };
export type ConsumableEffectType = ConsumableEffect['type'];

export interface ConsumableDef {
  id: string;
  name: string;
  desc: string;
  price: number;
  /** unit = 需要选一个单位；team = 买了直接用 */
  targetKind: 'unit' | 'team';
  effect: ConsumableEffect;
  icon: string;
}

// ───────────────────────── 赛场（DESIGN 12.4） ─────────────────────────

/** 赛场规则（整局全局生效，所有字段可选、可组合） */
export interface ArenaRules {
  /** 全体单位价格修正 */
  unitPriceMod?: number;
  /** 某阵营 / 职业单位价格修正 */
  factionPriceMod?: { faction: Faction; amount: number };
  rolePriceMod?: { role: Role; amount: number };
  /** 装备价格修正 */
  equipPriceMod?: number;
  /** 每回合额外算力 */
  goldPerTurn?: number;
  /** 商店单位格 / 装备格修正 */
  unitSlotsMod?: number;
  equipSlotsMod?: number;
  /** 刷新免费 */
  rerollFree?: boolean;
  /** 每次刷新：我方 1 号位（最前排）单位永久 +atk/+hp（每回合最多 rerollFrontCap 次，缺省 5） */
  rerollFrontBuff?: { atk: number; hp: number };
  rerollFrontCap?: number;
  /** 战斗开始时双方全体 +atk/+hp（血量最低 1） */
  battleBuff?: { atk: number; hp: number };
  /** 召唤物（战斗与商店）+atk/+hp */
  summonBuff?: { atk: number; hp: number };
  /** 羁绊人数加成（如偶像 +1），商店与战斗都算 */
  synergyBonus?: { key: SynergyKey; amount: number }[];
  /** 开战时（双方）满足筛选的单位获得护盾 */
  startShield?: { amount: number; filter?: TargetFilter };
}

export interface ArenaDef {
  id: string;
  name: string;
  desc: string;
  rules: ArenaRules;
  icon?: string;
  /** 推荐流派（只用于显示） */
  hint?: string;
}

// ───────────────────────── 8 人房对手 / PVE ─────────────────────────

/** 流派：一条阵营线和/或一条职业线 */
export interface Archetype {
  faction?: Faction;
  role?: Role;
}

export interface OpponentPreset {
  id: string;
  name: string;
  avatar: string;
  archetype: Archetype;
  /** 核心单位（机器人优先购买） */
  core?: string[];
  /** 偏好的装备（机器人优先购买） */
  equips?: string[];
  /** 嘲讽台词：defeated = 被淘汰时，victory = 打赢你时 */
  taunt?: { defeated?: string; victory?: string };
  desc?: string;
}

export interface PveUnit { defId: string; atk?: number; hp?: number; level?: Level }
/** 奖励池条目：高 tierBonus 阶的随机单位 / 随机金色装备 / +amount 算力 */
export type PveRewardSpec = { type: 'unit'; tierBonus: number; desc?: string } | { type: 'goldEquip'; desc?: string } | { type: 'gold'; amount: number; desc?: string };
export interface PveDef {
  id: string;
  turn: number;
  name: string;
  desc: string;
  avatar?: string;
  /** 怪物队（前排在前；JSON 字段名 team，兼容 units） */
  units: PveUnit[];
  /** Boss 信息（只用于显示） */
  boss?: { defId: string; skillName?: string; skillDesc?: string };
  tip?: string;
  /** PVE 专用单位定义（可选；也可以直接写在 units.json 里带 token:true） */
  defs?: UnitDef[];
  /** 三选一奖励：pick 个选项，从 pool 里抽（缺省：高一阶单位 / 金色装备 / +6 算力） */
  rewards: { pick: number; pool: PveRewardSpec[] };
}

export type PveRewardOption =
  | { type: 'unit'; defId: string; text: string }
  | { type: 'equip'; defId: string; gold: true; text: string }
  | { type: 'gold'; amount: number; text: string };

// ───────────────────────── 头条 / 突发 ─────────────────────────

export type EventEffect =
  | { type: 'gold'; amount: number }
  /** target 缺省 'unit'；item = 装备与消耗品；amount 正数涨价、负数降价 */
  | { type: 'priceMod'; target: 'unit' | 'item' | 'all'; amount: number }
  | { type: 'freeUnit'; faction?: Faction; tier?: Tier }
  | { type: 'buffTeam'; atk: number; hp: number; permanent: boolean }
  | { type: 'buffFaction'; faction: Faction; atk: number; hp: number; permanent: boolean }
  | { type: 'shopRerollFree' }
  | { type: 'extraSlot'; amount: number }
  | { type: 'shieldAll'; amount: number }
  /** side 缺省 me：开战时我方队伍反转；enemy = 敌方反转 */
  | { type: 'swapAll'; side?: Side }
  | { type: 'duplicate' }
  | { type: 'sacrifice'; amount: number }
  | { type: 'nextTurnGold'; amount: number }
  | { type: 'enemyDebuff'; amount: number }
  | { type: 'rerollShop' }
  | { type: 'levelUpRandom' }
  /** 2.0：失去 DIFFICULTY.lifeTradeHp 点热度换 +amount 算力与 1 次免费刷新 */
  | { type: 'lifeTrade'; amount: number }
  // ── 2.0 战场类（头条作用于本回合战斗，突发作用于下一回合战斗） ──
  /** 敌方全体本场 +atk/+hp */
  | { type: 'enemyBuff'; atk: number; hp: number }
  /** 本场先手方 */
  | { type: 'firstStrike'; side: Side }
  /** 开战时双方前排互换阵营 */
  | { type: 'swapFronts' }
  /** 本场属性倍率（缺省 1）；side = me / enemy / both */
  | { type: 'battleStatMul'; atk?: number; hp?: number; side: Side | 'both' }
  /** 敌方末尾加一个 Boss；打赢时对手掉血 × rewardMul */
  | { type: 'addEnemyBoss'; unitId: string; atk: number; hp: number; rewardMul: number }
  /** 我方装备本场全部按金色生效 */
  | { type: 'goldenEquips' }
  /** 我方召唤物本场 +atk/+hp */
  | { type: 'summonBuff'; atk: number; hp: number }
  /** 立即让一名对手掉血（random 随机存活对手，leader 热度最高的对手；不会直接淘汰，最低 1） */
  | { type: 'damageOpponent'; amount: number; target: 'random' | 'leader' }
  /** 开战时偷一名敌人到我方末尾 */
  | { type: 'stealEnemy'; target: Target }
  /** 立即失去热度（最低 1） */
  | { type: 'selfHpLoss'; amount: number }
  /** 开战时为某方召唤单位 */
  | { type: 'battleSummon'; side: Side; unitId: string; count: number }
  /** 本回合羁绊人数 +amount（商店与战斗都算） */
  | { type: 'synergyBonus'; key: SynergyKey; amount: number }
  /** 对赌：本场赢了下回合 +winGold，输了额外掉 loseHp 热度 */
  | { type: 'wager'; winGold: number; loseHp: number }
  /** 开战时让一名敌人下场（本场不参战） */
  | { type: 'benchEnemy'; target: Target }
  /** 商店追加一件免费装备（可指定金色、槽位） */
  | { type: 'freeEquip'; gold?: boolean; slot?: EquipSlot };
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

export type TutorialStepId = 'buy' | 'buyAgain' | 'fight' | 'equip' | 'merge' | 'synergy' | 'item' | 'freezeSell' | 'headline' | 'done';
export const TUTORIAL_STEPS: readonly TutorialStepId[] = ['buy', 'buyAgain', 'fight', 'equip', 'merge', 'synergy', 'item', 'freezeSell', 'headline', 'done'];
/** 2.0 默认引导顺序（tutorial.json 的 order 缺省时） */
export const DEFAULT_TUTORIAL_ORDER: readonly TutorialStepId[] = ['buy', 'fight', 'equip', 'merge', 'synergy', 'fight', 'headline', 'fight', 'done'];

export interface TutorialEnemyUnit { defId: string; atk?: number; hp?: number; level?: Level }
export interface TutorialTurn {
  turn: number;
  /** 本回合固定商店单位（defId，按顺序） */
  units: string[];
  /** 本回合固定商店装备 / 消耗品 id（JSON 里写 equips / consumables，兼容旧字段 items） */
  items?: string[];
  /** 本回合固定对手（前排在前） */
  enemy: TutorialEnemyUnit[];
}
export interface TutorialStepText { text: string; target?: string }
export interface TutorialDef {
  seed: string;
  turns: TutorialTurn[];
  headlineTurn?: number;
  headline?: string;
  /** 步骤顺序（fight 可重复），缺省 DEFAULT_TUTORIAL_ORDER */
  order?: TutorialStepId[];
  steps: Partial<Record<TutorialStepId, TutorialStepText>>;
}

export interface TutorialProgress {
  buys: number;
  battles: number;
  merged: boolean;
  /** 装过装备或用过消耗品 */
  usedItem: boolean;
  froze: boolean;
  sold: boolean;
  headline: boolean;
  /** 队伍里点亮过任一羁绊 */
  synergy?: boolean;
}

// ───────────────────────── 数据集合 ─────────────────────────

export interface GameData {
  units: UnitDef[];
  equips: EquipDef[];
  consumables: ConsumableDef[];
  arenas: ArenaDef[];
  opponents: OpponentPreset[];
  pve: PveDef[];
  headlines: HeadlineDef[];
  surprises: SurpriseDef[];
  tutorial?: TutorialDef;
  unitsById: Record<string, UnitDef>;
  equipsById: Record<string, EquipDef>;
  consumablesById: Record<string, ConsumableDef>;
  arenasById: Record<string, ArenaDef>;
  /** 可进商店的单位按阶分组：shopUnitsByTier[t] */
  shopUnitsByTier: Record<number, UnitDef[]>;
  /** 校验时的非致命提醒（缺文件用内置默认、缺 role 等），客户端可忽略 */
  warnings: string[];
}

// ───────────────────────── 羁绊 ─────────────────────────

export type SynergyKind = 'faction' | 'role';
export type SynergyKey = Faction | Role;

/** 一条流派线的当前状态（客户端显示进度与档位） */
export interface SynergyState {
  kind: SynergyKind;
  key: SynergyKey;
  /** 中文名：开源 / 研究员 … */
  name: string;
  /** 按单位个数统计（同名的不同单位各算 1，等级不计） */
  count: number;
  /** 0 = 未激活；阵营 1~3（2/3/5 个），职业 1~2（2/4 个） */
  tier: number;
  /** 各档门槛：阵营 [2,3,5]，职业 [2,4] */
  thresholds: number[];
  /** 下一档还差的个数（满档为 undefined） */
  next?: number;
  /** 各档效果描述（与 thresholds 对齐） */
  descs: string[];
}

// ───────────────────────── 局内状态 ─────────────────────────

export interface UnitInst {
  uid: string;
  defId: string;
  /** 基础属性（不含装备静态加成；显示用 effectiveStats） */
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
  /** 装备：武器 / 防具 / 饰品 各 1 */
  equips: UnitEquips;
}

export type ShopSlotKind = 'unit' | 'equip' | 'consumable';
export type FreeReason = 'levelUp' | 'event' | 'pve';

export interface ShopSlot {
  kind: ShopSlotKind;
  defId: string;
  /** 当前实际价格（已含修正，免费槽为 0） */
  price: number;
  frozen: boolean;
  /** 进化奖励 / 头条送 / PVE 奖励的免费槽：价格 0，刷新不会被替换，回合结束未冻结则消失 */
  free?: boolean;
  freeReason?: FreeReason;
  /** 装备槽：金色版（PVE 奖励） */
  gold?: boolean;
}

export interface Modifiers {
  /** 本回合单位 / 装备与消耗品价格修正（负数为降价） */
  unitPriceMod: number;
  itemPriceMod: number;
  /** 本回合商店额外单位槽 */
  extraUnitSlots: number;
  /** 本回合刷新全部免费 */
  rerollFree: boolean;
  /** 剩余免费刷新次数（优先于花算力） */
  freeRerolls: number;
  /** 本回合已刷新次数（工程师 ×4 首刷免费、1 号位光环上限用） */
  rerollsThisTurn: number;
  /** 本回合战斗敌方全队攻击 -n */
  enemyAtkDebuff: number;
  /** 下回合开始时生效的加成 */
  nextTurnGold: number;
  nextFreeRerolls: number;
  nextUnitPriceMod: number;
  /** 商店阶段触发的 swapAll 次数（奇数 = 本场战斗开始时队伍反转） */
  battleSwapAll: number;
  /** 商店阶段触发的 pullFront：本场战斗开始时依次把这些 uid 拉到最前 */
  battlePullFront: string[];
  /** 头条/突发的战场类效果（本回合战斗生效） */
  battle: BattleMods;
  /** 对赌（wager） */
  wager?: { winGold: number; loseHp: number };
  /** 打赢时对手掉血倍率（addEnemyBoss.rewardMul），缺省 1 */
  rewardMul?: number;
}

/** 战场修正（头条/突发 → Modifiers.battle → BattleOptions.mods） */
export interface BattleMods {
  enemyBuff?: { atk: number; hp: number };
  first?: Side;
  swapFronts?: boolean;
  enemyReverse?: boolean;
  statMul?: Partial<Record<Side, { atk: number; hp: number }>>;
  enemyBoss?: { unitId: string; atk: number; hp: number }[];
  goldenEquips?: boolean;
  /** 我方召唤物本场加成 */
  summonBuff?: { atk: number; hp: number };
  stealEnemy?: Target[];
  benchEnemy?: Target[];
  battleSummon?: { side: Side; unitId: string; count: number }[];
  /** 我方羁绊人数加成 */
  synergyBonus?: Partial<Record<SynergyKey, number>>;
}

/** 机器人对手的局内记忆（逐回合推进购物用） */
export interface BotMemo {
  rng: number;
  nextUid: number;
  shopLevel: number;
  shopTier: number;
  /** 下回合额外算力（PVE 奖励等） */
  bonusGold: number;
  /** 冻结的商店槽（跨回合保留） */
  frozen: ShopSlot[];
}

export interface Opponent {
  id: string;
  name: string;
  avatar: string;
  archetype: Archetype;
  /** 预设 id（真人为 undefined） */
  presetId?: string;
  /** 热度（血），初始 20 */
  hp: number;
  alive: boolean;
  /** 本回合（最近一次）阵容快照，前排在前 */
  team: UnitInst[];
  /** 真人快照（服务端注入）；false = AI */
  isHuman: boolean;
  /** 淘汰回合与名次 */
  eliminatedTurn?: number;
  place?: number;
  /** 最近一场的结果（侧栏显示） */
  lastResult?: 'win' | 'loss' | 'draw' | 'pve';
  bot: BotMemo;
}

/** 本回合的对局安排（endShop 时确定） */
export interface Matchup {
  kind: 'pvp' | 'pve';
  /** pvp：对手 id；pve：PveDef.id */
  opponentId: string;
  name: string;
  /** 用于战斗的敌方阵容（AI 对手已按难度缩放；真人快照不缩放） */
  team: UnitInst[];
  isHuman: boolean;
}

export type PendingChoice = { type: 'pveReward'; pveId: string; options: PveRewardOption[] };

export interface BattleRecord {
  turn: number;
  winner: 'me' | 'enemy' | 'draw';
  kind: 'pvp' | 'pve';
  opponentId: string;
  opponentName: string;
  myTeam: { defId: string; atk: number; hp: number; level: Level }[];
  enemyTeam: { defId: string; atk: number; hp: number; level: Level }[];
  /** 本场结束后我方热度与本场掉的血 */
  hp: number;
  hpLoss: number;
  summary?: BattleSummary;
}

export interface RunStats {
  /** 每条流派线达到过的最高档（key = faction/role） */
  maxTiers: Partial<Record<SynergyKey, number>>;
  wins: number;
  losses: number;
  pveWins: number;
  goldEquips: number;
  lv3: number;
  steals: number;
  upgrades: number;
  bestStreak: number;
  streak: number;
}

export type EndReason = 'champion' | 'eliminated' | 'turnLimit';

/** 结局（phase = 'over' 时存在） */
export interface RunEnd {
  /** 名次 1~8 */
  rank: number;
  won: boolean;
  reason: EndReason;
  turns: number;
  hp: number;
  /** 本局流派（按最终阵容的最高羁绊档判定）：faction/role key，或 'mixed' */
  archetype: SynergyKey | 'mixed';
  archetypeName: string;
  /** 本局达成的成就 id（见 ACHIEVEMENTS；"首次达成"由客户端对比本地记录） */
  achievements: string[];
  /** 本局最强单位（客户端结局页、上传 bestUnit） */
  bestUnit?: string;
}

export type Phase = 'arena' | 'headline' | 'shop' | 'battle' | 'result' | 'over';

export interface RunState {
  seed: string;
  turn: number;
  gold: number;
  /** 热度（血），初始 20，归零淘汰 */
  hp: number;
  /** 长度恒为 5，下标 0 = 最前排 */
  team: (UnitInst | null)[];
  shop: ShopSlot[];
  phase: Phase;
  /** 赛场 id（开局三选一后确定；引导局为 undefined） */
  arena?: string;
  /** phase = 'arena' 时可选的 3 个赛场 id */
  arenaOptions?: string[];
  /** 升级商店次数（0~2） */
  shopLevel: number;
  /** 升级商店提前解锁到的阶（0 = 未升级）；实际最高阶 = max(按回合, shopTier) */
  shopTier: number;
  /** 7 名对手 */
  opponents: Opponent[];
  /** 本回合对局（phase = 'battle' 时存在） */
  matchup?: Matchup;
  /** 当前 / 最近一次 PVE：{pveId, turn, won?} */
  pve?: { pveId: string; turn: number; won?: boolean };
  /** 待玩家选择的事项（PVE 三选一） */
  pending?: PendingChoice;
  pendingHeadline?: HeadlineDef;
  lastSurprise?: SurpriseDef;
  surprisePending?: boolean;
  modifiers: Modifiers;
  history: BattleRecord[];
  /** 最近一个动作产生的事件（shopLevelUp / hpLoss / eliminated / pveReward …），每个动作开始时清空 */
  lastEvents: BattleEvent[];
  /** 最近一场战斗的总结 */
  lastSummary?: BattleSummary;
  stats: RunStats;
  end?: RunEnd;
  log: string[];
  /** 上一个 shopAction 失败的原因（成功的动作会清掉） */
  error?: string;
  /** mulberry32 内部状态（保证可重放） */
  rng: number;
  nextUid: number;
  seenHeadlines: string[];
  seenSurprises: string[];
  tutorial?: TutorialProgress;
  lastLevelUp?: { uid: string; level: Level };
}

export type ShopActionInput =
  /** 开局赛场三选一（phase = 'arena'） */
  | { type: 'chooseArena'; index: number }
  /** slot = 商店下标；to = 队伍下标（可选） */
  | { type: 'buy'; slot: number; to?: number }
  | { type: 'sell'; index: number }
  | { type: 'reroll' }
  | { type: 'freeze'; slot: number }
  | { type: 'swap'; a: number; b: number }
  | { type: 'merge'; from: number; to: number }
  /** 购买商店装备并装到队伍 unitIndex 的单位上 */
  | { type: 'equip'; slot: number; unitIndex: number }
  /** 购买并使用消耗品；unit 型需要 target（队伍下标） */
  | { type: 'useConsumable'; slot: number; target?: number }
  /** 升级商店：4 算力，提前解锁下一阶，每局最多 2 次 */
  | { type: 'upgradeShop' }
  | { type: 'chooseHeadline'; option: 0 | 1 }
  | { type: 'endShop' }
  /** PVE 三选一 */
  | { type: 'choosePveReward'; index: number }
  /** 结算页 → 下一回合 */
  | { type: 'continue' };

// ───────────────────────── 战斗 ─────────────────────────

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
  equips: UnitEquips;
}

export type DamageKind = 'attack' | 'ability' | 'reflect' | 'explode' | 'splash';

export type BattleEvent =
  | { type: 'start'; me: UnitSnap[]; enemy: UnitSnap[]; first: Side; arena?: string; text: string }
  /** 赛场规则生效（GPU 荒等） */
  | { type: 'arena'; arena: string; name: string; text: string }
  /** 羁绊档位横幅：tier = 1~3；line = 该线单位的 onSynergy 台词 */
  | { type: 'synergyTier'; side: Side; kind: SynergyKind; key: SynergyKey; name: string; count: number; tier: number; line?: { unit: UnitRef; line: string }; text: string }
  /** repeat = 第几次触发（研究员 ×4 / 微调的额外触发从 2 开始） */
  | { type: 'ability'; unit: UnitRef; trigger: Trigger | 'synergy'; effect: Effect; targets: UnitRef[]; repeat: number; text: string }
  /** 一次攻击（交替开火）：action = 第几次行动，hit/hits = 本次行动的第几段/共几段 */
  | { type: 'attack'; action: number; unit: UnitRef & { atk: number }; target: UnitRef; hit: number; hits: number; text: string }
  | { type: 'damage'; unit: UnitRef; source?: UnitRef; amount: number; blocked: number; hp: number; shield: number; kind: DamageKind; immune?: boolean; shieldBroken?: boolean; text: string }
  | { type: 'heal'; unit: UnitRef; source?: UnitRef; amount: number; hp: number; text: string }
  | { type: 'buff'; unit: UnitRef; source?: UnitRef; atk: number; hp: number; newAtk: number; newHp: number; permanent: boolean; text: string }
  | { type: 'shield'; unit: UnitRef; source?: UnitRef; amount: number; total: number; text: string }
  /** consumed = 被友军吞并；benched = 被头条请下场（不算阵亡、不触发技能） */
  | { type: 'faint'; unit: UnitRef; killer?: UnitRef; consumed?: boolean; benched?: boolean; text: string }
  | { type: 'summon'; unit: UnitSnap; source?: UnitRef; text: string }
  | { type: 'move'; side: Side; unit: UnitRef; from: number; to: number; order: string[]; text: string }
  | { type: 'multiAttack'; unit: UnitRef; source?: UnitRef; hits: number; text: string }
  | { type: 'bonus'; side: Side; unit: UnitRef; kind: 'gold' | 'reroll' | 'discount'; amount: number; text: string }
  | { type: 'say'; unit: UnitRef; line: string; text: string }
  /** 偷取：unit = 被偷单位（偷之前的引用），to = 到新阵营后的引用 */
  | { type: 'steal'; unit: UnitRef; source: UnitRef; to: UnitRef; text: string }
  /** 爆炸：随后是对 targets 的 damage 事件 */
  | { type: 'explode'; unit: UnitRef; amount: number; targets: UnitRef[]; text: string }
  /** 复活：unit 为复活后的快照；via = 来源 */
  | { type: 'revive'; unit: UnitSnap; via: 'equip' | 'ability'; source?: UnitRef; text: string }
  /** 连击：击杀后立刻再攻击一次；count = 本次行动第几次追击 */
  | { type: 'chain'; unit: UnitRef; count: number; text: string }
  /** 装备生效（显示装备小图标闪光） */
  | { type: 'equipProc'; unit: UnitRef; equipId: string; slot: EquipSlot; gold: boolean; text: string }
  | { type: 'end'; winner: 'me' | 'enemy' | 'draw'; actions: number; reason: 'wipe' | 'timeout'; hpLeft: { me: number; enemy: number }; me: string[]; enemy: string[]; text: string }
  // ── 回合级事件（不在 BattleResult.events 里，而在 RunState.lastEvents 里） ──
  | { type: 'shopLevelUp'; shopLevel: number; tier: number; text: string }
  /** who = 'me' 或对手 id；by = 打赢的一方（'me' / 对手 id / PVE id） */
  | { type: 'hpLoss'; who: string; name: string; amount: number; hp: number; by?: string; text: string }
  | { type: 'eliminated'; who: string; name: string; place: number; remaining: number; text: string }
  | { type: 'pveReward'; pveId: string; options: PveRewardOption[]; text: string };
export type BattleEventType = BattleEvent['type'];

export interface BattleOptions {
  /** 敌方全队攻击修正（头条 enemyDebuff 传负数） */
  enemyAtkMod?: number;
  /** 战斗开始时我方队伍反转（商店阶段的 swapAll） */
  meReverse?: boolean;
  /** 战斗开始时依次拉到最前的我方 uid（商店阶段的 pullFront） */
  mePullFront?: string[];
  /** 赛场 id（双方都受影响） */
  arena?: string;
  /** 先手方（缺省 'me'，DESIGN 12.6 我方 1 号先开火） */
  first?: Side;
  /** 头条/突发带来的战场修正 */
  mods?: BattleMods;
}

export interface BattleSummary {
  /** 我方伤害最高单位（没有伤害时为 undefined） */
  mvpUid?: string;
  mvpDefId?: string;
  /** 本场每个单位造成的伤害（双方，含技能/反弹/爆炸/溅射） */
  damageByUid: Record<string, number>;
  /** 一句话归因（中文） */
  reason: string;
  /** 我方本场激活的羁绊（tier > 0） */
  synergyTiers: SynergyState[];
}

export interface BattleResult {
  winner: 'me' | 'enemy' | 'draw';
  events: BattleEvent[];
  /** 对手阵容（战前，紧凑无空位） */
  enemyTeam: UnitInst[];
  /** 行动次数 */
  actions: number;
  /** 胜方存活单位数（扣血公式用；和局为 0） */
  survivors: number;
  permanentBuffs: { uid: string; atk: number; hp: number }[];
  bonus: { gold: number; rerolls: number; discount: number };
  summary: BattleSummary;
}
