import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { STAGES } from '../src/game/campaign';
import { createCandidates } from '../src/game/loadouts';
import { EMPTY_INPUT, type ActorKind } from '../src/game/types';
import { insideHazard } from '../src/game/patterns';

const tick = (game: GameEngine, frames = 1) => { for (let i = 0; i < frames; i++) game.update(1 / 60); };
function fixture(kind: ActorKind = 'scout') {
  const game = new GameEngine(73);
  game.start({ ...createCandidates(73)[0]!, power: 1, weapon: 'arc' }, 'training');
  tick(game, 120);
  game.world.props = [];
  const enemy = game.world.enemies[0]!;
  game.world.enemies = [enemy];
  Object.assign(enemy, { kind, x: 2, y: 0, z: 0, vx: 0, vy: 0, vz: 0, invulnerable: 0, armor: 0 });
  Object.assign(game.world.player, { x: 0, z: 0, invulnerable: 0 });
  return { game, enemy };
}

describe('dedicated smash control', () => {
  it.each([[1, 0], [-1, 0], [0, -1], [0, 1]])('keeps J a normal attack after a direction flick (%s, %s)', (x, z) => {
    const { game } = fixture();
    game.update(1 / 60, { ...EMPTY_INPUT, moveX: x!, moveZ: z!, flickX: x!, flickZ: z!, attack: true, attackHeld: true });
    expect(game.world.player.attack?.kind).toBe('tilt');
    expect(game.world.player.state).toBe('attack');
  });
});

describe('enemy resilience and recovery', () => {
  it.each(['scout', 'drone', 'boss'] as const)('lets an offstage %s boost back onto the platform', (kind) => {
    const { game, enemy } = fixture(kind);
    game.world.mode = 'campaign'; game.world.player.invulnerable = 100;
    enemy.x = game.world.arenaMax + 1; enemy.y = -1;
    tick(game);
    expect(enemy.state).toBe('recover');
    expect(enemy.vx).toBeLessThan(0); expect(enemy.vy).toBeGreaterThan(10);
    tick(game, 100);
    expect(enemy.alive).toBe(true); expect(enemy.y).toBeGreaterThanOrEqual(0);
    expect(enemy.x).toBeLessThan(game.world.arenaMax);
  });

  it('never rescues an enemy past the blast line', () => {
    const { game, enemy } = fixture(); game.world.mode = 'campaign';
    enemy.x = game.world.arenaMax + 6; tick(game);
    expect(enemy.alive).toBe(false);
  });

  it('does not grant a second boost before landing or invulnerability during recovery', () => {
    const { game, enemy } = fixture(); game.world.mode = 'campaign';
    enemy.x = game.world.arenaMax + 1; enemy.y = -1; tick(game);
    expect(enemy.invulnerable).toBe(0);
    enemy.state = 'fall'; enemy.vy = -2;
    tick(game); expect(enemy.vy).toBeLessThan(0);
    expect(enemy.state).not.toBe('recover');
  });

  it('abandons its own attack to recover and can recover while the player respawns', () => {
    for (const attacking of [false, true]) {
      const { game, enemy } = fixture('boss'); game.world.mode = 'campaign';
      if (attacking) {
        for (let i = 0; i < 240 && enemy.state !== 'attack'; i++) tick(game);
        expect(enemy.state).toBe('attack');
      } else game.world.player.alive = false;
      enemy.x = game.world.arenaMax + 1; enemy.y = -1;
      tick(game); expect(enemy.state).toBe('recover');
    }
  });

  it('keeps an exposed boss much steadier than a regular enemy at 100%', () => {
    const launches = (['scout', 'warden', 'boss'] as const).map((kind) => {
      const { game, enemy } = fixture(kind); enemy.damage = 100;
      game.update(1 / 60, { ...EMPTY_INPUT, smash: true });
      for (let i = 0; i < 90 && enemy.damage === 100; i++) tick(game);
      expect(enemy.damage).toBeGreaterThan(100);
      return Math.hypot(enemy.vx, enemy.vy);
    });
    expect(launches[1]!).toBeLessThan(launches[0]! * 0.45);
    expect(launches[2]!).toBeLessThan(launches[0]! * 0.3);
  });
});

