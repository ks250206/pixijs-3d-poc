import { seededRandom } from '../loadouts';
import { STAGES } from '../campaign';
import type { ActorKind, Loadout } from '../types';
import type { RunUpgrade } from '../upgrades';

export type NodeKind = 'battle' | 'elite' | 'shop' | 'unknown' | 'treasure' | 'rest' | 'boss';
export interface MapNode { id: string; act: number; row: number; column: number; kind: NodeKind; theme: number; next: string[] }
export interface Resources { damage: number; stocks: number; loadout: Loadout; upgrades: RunUpgrade[]; score: number; kills: number }
export interface RunState {
  seed: number; map: MapNode[]; act: number; current: string | null; selected: string | null;
  visited: string[]; completed: string[]; phase: 'map' | 'node' | 'combat' | 'reward' | 'finished';
  resources: Resources; originalLoadout: Loadout; difficulty: 'standard';
}
/** Keyed streams never consume one another. Map v1 is entirely CPU-only. */
export function nodeSeed(seed: number, key: string): number {
  let value = seed >>> 0;
  for (const char of key) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value;
}
export function generateMap(seed: number): MapNode[] {
  const random = seededRandom(nodeSeed(seed, 'map-v1'));
  const nodes: MapNode[] = [];
  for (let act = 1; act <= 3; act++) {
    const rows = [1, 3, 4, 3, 4, 3, 1, 1].map((width, row) => Array.from({ length: width }, (_, column): MapNode => {
      const pool: NodeKind[] = row % 2 === 0 ? ['battle', 'elite', 'shop', 'unknown', 'treasure'] : ['battle', 'unknown', 'treasure'];
      return { id: `${act}-${row}-${column}`, act, row, column, kind: row === 4 && column === 1 ? 'shop' : row === 0 ? 'battle' : row === 6 ? 'rest' : row === 7 ? 'boss' : pool[Math.floor(random() * pool.length)]!, theme: Math.floor(random() * STAGES.length), next: [] };
    }));
    for (let row = 0; row < rows.length - 1; row++) {
      const from = rows[row]!, to = rows[row + 1]!;
      from.forEach((node, i) => {
        const center = Math.round(i * (to.length - 1) / Math.max(1, from.length - 1));
        node.next = to.filter((_, j) => Math.abs(j - center) <= 1).map(n => n.id);
      });
      to.forEach((node, j) => { if (!from.some(n => n.next.includes(node.id))) from[Math.round(j * (from.length - 1) / Math.max(1, to.length - 1))]!.next.push(node.id); });
    }
    nodes.push(...rows.flat());
  }
  return nodes;
}
export function createRun(seed: number, loadout: Loadout): RunState {
  return { seed, map: generateMap(seed), act: 1, current: null, selected: null, visited: [], completed: [], phase: 'map', resources: { damage: 0, stocks: 3, loadout: structuredClone(loadout), upgrades: [], score: 0, kills: 0 }, originalLoadout: structuredClone(loadout), difficulty: 'standard' };
}
export function availableNodes(run: RunState): string[] {
  if (run.phase !== 'map') return [];
  const current = run.map.find(n => n.id === run.current);
  return current && current.act === run.act ? current.next : [`${run.act}-0-0`];
}
export function encounterRoster(run: RunState, node: MapNode): ActorKind[] {
  if (node.kind === 'boss') return node.act === 3 ? ['boss'] : node.act === 2 ? ['warden', 'sentinel', 'gunner'] : ['warden', 'scout'];
  const stage = STAGES[node.theme]!;
  const random = seededRandom(nodeSeed(run.seed, `encounter:${node.id}`));
  const templates = stage.waves.filter(w => !w.enemies.some(e => e === 'boss' || e === 'warden'));
  return [...templates[Math.floor(random() * templates.length)]!.enemies];
}
