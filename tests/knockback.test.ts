import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { EMPTY_INPUT, type ActorKind, type WeaponId } from '../src/game/types';

function fixture(percent: number, weapon: WeaponId = 'arc', kind: ActorKind = 'scout', power = 1) {
  const game = new GameEngine(73);
  game.start({ ...createCandidates(73)[0]!, weapon, power }, 'training');
  for (let i = 0; i < 90; i++) game.update(1 / 60);
  game.world.props = [];
  game.world.player.x = -1.5; game.world.player.z = 0;
  const target = game.world.enemies[0]!;
  game.world.enemies = [target];
  Object.assign(target, { kind, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, damage: percent, armor: 0, guard: 0, invulnerable: 0, scale: kind === 'minion' ? 0.58 : 1 });
  return { game, target };
}

function smash(percent: number, weapon: WeaponId = 'arc', kind: ActorKind = 'scout', power = 1) {
  const { game, target } = fixture(percent, weapon, kind, power);
  game.update(1 / 60, { ...EMPTY_INPUT, smash: true, smashHeld: true });
  let launch = 0, distance = 0;
  for (let i = 0; i < 240 && target.alive; i++) {
    game.update(1 / 60, { ...EMPTY_INPUT, smashHeld: true });
    if (!launch && target.damage > percent) launch = Math.hypot(target.vx, target.vy);
    distance = Math.max(distance, Math.abs(target.x));
  }
  return { launch, distance, alive: target.alive, damage: target.damage - percent };
}

describe('enemy knockback at low damage', () => {
  it.each(['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'] as const)('keeps a fresh enemy onstage after a full-power %s smash', (weapon) => {
    const result = smash(0, weapon, 'scout', 1.5);
    expect(result.damage).toBeGreaterThan(25);
    expect(result.alive, JSON.stringify(result)).toBe(true);
    // A boosted first hit travels further but still leaves room before the edge.
    expect(result.distance, JSON.stringify(result)).toBeLessThan(12.5);
  });

  it('ramps up launch as damage builds and still finishes a heavily damaged enemy', () => {
    const fresh = smash(0), chipped = smash(50), damaged = smash(100), finisher = smash(200);
    expect(fresh.launch).toBeGreaterThan(8);
    expect(chipped.launch).toBeGreaterThan(fresh.launch);
    expect(chipped.launch).toBeLessThan(fresh.launch * 1.9);
    expect(damaged.launch).toBeGreaterThan(chipped.launch);
    expect(damaged.launch).toBeLessThan(chipped.launch * 1.5);
    expect(finisher.alive).toBe(false);
    expect(fresh.damage).toBeCloseTo(damaged.damage);
  });

  it('makes even a fresh minion resist a single central smash, while keeping weight differences', () => {
    const minion = smash(0, 'arc', 'minion'), scout = smash(0), bruiser = smash(0, 'arc', 'bruiser');
    expect(minion.alive, JSON.stringify(minion)).toBe(true);
    expect(minion.launch).toBeGreaterThan(scout.launch);
    expect(scout.launch).toBeGreaterThan(bruiser.launch);
  });

  it('applies low-damage resistance to throws as well as strikes', () => {
    const velocities = [0, 100].map((percent) => {
      const { game, target } = fixture(percent);
      game.update(1 / 60, { ...EMPTY_INPUT, grab: true });
      game.update(1 / 60, { ...EMPTY_INPUT, moveZ: -1 });
      expect(target.damage).toBeGreaterThan(percent);
      return target.vy;
    });
    expect(velocities[0]).toBeGreaterThan(0);
    expect(velocities[0]).toBeGreaterThan(5);
    expect(velocities[1]).toBeGreaterThan(velocities[0]!);
    expect(velocities[1]).toBeLessThan(velocities[0]! * 3);
  });

  it('preserves the force of enemy attacks against a fresh player', () => {
    const { game, target } = fixture(0, 'arc', 'gunner');
    game.world.loadout.weight = 1;
    game.world.mode = 'campaign';
    game.world.player.x = 0; target.x = 6;
    for (let i = 0; i < 240 && game.world.player.damage === 0; i++) game.update(1 / 60);
    expect(game.world.player.damage).toBe(8);
    expect(game.world.player.vx).toBeLessThan(-5);
    expect(game.world.player.vy).toBeGreaterThan(2);
  });
});
