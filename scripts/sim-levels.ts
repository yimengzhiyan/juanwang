// 升级 / 商店阶级模拟（DESIGN 17、20）：机器人水平玩家（按 10 条流派线轮流）在第 8、12 回合：
//   - 商店开张时单位格里"最高阶"单位的占比（回合开始那次刷新，买东西之前）
//   - 该回合商店结束时队伍里 Lv2+ / Lv3 单位的占比（玩家与存活 AI 对手）
// 用法：npx tsx scripts/sim-levels.ts [局数=300]；MODE=v20（2.0 抽卡）/ v21（2.1 初版：3/2/1 + 已有 ×2.5，无保底）/ 缺省 = 当前规则
import { FACTIONS, ROLES, SHOP_ROLL, botPlayTurn, newRun, runTurnOffline, shopAction, shopMaxTier, type Archetype, type RunState, type UnitInst } from '../shared/src/index';
import { loadData } from './load-data';

const data = loadData(process.env.DATA_DIR);
const N = Number(process.argv[2] ?? 300);
const MODE = process.env.MODE ?? (process.env.LEGACY ? 'v20' : 'now');
if (MODE === 'v20') Object.assign(SHOP_ROLL, { ownedWeight: 1, legacyTierWeights: true, guaranteeTop: false, upgradeRerollAll: false });
if (MODE === 'v21') Object.assign(SHOP_ROLL, { topWeight: 3, guaranteeTop: false, upgradeRerollAll: false });
const TURNS = [8, 12];
const ARCHES: Archetype[] = [...FACTIONS.map((faction) => ({ faction })), ...ROLES.map((role) => ({ role }))];
type Acc = { lv2: number; lv3: number; n: number };
const acc = () => ({ lv2: 0, lv3: 0, n: 0 });
const R = Object.fromEntries(TURNS.map((t) => [t, { me: acc(), opp: acc(), top: 0, slots: 0, games: 0 }]));
const add = (a: Acc, team: readonly (UnitInst | null)[]) => {
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
  while (s.phase !== 'over' && s.turn <= Math.max(...TURNS)) {
    if (s.phase === 'headline') s = shopAction(s, { type: 'chooseHeadline', option: 0 }, data);
    const r = R[s.turn];
    if (r) {
      const top = shopMaxTier(s);
      const units = s.shop.filter((x) => x.kind === 'unit' && !x.free);
      r.slots += units.length;
      r.top += units.filter((x) => data.unitsById[x.defId]?.tier === top).length;
    }
    s = botPlayTurn(s, data, { archetype: arch });
    if (r) {
      r.games++;
      add(r.me, s.team);
      for (const o of s.opponents) if (o.alive) add(r.opp, o.team);
    }
    s = runTurnOffline(s, data, { pick: g % 3 }).state;
  }
}
const pct = (x: number, n: number) => `${((x / Math.max(1, n)) * 100).toFixed(1)}%`;
console.log(`口径 ${MODE}，${N} 局，SHOP_ROLL ${JSON.stringify(SHOP_ROLL)}`);
for (const t of TURNS) {
  const r = R[t];
  console.log(`第 ${t} 回合（${r.games} 局活到）：商店最高阶单位占比 ${pct(r.top, r.slots)}；玩家 Lv2+ ${pct(r.me.lv2, r.me.n)} / Lv3 ${pct(r.me.lv3, r.me.n)}；AI 对手 Lv2+ ${pct(r.opp.lv2, r.opp.n)} / Lv3 ${pct(r.opp.lv3, r.opp.n)}`);
}
