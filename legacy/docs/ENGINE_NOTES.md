# 引擎 / 协议实现说明（客户端开发必读，补充 DESIGN.md）

## 启动
- `npm run dev`：server(tsx watch) :3000 + client(Vite) :5173，`/ws` 已代理。`npm run build && npm start` 单进程 :3000。
- 前端 `import ... from '@dafuweng/shared'`（Vite 别名指向 TS 源码）。**不要** import `@dafuweng/shared/data`（用了 fs）。静态数据全部由 `welcome` 消息下发。

## 给前端用的纯函数（shared/src/rules.ts）
`calcRent`、`baseRent`、`ownsWholeGroup`、`upgradeCostOf`、`mortgageValue`、`unmortgageCost`、`calcNetWorth`、`calcRanking`、`computePath`、`pathTo`、`cellsAhead`、`nearestCellOfType`、`itemTargets(board, state, playerId, itemId, range?)`（道具可选目标，用于高亮）、`legalActionTypes(state, playerId, board?)`（决定显示哪些按钮；传 board 时 `'upgradeAny'` 会检查有无付得起的目标）、`upgradeAnyTargets(board, state, playerId)`（管理面板里哪些基建显示"升级"按钮）、`canUpgradeAny(state, playerId, board?)`、`isPreRoll(state, playerId)`（是否处于自己的掷骰前阶段：对局进行中 + 轮到自己 + `turnPhase==='preRoll'` + `pending` 为 null 或 jail；道具栏 / 抵押 / 远程升级按钮的置灰都用它）。

## 消息字段
- `welcome`: `{t, token, playerId, characters, board, items, diceSkins, serverTime}`
- `room`: `{t, room: RoomState}`；`RoomState = {code, hostId, status:'lobby'|'playing'|'ended', players: RoomPlayer[], settings:{startMoney,maxRounds,turnTimeoutSec}, minPlayers:2, maxPlayers:6}`；`RoomPlayer = {id, name, characterId, color, isBot, isHost, connected, diceSkin?}`
- `game`: `{t, state: GameState, events: GameEvent[], serverTime}`；重连/连接状态变化时 `events=[]`。
- 其他 S2C：`error{msg}`、`chat{from,name,text}`、`pong`、`left`（leaveRoom 成功后）。
- `kicked`: `{t:'kicked', reason:'duplicate_login'}` —— 同一 token 在别处（另一个标签页 / 设备）发了 `hello`，旧连接先收到这条消息，随后被服务端以关闭码 **4001** 关闭。客户端收到后（或 onclose 的 code===4001 兜底）**停止自动重连**并提示"你在另一个窗口打开了游戏"，由用户点"在这里继续"手动重连。不要再匹配 error 文案。
- `toast`: `{t:'toast', text: string, kind:'info'|'warn'}` —— 服务端轻提示，客户端弹 2~3 秒小条即可（warn 用醒目色），不影响状态。当前会发：
  - 游戏中掉线：`"XX 掉线，已由 AI 托管"`(warn)；大厅/结算中掉线：`"XX 掉线了"`(warn)。发给其他在线真人。
  - 重连：其他人收到 `"XX 重新连上了"`(info)；游戏中重连者本人收到 `"已恢复连接，AI 托管结束"`(info)。
  - 游戏中 leaveRoom：`"XX 离开了房间，由 AI 托管"`(warn)；大厅/结算中：`"XX 离开了房间"`(info)。
  - 房主转移：`"XX 成为新房主"`(info)。
  - 再来一局：`"房主已重开新一局"`(info)，紧跟着 `room`(status=playing) 和新的 `game` 快照（round=1，events=[turnStart]）。
  - 文案以服务端为准，客户端不要按文本做逻辑判断。
- 新增 C2S：`{t:'setDiceSkin', diceSkin}`；`{t:'backToRoom'}`（见规则 22）。新增 GameAction：`{type:'upgradeAny', cellId}`（见规则 21）。
- GameState 额外字段：`settings`、`decks:{chance,fate}`、`turnDeadline: number|null`（服务器时钟毫秒，配合 `serverTime` 做倒计时）、`turnCount`、`upgradedThisTurn: boolean`（本回合是否已远程升级）。Player 额外 `diceSkin?`。
- `Cell.short?: string`（≤3 字短名，已写进 shared 类型）：手机端格子显示 short；桌面端名字 ≥7 字符时也用 short，其余按宽度自动缩字号 / 换两行。
- 事件额外字段：`turnStart.round`；`dice.jail?`（出狱掷骰）；`move.teleport?`（path=[to]）、`move.backward?`；`upgrade.free?`；`upgrade.remote?: true`（upgradeAny 远程升级，玩家没站在该格上，特效直接在格子上播）；`downgrade.reason?: 'missile'|'card'|'liquidate'`；`tax.pot`；`mortgage.amount`。新增事件 `{type:'itemGain', playerId, itemId, discarded}`。

