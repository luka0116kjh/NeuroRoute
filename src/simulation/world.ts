import {
  DEFAULT_GOAL_RADIUS,
  DEFAULT_ROBOT_RADIUS,
  DEFAULT_ROBOT_SPEED,
  DEFAULT_SENSOR_RANGE,
  DEFAULT_WORLD_HEIGHT,
  DEFAULT_WORLD_WIDTH,
  EPSILON,
  MAX_DELTA_SECONDS,
  MAX_SUBSTEPS,
  MAX_TRAIL_POINTS,
  ROBOT_TURN_RATE,
  SUBSTEP_DISTANCE_RATIO,
  TRAIL_MIN_DISTANCE,
  TURN_FORWARD_SPEED_RATIO,
} from "./constants";
import {
  circleRectPenetration,
  clamp,
  direction,
  distance,
  finiteOr,
  isFiniteVec,
  isValidObstacle,
  normalizeAngle,
  positiveOr,
} from "./geometry";
import type {
  MovementCommand,
  Obstacle,
  RobotSpawn,
  RobotState,
  Vec2,
  WorldState,
} from "./types";

/** 이동 중 장애물 표면을 찾는 이분 탐색 반복 횟수 (고정 → 결정적, 무한 루프 없음) */
const CONTACT_BISECTION_ITERATIONS = 12;

const MOVEMENT_COMMANDS: readonly MovementCommand[] = [
  "FORWARD",
  "TURN_LEFT",
  "TURN_RIGHT",
  "STOP",
];

export function isMovementCommand(value: unknown): value is MovementCommand {
  return MOVEMENT_COMMANDS.includes(value as MovementCommand);
}

export type WorldConfig = {
  width?: number;
  height?: number;
  start: Vec2;
  startAngle?: number;
  goal: Vec2;
  goalRadius?: number;
  obstacles?: Obstacle[];
  scenarioId?: string;
  robot?: Partial<Pick<RobotState, "radius" | "speed" | "sensorRange">>;
};

// ---------------------------------------------------------------------------
// 생성 / 정규화
// ---------------------------------------------------------------------------

function cloneObstacle(o: Obstacle): Obstacle {
  return {
    id: String(o.id),
    position: { x: o.position.x, y: o.position.y },
    width: o.width,
    height: o.height,
  };
}

function clampToBounds(
  p: Vec2,
  radius: number,
  width: number,
  height: number
): Vec2 {
  return {
    x: clamp(p.x, radius, width - radius),
    y: clamp(p.y, radius, height - radius),
  };
}

/** 설정값으로 새 월드를 만든다. 비정상 값은 기본값으로 대체된다. */
export function createWorld(config: WorldConfig): WorldState {
  const width = positiveOr(config.width, DEFAULT_WORLD_WIDTH);
  const height = positiveOr(config.height, DEFAULT_WORLD_HEIGHT);
  const radius = positiveOr(config.robot?.radius, DEFAULT_ROBOT_RADIUS);
  const speed = nonNegativeOr(config.robot?.speed, DEFAULT_ROBOT_SPEED);
  const sensorRange = nonNegativeOr(
    config.robot?.sensorRange,
    DEFAULT_SENSOR_RANGE
  );
  const center = { x: width / 2, y: height / 2 };
  const start = clampToBounds(
    isFiniteVec(config.start) ? config.start : center,
    radius,
    width,
    height
  );
  const angle = normalizeAngle(finiteOr(config.startAngle, 0));
  const goal = isFiniteVec(config.goal) ? { ...config.goal } : center;
  const goalRadius = positiveOr(config.goalRadius, DEFAULT_GOAL_RADIUS);

  return {
    width,
    height,
    robot: {
      position: { ...start },
      angle,
      radius,
      speed,
      sensorRange,
      trail: [{ ...start }],
      collisions: 0,
      reachedGoal: distance(start, goal) <= goalRadius,
      inContact: false,
    },
    goal,
    goalRadius,
    obstacles: (config.obstacles ?? []).map(cloneObstacle),
    elapsedTime: 0,
    running: false,
    scenarioId: config.scenarioId,
    spawn: { position: { ...start }, angle },
  };
}

function nonNegativeOr(value: unknown, fallback: number): number {
  const v = finiteOr(value, fallback);
  return v >= 0 ? v : fallback;
}

/**
 * 외부에서 들어온(혹은 UI가 수정한) 월드를 방어적으로 복사·정규화한다.
 * NaN/Infinity/음수 크기 등을 안전한 값으로 바꾼다.
 */
