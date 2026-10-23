import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, dateKey, type AppOptions } from '../src/app';
import { Store } from '../src/store';

const validIds = new Set(['crawler', 'wrapper', 'gpt_chan', 'token_shuijun']);
const unit = (defId = 'crawler', over: Record<string, unknown> = {}) => ({ uid: 'x', defId, atk: 2, hp: 3, level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0, equips: {}, ...over });

let servers: Server[] = [];
afterEach(() => {
  for (const s of servers) s.close();
  servers = [];
});

async function start(opts: Partial<AppOptions> = {}) {
  const app = createApp({ validIds, validEquipIds: new Set(['gpu_h100', 'firewall']), rateLimit: { max: 1000, windowMs: 1000 }, random: () => 0, ...opts });
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

const snap = (over: Record<string, unknown> = {}) => ({ name: '小明', turn: 3, hp: 18, archetype: 'open', team: [unit()], seed: 'seed1', ...over });

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
    ['hp 越界', { hp: 21 }],
    ['流派非法', { archetype: 'pirate' }],
    ['装备 id 非法', { team: [unit('crawler', { equips: { weapon: { defId: 'NOPE!', gold: false } } })] }],
    ['装备不在白名单', { team: [unit('crawler', { equips: { weapon: { defId: 'laser', gold: false } } })] }],
  ])('%s → 400', async (_n, over) => {
    const { post } = await start();
    const r = await post('/api/snapshot', snap(over));
    expect(r.status).toBe(400);
    expect(typeof r.body.error).toBe('string');
  });
  it('装备随快照保存（金色标记保留，未知字段丢弃）', async () => {
    const { post, app } = await start();
    await post('/api/snapshot', snap({ team: [unit('crawler', { equips: { weapon: { defId: 'gpu_h100', gold: true, junk: 1 }, armor: null } })] }));
    const s = [...app.store.snapshots.get(3)!.values()][0];
    expect(s.team[0].equips).toEqual({ weapon: { defId: 'gpu_h100', gold: true } });
    expect(s).toMatchObject({ hp: 18, archetype: 'open' });
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
  it('同回合、最多 7 个不同玩家、排除自己；找不到返回空数组', async () => {
    const { post, get } = await start();
    for (let i = 0; i < 9; i++) await post('/api/snapshot', snap({ name: `P${i}`, seed: `s${i}` }));
    await post('/api/snapshot', snap({ name: 'P1', seed: 'other' })); // 同名不同局：只取一条
    await post('/api/snapshot', snap({ name: 'Me', seed: 'mine' }));
    const r = await get('/api/opponent?turn=3&name=Me&seed=mine');
    expect(r.body.opponents).toHaveLength(7);
    const names = r.body.opponents.map((o: any) => o.name);
    expect(new Set(names).size).toBe(7);
    expect(names).not.toContain('Me');
    expect(r.body.opponents[0]).toMatchObject({ turn: 3, hp: 18, archetype: 'open' });
    expect(r.body.opponents[0].team[0]).toMatchObject({ defId: 'crawler', atk: 2, hp: 3, equips: {} });
    expect((await get('/api/opponent?turn=3&limit=2')).body.opponents).toHaveLength(2);
    expect((await get('/api/opponent?turn=4')).body).toEqual({ opponents: [] });
    expect((await get('/api/opponent?turn=0')).status).toBe(400);
    expect((await get('/api/opponent?turn=3&limit=8')).status).toBe(400);
  });
  it('好友房优先同房间，不足时用全服补齐', async () => {
    const { post, get } = await start();
    await post('/api/snapshot', snap({ name: 'G', seed: 'g' }));
    await post('/api/snapshot', snap({ name: 'R', seed: 'r', room: 'ab12' }));
    const r = await get('/api/opponent?turn=3&room=AB12');
    expect(r.body.opponents.map((o: any) => o.name)).toEqual(['R', 'G']);
    expect(r.body.opponents[0].room).toBe('AB12');
  });
  it('每个回合桶 LRU 上限', () => {
    const store = new Store({ maxPerBucket: 3 });
    for (let i = 0; i < 5; i++) store.addSnapshot({ name: `n${i}`, room: null, turn: 1, hp: 20, archetype: null, team: [], seed: 's', ts: i });
    expect(store.snapshotCount()).toBe(3);
    expect([...store.snapshots.get(1)!.values()].map((s) => s.name)).toEqual(['n2', 'n3', 'n4']);
  });
});

