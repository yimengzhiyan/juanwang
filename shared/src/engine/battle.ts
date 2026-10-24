// 战斗引擎 2.0（DESIGN 12.6）：交替开火。simulateBattle 完全确定性（同样输入 + 种子 → 同样事件序列）。
// 开战顺序：start → 战前队形/头条战场修正 → 赛场规则 → 羁绊横幅（按档位）→ 装备开战效果 → 开战时技能 → 交替开火。
import { Rng } from '../rng';
import { clone } from '../clone';
import {
  ENEMY_TARGETS,
  type Ability, type ArenaRules, type AttackTarget, type BattleEvent, type BattleMods, type BattleOptions, type BattleResult, type DamageKind,
  type EquipEffect, type GameData, type Level, type Side, type SynergyKey, type SynergyState, type Target, type Trigger, type UnitDef,
  type UnitEquips, type UnitInst, type UnitRef, type UnitSnap,
} from '../types';
import { abilityAmount, abilityBuff, abilityMult, consumeBonus, destroyThreshold, matchesFilter, resolveChoice } from './shop';
import { SYNERGY_NAME, SYNERGY_SHOUT, SYNERGY_TUNING, mergeBonus, synergiesFromDefs, tierMap, type SynergyBonus, type TierMap } from './synergy';
import { equipCount, equipEntries, equipMultFor, equipTotals, type EquipEntry } from './equip';
import { buildSummary } from './summary';

/** 行动上限：超过后按剩余血量总和判定 */
export const MAX_ACTIONS = 60;
/** 战场每方最多单位数（队伍 5 + 召唤余量） */
export const MAX_FIELD = 7;
/** 单次结算的连锁上限（防止技能互相触发死循环） */
const MAX_CHAIN = 400;
/** 单次行动最多追击（chain）次数 */
const MAX_CHAIN_ATTACKS = 5;

interface BU {
  uid: string;
  defId: string;
  def: UnitDef;
  side: Side;
  atk: number;
  hp: number;
  maxHp: number;
  level: Level;
  shield: number;
  equips: UnitEquips;
  eq: EquipEffect;
  eqList: EquipEntry[];
  /** 下一次行动的攻击段数（multiAttack），0 = 正常 */
  hits: number;
  alive: boolean;
  /** 我方原队伍单位（永久 buff 写回用） */
  orig: boolean;
  lastPos: number;
  killer?: BU;
  consumed?: boolean;
  summon: boolean;
  /** 技能授予的复活血量（>0 = 还有一次） */
  reviveGrant: number;
  /** 已经被技能复活过（每场一次） */
  abilityRevived: boolean;
  /** 装备复活已用 */
  equipRevived: boolean;
  doubled: boolean;
  /** 待执行的追击次数 */
  chain: number;
  /** 算力 ×5：每次攻击额外 1 次 */
  bonusHit: boolean;
  /** 碎盾反弹（闭源 ×3 = 2、护盾 ×4 = 3，取较大）；reflectAtk = 闭源 ×5（反弹攻击者攻击力） */
  closedReflect: number;
  reflectAtk: boolean;
  unpierceable: boolean;
}

interface Pending {
  u: BU;
  trigger: Trigger;
  killer?: BU;
  summoned?: BU;
  pos?: number;
}

const other = (s: Side): Side => (s === 'me' ? 'enemy' : 'me');
const SIDES: Side[] = ['me', 'enemy'];

class Battle {
  sides: Record<Side, BU[]> = { me: [], enemy: [] };
  events: BattleEvent[] = [];
  queue: Pending[] = [];
  rng: Rng;
  perm = new Map<string, { atk: number; hp: number }>();
  bonus = { gold: 0, rerolls: 0, discount: 0 };
  summonCount = 0;
  actions = 0;
  tiers: Record<Side, TierMap>;
  synergyStates: Record<Side, SynergyState[]>;
  arena: ArenaRules;
  arenaId?: string;
  mods: BattleMods;
  // 统计
  damageBy: Record<string, number> = {};
  hitsTaken: Record<string, number> = {};
  reflect: Record<Side, number> = { me: 0, enemy: 0 };
  summons: Record<Side, number> = { me: 0, enemy: 0 };
  mine = new Map<string, { defId: string; level: Level }>();

  constructor(public data: GameData, seed: string, opts: BattleOptions, meInsts: UnitInst[], enInsts: UnitInst[]) {
    this.rng = new Rng(seed);
    this.arenaId = opts.arena;
    this.arena = (opts.arena && data.arenasById[opts.arena]?.rules) || {};
    this.mods = opts.mods ?? {};
    const arenaBonus: SynergyBonus = {};
    for (const b of this.arena.synergyBonus ?? []) arenaBonus[b.key] = (arenaBonus[b.key] ?? 0) + b.amount;
    const defs = (l: UnitInst[]) => l.map((u) => data.unitsById[u.defId] ?? fallbackDef(u.defId));
    const bonusMe = mergeBonus(arenaBonus, this.mods.synergyBonus);
    this.tiers = { me: tierMap(defs(meInsts), bonusMe), enemy: tierMap(defs(enInsts), arenaBonus) };
    this.synergyStates = { me: synergiesFromDefs(defs(meInsts), bonusMe), enemy: synergiesFromDefs(defs(enInsts), arenaBonus) };
  }

  // ── 工具 ──
  name(u: BU | UnitDef): string {
    return 'def' in u ? u.def.name : u.name;
  }
  pos(u: BU): number {
    const i = this.sides[u.side].indexOf(u);
    return i >= 0 ? i : u.lastPos;
  }
  ref(u: BU): UnitRef {
    return { uid: u.uid, defId: u.defId, side: u.side, pos: this.pos(u) };
  }
  snap(u: BU): UnitSnap {
    return { ...this.ref(u), atk: u.atk, hp: u.hp, level: u.level, shield: u.shield, equips: clone(u.equips) };
  }
  emit(e: BattleEvent): void {
    this.events.push(e);
  }
  say(u: BU, chance = 1): void {
    const lines = u.def.lines?.general;
    if (!lines?.length) return;
    if (chance < 1 && !this.rng.chance(chance)) return;
    const line = this.rng.pick(lines);
    this.emit({ type: 'say', unit: this.ref(u), line, text: `${this.name(u)}：「${line}」` });
  }
  isAlive(u: BU): boolean {
    return u.alive && u.hp > 0;
  }
  living(side: Side): BU[] {
    return this.sides[side].filter((x) => this.isAlive(x));
  }

