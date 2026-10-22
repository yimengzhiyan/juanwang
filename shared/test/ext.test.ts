// DESIGN 第 11 节：技能系统扩展
import { describe, expect, it } from 'vitest';
import { custom, data, mk, plain, raw, setTeam, withAb } from './helpers';
import { simulateBattle } from '../src/engine/battle';
import { newRun, shopAction } from '../src/engine/shop';
import { validateData } from '../src/data';
import type { BattleEvent, BattleResult, HeadlineDef, RunState, ShopSlot } from '../src/types';

const d = custom({
  units: [
    plain('o1', 1, 5, { faction: 'open', tier: 1 }), plain('c3', 1, 5, { faction: 'closed', tier: 3 }), plain('k5', 1, 9, { faction: 'compute', tier: 5 }),
    plain('fat', 1, 10, { faction: 'closed' }), plain('thin', 1, 3, { faction: 'compute' }), plain('tank', 1, 50, { faction: 'open' }),
    withAb('fbuff', 1, 5, { trigger: 'startBattle', effect: 'buff', target: 'allFriends', amount: 1, filter: { faction: 'closed' } }, { faction: 'folk' }),
    withAb('ftier', 1, 5, { trigger: 'startBattle', effect: 'damage', target: 'allEnemies', amount: 1, filter: { minTier: 3, maxTier: 4 } }, { faction: 'folk' }),
    withAb('eater', 2, 2, { trigger: 'startBattle', effect: 'copyStats', target: 'backFriend', consume: true, amount: 1 }, { faction: 'folk' }),
    withAb('snipe', 1, 5, { trigger: 'startBattle', effect: 'destroy', target: 'frontEnemy', maxHp: 3, maxHpPerLevel: 2 }, { faction: 'folk' }),
    withAb('form', 1, 5, { trigger: 'startBattle', effect: 'buff', target: 'self', choices: [{ atk: 2, hp: 0, desc: '日' }, { atk: 0, hp: 2, desc: '月' }] }, { faction: 'folk' }),
    withAb('formShop', 1, 5, { trigger: 'startTurn', effect: 'buff', target: 'self', choices: [{ atk: 2, hp: 0 }, { atk: 0, hp: 2 }, { effect: 'discount', amount: 1 }] }, { faction: 'folk' }),
    withAb('shopEat', 1, 1, { trigger: 'buy', effect: 'copyStats', target: 'lowestHpFriend', consume: true }, { faction: 'folk' }),
    withAb('shopPull', 1, 1, { trigger: 'buy', effect: 'pullFront', target: 'self' }, { faction: 'folk' }),
  ],
});
const u = (id: string, over = {}) => mk(id, over, d);
const of = <T extends BattleEvent['type']>(r: BattleResult, t: T) => r.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);

describe('11.1 target.filter', () => {
  it('按阵营筛选友军', () => {
    const r = simulateBattle([u('fbuff'), u('fat'), u('thin')], [u('tank')], d, 's');
    const ab = of(r, 'ability')[0];
    expect(ab.targets.map((t) => t.defId)).toEqual(['fat']);
  });
  it('按阶级范围筛选敌人', () => {
    const r = simulateBattle([u('ftier')], [u('o1'), u('c3'), u('k5')], d, 's');
    expect(of(r, 'ability')[0].targets.map((t) => t.defId)).toEqual(['c3']);
  });
  it('筛选后为空则不生效', () => {
    const r = simulateBattle([u('fbuff'), u('thin')], [u('tank')], d, 's');
    expect(of(r, 'ability')[0].targets).toEqual([]);
    expect(of(r, 'buff')).toHaveLength(0);
  });
});

describe('11.2 copyStats consume', () => {
  it('战斗中：取较高值 + amount，并吞并目标', () => {
    const r = simulateBattle([u('eater'), u('thin'), u('fat')], [u('tank')], d, 's');
    expect(of(r, 'buff')[0]).toMatchObject({ newAtk: 3, newHp: 11 });
    const f = of(r, 'faint')[0];
    expect(f).toMatchObject({ unit: { defId: 'fat' }, consumed: true, killer: { defId: 'eater' } });
    expect(of(r, 'start')[0].me).toHaveLength(3);
    expect(of(r, 'attack')[0].me.defId).toBe('eater');
  });
});

