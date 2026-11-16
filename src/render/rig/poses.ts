import type { Actor, ActorKind, WeaponId } from "../../game/types";
import { attackMotion } from "../motion";
import { clamp, clamp01, mix, smooth, type V3 } from "./math";
import { restPose, type CorePose, type RigSpec } from "./skeleton";

/** Everything a pose may read. Poses are pure functions of this snapshot. */
export interface PoseContext {
  spec: RigSpec;
  kind: ActorKind;
  actor: Actor;
  weapon: WeaponId;
  time: number;
  /** Run-cycle clock from the foot planter, so arms and hips stay in step with the feet. */
  gait: { phase: number; speed: number; moving: boolean; velocity: { x: number; z: number } };
  airborne: boolean;
  mounted: boolean;
}

/** Which fighting style an actor's attack poses borrow. */
export function poseStyle(kind: ActorKind, weapon: WeaponId): WeaponId {
  if (kind === "player") return weapon;
  if (kind === "bruiser" || kind === "boss" || kind === "warden") return "pile";
  return kind === "scout" ? "arc" : "razor";
}

/**
 * Direction of a straight arm for a shoulder Euler rotation `(x, y, z)` in the renderer's order
 * (about Z, then Y, then X). Bridges the authored shoulder angles to IK hand targets.
 */
export function armDirection(x: number, y: number, z: number): V3 {
  const sx = Math.sin(z) * Math.cos(y),
    sy = -Math.cos(z),
    sz = -Math.sin(z) * Math.sin(y);
  return { x: sx, y: sy * Math.cos(x) - sz * Math.sin(x), z: sy * Math.sin(x) + sz * Math.cos(x) };
}

type Side = "L" | "R";
const setHand = (pose: CorePose, side: Side, x: number, y: number, z: number): void => {
  pose[`hand${side}X`] = x;
  pose[`hand${side}Y`] = y;
  pose[`hand${side}Z`] = z;
};
const mixHand = (pose: CorePose, side: Side, to: V3, t: number): void => {
  pose[`hand${side}X`] = mix(pose[`hand${side}X`], to.x, t);
  pose[`hand${side}Y`] = mix(pose[`hand${side}Y`], to.y, t);
  pose[`hand${side}Z`] = mix(pose[`hand${side}Z`], to.z, t);
};

/** How the player carries each weapon between attacks. */
function carry(pose: CorePose, weapon: WeaponId): void {
  if (weapon === "razor") {
    pose.hipY -= 0.08;
    setHand(pose, "R", -0.14, -0.2, 0.4);
    setHand(pose, "L", 0.14, -0.14, 0.36);
    pose.elbowRY = pose.elbowLY = -1;
    pose.elbowRZ = pose.elbowLZ = -0.3;
  } else if (weapon === "lance" || weapon === "cannon") {
    setHand(pose, "R", 0.02, -0.36, 0.36);
    setHand(pose, "L", 0.26, -0.34, 0.42);
  } else if (weapon === "scythe") {
    setHand(pose, "R", 0.03, -0.5, 0.3);
    setHand(pose, "L", 0.26, -0.34, 0.42);
  } else setHand(pose, "R", 0.08, -0.64, 0.2);
}

function locomotion(pose: CorePose, ctx: PoseContext): void {
  const { gait } = ctx;
  const pace = clamp01(gait.speed / 6);
  const cycle = gait.phase * Math.PI * 2;
  // The left foot lands at phase 0, so the right arm is forward there.
  const swing = Math.cos(cycle) * mix(0.16, 0.34, pace);
  pose.hipY -= mix(0.03, 0.09, pace) + Math.cos(cycle * 2) * 0.022 * pace;
  pose.chestPitch += mix(0.05, 0.2, pace) * Math.sign(gait.velocity.z || 1);
  pose.hipPitch += 0.06 * pace;
  pose.hipYaw += Math.cos(cycle) * 0.12 * pace;
  pose.chestYaw -= Math.cos(cycle) * 0.26 * pace;
  pose.hipRoll += Math.sin(cycle) * 0.04 * pace;
  setHand(pose, "R", 0.1, -0.52 + Math.abs(swing) * 0.1, 0.06 + swing);
  setHand(pose, "L", -0.1, -0.52 + Math.abs(swing) * 0.1, 0.06 - swing);
}

