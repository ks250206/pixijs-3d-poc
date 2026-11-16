import type { WeaponId } from "../types";
import { activeEnd, type MoveDefinition } from "./moves";

/**
 * The weapon's motion over a whole move, in the attacker's own frame: +X is the way the attacker
 * faces, +Y up, +Z the front lane. The tip is `reach · extension · aim` from the pivot.
 *
 * Live hit frames keep the long-standing strike arc exactly. The wind-up before them and the
 * follow-through after them are authored here as well, so simulation snapshots, the rendered
 * weapon and the skeleton that holds it all read one trajectory.
 */
export interface WeaponPose {
  /** Not normalized: lane depth is compressed, exactly as the strike arc always was. */
  aim: { x: number; y: number; z: number };
  /** Fraction of the move's reach currently extended. */
  extension: number;
  /** Pivot offset along facing (the grip side) and pivot height above the attacker's feet. */
  pivotX: number;
  pivotY: number;
}

const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
const DEG = Math.PI / 180;

/** How each weapon is carried between attacks: elevation of the shaft and its length in metres. */
export const WEAPON_REST: Record<WeaponId, { angle: number; length: number }> = {
  arc: { angle: 52 * DEG, length: 1.25 },
  pile: { angle: 64 * DEG, length: 1.35 },
  razor: { angle: 18 * DEG, length: 0.55 },
  lance: { angle: 14 * DEG, length: 2.3 },
  cannon: { angle: 4 * DEG, length: 1.15 },
  scythe: { angle: 58 * DEG, length: 1.75 },
};

export const PIVOT_X = 0.3;
export const PIVOT_Y = 1.15;
/** Extension at both ends of the live window; the strike arc peaks at 1 in between. */
const LIVE_EDGE = 0.75;

const sideOf = (move: MoveDefinition) => (move.direction === "back" ? -1 : 1);
const fixedAim = (move: MoveDefinition) =>
  !move.shape.arc &&
  (move.direction === "up" ||
    (move.direction === "down" && move.shape.trajectory !== "burst" && move.shape.trajectory !== "orbit"));

/**
 * Aim of an authored arc at parameter `p`; `p ∈ [0,1]` is the hit window, outside it the sweep
 * simply continues, which is what the wind-up and the follow-through travel along.
 */
