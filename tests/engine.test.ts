import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { EMPTY_INPUT, type InputFrame } from '../src/game/types';

const frame = (input: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...input });
const step = (game: GameEngine, frames: number, input: Partial<InputFrame> = {}) => {
  for (let index = 0; index < frames; index++) game.update(1 / 60, frame(input));
};
const training = () => {
  const game = new GameEngine(41);
  game.start(createCandidates(41).find((candidate) => candidate.weapon === 'arc')!, 'training');
  step(game, 90);
  game.world.player.x = 0;
  game.world.player.z = 0;
  game.world.player.invulnerable = 0;
  const target = game.world.enemies[0]!;
  target.x = 1.5; target.z = 0; target.y = 0; target.invulnerable = 0;
  for (const other of game.world.enemies.slice(1)) other.z = 3.6;
  return game;
};

describe('seeded chassis', () => {
  it('reproduces three distinct, mechanically meaningful loadouts', () => {
    expect(createCandidates(73)).toEqual(createCandidates(73));
    expect(createCandidates(73)).not.toEqual(createCandidates(74));
    const choices = createCandidates(73);
    expect(new Set(choices.map((item) => item.weapon)).size).toBe(3);
    expect(new Set(choices.map((item) => item.special)).size).toBe(3);
    expect(new Set(choices.map((item) => item.trait)).size).toBe(3);
    expect(new Set(choices.map((item) => item.speed)).size).toBeGreaterThan(1);
    for (const choice of choices) {
      expect(choice.power).toBeGreaterThan(0);
      expect(choice.speed).toBeGreaterThan(0);
      expect(choice.weight).toBeGreaterThan(0);
    }
  });
});

describe('combat and blast zones', () => {
  it('jab hits a nearby enemy once and does not remove high-damage enemies without a ring-out', () => {
    const game = training();
    const target = game.world.enemies[0]!;
    game.update(1 / 60, frame({ attack: true, attackHeld: true }));
    step(game, 12, { attackHeld: true });
    expect(target.damage).toBeCloseTo(5 * game.world.loadout.power);
    expect(target.alive).toBe(true);
    target.damage = 900;
    target.vx = 0; target.vy = 0; target.vz = 0;
    target.x = 1.5; target.y = 0; target.z = 0;
    step(game, 30);
    expect(target.alive).toBe(true);
    expect(game.world.kills).toBe(0);
    target.x = game.world.arenaMax + 6;
    game.update(1 / 60, frame());
    expect(target.alive).toBe(false);
    expect(game.world.kills).toBe(1);
  });

  it('respects belt depth rather than hitting an enemy in another lane', () => {
    const game = training();
    const target = game.world.enemies[0]!;
    target.z = 3.5;
    game.update(1 / 60, frame({ attack: true }));
    step(game, 25);
    expect(target.damage).toBe(0);
  });

  it('charges a smash while held, then produces stronger launch after release', () => {
    const charged = training();
    const target = charged.world.enemies[0]!;
    charged.update(1 / 60, frame({ smash: true, smashHeld: true }));
    step(charged, 35, { smashHeld: true });
    expect(charged.world.player.state).toBe('charge');
    expect(target.damage).toBe(0);
    expect(charged.world.player.attack?.charge).toBeGreaterThan(0.6);
    charged.update(1 / 60, frame());
    step(charged, 11);
    const chargedDamage = target.damage;
    const chargedVelocity = target.vx;
    const quick = training();
    quick.update(1 / 60, frame({ smash: true, smashHeld: true }));
    quick.update(1 / 60, frame());
    step(quick, 11);
    expect(chargedDamage).toBeGreaterThan(quick.world.enemies[0]!.damage);
    expect(chargedVelocity).toBeGreaterThan(quick.world.enemies[0]!.vx);
  });

  it('same attack launches a damaged enemy farther', () => {
    const fresh = training();
    fresh.update(1 / 60, frame({ smash: true }));
    step(fresh, 11);
    const damaged = training();
    damaged.world.enemies[0]!.damage = 100;
    damaged.update(1 / 60, frame({ smash: true }));
    step(damaged, 11);
    expect(damaged.world.enemies[0]!.vx).toBeGreaterThan(fresh.world.enemies[0]!.vx * 1.5);
  });

  it('grabs and throws a nearby target with directional launch', () => {
    const game = training();
    game.update(1 / 60, frame({ grab: true }));
    expect(game.world.player.state).toBe('grab');
    expect(game.world.enemies[0]!.state).toBe('grabbed');
    game.update(1 / 60, frame({ moveZ: -1 }));
    expect(game.world.lastMove).toBe('UP THROW');
    expect(game.world.enemies[0]!.vy).toBeGreaterThan(7);
    expect(game.world.enemies[0]!.damage).toBeGreaterThan(0);
  });
});

