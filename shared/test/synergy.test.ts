import { describe, expect, it } from 'vitest';
import { custom, data, mk, of, plain, setTeam, start, withAb } from './helpers';
import { simulateBattle } from '../src/engine/battle';
import { shopAction } from '../src/engine/run';
import { beginTurn, makeCtx, turnIncome } from '../src/engine/shop';
import { baseGoldForTurn } from '../src/engine/shop';
const G1 = baseGoldForTurn(1);
import { ROLE_META, SYNERGY_DESCS, SYNERGY_NAME, computeSynergies, dominantSynergy } from '../src/engine/synergy';
import { ROLES, type BattleOptions, type Faction, type Role, type UnitInst } from '../src/types';

const F = (id: string, faction: Faction, role?: Role, atk = 1, hp = 6) => plain(id, atk, hp, { faction, ...(role ? { role } : {}) });
const d = custom({
  units: [
    F('o1', 'open'), F('o2', 'open'), F('o3', 'open'), F('o4', 'open'),
    F('c1', 'closed'), F('c2', 'closed'), F('c3', 'closed'), F('c4', 'closed'),
    F('k1', 'compute'), F('k2', 'compute'), F('k3', 'compute'), F('k4', 'compute'),
    F('f1', 'folk', undefined, 2, 8), F('f2', 'folk'), F('f3', 'folk'), F('f4', 'folk'),
    F('m1', 'open', 'multi', 1, 30), F('m2', 'closed', 'multi'), F('m3', 'compute', 'multi'), F('m4', 'folk', 'multi'),
    F('s1', 'open', 'shield', 1, 6), F('s2', 'closed', 'shield'), F('s3', 'compute', 'shield'), F('s4', 'folk', 'shield'),
    F('su1', 'open', 'summon'), F('su2', 'closed', 'summon'), F('su3', 'compute', 'summon'),
    withAb('su4', 1, 6, { trigger: 'startBattle', effect: 'summon', target: 'self', unitId: 'token_shuijun' }, { faction: 'folk', role: 'summon' }),
    withAb('x1', 3, 1, { trigger: 'faint', effect: 'explode', target: 'allEnemies' }, { faction: 'open', role: 'explode' }),
    withAb('x2', 1, 1, { trigger: 'faint', effect: 'damage', target: 'frontEnemy', amount: 1 }, { faction: 'closed', role: 'explode' }),
    F('x3', 'compute', 'explode', 4, 1), F('x4', 'folk', 'explode', 1, 1),
    withAb('g1', 1, 6, { trigger: 'startBattle', effect: 'buff', target: 'self', atk: 1, hp: 0, permanent: true }, { faction: 'open', role: 'growth' }),
    F('g2', 'closed', 'growth'), F('g3', 'compute', 'growth'), F('g4', 'folk', 'growth'),
    F('e1', 'open', 'economy'), F('e2', 'closed', 'economy'), F('e3', 'compute', 'economy'), F('e4', 'folk', 'economy'),
    F('wall', 'open', undefined, 0, 99), F('hitter', 'open', undefined, 5, 99), F('poke', 'open', undefined, 1, 99),
  ],
});
const u = (id: string, over: Partial<UnitInst> = {}) => mk(id, over, d);
const fight = (me: UnitInst[], en: UnitInst[], opts: BattleOptions = {}) => simulateBattle(me, en, d, 's', opts);
const tiers = (r: ReturnType<typeof fight>, side: 'me' | 'enemy' = 'me') => of(r, 'synergyTier').filter((e) => e.side === side).map((e) => `${e.key}${e.tier}`);

