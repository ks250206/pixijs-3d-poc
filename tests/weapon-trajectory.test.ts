import { describe, expect, it } from 'vite-plus/test';
import { sampleWeapon, segmentBox, sweptContact, type Capsule, type Hurtbox, type Vec3 } from '../src/game/combat/geometry';
import { activeEnd, playerMove, specialMove, totalFrames, utilityMove, type MoveDefinition } from '../src/game/combat/moves';
import { PIVOT_X, PIVOT_Y, WEAPON_REST } from '../src/game/combat/trajectory';
import type { Actor, AttackDirection, AttackKind, Loadout, SpecialId, WeaponId } from '../src/game/types';
import { rng } from './helpers/rig';

type Pos = Pick<Actor, 'x' | 'y' | 'z' | 'facing'>;
const WEAPONS: WeaponId[] = ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'];
const DIRECTIONS: AttackDirection[] = ['neutral', 'forward', 'back', 'up', 'down'];

// ---------------------------------------------------------------------------------------------
// Frozen oracle: `sampleWeapon` and `sweptContact` exactly as they were before the wind-up and
// follow-through existed (git show 8b06b41:src/game/combat/geometry.ts). Do not "fix" or tidy
// this code: it is the definition of the gameplay that must not change.
// ---------------------------------------------------------------------------------------------
const oClamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const oMix = (a: number, b: number, t: number) => a + (b - a) * t;
const oLerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({ x: oMix(a.x, b.x, t), y: oMix(a.y, b.y, t), z: oMix(a.z, b.z, t) });
const oActiveEnd = (m: MoveDefinition) => m.frames.startup + m.frames.active;

function originalSampleWeapon(actor: Pos, move: MoveDefinition, frame: number): Capsule {
  const { shape, frames, direction } = move;
  const t = oClamp((frame - frames.startup) / Math.max(1, frames.active), 0, 1);
  const startup = oClamp(frame / Math.max(1, frames.startup), 0, 1);
  const recovery = oClamp((frame - oActiveEnd(move)) / Math.max(1, frames.recovery), 0, 1);
  const extension =
    frame < frames.startup
      ? 0.5 + startup * 0.25
      : (0.75 + 0.25 * Math.sin(t * Math.PI)) * (1 - recovery * 0.45);
  const sign = direction === 'back' ? -1 : 1;
  let vx = sign,
    vy = 0,
    vz = 0;
  if (shape.trajectory === 'orbit' || shape.trajectory === 'burst') {
    const angle = -Math.PI / 2 + t * Math.PI * 2;
    vx = Math.cos(angle);
    vz = Math.sin(angle) * Math.min(1, shape.depth / shape.reach);
  } else if (shape.trajectory === 'slash') {
    const angle = -0.85 + t * 1.7;
    vx = Math.cos(angle) * sign;
    vz = Math.sin(angle) * Math.min(1, shape.depth / shape.reach);
    vy = move.pose === 'pile' ? 0.55 - t * 0.85 : Math.sin(t * Math.PI) * 0.15;
  }
  if (direction === 'up') {
    vx = sign * 0.24;
    vy = 0.97;
    vz = 0;
  }
  if (direction === 'down' && shape.trajectory !== 'burst' && shape.trajectory !== 'orbit') {
    vx = sign * (move.kind === 'aerial' ? 0.24 : 0.96);
    vy = move.kind === 'aerial' ? -0.97 : -0.28;
    vz = 0;
  }
  const origin = {
    x: actor.x + actor.facing * sign * 0.3,
    y: actor.y + (shape.trajectory === 'burst' ? Math.min(1, shape.height / 2) : 1.15),
    z: actor.z,
  };
  const reach = shape.reach * extension;
  return {
    a: origin,
    b: { x: origin.x + actor.facing * vx * reach, y: origin.y + vy * reach, z: origin.z + vz * reach },
    radius: shape.radius,
  };
}