describe('movement', () => {
  it('short-hops, double-jumps, and cannot jump a third time in the air', () => {
    const game = training();
    game.update(1 / 60, frame({ jump: true, jumpHeld: true }));
    step(game, 3, { jumpHeld: true });
    game.update(1 / 60, frame());
    expect(game.world.player.vy).toBeLessThan(5.3);
    game.update(1 / 60, frame({ jump: true, jumpHeld: true }));
    expect(game.world.lastMove).toBe('DOUBLE JUMP');
    step(game, 5, { jumpHeld: true });
    const before = game.world.player.vy;
    game.update(1 / 60, frame({ jump: true, jumpHeld: true }));
    expect(game.world.player.vy).toBeLessThan(before);
  });

  it('turns a low diagonal-down air dodge into a sliding wavedash', () => {
    const game = training();
    game.update(1 / 60, frame({ jump: true, jumpHeld: true }));
    step(game, 3, { jumpHeld: true });
    game.update(1 / 60, frame({ dodge: true, dodgeHeld: true, moveX: 1, moveZ: 1 }));
    expect(game.world.lastMove).toBe('AIR DODGE');
    step(game, 6, { moveX: 1, moveZ: 1, dodgeHeld: true });
    expect(game.world.player.y).toBe(0);
    expect(game.world.player.state).toBe('wavedash');
    expect(game.world.lastMove).toBe('WAVEDASH');
    expect(game.world.player.vx).toBeGreaterThan(8);
    const x = game.world.player.x;
    step(game, 6);
    expect(game.world.player.x).toBeGreaterThan(x + 0.5);
  });

  it('limits air dodging to one use before landing', () => {
    const game = training();
    game.world.player.y = 5;
    game.update(1 / 60, frame({ dodge: true, moveX: 1, dodgeHeld: true }));
    step(game, 20, { dodgeHeld: true });
    const firstVelocity = game.world.player.vx;
    game.update(1 / 60, frame({ dodge: true, moveX: -1, dodgeHeld: true }));
    expect(game.world.player.state).not.toBe('airdodge');
    expect(game.world.player.vx).toBeGreaterThan(0);
    expect(game.world.player.vx).toBeLessThanOrEqual(firstVelocity);
  });

  it('prevents walking off the arena but allows launch into blast zones', () => {
    const game = training();
    game.world.player.x = game.world.arenaMax - 0.4;
    step(game, 90, { moveX: 1 });
    expect(game.world.player.x).toBeLessThan(game.world.arenaMax);
    expect(game.world.player.alive).toBe(true);
    game.world.player.x = game.world.arenaMax + 6;
    game.update(1 / 60, frame());
    expect(game.world.player.alive).toBe(false);
  });

  it('does not snap to the floor when steering underneath the platform', () => {
    const game = training();
    const player = game.world.player;
    player.x = game.world.arenaMax + 0.05;
    player.y = -1; player.vx = -8; player.vy = -3; player.state = 'fall';
    game.update(1 / 60, frame({ moveX: -1 }));
    expect(player.x).toBeLessThan(game.world.arenaMax);
    expect(player.y).toBeLessThan(-1);
    expect(player.state).toBe('fall');
    // Ground-only actions must remain unavailable while underneath the floor.
    game.update(1 / 60, frame({ smash: true, smashHeld: true }));
    expect(player.attack?.kind).toBe('aerial');
    expect(player.y).toBeLessThan(-1);
  });

  it('allows recovery to rise above the platform before landing from above', () => {
    const game = training();
    const player = game.world.player;
    player.x = 0; player.z = 3.7; player.y = -1; player.vy = -3; player.state = 'fall';
    game.update(1 / 60, frame({ special: true, moveZ: -1 }));
    expect(player.y).toBeGreaterThan(-1);
    expect(player.y).toBeLessThan(0);
    step(game, 20);
    expect(player.y).toBeGreaterThan(0);
    step(game, 75);
    expect(player.y).toBe(0);
    expect(player.alive).toBe(true);
  });

  it('selects an aerial for simultaneous jump and smash, and cannot grab after takeoff', () => {
    const game = training();
    game.update(1 / 60, frame({ jump: true, jumpHeld: true, smash: true, smashHeld: true }));
    expect(game.world.player.y).toBeGreaterThan(0);
    expect(game.world.player.state).toBe('attack');
    expect(game.world.player.attack?.kind).toBe('aerial');
    const grabGame = training();
    grabGame.update(1 / 60, frame({ jump: true, jumpHeld: true, grab: true }));
    expect(grabGame.world.player.y).toBeGreaterThan(0);
    expect(grabGame.world.player.state).toBe('jump');
    expect(grabGame.world.enemies[0]!.state).not.toBe('grabbed');
  });
});

