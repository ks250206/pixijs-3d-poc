import type { AttackDirection, AttackKind, Loadout, WeaponId } from "../types";

export type BehaviorId =
  | "none"
  | "melee"
  | "projectile"
  | "cannon"
  | "phase"
  | "rush"
  | "leap"
  | "area"
  | "mortar";
export type CancelAction = "attack" | "special" | "jump" | "dodge";
/**
 * A strike that sweeps an arc instead of following the weapon's default trajectory.
 * `vertical` sweeps the plane ahead of the fighter: angles are elevations from the facing direction
 * (0 forward, π/2 straight up, π behind, negative below). `level` sweeps a horizontal plane:
 * angles are headings (0 forward, positive toward the near lane), with the blade tilted by `tilt`.
 * The pivot — the hands — travels from the first height to the second across the sweep.
 */
export interface StrikeArc {
  plane: "vertical" | "level";
  from: number;
  to: number;
  pivotY: readonly [number, number];
  /** Level sweeps only: constant vertical component of the aim (negative dips toward the floor). */
  tilt?: number;
}

export interface MoveDefinition {
  id: string;
  name: string;
  kind: AttackKind;
  direction: AttackDirection;
  behavior: BehaviorId;
  pose: WeaponId;
  frames: { startup: number; active: number; recovery: number };
  shape: {
    trajectory: "slash" | "thrust" | "orbit" | "burst";
    reach: number;
    radius: number;
    tip: boolean;
    height: number;
    depth: number;
    /** Set for up and down normals; replaces `trajectory` on every frame of the move. */
    arc?: StrikeArc;
  };
  damage: number;
  force: number;
  growth: number;
  angle: number;
  charge: number;
  combo: number;
  cancels: { on: "hit" | "whiff"; from: number; to: number; actions: readonly CancelAction[] }[];
}
/**
 * Seconds a target stays stunned, at least, after a grounded down normal pops it up — long enough
 * that even the slowest weapon's up attack arrives while it still cannot act.
 */
export const POP_STUN = 0.36;
/** A grounded down normal: the launcher that leads into an up attack. */
export const popsUp = (m: MoveDefinition) =>
  m.direction === "down" && (m.kind === "tilt" || m.kind === "smash") && m.angle > 1;

export const totalFrames = (m: MoveDefinition) =>
  m.frames.startup + m.frames.active + m.frames.recovery;
export const activeEnd = (m: MoveDefinition) => m.frames.startup + m.frames.active;

const style: Record<
  WeaponId,
  {
    reach: number;
    timing: number;
    startup: number;
    force: number;
    shape: MoveDefinition["shape"]["trajectory"];
    radius: number;
  }
> = {
  arc: { reach: 1.18, timing: 1, startup: 1, force: 1, shape: "slash", radius: 0.25 },
  pile: { reach: 1, timing: 1.13, startup: 1.3, force: 1.1, shape: "slash", radius: 0.42 },
  razor: { reach: 0.86, timing: 0.78, startup: 0.7, force: 1, shape: "thrust", radius: 0.3 },
  lance: { reach: 2, timing: 1.3, startup: 1.5, force: 1, shape: "thrust", radius: 0.14 },
  cannon: { reach: 1, timing: 1, startup: 1, force: 1, shape: "thrust", radius: 0.4 },
  scythe: { reach: 1.45, timing: 1.35, startup: 1.7, force: 0.72, shape: "orbit", radius: 0.4 },
};

const DEG = Math.PI / 180;
const vertical = (from: number, to: number, pivotFrom: number, pivotTo: number): StrikeArc => ({
  plane: "vertical", from: from * DEG, to: to * DEG, pivotY: [pivotFrom, pivotTo],
}); // prettier-ignore
const level = (from: number, to: number, pivot: number, tilt: number): StrikeArc => ({
  plane: "level", from: from * DEG, to: to * DEG, pivotY: [pivot, pivot], tilt,
}); // prettier-ignore

