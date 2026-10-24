#!/usr/bin/env node
// 内容数据自检：node shared/data/check.mjs
// 错误（exit 1）：id 重复/缺失、阶级/阵营/职业分布、非法 trigger/effect/target、事件效果非法、文案超长、引用不存在、
//                 装备槽与固定 id、赛场/对手/PVE 字段与引用。
// 警告（不影响退出码）：assets/ 下缺少的头像与图标（美术任务补图，含 arenas/ 与 items/coffee 等新图）、1.0 遗留字段。
// 字段口径：DESIGN 第 15 节（2.0）+ shared/src/types.ts + docs/ENGINE_NOTES.md（含 DESIGN 11 扩展：filter/consume/maxHp/choices/effects[]）。
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const assets = join(root, 'assets');
const load = (f) => JSON.parse(readFileSync(join(here, f), 'utf8'));
const len = (s) => [...String(s ?? '')].length;

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const TRIGGERS = ['startBattle', 'beforeAttack', 'hurt', 'faint', 'friendFaint', 'kill', 'friendSummoned', 'buy', 'sell', 'levelUp', 'friendBought', 'startTurn', 'endTurn', 'eatItem', 'enemySummoned', 'hurtFront'];
const OLD_EFFECTS = ['damage', 'buff', 'shield', 'summon', 'copyStats', 'swapPosition', 'gold', 'destroy', 'heal', 'reroll', 'discount', 'pushBack', 'pullFront', 'multiAttack'];
// DESIGN 13：2.0 新效果。steal 可带 maxHp/maxHpPerLevel（同 destroy：血量 ≤ 阈值才偷，否则造成阈值伤害）
const NEW_EFFECTS = ['steal', 'explode', 'doubleStats', 'revive', 'chain'];
const EFFECTS = [...OLD_EFFECTS, ...NEW_EFFECTS];
const ROLES = ['researcher', 'trader', 'idol', 'engineer'];
const TARGETS = ['self', 'frontFriend', 'backFriend', 'adjacentFriends', 'randomFriend', 'allFriends', 'lowestHpFriend', 'frontEnemy', 'backEnemy', 'randomEnemy', 'allEnemies', 'lowestHpEnemy', 'highestAtkEnemy', 'killer', 'summoned', 'boughtUnit'];
const FACTIONS = ['open', 'closed', 'compute', 'folk'];
const ABILITY_KEYS = ['name', 'shortDesc', 'trigger', 'effect', 'target', 'amount', 'atk', 'hp', 'permanent', 'perLevel', 'n', 'unitId', 'count', 'desc', 'filter', 'consume', 'maxHp', 'maxHpPerLevel', 'choices'];
const CHOICE_KEYS = ABILITY_KEYS.filter((k) => !['trigger', 'choices'].includes(k));
const ITEM_EFFECTS = { buff: ['atk', 'hp', 'permanent'], shield: ['amount'], copyStatsFrom: [], levelUp: [], gold: ['amount'], summonToken: ['unitId'], teamBuff: ['atk', 'hp', 'permanent'], pullFront: [], transformRandomSameTier: [] };
const EVENT_EFFECTS = {
  gold: ['amount'], priceMod: ['target', 'amount'], freeUnit: [], buffTeam: ['atk', 'hp', 'permanent'], buffFaction: ['faction', 'atk', 'hp', 'permanent'],
  shopRerollFree: [], extraSlot: ['amount'], shieldAll: ['amount'], swapAll: [], duplicate: [], sacrifice: ['amount'], nextTurnGold: ['amount'],
  enemyDebuff: ['amount'], rerollShop: [], levelUpRandom: [], lifeTrade: ['amount'],
};
// 2.0「改变战场」事件效果（需引擎新增，均只作用于本回合/下一场战斗）。swapAll 另可带 side:'me'|'enemy'
const EVENT_EFFECTS_V2 = {
  enemyBuff: ['atk', 'hp'], firstStrike: ['side'], swapFronts: [], battleStatMul: ['side'], addEnemyBoss: ['unitId', 'atk', 'hp', 'rewardMul'],
  goldenEquips: [], summonBuff: ['atk', 'hp'], damageOpponent: ['amount', 'target'], stealEnemy: ['target'], selfHpLoss: ['amount'],
  battleSummon: ['side', 'unitId', 'count'], synergyBonus: ['key', 'amount'], wager: ['winGold', 'loseHp'], benchEnemy: ['target'], freeEquip: [],
};
Object.assign(EVENT_EFFECTS, EVENT_EFFECTS_V2);
const BATTLE_EV = new Set([...Object.keys(EVENT_EFFECTS_V2), 'enemyDebuff', 'swapAll', 'shieldAll']);
const ROSTER = {
  1: ['prompt_eng', 'crawler', 'labeler', 'wrapper', 'botnet', 'vibe_coder'],
  2: ['doubao_chan', 'qwen_chan', 'zuck', 'ai_gf', 'scalper', 'leaderboard'],
  3: ['hf', 'kimi', 'mistral', 'lecun', 'hallucination', 'robodog'],
  4: ['claude_chan', 'gemini_chan', 'deepseek_chan', 'dario', 'ilya'],
  5: ['gpt_chan', 'huang', 'altman', 'musk', 'liang'],
  6: ['stargate', 'regulator', 'agi', 'funding'],
};
const TOKENS = ['token_shuijun', 'token_halluc', 'token_gpu'];
const MOBS = ['mob_halluc', 'mob_halluc_mini', 'boss_huang']; // PVE 怪物（token:true，avatar 复用现有图）
const CHARACTERS = ['altman', 'claude_chan', 'dario', 'deepseek_chan', 'doubao_chan', 'gemini_chan', 'gpt_chan', 'huang', 'ilya', 'lecun', 'liang', 'musk', 'qwen_chan', 'zuck'];
const ITEM_IDS = ['gpu_h100', 'dataset', 'finetune', 'distill', 'firewall', 'funding_round', 'launch_event', 'trending', 'jumpbox', 'alignment', 'quantize', 'rlhf'];
const EQUIP_SLOT = {
  gpu_h100: 'weapon', quantize: 'weapon', launch_event: 'weapon', trending: 'weapon',
  dataset: 'armor', firewall: 'armor', alignment: 'armor', jumpbox: 'armor',
  rlhf: 'trinket', distill: 'trinket', finetune: 'trinket', funding_round: 'trinket',
};
// 装备效果（effect / goldEffect 均为完整对象，金色版不是增量）
const EQUIP_EFFECTS = {
  stat: ['atk', 'hp'], extraAttack: ['chance'], retarget: ['target'], startShield: ['amount'], revive: ['to'],
  growth: ['atk', 'hp'], copyNeighbor: ['stats'], abilityRepeat: ['times'], income: ['perTurn', 'onSell'],
};
const EQUIP_OPT = ['ignoreShield', 'splash', 'reflect', 'immuneAtMost', 'hp', 'hpRatio', 'atk'];
const CONSUMABLE_IDS = ['coffee', 'press', 'pivot'];
const CONSUMABLE_EFFECTS = { freeRerolls: ['amount'], levelUpRandom: [], transformRandomSameTier: [] };
const ARENA_EFFECTS = {
  priceMod: ['kind', 'amount'], statAll: ['atk', 'hp'], economy: [], rerollBuff: ['slot', 'atk', 'hp'], shopSlots: ['kind', 'amount'],
  summonBuff: ['atk', 'hp'], synergyBonus: ['key', 'amount'], startShield: ['amount'],
};

