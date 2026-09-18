/**
 * End-to-end check of the pipeline the UI runs every tick:
 * castSensors → controller → NeuralDecision → stepWorld.
 */
import { describe, expect, it } from "vitest";
import { castSensors, createScenario, stepWorld } from "../simulation";
import { createNeuroController, randomController, ruleBasedController } from "../neuro";
import type { NeuralDecision } from "../neuro/types";
import type { SensorReadings } from "../simulation/types";
import { TICK_SECONDS } from "./useSimulation";

function run(scenario: string, decide: (s: SensorReadings, seed: number) => NeuralDecision, seconds: number) {
  let world = createScenario(scenario);
  const start = { ...world.robot.position };
  const commands = new Set<string>();
  for (let i = 0; i < seconds / TICK_SECONDS && !world.robot.reachedGoal; i++) {
    const decision = decide(castSensors(world), i);
    commands.add(decision.command);
    world = stepWorld(world, decision.command, TICK_SECONDS);
  }
  return { world, start, commands };
}

describe("sense → decide → act pipeline", () => {
  it("bio-inspired controller moves the robot and avoids getting stuck in the open field", () => {
    const neuro = createNeuroController();
    const { world, start, commands } = run("open-field", (s, seed) => neuro.decide(s, seed), 60);
    const moved = Math.hypot(world.robot.position.x - start.x, world.robot.position.y - start.y);
    expect(moved).toBeGreaterThan(50);
    expect(commands.has("FORWARD")).toBe(true);
    expect(Number.isFinite(world.elapsedTime)).toBe(true);
  });

  it.each([
    ["rule-based", ruleBasedController],
    ["random", randomController],
  ] as const)("%s controller produces valid decisions that drive stepWorld", (_name, fn) => {
    const { world, commands } = run("corridor", (s, seed) => fn(s, undefined, seed), 5);
    expect(world.elapsedTime).toBeGreaterThan(0);
    for (const c of commands) expect(["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"]).toContain(c);
  });
});
