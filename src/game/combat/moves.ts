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
  };
  damage: number;
  force: number;
  growth: number;
  angle: number;
  charge: number;
  combo: number;
  cancels: { on: "hit" | "whiff"; from: number; to: number; actions: readonly CancelAction[] }[];
}
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
  if (direction === "down") angle = kind === "aerial" ? -1.15 : 0.28;
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
            actions: ["attack", "special", "jump", "dodge"],
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
