// 图鉴：单位（按阵营/职业筛选，阶级分组，见过的点亮）/ 装备 / 赛场 三个页签。
import { EQUIP_SLOTS, FACTIONS, ROLES, type GameData } from '@juanwang/shared';
import { settings } from '../store';
import { assetUrl } from '../assets';
import { openModal, showItemDetail, showUnitDetail } from './modal';
import { esc, SLOT_NAME, synIcon, synName, unitCard } from './cards';
import { arenaArt, arenaHints, arenaText } from '../scenes/arena';

type Tab = 'units' | 'equips' | 'arenas';

export function openCodex(data: GameData): void {
  const body = document.createElement('div');
  body.className = 'codex';
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const filters = document.createElement('div');
  filters.className = 'codex-filters';
  const list = document.createElement('div');
  list.className = 'codex-list';
  body.append(tabs, filters, list);
  let tab: Tab = 'units';
  let filter: string | null = null;

  const renderUnits = (): void => {
    const pool = data.units.filter((u) => !filter || u.faction === filter || u.role === filter);
    const real = data.units.filter((u) => !u.token);
    const seen = real.filter((u) => settings.seen.has(u.id)).length;
    list.innerHTML = `<div class="codex-head">已收集 ${seen} / ${real.length}${filter ? ` · 筛选：${esc(synName(filter))}` : ''}</div>`;
    const groups: [string, typeof data.units][] = [];
    for (let t = 1; t <= 6; t++) groups.push([`T${t}`, pool.filter((u) => u.tier === t && !u.token)]);
    if (!filter) groups.push(['召唤物 / 怪物', pool.filter((u) => u.token)]);
    for (const [name, units] of groups) {
      if (!units.length) continue;
      const sec = document.createElement('section');
      sec.className = 'codex-sec';
      sec.innerHTML = `<h3 class="codex-tier">${name}</h3>`;
      const grid = document.createElement('div');
      grid.className = 'codex-grid';
      for (const def of units) {
        const known = settings.seen.has(def.id);
        const cell = document.createElement('button');
        cell.className = `codex-cell${known ? '' : ' is-unknown'}`;
        cell.appendChild(unitCard(def, { atk: def.atk, hp: def.hp, level: 1 }, { noEquips: true }));
        if (!known) cell.insertAdjacentHTML('beforeend', '<span class="codex-q">?</span>');
        cell.onclick = () => showUnitDetail(data, def.id);
        grid.appendChild(cell);
      }
      sec.appendChild(grid);
      list.appendChild(sec);
    }
    if (!list.querySelector('.codex-sec')) list.insertAdjacentHTML('beforeend', '<div class="lb-empty">这条流派线还没有单位</div>');
  };

  const renderEquips = (): void => {
    list.innerHTML = '<div class="codex-head">同名两件合成金色版 · 卖单位时每件折算 1 算力</div>';
    for (const slot of EQUIP_SLOTS) {
      const sec = document.createElement('section');
      sec.className = 'codex-sec';
      sec.innerHTML = `<h3 class="codex-tier"><img class="codex-slot" src="${assetUrl(`ui/slot_${slot}.svg`)}" alt="">${SLOT_NAME[slot]}</h3>`;
      for (const d of data.equips.filter((e) => e.slot === slot)) {
        const row = document.createElement('button');
        row.className = 'codex-eq';
        row.innerHTML = `<img src="${assetUrl(d.icon)}" alt=""><div><b>${esc(d.name)}</b><span>${esc(d.desc)}</span><em>${esc(d.goldDesc)}</em></div><small>${d.price} 算力</small>`;
        row.onclick = () => showItemDetail(data, 'equip', d.id);
        sec.appendChild(row);
      }
      list.appendChild(sec);
    }
    const sec = document.createElement('section');
    sec.className = 'codex-sec';
    sec.innerHTML = '<h3 class="codex-tier">消耗品</h3>';
    for (const d of data.consumables) {
      const row = document.createElement('button');
      row.className = 'codex-eq';
      row.innerHTML = `<img src="${assetUrl(d.icon)}" alt=""><div><b>${esc(d.name)}</b><span>${esc(d.desc)}</span></div><small>${d.price} 算力</small>`;
      row.onclick = () => showItemDetail(data, 'consumable', d.id);
      sec.appendChild(row);
    }
    list.appendChild(sec);
  };

  const renderArenas = (): void => {
    list.innerHTML = '<div class="codex-head">开局三选一，整局生效</div>';
    const grid = document.createElement('div');
    grid.className = 'codex-arenas';
    for (const a of data.arenas) {
      const art = arenaArt(a);
      const [rule, flavor] = arenaText(a);
      const c = document.createElement('div');
      c.className = 'codex-arena';
      c.innerHTML = `<div class="ar-art">${art ? `<img src="${art}" alt="">` : ''}</div><div class="ca-body"><b>${esc(a.name)}</b><span>${esc(rule)}</span>${flavor ? `<small>${esc(flavor)}</small>` : ''}<span class="ar-hints">${arenaHints(a)
        .map((k) => `<span class="ar-hint"><img src="${synIcon(k)}" alt="">${esc(synName(k))}</span>`)
        .join('')}</span></div>`;
      grid.appendChild(c);
    }
    list.appendChild(grid);
  };

  const renderFilters = (): void => {
    filters.innerHTML = '';
    filters.style.display = tab === 'units' ? '' : 'none';
    if (tab !== 'units') return;
    const mk = (key: string | null, label: string, icon?: string): void => {
      const b = document.createElement('button');
      b.className = `cf${filter === key ? ' on' : ''}`;
      b.innerHTML = `${icon ? `<img src="${icon}" alt="">` : ''}${esc(label)}`;
      b.onclick = () => {
        filter = key;
        render();
      };
      filters.appendChild(b);
    };
    mk(null, '全部');
    for (const k of [...FACTIONS, ...ROLES]) mk(k, synName(k), synIcon(k));
  };

  const render = (): void => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    renderFilters();
    if (tab === 'units') renderUnits();
    else if (tab === 'equips') renderEquips();
    else renderArenas();
    list.scrollTop = 0;
  };
  for (const [t, name] of [['units', '单位'], ['equips', '装备'], ['arenas', '赛场']] as [Tab, string][]) {
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.tab = t;
    b.textContent = name;
    b.onclick = () => {
      tab = t;
      render();
    };
    tabs.appendChild(b);
  }
  render();
  openModal({ title: '图鉴', body, cls: 'modal--tall' });
}
