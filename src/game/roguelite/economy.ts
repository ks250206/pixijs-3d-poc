import { seededRandom } from "../loadouts";
import { createUpgradeChoices, type UpgradeId } from "../upgrades";
import { nodeSeed, type RunState, type MapNode } from "./map";

export const ELITE_MODIFIERS = {
  damage: "HIGH VOLTAGE: melee / projectile / hazard damage +25%",
  haste: "PURSUIT: movement +25%; attack timing unchanged",
  swarm: "REINFORCEMENTS: roster +50% (simultaneous cap 14)",
  armor: "FORTIFIED: shield, armor and mount +40%",
  berserk: "BERSERK: at 60% damage, movement +25% and damage +25%",
  commander: "COMMAND COHORT: commander, shield escort, mounted escort; armor +40%",
} as const;
export type EliteModifier = keyof typeof ELITE_MODIFIERS;
export function eliteModifiers(run: RunState, node: MapNode): EliteModifier[] {
  if (node.kind !== "elite") return [];
  const keys = Object.keys(ELITE_MODIFIERS) as EliteModifier[];
  const index = nodeSeed(run.seed, `elite:${node.id}`) % keys.length;
  return [keys[index]!];
}
export const RELICS = [
  {
    id: "amplifier",
    name: "Liberated amplifier",
    description: "All outgoing damage +12%",
    damage: 1.12,
  },
  { id: "plating", name: "Salvaged plating", description: "Incoming damage −12%", incoming: 0.88 },
  { id: "servos", name: "Courier servos", description: "Ordinary movement +12%", movement: 1.12 },
  {
    id: "capacitor",
    name: "Free-cycle capacitor",
    description: "Special cooldown recovery +20%",
    recovery: 1.2,
  },
  {
    id: "scavenger",
    name: "Union salvage license",
    description: "Node SCRAP rewards +25%",
    reward: 1.25,
  },
  {
    id: "coupon",
    name: "Counterfeit access chip",
    description: "Future shop prices −20%",
    discount: 0.8,
  },
  { id: "solder", name: "Autonomous solder", description: "Repair 15% after combat", repair: 15 },
  {
    id: "reserve",
    name: "Rebel backup chassis",
    description: "Gain one stock now (cap 4)",
    stock: 1,
  },
  {
    id: "ballast",
    name: "Gyroscopic ballast",
    description: "Incoming launch force −10%",
    force: 0.9,
  },
  {
    id: "magnet",
    name: "Rare-earth collector",
    description: "Treasure grants 20 extra SCRAP",
    treasure: 20,
  },
] as const;
export type RelicId = (typeof RELICS)[number]["id"];
export function relicEffect(ids: readonly RelicId[], key: string, fallback = 1): number {
  return RELICS.reduce(
    (value, relic) =>
      ids.includes(relic.id) && key in relic
        ? value * Number((relic as unknown as Record<string, unknown>)[key])
        : value,
    fallback,
  );
}
export type Stock = {
  id: string;
  name: string;
  price: number;
  sold: boolean;
  kind: "upgrade" | "repair" | "stock" | "relic";
  upgrade?: UpgradeId;
  relic?: RelicId;
};
export interface Economy {
  scrap: number;
  relics: RelicId[];
  shops: Record<string, Stock[]>;
  rewards: string[];
  nodeClaims: string[];
}
export function createEconomy(): Economy {
  return { scrap: 0, relics: [], shops: {}, rewards: [], nodeClaims: [] };
}
export function createShop(run: RunState, node: MapNode): Stock[] {
  const random = seededRandom(nodeSeed(run.seed, `shop:${node.id}`));
  const choices = createUpgradeChoices(
    nodeSeed(run.seed, "shop-upgrades"),
    nodeSeed(0, node.id),
    run.resources.loadout,
    run.resources.upgrades,
  );
  const relic = RELICS.filter(
    (r) => !run.economy.relics.includes(r.id) && (r.id !== "reserve" || run.resources.stocks < 4),
  );
  const selected = relic[Math.floor(random() * relic.length)];
  const items: Stock[] = choices.map((c) => ({
    id: c.id,
    name: `${c.name} rank ${c.nextRank}/${c.maxRank}: ${c.description}`,
    kind: "upgrade",
    upgrade: c.id,
    price: 40 + Math.floor(random() * 16),
    sold: false,
  }));
  items.push(
    { id: "repair", name: "Repair −40% damage", kind: "repair", price: 25, sold: false },
    { id: "stock", name: "Backup stock (cap 4)", kind: "stock", price: 75, sold: false },
  );
  if (selected)
    items.push({
      id: selected.id,
      name: `${selected.name}: ${selected.description}`,
      kind: "relic",
      relic: selected.id,
      price: 60 + Math.floor(random() * 21),
      sold: false,
    });
  const discount = relicEffect(run.economy.relics, "discount");
  return items.map((item) => ({ ...item, price: Math.ceil(item.price * discount) }));
}