export function sanitizeWorld(world: WorldState): WorldState {
  const width = positiveOr(world?.width, DEFAULT_WORLD_WIDTH);
  const height = positiveOr(world?.height, DEFAULT_WORLD_HEIGHT);
  const r = (world?.robot ?? {}) as Partial<RobotState>;
  const radius = positiveOr(r.radius, DEFAULT_ROBOT_RADIUS);
  const center = { x: width / 2, y: height / 2 };
  const spawn = sanitizeSpawn(world?.spawn, radius, width, height);

  const rawPos = isFiniteVec(r.position)
    ? r.position
    : spawn?.position ?? center;
  const position = clampToBounds(rawPos, radius, width, height);
  const trail = Array.isArray(r.trail)
    ? r.trail.filter(isFiniteVec).map((p) => ({ x: p.x, y: p.y }))
    : [];

  return {
    width,
    height,
    robot: {
      position,
      angle: normalizeAngle(finiteOr(r.angle, 0)),
      radius,
      speed: nonNegativeOr(r.speed, DEFAULT_ROBOT_SPEED),
      sensorRange: nonNegativeOr(r.sensorRange, DEFAULT_SENSOR_RANGE),
      trail: trail.length > 0 ? trail : [{ ...position }],
      collisions: Math.max(0, Math.floor(finiteOr(r.collisions, 0))),
      reachedGoal: r.reachedGoal === true,
      inContact: r.inContact === true,
    },
    goal: isFiniteVec(world?.goal) ? { x: world.goal.x, y: world.goal.y } : center,
    goalRadius: positiveOr(world?.goalRadius, DEFAULT_GOAL_RADIUS),
    obstacles: Array.isArray(world?.obstacles) ? world.obstacles : [],
    elapsedTime: nonNegativeOr(world?.elapsedTime, 0),
    running: world?.running === true,
    scenarioId: world?.scenarioId,
    spawn,
  };
}

function sanitizeSpawn(
  spawn: RobotSpawn | undefined,
  radius: number,
  width: number,
  height: number
): RobotSpawn | undefined {
  if (!spawn || !isFiniteVec(spawn.position)) return undefined;
  return {
    position: clampToBounds(spawn.position, radius, width, height),
    angle: normalizeAngle(finiteOr(spawn.angle, 0)),
  };
}

// ---------------------------------------------------------------------------
// 충돌
// ---------------------------------------------------------------------------

function maxPenetration(
  p: Vec2,
  radius: number,
  obstacles: readonly Obstacle[]
): number {
  let worst = -Infinity;
  for (const o of obstacles) {
    const pen = circleRectPenetration(p, radius, o);
    if (pen > worst) worst = pen;
  }
  return worst;
}

/**
 * from → to 이동이 장애물에 막히는지.
 * - 이동 후 겹치면 막힘.
 * - 단, 이미 겹친 상태(잘못된 초기 배치 등)라면 침투가 줄어드는 이동은 허용해 빠져나올 수 있게 한다.
 */
function isBlocked(
  from: Vec2,
  to: Vec2,
  radius: number,
  obstacles: readonly Obstacle[]
): boolean {
  const penTo = maxPenetration(to, radius, obstacles);
  if (penTo <= EPSILON) return false;
  const penFrom = maxPenetration(from, radius, obstacles);
  return !(penFrom > EPSILON && penTo < penFrom - EPSILON);
}

type MoveResult = { position: Vec2; blocked: boolean };

/**
 * 한 서브스텝 이동을 시도한다.
 * 1) 경계로 클램프한 목표 지점이 비어 있으면 이동 (클램프됐다면 벽 접촉).
 * 2) 막히면 이분 탐색으로 장애물 표면 직전까지 전진한 뒤,
 *    남은 이동량을 x축 → y축 순서로 슬라이딩 시도.
 */
function tryMove(
  from: Vec2,
  delta: Vec2,
  radius: number,
  world: { width: number; height: number },
  obstacles: readonly Obstacle[]
): MoveResult {
  const bound = (p: Vec2) =>
    clampToBounds(p, radius, world.width, world.height);
  const target = { x: from.x + delta.x, y: from.y + delta.y };
  const clamped = bound(target);
  const hitWall = distance(target, clamped) > EPSILON;

  if (!isBlocked(from, clamped, radius, obstacles)) {
    return { position: clamped, blocked: hitWall };
  }

  // 장애물 표면까지 최대한 전진
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < CONTACT_BISECTION_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    const p = bound({ x: from.x + delta.x * mid, y: from.y + delta.y * mid });
    if (isBlocked(from, p, radius, obstacles)) hi = mid;
    else lo = mid;
  }
  const contact = bound({ x: from.x + delta.x * lo, y: from.y + delta.y * lo });
  const rest = { x: delta.x * (1 - lo), y: delta.y * (1 - lo) };

  // 축 방향 슬라이딩
  const slides: Vec2[] = [
    { x: contact.x + rest.x, y: contact.y },
    { x: contact.x, y: contact.y + rest.y },
  ];
  for (const s of slides) {
    const p = bound(s);
    if (distance(p, contact) > EPSILON && !isBlocked(contact, p, radius, obstacles)) {
      return { position: p, blocked: true };
    }
  }
  return { position: contact, blocked: true };
}