describe('telegraphed area attacks', () => {
  function cast(kind: ActorKind = 'boss') {
    const { game, enemy } = fixture(kind);
    enemy.x = 8; game.world.mode = 'campaign';
    for (let i = 0; i < 240 && !game.world.hazards.length; i++) tick(game);
    expect(game.world.hazards.length).toBeGreaterThan(0);
    return { game, enemy };
  }

  it('warns first, freezes on pause, then damages the marked footprint only once', () => {
    const { game } = cast(); const zone = game.world.hazards[0]!;
    game.world.player.x = zone.x; game.world.player.z = zone.z;
    tick(game, 10); expect(game.world.player.damage).toBe(0);
    game.pause(); const elapsed = zone.elapsed; tick(game, 60);
    expect(zone.elapsed).toBe(elapsed); game.resume();
    for (let i = 0; i < 120 && game.world.player.damage === 0; i++) tick(game);
    expect(game.world.player.damage).toBe(zone.damage);
    tick(game, 20); expect(game.world.player.damage).toBe(zone.damage);
  });

  it('leaves a safe lane and cancels pending zones when their owner is defeated', () => {
    const { game, enemy } = cast();
    const safeZ = [-3, 0, 3].find(z => game.world.hazards.every(h => !insideHazard(h, 0, z)))!;
    expect(safeZ).toBeDefined(); game.world.player.z = safeZ;
    tick(game, 100); expect(game.world.player.damage).toBe(0);
    for (let i = 0; i < 240 && !game.world.hazards.length; i++) tick(game);
    expect(game.world.hazards.length).toBeGreaterThan(0);
    enemy.alive = false; tick(game); expect(game.world.hazards).toHaveLength(0);
  });

  it('cycles lane, cross and sequential sweeping attacks', () => {
    const { game } = cast(); game.world.player.invulnerable = 100;
    const patterns = new Set<string>();
    const moves = new Set<string>();
    for (let i = 0; i < 1400; i++) {
      game.world.hazards.forEach(h => patterns.add(h.pattern));
      game.world.enemies.forEach(e => { if (e.attack) moves.add(e.attack.name); });
      tick(game);
    }
    expect([...patterns].sort()).toEqual(['cross', 'lanes', 'sweep']);
    expect([...moves].some(name => name.startsWith('MAINFRAME /'))).toBe(true);
  });

  it('clears warnings on restart and stage transition', () => {
    const { game } = cast();
    game.world.phase = 'sector-clear'; game.nextSector();
    expect(game.world.hazards).toHaveLength(0);
    game.restart(); expect(game.world.hazards).toHaveLength(0);
  });

  it.each([['sniper', 'snipe'], ['sapper', 'mine']] as const)('%s locks a visible %s footprint before firing', (kind, pattern) => {
    const { game } = cast(kind); const zone = game.world.hazards[0]!;
    expect(zone.pattern).toBe(pattern); const z = zone.z;
    game.world.player.z = 3.8; tick(game, 110);
    expect(zone.z).toBe(z); expect(game.world.player.damage).toBe(0);
  });
});

describe('longer campaign', () => {
  it('offers seven stages, 23 encounters, two new specialists and a dedicated horde stage', () => {
    expect(STAGES).toHaveLength(7);
    expect(STAGES.flatMap(s => s.waves)).toHaveLength(23);
    const kinds = STAGES.flatMap(s => s.waves.flatMap(w => w.enemies));
    expect(kinds).toContain('sniper'); expect(kinds).toContain('sapper');
    const horde = STAGES.find(s => s.theme === 'barracks');
    expect(horde?.waves).toHaveLength(4);
    expect(horde?.waves.every(w => w.enemies.length >= 8)).toBe(true);
  });
});
