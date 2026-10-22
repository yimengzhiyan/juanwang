// 房间管理：大厅、机器人、设置、开局、断线托管 / 重连、回合超时。
// 网络无关：通过 deps.send(playerId, msg) 发消息，由 ws.ts 注入。
import { randomBytes } from 'node:crypto';
import {
  MAX_ITEMS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ItemId,
  type GameAction,
  type GameData,
  type GameEvent,
  type GameSettings,
  type GameState,
  type RoomPlayer,
  type RoomState,
  type S2C,
} from '@dafuweng/shared';
import { decideBotAction, estimateAnimMs } from './bot.js';
import {
  EngineError,
  createGame,
  createRng,
  defaultAction,
  normalizeSettings,
  reduce,
  startEvents,
  type Rng,
} from './engine/index.js';

export class RoomError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'RoomError';
  }
}

export interface RoomMember {
  id: string;
  name: string;
  characterId: string;
  isBot: boolean;
  connected: boolean;
  left: boolean; // 游戏中主动离开：永久由机器人托管
  diceSkin?: string;
}

export interface RoomDeps {
  data: GameData;
  /** 给某个真人玩家发消息（离线时忽略即可） */
  send: (playerId: string, msg: S2C) => void;
  /** 房间里没有真人了，通知管理器销毁 */
  onEmpty?: (room: Room) => void;
  now?: () => number;
  /** 随机种子（测试注入）；缺省随机 */
  seed?: number;
  /** 机器人思考延迟范围 ms，缺省 [600,1200]；测试可设 [0,0] */
  botDelay?: [number, number];
  /** 是否在机器人延迟里叠加动画时长，缺省 true */
  waitAnimations?: boolean;
  /** 大厅中掉线多久后移出房间（ms），缺省 60s */
  lobbyGraceMs?: number;
  /**
   * 仅测试 / 调试用（生产默认关闭；环境变量 DEBUG_ITEMS=1 开启）：真人玩家开局及每个自己回合开始时，
   * 补齐此列表中缺少的道具种类（本局发得最少的优先，受 MAX_ITEMS 上限约束）。用于端到端验证全部道具。
   */
  debugItems?: readonly ItemId[];
}

const BOT_NAMES_PREFIX = 'AI·';

export class Room {
  readonly code: string;
  hostId = '';
  members: RoomMember[] = [];
  settings: GameSettings = normalizeSettings(undefined);
  game: GameState | null = null;
  private rng: Rng;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private debugGiven = new Map<string, Map<ItemId, number>>();
  private disposed = false;
  private readonly now: () => number;

  constructor(
    code: string,
    private readonly deps: RoomDeps,
  ) {
    this.code = code;
    this.now = deps.now ?? Date.now;
    this.rng = createRng(deps.seed ?? (Math.random() * 2 ** 32) >>> 0);
  }

  get status(): RoomState['status'] {
    if (!this.game) return 'lobby';
    return this.game.phase === 'ended' ? 'ended' : 'playing';
  }

  get data(): GameData {
    return this.deps.data;
  }

  /* --------------------------- 查询 --------------------------- */

  member(id: string): RoomMember | undefined {
    return this.members.find((m) => m.id === id);
  }

  /** 仍在房间且在线的真人数 */
  connectedHumans(): number {
    return this.members.filter((m) => !m.isBot && !m.left && m.connected).length;
  }

  roomState(): RoomState {
    const players: RoomPlayer[] = this.members
      .filter((m) => !m.left)
      .map((m) => ({
        id: m.id,
        name: m.name,
        characterId: m.characterId,
        color: this.data.characters.find((c) => c.id === m.characterId)?.color ?? '#888888',
        isBot: m.isBot,
        isHost: m.id === this.hostId,
        connected: m.connected,
        ...(m.diceSkin ? { diceSkin: m.diceSkin } : {}),
      }));
    return {
      code: this.code,
      hostId: this.hostId,
      status: this.status,
      players,
      settings: { ...this.settings },
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
    };
  }

  /* --------------------------- 大厅操作 --------------------------- */

  private freeCharacter(preferred?: string): string {
    const taken = new Set(this.members.filter((m) => !m.left).map((m) => m.characterId));
    const ids = this.data.characters.map((c) => c.id);
    if (preferred && ids.includes(preferred) && !taken.has(preferred)) return preferred;
    const free = ids.filter((id) => !taken.has(id));
    if (free.length === 0) return ids[0] ?? preferred ?? 'altman';
    return free[Math.floor(this.rng() * free.length)];
  }

