# 引擎 / 接口说明 2.1（客户端、内容同事必读，补充 DESIGN.md 第 12~18 节）

> **2.1 变更（2026-10-25）见第 12 节**：4 职业 → 6 打法关键词（`role` 取值变了）、商店抽卡权重、对手阵容可查（`Opponent` 新字段）。下文旧条目已按 2.1 改写。

> 类型以 `shared/src/types.ts` 为准；本文解释用法与所有"DESIGN 没写清、引擎做了决定"的地方。1.0 版本见 git 标签 `v1-sap`。

## 0. 启动与目录
```
npm install
npm run dev              # server :3000 + client :5173（/api 代理到 3000）
npm run build            # client → client/dist，server → server/dist/index.js
npm test                 # vitest：shared/test + server/test（含 200 局真实数据模拟，约 20s）
npm run typecheck        # shared + shared/test + server
npm run typecheck:client # 客户端（1.0 客户端迁移到 2.0 API 之前会报错，见第 9 节）
npm run validate-data    # 校验 shared/data/*.json + 整局冒烟
npx tsx scripts/sim-difficulty.ts [局数]   # 难度模拟（第 8 节）
npx tsx scripts/sim-feel.ts [局数]         # 按回合的战斗手感统计
npx tsx scripts/sim-archetypes.ts [局数]   # 10 条流派线各跑 N 局：名次/吃鸡/前四 + 阵营/关键词/单位胜率（第 12.6 节）
npx tsx scripts/sim-levels.ts [局数] [回合]  # 第 T 回合 Lv2+ 单位占比（LEGACY=1 用 2.0 抽卡口径对比）
```
- 前端：`import { newRun, shopAction, ... } from '@juanwang/shared'`。内容数据：`validateData({units, headlines, surprises, tutorial, equips, consumables, arenas, opponents, pve})`。`items.json` 已废弃（传了只出提醒）。
- 素材 URL 规则不变：`UnitDef.avatar` / `EquipDef.icon` 是相对素材根的路径，URL = `'/' + path`。

## 1. 引擎 API（纯函数，输入不被修改，shopAction 不抛异常）
```ts
validateData(raw): GameData                         // 出错抛 DataError(problems)；非致命问题在 data.warnings
newRun(seed, data, opts?: { tutorial?: boolean; arena?: string | null }): RunState
                                                    // 默认 phase='arena'（三选一）；传 arena（null=无赛场）或 tutorial 直接进回合 1
shopAction(state, action, data): RunState           // 非法操作返回原状态 + error（中文，可 toast）
battleForState(state, data, enemy?): BattleResult   // 用 state.matchup.team 开战（种子 `${seed}:t${turn}`，自动带赛场/头条修正）
applyBattleResult(state, result, data): RunState    // 扣血 / 其余对局 / 淘汰 / PVE 奖励 / 突发 / 结局
injectHumanOpponents(state, snapshots, data): RunState  // endShop 后注入服务端真人快照（见第 6 节）
simulateBattle(myTeam, enemyTeam, data, seed, opts?: BattleOptions): BattleResult
computeSynergies(team, data, bonus?): SynergyState[]    // 10 条流派线（阵营 4 + 关键词 6，固定顺序，含未激活）
effectiveStats(unit, data, team?): {atk, hp}        // 显示用：基础 + 临时 + 装备（含算力 ×3 翻倍）
generateArchetypeTeam(archetype|profile, turn, seed, data, opts?{scale, arena}): UnitInst[]
botPlayTurn(state, data, {archetype}): RunState     // 替玩家按流派自动购物一回合（托管/模拟）
runTurnOffline(state, data, {pick?}): {state, result}   // 测试用：endShop→战斗→结算→PVE 选 pick→continue
tutorialStep(state, data?): TutorialStepId | null
// 查询：shopMaxTier shopSlotCounts rerollCost canUpgradeShop turnIncome arenaRules canAttach attachOutcome equipRefund equipInstRefund INVENTORY_SIZE
//       hpLossFor stageBonus rankByHp aliveCount pveForTurn pveTeam computeRunEnd ACHIEVEMENTS SYNERGY_NAME SYNERGY_DESCS
//       ROLE_META SYNERGY_TUNING unitRollWeights OWNED_UNIT_WEIGHT SHOP_ROLL（2.1）
```

### 1.1 一回合的调用顺序（客户端）
```
phase 'arena'    → chooseArena{index}（state.arenaOptions 3 选 1）→ 回合 1
phase 'headline' → chooseHeadline{option}（偶数回合，商店已生成但不能操作）→ 'shop'
phase 'shop'     → buy / sell / reroll / freeze / swap / merge / equip / buyEquipToInventory / unequip / equipFromInventory / sellInventory / useConsumable / upgradeShop …
                 → endShop → phase 'battle'，此时 state.matchup = {kind:'pvp'|'pve', opponentId, name, team, isHuman}
                 →（联机）POST /api/snapshot；GET /api/opponent → injectHumanOpponents(state, opponents, data)
                 → result = battleForState(state, data) → 播放 result.events
                 → state = applyBattleResult(state, result, data) → 'result' 或 'over'
phase 'result'   → 展示 state.lastSummary、state.lastEvents（hpLoss/eliminated/pveReward）、state.lastSurprise
                 → 若 state.pending（PVE 三选一）：choosePveReward{index}
                 → continue → 下一回合
phase 'over'     → state.end = {rank, won, reason, turns, hp, archetype, archetypeName, achievements, bestUnit} → POST /api/result
```

### 1.2 动作 ShopActionInput
| action | 说明 |
|---|---|
| `{type:'chooseArena', index}` | 仅 phase='arena' |
| `{type:'buy', slot, to?}` | 同 1.0：to 空位放入 / 同名合并；不传 to 先合并后空位 |
| `{type:'sell', index}` | 得 = 等级 + 融资 onSell；身上装备按 武器/防具/饰品 顺序**进仓库**，仓库放不下的按件折算（每件 1、金色 2） |
| `{type:'reroll'}` | 免费顺序：头条/赛场刷新免费 → freeRerolls → 1 算力（2.1 删除工程师首刷免费） |
| `{type:'freeze', slot}` / `{type:'swap', a, b}` / `{type:'merge', from, to}` | 同 1.0；merge 时装备合并（见 3.3） |
| `{type:'equip', slot, unitIndex}` | 买商店装备并装到队伍 unitIndex 的单位上；目标槽已有（非合金）装备 → 旧的换进仓库（仓库满报错，不扣钱）（见 3.3 第 16 条） |
| `{type:'buyEquipToInventory', slot}` | 买商店装备直接放进仓库（仓库满报错）；不触发 eatItem，第一次从仓库装上时才触发 |
| `{type:'unequip', unitIndex, slot}` | slot = `'weapon'\|'armor'\|'trinket'`；把该槽装备卸进仓库（免费；仓库满报错） |
| `{type:'equipFromInventory', invIndex, unitIndex}` | 仓库第 invIndex 件装到单位对应槽：空槽装上 / 同名普通 + 普通 → 金色 / 否则替换，**旧装备放回仓库同一位置**（件数不变，不会溢出）；免费 |
| `{type:'sellInventory', invIndex}` | 卖掉仓库里的装备：普通 +1、金色 +2 算力 |
| `{type:'useConsumable', slot, target?}` | 买并使用消耗品；unit 型（转型）需要 target；新闻稿可传 target 指定，否则随机 |
| `{type:'upgradeShop'}` | 4 算力；提前解锁下一阶；每局最多 2 次；会免费重抽未冻结的单位格 |
| `{type:'chooseHeadline', option}` | 仅 phase='headline' |
| `{type:'endShop'}` | endTurn 技能 → RLHF 成长 → 成长 ×4（全队 +1/+1）→ phase='battle' → 推进 7 名对手的购物并确定 matchup |
| `{type:'choosePveReward', index}` | 仅有 pending 时 |
| `{type:'continue'}` | phase='result' 且没有 pending |

