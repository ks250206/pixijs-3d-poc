import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { createPattern } from '../src/game/patterns';
import { DEPTH_LIMIT, DODGE } from '../src/game/movement';
import { EMPTY_INPUT, type ActorKind, type InputFrame } from '../src/game/types';

const frame = (input: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...input });
const tick = (g: GameEngine, n = 1, input: Partial<InputFrame> = {}) => { for (let i = 0; i < n; i++) g.update(1 / 60, frame(input)); };

function lab() {
  const g = new GameEngine(41);
  g.start(createCandidates(41).find(l => l.weapon === 'arc')!, 'training');
  tick(g, 90);
  g.world.enemies = []; g.world.props = [];
  g.world.loadout.speed = 1;
  Object.assign(g.world.player, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, facing: 1, invulnerable: 0, state: 'idle' });
  return g;
}

interface Dash { state: string; frames: number; x: number[]; z: number[]; y: number[]; invulnerable: number }
/** Press Shift once with a direction (then neutral, or keep holding), and record every 60 Hz step. */
function dash(direction: Partial<InputFrame>, options: { air?: boolean; z?: number; hold?: boolean } = {}): Dash {
  const g = lab(), p = g.world.player;
  if (options.air) Object.assign(p, { y: 5, state: 'fall' });
  if (options.z !== undefined) p.z = options.z;
  const x = [p.x], z = [p.z], y = [p.y];
  let invulnerable = 0;
  g.update(1 / 60, frame({ dodge: true, ...direction }));
  const state = p.state;
  let frames = 1;
  x.push(p.x); z.push(p.z); y.push(p.y); invulnerable = Math.max(invulnerable, p.invulnerable);
  for (let i = 0; i < 90; i++) {
    g.update(1 / 60, options.hold ? frame(direction) : frame());
    if (p.state === state && frames === i + 1) frames++;
    x.push(p.x); z.push(p.z); y.push(p.y); invulnerable = Math.max(invulnerable, p.invulnerable);
    expect(Math.abs(p.z)).toBeLessThanOrEqual(DEPTH_LIMIT);
  }
  return { state, frames, x, z, y, invulnerable };
}
const step = (track: number[], i: number) => Math.abs(track[i + 1]! - track[i]!) * 60;
const peak = (track: number[], frames: number) => Math.max(...Array.from({ length: frames }, (_, i) => step(track, i)));
const travel = (track: number[], frames: number) => track[frames]! - track[0]!;

/** The dash this replaces: 8 (X) / 16/3 (Z) launched, then exp(−3.6·t) friction, 22 steps. */
const previous = (v0: number) => Array.from({ length: 22 }, (_, i) => v0 / 60 * Math.exp(-3.6 * i / 60)).reduce((a, b) => a + b, 0);
const PREVIOUS_X = previous(8), PREVIOUS_Z = previous(16 / 3);

/** Sustained run and dash-run speed (loadout speed 1), measured through ordinary input. */
function runSpeed(dashing: boolean) {
  const g = lab(), p = g.world.player;
  tick(g, 40, { moveX: 1, dash: dashing });
  const x = p.x; tick(g, 1, { moveX: 1, dash: dashing });
  return (p.x - x) * 60;
}