describe('/api/result 与 /api/leaderboard', () => {
  const res = (over: Record<string, unknown> = {}) => ({ name: 'A', rank: 4, turns: 12, hp: 0, archetype: 'folk', seed: 's', bestUnit: 'gpt_chan', ...over });
  it('每人只保留最佳；排序：名次 → 吃鸡回合少 / 其余存活回合多 → 热度', async () => {
    const { post, get } = await start();
    await post('/api/result', res({ name: 'A', rank: 5 }));
    await post('/api/result', res({ name: 'A', rank: 6 }));
    await post('/api/result', res({ name: 'A', rank: 3, turns: 11 }));
    await post('/api/result', res({ name: 'B', rank: 1, turns: 15, hp: 7 }));
    await post('/api/result', res({ name: 'C', rank: 1, turns: 13, hp: 2 }));
    await post('/api/result', res({ name: 'D', rank: 3, turns: 14 }));
    const r = await get('/api/leaderboard');
    expect(r.body.entries.map((e: any) => [e.name, e.rank, e.turns])).toEqual([['C', 1, 13], ['B', 1, 15], ['D', 3, 14], ['A', 3, 11]]);
    expect(r.body.entries[0]).toMatchObject({ pos: 1, bestUnit: 'gpt_chan', won: true, archetype: 'folk', hp: 2 });
    expect(r.body.entries[2].won).toBe(false);
  });
  it('好友房榜 / 今日榜；返回个人在全服榜的位置', async () => {
    let t = Date.UTC(2026, 0, 1, 4);
    const { post, get } = await start({ now: () => t });
    await post('/api/result', res({ name: 'Old', rank: 2 }));
    t = Date.UTC(2026, 0, 2, 4);
    await post('/api/result', res({ name: 'Room', room: 'FRND', rank: 3 }));
    const p = await post('/api/result', res({ name: 'New', rank: 5 }));
    expect(p.body).toEqual({ ok: true, best: true, position: 3 });
    expect((await get('/api/leaderboard?room=frnd')).body.entries.map((e: any) => e.name)).toEqual(['Room']);
    expect((await get('/api/leaderboard?date=today')).body.entries.map((e: any) => e.name)).toEqual(['Room', 'New']);
    expect((await get('/api/leaderboard?date=2026-01-01')).body.entries.map((e: any) => e.name)).toEqual(['Old']);
    expect((await get('/api/leaderboard?date=bad')).status).toBe(400);
  });
  it('校验：bestUnit 合法、rank 1~8、hp 0~20、archetype 合法', async () => {
    const { post } = await start();
    expect((await post('/api/result', res({ bestUnit: 'ghost' }))).status).toBe(400);
    expect((await post('/api/result', res({ rank: 9 }))).status).toBe(400);
    expect((await post('/api/result', res({ rank: 0 }))).status).toBe(400);
    expect((await post('/api/result', res({ hp: 30 }))).status).toBe(400);
    expect((await post('/api/result', res({ archetype: 'x' }))).status).toBe(400);
    expect((await post('/api/result', res({ archetype: undefined, bestUnit: { defId: 'crawler', atk: 3 } }))).status).toBe(200);
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
    a.addSnapshot({ name: 'A', room: null, turn: 2, hp: 15, archetype: null, team: [], seed: 's', ts: 1 });
    a.addResult({ name: 'A', room: null, rank: 3, turns: 9, hp: 0, archetype: 'open', won: false, seed: 's', bestUnit: null, date: '2026-01-01', ts: 1 });
    expect(a.saveFile(file)).toBe(true);
    expect(a.saveFile(file)).toBe(false); // 无改动不写
    const b = new Store();
    b.loadFile(file);
    expect(b.snapshotCount()).toBe(1);
    expect(b.leaderboard({ room: null, date: null })[0]).toMatchObject({ name: 'A', rank: 3 });
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2);
    // 1.0 存档（没有 rank / hp）加载时丢弃
    const c = new Store();
    c.load({ snapshots: [{ name: 'X', room: null, turn: 1, trophies: 1, team: [], seed: 's', ts: 1 }], results: [{ name: 'X', trophies: 9, turns: 9, won: false, date: 'd', ts: 1 }] });
    expect(c.snapshotCount()).toBe(0);
    expect(c.results.size).toBe(0);
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
