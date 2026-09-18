/**
 * NeuroRoute 시각-운동 회로.
 *
 * A simplified bio-inspired visual-to-motor circuit, not a biologically
 * complete fruit-fly brain simulation.
 *
 * 초파리에서 "한쪽 시야의 다가오는 물체가 반대 방향 회피 운동을 유발한다"는
 * 교차(contralateral) 구조만 차용해, 사람이 읽을 수 있는 11개 뉴런으로 단순화했다.
 *
 *   거리 센서 → 위험도 정규화 → 시각 입력 뉴런(3)
 *            → 회피/전진/정지 중간 뉴런(4) → 운동 출력 뉴런(4) → 행동 선택(argmax)
 *
 * 모든 뉴런은 "가중합 → 0~1 정류(clamp)"로 계산되는 발화율(rate) 모델이다.
 * 스파이크, 시냅스 가소성, 실제 커넥톰 가중치는 사용하지 않는다.
 */
import { clamp01 } from "./normalize";
import type {
  MovementCommand,
  NeuroConfig,
  NeuronActivation,
  NeuronDefinition,
  SensorReadings,
  SynapseDefinition
} from "./types";

export type TurnSide = "left" | "right";

/**
 * 시냅스 가중치. 양수 = 흥분성, 음수 = 억제성.
 * 설정(NeuroConfig)으로 바꾸는 값(forwardBias, turnGain, dangerThreshold)은 여기 없다.
 */
export const WEIGHTS = {
  /** 반대쪽 시각 뉴런 → 회피 중간 뉴런. 왼쪽 위험이 오른쪽 회전을 만든다 (핵심 교차 경로). */
  contralateral: 1.0,
  /** 중앙 시각 뉴런 → 좌·우 회피 중간 뉴런 모두. 정면 장애물은 양쪽 회피를 똑같이 자극한다. */
  center: 0.8,
  /** 같은 쪽 시각 뉴런 → 회피 중간 뉴런 (억제). 위험한 쪽으로 도는 것을 막는다. */
  ipsilateralInhibition: 0.4,
  /** 중앙 시각 뉴런 → 전진 중간 뉴런 (억제). 정면이 막히면 전진 충동이 사라진다. */
  centerToForward: 1.0,
  /** 가장 위험한 측면 시각 뉴런 → 전진 중간 뉴런 (억제). 측면이 가까우면 전진을 약간 줄인다. */
  sideToForward: 0.3
} as const;

export const NEURON_DEFINITIONS: readonly NeuronDefinition[] = [
  { id: "V_L", label: "왼쪽 시각", layer: "sensory", description: "왼쪽 센서 위험도. 가까울수록 1에 가깝다." },
  { id: "V_C", label: "중앙 시각", layer: "sensory", description: "정면 센서 위험도." },
  { id: "V_R", label: "오른쪽 시각", layer: "sensory", description: "오른쪽 센서 위험도." },
  { id: "IN_TL", label: "좌회전 회피 중간", layer: "interneuron", description: "오른쪽·중앙 위험에 흥분, 왼쪽 위험에 억제." },
  { id: "IN_TR", label: "우회전 회피 중간", layer: "interneuron", description: "왼쪽·중앙 위험에 흥분, 오른쪽 위험에 억제." },
  { id: "IN_FWD", label: "전진(경로 개방) 중간", layer: "interneuron", description: "기본 전진 편향에서 정면·측면 위험을 뺀 값." },
  { id: "IN_STOP", label: "전방위 차단 중간", layer: "interneuron", description: "세 방향이 모두 문턱 이상 위험할 때만 활성 (AND 게이트)." },
  { id: "M_FWD", label: "전진 운동", layer: "motor", description: "FORWARD 명령 뉴런." },
  { id: "M_TL", label: "좌회전 운동", layer: "motor", description: "TURN_LEFT 명령 뉴런." },
  { id: "M_TR", label: "우회전 운동", layer: "motor", description: "TURN_RIGHT 명령 뉴런." },
  { id: "M_STOP", label: "정지 운동", layer: "motor", description: "STOP 명령 뉴런." }
];

