import { describe, expect, it } from 'vitest';
import { data } from './helpers';
import { newRun, shopAction } from '../src/engine/shop';
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
  expect([null, 'done']).toContain(tutorialStep(s));
  const enemy = tutorialEnemy(s, data)!;
  expect(enemy).not.toBeNull();
  s = applyBattleResult(s, battleForState(s, enemy, data), data);
  return act(s, { type: 'continue' });
};

describe('新手引导局', () => {
  it('非引导局 tutorialStep 为 null', () => {
    expect(tutorialStep(newRun('x', data))).toBeNull();
  });
  it('固定商店、固定对手、7 步提示依次推进', () => {
    let s = newRun('ignored', data, { tutorial: true });
    const tut = data.tutorial!;
    expect(s.seed).toBe(tut.seed);
    expect(s.shop.map((x) => x.defId)).toEqual([...tut.turns[0].units, ...tut.turns[0].items!]);
    expect(tutorialStep(s)).toBe('buy');
    s = act(s, { type: 'buy', slot: 0 });
    expect(tutorialStep(s)).toBe('buyAgain');
    s = act(s, { type: 'buy', slot: 0 });
    expect(tutorialStep(s)).toBe('fight');
    expect(tutorialEnemy(s, data)!.map((u) => u.defId)).toEqual(['token_shuijun']);
    s = fight(s);
    // 回合 2：引导局不在回合 2 出头条
    expect(s.turn).toBe(2);
    expect(s.phase).toBe('shop');
    expect(s.shop.map((x) => x.defId)).toEqual([...tut.turns[1].units, ...tut.turns[1].items!]);
    expect(tutorialStep(s)).toBe('merge');
    s = act(s, { type: 'buy', slot: 0 });
    expect(s.team[0]?.level).toBe(2);
    expect(tutorialStep(s)).toBe('item');
    const itemIdx = s.shop.findIndex((x) => x.kind === 'item');
    s = act(s, { type: 'useItem', slot: itemIdx, target: 0 });
    expect(tutorialStep(s)).toBe('freezeSell');
    s = act(s, { type: 'freeze', slot: 0 });
    expect(tutorialStep(s)).toBe('freezeSell');
    s = act(s, { type: 'buy', slot: s.shop.findIndex((x) => !x.frozen && x.kind === 'unit') });
    s = act(s, { type: 'sell', index: s.team.findIndex((u, i) => i > 0 && u) });
    expect(tutorialStep(s)).toBe('fight');
    s = fight(s);
    // 回合 3：固定头条
    expect(s.turn).toBe(3);
    expect(s.phase).toBe('headline');
    expect(s.pendingHeadline?.id).toBe(tut.headline);
    expect(tutorialStep(s)).toBe('headline');
    s = act(s, { type: 'chooseHeadline', option: 0 });
    expect(tutorialStep(s)).toBe('done');
    // 回合 3 商店：冻结的槽 + 固定内容
    expect(s.shop.some((x) => x.frozen)).toBe(true);
    for (const id of tut.turns[2].units) expect(s.shop.some((x) => x.defId === id)).toBe(true);
    s = fight(s);
    // 回合 4 之后恢复正常：偶数回合出头条，对手改用机器人
    expect(s.turn).toBe(4);
    expect(s.phase).toBe('headline');
    expect(tutorialEnemy(s, data)).toBeNull();
    expect(offlineOpponent(s, data).length).toBeGreaterThan(0);
  });
});
