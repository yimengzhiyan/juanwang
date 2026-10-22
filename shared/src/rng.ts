// 确定性随机：mulberry32 + 字符串种子哈希（cyrb53 截断到 32 位）。

/** 把任意字符串种子哈希成 32 位无符号整数 */
export function hashSeed(seed: string | number): number {
  const str = String(seed);
  let h1 = 0xdeadbeef ^ str.length;
  let h2 = 0x41c6ce57 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h1 ^ h2) >>> 0;
}

/** mulberry32 单步：输入状态，返回 [0,1) 随机数与新状态 */
export function mulberry32Step(state: number): [number, number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** 可变的随机数生成器（内部状态可导出，便于存进 RunState） */
export class Rng {
  state: number;
  constructor(seed: string | number) {
    this.state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  }
  static fromState(state: number): Rng {
    const r = new Rng(0);
    r.state = state >>> 0;
    return r;
  }
  /** [0,1) */
  next(): number {
    const [v, s] = mulberry32Step(this.state);
    this.state = s;
    return v;
  }
  /** [0,n) 整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  /** [min,max] 整数 */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  /** 按权重选下标 */
  weighted(weights: readonly number[]): number {
    const total = weights.reduce((a, b) => a + Math.max(0, b), 0);
    if (total <= 0) return 0;
    let r = this.next() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= Math.max(0, weights[i]);
      if (r < 0) return i;
    }
    return weights.length - 1;
  }
  /** 不重复地取 n 个（Fisher-Yates 部分洗牌，不修改原数组） */
  sample<T>(arr: readonly T[], n: number): T[] {
    const a = arr.slice();
    const k = Math.min(n, a.length);
    for (let i = 0; i < k; i++) {
      const j = i + this.int(a.length - i);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a.slice(0, k);
  }
}

/** 便捷函数：返回一个 () => [0,1) 的 mulberry32 闭包 */
export function mulberry32(seed: string | number): () => number {
  const r = new Rng(seed);
  return () => r.next();
}
