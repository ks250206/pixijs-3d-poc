import { describe, expect, it } from "vite-plus/test";
import { GameEngine } from "../src/game/engine";
import { createCandidates } from "../src/game/loadouts";
import { EMPTY_INPUT } from "../src/game/types";
import { EncounterDirector } from "../src/game/director";
import { createObjective } from "../src/game/objectives";
const tick = (g: GameEngine, n = 1) => {
  for (let i = 0; i < n; i++) g.update(1 / 60);
};
function lab() {
  const g = new GameEngine(73);
  g.start(createCandidates(73)[0]!, "training");
  tick(g, 120);
  g.world.props = [];
  Object.assign(g.world.player, { x: 0, z: 0, invulnerable: 100 });
  return g;
}
describe("seeded functional modules", () => {
  it("repeats every slot and rerolls functional sets across seeds", () => {
    expect(createCandidates(73)).toEqual(createCandidates(73));
    expect(createCandidates(73).map((l) => l.modules)).not.toEqual(
      createCandidates(74).map((l) => l.modules),
    );
    expect(
      createCandidates(73).every((l) => l.modules.neutral && l.modules.side && l.modules.down),
    ).toBe(true);
  });
  it("uses split vs focused pulse and distinct side/down module behavior", () => {
    const counts = ["focused", "split"].map((neutral) => {
      const g = lab();
      g.world.loadout.special = "pulse";
      g.world.loadout.modules.neutral = neutral as "focused" | "split";
      g.update(1 / 60, { ...EMPTY_INPUT, special: true });
      tick(g, 10);
      return g.world.projectiles.length;
    });
    expect(counts).toEqual([1, 3]);
    const moves = ["cross", "push"].map((side) => {
      const g = lab();
      g.world.loadout.modules.side = side as "cross" | "push";
      g.update(1 / 60, { ...EMPTY_INPUT, moveX: 1, special: true });
      return { speed: g.world.player.vx, id: g.world.player.attack?.move?.id };
    });
    expect(moves[0]).not.toEqual(moves[1]);
    const angles = ["launch", "stagger"].map((down) => {
      const g = lab();
      g.world.loadout.modules.down = down as "launch" | "stagger";
      g.update(1 / 60, { ...EMPTY_INPUT, moveZ: 1, special: true });
      return g.world.player.attack?.move?.angle;
    });
    expect(angles[0]).not.toBe(angles[1]);
  });
  it("deeply snapshots starting modules across restart and upgrades", () => {
    const g = lab(),
      original = structuredClone(g.world.loadout.modules);
    g.world.loadout.modules.down = original.down === "launch" ? "stagger" : "launch";
    g.restart();
    expect(g.world.loadout.modules).toEqual(original);
    g.world.loadout.modules.side = original.side === "cross" ? "push" : "cross";
    g.restart();
    expect(g.world.loadout.modules).toEqual(original);
  });
});
describe("cooperative encounter reservations", () => {
  it("coordinates role lanes and reserves exclusive danger with a readable gap", () => {
    const g = lab();
    g.world.mode = "campaign";
    const d = new EncounterDirector();
    g.world.enemies[0]!.kind = "sentinel";
    g.world.enemies[1]!.kind = "gunner";
    g.world.enemies[2]!.kind = "scout";
    d.update(g.world, 1 / 60, g.world.enemies);
    const roles = g.world.enemies.map((e) => d.plan(e, g.world));
    expect(new Set(roles.map((r) => r.role)).size).toBe(3);
    const gunner = g.world.enemies[1]!,
      scout = g.world.enemies[2]!;
    expect(d.reserve(gunner, g.world, 1)).toBe(true);
    expect(d.reserve(scout, g.world, 1)).toBe(false);
    expect(g.world.coordination.reservations[0]?.ownerId).toBe(gunner.id);
    d.reset();
    d.update(g.world, 1 / 60);
    expect(g.world.coordination.reservations).toHaveLength(0);
  });
});
describe("boss overdrive", () => {
  it("enters a fair once-only transition on armor break, changes pool, stays ringout-beatable and resets", () => {
    const g = lab(),
      boss = g.world.enemies[0]!;
    g.world.enemies = [boss];
    Object.assign(boss, { kind: "boss", scale: 2.65, x: 2, z: 0, y: 0, armor: 1, invulnerable: 0 });
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    tick(g, 20);
    expect(boss.bossPhase).toBe("transition");
    expect(g.world.phase).toBe("playing");
    expect(g.world.hazards).toHaveLength(0);
    g.world.mode = "campaign";
    tick(g, 90);
    expect(boss.bossPhase).toBe("overdrive");
    const moves = new Set<string>();
    for (let i = 0; i < 900; i++) {
      if (boss.attack?.move) moves.add(boss.attack.move.id);
      tick(g);
    }
    expect([...moves].some((id) => id.startsWith("overdrive."))).toBe(true);
    expect(boss.phaseChanges).toBe(1);
    boss.x = g.world.arenaMax + 6;
    tick(g);
    expect(g.world.phase).toBe("won");
    g.restart();
    expect(g.world.enemies.every((e) => e.bossPhase !== "overdrive")).toBe(true);
  });
});
describe("campaign objective state", () => {
  it("gives distinct relay, lockdown and control-node objectives with bounded campaign targets", () => {
    expect(createObjective(0, "campaign").kind).toBe("relay");
    expect(createObjective(2, "campaign").kind).toBe("lockdown");
    expect(createObjective(5, "campaign").kind).toBe("nodes");
    expect(createObjective(0, "training").complete).toBe(true);
  });
  it("cannot clear a stage with live objective props after the last enemy falls", () => {
    const g = new GameEngine(73);
    g.start(createCandidates(73)[0]!);
    expect(g.world.props.filter((p) => p.kind === "relay")).toHaveLength(2);
    for (let wave = 0; wave < 2; wave++) {
      g.world.enemies.forEach((e) => {
        e.x = g.world.arenaMax + 6;
      });
      tick(g, 100);
    }
    expect(g.world.phase).toBe("playing");
    expect(g.world.objective.complete).toBe(false);
  });
});

