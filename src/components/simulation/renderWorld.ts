import type { RayHit, SensorRays, WorldState } from "../../simulation/types";

export type RenderEffects = {
  /** 0..1, decays after a new collision */
  collisionFlash: number;
  /** seconds since the goal was reached, or null */
  goalCelebration: number | null;
};

export type RenderOptions = {
  /** Sensor distance (px) below which a ray is drawn as "danger" */
  dangerThreshold: number;
  /** Obstacle id under the pointer (delete mode highlight) */
  hoveredObstacleId: string | null;
  deleteMode: boolean;
};

export const COLORS = {
  background: "#0a1020",
  grid: "rgba(96, 165, 250, 0.07)",
  wall: "#34466f",
  obstacle: "#1e2a47",
  obstacleEdge: "#5b6f9c",
  obstacleDelete: "#f87171",
  goal: "#34d399",
  robot: "#e6ecf7",
  robotHeading: "#fb923c",
  sensor: "#22d3ee",
  danger: "#f87171",
  trail: "rgba(167, 139, 250, 0.75)",
  collision: "#f87171",
} as const;

const GRID_STEP = 50;

function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.strokeStyle = COLORS.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = GRID_STEP; x < w; x += GRID_STEP) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, h);
  }
  for (let y = GRID_STEP; y < h; y += GRID_STEP) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(w, y + 0.5);
  }
  ctx.stroke();
}

function drawGoal(ctx: CanvasRenderingContext2D, world: WorldState, celebration: number | null) {
  const { goal, goalRadius } = world;
  ctx.save();
  ctx.fillStyle = "rgba(52, 211, 153, 0.15)";
  ctx.strokeStyle = COLORS.goal;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(goal.x, goal.y, goalRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Flag / cross-hair marker
  ctx.beginPath();
  ctx.moveTo(goal.x - goalRadius * 0.45, goal.y);
  ctx.lineTo(goal.x + goalRadius * 0.45, goal.y);
  ctx.moveTo(goal.x, goal.y - goalRadius * 0.45);
  ctx.lineTo(goal.x, goal.y + goalRadius * 0.45);
  ctx.stroke();

  if (celebration !== null) {
    // Three expanding rings, repeating every 1.5 s — calm, not flashy.
    for (let i = 0; i < 3; i++) {
      const t = ((celebration + i * 0.5) % 1.5) / 1.5;
      ctx.globalAlpha = 1 - t;
      ctx.beginPath();
      ctx.arc(goal.x, goal.y, goalRadius + t * goalRadius * 2.2, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawObstacles(ctx: CanvasRenderingContext2D, world: WorldState, options: RenderOptions) {
  for (const o of world.obstacles) {
    const hovered = options.deleteMode && o.id === options.hoveredObstacleId;
    ctx.fillStyle = hovered ? "rgba(248, 113, 113, 0.25)" : COLORS.obstacle;
    ctx.strokeStyle = hovered ? COLORS.obstacleDelete : COLORS.obstacleEdge;
    ctx.lineWidth = hovered ? 2 : 1.5;
    ctx.fillRect(o.position.x, o.position.y, o.width, o.height);
    ctx.strokeRect(o.position.x + 0.5, o.position.y + 0.5, o.width - 1, o.height - 1);
    if (hovered) {
      const cx = o.position.x + o.width / 2;
      const cy = o.position.y + o.height / 2;
      const s = Math.min(8, o.width / 4, o.height / 4);
      ctx.beginPath();
      ctx.moveTo(cx - s, cy - s);
      ctx.lineTo(cx + s, cy + s);
      ctx.moveTo(cx + s, cy - s);
      ctx.lineTo(cx - s, cy + s);
      ctx.stroke();
    }
  }
}

function drawTrail(ctx: CanvasRenderingContext2D, world: WorldState) {
  const trail = world.robot.trail;
  if (trail.length < 2) return;
  ctx.save();
  ctx.strokeStyle = COLORS.trail;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(trail[0].x, trail[0].y);
  for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
  ctx.lineTo(world.robot.position.x, world.robot.position.y);
  ctx.stroke();
  ctx.restore();
}

function drawRay(ctx: CanvasRenderingContext2D, ray: RayHit, threshold: number) {
  const danger = ray.distance < threshold;
  const color = danger ? COLORS.danger : COLORS.sensor;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = danger ? 2 : 1.5;
  ctx.setLineDash(ray.hitId === null ? [5, 5] : []);
  ctx.beginPath();
  ctx.moveTo(ray.origin.x, ray.origin.y);
  ctx.lineTo(ray.end.x, ray.end.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (ray.hitId !== null) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(ray.end.x, ray.end.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawRobot(ctx: CanvasRenderingContext2D, world: WorldState, flash: number) {
  const { position, angle, radius } = world.robot;
  ctx.save();
  ctx.translate(position.x, position.y);

  if (flash > 0) {
    ctx.fillStyle = `rgba(248, 113, 113, ${0.35 * flash})`;
    ctx.beginPath();
    ctx.arc(0, 0, radius * (1.6 + (1 - flash) * 1.2), 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.rotate(angle);
  ctx.fillStyle = "#16213d";
  ctx.strokeStyle = flash > 0 ? COLORS.collision : COLORS.robot;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Heading wedge
  ctx.fillStyle = COLORS.robotHeading;
  ctx.beginPath();
  ctx.moveTo(radius * 0.95, 0);
  ctx.lineTo(radius * 0.1, -radius * 0.5);
  ctx.lineTo(radius * 0.1, radius * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/**
 * Draws one frame. The canvas transform must already map world units to
 * device pixels (see SimulationCanvas).
 */
export function renderWorld(
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  rays: SensorRays | null,
  effects: RenderEffects,
  options: RenderOptions,
) {
  const { width, height } = world;
  ctx.fillStyle = COLORS.background;
  ctx.fillRect(0, 0, width, height);
  drawGrid(ctx, width, height);

  ctx.strokeStyle = COLORS.wall;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, width - 3, height - 3);

  drawTrail(ctx, world);
  drawGoal(ctx, world, effects.goalCelebration);
  drawObstacles(ctx, world, options);
  if (rays) {
    drawRay(ctx, rays.left, options.dangerThreshold);
    drawRay(ctx, rays.center, options.dangerThreshold);
    drawRay(ctx, rays.right, options.dangerThreshold);
  }
  drawRobot(ctx, world, effects.collisionFlash);
}

/** Topmost obstacle containing the point, or null. */
export function findObstacleAt(world: WorldState, x: number, y: number) {
  for (let i = world.obstacles.length - 1; i >= 0; i--) {
    const o = world.obstacles[i];
    if (x >= o.position.x && x <= o.position.x + o.width && y >= o.position.y && y <= o.position.y + o.height) {
      return o;
    }
  }
  return null;
}