const uniq = (list, what) => {
  const seen = new Set();
  for (const x of list) {
    if (!x.id) err(`${what}: 有条目缺 id`);
    else if (seen.has(x.id)) err(`${what}: 重复 id ${x.id}`);
    seen.add(x.id);
  }
};
const asset = (rel, who) => {
  if (!rel) return err(`${who}: 缺少素材路径`);
  if (!existsSync(join(assets, rel))) warn(`缺素材 assets/${rel}（${who}）`);
};

// ───────── units ─────────
const units = load('units.json');
uniq(units, 'units');
const byId = Object.fromEntries(units.map((u) => [u.id, u]));
const shop = units.filter((u) => !u.token);
const allRoster = Object.values(ROSTER).flat();
if (shop.length !== 32) err(`商店单位应为 32 个，实际 ${shop.length}`);
for (const [t, ids] of Object.entries(ROSTER)) for (const id of ids) {
  if (!byId[id]) err(`缺少单位 ${id}（T${t}）`);
  else if (byId[id].tier !== Number(t)) err(`${id} 应为 T${t}，实际 T${byId[id].tier}`);
  else if (byId[id].token) err(`${id} 不应是召唤物`);
}
for (const u of shop) if (!allRoster.includes(u.id)) err(`名单外的商店单位 ${u.id}`);
for (const id of [...TOKENS, ...MOBS]) if (!byId[id]?.token) err(`缺少召唤物/怪物 ${id}（需 token:true）`);
for (const u of units) if (u.token && !TOKENS.includes(u.id) && !MOBS.includes(u.id)) err(`名单外的召唤物 ${u.id}`);

