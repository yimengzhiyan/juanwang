// 服务端权威游戏引擎：纯函数状态机。
// reduce(state, action, ctx) => {state, events}，不修改入参、不碰网络；
// 随机性全部来自 ctx.rng（可注入种子），保证测试确定性。
import {
  BOARD_SIZE,
  DEFAULT_SETTINGS,
  GOTO_JAIL_CELL,
  JAIL_CELL,
  JAIL_MAX_TURNS,
  LOG_LIMIT,
  MAX_ITEMS,
  MAX_LEVEL,
  UNLIMITED_ROUND_CAP,
  buildingSellValue,
  calcNetWorth,
  calcRanking,
  calcRent,
  computePath,
  isOwnable,
  itemTargets,
  mortgageValue,
  nearestCellOfType,
  pathTo,
  unmortgageCost,
  upgradeCostOf,
  type Card,
  type Cell,
  type GameAction,
  type GameData,
  type GameEvent,
  type GameSettings,
  type GameState,
  type ItemId,
  type ItemTarget,
  type JailExitHow,
  type Player,
} from '@dafuweng/shared';
import { createRng, pick, randInt, rollDie, shuffle, type RandomFn } from './rng.js';

/* ====================================================================== */
/*                               对外类型                                  */
/* ====================================================================== */

export interface EngineCtx {
  rng: RandomFn; // [0,1) 随机数
  data: GameData; // 静态数据
  actorId: string; // 发出动作的玩家 id（必须是当前玩家）
}

export interface ReduceResult {
  state: GameState;
  events: GameEvent[];
}

/** 引擎拒绝动作时抛出（message 为中文，可直接发给客户端） */
export class EngineError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'EngineError';
  }
}

export interface NewPlayer {
  id: string;
  name: string;
  characterId: string;
  color?: string; // 缺省用角色主色
  isBot?: boolean;
  connected?: boolean;
  diceSkin?: string;
}

/* ====================================================================== */
/*                               创建对局                                  */
/* ====================================================================== */

/** 规范化设置：缺省值 + 夹取到合法范围 */
export function normalizeSettings(input: Partial<GameSettings> | undefined): GameSettings {
  const s = { ...DEFAULT_SETTINGS, ...(input ?? {}) };
  const int = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : d);
  const startMoney = Math.min(10000, Math.max(500, int(s.startMoney, DEFAULT_SETTINGS.startMoney)));
  const maxRounds = Math.min(200, Math.max(0, int(s.maxRounds, DEFAULT_SETTINGS.maxRounds)));
  let turnTimeoutSec = Math.min(300, Math.max(0, int(s.turnTimeoutSec, DEFAULT_SETTINGS.turnTimeoutSec)));
  if (turnTimeoutSec > 0 && turnTimeoutSec < 10) turnTimeoutSec = 10;
  return { startMoney, maxRounds, turnTimeoutSec };
}

function freshDeck(rng: RandomFn, data: GameData, deck: 'chance' | 'fate'): string[] {
  return shuffle(
    rng,
    data.cards.filter((c) => c.deck === deck).map((c) => c.id),
  );
}

/**
 * 创建新对局。玩家顺序 = 传入顺序（第一个玩家先手）。seed 用于洗牌。
 * 返回的 state 已处于第 1 轮第一个玩家的 preRoll；开局事件可用 startEvents(state) 获取。
 */
export function createGame(players: NewPlayer[], settings: Partial<GameSettings>, data: GameData, seed: number): GameState {
  if (players.length < 2) throw new EngineError('至少需要 2 名玩家');
  const st = normalizeSettings(settings);
  const rng = createRng(seed);
  const ps: Player[] = players.map((p) => {
    const ch = data.characters.find((c) => c.id === p.characterId);
    return {
      id: p.id,
      name: p.name,
      characterId: p.characterId,
      color: p.color ?? ch?.color ?? '#888888',
      money: st.startMoney,
      pos: 0,
      inJail: false,
      jailTurns: 0,
      items: [],
      bankrupt: false,
      connected: p.connected ?? true,
      isBot: p.isBot ?? false,
      shield: false,
      turtle: false,
      rocket: false,
      netWorth: st.startMoney,
      ...(p.diceSkin ? { diceSkin: p.diceSkin } : {}),
    };
  });
  const state: GameState = {
    phase: 'playing',
    round: 1,
    turnIndex: 0,
    currentPlayerId: ps[0].id,
    turnPhase: 'preRoll',
    players: ps,
    owned: {},
    roadblocks: [],
    pot: 0,
    dice: null,
    doublesCount: 0,
    pending: null,
    modifiers: { rentFactor: 1, rentRounds: 0, upgradeFactor: 1, upgradeRounds: 0 },
    log: [`游戏开始！每人 ${st.startMoney}T，${st.maxRounds ? `共 ${st.maxRounds} 轮` : '不限轮数'}。`, `第 1 轮：${ps[0].name} 的回合`],
    settings: st,
    decks: { chance: freshDeck(rng, data, 'chance'), fate: freshDeck(rng, data, 'fate') },
    turnDeadline: null,
    turnCount: 1,
    upgradedThisTurn: false,
  };
  return state;
}

