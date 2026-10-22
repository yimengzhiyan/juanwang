import { describe, expect, it } from 'vitest';
import { custom, data, mk, setTeam } from './helpers';
import { newRun, shopAction } from '../src/engine/shop';
import { applyBattleResult, SURPRISE_CHANCE } from '../src/engine/result';
import { battleForState } from '../src/engine/helpers';
import type { BattleResult, EventEffect, GameData, HeadlineDef, RunState } from '../src/types';

const res = (winner: BattleResult['winner'], extra: Partial<BattleResult> = {}): BattleResult => ({
  winner, events: [], enemyTeam: [], rounds: 1, permanentBuffs: [], bonus: { gold: 0, rerolls: 0, discount: 0 }, ...extra,
});
const base = (): RunState => setTeam(newRun('ev', data), [mk('wrapper'), mk('qwen_chan'), mk('crawler', { level: 2, xp: 2, atk: 4, hp: 4 })]);
const choose = (effect: EventEffect, s0: RunState = base(), d: GameData = data) => {
  const h: HeadlineDef = { id: 'x', title: 't', news: 'n', options: [{ label: 'a', effect }, { label: 'b', effect: { type: 'gold', amount: 0 } }] };
  const s = shopAction({ ...s0, phase: 'headline', pendingHeadline: h }, { type: 'chooseHeadline', option: 0 }, d);
  expect(s.error).toBeUndefined();
  expect(s.phase).toBe('shop');
  return s;
};
const team = (s: RunState) => s.team.filter(Boolean).map((u) => u!);
/** 打完当前回合（和局）并进入下一回合商店 */
const nextTurn = (s: RunState) => {
  let n = shopAction(s, { type: 'endShop' }, data);
  n = applyBattleResult(n, res('draw'), data);
  n = { ...n, lastSurprise: undefined, surprisePending: false };
  n = shopAction(n, { type: 'continue' }, data);
  if (n.phase === 'headline') n = shopAction(n, { type: 'chooseHeadline', option: 0 }, data);
  return n;
};

describe('头条出现时机', () => {
  it('偶数回合商店前出现头条，二选一后进商店；奇数回合没有', () => {
    let s = newRun('h', data);
    expect(s.phase).toBe('shop');
    s = shopAction(s, { type: 'endShop' }, data);
    s = applyBattleResult(s, res('draw'), data);
    s = shopAction({ ...s, surprisePending: false }, { type: 'continue' }, data);
    expect(s.turn).toBe(2);
    expect(s.phase).toBe('headline');
    expect(s.pendingHeadline).toBeDefined();
    expect(shopAction(s, { type: 'buy', slot: 0 }, data).error).toBeTruthy();
    s = shopAction(s, { type: 'chooseHeadline', option: 1 }, data);
    expect(s.phase).toBe('shop');
    expect(s.pendingHeadline).toBeUndefined();
    s = nextTurn(s);
    expect(s.turn).toBe(3);
    expect(s.seenHeadlines).toHaveLength(1);
  });
});

