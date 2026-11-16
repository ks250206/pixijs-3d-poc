import { sampleWeapon } from '../game/combat/geometry';
import { WeaponView, worldMatrix } from './weapon';
import {
  Container3D,
  CubeGeometry,
  CylinderGeometry,
  Material3D,
  Mesh3D,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from '@pixi/3d';
import type { Actor, ActorKind, WeaponId } from '../game/types';
import { RigAnimator, type RigFrame } from './rig/animator';
import { quatMul, quatX, quatY } from './rig/math';
import type { Xform } from './rig/skeleton';

export interface RobotAssets {
  cube: CubeGeometry;
  sphere: SphereGeometry;
  cylinder: CylinderGeometry;
  ring: TorusGeometry;
  joint: Material3D;
  trim: Material3D;
  white: Material3D;
  flash: Material3D;
  shield: Material3D;
  shadow: Material3D;
  armor: Record<ActorKind, Material3D>;
  glow: Record<ActorKind, Material3D>;
}

export class RobotView {
  readonly root = new Container3D();
  readonly weaponView: WeaponView | null;
  readonly shadow = new Container3D();
  readonly marker: Mesh3D;
  readonly warning: Mesh3D;
  readonly shield: Mesh3D;
  /** Rigid bones, all direct children of `root` and placed in rig space by the solved skeleton. */
  private readonly hips = new Container3D();
  /** The chest; kind-specific torso details attach here. */
  private readonly body = new Container3D();
  private readonly head = new Container3D();
  private readonly upperArmL = new Container3D();
  private readonly upperArmR = new Container3D();
  private readonly foreL = new Container3D();
  private readonly foreR = new Container3D();
  private readonly thighL = new Container3D();
  private readonly thighR = new Container3D();
  private readonly shinL = new Container3D();
  private readonly shinR = new Container3D();
  private readonly footL = new Container3D();
  private readonly footR = new Container3D();
  /** Forearm and shin mounts keep whole-limb coordinates (origin at the shoulder / hip joint). */
  private readonly leftArm = new Container3D();
  private readonly rightArm = new Container3D();
  private readonly leftLeg = new Container3D();
  private readonly rightLeg = new Container3D();
  private readonly animator: RigAnimator | null;
  private readonly blade = new Container3D();
  private readonly hammer = new Container3D();
  private readonly fist = new Container3D();
  private readonly offhand = new Container3D();
  private readonly lance = new Container3D();
  private readonly cannon = new Container3D();
  private readonly scythe = new Container3D();
  private readonly chassisDetails = new Map<WeaponId, Container3D>();
  private readonly guardPlate = new Container3D();
  private readonly mount = new Container3D();
  private readonly boosters = new Container3D();
  private readonly mountLegs: Container3D[] = [];
  private readonly parts: { mesh: Mesh3D; material: Material3D }[] = [];
  private readonly rotors: Container3D[] = [];
  private flashed = false;
  private readonly isDrone: boolean;
  private readonly kind: ActorKind;

  constructor(kind: ActorKind, private readonly assets: RobotAssets) {
    this.kind = kind;
    this.weaponView = kind === 'player' ? new WeaponView(assets) : null;
    this.isDrone = kind === 'drone';
    this.animator = this.isDrone ? null : new RigAnimator(kind);
    this.root.label = `robot-${kind}`;
    const armor = assets.armor[kind];
    const glow = assets.glow[kind];
    if (this.isDrone) this.buildDrone(armor, glow);
    else this.buildHumanoid(armor, glow);
    this.root.addChild(this.boosters);
    for (const x of [-0.26, 0.26]) this.box(this.boosters, assets.glow.sniper, x, 0.05, -0.28, 0.14, 0.8, 0.14, false);
    this.boosters.visible = false;

    const disc = new Mesh3D({
      geometry: assets.sphere,
      material: assets.shadow,
      castShadow: false,
      receiveShadow: false,
    });
    disc.scale.set(kind === 'boss' ? 1.1 : 0.6, 0.015, kind === 'boss' ? 0.8 : 0.4);
    this.shadow.addChild(disc);

    this.marker = new Mesh3D({
      geometry: assets.ring,
      material: glow,
      castShadow: false,
      receiveShadow: false,
    });
    this.marker.scale.set(0.62, 0.45, 0.62);
    this.marker.y = 0.02;
    this.marker.visible = kind === 'player';
    this.shadow.addChild(this.marker);

    this.warning = new Mesh3D({
      geometry: assets.ring,
      material: glow,
      castShadow: false,
      receiveShadow: false,
    });
    this.warning.y = 0.035;
    this.warning.visible = false;
    this.shadow.addChild(this.warning);

    this.shield = new Mesh3D({
      geometry: assets.sphere,
      material: assets.shield,
      castShadow: false,
      receiveShadow: false,
    });
    this.shield.position.y = 1;
    this.shield.scale.set(1.1, 1.3, 1.1);
    this.shield.visible = false;
    this.root.addChild(this.shield);
  }

  private box(parent: Container3D, material: Material3D, x: number, y: number, z: number, w: number, h: number, d: number, shadow = true): Mesh3D {
    const mesh = new Mesh3D({
      geometry: this.assets.cube,
      material,
      castShadow: shadow,
      receiveShadow: true,
    });
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    parent.addChild(mesh);
    this.parts.push({ mesh, material });
    return mesh;
  }

  private ball(parent: Container3D, material: Material3D, x: number, y: number, z: number, radius: number): Mesh3D {
    const mesh = new Mesh3D({ geometry: this.assets.sphere, material, castShadow: false });
    mesh.position.set(x, y, z);
    mesh.scale.set(radius);
    parent.addChild(mesh);
    this.parts.push({ mesh, material });
    return mesh;
  }

  private buildHumanoid(armor: Material3D, glow: Material3D): void {
    const boss = this.kind === 'boss' || this.kind === 'warden';
    const heavy = boss || this.kind === 'bruiser' || this.kind === 'sentinel';
    const width = boss ? 1.12 : heavy ? 0.86 : 0.64;
    const a = this.assets;
    const spec = this.animator!.spec;
    this.root.addChild(
      this.hips, this.body, this.head, this.upperArmL, this.upperArmR, this.foreL, this.foreR,
      this.thighL, this.thighR, this.shinL, this.shinR, this.footL, this.footR,
    );
    this.foreL.addChild(this.leftArm);
    this.foreR.addChild(this.rightArm);
    this.leftArm.y = this.rightArm.y = spec.upperArm;
    this.shinL.addChild(this.leftLeg);
    this.shinR.addChild(this.rightLeg);
    this.leftLeg.y = this.rightLeg.y = spec.thigh;
    this.box(this.hips, a.joint, 0, -0.1, 0, width * 0.7, 0.4, 0.38);
    this.box(this.hips, a.trim, 0, 0.02, 0.25, width * 0.9, 0.11, 0.1, false);
    this.box(this.body, armor, 0, 0.32, 0, width, 0.68, heavy ? 0.6 : 0.44);
    const chest = this.box(this.body, glow, 0, 0.37, heavy ? 0.325 : 0.235, width * 0.28, 0.22, 0.045, false);
    chest.rotation.z = Math.PI / 4;
    this.box(this.body, a.joint, 0, 0.7, 0, 0.18, 0.17, 0.2, false);
    this.box(this.head, armor, 0, 0, 0, boss ? 0.6 : 0.44, 0.38, 0.4);
    this.box(this.head, a.joint, 0, 0.015, 0.21, boss ? 0.53 : 0.37, 0.15, 0.04, false);
    this.box(this.head, glow, 0, 0.02, 0.238, boss ? 0.45 : 0.31, 0.065, 0.025, false);
    this.box(this.head, a.trim, 0, -0.16, 0.06, 0.32, 0.085, 0.34, false);

    if (this.kind === 'player') {
      this.box(this.head, glow, -0.19, 0.13, 0, 0.05, 0.28, 0.07, false);
      this.box(this.body, a.joint, 0, 0.22, -0.3, 0.4, 0.5, 0.2);
      this.box(this.body, glow, 0, 0.2, -0.41, 0.09, 0.27, 0.035, false);
    }

    for (const [upper, fore] of [[this.upperArmL, this.leftArm], [this.upperArmR, this.rightArm]] as const) {
      this.ball(upper, a.joint, 0, 0, 0, 0.18);
      this.box(upper, armor, 0, -0.12, 0, heavy ? 0.4 : 0.25, 0.36, heavy ? 0.43 : 0.29);
      this.box(fore, a.joint, 0, -0.37, 0, 0.16, 0.18, 0.18, false);
      this.box(fore, armor, 0, -0.56, 0.04, heavy ? 0.36 : 0.22, 0.3, heavy ? 0.38 : 0.25);
      this.box(fore, glow, 0, -0.55, 0.19, 0.07, 0.18, 0.035, false);
      this.box(fore, a.joint, 0, -0.76, 0.04, heavy ? 0.3 : 0.2, 0.18, 0.25);
    }
    for (const [thigh, shin, foot] of [[this.thighL, this.leftLeg, this.footL], [this.thighR, this.rightLeg, this.footR]] as const) {
      this.ball(thigh, a.joint, 0, -0.05, 0, 0.15);
      this.box(thigh, armor, 0, -0.24, 0, heavy ? 0.31 : 0.23, 0.38, 0.3);
      this.box(shin, a.joint, 0, -0.46, 0.025, 0.18, 0.16, 0.2, false);
      this.box(shin, armor, 0, -0.63, 0.025, heavy ? 0.32 : 0.24, 0.28, 0.31);
      this.box(shin, glow, 0, -0.58, 0.19, 0.07, 0.14, 0.025, false);
      // The foot is its own bone at the ankle, so the sole stays flat while the shin leans.
      this.box(foot, a.trim, 0, 0.08 - spec.ankle, 0.13, heavy ? 0.34 : 0.28, 0.16, 0.48);
    }

    if (boss) {
      for (const sign of [-1, 1]) {
        const shoulder = this.box(this.body, armor, sign * 0.8, 0.64, -0.04, 0.55, 0.43, 0.8);
        shoulder.rotation.z = -sign * 0.14;
        this.box(this.body, glow, sign * 0.8, 0.65, 0.38, 0.32, 0.12, 0.05, false);
        this.box(this.body, a.joint, sign * 0.55, 0.77, -0.35, 0.3, 0.9, 0.3);
        this.box(this.body, glow, sign * 0.55, 1.23, -0.35, 0.2, 0.08, 0.2, false);
      }
      this.box(this.body, a.trim, 0, 0.32, -0.38, 0.95, 0.66, 0.3);
      this.box(this.rightArm, a.trim, 0, -0.6, 0.22, 0.5, 0.56, 0.65);
      this.box(this.rightArm, glow, 0, -0.6, 0.56, 0.28, 0.28, 0.04, false);
      this.box(this.leftArm, a.trim, 0, -0.6, 0.17, 0.45, 0.4, 0.55);
    } else if (this.kind === 'sniper') {
      this.box(this.rightArm, a.trim, 0, -0.6, 0.6, 0.22, 0.25, 1.7);
      this.box(this.rightArm, glow, 0, -0.6, 1.48, 0.12, 0.12, 0.07, false);
      this.box(this.rightArm, glow, 0, -0.35, 0.7, 0.12, 0.12, 0.35, false);
      this.box(this.head, armor, -0.18, 0.05, 0.22, 0.3, 0.3, 0.2);
      this.ball(this.head, glow, -0.18, 0.05, 0.35, 0.1);
    } else if (this.kind === 'sapper') {
      this.box(this.body, a.trim, 0, 0.28, -0.4, 0.8, 0.9, 0.4);
      for (const x of [-0.28, 0, 0.28]) {
        this.box(this.hips, armor, x, -0.08, 0.3, 0.22, 0.22, 0.22);
        this.box(this.hips, glow, x, -0.08, 0.43, 0.11, 0.06, 0.03, false);
      }
      this.box(this.leftArm, glow, 0, -0.7, 0.17, 0.38, 0.1, 0.38, false);
    } else if (this.kind === 'gunner') {
      this.box(this.rightArm, a.trim, 0, -0.56, 0.35, 0.25, 0.25, 0.9);
      this.box(this.rightArm, glow, 0, -0.56, 0.82, 0.16, 0.16, 0.06, false);
      this.box(this.head, glow, -0.18, 0.3, 0, 0.04, 0.4, 0.04, false);
    } else if (this.kind === 'scout') {
      this.box(this.rightArm, glow, 0, -0.63, 0.45, 0.05, 0.08, 0.9, false);
    } else if (this.kind === 'sentinel') {
      this.leftArm.addChild(this.guardPlate);
      this.box(this.guardPlate, a.trim, 0, -0.48, 0.36, 0.88, 1.35, 0.18);
      this.box(this.guardPlate, armor, 0, -0.48, 0.48, 0.73, 1.18, 0.12);
      this.box(this.guardPlate, glow, 0, -0.48, 0.56, 0.06, 1.05, 0.03, false);
      this.box(this.guardPlate, glow, 0, -0.48, 0.57, 0.6, 0.07, 0.03, false);
      this.box(this.rightArm, a.trim, 0, -0.65, 0.45, 0.2, 0.25, 0.9);
    } else if (this.kind === 'charger') {
      for (const side of [-1, 1]) {
        this.box(this.body, armor, side * 0.51, 0.6, 0.2, 0.45, 0.36, 0.5);
        this.box(this.body, glow, side * 0.51, 0.62, 0.55, 0.1, 0.12, 0.5, false);
        this.box(this.body, a.trim, side * 0.27, 0.25, -0.4, 0.22, 0.6, 0.3);
        this.box(this.body, glow, side * 0.27, 0.02, -0.58, 0.15, 0.2, 0.09, false);
      }
    } else if (this.kind === 'bruiser') {
      this.box(this.rightArm, a.trim, 0, -0.73, 0.2, 0.7, 0.6, 0.7);
      this.box(this.rightArm, glow, 0, -0.73, 0.57, 0.5, 0.12, 0.04, false);
    } else if (this.kind === 'leaper') {
      for (const leg of [this.leftLeg, this.rightLeg]) {
        this.box(leg, a.trim, 0, -0.47, -0.17, 0.34, 0.35, 0.3);
        for (const y of [-0.3, -0.42, -0.54]) this.box(leg, glow, 0, y, -0.34, 0.3, 0.04, 0.06, false);
      }
      this.box(this.head, glow, 0, 0.3, -0.1, 0.12, 0.48, 0.24, false);
    } else if (this.kind === 'artillery') {
      this.box(this.body, a.trim, 0, 0.25, -0.45, 0.9, 0.8, 0.5);
      for (const x of [-0.28, 0.28]) {
        const tube = new Mesh3D({ geometry: a.cylinder, material: armor, castShadow: false });
        tube.position.set(x, 0.95, -0.2); tube.scale.set(0.23, 1.15, 0.23); tube.rotation.x = 0.5;
        this.body.addChild(tube); this.parts.push({ mesh: tube, material: armor });
        this.ball(this.body, glow, x, 1.48, 0.07, 0.14);
      }
    } else if (this.kind === 'captain') {
      this.box(this.body, a.trim, -0.3, 0.9, -0.4, 0.08, 1.8, 0.08);
      this.box(this.body, glow, 0, 1.48, -0.4, 0.7, 0.5, 0.06, false);
      this.box(this.body, armor, 0, 1.48, -0.35, 0.5, 0.25, 0.06);
      this.box(this.head, glow, 0, 0.25, 0, 0.62, 0.11, 0.22, false);
    } else if (this.kind === 'minion') {
      this.box(this.head, glow, 0, 0.25, 0, 0.7, 0.12, 0.25, false);
      this.box(this.body, a.trim, 0, 0.24, -0.3, 0.45, 0.6, 0.22);
    } else if (this.kind === 'rider') {
      this.root.addChild(this.mount);
      this.box(this.mount, a.trim, 0, 0.67, 0, 0.95, 0.5, 1.8);
      this.box(this.mount, armor, 0, 1.02, 0.7, 0.6, 0.65, 0.6);
      this.box(this.mount, armor, 0, 1.22, 1.05, 0.55, 0.3, 0.7);
      this.box(this.mount, glow, 0, 1.25, 1.42, 0.35, 0.08, 0.04, false);
      for (const x of [-0.4, 0.4]) for (const z of [-0.6, 0.65]) {
        const leg = new Container3D(); leg.position.set(x, 0.55, z);
        this.box(leg, armor, 0, -0.2, 0, 0.2, 0.5, 0.25);
        this.box(leg, a.trim, 0, -0.47, 0.1, 0.3, 0.12, 0.45);
        this.mount.addChild(leg); this.mountLegs.push(leg);
      }
      this.box(this.rightArm, a.white, 0, -0.7, 0.9, 0.08, 0.08, 2.1, false);
      this.box(this.rightArm, glow, 0, -0.7, 1.98, 0.18, 0.15, 0.3, false);
    }

    if (this.kind === 'player') {
      this.rightArm.addChild(this.blade, this.hammer, this.fist, this.lance, this.cannon, this.scythe);
      this.blade.position.set(0, -0.74, 0.12);
      this.box(this.blade, a.trim, 0, 0, 0.2, 0.16, 0.15, 0.4, false);
      this.box(this.blade, a.white, 0, 0, 0.65, 0.075, 0.14, 0.85, false);
      this.box(this.blade, glow, 0.045, 0, 0.73, 0.025, 0.17, 1.02, false);
      this.hammer.position.set(0, -0.74, 0.08);
      this.box(this.hammer, a.joint, 0, 0, 0.45, 0.11, 0.11, 0.9, false);
      this.box(this.hammer, a.white, 0, 0, 0.82, 0.62, 0.42, 0.38, false);
      this.box(this.hammer, glow, 0, 0, 1.02, 0.5, 0.23, 0.035, false);
      this.fist.position.set(0, -0.71, 0.15);
      this.box(this.fist, a.white, 0, 0, 0.06, 0.35, 0.3, 0.4, false);
      for (const x of [-0.1, 0, 0.1]) this.box(this.fist, glow, x, 0.05, 0.48, 0.035, 0.06, 0.6, false);
      this.leftArm.addChild(this.offhand);
      this.box(this.offhand, a.white, 0, -0.71, 0.21, 0.35, 0.3, 0.4, false);
      for (const x of [-0.1, 0, 0.1]) this.box(this.offhand, glow, x, -0.66, 0.63, 0.035, 0.06, 0.6, false);

      // Long weapons follow the forearm axis, extending from the gripping hand.
      this.lance.position.set(0, -0.74, 0.12);
      this.box(this.lance, a.trim, 0, -0.5, 0, 0.085, 2.8, 0.085, false);
      this.box(this.lance, a.white, 0, -1.95, 0, 0.2, 0.62, 0.1, false);
      this.box(this.lance, glow, 0, -2.2, 0, 0.09, 0.65, 0.14, false);
      this.box(this.lance, glow, 0, -1.65, 0, 0.45, 0.07, 0.15, false);
      this.cannon.position.set(0, -0.68, 0.06);
      this.box(this.cannon, a.trim, 0, -0.28, 0, 0.56, 0.9, 0.58);
      this.box(this.cannon, a.white, 0, -0.7, 0, 0.36, 0.65, 0.4);
      this.box(this.cannon, glow, 0, -1.04, 0, 0.28, 0.05, 0.3, false);
      for (const y of [-0.15, -0.3, -0.45]) this.box(this.cannon, glow, 0.29, y, 0, 0.03, 0.06, 0.4, false);
      this.scythe.position.set(0, -0.74, 0.12);
      this.box(this.scythe, a.trim, 0, -0.38, 0, 0.1, 2.15, 0.1, false);
      for (let i = 0; i < 5; i++) {
        const blade = this.box(this.scythe, i < 3 ? a.white : glow, 0, -1.45 + i * i * 0.035, 0.23 + i * 0.24, 0.1, 0.21 - i * 0.025, 0.42 - i * 0.04, false);
        blade.rotation.x = -i * 0.16;
      }
      for (const weapon of ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'] as const) {
        const detail = new Container3D(); detail.label = `chassis-${weapon}`;
        this.body.addChild(detail); this.chassisDetails.set(weapon, detail);
        if (weapon === 'pile' || weapon === 'cannon') {
          for (const side of [-1, 1]) this.box(detail, a.white, side * 0.48, 0.5, 0, 0.42, 0.4, 0.6);
          this.box(detail, a.trim, 0, 0.25, -0.45, weapon === 'cannon' ? 0.85 : 0.65, 0.75, 0.36);
          if (weapon === 'cannon') for (const x of [-0.25, 0.25]) this.box(detail, glow, x, 0.3, -0.65, 0.12, 0.5, 0.06, false);
        } else if (weapon === 'lance') {
          this.box(detail, glow, 0, 1.3, -0.04, 0.09, 0.45, 0.4, false);
          this.box(detail, a.white, -0.48, 0.55, -0.1, 0.22, 0.7, 0.55);
        } else if (weapon === 'scythe') {
          for (const side of [-1, 1]) {
            const fin = this.box(detail, a.trim, side * 0.34, 0.1, -0.4, 0.28, 1.25, 0.12);
            fin.rotation.z = side * 0.25;
            this.box(detail, glow, side * 0.25, 1.17, 0, 0.12, 0.22, 0.12, false);
          }
        } else if (weapon === 'razor') {
          for (const side of [-1, 1]) {
            const fin = this.box(detail, glow, side * 0.4, 0.5, -0.4, 0.1, 0.65, 0.35, false);
            fin.rotation.z = side * 0.6;
          }
        } else this.box(detail, a.white, -0.47, 0.5, 0, 0.26, 0.27, 0.45);
      }
    }
  }

  private buildDrone(armor: Material3D, glow: Material3D): void {
    const a = this.assets;
    this.root.addChild(this.body);
    this.body.y = 0.8;
    this.box(this.body, armor, 0, 0, 0, 0.75, 0.45, 0.64);
    this.box(this.body, a.joint, 0, 0, 0.34, 0.55, 0.26, 0.08, false);
    this.ball(this.body, glow, 0, 0, 0.42, 0.13);
    this.box(this.body, a.trim, 0, -0.27, 0.13, 0.22, 0.25, 0.35);
    for (const side of [-1, 1]) {
      this.box(this.body, armor, side * 0.62, 0.05, 0, 0.65, 0.1, 0.22, false);
      const ring = new Mesh3D({ geometry: a.ring, material: armor, castShadow: false });
      ring.position.set(side * 0.9, 0.08, 0);
      ring.scale.set(0.42);
      this.body.addChild(ring);
      const rotor = new Container3D();
      rotor.position.copyFrom(ring.position);
      this.box(rotor, glow, 0, 0, 0, 0.7, 0.025, 0.06, false);
      this.box(rotor, glow, 0, 0, 0, 0.06, 0.025, 0.7, false);
      this.body.addChild(rotor);
      this.rotors.push(rotor);
    }
  }

  update(actor: Actor, time: number, weapon: WeaponId): void {
    const scale = actor.scale;
    this.root.position.set(actor.x, actor.y, actor.z);
    this.root.scale.set(scale);
    this.root.visible = actor.alive;
    this.boosters.visible = actor.state === 'recover' || actor.bossPhase === 'overdrive';
    this.marker.visible = actor.kind === 'player' || actor.bossPhase === 'overdrive';
    this.boosters.scale.y = 1 + Math.sin(time * 40) * 0.2;
    this.shadow.position.set(actor.x, 0.028, actor.z);
    this.shadow.scale.set(scale);
    this.shadow.visible = actor.alive && Math.abs(actor.z) < 4.5 && actor.y < 12;
    this.marker.rotation.y = time * 0.4;
    this.warning.visible = actor.telegraph > 0 && actor.attack?.move?.behavior !== 'area';
    if (this.warning.visible) {
      const radius = this.kind === 'boss' ? 1.6 : 1.1;
      const pulse = 1 + Math.sin(time * 28) * 0.06;
      this.warning.scale.set(radius * pulse, 1, radius * pulse);
    }
    this.shield.visible = actor.state === 'shield' || actor.state === 'airdodge';

    const authoritativeWeapon = this.weaponView?.update(actor) ?? false;
    if (this.kind === 'player') {
      this.blade.visible = !authoritativeWeapon && weapon === 'arc';
      this.hammer.visible = !authoritativeWeapon && weapon === 'pile';
      this.fist.visible = !authoritativeWeapon && weapon === 'razor';
      this.offhand.visible = !authoritativeWeapon && weapon === 'razor';
      this.lance.visible = !authoritativeWeapon && weapon === 'lance';
      this.cannon.visible = !authoritativeWeapon && weapon === 'cannon';
      this.scythe.visible = !authoritativeWeapon && weapon === 'scythe';
      this.chassisDetails.forEach((detail, id) => { detail.visible = weapon === id; });
    }
    this.guardPlate.visible = actor.guard > 0;

    const flash = actor.state === 'hurt' && Math.floor(actor.stateTime * 24) % 2 === 0;
    if (flash !== this.flashed) {
      for (const { mesh, material } of this.parts) mesh.material = flash ? this.assets.flash : material;
      this.flashed = flash;
    }
    if (actor.alive && actor.invulnerable > 0 && actor.state !== 'dodge' && actor.state !== 'airdodge') {
      this.root.visible = Math.floor(time * 16) % 3 !== 0;
    }

    if (!this.animator) {
      this.root.rotation.y = actor.facing * Math.PI / 2;
      this.body.y = 0.8 + Math.sin(time * 4.5) * 0.08;
      this.body.rotation.z = Math.sin(time * 2.7) * 0.05 - actor.vx * 0.02;
      this.body.rotation.x = actor.state === 'attack' ? actor.telegraph > 0 ? -0.3 : 0.45 : 0;
      for (const rotor of this.rotors) rotor.rotation.y = time * 35;
      return;
    }

    const mounted = this.kind === 'rider' && actor.mount > 0;
    this.mount.visible = mounted;
    this.mountLegs.forEach((leg, index) => { leg.rotation.x = Math.sin(time * 18 + index * Math.PI) * Math.min(0.6, Math.abs(actor.vx) * 0.08); });

    // The skeleton follows the same world segment the simulation checked this tick.
    const capsule = actor.state === 'attack' && actor.attack?.move
      ? actor.attack.collision?.capsule ?? sampleWeapon(actor, actor.attack.move, actor.attack.elapsed * 60)
      : null;
    this.apply(this.animator.update(actor, time, weapon, capsule));
  }

  private apply(frame: RigFrame): void {
    const { rig } = frame;
    // Assign whole quaternions: that is what makes them, not the Euler angles, the rotation in use.
    this.root.quaternion = quatMul(quatY(frame.yaw), quatX(frame.tumble));
    const place = (node: Container3D, bone: Xform) => {
      node.position.set(bone.p.x, bone.p.y, bone.p.z);
      node.quaternion = bone.q;
    };
    place(this.hips, rig.hips);
    place(this.body, rig.chest);
    place(this.head, rig.head);
    place(this.upperArmL, rig.upperArmL);
    place(this.foreL, rig.forearmL);
    place(this.upperArmR, rig.upperArmR);
    place(this.foreR, rig.forearmR);
    place(this.thighL, rig.thighL);
    place(this.shinL, rig.shinL);
    place(this.footL, rig.footL);
    place(this.thighR, rig.thighR);
    place(this.shinR, rig.shinR);
    place(this.footR, rig.footR);
  }

  /**
   * World positions read back from Pixi's real scene transforms (not from the solver), plus the
   * solved frame they should agree with. Lets tests prove bones stay rigid and hands stay on the weapon.
   */
  rigDiagnostics() {
    if (!this.animator?.last) return null;
    const at = (node: Container3D, x = 0, y = 0, z = 0) => {
      const p = new Vector3(x, y, z).applyMatrix4(worldMatrix(node));
      return { x: p.x, y: p.y, z: p.z };
    };
    const { spec } = this.animator;
    return {
      frame: this.animator.last,
      spec,
      joints: {
        shoulderL: at(this.upperArmL), elbowL: at(this.foreL), handL: at(this.foreL, 0, -spec.forearm, 0),
        shoulderR: at(this.upperArmR), elbowR: at(this.foreR), handR: at(this.foreR, 0, -spec.forearm, 0),
        hipL: at(this.thighL), kneeL: at(this.shinL), ankleL: at(this.footL), soleL: at(this.footL, 0, -spec.ankle, 0),
        heelL: at(this.footL, 0, -spec.ankle, -spec.heel), toeL: at(this.footL, 0, -spec.ankle, spec.toe),
        hipR: at(this.thighR), kneeR: at(this.shinR), ankleR: at(this.footR), soleR: at(this.footR, 0, -spec.ankle, 0),
        heelR: at(this.footR, 0, -spec.ankle, -spec.heel), toeR: at(this.footR, 0, -spec.ankle, spec.toe),
      },
    };
  }

  destroy(): void {
    this.weaponView?.root.destroy({ children: true });
    this.root.destroy({ children: true });
    this.shadow.destroy({ children: true });
  }
}
