// 服务端入口：读取单位 id → 加载存储 → 启动 HTTP → 每 10 秒落盘。
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app';
import { Store } from './store';

// src/index.ts 与 dist/index.js 都在 server/ 下一级
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const STORE_FILE = process.env.STORE_FILE ?? join(ROOT, 'server/data/store.json');
const DIST_DIR = process.env.DIST_DIR ?? join(ROOT, 'client/dist');
const DATA_DIR = process.env.DATA_DIR ?? join(ROOT, 'shared/data');
const SAVE_MS = 10_000;

/** 合法单位 id：优先 shared/data/units.json，缺失时用测试 fixtures（并警告） */
export function loadUnitIds(): Set<string> {
  const candidates = [join(DATA_DIR, 'units.json'), join(ROOT, 'shared/test/fixtures/units.json')];
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    try {
      const raw = JSON.parse(readFileSync(f, 'utf8')) as unknown;
      const arr = Array.isArray(raw) ? raw : Object.values(raw as object).find(Array.isArray) ?? [];
      const ids = new Set((arr as { id?: unknown }[]).map((u) => u?.id).filter((x): x is string => typeof x === 'string'));
      if (ids.size) {
        if (f !== candidates[0]) console.warn(`[server] 未找到 ${candidates[0]}，暂用测试数据的单位 id`);
        return ids;
      }
    } catch (e) {
      console.warn(`[server] 读取 ${f} 失败：${(e as Error).message}`);
    }
  }
  console.warn('[server] 没有任何单位数据，快照校验将拒绝所有队伍');
  return new Set();
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const store = new Store();
store.loadFile(STORE_FILE);
const app = createApp({
  validIds: loadUnitIds(),
  store,
  distDir: existsSync(DIST_DIR) ? DIST_DIR : undefined,
  trustProxy: process.env.TRUST_PROXY === '1',
});
const server = createServer((req, res) => void app.handle(req, res));

const timer = setInterval(() => {
  try {
    store.saveFile(STORE_FILE);
  } catch (e) {
    console.error('[store] 落盘失败', e);
  }
}, SAVE_MS);
timer.unref();

function shutdown(): void {
  try {
    store.saveFile(STORE_FILE);
  } catch (e) {
    console.error('[store] 落盘失败', e);
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

server.listen(PORT, () => {
  console.log(`卷王自走棋服务已启动（快照 ${store.snapshotCount()} 条，成绩 ${store.results.size} 条）`);
  console.log(`  本机:   http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  局域网: http://${ip}:${PORT}`);
  if (!existsSync(DIST_DIR)) console.log(`  （未找到 ${DIST_DIR}，只提供 API；先 npm run build）`);
});
