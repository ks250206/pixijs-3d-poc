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
import { isCreature, wieldsWeapon } from '../game/bestiary';
import { RigAnimator, type RigFrame } from './rig/animator';
import { quatMul, quatX, quatY, rotate } from './rig/math';
import { isHeavyFrame, type Xform } from './rig/skeleton';

const damp = (value: number, target: number, rate: number, dt: number) => target + (value - target) * Math.exp(-rate * dt);

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
  /** Razor gauntlets, one per forearm; the claws themselves are the weapon. */
  private readonly gauntlets = [new Container3D(), new Container3D()];
  private readonly chassisDetails = new Map<WeaponId, Container3D>();
  private readonly guardPlate = new Container3D();
  private readonly mount = new Container3D();
  private readonly boosters = new Container3D();
  private readonly mountLegs: Container3D[] = [];
  private readonly parts: { mesh: Mesh3D; material: Material3D }[] = [];
  private readonly rotors: Container3D[] = [];
  private flashed = false;
  private readonly kind: ActorKind;
  /** Moving parts of the machines that have no humanoid skeleton, and of the gargoyle's wings. */
  private readonly legs: Container3D[] = [];
  private readonly wings: Container3D[] = [];
  private readonly jaw = new Container3D();
  private readonly gun = new Container3D();
  private readonly wheel = new Container3D();
  private readonly turret = new Container3D();
  private lastTime = NaN;
  private yaw = NaN;
  /** 0 while a roller is a wheel, 1 once it stands unfolded. */
  private unfold = 0;
  private roll = 0;

  constructor(kind: ActorKind, private readonly assets: RobotAssets) {
    this.kind = kind;
    // The mirror carries the run's weapon too, in its own colours.
    this.weaponView = wieldsWeapon(kind)
      ? new WeaponView(kind === 'player' ? assets : { ...assets, white: assets.armor[kind], glow: { ...assets.glow, player: assets.glow[kind] } })
      : null;
    this.animator = isCreature(kind) ? null : new RigAnimator(kind);
    this.root.label = `robot-${kind}`;
    const armor = assets.armor[kind];
    const glow = assets.glow[kind];
    if (kind === 'drone') this.buildDrone(armor, glow);
    else if (kind === 'hound' || kind === 'gunhound') this.buildHound(armor, glow);
    else if (kind === 'roller') this.buildRoller(armor, glow);
    else if (kind === 'talon') this.buildTalon(armor, glow);
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
    disc.scale.set(kind === 'boss' ? 1.1 : 0.6, 0.015, kind === 'boss' ? 0.8 : kind === 'hound' || kind === 'gunhound' ? 0.75 : 0.4);
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
    const heavy = isHeavyFrame(this.kind);
    const width = boss ? 1.12 : heavy ? 0.86 : 0.64;
    const wielder = wieldsWeapon(this.kind);
    // The mirror wears the player's plating in its own dark finish.
    const a = this.kind === 'mirror' ? { ...this.assets, white: this.assets.trim } : this.assets;
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

    if (wielder) {
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
    } else if (this.kind === 'mauler') {
      // A knuckle-walker's build: a humped back, slab shoulders and fists the size of its head.
      this.box(this.body, armor, 0, 0.6, -0.32, 1.1, 0.62, 0.7);
      this.box(this.body, glow, 0, 0.6, -0.69, 0.5, 0.1, 0.04, false);
      for (const side of [-1, 1]) this.box(this.body, armor, side * 0.66, 0.58, 0.02, 0.5, 0.5, 0.7);
      this.box(this.head, a.trim, 0, 0.13, 0.17, 0.5, 0.11, 0.22);
      this.box(this.head, a.trim, 0, -0.2, 0.2, 0.36, 0.14, 0.2);
      for (const arm of [this.leftArm, this.rightArm]) {
        this.box(arm, armor, 0, -0.56, 0.04, 0.6, 0.5, 0.64);
        this.box(arm, a.trim, 0, -0.9, 0.08, 0.7, 0.36, 0.74);
        this.box(arm, glow, 0, -0.9, 0.46, 0.44, 0.1, 0.04, false);
      }
    } else if (this.kind === 'jester') {
      // Nothing matches: two drooping horns, a blade on each wrist and a ragged coat-tail.
      for (const side of [-1, 1]) {
        const horn = this.box(this.head, glow, side * 0.24, 0.32, -0.02, 0.07, 0.46 + (side > 0 ? 0.18 : 0), 0.07, false);
        horn.rotation.z = -side * 0.6;
        this.ball(this.head, glow, side * (side > 0 ? 0.47 : 0.4), side > 0 ? 0.56 : 0.48, -0.02, 0.07);
        this.box(side > 0 ? this.rightArm : this.leftArm, glow, 0, -0.68, 0.44, 0.04, 0.08, 0.86, false);
      }
      const coat = this.box(this.body, a.trim, 0, -0.1, -0.3, 0.42, 0.75, 0.08);
      coat.rotation.x = 0.35;
      const diamond = this.box(this.body, glow, 0.14, 0.12, 0.235, 0.14, 0.14, 0.03, false);
      diamond.rotation.z = Math.PI / 4;
    } else if (this.kind === 'gargoyle') {
      // Horned head, folded stone wings, a tail and a halberd as tall as the player.
      for (const side of [-1, 1]) {
        const horn = this.box(this.head, a.trim, side * 0.2, 0.3, -0.06, 0.09, 0.4, 0.09);
        horn.rotation.z = -side * 0.35;
        this.box(this.body, armor, side * 0.64, 0.62, 0, 0.46, 0.38, 0.62);
        const wing = new Container3D();
        wing.position.set(side * 0.28, 0.66, -0.36);
        this.box(wing, a.joint, side * 0.6, 0.3, 0, 1.2, 0.1, 0.1);
        this.box(wing, armor, side * 0.55, -0.12, -0.02, 1.05, 0.78, 0.05);
        this.box(wing, armor, side * 1.28, -0.2, -0.02, 0.46, 1.05, 0.05);
        this.box(wing, glow, side * 1.1, 0.3, 0.02, 0.5, 0.05, 0.06, false);
        this.body.addChild(wing); this.wings.push(wing);
      }
      this.box(this.head, armor, 0, -0.06, 0.27, 0.26, 0.2, 0.2);
      this.box(this.hips, armor, 0, -0.14, -0.46, 0.2, 0.2, 0.72);
      this.box(this.hips, a.trim, 0, -0.26, -0.98, 0.14, 0.14, 0.5);
      this.ball(this.hips, glow, 0, -0.3, -1.28, 0.12);
      this.box(this.rightArm, a.trim, 0, -0.7, 0.55, 0.08, 0.08, 2.7);
      this.box(this.rightArm, a.white, 0, -0.62, 1.72, 0.06, 0.6, 0.5);
      this.box(this.rightArm, glow, 0, -0.7, 2.0, 0.05, 0.12, 0.34, false);
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

    if (wielder) {
      for (const [index, arm] of [this.leftArm, this.rightArm].entries()) {
        const gauntlet = this.gauntlets[index]!;
        arm.addChild(gauntlet);
        this.box(gauntlet, a.white, 0, -0.7, 0.05, 0.32, 0.3, 0.36, false);
        this.box(gauntlet, glow, 0, -0.86, 0.05, 0.24, 0.03, 0.26, false);
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

  /** A four-legged guard machine: long body, snapping jaw, and (on the gun hound) a turret on its back. */
  private buildHound(armor: Material3D, glow: Material3D): void {
    const a = this.assets;
    this.root.addChild(this.body);
    this.body.y = 0.62;
    this.box(this.body, armor, 0, 0, 0, 0.44, 0.34, 1.02);
    this.box(this.body, a.joint, 0, -0.02, 0.02, 0.3, 0.4, 0.5, false);
    this.box(this.body, glow, 0, 0.18, -0.1, 0.08, 0.03, 0.7, false);
    this.body.addChild(this.head);
    this.head.position.set(0, 0.14, 0.56);
    this.box(this.head, armor, 0, 0.04, 0.16, 0.32, 0.26, 0.4);
    this.box(this.head, a.trim, 0, 0.0, 0.42, 0.22, 0.14, 0.24);
    this.box(this.head, glow, 0, 0.09, 0.365, 0.26, 0.06, 0.03, false);
    for (const side of [-1, 1]) {
      const ear = this.box(this.head, a.trim, side * 0.13, 0.22, 0.04, 0.06, 0.2, 0.1, false);
      ear.rotation.z = -side * 0.25;
    }
    this.head.addChild(this.jaw);
    this.jaw.position.set(0, -0.08, 0.2);
    this.box(this.jaw, a.joint, 0, -0.03, 0.16, 0.2, 0.06, 0.32);
    this.box(this.jaw, glow, 0, 0.01, 0.26, 0.16, 0.03, 0.1, false);
    for (const x of [-0.2, 0.2]) for (const z of [0.36, -0.36]) {
      const leg = new Container3D();
      leg.position.set(x, -0.06, z);
      this.box(leg, armor, 0, -0.14, 0, 0.13, 0.32, 0.16);
      this.box(leg, a.joint, 0, -0.38, 0.03, 0.1, 0.26, 0.12);
      this.box(leg, a.trim, 0, -0.53, 0.07, 0.14, 0.07, 0.22, false);
      this.body.addChild(leg); this.legs.push(leg);
    }
    const tail = this.box(this.body, glow, 0, 0.16, -0.62, 0.05, 0.05, 0.36, false);
    tail.rotation.x = -0.6;
    if (this.kind === 'gunhound') {
      this.body.addChild(this.gun);
      this.gun.position.set(0, 0.27, -0.06);
      this.box(this.gun, a.trim, 0, 0.04, 0, 0.26, 0.2, 0.46);
      this.box(this.gun, a.joint, 0.2, 0.02, -0.06, 0.16, 0.22, 0.22);
      for (const x of [-0.07, 0.07]) {
        this.box(this.gun, a.joint, x, 0.07, 0.5, 0.06, 0.06, 0.62, false);
        this.box(this.gun, glow, x, 0.07, 0.82, 0.07, 0.07, 0.04, false);
      }
    }
  }

  /** A wheel that unfolds: curled plating while it rolls, three legs and twin blasters once it stands. */
  private buildRoller(armor: Material3D, glow: Material3D): void {
    const a = this.assets;
    this.root.addChild(this.wheel, this.turret);
    this.wheel.y = 0.66;
    const rim = new Mesh3D({ geometry: a.ring, material: a.joint, castShadow: false });
    rim.scale.set(0.66); rim.rotation.z = Math.PI / 2;
    this.wheel.addChild(rim); this.parts.push({ mesh: rim, material: a.joint });
    for (let i = 0; i < 8; i++) {
      const plate = new Container3D();
      plate.rotation.x = (i / 8) * Math.PI * 2;
      this.box(plate, i % 2 ? a.trim : armor, 0, 0.55, 0, 0.5, 0.14, 0.44);
      if (i % 2 === 0) this.box(plate, glow, 0, 0.63, 0, 0.3, 0.02, 0.1, false);
      this.wheel.addChild(plate);
    }
    this.ball(this.wheel, glow, 0.27, 0, 0, 0.13);
    this.ball(this.wheel, glow, -0.27, 0, 0, 0.13);
    this.box(this.wheel, a.joint, 0, 0, 0, 0.5, 0.3, 0.3, false);

    for (const [x, z] of [[0, 0.5], [-0.46, -0.3], [0.46, -0.3]] as const) {
      const leg = this.box(this.turret, a.trim, x * 0.6, 0.3, z * 0.6, 0.1, 0.72, 0.1);
      leg.rotation.z = -x * 0.9; leg.rotation.x = z * 0.9;
      this.box(this.turret, a.joint, x, 0.04, z, 0.2, 0.08, 0.2, false);
    }
    this.box(this.turret, armor, 0, 0.82, 0, 0.5, 0.42, 0.46);
    this.box(this.turret, a.joint, 0, 1.12, 0.02, 0.26, 0.2, 0.26);
    this.ball(this.turret, glow, 0, 1.13, 0.16, 0.08);
    for (const side of [-1, 1]) {
      this.box(this.turret, a.trim, side * 0.4, 0.84, 0.16, 0.16, 0.18, 0.7);
      this.box(this.turret, a.joint, side * 0.4, 0.84, 0.62, 0.09, 0.09, 0.34, false);
      this.box(this.turret, glow, side * 0.4, 0.84, 0.8, 0.1, 0.1, 0.04, false);
      const plate = this.box(this.turret, armor, side * 0.3, 0.5, -0.2, 0.3, 0.5, 0.08);
      plate.rotation.y = side * 0.5;
    }
    this.turret.scale.set(0);
  }

  /** A raptor: hooked beak, swept wings and talons it leads with when it stoops. */
  private buildTalon(armor: Material3D, glow: Material3D): void {
    const a = this.assets;
    this.root.addChild(this.body);
    this.body.y = 0.8;
    this.box(this.body, armor, 0, 0, 0, 0.36, 0.34, 0.72);
    this.box(this.body, a.joint, 0, -0.12, 0.05, 0.26, 0.16, 0.5, false);
    this.box(this.body, glow, 0, 0.18, 0.0, 0.07, 0.03, 0.5, false);
    this.body.addChild(this.head);
    this.head.position.set(0, 0.2, 0.42);
    this.box(this.head, armor, 0, 0, 0, 0.25, 0.23, 0.3);
    this.box(this.head, a.trim, 0, -0.03, 0.24, 0.1, 0.1, 0.24);
    const hook = this.box(this.head, glow, 0, -0.1, 0.36, 0.07, 0.14, 0.07, false);
    hook.rotation.x = 0.5;
    for (const side of [-1, 1]) {
      this.ball(this.head, glow, side * 0.13, 0.04, 0.08, 0.05);
      const wing = new Container3D();
      wing.position.set(side * 0.18, 0.1, 0.05);
      this.box(wing, armor, side * 0.44, 0, 0, 0.82, 0.05, 0.44);
      this.box(wing, a.trim, side * 1.06, 0, -0.06, 0.56, 0.04, 0.34);
      for (const z of [-0.2, 0, 0.16]) this.box(wing, glow, side * 1.38, 0, z - 0.06, 0.16, 0.025, 0.07, false);
      this.body.addChild(wing); this.wings.push(wing);
      const leg = new Container3D();
      leg.position.set(side * 0.12, -0.18, 0.06);
      this.box(leg, a.joint, 0, -0.14, 0, 0.06, 0.3, 0.06, false);
      this.box(leg, glow, 0, -0.31, 0.07, 0.12, 0.04, 0.2, false);
      this.body.addChild(leg); this.legs.push(leg);
    }
    const tail = this.box(this.body, a.trim, 0, 0.02, -0.52, 0.42, 0.04, 0.42);
    tail.rotation.x = 0.2;
  }

  /** Procedural motion for the machines without a humanoid skeleton. */
  private animateCreature(actor: Actor, time: number, dt: number): void {
    const heading = actor.facing * Math.PI / 2;
    this.yaw = Number.isFinite(this.yaw) && dt > 0 ? damp(this.yaw, heading, 22, dt) : heading;
    this.root.rotation.y = this.yaw;
    const attack = actor.state === 'attack' ? actor.attack : null;
    const winding = !!attack && actor.telegraph > 0;
    const speed = Math.hypot(actor.vx, actor.vz);
    const hurt = actor.state === 'hurt';
    if (this.kind === 'drone') {
      this.body.y = 0.8 + Math.sin(time * 4.5) * 0.08;
      this.body.rotation.z = Math.sin(time * 2.7) * 0.05 - actor.vx * 0.02;
      this.body.rotation.x = attack ? actor.telegraph > 0 ? -0.3 : 0.45 : 0;
      for (const rotor of this.rotors) rotor.rotation.y = time * 35;
    } else if (this.kind === 'hound' || this.kind === 'gunhound') {
      const stride = Math.min(1, speed / 4), pounce = attack?.move?.behavior === 'rush';
      const leaping = pounce && !winding && attack!.elapsed < attack!.activeEnd;
      // Crouch through the wind-up, stretch out through the leap.
      this.body.y = 0.62 + (winding && pounce ? -0.14 : leaping ? 0.2 : Math.abs(Math.sin(time * 11)) * 0.05 * stride);
      this.body.rotation.x = winding && pounce ? 0.22 : leaping ? -0.25 : hurt ? -0.5 : 0;
      this.legs.forEach((leg, index) => {
        const front = index % 2 === 0, diagonal = index === 0 || index === 3 ? 0 : Math.PI;
        leg.rotation.x = leaping ? (front ? -1.0 : 1.0) : winding && pounce ? (front ? 0.5 : -0.5) : Math.sin(time * 13 + diagonal) * 0.75 * stride;
      });
      this.jaw.rotation.x = attack && !winding && this.kind === 'hound' ? 0.75 : winding ? 0.3 + Math.sin(time * 30) * 0.08 : 0.05;
      this.head.rotation.x = winding ? -0.2 : 0;
      this.gun.position.z = -0.06 - (attack?.collision && !winding && attack.elapsed < attack.activeEnd + 0.06 ? 0.14 : 0);
    } else if (this.kind === 'roller') {
      const id = attack?.move?.id;
      const target = id === 'roller.deploy' ? 1 : id === 'roller.fold' ? 0 : actor.form === 'deployed' ? 1 : 0;
      this.unfold = dt > 0 ? damp(this.unfold, target, 9, dt) : target;
      const u = this.unfold;
      this.roll += actor.vx * actor.facing * dt / 0.66;
      this.wheel.rotation.x = this.roll;
      this.wheel.scale.set(1 - u * 0.85);
      this.wheel.y = 0.66 + u * 0.2;
      this.wheel.visible = u < 0.95;
      this.turret.scale.set(u);
      this.turret.visible = u > 0.05;
      this.turret.rotation.x = attack?.move?.id === 'roller.twin' && !winding && attack.elapsed < attack.activeEnd + 0.08 ? -0.12 : hurt ? -0.3 : 0;
    } else if (this.kind === 'talon') {
      const id = attack?.move?.id ?? '';
      const stoop = id === 'talon.dive', flurry = id === 'talon.peck' || id === 'talon.rend', spent = actor.form === 'spent';
      const rate = flurry ? 30 : spent ? 5 : stoop ? 0 : 11;
      const sweep = stoop && !winding ? -1.0 : 0;
      this.wings.forEach((wing, index) => {
        const side = index ? 1 : -1;
        wing.rotation.z = side * (stoop ? (winding ? -0.9 : -0.2) : Math.sin(time * rate) * (flurry ? 0.45 : spent ? 0.25 : 0.6) + (spent ? 0.35 : 0));
        wing.rotation.y = side * sweep;
      });
      this.body.y = 0.8 + (stoop || flurry ? 0 : Math.sin(time * rate) * 0.07);
      this.body.rotation.x = stoop ? (winding ? -0.5 : 0.7) : flurry ? -0.75 + Math.sin(time * 40) * 0.12 : spent ? 0.3 : hurt ? -0.6 : 0.08;
      this.head.rotation.x = winding ? -0.5 : flurry ? 0.7 : 0;
      for (const leg of this.legs) leg.rotation.x = flurry ? -1.2 + Math.sin(time * 40) * 0.5 : stoop && !winding ? -0.9 : 0.5;
    }
  }

  update(actor: Actor, time: number, weapon: WeaponId): void {
    const dt = Number.isFinite(this.lastTime) ? Math.max(0, Math.min(0.1, time - this.lastTime)) : 0;
    this.lastTime = time;
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
      const radius = this.kind === 'boss' || this.kind === 'gargoyle' || this.kind === 'mauler' ? 1.6 : 1.1;
      const pulse = 1 + Math.sin(time * 28) * 0.06;
      this.warning.scale.set(radius * pulse, 1, radius * pulse);
    }
    // A dodge is purely positional now; only an actual shield shows the bubble.
    this.shield.visible = actor.state === 'shield';

    if (wieldsWeapon(this.kind)) {
      for (const gauntlet of this.gauntlets) gauntlet.visible = weapon === 'razor';
      this.chassisDetails.forEach((detail, id) => { detail.visible = weapon === id; });
    }
    this.guardPlate.visible = actor.guard > 0;

    const flash = actor.state === 'hurt' && Math.floor(actor.stateTime * 24) % 2 === 0;
    if (flash !== this.flashed) {
      for (const { mesh, material } of this.parts) mesh.material = flash ? this.assets.flash : material;
      this.flashed = flash;
    }
    if (actor.alive && actor.invulnerable > 0) {
      this.root.visible = Math.floor(time * 16) % 3 !== 0;
    }

    if (this.weaponView) this.weaponView.root.visible = false;
    if (!this.animator) {
      this.animateCreature(actor, time, dt);
      return;
    }
    if (this.wings.length) {
      // Folded along the back on foot; spread and beating in the air.
      const aloft = actor.form === 'airborne' || actor.y > 0.4;
      this.wings.forEach((wing, index) => {
        const side = index ? 1 : -1;
        wing.rotation.y = side * (aloft ? -0.15 : -1.15);
        wing.rotation.z = side * (aloft ? Math.sin(time * 7) * 0.5 + 0.1 : -0.25 + Math.sin(time * 1.7) * 0.03);
      });
    }

    const mounted = this.kind === 'rider' && actor.mount > 0;
    this.mount.visible = mounted;
    this.mountLegs.forEach((leg, index) => { leg.rotation.x = Math.sin(time * 18 + index * Math.PI) * Math.min(0.6, Math.abs(actor.vx) * 0.08); });

    // The skeleton follows the same world segment the simulation checked this tick.
    const capsule = actor.state === 'attack' && actor.attack?.move
      ? actor.attack.collision?.capsule ?? sampleWeapon(actor, actor.attack.move, actor.attack.elapsed * 60)
      : null;
    const frame = this.animator.update(actor, time, weapon, capsule);
    this.apply(frame);
    if (this.weaponView && frame.held) {
      const held = frame.held;
      const rootQ = quatMul(quatY(frame.yaw), quatX(frame.tumble));
      const toWorld = (p: { x: number; y: number; z: number }) => {
        const r = rotate(rootQ, p);
        return { x: actor.x + r.x * scale, y: actor.y + r.y * scale, z: actor.z + r.z * scale };
      };
      // On hit frames the weapon is laid on the very capsule the simulation checked.
      const exact = held.live && capsule;
      this.weaponView.root.visible = this.root.visible;
      this.weaponView.place(
        exact ? capsule.a : toWorld(held.a), exact ? capsule.b : toWorld(held.b),
        held.style, held.grip * scale, rotate(rootQ, { x: 0, y: 0, z: 1 }),
        actor.state === 'attack' && !!actor.attack?.move, time,
      );
    }
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
