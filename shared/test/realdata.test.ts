// 真实内容数据（shared/data/*.json）的冒烟测试；数据缺失时跳过。
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateData } from '../src/data';
import { newRun, shopAction } from '../src/engine/shop';
import { generateBotTeam } from '../src/engine/bot';
import { battleForState } from '../src/engine/helpers';
import { applyBattleResult } from '../src/engine/result';
import { offlineOpponent, tutorialStep } from '../src/tutorial';
import type { RunState } from '../src/types';

const dir = fileURLToPath(new URL('../data/', import.meta.url));
const names = ['units', 'items', 'headlines', 'surprises', 'tutorial'] as const;
const present = names.slice(0, 4).every((n) => existsSync(join(dir, `${n}.json`)));
const read = (n: string) => (existsSync(join(dir, `${n}.json`)) ? JSON.parse(readFileSync(join(dir, `${n}.json`), 'utf8')) : undefined);

describe.skipIf(!present)('真实内容数据', () => {
  const data = present ? validateData({ units: read('units'), items: read('items'), headlines: read('headlines'), surprises: read('surprises'), tutorial: read('tutorial') }) : null!;

  it('通过校验：32 个商店单位、每阶都有', () => {
    expect(data.units.filter((u) => !u.token)).toHaveLength(32);
    for (let t = 1; t <= 6; t++) expect(data.shopUnitsByTier[t].length).toBeGreaterThan(0);
  });

  it('50 局完整对局（机器人式玩家 vs 机器人）无异常、≤ 20 回合', () => {
    for (let g = 0; g < 50; g++) {
      let s: RunState = newRun(`real-${g}`, data);
      for (let k = 0; k < 25 && s.phase !== 'over'; k++) {
        if (s.phase === 'headline') s = shopAction(s, { type: 'chooseHeadline', option: (g % 2) as 0 | 1 }, data);
        for (let b = 0; b < 8; b++) {
          const i = s.shop.findIndex((x) => x.kind === 'unit' && x.price <= s.gold);
          if (i < 0) break;
          const n = shopAction(s, { type: 'buy', slot: i }, data);
          if (n.error) break;
          s = n;
        }
        s = shopAction(s, { type: 'endShop' }, data);
        expect(s.phase).toBe('battle');
        s = applyBattleResult(s, battleForState(s, offlineOpponent(s, data), data), data);
        if (s.phase === 'result') s = shopAction(s, { type: 'continue' }, data);
        expect(s.error).toBeUndefined();
      }
      expect(s.phase).toBe('over');
      expect(s.turn).toBeLessThanOrEqual(20);
    }
  });

  it('机器人在真实数据下也够快、随回合变强', () => {
    const t0 = performance.now();
    let p3 = 0;
    let p10 = 0;
    for (let i = 0; i < 20; i++) {
      p3 += generateBotTeam(3, 0, data, `r${i}`).reduce((a, u) => a + u.atk + u.hp, 0);
      p10 += generateBotTeam(10, 0, data, `r${i}`).reduce((a, u) => a + u.atk + u.hp, 0);
    }
    expect((performance.now() - t0) / 40).toBeLessThan(20);
    expect(p10).toBeGreaterThan(p3);
  });

  it.skipIf(!existsSync(join(dir, 'tutorial.json')))('引导局可以开局', () => {
    const s = newRun('x', data, { tutorial: true });
    expect(tutorialStep(s)).toBe('buy');
    expect(s.shop.map((x) => x.defId)).toEqual([...data.tutorial!.turns[0].units, ...(data.tutorial!.turns[0].items ?? [])]);
  });
});