/** 开局时要广播的事件 */
export function startEvents(state: GameState): GameEvent[] {
  return [{ type: 'turnStart', playerId: state.currentPlayerId, round: state.round }];
}

/* ====================================================================== */
/*                           事务上下文（内部）                             */
/* ====================================================================== */

class Tx {
  readonly ev: GameEvent[] = [];
  constructor(
    readonly s: GameState,
    readonly ctx: EngineCtx,
  ) {}

  get board() {
    return this.ctx.data.board;
  }
  cell(id: number): Cell {
    return this.board.cells[id];
  }
  player(id: string): Player {
    const p = this.s.players.find((x) => x.id === id);
    if (!p) throw new EngineError('玩家不存在');
    return p;
  }
  cur(): Player {
    return this.s.players[this.s.turnIndex];
  }
  emit(e: GameEvent): void {
    this.ev.push(e);
  }
  log(text: string): void {
    this.s.log.push(text);
    if (this.s.log.length > LOG_LIMIT) this.s.log.splice(0, this.s.log.length - LOG_LIMIT);
    this.emit({ type: 'log', text });
  }
  get ended(): boolean {
    return this.s.phase === 'ended';
  }
  diceTotal(): number {
    const d = this.s.dice;
    return d ? d[0] + d[1] : 7;
  }

  /* ---------------------------- 钱 ---------------------------- */

  gain(p: Player, amount: number, reason: string): void {
    if (amount === 0) return;
    p.money += amount;
    this.emit({ type: 'money', playerId: p.id, delta: amount, reason, balance: p.money });
  }

  /**
   * 付款：钱不够先自动清算（拆最高级建筑半价 → 抵押），仍不够则破产，资产归债主（null = 银行）。
   * 返回实际付出的金额。
   */
  charge(payer: Player, amount: number, creditorId: string | null, reason: string): number {
    if (amount <= 0 || payer.bankrupt) return 0;
    if (payer.money < amount) this.liquidate(payer, amount);
    const creditor = creditorId ? this.player(creditorId) : null;
    if (payer.money >= amount) {
      this.gain(payer, -amount, reason);
      if (creditor) this.gain(creditor, amount, reason);
      return amount;
    }
    // 破产：现金全部给债主
    const paid = payer.money;
    if (paid > 0) {
      this.gain(payer, -paid, reason);
      if (creditor) this.gain(creditor, paid, reason);
    }
    this.bankrupt(payer, creditorId);
    return paid;
  }

  /** 自动清算：先逐级拆除最高等级建筑（回收升级费一半），再按价格从低到高抵押 */
  liquidate(p: Player, need: number): void {
    let did = false;
    while (p.money < need) {
      const mine = Object.entries(this.s.owned)
        .filter(([, o]) => o.owner === p.id)
        .map(([k, o]) => ({ id: Number(k), o, cell: this.cell(Number(k)) }));
      const withBuilding = mine
        .filter((x) => x.o.level > 0)
        .sort((a, b) => b.o.level - a.o.level || (b.cell.price ?? 0) - (a.cell.price ?? 0));
      if (withBuilding.length) {
        const x = withBuilding[0];
        x.o.level -= 1;
        const refund = buildingSellValue(x.cell);
        this.emit({ type: 'downgrade', cellId: x.id, level: x.o.level, reason: 'liquidate' });
        this.gain(p, refund, `拆除「${x.cell.name}」建筑`);
        did = true;
        continue;
      }
      const toMortgage = mine.filter((x) => !x.o.mortgaged).sort((a, b) => (a.cell.price ?? 0) - (b.cell.price ?? 0));
      if (toMortgage.length) {
        const x = toMortgage[0];
        x.o.mortgaged = true;
        const val = mortgageValue(x.cell);
        this.emit({ type: 'mortgage', playerId: p.id, cellId: x.id, on: true, amount: val });
        this.gain(p, val, `抵押「${x.cell.name}」`);
        did = true;
        continue;
      }
      break;
    }
    if (did) this.log(`${p.name} 资金不足，自动清算资产（现有 ${p.money}T）`);
  }

  bankrupt(p: Player, creditorId: string | null): void {
    p.bankrupt = true;
    p.money = 0;
    p.items = [];
    p.shield = p.turtle = p.rocket = false;
    p.inJail = false;
    p.jailTurns = 0;
    const creditor = creditorId ? this.player(creditorId) : null;
    for (const [k, o] of Object.entries(this.s.owned)) {
      if (o.owner !== p.id) continue;
      if (creditor) o.owner = creditor.id;
      else delete this.s.owned[Number(k)];
    }
    this.emit(creditor ? { type: 'bankrupt', playerId: p.id, creditorId: creditor.id } : { type: 'bankrupt', playerId: p.id });
    this.log(creditor ? `${p.name} 破产了！全部资产归 ${creditor.name}` : `${p.name} 破产了！基建收归银行`);
    this.checkLastStanding();
  }

