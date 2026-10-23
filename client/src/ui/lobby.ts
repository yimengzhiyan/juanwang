// 8 人房侧栏（ART 9.2）：手机 = 顶栏下横排头像条；桌面 = 手机壳右侧外挂竖排。点头像看对方阵容 / 羁绊 / 装备。
import gsap from 'gsap';
import {
  START_HP, aliveCount, computeSynergies,
  type BattleEvent, type GameData, type Opponent, type RunState, type UnitInst,
} from '@juanwang/shared';
import { artUrl } from '../assets';
import { settings } from '../store';
import { archetypeKey, esc, hpColor, synergyChip, synIcon, synName } from './cards';
import { teamCard } from './team';
import { openModal } from './modal';
import { toast } from './toast';

export interface LobbyRow {
  id: string;
  name: string;
  avatar: string | null;
  hp: number;
  alive: boolean;
  place?: number;
  me: boolean;
  vs: boolean;
  arch: string | null;
  human: boolean;
  team: UnitInst[];
  lastResult?: Opponent['lastResult'];
}

/** 我 + 7 名对手，排序：我、本回合对手、存活按热度、淘汰按名次 */
export function lobbyRows(s: RunState, data: GameData): LobbyRow[] {
  const vsId = s.matchup?.kind === 'pvp' && (s.phase === 'battle' || s.phase === 'result') ? s.matchup.opponentId : null;
  const me: LobbyRow = {
    id: 'me', name: settings.name || '你', avatar: null, hp: s.hp, alive: s.phase !== 'over' || !!s.end?.won || s.hp > 0, place: s.end?.rank,
    me: true, vs: false, arch: myArch(s, data), human: true, team: s.team.filter((u): u is UnitInst => !!u),
  };
  const opp = s.opponents.map<LobbyRow>((o) => ({
    id: o.id, name: o.name, avatar: o.avatar || null, hp: o.hp, alive: o.alive, place: o.place, me: false, vs: o.id === vsId,
    arch: archetypeKey(o.archetype), human: o.isHuman, team: o.team, lastResult: o.lastResult,
  }));
  opp.sort((a, b) => Number(b.vs) - Number(a.vs) || Number(b.alive) - Number(a.alive) || (a.alive ? b.hp - a.hp : (a.place ?? 9) - (b.place ?? 9)));
  return [me, ...opp];
}

function myArch(s: RunState, data: GameData): string | null {
  const st = computeSynergies(s.team, data).filter((x) => x.tier > 0).sort((a, b) => b.tier - a.tier || b.count - a.count)[0];
  return st?.key ?? null;
}

export interface LobbyView {
  el: HTMLElement;
  update: (s: RunState) => void;
}

