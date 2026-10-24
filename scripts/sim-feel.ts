// 手感诊断（2.0）：机器人水平玩家打 N 局，按回合统计战斗行动数、技能/装备触发、羁绊档位、单位数与属性。
// 用法：npx tsx scripts/sim-feel.ts [局数=200]
import { FACTIONS, ROLES, botPlayTurn, battleForState, applyBattleResult, newRun, shopAction, effectiveStats, type Archetype } from '../shared/src/index';
import { loadData } from './load-data';

const data = loadData();
const N = Number(process.argv[2] ?? 200);
const ARCHES: Archetype[] = [...FACTIONS.map((faction) => ({ faction })), ...ROLES.map((role) => ({ role }))];
type Row = { n: number; actions: number; abil: number; equip: number; tiers: number; units: number; atk: number; hp: number; timeout: number };
const per: Record<number, Row> = {};
for (let g = 0; g < N; g++) {
  let s = shopAction(newRun(`feel-${g}`, data), { type: 'chooseArena', index: 0 }, data);
  while (s.phase !== 'over') {
    s = botPlayTurn(s, data, { archetype: ARCHES[g % 8] });
    s = shopAction(s, { type: 'endShop' }, data);
    const r = battleForState(s, data);
    const p = (per[s.turn] ??= { n: 0, actions: 0, abil: 0, equip: 0, tiers: 0, units: 0, atk: 0, hp: 0, timeout: 0 });
    p.n++;
    p.actions += r.actions;
    p.abil += r.events.filter((e) => e.type === 'ability').length;
    p.equip += r.events.filter((e) => e.type === 'equipProc').length;
    p.tiers += r.summary.synergyTiers.reduce((a, x) => a + x.tier, 0);
    if (r.events.some((e) => e.type === 'end' && e.reason === 'timeout')) p.timeout++;
    for (const u of s.team) if (u) { const e = effectiveStats(u, data, s.team); p.units++; p.atk += e.atk; p.hp += e.hp; }
    s = applyBattleResult(s, r, data);
    if (s.pending) s = shopAction(s, { type: 'choosePveReward', index: 0 }, data);
    if (s.phase === 'result') s = shopAction(s, { type: 'continue' }, data);
  }
}
console.log('回合 | 场次 | 行动数 | 技能 | 装备 | 羁绊档和 | 单位 | 平均攻 | 平均血 | 超时%');
for (const t of Object.keys(per).map(Number).sort((a, b) => a - b)) {
  const p = per[t];
  if (p.n < 10) continue;
  const f = (x: number, d = 1) => x.toFixed(d).padStart(6);
  console.log(`${String(t).padStart(4)} | ${String(p.n).padStart(4)} | ${f(p.actions / p.n)} | ${f(p.abil / p.n)} | ${f(p.equip / p.n)} | ${f(p.tiers / p.n)} | ${f(p.units / p.n)} | ${f(p.atk / p.units)} | ${f(p.hp / p.units)} | ${f((100 * p.timeout) / p.n, 0)}%`);
}
