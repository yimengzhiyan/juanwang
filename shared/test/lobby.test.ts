import { describe, expect, it } from 'vitest';
import { data, mk, res, setTeam, start } from './helpers';
import { shopAction } from '../src/engine/run';
import { applyBattleResult } from '../src/engine/result';
import { createOpponents, hpLossFor, injectHumanOpponents, stageBonus } from '../src/engine/lobby';
import { DIFFICULTY } from '../src/engine/difficulty';
import type { RunState } from '../src/types';

const toBattle = (s: RunState) => {
  const n = shopAction(s, { type: 'endShop' }, data);
  expect(n.error).toBeUndefined();
  return n;
};

describe('8 人房', () => {
  it('开局 7 名对手：各绑一条流派（来自 opponents 预设），20 热度，AI', () => {
    const opps = createOpponents('L', data);
    expect(opps).toHaveLength(7);
    expect(new Set(opps.map((o) => o.id)).size).toBe(7);
    for (const o of opps) {
      const p = data.opponents.find((x) => x.id === o.presetId)!;
      expect(o).toMatchObject({ name: p.name, avatar: p.avatar, archetype: p.archetype, hp: 20, alive: true, isHuman: false });
    }
    expect(createOpponents('L', data)).toEqual(opps);
  });
  it('预设不足 7 个时循环使用，名字加编号', () => {
    const opps = createOpponents('L', { ...data, opponents: data.opponents.slice(0, 3) });
    expect(opps).toHaveLength(7);
    expect(new Set(opps.map((o) => o.id)).size).toBe(7);
    expect(opps[3].name).toMatch(/ 2$/);
  });
  it('endShop：所有对手按流派购物生成本回合阵容，并随机匹配一名对手（AI 阵容按难度缩放）', () => {
    const s = toBattle(setTeam(start('M'), [mk('wrapper')]));
    expect(s.opponents.every((o) => o.team.length > 0)).toBe(true);
    const m = s.matchup!;
    expect(m.kind).toBe('pvp');
    const o = s.opponents.find((x) => x.id === m.opponentId)!;
    expect(m.name).toBe(o.name);
    const k = DIFFICULTY.earlyScale;
    expect(m.team.map((x) => x.hp)).toEqual(o.team.map((x) => Math.max(1, Math.round((x.hp + x.tempHp) * k) - x.tempHp)));
  });
  it('尽量不连续两回合打同一个人', () => {
    let s = start('rep');
    let last = '';
    for (let t = 0; t < 3; t++) {
      s = toBattle(s);
      expect(s.matchup!.opponentId).not.toBe(last);
      last = s.matchup!.opponentId;
      s = applyBattleResult(s, res('draw'), data);
      s = shopAction({ ...s, surprisePending: false, lastSurprise: undefined }, { type: 'continue' }, data);
      if (s.phase === 'headline') s = shopAction(s, { type: 'chooseHeadline', option: 0 }, data);
    }
  });
});

describe('扣血公式（12.5）', () => {
  it('1 + 胜方存活单位数 + 回合阶段（1~4：0，5~8：1，9+：2）', () => {
    expect([1, 4, 5, 8, 9, 20].map(stageBonus)).toEqual([0, 0, 1, 1, 2, 2]);
    expect(hpLossFor(3, 2)).toBe(3);
    expect(hpLossFor(6, 3)).toBe(5);
    expect(hpLossFor(12, 4)).toBe(7);
  });
  it('输了自己扣血，赢了对手扣血，和局都不扣；同时生成 hpLoss 事件与历史', () => {
    const s = toBattle(start('H'));
    const lose = applyBattleResult(s, res('enemy', { survivors: 3 }), data);
    expect(lose.hp).toBe(20 - 4);
    expect(lose.lastEvents.find((e) => e.type === 'hpLoss' && e.who === 'me')).toMatchObject({ amount: 4, hp: 16, by: s.matchup!.opponentId });
    expect(lose.history[0]).toMatchObject({ turn: 1, winner: 'enemy', kind: 'pvp', hp: 16, hpLoss: 4, opponentId: s.matchup!.opponentId });
    const win = applyBattleResult(s, res('me', { survivors: 2 }), data);
    expect(win.hp).toBe(20);
    expect(win.opponents.find((o) => o.id === s.matchup!.opponentId)!.hp).toBe(17);
    expect(win.stats).toMatchObject({ wins: 1, streak: 1 });
    expect(applyBattleResult(s, res('draw'), data).hp).toBe(20);
  });
  it('其余对手两两互打：每回合除我的对手外都打了一场，输家扣血', () => {
    const s = applyBattleResult(toBattle(setTeam(start('O'), [mk('kimi')])), res('draw'), data);
    const others = s.opponents.filter((o) => o.id !== s.matchup!.opponentId);
    expect(others.every((o) => o.lastResult !== undefined)).toBe(true);
    const losers = s.lastEvents.filter((e) => e.type === 'hpLoss');
    expect(losers.length).toBeGreaterThan(0);
    for (const e of losers) if (e.type === 'hpLoss') expect(e.amount).toBeGreaterThanOrEqual(1);
  });
});