  make(inst: UnitInst, side: Side, orig: boolean, summon = false): BU {
    const def = this.data.unitsById[inst.defId] ?? fallbackDef(inst.defId);
    const allGold = side === 'me' && !!this.mods.goldenEquips;
    const mult = equipMultFor(def, this.tiers[side]);
    const eqList = equipEntries(inst, this.data, mult, allGold);
    const eq = equipTotals(inst, this.data, mult, allGold);
    const atk = Math.max(0, inst.atk + (inst.tempAtk ?? 0) + (eq.atk ?? 0));
    const hp = Math.max(1, inst.hp + (inst.tempHp ?? 0) + (eq.hp ?? 0));
    return {
      uid: inst.uid, defId: inst.defId, def, side, atk, hp, maxHp: hp, level: inst.level ?? 1,
      shield: Math.max(0, inst.shield ?? 0), equips: clone(inst.equips ?? {}), eq, eqList, hits: 0, alive: true, orig, lastPos: 0, summon,
      reviveGrant: 0, abilityRevived: false, equipRevived: false, doubled: false, chain: 0, bonusHit: false,
      closedReflect: 0, reflectAtk: false, unpierceable: false,
    };
  }

  equipProc(u: BU, pred: (e: EquipEffect) => unknown, text: string): void {
    const e = u.eqList.find((x) => pred(x.eff));
    if (!e) return;
    this.emit({ type: 'equipProc', unit: this.ref(u), equipId: e.def.id, slot: e.slot, gold: e.inst.gold, text: `${this.name(u)} 的${e.inst.gold ? '金色' : ''}${e.def.name}：${text}` });
  }

  // ── 伤害与死亡 ──
  /** 造成伤害，返回实际扣血 */
  damage(src: BU | undefined, t: BU, amount: number, kind: DamageKind, opts: { ignoreShield?: boolean } = {}): number {
    if (!this.isAlive(t) || amount <= 0) return 0;
    if (kind === 'attack') this.hitsTaken[t.uid] = (this.hitsTaken[t.uid] ?? 0) + 1;
    const srcName = src ? this.name(src) : '';
    if (t.eq.immuneBelow && amount <= t.eq.immuneBelow) {
      this.emit({
        type: 'damage', unit: this.ref(t), source: src ? this.ref(src) : undefined, amount: 0, blocked: amount, hp: t.hp, shield: t.shield, kind, immune: true,
        text: `${this.name(t)} 免疫了 ${amount} 点伤害`,
      });
      this.equipProc(t, (e) => e.immuneBelow, '小伤害免疫');
      return 0;
    }
    const wasFront = this.living(t.side)[0] === t;
    const pierce = !!opts.ignoreShield && !t.unpierceable;
    let blocked = 0;
    let broken = false;
    if (t.shield > 0 && !pierce) {
      blocked = Math.min(t.shield, amount);
      t.shield -= blocked;
      broken = t.shield === 0;
    }
    const dealt = amount - blocked;
    const before = t.hp;
    t.hp -= dealt;
    if (src) this.damageBy[src.uid] = (this.damageBy[src.uid] ?? 0) + Math.min(dealt, Math.max(0, before));
    if (kind === 'reflect' && src) this.reflect[src.side] += Math.min(dealt, Math.max(0, before));
    this.emit({
      type: 'damage', unit: this.ref(t), source: src ? this.ref(src) : undefined, amount: dealt, blocked,
      hp: Math.max(0, t.hp), shield: t.shield, kind, ...(broken ? { shieldBroken: true } : {}),
      text: `${srcName ? `${srcName} 对 ` : ''}${this.name(t)} 造成 ${dealt} 点伤害${blocked ? `（护盾挡下 ${blocked}${broken ? '，护盾碎了' : ''}）` : ''}${pierce && t.shield > 0 ? '（无视护盾）' : ''}`,
    });
    // 碎盾反弹（闭源 ×3 / ×5、护盾 ×4、金色防火墙）
    if (broken && src && src.side !== t.side && kind !== 'reflect' && this.isAlive(src)) {
      const r = Math.max(t.reflectAtk ? src.atk : t.closedReflect, t.eq.shieldReflect ?? 0);
      if (r > 0) {
        if (t.eq.shieldReflect && t.eq.shieldReflect >= (t.reflectAtk ? src.atk : t.closedReflect)) this.equipProc(t, (e) => e.shieldReflect, `碎盾反弹 ${r}`);
        this.damage(t, src, r, 'reflect');
      }
    }
    // 护盾 ×4：护盾单位的护盾每被打碎一次，永久 +1/+2
    const gs = SYNERGY_TUNING.growPerm.shield;
    if (broken && gs > 0 && t.def.role === 'shield' && this.tiers[t.side].shield >= 2) this.growPerm(t, gs, 2 * gs, 'shield', `${this.name(t)} 碎盾成长：永久 +${gs}/+${2 * gs}（护盾 ×4）`);
    if (dealt <= 0) return 0;
    if (t.hp <= 0) {
      if (!t.killer && src) t.killer = src;
    } else {
      this.queueFor(t, 'hurt', {});
    }
    if (wasFront) for (const f of this.sides[t.side]) if (f !== t && this.isAlive(f)) this.queueFor(f, 'hurtFront', {});
    return dealt;
  }

  queueFor(u: BU, trigger: Trigger, extra: Omit<Pending, 'u' | 'trigger'>): void {
    if (u.def.ability?.trigger !== trigger) return;
    this.queue.push({ u, trigger, ...extra });
  }

  /** 处理所有死亡与排队中的触发，直到稳定 */
  resolve(): void {
    for (let guard = 0; guard < MAX_CHAIN; guard++) {
      this.processDeaths();
      if (!this.queue.length) return;
      const batch = this.queue.splice(0);
      batch.sort((a, b) => b.u.atk - a.u.atk || (a.u.side === b.u.side ? 0 : a.u.side === 'me' ? -1 : 1) || this.pos(a.u) - this.pos(b.u));
      for (const p of batch) {
        const deadOk = p.trigger === 'faint' || p.trigger === 'kill';
        if (!deadOk && !this.isAlive(p.u)) continue;
        this.runAbility(p);
        this.processDeaths();
      }
    }
    this.queue.length = 0;
    this.processDeaths();
  }

