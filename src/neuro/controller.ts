import { runCircuit, type TurnSide } from "./circuit";
import { normalizeSensors, resolveConfig } from "./normalize";
import { DEFAULT_NEURO_CONFIG } from "./presets";
import { createRng, hashNumbers } from "./rng";
import type {
  NeuralDecision,
  NeuroConfig,
  NeuroController,
  SensorReadings
} from "./types";

/**
 * 동점 방향 결정 순서:
 *  1) stateful controller 에서 직전 회전 방향 (방향 유지 → 좌우 진동 방지)
 *  2) seed 가 주어지면 seed 기반 PRNG
 *  3) 없으면 센서값 해시 — 입력이 달라지면 방향도 달라지므로 한쪽으로 고정되지 않는다
 */
function makeTieResolver(
  distances: SensorReadings,
  seed: number | undefined,
  previousTurn: TurnSide | null
): () => TurnSide {
  return () => {
    if (previousTurn) return previousTurn;
    const r =
      seed !== undefined
        ? createRng(seed)()
        : hashNumbers([distances.left, distances.center, distances.right]) / 4294967296;
    return r < 0.5 ? "left" : "right";
  };
}

function evaluate(
  sensors: SensorReadings,
  config: NeuroConfig,
  seed: number | undefined,
  previousDanger: SensorReadings | null,
  previousTurn: TurnSide | null
): { decision: NeuralDecision; danger: SensorReadings } {
  const input = normalizeSensors(sensors, config.sensorRange);

  // 시각 뉴런의 누설 적분(leaky integration): 이전 프레임 활성도를 smoothing 비율만큼 유지
  const s = previousDanger ? config.smoothing : 0;
  const danger: SensorReadings = previousDanger
    ? {
        left: s * previousDanger.left + (1 - s) * input.danger.left,
        center: s * previousDanger.center + (1 - s) * input.danger.center,
        right: s * previousDanger.right + (1 - s) * input.danger.right
      }
    : input.danger;

  const result = runCircuit({
    danger,
    config,
    resolveTie: makeTieResolver(input.distances, seed, previousTurn)
  });

  const warnings = [...input.warnings];
  let explanation = result.explanation;
  if (input.invalidCount > 0) {
    explanation += ` (주의: 유효하지 않은 센서 ${input.invalidCount}개를 최대 위험으로 간주)`;
  }

  return {
    danger,
    decision: {
      command: result.command,
      confidence: result.confidence,
      activations: result.activations,
      explanation,
      danger: { ...danger },
      warnings,
      controller: "neuro"
    }
  };
}

/**
 * 단일 프레임 결정. 이전 상태를 쓰지 않으므로 같은 입력·seed → 항상 같은 결과.
 */
export function decideMovement(
  sensors: SensorReadings,
  config?: Partial<NeuroConfig>,
  seed?: number
): NeuralDecision {
  return evaluate(sensors, resolveConfig(DEFAULT_NEURO_CONFIG, config), seed, null, null).decision;
}

/**
 * 프레임 간 상태를 가지는 컨트롤러.
 * - smoothing: 시각 뉴런 활성도를 이전 프레임과 섞는다.
 * - 회전 방향 유지: 동점 상황에서 직전 회전 방향을 우선한다 (전진하면 기억 해제).
 */
export function createNeuroController(config?: Partial<NeuroConfig>): NeuroController {
  const resolved = resolveConfig(DEFAULT_NEURO_CONFIG, config);
  let previousDanger: SensorReadings | null = null;
  let previousTurn: TurnSide | null = null;

  return {
    decide(sensors, seed) {
      const { decision, danger } = evaluate(sensors, resolved, seed, previousDanger, previousTurn);
      previousDanger = danger;
      previousTurn =
        decision.command === "TURN_LEFT"
          ? "left"
          : decision.command === "TURN_RIGHT"
            ? "right"
            : decision.command === "FORWARD"
              ? null
              : previousTurn;
      return decision;
    },
    reset() {
      previousDanger = null;
      previousTurn = null;
    },
    getConfig() {
      return { ...resolved };
    }
  };
}