function airborne(pose: CorePose, ctx: PoseContext): void {
  // Blend through the apex instead of switching pose the frame the fall begins.
  const rise = smooth(ctx.actor.vy / 8 + 0.5);
  const air = (rising: number, falling: number) => mix(falling, rising, rise);
  const stance = ctx.spec.hipX;
  pose.plant = 0;
  pose.footLX = -stance;
  pose.footRX = stance;
  pose.footLY = air(0.34, 0.2);
  pose.footLZ = air(0.24, 0.12);
  pose.footRY = air(0.16, 0.1);
  pose.footRZ = air(-0.2, -0.08);
  pose.footLPitch = 0.35;
  pose.footRPitch = 0.6;
  pose.chestPitch += air(0.08, -0.06);
  setHand(pose, "L", -0.2, air(-0.42, -0.2), 0.32);
  setHand(pose, "R", 0.2, air(-0.5, -0.26), air(0.3, 0.18));
}

function attack(pose: CorePose, ctx: PoseContext): void {
  const attackState = ctx.actor.attack;
  if (!attackState) return;
  const motion = attackMotion(attackState, poseStyle(ctx.kind, ctx.weapon));
  const w = motion.weight;
  // Small turns twist the chest over planted feet; full spins carry the whole body round.
  const spin = Math.abs(motion.bodyY) > 1.4;
  pose.hipYaw += motion.bodyY * w * (spin ? 1 : 0.4);
  pose.chestYaw += spin ? 0 : motion.bodyY * w * 0.6;
  pose.chestPitch += motion.bodyX * w * 0.7;
  pose.hipPitch += motion.bodyX * w * 0.3;
  pose.hipY += motion.crouch * w;
  for (const side of ["L", "R"] as const) {
    const m = side === "L" ? "left" : "right";
    const dir = armDirection(motion[`${m}ArmX`], motion[`${m}ArmY`], motion[`${m}ArmZ`]);
    const reach = (ctx.spec.upperArm + ctx.spec.forearm) * 0.93;
    mixHand(pose, side, { x: dir.x * reach, y: dir.y * reach, z: dir.z * reach }, w);
    const stride = -Math.sin(motion[`${m}LegX`]) * 0.7 * w;
    pose[`foot${side}Z`] += stride;
    if (ctx.airborne) pose[`foot${side}Y`] += Math.max(0, -stride) * 0.3;
  }
  if (spin) {
    // Pivot the stance with the hips instead of wringing the legs.
    const c = Math.cos(pose.hipYaw),
      s = Math.sin(pose.hipYaw);
    for (const side of ["L", "R"] as const) {
      const x = pose[`foot${side}X`],
        z = pose[`foot${side}Z`];
      pose[`foot${side}X`] = x * c + z * s;
      pose[`foot${side}Z`] = -x * s + z * c;
    }
    pose.plant = 0;
  }
  const sliding = attackState.kind === "dash" || ["rush", "phase", "leap"].includes(attackState.move?.behavior ?? "");
  if (sliding) pose.plant = 0;
}