const facCount = Object.fromEntries(FACTIONS.map((f) => [f, 0]));
const roleFac = Object.fromEntries(ROLES.map((r) => [r, Object.fromEntries(FACTIONS.map((f) => [f, 0]))]));
const newEffUnits = [];
const trigUse = Object.fromEntries(TRIGGERS.map((t) => [t, []]));
const effUse = Object.fromEntries(EFFECTS.map((e) => [e, []]));
for (const u of units) {
  const at = `单位 ${u.id}`;
  if (!u.name) err(`${at}: 缺 name`);
  if (!FACTIONS.includes(u.faction)) err(`${at}: 阵营非法 ${u.faction}`);
  else if (!u.token) facCount[u.faction]++;
  if (!Number.isInteger(u.atk) || u.atk < 0) err(`${at}: atk 应为非负整数`);
  if (!Number.isInteger(u.hp) || u.hp < 1) err(`${at}: hp 应 ≥ 1`);
  if (!u.token) {
    if (!ROLES.includes(u.role)) err(`${at}: role 应为 ${ROLES.join('/')}，实际 ${u.role}`);
    else if (FACTIONS.includes(u.faction)) roleFac[u.role][u.faction]++;
  } else if (u.role !== undefined) err(`${at}: 召唤物不带 role`);
  // 2.0：lines = { common: string[2~3], onSynergy: string }
  const L = u.lines;
  if (Array.isArray(L)) warn(`${at}: lines 仍是 1.0 数组，缺 onSynergy`);
  const common = Array.isArray(L) ? L : L?.common;
  if (!Array.isArray(common) || common.length < 2 || common.length > 3) err(`${at}: lines.common 应 2~3 条`);
  for (const l of common ?? []) if (len(l) > 12) err(`${at}: 台词超 12 字「${l}」`);
  if (!Array.isArray(L)) {
    if (!L?.onSynergy) err(`${at}: 缺 lines.onSynergy`);
    else if (len(L.onSynergy) > 12) err(`${at}: onSynergy 超 12 字「${L.onSynergy}」`);
    for (const k of Object.keys(L ?? {})) if (!['common', 'onSynergy'].includes(k)) err(`${at}: lines 字段 ${k} 未知`);
  }
  const want = MOBS.includes(u.id) ? null : CHARACTERS.includes(u.id) ? `characters/${u.id}.png` : `units/${u.id}.svg`;
  if (want && u.avatar !== want) err(`${at}: avatar 应为 ${want}，实际 ${u.avatar}`);
  asset(u.avatar, at);
  const a = u.ability;
  if (!a) {
    if (!u.token) err(`${at}: 商店单位必须有技能`);
    continue;
  }
  for (const k of Object.keys(a)) if (!ABILITY_KEYS.includes(k)) err(`${at}: 技能字段 ${k} 引擎不认识`);
  if (!TRIGGERS.includes(a.trigger)) err(`${at}: trigger 非法 ${a.trigger}`);
  else trigUse[a.trigger].push(u.id + (u.token ? '*' : ''));
  if (!EFFECTS.includes(a.effect)) err(`${at}: effect 非法 ${a.effect}`);
  else effUse[a.effect].push(u.id + (u.token ? '*' : ''));
  if (NEW_EFFECTS.includes(a.effect) && !u.token) newEffUnits.push(`${u.id}:${a.effect}`);
  const tgt = String(a.target ?? '').replace(/\(\d+\)$/, '');
  if (!TARGETS.includes(tgt)) err(`${at}: target 非法 ${a.target}`);
  // 卡面直显：技能名 ≤5 字、短描述 ≤10 字（纯效果，不带触发器前缀也能懂）
  if (!a.name) err(`${at}: 缺 ability.name`);
  else if (len(a.name) > 5) err(`${at}: ability.name 超 5 字「${a.name}」`);
  if (!a.shortDesc) err(`${at}: 缺 ability.shortDesc`);
  else if (len(a.shortDesc) > 10) err(`${at}: ability.shortDesc 超 10 字（${len(a.shortDesc)}）「${a.shortDesc}」`);
  if (!a.desc) err(`${at}: 缺 desc`);
  else if (len(a.desc) > 24) err(`${at}: desc 超 24 字（${len(a.desc)}）「${a.desc}」`);
  if (a.filter !== undefined) {
    const f = a.filter;
    for (const k of Object.keys(f)) if (!['faction', 'minTier', 'maxTier'].includes(k)) err(`${at}: filter 字段 ${k} 非法`);
    if (f.faction !== undefined && !FACTIONS.includes(f.faction)) err(`${at}: filter.faction 非法`);
    for (const k of ['minTier', 'maxTier']) if (f[k] !== undefined && !(Number.isInteger(f[k]) && f[k] >= 1 && f[k] <= 6)) err(`${at}: filter.${k} 应为 1~6`);
  }
  if (a.consume !== undefined && a.effect !== 'copyStats') err(`${at}: consume 只配 copyStats`);
  if ((a.maxHp !== undefined || a.maxHpPerLevel !== undefined) && !['destroy', 'steal'].includes(a.effect)) err(`${at}: maxHp 只配 destroy/steal`);
  if (['explode', 'revive'].includes(a.effect) && a.trigger !== 'faint') err(`${at}: ${a.effect} 只配 faint`);
  if (a.effect === 'chain' && a.trigger !== 'kill') err(`${at}: chain 只配 kill`);
  if (['revive', 'chain', 'doubleStats'].includes(a.effect) && tgt !== 'self') err(`${at}: ${a.effect} 目标应为 self`);
  if (a.effect === 'explode' && tgt !== 'allEnemies') err(`${at}: explode 目标应为 allEnemies`);
  if (a.effect === 'steal' && !/Enemy/.test(tgt)) err(`${at}: steal 目标应为敌方`);
  if (a.choices !== undefined) {
    if (!Array.isArray(a.choices) || a.choices.length < 2) err(`${at}: choices 至少 2 个`);
    for (const [i, c] of (a.choices ?? []).entries()) {
      for (const k of Object.keys(c)) if (!CHOICE_KEYS.includes(k)) err(`${at}.choices[${i}]: 字段 ${k} 非法`);
      if (c.effect !== undefined && !EFFECTS.includes(c.effect)) err(`${at}.choices[${i}]: effect 非法`);
      if (c.effect !== undefined) effUse[c.effect].push(u.id);
      if (!c.desc || len(c.desc) > 24) err(`${at}.choices[${i}]: desc 缺失或超 24 字`);
    }
  }
  if (a.effect === 'summon' && !byId[a.unitId ?? 'token_shuijun']) err(`${at}: 召唤的 ${a.unitId} 不存在`);
  if (tgt === 'boughtUnit' && !['buy', 'friendBought'].includes(a.trigger)) err(`${at}: boughtUnit 只配 buy/friendBought`);
  if (tgt === 'summoned' && !['friendSummoned', 'enemySummoned'].includes(a.trigger)) err(`${at}: summoned 只配 *Summoned 触发`);
  if (tgt === 'killer' && !['faint', 'hurt'].includes(a.trigger)) err(`${at}: killer 只配 faint/hurt`);
  const shopTrig = ['buy', 'sell', 'levelUp', 'friendBought', 'startTurn', 'endTurn', 'eatItem'];
  if (shopTrig.includes(a.trigger) && ['damage', 'destroy', 'multiAttack', ...NEW_EFFECTS].includes(a.effect)) err(`${at}: ${a.effect} 在商店阶段无效`);
  if (shopTrig.includes(a.trigger) && /Enemy|killer/.test(tgt)) err(`${at}: 商店阶段没有敌人目标`);
  const perLv = (a.effect === 'multiAttack' ? a.perLevel === true : a.perLevel !== false) && !['swapPosition', 'pushBack', 'pullFront', 'copyStats', 'explode', 'doubleStats', 'revive', 'chain'].includes(a.effect) && !(['destroy', 'steal'].includes(a.effect) && !a.maxHpPerLevel);
  if (perLv && !/每级|×等级/.test(a.desc)) err(`${at}: 按等级缩放但 desc 没写「每级」`);
  if (!perLv && /每级/.test(a.desc)) err(`${at}: 不缩放但 desc 写了「每级」`);
}
for (const f of FACTIONS) if (facCount[f] < 7 || facCount[f] > 9) err(`阵营 ${f} 有 ${facCount[f]} 个，应 7~9`);
for (const r of ROLES) {
  const n = Object.values(roleFac[r]).reduce((x, y) => x + y, 0);
  if (n < 7 || n > 9) err(`职业 ${r} 有 ${n} 个，应 7~9`);
  const facs = FACTIONS.filter((f) => roleFac[r][f] > 0).length;
  if (facs < 3) err(`职业 ${r} 只覆盖 ${facs} 个阵营，应 ≥3（跨阵营）`);
}
if (newEffUnits.length < 10) err(`使用 2.0 新效果的商店单位只有 ${newEffUnits.length} 个（≥10）`);
// 2.0 起技能为流派服务，不再强制每个触发器 ≥2 个单位、每个旧效果都有人用（降为警告）
for (const t of TRIGGERS) if (trigUse[t].length < 2) warn(`触发器 ${t} 只被 ${trigUse[t].length} 个单位使用：${trigUse[t].join(', ')}`);
for (const e of NEW_EFFECTS) if (!effUse[e].length) err(`新效果 ${e} 没有单位使用`);
for (const e of OLD_EFFECTS) if (!effUse[e].length) warn(`效果 ${e} 已没有单位使用（引擎保留）`);
  else if (!effUse[e].some((x) => !x.endsWith('*'))) warn(`效果 ${e} 只有召唤物使用：${effUse[e].join(', ')}`);

