// 特效接口（DESIGN 5.3 + 9.5）与基础版实现。
// 每个特效是 fx/ 下的独立函数；这里只做组装与调度。替换为“酷炫版”时只需改 fx/ 目录。
import type { Application } from 'pixi.js';
import type { Card } from '@dafuweng/shared';
import type { BoardView } from '../board/board';
import { assetUrl, avatarUrl } from '../assets';
import { itemOf } from '../store';
import { downgradeCtx, playBuild, playBuy, playDowngrade } from './build';
import { playCard } from './card';
import type { FxContext } from './context';
import { playDice, type DiceOpts } from './dice';
import { playItem } from './items';
import { playMoney, playRent } from './money';
import { playMove, playPassStart, playRoadblockHit, playTeleport, resetMoveCtx } from './move';
import { banner, notice, playBankrupt, playGameOver, playJail, playJailExit } from './overlay';
import { Particles } from './particles';
import { FxRuntime } from './runtime';
import { injectFxCss } from './style';

export interface Fx {
  init(app: Application, board: BoardView, overlay: HTMLElement): void;
  /** 骰子翻滚 ≥0.9s，落定显示点数；b=0 表示乌龟（隐藏第二颗） */
  dice(a: number, b: number, skin: string, opts?: DiceOpts): Promise<void>;
  /** 逐格跳跃；opts.teleport 时为瞬移（path=[to]） */
  move(playerId: string, path: number[], opts?: { teleport?: boolean; backward?: boolean }): Promise<void>;
  passStart(playerId: string, amount: number): Promise<void>;
  roadblockHit(playerId: string, cellId: number): Promise<void>;
  buy(cellId: number, playerId: string): Promise<void>;
  build(cellId: number, level: number): Promise<void>;
  downgrade(cellId: number, level: number): Promise<void>;
  rent(fromId: string, toId: string, amount: number, shielded: boolean): Promise<void>;
  money(playerId: string, delta: number, reason: string): Promise<void>;
  /** 全屏卡牌，点击或 2.5s 关闭 */
  card(card: Card): Promise<void>;
  jail(playerId: string): Promise<void>;
  item(playerId: string, itemId: string, targetCellId?: number, targetPlayerId?: string): Promise<void>;
  bankrupt(playerId: string): Promise<void>;
  gameOver(winnerId: string): Promise<void>;
  shake(ms: number, strength: number): void;
  /** 回合开始等中央横幅 */
  banner(text: string, kind?: 'primary' | 'danger' | 'gold' | 'accent', holdMs?: number, sub?: string): Promise<void>;
  /** 轻提示（不阻塞） */
  notice(text: string, color?: string): void;
  /** 快进：当前与后续动画全部瞬间完成，直到 resume() */
  skipAll(): void;
  resume(): void;
  /** 全局播放速度（事件积压时由事件队列调高） */
  setSpeed(speed: number): void;
  readonly skipping: boolean;
}

class BasicFx implements Fx {
  private ctx!: FxContext;
  private rt = new FxRuntime();
  private shakeUntil = 0;
  private shakeStrength = 0;
  private shakeRaf = 0;
  /** 最近一次移动 / 掷骰的玩家（卡牌关闭时飞向 TA） */
  private actor = '';

  get skipping(): boolean {
    return this.rt.skipping;
  }

  init(app: Application, board: BoardView, overlay: HTMLElement): void {
    injectFxCss();
    this.ctx = {
      app,
      board,
      overlay,
      rt: this.rt,
      particles: new Particles(app, this.rt),
      shake: (ms, s) => this.shake(ms, s),
    };
    this.hookJailExit(board);
    if (/[?&]fxdemo\b/.test(location.search)) void import('./demo').then((m) => m.installFxDemo(this, this.ctx));
  }

  /**
   * 出狱时栏杆升起：事件队列在 jailExit 时直接调用 board.setJailed(pid, false)（Fx 接口没有对应方法），
   * 这里在 fx 内包一层实例方法来触发动画（不改 board.ts）。希望 BoardView / Fx 以后提供 jailExit 钩子。
   */
  private hookJailExit(board: BoardView): void {
    const orig = board.setJailed.bind(board);
    board.setJailed = (playerId: string, jailed: boolean) => {
      const was = !!board.player(playerId)?.inJail;
      if (!jailed && was && board.tokenCellOf(playerId) === 10) playJailExit(this.ctx, playerId);
      orig(playerId, jailed);
    };
  }

  /** 新的一段动作开始：清理上一段的降级上下文 */
  private beginAction(): void {
    downgradeCtx.bubbleActive = false;
  }

