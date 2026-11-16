import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { EMPTY_INPUT, type ActorKind, type InputFrame, type WeaponId } from '../src/game/types';
import { playerMove, activeEnd } from '../src/game/combat/moves';
import { bodyHurtbox, sampleWeapon, sweptContact } from '../src/game/combat/geometry';
import { ASSISTED_LANE_DEPTH, PLAYER_LANE_ASSIST, laneAssist } from '../src/game/combat/assist';
import { SAME_LANE_DISTANCE } from '../src/render/readability';

const WEAPONS: WeaponId[] = ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'];
const frame = (input: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...input });
const tick = (g: GameEngine, n = 1, input: Partial<InputFrame> = {}) => { for (let i = 0; i < n; i++) g.update(1 / 60, frame(input)); };

/**
 * Lane tolerance of a forward tilt against a scout, measured through this same ordinary input with
 * the assist set to 0 (largest hitting z on each side at 0.01 resolution; target at x = 1.4, the
 * scythe at 3.75 because its spin covers every lane close to the body), and X reach on the lane at
 * the same resolution — which the assist must not change. The cannon's bolt outranges the arena.
 */
const BEFORE: Record<WeaponId, { x: number; near: number; far: number; reach: number }> = {
  arc: { x: 1.4, near: 1.29, far: 1.29, reach: 3.54 },
  pile: { x: 1.4, near: 1.46, far: 1.46, reach: 3.3 },
  razor: { x: 1.4, near: 0.58, far: 0.58, reach: 2.87 },
  lance: { x: 1.4, near: 0.42, far: 0.42, reach: 5.27 },
  cannon: { x: 1.4, near: 0.71, far: 0.71, reach: Infinity },
  scythe: { x: 3.75, near: 1.63, far: 1.2, reach: 4.07 },
};

function lab(weapon: WeaponId) {
  const g = new GameEngine(41);
  g.start(createCandidates(41).find(l => l.weapon === weapon)!, 'training');
  tick(g, 90);
  g.world.props = [];
  g.world.enemies = g.world.enemies.slice(0, 1);
  g.world.loadout.modules.weapon = 'quick';
  Object.assign(g.world.player, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, facing: 1, invulnerable: 0, state: 'idle' });
  Object.assign(g.world.enemies[0]!, { kind: 'scout', scale: 1, x: 1.4, y: 0, z: 0, vx: 0, vy: 0, vz: 0, invulnerable: 0, armor: 0, guard: 0 });
  return g;
}
/** A forward tilt through ordinary input against a scout at (x, y, z); true if it took damage. */
function tiltHits(weapon: WeaponId, x: number, z: number, y = 0): boolean {
  const g = lab(weapon);
  Object.assign(g.world.enemies[0]!, { x, y, z });
  tick(g, 1, { attack: true, moveX: 1 });
  expect(g.world.player.attack?.kind).toBe('tilt');
  tick(g, 60);
  return g.world.enemies[0]!.damage > 0;
}
/** The same forward tilt as pure geometry over its whole hit window, with a chosen Z padding. */
function tiltGeometry(weapon: WeaponId, target: { x: number; y: number; z: number }, pad: number) {
  const g = lab(weapon), move = playerMove(g.world.loadout, 'tilt', 'forward', 0, 0);
  const box = laneAssist(bodyHurtbox({ ...target, scale: 1, kind: 'scout' }), pad);
  return sweptContact(g.world.player, move, move.frames.startup, activeEnd(move), box) !== null;
}

