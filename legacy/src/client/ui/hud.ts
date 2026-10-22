// HUD：玩家条（头像 / Token / 标记）、顶栏（轮数 / 奖池）、行动区（大按钮 + 倒计时）。
import gsap from 'gsap';
import { JAIL_MAX_TURNS, legalActionTypes, upgradeCostOf, type GameAction, type GameState, type Player } from '@dafuweng/shared';
import { avatarUrl, itemUrl } from '../assets';
import { cellOf, data, itemOf, serverNow, store } from '../store';
import { clear, escapeHtml, h } from '../util';

export interface HudCallbacks {
  act: (a: GameAction) => void;
  onPlayerTap: (playerId: string) => void;
  cancelTarget: () => void;
}

export interface TargetPrompt {
  text: string;
}

export class Hud {
  private shownMoney = new Map<string, number>();
  private chips = new Map<string, HTMLElement>();
  private state: GameState | null = null;
  private busy = false;
  private target: TargetPrompt | null = null;
  private timerRaf = 0;
  private deadlineTotal = 0;
  private currentOverride: string | null = null;

  constructor(
    private playersEl: HTMLElement,
    private actionsEl: HTMLElement,
    private topEl: HTMLElement,
    private cb: HudCallbacks,
  ) {}

  destroy(): void {
    cancelAnimationFrame(this.timerRaf);
  }

  /* ------------------------------ 玩家条 ------------------------------ */

  private renderPlayers(state: GameState): void {
    const ids = state.players.map((p) => p.id).join(',');
    if (this.playersEl.dataset.ids !== ids) {
      clear(this.playersEl);
      this.chips.clear();
      this.playersEl.dataset.ids = ids;
      this.playersEl.dataset.n = String(state.players.length);
      state.players.forEach((p, i) => {
        const chip = h(
          'button.pchip.glass',
          { type: 'button', 'data-pid': p.id, style: `--pc:${p.color}`, onclick: () => this.cb.onPlayerTap(p.id) },
          h('span.pchip-av', null, h('img', { src: avatarUrl(p.characterId), alt: '' }), h('b.pchip-seat', null, String(i + 1))),
          h(
            'span.pchip-main',
            null,
            h('span.pchip-name', null, p.name),
            h('span.pchip-money.money', null, `${p.money}T`),
          ),
          h('span.pchip-tags'),
        );
        this.chips.set(p.id, chip);
        this.playersEl.append(chip);
        this.shownMoney.set(p.id, p.money);
      });
    }
    const cur = this.currentOverride ?? state.currentPlayerId;
    for (const p of state.players) {
      const chip = this.chips.get(p.id);
      if (!chip) continue;
      chip.classList.toggle('glass--active', p.id === cur && state.phase === 'playing');
      chip.classList.toggle('is-bankrupt', p.bankrupt);
      chip.classList.toggle('is-me', p.id === store.myId);
      chip.classList.toggle('is-offline', !p.connected && !p.isBot);
      this.setMoney(p.id, p.money, false);
      const tags = chip.querySelector('.pchip-tags')!;
      tags.innerHTML = this.tagsHtml(p);
    }
  }

  private tagsHtml(p: Player): string {
    const t: string[] = [];
    if (p.id === store.myId) t.push('<i class="tag tag--me">我</i>');
    if (p.isBot) t.push('<i class="tag">AI</i>');
    else if (!p.connected) t.push('<i class="tag tag--warn">托管</i>');
    if (p.bankrupt) t.push('<i class="tag tag--danger">已出局</i>');
    if (p.inJail) t.push('<i class="tag tag--danger">监管</i>');
    if (p.shield) t.push(`<i class="tag tag--info"><img src="${itemUrl('shield')}" alt="">护盾</i>`);
    if (p.turtle) t.push(`<i class="tag tag--ok"><img src="${itemUrl('turtle')}" alt="">限流</i>`);
    if (p.rocket) t.push(`<i class="tag tag--warn"><img src="${itemUrl('rocket')}" alt="">+6</i>`);
    if (p.items.length) t.push(`<i class="tag">道具×${p.items.length}</i>`);
    return t.join('');
  }

