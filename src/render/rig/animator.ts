import type { Capsule } from "../../game/combat/geometry";
import type { Actor, ActorKind, WeaponId } from "../../game/types";
import { FootPlanter, GAIT, type RootFrame } from "./gait";
import { angleDelta, clamp, damp, smooth, sub, type V3 } from "./math";
import { statePose, type PoseContext } from "./poses";
import {
  CHANNELS,
  rigSpec,
  solveRig,
  type AimConstraint,
  type CorePose,
  type RigSpec,
  type SolvedRig,
  type WeaponConstraint,
} from "./skeleton";

/** Hand placement on each weapon's shaft, in rig units from the capsule start. */
const GRIPS: Record<WeaponId, { min: number; max: number; off?: number }> = {
  arc: { min: 0.1, max: 0.42 },
  pile: { min: 0.3, max: 0.62, off: -0.26 },
  razor: { min: 0.2, max: 0.8 },
  lance: { min: 0.34, max: 0.9, off: -0.32 },
  cannon: { min: 0.14, max: 0.5, off: 0.24 },
  scythe: { min: 0.36, max: 0.9, off: -0.34 },
};

const RANGED = ["projectile", "cannon", "mortar"];
const UNARMED = ["none", "area", ...RANGED];

/** Fastest a free hand's target may travel relative to the chest, in rig units per second. */
const HAND_SPEED = 20;
/** Fastest the chest may turn relative to the hips, in radians per second. */
const CHEST_SPEED = 14;

/** Identifies the move an actor is performing, if any. */
const key0 = (actor: Actor): string =>
  actor.state === "attack" ? (actor.attack?.move?.id ?? actor.attack?.name ?? "") : "";

/** Seconds a newly entered state takes to absorb the previous pose. */
function blendTime(actor: Actor): number {
  switch (actor.state) {
    case "attack":
      // The trunk may still be settling when the hit frames begin; only the weapon hand may not.
      return clamp(actor.attack?.activeStart ?? 0.1, 0.08, 0.12);
    case "hurt":
    case "grabbed":
      return 0.05;
    case "jump":
    case "dodge":
    case "airdodge":
    case "wavedash":
      return 0.07;
    case "idle":
    case "run":
      return 0.16;
    default:
      return 0.11;
  }
}

export interface RigFrame {
  rig: SolvedRig;
  /** Displayed heading; eased through the camera-facing side when the actor turns round. */
  yaw: number;
  /** Whole-body pitch about the ground contact. */
  tumble: number;
  /** Weapon segment the hands were solved against, in rig space. */
  weapon: WeaponConstraint | null;
  /** Which feet are anchored to the floor this frame, and their heel-to-toe pitch. */
  feet: { plantedL: boolean; plantedR: boolean; pitchL: number; pitchR: number };
}

/**
 * Per-actor animation state: turns the simulation's actor snapshot into a solved skeleton.
 * Authored poses are inertialized across state changes, feet are anchored by the planter, and
 * the hands are finally constrained to the authoritative weapon segment.
 */
export class RigAnimator {
  readonly spec: RigSpec;
  private readonly planter: FootPlanter;
  private readonly mounted: boolean;
  private yaw = NaN;
  private lastTime = NaN;
  private key = "";
  private lastElapsed = 0;
  private attackKey = "";
  private attackSerial = 0;
  /** Decaying difference between the previous output and the new state's pose. */
  private offset: CorePose | null = null;
  private blend = 1;
  private blendDuration = 0.1;
  private output: CorePose | null = null;
  private handBias = { L: { x: 0, y: 0, z: 0 }, R: { x: 0, y: 0, z: 0 } };
  private handMode = { L: "", R: "" };
  /** Attack time at which each hand began catching its current grip. */
  private catchFrom = { L: 0, R: 0 };
  private lastHands: { L: V3; R: V3 } | null = null;
  private frame: RigFrame | null = null;

  constructor(private readonly kind: ActorKind) {
    this.spec = rigSpec(kind);
    const heavy = kind === "boss" || kind === "warden" || kind === "bruiser" || kind === "sentinel";
    this.planter = new FootPlanter(heavy ? GAIT.heavy : GAIT.light);
    this.mounted = kind === "rider";
  }

  /** The most recent solved frame, for diagnostics. */
  get last(): RigFrame | null {
    return this.frame;
  }

