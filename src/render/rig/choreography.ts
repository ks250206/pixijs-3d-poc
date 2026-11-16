import type { AttackDirection, AttackKind, WeaponId } from "../../game/types";
import { clamp, mix, smooth, type V3 } from "./math";
import type { CorePose } from "./skeleton";

/** What the body needs to know about a strike. Everything derives from the simulation's move. */
export interface Strike {
  style: WeaponId;
  kind: AttackKind;
  direction: AttackDirection;
  trajectory: "slash" | "thrust" | "orbit" | "burst";
  /** Move clock: 0–1 wind-up, 1–2 live hit frames, 2–3 recovery. */
  clock: number;
  /** Rig-space unit direction of the weapon, pivot to tip. */
  aim: V3;
  /** Continuous heading of the weapon about the body, weighted by how level it is (radians). */
  turn: number;
  /** Fraction of the move's reach currently extended. */
  extension: number;
  /** Whole move, in seconds. */
  duration: number;
  /** Position in a jab combo (0, 1, 2); the last is the finisher. */
  combo: number;
  charge: number;
  airborne: boolean;
  /** The hand that leads the strike. */
  main: "L" | "R";
  /** The strike fires a projectile instead of swinging a weapon. */
  ranged: boolean;
  /** The body slides or flies through this move (dash, rush, phase, leap). */
  travelling: boolean;
}

/** Piecewise-smooth keyframe curve: `keys` are `[time, value]` pairs in ascending time. */
export function track(time: number, keys: readonly (readonly [number, number])[]): number {
  const first = keys[0]!;
  if (time <= first[0]) return first[1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i]!;
    if (time <= t1) {
      const [t0, v0] = keys[i - 1]!;
      return mix(v0, v1, smooth((time - t0) / Math.max(1e-6, t1 - t0)));
    }
  }
  return keys[keys.length - 1]![1];
}

/**
 * Per-weapon weight transfer. Distances are rig units, angles radians.
 * `back`/`drive`: how far the hips load onto the rear foot, then travel over the front foot.
 * `coil`/`sink`: hip height while winding up and at the moment of the strike (negative is lower).
 * `lean`: trunk pitch at wind-up and at the strike. `stride`: front-foot step. `recoil`: rebound.
 */
interface Weight {
  back: number;
  drive: number;
  coil: number;
  sink: number;
  leanBack: number;
  lean: number;
  stride: number;
  recoil: number;
}
const WEIGHT: Record<WeaponId, Weight> = {
  arc: { back: 0.07, drive: 0.13, coil: -0.05, sink: -0.09, leanBack: -0.06, lean: 0.16, stride: 0.24, recoil: 0.05 },
  pile: { back: 0.12, drive: 0.15, coil: 0.03, sink: -0.2, leanBack: -0.2, lean: 0.34, stride: 0.26, recoil: 0.13 },
  razor: { back: 0.05, drive: 0.15, coil: -0.06, sink: -0.1, leanBack: -0.02, lean: 0.14, stride: 0.2, recoil: 0.03 },
  lance: { back: 0.1, drive: 0.24, coil: -0.07, sink: -0.15, leanBack: 0, lean: 0.22, stride: 0.36, recoil: 0.06 },
  cannon: { back: 0.08, drive: 0.12, coil: -0.05, sink: -0.13, leanBack: -0.1, lean: 0.24, stride: 0.22, recoil: 0.1 },
  scythe: { back: 0.05, drive: 0.06, coil: -0.08, sink: -0.13, leanBack: -0.04, lean: 0.1, stride: 0.12, recoil: 0.05 },
}; // prettier-ignore

/** How much of the body a kind of attack commits: a jab is mostly arm, a smash is everything. */
const COMMIT: Record<AttackKind, number> = {
  jab: 0.5, tilt: 0.8, dash: 0.85, smash: 1.1, aerial: 0.9, throw: 0.5, special: 0.85, enemy: 0.85,
}; // prettier-ignore

const setHand = (pose: CorePose, side: "L" | "R", x: number, y: number, z: number): void => {
  pose[`hand${side}X`] = x;
  pose[`hand${side}Y`] = y;
  pose[`hand${side}Z`] = z;
};