/** The unchanged swept test, wired to the frozen sampler (segmentBox is unchanged and shared). */
function originalSweptContact(actor: Pos, move: MoveDefinition, from: number, to: number, box: Hurtbox, previous: Pos = actor, checkedPose?: Capsule): number | null {
  const low = Math.max(from, move.frames.startup),
    high = Math.min(to, oActiveEnd(move));
  if (move.frames.active <= 0 || move.behavior === 'none' || high < low || to < move.frames.startup || from >= oActiveEnd(move)) return null;
  const angularTravel = ((high - low) / Math.max(1, move.frames.active)) * move.shape.reach * Math.PI * 2;
  const actorTravel = Math.hypot(actor.x - previous.x, actor.y - previous.y, actor.z - previous.z);
  const count = Math.max(1, Math.ceil((high - low) * 2), Math.ceil((angularTravel + actorTravel) / Math.max(0.005, move.shape.radius / 3)));
  let last: Capsule | null = null;
  for (let i = 0; i <= count; i++) {
    const frame = oMix(low, high, i / count),
      alpha = to === from ? 1 : oClamp((frame - from) / (to - from), 0, 1);
    const position = { ...oLerp(previous, actor, alpha), facing: actor.facing };
    const c = checkedPose && Math.abs(frame - to) < 1e-8 ? checkedPose : originalSampleWeapon(position, move, frame),
      contact = segmentBox(c.a, c.b, box);
    if (contact.distance <= c.radius) return move.shape.tip && contact.t >= 0.76 ? 1.35 : 1;
    if (last)
      for (const endpoint of ['a', 'b'] as const)
        if (segmentBox(last[endpoint], c[endpoint], box).distance <= c.radius) return move.shape.tip && endpoint === 'b' ? 1.35 : 1;
    last = c;
  }
  return null;
} // prettier-ignore

// ---------------------------------------------------------------------------------------------
// Move catalogue: every move the game can build, plus enemy/utility variants.
// ---------------------------------------------------------------------------------------------
const loadout = (weapon: WeaponId, special: SpecialId, modules: Loadout['modules']): Loadout => ({
  id: 'test', name: 'TEST', subtitle: '', weapon, special, trait: 'stable', color: 0,
  power: 1, speed: 1, weight: 1, description: '', modules,
}); // prettier-ignore

interface Entry {
  label: string;
  move: MoveDefinition;
}

const PLAYER_KINDS: { kind: AttackKind; combo: number; charge: number }[] = [
  { kind: 'jab', combo: 0, charge: 0 },
  { kind: 'jab', combo: 1, charge: 0 },
  { kind: 'jab', combo: 2, charge: 0 },
  { kind: 'tilt', combo: 0, charge: 0 },
  { kind: 'smash', combo: 0, charge: 0 },
  { kind: 'smash', combo: 0, charge: 1 },
  { kind: 'dash', combo: 0, charge: 0 },
  { kind: 'aerial', combo: 0, charge: 0 },
];

function playerMoves(): Entry[] {
  const out: Entry[] = [];
  for (const weapon of WEAPONS)
    for (const module of ['quick', 'breaker'] as const)
      for (const { kind, combo, charge } of PLAYER_KINDS)
        for (const direction of DIRECTIONS) {
          const l = loadout(weapon, 'pulse', { weapon: module, neutral: 'focused', side: 'cross', down: 'launch' });
          out.push({ label: `${weapon}/${module} ${kind}${combo} c${charge} ${direction}`, move: playerMove(l, kind, direction, combo, charge) });
        }
  return out;
}

function specialMoves(): Entry[] {
  const out = new Map<string, Entry>();
  for (const weapon of WEAPONS)
    for (const special of ['pulse', 'blink', 'vortex'] as const)
      for (const neutral of ['focused', 'split'] as const)
        for (const side of ['cross', 'push'] as const)
          for (const down of ['launch', 'stagger'] as const)
            for (const direction of DIRECTIONS) {
              const move = specialMove(loadout(weapon, special, { weapon: 'quick', neutral, side, down }), direction);
              const key = JSON.stringify(move);
              if (!out.has(key)) out.set(key, { label: `${weapon} special ${special}/${neutral}/${side}/${down} ${direction} (${move.id})`, move });
            }
  return [...out.values()];
}