describe('SynergyState 输出', () => {
  it('10 条线固定顺序（阵营 4 + 关键词 6），含个数、档位、门槛、差几个到下一档', () => {
    const st = computeSynergies([u('o1'), u('o2'), u('m1'), u('m2'), u('c1')], d);
    expect(st.map((s) => s.key)).toEqual(['open', 'closed', 'compute', 'folk', 'multi', 'shield', 'summon', 'explode', 'growth', 'economy']);
    expect(st[0]).toMatchObject({ kind: 'faction', name: '开源', count: 3, tier: 2, thresholds: [2, 3, 4], next: 1 });
    const full = computeSynergies([u('o1'), u('o2'), u('o3'), u('o4')], d)[0];
    expect(full).toMatchObject({ count: 4, tier: 3 });
    expect(full.next).toBeUndefined();
    expect(st[4]).toMatchObject({ kind: 'role', name: '多刀', count: 2, tier: 1, thresholds: [2, 4], next: 2, descs: ROLE_META.multi.descs });
    expect(st[1]).toMatchObject({ count: 2, tier: 1, next: 1 });
    expect(st[0].descs).toHaveLength(3);
    expect(dominantSynergy(st)?.key).toBe('open');
  });
  it('战斗开始按档位发 synergyTier 横幅（含 onSynergy 台词）', () => {
    const r = simulateBattle([mk('prompt_eng'), mk('crawler')], [mk('token_gpu')], data, 's');
    const ev = of(r, 'synergyTier').find((e) => e.key === 'growth')!;
    expect(ev).toMatchObject({ side: 'me', kind: 'role', tier: 1, count: 2, text: '成长 ×2：卷起来！' });
    expect(ev.line).toMatchObject({ unit: { defId: 'prompt_eng' }, line: '工程师集合！' });
    expect(r.summary.synergyTiers.map((s) => s.key)).toEqual(['growth']);
  });
  it('ROLE_META：6 个关键词的中文名与 2/4 档说明（SYNERGY_NAME / SYNERGY_DESCS 同源）', () => {
    expect(ROLES.map((r) => ROLE_META[r].name)).toEqual(['多刀', '护盾', '召唤', '自爆', '成长', '经济']);
    for (const r of ROLES) {
      expect(ROLE_META[r].descs).toHaveLength(2);
      expect(SYNERGY_NAME[r]).toBe(ROLE_META[r].name);
      expect(SYNERGY_DESCS[r]).toEqual(ROLE_META[r].descs);
    }
  });
  it('dominantSynergy：关键词满档（4 个）胜过阵营 ×3', () => {
    const st = computeSynergies([u('m1'), u('m2'), u('m3'), u('m4'), u('o1')], d);
    expect(dominantSynergy(st)?.key).toBe('multi');
  });
});

describe('开源 open', () => {
  it('×2：开战时开源单位 +1/+1', () => {
    const r = fight([u('o1'), u('o2'), u('k1')], [u('wall')]);
    expect(tiers(r)).toEqual(['open1']);
    expect(of(r, 'buff').map((e) => [e.unit.defId, e.atk, e.hp])).toEqual([['o1', 1, 1], ['o2', 1, 1]]);
  });
  it('×3：任一开源单位被购买时，全体开源单位永久 +1/+1', () => {
    let s = setTeam(start('o4'), [mk('qwen_chan'), mk('hf'), mk('agi')]);
    s = { ...s, gold: 10, shop: [{ kind: 'unit', defId: 'kimi2', price: 3, frozen: false }] };
    s = shopAction(s, { type: 'buy', slot: 0 }, data);
    expect(s.error).toBeUndefined();
    expect(s.team[1]).toMatchObject({ defId: 'hf', atk: 4, hp: 5 });
    expect(s.team[3]).toMatchObject({ defId: 'kimi2', atk: 4, hp: 6 });
  });
  it('×4：开源单位每回合开始永久 +1/+1（4 个开源即可）', () => {
    const s2 = setTeam(start('o5'), [mk('qwen_chan'), mk('hf'), mk('agi'), mk('kimi2'), mk('wrapper')]);
    const ctx2 = makeCtx(s2, data);
    beginTurn(ctx2, 3);
    expect(ctx2.s.team[1]).toMatchObject({ defId: 'hf', atk: 4, hp: 5 });
    expect(ctx2.s.team[2]).toMatchObject({ defId: 'agi', atk: 9, hp: 9 });
  });
});