describe("integrated coordination and objective gates", () => {
  it("shows screen/flank actions over time and keeps same-lane attacks exclusive", () => {
    const g = lab();
    g.world.mode = "campaign";
    g.world.enemies.forEach((e, i) =>
      Object.assign(e, {
        kind: (["sentinel", "gunner", "scout"] as const)[i],
        x: [2, 6, 3][i],
        z: 0,
        invulnerable: 0,
      }),
    );
    const tactics = new Set<string>(),
      roles = new Set<string>();
    let maxAttacks = 0;
    for (let i = 0; i < 1500; i++) {
      tick(g);
      g.world.enemies.forEach((e) => tactics.add(e.tactic));
      g.world.coordination.reservations.forEach((r) => roles.add(r.role));
      maxAttacks = Math.max(maxAttacks, g.world.enemies.filter((e) => e.state === "attack").length);
      expect(g.world.coordination.reservations.length).toBeLessThanOrEqual(1);
    }
    expect(maxAttacks).toBe(1);
    expect(tactics.has("SCREEN")).toBe(true);
    expect(tactics.has("FLANK / GO")).toBe(true);
    expect(roles.has("ranged")).toBe(true);
    expect(roles.has("flanker")).toBe(true);
    g.restart();
    expect(g.world.coordination.reservations).toHaveLength(0);
  });
  it("keeps training free of campaign relay props and lockdown waves", () => {
    const g = lab();
    expect(g.world.objective.complete).toBe(true);
    expect(g.world.props.some((p) => p.kind === "relay" || p.kind === "node")).toBe(false);
    const n = g.world.enemies.length;
    tick(g, 1300);
    expect(g.world.enemies.length).toBe(n);
    expect(g.world.objective.reinforcements).toBe(0);
  });
});

describe("advertised modules execute for every family", () => {
  it.each(["blink", "vortex"] as const)("%s has two functional neutral variants", (special) => {
    const states = ["focused", "split"].map((neutral) => {
      const g = lab();
      g.world.loadout.special = special;
      g.world.loadout.modules.neutral = neutral as "focused" | "split";
      const e = g.world.enemies[0]!;
      Object.assign(e, { x: 7, z: 0, armor: 0 });
      g.update(1 / 60, { ...EMPTY_INPUT, special: true });
      return {
        id: g.world.player.attack?.move?.id,
        velocity: g.world.player.vx,
        enemyState: e.state,
        trajectory: g.world.player.attack?.move?.shape.trajectory,
      };
    });
    expect(states[0]).not.toEqual(states[1]);
    if (special === "vortex") {
      expect(states[0]!.enemyState).not.toBe("hurt");
      expect(states[1]!.enemyState).toBe("hurt");
    }
    if (special === "blink") expect(states[0]!.velocity).toBeGreaterThan(states[1]!.velocity);
  });
  it("every chassis and every slot combination retains a real up-special recovery", () => {
    for (const loadout of createCandidates(73))
      for (const neutral of ["focused", "split"] as const)
        for (const side of ["cross", "push"] as const)
          for (const down of ["launch", "stagger"] as const) {
            const g = lab();
            g.world.loadout = { ...loadout, modules: { ...loadout.modules, neutral, side, down } };
            g.world.player.y = 1;
            g.update(1 / 60, { ...EMPTY_INPUT, special: true, moveZ: -1 });
            expect(g.world.player.vy).toBeGreaterThan(14);
            expect(g.world.player.attack?.move?.id).toBe("special.recovery");
          }
  });
});

