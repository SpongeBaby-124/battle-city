import { io, Socket } from 'socket.io-client';
import {
  SocketEvent,
  PlayerInput,
  GameStateEvent,
  ConnectionStatus,
  RoomInfo,
  ErrorResponse,
  GameInitialState,
} from '../types/multiplayer-types';

/**
 * Socket服务类
 * 封装Socket.IO连接管理和事件处理
 */
export class SocketService {
  private socket: Socket | null = null;
  private serverUrl: string;
  private connectionStatus: ConnectionStatus = 'disconnected';
  private eventHandlers: Map<string, Function[]> = new Map();
  private roomInfo: RoomInfo | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;

  constructor(serverUrl: string = 'http://localhost:3001') {
    this.serverUrl = serverUrl;
  }

  /**
   * 连接到服务器
   */
  connect(): void {
    if (this.socket && this.socket.connected) {
      console.log('Already connected');
      return;
    }

    this.connectionStatus = 'connecting';
    this.notifyStatusChange();

    this.socket = io(this.serverUrl, {
      reconnection: true,
      reconnectionAttempts: this.maxReconnectAttempts,
      reconnectionDelay: 1000,
    });

    this.setupSocketListeners();
  }

  /**
   * 断开连接
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connectionStatus = 'disconnected';
    this.roomInfo = null;
    this.notifyStatusChange();
  }

  /**
   * 设置Socket事件监听器
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    // 连接成功
    this.socket.on('connect', () => {
      console.log('Connected to server:', this.socket!.id);
      this.connectionStatus = 'connected';
      this.reconnectAttempts = 0;
      this.notifyStatusChange();
    });

    // 连接断开
    this.socket.on('disconnect', (reason) => {
      console.log('Disconnected from server:', reason);
      this.connectionStatus = 'disconnected';
      this.notifyStatusChange();
    });

    // 连接错误
    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      this.connectionStatus = 'error';
      this.notifyStatusChange();
    });

    // 重连尝试
    this.socket.on('reconnect_attempt', (attempt) => {
      console.log('Reconnecting... attempt:', attempt);
      this.connectionStatus = 'reconnecting';
      this.reconnectAttempts = attempt;
      this.notifyStatusChange();
    });

    // 重连成功
    this.socket.on('reconnect', () => {
      console.log('Reconnected to server');
      this.connectionStatus = 'connected';
      this.reconnectAttempts = 0;
      this.notifyStatusChange();

      // 如果有房间信息，尝试重新加入
      if (this.roomInfo) {
        this.attemptReconnect(this.roomInfo.sessionId);
      }
    });

    // 房间创建成功
    this.socket.on(SocketEvent.ROOM_CREATED, (data: RoomInfo) => {
      console.log('Room created:', data);
      this.roomInfo = data;
      this.emit(SocketEvent.ROOM_CREATED, data);
    });

    // 加入房间成功
    this.socket.on(SocketEvent.ROOM_JOINED, (data: RoomInfo) => {
      console.log('Room joined:', data);
      this.roomInfo = data;
      this.emit(SocketEvent.ROOM_JOINED, data);
    });

    // 房间错误
    this.socket.on(SocketEvent.ROOM_ERROR, (error: ErrorResponse) => {
      console.error('Room error:', error);
      this.emit(SocketEvent.ROOM_ERROR, error);
    });

    // 玩家加入
    this.socket.on(SocketEvent.PLAYER_JOINED, (data) => {
      console.log('Player joined:', data);
      this.emit(SocketEvent.PLAYER_JOINED, data);
    });

    // 玩家离开
    this.socket.on(SocketEvent.PLAYER_LEFT, () => {
      console.log('Player left');
      this.emit(SocketEvent.PLAYER_LEFT);
    });

    // 游戏开始
    this.socket.on(SocketEvent.GAME_START, (data) => {
      console.log('Game start:', data);
      this.emit(SocketEvent.GAME_START, data);
    });

    // 游戏初始状态
    this.socket.on(SocketEvent.GAME_STATE_INIT, (data: GameInitialState) => {
      console.log('Game state init:', data);
      this.emit(SocketEvent.GAME_STATE_INIT, data);
    });

    // 游戏结束
    this.socket.on(SocketEvent.GAME_OVER, (data) => {
      console.log('Game over:', data);
      this.emit(SocketEvent.GAME_OVER, data);
    });

    // 对手输入
    this.socket.on(SocketEvent.OPPONENT_INPUT, (data: PlayerInput) => {
      this.emit(SocketEvent.OPPONENT_INPUT, data);
    });

    // 游戏状态事件
    this.socket.on(SocketEvent.GAME_STATE_EVENT, (data: GameStateEvent) => {
      this.emit(SocketEvent.GAME_STATE_EVENT, data);
    });

    // 服务器状态同步（服务器权威模式）
    this.socket.on(SocketEvent.STATE_SYNC, (data: any) => {
      this.emit(SocketEvent.STATE_SYNC, data);
    });

    // Pong响应
    this.socket.on(SocketEvent.PONG, (data) => {
      this.emit(SocketEvent.PONG, data);
    });

    // 对手断线
    this.socket.on(SocketEvent.OPPONENT_DISCONNECTED, () => {
      console.log('Opponent disconnected');
      this.emit(SocketEvent.OPPONENT_DISCONNECTED);
    });

    // 对手重连
    this.socket.on(SocketEvent.OPPONENT_RECONNECTED, () => {
      console.log('Opponent reconnected');
      this.emit(SocketEvent.OPPONENT_RECONNECTED);
    });

    // 重连成功
    this.socket.on(SocketEvent.RECONNECT_SUCCESS, (data) => {
      console.log('Reconnect success:', data);
      this.roomInfo = { ...this.roomInfo!, ...data };
      this.emit(SocketEvent.RECONNECT_SUCCESS, data);
    });

    // 重连失败
    this.socket.on(SocketEvent.RECONNECT_FAILED, (error: ErrorResponse) => {
      console.error('Reconnect failed:', error);
      this.roomInfo = null;
      this.emit(SocketEvent.RECONNECT_FAILED, error);
    });
  }

  /**
   * 创建房间
   */
  createRoom(): void {
    if (!this.socket || !this.socket.connected) {
      console.error('Not connected to server');
      return;
    }
    this.socket.emit(SocketEvent.CREATE_ROOM);
  }

