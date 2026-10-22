# 《大玩家》美术与 UI 规范（ART.md）

> 基准：`docs/DESIGN.md` 第 6 节。本文件定义颜色、字体、组件、棋盘格、建筑、特效分镜与布局。
> 关键词：**高清动漫 · 明亮赛博 · 深蓝紫底 + 霓虹青/品红 · 玻璃拟态 · 圆润可爱**。
> 占位素材全部在 `client/public/assets/`（清单见 `manifest.json`），AI 生图提示词见 `docs/PROMPTS.md`。

---

## 1. 配色 Token

全部以 CSS 变量提供，HTML 覆盖层直接使用；Pixi 端用同一组十六进制值（建议在 `client/src/theme.ts` 里导出同名常量）。

```css
:root {
  /* —— 背景层级（由深到浅） —— */
  --bg-0: #0B0820;          /* 页面最底色，深夜蓝紫 */
  --bg-1: #140F35;          /* 棋盘外圈 / 大背景渐变终点 */
  --bg-2: #1E1650;          /* 棋盘中心 / 卡片实底 */
  --bg-3: #2A1F6E;          /* 高亮底、hover */
  --bg-gradient: radial-gradient(120% 90% at 50% 40%, #2A1F6E 0%, #160F40 55%, #0B0820 100%);

  /* —— 玻璃面板 —— */
  --panel: rgba(34, 26, 92, 0.55);
  --panel-strong: rgba(26, 20, 72, 0.82);   /* 手机抽屉、弹窗 */
  --panel-border: rgba(160, 200, 255, 0.22);
  --panel-highlight: rgba(255, 255, 255, 0.10);
  --blur: 14px;

  /* —— 主色 / 强调色 —— */
  --primary: #22E5FF;       /* 霓虹青：主按钮、当前回合、选中 */
  --primary-deep: #0EA5C6;
  --accent: #FF3DCB;        /* 霓虹品红：强调、稀有、旗舰 */
  --accent-deep: #C21E9A;
  --violet: #8B5CF6;        /* 辅助紫：分隔、次级发光 */
  --gold: #FFC83D;          /* Token 货币、奖池、胜利 */
  --gold-light: #FFE27A;
  --neon-gradient: linear-gradient(90deg, #22E5FF 0%, #B36BFF 50%, #FF3DCB 100%);

  /* —— 8 个颜色组（与 shared/data/board.json groups[].color 保持一致） —— */
  --g-brown:     #C98A5A;
  --g-lightblue: #5FD4FF;
  --g-pink:      #FF7AC6;
  --g-orange:    #FFA94D;
  --g-red:       #FF5470;
  --g-yellow:    #FFD93D;
  --g-green:     #3DDC97;
  --g-darkblue:  #5B6CFF;

  /* —— 状态 —— */
  --success: #2EE59D;       /* 收钱、买入成功、出狱 */
  --danger:  #FF4D6D;       /* 扣钱、破产、监管 */
  --warning: #FFB547;       /* 超时倒计时、路障 */
  --info:    #5EC8FF;

  /* —— 文字 —— */
  --text: #F2F0FF;          /* 主文字（深底） */
  --text-dim: #A9A3D9;      /* 次文字 */
  --text-mute: #6E68A3;     /* 禁用、占位 */
  --text-on-light: #1A1240; /* 浅色底（金色/青色按钮）上的文字 */

  /* —— 描边与阴影 —— */
  --outline: #1A1240;       /* 所有卡通描边统一这个深紫 */
  --shadow-1: 0 4px 16px rgba(5, 2, 20, 0.45);
  --shadow-glow-primary: 0 0 18px rgba(34, 229, 255, 0.55);
  --shadow-glow-accent:  0 0 18px rgba(255, 61, 203, 0.55);

  /* —— 圆角 / 间距 —— */
  --r-sm: 10px; --r-md: 16px; --r-lg: 24px; --r-pill: 999px;
  --gap: 12px;
}
```

**角色主色（SVG 头像背景所用颜色；建议 characters.json 的 `color` 采用此表——当前数据中 altman/gpt_chan、liang/deepseek_chan、dario/claude_chan 三对颜色过近，musk 接近白色，同局难以区分）**