describe('11.3 destroy maxHp', () => {
  it('目标血量 ≤ 阈值直接击杀，否则造成阈值点伤害；阈值按等级增加', () => {
    const r1 = simulateBattle([u('snipe')], [u('thin'), u('tank')], d, 's');
    expect(of(r1, 'faint')[0].unit.defId).toBe('thin');
    const r2 = simulateBattle([u('snipe')], [u('fat'), u('tank')], d, 's');
    expect(of(r2, 'damage')[0]).toMatchObject({ unit: { defId: 'fat' }, amount: 3, kind: 'ability' });
    const r3 = simulateBattle([u('snipe', { level: 3 })], [u('k5'), u('tank')], d, 's'); // 阈值 3+4=7 < 9
    expect(of(r3, 'damage')[0]).toMatchObject({ amount: 7 });
    const r4 = simulateBattle([u('snipe', { level: 3 })], [u('fat', { hp: 7 }), u('tank')], d, 's');
    expect(of(r4, 'faint')[0].unit.defId).toBe('fat');
  });
});

describe('11.4 effects 数组', () => {
  it('头条选项按顺序结算多个效果；旧的单 effect 仍可用', () => {
    const h: HeadlineDef = {
      id: 'multi', title: 't', news: 'n',
      options: [
        { label: 'a', effect: { type: 'gold', amount: 1 }, effects: [{ type: 'gold', amount: 1 }, { type: 'nextTurnGold', amount: 2 }, { type: 'shieldAll', amount: 1 }] },
        { label: 'b', effect: { type: 'gold', amount: 5 } },
      ],
    };
    const base = setTeam(newRun('m', data), [mk('wrapper')]);
    const s = shopAction({ ...base, phase: 'headline', pendingHeadline: h }, { type: 'chooseHeadline', option: 0 }, data);
    expect(s.gold).toBe(11);
    expect(s.modifiers.nextTurnGold).toBe(2);
    expect(s.team[0]?.shield).toBe(1);
    expect(shopAction({ ...base, phase: 'headline', pendingHeadline: h }, { type: 'chooseHeadline', option: 1 }, data).gold).toBe(15);
  });
  it('validateData：effects 数组规范化，effect = 第一个；旧数据 effects = [effect]', () => {
    const headlines = structuredClone(raw.headlines) as any[];
    headlines[0].options[0] = { label: 'x', effects: [{ type: 'gold', amount: 2 }, { type: 'swapAll' }] };
    const surprises = structuredClone(raw.surprises) as any[];
    surprises[0] = { ...surprises[0], effect: undefined, effects: [{ type: 'gold', amount: 1 }, { type: 'rerollShop' }] };
    const v = validateData({ ...raw, headlines, surprises });
    expect(v.headlines[0].options[0].effect).toEqual({ type: 'gold', amount: 2 });
    expect(v.headlines[0].options[0].effects).toHaveLength(2);
    expect(v.headlines[1].options[0].effects).toEqual([v.headlines[1].options[0].effect]);
    expect(v.surprises[0].effects).toHaveLength(2);
    expect(() => validateData({ ...raw, headlines: [{ ...headlines[0], options: [{ label: 'x', effects: [{ type: 'bogus' }] }, headlines[0].options[1]] }] })).toThrow(/bogus/);
  });
});

describe('11.5 商店阶段 pullFront / swapAll 延迟到开战', () => {
  it('技能 pullFront 在商店阶段只记修正器', () => {
    const shop: ShopSlot[] = [{ kind: 'unit', defId: 'shopPull', price: 3, frozen: false }];
    let s: RunState = setTeam({ ...newRun('p', d), shop }, [u('fat'), u('thin')]);
    s = shopAction(s, { type: 'buy', slot: 0 }, d);
    expect(s.team[2]?.defId).toBe('shopPull');
    expect(s.modifiers.battlePullFront).toEqual([s.team[2]!.uid]);
  });
});

