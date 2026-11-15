import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { EMPTY_INPUT, type WeaponId } from '../src/game/types';
import { attackMotion } from '../src/render/motion';

const tick = (game: GameEngine, frames: number) => { for (let i = 0; i < frames; i++) game.update(1 / 60); };
function arena(weapon: WeaponId, x = 4, z = 0) {
  const game = new GameEngine(73);
  game.start({ ...createCandidates(73)[0]!, weapon, power: 1 }, 'training');
  tick(game, 90);
  game.world.props = [];
  game.world.player.x = 0; game.world.player.z = 0;
  game.world.enemies = game.world.enemies.slice(0, 2);
  game.world.enemies.forEach((e, i) => { e.x = x; e.z = i ? 4 : z; e.y = 0; e.invulnerable = 0; });
  return game;
}
const jab = (game: GameEngine) => game.update(1 / 60, { ...EMPTY_INPUT, attack: true });

describe('playable fighting styles', () => {
  it('offers every weapon on each selection screen', () => {
    for (const seed of [0, 1, 73, 4294967295]) {
      expect(createCandidates(seed).map((c) => c.weapon).sort()).toEqual(['arc', 'cannon', 'lance', 'pile', 'razor', 'scythe']);
    }
  });
  it('lets a lance reach beyond the blade, with a narrow lane', () => {
    for (const [weapon, z, hits] of [['lance', 0, true], ['arc', 0, false], ['lance', 1.5, false]] as const) {
      const game = arena(weapon as WeaponId, 4, z); jab(game); tick(game, 25);
      expect(game.world.enemies[0]!.damage > 0).toBe(hits);
    }
  });
  it('rewards the lance tip over point-blank contact', () => {
    const near = arena('lance' as WeaponId, 1.4), far = arena('lance' as WeaponId, 4);
    jab(near); jab(far); tick(near, 25); tick(far, 25);
    expect(far.world.enemies[0]!.damage).toBeGreaterThan(near.world.enemies[0]!.damage);
  });
  it('sweeps enemies on both sides and across lanes with the scythe', () => {
    const game = arena('scythe' as WeaponId, 1.5, 1.9);
    game.world.enemies[1]!.x = -1.5; game.world.enemies[1]!.z = -1.9;
    jab(game); tick(game, 30);
    expect(game.world.enemies.every((e) => e.damage > 0)).toBe(true);
  });
  it('fires a normal cannon attack down its lane without consuming the special', () => {
    const game = arena('cannon' as WeaponId, 6);
    jab(game); tick(game, 16);
    expect(game.world.projectiles.some((shot) => shot.ownerId === game.world.player.id)).toBe(true);
    expect(game.world.specialCooldown).toBe(0);
    tick(game, 30);
    expect(game.world.enemies[0]!.damage).toBeGreaterThan(0);
  });
  it('does not auto-aim a cannon normal attack at an enemy in another lane', () => {
    const game = arena('cannon' as WeaponId, 6, 2.5);
    jab(game); tick(game, 16);
    expect(game.world.projectiles).toHaveLength(1);
    expect(game.world.projectiles[0]!.vz).toBe(0);
    tick(game, 40);
    expect(game.world.enemies[0]!.damage).toBe(0);
  });
  it('uses a different thrust, recoil, and spinning motion for the new weapons', () => {
    const game = arena('arc'); jab(game);
    const attack = { ...game.world.player.attack!, elapsed: 0.12 };
    const poses = ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'].map((id) => attackMotion(attack, id as WeaponId));
    expect(new Set(poses.map((p) => JSON.stringify(p))).size).toBe(6);
    expect(poses[4]!.trail).toBe(false);
  });
});
