# 《大玩家》设计规范（所有子任务的唯一基准）

> AI 圈主题的多人联机大富翁网页游戏。参赛：1024 切磋大会 · 游戏赛道（口号"让人想再玩一局"）。
> 非商用。规则机制借鉴经典大富翁 + Steam《大富翁 10》，所有名称/美术均为原创或外号/戏仿，不使用 Monopoly / 大富翁 商标与原画。

## 1. 一句话

玩家扮演 AI 圈名人或"模型娘"，掷骰子在 40 格棋盘上走，买下 AI 公司/基建当地产，升级成更强的模型版本，向路过的对手收 **Token（API 调用费）**，用道具和突发事件互相坑，把别人熬到破产就赢。

## 2. 核心术语（统一叫法，代码和文案都用这套）

| 经典大富翁 | 大玩家 | 说明 |
|---|---|---|
| 金钱 $ | **Token**，缩写 `T`，显示如 `1500T` | 起始 1500T，可在房间设置调 |
| 经过起点 +200 | 经过 **融资轮** +200T | 格子 0 |
| 地产 | **基建**（AI 公司 / 产品） | 8 个颜色组，共 22 格 |
| 房子 1~4 级、酒店 | **模型版本** v1~v4，顶级 **旗舰 (AGI)** | level 0~5，5 = 旗舰 |
| 租金 | **API 调用费** | 落在别人基建上自动扣 |
| 铁路 ×4 | **算力中心** ×4 | 拥有越多收费越高 [25,50,100,200] |
| 公用事业 ×2 | **电力** 与 **数据** | 费用 = 骰子点数 ×4（拥有 2 个 ×10） |
| 机会 Chance | **热搜** 卡 | 格子类型 `chance` |
| 命运 Community | **突发** 卡 | 格子类型 `fate` |
| 所得税 / 奢侈税 | **API 账单** 200T / **显卡税** 100T | 税款进入奖池 |
| 免费停车 | **开源节** | 落上拿走奖池全部 Token |
| 监狱 | **监管审查** | 落在 10 号格只是"路过参观" |
| 进监狱 | **被监管**（格子 30） | 三次连续双骰也进 |
| 出狱卡 | **合规豁免卡** | |
| 抵押 | **抵押**（质押给"投资人"） | 保留，半价抵押，赎回 110% |
| 骰子 | **GPU 骰子**（皮肤可选，纯外观） | 2 个 d6，双骰再掷，3 次双骰进监管 |

## 3. 规则（服务端权威，逐条实现）

### 3.1 房间
- 2~6 人（含机器人）。4 位大写字母房间码。房主可添加/移除机器人、改设置、开始游戏。
- 设置：`startMoney`(默认 1500)、`maxRounds`(默认 30，0 = 不限)、`turnTimeoutSec`(默认 45，0 = 不限；超时自动按默认动作执行，防止卡住)。
- 局域网：一台电脑 `npm start`，终端打印 `http://<局域网IP>:3000` 和二维码；手机扫码进入。公网部署同一套代码。
- 断线重连：客户端 localStorage 存 token；重连后 `hello{token}` 恢复身份。掉线玩家由机器人托管直到回来。

### 3.2 回合流程（`turnPhase`）
1. `preRoll`：当前玩家可 **使用道具**（任意个数），然后点 **掷骰子**。在监管审查中时改为：付 50T / 用豁免卡 / 尝试掷双骰（第 3 回合强制付费）。
2. `moving`：服务端算路径（逐格），遇到 **路障** 立即停在该格并清除路障。经过融资轮 +200T。
3. `landed`：按格子类型结算：
   - 无主基建/算力/公用 → `pendingDecision = {type:'buy'}`：买 / 不买（不买就空着，不拍卖）。
   - 自己的基建（非算力/公用，未抵押）→ `pendingDecision = {type:'upgrade'}`：升 1 级（费用见数据）/ 不升。**不要求集齐同色组**（大富翁 10 风格）。集齐同色组时该组基础费 ×2（level 0 时）。
   - 别人的 → 自动扣 API 调用费。有护盾则免并消耗护盾。被抵押的不收费。
   - 热搜/突发 → 抽卡，`pendingDecision = {type:'card'}`，客户端确认后应用效果。
   - 税 → 扣钱入奖池。开源节 → 拿奖池。被监管 → 移到 10 号，`inJail = true`。
