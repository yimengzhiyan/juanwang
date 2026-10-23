import { describe, expect, it } from 'vitest';
import { data, mk, res, setTeam, start } from './helpers';
import { shopAction } from '../src/engine/run';
import { applyBattleResult } from '../src/engine/result';
import { battleForState } from '../src/engine/helpers';
import type { RunState } from '../src/types';

/** 直接跳到 PVE 回合（第 4 回合）的商店 */
const atTurn4 = (seed = 'p'): RunState => {
  const s = setTeam(start(seed), [mk('agi', { atk: 30, hp: 30 }), mk('kimi')]);
  return { ...s, turn: 4 };
};

describe('PVE 怪物回合（12.7）', () => {
  it('第 4 回合对手是幻觉大军（6 个 2/2，阵亡分裂）', () => {
    const s = shopAction(atTurn4(), { type: 'endShop' }, data);
    expect(s.matchup).toMatchObject({ kind: 'pve', opponentId: 'pve_halluc' });
    expect(s.matchup!.team.map((u) => `${u.defId}:${u.atk}/${u.hp}`)).toEqual(Array(6).fill('mob_halluc:2/2'));
    const r = battleForState(s, data);
    expect(r.events.some((e) => e.type === 'summon' && e.unit.defId === 'mob_halluc_mini')).toBe(true);
  });
  it('第 9 回合是老黄的显卡军团：Boss 每次攻击前对我方全体 1 伤害', () => {
    const s = shopAction({ ...atTurn4(), turn: 9 }, { type: 'endShop' }, data);
    expect(s.matchup!.opponentId).toBe('pve_huang');
    const r = battleForState(s, data);
    const boss = r.events.find((e) => e.type === 'ability' && e.unit.defId === 'boss_huang');
    expect(boss).toBeTruthy();
  });
  it('输了不扣热度；赢了三选一（pending），选完才能 continue', () => {
    const s = shopAction(atTurn4(), { type: 'endShop' }, data);
    const lose = applyBattleResult(s, res('enemy', { survivors: 6 }), data);
    expect(lose.hp).toBe(20);
    expect(lose.pending).toBeUndefined();
    expect(lose.pve).toMatchObject({ pveId: 'pve_halluc', won: false });
    const win = applyBattleResult(s, res('me', { survivors: 2 }), data);
    expect(win.pending?.type).toBe('pveReward');
    expect(win.pending!.options.map((o) => o.type).sort()).toEqual(['equip', 'gold', 'unit']);
    expect(win.lastEvents.find((e) => e.type === 'pveReward')).toBeTruthy();
    expect(win.stats.pveWins).toBe(1);
    expect(shopAction(win, { type: 'continue' }, data).error).toBe('先选择奖励');
    expect(shopAction(win, { type: 'choosePveReward', index: 5 }, data).error).toBe('没有这个选项');
  });
  it('奖励：高一阶单位 / 金色装备 → 商店免费槽（冻结，下回合还在）；+6 算力 → 下回合到账', () => {
    const win = applyBattleResult(shopAction(atTurn4(), { type: 'endShop' }, data), res('me'), data);
    const pick = (type: string) => {
      const i = win.pending!.options.findIndex((o) => o.type === type);
      let n = shopAction(win, { type: 'choosePveReward', index: i }, data);
      expect(n.pending).toBeUndefined();
      n = shopAction({ ...n, surprisePending: false }, { type: 'continue' }, data);
      if (n.phase === 'headline') n = shopAction(n, { type: 'chooseHeadline', option: 0 }, data);
      return n;
    };
    const u = pick('unit');
    const unitOpt = win.pending!.options.find((o) => o.type === 'unit')!;
    const slot = u.shop.find((x) => x.freeReason === 'pve')!;
    expect(slot).toMatchObject({ kind: 'unit', price: 0, defId: unitOpt.type === 'unit' ? unitOpt.defId : '' });
    expect(data.unitsById[slot.defId].tier).toBe(3); // 回合 4 最高 T2 → 高一阶
    const e = pick('equip');
    expect(e.shop.find((x) => x.freeReason === 'pve')).toMatchObject({ kind: 'equip', gold: true, price: 0 });
    const g = pick('gold');
    expect(g.gold).toBeGreaterThanOrEqual(16);
  });
  it('对手同回合也打 PVE（只模拟，不扣血）', () => {
    const s = shopAction(atTurn4(), { type: 'endShop' }, data);
    const n = applyBattleResult(s, res('draw'), data);
    expect(n.opponents.every((o) => o.lastResult === 'pve' && o.hp === 20)).toBe(true);
  });
});
