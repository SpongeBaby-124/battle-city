import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { config } from './config';
import { Logger } from './logger';
import { RoomManager } from './RoomManager';
import { InputValidator } from './InputValidator';
import { GameStateManager } from './GameStateManager';
import { GameEngine } from './GameEngine';
import { SocketEvent, ErrorType, PlayerInput, GameStateEvent } from './types';

// 创建Express应用
const app = express();

// 配置CORS
app.use(cors(config.cors));

// 创建房间管理器
const roomManager = new RoomManager();

// 创建输入验证器
const inputValidator = new InputValidator();
inputValidator.startCleanup();

// 创建游戏状态管理器
const gameStateManager = new GameStateManager();

// 游戏引擎映射（roomId -> GameEngine）
const gameEngines: Map<string, GameEngine> = new Map();

// 状态广播定时器映射（roomId -> NodeJS.Timeout）
const broadcastIntervals: Map<string, NodeJS.Timeout> = new Map();

// 健康检查端点
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    rooms: roomManager.getRoomCount(),
    players: roomManager.getPlayerCount(),
  });
});

// 创建HTTP服务器
const httpServer = createServer(app);

// 创建Socket.IO服务器
const io = new SocketIOServer(httpServer, {
  cors: config.cors,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Socket.IO连接处理
io.on('connection', (socket) => {
  Logger.info(`Client connected: ${socket.id}`);

  // 创建房间
  socket.on(SocketEvent.CREATE_ROOM, () => {
    try {
      const { roomId, sessionId } = roomManager.createRoom(socket.id);

      // 加入Socket.IO房间
      socket.join(roomId);

      // 返回房间信息
      socket.emit(SocketEvent.ROOM_CREATED, {
        roomId,
        sessionId,
        role: 'host',
      });

      Logger.info(`Room created: ${roomId} by ${socket.id}`);
    } catch (error) {
      Logger.error(`Error creating room: ${socket.id}`, error);
      socket.emit(SocketEvent.ROOM_ERROR, {
        type: ErrorType.SERVER_ERROR,
        message: '创建房间失败',
      });
    }
  });

  // 加入房间
  socket.on(SocketEvent.JOIN_ROOM, (data: { roomId: string }) => {
    try {
      const { roomId } = data;
      const result = roomManager.joinRoom(roomId, socket.id);

      // 检查是否有错误
      if ('type' in result) {
        socket.emit(SocketEvent.ROOM_ERROR, result);
        return;
      }

      // 加入Socket.IO房间
      socket.join(roomId);

      // 通知加入者
      socket.emit(SocketEvent.ROOM_JOINED, {
        roomId,
        sessionId: result.sessionId,
        role: 'guest',
      });

      // 通知房间内其他玩家
      socket.to(roomId).emit(SocketEvent.PLAYER_JOINED, {
        role: 'guest',
      });

      // 检查是否可以开始游戏
      const room = roomManager.getRoom(roomId);
      if (room && room.players.size === config.room.maxPlayers) {
        if (roomManager.startGame(roomId)) {
          // 创建并启动游戏引擎
          const engine = new GameEngine(roomId);
          gameEngines.set(roomId, engine);
          engine.start();

          // 生成游戏初始状态
          const initialState = gameStateManager.generateInitialState(roomId);

          // 通知所有玩家游戏开始并发送初始状态
          io.to(roomId).emit(SocketEvent.GAME_START, {
            timestamp: Date.now(),
          });

          io.to(roomId).emit(SocketEvent.GAME_STATE_INIT, initialState);

          // 启动状态广播（每16ms，约60FPS）
          const broadcastInterval = setInterval(() => {
            const gameEngine = gameEngines.get(roomId);
            if (gameEngine) {
              io.to(roomId).emit(SocketEvent.STATE_SYNC, gameEngine.getState());
            }
          }, 16);
          broadcastIntervals.set(roomId, broadcastInterval);

          Logger.info(`Game started in room: ${roomId} with server game engine`);
        }
      }

      Logger.info(`Player joined room: ${roomId}, socket: ${socket.id}`);
    } catch (error) {
      Logger.error(`Error joining room: ${socket.id}`, error);
      socket.emit(SocketEvent.ROOM_ERROR, {
        type: ErrorType.SERVER_ERROR,
        message: '加入房间失败',
      });
    }
  });

  // 离开房间
  socket.on(SocketEvent.LEAVE_ROOM, () => {
    try {
      const roomId = roomManager.getRoomIdBySocket(socket.id);
      if (roomId) {
        // 通知房间内其他玩家
        socket.to(roomId).emit(SocketEvent.PLAYER_LEFT);

        // 离开Socket.IO房间
        socket.leave(roomId);

        // 从房间管理器中移除
        roomManager.leaveRoom(socket.id);

        // 清理游戏引擎
        const gameEngine = gameEngines.get(roomId);
        if (gameEngine) {
          gameEngine.stop();
          gameEngines.delete(roomId);
        }

        // 清理广播定时器
        const broadcastInterval = broadcastIntervals.get(roomId);
        if (broadcastInterval) {
          clearInterval(broadcastInterval);
          broadcastIntervals.delete(roomId);
        }

        Logger.info(`Player left room: ${roomId}, socket: ${socket.id}`);
      }
    } catch (error) {
      Logger.error(`Error leaving room: ${socket.id}`, error);
    }
  });

  // 重连
  socket.on(SocketEvent.RECONNECT, (data: { sessionId: string }) => {
    try {
      const { sessionId } = data;
      const result = roomManager.reconnect(sessionId, socket.id);

      // 检查是否有错误
      if ('type' in result) {
        socket.emit(SocketEvent.RECONNECT_FAILED, result);
        return;
      }

      const { roomId, role } = result;

      // 重新加入Socket.IO房间
      socket.join(roomId);

      // 通知重连成功
      socket.emit(SocketEvent.RECONNECT_SUCCESS, {
        roomId,
        role,
      });

      // 通知对手玩家重连
      socket.to(roomId).emit(SocketEvent.OPPONENT_RECONNECTED);

      Logger.info(`Player reconnected: ${socket.id}, room: ${roomId}, role: ${role}`);
    } catch (error) {
      Logger.error(`Error reconnecting: ${socket.id}`, error);
      socket.emit(SocketEvent.RECONNECT_FAILED, {
        type: ErrorType.SERVER_ERROR,
        message: '重连失败',
      });
    }
  });

  // 玩家输入同步
  socket.on(SocketEvent.PLAYER_INPUT, (data: PlayerInput) => {
    try {
      const roomId = roomManager.getRoomIdBySocket(socket.id);
      if (!roomId) {
        Logger.warn(`Player input from non-room socket: ${socket.id}`);
        return;
      }

      // 验证输入合法性
      if (!inputValidator.validateInput(data)) {
        Logger.warn(`Invalid input from socket: ${socket.id}`, data);
        socket.emit(SocketEvent.ROOM_ERROR, {
          type: ErrorType.INVALID_INPUT,
          message: '无效的输入',
        });
        return;
      }

      // 检查速率限制
      if (!inputValidator.checkRateLimit(socket.id)) {
        Logger.warn(`Rate limit exceeded for socket: ${socket.id}`);
        socket.emit(SocketEvent.ROOM_ERROR, {
          type: ErrorType.INVALID_INPUT,
          message: '输入速率过快',
        });
        return;
      }

      // 获取玩家角色
      const room = roomManager.getRoom(roomId);
      if (!room) {
        return;
      }

      let playerRole: 'host' | 'guest' | null = null;
      for (const [role, player] of room.players.entries()) {
        if (player.socketId === socket.id) {
          playerRole = role;
          break;
        }
      }

      if (!playerRole) {
        Logger.warn(`Could not determine player role for socket: ${socket.id}`);
        return;
      }

      // 将输入发送给游戏引擎
      const gameEngine = gameEngines.get(roomId);
      if (gameEngine) {
        gameEngine.handleInput(playerRole, data);
      }

      Logger.debug(`Player input: ${socket.id}, role: ${playerRole}, direction: ${data.direction}`);
    } catch (error) {
      Logger.error(`Error handling player input: ${socket.id}`, error);
    }
  });

  // 游戏状态事件同步
  socket.on(SocketEvent.GAME_STATE_EVENT, (data: GameStateEvent) => {
    try {
      const roomId = roomManager.getRoomIdBySocket(socket.id);
      if (!roomId) {
        Logger.warn(`Game state event from non-room socket: ${socket.id}`);
        return;
      }

      // 添加服务器时间戳
      const eventWithTimestamp: GameStateEvent = {
        ...data,
        timestamp: Date.now(),
      };

      // 广播给房间内的所有玩家（包括发送者）
      io.to(roomId).emit(SocketEvent.GAME_STATE_EVENT, eventWithTimestamp);

      Logger.debug(`Game state event: ${socket.id}, type: ${data.type}`);
    } catch (error) {
      Logger.error(`Error handling game state event: ${socket.id}`, error);
    }
  });

  // Ping/Pong用于延迟测量
  socket.on(SocketEvent.PING, (data: { timestamp: number }) => {
    socket.emit(SocketEvent.PONG, {
      clientTimestamp: data.timestamp,
      serverTimestamp: Date.now(),
    });
  });

  // 游戏结束
  socket.on(SocketEvent.GAME_OVER, (data: { winner: 'host' | 'guest' | 'draw'; reason: string }) => {
    try {
      const roomId = roomManager.getRoomIdBySocket(socket.id);
      if (!roomId) {
        Logger.warn(`Game over from non-room socket: ${socket.id}`);
        return;
      }

      // 结束游戏
      roomManager.endGame(roomId);

      // 广播游戏结束事件
      io.to(roomId).emit(SocketEvent.GAME_OVER, {
        winner: data.winner,
        reason: data.reason,
        timestamp: Date.now(),
      });

      Logger.info(`Game over in room: ${roomId}, winner: ${data.winner}, reason: ${data.reason}`);
    } catch (error) {
      Logger.error(`Error handling game over: ${socket.id}`, error);
    }
  });

  // 断开连接
  socket.on('disconnect', (reason) => {
    Logger.info(`Client disconnected: ${socket.id}, reason: ${reason}`);

    // 清理输入验证器的速率记录
    inputValidator.clearRateLimit(socket.id);

    const roomId = roomManager.getRoomIdBySocket(socket.id);
    if (roomId) {
      // 更新玩家状态为断开
      roomManager.updatePlayerStatus(socket.id, 'disconnected');

      // 通知对手玩家断线
      socket.to(roomId).emit(SocketEvent.OPPONENT_DISCONNECTED);

      // 设置超时，如果30秒内未重连则移除玩家
      setTimeout(() => {
        const room = roomManager.getRoom(roomId);
        if (room) {
          // 检查玩家是否仍然断线
          for (const player of room.players.values()) {
            if (player.socketId === socket.id && player.status === 'disconnected') {
              Logger.info(`Player timeout: ${socket.id}, removing from room ${roomId}`);
              roomManager.leaveRoom(socket.id);
              io.to(roomId).emit(SocketEvent.PLAYER_LEFT);
              break;
            }
          }
        }
      }, config.room.reconnectTimeout);
    }
  });

  socket.on('error', (error) => {
    Logger.error(`Socket error: ${socket.id}`, error);
  });
});

// 启动服务器
const PORT = config.port;
httpServer.listen(PORT, () => {
  Logger.info(`Battle City WebSocket Server started on port ${PORT}`);
  Logger.info(`CORS origin: ${config.cors.origin}`);
  Logger.info(`Log level: ${config.logLevel}`);
});

// 优雅关闭
process.on('SIGTERM', () => {
  Logger.info('SIGTERM signal received: closing HTTP server');
  httpServer.close(() => {
    Logger.info('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  Logger.info('SIGINT signal received: closing HTTP server');
  httpServer.close(() => {
    Logger.info('HTTP server closed');
    process.exit(0);
  });
});

export { io, app, httpServer };
