import { Logger } from './logger';
import { parseStageMap, STAGE_1_MAP } from './MapParser';
import {
    GameState,
    TankState,
    BulletState,
    MapState,
    PlayerState,
    PlayerInput,
    Direction,
    StateSyncPayload,
} from './types';

// ==================== 常量定义 ====================
const BLOCK_SIZE = 16;
const FIELD_SIZE = BLOCK_SIZE * 13; // 208
const TANK_SIZE = 16;
const BULLET_SIZE = 3;
const TICK_INTERVAL = 1000 / 60; // 约 16.67ms，60 FPS

// 坦克移动速度（像素/ms）- 与前端保持一致
const TANK_SPEED = {
    player: 0.045,  // 玩家坦克速度
    bot: 0.03,      // AI坦克速度（basic/armor）
    bot_fast: 0.06, // AI快速坦克速度
    bot_power: 0.045, // AI威力坦克速度
};

// 子弹速度
const BULLET_SPEED = 0.18;

// 砖块大小
const BRICK_SIZE = 4;
// 钢块大小
const STEEL_SIZE = 8;
// 砖块每行数量
const BRICKS_PER_ROW = FIELD_SIZE / BRICK_SIZE; // 52
// 钢块每行数量
const STEELS_PER_ROW = FIELD_SIZE / STEEL_SIZE; // 26

// 坐标对齐函数（与前端保持一致）
const floor8 = (x: number) => Math.floor(x / 8) * 8;
const ceil8 = (x: number) => Math.ceil(x / 8) * 8;
const round8 = (x: number) => Math.round(x / 8) * 8;

// 玩家出生点
const PLAYER_SPAWN_POSITIONS = {
    host: { x: 4 * BLOCK_SIZE, y: 12 * BLOCK_SIZE },
    guest: { x: 8 * BLOCK_SIZE, y: 12 * BLOCK_SIZE },
};

/**
 * 服务器端游戏引擎
 * 负责运行游戏逻辑、处理输入、维护状态
 */
export class GameEngine {
    private roomId: string;
    private state: GameState;
    private tickInterval: NodeJS.Timeout | null = null;
    private lastTickTime: number = 0;
    private tankIdCounter: number = 0;
    private bulletIdCounter: number = 0;

    // 玩家输入状态
    private playerInputs: {
        host: { direction: Direction | null; moving: boolean; firing: boolean };
        guest: { direction: Direction | null; moving: boolean; firing: boolean };
    };

    constructor(roomId: string) {
        this.roomId = roomId;

        // 初始化玩家输入状态
        this.playerInputs = {
            host: { direction: null, moving: false, firing: false },
            guest: { direction: null, moving: false, firing: false },
        };

        // 初始化游戏状态
        this.state = this.createInitialState();

        Logger.info(`GameEngine created for room: ${roomId}`);
    }

    /**
     * 创建初始游戏状态
     */
    private createInitialState(): GameState {
        // 加载 Stage 1 地图
        const mapData = parseStageMap(STAGE_1_MAP);

        return {
            tanks: [],
            bullets: [],
            map: {
                bricks: mapData.bricks,
                steels: mapData.steels,
                eagleBroken: false,
            },
            players: {
                host: { lives: 3, score: 0, activeTankId: null },
                guest: { lives: 3, score: 0, activeTankId: null },
            },
            remainingBots: 20,
            gameStatus: 'waiting',
        };
    }

    /**
     * 生成唯一的坦克ID
     */
    private generateTankId(): number {
        return ++this.tankIdCounter;
    }

    /**
     * 生成唯一的子弹ID
     */
    private generateBulletId(): number {
        return ++this.bulletIdCounter;
    }

    /**
     * 生成玩家坦克
     */
    private spawnPlayerTank(role: 'host' | 'guest'): TankState {
        const spawnPos = PLAYER_SPAWN_POSITIONS[role];
        const tankId = this.generateTankId();

        const tank: TankState = {
            tankId,
            x: spawnPos.x,
            y: spawnPos.y,
            direction: 'up',
            moving: false,
            alive: true,
            side: 'player',
            level: 'basic',
            color: role === 'host' ? 'yellow' : 'green',
            hp: 1,
            helmetDuration: 2000, // 2秒无敌
            frozenTimeout: 0,
            cooldown: 0,
            withPowerUp: false,
        };

        this.state.tanks.push(tank);
        this.state.players[role].activeTankId = tankId;

        Logger.info(`Player tank spawned: ${tankId} for ${role}`);
        return tank;
    }

