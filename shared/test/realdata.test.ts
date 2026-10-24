// 真实内容数据（shared/data/*.json）：缺文件或不兼容时直接失败并给出清晰原因（不跳过）。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DataError, validateData, type RawGameData } from '../src/data';
import { newRun, shopAction } from '../src/engine/run';
import { botPlayTurn, generateArchetypeTeam } from '../src/engine/bot';
import { runTurnOffline } from '../src/engine/helpers';
import { tutorialStep } from '../src/tutorial';
import { FACTIONS, ROLES, type Archetype, type GameData, type RunState } from '../src/types';

const dir = fileURLToPath(new URL('../data/', import.meta.url));
const FILES = ['units', 'headlines', 'surprises', 'tutorial', 'equips', 'consumables', 'arenas', 'opponents', 'pve'] as const;
const missing = FILES.filter((n) => !existsSync(join(dir, `${n}.json`)));
const read = (n: string) => (existsSync(join(dir, `${n}.json`)) ? JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8')) : undefined);

function load(): GameData {
  if (missing.length) throw new Error(`shared/data 缺少 ${missing.map((m) => `${m}.json`).join('、')}（2.0 需要全部 ${FILES.length} 个内容文件）`);
  try {
    return validateData(Object.fromEntries(FILES.map((n) => [n, read(n)])) as unknown as RawGameData);
  } catch (e) {
    if (e instanceof DataError) throw new Error(`shared/data 与引擎不兼容（2.1 起 role 只认 multi/shield/summon/explode/growth/economy，见 DESIGN 16 / ENGINE_NOTES 12）：\n${e.problems.join('\n')}`);
    throw e;
  }
}

const ARCHES: Archetype[] = [...FACTIONS.map((f) => ({ faction: f })), ...ROLES.map((r) => ({ role: r }))];

describe('真实内容数据', () => {
  it('9 个内容文件齐全且通过校验：32 个商店单位、每阶都有、每个单位恰好 1 个打法关键词', () => {
    const data = load();
    if (data.warnings.length) console.info(`[realdata] 校验提醒：\n- ${data.warnings.join('\n- ')}`);
    const shop = data.units.filter((u) => !u.token);
    expect(shop).toHaveLength(32);
    for (let t = 1; t <= 6; t++) expect(data.shopUnitsByTier[t].length).toBeGreaterThan(0);
    expect(shop.filter((u) => !u.role).map((u) => u.id), '这些单位缺 role（DESIGN 16：每个单位恰好 1 个关键词）').toEqual([]);
    // DESIGN 16：每个关键词 5~6 个单位，T1~T2 至少 2 个
    for (const r of ROLES) {
      const list = shop.filter((u) => u.role === r);
      expect(list.length, `关键词 ${r} 的单位数（应 5~6）：${list.map((u) => u.id).join(',')}`).toBeGreaterThanOrEqual(5);
      expect(list.length, `关键词 ${r} 的单位数（应 5~6）：${list.map((u) => u.id).join(',')}`).toBeLessThanOrEqual(6);
      expect(list.filter((u) => u.tier <= 2).length, `关键词 ${r} 的 T1~T2 单位（应 ≥2）`).toBeGreaterThanOrEqual(2);
    }
    // 对手预设覆盖 6 个关键词中的大多数（AI 流派多样）
    const archRoles = new Set(data.opponents.map((o) => o.archetype.role).filter(Boolean));
    expect(archRoles.size, '对手预设里的关键词流派').toBeGreaterThanOrEqual(3);
    expect(data.equips.map((e) => e.id).sort()).toEqual(['alignment', 'dataset', 'distill', 'finetune', 'firewall', 'funding_round', 'gpu_h100', 'jumpbox', 'launch_event', 'quantize', 'rlhf', 'trending']);
    expect(data.arenas.length).toBeGreaterThanOrEqual(8);
    expect(data.opponents.length).toBeGreaterThanOrEqual(7);
  });

  it('机器人按流派偏好：阵营流派在回合 10 的该阵营占比 ≥ 50%', () => {
    const data = load();
    for (const f of FACTIONS) {
      let hit = 0;
      let tot = 0;
      for (let i = 0; i < 15; i++) {
        const t = generateArchetypeTeam({ faction: f }, 10, `real-${f}-${i}`, data);
        tot += t.length;
        hit += t.filter((u) => data.unitsById[u.defId].faction === f).length;
      }
      expect(hit / tot, f).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('引导局可以开局', () => {
    const data = load();
    const s = newRun('x', data, { tutorial: true });
    expect(tutorialStep(s, data)).toBe('buy');
    expect(s.shop.map((x) => x.defId)).toEqual([...data.tutorial!.turns[0].units, ...(data.tutorial!.turns[0].items ?? [])]);
  });

  it('完整模拟 200 局（机器人水平玩家，10 条流派轮流）：无异常；中位回合 10~14；平均名次约 4；吃鸡率 10%~25%', () => {
    const data = load();
    const turns: number[] = [];
    const ranks: number[] = [];
    for (let g = 0; g < 200; g++) {
      let s: RunState = shopAction(newRun(`D${g}`, data), { type: 'chooseArena', index: g % 3 }, data);
      expect(s.error).toBeUndefined();
      for (let k = 0; k < 25 && s.phase !== 'over'; k++) {
        s = botPlayTurn(s, data, { archetype: ARCHES[g % ARCHES.length] });
        expect(s.error).toBeUndefined();
        s = runTurnOffline(s, data, { pick: g % 3 }).state;
        expect(s.error).toBeUndefined();
      }
      expect(s.phase).toBe('over');
      expect(s.turn).toBeLessThanOrEqual(20);
      expect(s.end!.rank).toBeGreaterThanOrEqual(1);
      expect(s.end!.rank).toBeLessThanOrEqual(8);
      turns.push(s.turn);
      ranks.push(s.end!.rank);
    }
    turns.sort((a, b) => a - b);
    const median = turns[100];
    const avgRank = ranks.reduce((a, b) => a + b, 0) / ranks.length;
    const chicken = ranks.filter((r) => r === 1).length / ranks.length;
    console.info(`[realdata] 200 局：中位回合 ${median}，平均名次 ${avgRank.toFixed(2)}，吃鸡率 ${(chicken * 100).toFixed(1)}%`);
    expect(median).toBeGreaterThanOrEqual(10);
    expect(median).toBeLessThanOrEqual(14);
    expect(avgRank).toBeGreaterThan(3.4);
    expect(avgRank).toBeLessThan(4.6);
    expect(chicken).toBeGreaterThanOrEqual(0.1);
    expect(chicken).toBeLessThanOrEqual(0.25);
  }, 180_000);
});
