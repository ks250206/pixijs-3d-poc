import type { ActorKind } from "../../game/types";
import { boneQuat, gripOnSegment, solveTwoBone, MAX_EXTENSION } from "./ik";
import {
  add,
  distance,
  dot,
  lerp,
  mixAngle,
  mix,
  normalize,
  quatMul,
  quatYawPitchRoll,
  rotate,
  scale,
  smooth,
  sub,
  type Quat,
  type V3,
} from "./math";

/**
 * Joint layout of a humanoid, in rig units (the actor's own unscaled space: +Z forward, +Y up,
 * +X toward the robot's right hand). The numbers mirror the box meshes built by `RobotView`.
 */
export interface RigSpec {
  /** Height of the hips pivot at rest. */
  hipsY: number;
  /** Hip joints relative to the hips pivot. */
  hipX: number;
  hipDrop: number;
  thigh: number;
  shin: number;
  /** Ankle joint above the sole. */
  ankle: number;
  /** How far the sole extends in front of and behind the ankle. */
  toe: number;
  heel: number;
  /** Shoulder joints relative to the chest pivot (which sits on the hips pivot). */
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  forearm: number;
  headY: number;
}

export function rigSpec(kind: ActorKind): RigSpec {
  const boss = kind === "boss" || kind === "warden";
  const heavy = boss || kind === "bruiser" || kind === "sentinel";
  const width = boss ? 1.12 : heavy ? 0.86 : 0.64;
  return {
    hipsY: 0.95,
    hipX: width * 0.3,
    hipDrop: 0.07,
    thigh: 0.46,
    shin: 0.32,
    ankle: 0.1,
    toe: 0.37,
    heel: 0.11,
    shoulderX: width / 2 + 0.16,
    shoulderY: 0.51,
    upperArm: 0.37,
    forearm: 0.39,
    headY: 0.92,
  };
}

/**
 * Every animated quantity is one named scalar, so poses blend channel by channel.
 * Hands are offsets from their shoulder in the chest frame; feet are rig-space sole positions.
 */
export const CHANNELS = [
  "hipX", "hipY", "hipZ", "hipYaw", "hipPitch", "hipRoll",
  "chestYaw", "chestPitch", "chestRoll", "headYaw", "headPitch",
  "handLX", "handLY", "handLZ", "handRX", "handRY", "handRZ",
  "elbowLX", "elbowLY", "elbowLZ", "elbowRX", "elbowRY", "elbowRZ",
  "footLX", "footLY", "footLZ", "footRX", "footRY", "footRZ",
  "footLPitch", "footRPitch", "kneeLX", "kneeRX",
  /**
   * How a carried weapon departs from its rest pose: pivot offset in the chest frame, extra
   * elevation and heading of the shaft. Ignored while an attack's own segment drives the weapon.
   */
  "carryX", "carryY", "carryZ", "carryPitch", "carryYaw",
  /** Whole-body pitch about the ground contact (knockback tumble). */
  "tumble",
  /** 1: feet are anchored to the floor by the foot planter; 0: they follow the pose. */
  "plant",
] as const; // prettier-ignore
export type Channel = (typeof CHANNELS)[number];
export type CorePose = Record<Channel, number>;

export function restPose(spec: RigSpec): CorePose {
  const stance = spec.hipX + 0.03;
  return {
    hipX: 0, hipY: -0.035, hipZ: 0, hipYaw: 0, hipPitch: 0, hipRoll: 0,
    chestYaw: 0, chestPitch: 0, chestRoll: 0, headYaw: 0, headPitch: 0,
    handLX: -0.08, handLY: -0.69, handLZ: 0.1, handRX: 0.08, handRY: -0.69, handRZ: 0.1,
    elbowLX: -0.35, elbowLY: -0.1, elbowLZ: -1, elbowRX: 0.35, elbowRY: -0.1, elbowRZ: -1,
    footLX: -stance, footLY: 0, footLZ: 0, footRX: stance, footRY: 0, footRZ: 0,
    footLPitch: 0, footRPitch: 0, kneeLX: -0.12, kneeRX: 0.12,
    carryX: 0, carryY: 0, carryZ: 0, carryPitch: 0, carryYaw: 0,
    tumble: 0, plant: 1,
  }; // prettier-ignore
}

