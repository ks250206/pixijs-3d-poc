import { Container3D, Matrix4, Vector3, updateTransformBackwards3D } from "@pixi/3d";
import type { Capsule, Vec3 } from "../game/combat/geometry";
import type { WeaponId } from "../game/types";
import { buildWeapon, type WeaponModel } from "./armory";
import { cross, dot, normalize, quatFromBasis, reject, scale, sub } from "./rig/math";
import type { RobotAssets } from "./robot";

const STYLES = ["arc", "pile", "razor", "lance", "cannon", "scythe"] as const;

/**
 * The player's weapon, drawn in world space along a segment it is handed: the simulation's own
 * capsule on hit frames, the skeleton's carried or wound-up segment otherwise. It never decides
 * where the weapon is — only how a weapon lying on that segment looks.
 */
export class WeaponView {
  readonly root = new Container3D();
  private readonly models = new Map<WeaponId, WeaponModel>();
  private active: WeaponId = "arc";
  /** Direction the blade's edge faces, kept between frames so the weapon does not roll about. */
  private edge: Vec3 = { x: 0, y: 0, z: 1 };
  private lastShaft: Vec3 | null = null;
  private lastTime = NaN;

  constructor(assets: RobotAssets) {
    this.root.label = "combat-weapon";
    for (const style of STYLES) {
      const model = buildWeapon(style, assets);
      this.models.set(style, model);
      this.root.addChild(model.root);
    }
  }

  /**
   * Lays the weapon from `a` (pivot) to `b` (tip), held `grip` metres from the pivot.
   * @param forward - Where the wielder faces; the edge rests toward it when the weapon is still.
   * @param swinging - Whether the weapon is being swung, so its edge should lead the motion.
   */
  place(a: Vec3, b: Vec3, style: WeaponId, grip: number, forward: Vec3, swinging: boolean, time: number): void {
    const shaft = sub(b, a);
    const length = Math.hypot(shaft.x, shaft.y, shaft.z);
    const along = normalize(shaft, { x: 0, y: 1, z: 0 });
    const dt = Number.isFinite(this.lastTime) ? Math.max(0, Math.min(0.1, time - this.lastTime)) : 0;
    const fresh = !Number.isFinite(this.lastTime) || time < this.lastTime || style !== this.active;
    this.lastTime = time;

    // The edge leads a swing (the way the shaft is turning) and otherwise faces forward.
    let want = forward;
    if (swinging && this.lastShaft && dt > 0) {
      const turning = sub(shaft, this.lastShaft);
      const sideways = sub(turning, scale(along, dot(turning, along)));
      if (Math.hypot(sideways.x, sideways.y, sideways.z) > 0.004 * Math.max(1, length)) want = sideways;
      else want = this.edge;
    }
    this.lastShaft = shaft;
    const target = reject(want, along, this.edge);
    const k = fresh ? 1 : 1 - Math.exp(-(swinging ? 30 : 12) * dt);
    this.edge = reject(
      { x: this.edge.x + (target.x - this.edge.x) * k, y: this.edge.y + (target.y - this.edge.y) * k, z: this.edge.z + (target.z - this.edge.z) * k },
      along,
      target,
    );

    this.active = style;
    this.models.forEach((model, id) => {
      model.root.visible = id === style;
    });
    this.root.position.set(a.x, a.y, a.z);
    this.root.scale.set(1);
    // Assign the whole quaternion: that is what makes it, not the Euler angles, the rotation in use.
    this.root.quaternion = quatFromBasis(cross(along, this.edge), along, this.edge);
    this.models.get(style)!.layout(length, grip);
  }

  /** Where the weapon's pivot really is in the scene, and which weapon is being drawn. */
  pivotWorld(): { x: number; y: number; z: number; style: WeaponId; visible: boolean } {
    const point = new Vector3(0, 0, 0).applyMatrix4(worldMatrix(this.root));
    return { x: point.x, y: point.y, z: point.z, style: this.active, visible: this.root.visible };
  }

  /** Uses Pixi's real scene transform, independently checked against simulation endpoints. */
  tipWorld(): { x: number; y: number; z: number } {
    const point = new Vector3(0, 0.5, 0).applyMatrix4(worldMatrix(this.models.get(this.active)!.tip));
    return { x: point.x, y: point.y, z: point.z };
  }
}

/** Orients a unit +Y mesh along a capsule: used by trails and debug overlays. */
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