  /** 金额滚动到新值 */
  setMoney(playerId: string, balance: number, animate = true): void {
    const chip = this.chips.get(playerId);
    if (!chip) return;
    const el = chip.querySelector('.pchip-money') as HTMLElement;
    const from = this.shownMoney.get(playerId) ?? balance;
    if (from === balance) {
      el.textContent = `${balance}T`;
      return;
    }
    this.shownMoney.set(playerId, balance);
    if (!animate) {
      el.textContent = `${balance}T`;
      return;
    }
    const o = { v: from };
    gsap.killTweensOf(el);
    el.classList.remove('up', 'down');
    void el.offsetWidth;
    el.classList.add(balance > from ? 'up' : 'down');
    gsap.to(o, { v: balance, duration: 0.5, ease: 'none', onUpdate: () => void (el.textContent = `${Math.round(o.v)}T`) });
  }

  setCurrent(playerId: string): void {
    this.currentOverride = playerId;
    for (const [pid, chip] of this.chips) chip.classList.toggle('glass--active', pid === playerId);
    const chip = this.chips.get(playerId);
    chip?.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  /** 玩家条上头像的屏幕坐标 */
  playerPoint(playerId: string): { x: number; y: number } | null {
    const img = this.chips.get(playerId)?.querySelector('img');
    if (!img) return null;
    const r = img.getBoundingClientRect();
    if (r.width === 0) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  highlightPlayers(ids: string[] | null): void {
    for (const [pid, chip] of this.chips) {
      chip.classList.toggle('is-target', !!ids && ids.includes(pid));
      chip.classList.toggle('is-untargetable', !!ids && !ids.includes(pid));
    }
  }

  /* ------------------------------ 顶栏 ------------------------------ */

  private renderTop(state: GameState): void {
    const r = state.settings.maxRounds > 0 ? `${state.round}/${state.settings.maxRounds}` : `${state.round}`;
    const code = store.room?.code ?? '';
    this.topEl.querySelector('.tb-round')!.textContent = `R${r}`;
    this.topEl.querySelector('.tb-pot')!.textContent = `${state.pot}T`;
    this.topEl.querySelector('.tb-code')!.textContent = code;
  }

  setPot(n: number): void {
    const el = this.topEl.querySelector('.tb-pot');
    if (el) el.textContent = `${n}T`;
  }

  /* ------------------------------ 行动区 ------------------------------ */

  update(state: GameState): void {
    this.state = state;
    this.currentOverride = null;
    this.renderPlayers(state);
    this.renderTop(state);
    this.renderActions();
    this.startTimer(state);
  }

  setBusy(b: boolean): void {
    if (this.busy === b) return;
    this.busy = b;
    this.renderActions();
  }

  setTarget(t: TargetPrompt | null): void {
    this.target = t;
    this.renderActions();
  }

  private btn(label: string, cls: string, action: GameAction | (() => void), sub?: string): HTMLElement {
    const b = h(
      'button.btn',
      {
        type: 'button',
        class: cls,
        onclick: () => {
          if (typeof action === 'function') action();
          else this.cb.act(action);
        },
      },
      h('span', null, label),
      sub ? h('small', null, sub) : null,
    );
    if (this.busy && typeof action !== 'function') (b as HTMLButtonElement).disabled = true;
    if (typeof action !== 'function') b.dataset.action = action.type;
    return b;
  }

  renderActions(): void {
    const el = this.actionsEl;
    const s = this.state;
    const prompt = el.querySelector('.act-prompt') as HTMLElement;
    const btns = el.querySelector('.act-btns') as HTMLElement;
    clear(btns);
    el.classList.toggle('is-busy', this.busy);
    if (!s) return;
    const me = s.players.find((p) => p.id === store.myId);
    const cur = s.players.find((p) => p.id === s.currentPlayerId);
    if (s.phase === 'ended') {
      prompt.innerHTML = '本局结束';
      return;
    }
    if (this.target) {
      prompt.innerHTML = `<b class="hl">${escapeHtml(this.target.text)}</b>`;
      btns.append(this.btn('取消', 'btn--secondary', () => this.cb.cancelTarget()));
      return;
    }
    const legal = legalActionTypes(s, store.myId);
    if (!me || legal.length === 0 || s.currentPlayerId !== store.myId) {
      const who = cur ? escapeHtml(cur.name) : '';
      prompt.innerHTML = cur
        ? `<img class="act-av" src="${avatarUrl(cur.characterId)}" alt=""><span><b>${who}</b> 正在行动…</span>`
        : '等待中…';
      if (me?.bankrupt) prompt.innerHTML += ' <span class="dim">（你已出局，观战中）</span>';
      return;
    }
    const pend = s.pending;
    if (pend?.type === 'buy') {
      const c = cellOf(pend.cellId);
      prompt.innerHTML = `买下「<b>${escapeHtml(c.name)}</b>」？ <span class="dim">现金 ${me.money}T</span>`;
      btns.append(this.btn('不买', 'btn--secondary', { type: 'skipBuy' }), this.btn(`买下 ${c.price ?? 0}T`, 'btn--primary', { type: 'buy' }));
    } else if (pend?.type === 'upgrade') {
      const c = cellOf(pend.cellId);
      const lv = (s.owned[pend.cellId]?.level ?? 0) + 1;
      const cost = upgradeCostOf(data().board, s.modifiers, pend.cellId);
      prompt.innerHTML = `升级「<b>${escapeHtml(c.name)}</b>」？ <span class="dim">现金 ${me.money}T</span>`;
      btns.append(
        this.btn('不升', 'btn--secondary', { type: 'skipUpgrade' }),
        this.btn(`升级 ${cost}T`, 'btn--primary', { type: 'upgrade' }, `→ ${lv >= 5 ? '旗舰 AGI' : 'v' + lv}`),
      );
    } else if (pend?.type === 'card') {
      prompt.innerHTML = `${pend.card.deck === 'chance' ? '热搜' : '突发'}：「<b>${escapeHtml(pend.card.title)}</b>」<span class="dim">${escapeHtml(pend.card.text)}</span>`;
      btns.append(this.btn('确认卡牌', 'btn--primary', { type: 'ackCard' }));
    } else if (pend?.type === 'jail') {
      const fine = data().board.jailFine;
      prompt.innerHTML = `监管审查中 <span class="dim">（第 ${Math.min(me.jailTurns + 1, JAIL_MAX_TURNS)}/${JAIL_MAX_TURNS} 次，第 ${JAIL_MAX_TURNS} 次强制缴费）</span>`;
      const pay = this.btn(`付 ${fine}T 出狱`, 'btn--danger', { type: 'payJail' });
      if (me.money < fine) (pay as HTMLButtonElement).disabled = true;
      btns.append(pay);
      if (legal.includes('useJailCard')) btns.append(this.btn('用豁免卡', 'btn--gold', { type: 'useJailCard' }));
      btns.append(this.btn('尝试掷骰', 'btn--primary', { type: 'rollJail' }, '双骰出狱'));
    } else if (legal.includes('roll')) {
      prompt.innerHTML = `<b class="hl">轮到你了！</b> <span class="dim">可先使用道具 / 管理基建</span>`;
      btns.append(this.btn('掷骰子', 'btn--gold btn--roll', { type: 'roll' }));
    } else {
      prompt.textContent = '…';
    }
  }

  /* ------------------------------ 倒计时 ------------------------------ */

  private startTimer(state: GameState): void {
    cancelAnimationFrame(this.timerRaf);
    const bar = this.actionsEl.querySelector('.act-timer') as HTMLElement;
    const fill = bar.querySelector('i') as HTMLElement;
    const label = bar.querySelector('span') as HTMLElement;
    if (!state.turnDeadline || state.phase !== 'playing') {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const deadline = state.turnDeadline;
    this.deadlineTotal = Math.max(1000, deadline - serverNow());
    const total = this.deadlineTotal;
    const mine = state.currentPlayerId === store.myId;
    bar.classList.toggle('is-mine', mine);
    const tick = () => {
      const left = deadline - serverNow();
      const k = Math.max(0, Math.min(1, left / total));
      fill.style.transform = `scaleX(${k})`;
      const sec = Math.max(0, Math.ceil(left / 1000));
      label.textContent = `${sec}s`;
      bar.classList.toggle('is-urgent', sec <= 5);
      if (left > 0) this.timerRaf = requestAnimationFrame(tick);
    };
    tick();
  }
}

export function itemIcon(itemId: string): string {
  return itemUrl(itemId);
}

export function itemName(itemId: string): string {
  return itemOf(itemId)?.name ?? itemId;
}