// ───────── items（1.0 一次性基建，2.0 由 equips/consumables 取代；文件存在则继续校验以兼容旧引擎） ─────────
const items = existsSync(join(here, 'items.json')) ? load('items.json') : [];
uniq(items, 'items');
const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
if (items.length) for (const id of ITEM_IDS) if (!itemById[id]) err(`缺少基建 ${id}`);
for (const it of items) {
  const at = `基建 ${it.id}`;
  if (!ITEM_IDS.includes(it.id)) err(`${at}: 不在固定 id 列表`);
  if (!it.name) err(`${at}: 缺 name`);
  if (!it.desc || len(it.desc) > 24) err(`${at}: desc 缺失或超 24 字`);
  if (![1, 2, 3].includes(it.price)) err(`${at}: price 应 1~3`);
  if (![1, 2, 3].includes(it.tier)) err(`${at}: tier 应 1~3`);
  if (!['unit', 'team'].includes(it.targetKind)) err(`${at}: targetKind 非法`);
  const need = ITEM_EFFECTS[it.effect?.type];
  if (!need) err(`${at}: effect.type 非法 ${it.effect?.type}`);
  else for (const k of need) if (it.effect[k] === undefined) err(`${at}: ${it.effect.type} 缺 ${k}`);
  if (it.effect?.type === 'summonToken' && !byId[it.effect.unitId]) err(`${at}: 召唤物 ${it.effect.unitId} 不存在`);
  if (['teamBuff', 'gold', 'summonToken'].includes(it.effect?.type) !== (it.targetKind === 'team')) err(`${at}: targetKind 与效果不匹配`);
  if (it.icon !== `items/${it.id}.svg`) err(`${at}: icon 应为 items/${it.id}.svg`);
  asset(it.icon, at);
}

