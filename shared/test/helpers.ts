import units from './fixtures/units.json';
import items from './fixtures/items.json';
import headlines from './fixtures/headlines.json';
import surprises from './fixtures/surprises.json';
import tutorial from './fixtures/tutorial.json';
import { indexData, validateData } from '../src/data';
import type { Ability, GameData, HeadlineDef, ItemDef, RunState, SurpriseDef, UnitDef, UnitInst } from '../src/types';

export const raw = { units, items, headlines, surprises, tutorial };
export const data: GameData = validateData(raw);

let uidc = 0;
/** 造一个单位实例（默认属性取 def） */
export function mk(defId: string, over: Partial<UnitInst> = {}, d: GameData = data): UnitInst {
  const def = d.unitsById[defId];
  return { uid: `t${++uidc}`, defId, atk: def.atk, hp: def.hp, level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0, ...over };
}

/** 在基础数据上追加/覆盖单位、基建、头条、突发 */
export function custom(opts: { units?: UnitDef[]; items?: ItemDef[]; headlines?: HeadlineDef[]; surprises?: SurpriseDef[]; base?: GameData } = {}): GameData {
  const b = opts.base ?? data;
  const merge = <T extends { id: string }>(base: T[], extra: T[] = []): T[] => {
    const ids = new Set(extra.map((x) => x.id));
    return [...base.filter((x) => !ids.has(x.id)), ...extra];
  };
  return indexData({
    units: merge(b.units, opts.units),
    items: merge(b.items, opts.items),
    headlines: opts.headlines ?? b.headlines,
    surprises: opts.surprises ?? b.surprises,
    tutorial: b.tutorial,
  });
}

/** 一个无技能的测试单位 def */
export function plain(id: string, atk: number, hp: number, extra: Partial<UnitDef> = {}): UnitDef {
  return { id, name: id, tier: 1, faction: 'folk', atk, hp, avatar: '', token: true, ...extra };
}
/** 带技能的测试单位 def（token:true 不进商店，避免干扰随机） */
export function withAb(id: string, atk: number, hp: number, ability: Omit<Ability, 'desc'> & { desc?: string }, extra: Partial<UnitDef> = {}): UnitDef {
  return plain(id, atk, hp, { ability: { desc: id, ...ability }, ...extra });
}

/** 把 state 的队伍直接设成给定单位（测试用） */
export function setTeam(s: RunState, team: (UnitInst | null)[]): RunState {
  const t = [...team];
  while (t.length < 5) t.push(null);
  return { ...s, team: t };
}
