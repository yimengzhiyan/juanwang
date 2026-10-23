import { describe, expect, it } from 'vitest';
import { custom, mk, of, plain, withAb } from './helpers';
import { simulateBattle, MAX_ACTIONS } from '../src/engine/battle';
import type { BattleOptions, BattleResult, Faction, GameData, UnitInst } from '../src/types';

// 不同阵营的白板单位（避免意外凑出羁绊）
const P = (id: string, atk: number, hp: number, faction: Faction = 'open') => plain(id, atk, hp, { faction });
const d = custom({
  units: [
    P('a1', 1, 10, 'open'), P('a2', 1, 10, 'closed'), P('e1', 1, 10, 'compute'), P('e2', 1, 10, 'folk'),
    P('big', 5, 1, 'open'), P('one', 1, 1, 'compute'), P('zero', 0, 50, 'open'), P('zero2', 0, 40, 'compute'), P('tank', 1, 30, 'closed'),
    P('back', 2, 10, 'closed'), P('low', 1, 2, 'folk'),
    plain('sniper', 3, 10, { faction: 'closed', attackTarget: 'backEnemy' }),
    withAb('ba', 2, 10, { trigger: 'beforeAttack', effect: 'multiAttack', target: 'self', amount: 2 }, { faction: 'open' }),
    withAb('hurt', 1, 10, { trigger: 'hurt', effect: 'buff', target: 'self', atk: 2, hp: 0 }, { faction: 'open' }),
    withAb('fs', 1, 1, { trigger: 'faint', effect: 'summon', target: 'self', unitId: 'token_gpu' }, { faction: 'open' }),
    withAb('ff', 1, 20, { trigger: 'friendFaint', effect: 'buff', target: 'self', amount: 1 }, { faction: 'closed' }),
    withAb('kl', 5, 10, { trigger: 'kill', effect: 'buff', target: 'self', amount: 2 }, { faction: 'open' }),
    withAb('es', 3, 10, { trigger: 'enemySummoned', effect: 'damage', target: 'summoned', amount: 2 }, { faction: 'closed' }),
    withAb('hfr', 1, 10, { trigger: 'hurtFront', effect: 'shield', target: 'frontFriend', amount: 2 }, { faction: 'compute' }),
    withAb('pb', 1, 5, { trigger: 'startBattle', effect: 'buff', target: 'self', amount: 1, permanent: true }, { faction: 'open' }),
    withAb('gold', 1, 5, { trigger: 'startBattle', effect: 'gold', target: 'self', amount: 2 }, { faction: 'closed' }),
    withAb('sb', 1, 5, { trigger: 'startBattle', effect: 'damage', target: 'frontEnemy', amount: 3 }, { faction: 'open' }),
    withAb('kill1', 1, 5, { trigger: 'startBattle', effect: 'destroy', target: 'highestAtkEnemy', maxHp: 3, maxHpPerLevel: 2 }, { faction: 'open' }),
    withAb('steal', 1, 5, { trigger: 'startBattle', effect: 'steal', target: 'lowestHpEnemy', maxHp: 3, maxHpPerLevel: 2 }, { faction: 'open' }),
    withAb('boom', 4, 1, { trigger: 'faint', effect: 'explode', target: 'allEnemies', perLevel: false }, { faction: 'open' }),
    withAb('dbl', 3, 5, { trigger: 'startBattle', effect: 'doubleStats', target: 'self' }, { faction: 'open' }),
    withAb('rev', 1, 3, { trigger: 'faint', effect: 'revive', target: 'self' }, { faction: 'open' }),
    withAb('rev2', 1, 3, { trigger: 'faint', effect: 'revive', target: 'self', amount: 3 }, { faction: 'open' }),
    withAb('chain', 5, 20, { trigger: 'kill', effect: 'chain', target: 'self' }, { faction: 'open' }),
    withAb('cons', 1, 1, { trigger: 'startBattle', effect: 'copyStats', target: 'backFriend', consume: true, amount: 1 }, { faction: 'open' }),
    withAb('flt', 1, 5, { trigger: 'startBattle', effect: 'buff', target: 'allFriends', atk: 2, hp: 0, filter: { faction: 'closed' } }, { faction: 'compute' }),
    withAb('form', 1, 5, { trigger: 'startBattle', effect: 'buff', target: 'self', choices: [{ atk: 5, hp: 0 }, { atk: 0, hp: 5 }] }, { faction: 'compute' }),
  ],
});
const u = (id: string, over: Partial<UnitInst> = {}) => mk(id, over, d);
const fight = (me: UnitInst[], en: UnitInst[], seed = 's', data: GameData = d, opts: BattleOptions = {}): BattleResult => simulateBattle(me, en, data, seed, opts);
const attackers = (r: BattleResult) => of(r, 'attack').map((e) => e.unit.uid);