  private activeCount(): number {
    return this.members.filter((m) => !m.left).length;
  }

  /** 真人加入（角色被占用时自动换一个空闲角色） */
  join(id: string, name: string, characterId: string): void {
    if (this.status !== 'lobby') throw new RoomError('游戏已开始，无法加入');
    if (this.member(id)) throw new RoomError('你已经在房间里了');
    if (this.activeCount() >= MAX_PLAYERS) throw new RoomError(`房间已满（最多 ${MAX_PLAYERS} 人）`);
    const clean = sanitizeName(name) || '玩家';
    this.members.push({ id, name: clean, characterId: this.freeCharacter(characterId), isBot: false, connected: true, left: false });
    if (!this.hostId || !this.member(this.hostId)) this.hostId = id;
    this.broadcastRoom();
  }

  private requireHost(byId: string): void {
    if (byId !== this.hostId) throw new RoomError('只有房主可以这样做');
  }

  private requireLobby(): void {
    if (this.status === 'playing') throw new RoomError('游戏进行中');
    if (this.status === 'ended') this.backToLobby();
  }

  addBot(byId: string): RoomMember {
    this.requireHost(byId);
    this.requireLobby();
    if (this.activeCount() >= MAX_PLAYERS) throw new RoomError(`房间已满（最多 ${MAX_PLAYERS} 人）`);
    const characterId = this.freeCharacter();
    const ch = this.data.characters.find((c) => c.id === characterId);
    const bot: RoomMember = {
      id: 'bot_' + randomBytes(4).toString('hex'),
      name: BOT_NAMES_PREFIX + (ch?.name ?? '机器人'),
      characterId,
      isBot: true,
      connected: true,
      left: false,
    };
    this.members.push(bot);
    this.broadcastRoom();
    return bot;
  }

  removeBot(byId: string, botId: string): void {
    this.requireHost(byId);
    this.requireLobby();
    const m = this.member(botId);
    if (!m || !m.isBot) throw new RoomError('没有这个机器人');
    this.members = this.members.filter((x) => x.id !== botId);
    this.broadcastRoom();
  }

  updateSettings(byId: string, settings: Partial<GameSettings>): void {
    this.requireHost(byId);
    this.requireLobby();
    this.settings = normalizeSettings({ ...this.settings, ...pickSettings(settings) });
    this.broadcastRoom();
  }

  setCharacter(id: string, characterId: string): void {
    const m = this.member(id);
    if (!m) throw new RoomError('你不在房间里');
    this.requireLobby();
    if (!this.data.characters.some((c) => c.id === characterId)) throw new RoomError('没有这个角色');
    if (this.members.some((x) => x.id !== id && !x.left && x.characterId === characterId)) throw new RoomError('这个角色已被选择');
    m.characterId = characterId;
    this.broadcastRoom();
  }

  setDiceSkin(id: string, diceSkin: string): void {
    const m = this.member(id);
    if (!m) throw new RoomError('你不在房间里');
    if (!this.data.diceSkins.some((d) => d.id === diceSkin)) throw new RoomError('没有这个骰子皮肤');
    m.diceSkin = diceSkin;
    const gp = this.game?.players.find((p) => p.id === id);
    if (gp) gp.diceSkin = diceSkin;
    this.broadcastRoom();
    if (this.game) this.broadcastGame([]);
  }

  /**
   * 房主在结算后把房间带回大厅（C2S backToRoom）。玩家不变：中途离开的转为机器人，
   * 掉线未离开的真人保留（大厅掉线宽限规则照常生效）。已在大厅时幂等，只重发房间快照。
   */
  backToRoom(byId: string): void {
    this.requireHost(byId);
    if (this.status === 'playing') throw new RoomError('游戏进行中，结算后才能回到房间');
    if (this.status === 'ended') {
      this.backToLobby();
      this.toast('房主带大家回到了房间', 'info', byId);
    }
    this.broadcastRoom();
  }

  /**
   * 结算后回到大厅。上一局中途离开（永久托管）的玩家保留为机器人，
   * 这样"再来一局"仍是同一批玩家；结算后才离开的人已经被移出成员表。
   */
  private backToLobby(): void {
    this.clearTimer();
    this.game = null;
    this.members = this.members.map((m) => (m.left && !m.isBot ? this.asBot(m) : m)).filter((m) => !m.left);
    // 掉线未回来的真人：进入大厅宽限期，超时移出（与大厅掉线规则一致）
    for (const m of this.members) if (!m.isBot && !m.connected) this.startGrace(m.id);
  }