  processDeaths(): void {
    for (const side of SIDES) {
      const arr = this.sides[side];
      for (let i = 0; i < arr.length; i++) {
        const u = arr[i];
        if (u.hp > 0) continue;
        u.alive = false;
        u.lastPos = i;
        arr.splice(i, 1);
        i--;
        const killer = u.killer;
        this.emit({
          type: 'faint', unit: { uid: u.uid, defId: u.defId, side: u.side, pos: u.lastPos },
          killer: killer ? this.ref(killer) : undefined,
          ...(u.consumed ? { consumed: true } : {}),
          text: u.consumed && killer ? `${this.name(u)} 被 ${this.name(killer)} 吞并` : `${this.name(u)} 阵亡${killer ? `（被 ${this.name(killer)} 击败）` : ''}`,
        });
        this.say(u);
        this.queueFor(u, 'faint', { killer, pos: u.lastPos });
        for (const f of arr) if (this.isAlive(f)) this.queueFor(f, 'friendFaint', { pos: u.lastPos });
        if (killer && killer.side !== u.side) {
          if (this.isAlive(killer)) this.say(killer, 0.5);
          this.queueFor(killer, 'kill', {});
        }
        this.onDeathSynergies(u);
        // 复活：技能授予的优先（原位），其次装备（跳板机，最后排）
        if (!u.consumed) {
          if (u.reviveGrant > 0) {
            const hp = u.reviveGrant;
            u.reviveGrant = 0;
            this.reviveUnit(u, hp, u.lastPos, 'ability');
            i = Math.max(-1, i);
          } else if (u.eq.revive && !u.equipRevived) {
            u.equipRevived = true;
            const r = u.eq.revive;
            const hp = Math.max(1, r.hp ?? 0, Math.floor(u.maxHp * (r.ratio ?? 0)));
            this.equipProc(u, (e) => e.revive, '复活！');
            this.reviveUnit(u, hp, r.to === 'same' ? u.lastPos : arr.length, 'equip');
          }
        }
      }
    }
  }

  reviveUnit(u: BU, hp: number, at: number, via: 'equip' | 'ability', src?: BU): void {
    const arr = this.sides[u.side];
    if (arr.length >= MAX_FIELD) return;
    u.alive = true;
    u.hp = Math.max(1, hp);
    u.killer = undefined;
    u.shield = 0;
    arr.splice(Math.max(0, Math.min(at, arr.length)), 0, u);
    this.emit({ type: 'revive', unit: this.snap(u), via, source: src ? this.ref(src) : undefined, text: `${this.name(u)} 以 ${u.hp} 血复活了！` });
  }

  /** 阵亡时的羁绊：自爆 ×4（自爆单位炸最前排 + 任意友军阵亡全体 1 伤害）、民间 ×5（召唤物阵亡爆炸）、民间 ×3（友军阵亡召唤水军） */
  onDeathSynergies(u: BU): void {
    const t = this.tiers[u.side];
    if (u.consumed) return;
    const ref = { uid: u.uid, defId: u.defId, side: u.side, pos: u.lastPos };
    if (t.explode >= 2 && u.def.role === 'explode') {
      const front = this.living(other(u.side))[0];
      const dmg = SYNERGY_TUNING.explodeFrontMul > 0 ? Math.round(u.atk * SYNERGY_TUNING.explodeFrontMul) + this.explodeBonus(u.side) : 0;
      if (front && dmg > 0) {
        this.emit({ type: 'explode', unit: ref, amount: dmg, targets: [this.ref(front)], text: `${this.name(u)} 自爆 ×4：对 ${this.name(front)} 造成 ${dmg} 伤害` });
        this.damage(u, front, dmg, 'explode');
      }
      // 余波：自爆单位阵亡时对敌方全体 1 伤害（只限自爆单位，避免与攻击无关的无脑伤害）
      const all = this.living(other(u.side));
      if (SYNERGY_TUNING.explodeAftershock > 0 && all.length) {
        this.emit({ type: 'explode', unit: ref, amount: SYNERGY_TUNING.explodeAftershock, targets: all.map((x) => this.ref(x)), text: `${this.name(u)} 阵亡余波：敌方全体 ${SYNERGY_TUNING.explodeAftershock} 伤害（自爆 ×4）` });
        for (const x of all) this.damage(u, x, SYNERGY_TUNING.explodeAftershock, 'explode');
      }
      this.afterExplosion(u);
    }
    if (t.folk >= 3 && u.summon) {
      const targets = this.living(other(u.side));
      if (targets.length) {
        this.emit({ type: 'explode', unit: ref, amount: 1, targets: targets.map((x) => this.ref(x)), text: `${this.name(u)} 阵亡爆炸：敌方全体 1 伤害` });
        for (const x of targets) this.damage(u, x, 1, 'explode');
        this.afterExplosion(u);
      }
    }
    if (t.folk >= 2 && !u.summon) {
      const def = this.data.unitsById.token_shuijun;
      if (def) this.summonUnit(u.side, def.id, u.lastPos, u, 1);
    }
  }

  // ── 目标 ──
  targets(p: Pending, ab: Ability): BU[] {
    const ok = (x: BU) => matchesFilter(x.def, ab.filter);
    return this.rawTargets(p, ab, ok).filter(ok);
  }

  rawTargets(p: Pending, ab: Ability, ok: (x: BU) => boolean): BU[] {
    const u = p.u;
    const noSelf = ab.effect === 'copyStats' || ab.effect === 'swapPosition';
    const friends = this.sides[u.side].filter((x) => this.isAlive(x) && (x === u ? !noSelf : ok(x)));
    const enemies = this.sides[other(u.side)].filter((x) => this.isAlive(x) && ok(x));
    return this.pick(ab.target, ab.n ?? 1, u, friends, enemies, p);
  }

  pick(target: Target, n: number, u: BU, friends: BU[], enemies: BU[], p?: Pending): BU[] {
    const others = friends.filter((x) => x !== u);
    const lowest = (l: BU[]) => (l.length ? [l.reduce((m, x) => (x.hp < m.hp ? x : m))] : []);
    switch (target) {
      case 'self':
        return [u];
      case 'frontFriend':
        return others.slice(0, 1);
      case 'backFriend':
        return others.slice(-1);
      case 'adjacentFriends': {
        const line = this.living(u.side);
        if (u.alive) {
          const i = line.indexOf(u);
          return [line[i - 1], line[i + 1]].filter(Boolean);
        }
        const at = p?.pos ?? u.lastPos;
        return [line[at - 1], line[at]].filter(Boolean);
      }
      case 'randomFriend':
        return this.rng.sample(others, n);
      case 'allFriends':
        return friends;
      case 'lowestHpFriend':
        return lowest(friends);
      case 'frontEnemy':
        return enemies.slice(0, 1);
      case 'backEnemy':
        return enemies.slice(-1);
      case 'randomEnemy':
        return this.rng.sample(enemies, n);
      case 'allEnemies':
        return enemies;
      case 'lowestHpEnemy':
        return lowest(enemies);
      case 'highestAtkEnemy':
        return enemies.length ? [enemies.reduce((m, x) => (x.atk > m.atk ? x : m))] : [];
      case 'killer':
        return p?.killer && this.isAlive(p.killer) ? [p.killer] : [];
      case 'summoned':
        return p?.summoned && this.isAlive(p.summoned) ? [p.summoned] : [];
      default:
        return [];
    }
  }

