import { describe, expect, it } from 'vitest';
import { custom, data, mk, of, plain, setTeam, start, withAb } from './helpers';
import { simulateBattle } from '../src/engine/battle';
import { shopAction } from '../src/engine/run';
import { beginTurn, makeCtx, turnIncome } from '../src/engine/shop';
import { baseGoldForTurn } from '../src/engine/shop';
const G1 = baseGoldForTurn(1);
import { computeSynergies, dominantSynergy } from '../src/engine/synergy';
import type { BattleOptions, Faction, Role, UnitInst } from '../src/types';

const F = (id: string, faction: Faction, role?: Role, atk = 1, hp = 6) => plain(id, atk, hp, { faction, ...(role ? { role } : {}) });
const d = custom({
  units: [
    F('o1', 'open'), F('o2', 'open'), F('o3', 'open'), F('o4', 'open'),
    F('c1', 'closed'), F('c2', 'closed'), F('c3', 'closed'), F('c4', 'closed'),
    F('k1', 'compute'), F('k2', 'compute'), F('k3', 'compute'), F('k4', 'compute'),
    F('f1', 'folk', undefined, 2, 8), F('f2', 'folk'), F('f3', 'folk'), F('f4', 'folk'),
    F('i1', 'open', 'idol', 1, 1), F('i2', 'closed', 'idol', 9, 9), F('i3', 'compute', 'idol'), F('i4', 'folk', 'idol'),
    withAb('r1', 1, 6, { trigger: 'startBattle', effect: 'damage', target: 'frontEnemy', amount: 1 }, { faction: 'open', role: 'researcher' }),
    F('r2', 'closed', 'researcher'), F('r3', 'compute', 'researcher'), F('r4', 'folk', 'researcher'),
    F('wall', 'open', undefined, 0, 99), F('hitter', 'open', undefined, 5, 99), F('poke', 'open', undefined, 1, 99),
  ],
});
const u = (id: string, over: Partial<UnitInst> = {}) => mk(id, over, d);
const fight = (me: UnitInst[], en: UnitInst[], opts: BattleOptions = {}) => simulateBattle(me, en, d, 's', opts);
const tiers = (r: ReturnType<typeof fight>, side: 'me' | 'enemy' = 'me') => of(r, 'synergyTier').filter((e) => e.side === side).map((e) => `${e.key}${e.tier}`);