## 2. RunState 字段（2.0）
| 字段 | 说明 |
|---|---|
| `turn` `gold` `team`(长度 5) `shop` `phase` | 同 1.0；phase 增加 `'arena'` |
| `inventory: InvEquip[]` | 装备仓库，容量 `INVENTORY_SIZE` = 6，跨回合保留；`InvEquip = {defId, gold, fresh?}`，`fresh` = 从商店买进、还没装过（第一次装上触发 eatItem）。仓库不计分、不参战。旧存档缺这个字段时 `shopAction` 自动补 `[]`（客户端读档也可 `s.inventory ??= []`） |
| `hp` | 热度，初始 20，归零淘汰（取代 lives/trophies） |
| `arena` / `arenaOptions` | 本局赛场 id / 开局可选的 3 个 |
| `shopLevel` / `shopTier` | 升级商店次数（0~2）/ 升级解锁到的阶；商店最高阶 = `max(按回合, shopTier)`（`shopMaxTier(s)`） |
| `opponents: Opponent[]` | 7 名对手：`{id, name, avatar, archetype{faction?,role?}, presetId?, hp, alive, team(本回合阵容), isHuman, eliminatedTurn?, place?, lastTeam, lastSynergies, lastResult?, hpHistory, bot}`；`bot` 是机器人内部记忆，客户端忽略。新字段见 12.4 |
| `economySpent?` | 经济 ×4 的花费进度（0~5） |
| `matchup?` | endShop 后的本回合对局；AI 阵容已按难度缩放 |
| `pve?` | `{pveId, turn, won?}` 当前/最近一次 PVE |
| `pending?` | `{type:'pveReward', pveId, options: PveRewardOption[]}` |
| `pendingHeadline` `lastSurprise` `surprisePending` | 同 1.0 |
| `modifiers` | 本回合修正；新增 `rerollsThisTurn`、`battle: BattleMods`（头条/突发的战场效果）、`wager`、`rewardMul` |
| `lastEvents: BattleEvent[]` | 最近一个动作产生的回合级事件（shopLevelUp / hpLoss / eliminated / pveReward），每个动作开始时清空 |
| `lastSummary?` | 最近一场 BattleSummary |
| `history: BattleRecord[]` | `{turn, winner, kind, opponentId, opponentName, myTeam, enemyTeam, hp, hpLoss, summary}` |
| `stats` | `{maxTiers, wins, losses, pveWins, goldEquips, lv3, steals, upgrades, bestStreak, streak}`（成就用） |
| `end?` | 结局 RunEnd（phase='over'） |
| `log` `error` `rng` `nextUid` `seenHeadlines` `seenSurprises` `tutorial` `lastLevelUp` | 同 1.0 |

`UnitInst` 新增 `equips: {weapon?, armor?, trinket?}`，每个 `{defId, gold}`。**`atk/hp` 是基础属性，不含装备**；显示用 `effectiveStats(u, data, state.team)`。
`ShopSlot.kind` = `'unit' | 'equip' | 'consumable'`；`gold?: true` = 金色装备槽（PVE 奖励 / 头条 freeEquip）；`freeReason` 增加 `'pve'`。

## 3. 规则决定清单
### 3.1 商店 / 局
1. 开局：`newRun` → phase 'arena'（随机 3 个赛场）→ `chooseArena` → 回合 1。7 名对手同时生成（opponents.json 预设按种子洗牌取 7 个；不足 7 个循环使用并加编号）。
2. 回合开始：算力 = 基础曲线 + 下回合加成 + 赛场 goldPerTurn + 经济羁绊（×2 +1 / ×4 +2，不叠加；`turnIncome().economy`）+ 融资装备 turnGold → 修正器清零 → 生成商店 → 待生效突发 → 偶数回合头条 → 商店（startTurn 技能 + 开源 ×5）。
3. 商店：4 单位 + 2 装备 + 1 消耗品（赛场可改单位格/装备格；头条 extraSlot 加单位格）。单位权重见 12.3（2.1：最高阶 3 / 次高 2 / 其余 1，已在队伍中的单位 ×2.5）；装备、消耗品等概率。
4. 价格：单位 3 + 头条修正 + 赛场（全体 / 阵营 / 关键词）− 经济 ×4（1），最低 1；装备 = 数据价 + 头条 item 修正 + 赛场 equipPriceMod，最低 min(1, 数据价)（2.1：经济不再给装备降价）；消耗品 = 数据价 + 头条 item 修正。免费槽恒为 0。每个动作后整体重新定价（经济羁绊会随队伍变化）。
5. 升级商店：4 算力，`shopTier = 当前最高阶 + 1`，`shopLevel++`（最多 2），已是 T6 时不可升；会免费重抽未冻结的**单位格**，并在 lastEvents 发 `shopLevelUp`。之后随着回合推进按回合的阶会追上来（`max`）。
6. 进化同 1.0（3 份 Lv2、6 份 Lv3，每次合并 max+1/+1，进化奖励免费槽 = 当前最高阶 + 1）。（2.1 删除工程师的进化加成。）
7. 头条/突发沿用 1.0 的时机（偶数回合商店前头条；奇数回合结算后 30% 突发、下一回合开始生效）。**战场类效果**写进 `modifiers.battle`，在本回合的战斗生效：头条 = 本回合，突发 = 下一回合（因为突发在下一回合开始时结算）。见 3.6。
8. `lifeTrade`：失去 `DIFFICULTY.lifeTradeHp`（3）热度换 +amount 算力与 1 次免费刷新，热度 ≤ 3 时不生效。`selfHpLoss` / `damageOpponent` 不会直接淘汰人（最低留 1）。
9. 回合上限 20：结算后按热度排名（同热度玩家靠前）。

### 3.2 羁绊（DESIGN 12.1 / 16，`engine/synergy.ts`）
10. 按单位个数统计（不同实例各算 1，等级不计）；**档位逐级叠加**（3 个时 2 个档的效果也生效）。阵营 **2/3/5** → tier 1/2/3（原设计 2/4/6，5 格队伍凑不出 6，已改），关键词 2/4 → tier 1/2。
11. 战斗开场在 start、赛场之后发 `synergyTier`（我方先，阵营在前、关键词在后，每条激活的线一个事件），紧接着是该档的开场效果。商店阶段的档位（开源 ×3/×5、召唤、成长、经济）按当前队伍实时计算。
12. 统计口径：开战时的阵容（不含开战后召唤/偷来的单位），加上羁绊人数加成（赛场 synergyBonus，永久；头条/突发 synergyBonus，本回合，只加我方）。
13. 阵营 ×5 用满 5 格即可达成；赛场/头条的 synergyBonus 可以提前凑档。
14. 各档实现细节：
    - 开源 ×2 开战开源单位本场 +1/+1；×3 买到开源单位（含合体）后全体开源单位永久 +1/+1；×5 回合开始开源单位永久 +1/+1。
    - 闭源 ×2 开战最前排 +3 护盾；×3 每个闭源单位 +floor(战前血量/3)（至少 1）护盾，该单位护盾被打碎时对攻击者反弹 2；×5 反弹改为攻击者攻击力，且闭源单位的护盾不会被穿透（金色显卡无视护盾、destroy 对它们都无效——destroy 改为造成阈值伤害）。
    - 算力 ×2 开战时"装备最多的单位"（件数 → 攻击 → 站位）+2 攻；×3 算力单位的装备数值 ×2（概率封顶 100%，布尔/枚举不变，商店阶段的 RLHF/融资也翻倍）；×5 装备最多的单位每次行动多攻击 1 段。
    - 民间 ×2 开战召唤 1 个水军到最后排；×3 召唤物额外继承召唤者 50% 攻/血（开战水军继承攻+血最高的民间单位），非召唤物友军阵亡时在原位召唤 1 个水军（召唤物阵亡不再触发，避免无限）；×5 召唤物阵亡时对敌方全体 1 伤害（`explode` 事件）。
    - 6 个打法关键词的实现见第 12.2 节。

