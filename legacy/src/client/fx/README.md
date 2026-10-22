# fx/ — 特效模块说明（给“酷炫版”同事）

目标：**只改 `client/src/fx/` 目录**即可把所有特效升级成酷炫版。事件队列（`scenes/game.ts`）只调用 `Fx` 接口，
不关心实现；棋盘（`board/board.ts` 的 `BoardView`）提供足够的只读 / 操作 API。

## 文件

| 文件 | 内容 |
|---|---|
| `index.ts` | `Fx` 接口 + `BasicFx` 组装（分发到下面的函数）、`shake()`、`createFx()`；降级上下文（导弹 / 泡沫破裂）、出狱钩子、`?fxdemo` 入口 |
| `runtime.ts` | `FxRuntime`：快进（`skipAll`）、`play(timeline)`、`fire(timeline)`、`wait(ms)`、`until(register, timeout)`、`onSkip(cleanup)`、常驻 `onSkipAll(fn)`、`setSpeed` |
| `context.ts` | `FxContext`：`{ app, board, overlay, rt, particles, shake }` |
| `textures.ts` | 2D canvas 生成的特效纹理（spark / dot / chip / coin / ring / glow / smoke / beam / hex / rainbow / flare / cage / crack），首次使用时生成并缓存 |
| `particles.ts` | **对象池 + 单 ticker 粒子系统**：`emit()` 单颗、`burst()` 爆散、`hold()/release()` 池化精灵（调用者用 gsap 驱动）、`floatText()`；手机端数量减半（`pc()`），快进清场 |
| `kit.ts` | HTML 覆盖元素 `htmlFx()`（自动注册快进清理）、`starRain` 全屏星芒雨、`starBurst`、`hudPing` 玩家条头像光环 + 弹跳、`htmlCoins` HTML 金币飞行、`screenFlash`、`popText` Pixi 大字 |
| `style.ts` | 酷炫版 HTML 覆盖层样式（前缀 `fx2-`），`fx.init()` 时注入一次，不依赖 `style.css` |
| `dice.ts` | CSS 3D 骰子：抛入 → 翻滚 → 弹两次 → 落定 + 青色冲击环；DOUBLE! / 火箭 +6 / 乌龟；四种皮肤 `.fx2-skin-*` |
| `move.ts` | 逐格跳跃（路径光点预告）、路过融资轮（金币喷泉 + 大字 + 金币飞向玩家条）、光柱传送、撞路障（急刹 + 碎裂 + 拦截！） |
| `build.ts` | 买地扫光染色、升级（光柱 + 弹性升起 + 冲击波；v4 电弧）、旗舰（暗场聚光 + 双倍金光柱 + 彩虹光环 + AGI 达成 + 星芒雨）、降级（火球 + 建筑碎块 + 黑烟 + 裂纹；泡沫破裂全场抖动冒烟） |
| `money.ts` | 收费金币弧线连射（尾迹、收款方吃金币弹跳、玩家条光环）、护盾六边形防火墙碎金币、余额浮字 |
| `card.ts` | 全屏卡牌：径向暗化 + 旋转光芒 → 3D 翻转 → 标题逐字弹跳 / 图标脉动 / 卡边流光 → 飞向玩家 |
| `overlay.ts` | 横幅、轻提示、监管（警灯 + 栏杆落下 / 出狱升起）、破产（像素碎裂）、胜利（WINNER + 王冠 + 彩带） |
| `items.ts` | 七种道具动画（导弹命中后的降级由随后的 `downgrade` 事件播放，DESIGN 9.5） |
| `demo.ts` | `?fxdemo` 调试面板（左下角按钮逐个触发特效并显示耗时；`window.__fxdemo.run(name) / freeze(on)` 供自动化截图） |

素材：`client/public/assets/fx/`（`spark.svg`、`spark_gold.svg` 星芒，`crown.svg` 胜利王冠）。

## 约定

1. **一切等待都走 `ctx.rt`**：`await rt.play(gsapTimeline)`、`await rt.wait(ms)`；装饰性动画用 `rt.fire(tl)`。
   这样玩家点屏幕时 `skipAll()` 会把所有动画 `progress(1)`、立刻结束等待，并在本批事件播完前让新动画直接到末帧。
   HTML 元素请用 `rt.onSkip(() => el.remove())` 注册清理。不要用无限循环（`repeat: -1`）的 tween 去 `rt.play`。
2. **画面状态以 BoardView 为准**：特效里改变“结果状态”要调用 BoardView 的操作方法（如 `setOwner / setLevel / setTokenCell`），
   不要只改精灵属性；每批事件播完，事件队列会 `board.sync(state)` 用服务端快照覆盖一次。
3. 时长预算：单回合普通动画 ≤4s；服务端按 `server/src/bot.ts estimateAnimMs` 估算节奏（骰子 1.4s、每格 0.18s、卡牌 2.6s…）。
   事件积压时事件队列会调用 `fx.setSpeed(1.6~3)`（等价于 `gsap.globalTimeline.timeScale`），`rt.wait` 也会按比例缩短。
