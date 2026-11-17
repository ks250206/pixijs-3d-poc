import { describe, expect, it } from "vite-plus/test";
import { EncounterDirector } from "../src/game/director";
import { GameEngine } from "../src/game/engine";
import { createCandidates } from "../src/game/loadouts";
import { createPattern } from "../src/game/patterns";
import type { Actor, ActorKind, Projectile, WorldState } from "../src/game/types";

const tick = (g: GameEngine, n = 1) => {
  for (let i = 0; i < n; i++) g.update(1 / 60);
};
function lab() {
  const g = new GameEngine(73);
  g.start(createCandidates(73)[0]!, "training");
  tick(g, 180);
  g.world.props = [];
  g.world.effects = [];
  Object.assign(g.world.player, { x: 0, y: 0, z: 0, invulnerable: 100 });
  g.world.enemies.forEach((e, i) =>
    Object.assign(e, {
      kind: "minion",
      x: 1.5 + i * 0.1,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      state: "idle",
      invulnerable: 0,
      armor: 0,
      attack: null,
      bossPhase: null, form: 'default',
    }),
  );
  return g;
}
function advance(d: EncounterDirector, w: WorldState, dt: number, ready: readonly Actor[] = []) {
  w.time += dt;
  d.update(w, dt, ready);
}
function pairFixture() {
  const g = lab(),
    w = g.world,
    d = new EncounterDirector();
  const [gunner, scout, spare] = w.enemies as [Actor, Actor, Actor];
  gunner.kind = "gunner";
  gunner.x = 6;
  gunner.z = -2.6;
  scout.kind = "scout";
  scout.z = 1.8;
  w.player.z = -2.6;
  d.update(w, 0, [gunner]);
  expect(d.reserve(gunner, w, 1.05)).toBe(true);
  gunner.state = "attack";
  w.player.z = 1;
  advance(d, w, 0.6, [scout, spare]);
  return { g, w, d, gunner, scout, spare };
}
function shell(ownerId: string): Projectile {
  return {
    id: "lingering-shell",
    ownerId,
    kind: "mortar",
    x: 3,
    y: 3,
    z: 0,
    vx: -2,
    vy: -2,
    vz: 0,
    radius: 0.3,
    life: 1,
    color: 0xffcc66,
    target: { x: 1, z: 0 },
  };
}

describe("ready enemy arbitration", () => {
  it("lets an in-range flanker act while the nominal screen role is out of range", () => {
    const g = lab(),
      [gunner, scout] = g.world.enemies as [Actor, Actor];
    g.world.enemies = [gunner, scout];
    g.world.mode = "campaign";
    Object.assign(gunner, { kind: "gunner", x: 13, z: -3 });
    Object.assign(scout, { kind: "scout", x: 1.5, z: 0 });
    tick(g);
    expect(scout.state).toBe("attack");
    expect(gunner.state).not.toBe("attack");
    expect(g.world.coordination.reservations.map((r) => r.ownerId)).toEqual([scout.id]);
  });

  it("uses the boss recovery cooldown as an opening for ready minions", () => {
    const g = lab(),
      [boss, minion] = g.world.enemies as [Actor, Actor];
    g.world.enemies = [boss, minion];
    g.world.mode = "campaign";
    Object.assign(boss, { kind: "warden", x: 7, z: 0, armor: 70, scale: 1.85 });
    minion.x = 13;
    minion.z = 3.5;
    for (let i = 0; i < 120 && boss.state !== "attack"; i++) tick(g);
    expect(boss.state).toBe("attack");
    while (boss.state === "attack") tick(g);
    Object.assign(minion, { x: 1.5, z: 0, vx: 0, vz: 0 });
    let actedDuringCooldown = false;
    for (let i = 0; i < 50; i++) {
      tick(g);
      if (minion.state === "attack") {
        actedDuringCooldown = !g.world.enemies.some(
          (e) => e.id === boss.id && e.state === "attack",
        );
        break;
      }
    }
    expect(actedDuringCooldown).toBe(true);
  });

  it("does not let a recovering drone occupy the ready queue", () => {
    const g = lab(),
      [drone, scout] = g.world.enemies as [Actor, Actor];
    g.world.enemies = [drone, scout];
    g.world.mode = "campaign";
    Object.assign(drone, { kind: "drone", x: g.world.arenaMax + 1, y: -1 });
    scout.x = 1.5;
    scout.z = 0;
    tick(g);
    expect(drone.state).toBe("recover");
    expect(scout.state).toBe("attack");
    expect(g.world.coordination.reservations.some((r) => r.ownerId === drone.id)).toBe(false);
  });

  it("rejects hurt, grabbed, dead and phase-transition actors even if supplied as ready", () => {
    const g = lab(),
      w = g.world,
      d = new EncounterDirector(),
      actor = w.enemies[0]!;
    for (const state of ["hurt", "grabbed", "dead"] as const) {
      actor.state = state;
      d.update(w, 0, [actor]);
      expect(d.reserve(actor, w, 1)).toBe(false);
      expect(w.coordination.readyCount).toBe(0);
    }
    actor.state = "idle";
    actor.bossPhase = "transition";
    d.update(w, 0, [actor]);
    expect(d.reserve(actor, w, 1)).toBe(false);
  });

  it("serves every ready individual before repeating, regardless of array call order", () => {
    const g = lab(),
      w = g.world,
      d = new EncounterDirector();
    const served: string[] = [];
    for (let round = 0; round < 6; round++) {
      d.update(w, 0, w.enemies);
      const actor = [...w.enemies].reverse().find((e) => d.reserve(e, w, 0.8));
      expect(actor).toBeDefined();
      served.push(actor!.id);
      actor!.state = "attack";
      advance(d, w, 0.8, w.enemies);
      actor!.state = "idle";
      advance(d, w, 1 / 60, w.enemies);
      for (let i = 0; i < 60; i++) advance(d, w, 1 / 60, w.enemies);
    }
    expect(served.slice(0, 3)).toEqual(w.enemies.map((e) => e.id));
    expect(served.slice(3)).toEqual(served.slice(0, 3));
  });
});

