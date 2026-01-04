import { call, delay, put, race, select, take } from 'redux-saga/effects';
import { eventChannel, EventChannel } from 'redux-saga';
import { Set as ISet } from 'immutable';
import { State } from '../reducers';
import { A } from '../utils/actions';
import { socketService } from '../utils/SocketService';
import { SocketEvent, PlayerInput, GameStateEvent } from '../types/multiplayer-types';
import * as actions from '../utils/actions';
import * as multiplayerActions from '../utils/multiplayerActions';
import fireController from './fireController';

/**
 * 创建对手输入事件通道
 */
function createOpponentInputChannel(): EventChannel<PlayerInput> {
  return eventChannel(emitter => {
    const handler = (input: PlayerInput) => {
      emitter(input);
    };

    socketService.on(SocketEvent.OPPONENT_INPUT, handler);

    // 返回取消订阅函数
    return () => {
      socketService.off(SocketEvent.OPPONENT_INPUT, handler);
    };
  });
}

/**
 * 创建游戏状态事件通道
 */
function createGameStateEventChannel(): EventChannel<GameStateEvent> {
  return eventChannel(emitter => {
    const handler = (event: GameStateEvent) => {
      emitter(event);
    };

    socketService.on(SocketEvent.GAME_STATE_EVENT, handler);

    // 返回取消订阅函数
    return () => {
      socketService.off(SocketEvent.GAME_STATE_EVENT, handler);
    };
  });
}

/**
 * 创建状态同步事件通道
 */
function createStateSyncChannel(): EventChannel<any> {
  return eventChannel(emitter => {
    const handler = (data: any) => {
      emitter(data);
    };

    socketService.on(SocketEvent.STATE_SYNC, handler);

    // 返回取消订阅函数
    return () => {
      socketService.off(SocketEvent.STATE_SYNC, handler);
    };
  });
}

/**
 * 创建对手断线事件通道
 */
function createOpponentDisconnectChannel(): EventChannel<void> {
  return eventChannel(emitter => {
    const handler = () => {
      emitter();
    };

    socketService.on(SocketEvent.OPPONENT_DISCONNECTED, handler);

    return () => {
      socketService.off(SocketEvent.OPPONENT_DISCONNECTED, handler);
    };
  });
}

/**
 * 创建对手重连事件通道
 */
function createOpponentReconnectChannel(): EventChannel<void> {
  return eventChannel(emitter => {
    const handler = () => {
      emitter();
    };

    socketService.on(SocketEvent.OPPONENT_RECONNECTED, handler);

    return () => {
      socketService.off(SocketEvent.OPPONENT_RECONNECTED, handler);
    };
  });
}

/**
 * 监听对手输入事件
 */
function* watchOpponentInput() {
  const channel: EventChannel<PlayerInput> = yield call(createOpponentInputChannel);

  try {
    while (true) {
      const input: PlayerInput = yield take(channel);
      yield call(handleOpponentInput, input);
    }
  } finally {
    channel.close();
  }
}

/**
 * 监听游戏状态事件
 */
function* watchGameStateEvents() {
  const channel: EventChannel<GameStateEvent> = yield call(createGameStateEventChannel);

  try {
    while (true) {
      const event: GameStateEvent = yield take(channel);
      yield call(handleGameStateEvent, event);
    }
  } finally {
    channel.close();
  }
}

/**
 * 监听状态同步事件
 */
function* watchStateSync() {
  const channel: EventChannel<any> = yield call(createStateSyncChannel);

  try {
    while (true) {
      const data: any = yield take(channel);
      if (data.requestSnapshot) {
        // 服务器请求状态快照，生成并发送当前状态
        yield call(sendStateSnapshot);
      }
    }
  } finally {
    channel.close();
  }
}

/**
 * 监听对手断线事件
 */
function* watchOpponentDisconnect() {
  const channel: EventChannel<void> = yield call(createOpponentDisconnectChannel);

  try {
    while (true) {
      yield take(channel);
      console.log('Opponent disconnected, pausing game...');
      
      // 暂停游戏
      yield put(actions.gamePause());
      
      // 显示提示信息（通过更新multiplayer状态）
      yield put(multiplayerActions.setOpponentDisconnected(true));
      
      // 启动超时计时器（60秒）
      const { timeout }: any = yield race({
        reconnect: take(channel), // 等待重连通道的消息（实际由watchOpponentReconnect处理）
        timeout: delay(60000), // 60秒超时
      });
      
      if (timeout) {
        // 超时，对手未重连，结束游戏
        console.log('Opponent reconnect timeout, ending game...');
        yield put(multiplayerActions.setOpponentDisconnected(false));
        
        // 判定为胜利
        const state: State = yield select();
        const role = state.multiplayer.roomInfo?.role;
        socketService.sendGameOver(role || 'host', 'opponent_timeout');
        
        // 返回大厅
        yield put(multiplayerActions.disableMultiplayer());
        yield put(actions.leaveGameScene());
      }
    }
  } finally {
    channel.close();
  }
}

