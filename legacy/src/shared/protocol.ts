// WebSocket 协议（JSON）。DESIGN.md 5.1。
import type {
  BoardData,
  Character,
  DiceSkin,
  GameAction,
  GameEvent,
  GameSettings,
  GameState,
  Item,
} from './types.js';

/** 大厅中的玩家 */
export interface RoomPlayer {
  id: string;
  name: string;
  characterId: string;
  color: string;
  isBot: boolean;
  isHost: boolean;
  connected: boolean;
  diceSkin?: string;
}

export interface RoomState {
  code: string; // 4 位大写字母
  hostId: string;
  status: 'lobby' | 'playing' | 'ended';
  players: RoomPlayer[];
  settings: GameSettings;
  minPlayers: number;
  maxPlayers: number;
}

/* ---------- 客户端 → 服务端 ---------- */
export type C2S =
  | { t: 'hello'; token?: string }
  | { t: 'createRoom'; name: string; characterId: string }
  | { t: 'joinRoom'; code: string; name: string; characterId: string }
  | { t: 'leaveRoom' }
  | { t: 'addBot' }
  | { t: 'removeBot'; playerId: string }
  | { t: 'updateSettings'; settings: Partial<GameSettings> }
  | { t: 'startGame' }
  | { t: 'backToRoom' } // 房主在结算后把房间带回大厅（lobby），保留玩家（扩展）
  | { t: 'setCharacter'; characterId: string }
  | { t: 'setDiceSkin'; diceSkin: string } // 扩展
  | { t: 'action'; action: GameAction }
  | { t: 'chat'; text: string }
  | { t: 'ping' };

/* ---------- 服务端 → 客户端 ---------- */
export interface WelcomeMsg {
  t: 'welcome';
  token: string;
  playerId: string;
  characters: Character[];
  board: BoardData;
  items: Item[];
  diceSkins: DiceSkin[];
  serverTime: number; // 服务器当前时间戳（ms），用于校准 turnDeadline 倒计时（扩展）
}

/** 服务端提示（房主已重开、XX 掉线已托管、XX 重新连上……），客户端弹出轻提示即可（扩展） */
export interface ToastMsg {
  t: 'toast';
  text: string;
  kind: 'info' | 'warn';
}

/** 被踢下线（同一 token 在别处登录）。收到后客户端应停止自动重连（扩展） */
export interface KickedMsg {
  t: 'kicked';
  reason: 'duplicate_login';
}

export type S2C =
  | WelcomeMsg
  | { t: 'room'; room: RoomState }
  | { t: 'game'; state: GameState; events: GameEvent[]; serverTime: number }
  | { t: 'left' } // 已离开房间，回到大厅（扩展）
  | { t: 'error'; msg: string }
  | ToastMsg
  | KickedMsg
  | { t: 'chat'; from: string; name: string; text: string }
  | { t: 'pong' };

export type C2SType = C2S['t'];
export type S2CType = S2C['t'];
