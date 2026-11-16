import { clamp, clamp01, damp, lerp, mix, smooth, type V3 } from "./math";
import type { Feet } from "./skeleton";

/** Where the rig sits in the world: rig = Ry(-yaw) · (world - origin) / scale. */
export interface RootFrame {
  x: number;
  z: number;
  yaw: number;
  scale: number;
}

export const toRig = (root: RootFrame, x: number, z: number): { x: number; z: number } => {
  const dx = (x - root.x) / root.scale,
    dz = (z - root.z) / root.scale;
  const c = Math.cos(root.yaw),
    s = Math.sin(root.yaw);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
};
export const toWorld = (root: RootFrame, x: number, z: number): { x: number; z: number } => {
  const c = Math.cos(root.yaw),
    s = Math.sin(root.yaw);
  return { x: root.x + root.scale * (x * c + z * s), z: root.z + root.scale * (-x * s + z * c) };
};

interface Foot {
  /** free: follows the pose; planted: anchored; swing: run-cycle flight; step: standing correction. */
  state: "new" | "free" | "planted" | "swing" | "step";
  /** World anchor while planted, lift-off point while travelling. */
  wx: number;
  wz: number;
  /** Sole height at lift-off, so a foot already in the air starts from where it is. */
  liftY: number;
  /** Progress of the current swing or step in [0,1]. */
  travel: number;
  /** Gait phase at lift-off, so a late lift still lands on time. */
  liftPhase: number;
  /** Last rig-space output. */
  out: V3;
  pitch: number;
  /** Set when a stance foot was pulled up early; it then sits out the rest of that stance window. */
  early: boolean;
  /** Eased 0..1: how much the foot turns with the hips instead of keeping its planted heading. */
  loose: number;
}

const newFoot = (): Foot => ({
  state: "new", wx: 0, wz: 0, liftY: 0, travel: 0, liftPhase: 0, out: { x: 0, y: 0, z: 0 }, pitch: 0, early: false, loose: 0,
}); // prettier-ignore

export interface GaitTuning {
  /** Largest distance a foot lands ahead of its home, in rig units. */
  reach: number;
  /** Slowest and fastest full cycles per second. */
  minCadence: number;
  maxCadence: number;
  /** Seconds one corrective step takes while standing. */
  stepTime: number;
  /** Peak sole height of a running swing and of a standing step. */
  lift: number;
}

export const GAIT: Record<"light" | "heavy", GaitTuning> = {
  light: { reach: 0.33, minCadence: 1.5, maxCadence: 4.2, stepTime: 0.13, lift: 0.2 },
  heavy: { reach: 0.3, minCadence: 1, maxCadence: 2.4, stepTime: 0.22, lift: 0.14 },
};

/**
 * Procedural foot placement. Grounded feet are anchored in world space, so they do not slide while
 * the body travels, turns or leans; they re-plant with discrete steps (standing) or a phased run
 * cycle (moving). Airborne or sliding poses bypass the anchors and drive the feet directly.
 */
export class FootPlanter {
  /** Run-cycle phase in [0,1): the left foot lands at 0, the right at 0.5. */
  phase = 0;
  /** Smoothed planar speed in rig units per second, and its rig-space direction. */
  speed = 0;
  velocity = { x: 0, z: 0 };
  /** True while the run cycle, rather than standing correction, places the feet. */
  moving = false;
  /** Fraction of the cycle each foot spends on the floor. */
  duty = 0.5;
  cadence = 0;
  private readonly left = newFoot();
  private readonly right = newFoot();
  private lastX = NaN;
  private lastZ = NaN;
  private dt = 0;

  constructor(private readonly tuning: GaitTuning) {}

