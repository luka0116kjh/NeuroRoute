import type { NeuroConfig, SensorReadings } from "./types";

/** 0~1 범위로 자르기. NaN은 0으로 처리한다. */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return value === Infinity ? 1 : 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function clampRange(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * 부분 설정을 기본값과 병합하고, 비정상 값(NaN, 음수 등)을 안전한 범위로 보정한다.
 */
export function resolveConfig(
  defaults: NeuroConfig,
  partial: Partial<NeuroConfig> = {}
): NeuroConfig {
  const merged = { ...defaults, ...partial };
  return {
    sensorRange:
      typeof merged.sensorRange === "number" &&
      Number.isFinite(merged.sensorRange) &&
      merged.sensorRange > 0
        ? merged.sensorRange
        : defaults.sensorRange,
    dangerThreshold: clampRange(merged.dangerThreshold, 0, 0.99, defaults.dangerThreshold),
    forwardBias: clampRange(merged.forwardBias, 0, 1, defaults.forwardBias),
    turnGain: clampRange(merged.turnGain, 0, 10, defaults.turnGain),
    smoothing: clampRange(merged.smoothing, 0, 0.95, defaults.smoothing),
    tieMargin: clampRange(merged.tieMargin, 0, 1, defaults.tieMargin),
    tieBreakBias: clampRange(merged.tieBreakBias, 0, 1, defaults.tieBreakBias)
  };
}

export type SanitizedSensors = {
  /** 0 ~ sensorRange 로 보정된 거리 */
  distances: SensorReadings;
  /** 정규화된 위험도: 1 - distance / sensorRange */
  danger: SensorReadings;
  warnings: string[];
  /** 해석 불가능한(NaN 등) 센서 개수 */
  invalidCount: number;
};

const SIDES = ["left", "center", "right"] as const;

/**
 * 거리 센서값을 위험도(0~1)로 정규화한다.
 *
 * - 가까울수록 위험도가 높다: danger = 1 - d / sensorRange
 * - 범위 초과 / +Infinity → sensorRange 로 자름 (위험도 0, "아무것도 감지되지 않음")
 * - 음수 거리 → 0 으로 자름 (위험도 1, 접촉)
 * - NaN / 숫자가 아님 → fail-safe: 위험도 1 ("보이지 않으면 막혀 있다고 가정")
 */
export function normalizeSensors(
  sensors: SensorReadings | null | undefined,
  sensorRange: number
): SanitizedSensors {
  const warnings: string[] = [];
  const distances: SensorReadings = { left: 0, center: 0, right: 0 };
  const danger: SensorReadings = { left: 1, center: 1, right: 1 };
  let invalidCount = 0;

  for (const side of SIDES) {
    const raw: unknown = sensors ? sensors[side] : undefined;

    if (typeof raw !== "number" || Number.isNaN(raw)) {
      invalidCount += 1;
      warnings.push(`${side} 센서값이 유효하지 않아(${String(raw)}) 최대 위험으로 간주했습니다.`);
      distances[side] = 0;
      danger[side] = 1;
      continue;
    }

    let d = raw;
    if (d < 0) {
      warnings.push(`${side} 센서값이 음수(${raw})라 0으로 보정했습니다.`);
      d = 0;
    } else if (d > sensorRange) {
      // +Infinity 는 레이캐스트 "충돌 없음"으로 흔히 쓰이므로 경고하지 않는다.
      if (Number.isFinite(d)) {
        warnings.push(`${side} 센서값(${raw})이 감지 범위를 넘어 ${sensorRange}로 보정했습니다.`);
      }
      d = sensorRange;
    }

    distances[side] = d;
    danger[side] = clamp01(1 - d / sensorRange);
  }

  return { distances, danger, warnings, invalidCount };
}
