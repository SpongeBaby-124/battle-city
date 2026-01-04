import { Logger } from './logger';

/**
 * 坦克等级类型
 */
type TankLevel = 'basic' | 'fast' | 'power' | 'armor';

/**
 * 敌人生成数据
 */
export interface EnemySpawnData {
  tankId: string;
  x: number;
  y: number;
  level: TankLevel;
  hp: number;
  withPowerUp: boolean;
}

/**
 * 游戏初始状态
 */
export interface GameInitialState {
  seed: number; // 随机种子，确保双方生成相同的地图和敌人
  mapId: number; // 地图ID
  hostPosition: { x: number; y: number }; // 房主初始位置
  guestPosition: { x: number; y: number }; // 客人初始位置
  hostTankColor: 'yellow' | 'green'; // 房主坦克颜色
  guestTankColor: 'yellow' | 'green'; // 客人坦克颜色
  timestamp: number; // 游戏开始时间戳
}

/**
 * 游戏状态管理器
 * 负责生成和管理游戏初始状态
 */
export class GameStateManager {
  private roomEnemyQueues: Map<string, TankLevel[]> = new Map();
  private roomEnemyCounters: Map<string, number> = new Map();
  private spawnPositions = [
    { x: 0, y: 0 },     // 左上角
    { x: 192, y: 0 },   // 中上
    { x: 384, y: 0 },   // 右上角
  ];
  
  /**
   * 初始化房间的敌人队列
   * @param roomId 房间ID
   */
  initializeEnemyQueue(roomId: string): void {
    // 每关20个敌人，等级分布：basic(18), fast(1), power(1)
    const enemyQueue: TankLevel[] = [
      ...Array(18).fill('basic'),
      'fast',
      'power',
    ];
    
    // 使用房间的随机种子打乱顺序
    const seed = this.generateSeed(roomId);
    this.shuffleArray(enemyQueue, seed);
    
    this.roomEnemyQueues.set(roomId, enemyQueue);
    this.roomEnemyCounters.set(roomId, 0);
    
    Logger.info(`Initialized enemy queue for room ${roomId}, total: ${enemyQueue.length}`);
  }
  
  /**
   * 生成下一个敌人
   * @param roomId 房间ID
   * @returns 敌人生成数据，如果没有更多敌人则返回null
   */
  spawnNextEnemy(roomId: string): EnemySpawnData | null {
    const queue = this.roomEnemyQueues.get(roomId);
    const counter = this.roomEnemyCounters.get(roomId);
    
    if (!queue || counter === undefined || counter >= queue.length) {
      return null;
    }
    
    const level = queue[counter];
    const hp = level === 'armor' ? 4 : 1;
    const withPowerUp = [3, 10, 17].includes(counter); // 第4、11、18个敌人携带道具
    
    // 循环使用生成位置
    const spawnPos = this.spawnPositions[counter % this.spawnPositions.length];
    
    const enemyData: EnemySpawnData = {
      tankId: `bot-${roomId}-${counter}`,
      x: spawnPos.x,
      y: spawnPos.y,
      level,
      hp,
      withPowerUp,
    };
    
    this.roomEnemyCounters.set(roomId, counter + 1);
    
    Logger.info(`Spawned enemy ${counter + 1}/${queue.length} for room ${roomId}:`, enemyData);
    
    return enemyData;
  }
  
  /**
   * 获取房间剩余敌人数量
   * @param roomId 房间ID
   * @returns 剩余敌人数量
   */
  getRemainingEnemyCount(roomId: string): number {
    const queue = this.roomEnemyQueues.get(roomId);
    const counter = this.roomEnemyCounters.get(roomId);
    
    if (!queue || counter === undefined) {
      return 0;
    }
    
    return queue.length - counter;
  }
  
  /**
   * 清理房间的敌人队列
   * @param roomId 房间ID
   */
  clearEnemyQueue(roomId: string): void {
    this.roomEnemyQueues.delete(roomId);
    this.roomEnemyCounters.delete(roomId);
    Logger.info(`Cleared enemy queue for room ${roomId}`);
  }
  
  /**
   * 使用种子打乱数组
   * @param array 要打乱的数组
   * @param seed 随机种子
   */
  private shuffleArray<T>(array: T[], seed: number): void {
    // 使用种子生成伪随机数
    let random = seed;
    const seededRandom = () => {
      random = (random * 9301 + 49297) % 233280;
      return random / 233280;
    };
    
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(seededRandom() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }
  
  /**
   * 生成游戏初始状态
   * @param roomId 房间ID
   * @returns 游戏初始状态
   */
  generateInitialState(roomId: string): GameInitialState {
    // 使用房间ID和当前时间生成确定性的随机种子
    const seed = this.generateSeed(roomId);
    
    // 默认使用第1关地图
    const mapId = 1;
    
    // 玩家初始位置（基于原游戏的位置）
    // 玩家1（房主）在左下角，玩家2（客人）在右下角
    const hostPosition = { x: 128, y: 384 }; // 左下角
    const guestPosition = { x: 256, y: 384 }; // 右下角
    
    // 玩家角色分配：玩家1=黄色，玩家2=绿色
    const hostTankColor: 'yellow' | 'green' = 'yellow';
    const guestTankColor: 'yellow' | 'green' = 'green';
    
    const initialState: GameInitialState = {
      seed,
      mapId,
      hostPosition,
      guestPosition,
      hostTankColor,
      guestTankColor,
      timestamp: Date.now(),
    };
    
    Logger.info(`Generated initial state for room ${roomId}:`, initialState);
    
    return initialState;
  }

  /**
   * 生成确定性的随机种子
   * @param roomId 房间ID
   * @returns 随机种子
   */
  private generateSeed(roomId: string): number {
    // 使用房间ID生成确定性的种子
    let hash = 0;
    for (let i = 0; i < roomId.length; i++) {
      const char = roomId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  /**
   * 验证游戏状态
   * @param state 游戏状态
   * @returns 是否有效
   */
  validateState(state: any): boolean {
    if (!state || typeof state !== 'object') {
      return false;
    }

    // 验证必需字段
    if (typeof state.seed !== 'number' ||
        typeof state.mapId !== 'number' ||
        !state.hostPosition ||
        !state.guestPosition ||
        typeof state.timestamp !== 'number') {
      return false;
    }

    // 验证位置格式
    if (typeof state.hostPosition.x !== 'number' ||
        typeof state.hostPosition.y !== 'number' ||
        typeof state.guestPosition.x !== 'number' ||
        typeof state.guestPosition.y !== 'number') {
      return false;
    }

    return true;
  }
}