describe('campaign', () => {
  it('consumes stocks, respawns with invulnerability, and loses on stock three', () => {
    const game = new GameEngine(51);
    game.start(createCandidates(51)[0]!);
    for (let loss = 0; loss < 3; loss++) {
      game.world.player.x = game.world.arenaMax + 6;
      game.update(1 / 60, frame());
      expect(game.world.stocks).toBe(2 - loss);
      if (loss < 2) {
        step(game, 75);
        expect(game.world.player.alive).toBe(true);
        expect(game.world.player.invulnerable).toBeGreaterThan(2);
        expect(game.world.player.damage).toBe(0);
      }
    }
    expect(game.world.phase).toBe('lost');
    game.restart();
    expect(game.world.phase).toBe('playing');
    expect(game.world.stocks).toBe(3);
    expect(game.world.kills).toBe(0);
    expect(game.world.sector).toBe(0);
  });

  it('clears two waves, unlocks a gate, and transitions to the next sector', () => {
    const game = new GameEngine(51);
    game.start(createCandidates(51)[0]!);
    for (let wave = 0; wave < 2; wave++) {
      for (const enemy of game.world.enemies) enemy.x = game.world.arenaMax + 6;
      step(game, 90);
    }
    expect(game.world.phase).toBe('sector-clear');
    game.nextSector();
    expect(game.world.sector).toBe(1);
    expect(game.world.arenaMin).toBe(17);
    expect(game.world.wave).toBe(1);
    expect(game.world.enemies.some((enemy) => enemy.alive)).toBe(true);
  });

  it('breaks the final boss armor and wins only on its ring-out', () => {
    const game = new GameEngine(8);
    game.start(createCandidates(8).find((candidate) => candidate.weapon === 'pile')!);
    for (let sector = 0; sector < 2; sector++) {
      for (let wave = 0; wave < 2; wave++) {
        for (const enemy of game.world.enemies) enemy.x = game.world.arenaMax + 6;
        step(game, 90);
      }
      game.nextSector();
    }
    for (const enemy of game.world.enemies) enemy.x = game.world.arenaMax + 6;
    step(game, 90);
    const boss = game.world.enemies.find((enemy) => enemy.kind === 'boss')!;
    expect(boss).toBeDefined();
    expect(boss.armor).toBeGreaterThan(0);
    game.world.mode = 'training'; // Isolate armor/launch mechanics from the boss AI.
    for (let attempt = 0; attempt < 3 && boss.armor > 0; attempt++) {
      game.world.player.x = 54; game.world.player.z = 0; game.world.player.y = 0;
      game.world.player.vx = 0; game.world.player.vy = 0;
      boss.x = 56; boss.z = 0; boss.y = 0; boss.vx = 0; boss.vy = 0;
      boss.invulnerable = 0;
      game.update(1 / 60, frame({ smash: true, smashHeld: true }));
      step(game, 53, { smashHeld: true });
      step(game, 60);
    }
    expect(boss.armor).toBe(0);
    expect(boss.alive).toBe(true);
    expect(game.world.phase).toBe('playing');
    boss.x = game.world.arenaMax + 6;
    game.update(1 / 60, frame());
    expect(game.world.phase).toBe('won');
  });

  it('freezes the simulation while paused and resumes a cleared gate correctly', () => {
    const game = training();
    game.update(1 / 60, frame({ pause: true }));
    const time = game.world.time;
    const x = game.world.player.x;
    step(game, 60, { moveX: 1 });
    expect(game.world.phase).toBe('paused');
    expect(game.world.time).toBe(time);
    expect(game.world.player.x).toBe(x);
    game.update(1 / 60, frame({ pause: true }));
    expect(game.world.phase).toBe('playing');
  });

  it('can complete the full campaign using only ordinary control inputs', () => {
    const game = new GameEngine(73);
    game.start(createCandidates(73).find((choice) => choice.weapon === 'pile')!);
    let lastAction = -99;
    let nextDodge = 0;
    // This player has no world writes, damage overrides, teleports or invincibility.
    // It aligns with lanes, charges smash attacks, jumps telegraphed attacks and
    // uses aerials/recovery. It exercises all gates and the final boss together.
    for (let tick = 0; tick < 60 * 180; tick++) {
      const w = game.world, p = w.player;
      if (w.phase === 'won' || w.phase === 'lost') break;
      const input = frame();
      if (w.phase === 'sector-clear') input.moveX = 1;
      else if (p.alive) {
        const targets = w.enemies.filter((enemy) => enemy.alive).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
        const target = targets[0];
        if (target) {
          const dx = target.x - p.x, dz = target.z - p.z;
          const outside = p.x < w.arenaMin || p.x > w.arenaMax;
          if (outside && p.y < 2 && w.specialCooldown <= 0) {
            input.moveZ = -1; input.moveX = Math.sign((w.arenaMin + w.arenaMax) / 2 - p.x); input.special = true;
          } else if (p.state === 'charge') input.smashHeld = (p.attack?.charge ?? 0) < 0.6;
          else if (p.state === 'hurt') input.moveX = Math.sign((w.arenaMin + w.arenaMax) / 2 - p.x);
          else {
            input.moveX = Math.abs(dx) > 2.1 ? Math.sign(dx) : 0;
            input.moveZ = Math.abs(dz) > 0.6 ? Math.sign(dz) : 0;
            const canAct = ['idle', 'run', 'jump', 'fall', 'wavedash'].includes(p.state);
            const threat = targets.find((enemy) => enemy.attack && enemy.telegraph > 0 && enemy.telegraph < 0.4 && Math.abs(enemy.x - p.x) < (enemy.kind === 'boss' ? 6 : 3) && Math.abs(enemy.z - p.z) < 2.7);
            if (canAct && threat && tick > nextDodge && p.y <= 0.1) {
              input.jump = true; input.jumpHeld = true; nextDodge = tick + 30;
            } else if (canAct && p.y > 0.1 && Math.hypot(dx, dz) < 2.5 && Math.abs(dz) < 1) {
              input.attack = true; input.moveX = Math.sign(dx); input.moveZ = 0; lastAction = tick;
            } else if (canAct && Math.abs(dx) < 2.4 && Math.abs(dz) < 0.8 && tick - lastAction > 10) {
              if (p.facing !== Math.sign(dx) && Math.abs(dx) > 0.2) input.moveX = Math.sign(dx);
              else {
                input.moveX = 0; input.moveZ = 0; input.smash = true; input.smashHeld = true; lastAction = tick;
              }
            } else if (canAct && Math.abs(dx) > 4 && Math.abs(dx) < 8 && Math.abs(dz) < 1 && w.specialCooldown <= 0 && w.loadout.special === 'pulse') {
              input.moveZ = 0; input.special = true; lastAction = tick;
            }
          }
        }
      }
      game.update(1 / 60, input);
    }
    expect(game.world.phase).toBe('won');
    expect(game.world.kills).toBe(18);
    expect(game.world.sector).toBe(2);
    expect(game.world.stocks).toBeGreaterThan(0);
  });
});

