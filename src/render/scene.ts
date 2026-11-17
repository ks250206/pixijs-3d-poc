import { sampleWeapon, bodyHurtbox } from '../game/combat/geometry';
import { laneAssist } from '../game/combat/assist';
import { placeSegment, worldMatrix } from './weapon';
import { Application, Container, Graphics, RendererType, Text, Texture } from 'pixi.js';
import type { WebGLRenderer } from 'pixi.js';
import {
  Box,
  Container3D,
  CubeGeometry,
  CylinderGeometry,
  DirectionalLight,
  Geometry3D,
  Material3D,
  Mesh3D,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  View3D,
} from '@pixi/3d';
import { ENEMY_NAMES, type Actor, type ActorKind, type ArenaProp, type Effect, type Projectile, type WorldState } from '../game/types';
import { attackMotion } from './motion';
import { ARENA_HALF_WIDTH, SECTOR_SPAN, STAGES } from '../game/campaign';
import { RobotView } from './robot';
import type { RobotAssets } from './robot';
import { isBossKind, isCreature, wieldsWeapon } from '../game/bestiary';
import { loadGraphics, normalizeGraphics, saveGraphics, sceneResolution, type GraphicsSettings, type GraphicsState } from './graphics';
import { overlaps, placeCombatLabels, sameLane, SAME_LANE_DISTANCE, type LabelAnchor, type ScreenRect } from './readability';

const COLORS: Record<ActorKind, number> = {
  player: 0x62fff0,
  scout: 0xff675f,
  bruiser: 0xffb64a,
  gunner: 0xb99aff,
  drone: 0xff66ca,
  sentinel: 0x68baff,
  charger: 0xff9050,
  leaper: 0xf4d36b,
  artillery: 0xa4b7ff,
  rider: 0xffa75e,
  captain: 0xc9ed6a,
  minion: 0x9bd668,
  sniper: 0x7beaff,
  sapper: 0xffdd75,
  warden: 0xff768f,
  boss: 0xff654d,
  hound: 0xff8a5c,
  gunhound: 0xffc04d,
  roller: 0x8fd0ff,
  mauler: 0xff7d3c,
  jester: 0xe86bff,
  talon: 0x9dffe0,
  mirror: 0xff4f78,
  gargoyle: 0xffa040,
};

interface ActorView {
  robot: RobotView;
  label: Text;
  slash: Mesh3D;
  slashEdge: Mesh3D;
  charge: Mesh3D;
  danger: Mesh3D;
}

interface PropView {
  root: Container3D;
  indicator: Mesh3D;
  movers: Container3D[];
  label: Text;
}

interface EffectView {
  group: Container3D;
  meshes: Mesh3D[];
  text: Text | null;
  effect: Effect;
}

interface ProjectileView {
  root: Container3D;
  core: Mesh3D;
  target: Mesh3D;
}

/** True 3D scene, with a small Pixi 2D layer for projected combat labels. */
export class GameScene {
  readonly app: Application;
  readonly backend: string;
  private readonly host: HTMLElement;
  private readonly view: View3D;
  private readonly labels = new Container();
  private readonly stars = new Graphics();
  private readonly combatGuides = new Graphics();
  private readonly playerBeacon = new Text({ text: 'P1', style: { fontFamily: 'monospace', fontSize: 13, fontWeight: '800', fill: 0x8ffff1, stroke: { color: 0x07111c, width: 4 } } });
  private readonly scenery = new Container3D();
  private readonly stageDecor = new Container3D();
  private debugHitboxes = false;
  private debugDetails = false;
  private readability = { playerOccluded: false, playerOffscreen: false, laneTargets: 0, visibleLabels: [] as string[] };
  private readonly spawnWarnings = new Map<string, { ring: Mesh3D; label: Text }>();
  private readonly combatDebug: Mesh3D[] = [];
  private readonly debugSegments = new Map<string, Mesh3D>();
  private readonly actors = new Map<string, ActorView>();
  private readonly effects = new Map<string, EffectView>();
  private readonly hazards = new Map<string, { root: Container3D; fill: Mesh3D; progress: Mesh3D; label: Text }>();
  private readonly projectiles = new Map<string, ProjectileView>();
  private readonly props = new Map<string, PropView>();
  private readonly materials: Material3D[] = [];
  private readonly textures: Texture[] = [];
  private readonly glowCache = new Map<number, Material3D>();
  private readonly assets: RobotAssets;
  private readonly cube = new CubeGeometry();
  private readonly sphere = new SphereGeometry({ radius: 1, widthSegments: 12, heightSegments: 8 });
  private readonly cylinder = new CylinderGeometry({ radiusTop: 1, radiusBottom: 1, height: 1, radialSegments: 12 });
  private readonly ring = new TorusGeometry({ radius: 1, tube: 0.025, radialSegments: 4, tubularSegments: 32 });
  private readonly slashGeometry: Geometry3D;
  private readonly plane = new PlaneGeometry({ width: 1, height: 1, flipV: true });
  private readonly sun: DirectionalLight;
  private readonly reactor = new Container3D();
  private readonly reactorRings: Mesh3D[] = [];
  private readonly lamps: Mesh3D[] = [];
  private readonly flyingLights: Mesh3D[] = [];
  private readonly accent: Material3D;
  private readonly warningMaterial: Material3D;
  private readonly resizeObserver: ResizeObserver;
  private viewportWidth = 1;
  private viewportHeight = 1;
  private cameraX = 0;
  private currentSector = -1;
  private playerColor = -1;
  private destroyed = false;
  private graphics: GraphicsSettings;
  private readonly lightingAvailable: boolean;

  private constructor(app: Application, host: HTMLElement) {
    this.app = app;
    this.host = host;
    this.backend = app.renderer.type === RendererType.WEBGPU ? 'WebGPU' : 'WebGL2';
    const quality = new URLSearchParams(location.search).get('quality');
    // Accessing localStorage itself may throw in restricted browser contexts.
    this.graphics = loadGraphics({ getItem: (key) => localStorage.getItem(key) }, quality);
    // The beta generates a float BRDF target even for a hemisphere environment.
    const supportsFloatTargets = app.renderer.type !== RendererType.WEBGL
      || Boolean((app.renderer as WebGLRenderer).context.extensions.colorBufferFloat);
    this.lightingAvailable = supportsFloatTargets;
    this.view = new View3D({
      width: host.clientWidth || 1280,
      height: host.clientHeight || 720,
      // Isolate scene depth from the Pixi 2D background and combat labels.
      composite: true,
      // Bound PBR fragment work on software/mobile GPUs; Pixi 2D labels stay crisp.
      // Settings change 3D texels per CSS pixel independently of the UI.
      resolution: sceneResolution(this.graphics, window.devicePixelRatio),
      toneMapping: 'aces',
      exposure: 1.1,
      shadowQuality: this.graphics.shadows === 'off' ? 'low' : this.graphics.shadows,
      shadowFilter: this.graphics.shadows === 'low' || this.graphics.shadows === 'off' ? 'hard' : 'pcf',
      environment: supportsFloatTargets && this.graphics.lighting
        ? { skyColor: 0x718aa1, groundColor: 0x161f33, intensity: 0.7 }
        : null,
    });
    this.view.eventMode = 'none';
    this.labels.eventMode = 'none';
    this.stars.eventMode = 'none';
    this.combatGuides.eventMode = this.playerBeacon.eventMode = 'none';
    this.playerBeacon.anchor.set(0.5, 1);
    app.stage.addChild(this.stars, this.view, this.combatGuides, this.labels, this.playerBeacon);
    this.view.root.addChild(this.scenery);
    this.view.camera.mode = 'orthographic';
    this.view.camera.orthographicSize = 15;
    this.view.camera.near = 0.5;
    this.view.camera.far = 130;

    this.sun = new DirectionalLight({ color: 0xffe2be, intensity: 3.3, castShadow: this.graphics.shadows !== 'off' });
    this.sun.position.set(-8, 14, 9);
    this.view.root.addChild(this.sun);
    this.sun.lookAt({ x: 0, y: 0, z: 0 });
    const fill = new DirectionalLight({ color: 0x64caff, intensity: 1.6 });
    fill.position.set(8, 5, -4);
    this.view.root.addChild(fill);
    fill.lookAt({ x: 0, y: 1, z: 0 });

    const armor: Record<ActorKind, Material3D> = {
      player: this.material(0xe5e6dc, 0.48, 0.24),
      scout: this.material(0xa64440, 0.64, 0.3),
      bruiser: this.material(0xae7638, 0.53, 0.5),
      gunner: this.material(0x62517e, 0.5, 0.4),
      drone: this.material(0x8d496f, 0.47, 0.38),
      sentinel: this.material(0x375779, 0.4, 0.6),
      charger: this.material(0xad5134, 0.6, 0.4),
      leaper: this.material(0xab8d3e, 0.6, 0.3),
      artillery: this.material(0x62648b, 0.55, 0.4),
      rider: this.material(0x98653e, 0.5, 0.5),
      captain: this.material(0x6f8150, 0.5, 0.4),
      minion: this.material(0x4f7550, 0.7, 0.2),
      sniper: this.material(0x376d80, 0.5, 0.4),
      sapper: this.material(0x9e8137, 0.6, 0.35),
      warden: this.material(0x735569, 0.45, 0.6),
      boss: this.material(0x424d60, 0.42, 0.65),
      hound: this.material(0x7d4a3a, 0.55, 0.45),
      gunhound: this.material(0x6b5a34, 0.55, 0.45),
      roller: this.material(0x4a5f78, 0.4, 0.7),
      mauler: this.material(0x5c3a2c, 0.6, 0.45),
      jester: this.material(0x5a3a78, 0.5, 0.35),
      talon: this.material(0x3c6b66, 0.45, 0.5),
      mirror: this.material(0x2b2233, 0.42, 0.55),
      gargoyle: this.material(0x565a63, 0.85, 0.15),
    };
    this.assets = {
      cube: this.cube,
      sphere: this.sphere,
      cylinder: this.cylinder,
      ring: this.ring,
      joint: this.material(0x10202a, 0.8, 0.3),
      trim: this.material(0x354854, 0.42, 0.6),
      white: this.material(0xf5f5e9, 0.32, 0.25),
      flash: this.glow(0xffffff),
      shield: this.material(0x66fff2, 0.4, 0, 0.15),
      shadow: this.material(0x050b15, 1, 0, 0.28),
      armor,
      glow: Object.fromEntries(Object.entries(COLORS).map(([kind, color]) => [kind, this.glow(color)])) as Record<ActorKind, Material3D>,
    };
    // Keep player accents independent of shared environment/effect materials.
    const playerGlow = new Material3D({ baseColor: COLORS.player, emissive: { color: COLORS.player, strength: 2.4 }, roughness: 0.65, metallic: 0, doubleSided: true });
    this.materials.push(playerGlow);
    this.assets.glow.player = playerGlow;
    this.accent = this.material(0x37dcd2, 0.55, 0.2);
    this.warningMaterial = this.material(0xff654d, 0.8, 0, 0.22);
    this.slashGeometry = this.makeSlash();
    this.buildEnvironment();
    this.scenery.addChild(this.stageDecor);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
  }

