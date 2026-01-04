import { A } from './actions';
import { ConnectionStatus, RoomInfo, GameInitialState, NetworkStats } from '../types/multiplayer-types';

/**
 * 启用联机模式
 */
export function enableMultiplayer() {
  return { type: A.EnableMultiplayer };
}

/**
 * 禁用联机模式
 */
export function disableMultiplayer() {
  return { type: A.DisableMultiplayer };
}

/**
 * 设置连接状态
 */
export function setConnectionStatus(status: ConnectionStatus) {
  return { type: A.SetConnectionStatus, status };
}

/**
 * 设置房间信息
 */
export function setRoomInfo(roomInfo: RoomInfo | null) {
  return { type: A.SetRoomInfo, roomInfo };
}

/**
 * 设置游戏初始状态
 */
export function setGameInitialState(initialState: GameInitialState | null) {
  return { type: A.SetGameInitialState, initialState };
}

/**
 * 设置对手连接状态
 */
export function setOpponentConnected(connected: boolean) {
  return { type: A.SetOpponentConnected, connected };
}

/**
 * 设置对手断线状态
 */
export function setOpponentDisconnected(disconnected: boolean) {
  return { type: A.SetOpponentDisconnected, disconnected };
}

/**
 * 设置联机错误
 */
export function setMultiplayerError(error: string | null) {
  return { type: A.SetMultiplayerError, error };
}

/**
 * 更新网络统计
 */
export function updateNetworkStats(stats: Partial<NetworkStats>) {
  return { type: A.UpdateNetworkStats, stats };
}

/**
 * 开始游戏倒计时
 */
export function startGameCountdown() {
  return { type: A.StartGameCountdown };
}

/**
 * 取消游戏倒计时
 */
export function cancelGameCountdown() {
  return { type: A.CancelGameCountdown };
}

/**
 * 更新倒计时数值
 */
export function updateCountdown(countdown: number) {
  return { type: A.UpdateCountdown, countdown };
}

/**
 * 联机游戏开始
 */
export function multiplayerGameStart() {
  return { type: A.MultiplayerGameStart };
}
