import { describe, expect, it } from "vite-plus/test";
import { GameEngine } from "../src/game/engine";
import { createCandidates } from "../src/game/loadouts";
import { EMPTY_INPUT } from "../src/game/types";
import { playerMove } from "../src/game/combat/moves";
import { sampleWeapon, sweptContact, bodyHurtbox } from "../src/game/combat/geometry";
import { DODGE, DEPTH_LIMIT } from "../src/game/movement";

const tick = (g: GameEngine, n: number) => {
  for (let i = 0; i < n; i++) g.update(1 / 60);
};
function lab() {
  const g = new GameEngine(73);
  g.start({ ...createCandidates(73)[0]!, weapon: "lance", power: 1 }, "training");
  tick(g, 120);
  g.world.props = [];
  Object.assign(g.world.player, { x: 0, z: 0, invulnerable: 0 });
  g.world.enemies = g.world.enemies.slice(0, 1);
  Object.assign(g.world.enemies[0]!, { x: 3.7, y: 0, z: 0, invulnerable: 0 });
  return g;
}
describe("authoritative weapon trajectories", () => {
  it.each([1, -1] as const)("mirrors forward/back/up/down capsules with facing %s", (facing) => {
    const g = lab(),
      p = g.world.player;
    p.facing = facing;
    for (const direction of ["forward", "back", "up", "down"] as const) {
      const move = playerMove(g.world.loadout, "aerial", direction, 0, 0);
      const s = sampleWeapon(p, move, move.frames.startup + move.frames.active / 2);
      if (direction === "back") expect((s.b.x - p.x) * facing).toBeLessThan(0);
      if (direction === "forward") expect((s.b.x - p.x) * facing).toBeGreaterThan(3);
      if (direction === "up") expect(s.b.y).toBeGreaterThan(s.a.y + 2);
      if (direction === "down") expect(s.b.y).toBeLessThan(s.a.y - 2);
      expect(s.b.z).toBe(p.z);
    }
  });
  it("only collides during active frames and sweeps a moving path at coarse steps", () => {
    const g = lab(),
      p = g.world.player,
      t = g.world.enemies[0]!;
    const move = playerMove(g.world.loadout, "jab", "neutral", 0, 0);
    expect(sweptContact(p, move, 0, move.frames.startup - 0.1, bodyHurtbox(t))).toBeNull();
    expect(
      sweptContact(
        p,
        move,
        move.frames.startup,
        move.frames.startup + move.frames.active,
        bodyHurtbox(t),
      ),
    ).not.toBeNull();
    expect(sweptContact(p, move, 999, 1000, bodyHurtbox(t))).toBeNull();
    for (const patch of [{ x: -1 }, { x: 8 }, { z: 1.3 }, { y: 4 }]) {
      expect(
        sweptContact(
          p,
          move,
          move.frames.startup,
          move.frames.startup + move.frames.active,
          bodyHurtbox({ ...t, ...patch }),
        ),
      ).toBeNull();
    }
  });
  it("classifies sweet spots by tip geometry rather than horizontal distance", () => {
    const g = lab(),
      p = g.world.player,
      t = g.world.enemies[0]!;
    const move = playerMove(g.world.loadout, "jab", "neutral", 0, 0);
    const mid = move.frames.startup + move.frames.active / 2;
    const tip = sampleWeapon(p, move, mid).b;
    expect(sweptContact(p, move, mid, mid, bodyHurtbox({ ...t, x: tip.x, y: tip.y - 0.8 }))).toBe(
      1.35,
    );
    expect(sweptContact(p, move, mid, mid, bodyHurtbox({ ...t, x: 1.4 }))).toBe(1);
    const up = playerMove(g.world.loadout, "aerial", "up", 0, 0);
    const u = sampleWeapon(p, up, up.frames.startup + up.frames.active / 2).b;
    expect(
      sweptContact(
        p,
        up,
        up.frames.startup + up.frames.active / 2,
        up.frames.startup + up.frames.active / 2,
        bodyHurtbox({ ...t, x: u.x, y: u.y - 0.3, scale: 0.3 }),
      ),
    ).toBe(1.35);
  });
  it("tracks tall boss bodies and limits a swing to one hit per target", () => {
    const g = lab(),
      t = g.world.enemies[0]!;
    Object.assign(t, { kind: "boss", scale: 2.65, x: 3, y: 0 });
    Object.assign(g.world.player, { y: 3.2, vy: 0 });
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    tick(g, 24);
    expect(t.damage).toBeGreaterThan(0);
    const damage = t.damage;
    tick(g, 8);
    expect(t.damage).toBe(damage);
  });
});
describe("dash revision and depth rails", () => {
  it.each([1, -1] as const)(
    "neutral ground Shift dashes in facing %s with unheld input",
    (facing) => {
      const g = lab(),
        p = g.world.player;
      p.facing = facing;
      g.world.enemies[0]!.z = 3;
      g.update(1 / 60, { ...EMPTY_INPUT, dodge: true });
      expect(p.vx * facing).toBeGreaterThan(0);
      expect(g.world.lastMove).toBe("GROUND DASH");
      tick(g, 18);
      expect(p.x * facing).toBeGreaterThan(0.8);
    },
  );
  it("scales old directional ground and air speeds by exactly two thirds", () => {
    expect(DODGE.scale).toBe(2 / 3);
    expect(DODGE.groundX).toBe((12 * 2) / 3);
    expect(DODGE.groundZ).toBe((8 * 2) / 3);
    expect(DODGE.air).toBe((18 * 2) / 3);
    const g = lab();
    g.update(1 / 60, { ...EMPTY_INPUT, dodge: true, moveX: 1 });
    expect(g.world.player.x).toBeCloseTo(DODGE.groundX / 60);
  });
  it.each([-1, 1])(
    "clamps every living actor at depth %s, including offstage falling bodies",
    (sign) => {
      const g = lab();
      for (const a of [g.world.player, ...g.world.enemies])
        Object.assign(a, {
          z: sign * 4.4,
          vz: sign * 200,
          y: 1,
          vy: 5,
          state: "hurt",
          stateTime: 0,
        });
      tick(g, 2);
      for (const a of [g.world.player, ...g.world.enemies]) {
        expect(Math.abs(a.z)).toBeLessThanOrEqual(DEPTH_LIMIT);
        expect(a.alive).toBe(true);
      }
      Object.assign(g.world.player, { x: g.world.arenaMax + 1, y: -2, vy: -1, vz: sign * 200 });
      tick(g, 1);
      expect(g.world.player.y).toBeLessThan(-2);
      expect(Math.abs(g.world.player.z)).toBeLessThanOrEqual(DEPTH_LIMIT);
    },
  );
});

