# 卷王自走棋

> AI 圈主题的单机自走棋小游戏，联机为辅（异步对战 + 好友榜）。
> 参赛作品：**1024 切磋大会 · 游戏赛道**，口号「让人想再玩一局」。

用 10 点算力在商店里买 AI 圈的单位（模型娘、大佬、小兵），排成 5 人小队，点「开战」看它们自动互撞。
赢了拿热搜，输了掉信心；回合之间不断有 AI 圈的时事头条砸下来改规则。拿满 10 个热搜就登顶，
信心归零就出局，然后你大概会想再来一局。

规则细节见 [`docs/DESIGN.md`](docs/DESIGN.md)，引擎和接口说明见 [`docs/ENGINE_NOTES.md`](docs/ENGINE_NOTES.md)，美术规范见 [`docs/ART.md`](docs/ART.md)。

## 30 秒学会怎么玩

1. **买**：点一下商店里的卡片，再点卡片下面的「购买」（3 算力），单位会进到队伍的空位，或者叠到同名单位上。也可以直接把卡片拖到队伍里。
2. **排**：队伍从左到右是前排到后排，最左边的先上场。拖动卡片可以换位置。
3. **合**：凑满 3 个同名单位进化成 Lv2（6 个是 Lv3），属性变高，商店还会送一个高一阶的免费单位（「进化奖励」）。
4. **打**：点「开战」。双方前排冲到中间的擂台线互撞，同时扣血，倒下的换下一个，直到一方全灭。
5. **赢**：赢一场 +1 热搜，输一场 -1 信心（第 12 回合起 -2）。10 个热搜登顶，信心归零出局。

另外还能用基建（道具）强化单位，用「冻结」把喜欢的商店格留到下回合，把用不上的单位卖掉回收算力。
第一次打开会自动进入新手引导局，跟着提示走一遍就会了。

## 亮点

- **时事头条**：偶数回合会弹出一张 AI 圈「头条」，二选一，效果可能是加算力、降价、全队加攻，也可能是拿信心换资源；奇数回合结束后还有概率触发「突发」。商店顶部会提前预告「下回合：头条二选一」或「下回合解锁 T3 单位」。
- **阵营羁绊**：开源、闭源、算力、民间四个阵营，同阵营凑满 3 个就触发羁绊（全队加属性、前排护盾、全队加攻、召唤水军）。
- **异步对战**：每回合把你的队伍快照传到服务器，再从同回合、热搜相近的真实玩家快照里挑一个当对手；没有网络时自动改用内置机器人，不影响游玩。
- **每日挑战**：所有人用同一个按日期生成的种子开局，比谁打得远。
- **好友房**：和朋友输入同一个房间码，匹配和排行榜都优先看同房间的人。结局页的分享链接带种子，朋友点开就能打同一局。

## 技术架构

```
浏览器（client/ + shared/）                      服务器（server/）
┌─────────────────────────────────┐           ┌───────────────────────────────┐
│ 场景 / UI：DOM + CSS + GSAP      │           │ Node HTTP JSON API             │
│ 粒子：canvas；音效：WebAudio     │  快照/结局 │  - 存队伍快照，按回合匹配对手   │
│                                 │ ────────▶ │  - 排行榜（全服 / 今日 / 好友房）│
│ 引擎 shared/：纯 TS，确定性       │ ◀──────── │  - 每日种子                     │
│ 商店、战斗、机器人、结算、引导    │  对手快照  │  - 托管 client/dist            │
└─────────────────────────────────┘           │ 数据：内存 + server/data/*.json  │
                                              └───────────────────────────────┘
```

- **整局逻辑在浏览器里跑**：`shared/` 是纯 TypeScript 引擎（种子随机数 mulberry32，全部纯函数、可重放），前端直接 import。断网也能从头玩到尾，对手由机器人按同一套引擎模拟购物生成。
- **服务端只存快照**：队伍快照、结局成绩、每日种子，定时原子落盘到 `server/data/store.json`。任何请求失败，客户端都静默降级为离线模式，顶部显示「离线模式」小字。
- 前端用 Vite + TypeScript，不用游戏引擎；战斗区就是绝对定位的卡片 DOM 加 GSAP 位移、挤压动画。
- 测试：vitest 覆盖引擎规则、战斗、机器人、数据校验和服务端 API。

## 本地运行

需要 Node 22.12 及以上。

