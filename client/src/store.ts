// 全局状态：内容数据、当前对局、设置（localStorage）、场景路由。
import { newRun, shopAction, type GameData, type RunState, type ShopActionInput } from '@juanwang/shared';

// ───────────── 本地存储（全部 try/catch） ─────────────
const LS = 'jw.';
function lsGet<T>(k: string, def: T): T {
  try {
    const v = localStorage.getItem(LS + k);
    return v == null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
function lsSet(k: string, v: unknown): void {
  try {
    localStorage.setItem(LS + k, JSON.stringify(v));
  } catch {
    /* 忽略 */
  }
}

const randName = (): string => `卷王${Math.floor(100 + Math.random() * 900)}`;

export const settings = {
  name: lsGet<string>('name', '') || randName(),
  room: lsGet<string>('room', ''),
  muted: lsGet<boolean>('muted', false),
  tutorialDone: lsGet<boolean>('tutorialDone', false),
  seen: new Set<string>(lsGet<string[]>('seen', [])),
  /** 达成过的成就 id（结局页"首次达成"） */
  achievements: new Set<string>(lsGet<string[]>('ach', [])),
};
/** 记录成就，返回其中首次达成的 */
export function recordAchievements(ids: string[]): string[] {
  const fresh = ids.filter((id) => !settings.achievements.has(id));
  for (const id of fresh) settings.achievements.add(id);
  if (fresh.length) lsSet('ach', [...settings.achievements]);
  return fresh;
}
export function saveSettings(): void {
  lsSet('name', settings.name);
  lsSet('room', settings.room);
  lsSet('muted', settings.muted);
  lsSet('tutorialDone', settings.tutorialDone);
}
let seenTimer = 0;
/** 记录见过的单位（图鉴点亮） */
export function markSeen(ids: Iterable<string>): void {
  let changed = false;
  for (const id of ids) {
    if (!settings.seen.has(id)) {
      settings.seen.add(id);
      if (app.run) app.newSeen.push(id);
      changed = true;
    }
  }
  if (changed && !seenTimer) {
    seenTimer = window.setTimeout(() => {
      seenTimer = 0;
      lsSet('seen', [...settings.seen]);
    }, 300);
  }
}

// ───────────── 对局 ─────────────
export type RunMode = 'normal' | 'daily' | 'tutorial' | 'shared';

export const app = {
  data: null as unknown as GameData,
  run: null as RunState | null,
  mode: 'normal' as RunMode,
  /** 本局开始时间戳 */
  startedAt: 0,
  /** 结果是否已上传 */
  uploaded: false,
  lastRank: null as number | null,
  /** 引导"完成"气泡已确认 */
  tutAck: false,
  /** 本局新点亮的图鉴单位 */
  newSeen: [] as string[],
  /** 本局首次达成的成就（结局页算一次后缓存） */
  freshAch: null as string[] | null,
};

type RunListener = (next: RunState, prev: RunState | null, action?: ShopActionInput) => void;
const runListeners = new Set<RunListener>();
export function onRun(fn: RunListener): () => void {
  runListeners.add(fn);
  return () => runListeners.delete(fn);
}
export function setRun(next: RunState, action?: ShopActionInput): void {
  const prev = app.run;
  app.run = next;
  for (const fn of runListeners) fn(next, prev, action);
}

export function newSeed(): string {
  return `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function startRun(seed: string, mode: RunMode): RunState {
  const run = newRun(seed, app.data, { tutorial: mode === 'tutorial' });
  app.mode = mode;
  app.startedAt = Date.now();
  app.uploaded = false;
  app.lastRank = null;
  app.tutAck = false;
  app.newSeen = [];
  app.freshAch = null;
  setRun(run);
  return run;
}

/** 执行一个商店动作；返回新状态（失败时带 error） */
export function act(action: ShopActionInput): RunState {
  if (!app.run) throw new Error('no run');
  const next = shopAction(app.run, action, app.data);
  setRun(next, action);
  return next;
}

// ───────────── 场景路由 ─────────────
export type SceneName = 'loading' | 'home' | 'arena' | 'game' | 'battle' | 'over';
export interface Scene {
  el: HTMLElement;
  destroy?: () => void;
}
type SceneFactory = (params?: Record<string, unknown>) => Scene;
const factories = new Map<SceneName, SceneFactory>();
let current: { name: SceneName; scene: Scene } | null = null;
let root: HTMLElement;

export function setSceneRoot(el: HTMLElement): void {
  root = el;
}
export function registerScene(name: SceneName, f: SceneFactory): void {
  factories.set(name, f);
}
/** 按当前对局阶段进入对应场景 */
export function goRun(): void {
  const p = app.run?.phase;
  go(p === 'arena' ? 'arena' : p === 'battle' ? 'battle' : p === 'over' ? 'over' : 'game');
}
export function currentScene(): SceneName | null {
  return current?.name ?? null;
}
export function go(name: SceneName, params?: Record<string, unknown>): void {
  const f = factories.get(name);
  if (!f) throw new Error(`scene ${name}`);
  if (current) {
    current.scene.destroy?.();
    current.scene.el.remove();
  }
  const scene = f(params);
  scene.el.classList.add('scene', `scene--${name}`);
  root.appendChild(scene.el);
  current = { name, scene };
  document.body.dataset.scene = name;
}