describe("move lifecycle regressions", () => {
  it("a missed grab recovers in .36 seconds without a damaging active window", () => {
    const g = lab();
    g.world.enemies[0]!.x = 8;
    g.update(1 / 60, { ...EMPTY_INPUT, grab: true });
    expect(g.world.player.attack?.duration).toBeLessThanOrEqual(0.37);
    tick(g, 24);
    expect(g.world.player.state).toBe("idle");
    expect(g.world.enemies[0]!.damage).toBe(0);
  });
  it("does not sweep movement from startup into the first active frame", () => {
    const g = lab(),
      p = g.world.player,
      t = g.world.enemies[0]!;
    t.x = 2;
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    p.x = 7;
    tick(g, 1);
    p.x = 9;
    tick(g, 12);
    expect(t.damage).toBe(0);
  });
  it("finds interior contacts along a fast rotating long capsule", () => {
    const g = lab();
    g.world.loadout.weapon = "scythe";
    const move = playerMove(g.world.loadout, "jab", "neutral", 0, 0);
    move.frames.active = 1;
    move.shape.reach = 10;
    move.shape.radius = 0.03;
    const frame = move.frames.startup + 0.123;
    const sample = sampleWeapon(g.world.player, move, frame);
    const x = (sample.a.x + sample.b.x) / 2,
      z = (sample.a.z + sample.b.z) / 2;
    expect(
      sweptContact(g.world.player, move, move.frames.startup, move.frames.startup + 1, {
        min: { x: x - 0.02, y: 1, z: z - 0.02 },
        max: { x: x + 0.02, y: 1.3, z: z + 0.02 },
      }),
    ).not.toBeNull();
  });
  it("defines bounded nonnegative frame counts for every weapon direction and attack", () => {
    for (const l of createCandidates(73))
      for (const kind of ["jab", "tilt", "smash", "dash", "aerial"] as const)
        for (const direction of ["neutral", "forward", "back", "up", "down"] as const) {
          const m = playerMove(l, kind, direction, 2, 1);
          expect(Object.values(m.frames).every((f) => Number.isInteger(f) && f >= 0)).toBe(true);
          const total = Object.values(m.frames).reduce((a, b) => a + b, 0);
          expect(total).toBeLessThan(120);
          for (const cancel of m.cancels) {
            expect(cancel.from).toBeGreaterThanOrEqual(0);
            expect(cancel.to).toBeGreaterThanOrEqual(cancel.from);
            expect(cancel.to).toBeLessThan(total);
          }
        }
  });
});

