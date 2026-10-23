# 《卷王自走棋》设计规范（所有子任务的唯一基准）

> AI 圈主题的单机自走棋小游戏，联机为辅（异步对战 + 好友榜）。参赛：1024 切磋大会 · 游戏赛道（口号"让人想再玩一局"）。
> 玩法参照 Super Auto Pets 的"买单位、排阵、自动战斗"，加入时事事件与阵营羁绊。非商用；人物皆为善意戏仿，不用真名、不涉私德。
> 画风：**明亮清新、卡通厚涂、皇室战争式的饱和配色**。不要赛博朋克，不要霓虹光污染。

## 1. 一句话
每回合用 10 点算力在商店里买 AI 单位（模型娘、大佬、小兵）排成 5 人队伍，点"开战"看它们自动互撞；赢了拿热搜，输了掉信心；回合之间不断有 AI 圈时事砸下来改规则。拿满 10 个热搜登顶，信心归零出局，死了就想再开一局。

## 2. 术语
| 概念 | 叫法 | 说明 |
|---|---|---|
| 金币 | **算力** ⚡ | 每回合固定 10 点，不结转（有事件/技能例外） |
| 胜场 | **热搜** 🔥 | 累计 10 个获胜 |
| 生命 | **信心** ❤ | 5 颗，每输一场 -1，归零结束 |
| 单位 | **单位** | 有 攻击/血量/阶级(T1~T6)/阵营/技能 |
| 升级 | **进化** | 3 个同名单位合并 → Lv2；再 3 个 → Lv3（即 6 个） |
| 道具 | **基建** | 商店里的消耗品，用在单位或全队上 |
| 回合间事件 | **头条** | 时事事件卡，二选一 |
| 随机突发 | **突发** | 无需选择的即时效果 |
| 阵营 | **开源 / 闭源 / 算力 / 民间** | 同阵营 ≥3 触发羁绊 |

## 3. 规则（引擎必须逐条实现，全部确定性、可重放）

### 3.1 一局
- 开局 5 信心、0 热搜、回合 1。胜利：热搜 = 10。失败：信心 = 0。
- 回合流程：**商店阶段 →（偶数回合：头条二选一）→ 战斗阶段 → 结算 →（奇数回合 30% 概率：突发）→ 下一回合**。
  - 头条在商店阶段之前出现（回合 2、4、6…），玩家二选一后再进商店，这样选择会影响购买。
  - 突发出现在结算之后、下一回合商店之前。
- 回合上限 20，到 20 回合按热搜数结算（用于防止拖延，一般 12~16 回合结束）。

### 3.2 商店
- 每回合 10 算力（不结转；事件/技能可加）。
- 商店槽位：单位 3 个（回合 5 起 4 个，回合 9 起 5 个），基建 1 个（回合 3 起 2 个）。
- 价格：单位 3，基建默认 3（个别 1~2），刷新 1，冻结免费（冻结的槽位下回合保留），出售获得 = 单位等级（Lv1 得 1，Lv2 得 2，Lv3 得 3）。
- 阶级解锁：T1 回合 1，T2 回合 3，T3 回合 5，T4 回合 7，T5 回合 9，T6 回合 11。商店按权重随机：当前最高阶权重最高，低阶递减。
- 队伍 5 个槽位，从左到右 = 从前排到后排（最左先战斗）。可拖拽/点击交换位置，可把商店单位买到空位，或买到同名单位上直接合并。
- 进化：合并时属性 = 各份中最高值 +1/+1；达到 Lv2、Lv3 时**商店立刻刷出一个比当前最高阶高一阶的免费单位**（惊喜与奖励）。Lv3 为满级。
- 冻结、出售、刷新、交换、使用基建都在商店阶段，次数不限。

