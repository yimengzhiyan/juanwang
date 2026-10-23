// 对局页（商店阶段 + 头条）：顶栏、8 人房头像条、羁绊条、下回合预告、我方 5 槽、商店（单位/装备/消耗品）、信息条、操作按钮、引导。
import gsap from 'gsap';
import {
  MAX_SHOP_LEVEL, MAX_TURNS, UPGRADE_PRICE, canAttach, canMerge, canUpgradeShop, effectiveStats, equipRefund, equipTotals, isHeadlineTurn,
  maxTierForTurn, pveForTurn, rerollCost, shopMaxTier, stageBonus, stateBonus, tutorialStep,
  type RunState, type ShopActionInput, type SynergyState, type TutorialStepId,
} from '@juanwang/shared';
import { app, act, go, markSeen, onRun, saveSettings, settings, type Scene } from '../store';
import { renderSynergy, renderTeam, runSynergies, topbar, updateTopbar } from '../ui/team';
import { renderShop } from '../ui/shop';
import { abilityText, esc, FACTION_NAME, FREE_LABEL, ROLE_NAME, SLOT_NAME, SYN_COLOR, synergyDetailHtml, TIER_NAME } from '../ui/cards';
import { attachDrag } from '../ui/drag';
import { closeAllModals, confirmBox, openModal, showItemDetail, showUnitDetail } from '../ui/modal';
import { toast } from '../ui/toast';
import { extraBanner, showHeadline } from '../ui/headline';
import { allowedKinds, stepText, tutorialBubble, type Kind } from '../ui/tutorial';
import { lobbyView, updateDock } from '../ui/lobby';
import { pveBanner, pveStrip } from '../ui/pve';
import { center, flyGhost, floatText, pop, screenShake, tagPop, toShell } from '../fx/anims';
import { particles } from '../fx/particles';
import { sfx } from '../fx/sound';
import { ui } from '../assets';
import { isOnline, onOnlineChange } from '../net';

const HOME_SVG =
  '<svg viewBox="0 0 32 32" width="22" height="22"><path d="M5 15L16 5l11 10" fill="none" stroke="#3B2A1A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 13v13h6v-7h4v7h6V13" fill="#FFC53D" stroke="#3B2A1A" stroke-width="3" stroke-linejoin="round"/></svg>';

type Sel =
  | { kind: 'shop'; slot: number }
  | { kind: 'equip'; slot: number }
  | { kind: 'cons'; slot: number }
  | { kind: 'team'; index: number }
  | null;

interface Before {
  rects: Map<string, DOMRect>;
  src?: { el: HTMLElement; rect: DOMRect };
}

/** 由结算页设置：下一回合开始时要展示的号外 */
export const pendingExtra: { s: RunState['lastSurprise'] | null } = { s: null };
/** 已展示过 PVE 条幅的回合（同一回合重进商店不重复） */
let pveShownFor = '';