function utilityMoves(): Entry[] {
  const out: Entry[] = [];
  const add = (label: string, move: MoveDefinition) => out.push({ label, move });
  // As the engine builds enemy strikes: startup/end in seconds × 60.
  add('enemy.strike default', utilityMove('enemy.strike', 'STRIKE', 'enemy', 'forward', 0.6, 2.2, { startup: 0.2 * 60, end: 0.35 * 60 }));
  add('enemy.strike pile', utilityMove('enemy.strike', 'SLAM', 'enemy', 'forward', 0.9, 2.6, { pose: 'pile', startup: 0.4 * 60, end: 0.55 * 60 }));
  add('enemy radial', utilityMove('enemy.radial', 'BURST', 'enemy', 'neutral', 0.8, 3, { radial: true, startup: 20, end: 32, height: 2.6, depth: 2.4 }));
  add('enemy short', utilityMove('enemy.short', 'POKE', 'enemy', 'forward', 0.3, 1.6, { startup: 4, end: 8 }));
  add('enemy long', utilityMove('enemy.long', 'SWEEP', 'enemy', 'forward', 1.4, 3.4, { startup: 30, end: 52, depth: 2 }));
  add('enemy instant', utilityMove('enemy.instant', 'SNAP', 'enemy', 'forward', 0.4, 2, { startup: 0, end: 6 }));
  add('enemy no recovery', utilityMove('enemy.flush', 'FLUSH', 'enemy', 'forward', 0.4, 2, { startup: 10, end: 24 }));
  add('throw', utilityMove('throw.forward', 'FORWARD THROW', 'throw', 'forward', 0.32, 2, { behavior: 'none', startup: 0, end: 0 }));
  for (const direction of DIRECTIONS) {
    add(`enemy slash ${direction}`, utilityMove(`enemy.${direction}`, 'X', 'enemy', direction, 0.6, 2.2, { startup: 12, end: 21 }));
    add(`enemy radial ${direction}`, utilityMove(`enemy.r.${direction}`, 'X', 'enemy', direction, 0.6, 2.2, { startup: 12, end: 21, radial: true }));
    add(`enemy aerial ${direction}`, utilityMove(`enemy.a.${direction}`, 'X', 'aerial', direction, 0.5, 2, { startup: 8, end: 16, pose: 'pile' }));
  }
  return out;
}

/** Arbitrary well-formed moves, so the golden check is not limited to today's tuning tables. */
function randomMoves(count: number): Entry[] {
  const r = rng(20261116);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r.next() * xs.length)]!;
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    const startup = Math.floor(r.range(0, 24)),
      active = Math.floor(r.range(0, 14)),
      recovery = Math.floor(r.range(0, 30));
    const base = utilityMove(`random.${i}`, 'R', 'enemy', 'forward', 1, 1);
    out.push({
      label: `random #${i}`,
      move: {
        ...base,
        kind: pick(['jab', 'tilt', 'smash', 'dash', 'aerial', 'special', 'enemy'] as const),
        direction: pick(DIRECTIONS),
        pose: pick(WEAPONS),
        combo: Math.floor(r.range(0, 3)),
        frames: { startup, active, recovery },
        shape: { trajectory: pick(['slash', 'thrust', 'orbit', 'burst'] as const), reach: r.range(0.4, 12), radius: r.range(0.1, 0.6), tip: r.chance(0.3), height: r.range(1, 4), depth: r.range(0.8, 5) },
      },
    }); // prettier-ignore
  }
  return out;
}

const PLAYER = playerMoves();
const SPECIAL = specialMoves();
const UTILITY = utilityMoves();
const CATALOGUE = [...PLAYER, ...SPECIAL, ...UTILITY];
const ACTORS = (facing: 1 | -1): Pos[] => [
  { x: 3.7, y: 0.45, z: -1.2, facing },
  { x: -12.25, y: 0, z: 0.8, facing },
];
const ORIGIN = { x: 0, y: 0, z: 0, facing: 1 as const };

const coords = (c: Capsule) => [c.a.x, c.a.y, c.a.z, c.b.x, c.b.y, c.b.z, c.radius];
const COORD_NAMES = ['a.x', 'a.y', 'a.z', 'b.x', 'b.y', 'b.z', 'radius'];
/** Names of the coordinates that differ in any bit (Object.is, so -0 ≠ 0 and NaN = NaN). */
function bitDiff(actual: Capsule, expected: Capsule): string[] {
  const x = coords(actual),
    y = coords(expected);
  return COORD_NAMES.flatMap((name, i) => (Object.is(x[i], y[i]) ? [] : [`${name}: ${x[i]} vs ${y[i]}`]));
}
const capsuleGap = (p: Capsule, q: Capsule) => Math.max(...coords(p).map((v, i) => Math.abs(v - coords(q)[i]!)));

/** Hit-window frames: every integer, an even subdivision, the exact edges, and edge-hugging values. */
function windowFrames(move: MoveDefinition, r: ReturnType<typeof rng>): number[] {
  const { startup, active } = move.frames;
  const end = activeEnd(move);
  const out = new Set<number>([startup, end, startup + 1e-9, Math.max(startup, end - 1e-9)]);
  for (let f = startup; f <= end; f++) out.add(f);
  for (let k = 0; k <= 7; k++) out.add(startup + (active * k) / 7);
  // Frames as the engine produces them: accumulated 1/60 s steps × 60.
  let elapsed = 0;
  while (elapsed * 60 <= end) {
    if (elapsed * 60 >= startup) out.add(elapsed * 60);
    elapsed += 1 / 60;
  }
  for (let k = 0; k < 4; k++) out.add(startup + r.next() * active);
  return [...out].filter((f) => f >= startup && f <= end);
}