describe('交替开火（DESIGN 12.6）', () => {
  it('我方 1 号 → 敌方 1 号 → 我方 2 号 → 敌方 2 号 → 循环；默认打最前排', () => {
    const r = fight([u('a1', { uid: 'A' }), u('a2', { uid: 'B' })], [u('e1', { uid: 'C' }), u('e2', { uid: 'D' })]);
    expect(of(r, 'start')[0].first).toBe('me');
    expect(attackers(r).slice(0, 6)).toEqual(['A', 'e_C', 'B', 'e_D', 'A', 'e_C']);
    expect(of(r, 'attack').slice(0, 4).map((e) => e.target.uid)).toEqual(['e_C', 'A', 'e_C', 'A']);
    expect(of(r, 'attack')[0]).toMatchObject({ action: 1, hit: 1, hits: 1, unit: { atk: 1 } });
  });
  it('first = enemy 时敌方先开火', () => {
    const r = fight([u('a1', { uid: 'A' })], [u('e1', { uid: 'C' })], 's', d, { first: 'enemy' });
    expect(attackers(r).slice(0, 2)).toEqual(['e_C', 'A']);
  });
  it('跳过阵亡者：轮到的单位死了就由它身后的接上', () => {
    const r = fight([u('big', { uid: 'A' }), u('back', { uid: 'B' })], [u('one', { uid: 'C' }), u('e2', { uid: 'D', atk: 1 })]);
    // A 打死 C → D 打 A（A 1 血阵亡）→ 轮到我方 2 号位，但 A 已死，B 顶上
    expect(attackers(r).slice(0, 3)).toEqual(['A', 'e_D', 'B']);
  });
  it(`${MAX_ACTIONS} 次行动未分胜负：按剩余血量总和判定`, () => {
    const r = fight([u('zero')], [u('zero2')]);
    expect(r.actions).toBe(MAX_ACTIONS);
    const end = of(r, 'end')[0];
    expect(end).toMatchObject({ reason: 'timeout', winner: 'me', hpLeft: { me: 50, enemy: 40 } });
    expect(r.winner).toBe('me');
    const r2 = fight([u('zero')], [u('zero', { uid: 'z2' })]);
    expect(r2.winner).toBe('draw');
    expect(r2.survivors).toBe(0);
  });
  it('一方清空即分胜负；survivors = 胜方存活单位数；事件以 start 开头、end 结尾', () => {
    const r = fight([u('big'), u('tank')], [u('one')]);
    expect(r.winner).toBe('me');
    expect(r.survivors).toBe(2);
    expect(r.events[0].type).toBe('start');
    expect(r.events.at(-1)!.type).toBe('end');
    expect(fight([], [u('one')]).winner).toBe('enemy');
  });
  it('完全确定性：同输入同种子同事件', () => {
    const team = () => [u('sb', { uid: 'a' }), u('a1', { uid: 'b' })];
    const en = () => [u('big', { uid: 'c' }), u('e2', { uid: 'd' })];
    expect(fight(team(), en(), 'k')).toEqual(fight(team(), en(), 'k'));
  });
  it('攻击目标改写：attackTarget = backEnemy', () => {
    const r = fight([u('sniper')], [u('tank', { uid: 'F' }), u('low', { uid: 'L' })]);
    expect(of(r, 'attack')[0].target.uid).toBe('e_L');
  });
  it('enemyAtkMod（头条 enemyDebuff）降低敌方攻击；临时加成与护盾计入', () => {
    const r = fight([u('a1', { tempAtk: 2, tempHp: 2, shield: 1 })], [u('back')], 's', d, { enemyAtkMod: -1 });
    expect(of(r, 'start')[0].me[0]).toMatchObject({ atk: 3, hp: 12, shield: 1 });
    expect(of(r, 'attack')[1].unit.atk).toBe(1);
  });
});

