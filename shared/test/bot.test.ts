import { describe, expect, it } from 'vitest';
import { data } from './helpers';
import { botPlayTurn, generateArchetypeTeam, generateBotTeam, scaleTeam } from '../src/engine/bot';
import { newRun } from '../src/engine/run';
import { effectiveStats, equipCount } from '../src/engine/equip';
import { FACTIONS, ROLES, type Archetype } from '../src/types';

const power = (t: ReturnType<typeof generateBotTeam>) => t.reduce((a, u) => a + effectiveStats(u, data, t).atk + effectiveStats(u, data, t).hp, 0);

describe('generateArchetypeTeam', () => {
  it('合法：≤5 个单位，defId 存在，确定性', () => {
    const a = generateArchetypeTeam({ faction: 'open' }, 8, 'x', data);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(5);
    for (const u of a) expect(data.unitsById[u.defId]).toBeDefined();
    expect(generateArchetypeTeam({ faction: 'open' }, 8, 'x', data)).toEqual(a);
  });
  it('按流派偏好购买：回合 10 时阵营流派的该阵营单位占比 ≥ 50%（每阵营 20 局平均）', () => {
    for (const f of FACTIONS) {
      let hit = 0;
      let tot = 0;
      for (let i = 0; i < 20; i++) {
        const t = generateArchetypeTeam({ faction: f }, 10, `${f}${i}`, data);
        tot += t.length;
        hit += t.filter((u) => data.unitsById[u.defId].faction === f).length;
      }
      expect(hit / tot, f).toBeGreaterThanOrEqual(0.5);
    }
  });
  it('关键词流派也偏向该关键词（占比明显高于随机；只测 fixtures 里 ≥4 个单位的关键词）', () => {
    for (const r of ROLES.filter((k) => data.units.filter((u) => !u.token && u.role === k).length >= 4)) {
      let hit = 0;
      let tot = 0;
      for (let i = 0; i < 20; i++) {
        const t = generateArchetypeTeam({ role: r }, 10, `${r}${i}`, data);
        tot += t.length;
        hit += t.filter((u) => data.unitsById[u.defId].role === r).length;
      }
      expect(hit / tot, r).toBeGreaterThanOrEqual(0.4);
    }
  });
  it('装备往主力上堆、会合体进化、随回合变强', () => {
    let equipped = 0;
    let stacked = 0;
    let lv2 = 0;
    let p4 = 0;
    let p12 = 0;
    for (let i = 0; i < 20; i++) {
      const t = generateArchetypeTeam({ faction: 'compute' } as Archetype, 12, `c${i}`, data);
      equipped += t.reduce((a, u) => a + equipCount(u), 0);
      if (t.some((u) => equipCount(u) >= 2)) stacked++;
      lv2 += t.filter((u) => u.level >= 2).length;
      p12 += power(t);
      p4 += power(generateArchetypeTeam({ faction: 'compute' }, 4, `c${i}`, data));
    }
    expect(equipped / 20).toBeGreaterThan(2);
    expect(stacked).toBeGreaterThan(10);
    expect(lv2).toBeGreaterThan(10);
    expect(p12).toBeGreaterThan(p4 * 1.5);
  });
  it('scaleTeam 按系数缩放（含临时加成），攻 ≥ 0、血 ≥ 1；opts.scale 生效', () => {
    const t = generateBotTeam(6, data, 'k');
    const s = scaleTeam(t, 0.5);
    s.forEach((u, i) => expect(u.atk + u.tempAtk).toBe(Math.max(0, Math.round((t[i].atk + t[i].tempAtk) * 0.5))));
    expect(generateBotTeam(6, data, 'k', { scale: 0.5 })).toEqual(s.map((u) => ({ ...u })));
  });
  it('足够快：回合 20 的机器人 < 60ms', () => {
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) generateArchetypeTeam({ role: 'economy' }, 20, `f${i}`, data);
    expect((performance.now() - t0) / 5).toBeLessThan(60);
  });
  it('botPlayTurn：替玩家按流派购物（纯函数）', () => {
    const s = newRun('bp', data, { arena: null });
    const n = botPlayTurn(s, data, { archetype: { faction: 'folk' } });
    expect(n.team.filter(Boolean).length).toBeGreaterThan(0);
    expect(s.team.every((u) => u === null)).toBe(true);
    expect(n.phase).toBe('shop');
  });
});
