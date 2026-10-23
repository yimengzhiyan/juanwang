import { describe, expect, it } from 'vitest';
import { data } from './helpers';
import { newRun, shopAction } from '../src/engine/run';
import { applyBattleResult } from '../src/engine/result';
import { battleForState } from '../src/engine/helpers';
import { offlineOpponent, tutorialEnemy, tutorialStep } from '../src/tutorial';
import type { RunState, ShopActionInput } from '../src/types';

const act = (s: RunState, a: ShopActionInput) => {
  const n = shopAction(s, a, data);
  expect(n.error, a.type).toBeUndefined();
  return n;
};
const fight = (s: RunState) => {
  s = act(s, { type: 'endShop' });
  expect(tutorialStep(s, data)).toBeNull();
  s = applyBattleResult(s, battleForState(s, data), data);
  if (s.pending) s = act(s, { type: 'choosePveReward', index: 0 });
  return act({ ...s, surprisePending: false }, { type: 'continue' });
};

describe('新手引导局（2.0：buy → fight → equip → merge → synergy → fight → headline → fight → done）', () => {
  it('非引导局 tutorialStep 为 null', () => {
    expect(tutorialStep(newRun('x', data, { arena: null }))).toBeNull();
  });
  it('固定商店（单位 + 装备 + 消耗品）、固定对手、按 order 推进', () => {
    const tut = data.tutorial!;
    let s = newRun('ignored', data, { tutorial: true });
    expect(s).toMatchObject({ seed: tut.seed, phase: 'shop', turn: 1 });
    expect(s.arena).toBeUndefined();
    expect(s.shop.map((x) => x.defId)).toEqual([...tut.turns[0].units, ...tut.turns[0].items!]);
    expect(tutorialStep(s, data)).toBe('buy');
    s = act(s, { type: 'buy', slot: 0 });
    expect(tutorialStep(s, data)).toBe('fight');
    s = act(s, { type: 'buy', slot: s.shop.findIndex((x) => x.defId === 'crawler') });
    expect(s.tutorial!.synergy).toBe(true); // 提示词工程师 + 数据爬虫 = 工程师 ×2
    s = act(s, { type: 'endShop' });
    expect(s.matchup!.team.map((u) => u.defId)).toEqual(['token_shuijun']);
    s = applyBattleResult(s, battleForState(s, data), data);
    s = act({ ...s, surprisePending: false }, { type: 'continue' });
    // 回合 2：引导局不在回合 2 出头条
    expect(s).toMatchObject({ turn: 2, phase: 'shop' });
    expect(s.shop.map((x) => x.defId)).toEqual([...tut.turns[1].units, ...tut.turns[1].items!]);
    expect(tutorialStep(s, data)).toBe('equip');
    s = act(s, { type: 'equip', slot: s.shop.findIndex((x) => x.kind === 'equip'), unitIndex: 0 });
    expect(tutorialStep(s, data)).toBe('merge');
    s = act(s, { type: 'buy', slot: 0 });
    s = act(s, { type: 'buy', slot: 0 });
    expect(s.team[0]?.level).toBe(2);
    expect(tutorialStep(s, data)).toBe('fight');
    s = fight(s);
    expect(s).toMatchObject({ turn: 3, phase: 'headline' });
    expect(s.pendingHeadline?.id).toBe(tut.headline);
    expect(tutorialStep(s, data)).toBe('headline');
    s = act(s, { type: 'chooseHeadline', option: 0 });
    expect(tutorialStep(s, data)).toBe('fight');
    s = fight(s);
    expect(tutorialStep(s, data)).toBe('done');
    // 之后恢复正常：对手来自 8 人房 / PVE
    expect(tutorialEnemy(s, data)).toBeNull();
    s = act(s.phase === 'headline' ? act(s, { type: 'chooseHeadline', option: 0 }) : s, { type: 'endShop' });
    expect(offlineOpponent(s).length).toBeGreaterThan(0);
  });
});
