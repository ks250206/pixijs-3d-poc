import type { Actor, ActorKind, WeaponId } from "../../game/types";
import { strikePose, type Strike } from "./choreography";
import { clamp, clamp01, mix, smooth } from "./math";
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
  /** The strike being thrown, when the actor is attacking with a move that has a segment. */
  strike: Strike | null;
}

/** Which fighting style an actor's attack poses borrow. */
export function poseStyle(kind: ActorKind, weapon: WeaponId): WeaponId {
  if (kind === "player") return weapon;
  if (kind === "bruiser" || kind === "boss" || kind === "warden") return "pile";
  return kind === "scout" ? "arc" : "razor";
}

type Side = "L" | "R";
const setHand = (pose: CorePose, side: Side, x: number, y: number, z: number): void => {
  pose[`hand${side}X`] = x;
  pose[`hand${side}Y`] = y;
  pose[`hand${side}Z`] = z;
};
/** How the player carries each weapon between attacks. */
function carry(pose: CorePose, weapon: WeaponId): void {
  if (weapon === "razor") {
    pose.hipY -= 0.05;
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

/** Where each weapon rides while running: extra elevation, heading and drop of its carry. */
const RUN_CARRY: Record<WeaponId, { pitch: number; yaw: number; drop: number }> = {
  arc: { pitch: -1.15, yaw: 0.5, drop: -0.14 },
  pile: { pitch: -0.45, yaw: 0.2, drop: -0.05 },
  razor: { pitch: 0, yaw: 0, drop: 0 },
  lance: { pitch: -0.22, yaw: 0, drop: -0.06 },
  cannon: { pitch: -0.08, yaw: 0, drop: -0.04 },
  scythe: { pitch: 0.3, yaw: 0.25, drop: 0 },
};

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
  pose.carryPitch += air(0.25, 0.55);
  setHand(pose, "L", -0.2, air(-0.42, -0.2), 0.32);
  setHand(pose, "R", 0.2, air(-0.5, -0.26), air(0.3, 0.18));
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
    if (kind === "player") {
      // Two-handed and guard carries keep their grip instead of pumping the arms.
      if (ctx.weapon !== "arc") {
        setHand(pose, "R", hands.R[0]!, hands.R[1]!, hands.R[2]! + (pose.handRZ - 0.06) * 0.2);
        setHand(pose, "L", hands.L[0]!, hands.L[1]!, hands.L[2]! + (pose.handLZ - 0.06) * 0.2);
      } else setHand(pose, "R", hands.R[0]!, hands.R[1]!, hands.R[2]!);
      // Running, each weapon settles where it is least in the way.
      const pace = clamp01(ctx.gait.speed / 6);
      const run = RUN_CARRY[ctx.weapon];
      pose.carryPitch += run.pitch * pace;
      pose.carryYaw += run.yaw * pace;
      pose.carryY += run.drop * pace;
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
      // Drawn back over the shoulder, shaking a little as the charge builds.
      pose.carryPitch += 1.05 + Math.sin(ctx.time * 31) * 0.025;
      pose.carryYaw += 0.45;
      pose.carryZ -= 0.16;
      break;
    case "attack":
      if (ctx.airborne) airborne(pose, ctx);
      if (ctx.strike) strikePose(pose, ctx.strike);
      else {
        // A reach with nothing in it: a missed grab.
        pose.hipY -= 0.08;
        pose.chestPitch += 0.18;
        setHand(pose, "L", 0.14, -0.2, 0.6);
        setHand(pose, "R", -0.1, -0.24, 0.5);
        pose.carryPitch -= 0.5;
        pose.carryYaw += 0.6;
      }
      break;
    case "grab":
    case "shield":
      pose.hipY -= 0.1;
      setHand(pose, "L", 0.12, -0.16, 0.5);
      setHand(pose, "R", -0.12, -0.2, 0.52);
      pose.footLZ += 0.12;
      pose.footRZ -= 0.1;
      // Weapon across the body as a guard.
      pose.carryPitch += 0.25;
      pose.carryYaw -= 0.75;
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
      pose.carryPitch -= 0.9;
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
      pose.carryPitch -= 0.7;
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
      pose.carryPitch += 0.5;
      pose.carryYaw += 0.7;
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
