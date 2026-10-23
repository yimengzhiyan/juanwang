// 战斗引擎：simulateBattle 完全确定性（同样输入 + 种子 → 同样事件序列）。
import { Rng } from '../rng';
import { clone } from '../clone';
import {
  ENEMY_TARGETS, FACTIONS,
  type Ability, type BattleEvent, type BattleOptions, type BattleResult, type Faction, type GameData, type Level,
  type Side, type Trigger, type UnitDef, type UnitInst, type UnitRef, type UnitSnap,
} from '../types';
import { abilityAmount, abilityBuff, abilityMult, consumeBonus, destroyThreshold, matchesFilter, resolveChoice } from './shop';

export const MAX_ROUNDS = 50;
/** 战场每方最多单位数（队伍 5 + 1 个召唤余量） */
export const MAX_FIELD = 6;
/** 单次结算的连锁上限（防止技能互相触发死循环） */
const MAX_CHAIN = 400;

export const SYNERGY_THRESHOLD = 3;
export const SYNERGY_DESC: Record<Faction, string> = {
  open: '开源共享：全队 +1/+1',
  closed: '护栏：最前排获得 3 点护盾',
  compute: '堆卡暴力：全队攻击 +2，血量 -1',
  folk: '人海：召唤一个 1/1 水军到最后排',
};

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
  /** 下一次攻击的次数（multiAttack），0 = 正常 1 次 */
  hits: number;
  alive: boolean;
  /** 我方原队伍单位（永久 buff 写回用） */
  orig: boolean;
  lastPos: number;
  killer?: BU;
  consumed?: boolean;
}

interface Pending {
  u: BU;
  trigger: Trigger;
  killer?: BU;
  summoned?: BU;
  /** 阵亡时的位置 */
  pos?: number;
}

const other = (s: Side): Side => (s === 'me' ? 'enemy' : 'me');

class Battle {
  sides: Record<Side, BU[]> = { me: [], enemy: [] };
  events: BattleEvent[] = [];
  queue: Pending[] = [];
  rng: Rng;
  perm = new Map<string, { atk: number; hp: number }>();
  bonus = { gold: 0, rerolls: 0, discount: 0 };
  summonCount = 0;

  constructor(public data: GameData, seed: string) {
    this.rng = new Rng(seed);
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
    return { ...this.ref(u), atk: u.atk, hp: u.hp, level: u.level, shield: u.shield };
  }
  emit(e: BattleEvent): void {
    this.events.push(e);
  }
  say(u: BU, chance = 1): void {
    const lines = u.def.lines;
    if (!lines?.length) return;
    if (chance < 1 && !this.rng.chance(chance)) return;
    const line = this.rng.pick(lines);
    this.emit({ type: 'say', unit: this.ref(u), line, text: `${this.name(u)}：「${line}」` });
  }
  isAlive(u: BU): boolean {
    return u.alive && u.hp > 0;
  }

  make(inst: UnitInst, side: Side, orig: boolean, atkMod = 0): BU {
    const def = this.data.unitsById[inst.defId] ?? fallbackDef(inst.defId);
    const atk = Math.max(0, inst.atk + (inst.tempAtk ?? 0) + atkMod);
    const hp = Math.max(1, inst.hp + (inst.tempHp ?? 0));
    return {
      uid: inst.uid, defId: inst.defId, def, side, atk, hp, maxHp: hp, level: inst.level ?? 1,
      shield: Math.max(0, inst.shield ?? 0), hits: 0, alive: true, orig, lastPos: 0,
    };
  }

