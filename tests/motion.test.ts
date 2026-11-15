import { describe, expect, it } from 'vite-plus/test';
import { attackMotion } from '../src/render/motion';
import type { AttackVisual, WeaponId } from '../src/game/types';

const attack: AttackVisual = {
  name: 'JAB 1', kind: 'jab', direction: 'forward', elapsed: 0,
  duration: 0.5, range: 2.5, charge: 0, activeStart: 0.15, activeEnd: 0.3, combo: 0,
};

describe('combat motion', () => {
  it('keeps weapon trails inside the live hit window', () => {
    expect(attackMotion({ ...attack, elapsed: 0.1 }, 'arc').trail).toBe(false);
    expect(attackMotion({ ...attack, elapsed: 0.2 }, 'arc').trail).toBe(true);
    expect(attackMotion({ ...attack, elapsed: 0.4 }, 'arc').trail).toBe(false);
  });

  it('gives blades, heavy hammers, and fists distinct strikes', () => {
    const poses = (['arc', 'pile', 'razor'] as WeaponId[]).map((weapon) => attackMotion({ ...attack, elapsed: 0.22 }, weapon));
    expect(poses[0]).not.toEqual(poses[1]);
    expect(poses[1]).not.toEqual(poses[2]);
    const left = attackMotion({ ...attack, elapsed: 0.22, combo: 1 }, 'razor');
    expect(left.leftArmX).not.toBe(poses[2]!.leftArmX);
  });

  it('changes blade follow-ups across the three-hit combo', () => {
    const poses = [0, 1, 2].map((combo) => attackMotion({ ...attack, combo, elapsed: 0.22 }, 'arc'));
    expect(poses[0]).not.toEqual(poses[1]);
    expect(poses[1]).not.toEqual(poses[2]);
  });

  it('returns smoothly to a neutral pose with finite directional aerials', () => {
    for (const direction of ['neutral', 'forward', 'back', 'up', 'down'] as const) {
      for (const weapon of ['arc', 'pile', 'razor'] as const) {
        for (const elapsed of [0, 0.149, 0.15, 0.2, 0.3, 0.499, 0.5]) {
          const pose = attackMotion({ ...attack, kind: 'aerial', direction, elapsed }, weapon);
          for (const value of Object.values(pose)) if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
        }
        expect(attackMotion({ ...attack, direction, elapsed: 0.5 }, weapon).weight).toBe(0);
      }
    }
  });
});