### 3.3 战斗（自动，确定性）
- 双方队伍前排对前排。每"回合"：双方最前排单位**同时**互相造成等于己方攻击的伤害，然后结算死亡与触发。重复直到一方清空。
- 战前先触发所有 `开战时` 技能（按攻击高→低，同攻击先我方）。
- 平局（同时清空或 50 回合未分胜负）= 和局，不加热搜不掉信心。
- 胜：+1 热搜；负：-1 信心（回合 ≥ 10 时 -2，制造后期紧张感）。
- 对手队伍来源（优先级）：① 服务端同回合、热搜差 ≤2 的真实玩家快照（好友房优先取同房间）；② 没有则用内置"机器人"按同一引擎模拟购物生成（确定性种子）。离线时只用 ②。

### 3.4 技能系统（数据驱动，`units.json` 描述，引擎解释执行）
触发器（`trigger`）：
```
startBattle 开战时 | beforeAttack 攻击前 | hurt 受伤时 | faint 阵亡时 | friendFaint 友军阵亡时 | kill 击杀时
friendSummoned 友军被召唤时 | buy 被购买时 | sell 被出售时 | levelUp 进化时 | friendBought 友军被购买时
startTurn 回合开始时 | endTurn 回合结束时 | eatItem 使用基建时 | enemySummoned 敌军被召唤时 | hurtFront 前排友军受伤时
```
效果（`effect`，可带 `amount`、按等级缩放 `perLevel`）：
```
damage 造成伤害 | buff 加攻/加血（本场 or 永久 permanent:true） | shield 护盾（吸收一次伤害 n 点）
summon 召唤单位 | copyStats 复制属性 | swapPosition 交换位置 | gold 获得算力 | destroy 直接击杀
heal 回血 | reroll 免费刷新 | discount 本回合商店降价 | pushBack 把目标推到最后 | pullFront 拉到最前 | multiAttack 本次攻击 n 次
```
目标（`target`）：
```
self | frontFriend | backFriend | adjacentFriends | randomFriend(n) | allFriends | lowestHpFriend
frontEnemy | backEnemy | randomEnemy(n) | allEnemies | lowestHpEnemy | highestAtkEnemy | killer | summoned | boughtUnit
```
- 技能数值随等级：Lv1 基础，Lv2 ×2，Lv3 ×3（`perLevel` 字段控制）。
- 同一触发同时发生时按攻击力高→低结算；我方先于敌方。
- 技能必须有**可读的一句话描述**（`desc`），客户端直接显示，不要让玩家猜。

### 3.5 阵营羁绊
每个单位恰好一个阵营：`open 开源`、`closed 闭源`、`compute 算力`、`folk 民间`。
战斗开始时统计我方各阵营数量，≥3 触发（Lv 不计数，按单位个数）：
- 开源 ≥3：全队 +1/+1（开源共享）
- 闭源 ≥3：最前排单位获得 3 点护盾（护栏）
- 算力 ≥3：全队攻击 +2，血量 -1（最低 1）（堆卡暴力）
- 民间 ≥3：战斗开始时召唤一个 1/1 "水军"到最后排（人海）
羁绊在队伍栏上方用小徽章显示进度（如 开源 2/3）。

### 3.6 头条（时事事件，偶数回合，二选一）
每张头条有两个选项，每个选项一个即时或持续效果。效果类型（`EventEffect`）：
```
gold 加算力 | priceMod 本回合单位/基建价格±n | freeUnit 免费获得随机单位(可限阵营/阶级) | buffTeam 全队±攻/±血(本回合战斗或永久)
buffFaction 某阵营±攻/±血 | shopRerollFree 本回合刷新免费 | extraSlot 本回合商店多一格 | shieldAll 全队护盾 n
swapAll 队伍顺序反转 | duplicate 复制一个随机单位到空位 | sacrifice 失去最低阶单位换 +n 算力 | nextTurnGold 下回合算力 +n
enemyDebuff 本回合敌方全队 -攻 | rerollShop 立即免费刷新 | levelUpRandom 随机一个单位 +1 等级 | lifeTrade 失去 1 信心换 +n 算力与免费刷新
```
每张头条：`title`（≤8 字）、`news`（一句时事，≤40 字）、`options[2]`：`{label(≤10 字), effect}`。至少 24 张，来自 docs/NEWS.md 的调研。