describe('闭源 closed', () => {
  it('×2：开战前排获得 3 护盾', () => {
    const r = fight([u('c1'), u('c2')], [u('wall')]);
    expect(of(r, 'shield')[0]).toMatchObject({ unit: { defId: 'c1' }, amount: 3 });
  });
  it('×3：闭源单位获得 1/3 血量的护盾，碎盾反弹 2', () => {
    const r = fight([u('c1'), u('c2'), u('c3'), u('o1')], [u('hitter')], { first: 'enemy' });
    expect(tiers(r)).toEqual(['closed2']);
    const shields = of(r, 'shield').filter((e) => e.unit.defId === 'c1').map((e) => e.amount);
    expect(shields).toEqual([3, 2]);
    const broken = of(r, 'damage').find((e) => e.shieldBroken)!;
    expect(broken.unit.defId).toBe('c1');
    expect(of(r, 'damage').find((e) => e.kind === 'reflect')).toMatchObject({ amount: 2, unit: { defId: 'hitter' } });
  });
  it('×4：反弹 = 攻击者攻击力，护盾不会被穿透（金色显卡也打不穿）', () => {
    const goldGpu = u('hitter', { equips: { weapon: { defId: 'gpu_h100', gold: true } } });
    const r = fight([u('c1'), u('c2'), u('c3'), u('c4')], [goldGpu], { first: 'enemy' });
    expect(tiers(r)).toEqual(['closed3']);
    const first = of(r, 'damage')[0];
    expect(first.blocked).toBeGreaterThan(0);
    expect(of(r, 'damage').find((e) => e.kind === 'reflect')?.amount).toBe(11);
  });
});

describe('算力 compute', () => {
  const gpu = { weapon: { defId: 'gpu_h100', gold: false } };
  it('×2：装备最多的单位 +2 攻', () => {
    const r = fight([u('k1'), u('k2', { equips: gpu })], [u('wall')]);
    expect(of(r, 'buff')[0]).toMatchObject({ unit: { defId: 'k2' }, atk: 2 });
  });
  it('×3：算力单位的装备效果 ×2（显卡 +3 → +6）', () => {
    const r = fight([u('k1', { equips: gpu }), u('k2'), u('k3')], [u('wall')]);
    expect(of(r, 'attack')[0]).toMatchObject({ hit: 1, hits: 1 });
    expect(of(r, 'start')[0].me[0].atk).toBe(1 + 6);
  });
  it('×4：装备最多的单位每次攻击额外攻击 1 次', () => {
    const r = fight([u('k1', { equips: gpu }), u('k2'), u('k3'), u('k4')], [u('wall')]);
    expect(of(r, 'attack')[0]).toMatchObject({ hit: 1, hits: 2 });
  });
});

describe('民间 folk', () => {
  it('×2：开战召唤 1 个水军到最后排', () => {
    const r = fight([u('f1'), u('f2')], [u('wall')]);
    expect(of(r, 'summon')[0].unit).toMatchObject({ defId: 'token_shuijun', pos: 2, atk: 1, hp: 1 });
  });
  it('×3：召唤物继承召唤者 50% 属性；友军阵亡召唤水军', () => {
    const r = fight([u('f1'), u('f2'), u('f3')], [u('hitter')], { first: 'enemy' });
    expect(tiers(r)).toEqual(['folk2']);
    // 开战水军继承最强民间（f1 2/8）的一半：1+1 / 1+4
    expect(of(r, 'summon')[0].unit).toMatchObject({ atk: 2, hp: 5 });
    const f1Dies = r.events.findIndex((e) => e.type === 'faint' && e.unit.defId === 'f1');
    expect(r.events.slice(f1Dies).find((e) => e.type === 'summon')).toBeTruthy();
  });
  it('×4：召唤物阵亡时对敌方全体造成 1 伤害', () => {
    const r = fight([u('f1'), u('f2'), u('f3'), u('f4')], [u('hitter'), u('poke')], { first: 'enemy' });
    const ex = of(r, 'explode')[0];
    expect(ex).toMatchObject({ amount: 1, unit: { defId: 'token_shuijun' } });
    expect(ex.targets).toHaveLength(2);
  });
});

const permOf = (r: ReturnType<typeof fight>, defId: string) => of(r, 'buff').filter((e) => e.permanent && e.unit.defId === defId && e.unit.side === 'me');