describe("objective order and rewards", () => {
  it("accepts objectives before the enemy clear, rewards once and resets on retry", () => {
    const g = new GameEngine(73);
    g.start({ ...createCandidates(73)[0]!, weapon: "lance" });
    g.world.player.invulnerable = 100;
    g.world.props = g.world.props.filter((p) => p.kind === "relay");
    for (const prop of g.world.props) {
      Object.assign(g.world.player, {
        x: prop.x - 1.4,
        y: 0,
        z: prop.z,
        vx: 0,
        vy: 0,
        vz: 0,
        facing: 1,
      });
      for (let i = 0; i < 180 && prop.alive; i++) {
        g.update(1 / 60, { ...EMPTY_INPUT, attack: i % 30 === 0 });
      }
      expect(prop.alive).toBe(false);
    }
    expect(g.world.objective.complete).toBe(true);
    expect(g.world.objective.rewarded).toBe(true);
    expect(g.world.phase).toBe("playing");
    const bonus = g.world.score;
    tick(g, 30);
    expect(g.world.score).toBe(bonus);
    for (let wave = 0; wave < 3; wave++) {
      g.world.enemies.forEach((e) => (e.x = g.world.arenaMax + 6));
      tick(g, 100);
    }
    expect(g.world.phase).toBe("sector-clear");
    g.restart();
    expect(g.world.objective.progress).toBe(0);
    expect(g.world.objective.rewarded).toBe(false);
    expect(g.world.props.filter((p) => p.kind === "relay" && p.alive)).toHaveLength(2);
  });
});

describe("protected transition and intentional objectives", () => {
  it("vortex cannot move or stun invulnerable spawn/boot targets", () => {
    const fresh = lab(),
      spawn = fresh.world.enemies[0]!;
    fresh.world.loadout.special = "vortex";
    Object.assign(spawn, {
      x: 3,
      y: 0,
      z: 0,
      armor: 0,
      invulnerable: 1.4,
      state: "idle",
      vx: 0,
      vy: 0,
      vz: 0,
    });
    fresh.update(1 / 60, { ...EMPTY_INPUT, special: true });
    expect(spawn.state).toBe("idle");
    expect(spawn.vx).toBe(0);
    expect(spawn.x).toBe(3);
    const g = lab(),
      boss = g.world.enemies[0]!;
    g.world.loadout.weapon = "arc";
    Object.assign(boss, {
      kind: "boss",
      scale: 2.65,
      x: 1.5,
      y: 0,
      z: 0,
      armor: 1,
      invulnerable: 0,
    });
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    for (let i = 0; i < 60 && boss.bossPhase !== "transition"; i++) tick(g);
    expect(boss.bossPhase).toBe("transition");
    while (
      g.world.player.attack &&
      (g.world.player.attack.elapsed * 60 < g.world.player.attack.move!.frames.startup + 4 ||
        g.world.hitstop > 0)
    )
      tick(g);
    const x = boss.x;
    g.world.loadout.special = "vortex";
    g.update(1 / 60, { ...EMPTY_INPUT, special: true });
    expect(g.world.player.attack?.move?.id.startsWith("special.vortex")).toBe(true);
    expect(boss.state).toBe("shield");
    expect(boss.vx).toBe(0);
    expect(boss.vz).toBe(0);
    expect(boss.x).toBe(x);
  });
  it.each(["scout", "gunner", "artillery"] as const)(
    "hostile %s attacks cannot disable relay/node targets",
    (kind) => {
      const g = new GameEngine(73);
      g.start(createCandidates(73)[0]!);
      const prop = g.world.props.find((p) => p.kind === "relay")!;
      g.world.props = [prop];
      const e = g.world.enemies[0]!;
      g.world.enemies = [e];
      Object.assign(e, {
        kind,
        x: prop.x - (kind === "artillery" ? 8 : kind === "gunner" ? 6 : 1.5),
        z: prop.z,
        y: 0,
        invulnerable: 0,
      });
      Object.assign(g.world.player, { x: prop.x + 0.5, z: prop.z, y: 0, invulnerable: 100 });
      let attacks = 0;
      for (let i = 0; i < 900; i++) {
        g.update(1 / 60);
        if (e.attack) attacks++;
        if (!e.alive) break;
      }
      expect(attacks).toBeGreaterThan(0);
      expect(prop.hp).toBe(18);
      expect(prop.alive).toBe(true);
      expect(g.world.objective.progress).toBe(0);
    },
  );
});

describe("player-attributed objective destruction", () => {
  it("allows a player projectile and its barrel chain to disable a relay", () => {
    const g = new GameEngine(73);
    g.start({ ...createCandidates(73)[0]!, weapon: "cannon" }, "campaign");
    g.world.enemies = [];
    const relay = g.world.props.find((p) => p.kind === "relay")!;
    const barrel = {
      ...relay,
      id: "arena-test-barrel",
      kind: "barrel" as const,
      x: relay.x - 2.5,
      hp: 1,
    };
    g.world.props = [barrel, relay];
    Object.assign(g.world.player, { x: barrel.x - 3, z: relay.z, facing: 1, invulnerable: 100 });
    g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
    tick(g, 40);
    expect(barrel.alive).toBe(false);
    expect(relay.alive).toBe(false);
    expect(g.world.objective.progress).toBe(1);
  });
});