### 3.3 装备 / 消耗品（`engine/equip.ts`）
15. 装备是永久的，**属性加成不写进 atk/hp**，而是在显示（`effectiveStats`）与开战时计算，所以卸下/换装/变金都能干净地生效。
16. `equip{slot, unitIndex}`：目标槽为空 → 装上；同名普通版 + 普通版 → 合成金色（`stats.goldEquips++`）；已是金色的同名 → 报错"已经是金色版了"（不扣钱）；否则替换，**旧装备换进仓库**（不再折算算力；仓库满 → 报错，不扣钱，提示先卖掉仓库装备或先卸/挪走旧装备）。装上后触发该单位的 `eatItem`（"装上装备时"技能）。`attachOutcome(unit, def, gold)` 可预判 new/gold/replace（客户端高亮用）。
    - 仓库（容量 6）：`buyEquipToInventory` 买进仓库；`unequip` 卸进仓库；`equipFromInventory` 从仓库装上（合金/替换规则同上，换下的放回原仓库格）；`sellInventory` 卖掉（1/金色 2）。卸/装/仓库内互换都免费。
    - eatItem 防刷：只在"从商店买来的装备第一次装上"时触发（直接 equip，或 `fresh` 的仓库装备）；卸下再装、单位间挪装备不触发。`stats.goldEquips`：合成金色时 +1；买金色槽（直接装或进仓库）时 +1；挪动已有金色装备不再计。
17. 出售单位：装备进仓库，放不下的每件 +1（金色 +2）。队伍内 merge：被合并方的装备移到目标空槽；同名普通 → 金色；冲突的折算算力。吞并（copyStats consume）的装备同样折算。
18. 12 件装备效果（数值以 equips.json 为准）：显卡 +3 攻 / 金 +6 且普攻无视护盾；量化 +3/-1 / 金 +6/-1 且普攻溅射目标身后 1；发布会 每次行动 30%（金 60%）多攻击 1 段；热搜 普攻改打血最少的敌人 / 金再 +2 攻；数据集 +1/+3 / 金 +2/+6；防火墙 开战 4 护盾 / 金 8 护盾且碎盾反弹 2；对齐 -1/+5，单次 ≤1 的伤害免疫 / 金 -1/+10；跳板机 阵亡后在最后排以 1 血复活一次 / 金 一半（战前上限的一半）；RLHF endShop 时永久 +1/+1 / 金 +2/+2；蒸馏 开战攻击追平左右相邻友军最高值 / 金 攻血都追平；微调 技能额外触发 1 次 / 金 2 次；融资 每回合 +1（金 +2）算力、出售 +3。
19. 消耗品（不占槽，买了立即用）：咖啡 本回合 +3 次免费刷新；新闻稿 随机（或指定）一个未满级单位 +1 级（触发进化奖励）；转型 指定单位变成同阶随机其他单位（保留额外属性与装备）。

### 3.4 战斗（`engine/battle.ts`，DESIGN 12.6）
20. 开战顺序：`start` → 战前队形（商店的 swapAll/pullFront、头条 enemy swapAll）→ 头条战场修正（benchEnemy → swapFronts → stealEnemy → enemyBoss → battleSummon → statMul → enemyBuff）→ 赛场（`arena` 事件 + statAll/startShield）→ 羁绊 → 装备开场（防火墙、蒸馏）→ startBattle 技能 → 交替开火。
21. **交替开火**：先手方（缺省我方；头条 firstStrike 可改；`start.first` 给出）1 号位行动 → 对方 1 号位 → 我方下一位 → …。每方有自己的"轮到谁"游标：行动后指向它身后的单位，到末尾回到 0；阵亡者跳过（身后的顶上）；复活到最后排的单位按新位置轮转。
22. 一次**行动** = beforeAttack 技能 → n 段攻击（multiAttack、算力 ×5 +1、发布会概率 +1）→ 追击（chain）。每段攻击：目标 = 装备 retarget（热搜）> UnitDef.attackTarget > 敌方最前排；发 `attack` 事件后结算 `damage`，量化金色再对目标身后单位溅射。
23. 60 次行动（`MAX_ACTIONS`）后仍未分胜负：按双方剩余血量总和判定（相等 = 和局），`end.reason = 'timeout'`。双方同时清空 = 和局。
24. 战场每方最多 7 个单位（`MAX_FIELD`），满了召唤/偷取/复活失败（无事件）。
25. **护盾改为血池**：吸收伤害直到耗尽，耗尽那一下发 `shieldBroken: true`（反弹在这时结算）。所有伤害（普攻/技能/爆炸/溅射/反弹）都先扣护盾；只有"无视护盾"的普攻（金色显卡）能跳过，闭源 ×5 的护盾连它也挡。destroy 无视护盾（闭源 ×5 例外）。
26. 免疫（对齐）：单次伤害 ≤ 阈值时整段免疫，`damage.immune = true, amount = 0`。
27. 反弹伤害不会再触发反弹；反弹算作被反弹者的"反弹伤害"计入总结。
28. 触发排序同 1.0：同一批按攻击高→低、我方先、站位前→后；死亡在每次技能结算后立即处理。faint / kill 即使单位已死也结算。
29. 技能重复：微调 +1/+2 次，上限 5（2.1 删除研究员 ×4）；每次重复单独发 `ability` 事件（`repeat` 从 1 开始），并发 `equipProc`（微调）。
30. 1.0 扩展全部保留：`perLevel`、`filter`（`role` = 打法关键词）、`consume`、`maxHp/maxHpPerLevel`、`choices`、`n`、`count`、`unitId`。

### 3.5 新效果（DESIGN 13）
31. `steal`：对目标敌人（按 target 选，常用 lowestHpEnemy）若当前血量 ≤ 阈值（`maxHp + (lv-1)×maxHpPerLevel`，未写 maxHp = 无条件）且我方未满 → 移到我方末尾（uid 不变，本场为我方作战，不写回永久 buff）；否则造成阈值点技能伤害。事件 `steal {unit(偷前), source, to(偷后)}`。
32. `explode`：对 targets（一般 allEnemies）造成 自身攻击 × amount(缺省 1) 的伤害，`explode` 事件后跟 `kind:'explode'` 的 damage。阵亡时触发也用阵亡前的攻击。
33. `doubleStats`：目标本场攻、血翻倍，每个单位每场一次（之后的触发无效）。AGI 的 hurt + doubleStats = "首次受伤翻倍"。
34. `revive`：目标已阵亡（faint 时 target self）→ 在原位以 amount（缺省 1）血复活；目标存活 → 获得"下次阵亡复活一次"。每个单位每场最多被技能复活一次。装备复活（跳板机）另算一次，技能复活优先。事件 `revive {unit 快照, via:'ability'|'equip'}`；faint 事件照常发（单位确实死过），faint/friendFaint/kill 照常触发。
35. `chain`：目标获得 amount（缺省 1）次追击；在当前行动结束后立刻攻击（`chain` 事件 + 一次 attack），每个单位每次行动最多 5 次。
36. 这 5 个效果缺省**不**随等级缩放（`perLevel:true` 才缩放）；steal 的阈值通过 maxHpPerLevel 随等级增长。