describe('ground dash: a fast burst', () => {
  const RUN = runSpeed(false), DASH_RUN = runSpeed(true);
  it('measures the run speeds it is compared with', () => {
    expect(RUN).toBeCloseTo(6.2, 6);
    expect(DASH_RUN).toBeCloseTo(10.4, 6);
    expect(PREVIOUS_X).toBeCloseTo(1.678, 3);
    expect(PREVIOUS_Z).toBeCloseTo(1.119, 3);
  });

  it.each([
    ['neutral (facing)', {}, 1, 0],
    ['forward', { moveX: 1 }, 1, 0],
    ['back', { moveX: -1 }, -1, 0],
    ['far lane (up)', { moveZ: -1 }, 0, -1],
    ['near lane (down)', { moveZ: 1 }, 0, 1],
    ['diagonal', { moveX: 1, moveZ: 1 }, Math.SQRT1_2, Math.SQRT1_2],
  ] as const)('%s: same duration, no invulnerability, front-loaded and faster than a dash-run', (_, input, ux, uz) => {
    const d = dash(input);
    expect(d.state).toBe('dodge');
    expect(d.frames).toBe(22); // DODGE.groundDuration 0.36 s, unchanged
    expect(DODGE.groundDuration).toBe(0.36);
    expect(d.invulnerable).toBe(0);
    for (const [track, unit, speed] of [[d.x, ux, DODGE.groundX], [d.z, uz, DODGE.groundZ]] as const) {
      const distance = travel(track, d.frames);
      if (unit === 0) { expect(distance).toBe(0); continue; }
      expect(Math.sign(distance)).toBe(Math.sign(unit));
      // The launch speed is the peak, and it is at least 1.4× a dash-run.
      expect(peak(track, d.frames)).toBeCloseTo(speed * Math.abs(unit), 6);
      expect(peak(track, d.frames) / Math.abs(unit)).toBeGreaterThanOrEqual(1.4 * DASH_RUN);
      // At least 80% of the dash is covered in the first 55% of it.
      const early = Math.round(d.frames * 0.55);
      expect(travel(track, early) / distance).toBeGreaterThanOrEqual(0.8);
      // It then settles: almost nothing is left over after the dash.
      expect(Math.abs(track.at(-1)! - track[d.frames]!)).toBeLessThan(0.02 * Math.abs(distance));
    }
  });

  it('keeps X travel within 10% of the previous dash and lengthens the lane dash about 1.7×', () => {
    for (const input of [{}, { moveX: 1 }, { moveX: -1 }]) {
      const d = dash(input);
      expect(Math.abs(travel(d.x, d.frames)) / PREVIOUS_X).toBeGreaterThan(0.9);
      expect(Math.abs(travel(d.x, d.frames)) / PREVIOUS_X).toBeLessThan(1.1);
    }
    for (const input of [{ moveZ: -1 }, { moveZ: 1 }]) {
      const d = dash(input);
      expect(Math.abs(travel(d.z, d.frames)) / PREVIOUS_Z).toBeGreaterThan(1.6);
      expect(Math.abs(travel(d.z, d.frames)) / PREVIOUS_Z).toBeLessThan(1.8);
    }
  });

  it('is faster than the fastest chassis can run or dash-run', () => {
    const fastest = Math.max(...createCandidates(41).map(l => l.speed), 1.15 * 1.2);
    expect(DODGE.groundX).toBeGreaterThan(10.4 * fastest);
    expect(DODGE.groundZ).toBeGreaterThan(10.4 * fastest);
  });

  it.each([1, -1])('stops exactly at the depth rail on side %i', side => {
    for (const start of [side * 3.3, side * DEPTH_LIMIT]) {
      const d = dash({ moveZ: side }, { z: start });
      expect(d.z.every(z => Math.abs(z) <= DEPTH_LIMIT)).toBe(true);
      expect(d.z[d.frames]).toBe(side * DEPTH_LIMIT);
    }
    const g = lab(), p = g.world.player;
    p.z = side * 3.3;
    tick(g, 1, { dodge: true, moveZ: side });
    tick(g, 3);
    expect(p.z).toBe(side * DEPTH_LIMIT);
    expect(p.vz).toBe(0);
  });

  it('is deterministic', () => {
    expect(dash({ moveX: 1, moveZ: -1 })).toEqual(dash({ moveX: 1, moveZ: -1 }));
  });
});