describe("bounded complementary pressure", () => {
  it("allows a staggered shot + flank in separate corridors and records an escape lane", () => {
    const { w, d, scout, gunner } = pairFixture();
    expect(d.reserve(scout, w, 0.8)).toBe(true);
    expect(w.coordination.reservations).toHaveLength(2);
    expect(w.coordination.maxThreats).toBe(2);
    const escape = w.coordination.escapeLane!;
    expect(escape).not.toBeNull();
    for (const reservation of w.coordination.reservations) {
      expect(escape < reservation.corridor.min || escape > reservation.corridor.max).toBe(true);
    }
    expect(w.coordination.reservations.map((r) => r.ownerId)).toEqual([gunner.id, scout.id]);
  });

  it("executes the same safe pairing through the real engine readiness pass", () => {
    const g = lab(),
      [gunner, scout] = g.world.enemies as [Actor, Actor];
    g.world.enemies = [gunner, scout];
    g.world.mode = "campaign";
    Object.assign(gunner, { kind: "gunner", x: 6, z: -2.6 });
    Object.assign(scout, { kind: "scout", x: 1.5, z: 1.8 });
    g.world.player.z = -2.6;
    tick(g, 42);
    expect(gunner.state).toBe("attack");
    expect(g.world.projectiles.length).toBeGreaterThan(0);
    g.world.player.z = 1;
    Object.assign(scout, { x: 1.5, z: 1.8, vx: 0, vz: 0 });
    tick(g);
    expect(scout.state).toBe("attack");
    expect(g.world.coordination.reservations).toHaveLength(2);
  });

  it("does not start a second warning immediately or overlap the same depth corridor", () => {
    const { w, d, scout, gunner } = pairFixture();
    w.time = w.coordination.reservations[0]!.startedAt + 0.2;
    expect(d.reserve(scout, w, 0.8)).toBe(false);
    w.time += 0.4;
    scout.z = gunner.z;
    w.player.z = gunner.z;
    d.update(w, 0, [scout]);
    expect(d.reserve(scout, w, 0.8)).toBe(false);
  });

  it.each([
    "boss",
    "warden",
    "sniper",
    "artillery",
    "sapper",
    "bruiser",
    "charger",
    "leaper",
  ] as ActorKind[])("keeps %s exclusive even when another lane looks free", (kind) => {
    const { w, d, scout } = pairFixture();
    scout.kind = kind;
    d.update(w, 0, [scout]);
    expect(d.reserve(scout, w, 2)).toBe(false);
    expect(w.coordination.reservations).toHaveLength(1);
  });

  it("never adds a flanker to a boss or area reservation", () => {
    const g = lab(),
      w = g.world,
      d = new EncounterDirector(),
      [boss, scout] = w.enemies as [Actor, Actor];
    boss.kind = "boss";
    boss.z = -3;
    scout.kind = "scout";
    scout.z = 2;
    w.player.z = 1;
    d.update(w, 0, [boss]);
    expect(d.reserve(boss, w, 3)).toBe(true);
    boss.state = "attack";
    advance(d, w, 0.6, [scout]);
    expect(d.reserve(scout, w, 0.8)).toBe(false);
  });

  it("preserves escape space around existing objective hazards and active vents", () => {
    const { w, d, scout } = pairFixture();
    w.hazards = createPattern("snipe", "objective-shot", "objective-5-0", w.arenaMin, w.arenaMax, {
      x: 0,
      z: 0,
    });
    expect(d.reserve(scout, w, 0.8)).toBe(false);
    w.hazards = [];
    w.props = [
      {
        id: "escape-vent",
        kind: "vent",
        x: w.player.x,
        z: -0.7,
        width: 3,
        depth: 2.5,
        height: 0.08,
        hp: 0,
        alive: true,
        phase: "active",
        timer: 0,
        direction: 1,
      },
    ];
    expect(d.reserve(scout, w, 0.8)).toBe(false);
  });

  it("does not refill a two-attacker beat indefinitely when one attacker finishes", () => {
    const { w, d, scout, gunner, spare } = pairFixture();
    expect(d.reserve(scout, w, 0.8)).toBe(true);
    scout.state = "attack";
    gunner.state = "idle";
    spare.kind = "gunner";
    spare.x = 6;
    spare.z = -2.6;
    advance(d, w, 0.4, [spare]);
    expect(w.coordination.reservations).toHaveLength(1);
    expect(d.reserve(spare, w, 1.05)).toBe(false);
    scout.state = "idle";
    advance(d, w, 1 / 60, [spare]);
    expect(w.coordination.recoveryRemaining).toBe(0.6);
    expect(d.reserve(spare, w, 1.05)).toBe(false);
  });
});