  // ── 技能执行 ──
  /** 自爆 ×2：本方"爆炸伤害" +EXPLODE_BONUS（explode 技能、自爆单位的阵亡伤害技能、自爆 ×4 的自爆） */
  explodeBonus(side: Side): number {
    return this.tiers[side].explode >= 1 ? SYNERGY_TUNING.explodeBonus : 0;
  }

  /** 自爆 ×4：本方每发生一次爆炸，其余（存活的）自爆友军永久 +1/+1 */
  afterExplosion(u: BU): void {
    if (this.tiers[u.side].explode < 2) return;
    for (const x of this.living(u.side)) {
      const g = SYNERGY_TUNING.growPerm.explode;
      if (x !== u && x.def.role === 'explode' && g > 0) this.growPerm(x, g, g, 'explode', `${this.name(x)} 被爆炸点燃：永久 +${g}/+${g}（自爆 ×4）`);
    }
  }

  /**
   * 羁绊带来的永久成长（关键词 ×4）：存活 → buff 事件（permanent:true, synergy）；
   * 已阵亡的我方原队伍单位也照样记进 permanentBuffs（赛后写回），只是不发事件。
   */
  growPerm(t: BU, atk: number, hp: number, key: SynergyKey, text: string): void {
    if (this.isAlive(t)) {
      this.buff(t, atk, hp, true, undefined, text, { synergy: key });
      return;
    }
    if (t.side === 'me' && t.orig) {
      const cur = this.perm.get(t.uid) ?? { atk: 0, hp: 0 };
      this.perm.set(t.uid, { atk: cur.atk + atk, hp: cur.hp + hp });
    }
  }

  runAbility(p: Pending): void {
    const u = p.u;
    let reps = 1;
    reps += u.eq.abilityRepeat ?? 0;
    reps = Math.max(1, Math.min(5, Math.round(reps)));
    for (let r = 1; r <= reps; r++) {
      if (r > 1) {
        if (!this.isAlive(u) && p.trigger !== 'faint' && p.trigger !== 'kill') break;
        if (u.eq.abilityRepeat) this.equipProc(u, (e) => e.abilityRepeat, '技能再触发');
      }
      this.runAbilityOnce(p, r);
      if (r < reps) this.processDeaths();
    }
  }

  runAbilityOnce(p: Pending, repeat: number): void {
    const u = p.u;
    const ab = resolveChoice(u.def.ability!, this.rng);
    const tg = ab.effect === 'summon' ? [] : this.targets(p, ab);
    this.emit({
      type: 'ability', unit: this.ref(u), trigger: p.trigger, effect: ab.effect, targets: tg.map((x) => this.ref(x)), repeat,
      text: `${this.name(u)}：${ab.desc}${repeat > 1 ? `（×${repeat}）` : ''}`,
    });
    const amt = abilityAmount(ab, u.level);
    switch (ab.effect) {
      case 'damage': {
        // 自爆单位的阵亡伤害技能也算"爆炸"（自爆 ×2 +2）
        const boom = p.trigger === 'faint' && u.def.role === 'explode' ? this.explodeBonus(u.side) : 0;
        for (const x of tg) this.damage(u, x, amt + boom, boom ? 'explode' : 'ability');
        if (boom && tg.length) this.afterExplosion(u);
        break;
      }
      case 'destroy': {
        const limit = destroyThreshold(ab, u.level);
        for (const x of tg) {
          if (!this.isAlive(x)) continue;
          if (x.hp > limit || x.unpierceable) {
            this.damage(u, x, Number.isFinite(limit) ? limit : x.hp, 'ability');
            continue;
          }
          const hp = x.hp;
          x.hp = 0;
          x.killer = u;
          this.damageBy[u.uid] = (this.damageBy[u.uid] ?? 0) + hp;
          this.emit({ type: 'damage', unit: this.ref(x), source: this.ref(u), amount: hp, blocked: 0, hp: 0, shield: x.shield, kind: 'ability', text: `${this.name(u)} 直接击杀了 ${this.name(x)}` });
        }
        break;
      }
      case 'buff': {
        const b = abilityBuff(ab, u.level);
        for (const x of tg) this.buff(x, b.atk, b.hp, !!ab.permanent, u);
        break;
      }
      case 'heal':
        for (const x of tg) {
          if (!this.isAlive(x)) continue;
          const before = x.hp;
          x.hp = Math.min(Math.max(x.maxHp, x.hp), x.hp + amt);
          this.emit({ type: 'heal', unit: this.ref(x), source: this.ref(u), amount: x.hp - before, hp: x.hp, text: `${this.name(x)} 回复 ${x.hp - before} 血` });
        }
        break;
      case 'shield':
        for (const x of tg) this.addShield(x, amt, u);
        break;
      case 'copyStats': {
        const x = tg.find((y) => y !== u);
        if (x && this.isAlive(u)) {
          const bonus = ab.consume ? consumeBonus(ab, u.level) : 0;
          const da = Math.max(0, x.atk - u.atk) + bonus;
          const dh = Math.max(0, x.hp - u.hp) + bonus;
          this.buff(u, da, dh, false, u, `${this.name(u)} ${ab.consume ? '吞并' : '复制'}了 ${this.name(x)} 的属性`);
          if (ab.consume) {
            x.hp = 0;
            x.killer = u;
            x.consumed = true;
          }
        }
        break;
      }
      case 'summon': {
        const enemySide = ENEMY_TARGETS.includes(ab.target);
        const side: Side = enemySide ? other(u.side) : u.side;
        const count = ab.count ?? 1;
        const mult = abilityMult(ab, u.level);
        for (let i = 0; i < count; i++) {
          const arr = this.sides[side];
          let at: number;
          if (enemySide || ab.target === 'backFriend') at = arr.length;
          else if (ab.target === 'frontFriend') at = 0;
          else if (!u.alive) at = Math.min(p.pos ?? u.lastPos, arr.length);
          else at = arr.indexOf(u) + 1;
          this.summonUnit(side, ab.unitId ?? 'token_shuijun', at, u, mult);
        }
        break;
      }
      case 'swapPosition': {
        const x = tg.find((y) => y !== u);
        if (!x) break;
        if (x.side === u.side) {
          if (this.isAlive(u)) this.swap(u, x);
        } else {
          const front = this.sides[x.side][0];
          if (front && front !== x) this.swap(front, x);
        }
        break;
      }
      case 'pushBack':
        for (const x of tg) this.moveTo(x, this.sides[x.side].length - 1);
        break;
      case 'pullFront':
        for (const x of tg) this.moveTo(x, 0);
        break;
      case 'multiAttack':
        for (const x of tg) {
          if (!this.isAlive(x)) continue;
          x.hits = Math.max(x.hits, amt);
          this.emit({ type: 'multiAttack', unit: this.ref(x), source: this.ref(u), hits: x.hits, text: `${this.name(x)} 下次攻击 ${x.hits} 次` });
        }
        break;
      case 'gold':
      case 'reroll':
      case 'discount': {
        if (u.side === 'me') {
          if (ab.effect === 'gold') this.bonus.gold += amt;
          if (ab.effect === 'reroll') this.bonus.rerolls += amt;
          if (ab.effect === 'discount') this.bonus.discount += amt;
        }
        const label = ab.effect === 'gold' ? `下回合 +${amt} 算力` : ab.effect === 'reroll' ? `下回合 ${amt} 次免费刷新` : `下回合单位降价 ${amt}`;
        this.emit({ type: 'bonus', side: u.side, unit: this.ref(u), kind: ab.effect, amount: amt, text: `${this.name(u)}：${label}` });
        break;
      }
      case 'steal': {
        const limit = destroyThreshold(ab, u.level);
        for (const x of tg) {
          if (!this.isAlive(x) || x.side === u.side) continue;
          if (x.hp <= limit && this.sides[u.side].length < MAX_FIELD) this.stealUnit(x, u.side, u);
          else this.damage(u, x, Number.isFinite(limit) ? limit : x.hp, 'ability');
        }
        break;
      }
      case 'explode': {
        const dmg = Math.max(0, Math.round(u.atk * (ab.amount ?? 1))) + this.explodeBonus(u.side);
        const targets = tg.filter((x) => this.isAlive(x));
        if (!targets.length || dmg <= 0) break;
        this.emit({ type: 'explode', unit: this.ref(u), amount: dmg, targets: targets.map((x) => this.ref(x)), text: `${this.name(u)} 自爆！对 ${targets.length} 个目标造成 ${dmg} 伤害` });
        for (const x of targets) this.damage(u, x, dmg, 'explode');
        this.afterExplosion(u);
        break;
      }
      case 'doubleStats':
        for (const x of tg) {
          if (!this.isAlive(x) || x.doubled) continue;
          x.doubled = true;
          this.buff(x, x.atk, x.hp, false, u, `${this.name(x)} 属性翻倍！`);
        }
        break;
      case 'revive': {
        const hp = Math.max(1, ab.amount ?? 1);
        for (const x of tg) {
          if (x.abilityRevived || x.consumed) continue;
          x.abilityRevived = true;
          if (x.alive && x.hp > 0) x.reviveGrant = Math.max(x.reviveGrant, hp);
          else this.reviveUnit(x, hp, x.lastPos, 'ability', u);
        }
        break;
      }
      case 'chain':
        for (const x of tg) if (this.isAlive(x)) x.chain += Math.max(1, ab.amount ?? 1);
        break;
    }
  }

