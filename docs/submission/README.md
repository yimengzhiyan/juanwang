# 参赛提交素材

| 文件 | 规格 | 用途 |
|---|---|---|
| `demo.mp4` | H.264，780×1688（手机竖屏 2x），30fps，1 分 56 秒，约 19 MB，无声 | 演示视频：首页 → 选赛场 → 拖拽买 2 个单位、拖装备上身 → 1x 开战（含「全网爬取」技能慢放）→ 胜利结算（MVP）→ 头条二选一 → 第 2 回合补强 → 展开羁绊面板 → 图鉴阵营页 → 2x 打第二场 → 快进到第 14 回合终局 → 吃鸡结局页 |
| `01_home.png` | 780×1688 | 首页 |
| `02_arena.png` | 780×1688 | 开局赛场三选一 |
| `03_shop.png` | 780×1688 | 终局商店：满编 5 单位、身上带装备，顶部羁绊条 |
| `03b_shop_synergy.png` | 780×1688 | （备用）同一局展开羁绊面板 |
| `04_headline.png` | 780×1688 | 第 2 回合头条二选一 |
| `05_battle_skill.png` | 780×1688 | 战斗技能慢放瞬间（数据爬虫「全网爬取」） |
| `06_result.png` | 780×1688 | 结算：胜利 + MVP 伤害总结 |
| `07_codex.png` | 780×1688 | 图鉴·阵营页（开源） |
| `08_over.png` | 780×1688 | 吃鸡结局页（流派、成就、MVP） |
| `d_shop.png` | 1280×800 | 桌面版商店（右侧大厅栏） |
| `d_battle.png` | 1280×800 | 桌面版战斗（「我没死」技能慢放） |
| `cover.png` | 1280×720 | 封面：Logo + 标语 + 手机商店截图 |

玩家名统一为「参赛者」；画面里没有调试面板。视频里的白色圆点是录制时注入的触点指示，方便看清拖拽操作，游戏本身没有它。

## 录制方式

脚本在 `scripts/`（依赖 Playwright 和 ffmpeg-static，没有装进项目依赖）：

- `demo_endgame.mjs`：在后台页面用种子 `demo159` 自动打完一局（第 3 回合起每回合 +5 算力辅助），保存吃鸡前最后一个商店阶段的真实 RunState → `endstate_demo159.json`
- `demo_record.mjs`：录视频。首页「开始一局」被换成固定种子 `demo159`（首战有技能慢放、能赢），全程用真实鼠标拖拽和点击；最后通过 `?debug` 的 `__jw.setRun` 注入终局状态。Playwright 自带的 `recordVideo` 只按 CSS 像素（390×844）录，所以这里改用 CDP `Page.startScreencast` 抓 2x 帧，再用 ffmpeg 按时间戳拼成视频
- `demo_shots.mjs`：截图（`VP=desk` 拍桌面版的两张）
- `demo_cover.mjs`：渲染封面

## 复现

```bash
# 1. 另起隔离的测试服务（不要动 3000 端口的线上服务和 server/data/store.json）
PORT=3100 STORE_FILE=/tmp/demo_store.json node server/dist/index.js &

# 2. 在装了 playwright + ffmpeg-static 的目录（如 /tmp/pw）里
cp docs/submission/scripts/* /tmp/pw/ && cd /tmp/pw
node demo_endgame.mjs ./endstate.json demo159          # 可选：直接用 endstate_demo159.json
node demo_record.mjs ./rec ./endstate_demo159.json     # 帧和 rec/frames.txt
node_modules/ffmpeg-static/ffmpeg -f concat -safe 0 -i rec/frames.txt \
  -vf "scale=780:1688:force_original_aspect_ratio=decrease,pad=780:1688:(ow-iw)/2:(oh-ih)/2:color=white,fps=30,format=yuv420p" \
  -c:v libx264 -preset slow -crf 20 -movflags +faststart -an demo.mp4
node demo_shots.mjs ./shots ./endstate_demo159.json
VP=desk node demo_shots.mjs ./shots ./endstate_demo159.json
node demo_cover.mjs ./cover.png ./shots/03_shop.png
```

这些脚本默认连 `http://localhost:3100`，用环境变量 `URL` 可以改。终局状态和当前数据版本绑定：如果之后改了单位/装备数值，要先重新跑 `demo_endgame.mjs`。