  // ── 伤害与死亡 ──
  damage(src: BU | undefined, t: BU, amount: number, kind: 'attack' | 'ability'): void {
    if (!this.isAlive(t) || amount <= 0) return;
    const wasFront = this.sides[t.side][0] === t;
    const blocked = Math.min(t.shield, amount);
    if (t.shield > 0) t.shield = 0; // 护盾吸收一次伤害后消失
    const dealt = amount - blocked;
    t.hp -= dealt;
    const srcName = src ? this.name(src) : '';
    this.emit({
      type: 'damage', unit: this.ref(t), source: src ? this.ref(src) : undefined, amount: dealt, blocked,
      hp: Math.max(0, t.hp), shield: t.shield, kind,
      text: `${srcName ? `${srcName} 对 ` : ''}${this.name(t)} 造成 ${dealt} 点伤害${blocked ? `（护盾挡下 ${blocked}）` : ''}`,
    });
    if (dealt <= 0) return;
    if (t.hp <= 0) {
      if (!t.killer && src) t.killer = src;
    } else {
      this.queueFor(t, 'hurt', {});
    }
    if (wasFront) {
      for (const f of this.sides[t.side]) if (f !== t && this.isAlive(f)) this.queueFor(f, 'hurtFront', {});
    }
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
      // 攻击高→低；我方先于敌方；位置前→后
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
    for (const side of ['me', 'enemy'] as Side[]) {
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
      }
    }
  }

  // ── 目标 ──
  targets(p: Pending, ab: Ability): BU[] {
    const ok = (x: BU) => matchesFilter(x.def, ab.filter);
    return this.rawTargets(p, ab, ok).filter(ok);
  }

  rawTargets(p: Pending, ab: Ability, ok: (x: BU) => boolean): BU[] {
    const u = p.u;
    // copyStats / swapPosition 的对象不会是自己
    const noSelf = ab.effect === 'copyStats' || ab.effect === 'swapPosition';
    const friends = this.sides[u.side].filter((x) => this.isAlive(x) && (x === u ? !noSelf : ok(x)));
    const enemies = this.sides[other(u.side)].filter((x) => this.isAlive(x) && ok(x));
    const others = friends.filter((x) => x !== u);
    const n = ab.n ?? 1;
    const lowest = (l: BU[]) => (l.length ? [l.reduce((m, x) => (x.hp < m.hp ? x : m))] : []);
    switch (ab.target) {
      case 'self':
        return [u];
      case 'frontFriend':
        return others.slice(0, 1);
      case 'backFriend':
        return others.slice(-1);
      case 'adjacentFriends': {
        // 按实际站位取左右邻居（筛选条件在外层再过滤）
        const line = this.sides[u.side].filter((x) => this.isAlive(x));
        if (u.alive) {
          const i = line.indexOf(u);
          return [line[i - 1], line[i + 1]].filter(Boolean);
        }
        const at = p.pos ?? u.lastPos;
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
        return p.killer && this.isAlive(p.killer) ? [p.killer] : [];
      case 'summoned':
        return p.summoned && this.isAlive(p.summoned) ? [p.summoned] : [];
      default:
        return [];
    }
  }

  // ── 技能执行 ──
  runAbility(p: Pending): void {
    const u = p.u;
    const ab = resolveChoice(u.def.ability!, this.rng);
    const tg = ab.effect === 'summon' ? [] : this.targets(p, ab);
    this.emit({
      type: 'ability', unit: this.ref(u), trigger: p.trigger, effect: ab.effect, targets: tg.map((t) => this.ref(t)),
      text: `${this.name(u)}：${ab.desc}`,
    });
    const amt = abilityAmount(ab, u.level);
    switch (ab.effect) {
      case 'damage':
        for (const t of tg) this.damage(u, t, amt, 'ability');
        break;
      case 'destroy': {
        const limit = destroyThreshold(ab, u.level);
        for (const t of tg) {
          if (!this.isAlive(t)) continue;
          if (t.hp > limit) {
            // DESIGN 11.3：血量高于阈值时改为造成阈值点伤害
            this.damage(u, t, limit, 'ability');
            continue;
          }
          const hp = t.hp;
          t.hp = 0;
          t.killer = u;
          this.emit({ type: 'damage', unit: this.ref(t), source: this.ref(u), amount: hp, blocked: 0, hp: 0, shield: t.shield, kind: 'ability', text: `${this.name(u)} 直接击杀了 ${this.name(t)}` });
        }
        break;
      }
      case 'buff': {
        const b = abilityBuff(ab, u.level);
        for (const t of tg) this.buff(t, b.atk, b.hp, !!ab.permanent, u);
        break;
      }
      case 'heal':
        for (const t of tg) {
          if (!this.isAlive(t)) continue;
          const before = t.hp;
          t.hp = Math.min(Math.max(t.maxHp, t.hp), t.hp + amt);
          this.emit({ type: 'heal', unit: this.ref(t), source: this.ref(u), amount: t.hp - before, hp: t.hp, text: `${this.name(t)} 回复 ${t.hp - before} 血` });
        }
        break;
      case 'shield':
        for (const t of tg) {
          if (!this.isAlive(t)) continue;
          t.shield += amt;
          this.emit({ type: 'shield', unit: this.ref(t), source: this.ref(u), amount: amt, total: t.shield, text: `${this.name(t)} 获得 ${amt} 点护盾` });
        }
        break;
      case 'copyStats': {
        const t = tg.find((x) => x !== u);
        if (t && this.isAlive(u)) {
          const bonus = ab.consume ? consumeBonus(ab, u.level) : 0;
          const da = Math.max(0, t.atk - u.atk) + bonus;
          const dh = Math.max(0, t.hp - u.hp) + bonus;
          this.buff(u, da, dh, false, u, `${this.name(u)} ${ab.consume ? '吞并' : '复制'}了 ${this.name(t)} 的属性`);
          if (ab.consume) {
            t.hp = 0;
            t.killer = u;
            t.consumed = true;
          }
        }
        break;
      }
      case 'summon':
        this.summonFor(p, ab);
        break;
      case 'swapPosition': {
        const t = tg.find((x) => x !== u);
        if (!t) break;
        if (t.side === u.side) {
          if (this.isAlive(u)) this.swap(u, t);
        } else {
          const front = this.sides[t.side][0];
          if (front && front !== t) this.swap(front, t);
        }
        break;
      }
      case 'pushBack':
        for (const t of tg) this.moveTo(t, this.sides[t.side].length - 1, u);
        break;
      case 'pullFront':
        for (const t of tg) this.moveTo(t, 0, u);
        break;
      case 'multiAttack': {
        for (const t of tg) {
          if (!this.isAlive(t)) continue;
          t.hits = Math.max(t.hits, amt);
          this.emit({ type: 'multiAttack', unit: this.ref(t), source: this.ref(u), hits: t.hits, text: `${this.name(t)} 下次攻击 ${t.hits} 次` });
        }
        break;
      }
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
    }
  }

  buff(t: BU, atk: number, hp: number, permanent: boolean, src?: BU, text?: string): void {
    if (!this.isAlive(t) || (atk === 0 && hp === 0)) return;
    t.atk = Math.max(0, t.atk + atk);
    t.hp = Math.max(1, t.hp + hp);
    t.maxHp = Math.max(1, t.maxHp + hp);
    if (permanent && t.side === 'me' && t.orig) {
      const cur = this.perm.get(t.uid) ?? { atk: 0, hp: 0 };
      this.perm.set(t.uid, { atk: cur.atk + atk, hp: cur.hp + hp });
    }
    const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    this.emit({
      type: 'buff', unit: this.ref(t), source: src ? this.ref(src) : undefined, atk, hp, newAtk: t.atk, newHp: t.hp, permanent,
      text: text ?? `${this.name(t)} ${sign(atk)}/${sign(hp)}${permanent ? '（永久）' : ''}`,
    });
  }

  swap(a: BU, b: BU): void {
    const arr = this.sides[a.side];
    const i = arr.indexOf(a);
    const j = arr.indexOf(b);
    if (i < 0 || j < 0 || i === j) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
    this.emit({ type: 'move', side: a.side, unit: this.ref(a), from: i, to: j, order: arr.map((x) => x.uid), text: `${this.name(a)} 与 ${this.name(b)} 交换位置` });
  }

  moveTo(t: BU, to: number, _src: BU): void {
    if (!this.isAlive(t)) return;
    const arr = this.sides[t.side];
    const from = arr.indexOf(t);
    if (from < 0 || from === to) return;
    arr.splice(from, 1);
    arr.splice(to, 0, t);
    this.emit({
      type: 'move', side: t.side, unit: this.ref(t), from, to, order: arr.map((x) => x.uid),
      text: `${this.name(t)} 被${to === 0 ? '拉到最前' : '推到最后'}`,
    });
  }

  summonFor(p: Pending, ab: Ability): void {
    const u = p.u;
    const enemySide = ENEMY_TARGETS.includes(ab.target);
    const side: Side = enemySide ? other(u.side) : u.side;
    const id = ab.unitId ?? 'token_shuijun';
    const count = ab.count ?? 1;
    const mult = abilityMult(ab, u.level);
    for (let i = 0; i < count; i++) {
      let at: number;
      const arr = this.sides[side];
      if (enemySide || ab.target === 'backFriend') at = arr.length;
      else if (ab.target === 'frontFriend') at = 0;
      else if (!u.alive) at = Math.min(p.pos ?? u.lastPos, arr.length);
      else at = arr.indexOf(u) + 1;
      const def = this.data.unitsById[id];
      if (!def) return;
      const inst: UnitInst = {
        uid: `s${++this.summonCount}_${u.uid}`, defId: id, atk: def.atk * mult, hp: def.hp * mult, level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0,
      };
      this.spawn(inst, side, at, u);
    }
  }

  /** 放置一个召唤物并发出 summon + friendSummoned/enemySummoned 触发 */
  spawn(inst: UnitInst, side: Side, at: number, src?: BU): BU | null {
    const arr = this.sides[side];
    if (arr.length >= MAX_FIELD) return null;
    const b = this.make(inst, side, false);
    arr.splice(Math.max(0, Math.min(at, arr.length)), 0, b);
    this.emit({ type: 'summon', unit: this.snap(b), source: src ? this.ref(src) : undefined, text: `召唤了 ${this.name(b)}` });
    for (const f of arr) if (f !== b && this.isAlive(f)) this.queueFor(f, 'friendSummoned', { summoned: b });
    for (const e of this.sides[other(side)]) if (this.isAlive(e)) this.queueFor(e, 'enemySummoned', { summoned: b });
    return b;
  }

  // ── 流程 ──
  synergies(): void {
    for (const side of ['me', 'enemy'] as Side[]) {
      const arr = this.sides[side];
      const counts: Record<Faction, number> = { open: 0, closed: 0, compute: 0, folk: 0 };
      for (const u of arr) counts[u.def.faction]++;
      for (const f of FACTIONS) {
        if (counts[f] < SYNERGY_THRESHOLD) continue;
        this.emit({ type: 'synergy', side, faction: f, count: counts[f], text: SYNERGY_DESC[f] });
        if (f === 'open') for (const u of [...arr]) this.buff(u, 1, 1, false);
        if (f === 'closed' && arr[0]) {
          arr[0].shield += 3;
          this.emit({ type: 'shield', unit: this.ref(arr[0]), amount: 3, total: arr[0].shield, text: `${this.name(arr[0])} 获得 3 点护盾（护栏）` });
        }
        if (f === 'compute') {
          for (const u of [...arr]) {
            const dh = u.hp > 1 ? -1 : 0;
            this.buff(u, 2, dh, false);
          }
        }
        if (f === 'folk') {
          const def = this.data.unitsById.token_shuijun;
          if (def) {
            this.spawn({ uid: `s${++this.summonCount}_${side}_folk`, defId: def.id, atk: def.atk, hp: def.hp, level: 1, xp: 0, shield: 0, tempAtk: 0, tempHp: 0 }, side, arr.length);
          }
        }
      }
    }
  }

  /** 商店阶段记下的队形修正（DESIGN 11.5）：先反转，再依次拉到最前 */
  applyFormation(opts: BattleOptions): void {
    const me = this.sides.me;
    if (opts.meReverse && me.length > 1) {
      me.reverse();
      for (const u of me) {
        this.emit({ type: 'move', side: 'me', unit: this.ref(u), from: me.length - 1 - me.indexOf(u), to: me.indexOf(u), order: me.map((x) => x.uid), text: '队伍顺序反转' });
      }
    }
    for (const uid of opts.mePullFront ?? []) {
      const u = me.find((x) => x.uid === uid);
      if (u) this.moveTo(u, 0, u);
    }
  }

  run(opts: BattleOptions = {}): { winner: 'me' | 'enemy' | 'draw'; rounds: number } {
    const me = this.sides.me;
    const en = this.sides.enemy;
    this.emit({ type: 'start', me: me.map((u) => this.snap(u)), enemy: en.map((u) => this.snap(u)), text: '开战！' });
    this.applyFormation(opts);
    if (me[0]) this.say(me[0]);
    if (en[0]) this.say(en[0]);
    this.synergies();
    this.resolve();
    // 开战时技能：攻击高→低，同攻击我方先
    for (const side of ['me', 'enemy'] as Side[]) for (const u of this.sides[side]) this.queueFor(u, 'startBattle', {});
    this.resolve();

    let rounds = 0;
    while (me.length && en.length && rounds < MAX_ROUNDS) {
      rounds++;
      this.queueFor(me[0], 'beforeAttack', {});
      this.queueFor(en[0], 'beforeAttack', {});
      this.resolve();
      if (!me.length || !en.length) break;
      const a = me[0];
      const b = en[0];
      const ha = Math.max(1, a.hits);
      const hb = Math.max(1, b.hits);
      a.hits = 0;
      b.hits = 0;
      this.emit({
        type: 'attack', round: rounds,
        me: { ...this.ref(a), atk: a.atk, hits: ha }, enemy: { ...this.ref(b), atk: b.atk, hits: hb },
        text: `第 ${rounds} 回合：${this.name(a)} ⚔ ${this.name(b)}`,
      });
      for (let i = 0; i < Math.max(ha, hb); i++) {
        // 同时互击：先确定双方本次是否出手，再一起结算伤害
        const aHit = i < ha && a.hp > 0 && b.hp > 0 ? a.atk : 0;
        const bHit = i < hb && b.hp > 0 && a.hp > 0 ? b.atk : 0;
        if (aHit) this.damage(a, b, aHit, 'attack');
        if (bHit) this.damage(b, a, bHit, 'attack');
      }
      this.resolve();
    }
    const winner = me.length && !en.length ? 'me' : en.length && !me.length ? 'enemy' : 'draw';
    this.emit({
      type: 'end', winner, rounds, me: me.map((u) => u.uid), enemy: en.map((u) => u.uid),
      text: winner === 'me' ? '胜利！' : winner === 'enemy' ? '失败…' : rounds >= MAX_ROUNDS && me.length ? `${MAX_ROUNDS} 回合未分胜负，和局` : '同归于尽，和局',
    });
    return { winner, rounds };
  }
}

