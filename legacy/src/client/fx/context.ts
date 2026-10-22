// 特效共享上下文：所有 fx/*.ts 的函数都接收它。
import type { Application } from 'pixi.js';
import type { BoardView } from '../board/board';
import type { Particles } from './particles';
import type { FxRuntime } from './runtime';

export interface FxContext {
  app: Application;
  board: BoardView;
  /** 全屏 HTML 覆盖层（pointer-events: none；需要点击的元素自行开启） */
  overlay: HTMLElement;
  rt: FxRuntime;
  particles: Particles;
  /** 震动棋盘（多个震动取最大值，手机 ×0.7） */
  shake: (ms: number, strength: number) => void;
}
