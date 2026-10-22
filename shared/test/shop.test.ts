import { describe, expect, it } from 'vitest';
import { custom, data, mk, setTeam } from './helpers';
import {
  maxItemTierForTurn, maxTierForTurn, newRun, shopAction, itemSlotsForTurn, unitSlotsForTurn, rollShop, makeCtx,
} from '../src/engine/shop';
import type { GameData, ItemDef, RunState, ShopSlot } from '../src/types';
import { battleForState } from '../src/engine/helpers';

const unitSlot = (defId: string, price = 3): ShopSlot => ({ kind: 'unit', defId, price, frozen: false });
const itemSlot = (defId: string, price: number): ShopSlot => ({ kind: 'item', defId, price, frozen: false });
const act = (s: RunState, a: Parameters<typeof shopAction>[1], d: GameData = data) => {
  const n = shopAction(s, a, d);
  expect(n.error, `动作 ${a.type} 失败`).toBeUndefined();
  return n;
};
const units = (s: RunState) => s.team.filter(Boolean);

describe('newRun', () => {
  it('开局 5 信心 0 热搜 回合 1 10 算力，商店 3 单位 + 1 基建', () => {
    const s = newRun('seed-a', data);
    expect(s).toMatchObject({ turn: 1, gold: 10, lives: 5, trophies: 0, phase: 'shop' });
    expect(s.team).toHaveLength(5);
    expect(s.shop.filter((x) => x.kind === 'unit')).toHaveLength(3);
    expect(s.shop.filter((x) => x.kind === 'item')).toHaveLength(1);
    expect(s.shop.every((x) => x.kind === 'item' || data.unitsById[x.defId].tier === 1)).toBe(true);
  });
  it('同种子完全一致，不同种子不同', () => {
    expect(newRun('x', data)).toEqual(newRun('x', data));
    const shops = new Set(Array.from({ length: 10 }, (_, i) => JSON.stringify(newRun(`s${i}`, data).shop)));
    expect(shops.size).toBeGreaterThan(1);
  });
});

describe('购买 / 出售 / 刷新 / 冻结 / 交换', () => {
  const base = () => ({ ...newRun('b', data), shop: [unitSlot('wrapper'), unitSlot('crawler'), unitSlot('wrapper'), itemSlot('coffee', 3)] });

  it('购买扣 3 算力，放进第一个空位；算力不够报错', () => {
    let s = act(base(), { type: 'buy', slot: 0 });
    expect(s.gold).toBe(7);
    expect(s.team[0]?.defId).toBe('wrapper');
    expect(s.shop).toHaveLength(3);
    s = { ...s, gold: 2 };
    const f = shopAction(s, { type: 'buy', slot: 0 }, data);
    expect(f.error).toMatch(/算力不够/);
    expect(f.gold).toBe(2);
  });
  it('可以买到指定空位；指定位置有异名单位时报错', () => {
    let s = act(base(), { type: 'buy', slot: 0, to: 3 });
    expect(s.team[3]?.defId).toBe('wrapper');
    expect(shopAction(s, { type: 'buy', slot: 0, to: 3 }, data).error).toBeTruthy();
  });
  it('队伍满了不能买到空位', () => {
    const s = setTeam(base(), ['kimi', 'kimi', 'kimi', 'kimi', 'kimi'].map((d) => mk(d)));
    expect(shopAction(s, { type: 'buy', slot: 1 }, data).error).toMatch(/队伍满/);
  });
  it('出售得到 = 等级 的算力，并触发 sell 技能', () => {
    let s = setTeam(base(), [mk('wrapper', { level: 2, xp: 2 }), mk('labeler')]);
    s = act(s, { type: 'sell', index: 0 });
    expect(s.gold).toBe(12);
    s = act(s, { type: 'sell', index: 1 }); // 标注员：+1 等级价 +1 技能
    expect(s.gold).toBe(14);
    expect(units(s)).toHaveLength(0);
  });
  it('刷新花 1 算力并换掉未冻结槽，冻结槽保留', () => {
    let s = newRun('r', data);
    s = act(s, { type: 'freeze', slot: 0 });
    const frozen = s.shop[0];
    expect(frozen.frozen).toBe(true);
    s = act(s, { type: 'reroll' });
    expect(s.gold).toBe(9);
    expect(s.shop[0]).toEqual(frozen);
    expect(s.shop.filter((x) => x.kind === 'unit')).toHaveLength(3);
    const f = shopAction({ ...s, gold: 0 }, { type: 'reroll' }, data);
    expect(f.error).toBeTruthy();
  });
  it('冻结的槽位下回合保留，再点一次解冻', () => {
    let s = newRun('f', data);
    s = act(s, { type: 'freeze', slot: 1 });
    const kept = s.shop[1];
    s = act(s, { type: 'endShop' });
    s = { ...s, phase: 'result' };
    s = act(s, { type: 'continue' });
    if (s.phase === 'headline') s = act(s, { type: 'chooseHeadline', option: 0 });
    expect(s.shop.some((x) => x.defId === kept.defId && x.frozen)).toBe(true);
    const i = s.shop.findIndex((x) => x.frozen);
    s = act(s, { type: 'freeze', slot: i });
    expect(s.shop[i].frozen).toBe(false);
  });
  it('交换位置（含空位）', () => {
    let s = setTeam(base(), [mk('wrapper'), mk('crawler')]);
    s = act(s, { type: 'swap', a: 0, b: 4 });
    expect(s.team[0]).toBeNull();
    expect(s.team[4]?.defId).toBe('wrapper');
    s = act(s, { type: 'swap', a: 1, b: 4 });
    expect(s.team[1]?.defId).toBe('wrapper');
    expect(s.team[4]?.defId).toBe('crawler');
  });
  it('非商店阶段不能操作', () => {
    const s = { ...newRun('p', data), phase: 'battle' as const };
    expect(shopAction(s, { type: 'reroll' }, data).error).toBeTruthy();
  });
  it('shopAction 不修改入参（纯函数）', () => {
    const s = base();
    const snap = JSON.stringify(s);
    shopAction(s, { type: 'buy', slot: 0 }, data);
    expect(JSON.stringify(s)).toBe(snap);
  });
});