### 3.7 突发（奇数回合结算后 30% 概率，无需选择）
效果类型同头条（单个 effect）。至少 12 张，`title` + `news` + `effect`。偏向"惊喜"而不是惩罚（惩罚 ≤ 1/3）。

### 3.8 基建（道具，商店购买后点一个单位使用，或全队型直接使用）
至少 12 个，字段：`id, name, desc, price, targetKind: 'unit'|'team', effect: ItemEffect, icon`。
`ItemEffect`：`buff(atk, hp, permanent)`、`shield(n)`、`copyStatsFrom`（选两个单位）、`levelUp`（+1 等级，Lv3 不可）、`gold(n)`、`summonToken(unitId)`、`teamBuff(atk,hp,permanent?)`、`pullFront`、`transformRandomSameTier`（变成同阶随机单位）。

### 3.9 单位名单（固定 32 个，id 固定；属性/技能由内容任务填）
| 阶 | 单位（id） |
|---|---|
| T1 | 提示词工程师 `prompt_eng`、数据爬虫 `crawler`、标注员 `labeler`、套壳 App `wrapper`、水军机器人 `botnet`、Vibe Coder `vibe_coder` |
| T2 | 豆包娘 `doubao_chan`、千问娘 `qwen_chan`、小扎 `zuck`、AI 女友 `ai_gf`、显卡黄牛 `scalper`、评测榜单 `leaderboard` |
| T3 | 抱抱脸 `hf`、Kimi 长文 `kimi`、米斯特拉 `mistral`、杨立昆 `lecun`、幻觉怪 `hallucination`、机器狗 `robodog` |
| T4 | Claude 娘 `claude_chan`、Gemini 娘 `gemini_chan`、DeepSeek 娘 `deepseek_chan`、达里奥 `dario`、伊利亚 `ilya` |
| T5 | GPT 娘 `gpt_chan`、老黄 `huang`、奥特曼 `altman`、马一龙 `musk`、梁圣 `liang` |
| T6 | 星际之门 `stargate`、监管局 `regulator`、AGI `agi`、融资轮 `funding` |
召唤物（不进商店）：水军 `token_shuijun`（1/1）、幻觉 `token_halluc`（2/1）、显卡 `token_gpu`（0/3 肉盾）。
- 14 个有头像 PNG 的角色（`assets/characters/<id>.png`）直接复用；其余单位需要新图（美术任务给 SVG，用户可后续用 GPT 生 PNG 替换）。
- 真人外号角色只做善意戏仿：技能名和台词只能是公开梗、正向或自嘲。