  /** 大厅掉线宽限：超时仍未重连则移出房间 */
  private startGrace(id: string): void {
    this.clearGrace(id);
    const t = setTimeout(() => {
      this.graceTimers.delete(id);
      const mm = this.member(id);
      if (mm && !mm.connected && this.status !== 'playing') this.leave(id);
    }, this.deps.lobbyGraceMs ?? 60_000);
    t.unref?.();
    this.graceTimers.set(id, t);
  }

  /** 把已离开的真人席位转成机器人（新 id，保留角色） */
  private asBot(m: RoomMember): RoomMember {
    const base = m.name.startsWith(BOT_NAMES_PREFIX) ? m.name : BOT_NAMES_PREFIX + m.name;
    return {
      id: 'bot_' + randomBytes(4).toString('hex'),
      name: base.slice(0, 12),
      characterId: m.characterId,
      isBot: true,
      connected: true,
      left: false,
      ...(m.diceSkin ? { diceSkin: m.diceSkin } : {}),
    };
  }

  /**
   * 开局。结算后（status==='ended'）房主再次调用 = "再来一局"：
   * 同一批玩家（含机器人；中途离开的人转为机器人）、同样设置、新种子。
   */
  start(byId: string): void {
    this.requireHost(byId);
    const restart = this.status === 'ended';
    this.requireLobby();
    const players = this.members.filter((m) => !m.left);
    if (players.length < MIN_PLAYERS) throw new RoomError(`至少需要 ${MIN_PLAYERS} 名玩家（可以添加机器人）`);
    if (players.length > MAX_PLAYERS) throw new RoomError(`最多 ${MAX_PLAYERS} 名玩家`);
    const seed = (this.rng() * 2 ** 32) >>> 0;
    this.game = createGame(
      players.map((m) => ({
        id: m.id,
        name: m.name,
        characterId: m.characterId,
        isBot: m.isBot,
        connected: m.isBot ? true : m.connected,
        diceSkin: m.diceSkin,
      })),
      this.settings,
      this.data,
      seed,
    );
    this.debugGiven.clear();
    for (const p of this.game.players) this.topUpDebugItems(p.id);
    const events = startEvents(this.game);
    this.schedule(events);
    this.broadcastRoom();
    if (restart) this.toast('房主已重开新一局', 'info');
    this.broadcastGame(events);
  }

  /** 离开房间。游戏中离开 = 永久托管给机器人 */
  leave(id: string): void {
    const m = this.member(id);
    if (!m) return;
    this.clearGrace(id);
    if (this.status === 'playing') {
      m.left = true;
      m.connected = false;
      const gp = this.game!.players.find((p) => p.id === id);
      if (gp) gp.connected = false;
    } else {
      this.members = this.members.filter((x) => x.id !== id);
    }
    this.fixHost();
    if (this.checkEmpty()) return;
    this.broadcastRoom();
    if (this.status === 'playing') {
      this.toast(`${m.name} 离开了房间，由 AI 托管`, 'warn');
      this.reschedule();
      this.broadcastGame([]);
    } else {
      this.toast(`${m.name} 离开了房间`, 'info');
    }
  }

  /** 连接状态变化（断线 / 重连） */
  setConnected(id: string, connected: boolean): void {
    const m = this.member(id);
    if (!m || m.isBot || m.left) return;
    if (m.connected === connected) {
      if (connected) this.sendSnapshot(id);
      return;
    }
    m.connected = connected;
    const gp = this.game?.players.find((p) => p.id === id);
    if (gp) gp.connected = connected;
    if (connected) {
      this.clearGrace(id);
    } else if (this.status !== 'playing') {
      // 大厅 / 结算中掉线：宽限期后移出房间
      this.startGrace(id);
    }
    this.fixHost();
    if (!connected && this.checkEmpty()) return;
    this.broadcastRoom();
    if (connected) {
      this.toast(`${m.name} 重新连上了`, 'info', id);
      if (this.status === 'playing') this.deps.send(id, { t: 'toast', text: '已恢复连接，AI 托管结束', kind: 'info' });
    } else if (this.status === 'playing') {
      this.toast(`${m.name} 掉线，已由 AI 托管`, 'warn');
    } else {
      this.toast(`${m.name} 掉线了`, 'warn');
    }
    if (this.status === 'playing') {
      this.reschedule();
      this.broadcastGame([]);
    } else if (this.game) {
      this.broadcastGame([]);
    }
  }

