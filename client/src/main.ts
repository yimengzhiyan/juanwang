// 入口：手机壳布局、加载页、场景注册、?seed= 分享链接、?debug 调试钩子。
import './style.css';
import gsap from 'gsap';
import type { ShopActionInput } from '@juanwang/shared';
import { getGameData } from './gameData';
import { assetUrl, preload } from './assets';
import { app, act, currentScene, go, goRun, registerScene, setRun, setSceneRoot, settings, startRun, type RunMode } from './store';
import { mountAnims } from './fx/anims';
import { particles } from './fx/particles';
import { mountModals, closeAllModals } from './ui/modal';
import { mountToast } from './ui/toast';
import { homeScene } from './scenes/home';
import { gameScene, pendingExtra } from './scenes/game';
import { battleCtl, battleScene } from './scenes/battle';
import { overScene } from './scenes/over';
import { arenaScene } from './scenes/arena';
import { resultCtl } from './scenes/result';
import { mountLobbyDock } from './ui/lobby';
import { setCardData } from './ui/cards';
import { api, isOnline, onOnlineChange } from './net';

gsap.config({ nullTargetWarn: false });
const root = document.getElementById('app')!;
root.innerHTML = `
  <div class="stage">
    <div class="deco deco--l"><i class="chip-a"></i><i class="chip-b"></i><i class="chip-c"></i></div>
    <div class="deco deco--r"><i class="chip-d"></i><i class="chip-e"></i><div class="deco-card"><b>卷王自走棋</b><span>手机竖屏体验最佳<br>拖拽或点选都能操作</span></div></div>
    <div class="shell" id="shell"><div class="scenes"></div></div>
  </div>`;
const shell = document.getElementById('shell')!;
setSceneRoot(shell.querySelector('.scenes') as HTMLElement);
particles.mount(shell);
mountAnims(shell);
mountModals(shell);
mountToast(shell);

onOnlineChange(() => document.body.classList.toggle('is-offline', !isOnline()));
registerScene('home', homeScene);
registerScene('arena', arenaScene);
registerScene('game', gameScene);
registerScene('battle', battleScene);
registerScene('over', overScene);
registerScene('loading', () => {
  const el = document.createElement('div');
  el.innerHTML = `<img class="load-logo" src="${assetUrl('logo.svg')}" alt="卷王自走棋"><div class="load-bar"><i></i></div><div class="load-text">正在加载素材…</div>`;
  return { el };
});

async function boot(): Promise<void> {
  go('loading');
  const bar = shell.querySelector('.load-bar i') as HTMLElement;
  const text = shell.querySelector('.load-text') as HTMLElement;
  try {
    app.data = getGameData();
    setCardData(app.data);
    mountLobbyDock(shell.parentElement!, app.data);
  } catch (e) {
    text.textContent = `内容数据出错：${(e as Error).message}`;
    console.warn(e);
    return;
  }
  void api.ping();
  await preload(app.data, (p) => {
    bar.style.width = `${Math.round(p * 100)}%`;
    text.textContent = `正在加载素材… ${Math.round(p * 100)}%`;
  });
  await new Promise((r) => setTimeout(r, 150));
  const params = new URLSearchParams(location.search);
  const seed = params.get('seed');
  if (seed) {
    startRun(seed.slice(0, 64), seed.startsWith('daily-') ? 'daily' : 'shared');
    history.replaceState(null, '', location.pathname + (params.has('debug') ? '?debug' : ''));
    goRun();
  } else if (!settings.tutorialDone && !params.has('notut')) {
    startRun('tutorial', 'tutorial');
    goRun();
  } else go('home');
}

// 调试 / 自动化钩子
if (new URLSearchParams(location.search).has('debug')) {
  const jw = {
    get state() {
      return app.run;
    },
    get data() {
      return app.data;
    },
    get scene() {
      return currentScene();
    },
    get playing() {
      return battleCtl.playing;
    },
    settings,
    dispatch(a: ShopActionInput) {
      if (!app.run) throw new Error('no run');
      if (a.type === 'continue') {
        const s = app.run;
        if (s.lastSurprise && s.surprisePending) pendingExtra.s = s.lastSurprise;
        const n = act(a);
        if (!n.error) {
          closeAllModals();
          goRun();
        }
        return n;
      }
      if (a.type === 'choosePveReward') {
        resultCtl.pick(a.index);
        closeAllModals();
        return app.run;
      }
      const n = act(a);
      if (n.phase === 'battle' && currentScene() !== 'battle') go('battle');
      if (a.type === 'chooseArena' && !n.error) go('game');
      return n;
    },
    start(seed: string, mode: RunMode = 'normal') {
      startRun(seed, mode);
      closeAllModals();
      goRun();
    },
    get bigShown() {
      return battleCtl.bigShown;
    },
    go,
    setRun,
    skip: () => battleCtl.skip(),
    speed: (n: number) => battleCtl.speed(n),
    gsap,
  };
  (window as unknown as { __jw: typeof jw }).__jw = jw;
}

void boot();
