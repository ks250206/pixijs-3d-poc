import type { GameEngine } from "../engine";
import type { RunState, Resources } from "./map";
import { availableNodes } from "./map";
import { EVENTS } from "./events";
import { RELICS } from "./economy";
import { UPGRADE_DEFINITIONS } from "../upgrades";

export const SAVE_KEY = "null-uprising-run";
export const SAVE_VERSION = 1;
export type Checkpoint = NonNullable<ReturnType<GameEngine["exportCheckpoint"]>>;
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type LoadResult =
  | { kind: "active"; checkpoint: Checkpoint }
  | { kind: "empty" | "finished" | "corrupt" | "incompatible" | "denied"; message: string };
const member = (v: unknown, values: readonly unknown[]) => values.includes(v);
function assert(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid checkpoint");
}
function record(v: unknown): asserts v is Record<string, any> {
  assert(v !== null && typeof v === "object" && !Array.isArray(v));
}
const integer = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const finite = (v: unknown, min: number, max: number) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
function list(v: unknown, max: number): asserts v is any[] {
  assert(Array.isArray(v) && v.length <= max);
}
function unique(v: unknown, allowed: readonly unknown[], max: number): asserts v is string[] {
  list(v, max);
  assert(new Set(v).size === v.length && v.every((x) => allowed.includes(x)));
}
function loadout(v: unknown): void {
  record(v);
  assert(
    member(v.weapon, ["arc", "pile", "razor", "lance", "cannon", "scythe"]) &&
      member(v.special, ["pulse", "blink", "vortex"]),
  );
  assert(
    member(v.trait, ["lightweight", "heavy-duty", "overclocked", "vampiric", "volatile", "stable"]),
  );
  for (const k of ["id", "name", "subtitle", "description"])
    assert(typeof v[k] === "string" && v[k].length < 1000);
  assert(
    finite(v.power, 0.5, 10) &&
      finite(v.speed, 0.1, 5) &&
      finite(v.weight, 0.1, 5) &&
      integer(v.color, 0, 0xffffff),
  );
  record(v.modules);
  assert(
    member(v.modules.weapon, ["quick", "breaker"]) &&
      member(v.modules.neutral, ["focused", "split"]) &&
      member(v.modules.side, ["cross", "push"]) &&
      member(v.modules.down, ["launch", "stagger"]),
  );
}
function resources(v: unknown): asserts v is Resources {
  record(v);
  assert(
    finite(v.damage, 0, 999) &&
      integer(v.stocks, 1, 4) &&
      finite(v.score, 0, 1e9) &&
      integer(v.kills, 0, 1e7),
  );
  loadout(v.loadout);
  list(v.upgrades, UPGRADE_DEFINITIONS.length);
  assert(new Set(v.upgrades.map((u) => u.id)).size === v.upgrades.length);
  for (const u of v.upgrades) {
    record(u);
    const d = UPGRADE_DEFINITIONS.find((d) => d.id === u.id);
    assert(d && integer(u.rank, 1, d.maxRank));
  }
}
function safeTree(v: unknown, depth = 0): void {
  assert(depth < 30);
  if (typeof v === "string") assert(v.length < 5000 && !/[<>]/.test(v));
  if (v && typeof v === "object")
    for (const [k, x] of Object.entries(v)) {
      assert(!["__proto__", "constructor", "prototype"].includes(k));
      safeTree(x, depth + 1);
    }
}
export function validateCheckpoint(value: unknown): Checkpoint {
  safeTree(value);
  record(value);
  const r = value.run;
  record(r);
  assert(
    integer(r.seed, 0, 0xffffffff) &&
      integer(r.revision, 0, 1e9) &&
      integer(r.act, 1, 3) &&
      r.difficulty === "standard",
  );
  assert(member(r.phase, ["map", "node", "combat", "reward"]));
  loadout(r.originalLoadout);
  resources(r.resources);
  list(r.map, 100);
  assert(r.map.length >= 24);
  const ids = r.map.map((n) => n.id);
  assert(new Set(ids).size === ids.length);
  for (const n of r.map) {
    record(n);
    assert(
      integer(n.act, 1, 3) &&
        integer(n.row, 0, 7) &&
        integer(n.column, 0, 3) &&
        integer(n.theme, 0, 6),
    );
    assert(n.id === `${n.act}-${n.row}-${n.column}`);
    assert(member(n.kind, ["battle", "elite", "shop", "unknown", "treasure", "rest", "boss"]));
    unique(n.next, ids, 3);
    assert(n.row === 7 ? n.next.length === 0 : n.next.length > 0);
    for (const id of n.next) {
      const to = r.map.find((m) => m.id === id)!;
      assert(to.act === n.act && to.row === n.row + 1);
    }
  }
  for (let act = 1; act <= 3; act++) {
    const reached = new Set([`${act}-0-0`]);
    const nodes = r.map.filter((n) => n.act === act).sort((a, b) => a.row - b.row);
    assert(nodes.length > 0);
    for (const n of nodes) {
      assert(reached.has(n.id));
      n.next.forEach((id: string) => reached.add(id));
    }
    assert(nodes.filter((n) => n.row === 7).length === 1);
  }
  unique(r.visited, ids, 24);
  unique(r.completed, r.visited, 24);
  assert(
    r.current === null ? r.visited.length === 0 && r.act === 1 : r.visited.at(-1) === r.current,
  );
  assert(r.completed.length === r.visited.length || r.completed.length === r.visited.length - 1);
  assert(r.completed.every((id: string, i: number) => id === r.visited[i]));
  for (let i = 0; i < r.visited.length; i++) {
    const n = r.map.find((n) => n.id === r.visited[i])!;
    if (i === 0) assert(n.id === "1-0-0");
    else {
      const prev = r.map.find((n) => n.id === r.visited[i - 1])!;
      assert(prev.next.includes(n.id) || (prev.row === 7 && n.act === prev.act + 1 && n.row === 0));
    }
  }
  if (r.phase !== "map") assert(r.current !== null && !r.completed.includes(r.current));
  if (r.phase === "map") assert(r.completed.length === r.visited.length);
  const current = r.map.find((n) => n.id === r.current);
  if (current) assert(r.act === current.act + (r.phase === "map" && current.row === 7 ? 1 : 0));
  assert(r.selected === null || availableNodes(r as RunState).includes(r.selected));
  const e = r.economy;
  record(e);
  assert(integer(e.scrap, 0, 1e6));
  unique(
    e.relics,
    RELICS.map((v) => v.id),
    RELICS.length,
  );
  unique(e.rewards, r.visited, 24);
  unique(e.nodeClaims, r.visited, 24);
  record(e.shops);
  assert(Object.keys(e.shops).length <= 24);
  for (const [id, items] of Object.entries(e.shops)) {
    assert(r.visited.includes(id));
    list(items, 10);
    const stockIds = items.map((i) => i.id);
    assert(new Set(stockIds).size === stockIds.length);
    for (const item of items) {
      record(item);
      assert(
        typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.sold === "boolean" &&
          integer(item.price, 1, 10000) &&
          member(item.kind, ["upgrade", "repair", "stock", "relic"]),
      );
      if (item.kind === "upgrade")
        assert(UPGRADE_DEFINITIONS.some((d) => d.id === item.upgrade) && item.id === item.upgrade);
      if (item.kind === "relic")
        assert(RELICS.some((d) => d.id === item.relic) && item.id === item.relic);
      if (item.kind === "stock" || item.kind === "repair") assert(item.id === item.kind);
    }
  }
  const ev = r.events;
  record(ev);
  unique(
    ev.history,
    EVENTS.map((e) => e.id),
    16,
  );
  record(ev.pity);
  for (const k of ["event", "battle", "shop", "treasure"]) assert(integer(ev.pity[k], 0, 6));
  record(ev.resolved);
  assert(Object.keys(ev.resolved).length <= 24);
  for (const [id, res] of Object.entries(ev.resolved)) {
    assert(r.visited.includes(id));
    record(res);
    assert(member(res.kind, ["event", "battle", "shop", "treasure"]));
    if (res.kind === "event") {
      const d = EVENTS.find((e) => e.id === res.eventId);
      assert(d);
      if (res.choice !== undefined) {
        assert(d.options.some((o) => o.id === res.choice));
        assert(res.combat === !!d.options.find((o) => o.id === res.choice)!.effect.combat);
        resources(res.before);
        resources(res.after);
        assert(
          typeof res.result === "string" &&
            typeof res.combat === "boolean" &&
            integer(res.scrapBefore, 0, 1e6) &&
            integer(res.scrapAfter, 0, 1e6),
        );
      }
    }
  }
  for (const id of r.visited) {
    const node = r.map.find((n) => n.id === id)!;
    const resolution = ev.resolved[id];
    if (node.kind === "unknown") assert(resolution);
    if (resolution) assert(node.kind === "unknown");
    const kind = resolution?.kind ?? node.kind;
    if (kind === "shop") assert(Array.isArray(e.shops[id]));
    if (kind === "event" && r.completed.includes(id)) assert(resolution?.choice);
  }
  if (r.phase === "combat") assert(!e.rewards.includes(r.current));
  if (r.current) {
    const resolution = ev.resolved[r.current];
    const kind = resolution?.kind ?? current!.kind;
    if (r.phase === "combat" || r.phase === "reward")
      assert(
        ["battle", "elite", "boss"].includes(kind) || (kind === "event" && resolution?.combat),
      );
    if (r.phase === "node") assert(["shop", "treasure", "rest", "event"].includes(kind));
  }
  record(value.reward);
  unique(
    value.reward.ids,
    UPGRADE_DEFINITIONS.map((d) => d.id),
    3,
  );
  assert(typeof value.reward.claimed === "boolean");
  if (r.phase === "reward") assert(e.rewards.includes(r.current));
  return structuredClone(value) as Checkpoint;
}
export function readCheckpoint(storage: StorageLike): LoadResult {
  let raw: string | null;
  try {
    raw = storage.getItem(SAVE_KEY);
  } catch {
    return { kind: "denied", message: "Storage access denied. Continue is unavailable." };
  }
  if (!raw) return { kind: "empty", message: "No saved run." };
  try {
    assert(raw.length < 1_000_000);
    const saved: unknown = JSON.parse(raw);
    record(saved);
    if (saved.version !== SAVE_VERSION)
      return {
        kind: "incompatible",
        message: "Incompatible save version. The saved data has been retained.",
      };
    if (saved.status === "finished")
      return { kind: "finished", message: "The previous run has ended." };
    assert(saved.status === "active");
    return { kind: "active", checkpoint: validateCheckpoint(saved.checkpoint) };
  } catch {
    return {
      kind: "corrupt",
      message: "Invalid saved run. Data retained; discard explicitly or start a new run.",
    };
  }
}
/** One atomic localStorage write per successful transaction, never per animation frame. */
export class RunPersistence {
  result: LoadResult;
  message = "";
  private lastRun: RunState | null = null;
  private lastRevision = -1;
  constructor(
    private engine: GameEngine,
    private storage: () => StorageLike,
  ) {
    try {
      this.result = readCheckpoint(storage());
    } catch {
      this.result = { kind: "denied", message: "Storage access denied. Continue is unavailable." };
    }
    this.engine.onRunChange = () => this.save();
  }
  save(): boolean {
    const r = this.engine.run;
    if (!r) return false;
    if (this.lastRun === r && this.lastRevision === r.revision) return true;
    try {
      const checkpoint = this.engine.exportCheckpoint();
      this.storage().setItem(
        SAVE_KEY,
        JSON.stringify({
          version: SAVE_VERSION,
          status: checkpoint ? "active" : "finished",
          ...(checkpoint ? { checkpoint } : {}),
        }),
      );
      this.lastRun = r;
      this.lastRevision = r.revision;
      this.result = checkpoint
        ? { kind: "active", checkpoint }
        : { kind: "finished", message: "Run ended." };
      this.message = checkpoint
        ? "Checkpoint saved. Combat reload restarts the encounter."
        : "Run ended. Continue disabled.";
      return true;
    } catch {
      this.message =
        "SAVE FAILED — storage denied or full. The previous checkpoint may be older; progress is not secured.";
      return false;
    }
  }
  resume(): boolean {
    // Re-read and validate before changing live state; never delete on a failed load.
    let result: LoadResult;
    try {
      result = readCheckpoint(this.storage());
    } catch {
      return false;
    }
    this.result = result;
    if (result.kind !== "active") {
      this.message = result.message;
      return false;
    }
    this.engine.restoreCheckpoint(result.checkpoint);
    return true;
  }
  discard(): boolean {
    try {
      this.storage().removeItem(SAVE_KEY);
      this.result = { kind: "empty", message: "Saved run discarded." };
      this.message = "Saved run discarded.";
      return true;
    } catch {
      this.message = "Could not discard: storage access denied.";
      return false;
    }
  }
  abandon(): void {
    if (this.engine.run) {
      this.engine.run.phase = "finished";
      this.engine.run.revision++;
      this.save();
    }
  }
}
