// WebSocket 协议分发、会话（token）管理、心跳、错误处理。
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
import type { C2S, GameAction, GameData, S2C } from '@dafuweng/shared';
import { EngineError } from './engine/index.js';
import { Room, RoomError, RoomManager, sanitizeName, type RoomDeps } from './room.js';

interface Session {
  token: string;
  playerId: string;
  roomCode: string | null;
  ws: WebSocket | null;
  lastSeen: number;
}

export interface GameServerOptions {
  path?: string; // 默认 /ws
  heartbeatMs?: number; // 默认 25s
  roomDeps?: Partial<Omit<RoomDeps, 'data' | 'send' | 'onEmpty'>>;
}

const ACTION_TYPES = new Set([
  'roll',
  'buy',
  'skipBuy',
  'upgrade',
  'skipUpgrade',
  'upgradeAny',
  'ackCard',
  'useItem',
  'payJail',
  'useJailCard',
  'rollJail',
  'mortgage',
  'unmortgage',
]);

/** 游戏 WebSocket 服务：挂到 http server 的 /ws 上 */
export class GameServer {
  readonly wss: WebSocketServer;
  readonly rooms: RoomManager;
  private sessions = new Map<string, Session>(); // token → session
  private byPlayer = new Map<string, Session>(); // playerId → session
  private heartbeat: ReturnType<typeof setInterval>;
  private alive = new WeakMap<WebSocket, boolean>();