### 3.6 头条/突发的战场类效果（内容 2.0 新增）
| effect | 引擎实现 |
|---|---|
| `enemyBuff{atk,hp}` | 敌方全体本场 +atk/+hp（buff 事件） |
| `firstStrike{side}` | 本场先手方 |
| `swapFronts` | 开战时双方最前排互换阵营（两次 `steal` 事件），各自放到对方最前排 |
| `battleStatMul{atk?,hp?,side}` | 本场属性倍率（me/enemy/both），以 buff 事件表现 |
| `addEnemyBoss{unitId,atk,hp,rewardMul}` | 敌方末尾加一个 Boss（summon 事件）；本回合打赢时对手掉血 × rewardMul |
| `goldenEquips` | 我方所有装备本场按金色效果生效 |
| `summonBuff{atk,hp}` | 我方本场召唤物 +atk/+hp（与赛场人海时代叠加） |
| `damageOpponent{amount,target}` | 立即让 random（随机存活对手）/ leader（热度最高）掉血，最低留 1；lastEvents 里 hpLoss |
| `stealEnemy{target}` | 开战时把目标敌人偷到我方末尾（无血量门槛） |
| `selfHpLoss{amount}` | 立即掉热度，最低留 1 |
| `battleSummon{side,unitId,count}` | 开战时为该方末尾召唤（不继承属性，吃 summonBuff） |
| `synergyBonus{key,amount}` | 本回合我方该线人数 +amount（商店与战斗都算） |
| `wager{winGold,loseHp}` | 本回合 PVP 赢了下回合 +winGold；输了额外掉 loseHp |
| `benchEnemy{target}` | 开战时目标敌人下场（`faint` 事件带 `benched:true`，不触发任何技能） |
| `freeEquip{gold?,slot?}` | 商店追加一个免费装备槽（可金色、可限槽位） |
| `swapAll{side:'enemy'}` | 开战时敌方队伍反转（不带 side 仍是我方反转） |

### 3.7 8 人房（`engine/lobby.ts`）
37. 每回合 endShop 时：7 名对手各自按流派推进一个商店回合（机器人记忆存在 `opponent.bot`），然后为玩家随机匹配一名存活对手（存活 >1 人时不连续两回合同一人）。
38. 结算时：玩家这场按公式扣血；其余存活对手随机两两互打（先手随机，赛场相同）；落单者打随机一名其他对手阵容的"幽灵"（只影响落单者）。
39. **扣血 = 1 + 胜方存活单位数（含召唤物/偷来的）+ 回合阶段（1~4：0，5~8：1，9+：2）**；和局双方都不掉。
40. 淘汰：本回合热度 ≤ 0 的人按剩余热度高→低排名次（名次 = 淘汰后存活人数 + 1 起），玩家与对手同分时玩家靠前；`eliminated {who, name, place, remaining}`。玩家淘汰 → over；只剩玩家 → 吃鸡；回合 20 → 按热度排名。
41. AI 对手的阵容在与玩家交战时按 `opponentScale` 缩放（第 8 节）；AI 之间互打不缩放；真人快照不缩放。
42. `injectHumanOpponents(state, [{name, team, hp?, avatar?}], data)`：在 endShop 之后调用。优先替换同名真人，否则替换 AI（按顺序），被替换者 `isHuman=true`、阵容 = 快照、流派按快照阵容的最高羁绊判定；若替换的是本回合对手，同步 `matchup`（不缩放）。之后的回合该对手继续用机器人记忆在快照阵容上推进；每回合可以再注入。

### 3.8 PVE（`engine/pve.ts`）
43. 回合等于 pve.json 的 turn（4、9）时，matchup = 怪物队（`kind:'pve'`），不扣热度。引导局固定回合内不出 PVE。
44. 玩家赢：从 `rewards.pool` 不重复抽 `pick` 个，生成 `pending.options`（unit：阶 = min(6, 当前最高阶 + tierBonus) 的随机单位；goldEquip：随机装备的金色版；gold：+amount）。`choosePveReward`：单位/装备 → 商店免费槽（**已冻结**，下回合开局还在，freeReason 'pve'）；算力 → 下回合 +amount（回合开始到账）。有 pending 时 continue 会报错。
45. 对手同回合也打 PVE（只模拟），赢的 AI 下回合多拿池子里的算力奖励（缺省 6），不扣血。

### 3.9 结算与总结（`engine/result.ts` / `summary.ts`）
46. `BattleResult.summary = {mvpUid, mvpDefId, damageByUid, reason, synergyTiers}`。damageByUid 记录双方每个单位的实际扣血（不含溢出），含技能/反弹/爆炸/溅射。归因按顺序取第一条：① 我方 MVP 伤害占我方总伤害 ≥ 50% → "Lv2 标注员 一人打出 12 点伤害"；② 民间 ≥4 且我方召唤物 ≥4 → "民间 ×3 的水军潮淹没对手"；③ 闭源 ≥4 且我方反弹伤害 ≥ 总伤害 30% → "闭源 ×3：对手撞死在盾上"；④ "前排 X 硬扛了 N 枪"（被普攻命中最多的我方单位）。
47. `RunEnd.archetype`：最终阵容的羁绊里档位最高的线（同档比个数，再同阵营优先），全部未激活 = `'mixed'`（"杂牌军"）；`archetypeName` 如"开源流"。
48. 成就 id（`ACHIEVEMENTS` 有中文名）：champion、top4、survivor10、goldEquip、lv3、pveAll、upgradeMax、streak5、steal、`tier:<key>:<tier>`（阵营 ×3/×5、职业 ×4）。"首次达成"由客户端对比 localStorage。

### 3.10 引导局
49. 不选赛场；固定回合的商店 = units + equips + consumables（tutorial.json 的 `equips/consumables`，兼容旧 `items`）；固定对手进 matchup。
50. `tutorialStep(state, data)` 按 `tutorial.order`（缺省 buy, fight, equip, merge, synergy, fight, headline, fight, done）返回第一个未完成步骤：buy = 买过单位；fight 第 k 次 = 打完 k 场；equip = 装过装备/用过消耗品；merge = 有单位进化；synergy = 买单位后队伍点亮过任一羁绊；headline = 选过引导头条；全部完成 → done。phase=headline 时返回 'headline'（引导已完成则 'done'）；battle/result 返回 null。

