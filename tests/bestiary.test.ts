import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { BESTIARY, MIRROR_PHASE_ARMOR, MIRROR_SHIFT_TIME, isBossKind } from '../src/game/bestiary';
import { STAGES, TRAINING_WAVES } from '../src/game/campaign';
import { bodyHurtbox } from '../src/game/combat/geometry';
import { createRun, encounterRoster } from '../src/game/roguelite/map';
import { EMPTY_INPUT, ENEMY_NAMES, type Actor, type ActorKind, type AttackKind, type WeaponId } from '../src/game/types';

interface Internals {
  spawnEnemy(kind: ActorKind, x: number, z: number): void;
  hit(target: Actor, source: Actor, damage: number, force: number, growth: number, angle: number, facing: 1 | -1, kind: AttackKind): boolean;
  enemyCanAttack(enemy: Actor): boolean;
}
const internals = (g: GameEngine) => g as unknown as Internals;
const tick = (g: GameEngine, n = 1) => { for (let i = 0; i < n; i++) g.update(1 / 60, EMPTY_INPUT); };
/** Advances until `done`, at most `seconds`; true when it happened. */
const until = (g: GameEngine, seconds: number, done: () => boolean) => {
  for (let i = 0; i < seconds * 60; i++) { if (done()) return true; tick(g); }
  return done();
};
/** A clear arena with live AI, an idle player at the origin and the given enemies six metres away. */
function lab(kinds: ActorKind[], weapon: WeaponId = 'arc') {
  const g = new GameEngine(73);
  g.start({ ...createCandidates(73)[0]!, weapon, power: 1 }, 'training');
  tick(g, 120);
  g.world.props = []; g.world.enemies = [];
  kinds.forEach((kind, i) => internals(g).spawnEnemy(kind, 6 + i * 3, 0));
  Object.assign(g.world.player, { x: 0, z: 0 });
  g.world.mode = 'campaign';
  return g;
}
const NEW_KINDS: ActorKind[] = ['hound', 'gunhound', 'roller', 'mauler', 'jester', 'talon', 'mirror', 'gargoyle'];

describe('bestiary data', () => {
  it('names, sizes and places every new enemy', () => {
    const campaign = new Set(STAGES.flatMap((stage) => stage.waves.flatMap((wave) => wave.enemies)));
    const training = new Set(TRAINING_WAVES.flat());
    for (const kind of NEW_KINDS) {
      expect(ENEMY_NAMES[kind].length).toBeGreaterThan(0);
      expect(BESTIARY[kind]).toBeDefined();
      expect(campaign.has(kind), kind).toBe(true);
      expect(training.has(kind), kind).toBe(true);
      expect(lab([kind]).world.enemies[0]!.scale).toBe(BESTIARY[kind]!.scale);
    }
    expect(BESTIARY.mauler!.scale).toBeGreaterThan(1.5);
    expect(BESTIARY.mauler!.speed).toBeLessThan(2);
    expect(BESTIARY.gargoyle!.scale).toBeGreaterThan(2);
  });

  it('ends the hive stage on the mirror and the siege stage on the gargoyle pair', () => {
    expect(STAGES.find((stage) => stage.theme === 'hive')!.waves.at(-1)!.enemies).toEqual(['mirror']);
    expect(STAGES.find((stage) => stage.theme === 'gauntlet')!.waves.at(-1)!.enemies).toEqual(['gargoyle', 'gargoyle']);
  });

  it('keeps bosses out of random encounters and seeds the roguelite gatekeepers', () => {
    const openers = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const run = createRun(seed, createCandidates(seed)[0]!);
      for (const node of run.map) {
        const roster = encounterRoster(run, node);
        if (node.kind !== 'boss') expect(roster.some(isBossKind), `${seed}:${node.id}`).toBe(false);
        else if (node.act === 1) openers.add(roster.join('+'));
        else if (node.act === 2) expect(roster).toEqual(['gargoyle', 'gargoyle']);
        else expect(roster).toEqual(['boss']);
      }
    }
    expect([...openers].sort()).toEqual(['mirror', 'warden+scout']);
  });

  it('gives low machines low hurtboxes', () => {
    const height = (kind: ActorKind) => { const box = bodyHurtbox({ x: 0, y: 0, z: 0, scale: 1, kind }); return box.max.y - box.min.y; };
    expect(height('hound')).toBeLessThan(height('scout') * 0.7);
    expect(height('roller')).toBeLessThan(height('scout'));
  });
});