  chat(id: string, text: string): void {
    const m = this.member(id);
    if (!m) throw new RoomError('你不在房间里');
    const clean = text.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, 200);
    if (!clean) return;
    for (const x of this.members) {
      if (!x.isBot && x.connected && !x.left) this.deps.send(x.id, { t: 'chat', from: id, name: m.name, text: clean });
    }
  }

  /* --------------------------- 游戏动作 --------------------------- */

  /** 真人发来的游戏动作 */
  act(playerId: string, action: GameAction): void {
    if (!this.game) throw new RoomError('游戏尚未开始');
    const m = this.member(playerId);
    if (!m || m.left) throw new RoomError('你不在这局游戏中');
    this.apply(playerId, action);
  }

  private apply(actorId: string, action: GameAction): GameEvent[] {
    if (!this.game) return [];
    const { state, events } = reduce(this.game, action, { rng: this.rng, data: this.data, actorId });
    this.game = state;
    if (this.deps.debugItems?.length) {
      for (const e of events) if (e.type === 'turnStart') this.topUpDebugItems(e.playerId);
    }
    // 同步在线状态（引擎不关心）
    for (const p of state.players) {
      const m = this.member(p.id);
      if (m) p.connected = m.isBot ? true : m.connected && !m.left;
    }
    this.schedule(events);
    if (state.phase === 'ended') this.broadcastRoom();
    this.broadcastGame(events);
    return events;
  }

  /**
   * 调试道具：给真人补齐 debugItems 中缺少的种类（只在 deps.debugItems 非空时生效）。
   * 优先补发本局发得最少的种类，保证道具数 > MAX_ITEMS 时也能轮流拿到全部种类。
   */
  private topUpDebugItems(playerId: string): void {
    const list = this.deps.debugItems;
    const p = this.game?.players.find((x) => x.id === playerId);
    if (!list?.length || !p || p.isBot || p.bankrupt) return;
    let given = this.debugGiven.get(playerId);
    if (!given) this.debugGiven.set(playerId, (given = new Map()));
    const missing = list.filter((id) => !p.items.includes(id)).sort((a, b) => (given!.get(a) ?? 0) - (given!.get(b) ?? 0));
    for (const id of missing) {
      if (p.items.length >= MAX_ITEMS) break;
      p.items.push(id);
      given.set(id, (given.get(id) ?? 0) + 1);
    }
  }

  /** 当前玩家是否由机器人操作（原生机器人 / 掉线 / 已离开） */
  private botControlled(playerId: string): boolean {
    const m = this.member(playerId);
    return !m || m.isBot || !m.connected || m.left;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** 状态变化后安排下一步：机器人思考 或 真人超时 */
  private schedule(events: readonly GameEvent[]): void {
    this.clearTimer();
    const g = this.game;
    if (!g || g.phase !== 'playing' || this.disposed) {
      if (g) g.turnDeadline = null;
      return;
    }
    const anim = this.deps.waitAnimations === false ? 0 : estimateAnimMs(events);
    const pid = g.currentPlayerId;
    if (this.botControlled(pid)) {
      g.turnDeadline = null;
      const [lo, hi] = this.deps.botDelay ?? [600, 1200];
      const delay = anim + lo + Math.floor(this.rng() * (hi - lo + 1));
      this.timer = setTimeout(() => this.botStep(), delay);
    } else if (g.settings.turnTimeoutSec > 0) {
      const ms = anim + g.settings.turnTimeoutSec * 1000;
      g.turnDeadline = this.now() + ms;
      this.timer = setTimeout(() => this.onTimeout(), ms);
    } else {
      g.turnDeadline = null;
    }
    this.timer?.unref?.();
  }

  private reschedule(): void {
    this.schedule([]);
  }

  private botStep(): void {
    this.timer = null;
    const g = this.game;
    if (!g || g.phase !== 'playing' || this.disposed) return;
    const pid = g.currentPlayerId;
    if (!this.botControlled(pid)) return this.reschedule();
    const action = decideBotAction(g, this.data, pid, this.rng) ?? defaultAction(g);
    try {
      this.apply(pid, action);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      // 机器人决策非法时退回默认动作，避免卡死
      this.apply(pid, defaultAction(g));
    }
  }

  private onTimeout(): void {
    this.timer = null;
    const g = this.game;
    if (!g || g.phase !== 'playing' || this.disposed) return;
    const pid = g.currentPlayerId;
    const action = defaultAction(g);
    try {
      this.apply(pid, action);
    } catch (e) {
      if (!(e instanceof EngineError)) throw e;
      this.reschedule();
    }
  }

  /* --------------------------- 广播 --------------------------- */

  private humans(): RoomMember[] {
    return this.members.filter((m) => !m.isBot && m.connected && !m.left);
  }

  broadcastRoom(): void {
    const room = this.roomState();
    for (const m of this.humans()) this.deps.send(m.id, { t: 'room', room });
  }

  broadcastGame(events: GameEvent[]): void {
    if (!this.game) return;
    const msg: S2C = { t: 'game', state: this.game, events, serverTime: this.now() };
    for (const m of this.humans()) this.deps.send(m.id, msg);
  }

  /** 给房间内在线真人发提示（except：不发给某人） */
  toast(text: string, kind: 'info' | 'warn' = 'info', except?: string): void {
    for (const m of this.humans()) if (m.id !== except) this.deps.send(m.id, { t: 'toast', text, kind });
  }

  /** 给某人发送完整快照（重连时） */
  sendSnapshot(id: string): void {
    this.deps.send(id, { t: 'room', room: this.roomState() });
    if (this.game) this.deps.send(id, { t: 'game', state: this.game, events: [], serverTime: this.now() });
  }

  /* --------------------------- 生命周期 --------------------------- */

  private fixHost(): void {
    const host = this.member(this.hostId);
    if (host && !host.left && host.connected) return;
    const next = this.members.find((m) => !m.isBot && !m.left && m.connected) ?? this.members.find((m) => !m.isBot && !m.left);
    if (next && next.id !== this.hostId) {
      const hadHost = !!this.hostId;
      this.hostId = next.id;
      if (hadHost) this.toast(`${next.name} 成为新房主`, 'info');
    }
  }

  private checkEmpty(): boolean {
    if (this.members.some((m) => !m.isBot && !m.left)) {
      if (this.connectedHumans() > 0) return false;
      // 全部掉线：游戏中保留房间等待重连（由管理器超时清理）
      return false;
    }
    this.dispose();
    this.deps.onEmpty?.(this);
    return true;
  }

  private clearGrace(id: string): void {
    const t = this.graceTimers.get(id);
    if (t) clearTimeout(t);
    this.graceTimers.delete(id);
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
  }

  get isDisposed(): boolean {
    return this.disposed;
  }
}

