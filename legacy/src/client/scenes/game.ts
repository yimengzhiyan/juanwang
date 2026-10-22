// 对局场景：组装 BoardView + HUD + 面板 + 事件队列。
// 收到 game 消息 → 依次播放 events（await fx）→ 用快照刷新全部 UI。播放期间按钮禁用；点击任意处快进。
import type { Application } from 'pixi.js';
import { itemTargets, type GameAction, type GameEvent, type GameState, type ItemId } from '@dafuweng/shared';
import { BoardView } from '../board/board';
import { fitBoard, layoutMode } from '../board/layout';
import { createFx, type Fx } from '../fx';
import { net } from '../net';
import { cellOf, data, itemOf, randomLine, store } from '../store';
import { Hud } from '../ui/hud';
import { Panels, showCellDetail, showResults, speechBubble } from '../ui/panels';
import { h, toast } from '../util';

interface GameMsg {
  state: GameState;
  events: GameEvent[];
  serverTime: number;
}

const DEBUG = /[?&]debug\b/.test(location.search);

type Tab = 'items' | 'props' | 'log' | 'chat';

const JAIL_HOW: Record<string, string> = { pay: '缴纳罚款', card: '使用豁免卡', doubles: '掷出双骰', forced: '强制缴费' };

export class GameScene {
  readonly el: HTMLElement;
  board: BoardView;
  private fx: Fx;
  private hud: Hud;
  private panels: Panels;
  private queue: GameMsg[] = [];
  private playing = false;
  state: GameState | null = null;
  private slot: HTMLElement;
  private overlay: HTMLElement;
  private bubbles: HTMLElement;
  private sheet: HTMLElement;
  private tab: Tab = 'props';
  private sheetOpen = false;
  private targetItem: ItemId | null = null;
  private targetCells: number[] = [];
  private targetPlayers: string[] = [];
  private closeResults: (() => void) | null = null;
  private ro: ResizeObserver;
  private destroyed = false;
  private mode = layoutMode();
  private onSkipClick = (e: Event) => {
    if (!this.playing) return;
    const t = e.target as HTMLElement;
    if (t.closest('.modal-back, .chat-row, .tabbar')) return;
    this.fx.skipAll();
  };
  private onResize = () => this.relayout();

  constructor(private app: Application) {
    this.el = h('div.scene.scene-game');
    const top = h(
      'header.topbar.glass',
      null,
      h('img.tb-logo', { src: '/assets/logo.svg', alt: '大玩家' }),
      h('span.tb-item', null, h('small', null, '轮'), h('b.tb-round', null, '')),
      h('span.tb-item.tb-potwrap', null, h('small', null, '奖池'), h('b.tb-pot.money', null, '0T')),
      h('span.tb-item', null, h('small', null, '房间'), h('b.tb-code', null, '')),
      h('button.tb-btn', { type: 'button', title: '游戏日志', onclick: () => this.openTab('log') }, '日志'),
      h('button.tb-btn', { type: 'button', title: '离开房间', onclick: () => this.confirmLeave() }, '离开'),
    );
    const players = h('div.players');
    this.slot = h('div.board-slot');
    const actions = h('div.actions.glass', null, h('div.act-timer', { hidden: true }, h('i'), h('span')), h('div.act-prompt'), h('div.act-btns'));
    this.panels = new Panels({
      act: (a) => this.act(a),
      startTarget: (id) => this.startTarget(id),
      chat: (text) => net.send({ t: 'chat', text }),
    });
    // 侧栏（桌面）/ 抽屉（手机）
    const tabbar = h(
      'nav.tabbar.glass',
      null,
      ...(['items', 'props', 'log', 'chat'] as Tab[]).map((t) =>
        h('button.tab', { type: 'button', 'data-tab': t, onclick: () => this.openTab(t) }, { items: '道具', props: '基建', log: '日志', chat: '聊天' }[t]),
      ),
    );
    this.sheet = h(
      'div.sheet.glass',
      null,
      h('button.sheet-close', { type: 'button', onclick: () => this.closeSheet() }, '收起'),
      h('div.sheet-body', null, this.panels.items, this.panels.props, this.panels.log, this.panels.chat),
    );
    const side = h('aside.side', null, tabbar, this.sheet);
    this.el.append(top, players, this.slot, actions, side);
    this.overlay = h('div.fx-overlay');
    this.bubbles = h('div.bubble-layer');
    document.body.append(this.el, this.bubbles, this.overlay);

    this.board = new BoardView(app);
    this.fx = createFx();
    this.fx.init(app, this.board, this.overlay);
    this.hud = new Hud(players, actions, top, {
      act: (a) => this.act(a),
      onPlayerTap: (pid) => this.onPlayerTap(pid),
      cancelTarget: () => this.cancelTarget(),
    });
    this.board.hudPointResolver = (pid) => this.hud.playerPoint(pid);
    this.board.onCellTap = (id) => this.onCellTap(id);
    this.board.onTokenTap = (pid) => {
      if (this.targetItem && this.targetPlayers.length) this.onPlayerTap(pid);
      else this.onCellTap(this.board.tokenCellOf(pid));
    };

    this.ro = new ResizeObserver(() => this.relayout());
    this.ro.observe(this.slot);
    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerdown', this.onSkipClick, true);
    app.canvas.style.visibility = 'visible';
    this.relayout();
    this.openTab(this.mode === 'mobile' ? 'items' : 'props', false);
  }