// ───────── equips（DESIGN 12.3） ─────────
const equips = load('equips.json');
uniq(equips, 'equips');
const equipById = Object.fromEntries(equips.map((e) => [e.id, e]));
for (const id of ITEM_IDS) if (!equipById[id]) err(`缺少装备 ${id}`);
const slotCount = { weapon: 0, armor: 0, trinket: 0 };
const checkEquipEffect = (e, at) => {
  const need = EQUIP_EFFECTS[e?.type];
  if (!need) return err(`${at}: 装备效果类型非法 ${e?.type}（允许 ${Object.keys(EQUIP_EFFECTS).join('/')}）`);
  for (const k of need) if (e[k] === undefined && !(e.type === 'revive' && k === 'to')) err(`${at}: ${e.type} 缺 ${k}`);
  for (const k of Object.keys(e)) if (k !== 'type' && !need.includes(k) && !EQUIP_OPT.includes(k)) err(`${at}: 字段 ${k} 未知`);
  if (e.type === 'extraAttack' && !(e.chance > 0 && e.chance <= 1)) err(`${at}: chance 应在 (0,1]`);
  if (e.type === 'retarget' && !TARGETS.includes(e.target)) err(`${at}: retarget.target 非法`);
  if (e.type === 'revive' && e.hp === undefined && e.hpRatio === undefined) err(`${at}: revive 需 hp 或 hpRatio`);
  if (e.type === 'copyNeighbor' && !(Array.isArray(e.stats) && e.stats.every((s) => ['atk', 'hp'].includes(s)))) err(`${at}: copyNeighbor.stats 只能含 atk/hp`);
};
for (const q of equips) {
  const at = `装备 ${q.id}`;
  if (!ITEM_IDS.includes(q.id)) err(`${at}: 不在固定 id 列表`);
  if (q.slot !== EQUIP_SLOT[q.id]) err(`${at}: slot 应为 ${EQUIP_SLOT[q.id]}，实际 ${q.slot}`);
  else slotCount[q.slot]++;
  if (!q.name) err(`${at}: 缺 name`);
  for (const k of ['desc', 'goldDesc']) if (!q[k] || len(q[k]) > 24) err(`${at}: ${k} 缺失或超 24 字`);
  for (const k of ['shortDesc', 'goldShortDesc']) if (!q[k]) err(`${at}: 缺 ${k}`); else if (len(q[k]) > 8) err(`${at}: ${k} 超 8 字「${q[k]}」`);
  if (!/\d/.test(q.desc + q.goldDesc)) err(`${at}: 描述要写清数值`);
  if (![2, 3].includes(q.price)) err(`${at}: price 应 2~3`);
  checkEquipEffect(q.effect, `${at}.effect`);
  checkEquipEffect(q.goldEffect, `${at}.goldEffect`);
  if (q.effect?.type && q.goldEffect?.type && q.effect.type !== q.goldEffect.type) err(`${at}: 金色版效果类型应与普通版相同`);
  if (q.icon !== `items/${q.id}.svg`) err(`${at}: icon 应为 items/${q.id}.svg`);
  asset(q.icon, at);
}
for (const [s, n] of Object.entries(slotCount)) if (n !== 4) err(`装备槽 ${s} 有 ${n} 件，应 4 件`);

// ───────── consumables ─────────
const consumables = load('consumables.json');
uniq(consumables, 'consumables');
for (const id of CONSUMABLE_IDS) if (!consumables.some((c) => c.id === id)) err(`缺少消耗品 ${id}`);
for (const c of consumables) {
  const at = `消耗品 ${c.id}`;
  if (!CONSUMABLE_IDS.includes(c.id)) err(`${at}: 不在固定 id 列表`);
  if (!c.name || !c.desc || len(c.desc) > 24) err(`${at}: name/desc 缺失或 desc 超 24 字`);
  if (![1, 2, 3].includes(c.price)) err(`${at}: price 应 1~3`);
  if (!['unit', 'team'].includes(c.targetKind)) err(`${at}: targetKind 非法`);
  const need = CONSUMABLE_EFFECTS[c.effect?.type];
  if (!need) err(`${at}: effect.type 非法 ${c.effect?.type}`);
  else for (const k of need) if (c.effect[k] === undefined) err(`${at}: ${c.effect.type} 缺 ${k}`);
  if (c.icon !== `items/${c.id}.svg`) err(`${at}: icon 应为 items/${c.id}.svg`);
  asset(c.icon, at);
}