  checkLastStanding(): void {
    if (this.ended) return;
    const alive = this.s.players.filter((x) => !x.bankrupt);
    if (alive.length <= 1) this.endGame(alive[0]?.id);
  }

  endGame(winnerId?: string): void {
    if (this.ended) return;
    const s = this.s;
    s.phase = 'ended';
    s.pending = null;
    s.turnDeadline = null;
    for (const p of s.players) p.netWorth = calcNetWorth(this.board, s, p.id);
    const ranking = calcRanking(this.board, s);
    const win = winnerId ?? ranking[0].playerId;
    // 胜者排第一
    ranking.sort((a, b) => (a.playerId === win ? -1 : b.playerId === win ? 1 : 0));
    s.winnerId = win;
    s.ranking = ranking;
    this.emit({ type: 'gameOver', winnerId: win, ranking });
    this.log(`游戏结束！${this.player(win).name} 成为最终的大玩家！`);
  }

  /* ---------------------------- 移动 ---------------------------- */

  /** 按步数走（掷骰 / moveBy）。useRoadblocks 仅掷骰移动时为 true */
  walk(p: Player, steps: number, useRoadblocks: boolean): void {
    const from = p.pos;
    const res = computePath(from, steps, useRoadblocks ? this.s.roadblocks : []);
    p.pos = res.to;
    this.emit({
      type: 'move',
      playerId: p.id,
      from,
      to: res.to,
      path: res.path,
      passedStart: res.passedStart,
      ...(steps < 0 ? { backward: true as const } : {}),
    });
    if (res.roadblock !== null) {
      this.s.roadblocks = this.s.roadblocks.filter((c) => c !== res.roadblock);
      this.emit({ type: 'roadblockHit', playerId: p.id, cellId: res.roadblock });
      this.log(`${p.name} 撞上宕机路障，停在「${this.cell(res.roadblock).name}」`);
    }
    if (res.passedStart) this.passStart(p);
  }

  /** 前进到指定格（moveTo / nearest） */
  walkTo(p: Player, target: number, collectStart: boolean): void {
    const from = p.pos;
    const path = pathTo(from, target);
    const passed = path.includes(0);
    p.pos = target;
    this.emit({ type: 'move', playerId: p.id, from, to: target, path, passedStart: passed && collectStart });
    if (passed && collectStart) this.passStart(p);
  }

  teleport(p: Player, target: number): void {
    const from = p.pos;
    p.pos = target;
    this.emit({ type: 'move', playerId: p.id, from, to: target, path: [target], passedStart: false, teleport: true });
  }

  passStart(p: Player): void {
    this.gain(p, this.board.startBonus, '经过融资轮');
    this.log(`${p.name} 经过融资轮，获得 ${this.board.startBonus}T`);
  }

  sendToJail(p: Player): void {
    if (p.pos !== JAIL_CELL) this.teleport(p, JAIL_CELL);
    p.inJail = true;
    p.jailTurns = 0;
    if (p.id === this.cur().id) this.s.doublesCount = 0;
    this.emit({ type: 'jail', playerId: p.id });
    this.log(`${p.name} 被监管审查！`);
  }

  exitJail(p: Player, how: JailExitHow): void {
    p.inJail = false;
    p.jailTurns = 0;
    if (this.s.pending?.type === 'jail') this.s.pending = null;
    this.emit({ type: 'jailExit', playerId: p.id, how });
    const how2 = { pay: '缴纳罚款', card: '使用合规豁免卡', doubles: '掷出双骰', forced: '第 3 次强制缴费' }[how];
    this.log(`${p.name} ${how2}，结束监管审查`);
  }

  /** 罚款进奖池（8.9） */
  payJailFine(p: Player): boolean {
    const paid = this.charge(p, this.board.jailFine, null, '监管罚款');
    this.s.pot += paid;
    return !p.bankrupt;
  }

  /* ---------------------------- 落地结算 ---------------------------- */

  land(p: Player, diceTotal: number, rentMul = 1): void {
    const s = this.s;
    s.turnPhase = 'landed';
    const cell = this.cell(p.pos);
    switch (cell.type) {
      case 'property':
      case 'compute':
      case 'utility': {
        const o = s.owned[cell.id];
        if (!o) {
          const price = cell.price ?? 0;
          if (p.money >= price) s.pending = { type: 'buy', cellId: cell.id };
          else this.log(`${p.name} 想买「${cell.name}」但 Token 不够（需 ${price}T）`);
        } else if (o.owner === p.id) {
          if (cell.type === 'property' && !o.mortgaged && o.level < MAX_LEVEL) {
            const cost = upgradeCostOf(this.board, s.modifiers, cell.id);
            if (p.money >= cost) s.pending = { type: 'upgrade', cellId: cell.id };
            else this.log(`${p.name} 想升级「${cell.name}」但 Token 不够（需 ${cost}T）`);
          }
        } else if (o.mortgaged) {
          this.log(`「${cell.name}」已抵押，${p.name} 免付 API 调用费`);
        } else {
          this.payRent(p, cell, diceTotal, rentMul);
        }
        break;
      }
      case 'chance':
      case 'fate':
        this.drawCard(p, cell.type);
        break;
      case 'tax': {
        const amount = cell.tax ?? 0;
        const paid = this.charge(p, amount, null, cell.name);
        s.pot += paid;
        this.emit({ type: 'tax', playerId: p.id, amount: paid, pot: s.pot });
        this.log(`${p.name} 缴纳「${cell.name}」${paid}T，奖池现有 ${s.pot}T`);
        break;
      }
      case 'free':
        this.takePot(p);
        break;
      case 'gotojail':
        this.sendToJail(p);
        break;
      default:
        break; // start / jail（路过参观）
    }
  }