/**
 * How each weapon attacks upward and downward. Degrees; see `StrikeArc`.
 *
 * Up: a rising crescent from low in front, over the head and on behind it, the hands travelling
 * from the hip to overhead — it covers the front, the air above and a little behind, instead of
 * poking one vertical line.
 * Down, grounded: a low mowing sweep across both lanes (or an overhead slam, or a full low spin),
 * launching upward so it leads into an up attack.
 * Down, airborne: a crescent or wheel under the fighter, still a spike.
 */
const ARCS: Record<WeaponId, { up: StrikeArc; airUp: StrikeArc; down: StrikeArc; airDown: StrikeArc }> = {
  // Pivot heights and end angles are bounded by the body: the hands must be able to hold the
  // shaft where each weapon is gripped, and a blade passing overhead has to clear the head.
  arc: {
    up: vertical(-20, 135, 1.0, 1.75), airUp: vertical(-15, 140, 1.3, 1.75),
    down: level(-105, 105, 0.55, -0.12), airDown: vertical(-15, -165, 0.95, 0.8),
  },
  pile: {
    up: vertical(10, 128, 1.0, 1.62), airUp: vertical(5, 135, 1.3, 1.62),
    down: vertical(110, -38, 1.6, 1.0), airDown: vertical(70, -95, 1.6, 1.0),
  },
  razor: {
    up: vertical(-35, 110, 0.9, 1.7), airUp: vertical(-20, 125, 1.25, 1.7),
    down: level(-80, 80, 0.5, -0.1), airDown: vertical(-30, -150, 0.95, 0.8),
  },
  lance: {
    up: vertical(10, 112, 1.05, 1.6), airUp: vertical(5, 120, 1.3, 1.6),
    down: level(-55, 55, 0.45, -0.05), airDown: vertical(-65, -105, 1.0, 0.9),
  },
  cannon: {
    up: vertical(0, 120, 1.0, 1.7), airUp: vertical(0, 130, 1.3, 1.7),
    down: vertical(100, -32, 1.6, 1.0), airDown: vertical(-20, -140, 0.95, 0.8),
  },
  scythe: {
    up: vertical(-30, 140, 1.0, 1.6), airUp: vertical(-20, 150, 1.3, 1.6),
    down: level(-90, 270, 0.5, -0.06), airDown: vertical(90, -270, 1.15, 1.15),
  },
}; // prettier-ignore

