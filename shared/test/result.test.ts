import { describe, expect, it } from 'vitest';
import { data, mk, res, setTeam, start } from './helpers';
import { buildSummary, type SummaryInput } from '../src/engine/summary';
import { simulateBattle } from '../src/engine/battle';
import { shopAction } from '../src/engine/run';
import { applyBattleResult, computeRunEnd } from '../src/engine/result';
import { computeSynergies } from '../src/engine/synergy';
import type { Level, SynergyKey } from '../src/types';

const syn = (counts: Partial<Record<SynergyKey, number>>) =>
  computeSynergies(Object.entries(counts).flatMap(([k, n]) => Array.from({ length: n ?? 0 }, () => mk(({ open: 'crawler', closed: 'wrapper', folk: 'labeler', compute: 'vibe_coder' } as Record<string, string>)[k]))), data);
const input = (over: Partial<SummaryInput>): SummaryInput => ({
  mine: new Map<string, { defId: string; level: Level }>([['a', { defId: 'labeler', level: 2 }], ['b', { defId: 'crawler', level: 1 }], ['c', { defId: 'wrapper', level: 1 }]]),
  myOrder: ['a', 'b', 'c'], damageByUid: {}, hitsTaken: {}, myReflect: 0, mySummons: 0, synergies: syn({}), ...over,
});

describe('BattleSummary 归因规则（DESIGN 14）', () => {
  it('MVP 伤害占比 ≥ 50% → "X 一人打出 N 点伤害"', () => {
    const s = buildSummary(input({ damageByUid: { a: 6, b: 4, e_x: 99 } }), data);
    expect(s).toMatchObject({ mvpUid: 'a', mvpDefId: 'labeler', reason: 'Lv2 标注员 一人打出 6 点伤害' });
  });
  it('民间 ≥ 4 且召唤物 ≥ 4 → 水军潮淹没对手', () => {
    const s = buildSummary(input({ damageByUid: { a: 2, b: 2, c: 2 }, mySummons: 4, synergies: syn({ folk: 4 }) }), data);
    expect(s.reason).toContain('水军潮淹没对手');
  });
  it('闭源 ≥ 4 且反弹伤害 ≥ 总伤害 30% → 对手撞死在盾上', () => {
    const s = buildSummary(input({ damageByUid: { a: 3, b: 3, c: 4 }, myReflect: 3, synergies: syn({ closed: 4 }) }), data);
    expect(s.reason).toContain('对手撞死在盾上');
  });
  it('否则 → "前排 X 硬扛了 N 枪"', () => {
    const s = buildSummary(input({ damageByUid: { a: 2, b: 2, c: 2 }, hitsTaken: { b: 5, a: 2 } }), data);
    expect(s.reason).toBe('前排 数据爬虫 硬扛了 5 枪');
  });
  it('战斗结果自带 summary：damageByUid、MVP、本场羁绊档位', () => {
    const r = simulateBattle([mk('kimi', { uid: 'K' }), mk('wrapper', { uid: 'W' })], [mk('crawler')], data, 's');
    expect(r.summary.damageByUid.K).toBeGreaterThan(0);
    expect(r.summary.mvpUid).toBeDefined();
    expect(r.summary.synergyTiers.map((x) => x.key)).toEqual(['closed']);
    expect(typeof r.summary.reason).toBe('string');
  });
});

describe('结算记录与结局', () => {
  it('永久 buff 写回、战斗收益到下回合、清除临时加成；记录 lastSummary 与历史', () => {
    let s = setTeam(start('r'), [mk('wrapper', { uid: 'W', tempAtk: 3, shield: 2 })]);
    s = shopAction(s, { type: 'endShop' }, data);
    const summary = { damageByUid: {}, reason: 'x', synergyTiers: syn({ open: 2 }).filter((x) => x.tier) };
    const n = applyBattleResult(s, res('draw', { permanentBuffs: [{ uid: 'W', atk: 1, hp: 2 }], bonus: { gold: 2, rerolls: 1, discount: 0 }, summary }), data);
    expect(n.team[0]).toMatchObject({ atk: 3, hp: 4, tempAtk: 0, shield: 0 });
    expect(n.modifiers).toMatchObject({ nextTurnGold: 2, nextFreeRerolls: 1 });
    expect(n.lastSummary?.reason).toBe('x');
    expect(n.stats.maxTiers.open).toBe(1);
    expect(n.history[0].summary?.reason).toBe('x');
  });
  it('RunEnd：名次、流派（按最终阵容最高羁绊档）、成就', () => {
    const s = setTeam(start('end'), [mk('crawler'), mk('qwen_chan'), mk('zuck'), mk('hf'), mk('wrapper')]);
    const e = computeRunEnd({ ...s, turn: 11, stats: { ...s.stats, maxTiers: { open: 2 }, goldEquips: 1, bestStreak: 5 } }, data, 3, 'eliminated');
    expect(e).toMatchObject({ rank: 3, won: false, reason: 'eliminated', turns: 11, archetype: 'open', archetypeName: '开源流' });
    expect(e.achievements).toEqual(expect.arrayContaining(['top4', 'survivor10', 'goldEquip', 'streak5', 'tier:open:2']));
    expect(e.bestUnit).toBeDefined();
    expect(computeRunEnd(setTeam(start('m'), [mk('crawler')]), data, 8, 'eliminated')).toMatchObject({ archetype: 'mixed', archetypeName: '杂牌军' });
  });
  it('非战斗阶段不能结算', () => {
    expect(applyBattleResult(start('x'), res('me'), data).error).toBeTruthy();
  });
});
