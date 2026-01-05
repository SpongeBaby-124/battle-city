import { call, delay, put, race, select, take, fork } from 'redux-saga/effects';
import { eventChannel, EventChannel } from 'redux-saga';
import { State } from '../reducers';
import { A } from '../utils/actions';
import { socketService } from '../utils/SocketService';
import {
  SocketEvent,
  PlayerInput,
  PlayerRole,
  ServerStateSyncPayload,
  ServerTankState,
  ServerBulletState,
} from '../types/multiplayer-types';
import * as actions from '../utils/actions';
import { TankRecord, BulletRecord } from '../types';
import { Map as IMap, Set as ISet } from 'immutable';

/**
 * 创建服务器状态同步事件通道
 */
function createStateSyncChannel(): EventChannel<ServerStateSyncPayload> {
  return eventChannel(emitter => {
    const handler = (data: ServerStateSyncPayload) => {
      emitter(data);
    };

    socketService.on(SocketEvent.STATE_SYNC, handler);

    return () => {
      socketService.off(SocketEvent.STATE_SYNC, handler);
    };
  });
}

/**
 * 创建Pong响应通道
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
 * 存储本地玩家输入状态
 */
let localInputState = {
  direction: null as 'up' | 'down' | 'left' | 'right' | null,
  moving: false,
  firing: false,
};

/**
 * 更新本地输入状态（由 playerController 调用）
 */
export function updateLocalInput(direction: 'up' | 'down' | 'left' | 'right' | null, moving: boolean, firing: boolean) {
  localInputState = { direction, moving, firing };
}

/**
 * 发送本地玩家输入到服务器
 */
function* sendLocalPlayerInput() {
  let lastSentInput = { direction: null as any, moving: false, firing: false };

  while (true) {
    yield take(A.Tick);

    const state: State = yield select();
    if (!state.multiplayer.enabled || !state.multiplayer.roomInfo) {
      continue;
    }

    // 只在输入变化时发送
    if (
      localInputState.direction !== lastSentInput.direction ||
      localInputState.moving !== lastSentInput.moving ||
      localInputState.firing !== lastSentInput.firing
    ) {
      const input: PlayerInput = {
        type: 'state',
        direction: localInputState.direction || undefined,
        moving: localInputState.moving,
        firing: localInputState.firing,
        timestamp: Date.now(),
      };

      socketService.sendPlayerInput(input);
      lastSentInput = { ...localInputState };
    }
  }
}

/**
 * 接收服务器状态并更新本地状态
 */
function* receiveServerState() {
  const channel: EventChannel<ServerStateSyncPayload> = yield call(createStateSyncChannel);

  try {
    while (true) {
      const serverState: ServerStateSyncPayload = yield take(channel);
      yield call(applyServerState, serverState);
    }
  } finally {
    channel.close();
  }
}

/**
 * 应用服务器状态到本地 Redux store
 */