describe("reservation lifetime", () => {
  it("retains a live attack across elapsed wall time and reserves a recovery gap after it ends", () => {
    const g = lab(),
      w = g.world,
      d = new EncounterDirector(),
      actor = w.enemies[0]!;
    d.update(w, 0, [actor]);
    expect(d.reserve(actor, w, 0.1)).toBe(true);
    actor.state = "attack";
    advance(d, w, 10, []);
    expect(w.coordination.reservations).toHaveLength(1);
    actor.state = "idle";
    advance(d, w, 1 / 60, [actor]);
    expect(w.coordination.reservations).toHaveLength(0);
    expect(w.coordination.recoveryRemaining).toBeGreaterThanOrEqual(0.4);
    expect(d.reserve(actor, w, 0.8)).toBe(false);
    advance(d, w, 0.41, [actor]);
    expect(d.reserve(actor, w, 0.8)).toBe(true);
  });

  it("retains surviving projectiles and hazards after their owner's attack ends", () => {
    const g = lab(),
      w = g.world,
      d = new EncounterDirector(),
      actor = w.enemies[0]!;
    d.update(w, 0, [actor]);
    expect(d.reserve(actor, w, 1)).toBe(true);
    actor.alive = false;
    w.projectiles = [shell(actor.id)];
    advance(d, w, 2);
    expect(w.coordination.reservations).toHaveLength(1);
    w.projectiles = [];
    w.hazards = createPattern("mine", "lingering-zone", actor.id, w.arenaMin, w.arenaMax, {
      x: 0,
      z: 0,
    });
    advance(d, w, 0.1);
    expect(w.coordination.reservations).toHaveLength(1);
    w.hazards[0]!.elapsed = 2;
    advance(d, w, 0.1);
    expect(w.coordination.reservations).toHaveLength(0);
    expect(w.coordination.recoveryRemaining).toBeGreaterThan(0);
  });

  it("adopts an orphan shell after a wave reset and clears it once expired", () => {
    const g = lab(),
      w = g.world,
      d = new EncounterDirector();
    w.projectiles = [shell("defeated-artillery")];
    d.reset();
    d.update(w, 0, w.enemies);
    expect(w.coordination.reservations[0]?.ownerId).toBe("defeated-artillery");
    expect(w.coordination.reservations[0]?.threat).toBe("exclusive");
    expect(w.enemies.some((e) => d.reserve(e, w, 0.8))).toBe(false);
    w.projectiles[0]!.life = 0;
    advance(d, w, 0.1, w.enemies);
    expect(w.coordination.reservations).toHaveLength(0);
    expect(w.coordination.recoveryRemaining).toBeGreaterThan(0);
    d.reset();
    d.update(w, 0);
    expect(w.coordination.readyCount).toBe(0);
    expect(w.coordination.escapeLane).toBeNull();
  });
});