## 4. 数据与类型（`shared/src/types.ts` 以此为准）
```ts
export type Faction = 'open'|'closed'|'compute'|'folk';
export interface UnitDef { id: string; name: string; tier: 1|2|3|4|5|6; faction: Faction; atk: number; hp: number;
  ability?: { trigger: Trigger; effect: Effect; target: Target; amount?: number; perLevel?: boolean; desc: string; };
  lines?: string[]; // 1~3 条台词，开战/击杀/阵亡时冒泡
  avatar: string;   // 'characters/<id>.png' 或 'units/<id>.svg'
  token?: boolean;  // 召唤物，不进商店
}
export interface ItemDef { id; name; desc; price; targetKind: 'unit'|'team'; effect: ItemEffect; icon: string; tier: 1|2|3 }
export interface HeadlineDef { id; title; news; options: [{label; effect: EventEffect}, {label; effect: EventEffect}]; icon?: string }
export interface SurpriseDef { id; title; news; effect: EventEffect; good: boolean }
export interface UnitInst { uid: string; defId: string; atk: number; hp: number; level: 1|2|3; xp: number /*0..5*/; shield: number; tempAtk: number; tempHp: number }
export interface ShopSlot { kind: 'unit'|'item'; defId: string; price: number; frozen: boolean }
export interface RunState { seed: string; turn: number; gold: number; lives: number; trophies: number; team: (UnitInst|null)[] /*长度 5*/; shop: ShopSlot[];
  phase: 'headline'|'shop'|'battle'|'result'|'over'; pendingHeadline?: HeadlineDef; lastSurprise?: SurpriseDef; modifiers: {...}; history: BattleRecord[]; won?: boolean; log: string[] }
export interface BattleEvent { type: 'start'|'ability'|'attack'|'damage'|'faint'|'summon'|'buff'|'shield'|'end'|'synergy'; ... } // 客户端据此播放动画，每个事件自带足够信息
export interface BattleResult { winner: 'me'|'enemy'|'draw'; events: BattleEvent[]; enemyTeam: UnitInst[] }
```
引擎对外 API（`shared/src/engine/`，纯函数 + 种子随机 mulberry32）：
```ts
newRun(seed, data, opts?: {tutorial?: boolean}) → RunState
shopAction(state, action, data) → RunState       // buy/sell/reroll/freeze/swap/useItem/chooseHeadline/endShop
simulateBattle(myTeam, enemyTeam, data, seed) → BattleResult
applyBattleResult(state, result, data) → RunState // 热搜/信心/突发
generateBotTeam(turn, trophies, data, seed) → UnitInst[]
```
数据文件：`shared/data/units.json`、`items.json`、`headlines.json`、`surprises.json`、`tutorial.json`（引导局脚本）。

## 5. 单机为主、联机为辅
- **整局逻辑在浏览器端运行**（引擎在 shared，前端直接 import）。没有服务器也能完整游玩（对手用机器人）。
- 服务端只做 4 件事（Node，HTTP JSON API，数据存 `server/data/*.json`，定时落盘）：
  - `POST /api/snapshot` 上传本回合队伍快照 `{name, room?, turn, trophies, team, seed}`；`GET /api/opponent?turn&trophies&room` 取一个对手快照（找不到返回 null）。
  - `POST /api/result` 上传结局 `{name, room?, trophies, turns, won, seed, bestUnit}`；`GET /api/leaderboard?room&date` 排行榜（全服 / 好友房 / 今日）。
  - `GET /api/daily` 返回今日种子（按日期生成），所有人玩同一张开局。
  - 托管 `client/dist`。
- 好友房：大厅可输入/生成 4 位房间码，之后上传与匹配都带 `room`；榜单可切换"全服 / 好友房"。
- 请求失败一律静默降级为离线模式，UI 顶部小字提示"离线模式"。

## 6. 客户端
- Vite + TypeScript，**DOM + CSS + GSAP** 实现（不用 Pixi），战斗区用绝对定位的单位卡做位移/挤压动画，粒子用一层 canvas（可移植 `legacy/src/client/fx/particles.ts`）。全部单击/拖拽可完成，手机竖屏优先，桌面居中最大宽 520px 的"手机壳"布局 + 两侧留白装饰。
- 场景：加载 → 首页（Logo、开始、每日挑战、好友房、图鉴、排行榜、新手引导）→ 对局（上：信心/热搜/回合/算力；中：敌方预览（战斗时）与我方 5 槽；下：商店 3~5 单位 + 1~2 基建 + 刷新/冻结/开战按钮）→ 头条弹窗（二选一）→ 战斗 → 结算 → 结局页（排名、本局最强单位、"再来一局"大按钮、分享种子）。
- **新手引导局**（首次进入自动开始，可跳过）：固定种子与固定商店，7 步气泡：买单位 → 再买一个 → 开战 → 买第三个同名合体 → 使用基建 → 冻结与出售 → 头条二选一。每步高亮目标元素，其余变暗。完成后写 localStorage。
- 单位卡：头像圆形 + 阶级色边框（T1 灰绿 … T6 金）+ 左下攻击(剑) 右下血量(心) + 等级星星 + 阵营小图标。长按/悬停显示技能描述；点击商店单位弹出详情卡（技能、阵营、台词）。
- 音效：WebAudio 合成的轻量音效（买、卖、合体、攻击、击杀、胜利、失败），可静音。

