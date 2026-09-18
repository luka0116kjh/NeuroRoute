import { describe, expect, it } from "vitest";
import {
  DEFAULT_NEURO_CONFIG,
  createNeuroController,
  createRandomController,
  decideMovement,
  randomController,
  ruleBasedController,
  type NeuralDecision,
  type SensorReadings
} from "./index";

const R = DEFAULT_NEURO_CONFIG.sensorRange;
const act = (d: NeuralDecision, id: string) => d.activations.find((a) => a.id === id)!.activation;

function expectBounded(d: NeuralDecision) {
  expect(d.confidence).toBeGreaterThanOrEqual(0);
  expect(d.confidence).toBeLessThanOrEqual(1);
  for (const a of d.activations) {
    expect(Number.isFinite(a.activation)).toBe(true);
    expect(a.activation).toBeGreaterThanOrEqual(0);
    expect(a.activation).toBeLessThanOrEqual(1);
  }
  expect(d.explanation.length).toBeGreaterThan(0);
}

describe("neural circuit — 기본 시나리오", () => {
  it("1. 전방이 모두 안전하면 전진 뉴런이 우세하다", () => {
    const d = decideMovement({ left: R, center: R, right: R });
    expect(d.command).toBe("FORWARD");
    expect(act(d, "M_FWD")).toBeGreaterThan(act(d, "M_TL"));
    expect(act(d, "M_FWD")).toBeGreaterThan(act(d, "M_TR"));
    expectBounded(d);
  });

  it("양옆 벽이 있는 복도에서도 정면이 열려 있으면 전진한다", () => {
    expect(decideMovement({ left: R * 0.5, center: R, right: R * 0.5 }).command).toBe("FORWARD");
  });

  it("2. 중앙 장애물이 가까우면 좌·우 회피 뉴런이 모두 자극되고 회전한다", () => {
    const d = decideMovement({ left: R, center: R * 0.2, right: R });
    expect(["TURN_LEFT", "TURN_RIGHT"]).toContain(d.command);
    expect(act(d, "IN_TL")).toBeGreaterThan(0.5);
    expect(act(d, "IN_TR")).toBeCloseTo(act(d, "IN_TL"), 6);
    expect(act(d, "M_FWD")).toBe(0);
    expectBounded(d);
  });

  it("3. 왼쪽 장애물이 가까우면 오른쪽 회전 뉴런이 강해진다", () => {
    const d = decideMovement({ left: R * 0.15, center: R, right: R });
    expect(d.command).toBe("TURN_RIGHT");
    expect(act(d, "M_TR")).toBeGreaterThan(act(d, "M_TL"));
    expect(act(d, "IN_TR")).toBeGreaterThan(act(d, "IN_TL"));
    expectBounded(d);
  });

  it("4. 오른쪽 장애물이 가까우면 왼쪽 회전 뉴런이 강해진다", () => {
    const d = decideMovement({ left: R, center: R, right: R * 0.15 });
    expect(d.command).toBe("TURN_LEFT");
    expect(act(d, "M_TL")).toBeGreaterThan(act(d, "M_TR"));
    expectBounded(d);
  });

  it("정면+왼쪽이 막히면 오른쪽으로, 정면+오른쪽이 막히면 왼쪽으로 돈다", () => {
    expect(decideMovement({ left: R * 0.3, center: R * 0.2, right: R }).command).toBe("TURN_RIGHT");
    expect(decideMovement({ left: R, center: R * 0.2, right: R * 0.3 }).command).toBe("TURN_LEFT");
  });

  it("5. 모든 방향이 막히면 정지한다", () => {
    const d = decideMovement({ left: R * 0.1, center: R * 0.1, right: R * 0.1 });
    expect(d.command).toBe("STOP");
    expect(act(d, "M_STOP")).toBeGreaterThan(act(d, "M_TL"));
    expect(d.confidence).toBeGreaterThan(0.5);
    expectBounded(d);
  });

  it("가까울수록 시각 입력 뉴런 활성도가 단조 증가한다", () => {
    const distances = [R, R * 0.8, R * 0.5, R * 0.2, 0];
    const values = distances.map((c) => act(decideMovement({ left: R, center: c, right: R }), "V_C"));
    for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
    expect(values[0]).toBe(0);
    expect(values[values.length - 1]).toBe(1);
  });
});

