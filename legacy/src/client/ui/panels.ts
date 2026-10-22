// 面板：道具栏、我的基建（抵押 / 赎回 / 远程升级）、日志、聊天、格子详情、结算页、角色台词气泡。
import {
  COMPUTE_RENTS,
  calcRent,
  isOwnable,
  isPreRoll,
  itemTargets,
  mortgageValue,
  unmortgageCost,
  upgradeCostOf,
  type GameAction,
  type GameState,
  type ItemId,
} from '@dafuweng/shared';
import { avatarUrl, itemUrl } from '../assets';
import type { BoardView } from '../board/board';
import { cellOf, charOf, data, groupColorOf, itemOf, store } from '../store';
import { clear, escapeHtml, h, toast } from '../util';

const LEVEL_NAME = (lv: number) => (lv >= 5 ? '旗舰 AGI' : lv <= 0 ? '空地' : `v${lv}`);

/* ================================ 弹窗 ================================ */

export function modal(content: HTMLElement, opts: { onClose?: () => void; cls?: string } = {}): () => void {
  const back = h('div.modal-back', null);
  const box = h('div.modal.glass.glass--neon', { class: opts.cls ?? '' }, h('button.modal-x', { type: 'button', 'aria-label': '关闭' }, '×'), content);
  back.append(box);
  document.body.append(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const close = () => {
    back.classList.remove('show');
    setTimeout(() => back.remove(), 200);
    opts.onClose?.();
  };
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  box.querySelector('.modal-x')!.addEventListener('click', close);
  return close;
}

/* ================================ 格子详情 ================================ */

export function showCellDetail(cellId: number, state: GameState | null): void {
  const cell = cellOf(cellId);
  const o = state?.owned[cellId];
  const owner = o ? state!.players.find((p) => p.id === o.owner) : null;
  const gc = groupColorOf(cell) ?? (cell.type === 'compute' ? '#8B5CF6' : cell.type === 'utility' ? '#5EC8FF' : '#2A1F6E');
  const group = cell.group ? data().board.groups.find((g) => g.id === cell.group) : null;
  const body = h('div.cell-detail');
  body.append(
    h('div.cd-head', { style: `--gc:${gc}` }, h('div.cd-group', null, group?.name ?? typeName(cell.type)), h('div.cd-name', null, cell.name)),
  );
  if (cell.desc) body.append(h('p.cd-desc', null, cell.desc));
  const rows: [string, string][] = [];
  if (isOwnable(cell)) {
    rows.push(['价格', `${cell.price}T`]);
    rows.push(['所有者', owner ? owner.name : '无主（可购买）']);
    if (o) rows.push(['状态', o.mortgaged ? `抵押中（赎回 ${unmortgageCost(cell)}T）` : cell.type === 'property' ? LEVEL_NAME(o.level) : '运营中']);
    if (state && o && !o.mortgaged && cell.type !== 'utility') rows.push(['当前过路费', `${calcRent(data().board, state.owned, state.modifiers, cellId, 7)}T`]);
    rows.push(['抵押可得', `${mortgageValue(cell)}T`]);
  } else if (cell.type === 'tax') rows.push(['税额', `${cell.tax}T（进入开源节奖池）`]);
  else if (cell.type === 'free') rows.push(['奖池', `${state?.pot ?? 0}T`]);
  const tbl = h('table.cd-table');
  for (const [k, v] of rows) tbl.append(h('tr', null, h('th', null, k), h('td', null, v)));
  body.append(tbl);
  if (cell.type === 'property' && cell.rents) {
    const t = h('table.cd-rents');
    t.append(h('tr', null, h('th', null, '等级'), h('th', null, 'API 调用费')));
    cell.rents.forEach((r, lv) => {
      const cur = o && !o.mortgaged && o.level === lv;
      t.append(h('tr', { class: cur ? 'cur' : '' }, h('td', null, LEVEL_NAME(lv) + (lv === 0 ? '（集齐同色×2）' : '')), h('td.money', null, `${r}T`)));
    });
    body.append(t);
    const cost = state ? upgradeCostOf(data().board, state.modifiers, cellId) : cell.upgradeCost ?? 0;
    body.append(h('p.cd-note', null, `每级升级费 ${cost}T${state && state.modifiers.upgradeFactor !== 1 ? `（当前倍率 ×${state.modifiers.upgradeFactor}）` : ''}`));
  } else if (cell.type === 'compute') {
    const t = h('table.cd-rents');
    t.append(h('tr', null, h('th', null, '持有算力中心'), h('th', null, '费用')));
    COMPUTE_RENTS.forEach((r, i) => t.append(h('tr', null, h('td', null, `${i + 1} 个`), h('td.money', null, `${r}T`))));
    body.append(t);
  } else if (cell.type === 'utility') {
    body.append(h('p.cd-note', null, '费用 = 骰子点数 ×4；同时拥有电力与数据则 ×10'));
  }
  modal(body, { cls: 'modal--cell' });
}

function typeName(t: string): string {
  return ({ start: '起点', chance: '热搜', fate: '突发', tax: '税', jail: '监管审查', gotojail: '被监管', free: '开源节', compute: '算力中心', utility: '公用事业', property: '基建' } as Record<string, string>)[t] ?? t;
}

/* ================================ 侧栏面板 ================================ */

export interface PanelCallbacks {
  act: (a: GameAction) => void;
  startTarget: (itemId: ItemId) => void;
  chat: (text: string) => void;
}

export class Panels {
  readonly items = h('section.panel.panel-items');
  readonly props = h('section.panel.panel-props');
  readonly log = h('section.panel.panel-log');
  readonly chat = h('section.panel.panel-chat');
  private logList = h('ol.log-list');
  private chatList = h('div.chat-list');
  private state: GameState | null = null;
  private busy = false;
  private logCount = 0;

  constructor(private cb: PanelCallbacks) {
    this.log.append(this.logList);
    const input = h('input.chat-input', { type: 'text', maxlength: 60, placeholder: '说点什么…', enterkeyhint: 'send' }) as HTMLInputElement;
    const send = () => {
      const t = input.value.trim();
      if (!t) return;
      this.cb.chat(t);
      input.value = '';
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') send();
    });
    this.chat.append(this.chatList, h('div.chat-row', null, input, h('button.btn.btn--secondary.btn--sm', { type: 'button', onclick: send }, '发送')));
  }

  update(state: GameState): void {
    this.state = state;
    this.renderItems();
    this.renderProps();
    this.renderLog(state.log);
  }

  setBusy(b: boolean): void {
    if (this.busy === b) return;
    this.busy = b;
    if (this.state) {
      this.renderItems();
      this.renderProps();
    }
  }

  private me() {
    return this.state?.players.find((p) => p.id === store.myId);
  }

  /* ---------- 道具栏 ---------- */
  private renderItems(): void {
    const s = this.state;
    const el = this.items;
    clear(el);
    const me = this.me();
    if (!s || !me) return;
    el.append(h('h3', null, '道具栏', h('small', null, `${me.items.length}/6`)));
    const grid = h('div.item-grid');
    const canUse = isPreRoll(s, store.myId) && !this.busy;
    for (let i = 0; i < 6; i++) {
      const id = me.items[i];
      if (!id) {
        grid.append(h('div.item-slot.empty'));
        continue;
      }
      const def = itemOf(id);
      const b = h(
        'button.item-slot',
        { type: 'button', title: def?.desc ?? '', onclick: () => this.openItem(id as ItemId) },
        h('img', { src: itemUrl(id), alt: '' }),
        h('span', null, def?.name ?? id),
      );
      if (!canUse) b.classList.add('is-disabled');
      grid.append(b);
    }
    el.append(grid);
    if (!me.items.length) el.append(h('p.dim.small', null, '踩到热搜 / 突发卡有机会获得道具'));
  }

  private openItem(itemId: ItemId): void {
    const s = this.state;
    const me = this.me();
    const def = itemOf(itemId);
    if (!s || !me || !def) return;
    let reason = '';
    if (this.busy) reason = '动画播放中';
    else if (!isPreRoll(s, store.myId)) reason = '只能在自己回合掷骰前使用';
    else if (itemId === 'jailfree' && !me.inJail) reason = '只有在监管审查中才能使用';
    else if (itemId === 'teleport' && me.inJail) reason = '监管审查中不能使用跳板机';
    else if (itemId === 'rocket' && me.rocket) reason = '火箭加速已生效';
    else if (itemId === 'shield' && me.shield) reason = '防火墙护盾已生效';
    const content = h(
      'div.item-detail',
      null,
      h('img', { src: itemUrl(itemId), alt: '' }),
      h('h3', null, def.name),
      h('p', null, def.desc),
    );
    let close = () => {};
    if (reason) content.append(h('p.dim', null, reason));
    else {
      const tg = itemTargets(data().board, s, store.myId, itemId, def.range);
      const needsTarget = def.targetKind !== 'none' && !(itemId === 'teleport' && tg.cells.length === 0);
      const label = needsTarget ? '选择目标' : itemId === 'teleport' ? '传送回融资轮' : '使用';
      content.append(
        h(
          'button.btn.btn--primary',
          {
            type: 'button',
            onclick: () => {
              close();
              if (needsTarget) {
                if (tg.cells.length === 0 && tg.players.length === 0) {
                  toast('当前没有可选目标', 'error');
                  return;
                }
                this.cb.startTarget(itemId);
              } else this.cb.act({ type: 'useItem', itemId });
            },
          },
          label,
        ),
      );
    }
    close = modal(content, { cls: 'modal--item' });
  }

  /* ---------- 我的基建 ---------- */
  private renderProps(): void {
    const s = this.state;
    const el = this.props;
    clear(el);
    const me = this.me();
    if (!s || !me) return;
    const preRoll = isPreRoll(s, store.myId);
    const canManage = preRoll && !this.busy;
    const canUp = preRoll && !s.upgradedThisTurn && !this.busy;
    const mine = Object.entries(s.owned)
      .filter(([, o]) => o.owner === store.myId)
      .map(([k, o]) => ({ id: Number(k), o, cell: cellOf(Number(k)) }))
      .sort((a, b) => a.id - b.id);
    el.append(
      h('h3', null, '我的基建', h('small', null, `${mine.length} 块`)),
      h(
        'p.dim.small',
        null,
        canManage
          ? s.upgradedThisTurn
            ? '本回合已远程升级过；抵押只限空地（level 0）'
            : '掷骰前可抵押 / 赎回；每回合可远程升级 1 次'
          : '只能在自己回合掷骰前管理',
      ),
    );
    if (!mine.length) {
      el.append(h('p.dim', null, '还没有基建，走到无主格子就能买下'));
      return;
    }
    const list = h('div.prop-list');
    const upCostBase = (id: number) => upgradeCostOf(data().board, s.modifiers, id);
    for (const { id, o, cell } of mine) {
      const gc = groupColorOf(cell) ?? (cell.type === 'compute' ? '#8B5CF6' : '#5EC8FF');
      const row = h(
        'div.prop-row',
        { class: o.mortgaged ? 'is-mortgaged' : '' },
        h('i.prop-dot', { style: `background:${gc}` }),
        h(
          'button.prop-name',
          { type: 'button', onclick: () => showCellDetail(id, s) },
          h('b', null, cell.name),
          h('small', null, o.mortgaged ? '抵押中' : cell.type === 'property' ? LEVEL_NAME(o.level) : cell.type === 'compute' ? '算力' : '公用'),
        ),
      );
      const btns = h('div.prop-btns');
      if (cell.type === 'property' && !o.mortgaged && o.level < 5 && preRoll) {
        const cost = upCostBase(id);
        const b = h(
          'button.btn.btn--primary.btn--sm',
          { type: 'button', onclick: () => this.cb.act({ type: 'upgradeAny', cellId: id }) },
          `升级 ${cost}T`,
        ) as HTMLButtonElement;
        b.disabled = !canUp || me.money < cost;
        if (s.upgradedThisTurn) b.title = '每回合只能远程升级 1 次';
        btns.append(b);
      }
      if (o.mortgaged) {
        const cost = unmortgageCost(cell);
        const b = h('button.btn.btn--secondary.btn--sm', { type: 'button', onclick: () => this.cb.act({ type: 'unmortgage', cellId: id }) }, `赎回 ${cost}T`) as HTMLButtonElement;
        b.disabled = !canManage || me.money < cost;
        btns.append(b);
      } else {
        const b = h('button.btn.btn--danger.btn--sm', { type: 'button', onclick: () => this.cb.act({ type: 'mortgage', cellId: id }) }, `抵押 +${mortgageValue(cell)}T`) as HTMLButtonElement;
        b.disabled = !canManage || o.level > 0;
        if (o.level > 0) b.title = '有建筑的基建不能抵押';
        btns.append(b);
      }
      row.append(btns);
      list.append(row);
    }
    el.append(list);
  }

  /* ---------- 日志 ---------- */
  private renderLog(log: string[]): void {
    clear(this.logList);
    this.logCount = 0;
    for (const line of log.slice().reverse()) this.appendLogLine(line, false);
  }

  appendLog(text: string): void {
    this.appendLogLine(text, true);
  }

  private appendLogLine(text: string, prepend: boolean): void {
    const li = h('li', null, text);
    if (prepend) this.logList.prepend(li);
    else this.logList.append(li);
    this.logCount += 1;
    while (this.logList.children.length > 60) this.logList.lastElementChild?.remove();
  }

  /* ---------- 聊天 ---------- */
  addChat(name: string, text: string, mine: boolean): void {
    this.chatList.append(h('div.chat-msg', { class: mine ? 'mine' : '' }, h('b', null, name), h('span', null, text)));
    while (this.chatList.children.length > 50) this.chatList.firstElementChild?.remove();
    this.chatList.scrollTop = this.chatList.scrollHeight;
  }
}

