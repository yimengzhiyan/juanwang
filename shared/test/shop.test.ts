import { describe, expect, it } from 'vitest';
import { data, mk, of, setTeam, start } from './helpers';
import { newRun, shopAction } from '../src/engine/run';
import { simulateBattle } from '../src/engine/battle';
import { MAX_SHOP_LEVEL, OWNED_UNIT_WEIGHT, UPGRADE_PRICE, makeCtx, maxTierForTurn, rollUnitDef, shopMaxTier, tierWeights, turnIncome, unitRollWeights } from '../src/engine/shop';
import { baseGoldForTurn } from '../src/engine/shop';
const G1 = baseGoldForTurn(1);
import type { RunState, ShopSlot } from '../src/types';

const ok = (s: RunState, a: Parameters<typeof shopAction>[1]) => {
  const n = shopAction(s, a, data);
  expect(n.error, a.type).toBeUndefined();
  return n;
};
const kinds = (s: RunState) => s.shop.map((x) => x.kind);
const unitShop = (s: RunState, ids: string[]): RunState => ({ ...s, shop: ids.map((defId) => ({ kind: 'unit', defId, price: 3, frozen: false }) as ShopSlot) });

describe('newRun / 赛场三选一', () => {
  it('开局展示 3 个赛场；选完进入回合 1：20 热度、10 算力、7 名对手，商店 4 单位 + 2 装备 + 1 消耗品', () => {
    let s = newRun('a', data);
    expect(s.phase).toBe('arena');
    expect(s.arenaOptions).toHaveLength(3);
    expect(new Set(s.arenaOptions).size).toBe(3);
    expect(shopAction(s, { type: 'buy', slot: 0 }, data).error).toBeTruthy();
    s = ok(s, { type: 'chooseArena', index: 1 });
    expect(s.arena).toBe(newRun('a', data).arenaOptions![1]);
    expect(s).toMatchObject({ phase: 'shop', turn: 1, hp: 20, shopLevel: 0 });
    expect(s.opponents).toHaveLength(7);
    expect(s.opponents.every((o) => o.hp === 20 && o.alive && !o.isHuman)).toBe(true);
    const arenaRules = data.arenasById[s.arena!].rules;
    const nUnits = 4 + (arenaRules.unitSlotsMod ?? 0);
    const nEquips = 2 + (arenaRules.equipSlotsMod ?? 0);
    expect(kinds(s)).toEqual([...Array(nUnits).fill('unit'), ...Array(nEquips).fill('equip'), 'consumable']);
  });
  it('newRun(seed, data, {arena}) 直接指定赛场（null = 无赛场）；同种子一致', () => {
    const s = start('x');
    expect(s).toMatchObject({ phase: 'shop', turn: 1, gold: G1 });
    expect(s.arena).toBeUndefined();
    expect(kinds(s)).toEqual(['unit', 'unit', 'unit', 'unit', 'equip', 'equip', 'consumable']);
    expect(start('x')).toEqual(s);
    expect(start('y').shop).not.toEqual(s.shop);
    expect(newRun('x', data, { arena: 'equip_expo' }).arena).toBe('equip_expo');
  });
});

describe('购买 / 出售 / 刷新 / 冻结 / 交换', () => {
  it('购买扣 3 算力，放进第一个空位；算力不够报错', () => {
    let s = ok(start('b'), { type: 'buy', slot: 0 });
    expect(s.gold).toBe(G1 - 3);
    expect(s.team[0]).not.toBeNull();
    s = { ...s, gold: 2 };
    expect(shopAction(s, { type: 'buy', slot: 0 }, data).error).toMatch(/算力不够/);
  });
  it('出售得到 = 等级 的算力，并触发 sell 技能', () => {
    const s = setTeam(start('s'), [mk('labeler', { level: 2, xp: 2 })]);
    expect(ok(s, { type: 'sell', index: 0 }).gold).toBe(G1 + 2 + 2);
  });
  it('刷新花 1 算力，冻结槽保留；冻结的槽下回合保留', () => {
    let s = ok(start('r'), { type: 'freeze', slot: 0 });
    const frozen = s.shop[0];
    s = ok(s, { type: 'reroll' });
    expect(s.gold).toBe(G1 - 1);
    expect(s.shop[0]).toEqual(frozen);
    expect(s.modifiers.rerollsThisTurn).toBe(1);
  });
  it('交换位置；非商店阶段不能操作；shopAction 不修改入参', () => {
    const s = setTeam(start('w'), [mk('crawler'), null, mk('wrapper')]);
    const snap = JSON.stringify(s);
    const n = ok(s, { type: 'swap', a: 0, b: 1 });
    expect(n.team[1]?.defId).toBe('crawler');
    expect(JSON.stringify(s)).toBe(snap);
    expect(shopAction({ ...s, phase: 'battle' }, { type: 'reroll' }, data).error).toBe('现在不是商店阶段');
  });
});