describe('SynergyState 输出', () => {
  it('8 条线固定顺序，含个数、档位、门槛、差几个到下一档', () => {
    const st = computeSynergies([u('o1'), u('o2'), u('o3'), u('i1'), u('i2')], d);
    expect(st.map((s) => s.key)).toEqual(['open', 'closed', 'compute', 'folk', 'researcher', 'trader', 'idol', 'engineer']);
    expect(st[0]).toMatchObject({ kind: 'faction', name: '开源', count: 4, tier: 2, thresholds: [2, 3, 5], next: 1 });
    expect(st[6]).toMatchObject({ kind: 'role', name: '偶像', count: 2, tier: 1, thresholds: [2, 4], next: 2 });
    expect(st[1]).toMatchObject({ count: 1, tier: 0, next: 1 });
    expect(st[0].descs).toHaveLength(3);
    expect(dominantSynergy(st)?.key).toBe('open');
  });
  it('战斗开始按档位发 synergyTier 横幅（含 onSynergy 台词）', () => {
    const r = simulateBattle([mk('prompt_eng'), mk('crawler')], [mk('token_gpu')], data, 's');
    const ev = of(r, 'synergyTier').find((e) => e.key === 'engineer')!;
    expect(ev).toMatchObject({ side: 'me', kind: 'role', tier: 1, count: 2, text: '工程师 ×2：加班！' });
    expect(ev.line).toMatchObject({ unit: { defId: 'prompt_eng' }, line: '工程师集合！' });
    expect(r.summary.synergyTiers.map((s) => s.key)).toEqual(['engineer']);
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
  it('×5：开源单位每回合开始永久 +1/+1（5 人满队即可）', () => {
    const s2 = setTeam(start('o5'), [mk('qwen_chan'), mk('hf'), mk('agi'), mk('kimi2'), mk('crawler')]);
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
    const r = fight([u('c1'), u('c2'), u('c3'), u('c4')], [u('hitter')], { first: 'enemy' });
    const shields = of(r, 'shield').filter((e) => e.unit.defId === 'c1').map((e) => e.amount);
    expect(shields).toEqual([3, 2]);
    const broken = of(r, 'damage').find((e) => e.shieldBroken)!;
    expect(broken.unit.defId).toBe('c1');
    expect(of(r, 'damage').find((e) => e.kind === 'reflect')).toMatchObject({ amount: 2, unit: { defId: 'hitter' } });
  });
  it('×5：反弹 = 攻击者攻击力，护盾不会被穿透（金色显卡也打不穿）', () => {
    const goldGpu = u('hitter', { equips: { weapon: { defId: 'gpu_h100', gold: true } } });
    const r = fight([u('c1'), u('c2'), u('c3'), u('c4')], [goldGpu], { first: 'enemy', mods: { synergyBonus: { closed: 1 } } });
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
    const r = fight([u('k1', { equips: gpu }), u('k2'), u('k3'), u('k4')], [u('wall')]);
    expect(of(r, 'start')[0].me[0].atk).toBe(1 + 6);
  });
  it('×5：装备最多的单位每次攻击额外攻击 1 次', () => {
    const r = fight([u('k1', { equips: gpu }), u('k2'), u('k3'), u('k4')], [u('wall')], { mods: { synergyBonus: { compute: 1 } } });
    expect(of(r, 'attack')[0]).toMatchObject({ hit: 1, hits: 2 });
  });
});

describe('民间 folk', () => {
  it('×2：开战召唤 1 个水军到最后排', () => {
    const r = fight([u('f1'), u('f2')], [u('wall')]);
    expect(of(r, 'summon')[0].unit).toMatchObject({ defId: 'token_shuijun', pos: 2, atk: 1, hp: 1 });
  });
  it('×3：召唤物继承召唤者 50% 属性；友军阵亡召唤水军', () => {
    const r = fight([u('f1'), u('f2'), u('f3'), u('f4')], [u('hitter')], { first: 'enemy' });
    // 开战水军继承最强民间（f1 2/8）的一半：1+1 / 1+4
    expect(of(r, 'summon')[0].unit).toMatchObject({ atk: 2, hp: 5 });
    const f1Dies = r.events.findIndex((e) => e.type === 'faint' && e.unit.defId === 'f1');
    expect(r.events.slice(f1Dies).find((e) => e.type === 'summon')).toBeTruthy();
  });
  it('×5：召唤物阵亡时对敌方全体造成 1 伤害', () => {
    const r = fight([u('f1'), u('f2'), u('f3'), u('f4')], [u('hitter'), u('poke')], { first: 'enemy', mods: { synergyBonus: { folk: 1 } } });
    const ex = of(r, 'explode')[0];
    expect(ex).toMatchObject({ amount: 1, unit: { defId: 'token_shuijun' } });
    expect(ex.targets).toHaveLength(2);
  });
});

describe('研究员 researcher', () => {
  it('×2：回合结束研究员永久 +1 攻', () => {
    let s = setTeam(start('r'), [mk('claude_chan'), mk('dario')]);
    s = shopAction(s, { type: 'endShop' }, data);
    expect(s.team.slice(0, 2).map((x) => x!.atk)).toEqual([5, 5]);
  });
  it('×4：研究员技能触发两次', () => {
    const r = fight([u('r1'), u('r2'), u('r3'), u('r4')], [u('wall')]);
    const ab = of(r, 'ability').filter((e) => e.unit.defId === 'r1');
    expect(ab.map((e) => e.repeat)).toEqual([1, 2]);
  });
});

describe('商人 trader', () => {
  it('×2：每回合 +1 算力；×4：+2 算力且单位价格 -1', () => {
    const s = setTeam(start('t'), [mk('wrapper'), mk('doubao_chan')]);
    expect(turnIncome(makeCtx(s, data)).total).toBe(G1 + 1);
    let s4 = setTeam(start('t4'), [mk('wrapper'), mk('doubao_chan'), mk('zuck'), mk('scalper')]);
    expect(turnIncome(makeCtx(s4, data))).toMatchObject({ total: G1 + 2, trader: 2 });
    s4 = shopAction(s4, { type: 'freeze', slot: 0 }, data);
    expect(s4.shop.filter((x) => x.kind === 'unit').every((x) => x.price === 2)).toBe(true);
  });
});

describe('偶像 idol', () => {
  it('×2：偶像阵亡时全队 +1 攻', () => {
    const r = fight([u('i1'), u('i2')], [u('hitter')], { first: 'enemy' });
    expect(of(r, 'buff').find((e) => e.unit.defId === 'i2' && e.atk === 1)).toBeTruthy();
  });
  it('×4：开战时随机复制一名偶像的属性给最弱友军', () => {
    const r = fight([u('i1'), u('i2'), u('i3'), u('i4')], [u('wall')], {});
    const b = of(r, 'buff').find((e) => e.text.includes('复制了偶像'))!;
    expect(b.unit.defId).toBe('i1');
  });
});

describe('工程师 engineer', () => {
  it('×2：进化时额外 +1/+1', () => {
    let s = setTeam(start('e'), [mk('crawler', { xp: 1 }), mk('labeler')]);
    s = { ...s, gold: 10, shop: [{ kind: 'unit', defId: 'crawler', price: 3, frozen: false }] };
    s = shopAction(s, { type: 'buy', slot: 0 }, data);
    // 合体 max(2,2)+1 = 3/3，进化额外 +1/+1
    expect(s.team[0]).toMatchObject({ level: 2, atk: 4, hp: 4 });
  });
  it('×4：每回合首次刷新免费；进化时全队 +1/+1', () => {
    let s = setTeam(start('e4'), [mk('crawler', { xp: 1 }), mk('labeler'), mk('prompt_eng'), mk('hf')]);
    const g = s.gold;
    s = shopAction(s, { type: 'reroll' }, data);
    expect(s.gold).toBe(g);
    s = shopAction(s, { type: 'reroll' }, data);
    expect(s.gold).toBe(g - 1);
    s = { ...s, gold: 10, shop: [{ kind: 'unit', defId: 'crawler', price: 3, frozen: false }] };
    s = shopAction(s, { type: 'buy', slot: 0 }, data);
    expect(s.team[0]).toMatchObject({ level: 2, atk: 5, hp: 5 });
    expect(s.team[1]).toMatchObject({ defId: 'labeler', atk: 2, hp: 4 });
  });
});

describe('羁绊加成', () => {
  it('赛场「春晚舞台」偶像人数 +1：1 个偶像也能点亮', () => {
    const r = simulateBattle([mk('qwen_chan')], [mk('token_gpu')], data, 's', { arena: 'spring_gala' });
    expect(of(r, 'synergyTier').map((e) => `${e.key}${e.count}`)).toContain('idol2');
  });
});
