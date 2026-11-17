import type { Capsule } from "../../game/combat/geometry";
import { PIVOT_X, PIVOT_Y, WEAPON_REST } from "../../game/combat/trajectory";
import type { Actor, ActorKind, WeaponId } from "../../game/types";
import { wieldsWeapon } from "../../game/bestiary";
import type { Strike } from "./choreography";
import { FootPlanter, GAIT, type RootFrame } from "./gait";
import {
  add,
  angleDelta,
  clamp,
  damp,
  normalize,
  quatMul,
  quatYawPitchRoll,
  rotate,
  scale,
  slerpUnit,
  smooth,
  sub,
  type V3,
} from "./math";
import { poseStyle, statePose, type PoseContext } from "./poses";
import {
  CHANNELS,
  restPose,
  rigSpec,
  isHeavyFrame,
  solveRig,
  type AimConstraint,
  type CorePose,
  type RigSpec,
  type SolvedRig,
  type WeaponConstraint,
} from "./skeleton";

/** Hand placement on each weapon's shaft, in rig units from the pivot. */
const GRIPS: Record<WeaponId, { min: number; max: number; off?: number }> = {
  arc: { min: 0.1, max: 0.42 },
  pile: { min: 0.3, max: 0.62, off: -0.26 },
  razor: { min: 0.04, max: 0.8 },
  lance: { min: 0.34, max: 0.9, off: -0.32 },
  cannon: { min: 0.14, max: 0.5, off: 0.24 },
  scythe: { min: 0.36, max: 0.9, off: -0.34 },
};

const RANGED = ["projectile", "cannon", "mortar"];
const TRAVELLING = ["rush", "phase", "leap"];

/** Fastest a free hand's target may travel relative to the chest, in rig units per second. */
const HAND_SPEED = 20;
/** Fastest the chest may turn relative to the hips, in radians per second. */
const CHEST_SPEED = 14;

/** Identifies the move an actor is performing, if any. */
const moveKey = (actor: Actor): string =>
  actor.state === "attack" ? (actor.attack?.move?.id ?? actor.attack?.name ?? "") : "";

/** Seconds a newly entered state takes to absorb the previous pose. */
function blendTime(actor: Actor): number {
  switch (actor.state) {
    case "attack":
      // The trunk may still be settling when the hit frames begin; only the weapon may not.
      return clamp(actor.attack?.activeStart ?? 0.1, 0.08, 0.12);
    case "hurt":
    case "grabbed":
      return 0.05;
    case "jump":
    case "dodge":
    case "airdodge":
      return 0.07;
    case "idle":
    case "run":
      return 0.16;
    default:
      return 0.11;
  }
}

interface Segment {
  a: V3;
  b: V3;
}

/** The weapon a player is holding this frame, for the renderer. */
export interface HeldWeapon extends Segment {
  style: WeaponId;
  /** Distance of the leading hand from `a`, along the weapon. */
  grip: number;
  /**
   * True on hit frames. The segment is then exactly the capsule the simulation checked; draw the
   * weapon from that capsule itself rather than from this rig-space copy.
   */
  live: boolean;
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
  /** The player's weapon in rig space: carried between attacks, authoritative during them. */
  held: HeldWeapon | null;
  /**
   * How far each hand is still offset from its solved place while it eases into or out of a hold
   * (rig units; 0 when it is exactly where the pose and constraints put it).
   */
  easing: { L: number; R: number };
}

/**
 * Per-actor animation state: turns the simulation's actor snapshot into a solved skeleton.
 * Authored poses are inertialized across state changes, feet are anchored by the planter, and
 * the hands hold the weapon — which, during an attack, is the simulation's own segment.
 */