  destroy(): void {
    this.destroyed = true;
    this.fx.skipAll();
    this.ro.disconnect();
    window.removeEventListener('resize', this.onResize);
    document.removeEventListener('pointerdown', this.onSkipClick, true);
    this.hud.destroy();
    this.board.destroy();
    this.closeResults?.();
    this.el.remove();
    this.overlay.remove();
    this.bubbles.remove();
    this.app.canvas.style.visibility = 'hidden';
  }

  /* =============================== 布局 =============================== */

  private relayout(): void {
    if (this.destroyed) return;
    const mode = layoutMode();
    this.mode = mode;
    this.el.dataset.layout = mode;
    const r = this.slot.getBoundingClientRect();
    if (r.width < 50 || r.height < 50) return;
    const fit = fitBoard(r, mode === 'mobile' ? 0 : 6);
    const sizeChanged = Math.abs(fit.size - this.board.size) > 0.5;
    if (sizeChanged && this.playing) this.fx.skipAll();
    this.board.layout(fit.x, fit.y, fit.size);
    if (sizeChanged && this.state) this.board.sync(this.state);
    this.el.classList.toggle('sheet-open', this.sheetOpen);
    // 手机：棋盘下方剩余空间太小时，面板改为上拉 sheet
    if (mode === 'mobile') {
      const side = this.el.querySelector('.side') as HTMLElement;
      const avail = window.innerHeight - side.getBoundingClientRect().top;
      this.el.classList.toggle('side-compact', avail < 220);
    } else this.el.classList.remove('side-compact');
  }

  private openTab(t: Tab, toggle = true): void {
    const mobile = (this.mode === 'mobile' && this.el.classList.contains('side-compact')) || this.mode === 'landscapePhone';
    if (mobile && toggle && this.sheetOpen && this.tab === t) {
      this.closeSheet();
      return;
    }
    if (this.mode !== 'mobile' && t === 'items') t = 'props'; // 桌面道具栏常驻
    this.tab = t;
    this.el.dataset.tab = t;
    for (const b of this.el.querySelectorAll<HTMLElement>('.tab')) b.classList.toggle('active', b.dataset.tab === t);
    if (mobile && toggle) {
      this.sheetOpen = true;
      this.el.classList.add('sheet-open');
    }
  }

  private closeSheet(): void {
    this.sheetOpen = false;
    this.el.classList.remove('sheet-open');
  }

  /* =============================== 输入 =============================== */

  private act(a: GameAction): void {
    if (this.playing) return;
    if (!net.send({ t: 'action', action: a })) toast('网络未连接，正在重连…', 'error');
    if (a.type === 'useItem' || a.type === 'mortgage' || a.type === 'unmortgage') this.closeSheet();
  }

  private startTarget(itemId: ItemId): void {
    const s = this.state;
    if (!s) return;
    const def = itemOf(itemId);
    const tg = itemTargets(data().board, s, store.myId, itemId, def?.range);
    this.targetItem = itemId;
    this.targetCells = tg.cells;
    this.targetPlayers = tg.players;
    this.closeSheet();
    if (tg.kind === 'player') {
      this.board.highlightTokens(tg.players);
      this.hud.highlightPlayers(tg.players);
      this.hud.setTarget({ text: `${def?.name ?? ''}：点选一名对手（头像或棋子）` });
    } else {
      this.board.highlightCells(tg.cells);
      this.hud.setTarget({ text: `${def?.name ?? ''}：点选高亮的格子` });
    }
  }

  private cancelTarget(): void {
    this.targetItem = null;
    this.targetCells = [];
    this.targetPlayers = [];
    this.board.highlightCells(null);
    this.board.highlightTokens(null);
    this.hud.highlightPlayers(null);
    this.hud.setTarget(null);
  }

