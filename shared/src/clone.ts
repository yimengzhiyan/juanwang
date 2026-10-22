/** 深拷贝（浏览器 / Node 都有 structuredClone；兜底 JSON） */
export function clone<T>(v: T): T {
  const sc = (globalThis as { structuredClone?: <U>(x: U) => U }).structuredClone;
  return sc ? sc(v) : (JSON.parse(JSON.stringify(v)) as T);
}