/**
 * Lays a strike's body motion over `pose` (the stance it starts from). The weapon's own path is
 * already decided by the simulation; this is the body that swings it: the trunk turns with the
 * weapon, weight loads onto the rear foot and drives over the front one, and the frame rebounds
 * after the hit.
 */
export function strikePose(pose: CorePose, s: Strike): void {
  const w = WEIGHT[s.style];
  const finisher = s.kind === "jab" && s.combo % 3 === 2;
  const commit = (finisher ? 0.78 : COMMIT[s.kind]) * (1 + s.charge * 0.25);
  const c = s.clock;
  const side = s.main === "R" ? 1 : -1;
  const off = s.main === "R" ? "L" : "R";
  const spin = s.trajectory === "orbit" || s.trajectory === "burst";
  const thrust = s.trajectory === "thrust" && s.direction !== "up" && s.direction !== "down";
  // 0 → 1 across the wind-up, held through the strike, released over the recovery.
  const engaged = track(c, [[0, 0], [0.5, 1], [2.3, 1], [3, 0]]); // prettier-ignore

  // --- Trunk turns with the weapon; a spin or a strike behind takes the whole body round.
  const around = smooth((Math.abs(s.turn) - 1.3) / 1.2);
  // A spin's wind-up eases the body round to where the live arc starts, then it turns one to one.
  const follow = spin ? smooth(c) : mix(commit * 0.85, 0.95, around);
  const hipTurn = s.turn * follow * (spin ? 1 : mix(0.42, 0.62, around));
  pose.hipYaw += hipTurn;
  pose.chestYaw += spin ? 0 : s.turn * follow * mix(0.5, 0.3, around);
  const elevation = Math.asin(clamp(s.aim.y, -1, 1));
  pose.chestPitch -= elevation * 0.2 * commit * engaged;

  // --- Weight transfer.
  const up = s.direction === "up";
  const low = s.direction === "down" && !s.airborne;
  const sink = up ? 0.03 : low ? w.sink - 0.1 : w.sink;
  const lean = up ? -0.12 : low ? w.lean + 0.14 : w.lean;
  const shift = track(c, [[0, 0], [0.6, -w.back], [1, -w.back * 0.3], [1.5, w.drive], [2.2, w.drive * 0.7], [3, 0]]); // prettier-ignore
  const height = track(c, [[0, 0], [0.6, w.coil], [1.5, sink], [2.3, sink * 0.6], [3, 0]]); // prettier-ignore
  const pitch = track(c, [[0, 0], [0.6, w.leanBack], [1.5, lean], [2.2, lean * 0.5], [3, 0]]); // prettier-ignore
  const grounded = !s.airborne && !spin;
  if (grounded) pose.hipZ += shift * commit;
  pose.hipY += height * commit * (s.airborne ? 0.3 : 1);
  pose.chestPitch += pitch * commit * 0.7;
  pose.hipPitch += pitch * commit * 0.3;

  // --- A thrust throws the striking shoulder forward after drawing it back.
  // -0.5: drawn back to the hip; 1: thrown out to full reach.
  const reach = track(c, [[0, 0], [0.6, -0.5], [1.5, 1], [2.4, 0.3], [3, 0]]); // prettier-ignore
  if (thrust) {
    pose.chestYaw -= side * 0.38 * reach * commit;
    pose.hipYaw -= side * 0.16 * reach * commit;
  }

  // --- Rebound once the strike has landed: the heavier the weapon, the bigger the bounce.
  if (c > 2) {
    const r = c - 2;
    // Fades to nothing by the last frame, so the strike leaves no residue in the stance.
    const bounce = w.recoil * commit * Math.exp(-4.5 * r) * Math.sin(r * 9.5) * (1 - r);
    pose.chestPitch -= bounce;
    if (grounded) pose.hipZ -= bounce * 0.5;
  }
  if (s.ranged) {
    // Brace, then take the kick of the shot through the hips.
    const kick = c >= 1 ? Math.exp(-2.6 * (c - 1)) : 0;
    const brace = track(c, [[0, 0], [0.8, 1], [1, 1], [1.2, 0]]); // prettier-ignore
    pose.hipY -= 0.07 * brace;
    pose.chestPitch += 0.1 * brace - 0.24 * kick;
    if (grounded) pose.hipZ -= 0.15 * kick;
  }

  // --- Feet: step into the strike with the foot opposite the leading hand.
  const lead = off;
  const rear = s.main;
  if (s.travelling) {
    pose.plant = 0;
    pose.hipY -= 0.12;
    pose.chestPitch += 0.3;
    pose[`foot${lead}Z`] += 0.4;
    pose[`foot${rear}Z`] -= 0.42;
    pose[`foot${rear}Y`] += s.airborne ? 0.16 : 0.06;
    pose[`foot${rear}Pitch`] += 0.6;
  } else if (s.airborne) {
    // Tuck through the wind-up, then throw the legs out against the swing.
    const kick = track(c, [[0, 0], [0.7, -1], [1.4, 1], [2.4, 0.4], [3, 0]]); // prettier-ignore
    pose[`foot${lead}Z`] += 0.16 * kick;
    pose[`foot${lead}Y`] += 0.1 * Math.max(0, -kick);
    pose[`foot${rear}Z`] -= 0.3 * Math.max(0, kick);
    pose[`foot${rear}Y`] += 0.12 * Math.abs(kick);
    if (s.direction === "down") {
      pose.footLY += 0.14 * engaged;
      pose.footRY += 0.2 * engaged;
    }
  } else if (spin) {
    // Pivot the stance with the hips' turn instead of wringing the legs.
    const cos = Math.cos(hipTurn),
      sin = Math.sin(hipTurn);
    for (const foot of ["L", "R"] as const) {
      const x = pose[`foot${foot}X`] * mix(1, 1.25, engaged),
        z = pose[`foot${foot}Z`];
      pose[`foot${foot}X`] = x * cos + z * sin;
      pose[`foot${foot}Z`] = -x * sin + z * cos;
    }
    pose.plant = 0;
  } else {
    // Short moves have no time for a full step.
    const stride = w.stride * commit * clamp(s.duration / 0.4, 0.35, 1) * (1 - around) * (up ? 0.4 : 1);
    pose[`foot${lead}Z`] += track(c, [[0, 0], [0.7, 0.04], [1.3, stride], [2.3, stride], [3, 0]]); // prettier-ignore
    pose[`foot${rear}Z`] -= track(c, [[0, 0], [0.6, 0.08], [1.4, stride * 0.55], [2.3, stride * 0.45], [3, 0]]); // prettier-ignore
    pose[`foot${lead}X`] -= side * 0.03 * engaged;
    pose[`foot${rear}X`] += side * 0.03 * engaged;
  }

  // --- Hands. The leading hand's target only chooses where along the shaft it grips.
  // A thrusting hand pulls back toward the body, then travels out along the shaft.
  const mainHand = { x: -side * 0.04, y: -0.28, z: thrust ? 0.3 + 0.32 * reach : 0.42 };
  setHand(pose, s.main, mix(pose[`hand${s.main}X`], mainHand.x, engaged), mix(pose[`hand${s.main}Y`], mainHand.y, engaged), mix(pose[`hand${s.main}Z`], mainHand.z, engaged)); // prettier-ignore
  // The free hand counterbalances: forward while the weapon is cocked, back as it swings through.
  const counter =
    s.style === "razor"
      ? { x: side * 0.14, y: -0.16, z: track(c, [[0, 0.34], [1.5, 0.22], [3, 0.34]]) } // prettier-ignore
      : { x: -side * 0.2, y: -0.34, z: track(c, [[0, 0.2], [0.7, 0.36], [1.5, -0.16], [2.4, -0.04], [3, 0.12]]) }; // prettier-ignore
  setHand(pose, off, mix(pose[`hand${off}X`], counter.x, engaged), mix(pose[`hand${off}Y`], counter.y, engaged), mix(pose[`hand${off}Z`], counter.z, engaged)); // prettier-ignore

  // --- The head keeps looking where the body was facing instead of riding the twist.
  if (!spin) {
    pose.headYaw -= clamp(pose.hipYaw + pose.chestYaw, -1, 1) * 0.7;
    pose.headPitch -= pose.chestPitch * 0.5;
  }
}
