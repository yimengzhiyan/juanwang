#!/usr/bin/env node
// 内容数据自检：node shared/data/check.mjs
// 错误（exit 1）：id 重复/缺失、阶级与阵营分布、非法 trigger/effect/target、事件效果非法、文案超长、引用不存在。
// 警告（不影响退出码）：assets/ 下缺少的头像与图标（美术任务补图）。
// 字段口径以 shared/src/types.ts 为准（Ability.amount/atk/hp/n/unitId/count/permanent/perLevel）。
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
const EFFECTS = ['damage', 'buff', 'shield', 'summon', 'copyStats', 'swapPosition', 'gold', 'destroy', 'heal', 'reroll', 'discount', 'pushBack', 'pullFront', 'multiAttack'];
const TARGETS = ['self', 'frontFriend', 'backFriend', 'adjacentFriends', 'randomFriend', 'allFriends', 'lowestHpFriend', 'frontEnemy', 'backEnemy', 'randomEnemy', 'allEnemies', 'lowestHpEnemy', 'highestAtkEnemy', 'killer', 'summoned', 'boughtUnit'];
const FACTIONS = ['open', 'closed', 'compute', 'folk'];
const ABILITY_KEYS = ['trigger', 'effect', 'target', 'amount', 'atk', 'hp', 'permanent', 'perLevel', 'n', 'unitId', 'count', 'desc'];
const ITEM_EFFECTS = { buff: ['atk', 'hp', 'permanent'], shield: ['amount'], copyStatsFrom: [], levelUp: [], gold: ['amount'], summonToken: ['unitId'], teamBuff: ['atk', 'hp', 'permanent'], pullFront: [], transformRandomSameTier: [] };
const EVENT_EFFECTS = {
  gold: ['amount'], priceMod: ['target', 'amount'], freeUnit: [], buffTeam: ['atk', 'hp', 'permanent'], buffFaction: ['faction', 'atk', 'hp', 'permanent'],
  shopRerollFree: [], extraSlot: ['amount'], shieldAll: ['amount'], swapAll: [], duplicate: [], sacrifice: ['amount'], nextTurnGold: ['amount'],
  enemyDebuff: ['amount'], rerollShop: [], levelUpRandom: [], lifeTrade: ['amount'],
};
const ROSTER = {
  1: ['prompt_eng', 'crawler', 'labeler', 'wrapper', 'botnet', 'vibe_coder'],
  2: ['doubao_chan', 'qwen_chan', 'zuck', 'ai_gf', 'scalper', 'leaderboard'],
  3: ['hf', 'kimi', 'mistral', 'lecun', 'hallucination', 'robodog'],
  4: ['claude_chan', 'gemini_chan', 'deepseek_chan', 'dario', 'ilya'],
  5: ['gpt_chan', 'huang', 'altman', 'musk', 'liang'],
  6: ['stargate', 'regulator', 'agi', 'funding'],
};
const TOKENS = ['token_shuijun', 'token_halluc', 'token_gpu'];
const CHARACTERS = ['altman', 'claude_chan', 'dario', 'deepseek_chan', 'doubao_chan', 'gemini_chan', 'gpt_chan', 'huang', 'ilya', 'lecun', 'liang', 'musk', 'qwen_chan', 'zuck'];
const ITEM_IDS = ['gpu_h100', 'dataset', 'finetune', 'distill', 'firewall', 'funding_round', 'launch_event', 'trending', 'jumpbox', 'alignment', 'quantize', 'rlhf'];

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
for (const id of TOKENS) if (!byId[id]?.token) err(`缺少召唤物 ${id}（需 token:true）`);
for (const u of units) if (u.token && !TOKENS.includes(u.id)) err(`名单外的召唤物 ${u.id}`);

