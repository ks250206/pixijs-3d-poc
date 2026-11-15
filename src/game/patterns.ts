import type { AreaHazard } from './types';

export function createPattern(pattern: AreaHazard['pattern'], group: string, ownerId: string, min: number, max: number, target: { x: number; z: number }, variant = 0, enraged = false): AreaHazard[] {
  const zones: AreaHazard[] = [];
  const windup = enraged ? 0.85 : 1.15;
  const add = (x: number, z: number, width: number, depth: number, delay = windup, height = 5) => {
    zones.push({ id: `${group}-${zones.length}`, group, ownerId, pattern, x, z, width, depth, elapsed: 0, delay, duration: 0.32, height,
      damage: pattern === 'snipe' ? 16 : pattern === 'mine' ? 12 : enraged ? 20 : 17,
      force: pattern === 'mine' ? 6 : 8, hit: false });
  };
  const center = (min + max) / 2, width = max - min;
  if (pattern === 'lanes') {
    for (let lane = 0; lane < 3; lane++) if (lane !== variant % 3) add(center, (lane - 1) * 3, width, 2.2);
  } else if (pattern === 'cross') {
    add(center, Math.max(-2.8, Math.min(2.8, target.z)), width, 1.6);
    add(Math.max(min + 2, Math.min(max - 2, target.x)), 0, 2.6, 8.6);
  } else if (pattern === 'sweep') {
    const cell = width / 7;
    for (let i = 0; i < 7; i++) {
      const column = variant % 2 ? 6 - i : i;
      add(min + cell * (column + 0.5), 0, cell - 0.15, 8.6, windup + i * 0.28);
    }
  } else if (pattern === 'snipe') add(center, target.z, width, 0.9, 1.3);
  else add(target.x, target.z, 2.8, 2.8, 1.5, 1.3);
  return zones;
}

export function insideHazard(hazard: AreaHazard, x: number, z: number): boolean {
  return Math.abs(x - hazard.x) < hazard.width / 2 && Math.abs(z - hazard.z) < hazard.depth / 2;
}