export class RigAnimator {
  readonly spec: RigSpec;
  private readonly planter: FootPlanter;
  private readonly mounted: boolean;
  private readonly restChestY: number;
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
  /** The weapon's own inertialization: where it was, relative to where its new mode puts it. */
  private weaponBias = { a: { x: 0, y: 0, z: 0 }, along: { x: 0, y: 0, z: 1 }, length: 0, weight: 0 };
  private weaponMode = "";
  private weaponFrom = 0;
  private lastWeapon: Segment | null = null;
  /** Unwrapped heading of the weapon about the body, so a spin keeps turning the same way. */
  private heading = 0;
  private frame: RigFrame | null = null;

  constructor(private readonly kind: ActorKind) {
    this.spec = rigSpec(kind);
    this.planter = new FootPlanter(isHeavyFrame(kind) ? GAIT.heavy : GAIT.light);
    this.mounted = kind === "rider";
    this.restChestY = this.spec.hipsY + restPose(this.spec).hipY;
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
    const toRig = (p: V3): V3 => {
      const dx = (p.x - actor.x) / actor.scale,
        dz = (p.z - actor.z) / actor.scale;
      const c = Math.cos(this.yaw),
        s = Math.sin(this.yaw);
      return { x: dx * c - dz * s, y: (p.y - actor.y) / actor.scale, z: dx * s + dz * c };
    };

    const airborne =
      actor.y > 0.02 || actor.y < -0.001 || actor.vy > 0 ||
      actor.state === "jump" || actor.state === "fall" || actor.state === "airdodge" || actor.state === "recover"; // prettier-ignore
    const mounted = this.mounted && actor.mount > 0;

    const elapsed = actor.attack?.elapsed ?? 0;
    const restarted = actor.state === "attack" && elapsed < this.lastElapsed - 1e-6;
    this.lastElapsed = elapsed;
    if (restarted || moveKey(actor) !== this.attackKey) {
      this.attackSerial++;
      this.heading = 0;
    }
    this.attackKey = moveKey(actor);

    // --- What the body is striking with, read off the simulation's move and its segment.
    const move = actor.state === "attack" ? actor.attack?.move : undefined;
    const striking = move && capsule && move.behavior !== "none" ? { move, capsule } : null;
    // The mirror is built on the player's chassis and holds the same weapon.
    const player = wieldsWeapon(this.kind);
    const main: "L" | "R" =
      player && striking && striking.move.pose === "razor" && actor.attack!.combo % 2 === 1 ? "L" : "R";
    let strike: Strike | null = null;
    let authoritative: Segment | null = null;
    /** True on the frames the simulation tests this strike for contact. */
    let hitting = false;
    if (striking) {
      const { frames, shape } = striking.move;
      const a = toRig(striking.capsule.a),
        b = toRig(striking.capsule.b);
      authoritative = { a, b };
      const aim = normalize(sub(b, a), { x: 0, y: 0, z: 1 });
      // Level aims have a heading; a vertical one has none, so it weighs nothing. A strike straight
      // behind turns through the side facing the camera.
      const level = Math.hypot(aim.x, aim.z);
      const plane = shape.arc?.plane ?? null;
      // An arc in the vertical plane passes over the head; that is no reason to turn round.
      let phi = plane === "vertical" ? 0 : Math.atan2(aim.x - 1e-6 * actor.facing * Math.max(0, -aim.z), aim.z);
      phi += Math.round((this.heading - phi) / (Math.PI * 2)) * Math.PI * 2;
      this.heading = phi;
      const wholeTurns = Math.round(phi / (Math.PI * 2)) * Math.PI * 2;
      const frame = elapsed * 60,
        end = frames.startup + frames.active;
      hitting = actor.attack!.collision?.active ?? (frames.active > 0 && frame >= frames.startup && frame <= end);
      strike = {
        style: player ? striking.move.pose : poseStyle(this.kind, weapon),
        kind: striking.move.kind,
        direction: striking.move.direction,
        trajectory: shape.trajectory,
        plane,
        clock:
          frame < frames.startup
            ? frame / Math.max(1, frames.startup)
            : frame <= end
              ? 1 + (frame - frames.startup) / Math.max(1, frames.active)
              : 2 + Math.min(1, (frame - end) / Math.max(1, frames.recovery)),
        aim,
        // Whole turns already made are kept; only the remainder is weighted by how level the
        // weapon is, so a finished spin ends facing forward even with the blade raised.
        turn: wholeTurns + (phi - wholeTurns) * level,
        extension: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) * actor.scale / Math.max(0.1, shape.reach),
        duration: actor.attack!.duration,
        combo: striking.move.combo,
        charge: striking.move.charge,
        airborne,
        main,
        ranged: RANGED.includes(striking.move.behavior),
        travelling: striking.move.kind === "dash" || TRAVELLING.includes(striking.move.behavior),
      }; // prettier-ignore
    }