/* ====================================================================== */

/** 房间管理器：房间码分配、查找、空房清理 */
export class RoomManager {
  readonly rooms = new Map<string, Room>();
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private idleSince = new Map<string, number>();

  constructor(
    private readonly baseDeps: Omit<RoomDeps, 'onEmpty'>,
    /** 所有真人都离线多久后销毁房间（ms），缺省 10 分钟 */
    private readonly idleMs = 10 * 60_000,
  ) {}

  create(): Room {
    let code = '';
    for (let i = 0; i < 1000; i++) {
      code = randomCode();
      if (!this.rooms.has(code)) break;
    }
    if (this.rooms.has(code)) throw new RoomError('房间太多了，请稍后再试');
    const room = new Room(code, { ...this.baseDeps, onEmpty: (r) => this.remove(r.code) });
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  remove(code: string): void {
    const r = this.rooms.get(code);
    r?.dispose();
    this.rooms.delete(code);
    this.idleSince.delete(code);
  }

  /** 定期清理长时间无人在线的房间 */
  startSweeper(intervalMs = 60_000): void {
    this.sweeper = setInterval(() => this.sweep(Date.now()), intervalMs);
    this.sweeper.unref?.();
  }

  sweep(now: number): void {
    for (const [code, room] of this.rooms) {
      if (room.connectedHumans() > 0) {
        this.idleSince.delete(code);
        continue;
      }
      const since = this.idleSince.get(code) ?? now;
      this.idleSince.set(code, since);
      if (now - since >= this.idleMs) this.remove(code);
    }
  }

  dispose(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const code of [...this.rooms.keys()]) this.remove(code);
  }
}

/* ====================================================================== */

const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // 去掉易混淆的 I / O

export function randomCode(): string {
  const bytes = randomBytes(4);
  let s = '';
  for (let i = 0; i < 4; i++) s += CODE_LETTERS[bytes[i] % CODE_LETTERS.length];
  return s;
}

export function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
}

function pickSettings(input: Partial<GameSettings> | undefined): Partial<GameSettings> {
  const out: Partial<GameSettings> = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of ['startMoney', 'maxRounds', 'turnTimeoutSec'] as const) {
    if (typeof input[k] === 'number') out[k] = input[k];
  }
  return out;
}
