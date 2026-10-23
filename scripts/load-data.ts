// 脚本共用：读取 shared/data（或指定目录）下的全部内容文件并校验。缺文件时 validateData 用内置默认并在 warnings 里提醒。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateData, type GameData, type RawGameData } from '../shared/src/index';

export const DATA_FILES = ['units', 'headlines', 'surprises', 'tutorial', 'equips', 'consumables', 'arenas', 'opponents', 'pve'] as const;

export function readRaw(dir = fileURLToPath(new URL('../shared/data/', import.meta.url))): { raw: RawGameData; missing: string[] } {
  const missing: string[] = [];
  const read = (n: string) => {
    const f = join(dir, `${n}.json`);
    if (!existsSync(f)) {
      missing.push(`${n}.json`);
      return undefined;
    }
    return JSON.parse(readFileSync(f, 'utf8')) as unknown;
  };
  const raw = Object.fromEntries(DATA_FILES.map((n) => [n, read(n)])) as unknown as RawGameData;
  return { raw, missing };
}

export function loadData(dir?: string): GameData {
  return validateData(readRaw(dir).raw);
}
