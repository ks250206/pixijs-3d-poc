import { createEvents, type EventState } from "./events";
import { createEconomy, type Economy } from "./economy";
import { seededRandom } from "../loadouts";
import { STAGES } from "../campaign";
import { isBossKind } from "../bestiary";
import type { ActorKind, Loadout } from "../types";
import type { RunUpgrade } from "../upgrades";

export type NodeKind =
  | "battle"
  | "elite"
  | "shop"
  | "unknown"
  | "treasure"
  | "rest"
  | "boss"
  | "event";
export interface MapNode {
  id: string;
  act: number;
  row: number;
  column: number;
  kind: NodeKind;
  theme: number;
  next: string[];
}
export interface Resources {
  damage: number;
  stocks: number;
  loadout: Loadout;
  upgrades: RunUpgrade[];
  score: number;
  kills: number;
}
export interface RunState {
  revision: number;
  seed: number;
  map: MapNode[];
  act: number;
  current: string | null;
  selected: string | null;
  visited: string[];
  completed: string[];
  phase: "map" | "node" | "combat" | "reward" | "finished";
  events: EventState;
  economy: Economy;
  resources: Resources;
  originalLoadout: Loadout;
  difficulty: "standard";
}
/** Keyed streams never consume one another. Map v1 is entirely CPU-only. */
export function nodeSeed(seed: number, key: string): number {
  let value = seed >>> 0;
  for (const char of key) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}
export function generateMap(seed: number): MapNode[] {
  const random = seededRandom(nodeSeed(seed, "map-v1"));
  const nodes: MapNode[] = [];
  for (let act = 1; act <= 3; act++) {
    const rows = [1, 3, ...Array.from({ length: 4 }, () => 3 + Math.floor(random() * 2)), 1, 1].map(
      (width, row) =>
        Array.from({ length: width }, (_, column): MapNode => {
          const pool: NodeKind[] =
            row % 2 === 0
              ? ["battle", "elite", "shop", "unknown", "treasure"]
              : ["battle", "unknown", "treasure"];
          return {
            id: `${act}-${row}-${column}`,
            act,
            row,
            column,
            kind:
              row === 3 && column === 1
                ? "treasure"
                : row === 4 && column === 1
                  ? "shop"
                  : row === 0
                    ? "battle"
                    : row === 6
                      ? "rest"
                      : row === 7
                        ? "boss"
                        : pool[Math.floor(random() * pool.length)]!,
            theme:
              row === 0 && act === 1
                ? 0
                : ([0, 3, 5][act - 1] ?? 0) + Math.floor(random() * (act === 1 ? 3 : 2)),
            next: [],
          };
        }),
    );
    for (let row = 0; row < rows.length - 1; row++) {
      const from = rows[row]!,
        to = rows[row + 1]!;
      from.forEach((node, i) => {
        if (to.length === 1) {
          node.next = [to[0]!.id];
          return;
        }
        const center = (i * (to.length - 1)) / Math.max(1, from.length - 1);
        const indices = to
          .map((_, j) => ({ j, priority: Math.abs(j - center) + random() * 0.7 }))
          .sort((a, b) => a.priority - b.priority)
          .map((v) => v.j);
        // A local backbone covers every destination; seeded extra edges vary nearby choices.
        const mandatory = to
          .filter(
            (_, j) =>
              from.length === 1 || Math.round((j * (from.length - 1)) / (to.length - 1)) === i,
          )
          .map((n) => n.id);
        const desired = from.length === 1 ? to.length : 2 + Math.floor(random() * 2);
        node.next = [...new Set([...mandatory, ...indices.map((j) => to[j]!.id)])].slice(
          0,
          Math.min(3, desired),
        );
      });
    }
    nodes.push(...rows.flat());
  }
  return nodes;
}
export function createRun(seed: number, loadout: Loadout): RunState {
  return {
    revision: 0,
    events: createEvents(),
    economy: createEconomy(),
    seed,
    map: generateMap(seed),
    act: 1,
    current: null,
    selected: null,
    visited: [],
    completed: [],
    phase: "map",
    resources: {
      damage: 0,
      stocks: 3,
      loadout: structuredClone(loadout),
      upgrades: [],
      score: 0,
      kills: 0,
    },
    originalLoadout: structuredClone(loadout),
    difficulty: "standard",
  };
}
export function availableNodes(run: RunState): string[] {
  if (run.phase !== "map") return [];
  const current = run.map.find((n) => n.id === run.current);
  return current && current.act === run.act ? current.next : [`${run.act}-0-0`];
}
export function encounterRoster(run: RunState, node: MapNode): ActorKind[] {
  if (node.kind === "boss")
    return node.act === 3
      ? ["boss"]
      : node.act === 2
        ? ["gargoyle", "gargoyle"]
        : // The first act's gatekeeper is seeded: the Warden, or a copy of the run's own chassis.
          nodeSeed(run.seed, "act-1-boss") % 2
          ? ["mirror"]
          : ["warden", "scout"];
  if (node.act === 1 && node.row === 0 && node.kind === "battle")
    return [...STAGES[0]!.waves[0]!.enemies];
  const stage = STAGES[node.theme]!;
  const random = seededRandom(nodeSeed(run.seed, `encounter:${node.id}`));
  const templates = stage.waves.filter(
    (w) => !w.enemies.some(isBossKind),
  );
  return [...templates[Math.floor(random() * templates.length)]!.enemies];
}
