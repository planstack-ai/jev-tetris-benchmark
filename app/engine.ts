export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;
export const TARGET_LINES = 20;

export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Board = Cell[][];
export type PieceName = "I" | "O" | "T" | "S" | "Z" | "J" | "L";
export type PlayerKind = "jev" | "haiku";

type Point = readonly [number, number];

export type Candidate = {
  id: number;
  board: Board;
  boardRows: string[];
  clearedLines: number;
  rotation: number;
  x: number;
  topOut: false;
  metrics: {
    holes: number;
    holesAdded: number;
    coveredHoles: number;
    aggregateHeight: number;
    maxHeight: number;
    bumpiness: number;
    wells: number;
  };
  baseScore: number;
  jevScore: number;
  haikuScore: number;
};

const SHAPES: Record<PieceName, readonly (readonly Point[])[]> = {
  I: [
    [[0, 0], [1, 0], [2, 0], [3, 0]],
    [[0, 0], [0, 1], [0, 2], [0, 3]],
  ],
  O: [
    [[0, 0], [1, 0], [0, 1], [1, 1]],
  ],
  T: [
    [[0, 0], [1, 0], [2, 0], [1, 1]],
    [[1, 0], [0, 1], [1, 1], [1, 2]],
    [[1, 0], [0, 1], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [1, 1], [0, 2]],
  ],
  S: [
    [[1, 0], [2, 0], [0, 1], [1, 1]],
    [[0, 0], [0, 1], [1, 1], [1, 2]],
  ],
  Z: [
    [[0, 0], [1, 0], [1, 1], [2, 1]],
    [[1, 0], [0, 1], [1, 1], [0, 2]],
  ],
  J: [
    [[0, 0], [0, 1], [1, 1], [2, 1]],
    [[0, 0], [1, 0], [0, 1], [0, 2]],
    [[0, 0], [1, 0], [2, 0], [2, 1]],
    [[1, 0], [1, 1], [0, 2], [1, 2]],
  ],
  L: [
    [[2, 0], [0, 1], [1, 1], [2, 1]],
    [[0, 0], [0, 1], [0, 2], [1, 2]],
    [[0, 0], [1, 0], [2, 0], [0, 1]],
    [[0, 0], [1, 0], [1, 1], [1, 2]],
  ],
};

const PIECE_IDS: Record<PieceName, Cell> = {
  I: 1,
  O: 2,
  T: 3,
  S: 4,
  Z: 5,
  J: 6,
  L: 7,
};

const INITIAL_ROWS = [
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "..........",
  "...#......",
  ".###...#..",
  "#####.###.",
];

export function createInitialBoard(): Board {
  return INITIAL_ROWS.map((row) =>
    [...row].map((cell) => (cell === "#" ? 7 : 0) as Cell),
  );
}

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

export function createPieceSequence(seed = 20260918, length = 320): PieceName[] {
  const random = seededRandom(seed);
  const names: PieceName[] = ["I", "O", "T", "S", "Z", "J", "L"];
  const sequence: PieceName[] = [];

  while (sequence.length < length) {
    const bag = [...names];
    for (let index = bag.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [bag[index], bag[swap]] = [bag[swap], bag[index]];
    }
    sequence.push(...bag);
  }

  return sequence.slice(0, length);
}

function cloneBoard(board: Board): Board {
  return board.map((row) => [...row]);
}

function canPlace(board: Board, shape: readonly Point[], offsetX: number, offsetY: number) {
  return shape.every(([x, y]) => {
    const boardX = offsetX + x;
    const boardY = offsetY + y;
    return (
      boardX >= 0 &&
      boardX < BOARD_WIDTH &&
      boardY >= 0 &&
      boardY < BOARD_HEIGHT &&
      board[boardY][boardX] === 0
    );
  });
}

function clearCompletedLines(board: Board) {
  const remaining = board.filter((row) => row.some((cell) => cell === 0));
  const clearedLines = BOARD_HEIGHT - remaining.length;
  const emptyRows = Array.from({ length: clearedLines }, () =>
    Array<Cell>(BOARD_WIDTH).fill(0),
  );
  return { board: [...emptyRows, ...remaining], clearedLines };
}

