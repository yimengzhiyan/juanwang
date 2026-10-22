# 引擎 / 接口说明（客户端、内容同事必读，补充 DESIGN.md）

> 类型以 `shared/src/types.ts` 为准；本文解释用法与所有"DESIGN 没写清、引擎做了决定"的地方。

## 0. 启动与目录
```
npm install
npm run dev        # server :3000 (tsx watch) + client :5173 (Vite，/api 代理到 3000)
npm run build      # client → client/dist，server → server/dist/index.js（esbuild 单文件）
npm start          # 单进程 :3000，托管 client/dist + API
npm test           # vitest：shared/test + server/test
npm run typecheck
npm run validate-data   # 校验 shared/data/*.json，并跑开局/引导/机器人冒烟
```
- 前端：`import { newRun, shopAction, ... } from '@juanwang/shared'`（workspace 包，直接指向 TS 源码，Vite 编译）。shared 不依赖任何 Node API。
- 内容数据：`client/src/gameData.ts` 的 `getGameData()`（`import.meta.glob('../../shared/data/*.json')` + `validateData`，只做一次）。
- **素材 URL**：Vite `publicDir = ../assets`，所以 `assets/characters/x.png` 的 URL 是 **`/characters/x.png`**；`UnitDef.avatar` / `ItemDef.icon` 是相对素材根的路径，URL = `'/' + avatar`（`client/src/assets.ts` 的 `assetUrl()`）。构建后的 JS/CSS 在 `/_app/` 下，避免和素材目录重名。
- 服务端环境变量：`PORT`(3000) `STORE_FILE`(server/data/store.json) `DIST_DIR`(client/dist) `DATA_DIR`(shared/data，只用来读合法单位 id) `TRUST_PROXY=1`（限流按 X-Forwarded-For）。

## 1. 引擎 API（全部纯函数，输入不被修改）
```ts
validateData(raw: {units, items, headlines, surprises, tutorial?}): GameData   // 出错抛 DataError(problems: string[])
newRun(seed: string, data: GameData, opts?: { tutorial?: boolean }): RunState
shopAction(state: RunState, action: ShopActionInput, data: GameData): RunState
simulateBattle(myTeam: (UnitInst|null)[], enemyTeam: (UnitInst|null)[], data: GameData, seed: string, opts?: BattleOptions): BattleResult
applyBattleResult(state: RunState, result: BattleResult, data: GameData): RunState
generateBotTeam(turn: number, trophies: number, data: GameData, seed: string): UnitInst[]
tutorialStep(state: RunState): TutorialStepId | null
// 便捷：
battleForState(state, enemyTeam, data): BattleResult        // 自动带上 enemyDebuff / 战前队形修正，种子 = `${seed}:t${turn}`
offlineOpponent(state, data): UnitInst[]                      // 引导局固定弱队，否则机器人（种子 `${seed}:opp:${turn}`）
tutorialEnemy(state, data): UnitInst[] | null
runTurnOffline(state, data, enemy?)                           // endShop→战斗→结算→continue，测试/自动对局用
// 常量与查询：maxTierForTurn unitSlotsForTurn itemSlotsForTurn maxItemTierForTurn currentUnitSlots rerollCost
//            levelForXp canMerge matchesFilter abilityAmount abilityBuff livesLostOnDefeat SYNERGY_DESC ...
```
**shopAction 不抛异常**：非法操作返回原状态的浅拷贝并带 `error`（中文文案，可直接 toast）；成功的动作会清掉 `error`。

### ShopActionInput
| action | 说明 |
|---|---|
| `{type:'buy', slot, to?}` | slot = 商店下标；to = 队伍下标。to 为空位 → 放入；to 为同名未满级 → 合并；**不传 to：优先合并到已有同名未满级单位，否则第一个空位** |
| `{type:'sell', index}` | 得 = 等级 的算力 |
| `{type:'reroll'}` | 顺序：本回合免费刷新(rerollFree) → 免费次数(freeRerolls) → 1 算力 |
| `{type:'freeze', slot}` | 切换冻结 |
| `{type:'swap', a, b}` | 交换两个队伍格（可以是空格 = 移动） |
| `{type:'merge', from, to}` | 队伍内两个同名单位合体（拖一个到另一个上） |
| `{type:'useItem', slot, target?, source?}` | unit 型需要 target；`copyStatsFrom` 另需 source（被复制者） |
| `{type:'chooseHeadline', option: 0|1}` | 仅 phase='headline' |
| `{type:'endShop'}` | 触发 endTurn → phase='battle' |
| `{type:'continue'}` | 结算页 → 下一回合（phase='result' 时） |

