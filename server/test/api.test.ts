import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, dateKey, type AppOptions } from '../src/app';
import { Store } from '../src/store';

const validIds = new Set(['crawler', 'wrapper', 'gpt_chan', 'token_shuijun']);
const unit = (defId = 'crawler', over: Record<string, unknown> = {}) => ({ uid: 'x', defId, atk: 2, hp: 3, level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0, ...over });

let servers: Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

async function start(opts: Partial<AppOptions> = {}) {
  const app = createApp({ validIds, rateLimit: { max: 1000, windowMs: 1000 }, random: () => 0, ...opts });
  const server = createServer((req, res) => void app.handle(req, res));
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (p: string) => {
    const r = await fetch(base + p);
    return { status: r.status, body: (await r.json()) as any };
  };
  const post = async (p: string, body: unknown) => {
    const r = await fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { app, base, get, post };
}

const snap = (over: Record<string, unknown> = {}) => ({ name: '小明', turn: 3, trophies: 2, team: [unit()], seed: 'seed1', ...over });

describe('/healthz 与 /api/daily', () => {
  it('healthz', async () => {
    const { get } = await start();
    expect(await get('/healthz')).toMatchObject({ status: 200, body: { ok: true } });
  });
  it('daily：按 UTC+8 日期生成种子，同一天相同', async () => {
    const t = Date.UTC(2026, 9, 22, 17, 0); // UTC 17:00 = 北京时间次日 01:00
    const { get } = await start({ now: () => t });
    const r = await get('/api/daily');
    expect(r.body).toEqual({ date: '2026-10-23', seed: 'daily-2026-10-23' });
    expect(dateKey(t)).toBe('2026-10-23');
  });
});

describe('/api/snapshot 校验', () => {
  it('合法快照返回 ok', async () => {
    const { post, app } = await start();
    expect((await post('/api/snapshot', snap())).body).toEqual({ ok: true });
    expect(app.store.snapshotCount()).toBe(1);
  });
  it.each([
    ['名字超过 12 字', { name: '一二三四五六七八九十一二三' }],
    ['空名字', { name: '   ' }],
    ['队伍超过 5 个', { team: Array(6).fill(unit()) }],
    ['空队伍', { team: [] }],
    ['非法 defId', { team: [unit('nope')] }],
    ['属性非法', { team: [unit('crawler', { atk: -1 })] }],
    ['回合越界', { turn: 21 }],
    ['房间号非法', { room: 'ab' }],
    ['缺 seed', { seed: '' }],
  ])('%s → 400', async (_n, over) => {
    const { post } = await start();
    const r = await post('/api/snapshot', snap(over));
    expect(r.status).toBe(400);
    expect(typeof r.body.error).toBe('string');
  });
  it('12 个汉字可以；坏 JSON → 400；未知接口 → 404', async () => {
    const { post, base, get } = await start();
    expect((await post('/api/snapshot', snap({ name: '一二三四五六七八九十一二' }))).status).toBe(200);
    const r = await fetch(`${base}/api/snapshot`, { method: 'POST', body: '{bad' });
    expect(r.status).toBe(400);
    expect((await get('/api/nope')).status).toBe(404);
  });
});

describe('/api/opponent 匹配', () => {
  it('同回合、热搜差 ≤ 2、排除自己；找不到返回 {team:null}', async () => {
    const { post, get } = await start();
    await post('/api/snapshot', snap({ name: 'A', trophies: 2, seed: 's1' }));
    await post('/api/snapshot', snap({ name: 'B', trophies: 7, seed: 's2' }));
    // 自己（A+s1）被排除，B 热搜差 5 → null
    expect((await get('/api/opponent?turn=3&trophies=2&name=A&seed=s1')).body).toEqual({ team: null });
    // 别人来匹配：拿到 A
    const r = await get('/api/opponent?turn=3&trophies=4&name=C&seed=s3');
    expect(r.body).toMatchObject({ name: 'A', trophies: 2, turn: 3 });
    expect(r.body.team[0]).toMatchObject({ defId: 'crawler', atk: 2, hp: 3 });
    // 不同回合
    expect((await get('/api/opponent?turn=4&trophies=2')).body.team).toBeNull();
    expect((await get('/api/opponent?turn=0&trophies=2')).status).toBe(400);
  });
  it('好友房优先同房间，房间里没有时退回全服', async () => {
    const { post, get } = await start();
    await post('/api/snapshot', snap({ name: 'G', seed: 'g' }));
    await post('/api/snapshot', snap({ name: 'R', seed: 'r', room: 'ab12' }));
    const r = await get('/api/opponent?turn=3&trophies=2&room=AB12');
    expect(r.body).toMatchObject({ name: 'R', room: 'AB12' });
    const r2 = await get('/api/opponent?turn=3&trophies=2&room=ZZZZ');
    expect(r2.body.team).not.toBeNull();
  });
  it('每个回合桶 LRU 上限', () => {
    const store = new Store({ maxPerBucket: 3 });
    for (let i = 0; i < 5; i++) store.addSnapshot({ name: `n${i}`, room: null, turn: 1, trophies: 0, team: [], seed: 's', ts: i });
    expect(store.snapshotCount()).toBe(3);
    expect([...store.snapshots.get(1)!.values()].map((s) => s.name)).toEqual(['n2', 'n3', 'n4']);
  });
});

describe('/api/result 与 /api/leaderboard', () => {
  const res = (over: Record<string, unknown> = {}) => ({ name: 'A', trophies: 5, turns: 12, won: false, seed: 's', bestUnit: 'gpt_chan', ...over });
  it('每人只保留最佳；排序：登顶 > 热搜多 > 回合少', async () => {
    const { post, get } = await start();
    await post('/api/result', res({ name: 'A', trophies: 5 }));
    await post('/api/result', res({ name: 'A', trophies: 3 }));
    await post('/api/result', res({ name: 'A', trophies: 7 }));
    await post('/api/result', res({ name: 'B', trophies: 10, won: true, turns: 15 }));
    await post('/api/result', res({ name: 'C', trophies: 10, won: true, turns: 13 }));
    const r = await get('/api/leaderboard');
    expect(r.body.entries.map((e: any) => [e.name, e.trophies])).toEqual([['C', 10], ['B', 10], ['A', 7]]);
    expect(r.body.entries[0]).toMatchObject({ rank: 1, bestUnit: 'gpt_chan', won: true });
  });
  it('好友房榜 / 今日榜', async () => {
    let t = Date.UTC(2026, 0, 1, 4);
    const { post, get } = await start({ now: () => t });
    await post('/api/result', res({ name: 'Old', trophies: 9 }));
    t = Date.UTC(2026, 0, 2, 4);
    await post('/api/result', res({ name: 'Room', room: 'FRND', trophies: 4 }));
    await post('/api/result', res({ name: 'New', trophies: 2 }));
    expect((await get('/api/leaderboard?room=frnd')).body.entries.map((e: any) => e.name)).toEqual(['Room']);
    expect((await get('/api/leaderboard?date=today')).body.entries.map((e: any) => e.name)).toEqual(['Room', 'New']);
    expect((await get('/api/leaderboard?date=2026-01-01')).body.entries.map((e: any) => e.name)).toEqual(['Old']);
    expect((await get('/api/leaderboard?date=bad')).status).toBe(400);
  });
  it('校验：bestUnit 必须是合法单位、won 必须是布尔', async () => {
    const { post } = await start();
    expect((await post('/api/result', res({ bestUnit: 'ghost' }))).status).toBe(400);
    expect((await post('/api/result', res({ won: 'yes' }))).status).toBe(400);
    expect((await post('/api/result', res({ bestUnit: { defId: 'crawler', atk: 3 } }))).status).toBe(200);
  });
});

describe('限流', () => {
  it('同 IP 每秒 > 10 次返回 429，下一秒恢复', async () => {
    let t = 1_000_000;
    const { get } = await start({ rateLimit: { max: 10, windowMs: 1000 }, now: () => t });
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) codes.push((await get('/api/daily')).status);
    expect(codes.filter((c) => c === 200)).toHaveLength(10);
    expect(codes.slice(10)).toEqual([429, 429]);
    t += 1000;
    expect((await get('/api/daily')).status).toBe(200);
    // healthz 不限流
    expect((await get('/healthz')).status).toBe(200);
  });
});