describe('hounds', () => {
  it('pounces down the lane and bites', () => {
    const g = lab(['hound']), hound = g.world.enemies[0]!;
    expect(until(g, 8, () => hound.attack?.move?.id === 'hound.pounce')).toBe(true);
    const from = hound.x;
    expect(until(g, 2, () => hound.state !== 'attack')).toBe(true);
    expect(g.world.player.damage).toBeCloseTo(6);
    expect(Math.abs(hound.x - from)).toBeGreaterThan(1.5);
  });

  it('fires the back gun in three-round bursts', () => {
    const g = lab(['gunhound']), dog = g.world.enemies[0]!;
    g.world.player.invulnerable = 100;
    expect(until(g, 8, () => dog.attack?.move?.id === 'gunhound.burst')).toBe(true);
    const shots = new Set<string>();
    until(g, 2, () => { for (const shot of g.world.projectiles) if (shot.ownerId === dog.id) shots.add(shot.id); return dog.state !== 'attack'; });
    expect(shots.size).toBe(3);
  });
});

describe('roller', () => {
  it('rolls in, unfolds to fire and folds up again when crowded', () => {
    const g = lab(['roller']), roller = g.world.enemies[0]!;
    g.world.player.invulnerable = 100;
    expect(roller.form).toBe('rolling');
    expect(internals(g).enemyCanAttack(roller)).toBe(false);
    expect(until(g, 4, () => roller.form === 'deployed')).toBe(true);
    const x = roller.x;
    expect(until(g, 3, () => g.world.projectiles.some((shot) => shot.ownerId === roller.id))).toBe(true);
    expect(roller.x).toBe(x);
    // Unfolded it holds its ground even when crowded — that is the opening — and only packs up on its timer.
    Object.assign(g.world.player, { x: roller.x - 1.2, z: roller.z });
    tick(g, 60);
    expect(roller.form).toBe('deployed');
    expect(roller.x).toBe(x);
    expect(until(g, 6, () => roller.form === 'rolling')).toBe(true);
  });

  it('cannot kite forever: its roll runs out and it unfolds wherever it is', () => {
    const g = lab(['roller']), roller = g.world.enemies[0]!, p = g.world.player;
    p.invulnerable = 1000;
    let deployed = 0;
    // Chase it relentlessly; it still has to stop and stand.
    until(g, 40, () => { p.x = roller.x - 2; p.z = roller.z; if (roller.form === 'deployed') deployed++; return false; });
    expect(deployed).toBeGreaterThan(120);
  });

  it('is harder to launch while it stands deployed', () => {
    const launch = (form: 'rolling' | 'deployed') => {
      const g = lab(['roller']), roller = g.world.enemies[0]!;
      g.world.mode = 'training';
      Object.assign(roller, { form, invulnerable: 0 });
      internals(g).hit(roller, g.world.player, 10, 10, 0.1, 0.5, 1, 'tilt');
      return roller.vx;
    };
    expect(launch('deployed')).toBeLessThan(launch('rolling') * 0.7);
  });
});