/** All normal weapon tuning, timing, collision, pose and executable cancel windows. */
export function playerMove(
  loadout: Loadout,
  kind: AttackKind,
  direction: AttackDirection,
  combo: number,
  charge: number,
): MoveDefinition {
  let damage = 11,
    force = 5,
    growth = 0.1,
    reach = 2.25,
    duration = 23,
    startup = 6,
    angle = 0.5;
  if (kind === "jab") {
    damage = 5 + combo * 2;
    force = combo === 2 ? 7 : 2.5;
    growth = combo === 2 ? 0.09 : 0.035;
    reach = 1.95;
    duration = 13;
    startup = 3;
  }
  if (kind === "dash") {
    damage = 12;
    force = 7;
    reach = 2.55;
    duration = 29;
  }
  if (kind === "smash") {
    damage = 18 * (1 + charge * 0.8);
    force = 10 * (1 + charge * 0.55);
    growth = 0.155;
    reach = 2.9;
    duration = 38;
    startup = 8;
  }
  if (kind === "aerial") {
    damage = direction === "back" ? 14 : 11;
    force = direction === "back" ? 7 : 5;
    duration = 24;
  }
  if (direction === "up") {
    angle = 1.28;
    reach *= 0.85;
  }
  if (direction === "down") {
    // In the air a down attack spikes. On the ground it pops the target up, softly enough that
    // an up attack can follow.
    angle = kind === "aerial" ? -1.15 : 1.2;
    if (kind !== "aerial") growth *= 0.7;
  }
  const s = style[loadout.weapon];
  reach *= s.reach;
  force *= s.force;
  duration = Math.round(duration * s.timing);
  startup = Math.max(2, Math.round(startup * s.startup));
  const cannon =
    loadout.weapon === "cannon" && direction !== "up" && direction !== "down" && kind !== "dash";
  if (loadout.weapon === "cannon") {
    duration = kind === "smash" ? 63 : 40;
    startup = kind === "smash" ? 16 : 11;
    if (cannon) {
      reach = kind === "smash" ? 12 : 9;
      damage *= 1.3;
    }
  }
  if (loadout.modules?.weapon === "quick") {
    startup = Math.max(2, startup - 1);
    duration = Math.max(startup + 10, duration - 2);
    damage *= 0.9;
  } else if (loadout.modules?.weapon === "breaker") {
    damage *= 1.12;
    force *= 1.08;
    startup += 2;
    duration += 3;
  }
  const active = Math.min(kind === "smash" ? 10 : 8, duration - startup - 2);
  // Keep the strike itself responsive, but commit normals to a longer follow-through.
  if (kind !== "smash") duration += 6;
  const recovery = duration - startup - active;
  const label =
    kind === "jab"
      ? `JAB ${combo + 1}`
      : `${direction.toUpperCase()} ${kind === "aerial" ? "AIR" : kind.toUpperCase()}`;
  const cancels: MoveDefinition["cancels"] =
    kind === "smash"
      ? []
      : [
          {
            on: "hit",
            from: startup + Math.min(active, 3),
            to: duration - 1,
            actions: ["jump", "dodge"],
          },
          {
            on: "hit",
            from: startup + Math.min(active, 3) + 6,
            to: duration - 1,
            actions: ["attack", "special"],
          },
          { on: "whiff", from: startup + active + 2, to: duration - 1, actions: ["dodge"] },
        ];
  return {
    id: `${loadout.weapon}.${kind}.${direction}.${combo}.${loadout.modules?.weapon ?? "standard"}`,
    name:
      loadout.weapon === "lance"
        ? `LANCE / ${label}`
        : loadout.weapon === "scythe"
          ? `ORBIT / ${label}`
          : loadout.weapon === "cannon"
            ? `${cannon ? "CANNON SHOT" : "CANNON BASH"} / ${label}`
            : label,
    kind,
    direction,
    pose: loadout.weapon,
    behavior: cannon ? "cannon" : "melee",
    frames: { startup, active, recovery },
    shape: {
      trajectory: s.shape,
      reach,
      radius: s.radius,
      tip: loadout.weapon === "lance",
      height: direction === "up" ? 3.5 : 1.85,
      depth: loadout.weapon === "scythe" ? 2.5 : 1.35,
      ...((direction === "up" || direction === "down") && (kind === "tilt" || kind === "smash" || kind === "aerial")
        ? { arc: ARCS[loadout.weapon][direction === "up" ? (kind === "aerial" ? "airUp" : "up") : kind === "aerial" ? "airDown" : "down"] }
        : {}),
    },
    damage: damage * loadout.power,
    force: force * loadout.power,
    growth: growth * loadout.power,
    angle,
    charge,
    combo,
    cancels: cancels.filter((c) => c.from <= c.to),
  };
}

export function canCancel(
  move: MoveDefinition,
  frame: number,
  landed: boolean,
  action: CancelAction,
): boolean {
  return move.cancels.some(
    (c) =>
      c.on === (landed ? "hit" : "whiff") &&
      frame >= c.from &&
      frame <= c.to &&
      c.actions.includes(action),
  );
}

