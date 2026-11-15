import { Container3D, Mesh3D, Matrix4, Vector3, updateTransformBackwards3D } from "@pixi/3d";
import type { Actor, WeaponId } from "../game/types";
import { sampleWeapon, type Capsule } from "../game/combat/geometry";
import type { RobotAssets } from "./robot";

/** A unit +Y mesh. Its furthest visible vertex and tip socket are exactly (0, 1, 0). */
export class WeaponView {
  readonly root = new Container3D();
  readonly tip = new Container3D({ y: 1 });
  private readonly tips = new Map<WeaponId, Mesh3D>();
  private activeStyle: WeaponId = "arc";
  private readonly styles = new Map<WeaponId, Container3D>();
  constructor(assets: RobotAssets) {
    this.root.label = "combat-weapon";
    this.root.addChild(this.tip);
    for (const style of ["arc", "pile", "razor", "lance", "cannon", "scythe"] as const) {
      const group = new Container3D();
      this.styles.set(style, group);
      this.root.addChild(group);
      const box = (x: number, y: number, width: number, length: number, glow = false) => {
        const m = new Mesh3D({
          geometry: assets.cube,
          material: glow ? assets.glow.player : assets.white,
          castShadow: false,
        });
        m.position.set(x, y, 0);
        m.scale.set(width, length, style === "pile" ? 0.35 : 0.1);
        group.addChild(m);
        if (x === 0 && Math.abs(y + length / 2 - 1) < 1e-6) this.tips.set(style, m);
      };
      if (style === "lance") {
        box(0, 0.4, 0.075, 0.8);
        box(0, 0.88, 0.16, 0.24, true);
        box(0, 0.78, 0.35, 0.025, true);
      } else if (style === "pile" || style === "cannon") {
        box(0, 0.37, 0.12, 0.74);
        box(0, 0.87, 0.6, 0.26, true);
      } else if (style === "razor") {
        box(0, 0.55, 0.2, 0.9);
        box(0, 0.94, 0.35, 0.12, true);
      } else {
        box(0, 0.48, 0.1, 0.96);
        box(0, 0.9, style === "scythe" ? 0.65 : 0.16, 0.2, true);
      }
    }
  }
  update(actor: Actor): boolean {
    const move = actor.attack?.move;
    this.root.visible =
      actor.alive &&
      actor.state === "attack" &&
      !!move &&
      !["none", "area", "projectile", "cannon", "mortar"].includes(move.behavior);
    if (!this.root.visible || !move || !actor.attack) return false;
    this.activeStyle = move.pose;
    this.styles.forEach((group, style) => {
      group.visible = move.pose === style;
    });
    placeSegment(
      this.root,
      actor.attack.collision?.capsule ?? sampleWeapon(actor, move, actor.attack.elapsed * 60),
    );
    return true;
  }
  /** Uses Pixi's real scene transform, independently checked against simulation endpoints. */
  tipWorld(): { x: number; y: number; z: number } {
    const primitive = this.tips.get(this.activeStyle)!;
    const point = new Vector3(0, 0.5, 0).applyMatrix4(worldMatrix(primitive));
    return { x: point.x, y: point.y, z: point.z };
  }
}

export function placeSegment(root: Container3D, capsule: Capsule): void {
  const dx = capsule.b.x - capsule.a.x,
    dy = capsule.b.y - capsule.a.y,
    dz = capsule.b.z - capsule.a.z;
  root.position.copyFrom(capsule.a);
  root.scale.set(1, Math.hypot(dx, dy, dz), 1);
  root.rotation.set(Math.atan2(dz, dy), 0, -Math.atan2(dx, Math.hypot(dy, dz)));
}

/** Pixi's backwards helper returns the PARENT matrix; include the node's own transform. */
export function worldMatrix(node: Container3D): Matrix4 {
  node.updateLocalTransform();
  return updateTransformBackwards3D(node, new Matrix4()).multiply(node.localTransform);
}