  /**
   * 加入房间
   */
  joinRoom(roomId: string): void {
    if (!this.socket || !this.socket.connected) {
      console.error('Not connected to server');
      return;
    }
    this.socket.emit(SocketEvent.JOIN_ROOM, { roomId });
  }

  /**
   * 离开房间
   */
  leaveRoom(): void {
    if (!this.socket || !this.socket.connected) {
      console.error('Not connected to server');
      return;
    }
    this.socket.emit(SocketEvent.LEAVE_ROOM);
    this.roomInfo = null;
  }

  /**
   * 尝试重连
   */
  private attemptReconnect(sessionId: string): void {
    if (!this.socket || !this.socket.connected) {
      console.error('Not connected to server');
      return;
    }
    this.socket.emit(SocketEvent.RECONNECT, { sessionId });
  }

  /**
   * 发送玩家输入
   */
  sendPlayerInput(input: PlayerInput): void {
    if (!this.socket || !this.socket.connected) {
      return;
    }
    this.socket.emit(SocketEvent.PLAYER_INPUT, input);
  }

  /**
   * 发送游戏状态事件
   */
  sendGameStateEvent(event: GameStateEvent): void {
    if (!this.socket || !this.socket.connected) {
      return;
    }
    this.socket.emit(SocketEvent.GAME_STATE_EVENT, event);
  }

  /**
   * 发送游戏结束事件
   */
  sendGameOver(winner: 'host' | 'guest' | 'draw', reason: string): void {
    if (!this.socket || !this.socket.connected) {
      return;
    }
    this.socket.emit(SocketEvent.GAME_OVER, { winner, reason });
  }

  /**
   * 发送Ping
   */
  sendPing(): void {
    if (!this.socket || !this.socket.connected) {
      return;
    }
    this.socket.emit(SocketEvent.PING, { timestamp: Date.now() });
  }

  /**
   * 注册事件处理器
   */
  on(event: string, handler: Function): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, []);
    }
    this.eventHandlers.get(event)!.push(handler);
  }

  /**
   * 移除事件处理器
   */
  off(event: string, handler: Function): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   */
  private emit(event: string, data?: any): void {
    const handlers = this.eventHandlers.get(event);
    if (handlers) {
      handlers.forEach(handler => handler(data));
    }
  }

  /**
   * 通知连接状态变化
   */
  private notifyStatusChange(): void {
    this.emit('status_change', this.connectionStatus);
  }

  /**
   * 获取连接状态
   */
  getConnectionStatus(): ConnectionStatus {
    return this.connectionStatus;
  }

  /**
   * 获取房间信息
   */
  getRoomInfo(): RoomInfo | null {
    return this.roomInfo;
  }

  /**
   * 是否已连接
   */
  isConnected(): boolean {
    return this.socket !== null && this.socket.connected;
  }
}

// 创建单例实例
export const socketService = new SocketService();

