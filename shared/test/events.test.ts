import { describe, expect, it } from 'vitest';
import { custom, data, mk, of, res, setTeam, start } from './helpers';
import { shopAction } from '../src/engine/run';
import { applyBattleResult } from '../src/engine/result';
import { battleForState } from '../src/engine/helpers';
import { DIFFICULTY } from '../src/engine/difficulty';
import type { EventEffect, GameData, HeadlineDef, RunState, UnitInst } from '../src/types';
import { baseGoldForTurn } from '../src/engine/shop';
/** 第 1 / 第 2 回合的基础算力（起始算力曲线） */
const G1 = baseGoldForTurn(1);
const G2 = baseGoldForTurn(2);

const base = (): RunState => setTeam(start('ev'), [mk('wrapper'), mk('qwen_chan'), mk('crawler', { level: 2, xp: 2, atk: 4, hp: 4 })]);
const choose = (effect: EventEffect | EventEffect[], s0: RunState = base(), d: GameData = data) => {
  const effects = Array.isArray(effect) ? effect : [effect];
  const h: HeadlineDef = { id: 'x', title: 't', news: 'n', options: [{ label: 'a', effect: effects[0], effects }, { label: 'b', effect: { type: 'gold', amount: 0 } }] };
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
/** 选完头条后直接开战（敌方阵容指定） */
const battle = (s: RunState, enemy: UnitInst[]) => battleForState(shopAction(s, { type: 'endShop' }, data), data, enemy);

describe('头条出现时机', () => {
  it('偶数回合商店前出现头条，二选一后进商店；奇数回合没有', () => {
    let s = start('h');
    expect(s.phase).toBe('shop');
    s = shopAction(s, { type: 'endShop' }, data);
    s = applyBattleResult(s, res('draw'), data);
    s = shopAction({ ...s, surprisePending: false }, { type: 'continue' }, data);
    expect(s.turn).toBe(2);
    expect(s.phase).toBe('headline');
    expect(shopAction(s, { type: 'buy', slot: 0 }, data).error).toBeTruthy();
    s = shopAction(s, { type: 'chooseHeadline', option: 1 }, data);
    expect(s.phase).toBe('shop');
    s = nextTurn(s);
    expect(s.turn).toBe(3);
    expect(s.seenHeadlines).toHaveLength(1);
  });
});

describe('1.0 事件效果（沿用）', () => {
  it('gold / priceMod（item = 装备与消耗品）', () => {
    expect(choose({ type: 'gold', amount: 3 }).gold).toBe(G1 + 3);
    const s = choose({ type: 'priceMod', target: 'item', amount: 1 });
    const e = s.shop.find((x) => x.kind === 'equip')!;
    expect(e.price).toBe(data.equipsById[e.defId].price + 1);
    expect(s.shop.find((x) => x.kind === 'unit')!.price).toBe(3);
  });
  it('freeUnit（限阵营 / 阶级）', () => {
    const s = choose({ type: 'freeUnit', faction: 'open' });
    const f = s.shop.find((x) => x.free)!;
    expect(f).toMatchObject({ price: 0, freeReason: 'event' });
    expect(data.unitsById[f.defId].faction).toBe('open');
    expect(data.unitsById[choose({ type: 'freeUnit', tier: 4 }).shop.find((x) => x.free)!.defId].tier).toBe(4);
  });
  it('buffTeam / buffFaction / shieldAll', () => {
    expect(team(choose({ type: 'buffTeam', atk: 1, hp: 2, permanent: true })).map((u) => [u.atk, u.hp])).toEqual([[3, 4], [3, 6], [5, 6]]);
    const t = team(choose({ type: 'buffFaction', faction: 'open', atk: 1, hp: 1, permanent: true }));
    expect(t[1]).toMatchObject({ defId: 'qwen_chan', atk: 3, hp: 5 });
    expect(t[0]).toMatchObject({ atk: 2, hp: 2 });
    expect(team(choose({ type: 'shieldAll', amount: 2 })).every((u) => u.shield === 2)).toBe(true);
  });
  it('shopRerollFree / rerollShop / extraSlot', () => {
    let s = choose({ type: 'shopRerollFree' });
    s = shopAction(shopAction(s, { type: 'reroll' }, data), { type: 'reroll' }, data);
    expect(s.gold).toBe(G1);
    const before = base();
    const s2 = choose({ type: 'rerollShop' }, before);
    expect(JSON.stringify(s2.shop)).not.toBe(JSON.stringify(before.shop));
    let s3 = choose({ type: 'extraSlot', amount: 1 });
    expect(s3.shop.filter((x) => x.kind === 'unit')).toHaveLength(5);
    s3 = shopAction(s3, { type: 'reroll' }, data);
    expect(s3.shop.filter((x) => x.kind === 'unit')).toHaveLength(5);
    expect(nextTurn(s3).modifiers.extraUnitSlots).toBe(0);
  });
  it('swapAll：商店阶段不改队形，本场开战时反转；side=enemy 反转敌方', () => {
    const s = choose({ type: 'swapAll' });
    expect(s.team.map((u) => u?.defId ?? null)).toEqual(['wrapper', 'qwen_chan', 'crawler', null, null]);
    const r = battle(s, [mk('gpt_chan')]);
    expect(of(r, 'attack')[0].unit.defId).toBe('crawler');
    const r2 = battle(choose({ type: 'swapAll', side: 'enemy' }), [mk('kimi', { uid: 'K' }), mk('regulator', { uid: 'R' })]);
    expect(of(r2, 'move')[0]).toMatchObject({ side: 'enemy', order: ['e_R', 'e_K'] });
  });
  it('duplicate / sacrifice / levelUpRandom', () => {
    const s = choose({ type: 'duplicate' });
    expect(team(s)).toHaveLength(4);
    const s2 = choose({ type: 'sacrifice', amount: 4 });
    expect(s2.gold).toBe(G1 + 4);
    expect(team(s2).map((u) => u.defId)).toEqual(['qwen_chan', 'crawler']);
    const sum = (x: RunState) => team(x).reduce((a, u) => a + u.level, 0);
    expect(sum(choose({ type: 'levelUpRandom' }))).toBe(sum(base()) + 1);
  });
  it('nextTurnGold / enemyDebuff', () => {
    expect(nextTurn(choose({ type: 'nextTurnGold', amount: 3 })).gold).toBeGreaterThanOrEqual(G2 + 3);
    const r = battle(choose({ type: 'enemyDebuff', amount: 2 }), [mk('gpt_chan')]);
    expect(of(r, 'attack').find((e) => e.unit.side === 'enemy')!.unit.atk).toBe(4);
  });
  it(`lifeTrade：失去 ${DIFFICULTY.lifeTradeHp} 热度换算力与 1 次免费刷新；热度不够时不生效`, () => {
    const s = choose({ type: 'lifeTrade', amount: 4 });
    expect(s).toMatchObject({ hp: 20 - DIFFICULTY.lifeTradeHp, gold: G1 + 4 });
    expect(s.modifiers.freeRerolls).toBe(1);
    expect(choose({ type: 'lifeTrade', amount: 4 }, { ...base(), hp: 2 })).toMatchObject({ hp: 2, gold: G1 });
  });
});

describe('2.0 战场类事件（头条作用于本回合战斗）', () => {
  it('enemyBuff：敌方全体本场 +atk/+hp', () => {
    const r = battle(choose({ type: 'enemyBuff', atk: 3, hp: 1 }), [mk('kimi')]);
    expect(of(r, 'buff').find((e) => e.unit.side === 'enemy')).toMatchObject({ atk: 3, hp: 1 });
  });
  it('firstStrike：本场先手', () => {
    const r = battle(choose({ type: 'firstStrike', side: 'enemy' }), [mk('kimi')]);
    expect(of(r, 'start')[0].first).toBe('enemy');
    expect(of(r, 'attack')[0].unit.side).toBe('enemy');
  });
  it('swapFronts：开战时双方前排互换', () => {
    const r = battle(choose({ type: 'swapFronts' }), [mk('kimi', { uid: 'K' }), mk('regulator')]);
    const st = of(r, 'steal');
    expect(st.map((e) => [e.unit.defId, e.to.side])).toEqual([['kimi', 'me'], ['wrapper', 'enemy']]);
    expect(of(r, 'attack')[0].unit.uid).toBe('e_K');
  });
  it('battleStatMul：本场属性倍率（side both）', () => {
    const r = battle(choose({ type: 'battleStatMul', hp: 2, side: 'both' }), [mk('kimi')]);
    const b = of(r, 'buff');
    expect(b.find((e) => e.unit.defId === 'kimi')).toMatchObject({ hp: 5, newHp: 10 });
    expect(b.find((e) => e.unit.defId === 'wrapper')).toMatchObject({ newHp: 4 });
  });
  it('addEnemyBoss：敌方加 Boss；打赢时对手掉血 × rewardMul', () => {
    let s = choose({ type: 'addEnemyBoss', unitId: 'boss_huang', atk: 8, hp: 20, rewardMul: 2 });
    s = shopAction(s, { type: 'endShop' }, data);
    const r = battleForState(s, data, [mk('kimi')]);
    expect(of(r, 'summon')[0].unit).toMatchObject({ defId: 'boss_huang', side: 'enemy', atk: 8, hp: 20 });
    const opp = s.matchup!.opponentId;
    const after = applyBattleResult(s, res('me', { survivors: 2 }), data);
    expect(after.opponents.find((o) => o.id === opp)!.hp).toBe(20 - (1 + 2) * 2);
  });
  it('goldenEquips：我方装备本场按金色生效', () => {
    const s = choose({ type: 'goldenEquips' }, setTeam(base(), [mk('wrapper', { equips: { armor: { defId: 'dataset', gold: false } } })]));
    expect(of(battle(s, [mk('kimi')]), 'start')[0].me[0]).toMatchObject({ atk: 4, hp: 8 });
  });
  it('summonBuff：我方召唤物本场 +atk/+hp', () => {
    const s = choose({ type: 'summonBuff', atk: 2, hp: 2 }, setTeam(base(), [mk('botnet'), mk('labeler')]));
    expect(of(battle(s, [mk('kimi')]), 'summon')[0].unit).toMatchObject({ defId: 'token_shuijun', atk: 3, hp: 3 });
  });
  it('stealEnemy / benchEnemy / battleSummon', () => {
    const r = battle(choose({ type: 'stealEnemy', target: 'backEnemy' }), [mk('kimi'), mk('regulator', { uid: 'R' })]);
    expect(of(r, 'steal')[0]).toMatchObject({ unit: { uid: 'e_R' }, to: { side: 'me' } });
    const r2 = battle(choose({ type: 'benchEnemy', target: 'highestAtkEnemy' }), [mk('kimi'), mk('regulator', { uid: 'R' })]);
    expect(of(r2, 'faint')[0]).toMatchObject({ benched: true, unit: { uid: 'e_R' } });
    expect(of(r2, 'attack').some((e) => e.unit.uid === 'e_R')).toBe(false);
    const r3 = battle(choose({ type: 'battleSummon', side: 'me', unitId: 'token_halluc', count: 2 }), [mk('kimi')]);
    expect(of(r3, 'summon').map((e) => [e.unit.side, e.unit.defId])).toEqual([['me', 'token_halluc'], ['me', 'token_halluc']]);
  });
  it('synergyBonus：本回合羁绊人数 +n（商店与战斗都算）', () => {
    const s = choose({ type: 'synergyBonus', key: 'researcher', amount: 2 });
    const r = battle(s, [mk('kimi')]);
    expect(of(r, 'synergyTier').find((e) => e.key === 'researcher')).toMatchObject({ count: 2, tier: 1 });
    expect(nextTurn(s).modifiers.battle).toEqual({});
  });
  it('wager：赢了下回合 +winGold，输了额外掉 loseHp', () => {
    let s = shopAction(choose({ type: 'wager', winGold: 5, loseHp: 2 }), { type: 'endShop' }, data);
    expect(applyBattleResult(s, res('me'), data).modifiers.nextTurnGold).toBe(5);
    s = applyBattleResult(s, res('enemy', { survivors: 1 }), data);
    expect(s.hp).toBe(20 - (1 + 1 + 0) - 2);
  });
  it('damageOpponent / selfHpLoss：立即扣热度（最低留 1）', () => {
    const s = choose({ type: 'damageOpponent', amount: 5, target: 'random' });
    expect(s.opponents.filter((o) => o.hp === 15)).toHaveLength(1);
    expect(s.lastEvents.find((e) => e.type === 'hpLoss')).toMatchObject({ amount: 5, hp: 15, by: 'me' });
    const lead = base();
    lead.opponents[3].hp = 25;
    expect(choose({ type: 'damageOpponent', amount: 30, target: 'leader' }, lead).opponents[3].hp).toBe(1);
    expect(choose({ type: 'selfHpLoss', amount: 2 }).hp).toBe(18);
  });
  it('freeEquip：商店加一件免费装备（可指定金色）', () => {
    const s = choose({ type: 'freeEquip', gold: true, slot: 'armor' });
    const f = s.shop.find((x) => x.free && x.kind === 'equip')!;
    expect(f).toMatchObject({ price: 0, gold: true, freeReason: 'event' });
    expect(data.equipsById[f.defId].slot).toBe('armor');
    const n = shopAction(s, { type: 'equip', slot: s.shop.indexOf(f), unitIndex: 0 }, data);
    expect(n.team[0]!.equips.armor).toEqual({ defId: f.defId, gold: true });
    expect(n.gold).toBe(G1);
  });
});

describe('突发', () => {
  const afterBattle = (seed: string, turn = 1, d: GameData = data) => {
    const s = { ...start(seed, d), turn, phase: 'battle' as const };
    return applyBattleResult(s, res('draw'), d);
  };
  it(`奇数回合结算后约 ${DIFFICULTY.surpriseChance * 100}% 概率（固定种子可重放）；偶数回合没有`, () => {
    let hits = 0;
    const N = 600;
    for (let i = 0; i < N; i++) if (afterBattle(`sp${i}`).lastSurprise) hits++;
    expect(hits / N).toBeGreaterThan(0.24);
    expect(hits / N).toBeLessThan(0.36);
    expect(afterBattle('sp7').lastSurprise?.id).toBe(afterBattle('sp7').lastSurprise?.id);
    for (let i = 0; i < 50; i++) expect(afterBattle(`even${i}`, 2).lastSurprise).toBeUndefined();
  });
  it('突发在下一回合开始时生效；战场类突发作用于下一回合的战斗', () => {
    const d = custom({ surprises: [{ id: 's_fs', title: '抢到首发', news: '', effect: { type: 'firstStrike', side: 'enemy' }, effects: [{ type: 'firstStrike', side: 'enemy' }, { type: 'gold', amount: 2 }], good: true }] });
    let s: RunState | undefined;
    for (let i = 0; i < 50 && !s; i++) {
      const x = afterBattle(`g${i}`, 1, d);
      if (x.lastSurprise) s = x;
    }
    expect(s!.surprisePending).toBe(true);
    const n = shopAction(s!, { type: 'continue' }, d);
    expect(n).toMatchObject({ turn: 2, gold: G2 + 2, surprisePending: false });
    expect(n.modifiers.battle.first).toBe('enemy');
  });
});
