import { Record } from 'immutable';
import { Action, A } from '../utils/actions';
import {
  ConnectionStatus,
  PlayerRole,
  RoomInfo,
  NetworkStats,
  GameInitialState,
} from '../types/multiplayer-types';

/**
 * 联机状态Record
 */
export interface MultiplayerState {
  enabled: boolean; // 是否启用联机模式
  connectionStatus: ConnectionStatus; // 连接状态
  roomInfo: RoomInfo | null; // 房间信息
  networkStats: NetworkStats; // 网络统计
  gameInitialState: GameInitialState | null; // 游戏初始状态
  opponentConnected: boolean; // 对手是否连接
  opponentDisconnected: boolean; // 对手是否断线（游戏中断线）
  error: string | null; // 错误信息
  isCountingDown: boolean; // 是否正在倒计时
  countdown: number; // 倒计时秒数
}

const defaultMultiplayerState: MultiplayerState = {
  enabled: false,
  connectionStatus: 'disconnected',
  roomInfo: null,
  networkStats: {
    ping: 0,
    lastPingTime: 0,
    connectionStatus: 'disconnected',
  },
  gameInitialState: null,
  opponentConnected: false,
  opponentDisconnected: false,
  error: null,
  isCountingDown: false,
  countdown: 0,
};

export class MultiplayerRecord extends Record(defaultMultiplayerState) implements MultiplayerState {
  readonly enabled!: boolean;
  readonly connectionStatus!: ConnectionStatus;
  readonly roomInfo!: RoomInfo | null;
  readonly networkStats!: NetworkStats;
  readonly gameInitialState!: GameInitialState | null;
  readonly opponentConnected!: boolean;
  readonly opponentDisconnected!: boolean;
  readonly error!: string | null;
  readonly isCountingDown!: boolean;
  readonly countdown!: number;
}

/**
 * Multiplayer reducer
 */
export default function multiplayer(
  state = new MultiplayerRecord(),
  action: Action,
): MultiplayerRecord {
  if (action.type === A.EnableMultiplayer) {
    return state.set('enabled', true);
  } else if (action.type === A.DisableMultiplayer) {
    return new MultiplayerRecord(); // 重置所有状态
  } else if (action.type === A.SetConnectionStatus) {
    return state
      .set('connectionStatus', action.status)
      .setIn(['networkStats', 'connectionStatus'], action.status);
  } else if (action.type === A.SetRoomInfo) {
    return state.set('roomInfo', action.roomInfo);
  } else if (action.type === A.SetGameInitialState) {
    return state.set('gameInitialState', action.initialState);
  } else if (action.type === A.SetOpponentConnected) {
    return state.set('opponentConnected', action.connected);
  } else if (action.type === A.SetOpponentDisconnected) {
    return state.set('opponentDisconnected', action.disconnected);
  } else if (action.type === A.SetMultiplayerError) {
    return state.set('error', action.error);
  } else if (action.type === A.UpdateNetworkStats) {
    return state.set('networkStats', {
      ...state.networkStats,
      ...action.stats,
    });
  } else if (action.type === A.StartGameCountdown) {
    return state.set('isCountingDown', true).set('countdown', 3);
  } else if (action.type === A.CancelGameCountdown) {
    return state.set('isCountingDown', false).set('countdown', 0);
  } else if (action.type === A.UpdateCountdown) {
    return state.set('countdown', action.countdown);
  } else if (action.type === A.MultiplayerGameStart) {
    return state.set('isCountingDown', false).set('countdown', 0);
  } else {
    return state;
  }
}
