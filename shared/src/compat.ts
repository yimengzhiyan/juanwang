// 1.0 兼容导出（只为让未迁移的 1.0 客户端还能打包；2.0 客户端不要再用）。迁移完成后删除本文件。
import { FACTIONS, type Faction } from './types';
import { SHOP_EQUIP_SLOTS, SHOP_UNIT_SLOTS } from './engine/shop';
import { SYNERGY_DESCS } from './engine/synergy';

/** @deprecated 2.0 商店固定 4 单位格（见 shopSlotCounts） */
export function unitSlotsForTurn(_turn: number): number {
  return SHOP_UNIT_SLOTS;
}
/** @deprecated 2.0 没有基建，返回装备格数（见 shopSlotCounts） */
export function itemSlotsForTurn(_turn: number): number {
  return SHOP_EQUIP_SLOTS;
}
/** @deprecated 2.0 没有热搜，改为 8 人房名次 */
export const WIN_TROPHIES = 10;
/** @deprecated 2.0 羁绊是 2/4/6 三档（FACTION_THRESHOLDS） */
export const SYNERGY_THRESHOLD = 2;
/** @deprecated 用 SYNERGY_DESCS */
export const SYNERGY_DESC: Record<Faction, string> = Object.fromEntries(FACTIONS.map((f) => [f, SYNERGY_DESCS[f][0]])) as Record<Faction, string>;
