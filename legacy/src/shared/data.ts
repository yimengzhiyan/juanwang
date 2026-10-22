// Node 侧数据加载（使用 fs，只能在服务端 import：`@dafuweng/shared/data`）。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GameData } from './types.js';
import { validateGameData } from './validate.js';

/** 默认数据目录：shared/data（src 与 dist 都位于 shared/ 下一级） */
export const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

/** 每类数据可接受的文件名（按顺序尝试） */
const FILES: Record<keyof GameData, string[]> = {
  board: ['board.json'],
  cards: ['cards.json'],
  characters: ['characters.json'],
  items: ['items.json'],
  diceSkins: ['diceSkins.json', 'dice.json', 'dice-skins.json', 'dice_skins.json'],
};

function readJson(dir: string, names: string[]): unknown {
  for (const n of names) {
    const f = join(dir, n);
    if (existsSync(f)) {
      try {
        return JSON.parse(readFileSync(f, 'utf8'));
      } catch (e) {
        throw new Error(`解析 ${f} 失败：${(e as Error).message}`);
      }
    }
  }
  throw new Error(`数据目录 ${dir} 中找不到 ${names.join(' / ')}`);
}

/** 加载并校验 shared/data/*.json（或指定目录），返回 {board, cards, characters, items, diceSkins} */
export function loadGameData(dir: string = DEFAULT_DATA_DIR): GameData {
  return validateGameData({
    board: readJson(dir, FILES.board),
    cards: readJson(dir, FILES.cards),
    characters: readJson(dir, FILES.characters),
    items: readJson(dir, FILES.items),
    diceSkins: readJson(dir, FILES.diceSkins),
  });
}

export { validateGameData, GameDataError } from './validate.js';
