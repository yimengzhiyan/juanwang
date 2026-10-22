// WebSocket 封装：自动连接 / 重连（重发 hello{token}）/ 心跳 / 类型安全分发。
import type { C2S, S2C } from '@dafuweng/shared';
import { prefs } from './store';

export type NetStatus = 'connecting' | 'open' | 'reconnecting' | 'kicked';
type MsgOf<T extends S2C['t']> = Extract<S2C, { t: T }>;
type Handler<T extends S2C['t']> = (msg: MsgOf<T>) => void;

const TOKEN_KEY = 'dafuweng.token';
const PING_EVERY = 10_000;
const DEAD_AFTER = 25_000;

function wsUrl(): string {
  // dev：Vite(5173) 已把 /ws 代理到 :3000；生产：同源 /ws
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

class Net {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<(m: S2C) => void>>();
  private statusHandlers = new Set<(s: NetStatus) => void>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastMsgAt = 0;
  private kicked = false;
  status: NetStatus = 'connecting';
  /** 是否已收到 welcome（hello 握手完成） */
  ready = false;

  get token(): string | null {
    return prefs.get(TOKEN_KEY);
  }

  connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    this.kicked = false;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setStatus(this.retry === 0 ? 'connecting' : 'reconnecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    this.ready = false;
    ws.onopen = () => {
      this.lastMsgAt = Date.now();
      const token = this.token;
      this.rawSend(token ? { t: 'hello', token } : { t: 'hello' });
      this.startPing();
    };
    ws.onmessage = (ev) => {
      this.lastMsgAt = Date.now();
      let msg: S2C;
      try {
        msg = JSON.parse(String(ev.data)) as S2C;
      } catch {
        return;
      }
      if (msg.t === 'welcome') {
        prefs.set(TOKEN_KEY, msg.token);
        this.retry = 0;
        this.ready = true;
        this.setStatus('open');
      }
      if (msg.t === 'kicked') {
        // 同一身份在别的标签页登录（服务端发 kicked{reason:'duplicate_login'}）：停止自动重连，避免两个标签互相顶号
        this.kicked = true;
        this.setStatus('kicked');
      }
      this.dispatch(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      if (ev.code === 4001) {
        // 兜底：kicked 消息丢失时按关闭码判定被顶号
        this.kicked = true;
        this.setStatus('kicked');
      }
      this.ws = null;
      this.ready = false;
      this.stopPing();
      if (this.kicked) return;
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      /* onclose 会接着触发 */
    };
  }

  /** 主动断开（测试 / 调试用），随后自动重连 */
  drop(): void {
    this.ws?.close();
  }

  private scheduleReconnect(): void {
    this.setStatus('reconnecting');
    const delay = Math.min(5000, 400 * 2 ** this.retry);
    this.retry += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.lastMsgAt > DEAD_AFTER) {
        // 心跳超时：判定为死连接，强制重连
        this.ws?.close();
        return;
      }
      this.rawSend({ t: 'ping' });
    }, PING_EVERY);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private setStatus(s: NetStatus): void {
    if (this.status === s) return;
    this.status = s;
    for (const fn of this.statusHandlers) fn(s);
  }

  private rawSend(msg: C2S): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** 发送消息；未连接时返回 false */
  send(msg: C2S): boolean {
    if (!this.ready) return false;
    return this.rawSend(msg);
  }

  on<T extends S2C['t']>(t: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    set.add(fn as (m: S2C) => void);
    return () => set!.delete(fn as (m: S2C) => void);
  }

  onStatus(fn: (s: NetStatus) => void): () => void {
    this.statusHandlers.add(fn);
    return () => this.statusHandlers.delete(fn);
  }

  private dispatch(msg: S2C): void {
    const set = this.handlers.get(msg.t);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(msg);
      } catch (e) {
        console.warn('[net] handler error', msg.t, e);
      }
    }
  }
}

export const net = new Net();

// 手机切回前台 / 网络恢复时立即尝试重连
if (typeof window !== 'undefined') {
  const kick = () => {
    if (net.status === 'reconnecting') net.connect();
  };
  window.addEventListener('online', kick);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') kick();
  });
}
