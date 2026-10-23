// 拖拽 + 单击 + 长按 统一处理（Pointer Events）。可拖元素带 data-src，落点带 data-drop。
import gsap from 'gsap';
import { getFxLayer, toShell } from '../fx/anims';

export interface DragHandlers {
  canDrag: (src: string) => boolean;
  canDrop?: (src: string, drop: string) => boolean;
  onTap: (src: string, el: HTMLElement) => void;
  onLongPress: (src: string, el: HTMLElement) => void;
  onDrop: (src: string, drop: string | null, el: HTMLElement) => void;
  onDragStart?: (src: string) => void;
  onDragEnd?: () => void;
}

const THRESH = 8;
const LONG = 450;

export function attachDrag(root: HTMLElement, h: DragHandlers): () => void {
  let st: {
    id: number;
    src: string;
    el: HTMLElement;
    x0: number;
    y0: number;
    dragging: boolean;
    ghost?: HTMLElement;
    gx: number;
    gy: number;
    timer: number;
    long: boolean;
    over?: HTMLElement | null;
  } | null = null;

  const findDrop = (x: number, y: number): HTMLElement | null => {
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    return (hit?.closest('[data-drop]') as HTMLElement | null) ?? null;
  };

  const down = (e: PointerEvent): void => {
    if (e.button !== 0 || st) return;
    const el = (e.target as HTMLElement).closest('[data-src]') as HTMLElement | null;
    if (!el || !root.contains(el)) return;
    const src = el.dataset.src!;
    st = { id: e.pointerId, src, el, x0: e.clientX, y0: e.clientY, dragging: false, gx: 0, gy: 0, timer: 0, long: false };
    st.timer = window.setTimeout(() => {
      if (st && !st.dragging) {
        st.long = true;
        h.onLongPress(st.src, st.el);
      }
    }, LONG);
  };

  const move = (e: PointerEvent): void => {
    if (!st || e.pointerId !== st.id || st.long) return;
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    if (!st.dragging) {
      if (Math.hypot(dx, dy) < THRESH) return;
      clearTimeout(st.timer);
      if (!h.canDrag(st.src)) {
        st = null;
        return;
      }
      st.dragging = true;
      const r = st.el.getBoundingClientRect();
      const g = st.el.cloneNode(true) as HTMLElement;
      g.classList.add('drag-ghost');
      const [lx, ly] = toShell(r.left, r.top);
      st.gx = lx;
      st.gy = ly;
      Object.assign(g.style, { left: `${lx}px`, top: `${ly}px`, width: `${r.width}px`, height: `${r.height}px` });
      getFxLayer().appendChild(g);
      gsap.to(g, { scale: 1.08, rotate: -4, duration: 0.12 });
      st.ghost = g;
      st.el.classList.add('is-dragging');
      h.onDragStart?.(st.src);
    }
    if (st.ghost) {
      st.ghost.style.transform = '';
      gsap.set(st.ghost, { x: dx, y: dy });
      const over = findDrop(e.clientX, e.clientY);
      if (over !== st.over) {
        st.over?.classList.remove('is-over');
        st.over = over && (!h.canDrop || h.canDrop(st.src, over.dataset.drop!)) ? over : null;
        st.over?.classList.add('is-over');
      }
    }
    e.preventDefault();
  };

  const end = (e: PointerEvent, cancel = false): void => {
    if (!st || e.pointerId !== st.id) return;
    const s = st;
    st = null;
    clearTimeout(s.timer);
    if (s.long) return;
    if (!s.dragging) {
      if (!cancel) h.onTap(s.src, s.el);
      return;
    }
    s.over?.classList.remove('is-over');
    s.el.classList.remove('is-dragging');
    const drop = cancel ? null : s.over?.dataset.drop ?? null;
    s.ghost?.remove();
    h.onDragEnd?.();
    h.onDrop(s.src, drop, s.el);
  };

  const up = (e: PointerEvent): void => end(e);
  const cancel = (e: PointerEvent): void => end(e, true);
  root.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: false });
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', cancel);
  const ctx = (e: Event): void => {
    if ((e.target as HTMLElement).closest?.('[data-src]')) e.preventDefault();
  };
  root.addEventListener('contextmenu', ctx);
  return () => {
    root.removeEventListener('pointerdown', down);
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    root.removeEventListener('contextmenu', ctx);
  };
}
