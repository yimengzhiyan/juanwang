// 《大玩家》服务端入口：托管 client/dist 静态文件 + /ws WebSocket，打印局域网地址与二维码。
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import qrcode from 'qrcode-terminal';
import { loadGameData } from '@dafuweng/shared/data';
import type { GameData, ItemId } from '@dafuweng/shared';
import { GameServer } from './ws.js';

const here = fileURLToPath(new URL('.', import.meta.url)); // server/src 或 server/dist
const CLIENT_DIST = resolve(process.env.CLIENT_DIST ?? join(here, '../../client/dist'));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function loadData(): GameData {
  try {
    return loadGameData(process.env.DATA_DIR);
  } catch (e) {
    console.error('[数据] 加载 shared/data 失败：', (e as Error).message);
    const fixture = join(here, '../test/fixtures');
    if (existsSync(join(fixture, 'board.json'))) {
      console.warn('[数据] 使用测试用最小数据 server/test/fixtures 启动（仅供开发）');
      return loadGameData(fixture);
    }
    throw e;
  }
}

function serveStatic(req: IncomingMessage, res: ServerResponse): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
    return;
  }
  if (!existsSync(join(CLIENT_DIST, 'index.html'))) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('前端尚未构建：请先运行 npm run build（开发时请访问 Vite 端口 5173）');
    return;
  }
  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  let file = normalize(join(CLIENT_DIST, rel));
  if (file !== CLIENT_DIST && !file.startsWith(CLIENT_DIST + sep)) {
    res.writeHead(403).end();
    return;
  }
  let isFallback = false;
  if (!existsSync(file) || statSync(file).isDirectory()) {
    const idx = join(file, 'index.html');
    if (existsSync(idx)) file = idx;
    else if (extname(rel)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found');
      return;
    } else {
      file = join(CLIENT_DIST, 'index.html'); // SPA 回退
      isFallback = true;
    }
  }
  const ext = extname(file).toLowerCase();
  const immutable = !isFallback && rel.startsWith('/assets/') && /-[A-Za-z0-9_-]{8,}\./.test(rel);
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'content-length': statSync(file).size,
    'cache-control': ext === '.html' ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}

/** 本机局域网 IPv4 地址（优先 192.168 / 10 / 172 段） */
export function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal) out.push(a.address);
    }
  }
  const score = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : ip.startsWith('172.') ? 2 : 3);
  return out.sort((a, b) => score(a) - score(b));
}

/** 手机连不上时的防火墙提示（按当前系统） */
function firewallTip(port: number): string {
  const tip =
    process.platform === 'win32'
      ? `Windows：首次运行弹出防火墙提示时勾选"专用网络"并允许；或用管理员 PowerShell 执行\n    New-NetFirewallRule -DisplayName dafuweng -Direction Inbound -Protocol TCP -LocalPort ${port} -Action Allow`
      : process.platform === 'darwin'
        ? 'macOS：系统设置 → 网络 → 防火墙 → 选项，允许 node 接受传入连接（或暂时关闭防火墙）'
        : `Linux：sudo ufw allow ${port}/tcp（firewalld：sudo firewall-cmd --add-port=${port}/tcp）`;
  return `  手机打不开？① 确认手机和电脑在同一 Wi-Fi（访客网络 / AP 隔离会挡住，可改用手机热点）\n  ② 放行 ${port} 端口 —— ${tip}\n`;
}

function main(): void {
  const data = loadData();
  const server = createServer(serveStatic);
  // 仅测试用：DEBUG_ITEMS=1 时真人开局 / 每回合开始自动补齐全部道具（生产请勿开启）
  const debugItems = process.env.DEBUG_ITEMS === '1' ? (data.items.map((i) => i.id) as ItemId[]) : undefined;
  if (debugItems) console.warn('[调试] DEBUG_ITEMS=1：真人玩家每回合自动补齐道具，仅供测试！');
  // 仅测试用：DEBUG_FAST_BOTS=1 时机器人不等动画、立即行动（端到端脚本提速）
  const fastBots = process.env.DEBUG_FAST_BOTS === '1';
  if (fastBots) console.warn('[调试] DEBUG_FAST_BOTS=1：机器人立即行动，仅供测试！');
  const game = new GameServer(server, data, {
    roomDeps: {
      ...(debugItems ? { debugItems } : {}),
      ...(fastBots ? { botDelay: [0, 0] as [number, number], waitAnimations: false } : {}),
    },
  });

  server.listen(PORT, HOST, () => {
    const devPort = process.env.CLIENT_DEV_PORT; // 开发模式：手机应访问 Vite 端口
    const port = devPort ? Number(devPort) : PORT;
    const publicUrl = process.env.PUBLIC_URL?.replace(/\/+$/, ''); // 公网 / 容器部署时指定对外地址
    const ips = lanAddresses();
    const url = publicUrl || `http://${ips[0] ?? 'localhost'}:${port}`;
    console.log('');
    console.log('  《大玩家》服务器已启动');
    if (publicUrl) console.log(`  对外地址：  ${publicUrl}`);
    console.log(`  本机访问：  http://localhost:${port}`);
    if (!publicUrl) for (const ip of ips) console.log(`  局域网访问：http://${ip}:${port}`);
    if (!publicUrl && existsSync('/.dockerenv')) console.log('  （运行在容器中：上面是容器内地址，请用宿主机 IP + 映射端口访问，或设置 PUBLIC_URL）');
    if (devPort) console.log(`  （开发模式：后端 WebSocket 监听 ${PORT}，前端由 Vite ${devPort} 提供）`);
    console.log('');
    console.log(publicUrl ? '  扫码加入：' : '  手机扫码加入（需与电脑在同一 Wi-Fi）：');
    qrcode.generate(url, { small: true }, (q) => {
      console.log(q.replace(/^/gm, '  '));
      if (!publicUrl) console.log(firewallTip(port));
    });
  });

  const shutdown = () => {
    console.log('\n正在关闭服务器…');
    game.close();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
