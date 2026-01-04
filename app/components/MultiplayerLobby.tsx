import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { State } from '../reducers';
import { socketService } from '../utils/SocketService';
import {
  enableMultiplayer,
  disableMultiplayer,
  setConnectionStatus,
  setRoomInfo,
  setOpponentConnected,
  setMultiplayerError,
  setGameInitialState,
} from '../utils/multiplayerActions';
import { SocketEvent, ErrorResponse, RoomInfo, GameInitialState } from '../types/multiplayer-types';
import TextButton from './TextButton';
import Text from './Text';
import TextInput from './TextInput';
import Screen from './Screen';
import { BLOCK_SIZE as B } from '../utils/constants';
import './MultiplayerLobby.css';

/**
 * 联机大厅组件
 */
export default function MultiplayerLobby() {
  const dispatch = useDispatch();
  const multiplayer = useSelector((state: State) => state.multiplayer);
  const [roomIdInput, setRoomIdInput] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    // 启用联机模式
    dispatch(enableMultiplayer());

    // 连接到服务器
    socketService.connect();

    // 监听连接状态变化
    const handleStatusChange = (status: any) => {
      dispatch(setConnectionStatus(status));
    };

    // 监听房间创建成功
    const handleRoomCreated = (data: RoomInfo) => {
      dispatch(setRoomInfo(data));
      setIsCreating(false);
      dispatch(setMultiplayerError(null));
    };

    // 监听加入房间成功
    const handleRoomJoined = (data: RoomInfo) => {
      dispatch(setRoomInfo(data));
      setIsJoining(false);
      dispatch(setMultiplayerError(null));
      dispatch(setOpponentConnected(true));
    };

    // 监听房间错误
    const handleRoomError = (error: ErrorResponse) => {
      dispatch(setMultiplayerError(error.message));
      setIsCreating(false);
      setIsJoining(false);
    };

    // 监听玩家加入
    const handlePlayerJoined = () => {
      dispatch(setOpponentConnected(true));
    };

    // 监听玩家离开
    const handlePlayerLeft = () => {
      dispatch(setOpponentConnected(false));
    };

    // 监听游戏初始状态（服务器同步）
    const handleGameStateInit = (data: GameInitialState) => {
      dispatch(setGameInitialState(data));
    };

    socketService.on('status_change', handleStatusChange);
    socketService.on(SocketEvent.ROOM_CREATED, handleRoomCreated);
    socketService.on(SocketEvent.ROOM_JOINED, handleRoomJoined);
    socketService.on(SocketEvent.ROOM_ERROR, handleRoomError);
    socketService.on(SocketEvent.PLAYER_JOINED, handlePlayerJoined);
    socketService.on(SocketEvent.PLAYER_LEFT, handlePlayerLeft);
    socketService.on(SocketEvent.GAME_STATE_INIT, handleGameStateInit);

    return () => {
      // 清理事件监听
      socketService.off('status_change', handleStatusChange);
      socketService.off(SocketEvent.ROOM_CREATED, handleRoomCreated);
      socketService.off(SocketEvent.ROOM_JOINED, handleRoomJoined);
      socketService.off(SocketEvent.ROOM_ERROR, handleRoomError);
      socketService.off(SocketEvent.PLAYER_JOINED, handlePlayerJoined);
      socketService.off(SocketEvent.PLAYER_LEFT, handlePlayerLeft);
      socketService.off(SocketEvent.GAME_STATE_INIT, handleGameStateInit);

      // 断开连接
      socketService.disconnect();
      dispatch(disableMultiplayer());
    };
  }, [dispatch]);

  const handleCreateRoom = () => {
    if (multiplayer.connectionStatus !== 'connected') {
      dispatch(setMultiplayerError('not connected to server'));
      return;
    }
    setIsCreating(true);
    socketService.createRoom();
  };

  const handleJoinRoom = () => {
    if (multiplayer.connectionStatus !== 'connected') {
      dispatch(setMultiplayerError('not connected to server'));
      return;
    }
    if (!roomIdInput || roomIdInput.length !== 6) {
      dispatch(setMultiplayerError('please enter 6-digit room id'));
      return;
    }
    setIsJoining(true);
    socketService.joinRoom(roomIdInput);
  };

  const handleLeaveRoom = () => {
    socketService.leaveRoom();
    dispatch(setRoomInfo(null));
    dispatch(setOpponentConnected(false));
    setRoomIdInput('');
  };

  const handleBack = () => {
    window.history.back();
  };

  const renderConnectionStatus = () => {
    const statusText = {
      disconnected: 'disconnected',
      connecting: 'connecting...',
      connected: 'connected',
      reconnecting: 'reconnecting...',
      error: 'error',
    };
    return (
      <Text 
        x={0.5 * B} 
        y={0.5 * B} 
        content={`status: ${statusText[multiplayer.connectionStatus]}`}
        fill="white"
      />
    );
  };

  const renderLobby = () => {
    if (multiplayer.roomInfo) {
      // 已在房间中
      return (
        <g className="room-info">
          <Text 
            x={2 * B} 
            y={3 * B} 
            content={`room: ${multiplayer.roomInfo.roomId}`}
            fill="white"
          />
          <Text 
            x={2 * B} 
            y={4 * B} 
            content={`role: ${multiplayer.roomInfo.role === 'host' ? 'host' : 'guest'}`}
            fill="white"
          />
          <Text 
            x={2 * B} 
            y={5 * B} 
            content={`opponent: ${multiplayer.opponentConnected ? 'connected' : 'waiting...'}`}
            fill="white"
          />
          {multiplayer.isCountingDown && (
            <Text 
              x={2 * B} 
              y={6 * B} 
              content={`starting: ${multiplayer.countdown}`}
              fill="#ffff00"
            />
          )}
          {multiplayer.opponentConnected && !multiplayer.isCountingDown && (
            <Text 
              x={2 * B} 
              y={6 * B} 
              content="ready..."
              fill="#00ff00"
            />
          )}
          <TextButton x={2 * B} y={8 * B} content="leave room" onClick={handleLeaveRoom} />
        </g>
      );
    }

    // 大厅界面
    return (
      <g className="lobby-menu">
        <Text 
          x={2 * B} 
          y={2 * B} 
          content="multiplayer"
          fill="white"
        />
        <TextButton
          x={2 * B}
          y={4 * B}
          content={isCreating ? 'creating...' : 'create room'}
          onClick={handleCreateRoom}
          disabled={isCreating || multiplayer.connectionStatus !== 'connected'}
        />
        <g className="join-room-section">
          <Text 
            x={2 * B} 
            y={6 * B} 
            content="room id:"
            fill="white"
          />
          <TextInput
            x={5 * B}
            y={6 * B}
            value={roomIdInput}
            onChange={setRoomIdInput}
            maxLength={6}
          />
          <TextButton
            x={2 * B}
            y={7.5 * B}
            content={isJoining ? 'joining...' : 'join room'}
            onClick={handleJoinRoom}
            disabled={isJoining || multiplayer.connectionStatus !== 'connected'}
          />
        </g>
        <TextButton x={2 * B} y={10 * B} content="back" onClick={handleBack} />
      </g>
    );
  };

  return (
    <Screen background="#000">
      {renderConnectionStatus()}
      {renderLobby()}
      {multiplayer.error && (
        <Text 
          x={2 * B} 
          y={13 * B} 
          content={multiplayer.error}
          fill="#ff0000"
        />
      )}
    </Screen>
  );
}
