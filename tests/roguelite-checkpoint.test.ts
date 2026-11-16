import { it, expect, describe } from "vite-plus/test";
import { GameEngine } from "../src/game/engine";
import { createCandidates } from "../src/game/loadouts";
import {
  RunPersistence,
  readCheckpoint,
  SAVE_KEY,
  SAVE_VERSION,
  validateCheckpoint,
} from "../src/game/roguelite/checkpoint";
import { clearEncounter } from "./helpers/roguelite";
function storage() {
  const data = new Map<string, string>();
  let writes = 0;
  return {
    data,
    get writes() {
      return writes;
    },
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
      writes++;
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
  };
}
function setup(kind: "battle" | "shop" | "unknown" = "battle") {
  const s = storage(),
    g = new GameEngine(91),
    save = new RunPersistence(g, () => s);
  g.start(createCandidates(91)[0]!, "roguelite");
  g.run!.map[0]!.kind = kind;
  if (kind === "unknown")
    g.run!.events.resolved["1-0-0"] = { kind: "event", eventId: "rescue-beacon" };
  g.run!.economy.scrap = 200;
  g.selectNode("1-0-0");
  g.travelNode();
  return { s, g, save };
}
function reload(s: ReturnType<typeof storage>) {
  const g = new GameEngine(1),
    save = new RunPersistence(g, () => s);
  expect(save.result.kind).toBe("active");
  expect(g.run).toBeNull();
  expect(save.resume()).toBe(true);
  return { g, save };
}
describe("versioned transaction checkpoints", () => {
  it("saves selection and only writes once per revision, never from physics ticks", () => {
    const { s, g, save } = setup();
    const count = s.writes;
    for (let i = 0; i < 60; i++) g.update(1 / 60);
    save.save();
    expect(s.writes).toBe(count);
    const resumed = reload(s);
    expect(resumed.g.world.seed).toBe(91);
    expect(resumed.g.run!.originalLoadout).toEqual(g.run!.originalLoadout);
  });
  it("combat reload restarts at starting resources, not midcombat damage/stocks/upgrades", () => {
    const { s, g } = setup();
    g.world.player.damage = 150;
    g.world.stocks = 1;
    g.world.upgrades.push({ id: "arc-echo", rank: 2 });
    const { g: h } = reload(s);
    expect(h.run!.phase).toBe("combat");
    expect(h.world.player.damage).toBe(0);
    expect(h.world.stocks).toBe(3);
    expect(h.world.upgrades).toEqual([]);
    expect(h.world.projectiles).toEqual([]);
  });
  it("persists stock purchase, sold flags, upgrade claims and prevents double grants", () => {
    const { s, g } = setup("shop");
    const item = g.run!.economy.shops["1-0-0"]![0]!;
    expect(g.buyStock(item.id)).toBe(true);
    const { g: h } = reload(s);
    expect(h.buyStock(item.id)).toBe(false);
    expect(h.world.upgrades).toEqual(g.world.upgrades);
    expect(h.run!.economy.scrap).toBe(g.run!.economy.scrap);
    const malformed = h.exportCheckpoint()!;
    delete malformed.run.economy.shops["1-0-0"];
    expect(() => validateCheckpoint(malformed)).toThrow();
    const fight = setup();
    clearEncounter(fight.g);
    const { g: reward } = reload(fight.s);
    expect(reward.run!.phase).toBe("reward");
    expect(reward.world.upgradeClaimed).toBe(true);
    expect(reward.claimUpgrade(reward.world.upgradeChoices[0]!.id)).toBe(false);
  });
  it("restarts selected rescue elite without recharging or rerolling the event", () => {
    const { s, g } = setup("unknown");
    expect(g.chooseEvent("fight")).toBe(true);
    const before = structuredClone(g.run!.resources),
      money = g.run!.economy.scrap;
    g.world.player.damage = 150;
    const { g: h } = reload(s);
    expect(h.run!.phase).toBe("combat");
    expect(h.run!.events.resolved["1-0-0"]!.choice).toBe("fight");
    expect(h.world.player.damage).toBe(before.damage);
    expect(h.run!.economy.scrap).toBe(money);
    expect(h.chooseEvent("fight")).toBe(false);
    clearEncounter(h);
    expect(h.run!.economy.scrap).toBe(money + 60);
    h.completeNode();
    expect(h.run!.phase).toBe("map");
  });
  it("rejects corruption/incompatible saves while preserving original data", () => {
    const s = storage();
    for (const raw of [
      "{oops",
      JSON.stringify({ version: 0, status: "active" }),
      JSON.stringify({ version: SAVE_VERSION, status: "active", checkpoint: {} }),
    ]) {
      s.data.set(SAVE_KEY, raw);
      expect(["corrupt", "incompatible"]).toContain(readCheckpoint(s).kind);
      expect(s.getItem(SAVE_KEY)).toBe(raw);
    }
    const { g } = setup(),
      checkpoint = g.exportCheckpoint()!;
    for (const mutate of [
      (v: typeof checkpoint) => {
        v.run.resources.stocks = -1;
      },
      (v: typeof checkpoint) => {
        v.run.map[0]!.next = ["missing"];
      },
      (v: typeof checkpoint) => {
        v.run.economy.scrap = -2;
      },
      (v: typeof checkpoint) => {
        v.run.originalLoadout.weapon = "bad" as never;
      },
      (v: typeof checkpoint) => {
        v.run.selected = "3-7-0";
      },
      (v: typeof checkpoint) => {
        v.run.resources.upgrades = [{ id: "arc-echo", rank: 99 }];
      },
      (v: typeof checkpoint) => {
        v.run.phase = "node";
      },
      (v: typeof checkpoint) => {
        v.run.current = null;
      },
    ]) {
      const copy = structuredClone(checkpoint);
      mutate(copy);
      expect(() => validateCheckpoint(copy)).toThrow();
    }
  });
  it("handles storage denial and failed resume without deleting or replacing a live run", () => {
    const g = new GameEngine(91);
    const save = new RunPersistence(g, () => {
      throw Error("denied");
    });
    expect(save.result.kind).toBe("denied");
    g.start(createCandidates(91)[0]!, "roguelite");
    expect(save.message).toContain("SAVE FAILED");
    expect(save.resume()).toBe(false);
    expect(save.discard()).toBe(false);
    const ok = setup("shop");
    const previous = ok.s.getItem(SAVE_KEY);
    const denied = new RunPersistence(ok.g, () => ({
      ...ok.s,
      setItem: () => {
        throw Error("quota");
      },
    }));
    ok.g.selectNode("bad");
    ok.g.run!.revision++;
    expect(denied.save()).toBe(false);
    expect(ok.s.getItem(SAVE_KEY)).toBe(previous);
  });
  it("finished/dead/abandoned checkpoints cannot continue; failed load keeps corrupt bytes", () => {
    const { s, g, save } = setup();
    save.abandon();
    expect(readCheckpoint(s).kind).toBe("finished");
    expect(save.resume()).toBe(false);
    const dead = setup();
    dead.g.world.stocks = 1;
    dead.g.world.player.invulnerable = 0;
    dead.g.world.player.x = dead.g.world.arenaMax + 10;
    dead.g.update(1 / 60);
    expect(readCheckpoint(dead.s).kind).toBe("finished");
    s.data.set(SAVE_KEY, "broken");
    const h = new GameEngine(7),
      loader = new RunPersistence(h, () => s);
    expect(loader.resume()).toBe(false);
    expect(h.run).toBeNull();
    expect(s.getItem(SAVE_KEY)).toBe("broken");
  });
});

