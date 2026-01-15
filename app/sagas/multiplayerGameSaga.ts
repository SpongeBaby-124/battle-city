import { call, delay, put, race, select, take, fork } from 'redux-saga/effects'
import { eventChannel, EventChannel } from 'redux-saga'
import { State } from '../reducers'
import { A } from '../utils/actions'
import { socketService } from '../utils/SocketService'
import {
  SocketEvent,
  PlayerInput,
  ServerStateSyncPayload,
  MapChangesPayload,
} from '../types/multiplayer-types'
import * as actions from '../utils/actions'
import { TankRecord, BulletRecord, ExplosionRecord } from '../types'
import { Map as IMap, Set as ISet } from 'immutable'
import { getNextId, frame as f } from '../utils/common'
import Timing from '../utils/Timing'

/**
 * 创建服务器状态同步事件通道
 */
function createStateSyncChannel(): EventChannel<ServerStateSyncPayload> {
  return eventChannel((emitter) => {
    const handler = (data: ServerStateSyncPayload) => {
      emitter(data)
    }

    socketService.on(SocketEvent.STATE_SYNC, handler)

    return () => {
      socketService.off(SocketEvent.STATE_SYNC, handler)
    }
  })
}

/**
 * 创建地图变化事件通道
 */
function createMapChangesChannel(): EventChannel<MapChangesPayload> {
  return eventChannel((emitter) => {
    const handler = (data: MapChangesPayload) => {
      emitter(data)
    }

    socketService.on(SocketEvent.MAP_CHANGES, handler)

    return () => {
      socketService.off(SocketEvent.MAP_CHANGES, handler)
    }
  })
}

/**
 * 创建Pong响应通道
 */
function createPongChannel(): EventChannel<any> {
  return eventChannel((emitter) => {
    const handler = (data: any) => {
      emitter(data)
    }

    socketService.on(SocketEvent.PONG, handler)

    return () => {
      socketService.off(SocketEvent.PONG, handler)
    }
  })
}

/**
 * 本地子弹爆炸动画（不广播）
 */
function* explosionFromBulletLocal(cx: number, cy: number) {
  const bulletExplosionShapeTiming: [ExplosionShape, number][] = [
    ['s0', f(4)],
    ['s1', f(3)],
    ['s2', f(2)],
  ]

  const explosionId = getNextId('explosion')
  try {
    for (const [shape, time] of bulletExplosionShapeTiming) {
      yield put(
        actions.setExplosion(
          new ExplosionRecord({
            cx,
            cy,
            shape,
            explosionId,
          }),
        ),
      )
      yield Timing.delay(time)
    }
  } finally {
    yield put(actions.removeExplosion(explosionId))
  }
}

/**
 * 本地坦克爆炸动画（不广播）
 * 坦克爆炸动画比子弹爆炸更大更持久
 */
function* tankExplosionLocal(cx: number, cy: number) {
  const tankExplosionShapeTiming: [ExplosionShape, number][] = [
    ['s0', f(7)],
    ['s1', f(5)],
    ['s2', f(7)],
    ['b0', f(5)],
    ['b1', f(7)],
    ['s2', f(5)],
  ]

  const explosionId = getNextId('explosion')
  try {
    for (const [shape, time] of tankExplosionShapeTiming) {
      yield put(
        actions.setExplosion(
          new ExplosionRecord({
            cx,
            cy,
            shape,
            explosionId,
          }),
        ),
      )
      yield Timing.delay(time)
    }
  } finally {
    yield put(actions.removeExplosion(explosionId))
  }
}

/**
 * 存储本地玩家输入状态
 */
let localInputState = {
  direction: null as 'up' | 'down' | 'left' | 'right' | null,
  moving: false,
  firing: false,
}

/**
 * 更新本地输入状态（由 playerController 调用）
 */
export function updateLocalInput(
  direction: 'up' | 'down' | 'left' | 'right' | null,
  moving: boolean,
  firing: boolean,
) {
  localInputState = { direction, moving, firing }
}