## 7. 反馈与特效（足但克制）
| 时刻 | 表现 | 时长 |
|---|---|---|
| 购买 | 卡片飞入槽位 + 弹跳 + 算力 -3 浮字 | 0.4s |
| 合体进化 | 两张卡吸入 + 金色爆星 + 卡片放大回弹 + "Lv2!" 标签 + 短震 | 0.9s |
| 头条 | 报纸风卡片从顶部甩入（米白纸张、红色"头条"印章），两个选项按钮 | 入 0.5s |
| 开战 | 双方队伍滑入，VS 标志撞击 | 0.6s |
| 攻击 | 两前排互相挤压撞击，命中火花，红色伤害数字弹出，受击卡抖动 | 0.45s/次 |
| 技能 | 单位头顶冒技能图标 + 一行描述横幅，目标闪光 | 0.5s |
| 阵亡 | 卡片变灰、碎成几片飘散 + 台词气泡 | 0.5s |
| 胜利 | 🔥 热搜飞入计数 + 适量彩纸 | 1.2s |
| 失败 | ❤ 碎裂 + 屏幕边缘红闪一次 | 0.8s |
| 结局 | 登顶：金色奖杯 + 彩纸雨；出局：灰色 + "再来一局"按钮 2s 后弹出 | 3s |
战斗可 1x / 2x / 跳过。粒子颜色取自明亮配色，不用霓虹发光。

## 8. 美术方向（详见 docs/ART.md）
- 配色：天空蓝 `#4FC3F7`→奶油白 `#FFF8E7` 背景渐变；主蓝 `#2F80ED`、金 `#FFC53D`、草绿 `#58C65C`、珊瑚红 `#F25757`、薰衣草紫 `#9B6BFF`；文字深蓝 `#1F2A44`；描边深棕 `#3B2A1A`；面板白 90% + 圆角 20px + 柔和阴影。
- 单位/道具图标：卡通厚涂、粗描边、平光高光，无发光。
- 四个阵营色：开源青绿 `#2DBE8C`、闭源蓝 `#2F80ED`、算力橙 `#FF8C42`、民间粉 `#FF7EB6`；卡片上阵营图标用"白色符号 + 阵营色圆徽"，避免与阶级边框混淆。
- 阶级色：T1 `#9BB1C8` T2 `#58C65C` T3 `#2F80ED` T4 `#9B6BFF` T5 `#FF8C42` T6 `#FFC53D`。

## 9. 范围边界（一天内不做）
不做：实时同步对战、账号系统、付费、语音、复杂羁绊树、单位皮肤。

## 10. 补充决议（2026-10-23）
1. 基建 id 固定 12 个：`gpu_h100, dataset, finetune, distill, firewall, funding_round, launch_event, trending, jumpbox, alignment, quantize, rlhf`，`icon` 形如 `items/<id>.svg`。
2. 头像加载：同名 `.png` 优先，`.svg` 回退，适用于 `characters/` 与 `units/`，这样用 GPT 生成的 PNG 直接放入即可替换，不改数据。
3. 单位卡状态：价格标签（商店中）、护盾（头像外一圈蓝环 + 数字）、冻结（槽位浅蓝底 + 雪花角标），细节见 docs/ART.md 第 4 节。
4. 特效全局约束：粒子同屏上限 120；同一时刻最多一个全屏效果；尊重 `prefers-reduced-motion`（关闭震动与粒子）；失败时的红色边缘闪烁用实心 inset box-shadow，不用模糊。
5. 旧项目的 7 个赛博风道具 SVG 已删除，不再使用。