it("actual weighted unknown resolutions survive a validated checkpoint without reroll", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = storage(),
      g = new GameEngine(seed),
      save = new RunPersistence(g, () => s);
    g.start(createCandidates(seed)[0]!, "roguelite");
    g.run!.map[0]!.kind = "unknown";
    g.selectNode("1-0-0");
    g.travelNode();
    const before = structuredClone(g.run!.events);
    expect(save.result.kind).toBe("active");
    const restored = reload(s).g;
    expect(restored.run!.events).toEqual(before);
  }
});

it("reward reload retains concrete next-rank and module effect descriptions", () => {
  const { s, g } = setup();
  // Stop at the actual reward boundary without claiming/skipping.
  for (let i = 0; i < 900 && g.run!.phase === "combat"; i++) {
    g.world.player.invulnerable = 100;
    g.world.enemies.forEach((e) => {
      e.x = g.world.arenaMax + 8;
    });
    g.update(1 / 60);
  }
  expect(g.world.upgradeClaimed).toBe(false);
  const original = g.world.upgradeChoices.map((c) => ({
    id: c.id,
    nextRank: c.nextRank,
    description: c.description,
  }));
  const h = reload(s).g;
  expect(
    h.world.upgradeChoices.map((c) => ({
      id: c.id,
      nextRank: c.nextRank,
      description: c.description,
    })),
  ).toEqual(original);
});
