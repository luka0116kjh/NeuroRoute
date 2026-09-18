import {
  DEFAULT_ROBOT_RADIUS,
  DEFAULT_SCENARIO_ID,
  DEFAULT_WORLD_HEIGHT as H,
  DEFAULT_WORLD_WIDTH as W,
} from "./constants";
import { circleIntersectsRect, distance } from "./geometry";
import type { Obstacle, ScenarioInfo, Vec2, WorldState } from "./types";
import { createWorld, type WorldConfig } from "./world";

/** 맵 설계용 상수 */
const WALL_THICKNESS = 20;
const START_MARGIN = 60;
const FOREST_SEED = 20260918;
const FOREST_TREE_COUNT = 28;
const FOREST_TREE_MIN_SIZE = 24;
const FOREST_TREE_MAX_SIZE = 56;
const FOREST_MAX_ATTEMPTS = 1000;
/** 출발/목표 지점 주변에 비워둘 여유 (로봇 지름의 배수) */
const FOREST_CLEARANCE = DEFAULT_ROBOT_RADIUS * 5;

function box(id: string, x: number, y: number, width: number, height: number): Obstacle {
  return { id, position: { x, y }, width, height };
}

/** 결정적 의사난수 생성기 (mulberry32). 같은 seed → 같은 수열. */
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function openField(): WorldConfig {
  return {
    scenarioId: "open-field",
    width: W,
    height: H,
    start: { x: START_MARGIN, y: H / 2 },
    startAngle: 0,
    goal: { x: W - START_MARGIN, y: H / 2 },
    obstacles: [
      box("block-1", 220, 240, 60, 120),
      box("block-2", 400, 100, 80, 80),
      box("block-3", 400, 420, 80, 80),
      box("block-4", 560, 260, 50, 80),
    ],
  };
}

function corridor(): WorldConfig {
  const t = WALL_THICKNESS;
  // 위/아래로 번갈아 뚫린 벽 → 지그재그 주행 필요
  return {
    scenarioId: "corridor",
    width: W,
    height: H,
    start: { x: START_MARGIN, y: H / 2 },
    startAngle: 0,
    goal: { x: W - START_MARGIN, y: H / 2 },
    obstacles: [
      box("wall-1", 180, 0, t, 400),
      box("wall-2", 340, 200, t, 400),
      box("wall-3", 500, 0, t, 400),
      box("wall-4", 640, 200, t, 400),
    ],
  };
}

function maze(): WorldConfig {
  const t = WALL_THICKNESS;
  return {
    scenarioId: "maze",
    width: W,
    height: H,
    start: { x: START_MARGIN, y: START_MARGIN },
    startAngle: 0,
    goal: { x: W - START_MARGIN, y: H - START_MARGIN },
    obstacles: [
      box("maze-1", 0, 130, 560, t),
      box("maze-2", 660, 0, t, 260),
      box("maze-3", 140, 260, 660, t),
      box("maze-4", 140, 260, t, 200),
      box("maze-5", 0, 440, 60, t),
      box("maze-6", 280, 280, t, 240),
      box("maze-7", 420, 260, t, 220),
      box("maze-8", 560, 400, 240, t),
    ],
  };
}

function forest(): WorldConfig {
  const start: Vec2 = { x: START_MARGIN, y: H / 2 };
  const goal: Vec2 = { x: W - START_MARGIN, y: H / 2 };
  const rng = createRng(FOREST_SEED);
  const obstacles: Obstacle[] = [];

  for (
    let attempt = 0;
    attempt < FOREST_MAX_ATTEMPTS && obstacles.length < FOREST_TREE_COUNT;
    attempt++
  ) {
    const size =
      FOREST_TREE_MIN_SIZE + rng() * (FOREST_TREE_MAX_SIZE - FOREST_TREE_MIN_SIZE);
    const x = Math.round(rng() * (W - size));
    const y = Math.round(rng() * (H - size));
    const s = Math.round(size);
    const tree = box(`tree-${obstacles.length + 1}`, x, y, s, s);
    const blocksEndpoint =
      circleIntersectsRect(start, FOREST_CLEARANCE, tree) ||
      circleIntersectsRect(goal, FOREST_CLEARANCE, tree);
    const overlapsTree = obstacles.some(
      (o) =>
        distance(
          { x: o.position.x + o.width / 2, y: o.position.y + o.height / 2 },
          { x: x + s / 2, y: y + s / 2 }
        ) <
        (o.width + s) / 2 + DEFAULT_ROBOT_RADIUS * 3
    );
    if (!blocksEndpoint && !overlapsTree) obstacles.push(tree);
  }

  return {
    scenarioId: "forest",
    width: W,
    height: H,
    start,
    startAngle: 0,
    goal,
    obstacles,
  };
}

const SCENARIO_BUILDERS: Record<string, () => WorldConfig> = {
  "open-field": openField,
  corridor,
  maze,
  forest,
};

export const SCENARIOS: readonly ScenarioInfo[] = [
  { id: "open-field", name: "Open Field", description: "넓은 공간에 흩어진 블록 몇 개" },
  { id: "corridor", name: "Corridor", description: "위아래로 번갈아 뚫린 벽을 지그재그로 통과" },
  { id: "maze", name: "Maze", description: "좌상단에서 우하단까지 이어진 미로" },
  { id: "forest", name: "Forest", description: "고정 시드로 배치된 기둥 숲 (항상 동일한 배치)" },
];

export function listScenarios(): ScenarioInfo[] {
  return SCENARIOS.map((s) => ({ ...s }));
}

/** 시나리오 ID 로 새 월드를 만든다. 알 수 없는 ID 면 기본 시나리오를 반환한다. */
export function createScenario(scenarioId: string): WorldState {
  const builder =
    (typeof scenarioId === "string" &&
      Object.prototype.hasOwnProperty.call(SCENARIO_BUILDERS, scenarioId) &&
      SCENARIO_BUILDERS[scenarioId]) ||
    SCENARIO_BUILDERS[DEFAULT_SCENARIO_ID];
  return createWorld(builder());
}

export function createDefaultWorld(): WorldState {
  return createScenario(DEFAULT_SCENARIO_ID);
}