describe('落盘与静态托管', () => {
  it('store 存盘再加载', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jw-'));
    const file = join(dir, 'data', 'store.json');
    const a = new Store();
    a.addSnapshot({ name: 'A', room: null, turn: 2, trophies: 1, team: [], seed: 's', ts: 1 });
    a.addResult({ name: 'A', room: null, trophies: 3, turns: 9, won: false, seed: 's', bestUnit: null, date: '2026-01-01', ts: 1 });
    expect(a.saveFile(file)).toBe(true);
    expect(a.saveFile(file)).toBe(false); // 无改动不写
    const b = new Store();
    b.loadFile(file);
    expect(b.snapshotCount()).toBe(1);
    expect(b.leaderboard({ room: null, date: null })[0]).toMatchObject({ name: 'A', trophies: 3 });
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(1);
  });
  it('托管 client/dist：文件、SPA 回退、禁止目录穿越', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'jw-dist-'));
    mkdirSync(join(dir, 'characters'));
    writeFileSync(join(dir, 'index.html'), '<h1>hi</h1>');
    writeFileSync(join(dir, 'characters', 'a.png'), 'png');
    const { base } = await start({ distDir: dir });
    const r1 = await fetch(`${base}/`);
    expect(await r1.text()).toBe('<h1>hi</h1>');
    const r2 = await fetch(`${base}/characters/a.png`);
    expect(r2.headers.get('content-type')).toBe('image/png');
    expect(await (await fetch(`${base}/some/route`)).text()).toBe('<h1>hi</h1>');
    expect((await fetch(`${base}/missing.png`)).status).toBe(404);
    expect((await fetch(`${base}/..%2f..%2fetc%2fpasswd`)).status).toBe(404);
  });
});