describe('player lane assist', () => {
  it('pads only Z, by one named constant, and the readability band is derived from it', () => {
    const box = bodyHurtbox({ x: 1, y: 0, z: 0.5, scale: 1, kind: 'scout' });
    const padded = laneAssist(box);
    expect(padded.min.x).toBe(box.min.x);
    expect(padded.max.x).toBe(box.max.x);
    expect(padded.min.y).toBe(box.min.y);
    expect(padded.max.y).toBe(box.max.y);
    expect(padded.min.z).toBeCloseTo(box.min.z - PLAYER_LANE_ASSIST, 12);
    expect(padded.max.z).toBeCloseTo(box.max.z + PLAYER_LANE_ASSIST, 12);
    expect(box.max.z).toBeCloseTo(0.78, 12); // input unchanged
    expect(PLAYER_LANE_ASSIST).toBe(0.45);
    expect(ASSISTED_LANE_DEPTH).toBeCloseTo(0.28 + PLAYER_LANE_ASSIST, 12);
    expect(SAME_LANE_DISTANCE).toBe(ASSISTED_LANE_DEPTH);
  });

  it.each(WEAPONS)('%s forward tilt connects at lane offsets 0, ±0.5 and ±0.8', weapon => {
    for (const z of [0, 0.5, -0.5, 0.8, -0.8]) expect(tiltHits(weapon, 1.4, z), `z=${z}`).toBe(true);
  });

  it.each(WEAPONS)('%s gains at most the lane assist: hits where it missed before, still misses beyond it', weapon => {
    const { x, near, far } = BEFORE[weapon];
    for (const [sign, lane] of [[1, near], [-1, far]] as const) {
      // Missed before the change (outside the measured tolerance), connects now.
      expect(tiltHits(weapon, x, sign * (lane + 0.3)), 'gained').toBe(true);
      // Bounded: past the old tolerance plus the assist is still a miss.
      expect(tiltHits(weapon, x, sign * (lane + PLAYER_LANE_ASSIST + 0.08)), 'bounded').toBe(false);
      if (weapon !== 'cannon') {
        // The geometry agrees: without the padding the same target is out of reach.
        expect(tiltGeometry(weapon, { x, y: 0, z: sign * (lane + 0.3) }, 0)).toBe(false);
        expect(tiltGeometry(weapon, { x, y: 0, z: sign * (lane + 0.3) }, PLAYER_LANE_ASSIST)).toBe(true);
      }
    }
  });

  it.each(['razor', 'lance', 'cannon'] as const)('%s still misses a clearly different lane (±1.8)', weapon => {
    expect(tiltHits(weapon, 1.4, 1.8)).toBe(false);
    expect(tiltHits(weapon, 1.4, -1.8)).toBe(false);
  });

  it.each(WEAPONS.filter(w => w !== 'cannon'))('%s keeps its X reach and never reaches above its capsule', weapon => {
    const { reach } = BEFORE[weapon];
    for (const z of [0, 0.5]) {
      expect(tiltHits(weapon, reach, z), `reach z=${z}`).toBe(true);
      expect(tiltHits(weapon, reach + 0.05, z), `beyond reach z=${z}`).toBe(false);
    }
    // Highest point of the live capsule over the hit window: a body above it is never hit,
    // on the lane or off it (Z padding adds no height).
    const g = lab(weapon), move = playerMove(g.world.loadout, 'tilt', 'forward', 0, 0);
    let top = -Infinity;
    for (let f = move.frames.startup; f <= activeEnd(move); f += 0.125) {
      const c = sampleWeapon(g.world.player, move, f);
      top = Math.max(top, c.a.y + c.radius, c.b.y + c.radius);
    }
    const above = top + 0.02 - 0.03; // body boxes start 0.03 above the feet
    for (const z of [0, 0.5, -0.5]) expect(tiltGeometry(weapon, { x: 1.4, y: above, z }, PLAYER_LANE_ASSIST), `z=${z}`).toBe(false);
    expect(tiltGeometry(weapon, { x: 1.4, y: above - 0.3, z: 0 }, PLAYER_LANE_ASSIST), 'just below').toBe(true);
  });

  it('player strikes damage a destructible prop beside the lane that they used to miss', () => {
    for (const [pad, z] of [[true, 0.95], [false, 0.95 + 0.55 + 0.6]] as const) {
      const g = lab('lance');
      g.world.enemies = [];
      g.world.props = [{ id: 'barrel-test', kind: 'barrel', x: 2, z, width: 1.1, depth: 1.1, height: 1.35, hp: 10, alive: true, phase: 'idle', timer: 0, direction: 1 }];
      const barrel = g.world.props[0]!;
      // Without the assist a narrow lance thrust is out of the crate's depth at this offset.
      const move = playerMove(g.world.loadout, 'tilt', 'forward', 0, 0);
      const box = { min: { x: 1.45, y: 0, z: z - 0.55 }, max: { x: 2.55, y: 1.35, z: z + 0.55 } };
      if (pad) expect(sweptContact(g.world.player, move, move.frames.startup, activeEnd(move), box)).toBeNull();
      tick(g, 1, { attack: true, moveX: 1 });
      tick(g, 60);
      expect(barrel.hp < 10, `barrel at z=${z}`).toBe(pad);
    }
  });

  it('player projectiles get the same Z forgiveness, bounded', () => {
    // Cannon bolt radius 0.22 against a scale-1 body: |Δz| < 0.5 + 0.22 before, + 0.45 now.
    for (const [z, hit] of [[0.9, true], [-1.1, true], [1.25, false], [-1.8, false]] as const) {
      const g = lab('cannon');
      Object.assign(g.world.enemies[0]!, { x: 3, z });
      tick(g, 1, { attack: true });
      tick(g, 60);
      expect(g.world.enemies[0]!.damage > 0, `z=${z}`).toBe(hit);
    }
  });
});

