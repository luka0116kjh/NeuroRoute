import { useCallback, useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import type { EditResult, FrameData, SimulationApi } from "../hooks/useSimulation";
import { COLORS, findObstacleAt, renderWorld } from "./simulation/renderWorld";

type EditMode = "add" | "delete";

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

export function SimulationCanvas({ sim, dangerDistance }: Props) {
  const { setRenderer, getWorld, addObstacleAt, removeObstacle, removeLastObstacle } = sim;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<EditMode>("add");
  const [message, setMessage] = useState<EditResult | null>(null);

  // Values read inside the render callback without re-registering it.
  const viewRef = useRef({ dangerDistance, mode, hovered: null as string | null });
  viewRef.current.dangerDistance = dangerDistance;
  viewRef.current.mode = mode;

  // Keep the backing store matched to CSS size × devicePixelRatio for crisp lines.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
    };
    resize();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const draw = ({ world, rays, effects }: FrameData) => {
      const sx = canvas.width / world.width;
      const sy = canvas.height / world.height;
      ctx.setTransform(sx, 0, 0, sy, 0, 0);
      renderWorld(ctx, world, rays, effects, {
        dangerThreshold: viewRef.current.dangerDistance,
        hoveredObstacleId: viewRef.current.hovered,
        deleteMode: viewRef.current.mode === "delete",
      });
    };
    setRenderer(draw);
    return () => setRenderer(null);
  }, [setRenderer]);

  const toWorld = useCallback(
    (e: ReactMouseEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const world = getWorld();
      return {
        x: ((e.clientX - rect.left) / rect.width) * world.width,
        y: ((e.clientY - rect.top) / rect.height) * world.height,
      };
    },
    [getWorld],
  );

  const deleteAt = (x: number, y: number) => {
    const hit = findObstacleAt(getWorld(), x, y);
    setMessage(hit ? removeObstacle(hit.id) : { ok: false, message: "이 위치에는 장애물이 없습니다." });
  };

  const handleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toWorld(e);
    if (mode === "delete") deleteAt(x, y);
    else setMessage(addObstacleAt(x, y));
  };

  const handleContextMenu = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const { x, y } = toWorld(e);
    deleteAt(x, y);
  };

  const handleMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const { x, y } = toWorld(e);
    viewRef.current.hovered = findObstacleAt(getWorld(), x, y)?.id ?? null;
  };

  const addRandom = () => {
    const w = getWorld();
    for (let i = 0; i < 30; i++) {
      const result = addObstacleAt(40 + Math.random() * (w.width - 80), 40 + Math.random() * (w.height - 80));
      if (result.ok) return setMessage(result);
    }
    setMessage({ ok: false, message: "빈 위치를 찾지 못했습니다." });
  };

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

      <div className="canvas-wrap" ref={wrapRef} data-mode={mode}>
        <canvas
          ref={canvasRef}
          onClick={handleClick}
          onContextMenu={handleContextMenu}
          onMouseMove={handleMove}
          onMouseLeave={() => (viewRef.current.hovered = null)}
          role="img"
          aria-label="로봇 시뮬레이션 화면. 클릭하면 장애물을 추가하고, 우클릭하거나 삭제 모드에서 클릭하면 장애물을 삭제합니다."
          data-testid="sim-canvas"
        />
      </div>

      <div className="sim-toolbar">
        <p className="hint" style={{ margin: 0 }}>
          {mode === "add" ? "클릭: 장애물 추가 · 우클릭: 장애물 삭제" : "클릭 또는 우클릭: 장애물 삭제"}
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
