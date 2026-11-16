import { describe, it, expect } from "vite-plus/test";
import { generateMap, availableNodes } from "../src/game/roguelite/map";
import { GameEngine } from "../src/game/engine";
import { createCandidates } from "../src/game/loadouts";

import { clearEncounter } from "./helpers/roguelite";
describe("procedural routes", () => {
  it("satisfies reachability and choice invariants for 1000 seeds", () => {
    for (let seed = 0; seed < 1000; seed++) {
      const map = generateMap(seed);
      expect(map).toEqual(generateMap(seed));
      for (let act = 1; act <= 3; act++) {
        const nodes = map.filter((n) => n.act === act),
          reachable = new Set([`${act}-0-0`]);
        expect(nodes[0]!.kind).toBe("battle");
        expect(nodes.some((n) => n.kind === "treasure")).toBe(true);
        expect(nodes.some((n) => n.kind === "shop")).toBe(true);
        expect(
          nodes.every((n) => n.theme >= [0, 3, 5][act - 1]! && n.theme <= [2, 4, 6][act - 1]!),
        ).toBe(true);
        expect(nodes.filter((n) => n.row === 6).every((n) => n.kind === "rest")).toBe(true);
        for (const n of nodes) {
          expect(reachable.has(n.id)).toBe(true);
          expect(n.next.length).toBe(n.kind === "boss" ? 0 : n.row >= 5 ? 1 : n.next.length);
          if (n.row < 5) expect(n.next.length).toBeGreaterThanOrEqual(2);
          expect(n.next.length).toBeLessThanOrEqual(3);
          for (const id of n.next) {
            const to = nodes.find((v) => v.id === id)!;
            expect(to.row).toBe(n.row + 1);
            expect(["elite", "shop"].includes(n.kind) && n.kind === to.kind).toBe(false);
            reachable.add(id);
          }
        }
        expect(reachable.size).toBe(nodes.length);
      }
    }
  });
  it("varies graph topology across seeds", () => {
    const topology = (seed: number) => generateMap(seed).map((n) => [n.id, n.next]);
    expect(topology(1)).not.toEqual(topology(2));
  });
  it("validates adjacency, completes once and ends only after Act3", () => {
    const g = new GameEngine(91);
    g.start(createCandidates(91)[0]!, "roguelite");
    expect(g.selectNode("3-7-0")).toBe(false);
    for (let i = 0; i < 24; i++) {
      expect(g.selectNode(availableNodes(g.run!)[0]!)).toBe(true);
      expect(g.travelNode()).toBe(true);
      if (g.run!.phase === "combat") clearEncounter(g);
      if (g.run!.events.resolved[g.run!.current!]?.kind === "event") g.chooseEvent("leave");
      expect(g.completeNode()).toBe(true);
      expect(g.completeNode()).toBe(false);
      expect(g.world.phase).toBe(i === 23 ? "won" : "sector-clear");
    }
  });
  it("resets consecutive same-theme arenas including normal core battles and original loadout", () => {
    const g = new GameEngine(42),
      original = createCandidates(42)[0]!;
    g.start(original, "roguelite");
    for (let row = 0; row < 2; row++) {
      const id = availableNodes(g.run!)[0]!,
        n = g.run!.map.find((n) => n.id === id)!;
      n.theme = 6;
      n.kind = "battle";
      g.world.combo = 7;
      g.selectNode(id);
      g.travelNode();
      expect(g.world.combo).toBe(0);
      expect(g.world.enemies.length).toBeGreaterThan(0);
      expect(g.world.hazards).toEqual([]);
      clearEncounter(g);
      g.completeNode();
    }
    g.world.loadout.modules.weapon = original.modules.weapon === "quick" ? "breaker" : "quick";
    g.restart();
    expect(g.world.loadout).toEqual(original);
    expect(g.run!.visited).toEqual([]);
  });
});
