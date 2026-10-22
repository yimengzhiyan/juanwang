import { afterEach, describe, expect, it } from 'vitest';
import { data } from './helpers';
import { DIFFICULTY, opponentScale } from '../src/engine/difficulty';
import { generateBotTeam, scaleTeam } from '../src/engine/bot';
import { livesLostOnDefeat } from '../src/engine/result';
import { offlineOpponent } from '../src/tutorial';
import { newRun } from '../src/engine/shop';
import type { UnitInst } from '../src/types';

const saved = { ...DIFFICULTY };
afterEach(() => Object.assign(DIFFICULTY, saved));
const power = (t: UnitInst[]) => t.reduce((a, u) => a + u.atk + u.hp, 0);

describe('DIFFICULTY', () => {
  it('默认参数', () => {
    expect(DIFFICULTY).toMatchObject({ earlyTurns: 4, earlyScale: 0.75, maxScale: 0.85, lowLivesThreshold: 3, lowLivesScale: 0.85, botBonusMax: 2, lateGameTurn: 12 });
  });
  it('opponentScale：前 4 回合固定低系数，之后随热搜线性回升，信心低时橡皮筋', () => {
    expect(opponentScale(1, 0)).toBeCloseTo(0.75);
    expect(opponentScale(4, 9)).toBeCloseTo(0.75);
    expect(opponentScale(5, 0)).toBeCloseTo(0.75);
    expect(opponentScale(8, 5)).toBeCloseTo(0.8);
    expect(opponentScale(12, 10)).toBeCloseTo(0.85);
    expect(opponentScale(12, 20)).toBeCloseTo(0.85);
    expect(opponentScale(12, 10, 4)).toBeCloseTo(0.85);
    expect(opponentScale(12, 10, 3)).toBeCloseTo(0.85 * 0.85);
  });
  it('scaleTeam：按系数缩放（含临时加成），攻击 ≥ 0、血量 ≥ 1', () => {
    const u: UnitInst = { uid: 'a', defId: 'crawler', atk: 10, hp: 10, level: 1, xp: 0, shield: 0, tempAtk: 2, tempHp: 0 };
    const [s] = scaleTeam([u], 0.5);
    expect(s.atk + s.tempAtk).toBe(6);
    expect(s.hp).toBe(5);
    expect(scaleTeam([{ ...u, atk: 0, hp: 1, tempAtk: 0 }], 0.1)[0]).toMatchObject({ atk: 0, hp: 1 });
  });
  it('generateBotTeam：不传 opts 不缩放；作为离线对手时按信心/热搜缩放', () => {
    const raw = generateBotTeam(8, 2, data, 'k');
    const asOpp = generateBotTeam(8, 2, data, 'k', { lives: 5 });
    expect(asOpp.map((u) => u.defId)).toEqual(raw.map((u) => u.defId));
    expect(power(asOpp)).toBeLessThan(power(raw));
    const desperate = generateBotTeam(8, 2, data, 'k', { lives: 1 });
    expect(power(desperate)).toBeLessThan(power(asOpp));
    expect(generateBotTeam(8, 2, data, 'k', { scale: 1 })).toEqual(raw);
  });
  it('offlineOpponent 使用难度系数', () => {
    const s = { ...newRun('o', data), turn: 6, trophies: 3, lives: 2 };
    const opp = offlineOpponent(s, data);
    const raw = generateBotTeam(6, 3, data, `${s.seed}:opp:6`);
    expect(power(opp)).toBeLessThan(power(raw));
  });
  it('运行时修改 DIFFICULTY 立即生效', () => {
    DIFFICULTY.lateGameTurn = 5;
    DIFFICULTY.lateGameLifeLoss = 3;
    expect(livesLostOnDefeat(5)).toBe(3);
    DIFFICULTY.maxScale = 1;
    DIFFICULTY.earlyScale = 1;
    DIFFICULTY.lowLivesScale = 1;
    expect(generateBotTeam(8, 2, data, 'k', { lives: 1 })).toEqual(generateBotTeam(8, 2, data, 'k'));
  });
});
