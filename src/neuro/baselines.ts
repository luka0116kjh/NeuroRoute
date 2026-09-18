/**
 * 실험 비교용 기준(baseline) 컨트롤러.
 * 반환 형식은 신경 회로와 같은 NeuralDecision 이므로 UI에서 그대로 교체할 수 있다.
 * activations 에는 시각 입력 뉴런(위험도)만 담는다 — 이 컨트롤러들에는 중간/운동 뉴런이 없다.
 */
import { createNeuroController, decideMovement } from "./controller";
import { clamp01, normalizeSensors, resolveConfig } from "./normalize";
import { DEFAULT_NEURO_CONFIG } from "./presets";
import { createRng, hashNumbers } from "./rng";
import type {
  ControllerKind,
  DecisionFunction,
  MovementCommand,
  NeuralDecision,
  NeuronActivation,
  NeuroConfig,
  NeuroController,
  SensorReadings
} from "./types";

function sensoryActivations(danger: SensorReadings): NeuronActivation[] {
  return [
    { id: "V_L", label: "왼쪽 시각", layer: "sensory", activation: clamp01(danger.left) },
    { id: "V_C", label: "중앙 시각", layer: "sensory", activation: clamp01(danger.center) },
    { id: "V_R", label: "오른쪽 시각", layer: "sensory", activation: clamp01(danger.right) }
  ];
}

function randomUnit(seed: number | undefined, distances: SensorReadings): number {
  return seed !== undefined
    ? createRng(seed)()
    : hashNumbers([distances.left, distances.center, distances.right]) / 4294967296;
}

/**
 * 규칙 기반 컨트롤러 (if-else).
 * "막힘" = 위험도 ≥ dangerThreshold.
 *  - 정면이 막힘: 좌우 모두 막히면 STOP, 아니면 덜 위험한 쪽으로 회전 (동점은 seed/해시)
 *  - 왼쪽만 막힘 → 우회전, 오른쪽만 막힘 → 좌회전
 *  - 그 외 → 전진
 */
export const ruleBasedController: DecisionFunction = (sensors, config, seed) => {
  const cfg = resolveConfig(DEFAULT_NEURO_CONFIG, config);
  const input = normalizeSensors(sensors, cfg.sensorRange);
  const { left, center, right } = input.danger;
  const theta = cfg.dangerThreshold;
  const blocked = { left: left >= theta, center: center >= theta, right: right >= theta };

  let command: MovementCommand;
  let confidence = 1;
  let explanation: string;

  if (blocked.center) {
    if (blocked.left && blocked.right) {
      command = "STOP";
      explanation = "규칙: 정면·좌·우 모두 문턱 이상 위험 → 정지.";
    } else if (Math.abs(left - right) < cfg.tieMargin) {
      command = randomUnit(seed, input.distances) < 0.5 ? "TURN_LEFT" : "TURN_RIGHT";
      confidence = 0.5;
      explanation = "규칙: 정면이 막혔고 좌우 위험이 같아 타이브레이커로 방향 선택.";
    } else {
      command = left < right ? "TURN_LEFT" : "TURN_RIGHT";
      explanation = "규칙: 정면이 막혀 덜 위험한 쪽으로 회전.";
    }
  } else if (blocked.left && !blocked.right) {
    command = "TURN_RIGHT";
    explanation = "규칙: 왼쪽이 막혀 우회전.";
  } else if (blocked.right && !blocked.left) {
    command = "TURN_LEFT";
    explanation = "규칙: 오른쪽이 막혀 좌회전.";
  } else {
    command = "FORWARD";
    explanation = "규칙: 정면이 열려 있어 전진.";
  }

  return {
    command,
    confidence,
    activations: sensoryActivations(input.danger),
    explanation,
    danger: { ...input.danger },
    warnings: input.warnings,
    controller: "rule-based"
  };
};

/** 무작위 컨트롤러의 명령 분포. 센서를 무시한다. */
export const RANDOM_COMMAND_WEIGHTS: ReadonlyArray<readonly [MovementCommand, number]> = [
  ["FORWARD", 0.5],
  ["TURN_LEFT", 0.25],
  ["TURN_RIGHT", 0.25]
];

