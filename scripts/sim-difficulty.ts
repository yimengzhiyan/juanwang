// 难度模拟（2.0）：机器人水平的玩家（botPlayTurn，按 8 条流派轮流）在 8 人房打 N 局，统计名次 / 吃鸡率 / 结束回合。
// 用法：npx tsx scripts/sim-difficulty.ts [局数=500]；可用 DIFF='{"maxScale":0.9}' 临时覆盖 DIFFICULTY。
import { DIFFICULTY, botPlayTurn, newRun, runTurnOffline, shopAction, type Archetype, type RunState } from '../shared/src/index';
import { loadData } from './load-data';

const data = loadData();
const N = Number(process.argv[2] ?? 500);
Object.assign(DIFFICULTY, JSON.parse(process.env.DIFF ?? '{}'));
console.log('DIFFICULTY', JSON.stringify(DIFFICULTY));
const ARCHES: Archetype[] = [{ faction: 'open' }, { faction: 'closed' }, { faction: 'compute' }, { faction: 'folk' }, { role: 'researcher' }, { role: 'trader' }, { role: 'idol' }, { role: 'engineer' }];

const lens: number[] = [];
const ranks: number[] = [];
const byArch: Record<string, number[]> = {};
const ends: Record<string, number[]> = {};
const t0 = performance.now();
for (let g = 0; g < N; g++) {
  let s: RunState = newRun(`D${g}`, data);
  s = shopAction(s, { type: 'chooseArena', index: g % 3 }, data);
  const arch = ARCHES[g % ARCHES.length];
  while (s.phase !== 'over') {
    s = botPlayTurn(s, data, { archetype: arch });
    s = runTurnOffline(s, data, { pick: g % 3 }).state;
  }
  lens.push(s.turn);
  ranks.push(s.end!.rank);
  (byArch[arch.faction ?? arch.role!] ??= []).push(s.end!.rank);
  (ends[s.end!.archetype] ??= []).push(s.end!.rank);
}
const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
lens.sort((a, b) => a - b);
const q = (p: number) => lens[Math.floor(p * (lens.length - 1))];
console.log(`局数 ${N}，耗时 ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`玩家结束回合：中位数 ${q(0.5)}（P25 ${q(0.25)} / P75 ${q(0.75)} / P10 ${q(0.1)} / P90 ${q(0.9)}），平均 ${avg(lens).toFixed(1)}`);
console.log(`平均名次 ${avg(ranks).toFixed(2)}，吃鸡率 ${((ranks.filter((r) => r === 1).length / N) * 100).toFixed(1)}%，前四 ${((ranks.filter((r) => r <= 4).length / N) * 100).toFixed(1)}%`);
console.log('名次分布', [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${r}:${ranks.filter((x) => x === r).length}`).join(' '));
console.log('按玩家机器人偏好流派的平均名次', Object.entries(byArch).map(([k, v]) => `${k} ${avg(v).toFixed(2)}`).join('，'));
console.log('按结局判定流派的平均名次（局数）', Object.entries(ends).map(([k, v]) => `${k} ${avg(v).toFixed(2)}(${v.length})`).join('，'));
