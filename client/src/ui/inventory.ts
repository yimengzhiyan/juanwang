// 装备仓库条（队伍与商店之间）：6 格，空格虚线；装备格 data-src="inv:i"，整条 data-drop="inv"。
import { INVENTORY_SIZE, type GameData, type RunState } from '@juanwang/shared';
import { assetUrl } from '../assets';
import { esc } from './cards';

export function inventoryBar(): { el: HTMLElement; cells: HTMLElement; count: HTMLElement } {
  const el = document.createElement('section');
  el.className = 'inv-bar';
  el.dataset.drop = 'inv';
  el.dataset.tut = 'inventory';
  el.innerHTML = '<div class="inv-label"><b>仓库</b><small class="inv-count"></small></div><div class="inv-cells"></div>';
  return { el, cells: el.querySelector('.inv-cells') as HTMLElement, count: el.querySelector('.inv-count') as HTMLElement };
}

export function renderInventory(bar: { el: HTMLElement; cells: HTMLElement; count: HTMLElement }, s: RunState, data: GameData): void {
  const inv = s.inventory ?? [];
  bar.count.textContent = `${inv.length}/${INVENTORY_SIZE}`;
  bar.el.classList.toggle('is-full', inv.length >= INVENTORY_SIZE);
  let html = '';
  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const e = inv[i];
    const def = e ? data.equipsById[e.defId] : undefined;
    if (!e || !def) {
      html += '<i class="inv-cell is-empty"></i>';
      continue;
    }
    html += `<div class="inv-cell is-on${e.gold ? ' is-gold' : ''}${e.fresh ? ' is-fresh' : ''}" data-src="inv:${i}" data-equip="${def.id}" data-slot="${def.slot}" title="${esc(`${e.gold ? '金·' : ''}${def.name}`)}"><img src="${assetUrl(def.icon)}" alt="${esc(def.name)}" draggable="false">${e.fresh ? '<em>新</em>' : ''}</div>`;
  }
  bar.cells.innerHTML = html;
}
