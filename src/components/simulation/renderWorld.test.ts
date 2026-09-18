import { describe, expect, it } from "vitest";
import { castSensorRays, createScenario } from "../../simulation";
import { findObstacleAt, renderWorld } from "./renderWorld";

describe("renderWorld", () => {
  it("draws every scenario without throwing", () => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    for (const id of ["open-field", "corridor", "maze", "forest"]) {
      const world = createScenario(id);
      expect(() =>
        renderWorld(
          ctx,
          world,
          castSensorRays(world),
          { collisionFlash: 0.5, goalCelebration: 0.3 },
          { dangerThreshold: 60, hoveredObstacleId: world.obstacles[0]?.id ?? null, deleteMode: true },
        ),
      ).not.toThrow();
    }
    const calls = (ctx as unknown as { __calls: string[] }).__calls;
    expect(calls).toContain("fillRect");
    expect(calls).toContain("arc");
  });
});

describe("findObstacleAt", () => {
  it("returns the obstacle under a point and null elsewhere", () => {
    const world = {
      ...createScenario("open-field"),
      obstacles: [{ id: "a", position: { x: 100, y: 100 }, width: 50, height: 40 }],
    };
    expect(findObstacleAt(world, 120, 120)?.id).toBe("a");
    expect(findObstacleAt(world, 150, 140)?.id).toBe("a");
    expect(findObstacleAt(world, 99, 120)).toBeNull();
    expect(findObstacleAt(world, 120, 141)).toBeNull();
  });
});
