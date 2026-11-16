import type { Actor } from "../types";
import { activeEnd, type MoveDefinition } from "./moves";
import { arcAim, weaponPose } from "./trajectory";
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}
export interface Capsule {
  a: Vec3;
  b: Vec3;
  radius: number;
}
export interface Hurtbox {
  min: Vec3;
  max: Vec3;
}
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  z: mix(a.z, b.z, t),
});

/**
 * World axes: +X stage right, +Y up, +Z front. Facing mirrors X only.
 *
 * The one source of weapon geometry for a whole move. Hit frames — `startup ≤ frame ≤ activeEnd` —
 * are the strike arc collision has always used, computed here exactly as before. The wind-up and
 * the follow-through around them come from `weaponPose`; nothing is ever hit on those frames, but
 * the rendered weapon and the skeleton holding it follow the same segment.
 */
export function sampleWeapon(
  actor: Pick<Actor, "x" | "y" | "z" | "facing">,
  move: MoveDefinition,
  frame: number,
): Capsule {
  const { shape, frames, direction } = move;
  // A tick can land a rounding error past the last hit frame and still be tested as that frame;
  // it must read the strike's final pose, not the first instant of the follow-through.
  if (frame < frames.startup || frame > activeEnd(move) + 1e-6) {
    const pose = weaponPose(move, frame);
    const origin = {
      x: actor.x + actor.facing * pose.pivotX,
      y: actor.y + pose.pivotY,
      z: actor.z,
    };
    const reach = shape.reach * pose.extension;
    return {
      a: origin,
      b: {
        x: origin.x + actor.facing * pose.aim.x * reach,
        y: origin.y + pose.aim.y * reach,
        z: origin.z + pose.aim.z * reach,
      },
      radius: shape.radius,
    };
  }
  const t = clamp((frame - frames.startup) / Math.max(1, frames.active), 0, 1);
  const extension = 0.75 + 0.25 * Math.sin(t * Math.PI);
  if (shape.arc) {
    // Up and down normals sweep an authored arc; the hands travel with it.
    const aim = arcAim(shape, t);
    const origin = { x: actor.x + actor.facing * 0.3, y: actor.y + mix(shape.arc.pivotY[0], shape.arc.pivotY[1], t), z: actor.z };
    const reach = shape.reach * extension;
    return {
      a: origin,
      b: { x: origin.x + actor.facing * aim.x * reach, y: origin.y + aim.y * reach, z: origin.z + aim.z * reach },
      radius: shape.radius,
    };
  }
  const sign = direction === "back" ? -1 : 1;
  let vx = sign,
    vy = 0,
    vz = 0;
  if (shape.trajectory === "orbit" || shape.trajectory === "burst") {
    const angle = -Math.PI / 2 + t * Math.PI * 2;
    vx = Math.cos(angle);
    vz = Math.sin(angle) * Math.min(1, shape.depth / shape.reach);
  } else if (shape.trajectory === "slash") {
    const angle = -0.85 + t * 1.7;
    vx = Math.cos(angle) * sign;
    vz = Math.sin(angle) * Math.min(1, shape.depth / shape.reach);
    vy = move.pose === "pile" ? 0.55 - t * 0.85 : Math.sin(t * Math.PI) * 0.15;
  }
  if (direction === "up") {
    vx = sign * 0.24;
    vy = 0.97;
    vz = 0;
  }
  if (direction === "down" && shape.trajectory !== "burst" && shape.trajectory !== "orbit") {
    vx = sign * (move.kind === "aerial" ? 0.24 : 0.96);
    vy = move.kind === "aerial" ? -0.97 : -0.28;
    vz = 0;
  }
  const origin = {
    x: actor.x + actor.facing * sign * 0.3,
    y: actor.y + (shape.trajectory === "burst" ? Math.min(1, shape.height / 2) : 1.15),
    z: actor.z,
  };
  const reach = shape.reach * extension;
  return {
    a: origin,
    b: {
      x: origin.x + actor.facing * vx * reach,
      y: origin.y + vy * reach,
      z: origin.z + vz * reach,
    },
    radius: shape.radius,
  };
}