describe('触发器', () => {
  it('startBattle：开战技能在第一次攻击之前', () => {
    const r = fight([u('sb')], [u('one', { hp: 3 })]);
    expect(r.winner).toBe('me');
    expect(of(r, 'attack')).toHaveLength(0);
    expect(of(r, 'ability')[0]).toMatchObject({ trigger: 'startBattle', effect: 'damage', repeat: 1 });
  });
  it('beforeAttack + multiAttack：本次行动攻击 2 段', () => {
    const r = fight([u('ba')], [u('zero', { hp: 4 })]);
    const atks = of(r, 'attack');
    expect(atks.slice(0, 2).map((e) => [e.hit, e.hits])).toEqual([[1, 2], [2, 2]]);
    expect(r.winner).toBe('me');
  });
  it('hurt：受伤后攻击 +2（存活时）', () => {
    const r = fight([u('hurt')], [u('tank')]);
    const mine = of(r, 'attack').filter((e) => e.unit.side === 'me');
    expect(mine[0].unit.atk).toBe(1);
    expect(mine[1].unit.atk).toBe(3);
  });
  it('faint + summon：阵亡时在原位召唤', () => {
    const r = fight([u('fs'), u('a2')], [u('tank')]);
    const s = of(r, 'summon')[0];
    expect(s.unit).toMatchObject({ defId: 'token_gpu', side: 'me', pos: 0 });
  });
  it('friendFaint / kill', () => {
    const r = fight([u('one'), u('ff')], [u('big', { hp: 50 })]);
    expect(of(r, 'buff').find((e) => e.unit.defId === 'ff')).toMatchObject({ atk: 1, hp: 1 });
    const r2 = fight([u('kl')], [u('one'), u('one', { uid: 'x2' }), u('tank')]);
    const mine = of(r2, 'attack').filter((e) => e.unit.side === 'me');
    expect(mine.map((e) => e.unit.atk).slice(0, 3)).toEqual([5, 7, 9]);
  });
  it('enemySummoned：敌方召唤物出现时对它造成伤害', () => {
    const r = fight([u('es')], [u('fs'), u('tank')]);
    const dmg = of(r, 'damage').find((e) => e.unit.defId === 'token_gpu' && e.kind === 'ability');
    expect(dmg?.amount).toBe(2);
  });
  it('hurtFront：前排受伤时给它护盾', () => {
    const r = fight([u('tank'), u('hfr')], [u('back')], 's', d, { first: 'enemy' });
    expect(of(r, 'shield')[0]).toMatchObject({ unit: { defId: 'tank' }, amount: 2 });
  });
});

describe('效果', () => {
  it('护盾是血池：吸收伤害直到打碎（shieldBroken）', () => {
    const r = fight([u('a1', { shield: 3 })], [u('back')], 's', d, { first: 'enemy' });
    const hits = of(r, 'damage').filter((e) => e.unit.side === 'me');
    expect(hits[0]).toMatchObject({ amount: 0, blocked: 2, shield: 1 });
    expect(hits[1]).toMatchObject({ amount: 1, blocked: 1, shield: 0, shieldBroken: true });
  });
  it('permanent buff 记入 permanentBuffs；gold 记为下回合收益（只算我方）', () => {
    const r = fight([u('pb', { uid: 'P' }), u('gold')], [u('gold', { uid: 'g2' })]);
    expect(r.permanentBuffs).toEqual([{ uid: 'P', atk: 1, hp: 1 }]);
    expect(r.bonus.gold).toBe(2);
  });
  it('destroy maxHp：阈值内直接击杀，否则造成阈值伤害；阈值按等级增加', () => {
    const r = fight([u('kill1')], [u('big', { hp: 3 })]);
    expect(of(r, 'faint')[0].unit.defId).toBe('big');
    const r2 = fight([u('kill1')], [u('big', { hp: 9 })]);
    expect(of(r2, 'damage')[0]).toMatchObject({ amount: 3 });
    const r3 = fight([u('kill1', { level: 2 })], [u('big', { hp: 5 })]);
    expect(of(r3, 'damage')[0]).toMatchObject({ amount: 5, hp: 0 });
  });
  it('copyStats consume：吞并身后友军，属性取高 +amount', () => {
    const r = fight([u('cons'), u('tank')], [u('zero')]);
    expect(of(r, 'faint')[0]).toMatchObject({ consumed: true, unit: { defId: 'tank' } });
    expect(of(r, 'buff')[0]).toMatchObject({ newAtk: 2, newHp: 31 });
  });
  it('filter：只给闭源友军 +2 攻；choices：随机形态（确定性，两种都会出现）', () => {
    const r = fight([u('flt'), u('a2'), u('a1')], [u('zero')]);
    expect(of(r, 'buff').map((e) => e.unit.defId)).toEqual(['a2']);
    const forms = new Set<number>();
    for (let i = 0; i < 20; i++) forms.add(of(fight([u('form')], [u('zero')], `f${i}`), 'buff')[0].atk);
    expect(forms).toEqual(new Set([5, 0]));
  });
});