## 4. BattleEvent（客户端按顺序播放，所有事件都有中文 `text`）
单位引用 `UnitRef = {uid, defId, side, pos}`；`UnitSnap = UnitRef + {atk, hp, level, shield, equips}`。敌方 uid = `'e_' + 原 uid`；召唤物 `s<n>_<召唤者uid>`；被偷的单位 uid 不变但 side 变了。
```ts
{type:'start', me, enemy: UnitSnap[], first: 'me'|'enemy', arena?}       // 战前阵容（含装备静态加成、临时加成）
{type:'arena', arena, name}                                              // 赛场规则生效（statAll / startShield）
{type:'synergyTier', side, kind:'faction'|'role', key, name, count, tier, line?: {unit, line}}  // text 如 "开源 ×3：共享升级！"
{type:'ability', unit, trigger, effect, targets, repeat}                 // repeat>1 = 微调的重复触发
{type:'attack', action, unit: UnitRef&{atk}, target, hit, hits}          // 一段普攻；action = 第几次行动
{type:'damage', unit, source?, amount, blocked, hp, shield, kind:'attack'|'ability'|'reflect'|'explode'|'splash', immune?, shieldBroken?}
{type:'buff', ..., permanent, synergy?}   // permanent=true → 赛后写回，播金色"永久 +N"浮字；synergy = 触发它的羁绊线（2.1）
{type:'heal' | 'shield' | 'summon' | 'move' | 'multiAttack' | 'bonus' | 'say'}  // 同 1.0
{type:'faint', unit, killer?, consumed?, benched?}
{type:'steal', unit, source, to}
{type:'explode', unit, amount, targets}
{type:'revive', unit: UnitSnap, via:'equip'|'ability', source?}
{type:'chain', unit, count}
{type:'equipProc', unit, equipId, slot, gold}                            // 装备生效：闪一下装备小图标
{type:'end', winner, actions, reason:'wipe'|'timeout', hpLeft:{me, enemy}, me: uid[], enemy: uid[]}
// 回合级（在 state.lastEvents 里，不在 BattleResult.events 里）：
{type:'shopLevelUp', shopLevel, tier}
{type:'hpLoss', who:'me'|opponentId, name, amount, hp, by?}
{type:'eliminated', who, name, place, remaining}                         // "还剩 N 人"横幅用 remaining
{type:'pveReward', pveId, options}
```
`BattleResult = {winner, events, enemyTeam, actions, survivors, permanentBuffs, bonus, summary}`。
播放建议：start → move/steal（队形与头条）→ arena → synergyTier 横幅（0.6s 慢放 + 台词）→ equipProc/shield → 开战技能 → 循环 [attack → damage(×n) → faint/revive/explode/技能链] → end。

## 5. 内容数据格式（validateData 认的字段；内容同事当前的写法都已兼容）
- **units.json**：在 1.0 基础上 + `role: multi|shield|summon|explode|growth|economy`（也认中文 多刀/护盾/召唤/自爆/成长/经济；**旧职业 researcher/trader/idol/engineer 及其中文会报错并提示迁移**，见 12.1）、`attackTarget?: frontEnemy|backEnemy|randomEnemy|lowestHpEnemy|highestAtkEnemy`、`lines` 可以是数组（旧）或对象 `{common: string[], onSynergy: string|string[]}`（其余键的数组都并入通用台词）。PVE 怪物直接写在 units.json 里带 `token:true`。规范化后 `UnitDef.lines = {general, onSynergy?}`。
- **equips.json**：`{id, name, slot, price, desc, goldDesc, effect, goldEffect, icon}`。effect 写法：`stat{atk,hp,ignoreShield?,splash?,immuneAtMost?}`、`extraAttack{chance}`、`retarget{target,atk?}`、`startShield{amount,reflect?}`、`revive{hp|hpRatio,to:'back'|'same'}`、`growth{atk,hp}`、`copyNeighbor{stats:['atk','hp']}`、`abilityRepeat{times}`、`income{perTurn,onSell}`；也可以是这些对象的数组（叠加）。没写 goldEffect = 数值 ×2。12 个固定 id 的效果读不懂时回退内置并提醒；未知 type 报错。
- **consumables.json**：`{id, name, price, targetKind, desc, effect, icon}`，effect.type：`freeRerolls{amount}` / `levelUpRandom` / `transformRandomSameTier`（还认 `gold`、`buff`）。
- **arenas.json**：`{id, name, desc, icon, effect}`，effect（单个或数组）：`priceMod{kind:'unit'|'equip', amount, filter?{faction|role}}`、`statAll{atk,hp}`、`economy{goldPerTurn?,unitSlots?,equipSlots?,rerollFree?,unitPriceMod?,equipPriceMod?}`、`rerollBuff{slot,atk,hp,cap?}`（slot 目前只支持 0 = 最前排，每回合最多 cap=5 次）、`shopSlots{kind,amount}`、`summonBuff{atk,hp}`、`synergyBonus{key,amount}`、`startShield{amount,filter?}`。
- **opponents.json**：`{id, name, avatar, archetype: 'compute'|'researcher'|{faction?,role?}, core?: defId[], equips?: equipId[], taunt?: {defeated, victory}}`。core 单位机器人额外加分。
- **pve.json**：`{id, turn, name, avatar, desc, team: [{defId, atk?, hp?, level?, count?}], boss: {defId, skillName, skillDesc}|null, tip, rewards: {pick, pool: [{type:'unit', tierBonus} | {type:'goldEquip'} | {type:'gold', amount}]}}`。
- **tutorial.json**：turns 的 `equips` / `consumables`（兼容 `items`）、`order`、steps 键 buy/buyAgain/fight/equip/merge/synergy/item/freezeSell/headline/done。
- 缺少任何 2.0 新文件时引擎用内置默认（`shared/src/defaults.ts`）并在 `data.warnings` 里写明；`npm run validate-data` 会打印。

## 6. HTTP API（失败时客户端静默降级为离线）
| 接口 | 请求 | 响应 |
|---|---|---|
| `POST /api/snapshot` | `{name, room?, turn(1~20), hp?(0~20,缺省20), archetype?, team(1~5 个 UnitInst，含 equips), seed}` | `{ok:true}` |
| `GET /api/opponent?turn&room&name&seed&limit` | 同回合，最多 limit（缺省/上限 7）条**不同名字**的快照，排除 name 本人；有 room 时先同房间再用全服补齐；随机顺序 | `{opponents: [{name, team, hp, archetype, turn, room}]}` |
| `POST /api/result` | `{name, room?, rank(1~8), turns(1~20), hp(0~20), archetype?, seed, bestUnit?}` | `{ok, best(是否刷新个人最佳), position(全服榜位置)}` |
| `GET /api/leaderboard?room&date` | 同 1.0 | `{room, date, entries:[{pos, name, rank, turns, hp, archetype, won, seed, bestUnit, date, room}]}` |
| `GET /api/daily` / `GET /healthz` | 不变 | |
- archetype 合法值：open/closed/compute/folk/multi/shield/summon/explode/growth/economy/mixed（= `state.end.archetype`）；2.0 的 researcher/trader/idol/engineer 过渡期仍接受（旧客户端缓存），原样存储。装备 id 按 shared/data/equips.json（缺失时内置 12 件）白名单校验。
- 榜单排序：名次小 → 同名次时吃鸡比回合少、其余比存活回合多 → 热度高 → 更早。`won = rank === 1`。
- 存档 version 2；1.0 的存档（trophies/lives 口径）加载时丢弃。