/** The authored pose for the actor's current state, before blending and constraints. */
export function statePose(ctx: PoseContext): CorePose {
  const { actor, spec, kind } = ctx;
  const pose = restPose(spec);
  const stance = spec.hipX + 0.03;
  pose.hipY += Math.sin(ctx.time * 2.3) * 0.012;
  pose.chestPitch += Math.sin(ctx.time * 2.3 + 0.6) * 0.012;
  if (kind === "player") carry(pose, ctx.weapon);
  if (kind === "gunner") setHand(pose, "R", 0, -0.32, 0.56);

  const state = actor.state;
  if (ctx.airborne && state !== "attack" && state !== "hurt" && state !== "grabbed") airborne(pose, ctx);
  else if (ctx.gait.moving && (state === "run" || state === "idle")) {
    const hands = { R: [pose.handRX, pose.handRY, pose.handRZ], L: [pose.handLX, pose.handLY, pose.handLZ] };
    locomotion(pose, ctx);
    // Two-handed and guard carries keep their grip instead of pumping the arms.
    if (kind === "player" && ctx.weapon !== "arc" && ctx.weapon !== "pile") {
      setHand(pose, "R", hands.R[0]!, hands.R[1]!, hands.R[2]! + (pose.handRZ - 0.06) * 0.2);
      setHand(pose, "L", hands.L[0]!, hands.L[1]!, hands.L[2]! + (pose.handLZ - 0.06) * 0.2);
    }
  }

  switch (state) {
    case "charge":
      pose.chestPitch += 0.16;
      pose.chestYaw -= 0.35;
      pose.hipY -= 0.14;
      setHand(pose, "R", 0.16, 0.3, -0.34);
      setHand(pose, "L", 0.1, -0.3, 0.42);
      pose.footLZ += 0.2;
      pose.footRZ -= 0.22;
      break;
    case "attack":
      if (ctx.airborne) airborne(pose, ctx);
      attack(pose, ctx);
      break;
    case "grab":
    case "shield":
      pose.hipY -= 0.1;
      setHand(pose, "L", 0.12, -0.16, 0.5);
      setHand(pose, "R", -0.12, -0.2, 0.52);
      pose.footLZ += 0.12;
      pose.footRZ -= 0.1;
      break;
    case "dodge":
      pose.chestPitch += 0.6;
      pose.hipY -= 0.14;
      pose.plant = 0;
      pose.footLZ = 0.42;
      pose.footRZ = -0.4;
      pose.footRY = 0.12;
      pose.footRPitch = 0.7;
      setHand(pose, "L", -0.1, -0.4, 0.4);
      setHand(pose, "R", 0.12, -0.45, -0.3);
      break;
    case "wavedash":
      pose.hipY -= 0.24;
      pose.chestPitch += 0.38;
      pose.plant = 0;
      pose.footLZ = 0.36;
      pose.footRZ = -0.34;
      pose.footLX = -stance - 0.08;
      pose.footRX = stance + 0.08;
      setHand(pose, "R", 0.16, -0.5, -0.36);
      break;
    case "hurt":
    case "grabbed": {
      pose.chestPitch -= 0.38;
      pose.headPitch -= 0.25;
      pose.plant = 0;
      setHand(pose, "L", -0.3, -0.1, 0.4);
      setHand(pose, "R", 0.3, -0.2, 0.36);
      pose.footLZ = 0.2;
      pose.footRZ = -0.12;
      pose.footLY = ctx.airborne ? 0.22 : 0;
      pose.footRY = ctx.airborne ? 0.1 : 0;
      // Knocked back: the trunk goes first and the feet trail.
      pose.tumble = clamp(ctx.gait.velocity.z * 0.05, -0.9, 0.9);
      break;
    }
  }

  if (kind === "sentinel" && actor.guard > 0 && (state === "idle" || state === "run")) {
    pose.chestYaw += 0.25;
    setHand(pose, "L", 0.1, -0.5, 0.32);
  }
  if (ctx.mounted) {
    pose.plant = 0;
    pose.hipY = 0.5;
    pose.footLX = -0.5;
    pose.footRX = 0.5;
    pose.footLY = pose.footRY = 0.72;
    pose.footLZ = pose.footRZ = 0.42;
    pose.kneeLX = -0.6;
    pose.kneeRX = 0.6;
  }
  return pose;
}
