import { createRng } from "../neuro";
import type { NeuralDecision } from "../neuro/types";
import type { MovementCommand, SensorReadings } from "../simulation/types";

/**
 * Consecutive STOP ticks (at 30 Hz, 0.5 s) before the recovery policy takes over.
 * Without it a controller that answers STOP in a dead end would stay frozen forever,
 * because STOP never changes the sensor readings.
 */
export const STOP_RECOVERY_TICKS = 15;
/** Sensor difference (px) below which left/right count as equally open. */
const SIDE_TIE_PX = 0.5;

type RecoveryTurn = Extract<MovementCommand, "TURN_LEFT" | "TURN_RIGHT">;

export type StopRecoveryState = {
  /** Consecutive STOP decisions from the controller */
  stopStreak: number;
  /** Turn direction locked for the current recovery episode, or null when not recovering */
  turn: RecoveryTurn | null;
  /** Recovery episodes started since the last reset */
  episodes: number;
};

export const INITIAL_STOP_RECOVERY: StopRecoveryState = { stopStreak: 0, turn: null, episodes: 0 };

/** Wider (more open) side; exact ties are broken by the tick seed so runs stay reproducible. */
function pickTurn(sensors: SensorReadings, seed: number): RecoveryTurn {
  if (sensors.left - sensors.right > SIDE_TIE_PX) return "TURN_LEFT";
  if (sensors.right - sensors.left > SIDE_TIE_PX) return "TURN_RIGHT";
  return createRng(seed)() < 0.5 ? "TURN_LEFT" : "TURN_RIGHT";
}

/**
 * STOP recovery policy, applied between the controller's decision and stepWorld.
 * After STOP_RECOVERY_TICKS consecutive STOPs it replaces STOP with a turn toward the
 * wider side, keeping that direction until the controller itself stops answering STOP.
 */
export function applyStopRecovery(
  state: StopRecoveryState,
  decision: NeuralDecision,
  sensors: SensorReadings,
  seed: number,
): { decision: NeuralDecision; state: StopRecoveryState } {
  if (decision.command !== "STOP") {
    return { decision, state: { stopStreak: 0, turn: null, episodes: state.episodes } };
  }
  const stopStreak = state.stopStreak + 1;
  if (stopStreak < STOP_RECOVERY_TICKS) {
    return { decision, state: { ...state, stopStreak, turn: null } };
  }
  const turn = state.turn ?? pickTurn(sensors, seed);
  const side = turn === "TURN_LEFT" ? "왼쪽" : "오른쪽";
  return {
    decision: {
      ...decision,
      command: turn,
      explanation: `STOP 복구: ${stopStreak}틱 연속 정지 → 더 넓은 ${side}으로 회전. (컨트롤러 판단: ${decision.explanation})`,
    },
    state: { stopStreak, turn, episodes: state.episodes + (state.turn === null ? 1 : 0) },
  };
}
