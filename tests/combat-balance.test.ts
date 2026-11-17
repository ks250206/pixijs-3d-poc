import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { EMPTY_INPUT, type InputFrame } from '../src/game/types';

const tick = (g: GameEngine, n = 1, input: Partial<InputFrame> = {}) => {
  for (let i = 0; i < n; i++) g.update(1 / 60, { ...EMPTY_INPUT, ...input });
};
function lab() {
  const g = new GameEngine(73);
  g.start({ ...createCandidates(73)[0]!, weapon: 'arc', power: 1 }, 'training');
  tick(g, 120);
  g.world.props = [];
  Object.assign(g.world.player, { x: 0, z: 0 });
  g.world.enemies = g.world.enemies.slice(0, 1);
  Object.assign(g.world.enemies[0]!, { x: 1.4, y: 0, z: 0, invulnerable: 0 });
  return g;
}

describe('slower offensive rhythm', () => {
  it('keeps a confirmed jab committed past the old cancel window', () => {
    const g = lab(), p = g.world.player;
    g.world.loadout.modules.weapon = 'quick';
    tick(g, 1, { attack: true });
    const first = p.attack;
    while (p.attack!.elapsed * 60 < 4 || g.world.hitstop > 0) tick(g);
    expect(g.world.enemies[0]!.damage).toBeGreaterThan(0);
    tick(g, 1, { attack: true });
    tick(g, 3);
    expect(p.attack).toBe(first);
    // A fresh press near recovery still permits an intentional combo.
    while (p.attack!.elapsed * 60 < 12) tick(g);
    tick(g, 1, { attack: true });
    expect(p.attack).not.toBe(first);
    expect(p.attack?.combo).toBe(1);
  });

  it('brakes a dash attack and does not relaunch on a hit-confirm chain', () => {
    const g = lab(), p = g.world.player, target = g.world.enemies[0]!;
    Object.assign(target, { kind: 'boss', armor: 1000, scale: 2, x: 2 });
    tick(g, 1, { attack: true, dash: true, moveX: 1 });
    const first = p.attack!;
    while (first.elapsed * 60 < 18 || g.world.hitstop > 0) tick(g, 1, { dash: true });
    expect(target.damage).toBeGreaterThan(0);
    expect(p.vx).toBeLessThan(2);
    expect(p.x).toBeLessThan(1.5);
    tick(g, 1, { attack: true, dash: true });
    expect(p.attack).not.toBe(first);
    expect(p.attack?.kind).toBe('jab');
    tick(g, 12);
    expect(p.vx).toBeLessThan(0.5);
    expect(p.x).toBeLessThan(1.7);
  });

  it.each(['cross', 'push'] as const)('limits side-phase travel for %s', module => {
    const g = lab(), p = g.world.player;
    g.world.enemies = [];
    g.world.loadout.modules.side = module;
    tick(g, 1, { special: true, moveX: 1 });
    expect(p.vx).toBeLessThanOrEqual(module === 'cross' ? 12 : 8);
    while (p.attack) tick(g);
    expect(p.x).toBeLessThan(module === 'cross' ? 4.7 : 3.2);
    expect(p.vx).toBeLessThan(3);
    tick(g, 4);
    expect(p.vx).toBe(0);
  });

  it('reduces actual normal and throw damage by ten percent', () => {
    const g = lab(), target = g.world.enemies[0]!;
    g.world.loadout.modules.weapon = 'quick';
    tick(g, 1, { attack: true });
    while (target.damage === 0) tick(g);
    expect(target.damage).toBeCloseTo(4.05);
    const thrown = lab();
    tick(thrown, 1, { grab: true });
    tick(thrown, 1, { attack: true });
    expect(thrown.world.enemies[0]!.damage).toBeCloseTo(11.7);
  });
});
