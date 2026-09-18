/**
 * Mapping between the 2D simulation plane and the 3D scene.
 *
 * World: origin top-left, x → right, y → down, angle 0 = +x, clockwise on screen.
 * Scene: Y up, arena centred on the origin, world y → scene z. With the default
 * camera looking from +z, the 3D view keeps the same left/right/top/bottom
 * layout as the 2D canvas.
 */

export type Size = { width: number; height: number };

export function worldToScene(size: Size, x: number, y: number) {
  return { x: x - size.width / 2, z: y - size.height / 2 };
}

export function sceneToWorld(size: Size, sx: number, sz: number) {
  return { x: sx + size.width / 2, y: sz + size.height / 2 };
}

/**
 * Rotation about the scene's Y axis that points a model's local +x along the
 * world heading. Rotating by θ about Y maps (1,0,0) to (cos θ, 0, −sin θ), and the
 * heading direction in scene space is (cos a, 0, sin a), so θ = −a.
 */
export function headingToYaw(angle: number) {
  return -angle;
}

/** Camera distance at which a `size` rectangle (plus margin) fits a perspective view. */
export function fitDistance(size: Size, fovDeg: number, aspect: number, margin = 1.08) {
  const halfFov = (fovDeg * Math.PI) / 360;
  const needHeight = Math.max(size.height, size.width / aspect) * margin;
  return needHeight / (2 * Math.tan(halfFov));
}

let webglSupport: boolean | null = null;

/** True when the browser can create a WebGL2 context (false in jsdom). */
export function webglAvailable() {
  if (webglSupport !== null) return webglSupport;
  try {
    webglSupport =
      typeof window !== "undefined" &&
      typeof window.WebGL2RenderingContext !== "undefined" &&
      !!document.createElement("canvas").getContext("webgl2");
  } catch {
    webglSupport = false;
  }
  return webglSupport;
}