  payRent(p: Player, cell: Cell, diceTotal: number, rentMul: number): void {
    const o = this.s.owned[cell.id];
    const amount = calcRent(this.board, this.s.owned, this.s.modifiers, cell.id, diceTotal, rentMul);
    if (amount <= 0) return;
    const owner = this.player(o.owner);
    if (p.shield) {
      p.shield = false;
      this.emit({ type: 'rent', fromId: p.id, toId: owner.id, cellId: cell.id, amount, shielded: true });
      this.log(`${p.name} 的防火墙护盾挡下了「${cell.name}」${amount}T 的 API 调用费`);
      return;
    }
    this.emit({ type: 'rent', fromId: p.id, toId: owner.id, cellId: cell.id, amount, shielded: false });
    const paid = this.charge(p, amount, owner.id, `「${cell.name}」API 调用费`);
    this.log(`${p.name} 向 ${owner.name} 支付「${cell.name}」API 调用费 ${paid}T`);
  }

  takePot(p: Player): void {
    const amt = this.s.pot;
    if (amt <= 0) {
      this.log(`${p.name} 来到开源节，可惜奖池是空的`);
      return;
    }
    this.s.pot = 0;
    this.gain(p, amt, '开源节奖池');
    this.emit({ type: 'pot', playerId: p.id, amount: amt });
    this.log(`${p.name} 拿走开源节奖池 ${amt}T！`);
  }

  drawCard(p: Player, deck: 'chance' | 'fate'): void {
    const s = this.s;
    if (s.decks[deck].length === 0) s.decks[deck] = freshDeck(this.ctx.rng, this.ctx.data, deck);
    const id = s.decks[deck].shift();
    const card = this.ctx.data.cards.find((c) => c.id === id);
    if (!card) {
      this.log(`${deck === 'chance' ? '热搜' : '突发'}牌堆为空`);
      return;
    }
    s.pending = { type: 'card', card };
    this.emit({ type: 'card', playerId: p.id, card });
    this.log(`${p.name} 抽到${deck === 'chance' ? '热搜' : '突发'}：「${card.title}」`);
  }

  giveItem(p: Player, itemId: ItemId): void {
    const name = this.itemName(itemId);
    if (p.items.length >= MAX_ITEMS) {
      this.emit({ type: 'itemGain', playerId: p.id, itemId, discarded: true });
      this.log(`${p.name} 的道具栏已满，「${name}」被丢弃`);
      return;
    }
    p.items.push(itemId);
    this.emit({ type: 'itemGain', playerId: p.id, itemId, discarded: false });
    this.log(`${p.name} 获得道具「${name}」`);
  }

  itemName(id: string): string {
    return this.ctx.data.items.find((i) => i.id === id)?.name ?? id;
  }

  /* ---------------------------- 卡牌效果 ---------------------------- */