// ───────── arenas（DESIGN 12.4） ─────────
const arenas = load('arenas.json');
uniq(arenas, 'arenas');
if (arenas.length < 8) err(`赛场卡只有 ${arenas.length} 张（≥8）`);
const synKey = (k) => FACTIONS.includes(k) || ROLES.includes(k);
const checkFilter = (f, at) => {
  if (f === undefined) return;
  for (const k of Object.keys(f)) if (!['faction', 'role', 'minTier', 'maxTier'].includes(k)) err(`${at}: filter.${k} 非法`);
  if (f.faction !== undefined && !FACTIONS.includes(f.faction)) err(`${at}: filter.faction 非法`);
  if (f.role !== undefined && !ROLES.includes(f.role)) err(`${at}: filter.role 非法`);
};
for (const a of arenas) {
  const at = `赛场 ${a.id}`;
  if (!a.name || len(a.name) > 6) err(`${at}: name 缺失或超 6 字`);
  if (!a.desc || len(a.desc) > 28) err(`${at}: desc 缺失或超 28 字（${len(a.desc)}）`);
  if (a.icon !== `arenas/${a.id}.svg`) err(`${at}: icon 应为 arenas/${a.id}.svg`);
  asset(a.icon, at);
  const need = ARENA_EFFECTS[a.effect?.type];
  if (!need) { err(`${at}: effect.type 非法 ${a.effect?.type}`); continue; }
  for (const k of need) if (a.effect[k] === undefined) err(`${at}: ${a.effect.type} 缺 ${k}`);
  checkFilter(a.effect.filter, at);
  if (['priceMod', 'shopSlots'].includes(a.effect.type) && !['unit', 'equip', 'consumable', 'reroll'].includes(a.effect.kind)) err(`${at}: kind 非法`);
  if (a.effect.type === 'synergyBonus' && !synKey(a.effect.key)) err(`${at}: synergyBonus.key 应为阵营或职业`);
  if (a.effect.type === 'economy' && Object.keys(a.effect).length < 2) err(`${at}: economy 至少一个参数`);
}

// ───────── opponents（DESIGN 12.5） ─────────
const opponents = load('opponents.json');
uniq(opponents, 'opponents');
if (opponents.length !== 8) err(`AI 对手预设应 8 个，实际 ${opponents.length}`);
const arche = new Set();
for (const o of opponents) {
  const at = `对手 ${o.id}`;
  if (!o.name || len(o.name) > 10) err(`${at}: name 缺失或超 10 字`);
  if (!synKey(o.archetype)) err(`${at}: archetype 应为阵营或职业，实际 ${o.archetype}`);
  else if (arche.has(o.archetype)) err(`${at}: archetype ${o.archetype} 重复`);
  else arche.add(o.archetype);
  if (!/^(characters\/[a-z_]+\.png|units\/[a-z_]+\.svg)$/.test(o.avatar ?? '')) err(`${at}: avatar 应为 characters/<id>.png 或 units/<id>.svg`);
  asset(o.avatar, at);
  for (const k of ['defeated', 'victory']) if (!o.taunt?.[k] || len(o.taunt[k]) > 14) err(`${at}: taunt.${k} 缺失或超 14 字`);
  for (const id of o.core ?? []) if (!byId[id] || byId[id].token) err(`${at}: core 单位 ${id} 不存在`);
}
for (const k of [...FACTIONS, ...ROLES]) if (!arche.has(k)) err(`没有对手绑定流派 ${k}`);

// ───────── pve（DESIGN 12.7） ─────────
const pve = load('pve.json');
uniq(pve, 'pve');
for (const t of [4, 9]) if (!pve.some((p) => p.turn === t)) err(`缺少第 ${t} 回合 PVE`);
const REWARDS = { unit: ['tierBonus'], goldEquip: [], gold: ['amount'] };
for (const p of pve) {
  const at = `PVE ${p.id}`;
  if (!p.name || !p.desc) err(`${at}: 缺 name/desc`);
  asset(p.avatar, at);
  if (!Array.isArray(p.team) || !p.team.length || p.team.length > 6) err(`${at}: team 应 1~6 个`);
  for (const m of p.team ?? []) if (!byId[m.defId]) err(`${at}: 怪物 ${m.defId} 不存在`);
  if (p.boss) {
    if (!p.team.some((m) => m.defId === p.boss.defId)) err(`${at}: boss 不在 team 里`);
    if (!p.boss.skillName || !p.boss.skillDesc) err(`${at}: boss 缺 skillName/skillDesc`);
  }
  const pool = p.rewards?.pool ?? [];
  if (!(p.rewards?.pick >= 1) || pool.length < p.rewards.pick) err(`${at}: rewards.pick/pool 非法`);
  for (const r of pool) {
    const need = REWARDS[r.type];
    if (!need) err(`${at}: 奖励类型非法 ${r.type}`);
    else for (const k of need) if (r[k] === undefined) err(`${at}: 奖励 ${r.type} 缺 ${k}`);
    if (!r.desc) err(`${at}: 奖励缺 desc`);
  }
}

