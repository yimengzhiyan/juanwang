// 内存存储 + JSON 落盘：快照按回合分桶（每桶 LRU 上限），排行榜按 (房间, 日期, 名字) 保留最佳。
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { UnitInst } from '@juanwang/shared';

export interface Snapshot {
  name: string;
  room: string | null;
  turn: number;
  /** 上传时的热度（0~20） */
  hp: number;
  /** 流派 key（open/…/engineer/mixed），可选 */
  archetype: string | null;
  team: UnitInst[];
  seed: string;
  ts: number;
}

export interface ResultEntry {
  name: string;
  room: string | null;
  /** 名次 1~8 */
  rank: number;
  /** 存活回合 */
  turns: number;
  /** 结束时热度 */
  hp: number;
  archetype: string | null;
  /** = rank === 1 */
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

/** a 是否比 b 更好：名次靠前 → （吃鸡：回合少；其余：存活回合多）→ 热度高 → 更早 */
export function betterResult(a: ResultEntry, b: ResultEntry): boolean {
  if (a.rank !== b.rank) return a.rank < b.rank;
  if (a.turns !== b.turns) return a.rank === 1 ? a.turns < b.turns : a.turns > b.turns;
  if (a.hp !== b.hp) return a.hp > b.hp;
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

  /**
   * 取最多 limit 条同回合快照（不同名字各一条，排除自己 name；有 seed 时也排除同 name+seed），
   * 有房间号时先取同房间、不足再用全服补。随机打乱。
   */
  findOpponents(q: { turn: number; room: string | null; name?: string; seed?: string; limit: number }, random: () => number): Snapshot[] {
    const bucket = this.snapshots.get(q.turn);
    if (!bucket) return [];
    const cands: Snapshot[] = [];
    for (const s of bucket.values()) {
      if (q.name !== undefined && s.name === q.name) continue;
      cands.push(s);
    }
    const shuffle = (l: Snapshot[]) => {
      const a = l.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    };
    const ordered = [...shuffle(q.room ? cands.filter((s) => s.room === q.room) : []), ...shuffle(cands.filter((s) => !q.room || s.room !== q.room))];
    const out: Snapshot[] = [];
    const names = new Set<string>();
    for (const s of ordered) {
      if (out.length >= q.limit) break;
      if (names.has(s.name)) continue;
      names.add(s.name);
      out.push(s);
    }
    // 被取用也算"最近使用"
    for (const s of out) {
      const k = snapKey(s);
      bucket.delete(k);
      bucket.set(k, s);
    }
    return out;
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

  toJSON(): { version: 2; snapshots: Snapshot[]; results: ResultEntry[] } {
    const snapshots: Snapshot[] = [];
    for (const b of this.snapshots.values()) snapshots.push(...b.values());
    return { version: 2, snapshots, results: [...this.results.values()] };
  }

  load(json: unknown): void {
    if (!json || typeof json !== 'object') return;
    const j = json as { snapshots?: Snapshot[]; results?: ResultEntry[] };
    // 1.0 的存档（trophies/won，没有 rank/hp）直接丢弃：口径不同，不混进 2.0 榜单
    for (const s of (j.snapshots ?? []).sort((a, b) => a.ts - b.ts)) if (s && typeof s.turn === 'number' && typeof s.hp === 'number') this.addSnapshot(s);
    for (const r of (j.results ?? []).sort((a, b) => a.ts - b.ts)) if (r && typeof r.name === 'string' && typeof r.rank === 'number') this.addResult(r);
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