// 坦克移动速度（与服务端一致）
const TANK_SPEED = 0.045
const FIELD_SIZE = 208
const TANK_SIZE = 16

// 客户端预测状态（用于平滑插值）
let lastServerState: { x: number; y: number; timestamp: number } | null = null
let predictedPosition: { x: number; y: number } | null = null

// 位置差异阈值（超过此值才进行校正，避免微小抖动）
const POSITION_CORRECTION_THRESHOLD = 2.0
// 平滑插值因子（0-1，越大越快收敛到服务器位置）
const INTERPOLATION_FACTOR = 0.3

/**
 * 计算新位置
 */
function calculateNewPosition(x: number, y: number, direction: string, distance: number) {
  switch (direction) {
    case 'up':
      return { x, y: Math.max(0, y - distance) }
    case 'down':
      return { x, y: Math.min(FIELD_SIZE - TANK_SIZE, y + distance) }
    case 'left':
      return { x: Math.max(0, x - distance), y }
    case 'right':
      return { x: Math.min(FIELD_SIZE - TANK_SIZE, x + distance), y }
    default:
      return { x, y }
  }
}

/**
 * 本地玩家预测移动（客户端预测）
 * 玩家操作立即响应，不等服务器
 * 使用平滑插值避免位置抖动
 */
function* localPlayerPrediction() {
  let lastTickTime = Date.now()

  while (true) {
    yield take(A.Tick)

    const now = Date.now()
    const delta = now - lastTickTime
    lastTickTime = now

    const state: State = yield select()
    if (!state.multiplayer.enabled || !state.multiplayer.roomInfo) {
      continue
    }

    // 获取自己的坦克（根据角色找到对应颜色的玩家坦克）
    const role = state.multiplayer.roomInfo.role
    const myColor = role === 'host' ? 'yellow' : 'green'
    const myTank = state.tanks.find((t) => t.side === 'player' && t.color === myColor && t.alive)

    if (!myTank) {
      predictedPosition = null
      continue
    }

    // 初始化预测位置
    if (!predictedPosition) {
      predictedPosition = { x: myTank.x, y: myTank.y }
    }

    // 处理方向变化
    if (localInputState.direction && localInputState.direction !== myTank.direction) {
      yield put(actions.move(myTank.set('direction', localInputState.direction)))
    }

    // 本地预测移动
    if (localInputState.moving && localInputState.direction) {
      const distance = TANK_SPEED * delta
      const newPos = calculateNewPosition(
        predictedPosition.x,
        predictedPosition.y,
        localInputState.direction,
        distance,
      )
      predictedPosition = newPos

      // 立即更新本地位置（不等服务器）
      const updatedTank = myTank.merge({
        x: newPos.x,
        y: newPos.y,
        moving: true,
      })
      yield put(actions.move(updatedTank))
    } else {
      // 不移动时，逐渐收敛到服务器位置
      if (lastServerState && predictedPosition) {
        const dx = lastServerState.x - predictedPosition.x
        const dy = lastServerState.y - predictedPosition.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance > 0.1) {
          predictedPosition = {
            x: predictedPosition.x + dx * INTERPOLATION_FACTOR,
            y: predictedPosition.y + dy * INTERPOLATION_FACTOR,
          }
          const updatedTank = myTank.merge({
            x: predictedPosition.x,
            y: predictedPosition.y,
          })
          yield put(actions.move(updatedTank))
        }
      }
    }
  }
}

/**
 * 发送本地玩家输入到服务器
 */
function* sendLocalPlayerInput() {
  let lastSentInput = { direction: null as any, moving: false, firing: false }

  while (true) {
    yield take(A.Tick)

    const state: State = yield select()
    if (!state.multiplayer.enabled || !state.multiplayer.roomInfo) {
      continue
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
      }

      socketService.sendPlayerInput(input)
      lastSentInput = { ...localInputState }
    }
  }
}

/**
 * 接收服务器状态并更新本地状态
 */
