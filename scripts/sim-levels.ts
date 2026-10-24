// 升级难度模拟（DESIGN 17）：机器人水平玩家（按流派线轮流）在第 T 回合商店结束时，队伍里 Lv2+ 单位的占比；同时统计 7 名 AI 对手。
// 用法：npx tsx scripts/sim-levels.ts [局数=300] [回合=8]
import { FACTIONS, ROLES, SHOP_ROLL, botPlayTurn, newRun, runTurnOffline, shopAction, type Archetype, type RunState, type UnitInst } from '../shared/src/index';
import { loadData } from './load-data';

const data = loadData(process.env.DATA_DIR);
// LEGACY=1：用 2.0 的抽卡口径（阶权重 = 阶数、已有单位不加权）做对比
if (process.env.LEGACY) Object.assign(SHOP_ROLL, { ownedWeight: 1, legacyTierWeights: true });
const N = Number(process.argv[2] ?? 300);
const T = Number(process.argv[3] ?? 8);
const ARCHES: Archetype[] = [...FACTIONS.map((f) => ({ faction: f })), ...ROLES.map((r) => ({ role: r }))];
let me = { lv2: 0, lv3: 0, n: 0, games: 0 };
let opp = { lv2: 0, lv3: 0, n: 0 };
const acc = (a: { lv2: number; lv3: number; n: number }, team: readonly (UnitInst | null)[]) => {
  for (const u of team) {
    if (!u) continue;
    a.n++;
    if (u.level >= 2) a.lv2++;
    if (u.level >= 3) a.lv3++;
  }
};
for (let g = 0; g < N; g++) {
  let s: RunState = shopAction(newRun(`L${g}`, data), { type: 'chooseArena', index: g % 3 }, data);
  const arch = ARCHES[g % ARCHES.length];
  while (s.phase !== 'over' && s.turn < T) {
    s = botPlayTurn(s, data, { archetype: arch });
    s = runTurnOffline(s, data, { pick: g % 3 }).state;
  }
  if (s.phase === 'over' || s.turn !== T) continue;
  s = botPlayTurn(s, data, { archetype: arch });
  s = shopAction(s, { type: 'endShop' }, data);
  me.games++;
  acc(me, s.team);
  for (const o of s.opponents) if (o.alive) acc(opp, o.team);
}
const pct = (x: number, n: number) => `${((x / Math.max(1, n)) * 100).toFixed(1)}%`;
console.log(`${process.env.LEGACY ? '[2.0 抽卡口径] ' : ''}第 ${T} 回合（${me.games}/${N} 局活到）：玩家 Lv2+ ${pct(me.lv2, me.n)}（Lv3 ${pct(me.lv3, me.n)}，平均 ${(me.n / Math.max(1, me.games)).toFixed(2)} 个单位）；AI 对手 Lv2+ ${pct(opp.lv2, opp.n)}（Lv3 ${pct(opp.lv3, opp.n)}）`);
