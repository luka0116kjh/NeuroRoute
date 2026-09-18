/**
 * NeuroRoute 시뮬레이션 엔진의 데이터 타입.
 *
 * 좌표계: 캔버스와 동일한 화면 좌표계(원점 좌상단, x → 오른쪽, y → 아래쪽).
 * 각도: 라디안, 0 = +x 방향. 각도가 증가하면 화면상 시계 방향으로 회전한다.
 * 따라서 진행 방향 기준 "왼쪽"은 angle 감소 방향이다.
 */

export type Vec2 = {
  x: number;
  y: number;
};

export type MovementCommand = "FORWARD" | "TURN_LEFT" | "TURN_RIGHT" | "STOP";

/** 센서값은 로봇 중심에서 레이가 처음 닿은 지점까지의 픽셀 거리 (0 ~ sensorRange). */
export type SensorReadings = {
  left: number;
  center: number;
  right: number;
};

export type RobotState = {
  position: Vec2;
  /** 진행 방향 (라디안, (-π, π] 로 정규화) */
  angle: number;
  radius: number;
  /** 전진 속도 (px/s) */
  speed: number;
  sensorRange: number;
  trail: Vec2[];
  collisions: number;
  reachedGoal: boolean;
  /**
   * (추가 필드) 직전 스텝에서 장애물/벽에 막혀 있었는지 여부.
   * 충돌 횟수를 "접촉이 시작될 때" 1회만 세기 위해 사용한다.
   */
  inContact?: boolean;
};

/** position 은 사각형의 좌상단 모서리이다 (canvas fillRect 와 동일). */
export type Obstacle = {
  id: string;
  position: Vec2;
  width: number;
  height: number;
};

/** (추가 타입) 로봇 출발 위치/방향. resetWorld 가 사용한다. */
export type RobotSpawn = {
  position: Vec2;
  angle: number;
};

export type WorldState = {
  width: number;
  height: number;
  robot: RobotState;
  goal: Vec2;
  goalRadius: number;
  obstacles: Obstacle[];
  elapsedTime: number;
  running: boolean;
  /** (추가 필드) 이 월드를 만든 시나리오 ID */
  scenarioId?: string;
  /** (추가 필드) 리셋 시 돌아갈 출발 상태 */
  spawn?: RobotSpawn;
};

/** (추가 타입) 렌더링/디버깅용 레이 캐스트 결과 */
export type RayHit = {
  origin: Vec2;
  /** 레이의 끝점 (충돌 지점 또는 최대 사거리 지점) */
  end: Vec2;
  angle: number;
  distance: number;
  /** 닿은 장애물 ID. 벽이면 "wall", 아무것도 없으면 null */
  hitId: string | null;
};

export type SensorRays = {
  left: RayHit;
  center: RayHit;
  right: RayHit;
};

/** (추가 타입) 시나리오 목록 표시용 메타데이터 */
export type ScenarioInfo = {
  id: string;
  name: string;
  description: string;
};