  dice(a: number, b: number, skin: string, opts?: DiceOpts) {
    this.beginAction();
    downgradeCtx.bubblePending = false;
    resetMoveCtx();
    return playDice(this.ctx, a, b, skin, opts);
  }
  move(playerId: string, path: number[], opts: { teleport?: boolean; backward?: boolean } = {}) {
    this.beginAction();
    this.actor = playerId;
    if (opts.teleport) return playTeleport(this.ctx, playerId, path[path.length - 1] ?? 0);
    return playMove(this.ctx, playerId, path, !!opts.backward);
  }
  passStart(playerId: string, amount: number) {
    return playPassStart(this.ctx, playerId, amount);
  }
  roadblockHit(playerId: string, cellId: number) {
    return playRoadblockHit(this.ctx, playerId, cellId);
  }
  buy(cellId: number, playerId: string) {
    return playBuy(this.ctx, cellId, playerId);
  }
  build(cellId: number, level: number) {
    this.beginAction();
    return playBuild(this.ctx, cellId, level);
  }
  downgrade(cellId: number, level: number) {
    return playDowngrade(this.ctx, cellId, level);
  }
  rent(fromId: string, toId: string, amount: number, shielded: boolean) {
    this.beginAction();
    return playRent(this.ctx, fromId, toId, amount, shielded);
  }
  money(playerId: string, delta: number, reason: string) {
    return playMoney(this.ctx, playerId, delta, reason);
  }
  card(card: Card) {
    this.beginAction();
    // AI 泡沫破裂（downgradeAll）：随后的 downgrade 事件改播“全场建筑同时抖动冒烟”
    downgradeCtx.bubblePending = card.effect.type === 'downgradeAll';
    return playCard(this.ctx, card, assetUrl, this.actor || undefined);
  }
  jail(playerId: string) {
    return playJail(this.ctx, playerId);
  }
  item(playerId: string, itemId: string, targetCellId?: number, targetPlayerId?: string) {
    this.beginAction();
    this.actor = playerId;
    return playItem(this.ctx, playerId, itemId, itemOf(itemId)?.name ?? itemId, targetCellId, targetPlayerId);
  }
  bankrupt(playerId: string) {
    return playBankrupt(this.ctx, playerId);
  }
  gameOver(winnerId: string) {
    const p = this.ctx.board.player(winnerId);
    return playGameOver(this.ctx, winnerId, avatarUrl(p?.characterId ?? ''), p?.name ?? '');
  }
  banner(text: string, kind: 'primary' | 'danger' | 'gold' | 'accent' = 'primary', holdMs = 500, sub = '') {
    if (text.includes('轮到')) this.beginAction();
    return banner(this.ctx, text, kind, holdMs, sub);
  }
  notice(text: string, color?: string) {
    notice(this.ctx, text, color);
  }

  /** 震动棋盘 world 容器：多个震动取最大值不叠加；手机 ×0.7 */
  shake(ms: number, strength: number): void {
    if (this.rt.skipping) return;
    const k = window.innerWidth < 760 ? 0.7 : 1;
    const now = performance.now();
    const remaining = Math.max(0, this.shakeUntil - now);
    if (ms >= remaining) this.shakeUntil = now + ms;
    this.shakeStrength = Math.max(remaining > 0 ? this.shakeStrength : 0, strength * k);
    const total = Math.max(ms, remaining);
    const world = this.ctx.board.world;
    if (this.shakeRaf) return;
    const tick = () => {
      const t = performance.now();
      const left = this.shakeUntil - t;
      if (left <= 0 || this.rt.skipping) {
        world.position.set(0, 0);
        this.shakeRaf = 0;
        this.shakeStrength = 0;
        return;
      }
      const s = this.shakeStrength * (left / total);
      world.position.set((Math.random() * 2 - 1) * s, (Math.random() * 2 - 1) * s);
      this.shakeRaf = requestAnimationFrame(tick);
    };
    this.shakeRaf = requestAnimationFrame(tick);
  }

  skipAll(): void {
    this.rt.skipAll();
    this.ctx?.board.world.position.set(0, 0);
  }

  /** 调试用：直接拿到上下文（?fxdemo 面板） */
  get context(): FxContext {
    return this.ctx;
  }
  resume(): void {
    this.rt.resume();
  }
  setSpeed(speed: number): void {
    this.rt.setSpeed(speed);
  }
}

export function createFx(): Fx {
  return new BasicFx();
}

export type { DiceOpts } from './dice';
