import { describe, expect, it } from "vitest";
import { fitDistance, headingToYaw, sceneToWorld, webglAvailable, worldToScene } from "./scene3dMath";

const size = { width: 800, height: 600 };

describe("scene3dMath", () => {
  it("centres the arena and round-trips coordinates", () => {
    expect(worldToScene(size, 400, 300)).toEqual({ x: 0, z: 0 });
    expect(worldToScene(size, 0, 0)).toEqual({ x: -400, z: -300 });
    const s = worldToScene(size, 123, 456);
    expect(sceneToWorld(size, s.x, s.z)).toEqual({ x: 123, y: 456 });
  });

  it("points local +x along the world heading", () => {
    for (const a of [0, Math.PI / 2, -Math.PI / 3, Math.PI]) {
      const yaw = headingToYaw(a);
      // Rotation about Y applied to (1, 0, 0)
      const dir = { x: Math.cos(yaw), z: -Math.sin(yaw) };
      expect(dir.x).toBeCloseTo(Math.cos(a));
      expect(dir.z).toBeCloseTo(Math.sin(a));
    }
  });

  it("fits the arena inside the view frustum", () => {
    const d = fitDistance(size, 45, 4 / 3, 1);
    const visibleHeight = 2 * d * Math.tan((45 * Math.PI) / 360);
    expect(visibleHeight).toBeCloseTo(600);
    expect(visibleHeight * (4 / 3)).toBeGreaterThanOrEqual(800 - 1e-6);
  });

  it("reports no WebGL in jsdom", () => {
    expect(webglAvailable()).toBe(false);
  });
});
