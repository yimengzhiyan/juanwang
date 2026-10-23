import { describe, expect, it } from 'vitest';
import { data, mk, setTeam, start } from './helpers';
import { DIFFICULTY, opponentScale } from '../src/engine/difficulty';
import { shopAction } from '../src/engine/run';

describe('DIFFICULTY', () => {
  it('默认参数（调参结果见 ENGINE_NOTES）', () => {
    expect(DIFFICULTY).toMatchObject({ earlyTurns: 4, earlyScale: 0.9, rampTurns: 6, maxScale: 1, lowHpThreshold: 6, lowHpScale: 0.9 });
  });
  it('opponentScale：前 4 回合低系数，之后线性回升到 maxScale；玩家热度低时橡皮筋', () => {
    expect(opponentScale(1)).toBe(0.9);
    expect(opponentScale(4)).toBe(0.9);
    expect(opponentScale(7)).toBeCloseTo(0.95);
    expect(opponentScale(10)).toBe(1);
    expect(opponentScale(15)).toBe(1);
    expect(opponentScale(15, 6)).toBeCloseTo(0.9);
    expect(opponentScale(15, 7)).toBe(1);
  });
  it('只缩放与玩家交战的 AI 对手；运行时修改 DIFFICULTY 立即生效', () => {
    const old = DIFFICULTY.earlyScale;
    try {
      DIFFICULTY.earlyScale = 0.5;
      const s = shopAction(setTeam(start('d'), [mk('kimi')]), { type: 'endShop' }, data);
      const o = s.opponents.find((x) => x.id === s.matchup!.opponentId)!;
      expect(s.matchup!.team[0].atk + s.matchup!.team[0].tempAtk).toBe(Math.max(0, Math.round((o.team[0].atk + o.team[0].tempAtk) * 0.5)));
    } finally {
      DIFFICULTY.earlyScale = old;
    }
  });
});