## 11. 技能系统扩展决议（2026-10-23，引擎补充实现，内容随后改回原设计）
1. 目标筛选：`target` 可带 `filter: { faction?: Faction; minTier?: number; maxTier?: number }`，如"随机一个开源友军""最低阶友军"。
2. `copyStats` 增加 `consume: true`：复制后吞并目标（目标移除，属性取两者较高值再相加 amount），用于马一龙"收购"。
3. `destroy` 增加 `maxHp?: number`：仅当目标当前血量 ≤ maxHp 时生效，否则改为造成 maxHp 点伤害；用于小扎"一亿签字费"控强度（T2 建议 maxHp 3，每级 +2）。
4. 头条选项与突发允许多个效果：`effects: EventEffect[]`（保留单个 `effect` 兼容），按顺序结算。
5. `swapAll` 与 `pullFront` 若在商店阶段触发，则记为"本场战斗开始时生效"的修正器，而不是立即改队形。
6. 群体基建对全队每个单位各触发一次 `eatItem`，这是有意设计。
7. 允许召唤物承担触发器覆盖（friendSummoned、pushBack 由水军/幻觉使用）。
8. 新增触发器 `startTurnRandomForm`（可选）：GPT 娘"日地月"每回合开始随机获得三种形态之一（+2 攻 / +2 血 / 本回合商店价格 -1），若引擎实现成本高可用 `startTurn` + 随机 buff 代替。

# 2.0 版设计（2026-10-23 下午起，覆盖第 2、3、5、6 节中冲突的内容）

> 核心目标：**不同组合成长后各有各的优势和爽感**（参考 CF 手游"悠悠牌"）。单机为主、联机为辅。
> 玩家反馈 1.0 版"不有趣、正反馈弱"，诊断：没有取舍、技能看不见、头条温吞、没有目标感。2.0 用"流派"作为一切系统的主轴。

## 12. 流派系统（主轴）
每个单位有 1 个阵营（faction）和 0~1 个职业（role）。阵营 4 种、职业 4 种，共 8 条"流派线"。**阵营羁绊按 2 / 4 / 6 个三档递进**（同名单位 Lv 不计数，按个数），职业羁绊按 2 / 4 两档。每档都要有**看得见的变化**：卡面发光底色、战斗开场横幅"开源 ×4 ：共享升级！"、独有特效。

### 12.1 四阵营（成长方式各不相同）
| 阵营 | 幻想 | 2 个 | 4 个 | 6 个 | 高光时刻 |
|---|---|---|---|---|---|
| 开源 open | 人人为我 | 开战时开源单位 +1/+1 | 任一开源单位被购买时，全体开源单位永久 +1/+1 | 开源单位每回合开始永久 +1/+1 | 全队同时冒绿色"+1/+1"的同步升级 |
| 闭源 closed | 铜墙铁壁 | 前排获得 3 护盾 | 全体闭源单位获得等于 1/3 血量的护盾，护盾被打碎时反弹 2 伤害 | 护盾不会被技能穿透，反弹 = 攻击者攻击力 | 敌人撞在盾上自爆 |
| 算力 compute | 一卡顶一队 | 装备最多的单位 +2 攻 | 算力单位的装备效果 ×2 | 装备最多的单位每次攻击额外攻击 1 次 | 一个 30 攻的单位一枪一个 |
| 民间 folk | 人海战术 | 开战召唤 1 个水军 | 召唤物继承召唤者 50% 属性；友军阵亡召唤 1 个 1/1 水军 | 召唤物阵亡时对敌方全体造成 1 伤害 | 满屏小兵，连环爆炸 |