function* receiveServerState() {
  const channel: EventChannel<ServerStateSyncPayload> = yield call(createStateSyncChannel)

  try {
    while (true) {
      const serverState: ServerStateSyncPayload = yield take(channel)
      yield call(applyServerState, serverState)
    }
  } finally {
    channel.close()
  }
}

/**
 * 应用服务器状态到本地 Redux store
 */
function* applyServerState(serverState: ServerStateSyncPayload) {
  const state: State = yield select()

  if (!state.multiplayer.enabled) {
    return
  }

  // 获取本地玩家的坦克颜色
  const role = state.multiplayer.roomInfo?.role
  const myColor = role === 'host' ? 'yellow' : 'green'

  // 同步坦克状态
  for (const tankData of serverState.tanks) {
    const existingTank = state.tanks.get(tankData.tankId)

    // 判断是否是本地玩家的坦克
    const isMyTank = tankData.side === 'player' && tankData.color === myColor

    if (existingTank) {
      // 对于本地玩家的坦克，使用平滑插值而不是直接覆盖
      if (isMyTank && localInputState.moving) {
        // 更新服务器状态记录（用于后续插值）
        lastServerState = {
          x: tankData.x,
          y: tankData.y,
          timestamp: serverState.timestamp,
        }

        // 检查位置差异，只有差异过大时才校正
        if (predictedPosition) {
          const dx = tankData.x - predictedPosition.x
          const dy = tankData.y - predictedPosition.y
          const distance = Math.sqrt(dx * dx + dy * dy)

          // 如果差异超过阈值，进行平滑校正
          if (distance > POSITION_CORRECTION_THRESHOLD) {
            predictedPosition = {
              x: predictedPosition.x + dx * INTERPOLATION_FACTOR,
              y: predictedPosition.y + dy * INTERPOLATION_FACTOR,
            }
          }
        }

        // 只更新非位置属性
        const updatedTank = existingTank.merge({
          direction: tankData.direction,
          hp: tankData.hp,
          alive: tankData.alive,
          helmetDuration: tankData.helmetDuration,
          frozenTimeout: tankData.frozenTimeout,
          cooldown: tankData.cooldown,
        })
        yield put(actions.move(updatedTank))
      } else {
        // 对于其他坦克（对手、AI），直接使用服务器位置
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
        })
        yield put(actions.move(updatedTank))

        // 同步移动状态
        if (tankData.moving && !existingTank.moving) {
          yield put(actions.startMove(tankData.tankId))
        } else if (!tankData.moving && existingTank.moving) {
          yield put(actions.stopMove(tankData.tankId))
        }
      }

      // 处理死亡 - 添加爆炸动画和音效
      if (!tankData.alive && existingTank.alive) {
        yield put(actions.setTankToDead(tankData.tankId))
        // 播放爆炸音效和动画
        yield put(actions.playSound('explosion_1'))
        yield fork(tankExplosionLocal, existingTank.x + 8, existingTank.y + 8)
      }
    } else {
      // 创建新坦克 - 播放重生音效
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
      })
      yield put(actions.addTank(newTank))
    }
  }

  // 移除服务器端不存在的坦克
  const serverTankIds = new Set(serverState.tanks.map((t) => t.tankId))
  for (const [tankId, tank] of state.tanks.entries()) {
    if (!serverTankIds.has(tankId) && tank.alive) {
      yield put(actions.setTankToDead(tankId))
    }
  }

  // 同步子弹状态 - 使用 updateBullets 批量更新
  const serverBulletIds = new Set(serverState.bullets.map((b) => b.bulletId))

  // 检测消失的子弹（本地有但服务器没有），生成本地爆炸效果
  for (const [bulletId, bullet] of state.bullets.entries()) {
    if (!serverBulletIds.has(bulletId)) {
      // 子弹消失，在其位置生成爆炸效果（使用 fork 异步执行）
      yield fork(explosionFromBulletLocal, bullet.x + 2, bullet.y + 2)
    }
  }

  let updatedBulletsMap = IMap<BulletId, BulletRecord>()
  for (const bulletData of serverState.bullets) {
    const newBullet = new BulletRecord({
      bulletId: bulletData.bulletId,
      x: bulletData.x,
      y: bulletData.y,
      direction: bulletData.direction,
      speed: bulletData.speed,
      tankId: bulletData.tankId,
      power: bulletData.power,
    })
    updatedBulletsMap = updatedBulletsMap.set(bulletData.bulletId, newBullet)
  }

  // 批量更新子弹
  yield put(actions.updateBullets(updatedBulletsMap))

  // 同步完整地图状态（仅在首次接收时，即 map 字段存在时）
  if (serverState.map && serverState.map.bricks) {
    const bricksToRemove: number[] = []
    const currentBricks = state.map.bricks

    for (let i = 0; i < serverState.map.bricks.length; i++) {
      // 如果服务器端砖块已被破坏，且本地砖块还存在
      if (!serverState.map.bricks[i] && currentBricks.get(i) === true) {
        bricksToRemove.push(i)
      }
    }

    if (bricksToRemove.length > 0) {
      yield put(actions.removeBricks(ISet(bricksToRemove)))
    }
  }
}