describe('多刀 multi', () => {
  it('×2：多刀单位攻击时 25% 额外攻击 1 次（非多刀单位不受影响），不成长', () => {
    let extra = 0;
    let total = 0;
    for (let i = 0; i < 40; i++) {
      const r = simulateBattle([u('m1'), u('m2'), u('o1')], [u('wall')], d, `m${i}`);
      expect(r.permanentBuffs).toEqual([]);
      for (const e of of(r, 'attack').filter((x) => x.hit === 1 && x.unit.side === 'me')) {
        if (e.unit.defId === 'o1') expect(e.hits).toBe(1);
        else {
          total++;
          if (e.hits === 2) extra++;
        }
      }
    }
    expect(extra / total).toBeGreaterThan(0.15);
    expect(extra / total).toBeLessThan(0.35);
  });
  it('×4：每次攻击必定额外 1 段；额外那段命中后该单位永久 +1 攻（buff 事件 permanent + synergy，赛后写回）', () => {
    const m1 = u('m1');
    const r = fight([m1, u('m2'), u('m3'), u('m4')], [u('wall')]);
    const mine = of(r, 'attack').filter((e) => e.hit === 1 && e.unit.side === 'me');
    expect(mine.every((e) => e.hits === 2)).toBe(true);
    const g = permOf(r, 'm1');
    expect(g.length).toBe(mine.filter((e) => e.unit.uid === m1.uid).length);
    expect(g[0]).toMatchObject({ atk: 1, hp: 0, permanent: true, synergy: 'multi' });
    expect(r.permanentBuffs.find((p) => p.uid === m1.uid)).toEqual({ uid: m1.uid, atk: g.length, hp: 0 });
  });
});

describe('护盾 shield', () => {
  it('×2：开战时护盾单位获得 4 护盾（SYNERGY_TUNING.shieldStart）', () => {
    const r = fight([u('s1'), u('o1'), u('s2')], [u('wall')]);
    expect(of(r, 'shield').map((e) => [e.unit.defId, e.amount])).toEqual([['s1', 4], ['s2', 4]]);
    expect(r.permanentBuffs).toEqual([]);
  });
  it('×4：友军护盾碎裂时反弹 3；护盾单位每碎一次盾永久 +1/+2', () => {
    const s1 = u('s1');
    const r = fight([s1, u('s2'), u('s3'), u('s4')], [u('hitter')], { first: 'enemy' });
    expect(of(r, 'damage').find((e) => e.kind === 'reflect')).toMatchObject({ amount: 3, unit: { defId: 'hitter' } });
    const broken = of(r, 'damage').filter((e) => e.shieldBroken && e.unit.uid === s1.uid).length;
    expect(broken).toBeGreaterThan(0);
    expect(permOf(r, 's1')[0]).toMatchObject({ atk: 1, hp: 2, synergy: 'shield' });
    expect(r.permanentBuffs.find((p) => p.uid === s1.uid)).toEqual({ uid: s1.uid, atk: broken, hp: 2 * broken });
  });
});