function fallbackDef(id: string): UnitDef {
  return { id, name: id, tier: 1, faction: 'folk', atk: 1, hp: 1, avatar: '' };
}

/**
 * 模拟一场战斗。myTeam / enemyTeam 可以含 null（会被压缩，前排在前）。
 * 单位的 tempAtk/tempHp/shield 会计入本场。
 */
export function simulateBattle(
  myTeam: readonly (UnitInst | null)[],
  enemyTeam: readonly (UnitInst | null)[],
  data: GameData,
  seed: string,
  opts: BattleOptions = {},
): BattleResult {
  const b = new Battle(data, `${seed}:battle`);
  const mine = myTeam.filter((u): u is UnitInst => !!u);
  const theirs = enemyTeam.filter((u): u is UnitInst => !!u);
  // 敌方 uid 可能与我方撞车（快照来自别人的局），加前缀区分
  b.sides.me = mine.map((u) => b.make(u, 'me', true));
  b.sides.enemy = theirs.map((u) => b.make({ ...u, uid: `e_${u.uid}` }, 'enemy', false, opts.enemyAtkMod ?? 0));
  const { winner, rounds } = b.run(opts);
  return {
    winner,
    events: b.events,
    enemyTeam: theirs.map((u) => clone(u)),
    rounds,
    permanentBuffs: [...b.perm.entries()].map(([uid, v]) => ({ uid, ...v })),
    bonus: b.bonus,
  };
}
