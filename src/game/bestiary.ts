import type { ActorKind } from './types';

/** Tuning of the enemies that are data-driven; older kinds keep their inline numbers in the engine. */
export interface EnemySpec {
  scale: number;
  /** Knockback divisor: heavier bodies launch less. */
  weight: number;
  speed: number;
  /** Horizontal distance at which the enemy stops approaching and may commit to an attack. */
  reach: number;
  /** Depth (lane) tolerance for committing to an attack. */
  lane: number;
  /** Starting armor; a mirror refills this at the start of each unlaunchable phase. */
  armor?: number;
  /** Altitude held while flying. */
  hover?: number;
  /** Travel speed of a `rush` move. */
  rush?: number;
}

/** Armor of each of the mirror's two unlaunchable phases. */
export const MIRROR_PHASE_ARMOR = 50;
/** Seconds a mirror is untouchable while it changes mode. */
export const MIRROR_SHIFT_TIME = 1.2;

export const BESTIARY: Partial<Record<ActorKind, EnemySpec>> = {
  hound: { scale: 0.8, weight: 0.75, speed: 5.4, reach: 3.3, lane: 0.9, rush: 11 },
  gunhound: { scale: 0.86, weight: 0.85, speed: 3.9, reach: 6.6, lane: 1.8 },
  roller: { scale: 0.9, weight: 1, speed: 5.2, reach: 6.2, lane: 1.6 },
  mauler: { scale: 1.7, weight: 2.4, speed: 1.55, reach: 3.1, lane: 1.5 },
  jester: { scale: 0.95, weight: 0.8, speed: 4.8, reach: 2.2, lane: 1.3 },
  talon: { scale: 0.9, weight: 0.8, speed: 4.2, reach: 4.4, lane: 1.2, hover: 2.4, rush: 10 },
  mirror: { scale: 1, weight: 1, speed: 4.8, reach: 2.1, lane: 1.2, armor: MIRROR_PHASE_ARMOR },
  gargoyle: { scale: 2.2, weight: 2.7, speed: 1.9, reach: 3.9, lane: 1.9, armor: 110, hover: 3.1 },
};

/** Enemies that own the boss gauge and are never part of a random encounter template. */
export const BOSS_KINDS: readonly ActorKind[] = ['boss', 'warden', 'mirror', 'gargoyle'];
export const isBossKind = (kind: ActorKind): boolean => BOSS_KINDS.includes(kind);
/** Bodies built on the player's chassis: they carry and swing the run's weapon. */
export const wieldsWeapon = (kind: ActorKind): boolean => kind === 'player' || kind === 'mirror';
/** Four-legged, wheeled and winged machines that do not use the humanoid skeleton. */
export const CREATURE_KINDS: readonly ActorKind[] = ['drone', 'hound', 'gunhound', 'roller', 'talon'];
export const isCreature = (kind: ActorKind): boolean => CREATURE_KINDS.includes(kind);