describe('阶级解锁 / 升级商店', () => {
  it('按回合：T1@1 T2@3 T3@5 T4@7 T5@9 T6@11，最高阶权重最高', () => {
    expect([1, 3, 5, 7, 9, 11, 20].map(maxTierForTurn)).toEqual([1, 2, 3, 4, 5, 6, 6]);
    expect(tierWeights(1)).toEqual([3]);
    expect(tierWeights(3)).toEqual([1, 2, 3]);
    expect(tierWeights(6)).toEqual([1, 1, 1, 1, 2, 3]);
    const ctx = makeCtx({ ...start('t'), turn: 5 }, data);
    const cnt = [0, 0, 0, 0];
    for (let i = 0; i < 1200; i++) cnt[data.unitsById[rollUnitDef(ctx)!].tier]++;
    expect(cnt[3]).toBeGreaterThan(cnt[2]);
    expect(cnt[2]).toBeGreaterThan(cnt[1]);
    expect(cnt[1] + cnt[2] + cnt[3]).toBe(1200);
  });
  it(`已在队伍中的单位权重 ×${OWNED_UNIT_WEIGHT}（DESIGN 17）`, () => {
    const w = unitRollWeights(data, 1, ['crawler']);
    const t1 = data.shopUnitsByTier[1];
    expect(w.find((x) => x.id === 'crawler')!.weight).toBeCloseTo((3 / t1.length) * OWNED_UNIT_WEIGHT);
    expect(w.find((x) => x.id === 'labeler')!.weight).toBeCloseTo(3 / t1.length);
    const base = setTeam(start('own'), [mk('crawler')]);
    const ctx = makeCtx(base, data);
    let hit = 0;
    const N = 3000;
    for (let i = 0; i < N; i++) if (rollUnitDef(ctx) === 'crawler') hit++;
    const p = OWNED_UNIT_WEIGHT / (t1.length - 1 + OWNED_UNIT_WEIGHT);
    expect(hit / N).toBeGreaterThan(p - 0.04);
    expect(hit / N).toBeLessThan(p + 0.04);
  });
  it(`upgradeShop：${UPGRADE_PRICE} 算力提前解锁下一阶并重抽单位格；每局最多 ${MAX_SHOP_LEVEL} 次；阶级 = max(按回合, 升级)`, () => {
    let s = ok(start('u'), { type: 'freeze', slot: 4 });
    const eqSlot = s.shop[4];
    s = ok(s, { type: 'upgradeShop' });
    expect(s).toMatchObject({ gold: G1 - UPGRADE_PRICE, shopLevel: 1, shopTier: 2 });
    expect(s.lastEvents[0]).toMatchObject({ type: 'shopLevelUp', shopLevel: 1, tier: 2 });
    expect(s.shop).toContainEqual(eqSlot);
    expect(shopMaxTier(s)).toBe(2);
    s = ok({ ...s, gold: 10 }, { type: 'upgradeShop' });
    expect(s.shopTier).toBe(3);
    expect(shopAction({ ...s, gold: 10 }, { type: 'upgradeShop' }, data).error).toMatch(/最多升级 2 次/);
    expect(shopAction({ ...start('u2'), gold: 3 }, { type: 'upgradeShop' }, data).error).toMatch(/算力不够/);
    // 回合推进后按回合的阶追上来
    expect(shopMaxTier({ turn: 9, shopTier: 3 })).toBe(5);
    expect(s.stats.upgrades).toBe(2);
  });
});