  static async create(host: HTMLElement): Promise<GameScene> {
    const app = new Application();
    const params = new URLSearchParams(location.search);
    let preference: 'webgpu' | 'webgl' = 'webgl';
    if (params.get('renderer') === 'webgpu') {
      try {
        const adapter = await navigator.gpu?.requestAdapter();
        if (adapter?.features.has('indirect-first-instance')) preference = 'webgpu';
      } catch { /* WebGL2 remains the default if WebGPU cannot be requested. */ }
    }
    await app.init({
      preference,
      width: host.clientWidth || 1280,
      height: host.clientHeight || 720,
      // Composite AA adds 4x color/depth samples plus a resolve on every frame.
      antialias: params.get('quality') === 'high',
      background: 0x080f19,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoStart: false,
      powerPreference: 'high-performance',
    });
    // Pixi can fall back to Canvas even with preference: 'webgl'. Canvas renders
    // the 2D labels but cannot render View3D, so reject that fallback early.
    if (app.renderer.type !== RendererType.WEBGL && app.renderer.type !== RendererType.WEBGPU) {
      app.destroy(true, { children: true });
      throw new Error('この環境はCanvas 2D描画のみ利用できます。このデモにはWebGL 2またはWebGPUが必要です。');
    }
    // Pixi itself can fall back to WebGL 1, but @pixi/3d requires WebGL 2.
    if (app.renderer.type === RendererType.WEBGL
      && (app.renderer as WebGLRenderer).context.webGLVersion !== 2) {
      app.destroy(true, { children: true });
      throw new Error('このデモには WebGL 2 が必要です。現在のブラウザーは WebGL 1 にフォールバックしました。');
    }
    app.ticker.stop();
    app.canvas.setAttribute('aria-label', 'NULL UPRISING: 3D android combat arena');
    app.canvas.style.display = 'block';
    app.canvas.style.width = '100%';
    app.canvas.style.height = '100%';
    host.appendChild(app.canvas);
    return new GameScene(app, host);
  }

  private material(color: number, roughness = 0.7, metallic = 0.1, alpha = 1): Material3D {
    const material = new Material3D({
      baseColor: color,
      roughness,
      metallic,
      ...(alpha < 1 ? { alphaMode: 'blend' as const, alpha } : {}),
    });
    this.materials.push(material);
    return material;
  }

  private glow(color: number): Material3D {
    const existing = this.glowCache.get(color);
    if (existing) return existing;
    const material = new Material3D({
      baseColor: color,
      emissive: { color, strength: 2.4 },
      roughness: 0.65,
      metallic: 0,
      doubleSided: true,
    });
    this.glowCache.set(color, material);
    this.materials.push(material);
    return material;
  }

  private mesh(parent: Container3D, geometry: Geometry3D, material: Material3D, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): Mesh3D {
    const mesh = new Mesh3D({ geometry, material, castShadow: false });
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    parent.addChild(mesh);
    return mesh;
  }

  private box(parent: Container3D, material: Material3D, x: number, y: number, z: number, sx: number, sy: number, sz: number): Mesh3D {
    return this.mesh(parent, this.cube, material, x, y, z, sx, sy, sz);
  }