/**
 * 监听对手重连事件
 */
function* watchOpponentReconnect() {
  const channel: EventChannel<void> = yield call(createOpponentReconnectChannel);

  try {
    while (true) {
      yield take(channel);
      console.log('Opponent reconnected, resuming game...');
      
      // 恢复游戏
      yield put(actions.gameResume());
      
      // 隐藏提示信息
      yield put(multiplayerActions.setOpponentDisconnected(false));
      
      // 发送当前状态快照给对手（帮助对手恢复状态）
      yield call(sendStateSnapshot);
    }
  } finally {
    channel.close();
  }
}

/**
 * 生成并发送当前游戏状态快照
 */
function* sendStateSnapshot() {
  const state: State = yield select();
  
  // 生成状态快照
  const snapshot = {
    timestamp: Date.now(),
    tanks: state.tanks.toArray().map(tank => ({
      tankId: tank.tankId,
      x: tank.x,
      y: tank.y,
      hp: tank.hp,
      alive: tank.alive,
    })),
    bullets: state.bullets.toArray().map(bullet => ({
      bulletId: bullet.bulletId,
      x: bullet.x,
      y: bullet.y,
    })),
    bricksCount: state.map.bricks.count(),
    steelsCount: state.map.steels.count(),
    eagleAlive: state.map.eagle,
  };
  
  // 发送快照到服务器（服务器会转发给对手进行比对）
  socketService.emit(SocketEvent.STATE_SYNC, snapshot);
  
  console.log('State snapshot sent:', snapshot);
}

/**
 * 处理游戏状态事件
 */
function* handleGameStateEvent(event: GameStateEvent) {
  const state: State = yield select();

  // 检查是否在联机模式
  if (!state.multiplayer.enabled || !state.multiplayer.roomInfo) {
    return;
  }

  console.log('Received game state event:', event.type, event.data);

  switch (event.type) {
    case 'enemy_spawn':
      // 应用敌人生成
      if (event.data) {
        const { tankId, x, y, level, hp, withPowerUp } = event.data;
        const { TankRecord } = yield import('../types');
        const tank = new TankRecord({
          tankId,
          x,
          y,
          side: 'bot',
          level,
          hp,
          withPowerUp,
          frozenTimeout: state.game.botFrozenTimeout,
        });
        
        // 生成坦克动画
        const { spawnTank } = yield import('./common');
        yield put(actions.setIsSpawningBotTank(true));
        yield call(spawnTank, tank, 1);
        yield put(actions.setIsSpawningBotTank(false));
        
        // 启动敌人AI
        const { default: botSaga } = yield import('./BotSaga');
        const { fork } = yield import('redux-saga/effects');
        yield fork(botSaga, tankId);
        
        console.log('Enemy spawned from server:', tankId);
      }
      break;

    case 'bricks_removed':
      // 应用砖块破坏
      if (event.data.bricks && Array.isArray(event.data.bricks)) {
        yield put(actions.removeBricks(ISet(event.data.bricks)));
      }
      break;

    case 'steels_removed':
      // 应用钢块破坏
      if (event.data.steels && Array.isArray(event.data.steels)) {
        yield put(actions.removeSteels(ISet(event.data.steels)));
      }
      break;

    case 'eagle_destroyed':
      // 应用老鹰被摧毁
      yield put(actions.destroyEagle());
      break;

    case 'enemy_destroy':
      // 应用敌人摧毁（这里只需要确保视觉效果同步，实际的坦克状态由各自的saga管理）
      // 可以在这里添加额外的同步逻辑，比如确保分数统计一致
      console.log('Enemy destroyed:', event.data);
      break;

    default:
      console.warn('Unknown game state event type:', event.type);
  }
}

// 存储对手射击状态
let opponentFireState = {
  firing: false,
  tankId: null as TankId | null,
};

/**
 * 获取对手是否应该射击
 */
export function shouldOpponentFire(tankId: TankId): boolean {
  return opponentFireState.tankId === tankId && opponentFireState.firing;
}

/**
 * 处理对手输入
 */
