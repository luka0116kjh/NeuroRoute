import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { MAX_TRAIL_POINTS } from "../../simulation/constants";
import type { Obstacle, RayHit, Vec2, WorldState } from "../../simulation/types";
import type { FrameData } from "../../hooks/useSimulation";
import { COLORS, type RenderOptions } from "./renderWorld";
import { fitDistance, headingToYaw, sceneToWorld, worldToScene, type Size } from "./scene3dMath";

export type CameraPreset = "orbit" | "top" | "follow";

export type PickResult = {
  /** Ground point under the pointer in world coordinates, or null outside the arena */
  point: Vec2 | null;
  /** Obstacle whose box is under the pointer (occlusion-aware), or null */
  obstacleId: string | null;
};

const FOV = 42;
const OBSTACLE_HEIGHT = 44;
const WALL_HEIGHT = 22;
const WALL_THICKNESS = 10;
const RAY_HEIGHT = 12;
const GRID_STEP = 50;
const BG = "#070b16";
/** Opaque version of COLORS.trail (vertex colours can't carry alpha). */
const TRAIL_HEAD = "#a78bfa";
/** Lit 3D boxes read darker than flat 2D fills, so obstacles get a lighter slate. */
const OBSTACLE_COLOR = "#33467a";
const OBSTACLE_EDGE = "#8fa6dc";

type RayRig = { beam: THREE.Mesh; beamMat: THREE.MeshBasicMaterial; hit: THREE.Mesh; hitMat: THREE.MeshBasicMaterial };
type ObstacleRig = { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; edgeMat: THREE.LineBasicMaterial };

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Imperative three.js view of the simulation. It owns its WebGL renderer and is
 * driven by the simulation loop through `render(frame, options)`.
 */