    const ctx: PoseContext = {
      spec: this.spec, kind: this.kind, actor, weapon, time, airborne, mounted, strike,
      gait: this.planter,
    }; // prettier-ignore
    const target = statePose(ctx);

    // A new state — or the same attack restarted — inertializes from the previous output.
    const key = `${actor.state}:${this.attackKey}:${airborne ? 1 : 0}`;
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
      // The planter owns this; it must not lag behind a state change.
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

    const activeStart = actor.attack?.activeStart ?? 0;
    const live = !!striking && (actor.attack!.collision?.active || elapsed >= activeStart);
    /** 1 → 0 across what is left of the wind-up (at most `longest` seconds), exactly 0 once live. */
    const catching = (from: number, longest: number): number => {
      const window = Math.min(activeStart - from, longest);
      return live || window <= 1e-4 ? 0 : 1 - smooth((elapsed - from) / window);
    };

    // --- The weapon. Players always hold one; enemies only aim an arm.
    let held: WeaponConstraint | null = null;
    let display: HeldWeapon | null = null;
    let aim: AimConstraint | null = null;
    if (player) {
      const style = striking ? striking.move.pose : weapon;
      const swinging = !!strike && !strike.ranged && striking!.move.behavior !== "area";
      const carried = this.carried(pose, style);
      let segment: Segment = carried;
      let mode = "carry";
      if (swinging) {
        segment = authoritative!;
        mode = `strike${this.attackSerial}`;
      } else if (strike?.ranged) {
        // A shot has no blade to match: the barrel just points down the line of fire.
        const length = WEAPON_REST[style].length;
        segment = { a: authoritative!.a, b: add(authoritative!.a, scale(strike.aim, length)) };
        mode = `shot${this.attackSerial}`;
      }
      // A change of mode eases the weapon across as a rigid shaft: its pivot, its direction and
      // its length each blend, so it turns rather than shearing or telescoping.
      const bias = this.weaponBias;
      const span = (s: Segment) => Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y, s.b.z - s.a.z);
      if (mode !== this.weaponMode && this.lastWeapon && !first) {
        bias.a = sub(this.lastWeapon.a, segment.a);
        bias.along = normalize(sub(this.lastWeapon.b, this.lastWeapon.a), { x: 0, y: 0, z: 1 });
        bias.length = span(this.lastWeapon) - span(segment);
        bias.weight = 1;
        this.weaponFrom = Math.max(0, elapsed - dt);
      } else if (first) bias.weight = 0;
      this.weaponMode = mode;
      // Settling back into the carry is a gentle decay; a strike is timed against its wind-up.
      if (mode === "carry") bias.weight *= Math.exp(-14 * dt);
      const gate = mode === "carry" ? bias.weight : bias.weight * catching(this.weaponFrom, swinging ? 0.12 : 0.08);
      // The displayed weapon is exactly the checked segment on every hit frame.
      const exact = swinging && hitting;
      // Once the wind-up is over the strike owns the weapon outright.
      if (swinging && (hitting || live)) bias.weight = 0;
      else if (gate > 1e-5) {
        const a = add(segment.a, scale(bias.a, gate));
        const along = slerpUnit(normalize(sub(segment.b, segment.a), bias.along), bias.along, gate);
        segment = { a, b: add(a, scale(along, span(segment) + bias.length * gate)) };
      }
      this.lastWeapon = segment;
      const grip = GRIPS[style];
      held = { ...segment, main, mainMin: grip.min, mainMax: grip.max, offSpacing: grip.off };
      display = { ...segment, style, grip: grip.min, live: exact };
    } else if (striking && strike) {
      const windup = clamp(strike.clock, 0, 1);
      const ranged = strike.ranged && actor.aim;
      aim = {
        hand: "R",
        toward: ranged ? toRig({ x: actor.aim!.x, y: actor.aim!.y + 1, z: actor.aim!.z }) : authoritative!.b,
        extend: ranged ? 0.9 : 0.6 + 0.38 * smooth(windup),
      };
    }

    // Hands entering or leaving a hold ease across instead of teleporting.
    const mode = { L: "", R: "" };
    if (held) {
      mode[held.main] = "weapon";
      if (held.offSpacing !== undefined) mode[held.main === "R" ? "L" : "R"] = "weapon";
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
      else if (mode[side] !== "weapon" || !striking) {
        // Outside a strike, hands ease by a gentle exponential.
        bias.x = damp(bias.x, 0, 16, dt);
        bias.y = damp(bias.y, 0, 16, dt);
        bias.z = damp(bias.z, 0, 16, dt);
      } else if (live) bias.x = bias.y = bias.z = 0;
      this.handMode[side] = mode[side];
      if (Math.hypot(bias.x, bias.y, bias.z) < 1e-4) bias.x = bias.y = bias.z = 0;
    }
    const eased = (side: "L" | "R"): V3 => {
      // A hand catching a weapon mid-strike is timed to be on it when the hit frames begin.
      const gate = mode[side] === "weapon" && striking ? catching(this.catchFrom[side], 0.1) : 1;
      const bias = this.handBias[side];
      // Below a tenth of a millimetre the hand is simply there.
      if (Math.hypot(bias.x, bias.y, bias.z) * gate < 1e-4) return { x: 0, y: 0, z: 0 };
      return { x: bias.x * gate, y: bias.y * gate, z: bias.z * gate };
    };
    const bias = { L: eased("L"), R: eased("R") };
    const easing = { L: Math.hypot(bias.L.x, bias.L.y, bias.L.z), R: Math.hypot(bias.R.x, bias.R.y, bias.R.z) };
    if (easing.L || easing.R) rig = solveRig(this.spec, pose, feet, held, aim, bias);
    this.lastHands = { L: rig.handL, R: rig.handR };
    if (display && rig.grip) display.grip = rig.grip.main;

    this.frame = {
      rig, yaw: this.yaw, tumble: pose.tumble, weapon: held, held: display, easing,
      feet: { plantedL: feet.plantedL, plantedR: feet.plantedR, pitchL: pose.footLPitch, pitchR: pose.footRPitch },
    }; // prettier-ignore
    return this.frame;
  }

  /**
   * Where the weapon rides between attacks: its rest pose, carried on the chest so it breathes,
   * leans and turns with the body, and re-aimed by the pose's carry channels.
   */
  private carried(pose: CorePose, style: WeaponId): Segment {
    const rest = WEAPON_REST[style];
    const hips = quatYawPitchRoll(pose.hipYaw, pose.hipPitch, pose.hipRoll);
    const chest = quatMul(hips, quatYawPitchRoll(pose.chestYaw, pose.chestPitch, pose.chestRoll));
    const pivot = add(
      { x: pose.hipX, y: this.spec.hipsY + pose.hipY, z: pose.hipZ },
      rotate(chest, { x: pose.carryX, y: PIVOT_Y - this.restChestY + pose.carryY, z: PIVOT_X + pose.carryZ }),
    );
    const elevation = rest.angle + pose.carryPitch;
    const along = rotate(chest, {
      x: Math.sin(pose.carryYaw) * Math.cos(elevation),
      y: Math.sin(elevation),
      z: Math.cos(pose.carryYaw) * Math.cos(elevation),
    });
    return { a: pivot, b: add(pivot, scale(along, rest.length)) };
  }
}
