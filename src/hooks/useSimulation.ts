import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  castSensorRays,
  circleIntersectsRect,
  createScenario,
  listScenarios,
  resetWorld,
  SIM_CONSTANTS,
  stepWorld,
} from "../simulation";
import type { Obstacle, SensorRays, SensorReadings, WorldState } from "../simulation/types";
import {
  createNeuroController,
  decideMovement,
  DEFAULT_NEURO_CONFIG,
  randomController,
  ruleBasedController,
} from "../neuro";
import type { ControllerKind, NeuralDecision, NeuroConfig, NeuroController } from "../neuro/types";
import type { RunStatus } from "../components/Header";
import type { ExperimentSettings, RunRecord, RunStats } from "../components/ExperimentPanel";
import type { RenderEffects } from "../components/simulation/renderWorld";
import { applyStopRecovery, INITIAL_STOP_RECOVERY, type StopRecoveryState } from "./stopRecovery";

/** Control period: one sense → decide → step cycle. "한 단계" advances exactly one tick. */
export const TICK_SECONDS = 1 / 30;
/** Real-time frame gap cap, so a backgrounded tab doesn't fast-forward on return. */
const MAX_FRAME_SECONDS = 0.1;
/** How often (ms) the React panels are refreshed while running. */
const UI_REFRESH_MS = 100;
const COLLISION_FLASH_SECONDS = 0.6;
const MAX_HISTORY = 12;
export const OBSTACLE_SIZE = 50;

export type FrameData = {
  world: WorldState;
  rays: SensorRays;
  effects: RenderEffects;
};

export type Snapshot = {
  sensors: SensorReadings;
  decision: NeuralDecision | null;
  stats: RunStats;
};

export type EditResult = { ok: true; message: string } | { ok: false; message: string };

type Controller = {
  decide: (sensors: SensorReadings, seed: number) => NeuralDecision;
  preview: (sensors: SensorReadings, seed: number) => NeuralDecision;
  reset: () => void;
};

export function toNeuroConfig(settings: ExperimentSettings): Partial<NeuroConfig> {
  return { sensorRange: settings.sensorRange, dangerThreshold: settings.dangerThreshold };
}

function makeController(kind: ControllerKind, config: Partial<NeuroConfig>): Controller {
  if (kind === "neuro") {
    const neuro: NeuroController = createNeuroController(config);
    return {
      decide: (s, seed) => neuro.decide(s, seed),
      // Stateless evaluation so previews don't disturb the controller's leaky integration.
      preview: (s, seed) => decideMovement(s, config, seed),
      reset: () => neuro.reset(),
    };
  }
  const fn = kind === "rule-based" ? ruleBasedController : randomController;
  return {
    decide: (s, seed) => fn(s, config, seed),
    preview: (s, seed) => fn(s, config, seed),
    reset: () => {},
  };
}

function withSensorRange(world: WorldState, sensorRange: number): WorldState {
  return { ...world, robot: { ...world.robot, sensorRange } };
}

function readSensors(rays: SensorRays): SensorReadings {
  return { left: rays.left.distance, center: rays.center.distance, right: rays.right.distance };
}

/** Sensor distance (px) at which normalised danger (1 - d/range) crosses the threshold. */
export function dangerDistance(settings: ExperimentSettings) {
  return settings.sensorRange * (1 - settings.dangerThreshold);
}

export const DEFAULT_SETTINGS: ExperimentSettings = {
  algorithm: "neuro",
  scenarioId: SIM_CONSTANTS.DEFAULT_SCENARIO_ID,
  speed: 1,
  sensorRange: SIM_CONSTANTS.DEFAULT_SENSOR_RANGE,
  dangerThreshold: DEFAULT_NEURO_CONFIG.dangerThreshold,
};

/**
 * Owns the simulation loop. Physics and rendering run from refs inside a single
 * requestAnimationFrame loop; React state is refreshed at most every UI_REFRESH_MS
 * so the panels don't re-render 60 times per second.
 */