/**
 * 应用地图变化（增量更新）
 */
function* applyMapChanges(mapChanges: MapChangesPayload) {
  const state: State = yield select()

  if (!state.multiplayer.enabled) {
    return
  }

  // 移除被破坏的砖块
  if (mapChanges.bricksDestroyed.length > 0) {
    yield put(actions.removeBricks(ISet(mapChanges.bricksDestroyed)))
    // 本地播放砖块摧毁音效（不广播）
    yield put(actions.playSound('bullet_hit_2'))
  }

  // 移除被破坏的钢块（如果需要的话）
  // 目前游戏中钢块破坏较少，可以暂时忽略或添加类似逻辑
}

/**
 * 接收地图变化并更新本地状态
 */
function* receiveMapChanges() {
  const channel: EventChannel<MapChangesPayload> = yield call(createMapChangesChannel)

  try {
    while (true) {
      const mapChanges: MapChangesPayload = yield take(channel)
      yield call(applyMapChanges, mapChanges)
    }
  } finally {
    channel.close()
  }
}

/**
 * 定期发送ping来测量网络延迟
 */
function* pingLoop(): Generator<any, void, any> {
  while (true) {
    const state: State = yield select()

    if (state.multiplayer.enabled && state.multiplayer.roomInfo) {
      const startTime = Date.now()
      socketService.sendPing()

      const channel: EventChannel<any> = yield call(createPongChannel)
      const { pong }: any = yield race({
        pong: take(channel),
        timeout: delay(1000),
      })
      channel.close()

      if (pong) {
        const ping = Date.now() - startTime
        yield put(actions.updateNetworkStats({ ping, lastPingTime: Date.now() }))
      }
    }

    yield delay(2000)
  }
}

/**
 * 判断当前客户端是否为 Host
 */
export function* isHost(): Generator<any, boolean, any> {
  const state: State = yield select()
  return state.multiplayer.enabled && state.multiplayer.roomInfo?.role === 'host'
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
    yield take(A.MultiplayerGameStart)

    const state: State = yield select()
    const role = state.multiplayer.roomInfo?.role
    if (!role) {
      continue
    }

    console.log(`[Multiplayer] Server-Authoritative mode started, role: ${role}`)

    // 服务器权威模式 + 客户端预测：
    // - localPlayerPrediction: 本地玩家移动立即响应
    // - sendInput: 发送输入到服务器
    // - receiveState: 接收服务器状态并校正
    yield race({
      localPrediction: call(localPlayerPrediction),
      sendInput: call(sendLocalPlayerInput),
      receiveState: call(receiveServerState),
      receiveMapChanges: call(receiveMapChanges),
      ping: call(pingLoop),
      leave: take([A.LeaveGameScene, A.DisableMultiplayer]),
    })

    // 清理状态
    localInputState = { direction: null, moving: false, firing: false }
    lastServerState = null
    predictedPosition = null
    console.log('[Multiplayer] Game session ended')
  }
}