  applyCard(p: Player, card: Card): void {
    const s = this.s;
    const e = card.effect;
    switch (e.type) {
      case 'money':
        if (e.amount >= 0) this.gain(p, e.amount, card.title);
        else this.charge(p, -e.amount, null, card.title);
        break;
      case 'moneyFromEach': {
        const others = s.players.filter((x) => x.id !== p.id && !x.bankrupt);
        for (const o of others) {
          if (this.ended || p.bankrupt) break;
          if (e.amount >= 0) this.charge(o, e.amount, p.id, card.title);
          else this.charge(p, -e.amount, o.id, card.title);
        }
        break;
      }
      case 'moveTo':
        this.walkTo(p, e.cellId, !!e.collectStart);
        this.land(p, this.diceTotal());
        break;
      case 'moveBy':
        this.walk(p, e.steps, false);
        this.land(p, this.diceTotal());
        break;
      case 'gotoJail':
        this.sendToJail(p);
        break;
      case 'item':
        this.giveItem(p, e.itemId);
        break;
      case 'repairs': {
        let total = 0;
        for (const o of Object.values(s.owned)) {
          if (o.owner !== p.id || o.level <= 0) continue;
          total += o.level >= MAX_LEVEL ? e.perFlagship : e.perLevel * o.level;
        }
        if (total > 0) {
          const paid = this.charge(p, total, null, card.title);
          this.log(`${p.name} 支付维护费 ${paid}T`);
        } else this.log(`${p.name} 没有建筑，免交维护费`);
        break;
      }
      case 'nearest': {
        const target = nearestCellOfType(this.board, p.pos, e.cellType);
        if (target === null) break;
        this.walkTo(p, target, true);
        this.land(p, this.diceTotal(), e.rentMul);
        break;
      }
      case 'rentMod':
        s.modifiers.rentFactor = e.factor;
        s.modifiers.rentRounds = e.rounds;
        this.emit({ type: 'modifier', kind: 'rent', factor: e.factor, rounds: e.rounds });
        this.log(`全场 API 调用费 ×${e.factor}，持续 ${e.rounds} 轮`);
        break;
      case 'upgradeCostMod':
        s.modifiers.upgradeFactor = e.factor;
        s.modifiers.upgradeRounds = e.rounds;
        this.emit({ type: 'modifier', kind: 'upgrade', factor: e.factor, rounds: e.rounds });
        this.log(`全场升级费 ×${e.factor}，持续 ${e.rounds} 轮`);
        break;
      case 'downgradeAll': {
        let n = 0;
        for (const [k, o] of Object.entries(s.owned)) {
          if (o.level <= 0) continue;
          o.level = Math.max(0, o.level - e.levels);
          this.emit({ type: 'downgrade', cellId: Number(k), level: o.level, reason: 'card' });
          n++;
        }
        this.log(n ? `${n} 块基建的模型版本被降级！` : '场上还没有建筑，无事发生');
        break;
      }
      case 'levelUpRandom': {
        const cands = Object.entries(s.owned)
          .filter(([k, o]) => o.owner === p.id && !o.mortgaged && o.level < MAX_LEVEL && this.cell(Number(k)).type === 'property')
          .map(([k]) => Number(k));
        const id = pick(this.ctx.rng, cands);
        if (id === undefined) {
          this.log(`${p.name} 没有可升级的基建，无事发生`);
          break;
        }
        const o = s.owned[id];
        o.level += 1;
        this.emit({ type: 'upgrade', playerId: p.id, cellId: id, level: o.level, cost: 0, free: true });
        this.log(`「${this.cell(id).name}」免费升级到 ${levelName(o.level)}`);
        break;
      }
      case 'swapPosition': {
        const cands = s.players.filter((x) => x.id !== p.id && !x.bankrupt && !x.inJail);
        const other = pick(this.ctx.rng, cands);
        if (!other) {
          this.log('没有可交换位置的对手，无事发生');
          break;
        }
        const a = p.pos;
        const b = other.pos;
        this.teleport(p, b);
        this.teleport(other, a);
        this.log(`${p.name} 与 ${other.name} 交换了位置`);
        break;
      }
      case 'potToPlayer':
        this.takePot(p);
        break;
    }
  }

  /* ---------------------------- 道具 ---------------------------- */

  useItem(p: Player, itemId: ItemId, target: ItemTarget | undefined): void {
    const s = this.s;
    const idx = p.items.indexOf(itemId);
    if (idx < 0) throw new EngineError('你没有这个道具');
    const def = this.ctx.data.items.find((i) => i.id === itemId);
    const tg = itemTargets(this.board, s, p.id, itemId, def?.range);
    const name = this.itemName(itemId);
    const consume = () => p.items.splice(idx, 1);

    switch (itemId) {
      case 'roadblock': {
        const c = target?.cellId;
        if (c === undefined || !tg.cells.includes(c)) throw new EngineError('请选择前方范围内的空格子放置路障');
        consume();
        s.roadblocks.push(c);
        this.emit({ type: 'item', playerId: p.id, itemId, targetCellId: c });
        this.log(`${p.name} 在「${this.cell(c).name}」放置了宕机路障`);
        break;
      }
      case 'missile': {
        const c = target?.cellId;
        if (c === undefined || !tg.cells.includes(c)) throw new EngineError('请选择前方范围内对手有建筑的基建');
        consume();
        const o = s.owned[c];
        this.emit({ type: 'item', playerId: p.id, itemId, targetCellId: c });
        o.level -= 1;
        this.emit({ type: 'downgrade', cellId: c, level: o.level, byId: p.id, reason: 'missile' });
        this.log(`${p.name} 用 DDoS 导弹轰炸「${this.cell(c).name}」，降为 ${levelName(o.level)}`);
        break;
      }
      case 'rocket':
        if (p.rocket) throw new EngineError('火箭加速已生效');
        consume();
        p.rocket = true;
        this.emit({ type: 'item', playerId: p.id, itemId });
        this.log(`${p.name} 启动火箭加速，本回合掷骰 +6`);
        break;
      case 'turtle': {
        const pid = target?.playerId;
        if (!pid || !tg.players.includes(pid)) throw new EngineError('请选择一名对手');
        consume();
        const victim = this.player(pid);
        victim.turtle = true;
        this.emit({ type: 'item', playerId: p.id, itemId, targetPlayerId: pid });
        this.log(`${p.name} 对 ${victim.name} 使用限流乌龟，其下次掷骰固定为 1`);
        break;
      }
      case 'shield':
        if (p.shield) throw new EngineError('防火墙护盾已生效');
        consume();
        p.shield = true;
        this.emit({ type: 'item', playerId: p.id, itemId });
        this.log(`${p.name} 开启防火墙护盾`);
        break;
      case 'teleport': {
        if (p.inJail) throw new EngineError('监管审查中不能使用跳板机');
        let dest = 0;
        if (tg.cells.length) {
          const c = target?.cellId;
          if (c === undefined || !tg.cells.includes(c)) throw new EngineError('请选择一块自己的基建');
          dest = c;
        }
        consume();
        this.emit({ type: 'item', playerId: p.id, itemId, targetCellId: dest });
        this.teleport(p, dest);
        this.log(`${p.name} 通过跳板机传送到「${this.cell(dest).name}」`);
        break;
      }
      case 'jailfree':
        if (!p.inJail) throw new EngineError('不在监管审查中，无需使用合规豁免卡');
        consume();
        this.emit({ type: 'item', playerId: p.id, itemId });
        this.exitJail(p, 'card');
        break;
      default:
        throw new EngineError('未知道具');
    }
  }