## 7. 机器人（`engine/bot.ts`）
- 2.1：玩家托管/模拟的机器人没有预设装备时，按流派线的缺省偏好买装备（`ARCHETYPE_EQUIPS`，关键词优先，如成长 → RLHF/数据集、护盾 → 防火墙/对齐、多刀 → 发布会/显卡）。
- 估值 = 阶×3 + 攻 + 血（场上单位 + 等级×4 + 装备件数×3）+ 流派匹配 14 + 核心单位 4 + 与现有队伍同线 +1/个（上限 3）。
- 每回合：合体优先 → 空位买估值最高 → 满员时卖最弱换更强（流派内单位只会被流派内单位替换，流派单位优先顶掉流派外的单位，带装备的不卖）→ 装备往主力（流派内估值最高者）上堆（空槽或能合成金色才装，偏好装备优先）→ 消耗品（新闻稿/咖啡）→ 回合 ≥3、满员、有余钱时升级商店 → 刷新（`DIFFICULTY.botRerolls` 次，流派成员 <3 时多 2 次）→ 排阵（血厚、阵亡/受伤/复活技能、穿防具的在前；开战技能、带武器的靠后）。
- 不吃头条/突发；AI 对手每回合与玩家一样的商店规则（赛场相同）。

## 8. 难度（`DIFFICULTY`，`shared/src/engine/difficulty.ts`）
| 参数 | 默认 | 含义 |
|---|---|---|
| `earlyTurns` / `earlyScale` | 4 / 0.9 | 前 4 回合 AI 对手（与玩家交战时）属性 ×0.9 |
| `rampTurns` / `maxScale` | 6 / 1.0 | 之后每回合线性回升，6 回合后到 1.0 |
| `lowHpThreshold` / `lowHpScale` | 6 / 0.9 | 玩家热度 ≤6 时再 ×0.9（橡皮筋） |
| `botRerolls` / `botUpgradeFromTurn` | 2 / 3 | 机器人刷新次数、开始考虑升级商店的回合 |
| `surpriseChance` | 0.3 | 突发概率 |
| `lifeTradeHp` | 3 | 头条 lifeTrade 的代价 |

模拟口径：`scripts/sim-difficulty.ts`，玩家 = `botPlayTurn`（机器人水平，8 条流派轮流），头条选第 0 项，赛场轮流选第 0/1/2 个，PVE 奖励轮流选，真实数据 shared/data。

| 方案（每组 600~800 局） | 结束回合中位数（P25/P75） | 平均名次 | 吃鸡率 |
|---|---|---|---|
| early 0.85 → max 1.0（初版机器人） | 12（10/14） | 3.64 | 18.0% |
| **early 0.9 → max 1.0（采用）** | **11（10/14）** | **3.95** | **14.1%** |
| early 0.9 → max 1.05 | 11（10/13） | 4.03 | 13.3% |
| early 0.95 → max 1.05 | 11（8/13） | 4.06 | 13.6% |

名次分布大致均匀（机器人对机器人，玩家只多了先手与前期 ×0.9 的优势）。`npm test` 里的 realdata 测试固定种子跑 200 局，断言中位回合 10~14、平均名次 3.4~4.6、吃鸡率 10%~20%。

（上表是阵营门槛 2/4/6 时测的；改成 2/3/5 后 8 条流派合计平均名次 3.97，realdata 的 200 局断言仍通过。）

### 8.1 流派平衡（`scripts/sim-archetypes.ts`）
机器人玩家分别偏好 8 条流派各跑 N 局（默认 300），赛场轮流选第 0/1/2 个、PVE 奖励轮流选、头条选第 0 项。输出：
- 每条流派的平均名次、吃鸡率、前四率、平均存活回合、"达成中档"率（阵营达成过 ×3 / 职业达成过 ×2 的局占比）；
- 阵营/职业胜率贡献：玩家每场 PVP（不含和局）里，每个单位按 1/阵容人数 的权重计入它的阵营与职业，胜率 = Σ(胜×权重)/Σ权重；
- 单位胜率：该单位上场时我方的胜率与出场次数。**注意幸存者偏差**：高阶单位多在后期、且常在机器人落后时才买到，胜率天然偏低；比较同阶单位更有意义。

当前结果（阵营 2/3/5，DIFFICULTY 默认，每流派 300 局，真实数据 2026-10-23）：

| 流派 | 平均名次 | 吃鸡率 | 前四率 | 平均回合 | 达成中档 |
|---|---|---|---|---|---|
| 工程师 | 2.64 | 39.3% | 83.7% | 12.8 | 100% |
| 民间 | 2.69 | 22.3% | 89.3% | 12.6 | 99.7% |
| 研究员 | 3.70 | 16.0% | 67.3% | 11.1 | 85.0% |
| 开源 | 3.82 | 11.7% | 65.7% | 11.3 | 94.7% |
| 偶像 | 4.09 | 8.7% | 61.3% | 10.7 | 98.7% |
| 算力 | 4.33 | 13.7% | 49.3% | 10.3 | 56.3% |
| 闭源 | 4.89 | 5.3% | 41.3% | 9.6 | 68.0% |
| 商人 | 5.60 | 0.3% | 27.7% | 8.4 | 98.7% |

阵营/职业胜率贡献：民间 59.5%、工程师 58.1%、开源 53.9%、偶像 53.6%、研究员 48.8%、算力 47.7%、商人 42.7%、闭源 41.0%。
同阶对比里最突出的：T1 水军机器人 65.8%（自爆 + 民间/工程师双线）、标注员 59.1%、提示词工程师 58.9% 明显强于 T1 套壳 App 40.7%；T2 评测榜单 59.0%、AI 女友 56.5% vs 显卡黄牛 41.0%、小扎 40.0%；T5 马一龙 18.9%、老黄 27.4%、奥特曼 28.4% 偏低（商人线整体弱）。

## 9. 已知问题 / 需要设计或内容确认
1. （已解决）阵营门槛改为 2/3/5，5 格队伍可以凑满最高档。
2. 流派强弱不均（第 8.1 节）：工程师/民间明显偏强（T1 民间工程师双线单位太多，水军机器人尤其强），商人最弱（吃鸡率 0.3%），闭源、算力偏弱（算力没有 T4 单位，只有 56% 的局能凑到 ×3）。
3. 1.0 客户端尚未迁移：`npm run build` 通过（shared 暂留 5 个 @deprecated 兼容导出：unitSlotsForTurn / itemSlotsForTurn / WIN_TROPHIES / SYNERGY_THRESHOLD / SYNERGY_DESC，见 `shared/src/compat.ts`），但 `npm run typecheck:client` 会报错，迁移完成后把它并回 `typecheck` 并删除 compat.ts。

## 8.2 平衡后的流派表（2026-10-23 晚，数据版本见 git）
每流派 200 局：民间 3.27 / 开源 3.52 / 算力 3.68 / 商人 3.78 / 闭源 3.81 / 工程师 3.88 / 研究员 3.89 / 偶像 3.92（平均名次）。吃鸡率 10%～24.5%，胜率贡献 54.7%～57.2%。玩家整体略强于 AI（先手 + 头条/PVE 选择权），属有意保留的休闲向手感。8.1 节的旧表作废。

## 10. 2026-10-24 调整
- 起始算力曲线 `baseGoldForTurn(turn)`：回合 1~2 为 7，3~4 为 8，5~6 为 9，7+ 为 10（引导局固定 10）。玩家反馈前期算力太多、选择无意义。
- `Ability.name`（≤5 字）与 `Ability.shortDesc`（≤10 字）、`EquipDef.shortDesc/goldShortDesc`（≤8 字）：卡面直接显示，数据已全部填写。