export class Scene3D {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 4 / 3, 1, 6000);
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(UP, 0);
  private readonly reducedMotion: boolean;

  private size: Size = { width: 0, height: 0 };
  private preset: CameraPreset = "orbit";
  private readonly arena = new THREE.Group();
  private readonly obstacleGroup = new THREE.Group();
  private obstacleKey = "";
  private readonly obstacles = new Map<string, ObstacleRig>();

  private readonly robot = new THREE.Group();
  private readonly robotShellMat: THREE.MeshStandardMaterial;
  private readonly robotRimMat: THREE.MeshStandardMaterial;
  private readonly flashRing: THREE.Mesh;
  private readonly flashMat: THREE.MeshBasicMaterial;
  private robotRadius = 0;

  private readonly goal = new THREE.Group();
  private readonly goalCore: THREE.Mesh;
  private readonly goalRings: THREE.Mesh[] = [];
  private goalRadius = 0;

  private readonly rays: RayRig[] = [];
  private readonly trail: THREE.Line;
  private readonly trailPositions: Float32Array;
  private readonly trailColors: Float32Array;

  private readonly followPos = new THREE.Vector3();
  private readonly followTarget = new THREE.Vector3();
  private followPrimed = false;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    this.scene.background = new THREE.Color(BG);
    this.scene.fog = new THREE.Fog(BG, 1100, 2600);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = 220;
    this.controls.maxDistance = 1900;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.12;
    // Right button is reserved for "delete obstacle".
    this.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: null };

    this.addLights();
    this.scene.add(this.arena, this.obstacleGroup, this.goal, this.robot);

    // Robot
    const shell = new THREE.MeshStandardMaterial({ color: "#16213d", metalness: 0.55, roughness: 0.35 });
    const rim = new THREE.MeshStandardMaterial({
      color: COLORS.robot,
      emissive: COLORS.robot,
      emissiveIntensity: 0.25,
      metalness: 0.3,
      roughness: 0.4,
    });
    this.robotShellMat = shell;
    this.robotRimMat = rim;
    this.flashMat = new THREE.MeshBasicMaterial({
      color: COLORS.collision,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.flashRing = new THREE.Mesh(new THREE.RingGeometry(0.7, 1, 48), this.flashMat);
    this.flashRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.flashRing);

    // Goal
    const goalMat = new THREE.MeshStandardMaterial({
      color: COLORS.goal,
      emissive: COLORS.goal,
      emissiveIntensity: 1.4,
      metalness: 0.2,
      roughness: 0.3,
    });
    this.goalCore = new THREE.Mesh(new THREE.OctahedronGeometry(1), goalMat);
    this.goalCore.castShadow = true;

    // Sensor rays
    for (let i = 0; i < 3; i++) {
      const beamMat = new THREE.MeshBasicMaterial({ color: COLORS.sensor, transparent: true, opacity: 0.85 });
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), beamMat);
      const hitMat = new THREE.MeshBasicMaterial({ color: COLORS.sensor });
      const hit = new THREE.Mesh(new THREE.SphereGeometry(3.6, 16, 12), hitMat);
      this.scene.add(beam, hit);
      this.rays.push({ beam, beamMat, hit, hitMat });
    }

    // Trail: vertex colours fade from the floor colour (oldest) to violet (newest).
    const capacity = MAX_TRAIL_POINTS + 2;
    this.trailPositions = new Float32Array(capacity * 3);
    this.trailColors = new Float32Array(capacity * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute("position", new THREE.BufferAttribute(this.trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
    trailGeo.setAttribute("color", new THREE.BufferAttribute(this.trailColors, 3).setUsage(THREE.DynamicDrawUsage));
    this.trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.trail.frustumCulled = false;
    this.scene.add(this.trail);
  }

  private addLights() {
    this.scene.add(new THREE.HemisphereLight("#9ab8ff", "#0a1020", 1.1));
    const key = new THREE.DirectionalLight("#ffffff", 2.1);
    key.position.set(-320, 700, 380);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.6;
    const cam = key.shadow.camera;
    cam.left = -520;
    cam.right = 520;
    cam.top = 440;
    cam.bottom = -440;
    cam.near = 100;
    cam.far = 1800;
    this.scene.add(key);
    const rimLight = new THREE.DirectionalLight("#7c6cff", 0.6);
    rimLight.position.set(400, 250, -500);
    this.scene.add(rimLight);
  }

  // ---------------------------------------------------------------- arena

  private buildArena(size: Size) {
    disposeTree(this.arena);
    this.arena.clear();
    const { width: w, height: h } = size;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshStandardMaterial({ color: "#0c1429", metalness: 0.15, roughness: 0.85 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.arena.add(floor);

    // Wide dark apron so the arena doesn't float in the void.
    const apron = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 6, h * 6),
      new THREE.MeshStandardMaterial({ color: "#060a14", roughness: 1 }),
    );
    apron.rotation.x = -Math.PI / 2;
    apron.position.y = -0.5;
    apron.receiveShadow = true;
    this.arena.add(apron);

    const grid: number[] = [];
    for (let x = GRID_STEP; x < w; x += GRID_STEP) grid.push(x - w / 2, 0.2, -h / 2, x - w / 2, 0.2, h / 2);
    for (let z = GRID_STEP; z < h; z += GRID_STEP) grid.push(-w / 2, 0.2, z - h / 2, w / 2, 0.2, z - h / 2);
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(grid, 3));
    this.arena.add(
      new THREE.LineSegments(gridGeo, new THREE.LineBasicMaterial({ color: "#60a5fa", transparent: true, opacity: 0.13 })),
    );

    // Walls sit just outside the 0..w × 0..h playfield.
    const wallMat = new THREE.MeshStandardMaterial({
      color: COLORS.wall,
      emissive: "#1d2a4a",
      emissiveIntensity: 0.5,
      metalness: 0.4,
      roughness: 0.5,
    });
    const t = WALL_THICKNESS;
    const walls: [number, number, number, number][] = [
      [0, -h / 2 - t / 2, w + 2 * t, t],
      [0, h / 2 + t / 2, w + 2 * t, t],
      [-w / 2 - t / 2, 0, t, h],
      [w / 2 + t / 2, 0, t, h],
    ];
    const glowMat = new THREE.LineBasicMaterial({ color: "#60a5fa", transparent: true, opacity: 0.55 });
    for (const [x, z, sx, sz] of walls) {
      const geo = new THREE.BoxGeometry(sx, WALL_HEIGHT, sz);
      const wall = new THREE.Mesh(geo, wallMat);
      wall.position.set(x, WALL_HEIGHT / 2, z);
      wall.castShadow = true;
      wall.receiveShadow = true;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), glowMat);
      wall.add(edges);
      this.arena.add(wall);
    }
  }

  // ------------------------------------------------------------ obstacles

  private syncObstacles(list: Obstacle[]) {
    const key = list.map((o) => `${o.id}:${o.position.x},${o.position.y},${o.width},${o.height}`).join("|");
    if (key === this.obstacleKey) return;
    this.obstacleKey = key;
    disposeTree(this.obstacleGroup);
    this.obstacleGroup.clear();
    this.obstacles.clear();

    for (const o of list) {
      // Deterministic height variation per obstacle keeps the skyline interesting.
      const height = OBSTACLE_HEIGHT * (0.8 + 0.4 * hash01(o.id));
      const geo = new THREE.BoxGeometry(o.width, height, o.height);
      const mat = new THREE.MeshStandardMaterial({
        color: OBSTACLE_COLOR,
        emissive: "#000000",
        metalness: 0.35,
        roughness: 0.55,
      });
      const mesh = new THREE.Mesh(geo, mat);
      const c = worldToScene(this.size, o.position.x + o.width / 2, o.position.y + o.height / 2);
      mesh.position.set(c.x, height / 2, c.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.obstacleId = o.id;
      const edgeMat = new THREE.LineBasicMaterial({ color: OBSTACLE_EDGE });
      mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
      this.obstacleGroup.add(mesh);
      this.obstacles.set(o.id, { mesh, mat, edgeMat });
    }
  }

  private styleObstacles(options: RenderOptions) {
    for (const [id, rig] of this.obstacles) {
      const hovered = options.deleteMode && id === options.hoveredObstacleId;
      rig.mat.color.set(hovered ? "#5b1f2a" : OBSTACLE_COLOR);
      rig.mat.emissive.set(hovered ? COLORS.obstacleDelete : "#000000");
      rig.mat.emissiveIntensity = hovered ? 0.35 : 0;
      rig.edgeMat.color.set(hovered ? COLORS.obstacleDelete : OBSTACLE_EDGE);
    }
  }

  // ---------------------------------------------------------------- robot

  private buildRobot(r: number) {
    disposeTree(this.robot);
    this.robot.clear();
    this.robotRadius = r;
    const bodyH = r * 0.8;
    const lift = r * 0.35;

    const body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.96, r, bodyH, 40), this.robotShellMat);
    body.position.y = lift + bodyH / 2;
    body.castShadow = true;
    this.robot.add(body);

    const rim = new THREE.Mesh(new THREE.TorusGeometry(r * 0.96, r * 0.07, 10, 48), this.robotRimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = lift + bodyH;
    this.robot.add(rim);

    const dome = new THREE.Mesh(new THREE.SphereGeometry(r * 0.55, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.robotRimMat);
    dome.position.y = lift + bodyH;
    dome.castShadow = true;
    this.robot.add(dome);

    // Heading "nose" pointing along local +x.
    const noseMat = new THREE.MeshStandardMaterial({
      color: COLORS.robotHeading,
      emissive: COLORS.robotHeading,
      emissiveIntensity: 0.9,
    });
    const nose = new THREE.Mesh(new THREE.ConeGeometry(r * 0.3, r * 0.75, 20), noseMat);
    nose.rotation.z = -Math.PI / 2;
    nose.position.set(r * 0.78, lift + bodyH * 0.55, 0);
    this.robot.add(nose);

    // Sensor eye on the dome
    const eyeMat = new THREE.MeshBasicMaterial({ color: COLORS.sensor });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(r * 0.14, 12, 8), eyeMat);
    eye.position.set(r * 0.42, lift + bodyH + r * 0.28, 0);
    this.robot.add(eye);

    const wheelMat = new THREE.MeshStandardMaterial({ color: "#0b0f1c", roughness: 0.9 });
    for (const side of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.42, r * 0.42, r * 0.28, 20), wheelMat);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(0, r * 0.42, side * r * 0.98);
      wheel.castShadow = true;
      this.robot.add(wheel);
    }
  }

  private updateRobot(world: WorldState, flash: number) {
    const { position, angle, radius } = world.robot;
    if (radius !== this.robotRadius) this.buildRobot(radius);
    const p = worldToScene(this.size, position.x, position.y);
    this.robot.position.set(p.x, 0, p.z);
    this.robot.rotation.y = headingToYaw(angle);

    this.robotShellMat.emissive.set(COLORS.collision);
    this.robotShellMat.emissiveIntensity = flash * 0.9;
    this.robotRimMat.emissive.set(flash > 0 ? COLORS.collision : COLORS.robot);

    this.flashRing.visible = flash > 0;
    if (flash > 0) {
      const s = radius * (1.4 + (1 - flash) * 1.8);
      this.flashRing.position.set(p.x, 0.6, p.z);
      this.flashRing.scale.setScalar(s);
      this.flashMat.opacity = 0.7 * flash;
    }
  }

  // ----------------------------------------------------------------- goal

  private buildGoal(r: number) {
    disposeTree(this.goal, [this.goalCore]);
    this.goal.clear();
    this.goalRings.length = 0;
    this.goalRadius = r;

    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(r, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.goal, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = 0.4;
    this.goal.add(pad);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.88, r, 48),
      new THREE.MeshBasicMaterial({ color: COLORS.goal, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.5;
    this.goal.add(ring);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.55, r * 0.8, 160, 32, 1, true),
      new THREE.MeshBasicMaterial({
        color: COLORS.goal,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    beam.position.y = 80;
    this.goal.add(beam);

    this.goalCore.scale.setScalar(r * 0.42);
    this.goal.add(this.goalCore);

    const light = new THREE.PointLight(COLORS.goal, 1.6, r * 8, 1.4);
    light.position.y = r * 1.2;
    this.goal.add(light);

    // Celebration ripples
    for (let i = 0; i < 3; i++) {
      const ripple = new THREE.Mesh(
        new THREE.RingGeometry(0.94, 1, 64),
        new THREE.MeshBasicMaterial({ color: COLORS.goal, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
      );
      ripple.rotation.x = -Math.PI / 2;
      ripple.position.y = 0.7;
      ripple.visible = false;
      this.goal.add(ripple);
      this.goalRings.push(ripple);
    }
  }

  private updateGoal(world: WorldState, celebration: number | null, time: number) {
    if (world.goalRadius !== this.goalRadius) this.buildGoal(world.goalRadius);
    const p = worldToScene(this.size, world.goal.x, world.goal.y);
    this.goal.position.set(p.x, 0, p.z);

    const r = this.goalRadius;
    const bob = this.reducedMotion ? 0 : Math.sin(time * 2) * r * 0.12;
    this.goalCore.position.y = r * 1.25 + bob;
    if (!this.reducedMotion) this.goalCore.rotation.y = time * 1.2;

    this.goalRings.forEach((ripple, i) => {
      ripple.visible = celebration !== null;
      if (celebration === null) return;
      const t = ((celebration + i * 0.5) % 1.5) / 1.5;
      ripple.scale.setScalar(r + t * r * 2.4);
      (ripple.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    });
  }

  // ----------------------------------------------------------- rays/trail

  private updateRay(rig: RayRig, ray: RayHit, threshold: number) {
    const danger = ray.distance < threshold;
    const color = danger ? COLORS.danger : COLORS.sensor;
    const a = worldToScene(this.size, ray.origin.x, ray.origin.y);
    const b = worldToScene(this.size, ray.end.x, ray.end.y);
    const start = new THREE.Vector3(a.x, RAY_HEIGHT, a.z);
    const end = new THREE.Vector3(b.x, RAY_HEIGHT, b.z);
    const dir = end.clone().sub(start);
    const len = Math.max(dir.length(), 0.001);

    rig.beam.position.copy(start).addScaledVector(dir, 0.5);
    rig.beam.quaternion.setFromUnitVectors(UP, dir.normalize());
    const thickness = danger ? 1.8 : 1.3;
    rig.beam.scale.set(thickness, len, thickness);
    rig.beamMat.color.set(color);
    // Rays that hit nothing fade out, like the dashed lines in 2D.
    rig.beamMat.opacity = ray.hitId === null ? 0.45 : 0.95;

    rig.hit.visible = ray.hitId !== null;
    rig.hit.position.copy(end);
    rig.hitMat.color.set(color);
  }

  private updateTrail(world: WorldState) {
    const pts = world.robot.trail;
    const n = pts.length + 1;
    const floor = new THREE.Color("#0c1429");
    const head = new THREE.Color(TRAIL_HEAD);
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const src = i < pts.length ? pts[i] : world.robot.position;
      const s = worldToScene(this.size, src.x, src.y);
      this.trailPositions[i * 3] = s.x;
      this.trailPositions[i * 3 + 1] = 1;
      this.trailPositions[i * 3 + 2] = s.z;
      c.copy(floor).lerp(head, 0.25 + 0.75 * (i / Math.max(1, n - 1)));
      this.trailColors[i * 3] = c.r;
      this.trailColors[i * 3 + 1] = c.g;
      this.trailColors[i * 3 + 2] = c.b;
    }
    const geo = this.trail.geometry;
    geo.setDrawRange(0, n >= 2 ? n : 0);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }

  // --------------------------------------------------------------- camera

  setCameraPreset(preset: CameraPreset) {
    this.preset = preset;
    this.followPrimed = false;
    this.controls.enabled = preset !== "follow";
    this.applyPreset();
  }

  private applyPreset() {
    if (!this.size.width) return;
    const d = fitDistance(this.size, FOV, this.camera.aspect);
    if (this.preset === "top") {
      this.camera.position.set(0, d, 0.01);
      this.controls.target.set(0, 0, 0);
    } else if (this.preset === "orbit") {
      // ~50° elevation, looking from the "bottom" edge of the 2D map.
      const dist = d * 1.2;
      this.camera.position.set(0, dist * 0.8, dist * 0.62);
      this.controls.target.set(0, 0, 40);
    }
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  private updateFollow(world: WorldState) {
    const { position, angle } = world.robot;
    const p = worldToScene(this.size, position.x, position.y);
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const pos = new THREE.Vector3(p.x - dx * 150, 110, p.z - dz * 150);
    const target = new THREE.Vector3(p.x + dx * 70, 8, p.z + dz * 70);
    if (!this.followPrimed || this.reducedMotion) {
      this.followPos.copy(pos);
      this.followTarget.copy(target);
      this.followPrimed = true;
    } else {
      this.followPos.lerp(pos, 0.08);
      this.followTarget.lerp(target, 0.12);
    }
    this.camera.position.copy(this.followPos);
    this.camera.lookAt(this.followTarget);
  }

  resize(width: number, height: number) {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.preset === "top") this.applyPreset();
  }

  // -------------------------------------------------------------- public

  render({ world, rays, effects }: FrameData, options: RenderOptions) {
    if (world.width !== this.size.width || world.height !== this.size.height) {
      this.size = { width: world.width, height: world.height };
      this.obstacleKey = "";
      this.buildArena(this.size);
      this.applyPreset();
    }
    const time = performance.now() / 1000;
    this.syncObstacles(world.obstacles);
    this.styleObstacles(options);
    this.updateGoal(world, effects.goalCelebration, time);
    this.updateRobot(world, effects.collisionFlash);
    this.updateTrail(world);
    const list = [rays.left, rays.center, rays.right];
    list.forEach((ray, i) => this.updateRay(this.rays[i], ray, options.dangerThreshold));

    if (this.preset === "follow") this.updateFollow(world);
    else this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Pointer position (client px) → obstacle / ground point under it. */
  pick(clientX: number, clientY: number, rect: DOMRect): PickResult {
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.obstacleGroup.children, false)[0];
    const obstacleId = (hit?.object.userData.obstacleId as string | undefined) ?? null;

    const ground = new THREE.Vector3();
    let point: Vec2 | null = null;
    if (this.raycaster.ray.intersectPlane(this.ground, ground)) {
      const w = sceneToWorld(this.size, ground.x, ground.z);
      if (w.x >= 0 && w.x <= this.size.width && w.y >= 0 && w.y <= this.size.height) point = w;
    }
    return { point, obstacleId };
  }

  dispose() {
    this.controls.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
  }
}

function disposeTree(root: THREE.Object3D, keep: THREE.Object3D[] = []) {
  root.traverse((obj) => {
    if (obj === root || keep.includes(obj)) return;
    const mesh = obj as THREE.Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else mat?.dispose();
  });
}

function hash01(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 1000) / 1000;
}