export function useSimulation(initial: ExperimentSettings = DEFAULT_SETTINGS) {
  const scenarios = useMemo(() => listScenarios(), []);
  const [settings, setSettings] = useState<ExperimentSettings>(initial);
  const [status, setStatus] = useState<RunStatus>("idle");
  const [history, setHistory] = useState<RunRecord[]>([]);

  const settingsRef = useRef(settings);
  const statusRef = useRef<RunStatus>("idle");
  const worldRef = useRef<WorldState>(withSensorRange(createScenario(initial.scenarioId), initial.sensorRange));
  const raysRef = useRef<SensorRays>(castSensorRays(worldRef.current));
  const controllerRef = useRef<Controller>(makeController(initial.algorithm, toNeuroConfig(initial)));
  const decisionRef = useRef<NeuralDecision | null>(null);
  const recoveryRef = useRef<StopRecoveryState>(INITIAL_STOP_RECOVERY);
  const distanceRef = useRef(0);
  const tickRef = useRef(0);
  const accumulatorRef = useRef(0);
  const flashStartRef = useRef<number | null>(null);
  const goalAtRef = useRef<number | null>(null);
  const recordedRef = useRef(false);
  const nextRecordId = useRef(1);
  const rendererRef = useRef<((frame: FrameData) => void) | null>(null);

  const makeSnapshot = useCallback((): Snapshot => {
    const w = worldRef.current;
    return {
      sensors: readSensors(raysRef.current),
      decision: decisionRef.current,
      stats: {
        collisions: w.robot.collisions,
        distance: distanceRef.current,
        elapsed: w.elapsedTime,
        reachedGoal: w.robot.reachedGoal,
      },
    };
  }, []);

  const [snapshot, setSnapshot] = useState<Snapshot>(() => makeSnapshot());
  const publish = useCallback(() => setSnapshot(makeSnapshot()), [makeSnapshot]);

  const updateStatus = useCallback((next: RunStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const recordRun = useCallback(() => {
    const w = worldRef.current;
    if (recordedRef.current || w.elapsedTime <= 0) return;
    recordedRef.current = true;
    const s = settingsRef.current;
    const record: RunRecord = {
      id: nextRecordId.current++,
      algorithm: s.algorithm,
      scenarioName: scenarios.find((sc) => sc.id === w.scenarioId)?.name ?? w.scenarioId ?? "Custom",
      collisions: w.robot.collisions,
      distance: distanceRef.current,
      elapsed: w.elapsedTime,
      reachedGoal: w.robot.reachedGoal,
    };
    setHistory((h) => [record, ...h].slice(0, MAX_HISTORY));
  }, [scenarios]);

  /** Re-cast sensors and show what the controller *would* do, without moving. */
  const refreshPreview = useCallback(() => {
    raysRef.current = castSensorRays(worldRef.current);
    decisionRef.current = controllerRef.current.preview(readSensors(raysRef.current), tickRef.current);
    publish();
  }, [publish]);

  /** One control tick: sense → decide → act. Returns true if the goal was just reached. */
  const tick = useCallback((now: number) => {
    const before = worldRef.current;
    const sensors = readSensors(castSensorRays(before));
    const seed = tickRef.current++;
    const recovered = applyStopRecovery(recoveryRef.current, controllerRef.current.decide(sensors, seed), sensors, seed);
    recoveryRef.current = recovered.state;
    const decision = recovered.decision;
    const after = stepWorld(before, decision.command, TICK_SECONDS);

    distanceRef.current += Math.hypot(
      after.robot.position.x - before.robot.position.x,
      after.robot.position.y - before.robot.position.y,
    );
    if (after.robot.collisions > before.robot.collisions) flashStartRef.current = now;

    worldRef.current = after;
    decisionRef.current = decision;
    raysRef.current = castSensorRays(after);

    if (after.robot.reachedGoal && !before.robot.reachedGoal) {
      goalAtRef.current = now;
      return true;
    }
    return false;
  }, []);

  // Single rAF loop: fixed-timestep physics + every-frame canvas render.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let lastPublish = 0;

    const frame = (nowMs: number) => {
      const now = nowMs / 1000;
      const realDt = Math.min(MAX_FRAME_SECONDS, Math.max(0, (nowMs - last) / 1000));
      last = nowMs;

      if (statusRef.current === "running") {
        accumulatorRef.current += realDt * settingsRef.current.speed;
        let reached = false;
        while (accumulatorRef.current >= TICK_SECONDS && !reached) {
          accumulatorRef.current -= TICK_SECONDS;
          reached = tick(now);
        }
        if (reached) {
          accumulatorRef.current = 0;
          updateStatus("goal");
          recordRun();
          publish();
          lastPublish = nowMs;
        } else if (nowMs - lastPublish >= UI_REFRESH_MS) {
          publish();
          lastPublish = nowMs;
        }
      }

      const flashStart = flashStartRef.current;
      const flash = flashStart === null ? 0 : Math.max(0, 1 - (now - flashStart) / COLLISION_FLASH_SECONDS);
      rendererRef.current?.({
        world: worldRef.current,
        rays: raysRef.current,
        effects: {
          collisionFlash: flash,
          goalCelebration:
            worldRef.current.robot.reachedGoal && goalAtRef.current !== null ? now - goalAtRef.current : null,
        },
      });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [tick, publish, recordRun, updateStatus]);

  // Initial preview so the panels show sensor values before the first run.
  useEffect(() => {
    refreshPreview();
  }, [refreshPreview]);

  const start = useCallback(() => {
    if (worldRef.current.robot.reachedGoal) return;
    worldRef.current = { ...worldRef.current, running: true };
    updateStatus("running");
  }, [updateStatus]);

  const pause = useCallback(() => {
    if (statusRef.current !== "running") return;
    worldRef.current = { ...worldRef.current, running: false };
    accumulatorRef.current = 0;
    updateStatus("paused");
    publish();
  }, [publish, updateStatus]);

  /** Reads the ref, not React state, so two presses before a re-render still alternate. */
  const toggle = useCallback(() => {
    if (statusRef.current === "running") pause();
    else start();
  }, [pause, start]);

  const step = useCallback(() => {
    if (statusRef.current === "running" || worldRef.current.robot.reachedGoal) return;
    const reached = tick(performance.now() / 1000);
    if (reached) {
      updateStatus("goal");
      recordRun();
    } else {
      updateStatus("paused");
    }
    publish();
  }, [tick, publish, recordRun, updateStatus]);

  const resetRunState = useCallback(() => {
    distanceRef.current = 0;
    tickRef.current = 0;
    accumulatorRef.current = 0;
    flashStartRef.current = null;
    goalAtRef.current = null;
    recordedRef.current = false;
    recoveryRef.current = INITIAL_STOP_RECOVERY;
    controllerRef.current.reset();
  }, []);

  const reset = useCallback(() => {
    recordRun();
    worldRef.current = resetWorld(worldRef.current);
    resetRunState();
    updateStatus("idle");
    refreshPreview();
  }, [recordRun, refreshPreview, resetRunState, updateStatus]);

  const updateSettings = useCallback(
    (patch: Partial<ExperimentSettings>) => {
      const prev = settingsRef.current;
      const next = { ...prev, ...patch };
      settingsRef.current = next;
      setSettings(next);

      if (next.scenarioId !== prev.scenarioId) {
        recordRun();
        worldRef.current = withSensorRange(createScenario(next.scenarioId), next.sensorRange);
        resetRunState();
        updateStatus("idle");
      } else if (next.sensorRange !== prev.sensorRange) {
        worldRef.current = withSensorRange(worldRef.current, next.sensorRange);
      }

      if (
        next.algorithm !== prev.algorithm ||
        next.sensorRange !== prev.sensorRange ||
        next.dangerThreshold !== prev.dangerThreshold
      ) {
        controllerRef.current = makeController(next.algorithm, toNeuroConfig(next));
        recoveryRef.current = INITIAL_STOP_RECOVERY;
      }
      if (statusRef.current !== "running") refreshPreview();
    },
    [recordRun, refreshPreview, resetRunState, updateStatus],
  );

  const clearHistory = useCallback(() => setHistory([]), []);

  const addObstacleAt = useCallback(
    (x: number, y: number): EditResult => {
      const w = worldRef.current;
      const size = OBSTACLE_SIZE;
      const obstacle: Obstacle = {
        id: `user-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        position: {
          x: Math.min(Math.max(0, x - size / 2), w.width - size),
          y: Math.min(Math.max(0, y - size / 2), w.height - size),
        },
        width: size,
        height: size,
      };
      const { robot, goal, goalRadius } = w;
      if (circleIntersectsRect(robot.position, robot.radius + 4, obstacle)) {
        return { ok: false, message: "로봇과 겹치는 위치에는 장애물을 놓을 수 없습니다." };
      }
      if (circleIntersectsRect(goal, goalRadius, obstacle)) {
        return { ok: false, message: "목적지를 가리는 위치에는 장애물을 놓을 수 없습니다." };
      }
      worldRef.current = { ...w, obstacles: [...w.obstacles, obstacle] };
      if (statusRef.current !== "running") refreshPreview();
      return { ok: true, message: `장애물을 추가했습니다 (총 ${worldRef.current.obstacles.length}개).` };
    },
    [refreshPreview],
  );

  const removeObstacle = useCallback(
    (id: string): EditResult => {
      const w = worldRef.current;
      if (!w.obstacles.some((o) => o.id === id)) return { ok: false, message: "삭제할 장애물이 없습니다." };
      worldRef.current = { ...w, obstacles: w.obstacles.filter((o) => o.id !== id) };
      if (statusRef.current !== "running") refreshPreview();
      return { ok: true, message: `장애물을 삭제했습니다 (남은 ${worldRef.current.obstacles.length}개).` };
    },
    [refreshPreview],
  );

  const removeLastObstacle = useCallback((): EditResult => {
    const last = worldRef.current.obstacles.at(-1);
    return last ? removeObstacle(last.id) : { ok: false, message: "삭제할 장애물이 없습니다." };
  }, [removeObstacle]);

  const setRenderer = useCallback((fn: ((frame: FrameData) => void) | null) => {
    rendererRef.current = fn;
  }, []);

  const getWorld = useCallback(() => worldRef.current, []);

  return {
    status,
    settings,
    scenarios,
    snapshot,
    history,
    start,
    pause,
    toggle,
    step,
    reset,
    updateSettings,
    clearHistory,
    addObstacleAt,
    removeObstacle,
    removeLastObstacle,
    setRenderer,
    getWorld,
  };
}

export type SimulationApi = ReturnType<typeof useSimulation>;
