import { runCampaignInputs } from './helpers/play';
import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { STAGES } from '../src/game/campaign';
import { EMPTY_INPUT, type ActorKind } from '../src/game/types';

const tick = (game: GameEngine, count = 1) => { for (let i = 0; i < count; i++) game.update(1 / 60); };
// Structural fixture only; the ordinary-input campaign test independently verifies playability.
const defeatWave = (game: GameEngine) => {
  const wave = game.world.wave;
  for (let i = 0; i < 1200 && game.world.wave === wave && game.world.phase === 'playing'; i++) {
    game.world.enemies.forEach((enemy) => { if (enemy.alive) enemy.x = game.world.arenaMax + 6; });
    tick(game);
    if (wave === STAGES[game.world.sector]!.waves.length && !game.world.objective.complete && !game.world.pendingSpawns.length && !game.world.enemies.some((enemy) => enemy.alive)) break;
  }
};
const gameAt = (sector = 0) => {
  const game = new GameEngine(73);
  game.start(createCandidates(73).find((c) => c.weapon === 'pile')!);
  for (let i = 0; i < sector; i++) { game.world.phase = 'sector-clear'; if (game.world.upgradeChoices[0]) game.claimUpgrade(game.world.upgradeChoices[0].id); game.nextSector(); }
  return game;
};
const isolated = (kind: ActorKind) => {
  const game = gameAt();
  game.world.mode = 'training'; tick(game, 150);
  const enemy = game.world.enemies[0]!;
  game.world.enemies = [enemy];
  enemy.kind = kind; enemy.x = 5; enemy.z = 0; enemy.invulnerable = 0;
  game.world.player.x = 0; game.world.player.z = 0; game.world.player.invulnerable = 100;
  game.world.mode = 'campaign';
  return { game, enemy };
};

describe('campaign structure and supplies', () => {
  it('offers seven distinct stages with introductions, combined encounters and two midbosses', () => {
    expect(STAGES).toHaveLength(7);
    expect(new Set(STAGES.map((stage) => stage.theme)).size).toBe(7);
    expect(STAGES.filter((stage) => stage.waves.some((wave) => wave.enemies.includes('warden')))).toHaveLength(2);
    const kinds = new Set(STAGES.flatMap((s) => s.waves.flatMap((w) => w.enemies)));
    for (const kind of ['leaper', 'artillery', 'rider', 'captain', 'drone', 'boss']) expect(kinds.has(kind as ActorKind)).toBe(true);
  });

  it('clears every encounter and only wins after the final boss', () => {
    const game = gameAt();
    for (let sector = 0; sector < STAGES.length; sector++) {
      expect(game.world.sector).toBe(sector);
      for (let wave = 0; wave < STAGES[sector]!.waves.length; wave++) {
        expect(game.world.wave).toBe(wave + 1);
        const live = game.world.enemies.filter((enemy) => enemy.alive);
        expect(live.length).toBeGreaterThan(0);
        expect(live.every((enemy) => enemy.x <= game.world.arenaMax && enemy.x >= game.world.arenaMin)).toBe(true);
        defeatWave(game);
      }
      if (sector < STAGES.length - 1) {
        runCampaignInputs(game, 3600, () => game.world.phase === 'sector-clear');
        expect(game.world.phase).toBe('sector-clear');
        expect(game.world.completedSectors).toBe(sector + 1);
        if (game.world.upgradeChoices[0]) game.claimUpgrade(game.world.upgradeChoices[0].id); game.nextSector();
      }
    }
    expect(game.world.phase).toBe('won');
    expect(game.world.completedSectors).toBe(STAGES.length);
  });

  it('grants a supply once at a cleared stage and preserves upgrades into the next', () => {
    const game = gameAt();
    const power = game.world.loadout.power;
    expect(game.claimSupply('power')).toBe(false);
    for (let wave = 0; wave < STAGES[0]!.waves.length; wave++) {
      game.world.enemies.forEach((enemy) => { enemy.x = game.world.arenaMax + 6; }); tick(game, 100);
    }
    runCampaignInputs(game, 3600, () => game.world.phase === 'sector-clear');
    game.pause();
    expect(game.claimSupply('power')).toBe(true);
    expect(game.claimSupply('stock')).toBe(false);
    expect(game.world.loadout.power).toBeCloseTo(power + 0.08);
    game.resume(); if (game.world.upgradeChoices[0]) game.claimUpgrade(game.world.upgradeChoices[0].id); game.nextSector();
    expect(game.world.loadout.power).toBeCloseTo(power + 0.08);
    expect(game.world.supplyClaimed).toBe(false);
  });

  it('resets campaign upgrades when retrying the same chassis', () => {
    const game = gameAt();
    const power = game.world.loadout.power;
    game.world.phase = 'sector-clear';
    game.claimSupply('power');
    game.restart();
    expect(game.world.loadout.power).toBe(power);
    expect(game.world.sector).toBe(0);
    expect(game.world.completedSectors).toBe(0);
  });
});

