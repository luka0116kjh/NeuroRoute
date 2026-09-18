/**
 * NeuroRoute 시뮬레이션 엔진 공개 API.
 * 순수 TypeScript — 브라우저/렌더링 API 에 의존하지 않는다.
 */
export type {
  MovementCommand,
  Obstacle,
  RayHit,
  RobotSpawn,
  RobotState,
  ScenarioInfo,
  SensorRays,
  SensorReadings,
  Vec2,
  WorldState,
} from "./types";

export * as SIM_CONSTANTS from "./constants";

export { castSensors, castSensorRays, castRay } from "./sensors";
export type { RayCastOptions } from "./sensors";

export {
  createWorld,
  isMovementCommand,
  resetWorld,
  sanitizeWorld,
  stepWorld,
} from "./world";
export type { WorldConfig } from "./world";

export {
  SCENARIOS,
  createDefaultWorld,
  createScenario,
  listScenarios,
} from "./scenarios";

export {
  circleIntersectsRect,
  normalizeAngle,
  rayRectIntersection,
} from "./geometry";
