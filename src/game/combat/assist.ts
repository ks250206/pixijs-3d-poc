import type { ActorKind } from '../types';
import { bodyHurtbox, type Hurtbox } from './geometry';

/**
 * Lane assist (奥・手前の当たり判定補正), in world units per side.
 *
 * When the PLAYER's attack is tested — melee strikes against enemy bodies and destructible props,
 * and player-owned projectiles against enemy bodies — the target's box is widened along Z (depth)
 * only, by this much on each side. X reach and vertical reach are untouched. Enemy attacks against
 * the player never use it: the player is exactly as easy to hit as before.
 *
 * The Training HITBOX overlay draws enemy boxes with this padding (that is the depth the player's
 * weapon is tested against), and the readability depth band is derived from it.
 */
export const PLAYER_LANE_ASSIST = 0.45;

/** The same box, widened along Z only. Pure; the input box is not modified. */
export function laneAssist(box: Hurtbox, pad = PLAYER_LANE_ASSIST): Hurtbox {
  return {
    min: { x: box.min.x, y: box.min.y, z: box.min.z - pad },
    max: { x: box.max.x, y: box.max.y, z: box.max.z + pad },
  };
}

/** Whether a body box is tested with the lane assist: only when the attacker is the player. */
export const assistedBy = (attacker: ActorKind): number => (attacker === 'player' ? PLAYER_LANE_ASSIST : 0);

/**
 * Half-depth of a standard (scale 1) enemy's assisted body box. On the attacker's own lane, any
 * player strike that reaches the enemy in X and height connects within this |Δz| — whatever the
 * weapon's radius — so it is the "you can hit this lane" distance the readability band shows.
 */
export const ASSISTED_LANE_DEPTH = laneAssist(bodyHurtbox({ x: 0, y: 0, z: 0, scale: 1, kind: 'scout' })).max.z;
