// 图鉴：35 单位按阶级分组，见过的点亮，点开看技能与台词。
import type { GameData } from '@juanwang/shared';
import { settings } from '../store';
import { openModal, showUnitDetail } from './modal';
import { unitCard } from './cards';

export function openCodex(data: GameData): void {
  const body = document.createElement('div');
  body.className = 'codex';
  const total = data.units.length;
  const seen = data.units.filter((u) => settings.seen.has(u.id)).length;
  const head = document.createElement('div');
  head.className = 'codex-head';
  head.textContent = `已收集 ${seen} / ${total}`;
  body.appendChild(head);
  const groups: [string, typeof data.units][] = [];
  for (let t = 1; t <= 6; t++) groups.push([`T${t}`, data.units.filter((u) => u.tier === t && !u.token)]);
  groups.push(['召唤物', data.units.filter((u) => u.token)]);
  for (const [name, list] of groups) {
    if (!list.length) continue;
    const sec = document.createElement('section');
    sec.className = 'codex-sec';
    sec.innerHTML = `<h3 class="codex-tier">${name}</h3>`;
    const grid = document.createElement('div');
    grid.className = 'codex-grid';
    for (const def of list) {
      const known = settings.seen.has(def.id);
      const cell = document.createElement('button');
      cell.className = `codex-cell${known ? '' : ' is-unknown'}`;
      cell.appendChild(unitCard(def, { atk: def.atk, hp: def.hp, level: 1 }));
      if (!known) cell.insertAdjacentHTML('beforeend', '<span class="codex-q">?</span>');
      cell.onclick = () => showUnitDetail(data, def.id);
      grid.appendChild(cell);
    }
    sec.appendChild(grid);
    body.appendChild(sec);
  }
  openModal({ title: '图鉴', body, cls: 'modal--tall' });
}