describe('enemy tactics', () => {
  it('introduces shield and rush specialists during the campaign', () => {
    const game = new GameEngine(73);
    game.start(createCandidates(73)[0]!);
    const kinds = new Set<string>();
    for (let sector = 0; sector < 3; sector++) {
      for (let wave = 0; wave < 2; wave++) {
        for (const enemy of game.world.enemies) { kinds.add(enemy.kind); enemy.x = game.world.arenaMax + 6; }
        step(game, 90);
      }
      game.nextSector();
    }
    expect(kinds.has('sentinel')).toBe(true);
    expect(kinds.has('charger')).toBe(true);
  });

  it('blocks frontal jabs with a shield but leaves the rear vulnerable', () => {
    const front = training(), rear = training();
    for (const game of [front, rear]) {
      const target = game.world.enemies[0]!;
      target.kind = 'sentinel'; target.guard = 40;
      target.facing = game === front ? -1 : 1;
      game.update(1 / 60, frame({ attack: true }));
      step(game, 10);
    }
    expect(front.world.enemies[0]!.damage).toBeLessThan(rear.world.enemies[0]!.damage * 0.3);
    expect(front.world.enemies[0]!.guard).toBeLessThan(40);
    expect(rear.world.enemies[0]!.guard).toBe(40);
  });

  it('breaks a shield with a charged smash and allows grabbing a guarding enemy', () => {
    const game = training(), target = game.world.enemies[0]!;
    target.kind = 'sentinel'; target.guard = 40; target.facing = -1;
    game.update(1 / 60, frame({ smash: true, smashHeld: true }));
    step(game, 45, { smashHeld: true });
    game.update(1 / 60, frame());
    step(game, 14);
    expect(target.guard).toBe(0);
    expect(target.damage).toBeGreaterThan(15);
    const grabGame = training();
    grabGame.world.enemies[0]!.kind = 'sentinel';
    grabGame.world.enemies[0]!.guard = 40;
    grabGame.update(1 / 60, frame({ grab: true }));
    expect(grabGame.world.enemies[0]!.state).toBe('grabbed');
  });

  it('locks the gunner aim during the warning, allowing a lane dodge', () => {
    const game = training(), enemy = game.world.enemies[0]!;
    game.world.enemies = [enemy]; game.world.mode = 'campaign';
    enemy.kind = 'gunner'; enemy.x = 5; enemy.z = 0;
    for (let i = 0; i < 180 && !enemy.attack; i++) step(game, 1);
    expect(enemy.attack?.name).toBe('PULSE SHOT');
    game.world.player.z = 3.5;
    for (let i = 0; i < 80 && !game.world.projectiles.length; i++) step(game, 1);
    expect(game.world.projectiles.length).toBeGreaterThan(0);
    expect(Math.abs(game.world.projectiles[0]!.vz)).toBeLessThan(0.2);
  });

  it('telegraphs a charge before rushing along a committed lane', () => {
    const game = training(), enemy = game.world.enemies[0]!;
    game.world.enemies = [enemy]; game.world.mode = 'campaign';
    enemy.kind = 'charger'; enemy.x = 5; enemy.z = 0;
    for (let i = 0; i < 180 && !enemy.attack; i++) step(game, 1);
    expect(enemy.attack?.name).toBe('RAIL CHARGE');
    expect(enemy.telegraph).toBeGreaterThan(0.8);
    const x = enemy.x;
    step(game, 18);
    expect(Math.abs(enemy.x - x)).toBeLessThan(0.2);
    game.world.player.z = 3.5;
    for (let i = 0; i < 50 && Math.abs(enemy.vx) < 8; i++) step(game, 1);
    expect(enemy.vx).toBeLessThan(-8);
    expect(Math.abs(enemy.vz)).toBeLessThan(0.1);
  });

  it('separates nearby allies instead of stacking on one position', () => {
    const game = training();
    game.world.mode = 'campaign';
    for (const enemy of game.world.enemies) { enemy.x = 5; enemy.z = 0; enemy.kind = 'scout'; }
    step(game, 30);
    const lanes = game.world.enemies.map((enemy) => enemy.z);
    expect(Math.max(...lanes) - Math.min(...lanes)).toBeGreaterThan(0.4);
  });
});