    /**
     * 启动游戏
     */
    start(): void {
        if (this.tickInterval) {
            Logger.warn(`GameEngine already running for room: ${this.roomId}`);
            return;
        }

        // 生成玩家坦克
        this.spawnPlayerTank('host');
        this.spawnPlayerTank('guest');

        // 设置游戏状态为进行中
        this.state.gameStatus = 'playing';
        this.lastTickTime = Date.now();

        // 启动 tick 循环
        this.tickInterval = setInterval(() => this.tick(), TICK_INTERVAL);

        Logger.info(`GameEngine started for room: ${this.roomId}`);
    }

    /**
     * 停止游戏
     */
    stop(): void {
        if (this.tickInterval) {
            clearInterval(this.tickInterval);
            this.tickInterval = null;
        }
        this.state.gameStatus = 'finished';
        Logger.info(`GameEngine stopped for room: ${this.roomId}`);
    }

    /**
     * 游戏主循环 - 每帧执行
     */
    private tick(): void {
        const now = Date.now();
        const delta = now - this.lastTickTime;
        this.lastTickTime = now;

        // 处理玩家坦克移动
        this.updatePlayerTanks(delta);

        // 处理子弹移动
        this.updateBullets(delta);

        // 处理碰撞检测
        this.handleCollisions();

        // 更新坦克状态（减少冷却时间等）
        this.updateTankStates(delta);
    }

    /**
     * 更新玩家坦克位置（包含转向坐标对齐）
     * 移植自前端 directionController.ts
     */
    private updatePlayerTanks(delta: number): void {
        for (const role of ['host', 'guest'] as const) {
            const input = this.playerInputs[role];
            const tankId = this.state.players[role].activeTankId;

            if (!tankId) continue;

            const tank = this.state.tanks.find(t => t.tankId === tankId);
            if (!tank || !tank.alive) continue;

            // 更新移动状态
            tank.moving = input.moving;

            // 处理方向变化（核心：转向时坐标对齐）
            if (input.direction && input.direction !== tank.direction) {
                const oldDir = tank.direction;
                const newDir = input.direction;

                // 检查是否垂直转向（左右 <-> 上下）
                const isOldHorizontal = oldDir === 'left' || oldDir === 'right';
                const isNewHorizontal = newDir === 'left' || newDir === 'right';
                const isPerpendicular = isOldHorizontal !== isNewHorizontal;

                if (isPerpendicular && oldDir) {
                    // 垂直转向时，对齐另一个轴的坐标
                    // 如果原方向是水平，则对齐 x；如果是垂直，则对齐 y
                    if (isOldHorizontal) {
                        // 对齐 x 坐标
                        const alignedX = this.getAlignedCoordinate(tank.x, tank.y, 'x');
                        tank.x = Math.max(0, Math.min(FIELD_SIZE - TANK_SIZE, alignedX));
                    } else {
                        // 对齐 y 坐标
                        const alignedY = this.getAlignedCoordinate(tank.x, tank.y, 'y');
                        tank.y = Math.max(0, Math.min(FIELD_SIZE - TANK_SIZE, alignedY));
                    }
                }

                tank.direction = newDir;
            }

            // 如果正在移动，使用坦克当前方向更新位置
            if (input.moving && tank.direction) {
                const speed = TANK_SPEED.player * delta;
                const newPos = this.calculateNewPosition(tank.x, tank.y, tank.direction, speed);

                // 边界检测
                let clampedPos = this.clampPosition(newPos.x, newPos.y, TANK_SIZE);

                // 先检测碰撞，只有不碰撞时才移动
                if (!this.checkTankWallCollision(clampedPos.x, clampedPos.y)) {
                    tank.x = clampedPos.x;
                    tank.y = clampedPos.y;
                }
                // 如果碰撞，坦克不移动
            }

            // 处理开火
            if (input.firing && tank.cooldown <= 0) {
                this.fireBullet(tank);
            }
        }
    }