4. `postRoll`：若钱不够付款 → 自动清算（先拆最高等级建筑半价卖，再抵押基建），仍不够 → **破产**，全部资产归债主（债主是银行则基建变无主、建筑清零）。然后：双骰且未进监管 → 回到 `preRoll` 再掷；否则 `endTurn` 切到下一个未破产玩家。`endTurn` 由服务端自动执行，客户端无需点"结束回合"。
5. 玩家在自己回合的 `preRoll` 可对自己任意基建 **抵押 / 赎回**（管理面板）。

### 3.3 胜负
- 只剩 1 人未破产 → 胜。
- 达到 `maxRounds` → 按身价（现金 + 基建原价 + 建筑投入，抵押的按半价）排名，最高者胜。

### 3.4 道具（Item）—— 由突发/热搜卡获得，自己回合 `preRoll` 使用
| id | 名 | 效果 |
|---|---|---|
| `roadblock` | 宕机路障 | 放在前方 1~8 格内任一格，任何人走到立刻停下 |
| `missile` | DDoS 导弹 | 对前方 1~10 格内一块别人的基建降 1 级（旗舰→v4） |
| `rocket` | 火箭加速 | 本回合掷骰结果 +6 |
| `turtle` | 限流乌龟 | 指定一名对手，其下次掷骰固定为 1 |
| `shield` | 防火墙护盾 | 下一次应付的 API 调用费免除 |
| `teleport` | 跳板机 | 直接传送到自己任意一块基建（无基建则到融资轮，不发钱） |
| `jailfree` | 合规豁免卡 | 在监管审查时直接出来 |

道具上限 6 个，多的丢弃。

### 3.5 卡牌效果类型（`CardEffect`，引擎按此实现，内容由 cards.json 提供）
```
{type:'money', amount}                       // 正负 Token（负数不够则清算）
{type:'moneyFromEach', amount}               // 每位其他玩家给你 amount（可为负=你给每人）
{type:'moveTo', cellId, collectStart?:true}  // 移到某格（经过融资轮是否发钱）
{type:'moveBy', steps}                       // 前进/后退 n 格（负数后退，不经融资轮）
{type:'gotoJail'}
{type:'item', itemId}                        // 获得道具
{type:'repairs', perLevel, perFlagship}      // 按建筑交维护费
{type:'nearest', cellType:'compute'|'utility', rentMul} // 到最近算力/公用，若有主则按倍数付费
{type:'rentMod', factor, rounds}             // 全局 API 调用费倍率，持续 n 轮（如价格战 0.5，涨价 2）
{type:'upgradeCostMod', factor, rounds}      // 全局升级费倍率（显存涨价）
{type:'downgradeAll', levels}                // 所有玩家所有建筑降级（如"大模型泡沫破裂"）
{type:'levelUpRandom'}                       // 自己随机一块基建 +1 级
{type:'swapPosition', with:'random'}         // 与随机对手换位置
{type:'potToPlayer'}                         // 拿走奖池
```

## 4. 数据文件（`shared/data/*.json`，内容由"内容规则"任务产出，必须符合下面 TS 类型）

```ts
// shared/src/types.ts —— 以此为准，引擎/客户端/数据三方共用
export type CellType = 'start'|'property'|'compute'|'utility'|'chance'|'fate'|'tax'|'jail'|'gotojail'|'free';
export interface Cell {
  id: number;              // 0..39，顺时针，0 在右下角（经典布局）
  type: CellType;
  name: string;            // 显示名（≤6 个汉字最佳）
  desc?: string;           // 一句话戏仿说明
  group?: string;          // property 时的颜色组 id
  price?: number;          // property/compute/utility 购买价
  rents?: number[];        // property: 长度 6 [lv0,lv1,lv2,lv3,lv4,旗舰]
  upgradeCost?: number;    // property: 每级升级费（旗舰也按此）
  tax?: number;            // tax
  icon?: string;           // 可选图标文件名（client/public/assets/cells/）
}
export interface ColorGroup { id: string; name: string; color: string /*#hex*/; cells: number[] }
export interface BoardData { cells: Cell[]; groups: ColorGroup[]; startBonus: number; jailFine: number }

export interface Card { id: string; deck: 'chance'|'fate'; title: string; text: string; effect: CardEffect; icon?: string }
export type CardEffect = /* 见 3.5 */;

export interface Character {
  id: string; name: string;         // 显示名（外号 / 娘化名）
  title: string;                    // 头衔，如"闭源教父"
  flavor: string;                   // 一句人设
  color: string;                    // 棋子主色 #hex
  avatar: string;                   // 'characters/<id>.png' 若存在则用，否则回退 'characters/<id>.svg'
  lines: { roll: string[]; buy: string[]; rent: string[]; pay: string[]; jail: string[]; bankrupt: string[]; win: string[] }; // 每项 2~3 条短语
}
export interface Item { id: string; name: string; desc: string; icon: string; targetKind: 'none'|'cellAhead'|'enemyPropertyAhead'|'player'|'ownProperty'; range?: number }
export interface DiceSkin { id: string; name: string; desc: string }
```

