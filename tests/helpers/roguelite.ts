import { expect } from 'vite-plus/test';
import type { GameEngine } from '../../src/game/engine';
export function clearEncounter(g: GameEngine): void {
  // Controlled ring-out fixture: exercise real wave-completion, not player AI balance.
  for (let i = 0; i < 900 && g.run?.phase === 'combat'; i++) {
    g.world.player.invulnerable = 100;
    for (const e of g.world.enemies) e.x = g.world.arenaMax + 8;
    g.update(1/60);
  }
  expect(g.run?.phase).toBe('reward');
  g.skipUpgrade();
}