describe('mauler', () => {
  it('hits harder than any other regular enemy, after a long wind-up', () => {
    const g = lab(['mauler']), mauler = g.world.enemies[0]!;
    expect(until(g, 12, () => !!mauler.attack)).toBe(true);
    expect(mauler.attack!.activeStart).toBeGreaterThanOrEqual(0.9);
    expect(until(g, 3, () => g.world.player.damage > 0)).toBe(true);
    expect(g.world.player.damage).toBeGreaterThanOrEqual(26);
  });

  it('shrugs off a jab mid-swing but is stopped by a smash', () => {
    const g = lab(['mauler']), mauler = g.world.enemies[0]!;
    g.world.player.invulnerable = 100;
    expect(until(g, 12, () => !!mauler.attack)).toBe(true);
    mauler.invulnerable = 0;
    internals(g).hit(mauler, g.world.player, 5, 6, 0.1, 0.5, 1, 'jab');
    expect(mauler.state).toBe('attack');
    expect(mauler.damage).toBeGreaterThan(0);
    mauler.invulnerable = 0;
    internals(g).hit(mauler, g.world.player, 18, 10, 0.15, 0.5, 1, 'smash');
    expect(mauler.state).toBe('hurt');
    expect(mauler.attack).toBeNull();
  });
});

describe('jester', () => {
  it('feints, then reappears behind its target to strike', () => {
    const g = lab(['jester']), jester = g.world.enemies[0]!, p = g.world.player;
    p.invulnerable = 100;
    expect(until(g, 60, () => jester.attack?.move?.id === 'jester.feint')).toBe(true);
    expect(until(g, 2, () => jester.attack?.move?.id === 'jester.backstab')).toBe(true);
    expect((jester.x - p.x) * p.facing).toBeLessThan(0);
    expect(Math.abs(jester.x - p.x)).toBeLessThan(2);
    expect(jester.facing).toBe(p.x >= jester.x ? 1 : -1);
  });

  it('never settles into one spot', () => {
    const g = lab(['jester']), jester = g.world.enemies[0]!;
    g.world.player.invulnerable = 100;
    const lanes = new Set<number>(); let hops = 0, airborne = false;
    until(g, 20, () => { lanes.add(Math.round(jester.z)); if (jester.y > 0.3 && !airborne) hops++; airborne = jester.y > 0.3; return false; });
    expect(lanes.size).toBeGreaterThanOrEqual(4);
    expect(hops).toBeGreaterThan(0);
  });
});

describe('talon', () => {
  it('stoops into a chained flurry for heavy total damage, then is left spent near the floor', () => {
    const g = lab(['talon']), talon = g.world.enemies[0]!, p = g.world.player;
    expect(talon.y).toBeCloseTo(BESTIARY.talon!.hover!);
    expect(until(g, 8, () => talon.attack?.move?.id === 'talon.dive')).toBe(true);
    let hits = 0, last = 0;
    expect(until(g, 6, () => { if (p.damage > last) hits++; last = p.damage; return talon.form === 'spent'; })).toBe(true);
    // The stoop, three pecks and the rending kick, all chained off one opening.
    expect(hits).toBe(5);
    expect(p.damage).toBeGreaterThanOrEqual(30);
    expect(internals(g).enemyCanAttack(talon)).toBe(false);
    expect(until(g, 1.5, () => talon.y < 1)).toBe(true);
    // Rested, it climbs back to its hunting height.
    expect(until(g, 4, () => talon.form === 'default' && talon.y > 2)).toBe(true);
  });

  it('gets no flurry from a stoop that misses', () => {
    const g = lab(['talon']), talon = g.world.enemies[0]!, p = g.world.player;
    p.invulnerable = 100;
    expect(until(g, 8, () => talon.attack?.move?.id === 'talon.dive')).toBe(true);
    const moves = new Set<string>();
    expect(until(g, 3, () => { if (talon.attack?.move) moves.add(talon.attack.move.id); return talon.form === 'spent'; })).toBe(true);
    expect([...moves]).toEqual(['talon.dive']);
  });

  it('breaks off the flurry as soon as a hit fails to connect', () => {
    const g = lab(['talon']), talon = g.world.enemies[0]!, p = g.world.player;
    expect(until(g, 8, () => talon.attack?.move?.id === 'talon.dive')).toBe(true);
    expect(until(g, 3, () => talon.attack?.move?.id === 'talon.peck')).toBe(true);
    // Dodged out of reach after the first peck began.
    p.x = talon.x + 9; p.invulnerable = 100;
    const damage = p.damage;
    expect(until(g, 1, () => talon.form === 'spent')).toBe(true);
    expect(p.damage).toBe(damage);
  });
});