  private onCellTap(id: number): void {
    if (this.targetItem) {
      if (this.targetCells.includes(id)) {
        const itemId = this.targetItem;
        this.cancelTarget();
        this.act({ type: 'useItem', itemId, target: { cellId: id } });
      } else if (this.targetCells.length) toast('请点选高亮的格子', 'info', 1500);
      return;
    }
    if (this.playing) return;
    showCellDetail(id, this.state);
  }

  private onPlayerTap(pid: string): void {
    if (this.targetItem && this.targetPlayers.length) {
      if (this.targetPlayers.includes(pid)) {
        const itemId = this.targetItem;
        this.cancelTarget();
        this.act({ type: 'useItem', itemId, target: { playerId: pid } });
      } else toast('不能选择这名玩家', 'info', 1500);
      return;
    }
    if (!this.playing) showCellDetail(this.board.tokenCellOf(pid), this.state);
  }

  private confirmLeave(): void {
    if (this.state?.phase === 'playing' && !confirm('离开后由 AI 永久托管，确定离开？')) return;
    net.send({ t: 'leaveRoom' });
  }

  onChat(from: string, name: string, text: string): void {
    this.panels.addChat(name, text, from === store.myId);
    speechBubble(this.board, this.bubbles, from, text, 3000);
  }

  /* =============================== 事件队列 =============================== */

  push(msg: GameMsg): void {
    this.queue.push(msg);
    void this.pump();
  }

  /** 是否为新一局（再来一局） */
  isNewGame(state: GameState): boolean {
    if (!this.state) return false;
    return (this.state.phase === 'ended' && state.phase === 'playing') || state.turnCount < this.state.turnCount;
  }

  private async pump(): Promise<void> {
    if (this.playing) return;
    this.playing = true;
    try {
      while (this.queue.length && !this.destroyed) {
        const msg = this.queue.shift()!;
        if (!this.state) {
          // 首个快照：直接铺好画面
          this.board.setPlayers(msg.state.players);
          this.applySnapshot(msg.state);
        }
        const events = msg.events.filter((e) => e.type !== 'log' || true);
        if (events.length) {
          this.hud.setBusy(true);
          this.panels.setBusy(true);
          if (this.targetItem) this.cancelTarget();
          for (const ev of events) {
            if (this.destroyed) return;
            this.fx.setSpeed(this.queue.length >= 3 ? 3 : this.queue.length >= 1 ? 1.6 : 1);
            try {
              if (DEBUG) console.log('[ev]', ev.type, JSON.stringify(ev).slice(0, 120));
              await this.playEvent(ev, msg.state);
              if (DEBUG) console.log('[ev done]', ev.type);
            } catch (e) {
              console.warn('[fx] 播放事件失败', ev.type, e);
            }
          }
        }
        this.fx.resume();
        this.fx.setSpeed(1);
        this.applySnapshot(msg.state);
        if (msg.events.some((e) => e.type === 'gameOver') || (msg.state.phase === 'ended' && !this.closeResults)) this.showEnd(msg.state);
      }
    } finally {
      this.playing = false;
      if (!this.destroyed) {
        this.hud.setBusy(false);
        this.panels.setBusy(false);
      }
    }
  }

  private applySnapshot(state: GameState): void {
    this.state = state;
    store.game = state;
    this.board.sync(state);
    this.hud.update(state);
    this.panels.update(state);
  }

  private say(pid: string, kind: 'roll' | 'buy' | 'rent' | 'pay' | 'jail' | 'bankrupt' | 'win', chance = 1): void {
    if (Math.random() > chance || this.fx.skipping) return;
    const p = this.state?.players.find((x) => x.id === pid);
    if (!p) return;
    const line = randomLine(p.characterId, kind);
    if (line) speechBubble(this.board, this.bubbles, pid, line);
  }

  private name(pid: string | undefined, state: GameState): string {
    return state.players.find((p) => p.id === pid)?.name ?? '';
  }

