// 全局客户端状态（静态数据 + 我是谁 + 当前房间 / 对局快照）。
import type { BoardData, Cell, Character, DiceSkin, GameState, Item, RoomState } from '@dafuweng/shared';

export interface StaticData {
  characters: Character[];
  board: BoardData;
  items: Item[];
  diceSkins: DiceSkin[];
}

export const store = {
  myId: '',
  data: null as StaticData | null,
  room: null as RoomState | null,
  game: null as GameState | null,
  /** serverTime - Date.now()，用于校准 turnDeadline */
  clockOffset: 0,
};

export function data(): StaticData {
  if (!store.data) throw new Error('静态数据尚未就绪');
  return store.data;
}

export function charOf(id: string | undefined): Character | undefined {
  return store.data?.characters.find((c) => c.id === id);
}

export function itemOf(id: string): Item | undefined {
  return store.data?.items.find((i) => i.id === id);
}

export function cellOf(id: number): Cell {
  return data().board.cells[id];
}

export function groupColorOf(cell: Cell): string | undefined {
  return cell.group ? data().board.groups.find((g) => g.id === cell.group)?.color : undefined;
}

/** 服务器时钟的“现在” */
export function serverNow(): number {
  return Date.now() + store.clockOffset;
}

export function randomLine(characterId: string, kind: keyof Character['lines']): string | null {
  const list = charOf(characterId)?.lines?.[kind];
  if (!list || list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

const LS = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* 隐私模式等 */
    }
  },
  del(k: string): void {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  },
};
export const prefs = LS;