// ───────── 事件效果 ─────────
const evUse = new Set();
const checkEv = (e, at) => {
  const need = EVENT_EFFECTS[e?.type];
  if (!need) return err(`${at}: 事件效果非法 ${e?.type}（必须是单个 EventEffect 对象）`);
  evUse.add(e.type);
  for (const k of need) if (e[k] === undefined) err(`${at}: ${e.type} 缺 ${k}`);
  if (e.type === 'priceMod' && !['unit', 'item', 'all'].includes(e.target)) err(`${at}: priceMod.target 非法`);
  if ((e.type === 'buffFaction' || (e.type === 'freeUnit' && e.faction)) && !FACTIONS.includes(e.faction)) err(`${at}: faction 非法`);
  if (e.type === 'freeUnit' && e.tier !== undefined && !shop.some((u) => u.tier === e.tier && (!e.faction || u.faction === e.faction))) err(`${at}: freeUnit 无符合条件的单位`);
  if (e.type === 'enemyDebuff' && e.amount <= 0) err(`${at}: enemyDebuff 用正数`);
  if (['firstStrike', 'battleSummon'].includes(e.type) && !['me', 'enemy'].includes(e.side)) err(`${at}: side 应为 me/enemy`);
  if (e.type === 'swapAll' && e.side !== undefined && !['me', 'enemy'].includes(e.side)) err(`${at}: swapAll.side 应为 me/enemy`);
  if (e.type === 'battleStatMul' && !['me', 'enemy', 'both'].includes(e.side)) err(`${at}: battleStatMul.side 非法`);
  if (['addEnemyBoss', 'battleSummon'].includes(e.type) && !byId[e.unitId]) err(`${at}: 单位 ${e.unitId} 不存在`);
  if (['stealEnemy', 'benchEnemy'].includes(e.type) && !/Enemy$/.test(e.target)) err(`${at}: target 应为敌方目标`);
  if (e.type === 'damageOpponent' && !['random', 'leader'].includes(e.target)) err(`${at}: damageOpponent.target 应为 random/leader`);
  if (e.type === 'synergyBonus' && !synKey(e.key)) err(`${at}: synergyBonus.key 应为阵营或职业`);
};
// 选项/突发：effects 数组优先（按顺序结算），兼容单个 effect
const evList = (o, at) => {
  if (Array.isArray(o.effects) && o.effects.length) return o.effects;
  if (o.effect) return [o.effect];
  if (at) err(`${at}: 缺 effect/effects`);
  return [];
};
let comboHeadlines = 0;
let battleHeadlines = 0;
const isBattle = (o) => evList(o).some((e) => BATTLE_EV.has(e?.type));
const headlines = load('headlines.json');
uniq(headlines, 'headlines');
if (headlines.length < 26) err(`头条只有 ${headlines.length} 张（≥26）`);
for (const h of headlines) {
  const at = `头条 ${h.id}`;
  if (!h.title || len(h.title) > 8) err(`${at}: title 缺失或超 8 字`);
  if (!h.news || len(h.news) > 40) err(`${at}: news 缺失或超 40 字（${len(h.news)}）`);
  if (!Array.isArray(h.options) || h.options.length !== 2) { err(`${at}: options 必须 2 个`); continue; }
  h.options.forEach((o, k) => {
    if (!o.label || len(o.label) > 10) err(`${at}.options[${k}]: label 缺失或超 10 字`);
    evList(o, `${at}.options[${k}]`).forEach((e, i) => checkEv(e, `${at}.options[${k}]#${i}`));
  });
  if (JSON.stringify(evList(h.options[0])) === JSON.stringify(evList(h.options[1]))) err(`${at}: 两个选项效果相同，不是取舍`);
  if (h.options.some((o) => Array.isArray(o.effects) && o.effects.length > 1)) comboHeadlines++;
  if (h.options.some(isBattle)) battleHeadlines++;
  if (/死|自杀|枪|深伪|色情|未成年|儿童|五角大楼|国防部/.test(h.title + h.news)) err(`${at}: 含禁用题材`);
}
const surprises = load('surprises.json');
uniq(surprises, 'surprises');
if (surprises.length < 14) err(`突发只有 ${surprises.length} 张（≥14）`);
for (const s of surprises) {
  const at = `突发 ${s.id}`;
  if (!s.title || len(s.title) > 8) err(`${at}: title 缺失或超 8 字`);
  if (!s.news || len(s.news) > 40) err(`${at}: news 缺失或超 40 字`);
  if (typeof s.good !== 'boolean') err(`${at}: good 应为布尔`);
  evList(s, at).forEach((e, i) => checkEv(e, `${at}#${i}`));
}
if (comboHeadlines < 3) err(`组合取舍（effects 多效果）的头条只有 ${comboHeadlines} 张，应 ≥3`);
if (battleHeadlines < 15) err(`「改变战场」的头条只有 ${battleHeadlines} 张，应 ≥15`);
const battleSurprises = surprises.filter(isBattle).length;
if (battleSurprises < 5) err(`「改变战场」的突发只有 ${battleSurprises} 张，应 ≥5`);
const goodRatio = surprises.filter((s) => s.good).length / surprises.length;
if (goodRatio < 2 / 3) err(`突发好事占比 ${(goodRatio * 100).toFixed(0)}%，应 ≥ 67%`);
for (const t of Object.keys(EVENT_EFFECTS)) if (!evUse.has(t)) warn(`事件效果 ${t} 没被任何头条/突发使用`);

