// 顶部 toast：同时最多 2 条，自动消失。
import gsap from 'gsap';
import { plain } from './cards';

let root: HTMLElement;
export function mountToast(shell: HTMLElement): void {
  root = document.createElement('div');
  root.className = 'toast-root';
  shell.appendChild(root);
}

export function toast(text: string, kind: 'info' | 'warn' | 'good' = 'warn', ms = 1800): void {
  if (!root) return;
  while (root.children.length >= 2) root.firstElementChild!.remove();
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = plain(text);
  root.appendChild(el);
  gsap.fromTo(el, { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.2, ease: 'back.out(2)' });
  setTimeout(() => {
    gsap.to(el, { opacity: 0, y: -10, duration: 0.2, onComplete: () => el.remove() });
  }, ms);
}