  addShield(x: BU, amt: number, src?: BU, text?: string): void {
    if (!this.isAlive(x) || amt <= 0) return;
    x.shield += amt;
    this.emit({ type: 'shield', unit: this.ref(x), source: src ? this.ref(src) : undefined, amount: amt, total: x.shield, text: text ?? `${this.name(x)} 获得 ${amt} 点护盾` });
  }

  /**
   * 加属性。permanent = 赛后写回（我方原队伍单位）。
   * 成长 ×2：成长单位获得永久加成时额外 +1/+1；成长 ×4：成长单位获得永久加成时，相邻友军获得同样的加成（不再继续传递）。
   */
  buff(t: BU, atk: number, hp: number, permanent: boolean, src?: BU, text?: string, opts: { synergy?: SynergyKey; noSpread?: boolean } = {}): void {
    if (!this.isAlive(t) || (atk === 0 && hp === 0)) return;
    const base = { atk, hp };
    const gt = this.tiers[t.side].growth;
    const growthHit = permanent && (atk > 0 || hp > 0) && t.def.role === 'growth' && gt >= 1;
    if (growthHit) {
      atk += 1;
      hp += 1;
    }
    const a0 = t.atk;
    const h0 = t.hp;
    t.atk = Math.max(0, t.atk + atk);
    t.hp = Math.max(1, t.hp + hp);
    t.maxHp = Math.max(1, t.maxHp + hp);
    if (permanent && t.side === 'me' && t.orig) {
      const cur = this.perm.get(t.uid) ?? { atk: 0, hp: 0 };
      this.perm.set(t.uid, { atk: cur.atk + atk, hp: cur.hp + hp });
    }
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    const synergy = opts.synergy ?? (growthHit ? 'growth' : undefined);
    this.emit({
      type: 'buff', unit: this.ref(t), source: src ? this.ref(src) : undefined, atk: t.atk - a0, hp: t.hp - h0, newAtk: t.atk, newHp: t.hp, permanent,
      ...(synergy ? { synergy } : {}),
      text: (text ?? `${this.name(t)} ${sign(atk)}/${sign(hp)}${permanent ? '（永久）' : ''}`) + (growthHit ? '（成长 +1/+1）' : ''),
    });
    if (growthHit && gt >= 2 && !opts.noSpread) {
      const line = this.living(t.side);
      const i = line.indexOf(t);
      for (const n of [line[i - 1], line[i + 1]]) {
        if (n) this.buff(n, base.atk, base.hp, true, t, `${this.name(n)} 互相成长 ${sign(base.atk)}/${sign(base.hp)}（成长 ×4）`, { synergy: 'growth', noSpread: true });
      }
    }
  }

  swap(a: BU, b: BU): void {
    const arr = this.sides[a.side];
    const i = arr.indexOf(a);
    const j = arr.indexOf(b);
    if (i < 0 || j < 0 || i === j) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.emit({ type: 'move', side: a.side, unit: this.ref(a), from: i, to: j, order: arr.map((x) => x.uid), text: `${this.name(a)} 与 ${this.name(b)} 交换位置` });
  }

  moveTo(t: BU, to: number): void {
    if (!this.isAlive(t)) return;
    const arr = this.sides[t.side];
    const from = arr.indexOf(t);
    if (from < 0 || from === to) return;
    arr.splice(from, 1);
    arr.splice(to, 0, t);
    this.emit({ type: 'move', side: t.side, unit: this.ref(t), from, to, order: arr.map((x) => x.uid), text: `${this.name(t)} 被${to === 0 ? '拉到最前' : '推到最后'}` });
  }

  /** 把 x 偷到 toSide 的末尾 */
  stealUnit(x: BU, toSide: Side, src?: BU): void {
    const from = this.ref(x);
    const arr = this.sides[x.side];
    arr.splice(arr.indexOf(x), 1);
    x.side = toSide;
    x.orig = false;
    x.chain = 0;
    this.sides[toSide].push(x);
    if (toSide === 'me') this.mine.set(x.uid, { defId: x.defId, level: x.level });
    else this.mine.delete(x.uid);
    this.emit({
      type: 'steal', unit: from, source: src ? this.ref(src) : from, to: this.ref(x),
      text: src ? `${this.name(src)} 把 ${this.name(x)} 挖了过来！` : `${this.name(x)} 跳槽了！`,
    });
  }

