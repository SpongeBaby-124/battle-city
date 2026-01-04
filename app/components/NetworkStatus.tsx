import React from 'react';
import { useSelector } from 'react-redux';
import { State } from '../reducers';
import './NetworkStatus.css';

/**
 * 网络状态显示组件
 * 显示ping值和连接状态，集成到游戏场景的右上角
 */
export default function NetworkStatus() {
  const { enabled, networkStats } = useSelector((state: State) => state.multiplayer);

  // 如果未启用联机模式，不显示
  if (!enabled) {
    return null;
  }

  const { ping, connectionStatus } = networkStats;

  // 根据延迟确定颜色
  const getPingColor = (): string => {
    if (ping < 50) return 'good'; // 绿色
    if (ping < 100) return 'medium'; // 黄色
    return 'bad'; // 红色
  };

  // 根据连接状态确定显示文本
  const getStatusText = (): string => {
    switch (connectionStatus) {
      case 'connected':
        return '已连接';
      case 'connecting':
        return '连接中...';
      case 'reconnecting':
        return '重连中...';
      case 'disconnected':
        return '已断开';
      case 'error':
        return '连接错误';
      default:
        return '未知';
    }
  };

  // 是否显示警告（延迟过高或连接不稳定）
  const showWarning = ping > 100 || connectionStatus !== 'connected';

  return (
    <div className={`network-status ${showWarning ? 'warning' : ''}`}>
      <div className="network-status-content">
        {/* 连接状态指示器 */}
        <div className={`status-indicator ${connectionStatus}`}>
          <div className="status-dot"></div>
          <span className="status-text">{getStatusText()}</span>
        </div>

        {/* Ping值显示 */}
        {connectionStatus === 'connected' && (
          <div className={`ping-display ${getPingColor()}`}>
            <span className="ping-label">延迟:</span>
            <span className="ping-value">{ping}ms</span>
          </div>
        )}

        {/* 警告提示 */}
        {showWarning && connectionStatus === 'connected' && (
          <div className="warning-message">
            {ping > 100 && <span>⚠️ 网络延迟较高</span>}
          </div>
        )}
      </div>
    </div>
  );
}