describe("grounded depth knockback floor crossing", () => {
  it.each([-1, 1])("keeps hurt actors above the floor at depth %s without a respawn", (sign) => {
    for (const vy of [0, -2]) {
      const g = lab(),
        p = g.world.player;
      g.world.enemies[0]!.z = -sign * 2;
      Object.assign(p, { z: sign * 3.7, y: 0, vy, vz: sign * 200, state: "hurt" });
      const stocks = g.world.stocks;
      for (let i = 0; i < 100; i++) {
        g.update(1 / 60);
        expect(p.alive).toBe(true);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(g.world.stocks).toBe(stocks);
      }
    }
  });
});

describe("executable cancel windows", () => {
  it("allows a hit-confirmed normal chain but not an early whiff chain", () => {
    for (const hit of [true, false]) {
      const g = lab(),
        p = g.world.player;
      g.world.enemies[0]!.x = hit ? 1.4 : 8;
      g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
      while (p.attack && p.attack.elapsed * 60 < p.attack.move!.frames.startup + 4) tick(g, 1);
      const before = p.attack!;
      expect(g.world.enemies[0]!.damage > 0).toBe(hit);
      g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
      expect(p.attack !== before).toBe(hit);
      if (hit) expect(p.attack?.combo).toBe(1);
    }
  });
  it("keeps a current attack when a special is on cooldown", () => {
    const g = lab(),
      p = g.world.player;
    g.world.enemies[0]!.x = 1.4;
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    tick(g, 8);
    g.world.specialCooldown = 2;
    const before = p.attack;
    g.update(1 / 60, { ...EMPTY_INPUT, special: true });
    expect(p.attack).toBe(before);
    expect(g.world.specialCooldown).toBeGreaterThan(1.9);
  });
  it("does not cancel into an already-used aerial recovery even after cooldown expires", () => {
    const g = lab(),
      p = g.world.player,
      t = g.world.enemies[0]!;
    p.y = 6;
    g.update(1 / 60, { ...EMPTY_INPUT, special: true, moveZ: -1 });
    for (let i = 0; i < 180; i++) {
      p.y = 6;
      p.vy = 0;
      tick(g, 1);
    }
    Object.assign(t, { x: p.x + 1.4, y: 6, z: p.z, invulnerable: 0 });
    p.vy = 0;
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    for (let i = 0; i < 12; i++) {
      p.y = 6;
      p.vy = 0;
      tick(g, 1);
    }
    expect(t.damage).toBeGreaterThan(0);
    const before = p.attack;
    g.update(1 / 60, { ...EMPTY_INPUT, special: true, moveZ: -1 });
    expect(p.attack).toBe(before);
    expect(g.world.specialCooldown).toBe(0);
  });
});