describe('specialist encounters', () => {
  it('commits a jumping strike, leaves the ground and lands in recovery', () => {
    const { game, enemy } = isolated('leaper');
    for (let i = 0; i < 120 && !enemy.attack; i++) tick(game);
    expect(enemy.attack?.name).toBe('LEAP STRIKE');
    const z = enemy.z;
    game.world.player.z = 3;
    let peak = 0;
    for (let i = 0; i < 110; i++) { tick(game); peak = Math.max(peak, enemy.y); }
    expect(peak).toBeGreaterThan(1.4);
    expect(enemy.y).toBe(0);
    expect(enemy.alive).toBe(true);
    expect(z).toBeCloseTo(0);
  });

  it('stops the leaper during landing recovery instead of sliding through the arena', () => {
    const { game, enemy } = isolated('leaper');
    for (let i = 0; i < 120 && !enemy.attack; i++) tick(game);
    tick(game, 99);
    expect(enemy.state).toBe('attack');
    expect(enemy.y).toBe(0);
    expect(Math.abs(enemy.vx)).toBeLessThan(0.1);
  });

  it('fires a mortar at the marked point instead of tracking the player afterward', () => {
    const { game, enemy } = isolated('artillery');
    enemy.x = 8;
    for (let i = 0; i < 150 && !enemy.attack; i++) tick(game);
    expect(enemy.attack?.name).toBe('MORTAR SALVO');
    game.world.player.z = 3.7;
    for (let i = 0; i < 120 && !game.world.projectiles.length; i++) tick(game);
    const shot = game.world.projectiles[0]!;
    expect(shot.kind).toBe('mortar');
    expect(shot.target?.z).toBeCloseTo(0);
    game.world.player.invulnerable = 0;
    tick(game, 90);
    expect(game.world.player.damage).toBe(0);
    expect(game.world.projectiles).toHaveLength(0);
  });

  it('damages a fighter who stays in the mortar impact zone', () => {
    const { game, enemy } = isolated('artillery');
    enemy.x = 8;
    game.world.player.invulnerable = 0;
    tick(game, 150);
    expect(game.world.player.damage).toBeGreaterThan(0);
  });

  it('keeps an in-flight mortar dangerous after its owner is removed', () => {
    const { game, enemy } = isolated('artillery');
    enemy.x = 8;
    for (let i = 0; i < 150 && !game.world.projectiles.length; i++) tick(game);
    expect(game.world.projectiles).toHaveLength(1);
    game.world.enemies = [];
    game.world.player.invulnerable = 0;
    tick(game, 75);
    expect(game.world.player.damage).toBeGreaterThan(0);
    expect(game.world.projectiles).toHaveLength(0);
  });

  it('knocks a rider off its mount and switches it to foot combat', () => {
    const { game, enemy } = isolated('rider');
    game.world.mode = 'training';
    enemy.mount = 25; enemy.x = 1.5;
    game.update(1 / 60, { ...EMPTY_INPUT, smash: true, smashHeld: true });
    for (let i = 0; i < 40; i++) game.update(1 / 60, { ...EMPTY_INPUT, smashHeld: true });
    tick(game, 30);
    expect(enemy.mount).toBe(0);
    expect(enemy.alive).toBe(true);
    expect(game.world.effects.some((effect) => effect.text === 'DISMOUNT')).toBe(true);
  });

  it('spawns two small followers per captain and staggers them when their leader falls', () => {
    const game = gameAt(3);
    const captain = game.world.enemies.find((enemy) => enemy.kind === 'captain')!;
    expect(captain).toBeDefined();
    const minions = game.world.enemies.filter((enemy) => enemy.leaderId === captain.id);
    expect(minions).toHaveLength(2);
    expect(minions.every((enemy) => enemy.scale < 0.7)).toBe(true);
    captain.x = game.world.arenaMax + 6;
    tick(game);
    expect(minions.every((enemy) => enemy.state === 'hurt' && enemy.leaderId === null)).toBe(true);
    tick(game, 90);
    expect(game.world.enemies.filter((enemy) => enemy.kind === 'minion').length).toBeLessThanOrEqual(2);
  });

  it('uses an armored midboss without ending the campaign on its defeat', () => {
    const game = gameAt(1);
    for (let wave = 0; wave < STAGES[1]!.waves.length - 1; wave++) {
      game.world.enemies.forEach((enemy) => { enemy.x = game.world.arenaMax + 6; }); tick(game, 100);
    }
    const warden = game.world.enemies.find((enemy) => enemy.kind === 'warden')!;
    expect(warden.armor).toBeGreaterThan(0);
    expect(warden.scale).toBeGreaterThan(1.5);
    game.world.enemies.forEach((enemy) => { enemy.x = game.world.arenaMax + 6; }); tick(game, 100);
    expect(game.world.phase).toBe('sector-clear');
  });
});
