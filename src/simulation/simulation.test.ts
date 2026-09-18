import { describe, expect, it } from "vitest";
import {
  SCENARIOS,
  castSensorRays,
  castSensors,
  circleIntersectsRect,
  createDefaultWorld,
  createScenario,
  createWorld,
  rayRectIntersection,
  resetWorld,
  stepWorld,
  type MovementCommand,
  type WorldState,
} from "./index";
import {
  DEFAULT_SENSOR_RANGE,
  MAX_DELTA_SECONDS,
  MAX_TRAIL_POINTS,
  ROBOT_TURN_RATE,
} from "./constants";

const DT = 1 / 60;

function run(world: WorldState, command: MovementCommand, steps: number, dt = DT) {
  let w = world;
  for (let i = 0; i < steps; i++) w = stepWorld(w, command, dt);
  return w;
}

function emptyWorld(overrides: Partial<Parameters<typeof createWorld>[0]> = {}) {
  return createWorld({
    width: 400,
    height: 400,
    start: { x: 200, y: 200 },
    startAngle: 0,
    goal: { x: 380, y: 380 },
    goalRadius: 5,
    obstacles: [],
    ...overrides,
  });
}

function expectFiniteWorld(w: WorldState) {
  expect(Number.isFinite(w.robot.position.x)).toBe(true);
  expect(Number.isFinite(w.robot.position.y)).toBe(true);
  expect(Number.isFinite(w.robot.angle)).toBe(true);
  expect(Number.isFinite(w.elapsedTime)).toBe(true);
}

describe("world creation", () => {
  it("creates a valid default world", () => {
    const w = createDefaultWorld();
    expect(w.width).toBeGreaterThan(0);
    expect(w.height).toBeGreaterThan(0);
    expect(w.robot.trail).toHaveLength(1);
    expect(w.robot.collisions).toBe(0);
    expect(w.robot.reachedGoal).toBe(false);
    expect(w.elapsedTime).toBe(0);
    expect(w.running).toBe(false);
  });

  it("provides at least 3 scenarios, falls back on unknown ids", () => {
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(3);
    for (const s of SCENARIOS) {
      expect(createScenario(s.id).scenarioId).toBe(s.id);
    }
    expect(createScenario("nope").scenarioId).toBe(createDefaultWorld().scenarioId);
    expect(createScenario(undefined as unknown as string)).toBeTruthy();
  });

  it.each(SCENARIOS.map((s) => s.id))(
    "scenario %s: start/goal free and goal reachable",
    (id) => {
      const w = createScenario(id);
      const r = w.robot.radius;
      for (const o of w.obstacles) {
        expect(circleIntersectsRect(w.robot.position, r, o)).toBe(false);
        expect(circleIntersectsRect(w.goal, r, o)).toBe(false);
      }
      // 로봇 반경만큼 여유를 둔 격자 BFS 로 경로 존재 확인
      const cell = 5;
      const cols = Math.floor(w.width / cell);
      const rows = Math.floor(w.height / cell);
      const free = (cx: number, cy: number) => {
        const p = { x: cx * cell + cell / 2, y: cy * cell + cell / 2 };
        if (p.x < r || p.y < r || p.x > w.width - r || p.y > w.height - r) return false;
        return !w.obstacles.some((o) => circleIntersectsRect(p, r, o));
      };
      const toCell = (v: number) => Math.floor(v / cell);
      const start = [toCell(w.robot.position.x), toCell(w.robot.position.y)];
      const goal = [toCell(w.goal.x), toCell(w.goal.y)];
      const seen = new Set<number>([start[1] * cols + start[0]]);
      const queue = [start];
      let found = false;
      while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        if (x === goal[0] && y === goal[1]) {
          found = true;
          break;
        }
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          const key = ny * cols + nx;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(key)) continue;
          if (!free(nx, ny)) continue;
          seen.add(key);
          queue.push([nx, ny]);
        }
      }
      expect(found).toBe(true);
    }
  );

  it("scenarios are deterministic", () => {
    for (const s of SCENARIOS) {
      expect(createScenario(s.id)).toEqual(createScenario(s.id));
    }
  });
});

