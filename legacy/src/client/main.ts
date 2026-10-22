// 客户端入口：加载页 → 素材预加载 → 连接服务器 → 场景切换（Lobby → Room → Game）。
import './style.css';
import { Application } from 'pixi.js';
import gsap from 'gsap';
import type { GameState, S2C } from '@dafuweng/shared';
import { loadAssets } from './assets';
import { net } from './net';
import { GameScene } from './scenes/game';
import { LobbyScene } from './scenes/lobby';
import { RoomScene } from './scenes/room';
import { store } from './store';
import { h, toast } from './util';

type Scene = { kind: 'lobby'; s: LobbyScene } | { kind: 'room'; s: RoomScene } | { kind: 'game'; s: GameScene } | null;

let app: Application;
let scene: Scene = null;
let welcomed = false;
let roomSinceWelcome = false;
let lobbyTimer: ReturnType<typeof setTimeout> | null = null;

function setScene(next: Scene): void {
  if (scene) scene.s.destroy();
  scene = next;
  document.body.dataset.scene = next?.kind ?? '';
}

function showLobby(): void {
  if (scene?.kind === 'lobby') return;
  setScene({ kind: 'lobby', s: new LobbyScene() });
}

/** 根据当前 room / game 状态决定场景 */
function route(): void {
  const room = store.room;
  if (!room) {
    showLobby();
    return;
  }
  if (room.status === 'lobby') {
    if (scene?.kind !== 'room') setScene({ kind: 'room', s: new RoomScene() });
    (scene as { s: RoomScene }).s.update(room);
    return;
  }
  // playing / ended：等 game 快照到达再进对局
  if (store.game && scene?.kind !== 'game') setScene({ kind: 'game', s: new GameScene(app) });
}

function onGame(msg: Extract<S2C, { t: 'game' }>): void {
  store.clockOffset = msg.serverTime - Date.now();
  if (scene?.kind === 'game' && scene.s.isNewGame(msg.state)) setScene(null);
  store.game = msg.state as GameState;
  if (!store.room || store.room.status === 'lobby') {
    // 极少数情况下 game 先于 room 到达：仍然进入对局
    if (scene?.kind !== 'game') setScene({ kind: 'game', s: new GameScene(app) });
  } else route();
  if (scene?.kind === 'game') scene.s.push({ state: msg.state, events: msg.events, serverTime: msg.serverTime });
}

function connectionBanner(): void {
  const el = h('div.net-banner', { hidden: true });
  document.body.append(el);
  net.onStatus((s) => {
    if (s === 'open' || s === 'connecting') {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    el.innerHTML = '';
    if (s === 'kicked') {
      el.append('你在另一个窗口打开了游戏 ', h('button.btn.btn--sm.btn--primary', { type: 'button', onclick: () => net.connect() }, '在这里继续'));
    } else el.append(h('i.spinner'), '网络断开，正在重新连接…');
  });
}

// 动画按真实时间推进（掉帧时不“放慢时间”），保证事件队列节奏与服务端估算一致
gsap.ticker.lagSmoothing(0);

async function boot(): Promise<void> {
  const loading = h(
    'div.loading',
    null,
    h('img.loading-logo', { src: '/assets/logo.svg', alt: '大玩家' }),
    h('div.loading-bar', null, h('i')),
    h('p.loading-text', null, '加载素材中…'),
  );
  document.getElementById('app')?.remove();
  document.body.append(loading);
  const fill = loading.querySelector('.loading-bar i') as HTMLElement;
  const text = loading.querySelector('.loading-text') as HTMLElement;

  app = new Application();
  await app.init({
    resizeTo: window,
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  });
  app.canvas.classList.add('pixi-canvas');
  app.canvas.style.visibility = 'hidden';
  document.body.prepend(app.canvas);

  try {
    await loadAssets((p) => (fill.style.transform = `scaleX(${p})`));
  } catch (e) {
    text.textContent = '素材加载失败，请刷新重试';
    throw e;
  }
  text.textContent = '连接服务器…';

  net.on('welcome', (m) => {
    store.myId = m.playerId;
    store.data = { characters: m.characters, board: m.board, items: m.items, diceSkins: m.diceSkins };
    store.clockOffset = m.serverTime - Date.now();
    if (!welcomed) {
      welcomed = true;
      loading.classList.add('hide');
      setTimeout(() => loading.remove(), 400);
    }
    // 重连：服务端若还记得我们在房间里，会紧接着推送 room / game；否则显示大厅
    if (lobbyTimer) clearTimeout(lobbyTimer);
    roomSinceWelcome = false;
    lobbyTimer = setTimeout(() => {
      if (roomSinceWelcome) return;
      store.room = null;
      store.game = null;
      route();
    }, 600);
  });
  net.on('room', (m) => {
    roomSinceWelcome = true;
    store.room = m.room;
    if (m.room.status === 'lobby') store.game = null;
    route();
  });
  net.on('game', onGame);
  net.on('left', () => {
    store.room = null;
    store.game = null;
    // 去掉 ?room=，避免回到大厅时又自动填码
    if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
    route();
  });
  net.on('error', (m) => toast(m.msg, 'error'));
  net.on('chat', (m) => {
    if (scene?.kind === 'game') scene.s.onChat(m.from, m.name, m.text);
    else toast(`${m.name}：${m.text}`);
  });
  net.on('toast', (m) => toast(m.text, m.kind === 'warn' ? 'error' : 'info', 2500));
  connectionBanner();
  net.connect();

  // 调试钩子（自动化测试用）：仅开发模式或 URL 带 ?debug 时挂载
  if (import.meta.env.DEV || /[?&]debug\b/.test(location.search)) {
    (window as unknown as { __dfw: unknown }).__dfw = { net, store, app, scene: () => scene };
  }
}

void boot();