describe("dodge travel and airtime", () => {
  it("matches two thirds of old directional travel before the action ends", () => {
    const g = lab();
    g.world.enemies[0]!.z = 3;
    g.update(1 / 60, { ...EMPTY_INPUT, dodge: true, moveX: 1 });
    tick(g, 17);
    const old = Array.from({ length: 18 }, (_, i) => (12 / 60) * Math.exp((-3.6 * i) / 60)).reduce(
      (a, b) => a + b,
      0,
    );
    expect(g.world.player.x / old).toBeCloseTo(2 / 3, 8);
    const a = lab();
    a.world.player.y = 5;
    a.update(1 / 60, { ...EMPTY_INPUT, dodge: true, moveX: 1, dodgeHeld: true });
    for (let i = 0; i < 9; i++) a.update(1 / 60, { ...EMPTY_INPUT, dodgeHeld: true });
    expect(a.world.player.x / ((18 * 10) / 60)).toBeCloseTo(2 / 3, 8);
    tick(a, 12);
    const before = a.world.player.vx;
    a.update(1 / 60, { ...EMPTY_INPUT, dodge: true, moveX: -1 });
    expect(a.world.player.vx).toBeGreaterThanOrEqual(0);
    expect(before).toBeGreaterThan(0);
  });
});

describe("lance collisions through ordinary attack input", () => {
  it.each([1, -1] as const)(
    "hits forward only at the matching lane and elevation for facing %s",
    (facing) => {
      for (const [x, y, z, hit] of [
        [3.7, 0, 0, true],
        [-1, 0, 0, false],
        [8, 0, 0, false],
        [3.7, 0, 1.3, false],
        [3.7, 4, 0, false],
      ] as const) {
        const g = lab();
        g.world.player.facing = facing;
        Object.assign(g.world.enemies[0]!, { x: x * facing, y, z });
        g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
        tick(g, 26);
        expect(g.world.enemies[0]!.damage > 0).toBe(hit);
      }
    },
  );
});

describe("simultaneous-input cancel routing", () => {
  it("routes attack+grab into the legal normal chain, never an unlisted grab cancel", () => {
    const g = lab(),
      p = g.world.player;
    g.world.enemies[0]!.x = 1.4;
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    while (
      p.attack &&
      (p.attack.elapsed * 60 < p.attack.move!.frames.startup + 4 || g.world.hitstop > 0)
    )
      tick(g, 1);
    expect(g.world.enemies[0]!.damage).toBeGreaterThan(0);
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true, grab: true });
    expect(p.state).toBe("attack");
    expect(p.attack?.kind).toBe("jab");
    expect(p.attack?.combo).toBe(1);
  });
  it("routes used-up-recovery + special + attack to the available aerial instead of erasing it", () => {
    const g = lab(),
      p = g.world.player,
      t = g.world.enemies[0]!;
    p.y = 6;
    g.update(1 / 60, { ...EMPTY_INPUT, special: true, moveZ: -1 });
    for (let i = 0; i < 180; i++) {
      p.y = 6;
      p.vy = 0;
      tick(g, 1);
    }
    Object.assign(t, { x: p.x + 1.4, y: 6, z: p.z, invulnerable: 0 });
    p.vy = 0;
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    while (
      p.attack &&
      (p.attack.elapsed * 60 < p.attack.move!.frames.startup + 4 || g.world.hitstop > 0)
    ) {
      p.y = 6;
      p.vy = 0;
      tick(g, 1);
    }
    expect(t.damage).toBeGreaterThan(0);
    const old = p.attack;
    g.update(1 / 60, { ...EMPTY_INPUT, special: true, attack: true, moveZ: -1 });
    expect(p.attack).not.toBe(old);
    expect(p.attack?.kind).toBe("aerial");
    expect(p.attack?.direction).toBe("up");
    expect(g.world.specialCooldown).toBe(0);
  });
});