  constructor(
    httpServer: Server,
    private readonly data: GameData,
    opts: GameServerOptions = {},
  ) {
    const path = opts.path ?? '/ws';
    this.rooms = new RoomManager({ data, send: (pid, msg) => this.sendTo(pid, msg), ...(opts.roomDeps ?? {}) });
    this.rooms.startSweeper();
    this.wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
    httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname !== path) {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit('connection', ws, req));
    });
    this.wss.on('connection', (ws) => this.onConnection(ws));
    // 心跳：协议层 ping，超时未回应的连接直接断开
    this.heartbeat = setInterval(() => {
      for (const ws of this.wss.clients) {
        if (this.alive.get(ws) === false) {
          ws.terminate();
          continue;
        }
        this.alive.set(ws, false);
        try {
          ws.ping();
        } catch {
          /* 忽略 */
        }
      }
      this.sweepSessions(Date.now());
    }, opts.heartbeatMs ?? 25_000);
    this.heartbeat.unref?.();
  }

  /** 清理长时间离线且不在房间里的会话（6 小时） */
  private sweepSessions(now: number): void {
    for (const [token, s] of this.sessions) {
      if (s.ws || now - s.lastSeen < 6 * 3600_000) continue;
      if (s.roomCode && this.rooms.get(s.roomCode)?.member(s.playerId)) continue;
      this.sessions.delete(token);
      this.byPlayer.delete(s.playerId);
    }
  }

  close(): void {
    clearInterval(this.heartbeat);
    this.rooms.dispose();
    for (const ws of this.wss.clients) ws.terminate();
    this.wss.close();
  }

  private send(ws: WebSocket | null, msg: S2C): void {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  private sendTo(playerId: string, msg: S2C): void {
    this.send(this.byPlayer.get(playerId)?.ws ?? null, msg);
  }

  private onConnection(ws: WebSocket): void {
    this.alive.set(ws, true);
    let session: Session | null = null;
    ws.on('pong', () => this.alive.set(ws, true));
    ws.on('message', (raw) => {
      this.alive.set(ws, true);
      let msg: C2S;
      try {
        msg = JSON.parse(raw.toString()) as C2S;
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') throw new Error();
      } catch {
        this.send(ws, { t: 'error', msg: '消息格式错误' });
        return;
      }
      try {
        if (msg.t === 'ping') return this.send(ws, { t: 'pong' });
        if (msg.t === 'hello') {
          session = this.hello(ws, msg.token);
          return;
        }
        if (!session) throw new RoomError('请先发送 hello');
        session.lastSeen = Date.now();
        this.dispatch(session, msg);
      } catch (e) {
        if (e instanceof RoomError || e instanceof EngineError) this.send(ws, { t: 'error', msg: e.message });
        else {
          console.error('[ws] 处理消息出错：', e);
          this.send(ws, { t: 'error', msg: '服务器内部错误' });
        }
      }
    });
    ws.on('close', () => {
      if (!session || session.ws !== ws) return;
      session.ws = null;
      session.lastSeen = Date.now();
      const room = session.roomCode ? this.rooms.get(session.roomCode) : undefined;
      room?.setConnected(session.playerId, false);
    });
    ws.on('error', () => ws.terminate());
  }

  /** 首包：有合法 token 则恢复身份（顶掉旧连接），否则新建 */
  private hello(ws: WebSocket, token: unknown): Session {
    let s = typeof token === 'string' ? this.sessions.get(token) : undefined;
    if (s) {
      if (s.ws && s.ws !== ws) {
        const old = s.ws;
        s.ws = null; // 先解绑，避免旧连接 close 时把人标成离线
        this.send(old, { t: 'kicked', reason: 'duplicate_login' });
        old.close(4001, 'duplicate_login');
      }
    } else {
      s = { token: randomBytes(18).toString('base64url'), playerId: 'p_' + randomBytes(5).toString('hex'), roomCode: null, ws: null, lastSeen: 0 };
      this.sessions.set(s.token, s);
      this.byPlayer.set(s.playerId, s);
    }
    s.ws = ws;
    s.lastSeen = Date.now();
    this.send(ws, {
      t: 'welcome',
      token: s.token,
      playerId: s.playerId,
      characters: this.data.characters,
      board: this.data.board,
      items: this.data.items,
      diceSkins: this.data.diceSkins,
      serverTime: Date.now(),
    });
    // 重连：恢复房间
    if (s.roomCode) {
      const room = this.rooms.get(s.roomCode);
      if (room && room.member(s.playerId) && !room.member(s.playerId)!.left) {
        room.setConnected(s.playerId, true);
      } else {
        s.roomCode = null;
      }
    }
    return s;
  }

  private roomOf(s: Session): Room {
    const room = s.roomCode ? this.rooms.get(s.roomCode) : undefined;
    if (!room || !room.member(s.playerId)) {
      s.roomCode = null;
      throw new RoomError('你不在任何房间中');
    }
    return room;
  }

  private dispatch(s: Session, msg: C2S): void {
    switch (msg.t) {
      case 'createRoom': {
        this.leaveCurrent(s);
        const room = this.rooms.create();
        try {
          room.join(s.playerId, sanitizeName(msg.name), String(msg.characterId ?? ''));
        } catch (e) {
          this.rooms.remove(room.code);
          throw e;
        }
        s.roomCode = room.code;
        break;
      }
      case 'joinRoom': {
        const room = this.rooms.get(String(msg.code ?? ''));
        if (!room) throw new RoomError('房间不存在');
        if (s.roomCode === room.code && room.member(s.playerId)) {
          room.sendSnapshot(s.playerId);
          break;
        }
        this.leaveCurrent(s);
        room.join(s.playerId, sanitizeName(msg.name), String(msg.characterId ?? ''));
        s.roomCode = room.code;
        break;
      }
      case 'leaveRoom':
        this.leaveCurrent(s);
        this.send(s.ws, { t: 'left' });
        break;
      case 'addBot':
        this.roomOf(s).addBot(s.playerId);
        break;
      case 'removeBot':
        this.roomOf(s).removeBot(s.playerId, String(msg.playerId));
        break;
      case 'updateSettings':
        this.roomOf(s).updateSettings(s.playerId, msg.settings ?? {});
        break;
      case 'startGame':
        this.roomOf(s).start(s.playerId);
        break;
      case 'backToRoom':
        this.roomOf(s).backToRoom(s.playerId);
        break;
      case 'setCharacter':
        this.roomOf(s).setCharacter(s.playerId, String(msg.characterId));
        break;
      case 'setDiceSkin':
        this.roomOf(s).setDiceSkin(s.playerId, String(msg.diceSkin));
        break;
      case 'action': {
        const a = msg.action as GameAction | undefined;
        if (!a || typeof a !== 'object' || !ACTION_TYPES.has(a.type)) throw new RoomError('未知动作');
        this.roomOf(s).act(s.playerId, a);
        break;
      }
      case 'chat':
        this.roomOf(s).chat(s.playerId, String(msg.text ?? ''));
        break;
      default:
        throw new RoomError('未知消息类型');
    }
  }

  private leaveCurrent(s: Session): void {
    if (!s.roomCode) return;
    const room = this.rooms.get(s.roomCode);
    s.roomCode = null;
    room?.leave(s.playerId);
  }
}
