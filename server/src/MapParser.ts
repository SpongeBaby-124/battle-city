/**
 * 服务器端地图解析模块
 * 将地图 JSON 格式解析为服务器可用的砖块/钢块数组
 */

const FIELD_BLOCK_SIZE = 13; // 地图块数（每行/列）
const BRICK_SIZE = 4; // 砖块像素大小
const STEEL_SIZE = 8; // 钢块像素大小
const BLOCK_SIZE = 16; // 块像素大小
const BRICKS_PER_ROW = 52; // 砖块每行数量
const STEELS_PER_ROW = 26; // 钢块每行数量

export interface ParsedMapResult {
    bricks: boolean[];
    steels: boolean[];
    eaglePos: { x: number; y: number } | null;
}

/**
 * 解析关卡地图
 * @param map 地图字符串数组（来自 stage-X.json）
 */
export function parseStageMap(map: string[]): ParsedMapResult {
    const bricks = new Array(BRICKS_PER_ROW * BRICKS_PER_ROW).fill(false);
    const steels = new Array(STEELS_PER_ROW * STEELS_PER_ROW).fill(false);
    let eaglePos: { x: number; y: number } | null = null;

    for (let row = 0; row < FIELD_BLOCK_SIZE; row++) {
        const line = map[row].toLowerCase().split(/ +/);
        for (let col = 0; col < FIELD_BLOCK_SIZE; col++) {
            const item = line[col]?.trim();
            if (!item) continue;

            if (item[0] === 'b') {
                // 砖块
                const bits = parseBrickBits(item.substring(1));
                const brickRow = 4 * row;
                const brickCol = 4 * col;
                const N = BRICKS_PER_ROW;

                const part0 = (bits >> 12) & 0xf;
                if (part0 & 0b0001) bricks[brickRow * N + brickCol + 0] = true;
                if (part0 & 0b0010) bricks[brickRow * N + brickCol + 1] = true;
                if (part0 & 0b0100) bricks[brickRow * N + brickCol + N] = true;
                if (part0 & 0b1000) bricks[brickRow * N + brickCol + N + 1] = true;

                const part1 = (bits >> 8) & 0xf;
                if (part1 & 0b0001) bricks[brickRow * N + brickCol + 2 + 0] = true;
                if (part1 & 0b0010) bricks[brickRow * N + brickCol + 2 + 1] = true;
                if (part1 & 0b0100) bricks[brickRow * N + brickCol + 2 + N] = true;
                if (part1 & 0b1000) bricks[brickRow * N + brickCol + 2 + N + 1] = true;

                const part2 = (bits >> 4) & 0xf;
                if (part2 & 0b0001) bricks[(brickRow + 2) * N + brickCol + 0] = true;
                if (part2 & 0b0010) bricks[(brickRow + 2) * N + brickCol + 1] = true;
                if (part2 & 0b0100) bricks[(brickRow + 2) * N + brickCol + N] = true;
                if (part2 & 0b1000) bricks[(brickRow + 2) * N + brickCol + N + 1] = true;

                const part3 = (bits >> 0) & 0xf;
                if (part3 & 0b0001) bricks[(brickRow + 2) * N + brickCol + 2 + 0] = true;
                if (part3 & 0b0010) bricks[(brickRow + 2) * N + brickCol + 2 + 1] = true;
                if (part3 & 0b0100) bricks[(brickRow + 2) * N + brickCol + 2 + N] = true;
                if (part3 & 0b1000) bricks[(brickRow + 2) * N + brickCol + 2 + N + 1] = true;
            } else if (item[0] === 't') {
                // 钢块
                const bits = parseInt(item[1], 16);
                if (bits & 0b0001) steels[2 * row * STEELS_PER_ROW + 2 * col] = true;
                if (bits & 0b0010) steels[2 * row * STEELS_PER_ROW + 2 * col + 1] = true;
                if (bits & 0b0100) steels[(2 * row + 1) * STEELS_PER_ROW + 2 * col] = true;
                if (bits & 0b1000) steels[(2 * row + 1) * STEELS_PER_ROW + 2 * col + 1] = true;
            } else if (item[0] === 'e') {
                // 老鹰
                eaglePos = {
                    x: col * BLOCK_SIZE,
                    y: row * BLOCK_SIZE,
                };
            }
            // 跳过 river, snow, forest（服务器暂不处理）
        }
    }

    return { bricks, steels, eaglePos };
}

/**
 * 解析砖块位图
 */
function parseBrickBits(str: string): number {
    if (str.length === 1) {
        const short = parseInt(str, 16);
        let long = 0;
        if (0b0001 & short) long += 0xf000;
        if (0b0010 & short) long += 0x0f00;
        if (0b0100 & short) long += 0x00f0;
        if (0b1000 & short) long += 0x000f;
        return long;
    } else if (str.length === 4) {
        return parseInt(str, 16);
    }
    return 0;
}

// Stage 1 地图数据（硬编码）
export const STAGE_1_MAP: string[] = [
    "X  X  X  X  X  X  X  X  X  X  X  X  X  ",
    "X  Bf X  Bf X  Bf X  Bf X  Bf X  Bf X  ",
    "X  Bf X  Bf X  Bf X  Bf X  Bf X  Bf X  ",
    "X  Bf X  Bf X  Bf Tf Bf X  Bf X  Bf X  ",
    "X  Bf X  Bf X  B3 X  B3 X  Bf X  Bf X  ",
    "X  B3 X  B3 X  Bc X  Bc X  B3 X  B3 X  ",
    "Bc X  Bc Bc X  B3 X  B3 X  Bc Bc X  Bc ",
    "T3 X  B3 B3 X  Bc X  Bc X  B3 B3 X  T3 ",
    "X  Bc X  Bc X  Bf Bf Bf X  Bc X  Bc X  ",
    "X  Bf X  Bf X  Bf X  Bf X  Bf X  Bf X  ",
    "X  Bf X  Bf X  B3 X  B3 X  Bf X  Bf X  ",
    "X  Bf X  Bf X  B8 Bc B4 X  Bf X  Bf X  ",
    "X  X  X  X  X  Ba E  B5 X  X  X  X  X  ",
];
