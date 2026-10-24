// 赛场胶囊：对局页"我的队伍"行常显（图标 + 名字 + 规则一句话；窄屏只显示名字，点开看完整规则）；战斗页顶栏显示名字。
import type { GameData, RunState } from '@juanwang/shared';
import { arenaArt, arenaHints, arenaText } from '../scenes/arena';
import { esc, synIconHtml, synName } from './cards';
import { toast } from './toast';

export interface ArenaPill {
  el: HTMLElement;
  update: (s: RunState) => void;
  close: () => void;
  destroy: () => void;
}

const icon = (data: GameData, id: string): string => {
  const a = data.arenasById[id];
  const art = a ? arenaArt(a) : null;
  return art ? `<img class="arp-ico" src="${art}" alt="">` : '<i class="arp-ico arp-ico--none"></i>';
};

export function arenaPill(data: GameData): ArenaPill {
  const el = document.createElement('div');
  el.className = 'arp';
  el.innerHTML = '<button class="arp-btn" aria-label="本局赛场规则" aria-expanded="false"></button><div class="arp-pop" hidden></div>';
  const btn = el.querySelector('.arp-btn') as HTMLButtonElement;
  const pop = el.querySelector('.arp-pop') as HTMLElement;
  let cur = '';
  const setOpen = (on: boolean): void => {
    el.classList.toggle('is-open', on);
    pop.hidden = !on;
    btn.setAttribute('aria-expanded', String(on));
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    setOpen(pop.hidden);
  };
  const onDoc = (e: Event): void => {
    if (!el.contains(e.target as Node)) setOpen(false);
  };
  document.addEventListener('pointerdown', onDoc, true);
  return {
    el,
    update(s) {
      const a = s.arena ? data.arenasById[s.arena] : undefined;
      el.style.display = a ? '' : 'none';
      if (!a || cur === a.id) return;
      cur = a.id;
      const [rule, flavor] = arenaText(a);
      btn.innerHTML = `${icon(data, a.id)}<b class="arp-name">${esc(a.name)}</b><span class="arp-rule">${esc(rule)}</span><i class="arp-caret"></i>`;
      const hints = arenaHints(a);
      pop.innerHTML = `<div class="arp-pop-head">${icon(data, a.id)}<b>赛场 · ${esc(a.name)}</b><small>整局生效</small></div><p class="arp-pop-rule">${esc(rule)}</p>${flavor ? `<p class="arp-pop-flavor">${esc(flavor)}</p>` : ''}${hints.length ? `<div class="arp-pop-hints">推荐：${hints.map((k) => `<span class="ar-hint">${synIconHtml(k)}${esc(synName(k))}</span>`).join('')}</div>` : ''}`;
    },
    close: () => setOpen(false),
    destroy: () => document.removeEventListener('pointerdown', onDoc, true),
  };
}

/** 战斗页顶部（对手名旁）的赛场名字（点一下 toast 规则） */
export function arenaHudChip(data: GameData, s: RunState): HTMLElement | null {
  const a = s.arena ? data.arenasById[s.arena] : undefined;
  if (!a) return null;
  const el = document.createElement('button');
  el.className = 'hud-arena';
  el.setAttribute('aria-label', `赛场：${a.name}`);
  el.innerHTML = `${icon(data, a.id)}<b>${esc(a.name)}</b>`;
  el.onclick = () => toast(`赛场「${a.name}」：${arenaText(a)[0]}`, 'info');
  return el;
}
