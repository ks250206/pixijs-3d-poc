import {
  add,
  clamp,
  cross,
  distance,
  dot,
  length,
  normalize,
  quatFromBasis,
  reject,
  scale,
  sub,
  type Quat,
  type V3,
} from "./math";

/** Chains never straighten completely: a fully locked joint has no defined bend plane. */
export const MAX_EXTENSION = 0.995;

export interface TwoBone {
  /** Middle joint (elbow / knee). */
  mid: V3;
  /** End joint (wrist / ankle). Equals the target whenever the target is within reach. */
  end: V3;
  /** Unit in-plane direction from the root-end axis toward the middle joint. */
  bend: V3;
  /** False when the target had to be pulled inside the reachable shell. */
  reached: boolean;
}

/**
 * Analytic two-bone IK. Bone lengths are preserved exactly; an out-of-range target moves the end
 * joint along the root→target ray instead of stretching a bone.
 */
export function solveTwoBone(root: V3, target: V3, upper: number, lower: number, pole: V3): TwoBone {
  const offset = sub(target, root);
  const wanted = length(offset);
  const axis = normalize(offset, { x: 0, y: -1, z: 0 });
  const reach = clamp(
    wanted,
    Math.abs(upper - lower) + (upper + lower) * (1 - MAX_EXTENSION),
    (upper + lower) * MAX_EXTENSION,
  );
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, upper * upper - along * along));
  const bend = reject(pole, axis, { x: 0, y: 0, z: -1 });
  return {
    mid: add(add(root, scale(axis, along)), scale(bend, height)),
    end: add(root, scale(axis, reach)),
    bend,
    reached: Math.abs(reach - wanted) < 1e-6,
  };
}

/**
 * Orientation of a rigid bone whose mesh hangs along local -Y from `from` to `to`.
 * `front` is the world direction the bone's local +Z should face (made perpendicular to the bone).
 */
export function boneQuat(from: V3, to: V3, front: V3): Quat {
  const y = normalize(sub(from, to), { x: 0, y: 1, z: 0 });
  const z = reject(front, y, { x: 0, y: 0, z: 1 });
  return quatFromBasis(cross(y, z), y, z);
}

export interface Grip {
  /** Distance of the grip from the segment start, along the segment. */
  s: number;
  point: V3;
  /** How far beyond `reach` the nearest allowed point is; 0 when the hand can hold it. */
  miss: number;
}

/**
 * Chooses where a hand holds a straight weapon. The grip stays on the segment `a + s·u`,
 * `s ∈ [min, max]`, as near `wanted` as the shoulder's reach allows — the hand slides along the
 * shaft rather than leaving it or stretching the arm.
 */
export function gripOnSegment(
  a: V3,
  u: V3,
  shoulder: V3,
  reach: number,
  wanted: number,
  min: number,
  max: number,
): Grip {
  const rel = sub(a, shoulder);
  const half = dot(u, rel);
  const disc = half * half - (dot(rel, rel) - reach * reach);
  if (disc >= 0) {
    const root = Math.sqrt(disc);
    const low = Math.max(min, -half - root),
      high = Math.min(max, -half + root);
    if (low <= high) {
      // Reachable by construction: report no miss rather than the rounding error of re-measuring.
      const s = clamp(wanted, low, high);
      return { s, point: add(a, scale(u, s)), miss: 0 };
    }
  }
  // The reachable stretch lies wholly outside the allowed one: take the nearest allowed point.
  const s = clamp(-half, min, max);
  const point = add(a, scale(u, s));
  return { s, point, miss: Math.max(0, distance(point, shoulder) - reach) };
}
