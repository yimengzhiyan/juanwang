// 可注入种子的确定性随机数（mulberry32）。
export type RandomFn = () => number;

export interface Rng {
  (): number; // [0,1)
  /** 当前内部状态（可用于存档 / 复现） */
  state(): number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  const fn = (() => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as Rng;
  fn.state = () => a;
  return fn;
}

/** [0, n) 的整数 */
export function randInt(rng: RandomFn, n: number): number {
  return Math.floor(rng() * n);
}

/** 掷一颗 d6 */
export function rollDie(rng: RandomFn): number {
  return randInt(rng, 6) + 1;
}

/** Fisher-Yates 洗牌（返回新数组） */
export function shuffle<T>(rng: RandomFn, arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function pick<T>(rng: RandomFn, arr: readonly T[]): T | undefined {
  return arr.length ? arr[randInt(rng, arr.length)] : undefined;
}