  /**
   * 召唤：赛场 summonBuff（双方）、头条 summonBuff（我方）、召唤 ×2/×4（+1/+1 / +2/+2）、民间 ×3 继承召唤者 50% 属性。
   */
  summonUnit(side: Side, id: string, at: number, src: BU | undefined, mult: number): BU | null {
    const def = this.data.unitsById[id];
    if (!def) return null;
    let atk = def.atk * mult;
    let hp = def.hp * mult;
    const ab = this.arena.summonBuff;
    if (ab) {
      atk += ab.atk;
      hp += ab.hp;
    }
    if (side === 'me' && this.mods.summonBuff) {
      atk += this.mods.summonBuff.atk;
      hp += this.mods.summonBuff.hp;
    }
    const st = this.tiers[side].summon;
    if (st >= 1) {
      const n = SYNERGY_TUNING.summonStat[st >= 2 ? 1 : 0];
      atk += n;
      hp += n;
    }
    if (src && this.tiers[side].folk >= 2) {
      atk += Math.floor(src.atk / 2);
      hp += Math.floor(src.maxHp / 2);
    }
    const inst: UnitInst = {
      uid: `s${++this.summonCount}_${src?.uid ?? side}`, defId: id, atk: Math.max(0, atk), hp: Math.max(1, hp), level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0, equips: {},
    };
    const b = this.spawn(inst, side, at, src);
    // 召唤 ×4：每次召唤，召唤者永久 +1/+1
    const gu = SYNERGY_TUNING.growPerm.summon;
    if (b && src && src.side === side && st >= 2 && gu > 0) this.growPerm(src, gu, gu, 'summon', `${this.name(src)} 摇人成功：永久 +${gu}/+${gu}（召唤 ×4）`);
    return b;
  }

  spawn(inst: UnitInst, side: Side, at: number, src?: BU): BU | null {
    const arr = this.sides[side];
    if (arr.length >= MAX_FIELD) return null;
    const b = this.make(inst, side, false, true);
    arr.splice(Math.max(0, Math.min(at, arr.length)), 0, b);
    this.summons[side]++;
    if (side === 'me') this.mine.set(b.uid, { defId: b.defId, level: b.level });
    this.emit({ type: 'summon', unit: this.snap(b), source: src ? this.ref(src) : undefined, text: `召唤了 ${this.name(b)}` });
    for (const f of arr) if (f !== b && this.isAlive(f)) this.queueFor(f, 'friendSummoned', { summoned: b });
    for (const e of this.sides[other(side)]) if (this.isAlive(e)) this.queueFor(e, 'enemySummoned', { summoned: b });
    return b;
  }

  // ── 开战流程 ──

  /** 商店阶段记下的队形修正 + 头条战场修正 */
  applyFormation(opts: BattleOptions): void {
    const rev = (side: Side) => {
      const arr = this.sides[side];
      if (arr.length < 2) return;
      arr.reverse();
      this.emit({ type: 'move', side, unit: this.ref(arr[0]), from: arr.length - 1, to: 0, order: arr.map((x) => x.uid), text: `${side === 'me' ? '我方' : '敌方'}队伍顺序反转` });
    };
    if (opts.meReverse) rev('me');
    if (this.mods.enemyReverse) rev('enemy');
    for (const uid of opts.mePullFront ?? []) {
      const u = this.sides.me.find((x) => x.uid === uid);
      if (u) this.moveTo(u, 0);
    }
  }

  applyMods(): void {
    const m = this.mods;
    const pickEnemy = (t: Target): BU | undefined => this.pick(t, 1, this.sides.me[0] ?? this.sides.enemy[0], this.living('me'), this.living('enemy'))[0];
    for (const t of m.benchEnemy ?? []) {
      const x = pickEnemy(t);
      if (!x) continue;
      const pos = this.pos(x);
      this.sides.enemy.splice(pos, 1);
      x.alive = false;
      x.lastPos = pos;
      this.emit({ type: 'faint', unit: { uid: x.uid, defId: x.defId, side: 'enemy', pos }, benched: true, text: `${this.name(x)} 被请下场了（本场不参战）` });
    }
    if (m.swapFronts) {
      const a = this.sides.me[0];
      const b = this.sides.enemy[0];
      if (a && b) {
        this.stealUnit(b, 'me');
        this.moveTo(b, 0);
        this.stealUnit(a, 'enemy');
        this.moveTo(a, 0);
      }
    }
    for (const t of m.stealEnemy ?? []) {
      const x = pickEnemy(t);
      if (x && this.sides.me.length < MAX_FIELD) this.stealUnit(x, 'me');
    }
    for (const b of m.enemyBoss ?? []) {
      const def = this.data.unitsById[b.unitId];
      if (!def) continue;
      this.spawn({ uid: `boss${++this.summonCount}`, defId: b.unitId, atk: b.atk, hp: b.hp, level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0, equips: {} }, 'enemy', this.sides.enemy.length);
    }
    for (const s of m.battleSummon ?? []) for (let i = 0; i < s.count; i++) this.summonUnit(s.side, s.unitId, this.sides[s.side].length, undefined, 1);
    for (const side of SIDES) {
      const mul = m.statMul?.[side];
      if (!mul) continue;
      for (const u of this.living(side)) {
        const da = Math.round(u.atk * (mul.atk - 1));
        const dh = Math.round(u.hp * (mul.hp - 1));
        this.buff(u, da, dh, false, undefined, `${this.name(u)} 属性 ×${mul.hp !== 1 ? `${mul.hp}（血）` : `${mul.atk}（攻）`}`);
      }
    }
    if (m.enemyBuff) for (const u of this.living('enemy')) this.buff(u, m.enemyBuff.atk, m.enemyBuff.hp, false);
  }

  applyArena(): void {
    const a = this.arena;
    if (!this.arenaId || (!a.battleBuff && !a.startShield)) return;
    const name = this.data.arenasById[this.arenaId]?.name ?? this.arenaId;
    this.emit({ type: 'arena', arena: this.arenaId, name, text: `赛场「${name}」：${this.data.arenasById[this.arenaId]?.desc ?? ''}` });
    for (const side of SIDES) {
      for (const u of this.living(side)) {
        if (a.battleBuff) this.buff(u, a.battleBuff.atk, a.battleBuff.hp, false);
        if (a.startShield && matchesFilter(u.def, a.startShield.filter)) this.addShield(u, a.startShield.amount);
      }
    }
  }