describe("movement", () => {
  it("moves forward along heading", () => {
    const w0 = emptyWorld();
    const w1 = run(w0, "FORWARD", 30);
    const expected = w0.robot.speed * DT * 30;
    expect(w1.robot.position.x - 200).toBeCloseTo(expected, 6);
    expect(w1.robot.position.y).toBeCloseTo(200, 9);
    expect(w1.elapsedTime).toBeCloseTo(DT * 30, 9);
  });

  it("turns left (angle decreases) and right (angle increases)", () => {
    const w0 = emptyWorld();
    const left = stepWorld(w0, "TURN_LEFT", 0.05);
    const right = stepWorld(w0, "TURN_RIGHT", 0.05);
    expect(left.robot.angle).toBeCloseTo(-ROBOT_TURN_RATE * 0.05, 9);
    expect(right.robot.angle).toBeCloseTo(ROBOT_TURN_RATE * 0.05, 9);
  });

  it("STOP does not move", () => {
    const w0 = emptyWorld();
    const w1 = run(w0, "STOP", 10);
    expect(w1.robot.position).toEqual(w0.robot.position);
    expect(w1.robot.angle).toBe(w0.robot.angle);
  });

  it("keeps angle normalized in (-π, π]", () => {
    const w = run(emptyWorld(), "TURN_RIGHT", 500);
    expect(w.robot.angle).toBeGreaterThan(-Math.PI);
    expect(w.robot.angle).toBeLessThanOrEqual(Math.PI);
  });

  it("does not mutate the input world", () => {
    const w0 = emptyWorld();
    const snapshot = JSON.parse(JSON.stringify(w0));
    stepWorld(w0, "FORWARD", 0.1);
    stepWorld(w0, "TURN_LEFT", 0.1);
    expect(w0).toEqual(snapshot);
  });

  it("is deterministic for identical inputs", () => {
    const commands: MovementCommand[] = ["FORWARD", "TURN_LEFT", "FORWARD", "TURN_RIGHT", "STOP"];
    const simulate = () => {
      let w = createScenario("forest");
      for (let i = 0; i < 600; i++) w = stepWorld(w, commands[i % 5], DT);
      return w;
    };
    expect(simulate()).toEqual(simulate());
  });
});

describe("boundaries and collisions", () => {
  it("never leaves the world and counts a wall collision once", () => {
    const w = run(emptyWorld(), "FORWARD", 300);
    const r = w.robot.radius;
    expect(w.robot.position.x).toBeLessThanOrEqual(w.width - r + 1e-9);
    expect(w.robot.position.x).toBeCloseTo(w.width - r, 6);
    expect(w.robot.collisions).toBe(1);
  });

  it("stops at an obstacle surface without penetrating", () => {
    const w0 = emptyWorld({
      obstacles: [{ id: "b", position: { x: 260, y: 150 }, width: 40, height: 100 }],
    });
    const w = run(w0, "FORWARD", 200);
    const r = w.robot.radius;
    expect(w.robot.position.x).toBeLessThanOrEqual(260 - r + 1e-6);
    expect(w.robot.position.x).toBeGreaterThan(260 - r - 0.5);
    expect(w.obstacles.some((o) => circleIntersectsRect(w.robot.position, r, o))).toBe(false);
    expect(w.robot.collisions).toBe(1);
  });

  it("counts a new collision after leaving contact and hitting again", () => {
    const w0 = emptyWorld({
      obstacles: [{ id: "b", position: { x: 260, y: 150 }, width: 40, height: 100 }],
    });
    let w = run(w0, "FORWARD", 120);
    expect(w.robot.collisions).toBe(1);
    w = run(w, "TURN_LEFT", 60); // 180° 회전 (접촉 해제)
    w = run(w, "TURN_RIGHT", 60); // 다시 장애물 방향
    w = run(w, "FORWARD", 120);
    expect(w.robot.collisions).toBe(2);
  });

  it("does not tunnel through a thin wall with a large dt", () => {
    const w0 = emptyWorld({
      robot: { speed: 2000 },
      obstacles: [{ id: "thin", position: { x: 240, y: 0 }, width: 2, height: 400 }],
    });
    const w = run(w0, "FORWARD", 10, 1);
    expect(w.robot.position.x).toBeLessThan(240);
  });

  it("slides along a wall when hitting at an angle", () => {
    const w0 = emptyWorld({
      start: { x: 100, y: 200 },
      startAngle: Math.PI / 4,
      goal: { x: 20, y: 20 },
    });
    const mid = run(w0, "FORWARD", 200);
    // 대각선으로 가다가 아래 벽(y = 388)에 먼저 닿음 (x ≈ 288)
    expect(mid.robot.position.y).toBeCloseTo(w0.height - w0.robot.radius, 6);
    expect(mid.robot.position.x).toBeLessThan(w0.width - w0.robot.radius - 1);
    const w = run(mid, "FORWARD", 150);
    // 아래 벽에 닿은 뒤 오른쪽으로 미끄러져 모서리에 도달
    expect(w.robot.position.y).toBeCloseTo(w.height - w.robot.radius, 6);
    expect(w.robot.position.x).toBeCloseTo(w.width - w.robot.radius, 6);
  });

  it("can escape if spawned overlapping an obstacle", () => {
    const w0 = emptyWorld({
      obstacles: [{ id: "b", position: { x: 190, y: 150 }, width: 20, height: 100 }],
      startAngle: Math.PI,
    });
    const w = run(w0, "FORWARD", 60);
    expect(w.robot.position.x).toBeLessThan(190 - w.robot.radius + 1e-6);
  });
});