  private async playEvent(ev: GameEvent, state: GameState): Promise<void> {
    const fx = this.fx;
    const b = this.board;
    switch (ev.type) {
      case 'turnStart':
        b.setCurrent(ev.playerId);
        this.hud.setCurrent(ev.playerId);
        if (ev.playerId === store.myId) await fx.banner('轮到你了！', 'primary', 350);
        break;
      case 'dice': {
        const p = state.players.find((x) => x.id === ev.playerId);
        this.say(ev.playerId, 'roll', 0.3);
        await fx.dice(ev.dice[0], ev.turtle ? 0 : ev.dice[1], p?.diceSkin ?? 'h100', { rocket: !!ev.rocket, turtle: !!ev.turtle, doubles: ev.doubles });
        break;
      }
      case 'move':
        await fx.move(ev.playerId, ev.path, { teleport: !!ev.teleport, backward: !!ev.backward });
        if (ev.passedStart) await fx.passStart(ev.playerId, data().board.startBonus);
        break;
      case 'roadblockHit':
        await fx.roadblockHit(ev.playerId, ev.cellId);
        break;
      case 'money':
        this.hud.setMoney(ev.playerId, ev.balance);
        // rent / 经过融资轮已有专门特效，不重复飘字
        if (!/API 调用费|经过融资轮/.test(ev.reason)) await fx.money(ev.playerId, ev.delta, ev.reason);
        break;
      case 'buy':
        this.say(ev.playerId, 'buy', 0.6);
        await fx.buy(ev.cellId, ev.playerId);
        break;
      case 'rent':
        if (!ev.shielded) {
          if (Math.random() < 0.5) this.say(ev.toId, 'rent', 0.7);
          else this.say(ev.fromId, 'pay', 0.7);
        }
        await fx.rent(ev.fromId, ev.toId, ev.amount, ev.shielded);
        break;
      case 'upgrade':
        if (ev.remote) fx.notice(`${this.name(ev.playerId, state)} 远程升级「${cellOf(ev.cellId).name}」`);
        await fx.build(ev.cellId, ev.level);
        break;
      case 'downgrade':
        await fx.downgrade(ev.cellId, ev.level);
        break;
      case 'card':
        await fx.card(ev.card);
        break;
      case 'tax':
        b.setPot(ev.pot);
        this.hud.setPot(ev.pot);
        this.say(ev.playerId, 'pay', 0.4);
        fx.notice(`缴税 ${ev.amount}T → 开源节奖池 ${ev.pot}T`, 'var(--warning)');
        break;
      case 'pot':
        b.setPot(0);
        this.hud.setPot(0);
        await fx.banner(`开源节！拿走奖池 ${ev.amount}T`, 'gold', 500);
        break;
      case 'jail':
        this.say(ev.playerId, 'jail');
        await fx.jail(ev.playerId);
        break;
      case 'jailExit':
        b.setJailed(ev.playerId, false);
        fx.notice(`${this.name(ev.playerId, state)} ${JAIL_HOW[ev.how] ?? ''}，结束监管审查`, 'var(--success)');
        break;
      case 'item':
        await fx.item(ev.playerId, ev.itemId, ev.targetCellId, ev.targetPlayerId);
        break;
      case 'itemGain': {
        const nm = itemOf(ev.itemId)?.name ?? ev.itemId;
        fx.notice(ev.discarded ? `道具栏已满，「${nm}」被丢弃` : `${this.name(ev.playerId, state)} 获得道具「${nm}」`, ev.discarded ? 'var(--text-dim)' : 'var(--accent)');
        break;
      }
      case 'mortgage':
        b.setMortgaged(ev.cellId, ev.on);
        fx.notice(`${this.name(ev.playerId, state)} ${ev.on ? '抵押' : '赎回'}「${cellOf(ev.cellId).name}」`, 'var(--text-dim)');
        break;
      case 'modifier':
        fx.notice(
          ev.rounds === 0 ? `${ev.kind === 'rent' ? 'API 调用费' : '升级费'}恢复正常` : `${ev.kind === 'rent' ? 'API 调用费' : '升级费'} ×${ev.factor}（${ev.rounds} 轮）`,
          'var(--accent)',
        );
        break;
      case 'bankrupt':
        this.say(ev.playerId, 'bankrupt');
        await fx.bankrupt(ev.playerId);
        break;
      case 'gameOver':
        this.say(ev.winnerId, 'win');
        await fx.gameOver(ev.winnerId);
        break;
      case 'log':
        this.panels.appendLog(ev.text);
        break;
      default:
        break;
    }
  }

  private showEnd(state: GameState): void {
    this.closeResults?.();
    const isHost = store.room?.hostId === store.myId;
    this.closeResults = showResults(state, {
      isHost,
      delayButtonsMs: 600,
      onAgain: () => {
        // 引擎 ended 状态下 startGame 即“再来一局”（同房间、保留玩家）
        net.send({ t: 'startGame' });
      },
      onBackToRoom: () => {
        // 结算后房主把房间带回大厅（保留玩家），服务端随后推送 room(status=lobby)
        net.send({ t: 'backToRoom' });
      },
      onLeave: () => net.send({ t: 'leaveRoom' }),
    });
  }
}