function pickRandom(r: number): [MovementCommand, number] {
  let acc = 0;
  for (const [command, p] of RANDOM_COMMAND_WEIGHTS) {
    acc += p;
    if (r < acc) return [command, p];
  }
  return RANDOM_COMMAND_WEIGHTS[RANDOM_COMMAND_WEIGHTS.length - 1] as [MovementCommand, number];
}

function randomDecision(r: number, sensors: SensorReadings, config?: Partial<NeuroConfig>): NeuralDecision {
  const cfg = resolveConfig(DEFAULT_NEURO_CONFIG, config);
  const input = normalizeSensors(sensors, cfg.sensorRange);
  const [command, p] = pickRandom(r);
  return {
    command,
    confidence: p,
    activations: sensoryActivations(input.danger),
    explanation: `무작위: 센서를 무시하고 확률 ${p}로 ${command} 선택 (비교용 기준선).`,
    danger: { ...input.danger },
    warnings: input.warnings,
    controller: "random"
  };
}

/**
 * 단일 프레임 무작위 컨트롤러. 같은 seed → 같은 결과.
 * seed 가 없으면 센서값 해시를 쓰므로 여전히 결정적이다.
 * 프레임마다 다른 값을 원하면 seed 에 스텝 번호를 넘기거나 createRandomController 를 쓸 것.
 */
export const randomController: DecisionFunction = (sensors, config, seed) => {
  const cfg = resolveConfig(DEFAULT_NEURO_CONFIG, config);
  const input = normalizeSensors(sensors, cfg.sensorRange);
  return randomDecision(randomUnit(seed, input.distances), sensors, config);
};

/**
 * 내부 PRNG 수열을 유지하는 무작위 컨트롤러.
 * 같은 초기 seed 로 만들면 decide 호출 순서대로 같은 명령 수열이 나온다.
 * decide 에 seed 를 넘기면 그 프레임만 해당 seed 로 결정한다.
 */
export function createRandomController(seed = 1, config?: Partial<NeuroConfig>): NeuroController {
  const resolved = resolveConfig(DEFAULT_NEURO_CONFIG, config);
  let rng = createRng(seed);
  return {
    decide(sensors, frameSeed) {
      const r = frameSeed !== undefined ? createRng(frameSeed)() : rng();
      return randomDecision(r, sensors, resolved);
    },
    reset() {
      rng = createRng(seed);
    },
    getConfig() {
      return { ...resolved };
    }
  };
}

/** 규칙 기반 컨트롤러를 NeuroController 인터페이스로 감싼 것 (상태 없음). */
export function createRuleBasedController(config?: Partial<NeuroConfig>): NeuroController {
  const resolved = resolveConfig(DEFAULT_NEURO_CONFIG, config);
  return {
    decide: (sensors, seed) => ruleBasedController(sensors, resolved, seed),
    reset() {},
    getConfig: () => ({ ...resolved })
  };
}

export type ControllerOption = {
  kind: ControllerKind;
  label: string;
  description: string;
  /** 단일 프레임 함수 */
  decide: DecisionFunction;
  /** 상태 있는 인스턴스 생성 */
  create: (config?: Partial<NeuroConfig>, seed?: number) => NeuroController;
};

/** 실험 비교 UI용 컨트롤러 목록 */
export const CONTROLLER_OPTIONS: readonly ControllerOption[] = [
  {
    kind: "neuro",
    label: "생체모방 신경 회로",
    description: "시각 → 교차 회피 중간 뉴런 → 운동 뉴런 (smoothing 포함)",
    decide: decideMovement,
    create: (config) => createNeuroController(config)
  },
  {
    kind: "rule-based",
    label: "규칙 기반",
    description: "문턱값 if-else 규칙",
    decide: ruleBasedController,
    create: (config) => createRuleBasedController(config)
  },
  {
    kind: "random",
    label: "무작위",
    description: "센서를 무시하는 seed 기반 무작위 선택",
    decide: randomController,
    create: (config, seed) => createRandomController(seed, config)
  }
];

export function createController(
  kind: ControllerKind,
  config?: Partial<NeuroConfig>,
  seed?: number
): NeuroController {
  const option = CONTROLLER_OPTIONS.find((o) => o.kind === kind) ?? CONTROLLER_OPTIONS[0];
  return option.create(config, seed);
}