const facCount = Object.fromEntries(FACTIONS.map((f) => [f, 0]));
const trigUse = Object.fromEntries(TRIGGERS.map((t) => [t, []]));
const effUse = Object.fromEntries(EFFECTS.map((e) => [e, []]));
for (const u of units) {
  const at = `单位 ${u.id}`;
  if (!u.name) err(`${at}: 缺 name`);
  if (!FACTIONS.includes(u.faction)) err(`${at}: 阵营非法 ${u.faction}`);
  else if (!u.token) facCount[u.faction]++;
  if (!Number.isInteger(u.atk) || u.atk < 0) err(`${at}: atk 应为非负整数`);
  if (!Number.isInteger(u.hp) || u.hp < 1) err(`${at}: hp 应 ≥ 1`);
  if (!Array.isArray(u.lines) || u.lines.length < 2 || u.lines.length > 3) err(`${at}: 台词应 2~3 条`);
  for (const l of u.lines ?? []) if (len(l) > 12) err(`${at}: 台词超 12 字「${l}」`);
  const want = CHARACTERS.includes(u.id) ? `characters/${u.id}.png` : `units/${u.id}.svg`;
  if (u.avatar !== want) err(`${at}: avatar 应为 ${want}，实际 ${u.avatar}`);
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
  const tgt = String(a.target ?? '').replace(/\(\d+\)$/, '');
  if (!TARGETS.includes(tgt)) err(`${at}: target 非法 ${a.target}`);
  if (!a.desc) err(`${at}: 缺 desc`);
  else if (len(a.desc) > 24) err(`${at}: desc 超 24 字（${len(a.desc)}）「${a.desc}」`);
  if (a.effect === 'summon' && !byId[a.unitId ?? 'token_shuijun']) err(`${at}: 召唤的 ${a.unitId} 不存在`);
  if (tgt === 'boughtUnit' && !['buy', 'friendBought'].includes(a.trigger)) err(`${at}: boughtUnit 只配 buy/friendBought`);
  if (tgt === 'summoned' && !['friendSummoned', 'enemySummoned'].includes(a.trigger)) err(`${at}: summoned 只配 *Summoned 触发`);
  if (tgt === 'killer' && !['faint', 'hurt'].includes(a.trigger)) err(`${at}: killer 只配 faint/hurt`);
  const shopTrig = ['buy', 'sell', 'levelUp', 'friendBought', 'startTurn', 'endTurn', 'eatItem'];
  if (shopTrig.includes(a.trigger) && ['damage', 'destroy', 'multiAttack'].includes(a.effect)) err(`${at}: ${a.effect} 在商店阶段无效`);
  if (shopTrig.includes(a.trigger) && /Enemy|killer/.test(tgt)) err(`${at}: 商店阶段没有敌人目标`);
  const perLv = a.effect === 'multiAttack' ? a.perLevel === true : a.perLevel !== false;
  if (perLv && !/每级|×等级/.test(a.desc)) err(`${at}: 按等级缩放但 desc 没写「每级」`);
  if (!perLv && /每级/.test(a.desc)) err(`${at}: 不缩放但 desc 写了「每级」`);
}
for (const f of FACTIONS) if (facCount[f] < 7 || facCount[f] > 9) err(`阵营 ${f} 有 ${facCount[f]} 个，应 7~9`);
for (const t of TRIGGERS) {
  const real = trigUse[t].filter((x) => !x.endsWith('*'));
  if (trigUse[t].length < 2) err(`触发器 ${t} 只被 ${trigUse[t].length} 个单位使用（≥2）`);
  else if (real.length < 2) warn(`触发器 ${t} 由召唤物补足第 2 个：${trigUse[t].join(', ')}`);
}
for (const e of EFFECTS) if (!effUse[e].length) err(`效果 ${e} 没有单位使用`);
  else if (!effUse[e].some((x) => !x.endsWith('*'))) warn(`效果 ${e} 只有召唤物使用：${effUse[e].join(', ')}`);

// ───────── items ─────────
const items = load('items.json');
uniq(items, 'items');
const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
for (const id of ITEM_IDS) if (!itemById[id]) err(`缺少基建 ${id}`);
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
};
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
    checkEv(o.effect, `${at}.options[${k}]`);
  });
  if (JSON.stringify(h.options[0].effect) === JSON.stringify(h.options[1].effect)) err(`${at}: 两个选项效果相同，不是取舍`);
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
  checkEv(s.effect, at);
}
const goodRatio = surprises.filter((s) => s.good).length / surprises.length;
if (goodRatio < 2 / 3) err(`突发好事占比 ${(goodRatio * 100).toFixed(0)}%，应 ≥ 67%`);
for (const t of Object.keys(EVENT_EFFECTS)) if (!evUse.has(t)) warn(`事件效果 ${t} 没被任何头条/突发使用`);

// ───────── tutorial ─────────
const tut = load('tutorial.json');
const STEP_IDS = ['buy', 'buyAgain', 'fight', 'merge', 'item', 'freezeSell', 'headline', 'done'];
if (!tut.seed) err('tutorial: 缺 seed');
if (!Array.isArray(tut.turns) || tut.turns.length < 3) err('tutorial: turns 至少 3 回合');
for (const t of tut.turns ?? []) {
  for (const id of t.units ?? []) if (!byId[id] || byId[id].token) err(`tutorial 回合 ${t.turn}: 商店单位 ${id} 不存在`);
  for (const id of t.items ?? []) if (!itemById[id]) err(`tutorial 回合 ${t.turn}: 基建 ${id} 不存在`);
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
for (const k of Object.keys(tut.steps ?? {})) if (!STEP_IDS.includes(k)) err(`tutorial.steps: 未知步骤 ${k}`);
for (const k of STEP_IDS) if (!tut.steps?.[k]?.text) err(`tutorial.steps.${k} 缺 text`);

// ───────── 报告 ─────────
const tierFac = {};
for (const u of shop) (tierFac[`T${u.tier}`] ??= Object.fromEntries(FACTIONS.map((f) => [f, 0])))[u.faction]++;
console.log('阵营 × 阶级分布（商店单位）');
console.table(tierFac);
console.log('阵营合计', facCount);
console.log('触发器使用（*=召唤物）');
for (const t of TRIGGERS) console.log(`  ${t.padEnd(15)} ${trigUse[t].join(', ')}`);
console.log('效果使用');
for (const e of EFFECTS) console.log(`  ${e.padEnd(13)} ${effUse[e].join(', ')}`);
console.log(`基建 ${items.length} · 头条 ${headlines.length} · 突发 ${surprises.length}（好事 ${(goodRatio * 100).toFixed(0)}%）`);
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
