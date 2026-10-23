// 手感诊断：机器人水平玩家打 300 局，统计每回合的战斗长度、技能触发次数、属性总和、合体次数
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { applyBattleResult, battleForState, generateBotTeam, newRun, offlineOpponent, shopAction, validateData } from '../shared/src/index';
const dir = fileURLToPath(new URL('../shared/data/', import.meta.url));
const load = (f: string) => JSON.parse(readFileSync(dir + f, 'utf8'));
const data = validateData({ units: load('units.json'), items: load('items.json'), headlines: load('headlines.json'), surprises: load('surprises.json'), tutorial: load('tutorial.json') });
const N = 300; const perTurn: Record<number, any> = {};
let totalBattles = 0, abilityEvents = 0, rounds = 0, zeroAbility = 0, battlesWithDeathless = 0, mergesTotal = 0, lv3 = 0;
for (let g = 0; g < N; g++) {
  let s = newRun('feel-' + g, data);
  let safety = 0;
  while (s.phase !== 'over' && safety++ < 60) {
    if (s.phase === 'headline') s = shopAction(s, { type: 'chooseHeadline', option: g % 2 } as any, data);
    if (s.phase === 'shop') {
      // 用机器人队伍替换玩家队伍，模拟“机器人水平玩家”
      const bot = generateBotTeam(s.turn, 0, data, 'p-' + g + '-' + s.turn);
      s = { ...s, team: [...bot, null, null, null, null, null].slice(0, 5) as any };
      s = shopAction(s, { type: 'endShop' } as any, data);
    }
    if (s.phase === 'battle') {
      const enemy = offlineOpponent(s, data);
      const r = battleForState(s, enemy, data);
      const t = s.turn; const pt = (perTurn[t] ||= { n: 0, rounds: 0, abil: 0, atk: 0, hp: 0, units: 0, lv2: 0 });
      pt.n++; pt.rounds += r.rounds; const ab = r.events.filter((e: any) => e.type === 'ability').length; pt.abil += ab;
      for (const u of s.team) if (u) { pt.atk += u.atk; pt.hp += u.hp; pt.units++; if (u.level >= 2) pt.lv2++; if (u.level >= 3) lv3++; }
      totalBattles++; abilityEvents += ab; rounds += r.rounds; if (ab === 0) zeroAbility++;
      s = applyBattleResult(s, r, data);
    }
    if (s.phase === 'result') s = shopAction(s, { type: 'continue' } as any, data);
  }
}
console.log(`局数 ${N}，战斗 ${totalBattles}，平均每场 ${(rounds / totalBattles).toFixed(1)} 轮互击，平均每场技能触发 ${(abilityEvents / totalBattles).toFixed(1)} 次，无任何技能触发的战斗占 ${(100 * zeroAbility / totalBattles).toFixed(0)}%`);
console.log('回合 | 场次 | 互击轮数 | 技能触发 | 单位数 | 平均攻 | 平均血 | Lv2+占比');
for (const t of Object.keys(perTurn).map(Number).sort((a, b) => a - b)) { const p = perTurn[t]; if (p.n < 20) continue;
  console.log(`${String(t).padStart(4)} | ${String(p.n).padStart(4)} | ${(p.rounds / p.n).toFixed(1).padStart(8)} | ${(p.abil / p.n).toFixed(1).padStart(8)} | ${(p.units / p.n).toFixed(1).padStart(6)} | ${(p.atk / p.units).toFixed(1).padStart(6)} | ${(p.hp / p.units).toFixed(1).padStart(6)} | ${(100 * p.lv2 / p.units).toFixed(0).padStart(6)}%`); }
