import { ARENA_HALF_WIDTH, SECTOR_SPAN, STAGES } from './campaign';
import type { ArenaProp } from './types';

/** Walkable lanes remain between machinery; every sector has its own layout. */
export function createArena(sector: number): ArenaProp[] {
  const props: ArenaProp[] = [];
  const add = (kind: ArenaProp['kind'], x: number, z: number, width = 1.1, depth = 1.1, direction: 1 | -1 = 1) => {
    props.push({
      id: `arena-${sector}-${props.length}`, kind, x: sector * SECTOR_SPAN + x * ARENA_HALF_WIDTH / 11, z, width, depth,
      height: kind === 'barrel' ? 1.35 : kind === 'crate' ? 1 : 0.08,
      hp: kind === 'crate' ? 12 : kind === 'barrel' ? 10 : 0,
      alive: true, phase: 'idle', timer: props.length * 0.65, direction,
    });
  };
  if (sector === 0) {
    add('crate', -3, 2.8);
    add('barrel', 3, -2.8);
    add('vent', -1, -2.8, 2.8, 1.5);
    add('vent', 6, 2.7, 2.8, 1.5);
  } else if (sector === 1) {
    add('conveyor', 0, -2, 12, 1.5);
    add('conveyor', 0, 2, 12, 1.5, -1);
    add('crate', -5, 3.3);
    add('barrel', 4, -3.3);
    add('vent', 6, 0, 2.4, 1.6);
  } else if (sector === 2) {
    add('crate', -5, 2.8);
    add('barrel', 4, -2.8);
    add('conveyor', 0, 0, 8, 1.4, -1);
    add('vent', 7, 2.8, 2, 1.5);
  } else if (sector === 3) {
    add('crate', -4, -3);
    add('crate', 5, 3);
    add('barrel', 2, -2.5);
    add('barrel', 4, -2.5);
    add('vent', -1, 2.6, 3.4, 1.5);
  } else if (STAGES[sector]?.theme === 'barracks') {
    add('barrel', -6, -2.7); add('barrel', 6, 2.7);
    add('barrel', 3, -2.7); add('crate', -7, 2.8); add('crate', 7, -3);
  } else if (STAGES[sector]?.theme === 'gauntlet') {
    add('conveyor', 0, -2.6, 19, 1.3); add('conveyor', 0, 2.6, 19, 1.3, -1);
    add('crate', -7, 0); add('barrel', 7, -3); add('vent', 4, 0, 2.4, 1.6);
  } else {
    add('crate', 4, -3.1);
    add('barrel', -5, 2.8);
    add('barrel', 6.5, 2.8);
    add('vent', -3, -2.7, 3.2, 1.6);
    add('vent', 3, 2.7, 3.2, 1.6);
  }
  return props;
}

export function insideProp(prop: ArenaProp, x: number, z: number, padding = 0): boolean {
  return Math.abs(x - prop.x) < prop.width / 2 + padding && Math.abs(z - prop.z) < prop.depth / 2 + padding;
}
