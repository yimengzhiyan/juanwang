// 极简 DOM 工具。
type Attrs = Record<string, string | number | boolean | null | undefined | EventListener>;
type Child = Node | string | number | null | undefined | false;

/** h('div.a.b#id', {onclick}, children...) */
export function h<K extends keyof HTMLElementTagNameMap>(sel: K | string, attrs?: Attrs | null, ...children: (Child | Child[])[]): HTMLElement {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(sel);
  const tag = (m?.[1] || 'div') as string;
  const el = document.createElement(tag);
  const rest = m?.[2] ?? '';
  for (const part of rest.match(/[.#][\w-]+/g) ?? []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k === 'class') el.className += ' ' + String(v);
      else if (k === 'html') el.innerHTML = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

let toastBox: HTMLElement | null = null;
/** 顶部轻提示 */
export function toast(msg: string, kind: 'info' | 'error' | 'success' = 'info', ms = 2600): void {
  if (!toastBox) {
    toastBox = h('div.toasts');
    document.body.append(toastBox);
  }
  const t = h('div.toast.glass', { class: 'toast--' + kind }, msg);
  toastBox.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, ms);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isMobileLayout(): boolean {
  return window.innerWidth < 760 || (window.innerHeight < 500 && window.innerWidth < 1000);
}