  /** Measures real displacement, so conveyors, knockback and dashes are all "movement". */
  advance(dt: number, root: RootFrame): void {
    this.dt = dt;
    if (dt > 0 && Number.isFinite(this.lastX)) {
      const jump = Math.hypot(root.x - this.lastX, root.z - this.lastZ);
      // A respawn or scripted teleport is not a stride.
      const valid = jump / dt < 60 * root.scale;
      const v = valid ? toRigVector(root, (root.x - this.lastX) / dt, (root.z - this.lastZ) / dt) : { x: 0, z: 0 };
      this.velocity.x = damp(this.velocity.x, v.x, 18, dt);
      this.velocity.z = damp(this.velocity.z, v.z, 18, dt);
      if (!valid) this.release();
    }
    this.lastX = root.x;
    this.lastZ = root.z;
    this.speed = Math.hypot(this.velocity.x, this.velocity.z);
    this.moving = this.speed > (this.moving ? 0.5 : 0.9);
    this.duty = mix(0.5, 0.3, clamp01(this.speed / 6));
    this.cadence = clamp(
      (this.speed * this.duty) / (2 * this.tuning.reach),
      this.tuning.minCadence,
      this.tuning.maxCadence,
    );
    if (this.moving) this.phase = (this.phase + this.cadence * dt) % 1;
  }

  /** Forgets the anchors; the next planted frame re-plants the feet where they are. */
  release(): void {
    for (const foot of [this.left, this.right]) if (foot.state !== "new") foot.state = "free";
  }

  /**
   * @param homeL, homeR - Rig-space sole targets from the pose (`y` is an authored lift).
   * @param plant - Whether the pose wants anchored feet (grounded, not sliding).
   */
  place(root: RootFrame, homeL: V3, homeR: V3, plant: boolean): Feet & { pitchL: number; pitchR: number } {
    if (!plant) {
      this.follow(this.left, homeL);
      this.follow(this.right, homeR);
    } else if (this.moving) {
      this.stride(root, this.left, homeL, this.phase);
      this.stride(root, this.right, homeR, (this.phase + 0.5) % 1);
    } else {
      this.stand(root, this.left, homeL, this.right);
      this.stand(root, this.right, homeR, this.left);
    }
    for (const foot of [this.left, this.right])
      foot.loose = foot.state === "free" ? damp(foot.loose, 1, 20, this.dt) : damp(foot.loose, 0, 20, this.dt);
    return {
      L: this.left.out, R: this.right.out,
      plantedL: this.left.state === "planted", plantedR: this.right.state === "planted",
      pitchL: this.left.pitch, pitchR: this.right.pitch,
      looseL: this.left.loose, looseR: this.right.loose,
    }; // prettier-ignore
  }

  /** Pose-driven foot: eased out of whatever it was doing, never popped. */
  private follow(foot: Foot, home: V3): void {
    const k = foot.state === "new" ? 1 : 1 - Math.exp(-30 * this.dt);
    foot.out = lerp(foot.out, home, k);
    foot.pitch = damp(foot.pitch, 0, 20, this.dt);
    foot.state = "free";
  }

  private anchor(root: RootFrame, foot: Foot, x: number, z: number): void {
    const w = toWorld(root, x, z);
    foot.wx = w.x;
    foot.wz = w.z;
  }

  /** Starts travelling from the foot's current position. */
  private lift(root: RootFrame, foot: Foot, home: V3, state: "swing" | "step"): void {
    if (foot.state === "new") foot.out = { ...home };
    if (foot.state !== "planted") this.anchor(root, foot, foot.out.x, foot.out.z);
    foot.liftY = foot.state === "planted" ? 0 : Math.max(0, foot.out.y - home.y);
    foot.travel = 0;
    foot.state = state;
  }

