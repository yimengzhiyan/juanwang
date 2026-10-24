// 流派平衡模拟：机器人玩家分别偏好 10 条流派线（4 阵营 + 6 打法关键词）各跑 N 局，输出每条流派的平均名次 / 吃鸡率 / 前四率，
// 以及各阵营 / 职业 / 单位在玩家 PVP 战斗中的胜率贡献（按该线在阵容中的占比加权）。供内容同事调平衡。
// 用法：npx tsx scripts/sim-archetypes.ts [每流派局数=300]；DIFF='{"maxScale":1.05}' 可临时覆盖难度。
import {
  DIFFICULTY, SYNERGY_TUNING, FACTIONS, ROLES, SYNERGY_NAME, applyBattleResult, battleForState, botPlayTurn, newRun, shopAction,
  type Archetype, type RunState, type SynergyKey,
} from '../shared/src/index';
import { loadData } from './load-data';

const data = loadData(process.env.DATA_DIR); // DATA_DIR=... 可指向另一份内容数据做对比
const N = Number(process.argv[2] ?? 300);
Object.assign(DIFFICULTY, JSON.parse(process.env.DIFF ?? '{}'));
// TUNE='{"explodeAftershock":0}' 临时覆盖关键词羁绊数值；ONLY=explode,summon 只跑这些线
Object.assign(SYNERGY_TUNING, JSON.parse(process.env.TUNE ?? '{}'));
const ONLY = process.env.ONLY?.split(',');
const ARCHES: [SynergyKey, Archetype][] = [...FACTIONS.map((f) => [f, { faction: f }] as [SynergyKey, Archetype]), ...ROLES.map((r) => [r, { role: r }] as [SynergyKey, Archetype])]
  .filter(([k]) => !ONLY || ONLY.includes(k));

type Acc = { w: number; n: number };
const lineAcc: Record<string, Acc> = {};
const unitAcc: Record<string, Acc & { games: Set<string> }> = {};
const rows: { key: SynergyKey; avg: number; chicken: number; top4: number; turns: number; reached: number }[] = [];
const t0 = performance.now();

for (const [key, arch] of ARCHES) {
  const ranks: number[] = [];
  let turns = 0;
  let reached = 0;
  for (let g = 0; g < N; g++) {
    const seed = `A-${key}-${g}`;
    let s: RunState = shopAction(newRun(seed, data), { type: 'chooseArena', index: g % 3 }, data);
    while (s.phase !== 'over') {
      s = botPlayTurn(s, data, { archetype: arch });
      s = shopAction(s, { type: 'endShop' }, data);
      const r = battleForState(s, data);
      if (s.matchup?.kind === 'pvp' && r.winner !== 'draw') {
        const win = r.winner === 'me' ? 1 : 0;
        const team = s.team.filter((u) => !!u).map((u) => data.unitsById[u!.defId]).filter(Boolean);
        for (const d of team) {
          const share = 1 / team.length;
          for (const k of [d.faction, d.role].filter(Boolean) as string[]) {
            const a = (lineAcc[k] ??= { w: 0, n: 0 });
            a.w += win * share;
            a.n += share;
          }
          const ua = (unitAcc[d.id] ??= { w: 0, n: 0, games: new Set() });
          ua.w += win;
          ua.n += 1;
          ua.games.add(seed);
        }
      }
      s = applyBattleResult(s, r, data);
      if (s.pending) s = shopAction(s, { type: 'choosePveReward', index: g % s.pending.options.length }, data);
      if (s.phase === 'result') s = shopAction(s, { type: 'continue' }, data);
    }
    ranks.push(s.end!.rank);
    turns += s.turn;
    if ((s.stats.maxTiers[key] ?? 0) >= (FACTIONS.includes(key as never) ? 2 : 1)) reached++;
  }
  rows.push({
    key, avg: ranks.reduce((a, b) => a + b, 0) / N, chicken: ranks.filter((r) => r === 1).length / N, top4: ranks.filter((r) => r <= 4).length / N,
    turns: turns / N, reached: reached / N,
  });
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`.padStart(6);
console.log(`每流派 ${N} 局，耗时 ${((performance.now() - t0) / 1000).toFixed(0)}s，DIFFICULTY ${JSON.stringify(DIFFICULTY)}，SYNERGY_TUNING ${JSON.stringify(SYNERGY_TUNING)}`);
console.log('\n流派        | 平均名次 | 吃鸡率 | 前四率 | 平均回合 | 达成中档*');
for (const r of [...rows].sort((a, b) => a.avg - b.avg)) {
  console.log(`${(SYNERGY_NAME[r.key] + '(' + r.key + ')').padEnd(18)}| ${r.avg.toFixed(2).padStart(8)} | ${pct(r.chicken)} | ${pct(r.top4)} | ${r.turns.toFixed(1).padStart(8)} | ${pct(r.reached)}`);
}
console.log('* 阵营达成过 ×3（tier 2）/ 关键词达成过 ×2（tier 1）的局占比');
console.log('\n阵营/关键词的胜率贡献（玩家 PVP 战斗，按该线在阵容中的人数占比加权；出场 = 加权场次）');
for (const k of [...FACTIONS, ...ROLES]) {
  const a = lineAcc[k];
  if (a) console.log(`${(SYNERGY_NAME[k] + '(' + k + ')').padEnd(18)}| 胜率 ${pct(a.w / a.n)} | 出场 ${a.n.toFixed(0).padStart(6)}`);
}
console.log('\n单位胜率（上场时我方胜率，按胜率排序；出场 = 上场场次）');
const units = Object.entries(unitAcc).sort((a, b) => b[1].w / b[1].n - a[1].w / a[1].n);
for (const [id, a] of units) {
  const d = data.unitsById[id];
  console.log(`${`${d.name}(${id})`.padEnd(26)} T${d.tier} ${d.faction.padEnd(7)} ${(d.role ?? '-').padEnd(10)} | 胜率 ${pct(a.w / a.n)} | 出场 ${String(a.n).padStart(6)}`);
}
