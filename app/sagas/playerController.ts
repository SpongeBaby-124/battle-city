import last from 'lodash/last'
import pull from 'lodash/pull'
import { all, select, take } from 'redux-saga/effects'
import { Input, PlayerConfig, TankRecord } from '../types'
import { A } from '../utils/actions'
import directionController from './directionController'
import fireController from './fireController'
import { socketService } from '../utils/SocketService'
import { State } from '../reducers'

// 输入历史记录（用于客户端预测和状态校正）
interface InputHistoryEntry {
  sequenceId: number;
  direction: Direction | null;
  fire: boolean;
  timestamp: number;
  tankState: {
    x: number;
    y: number;
    direction: Direction;
  };
}

// 一个 playerController 实例对应一个人类玩家(用户)的控制器.
// 参数playerName用来指定人类玩家的玩家名称, config为该玩家的操作配置.
// playerController 将启动 fireController 与 directionController, 从而控制人类玩家的坦克
export default function* playerController(tankId: TankId, config: PlayerConfig) {
  let firePressing = false // 用来记录当前玩家是否按下了fire键
  let firePressed = false // 用来记录上一个tick内 玩家是否按下过fire键
  const pressed: Direction[] = [] // 用来记录上一个tick内, 玩家按下过的方向键
  let lastSentInput: string | null = null // 上次发送的输入状态（用于节流）
  let inputSequenceId = 0 // 输入序列号
  const inputHistory: InputHistoryEntry[] = [] // 输入历史记录（最多保存100个）
  const MAX_HISTORY_SIZE = 100

  try {
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('keyup', onKeyUp)
    yield all([
      directionController(tankId, getPlayerInput),
      fireController(tankId, () => firePressed || firePressing),
      resetFirePressedEveryTick(),
      sendInputToServer(),
    ])
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

  // 发送输入到服务器（联机模式）
  function* sendInputToServer() {
    while (true) {
      yield take(A.Tick)
      
      // 检查是否启用联机模式
      const state: State = yield select()
      if (!state.multiplayer.enabled || !state.multiplayer.roomInfo) {
        continue
      }
      
      // 获取当前坦克状态
      const tank: TankRecord = yield select((s: State) => s.tanks.get(tankId))
      if (!tank) {
        continue
      }
      
      // 构建当前输入状态
      const currentDirection = pressed.length > 0 ? last(pressed) : null
      const currentFire = firePressing || firePressed
      const inputState = JSON.stringify({ direction: currentDirection, fire: currentFire })
      
      // 节流：只有输入状态改变时才发送
      if (inputState !== lastSentInput) {
        lastSentInput = inputState
        inputSequenceId++
        
        // 记录输入历史（用于客户端预测和状态校正）
        inputHistory.push({
          sequenceId: inputSequenceId,
          direction: currentDirection,
          fire: currentFire,
          timestamp: Date.now(),
          tankState: {
            x: tank.x,
            y: tank.y,
            direction: tank.direction,
          },
        })
        
        // 限制历史记录大小
        if (inputHistory.length > MAX_HISTORY_SIZE) {
          inputHistory.shift()
        }
        
        // 发送输入到服务器（带序列号）
        socketService.sendPlayerInput({
          type: currentFire ? 'fire' : (currentDirection ? 'move' : 'direction'),
          direction: currentDirection || undefined,
          timestamp: Date.now(),
          sequenceId: inputSequenceId,
        })
        
        console.log(`[Client Prediction] Sent input #${inputSequenceId}:`, {
          direction: currentDirection,
          fire: currentFire,
          position: { x: tank.x, y: tank.y },
        })
      }
    }
  }
  // endregion
}
