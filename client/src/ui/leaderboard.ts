// 排行榜：全服 / 好友房 / 今日。
import type { GameData } from '@juanwang/shared';
import { api, todayCN, type LbEntry } from '../net';
import { settings } from '../store';
import { openModal } from './modal';
import { esc, miniAvatar } from './cards';
import { ui } from '../assets';

type Tab = 'all' | 'room' | 'today';

export function openLeaderboard(data: GameData, initial: Tab = 'all'): void {
  const body = document.createElement('div');
  body.className = 'lb';
  const tabs = document.createElement('div');
  tabs.className = 'tabs';
  const list = document.createElement('div');
  list.className = 'lb-list';
  const defs: [Tab, string][] = [
    ['all', '全服'],
    ['room', settings.room ? `好友房 ${settings.room}` : '好友房'],
    ['today', '今日'],
  ];
  let cur: Tab = initial;
  let token = 0;
  const render = async (): Promise<void> => {
    const my = ++token;
    tabs.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.tab === cur));
    if (cur === 'room' && !settings.room) {
      list.innerHTML = '<div class="lb-empty">还没加入好友房。<br>回首页点「好友房」输入或生成房间码。</div>';
      return;
    }
    list.innerHTML = '<div class="lb-empty">加载中…</div>';
    const res = await api.leaderboard(cur === 'room' ? { room: settings.room } : cur === 'today' ? { date: todayCN() } : {});
    if (my !== token) return;
    if (!res) {
      list.innerHTML = '<div class="lb-empty">离线模式：连不上服务器，榜单暂时看不到。<br>游戏照常可玩～</div>';
      return;
    }
    if (!res.entries.length) {
      list.innerHTML = '<div class="lb-empty">还没有人上榜，快去打一局！</div>';
      return;
    }
    list.innerHTML = res.entries.map((e) => row(data, e)).join('');
  };
  for (const [t, name] of defs) {
    const b = document.createElement('button');
    b.className = 'tab';
    b.dataset.tab = t;
    b.textContent = name;
    b.onclick = () => {
      cur = t;
      void render();
    };
    tabs.appendChild(b);
  }
  body.append(tabs, list);
  openModal({ title: '排行榜', body, cls: 'modal--tall' });
  void render();
}

function row(data: GameData, e: LbEntry): string {
  const best = typeof e.bestUnit === 'string' ? e.bestUnit : e.bestUnit?.defId;
  const me = e.name === settings.name;
  return `<div class="lb-row${me ? ' is-me' : ''}${e.rank <= 3 ? ` top${e.rank}` : ''}">
    <span class="lb-rank">${e.rank}</span>
    ${best ? miniAvatar(data, best) : '<span class="mini-ava"></span>'}
    <span class="lb-name">${esc(e.name)}${e.won ? ' <b class="lb-crown">登顶</b>' : ''}</span>
    <span class="lb-score"><img src="${ui('fire')}" alt="">${e.trophies}</span>
    <span class="lb-turns">${e.turns} 回合</span>
  </div>`;
}
