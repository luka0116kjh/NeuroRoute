import { EPSILON } from "./constants";
import type { Obstacle, Vec2 } from "./types";

const TWO_PI = Math.PI * 2;

/** 유한한 숫자면 그대로, 아니면 fallback */
export function finiteOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** 유한한 양수면 그대로, 아니면 fallback */
export function positiveOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) return (min + max) / 2;
  return value < min ? min : value > max ? max : value;
}

export function vec(x: number, y: number): Vec2 {
  return { x, y };
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function direction(angle: number): Vec2 {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function isFiniteVec(v: unknown): v is Vec2 {
  return (
    typeof v === "object" &&
    v !== null &&
    Number.isFinite((v as Vec2).x) &&
    Number.isFinite((v as Vec2).y)
  );
}

/** 각도를 (-π, π] 범위로 정규화. 비정상 값이면 0. */
export function normalizeAngle(angle: number): number {
  if (!Number.isFinite(angle)) return 0;
  let a = angle % TWO_PI;
  if (a <= -Math.PI) a += TWO_PI;
  else if (a > Math.PI) a -= TWO_PI;
  return a;
}

/** 크기가 유효한(유한하고 양수인) 장애물인지 */
export function isValidObstacle(o: Obstacle): boolean {
  return (
    isFiniteVec(o.position) &&
    Number.isFinite(o.width) &&
    Number.isFinite(o.height) &&
    o.width > 0 &&
    o.height > 0
  );
}

/**
 * 점에서 사각형까지의 부호 있는 거리.
 * 바깥이면 가장 가까운 변/모서리까지의 거리(양수), 안쪽이면 가장 가까운 변까지의 거리에 음수 부호.
 */
export function signedDistanceToRect(p: Vec2, o: Obstacle): number {
  const cx = o.position.x + o.width / 2;
  const cy = o.position.y + o.height / 2;
  const dx = Math.abs(p.x - cx) - o.width / 2;
  const dy = Math.abs(p.y - cy) - o.height / 2;
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  const inside = Math.min(Math.max(dx, dy), 0);
  return outside + inside;
}

/**
 * 원과 사각형의 침투 깊이. 양수면 겹침(충돌), 0 이하면 겹치지 않음.
 * 정확히 맞닿은 경우(거리 == 반지름)는 충돌이 아니다.
 */
export function circleRectPenetration(
  center: Vec2,
  radius: number,
  o: Obstacle
): number {
  return radius - signedDistanceToRect(center, o);
}

export function circleIntersectsRect(
  center: Vec2,
  radius: number,
  o: Obstacle
): boolean {
  return circleRectPenetration(center, radius, o) > EPSILON;
}

/**
 * 레이(origin + t·dir, t ≥ 0)와 축정렬 사각형의 첫 교차 t (slab 방식).
 * 교차하지 않으면 null. origin 이 사각형 안에 있으면 0.
 * dir 은 단위 벡터여야 t 가 픽셀 거리와 같다.
 */
export function rayRectIntersection(
  origin: Vec2,
  dir: Vec2,
  o: Obstacle
): number | null {
  let tMin = 0;
  let tMax = Infinity;
  const mins = [o.position.x, o.position.y];
  const maxs = [o.position.x + o.width, o.position.y + o.height];
  const os = [origin.x, origin.y];
  const ds = [dir.x, dir.y];

  for (let axis = 0; axis < 2; axis++) {
    const d = ds[axis];
    const p = os[axis];
    if (Math.abs(d) < EPSILON) {
      // 이 축과 평행: 슬랩 밖이면 교차 불가
      if (p < mins[axis] || p > maxs[axis]) return null;
      continue;
    }
    let t1 = (mins[axis] - p) / d;
    let t2 = (maxs[axis] - p) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > tMin) tMin = t1;
    if (t2 < tMax) tMax = t2;
    if (tMin > tMax) return null;
  }
  return Number.isFinite(tMin) ? tMin : null;
}

/**
 * 월드 내부의 점에서 쏜 레이가 경계(0..width, 0..height)에 닿는 t.
 * origin 이 월드 밖이면 0.
 */
export function rayBoundsExit(
  origin: Vec2,
  dir: Vec2,
  width: number,
  height: number
): number {
  if (origin.x < 0 || origin.y < 0 || origin.x > width || origin.y > height) {
    return 0;
  }
  let t = Infinity;
  if (dir.x > EPSILON) t = Math.min(t, (width - origin.x) / dir.x);
  else if (dir.x < -EPSILON) t = Math.min(t, -origin.x / dir.x);
  if (dir.y > EPSILON) t = Math.min(t, (height - origin.y) / dir.y);
  else if (dir.y < -EPSILON) t = Math.min(t, -origin.y / dir.y);
  return Math.max(0, t);
}
