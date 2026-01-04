import React from 'react';
import { useSelector } from 'react-redux';
import { State } from '../reducers';
import './MultiplayerGameOver.css';

interface MultiplayerGameOverProps {
  winner: 'host' | 'guest' | 'draw';
  reason: string;
  onReturnToLobby: () => void;
  onPlayAgain: () => void;
}

/**
 * 联机游戏结算界面组件
 */
export default function MultiplayerGameOver({
  winner,
  reason,
  onReturnToLobby,
  onPlayAgain,
}: MultiplayerGameOverProps) {
  const { roomInfo, networkStats } = useSelector((state: State) => state.multiplayer);
  const { player1, player2 } = useSelector((state: State) => ({
    player1: state.player1,
    player2: state.player2,
  }));

  if (!roomInfo) {
    return null;
  }

  const isWinner = winner === roomInfo.role;
  const isDraw = winner === 'draw';

  // 获取结束原因的显示文本
  const getReasonText = (): string => {
    switch (reason) {
      case 'all_enemies_defeated':
        return '消灭所有敌人';
      case 'all_players_dead':
        return '所有玩家阵亡';
      case 'eagle_destroyed':
        return '基地被摧毁';
      default:
        return reason;
    }
  };

  return (
    <div className="multiplayer-gameover-overlay">
      <div className="multiplayer-gameover-container">
        {/* 标题 */}
        <div className={`gameover-title ${isDraw ? 'draw' : isWinner ? 'victory' : 'defeat'}`}>
          {isDraw ? '平局' : isWinner ? '胜利!' : '失败'}
        </div>

        {/* 结束原因 */}
        <div className="gameover-reason">{getReasonText()}</div>

        {/* 玩家统计 */}
        <div className="gameover-stats">
          <div className="player-stats">
            <div className="player-label">玩家1 (主机)</div>
            <div className="stats-row">
              <span>击杀: {player1.killCount}</span>
              <span>剩余生命: {player1.lives}</span>
            </div>
          </div>

          <div className="player-stats">
            <div className="player-label">玩家2 (客机)</div>
            <div className="stats-row">
              <span>击杀: {player2.killCount}</span>
              <span>剩余生命: {player2.lives}</span>
            </div>
          </div>
        </div>

        {/* 网络统计 */}
        <div className="network-stats">
          <span>平均延迟: {networkStats.ping}ms</span>
        </div>

        {/* 操作按钮 */}
        <div className="gameover-actions">
          <button className="btn btn-primary" onClick={onPlayAgain}>
            再来一局
          </button>
          <button className="btn btn-secondary" onClick={onReturnToLobby}>
            返回大厅
          </button>
        </div>
      </div>
    </div>
  );
}
