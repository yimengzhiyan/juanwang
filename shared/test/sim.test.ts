import { describe, expect, it } from 'vitest';
import { data } from './helpers';
import { newRun, shopAction } from '../src/engine/shop';
import { generateBotTeam } from '../src/engine/bot';
import { battleForState } from '../src/engine/helpers';
import { applyBattleResult } from '../src/engine/result';
import type { RunState, UnitInst } from '../src/types';

/** 用机器人逻辑为"玩家"购物：直接把机器人队伍放进 state（复用 bot 的贪心） */
function playOneGame(seed: string): RunState {
  let s = newRun(seed, data);
  for (let guard = 0; guard < 25 && s.phase !== 'over'; guard++) {
    if (s.phase === 'headline') s = shopAction(s, { type: 'chooseHeadline', option: (s.turn % 2) as 0 | 1 }, data);
    expect(s.phase).toBe('shop');
    // 简单玩家：能买就买（空位），然后开战
    for (let k = 0; k < 6; k++) {
      const i = s.shop.findIndex((x) => x.kind === 'unit' && x.price <= s.gold);
      if (i < 0) break;
      const n = shopAction(s, { type: 'buy', slot: i }, data);
      if (n.error) break;
      s = n;
    }
    s = shopAction(s, { type: 'endShop' }, data);
    const enemy: UnitInst[] = generateBotTeam(s.turn, s.trophies, data, `${seed}:e${s.turn}`);
    const r = battleForState(s, enemy, data);
    expect(r.events.at(-1)?.type).toBe('end');
    s = applyBattleResult(s, r, data);
    if (s.phase === 'result') s = shopAction(s, { type: 'continue' }, data);
    expect(s.error).toBeUndefined();
  }
  return s;
}

describe('完整模拟', () => {
  it('50 局机器人 vs 机器人无异常，每局 ≤ 20 回合', () => {
    for (let g = 0; g < 50; g++) {
      const s = playOneGame(`sim-${g}`);
      expect(s.phase).toBe('over');
      expect(s.turn).toBeLessThanOrEqual(20);
      expect(s.history.length).toBe(s.turn);
    }
  });

  it('机器人 vs 机器人对战 50 场都能分出结果', () => {
    for (let g = 0; g < 50; g++) {
      const turn = 1 + (g % 20);
      const a = generateBotTeam(turn, g % 10, data, `a${g}`);
      const b = generateBotTeam(turn, (g * 3) % 10, data, `b${g}`);
      let s = newRun(`x${g}`, data);
      s = { ...s, team: [...a, ...Array(5 - a.length).fill(null)] };
      const r = battleForState(s, b, data);
      expect(['me', 'enemy', 'draw']).toContain(r.winner);
      expect(r.rounds).toBeLessThanOrEqual(50);
    }
  });
});