describe('阶级解锁与权重 / 槽位', () => {
  it('解锁回合：T1@1 T2@3 T3@5 T4@7 T5@9 T6@11', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20].map(maxTierForTurn)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6]);
    expect([1, 4, 5, 8, 9].map(unitSlotsForTurn)).toEqual([3, 3, 4, 4, 5]);
    expect([1, 2, 3].map(itemSlotsForTurn)).toEqual([1, 1, 2]);
    expect([1, 5, 9].map(maxItemTierForTurn)).toEqual([1, 2, 3]);
  });
  it('商店只出已解锁阶，最高阶权重最高、低阶递减', () => {
    const s = { ...newRun('w', data), turn: 11 };
    const ctx = makeCtx(s, data);
    const count = [0, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 600; i++) {
      rollShop(ctx);
      for (const sl of ctx.s.shop) if (sl.kind === 'unit') count[data.unitsById[sl.defId].tier]++;
    }
    // 每阶的单位数不同，按"每个单位平均出现次数"比较
    const per = (t: number) => count[t] / data.shopUnitsByTier[t].length;
    expect(per(6)).toBeGreaterThan(per(1));
    expect(per(5)).toBeGreaterThan(per(2));
    const early = { ...newRun('w2', data), turn: 3 };
    const c2 = makeCtx(early, data);
    for (let i = 0; i < 100; i++) {
      rollShop(c2);
      expect(c2.s.shop.every((x) => x.kind === 'item' || data.unitsById[x.defId].tier <= 2)).toBe(true);
    }
  });
  it('回合 5 起 4 个单位槽，回合 3 起 2 个基建槽', () => {
    const s = { ...newRun('q', data), turn: 5 };
    const ctx = makeCtx(s, data);
    rollShop(ctx);
    expect(ctx.s.shop.filter((x) => x.kind === 'unit')).toHaveLength(4);
    expect(ctx.s.shop.filter((x) => x.kind === 'item')).toHaveLength(2);
  });
});

