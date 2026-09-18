/** 기본 월드 크기 (px) */
export const DEFAULT_WORLD_WIDTH = 800;
export const DEFAULT_WORLD_HEIGHT = 600;

/** 로봇 기본값 */
export const DEFAULT_ROBOT_RADIUS = 12;
/** 전진 속도 (px/s) */
export const DEFAULT_ROBOT_SPEED = 90;
/** 센서 최대 사거리 (px) */
export const DEFAULT_SENSOR_RANGE = 150;
/** 회전 속도 (rad/s) */
export const ROBOT_TURN_RATE = Math.PI;
/** 회전 명령 중 전진 속도 비율 (0 = 제자리 회전) */
export const TURN_FORWARD_SPEED_RATIO = 0.25;

/** 센서 방향 오프셋: left = angle - offset, right = angle + offset */
export const SENSOR_ANGLE_OFFSET = Math.PI / 4;
/** 센서가 월드 경계(벽)도 감지할지 여부 */
export const SENSORS_DETECT_WALLS = true;

/** 목표 기본 반경 (px). 로봇 중심이 이 반경 안에 들어오면 도착. */
export const DEFAULT_GOAL_RADIUS = 22;

/** 한 번의 stepWorld 에서 허용하는 최대 시간 (s). 탭 전환 등으로 인한 큰 dt 방지. */
export const MAX_DELTA_SECONDS = 0.1;
/** 서브스텝 당 최대 이동 거리 = radius * 이 비율 (터널링 방지) */
export const SUBSTEP_DISTANCE_RATIO = 0.5;
/** 서브스텝 최대 개수 (무한 루프 방지) */
export const MAX_SUBSTEPS = 32;

/** 경로 기록: 마지막 점에서 이 거리 이상 움직였을 때만 점을 추가 */
export const TRAIL_MIN_DISTANCE = 2;
/** 경로 기록 최대 점 개수 (초과 시 오래된 점부터 제거) */
export const MAX_TRAIL_POINTS = 600;

/** 부동소수점 비교 허용 오차 */
export const EPSILON = 1e-9;

/** 벽에 닿은 레이의 hitId */
export const WALL_HIT_ID = "wall";

export const DEFAULT_SCENARIO_ID = "open-field";
