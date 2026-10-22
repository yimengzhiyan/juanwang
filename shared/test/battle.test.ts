import { describe, expect, it } from 'vitest';
import { custom, mk, plain, withAb } from './helpers';
import { simulateBattle } from '../src/engine/battle';
import type { Ability, BattleEvent, BattleResult, Faction, GameData, Target, UnitInst } from '../src/types';

const d = custom({
  units: [
    plain('weak', 1, 1), plain('weak2', 1, 2), plain('p33', 3, 3), plain('zero', 0, 5), plain('tank', 1, 30), plain('big', 5, 7),
    plain('o1', 1, 5, { faction: 'open' }), plain('c1', 1, 5, { faction: 'closed' }), plain('k1', 1, 5, { faction: 'compute' }), plain('k_hp1', 1, 1, { faction: 'compute' }),
    plain('f1', 1, 5, { faction: 'folk' }),
    withAb('sb', 1, 5, { trigger: 'startBattle', effect: 'damage', target: 'frontEnemy', amount: 2 }),
    withAb('sb_nolv', 1, 5, { trigger: 'startBattle', effect: 'damage', target: 'frontEnemy', amount: 2, perLevel: false }),
    withAb('ba', 2, 10, { trigger: 'beforeAttack', effect: 'multiAttack', target: 'self', amount: 2 }),
    withAb('hurt', 1, 10, { trigger: 'hurt', effect: 'buff', target: 'self', atk: 2, hp: 0 }),
    withAb('fs', 1, 1, { trigger: 'faint', effect: 'summon', target: 'self', unitId: 'token_shuijun' }),
    withAb('ff', 1, 20, { trigger: 'friendFaint', effect: 'buff', target: 'self', amount: 1 }, { faction: 'open' }),
    withAb('kl', 5, 10, { trigger: 'kill', effect: 'buff', target: 'self', amount: 2 }),
    withAb('fsum', 1, 20, { trigger: 'friendSummoned', effect: 'buff', target: 'summoned', amount: 1 }, { faction: 'open' }),
    withAb('es', 3, 10, { trigger: 'enemySummoned', effect: 'damage', target: 'summoned', amount: 2 }),
    withAb('hfr', 1, 10, { trigger: 'hurtFront', effect: 'shield', target: 'frontFriend', amount: 2 }, { faction: 'open' }),
    withAb('pb', 1, 5, { trigger: 'startBattle', effect: 'buff', target: 'self', amount: 1, permanent: true }),
    withAb('cp', 1, 1, { trigger: 'startBattle', effect: 'copyStats', target: 'highestAtkEnemy' }),
    withAb('sw', 1, 5, { trigger: 'startBattle', effect: 'swapPosition', target: 'backFriend' }, { faction: 'open' }),
    withAb('gold', 1, 5, { trigger: 'startBattle', effect: 'gold', target: 'self', amount: 2 }),
    withAb('rr', 1, 5, { trigger: 'startBattle', effect: 'reroll', target: 'self', amount: 1 }, { faction: 'closed' }),
    withAb('disc', 1, 5, { trigger: 'startBattle', effect: 'discount', target: 'self', amount: 1 }, { faction: 'compute' }),
    withAb('kill1', 1, 5, { trigger: 'startBattle', effect: 'destroy', target: 'highestAtkEnemy' }),
    withAb('heal', 1, 10, { trigger: 'hurt', effect: 'heal', target: 'self', amount: 2 }),
    withAb('push', 1, 5, { trigger: 'startBattle', effect: 'pushBack', target: 'frontEnemy' }),
    withAb('pull', 1, 5, { trigger: 'startBattle', effect: 'pullFront', target: 'backEnemy' }),
    withAb('revenge', 1, 1, { trigger: 'faint', effect: 'damage', target: 'killer', amount: 3 }),
    withAb('sb5', 5, 5, { trigger: 'startBattle', effect: 'damage', target: 'frontEnemy', amount: 1 }),
    withAb('sb2', 2, 5, { trigger: 'startBattle', effect: 'damage', target: 'frontEnemy', amount: 1 }),
  ],
});

