// 对局页（商店阶段 + 头条）：顶栏、羁绊、我方 5 槽、商店、信息条、操作按钮、引导。
import gsap from 'gsap';
import {
  DIFFICULTY, MAX_TURNS, canMerge, isHeadlineTurn, itemSlotsForTurn, maxTierForTurn, rerollCost, tutorialStep, unitSlotsForTurn,
  type GameData, type RunState, type ShopActionInput, type TutorialStepId,
} from '@juanwang/shared';
import { app, act, go, markSeen, onRun, saveSettings, settings, type Scene } from '../store';
import { renderSynergy, renderTeam, topbar, updateTopbar } from '../ui/team';
import { renderShop } from '../ui/shop';
import { abilityText, esc, FACTION_NAME, FREE_LABEL, TIER_NAME } from '../ui/cards';
import { attachDrag } from '../ui/drag';
import { closeAllModals, showUnitDetail } from '../ui/modal';
import { toast } from '../ui/toast';
import { extraBanner, showHeadline } from '../ui/headline';
import { allowedKinds, stepText, tutorialBubble, type Kind } from '../ui/tutorial';
import { center, flyGhost, floatText, pop, screenShake, tagPop, toShell } from '../fx/anims';
import { particles } from '../fx/particles';
import { sfx } from '../fx/sound';
import { ui } from '../assets';
import { onOnlineChange } from '../net';

const HOME_SVG =
  '<svg viewBox="0 0 32 32" width="22" height="22"><path d="M5 15L16 5l11 10" fill="none" stroke="#3B2A1A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 13v13h6v-7h4v7h6V13" fill="#FFC53D" stroke="#3B2A1A" stroke-width="3" stroke-linejoin="round"/></svg>';

type Sel = { kind: 'shop'; slot: number } | { kind: 'item'; slot: number; target?: number } | { kind: 'team'; index: number } | null;

interface Before {
  rects: Map<string, DOMRect>;
  src?: { el: HTMLElement; rect: DOMRect };
  goldRect: DOMRect;
}

/** 由结算页设置：下一回合开始时要展示的号外 */
export const pendingExtra: { s: RunState['lastSurprise'] | null } = { s: null };