function* handleOpponentInput(input: PlayerInput) {
  const state: State = yield select();

  // 检查是否在联机模式
  if (!state.multiplayer.enabled || !state.multiplayer.roomInfo) {
    return;
  }

  // 确定对手坦克ID：通过对手的 player 状态获取
  const role = state.multiplayer.roomInfo.role;
  // 主机控制 player1，所以对手是 player2
  // 客机控制 player2，所以对手是 player1
  const opponentPlayer = role === 'host' ? state.player2 : state.player1;
  const opponentTankId = opponentPlayer.activeTankId;

  if (opponentTankId === -1) {
    // 对手坦克还未激活
    return;
  }

  // 获取对手坦克
  const opponentTank = state.tanks.get(opponentTankId);
  if (!opponentTank) {
    console.warn('Opponent tank not found:', opponentTankId);
    return;
  }

  // 根据输入类型应用动作
  if (input.type === 'move' && input.direction) {
    // 移动或转向
    if (input.direction !== opponentTank.direction) {
      // 转向
      yield put(actions.move(opponentTank.set('direction', input.direction)));
    } else {
      // 继续移动
      if (!opponentTank.moving) {
        yield put(actions.startMove(opponentTankId));
      }
    }
  } else if (input.type === 'fire') {
    // 设置射击状态
    opponentFireState = {
      firing: true,
      tankId: opponentTankId,
    };
  } else if (input.type === 'direction' && input.direction) {
    // 仅转向
    yield put(actions.move(opponentTank.set('direction', input.direction)));
  } else {
    // 停止移动
    if (opponentTank.moving) {
      yield put(actions.stopMove(opponentTankId));
    }
  }
}

/**
 * 每个tick重置对手射击状态
 */
function* resetOpponentFireState() {
  while (true) {
    yield take(A.Tick);
    opponentFireState.firing = false;
  }
}

/**
 * 定期发送ping来测量网络延迟
 */
function* pingLoop() {
  while (true) {
    const state: State = yield select();
    
    if (state.multiplayer.enabled && state.multiplayer.roomInfo) {
      const startTime = Date.now();
      socketService.sendPing();
      
      // 等待pong响应（最多1秒）
      const channel: EventChannel<any> = yield call(createPongChannel);
      const { pong, timeout }: any = yield race({
        pong: take(channel),
        timeout: delay(1000),
      });
      channel.close();
      
      if (pong) {
        const ping = Date.now() - startTime;
        yield put(actions.updateNetworkStats({ ping, lastPingTime: Date.now() }));
      }
    }
    
    // 每2秒ping一次
    yield delay(2000);
  }
}

/**
 * 创建pong事件通道
 */
function createPongChannel(): EventChannel<any> {
  return eventChannel(emitter => {
    const handler = (data: any) => {
      emitter(data);
    };

    socketService.on(SocketEvent.PONG, handler);

    return () => {
      socketService.off(SocketEvent.PONG, handler);
    };
  });
}

/**
 * 获取对手的活跃坦克ID
 */
function getOpponentTankIdFromState(state: State): TankId {
  const role = state.multiplayer.roomInfo?.role;
  const opponentPlayer = role === 'host' ? state.player2 : state.player1;
  return opponentPlayer.activeTankId;
}

/**
 * 联机游戏主saga
 */
export default function* multiplayerGameSaga() {
  while (true) {
    // 等待游戏开始
    yield take(A.MultiplayerGameStart);

    yield race({
      watchInput: call(watchOpponentInput),
      watchGameEvents: call(watchGameStateEvents),
      watchStateSync: call(watchStateSync),
      watchDisconnect: call(watchOpponentDisconnect),
      watchReconnect: call(watchOpponentReconnect),
      // 对手射击使用专门的 fireController，需要每个 tick 检查对手坦克ID
      opponentFireController: call(function* opponentFireLoop() {
        while (true) {
          const currentState: State = yield select();
          const opponentTankId = getOpponentTankIdFromState(currentState);
          if (opponentTankId !== -1) {
            // 运行一个 tick 的 fire check
            yield call(function* singleTickFire() {
              yield race({
                fire: call(fireController, opponentTankId, () => shouldOpponentFire(opponentTankId)),
                tick: take(A.Tick),
              });
            });
          } else {
            yield take(A.Tick);
          }
        }
      }),
      resetFire: call(resetOpponentFireState),
      ping: call(pingLoop),
      leave: take([A.LeaveGameScene, A.DisableMultiplayer]),
    });

    // 清理对手射击状态
    opponentFireState = { firing: false, tankId: null };
  }
}
