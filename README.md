# 卷王自走棋

AI 圈主题的单机自走棋小游戏（联机为辅：异步对战 + 好友榜）。规则见 `docs/DESIGN.md`，引擎/接口说明见 `docs/ENGINE_NOTES.md`。

## 快速开始
```bash
npm install
npm run dev          # 开发：http://localhost:5173（API 代理到 :3000）
npm run build && npm start   # 生产：http://localhost:3000
npm test             # vitest
npm run typecheck
npm run validate-data        # 校验 shared/data/*.json
```
Docker：`docker build -t juanwang . && docker run -p 3000:3000 -v juanwang-data:/app/server/data juanwang`

## 目录
- `shared/` 纯 TS 引擎（商店、战斗、机器人、结算、引导、数据校验），前后端共用；`shared/data/*.json` 内容数据
- `server/` Node HTTP JSON API（快照匹配、排行榜、每日种子）+ 托管 `client/dist`
- `client/` Vite + TS 前端（素材来自仓库根 `assets/`，URL 形如 `/characters/x.png`）
- `assets/` 美术素材，`docs/` 设计文档

Node 22，TypeScript 5，ESM。
