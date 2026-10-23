import { describe, expect, it } from 'vitest';
import { custom, data, mk, of, plain, setTeam, start, withAb } from './helpers';
import { simulateBattle } from '../src/engine/battle';
import { shopAction } from '../src/engine/run';
import { makeCtx, turnIncome } from '../src/engine/shop';
import { effectiveStats, equipRefund } from '../src/engine/equip';
import type { BattleOptions, EquipSlot, Faction, RunState, ShopSlot, UnitInst } from '../src/types';

const P = (id: string, atk: number, hp: number, faction: Faction) => plain(id, atk, hp, { faction });
const d = custom({
  units: [
    P('m', 2, 10, 'open'), P('m2', 1, 10, 'closed'), P('wall', 0, 99, 'compute'), P('w2', 0, 99, 'folk'), P('low', 0, 3, 'folk'),
    P('hit5', 5, 99, 'compute'), P('hit1', 1, 99, 'compute'), P('big', 9, 9, 'closed'), P('slow', 1, 99, 'open'),
    withAb('abl', 1, 10, { trigger: 'startBattle', effect: 'damage', target: 'frontEnemy', amount: 1 }, { faction: 'open' }),
  ],
});
const SLOT: Record<string, EquipSlot> = Object.fromEntries(data.equips.map((e) => [e.id, e.slot]));
const eq = (id: string, gold = false) => ({ [SLOT[id]]: { defId: id, gold } });
const u = (id: string, over: Partial<UnitInst> = {}) => mk(id, over, d);
const fight = (me: UnitInst[], en: UnitInst[], opts: BattleOptions = {}, seed = 's') => simulateBattle(me, en, d, seed, opts);
const startMe = (r: ReturnType<typeof fight>) => of(r, 'start')[0].me[0];