// ---------------------------------------------------------------------------
// 스텝
// ---------------------------------------------------------------------------

function pushTrail(trail: Vec2[], p: Vec2): void {
  const last = trail[trail.length - 1];
  if (last && distance(last, p) < TRAIL_MIN_DISTANCE) return;
  trail.push({ x: p.x, y: p.y });
  if (trail.length > MAX_TRAIL_POINTS) {
    trail.splice(0, trail.length - MAX_TRAIL_POINTS);
  }
}

/**
 * 월드를 deltaSeconds 만큼 진행한 새 상태를 반환한다. 입력 월드는 변경하지 않는다.
 *
 * - deltaSeconds 는 [0, MAX_DELTA_SECONDS] 로 클램프 (NaN/음수 → 0).
 * - 알 수 없는 명령은 STOP 으로 취급.
 * - `running` 플래그는 검사하지 않는다 (루프 제어는 UI 책임). 목표 도착 시 running=false 로 설정.
 * - 목표에 도착한 뒤에는 더 이상 움직이지 않는다 (resetWorld 로 재시작).
 */
export function stepWorld(
  world: WorldState,
  command: MovementCommand,
  deltaSeconds: number
): WorldState {
  const w = sanitizeWorld(world);
  const robot = w.robot;

  if (robot.reachedGoal) {
    return { ...w, running: false };
  }

  const dt = clamp(finiteOr(deltaSeconds, 0), 0, MAX_DELTA_SECONDS);
  if (dt <= 0) return w;

  const cmd: MovementCommand = isMovementCommand(command) ? command : "STOP";
  const isTurn = cmd === "TURN_LEFT" || cmd === "TURN_RIGHT";
  const linearSpeed =
    cmd === "FORWARD"
      ? robot.speed
      : isTurn
        ? robot.speed * TURN_FORWARD_SPEED_RATIO
        : 0;
  // 화면 좌표계(y 아래)에서 왼쪽 = angle 감소
  const angularSpeed =
    cmd === "TURN_LEFT" ? -ROBOT_TURN_RATE : cmd === "TURN_RIGHT" ? ROBOT_TURN_RATE : 0;

  const maxSubstepDistance = robot.radius * SUBSTEP_DISTANCE_RATIO;
  const totalDistance = linearSpeed * dt;
  const substeps = clamp(
    Math.ceil(totalDistance / maxSubstepDistance) || 1,
    1,
    MAX_SUBSTEPS
  );
  const subDt = dt / substeps;
  const obstacles = w.obstacles.filter(isValidObstacle);

  let position = robot.position;
  let angle = robot.angle;
  let blocked = false;
  let reachedGoal = false;
  let simulated = 0;
  const trail = robot.trail;

  for (let i = 0; i < substeps; i++) {
    angle = normalizeAngle(angle + angularSpeed * subDt);
    if (linearSpeed > 0) {
      const dir = direction(angle);
      const step = linearSpeed * subDt;
      const res = tryMove(
        position,
        { x: dir.x * step, y: dir.y * step },
        robot.radius,
        w,
        obstacles
      );
      position = res.position;
      blocked = blocked || res.blocked;
      pushTrail(trail, position);
    }
    simulated += subDt;
    if (distance(position, w.goal) <= w.goalRadius) {
      reachedGoal = true;
      break;
    }
  }

  // 충돌 이벤트는 "접촉이 새로 시작될 때"만 센다. STOP 은 접촉 상태를 유지.
  const inContact = linearSpeed > 0 ? blocked : robot.inContact === true;
  const newCollision = inContact && robot.inContact !== true;

  return {
    ...w,
    robot: {
      ...robot,
      position,
      angle,
      trail,
      collisions: robot.collisions + (newCollision ? 1 : 0),
      reachedGoal,
      inContact,
    },
    elapsedTime: w.elapsedTime + simulated,
    running: reachedGoal ? false : w.running,
  };
}

/**
 * 로봇을 출발 상태로 되돌린 새 월드를 반환한다.
 * 맵(크기, 장애물, 목표)과 로봇 파라미터(반경, 속도, 센서 사거리)는 유지한다.
 */
export function resetWorld(world: WorldState): WorldState {
  const w = sanitizeWorld(world);
  const spawn: RobotSpawn = w.spawn ?? {
    position: w.robot.trail[0] ?? w.robot.position,
    angle: 0,
  };
  const position = { ...spawn.position };
  return {
    ...w,
    robot: {
      ...w.robot,
      position,
      angle: spawn.angle,
      trail: [{ ...position }],
      collisions: 0,
      reachedGoal: distance(position, w.goal) <= w.goalRadius,
      inContact: false,
    },
    elapsedTime: 0,
    running: false,
    spawn: { position: { ...position }, angle: spawn.angle },
  };
}