### 一回合的完整调用顺序（客户端）
```
phase 'headline' → shopAction(chooseHeadline) → phase 'shop'
phase 'shop'     → buy/sell/... → shopAction(endShop) → phase 'battle'
                 → 上传快照 POST /api/snapshot {team: state.team(去 null), ...}（endShop 之后的队伍，含临时加成）
                 → 取对手 GET /api/opponent → team ?? offlineOpponent(state, data)
                 → result = battleForState(state, enemy, data)；按 result.events 播放
                 → state = applyBattleResult(state, result, data) → phase 'result' 或 'over'
phase 'result'   → 显示胜负 + state.lastSurprise（若有）→ shopAction(continue) → 下一回合
phase 'over'     → state.won / state.endReason('trophies'|'lives'|'turnLimit') / state.trophies → POST /api/result
```
- 历史：`state.history[]`（每场 `{turn, winner, myTeam, enemyTeam, trophies, lives, opponent?}`；`opponent` 由客户端自己填）。
- 进化动画：`state.lastLevelUp = {uid, level}`（每次进化覆盖，回合开始清空）。免费奖励槽 `ShopSlot.free = true`。
- `state.log[]` 是给调试/日志面板的中文流水（最多 200 条）。

## 2. BattleEvent（客户端按顺序播放）
所有事件都有 `text`（可直接显示的中文文案）。单位引用 `UnitRef = {uid, defId, side:'me'|'enemy', pos}`，pos 为事件发生时在本方队列的位置（0 = 最前；阵亡单位为阵亡前位置）。**敌方 uid = `'e_' + 原 uid`**（避免和我方撞车），召唤物 uid 形如 `s3_<召唤者uid>`。
```ts
{type:'start', me: UnitSnap[], enemy: UnitSnap[]}                 // UnitSnap = UnitRef + {atk, hp, level, shield}，战前阵容（已含临时加成/护盾/enemyDebuff）
{type:'synergy', side, faction, count}                            // 羁绊触发，紧接着是它造成的 buff/shield/summon
{type:'ability', unit, trigger: Trigger|'synergy', effect, targets: UnitRef[]}  // 技能发动（随后是效果事件）
{type:'attack', round, me: UnitRef&{atk,hits}, enemy: UnitRef&{atk,hits}}       // 双方前排同时互撞；hits>1 = 多段攻击
{type:'damage', unit, source?, amount, blocked, hp, shield, kind:'attack'|'ability'}  // amount=实际扣血（可能超过剩余血量），blocked=护盾挡下
{type:'heal', unit, source?, amount, hp}
{type:'buff', unit, source?, atk, hp, newAtk, newHp, permanent}   // atk/hp 为增量（可为负）
{type:'shield', unit, source?, amount, total}
{type:'faint', unit, killer?, consumed?}                          // consumed = 被友军吞并（copyStats consume）
{type:'summon', unit: UnitSnap, source?}                          // 已插入到 unit.pos
{type:'move', side, unit, from, to, order: uid[]}                 // order = 该方移动后的完整队列（前排在前），直接按它重排即可
{type:'multiAttack', unit, source?, hits}                         // 下一次攻击的段数
{type:'bonus', side, unit, kind:'gold'|'reroll'|'discount', amount}  // 战斗中获得的下回合收益（只有 me 方生效）
{type:'say', unit, line}                                          // 台词气泡（开战前排、阵亡、50% 击杀时）
{type:'end', winner:'me'|'enemy'|'draw', rounds, me: uid[], enemy: uid[]}  // 幸存者
```
`BattleResult = {winner, events, enemyTeam, rounds, permanentBuffs: {uid, atk, hp}[], bonus: {gold, rerolls, discount}}`。
播放建议：start → (move 队形修正) → synergy → 开战技能 → 循环 [beforeAttack 技能 → attack → damage×N → faint/技能链] → end。