describe('12 件装备（DESIGN 12.3）', () => {
  it('显卡 gpu_h100：+3 攻；金：+6 攻，攻击无视护盾', () => {
    expect(startMe(fight([u('m', { equips: eq('gpu_h100') })], [u('wall')])).atk).toBe(5);
    const r = fight([u('m', { equips: eq('gpu_h100', true) })], [u('wall', { shield: 5 })]);
    expect(startMe(r).atk).toBe(8);
    expect(of(r, 'damage')[0]).toMatchObject({ amount: 8, blocked: 0 });
  });
  it('量化 quantize：+3 攻 -1 血；金：+6/-1，攻击溅射身后 1', () => {
    expect(startMe(fight([u('m', { equips: eq('quantize') })], [u('wall')]))).toMatchObject({ atk: 5, hp: 9 });
    const r = fight([u('m', { equips: eq('quantize', true) })], [u('wall'), u('w2')]);
    expect(startMe(r).atk).toBe(8);
    expect(of(r, 'damage').find((e) => e.kind === 'splash')).toMatchObject({ amount: 1, unit: { defId: 'w2' } });
  });
  it('发布会 launch_event：30% 概率额外攻击 1 次；金：60%', () => {
    const rate = (gold: boolean) => {
      let acts = 0;
      let extra = 0;
      for (let i = 0; i < 20; i++) {
        const r = fight([u('slow', { equips: eq('launch_event', gold) })], [u('wall')], {}, `le${i}`);
        const mine = of(r, 'attack').filter((e) => e.unit.side === 'me' && e.hit === 1);
        acts += mine.length;
        extra += mine.filter((e) => e.hits === 2).length;
      }
      return extra / acts;
    };
    const a = rate(false);
    const b = rate(true);
    expect(a).toBeGreaterThan(0.2);
    expect(a).toBeLessThan(0.4);
    expect(b).toBeGreaterThan(0.5);
    expect(b).toBeLessThan(0.7);
  });
  it('热搜 trending：攻击目标改为血最少的敌人；金：且 +2 攻', () => {
    const r = fight([u('m', { equips: eq('trending') })], [u('wall'), u('low', { uid: 'L' })]);
    expect(of(r, 'attack')[0].target.uid).toBe('e_L');
    expect(of(r, 'equipProc')[0]).toMatchObject({ equipId: 'trending', gold: false });
    expect(startMe(fight([u('m', { equips: eq('trending', true) })], [u('wall')])).atk).toBe(4);
  });
  it('数据集 dataset：+1/+3；金：+2/+6', () => {
    expect(startMe(fight([u('m', { equips: eq('dataset') })], [u('wall')]))).toMatchObject({ atk: 3, hp: 13 });
    expect(startMe(fight([u('m', { equips: eq('dataset', true) })], [u('wall')]))).toMatchObject({ atk: 4, hp: 16 });
  });
  it('防火墙 firewall：开战 4 护盾；金：8 护盾，碎盾反弹 2', () => {
    const r = fight([u('m', { equips: eq('firewall') })], [u('wall')]);
    expect(of(r, 'shield')[0]).toMatchObject({ amount: 4, unit: { defId: 'm' } });
    const r2 = fight([u('m', { equips: eq('firewall', true) })], [u('big', { atk: 9 })], { first: 'enemy' });
    expect(of(r2, 'shield')[0].amount).toBe(8);
    expect(of(r2, 'damage')[0]).toMatchObject({ blocked: 8, shieldBroken: true });
    expect(of(r2, 'damage').find((e) => e.kind === 'reflect')).toMatchObject({ amount: 2, unit: { defId: 'big' } });
  });
  it('对齐 alignment：-1 攻 +5 血，≤1 的伤害免疫；金：+10 血', () => {
    const r = fight([u('m', { equips: eq('alignment') })], [u('hit1')], { first: 'enemy' });
    expect(startMe(r)).toMatchObject({ atk: 1, hp: 15 });
    expect(of(r, 'damage')[0]).toMatchObject({ amount: 0, immune: true });
    expect(startMe(fight([u('m', { equips: eq('alignment', true) })], [u('wall')])).hp).toBe(20);
  });
  it('跳板机 jumpbox：阵亡时在最后排以 1 血复活一次；金：一半血量', () => {
    const r = fight([u('m', { hp: 5, equips: eq('jumpbox') }), u('m2')], [u('big')], { first: 'enemy' });
    const rv = of(r, 'revive')[0];
    expect(rv).toMatchObject({ via: 'equip', unit: { defId: 'm', hp: 1, pos: 1 } });
    const r2 = fight([u('m', { hp: 6, equips: eq('jumpbox', true) })], [u('big')], { first: 'enemy' });
    expect(of(r2, 'revive')[0].unit.hp).toBe(3);
    expect(of(r2, 'revive')).toHaveLength(1);
  });
  it('RLHF rlhf：每回合结束永久 +1/+1；金：+2/+2', () => {
    let s = setTeam(start('rl'), [mk('wrapper', { equips: eq('rlhf') }), mk('kimi', { equips: eq('rlhf', true) })]);
    s = shopAction(s, { type: 'endShop' }, data);
    expect(s.team[0]).toMatchObject({ atk: 3, hp: 3 });
    expect(s.team[1]).toMatchObject({ atk: 4, hp: 7 });
  });
  it('蒸馏 distill：开战攻击追平相邻友军最高值；金：攻血都追平', () => {
    const r = fight([u('m2', { equips: eq('distill') }), u('big')], [u('wall')]);
    expect(of(r, 'buff')[0]).toMatchObject({ unit: { defId: 'm2' }, newAtk: 9, newHp: 10 });
    const r2 = fight([u('m2', { hp: 3, equips: eq('distill', true) }), u('big')], [u('wall')]);
    expect(of(r2, 'buff')[0]).toMatchObject({ newAtk: 9, newHp: 9 });
  });
  it('微调 finetune：技能额外触发 1 次；金：2 次', () => {
    const r = fight([u('abl', { equips: eq('finetune') })], [u('wall')]);
    expect(of(r, 'ability').map((e) => e.repeat)).toEqual([1, 2]);
    const r2 = fight([u('abl', { equips: eq('finetune', true) })], [u('wall')]);
    expect(of(r2, 'ability').map((e) => e.repeat)).toEqual([1, 2, 3]);
  });
  it('融资 funding_round：每回合 +1 算力，卖掉 +3（另有装备折算 1）；金：每回合 +2', () => {
    const s = setTeam(start('fu'), [mk('kimi', { equips: eq('funding_round') }), mk('regulator', { equips: eq('funding_round', true) })]);
    expect(turnIncome(makeCtx(s, data)).funding).toBe(3);
    const g = s.gold;
    const s2 = shopAction(s, { type: 'sell', index: 0 }, data);
    expect(s2.gold).toBe(g + 1 + 1 + 3);
  });
});

const withShop = (s: RunState, slots: Partial<ShopSlot>[]): RunState => ({
  ...s, gold: 10, shop: slots.map((x) => ({ kind: 'equip', defId: 'gpu_h100', price: 3, frozen: false, ...x }) as ShopSlot),
});

