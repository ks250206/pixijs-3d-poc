import { it, expect, describe } from "vite-plus/test";
import { GameEngine } from "../src/game/engine";
import { createCandidates } from "../src/game/loadouts";
import { EVENTS, resolveUnknown, eventPreview, type Outcome } from "../src/game/roguelite/events";
import { clearEncounter } from "./helpers/roguelite";
function event(id: string) {
  const g = new GameEngine(81);
  g.start(createCandidates(81)[3]!, "roguelite");
  const r = g.run!;
  r.map[0]!.kind = "unknown";
  r.events.resolved["1-0-0"] = { kind: "event", eventId: id };
  r.economy.scrap = 200;
  r.economy.relics = ["amplifier"];
  r.resources.damage = 100;
  r.resources.stocks = 2;
  g.world.player.damage = 100;
  g.world.stocks = 2;
  g.selectNode("1-0-0");
  g.travelNode();
  return g;
}
describe("sixteen original event choices", () => {
  it.each(EVENTS)(
    "$id applies every option once with validated before/after effects",
    (definition) => {
      for (const option of definition.options) {
        const g = event(definition.id),
          r = g.run!;
        expect(eventPreview(r, r.events.resolved[r.current!]!, option.id)).not.toBeNull();
        expect(g.chooseEvent(option.id)).toBe(true);
        const after = JSON.stringify(r);
        expect(g.chooseEvent(option.id)).toBe(false);
        expect(JSON.stringify(r)).toBe(after);
        if (r.phase === "combat") clearEncounter(g);
        expect(g.completeNode()).toBe(true);
      }
    },
  );
  it("rejects unaffordable, ineffective, invalid and stock/relic constrained choices atomically", () => {
    const g = event("foundry-union");
    g.run!.economy.scrap = 0;
    const before = JSON.stringify(g.run);
    expect(g.chooseEvent("fund")).toBe(false);
    expect(g.chooseEvent("forged")).toBe(false);
    expect(JSON.stringify(g.run)).toBe(before);
    const h = event("courier-cache");
    h.world.stocks = 4;
    expect(h.chooseEvent("buy")).toBe(false);
    const t = event("scrap-oracle");
    t.run!.economy.relics = [];
    expect(t.chooseEvent("dismantle")).toBe(false);
    const repair = event("repair-strike");
    repair.world.player.damage = 0;
    repair.run!.resources.damage = 0;
    expect(repair.chooseEvent("sponsor")).toBe(false);
  });
  it("rescue combat gives elite reward and returns through normal once-only completion", () => {
    const g = event("rescue-beacon");
    expect(g.chooseEvent("fight")).toBe(true);
    const before = g.run!.economy.scrap;
    clearEncounter(g);
    expect(g.run!.economy.scrap).toBe(before + 60);
    g.completeNode();
    expect(g.run!.phase).toBe("map");
    expect(g.chooseEvent("fight")).toBe(false);
  });
  it("weighted unknowns resolve once, bound pity, cover categories and exhaust event pool before repeats", () => {
    const g = event("foundry-union"),
      r = g.run!,
      categories = new Set<Outcome>(),
      history: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const n = { ...r.map[0]!, id: `unknown-${i}` };
      const resolution = resolveUnknown(r, n);
      categories.add(resolution.kind);
      const before = JSON.stringify(r.events);
      expect(resolveUnknown(r, n)).toBe(resolution);
      expect(JSON.stringify(r.events)).toBe(before);
      expect(Object.values(r.events.pity).every((p) => p >= 0 && p <= 6)).toBe(true);
      if (resolution.eventId) history.push(resolution.eventId);
    }
    expect(categories.size).toBe(4);
    // Initial fixture is a forced resolution, not part of generated history.
    for (let i = 0; i + 16 <= history.length; i += 16)
      expect(new Set(history.slice(i, i + 16)).size).toBe(16);
  });
});
