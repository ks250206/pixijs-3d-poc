/** Gameplay units (world units, seconds; the simulation steps at a fixed 60 Hz). */
export const DEPTH_LIMIT = 3.8;
export const PLATFORM_DEPTH = 4.5;

/**
 * Dodges are purely positional: no dodge grants invulnerability, so they avoid attacks only by
 * actually leaving the hit volume.
 *
 * Ground dash: a burst. The launch speed is the peak, and velocity decays as
 * `v(t) = v0 · exp(−burstDecay · t)` for the whole `groundDuration`, so most of the distance is
 * covered early and the dash then settles. With 60 Hz steps (velocity applied, then decayed) one
 * dash travels `v0/60 · (1 − r^N)/(1 − r)` with `r = exp(−burstDecay/60)` and N = 22 steps:
 *
 * - X (left/right, and a neutral dash in the facing direction): about 1.68, unchanged from the
 *   previous 2/3-scaled dash, at a peak of 17.2 — 1.65× the 10.4 dash-run speed (it was 8).
 * - Z (up = far lane, −Z; down = near lane, +Z): about 1.91, 1.7× the previous 1.12, at a
 *   peak of 19.4.
 * - Diagonals use the normalized stick direction on the same X/Z speeds (an ellipse).
 *
 * Air dash: once per airtime; a brief hang (`airHang`, no gravity) for every air dash.
 * Left/right keep the constant `air` speed along X (released Shift damps it after 0.2 s);
 * up/down dash into the far/near lane with the same burst profile as the ground, from `airZ`.
 * The stick never adds vertical velocity: the air dash is not a recovery tool.
 */
export const DODGE = {
  groundX: 17.2,
  groundZ: 19.7,
  burstDecay: 11,
  air: 12,
  airZ: 21,
  airHang: 0.13,
  groundDuration: 0.36,
  airDuration: 0.32,
} as const;