  /**
   * @param capsule - The attack's authoritative world segment, when the actor is attacking.
   */
  update(actor: Actor, time: number, weapon: WeaponId, capsule: Capsule | null): RigFrame {
    // A paused or rewound clock holds the pose; a long stall is not one giant step.
    const dt = Number.isFinite(this.lastTime) ? clamp(time - this.lastTime, 0, 0.1) : 0;
    const first = !Number.isFinite(this.lastTime) || time < this.lastTime;
    this.lastTime = time;

    const heading = (actor.facing * Math.PI) / 2;
    this.yaw = first || !Number.isFinite(this.yaw) ? heading : damp(this.yaw, heading, 32, dt);
    if (Math.abs(this.yaw - heading) < 1e-3) this.yaw = heading;
    const root: RootFrame = { x: actor.x, z: actor.z, yaw: this.yaw, scale: actor.scale };
    if (first) this.planter.release();
    this.planter.advance(dt, root);

    const airborne =
      actor.y > 0.02 || actor.y < -0.001 || actor.vy > 0 ||
      actor.state === "jump" || actor.state === "fall" || actor.state === "airdodge" || actor.state === "recover"; // prettier-ignore
    const mounted = this.mounted && actor.mount > 0;
    const ctx: PoseContext = {
      spec: this.spec, kind: this.kind, actor, weapon, time, airborne, mounted,
      gait: this.planter,
    }; // prettier-ignore
    const target = statePose(ctx);

    // A new state — or the same attack restarted — inertializes from the previous output.
    const elapsed = actor.attack?.elapsed ?? 0;
    const restarted = actor.state === "attack" && elapsed < this.lastElapsed - 1e-6;
    if (restarted || key0(actor) !== this.attackKey) this.attackSerial++;
    this.attackKey = key0(actor);
    const key = `${actor.state}:${actor.state === "attack" ? (actor.attack?.move?.id ?? actor.attack?.name) : ""}:${airborne ? 1 : 0}`;
    this.lastElapsed = elapsed;
    if (first || !this.output) {
      this.offset = null;
      this.blend = 1;
    } else if (key !== this.key || restarted) {
      const offset = {} as CorePose;
      for (const channel of CHANNELS)
        offset[channel] =
          channel === "hipYaw"
            ? angleDelta(target[channel], this.output[channel])
            : this.output[channel] - target[channel];
      // The planter and the tumble own these; they must not lag behind a state change.
      offset.plant = 0;
      this.offset = offset;
      this.blend = 0;
      this.blendDuration = blendTime(actor);
    }
    this.key = key;
    this.blend = Math.min(1, this.blend + dt / this.blendDuration);
    const pose = target;
    if (this.offset && this.blend < 1) {
      const remaining = 1 - smooth(this.blend);
      for (const channel of CHANNELS) pose[channel] += this.offset[channel] * remaining;
    }
    if (this.output && !first) {
      // Limbs and trunk have mass: however abruptly a pose asks, the chest turns and a free hand's
      // target moves at a bounded speed. (Whole-body spins live in the hips and are not limited.)
      const turn = CHEST_SPEED * dt;
      for (const k of ["chestYaw", "chestPitch", "chestRoll"] as const)
        pose[k] = this.output[k] + clamp(pose[k] - this.output[k], -turn, turn);
      const limit = HAND_SPEED * dt;
      for (const side of ["L", "R"] as const) {
        const keys = [`hand${side}X`, `hand${side}Y`, `hand${side}Z`] as const;
        const step = Math.hypot(...keys.map((k) => pose[k] - this.output![k]));
        if (step > limit) for (const k of keys) pose[k] = this.output[k] + ((pose[k] - this.output[k]) * limit) / step;
      }
    }
    this.output = { ...pose };

    const grounded = !airborne && !mounted;
    const feet = this.planter.place(
      root,
      { x: pose.footLX, y: pose.footLY, z: pose.footLZ },
      { x: pose.footRX, y: pose.footRY, z: pose.footRZ },
      grounded && pose.plant > 0.5,
    );
    pose.footLPitch += feet.pitchL;
    pose.footRPitch += feet.pitchR;

    const toRig = (p: V3): V3 => {
      const dx = (p.x - actor.x) / actor.scale,
        dz = (p.z - actor.z) / actor.scale;
      const c = Math.cos(this.yaw),
        s = Math.sin(this.yaw);
      return { x: dx * c - dz * s, y: (p.y - actor.y) / actor.scale, z: dx * s + dz * c };
    };
    let held: WeaponConstraint | null = null;
    let aim: AimConstraint | null = null;
    const move = actor.attack?.move;
    if (actor.state === "attack" && move && capsule) {
      if (this.kind === "player" && !UNARMED.includes(move.behavior)) {
        const grip = GRIPS[move.pose];
        // Fists alternate: odd combo hits lead with the left.
        const main = move.pose === "razor" && actor.attack!.combo % 2 === 1 ? "L" : "R";
        held = {
          a: toRig(capsule.a), b: toRig(capsule.b), main,
          mainMin: grip.min, mainMax: grip.max, offSpacing: grip.off,
        }; // prettier-ignore
      } else if (this.kind !== "player") {
        const windup = clamp(elapsed / Math.max(1e-3, actor.attack!.activeStart), 0, 1);
        const ranged = RANGED.includes(move.behavior) && actor.aim;
        aim = {
          hand: "R",
          toward: toRig(ranged ? { x: actor.aim!.x, y: actor.aim!.y + 1, z: actor.aim!.z } : capsule.b),
          extend: ranged ? 0.9 : 0.6 + 0.38 * smooth(windup),
        };
      }
    }

    // Hands entering or leaving a constraint ease across instead of teleporting.
    const mode = { L: "", R: "" };
    if (held) {
      // Each swing is its own grip: a chained attack eases onto the new shaft too.
      mode[held.main] = `weapon${this.attackSerial}`;
      if (held.offSpacing !== undefined) mode[held.main === "R" ? "L" : "R"] = `weapon${this.attackSerial}`;
    }
    if (aim) mode[aim.hand] = "aim";
    let rig = solveRig(this.spec, pose, feet, held, aim);
    for (const side of ["L", "R"] as const) {
      const bias = this.handBias[side];
      const solved = side === "L" ? rig.handL : rig.handR;
      if (mode[side] !== this.handMode[side] && this.lastHands && !first) {
        // Start from where the hand was.
        const jump = sub(this.lastHands[side], solved);
        bias.x = jump.x;
        bias.y = jump.y;
        bias.z = jump.z;
        // Measured from the start of this frame, so the catch is already under way on it.
        this.catchFrom[side] = Math.max(0, elapsed - dt);
      } else if (first) bias.x = bias.y = bias.z = 0;
      else if (!mode[side].startsWith("weapon")) {
        // Letting go is a gentle exponential; catching is timed against the wind-up below.
        bias.x = damp(bias.x, 0, 16, dt);
        bias.y = damp(bias.y, 0, 16, dt);
        bias.z = damp(bias.z, 0, 16, dt);
      }
      this.handMode[side] = mode[side];
      if (Math.hypot(bias.x, bias.y, bias.z) < 1e-4) bias.x = bias.y = bias.z = 0;
    }
    // A hand must be on the weapon before the hit frames begin, however short the wind-up.
    const activeStart = actor.attack?.activeStart ?? 0;
    const live = actor.attack?.collision?.active || elapsed >= activeStart;
    const eased = (side: "L" | "R"): V3 => {
      // An S-curve over what is left of the wind-up, never slower than a tenth of a second.
      const from = this.catchFrom[side];
      const window = Math.min(activeStart - from, 0.1);
      const catching = live || window <= 1e-4 ? 0 : 1 - smooth((elapsed - from) / window);
      const gate = mode[side].startsWith("weapon") ? catching : 1;
      const bias = this.handBias[side];
      return { x: bias.x * gate, y: bias.y * gate, z: bias.z * gate };
    };
    const bias = { L: eased("L"), R: eased("R") };
    if (bias.L.x || bias.L.y || bias.L.z || bias.R.x || bias.R.y || bias.R.z)
      rig = solveRig(this.spec, pose, feet, held, aim, bias);
    this.lastHands = { L: rig.handL, R: rig.handR };

    this.frame = {
      rig, yaw: this.yaw, tumble: pose.tumble, weapon: held,
      feet: { plantedL: feet.plantedL, plantedR: feet.plantedR, pitchL: pose.footLPitch, pitchR: pose.footRPitch },
    }; // prettier-ignore
    return this.frame;
  }
}