const fight = (me: UnitInst[], en: UnitInst[], seed = 's', data: GameData = d, opts = {}) => simulateBattle(me, en, data, seed, opts);
const u = (id: string, over: Partial<UnitInst> = {}) => mk(id, over, d);
const of = <T extends BattleEvent['type']>(r: BattleResult, t: T) => r.events.filter((e): e is Extract<BattleEvent, { type: T }> => e.type === t);
const idx = (r: BattleResult, pred: (e: BattleEvent) => boolean) => r.events.findIndex(pred);

describe('同时互击与胜负', () => {
  it('双方前排同时互相造成伤害，同归于尽 = 和局', () => {
    const r = fight([u('p33')], [u('p33')]);
    expect(r.winner).toBe('draw');
    expect(r.rounds).toBe(1);
    expect(of(r, 'faint')).toHaveLength(2);
    expect(of(r, 'attack')[0]).toMatchObject({ round: 1, me: { atk: 3, hits: 1 }, enemy: { atk: 3, hits: 1 } });
  });
  it('50 回合未分胜负 = 和局', () => {
    const r = fight([u('zero')], [u('zero')]);
    expect(r.winner).toBe('draw');
    expect(r.rounds).toBe(50);
    expect(of(r, 'end')[0].winner).toBe('draw');
  });
  it('一方清空即分胜负；事件以 start 开头、end 结尾', () => {
    const r = fight([u('big')], [u('weak'), u('weak')]);
    expect(r.winner).toBe('me');
    expect(r.events[0].type).toBe('start');
    expect(r.events.at(-1)!.type).toBe('end');
    expect(r.rounds).toBe(2);
    const r2 = fight([], [u('weak')]);
    expect(r2.winner).toBe('enemy');
  });
  it('完全确定性：同输入同种子同事件', () => {
    const team = () => [u('sb', { uid: 'a' }), u('p33', { uid: 'b' })];
    const en = () => [u('big', { uid: 'c' }), u('weak2', { uid: 'd' })];
    expect(fight(team(), en(), 'k')).toEqual(fight(team(), en(), 'k'));
  });
  it('enemyAtkMod（头条 enemyDebuff）降低敌方攻击', () => {
    const r = fight([u('weak2')], [u('p33')], 's', d, { enemyAtkMod: -2 });
    expect(of(r, 'attack')[0].enemy.atk).toBe(1);
  });
  it('临时加成与护盾计入战斗', () => {
    const r = fight([u('weak', { tempAtk: 2, tempHp: 2, shield: 1 })], [u('p33')]);
    expect(of(r, 'start')[0].me[0]).toMatchObject({ atk: 3, hp: 3, shield: 1 });
  });
});

