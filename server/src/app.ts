// HTTP JSON API + 静态托管（node:http，无框架）。
import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { UnitInst } from '@juanwang/shared';
import { Store, type ResultEntry } from './store';

export const MAX_NAME = 12;
export const MAX_OPPONENTS = 7;
const ARCHETYPES = ['open', 'closed', 'compute', 'folk', 'researcher', 'trader', 'idol', 'engineer', 'mixed'];
function cleanArchetype(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !ARCHETYPES.includes(v)) throw new HttpError(400, `archetype 应为 ${ARCHETYPES.join('/')}`);
  return v;
}
export const MAX_TEAM = 5;
export const MAX_BODY = 16 * 1024;

export interface AppOptions {
  /** 合法的单位 id（含召唤物） */
  validIds: Set<string>;
  /** 合法的装备 id（缺省：只校验格式） */
  validEquipIds?: Set<string>;
  store?: Store;
  /** 前端构建产物目录（不存在时只提供 API） */
  distDir?: string;
  rateLimit?: { max: number; windowMs: number };
  now?: () => number;
  random?: () => number;
  /** 信任 X-Forwarded-For（反向代理后面时开启） */
  trustProxy?: boolean;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** UTC+8 日期 YYYY-MM-DD */
export function dateKey(ms: number): string {
  return new Date(ms + 8 * 3600_000).toISOString().slice(0, 10);
}
export function dailySeed(date: string): string {
  return `daily-${date}`;
}

// ───────────── 校验 ─────────────

const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function cleanName(v: unknown): string {
  if (typeof v !== 'string') throw new HttpError(400, 'name 必填');
  // eslint-disable-next-line no-control-regex
  const name = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim();
  const len = Array.from(name).length;
  if (len < 1 || len > MAX_NAME) throw new HttpError(400, `name 长度应为 1~${MAX_NAME} 字`);
  return name;
}
export function cleanRoom(v: unknown): string | null {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^[A-Za-z0-9]{4,8}$/.test(v)) throw new HttpError(400, 'room 应为 4~8 位字母数字');
  return v.toUpperCase();
}
function cleanSeed(v: unknown): string {
  if (typeof v !== 'string' || v.length < 1 || v.length > 64) throw new HttpError(400, 'seed 应为 1~64 字符');
  return v;
}
const EQUIP_SLOTS = ['weapon', 'armor', 'trinket'] as const;
function cleanEquips(v: unknown, i: number, validEquipIds?: Set<string>): UnitInst['equips'] {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, `team[${i}].equips 应为对象`);
  const out: UnitInst['equips'] = {};
  for (const slot of EQUIP_SLOTS) {
    const e = (v as Record<string, unknown>)[slot] as { defId?: unknown; gold?: unknown } | undefined;
    if (e === undefined || e === null) continue;
    const ok = typeof e === 'object' && typeof e.defId === 'string' && /^[a-z0-9_]{1,32}$/.test(e.defId) && (!validEquipIds || validEquipIds.has(e.defId));
    if (!ok) throw new HttpError(400, `team[${i}].equips.${slot} 非法`);
    out[slot] = { defId: e.defId as string, gold: e.gold === true };
  }
  return out;
}

function cleanTeam(v: unknown, validIds: Set<string>, validEquipIds?: Set<string>): UnitInst[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'team 应为数组');
  const units = v.filter((x) => x !== null && x !== undefined);
  if (units.length < 1 || units.length > MAX_TEAM || v.length > MAX_TEAM) throw new HttpError(400, `team 应为 1~${MAX_TEAM} 个单位`);
  return units.map((raw, i) => {
    const u = raw as Record<string, unknown>;
    if (!u || typeof u !== 'object' || typeof u.defId !== 'string' || !validIds.has(u.defId)) throw new HttpError(400, `team[${i}].defId 非法`);
    if (!isInt(u.atk, 0, 999) || !isInt(u.hp, 1, 999)) throw new HttpError(400, `team[${i}] 属性非法`);
    const level = isInt(u.level, 1, 3) ? u.level : 1;
    const num = (x: unknown, min: number, max: number) => (isInt(x, min, max) ? x : 0);
    return {
      uid: `p${i}`,
      defId: u.defId,
      atk: u.atk,
      hp: u.hp,
      level: level as 1 | 2 | 3,
      xp: num(u.xp, 0, 5),
      shield: num(u.shield, 0, 99),
      tempAtk: num(u.tempAtk, -99, 99),
      tempHp: num(u.tempHp, -99, 99),
      equips: cleanEquips(u.equips, i, validEquipIds),
    };
  });
}