export function gameScene(): Scene {
  const data = app.data;
  const el = document.createElement('div');
  const top = topbar();
  const lobby = lobbyView(data, 'strip');
  const s00 = app.run!;
  const pv = !s00.tutorial ? pveForTurn(s00.turn, data) : undefined;
  const strip = pv ? pveStrip(pv) : null;
  const syn = document.createElement('div');
  syn.className = 'synergy-bar';
  syn.dataset.tut = 'synergy-bar';
  const notes = document.createElement('div');
  notes.className = 'notes';
  const teamArea = document.createElement('section');
  teamArea.className = 'team-area';
  teamArea.innerHTML = `<div class="area-label"><button class="mini-btn home-btn" aria-label="返回首页">${HOME_SVG}</button><span>我的队伍</span><small>← 前排先开火</small><span class="mod-hint"></span><span class="net-tag">离线模式</span></div><div class="team-row"></div><div class="grass"></div>`;
  const teamRow = teamArea.querySelector('.team-row') as HTMLElement;
  const modHint = teamArea.querySelector('.mod-hint') as HTMLElement;
  const shop = document.createElement('section');
  shop.className = 'shop panel';
  shop.innerHTML = `<div class="shop-head"><span>商店</span><small class="shop-bonus"></small><button class="up-btn" data-kind="upgrade"></button></div><div class="shop-units"></div><div class="shop-items"></div>`;
  const shopUnits = shop.querySelector('.shop-units') as HTMLElement;
  const shopItems = shop.querySelector('.shop-items') as HTMLElement;
  const shopBonus = shop.querySelector('.shop-bonus') as HTMLElement;
  const upBtn = shop.querySelector('.up-btn') as HTMLButtonElement;
  const info = document.createElement('div');
  info.className = 'infobar';
  const bar = document.createElement('div');
  bar.className = 'actions';
  bar.innerHTML = `
    <button class="btn btn--icon act-reroll" data-kind="reroll"><img src="${ui('reroll')}" alt=""><span>刷新</span><em class="cost"></em></button>
    <button class="btn btn--icon btn--ice act-freeze" data-kind="freeze" data-drop="freeze" data-tut="freeze"><img src="${ui('freeze')}" alt=""><span>冻结</span></button>
    <button class="btn btn--icon btn--danger act-sell" data-kind="sell" data-drop="sell" data-tut="sell"><img src="${ui('sell')}" alt=""><span>出售</span></button>
    <button class="btn btn--go act-fight" data-kind="fight" data-tut="fight"><img src="${ui('battle')}" alt="">开战</button>`;
  const bubble = tutorialBubble(data, skipTutorial, finishTutorial);
  el.append(top);
  if (strip) el.append(strip);
  el.append(lobby.el, syn, notes, teamArea, shop, bubble.el, info, bar);
  if (s00.tutorial) lobby.el.style.display = 'none';

  let sel: Sel = null;
  let before: Before | null = null;
  let headlineEl: HTMLElement | null = null;
  let tutStep: TutorialStepId | null = null;
  let allow = allowedKinds(null);
  let prevTiers: Map<string, number> | null = null;


  const run = (): RunState => app.run!;
  const can = (k: Kind): boolean => allow.has(k);

  // ───────────── 渲染 ─────────────
  function render(): void {
    const s = run();
    updateTopbar(top, s);
    if (!s.tutorial) {
      lobby.update(s);
      updateDock(s);
    } else updateDock(null);
    const syns = runSynergies(s, data);
    renderSynergy(syn, syns, (st) => openSynergy(st));
    detectTierUp(syns);
    renderTeam(teamRow, s, data);
    renderShop(shopUnits, shopItems, s, data);
    markSeen([...s.team.filter(Boolean).map((u) => u!.defId), ...s.shop.filter((x) => x.kind === 'unit').map((x) => x.defId)]);
    // 队形修正提示
    const hints: string[] = [];
    if ((s.modifiers.battleSwapAll ?? 0) % 2 === 1) hints.push('开战时队伍反转');
    for (const uid of s.modifiers.battlePullFront ?? []) {
      const u = s.team.find((x) => x?.uid === uid);
      if (u) hints.push(`开战时 ${data.unitsById[u.defId]?.name ?? ''} 上前`);
    }
    modHint.textContent = hints.join(' · ');
    modHint.style.display = hints.length ? '' : 'none';
    renderNext(s);
    // 商店加成提示
    const m = s.modifiers;
    const bonus: string[] = [];
    if (m.rerollFree) bonus.push('刷新免费');
    else if (m.freeRerolls > 0) bonus.push(`免费刷新 ×${m.freeRerolls}`);
    if (m.unitPriceMod) bonus.push(`单位 ${m.unitPriceMod > 0 ? '+' : ''}${m.unitPriceMod}`);
    if (m.itemPriceMod) bonus.push(`装备 ${m.itemPriceMod > 0 ? '+' : ''}${m.itemPriceMod}`);
    if (m.enemyAtkDebuff) bonus.push(`敌方 -${m.enemyAtkDebuff} 攻`);
    if (s.arena && data.arenasById[s.arena]) bonus.unshift(data.arenasById[s.arena].name);
    shopBonus.textContent = bonus.join(' · ');
    // 升级商店按钮：当前阶 → 下一阶、价格、剩余次数
    const t = shopMaxTier(s);
    const left = MAX_SHOP_LEVEL - s.shopLevel;
    if (t >= 6 || left <= 0) {
      upBtn.innerHTML = `<b>T${t}</b><span>${t >= 6 ? '最高阶' : '升级已用完'}</span>`;
      upBtn.disabled = true;
    } else {
      upBtn.innerHTML = `<b>升级 T${t}→T${t + 1}</b><span><img src="${ui('gold')}" alt="">${UPGRADE_PRICE} · 剩 ${left} 次</span>`;
      upBtn.disabled = !canUpgradeShop(s);
    }
    // 刷新价格
    const rc = rerollCost(s, data);
    (bar.querySelector('.act-reroll .cost') as HTMLElement).innerHTML = rc ? `<img src="${ui('gold')}" alt="">${rc}` : '免费';
    // 选中态校验
    if (sel && sel.kind !== 'team' && s.shop[sel.slot]?.kind !== (sel.kind === 'shop' ? 'unit' : sel.kind === 'equip' ? 'equip' : 'consumable')) sel = null;
    if (sel?.kind === 'team' && !s.team[sel.index]) sel = null;
    el.classList.toggle('is-offline', !isOnline());
    renderSelection();
    renderInfo();
    applyTutorial();
  }

  function openSynergy(st: SynergyState): void {
    sfx.click();
    const body = document.createElement('div');
    body.innerHTML = synergyDetailHtml(st);
    openModal({ title: `${st.name}羁绊`, body, cls: 'modal--syn' });
  }

  /** 达成新档：徽章弹跳 + 短横幅 */
  function detectTierUp(syns: SynergyState[]): void {
    const now = new Map(syns.map((x) => [x.key, x.tier] as const));
    if (prevTiers) {
      const ups = syns.filter((x) => x.tier > (prevTiers!.get(x.key) ?? 0));
      if (ups.length) {
        sfx.tierUp();
        for (const st of ups) {
          const chip = syn.querySelector(`[data-key="${st.key}"]`) as HTMLElement | null;
          if (chip) {
            gsap.fromTo(chip, { scale: 1 }, { scale: 1.15, duration: 0.12, yoyo: true, repeat: 1, ease: 'back.out(3)' });
            const sh = chip.querySelector('.tier-shield');
            if (sh) gsap.fromTo(sh, { y: -22, scale: 1.8, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.22, ease: 'power4.out', delay: 0.08 });
            chip.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
          }
        }
        const st = ups[0];
        tierBanner(`${st.name} ×${st.count}：${st.descs[st.tier - 1] ?? '羁绊点亮！'}`, SYN_COLOR[st.key], st.tier);
      }
    }
    prevTiers = now;
  }
  function tierBanner(text: string, color: string, tier: number): void {
    const b = document.createElement('div');
    b.className = `tier-banner tier-banner--${tier}`;
    b.style.setProperty('--sc', color);
    b.innerHTML = `<img src="${ui(`tier_${Math.min(3, tier)}`)}" alt=""><span>${esc(text)}</span>`;
    el.appendChild(b);
    const r = syn.getBoundingClientRect();
    const [, ly] = toShell(0, r.bottom);
    b.style.top = `${ly + 2}px`;
    gsap
      .timeline({ onComplete: () => b.remove() })
      .fromTo(b, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.2, ease: 'back.out(2.5)' })
      .to(b, { opacity: 0, y: -8, duration: 0.2 }, '+=1.6');
  }

  /** 下回合预告：头条 / PVE / 解锁阶级 / 扣血加码 */
  function renderNext(s: RunState): void {
    const next = s.turn + 1;
    const parts: string[] = [];
    if (next <= MAX_TURNS && s.phase === 'shop') {
      const npv = !s.tutorial ? pveForTurn(next, data) : undefined;
      if (npv) parts.push(`怪物来袭（不扣热度）`);
      if (isHeadlineTurn(next, s, data)) parts.push('头条二选一');
      const t1 = maxTierForTurn(next);
      if (t1 > shopMaxTier(s)) parts.push(`解锁 T${t1} 单位`);
      if (stageBonus(next) > stageBonus(s.turn)) parts.push(`输方扣血 +${stageBonus(next)}`);
      parts.splice(2);
    }
    notes.style.display = parts.length ? '' : 'none';
    if (!parts.length) return;
    const head = `下回合：${parts.join(' · ')}`;
    if (notes.dataset.text === head) return;
    notes.dataset.text = head;
    notes.innerHTML = `<span class="next-tip"><i>NEXT</i>${esc(head)}</span>`;
  }

  /** 选中商店卡时，在卡片正下方弹出大号操作按钮 */
  let popKey = '';
  function renderBuyPop(): void {
    shop.querySelectorAll('.buy-pop').forEach((n) => n.remove());
    const s = run();
    if (!sel || sel.kind === 'team' || s.phase !== 'shop') {
      popKey = '';
      return;
    }
    const slotIdx = sel.slot;
    const slot = s.shop[slotIdx];
    const wrap = shop.querySelector(`[data-shop="${slotIdx}"]`) as HTMLElement | null;
    if (!slot || !wrap) return;
    const p = document.createElement('div');
    p.className = 'buy-pop';
    const poor = slot.price > s.gold;
    const cost = slot.free ? `<small>${FREE_LABEL[slot.freeReason ?? 'levelUp']}</small>` : `<img src="${ui('gold')}" alt="">${slot.price}`;
    let main = '';
    if (sel.kind === 'shop') main = `<button class="btn btn--go buy-pop-btn${poor ? ' is-poor' : ''}" data-kind="infoBuy">${slot.free ? '免费拿' : '购买 '}${cost}</button>`;
    else if (sel.kind === 'equip') main = `<div class="buy-pop-hint${poor ? ' is-poor' : ''}">点一个单位装上 ${cost}</div>`;
    else {
      const c = data.consumablesById[slot.defId];
      main = c?.targetKind === 'unit'
        ? `<div class="buy-pop-hint${poor ? ' is-poor' : ''}">点一个单位使用 ${cost}</div>`
        : `<button class="btn btn--go buy-pop-btn${poor ? ' is-poor' : ''}" data-kind="infoUse">使用 ${cost}</button>`;
    }
    p.innerHTML = `${main}<button class="buy-pop-more">${sel.kind === 'shop' ? '查看技能' : '查看效果'}</button>`;
    wrap.appendChild(p);
    const pr = shop.getBoundingClientRect();
    const r = p.getBoundingClientRect();
    const l = r.left - r.width / 2;
    const dx = l < pr.left + 4 ? pr.left + 4 - l : l + r.width > pr.right - 4 ? pr.right - 4 - (l + r.width) : 0;
    p.style.setProperty('--dx', `${dx}px`);
    gsap.set(p, { xPercent: -50, x: dx });
    const k = sel.kind;
    const btn = p.querySelector('.buy-pop-btn') as HTMLElement | null;
    if (btn)
      btn.onclick = () => {
        sfx.click();
        if (k === 'shop') doBuy(slotIdx);
        else useConsumable(slotIdx);
      };
    (p.querySelector('.buy-pop-more') as HTMLElement).onclick = () => {
      if (k === 'shop') showUnitDetail(data, slot.defId);
      else showItemDetail(data, k === 'equip' ? 'equip' : 'consumable', slot.defId, !!slot.gold);
    };
    const key = `${k}:${slotIdx}`;
    if (popKey !== key) gsap.fromTo(p, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2.5)' });
    popKey = key;
  }

  function renderSelection(): void {
    const s = run();
    el.querySelectorAll('.is-selected,.is-target,.is-merge,.is-replace').forEach((n) => n.classList.remove('is-selected', 'is-target', 'is-merge', 'is-replace'));
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
    } else if (sel.kind === 'equip') {
      el.querySelector(`[data-src="equip:${sel.slot}"]`)?.classList.add('is-selected');
      const sl = s.shop[sel.slot];
      const def = data.equipsById[sl.defId];
      s.team.forEach((u, i) => {
        if (!u || !def) return;
        const cur = u.equips?.[def.slot];
        const c = teamRow.children[i];
        if (canAttach(u, def, !!sl.gold)) return;
        if (!cur) c.classList.add('is-target');
        else if (cur.defId === def.id && !cur.gold && !sl.gold) c.classList.add('is-merge');
        else c.classList.add('is-target', 'is-replace');
      });
    } else if (sel.kind === 'cons') {
      el.querySelector(`[data-src="cons:${sel.slot}"]`)?.classList.add('is-selected');
      const c = data.consumablesById[s.shop[sel.slot].defId];
      if (c?.targetKind === 'unit') s.team.forEach((u, i) => u && teamRow.children[i].classList.add('is-target'));
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

  function sellValue(i: number): number {
    const u = run().team[i];
    if (!u) return 0;
    return u.level + equipRefund(u) + (equipTotals(u, data).sellGold ?? 0);
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
    const detailLink = (fn: () => void): void => {
      const a = document.createElement('button');
      a.className = 'info-more';
      a.textContent = '详情 ›';
      a.onclick = fn;
      text.querySelector('.info-head')?.appendChild(a);
    };
    if (!sel) {
      text.innerHTML = '<span class="info-hint">点卡片再点「购买」· 拖到队伍也行 · 同名叠加进化<br>装备拖到单位身上 · 拖动队伍换位 · 拖到「出售」卖掉</span>';
    } else if (sel.kind === 'shop') {
      const slot = s.shop[sel.slot];
      const def = data.unitsById[slot.defId];
      const freeChip = slot.free ? `<span class="chip chip--xs chip--free-${slot.freeReason ?? 'levelUp'}">${FREE_LABEL[slot.freeReason ?? 'levelUp']}</span>` : '';
      text.innerHTML = `<div class="info-head"><b class="info-name">${esc(def.name)}</b><span class="chip chip--xs tier-${def.tier}">${TIER_NAME[def.tier]}</span><span class="chip chip--xs fac-${def.faction}">${FACTION_NAME[def.faction]}</span>${def.role ? `<span class="chip chip--xs">${ROLE_NAME[def.role]}</span>` : ''}${freeChip}</div><p>${esc(abilityText(def))}</p>`;
      detailLink(() => showUnitDetail(data, def.id));
    } else if (sel.kind === 'equip') {
      const slot = s.shop[sel.slot];
      const def = data.equipsById[slot.defId];
      text.innerHTML = `<div class="info-head"><b class="info-name">${slot.gold ? '金·' : ''}${esc(def.name)}</b><span class="chip chip--xs"><img src="${ui(`slot_${def.slot}`)}" alt="">${SLOT_NAME[def.slot]}</span></div><p>${esc(slot.gold ? def.goldDesc : def.desc)}<br><em>点或拖到一个单位身上装备</em></p>`;
      detailLink(() => showItemDetail(data, 'equip', def.id, !!slot.gold));
    } else if (sel.kind === 'cons') {
      const slot = s.shop[sel.slot];
      const def = data.consumablesById[slot.defId];
      text.innerHTML = `<div class="info-head"><b class="info-name">${esc(def.name)}</b><span class="chip chip--xs">${def.targetKind === 'unit' ? '选单位' : '即用'}</span></div><p>${esc(def.desc)}${def.targetKind === 'unit' ? '<br><em>点一个队伍单位使用</em>' : ''}</p>`;
      if (def.targetKind !== 'unit') {
        const slotIdx = sel.slot;
        mk(slot.price ? `使用 <img src="${ui('gold')}" alt="">${slot.price}` : '使用', 'btn--go', 'infoUse', () => useConsumable(slotIdx));
      }
    } else {
      const u = s.team[sel.index]!;
      const def = data.unitsById[u.defId];
      const eq = Object.values(u.equips ?? {}).filter(Boolean).length;
      text.innerHTML = `<div class="info-head"><b class="info-name">${esc(def.name)}</b><span class="chip chip--xs">Lv${u.level}</span><span class="chip chip--xs fac-${def.faction}">${FACTION_NAME[def.faction]}</span>${def.role ? `<span class="chip chip--xs">${ROLE_NAME[def.role]}</span>` : ''}${eq ? `<span class="chip chip--xs">装备 ${eq}</span>` : ''}</div><p>${esc(abilityText(def))}</p>`;
      detailLink(() => showUnitDetail(data, def.id, u, { stats: effectiveStats(u, data, s.team, stateBonus(s, data)) }));
      const idx = sel.index;
      mk(`出售 +${sellValue(idx)}<img src="${ui('gold')}" alt="">`, 'btn--danger', 'infoSell', () => doSell(idx));
    }
    info.append(text, btns);
  }

  // ───────────── 引导 ─────────────
  function applyTutorial(): void {
    const s = run();
    const raw = tutorialStep(s, data);
    if (raw === 'done' && !settings.tutorialDone) {
      settings.tutorialDone = true;
      saveSettings();
    }
    tutStep = raw && !(raw === 'done' && app.tutAck) ? raw : null;
    // 完成气泡不要压在头条弹窗下面：等选完头条再出
    if (tutStep === 'done' && s.phase === 'headline') tutStep = null;
    allow = allowedKinds(tutStep === 'done' ? null : tutStep);
    el.classList.toggle('is-tutorial', !!tutStep);
    el.querySelectorAll('.tut-focus').forEach((n) => n.classList.remove('tut-focus'));
    el.querySelectorAll('.tut-lock').forEach((n) => n.classList.remove('tut-lock'));
    if (!tutStep) {
      bubble.set(null, '');
      return;
    }
    const lock = (q: string, k: Kind): void => {
      if (!can(k)) el.querySelectorAll(q).forEach((n) => n.classList.add('tut-lock'));
    };
    lock('[data-src^="shop:"]', 'shopUnit');
    lock('[data-src^="equip:"]', 'shopEquip');
    lock('[data-src^="cons:"]', 'shopCons');
    lock('.tslot', 'team');
    for (const k of ['reroll', 'freeze', 'sell', 'fight', 'upgrade', 'infoBuy', 'infoUse', 'infoSell'] as Kind[]) lock(`[data-kind="${k}"]`, k);
    const focus = (q: string): boolean => {
      const list = el.querySelectorAll(q);
      list.forEach((n) => n.classList.add('tut-focus'));
      return list.length > 0;
    };
    const focusUnit = (ids: string[]): void => {
      if (!ids.some((id) => focus(`[data-src^="shop:"][data-def="${id}"]`))) focus('[data-src^="shop:"]');
    };
    let sub = '';
    const teamIds = [...new Set(s.team.filter((u) => u && u.level < 3).map((u) => u!.defId))];
    switch (tutStep) {
      case 'buy':
      case 'buyAgain':
        if (sel?.kind === 'shop') {
          focus('[data-kind="infoBuy"]');
          sub = '点卡片下方的「购买」（也可以把卡片拖到队伍里）';
        } else focusUnit(['botnet']);
        break;
      case 'merge':
        if (sel?.kind === 'shop') {
          focus('[data-kind="infoBuy"]');
          sub = '点「购买」，同名的会自动叠上去';
        } else {
          focusUnit(teamIds);
          if (!s.shop.some((x) => x.kind === 'unit' && teamIds.includes(x.defId))) sub = '商店里没有同名的了：点「刷新」找一找';
        }
        break;
      case 'synergy':
        if (sel?.kind === 'shop') {
          focus('[data-kind="infoBuy"]');
          sub = '买下后看队伍上方的羁绊徽章';
        } else {
          focusUnit(['labeler', 'prompt_eng', 'doubao_chan']);
          focus('.synergy-bar');
        }
        break;
      case 'fight':
        focus('[data-kind="fight"]');
        if (s.turn === 1 && s.shop.some((x) => x.kind === 'unit' && x.defId === 'botnet') && s.gold >= 3) sub = '（还可以再买一只水军机器人叠上去，下回合更好进化）';
        break;
      case 'equip':
      case 'item':
        if (sel?.kind === 'equip') {
          focus('.tslot.is-target, .tslot.is-merge');
          sub = '现在点你的单位（或直接拖过去）';
        } else if (!focus('[data-src^="equip:"][data-equip="dataset"]')) focus('[data-src^="equip:"]');
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
    return { rects, src: srcEl ? { el: srcEl as HTMLElement, rect: srcEl.getBoundingClientRect() } : undefined };
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
  /** 装备：同槽换装时先确认折算 */
  function doEquip(slot: number, unitIndex: number): void {
    const s = run();
    const sl = s.shop[slot];
    const u = s.team[unitIndex];
    const def = sl ? data.equipsById[sl.defId] : undefined;
    if (!def || !sl) return;
    if (!u) {
      toast('装备要装到一个单位身上', 'info');
      return;
    }
    const err = canAttach(u, def, !!sl.gold);
    if (err) {
      toast(err);
      return;
    }
    if (sl.price > s.gold) {
      toast(`算力不够（需要 ${sl.price}）`);
      return;
    }
    const cur = u.equips?.[def.slot];
    const go2 = (): void => {
      sel = null;
      doAct({ type: 'equip', slot, unitIndex }, el.querySelector(`[data-src="equip:${slot}"]`));
    };
    if (cur && !(cur.defId === def.id && !cur.gold && !sl.gold)) {
      const old = data.equipsById[cur.defId];
      confirmBox(
        `${data.unitsById[u.defId]?.name ?? ''} 的${SLOT_NAME[def.slot]}槽已有「${cur.gold ? '金·' : ''}${old?.name ?? cur.defId}」。替换成「${sl.gold ? '金·' : ''}${def.name}」？旧装备折算 +${cur.gold ? 2 : 1} 算力`,
        '替换',
        go2,
      );
      return;
    }
    go2();
  }
  function useConsumable(slot: number, target?: number): void {
    const s = run();
    const c = data.consumablesById[s.shop[slot]?.defId];
    if (!c) return;
    if (c.targetKind === 'unit' && target === undefined) {
      sel = { kind: 'cons', slot };
      render();
      toast('点一个队伍单位使用', 'info');
      return;
    }
    sel = null;
    doAct(target === undefined ? { type: 'useConsumable', slot } : { type: 'useConsumable', slot, target }, el.querySelector(`[data-src="cons:${slot}"]`));
  }

  function fight(): void {
    const s = run();
    if (!s.team.some(Boolean)) {
      toast('队伍还是空的，先买几个单位吧');
      return;
    }
    sfx.click();
    sel = null;
    const n = act({ type: 'endShop' });
    if (n.error) toast(n.error);
  }

  // 拖拽 / 单击
  const kindOf = (src: string): Kind => (src.startsWith('shop:') ? 'shopUnit' : src.startsWith('equip:') ? 'shopEquip' : src.startsWith('cons:') ? 'shopCons' : 'team');
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
      if (k === 'team' && s.team[n]) showUnitDetail(data, s.team[n]!.defId, s.team[n]!, { stats: effectiveStats(s.team[n]!, data, s.team, stateBonus(s, data)) });
      else if (k === 'shop' && s.shop[n]) showUnitDetail(data, s.shop[n].defId);
      else if (k === 'equip' && s.shop[n]) showItemDetail(data, 'equip', s.shop[n].defId, !!s.shop[n].gold);
      else if (k === 'cons' && s.shop[n]) showItemDetail(data, 'consumable', s.shop[n].defId);
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
          sel = { kind: k as 'shop' | 'equip' | 'cons', slot: n };
          doFreeze();
        }
        return;
      }
      const to = Number(drop.split(':')[1]);
      if (k === 'shop') doBuy(n, to);
      else if (k === 'equip') doEquip(n, to);
      else if (k === 'cons') {
        const c = data.consumablesById[run().shop[n]?.defId];
        if (c?.targetKind === 'unit' && !run().team[to]) return toast('拖到一个单位身上使用', 'info');
        useConsumable(n, c?.targetKind === 'unit' ? to : undefined);
      } else if (n !== to) teamMove(n, to);
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
    if (k === 'team') {
      onTapTeam(n);
      return;
    }
    if (k === 'shop') {
      if (sel?.kind === 'shop' && sel.slot === n) return doBuy(n);
      sel = { kind: 'shop', slot: n };
    } else if (k === 'equip') {
      sel = sel?.kind === 'equip' && sel.slot === n ? null : { kind: 'equip', slot: n };
    } else if (k === 'cons') {
      const c = data.consumablesById[s.shop[n]?.defId];
      if (sel?.kind === 'cons' && sel.slot === n) {
        if (c?.targetKind !== 'unit') return useConsumable(n);
        sel = null;
      } else sel = { kind: 'cons', slot: n };
    }
    render();
  }

  function onTapTeam(n: number): void {
    const s = run();
    if (sel?.kind === 'shop') return doBuy(sel.slot, n);
    if (sel?.kind === 'equip') return doEquip(sel.slot, n);
    if (sel?.kind === 'cons') {
      const c = data.consumablesById[s.shop[sel.slot]?.defId];
      if (c?.targetKind === 'unit' && s.team[n]) return useConsumable(sel.slot, n);
      sel = null;
      render();
      return;
    }
    if (sel?.kind === 'team') {
      if (sel.index === n) sel = null;
      else return teamMove(sel.index, n);
    } else if (s.team[n] && can('team')) sel = { kind: 'team', index: n };
    render();
  }

  // 空槽点击 / 点空白取消
  el.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-src]') || t.closest('button') || t.closest('.infobar') || t.closest('.tut') || t.closest('.extra') || t.closest('.lobby')) return;
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
  upBtn.onclick = () => {
    sfx.click();
    sel = null;
    doAct({ type: 'upgradeShop' });
  };
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
    if (action.type === 'chooseHeadline') maybePve();
  });
  const offNet = onOnlineChange(() => el.classList.toggle('is-offline', !isOnline()));

  function cardByUid(uid: string): HTMLElement | null {
    return teamRow.querySelector(`.ucard[data-uid="${uid}"]`);
  }

  function animate(prev: RunState, next: RunState, a: ShopActionInput, b: Before | null): void {
    const goldEl = top.querySelector('[data-hud=gold]') as HTMLElement;
    const dGold = next.gold - prev.gold;
    if (dGold) {
      const [gx, gy] = center(goldEl);
      floatText(gx, gy + 18, `${dGold > 0 ? '+' : ''}${dGold}`, '#FFC53D', 22, 24);
      pop(goldEl, 1.15);
    }
    const prevUids = new Set(prev.team.filter(Boolean).map((u) => u!.uid));
    const leveled = next.lastLevelUp && (prev.lastLevelUp?.uid !== next.lastLevelUp.uid || prev.lastLevelUp.level !== next.lastLevelUp.level) ? next.lastLevelUp : null;
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
    const bonusP = stateBonus(prev, data);
    const bonusN = stateBonus(next, data);
    const statFloats = (skip?: string): void => {
      for (const u of next.team) {
        if (!u || u.uid === skip) continue;
        const p = prev.team.find((x) => x?.uid === u.uid);
        if (!p) continue;
        const e1 = effectiveStats(p, data, prev.team, bonusP);
        const e2 = effectiveStats(u, data, next.team, bonusN);
        const da = e2.atk - e1.atk;
        const dh = e2.hp - e1.hp;
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
      case 'reroll':
      case 'upgradeShop': {
        gsap.fromTo(shop.querySelectorAll('.sslot:not(.is-frozen):not(.is-free) > .ucard, .sslot:not(.is-frozen):not(.is-free) > .icard'), { rotateY: 90, opacity: 0 }, { rotateY: 0, opacity: 1, duration: 0.25, stagger: 0.04, ease: 'back.out(2)' });
        if (a.type === 'upgradeShop') {
          const ev = next.lastEvents.find((e) => e.type === 'shopLevelUp');
          const tierEl = top.querySelector('[data-hud=tier]') as HTMLElement;
          pop(tierEl, 1.35);
          tagPop(tierEl, `T${shopMaxTier(next)}!`);
          sfx.tierUp();
          if (ev) toast(ev.text, 'good');
        }
        statFloats();
        break;
      }
      case 'freeze': {
        const fr = shop.querySelector(`[data-shop="${a.slot}"] .frost`);
        if (fr) gsap.fromTo(fr, { scale: 0, rotate: -90 }, { scale: 1, rotate: 0, duration: 0.3, ease: 'back.out(3)' });
        break;
      }
      case 'equip': {
        const tgtUid = next.team[a.unitIndex]?.uid;
        const target = tgtUid ? cardByUid(tgtUid) : null;
        const pu = prev.team[a.unitIndex];
        const nu = next.team[a.unitIndex];
        const eqDef = data.equipsById[prev.shop[a.slot]?.defId ?? ''];
        const becameGold = !!(eqDef && nu?.equips?.[eqDef.slot]?.gold && !pu?.equips?.[eqDef.slot]?.gold);
        const finish = (): void => {
          if (!target) return;
          const slotEl = eqDef ? (target.querySelector(`.uc-eq[data-slot="${eqDef.slot}"]`) as HTMLElement | null) : null;
          if (slotEl) {
            gsap.fromTo(slotEl, { scale: 2.2 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
            const [x, y] = center(slotEl);
            particles.burst(x, y, { count: becameGold ? 10 : 5, kind: 'star', colors: becameGold ? ['#FFC53D', '#FFFFFF'] : ['#FFFFFF', '#7FD6FF'], size: 10, dist: becameGold ? 50 : 30, life: 0.4 });
          }
          if (becameGold) {
            sfx.goldEquip();
            tagPop(target, '金色！');
          } else sfx.equip();
          if (leveled && leveled.uid === tgtUid) mergeFx(target, leveled.level);
          statFloats();
        };
        if (b?.src && target) void flyGhost(b.src.el, b.src.rect, target.getBoundingClientRect(), { scaleTo: 0.35, fade: true, duration: 0.3 }).then(finish);
        else finish();
        break;
      }
      case 'useConsumable': {
        sfx.buy();
        const tgtUid = a.target !== undefined ? next.team[a.target]?.uid : leveled?.uid;
        const target = tgtUid ? cardByUid(tgtUid) : null;
        if (b?.src && target)
          void flyGhost(b.src.el, b.src.rect, target.getBoundingClientRect(), { scaleTo: 0.4, fade: true, duration: 0.3 }).then(() => {
            if (leveled && leveled.uid === tgtUid) mergeFx(target, leveled.level);
            else pop(target, 1.12);
          });
        else if (leveled) {
          const c = cardByUid(leveled.uid);
          if (c) mergeFx(c, leveled.level);
        }
        const dRer = next.modifiers.freeRerolls - prev.modifiers.freeRerolls;
        if (dRer > 0) toast(`+${dRer} 次免费刷新`, 'good');
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
        for (const e of next.lastEvents) if (e.type === 'hpLoss') toast(e.text, e.who === 'me' ? 'warn' : 'info');
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

  /** PVE 回合：开店前"怪物来袭"条幅（每回合一次） */
  function maybePve(): void {
    const s = run();
    if (!pv || s.phase !== 'shop') return;
    const key = `${s.seed}:${s.turn}`;
    if (pveShownFor === key) return;
    pveShownFor = key;
    void pveBanner(el, pv, s.turn).then(() => {
      if (strip) gsap.fromTo(strip, { scaleY: 0.2, opacity: 0 }, { scaleY: 1, opacity: 1, duration: 0.25, ease: 'back.out(2)' });
    });
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
  maybePve();
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

