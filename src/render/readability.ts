import type { Actor } from '../game/types';
import { ASSISTED_LANE_DEPTH } from '../game/combat/assist';

export interface ScreenRect { left: number; top: number; right: number; bottom: number }
export interface LabelAnchor { id: string; x: number; y: number; width: number; height: number; priority: number }
export interface LabelPlacement extends LabelAnchor { visible: boolean }

/**
 * The depth band and enemy rings mark enemies within this |Δz| of the player: a standard enemy's
 * body half-depth plus the player's lane assist (`PLAYER_LANE_ASSIST`), currently 0.73. Inside it,
 * any player strike that reaches the enemy in X and height connects; reach, height, timing and
 * larger or smaller bodies still matter, so it is a positioning aid, not a promise that every
 * move will connect.
 */
export const SAME_LANE_DISTANCE = ASSISTED_LANE_DEPTH;
export const sameLane = (a: Pick<Actor, 'z'>, b: Pick<Actor, 'z'>): boolean => Math.abs(a.z - b.z) <= SAME_LANE_DISTANCE;

export function overlaps(a: ScreenRect, b: ScreenRect, padding = 0): boolean {
  return a.left < b.right + padding && a.right + padding > b.left
    && a.top < b.bottom + padding && a.bottom + padding > b.top;
}

/** Put important labels first, then move or omit lower-priority labels in a crowd. */
export function placeCombatLabels(anchors: LabelAnchor[], width: number, height: number): LabelPlacement[] {
  const placed: ScreenRect[] = [];
  return [...anchors].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)).map(anchor => {
    const x = Math.max(anchor.width / 2 + 8, Math.min(width - anchor.width / 2 - 8, anchor.x));
    for (const offset of [0, -20, 20, -40]) {
      const y = anchor.y + offset;
      const rect = { left: x - anchor.width / 2, right: x + anchor.width / 2, top: y - anchor.height, bottom: y };
      if (rect.top < 54 || rect.bottom > height - 58 || placed.some(other => overlaps(rect, other, 4))) continue;
      placed.push(rect);
      return { ...anchor, x, y, visible: true };
    }
    return { ...anchor, x, visible: false };
  });
}