describe('召唤 summon', () => {
  it('×2：召唤物 +2/+2（召唤者不成长）', () => {
    const r = fight([u('su4'), u('su1')], [u('wall')]);
    expect(of(r, 'summon')[0].unit).toMatchObject({ defId: 'token_shuijun', atk: 3, hp: 3 });
    expect(r.permanentBuffs).toEqual([]);
  });
  it('×4：召唤物 +3/+3；开战额外召唤 1 个水军；每次召唤，召唤者永久 +2/+2', () => {
    const su4 = u('su4');
    const r = fight([u('su1'), u('su2'), u('su3'), su4], [u('wall')]);
    const sums = of(r, 'summon');
    expect(sums[0].unit).toMatchObject({ defId: 'token_shuijun', pos: 4, atk: 4, hp: 4 });
    expect(sums).toHaveLength(2);
    expect(sums.every((e) => e.unit.atk === 4 && e.unit.hp === 4)).toBe(true);
    expect(permOf(r, 'su4')).toHaveLength(1);
    expect(permOf(r, 'su4')[0]).toMatchObject({ synergy: 'summon', permanent: true });
    expect(r.permanentBuffs).toEqual([{ uid: su4.uid, atk: 2, hp: 2 }]);
  });
  it('商店阶段的召唤也吃加成；×4 召唤者永久 +2/+2', () => {
    const dd = custom({ base: d, units: [withAb('shopsum', 1, 6, { trigger: 'buy', effect: 'summon', target: 'self', unitId: 'token_shuijun' }, { faction: 'open', role: 'summon', token: false })] });
    let s = setTeam(start('ss', dd), [mk('su1', {}, dd)]);
    s = { ...s, gold: 10, shop: [{ kind: 'unit', defId: 'shopsum', price: 3, frozen: false }] };
    s = shopAction(s, { type: 'buy', slot: 0 }, dd);
    expect(s.team.find((x) => x?.defId === 'token_shuijun')).toMatchObject({ atk: 3, hp: 3 });
    let s4 = setTeam(start('ss4', dd), [mk('su1', {}, dd), mk('su2', {}, dd), mk('su3', {}, dd)]);
    s4 = { ...s4, gold: 10, shop: [{ kind: 'unit', defId: 'shopsum', price: 3, frozen: false }] };
    s4 = shopAction(s4, { type: 'buy', slot: 0 }, dd);
    expect(s4.team.find((x) => x?.defId === 'token_shuijun')).toMatchObject({ atk: 4, hp: 4 });
    expect(s4.team.find((x) => x?.defId === 'shopsum')).toMatchObject({ atk: 3, hp: 8 });
  });
});

describe('自爆 explode', () => {
  it('×2：开战时自爆单位本场 +1/+1（不加爆炸伤害）', () => {
    const r = fight([u('x1'), u('x2'), u('o1')], [u('hitter'), u('poke')], { first: 'enemy' });
    expect(of(r, 'buff').filter((e) => e.synergy === 'explode').map((e) => [e.unit.defId, e.atk, e.hp, e.permanent])).toEqual([['x1', 1, 1, false], ['x2', 1, 1, false]]);
    // x1 3 攻 +1（自爆）+1（开源 ×2）= 5，爆炸 = 自身攻击，不再额外 +1
    expect(of(r, 'explode')[0]).toMatchObject({ unit: { defId: 'x1' }, amount: 5 });
    expect(of(r, 'damage').some((e) => e.kind === 'ability' && e.source?.defId === 'x2' && e.amount === 1)).toBe(true);
    expect(r.permanentBuffs).toEqual([]);
  });
  it('×4：自爆单位阵亡时炸敌方最前排（= 自身攻击）+ 敌方全体 1 余波；每次爆炸，其余自爆友军永久 +1/+1', () => {
    const x4 = u('x4');
    const r = fight([u('x3'), x4, u('x1'), u('x2'), u('o1')], [u('hitter'), u('poke')], { first: 'enemy' });
    const ex = of(r, 'explode').filter((e) => e.unit.defId === 'x3');
    expect(ex[0]).toMatchObject({ amount: 5, targets: [{ side: 'enemy', pos: 0 }] });
    expect(ex[1]).toMatchObject({ amount: 1 });
    expect(ex[1].targets).toHaveLength(2);
    expect(permOf(r, 'x4')[0]).toMatchObject({ atk: 1, hp: 1, synergy: 'explode' });
    expect(r.permanentBuffs.find((p) => p.uid === x4.uid)!.atk).toBeGreaterThanOrEqual(1);
    // 非自爆单位阵亡没有余波
    const oDies = r.events.findIndex((e) => e.type === 'faint' && e.unit.defId === 'o1');
    if (oDies >= 0) expect(r.events[oDies + 1]?.type === 'explode' && (r.events[oDies + 1] as { unit: { defId: string } }).unit.defId === 'o1').toBe(false);
  });
});