  /* ---------------------------- 掷骰与回合 ---------------------------- */

  /** 掷两颗骰子，处理乌龟 / 火箭。返回 {dice,total,doubles} */
  roll(p: Player, jail: boolean): { total: number; doubles: boolean } {
    const d1 = rollDie(this.ctx.rng);
    const d2 = rollDie(this.ctx.rng);
    let dice: [number, number] = [d1, d2];
    let total = d1 + d2;
    let doubles = d1 === d2;
    let turtle = false;
    let rocket = false;
    if (p.turtle) {
      p.turtle = false;
      turtle = true;
      dice = [1, 0];
      total = 1;
      doubles = false;
    }
    if (p.rocket) {
      p.rocket = false;
      rocket = true;
      total += 6;
    }
    this.s.dice = dice;
    this.emit({
      type: 'dice',
      playerId: p.id,
      dice,
      total,
      doubles,
      ...(rocket ? { rocket: true as const } : {}),
      ...(turtle ? { turtle: true as const } : {}),
      ...(jail ? { jail: true as const } : {}),
    });
    this.log(
      `${p.name} 掷出 ${turtle ? '1（被限流）' : `${dice[0]}+${dice[1]}`}${rocket ? ' +6（火箭）' : ''} = ${total}${doubles ? '，双骰！' : ''}`,
    );
    return { total, doubles };
  }

  /** 结算完毕后推进：等待决策 / 双骰再掷 / 结束回合 */
  advance(): void {
    const s = this.s;
    if (this.ended || s.pending) return;
    const p = this.cur();
    if (!p.bankrupt && !p.inJail && s.doublesCount > 0) {
      s.turnPhase = 'preRoll';
      this.log(`${p.name} 掷出双骰，再掷一次`);
      return;
    }
    s.turnPhase = 'postRoll';
    this.endTurn();
  }

  endTurn(): void {
    const s = this.s;
    if (this.ended) return;
    s.pending = null;
    s.doublesCount = 0;
    const n = s.players.length;
    const from = s.turnIndex;
    let next = -1;
    for (let i = 1; i <= n; i++) {
      const cand = (from + i) % n;
      if (!s.players[cand].bankrupt) {
        next = cand;
        break;
      }
    }
    if (next < 0) return this.checkLastStanding();
    if (next <= from) {
      this.newRound();
      if (this.ended) return;
    }
    s.turnIndex = next;
    s.currentPlayerId = s.players[next].id;
    this.startTurn();
  }

  newRound(): void {
    const s = this.s;
    s.round += 1;
    const m = s.modifiers;
    if (m.rentRounds > 0) {
      m.rentRounds -= 1;
      if (m.rentRounds === 0) {
        m.rentFactor = 1;
        this.emit({ type: 'modifier', kind: 'rent', factor: 1, rounds: 0 });
        this.log('API 调用费倍率恢复正常');
      }
    }
    if (m.upgradeRounds > 0) {
      m.upgradeRounds -= 1;
      if (m.upgradeRounds === 0) {
        m.upgradeFactor = 1;
        this.emit({ type: 'modifier', kind: 'upgrade', factor: 1, rounds: 0 });
        this.log('升级费倍率恢复正常');
      }
    }
    if (s.settings.maxRounds > 0 && s.round > s.settings.maxRounds) {
      s.round = s.settings.maxRounds;
      this.log(`已达到 ${s.settings.maxRounds} 轮上限，按身价结算`);
      this.endGame();
    } else if (s.settings.maxRounds === 0 && s.round > UNLIMITED_ROUND_CAP) {
      // 不限轮数的兜底：避免路演时一局跑不完
      s.round = UNLIMITED_ROUND_CAP;
      this.log(`已进行 ${UNLIMITED_ROUND_CAP} 轮仍未分出胜负，按身价结算`);
      this.endGame();
    }
  }

