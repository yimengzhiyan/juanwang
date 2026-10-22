// 内存存储 + JSON 落盘：快照按回合分桶（每桶 LRU 上限），排行榜按 (房间, 日期, 名字) 保留最佳。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { UnitInst } from '@juanwang/shared';

export interface Snapshot {
  name: string;
  room: string | null;
  turn: number;
  trophies: number;
  team: UnitInst[];
  seed: string;
  ts: number;
}

export interface ResultEntry {
  name: string;
  room: string | null;
  trophies: number;
  turns: number;
  won: boolean;
  seed: string;
  bestUnit: string | null;
  /** UTC+8 日期 YYYY-MM-DD */
  date: string;
  ts: number;
}

export interface StoreOptions {
  maxPerBucket?: number;
  maxResults?: number;
}

const snapKey = (s: Pick<Snapshot, 'name' | 'seed' | 'room'>) => `${s.room ?? ''}|${s.name}|${s.seed}`;
const resultKey = (r: Pick<ResultEntry, 'room' | 'date' | 'name'>) => `${r.room ?? ''}|${r.date}|${r.name}`;

/** a 是否比 b 更好：登顶优先 → 热搜多 → 回合少 → 更早 */
export function betterResult(a: ResultEntry, b: ResultEntry): boolean {
  if (a.won !== b.won) return a.won;
  if (a.trophies !== b.trophies) return a.trophies > b.trophies;
  if (a.turns !== b.turns) return a.turns < b.turns;
  return a.ts < b.ts;
}

export class Store {
  /** turn → (key → snapshot)，Map 插入顺序即 LRU 顺序 */
  snapshots = new Map<number, Map<string, Snapshot>>();
  results = new Map<string, ResultEntry>();
  dirty = false;
  readonly maxPerBucket: number;
  readonly maxResults: number;

  constructor(opts: StoreOptions = {}) {
    this.maxPerBucket = opts.maxPerBucket ?? 2000;
    this.maxResults = opts.maxResults ?? 50000;
  }

  addSnapshot(s: Snapshot): void {
    let bucket = this.snapshots.get(s.turn);
    if (!bucket) {
      bucket = new Map();
      this.snapshots.set(s.turn, bucket);
    }
    const k = snapKey(s);
    bucket.delete(k);
    bucket.set(k, s);
    while (bucket.size > this.maxPerBucket) bucket.delete(bucket.keys().next().value!);
    this.dirty = true;
  }

  /** 同回合、|热搜差| ≤ 2、排除自己（name+seed）；有房间号时优先同房间 */
  findOpponent(q: { turn: number; trophies: number; room: string | null; name?: string; seed?: string }, random: () => number): Snapshot | null {
    const bucket = this.snapshots.get(q.turn);
    if (!bucket) return null;
    const cands: Snapshot[] = [];
    for (const s of bucket.values()) {
      if (Math.abs(s.trophies - q.trophies) > 2) continue;
      if (q.name !== undefined && q.seed !== undefined && s.name === q.name && s.seed === q.seed) continue;
      cands.push(s);
    }
    if (!cands.length) return null;
    const inRoom = q.room ? cands.filter((s) => s.room === q.room) : [];
    const pool = inRoom.length ? inRoom : cands;
    const pick = pool[Math.floor(random() * pool.length)];
    // 被取用也算"最近使用"
    const k = snapKey(pick);
    bucket.delete(k);
    bucket.set(k, pick);
    return pick;
  }

  addResult(r: ResultEntry): boolean {
    const k = resultKey(r);
    const cur = this.results.get(k);
    if (cur && !betterResult(r, cur)) return false;
    this.results.delete(k);
    this.results.set(k, r);
    while (this.results.size > this.maxResults) this.results.delete(this.results.keys().next().value!);
    this.dirty = true;
    return true;
  }

  /** 排行榜：按条件过滤后每人只留最佳 */
  leaderboard(q: { room: string | null; date: string | null }, limit = 50): ResultEntry[] {
    const best = new Map<string, ResultEntry>();
    for (const r of this.results.values()) {
      if (q.room && r.room !== q.room) continue;
      if (q.date && r.date !== q.date) continue;
      const cur = best.get(r.name);
      if (!cur || betterResult(r, cur)) best.set(r.name, r);
    }
    return [...best.values()].sort((a, b) => (betterResult(a, b) ? -1 : betterResult(b, a) ? 1 : 0)).slice(0, limit);
  }

  snapshotCount(): number {
    let n = 0;
    for (const b of this.snapshots.values()) n += b.size;
    return n;
  }

  toJSON(): { version: 1; snapshots: Snapshot[]; results: ResultEntry[] } {
    const snapshots: Snapshot[] = [];
    for (const b of this.snapshots.values()) snapshots.push(...b.values());
    return { version: 1, snapshots, results: [...this.results.values()] };
  }

  load(json: unknown): void {
    if (!json || typeof json !== 'object') return;
    const j = json as { snapshots?: Snapshot[]; results?: ResultEntry[] };
    for (const s of (j.snapshots ?? []).sort((a, b) => a.ts - b.ts)) if (s && typeof s.turn === 'number') this.addSnapshot(s);
    for (const r of (j.results ?? []).sort((a, b) => a.ts - b.ts)) if (r && typeof r.name === 'string') this.addResult(r);
    this.dirty = false;
  }

  loadFile(file: string): void {
    if (!existsSync(file)) return;
    try {
      this.load(JSON.parse(readFileSync(file, 'utf8')));
    } catch (e) {
      console.warn(`[store] 读取 ${file} 失败，忽略：${(e as Error).message}`);
    }
  }

  /** 原子写盘（先写临时文件再 rename）；没有改动时跳过 */
  saveFile(file: string, force = false): boolean {
    if (!this.dirty && !force) return false;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.toJSON()));
    renameSync(tmp, file);
    this.dirty = false;
    return true;
  }
}