/** 头像条（kind = strip 手机横排 / dock 桌面竖排） */
export function lobbyView(data: GameData, kind: 'strip' | 'dock'): LobbyView {
  const el = document.createElement('div');
  el.className = `lobby lobby--${kind}`;
  el.innerHTML = `<div class="lobby-left"><small>还剩</small><b>8</b><small>人</small></div><div class="lobby-list"></div>`;
  const list = el.querySelector('.lobby-list') as HTMLElement;
  const leftNum = el.querySelector('.lobby-left b') as HTMLElement;
  const prevHp = new Map<string, number>();
  const prevAlive = new Map<string, boolean>();
  let lastRemain = -1;
  let cur: RunState | null = null;
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('.lb-item') as HTMLElement | null;
    if (!b || !cur) return;
    openOpponentSheet(cur, data, b.dataset.id!);
  });
  return {
    el,
    update(s) {
      cur = s;
      const rows = lobbyRows(s, data);
      const remain = s.phase === 'over' ? rows.filter((r) => r.alive).length : aliveCount(s);
      leftNum.textContent = String(remain);
      if (lastRemain >= 0 && remain < lastRemain) gsap.fromTo(leftNum, { scale: 1.4 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' });
      lastRemain = remain;
      list.innerHTML = '';
      for (const r of rows) {
        const item = document.createElement('button');
        item.className = `lb-item${r.me ? ' is-me' : ''}${r.vs ? ' is-vs' : ''}${r.alive ? '' : ' is-out'}`;
        item.dataset.id = r.id;
        const ava = r.me
          ? `<span class="lb-ava lb-ava--me">你</span>`
          : r.avatar
            ? `<span class="lb-ava"><img src="${artUrl(r.avatar)}" alt=""></span>`
            : `<span class="lb-ava lb-ava--txt">${esc(Array.from(r.name)[0] ?? '?')}</span>`;
        const hp = Math.max(0, r.hp);
        item.innerHTML = `
          <span class="lb-ava-wrap">${ava}${r.arch ? `<img class="lb-arch" src="${synIcon(r.arch)}" alt="">` : ''}${r.vs ? '<b class="lb-vs">VS</b>' : ''}${r.alive ? '' : '<b class="lb-x">出局</b>'}${r.human && !r.me ? '<i class="lb-human" title="真人快照"></i>' : ''}</span>
          <span class="lb-info"><span class="lb-name">${esc(r.me ? '你' : r.name)}</span><span class="lb-bar"><i style="width:${(Math.min(START_HP, hp) / START_HP) * 100}%;background:${hpColor(hp)}"></i></span><b class="lb-hp">${r.alive ? hp : r.place ? `第${r.place}` : 0}</b></span>`;
        list.appendChild(item);
        const ph = prevHp.get(r.id);
        if (ph !== undefined && hp < ph) {
          const bar = item.querySelector('.lb-bar i') as HTMLElement;
          gsap.fromTo(bar, { width: `${(Math.min(START_HP, ph) / START_HP) * 100}%` }, { width: `${(Math.min(START_HP, hp) / START_HP) * 100}%`, duration: 0.3, ease: 'power2.out' });
          const num = item.querySelector('.lb-hp') as HTMLElement;
          num.classList.add('is-flash');
          setTimeout(() => num.classList.remove('is-flash'), 450);
        }
        if (prevAlive.get(r.id) === true && !r.alive) {
          const x = item.querySelector('.lb-x');
          if (x) gsap.fromTo(x, { scale: 2.2, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.2, ease: 'power4.out' });
        }
        prevHp.set(r.id, hp);
        prevAlive.set(r.id, r.alive);
      }
    },
  };
}

// ───────────── 桌面外挂竖排（全局一个） ─────────────
let dock: LobbyView | null = null;
export function mountLobbyDock(stage: HTMLElement, data: GameData): void {
  dock = lobbyView(data, 'dock');
  dock.el.style.display = 'none';
  stage.appendChild(dock.el);
}
/** 场景调用：显示/更新桌面侧栏；传 null 隐藏 */
export function updateDock(s: RunState | null): void {
  if (!dock) return;
  dock.el.style.display = s ? '' : 'none';
  if (s) dock.update(s);
}

/** 点开头像：对方阵容（带装备）+ 羁绊档位 */
export function openOpponentSheet(s: RunState, data: GameData, id: string): void {
  const row = lobbyRows(s, data).find((r) => r.id === id);
  if (!row) return;
  const body = document.createElement('div');
  body.className = 'opp-sheet';
  const syns = computeSynergies(row.team, data);
  const status = row.alive ? `热度 ${Math.max(0, row.hp)}/${START_HP}` : `已出局 · 第 ${row.place ?? '?'} 名`;
  const last = row.lastResult === 'win' ? '上回合赢了' : row.lastResult === 'loss' ? '上回合输了' : row.lastResult === 'pve' ? '上回合打怪' : '';
  const preset = !row.me ? s.opponents.find((o) => o.id === id)?.presetId : undefined;
  const taunt = preset ? data.opponents.find((p) => p.id === preset)?.taunt?.victory : undefined;
  body.innerHTML = `
    <div class="opp-head">
      ${row.me ? '<span class="lb-ava lb-ava--me big">你</span>' : row.avatar ? `<span class="lb-ava big"><img src="${artUrl(row.avatar)}" alt=""></span>` : `<span class="lb-ava lb-ava--txt big">${esc(Array.from(row.name)[0] ?? '?')}</span>`}
      <div class="opp-meta">
        <b class="opp-name">${esc(row.me ? `${settings.name}（你）` : row.name)}</b>
        <span class="opp-tags">${row.arch ? `<span class="chip chip--xs"><img src="${synIcon(row.arch)}" alt="">${esc(synName(row.arch))}流</span>` : '<span class="chip chip--xs">杂牌军</span>'}${row.me ? '' : `<span class="chip chip--xs">${row.human ? '真人快照' : 'AI 对手'}</span>`}${last ? `<span class="chip chip--xs">${last}</span>` : ''}</span>
        <span class="opp-hp"><span class="lb-bar wide"><i style="width:${(Math.min(START_HP, Math.max(0, row.hp)) / START_HP) * 100}%;background:${hpColor(row.hp)}"></i></span>${status}</span>
      </div>
    </div>
    ${taunt ? `<div class="opp-taunt">“${esc(taunt)}”</div>` : ''}
    <div class="opp-team"></div>
    <div class="opp-syn"></div>`;
  const teamEl = body.querySelector('.opp-team') as HTMLElement;
  if (!row.team.length) teamEl.innerHTML = '<div class="opp-empty">还没有阵容情报</div>';
  for (const u of row.team.slice(0, 7)) {
    if (!data.unitsById[u.defId]) continue;
    const w = document.createElement('div');
    w.className = 'opp-card';
    w.appendChild(teamCard(u, row.team, data, 0, undefined, !row.me));
    teamEl.appendChild(w);
  }
  const synEl = body.querySelector('.opp-syn') as HTMLElement;
  const act = syns.filter((x) => x.tier > 0);
  if (!act.length) synEl.innerHTML = '<span class="opp-empty">没有点亮羁绊</span>';
  for (const st of act) {
    const chip = synergyChip(st);
    chip.onclick = () => toast(`${st.name} ${st.count} 个：${st.descs.slice(0, st.tier).join('；')}`, 'info', 2600);
    synEl.appendChild(chip);
  }
  openModal({ body, cls: 'modal--sheet' });
}

/** "还剩 N 人"横幅（有人淘汰时弹出，附被淘汰者的台词） */
export function remainingBanner(host: HTMLElement, events: BattleEvent[], s: RunState, data: GameData): Promise<void> {
  const elim = events.filter((e): e is Extract<BattleEvent, { type: 'eliminated' }> => e.type === 'eliminated' && e.who !== 'me');
  if (!elim.length) return Promise.resolve();
  const remain = Math.min(...elim.map((e) => e.remaining));
  const b = document.createElement('div');
  b.className = 'remain-banner';
  const lines = elim
    .map((e) => {
      const o = s.opponents.find((x) => x.id === e.who);
      const t = o?.presetId ? data.opponents.find((p) => p.id === o.presetId)?.taunt?.defeated : undefined;
      return `<div class="rb-row">${o?.avatar ? `<span class="lb-ava sm"><img src="${artUrl(o.avatar)}" alt=""></span>` : ''}<span><b>${esc(e.name)}</b> 出局 · 第 ${e.place} 名${t ? `<em>“${esc(t)}”</em>` : ''}</span></div>`;
    })
    .join('');
  b.innerHTML = `<div class="rb-title">还剩 <b>${remain}</b> 人</div>${lines}`;
  host.appendChild(b);
  return new Promise((res) => {
    gsap
      .timeline({ onComplete: () => { b.remove(); res(); } })
      .fromTo(b, { y: -40, opacity: 0, scale: 0.8 }, { y: 0, opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(2.5)' })
      .fromTo(b.querySelector('.rb-title b'), { scale: 1.4 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, 0.15)
      .to(b, { y: -30, opacity: 0, duration: 0.25 }, '+=1.9');
    b.onclick = () => { b.remove(); res(); };
  });
}