describe('合并进化', () => {
  const base = () => ({ ...newRun('m', data), gold: 30, shop: [unitSlot('wrapper'), unitSlot('wrapper'), unitSlot('wrapper'), unitSlot('wrapper'), unitSlot('wrapper'), unitSlot('wrapper')] });

  it('买到同名单位上合并：属性 = 最高值 +1/+1，xp +1', () => {
    let s = setTeam(base(), [mk('wrapper', { atk: 5, hp: 1 })]);
    s = act(s, { type: 'buy', slot: 0, to: 0 });
    expect(s.team[0]).toMatchObject({ atk: 6, hp: 3, xp: 1, level: 1 });
    expect(units(s)).toHaveLength(1);
  });
  it('3 份 → Lv2 并在商店刷出比当前最高阶高一阶的免费单位', () => {
    let s = act(base(), { type: 'buy', slot: 0 });
    s = act(s, { type: 'buy', slot: 0 });
    expect(s.team[0]?.level).toBe(1);
    s = act(s, { type: 'buy', slot: 0 });
    expect(s.team[0]).toMatchObject({ level: 2, xp: 2, atk: 4, hp: 4 });
    expect(s.lastLevelUp).toEqual({ uid: s.team[0]!.uid, level: 2 });
    const free = s.shop.filter((x) => x.free);
    expect(free).toHaveLength(1);
    expect(free[0].price).toBe(0);
    expect(data.unitsById[free[0].defId].tier).toBe(maxTierForTurn(s.turn) + 1);
    // 免费槽：0 算力购买；刷新不会被替换
    s = act(s, { type: 'reroll' });
    expect(s.shop.some((x) => x.free)).toBe(true);
  });
  it('6 份 → Lv3 满级，再买同名会放到空位', () => {
    let s = { ...base(), gold: 40, shop: [...base().shop, unitSlot('wrapper')] };
    for (let i = 0; i < 6; i++) s = act(s, { type: 'buy', slot: s.shop.findIndex((x) => x.defId === 'wrapper' && !x.free) });
    expect(s.team[0]).toMatchObject({ level: 3, xp: 5 });
    expect(s.shop.filter((x) => x.free)).toHaveLength(2);
    const w = s.shop.findIndex((x) => x.defId === 'wrapper');
    expect(w).toBeGreaterThanOrEqual(0);
    expect(shopAction(s, { type: 'buy', slot: w, to: 0 }, data).error).toMatch(/满级/);
    s = act(s, { type: 'buy', slot: w });
    expect(s.team[1]).toMatchObject({ defId: 'wrapper', level: 1 });
  });
  it('队伍内两个同名单位 merge', () => {
    let s = setTeam(base(), [mk('crawler', { atk: 3 }), null, mk('crawler', { hp: 7, xp: 1 })]);
    s = act(s, { type: 'merge', from: 0, to: 2 });
    expect(s.team[0]).toBeNull();
    expect(s.team[2]).toMatchObject({ atk: 4, hp: 8, xp: 2, level: 2 });
    expect(shopAction(setTeam(base(), [mk('crawler'), mk('wrapper')]), { type: 'merge', from: 0, to: 1 }, data).error).toBeTruthy();
  });
});

describe('价格修正', () => {
  it('priceMod 头条：单位降价 1；不会低于 1', () => {
    let s = newRun('pm', data);
    s = { ...s, phase: 'headline', pendingHeadline: data.headlines.find((h) => h.id === 'h_price_war')! };
    s = act(s, { type: 'chooseHeadline', option: 0 });
    expect(s.shop.filter((x) => x.kind === 'unit').every((x) => x.price === 2)).toBe(true);
    s = act(s, { type: 'buy', slot: 0 });
    expect(s.gold).toBe(8);
    const d = custom({ headlines: [{ id: 'cheap', title: 't', news: 'n', options: [{ label: 'a', effect: { type: 'priceMod', target: 'all', amount: -9 } }, { label: 'b', effect: { type: 'gold', amount: 1 } }] }] });
    let s2: RunState = { ...newRun('pm2', d), phase: 'headline', pendingHeadline: d.headlines[0] };
    s2 = act(s2, { type: 'chooseHeadline', option: 0 }, d);
    expect(s2.shop.every((x) => x.price === 1)).toBe(true);
  });
});