describe('触发器', () => {
  it('startBattle：开战时先结算技能（在第一次攻击之前）', () => {
    const r = fight([u('sb')], [u('weak2')]);
    expect(r.winner).toBe('me');
    expect(of(r, 'attack')).toHaveLength(0);
    expect(of(r, 'ability')[0]).toMatchObject({ trigger: 'startBattle', effect: 'damage' });
  });
  it('beforeAttack + multiAttack：本次攻击 2 次', () => {
    const r = fight([u('ba')], [u('zero', { hp: 4 })]);
    expect(of(r, 'attack')[0].me.hits).toBe(2);
    expect(of(r, 'multiAttack')[0].hits).toBe(2);
    expect(r.rounds).toBe(1);
    expect(r.winner).toBe('me');
  });
  it('hurt：受伤后攻击 +2（存活时才触发）', () => {
    const r = fight([u('hurt')], [u('tank')]);
    const atks = of(r, 'attack');
    expect(atks[0].me.atk).toBe(1);
    expect(atks[1].me.atk).toBe(3);
    expect(atks[2].me.atk).toBe(5);
  });
  it('faint + summon：阵亡时在原位召唤水军', () => {
    const r = fight([u('fs'), u('weak')], [u('tank')]);
    const s = of(r, 'summon')[0];
    expect(s.unit).toMatchObject({ defId: 'token_shuijun', side: 'me', pos: 0, atk: 1, hp: 1 });
    expect(idx(r, (e) => e.type === 'faint')).toBeLessThan(idx(r, (e) => e.type === 'summon'));
  });
  it('friendFaint：友军阵亡时 +1/+1', () => {
    const r = fight([u('weak'), u('ff')], [u('big', { hp: 50 })]);
    const b = of(r, 'buff').find((e) => e.unit.defId === 'ff');
    expect(b).toMatchObject({ atk: 1, hp: 1 });
  });
  it('kill：击杀后 +2/+2', () => {
    const r = fight([u('kl')], [u('weak'), u('weak'), u('tank')]);
    const atks = of(r, 'attack');
    expect(atks[0].me.atk).toBe(5);
    expect(atks[1].me.atk).toBe(7);
    expect(atks[2].me.atk).toBe(9);
  });
  it('friendSummoned：友军被召唤时给它 +1/+1（summoned 目标）', () => {
    const r = fight([u('fs'), u('fsum')], [u('big', { hp: 50 })]);
    const b = of(r, 'buff').find((e) => e.unit.defId === 'token_shuijun');
    expect(b).toMatchObject({ atk: 1, hp: 1, newAtk: 2, newHp: 2 });
  });
  it('enemySummoned：敌军召唤物出现时对它造成 2 点伤害', () => {
    const r = fight([u('es')], [u('fs'), u('tank')]);
    const dmg = of(r, 'damage').find((e) => e.unit.defId === 'token_shuijun');
    expect(dmg).toMatchObject({ source: { defId: 'es' }, amount: 2, hp: 0, kind: 'ability' });
    expect(of(r, 'faint').some((e) => e.unit.defId === 'token_shuijun')).toBe(true);
  });
  it('hurtFront：前排友军受伤时给它护盾', () => {
    const r = fight([u('tank'), u('hfr')], [u('p33', { hp: 100 })]);
    const sh = of(r, 'shield')[0];
    expect(sh).toMatchObject({ unit: { defId: 'tank', pos: 0 }, amount: 2 });
    // 第 2 次攻击被护盾挡下
    const hits = of(r, 'damage').filter((e) => e.unit.defId === 'tank');
    expect(hits[1]).toMatchObject({ blocked: 2, amount: 1 });
  });
});

describe('效果', () => {
  it('damage 走护盾：护盾吸收一次伤害后消失', () => {
    const r = fight([u('tank', { shield: 5 })], [u('p33', { hp: 100 })]);
    const hits = of(r, 'damage').filter((e) => e.unit.defId === 'tank');
    expect(hits[0]).toMatchObject({ amount: 0, blocked: 3, shield: 0 });
    expect(hits[1]).toMatchObject({ amount: 3, blocked: 0 });
  });
  it('buff permanent：记入 permanentBuffs（只记我方原队伍）', () => {
    const me = u('pb');
    const r = fight([me], [u('pb')]);
    expect(r.permanentBuffs).toEqual([{ uid: me.uid, atk: 1, hp: 1 }]);
  });
  it('copyStats：复制目标更高的攻/血', () => {
    const r = fight([u('cp')], [u('weak'), u('big')]);
    expect(of(r, 'buff')[0]).toMatchObject({ newAtk: 5, newHp: 7 });
  });
  it('swapPosition：和后排友军交换位置', () => {
    const a = u('sw');
    const b = u('c1');
    const r = fight([a, u('k1'), b], [u('tank')]);
    const mv = of(r, 'move')[0];
    expect(mv).toMatchObject({ side: 'me', from: 0, to: 2 });
    expect(mv.order).toEqual([b.uid, expect.any(String), a.uid]);
  });
  it('gold / reroll / discount：我方记为下回合收益，敌方不计', () => {
    const r = fight([u('gold'), u('rr'), u('disc')], [u('gold'), u('tank')]);
    expect(r.bonus).toEqual({ gold: 2, rerolls: 1, discount: 1 });
    expect(of(r, 'bonus')).toHaveLength(4);
  });
  it('destroy：直接击杀攻击最高的敌人（无视护盾）', () => {
    const r = fight([u('kill1')], [u('weak'), u('big', { shield: 9 })]);
    const f = of(r, 'faint')[0];
    expect(f.unit.defId).toBe('big');
    expect(f.killer?.defId).toBe('kill1');
  });
  it('heal：回血不超过上限', () => {
    const r = fight([u('heal')], [u('p33', { hp: 100 })]);
    const h = of(r, 'heal')[0];
    expect(h).toMatchObject({ amount: 2, hp: 9 });
    const h2 = of(r, 'heal')[1];
    expect(h2.hp).toBeLessThanOrEqual(10);
  });
  it('pushBack / pullFront：调整敌方站位', () => {
    const e1 = u('o1');
    const e2 = u('c1');
    const e3 = u('k1');
    const r = fight([u('push')], [e1, e2, e3]);
    expect(of(r, 'move')[0]).toMatchObject({ side: 'enemy', from: 0, to: 2, order: [`e_${e2.uid}`, `e_${e3.uid}`, `e_${e1.uid}`] });
    const r2 = fight([u('pull')], [u('o1'), u('c1'), u('big')]);
    expect(of(r2, 'move')[0]).toMatchObject({ from: 2, to: 0 });
    expect(of(r2, 'attack')[0].enemy.defId).toBe('big');
  });
  it('summon 的召唤上限：每方战场最多 6 个', () => {
    const team = [u('fs'), u('fs'), u('fs'), u('fs'), u('fs')];
    const r = fight(team, [u('big', { hp: 99 })]);
    expect(r.events.every((e) => e.type !== 'start' || e.me.length <= 6)).toBe(true);
  });
});

