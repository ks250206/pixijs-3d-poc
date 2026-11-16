import { describe, expect, it } from 'vite-plus/test';
import { bodyHurtbox, sampleWeapon, segmentBox, sweptContact, type Capsule, type Hurtbox, type Vec3 } from '../src/game/combat/geometry';
import { activeEnd, playerMove, type MoveDefinition, type StrikeArc } from '../src/game/combat/moves';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { EMPTY_INPUT, type Actor, type AttackKind, type InputFrame, type Loadout, type WeaponId } from '../src/game/types';
import { rng } from './helpers/rig';

/**
 * The redesigned up and down normals. Up attacks used to poke one vertical line and were hard to
 * land; they now sweep a crescent from in front, over the head and on behind it. Grounded down
 * attacks mow low across both lanes (or slam, or spin) and pop the target up into an up attack;
 * down aerials sweep under the fighter. Arc numbers are tuning (`ARCS` in moves.ts) and may change:
 * every check reads the arc from the move under test and pins a contract or a coverage property.
 */

type Pos = Pick<Actor, 'x' | 'y' | 'z' | 'facing'>;
const WEAPONS: WeaponId[] = ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'];
const MODULES = ['quick', 'breaker'] as const;
type Module = (typeof MODULES)[number];
const LEVEL_SWEEPERS: WeaponId[] = ['arc', 'razor', 'lance', 'scythe'];
const SLAMMERS: WeaponId[] = ['pile', 'cannon'];

const loadout = (weapon: WeaponId, module: Module): Loadout => ({
  id: 'test', name: 'TEST', subtitle: '', weapon, special: 'pulse', trait: 'stable', color: 0,
  power: 1, speed: 1, weight: 1, description: '', modules: { weapon: module, neutral: 'focused', side: 'cross', down: 'launch' },
}); // prettier-ignore
const move = (weapon: WeaponId, kind: AttackKind, direction: 'up' | 'down' | 'forward', module: Module = 'quick', charge = 0) =>
  playerMove(loadout(weapon, module), kind, direction, 0, charge);

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
/** Live-window parameter of a hit frame. */
const param = (m: MoveDefinition, frame: number) => clamp((frame - m.frames.startup) / Math.max(1, m.frames.active), 0, 1);
/** Angle `a` brought within half a turn of `b`. */
const near = (a: number, b: number) => a + Math.round((b - a) / (Math.PI * 2)) * Math.PI * 2;

// ---------------------------------------------------------------------------------------------
// Frozen copy of the ORIGINAL hit-frame sampler (git show 8b06b41:src/game/combat/geometry.ts),
// hit frames only: the single vertical line up/down attacks used before this redesign. Used to
// show where the arcs reach what the old line could not.
// ---------------------------------------------------------------------------------------------
function originalHitFrame(actor: Pos, m: MoveDefinition, frame: number): Capsule {
  const { shape, frames, direction } = m;
  const t = clamp((frame - frames.startup) / Math.max(1, frames.active), 0, 1);
  const extension = 0.75 + 0.25 * Math.sin(t * Math.PI);
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
    vy = m.pose === 'pile' ? 0.55 - t * 0.85 : Math.sin(t * Math.PI) * 0.15;
  }
  if (direction === 'up') {
    vx = sign * 0.24;
    vy = 0.97;
    vz = 0;
  }
  if (direction === 'down' && shape.trajectory !== 'burst' && shape.trajectory !== 'orbit') {
    vx = sign * (m.kind === 'aerial' ? 0.24 : 0.96);
    vy = m.kind === 'aerial' ? -0.97 : -0.28;
    vz = 0;
  }
  const origin = { x: actor.x + actor.facing * sign * 0.3, y: actor.y + (shape.trajectory === 'burst' ? Math.min(1, shape.height / 2) : 1.15), z: actor.z };
  const reach = shape.reach * extension;
  return { a: origin, b: { x: origin.x + actor.facing * vx * reach, y: origin.y + vy * reach, z: origin.z + vz * reach }, radius: shape.radius };
}
/** Whether the original line touched `box` anywhere in the hit window (dense: 200 samples per frame). */
function originalHits(actor: Pos, m: MoveDefinition, box: Hurtbox): boolean {
  const steps = Math.max(1, m.frames.active * 200);
  for (let i = 0; i <= steps; i++) {
    const c = originalHitFrame(actor, m, mix(m.frames.startup, activeEnd(m), i / steps));
    if (segmentBox(c.a, c.b, box).distance <= c.radius) return true;
  }
  return false;
}
/** The arcs as the game tests them: the whole hit window through `sweptContact`. */
const hits = (actor: Pos, m: MoveDefinition, box: Hurtbox) => sweptContact(actor, m, m.frames.startup, activeEnd(m), box) !== null;
/** A standard (scout, scale 1) body standing with its feet at (x, y, z): ±0.34 in X, ±0.28 in Z, 0.03 … 2.08 tall. */
const scout = (x: number, y: number, z: number) => bodyHurtbox({ x, y, z, scale: 1, kind: 'scout' });
/** Top of a standing fighter's own body box, above its feet. */
const HEAD_TOP = scout(0, 0, 0).max.y;
/** Half-width of a fighter's body box in X. */
const HALF_WIDTH = scout(0, 0, 0).max.x;