export function bodyHurtbox(actor: Pick<Actor, "x" | "y" | "z" | "scale" | "kind">): Hurtbox {
  const width =
    (actor.kind === "boss" || actor.kind === "warden"
      ? 0.72
      : actor.kind === "bruiser"
        ? 0.48
        : 0.34) * actor.scale;
  const depth = (actor.kind === "boss" || actor.kind === "warden" ? 0.38 : 0.28) * actor.scale;
  return {
    min: { x: actor.x - width, y: actor.y + 0.03, z: actor.z - depth },
    max: { x: actor.x + width, y: actor.y + 2.08 * actor.scale, z: actor.z + depth },
  };
}

/** Exact minimum distance between a segment and an axis-aligned box (piecewise quadratic). */
export function segmentBox(a: Vec3, b: Vec3, box: Hurtbox): { distance: number; t: number } {
  const keys = ["x", "y", "z"] as const;
  const breaks = [0, 1];
  for (const k of keys)
    if (b[k] !== a[k])
      for (const v of [box.min[k], box.max[k]]) {
        const t = (v - a[k]) / (b[k] - a[k]);
        if (t > 0 && t < 1) breaks.push(t);
      }
  breaks.sort((x, y) => x - y);
  let best = Infinity,
    at = 0;
  const check = (t: number) => {
    const p = lerp(a, b, t);
    const d = keys.reduce((s, k) => s + (p[k] - clamp(p[k], box.min[k], box.max[k])) ** 2, 0);
    if (d < best - 1e-12) {
      best = d;
      at = t;
    }
  };
  for (let i = 0; i < breaks.length - 1; i++) {
    const low = breaks[i]!,
      high = breaks[i + 1]!,
      middle = (low + high) / 2;
    let numerator = 0,
      denominator = 0;
    for (const k of keys) {
      const p = mix(a[k], b[k], middle),
        bound = p < box.min[k] ? box.min[k] : p > box.max[k] ? box.max[k] : null;
      if (bound !== null) {
        const d = b[k] - a[k];
        numerator += d * (a[k] - bound);
        denominator += d * d;
      }
    }
    check(low);
    check(high);
    if (denominator) check(clamp(-numerator / denominator, low, high));
  }
  return { distance: Math.sqrt(best), t: at };
}

/** Fixed half-frame sampling plus swept endpoint edges avoids delta-dependent missed thrusts. */
export function sweptContact(
  actor: Pick<Actor, "x" | "y" | "z" | "facing">,
  move: MoveDefinition,
  from: number,
  to: number,
  box: Hurtbox,
  previous = actor,
  checkedPose?: Capsule,
): number | null {
  const low = Math.max(from, move.frames.startup),
    high = Math.min(to, activeEnd(move));
  if (
    move.frames.active <= 0 ||
    move.behavior === "none" ||
    high < low ||
    to < move.frames.startup ||
    from >= activeEnd(move)
  )
    return null;
  // Bound motion of every point on the shaft, including rotation interiors.
  const angularTravel =
    ((high - low) / Math.max(1, move.frames.active)) * move.shape.reach * Math.PI * 2;
  const actorTravel = Math.hypot(actor.x - previous.x, actor.y - previous.y, actor.z - previous.z);
  const count = Math.max(
    1,
    Math.ceil((high - low) * 2),
    Math.ceil((angularTravel + actorTravel) / Math.max(0.005, move.shape.radius / 3)),
  );
  let last: Capsule | null = null;
  for (let i = 0; i <= count; i++) {
    const frame = mix(low, high, i / count),
      alpha = to === from ? 1 : clamp((frame - from) / (to - from), 0, 1);
    const position = { ...lerp(previous, actor, alpha), facing: actor.facing };
    const c =
        checkedPose && Math.abs(frame - to) < 1e-8
          ? checkedPose
          : sampleWeapon(position, move, frame),
      contact = segmentBox(c.a, c.b, box);
    if (contact.distance <= c.radius) return move.shape.tip && contact.t >= 0.76 ? 1.35 : 1;
    if (last)
      for (const endpoint of ["a", "b"] as const)
        if (segmentBox(last[endpoint], c[endpoint], box).distance <= c.radius)
          return move.shape.tip && endpoint === "b" ? 1.35 : 1;
    last = c;
  }
  return null;
}
