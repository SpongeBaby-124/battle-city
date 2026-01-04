import { call, delay, put, race, select, take } from 'redux-saga/effects';
import { eventChannel, EventChannel } from 'redux-saga';
import { State } from '../reducers';
import { A } from '../utils/actions';
import { socketService } from '../utils/SocketService';
import { SocketEvent, PlayerInput } from '../types/multiplayer-types';
import * as actions from '../utils/actions';
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
