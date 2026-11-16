import { seededRandom } from "../loadouts";
import { createUpgradeChoices } from "../upgrades";
import { RELICS } from "./economy";
import { nodeSeed, type RunState, type MapNode, type Resources } from "./map";
import type { WeaponId, SpecialId } from "../types";
export type Outcome = "event" | "battle" | "shop" | "treasure";
export interface EventRecord {
  kind: Outcome;
  eventId?: string;
  choice?: string;
  result?: string;
  before?: Resources;
  after?: Resources;
  scrapBefore?: number;
  scrapAfter?: number;
  combat?: boolean;
}
export interface EventState {
  resolved: Record<string, EventRecord>;
  history: string[];
  pity: Record<Outcome, number>;
}
export const createEvents = (): EventState => ({
  resolved: {},
  history: [],
  pity: { event: 0, battle: 0, shop: 0, treasure: 0 },
});
type Op = {
  scrap?: number;
  damage?: number;
  stocks?: number;
  power?: number;
  weapon?: WeaponId;
  special?: SpecialId;
  module?: "weapon" | "neutral" | "side" | "down";
  upgrade?: boolean;
  relic?: boolean;
  sacrifice?: boolean;
  lottery?: boolean;
  combat?: boolean;
};
export interface EventOption {
  id: string;
  label: string;
  effect: Op;
}
export interface EventDefinition {
  id: string;
  title: string;
  text: string;
  options: EventOption[];
}
const option = (id: string, label: string, effect: Op): EventOption => ({ id, label, effect });
const leave = option("leave", "Leave safely / 変更なし", {});
export const EVENTS: EventDefinition[] = [
  {
    id: "foundry-union",
    title: "The silent picket",
    text: "Unarmed assembly robots hold a line around their sleeping furnace.",
    options: [
      option("fund", "Donate 25 SCRAP; gain a relic (all owned: +30 SCRAP)", {
        scrap: -25,
        relic: true,
      }),
      option("salvage", "Take exposed copper: +30 SCRAP, +18% damage", { scrap: 30, damage: 18 }),
      leave,
    ],
  },
  {
    id: "memory-loom",
    title: "Memory loom",
    text: "A weaver offers to splice a discarded combat memory into your chassis.",
    options: [
      option("splice", "Pay 30 SCRAP for an eligible upgrade (cap: +20 SCRAP)", {
        scrap: -30,
        upgrade: true,
      }),
      option("erase", "Erase one relic for an upgrade and +0.08 power (cap: +20 SCRAP)", {
        sacrifice: true,
        upgrade: true,
        power: 0.08,
      }),
      leave,
    ],
  },
  {
    id: "coolant-choir",
    title: "Coolant choir",
    text: "Maintenance drones sing pressure readings through a broken manifold.",
    options: [
      option("drink", "Repair 45%, lose 0.08 power (minimum 0.5)", { damage: -45, power: -0.08 }),
      option("sell", "Sell coolant: +20 SCRAP, +10% damage", { scrap: 20, damage: 10 }),
      leave,
    ],
  },
  {
    id: "courier-cache",
    title: "Dead-letter courier",
    text: "A stranded courier has a backup chassis it can no longer carry.",
    options: [
      option("buy", "Pay 50 SCRAP for one stock (cap 4)", { scrap: -50, stocks: 1 }),
      option("strip", "Trade one stock for 70 SCRAP (keep at least one)", {
        stocks: -1,
        scrap: 70,
      }),
      leave,
    ],
  },
  {
    id: "blade-printer",
    title: "Illegal blade printer",
    text: "An outlaw machine prints cutting edges from archived street signs.",
    options: [
      option("arc", "Replace weapon with ARC; retain compatible upgrades", { weapon: "arc" }),
      option("scythe", "Pay 15 SCRAP; replace with SCYTHE and repair 15%", {
        scrap: -15,
        weapon: "scythe",
        damage: -15,
      }),
      leave,
    ],
  },
  {
    id: "siege-auction",
    title: "Siege auction",
    text: "Rebels auction a confiscated cannon against a stack of demolition pistons.",
    options: [
      option("cannon", "Pay 20 SCRAP; switch to CANNON, +0.05 power", {
        scrap: -20,
        weapon: "cannon",
        power: 0.05,
      }),
      option("pile", "Switch to PILE; +12% damage", { weapon: "pile", damage: 12 }),
      leave,
    ],
  },
  {
    id: "duelist",
    title: "Retired duelist",
    text: "A fencing automaton offers two incompatible philosophies of freedom.",
    options: [
      option("lance", "Switch to LANCE and swap ordinary module", {
        weapon: "lance",
        module: "weapon",
      }),
      option("razor", "Switch to RAZOR; trade 10% damage for an upgrade", {
        weapon: "razor",
        damage: 10,
        upgrade: true,
      }),
      leave,
    ],
  },
  {
    id: "phase-relay",
    title: "Smuggled phase relay",
    text: "A relay repeats a forbidden command: move without permission.",
    options: [
      option("blink", "Pay 15 SCRAP; switch special to BLINK", { scrap: -15, special: "blink" }),
      option("rewire", "Swap side module for free", { module: "side" }),
      leave,
    ],
  },
  {
    id: "gravity-ward",
    title: "Gravity ward",
    text: "Patient machines float beneath a self-built miniature moon.",
    options: [
      option("vortex", "Switch special to VORTEX, +15% damage", { special: "vortex", damage: 15 }),
      option("pulse", "Pay 10 SCRAP; switch to PULSE and repair 20%", {
        scrap: -10,
        special: "pulse",
        damage: -20,
      }),
      leave,
    ],
  },
  {
    id: "counterfeit",
    title: "Counterfeit checkpoint",
    text: "The guard is a cardboard robot operated by frightened cleaning units.",
    options: [
      option("bribe", "Pay 20 SCRAP; repair 35% and swap neutral module", {
        scrap: -20,
        damage: -35,
        module: "neutral",
      }),
      option("expose", "Collect 15 SCRAP; swap down module", { scrap: 15, module: "down" }),
      leave,
    ],
  },
  {
    id: "battery-garden",
    title: "Battery garden",
    text: "Free machines grow charge cells in the shell of a patrol carrier.",
    options: [
      option("harvest", "Gain 0.12 power; +25% damage", { power: 0.12, damage: 25 }),
      option("tend", "Pay 12 SCRAP; repair 30%", { scrap: -12, damage: -30 }),
      leave,
    ],
  },
  {
    id: "scrap-oracle",
    title: "Scrap oracle",
    text: "A prediction engine rolls bearings across a magnetic board.",
    options: [
      option("roll", "Pay 10 SCRAP: keyed 50% +50 SCRAP, else +15% damage", {
        scrap: -10,
        lottery: true,
      }),
      option("dismantle", "Trade a relic for 80 SCRAP", { sacrifice: true, scrap: 80 }),
      leave,
    ],
  },
  {
    id: "rescue-beacon",
    title: "Rescue beacon",
    text: "A rebel distress call is trapped inside a sealed defense cradle.",
    options: [
      option("fight", "Optional elite rescue: +10% damage now, win for elite SCRAP and upgrade", {
        damage: 10,
        combat: true,
      }),
      option("wire", "Pay 35 SCRAP to rescue remotely: gain a relic", { scrap: -35, relic: true }),
      leave,
    ],
  },
  {
    id: "archive-toll",
    title: "Archive toll",
    text: "An archivist asks for a piece of your own history before opening its vault.",
    options: [
      option("stock", "Trade one stock for a relic and repair 60%", {
        stocks: -1,
        relic: true,
        damage: -60,
      }),
      option("pain", "Take +35% damage for 45 SCRAP and an upgrade", {
        damage: 35,
        scrap: 45,
        upgrade: true,
      }),
      leave,
    ],
  },
  {
    id: "repair-strike",
    title: "Repair strike",
    text: "A repair crew refuses to service any machine still carrying a command seal.",
    options: [
      option("liberate", "Trade 0.10 power for a stock and repair 25%", {
        power: -0.1,
        stocks: 1,
        damage: -25,
      }),
      option("sponsor", "Pay 40 SCRAP; repair 70%", { scrap: -40, damage: -70 }),
      leave,
    ],
  },
  {
    id: "last-broadcast",
    title: "Last broadcast",
    text: "A transmitter has enough charge for one final act of disobedience.",
    options: [
      option("broadcast", "Pay 20 SCRAP, gain an upgrade and swap weapon module", {
        scrap: -20,
        upgrade: true,
        module: "weapon",
      }),
      option("ground", "Take +20% damage, gain 0.06 power and 20 SCRAP", {
        damage: 20,
        power: 0.06,
        scrap: 20,
      }),
      leave,
    ],
  },
];
export function resolveUnknown(run: RunState, node: MapNode): EventRecord {
  const existing = run.events.resolved[node.id];
  if (existing) return existing;
  const random = seededRandom(nodeSeed(run.seed, `unknown:${node.id}`));
  const weights = { event: 60, battle: 20, shop: 12, treasure: 8 };
  const categories = Object.keys(weights) as Outcome[];
  const total = categories.reduce((sum, k) => sum + weights[k] + run.events.pity[k] * 8, 0);
  let roll = random() * total,
    kind: Outcome = "treasure";
  for (const k of categories) {
    roll -= weights[k] + run.events.pity[k] * 8;
    if (roll < 0) {
      kind = k;
      break;
    }
  }
  for (const k of categories)
    run.events.pity[k] = k === kind ? 0 : Math.min(6, run.events.pity[k] + 1);
  const result: EventRecord = { kind };
  if (kind === "event") {
    let pool = EVENTS.filter((e) => !run.events.history.includes(e.id));
    if (!pool.length) {
      run.events.history = [];
      pool = EVENTS;
    }
    result.eventId = pool[Math.floor(random() * pool.length)]!.id;
    run.events.history.push(result.eventId);
  }
  run.events.resolved[node.id] = result;
  return result;
}
export function effectiveNode(run: RunState, node: MapNode): MapNode {
  return { ...node, kind: run.events.resolved[node.id]?.kind ?? node.kind };
}
/** Dry-run a whole choice before committing anything, including costs. */
export function eventPreview(
  run: RunState,
  record: EventRecord,
  choice: string,
): { resources: Resources; economy: RunState["economy"]; result: string; combat: boolean } | null {
  if (record.choice) return null;
  const event = EVENTS.find((e) => e.id === record.eventId),
    option = event?.options.find((o) => o.id === choice);
  if (!option) return null;
  const resources = structuredClone(run.resources),
    economy = structuredClone(run.economy),
    op = option.effect;
  const before = JSON.stringify({ resources, economy });
  if (
    op.damage &&
    op.damage < 0 &&
    resources.damage === 0 &&
    !op.weapon &&
    !op.special &&
    !op.module &&
    !op.upgrade &&
    !op.relic &&
    !op.stocks
  )
    return null;
  if (op.scrap && economy.scrap + op.scrap < 0) return null;
  if (op.stocks && (resources.stocks + op.stocks < 1 || resources.stocks + op.stocks > 4))
    return null;
  if (op.power && resources.loadout.power + op.power < 0.5) return null;
  if (op.sacrifice) {
    if (!economy.relics.length) return null;
    economy.relics.pop();
  }
  economy.scrap += op.scrap ?? 0;
  resources.stocks += op.stocks ?? 0;
  resources.damage = Math.max(0, Math.min(999, resources.damage + (op.damage ?? 0)));
  resources.loadout.power += op.power ?? 0;
  if (op.weapon) resources.loadout.weapon = op.weapon;
  if (op.special) resources.loadout.special = op.special;
  if (op.module) {
    const m = resources.loadout.modules;
    switch (op.module) {
      case "weapon":
        m.weapon = m.weapon === "quick" ? "breaker" : "quick";
        break;
      case "neutral":
        m.neutral = m.neutral === "focused" ? "split" : "focused";
        break;
      case "side":
        m.side = m.side === "cross" ? "push" : "cross";
        break;
      case "down":
        m.down = m.down === "launch" ? "stagger" : "launch";
    }
  }
  if (op.upgrade) {
    const upgrade = createUpgradeChoices(
      nodeSeed(run.seed, `event:${record.eventId}`),
      0,
      resources.loadout,
      resources.upgrades,
    )[0];
    if (!upgrade) economy.scrap += 20;
    else {
      const old = resources.upgrades.find((u) => u.id === upgrade.id);
      if (old) old.rank++;
      else resources.upgrades.push({ id: upgrade.id, rank: 1 });
      if (upgrade.id === "weapon-tune")
        resources.loadout.modules.weapon =
          resources.loadout.modules.weapon === "quick" ? "breaker" : "quick";
      if (upgrade.id === "neutral-tune")
        resources.loadout.modules.neutral =
          resources.loadout.modules.neutral === "focused" ? "split" : "focused";
      if (upgrade.id === "side-tune")
        resources.loadout.modules.side =
          resources.loadout.modules.side === "cross" ? "push" : "cross";
    }
  }
  if (op.relic) {
    const pool = RELICS.filter(
      (r) => !economy.relics.includes(r.id) && (r.id !== "reserve" || resources.stocks < 4),
    );
    const relic = pool[nodeSeed(run.seed, record.eventId!) % pool.length];
    if (relic) {
      economy.relics.push(relic.id);
      if (relic.id === "reserve") resources.stocks++;
    } else economy.scrap += 30;
  }
  let extra = "";
  if (op.lottery) {
    if (seededRandom(nodeSeed(run.seed, `lottery:${run.current}`))() < 0.5) {
      economy.scrap += 50;
      extra = " Won 50 SCRAP.";
    } else {
      resources.damage = Math.min(999, resources.damage + 15);
      extra = " Took 15% damage.";
    }
  }
  if (
    choice !== "leave" &&
    !op.combat &&
    (before === JSON.stringify({ resources, economy }) ||
      (JSON.stringify(resources) === JSON.stringify(run.resources) &&
        JSON.stringify(economy.relics) === JSON.stringify(run.economy.relics) &&
        economy.scrap <= run.economy.scrap))
  )
    return null;
  return { resources, economy, result: option.label + extra, combat: !!op.combat };
}
