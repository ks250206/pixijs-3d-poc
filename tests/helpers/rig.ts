import type { V3 } from '../../src/render/rig/math';
import { boneLengths, type RigSpec, type SolvedRig } from '../../src/render/rig/skeleton';

/** Deterministic PRNG (mulberry32) so property tests are reproducible. */
export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const range = (low: number, high: number) => low + (high - low) * next();
  const vec = (r: number): V3 => ({ x: range(-r, r), y: range(-r, r), z: range(-r, r) });
  const unit = (): V3 => {
    for (;;) {
      const v = vec(1);
      const l = Math.hypot(v.x, v.y, v.z);
      if (l > 0.1 && l <= 1) return { x: v.x / l, y: v.y / l, z: v.z / l };
    }
  };
  return { next, range, vec, unit, chance: (p: number) => next() < p };
}

/** Distance from `p` to segment a→b, and how far along the segment (from `a`) its nearest point is. */
export function segmentDistance(p: V3, a: V3, b: V3): { distance: number; along: number } {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
  const span = Math.hypot(d.x, d.y, d.z);
  const t = span > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * d.x + (p.y - a.y) * d.y + (p.z - a.z) * d.z) / (span * span))) : 0;
  const q = { x: a.x + d.x * t, y: a.y + d.y * t, z: a.z + d.z * t };
  return { distance: Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z), along: t * span };
}

/** World point → rig space: rig = Ry(-yaw)·(world − actorPos)/scale. Written independently of the source. */
export function worldToRig(actor: { x: number; y: number; z: number; scale: number }, yaw: number, p: V3): V3 {
  const dx = (p.x - actor.x) / actor.scale,
    dz = (p.z - actor.z) / actor.scale;
  return {
    x: dx * Math.cos(yaw) - dz * Math.sin(yaw),
    y: (p.y - actor.y) / actor.scale,
    z: dx * Math.sin(yaw) + dz * Math.cos(yaw),
  };
}

/**
 * Rig point → world as the robot root places it: world = actor + Ry(yaw)·Rx(tumble)·p·scale.
 * With no tumble this is the inverse of `worldToRig`; written independently of the source.
 */
export function rigToWorld(actor: { x: number; y: number; z: number; scale: number }, yaw: number, p: V3, tumble = 0): V3 {
  const y = p.y * Math.cos(tumble) - p.z * Math.sin(tumble),
    z = p.y * Math.sin(tumble) + p.z * Math.cos(tumble);
  return {
    x: actor.x + (p.x * Math.cos(yaw) + z * Math.sin(yaw)) * actor.scale,
    y: actor.y + y * actor.scale,
    z: actor.z + (-p.x * Math.sin(yaw) + z * Math.cos(yaw)) * actor.scale,
  };
}

/** Paths of every non-finite number inside a value. */
export function nonFinite(value: unknown, path = '$', out: string[] = []): string[] {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path}=${value}`);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) nonFinite(child, `${path}.${key}`, out);
  }
  return out;
}

/** Bones whose solved joint-to-joint length differs from the spec by more than `tolerance`. */
export function stretchedBones(spec: RigSpec, rig: SolvedRig, tolerance = 1e-9): string[] {
  const expected: Record<keyof ReturnType<typeof boneLengths>, number> = {
    upperArmL: spec.upperArm, forearmL: spec.forearm, upperArmR: spec.upperArm, forearmR: spec.forearm,
    thighL: spec.thigh, shinL: spec.shin, thighR: spec.thigh, shinR: spec.shin,
  }; // prettier-ignore
  const lengths = boneLengths(rig);
  return (Object.keys(expected) as (keyof typeof expected)[])
    .filter((bone) => !(Math.abs(lengths[bone] - expected[bone]) <= tolerance))
    .map((bone) => `${bone}: ${lengths[bone]} != ${expected[bone]}`);
}

/** Every joint position of a solved rig, by name. */
export function joints(rig: SolvedRig): Record<string, V3> {
  return {
    hips: rig.hips.p, head: rig.head.p,
    shoulderL: rig.upperArmL.p, elbowL: rig.forearmL.p, handL: rig.handL,
    shoulderR: rig.upperArmR.p, elbowR: rig.forearmR.p, handR: rig.handR,
    hipL: rig.thighL.p, kneeL: rig.shinL.p, ankleL: rig.footL.p,
    hipR: rig.thighR.p, kneeR: rig.shinR.p, ankleR: rig.footR.p,
  }; // prettier-ignore
}
