// 桌面端横向滚动条（羁绊行 / 8 人房头像条）：滚轮映射为横向、按住鼠标左键拖动滚动（与点击区分：移动 > 6px 才算拖，
// 拖过之后吞掉这次 click），两端按可滚方向显示渐隐提示（.hs-l / .hs-r）。触屏保持原生滑动。
const THRESH = 6;

export function hscroll(el: HTMLElement): void {
  if (el.dataset.hs) return;
  el.dataset.hs = '1';
  el.classList.add('hscroll');
  const sync = (): void => {
    const max = el.scrollWidth - el.clientWidth;
    el.classList.toggle('hs-l', max > 1 && el.scrollLeft > 1);
    el.classList.toggle('hs-r', max > 1 && el.scrollLeft < max - 1);
  };
  el.addEventListener('scroll', sync, { passive: true });
  el.addEventListener(
    'wheel',
    (e) => {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 1 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const next = Math.max(0, Math.min(max, el.scrollLeft + e.deltaY));
      if (next === el.scrollLeft) return;
      el.scrollLeft = next;
      e.preventDefault();
    },
    { passive: false },
  );
  let st: { id: number; x0: number; s0: number; moved: boolean } | null = null;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0 || el.scrollWidth - el.clientWidth <= 1) return;
    st = { id: e.pointerId, x0: e.clientX, s0: el.scrollLeft, moved: false };
  });
  el.addEventListener('pointermove', (e) => {
    if (!st || e.pointerId !== st.id) return;
    const dx = e.clientX - st.x0;
    if (!st.moved && Math.abs(dx) < THRESH) return;
    if (!st.moved) {
      st.moved = true;
      el.classList.add('is-hdrag');
      // 超过阈值才捕获指针：未拖动时 click 仍落在原按钮上
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    el.scrollLeft = st.s0 - dx;
  });
  const up = (e: PointerEvent): void => {
    if (!st || e.pointerId !== st.id) return;
    if (st.moved) {
      el.classList.remove('is-hdrag');
      // 拖动结束后紧跟的 click 不触发按钮
      const kill = (ev: Event): void => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      el.addEventListener('click', kill, { capture: true, once: true });
      setTimeout(() => el.removeEventListener('click', kill, { capture: true }), 50);
    }
    st = null;
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('lostpointercapture', (e) => up(e));
  new ResizeObserver(sync).observe(el);
  new MutationObserver(sync).observe(el, { childList: true });
  requestAnimationFrame(sync);
}
