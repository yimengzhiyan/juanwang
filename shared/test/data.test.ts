import { describe, expect, it } from 'vitest';
import { data, raw } from './helpers';
import { DataError, parseTarget, validateData } from '../src/data';
import { Rng, hashSeed, mulberry32 } from '../src/rng';

describe('validateData', () => {
  it('fixtures 合法，并建立索引', () => {
    expect(data.units.length).toBeGreaterThanOrEqual(8);
    expect(data.unitsById.token_shuijun.token).toBe(true);
    expect(data.shopUnitsByTier[1].every((u) => !u.token && u.tier === 1)).toBe(true);
    expect(data.items).toHaveLength(3);
    expect(data.headlines).toHaveLength(4);
    expect(data.surprises).toHaveLength(3);
    expect(data.tutorial?.turns).toHaveLength(3);
  });
  it('fixtures 覆盖全部 16 个触发器', () => {
    const triggers = new Set(data.units.map((u) => u.ability?.trigger).filter(Boolean));
    expect(triggers.size).toBe(16);
  });
  it('报告错误：未知触发器 / 缺 desc / 引用不存在单位', () => {
    const units = structuredClone(raw.units) as Record<string, unknown>[];
    units[0].ability = { trigger: 'nope', effect: 'buff', target: 'self' };
    units[1].ability = { trigger: 'faint', effect: 'summon', target: 'self', unitId: 'ghost', desc: 'x' };
    try {
      validateData({ ...raw, units });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(DataError);
      const p = (e as DataError).problems.join('\n');
      expect(p).toMatch(/未知 trigger "nope"/);
      expect(p).toMatch(/缺少 desc/);
      expect(p).toMatch(/ghost/);
    }
  });
  it('宽松规范化：randomFriend(2)、中文阵营、{units:[…]} 包装、缺省 avatar', () => {
    const units = structuredClone(raw.units) as Record<string, unknown>[];
    units[0] = { ...units[0], faction: '开源', avatar: undefined, ability: { trigger: 'startBattle', effect: 'buff', target: 'randomFriend(2)', amount: 1, desc: 'x' } };
    const d = validateData({ ...raw, units: { units } });
    const u = d.unitsById[units[0].id as string];
    expect(u.faction).toBe('open');
    expect(u.avatar).toBe(`units/${u.id}.svg`);
    expect(u.ability).toMatchObject({ target: 'randomFriend', n: 2 });
    expect(parseTarget('allEnemies')).toEqual({ target: 'allEnemies', n: undefined });
    expect(parseTarget('nobody')).toBeNull();
  });
  it('头条必须恰好 2 个选项', () => {
    const headlines = structuredClone(raw.headlines) as Record<string, unknown>[];
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