describe('11.2 商店阶段吞并 / 11.8 随机形态', () => {
  it('商店：被购买时吞并血最少的友军', () => {
    const shop: ShopSlot[] = [{ kind: 'unit', defId: 'shopEat', price: 3, frozen: false }];
    let s: RunState = setTeam({ ...newRun('e', d), shop }, [u('fat'), u('thin')]);
    s = shopAction(s, { type: 'buy', slot: 0 }, d);
    const team = s.team.filter(Boolean);
    expect(team.map((x) => x!.defId).sort()).toEqual(['fat', 'shopEat']);
    expect(s.team[2]).toMatchObject({ defId: 'shopEat', atk: 1, hp: 3 });
  });
  it('战斗：choices 随机选一种形态（确定性，且两种都会出现）', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const r = simulateBattle([u('form')], [u('tank')], d, `f${i}`);
      seen.add(of(r, 'ability')[0].text);
      expect(simulateBattle([u('form', { uid: 'x' })], [u('tank', { uid: 'y' })], d, `f${i}`)).toEqual(simulateBattle([u('form', { uid: 'x' })], [u('tank', { uid: 'y' })], d, `f${i}`));
    }
    expect([...seen].sort()).toEqual(['form：日', 'form：月']);
  });
  it('商店：startTurn + choices（+2 攻 / +2 血 / 降价）', () => {
    const outcomes = new Set<string>();
    for (let i = 0; i < 40; i++) {
      let s = setTeam(newRun(`g${i}`, d), [u('formShop')]);
      s = shopAction(s, { type: 'endShop' }, d);
      s = shopAction({ ...s, phase: 'result' }, { type: 'continue' }, d);
      if (s.phase === 'headline') s = shopAction(s, { type: 'chooseHeadline', option: 1 }, d);
      const x = s.team[0]!;
      outcomes.add(x.tempAtk === 2 ? 'atk' : x.tempHp === 2 ? 'hp' : s.modifiers.unitPriceMod === -1 ? 'discount' : 'none');
    }
    expect([...outcomes].sort()).toEqual(['atk', 'discount', 'hp']);
  });
  it('validateData 校验 choices 与 filter', () => {
    const units = structuredClone(raw.units) as any[];
    units[0].ability = { ...units[0].ability, filter: { faction: '闭源', minTier: 2 }, choices: [{ atk: 2 }, { effect: 'discount', amount: 1 }] };
    const v = validateData({ ...raw, units });
    expect(v.units[0].ability).toMatchObject({ filter: { faction: 'closed', minTier: 2 }, choices: [{ atk: 2 }, { effect: 'discount', amount: 1 }] });
    units[0].ability.choices = [{ effect: 'nope' }];
    units[0].ability.filter = { maxTier: 9 };
    expect(() => validateData({ ...raw, units })).toThrow(/nope[\s\S]*maxTier|maxTier[\s\S]*nope/);
  });
});

describe('目标细节', () => {
  it('adjacentFriends 按站位取邻居，再按 filter 过滤；swapPosition 不会选中自己', () => {
    const dd = custom({
      base: d,
      units: [
        withAb('adjF', 1, 5, { trigger: 'startBattle', effect: 'buff', target: 'adjacentFriends', amount: 1, filter: { faction: 'closed' } }, { faction: 'folk' }),
        withAb('swapLow', 1, 1, { trigger: 'startBattle', effect: 'swapPosition', target: 'lowestHpFriend' }, { faction: 'folk' }),
      ],
    });
    const r = simulateBattle([mk('thin', {}, dd), mk('adjF', {}, dd), mk('fat', {}, dd)], [mk('tank', {}, dd)], dd, 's');
    expect(of(r, 'ability')[0].targets.map((t) => t.defId)).toEqual(['fat']);
    const r2 = simulateBattle([mk('swapLow', {}, dd), mk('fat', {}, dd), mk('thin', {}, dd)], [mk('tank', {}, dd)], dd, 's');
    expect(of(r2, 'move')[0]).toMatchObject({ from: 0, to: 2 });
  });
});