describe('合并进化', () => {
  it('3 份 → Lv2 并刷出比当前最高阶高一阶的免费单位；6 份 → Lv3', () => {
    let s = setTeam(start('m'), [mk('wrapper', { xp: 1, atk: 3, hp: 3 })]);
    s = ok(unitShop({ ...s, gold: 10 }, ['wrapper']), { type: 'buy', slot: 0 });
    expect(s.team[0]).toMatchObject({ level: 2, xp: 2, atk: 4, hp: 4 });
    const free = s.shop.find((x) => x.free)!;
    expect(free).toMatchObject({ price: 0, freeReason: 'levelUp' });
    expect(data.unitsById[free.defId].tier).toBe(2);
    expect(s.lastLevelUp).toEqual({ uid: s.team[0]!.uid, level: 2 });
    s = setTeam(s, [mk('wrapper', { level: 2, xp: 4 })]);
    s = ok(unitShop({ ...s, gold: 10 }, ['wrapper']), { type: 'buy', slot: 0 });
    expect(s.team[0]!.level).toBe(3);
    expect(s.stats.lv3).toBe(1);
  });
});

describe('赛场规则（10 张，各一条）', () => {
  const at = (arena: string, team: Parameters<typeof setTeam>[1] = []) => setTeam(newRun(`ar-${arena}`, data, { arena }), team);
  const price = (s: RunState, id: string) => shopAction(unitShop(s, [id]), { type: 'freeze', slot: 0 }, data).shop[0].price;
  it('开源大会：开源单位 -1 价', () => {
    const s = at('open_summit');
    expect(price(s, 'crawler')).toBe(2);
    expect(price(s, 'wrapper')).toBe(3);
  });
  it('GPU 荒：战斗开始时双方全体 +1 攻 -1 血', () => {
    const r = simulateBattle([mk('wrapper')], [mk('kimi')], data, 's', { arena: 'gpu_drought' });
    expect(of(r, 'arena')[0]).toMatchObject({ arena: 'gpu_drought' });
    expect(of(r, 'buff').map((e) => [e.unit.side, e.atk, e.hp])).toEqual([['me', 1, -1], ['enemy', 1, -1]]);
  });
  it('融资寒冬：每回合 +2 算力，商店少 1 格单位', () => {
    const s = at('funding_winter');
    expect(s.shop.filter((x) => x.kind === 'unit')).toHaveLength(3);
    expect(turnIncome(makeCtx(s, data)).total).toBe(G1 + 2);
  });
  it('刷新狂欢：刷新免费，买单位 +1 价', () => {
    const s = at('reroll_party');
    expect(ok(s, { type: 'reroll' }).gold).toBe(G1);
    expect(price(s, 'crawler')).toBe(4);
  });
  it('1 号位光环：每次刷新，1 号位永久 +1/+1', () => {
    const s = ok(at('seat_one_aura', [mk('wrapper')]), { type: 'reroll' });
    expect(s.team[0]).toMatchObject({ atk: 3, hp: 3 });
  });
  it('装备展：商店多 1 个装备格', () => {
    expect(at('equip_expo').shop.filter((x) => x.kind === 'equip')).toHaveLength(3);
  });
  it('人海时代：所有召唤物 +1/+1', () => {
    const r = simulateBattle([mk('botnet'), mk('labeler')], [mk('token_gpu')], data, 's', { arena: 'folk_era' });
    expect(of(r, 'summon')[0].unit).toMatchObject({ defId: 'token_shuijun', atk: 2, hp: 2 });
  });
  it('成长营：成长单位 -1 价', () => {
    const s = at('growth_camp');
    expect(price(s, 'labeler')).toBe(2);
    expect(price(s, 'wrapper')).toBe(3);
  });
  it('召唤祭：召唤羁绊人数 +1', () => {
    const r = simulateBattle([mk('hf')], [mk('token_gpu')], data, 's', { arena: 'summon_fest' });
    expect(of(r, 'synergyTier').find((e) => e.key === 'summon')).toMatchObject({ count: 2, tier: 1 });
  });
  it('安全法案：开战时闭源单位各得 2 护盾', () => {
    const r = simulateBattle([mk('wrapper'), mk('crawler')], [mk('kimi')], data, 's', { arena: 'safety_act' });
    expect(of(r, 'shield').map((e) => [e.unit.side, e.unit.defId, e.amount])).toEqual([['me', 'wrapper', 2], ['enemy', 'kimi', 2]]);
  });
});