describe('基建', () => {
  const extra: ItemDef[] = [
    { id: 'i_copy', name: 'copy', desc: '', price: 1, targetKind: 'unit', effect: { type: 'copyStatsFrom' }, icon: '', tier: 1 },
    { id: 'i_lv', name: 'lv', desc: '', price: 1, targetKind: 'unit', effect: { type: 'levelUp' }, icon: '', tier: 1 },
    { id: 'i_tok', name: 'tok', desc: '', price: 1, targetKind: 'team', effect: { type: 'summonToken', unitId: 'token_gpu' }, icon: '', tier: 1 },
    { id: 'i_team', name: 'team', desc: '', price: 1, targetKind: 'team', effect: { type: 'teamBuff', atk: 1, hp: 2, permanent: false }, icon: '', tier: 1 },
    { id: 'i_front', name: 'front', desc: '', price: 1, targetKind: 'unit', effect: { type: 'pullFront' }, icon: '', tier: 1 },
    { id: 'i_tf', name: 'tf', desc: '', price: 1, targetKind: 'unit', effect: { type: 'transformRandomSameTier' }, icon: '', tier: 1 },
    { id: 'i_temp', name: 'temp', desc: '', price: 1, targetKind: 'unit', effect: { type: 'buff', atk: 3, hp: 0, permanent: false }, icon: '', tier: 1 },
  ];
  const d = custom({ items: extra });
  const withItem = (id: string, team = [mk('wrapper', {}, d), mk('kimi', {}, d)]) =>
    setTeam({ ...newRun('it', d), shop: [itemSlot(id, d.itemsById[id].price)] }, team);

  it('buff（永久）/ buff（临时）', () => {
    let s = act(withItem('coffee'), { type: 'useItem', slot: 0, target: 0 }, d);
    expect(s.team[0]).toMatchObject({ atk: 3, hp: 3 });
    expect(s.gold).toBe(7);
    expect(s.shop).toHaveLength(0);
    s = act(withItem('i_temp'), { type: 'useItem', slot: 0, target: 1 }, d);
    expect(s.team[1]).toMatchObject({ atk: 2, tempAtk: 3 });
  });
  it('unit 型基建必须选目标', () => {
    expect(shopAction(withItem('coffee'), { type: 'useItem', slot: 0 }, d).error).toMatch(/选择/);
  });
  it('shield / gold', () => {
    expect(act(withItem('firewall'), { type: 'useItem', slot: 0, target: 0 }, d).team[0]?.shield).toBe(3);
    expect(act(withItem('grant'), { type: 'useItem', slot: 0 }, d).gold).toBe(11);
  });
  it('copyStatsFrom：目标取两者较高属性', () => {
    const s = act(withItem('i_copy'), { type: 'useItem', slot: 0, target: 0, source: 1 }, d);
    expect(s.team[0]).toMatchObject({ atk: 2, hp: 5 });
    expect(shopAction(withItem('i_copy'), { type: 'useItem', slot: 0, target: 0 }, d).error).toBeTruthy();
  });
  it('levelUp：+1 级 +1/+1 并刷出免费单位；Lv3 不可用', () => {
    const s = act(withItem('i_lv'), { type: 'useItem', slot: 0, target: 0 }, d);
    expect(s.team[0]).toMatchObject({ level: 2, xp: 2, atk: 3, hp: 3 });
    expect(s.shop.some((x) => x.free)).toBe(true);
    const full = withItem('i_lv', [mk('wrapper', { level: 3, xp: 5 }, d)]);
    expect(shopAction(full, { type: 'useItem', slot: 0, target: 0 }, d).error).toMatch(/满级/);
  });
  it('summonToken：放到第一个空位；满员报错', () => {
    const s = act(withItem('i_tok'), { type: 'useItem', slot: 0 }, d);
    expect(s.team[2]?.defId).toBe('token_gpu');
    const full = withItem('i_tok', Array.from({ length: 5 }, () => mk('kimi', {}, d)));
    expect(shopAction(full, { type: 'useItem', slot: 0 }, d).error).toMatch(/满/);
  });
  it('teamBuff（临时）', () => {
    const s = act(withItem('i_team'), { type: 'useItem', slot: 0 }, d);
    expect(units(s).every((u) => u!.tempAtk === 1 && u!.tempHp === 2)).toBe(true);
  });
  it('pullFront：记为本场战斗开始时拉到最前（DESIGN 11.5）', () => {
    let s = act(withItem('i_front'), { type: 'useItem', slot: 0, target: 1 }, d);
    expect(s.team[0]?.defId).toBe('wrapper');
    expect(s.modifiers.battlePullFront).toEqual([s.team[1]!.uid]);
    s = act(s, { type: 'endShop' }, d);
    const r = battleForState(s, [mk('gpt_chan', {}, d)], d);
    const a = r.events.find((e) => e.type === 'attack');
    expect(a && a.type === 'attack' && a.me.defId).toBe('kimi');
  });
  it('transformRandomSameTier：变成同阶别的单位，保留额外属性', () => {
    const s = act(withItem('i_tf', [mk('wrapper', { atk: 5 }, d)]), { type: 'useItem', slot: 0, target: 0 }, d);
    const u = s.team[0]!;
    expect(u.defId).not.toBe('wrapper');
    expect(d.unitsById[u.defId].tier).toBe(1);
    expect(u.atk).toBe(d.unitsById[u.defId].atk + 3);
  });
});