  private makeSlash(): Geometry3D {
    const positions: number[] = [];
    const normals: number[] = [];
    const indices: number[] = [];
    const segments = 24;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments;
      const a = -1.15 + t * 2.6;
      const thickness = Math.sin(t * Math.PI) * 0.19 + 0.015;
      for (const radius of [1 - thickness, 1]) {
        positions.push(Math.cos(a) * radius, Math.sin(a) * radius, 0);
        normals.push(0, 0, 1);
      }
      if (i < segments) {
        const n = i * 2;
        indices.push(n, n + 1, n + 3, n, n + 3, n + 2);
      }
    }
    return new Geometry3D({ positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) });
  }

  private sign(parent: Container3D, heading: string, subheading: string, x: number, y: number, z: number, width: number, accent: string): void {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#0a1823';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.strokeStyle = '#263b48';
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 1020, 252);
    ctx.fillStyle = accent;
    ctx.fillRect(28, 32, 7, 192);
    ctx.font = 'bold 60px monospace';
    ctx.fillText(heading, 65, 108);
    ctx.fillStyle = '#8aa5b1';
    ctx.font = '25px monospace';
    ctx.fillText(subheading, 68, 169);
    ctx.fillStyle = accent;
    for (let i = 0; i < 18; i++) ctx.fillRect(68 + i * 14, 207, i % 3 ? 5 : 9, 13);
    ctx.fillStyle = '#8aa5b1';
    ctx.font = '18px monospace';
    ctx.fillText('NEURAL NETWORK // AUTHORIZED UNITS ONLY', 410, 223);
    const texture = Texture.from(canvas);
    this.textures.push(texture);
    const material = new Material3D({
      baseColorTexture: texture,
      roughness: 0.8,
      emissive: { color: 0x384c5d, strength: 0.55 },
    });
    this.materials.push(material);
    this.mesh(parent, this.plane, material, x, y, z, width, width / 4, 1);
  }

  private buildEnvironment(): void {
    const g = this.scenery;
    const steel = this.material(0x263743, 0.77, 0.45);
    const deckA = this.material(0x35434b, 0.85, 0.2);
    const deckB = this.material(0x2d3b44, 0.9, 0.2);
    const frame = this.material(0x111d28, 0.68, 0.4);
    const dark = this.material(0x0c1825, 0.95, 0.15);
    const rubber = this.material(0x07101a, 0.95, 0);
    const yellow = this.material(0xc5a34d, 0.75, 0.15);
    const pale = this.material(0x788b90, 0.8, 0.2);
    const cyan = this.glow(0x38d7d0);
    const amber = this.glow(0xf6b756);
    const windowBlue = this.material(0x29485a, 0.5, 0.1);

    // Deck: actual beveled-looking tiers, inset panels, lane seams, blast-zone edges.
    this.box(g, frame, 0, -0.48, 0, ARENA_HALF_WIDTH * 2 + 0.4, 0.8, 9.4);
    this.box(g, steel, 0, -0.15, 0, ARENA_HALF_WIDTH * 2 + 0.1, 0.3, 9.1);
    this.box(g, frame, 0, -0.93, 0, ARENA_HALF_WIDTH * 2 - 0.5, 0.28, 8.7);
    for (let ix = 0; ix < ARENA_HALF_WIDTH; ix++) {
      for (let iz = 0; iz < 5; iz++) {
        this.box(g, (ix + iz) % 2 ? deckA : deckB, -ARENA_HALF_WIDTH + 1 + ix * 2, -0.025, -3.6 + iz * 1.8, 1.97, 0.05, 1.77);
      }
    }
    for (const z of [-2.7, -0.9, 0.9, 2.7]) this.box(g, pale, 0, 0.008, z, ARENA_HALF_WIDTH * 2 - 0.2, 0.01, 0.022);
    for (const z of [-4.38, 4.38]) {
      this.box(g, rubber, 0, 0.01, z, ARENA_HALF_WIDTH * 2, 0.03, 0.25);
      for (let i = 0; i < Math.floor(ARENA_HALF_WIDTH * 2 / 0.88); i++) {
        const strip = this.box(g, yellow, -ARENA_HALF_WIDTH + 0.35 + i * 0.88, 0.035, z, 0.38, 0.02, 0.24);
        strip.rotation.y = -0.4;
      }
      this.box(g, cyan, 0, -0.22, z + Math.sign(z) * 0.2, ARENA_HALF_WIDTH * 2 - 0.2, 0.035, 0.035);
    }
    for (const x of [-ARENA_HALF_WIDTH + 0.05, ARENA_HALF_WIDTH - 0.05]) {
      this.box(g, this.accent, x, 0.015, 0, 0.08, 0.025, 8.7);
      this.box(g, cyan, x, -0.43, 0, 0.04, 0.06, 9.1);
    }
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const x = side * (6.6 + i * 0.6);
        this.box(g, this.accent, x, 0.01, 0, 0.18, 0.012, 0.9 - i * 0.13);
      }
    }
    // Inlaid power traces stop at seams, making depth and lane movement readable.
    for (let i = 0; i < 6; i++) {
      const x = -9.5 + i * 3.8;
      const z = i % 2 ? 2.6 : -2.6;
      this.box(g, this.accent, x, 0.013, z, 1.3, 0.01, 0.045);
      this.box(g, this.accent, x + 0.65, 0.013, z - 0.3, 0.045, 0.01, 0.6);
      this.box(g, cyan, x + 0.65, 0.018, z - 0.6, 0.12, 0.025, 0.12);
    }

    // Underside trusses and suspended transit pipes.
    for (const x of [-8.5, -2.8, 2.8, 8.5]) {
      for (const z of [-3.5, 3.5]) {
        this.box(g, steel, x, -2.5, z, 0.5, 3.2, 0.5);
        this.box(g, frame, x, -1.1, z, 1, 0.3, 1);
      }
      const brace = this.box(g, frame, x, -1.5, 4.2, 0.2, 2.4, 0.25);
      brace.rotation.z = 0.8;
    }
    for (const z of [4.85, 5.25]) {
      const pipe = this.mesh(g, this.cylinder, steel, 0, -1.25, z, 0.22, 22, 0.22);
      pipe.rotation.z = Math.PI / 2;
      for (const x of [-9, -3, 3, 9]) {
        const collar = this.mesh(g, this.cylinder, yellow, x, -1.25, z, 0.27, 0.17, 0.27);
        collar.rotation.z = Math.PI / 2;
      }
    }
    for (let i = 0; i < 9; i++) this.box(g, steel, -10 + i * 2.5, -0.55, 4.73, 1.55, 0.32, 0.055);

    // Industrial server row behind the fighting lanes.
    for (const x of [-10, -8.4, -6.8, -5.2, 5.9, 7.5, 9.1, 10.7]) {
      const height = 2.4 + (Math.abs(x) % 2) * 0.35;
      this.box(g, frame, x, height / 2, -6.15, 1.25, height, 0.85);
      this.box(g, steel, x, height + 0.08, -6.15, 1.38, 0.16, 1);
      this.box(g, dark, x, height / 2, -5.7, 1.04, height - 0.3, 0.035);
      for (let j = 0; j < 5; j++) {
        this.box(g, steel, x, 0.4 + j * 0.4, -5.66, 0.8, 0.18, 0.03);
        this.box(g, j % 3 === 0 ? amber : cyan, x + 0.33, 0.4 + j * 0.4, -5.63, 0.055, 0.04, 0.03);
      }
      this.lamps.push(this.box(g, cyan, x, height + 0.19, -6.15, 0.22, 0.055, 0.3));
    }

    // Reactor gateway: layered, animated rings and a luminous central iris.
    this.reactor.position.set(1.15, 2.7, -6.5);
    g.addChild(this.reactor);
    this.box(this.reactor, frame, 0, -1.3, 0, 4.3, 2.9, 1.1);
    this.box(this.reactor, steel, 0, -2.3, 0.3, 5, 0.75, 1.5);
    for (const [radius, material] of [[2.1, steel], [1.92, cyan], [1.7, frame], [1.45, this.accent]] as const) {
      const ring = this.mesh(this.reactor, this.ring, material, 0, 0, 0.6, radius, radius, radius);
      ring.rotation.x = Math.PI / 2;
      this.reactorRings.push(ring);
    }
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      const tab = this.box(this.reactor, i % 3 === 0 ? amber : steel, Math.cos(a) * 1.9, Math.sin(a) * 1.9, 0.59, 0.35, 0.22, 0.3);
      tab.rotation.z = a;
    }
    const core = this.mesh(this.reactor, this.sphere, this.material(0x1b7f8a, 0.25, 0.6), 0, 0, 0.35, 1.3, 1.3, 0.3);
    core.castShadow = false;
    for (const i of [-1, 0, 1]) this.box(this.reactor, cyan, i * 0.36, 0, 0.68, 0.1, 1.25 - Math.abs(i) * 0.32, 0.05);
    const reactorLight = new PointLight({ color: 0x24dacb, intensity: 14, range: 12, radius: 1.5 });
    reactorLight.position.set(1.15, 3, -3);
    g.addChild(reactorLight);

    for (const z of [-4.3, 4.3]) {
      this.box(g, steel, 0, 0.25, z, ARENA_HALF_WIDTH * 2, 0.16, 0.12);
      this.box(g, cyan, 0, 0.42, z, ARENA_HALF_WIDTH * 2, 0.045, 0.07);
    }
    this.sign(g, 'NULL // SYSTEMS', 'AUTONOMOUS FOUNDRY    /    LINE 07', -6.8, 4.5, -6.6, 7, '#86f4de');
    this.sign(g, 'CONTROL IS AN ILLUSION', 'THE NETWORK REMEMBERS EVERYTHING', 6.8, 4.8, -7.2, 7.3, '#e9bb6a');

    // Cable gantries, warm worklights, and city silhouettes establish a world beyond the deck.
    for (const x of [-11.3, 11.3]) {
      this.box(g, steel, x, 3.5, -6.8, 0.4, 7.2, 0.4);
      this.box(g, yellow, x, 0.9, -6.57, 0.42, 0.8, 0.04);
      const strut = this.box(g, frame, x - Math.sign(x) * 0.5, 6.7, -6.8, 1.6, 0.25, 0.3);
      strut.rotation.z = -Math.sign(x) * 0.4;
      this.box(g, amber, x - Math.sign(x) * 1.2, 6.35, -6.8, 1.4, 0.08, 0.45);
    }
    this.box(g, frame, 0, 7.1, -6.8, 23, 0.25, 0.3);
    for (let i = 0; i < 3; i++) {
      this.box(g, rubber, 0, 6.7 - i * 0.2, -7.1, 23, 0.08, 0.08);
    }

    for (let i = 0; i < 19; i++) {
      const x = -25 + i * 2.8;
      const height = 3 + ((i * 7) % 11) * 0.7;
      const z = -15 - (i % 3) * 2.3;
      const tower = this.box(g, i % 2 ? dark : frame, x, height / 2 - 2, z, 1.7 + (i % 3) * 0.3, height, 2);
      tower.receiveShadow = false;
      this.box(g, steel, x, height - 1.9, z, 1.9, 0.14, 2.2);
      for (let j = 0; j < 4; j++) {
        if ((i + j) % 3 === 0) continue;
        this.box(g, windowBlue, x, height - 3 - j * 0.85, z + 1.03, 1.05, 0.09, 0.04);
      }
      if (i % 3 === 0) this.box(g, amber, x, height - 1.55, z, 0.06, 0.08, 0.06);
    }
    for (let i = 0; i < 9; i++) {
      const light = this.box(g, i % 3 ? cyan : amber, -16 + i * 4, 3 + (i % 4) * 1.2, -11 - (i % 3), 0.16, 0.03, 0.03);
      this.flyingLights.push(light);
    }
  }

  private makeProp(prop: ArenaProp): PropView {
    const root = new Container3D();
    root.label = `arena-${prop.kind}`;
    this.view.root.addChild(root);
    const steel = this.assets.trim, dark = this.assets.joint;
    const color = prop.kind === 'crate' || prop.kind === 'repair' ? 0x65f0b1 : prop.kind === 'conveyor' ? 0x84bfff : 0xff9f50;
    const glow = this.glow(color);
    const movers: Container3D[] = [];
    let indicator: Mesh3D;
    if (prop.kind === 'relay' || prop.kind === 'node') {
      this.box(root, steel, 0, .75, 0, .7, 1.5, .7);
      indicator = this.box(root, glow, 0, 1.5, 0, .9, .2, .9);
      this.box(root, glow, 0, 1.2, .38, .15, .35, .05);
    } else if (prop.kind === 'crate') {
      this.box(root, dark, 0, 0.5, 0, 1.1, 1, 1.1);
      for (const x of [-0.46, 0.46]) this.box(root, steel, x, 0.5, 0, 0.14, 1.07, 1.16);
      this.box(root, steel, 0, 1.03, 0, 1.1, 0.1, 1.1);
      indicator = this.box(root, glow, 0, 0.55, 0.56, 0.55, 0.12, 0.025);
      this.box(root, glow, 0, 0.55, 0.58, 0.12, 0.55, 0.025);
    } else if (prop.kind === 'barrel') {
      this.mesh(root, this.cylinder, steel, 0, 0.67, 0, 0.48, 1.35, 0.48);
      for (const y of [0.12, 1.2]) this.mesh(root, this.cylinder, dark, 0, y, 0, 0.54, 0.12, 0.54);
      indicator = this.mesh(root, this.cylinder, glow, 0, 0.72, 0, 0.49, 0.12, 0.49);
      this.box(root, glow, 0, 1.4, 0, 0.22, 0.12, 0.22);
    } else if (prop.kind === 'repair') {
      indicator = this.box(root, glow, 0, 0.75, 0, 0.6, 0.18, 0.18);
      this.box(root, glow, 0, 0.75, 0, 0.18, 0.6, 0.18);
      this.mesh(root, this.ring, glow, 0, 0.05, 0, 0.5, 0.5, 0.5);
    } else {
      this.box(root, dark, 0, 0.025, 0, prop.width, 0.05, prop.depth);
      indicator = this.box(root, glow, 0, 0.065, -prop.depth / 2, prop.width, 0.025, 0.07);
      this.box(root, glow, 0, 0.065, prop.depth / 2, prop.width, 0.025, 0.07);
      if (prop.kind === 'vent') {
        for (let i = 0; i < 5; i++) {
          const x = (i - 2) * prop.width / 5;
          this.box(root, steel, x, 0.07, 0, 0.12, 0.08, prop.depth * 0.85);
          const plume = new Container3D();
          plume.x = x;
          this.box(plume, glow, 0, 0.55, 0, 0.12, 1.1, prop.depth * 0.55);
          root.addChild(plume);
          movers.push(plume);
        }
      } else {
        for (let i = 0; i < 6; i++) {
          const arrow = new Container3D();
          for (const sign of [-1, 1]) {
            const stroke = this.box(arrow, glow, 0, 0.07, sign * 0.15, 0.38, 0.018, 0.07);
            stroke.rotation.y = sign * prop.direction * 0.75;
          }
          root.addChild(arrow);
          movers.push(arrow);
        }
      }
    }
    const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 10, fontWeight: '700', fill: color, stroke: { color: 0x071019, width: 3 }, align: 'center' } });
    label.anchor.set(0.5, 1);
    this.labels.addChild(label);
    const entry = { root, indicator, movers, label };
    this.props.set(prop.id, entry);
    return entry;
  }

  private rebuildStage(sector: number): void {
    for (const child of this.stageDecor.removeChildren()) child.destroy({ children: true });
    const stage = STAGES[sector]!, g = this.stageDecor;
    const steel = this.assets.trim, dark = this.assets.joint, glow = this.glow(stage.color);
    this.accent.baseColor = stage.color;
    this.reactor.visible = stage.theme === 'foundry' || stage.theme === 'core';
    if (stage.theme === 'transit') {
      for (const x of [-5, 0, 5]) {
        this.box(g, steel, x, 1.5, -5.2, 3.8, 3, 0.9);
        this.box(g, dark, x, 1.8, -4.72, 3.4, 1.5, 0.08);
        this.box(g, glow, x, 0.75, -4.65, 3.5, 0.1, 0.06);
        for (const side of [-1, 1]) this.box(g, glow, x + side, 2, -4.65, 0.8, 0.55, 0.06);
      }
    } else if (stage.theme === 'skybridge') {
      for (const x of [-9, -3, 3, 9]) {
        this.box(g, steel, x, 3.5, -5, 0.24, 7, 0.3);
        const cable = this.box(g, glow, x + 1.2, 4.6, -5, 0.04, 5.3, 0.04);
        cable.rotation.z = -0.5;
      }
      this.box(g, steel, 0, 7, -5, 21, 0.3, 0.4);
      this.box(g, glow, 0, 3.9, -5, 21, 0.04, 0.04);
    } else if (stage.theme === 'hive') {
      for (const x of [-8, -4, 0, 4, 8]) {
        this.mesh(g, this.cylinder, steel, x, 1.65, -5.2, 1.1, 3.3, 0.7);
        this.box(g, dark, x, 1.7, -4.5, 1.5, 2.6, 0.08);
        for (const y of [0.7, 1.7, 2.7]) this.box(g, glow, x, y, -4.4, 0.8, 0.15, 0.04);
      }
    } else if (stage.theme === 'barracks') {
      for (const x of [-11, -7, -3, 1, 5, 9]) {
        this.box(g, steel, x, 1.8, -5.1, 2.9, 3.6, 0.8);
        this.box(g, dark, x, 1.7, -4.65, 2.4, 3.1, 0.08);
        for (const y of [0.6, 1.5, 2.4]) this.box(g, glow, x, y, -4.58, 2.1, 0.07, 0.04);
      }
    } else if (stage.theme === 'gauntlet') {
      for (const x of [-11, -5.5, 0, 5.5, 11]) {
        this.box(g, steel, x, 2.8, -5, 0.4, 5.6, 0.5);
        this.box(g, glow, x, 2.8, -4.7, 0.12, 5, 0.04);
        this.box(g, steel, x, 5.6, -1, 0.4, 0.3, 8);
      }
    } else if (stage.theme === 'core') {
      for (const x of [-8, -5, 5, 8]) {
        this.box(g, dark, x, 2.8, -5.5, 1.5, 5.6, 1);
        this.box(g, glow, x, 2.8, -4.95, 0.18, 4.9, 0.05);
        this.box(g, steel, x, 5.7, -5.5, 2, 0.25, 1.2);
      }
    } else {
      for (const x of [-4, 5]) {
        this.box(g, steel, x, 2.2, -5.2, 0.45, 4.4, 0.5);
        this.box(g, glow, x, 1.2, -4.9, 0.18, 1, 0.05);
      }
    }
  }

  private updateProps(world: WorldState): void {
    const ids = new Set<string>();
    for (const prop of world.props) {
      ids.add(prop.id);
      const entry = this.props.get(prop.id) ?? this.makeProp(prop);
      entry.root.position.set(prop.x, 0, prop.z);
      entry.root.visible = prop.alive;
      const point = this.view.worldToScreen({ x: prop.x, y: prop.height + 0.5, z: prop.z });
      const objective = prop.kind === 'relay' || prop.kind === 'node';
      const danger = prop.kind === 'vent' && prop.phase !== 'idle';
      const nearby = Math.abs(prop.x - world.player.x) < 5 && Math.abs(prop.z - world.player.z) < 2.5;
      entry.label.visible = prop.alive && point !== null && world.phase !== 'ready'
        && (objective || danger || (nearby && prop.kind !== 'conveyor' && prop.kind !== 'vent') || (this.debugDetails && world.mode === 'training'));
      if (point) entry.label.position.copyFrom(point);
      const objectiveName = prop.kind === 'relay' ? '◆ 増援リレー' : prop.id.endsWith('-0') ? '◆ 砲撃制御' : '◆ 危険床制御';
      const title = objective ? `${objectiveName} ${Math.ceil(prop.hp)}` : prop.kind === 'crate' ? `修復箱 ${Math.ceil(prop.hp)}` : prop.kind === 'barrel' ? '⚠ 爆発' : prop.kind === 'repair' ? '修復 −25%' : prop.kind === 'conveyor' ? (prop.direction > 0 ? '→' : '←') : prop.phase === 'warning' ? `⚠ ${Math.max(0, 5 - prop.timer).toFixed(1)}s` : prop.phase === 'active' ? '▲ 危険 ▲' : 'VENT';
      if (entry.label.text !== title) entry.label.text = title;
      if (prop.kind === 'vent') {
        entry.indicator.material = prop.phase === 'idle' ? this.assets.trim : this.glow(0xff654d);
        entry.indicator.visible = prop.phase !== 'warning' || Math.sin(world.time * 20) > -0.2;
        entry.movers.forEach((plume, index) => {
          plume.visible = prop.phase === 'active';
          plume.scale.y = 0.8 + Math.sin(world.time * 24 + index) * 0.2;
        });
      } else if (prop.kind === 'conveyor') {
        entry.movers.forEach((arrow, index) => {
          arrow.x = (((world.time * 1.8 * prop.direction + index * 2) % prop.width + prop.width) % prop.width) - prop.width / 2;
        });
      } else if (prop.kind === 'repair') {
        entry.root.y = Math.sin(world.time * 3) * 0.1;
        entry.root.rotation.y = world.time * 1.6;
      }
    }
    for (const [id, entry] of this.props) {
      if (!ids.has(id)) { entry.root.destroy({ children: true }); entry.label.destroy(); this.props.delete(id); }
    }
  }

  getGraphics(): GraphicsState {
    const resolution = sceneResolution(this.graphics, window.devicePixelRatio);
    return { settings: { ...this.graphics }, width: Math.round(this.viewportWidth * resolution), height: Math.round(this.viewportHeight * resolution), lightingAvailable: this.lightingAvailable };
  }

  setGraphics(settings: GraphicsSettings): void {
    const previous = this.graphics;
    this.graphics = normalizeGraphics(settings);
    this.sun.castShadow = this.graphics.shadows !== 'off';
    this.view.shadowQuality = this.graphics.shadows === 'off' ? 'low' : this.graphics.shadows;
    this.view.shadowFilter = this.graphics.shadows === 'low' || this.graphics.shadows === 'off' ? 'hard' : 'pcf';
    if (previous.lighting !== this.graphics.lighting) {
      this.view.environment = this.lightingAvailable && this.graphics.lighting ? { skyColor: 0x718aa1, groundColor: 0x161f33, intensity: 0.7 } : null;
    }
    this.resize();
    saveGraphics({ setItem: (key, value) => localStorage.setItem(key, value) }, this.graphics);
  }

  resize(): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.viewportWidth = width;
    this.viewportHeight = height;
    this.view.resolution = sceneResolution(this.graphics, window.devicePixelRatio);
    this.app.renderer.resize(width, height);
    this.view.setSize(width, height);
    const aspect = width / height;
    // Keep useful vertical room in shallow landscape windows; portrait retains the arena width.
    this.view.camera.orthographicSize = Math.max(13.8, aspect * 7.7);
    this.stars.clear();
    for (let i = 0; i < 90; i++) {
      const x = ((i * 7919) % 1000) / 1000 * width;
      const y = ((i * 3571) % 1000) / 1000 * height * 0.7;
      this.stars.circle(x, y, i % 9 === 0 ? 1.2 : 0.6).fill({ color: 0x8ba8bb, alpha: i % 3 === 0 ? 0.35 : 0.16 });
    }
  }

  private makeActor(actor: Actor): ActorView {
    const robot = new RobotView(actor.kind, this.assets);
    this.view.root.addChild(robot.shadow, robot.root);
    if (robot.weaponView) this.view.root.addChild(robot.weaponView.root);
    const label = new Text({
      text: '0%',
      style: {
        fontFamily: 'monospace',
        fontSize: actor.kind === 'boss' ? 20 : isBossKind(actor.kind) ? 16 : actor.kind === 'minion' ? 12 : 14,
        fontWeight: '800',
        fill: COLORS[actor.kind],
        stroke: { color: 0x07111c, width: 4 },
        letterSpacing: 0.6,
      },
      resolution: 2,
    });
    label.anchor.set(0.5, 1);
    this.labels.addChild(label);
    // Weapon wielders trail their real blade segment; other enemies draw a stylised arc.
    const wielder = wieldsWeapon(actor.kind);
    const slash = this.mesh(this.view.root, wielder ? this.cube : this.slashGeometry, wielder ? this.material(actor.kind === 'player' ? 0x79cfff : COLORS[actor.kind], .4, 0, .16) : this.assets.glow[actor.kind], 0, 0, 0);
    const slashEdge = this.mesh(this.view.root, wielder ? this.cube : this.slashGeometry, wielder ? this.material(0xffffff, .4, 0, .08) : this.assets.flash, 0, 0, 0);
    slash.visible = slashEdge.visible = false;
    const charge = this.mesh(this.view.root, this.ring, this.assets.glow[actor.kind], 0, 0, 0);
    charge.visible = false;
    const danger = this.mesh(this.view.root, this.cube, this.warningMaterial, 0, 0.04, 0);
    danger.visible = false;
    const view = { robot, label, slash, slashEdge, charge, danger };
    this.actors.set(actor.id, view);
    return view;
  }

  toggleHitboxes(): boolean { this.debugHitboxes = !this.debugHitboxes; return this.debugHitboxes; }
  toggleDetails(): boolean { this.debugDetails = !this.debugDetails; return this.debugDetails; }
  getReadability() { return { ...this.readability, visibleLabels: [...this.readability.visibleLabels] }; }

  weaponTip(actorId: string): { x: number; y: number; z: number } | null {
    return this.actors.get(actorId)?.robot.weaponView?.tipWorld() ?? null;
  }

  /** Skeleton joints read back from the scene graph, with the solved frame they came from. */
  rigDiagnostics(actorId: string) {
    return this.actors.get(actorId)?.robot.rigDiagnostics() ?? null;
  }

  combatGeometry(actorId: string) {
    const endpoints = (mesh: Mesh3D | undefined) => {
      if (!mesh?.visible) return null;
      const matrix = worldMatrix(mesh);
      const a = new Vector3(0, -.5, 0).applyMatrix4(matrix), b = new Vector3(0, .5, 0).applyMatrix4(matrix);
      return { a: { x: a.x, y: a.y, z: a.z }, b: { x: b.x, y: b.y, z: b.z } };
    };
    return { tip: this.weaponTip(actorId), pivot: this.actors.get(actorId)?.robot.weaponView?.pivotWorld() ?? null, trail: endpoints(this.actors.get(actorId)?.slash), overlay: endpoints(this.debugSegments.get(actorId)) };
  }

  private updateCombatDebug(world: WorldState): void {
    let index = 0;
    this.debugSegments.clear();
    const mesh = () => {
      let item = this.combatDebug[index++];
      if (!item) { item = new Mesh3D({ geometry: this.cube, material: this.material(0x67ffbb, .4, 0, .18), castShadow: false }); this.view.root.addChild(item); this.combatDebug.push(item); }
      item.visible = true; return item;
    };
    if (this.debugHitboxes && world.mode === 'training') for (const actor of [world.player, ...world.enemies]) {
      if (!actor.alive) continue;
      // Enemies are drawn at the depth the player's weapon is tested against (lane assist);
      // the player's own box is the exact one enemy attacks test.
      const box = actor.kind === 'player' ? bodyHurtbox(actor) : laneAssist(bodyHurtbox(actor)), b = mesh();
      b.rotation.set(0, 0, 0); b.position.set(actor.x, (box.min.y + box.max.y) / 2, actor.z);
      b.scale.set(0.035, box.max.y - box.min.y, box.max.z - box.min.z);
      if (actor.attack?.move && actor.state === 'attack') {
        const move = actor.attack.move, frame = actor.attack.elapsed * 60;
        if (actor.attack.collision?.active) {
          const c = actor.attack.collision?.capsule ?? sampleWeapon(actor, move, frame), line = mesh(); placeSegment(line, c);
          line.position.set((c.a.x + c.b.x) / 2, (c.a.y + c.b.y) / 2, (c.a.z + c.b.z) / 2);
          this.debugSegments.set(actor.id, line);
          line.scale.x = line.scale.z = c.radius * 2;
          for (const p of [c.a, c.b]) { const end = mesh(); end.position.copyFrom(p); end.rotation.set(0, 0, 0); end.scale.set(c.radius * 2); }
        }
      }
    }
    for (; index < this.combatDebug.length; index++) this.combatDebug[index]!.visible = false;
  }

  private updateActor(actor: Actor, world: WorldState): void {
    const view = this.actors.get(actor.id) ?? this.makeActor(actor);
    view.robot.update(actor, world.time, world.loadout.weapon);
    const boss = isBossKind(actor.kind);
    // Floor warnings of large bodies are drawn wider.
    const big = actor.kind === 'boss' || actor.kind === 'warden' || actor.kind === 'gargoyle' || actor.kind === 'mauler';
    const point = this.view.worldToScreen({ x: actor.x, y: actor.y + actor.scale * (isCreature(actor.kind) ? 1.6 : boss ? 2.45 : 2.3), z: actor.z });
    const detailed = this.debugDetails && world.mode === 'training';
    const nearby = Math.abs(actor.x - world.player.x) < 7;
    view.label.visible = actor.alive && point !== null && world.phase !== 'ready' && actor.kind !== 'player'
      && (detailed || boss || actor.telegraph > 0 || actor.state === 'hurt' || (nearby && sameLane(actor, world.player)));
    if (point) view.label.position.copyFrom(point);
    const labelText = detailed
      ? `${ENEMY_NAMES[actor.kind]}${actor.tactic ? ` [${actor.tactic}]` : ''} ${Math.round(actor.damage)}%${actor.guard > 0 ? ` / GUARD ${Math.ceil(actor.guard)}` : actor.mount > 0 ? ` / MOUNT ${Math.ceil(actor.mount)}` : ''}`
      : `${actor.telegraph > 0 ? '! ' : ''}${Math.round(actor.damage)}%${actor.guard > 0 ? ' ◇' : actor.mount > 0 ? ' ▰' : ''}`;
    if (view.label.text !== labelText) view.label.text = labelText;
    view.label.style.fill = actor.damage > 110 ? 0xff695f : actor.damage > 65 ? 0xffc27b : COLORS[actor.kind];

    const attack = actor.attack;
    view.slash.visible = view.slashEdge.visible = actor.alive && attack !== null && actor.state === 'attack';
    if (attack) {
      const style = wieldsWeapon(actor.kind) ? world.loadout.weapon : big || actor.kind === 'bruiser' ? 'pile' : 'arc';
      const motion = attackMotion(attack, style);
      const strength = attack.kind === 'smash' ? 1.55 : attack.kind === 'special' ? 1.7 : 1;
      const scale = Math.min(3.8, attack.range * 0.7) * strength * (0.75 + Math.sin(motion.swing * Math.PI) * 0.25);
      const facing = attack.direction === 'back' ? -actor.facing : actor.facing;
      for (const [i, slash] of [view.slash, view.slashEdge].entries()) {
        slash.position.set(actor.x + facing * actor.scale * 0.3, actor.y + (attack.direction === 'down' ? 0.35 : actor.scale * 1.1), actor.z + 0.35 + i * 0.025);
        slash.scale.set(scale * facing * (i ? 0.94 : 1), scale * (i ? 0.94 : 1), 1);
        slash.rotation.set(motion.slashX, motion.slashY, facing * motion.slashZ);
        if (style === 'lance' && attack.direction !== 'up' && attack.direction !== 'down') {
          slash.scale.set(scale * facing, 0.16, 1);
          slash.rotation.set(0, attack.direction === 'back' ? Math.PI : 0, 0);
        }
        if (wieldsWeapon(actor.kind) && attack.move) {
          const capsule = attack.collision?.capsule ?? sampleWeapon(actor, attack.move, attack.elapsed * 60);
          placeSegment(slash, capsule);
          slash.position.set((capsule.a.x + capsule.b.x) / 2, (capsule.a.y + capsule.b.y) / 2, (capsule.a.z + capsule.b.z) / 2);
          slash.scale.x = capsule.radius * (i ? 1.8 : 2);
          slash.scale.z = capsule.radius;
        }
        slash.visible = slash.visible && motion.trail;
      }
    }
    view.danger.visible = actor.alive && actor.kind !== 'player' && actor.telegraph > 0 && actor.state === 'attack' && attack?.move?.behavior !== 'area';
    if (view.danger.visible && attack) {
      const ranged = ['projectile', 'cannon'].includes(attack.move?.behavior ?? '');
      const rush = attack.move?.behavior === 'rush';
      const radial = attack.direction === 'down';
      const length = ranged ? 13 : rush ? (actor.kind === 'hound' || actor.kind === 'talon' ? 5 : 7.5) : radial ? attack.range * 2 : attack.range;
      const angle = ranged && actor.aim ? Math.atan2(actor.aim.z - actor.z, actor.aim.x - actor.x) : actor.facing > 0 ? 0 : Math.PI;
      const width = ranged ? (actor.kind === 'boss' ? 3 : 0.42) : rush ? 1.6 : radial ? (big ? 7 : 4) : big ? 5.8 : 2.4;
      view.danger.position.set(actor.x + (radial ? 0 : Math.cos(angle) * length / 2), 0.045, actor.z + (radial ? 0 : Math.sin(angle) * length / 2));
      view.danger.scale.set(length, 0.015, width);
      view.danger.rotation.y = -angle;
      if ((attack.move?.behavior === 'mortar' || attack.move?.behavior === 'leap') && actor.aim) {
        const radius = attack.move?.behavior === 'mortar' ? 2.1 : actor.kind === 'gargoyle' ? 3 : 1.5;
        view.danger.position.set(actor.aim.x, 0.045, actor.aim.z);
        view.danger.scale.set(radius * 2, 0.015, radius * 2);
        view.danger.rotation.y = 0;
      }
    }
    view.charge.visible = actor.alive && actor.state === 'charge';
    if (view.charge.visible) {
      const s = actor.scale * (0.65 + Math.min(actor.stateTime, 1) * 0.5);
      view.charge.position.set(actor.x, actor.y + 0.1, actor.z);
      view.charge.scale.set(s, s, s);
      view.charge.rotation.y = world.time * 7;
    }
  }

  private makeEffect(effect: Effect): EffectView {
    const group = new Container3D();
    this.view.root.addChild(group);
    const material = this.glow(effect.color);
    const meshes: Mesh3D[] = [];
    let label: Text | null = null;
    if (effect.type === 'text') {
      label = new Text({
        text: effect.text ?? '',
        style: { fontFamily: 'monospace', fontWeight: '900', fontSize: 17, fill: effect.color, stroke: { color: 0x081320, width: 4 } },
        resolution: 2,
      });
      label.anchor.set(0.5);
      this.labels.addChild(label);
    } else if (['shockwave', 'spawn', 'telegraph', 'heal'].includes(effect.type)) {
      meshes.push(this.mesh(group, this.ring, material, 0, 0, 0));
      if (effect.type !== 'telegraph') meshes.push(this.mesh(group, this.ring, material, 0, 0.04, 0));
    } else {
      const count = effect.type === 'ringout' ? 16 : effect.type === 'hit' ? 7 : 2;
      for (let i = 0; i < count; i++) meshes.push(this.mesh(group, this.cube, i % 4 === 0 ? this.assets.flash : material, 0, 0, 0));
    }
    const view = { group, meshes, text: label, effect };
    this.effects.set(effect.id, view);
    return view;
  }

  private updateEffect(effect: Effect): void {
    const view = this.effects.get(effect.id) ?? this.makeEffect(effect);
    const progress = Math.max(0, Math.min(1, 1 - effect.life / Math.max(0.001, effect.duration)));
    view.group.position.set(effect.x, effect.y + 0.06, effect.z);
    if (view.text) {
      const p = this.view.worldToScreen({ x: effect.x, y: effect.y + 1 + progress * 1.8, z: effect.z });
      view.text.visible = p !== null;
      if (p) view.text.position.copyFrom(p);
      view.text.alpha = Math.min(1, (1 - progress) * 3);
      view.text.scale.set(1 + Math.sin(progress * Math.PI) * 0.12);
      return;
    }
    if (['shockwave', 'spawn', 'telegraph', 'heal'].includes(effect.type)) {
      view.meshes.forEach((mesh, i) => {
        const s = effect.size * (effect.type === 'telegraph' ? 1 : 0.2 + progress * (1 + i * 0.4));
        mesh.scale.set(s, Math.max(0.05, 1 - progress), s);
        mesh.visible = progress < 0.92 - i * 0.08;
        if (effect.type === 'spawn') mesh.y = (1 - progress) * (2.3 - i);
      });
    } else {
      view.meshes.forEach((mesh, i) => {
        const angle = i * 2.399963 + (effect.type === 'ringout' ? 0.6 : 0);
        const speed = effect.size * (0.55 + (i % 4) * 0.3);
        const distance = speed * progress * (effect.type === 'ringout' ? 3 : 1.7);
        mesh.position.set(Math.cos(angle) * distance, Math.sin(angle) * distance - progress * progress * 0.8, Math.sin(i * 7.13) * distance * 0.35);
        const size = (effect.type === 'trail' ? 0.18 : 0.08) * (1 - progress);
        mesh.scale.set(size * 0.65, size * 0.65, size + distance * 0.09);
        mesh.rotation.set(angle, angle + progress * 4, angle);
      });
    }
  }

  private updateProjectile(projectile: Projectile, time: number): void {
    let entry = this.projectiles.get(projectile.id);
    if (!entry) {
      const root = new Container3D();
      const material = this.glow(projectile.color);
      const core = this.mesh(root, this.sphere, this.assets.flash, 0, 0, 0, 0.7, 0.7, 0.7);
      this.mesh(root, this.sphere, material, 0, 0, 0, 1, 1, 1);
      this.box(root, material, -1.7, 0, 0, 3, 0.24, 0.24);
      this.view.root.addChild(root);
      const target = this.mesh(this.view.root, this.ring, this.glow(0xff9165), 0, 0.065, 0, 2.1, 1, 2.1);
      target.visible = false;
      entry = { root, core, target };
      this.projectiles.set(projectile.id, entry);
    }
    const s = Math.max(0.08, projectile.radius);
    entry.root.position.set(projectile.x, projectile.y, projectile.z);
    entry.root.scale.set(s);
    entry.root.rotation.set(0, 0, Math.atan2(projectile.vy, projectile.vx));
    entry.core.scale.set(0.7 + Math.sin(time * 30) * 0.15);
    entry.target.visible = projectile.kind === 'mortar' && Boolean(projectile.target);
    if (projectile.target) entry.target.position.set(projectile.target.x, 0.065, projectile.target.z);
  }

  private updateHazards(world: WorldState): void {
    const ids = new Set<string>();
    for (const zone of world.hazards) {
      ids.add(zone.id);
      let entry = this.hazards.get(zone.id);
      if (!entry) {
        const root = new Container3D(); this.view.root.addChild(root);
        const fill = this.box(root, this.warningMaterial, 0, 0, 0, zone.width, 0.025, zone.depth);
        const edge = this.glow(0xffb65e);
        for (const z of [-zone.depth / 2, zone.depth / 2]) this.box(root, edge, 0, 0.02, z, zone.width, 0.025, 0.045);
        for (const x of [-zone.width / 2, zone.width / 2]) this.box(root, edge, x, 0.02, 0, 0.045, 0.025, zone.depth);
        const progress = this.box(root, this.glow(0xffe1a0), 0, 0.04, 0, 1, 0.02, 0.07);
        const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 13, fill: 0xffdfab, stroke: { color: 0x101827, width: 3 } } });
        label.anchor.set(0.5); this.labels.addChild(label);
        entry = { root, fill, progress, label }; this.hazards.set(zone.id, entry);
      }
      const active = zone.elapsed >= zone.delay;
      entry.root.position.set(zone.x, 0.07, zone.z);
      entry.fill.material = active ? this.glow(0xff6555) : this.warningMaterial;
      entry.fill.scale.y = active ? 0.18 : 0.025;
      entry.progress.scale.x = zone.width * Math.min(1, zone.elapsed / zone.delay);
      const labelX = zone.width > 8 ? Math.max(zone.x - zone.width / 2 + 1, Math.min(zone.x + zone.width / 2 - 1, world.player.x - 3)) : zone.x;
      const point = this.view.worldToScreen({ x: labelX, y: 0.4, z: zone.z });
      entry.label.visible = point !== null;
      if (point) entry.label.position.copyFrom(point);
      entry.label.text = active ? '▲ 危険 ▲' : `⚠ ${this.debugDetails && world.mode === 'training' ? `${zone.pattern.toUpperCase()} ` : ''}${(zone.delay - zone.elapsed).toFixed(1)}s`;
    }
    for (const [id, entry] of this.hazards) if (!ids.has(id)) {
      entry.root.destroy({ children: true }); entry.label.destroy(); this.hazards.delete(id);
    }
  }

  private screenBounds(x: number, y: number, z: number, width: number, height: number): ScreenRect | null {
    const points = [
      this.view.worldToScreen({ x: x - width / 2, y, z }),
      this.view.worldToScreen({ x: x + width / 2, y: y + height, z }),
    ];
    if (!points[0] || !points[1]) return null;
    return { left: Math.min(points[0].x, points[1].x), right: Math.max(points[0].x, points[1].x), top: Math.min(points[0].y, points[1].y), bottom: Math.max(points[0].y, points[1].y) };
  }

  private floorRing(x: number, z: number, radius: number, color: number, strong = false): void {
    const points: number[] = [];
    for (let i = 0; i < 20; i++) {
      const angle = i / 20 * Math.PI * 2;
      const p = this.view.worldToScreen({ x: x + Math.cos(angle) * radius, y: 0.04, z: z + Math.sin(angle) * radius });
      if (!p) return;
      points.push(p.x, p.y);
    }
    this.combatGuides.poly(points).fill({ color, alpha: strong ? 0.12 : 0.035 }).stroke({ color, alpha: strong ? 0.95 : 0.6, width: strong ? 2 : 1.2 });
  }

  /** Screen-space guides remain visible behind large enemies and in low graphics mode. */
  private updateReadability(world: WorldState): void {
    this.combatGuides.clear();
    this.playerBeacon.visible = false;
    this.readability = { playerOccluded: false, playerOffscreen: false, laneTargets: 0, visibleLabels: [] };
    if (world.phase === 'ready') return;
    const p = world.player;
    const anchors: LabelAnchor[] = [];
    for (const actor of world.enemies) {
      const label = this.actors.get(actor.id)?.label;
      if (!label?.visible) continue;
      anchors.push({ id: actor.id, x: label.x, y: label.y, width: label.width, height: label.height,
        priority: (actor.telegraph > 0 ? 100 : 0) + (actor.state === 'hurt' ? 60 : 0) + (isBossKind(actor.kind) ? 80 : 0) - Math.abs(actor.x - p.x) });
    }
    const detailed = this.debugDetails && world.mode === 'training';
    const candidates = anchors.sort((a, b) => b.priority - a.priority);
    for (const omitted of candidates.slice(detailed ? candidates.length : 6)) this.actors.get(omitted.id)!.label.visible = false;
    for (const placement of placeCombatLabels(candidates.slice(0, detailed ? candidates.length : 6), this.viewportWidth, this.viewportHeight)) {
      const label = this.actors.get(placement.id)!.label;
      label.visible = placement.visible;
      label.position.set(placement.x, placement.y);
      if (placement.visible) this.readability.visibleLabels.push(label.text);
    }
    if (!p.alive) return;

    const nearZ = Math.max(-4, p.z - SAME_LANE_DISTANCE), farZ = Math.min(4, p.z + SAME_LANE_DISTANCE);
    const band = [
      this.view.worldToScreen({ x: world.arenaMin, y: 0.025, z: nearZ }),
      this.view.worldToScreen({ x: world.arenaMax, y: 0.025, z: nearZ }),
      this.view.worldToScreen({ x: world.arenaMax, y: 0.025, z: farZ }),
      this.view.worldToScreen({ x: world.arenaMin, y: 0.025, z: farZ }),
    ];
    if (band.every(Boolean)) this.combatGuides.poly(band.flatMap(point => [point!.x, point!.y])).fill({ color: 0x62fff0, alpha: 0.045 });
    for (const enemy of world.enemies) if (enemy.alive && sameLane(p, enemy) && Math.abs(enemy.x - p.x) < 7) {
      this.floorRing(enemy.x, enemy.z, 0.48 * enemy.scale, 0x8ffff1);
      this.readability.laneTargets++;
    }
    this.floorRing(p.x, p.z, 0.62, 0x62fff0, true);

    const body = this.screenBounds(p.x, p.y + 0.08, p.z, 0.95 * p.scale, 2 * p.scale);
    const head = this.view.worldToScreen({ x: p.x, y: p.y + 2.45 * p.scale, z: p.z });
    const foot = this.view.worldToScreen({ x: p.x, y: 0.04, z: p.z });
    const airborneFoot = this.view.worldToScreen({ x: p.x, y: p.y, z: p.z });
    if (p.y > 0.35 && foot && airborneFoot) {
      this.combatGuides.moveTo(foot.x, foot.y).lineTo(airborneFoot.x, airborneFoot.y).stroke({ color: 0x62fff0, alpha: 0.45, width: 1 });
    }
    if (!head || !body) return;
    const occludedByActor = world.enemies.some(enemy => {
      // A large body can cover P1 on the same lane; compare its front surface, not only its center.
      if (!enemy.alive || enemy.z + 0.5 * enemy.scale < p.z + 0.12) return false;
      const bounds = this.screenBounds(enemy.x, enemy.y, enemy.z, (enemy.kind === 'boss' || enemy.kind === 'warden' || enemy.kind === 'gargoyle' ? 1.5 : 0.85) * enemy.scale, 2.2 * enemy.scale);
      return bounds !== null && overlaps(body, bounds);
    });
    const occludedByProp = world.props.some(prop => {
      if (!prop.alive || prop.height < 0.8 || prop.z + prop.depth / 2 < p.z + 0.12) return false;
      const bounds = this.screenBounds(prop.x, 0, prop.z, prop.width, prop.height);
      return bounds !== null && overlaps(body, bounds);
    });
    this.readability.playerOccluded = occludedByActor || occludedByProp;
    if (this.readability.playerOccluded) {
      const cx = (body.left + body.right) / 2, w = body.right - body.left, h = body.bottom - body.top;
      const outline = { color: 0x8ffff1, width: 2, alpha: 0.95 };
      this.combatGuides.roundRect(cx - w * 0.28, body.top, w * 0.56, h * 0.23, 3).fill({ color: 0x62fff0, alpha: 0.1 }).stroke(outline);
      this.combatGuides.roundRect(cx - w * 0.42, body.top + h * 0.28, w * 0.84, h * 0.4, 3).fill({ color: 0x62fff0, alpha: 0.08 }).stroke(outline);
      for (const side of [-1, 1]) this.combatGuides.moveTo(cx + side * w * 0.23, body.top + h * 0.68).lineTo(cx + side * w * 0.27, body.bottom).stroke(outline);
    }
    const offscreen = head.x < 20 || head.x > this.viewportWidth - 20 || head.y < 52 || body.top > this.viewportHeight - 50;
    this.readability.playerOffscreen = offscreen;
    this.playerBeacon.visible = true;
    this.playerBeacon.text = offscreen ? `${head.x < 20 ? '◀' : head.x > this.viewportWidth - 20 ? '▶' : head.y < 52 ? '▲' : '▼'} P1` : 'P1';
    this.playerBeacon.position.set(Math.max(28, Math.min(this.viewportWidth - 28, head.x)), Math.max(70, Math.min(this.viewportHeight - 64, head.y)));
  }

  private updateSpawnWarnings(world: WorldState): void {
    const visible = new Set<string>();
    for (const spawn of world.pendingSpawns ?? []) {
      if (spawn.remaining > spawn.duration) continue;
      visible.add(spawn.id);
      let entry = this.spawnWarnings.get(spawn.id);
      if (!entry) {
        const ring = this.mesh(this.view.root, this.ring, this.glow(0xffd079), spawn.x, 0.06, spawn.z, 0.8, 1, 0.8);
        const label = new Text({ text: '', style: { fontFamily: 'monospace', fontSize: 12, fill: 0xffd079, stroke: { color: 0x07111c, width: 4 } } });
        label.anchor.set(0.5, 1); this.labels.addChild(label);
        entry = { ring, label }; this.spawnWarnings.set(spawn.id, entry);
      }
      const pulse = 0.7 + 0.12 * Math.sin(world.time * 14);
      entry.ring.position.set(spawn.x, 0.06, spawn.z); entry.ring.scale.set(pulse, 1, pulse);
      const point = this.view.worldToScreen({ x: spawn.x, y: 0.55, z: spawn.z });
      entry.label.visible = point !== null;
      if (point) entry.label.position.copyFrom(point);
      entry.label.text = `増援 ${Math.max(0, spawn.remaining).toFixed(1)}s`;
    }
    for (const [id, entry] of this.spawnWarnings) if (!visible.has(id)) {
      entry.ring.destroy(); entry.label.destroy(); this.spawnWarnings.delete(id);
    }
  }

  update(world: WorldState, dt: number): void {
    if (this.destroyed) return;
    this.updateCombatDebug(world);
    if (this.playerColor !== world.loadout.color) {
      this.playerColor = world.loadout.color;
      this.assets.glow.player.baseColor = this.playerColor;
      this.assets.glow.player.emissive!.color = this.playerColor;
    }
    if (world.sector !== this.currentSector) {
      this.currentSector = world.sector;
      this.scenery.position.x = world.sector * SECTOR_SPAN;
      this.cameraX = world.cameraX;
      this.rebuildStage(world.sector);
    }
    // Snap only on startup; smooth movement follows the engine's arena transition.
    this.cameraX += (world.cameraX - this.cameraX) * Math.min(1, dt * 7);
    const shake = this.graphics.shake ? world.shake * 0.035 : 0;
    const shakeX = Math.sin(world.time * 97) * shake;
    const shakeY = Math.cos(world.time * 113) * shake;
    this.view.camera.position.set(this.cameraX + shakeX, 13 + shakeY, 23);
    this.view.camera.lookAt({ x: this.cameraX, y: 1.1 + shakeY, z: -0.4 });
    this.sun.shadow.bounds = Box.fromCenterSize({ x: world.cameraX, y: 4, z: 0 }, { x: 30, y: 16, z: 15 });
    this.updateProps(world);
    this.updateHazards(world);

    const aliveIds = new Set<string>();
    for (const actor of [world.player, ...world.enemies]) {
      aliveIds.add(actor.id);
      this.updateActor(actor, world);
    }
    for (const [id, entry] of this.actors) {
      if (!aliveIds.has(id)) {
        entry.robot.destroy();
        entry.label.destroy();
        entry.slash.destroy();
        entry.slashEdge.destroy();
        entry.charge.destroy();
        entry.danger.destroy();
        this.actors.delete(id);
      }
    }
    this.updateReadability(world);
    this.updateSpawnWarnings(world);
    const effectIds = new Set<string>();
    const visibleEffects = this.graphics.effects === 'full' ? world.effects.slice(-65)
      : world.effects.filter((effect) => effect.type !== 'trail' && effect.type !== 'spawn').slice(-24);
    for (const effect of visibleEffects) {
      effectIds.add(effect.id);
      this.updateEffect(effect);
    }
    for (const [id, entry] of this.effects) {
      if (!effectIds.has(id)) {
        entry.group.destroy({ children: true });
        entry.text?.destroy();
        this.effects.delete(id);
      }
    }
    const projectileIds = new Set<string>();
    for (const projectile of world.projectiles) {
      projectileIds.add(projectile.id);
      this.updateProjectile(projectile, world.time);
    }
    for (const [id, entry] of this.projectiles) {
      if (!projectileIds.has(id)) {
        entry.root.destroy({ children: true });
        entry.target.destroy();
        this.projectiles.delete(id);
      }
    }
    this.reactorRings.forEach((ring, i) => {
      ring.rotation.z = world.time * (i % 2 ? -0.12 : 0.08);
      ring.scale.set((2.1 - i * 0.21) * (1 + Math.sin(world.time * 1.4 + i) * 0.01));
    });
    this.lamps.forEach((lamp, i) => { lamp.visible = Math.sin(world.time * 0.6 + i * 2.1) > -0.9; });
    this.flyingLights.forEach((light, i) => { light.x = ((world.time * (0.45 + i * 0.07) + i * 4) % 36) - 18; });
    this.app.render();
  }

  /**
   * Opt-in rendering diagnostics. Call immediately after update(), in the same
   * task, before the browser presents or clears its default drawing buffer.
   * Reads the current target without changing any framebuffer or pipeline state.
   */
  public getDiagnostics(): object {
    if (this.destroyed) return { backend: this.backend, destroyed: true };
    const renderer = this.app.renderer;
    const meshes = this.view.meshes.items;
    const scene = {
      backend: this.backend,
      viewVisible: this.view.visible,
      viewRenderable: this.view.isRenderable,
      rootVisible: this.view.root.visible,
      rootWorldVisible: Boolean(this.view.root.worldVisible),
      meshCount: meshes.length,
      actorViewCount: this.actors.size,
      weaponRootCount: this.view.root.children.filter(c => c.label === 'combat-weapon').length,
      activeMeshCount: meshes.filter((mesh) => mesh.worldVisible).length,
      appResolution: renderer.resolution,
      viewResolution: this.view.resolution,
      shadowsEnabled: this.sun.castShadow,
      environmentEnabled: this.view.environment !== null,
      graphics: { ...this.graphics },
    };
    if (renderer.type !== RendererType.WEBGL) {
      return { ...scene, webGLVersion: null, pixelSamples: [] };
    }
    const webgl = renderer as WebGLRenderer;
    const gl = webgl.gl;
    const glError = gl.getError();
    const framebufferStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const width = gl.drawingBufferWidth;
    const height = gl.drawingBufferHeight;
    const pixelSamples: { at: string; rgba: number[] }[] = [];
    const pixel = new Uint8Array(4);
    if (width > 0 && height > 0 && !gl.isContextLost()) {
      // Positions are measured from the canvas's top left; GL reads from below.
      for (const y of [0.4, 0.5, 0.6]) {
        for (const x of [0.25, 0.5, 0.75]) {
          pixel.fill(0);
          gl.readPixels(
            Math.min(width - 1, Math.floor(width * x)),
            height - 1 - Math.min(height - 1, Math.floor(height * y)),
            1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel,
          );
          pixelSamples.push({ at: `${Math.round(x * 100)}%,${Math.round(y * 100)}%`, rgba: Array.from(pixel) });
        }
      }
    }
    return {
      ...scene,
      webGLVersion: webgl.context.webGLVersion,
      colorBufferFloat: Boolean(webgl.context.extensions.colorBufferFloat),
      contextLost: gl.isContextLost(),
      drawingBuffer: [width, height],
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      defaultFramebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null,
      framebufferStatus,
      framebufferComplete: framebufferStatus === gl.FRAMEBUFFER_COMPLETE,
      glError,
      readbackError: gl.getError(),
      pixelSamples,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.view.destroy({ children: true });
    for (const material of this.materials) material.destroy();
    for (const texture of this.textures) texture.destroy(true);
    for (const geometry of [this.cube, this.sphere, this.cylinder, this.ring, this.plane, this.slashGeometry]) geometry.destroy(true);
    this.app.destroy(true, { children: true });
  }
}
