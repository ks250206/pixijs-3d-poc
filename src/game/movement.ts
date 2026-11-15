/** Gameplay units. Durations and invulnerability retain the previous dodge windows. */
export const DEPTH_LIMIT = 3.8;
export const PLATFORM_DEPTH = 4.5;
export const DODGE = {
  scale: 2 / 3,
  groundX: (12 * 2) / 3,
  groundZ: (8 * 2) / 3,
  air: (18 * 2) / 3,
  groundDuration: 0.36,
  airDuration: 0.32,
  groundInvulnerability: 0.25,
  airInvulnerability: 0.23,
} as const;