| id | 主色 | id | 主色 |
|---|---|---|---|
| huang | `#76B900` | deepseek_chan | `#4D6BFE` |
| altman | `#F2C14E` | claude_chan | `#D97757` |
| liang | `#6366F1` | gpt_chan | `#10A37F` |
| musk | `#E5484D` | gemini_chan | `#7B61FF` |
| zuck | `#1877F2` | qwen_chan | `#A855F7` |
| dario | `#C96442` | doubao_chan | `#22D3EE` |
| ilya | `#EC4899` | lecun | `#14B8A6` |

> 若同局出现主色过近（如 zuck / deepseek_chan），棋子外圈额外加白色序号角标 1~6，不靠颜色单独区分。

---

## 2. 字体

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&display=swap" rel="stylesheet">
```

```css
:root {
  --font-cn: "PingFang SC", "HarmonyOS Sans SC", "MiSans", "HONOR Sans CN",
             "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans SC", "Source Han Sans SC", sans-serif;
  --font-num: "Fredoka", "Baloo 2", "Nunito", var(--font-cn);   /* 英文、数字、Token 金额 */
}
body { font-family: var(--font-num); }      /* Fredoka 无中文字形，中文自动落到 --font-cn */
.money, .price, .dice-num { font-family: var(--font-num); font-variant-numeric: tabular-nums; font-weight: 700; }
```

- 局域网离线场景 Google Fonts 拉不到时会自动回退到系统圆润字体，不影响可用性；有条件可把 Fredoka woff2 放到 `client/public/fonts/` 本地托管。
- 字号：手机正文 15px，按钮 18px，金额 20px，标题 24px；桌面 ×1.1。字重：中文标题 800，正文 500。
- 标题/大字效：白色填充 + `--neon-gradient` 描边（`-webkit-text-stroke` 或 `text-shadow` 多层发光）。

---

## 3. 组件样式

### 3.1 玻璃拟态卡片

```css
.glass {
  background: linear-gradient(160deg, rgba(255,255,255,0.10) 0%, rgba(255,255,255,0.02) 40%), var(--panel);
  border: 1px solid var(--panel-border);
  border-radius: var(--r-lg);
  box-shadow: var(--shadow-1), inset 0 1px 0 var(--panel-highlight);
  backdrop-filter: blur(var(--blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--blur)) saturate(140%);
  color: var(--text);
}
.glass--active {               /* 当前回合玩家条、选中卡片 */
  border-color: var(--primary);
  box-shadow: var(--shadow-1), var(--shadow-glow-primary), inset 0 1px 0 var(--panel-highlight);
}
.glass--neon {                 /* 弹窗、结算：渐变霓虹边框 */
  border: 2px solid transparent;
  background:
    linear-gradient(var(--panel-strong), var(--panel-strong)) padding-box,
    var(--neon-gradient) border-box;
}
@supports not (backdrop-filter: blur(1px)) { .glass { background: var(--panel-strong); } }
```

### 3.2 按钮（手机 ≥56px 高，单击完成，无长按/双击）

```css
.btn {
  min-height: 56px; padding: 0 24px; border: 0; border-radius: var(--r-pill);
  font: 700 18px/1 var(--font-num); letter-spacing: .5px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  cursor: pointer; user-select: none; -webkit-tap-highlight-color: transparent;
  transition: transform .08s ease, box-shadow .2s ease, filter .2s ease;
}
.btn:active { transform: translateY(2px) scale(.98); }
.btn:disabled { filter: grayscale(.8) brightness(.7); cursor: not-allowed; box-shadow: none; }