export function arcAim(shape: MoveDefinition["shape"], p: number): WeaponPose["aim"] {
  const arc = shape.arc!;
  const angle = arc.from + (arc.to - arc.from) * p;
  if (arc.plane === "vertical") return { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
  return { x: Math.cos(angle), y: arc.tilt ?? 0, z: Math.sin(angle) * Math.min(1, shape.depth / shape.reach) };
}
/** Height of an arc's pivot: it travels across the hit window and holds at either end. */
const arcPivot = (shape: MoveDefinition["shape"], p: number) =>
  mix(shape.arc!.pivotY[0], shape.arc!.pivotY[1], clamp(p, 0, 1));

/** Where the strike arc points at parameter `p`; `p ∈ [0,1]` is the live arc itself. */
function strikeAim(move: MoveDefinition, p: number): WeaponPose["aim"] {
  const { shape, direction } = move;
  const sign = sideOf(move);
  const live = clamp(p, 0, 1);
  if (shape.arc) return arcAim(shape, p);
  if (fixedAim(move)) {
    // Vertical strikes hold one line while live; they swing onto it and carry on past it.
    const [x, y, swingIn, swingOut] =
      direction === "up" ? [0.24, 0.97, 100, 60] : move.kind === "aerial" ? [0.24, -0.97, -150, -40] : [0.96, -0.28, -80, -30]; // prettier-ignore
    if (p >= 0 && p <= 1) return { x: sign * x, y, z: 0 };
    // Off the line the aim turns in the vertical plane, keeping the line's own length so it meets it exactly.
    const angle = Math.atan2(y, x) + (p < 0 ? p * swingIn : (p - 1) * swingOut) * DEG;
    const length = Math.hypot(x, y);
    return { x: sign * Math.cos(angle) * length, y: Math.sin(angle) * length, z: 0 };
  }
  if (shape.trajectory === "orbit" || shape.trajectory === "burst") {
    const angle = -Math.PI / 2 + p * Math.PI * 2;
    return {
      x: Math.cos(angle),
      // Wound back, the blade lifts; it levels out exactly as the live arc begins.
      y: Math.max(0, -p) * 1.2,
      z: Math.sin(angle) * Math.min(1, shape.depth / shape.reach),
    };
  }
  if (shape.trajectory === "slash") {
    const angle = -0.85 + p * 1.7;
    // A three-hit combo cuts level, then rising, then down from overhead: the live arc is shared,
    // so the hits differ in where the blade comes from and where it carries on to.
    const stage = move.kind === "jab" ? move.combo % 3 : 0;
    const y =
      move.pose === "pile"
        ? 0.55 - p * 0.85
        : Math.sin(live * Math.PI) * 0.15 +
          Math.max(0, -p) * [0.55, -0.4, 1.05][stage]! -
          Math.max(0, p - 1) * [0.5, -0.35, 0.75][stage]!;
    return {
      x: Math.cos(angle) * sign,
      y,
      z: Math.sin(angle) * Math.min(1, shape.depth / shape.reach),
    };
  }
  // Thrusts keep their line; drawing back lifts the point a little.
  return { x: sign, y: Math.max(0, -p) * 0.22, z: 0 };
}

/** How far the wind-up cocks back along the arc, and the most a follow-through may overshoot. */
function arcLimits(move: MoveDefinition): { cock: number; follow: number; cocked: number } {
  if (move.shape.arc) {
    // Wind back a set angle whatever the sweep's size: a full spin needs proportionally little.
    const sweep = Math.abs(move.shape.arc.to - move.shape.arc.from);
    return { cock: -Math.min(0.32, 0.75 / sweep), follow: Math.min(0.3, 0.6 / sweep), cocked: 0.5 };
  }
  if (fixedAim(move)) return { cock: -1, follow: 0.7, cocked: 0.52 };
  switch (move.shape.trajectory) {
    case "slash": {
      // The finisher of a combo winds up further than the hits that set it up.
      const finisher = move.kind === "jab" && move.combo % 3 === 2 ? 1.25 : 1;
      return move.pose === "pile"
        ? { cock: -0.62 * finisher, follow: 0.42, cocked: 0.5 }
        : { cock: -0.5 * finisher, follow: 0.46, cocked: 0.52 };
    }
    case "orbit":
    case "burst":
      return { cock: -0.11, follow: 0.25, cocked: 0.55 };
    default:
      // A thrust has no arc to overshoot; the third hit of a combo draws back furthest.
      return { cock: -1, follow: 0, cocked: move.kind === "jab" && move.combo % 3 === 2 ? 0.22 : 0.3 };
  }
}

function restAim(move: MoveDefinition): WeaponPose["aim"] {
  const { angle } = WEAPON_REST[move.pose];
  return { x: Math.cos(angle), y: Math.sin(angle), z: 0 };
}

/** Turns between two aims along the great arc, interpolating their lengths. */
function turn(a: WeaponPose["aim"], b: WeaponPose["aim"], t: number): WeaponPose["aim"] {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const la = Math.hypot(a.x, a.y, a.z) || 1,
    lb = Math.hypot(b.x, b.y, b.z) || 1;
  const cos = clamp((a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb), -1, 1);
  const angle = Math.acos(cos);
  const length = mix(la, lb, t);
  if (angle < 1e-4) return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t), z: mix(a.z, b.z, t) };
  let wa: number, wb: number;
  if (Math.PI - angle < 1e-3) {
    // Opposed aims have no unique arc: go over the top.
    const half = t < 0.5 ? t * 2 : (t - 0.5) * 2;
    const up = { x: 0, y: la, z: 0 };
    return t < 0.5 ? turn(a, up, half) : turn(up, b, half);
  }
  const sin = Math.sin(angle);
  wa = Math.sin((1 - t) * angle) / sin / la;
  wb = Math.sin(t * angle) / sin / lb;
  return {
    x: (a.x * wa + b.x * wb) * length,
    y: (a.y * wa + b.y * wb) * length,
    z: (a.z * wa + b.z * wb) * length,
  };
}

/** Fraction of the recovery spent decelerating out of the strike. */
const CARRY = 0.55;

/**
 * Weapon pose at `frame` of `move`. Frames inside the live window reproduce the original strike
 * arc bit for bit; callers must treat every other frame as presentation only.
 */