// ───────────── HTTP 工具 ─────────────

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        fail(new HttpError(413, '请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        fail(new HttpError(400, 'JSON 格式错误'));
      }
    });
    req.on('error', fail);
  });
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.txt': 'text/plain; charset=utf-8',
};

function serveStatic(distDir: string, urlPath: string, res: ServerResponse): boolean {
  const root = resolve(distDir);
  let rel: string;
  try {
    rel = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return false;
  }
  let file = normalize(join(root, rel));
  if (file !== root && !file.startsWith(root + sep)) return false;
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
  if (!existsSync(file)) {
    // SPA 回退：没有扩展名的路径返回 index.html
    if (extname(rel)) return false;
    file = join(root, 'index.html');
    if (!existsSync(file)) return false;
  }
  const ext = extname(file).toLowerCase();
  const immutable = rel.startsWith('/_app/');
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : ext === '.html' ? 'no-cache' : 'public, max-age=3600',
  });
  createReadStream(file).pipe(res);
  return true;
}

// ───────────── 应用 ─────────────

export function createApp(opts: AppOptions) {
  const store = opts.store ?? new Store();
  const now = opts.now ?? Date.now;
  const random = opts.random ?? Math.random;
  const limit = opts.rateLimit ?? { max: 10, windowMs: 1000 };
  const hits = new Map<string, { start: number; count: number }>();
  let lastSweep = now();

  function clientIp(req: IncomingMessage): string {
    if (opts.trustProxy) {
      const xf = req.headers['x-forwarded-for'];
      const first = (Array.isArray(xf) ? xf[0] : xf)?.split(',')[0]?.trim();
      if (first) return first;
    }
    return req.socket.remoteAddress ?? 'unknown';
  }

  /** 固定窗口限流：同 IP 每窗口 ≤ max 次 */
  function allow(ip: string): boolean {
    const t = now();
    if (t - lastSweep > 60_000) {
      for (const [k, v] of hits) if (t - v.start > limit.windowMs) hits.delete(k);
      lastSweep = t;
    }
    const h = hits.get(ip);
    if (!h || t - h.start >= limit.windowMs) {
      hits.set(ip, { start: t, count: 1 });
      return true;
    }
    h.count++;
    return h.count <= limit.max;
  }

  async function api(req: IncomingMessage, url: URL): Promise<[number, unknown]> {
    const q = url.searchParams;
    const route = `${req.method} ${url.pathname}`;
    switch (route) {
      case 'POST /api/snapshot': {
        const b = (await readBody(req)) as Record<string, unknown>;
        if (!isInt(b.turn, 1, 20)) throw new HttpError(400, 'turn 应为 1~20');
        if (b.hp !== undefined && !isInt(b.hp, 0, 20)) throw new HttpError(400, 'hp 应为 0~20');
        store.addSnapshot({
          name: cleanName(b.name), room: cleanRoom(b.room), turn: b.turn, hp: (b.hp as number | undefined) ?? 20, archetype: cleanArchetype(b.archetype),
          team: cleanTeam(b.team, opts.validIds, opts.validEquipIds), seed: cleanSeed(b.seed), ts: now(),
        });
        return [200, { ok: true }];
      }
      case 'GET /api/opponent': {
        const turn = Number(q.get('turn'));
        if (!isInt(turn, 1, 20)) throw new HttpError(400, 'turn 应为 1~20');
        const limitQ = q.get('limit');
        const limit = limitQ === null ? MAX_OPPONENTS : Number(limitQ);
        if (!isInt(limit, 1, MAX_OPPONENTS)) throw new HttpError(400, `limit 应为 1~${MAX_OPPONENTS}`);
        const name = q.get('name') ?? undefined;
        const seed = q.get('seed') ?? undefined;
        const snaps = store.findOpponents({ turn, room: cleanRoom(q.get('room')), name, seed, limit }, random);
        const opponents = snaps.map((s) => ({ name: s.name, team: s.team, hp: s.hp, archetype: s.archetype, turn: s.turn, room: s.room }));
        return [200, { opponents }];
      }
      case 'POST /api/result': {
        const b = (await readBody(req)) as Record<string, unknown>;
        if (!isInt(b.rank, 1, 8)) throw new HttpError(400, 'rank 应为 1~8');
        if (!isInt(b.turns, 1, 20)) throw new HttpError(400, 'turns 应为 1~20');
        if (!isInt(b.hp, 0, 20)) throw new HttpError(400, 'hp 应为 0~20');
        let bestUnit: string | null = null;
        if (b.bestUnit !== undefined && b.bestUnit !== null) {
          const id = typeof b.bestUnit === 'string' ? b.bestUnit : (b.bestUnit as { defId?: unknown })?.defId;
          if (typeof id !== 'string' || !opts.validIds.has(id)) throw new HttpError(400, 'bestUnit 非法');
          bestUnit = id;
        }
        const t = now();
        const entry: ResultEntry = {
          name: cleanName(b.name), room: cleanRoom(b.room), rank: b.rank, turns: b.turns, hp: b.hp, archetype: cleanArchetype(b.archetype), won: b.rank === 1,
          seed: cleanSeed(b.seed), bestUnit, date: dateKey(t), ts: t,
        };
        const best = store.addResult(entry);
        const board = store.leaderboard({ room: null, date: null }, 100000);
        const position = board.findIndex((r) => r.name === entry.name) + 1;
        return [200, { ok: true, best, position }];
      }
      case 'GET /api/leaderboard': {
        const room = cleanRoom(q.get('room'));
        let date = q.get('date');
        if (date === 'today') date = dateKey(now());
        if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'date 应为 YYYY-MM-DD 或 today');
        const entries = store.leaderboard({ room, date: date || null }).map((r, i) => ({
          pos: i + 1, name: r.name, rank: r.rank, turns: r.turns, hp: r.hp, archetype: r.archetype, won: r.won, seed: r.seed, bestUnit: r.bestUnit, date: r.date, room: r.room,
        }));
        return [200, { room, date: date || null, entries }];
      }
      case 'GET /api/daily': {
        const date = dateKey(now());
        return [200, { date, seed: dailySeed(date) }];
      }
      default:
        throw new HttpError(404, '没有这个接口');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (url.pathname === '/healthz') return send(res, 200, { ok: true, snapshots: store.snapshotCount(), results: store.results.size });
      if (url.pathname.startsWith('/api/')) {
        res.setHeader('access-control-allow-origin', '*');
        if (req.method === 'OPTIONS') {
          res.writeHead(204, { 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' });
          return void res.end();
        }
        if (!allow(clientIp(req))) return send(res, 429, { error: '请求太频繁，请稍后再试' });
        const [status, body] = await api(req, url);
        return send(res, status, body);
      }
      if ((req.method === 'GET' || req.method === 'HEAD') && opts.distDir && serveStatic(opts.distDir, url.pathname, res)) return;
      send(res, 404, { error: 'not found' });
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error('[server]', e);
      send(res, 500, { error: '服务器出错了' });
    }
  }

  return { handle, store };
}