describe('成长 growth', () => {
  it('×2：成长单位每次获得永久加成额外 +1/+1（商店与战斗）', () => {
    const r = fight([u('g1'), u('g2')], [u('wall')]);
    expect(of(r, 'buff').find((e) => e.unit.defId === 'g1')).toMatchObject({ atk: 2, hp: 1, permanent: true, synergy: 'growth' });
    expect(r.permanentBuffs[0]).toMatchObject({ atk: 2, hp: 1 });
    let s = setTeam(start('g', data), [mk('prompt_eng'), mk('crawler')]);
    s = { ...s, gold: 10, shop: [{ kind: 'equip', defId: 'dataset', price: 3, frozen: false }] };
    s = shopAction(s, { type: 'equip', slot: 0, unitIndex: 0 }, data);
    // 提示词工程师：装上装备时永久 +2 攻，成长 ×2 额外 +1/+1
    expect(s.team[0]).toMatchObject({ atk: 1 + 2 + 1, hp: 3 + 1 });
  });
  it('×4 战斗：成长单位获得永久加成时，相邻友军获得同样加成（不再传递）', () => {
    const o1 = u('o1');
    const r = fight([o1, u('g1'), u('g2'), u('g3'), u('g4')], [u('wall')]);
    const spread = of(r, 'buff').filter((e) => e.source?.defId === 'g1' && e.text.includes('互相成长'));
    expect(spread.map((e) => [e.unit.defId, e.atk, e.hp])).toEqual([['o1', 1, 0], ['g2', 2, 1]]);
    expect(r.permanentBuffs.find((p) => p.uid === o1.uid)).toEqual({ uid: o1.uid, atk: 1, hp: 0 });
  });
  it('×4 商店：回合结束全队永久 +1/+1，成长单位再 +1/+1 并带动相邻友军', () => {
    let s = setTeam(start('g4', d), [u('g1'), u('g2'), u('g3'), u('g4'), u('o1')]);
    s = shopAction(s, { type: 'endShop' }, d);
    // g 本身 +2，左右成长邻居各带 +2（o1 被 g4 带 +1）
    expect(s.team.map((x) => `${x!.atk}/${x!.hp}`)).toEqual(['5/10', '7/12', '7/12', '5/10', '3/8']);
  });
});

describe('经济 economy', () => {
  it('×2：每回合 +2 算力；×4：+3 算力且单位价格 -1（装备不降价）', () => {
    const s = setTeam(start('t', d), [u('e1'), u('e2')]);
    expect(turnIncome(makeCtx(s, d)).total).toBe(G1 + 2);
    let s4 = setTeam(start('t4', d), [u('e1'), u('e2'), u('e3'), u('e4')]);
    expect(turnIncome(makeCtx(s4, d))).toMatchObject({ total: G1 + 3, economy: 3 });
    s4 = shopAction(s4, { type: 'freeze', slot: 0 }, d);
    expect(s4.shop.filter((x) => x.kind === 'unit').every((x) => x.price === 2)).toBe(true);
    expect(s4.shop.filter((x) => x.kind === 'equip').every((x) => x.price === d.equipsById[x.defId].price)).toBe(true);
  });
  it('×4：每花掉 4 算力，随机一名经济单位永久 +1/+1（进度跨动作累计）', () => {
    let s = setTeam(start('t6', d), [u('e1'), u('e2'), u('e3'), u('e4'), u('o1')]);
    s = { ...s, gold: 30 };
    const sum = (x: typeof s) => x.team.filter((t) => d.unitsById[t!.defId].role === 'economy').reduce((a, t) => a + t!.atk + t!.hp, 0);
    const before = sum(s);
    for (let i = 0; i < 3; i++) s = shopAction(s, { type: 'reroll' }, d);
    expect(sum(s)).toBe(before);
    expect(s.economySpent).toBe(3);
    s = shopAction(s, { type: 'reroll' }, d);
    expect(sum(s)).toBe(before + 2);
    expect(s.economySpent).toBe(0);
    expect(s.team[4]).toMatchObject({ atk: 1, hp: 6 });
  });
});

describe('羁绊加成', () => {
  it('赛场「召唤祭」召唤人数 +1：1 个召唤单位也能点亮', () => {
    const r = simulateBattle([mk('hf')], [mk('token_gpu')], data, 's', { arena: 'summon_fest' });
    expect(of(r, 'synergyTier').map((e) => `${e.key}${e.count}`)).toContain('summon2');
  });
});