export function weaponPose(move: MoveDefinition, frame: number): WeaponPose {
  const { frames, shape } = move;
  const end = activeEnd(move);
  const sign = shape.arc ? 1 : sideOf(move);
  /** Pivot height while the weapon is on its strike path, at path parameter `p`. */
  const strikeY = (p: number) =>
    shape.arc ? arcPivot(shape, p) : shape.trajectory === "burst" ? Math.min(1, shape.height / 2) : PIVOT_Y;
  // At rest the weapon is its natural length, whatever this move's reach is.
  const restExtension = WEAPON_REST[move.pose].length / Math.max(0.1, shape.reach);
  const rest = restAim(move);
  const limits = arcLimits(move);
  // A wind-up of a few frames has no time for a full draw: it cocks back proportionally less.
  const depth = clamp(frames.startup / 8, 0.45, 1);
  limits.cock *= depth;
  const total = end + frames.recovery;

  if (frame >= frames.startup && frame <= end) {
    const t = clamp((frame - frames.startup) / Math.max(1, frames.active), 0, 1);
    return {
      aim: strikeAim(move, t),
      extension: LIVE_EDGE + 0.25 * Math.sin(t * Math.PI),
      pivotX: sign * PIVOT_X,
      pivotY: strikeY(t),
    };
  }

  if (frame < frames.startup) {
    const u = clamp(frame / Math.max(1, frames.startup), 0, 1);
    // The weapon draws back, then is released into the strike. The release is sized so the weapon
    // arrives at the first hit frame moving as fast as the live arc does there: no hitch, no snap.
    // (Where the wind-up is too short for that, it simply has to hurry.)
    const liveSpeed = frames.startup / Math.max(1, frames.active);
    const release = clamp((-limits.cock * 1.3) / Math.max(1e-3, liveSpeed), 0.3, 0.7);
    const draw = 1 - release;
    const drawn = smooth(u / draw);
    const out = clamp((u - draw) / release, 0, 1);
    const power = clamp((liveSpeed * release) / -limits.cock, 1.3, 5);
    const p = u <= draw ? mix(limits.cock * 0.5, limits.cock, drawn) : limits.cock * (1 - out ** power);
    let cocked = Math.min(limits.cocked, LIVE_EDGE);
    // A thrust is drawn back shorter than it is carried, or there is nothing to throw.
    if (shape.trajectory === "thrust" && !shape.arc && !fixedAim(move)) cocked = Math.min(cocked, restExtension * 0.7);
    if (cocked < restExtension) cocked = mix(restExtension, cocked, depth);
    const reachOut = clamp((0.25 * Math.PI * liveSpeed * release) / Math.max(1e-3, LIVE_EDGE - cocked), 1.2, 4);
    const blend = smooth(u / 0.5);
    return {
      aim: turn(rest, strikeAim(move, p), blend),
      extension:
        u <= draw ? mix(restExtension, cocked, drawn) : cocked + (LIVE_EDGE - cocked) * out ** reachOut,
      pivotX: PIVOT_X * mix(1, sign, blend),
      pivotY: mix(PIVOT_Y, strikeY(p), blend),
    };
  }

  if (frame >= total || frames.recovery <= 0) {
    return { aim: rest, extension: restExtension, pivotX: PIVOT_X, pivotY: PIVOT_Y };
  }
  const u = clamp((frame - end) / frames.recovery, 0, 1);
  // Overshoot as far as the live arc's exit speed carries, up to the weapon's limit.
  const exitSpeed = frames.recovery / Math.max(1, frames.active);
  const follow = Math.min(limits.follow, (exitSpeed * CARRY) / 2);
  const p = 1 + follow * (1 - (1 - Math.min(1, u / CARRY)) ** 2);
  // Start home early: the heavier swings have a long way back and should not rush it.
  const settle = smooth((u - 0.25) / 0.75);
  // A thrust snaps back past its guard before settling: the recoil.
  const recoil =
    shape.trajectory === "thrust" && !shape.arc && !fixedAim(move) ? Math.sin(Math.PI * smooth(u)) * 0.07 : 0;
  return {
    aim: turn(strikeAim(move, p), rest, settle),
    extension: Math.max(0.12, mix(LIVE_EDGE, restExtension, smooth(u)) - recoil),
    pivotX: PIVOT_X * mix(sign, 1, settle),
    pivotY: mix(strikeY(p), PIVOT_Y, settle),
  };
}