describe('air dash', () => {
  it.each([
    ['right', { moveX: 1 }, DODGE.air, 0],
    ['left', { moveX: -1 }, -DODGE.air, 0],
    ['up = far lane', { moveZ: -1 }, 0, -DODGE.airZ],
    ['down = near lane', { moveZ: 1 }, 0, DODGE.airZ],
    ['up-right', { moveX: 1, moveZ: -1 }, DODGE.air * Math.SQRT1_2, -DODGE.airZ * Math.SQRT1_2],
    ['down-left', { moveX: -1, moveZ: 1 }, -DODGE.air * Math.SQRT1_2, DODGE.airZ * Math.SQRT1_2],
    ['neutral', {}, 0, 0],
  ] as const)('%s: launches along X/Z, never vertically, with no invulnerability', (_, input, vx, vz) => {
    const d = dash(input, { air: true });
    expect(d.state).toBe('airdodge');
    expect(d.frames).toBe(20); // DODGE.airDuration 0.32 s, unchanged
    expect(d.invulnerable).toBe(0);
    expect((d.x[1]! - d.x[0]!) * 60).toBeCloseTo(vx, 6);
    expect((d.z[1]! - d.z[0]!) * 60).toBeCloseTo(vz, 6);
    // The brief hang: no gravity and no stick-driven rise or drop while it lasts.
    const hang = Math.floor(DODGE.airHang * 60);
    for (let i = 1; i <= hang; i++) expect(d.y[i]).toBe(5);
    expect(Math.max(...d.y)).toBe(5);
  });

  it('crosses lanes at least as fast and as far as the ground lane dash', () => {
    for (const side of [-1, 1]) {
      const air = dash({ moveZ: side }, { air: true }), ground = dash({ moveZ: side });
      expect(Math.abs(travel(air.z, air.frames))).toBeGreaterThanOrEqual(Math.abs(travel(ground.z, ground.frames)));
      expect(peak(air.z, air.frames)).toBeGreaterThanOrEqual(peak(ground.z, ground.frames));
      expect(Math.abs(travel(air.z, Math.round(air.frames * 0.55))) / Math.abs(travel(air.z, air.frames))).toBeGreaterThanOrEqual(0.8);
    }
  });

  it.each([1, -1])('respects the depth rail on side %i', side => {
    const d = dash({ moveZ: side }, { air: true, z: side * 3.5 });
    expect(d.z.every(z => Math.abs(z) <= DEPTH_LIMIT)).toBe(true);
    expect(d.z[d.frames]).toBe(side * DEPTH_LIMIT);
  });

  it('lands normally from a low air dash: no slide state, no extra speed', () => {
    for (const input of [{ moveX: 1, moveZ: 1 }, { moveX: 1 }, { moveZ: 1 }]) {
      const g = lab(), p = g.world.player;
      tick(g, 1, { jump: true, jumpHeld: true });
      tick(g, 3, { jumpHeld: true });
      tick(g, 1, { dodge: true, dodgeHeld: true, ...input });
      expect(g.world.lastMove).toBe('AIR DODGE');
      const events: string[] = [];
      let fastest = 0;
      for (let i = 0; i < 40 && p.y > 0; i++) { tick(g, 1, { dodgeHeld: true }); events.push(...g.world.events.map(e => e.type)); fastest = Math.max(fastest, Math.abs(p.vx)); }
      expect(p.y).toBe(0);
      expect(['idle', 'run', 'airdodge']).toContain(p.state);
      expect(g.world.lastMove).toBe('AIR DODGE');
      expect(fastest).toBeLessThanOrEqual(DODGE.air);
      tick(g, 30);
      events.push(...g.world.events.map(e => e.type));
      expect(events).not.toContain('wavedash');
      expect(p.state).toBe('idle');
      expect(p.vx).toBe(0);
      expect(p.vz).toBe(0);
    }
  });

  it('is no longer a vertical recovery: up input does not gain height', () => {
    const g = lab(), p = g.world.player;
    Object.assign(p, { y: 2, vy: -4, state: 'fall' });
    tick(g, 1, { dodge: true, moveZ: -1 });
    let highest = p.y;
    for (let i = 0; i < 30; i++) { tick(g); highest = Math.max(highest, p.y); }
    expect(highest).toBeLessThanOrEqual(2);
  });
});

/** An enemy begins its attack on a player standing at the arena centre. */
function telegraphed(kind: ActorKind, dx: number) {
  const g = new GameEngine(73);
  g.start(createCandidates(73).find(c => c.weapon === 'arc')!);
  g.world.mode = 'training';
  tick(g, 150);
  const enemy = g.world.enemies[0]!;
  g.world.enemies = [enemy]; g.world.props = []; g.world.hazards = [];
  const cx = (g.world.arenaMin + g.world.arenaMax) / 2;
  Object.assign(enemy, { kind, x: cx + dx, z: 0, y: 0, vx: 0, vz: 0, invulnerable: 0, armor: 0, guard: 0, mount: 0, scale: kind === 'bruiser' ? 1.25 : 1 });
  Object.assign(g.world.player, { x: cx, z: 0, y: 0, vx: 0, vz: 0, facing: 1, invulnerable: 100, damage: 0 });
  g.world.mode = 'campaign';
  for (let i = 0; i < 400 && !enemy.attack; i++) { g.world.player.x = cx; g.world.player.z = 0; tick(g); }
  g.world.player.invulnerable = 0;
  expect(enemy.telegraph).toBeGreaterThan(0.9);
  return { g, enemy, p: g.world.player, startup: Math.round(enemy.attack!.activeStart * 60) };
}
/** Dodge `before` frames ahead of the first hit frame; true if the player got away untouched. */
function escapes(kind: ActorKind, dx: number, before: number, input: Partial<InputFrame>, hold = false) {
  const { g, p, startup } = telegraphed(kind, dx);
  tick(g, startup - before);
  tick(g, 1, { dodge: true, ...input });
  tick(g, 100, hold ? input : {});
  return p.damage === 0;
}

