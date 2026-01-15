import last from 'lodash/last'
import pull from 'lodash/pull'
import { all, select, take } from 'redux-saga/effects'
import { Input, PlayerConfig, TankRecord } from '../types'
import { A } from '../utils/actions'
import directionController from './directionController'
import fireController from './fireController'
import { State } from '../reducers'
import { updateLocalInput } from './multiplayerGameSaga'

// 一个 playerController 实例对应一个人类玩家(用户)的控制器.
// 参数playerName用来指定人类玩家的玩家名称, config为该玩家的操作配置.
// playerController 将启动 fireController 与 directionController, 从而控制人类玩家的坦克
export default function* playerController(tankId: TankId, config: PlayerConfig) {
  let firePressing = false // 用来记录当前玩家是否按下了fire键
  let firePressed = false // 用来记录上一个tick内 玩家是否按下过fire键
  const pressed: Direction[] = [] // 用来记录上一个tick内, 玩家按下过的方向键

  // 检查是否为联机模式（服务器权威模式）
  const multiplayerState: State['multiplayer'] = yield select((s: State) => s.multiplayer)
  const isOnlineMultiplayer = multiplayerState.enabled && multiplayerState.roomInfo != null

  try {
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)

    if (isOnlineMultiplayer) {
      // 服务器权威模式：更新本地输入状态供 multiplayerGameSaga 使用
      // multiplayerGameSaga 负责发送输入到服务器和客户端预测
      yield all([resetFirePressedEveryTick(), updateLocalInputState()])
    } else {
      // 单机模式或本地双人模式：运行本地控制器
      yield all([
        directionController(tankId, getPlayerInput),
        fireController(tankId, () => firePressed || firePressing),
        resetFirePressedEveryTick(),
      ])
    }
  } finally {
    document.removeEventListener('keydown', onKeyDown)
    document.removeEventListener('keyup', onKeyUp)
  }

  // region function-definitions
  function tryPush(direciton: Direction) {
    if (!pressed.includes(direciton)) {
      pressed.push(direciton)
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const code = event.code
    if (code === config.control.fire) {
      firePressing = true
      firePressed = true
    } else if (code == config.control.left) {
      tryPush('left')
    } else if (code === config.control.right) {
      tryPush('right')
    } else if (code === config.control.up) {
      tryPush('up')
    } else if (code === config.control.down) {
      tryPush('down')
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    const code = event.code
    if (code === config.control.fire) {
      firePressing = false
    } else if (code === config.control.left) {
      pull(pressed, 'left')
    } else if (code === config.control.right) {
      pull(pressed, 'right')
    } else if (code === config.control.up) {
      pull(pressed, 'up')
    } else if (code === config.control.down) {
      pull(pressed, 'down')
    }
  }

  // 调用该函数来获取当前用户的移动操作(坦克级别)
  function getPlayerInput(tank: TankRecord): Input {
    const direction = pressed.length > 0 ? last(pressed) : null
    if (direction != null) {
      if (direction !== tank.direction) {
        return { type: 'turn', direction } as Input
      } else {
        return { type: 'forward' }
      }
    }
  }

  function* resetFirePressedEveryTick() {
    // 每次tick时, 都将firePressed重置
    while (true) {
      yield take(A.Tick)
      firePressed = false
    }
  }

  // 更新本地输入状态（联机模式）
  // 将键盘输入同步到 multiplayerGameSaga 的 localInputState
  function* updateLocalInputState() {
    while (true) {
      yield take(A.Tick)

      // 获取当前输入状态
      const currentDirection = pressed.length > 0 ? last(pressed) : null
      const isMoving = pressed.length > 0
      const isFiring = firePressing || firePressed

      // 更新 multiplayerGameSaga 的本地输入状态
      updateLocalInput(currentDirection || null, isMoving, isFiring)
    }
  }
  // endregion
}