describe('淘汰与名次', () => {
  it('热度归零淘汰：剩 N 人、名次（同回合淘汰按剩余热度排）', () => {
    const s = toBattle(start('E'));
    const victim = s.matchup!.opponentId;
    s.opponents.find((o) => o.id === victim)!.hp = 2;
    const n = applyBattleResult(s, res('me', { survivors: 3 }), data);
    const o = n.opponents.find((x) => x.id === victim)!;
    expect(o).toMatchObject({ alive: false, hp: 0, eliminatedTurn: 1 });
    const ev = n.lastEvents.find((e) => e.type === 'eliminated' && e.who === victim)!;
    expect(ev).toMatchObject({ place: o.place });
    expect(o.place).toBeGreaterThanOrEqual(7);
    expect(n.phase).toBe('result');
  });
  it('玩家被淘汰 → over，带名次与结局', () => {
    const s = { ...toBattle(start('D')), hp: 2 };
    const n = applyBattleResult(s, res('enemy', { survivors: 4 }), data);
    expect(n.phase).toBe('over');
    expect(n.end).toMatchObject({ reason: 'eliminated', won: false, hp: 0 });
    expect(n.end!.rank).toBeGreaterThanOrEqual(2);
    expect(n.end!.rank).toBeLessThanOrEqual(8);
  });
  it('只剩自己 → 吃鸡（rank 1）', () => {
    const s = toBattle(start('W'));
    for (const o of s.opponents) {
      if (o.id === s.matchup!.opponentId) o.hp = 1;
      else {
        o.alive = false;
        o.hp = 0;
      }
    }
    const n = applyBattleResult(s, res('me', { survivors: 1 }), data);
    expect(n.end).toMatchObject({ rank: 1, won: true, reason: 'champion' });
    expect(n.end!.achievements).toContain('champion');
  });
  it('回合 20 兜底：按热度排名', () => {
    const s = { ...toBattle(start('T')), turn: 20, hp: 10 };
    s.opponents.forEach((o, i) => (o.hp = i < 2 ? 15 : 5));
    const n = applyBattleResult(s, res('draw'), data);
    expect(n.end).toMatchObject({ reason: 'turnLimit', rank: 3 });
  });
});

describe('真人快照注入', () => {
  it('injectHumanOpponents：替换 AI 为真人（名字/阵容/流派），当前对手被替换时同步 matchup（不缩放）', () => {
    const s = toBattle(start('I'));
    const opp = s.matchup!.opponentId;
    const snaps = [
      { name: '小明', team: [mk('kimi', { atk: 9 }), mk('dario')] },
      { name: '小红', team: [mk('crawler'), mk('qwen_chan'), mk('hf')] },
    ];
    const n = injectHumanOpponents(s, snaps, data);
    const humans = n.opponents.filter((o) => o.isHuman);
    expect(humans.map((o) => o.name)).toEqual(['小明', '小红']);
    expect(humans[1].archetype).toEqual({ faction: 'open' });
    expect(humans[0].team[0].atk).toBe(9);
    const idx = n.opponents.findIndex((o) => o.id === opp);
    if (idx < 2) expect(n.matchup).toMatchObject({ isHuman: true, name: snaps[idx].name });
    // 再次注入同名：替换同一个人
    const n2 = injectHumanOpponents(n, [{ name: '小红', team: [mk('agi')] }], data);
    expect(n2.opponents.filter((o) => o.isHuman)).toHaveLength(2);
    expect(n2.opponents.find((o) => o.name === '小红')!.team[0].defId).toBe('agi');
    expect(s.opponents.some((o) => o.isHuman)).toBe(false);
  });
});