## 11. 装备仓库 · 客户端实现要点（2026-10-24）
- 位置：仓库条放在**队伍与商店之间**，6 格横排（空格画虚线框），右侧显示 `inventory.length / INVENTORY_SIZE`；满了整条描红。
- 拖拽：
  - 商店装备 → 单位：`equip{slot, unitIndex}`；商店装备 → 仓库条：`buyEquipToInventory{slot}`。
  - 单位身上的装备格 → 仓库条：`unequip{unitIndex, slot}`。
  - 仓库格 → 单位：`equipFromInventory{invIndex, unitIndex}`（装到该装备自己的槽，不看落点在哪个格）；仓库格 → 出售区：`sellInventory{invIndex}`。
  - 拖装备悬停到单位上时用 `attachOutcome(unit, def, gold)` 提示：new = "装上"、gold = "合成金色！"、replace = "替换（旧的进仓库）"；`canAttach` 非空时显示禁止。仓库满且结果是 replace 时预先置灰。
- 出售单位后，装备进仓库（toast 用 log 最后一行即可）；出售区可以显示"装备将进仓库"。
- `fresh` 的仓库装备可加个小"新"角标（第一次装上会触发"装上装备时"技能）。
- 错误文案都在 `state.error`，直接 toast（见下方清单）。
- 错误文案：`仓库已满（最多 6 件），先卖掉或装上一件吧`（unequip / buyEquipToInventory）、`仓库已满，换下的旧装备放不下：先卖掉仓库里的装备，或先把旧装备卸下/装到别人身上`（equip 替换）、`仓库里没有这件装备`、`这个槽没有装备`、`没有这个装备槽`、`这里没有单位`、`请选择一个单位`、`没有这件装备`、`未知装备`、`算力不够，需要 N 算力`、`已经是金色版了…`、`现在不是商店阶段`。
- 引导局不涉及仓库（tutorial.json 不变，原 `equip` 动作照常）。

## 12. 2.1 变更（2026-10-25，DESIGN 16~18）
> 第 8.1 / 8.2 节的流派表是 2.0（4 职业）时代的历史数据，以本节 12.6 为准。

### 12.1 `role` = 打法关键词
- `Role = 'multi' | 'shield' | 'summon' | 'explode' | 'growth' | 'economy'`（`ROLES` 按此顺序）。字段名仍叫 `role`，`UnitDef.role`、`Archetype.role`、`TargetFilter.role`、`ArenaRules.rolePriceMod`、`synergyBonus.key` 都用新值。
- 校验器接受英文与中文（多刀/护盾/召唤/自爆/成长/经济）。**旧职业 researcher/trader/idol/engineer（及中文）一律报错**，文案形如：`单位 prompt_eng: role "researcher" 是 2.0 的旧职业（研究员），2.1 已改为打法关键词，请改成 multi/shield/summon/explode/growth/economy（多刀/护盾/召唤/自爆/成长/经济）之一（DESIGN 第 16 节）`。覆盖 units.role、技能 filter.role、赛场 priceMod.filter.role / rolePriceMod / synergyBonus.key、头条突发 synergyBonus.key、对手 archetype。
- 非致命提醒（warnings）：商店单位缺 role；某关键词不是 5~6 个；某关键词 T1~T2 少于 2 个。
- `computeSynergies` 输出 10 条线：阵营 4（2/3/5）+ 关键词 6（2/4），固定顺序 `open, closed, compute, folk, multi, shield, summon, explode, growth, economy`。`dominantSynergy` 规则不变（档位 → 个数 → 阵营优先），所以"4 个多刀 + 3 个开源"判为多刀流。
- 成就：`tier:<关键词>:2`（"打法·多刀 ×4" 等），阵营的 ×3/×5 不变；结局 `archetypeName` 如"多刀流"。
- 已删除：研究员（回合结束 +1 攻、技能双发）、商人、偶像、工程师（进化加成、首刷免费）的全部效果。

### 12.2 关键词羁绊（`ROLE_META` / `SYNERGY_TUNING`，`engine/synergy.ts`）
`ROLE_META[role] = {key, name, tagline, thresholds:[2,4], descs:[2 档说明, 4 档说明], shouts}`，客户端直接显示 name / descs（`SYNERGY_NAME` / `SYNERGY_DESCS` / `SYNERGY_SHOUT` 与它同源）。数值集中在 `SYNERGY_TUNING`（descs 按它生成），当前值：

| 关键词 | 2 个 | 4 个（含永久成长路径） |
|---|---|---|
| 多刀 | 多刀单位每次行动 25% 多 1 段 | 必定多 1 段；**额外那段（本次行动的最后一段，段数 ≥2 时）命中后该单位永久 +1 攻** |
| 护盾 | 开战时护盾单位 +**4** 护盾（设计 3，平衡上调） | 开战时全体友军获得"碎盾反弹 3"（与闭源 ×3 的 2 取大）；**护盾单位每被打碎一次护盾，永久 +1/+2** |
| 召唤 | 召唤物 **+2/+2**（设计 +1/+1） | 召唤物 **+3/+3**（设计 +2/+2）；开战额外召唤 1 个水军到最后排；**每次召唤，召唤者永久 +2/+2**（设计 +1/+1） |
| 自爆 | 爆炸伤害 **+1**（explode 技能、自爆单位的阵亡伤害技能、×4 自爆；按目标各 +1） | 自爆单位阵亡时：对敌方最前排造成 自身攻击 +1 的伤害，并对敌方全体 1 余波（只限自爆单位阵亡，非自爆友军阵亡不触发）；**每次爆炸后，其余存活的自爆友军永久 +1/+1** |
| 成长 | 成长单位每次获得永久加成时额外 +1/+1 | **成长单位获得永久加成时，相邻友军获得同样加成（原始数值，不再继续传递；成长邻居仍吃 ×2 的 +1/+1）**；回合结束（endShop）全队永久 +1/+1 |
| 经济 | 每回合 **+2** 算力（设计 +1） | 每回合 **+3** 算力（设计 +2），单位 -1 价（装备不降价）；**每花掉 4 算力（设计 6），随机一名经济单位永久 +1/+1** |

实现细节：
- "永久加成"（成长 ×2/×4 认的）= 技能 permanent buff、开源 ×3/×5、RLHF、1 号位光环、头条 buffTeam/buffFaction permanent、消耗品永久 buff、关键词 ×4 的成长、经济 ×4、成长 ×4 回合末加成。不含合体/进化的 +1/+1 与召唤物出生属性。商店侧统一走 `permGrow(ctx, unit, atk, hp)`。
- 召唤的加成在商店召唤（`shopSummon`）与战斗召唤都生效（与赛场 summonBuff、头条 summonBuff、民间 ×3 继承叠加）；"召唤者"= 召唤技能的施放者 / 民间 ×3 开战水军的继承来源 / 民间 ×3 友军阵亡召唤里阵亡的那个单位（阵亡也照样记永久成长）。开战额外水军没有召唤者。
- 战斗内的永久成长：存活单位发 `buff` 事件 `{permanent:true, synergy:<key>}`（文案如"越砍越快：永久 +1 攻（多刀 ×4）"），写进 `BattleResult.permanentBuffs`，`applyBattleResult` 赛后写回队伍；已阵亡的我方原队伍单位不发事件但同样写回。敌方/偷来/召唤物不写回。成长 ×2 触发的那次 buff 也带 `synergy:'growth'`，文案后缀"（成长 +1/+1）"。**客户端：`buff.permanent === true` 播金色"永久 +N"浮字。**
- 经济 ×4 的花费：buy / reroll / equip / buyEquipToInventory / useConsumable / upgradeShop 的实付算力，只在 ×4 激活时累计到 `RunState.economySpent`（跨回合保留；机器人存在 `BotMemo.economySpent`）。商店侧扣钱统一走 `spendGold(ctx, n)`。
- `turnIncome()` 返回字段 `trader` 改名为 **`economy`**。
- 自爆 ×4 的"任意友军阵亡全体 1 伤"按协调要求限定为自爆单位阵亡（2.1 表格里已删此句，保留为余波，数值 `explodeAftershock`）。

