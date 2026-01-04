import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { config } from './config';
import { Logger } from './logger';
import { RoomManager } from './RoomManager';
import { InputValidator } from './InputValidator';
import { GameStateManager } from './GameStateManager';
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

// 敌人生成定时器映射
const enemySpawnTimers = new Map<string, NodeJS.Timeout>();

// 状态同步定时器映射
const stateSyncTimers = new Map<string, NodeJS.Timeout>();

// 启动敌人生成定时器
function startEnemySpawnTimer(roomId: string): void {
  // 清除已存在的定时器
  stopEnemySpawnTimer(roomId);
  
  // 初始生成4个敌人
  for (let i = 0; i < 4; i++) {
    const enemyData = gameStateManager.spawnNextEnemy(roomId);
    if (enemyData) {
      io.to(roomId).emit(SocketEvent.GAME_STATE_EVENT, {
        type: 'enemy_spawn',
        data: enemyData,
        timestamp: Date.now(),
      });
    }
  }
  
  // 每3秒生成一个新敌人
  const timer = setInterval(() => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'playing') {
      stopEnemySpawnTimer(roomId);
      return;
    }
    
    const enemyData = gameStateManager.spawnNextEnemy(roomId);
    if (enemyData) {
      io.to(roomId).emit(SocketEvent.GAME_STATE_EVENT, {
        type: 'enemy_spawn',
        data: enemyData,
        timestamp: Date.now(),
      });
      Logger.info(`Enemy spawned in room ${roomId}:`, enemyData);
    } else {
      // 没有更多敌人，停止定时器
      Logger.info(`All enemies spawned in room ${roomId}`);
      stopEnemySpawnTimer(roomId);
    }
  }, 3000);
  
  enemySpawnTimers.set(roomId, timer);
  Logger.info(`Enemy spawn timer started for room ${roomId}`);
}

// 停止敌人生成定时器
function stopEnemySpawnTimer(roomId: string): void {
  const timer = enemySpawnTimers.get(roomId);
  if (timer) {
    clearInterval(timer);
    enemySpawnTimers.delete(roomId);
    Logger.info(`Enemy spawn timer stopped for room ${roomId}`);
  }
}

// 启动状态同步定时器
function startStateSyncTimer(roomId: string): void {
  // 清除已存在的定时器
  stopStateSyncTimer(roomId);
  
  // 每5秒发送一次状态同步请求
  const timer = setInterval(() => {
    const room = roomManager.getRoom(roomId);
    if (!room || room.status !== 'playing') {
      stopStateSyncTimer(roomId);
      return;
    }
    
    // 请求客户端发送当前状态快照
    io.to(roomId).emit(SocketEvent.STATE_SYNC, {
      timestamp: Date.now(),
      requestSnapshot: true,
    });
    
    Logger.debug(`State sync requested for room ${roomId}`);
  }, 5000);
  
  stateSyncTimers.set(roomId, timer);
  Logger.info(`State sync timer started for room ${roomId}`);
}

// 停止状态同步定时器
function stopStateSyncTimer(roomId: string): void {
  const timer = stateSyncTimers.get(roomId);
  if (timer) {
    clearInterval(timer);
    stateSyncTimers.delete(roomId);
    Logger.info(`State sync timer stopped for room ${roomId}`);
  }
}

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
          // 生成游戏初始状态
          const initialState = gameStateManager.generateInitialState(roomId);
          
          // 初始化敌人队列
          gameStateManager.initializeEnemyQueue(roomId);
          
          // 通知所有玩家游戏开始并发送初始状态
          io.to(roomId).emit(SocketEvent.GAME_START, {
            timestamp: Date.now(),
          });
          
          io.to(roomId).emit(SocketEvent.GAME_STATE_INIT, initialState);
          
          // 启动敌人生成定时器（每3秒生成一个敌人）
          startEnemySpawnTimer(roomId);
          
          // 启动状态同步定时器（每5秒同步一次）
          startStateSyncTimer(roomId);
          
          Logger.info(`Game started in room: ${roomId} with initial state`);
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
        // 停止敌人生成定时器
        stopEnemySpawnTimer(roomId);
        
        // 停止状态同步定时器
        stopStateSyncTimer(roomId);
        
        // 清理敌人队列
        gameStateManager.clearEnemyQueue(roomId);
        
        // 通知房间内其他玩家
        socket.to(roomId).emit(SocketEvent.PLAYER_LEFT);
        
        // 离开Socket.IO房间
        socket.leave(roomId);
        
        // 从房间管理器中移除
        roomManager.leaveRoom(socket.id);
        
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

      // 添加服务器时间戳
      const inputWithTimestamp: PlayerInput = {
        ...data,
        timestamp: Date.now(),
      };

      // 广播给房间内的对手
      socket.to(roomId).emit(SocketEvent.OPPONENT_INPUT, inputWithTimestamp);
      
      // 如果输入包含序列号，发送确认给发送者（用于客户端预测校正）
      if (data.sequenceId !== undefined) {
        socket.emit(SocketEvent.INPUT_ACK, {
          sequenceId: data.sequenceId,
          timestamp: Date.now(),
        });
      }

      Logger.debug(`Player input: ${socket.id}, type: ${data.type}, direction: ${data.direction}`);
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
              
              // 停止敌人生成定时器
              stopEnemySpawnTimer(roomId);
              
              // 停止状态同步定时器
              stopStateSyncTimer(roomId);
              
              // 清理敌人队列
              gameStateManager.clearEnemyQueue(roomId);
              
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