describe("goal and trail", () => {
  it("detects goal arrival and freezes the robot", () => {
    const w0 = emptyWorld({ goal: { x: 260, y: 200 }, goalRadius: 10 });
    let w = run(w0, "FORWARD", 60);
    expect(w.robot.reachedGoal).toBe(true);
    expect(w.running).toBe(false);
    const frozen = w.robot.position;
    w = run(w, "FORWARD", 30);
    expect(w.robot.position).toEqual(frozen);
  });

  it("records trail and caps its length", () => {
    const w = run(emptyWorld({ width: 5000, height: 5000, start: { x: 50, y: 2500 }, goal: { x: 4990, y: 10 } }), "TURN_RIGHT", 3000);
    expect(w.robot.trail.length).toBeGreaterThan(1);
    expect(w.robot.trail.length).toBeLessThanOrEqual(MAX_TRAIL_POINTS);
    const w2 = run(emptyWorld(), "FORWARD", 20);
    expect(w2.robot.trail.length).toBeGreaterThan(1);
    expect(w2.robot.trail[w2.robot.trail.length - 1]).toEqual(w2.robot.position);
  });

  it("resetWorld restores spawn but keeps the map", () => {
    const w0 = createScenario("corridor");
    const moved = { ...run(w0, "FORWARD", 200), running: true };
    const r = resetWorld(moved);
    expect(r.robot.position).toEqual(w0.robot.position);
    expect(r.robot.angle).toBe(w0.robot.angle);
    expect(r.robot.collisions).toBe(0);
    expect(r.robot.trail).toHaveLength(1);
    expect(r.elapsedTime).toBe(0);
    expect(r.running).toBe(false);
    expect(r.obstacles).toEqual(w0.obstacles);
  });
});