/** Channel-wise blend. Hip yaw takes the short way round so spins never unwind backwards. */
export function blendPose(a: CorePose, b: CorePose, t: number, out: CorePose = { ...a }): CorePose {
  for (const key of CHANNELS)
    out[key] = key === "hipYaw" ? mixAngle(a[key], b[key], t) : mix(a[key], b[key], t);
  return out;
}

export interface Xform {
  p: V3;
  q: Quat;
}

/** A straight weapon the hands must hold, in rig space. */
export interface WeaponConstraint {
  a: V3;
  b: V3;
  /** The hand that always holds the weapon. */
  main: "L" | "R";
  /** Allowed grip distances from `a` for the main hand. */
  mainMin: number;
  mainMax: number;
  /** When set, the other hand holds the shaft this far from the main grip while it can reach. */
  offSpacing?: number;
}

/** A hand pointed along a direction instead of holding a weapon (enemy strikes, aimed guns). */
export interface AimConstraint {
  hand: "L" | "R";
  /** Rig-space point the hand reaches toward. */
  toward: V3;
  /** Fraction of full arm length to extend. */
  extend: number;
}

export interface SolvedRig {
  hips: Xform;
  chest: Xform;
  head: Xform;
  upperArmL: Xform;
  forearmL: Xform;
  upperArmR: Xform;
  forearmR: Xform;
  thighL: Xform;
  shinL: Xform;
  footL: Xform;
  thighR: Xform;
  shinR: Xform;
  footR: Xform;
  handL: V3;
  handR: V3;
  /**
   * Grip distances along the weapon segment, when a weapon is held. `off` is set only while the
   * off hand is exactly on the shaft. `miss` is how far the main hand falls short of it: 0 unless
   * the shaft is beyond anything the body can reach.
   */
  grip: { main: number; off: number | null; miss: number } | null;
}

export interface Feet {
  /** Rig-space sole positions; `y` is the lift above the floor. */
  L: V3;
  R: V3;
  /** True while that foot is anchored to the floor (it then limits how high the hips can sit). */
  plantedL: boolean;
  plantedR: boolean;
  /** 0: the foot keeps the rig's heading (anchored); 1: it turns with the hips. Defaults to `!planted`. */
  looseL?: number;
  looseR?: number;
}

/**
 * Forward kinematics for the trunk, then IK for all four limbs. Bones are rigid: every returned
 * joint pair is exactly one bone length apart, whatever the pose or constraints ask for.
 */
