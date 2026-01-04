import { delay, put, race, select, take, call } from 'redux-saga/effects';
import { push } from '../utils/router';
import { State } from '../reducers';
import { A, startGame } from '../utils/actions';
import {
  startGameCountdown,
  cancelGameCountdown,
  updateCountdown,
  multiplayerGameStart,
} from '../utils/multiplayerActions';
import { firstStageName } from '../stages';

/**
 * 监听对手连接状态，当双方都连接时启动倒计时
 */
function* watchOpponentConnection() {
  while (true) {
    // 等待对手连接
    const action: any = yield take(A.SetOpponentConnected);
    
    // 只有当对手连接时才启动倒计时
    if (!action.connected) {
      // 对手断开，取消倒计时
      yield put(cancelGameCountdown());
      continue;
    }
    
    const state: State = yield select();
    const { multiplayer } = state;
    
    // 检查是否双方都已连接
    if (multiplayer.opponentConnected && multiplayer.roomInfo) {
      // 启动倒计时
      yield put(startGameCountdown());
      
      // 执行倒计时逻辑
      const result: any = yield race({
        countdown: call(countdownSaga),
        cancel: take([A.SetOpponentConnected, A.DisableMultiplayer, A.SetRoomInfo]),
      });
      
      if (result.cancel) {
        // 对手断开或离开大厅，取消倒计时
        yield put(cancelGameCountdown());
      } else if (result.countdown) {
        // 倒计时结束，启动游戏
        yield put(multiplayerGameStart());
        
        // 发出startGame action启动游戏（从第一关开始）
        yield put(startGame(0));
        
        // 跳转到游戏场景
        yield put(push(`/stage/${firstStageName}`));
      }
    }
  }
}

/**
 * 倒计时saga
 */
function* countdownSaga() {
  // 3秒倒计时
  for (let i = 3; i > 0; i--) {
    yield put(updateCountdown(i));
    yield delay(1000);
  }
  
  yield put(updateCountdown(0));
  return true;
}

/**
 * 联机大厅主saga
 */
export default function* multiplayerLobbySaga() {
  while (true) {
    // 等待启用联机模式
    yield take(A.EnableMultiplayer);
    
    // 启动监听
    yield race({
      watchConnection: call(watchOpponentConnection),
      leave: take(A.DisableMultiplayer),
    });
  }
}