// ───────── tutorial ─────────
const tut = load('tutorial.json');
const STEP_IDS = ['buy', 'fight', 'equip', 'merge', 'synergy', 'headline', 'done'];
const LEGACY_STEPS = ['buyAgain', 'item', 'freezeSell'];
if (!tut.seed) err('tutorial: 缺 seed');
if (!Array.isArray(tut.turns) || tut.turns.length < 3) err('tutorial: turns 至少 3 回合');
for (const t of tut.turns ?? []) {
  for (const id of t.units ?? []) if (!byId[id] || byId[id].token) err(`tutorial 回合 ${t.turn}: 商店单位 ${id} 不存在`);
  if (t.items) warn(`tutorial 回合 ${t.turn}: items 是 1.0 字段，2.0 用 equips`);
  for (const id of t.equips ?? []) if (!equipById[id]) err(`tutorial 回合 ${t.turn}: 装备 ${id} 不存在`);
  for (const id of t.consumables ?? []) if (!consumables.some((c) => c.id === id)) err(`tutorial 回合 ${t.turn}: 消耗品 ${id} 不存在`);
  const turnTier = t.turn >= 3 ? 2 : 1;
  for (const id of t.units ?? []) if (byId[id] && byId[id].tier > turnTier) err(`tutorial 回合 ${t.turn}: ${id} 阶级未解锁`);
  let ea = 0, eh = 0;
  for (const e of t.enemy ?? []) {
    if (!byId[e.defId]) err(`tutorial 回合 ${t.turn}: 敌方 ${e.defId} 不存在`);
    ea += e.atk ?? byId[e.defId]?.atk ?? 0;
    eh += e.hp ?? byId[e.defId]?.hp ?? 0;
  }
  if (ea > 3 || eh > 4) err(`tutorial 回合 ${t.turn}: 敌人太强（总 ${ea}/${eh}），前 3 回合要必赢`);
}
const t1 = tut.turns?.find((t) => t.turn === 1);
const t2 = tut.turns?.find((t) => t.turn === 2);
if (!t1 || !t2 || !t2.units.some((id) => t1.units.includes(id))) err('tutorial: 回合 2 商店必须出现回合 1 的同名单位（教合体）');
if (tut.headline && !headlines.some((h) => h.id === tut.headline)) err(`tutorial: 头条 ${tut.headline} 不存在`);
for (const k of Object.keys(tut.steps ?? {})) if (!STEP_IDS.includes(k) && !LEGACY_STEPS.includes(k)) err(`tutorial.steps: 未知步骤 ${k}`);
for (const k of tut.order ?? []) if (!STEP_IDS.includes(k)) err(`tutorial.order: 未知步骤 ${k}`);
if (!(tut.turns ?? []).some((t) => (t.equips ?? []).length)) err('tutorial: 需要有回合在商店放装备（教装备）');
for (const k of STEP_IDS) if (!tut.steps?.[k]?.text) err(`tutorial.steps.${k} 缺 text`);

// ───────── 报告 ─────────
const tierFac = {};
for (const u of shop) (tierFac[`T${u.tier}`] ??= Object.fromEntries(FACTIONS.map((f) => [f, 0])))[u.faction]++;
console.log('阵营 × 阶级分布（商店单位）');
console.table(tierFac);
console.log('阵营合计', facCount);
console.log('职业 × 阵营分布（商店单位）');
console.table(roleFac);
console.log(`2.0 新效果单位 ${newEffUnits.length}：${newEffUnits.join(', ')}`);
console.log('触发器使用（*=召唤物）');
for (const t of TRIGGERS) console.log(`  ${t.padEnd(15)} ${trigUse[t].join(', ')}`);
console.log('效果使用');
for (const e of EFFECTS) console.log(`  ${e.padEnd(13)} ${effUse[e].join(', ')}`);
console.log(`装备 ${equips.length} · 消耗品 ${consumables.length} · 赛场 ${arenas.length} · 对手 ${opponents.length} · PVE ${pve.length} · 旧基建 ${items.length}`);
console.log(`头条 ${headlines.length}（组合 ${comboHeadlines}，改变战场 ${battleHeadlines}）· 突发 ${surprises.length}（好事 ${(goodRatio * 100).toFixed(0)}%，改变战场 ${battleSurprises}）`);
if (warns.length) {
  console.log(`\n警告 ${warns.length} 条：`);
  for (const w of warns) console.log('  ! ' + w);
}
if (errors.length) {
  console.log(`\n错误 ${errors.length} 条：`);
  for (const e of errors) console.log('  ✗ ' + e);
  process.exit(1);
}
console.log('\n✓ 内容数据自检通过');