describe('a positional dodge escapes telegraphed attacks', () => {
  it.each([
    ['scout', 2, 'SERVO STRIKE'],
    ['sentinel', 2.4, 'SHIELD BASH'],
    ['bruiser', 2.6, 'HAMMER SLAM'],
    ['charger', 4.5, 'RAIL CHARGE'],
    ['gunner', 5, 'PULSE SHOT'],
  ] as const)('%s %s hits a player who stays put', (kind, dx, name) => {
    const { g, enemy, p } = telegraphed(kind, dx);
    expect(enemy.attack?.name).toBe(name);
    tick(g, 120);
    expect(p.damage).toBeGreaterThan(0);
  });

  // Enemy at +X, so back is −X. Frames are counted before the attack's first hit frame.
  it.each([
    ['scout', 2, 10, 'back', { moveX: -1 }],
    ['scout', 2, 10, 'far lane', { moveZ: -1 }],
    ['scout', 2, 10, 'near lane', { moveZ: 1 }],
    ['sentinel', 2.4, 10, 'back', { moveX: -1 }],
    ['sentinel', 2.4, 10, 'far lane', { moveZ: -1 }],
    ['sentinel', 2.4, 10, 'near lane', { moveZ: 1 }],
    ['bruiser', 2.6, 14, 'back', { moveX: -1 }],
    ['charger', 4.5, 4, 'far lane', { moveZ: -1 }],
    ['charger', 4.5, 4, 'near lane', { moveZ: 1 }],
    ['gunner', 5, 4, 'far lane', { moveZ: -1 }],
    ['gunner', 5, 4, 'near lane', { moveZ: 1 }],
  ] as const)('%s: one tapped dash %i frames before the hit, %s', (kind, dx, before, _, input) => {
    expect(escapes(kind, dx, before, input)).toBe(true);
  });

  it('bruiser slam: its radius needs the lane dash followed by running on', () => {
    for (const side of [-1, 1]) expect(escapes('bruiser', 2.6, 30, { moveZ: side }, true)).toBe(true);
  });

  it('dodging into an attack is hit: there are no invulnerability frames', () => {
    const { g, p, startup } = telegraphed('scout', 2);
    tick(g, startup - 4);
    tick(g, 1, { dodge: true, moveX: 1 });
    expect(p.state).toBe('dodge');
    expect(p.invulnerable).toBe(0);
    tick(g, 30);
    expect(p.damage).toBeGreaterThan(0);
  });

  it('a lane dash leaves a telegraphed floor lane; staying or picking the wrong lane is hit', () => {
    const run = (input: Partial<InputFrame> | null) => {
      const g = lab(), p = g.world.player;
      // Hazards belong to a living owner; a training enemy never attacks.
      const owner = new GameEngine(41);
      owner.start(createCandidates(41)[0]!, 'training');
      const keeper = owner.world.enemies[0]!;
      Object.assign(keeper, { x: g.world.arenaMax - 1, z: 0, y: 0 });
      g.world.enemies = [keeper];
      // Lanes at z = −3, 0, +3 (depth 2.2); variant 0 leaves the far lane safe.
      g.world.hazards = createPattern('lanes', 'test', keeper.id, g.world.arenaMin, g.world.arenaMax, p, 0);
      const fires = Math.ceil(g.world.hazards[0]!.delay * 60);
      tick(g, fires - 8);
      if (input) tick(g, 1, { dodge: true, ...input });
      tick(g, 40);
      return p.damage;
    };
    expect(run(null)).toBeGreaterThan(0);
    expect(run({ moveZ: -1 })).toBe(0);
    expect(run({ moveZ: 1 })).toBeGreaterThan(0);
  });
});