describe('商店阶段触发器', () => {
  it('buy：提示词工程师被购买时随机友军永久 +1/+1', () => {
    let s = setTeam({ ...newRun('t', data), shop: [unitSlot('prompt_eng')] }, [mk('kimi')]);
    s = act(s, { type: 'buy', slot: 0 });
    expect(s.team[0]).toMatchObject({ atk: 3, hp: 6 });
  });
  it('friendBought：小扎给新买的友军永久 +1/+1（boughtUnit 目标）', () => {
    let s = setTeam({ ...newRun('t', data), shop: [unitSlot('wrapper')] }, [mk('zuck')]);
    s = act(s, { type: 'buy', slot: 0 });
    expect(s.team[1]).toMatchObject({ defId: 'wrapper', atk: 3, hp: 3 });
  });
  it('levelUp：达里奥进化时全队永久 +1/+1（含 perLevel 缩放 → Lv2 ×2）', () => {
    let s = setTeam({ ...newRun('t', data), gold: 20, shop: [unitSlot('dario'), unitSlot('dario')] }, [mk('dario', { xp: 0 }), mk('kimi')]);
    s = act(s, { type: 'buy', slot: 0 });
    s = act(s, { type: 'buy', slot: 0 });
    expect(s.team[0]?.level).toBe(2);
    expect(s.team[1]).toMatchObject({ atk: 4, hp: 7 }); // +2/+2
  });
  it('startTurn：Kimi 回合开始 +1 算力（Lv2 +2）', () => {
    let s = setTeam(newRun('t', data), [mk('kimi', { level: 2, xp: 2 })]);
    s = act(s, { type: 'endShop' });
    s = act({ ...s, phase: 'result' }, { type: 'continue' });
    if (s.phase === 'headline') s = act(s, { type: 'chooseHeadline', option: 1 });
    expect(s.gold).toBeGreaterThanOrEqual(12);
  });
  it('endTurn：显卡黄牛回合结束给前排 2 点护盾', () => {
    let s = setTeam(newRun('t', data), [mk('wrapper'), mk('scalper')]);
    s = act(s, { type: 'endShop' });
    expect(s.phase).toBe('battle');
    expect(s.team[0]?.shield).toBe(2);
  });
  it('eatItem：老黄使用基建时永久 +2/+2', () => {
    let s = setTeam({ ...newRun('t', data), shop: [itemSlot('firewall', 2)] }, [mk('huang')]);
    s = act(s, { type: 'useItem', slot: 0, target: 0 });
    expect(s.team[0]).toMatchObject({ atk: 7, hp: 9, shield: 3 });
  });
  it('friendSummoned（商店）：抱抱脸给基建召唤出的单位 +1/+1（临时）', () => {
    const d = custom({ items: [{ id: 'i_tok', name: 'tok', desc: '', price: 1, targetKind: 'team', effect: { type: 'summonToken', unitId: 'token_gpu' }, icon: '', tier: 1 }] });
    let s = setTeam({ ...newRun('t', d), shop: [itemSlot('i_tok', 1)] }, [mk('hf', {}, d)]);
    s = act(s, { type: 'useItem', slot: 0 }, d);
    expect(s.team[1]).toMatchObject({ defId: 'token_gpu', tempAtk: 1, tempHp: 1 });
  });
});