describe('装备动作 equip{slot, unitIndex}', () => {
  it('购买并装到单位上：扣钱、写入槽位、触发 eatItem', () => {
    let s = withShop(setTeam(start('e1'), [mk('prompt_eng')]), [{}]);
    s = shopAction(s, { type: 'equip', slot: 0, unitIndex: 0 }, data);
    expect(s.error).toBeUndefined();
    expect(s.gold).toBe(7);
    expect(s.team[0]!.equips.weapon).toEqual({ defId: 'gpu_h100', gold: false });
    expect(s.team[0]!.atk).toBe(3); // 提示词工程师：装上装备时永久 +2 攻
    expect(effectiveStats(s.team[0]!, data, s.team).atk).toBe(6);
    expect(s.shop).toHaveLength(0);
  });
  it('同名同槽第二件 → 金色版；金色再装同名报错', () => {
    let s = withShop(setTeam(start('e2'), [mk('wrapper', { equips: eq('gpu_h100') })]), [{}, {}]);
    s = shopAction(s, { type: 'equip', slot: 0, unitIndex: 0 }, data);
    expect(s.team[0]!.equips.weapon).toEqual({ defId: 'gpu_h100', gold: true });
    expect(s.stats.goldEquips).toBe(1);
    expect(shopAction({ ...s, gold: 10 }, { type: 'equip', slot: 0, unitIndex: 0 }, data).error).toMatch(/金色/);
  });
  it('同槽换装：旧装备折算 1 算力（金色 2）', () => {
    let s = withShop(setTeam(start('e3'), [mk('wrapper', { equips: eq('quantize', true) })]), [{}]);
    s = shopAction(s, { type: 'equip', slot: 0, unitIndex: 0 }, data);
    expect(s.team[0]!.equips.weapon).toEqual({ defId: 'gpu_h100', gold: false });
    expect(s.gold).toBe(10 - 3 + 2);
  });
  it('错误：没有单位 / 算力不够 / 不是装备槽', () => {
    const s = withShop(setTeam(start('e4'), [mk('wrapper')]), [{ price: 30 }, { kind: 'unit', defId: 'crawler' }]);
    expect(shopAction(s, { type: 'equip', slot: 0, unitIndex: 3 }, data).error).toBe('请选择一个单位');
    expect(shopAction(s, { type: 'equip', slot: 0, unitIndex: 0 }, data).error).toMatch(/算力不够/);
    expect(shopAction(s, { type: 'equip', slot: 1, unitIndex: 0 }, data).error).toBe('没有这件装备');
  });
  it('出售单位时装备折算：每件 1、金色 2', () => {
    const unit = mk('kimi', { equips: { ...eq('gpu_h100', true), ...eq('dataset') } });
    expect(equipRefund(unit)).toBe(3);
    const s = setTeam(start('e5'), [unit]);
    expect(shopAction(s, { type: 'sell', index: 0 }, data).gold).toBe(s.gold + 1 + 3);
  });
  it('队伍内合体：装备合并（空槽移入、同名合成金色、冲突的折算）', () => {
    const a = mk('crawler', { equips: { ...eq('gpu_h100'), ...eq('dataset') } });
    const b = mk('crawler', { equips: { ...eq('quantize'), ...eq('dataset'), ...eq('rlhf') } });
    let s = setTeam(start('e6'), [a, b]);
    const g = s.gold;
    s = shopAction(s, { type: 'merge', from: 0, to: 1 }, data);
    expect(s.team[1]!.equips).toEqual({ weapon: { defId: 'quantize', gold: false }, armor: { defId: 'dataset', gold: true }, trinket: { defId: 'rlhf', gold: false } });
    expect(s.gold).toBe(g + 1);
  });
});

describe('消耗品（3 种）', () => {
  const cons = (s: RunState, id: string): RunState => ({ ...s, gold: 10, shop: [{ kind: 'consumable', defId: id, price: data.consumablesById[id].price, frozen: false }] });
  it('咖啡 coffee：本回合 3 次免费刷新', () => {
    let s = shopAction(cons(start('c1'), 'coffee'), { type: 'useConsumable', slot: 0 }, data);
    expect(s.gold).toBe(9);
    expect(s.modifiers.freeRerolls).toBe(3);
    s = shopAction(s, { type: 'reroll' }, data);
    expect(s.gold).toBe(9);
  });
  it('新闻稿 press：随机一个单位 +1 等级（并刷出进化奖励）', () => {
    const s = shopAction(cons(setTeam(start('c2'), [mk('wrapper')]), 'press'), { type: 'useConsumable', slot: 0 }, data);
    expect(s.team[0]).toMatchObject({ level: 2, atk: 3, hp: 3 });
    expect(s.shop.some((x) => x.free && x.freeReason === 'levelUp')).toBe(true);
    expect(shopAction(cons(start('c2b'), 'press'), { type: 'useConsumable', slot: 0 }, data).error).toBe('没有可以升级的单位');
  });
  it('转型 pivot：指定单位变成同阶随机单位（保留额外属性与装备）', () => {
    const s0 = cons(setTeam(start('c3'), [mk('wrapper', { atk: 4, equips: eq('dataset') })]), 'pivot');
    expect(shopAction(s0, { type: 'useConsumable', slot: 0 }, data).error).toBe('请选择一个单位');
    const s = shopAction(s0, { type: 'useConsumable', slot: 0, target: 0 }, data);
    const nu = s.team[0]!;
    expect(nu.defId).not.toBe('wrapper');
    expect(data.unitsById[nu.defId].tier).toBe(1);
    expect(nu.atk).toBe(data.unitsById[nu.defId].atk + 2);
    expect(nu.equips.armor?.defId).toBe('dataset');
  });
});