4. 震动用 `ctx.shake(ms, strength)`：作用于 `board.world`（不影响 HUD），多个震动取最大值，手机 ×0.7。
6. 粒子一律走 `ctx.particles`（池化，不要 `new Sprite` 后自己 destroy）；需要用 gsap 驱动的光效用 `particles.hold()` 取、`release()` 还。
   HTML 覆盖元素用 `kit.htmlFx()` 创建（快进时自动移除）。数量用 `pc(n)` 包一层（手机减半）。
5. 坐标系：Pixi 舞台坐标 = 视口 CSS 像素（`autoDensity`）。`board.layers.board/buildings/tokens/fx` 在 `board.world` 下，
   使用**棋盘本地坐标**（左上角为 0,0，边长 `board.size`）；`board.layers.ui` 是屏幕坐标层。HTML 覆盖层 `ctx.overlay`
   （`position:fixed; inset:0; pointer-events:none`）用视口坐标，转换用 `board.worldToScreen()`。

## BoardView API（`board/board.ts`）

只读 / 查询：

| API | 说明 |
|---|---|
| `app` | Pixi `Application` |
| `world` | 棋盘内容根容器（震动作用于此；位置平时为 0,0） |
| `root` | 棋盘外层容器，`position` = 棋盘左上角的屏幕坐标 |
| `layers.board / buildings / tokens / fx / ui` | 图层：地块卡与中央区 / 建筑（`sortableChildren`，zIndex=锚点 y）/ 棋子 / 特效 / 屏幕坐标 UI |
| `u`, `size`, `compact` | 普通格短边像素、棋盘边长、是否手机短名模式 |
| `cellCenter(id)` | 格子中心（本地坐标） |
| `cellTokenCenter(id)` | 格子正文区中心（棋子站位基准，逐格移动用它） |
| `cellRect(id)` / `cellGeom(id)` | 格子矩形 / 完整几何（`side`、`corner`、`strip` 颜色条、`body`、`buildingAnchor`、`buildingSize`） |
| `cellContainer(id)` | 格子容器（可往里加子节点；注意它的子节点用的是棋盘本地坐标） |
| `cellFlashLayer(id)` | 每格一个专供特效画闪光的 `Graphics`（位于卡面之上、高亮层之下） |
| `buildingSprite(id)` | 当前建筑精灵（无则 `null`），`anchor=(0.5,0.84)`，位置 = `buildingAnchor` |
| `createBuildingSprite(id, level)` | 新建（未加入舞台的）某等级建筑精灵，用于做“新旧交替”动画 |
| `tokenSprite(pid)` | 棋子根容器（`position` = 棋子中心；`scale` 由布局控制） |
| `tokenView(pid)` | `{ root, body, ring, avatar, label, shadow }`：弹跳 / 压扁请作用在 `body`（以中心为原点） |
| `tokenRestPosition(pid)` | 按同格人数 / 监管计算出的静止位置 `{x,y,scale}` |
| `tokenCellOf(pid)` | 画面模型里棋子所在格 |
| `player(pid)` / `playerColor(pid)` | 玩家快照 / 主色（0xRRGGBB） |
| `ownerOf(cellId)` / `levelOf(cellId)` | 画面模型里的所有者 / 等级 |
| `boardCenter()` | 棋盘中心（本地坐标） |
| `worldToScreen(p)` / `screenToWorld(p)` | 本地坐标 ↔ 视口 CSS 像素 |
| `hudPoint(pid)` | 玩家条上该玩家头像的视口坐标（金币飞向 HUD 用；没有 HUD 时退回棋子） |
| `screenRect()` | 棋盘在屏幕上的 `{x,y,size}` |

操作（会立即重绘对应格子 / 棋子）：

| API | 说明 |
|---|---|
| `setOwner(cellId, pid \| null)` | 改所有者（染色 + 描边 + 头像章 + 费用） |
| `setLevel(cellId, level)` | 改建筑等级（替换贴图，新精灵可再用 `buildingSprite` 取到） |
| `setMortgaged(cellId, on)` | 抵押灰化 |
| `addRoadblock(cellId)` / `removeRoadblock(cellId)` | 路障图标 |
| `setTokenCell(pid, cellId, jailed?)` | 改棋子所在格（同格其他人自动让位）；之后 `placeToken(pid)` 让它走到静止位 |
| `placeToken(pid, animate)` / `arrangeAll(animate)` | 棋子归位 |
| `setJailed(pid, on)` / `setCurrent(pid)` / `setBankrupt(pid)` | 监管栏杆 / 当前回合放大置顶 / 隐藏出局者 |
| `setPot(n)` / `setInfo(text)` / `setDice(a, b, extra)` | 中央奖池 / 轮次信息 / 骰子读数 |
| `highlightCells(ids \| null)` / `highlightTokens(ids \| null)` | 目标选择高亮（游戏场景使用） |
| `refreshCell(id)` | 按模型重绘某格 |

## Fx 接口（`index.ts`）

DESIGN 5.3 + 9.5，另加：`dice(a, b, skin, opts?: {rocket, turtle, doubles})`（b=0 表示乌龟）、
`move(pid, path, opts?: {teleport, backward})`、`banner(text, kind, holdMs, sub)`、`notice(text, color)`、
`resume()`（事件队列在每批事件播完后调用，结束快进状态）、`setSpeed(k)`、只读 `skipping`。