export const SYNAPSE_DEFINITIONS: readonly SynapseDefinition[] = [
  { from: "V_L", to: "IN_TR", weight: WEIGHTS.contralateral, description: "왼쪽 위험 → 우회전 (교차)" },
  { from: "V_R", to: "IN_TL", weight: WEIGHTS.contralateral, description: "오른쪽 위험 → 좌회전 (교차)" },
  { from: "V_C", to: "IN_TL", weight: WEIGHTS.center, description: "정면 위험 → 좌회전" },
  { from: "V_C", to: "IN_TR", weight: WEIGHTS.center, description: "정면 위험 → 우회전" },
  { from: "V_L", to: "IN_TL", weight: -WEIGHTS.ipsilateralInhibition, description: "왼쪽 위험 ⊣ 좌회전" },
  { from: "V_R", to: "IN_TR", weight: -WEIGHTS.ipsilateralInhibition, description: "오른쪽 위험 ⊣ 우회전" },
  { from: "V_C", to: "IN_FWD", weight: -WEIGHTS.centerToForward, description: "정면 위험 ⊣ 전진" },
  { from: "V_L", to: "IN_FWD", weight: -WEIGHTS.sideToForward, description: "측면 위험(최대) ⊣ 전진" },
  { from: "V_R", to: "IN_FWD", weight: -WEIGHTS.sideToForward, description: "측면 위험(최대) ⊣ 전진" },
  { from: "V_L", to: "IN_STOP", weight: 1, description: "모든 방향 위험(min) → 정지" },
  { from: "V_C", to: "IN_STOP", weight: 1, description: "모든 방향 위험(min) → 정지" },
  { from: "V_R", to: "IN_STOP", weight: 1, description: "모든 방향 위험(min) → 정지" },
  { from: "IN_TL", to: "M_TL", weight: 1, description: "turnGain 배 증폭, 문턱 이하 차단" },
  { from: "IN_TR", to: "M_TR", weight: 1, description: "turnGain 배 증폭, 문턱 이하 차단" },
  { from: "IN_FWD", to: "M_FWD", weight: 1, description: "전진 구동" },
  { from: "IN_STOP", to: "M_STOP", weight: 1, description: "정지 구동" },
  { from: "IN_STOP", to: "M_TL", weight: -1, description: "차단 시 회전 억제 (곱셈형 게이팅)" },
  { from: "IN_STOP", to: "M_TR", weight: -1, description: "차단 시 회전 억제 (곱셈형 게이팅)" },
  { from: "IN_STOP", to: "M_FWD", weight: -1, description: "차단 시 전진 억제 (곱셈형 게이팅)" }
];

const LABELS: Record<string, { label: string; layer: NeuronActivation["layer"] }> = Object.fromEntries(
  NEURON_DEFINITIONS.map((n) => [n.id, { label: n.label, layer: n.layer }])
);

export type CircuitInput = {
  /** 정규화된 위험도 (0~1). stateful controller에서는 smoothing 이 적용된 값 */
  danger: SensorReadings;
  config: NeuroConfig;
  /** 좌·우 회전이 거의 동점일 때만 호출되는 결정적 타이브레이커 */
  resolveTie: () => TurnSide;
};

export type CircuitResult = {
  command: MovementCommand;
  confidence: number;
  activations: NeuronActivation[];
  motor: Record<MovementCommand, number>;
  /** 타이브레이커가 사용되었다면 선택된 방향 */
  tieBreak: TurnSide | null;
  explanation: string;
};

/** 문턱(θ) 아래는 0, 위는 0~1 로 다시 펼친다. 약한 위험 신호로 회전하지 않게 하는 게이트. */
function thresholdGate(x: number, theta: number): number {
  return clamp01((x - theta) / (1 - theta));
}

const fmt = (x: number) => x.toFixed(2);