describe('interactive arena', () => {
  it('uses intact equipment as cover against projectiles', () => {
    const game = training();
    const crate = game.world.props.find((prop) => prop.kind === 'crate')!;
    const gunner = game.world.enemies[0]!;
    game.world.enemies = [gunner]; game.world.mode = 'campaign';
    gunner.kind = 'gunner'; gunner.x = crate.x + 4; gunner.z = crate.z;
    game.world.player.x = crate.x - 2; game.world.player.z = crate.z;
    step(game, 160);
    expect(crate.hp).toBeLessThan(12);
    expect(game.world.player.damage).toBe(0);
  });

  it('lets a jumper clear equipment while grounded movement is blocked', () => {
    const game = training();
    const crate = game.world.props.find((prop) => prop.kind === 'crate')!;
    const player = game.world.player;
    player.x = crate.x - 1.5; player.z = crate.z;
    step(game, 25, { moveX: 1 });
    expect(player.x).toBeLessThan(crate.x - crate.width / 2);
    player.y = 3; player.vy = 2;
    step(game, 24, { moveX: 1 });
    expect(player.x).toBeGreaterThan(crate.x + crate.width / 2);
  });

  it('damages a repair crate once per swing and drops one collectible repair', () => {
    const game = training();
    expect(game.world.props).toBeDefined();
    const crate = game.world.props.find((prop) => prop.kind === 'crate')!;
    expect(crate).toBeDefined();
    game.world.enemies.forEach((enemy) => { enemy.z = -3.8; });
    game.world.player.x = crate.x - 1.3; game.world.player.z = crate.z;
    const hp = crate.hp;
    game.update(1 / 60, frame({ attack: true })); step(game, 25);
    expect(crate.hp).toBeCloseTo(hp - 5 * game.world.loadout.power);
    game.update(1 / 60, frame({ smash: true })); step(game, 45);
    expect(crate.alive).toBe(false);
    const repair = game.world.props.find((prop) => prop.kind === 'repair')!;
    expect(repair).toBeDefined();
    game.world.player.damage = 50; game.world.player.x = repair.x; game.world.player.z = repair.z;
    step(game, 1);
    expect(game.world.player.damage).toBe(25);
    step(game, 5);
    expect(game.world.player.damage).toBe(25);
  });

  it('detonates barrels once and damages nearby fighters on both teams', () => {
    const game = training();
    expect(game.world.props).toBeDefined();
    const barrel = game.world.props.find((prop) => prop.kind === 'barrel')!;
    const p = game.world.player, enemy = game.world.enemies[0]!;
    p.x = barrel.x - 1.5; p.z = barrel.z;
    enemy.x = barrel.x + 1; enemy.z = barrel.z + 1.9;
    game.update(1 / 60, frame({ smash: true })); step(game, 25);
    expect(barrel.alive).toBe(false);
    expect(p.damage).toBeGreaterThan(0);
    expect(enemy.damage).toBeGreaterThan(0);
  });

  it('warns before a vent erupts, and jumping avoids floor damage', () => {
    const game = training();
    expect(game.world.props).toBeDefined();
    const vent = game.world.props.find((prop) => prop.kind === 'vent')!;
    game.world.mode = 'campaign';
    game.world.enemies.forEach((enemy) => { enemy.x = 9; enemy.z = -3.8; });
    const p = game.world.player;
    p.x = vent.x; p.z = vent.z; p.invulnerable = 0;
    for (let i = 0; i < 600 && vent.phase !== 'warning'; i++) step(game, 1);
    expect(vent.phase).toBe('warning');
    expect(p.damage).toBe(0);
    for (let i = 0; i < 120 && vent.phase !== 'active'; i++) step(game, 1);
    expect(vent.phase).toBe('active');
    expect(p.damage).toBeGreaterThan(0);
    const air = training();
    const airVent = air.world.props.find((prop) => prop.kind === 'vent')!;
    air.world.mode = 'campaign';
    air.world.player.x = airVent.x; air.world.player.z = airVent.z;
    for (let i = 0; i < 600; i++) {
      air.world.player.y = 2; air.world.player.vy = 0;
      step(air, 1);
      if (airVent.phase === 'active') break;
    }
    expect(airVent.phase).toBe('active');
    expect(air.world.player.damage).toBe(0);
  });

  it('uses a distinct transit layout with conveyors that only carry grounded fighters', () => {
    const game = training();
    expect(game.world.props).toBeDefined();
    const oldIds = game.world.props.map((prop) => prop.id);
    game.world.phase = 'sector-clear'; game.nextSector();
    const belt = game.world.props.find((prop) => prop.kind === 'conveyor')!;
    expect(belt).toBeDefined();
    expect(game.world.props.every((prop) => !oldIds.includes(prop.id))).toBe(true);
    const p = game.world.player;
    p.x = belt.x; p.z = belt.z; p.y = 0;
    step(game, 30);
    expect(Math.abs(p.x - belt.x)).toBeGreaterThan(0.4);
    p.x = belt.x; p.y = 4; p.vx = 0; p.vy = 0;
    step(game, 10);
    expect(p.x).toBeCloseTo(belt.x);
  });

  it('keeps training vents harmless and restores props on restart', () => {
    const game = training();
    expect(game.world.props).toBeDefined();
    const vent = game.world.props.find((prop) => prop.kind === 'vent')!;
    game.world.player.x = vent.x; game.world.player.z = vent.z;
    step(game, 600);
    expect(game.world.player.damage).toBe(0);
    game.world.props[0]!.alive = false;
    game.restart();
    expect(game.world.props.every((prop) => prop.alive)).toBe(true);
  });
});
