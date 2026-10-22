import { describe, expect, it } from 'vitest';
import { data, mk, setTeam } from './helpers';
import { newRun, shopAction } from '../src/engine/shop';
import { applyBattleResult, livesLostOnDefeat } from '../src/engine/result';
import type { BattleResult, RunState } from '../src/types';

const res = (winner: BattleResult['winner'], extra: Partial<BattleResult> = {}): BattleResult => ({
  winner, events: [], enemyTeam: [mk('weak' in data.unitsById ? 'weak' : 'crawler')], rounds: 1, permanentBuffs: [], bonus: { gold: 0, rerolls: 0, discount: 0 }, ...extra,
});
const at = (over: Partial<RunState> = {}): RunState => ({ ...newRun('res', data), phase: 'battle', ...over });

describe('applyBattleResult', () => {
  it('胜 +1 热搜，负 -1 信心，和局不变', () => {
    expect(applyBattleResult(at(), res('me'), data)).toMatchObject({ trophies: 1, lives: 5, phase: 'result' });
    expect(applyBattleResult(at(), res('enemy'), data)).toMatchObject({ trophies: 0, lives: 4 });
    expect(applyBattleResult(at(), res('draw'), data)).toMatchObject({ trophies: 0, lives: 5 });
  });
  it('回合 ≥ 12（DIFFICULTY.lateGameTurn）输一场掉 2 信心', () => {
    expect(livesLostOnDefeat(11)).toBe(1);
    expect(livesLostOnDefeat(12)).toBe(2);
    expect(applyBattleResult(at({ turn: 11 }), res('enemy'), data).lives).toBe(4);
    expect(applyBattleResult(at({ turn: 12 }), res('enemy'), data).lives).toBe(3);
  });
  it('热搜 = 10 登顶', () => {
    expect(applyBattleResult(at({ trophies: 9 }), res('me'), data)).toMatchObject({ phase: 'over', won: true, endReason: 'trophies', trophies: 10 });
  });
  it('信心归零出局（不会变负数）', () => {
    expect(applyBattleResult(at({ lives: 1, turn: 12 }), res('enemy'), data)).toMatchObject({ phase: 'over', won: false, endReason: 'lives', lives: 0 });
  });
  it('回合 20 兜底：按热搜结算', () => {
    const s = applyBattleResult(at({ turn: 20, trophies: 7 }), res('me'), data);
    expect(s).toMatchObject({ phase: 'over', won: false, endReason: 'turnLimit', trophies: 8 });
    expect(shopAction(s, { type: 'continue' }, data).error).toBeTruthy();
  });
  it('记录历史，清除临时加成与护盾，写回永久 buff 与战斗收益', () => {
    const u = mk('wrapper', { tempAtk: 2, tempHp: 1, shield: 3 });
    const s0 = setTeam(at(), [u]);
    const s = applyBattleResult(s0, res('me', { permanentBuffs: [{ uid: u.uid, atk: 1, hp: 2 }], bonus: { gold: 2, rerolls: 1, discount: 1 } }), data);
    expect(s.team[0]).toMatchObject({ atk: 3, hp: 4, tempAtk: 0, tempHp: 0, shield: 0 });
    expect(s.history).toHaveLength(1);
    expect(s.history[0]).toMatchObject({ turn: 1, winner: 'me', trophies: 1, lives: 5, myTeam: [{ defId: 'wrapper', atk: 4, hp: 3, level: 1 }] });
    const n = shopAction({ ...s, surprisePending: false }, { type: 'continue' }, data);
    expect(n.gold).toBe(12);
    expect(n.modifiers.freeRerolls).toBe(1);
    expect(n.modifiers.unitPriceMod).toBe(-1);
  });
});