### 12.2 四职业（跨阵营的横向组合）
| 职业 | 2 个 | 4 个 |
|---|---|---|
| 研究员 researcher（达里奥、伊利亚、杨立昆、梁圣、Claude 娘、DeepSeek 娘……） | 回合结束研究员永久 +1 攻 | 研究员技能触发两次 |
| 商人 trader（奥特曼、老黄、显卡黄牛、套壳 App、豆包娘……） | 每回合 +1 算力 | 每回合 +2 算力，且商店价格 -1 |
| 偶像 idol（GPT 娘、Gemini 娘、千问娘、AI 女友、评测榜单……） | 偶像阵亡时全队 +1 攻 | 开战时随机复制一名偶像的属性给最弱友军 |
| 工程师 engineer（提示词工程师、Vibe Coder、标注员、数据爬虫、抱抱脸……） | 进化时额外 +1/+1 | 每回合首次刷新免费，进化时全队 +1/+1 |

单位名单仍是 3.9 的 32 个 + 召唤物；内容任务为每个单位分配职业（每职业 7~9 个，跨阵营分布）。

### 12.3 装备（取代一次性基建，CF 悠悠牌的卡槽）
- 每个单位 **3 个装备槽**：武器 / 防具 / 饰品 各 1。装备是商店里的卡，拖到单位上永久生效，卡面显示小图标。
- 同类型同名装备 2 件合成 **金色版**（效果 ×2 并附加一条）。装备随单位出售一起折算（卖出 +1 算力/件）。
- 列表（12 件，id 固定，沿用现有图标名）：
  - 武器：`gpu_h100` 显卡 +3 攻（金：+6 攻，攻击时无视护盾）、`quantize` 量化 +3 攻 -1 血（金：+6/-1，攻击附带 1 点溅射）、`launch_event` 发布会 攻击时 30% 概率额外攻击 1 次（金：60%）、`trending` 热搜 攻击目标改为血最少的敌人（金：且 +2 攻）
  - 防具：`dataset` 数据集 +1/+3（金：+2/+6）、`firewall` 防火墙 开战获得 4 护盾（金：8 护盾，碎盾反弹 2）、`alignment` 对齐 -1 攻 +5 血，受伤 ≤1 时免疫（金：+10 血）、`jumpbox` 跳板机 该单位阵亡时在最后排以 1 血复活一次（金：以一半血复活）
  - 饰品：`rlhf` RLHF 每回合结束永久 +1/+1（金：+2/+2）、`distill` 蒸馏 开战时复制相邻友军中较高的攻击（金：复制攻和血）、`finetune` 微调 技能触发时额外触发 1 次（金：2 次）、`funding_round` 融资 该单位被出售时 +3 算力，每回合 +1 算力（金：+2）
- 消耗品（不占槽，买了直接用）3 种：`coffee` 咖啡 本回合刷新免费 ×3（1 算力）、`press` 新闻稿 随机一个单位 +1 等级（3 算力）、`pivot` 转型 单位变成同阶随机单位（1 算力）。

### 12.4 开局赛场三选一（整局全局规则）
开局展示 3 张"赛场卡"选 1，至少 8 张：开源大会（开源单位 -1 价）、GPU 荒（全体 +1 攻 -1 血）、融资寒冬（每回合 +2 算力，商店少 1 格）、刷新狂欢（刷新免费，购买 +1 价）、1 号位光环（每次刷新 1 号位单位 +1/+1）、装备展（商店多 1 个装备格）、人海时代（召唤物 +1/+1）、研究院（研究员 -1 价）。赛场卡会"推"玩家进某条流派，但不强制。

### 12.5 8 人房淘汰赛（取代热搜/信心）
- 你 + 7 名对手，每人 **20 点热度**（血）。对手优先用服务端真实玩家快照命名，不足用 AI 对手，每个 AI 对手**绑定一条流派**并有名字与头像（如"老黄的显卡军团"算力流、"小扎的羊驼农场"开源流、"水军总部"民间流……8 个预设）。
- 每回合你随机对一名存活对手，其余对手两两互打（引擎模拟，用机器人按各自流派购物）。输方扣血 = 1 + 胜方存活单位数 + 回合阶段（回合 1~4：0，5~8：1，9+：2）。热度归零淘汰。你被淘汰 → 结局页显示名次；剩你一人 → 胜利（吃鸡）。
- 侧栏 8 个头像 + 血条 + 流派徽章，点开可看对方阵容与羁绊。"还剩 N 人"横幅。预计 10~14 回合结束。
- 回合上限 20 兜底按血量排名。

