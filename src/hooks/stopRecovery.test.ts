import { describe, expect, it } from "vitest";
import { castSensors, createScenario, stepWorld } from "../simulation";
import type { Obstacle, SensorReadings, WorldState } from "../simulation/types";
import { createNeuroController, ruleBasedController } from "../neuro";
import type { NeuralDecision } from "../neuro/types";
import { applyStopRecovery, INITIAL_STOP_RECOVERY, STOP_RECOVERY_TICKS, type StopRecoveryState } from "./stopRecovery";
import { TICK_SECONDS } from "./useSimulation";

const stop: NeuralDecision = { command: "STOP", confidence: 1, activations: [], explanation: "blocked" };
const forward: NeuralDecision = { ...stop, command: "FORWARD", explanation: "clear" };

/** Feed `n` STOP decisions with fixed sensors; returns the last result. */
function feedStops(n: number, sensors: SensorReadings, seed = 0) {
  let state: StopRecoveryState = INITIAL_STOP_RECOVERY;
  let decision = stop;
  for (let i = 0; i < n; i++) ({ decision, state } = applyStopRecovery(state, stop, sensors, seed + i));
  return { decision, state };
}

describe("applyStopRecovery", () => {
  it("passes non-STOP decisions through and clears the streak", () => {
    const { state } = feedStops(5, { left: 30, center: 20, right: 30 });
    const r = applyStopRecovery(state, forward, { left: 30, center: 200, right: 30 }, 9);
    expect(r.decision).toBe(forward);
    expect(r.state.stopStreak).toBe(0);
    expect(r.state.turn).toBeNull();
  });

  it("counts consecutive STOPs and keeps STOP until the threshold", () => {
    const { decision, state } = feedStops(STOP_RECOVERY_TICKS - 1, { left: 30, center: 20, right: 60 });
    expect(state.stopStreak).toBe(STOP_RECOVERY_TICKS - 1);
    expect(decision.command).toBe("STOP");
    expect(state.episodes).toBe(0);
  });

  it("turns toward the wider side once the threshold is reached", () => {
    expect(feedStops(STOP_RECOVERY_TICKS, { left: 70, center: 20, right: 30 }).decision.command).toBe("TURN_LEFT");
    const right = feedStops(STOP_RECOVERY_TICKS, { left: 30, center: 20, right: 70 });
    expect(right.decision.command).toBe("TURN_RIGHT");
    expect(right.decision.explanation).toMatch(/^STOP 복구/);
    expect(right.state.episodes).toBe(1);
  });

  it("breaks exact ties deterministically from the seed", () => {
    const sensors = { left: 40, center: 20, right: 40 };
    const a = feedStops(STOP_RECOVERY_TICKS, sensors, 7).decision.command;
    const b = feedStops(STOP_RECOVERY_TICKS, sensors, 7).decision.command;
    expect(a).toBe(b);
    expect(["TURN_LEFT", "TURN_RIGHT"]).toContain(a);
  });

  it("keeps one direction for the whole episode and counts it once", () => {
    let { state } = feedStops(STOP_RECOVERY_TICKS, { left: 70, center: 20, right: 30 });
    // Sides flip while rotating; the locked direction must not flip with them.
    const r = applyStopRecovery(state, stop, { left: 30, center: 20, right: 70 }, 99);
    expect(r.decision.command).toBe("TURN_LEFT");
    expect(r.state.episodes).toBe(1);
    state = applyStopRecovery(r.state, forward, { left: 30, center: 200, right: 70 }, 100).state;
    expect(state).toEqual({ stopStreak: 0, turn: null, episodes: 1 });
  });
});

const box = (id: string, x: number, y: number, width: number, height: number): Obstacle => ({
  id, position: { x, y }, width, height,
});

/** Robot placed in a pocket open only behind it: front, left and right all inside the danger distance. */
function deadEnd(): WorldState {
  const w = createScenario("open-field");
  const position = { x: 120, y: 300 };
  return {
    ...w,
    obstacles: [box("top", 60, 255, 110, 10), box("bottom", 60, 335, 110, 10), box("front", 160, 255, 10, 90)],
    robot: { ...w.robot, position, angle: 0, trail: [{ ...position }] },
    spawn: { position: { ...position }, angle: 0 },
  };
}

function drive(world: WorldState, decide: (s: SensorReadings, seed: number) => NeuralDecision, ticks: number, recover: boolean) {
  let state = INITIAL_STOP_RECOVERY;
  let streak = 0;
  let maxStreak = 0;
  for (let i = 0; i < ticks; i++) {
    const sensors = castSensors(world);
    let decision = decide(sensors, i);
    if (recover) ({ decision, state } = applyStopRecovery(state, decision, sensors, i));
    streak = decision.command === "STOP" ? streak + 1 : 0;
    maxStreak = Math.max(maxStreak, streak);
    world = stepWorld(world, decision.command, TICK_SECONDS);
  }
  return { world, maxStreak, episodes: state.episodes };
}

describe("STOP recovery in dead ends", () => {
  const start = deadEnd().robot.position;
  const escaped = (w: WorldState) => Math.hypot(w.robot.position.x - start.x, w.robot.position.y - start.y) > 60;

  it("rule-based controller stays frozen without recovery (reproduces the deadlock)", () => {
    const { world, maxStreak } = drive(deadEnd(), (s, seed) => ruleBasedController(s, undefined, seed), 300, false);
    expect(maxStreak).toBe(300);
    expect(escaped(world)).toBe(false);
  });

  it.each([
    ["rule-based", () => (s: SensorReadings, seed: number) => ruleBasedController(s, undefined, seed)],
    ["bio-inspired", () => {
      const c = createNeuroController();
      return (s: SensorReadings, seed: number) => c.decide(s, seed);
    }],
  ] as const)("%s controller escapes with recovery, without repeated collisions", (_name, make) => {
    const { world, maxStreak, episodes } = drive(deadEnd(), make(), 600, true);
    expect(escaped(world)).toBe(true);
    expect(maxStreak).toBeLessThan(STOP_RECOVERY_TICKS);
    expect(episodes).toBeGreaterThan(0);
    expect(world.robot.collisions).toBeLessThanOrEqual(2);
  });

  it("rule-based controller no longer freezes in the Forest map", () => {
    const { maxStreak } = drive(createScenario("forest"), (s, seed) => ruleBasedController(s, undefined, seed), 2700, true);
    expect(maxStreak).toBeLessThan(STOP_RECOVERY_TICKS);
  });
});
