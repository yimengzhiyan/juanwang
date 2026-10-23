import units from './fixtures/units.json';
import headlines from './fixtures/headlines.json';
import surprises from './fixtures/surprises.json';
import tutorial from './fixtures/tutorial.json';
import equips from './fixtures/equips.json';
import consumables from './fixtures/consumables.json';
import arenas from './fixtures/arenas.json';
import opponents from './fixtures/opponents.json';
import pve from './fixtures/pve.json';
import { indexData, validateData } from '../src/data';
import { newRun } from '../src/engine/run';
import type {
  Ability, ArenaDef, BattleEvent, BattleResult, EquipDef, GameData, HeadlineDef, RunState, SurpriseDef, UnitDef, UnitInst,
} from '../src/types';

export const raw = { units, headlines, surprises, tutorial, equips, consumables, arenas, opponents, pve };
export const data: GameData = validateData(raw);

let uidc = 0;
/** 造一个单位实例（默认属性取 def） */
export function mk(defId: string, over: Partial<UnitInst> = {}, d: GameData = data): UnitInst {
  const def = d.unitsById[defId];
  return { uid: `t${++uidc}`, defId, atk: def.atk, hp: def.hp, level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0, equips: {}, ...over };
}

/** 在基础数据上追加/覆盖单位、装备、赛场、头条、突发 */
export function custom(opts: { units?: UnitDef[]; equips?: EquipDef[]; arenas?: ArenaDef[]; headlines?: HeadlineDef[]; surprises?: SurpriseDef[]; base?: GameData } = {}): GameData {
  const b = opts.base ?? data;
  const merge = <T extends { id: string }>(base: T[], extra: T[] = []): T[] => {
    const ids = new Set(extra.map((x) => x.id));
    return [...base.filter((x) => !ids.has(x.id)), ...extra];
  };
  return indexData({
    units: merge(b.units, opts.units),
    equips: merge(b.equips, opts.equips),
    consumables: b.consumables,
    arenas: merge(b.arenas, opts.arenas),
    opponents: b.opponents,
    pve: b.pve,
    headlines: opts.headlines ?? b.headlines,
    surprises: opts.surprises ?? b.surprises,
    tutorial: b.tutorial,
  });
}

/** 一个无技能的测试单位 def（token:true 不进商店） */
export function plain(id: string, atk: number, hp: number, extra: Partial<UnitDef> = {}): UnitDef {
  return { id, name: id, tier: 1, faction: 'folk', atk, hp, avatar: '', token: true, ...extra };
}
/** 带技能的测试单位 def */
export function withAb(id: string, atk: number, hp: number, ability: Omit<Ability, 'desc'> & { desc?: string }, extra: Partial<UnitDef> = {}): UnitDef {
  return plain(id, atk, hp, { ability: { desc: id, ...ability }, ...extra });
}

/** 把 state 的队伍直接设成给定单位（测试用） */
export function setTeam(s: RunState, team: (UnitInst | null)[]): RunState {
  const t = [...team];
  while (t.length < 5) t.push(null);
  return { ...s, team: t };
}

/** 开一局并直接进入第 1 回合商店（不选赛场；arena 可指定） */
export function start(seed = 's', d: GameData = data, arena: string | null = null): RunState {
  return newRun(seed, d, { arena });
}

export const of = <T extends BattleEvent['type']>(r: BattleResult | { events: BattleEvent[] }, t: T) =>
  r.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);

/** 构造一个战斗结果（结算测试用） */
export const res = (winner: BattleResult['winner'], extra: Partial<BattleResult> = {}): BattleResult => ({
  winner, events: [], enemyTeam: [], actions: 1, survivors: 0, permanentBuffs: [], bonus: { gold: 0, rerolls: 0, discount: 0 },
  summary: { damageByUid: {}, reason: '', synergyTiers: [] }, ...extra,
});