function* applyServerState(serverState: ServerStateSyncPayload) {
  const state: State = yield select();

  if (!state.multiplayer.enabled) {
    return;
  }

  // 同步坦克状态
  for (const tankData of serverState.tanks) {
    const existingTank = state.tanks.get(tankData.tankId);

    if (existingTank) {
      // 更新现有坦克
      const updatedTank = existingTank.merge({
        x: tankData.x,
        y: tankData.y,
        direction: tankData.direction,
        moving: tankData.moving,
        hp: tankData.hp,
        alive: tankData.alive,
        helmetDuration: tankData.helmetDuration,
        frozenTimeout: tankData.frozenTimeout,
        cooldown: tankData.cooldown,
      });
      yield put(actions.move(updatedTank));

      // 同步移动状态
      if (tankData.moving && !existingTank.moving) {
        yield put(actions.startMove(tankData.tankId));
      } else if (!tankData.moving && existingTank.moving) {
        yield put(actions.stopMove(tankData.tankId));
      }

      // 处理死亡
      if (!tankData.alive && existingTank.alive) {
        yield put(actions.setTankToDead(tankData.tankId));
      }
    } else {
      // 创建新坦克
      const newTank = new TankRecord({
        tankId: tankData.tankId,
        x: tankData.x,
        y: tankData.y,
        direction: tankData.direction,
        moving: tankData.moving,
        side: tankData.side,
        level: tankData.level,
        hp: tankData.hp,
        alive: tankData.alive,
        color: tankData.color,
        helmetDuration: tankData.helmetDuration,
        frozenTimeout: tankData.frozenTimeout,
        cooldown: tankData.cooldown,
        withPowerUp: tankData.withPowerUp,
      });
      yield put(actions.addTank(newTank));
    }
  }

  // 移除服务器端不存在的坦克
  const serverTankIds = new Set(serverState.tanks.map(t => t.tankId));
  for (const [tankId, tank] of state.tanks.entries()) {
    if (!serverTankIds.has(tankId) && tank.alive) {
      yield put(actions.setTankToDead(tankId));
    }
  }

  // 同步子弹状态 - 使用 updateBullets 批量更新
  let updatedBulletsMap = IMap<BulletId, BulletRecord>();
  for (const bulletData of serverState.bullets) {
    const newBullet = new BulletRecord({
      bulletId: bulletData.bulletId,
      x: bulletData.x,
      y: bulletData.y,
      direction: bulletData.direction,
      speed: bulletData.speed,
      tankId: bulletData.tankId,
      power: bulletData.power,
    });
    updatedBulletsMap = updatedBulletsMap.set(bulletData.bulletId, newBullet);
  }

  // 批量更新子弹
  yield put(actions.updateBullets(updatedBulletsMap));

  // 同步砖块状态（被破坏的砖块）
  // 服务器发送的 bricks 数组中，false 表示砖块已被破坏
  if (serverState.map && serverState.map.bricks) {
    const bricksToRemove: number[] = [];
    const currentBricks = state.map.bricks;

    for (let i = 0; i < serverState.map.bricks.length; i++) {
      // 如果服务器端砖块已被破坏，且本地砖块还存在
      if (!serverState.map.bricks[i] && currentBricks.get(i) === true) {
        bricksToRemove.push(i);
      }
    }

    if (bricksToRemove.length > 0) {
      yield put(actions.removeBricks(ISet(bricksToRemove)));
    }
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

      const channel: EventChannel<any> = yield call(createPongChannel);
      const { pong }: any = yield race({
        pong: take(channel),
        timeout: delay(1000),
      });
      channel.close();

      if (pong) {
        const ping = Date.now() - startTime;
        yield put(actions.updateNetworkStats({ ping, lastPingTime: Date.now() }));
      }
    }

    yield delay(2000);
  }
}

/**
 * 判断当前客户端是否为 Host
 */
export function* isHost() {
  const state: State = yield select();
  return state.multiplayer.enabled && state.multiplayer.roomInfo?.role === 'host';
}

/**
 * 联机游戏主saga（服务器权威模式）
 * 
 * 在服务器权威模式下：
 * - 客户端只发送玩家输入到服务器
 * - 客户端接收服务器广播的游戏状态并渲染
 * - 所有游戏逻辑由服务器运行
 */
export default function* multiplayerGameSaga() {
  while (true) {
    yield take(A.MultiplayerGameStart);

    const state: State = yield select();
    const role = state.multiplayer.roomInfo?.role;
    if (!role) {
      continue;
    }

    console.log(`[Multiplayer] Server-Authoritative mode started, role: ${role}`);

    // 服务器权威模式：发送输入 + 接收状态
    yield race({
      sendInput: call(sendLocalPlayerInput),
      receiveState: call(receiveServerState),
      ping: call(pingLoop),
      leave: take([A.LeaveGameScene, A.DisableMultiplayer]),
    });

    // 清理状态
    localInputState = { direction: null, moving: false, firing: false };
    console.log('[Multiplayer] Game session ended');
  }
}