function boardFeatures(board: Board) {
  const heights = Array<number>(BOARD_WIDTH).fill(0);
  let holes = 0;
  let coveredHoles = 0;

  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    let blockSeen = false;
    let blocksAbove = 0;
    for (let y = 0; y < BOARD_HEIGHT; y += 1) {
      if (board[y][x] !== 0) {
        if (!blockSeen) heights[x] = BOARD_HEIGHT - y;
        blockSeen = true;
        blocksAbove += 1;
      } else if (blockSeen) {
        holes += 1;
        coveredHoles += blocksAbove;
      }
    }
  }

  const aggregateHeight = heights.reduce((sum, height) => sum + height, 0);
  const maxHeight = Math.max(...heights);
  const bumpiness = heights.slice(1).reduce(
    (sum, height, index) => sum + Math.abs(height - heights[index]),
    0,
  );
  let wells = 0;
  for (let x = 0; x < BOARD_WIDTH; x += 1) {
    const left = x === 0 ? BOARD_HEIGHT : heights[x - 1];
    const right = x === BOARD_WIDTH - 1 ? BOARD_HEIGHT : heights[x + 1];
    const depth = Math.max(0, Math.min(left, right) - heights[x]);
    wells += (depth * (depth + 1)) / 2;
  }

  return { aggregateHeight, holes, coveredHoles, maxHeight, bumpiness, wells };
}

function rowsForModel(board: Board) {
  return board.map((row) => row.map((cell) => (cell === 0 ? "." : "#")).join(""));
}

export function enumerateCandidates(board: Board, piece: PieceName): Candidate[] {
  const allCandidates: Candidate[] = [];
  const currentFeatures = boardFeatures(board);

  SHAPES[piece].forEach((shape, rotation) => {
    const width = Math.max(...shape.map(([x]) => x)) + 1;
    for (let x = 0; x <= BOARD_WIDTH - width; x += 1) {
      let y = 0;
      if (!canPlace(board, shape, x, y)) continue;
      while (canPlace(board, shape, x, y + 1)) y += 1;

      const placed = cloneBoard(board);
      shape.forEach(([shapeX, shapeY]) => {
        placed[y + shapeY][x + shapeX] = PIECE_IDS[piece];
      });
      const cleared = clearCompletedLines(placed);
      const features = boardFeatures(cleared.board);
      const metrics = {
        ...features,
        holesAdded: Math.max(0, features.holes - currentFeatures.holes),
      };
      const lineValue = cleared.clearedLines * cleared.clearedLines;
      const baseScore =
        lineValue * 9.2 -
        features.aggregateHeight * 0.43 -
        features.holes * 5.8 -
        features.bumpiness * 0.32 -
        features.maxHeight * 0.24;
      const jevScore =
        lineValue * 9.6 -
        features.aggregateHeight * 0.46 -
        features.holes * 6.1 -
        features.coveredHoles * 0.19 -
        features.bumpiness * 0.27 -
        features.maxHeight * 0.28;
      const haikuScore =
        lineValue * 10.4 -
        features.aggregateHeight * 0.39 -
        features.holes * 6.7 -
        features.coveredHoles * 0.23 -
        features.bumpiness * 0.38 -
        features.wells * 0.08 -
        features.maxHeight * 0.31;

      allCandidates.push({
        id: allCandidates.length,
        board: cleared.board,
        boardRows: rowsForModel(cleared.board),
        clearedLines: cleared.clearedLines,
        rotation,
        x,
        topOut: false,
        metrics,
        baseScore,
        jevScore,
        haikuScore,
      });
    }
  });

  return allCandidates
    .sort((left, right) =>
      left.metrics.holesAdded - right.metrics.holesAdded ||
      right.clearedLines - left.clearedLines ||
      left.metrics.holes - right.metrics.holes ||
      left.metrics.coveredHoles - right.metrics.coveredHoles ||
      left.metrics.bumpiness - right.metrics.bumpiness ||
      left.metrics.maxHeight - right.metrics.maxHeight ||
      left.metrics.aggregateHeight - right.metrics.aggregateHeight ||
      right.baseScore - left.baseScore,
    )
    .slice(0, 12)
    .map((candidate, id) => ({ ...candidate, id }));
}

export function chooseCandidate(candidates: Candidate[], player: PlayerKind) {
  const scoreKey = player === "jev" ? "jevScore" : "haikuScore";
  return [...candidates].sort((left, right) => right[scoreKey] - left[scoreKey])[0];
}

export function pieceCells(piece: PieceName) {
  return { shape: SHAPES[piece][0], value: PIECE_IDS[piece] };
}
