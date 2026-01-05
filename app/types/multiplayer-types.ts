// Socket事件类型（与服务器端保持一致）
export enum SocketEvent {
  // 房间管理
  CREATE_ROOM = 'create_room',
  JOIN_ROOM = 'join_room',
  LEAVE_ROOM = 'leave_room',
  ROOM_CREATED = 'room_created',
  ROOM_JOINED = 'room_joined',
  ROOM_ERROR = 'room_error',
  PLAYER_JOINED = 'player_joined',
  PLAYER_LEFT = 'player_left',

  // 游戏控制
  GAME_START = 'game_start',
  GAME_OVER = 'game_over',
  GAME_STATE_INIT = 'game_state_init',

  // 输入同步
  PLAYER_INPUT = 'player_input',
  OPPONENT_INPUT = 'opponent_input',

  // 状态同步
  GAME_STATE_EVENT = 'game_state_event',
  STATE_SYNC = 'state_sync',  // 服务器权威模式：接收完整状态

  // 连接管理
  PING = 'ping',
  PONG = 'pong',
  RECONNECT = 'reconnect',
  RECONNECT_SUCCESS = 'reconnect_success',
  RECONNECT_FAILED = 'reconnect_failed',
  OPPONENT_DISCONNECTED = 'opponent_disconnected',
  OPPONENT_RECONNECTED = 'opponent_reconnected',
}

// 玩家角色类型
export type PlayerRole = 'host' | 'guest';

// 连接状态
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

// 玩家输入数据（完整状态）
export interface PlayerInput {
  type: 'state';  // 使用统一的状态类型
  direction?: 'up' | 'down' | 'left' | 'right';  // 当前方向
  moving: boolean;  // 是否正在移动
  firing: boolean;  // 是否正在开火
  timestamp: number;
}

// 游戏状态事件类型
export type GameStateEventType =
  | 'tank_spawn'      // 坦克生成
  | 'tank_move'       // 坦克移动（用于AI坦克同步）
  | 'tank_fire'       // 坦克开火
  | 'tank_destroy'    // 坦克被摧毁
  | 'bullet_create'   // 子弹创建
  | 'bullet_destroy'  // 子弹销毁
  | 'map_destroy'     // 地图破坏
  | 'powerup_spawn'   // 道具生成
  | 'powerup_pickup'  // 道具拾取
  | 'full_sync';      // 完整状态同步

// 游戏状态事件
export interface GameStateEvent {
  type: GameStateEventType;
  data: any;
  timestamp: number;
  sender?: 'host' | 'guest';  // 发送者角色
}

// 游戏初始状态
export interface GameInitialState {
  seed: number;
  mapId: number;
  hostPosition: { x: number; y: number };
  guestPosition: { x: number; y: number };
  hostTankColor: 'yellow' | 'green';
  guestTankColor: 'yellow' | 'green';
  timestamp: number;
}

// 错误类型
export enum ErrorType {
  ROOM_NOT_FOUND = 'room_not_found',
  ROOM_FULL = 'room_full',
  INVALID_INPUT = 'invalid_input',
  UNAUTHORIZED = 'unauthorized',
  SERVER_ERROR = 'server_error',
}

// 错误响应
export interface ErrorResponse {
  type: ErrorType;
  message: string;
}

// 房间信息
export interface RoomInfo {
  roomId: string;
  sessionId: string;
  role: PlayerRole;
}

// 网络状态
export interface NetworkStats {
  ping: number; // 延迟（毫秒）
  lastPingTime: number; // 上次ping时间
  connectionStatus: ConnectionStatus;
}

// ==================== 服务器权威模式类型 ====================

// 方向类型
export type Direction = 'up' | 'down' | 'left' | 'right';

// 坦克阵营
export type TankSide = 'player' | 'bot';

// 坦克等级
export type TankLevel = 'basic' | 'fast' | 'power' | 'armor';

// 坦克颜色
export type TankColor = 'yellow' | 'green' | 'silver' | 'red';

// 服务器坦克状态
export interface ServerTankState {
  tankId: number;
  x: number;
  y: number;
  direction: Direction;
  moving: boolean;
  alive: boolean;
  side: TankSide;
  level: TankLevel;
  color: TankColor;
  hp: number;
  helmetDuration: number;
  frozenTimeout: number;
  cooldown: number;
  withPowerUp: boolean;
}

// 服务器子弹状态
export interface ServerBulletState {
  bulletId: number;
  x: number;
  y: number;
  direction: Direction;
  speed: number;
  tankId: number;
  power: number;
}

// 服务器地图状态
export interface ServerMapState {
  bricks: boolean[];
  steels: boolean[];
  eagleBroken: boolean;
}

// 服务器玩家信息
export interface ServerPlayerState {
  lives: number;
  score: number;
  activeTankId: number | null;
}

// 服务器状态同步负载
export interface ServerStateSyncPayload {
  tanks: ServerTankState[];
  bullets: ServerBulletState[];
  map: ServerMapState;
  players: {
    host: ServerPlayerState;
    guest: ServerPlayerState;
  };
  remainingBots: number;
  gameStatus: 'waiting' | 'playing' | 'paused' | 'finished';
  timestamp: number;
}