## 3. 规则决定清单（DESIGN 未写明之处）
### 商店 / 局
1. 回合流程：`beginTurn` = 算力重置为 10 + nextTurnGold → 本回合修正器清零（nextTurn* 转正）→ **先生成商店** → 待生效突发结算 → 偶数回合出头条（phase='headline'，商店已生成但不能操作）→ 选完进入 'shop' 并触发 startTurn。因此头条的 priceMod/extraSlot/rerollShop/freeUnit 都直接作用于本回合商店。
2. 商店权重：阶 t 的权重 = t（T1..当前最高阶），阶内等概率。基建阶级：T1 回合 1，T2 回合 5，T3 回合 9，权重同理。
3. 冻结槽占用当回合的槽位数；刷新只替换未冻结、非免费槽。
4. 单位价格 = 3 + unitPriceMod，最低 1；基建 = price + itemPriceMod，最低 min(1, price)；免费槽恒为 0。
5. 进化：xp 每份 +1，Lv2 = xp≥2（3 份），Lv3 = xp5（6 份）。合并属性 = max(双方)+1/+1（每次合并都 +1）；队伍内 merge 时 xp = a.xp + b.xp + 1（上限 5），临时加成/护盾一起带上。Lv3 不可再合并。
6. **进化奖励**：每次升级（合并、基建 levelUp、头条 levelUpRandom）都在商店追加一个 `free:true` 槽，阶 = min(6, 当前最高阶 + 1)。该槽刷新不消失；回合结束时未冻结则消失；冻结后下回合仍免费。
7. `levelUp`（基建/头条）= 升一级、xp 补到门槛、+1/+1；同样触发 levelUp 技能和进化奖励。
8. 出售先结算 sell 技能（自己仍在场），再移除并得 = 等级 的算力。
9. 商店阶段技能里 damage / destroy / multiAttack 无效果；heal = 本回合临时 +hp；gold 立即到账；reroll = 免费刷新次数；discount = 本回合单位降价；summon 放到召唤者后方最近空位（无空位不召唤），召唤物属性 × 等级（perLevel）。
10. 临时加成 `tempAtk/tempHp` 与 `shield` 只作用于本回合战斗，`applyBattleResult` 后清零。非永久的 buff（技能 permanent 缺省 false，头条 buffTeam permanent 缺省 false）都记到临时加成。基建 buff/teamBuff 的 permanent **缺省 true**。
11. **DESIGN 11.5**：商店阶段触发的 `swapAll`（头条/突发）与 `pullFront`（技能或基建）不立即改队形，记到 `modifiers.battleSwapAll`（奇数次=反转）与 `modifiers.battlePullFront`（uid 列表，依次拉到最前），在战斗开始（start 事件之后、羁绊之前）以 move 事件生效。商店里玩家看到的队形不变，UI 可在队伍栏提示"开战时反转/某某上前"。pushBack / swapPosition 在商店阶段仍立即生效。
12. 头条：随机且尽量不重复（`seenHeadlines`）。突发：奇数回合结算后 30%（用局内 rng，固定种子可重放），尽量不重复；**在下一回合开始时生效**（结算页可先展示 `lastSurprise`，`surprisePending` 为真）。
13. 事件效果细节：gold 立即到账（可为负，最低 0）；freeUnit 进商店免费槽（不直接进队伍，满员也能拿）；tier 指定时池子为空则向低阶回退；duplicate 复制到第一个空位（无空位无效）；sacrifice 牺牲阶最低（同阶等级最低，再同取最左）的单位；lifeTrade 在只剩 1 信心时不生效；enemyDebuff 只作用于本回合战斗（敌方攻击最低 0）；extraSlot 立即追加单位槽且本回合刷新保持；**effects 数组按顺序全部结算**（validateData 后 `effects` 总是存在，`effect` = 第一个）。
14. 回合 20 结算后直接结束：`won=false, endReason='turnLimit'`，成绩按热搜数。热搜 10 → `won=true, endReason='trophies'`；信心 0 → `endReason='lives'`。

