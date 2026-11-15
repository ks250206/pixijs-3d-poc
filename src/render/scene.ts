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
  View3D,
} from '@pixi/3d';
import { ENEMY_NAMES, type Actor, type ActorKind, type ArenaProp, type Effect, type Projectile, type WorldState } from '../game/types';
import { attackMotion } from './motion';
import { RobotView } from './robot';
import type { RobotAssets } from './robot';

const COLORS: Record<ActorKind, number> = {
  player: 0x62fff0,
  scout: 0xff675f,
  bruiser: 0xffb64a,
  gunner: 0xb99aff,
  drone: 0xff66ca,
  sentinel: 0x68baff,
  charger: 0xff9050,
  boss: 0xff654d,
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
}

/** True 3D scene, with a small Pixi 2D layer for projected combat labels. */
export class GameScene {
  readonly app: Application;
  readonly backend: string;
  private readonly host: HTMLElement;
  private readonly view: View3D;
  private readonly labels = new Container();
  private readonly stars = new Graphics();
  private readonly scenery = new Container3D();
  private readonly actors = new Map<string, ActorView>();
  private readonly effects = new Map<string, EffectView>();
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
  private destroyed = false;

  private constructor(app: Application, host: HTMLElement) {
    this.app = app;
    this.host = host;
    this.backend = app.renderer.type === RendererType.WEBGPU ? 'WebGPU' : 'WebGL2';
    const quality = new URLSearchParams(location.search).get('quality');
    const compatibilityMode = quality === 'compat';
    const highQuality = quality === 'high';
    // The beta generates a float BRDF target even for a hemisphere environment.
    const supportsFloatTargets = app.renderer.type !== RendererType.WEBGL
      || Boolean((app.renderer as WebGLRenderer).context.extensions.colorBufferFloat);
    this.view = new View3D({
      width: host.clientWidth || 1280,
      height: host.clientHeight || 720,
      // Isolate scene depth from the Pixi 2D background and combat labels.
      composite: true,
      // Bound PBR fragment work on software/mobile GPUs; Pixi 2D labels stay crisp.
      // These are texels per CSS pixel. ?quality=high restores native scene detail
      // for comparing @pixi/3d rendering, while compat reduces the budget further.
      resolution: highQuality ? 'inherit' : compatibilityMode ? 0.6 : 0.8,
      toneMapping: 'aces',
      exposure: 1.1,
      shadowQuality: highQuality ? 'medium' : 'low',
      shadowFilter: compatibilityMode ? 'hard' : 'pcf',
      environment: supportsFloatTargets && !compatibilityMode
        ? { skyColor: 0x718aa1, groundColor: 0x161f33, intensity: 0.7 }
        : null,
    });
    this.view.eventMode = 'none';
    this.labels.eventMode = 'none';
    this.stars.eventMode = 'none';
    app.stage.addChild(this.stars, this.view, this.labels);
    this.view.root.addChild(this.scenery);
    this.view.camera.mode = 'orthographic';
    this.view.camera.orthographicSize = 15;
    this.view.camera.near = 0.5;
    this.view.camera.far = 130;

    this.sun = new DirectionalLight({ color: 0xffe2be, intensity: 3.3, castShadow: true });
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
      boss: this.material(0x424d60, 0.42, 0.65),
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
    this.accent = this.material(0x37dcd2, 0.55, 0.2);
    this.warningMaterial = this.material(0xff654d, 0.8, 0, 0.22);
    this.slashGeometry = this.makeSlash();
    this.buildEnvironment();
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
      resolution: Math.min(window.devicePixelRatio || 1, 1.5),
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
    this.box(g, frame, 0, -0.48, 0, 22.4, 0.8, 9.4);
    this.box(g, steel, 0, -0.15, 0, 22.1, 0.3, 9.1);
    this.box(g, frame, 0, -0.93, 0, 21.5, 0.28, 8.7);
    for (let ix = 0; ix < 11; ix++) {
      for (let iz = 0; iz < 5; iz++) {
        this.box(g, (ix + iz) % 2 ? deckA : deckB, -10 + ix * 2, -0.025, -3.6 + iz * 1.8, 1.97, 0.05, 1.77);
      }
    }
    for (const z of [-2.7, -0.9, 0.9, 2.7]) this.box(g, pale, 0, 0.008, z, 21.8, 0.01, 0.022);
    for (const z of [-4.38, 4.38]) {
      this.box(g, rubber, 0, 0.01, z, 22, 0.03, 0.25);
      for (let i = 0; i < 25; i++) {
        const strip = this.box(g, yellow, -10.65 + i * 0.88, 0.035, z, 0.38, 0.02, 0.24);
        strip.rotation.y = -0.4;
      }
      this.box(g, cyan, 0, -0.22, z + Math.sign(z) * 0.2, 21.8, 0.035, 0.035);
    }
    for (const x of [-10.95, 10.95]) {
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
    if (prop.kind === 'crate') {
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

  private updateProps(world: WorldState): void {
    const ids = new Set<string>();
    for (const prop of world.props) {
      ids.add(prop.id);
      const entry = this.props.get(prop.id) ?? this.makeProp(prop);
      entry.root.position.set(prop.x, 0, prop.z);
      entry.root.visible = prop.alive;
      const point = this.view.worldToScreen({ x: prop.x, y: prop.height + 0.5, z: prop.z });
      entry.label.visible = prop.alive && point !== null && world.phase !== 'ready';
      if (point) entry.label.position.copyFrom(point);
      const title = prop.kind === 'crate' ? `REPAIR BOX / ${Math.ceil(prop.hp)}` : prop.kind === 'barrel' ? '⚠ EXPLOSIVE' : prop.kind === 'repair' ? 'REPAIR −25%' : prop.kind === 'conveyor' ? (prop.direction > 0 ? 'CONVEYOR →' : '← CONVEYOR') : prop.phase === 'warning' ? `⚠ HEAT / ${Math.max(0, 5 - prop.timer).toFixed(1)}s` : prop.phase === 'active' ? '▲ HEAT ▲' : 'VENT';
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

  resize(): void {
    if (this.destroyed) return;
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.viewportWidth = width;
    this.viewportHeight = height;
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
    const label = new Text({
      text: '0%',
      style: {
        fontFamily: 'monospace',
        fontSize: actor.kind === 'boss' ? 20 : 14,
        fontWeight: '800',
        fill: COLORS[actor.kind],
        stroke: { color: 0x07111c, width: 4 },
        letterSpacing: 0.6,
      },
      resolution: 2,
    });
    label.anchor.set(0.5, 1);
    this.labels.addChild(label);
    const slash = this.mesh(this.view.root, this.slashGeometry, this.assets.glow[actor.kind], 0, 0, 0);
    const slashEdge = this.mesh(this.view.root, this.slashGeometry, this.assets.flash, 0, 0, 0);
    slash.visible = slashEdge.visible = false;
    const charge = this.mesh(this.view.root, this.ring, this.assets.glow[actor.kind], 0, 0, 0);
    charge.visible = false;
    const danger = this.mesh(this.view.root, this.cube, this.warningMaterial, 0, 0.04, 0);
    danger.visible = false;
    const view = { robot, label, slash, slashEdge, charge, danger };
    this.actors.set(actor.id, view);
    return view;
  }

  private updateActor(actor: Actor, world: WorldState): void {
    const view = this.actors.get(actor.id) ?? this.makeActor(actor);
    view.robot.update(actor, world.time, world.loadout.weapon);
    const boss = actor.kind === 'boss';
    const point = this.view.worldToScreen({ x: actor.x, y: actor.y + actor.scale * (actor.kind === 'drone' ? 1.6 : boss ? 2.45 : 2.3), z: actor.z });
    view.label.visible = actor.alive && point !== null && world.phase !== 'ready';
    if (point) view.label.position.copyFrom(point);
    const labelText = `${ENEMY_NAMES[actor.kind]}  ${Math.round(actor.damage)}%${actor.guard > 0 ? `\n▰ GUARD ${Math.ceil(actor.guard)}` : ''}`;
    if (view.label.text !== labelText) view.label.text = labelText;
    view.label.style.fill = actor.damage > 110 ? 0xff695f : actor.damage > 65 ? 0xffc27b : COLORS[actor.kind];

    const attack = actor.attack;
    view.slash.visible = view.slashEdge.visible = actor.alive && attack !== null && actor.state === 'attack';
    if (attack) {
      const style = actor.kind === 'player' ? world.loadout.weapon : actor.kind === 'boss' || actor.kind === 'bruiser' ? 'pile' : 'arc';
      const motion = attackMotion(attack, style);
      const strength = attack.kind === 'smash' ? 1.55 : attack.kind === 'special' ? 1.7 : 1;
      const scale = Math.min(3.8, attack.range * 0.7) * strength * (0.75 + Math.sin(motion.swing * Math.PI) * 0.25);
      const facing = attack.direction === 'back' ? -actor.facing : actor.facing;
      for (const [i, slash] of [view.slash, view.slashEdge].entries()) {
        slash.position.set(actor.x + facing * actor.scale * 0.3, actor.y + (attack.direction === 'down' ? 0.35 : actor.scale * 1.1), actor.z + 0.35 + i * 0.025);
        slash.scale.set(scale * facing * (i ? 0.94 : 1), scale * (i ? 0.94 : 1), 1);
        slash.rotation.set(motion.slashX, motion.slashY, facing * motion.slashZ);
        slash.visible = slash.visible && motion.trail;
      }
    }
    view.danger.visible = actor.alive && actor.kind !== 'player' && actor.telegraph > 0 && actor.state === 'attack';
    if (view.danger.visible && attack) {
      const ranged = attack.name.includes('SHOT') || attack.name.includes('LASER');
      const rush = attack.name === 'RAIL CHARGE' || attack.name === 'SHOCK DIVE';
      const radial = attack.direction === 'down';
      const length = ranged ? 13 : rush ? 7.5 : radial ? attack.range * 2 : attack.range;
      const angle = ranged && actor.aim ? Math.atan2(actor.aim.z - actor.z, actor.aim.x - actor.x) : actor.facing > 0 ? 0 : Math.PI;
      const width = ranged ? (boss ? 3 : 0.42) : rush ? 1.6 : radial ? (boss ? 7 : 4) : boss ? 5.8 : 2.4;
      view.danger.position.set(actor.x + (radial ? 0 : Math.cos(angle) * length / 2), 0.045, actor.z + (radial ? 0 : Math.sin(angle) * length / 2));
      view.danger.scale.set(length, 0.015, width);
      view.danger.rotation.y = -angle;
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
      entry = { root, core };
      this.projectiles.set(projectile.id, entry);
    }
    const s = Math.max(0.08, projectile.radius);
    entry.root.position.set(projectile.x, projectile.y, projectile.z);
    entry.root.scale.set(s);
    entry.root.rotation.set(0, 0, Math.atan2(projectile.vy, projectile.vx));
    entry.core.scale.set(0.7 + Math.sin(time * 30) * 0.15);
  }

  update(world: WorldState, dt: number): void {
    if (this.destroyed) return;
    if (world.sector !== this.currentSector) {
      this.currentSector = world.sector;
      this.scenery.position.x = world.sector * 28;
      this.cameraX = world.cameraX;
      this.accent.baseColor = [0x37dcd2, 0x8e86d5, 0xd8854b][world.sector] ?? 0x37dcd2;
    }
    // Snap only on startup; smooth movement follows the engine's arena transition.
    this.cameraX += (world.cameraX - this.cameraX) * Math.min(1, dt * 7);
    const shake = world.shake * 0.035;
    const shakeX = Math.sin(world.time * 97) * shake;
    const shakeY = Math.cos(world.time * 113) * shake;
    this.view.camera.position.set(this.cameraX + shakeX, 13 + shakeY, 23);
    this.view.camera.lookAt({ x: this.cameraX, y: 1.1 + shakeY, z: -0.4 });
    this.sun.shadow.bounds = Box.fromCenterSize({ x: world.cameraX, y: 4, z: 0 }, { x: 30, y: 16, z: 15 });
    this.updateProps(world);

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
    const effectIds = new Set<string>();
    for (const effect of world.effects.slice(-65)) {
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
      activeMeshCount: meshes.filter((mesh) => mesh.worldVisible).length,
      appResolution: renderer.resolution,
      viewResolution: this.view.resolution,
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