describe('目标', () => {
  const probe = (target: Target, n?: number) =>
    custom({ base: d, units: [withAb('probe', 1, 3, { trigger: 'startBattle', effect: 'buff', target, amount: 1, ...(n ? { n } : {}) } as Ability, { faction: 'closed' })] });
  const run = (target: Target, n?: number) => {
    const dd = probe(target, n);
    const a = mk('o1', { uid: 'A' }, dd);
    const p = mk('probe', { uid: 'P' }, dd);
    const c = mk('k1', { uid: 'C', hp: 2 }, dd);
    const x = mk('o1', { uid: 'X', hp: 9 }, dd);
    const y = mk('c1', { uid: 'Y', atk: 4 }, dd);
    const z = mk('k1', { uid: 'Z', hp: 1 }, dd);
    const r = simulateBattle([a, p, c], [x, y, z], dd, 'tg');
    const ab = r.events.find((e) => e.type === 'ability' && e.unit.uid === 'P') as Extract<BattleEvent, { type: 'ability' }>;
    return ab.targets.map((t) => t.uid);
  };
  it.each([
    ['self', ['P']], ['frontFriend', ['A']], ['backFriend', ['C']], ['adjacentFriends', ['A', 'C']], ['allFriends', ['A', 'P', 'C']],
    ['lowestHpFriend', ['C']], ['frontEnemy', ['e_X']], ['backEnemy', ['e_Z']], ['allEnemies', ['e_X', 'e_Y', 'e_Z']],
    ['lowestHpEnemy', ['e_Z']], ['highestAtkEnemy', ['e_Y']],
  ] as [Target, string[]][])('%s', (target, expected) => {
    expect(run(target)).toEqual(expected);
  });
  it('randomFriend(n) 不含自己、不重复', () => {
    const t = run('randomFriend', 2);
    expect(t.sort()).toEqual(['A', 'C']);
    expect(run('randomFriend')).toHaveLength(1);
  });
  it('randomEnemy(n)', () => {
    const t = run('randomEnemy', 2);
    expect(t).toHaveLength(2);
    expect(new Set(t).size).toBe(2);
    expect(t.every((x) => ['e_X', 'e_Y', 'e_Z'].includes(x))).toBe(true);
  });
  it('killer：阵亡时对击杀者造成伤害', () => {
    const r = fight([u('revenge')], [u('p33')]);
    const ab = of(r, 'ability')[0];
    expect(ab.trigger).toBe('faint');
    expect(ab.targets[0].defId).toBe('p33');
    expect(of(r, 'damage').at(-1)).toMatchObject({ unit: { defId: 'p33' }, amount: 3 });
    expect(r.winner).toBe('draw');
  });
  it('summoned：见 friendSummoned / enemySummoned 测试；boughtUnit：见商店测试', () => {
    const r = fight([u('fs'), u('fsum')], [u('big', { hp: 50 })]);
    const ab = of(r, 'ability').find((e) => e.trigger === 'friendSummoned')!;
    expect(ab.targets[0].defId).toBe('token_shuijun');
  });
});