describe('enemy attacks are not assisted', () => {
  /** Scout servo strike begun against a stationary player; returns the live engine. */
  function scoutStrike(kind: ActorKind = 'scout') {
    const g = new GameEngine(73);
    g.start(createCandidates(73).find(c => c.weapon === 'arc')!);
    g.world.mode = 'training';
    tick(g, 150);
    const enemy = g.world.enemies[0]!;
    g.world.enemies = [enemy]; g.world.props = []; g.world.hazards = [];
    const cx = (g.world.arenaMin + g.world.arenaMax) / 2;
    Object.assign(enemy, { kind, x: cx + 2, z: 0, y: 0, vx: 0, vz: 0, invulnerable: 0, armor: 0, guard: 0, scale: 1 });
    Object.assign(g.world.player, { x: cx, z: 0, y: 0, vx: 0, vz: 0, facing: 1, invulnerable: 100 });
    g.world.mode = 'campaign';
    for (let i = 0; i < 400 && !enemy.attack; i++) { g.world.player.x = cx; g.world.player.z = 0; tick(g); }
    expect(enemy.attack?.name).toBe('SERVO STRIKE');
    return { g, enemy, p: g.world.player };
  }

  it.each([1, -1])('a scout strike that misses by lane offset (side %i) still misses the player', side => {
    const probe = scoutStrike(), move = probe.enemy.attack!.move!;
    const enemyPose = { x: probe.enemy.x, y: probe.enemy.y, z: probe.enemy.z, facing: probe.enemy.facing };
    const reaches = (z: number, pad: number) => sweptContact(enemyPose, move, move.frames.startup, activeEnd(move),
      laneAssist(bodyHurtbox({ ...probe.p, z }), pad)) !== null;
    let z = 0;
    while (reaches(side * z, 0)) z += 0.02;
    // An offset the strike misses as it is, but would hit if the player were lane-assisted.
    const offset = side * (z + 0.2);
    expect(reaches(offset, 0)).toBe(false);
    expect(reaches(offset, PLAYER_LANE_ASSIST)).toBe(true);
    const { g, p } = scoutStrike();
    p.z = offset; p.invulnerable = 0;
    tick(g, 60);
    expect(p.damage).toBe(0);
    // Control: inside the strike's real depth the same strike lands.
    const control = scoutStrike();
    control.p.z = side * Math.max(0, z - 0.2); control.p.invulnerable = 0;
    tick(control.g, 60);
    expect(control.p.damage).toBeGreaterThan(0);
  });
});
