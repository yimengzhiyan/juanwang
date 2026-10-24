// 8 人房淘汰赛（DESIGN 12.5）：你 + 7 名对手，每人 20 热度。每回合你随机对一名存活对手，其余对手两两互打（引擎模拟）。
import { Rng } from '../rng';
import { clone } from '../clone';
import type { Archetype, GameData, Opponent, OpponentPreset, OpponentResult, RunState, Side, SynergyState, UnitInst } from '../types';
import { START_HP, log, emitEvent, type Ctx } from './shop';
import { advanceBot, newBotMemo, profileOf, scaleTeam, type BotProfile } from './bot';
import { opponentScale } from './difficulty';
import { simulateBattle } from './battle';
import { computeSynergies, dominantSynergy, isFaction, isRole, stateBonus } from './synergy';
import { pveForTurn, pveTeam } from './pve';
import { tutorialEnemy } from '../tutorial';

export const LOBBY_SIZE = 8;

/** 回合阶段加成：回合 1~4：0，5~8：1，9+：2 */
export function stageBonus(turn: number): number {
  return turn >= 9 ? 2 : turn >= 5 ? 1 : 0;
}
/** 扣血公式：1 + 胜方存活单位数 + 回合阶段 */
export function hpLossFor(turn: number, survivors: number): number {
  return 1 + Math.max(0, survivors) + stageBonus(turn);
}

/** 开局按 opponents 预设生成 7 名 AI 对手（预设不足 7 个时循环使用，名字加编号） */
export function createOpponents(seed: string, data: GameData): Opponent[] {
  const rng = new Rng(`${seed}:lobby`);
  const presets = data.opponents.length ? rng.sample(data.opponents, data.opponents.length) : [];
  const out: Opponent[] = [];
  for (let i = 0; i < LOBBY_SIZE - 1; i++) {
    const p: OpponentPreset | undefined = presets[i % Math.max(1, presets.length)];
    const loop = presets.length ? Math.floor(i / presets.length) : 0;
    const id = `${p?.id ?? 'opp'}${loop ? `_${loop + 1}` : ''}`;
    out.push({
      id, name: `${p?.name ?? `对手 ${i + 1}`}${loop ? ` ${loop + 1}` : ''}`, avatar: p?.avatar ?? 'units/botnet.svg', archetype: p?.archetype ?? {},
      ...(p ? { presetId: p.id } : {}), hp: START_HP, alive: true, team: [], isHuman: false,
      lastTeam: [], lastSynergies: [], hpHistory: [START_HP], bot: newBotMemo(`${seed}:opp:${id}`),
    });
  }
  return out;
}

function profileFor(o: Opponent, data: GameData): BotProfile {
  const preset = o.presetId ? data.opponents.find((p) => p.id === o.presetId) : undefined;
  return preset ? profileOf(preset) : { archetype: o.archetype };
}

/** 所有存活对手推进一个商店回合（生成本回合阵容） */
export function advanceOpponents(s: RunState, data: GameData): void {
  for (const o of s.opponents) {
    if (!o.alive) continue;
    const bonus = o.bot.bonusGold;
    const r = advanceBot(o.team, { ...o.bot, bonusGold: bonus }, s.turn, profileFor(o, data), data, s.arena, `${s.seed}:${o.id}`);
    o.team = r.team;
    o.bot = r.memo;
  }
}

/** 对手阵容的已激活羁绊（含赛场人数加成；头条只作用于玩家，不计） */
export function opponentSynergies(team: UnitInst[], s: Pick<RunState, 'arena'>, data: GameData): SynergyState[] {
  return computeSynergies(team, data, stateBonus({ arena: s.arena }, data)).filter((x) => x.tier > 0);
}

/** 旧存档补齐 2.1 的对手字段（lastTeam / lastSynergies / hpHistory；旧的字符串 lastResult 丢弃） */
export function normalizeOpponent(o: Opponent): void {
  o.lastTeam ??= [];
  o.lastSynergies ??= [];
  o.hpHistory ??= [START_HP];
  if (typeof o.lastResult !== 'object') delete o.lastResult;
}

/** 记下一名对手本轮的战斗：阵容快照、羁绊、结果 */
export function recordFight(o: Opponent, team: UnitInst[], s: Pick<RunState, 'arena'>, data: GameData, result: OpponentResult): void {
  normalizeOpponent(o);
  o.lastTeam = clone(team).map((u) => ({ ...u, equips: u.equips ?? {} }));
  o.lastSynergies = opponentSynergies(o.lastTeam, s, data);
  o.lastResult = result;
}