**角色 ID 固定如下**（美术与内容同时用）：
- 真人外号：`altman` 奥特曼、`liang` 梁圣、`huang` 老黄、`musk` 马一龙、`zuck` 小扎、`dario` 达里奥、`ilya` 伊利亚、`lecun` 杨立昆
- 娘化：`deepseek_chan` DeepSeek娘（大肥鱼）、`claude_chan` Claude娘、`gpt_chan` GPT娘、`gemini_chan` Gemini娘、`qwen_chan` 千问娘、`doubao_chan` 豆包娘

真人角色只做善意戏仿：头衔和台词只能是公开梗、正向或自嘲，不写负面评价、不涉私生活。

**棋盘结构固定**（名称/价格由内容任务定，位置和类型不可变）：
`0 start | 1 棕 | 2 fate | 3 棕 | 4 tax(200) | 5 compute | 6 浅蓝 | 7 chance | 8 浅蓝 | 9 浅蓝 | 10 jail | 11 粉 | 12 utility(电力) | 13 粉 | 14 粉 | 15 compute | 16 橙 | 17 fate | 18 橙 | 19 橙 | 20 free | 21 红 | 22 chance | 23 红 | 24 红 | 25 compute | 26 黄 | 27 黄 | 28 utility(数据) | 29 黄 | 30 gotojail | 31 绿 | 32 绿 | 33 fate | 34 绿 | 35 compute | 36 chance | 37 深蓝 | 38 tax(100) | 39 深蓝`

颜色组 id：`brown, lightblue, pink, orange, red, yellow, green, darkblue`。价格/费用照经典大富翁数值表（棕 60 起 … 深蓝 400），升级费按组 50/50/100/100/150/150/200/200。

## 5. 技术架构

- Node 22 + TypeScript，npm workspaces：`shared/`（类型 + 数据 + 纯函数）、`server/`（引擎 + ws 房间 + 机器人 + 静态托管）、`client/`（Vite + PixiJS 8 + GSAP 3，HTML 覆盖层做 UI）。
- 服务端权威、确定性引擎：`engine/` 是纯函数 `reduce(state, action, rng) => {state, events}`，不碰网络；`vitest` 测试覆盖主要规则。
- 一个进程：`server` 同时托管 `client/dist` 静态文件和 `/ws` WebSocket，端口 `PORT` 默认 3000。
- 启动脚本：`npm run dev`（前后端热更）、`npm run build`、`npm start`（生产，打印局域网地址 + 二维码）。`Dockerfile` 一份。