describe('mirror midboss', () => {
  it.each(['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'] as const)('fights with the run\'s own %s', (weapon) => {
    const g = lab(['mirror'], weapon), mirror = g.world.enemies[0]!;
    g.world.player.invulnerable = 100;
    expect(until(g, 10, () => !!mirror.attack?.move)).toBe(true);
    expect(mirror.attack!.move!.pose).toBe(weapon);
    expect(mirror.attack!.move!.id.startsWith(`mirror.${weapon}.`)).toBe(true);
    // Telegraphed: slower to start than the player's own version of the move.
    expect(mirror.attack!.activeStart).toBeGreaterThan(0.25);
  });

  it('cannot be launched or grabbed for two modes, wipes its damage entering mode 2, then can be thrown out', () => {
    const g = lab(['mirror']), mirror = g.world.enemies[0]!, p = g.world.player;
    p.invulnerable = 1000;
    const chip = (kind: AttackKind = 'tilt') => { mirror.invulnerable = 0; internals(g).hit(mirror, p, 10, 12, 0.2, 0.5, 1, kind); };
    expect(mirror.bossPhase).toBe('armored');
    expect(mirror.armor).toBe(MIRROR_PHASE_ARMOR);
    for (const mode of [1, 2]) {
      while (mirror.armor > 9) {
        chip();
        expect(mirror.vx).toBe(0);
        expect(mirror.vy).toBe(0);
        tick(g, 20);
      }
      const carried = mirror.damage;
      expect(carried).toBeGreaterThan(30);
      // The grab only takes unarmored targets.
      Object.assign(p, { x: mirror.x - 1, z: mirror.z, facing: 1 });
      g.update(1 / 60, { ...EMPTY_INPUT, grab: true });
      expect(p.state).not.toBe('grab');
      tick(g, 30);
      chip();
      expect(mirror.bossPhase).toBe('transition');
      expect(mirror.phaseChanges).toBe(mode);
      // Mode 2 starts clean; what it takes there is carried into the launchable mode 3.
      if (mode === 1) expect(mirror.damage).toBe(0);
      else expect(mirror.damage).toBeGreaterThan(carried);
      expect(mirror.invulnerable).toBeGreaterThan(MIRROR_SHIFT_TIME - 0.1);
      expect(mirror.alive).toBe(true);
      // Hitstop does not count toward the shift.
      expect(until(g, MIRROR_SHIFT_TIME + 0.5, () => mirror.bossPhase !== 'transition')).toBe(true);
      expect(mirror.bossPhase).toBe(mode === 1 ? 'armored' : 'overdrive');
      expect(mirror.armor).toBe(mode === 1 ? MIRROR_PHASE_ARMOR : 0);
    }
    chip();
    expect(mirror.vx).toBeGreaterThan(2);
    expect(mirror.state).toBe('hurt');
    expect(g.world.phase).toBe('playing');
  });

  it('adds dashes and specials in mode 2 and charged smashes in mode 3', () => {
    const g = lab(['mirror']), mirror = g.world.enemies[0]!, p = g.world.player;
    const seen: Set<string>[] = [new Set(), new Set(), new Set()];
    for (let i = 0; i < 60 * 75 && mirror.alive; i++) {
      p.invulnerable = 100;
      // Keep it on stage and step it through its modes on a timer.
      if (i % 1500 === 1499 && mirror.phaseChanges < 2) { mirror.armor = 1; mirror.invulnerable = 0; internals(g).hit(mirror, p, 5, 0, 0, 0, 1, 'tilt'); }
      if (i % 240 === 0) Object.assign(p, { x: mirror.x + (i % 480 ? 6 : 1.5) * (mirror.x > g.world.cameraX ? -1 : 1), z: mirror.z });
      tick(g);
      if (mirror.attack?.move) seen[mirror.phaseChanges]!.add(mirror.attack.move.kind);
    }
    expect([...seen[0]!].sort()).toEqual(['jab', 'tilt']);
    expect(seen[1]!.has('dash') || seen[1]!.has('special')).toBe(true);
    expect(seen[2]!.has('smash')).toBe(true);
    expect(mirror.alive).toBe(true);
  });
});

