import { replace } from '../utils/router'
import { all, put, race, select, take } from 'redux-saga/effects'
import { delay } from 'redux-saga/effects'
import { State } from '../reducers'
import TextRecord from '../types/TextRecord'
import * as actions from '../utils/actions'
import { A } from '../utils/actions'
import { getNextId } from '../utils/common'
import { BLOCK_SIZE, PLAYER_CONFIGS, MULTIPLAYER_CONFIG } from '../utils/constants'
import * as selectors from '../utils/selectors'
import Timing from '../utils/Timing'
import botMasterSaga from './botMasterSaga'
import bulletsSaga from './bulletsSaga'
import animateTexts from './common/animateTexts'
import playerSaga from './playerSaga'
import powerUpManager from './powerUpManager'
import stageSaga, { StageResult } from './stageSaga'
import tickEmitter from './tickEmitter'

// 播放游戏结束的动画
function* animateGameover() {
  const textId1 = getNextId('text')
  const textId2 = getNextId('text')
  try {
    const text1 = new TextRecord({
      textId: textId1,
      content: 'game',
      fill: 'red',
      x: BLOCK_SIZE * 6.5,
      y: BLOCK_SIZE * 13,
    })
    yield put(actions.setText(text1))
    const text2 = new TextRecord({
      textId: textId2,
      content: 'over',
      fill: 'red',
      x: BLOCK_SIZE * 6.5,
      y: BLOCK_SIZE * 13.5,
    })
    yield put(actions.setText(text2))
    yield put(actions.playSound('game_over'))
    yield animateTexts([textId1, textId2], {
      direction: 'up',
      distance: BLOCK_SIZE * 6,
      duration: 2000,
    })
    yield Timing.delay(500)
  } finally {
    yield put(actions.removeText(textId1))
    yield put(actions.removeText(textId2))
  }
}

function* stageFlow(startStageIndex: number) {
  const { stages }: State = yield select()
  for (const stage of stages.slice(startStageIndex)) {
    const stageResult: StageResult = yield stageSaga(stage)
    DEV.LOG && console.log('stageResult:', stageResult)
    if (!stageResult.pass) {
      break
    }
  }
  yield animateGameover()
  return true
}

/**
 *  game-saga负责管理整体游戏进度
 *  负责管理游戏开始界面, 游戏结束界面
 *  game-stage调用stage-saga来运行不同的关卡
 *  并根据stage-saga返回的结果选择继续下一个关卡, 或是选择游戏结束
 */
export default function* gameSaga(action: actions.StartGame | actions.ResetGame) {
  if (action.type === A.ResetGame) {
    DEV.LOG && console.log('GAME RESET')
    return
  }

  // 这里的 delay(0) 是为了「异步执行」后续的代码
  // 以保证后续代码执行前已有的cancel逻辑执行完毕
  yield delay(0)
  DEV.LOG && console.log('GAME STARTED')

  // 检查是否为联机模式（服务器权威模式）
  const isMultiplayerMode: boolean = yield select(selectors.isInMultiPlayersMode)
  const multiplayerState: State['multiplayer'] = yield select((s: State) => s.multiplayer)
  const isOnlineMultiplayer = multiplayerState.enabled && multiplayerState.roomInfo != null

  if (isOnlineMultiplayer) {
    // 服务器权威模式：客户端只负责输入和渲染
    // 游戏逻辑（AI、子弹、碰撞）由服务器运行
    const role = multiplayerState.roomInfo!.role
    console.log(`[Multiplayer] Server-Authoritative mode, role: ${role}`)

    // 根据角色确定本地玩家
    const localPlayerName = role === 'host' ? 'player-1' : 'player-2'
    // 联机模式统一使用 WASD + 空格
    const localPlayerConfig = {
      ...MULTIPLAYER_CONFIG,
      color: role === 'host' ? 'yellow' as const : 'green' as const,
      spawnPos: role === 'host' ? PLAYER_CONFIGS.player1.spawnPos : PLAYER_CONFIGS.player2.spawnPos,
    }

    // 只启动本地玩家的控制器（用于发送输入）
    const players = [playerSaga(localPlayerName as PlayerName, localPlayerConfig)]

    yield race({
      tick: tickEmitter({ bindESC: true }),
      players: all(players),
      flow: stageFlow(action.stageIndex),
      leave: take(A.LeaveGameScene),
    })
  } else {
    // 单机模式或本地双人模式：正常运行所有游戏逻辑
    const players = [playerSaga('player-1', PLAYER_CONFIGS.player1)]
    if (isMultiplayerMode) {
      // 本地双人模式
      players.push(playerSaga('player-2', PLAYER_CONFIGS.player2))
    }

    const result = yield race({
      tick: tickEmitter({ bindESC: true }),
      players: all(players),
      ai: botMasterSaga(),
      powerUp: powerUpManager(),
      bullets: bulletsSaga(),
      // 上面几个 saga 在一个 gameSaga 的生命周期内被认为是后台服务
      // 当 stage-flow 退出（或者是用户直接离开了game-scene）的时候，自动取消上面几个后台服务
      flow: stageFlow(action.stageIndex),
      leave: take(A.LeaveGameScene),
    })

    if (DEV.LOG) {
      if (result.leave) {
        console.log('LEAVE GAME SCENE')
      }
    }

    if (result.flow) {
      DEV.LOG && console.log('GAME ENDED')
      const { router }: State = yield select()
      yield put(replace(`/gameover${router.location.search}`))
    }
  }

  yield put(actions.beforeEndGame())
  yield put(actions.endGame())
}
