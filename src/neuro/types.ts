/**
 * NeuroRoute neural-controller types.
 *
 * A simplified bio-inspired visual-to-motor circuit, not a biologically
 * complete fruit-fly brain simulation.
 */
import type { MovementCommand, SensorReadings } from "../simulation/types";

export type { MovementCommand, SensorReadings };

export type NeuronLayer = "sensory" | "interneuron" | "motor";

export type NeuronActivation = {
  id: string;
  label: string;
  layer: NeuronLayer;
  /** 0~1 범위로 제한된 활성도 */
  activation: number;
};

export type NeuralDecision = {
  command: MovementCommand;
  /** 0~1. 승자 운동 뉴런이 차점자보다 얼마나 우세한지 */
  confidence: number;
  activations: NeuronActivation[];
  explanation: string;
  /** 정규화된 좌·중·우 위험도 (0 = 안전, 1 = 접촉/알 수 없음). UI 시각화용 */
  danger?: SensorReadings;
  /** 센서값 보정 등 입력 문제에 대한 경고 */
  warnings?: string[];
  /** 결정을 만든 컨트롤러 이름 ("neuro" | "rule-based" | "random") */
  controller?: ControllerKind;
};

export type NeuroConfig = {
  /** 센서 최대 감지 거리 (시뮬레이션과 같은 거리 단위) */
  sensorRange: number;
  /**
   * 정규화된 위험도(0~1) 기준 문턱값.
   * 이 값보다 낮은 위험은 회전 중간 뉴런을 흥분시키지 못한다.
   */
  dangerThreshold: number;
  /** 전진 뉴런의 기본(tonic) 흥분 정도, 0~1 */
  forwardBias: number;
  /** 회피 중간 뉴런 → 회전 운동 뉴런 시냅스 이득 */
  turnGain: number;
  /** 이전 프레임 시각 입력을 반영하는 비율 (0 = 반영 안 함, 0.95 상한) */
  smoothing: number;
  /** 좌·우 회전 운동 뉴런 차이가 이 값보다 작으면 동점으로 보고 타이브레이커 사용 */
  tieMargin: number;
  /** 타이브레이커가 선택한 쪽 회전 뉴런에 더해지는 작은 편향 */
  tieBreakBias: number;
};

export type ControllerKind = "neuro" | "rule-based" | "random";

/** 모든 컨트롤러가 공유하는 단일 프레임 함수 시그니처 */
export type DecisionFunction = (
  sensors: SensorReadings,
  config?: Partial<NeuroConfig>,
  seed?: number
) => NeuralDecision;

export type NeuroController = {
  decide(sensors: SensorReadings, seed?: number): NeuralDecision;
  reset(): void;
  getConfig(): NeuroConfig;
};

/** UI 범례/회로도 표시용 뉴런 정의 */
export type NeuronDefinition = {
  id: string;
  label: string;
  layer: NeuronLayer;
  description: string;
};

/** UI 회로도 표시용 시냅스 정의 (weight < 0 은 억제성) */
export type SynapseDefinition = {
  from: string;
  to: string;
  weight: number;
  description: string;
};