// ---------------------------------------------------------------------------------------------
// Every up/down normal of the game, plus arbitrary arcs (so the contract is not today's table).
// ---------------------------------------------------------------------------------------------
interface Entry {
  label: string;
  move: MoveDefinition;
}
function arcMoves(): Entry[] {
  const out: Entry[] = [];
  for (const weapon of WEAPONS)
    for (const module of MODULES)
      for (const [kind, charge] of [['tilt', 0], ['smash', 0], ['smash', 1], ['aerial', 0]] as const)
        for (const direction of ['up', 'down'] as const)
          out.push({ label: `${weapon}/${module} ${direction} ${kind} c${charge}`, move: playerMove(loadout(weapon, module), kind, direction, 0, charge) });
  const r = rng(424242);
  for (let i = 0; i < 60; i++) {
    const base = move(WEAPONS[i % 6]!, (['tilt', 'smash', 'aerial'] as const)[i % 3]!, i % 2 ? 'up' : 'down');
    const plane = r.chance(0.5) ? 'vertical' : 'level';
    const from = r.range(-4, 4);
    const arc: StrikeArc = { plane, from, to: from + r.range(-7, 7), pivotY: [r.range(0.3, 1.9), r.range(0.3, 1.9)], ...(plane === 'level' ? { tilt: r.range(-0.3, 0.3) } : {}) };
    const frames = { startup: Math.floor(r.range(1, 20)), active: Math.floor(r.range(1, 14)), recovery: Math.floor(r.range(1, 30)) };
    out.push({ label: `random ${plane} arc #${i}`, move: { ...base, frames, shape: { ...base.shape, reach: r.range(0.5, 6), depth: r.range(0.5, 4), arc } } });
  }
  return out;
}
const ARC_MOVES = arcMoves();
const ACTORS = (facing: 1 | -1): Pos[] => [
  { x: 3.7, y: 0.45, z: -1.2, facing },
  { x: -12.25, y: 0, z: 0.8, facing },
];
function hitFrames(m: MoveDefinition): number[] {
  const { startup, active } = m.frames;
  const out = new Set<number>([startup, activeEnd(m)]);
  for (let k = 0; k <= 16; k++) out.add(startup + (active * k) / 16);
  out.add(startup + 1e-9);
  out.add(activeEnd(m) - 1e-9);
  return [...out];
}

