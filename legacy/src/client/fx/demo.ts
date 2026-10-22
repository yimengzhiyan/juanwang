// ?fxdemo 调试面板：页面左下角一排小按钮，逐个触发每个特效（用当前对局的玩家 / 格子做参数），显示实际耗时。
// 仅在 URL 带 ?fxdemo 时由 fx.init() 动态加载；也暴露 window.__fxdemo.run(name) 供自动化截图脚本调用。
import gsap from 'gsap';
import type { Card } from '@dafuweng/shared';
import { store } from '../store';
import type { FxContext } from './context';
import type { Fx } from './index';
import { downgradeCtx } from './build';
import { playJailExit } from './overlay';

const CHANCE: Card = { id: 'demo_c', deck: 'chance', title: 'Sora 刷屏', text: '视频模型一夜爆火，你的估值跟着起飞，获得 150T。', effect: { type: 'money', amount: 150 } };
const BUBBLE: Card = { id: 'bubble_burst', deck: 'fate', title: 'AI 泡沫破裂', text: '分析师齐喊泡沫，所有人的所有建筑降 1 级。', effect: { type: 'downgradeAll', levels: 1 } };

export function installFxDemo(fx: Fx, ctx: FxContext): void {
  const { board } = ctx;
  const players = () => (store.game?.players ?? []).filter((p) => !p.bankrupt);
  const me = () => players().find((p) => p.id === store.myId)?.id ?? players()[0]?.id ?? '';
  const other = () => players().find((p) => p.id !== me())?.id ?? me();
  const pos = (pid: string) => board.tokenCellOf(pid);
  const ahead = (pid: string, n: number) => Array.from({ length: n }, (_, i) => (pos(pid) + i + 1) % 40);
  const own = (cell: number, pid: string, level: number) => {
    board.setOwner(cell, pid);
    board.setLevel(cell, level);
  };
  /** 把对手挪到 14 格外，方便看飞行类特效 */
  const spread = () => {
    if (other() === me()) return;
    const want = (pos(me()) + 14) % 40;
    if (pos(other()) === want) return;
    board.setTokenCell(other(), want);
    board.placeToken(other(), false);
  };
  const reset = () => {
    fx.resume();
    if (store.game) board.sync(store.game);
  };

  const actions: Record<string, () => Promise<unknown>> = {
    骰子: () => fx.dice(3, 5, store.game?.players.find((p) => p.id === me())?.diceSkin ?? 'h100'),
    双骰: () => fx.dice(4, 4, 'furnace', { doubles: true }),
    火箭: () => fx.dice(2, 5, 'vram', { rocket: true }),
    乌龟: () => fx.dice(1, 0, 'mahjong', { turtle: true }),
    麻将: () => fx.dice(6, 2, 'mahjong'),
    移动: () => fx.move(me(), ahead(me(), 6)),
    融资轮: async () => {
      await fx.move(me(), [0, 1, 2]);
      await fx.passStart(me(), 200);
    },
    路障: async () => {
      const c = ahead(me(), 1)[0];
      await fx.move(me(), [c]);
      await fx.roadblockHit(me(), c);
    },
    传送: () => fx.move(me(), [(pos(me()) + 20) % 40], { teleport: true }),
    买地: () => fx.buy(6, me()),
    升级: async () => {
      const lv = Math.min(4, board.ownerOf(8) ? board.levelOf(8) + 1 : 1);
      if (!board.ownerOf(8)) own(8, me(), 0);
      await fx.build(8, lv);
    },
    v4: async () => {
      own(9, me(), 3);
      await fx.build(9, 4);
    },
    旗舰: async () => {
      own(39, me(), 4);
      await fx.build(39, 5);
    },
    导弹降级: async () => {
      own(16, other(), 3);
      await fx.item(me(), 'missile', 16);
      await fx.downgrade(16, 2);
    },
    泡沫破裂: async () => {
      const cells = [1, 3, 6, 8, 9, 11, 13, 16, 18, 21, 23, 26, 27, 31, 34, 37, 39];
      cells.forEach((c, i) => own(c, i % 2 ? me() : other(), 1 + (i % 4)));
      const t1 = performance.now();
      downgradeCtx.bubblePending = true;
      for (const c of cells) await fx.downgrade(c, board.levelOf(c) - 1);
      return `fx=${Math.round(performance.now() - t1)}ms`;
    },
    收费: () => fx.rent(me(), other(), 300, false),
    护盾收费: () => fx.rent(me(), other(), 200, true),
    余额: () => fx.money(me(), 150, 'demo'),
    热搜卡: () => fx.card(CHANCE),
    突发卡: () => fx.card(BUBBLE),
    监管: async () => {
      await fx.move(me(), [10], { teleport: true });
      await fx.jail(me());
    },
    出狱: async () => {
      board.setTokenCell(me(), 10, true);
      board.placeToken(me(), false);
      playJailExit(ctx, me());
      board.setJailed(me(), false);
      await new Promise((r) => setTimeout(r, 600));
    },
    路障道具: () => fx.item(me(), 'roadblock', ahead(me(), 3)[2]),
    导弹: () => fx.item(me(), 'missile', ahead(me(), 5)[4]),
    火箭道具: () => fx.item(me(), 'rocket'),
    乌龟道具: () => fx.item(me(), 'turtle', undefined, other()),
    护盾: () => fx.item(me(), 'shield'),
    跳板机: async () => {
      await fx.item(me(), 'teleport', (pos(me()) + 12) % 40);
      await fx.move(me(), [(pos(me()) + 12) % 40], { teleport: true });
    },
    豁免卡: () => fx.item(me(), 'jailfree'),
    破产: async () => {
      await fx.bankrupt(other());
    },
    胜利: () => fx.gameOver(me()),
    横幅: () => fx.banner('轮到你了！', 'primary', 350),
    一回合: async () => {
      const path = ahead(me(), 7);
      const cell = path[6];
      await fx.banner('轮到你了！', 'primary', 350);
      await fx.dice(3, 4, 'h100');
      await fx.move(me(), path);
      await fx.buy(cell, me());
      await fx.money(me(), -200, '购买');
    },
    快进测试: async () => {
      const p = fx.build(39, 5);
      const q = fx.rent(me(), other(), 400, false);
      await new Promise((r) => setTimeout(r, 300));
      fx.skipAll();
      await Promise.all([p, q]);
      fx.resume();
      const left = ctx.overlay.childElementCount;
      const fxKids = board.layers.fx.children.length;
      return `overlay=${left} fxLayer=${fxKids}`;
    },
    重置: async () => reset(),
  };

  const panel = document.createElement('div');
  panel.className = 'fx2-demo';
  const lab = document.createElement('div');
  lab.className = 'lab';
  lab.textContent = 'fxdemo：点按钮触发特效';
  const tog = document.createElement('button');
  tog.className = 'tog';
  tog.textContent = '收起';
  tog.onclick = () => {
    panel.classList.toggle('min');
    tog.textContent = panel.classList.contains('min') ? 'FX' : '收起';
  };
  panel.append(tog);
  /** 计时前的准备（瞬间摆好棋子 / 路障） */
  const prep: Record<string, () => void> = {
    融资轮: () => {
      board.setTokenCell(me(), 39);
      board.placeToken(me(), false);
    },
    路障: () => board.addRoadblock(ahead(me(), 1)[0]),
  };
  const run = async (name: string): Promise<string> => {
    const fn = actions[name];
    if (!fn) return 'unknown';
    fx.resume();
    prep[name]?.();
    if (name !== '重置') spread();
    const t0 = performance.now();
    let extra = '';
    try {
      const r = await fn();
      if (typeof r === 'string') extra = ' ' + r;
    } catch (e) {
      console.error('[fxdemo]', name, e);
      extra = ' ERROR';
    }
    const ms = Math.round(performance.now() - t0);
    lab.textContent = `${name}: ${ms}ms${extra}`;
    console.log(`[fxdemo] ${name} ${ms}ms${extra}`);
    if (name === '破产' || name === '胜利' || name === '监管') setTimeout(reset, 800);
    return `${ms}${extra}`;
  };
  for (const name of Object.keys(actions)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = name;
    b.addEventListener('pointerdown', (e) => e.stopPropagation(), true);
    b.onclick = () => void run(name);
    panel.append(b);
  }
  panel.append(lab);
  document.body.append(panel);
  if (window.innerWidth < 760) tog.click();
  // 对局场景销毁（overlay 被移除）时一并移除面板
  const mo = new MutationObserver(() => {
    if (!ctx.overlay.isConnected) {
      panel.remove();
      mo.disconnect();
    }
  });
  mo.observe(document.body, { childList: true });
  /** 冻结 / 恢复所有 gsap 动画与粒子（截图取动画中段用） */
  const freeze = (on: boolean) => {
    gsap.globalTimeline.paused(on);
    ctx.particles.paused = on;
  };
  (window as unknown as { __fxdemo: unknown }).__fxdemo = { run, freeze, names: Object.keys(actions), fx, ctx };
}