describe("sensors", () => {
  it("returns sensorRange when nothing is in range", () => {
    const w = emptyWorld({ width: 2000, height: 2000, start: { x: 1000, y: 1000 } });
    expect(castSensors(w)).toEqual({
      left: DEFAULT_SENSOR_RANGE,
      center: DEFAULT_SENSOR_RANGE,
      right: DEFAULT_SENSOR_RANGE,
    });
  });

  it("measures distance to an obstacle ahead", () => {
    const w = emptyWorld({
      obstacles: [{ id: "b", position: { x: 280, y: 100 }, width: 20, height: 200 }],
    });
    const s = castSensors(w);
    expect(s.center).toBeCloseTo(80, 9);
    expect(s.left).toBeCloseTo(80 * Math.SQRT2, 6);
    expect(s.right).toBeCloseTo(80 * Math.SQRT2, 6);
    expect(castSensorRays(w).center.hitId).toBe("b");
  });

  it("uses angle ∓ π/4 for left/right sensors", () => {
    // 오른쪽 아래(angle + π/4 방향)에만 장애물
    const w = emptyWorld({
      obstacles: [{ id: "br", position: { x: 250, y: 250 }, width: 30, height: 30 }],
    });
    const s = castSensors(w);
    expect(s.right).toBeCloseTo(50 * Math.SQRT2, 6);
    expect(s.left).toBe(DEFAULT_SENSOR_RANGE);
    expect(s.center).toBe(DEFAULT_SENSOR_RANGE);
  });

  it("detects walls and stays within [0, sensorRange]", () => {
    const w = emptyWorld({ start: { x: 350, y: 200 } });
    const s = castSensors(w);
    expect(s.center).toBeCloseTo(50, 9);
    expect(castSensors(w, { detectWalls: false }).center).toBe(DEFAULT_SENSOR_RANGE);
    for (const v of Object.values(s)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(w.robot.sensorRange);
    }
  });

  it("returns 0 when the robot center is inside an obstacle", () => {
    const w = emptyWorld({
      obstacles: [{ id: "in", position: { x: 190, y: 190 }, width: 20, height: 20 }],
    });
    expect(castSensors(w)).toEqual({ left: 0, center: 0, right: 0 });
  });

  it("rayRectIntersection handles axis-parallel rays", () => {
    const rect = { id: "r", position: { x: 10, y: 0 }, width: 5, height: 5 };
    expect(rayRectIntersection({ x: 0, y: 2 }, { x: 1, y: 0 }, rect)).toBeCloseTo(10);
    expect(rayRectIntersection({ x: 0, y: 9 }, { x: 1, y: 0 }, rect)).toBeNull();
    expect(rayRectIntersection({ x: 0, y: 2 }, { x: -1, y: 0 }, rect)).toBeNull();
  });
});

describe("robustness", () => {
  it("handles invalid deltaSeconds and commands", () => {
    const w0 = emptyWorld();
    for (const dt of [NaN, -1, Infinity, -Infinity, 0]) {
      const w = stepWorld(w0, "FORWARD", dt);
      expectFiniteWorld(w);
      expect(w.robot.position.x).toBeLessThanOrEqual(200 + w0.robot.speed * MAX_DELTA_SECONDS + 1e-9);
    }
    const bogus = stepWorld(w0, "JUMP" as MovementCommand, 0.1);
    expect(bogus.robot.position).toEqual(w0.robot.position);
  });

  it("recovers from NaN / broken state", () => {
    const w0 = emptyWorld();
    const broken = {
      ...w0,
      width: NaN,
      goalRadius: -3,
      robot: {
        ...w0.robot,
        position: { x: NaN, y: Infinity },
        angle: NaN,
        radius: -5,
        speed: NaN,
        sensorRange: Infinity,
        trail: [{ x: NaN, y: 0 }],
        collisions: NaN,
      },
      obstacles: [
        { id: "bad", position: { x: NaN, y: 0 }, width: 10, height: 10 },
        { id: "neg", position: { x: 0, y: 0 }, width: -10, height: 10 },
      ],
    } as WorldState;
    const w = run(broken, "FORWARD", 30);
    expectFiniteWorld(w);
    const s = castSensors(w);
    for (const v of Object.values(s)) expect(Number.isFinite(v)).toBe(true);
    expect(Number.isFinite(resetWorld(broken).robot.position.x)).toBe(true);
  });

  it("handles zero speed and zero sensor range", () => {
    const w0 = emptyWorld({ robot: { speed: 0, sensorRange: 0 } });
    const w = run(w0, "FORWARD", 10);
    expect(w.robot.position).toEqual(w0.robot.position);
    expect(castSensors(w)).toEqual({ left: 0, center: 0, right: 0 });
  });
});