.btn--primary {            /* 掷骰子、购买、升级 */
  color: var(--text-on-light);
  background: linear-gradient(180deg, #7DF9FF 0%, #22E5FF 45%, #0EA5C6 100%);
  box-shadow: 0 4px 0 #0A6F87, 0 0 22px rgba(34,229,255,.55), inset 0 2px 0 rgba(255,255,255,.6);
}
.btn--secondary {          /* 不买、跳过、取消 */
  color: var(--text);
  background: rgba(255,255,255,.08);
  border: 1.5px solid var(--panel-border);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.15);
}
.btn--danger {             /* 付罚款、抵押、破产确认 */
  color: #fff;
  background: linear-gradient(180deg, #FF8AA0 0%, #FF4D6D 50%, #C81E45 100%);
  box-shadow: 0 4px 0 #8A1230, 0 0 18px rgba(255,77,109,.5), inset 0 2px 0 rgba(255,255,255,.45);
}
.btn--gold {               /* 掷骰子主按钮的高光变体（可选） */
  color: var(--text-on-light);
  background: linear-gradient(180deg, #FFF4C2 0%, #FFC83D 55%, #E89B00 100%);
  box-shadow: 0 4px 0 #9A6400, 0 0 22px rgba(255,200,61,.55), inset 0 2px 0 rgba(255,255,255,.7);
}
.btn--roll { min-height: 72px; font-size: 22px; animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 4px 0 #0A6F87, 0 0 36px rgba(34,229,255,.85), inset 0 2px 0 rgba(255,255,255,.6); } }
```

- 行动按钮区一次最多 2 个主操作（如「购买 260T」「不买」），主操作在右（拇指位）。
- 回合倒计时以按钮底部进度条呈现（`--warning`，最后 5 秒变 `--danger` 并轻微抖动）。

---

## 4. 棋盘格子视觉规范

### 4.1 尺寸比例
- 单位 `u` = 普通格短边。每条边 = 角格 1.5u + 9 个普通格 1u + 角格 1.5u = **12u**。
- 普通格：上下两边 `1u 宽 × 1.5u 深`；左右两边 `1.5u 宽 × 1u 高`（**文字始终正向，不旋转**，手机上可读性优先）。
- 角格：`1.5u × 1.5u`，只放大图标（`cells/start.svg` 等）+ 名称。
- 格间距 `0.06u`，格子圆角 `0.12u`；2.5D 厚度：每格底部多画一条 `0.08u` 的深色边（`--bg-0` 混 40% 组色）+ 软阴影，形成"地块卡"立起来的感觉。
- 参考像素：桌面棋盘 840px → u=70px；手机 390px 宽 → u≈31px。

### 4.2 地块卡分区（以底边普通格为例，从内圈到外圈）
```
┌────────────┐  ← 朝棋盘中心
│▓▓颜色条▓▓▓│  0.30u 高，组色实填 + 顶部 1px 白色高光；被抵押时变灰并加斜纹
│   [建筑]   │  建筑贴图锚点：颜色条下缘中心，宽 0.9u，向上溢出颜色条（2.5D 立起）
│   名 字    │  ≤6 字，桌面 12px/700；手机只显示前 3 字或图标
│   260T     │  价格 Fredoka 11px，--gold；已有主人时改显示当前过路费 --text-dim
└────────────┘  ← 朝棋盘外
```
- 左/右/上三边同理：颜色条始终在"朝中心"一侧（左边格的颜色条在右侧竖条，宽 0.30u）。
- 非地产格：无颜色条，中央放 `cells/<type>.svg` 图标（0.7u）+ 名称；算力中心用 `compute.svg`，公用用 `utility_power.svg` / `utility_data.svg`。
- **所有权**：卡片底色 = `--bg-2` 叠 18% 主人主色，卡片描边 2px 主人主色 + 外发光；右下角 0.22u 主人头像小圆章。
- 路障：格子上方悬浮 `items/roadblock.svg`（0.6u）并缓慢上下浮动 ±2px。
- 可选目标（导弹/路障/跳板机选格）：可选格边框 `--primary` 呼吸闪烁，不可选格降亮 50%。

### 4.3 棋子
- 棋子 = 角色头像圆形裁切，直径 `0.42u`（多人同格时 `0.34u`），白色 3px 描边 + 主色 4px 外环 + 底部椭圆投影。
- 当前回合棋子放大 1.15 倍、置顶、外环流光旋转。
- **同格多人偏移表**（单位：格短边 `u` 的比例，以格中心为原点，y 向下为正；按玩家座次依次取位）：

| 同格人数 | 偏移 (x, y) |
|---|---|
| 1 | (0, 0) |
| 2 | (-0.20, 0) · (0.20, 0) |
| 3 | (0, -0.16) · (-0.22, 0.12) · (0.22, 0.12) |
| 4 | (-0.20, -0.14) · (0.20, -0.14) · (-0.20, 0.16) · (0.20, 0.16) |
| 5 | (-0.24, -0.16) · (0.24, -0.16) · (0, 0) · (-0.24, 0.18) · (0.24, 0.18) |
| 6 | (-0.26, -0.14) · (0, -0.14) · (0.26, -0.14) · (-0.26, 0.16) · (0, 0.16) · (0.26, 0.16) |

- 左右两边格（横长）把 x/y 对调后使用。角格整体放大 1.4 倍。
- 监管审查中（jail 格内）的玩家站在格子"内框"右上 1/2 区域并加栏杆遮罩；"路过参观"站外框。

---

## 5. 建筑 6 个等级（level 0~5，贴图 `buildings/`）

| level | 文件 | 名称 | 视觉 | 发光强度 |
|---|---|---|---|---|
| 0 | `empty.svg` | 空地 | 等距地块 + 虚线施工框 + "空地"霓虹小立牌 + 小嫩芽 | 立牌青色描边微光 |
| 1 | `lv1.svg` | v1 | 单个 Q 版服务器机柜，正面小屏幕上有 `• ‿ •` 笑脸，LED 青/绿/品红，顶部风扇 | 地块青色光晕 |
| 2 | `lv2.svg` | v2 | 两台机柜一高一低并排，后面那台 LED 偏品红 | 光晕扩大 |
| 3 | `lv3.svg` | v3 | 小型数据中心楼（门 + 彩色窗格）+ 屋顶小机柜 + 天线（顶端品红信号灯与信号波纹）+ 卫星锅 | 窗户暖黄/青色亮灯 |
| 4 | `lv4.svg` | v4 | 高楼，满墙亮窗，三条竖边霓虹灯管（青/品红），正面 "v4" 霓虹招牌，楼顶信标 | 地块描边改品红，整体最亮的非旗舰 |
| 5 | `lv5.svg` | 旗舰 AGI | 三段收分的紫金发光塔 + 金色尖顶 + 顶部星芒，环绕彩虹光环（青→金→品红），正面金色 "AGI" 牌，背后竖直光柱与金色光晕 | 全身自发光，光环缓慢旋转、光柱呼吸 |

- 递进原则：**高度 ×1.2/级、亮度递增、色温从冷（青）到暖（金）**；旗舰是唯一出现金色主调的建筑。
- 摆放：贴图底部中心对齐颜色条下缘中心；宽度 0.9u（旗舰 1.05u，允许溢出格子）。
- 运行时动效：v1~v4 LED 随机闪烁（每 0.6~1.4s）；v5 光环 `rotation` 8s 一圈 + 尖顶星芒缩放 0.9↔1.1。
- 主人颜色不进贴图（贴图中性），由格子底色/描边体现，便于复用。

---

## 6. 特效分镜（对应 DESIGN 5.3 `Fx` 接口）

通用约定：
- 缓动默认 `power2.out`；弹性落地 `back.out(1.8)`；数字滚动 `none`。
- 屏幕震动 `shake(ms, strength)`：strength 单位 px，衰减为线性；手机端 strength ×0.7。
- 粒子统一用 3 种贴图：`spark`（四角星）、`dot`（软圆点）、`chip`（小方块像素），代码生成纹理即可。
- 所有特效接受 `skipAll()`：立即跳到末帧（数值落定、贴图到位），不播放粒子。
- 全局时长预算：单回合普通动画总和 ≤ 4s，保证节奏。

| # | 接口 | 时长 | 分镜关键帧 | 粒子 / 光效 | 震动 | 主色 |
|---|---|---|---|---|---|---|
| 1 | `dice(a,b,skin)` | 1.1s | 0.00 两颗骰子从屏幕下方抛入（带旋转与拖影）→ 0.15–0.75 在棋盘中央 3D 翻滚弹跳 2 次（每次落地压扁 10%）→ 0.80 落定，点数面朝上，骰子放大 1.25 回弹 → 0.85 头顶弹出 "7" 大字（Fredoka 64px，霓虹描边）；**双骰**额外加 "DOUBLE!" 金色横幅从左扫入 | 落地时 8 颗 `dot` 尘土；落定一圈青色冲击环；双骰时 24 颗金色 `spark` 爆开；`rocket` 时数字后追加 "+6" 火焰字；`turtle` 时骰子变成乌龟壳纹并显示 "1" | 每次落地 80ms/3；落定 120ms/4 | 皮肤色 + `--primary` |
| 2 | `move(id,path)` | 0.18s/格 | 每格：起跳 0.06s（压扁→拉长 1.15）→ 抛物线最高点 0.35u → 落地 0.05s 压扁 0.85 回弹；镜头（手机）平滑跟随；最后一格落地多停 0.12s 放大 1.1 | 每格落地 4 颗 `dot` 尘土（格子组色）；经过的格子边框亮一下 0.2s；路径预览：起跳前沿路径点亮一串小光点 | 最后一格 60ms/2 | 主人色 |
| 3 | `passStart(id,amt)` | 0.8s | 经过融资轮格瞬间：格子金光闪 → 金币从格子喷出飞向玩家条 → 玩家条金额滚动 +200 | 12 枚金币（`gold` 圆 + "T"）抛物线飞行，尾迹 `spark` | 无 | `--gold` |
| 4 | `buy(cell,id)` | 1.0s | 0.0 屏幕中央出现地契卡（组色头部 + 名称 + 价格）从小到大弹出 → 0.35 卡片盖章"已收购"（主人头像章 + 墨点）→ 0.55 卡片缩小沿弧线飞向格子 → 0.8 格子从颜色条一侧向外"染色"填充主人色 + 描边亮起 | 盖章瞬间 10 颗 `chip`；染色波前一圈白色扫光；完成时格子上冒 6 颗主人色 `spark` | 盖章 100ms/3 | 组色 + 主人色 |
| 5 | `build(cell,lv)` 升级 | 1.0s（旗舰 2.0s） | 0.0 格子地面亮起青色升级圈（旋转） → 0.2 旧建筑下沉淡出，新建筑从地面"钻出"（scaleY 0→1.15→1）→ 0.6 竖直光柱从建筑射向天空并收束 → 0.8 弹出 "v3!" 标签 | 光柱 + 16 颗上升 `spark`；v4 加品红/青双色电弧；**旗舰**：先全屏暗场 30% → 金色光柱粗 2 倍 → 光环从天而降套上 → "AGI 达成！" 金字横幅 → 全屏金色 `spark` 雨 40 颗 | v1-v4 80ms/2；旗舰 300ms/6 | `--primary`；旗舰 `--gold` |
| 6 | `downgrade(cell,lv)` 降级 | 0.9s | 0.0 导弹/事件命中 → 0.1 白闪 2 帧 → 0.15 爆炸火球（橙→品红）→ 0.35 建筑碎成 3~4 块弹飞后替换为低一级贴图 → 0.5 黑烟缓慢上升 0.4s | 20 颗橙红 `chip` 碎片 + 6 团灰紫烟 `dot`（放大淡出）；格子红色裂纹贴片 1s 淡出 | 250ms/8（全场最强之一） | `--danger` + `#FF9A3C` |
| 7 | `rent(from,to,amt,shielded)` 收费 | 0.9s | 0.0 付款方头顶冒出 "-120T"（红）→ 0.1 一串 Token 金币（数量 = clamp(amt/25, 5, 20)）从付款方棋子沿弧线连射到收款方 → 0.75 收款方头顶 "+120T"（绿）+ 收款方头像短暂得意（放大 1.15） | 金币带金色尾迹；**shielded**：金币飞到一半撞上蓝色六边形护盾罩，碎成蓝色 `chip` 消散，显示"防火墙生效！" | 大额（≥300）150ms/4 | `--gold`；护盾 `--g-lightblue` |
| 8 | `money(id,delta,reason)` | 0.7s | 玩家条/棋子上方浮字 `±xxT`，上升 40px 并淡出；同时 HUD 金额数字滚动 0.5s；reason 小字跟随 | 正数绿色 + 3 颗 `spark`；负数红色 + 轻微左右抖动 | 无 | `--success` / `--danger` |
| 9 | `card(card)` 卡牌 | 入场 0.6s，停留 ≤2.5s | 0.0 背景压暗 50% + 模糊 → 卡背（热搜=品红火焰 / 突发=金色闪电）从牌堆位置飞到中央 → 0.3 Y 轴 3D 翻转（scaleX 1→0→1 替代）→ 0.6 正面：标题 + 正文 + 效果图标，卡边霓虹流光；点击或 2.5s 后卡片缩小飞向对应目标（玩家条/格子） | 翻转瞬间一圈 `spark`；卡边描边沿周长流动的渐变光 | 无 | 热搜 `--accent`；突发 `--gold` |
| 10 | `jail(id)` 监管 | 1.2s | 0.0 屏幕边缘红蓝警灯交替闪 3 次（各 0.15s）→ 0.4 "监管审查！" 横幅盖下 → 0.6 棋子被一束聚光灯锁定，沿直线"拖拽"飞到 10 号格 → 1.0 栏杆从上落下罩住棋子 | 警灯为屏幕两侧红/蓝径向光；栏杆落下 4 颗灰尘 `dot` | 栏杆落地 120ms/4 | `--danger` + `#3D5AFE` |
| 11 | `item(...)` 道具 | 0.8–1.2s | 通用：道具图标从玩家条弹出放大 1.6 → 名称气泡 → 执行：**roadblock** 路障从天落到目标格，弹 2 下，警示灯闪；**missile** 导弹从棋子抛物线飞向目标格（尾焰+像素包 `chip`），命中接 `downgrade`；**rocket** 棋子后方喷火，骰子区出现 "+6"；**turtle** 乌龟慢慢爬到目标玩家头像上，头像变绿色"限流中"角标；**shield** 蓝色六边形护盾从脚下升起包住棋子并保持半透明呼吸；**teleport** 棋子缩小卷入紫青漩涡 → 目标格出现同样漩涡吐出棋子；**jailfree** 金色卡片盖"豁免"绿章，栏杆向上弹开 | 各自主色 `spark`；teleport 漩涡由 2 层旋转椭圆环 + 吸入粒子 | missile 命中见降级；roadblock 落地 80ms/3 | 道具图标主色 |
| 12 | `bankrupt(id)` 破产 | 1.8s | 0.0 画面去饱和（除该玩家）→ 0.2 玩家头像出现裂纹 → 0.5 头像碎裂成方块像素崩落（"服务器宕机"）→ 0.8 TA 名下所有格子依次（0.05s 间隔）褪色 / 转移给债主（颜色波从债主头像扩散）→ 1.5 玩家条显示灰色 "已出局 · 404" | 30 颗像素 `chip` 下坠；债主接收时金色细线连接 | 300ms/6 | 灰 + `--danger` |
| 13 | `gameOver(winner)` 胜利 | 3.5s（可点击跳过） | 0.0 全屏暗场 → 0.3 胜者头像从下方升起放大到屏幕 40%，背后放射状光芒旋转 → 0.8 "大玩家！" 金色大字砸下 → 1.0 两侧彩带礼花持续 2s → 1.5 排名卡依次滑入（身价、建筑数） → 3.0 出现"再来一局"大按钮（`--gold`，脉冲） | 彩纸 120 片（青/品红/金/白，旋转飘落）；胜者光环同旗舰光环；金币雨 | 砸字 200ms/5 | `--gold` + 霓虹全色 |

另：`shake(ms, strength)` 作用于棋盘容器（不是 HUD），使用随机方向位移 + 衰减；同时进行多个震动时取最大值，不叠加。

---

## 7. 布局线框

### 7.1 手机竖屏（以 390×844 为基准）

```
┌──────────────────────────────┐
│ ⏱ R12/30   奖池 350T   ⚙  ☰ │  顶栏 44px（玻璃）
├──────────────────────────────┤
│ [头像]老黄 1520T│[头像]GPT娘 980T│ 玩家条：横向滚动胶囊，当前回合发青光
│ [头像]马一龙 ...│  ...          │ 高 56px
├──────────────────────────────┤
│ ┌──┬─┬─┬─┬─┬─┬─┬─┬─┬─┬──┐ │
│ │开│ │ │ │ │ │ │ │ │ │监│ │
│ ├──┘                    └──┤ │
│ ├─┤      棋盘中央区       ├─┤ │  棋盘：宽 = 屏宽 - 16px，正方形
│ ├─┤   骰子落点 / 卡牌      ├─┤ │  中央 board_bg + logo 淡化
│ ├─┤   当前事件文字         ├─┤ │
│ ├─┤                        ├─┤ │
│ ├──┐                    ┌──┤ │
│ │融│ │ │ │ │ │ │ │ │ │营│ │
│ └──┴─┴─┴─┴─┴─┴─┴─┴─┴─┴──┘ │
├──────────────────────────────┤
│  当前：轮到 你 · 买下「深度求索」？ │  提示条 40px
│ ┌────────────┐┌─────────────┐│
│ │   不买     ││  购买 260T  ││  行动按钮 56~72px，主操作在右
│ └────────────┘└─────────────┘│
├──────────────────────────────┤
│ 🎒道具 ▪▪▪  🏠基建  📜日志  💬 │  底部抽屉把手（上拉展开 70% 高）
└──────────────────────────────┘
```
- 棋盘以下所有区域为一个可上拉的抽屉；收起时只露提示条 + 按钮 + 把手。
- 选择目标（道具）时抽屉自动收起，棋盘上可选格高亮，底部按钮变为"取消"。

### 7.2 桌面横屏（以 1440×900 为基准）

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [LOGO 大玩家]          第 12 / 30 轮   奖池 350T   房间 ABCD   ⚙  🔊      │ 顶栏 56px
├───────────────┬───────────────────────────────────────┬─────────────────┤
│ 玩家列表      │                                       │ 当前格详情卡     │
│ ┌───────────┐ │   ┌──┬─┬─┬─┬─┬─┬─┬─┬─┬─┬──┐          │ （组色头 + 费用表 │
│ │●老黄 1520T│ │   │  │ │ │ │ │ │ │ │ │ │  │          │  lv0..旗舰）     │
│ │ 🛡 🐢 道具 │ │   ├──┘                └──┤          ├─────────────────┤
│ └───────────┘ │   ├─┤                    ├─┤          │ 道具栏 6 格       │
│ ┌───────────┐ │   ├─┤   棋盘 ≈ min(高-120, │          │ [▪][▪][▪][ ][ ][ ]│
│ │ GPT娘 980T│ │   ├─┤   宽-640) 正方形     ├─┤          ├─────────────────┤
│ └───────────┘ │   ├─┤   中央：骰子/卡牌     ├─┤          │ 我的基建 / 抵押   │
│   ...最多 6   │   ├──┐                ┌──┤          ├─────────────────┤
│               │   │  │ │ │ │ │ │ │ │ │ │  │          │ 日志（最近 50）   │
│ 宽 280px      │   └──┴─┴─┴─┴─┴─┴─┴─┴─┴─┴──┘          │ 聊天输入          │
│               │                                       │ 宽 340px         │
├───────────────┴──────────────┬────────────────────────┴─────────────────┤
│                              │ [ 不买 ]  [ 购买 260T ]  [ 🎲 掷骰子 ]       │ 行动栏 88px，居中
└──────────────────────────────┴──────────────────────────────────────────┘
```
- 宽 < 1100px 时左侧玩家列表并入顶部横条，变成两栏。
- 横屏手机（高 < 500px）：棋盘靠左铺满高度，右侧 1 列面板，按钮仍 ≥56px。

---

## 8. 资源加载约定（给 `assets.ts`）

- 读取 `/assets/manifest.json`，按其中路径预加载。
- `characters/<id>.png`、`buildings/lv<n>.png`、`logo.png`、`board_bg.png` 若存在优先使用（HEAD 请求 / 加载失败回退同名 `.svg`）。
- 角色 PNG 规范：1024×1024 透明底或纯色底，头部居中，脸部约占画面 45%，便于与 SVG 共用圆形裁切。
- `logo.svg` 文字依赖系统中文粗体字体渲染；有生图 Logo 时以 `logo.png` 替换。