export function runCircuit({ danger, config, resolveTie }: CircuitInput): CircuitResult {
  const { dangerThreshold: theta, forwardBias, turnGain, tieMargin, tieBreakBias } = config;

  // ── 1. 시각 입력 뉴런: 위험도를 그대로 발화율로 사용 (가까울수록 높음)
  const vL = clamp01(danger.left);
  const vC = clamp01(danger.center);
  const vR = clamp01(danger.right);

  // ── 2. 중간 뉴런
  // 회피 중간 뉴런: 반대쪽(교차) 흥분 + 중앙 흥분 − 같은 쪽 억제
  const inTL = clamp01(WEIGHTS.contralateral * vR + WEIGHTS.center * vC - WEIGHTS.ipsilateralInhibition * vL);
  const inTR = clamp01(WEIGHTS.contralateral * vL + WEIGHTS.center * vC - WEIGHTS.ipsilateralInhibition * vR);
  // 전진 중간 뉴런: tonic 전진 편향 − 정면 위험 − 가장 가까운 측면 위험
  const inFWD = clamp01(forwardBias - WEIGHTS.centerToForward * vC - WEIGHTS.sideToForward * Math.max(vL, vR));
  // 전방위 차단 중간 뉴런: 가장 "안전한" 방향조차 문턱 이상 위험할 때만 발화 (min = AND)
  const inSTOP = thresholdGate(Math.min(vL, vC, vR), theta);

  // ── 3. 운동 출력 뉴런
  // 회전: 문턱 게이트 × turnGain, 전방위 차단 시 (1 − STOP) 로 곱셈 억제
  const release = 1 - inSTOP;
  let mTL = clamp01(turnGain * thresholdGate(inTL, theta) * release);
  let mTR = clamp01(turnGain * thresholdGate(inTR, theta) * release);
  const mFWD = clamp01(inFWD * release);
  const mSTOP = inSTOP;

  // ── 4. 결정적 타이브레이커: 좌·우 회전 뉴런이 거의 같으면 한쪽을 골라
  //       반대쪽을 tieBreakBias 만큼 억제한다 (상호 억제의 단순화).
  let tieBreak: TurnSide | null = null;
  if (Math.max(mTL, mTR) > 0 && Math.abs(mTL - mTR) < tieMargin) {
    tieBreak = resolveTie();
    if (tieBreak === "left") mTR = clamp01(Math.min(mTR, mTL) - tieBreakBias);
    else mTL = clamp01(Math.min(mTL, mTR) - tieBreakBias);
  }

  const motor: Record<MovementCommand, number> = {
    STOP: mSTOP,
    TURN_LEFT: mTL,
    TURN_RIGHT: mTR,
    FORWARD: mFWD
  };

  // ── 5. 행동 선택: 운동 뉴런 argmax (winner-take-all).
  //       정확한 동점이면 안전 우선순위 STOP > 회전 > FORWARD.
  const order: MovementCommand[] = ["STOP", "TURN_LEFT", "TURN_RIGHT", "FORWARD"];
  let command: MovementCommand = order[0];
  for (const c of order) if (motor[c] > motor[command]) command = c;

  const sorted = order.map((c) => motor[c]).sort((a, b) => b - a);
  const winner = sorted[0];
  const runnerUp = sorted[1];

  let confidence: number;
  if (winner <= 1e-6) {
    // 모든 운동 뉴런이 침묵 (예: forwardBias = 0 이고 위험도 없음)
    command = vC < theta ? "FORWARD" : "STOP";
    confidence = 0;
  } else {
    // 승자의 절대 활성도와 차점자와의 격차를 반씩 반영
    confidence = clamp01(0.5 * winner + 0.5 * (winner - runnerUp));
  }

  const values: Record<string, number> = {
    V_L: vL, V_C: vC, V_R: vR,
    IN_TL: inTL, IN_TR: inTR, IN_FWD: inFWD, IN_STOP: inSTOP,
    M_FWD: mFWD, M_TL: mTL, M_TR: mTR, M_STOP: mSTOP
  };
  const activations: NeuronActivation[] = NEURON_DEFINITIONS.map((n) => ({
    id: n.id,
    label: LABELS[n.id].label,
    layer: LABELS[n.id].layer,
    activation: clamp01(values[n.id])
  }));

  return {
    command,
    confidence,
    activations,
    motor,
    tieBreak,
    explanation: explain(command, { vL, vC, vR, inTL, inTR, inFWD, inSTOP }, motor, tieBreak)
  };
}

function explain(
  command: MovementCommand,
  a: { vL: number; vC: number; vR: number; inTL: number; inTR: number; inFWD: number; inSTOP: number },
  motor: Record<MovementCommand, number>,
  tieBreak: TurnSide | null
): string {
  const vision = `시각 위험도 L ${fmt(a.vL)} · C ${fmt(a.vC)} · R ${fmt(a.vR)}`;
  switch (command) {
    case "FORWARD":
      return `${vision}. 정면이 충분히 안전해 전진 뉴런(${fmt(motor.FORWARD)})이 회피 뉴런보다 우세 → 전진.`;
    case "STOP":
      return `${vision}. 세 방향 모두 위험해 전방위 차단 뉴런(${fmt(a.inSTOP)})이 회전·전진을 억제 → 정지.`;
    case "TURN_LEFT":
    case "TURN_RIGHT": {
      const left = command === "TURN_LEFT";
      const dir = left ? "좌회전" : "우회전";
      const drive = left ? a.inTL : a.inTR;
      const cause =
        tieBreak !== null
          ? `좌·우 회피 뉴런이 거의 같아 결정적 타이브레이커가 ${tieBreak === "left" ? "왼쪽" : "오른쪽"}을 선택`
          : a.vC >= Math.max(a.vL, a.vR) && Math.abs(a.vL - a.vR) < 0.05
            ? "정면 위험이 양쪽 회피 뉴런을 자극"
            : left
              ? "오른쪽 위험이 교차 경로로 좌회전 회피 뉴런을 흥분"
              : "왼쪽 위험이 교차 경로로 우회전 회피 뉴런을 흥분";
      return `${vision}. ${cause} (중간 ${fmt(drive)} → 운동 ${fmt(motor[command])}) → ${dir}.`;
    }
  }
}