  /** 装备最多的单位（并列取攻击高、再取靠前） */
  mostEquipped(side: Side): BU | undefined {
    const l = this.living(side);
    if (!l.length) return undefined;
    return l.reduce((m, x) => (equipCount(x) > equipCount(m) || (equipCount(x) === equipCount(m) && x.atk > m.atk) ? x : m));
  }

  synergies(): void {
    for (const side of SIDES) {
      const t = this.tiers[side];
      for (const st of this.synergyStates[side]) {
        if (st.tier <= 0) continue;
        const key = st.key as SynergyKey;
        const members = this.living(side).filter((u) => u.def.faction === key || u.def.role === key);
        const speaker = members.filter((u) => u.def.lines?.onSynergy?.length);
        const sp = speaker.length ? this.rng.pick(speaker) : undefined;
        const ev: BattleEvent = {
          type: 'synergyTier', side, kind: st.kind, key, name: SYNERGY_NAME[key], count: st.count, tier: st.tier,
          text: `${SYNERGY_NAME[key]} ×${st.count}：${SYNERGY_SHOUT[key][st.tier - 1]}`,
        };
        if (sp) ev.line = { unit: this.ref(sp), line: this.rng.pick(sp.def.lines!.onSynergy!) };
        this.emit(ev);
        this.synergyStart(side, key, t[key]);
      }
    }
  }

  synergyStart(side: Side, key: SynergyKey, tier: number): void {
    const l = this.living(side);
    switch (key) {
      case 'open':
        for (const u of l) if (u.def.faction === 'open') this.buff(u, 1, 1, false, undefined, `${this.name(u)} +1/+1（开源）`);
        break;
      case 'closed':
        if (l[0]) this.addShield(l[0], 3, undefined, `${this.name(l[0])} 获得 3 点护盾（护栏）`);
        if (tier >= 2) {
          for (const u of l) {
            if (u.def.faction !== 'closed') continue;
            u.closedReflect = 2;
            if (tier >= 3) {
              u.reflectAtk = true;
              u.unpierceable = true;
            }
            this.addShield(u, Math.max(1, Math.floor(u.maxHp / 3)), undefined, `${this.name(u)} 获得 ${Math.max(1, Math.floor(u.maxHp / 3))} 点护盾（闭源）`);
          }
        }
        break;
      case 'compute': {
        const m = this.mostEquipped(side);
        if (m) {
          this.buff(m, 2, 0, false, undefined, `${this.name(m)} +2 攻（算力：装备最多）`);
          if (tier >= 3) m.bonusHit = true;
        }
        break;
      }
      case 'folk': {
        const def = this.data.unitsById.token_shuijun;
        if (!def) break;
        const src = l.filter((u) => u.def.faction === 'folk').sort((a, b) => b.atk + b.hp - (a.atk + a.hp))[0];
        this.summonUnit(side, def.id, this.sides[side].length, tier >= 2 ? src : undefined, 1);
        break;
      }
      case 'shield':
        for (const u of l) if (u.def.role === 'shield') this.addShield(u, SYNERGY_TUNING.shieldStart, undefined, `${this.name(u)} 获得 ${SYNERGY_TUNING.shieldStart} 点护盾（护盾）`);
        if (tier >= 2) for (const u of l) u.closedReflect = Math.max(u.closedReflect, SYNERGY_TUNING.shieldReflect);
        break;
      case 'summon':
        if (tier >= 2) {
          const def = this.data.unitsById.token_shuijun;
          if (def) this.summonUnit(side, def.id, this.sides[side].length, undefined, 1);
        }
        break;
      default:
        break;
    }
  }

  /** 装备开战效果：防火墙护盾、蒸馏复制 */
  equipStart(): void {
    for (const side of SIDES) {
      for (const u of this.living(side)) {
        if (u.eq.startShield) {
          this.equipProc(u, (e) => e.startShield, `开战护盾 ${u.eq.startShield}`);
          this.addShield(u, u.eq.startShield);
        }
      }
      for (const u of this.living(side)) {
        const cn = u.eq.copyNeighbor;
        if (!cn?.length) continue;
        const line = this.living(side);
        const i = line.indexOf(u);
        const nb = [line[i - 1], line[i + 1]].filter(Boolean);
        if (!nb.length) continue;
        const da = cn.includes('atk') ? Math.max(0, Math.max(...nb.map((x) => x.atk)) - u.atk) : 0;
        const dh = cn.includes('hp') ? Math.max(0, Math.max(...nb.map((x) => x.hp)) - u.hp) : 0;
        if (da || dh) {
          this.equipProc(u, (e) => e.copyNeighbor, '追平相邻友军');
          this.buff(u, da, dh, false, u);
        }
      }
    }
  }

  // ── 交替开火 ──
  attackTarget(u: BU): BU | undefined {
    const enemies = this.living(other(u.side));
    if (!enemies.length) return undefined;
    const t: AttackTarget = u.eq.retarget ?? u.def.attackTarget ?? 'frontEnemy';
    return this.pick(t, 1, u, [], enemies)[0] ?? enemies[0];
  }

  /** 一段普攻，返回是否命中（有目标并结算了伤害，含被护盾挡下 / 免疫） */
  attackOnce(u: BU, hit: number, hits: number): boolean {
    const t = this.attackTarget(u);
    if (!t) return false;
    const front = this.living(t.side)[0];
    if (t !== front && u.eq.retarget) this.equipProc(u, (e) => e.retarget, `改打 ${this.name(t)}`);
    this.emit({
      type: 'attack', action: this.actions, unit: { ...this.ref(u), atk: u.atk }, target: this.ref(t), hit, hits,
      text: `${this.name(u)} → ${this.name(t)}${hits > 1 ? `（${hit}/${hits}）` : ''}`,
    });
    this.damage(u, t, u.atk, 'attack', { ignoreShield: u.eq.ignoreShield });
    if (u.eq.splash) {
      const line = this.sides[t.side];
      const i = line.indexOf(t);
      const behind = i >= 0 ? line[i + 1] : line[t.lastPos];
      if (behind && this.isAlive(behind)) this.damage(u, behind, u.eq.splash, 'splash');
    }
    return true;
  }

