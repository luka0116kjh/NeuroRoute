import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import type { EditResult, FrameData, SimulationApi } from "../hooks/useSimulation";
import type { Vec2 } from "../simulation/types";
import { COLORS, findObstacleAt, renderWorld } from "./simulation/renderWorld";
import { webglAvailable } from "./simulation/scene3dMath";
import type { CameraPreset, Scene3D } from "./simulation/Scene3D";

type EditMode = "add" | "delete";
type ViewMode = "2d" | "3d";

type Props = {
  sim: Pick<SimulationApi, "setRenderer" | "getWorld" | "addObstacleAt" | "removeObstacle" | "removeLastObstacle">;
  dangerDistance: number;
};

const LEGEND = [
  { label: "로봇 Robot", color: COLORS.robot },
  { label: "목적지 Goal", color: COLORS.goal },
  { label: "장애물 Obstacle", color: COLORS.obstacleEdge },
  { label: "센서 레이 Sensor", color: COLORS.sensor },
  { label: "위험 Danger", color: COLORS.danger },
  { label: "궤적 Trail", color: COLORS.trail },
];

const CAMERA_PRESETS: { id: CameraPreset; label: string }[] = [
  { id: "orbit", label: "자유 시점" },
  { id: "top", label: "탑뷰" },
  { id: "follow", label: "로봇 추적" },
];

const VIEW_STORAGE_KEY = "neuroroute:view";
/** Pointer travel (px) above which a press counts as a camera drag, not a click. */
const DRAG_THRESHOLD = 5;

function initialView(): ViewMode {
  if (!webglAvailable()) return "2d";
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "2d" ? "2d" : "3d";
  } catch {
    return "3d";
  }
}

type PickHit = { point: Vec2 | null; obstacleId: string | null };