### 12.6 战斗：交替开火（取代同时互撞）
- 双方按站位交替行动：我方 1 号 → 敌方 1 号 → 我方 2 号 → 敌方 2 号……（跳过阵亡者，循环直到一方全灭或 60 次行动后按剩余血量判定）。
- 默认目标：敌方最前排存活单位；装备/技能可改目标（热搜：血最少）。攻击 = 造成等于攻击力的伤害，触发 `beforeAttack`/`hurt`/`faint`/`kill` 等。
- 每次攻击一个 `attack` 事件 + `damage` 事件，客户端逐个播放（0.35s/次，2x 可加速），技能触发时 0.6s 慢放 + 大字技能名。
- 开战顺序：start → 赛场规则 → 羁绊横幅（按档位） → 开战时技能 → 交替开火。

### 12.7 PVE 怪物回合
- 第 4 回合"幻觉大军来袭"（6 个 2/2 幻觉，阵亡时分裂 1/1）、第 9 回合"老黄的显卡军团"（Boss 老黄 8/20 + 4 个显卡 0/6，Boss 每次攻击对全体 1 伤害）。
- PVE 回合不扣血；打赢**三选一奖励**（随机：高一阶单位 / 金色装备 / +6 算力）；打输无奖励。所有对手同回合也打 PVE（模拟），不互相扣血。

## 13. 单位技能戏剧化
- 所有现有 `buff` 类技能数值 ×2；新增效果：`steal`（本场偷取一名敌方单位到我方末尾）、`explode`（阵亡时对敌方全体造成等于自身攻击的伤害）、`doubleStats`（本场属性翻倍，一次）、`revive`（以 1 血复活一次）、`chain`（击杀后立即再攻击一次）。至少 10 个单位改用这些效果。
- 每个单位新增 `role` 字段；`lines` 增加 `onSynergy`（羁绊触发时的台词）。

## 14. 可读性与正反馈
- 战斗中：技能触发慢放 0.6s，屏幕中央大字技能名 + 单位头像；连杀显示"连杀 ×N"；护盾碎裂、反弹、召唤、偷取各有专属小动画。
- 战后总结：MVP（伤害最高单位）+ 一句话归因（"Lv2 标注员前排硬扛 5 枪"/"民间 ×4 的水军潮淹没了对手"）+ 本场羁绊档位。
- 结局页：名次、本局流派（按羁绊最高档判定）、"流派首次达成"成就、解锁图鉴。
- 商店：4 单位 + 2 装备 + 1 消耗品；"升级商店"按钮（4 算力，提前解锁下一阶，每局最多 2 次）；"下回合预告"保留。

## 15. 数据与引擎变更摘要（给引擎任务）
- `UnitDef` + `role: 'researcher'|'trader'|'idol'|'engineer'`、`lines.onSynergy?`。
- `EquipDef { id, name, slot:'weapon'|'armor'|'trinket', desc, goldDesc, price, effect, goldEffect, icon }`、`ConsumableDef`、`ArenaDef`、`OpponentPreset`、`PveDef`。
- `UnitInst` + `equips: { weapon?: EquipInst; armor?: EquipInst; trinket?: EquipInst }`，`EquipInst { defId, gold: boolean }`。
- `RunState`：去掉 lives/trophies，改 `hp`、`opponents: Opponent[]`（id/name/avatar/archetype/hp/alive/team 快照/isHuman）、`arena`、`shopLevel`、`pve?`。
- 羁绊计算输出 `SynergyState[]`（faction/role、count、tier），战斗事件新增 `synergyTier`、`steal`、`explode`、`revive`、`chain`、`equipProc`。
- 服务端：快照上传/匹配不变；排行榜按名次与存活回合；每日种子不变。
