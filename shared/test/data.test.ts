import { describe, expect, it } from 'vitest';
import { data, raw } from './helpers';
import { DataError, parseTarget, validateData } from '../src/data';
import { DEFAULT_EQUIPS } from '../src/defaults';
import { Rng, hashSeed, mulberry32 } from '../src/rng';

const clone = <T>(x: T): T => structuredClone(x);
const problems = (r: Parameters<typeof validateData>[0]): string => {
  try {
    validateData(r);
  } catch (e) {
    expect(e).toBeInstanceOf(DataError);
    return (e as DataError).problems.join('\n');
  }
  throw new Error('应当校验失败');
};

describe('validateData', () => {
  it('fixtures 合法，并建立索引（含 2.0 的装备/消耗品/赛场/对手/PVE）', () => {
    expect(data.unitsById.token_shuijun.token).toBe(true);
    expect(data.shopUnitsByTier[1].every((u) => !u.token && u.tier === 1)).toBe(true);
    expect(data.equips).toHaveLength(12);
    expect(data.consumables).toHaveLength(3);
    expect(data.arenas).toHaveLength(10);
    expect(data.opponents).toHaveLength(8);
    expect(data.pve.map((p) => p.turn)).toEqual([4, 9]);
    expect(data.tutorial?.turns).toHaveLength(3);
  });
  it('单位：role（含中文别名）、lines 对象 {common, onSynergy} / 数组旧格式、attackTarget、新效果', () => {
    expect(data.unitsById.prompt_eng).toMatchObject({ role: 'growth', lines: { general: ['请一步一步思考'], onSynergy: ['工程师集合！'] } });
    expect(data.unitsById.crawler.lines).toEqual({ general: ['这页我收下了'] });
    const units = clone(raw.units) as Record<string, unknown>[];
    units[0] = { ...units[0], role: '自爆', attackTarget: 'lowestHpEnemy', lines: { kill: ['a'], onSynergy: ['b', 'c'] } };
    const d = validateData({ ...raw, units });
    expect(d.unitsById.prompt_eng).toMatchObject({ role: 'explode', attackTarget: 'lowestHpEnemy', lines: { general: ['a'], onSynergy: ['b', 'c'] } });
    for (const eff of ['steal', 'explode', 'doubleStats', 'revive', 'chain']) {
      units[1] = { ...units[1], ability: { trigger: 'faint', effect: eff, target: 'self', desc: 'x' } };
      expect(() => validateData({ ...raw, units })).not.toThrow();
    }
  });
  it('报告错误：未知触发器 / 效果 / 缺 desc / 引用不存在单位 / 非法 role', () => {
    const units = clone(raw.units) as Record<string, unknown>[];
    units[0].ability = { trigger: 'nope', effect: 'buff', target: 'self' };
    units[1].ability = { trigger: 'faint', effect: 'summon', target: 'self', unitId: 'ghost', desc: 'x' };
    units[2].role = 'pirate';
    units[3].ability = { trigger: 'faint', effect: 'teleport', target: 'self', desc: 'x' };
    const p = problems({ ...raw, units });
    expect(p).toMatch(/未知 trigger "nope"/);
    expect(p).toMatch(/缺少 desc/);
    expect(p).toMatch(/ghost/);
    expect(p).toMatch(/role 应为/);
    expect(p).toMatch(/未知 effect "teleport"/);
  });
  it('2.1：旧职业 role（researcher/trader/idol/engineer 及中文）一律拒绝，并提示改成打法关键词', () => {
    const units = clone(raw.units) as Record<string, unknown>[];
    units[0].role = 'researcher';
    units[1].role = '偶像';
    units[2].ability = { trigger: 'startBattle', effect: 'buff', target: 'allFriends', filter: { role: 'engineer' }, desc: 'x' };
    const arenas = clone(raw.arenas) as Record<string, unknown>[];
    arenas[0] = { ...arenas[0], effect: { type: 'synergyBonus', key: 'idol', amount: 1 } };
    arenas[1] = { ...arenas[1], effect: { type: 'priceMod', kind: 'unit', amount: -1, filter: { role: 'trader' } } };
    const opponents = clone(raw.opponents) as Record<string, unknown>[];
    opponents[0] = { ...opponents[0], archetype: 'researcher' };
    const p = problems({ ...raw, units, arenas, opponents });
    expect(p).toMatch(/单位 prompt_eng: role "researcher" 是 2\.0 的旧职业（研究员），2\.1 已改为打法关键词，请改成 multi\/shield\/summon\/explode\/growth\/economy/);
    expect(p).toMatch(/role "偶像" 是 2\.0 的旧职业/);
    expect(p).toMatch(/filter\.role "engineer" 是 2\.0 的旧职业（工程师）/);
    expect(p).toMatch(/synergyBonus\.key "idol" 是 2\.0 的旧职业/);
    expect(p).toMatch(/priceMod\.filter\.role "trader" 是 2\.0 的旧职业/);
    expect(p).toMatch(/archetype "researcher" 是 2\.0 的旧职业/);
    // 新值与中文别名都接受
    units.splice(0, 3, ...clone(raw.units).slice(0, 3));
    for (const [v, k] of [['多刀', 'multi'], ['shield', 'shield'], ['召唤', 'summon'], ['explode', 'explode'], ['成长', 'growth'], ['经济', 'economy']]) {
      units[0] = { ...(raw.units[0] as object), role: v };
      expect(validateData({ ...raw, units }).unitsById.prompt_eng.role).toBe(k);
    }
  });
  it('宽松规范化：randomFriend(2)、中文阵营、{units:[…]} 包装、缺省 avatar', () => {
    const units = clone(raw.units) as Record<string, unknown>[];
    units[0] = { ...units[0], faction: '开源', avatar: undefined, ability: { trigger: 'startBattle', effect: 'buff', target: 'randomFriend(2)', amount: 1, desc: 'x' } };
    const d = validateData({ ...raw, units: { units } });
    const u = d.unitsById[units[0].id as string];
    expect(u.faction).toBe('open');
    expect(u.avatar).toBe(`units/${u.id}.svg`);
    expect(u.ability).toMatchObject({ target: 'randomFriend', n: 2 });
    expect(parseTarget('nobody')).toBeNull();
  });
  it('装备：内容侧的 type 写法 → 引擎效果；扁平写法也认；读不懂且是固定 id → 回退内置并提醒；未知 type 报错', () => {
    expect(data.equipsById.firewall).toMatchObject({ slot: 'armor', effect: { startShield: 4 }, goldEffect: { startShield: 8, shieldReflect: 2 } });
    expect(data.equipsById.jumpbox.goldEffect).toEqual({ revive: { ratio: 0.5, to: 'back' } });
    expect(data.equipsById.distill.goldEffect).toEqual({ copyNeighbor: ['atk', 'hp'] });
    expect(data.equipsById.funding_round.effect).toEqual({ turnGold: 1, sellGold: 3 });
    expect(data.equipsById.alignment.effect).toEqual({ atk: -1, hp: 5, immuneBelow: 1 });
    expect(data.equipsById.trending.goldEffect).toEqual({ retarget: 'lowestHpEnemy', atk: 2 });
    const equips = clone(raw.equips) as Record<string, unknown>[];
    equips[0] = { ...equips[0], effect: { atk: 4 }, goldEffect: 'whatever' };
    equips[1] = { ...equips[1], effect: 'magic' };
    const d = validateData({ ...raw, equips });
    expect(d.equipsById.gpu_h100.effect).toEqual({ atk: 4 });
    expect(d.equipsById.gpu_h100.goldEffect).toEqual(DEFAULT_EQUIPS[0].goldEffect);
    expect(d.equipsById.quantize.effect).toEqual(DEFAULT_EQUIPS[1].effect);
    expect(d.warnings.join()).toMatch(/装备 quantize: effect 写法引擎读不懂/);
    equips[2] = { ...equips[2], effect: { type: 'laser' } };
    expect(problems({ ...raw, equips })).toMatch(/未知装备效果 type "laser"/);
  });
  it('赛场：effect 类型写法（priceMod/statAll/economy/rerollBuff/shopSlots/summonBuff/synergyBonus/startShield）', () => {
    expect(data.arenasById.open_summit.rules).toEqual({ factionPriceMod: { faction: 'open', amount: -1 } });
    expect(data.arenasById.gpu_drought.rules).toEqual({ battleBuff: { atk: 1, hp: -1 } });
    expect(data.arenasById.funding_winter.rules).toEqual({ goldPerTurn: 2, unitSlotsMod: -1 });
    expect(data.arenasById.reroll_party.rules).toEqual({ rerollFree: true, unitPriceMod: 1 });
    expect(data.arenasById.seat_one_aura.rules).toEqual({ rerollFrontBuff: { atk: 1, hp: 1 } });
    expect(data.arenasById.equip_expo.rules).toEqual({ equipSlotsMod: 1 });
    expect(data.arenasById.summon_fest.rules).toEqual({ synergyBonus: [{ key: 'summon', amount: 1 }] });
    expect(data.arenasById.growth_camp.rules).toEqual({ rolePriceMod: { role: 'growth', amount: -1 } });
    expect(data.arenasById.safety_act.rules).toEqual({ startShield: { amount: 2, filter: { faction: 'closed' } } });
    const arenas = clone(raw.arenas) as Record<string, unknown>[];
    arenas[0] = { ...arenas[0], effect: { type: 'meteor' } };
    expect(problems({ ...raw, arenas })).toMatch(/未知赛场效果 type "meteor"/);
  });
  it('对手预设：archetype 字符串、core、taunt；PVE：team、boss、rewards', () => {
    expect(data.opponents[0]).toMatchObject({ archetype: { faction: 'compute' }, core: expect.any(Array), taunt: { defeated: expect.any(String) } });
    expect(data.opponents.find((o) => o.id === 'opp_deepseek')!.archetype).toEqual({ role: 'shield' });
    const p = data.pve[1];
    expect(p).toMatchObject({ id: 'pve_huang', boss: { defId: 'boss_huang' }, rewards: { pick: 3 } });
    expect(p.units.at(-1)).toEqual({ defId: 'boss_huang', atk: 8, hp: 20 });
    const pve = clone(raw.pve) as Record<string, unknown>[];
    pve[0] = { ...pve[0], team: [{ defId: 'nobody' }] };
    expect(problems({ ...raw, pve })).toMatch(/未知单位 "nobody"/);
  });
  it('缺少 2.0 新文件：用引擎内置默认并在 warnings 里写清楚；items.json 只提醒', () => {
    const d = validateData({ units: raw.units, headlines: raw.headlines, surprises: raw.surprises, items: [] });
    expect(d.equips).toHaveLength(12);
    expect(d.arenas.length).toBeGreaterThanOrEqual(8);
    expect(d.opponents).toHaveLength(8);
    const w = d.warnings.join('\n');
    for (const f of ['equips', 'consumables', 'arenas', 'opponents', 'pve']) expect(w).toContain(`缺少 ${f}.json`);
    expect(w).toMatch(/items\.json 是 1\.0 的基建/);
  });
  it('头条/突发：2.0 新效果规范化与校验', () => {
    const headlines = clone(raw.headlines) as Record<string, unknown>[];
    const opt = (effect: unknown) => ({ ...headlines[0], options: [{ label: 'a', effect }, { label: 'b', effect: { type: 'gold', amount: 1 } }] });
    const ok = (effect: unknown) => validateData({ ...raw, headlines: [opt(effect)] }).headlines[0].options[0].effect;
    expect(ok({ type: 'firstStrike', side: 'me' })).toEqual({ type: 'firstStrike', side: 'me' });
    expect(ok({ type: 'battleStatMul', hp: 2, side: 'both' })).toEqual({ type: 'battleStatMul', hp: 2, side: 'both' });
    expect(ok({ type: 'stealEnemy', target: 'randomEnemy' })).toEqual({ type: 'stealEnemy', target: 'randomEnemy' });
    expect(ok({ type: 'swapAll', side: 'enemy' })).toEqual({ type: 'swapAll', side: 'enemy' });
    expect(ok({ type: 'synergyBonus', key: 'growth', amount: 2 })).toEqual({ type: 'synergyBonus', key: 'growth', amount: 2 });
    expect(ok({ type: 'synergyBonus', key: '召唤', amount: 1 })).toEqual({ type: 'synergyBonus', key: 'summon', amount: 1 });
    expect(ok({ type: 'freeEquip', gold: true })).toEqual({ type: 'freeEquip', gold: true });
    const p = problems({ ...raw, headlines: [opt({ type: 'addEnemyBoss', unitId: 'ghost', atk: 1, hp: 1, rewardMul: 2 }), { ...opt({ type: 'firstStrike', side: 'up' }), id: 'h2' }, { ...opt({ type: 'stealEnemy', target: 'self' }), id: 'h3' }] });
    expect(p).toMatch(/单位 "ghost" 不存在/);
    expect(p).toMatch(/firstStrike.side 应为 me\/enemy/);
    expect(p).toMatch(/stealEnemy.target 应为敌方目标/);
  });
  it('引导：equips/consumables 合并进 items，order 校验', () => {
    expect(data.tutorial!.turns[1].items).toEqual(['firewall', 'coffee']);
    expect(data.tutorial!.order).toEqual(['buy', 'fight', 'equip', 'merge', 'synergy', 'fight', 'headline', 'fight', 'done']);
    const tutorial = { ...clone(raw.tutorial), order: ['buy', 'dance'] };
    expect(problems({ ...raw, tutorial })).toMatch(/未知步骤 dance/);
  });
  it('头条必须恰好 2 个选项', () => {
    const headlines = clone(raw.headlines) as Record<string, unknown>[];
    (headlines[0].options as unknown[]).pop();
    expect(() => validateData({ ...raw, headlines })).toThrow(/options 必须恰好 2 个/);
  });
});

describe('rng', () => {
  it('同种子同序列，值域 [0,1)', () => {
    const a = mulberry32('abc');
    const b = mulberry32('abc');
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(hashSeed('a')).not.toBe(hashSeed('b'));
  });
  it('状态可导出再恢复', () => {
    const r = new Rng('s');
    r.next();
    const r2 = Rng.fromState(r.state);
    expect(r2.next()).toBe(r.next());
  });
  it('weighted / sample', () => {
    const r = new Rng('w');
    const c = [0, 0, 0];
    for (let i = 0; i < 3000; i++) c[r.weighted([1, 2, 3])]++;
    expect(c[2]).toBeGreaterThan(c[1]);
    expect(c[1]).toBeGreaterThan(c[0]);
    expect(new Set(r.sample([1, 2, 3, 4], 4)).size).toBe(4);
  });
});