export function solveRig(
  spec: RigSpec,
  pose: CorePose,
  feet: Feet,
  weapon: WeaponConstraint | null = null,
  aim: AimConstraint | null = null,
  /** Decaying rig-space hand offsets that ease a hand into or out of a constraint. */
  bias: { L: V3; R: V3 } | null = null,
): SolvedRig {
  const legLength = (spec.thigh + spec.shin) * MAX_EXTENSION;
  const armLength = (spec.upperArm + spec.forearm) * MAX_EXTENSION;
  const hipsQ = quatYawPitchRoll(pose.hipYaw, pose.hipPitch, pose.hipRoll);
  const hipsP: V3 = { x: pose.hipX, y: spec.hipsY + pose.hipY, z: pose.hipZ };
  /**
   * A pitched foot rolls about its ground contact — the toe when pitched down, the heel when
   * pitched up — so that contact point stays exactly where the flat sole put it.
   */
  const footFrame = (sole: V3, pitch: number, loose: number) => {
    const yaw = pose.hipYaw * 0.5 * loose;
    const q = quatYawPitchRoll(yaw, pitch, 0);
    const contact = pitch >= 0 ? spec.toe : -spec.heel;
    const pivot = add(sole, rotate(quatYawPitchRoll(yaw, 0, 0), { x: 0, y: 0, z: contact }));
    return { q, ankle: sub(pivot, rotate(q, { x: 0, y: -spec.ankle, z: contact })) };
  };
  const footL = footFrame(feet.L, pose.footLPitch, feet.looseL ?? (feet.plantedL ? 0 : 1)),
    footR = footFrame(feet.R, pose.footRPitch, feet.looseR ?? (feet.plantedR ? 0 : 1));
  const ankleL = footL.ankle,
    ankleR = footR.ankle;
  const hipJoint = (side: number): V3 =>
    add(hipsP, rotate(hipsQ, { x: side * spec.hipX, y: -spec.hipDrop, z: 0 }));

  // Anchored feet win over the authored hip height: sink the hips until both legs can reach.
  const sink = () => {
    for (const [side, target, planted] of [
      [-1, ankleL, feet.plantedL],
      [1, ankleR, feet.plantedR],
    ] as const) {
      if (!planted) continue;
      const joint = hipJoint(side);
      const horizontal = Math.hypot(joint.x - target.x, joint.z - target.z);
      const limit = target.y + Math.sqrt(Math.max(0.01, legLength * legLength - horizontal * horizontal));
      if (joint.y > limit) hipsP.y -= joint.y - limit;
    }
  };
  sink();

  const chestQ = quatMul(hipsQ, quatYawPitchRoll(pose.chestYaw, pose.chestPitch, pose.chestRoll));
  // The chest pivots on the hips pivot, so it follows every later hips correction.
  const chestP = hipsP;
  const shoulder = (side: number): V3 =>
    add(chestP, rotate(chestQ, { x: side * spec.shoulderX, y: spec.shoulderY, z: 0 }));
  const free = (side: "L" | "R"): V3 =>
    add(
      shoulder(side === "R" ? 1 : -1),
      rotate(chestQ, { x: pose[`hand${side}X`], y: pose[`hand${side}Y`], z: pose[`hand${side}Z`] }),
    );

  let grip: SolvedRig["grip"] = null;
  let targetL: V3, targetR: V3;
  if (weapon) {
    const axis = sub(weapon.b, weapon.a);
    const span = Math.hypot(axis.x, axis.y, axis.z);
    const u = normalize(axis, { x: 0, y: 0, z: 1 });
    const mainSide = weapon.main === "R" ? 1 : -1;
    const hold = (side: number, wanted: number, min: number, max: number) =>
      gripOnSegment(weapon.a, u, shoulder(side), armLength, wanted, min, Math.min(max, span));
    const holdMain = () =>
      hold(mainSide, dot(sub(free(weapon.main), weapon.a), u), weapon.mainMin, weapon.mainMax);
    let main = holdMain();
    for (let pass = 0; pass < 8 && main.miss > 0; pass++) {
      // The shaft passes outside the arm's reach: carry the whole trunk toward it.
      const before = { ...hipsP };
      const pull = sub(main.point, shoulder(mainSide));
      const move = (by: V3) => {
        hipsP.x = before.x + by.x;
        hipsP.y = before.y + by.y;
        hipsP.z = before.z + by.z;
        sink();
        return holdMain();
      };
      // Progress is judged against the miss itself, so even a hair's shortfall gets closed.
      const gain = Math.min(1e-4, main.miss * 0.5);
      let next = move(scale(normalize(pull), main.miss + 0.01));
      if (next.miss > main.miss - gain) {
        // Planted legs took the lift back: step in under the shaft instead of reaching up for it.
        const level = { x: pull.x, y: 0, z: pull.z };
        if (Math.hypot(level.x, level.z) < 1e-6) break;
        next = move(scale(normalize(level), main.miss + 0.02));
        if (next.miss > main.miss - gain) {
          Object.assign(hipsP, before);
          sink();
          break;
        }
      }
      main = next;
    }
    main = holdMain();
    targetL = free("L");
    targetR = free("R");
    grip = { main: main.s, off: null, miss: main.miss };
    if (weapon.main === "R") targetR = main.point;
    else targetL = main.point;
    if (weapon.offSpacing !== undefined) {
      const ahead = weapon.offSpacing >= 0;
      const low = ahead ? Math.min(span, main.s + 0.12) : 0;
      const high = ahead ? span : Math.max(0, main.s - 0.12);
      const off = hold(-mainSide, main.s + weapon.offSpacing, low, high);
      // Let go smoothly instead of snapping when the shaft swings out of the off hand's reach.
      const held = 1 - smooth(off.miss / 0.18);
      if (off.miss === 0) grip.off = off.s;
      if (weapon.main === "R") targetL = lerp(targetL, off.point, held);
      else targetR = lerp(targetR, off.point, held);
    }
  } else {
    targetL = free("L");
    targetR = free("R");
  }
  if (aim) {
    const side = aim.hand === "R" ? 1 : -1;
    const from = shoulder(side);
    const reach = (spec.upperArm + spec.forearm) * aim.extend;
    const to = add(from, scale(normalize(sub(aim.toward, from), { x: 0, y: 0, z: 1 }), reach));
    if (aim.hand === "R") targetR = to;
    else targetL = to;
  }

  if (bias) {
    targetL = add(targetL, bias.L);
    targetR = add(targetR, bias.R);
  }

  const arm = (side: "L" | "R", target: V3) => {
    const root = shoulder(side === "R" ? 1 : -1);
    const pole = rotate(chestQ, { x: pose[`elbow${side}X`], y: pose[`elbow${side}Y`], z: pose[`elbow${side}Z`] });
    const solved = solveTwoBone(root, target, spec.upperArm, spec.forearm, pole);
    // The inside of the elbow faces away from where the elbow points.
    const inner = scale(solved.bend, -1);
    return {
      upper: { p: root, q: boneQuat(root, solved.mid, inner) },
      fore: { p: solved.mid, q: boneQuat(solved.mid, solved.end, inner) },
      hand: solved.end,
    };
  };
  const leg = (side: "L" | "R", target: V3, footQ: Quat) => {
    const sign = side === "R" ? 1 : -1;
    const root = hipJoint(sign);
    const forward = rotate(quatYawPitchRoll(pose.hipYaw, 0, 0), { x: pose[`knee${side}X`], y: 0.15, z: 1 });
    const solved = solveTwoBone(root, target, spec.thigh, spec.shin, forward);
    return {
      thigh: { p: root, q: boneQuat(root, solved.mid, solved.bend) },
      shin: { p: solved.mid, q: boneQuat(solved.mid, solved.end, solved.bend) },
      // The foot hangs from the solved ankle, so an unreachable target lifts it instead of detaching it.
      foot: { p: solved.end, q: footQ },
    };
  };

  const left = arm("L", targetL),
    right = arm("R", targetR);
  const legL = leg("L", ankleL, footL.q),
    legR = leg("R", ankleR, footR.q);
  const headQ = quatMul(chestQ, quatYawPitchRoll(pose.headYaw, pose.headPitch, 0));
  return {
    hips: { p: hipsP, q: hipsQ },
    chest: { p: chestP, q: chestQ },
    head: { p: add(chestP, rotate(chestQ, { x: 0, y: spec.headY, z: 0 })), q: headQ },
    upperArmL: left.upper, forearmL: left.fore, upperArmR: right.upper, forearmR: right.fore,
    thighL: legL.thigh, shinL: legL.shin, footL: legL.foot,
    thighR: legR.thigh, shinR: legR.shin, footR: legR.foot,
    handL: left.hand, handR: right.hand, grip,
  }; // prettier-ignore
}

/** Joint-to-joint lengths of a solved rig, for invariants and diagnostics. */
export function boneLengths(rig: SolvedRig) {
  return {
    upperArmL: distance(rig.upperArmL.p, rig.forearmL.p),
    forearmL: distance(rig.forearmL.p, rig.handL),
    upperArmR: distance(rig.upperArmR.p, rig.forearmR.p),
    forearmR: distance(rig.forearmR.p, rig.handR),
    thighL: distance(rig.thighL.p, rig.shinL.p),
    shinL: distance(rig.shinL.p, rig.footL.p),
    thighR: distance(rig.thighR.p, rig.shinR.p),
    shinR: distance(rig.shinR.p, rig.footR.p),
  };
}