export function gameScene(): Scene {
  const data = app.data;
  const el = document.createElement('div');
  const top = topbar();
  const syn = document.createElement('div');
  syn.className = 'synergy-bar';
  const notes = document.createElement('div');
  notes.className = 'notes';
  const teamArea = document.createElement('section');
  teamArea.className = 'team-area';
  teamArea.innerHTML = `<div class="area-label"><button class="mini-btn home-btn" aria-label="返回首页">${HOME_SVG}</button><span>我的队伍</span><small>← 前排先上</small><span class="mod-hint"></span></div><div class="team-row"></div><div class="grass"></div>`;
  const teamRow = teamArea.querySelector('.team-row') as HTMLElement;
  const modHint = teamArea.querySelector('.mod-hint') as HTMLElement;
  const shop = document.createElement('section');
  shop.className = 'shop panel';
  shop.innerHTML = `<div class="shop-head"><span>商店</span><small class="shop-bonus"></small></div><div class="shop-units"></div><div class="shop-items"></div>`;
  const shopUnits = shop.querySelector('.shop-units') as HTMLElement;
  const shopItems = shop.querySelector('.shop-items') as HTMLElement;
  const shopBonus = shop.querySelector('.shop-bonus') as HTMLElement;
  const info = document.createElement('div');
  info.className = 'infobar';
  const bar = document.createElement('div');
  bar.className = 'actions';
  bar.innerHTML = `
    <button class="btn btn--icon act-reroll" data-kind="reroll"><img src="${ui('reroll')}" alt=""><span>刷新</span><em class="cost"></em></button>
    <button class="btn btn--icon btn--ice act-freeze" data-kind="freeze" data-drop="freeze" data-tut="freeze"><img src="${ui('freeze')}" alt=""><span>冻结</span></button>
    <button class="btn btn--icon btn--danger act-sell" data-kind="sell" data-drop="sell" data-tut="sell"><img src="${ui('sell')}" alt=""><span>出售</span></button>
    <button class="btn btn--go act-fight" data-kind="fight" data-tut="fight"><img src="${ui('battle')}" alt="">开战</button>`;
  const net = top.querySelector('.net-tag');
  if (net) teamArea.querySelector('.area-label')!.appendChild(net);
  el.append(top, syn, notes, teamArea, shop, info, bar);

  let sel: Sel = null;
  let before: Before | null = null;
  let headlineEl: HTMLElement | null = null;
  let tutStep: TutorialStepId | null = null;
  let allow = allowedKinds(null);
  const bubble = tutorialBubble(data, skipTutorial, finishTutorial);
  shop.appendChild(bubble.el);

  const run = (): RunState => app.run!;
  const can = (k: Kind): boolean => allow.has(k);

  // ───────────── 渲染 ─────────────
  function render(): void {
    const s = run();
    updateTopbar(top, s);
    renderSynergy(syn, s.team, data, (t) => toast(t, 'info', 2400));
    renderTeam(teamRow, s.team, data);
    renderShop(shopUnits, shopItems, s, data);
    markSeen([...s.team.filter(Boolean).map((u) => u!.defId), ...s.shop.filter((x) => x.kind === 'unit').map((x) => x.defId)]);
    // 队形修正提示
    const hints: string[] = [];
    if ((s.modifiers.battleSwapAll ?? 0) % 2 === 1) hints.push('开战时队伍反转');
    for (const uid of s.modifiers.battlePullFront ?? []) {
      const u = s.team.find((x) => x?.uid === uid);
      if (u) hints.push(`开战时 ${data.unitsById[u.defId]?.name ?? ''} 上前`);
    }
    renderNext(s);
    modHint.textContent = hints.join(' · ');
    modHint.style.display = hints.length ? '' : 'none';
    // 商店加成提示
    const m = s.modifiers;
    const bonus: string[] = [];
    if (m.rerollFree) bonus.push('本回合刷新免费');
    else if (m.freeRerolls > 0) bonus.push(`免费刷新 ×${m.freeRerolls}`);
    if (m.unitPriceMod) bonus.push(`单位 ${m.unitPriceMod > 0 ? '+' : ''}${m.unitPriceMod} 算力`);
    if (m.itemPriceMod) bonus.push(`基建 ${m.itemPriceMod > 0 ? '+' : ''}${m.itemPriceMod} 算力`);
    if (m.enemyAtkDebuff) bonus.push(`敌方 -${m.enemyAtkDebuff} 攻`);
    shopBonus.textContent = bonus.join(' · ');
    // 刷新价格
    const rc = rerollCost(s);
    (bar.querySelector('.act-reroll .cost') as HTMLElement).innerHTML = rc ? `<img src="${ui('gold')}" alt="">${rc}` : '免费';
    // 选中态校验
    if (sel?.kind === 'shop' && s.shop[sel.slot]?.kind !== 'unit') sel = null;
    if (sel?.kind === 'item' && s.shop[sel.slot]?.kind !== 'item') sel = null;
    if (sel?.kind === 'team' && !s.team[sel.index]) sel = null;
    renderSelection();
    renderInfo();
    applyTutorial();
  }

  /** 顶部"下回合惊喜"提示：来自引擎规则（头条回合、阶级/槽位解锁、后期扣血） */
  function renderNext(s: RunState): void {
    const next = s.turn + 1;
    const parts: string[] = [];
    if (next <= MAX_TURNS && s.phase === 'shop') {
      if (isHeadlineTurn(next, s, data)) parts.push('头条二选一');
      const t0 = maxTierForTurn(s.turn);
      const t1 = maxTierForTurn(next);
      if (t1 > t0) parts.push(`解锁 T${t1} 单位`);
      if (unitSlotsForTurn(next) > unitSlotsForTurn(s.turn)) parts.push('商店多一个单位格');
      else if (itemSlotsForTurn(next) > itemSlotsForTurn(s.turn)) parts.push('商店多一个基建格');
      if (next === DIFFICULTY.lateGameTurn) parts.push(`输一场改扣 ${DIFFICULTY.lateGameLifeLoss} 信心`);
      parts.splice(2); // 一行放得下：最多两条
    }
    notes.style.display = parts.length ? '' : 'none';
    if (!parts.length) return;
    const head = parts[0] === '头条二选一' ? `下回合：${parts.join(' · ')}` : `下回合${parts[0]}${parts.length > 1 ? ` · ${parts.slice(1).join(' · ')}` : ''}`;
    if (notes.dataset.text === head) return;
    notes.dataset.text = head;
    notes.innerHTML = `<span class="next-tip"><i>NEXT</i>${esc(head)}</span>`;
  }

  /** 选中商店单位时，在卡片正下方弹出大号「购买」按钮 + 「查看技能」 */
  let popSlot = -1;
  function renderBuyPop(): void {
    shop.querySelectorAll('.buy-pop').forEach((n) => n.remove());
    const s = run();
    if (sel?.kind !== 'shop' || s.phase !== 'shop') {
      popSlot = -1;
      return;
    }
    const slotIdx = sel.slot;
    const slot = s.shop[slotIdx];
    const wrap = shop.querySelector(`[data-shop="${slotIdx}"]`) as HTMLElement | null;
    if (!slot || !wrap) return;
    const pop = document.createElement('div');
    pop.className = 'buy-pop';
    const poor = slot.price > s.gold;
    const label = slot.free ? `免费拿<small>${FREE_LABEL[slot.freeReason ?? 'levelUp']}</small>` : `购买 <img src="${ui('gold')}" alt="">${slot.price}`;
    pop.innerHTML = `<button class="btn btn--go buy-pop-btn${poor ? ' is-poor' : ''}" data-kind="infoBuy">${label}</button><button class="buy-pop-more">查看技能</button>`;
    wrap.appendChild(pop);
    // 居中在卡片下方，但不超出商店面板左右边界（此时 pop 左边缘在卡片中线）
    const pr = shop.getBoundingClientRect();
    const r = pop.getBoundingClientRect();
    const l = r.left - r.width / 2;
    const dx = l < pr.left + 4 ? pr.left + 4 - l : l + r.width > pr.right - 4 ? pr.right - 4 - (l + r.width) : 0;
    pop.style.setProperty('--dx', `${dx}px`);
    gsap.set(pop, { xPercent: -50, x: dx });
    (pop.querySelector('.buy-pop-btn') as HTMLElement).onclick = () => {
      sfx.click();
      doBuy(slotIdx);
    };
    (pop.querySelector('.buy-pop-more') as HTMLElement).onclick = () => {
      sfx.click();
      showUnitDetail(data, slot.defId);
    };
    if (popSlot !== slotIdx) gsap.fromTo(pop, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2.5)' });
    popSlot = slotIdx;
  }

  function renderSelection(): void {
    const s = run();
    el.querySelectorAll('.is-selected,.is-target,.is-merge').forEach((n) => n.classList.remove('is-selected', 'is-target', 'is-merge'));
    renderBuyPop();
    if (!sel) return;
    if (sel.kind === 'shop') {
      el.querySelector(`[data-src="shop:${sel.slot}"]`)?.classList.add('is-selected');
      const def = s.shop[sel.slot].defId;
      s.team.forEach((u, i) => {
        const slot = teamRow.children[i];
        if (!u) slot.classList.add('is-target');
        else if (u.defId === def && u.level < 3) slot.classList.add('is-merge');
      });
    } else if (sel.kind === 'item') {
      el.querySelector(`[data-src="item:${sel.slot}"]`)?.classList.add('is-selected');
      const it = data.itemsById[s.shop[sel.slot].defId];
      const tgt = sel.target;
      if (it?.targetKind === 'unit') {
        s.team.forEach((u, i) => {
          if (u && i !== tgt) teamRow.children[i].classList.add('is-target');
        });
        if (tgt !== undefined) teamRow.children[tgt]?.querySelector('.ucard')?.classList.add('is-selected');
      }
    } else {
      const idx = sel.index;
      const a = s.team[idx]!;
      teamRow.children[idx]?.querySelector('.ucard')?.classList.add('is-selected');
      s.team.forEach((u, i) => {
        if (i === idx) return;
        if (u && canMerge(a, u)) teamRow.children[i].classList.add('is-merge');
        else teamRow.children[i].classList.add('is-target');
      });
    }
  }

  function renderInfo(): void {
    const s = run();
    info.innerHTML = '';
    const text = document.createElement('div');
    text.className = 'info-text';
    const btns = document.createElement('div');
    btns.className = 'info-btns';
    const mk = (label: string, cls: string, kind: Kind | null, fn: () => void): void => {
      const b = document.createElement('button');
      b.className = `btn btn--sm ${cls}`;
      b.innerHTML = label;
      if (kind) b.dataset.kind = kind;
      b.onclick = () => {
        sfx.click();
        fn();
      };
      btns.appendChild(b);
    };
    const detailLink = (defId: string, inst?: Parameters<typeof showUnitDetail>[2]): void => {
      const a = document.createElement('button');
      a.className = 'info-more';
      a.textContent = '详情 ›';
      a.onclick = () => showUnitDetail(data, defId, inst);
      text.querySelector('.info-head')?.appendChild(a);
    };
    if (!sel) {
      text.innerHTML = '<span class="info-hint">点卡片，再点「购买」· 也能拖到队伍 · 同名叠加进化<br>拖动队伍换位 · 拖到「出售」卖掉</span>';
    } else if (sel.kind === 'shop') {
      const slot = s.shop[sel.slot];
      const def = data.unitsById[slot.defId];
      const freeChip = slot.free ? `<span class="chip chip--xs chip--free-${slot.freeReason ?? 'levelUp'}">${FREE_LABEL[slot.freeReason ?? 'levelUp']}</span>` : '';
      text.innerHTML = `<div class="info-head"><b class="info-name">${esc(def.name)}</b><span class="chip chip--xs tier-${def.tier}">${TIER_NAME[def.tier]}</span><span class="chip chip--xs fac-${def.faction}">${FACTION_NAME[def.faction]}</span>${freeChip}</div><p>${esc(abilityText(def))}</p>`;
      detailLink(def.id);
    } else if (sel.kind === 'item') {
      const slot = s.shop[sel.slot];
      const it = data.itemsById[slot.defId];
      let hint = '';
      if (it.targetKind === 'unit') hint = it.effect.type === 'copyStatsFrom' ? (sel.target === undefined ? '先点要强化的单位' : '再点被复制属性的单位') : '点一个队伍单位使用（或拖过去）';
      text.innerHTML = `<div class="info-head"><b class="info-name">${esc(it.name)}</b><span class="chip chip--xs">${it.targetKind === 'team' ? '全队' : '单体'}</span></div><p>${esc(it.desc)}${hint ? `<br><em>${hint}</em>` : ''}</p>`;
      if (it.targetKind === 'team') {
        const slotIdx = sel.slot;
        mk(slot.price ? `使用 <img src="${ui('gold')}" alt="">${slot.price}` : '使用', 'btn--go', 'infoUse', () => doAct({ type: 'useItem', slot: slotIdx }, el.querySelector(`[data-src="item:${slotIdx}"]`)));
      }
    } else {
      const u = s.team[sel.index]!;
      const def = data.unitsById[u.defId];
      text.innerHTML = `<div class="info-head"><b class="info-name">${esc(def.name)}</b><span class="chip chip--xs">Lv${u.level}</span><span class="chip chip--xs fac-${def.faction}">${FACTION_NAME[def.faction]}</span></div><p>${esc(abilityText(def))}</p>`;
      detailLink(def.id, u);
      const idx = sel.index;
      mk(`出售 +${u.level}<img src="${ui('gold')}" alt="">`, 'btn--danger', 'infoSell', () => doSell(idx));
    }
    info.append(text, btns);
  }

  // ───────────── 引导 ─────────────
  function applyTutorial(): void {
    const s = run();
    const raw = tutorialStep(s);
    if (raw === 'done' && !settings.tutorialDone) {
      settings.tutorialDone = true;
      saveSettings();
    }
    tutStep = raw && !(raw === 'done' && app.tutAck) ? raw : null;
    allow = allowedKinds(tutStep === 'done' ? null : tutStep);
    el.classList.toggle('is-tutorial', !!tutStep);
    el.querySelectorAll('.tut-focus').forEach((n) => n.classList.remove('tut-focus'));
    el.querySelectorAll('.tut-lock').forEach((n) => n.classList.remove('tut-lock'));
    if (!tutStep) {
      bubble.set(null, '');
      return;
    }
    // 锁定不允许的元素
    const lock = (sel0: string, k: Kind): void => {
      if (!can(k)) el.querySelectorAll(sel0).forEach((n) => n.classList.add('tut-lock'));
    };
    lock('[data-src^="shop:"]', 'shopUnit');
    lock('[data-src^="item:"]', 'shopItem');
    lock('.tslot', 'team');
    for (const k of ['reroll', 'freeze', 'sell', 'fight', 'infoBuy', 'infoUse', 'infoSell'] as Kind[]) lock(`[data-kind="${k}"]`, k);
    // 高亮
    const focus = (q: string): boolean => {
      const list = el.querySelectorAll(q);
      list.forEach((n) => n.classList.add('tut-focus'));
      return list.length > 0;
    };
    let sub = '';
    const teamDefs = new Set(s.team.filter(Boolean).map((u) => u!.defId));
    switch (tutStep) {
      case 'buy':
      case 'buyAgain':
      case 'merge':
        if (sel?.kind === 'shop') {
          focus('[data-kind="infoBuy"]');
          sub = '点卡片下方的「购买」（也可以把卡片拖到队伍里）';
        } else {
          const ids = tutStep === 'buy' ? ['crawler'] : [...teamDefs];
          if (!ids.some((id) => focus(`[data-src^="shop:"][data-def="${id}"]`))) focus('[data-src^="shop:"]');
        }
        break;
      case 'fight':
        focus('[data-kind="fight"]');
        break;
      case 'item':
        if (sel?.kind === 'item') {
          focus('.tslot.is-target');
          sub = '现在点你的单位';
        } else focus('[data-src^="item:"]');
        break;
      case 'freezeSell':
        if (!s.tutorial?.froze) {
          if (sel?.kind === 'shop' || sel?.kind === 'item') {
            focus('[data-kind="freeze"]');
            sub = '点「冻结」';
          } else {
            focus('[data-src^="shop:"],[data-src^="item:"]');
            sub = '先点一个商店卡片';
          }
        } else if (!s.tutorial?.sold) {
          // 出售演示：买一个便宜的标注员再卖掉，别卖进化好的 Lv2 爬虫
          const sellable = s.team.findIndex((u) => u && u.level < 2 && u.defId !== 'crawler');
          const selU = sel?.kind === 'team' ? s.team[sel.index] : null;
          if (selU && selU.level < 2) {
            focus('[data-kind="sell"],[data-kind="infoSell"]');
            sub = '点「出售」，卖掉能回 1 算力';
          } else if (sellable >= 0) {
            focus(`.tslot[data-index="${sellable}"] .ucard`);
            sub = selU ? '这只是进化好的爬虫，别卖！点刚买的单位' : '冻结好了！点一下刚买的单位，再点「出售」';
          } else if (sel?.kind === 'shop') {
            focus('[data-kind="infoBuy"]');
            sub = '冻结好了！点「购买」把它买下来，再卖掉它';
          } else {
            if (!focus('[data-src^="shop:"][data-def="labeler"]')) focus('[data-src^="shop:"]');
            sub = '冻结好了！点一下「标注员」，再点「购买」';
          }
        }
        break;
      default:
        break;
    }
    bubble.set(tutStep, stepText(data, tutStep), sub);
  }

  function finishTutorial(): void {
    settings.tutorialDone = true;
    saveSettings();
    app.tutAck = true;
    sfx.click();
    toast('引导完成！这一局继续打下去吧', 'good');
    render();
  }
  function skipTutorial(): void {
    settings.tutorialDone = true;
    saveSettings();
    sfx.click();
    closeAllModals();
    app.run = null;
    go('home');
  }

  // ───────────── 动作 ─────────────
  function capture(srcEl?: Element | null): Before {
    const rects = new Map<string, DOMRect>();
    el.querySelectorAll<HTMLElement>('.team-row .ucard[data-uid]').forEach((c) => rects.set(c.dataset.uid!, c.getBoundingClientRect()));
    const g = top.querySelector('[data-hud=gold]')!.getBoundingClientRect();
    return { rects, goldRect: g, src: srcEl ? { el: srcEl as HTMLElement, rect: srcEl.getBoundingClientRect() } : undefined };
  }
  function doAct(a: ShopActionInput, srcEl?: Element | null): RunState {
    before = capture(srcEl);
    const s = act(a);
    if (s.error) {
      toast(s.error);
      before = null;
    }
    return s;
  }
  function doBuy(slot: number, to?: number): void {
    const src = el.querySelector(`[data-src="shop:${slot}"]`);
    sel = null;
    doAct(to === undefined ? { type: 'buy', slot } : { type: 'buy', slot, to }, src);
  }
  function doSell(index: number): void {
    const u = run().team[index];
    if (tutStep === 'freezeSell' && u && u.level >= 2) {
      toast('这是进化好的 Lv2，留着打架！先买个「标注员」来卖', 'info');
      return;
    }
    sel = null;
    doAct({ type: 'sell', index }, teamRow.children[index]?.querySelector('.ucard'));
  }
  function doFreeze(): void {
    if (!sel || sel.kind === 'team') {
      toast('先点一个商店里的卡片，再冻结', 'info');
      return;
    }
    const slot = sel.slot;
    doAct({ type: 'freeze', slot });
    sfx.freeze();
  }
  function useItemOn(slot: number, target: number): void {
    const s = run();
    const it = data.itemsById[s.shop[slot]?.defId];
    if (!it) return;
    if (it.effect.type === 'copyStatsFrom') {
      if (!s.team[target]) return;
      sel = { kind: 'item', slot, target };
      render();
      return;
    }
    sel = null;
    doAct({ type: 'useItem', slot, target }, el.querySelector(`[data-src="item:${slot}"]`));
  }

  function fight(): void {
    const s = run();
    if (!s.team.some(Boolean)) {
      toast('队伍还是空的，先买几个单位吧');
      return;
    }
    sfx.click();
    sel = null;
    act({ type: 'endShop' });
  }

  // 拖拽 / 单击
  const kindOf = (src: string): Kind => (src.startsWith('shop:') ? 'shopUnit' : src.startsWith('item:') ? 'shopItem' : 'team');
  const detach = attachDrag(el, {
    canDrag: (src) => run().phase === 'shop' && can(kindOf(src)),
    canDrop: (src, drop) => {
      if (drop === 'sell') return src.startsWith('team:') && can('sell');
      if (drop === 'freeze') return !src.startsWith('team:') && can('freeze');
      return can('team');
    },
    onTap: (src) => onTapSrc(src),
    onLongPress: (src) => {
      const s = run();
      const [k, i] = src.split(':');
      const n = Number(i);
      if (k === 'team' && s.team[n]) showUnitDetail(data, s.team[n]!.defId, s.team[n]!);
      else if (k === 'shop' && s.shop[n]) showUnitDetail(data, s.shop[n].defId);
      else if (k === 'item' && s.shop[n]) toast(data.itemsById[s.shop[n].defId]?.desc ?? '', 'info');
    },
    onDrop: (src, drop) => {
      if (!drop) return;
      const [k, i] = src.split(':');
      const n = Number(i);
      if (drop === 'sell') {
        if (k === 'team') doSell(n);
        return;
      }
      if (drop === 'freeze') {
        if (k !== 'team') {
          sel = { kind: k === 'shop' ? 'shop' : 'item', slot: n };
          doFreeze();
        }
        return;
      }
      const to = Number(drop.split(':')[1]);
      if (k === 'shop') doBuy(n, to);
      else if (k === 'item') useItemOn(n, to);
      else if (n !== to) teamMove(n, to);
    },
  });

  function teamMove(from: number, to: number): void {
    const s = run();
    const a = s.team[from];
    const b = s.team[to];
    sel = null;
    if (a && b && canMerge(a, b)) doAct({ type: 'merge', from, to }, teamRow.children[from]?.querySelector('.ucard'));
    else doAct({ type: 'swap', a: from, b: to });
  }

  function onTapSrc(src: string): void {
    const s = run();
    if (s.phase !== 'shop') return;
    const [k, i] = src.split(':');
    const n = Number(i);
    if (!can(kindOf(src))) return;
    sfx.click();
    if (k === 'shop') {
      if (sel?.kind === 'shop' && sel.slot === n) return doBuy(n);
      sel = { kind: 'shop', slot: n };
    } else if (k === 'item') {
      if (sel?.kind === 'item' && sel.slot === n) {
        const it = data.itemsById[s.shop[n].defId];
        if (it?.targetKind === 'team') {
          sel = null;
          doAct({ type: 'useItem', slot: n }, el.querySelector(`[data-src="item:${n}"]`));
          return;
        }
        sel = null;
      } else sel = { kind: 'item', slot: n };
    } else {
      onTapTeam(n);
      return;
    }
    render();
  }

  function onTapTeam(n: number): void {
    const s = run();
    if (sel?.kind === 'shop') return doBuy(sel.slot, n);
    if (sel?.kind === 'item') {
      const it = data.itemsById[s.shop[sel.slot]?.defId];
      if (it?.targetKind === 'unit' && s.team[n]) {
        if (it.effect.type === 'copyStatsFrom' && sel.target !== undefined) {
          if (sel.target === n) {
            sel = { kind: 'item', slot: sel.slot };
            render();
            return;
          }
          const a: ShopActionInput = { type: 'useItem', slot: sel.slot, target: sel.target, source: n };
          const srcEl = el.querySelector(`[data-src="item:${sel.slot}"]`);
          sel = null;
          doAct(a, srcEl);
          return;
        }
        return useItemOn(sel.slot, n);
      }
      sel = null;
      render();
      return;
    }
    if (sel?.kind === 'team') {
      if (sel.index === n) sel = null;
      else return teamMove(sel.index, n);
    } else if (s.team[n]) sel = { kind: 'team', index: n };
    render();
  }

  // 空槽点击 / 点空白取消
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-src]') || t.closest('button') || t.closest('.infobar') || t.closest('.tut') || t.closest('.extra')) return;
    const slot = t.closest('.tslot') as HTMLElement | null;
    if (slot && can('team')) {
      onTapTeam(Number(slot.dataset.index));
      return;
    }
    if (sel) {
      sel = null;
      render();
    }
  });

  (bar.querySelector('.act-reroll') as HTMLElement).onclick = () => {
    sfx.reroll();
    sel = null;
    doAct({ type: 'reroll' });
  };
  (bar.querySelector('.act-freeze') as HTMLElement).onclick = () => doFreeze();
  (bar.querySelector('.act-sell') as HTMLElement).onclick = () => {
    if (sel?.kind !== 'team') {
      toast('先点一个队伍里的单位，或把它拖到这里', 'info');
      return;
    }
    doSell(sel.index);
  };
  (bar.querySelector('.act-fight') as HTMLElement).onclick = () => fight();
  (teamArea.querySelector('.home-btn') as HTMLElement).onclick = () => {
    sfx.click();
    go('home');
  };

  // ───────────── 状态变化 → 渲染 + 动画 ─────────────
  const off = onRun((next, prev, action) => {
    if (next.phase === 'battle') {
      go('battle');
      return;
    }
    if (next.phase !== 'shop' && next.phase !== 'headline') return;
    if (next.phase !== 'headline' && headlineEl) {
      headlineEl.remove();
      headlineEl = null;
    }
    const b = before;
    before = null;
    render();
    if (next.error || !prev || !action) return;
    animate(prev, next, action, b);
  });
  const offNet = onOnlineChange(() => updateTopbar(top, run()));

  function cardByUid(uid: string): HTMLElement | null {
    return teamRow.querySelector(`.ucard[data-uid="${uid}"]`);
  }

  function animate(prev: RunState, next: RunState, a: ShopActionInput, b: Before | null): void {
    const goldEl = top.querySelector('[data-hud=gold]') as HTMLElement;
    const dGold = next.gold - prev.gold;
    if (dGold) {
      const [gx, gy] = center(goldEl);
      floatText(gx, gy + 18, `${dGold > 0 ? '+' : ''}${dGold}`, dGold > 0 ? '#FFC53D' : '#FFC53D', 22, 24);
      pop(goldEl, 1.15);
    }
    const prevUids = new Set(prev.team.filter(Boolean).map((u) => u!.uid));
    const leveled = next.lastLevelUp && (prev.lastLevelUp?.uid !== next.lastLevelUp.uid || prev.lastLevelUp.level !== next.lastLevelUp.level) ? next.lastLevelUp : null;
    // FLIP：队伍位置变化
    if (b && (a.type === 'swap' || a.type === 'merge')) {
      for (const [uid, r] of b.rects) {
        const c = cardByUid(uid);
        if (!c) continue;
        const nr = c.getBoundingClientRect();
        const dx = r.left - nr.left;
        const dy = r.top - nr.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) gsap.from(c, { x: dx, y: dy, duration: 0.25, ease: 'power2.out' });
      }
    }
    const statFloats = (skip?: string): void => {
      for (const u of next.team) {
        if (!u || u.uid === skip) continue;
        const p = prev.team.find((x) => x?.uid === u.uid);
        if (!p) continue;
        const da = u.atk + u.tempAtk - (p.atk + p.tempAtk);
        const dh = u.hp + u.tempHp - (p.hp + p.tempHp);
        const ds = u.shield - p.shield;
        const c = cardByUid(u.uid);
        if (!c) continue;
        const [x, y] = center(c);
        if (da || dh) {
          const txt = da && dh ? `${da > 0 ? '+' : ''}${da}/${dh > 0 ? '+' : ''}${dh}` : da ? `${da > 0 ? '+' : ''}${da} 攻` : `${dh > 0 ? '+' : ''}${dh} 血`;
          floatText(x, y - 20, txt, da && !dh ? '#FF8C42' : da < 0 || dh < 0 ? '#F25757' : '#58C65C', 20);
          pop(c, 1.08);
        }
        if (ds > 0) floatText(x, y + 4, `+${ds} 盾`, '#2F80ED', 18);
      }
    };
    switch (a.type) {
      case 'buy': {
        sfx.buy();
        const placedUid = next.team.find((u) => u && !prevUids.has(u.uid))?.uid ?? (a.to !== undefined ? next.team[a.to]?.uid : leveled?.uid) ?? next.team.find((u, i) => u && prev.team[i] && u.xp !== prev.team[i]!.xp)?.uid;
        const target = placedUid ? cardByUid(placedUid) : null;
        const merged = placedUid ? prevUids.has(placedUid) : false;
        if (target && b?.src) {
          const to = target.getBoundingClientRect();
          if (merged) {
            void flyGhost(b.src.el, b.src.rect, to, { scaleTo: 0.3, fade: true, duration: 0.3 }).then(() => mergeFx(target, leveled?.uid === placedUid ? leveled!.level : 0));
          } else {
            gsap.set(target, { opacity: 0 });
            void flyGhost(b.src.el, b.src.rect, to, { duration: 0.25 }).then(() => {
              gsap.set(target, { opacity: 1 });
              gsap.fromTo(target, { scaleY: 0.8, scaleX: 1.1 }, { scaleY: 1, scaleX: 1, duration: 0.3, ease: 'back.out(3)' });
              const [x, y] = center(target);
              const r = target.getBoundingClientRect();
              particles.burst(x, y + r.height / 2, { count: 6, kind: 'dot', colors: ['#FFFFFF'], size: 7, dist: 30, life: 0.35 });
            });
          }
        }
        statFloats(placedUid);
        break;
      }
      case 'merge': {
        const target = cardByUid(next.team[a.to]?.uid ?? '');
        if (target && b?.src) {
          void flyGhost(b.src.el, b.src.rect, target.getBoundingClientRect(), { scaleTo: 0.3, fade: true, duration: 0.3 }).then(() =>
            mergeFx(target, leveled?.uid === next.team[a.to]?.uid ? leveled!.level : 0),
          );
        }
        break;
      }
      case 'sell': {
        sfx.sell();
        if (b?.src) {
          const g = b.src.el.cloneNode(true) as HTMLElement;
          const [lx, ly] = toShell(b.src.rect.left, b.src.rect.top);
          g.classList.add('fly-ghost');
          Object.assign(g.style, { left: `${lx}px`, top: `${ly}px`, width: `${b.src.rect.width}px`, height: `${b.src.rect.height}px` });
          el.appendChild(g);
          gsap.to(g, { y: 30, scale: 0.5, opacity: 0, rotate: 12, duration: 0.35, ease: 'power2.in', onComplete: () => g.remove() });
        }
        statFloats();
        break;
      }
      case 'reroll': {
        gsap.fromTo(shop.querySelectorAll('.sslot:not(.is-frozen):not(.is-free) > .ucard, .sslot:not(.is-frozen) > .icard'), { rotateY: 90, opacity: 0 }, { rotateY: 0, opacity: 1, duration: 0.25, stagger: 0.04, ease: 'back.out(2)' });
        break;
      }
      case 'freeze': {
        const fr = shop.querySelector(`[data-shop="${a.slot}"] .frost`);
        if (fr) gsap.fromTo(fr, { scale: 0, rotate: -90 }, { scale: 1, rotate: 0, duration: 0.3, ease: 'back.out(3)' });
        break;
      }
      case 'useItem': {
        sfx.buy();
        const tgtUid = a.target !== undefined ? next.team[a.target]?.uid : undefined;
        const target = tgtUid ? cardByUid(tgtUid) : null;
        if (b?.src && target) void flyGhost(b.src.el, b.src.rect, target.getBoundingClientRect(), { scaleTo: 0.4, fade: true, duration: 0.3 }).then(() => {
          if (leveled && leveled.uid === tgtUid) mergeFx(target, leveled.level);
          else pop(target, 1.12);
        });
        else if (leveled) {
          const c = cardByUid(leveled.uid);
          if (c) mergeFx(c, leveled.level);
        }
        statFloats(leveled?.uid);
        break;
      }
      case 'chooseHeadline': {
        gsap.fromTo(shop.querySelectorAll('.sslot'), { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, stagger: 0.05, ease: 'back.out(2.5)' });
        statFloats();
        if (leveled) {
          const c = cardByUid(leveled.uid);
          if (c) mergeFx(c, leveled.level);
        }
        break;
      }
      default:
        statFloats();
    }
    // 新出现的免费奖励槽
    const prevFree = prev.shop.filter((x) => x.free).length;
    const nextFree = next.shop.filter((x) => x.free).length;
    if (nextFree > prevFree) {
      const slots = shop.querySelectorAll('.sslot.is-free');
      const last = slots[slots.length - 1];
      if (last) gsap.fromTo(last, { scale: 0, rotate: -20 }, { scale: 1, rotate: 0, duration: 0.45, delay: 0.55, ease: 'back.out(2.5)' });
    }
  }

  function mergeFx(target: HTMLElement, level: number): void {
    sfx.merge();
    const tl = gsap.timeline();
    tl.to(target, { scale: 0.85, duration: 0.15, ease: 'power2.in' }).add(() => {
      const [x, y] = center(target);
      if (level) {
        particles.burst(x, y, { count: 12, kind: 'star', colors: ['#FFC53D', '#FFFFFF'], size: 14, dist: 90, life: 0.55 });
        particles.burst(x, y, { count: 8, kind: 'confetti', size: 10, dist: 70, life: 0.6 });
        tagPop(target, `Lv${level}!`);
        screenShake();
      } else {
        particles.burst(x, y, { count: 6, kind: 'star', colors: ['#FFC53D'], size: 10, dist: 45, life: 0.4 });
        floatText(x, y - 24, '+1/+1', '#58C65C', 20);
      }
    });
    tl.to(target, { scale: level ? 1.25 : 1.1, duration: 0.15, ease: 'power2.out' }).to(target, { scale: 1, duration: 0.45, ease: 'elastic.out(1,0.5)' });
    const ring = target.querySelector('.uc-ava');
    if (level && ring) gsap.fromTo(ring, { rotate: 0 }, { rotate: 360, duration: 0.4, ease: 'power2.out', delay: 0.15 });
  }

  // ───────────── 初始 ─────────────
  render();
  const s0 = run();
  if (s0.phase === 'headline' && s0.pendingHeadline) {
    headlineEl = showHeadline(el, s0.pendingHeadline, (opt) => {
      headlineEl = null;
      doAct({ type: 'chooseHeadline', option: opt });
    });
  }
  if (pendingExtra.s) {
    const ex = extraBanner(pendingExtra.s, false);
    ex.classList.add('extra--float');
    pendingExtra.s = null;
    el.appendChild(ex);
    gsap.fromTo(ex, { y: -60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: 'back.out(2)', delay: s0.phase === 'headline' ? 0 : 0.2 });
    gsap.to(ex, { y: -60, opacity: 0, duration: 0.3, delay: 5, onComplete: () => ex.remove() });
    ex.onclick = () => ex.remove();
  }
  if (s0.error) toast(s0.error);
  const fr = el.querySelector('.team-row');
  if (fr) gsap.from(fr.querySelectorAll('.ucard'), { y: 16, opacity: 0, duration: 0.25, stagger: 0.03 });
  gsap.from(shop.querySelectorAll('.sslot'), { scale: 0.7, opacity: 0, duration: 0.3, stagger: 0.04, ease: 'back.out(2)' });

  return {
    el,
    destroy: () => {
      off();
      offNet();
      detach();
      headlineEl?.remove();
    },
  };
}