    /**
     * 获取对齐后的坐标（与前端 getReservedTank 逻辑一致）
     * 尝试 floor8, ceil8, 选择不碰撞的那个；都可以则用 round8
     */
    private getAlignedCoordinate(x: number, y: number, axis: 'x' | 'y'): number {
        const coord = axis === 'x' ? x : y;
        const floorVal = floor8(coord);
        const ceilVal = ceil8(coord);
        const roundVal = round8(coord);

        if (axis === 'x') {
            const canFloor = !this.checkTankWallCollision(floorVal, y);
            const canCeil = !this.checkTankWallCollision(ceilVal, y);

            if (!canFloor && canCeil) return ceilVal;
            if (canFloor && !canCeil) return floorVal;
            return roundVal; // 都可以或都不可以，用 round8
        } else {
            const canFloor = !this.checkTankWallCollision(x, floorVal);
            const canCeil = !this.checkTankWallCollision(x, ceilVal);

            if (!canFloor && canCeil) return ceilVal;
            if (canFloor && !canCeil) return floorVal;
            return roundVal;
        }
    }

    /**
     * 检查坦克是否与墙体碰撞
     * 使用 -0.01 阈值允许轻微重叠，与前端保持一致
     */
    private checkTankWallCollision(x: number, y: number): boolean {
        const threshold = -0.01;

        // 检查砖块碰撞
        for (let i = 0; i < this.state.map.bricks.length; i++) {
            if (!this.state.map.bricks[i]) continue;

            const brickX = (i % BRICKS_PER_ROW) * BRICK_SIZE;
            const brickY = Math.floor(i / BRICKS_PER_ROW) * BRICK_SIZE;

            if (this.testCollision(x, y, TANK_SIZE, TANK_SIZE, brickX, brickY, BRICK_SIZE, BRICK_SIZE, threshold)) {
                return true;
            }
        }

        // 检查钢块碰撞
        for (let i = 0; i < this.state.map.steels.length; i++) {
            if (!this.state.map.steels[i]) continue;

            const steelX = (i % STEELS_PER_ROW) * STEEL_SIZE;
            const steelY = Math.floor(i / STEELS_PER_ROW) * STEEL_SIZE;

            if (this.testCollision(x, y, TANK_SIZE, TANK_SIZE, steelX, steelY, STEEL_SIZE, STEEL_SIZE, threshold)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 计算新位置
     */
    private calculateNewPosition(x: number, y: number, direction: Direction, speed: number): { x: number; y: number } {
        switch (direction) {
            case 'up':
                return { x, y: y - speed };
            case 'down':
                return { x, y: y + speed };
            case 'left':
                return { x: x - speed, y };
            case 'right':
                return { x: x + speed, y };
        }
    }

    /**
     * 限制位置在战场范围内
     */
    private clampPosition(x: number, y: number, size: number): { x: number; y: number } {
        return {
            x: Math.max(0, Math.min(FIELD_SIZE - size, x)),
            y: Math.max(0, Math.min(FIELD_SIZE - size, y)),
        };
    }

    /**
     * 发射子弹
     */
    private fireBullet(tank: TankState): void {
        const bulletId = this.generateBulletId();

        // 计算子弹出生位置（坦克前方中心）
        let bulletX = tank.x + (TANK_SIZE - BULLET_SIZE) / 2;
        let bulletY = tank.y + (TANK_SIZE - BULLET_SIZE) / 2;

        switch (tank.direction) {
            case 'up':
                bulletY = tank.y - BULLET_SIZE;
                break;
            case 'down':
                bulletY = tank.y + TANK_SIZE;
                break;
            case 'left':
                bulletX = tank.x - BULLET_SIZE;
                break;
            case 'right':
                bulletX = tank.x + TANK_SIZE;
                break;
        }

        const bullet: BulletState = {
            bulletId,
            x: bulletX,
            y: bulletY,
            direction: tank.direction,
            speed: BULLET_SPEED,
            tankId: tank.tankId,
            power: 1,
        };

        this.state.bullets.push(bullet);

        // 设置坦克开火冷却
        tank.cooldown = 300; // 300ms 冷却
    }

    /**
     * 更新子弹位置
     */
    private updateBullets(delta: number): void {
        for (const bullet of this.state.bullets) {
            const speed = bullet.speed * delta;
            const newPos = this.calculateNewPosition(bullet.x, bullet.y, bullet.direction, speed);
            bullet.x = newPos.x;
            bullet.y = newPos.y;
        }

        // 移除出界的子弹
        this.state.bullets = this.state.bullets.filter(bullet => {
            return bullet.x >= 0 && bullet.x + BULLET_SIZE <= FIELD_SIZE &&
                bullet.y >= 0 && bullet.y + BULLET_SIZE <= FIELD_SIZE;
        });
    }

    /**
     * 处理碰撞检测
     */
    private handleCollisions(): void {
        // 子弹与墙体碰撞检测（并破坏砖块）
        this.handleBulletWallCollisions();
        // 子弹与坦克碰撞检测
        this.handleBulletTankCollisions();
    }

    /**
     * 处理子弹与墙体的碰撞（移植自前端 bulletsSaga）
     */
    private handleBulletWallCollisions(): void {
        const bulletsToRemove: number[] = [];

        for (const bullet of this.state.bullets) {
            let bulletHit = false;
            const bricksToDestroy: number[] = [];
            const steelsToDestroy: number[] = [];

            // 子弹碰撞区域（扩展为 spreadBullet 效果）
            const bulletRect = {
                x: bullet.x,
                y: bullet.y,
                width: BULLET_SIZE,
                height: BULLET_SIZE,
            };

            // 遍历砖块（使用 IndexHelper.iter 逻辑）
            const brickCol1 = Math.max(0, Math.floor(bulletRect.x / BRICK_SIZE));
            const brickCol2 = Math.min(BRICKS_PER_ROW - 1, Math.floor((bulletRect.x + bulletRect.width) / BRICK_SIZE));
            const brickRow1 = Math.max(0, Math.floor(bulletRect.y / BRICK_SIZE));
            const brickRow2 = Math.min(BRICKS_PER_ROW - 1, Math.floor((bulletRect.y + bulletRect.height) / BRICK_SIZE));

            for (let row = brickRow1; row <= brickRow2; row++) {
                for (let col = brickCol1; col <= brickCol2; col++) {
                    const brickIndex = row * BRICKS_PER_ROW + col;
                    if (this.state.map.bricks[brickIndex]) {
                        bricksToDestroy.push(brickIndex);
                        bulletHit = true;
                    }
                }
            }

            // 遍历钢块
            const steelCol1 = Math.max(0, Math.floor(bulletRect.x / STEEL_SIZE));
            const steelCol2 = Math.min(STEELS_PER_ROW - 1, Math.floor((bulletRect.x + bulletRect.width) / STEEL_SIZE));
            const steelRow1 = Math.max(0, Math.floor(bulletRect.y / STEEL_SIZE));
            const steelRow2 = Math.min(STEELS_PER_ROW - 1, Math.floor((bulletRect.y + bulletRect.height) / STEEL_SIZE));

            for (let row = steelRow1; row <= steelRow2; row++) {
                for (let col = steelCol1; col <= steelCol2; col++) {
                    const steelIndex = row * STEELS_PER_ROW + col;
                    if (this.state.map.steels[steelIndex]) {
                        bulletHit = true;
                        // 高威力子弹可以破坏钢块
                        if (bullet.power >= 3) {
                            steelsToDestroy.push(steelIndex);
                        }
                    }
                }
            }

            // 破坏碰撞的砖块和钢块
            for (const brickIndex of bricksToDestroy) {
                this.state.map.bricks[brickIndex] = false;
            }
            for (const steelIndex of steelsToDestroy) {
                this.state.map.steels[steelIndex] = false;
            }

            if (bulletHit) {
                bulletsToRemove.push(bullet.bulletId);
            }
        }

        // 移除碰撞的子弹
        this.state.bullets = this.state.bullets.filter(
            b => !bulletsToRemove.includes(b.bulletId)
        );
    }

    /**
     * 处理子弹与坦克的碰撞
     */
    private handleBulletTankCollisions(): void {
        const bulletsToRemove: number[] = [];

        for (const bullet of this.state.bullets) {
            // 获取发射子弹的坦克
            const sourceTank = this.state.tanks.find(t => t.tankId === bullet.tankId);
            const sourceSide = sourceTank?.side || 'player';

            for (const tank of this.state.tanks) {
                // 跳过自己发射的子弹
                if (tank.tankId === bullet.tankId) {
                    continue;
                }

                // 跳过已死亡的坦克
                if (!tank.alive) {
                    continue;
                }

                // 检测碰撞
                if (this.testCollision(
                    bullet.x, bullet.y, BULLET_SIZE, BULLET_SIZE,
                    tank.x, tank.y, TANK_SIZE, TANK_SIZE
                )) {
                    // 玩家子弹击中其他坦克
                    if (sourceSide === 'player') {
                        // 如果目标也是玩家坦克：友伤（可选择是否生效）
                        if (tank.side === 'player') {
                            // 暂时不处理友伤，只移除子弹
                            bulletsToRemove.push(bullet.bulletId);
                        } else {
                            // 击中 AI 坦克
                            tank.hp -= 1;
                            if (tank.hp <= 0) {
                                tank.alive = false;
                            }
                            bulletsToRemove.push(bullet.bulletId);
                        }
                    } else if (sourceSide === 'bot' && tank.side === 'player') {
                        // AI 子弹击中玩家坦克
                        if (tank.helmetDuration <= 0) {
                            // 没有无敌状态
                            tank.hp -= 1;
                            if (tank.hp <= 0) {
                                tank.alive = false;
                            }
                        }
                        bulletsToRemove.push(bullet.bulletId);
                    }
                    // AI 子弹不能击中 AI 坦克（穿过）
                }
            }
        }

        // 移除碰撞的子弹
        this.state.bullets = this.state.bullets.filter(
            b => !bulletsToRemove.includes(b.bulletId)
        );
    }

    /**
     * 矩形碰撞检测（与前端 testCollide 完全一致）
     * threshold < 0 表示允许轻微重叠
     */
    private testCollision(
        x1: number, y1: number, w1: number, h1: number,
        x2: number, y2: number, w2: number, h2: number,
        threshold: number = 0
    ): boolean {
        // 与前端 testCollide 算法一致：
        // between(subject.x - object.width, object.x, subject.x + subject.width, threshold)
        // between(subject.y - object.height, object.y, subject.y + subject.height, threshold)
        const between = (min: number, value: number, max: number, th: number) =>
            min - th <= value && value <= max + th;

        return (
            between(x2 - w1, x1, x2 + w2, threshold) &&
            between(y2 - h1, y1, y2 + h2, threshold)
        );
    }

    /**
     * 更新坦克状态
     */
    private updateTankStates(delta: number): void {
        for (const tank of this.state.tanks) {
            // 减少冷却时间
            if (tank.cooldown > 0) {
                tank.cooldown = Math.max(0, tank.cooldown - delta);
            }

            // 减少无敌时间
            if (tank.helmetDuration > 0) {
                tank.helmetDuration = Math.max(0, tank.helmetDuration - delta);
            }

            // 减少冻结时间
            if (tank.frozenTimeout > 0) {
                tank.frozenTimeout = Math.max(0, tank.frozenTimeout - delta);
            }
        }
    }

    /**
     * 处理玩家输入
     */
    handleInput(role: 'host' | 'guest', input: PlayerInput): void {
        if (this.state.gameStatus !== 'playing') {
            return;
        }

        this.playerInputs[role] = {
            direction: input.direction || this.playerInputs[role].direction,
            moving: input.moving,
            firing: input.firing,
        };
    }

    /**
     * 获取当前游戏状态（用于广播）
     */
    getState(): StateSyncPayload {
        return {
            tanks: this.state.tanks,
            bullets: this.state.bullets,
            map: this.state.map,
            players: this.state.players,
            remainingBots: this.state.remainingBots,
            gameStatus: this.state.gameStatus,
            timestamp: Date.now(),
        };
    }

    /**
     * 获取房间ID
     */
    getRoomId(): string {
        return this.roomId;
    }
}