## 规则细节（客户端表现要对应）
1. 乌龟：`dice:[1,0], total:1, turtle:true`，第二颗骰子隐藏。
2. 火箭：`total = 骰面和 + 6`，骰面不变，`rocket:true`。
3. 正好停在 0 号也 +200。
4. 路障只拦掷骰移动；同格不能叠放；放置者自己也会被拦。
5. 买/升级决策只在钱够时弹出（pending），钱不够只有日志。
6. 升级只在踩到自己的 property 时（未抵押、level<5）。
7. 抵押只能 level 0 的格子，得 floor(price/2)，赎回 ceil(×1.1)；只能在自己 preRoll（监管中也可）做，不结束回合。
8. 自动清算：拆最高级建筑（半价）→ 按价格低到高抵押 → 破产（资产转债主/银行，道具清空）。
9. 卡牌罚款与 repairs 归银行；税与出狱罚款进奖池。
10. 监管：`payJail` 需现金 ≥50；付费/用卡后同回合正常掷骰；出狱双骰移动但不追加回合；第 3 次强制付费；三连双骰直接进监管不移动；监管中照常收租。
11. 跳板机可到自己任意格（含算力/公用/抵押），传送后不结算；监管中不能用。
12. 导弹只能打对手 level>0 的 property。
13. 换位排除破产与监管中的对手。
14. 每一次余额变化都发 `money{playerId, delta, reason, balance}`，`rent/buy/tax` 只是语义事件。每条日志也发 `log` 事件。卡牌 `card` 事件在抽到时发，`ackCard` 后才生效（客户端展示卡牌 → 点确认 → 发 ackCard）。
15. 超时：真人截止 = 本批事件动画估计时长 + turnTimeoutSec；机器人在动画估计 + 0.6~1.2s 后行动。动画估计（`server/src/bot.ts estimateAnimMs`）：骰子 **1400ms**、移动 180ms/格 + 250ms（瞬移 500ms）、卡牌 2600ms、turnStart/路障/买/税 600ms、升降级/道具/收租等 800ms、进出监管 1000ms、破产 1500ms，单批封顶 15s。
16. 出手顺序 = 加入顺序（房主先手）；角色房间内唯一，被占会自动换空闲角色，`setCharacter` 选已占角色报错。
17. 游戏中 `leaveRoom` = 永久托管；大厅掉线 60s 移出；无真人房间销毁；重连同 token 顶掉旧连接。
18. 默认 30 轮。**不限轮数（maxRounds=0）兜底**：第 200 轮（`UNLIMITED_ROUND_CAP`，shared 导出）结束仍未分出胜负，自动按身价结算（日志"已进行 200 轮仍未分出胜负，按身价结算"，照常发 `gameOver`，`state.round` 停在 200）。4 机器人实测约一半对局在 200 轮前就只剩 1 人。
19. **再来一局**：`status==='ended'` 时房主直接发 `startGame` 即可（无需先回大厅）。同一批玩家、同样设置、新种子；上一局中途 `leaveRoom` 的人转成机器人（新 id `bot_*`，名字加 `AI·` 前缀，保留角色），掉线未离开的真人仍是真人（继续托管直到重连）；结算后才离开的人直接移出。结算后房主若先加/删机器人、改设置、换角色，房间回到 `lobby`（`room.status='lobby'`，`game` 不再下发），之后照常 `startGame`。出手顺序仍为加入顺序。
20. 机器人策略（server/src/bot.ts）：每回合掷骰前（含监管中）先用 upgradeAny 远程升级评分最高（增收/费用，集齐同组 ×2）且升级后不跌破储备的一块；现金储备 = max(150, 对手单次最高可能收费)；凑齐同组 / 截胡 / 高租金档放宽储备；导弹打对手最高等级建筑；路障放在对手必经的自己高租金格；乌龟给离自己高价地最近的对手；前方 12 格有高租金格开护盾；前方危险时跳板机逃回自己地或用火箭跳过；监管中钱 ≥ 罚款+储备就付费出来。
21. **远程升级 upgradeAny**（DESIGN 10.1）：`{type:'upgradeAny', cellId}`，只能在自己的 `preRoll`（`pending` 为 null 或 jail，即监管中也行）发；目标必须是自己的、未抵押、level<5 的 property（算力/公用不行），钱 ≥ 当前升级费（含 upgradeFactor）。**每回合最多 1 次**（`state.upgradedThisTurn`，`turnStart` 时重置；双骰再掷 / 出狱后仍是同一回合）；踩到自己基建弹出的 `upgrade` 决策不占次数。成功后不结束回合、仍在 preRoll，发 `money` + `upgrade{remote:true}` + `log`。错误文案：'只能在掷骰前升级' / '本回合已经远程升级过了' / '这不是你的基建' / '只有基建可以升级' / '已抵押的基建不能升级' / '已经是旗舰了' / 'Token 不够，升级需要 xT'。
22. **回到房间 backToRoom**（C2S `{t:'backToRoom'}`）：仅房主；只在 `room.status==='ended'` 时生效 → 房间回到 `lobby`（`game` 置空，之后不再下发 game），广播 `room`(status=lobby)，其他真人收到 toast `"房主带大家回到了房间"`。玩家不变：上一局中途 `leaveRoom` 的人转成机器人（同规则 19），掉线未离开的真人保留席位，但按大厅规则进入 60s 宽限，超时未重连移出房间。进行中发送报错 `'游戏进行中，结算后才能回到房间'`；非房主报错 `'只有房主可以这样做'`；已在 lobby 时幂等（只重发 room 快照）。客户端结算页"回到房间"按钮用它（不再借道 updateSettings）。
23. **调试道具（仅测试）**：`RoomDeps.debugItems: ItemId[]`（或启动服务时设环境变量 `DEBUG_ITEMS=1`，等价于全部 7 种）——真人玩家开局及每个自己回合开始时，按"本局发得最少优先"补齐缺少的道具种类（受 6 个上限约束）。`DEBUG_FAST_BOTS=1` 让机器人不等动画立即行动。**生产默认都关闭**，开启时服务端启动日志会打印警告。端到端道具验证：`node scripts/e2e-items.mjs`（自动以调试模式起一个本地服务）或 `npm test`（`server/test/e2e.items.test.ts`，固定种子、真实 WebSocket）。
24. **调试钩子**：`window.__dfw = {net, store, app, scene}` 只在 `import.meta.env.DEV`（Vite 开发模式）或 URL 带 `?debug` 时挂载；`?debug` 还会在控制台打印事件队列日志。
