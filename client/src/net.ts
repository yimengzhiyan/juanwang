// 联机辅助：所有请求失败一律静默降级（返回 null），并把 online 置为 false。
import type { UnitInst } from '@juanwang/shared';

type Listener = (online: boolean) => void;
let online = true;
let retryAt = 0;
const listeners = new Set<Listener>();

export function isOnline(): boolean {
  return online;
}
export function onOnlineChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setOnline(v: boolean): void {
  if (online === v) return;
  online = v;
  for (const fn of listeners) fn(v);
}

async function req<T>(method: 'GET' | 'POST', path: string, body?: unknown, timeout = 2500): Promise<T | null> {
  // 失败后 20 秒内不再请求，避免每回合都等超时
  if (!online && Date.now() < retryAt) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('json')) throw new Error('not json');
    const json = (await res.json()) as T & { error?: string };
    if (res.status >= 500) throw new Error(String(res.status));
    setOnline(true);
    if (!res.ok) return null; // 4xx：参数问题，不算离线
    return json;
  } catch {
    retryAt = Date.now() + 20000;
    setOnline(false);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const qs = (o: Record<string, string | number | undefined>): string =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export interface Snapshot {
  name: string;
  room?: string;
  turn: number;
  hp: number;
  archetype?: string;
  team: UnitInst[];
  seed: string;
}
export interface OpponentSnap {
  name: string;
  team: UnitInst[];
  hp?: number;
  archetype?: string;
  turn?: number;
  room?: string;
}
export interface ResultReq {
  name: string;
  room?: string;
  rank: number;
  turns: number;
  hp: number;
  archetype?: string;
  seed: string;
  bestUnit?: string;
}
export interface LbEntry {
  pos: number;
  name: string;
  rank: number;
  turns: number;
  hp: number;
  archetype?: string | null;
  won: boolean;
  seed: string;
  bestUnit?: string | { defId: string } | null;
  date?: string;
  room?: string | null;
}

export const api = {
  ping: () => req<{ ok: boolean }>('GET', '/healthz', undefined, 1500),
  daily: () => req<{ date: string; seed: string }>('GET', '/api/daily', undefined, 1500),
  snapshot: (s: Snapshot) => req<{ ok: boolean }>('POST', '/api/snapshot', s),
  opponents: (p: { turn: number; room?: string; name?: string; seed?: string; limit?: number }) =>
    req<{ opponents: OpponentSnap[] }>('GET', `/api/opponent?${qs(p)}`),
  result: (r: ResultReq) => req<{ ok: boolean; best: boolean; position: number }>('POST', '/api/result', r),
  leaderboard: (p: { room?: string; date?: string }) =>
    req<{ entries: LbEntry[]; room?: string; date?: string }>('GET', `/api/leaderboard?${qs(p)}`),
};

/** UTC+8 的日期 YYYY-MM-DD（离线每日种子） */
export function todayCN(): string {
  const d = new Date(Date.now() + 8 * 3600_000);
  return d.toISOString().slice(0, 10);
}