### 战斗
15. 战场每方最多 **6** 个单位（队伍 5 + 1 召唤余量），满了召唤失败（无事件）。
16. 开战顺序：start → 战前队形修正 → 羁绊（我方先，按 开源/闭源/算力/民间 顺序）→ startBattle 技能 → 回合循环。
17. 每回合：双方前排 beforeAttack → 互撞（同时结算；多段攻击时每一段双方都还活着才继续）→ 处理死亡与技能链。最多 50 回合，超过 = 和局；同时清空 = 和局。
18. 触发排序：同一批触发按 **攻击高→低，同攻击我方先，再按位置前→后**。死亡在每次技能结算后立即处理，阵亡单位从队列移除，它的 faint 技能在它原位置召唤。
19. 触发条件：hurt 只在受伤后仍存活时触发；faint / kill 即使单位已死也会结算（对自身的 buff 无意义）；kill 只在击杀敌方单位时触发；hurtFront = 本方站在最前的单位掉血时，其他存活友军触发（前排被打死也算）。friendSummoned / enemySummoned 对召唤出现时场上存活的单位触发。
20. 护盾：吸收**一次**伤害（最多 n 点），之后归零；多个护盾数值相加。destroy 无视护盾。
21. 伤害事件的 amount 是实际扣的血（可超过剩余血量），客户端显示伤害数字即可。
22. 战斗中 buff 默认只在本场有效；`permanent:true` 的 buff 作用于我方原队伍单位时记入 `permanentBuffs`，赛后写回（召唤物与敌方不记）。heal 不超过本场血量上限（战前血量 + 本场 hp buff）。
23. 战斗中的 gold / reroll / discount 只对我方有效，变成下回合 +算力 / 免费刷新次数 / 单位降价。
24. copyStats：自己的攻、血分别取 max(自己, 目标)；**consume:true** 时再 +amount（缺省 0，按等级缩放）并把目标移除（faint 事件带 consumed，算被吞并者阵亡，会触发它的 faint / 友军的 friendFaint）。copyStats 与 swapPosition 的候选目标不含自己。
25. swapPosition：目标是友军 → 与自己换位；目标是敌人 → 把它和敌方最前排换位。pushBack / pullFront 可作用于双方。
26. summon：目标为敌方类（frontEnemy 等）→ 召唤到敌方最后排（"塞给对面"）；backFriend → 我方最后排；frontFriend → 最前；其他 → 自己身后（自己已阵亡则在原位）。count 个，属性 × 等级（perLevel）。unitId 缺省 token_shuijun。
27. multiAttack：目标的下一次攻击变为 amount 段（缺省 2）；**multiAttack 默认不随等级缩放**（显式 perLevel:true 才 ×等级）。
28. 民间羁绊的水军、召唤物都计入阵营人数（统计在开战时进行，只统计一次）。算力羁绊 血量 -1 但不会低于 1。

### 技能字段（units.json 的 ability）
29. `amount` 缺省 1（multiAttack 缺省 2）；`perLevel` 缺省 **true**（数值 ×等级），设 false 关闭。buff：写了 `atk` 或 `hp` 就分别用它们（没写的为 0），都没写则攻血都 +amount。
30. 目标约定：`frontFriend`/`backFriend` = 除自己外最前/最后的友军；`adjacentFriends` = 按站位紧挨自己的左右友军；`randomFriend(n)` 不含自己且不重复；`allFriends` 含自己；`lowestHpFriend` 含自己（copyStats/swap 除外）；平局取最靠前。`killer` = 杀死自己的单位（faint 时用）；`summoned` = 刚被召唤的单位；`boughtUnit` = 刚被买的单位（buy / friendBought）。JSON 里可写 `"randomFriend(2)"` 或 `"target":"randomFriend","n":2`。
31. **DESIGN 11.1** `filter: {faction?, minTier?, maxTier?}`：候选先过滤再选（随机/最低血等都在过滤后的集合里选），self/killer/summoned 不满足条件时不生效。adjacentFriends 先按站位取邻居再过滤。
32. **DESIGN 11.3** destroy 的 `maxHp`：目标当前血量 ≤ 阈值才直接击杀，否则改为造成"阈值"点伤害（走护盾）。阈值 = `maxHp + (level-1) × maxHpPerLevel`（maxHpPerLevel 缺省 0）。例：小扎 `maxHp:3, maxHpPerLevel:2` → 3/5/7。
33. **DESIGN 11.8** 随机形态 `choices: AbilityChoice[]`：每次触发等概率选一个，字段覆盖到基础技能上（可改 effect/target/amount/atk/hp/permanent/desc…）。GPT 娘示例：
    ```json
    {"trigger":"startTurn","effect":"buff","target":"self","desc":"回合开始：随机变成 日/地/月 形态",
     "choices":[{"atk":2,"hp":0,"desc":"日形态：本回合 +2 攻"},{"atk":0,"hp":2,"desc":"地形态：本回合 +2 血"},{"effect":"discount","amount":1,"desc":"月形态：本回合单位 -1 价"}]}
    ```
    建议基础技能里不写 amount/atk/hp，全部放进 choices，避免互相叠加。随机结果走局内/战斗 rng，可重放。