// ---------------------------------------------------------------------------------------------
// 1. The arc contract on hit frames.
// ---------------------------------------------------------------------------------------------
describe('attack arcs: hit-frame geometry', () => {
  it('covers every up/down tilt, smash and aerial and both planes', () => {
    expect(ARC_MOVES.filter((e) => !e.label.startsWith('random')).length).toBe(6 * 2 * 4 * 2);
    expect(ARC_MOVES.every((e) => e.move.shape.arc)).toBe(true);
    expect(ARC_MOVES.some((e) => e.move.shape.arc!.plane === 'vertical') && ARC_MOVES.some((e) => e.move.shape.arc!.plane === 'level')).toBe(true);
  });

  it('pivot: x = actor.x + facing·0.3, z = actor.z, height travelling pivotY[0] → pivotY[1] across the window', () => {
    const failures: string[] = [];
    for (const { label, move: m } of ARC_MOVES)
      for (const facing of [1, -1] as const)
        for (const actor of ACTORS(facing))
          for (const frame of hitFrames(m)) {
            const { a } = sampleWeapon(actor, m, frame);
            const t = param(m, frame);
            const y = actor.y + mix(m.shape.arc!.pivotY[0], m.shape.arc!.pivotY[1], t);
            if (!Object.is(a.x, actor.x + actor.facing * 0.3) || !Object.is(a.z, actor.z) || Math.abs(a.y - y) > 1e-12)
              failures.push(`${label} facing ${facing} frame ${frame}: pivot ${JSON.stringify(a)}, expected (${actor.x + facing * 0.3}, ${y}, ${actor.z})`);
          }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('vertical arcs: the tip stays in the fighter\'s lane (z = actor.z exactly), at length reach·(0.75 + 0.25·sin πt), at elevation from + (to − from)·t', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { label, move: m } of ARC_MOVES.filter((e) => e.move.shape.arc!.plane === 'vertical'))
      for (const facing of [1, -1] as const)
        for (const actor of ACTORS(facing))
          for (const frame of hitFrames(m)) {
            checked++;
            const { a, b } = sampleWeapon(actor, m, frame);
            const arc = m.shape.arc!;
            const t = param(m, frame);
            const d = { x: (b.x - a.x) * facing, y: b.y - a.y };
            const length = Math.hypot(d.x, d.y);
            const want = m.shape.reach * (0.75 + 0.25 * Math.sin(Math.PI * t));
            const angle = arc.from + (arc.to - arc.from) * t;
            const where = `${label} facing ${facing} frame ${frame}`;
            if (!Object.is(b.z, actor.z)) failures.push(`${where}: tip z ${b.z} left the lane ${actor.z}`);
            if (Math.abs(length - want) > 1e-9) failures.push(`${where}: length ${length} != ${want}`);
            if (Math.abs(near(Math.atan2(d.y, d.x), angle) - angle) > 1e-9) failures.push(`${where}: elevation ${Math.atan2(d.y, d.x)} != ${angle}`);
          }
    expect(checked).toBeGreaterThan(3000);
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('level arcs: aim.y is the tilt, and the heading sweeps from → to with Z compressed by min(1, depth/reach) (they cover depth on purpose)', () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { label, move: m } of ARC_MOVES.filter((e) => e.move.shape.arc!.plane === 'level'))
      for (const facing of [1, -1] as const)
        for (const actor of ACTORS(facing))
          for (const frame of hitFrames(m)) {
            checked++;
            const { a, b } = sampleWeapon(actor, m, frame);
            const arc = m.shape.arc!;
            const t = param(m, frame);
            const scale = m.shape.reach * (0.75 + 0.25 * Math.sin(Math.PI * t));
            const angle = arc.from + (arc.to - arc.from) * t;
            const aim = { x: ((b.x - a.x) * facing) / scale, y: (b.y - a.y) / scale, z: (b.z - a.z) / scale };
            const want = { x: Math.cos(angle), y: arc.tilt ?? 0, z: Math.sin(angle) * Math.min(1, m.shape.depth / m.shape.reach) };
            const gap = Math.max(Math.abs(aim.x - want.x), Math.abs(aim.y - want.y), Math.abs(aim.z - want.z));
            if (!(gap < 1e-9)) failures.push(`${label} facing ${facing} frame ${frame}: aim ${JSON.stringify(aim)} != ${JSON.stringify(want)}`);
          }
    expect(checked).toBeGreaterThan(1000);
    // Not vacuous: the level sweeps really do leave the fighter's lane, toward both sides.
    for (const weapon of LEVEL_SWEEPERS) {
      const m = move(weapon, 'tilt', 'down');
      const zs = hitFrames(m).map((f) => sampleWeapon({ x: 0, y: 0, z: 0, facing: 1 }, m, f).b.z);
      expect(Math.min(...zs), `${weapon} reaches the far lane (−Z)`).toBeLessThan(-0.5);
      expect(Math.max(...zs), `${weapon} reaches the near lane (+Z)`).toBeGreaterThan(0.5);
    }
    expect(failures.slice(0, 10)).toEqual([]);
  });

  it('facing mirrors X only: y and z are bit-identical, x mirrors about the actor', () => {
    const failures: string[] = [];
    for (const { label, move: m } of ARC_MOVES)
      for (const [right, left] of [0, 1].map((i) => [ACTORS(1)[i]!, ACTORS(-1)[i]!] as const))
        for (const frame of hitFrames(m)) {
          const p = sampleWeapon(right, m, frame),
            q = sampleWeapon(left, m, frame);
          for (const end of ['a', 'b'] as const) {
            if (!Object.is(p[end].y, q[end].y) || !Object.is(p[end].z, q[end].z)) failures.push(`${label} frame ${frame}: ${end}.y/z changed with facing`);
            if (Math.abs(p[end].x - right.x + (q[end].x - left.x)) > 1e-12) failures.push(`${label} frame ${frame}: ${end}.x not mirrored`);
          }
        }
    expect(failures.slice(0, 10)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. What the arcs can hit, measured with the game's own sweptContact on real moves.
//
// Targets are standard scout bodies (bodyHurtbox: ±0.34 X, ±0.28 Z, 0.03 … 2.08 tall), the
// attacker at the origin facing +X. Positions were chosen from the measured capsules:
// - FRONT: feet at x = 1.6 in the attacker's lane. The original vertical line reached a body up to
//   x ≈ 1.0–1.2 at most for every weapon; every arc reaches past x = 2.2.
// - OVERHEAD: feet at x = 0, 2.2 up: just above the attacker's own head (2.08).
// - BEHIND-ABOVE: feet 2.2 up, x = −0.68: its front face touches the attacker's back face (−0.34).
// - Lanes: a body at depth ±1.0 (its box spans 0.72 … 1.28 from the attacker's lane, outside the
//   attacker's own ±0.28 and the old down tilt's ±0.5 reach), at half the move's reach in front.
// ---------------------------------------------------------------------------------------------
const O: Pos = { x: 0, y: 0, z: 0, facing: 1 };
const FRONT = { x: 1.6, y: 0, z: 0 };
const OVERHEAD = { x: 0, y: 2.2, z: 0 };
const BEHIND_ABOVE = { x: -2 * HALF_WIDTH, y: 2.2, z: 0 };
const LANE = 1.0;
const box = (p: { x: number; y: number; z: number }) => scout(p.x, p.y, p.z);

describe('attack arcs: up attacks cover the front, the air above and behind', () => {
  it('the targets are what they say: overhead and behind-above are clear of the attacker\'s body', () => {
    expect(box(OVERHEAD).min.y).toBeGreaterThan(HEAD_TOP);
    expect(box(BEHIND_ABOVE).min.y).toBeGreaterThan(HEAD_TOP);
    expect(box(BEHIND_ABOVE).max.x).toBeCloseTo(-HALF_WIDTH, 12);
    expect(box(FRONT).min.x).toBeGreaterThan(HALF_WIDTH);
  });

  for (const kind of ['tilt', 'smash'] as const)
    it.each(WEAPONS)(`%s grounded up ${kind}: hits a scout in front in the same lane (the old vertical poke missed it), one directly overhead, and one above-and-behind`, (weapon) => {
      for (const module of MODULES) {
        const m = move(weapon, kind, 'up', module);
        const arc = m.shape.arc!;
        const label = `${weapon}/${module} up ${kind}`;
        expect(hits(O, m, box(FRONT)), `${label}: front`).toBe(true);
        expect(originalHits(O, m, box(FRONT)), `${label}: the original line reached the front target`).toBe(false);
        expect(hits(O, m, box(OVERHEAD)), `${label}: overhead`).toBe(true);
        // Behind is only asked of an arc that ends past straight up.
        if (Math.max(arc.from, arc.to) > Math.PI / 2) expect(hits(O, m, box(BEHIND_ABOVE)), `${label}: above-and-behind`).toBe(true);
        // A body standing right against the attacker is still hit (no hole in front of the hands).
        expect(hits(O, m, scout(2 * HALF_WIDTH, 0, 0)), `${label}: point blank`).toBe(true);
      }
    });

  it.each(WEAPONS)('%s up aerial: hits a scout directly above the fighter', (weapon) => {
    for (const module of MODULES) {
      const m = move(weapon, 'aerial', 'up', module);
      const air = { ...O, y: 3 };
      expect(hits(air, m, scout(0, air.y + 2.2, 0)), `${weapon}/${module}`).toBe(true);
    }
  });
});

describe('attack arcs: down attacks mow low across both lanes, slam, or spin', () => {
  for (const kind of ['tilt', 'smash'] as const) {
    it.each(LEVEL_SWEEPERS)(`%s grounded down ${kind} (level sweep): hits a grounded scout in front, and in the far (−Z) and near (+Z) lanes`, (weapon) => {
      for (const module of MODULES) {
        const m = move(weapon, kind, 'down', module);
        const label = `${weapon}/${module} down ${kind}`;
        expect(m.shape.arc!.plane, label).toBe('level');
        const x = m.shape.reach / 2;
        expect(hits(O, m, scout(x, 0, 0)), `${label}: front at x ${x.toFixed(2)}`).toBe(true);
        expect(hits(O, m, scout(x, 0, -LANE)), `${label}: far lane at x ${x.toFixed(2)}, z −${LANE}`).toBe(true);
        expect(hits(O, m, scout(x, 0, LANE)), `${label}: near lane at x ${x.toFixed(2)}, z +${LANE}`).toBe(true);
        // The old low line stayed in the attacker's lane (the scythe's old down tilt already spun).
        if (weapon !== 'scythe') {
          expect(originalHits(O, m, scout(x, 0, -LANE)), `${label}: original far lane`).toBe(false);
          expect(originalHits(O, m, scout(x, 0, LANE)), `${label}: original near lane`).toBe(false);
        }
        // Low: a body standing on the floor is hit, the sweep passes under the attacker's waist.
        const lowest = Math.min(...hitFrames(m).map((f) => sampleWeapon(O, m, f).b.y));
        expect(lowest, `${label}: blade height`).toBeLessThan(0.5);
      }
    });

    it.each(SLAMMERS)(`%s grounded down ${kind} (slam): hits a grounded scout in front`, (weapon) => {
      for (const module of MODULES) {
        const m = move(weapon, kind, 'down', module);
        const label = `${weapon}/${module} down ${kind}`;
        expect(hits(O, m, scout(m.shape.reach / 2, 0, 0)), label).toBe(true);
        // A slam ends on the floor in front.
        const last = sampleWeapon(O, m, activeEnd(m)).b;
        expect(last.x, label).toBeGreaterThan(HALF_WIDTH);
        expect(last.y, label).toBeLessThan(0.5);
      }
    });
  }

  // The owner asked for down attacks that mow low across both lanes (or spin). The pile and cannon
  // slams are vertical arcs, so they stay in the attacker's own lane like the old line: measured
  // with sweptContact, a grounded scout anywhere from x = 0 to 2.2 is hit only within |z| ≤ 0.69
  // (pile) / 0.67 (cannon) — body half-depth 0.28 plus the shaft radius — so a body in the far or
  // near lane (z = ±1.0) is missed.
  for (const weapon of SLAMMERS)
    it.todo(`${weapon} grounded down tilt/smash (slam) does NOT reach the far or near lane: hit only within |z| ≤ ${weapon === 'pile' ? '0.69' : '0.67'} at x = 0 … 2.2`);

  it('scythe grounded down tilt and smash: the full low spin also hits behind', () => {
    for (const module of MODULES)
      for (const kind of ['tilt', 'smash'] as const) {
        const m = move('scythe', kind, 'down', module);
        const arc = m.shape.arc!;
        expect(Math.abs(arc.to - arc.from), `${kind} ${module}: a full turn`).toBeGreaterThanOrEqual(Math.PI * 2 - 1e-9);
        expect(hits(O, m, scout(-m.shape.reach / 2, 0, 0)), `${kind} ${module}: behind`).toBe(true);
        expect(hits(O, m, scout(-m.shape.reach / 2, 0, LANE)), `${kind} ${module}: behind, near lane`).toBe(true);
      }
  });

  it.each(WEAPONS)('%s down aerial: hits a scout directly below the fighter (the old line, angled forward, missed it)', (weapon) => {
    for (const module of MODULES) {
      const m = move(weapon, 'aerial', 'down', module);
      // Fighter's feet 3 up; the scout's head top is 0.92 below them, right under the fighter.
      const air = { ...O, y: 3 };
      expect(hits(air, m, scout(0, 0, 0)), `${weapon}/${module}`).toBe(true);
      expect(originalHits(air, m, scout(0, 0, 0)), `${weapon}/${module}: original`).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// 3. No tunnelling: the moving pivot does not let the swept test skip a thin target.
// ---------------------------------------------------------------------------------------------
describe('attack arcs: sweptContact does not tunnel through the swept surface', () => {
  it('a thin box on the surface swept between two whole frames (off both frame poses) is hit over that frame step', () => {
    const failures: string[] = [];
    let candidates = 0;
    const actors: [Pos, Pos][] = [
      [O, O],
      // Also with the attacker moving during the step, as the engine sweeps it.
      [{ x: 0.12, y: 0.05, z: 0.04, facing: 1 }, O],
      [{ x: -0.12, y: 3, z: 0, facing: -1 }, { x: 0, y: 3.08, z: 0, facing: -1 }],
    ];
    const lerp = (p: Pos, q: Pos, t: number): Pos => ({ x: mix(p.x, q.x, t), y: mix(p.y, q.y, t), z: mix(p.z, q.z, t), facing: q.facing });
    const real = WEAPONS.flatMap((weapon) => MODULES.flatMap((module) =>
      ([['tilt', 'up'], ['smash', 'up'], ['aerial', 'up'], ['tilt', 'down'], ['smash', 'down'], ['aerial', 'down']] as const).map(([kind, direction]) => ({ label: `${weapon}/${module} ${direction} ${kind}`, move: move(weapon, kind, direction, module) })))); // prettier-ignore
    // Plus arbitrary arcs: short reaches and fast pivot travel are where a moving pivot could outrun the samples.
    for (const { label, move: m } of [...real, ...ARC_MOVES.filter((e) => e.label.startsWith('random'))]) {
      for (const [actor, previous] of actors)
        for (let f = m.frames.startup; f + 1 <= activeEnd(m); f++)
          for (const u of [0.23, 0.5, 0.71])
            for (const along of [0.35, 0.7, 1]) {
              const at = lerp(previous, actor, u);
              const mid = sampleWeapon(at, m, f + u);
              const point: Vec3 = { x: mix(mid.a.x, mid.b.x, along), y: mix(mid.a.y, mid.b.y, along), z: mix(mid.a.z, mid.b.z, along) };
              const half = 0.005;
              const thin: Hurtbox = { min: { x: point.x - half, y: point.y - half, z: point.z - half }, max: { x: point.x + half, y: point.y + half, z: point.z + half } };
              const before = sampleWeapon(previous, m, f),
                after = sampleWeapon(actor, m, f + 1);
              // Only a box neither whole-frame pose touches proves the in-between sweep is tested.
              if (segmentBox(before.a, before.b, thin).distance <= before.radius || segmentBox(after.a, after.b, thin).distance <= after.radius) continue;
              candidates++;
              if (sweptContact(actor, m, f, f + 1, thin, previous) === null)
                failures.push(`${label} frames ${f}→${f + 1} at ${u}, ${along} of the shaft: missed`);
            }
    }
    expect(candidates).toBeGreaterThan(1000);
    expect(failures.slice(0, 10), `${failures.length} of ${candidates} missed`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------
// 4. Launch data.
// ---------------------------------------------------------------------------------------------
describe('attack arcs: launch data', () => {
  it('grounded down normals launch upward (angle > 1) and grow less than the same kind\'s forward attack; down aerials still spike; up attacks keep their launch', () => {
    for (const weapon of WEAPONS)
      for (const module of MODULES) {
        for (const kind of ['tilt', 'smash'] as const) {
          const down = move(weapon, kind, 'down', module),
            forward = move(weapon, kind, 'forward', module);
          expect(down.angle, `${weapon}/${module} down ${kind}`).toBeGreaterThan(1);
          expect(down.angle, `${weapon}/${module} down ${kind}: still short of straight up`).toBeLessThan(Math.PI / 2);
          expect(down.growth, `${weapon}/${module} down ${kind} growth`).toBeLessThan(forward.growth);
        }
        expect(move(weapon, 'aerial', 'down', module).angle, `${weapon}/${module} down aerial`).toBeLessThan(0);
        // Unchanged by the redesign: every up normal launches at 1.28 rad as before.
        for (const kind of ['tilt', 'smash', 'aerial'] as const) expect(move(weapon, kind, 'up', module).angle, `${weapon}/${module} up ${kind}`).toBe(1.28);
      }
  });
});

// ---------------------------------------------------------------------------------------------
// 5. Through the real engine.
// ---------------------------------------------------------------------------------------------
function lab(weapon: WeaponId, module: Module, target: { x: number; y?: number; z?: number }) {
  const g = new GameEngine(41);
  g.start(createCandidates(41).find((l) => l.weapon === weapon)!, 'training');
  for (let i = 0; i < 90; i++) g.update(1 / 60);
  g.world.props = [];
  g.world.pendingSpawns = [];
  g.world.enemies = g.world.enemies.slice(0, 1);
  g.world.loadout = { ...g.world.loadout, speed: 1, modules: { ...g.world.loadout.modules, weapon: module } };
  Object.assign(g.world.player, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, facing: 1, invulnerable: 0, state: 'idle' });
  const enemy = g.world.enemies[0]!;
  Object.assign(enemy, { kind: 'scout', scale: 1, x: target.x, y: target.y ?? 0, z: target.z ?? 0, vx: 0, vy: 0, vz: 0, invulnerable: 0, armor: 0, guard: 0, damage: 0, mount: 0, state: 'idle', attack: null });
  return { g, p: g.world.player, e: enemy, step: (i: Partial<InputFrame> = {}) => g.update(1 / 60, { ...EMPTY_INPUT, ...i }) };
}
const UP_TILT = { attack: true, moveZ: -1 } as const;
const DOWN_TILT = { attack: true, moveZ: 1 } as const;

describe('attack arcs: through the engine', () => {
  it.each(WEAPONS)('%s: an up tilt hits a scout standing in front in the same lane', (weapon) => {
    for (const module of MODULES) {
      const { p, e, step } = lab(weapon, module, FRONT);
      step(UP_TILT);
      expect(p.attack?.move?.direction, module).toBe('up');
      for (let i = 0; i < 60 && e.damage === 0; i++) step();
      expect(e.damage, `${weapon}/${module}`).toBeGreaterThan(0);
    }
  });

  it.each(WEAPONS)('%s: an up tilt hits a scout held directly overhead', (weapon) => {
    for (const module of MODULES) {
      const { p, e, step } = lab(weapon, module, OVERHEAD);
      const hold = () => Object.assign(e, { x: OVERHEAD.x, y: OVERHEAD.y, z: 0, vx: 0, vy: 0, vz: 0 });
      hold();
      step(UP_TILT);
      expect(p.attack?.move?.direction, module).toBe('up');
      for (let i = 0; i < 60 && e.damage === 0 && p.state === 'attack'; i++) {
        hold();
        step();
      }
      expect(e.damage, `${weapon}/${module}`).toBeGreaterThan(0);
    }
  });

  it.each(WEAPONS)('%s: a grounded down tilt pops its target upward, steeper than 45°', (weapon) => {
    for (const module of MODULES) {
      const { p, e, step } = lab(weapon, module, FRONT);
      step(DOWN_TILT);
      expect(p.attack?.move?.direction, module).toBe('down');
      for (let i = 0; i < 60 && e.damage === 0; i++) step();
      expect(e.damage, `${weapon}/${module}: connects`).toBeGreaterThan(0);
      // Read on the update that hit, before gravity touches it.
      expect(e.vy, `${weapon}/${module}: vy`).toBeGreaterThan(0);
      expect(e.vy, `${weapon}/${module}: vy vs |vx|`).toBeGreaterThan(Math.abs(e.vx));
    }
  });
});

/**
 * The owner's combo: a grounded down tilt connects on a fresh scout in front, the up tilt is
 * pressed on every frame from the hit (so it comes out on the first frame the hit-cancel allows),
 * and must connect while the scout is still in hitstun.
 */
function downIntoUp(weapon: WeaponId, module: Module, x = FRONT.x) {
  const { p, e, step } = lab(weapon, module, { x });
  step(DOWN_TILT);
  const down = p.attack!.move!;
  let frames = 0;
  while (frames < 60 && e.damage === 0) {
    step();
    frames++;
  }
  const first = { damage: e.damage, y: e.y, vy: e.vy, frame: frames };
  const cancelFrom = down.cancels.find((c) => c.on === 'hit' && c.actions.includes('attack'))!.from;
  let downFrameAtSwitch = -1;
  let upStartedAfter = -1;
  let secondHitAfter = -1;
  let stateAtSecondHit = '';
  let hitstunEnded = -1;
  for (let i = 1; i <= 90 && secondHitAfter < 0; i++) {
    const wasDown = p.attack?.move?.direction === 'down' ? p.attack.elapsed * 60 : -1;
    const stateBefore = e.state;
    step(p.attack?.move?.direction === 'up' ? {} : UP_TILT);
    if (upStartedAfter < 0 && p.attack?.move?.direction === 'up') {
      upStartedAfter = i;
      downFrameAtSwitch = wasDown;
    }
    if (hitstunEnded < 0 && e.state !== 'hurt') hitstunEnded = i;
    if (e.damage > first.damage) {
      secondHitAfter = i;
      stateAtSecondHit = stateBefore;
    }
  }
  return { down, first, cancelFrom, downFrameAtSwitch, upStartedAfter, secondHitAfter, stateAtSecondHit, hitstunEnded, target: { x: e.x, y: e.y } };
}

/**
 * Weapons whose up tilt would arrive after the scout has recovered. Empty since grounded down
 * normals hold their target for at least `POP_STUN`: before that, the breaker lance, cannon and
 * scythe (startup 11–13) landed 1–4 frames after a 15–16 frame hitstun had ended.
 */
const NOT_YET_A_COMBO: Record<string, string> = {};

describe('attack arcs: down tilt into up tilt (the owner\'s combo)', () => {
  const describeRun = (r: ReturnType<typeof downIntoUp>) =>
    JSON.stringify(r, (k, v) => (k === 'down' ? undefined : typeof v === 'number' ? Math.round(v * 1000) / 1000 : v));

  for (const module of MODULES)
    it.each(WEAPONS)(`%s/${module}: after a down tilt connects on a fresh scout in front, an up tilt buffered at the first legal frame also connects`, (weapon) => {
      const r = downIntoUp(weapon, module);
      const label = `${weapon}/${module}: ${describeRun(r)}`;
      expect(r.first.damage, `${label}: the down tilt connects`).toBeGreaterThan(0);
      expect(r.upStartedAfter, `${label}: the up tilt comes out`).toBeGreaterThan(0);
      // It came out on the first frame the hit-cancel allows (a frame of slack for the 60 Hz step).
      expect(r.downFrameAtSwitch, `${label}: switched at down-tilt frame`).toBeLessThanOrEqual(r.cancelFrom + 1);
      expect(r.secondHitAfter, `${label}: the up tilt connects`).toBeGreaterThan(0);
    });

  for (const module of MODULES)
    for (const weapon of WEAPONS) {
      const key = `${weapon}/${module}`;
      if (NOT_YET_A_COMBO[key]) {
        it.todo(`${key}: down tilt → up tilt is NOT yet a true combo — ${NOT_YET_A_COMBO[key]}`);
        continue;
      }
      it(`${key}: the up tilt connects while the scout is still in hitstun from the down tilt (a true combo)`, () => {
        const r = downIntoUp(weapon, module);
        expect(r.stateAtSecondHit, `${key}: ${describeRun(r)}`).toBe('hurt');
      });
    }
});
