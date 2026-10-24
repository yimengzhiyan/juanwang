// 商店区：4 单位 + 2 装备 + 1 消耗品（价格、冻结、免费槽）。
// 卡片 data-src = "shop:i"（单位）/ "equip:i"（装备）/ "cons:i"（消耗品），i 为 state.shop 下标。
import type { GameData, RunState } from '@juanwang/shared';
import { ui } from '../assets';
import { consumableCard, equipCard, priceTag, unitCard } from './cards';

export function renderShop(unitsEl: HTMLElement, itemsEl: HTMLElement, s: RunState, data: GameData): void {
  unitsEl.innerHTML = '';
  itemsEl.innerHTML = '';
  let nUnits = 0;
  let nItems = 0;
  s.shop.forEach((slot, i) => {
    const wrap = document.createElement('div');
    wrap.className = `sslot${slot.frozen ? ' is-frozen' : ''}${slot.free ? ` is-free is-free--${slot.freeReason ?? 'levelUp'}` : ''}`;
    wrap.dataset.shop = String(i);
    const affordable = slot.price <= s.gold;
    const free = slot.free ? (slot.freeReason ?? 'levelUp') : false;
    if (slot.kind === 'unit') {
      const def = data.unitsById[slot.defId];
      if (!def) return;
      nUnits++;
      wrap.classList.add('sslot--unit');
      const c = unitCard(def, { atk: def.atk, hp: def.hp, level: 1 }, { variant: 'big' });
      c.dataset.src = `shop:${i}`;
      c.dataset.tut = 'shop-unit';
      wrap.appendChild(c);
      wrap.appendChild(priceTag(slot.price, affordable, free));
      unitsEl.appendChild(wrap);
    } else if (slot.kind === 'equip') {
      const def = data.equipsById[slot.defId];
      if (!def) return;
      nItems++;
      wrap.classList.add('sslot--item');
      const c = equipCard(def, !!slot.gold);
      c.dataset.src = `equip:${i}`;
      c.dataset.tut = 'shop-equip';
      wrap.appendChild(c);
      wrap.appendChild(priceTag(slot.price, affordable, free));
      itemsEl.appendChild(wrap);
    } else {
      const def = data.consumablesById[slot.defId];
      if (!def) return;
      nItems++;
      wrap.classList.add('sslot--item', 'sslot--cons');
      const c = consumableCard(def);
      c.dataset.src = `cons:${i}`;
      c.dataset.tut = 'shop-cons';
      wrap.appendChild(c);
      wrap.appendChild(priceTag(slot.price, affordable, free));
      itemsEl.appendChild(wrap);
    }
    if (slot.frozen) wrap.insertAdjacentHTML('beforeend', `<img class="frost" src="${ui('freeze')}" alt="冻结">`);
  });
  unitsEl.dataset.count = String(nUnits);
  itemsEl.dataset.count = String(nItems);
  if (!nUnits) unitsEl.innerHTML = '<div class="shop-empty">买空了！可以刷新看看</div>';
}
