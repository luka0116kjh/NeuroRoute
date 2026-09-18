import {
  DEFAULT_SENSOR_RANGE,
  SENSORS_DETECT_WALLS,
  SENSOR_ANGLE_OFFSET,
  WALL_HIT_ID,
} from "./constants";
import {
  add,
  direction,
  finiteOr,
  isFiniteVec,
  isValidObstacle,
  normalizeAngle,
  rayBoundsExit,
  rayRectIntersection,
  scale,
} from "./geometry";
import type {
  Obstacle,
  RayHit,
  SensorReadings,
  SensorRays,
  Vec2,
  WorldState,
} from "./types";

export type RayCastOptions = {
  /** 월드 경계를 장애물로 취급할지 (기본값: SENSORS_DETECT_WALLS) */
  detectWalls?: boolean;
};

/**
 * 단일 레이 캐스트. 가장 가까운 교차점을 반환한다.
 * 반환 distance 는 항상 0 이상 maxRange 이하.
 */
export function castRay(
  origin: Vec2,
  angle: number,
  maxRange: number,
  obstacles: readonly Obstacle[],
  bounds: { width: number; height: number } | null
): RayHit {
  const range = Math.max(0, finiteOr(maxRange, 0));
  const a = normalizeAngle(angle);
  const dir = direction(a);

  let best = range;
  let hitId: string | null = null;

  if (isFiniteVec(origin)) {
    for (const o of obstacles) {
      if (!isValidObstacle(o)) continue;
      const t = rayRectIntersection(origin, dir, o);
      if (t !== null && t < best) {
        best = t;
        hitId = o.id;
      }
    }
    if (bounds) {
      const t = rayBoundsExit(origin, dir, bounds.width, bounds.height);
      if (t < best) {
        best = t;
        hitId = WALL_HIT_ID;
      }
    }
  }

  const dist = Math.min(range, Math.max(0, best));
  const safeOrigin = isFiniteVec(origin) ? origin : { x: 0, y: 0 };
  return {
    origin: { ...safeOrigin },
    end: add(safeOrigin, scale(dir, dist)),
    angle: a,
    distance: dist,
    hitId,
  };
}

/** 좌·중앙·우 센서 레이 전체 (렌더링용 끝점 포함) */
export function castSensorRays(
  world: WorldState,
  options: RayCastOptions = {}
): SensorRays {
  const { robot } = world;
  const detectWalls = options.detectWalls ?? SENSORS_DETECT_WALLS;
  const range = Math.max(0, finiteOr(robot.sensorRange, DEFAULT_SENSOR_RANGE));
  const angle = finiteOr(robot.angle, 0);
  const obstacles = Array.isArray(world.obstacles) ? world.obstacles : [];
  const bounds =
    detectWalls && Number.isFinite(world.width) && Number.isFinite(world.height)
      ? { width: world.width, height: world.height }
      : null;

  const cast = (a: number) =>
    castRay(robot.position, a, range, obstacles, bounds);

  return {
    left: cast(angle - SENSOR_ANGLE_OFFSET),
    center: cast(angle),
    right: cast(angle + SENSOR_ANGLE_OFFSET),
  };
}

/** 좌·중앙·우 센서 거리값 (px, 0 ~ sensorRange) */
export function castSensors(
  world: WorldState,
  options: RayCastOptions = {}
): SensorReadings {
  const rays = castSensorRays(world, options);
  return {
    left: rays.left.distance,
    center: rays.center.distance,
    right: rays.right.distance,
  };
}