```bash
npm install
npm run dev                  # 开发：打开 http://localhost:5173（/api 代理到 :3000）
npm run build && npm start   # 生产：单进程 http://localhost:3000（托管前端 + API）
npm test                     # vitest
npm run typecheck            # 类型检查
npm run validate-data        # 校验 shared/data/*.json，并跑开局 / 引导 / 机器人冒烟
```

地址参数：`?seed=xxx` 用指定种子开一局（分享链接就是这个），`?notut` 跳过首次引导，`?debug` 打开调试钩子 `window.__jw`（只有带这个参数才会挂载）。

服务端环境变量：`PORT`（默认 3000）、`STORE_FILE`（默认 `server/data/store.json`）、`DIST_DIR`、`DATA_DIR`、`TRUST_PROXY=1`（在反向代理或隧道后面时按 `X-Forwarded-For` 限流）。

Docker：

```bash
docker build -t juanwang .
docker run -p 3000:3000 -v juanwang-data:/app/server/data juanwang
```

## 公网分享（Cloudflare 免费隧道）

`scripts/public.sh` 会在本机后台常驻启动游戏服务，并用 Cloudflare 的免费快速隧道生成一个 `https://xxxx.trycloudflare.com` 公网地址，手机和电脑都能直接打开。

```bash
npm run build                # 先构建，脚本会检查 server/dist/index.js 是否存在
scripts/public.sh start      # 启动服务 + 隧道，最后打印公网地址
scripts/public.sh status     # 查看服务和隧道是否在运行
scripts/public.sh url        # 再看一次公网地址
scripts/public.sh restart    # 重启（隧道地址会变）
scripts/public.sh stop       # 全部停止
```

- 需要先下载 `cloudflared`，默认路径 `~/bin/cloudflared`，也可以用 `CLOUDFLARED=/path/to/cloudflared` 指定。
- 端口用 `PORT` 指定（默认 3000），服务以 `TRUST_PROXY=1` 启动。
- 日志和地址写在 `~/juanwang-run/`（`server.log`、`tunnel.log`、`public_url.txt`）。
- 快速隧道每次启动地址都会变，适合比赛演示，不适合长期部署。

## 替换美术素材

素材都在仓库根目录的 `assets/`（Vite 的 publicDir，URL 形如 `/characters/x.png`）。

- 单位头像按 **同名 PNG 优先、SVG 回退** 加载：`assets/characters/<id>.png` 或 `assets/units/<id>.png` 存在就用 PNG，否则用 `assets/units/<id>.svg` 占位。换图不用改数据，把新 PNG 按单位 id 命名放进去即可。
- 用 ChatGPT 生成新图的提示词、风格锁定段落和放置路径表见 [`docs/PROMPTS_GPT.md`](docs/PROMPTS_GPT.md)；配色、描边、尺寸等规范见 [`docs/ART.md`](docs/ART.md)。
- 素材文件列表在构建时生成，放入新图后要重新 `npm run build`（开发模式下重启 `npm run dev`）。

## 目录结构

```
juanwang/
├── shared/            纯 TS 引擎，前后端共用
│   ├── src/engine/    商店、战斗、机器人、结算、难度参数
│   ├── src/           类型、数据校验、新手引导、随机数
│   ├── data/          内容数据：units / items / headlines / surprises / tutorial .json
│   └── test/          引擎测试
├── client/            Vite + TS 前端
│   └── src/           scenes/（首页、对局、战斗、结局）、ui/（卡片、商店、引导、头条…）、fx/（动效、粒子、音效）
├── server/            Node HTTP API + 静态托管；运行数据写到 server/data/（已 gitignore）
├── assets/            美术素材（单位、道具、UI 图标、背景、字体）
├── docs/              设计规范、引擎说明、美术规范、时事调研、生图提示词
├── scripts/           public.sh（公网隧道）、validate-data.ts、sim-difficulty.ts（难度模拟）
├── legacy/            早期大富翁原型的遗留素材，不参与构建
└── Dockerfile
```

## 免责声明

- 本项目是参赛用的非商业作品，不收费、不接广告、不做任何商业用途。
- 游戏里的 AI 公司、模型和业内人物都是**善意的戏仿**：一律使用外号或拟人化形象，不用真实姓名，不涉及私德，技能和台词只取公开的圈内梗。
- 不使用任何公司的商标或官方标志，所有图标和形象都是为本游戏另行绘制的卡通图。时事头条是对公开新闻的玩笑式改编，不代表真实事件的细节，也不代表任何立场。
- 如有不妥，请联系作者修改或删除。