/** 从阵容判定流派（真人快照用） */
export function archetypeOfTeam(team: UnitInst[], data: GameData): Archetype {
  const d = dominantSynergy(computeSynergies(team, data));
  if (!d) return {};
  return isFaction(d.key) ? { faction: d.key } : isRole(d.key) ? { role: d.key } : {};
}

/**
 * 确定本回合对局（endShop 时调用）：PVE 回合 → 怪物队；否则随机一名存活对手（尽量不连续两回合同一人）。
 * AI 对手的阵容按难度缩放（opponentScale），真人快照不缩放。引导局前几回合用固定弱队。
 */
export function prepareMatchup(ctx: Ctx): void {
  const s = ctx.s;
  const data = ctx.data;
  advanceOpponents(s, data);
  const tut = tutorialEnemy(s, data);
  const pv = tut ? undefined : pveForTurn(s.turn, data);
  if (pv) {
    s.pve = { pveId: pv.id, turn: s.turn };
    s.matchup = { kind: 'pve', opponentId: pv.id, name: pv.name, team: pveTeam(pv, data), isHuman: false };
    return;
  }
  const alive = s.opponents.filter((o) => o.alive);
  if (!alive.length) {
    s.matchup = undefined;
    return;
  }
  const last = s.history.filter((h) => h.kind === 'pvp').at(-1)?.opponentId;
  const pool = alive.length > 1 ? alive.filter((o) => o.id !== last) : alive;
  const o = ctx.rng.pick(pool);
  const team = tut ?? (o.isHuman ? clone(o.team) : scaleTeam(clone(o.team), opponentScale(s.turn, s.hp)));
  s.matchup = { kind: 'pvp', opponentId: o.id, name: o.name, team, isHuman: o.isHuman };
}

export interface HumanSnapshot {
  name: string;
  team: UnitInst[];
  hp?: number;
  avatar?: string;
}

/**
 * 用服务端真人快照替换若干对手（phase = 'battle'，endShop 之后、开战之前调用；每回合都可以调用）。
 * 优先替换同名的真人，其次替换 AI（按顺序）。被替换者本回合阵容 = 快照（不缩放）；当前对局对手被替换时同步 matchup。
 * 返回新状态（纯函数）。
 */
export function injectHumanOpponents(state: RunState, snapshots: HumanSnapshot[], data: GameData): RunState {
  const s = clone(state);
  const used = new Set<string>();
  for (const snap of snapshots.slice(0, LOBBY_SIZE - 1)) {
    if (!snap?.team?.length) continue;
    const alive = s.opponents.filter((o) => o.alive && !used.has(o.id));
    const o = alive.find((x) => x.isHuman && x.name === snap.name) ?? alive.find((x) => !x.isHuman) ?? alive.find((x) => x.isHuman);
    if (!o) break;
    used.add(o.id);
    o.isHuman = true;
    o.name = snap.name;
    if (snap.avatar) o.avatar = snap.avatar;
    o.team = clone(snap.team).map((u) => ({ ...u, equips: u.equips ?? {} }));
    normalizeOpponent(o);
    o.lastTeam = clone(o.team);
    o.lastSynergies = opponentSynergies(o.lastTeam, s, data);
    o.archetype = archetypeOfTeam(o.team, data);
    delete o.presetId;
    if (s.matchup?.kind === 'pvp' && s.matchup.opponentId === o.id && !s.tutorial) {
      s.matchup = { ...s.matchup, name: o.name, team: clone(o.team), isHuman: true };
    }
  }
  return s;
}

function hit(ctx: Ctx, who: Opponent, amount: number, by: string): void {
  if (amount <= 0) return;
  who.hp -= amount;
  emitEvent(ctx, { type: 'hpLoss', who: who.id, name: who.name, amount, hp: Math.max(0, who.hp), by, text: `${who.name} 热度 -${amount}` });
}

/**
 * 结算本回合：玩家对局的扣血（由 result.ts 传入）+ 其余对手两两互打（或 PVE 模拟）+ 淘汰与名次。
 * 返回 'over' 时玩家出局 / 吃鸡 / 回合上限。
 */