  private stride(root: RootFrame, foot: Foot, home: V3, phase: number): void {
    const { duty, cadence } = this;
    const pace = clamp01(this.speed / 3);
    if (phase >= duty) foot.early = false;
    else if (foot.state === "planted") {
      // A foot left out of the leg's reach (a start, a turn, a shove) lifts now, not at toe-off.
      const at = toRig(root, foot.wx, foot.wz);
      if (Math.hypot(at.x - home.x, at.z - home.z) > this.tuning.reach * 1.25) foot.early = true;
    }
    if (phase < duty && !foot.early) {
      if (foot.state !== "planted") {
        // Touch down where the swing was heading; it stays there for the whole stance.
        if (foot.state === "new") this.anchor(root, foot, home.x, home.z);
        else this.anchor(root, foot, foot.out.x, foot.out.z);
        foot.state = "planted";
      }
      const at = toRig(root, foot.wx, foot.wz);
      foot.out = { x: at.x, y: home.y, z: at.z };
      // Roll from heel strike to toe-off across the stance.
      foot.pitch = stanceRoll(phase / duty) * pace;
      return;
    }
    if (foot.state !== "swing") {
      this.lift(root, foot, home, "swing");
      foot.liftPhase = phase;
    }
    const s = clamp01((phase - foot.liftPhase) / Math.max(1e-3, 1 - foot.liftPhase));
    foot.travel = s;
    // Land half a stance ahead so the foot passes under the hip in mid-stance.
    const lead = Math.min(this.tuning.reach, (this.speed * duty) / (2 * cadence)) / Math.max(1e-6, this.speed);
    const from = toRig(root, foot.wx, foot.wz);
    const t = smooth(s);
    foot.out = {
      x: mix(from.x, home.x + this.velocity.x * lead, t),
      y: home.y + foot.liftY * (1 - t) + Math.sin(Math.PI * s) * this.tuning.lift * mix(0.45, 1, clamp01(this.speed / 6)),
      z: mix(from.z, home.z + this.velocity.z * lead, t),
    };
    foot.pitch = mix(stanceRoll(1), stanceRoll(0), t) * pace + Math.sin(Math.PI * s) * 0.35;
  }

  private stand(root: RootFrame, foot: Foot, home: V3, other: Foot): void {
    foot.pitch = damp(foot.pitch, 0, 18, this.dt);
    if (foot.state === "new" || foot.state === "free") {
      if (foot.state === "new") foot.out = { ...home };
      // First grounded frame: plant in place, then let ordinary steps tidy the stance.
      if (foot.out.y - home.y > 0.03) this.lift(root, foot, home, "step");
      else {
        this.anchor(root, foot, foot.out.x, foot.out.z);
        foot.state = "planted";
      }
    } else if (foot.state === "swing") this.lift(root, foot, home, "step");
    if (foot.state === "planted") {
      const at = toRig(root, foot.wx, foot.wz);
      const error = Math.hypot(at.x - home.x, at.z - home.z);
      // One foot at a time, unless this one has been left far behind.
      if ((error > 0.11 && other.state === "planted") || error > 0.45) this.lift(root, foot, home, "step");
      else {
        foot.out = { x: at.x, y: home.y, z: at.z };
        return;
      }
    }
    foot.travel = Math.min(1, foot.travel + this.dt / this.tuning.stepTime);
    const s = foot.travel;
    const from = toRig(root, foot.wx, foot.wz);
    const t = smooth(s);
    foot.out = {
      x: mix(from.x, home.x, t),
      y: home.y + foot.liftY * (1 - t) + Math.sin(Math.PI * s) * this.tuning.lift * 0.4,
      z: mix(from.z, home.z, t),
    };
    if (s >= 1) {
      this.anchor(root, foot, home.x, home.z);
      foot.state = "planted";
    }
  }
}

/** Heel strike, flat mid-stance, then toe-off: foot pitch across one stance. */
function stanceRoll(t: number): number {
  if (t < 0.25) return mix(-0.22, 0, smooth(t / 0.25));
  return t > 0.6 ? mix(0, 0.42, smooth((t - 0.6) / 0.4)) : 0;
}

function toRigVector(root: RootFrame, vx: number, vz: number): { x: number; z: number } {
  const c = Math.cos(root.yaw),
    s = Math.sin(root.yaw);
  return { x: (vx * c - vz * s) / root.scale, z: (vx * s + vz * c) / root.scale };
}