  /** 一次行动：beforeAttack → n 段攻击 → 追击 */
  act(u: BU): void {
    this.actions++;
    this.queueFor(u, 'beforeAttack', {});
    this.resolve();
    if (!this.isAlive(u) || !this.living(other(u.side)).length) return;
    let hits = Math.max(1, u.hits);
    u.hits = 0;
    if (u.bonusHit) hits++;
    // 多刀 ×2：25% 额外 1 段；×4：必定额外 1 段
    const mt = this.tiers[u.side].multi;
    if (u.def.role === 'multi' && mt >= 1 && (mt >= 2 || this.rng.chance(SYNERGY_TUNING.multiChance))) hits++;
    if (u.eq.extraAttackChance && this.rng.chance(u.eq.extraAttackChance)) {
      hits++;
      this.equipProc(u, (e) => e.extraAttackChance, '额外攻击 1 次');
    }
    const multiGrow = u.def.role === 'multi' && mt >= 2;
    for (let h = 1; h <= hits; h++) {
      if (!this.isAlive(u) || !this.living(other(u.side)).length) break;
      const landed = this.attackOnce(u, h, hits);
      // 多刀 ×4：额外的那一段（最后一段）命中后，该单位永久 +1 攻
      const gm = SYNERGY_TUNING.growPerm.multi;
      if (multiGrow && gm > 0 && h === hits && h > 1 && landed) this.growPerm(u, gm, 0, 'multi', `${this.name(u)} 越砍越快：永久 +${gm} 攻（多刀 ×4）`);
      this.resolve();
    }
    this.flushChains();
  }

  /** 追击：击杀后立刻再攻击一次（每个单位每次行动最多 MAX_CHAIN_ATTACKS 次） */
  flushChains(): void {
    const done = new Map<BU, number>();
    for (let guard = 0; guard < 20; guard++) {
      const u = [...this.living('me'), ...this.living('enemy')].find((x) => x.chain > 0);
      if (!u) return;
      u.chain--;
      const n = (done.get(u) ?? 0) + 1;
      done.set(u, n);
      if (n > MAX_CHAIN_ATTACKS || !this.living(other(u.side)).length) {
        u.chain = 0;
        continue;
      }
      this.emit({ type: 'chain', unit: this.ref(u), count: n, text: `${this.name(u)} 连击 ×${n}！` });
      this.attackOnce(u, 1, 1);
      this.resolve();
    }
  }

  run(opts: BattleOptions): { winner: 'me' | 'enemy' | 'draw'; reason: 'wipe' | 'timeout'; hpLeft: { me: number; enemy: number } } {
    const me = this.sides.me;
    const en = this.sides.enemy;
    const first: Side = this.mods.first ?? opts.first ?? 'me';
    this.emit({ type: 'start', me: me.map((u) => this.snap(u)), enemy: en.map((u) => this.snap(u)), first, ...(this.arenaId ? { arena: this.arenaId } : {}), text: '开战！' });
    this.applyFormation(opts);
    this.applyMods();
    this.resolve();
    if (me[0]) this.say(me[0]);
    if (en[0]) this.say(en[0]);
    this.applyArena();
    this.synergies();
    this.resolve();
    this.equipStart();
    this.resolve();
    for (const side of SIDES) for (const u of this.sides[side]) this.queueFor(u, 'startBattle', {});
    this.resolve();

    let turn: Side = first;
    const cursor: Record<Side, number> = { me: 0, enemy: 0 };
    while (me.length && en.length && this.actions < MAX_ACTIONS) {
      const arr = this.sides[turn];
      if (cursor[turn] >= arr.length) cursor[turn] = 0;
      const actor = arr[cursor[turn]];
      this.act(actor);
      const p = arr.indexOf(actor);
      cursor[turn] = p >= 0 ? p + 1 : Math.min(actor.lastPos, arr.length);
      if (cursor[turn] >= arr.length) cursor[turn] = 0;
      turn = other(turn);
    }
    const sum = (l: BU[]) => l.reduce((a, u) => a + Math.max(0, u.hp), 0);
    const hpLeft = { me: sum(me), enemy: sum(en) };
    let winner: 'me' | 'enemy' | 'draw';
    let reason: 'wipe' | 'timeout' = 'wipe';
    if (me.length && !en.length) winner = 'me';
    else if (en.length && !me.length) winner = 'enemy';
    else if (!me.length && !en.length) winner = 'draw';
    else {
      reason = 'timeout';
      winner = hpLeft.me > hpLeft.enemy ? 'me' : hpLeft.enemy > hpLeft.me ? 'enemy' : 'draw';
    }
    const text =
      reason === 'timeout'
        ? `${MAX_ACTIONS} 次行动未分胜负，按剩余血量 ${hpLeft.me} : ${hpLeft.enemy} ${winner === 'me' ? '判我方胜' : winner === 'enemy' ? '判敌方胜' : '判和局'}`
        : winner === 'me' ? '胜利！' : winner === 'enemy' ? '失败…' : '同归于尽，和局';
    this.emit({ type: 'end', winner, actions: this.actions, reason, hpLeft, me: me.map((u) => u.uid), enemy: en.map((u) => u.uid), text });
    return { winner, reason, hpLeft };
  }
}

function fallbackDef(id: string): UnitDef {
  return { id, name: id, tier: 1, faction: 'folk', atk: 1, hp: 1, avatar: '' };
}

/**
 * 模拟一场战斗。myTeam / enemyTeam 可以含 null（会被压缩，前排在前）。
 * 单位的 tempAtk/tempHp/shield 与装备会计入本场；敌方 uid 加前缀 'e_'。
 */
export function simulateBattle(
  myTeam: readonly (UnitInst | null)[],
  enemyTeam: readonly (UnitInst | null)[],
  data: GameData,
  seed: string,
  opts: BattleOptions = {},
): BattleResult {
  const mine = myTeam.filter((u): u is UnitInst => !!u).map((u) => ({ ...u, equips: u.equips ?? {} }));
  const theirs = enemyTeam.filter((u): u is UnitInst => !!u).map((u) => ({ ...u, equips: u.equips ?? {} }));
  const b = new Battle(data, `${seed}:battle`, opts, mine, theirs);
  b.sides.me = mine.map((u) => b.make(u, 'me', true));
  b.sides.enemy = theirs.map((u) => {
    const x = b.make({ ...u, uid: `e_${u.uid}` }, 'enemy', false);
    if (opts.enemyAtkMod) x.atk = Math.max(0, x.atk + opts.enemyAtkMod);
    return x;
  });
  for (const u of b.sides.me) b.mine.set(u.uid, { defId: u.defId, level: u.level });
  const myOrder = b.sides.me.map((u) => u.uid);
  const { winner } = b.run(opts);
  const survivors = winner === 'draw' ? 0 : b.sides[winner === 'me' ? 'me' : 'enemy'].length;
  const summary = buildSummary(
    { mine: b.mine, myOrder, damageByUid: b.damageBy, hitsTaken: b.hitsTaken, myReflect: b.reflect.me, mySummons: b.summons.me, synergies: b.synergyStates.me },
    data,
  );
  return {
    winner,
    events: b.events,
    enemyTeam: theirs.map((u) => clone(u)),
    actions: b.actions,
    survivors,
    permanentBuffs: [...b.perm.entries()].map(([uid, v]) => ({ uid, ...v })),
    bonus: b.bonus,
    summary,
  };
}
