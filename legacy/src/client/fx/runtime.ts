// 特效运行时：统一管理 gsap 动画的“可快进”（skipAll）与等待。
// 所有特效函数都应通过 rt.play(timeline) / rt.wait(ms) 等待，这样玩家点击屏幕即可快进。
import gsap from 'gsap';

export class FxRuntime {
  /** 为 true 时：新播放的动画直接跳到末帧，wait 立即返回（直到 resume） */
  skipping = false;
  /** 全局速度（事件积压时加速） */
  speed = 1;
  private active = new Set<gsap.core.Animation>();
  private waits = new Set<() => void>();
  private cleanups = new Set<() => void>();
  /** 常驻快进监听（粒子系统等，每次 skipAll 都会调用，不会被清空） */
  private skipListeners = new Set<() => void>();

  /** 播放一个 gsap 动画并等待完成；快进时立即跳到末帧 */
  play(anim: gsap.core.Animation): Promise<void> {
    return new Promise((resolve) => {
      const done = () => {
        this.active.delete(anim);
        resolve();
      };
      // 保留调用方自己设置的 onComplete
      const prev = anim.eventCallback('onComplete') as ((...a: unknown[]) => void) | null;
      anim.eventCallback('onComplete', () => {
        try {
          prev?.call(anim);
        } finally {
          done();
        }
      });
      this.active.add(anim);
      if (this.skipping) anim.progress(1);
    });
  }

  /** 播放但不等待（粒子、浮字等装饰）；快进时同样跳到末帧 */
  fire(anim: gsap.core.Animation): void {
    void this.play(anim);
  }

  /** 等待 ms（受全局速度影响）；快进时立即返回 */
  wait(ms: number): Promise<void> {
    if (this.skipping || ms <= 0) return Promise.resolve();
    return new Promise((resolve) => {
      const fn = () => {
        clearTimeout(timer);
        this.waits.delete(fn);
        resolve();
      };
      const timer = setTimeout(fn, ms / this.speed);
      this.waits.add(fn);
    });
  }

  /** 等待某个外部条件（如卡牌被点击），快进时立即返回 */
  until(register: (resolve: () => void) => void, timeoutMs: number): Promise<void> {
    if (this.skipping) return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const fn = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waits.delete(fn);
        resolve();
      };
      const timer = setTimeout(fn, timeoutMs / this.speed);
      this.waits.add(fn);
      register(fn);
    });
  }

  /** 注册一个快进时需要执行的清理（如移除 HTML 覆盖元素） */
  onSkip(fn: () => void): () => void {
    this.cleanups.add(fn);
    return () => this.cleanups.delete(fn);
  }

  /** 常驻快进监听：每次 skipAll() 都调用（粒子系统清场用） */
  onSkipAll(fn: () => void): () => void {
    this.skipListeners.add(fn);
    return () => this.skipListeners.delete(fn);
  }

  /** 快进：所有进行中的动画跳到末帧，所有等待立即结束；之后的动画也立即完成，直到 resume() */
  skipAll(): void {
    this.skipping = true;
    for (const a of [...this.active]) a.progress(1);
    for (const w of [...this.waits]) w();
    for (const c of [...this.cleanups]) c();
    this.cleanups.clear();
    for (const l of [...this.skipListeners]) l();
  }

  resume(): void {
    this.skipping = false;
  }

  setSpeed(s: number): void {
    this.speed = s;
    gsap.globalTimeline.timeScale(s);
  }
}