describe("collision snapshot after movement", () => {
  it.each([1, -1] as const)(
    "records the checked phase/dash/fall capsule after displacement facing %s",
    (facing) => {
      for (const motion of ["phase", "dash", "fall"] as const) {
        const g = lab(),
          p = g.world.player;
        g.world.enemies = [];
        Object.assign(p, {
          x: 0,
          y: motion === "fall" ? 4 : 0,
          vy: motion === "fall" ? -18 : 0,
          facing,
        });
        g.world.loadout.modules.side = "cross";
        g.update(1 / 60, {
          ...EMPTY_INPUT,
          moveX: facing,
          special: motion === "phase",
          attack: motion !== "phase",
          dash: motion === "dash",
        });
        while (p.attack!.elapsed * 60 < p.attack!.move!.frames.startup + 2) tick(g, 1);
        const checked = p.attack!.collision!;
        expect(checked.active).toBe(true);
        expect(checked.capsule).toEqual(sampleWeapon(p, p.attack!.move!, checked.frame));
        if (motion === "fall") expect(p.y).toBeLessThan(4);
        else expect(p.x * facing).toBeGreaterThan(0.2);
      }
    },
  );
  it("does not allow simultaneous actions to bypass real enemy hitstun", () => {
    const g = lab(),
      p = g.world.player,
      e = g.world.enemies[0]!;
    g.world.mode = "campaign";
    Object.assign(e, { kind: "gunner", x: 6, y: 0, z: 0, invulnerable: 0 });
    p.invulnerable = 0;
    for (let i = 0; i < 900 && p.state !== "hurt"; i++) tick(g, 1);
    expect(p.state).toBe("hurt");
    while (g.world.hitstop > 0) tick(g, 1);
    g.update(1 / 60, {
      ...EMPTY_INPUT,
      attack: true,
      special: true,
      grab: true,
      dodge: true,
      jump: true,
    });
    expect(p.state).toBe("hurt");
    expect(p.attack).toBeNull();
    expect(g.world.specialCooldown).toBe(0);
  });
});

describe("projectile hit-confirm cancels", () => {
  it("allows a cannon normal that connected to cancel into jump", () => {
    const g = lab(),
      p = g.world.player,
      t = g.world.enemies[0]!;
    g.world.loadout.weapon = "cannon";
    t.x = 2;
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    for (let i = 0; i < 60 && (t.damage === 0 || g.world.hitstop > 0 || p.attack!.elapsed * 60 < p.attack!.move!.frames.startup + 4); i++) tick(g, 1);
    expect(t.damage).toBeGreaterThan(0);
    expect(p.state).toBe("attack");
    expect(p.attack!.elapsed * 60).toBeGreaterThanOrEqual(p.attack!.move!.frames.startup + 3);
    g.update(1 / 60, { ...EMPTY_INPUT, jump: true });
    expect(p.y).toBeGreaterThan(0);
    expect(p.attack).toBeNull();
  });
  it("never confirms a later swing when an old cannon projectile arrives", () => {
    const g = lab(),
      p = g.world.player,
      t = g.world.enemies[0]!;
    g.world.loadout.weapon = "cannon";
    t.x = 8.8;
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    while (p.attack) tick(g, 1);
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    const current = p.attack!;
    while (
      p.attack &&
      (current.elapsed * 60 < current.move!.frames.startup + 3 || g.world.hitstop > 0)
    )
      tick(g, 1);
    expect(t.damage).toBeGreaterThan(0);
    expect(p.attack).toBe(current);
    g.update(1 / 60, { ...EMPTY_INPUT, jump: true });
    expect(p.attack).toBe(current);
    expect(p.y).toBe(0);
  });
});