34. 群体基建（targetKind:'team'）对全队每个单位各触发一次 eatItem（DESIGN 11.6）。

### 机器人
35. 机器人从回合 1 模拟到目标回合：每回合 10 + `botBonusGold(trophies)`（每 3 热搜 +1，上限 3）算力；优先合并 → 空位买最强（tier×3+攻+血）→ 满员时卖最弱换明显更强 → 用基建（buff 给最强、护盾给前排、levelUp 给最强未满级、copyStatsFrom 弱者抄强者、summonToken/teamBuff/gold）→ 有余钱刷新（次数 1 + 热搜/3）。不吃头条/突发。排阵：血厚、带 faint/hurt/hurtFront 的在前，带 startBattle 的靠后。回合 20 约 4ms。

## 4. tutorial.json schema（`TutorialDef`）
```jsonc
{
  "seed": "tutorial-v1",        // 引导局固定种子（覆盖 newRun 的 seed）
  "headlineTurn": 3,            // 引导头条出现的回合（缺省 3）；回合 ≤ max(固定回合, headlineTurn) 内只有这一回合有头条
  "headline": "h_xxx",          // 引导头条 id（缺省第一张）
  "turns": [                    // 固定回合（一般 1~3）
    { "turn": 1,
      "units": ["crawler", "crawler", "labeler"],   // 回合开始时商店单位（顺序即槽位）；之后玩家刷新则随机
      "items": ["firewall"],                        // 回合开始时商店基建
      "enemy": [{ "defId": "botnet", "atk": 1, "hp": 1, "level": 1 }]  // 固定对手，前排在前；atk/hp/level 可省略（取单位默认）
    }
  ],
  "steps": {                    // key ∈ buy|buyAgain|fight|merge|item|freezeSell|headline|done
    "buy": { "text": "点一个单位买下它", "target": "shop-unit-0" }   // target = 给客户端的高亮提示（自由字符串），也可直接写字符串
  }
}
```
- 引导局：冻结的槽会叠加在固定内容前面；固定回合不出突发；之后恢复正常规则（偶数回合头条、机器人对手）。
- `tutorialStep(state)`：非引导局 → null；phase 为 battle/result → null（不显示气泡）；headline 阶段 → 'headline'；
  第 1 场前：buy（0 次购买）→ buyAgain（1 次）→ fight；第 1 场后：merge（直到有单位进化）→ item（直到用过基建）→ freezeSell（冻结过且卖过）→ fight；选完引导头条或结局 → 'done'（客户端写 localStorage）。

## 5. HTTP API（失败时客户端静默降级为离线）
| 接口 | 请求 | 响应 |
|---|---|---|
| `POST /api/snapshot` | `{name(1~12字), room?(4~8位字母数字，自动大写), turn(1~20), trophies(0~10), team(1~5 个 UnitInst，defId 合法，atk 0~999，hp 1~999), seed(≤64)}` | `{ok:true}` |
| `GET /api/opponent?turn&trophies&room&name&seed` | 同回合、\|热搜差\|≤2、排除同 name+seed；有 room 时优先同房间，房间里没有则全服 | `{team: UnitInst[], name, trophies, turn, room}` 或 `{team:null}` |
| `POST /api/result` | `{name, room?, trophies, turns, won, seed, bestUnit?(defId 或 {defId})}` | `{ok, best(是否刷新个人最佳), rank(全服名次)}` |
| `GET /api/leaderboard?room&date` | date = `YYYY-MM-DD` 或 `today`（UTC+8）；不传 = 全部 | `{room, date, entries:[{rank,name,trophies,turns,won,seed,bestUnit,date,room}]}`（每人最佳，前 50） |
| `GET /api/daily` | | `{date, seed:'daily-YYYY-MM-DD'}`（UTC+8） |
| `GET /healthz` | | `{ok, snapshots, results}` |
- 错误：`{error: '中文原因'}`，400/404/413/429/500。限流：同 IP 每秒 ≤10 次 `/api/*`（healthz/静态文件不限）。
- 排序：登顶 > 热搜多 > 回合少 > 更早。每人最佳按 (房间, 日期, 名字) 记录，全服榜/今日榜/房间榜都在查询时取每人最佳。
- 存储：内存 + `server/data/store.json` 每 10 秒（有改动时）原子落盘，退出时也落盘；每回合桶最多 2000 条（LRU，被匹配取用也刷新）。