describe('twin gargoyles', () => {
  it('arrives as one on foot and one on the wing, breathing fire down the player\'s lane', () => {
    const g = lab(['gargoyle', 'gargoyle']), [ground, air] = g.world.enemies as [Actor, Actor];
    g.world.player.invulnerable = 100;
    expect(ground.form).toBe('default');
    expect(air.form).toBe('airborne');
    expect(air.y).toBeCloseTo(BESTIARY.gargoyle!.hover!);
    expect(ground.armor).toBe(BESTIARY.gargoyle!.armor);
    expect(until(g, 10, () => g.world.hazards.some((zone) => zone.pattern === 'breath' && zone.ownerId === air.id))).toBe(true);
    const breath = g.world.hazards.filter((zone) => zone.pattern === 'breath');
    expect(breath).toHaveLength(3);
    expect(breath.every((zone) => Math.abs(zone.z - g.world.player.z) < 0.01)).toBe(true);
    expect(air.y).toBeGreaterThan(2.5);
  });

  it('swaps roles when the flier dives', () => {
    const g = lab(['gargoyle', 'gargoyle']), [first, second] = g.world.enemies as [Actor, Actor];
    g.world.player.invulnerable = 100;
    expect(until(g, 40, () => second.attack?.move?.id === 'gargoyle.dive')).toBe(true);
    expect(second.form).toBe('default');
    expect(first.form).toBe('airborne');
    expect(until(g, 4, () => second.y === 0 && second.state !== 'attack')).toBe(true);
    expect(until(g, 6, () => first.y > 2.5)).toBe(true);
    expect(second.alive && first.alive).toBe(true);
  });

  it('enrages the survivor, which then works both air and ground alone', () => {
    const g = lab(['gargoyle', 'gargoyle']), [first, second] = g.world.enemies as [Actor, Actor];
    g.world.player.invulnerable = 1000;
    first.x = g.world.arenaMax + 6;
    tick(g, 2);
    expect(first.alive).toBe(false);
    expect(second.bossPhase).toBe('overdrive');
    expect(g.world.phase).toBe('playing');
    const forms = new Set<string>(), moves = new Set<string>();
    until(g, 60, () => { forms.add(second.form); if (second.attack?.move) moves.add(second.attack.move.id); return false; });
    expect(forms.has('airborne') && forms.has('default')).toBe(true);
    expect(moves.has('gargoyle.breath')).toBe(true);
    expect(moves.has('gargoyle.dive')).toBe(true);
    expect(moves.has('gargoyle.sweep') || moves.has('gargoyle.tail')).toBe(true);
  });

  it('drops out of the air when its armor shatters', () => {
    const g = lab(['gargoyle', 'gargoyle']), air = g.world.enemies[1]!;
    g.world.mode = 'training';
    Object.assign(air, { armor: 1, invulnerable: 0 });
    internals(g).hit(air, g.world.player, 12, 8, 0.1, 0.5, 1, 'smash');
    expect(air.armor).toBe(0);
    expect(air.form).toBe('default');
    tick(g, 90);
    expect(air.y).toBe(0);
  });
});