### 5.1 WebSocket 协议（JSON，`shared/src/protocol.ts`）
客户端 → 服务端：
```
{t:'hello', token?}                                   // 首包；无 token 则新建身份
{t:'createRoom', name, characterId}
{t:'joinRoom', code, name, characterId}
{t:'leaveRoom'} {t:'addBot'} {t:'removeBot', playerId} {t:'updateSettings', settings} {t:'startGame'}
{t:'setCharacter', characterId}
{t:'action', action: GameAction}
{t:'chat', text} {t:'ping'}
```
`GameAction`：
```
{type:'roll'} {type:'buy'} {type:'skipBuy'} {type:'upgrade'} {type:'skipUpgrade'} {type:'ackCard'}
{type:'useItem', itemId, target?: {cellId?: number; playerId?: string}}
{type:'payJail'} {type:'useJailCard'} {type:'rollJail'}
{type:'mortgage', cellId} {type:'unmortgage', cellId}
```
服务端 → 客户端：
```
{t:'welcome', token, playerId, characters, board, items, diceSkins}   // 静态数据一次下发
{t:'room', room: RoomState}            // 大厅状态
{t:'game', state: GameState, events: GameEvent[]}   // 每次变更：完整快照 + 本次产生的事件列表（客户端先按序播放事件动画，再以快照为准）
{t:'error', msg} {t:'chat', from, text} {t:'pong'}
```
`GameState`：
```ts
interface Player { id; name; characterId; color; money; pos; inJail; jailTurns; items: string[]; bankrupt; connected; isBot; shield: boolean; turtle: boolean; rocket: boolean; netWorth }
interface Owned { owner: string; level: number /*0-5*/; mortgaged: boolean }
interface GameState {
  phase: 'playing'|'ended'; round; turnIndex; currentPlayerId;
  turnPhase: 'preRoll'|'moving'|'landed'|'postRoll';
  players: Player[]; owned: Record<number, Owned>; roadblocks: number[]; pot: number;
  dice: [number, number] | null; doublesCount;
  pending: null | {type:'buy', cellId} | {type:'upgrade', cellId} | {type:'card', card: Card} | {type:'jail'};
  modifiers: { rentFactor: number; rentRounds: number; upgradeFactor: number; upgradeRounds: number };
  log: string[]; // 最近 50 条
  winnerId?: string; ranking?: {playerId, netWorth}[];
}
```
`GameEvent`（客户端据此播动画，每个都带足够信息，不需要再查 state）：
```
{type:'turnStart', playerId}
{type:'dice', playerId, dice:[a,b], total, doubles, rocket?:true, turtle?:true}
{type:'move', playerId, from, to, path:number[], passedStart:boolean}
{type:'roadblockHit', playerId, cellId}
{type:'money', playerId, delta, reason:string, balance}
{type:'buy', playerId, cellId, price}
{type:'rent', fromId, toId, cellId, amount, shielded:boolean}
{type:'upgrade', playerId, cellId, level, cost}
{type:'downgrade', cellId, level, byId?}
{type:'card', playerId, card}
{type:'tax', playerId, amount}  {type:'pot', playerId, amount}
{type:'jail', playerId} {type:'jailExit', playerId, how:'pay'|'card'|'doubles'|'forced'}
{type:'item', playerId, itemId, targetCellId?, targetPlayerId?}
{type:'mortgage', playerId, cellId, on:boolean}
{type:'modifier', kind:'rent'|'upgrade', factor, rounds}
{type:'bankrupt', playerId, creditorId?}
{type:'gameOver', winnerId, ranking}
{type:'log', text}
```

### 5.2 客户端结构
```
client/src/
  main.ts           // 场景切换：Lobby → Room → Game
  net.ts            // ws 封装、重连、token
  scenes/lobby.ts   // 输名字、选角色（横向卡片）、创建/加入房间
  scenes/room.ts    // 房间码 + 二维码、玩家列表、机器人、设置、开始
  scenes/game.ts    // 组装 BoardView + HUD + 事件队列播放
  board/board.ts    // Pixi 棋盘：40 格环形 2.5D 卡片式，建筑等级贴图，棋子
  board/layout.ts   // 自适应：桌面横屏棋盘居中 + 右侧面板；手机竖屏棋盘铺满宽度 + 底部抽屉面板
  fx/index.ts       // 特效接口（见 5.3）
  ui/hud.ts         // 玩家条、当前回合提示、行动按钮区（大按钮，单击即可）
  ui/panels.ts      // 基建详情、道具栏、抵押管理、日志、结算
  assets.ts         // 资源加载，png 优先、svg 回退
```

### 5.3 特效接口（`client/src/fx/index.ts`，特效任务只改 `fx/` 目录）
```ts
export interface Fx {
  init(app: Application, board: BoardView, overlay: HTMLElement): void;
  dice(a: number, b: number, skin: string): Promise<void>;        // 骰子翻滚 ≥0.9s，落定显示点数
  move(playerId: string, path: number[]): Promise<void>;          // 逐格跳跃，每格 ~0.18s，落地尘土
  passStart(playerId: string, amount: number): Promise<void>;
  buy(cellId: number, playerId: string): Promise<void>;           // 地契飞入、格子染色
  build(cellId: number, level: number): Promise<void>;            // 建筑升起 + 光柱/粒子，旗舰更夸张
  downgrade(cellId: number, level: number): Promise<void>;        // 爆炸/冒烟
  rent(fromId: string, toId: string, amount: number, shielded: boolean): Promise<void>; // Token 飞行
  money(playerId: string, delta: number, reason: string): Promise<void>;  // 浮字
  card(card: Card): Promise<void>;                                // 全屏卡牌翻转，点击或 2.5s 关闭
  jail(playerId: string): Promise<void>;
  item(playerId: string, itemId: string, targetCellId?: number, targetPlayerId?: string): Promise<void>;
  bankrupt(playerId: string): Promise<void>;
  gameOver(winnerId: string): Promise<void>;                      // 撒花
  shake(ms: number, strength: number): void;
}
```
所有动画可被 `skipAll()` 快进（玩家点击屏幕任意处）。

