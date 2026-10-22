// 运行时内容数据：用 import.meta.glob 读取 shared/data/*.json（文件缺失时构建不报错，运行时报清晰错误）。
import { validateData, type GameData } from '@juanwang/shared';

const files = import.meta.glob('../../shared/data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

function pick(name: string): unknown {
  const key = Object.keys(files).find((k) => k.endsWith(`/${name}.json`));
  return key ? files[key] : undefined;
}

let cached: GameData | null = null;

/** 校验并返回 GameData（只做一次）；数据缺失或非法时抛 DataError */
export function getGameData(): GameData {
  if (cached) return cached;
  cached = validateData({
    units: pick('units') ?? [],
    items: pick('items') ?? [],
    headlines: pick('headlines') ?? [],
    surprises: pick('surprises') ?? [],
    tutorial: pick('tutorial'),
  });
  return cached;
}
