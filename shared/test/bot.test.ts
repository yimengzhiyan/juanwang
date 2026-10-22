import { describe, expect, it } from 'vitest';
import { data } from './helpers';
import { generateBotTeam, botBonusGold } from '../src/engine/bot';

const power = (turn: number, trophies = 0, n = 40) => {
  let sum = 0;
  for (let i = 0; i < n; i++) for (const u of generateBotTeam(turn, trophies, data, `p${i}`)) sum += u.atk + u.hp;
  return sum / n;
};

describe('generateBotTeam', () => {
  it('合法：≤5 个单位，defId 都存在，确定性', () => {
    for (let t = 1; t <= 20; t++) {
      const team = generateBotTeam(t, t % 10, data, `b${t}`);
      expect(team.length).toBeGreaterThan(0);
      expect(team.length).toBeLessThanOrEqual(5);
      for (const u of team) expect(data.unitsById[u.defId]).toBeDefined();
      expect(generateBotTeam(t, t % 10, data, `b${t}`)).toEqual(team);
    }
  });
  it('随回合变强：turn 10 平均属性 > turn 3', () => {
    expect(power(10)).toBeGreaterThan(power(3));
    expect(power(3)).toBeGreaterThan(power(1));
  });
  it('热搜越高越强', () => {
    expect(botBonusGold(0)).toBe(0);
    expect(botBonusGold(5)).toBe(1);
    expect(botBonusGold(8)).toBe(2);
    expect(botBonusGold(10)).toBe(2); // 上限 DIFFICULTY.botBonusMax = 2
    expect(power(6, 9)).toBeGreaterThan(power(6, 0));
  });
  it('后期会合并进化、出高阶单位', () => {
    const teams = Array.from({ length: 20 }, (_, i) => generateBotTeam(14, 4, data, `hi${i}`)).flat();
    expect(teams.some((u) => u.level >= 2)).toBe(true);
    expect(Math.max(...teams.map((u) => data.unitsById[u.defId].tier))).toBeGreaterThanOrEqual(5);
  });
  it('足够快：回合 20 的机器人 < 20ms', () => {
    generateBotTeam(20, 9, data, 'warm');
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) generateBotTeam(20, 9, data, `fast${i}`);
    expect((performance.now() - t0) / 20).toBeLessThan(20);
  });
});