/* ================================ 台词气泡 ================================ */

export function speechBubble(board: BoardView, layer: HTMLElement, playerId: string, text: string, ms = 2200): void {
  const t = board.tokenSprite(playerId);
  if (!t || !t.visible) return;
  const p = board.worldToScreen({ x: t.x, y: t.y - board.u * 0.45 });
  const old = layer.querySelector(`.bubble[data-pid="${playerId}"]`);
  old?.remove();
  const b = h('div.bubble', { 'data-pid': playerId }, text);
  b.style.left = p.x + 'px';
  b.style.top = p.y + 'px';
  layer.append(b);
  // 防止出屏
  requestAnimationFrame(() => {
    const r = b.getBoundingClientRect();
    if (r.left < 6) b.style.marginLeft = 6 - r.left + 'px';
    else if (r.right > window.innerWidth - 6) b.style.marginLeft = window.innerWidth - 6 - r.right + 'px';
    b.classList.add('show');
  });
  setTimeout(() => {
    b.classList.remove('show');
    setTimeout(() => b.remove(), 250);
  }, ms);
}

/* ================================ 结算页 ================================ */

export function showResults(
  state: GameState,
  opts: { isHost: boolean; onAgain: () => void; onBackToRoom: () => void; onLeave: () => void; delayButtonsMs?: number },
): () => void {
  const winner = state.players.find((p) => p.id === state.winnerId);
  const ranking = state.ranking ?? state.players.map((p) => ({ playerId: p.id, netWorth: p.netWorth }));
  const el = h('div.results-back');
  const box = h('div.results.glass.glass--neon');
  box.append(
    h('div.res-crown', null, winner ? h('img', { src: avatarUrl(winner.characterId), alt: '' }) : null),
    h('h2.res-title', null, '大玩家！'),
    h('p.res-sub', null, winner ? `${winner.name} 赢下了这一局` : '本局结束'),
  );
  if (winner) {
    const ch = charOf(winner.characterId);
    const line = ch?.lines.win?.[Math.floor(Math.random() * (ch.lines.win.length || 1))];
    if (line) box.append(h('p.res-quote', null, `“${line}”`));
  }
  const tbl = h('div.res-table');
  ranking.forEach((r, i) => {
    const p = state.players.find((x) => x.id === r.playerId);
    if (!p) return;
    const props = Object.values(state.owned).filter((o) => o.owner === p.id);
    const buildings = props.reduce((n, o) => n + o.level, 0);
    tbl.append(
      h(
        'div.res-row',
        { class: (i === 0 ? 'first ' : '') + (p.id === store.myId ? 'me' : ''), style: `--pc:${p.color}` },
        h('b.res-rank', null, String(i + 1)),
        h('img', { src: avatarUrl(p.characterId), alt: '' }),
        h('span.res-name', null, p.name, p.bankrupt ? h('small.dim', null, ' 已出局') : null),
        h('span.res-stat', null, h('small', null, `${props.length} 地 · ${buildings} 级`)),
        h('span.res-worth.money', null, `${r.netWorth}T`),
      ),
    );
  });
  box.append(tbl);
  const actions = h('div.res-actions');
  if (opts.isHost) {
    actions.append(
      h('button.btn.btn--secondary', { type: 'button', onclick: opts.onBackToRoom }, '回到房间'),
      h('button.btn.btn--gold.btn--roll', { type: 'button', onclick: opts.onAgain }, '再来一局'),
    );
  } else {
    actions.append(h('p.dim', null, '等待房主“再来一局”…'), h('button.btn.btn--secondary', { type: 'button', onclick: opts.onLeave }, '离开房间'));
  }
  actions.style.visibility = 'hidden';
  setTimeout(() => (actions.style.visibility = 'visible'), opts.delayButtonsMs ?? 0);
  box.append(actions);
  el.append(box);
  document.body.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  return () => el.remove();
}

export function escape(s: string): string {
  return escapeHtml(s);
}