describe('EventEffect 每种效果', () => {
  it('gold', () => expect(choose({ type: 'gold', amount: 3 }).gold).toBe(13));
  it('priceMod（基建）', () => {
    const s = choose({ type: 'priceMod', target: 'item', amount: 1 });
    const it0 = s.shop.find((x) => x.kind === 'item')!;
    expect(it0.price).toBe(data.itemsById[it0.defId].price + 1);
    expect(s.shop.find((x) => x.kind === 'unit')!.price).toBe(3);
  });
  it('freeUnit（限阵营）', () => {
    const s = choose({ type: 'freeUnit', faction: 'open' });
    const f = s.shop.filter((x) => x.free);
    expect(f).toHaveLength(1);
    expect(f[0].price).toBe(0);
    expect(data.unitsById[f[0].defId].faction).toBe('open');
    const s2 = shopAction(s, { type: 'buy', slot: s.shop.indexOf(s.shop.find((x) => x.free)!) }, data);
    expect(s2.gold).toBe(10);
  });
  it('freeUnit（限阶级）', () => {
    const s = choose({ type: 'freeUnit', tier: 4 });
    expect(data.unitsById[s.shop.find((x) => x.free)!.defId].tier).toBe(4);
  });
  it('buffTeam 永久 / 临时', () => {
    expect(team(choose({ type: 'buffTeam', atk: 1, hp: 2, permanent: true })).map((u) => [u.atk, u.hp])).toEqual([[3, 4], [3, 6], [5, 6]]);
    const t = team(choose({ type: 'buffTeam', atk: -5, hp: 1, permanent: false }));
    expect(t.every((u) => u.atk + u.tempAtk === 0 && u.tempHp === 1)).toBe(true);
  });
  it('buffFaction 只加该阵营', () => {
    const t = team(choose({ type: 'buffFaction', faction: 'open', atk: 1, hp: 1, permanent: true }));
    expect(t[1]).toMatchObject({ defId: 'qwen_chan', atk: 3, hp: 5 });
    expect(t[0]).toMatchObject({ atk: 2, hp: 2 });
  });
  it('shopRerollFree', () => {
    let s = choose({ type: 'shopRerollFree' });
    s = shopAction(s, { type: 'reroll' }, data);
    s = shopAction(s, { type: 'reroll' }, data);
    expect(s.gold).toBe(10);
  });
  it('extraSlot：本回合多一格（刷新也保持），下回合恢复', () => {
    let s = choose({ type: 'extraSlot', amount: 1 });
    expect(s.shop.filter((x) => x.kind === 'unit')).toHaveLength(4);
    s = shopAction(s, { type: 'reroll' }, data);
    expect(s.shop.filter((x) => x.kind === 'unit')).toHaveLength(4);
    s = nextTurn(s);
    expect(s.modifiers.extraUnitSlots).toBe(0);
  });
  it('shieldAll', () => expect(team(choose({ type: 'shieldAll', amount: 2 })).every((u) => u.shield === 2)).toBe(true));
  it('swapAll：商店阶段不改队形，记为本场战斗开始时反转（DESIGN 11.5）', () => {
    let s = choose({ type: 'swapAll' });
    expect(s.team.map((u) => u?.defId ?? null)).toEqual(['wrapper', 'qwen_chan', 'crawler', null, null]);
    expect(s.modifiers.battleSwapAll).toBe(1);
    s = shopAction(s, { type: 'endShop' }, data);
    const r = battleForState(s, [mk('gpt_chan')], data);
    const atk = r.events.find((e) => e.type === 'attack');
    expect(atk && atk.type === 'attack' && atk.me.defId).toBe('crawler');
    expect(r.events.findIndex((e) => e.type === 'move')).toBe(1);
  });
  it('duplicate：复制一个随机单位到空位', () => {
    const s = choose({ type: 'duplicate' });
    const t = team(s);
    expect(t).toHaveLength(4);
    const copy = s.team[3]!;
    const src = t.slice(0, 3).find((u) => u.defId === copy.defId)!;
    expect(copy).toMatchObject({ atk: src.atk, hp: src.hp, level: src.level });
    expect(copy.uid).not.toBe(src.uid);
  });
  it('sacrifice：失去最低阶（同阶取低等级）单位换算力', () => {
    const s = choose({ type: 'sacrifice', amount: 4 });
    expect(s.gold).toBe(14);
    expect(team(s).map((u) => u.defId)).toEqual(['qwen_chan', 'crawler']);
  });
  it('nextTurnGold：下回合算力 +n', () => {
    let s = choose({ type: 'nextTurnGold', amount: 3 });
    expect(s.gold).toBe(10);
    s = nextTurn(s);
    expect(s.gold).toBeGreaterThanOrEqual(13);
  });
  it('enemyDebuff：本回合敌方攻击 -n', () => {
    let s = choose({ type: 'enemyDebuff', amount: 2 });
    expect(s.modifiers.enemyAtkDebuff).toBe(2);
    s = shopAction(s, { type: 'endShop' }, data);
    const r = battleForState(s, [mk('big_enemy_dummy' in data.unitsById ? 'x' : 'gpt_chan')], data);
    const atk = r.events.find((e) => e.type === 'attack');
    expect(atk && atk.type === 'attack' && atk.enemy.atk).toBe(4);
    s = nextTurn({ ...s, phase: 'shop' });
    expect(s.modifiers.enemyAtkDebuff).toBe(0);
  });
  it('rerollShop：立即免费刷新', () => {
    const before = base();
    const s = choose({ type: 'rerollShop' }, before);
    expect(s.gold).toBe(10);
    expect(JSON.stringify(s.shop)).not.toBe(JSON.stringify(before.shop));
  });
  it('levelUpRandom：随机一个未满级单位 +1 级', () => {
    const before = base();
    const s = choose({ type: 'levelUpRandom' }, before);
    const sum = (x: RunState) => team(x).reduce((a, u) => a + u.level, 0);
    expect(sum(s)).toBe(sum(before) + 1);
    expect(s.shop.some((x) => x.free)).toBe(true);
  });
  it('lifeTrade：失去 1 信心换算力与 1 次免费刷新；只剩 1 信心时不生效', () => {
    const s = choose({ type: 'lifeTrade', amount: 4 });
    expect(s).toMatchObject({ lives: 4, gold: 14 });
    expect(s.modifiers.freeRerolls).toBe(1);
    const s2 = choose({ type: 'lifeTrade', amount: 4 }, { ...base(), lives: 1 });
    expect(s2).toMatchObject({ lives: 1, gold: 10 });
  });
});

describe('突发', () => {
  const afterBattle = (seed: string, turn = 1, d: GameData = data) => {
    const s = { ...newRun(seed, d), turn, phase: 'battle' as const };
    return applyBattleResult(s, res('draw'), d);
  };
  it(`奇数回合结算后约 ${SURPRISE_CHANCE * 100}% 概率（固定种子可重放）`, () => {
    let hits = 0;
    const N = 1000;
    for (let i = 0; i < N; i++) if (afterBattle(`sp${i}`).lastSurprise) hits++;
    expect(hits / N).toBeGreaterThan(0.25);
    expect(hits / N).toBeLessThan(0.35);
    // 固定种子：结果固定
    const a = afterBattle('sp7');
    const b = afterBattle('sp7');
    expect(a.lastSurprise?.id).toBe(b.lastSurprise?.id);
    expect(a.rng).toBe(b.rng);
  });
  it('偶数回合不出突发', () => {
    for (let i = 0; i < 100; i++) expect(afterBattle(`even${i}`, 2).lastSurprise).toBeUndefined();
  });
  it('突发在下一回合开始时生效（gold +2 → 12 算力）', () => {
    const d = custom({ surprises: [{ id: 's_gold', title: '爆款', news: '', effect: { type: 'gold', amount: 2 }, good: true }] });
    let s: RunState | undefined;
    for (let i = 0; i < 50 && !s; i++) {
      const x = afterBattle(`g${i}`, 1, d);
      if (x.lastSurprise) s = x;
    }
    expect(s).toBeDefined();
    expect(s!.surprisePending).toBe(true);
    expect(s!.phase).toBe('result');
    const n = shopAction(s!, { type: 'continue' }, d);
    expect(n.turn).toBe(2);
    expect(n.gold).toBe(12);
    expect(n.surprisePending).toBe(false);
    expect(n.lastSurprise?.id).toBe('s_gold');
  });
});