  startTurn(): void {
    const s = this.s;
    const p = this.cur();
    s.turnCount += 1;
    s.turnPhase = 'preRoll';
    s.doublesCount = 0;
    s.dice = null;
    s.upgradedThisTurn = false;
    s.pending = p.inJail ? { type: 'jail' } : null;
    this.emit({ type: 'turnStart', playerId: p.id, round: s.round });
    this.log(`第 ${s.round} 轮：${p.name} 的回合${p.inJail ? '（监管审查中）' : ''}`);
  }

  /** 掷骰移动并落地结算 */
  moveByDice(p: Player, total: number): void {
    this.s.turnPhase = 'moving';
    this.walk(p, total, true);
    this.land(p, total);
  }
}

export function levelName(level: number): string {
  return level >= MAX_LEVEL ? '旗舰 AGI' : level <= 0 ? '未发布' : `v${level}`;
}

/* ====================================================================== */
/*                               reduce                                   */
/* ====================================================================== */

/**
 * 纯函数状态机：对 state 应用 action，返回新 state 与本次产生的事件。
 * 非法动作抛 EngineError（中文提示）。
 */
export function reduce(state: GameState, action: GameAction, ctx: EngineCtx): ReduceResult {
  if (state.phase !== 'playing') throw new EngineError('游戏已结束');
  if (ctx.actorId !== state.currentPlayerId) throw new EngineError('还没轮到你');
  const s = structuredClone(state);
  const tx = new Tx(s, ctx);
  const p = tx.cur();
  const pending = s.pending;
  const inPreRoll = s.turnPhase === 'preRoll' && (pending === null || pending.type === 'jail');

  switch (action.type) {
    case 'roll': {
      if (!inPreRoll || p.inJail) throw new EngineError(p.inJail ? '监管审查中，请选择出狱方式' : '现在不能掷骰');
      const { total, doubles } = tx.roll(p, false);
      s.doublesCount = doubles ? s.doublesCount + 1 : 0;
      if (s.doublesCount >= 3) {
        tx.log(`${p.name} 连续三次双骰，被监管盯上了！`);
        tx.sendToJail(p);
        tx.advance();
        break;
      }
      tx.moveByDice(p, total);
      tx.advance();
      break;
    }

    case 'buy': {
      if (pending?.type !== 'buy') throw new EngineError('现在不能购买');
      const cell = tx.cell(pending.cellId);
      const price = cell.price ?? 0;
      if (p.money < price) throw new EngineError('Token 不够');
      s.pending = null;
      tx.gain(p, -price, `购买「${cell.name}」`);
      s.owned[cell.id] = { owner: p.id, level: 0, mortgaged: false };
      tx.emit({ type: 'buy', playerId: p.id, cellId: cell.id, price });
      tx.log(`${p.name} 以 ${price}T 买下「${cell.name}」`);
      tx.advance();
      break;
    }

    case 'skipBuy': {
      if (pending?.type !== 'buy') throw new EngineError('现在没有购买决策');
      s.pending = null;
      tx.log(`${p.name} 放弃购买「${tx.cell(pending.cellId).name}」`);
      tx.advance();
      break;
    }

    case 'upgrade': {
      if (pending?.type !== 'upgrade') throw new EngineError('现在不能升级');
      const cell = tx.cell(pending.cellId);
      const o = s.owned[cell.id];
      const cost = upgradeCostOf(tx.board, s.modifiers, cell.id);
      if (p.money < cost) throw new EngineError('Token 不够');
      s.pending = null;
      tx.gain(p, -cost, `升级「${cell.name}」`);
      o.level += 1;
      tx.emit({ type: 'upgrade', playerId: p.id, cellId: cell.id, level: o.level, cost });
      tx.log(`${p.name} 花 ${cost}T 把「${cell.name}」升级到 ${levelName(o.level)}`);
      tx.advance();
      break;
    }

    case 'upgradeAny': {
      // DESIGN 10.1：preRoll（含监管中）远程升级任意一块自己的基建，每回合最多 1 次
      if (!inPreRoll) throw new EngineError('只能在掷骰前升级');
      if (s.upgradedThisTurn) throw new EngineError('本回合已经远程升级过了');
      const id = action.cellId;
      const cell = typeof id === 'number' ? tx.board.cells[id] : undefined;
      const o = cell ? s.owned[cell.id] : undefined;
      if (!cell || !o || o.owner !== p.id) throw new EngineError('这不是你的基建');
      if (cell.type !== 'property') throw new EngineError('只有基建可以升级');
      if (o.mortgaged) throw new EngineError('已抵押的基建不能升级');
      if (o.level >= MAX_LEVEL) throw new EngineError('已经是旗舰了');
      const cost = upgradeCostOf(tx.board, s.modifiers, cell.id);
      if (p.money < cost) throw new EngineError(`Token 不够，升级需要 ${cost}T`);
      s.upgradedThisTurn = true;
      tx.gain(p, -cost, `升级「${cell.name}」`);
      o.level += 1;
      tx.emit({ type: 'upgrade', playerId: p.id, cellId: cell.id, level: o.level, cost, remote: true });
      tx.log(`${p.name} 花 ${cost}T 远程把「${cell.name}」升级到 ${levelName(o.level)}`);
      break;
    }

    case 'skipUpgrade': {
      if (pending?.type !== 'upgrade') throw new EngineError('现在没有升级决策');
      s.pending = null;
      tx.advance();
      break;
    }

    case 'ackCard': {
      if (pending?.type !== 'card') throw new EngineError('现在没有卡牌');
      s.pending = null;
      tx.applyCard(p, pending.card);
      tx.advance();
      break;
    }

    case 'useItem': {
      if (!inPreRoll) throw new EngineError('只能在掷骰前使用道具');
      tx.useItem(p, action.itemId, action.target);
      break;
    }

    case 'payJail': {
      if (pending?.type !== 'jail') throw new EngineError('你不在监管审查中');
      if (p.money < tx.board.jailFine) throw new EngineError(`Token 不够支付 ${tx.board.jailFine}T 罚款`);
      tx.payJailFine(p);
      tx.exitJail(p, 'pay');
      break;
    }

    case 'useJailCard': {
      if (pending?.type !== 'jail') throw new EngineError('你不在监管审查中');
      tx.useItem(p, 'jailfree', undefined);
      break;
    }

    case 'rollJail': {
      if (pending?.type !== 'jail') throw new EngineError('你不在监管审查中');
      s.pending = null;
      p.jailTurns += 1;
      const { total, doubles } = tx.roll(p, true);
      s.doublesCount = 0; // 出狱掷出的双骰不再追加回合
      if (doubles) {
        tx.exitJail(p, 'doubles');
      } else if (p.jailTurns >= JAIL_MAX_TURNS) {
        tx.payJailFine(p);
        if (p.bankrupt) {
          tx.advance();
          break;
        }
        tx.exitJail(p, 'forced');
      } else {
        tx.log(`${p.name} 没有掷出双骰，继续接受审查（第 ${p.jailTurns}/${JAIL_MAX_TURNS} 次）`);
        tx.advance();
        break;
      }
      tx.moveByDice(p, total);
      tx.advance();
      break;
    }

    case 'mortgage': {
      if (!inPreRoll) throw new EngineError('只能在掷骰前抵押');
      const o = s.owned[action.cellId];
      const cell = tx.cell(action.cellId);
      if (!o || o.owner !== p.id) throw new EngineError('这不是你的基建');
      if (o.mortgaged) throw new EngineError('已经抵押了');
      if (o.level > 0) throw new EngineError('有建筑的基建不能抵押');
      o.mortgaged = true;
      const val = mortgageValue(cell);
      tx.emit({ type: 'mortgage', playerId: p.id, cellId: cell.id, on: true, amount: val });
      tx.gain(p, val, `抵押「${cell.name}」`);
      tx.log(`${p.name} 抵押「${cell.name}」，获得 ${val}T`);
      break;
    }

    case 'unmortgage': {
      if (!inPreRoll) throw new EngineError('只能在掷骰前赎回');
      const o = s.owned[action.cellId];
      const cell = tx.cell(action.cellId);
      if (!o || o.owner !== p.id) throw new EngineError('这不是你的基建');
      if (!o.mortgaged) throw new EngineError('没有抵押');
      const cost = unmortgageCost(cell);
      if (p.money < cost) throw new EngineError(`Token 不够，赎回需要 ${cost}T`);
      o.mortgaged = false;
      tx.emit({ type: 'mortgage', playerId: p.id, cellId: cell.id, on: false, amount: cost });
      tx.gain(p, -cost, `赎回「${cell.name}」`);
      tx.log(`${p.name} 花 ${cost}T 赎回「${cell.name}」`);
      break;
    }

    default:
      throw new EngineError('未知动作');
  }

  for (const pl of s.players) pl.netWorth = calcNetWorth(tx.board, s, pl.id);
  return { state: s, events: tx.ev };
}

/* ====================================================================== */
/*                         超时默认动作 / 合法动作                          */
/* ====================================================================== */

/** 回合超时的默认动作（DESIGN 8.10） */
export function defaultAction(state: GameState): GameAction {
  switch (state.pending?.type) {
    case 'buy':
      return { type: 'skipBuy' };
    case 'upgrade':
      return { type: 'skipUpgrade' };
    case 'card':
      return { type: 'ackCard' };
    case 'jail':
      return { type: 'rollJail' };
    default:
      return { type: 'roll' };
  }
}

// 供测试 / 机器人使用的常量再导出
export { BOARD_SIZE, GOTO_JAIL_CELL, JAIL_CELL, isOwnable, randInt };
export { legalActionTypes } from '@dafuweng/shared';