export function resolveOtherMatches(ctx: Ctx, excludeId: string | undefined, pveTurn: boolean): void {
  const s = ctx.s;
  const data = ctx.data;
  const rng = ctx.rng;
  const alive = s.opponents.filter((o) => o.alive && o.id !== excludeId);
  const seed = `${s.seed}:t${s.turn}`;
  if (pveTurn) {
    const pv = s.pve ? data.pve.find((p) => p.id === s.pve!.pveId) : undefined;
    if (!pv) return;
    for (const o of s.opponents.filter((x) => x.alive)) {
      const r = simulateBattle(o.team, pveTeam(pv, data), data, `${seed}:pve:${o.id}`, { arena: s.arena });
      recordFight(o, o.team, s, data, { outcome: r.winner === 'me' ? 'win' : r.winner === 'enemy' ? 'lose' : 'draw', vsId: pv.id, hpDelta: 0 });
      if (r.winner === 'me') {
        const gold = pv.rewards.pool.find((x) => x.type === 'gold');
        o.bot.bonusGold += gold && gold.type === 'gold' ? gold.amount : 6;
      }
    }
    return;
  }
  const order = rng.sample(alive, alive.length);
  for (let i = 0; i < order.length; i += 2) {
    const a = order[i];
    let b = order[i + 1];
    let ghost = false;
    if (!b) {
      // 落单：和随机一名其他存活对手的阵容打（"幽灵"，只影响落单者）
      const others = s.opponents.filter((o) => o.alive && o !== a);
      if (!others.length) break;
      b = rng.pick(others);
      ghost = true;
    }
    const first: Side = rng.chance(0.5) ? 'me' : 'enemy';
    const r = simulateBattle(a.team, b.team, data, `${seed}:${a.id}:${b.id}`, { arena: s.arena, first });
    const loss = hpLossFor(s.turn, r.survivors);
    const aOut: OpponentResult['outcome'] = r.winner === 'me' ? 'win' : r.winner === 'enemy' ? 'lose' : 'draw';
    const bOut: OpponentResult['outcome'] = r.winner === 'me' ? 'lose' : r.winner === 'enemy' ? 'win' : 'draw';
    // 先记阵容（b 的 team 不会被修改），再扣血
    recordFight(a, a.team, s, data, { outcome: aOut, vsId: b.id, hpDelta: aOut === 'lose' ? -loss : 0 });
    if (!ghost) recordFight(b, b.team, s, data, { outcome: bOut, vsId: a.id, hpDelta: bOut === 'lose' ? -loss : 0 });
    if (aOut === 'lose') hit(ctx, a, loss, b.id);
    if (!ghost && bOut === 'lose') hit(ctx, b, loss, a.id);
  }
}

/**
 * 淘汰判定：本回合热度 ≤ 0 的人按热度高→低排名次（同回合淘汰的，剩余热度高的名次靠前；玩家与对手同分时玩家靠前）。
 * 返回玩家名次（被淘汰时）或 undefined。
 */
export function processEliminations(ctx: Ctx): number | undefined {
  const s = ctx.s;
  const dead: { id: string; name: string; hp: number; o?: Opponent }[] = [];
  for (const o of s.opponents) if (o.alive && o.hp <= 0) dead.push({ id: o.id, name: o.name, hp: o.hp, o });
  if (s.hp <= 0) dead.push({ id: 'me', name: '你', hp: s.hp });
  if (!dead.length) return undefined;
  const aliveAfter = s.opponents.filter((o) => o.alive && o.hp > 0).length + (s.hp > 0 ? 1 : 0);
  dead.sort((a, b) => b.hp - a.hp || (a.id === 'me' ? -1 : b.id === 'me' ? 1 : 0));
  let myPlace: number | undefined;
  dead.forEach((d, k) => {
    const place = aliveAfter + k + 1;
    if (d.o) {
      d.o.alive = false;
      d.o.hp = 0;
      d.o.place = place;
      d.o.eliminatedTurn = s.turn;
    } else {
      myPlace = place;
    }
    emitEvent(ctx, { type: 'eliminated', who: d.id, name: d.name, place, remaining: aliveAfter, text: `${d.name} 被淘汰（第 ${place} 名），还剩 ${aliveAfter} 人` });
    log(ctx, `${d.name} 被淘汰，第 ${place} 名`);
  });
  return myPlace;
}

/** 当前存活人数（含玩家） */
export function aliveCount(s: RunState): number {
  return s.opponents.filter((o) => o.alive).length + (s.hp > 0 ? 1 : 0);
}

/** 按热度排名（回合上限兜底）：玩家名次 = 1 + 热度更高的存活对手数 */
export function rankByHp(s: RunState): number {
  return 1 + s.opponents.filter((o) => o.alive && o.hp > s.hp).length;
}