export function SimulationCanvas({ sim, dangerDistance }: Props) {
  const { setRenderer, getWorld, addObstacleAt, removeObstacle, removeLastObstacle } = sim;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene3D | null>(null);
  const pressRef = useRef<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<EditMode>("add");
  const [view, setView] = useState<ViewMode>(initialView);
  const [camera, setCamera] = useState<CameraPreset>("orbit");
  const [message, setMessage] = useState<EditResult | null>(null);

  // Values read inside the render callback without re-registering it.
  const viewRef = useRef({ dangerDistance, mode, hovered: null as string | null });
  viewRef.current.dangerDistance = dangerDistance;
  viewRef.current.mode = mode;

  const renderOptions = () => ({
    dangerThreshold: viewRef.current.dangerDistance,
    hoveredObstacleId: viewRef.current.hovered,
    deleteMode: viewRef.current.mode === "delete",
  });

  const changeView = (next: ViewMode) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      /* storage unavailable — the choice just won't persist */
    }
  };

  // Keep the drawing buffer matched to the element's CSS size.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      if (view === "3d") {
        sceneRef.current?.resize(rect.width, rect.height);
        return;
      }
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [view]);

  // 2D renderer
  useEffect(() => {
    if (view !== "2d") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const draw = ({ world, rays, effects }: FrameData) => {
      const sx = canvas.width / world.width;
      const sy = canvas.height / world.height;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      renderWorld(ctx, world, rays, effects, renderOptions());
    };
    setRenderer(draw);
    return () => setRenderer(null);
  }, [setRenderer, view]);

  // 3D renderer — three.js is loaded on demand so the 2D path stays light.
  useEffect(() => {
    if (view !== "3d") return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    let cancelled = false;
    let scene: Scene3D | null = null;
    import("./simulation/Scene3D")
      .then(({ Scene3D }) => {
        if (cancelled) return;
        scene = new Scene3D(canvas);
        sceneRef.current = scene;
        scene.setCameraPreset(camera);
        const rect = wrap.getBoundingClientRect();
        scene.resize(rect.width, rect.height);
        setRenderer((frame: FrameData) => scene?.render(frame, renderOptions()));
      })
      .catch(() => {
        if (cancelled) return;
        setMessage({ ok: false, message: "3D 화면을 시작하지 못해 2D 화면으로 전환했습니다." });
        setView("2d");
      });
    return () => {
      cancelled = true;
      setRenderer(null);
      scene?.dispose();
      sceneRef.current = null;
    };
    // camera is applied by its own effect; re-creating the scene for it would be wasteful.
  }, [setRenderer, view]);

  useEffect(() => {
    sceneRef.current?.setCameraPreset(camera);
  }, [camera]);

  const pickAt = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>): PickHit => {
      const rect = e.currentTarget.getBoundingClientRect();
      if (view === "3d") {
        return sceneRef.current?.pick(e.clientX, e.clientY, rect) ?? { point: null, obstacleId: null };
      }
      const world = getWorld();
      const point = {
        x: ((e.clientX - rect.left) / rect.width) * world.width,
        y: ((e.clientY - rect.top) / rect.height) * world.height,
      };
      return { point, obstacleId: findObstacleAt(world, point.x, point.y)?.id ?? null };
    },
    [getWorld, view],
  );

  const deleteAt = (pick: PickHit) => {
    setMessage(pick.obstacleId ? removeObstacle(pick.obstacleId) : { ok: false, message: "이 위치에는 장애물이 없습니다." });
  };

  const wasDrag = (e: ReactMouseEvent) => {
    const press = pressRef.current;
    pressRef.current = null;
    return !!press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_THRESHOLD;
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    pressRef.current = { x: e.clientX, y: e.clientY };
  };

  const handleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (wasDrag(e)) return;
    const pick = pickAt(e);
    if (mode === "delete") deleteAt(pick);
    else if (pick.point) setMessage(addObstacleAt(pick.point.x, pick.point.y));
    else setMessage({ ok: false, message: "아레나 바깥에는 장애물을 놓을 수 없습니다." });
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    deleteAt(pickAt(e));
  };

  const handleMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    viewRef.current.hovered = pickAt(e).obstacleId;
  };

  const addRandom = () => {
    const w = getWorld();
    for (let i = 0; i < 30; i++) {
      const result = addObstacleAt(40 + Math.random() * (w.width - 80), 40 + Math.random() * (w.height - 80));
      if (result.ok) return setMessage(result);
    }
    setMessage({ ok: false, message: "빈 위치를 찾지 못했습니다." });
  };

  const is3d = view === "3d";
  const editHint = mode === "add" ? "클릭: 장애물 추가 · 우클릭: 장애물 삭제" : "클릭 또는 우클릭: 장애물 삭제";
  const cameraHint = camera === "follow" ? "로봇 추적 중" : "드래그: 회전 · 휠: 확대/축소";

  return (
    <section className="panel sim-panel" aria-labelledby="sim-title">
      <div className="sim-toolbar">
        <h2 id="sim-title" className="panel-title" style={{ margin: 0 }}>
          Arena · 시뮬레이션
        </h2>
        <div className="segmented" role="group" aria-label="장애물 편집 모드">
          <button
            type="button"
            className="btn btn-small"
            aria-pressed={mode === "add"}
            onClick={() => setMode("add")}
          >
            ＋ 추가 모드
          </button>
          <button
            type="button"
            className="btn btn-small"
            aria-pressed={mode === "delete"}
            onClick={() => setMode("delete")}
          >
            − 삭제 모드
          </button>
        </div>
      </div>

      <div className="canvas-wrap" ref={wrapRef} data-mode={mode} data-view={view}>
        <canvas
          // A canvas can't switch from a 2D to a WebGL context, so each view gets a fresh element.
          key={view}
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onMouseMove={handleMove}
          onMouseLeave={() => (viewRef.current.hovered = null)}
          role="img"
          aria-label={`로봇 시뮬레이션 ${is3d ? "3D" : "2D"} 화면. 클릭하면 장애물을 추가하고, 우클릭하거나 삭제 모드에서 클릭하면 장애물을 삭제합니다.`}
          data-testid="sim-canvas"
        />

        <div className="view-overlay">
          {is3d && (
            <div className="segmented glass" role="group" aria-label="카메라 시점">
              {CAMERA_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn btn-small"
                  aria-pressed={camera === p.id}
                  onClick={() => setCamera(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {webglAvailable() && (
            <div className="segmented glass view-toggle" role="group" aria-label="화면 모드">
              <button type="button" className="btn btn-small" aria-pressed={view === "2d"} onClick={() => changeView("2d")}>
                2D
              </button>
              <button type="button" className="btn btn-small" aria-pressed={is3d} onClick={() => changeView("3d")}>
                3D
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="sim-toolbar">
        <p className="hint" style={{ margin: 0 }}>
          {is3d ? `${editHint} · ${cameraHint}` : editHint}
        </p>
        <div className="controls">
          <button type="button" className="btn btn-small" onClick={addRandom}>
            무작위 장애물 추가
          </button>
          <button type="button" className="btn btn-small" onClick={() => setMessage(removeLastObstacle())}>
            마지막 장애물 삭제
          </button>
        </div>
      </div>
      <p
        className="hint"
        role="status"
        aria-live="polite"
        style={{ margin: 0, minHeight: "1.2em", color: message && !message.ok ? "var(--warning)" : undefined }}
      >
        {message?.message ?? ""}
      </p>

      <ul className="legend" aria-label="범례">
        {LEGEND.map((l) => (
          <li key={l.label}>
            <span className="swatch" style={{ background: l.color }} aria-hidden="true" />
            {l.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
