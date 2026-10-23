import { describe, expect, it } from 'vitest';
import { data } from './helpers';
import { newRun, shopAction } from '../src/engine/run';
import { botPlayTurn } from '../src/engine/bot';
import { runTurnOffline } from '../src/engine/helpers';
import { simulateBattle } from '../src/engine/battle';
import { generateArchetypeTeam } from '../src/engine/bot';
import { FACTIONS, ROLES, type Archetype } from '../src/types';

const ARCHES: Archetype[] = [...FACTIONS.map((f) => ({ faction: f })), ...ROLES.map((r) => ({ role: r }))];

describe('完整模拟（fixtures）', () => {
  it('40 局完整对局无异常：每局 ≤ 20 回合，以名次结束；同种子可重放', () => {
    const play = (g: number) => {
      let s = shopAction(newRun(`sim-${g}`, data), { type: 'chooseArena', index: g % 3 }, data);
      while (s.phase !== 'over') {
        s = botPlayTurn(s, data, { archetype: ARCHES[g % 8] });
        s = runTurnOffline(s, data).state;
        expect(s.error).toBeUndefined();
      }
      return s;
    };
    for (let g = 0; g < 40; g++) {
      const s = play(g);
      expect(s.turn).toBeLessThanOrEqual(20);
      expect(s.end!.rank).toBeGreaterThanOrEqual(1);
      expect(s.history.length).toBe(s.turn);
    }
    expect(play(3)).toEqual(play(3));
  }, 60_000);
  it('任意两支流派机器人对战都能分出结果（≤ 60 次行动）', () => {
    for (let g = 0; g < 40; g++) {
      const a = generateArchetypeTeam(ARCHES[g % 8], 1 + (g % 20), `a${g}`, data);
      const b = generateArchetypeTeam(ARCHES[(g * 3) % 8], 1 + (g % 20), `b${g}`, data);
      const r = simulateBattle(a, b, data, `x${g}`);
      expect(['me', 'enemy', 'draw']).toContain(r.winner);
      expect(r.actions).toBeLessThanOrEqual(60);
    }
  });
});
