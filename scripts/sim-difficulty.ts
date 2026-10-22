// 难度模拟：机器人水平的玩家（generateBotTeam，无热搜加成）打 N 局离线对局，统计回合中位数 / 登顶率 / 各阶出场率。
// 用法：npx tsx scripts/sim-difficulty.ts [局数=2000]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DIFFICULTY, applyBattleResult, battleForState, generateBotTeam, newRun, offlineOpponent, shopAction, validateData, type RunState } from '../shared/src/index';

const dir = fileURLToPath(new URL('../shared/data/', import.meta.url));
const read = (n: string) => JSON.parse(readFileSync(dir + n + '.json', 'utf8'));
const data = validateData({ units: read('units'), items: read('items'), headlines: read('headlines'), surprises: read('surprises'), tutorial: read('tutorial') });
const N = Number(process.argv[2] ?? 2000);
// 可用环境变量临时覆盖难度参数：DIFF='{"maxScale":0.9}'
Object.assign(DIFFICULTY, JSON.parse(process.env.DIFF ?? '{}'));
console.log('DIFFICULTY', JSON.stringify(DIFFICULTY));

const lens: number[] = [];
let wins = 0;
const reasons: Record<string, number> = {};
const tierMe = [0, 0, 0, 0, 0, 0, 0];
const tierEnemy = [0, 0, 0, 0, 0, 0, 0];
const t0 = performance.now();
for (let g = 0; g < N; g++) {
  let s: RunState = newRun(`D${g}`, data);
  while (s.phase !== 'over') {
    if (s.phase === 'headline') s = shopAction(s, { type: 'chooseHeadline', option: (g % 2) as 0 | 1 }, data);
    const team = generateBotTeam(s.turn, 0, data, `P${g}`);
    s = { ...s, team: [...team, ...Array(5 - team.length).fill(null)] };
    s = shopAction(s, { type: 'endShop' }, data);
    const enemy = offlineOpponent(s, data);
    for (const u of team) tierMe[data.unitsById[u.defId].tier]++;
    for (const u of enemy) tierEnemy[data.unitsById[u.defId].tier]++;
    s = applyBattleResult(s, battleForState(s, enemy, data), data);
    if (s.phase === 'result') s = shopAction(s, { type: 'continue' }, data);
  }
  lens.push(s.turn);
  if (s.won) wins++;
  reasons[s.endReason!] = (reasons[s.endReason!] ?? 0) + 1;
}
lens.sort((a, b) => a - b);
const q = (p: number) => lens[Math.floor(p * (lens.length - 1))];
const pct = (arr: number[]) => {
  const tot = arr.reduce((a, b) => a + b, 0);
  return arr.slice(1).map((c, i) => `T${i + 1} ${((c / tot) * 100).toFixed(1)}%`).join(' / ');
};
console.log(`局数 ${N}，耗时 ${((performance.now() - t0) / 1000).toFixed(1)}s`);
console.log(`结束回合：中位数 ${q(0.5)}，P25 ${q(0.25)}，P75 ${q(0.75)}，P10 ${q(0.1)}，P90 ${q(0.9)}，平均 ${(lens.reduce((a, b) => a + b, 0) / N).toFixed(1)}`);
console.log(`登顶率 ${((wins / N) * 100).toFixed(1)}%  结局 ${JSON.stringify(reasons)}`);
console.log(`玩家各阶出场率：${pct(tierMe)}`);
console.log(`对手各阶出场率：${pct(tierEnemy)}`);