describe('2.0 新效果（DESIGN 13）', () => {
  it('steal：偷走 ≤ 阈值血量的最弱敌人到我方末尾，否则造成阈值伤害', () => {
    const r = fight([u('steal'), u('a2')], [u('tank'), u('low', { uid: 'L' })]);
    const st = of(r, 'steal')[0];
    expect(st).toMatchObject({ unit: { uid: 'e_L', side: 'enemy' }, to: { uid: 'e_L', side: 'me', pos: 2 } });
    expect(of(r, 'start')[0].enemy).toHaveLength(2);
    // 被偷的单位在我方开火
    expect(of(r, 'attack').some((e) => e.unit.uid === 'e_L' && e.unit.side === 'me')).toBe(true);
    const r2 = fight([u('steal')], [u('tank')]);
    expect(of(r2, 'steal')).toHaveLength(0);
    expect(of(r2, 'damage')[0]).toMatchObject({ amount: 3, kind: 'ability' });
  });
  it('explode：阵亡时对敌方全体造成等于自身攻击的伤害', () => {
    const r = fight([u('boom')], [u('back'), u('e1')], 's', d, { first: 'enemy' });
    const ex = of(r, 'explode')[0];
    expect(ex).toMatchObject({ amount: 4 });
    expect(ex.targets).toHaveLength(2);
    expect(of(r, 'damage').filter((e) => e.kind === 'explode').map((e) => e.amount)).toEqual([4, 4]);
  });
  it('doubleStats：本场属性翻倍（一次）', () => {
    const r = fight([u('dbl')], [u('zero')]);
    expect(of(r, 'buff')[0]).toMatchObject({ atk: 3, hp: 5, newAtk: 6, newHp: 10 });
  });
  it('revive：阵亡时以 amount 血复活（缺省 1），每场只复活一次', () => {
    const r = fight([u('rev')], [u('back')], 's', d, { first: 'enemy' });
    const rv = of(r, 'revive');
    expect(rv).toHaveLength(1);
    expect(rv[0]).toMatchObject({ via: 'ability', unit: { defId: 'rev', hp: 1 } });
    expect(of(r, 'faint').filter((e) => e.unit.defId === 'rev')).toHaveLength(2);
    expect(of(fight([u('rev2')], [u('back')], 's', d, { first: 'enemy' }), 'revive')[0].unit.hp).toBe(3);
  });
  it('chain：击杀后立刻再攻击一次', () => {
    const r = fight([u('chain')], [u('one'), u('one', { uid: 'o2' }), u('tank')]);
    const ch = of(r, 'chain');
    expect(ch.length).toBeGreaterThanOrEqual(2);
    // 第一次行动里连续打了 3 次
    expect(of(r, 'attack').filter((e) => e.action === 1)).toHaveLength(3);
  });
});

describe('事件信息', () => {
  it('每个事件都有中文 text；单位引用带 uid/defId/side/pos；start 快照带装备', () => {
    const r = fight([u('sb'), u('fs'), u('boom')], [u('kl'), u('rev')]);
    for (const e of r.events) expect(typeof e.text).toBe('string');
    for (const e of of(r, 'damage')) expect(e.unit).toMatchObject({ uid: expect.any(String), defId: expect.any(String), side: expect.any(String), pos: expect.any(Number) });
    expect(of(r, 'start')[0].me[0].equips).toEqual({});
  });
});
