// 玩家角色类型
export type PlayerRole = 'host' | 'guest';

// 玩家连接状态
export type ConnectionStatus = 'connected' | 'disconnected';

// 玩家信息
export interface Player {
  socketId: string;
  sessionId: string;
  role: PlayerRole;
  status: ConnectionStatus;
  joinedAt: number;
}

// 房间状态
export type RoomStatus = 'waiting' | 'playing' | 'finished';

// 房间信息
export interface Room {
  id: string;
  status: RoomStatus;
  players: Map<PlayerRole, Player>;
  createdAt: number;
  startedAt?: number;
}

// 玩家输入数据
export interface PlayerInput {
  type: 'move' | 'fire' | 'direction';
  direction?: 'up' | 'down' | 'left' | 'right';
  timestamp: number;
  sequenceId?: number; // 输入序列号（用于客户端预测）
}

// 游戏状态事件
export interface GameStateEvent {
  type: 'bullet_create' | 'bullet_destroy' | 'tank_hit' | 'tank_destroy' | 'map_destroy' | 'enemy_destroy' | 'game_over';
  data: any;
  timestamp: number;
}

// Socket事件类型
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