### 12.3 商店抽卡（DESIGN 17）
- 阶权重 `tierWeights(maxTier)`：当前最高阶 3、次高阶 2、其余 1（原为阶数 t）。
- 逐单位权重 `unitRollWeights(data, maxTier, ownedDefIds)`：阶的总权重平均分给该阶单位，**已在队伍中的 defId ×2.5**（`OWNED_UNIT_WEIGHT`；仓库/装备无关）。商店刷新、头条 extraSlot 都用它；指定阶的抽取（进化奖励、freeUnit、PVE 奖励、转型）不加权。客户端可用它显示出现概率。
- `SHOP_ROLL = {ownedWeight, legacyTierWeights}` 供模拟脚本临时切回 2.0 口径。
- 内置默认的新闻稿价格 3 → 2（真实数据以 consumables.json 为准）。
- **效果（`scripts/sim-levels.ts 400 8`，机器人水平玩家、10 条线轮流、真实数据）**：第 8 回合商店结束时队伍 Lv2+ 占比

| 口径 | 玩家 Lv2+ | 玩家 Lv3 | AI 对手 Lv2+ | AI 对手 Lv3 |
|---|---|---|---|---|
| 2.0 抽卡（阶权重 t、不加权） | 49.5% | 9.3% | 43.6% | 6.2% |
| **2.1 抽卡（3/2/1 + 已有 ×2.5）** | **61.6%** | **14.0%** | **59.7%** | **11.7%** |

（改动前的旧引擎 + 旧数据实测为玩家 51.5% / AI 46.4%，口径一致。）

### 12.4 对手阵容可查（DESIGN 18，`Opponent` 新字段）
| 字段 | 说明 |
|---|---|
| `lastTeam: UnitInst[]` | 上一轮战斗的完整阵容（单位、等级、属性、装备，前排在前）。**与你交战的对手 = 你看到的阵容（AI 已按难度缩放）**；其余对手 = 它的真实阵容；PVE 回合 = 打怪用的阵容。`injectHumanOpponents` 注入时也立即填上快照。开局为 `[]` |
| `lastSynergies: SynergyState[]` | `lastTeam` 已激活的羁绊（tier > 0，含赛场人数加成，不含你的头条加成） |
| `lastResult?: {outcome:'win'\|'lose'\|'draw', vsId, hpDelta}` | vsId = `'me'`（你）/ 对手 id / PVE id；hpDelta = 这一轮掉的热度（≤0）。落单打"幽灵"时 vsId = 幽灵阵容的主人。**替代 2.0 的字符串 `'win'|'loss'|'draw'|'pve'`**（注意 loss → lose） |
| `hpHistory: number[]` | `[0]` = 20，之后每回合结算后追加一次热度（淘汰那回合记 0，之后不再追加） |
- 写入时机：`applyBattleResult`（你的这场 + `resolveOtherMatches` 里的其余对局 / PVE 模拟）。旧存档缺这些字段时自动补齐（`normalizeOpponent`），字符串 lastResult 丢弃。
- 辅助导出：`opponentSynergies(team, state, data)`、`recordFight`。

### 12.5 其他接口变化
- `BattleEvent` `buff` 增加 `synergy?: SynergyKey`。
- `RunState.economySpent?`、`BotMemo.economySpent?`。
- 新导出：`ROLE_META`、`RoleMeta`、`SYNERGY_TUNING`、`unitRollWeights`、`OWNED_UNIT_WEIGHT`、`SHOP_ROLL`、`permGrow`、`spendGold`、`adjacentUnits`；`data.ts` 的 `LEGACY_ROLES` / `roleProblem`。
- 机器人：无预设装备时按流派线缺省偏好买装备（`ARCHETYPE_EQUIPS`）。
- 服务端 archetype 白名单换成 10 线 + mixed（旧 4 职业过渡期仍接受）。
- 内置默认（`defaults.ts`，仅在缺 json 时用）：赛场"研究院/春晚舞台"→"成长营（成长 -1 价）/召唤祭（召唤人数 +1）"，4 个职业对手预设改为成长/经济/多刀/召唤。

### 12.6 模拟结果（2026-10-25，真实数据 = 内容同事提交的六关键词版，SYNERGY_TUNING 为 12.2 的当前值）
`npx tsx scripts/sim-difficulty.ts 400`：中位结束回合 **12**（P25 10 / P75 15），平均名次 **3.78**，吃鸡率 **12.8%**，前四 64.5%。达标（吃鸡 10%~25%、中位 10~14），DIFFICULTY 不需要调。`npm test` 的 realdata 200 局同口径断言（吃鸡上限放宽到 25%）。

`npx tsx scripts/sim-archetypes.ts 150`：

| 流派 | 平均名次 | 吃鸡率 | 前四率 | 平均回合 | 达成中档 |
|---|---|---|---|---|---|
| 自爆 | 2.49 | 36.7% | 88.7% | 15.8 | 88.0% |
| 民间 | 3.23 | 22.0% | 75.3% | 13.2 | 92.0% |
| 算力 | 3.57 | 17.3% | 68.0% | 13.0 | 90.0% |
| 开源 | 3.61 | 15.3% | 70.0% | 12.8 | 91.3% |
| 闭源 | 3.89 | 15.3% | 64.0% | 12.1 | 84.7% |
| 成长 | 4.05 | 22.0% | 58.7% | 11.6 | 94.0% |
| 护盾 | 4.15 | 13.3% | 52.0% | 12.0 | 96.7% |
| 多刀 | 4.44 | 3.3% | 54.0% | 11.4 | 90.7% |
| 召唤 | 4.47 | 7.3% | 49.3% | 11.3 | 92.0% |
| 经济 | 4.64 | 5.3% | 48.0% | 11.1 | 89.3% |

胜率贡献：自爆 62.5%、护盾 59.3%、闭源 58.4%、开源 56.0%、算力 55.5%、民间 54.5%、多刀 54.5%、召唤 53.8%、成长 53.3%、经济 50.8%。

**自爆偏强是内容造成的，不是羁绊数值**：把自爆羁绊整个关掉（×2 +0、×4 前排/余波/成长全关）自爆线仍是 2.76；自爆线 5 个单位都是"阵亡 → 对敌方全体造成等于自身攻击的爆炸"（AoE），T1 就有两个（水军机器人、Vibe Coder），单位胜率 63~66% 包揽前列。用一份临时数据把这 5 个单位的爆炸 `amount` 改成 0.5（伤害减半）再跑：自爆 2.91~2.99，其余 9 条线 3.12~4.31（全部落在 3.3~4.5 附近）；改成 `randomEnemy` ×2 目标则自爆 3.09。建议内容侧二选一（或叠加）：爆炸 `amount: 0.5` / 目标改 `randomEnemy(2)`，并把一个 T1 自爆单位换成非 AoE 的阵亡伤害。经济、召唤、多刀在自爆被压下来之后都进入区间（sim f：召唤 4.20、经济 4.31、多刀 3.68）。
调参工具：`TUNE='{"explodeBonus":0}' ONLY=explode,economy DATA_DIR=<目录> npx tsx scripts/sim-archetypes.ts 100`。