describe('结算顺序', () => {
  it('同一触发按攻击高→低：敌方 5 攻先于我方 2 攻', () => {
    const r = fight([u('sb2')], [u('sb5')]);
    const abs = of(r, 'ability');
    expect(abs[0].unit.side).toBe('enemy');
    expect(abs[1].unit.side).toBe('me');
  });
  it('同攻击我方先', () => {
    const r = fight([u('sb2')], [u('sb2')]);
    expect(of(r, 'ability')[0].unit.side).toBe('me');
  });
});

describe('等级缩放', () => {
  it.each([[1, 2], [2, 4], [3, 6]])('Lv%i 伤害 = %i', (level, dmg) => {
    const r = fight([u('sb', { level: level as 1 | 2 | 3 })], [u('tank')]);
    expect(of(r, 'damage')[0].amount).toBe(dmg);
  });
  it('perLevel:false 不缩放', () => {
    const r = fight([u('sb_nolv', { level: 3 })], [u('tank')]);
    expect(of(r, 'damage')[0].amount).toBe(2);
  });
});

describe('阵营羁绊', () => {
  const syn = (id: string) => {
    const r = fight([u(id), u(id), u(id)], [u('zero')]);
    return { r, s: of(r, 'synergy') };
  };
  it('开源 ≥3：全队 +1/+1', () => {
    const { r, s } = syn('o1');
    expect(s[0]).toMatchObject({ side: 'me', faction: 'open', count: 3 });
    expect(of(r, 'buff').filter((e) => e.atk === 1 && e.hp === 1)).toHaveLength(3);
    expect(of(r, 'attack')[0].me.atk).toBe(2);
  });
  it('闭源 ≥3：最前排 3 点护盾', () => {
    const { r, s } = syn('c1');
    expect(s[0].faction).toBe('closed');
    expect(of(r, 'shield')[0]).toMatchObject({ unit: { pos: 0 }, amount: 3 });
  });
  it('算力 ≥3：全队攻击 +2 血量 -1（最低 1）', () => {
    const r = fight([u('k1'), u('k1'), u('k_hp1')], [u('zero')]);
    expect(of(r, 'synergy')[0].faction).toBe('compute');
    const b = of(r, 'buff');
    expect(b[0]).toMatchObject({ atk: 2, hp: -1, newAtk: 3, newHp: 4 });
    expect(b[2]).toMatchObject({ atk: 2, hp: 0, newHp: 1 });
  });
  it('民间 ≥3：召唤 1/1 水军到最后排', () => {
    const { r, s } = syn('f1');
    expect(s[0].faction).toBe('folk');
    expect(of(r, 'summon')[0].unit).toMatchObject({ defId: 'token_shuijun', pos: 3, side: 'me' });
  });
  it('不足 3 个不触发；敌方也会触发', () => {
    const r = fight([u('o1'), u('o1')], [u('c1'), u('c1'), u('c1')]);
    const s = of(r, 'synergy');
    expect(s).toHaveLength(1);
    expect(s[0].side).toBe('enemy');
  });
});

describe('事件信息', () => {
  it('每个事件都有文案；单位引用带 uid/defId/side/pos', () => {
    const r = fight([u('fs'), u('sb')], [u('p33'), u('weak')]);
    for (const e of r.events) {
      expect(typeof e.text).toBe('string');
      expect(e.text.length).toBeGreaterThan(0);
      if ('unit' in e) expect(e.unit).toMatchObject({ uid: expect.any(String), defId: expect.any(String), side: expect.stringMatching(/me|enemy/), pos: expect.any(Number) });
    }
  });
  it('faction 类型完整', () => {
    const f: Faction[] = ['open', 'closed', 'compute', 'folk'];
    expect(f).toHaveLength(4);
  });
});