/** Typed constructor for utility/enemy moves; labels never select behavior. */
export function utilityMove(
  id: string,
  name: string,
  kind: AttackKind,
  direction: AttackDirection,
  duration: number,
  reach: number,
  options: Partial<MoveDefinition> & {
    startup?: number;
    end?: number;
    radial?: boolean;
    depth?: number;
    height?: number;
  } = {},
): MoveDefinition {
  const { startup = 12, end = 21, radial = false, depth = 1.2, height = 1.9, ...rest } = options;
  const total = Math.round(duration * 60),
    start = Math.round(startup),
    stop = Math.round(end);
  if (start < 0 || stop < start || stop > total || total > 300)
    throw new RangeError(`Invalid move frames: ${id}`);
  return {
    id,
    name,
    kind,
    direction,
    behavior: "melee",
    pose: "arc",
    frames: { startup: start, active: stop - start, recovery: Math.max(0, total - stop) },
    shape: {
      trajectory: radial ? "burst" : "slash",
      reach,
      radius: radial ? 0.48 : 0.35,
      tip: false,
      height,
      depth,
    },
    damage: 8,
    force: 6,
    growth: 0.065,
    angle: 0.55,
    charge: 0,
    combo: 0,
    cancels: [],
    ...rest,
  };
}

/** Rolled slots all resolve here; UP always retains the same viable recovery. */
export function specialMove(loadout: Loadout, direction: AttackDirection): MoveDefinition {
  const modules = loadout.modules;
  const common = { pose: loadout.weapon, damage: 14 * loadout.power, force: 7, growth: 0.11 };
  if (direction === "up")
    return utilityMove("special.recovery", "RISING CIRCUIT", "special", "up", 0.58, 2.3, {
      ...common,
      startup: 2,
      end: 24,
      radial: true,
      height: 3,
      depth: 1.5,
      angle: 1.3,
    });
  if (direction === "down") {
    const launch = modules.down === "launch";
    return utilityMove(
      `special.emp.${modules.down}`,
      launch ? "EMP LAUNCH" : "EMP STAGGER",
      "special",
      "down",
      0.62,
      3.4,
      {
        ...common,
        damage: (launch ? 14 : 10) * loadout.power,
        force: launch ? 8 : 3.5,
        angle: launch ? 1.2 : 0.2,
        startup: 11,
        end: 23,
        depth: 3.4,
        height: 2.8,
        radial: true,
      },
    );
  }
  if (direction === "forward" || direction === "back") {
    const cross = modules.side === "cross";
    return utilityMove(
      `special.side.${modules.side}`,
      cross ? "PHASE CROSS" : "PHASE PUSH",
      "special",
      "forward",
      cross ? 0.36 : 0.5,
      cross ? 2.2 : 2.8,
      {
        ...common,
        behavior: "phase",
        damage: (cross ? 15 : 18) * loadout.power,
        force: cross ? 7 : 13,
        startup: cross ? 2 : 5,
        end: cross ? 18 : 23,
        depth: 1.6,
      },
    );
  }
  const split = modules.neutral === "split";
  if (loadout.special === "pulse")
    return utilityMove(
      `special.pulse.${modules.neutral}`,
      split ? "ION SPREAD" : "ION PIERCE",
      "special",
      "neutral",
      0.45,
      2,
      {
        ...common,
        behavior: "projectile",
        damage: (split ? 10 : 15) * loadout.power,
        startup: 8,
        end: 12,
        growth: 0.09,
      },
    );
  if (loadout.special === "blink")
    return utilityMove(
      `special.blink.${modules.neutral}`,
      split ? "PHASE FAN" : "PHASE SHIFT",
      "special",
      "forward",
      0.36,
      split ? 3 : 2.2,
      {
        ...common,
        behavior: "phase",
        damage: (split ? 13 : 17) * loadout.power,
        force: 9,
        startup: 2,
        end: 18,
        radial: split,
        depth: split ? 2.3 : 1.6,
      },
    );
  return utilityMove(
    `special.vortex.${modules.neutral}`,
    split ? "GRAVITY FIELD" : "GRAVITY WELL",
    "special",
    "neutral",
    0.8,
    split ? 5 : 4,
    {
      ...common,
      damage: (split ? 14 : 19) * loadout.power,
      force: split ? 8 : 11,
      angle: 0.85,
      radial: true,
      startup: 21,
      end: 33,
      depth: split ? 5 : 4,
      height: 3,
    },
  );
}
