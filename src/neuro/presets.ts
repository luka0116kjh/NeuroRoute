import type { NeuroConfig } from "./types";

/**
 * 기본 설정.
 * sensorRange 는 시뮬레이션 센서의 최대 거리와 같게 맞춰야 한다
 * (시뮬레이션 쪽 값이 다르면 createNeuroController({ sensorRange }) 로 덮어쓸 것).
 */
export const DEFAULT_NEURO_CONFIG: NeuroConfig = Object.freeze({
  sensorRange: 150, // 시뮬레이션 DEFAULT_SENSOR_RANGE(150px)와 동일
  dangerThreshold: 0.35, // 감지 범위의 65% 보다 가까워져야 회피가 시작됨
  forwardBias: 0.6,
  turnGain: 1.2,
  smoothing: 0.3,
  tieMargin: 0.03,
  tieBreakBias: 0.05
});

export type NeuroPresetId = "balanced" | "cautious" | "agile" | "smooth";

export type NeuroPreset = {
  id: NeuroPresetId;
  label: string;
  description: string;
  config: Partial<NeuroConfig>;
};

/** UI 슬라이더/드롭다운에서 고를 수 있는 설정 묶음. sensorRange 는 건드리지 않는다. */
export const NEURO_PRESETS: readonly NeuroPreset[] = [
  {
    id: "balanced",
    label: "균형",
    description: "기본값. 적당한 거리에서 회피를 시작한다.",
    config: {}
  },
  {
    id: "cautious",
    label: "신중",
    description: "멀리서부터 회피하고 전진 충동이 약하다.",
    config: { dangerThreshold: 0.2, forwardBias: 0.45, turnGain: 1.4 }
  },
  {
    id: "agile",
    label: "민첩",
    description: "가까이 가서야 회피하지만 강하게 꺾는다.",
    config: { dangerThreshold: 0.5, forwardBias: 0.75, turnGain: 1.8, smoothing: 0.1 }
  },
  {
    id: "smooth",
    label: "부드러움",
    description: "이전 프레임 시각 입력을 많이 반영해 흔들림이 적다.",
    config: { smoothing: 0.7 }
  }
];

export function getPreset(id: NeuroPresetId): NeuroPreset {
  return NEURO_PRESETS.find((p) => p.id === id) ?? NEURO_PRESETS[0];
}