describe("입력 방어", () => {
  it("6. NaN/음수/범위 초과/누락 값에도 0~1 범위를 지키고 경고를 남긴다", () => {
    const cases: SensorReadings[] = [
      { left: Number.NaN, center: R, right: R },
      { left: -50, center: R, right: R },
      { left: R, center: R * 100, right: R },
      { left: Infinity, center: -Infinity, right: Number.NaN },
      { left: Number.NaN, center: Number.NaN, right: Number.NaN },
      {} as SensorReadings,
      null as unknown as SensorReadings
    ];
    for (const c of cases) {
      const d = decideMovement(c);
      expectBounded(d);
      expect(["FORWARD", "TURN_LEFT", "TURN_RIGHT", "STOP"]).toContain(d.command);
    }
    expect(decideMovement(cases[0]).warnings!.length).toBeGreaterThan(0);
    expect(decideMovement(cases[1]).warnings!.length).toBeGreaterThan(0);
  });

  it("알 수 없는 센서는 최대 위험으로 간주한다 (fail-safe)", () => {
    // 왼쪽 센서 고장 → 왼쪽이 막힌 것으로 보고 오른쪽으로 회피
    expect(decideMovement({ left: Number.NaN, center: R, right: R }).command).toBe("TURN_RIGHT");
    // 전부 고장 → 정지
    expect(decideMovement({ left: Number.NaN, center: Number.NaN, right: Number.NaN }).command).toBe("STOP");
  });

  it("범위 초과 값은 sensorRange 로 잘려 안전으로 처리된다", () => {
    expect(decideMovement({ left: 1e9, center: Infinity, right: R * 3 }).command).toBe("FORWARD");
  });

  it("잘못된 config 값도 안전한 범위로 보정된다", () => {
    const c = createNeuroController({
      sensorRange: -1,
      dangerThreshold: Number.NaN,
      smoothing: 5,
      turnGain: -3
    }).getConfig();
    expect(c.sensorRange).toBe(DEFAULT_NEURO_CONFIG.sensorRange);
    expect(c.dangerThreshold).toBe(DEFAULT_NEURO_CONFIG.dangerThreshold);
    expect(c.smoothing).toBeLessThanOrEqual(0.95);
    expect(c.turnGain).toBe(0);
  });
});

describe("결정성과 타이브레이커", () => {
  const tie: SensorReadings = { left: R, center: R * 0.2, right: R };

  it("7. 같은 seed → 같은 결과", () => {
    for (const seed of [0, 1, 42, 12345]) {
      expect(decideMovement(tie, undefined, seed)).toEqual(decideMovement(tie, undefined, seed));
      expect(randomController(tie, undefined, seed)).toEqual(randomController(tie, undefined, seed));
      expect(ruleBasedController(tie, undefined, seed)).toEqual(ruleBasedController(tie, undefined, seed));
    }
    const a = createRandomController(7);
    const b = createRandomController(7);
    const seqA = Array.from({ length: 50 }, () => a.decide(tie).command);
    const seqB = Array.from({ length: 50 }, () => b.decide(tie).command);
    expect(seqA).toEqual(seqB);
    a.reset();
    expect(Array.from({ length: 50 }, () => a.decide(tie).command)).toEqual(seqA);
  });

  it("좌우 위험이 같을 때 seed 에 따라 양쪽 방향이 모두 선택된다", () => {
    const commands = new Set(
      Array.from({ length: 40 }, (_, seed) => decideMovement(tie, undefined, seed).command)
    );
    expect(commands).toEqual(new Set(["TURN_LEFT", "TURN_RIGHT"]));
  });

  it("seed 가 없어도 센서값에 따라 양쪽 방향이 모두 선택된다 (결정적)", () => {
    const commands = new Set(
      Array.from({ length: 40 }, (_, i) => decideMovement({ left: R, center: 20 + i, right: R }).command)
    );
    expect(commands).toEqual(new Set(["TURN_LEFT", "TURN_RIGHT"]));
  });

  it("무작위 컨트롤러는 여러 명령을 고르고 센서를 무시한다", () => {
    const rc = createRandomController(3);
    const commands = new Set(Array.from({ length: 100 }, () => rc.decide(tie).command));
    expect(commands.size).toBeGreaterThanOrEqual(3);
  });
});

describe("stateful controller", () => {
  it("smoothing 이 이전 프레임 활성도를 반영하고 reset 으로 초기화된다", () => {
    const ctrl = createNeuroController({ smoothing: 0.5 });
    ctrl.decide({ left: R, center: 0, right: R }); // V_C = 1
    const second = ctrl.decide({ left: R, center: R, right: R }); // 입력 V_C = 0
    expect(act(second, "V_C")).toBeCloseTo(0.5, 6);

    ctrl.reset();
    const fresh = ctrl.decide({ left: R, center: R, right: R });
    expect(act(fresh, "V_C")).toBe(0);
  });

  it("smoothing = 0 이면 decideMovement 와 같다", () => {
    const ctrl = createNeuroController({ smoothing: 0 });
    const inputs: SensorReadings[] = [
      { left: R, center: R, right: R },
      { left: 30, center: 100, right: R },
      { left: R, center: 40, right: 25 }
    ];
    for (const s of inputs) {
      expect(ctrl.decide(s, 9).command).toBe(decideMovement(s, { smoothing: 0 }, 9).command);
    }
  });

  it("동점 상황에서 직전 회전 방향을 유지해 좌우로 흔들리지 않는다", () => {
    const ctrl = createNeuroController({ smoothing: 0 });
    const first = ctrl.decide({ left: R, center: 30, right: R }, 1).command;
    for (let seed = 2; seed < 20; seed++) {
      expect(ctrl.decide({ left: R, center: 30, right: R }, seed).command).toBe(first);
    }
  });
});

describe("rule-based controller", () => {
  it("기본 시나리오에서 예상 명령을 낸다", () => {
    expect(ruleBasedController({ left: R, center: R, right: R }).command).toBe("FORWARD");
    expect(ruleBasedController({ left: 20, center: R, right: R }).command).toBe("TURN_RIGHT");
    expect(ruleBasedController({ left: R, center: R, right: 20 }).command).toBe("TURN_LEFT");
    expect(ruleBasedController({ left: 20, center: 20, right: 20 }).command).toBe("STOP");
    expectBounded(ruleBasedController({ left: Number.NaN, center: -1, right: 1e9 }));
  });
});