## 6. 美术方向（概要，详见 docs/ART.md）
- 高清动漫风、明亮赛博科技感：深蓝紫底色 + 霓虹青/品红高光，UI 玻璃拟态卡片，字体圆润。
- 棋盘：2.5D 卡片式格子，每格一张"地块卡"（颜色条 + 名字 + 价格），建筑以可爱 Q 版"服务器机柜/数据中心"表示，等级越高越高越亮，旗舰有光环。
- 角色：Q 版头像立绘。`client/public/assets/characters/<id>.png`（1024×1024，透明底）若存在优先使用；没有则用同名 `.svg` 占位。`docs/PROMPTS.md` 给每个角色/建筑的 AI 生图提示词，用户自行生成后放入即可生效。
- 手机优先：竖屏时棋盘铺满宽度，操作按钮 ≥ 56px 高，所有操作单击完成。

## 7. 范围边界（两天内不做）
不做：交易、拍卖、股票、语音、账号系统、持久化排行榜。

## 8. 规则决议（对第 3 节的补充，引擎按此实现）
1. `nearest.rentMul`：移到最近的算力/公用后，若有主则付 **正常费用 × rentMul**（算力按持有数，公用按本次骰子 ×4/×10），无主则进入买/不买决策。
2. `repairs`：每块基建 level 1~4 按 `perLevel × level` 收；level 5（旗舰）只收 `perFlagship`，不叠加。
3. `rentMod` / `upgradeCostMod`：新卡 **覆盖** 旧值（factor 与 rounds 都覆盖），不相乘。rounds 在每轮（回到第一位玩家）开始时 -1，到 0 恢复 1。
4. 移动类卡：`moveTo`、`moveBy`、`nearest` 落地后 **照常结算**（买地/收费/抽卡/税）；`swapPosition` 只交换位置，**不结算**。
5. 边界：`levelUpRandom` 没有可升级基建则无事发生；`downgradeAll` 最低到 0，被抵押的基建也降；`moneyFromEach` 为负（我给每人）钱不够时走自动清算。
6. 头像：`Character.avatar` 填 `characters/<id>.svg`；客户端加载时先试同名 `.png`，失败再用 `.svg`。
7. 格子名允许到 8 字符，客户端自动缩小字号。
8. "集齐同色组"判定只看所有者，被抵押的格子也算；但被抵押的格子本身不收费。
9. 奖池初始 0；税和监管罚款（付 50T 出狱）都进奖池。
10. 回合超时默认动作：`preRoll` 自动掷骰；`buy` 默认不买；`upgrade` 默认不升；`card` 自动确认；监管中默认尝试掷骰（第 3 次强制付费）。

## 9. 美术/客户端补充决议
1. `Cell` 增加可选字段 `short?: string`（≤3 字），手机端格子显示 short，桌面端显示 name。
2. 建筑贴图：level 0~5 对应 `buildings/empty.svg`, `lv1.svg` … `lv5.svg`（lv5 = 旗舰）；同样 png 优先、svg 回退。
3. `Cell.icon` 为空时客户端按类型取 `cells/<type>.svg`；公用事业 12 号格取 `utility_power`，28 号格取 `utility_data`。
4. 棋盘画法：俯视平面棋盘，地块卡有厚度（底部深色边模拟 2.5D），建筑用贴图立在格子上，文字始终正向不旋转；左右两列格子横长。详见 docs/ART.md。
5. 特效接口（5.3）增加 `roadblockHit(playerId, cellId)`；`item()` 内部不再调用 `downgrade()`，由事件队列按服务端事件顺序依次播放。
6. 震动：多个震动不叠加取最大值；手机端强度 ×0.7。单回合动画总时长预算 ≤4s，玩家点击屏幕任意处可快进。
7. 结算页：胜利动画第 3 秒出现"再来一局"大按钮（房主点后回到同一房间，保留玩家）。
8. 角色主色以 `characters.json` 为准（已调整为互相区分的 14 色）；骰子皮肤 id：`h100`, `furnace`, `mahjong`, `vram`。

## 10. 平衡性决议（2026-10-22）
1. 新增动作 `{type:'upgradeAny', cellId}`：当前玩家在自己的 `preRoll`（含监管中）可对任意一块自己的、未抵押、level<5 的 property 升 1 级，**每回合最多 1 次**（踩到自己基建时的升级决策不占这个次数）。费用与普通升级相同（受 upgradeFactor 影响）。事件沿用 `upgrade`，加字段 `remote:true`。
2. 客户端在"我的基建"管理面板里，每块可升级的基建旁给"升级（费用）"按钮，仅 preRoll 且本回合未用过时可点。
3. `GameState` 增加 `upgradedThisTurn: boolean`，`legalActionTypes` 在可用时包含 `'upgradeAny'`。
