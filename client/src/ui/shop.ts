// 商店区：单位槽 + 基建槽（价格、冻结、进化奖励）。卡片 data-src="shop:i" / "item:i"，i 为 state.shop 下标。
import type { GameData, RunState } from '@juanwang/shared';
import { ui } from '../assets';
import { itemCard, priceTag, unitCard } from './cards';

export function renderShop(unitsEl: HTMLElement, itemsEl: HTMLElement, s: RunState, data: GameData): void {
  unitsEl.innerHTML = '';
  itemsEl.innerHTML = '';
  let nUnits = 0;
  s.shop.forEach((slot, i) => {
    const wrap = document.createElement('div');
    wrap.className = `sslot${slot.frozen ? ' is-frozen' : ''}${slot.free ? ' is-free' : ''}`;
    wrap.dataset.shop = String(i);
    const affordable = slot.price <= s.gold;
    if (slot.kind === 'unit') {
      const def = data.unitsById[slot.defId];
      if (!def) return;
      nUnits++;
      const c = unitCard(def, { atk: def.atk, hp: def.hp, level: 1 });
      c.dataset.src = `shop:${i}`;
      c.dataset.tut = 'shop-unit';
      wrap.appendChild(c);
      wrap.appendChild(priceTag(slot.price, affordable, !!slot.free));
      unitsEl.appendChild(wrap);
    } else {
      const def = data.itemsById[slot.defId];
      if (!def) return;
      wrap.classList.add('sslot--item');
      const c = itemCard(def);
      c.dataset.src = `item:${i}`;
      c.dataset.tut = 'shop-item';
      wrap.appendChild(c);
      wrap.appendChild(priceTag(slot.price, affordable));
      itemsEl.appendChild(wrap);
    }
    if (slot.frozen) wrap.insertAdjacentHTML('beforeend', `<img class="frost" src="${ui('freeze')}" alt="冻结">`);
  });
  unitsEl.dataset.count = String(nUnits);
  if (!nUnits) unitsEl.innerHTML = '<div class="shop-empty">买空了！可以刷新看看</div>';
}
