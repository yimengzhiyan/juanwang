// 图鉴：4 阵营页签（顶部各档效果（门槛取引擎 FACTION_THRESHOLDS） + 该阵营全部单位大卡）/ 打法（6 个子页签，顶部 2/4 档效果来自 ROLE_META）/ 装备 / 赛场。对局中打开时标出当前羁绊人数。
import {
  EQUIP_SLOTS, FACTIONS, FACTION_THRESHOLDS, ROLES, ROLE_META, SYNERGY_DESCS, computeSynergies, stateBonus,
  type GameData, type Role, type RunState, type SynergyKey, type UnitDef,
} from '@juanwang/shared';
import { settings } from '../store';
import { assetUrl } from '../assets';
import { openModal, showItemDetail, showUnitDetail } from './modal';
import { equipShort, esc, SLOT_NAME, SYN_COLOR, synIcon, synIconHtml, synName, tierShield, unitCard } from './cards';
import { arenaArt, arenaHints, arenaText } from '../scenes/arena';

type Tab = 'open' | 'closed' | 'compute' | 'folk' | 'roles' | 'equips' | 'arenas';

export function openCodex(data: GameData, run?: RunState | null): void {
  const body = document.createElement('div');
  body.className = 'codex';
  const tabs = document.createElement('div');
  tabs.className = 'tabs codex-tabs';
  const list = document.createElement('div');
  list.className = 'codex-list';
  body.append(tabs, list);
  const counts = new Map<string, number>();
  if (run) for (const st of computeSynergies(run.team, data, stateBonus(run, data))) counts.set(st.key, st.count);
  let tab: Tab = 'open';
  if (run) {
    const best = FACTIONS.map((f) => [f, counts.get(f) ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) tab = best[0];
  }

  /** 某条羁绊的档位说明（打法线取 ROLE_META：门槛 2/4、各档效果、一句话定位） */
  const tiersHtml = (key: SynergyKey): string => {
    const meta = (ROLES as readonly string[]).includes(key) ? ROLE_META[key as Role] : undefined;
    const th: readonly number[] = meta ? meta.thresholds : FACTION_THRESHOLDS;
    const n = counts.get(key) ?? 0;
    const descs: readonly string[] = meta ? meta.descs : (SYNERGY_DESCS[key] ?? []);
    return `<div class="cx-syn" style="--sc:${SYN_COLOR[key]}">
      <div class="cx-syn-head">${synIconHtml(key)}<b>${esc(meta?.name ?? synName(key))}</b>${meta ? `<em>${esc(meta.tagline)}</em>` : ''}${run ? `<span>当前 ${n} 个</span>` : ''}</div>
      <ul>${th.map((t, i) => `<li class="${run && n >= t ? 'on' : ''}">${tierShield(i + 1, 'tier-shield sm')}<b>${t} 个</b><span>${esc(descs[i] ?? '')}</span></li>`).join('')}</ul>
    </div>`;
  };

  const unitGrid = (units: UnitDef[]): HTMLElement => {
    const grid = document.createElement('div');
    grid.className = 'codex-grid';
    for (const def of units) {
      const known = settings.seen.has(def.id);
      const cell = document.createElement('button');
      cell.className = `codex-cell${known ? '' : ' is-unknown'}`;
      cell.appendChild(unitCard(def, { atk: def.atk, hp: def.hp, level: 1 }, { variant: 'big', full: true }));
      if (!known) cell.insertAdjacentHTML('beforeend', '<span class="codex-new">未遇到</span>');
      cell.onclick = () => showUnitDetail(data, def.id);
      grid.appendChild(cell);
    }
    return grid;
  };

  const renderFaction = (f: SynergyKey): void => {
    list.innerHTML = tiersHtml(f);
    const pool = data.units.filter((u) => u.faction === f);
    for (let t = 1; t <= 6; t++) {
      const units = pool.filter((u) => u.tier === t && !u.token);
      if (!units.length) continue;
      const sec = document.createElement('section');
      sec.className = 'codex-sec';
      sec.innerHTML = `<h3 class="codex-tier">T${t}</h3>`;
      sec.appendChild(unitGrid(units));
      list.appendChild(sec);
    }
    const tokens = pool.filter((u) => u.token);
    if (tokens.length) {
      const sec = document.createElement('section');
      sec.className = 'codex-sec';
      sec.innerHTML = '<h3 class="codex-tier">召唤物 / 怪物</h3>';
      sec.appendChild(unitGrid(tokens));
      list.appendChild(sec);
    }
  };

  /** 打法页：6 个子页签（多刀/护盾/召唤/自爆/成长/经济），每页顶部 2/4 档效果 + 该打法全部单位 */
  let role: Role = ROLES[0];
  if (run) {
    const best = ROLES.map((r) => [r, counts.get(r) ?? 0] as const).sort((a, b) => b[1] - a[1])[0];
    if (best && best[1] > 0) role = best[0];
  }
  const renderRoles = (): void => {
    list.innerHTML = '';
    const sub = document.createElement('div');
    sub.className = 'cx-subtabs';
    for (const r of ROLES) {
      const b = document.createElement('button');
      b.className = `cx-subtab${r === role ? ' on' : ''}`;
      b.dataset.role = r;
      b.style.setProperty('--sc', SYN_COLOR[r] ?? '#9B6BFF');
      const n = counts.get(r) ?? 0;
      b.innerHTML = `${synIconHtml(r)}<span>${esc(ROLE_META[r]?.name ?? synName(r))}</span>${run && n ? `<b>${n}</b>` : ''}`;
      b.onclick = () => {
        role = r;
        renderRoles();
      };
      sub.appendChild(b);
    }
    list.appendChild(sub);
    list.insertAdjacentHTML('beforeend', tiersHtml(role));
    const pool = data.units.filter((u) => u.role === role && !u.token).sort((a, b) => a.tier - b.tier);
    if (!pool.length) list.insertAdjacentHTML('beforeend', '<div class="codex-head">暂时没有这个打法的单位</div>');
    for (let t = 1; t <= 6; t++) {
      const units = pool.filter((u) => u.tier === t);
      if (!units.length) continue;
      const sec = document.createElement('section');
      sec.className = 'codex-sec';
      sec.innerHTML = `<h3 class="codex-tier">T${t}</h3>`;
      sec.appendChild(unitGrid(units));
      list.appendChild(sec);
    }
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
        row.innerHTML = `<img src="${assetUrl(d.icon)}" alt=""><div><b>${esc(d.name)} <i>${esc(equipShort(d))}</i></b><span>${esc(d.desc)}</span><em>${esc(d.goldDesc)}</em></div><small>${d.price} 算力</small>`;
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
        .map((k) => `<span class="ar-hint">${synIconHtml(k)}${esc(synName(k))}</span>`)
        .join('')}</span></div>`;
      grid.appendChild(c);
    }
    list.appendChild(grid);
  };

  const render = (): void => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'roles') renderRoles();
    else if (tab === 'equips') renderEquips();
    else if (tab === 'arenas') renderArenas();
    else renderFaction(tab);
    list.scrollTop = 0;
  };
  const defs: [Tab, string, string | null][] = [
    ...FACTIONS.map((f) => [f, synName(f), synIcon(f)] as [Tab, string, string]),
    ['roles', '打法', null],
    ['equips', '装备', null],
    ['arenas', '赛场', null],
  ];
  for (const [t, name, icon] of defs) {
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.tab = t;
    b.innerHTML = `${icon ? `<img src="${icon}" alt="">` : ''}${esc(name)}`;
    b.onclick = () => {
      tab = t;
      render();
    };
    tabs.appendChild(b);
  }
  const real = data.units.filter((u) => !u.token);
  const seen = real.filter((u) => settings.seen.has(u.id)).length;
  render();
  openModal({ title: `图鉴 ${seen}/${real.length}`, body, cls: 'modal--tall modal--codex' });
}
