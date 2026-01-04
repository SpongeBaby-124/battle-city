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
  INPUT_ACK = 'input_ack', // 输入确认（用于客户端预测校正）
  
  // 状态同步
  GAME_STATE_EVENT = 'game_state_event',
  STATE_SYNC = 'state_sync',
  
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

// 玩家输入数据
export interface PlayerInput {
  type: 'move' | 'fire' | 'direction';
  direction?: 'up' | 'down' | 'left' | 'right';
  timestamp: number;
  sequenceId?: number; // 输入序列号（用于客户端预测）
}

// 游戏状态事件类型
export type GameStateEventType =
  | 'bullet_create'
  | 'bullet_destroy'
  | 'tank_hit'
  | 'tank_destroy'
  | 'map_destroy'
  | 'enemy_destroy'
  | 'enemy_spawn'
  | 'bricks_removed'
  | 'steels_removed'
  | 'eagle_destroyed'
  | 'game_over';

// 游戏状态事件
export interface GameStateEvent {
  type: GameStateEventType;
  data: any;
  timestamp: number;
}

// 地图破坏事件数据
export interface MapDestroyEventData {
  bricks?: number[]; // 被破坏的砖块索引数组
  steels?: number[]; // 被破坏的钢块索引数组
}

// 敌人摧毁事件数据
export interface EnemyDestroyEventData {
  tankId: TankId;
  x: number;
  y: number;
  level: TankLevel;
}

// 敌人生成事件数据
export interface EnemySpawnEventData {
  tankId: TankId;
  x: number;
  y: number;
  level: TankLevel;
  hp: number;
  withPowerUp: boolean;
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

// 游戏状态快照（用于状态同步校验）
export interface GameStateSnapshot {
  timestamp: number;
  tanks: Array<{
    tankId: TankId;
    x: number;
    y: number;
    hp: number;
    alive: boolean;
  }>;
  bullets: Array<{
    bulletId: BulletId;
    x: number;
    y: number;
  }>;
  bricksCount: number;
  steelsCount: number;
  eagleAlive: boolean;
}

// 输入确认数据（服务器确认客户端输入）
export interface InputAck {
  sequenceId: number; // 确认的输入序列号
  serverState: {
    x: number;
    y: number;
    direction: Direction;
  };
  timestamp: number;
}