// ---------------------------------------------------------------------------------------------
// A. Gameplay is unchanged.
// ---------------------------------------------------------------------------------------------
describe('weapon trajectory: hit frames are bit-identical to the original strike arc (golden)', () => {
  function golden(entries: Entry[]) {
    const r = rng(7);
    const failures: string[] = [];
    let checked = 0;
    for (const { label, move } of entries)
      for (const facing of [1, -1] as const)
        for (const actor of ACTORS(facing))
          for (const frame of windowFrames(move, r)) {
            checked++;
            const diff = bitDiff(sampleWeapon(actor, move, frame), originalSampleWeapon(actor, move, frame));
            if (diff.length) failures.push(`${label} facing ${facing} frame ${frame}: ${diff.join(', ')}`);
          }
    expect(failures.slice(0, 10)).toEqual([]);
    return checked;
  }

  it('player normals: six weapons × quick/breaker × jab 0–2, tilt, smash (charge 0 and 1), dash, aerial × five directions', () => {
    expect(PLAYER.length).toBe(6 * 2 * 8 * 5);
    expect(golden(PLAYER)).toBeGreaterThan(10_000);
  });

  it('every special slot for each special type, module and weapon', () => {
    // Recovery, both EMP modules, both side modules, and pulse/blink/vortex with both neutral modules.
    const ids = new Set(SPECIAL.map((e) => e.move.id));
    for (const id of ['special.recovery', 'special.emp.launch', 'special.emp.stagger', 'special.side.cross', 'special.side.push',
      'special.pulse.focused', 'special.pulse.split', 'special.blink.focused', 'special.blink.split', 'special.vortex.focused', 'special.vortex.split'])
      expect(ids.has(id), id).toBe(true); // prettier-ignore
    golden(SPECIAL);
  });

  it('enemy and utility moves: slash, radial, all directions, short/long/instant windows, throws', () => {
    golden(UTILITY);
  });

  it('arbitrary well-formed moves', () => {
    golden(randomMoves(400));
  });

  /** Runs sweptContact and its frozen oracle over a grid of boxes and sweep spans, collecting any difference. */
  function compareSwept(entries: Entry[], dense = false) {
    const boxes: Hurtbox[] = [];
    for (const dx of [-2.6, -0.9, 0.9, 2.6])
      for (const y of [0, 1.3])
        for (const dz of [-1, 1])
          if (dense || (dx * y > 0) === dz > 0) boxes.push({ min: { x: dx - 0.45, y, z: dz - 0.45 }, max: { x: dx + 0.45, y: y + 0.9, z: dz + 0.45 } });
    const results = { null: 0, hit: 0 };
    const failures: string[] = [];
    entries.forEach(({ label, move }, index) => {
      const facing = index % 2 ? 1 : -1;
      const actor = { x: 0.4, y: 0.2, z: -0.1, facing } as const;
      const previous = { x: actor.x - 0.07 * facing, y: 0.18, z: -0.09, facing } as const;
      const { startup } = move.frames;
      const end = activeEnd(move);
      // Whole move, one-frame steps across each edge, steps inside, and `to` a hair past the last hit frame.
      const spans: [number, number][] = [[startup - 1, startup], [end - 1, end], [end, end + 1], [end - 1e-12, end + 1e-12]]; // prettier-ignore
      for (let f = startup + 2; f < end; f += 4) spans.push([f - 1, f]);
      // One long sweep over the whole move (expensive: it is sampled by angular travel) for an eighth of the moves.
      if (index % 8 === 0) spans.push([0, totalFrames(move)]);
      for (const [from, to] of spans)
        for (const box of boxes) {
          // As the engine does: the pose it sampled at `to` is handed in for the final sample.
          const got = sweptContact(actor, move, from, to, box, previous, sampleWeapon(actor, move, to));
          const want = originalSweptContact(actor, move, from, to, box, previous, originalSampleWeapon(actor, move, to));
          if (got === null) results.null++;
          else results.hit++;
          if (!Object.is(got, want)) failures.push(`${label} [${from}, ${to}] box min ${JSON.stringify(box.min)}: ${got}, originally ${want}`);
        }
    });
    return { results, failures };
  }

  it('hit detection itself is unchanged: sweptContact matches an oracle built on the frozen sampler', () => {
    // Every move the game builds has a recovery; the no-recovery edge is covered separately below.
    const entries = [
      ...PLAYER.filter((e) => e.label.includes('/quick') && / (tilt|smash0 c0|aerial)0? |jab0 c0 neutral|dash0 c0 forward/.test(e.label)),
      ...SPECIAL.filter((_, i) => i % 3 === 0),
      ...UTILITY.filter((e) => e.move.frames.recovery > 0),
    ];
    const { results, failures } = compareSwept(entries);
    expect(failures.slice(0, 10)).toEqual([]);
    // Not vacuous: the grid contains plenty of both outcomes.
    expect(results.hit).toBeGreaterThan(300);
    expect(results.null).toBeGreaterThan(300);
  });

  it('hit detection is unchanged for a move with no recovery, even when `to` lands just past its last hit frame', () => {
    // sweptContact substitutes the engine's checked pose for its final sample when that sample is
    // within 1e-8 of `to`. With no recovery, a `to` a hair past activeEnd is also "≥ total frames":
    // the pose checked there must still be the end of the strike arc, not the rest pose.
    const entries = UTILITY.filter((e) => e.move.frames.recovery === 0 && e.move.behavior !== 'none');
    expect(entries.length).toBeGreaterThan(0);
    const { failures } = compareSwept(entries, true);
    expect(failures.slice(0, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// B. The whole trajectory is continuous, finite and starts/ends at rest.
// ---------------------------------------------------------------------------------------------
describe('weapon trajectory: continuity and rest', () => {
  const EPS = 1e-6;
  const TOLERANCE = 1e-4;

  it('approaching the hit window from either side meets its endpoints (within 1e-4)', () => {
    const failures: string[] = [];
    for (const { label, move } of [...CATALOGUE, ...randomMoves(200)])
      for (const facing of [1, -1] as const) {
        const actor = ACTORS(facing)[0]!;
        const { startup, recovery } = move.frames;
        const end = activeEnd(move);
        if (startup > 0) {
          const gap = capsuleGap(sampleWeapon(actor, move, startup - EPS), sampleWeapon(actor, move, startup));
          if (!(gap < TOLERANCE)) failures.push(`${label} facing ${facing}: jump of ${gap.toExponential(2)} entering the hit window (frame ${startup})`);
        }
        // With no recovery the move is over at activeEnd; there is nothing after it to join.
        if (recovery > 0) {
          const gap = capsuleGap(sampleWeapon(actor, move, end + EPS), sampleWeapon(actor, move, end));
          if (!(gap < TOLERANCE)) failures.push(`${label} facing ${facing}: jump of ${gap.toExponential(2)} leaving the hit window (frame ${end})`);
        }
      }
    expect(failures.slice(0, 12), `${failures.length} discontinuities`).toEqual([]);
  });

  it('frame 0 and every frame from the end of the move on are the rest pose', () => {
    const failures: string[] = [];
    for (const { label, move } of CATALOGUE)
      for (const facing of [1, -1] as const) {
        const actor = ACTORS(facing)[0]!;
        const rest = WEAPON_REST[move.pose];
        const total = totalFrames(move);
        const frames: number[] = [];
        if (move.frames.startup > 0) frames.push(0, -3);
        // A move with no recovery ends on its last hit frame, which stays live.
        for (const f of move.frames.recovery > 0 ? [total, total + 0.5, total + 7] : [total + 0.5, total + 7]) frames.push(f);
        for (const frame of frames) {
          const c = sampleWeapon(actor, move, frame);
          const d = { x: c.b.x - c.a.x, y: c.b.y - c.a.y, z: c.b.z - c.a.z };
          const bad: string[] = [];
          if (Math.abs(c.a.x - (actor.x + facing * PIVOT_X)) > 1e-12 || Math.abs(c.a.y - (actor.y + PIVOT_Y)) > 1e-12 || c.a.z !== actor.z)
            bad.push(`pivot ${JSON.stringify(c.a)}`);
          if (d.z !== 0 || !(d.x * facing > 0)) bad.push(`not in the X–Y plane toward facing: ${JSON.stringify(d)}`);
          const elevation = Math.atan2(d.y, d.x * facing);
          if (Math.abs(elevation - rest.angle) > 1e-9) bad.push(`elevation ${elevation} != ${rest.angle}`);
          const length = Math.hypot(d.x, d.y, d.z);
          if (Math.abs(length - rest.length) > 1e-9) bad.push(`length ${length} != natural ${rest.length}`);
          if (bad.length) failures.push(`${label} facing ${facing} frame ${frame}: ${bad.join('; ')}`);
        }
      }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('is finite everywhere, keeps the shape radius, and facing mirrors X only', () => {
    const failures: string[] = [];
    for (const { label, move } of [...CATALOGUE, ...randomMoves(200)]) {
      const right = ACTORS(1)[0]!,
        left = ACTORS(-1)[0]!;
      for (let frame = -5; frame <= totalFrames(move) + 5; frame += 0.25) {
        const p = sampleWeapon(right, move, frame),
          q = sampleWeapon(left, move, frame);
        const where = `${label} frame ${frame}`;
        if (![...coords(p), ...coords(q)].every(Number.isFinite)) failures.push(`${where}: non-finite ${JSON.stringify(p)}`);
        if (p.radius !== move.shape.radius || q.radius !== move.shape.radius) failures.push(`${where}: radius ${p.radius}/${q.radius}`);
        for (const end of ['a', 'b'] as const) {
          if (!Object.is(p[end].y, q[end].y) || !Object.is(p[end].z, q[end].z)) failures.push(`${where}: facing changed ${end}.y/z`);
          if (Math.abs(p[end].x - right.x + (q[end].x - left.x)) > 1e-12) failures.push(`${where}: ${end}.x not mirrored`);
        }
      }
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// C. The wind-up winds up and the follow-through follows through (attacker's frame, facing 1).
// ---------------------------------------------------------------------------------------------
const move = (weapon: WeaponId, kind: AttackKind, direction: AttackDirection, module: 'quick' | 'breaker' = 'quick', combo = 0, charge = 0) =>
  playerMove(loadout(weapon, 'pulse', { weapon: module, neutral: 'focused', side: 'cross', down: 'launch' }), kind, direction, combo, charge); // prettier-ignore

/** Samples of the capsule at the origin, facing +X, every quarter frame over [from, to). */
function samples(m: MoveDefinition, from: number, to: number, step = 0.25) {
  const out: { frame: number; c: Capsule; tip: Vec3; aim: Vec3; length: number }[] = [];
  for (let frame = from; frame < to - 1e-9; frame += step) out.push(at(m, frame));
  return out;
}
function at(m: MoveDefinition, frame: number) {
  const c = sampleWeapon(ORIGIN, m, frame);
  const aim = { x: c.b.x - c.a.x, y: c.b.y - c.a.y, z: c.b.z - c.a.z };
  return { frame, c, tip: c.b, aim, length: Math.hypot(aim.x, aim.y, aim.z) };
}
/** Heading in the lane plane, unwrapped along a sequence of samples. */
function headings(aims: Vec3[]): number[] {
  const out: number[] = [];
  for (const a of aims) {
    let h = Math.atan2(a.z, a.x);
    if (out.length) h += Math.round((out.at(-1)! - h) / (Math.PI * 2)) * Math.PI * 2;
    out.push(h);
  }
  return out;
}
const MODULES = ['quick', 'breaker'] as const;

describe('weapon trajectory: wind-up and follow-through', () => {
  it('slash: cocks back behind the start of the arc, then carries on past its end before returning', () => {
    for (const module of MODULES)
      for (const [kind, charge] of [['tilt', 0], ['smash', 0], ['smash', 1]] as const) {
        const m = move('arc', kind, 'forward', module, 0, charge);
        const label = `arc ${kind} c${charge} ${module}`;
        const { startup } = m.frames;
        const end = activeEnd(m),
          total = totalFrames(m);
        // Unwrap along the whole move so headings are comparable.
        const all = samples(m, 0, total + 0.25);
        const h = headings(all.map((s) => s.aim));
        const index = (frame: number) => all.findIndex((s) => Math.abs(s.frame - frame) < 1e-9);
        const h0 = h[index(startup)]!,
          h1 = h[index(end)]!;
        const spin = Math.sign(h1 - h0);
        expect(spin, label).not.toBe(0);
        const windup = h.slice(0, index(startup)).map((x) => x * spin);
        const recovery = h.slice(index(end) + 1, index(total)).map((x) => x * spin);
        expect(Math.min(...windup), `${label}: cocks back beyond the arc's start`).toBeLessThan(h0 * spin - 0.2);
        expect(Math.max(...recovery), `${label}: follows through past the arc's end`).toBeGreaterThan(h1 * spin + 0.1);
        // The overshoot peaks before the end of the move, which is back at rest.
        expect(recovery.indexOf(Math.max(...recovery)), label).toBeLessThan(recovery.length - 2);
        expect(Math.abs(h[index(total)]! - Math.round(h[index(total)]! / (Math.PI * 2)) * Math.PI * 2), `${label}: rest heading`).toBeLessThan(1e-9);
        // Measured as the task states it: the tip swings behind the start of the live arc.
        const tipX = all.slice(0, index(startup)).map((s) => s.tip.x);
        expect(Math.min(...tipX), label).toBeLessThan(at(m, startup).tip.x);
      }
  });

  it('pile forward: raised overhead in the wind-up, driven down below the hit end after it', () => {
    for (const module of MODULES)
      for (const kind of ['tilt', 'smash'] as const) {
        const m = move('pile', kind, 'forward', module);
        const label = `pile ${kind} ${module}`;
        const end = activeEnd(m);
        const windup = samples(m, 0, m.frames.startup);
        const after = samples(m, end + 0.25, totalFrames(m));
        expect(Math.max(...windup.map((s) => s.tip.y)), label).toBeGreaterThan(at(m, m.frames.startup).tip.y + 0.1);
        expect(Math.min(...after.map((s) => s.tip.y)), label).toBeLessThan(at(m, end).tip.y - 0.05);
      }
  });

  it('thrust (lance, razor): draws back before the hit and recoils back to rest after it', () => {
    for (const weapon of ['lance', 'razor'] as const)
      for (const module of MODULES)
        for (const kind of ['tilt', 'smash'] as const) {
          const m = move(weapon, kind, 'forward', module);
          const label = `${weapon} ${kind} ${module}`;
          const end = activeEnd(m),
            total = totalFrames(m);
          const live = at(m, m.frames.startup).length;
          expect(Math.min(...samples(m, 0, m.frames.startup).map((s) => s.length)), `${label}: drawn back`).toBeLessThan(live * 0.85);
          // Recovery: shortens to a single low point (at most a small recoil below rest), then settles to rest.
          const lengths = [at(m, end).length, ...samples(m, end + 0.25, total).map((s) => s.length), at(m, total).length];
          const rest = WEAPON_REST[weapon].length;
          const low = lengths.indexOf(Math.min(...lengths));
          for (let i = 1; i <= low; i++) expect(lengths[i]!, `${label}: shortening at recovery sample ${i}`).toBeLessThanOrEqual(lengths[i - 1]! + 1e-12);
          for (let i = low + 1; i < lengths.length; i++) expect(lengths[i]!, `${label}: settling at recovery sample ${i}`).toBeGreaterThanOrEqual(lengths[i - 1]! - 1e-12);
          expect(lengths[low]!, `${label}: recoil dip is small`).toBeGreaterThan(rest - 0.12 * m.shape.reach);
          expect(Math.abs(lengths.at(-1)! - rest), label).toBeLessThan(1e-9);
        }
  });

  it('orbit (scythe): winds back against the spin, then carries on with it', () => {
    for (const module of MODULES)
      for (const [kind, direction] of [['tilt', 'forward'], ['smash', 'forward'], ['jab', 'neutral'], ['aerial', 'neutral']] as const) {
        const m = move('scythe', kind, direction, module);
        const label = `scythe ${kind} ${direction} ${module}`;
        expect(m.shape.trajectory).toBe('orbit');
        const end = activeEnd(m),
          total = totalFrames(m);
        const all = samples(m, 0, total + 0.25);
        const h = headings(all.map((s) => s.aim));
        const index = (frame: number) => all.findIndex((s) => Math.abs(s.frame - frame) < 1e-9);
        const h0 = h[index(m.frames.startup)]!,
          h1 = h[index(end)]!;
        // The live arc spins one full turn in the +heading direction.
        expect(h1 - h0, label).toBeGreaterThan(Math.PI * 1.9);
        expect(Math.min(...h.slice(0, index(m.frames.startup))), `${label}: winds back`).toBeLessThan(h0 - 0.2);
        expect(Math.max(...h.slice(index(end) + 1, index(total))), `${label}: carries on`).toBeGreaterThan(h1 + 0.2);
      }
  });

  it('up attacks swing up onto the vertical line; down aerials swing down onto it from above', () => {
    const elevation = (a: Vec3) => Math.atan2(a.y, Math.hypot(a.x, a.z));
    const failures: string[] = [];
    for (const weapon of WEAPONS)
      for (const module of MODULES)
        for (const { kind, combo, charge } of PLAYER_KINDS) {
          const up = move(weapon, kind, 'up', module, combo, charge);
          const dn = move(weapon, kind, 'down', module, combo, charge);
          // A down aerial that spins (scythe orbit) has no vertical line to swing onto.
          const vertical = kind === 'aerial' && dn.shape.trajectory !== 'orbit' && dn.shape.trajectory !== 'burst';
          const cases: [MoveDefinition, 'up' | 'down'][] = [[up, 'up'], ...(vertical ? [[dn, 'down'] as [MoveDefinition, 'down']] : [])];
          for (const [m, direction] of cases) {
            const label = `${weapon} ${kind}${combo} c${charge} ${direction} ${module}`;
            const { startup } = m.frames;
            // The late wind-up: its last third, on a quarter-frame grid, ending on the live line.
            const late = [...samples(m, Math.ceil((startup * 2) / 3 * 4) / 4, startup), at(m, startup)];
            const value = late.map((s) => (direction === 'up' ? elevation(s.aim) : -(s.tip.y - s.c.a.y)));
            for (let i = 1; i < value.length; i++)
              if (!(value[i]! > value[i - 1]!)) failures.push(`${label}: not ${direction === 'up' ? 'rising' : 'falling'} at frame ${late[i]!.frame} (${value[i - 1]} → ${value[i]})`);
            if (direction === 'down' && !samples(m, 0, startup).some((s) => s.aim.y > 0)) failures.push(`${label}: never above the pivot in the wind-up`);
          }
        }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('back attacks: the pivot crosses behind by the hit and returns by the end', () => {
    for (const weapon of WEAPONS)
      for (const kind of ['tilt', 'aerial', 'smash'] as const) {
        const m = move(weapon, kind, 'back');
        const label = `${weapon} back ${kind}`;
        const end = activeEnd(m),
          total = totalFrames(m);
        expect(at(m, 0).c.a.x, label).toBeCloseTo(PIVOT_X, 12);
        expect(at(m, m.frames.startup).c.a.x, label).toBeCloseTo(-PIVOT_X, 12);
        expect(at(m, end).c.a.x, label).toBeCloseTo(-PIVOT_X, 12);
        expect(at(m, total).c.a.x, label).toBeCloseTo(PIVOT_X, 12);
        const windup = samples(m, 0, m.frames.startup + 0.25).map((s) => s.c.a.x);
        const recovery = samples(m, end, total + 0.25).map((s) => s.c.a.x);
        for (let i = 1; i < windup.length; i++) expect(windup[i]!, label).toBeLessThanOrEqual(windup[i - 1]! + 1e-12);
        for (let i = 1; i < recovery.length; i++) expect(recovery[i]!, label).toBeGreaterThanOrEqual(recovery[i - 1]! - 1e-12);
      }
  });

  it('the six weapons wind up differently (forward tilt, mid-startup)', () => {
    for (const module of MODULES) {
      const poses = WEAPONS.map((weapon) => {
        const m = move(weapon, 'tilt', 'forward', module);
        return { weapon, ...at(m, m.frames.startup / 2) };
      });
      for (let i = 0; i < poses.length; i++)
        for (let j = i + 1; j < poses.length; j++) {
          const p = poses[i]!,
            q = poses[j]!;
          const tipGap = Math.hypot(p.tip.x - q.tip.x, p.tip.y - q.tip.y, p.tip.z - q.tip.z);
          expect(tipGap, `${module}: ${p.weapon} vs ${q.weapon} tip`).toBeGreaterThan(0.1);
        }
    }
  });

  it('a jab combo shares its hit frames but each hit winds up at its own height', () => {
    for (const module of MODULES) {
      const combo = [0, 1, 2].map((c) => move('arc', 'jab', 'neutral', module, c));
      const [first] = combo;
      for (const m of combo) expect(m.frames).toEqual(first!.frames);
      // Identical capsules on every hit frame (damage/force differ; geometry may not).
      for (const frame of windowFrames(first!, rng(3)))
        for (const m of combo.slice(1)) expect(bitDiff(sampleWeapon(ORIGIN, m, frame), sampleWeapon(ORIGIN, first!, frame)), `frame ${frame}`).toEqual([]);
      const heights = combo.map((m) => at(m, m.frames.startup / 2).tip.y);
      for (let i = 0; i < 3; i++)
        for (let j = i + 1; j < 3; j++) expect(Math.abs(heights[i]! - heights[j]!), `${module}: jab ${i} vs ${j} mid-startup tip height`).toBeGreaterThan(0.02);
    }
  });
});
