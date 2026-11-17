import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { sampleWeapon } from '../src/game/combat/geometry';
import { utilityMove } from '../src/game/combat/moves';
import { PIVOT_X, PIVOT_Y, WEAPON_REST } from '../src/game/combat/trajectory';
import { EMPTY_INPUT, type Actor, type ActorKind, type InputFrame, type WeaponId } from '../src/game/types';
import { RigAnimator, type RigFrame } from '../src/render/rig/animator';
import { distance, rotate, type V3 } from '../src/render/rig/math';
import { joints, nonFinite, rigToWorld, segmentDistance, stretchedBones, worldToRig } from './helpers/rig';

const WEAPONS: WeaponId[] = ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'];
/** How close the main hand must be to the authoritative shaft on hit frames (observed ~1e-16). */
const ON_WEAPON = 1e-6;
/** The held segment on a hit frame is the checked capsule, up to the world → rig conversion. */
const EXACT = 1e-9;
/**
 * The main hand never strays further than this from the weapon, even while easing onto it
 * (observed 0 for every weapon but razor: the other hands never leave the shaft).
 */
const MAX_HAND_OFF = 0.4;
/**
 * Razor claws alternate the leading hand with the combo stage while the weapon stays on one
 * centre line, so on a hand switch the newly leading hand starts up to ~0.7 away and eases on
 * during the wind-up (and the right hand eases back when the carry resumes). Observed 0.685.
 */
const MAX_HAND_OFF_RAZOR = 0.8;
/**
 * Per-frame joint travel limits (rig units) across locomotion state changes, from observed maxima
 * plus headroom. Any joint gets more room than the hands because world-anchored feet swing through
 * rig space while the body turns round (about 0.44 per frame on the first frame of a turn).
 */
const MAX_HAND_STEP = 0.45;
const MAX_HIPS_STEP = 0.2;
const MAX_JOINT_STEP = 0.6;
/**
 * Weapon-tip travel per frame: world metres, minus the actor's own displacement and minus what the
 * root turning under it (yaw easing, knockback tumble) accounts for. Calibrated on the sequences in
 * this file for all six weapons, with ~30% headroom:
 *
 * - Carried weapon (outside swings; also shots and unarmed moves): at most CARRY_TURN · length +
 *   CARRY_SHIFT. The largest steps are the hurt flinch (a 0.05 s blend), observed at ≈ 0.64 ·
 *   length + 0.15 for every weapon (lance 1.62, scythe 1.26, pile 0.99, arc 0.93, cannon 0.86,
 *   razor 0.48): about 0.6 rad of swing in one frame plus the chest's own travel.
 * - Swinging: the held tip may outrun the authoritative tip's own pace (its largest step over
 *   this frame and the two beside it; a wind-up can all but stall for a frame) by at most
 *   CATCH_STEP while it catches up from the carry before the hit frames. Observed ≈ 0.38 (razor
 *   down aerial, f3 of a 3-frame wind-up).
 * - On the frame an attack starts or ends, and the one after, the step may be at most OUTLIER ×
 *   the largest step around it (held or authoritative, ±3 frames, never below FLOOR so an idle
 *   neighbourhood is not a zero reference). Observed ≤ 1.23 (arc jab, second combo hit, start).
 */
const CARRY_TURN = 0.85;
const CARRY_SHIFT = 0.2;
const CATCH_STEP = 0.5;
const OUTLIER = 1.6;
const FLOOR = 0.3;
/** Behaviors whose held weapon is the carry (none, area) or a shot's barrel, not the swung capsule. */
const UNARMED = ['none', 'area', 'projectile', 'cannon', 'mortar'];

function lab(weapon: WeaponId, facing: 1 | -1 = 1) {
  const g = new GameEngine(41);
  g.start(createCandidates(41).find((l) => l.weapon === weapon)!, 'training');
  g.world.enemies = [];
  g.world.props = [];
  g.world.pendingSpawns = [];
  Object.assign(g.world.player, { invulnerable: 0, facing });
  return g;
}

/** What each frame left behind for the weapon-continuity checks. */
interface Sample {
  label: string;
  state: string;
  attack: boolean;
  /** Changes whenever a new attack begins (or one is restarted) and when attacking stops. */
  attackKey: string;
  actor: { x: number; y: number; z: number; scale: number };
  yaw: number;
  tumble: number;
  /** Held tip in rig space, and the held weapon's natural length in world metres. */
  tip: V3;
  length: number;
  /** The held weapon is the authoritative swing (not the carry, and not a shot's barrel). */
  swinging: boolean;
  /** The authoritative capsule's tip in world space, while attacking. */
  auth: V3 | null;
}


/** Steps the engine and the animator together exactly as the renderer does, checking every frame. */
class Rig {
  readonly animator = new RigAnimator('player');
  readonly frames: RigFrame[] = [];
  readonly samples: Sample[] = [];
  readonly problems: string[] = [];
  /**
   * Frames whose held weapon claimed `live` outside the hit frames. Kept apart from `problems` so
   * this one contract has its own test and does not mask the others.
   */
  readonly mislabelled: string[] = [];
  /** Per frame: a readable context, and a key that changes whenever the animated state does. */
  readonly labels: string[] = [];
  readonly keys: string[] = [];
  private attackSerial = 0;
  private lastAttack: { ref: object | null; elapsed: number } = { ref: null, elapsed: 0 };
  /** Ticks on which the held weapon was required to be (and was checked) the live capsule. */
  activeChecks = 0;
  /** Largest main-hand distance from the held weapon, and where. */
  worstHandOff = { d: 0, at: '' };
  constructor(readonly g: GameEngine) {}

  get player() {
    return this.g.world.player;
  }

  step(input: Partial<InputFrame> = {}, pin?: { y: number }): RigFrame {
    const { g } = this;
    const p = this.player;
    g.world.enemies = [];
    g.world.pendingSpawns = [];
    if (pin) Object.assign(p, { y: pin.y, vy: 0 });
    g.update(1 / 60, { ...EMPTY_INPUT, ...input });
    return this.observe();
  }

  /** Runs the animator on the engine's current state (as one rendered frame) and checks it. */
  observe(): RigFrame {
    const { g } = this;
    const p = this.player;
    const capsule = p.attack?.collision?.capsule ?? null;
    const frame = this.animator.update(p, g.world.time, g.world.loadout.weapon, capsule);
    const tick = this.frames.length;
    const where = `tick ${tick} ${p.state}${p.attack ? ` ${p.attack.move?.id ?? p.attack.name} f${(p.attack.elapsed * 60).toFixed(1)}` : ''}`;
    const problem = (message: string) => this.problems.push(`${where}: ${message}`);
    for (const bad of nonFinite(frame)) problem(bad);
    for (const bad of stretchedBones(this.animator.spec, frame.rig)) problem(bad);
    // A new attack object, or the same one restarted, is a new state.
    if (p.attack && (p.attack !== this.lastAttack.ref || p.attack.elapsed < this.lastAttack.elapsed)) this.attackSerial++;
    this.lastAttack = { ref: p.attack, elapsed: p.attack?.elapsed ?? 0 };

    const held = frame.held;
    if (!held || !frame.weapon) problem(`the player holds no weapon (held ${!!held}, constraint ${!!frame.weapon})`);
    else {
      const hand = frame.weapon.main === 'R' ? frame.rig.handR : frame.rig.handL;
      const off = segmentDistance(hand, held.a, held.b).distance;
      if (off > this.worstHandOff.d) this.worstHandOff = { d: off, at: where };
      // `easing` is the hand-easing offset the animator actually applied this frame (0: none).
      const easing = frame.easing[frame.weapon.main];
      if (easing === 0 && !(off < 1e-6)) problem(`main hand ${off.toExponential(2)} off the weapon with no easing in progress (grip miss ${frame.rig.grip?.miss})`);
      const limit = held.style === 'razor' ? MAX_HAND_OFF_RAZOR : MAX_HAND_OFF;
      if (!(off <= limit)) problem(`main hand ${off.toFixed(3)} off the weapon (> ${limit}; easing ${easing.toFixed(3)})`);
      if (p.attack?.collision?.active) {
        this.activeChecks++;
        // Independent world → rig conversion of the authoritative capsule.
        const a = worldToRig(p, frame.yaw, p.attack.collision.capsule.a);
        const b = worldToRig(p, frame.yaw, p.attack.collision.capsule.b);
        if (!held.live) problem('hit frame, but the held weapon is not marked live');
        if (!(distance(held.a, a) < EXACT && distance(held.b, b) < EXACT)) problem(`hit frame, but the held weapon is ${Math.max(distance(held.a, a), distance(held.b, b)).toExponential(2)} from the capsule`);
        const onCapsule = segmentDistance(hand, a, b).distance;
        if (!(onCapsule < ON_WEAPON)) problem(`main hand ${onCapsule.toExponential(2)} from the live capsule`);
      } else if (held.live) this.mislabelled.push(`${where}: not a hit frame, but the held weapon is marked live`);
      this.samples.push({
        label: where,
        state: p.state,
        attack: p.state === 'attack',
        attackKey: p.state === 'attack' ? `${this.attackSerial}` : '',
        actor: { x: p.x, y: p.y, z: p.z, scale: p.scale },
        yaw: frame.yaw,
        tumble: frame.tumble,
        tip: held.b,
        length: WEAPON_REST[held.style].length * p.scale,
        swinging: p.state === 'attack' && !!capsule && !UNARMED.includes(p.attack?.move?.behavior ?? 'none'),
        auth: p.state === 'attack' && capsule ? capsule.b : null,
      });
    }
    this.labels.push(where);
    this.keys.push(`${p.state}:${p.attack ? this.attackSerial : ''}:${p.y > 0.02 ? 'air' : 'ground'}`);
    this.frames.push(frame);
    return frame;
  }

  run(count: number, input: Partial<InputFrame> = {}, pin?: { y: number }) {
    for (let i = 0; i < count; i++) this.step(input, pin);
  }

  /** Steps until the current attack is over (bounded), then `after` more frames. */
  finishAttack(after = 0, input: Partial<InputFrame> = {}, pin?: { y: number }) {
    for (let i = 0; i < 180 && this.player.state === 'attack'; i++) this.step(input, pin);
    this.run(after, input, pin);
  }

  /**
   * Largest per-frame travel of the hands, the hips and any joint, with where it happened.
   * `only` restricts which frame indices are measured (the step into frame i is measured at i).
   */
  travel(only: (i: number) => boolean = () => true) {
    const worst = { hands: { d: 0, at: '' }, hips: { d: 0, at: '' }, any: { d: 0, at: '' }, body: { d: 0, at: '' } };
    for (let i = 1; i < this.frames.length; i++) {
      if (!only(i)) continue;
      const before = joints(this.frames[i - 1]!.rig), after = joints(this.frames[i]!.rig); // prettier-ignore
      for (const name of Object.keys(after)) {
        const d = distance(before[name]!, after[name]!);
        const at = `${name} ${d.toFixed(3)} into frame ${i} [${this.labels[i - 1]} → ${this.labels[i]}]`;
        if ((name === 'handL' || name === 'handR') && d > worst.hands.d) worst.hands = { d, at };
        if (name === 'hips' && d > worst.hips.d) worst.hips = { d, at };
        if (d > worst.any.d) worst.any = { d, at };
        // Hips and legs: the arms ride the weapon and, in a spin, so does the whole trunk above the hips.
        if (/^(hips|hip[LR]|knee|ankle)/.test(name) && d > worst.body.d) worst.body = { d, at };
      }
    }
    return worst;
  }

  /** Frames on which the animated state changed (new state, new or restarted attack, take-off / landing), and the one after. */
  transitions(): Set<number> {
    const out = new Set<number>();
    for (let i = 1; i < this.keys.length; i++)
      if (this.keys[i] !== this.keys[i - 1]) {
        out.add(i);
        out.add(i + 1);
      }
    return out;
  }

  /**
   * Per-frame weapon-tip travel in world space minus the actor's own displacement, less the part
   * the root turning (yaw easing, knockback tumble) accounts for by carrying last frame's tip round
   * with it; with the authoritative capsule tip's own travel alongside, while attacking.
   */
  tipSteps() {
    const s = this.samples;
    const out: { net: number; auth: number; swinging: boolean; length: number; state: string; label: string }[] = [];
    const world = (k: number, j = k) => rigToWorld(s[k]!.actor, s[k]!.yaw, s[j]!.tip, s[k]!.tumble);
    const minus = (p: V3, q: V3) => ({ x: p.x - q.x, y: p.y - q.y, z: p.z - q.z });
    for (let i = 0; i < s.length; i++) {
      if (i === 0) {
        out.push({ net: 0, auth: NaN, swinging: s[0]!.swinging, length: s[0]!.length, state: s[0]!.state, label: s[0]!.label });
        continue;
      }
      const shift = minus(s[i]!.actor, s[i - 1]!.actor);
      const travel = minus(minus(world(i), world(i - 1)), shift);
      // Where last frame's tip would be if only the root had turned under it.
      const turned = minus(minus(world(i, i - 1), world(i - 1)), shift);
      const sameAttack = s[i]!.swinging && s[i - 1]!.swinging && s[i]!.attackKey === s[i - 1]!.attackKey;
      out.push({
        net: Math.max(0, Math.hypot(travel.x, travel.y, travel.z) - Math.hypot(turned.x, turned.y, turned.z)),
        auth: sameAttack ? Math.hypot(...Object.values(minus(minus(s[i]!.auth!, s[i - 1]!.auth!), shift))) : NaN,
        swinging: s[i]!.swinging,
        length: s[i]!.length,
        state: s[i]!.state,
        label: s[i]!.label,
      });
    }
    return out;
  }

  /**
   * The weapon never teleports: bounded steps outside attacks, never much faster than the
   * authoritative weapon during them, and no outlier on the frames an attack starts or ends.
   */
  weaponJumps(): string[] {
    const steps = this.tipSteps();
    const out: string[] = [];
    for (let i = 1; i < steps.length; i++) {
      const { net, auth, length, label } = steps[i]!;
      if (Number.isFinite(auth)) {
        // The authoritative tip's own pace around this frame (its wind-up can stall for a frame).
        const pace = Math.max(...[i - 1, i, i + 1].map((j) => steps[j]?.auth ?? NaN).filter(Number.isFinite));
        if (!(net <= pace + CATCH_STEP)) out.push(`${label}: tip moved ${net.toFixed(3)}, the authoritative tip at most ${pace.toFixed(3)} around it`);
      } else if (!(net <= CARRY_TURN * length + CARRY_SHIFT))
        out.push(`${label}: tip moved ${net.toFixed(3)} (> ${CARRY_TURN} × its ${length} m length + ${CARRY_SHIFT})`);
    }
    const s = this.samples;
    for (let t = 1; t < s.length; t++) {
      if (s[t]!.attackKey === s[t - 1]!.attackKey) continue;
      const edge = new Set([t, t + 1]);
      for (const i of [...edge].filter((i) => i < steps.length)) {
        let reference = FLOOR;
        for (let j = Math.max(1, i - 3); j <= Math.min(steps.length - 1, i + 3); j++) {
          if (Number.isFinite(steps[j]!.auth)) reference = Math.max(reference, steps[j]!.auth);
          if (!edge.has(j)) reference = Math.max(reference, steps[j]!.net);
        }
        if (!(steps[i]!.net <= OUTLIER * reference))
          out.push(`${steps[i]!.label}: tip moved ${steps[i]!.net.toFixed(3)} as an attack ${s[t]!.attack ? 'starts' : 'ends'}, against at most ${reference.toFixed(3)} on the frames around it`);
      }
    }
    return out;
  }
}

/** Asserts the measured frames never jump, and that no frame was non-finite, stretched or dropped its weapon. */
function expectSound(rig: Rig) {
  expect(rig.problems.slice(0, 8)).toEqual([]);
  expect(rig.weaponJumps().slice(0, 8)).toEqual([]);
}

type Attack = { label: string; input: Partial<InputFrame>; air?: boolean; kind: string; direction: string };
const attacks = (facing: 1 | -1): Attack[] => [
  { label: 'neutral jab', input: { attack: true }, kind: 'jab', direction: 'neutral' },
  { label: 'forward tilt', input: { attack: true, moveX: facing }, kind: 'tilt', direction: 'forward' },
  { label: 'up tilt', input: { attack: true, moveZ: -1 }, kind: 'tilt', direction: 'up' },
  { label: 'down tilt', input: { attack: true, moveZ: 1 }, kind: 'tilt', direction: 'down' },
  // Smashes charge for a frame, then release on the next one (see `startAttack`).
  { label: 'up smash', input: { smash: true, moveZ: -1 }, kind: 'smash', direction: 'up' },
  { label: 'down smash', input: { smash: true, moveZ: 1 }, kind: 'smash', direction: 'down' },
  { label: 'neutral aerial', input: { attack: true }, air: true, kind: 'aerial', direction: 'neutral' },
  { label: 'up aerial', input: { attack: true, moveZ: -1 }, air: true, kind: 'aerial', direction: 'up' },
  { label: 'down aerial', input: { attack: true, moveZ: 1 }, air: true, kind: 'aerial', direction: 'down' },
];

/** Presses the attack's input; a smash is released (uncharged) on the next frame. */
function startAttack(rig: Rig, attack: Attack, pin?: { y: number }) {
  rig.step(attack.input, pin);
  if (rig.player.state === 'charge') rig.step({}, pin);
}

describe('RigAnimator on live player attacks', () => {
  for (const weapon of WEAPONS)
    for (const facing of [1, -1] as const)
      it(`${weapon} facing ${facing}: rigid, finite, always armed, and the weapon is the live capsule on hit frames`, () => {
        const failures: string[] = [];
        for (const attack of attacks(facing)) {
          const rig = new Rig(lab(weapon, facing));
          const pin = attack.air ? { y: 3 } : undefined;
          rig.run(20, {}, pin);
          startAttack(rig, attack, pin);
          const p = rig.player;
          expect(p.attack?.kind, attack.label).toBe(attack.kind);
          expect(p.attack?.direction, attack.label).toBe(attack.direction);
          const move = p.attack!.move!;
          rig.finishAttack(10, {}, pin);
          expect(p.state, attack.label).not.toBe('attack');
          failures.push(...rig.problems.map((m) => `${attack.label}: ${m}`));
          failures.push(...rig.weaponJumps().map((m) => `${attack.label}: ${m}`));
          // Every melee move has a live window that was actually checked; ranged cannon shots never go live.
          if (move.behavior === 'melee') expect(rig.activeChecks, attack.label).toBeGreaterThan(0);
          else expect(rig.frames.every((f) => f.held !== null && !f.held.live), attack.label).toBe(true);
        }
        expect(failures.slice(0, 8)).toEqual([]);
      });

  it.each(WEAPONS)('%s: held.live is true exactly on the hit frames (collision.active), never in wind-up or recovery', (weapon) => {
    const mislabelled: string[] = [];
    let live = 0;
    for (const attack of attacks(1)) {
      const rig = new Rig(lab(weapon));
      const pin = attack.air ? { y: 3 } : undefined;
      rig.run(20, {}, pin);
      startAttack(rig, attack, pin);
      rig.finishAttack(10, {}, pin);
      live += rig.frames.filter((f) => f.held?.live).length;
      mislabelled.push(...rig.mislabelled.map((m) => `${attack.label}: ${m}`));
    }
    expect(mislabelled.slice(0, 6), `${mislabelled.length} frames`).toEqual([]);
    if (weapon !== 'cannon') expect(live).toBeGreaterThan(0);
  });
});

describe('RigAnimator held weapon', () => {
  it.each(WEAPONS)('%s: idle carries the weapon at rest on the chest', (weapon) => {
    for (const facing of [1, -1] as const) {
      const rig = new Rig(lab(weapon, facing));
      rig.run(40);
      expect(rig.player.state).toBe('idle');
      for (const frame of rig.frames.slice(-10)) {
        const held = frame.held!;
        const along = { x: held.b.x - held.a.x, y: held.b.y - held.a.y, z: held.b.z - held.a.z };
        const length = Math.hypot(along.x, along.y, along.z);
        expect(held.style).toBe(weapon);
        expect(held.live).toBe(false);
        expect(Math.abs(length - WEAPON_REST[weapon].length)).toBeLessThan(1e-12);
        expect(Math.abs(Math.asin(along.y / length) - WEAPON_REST[weapon].angle)).toBeLessThan(0.06);
        expect(along.z, 'points forward').toBeGreaterThan(0);
        // It rides the chest, so it breathes with it.
        expect(distance(held.a, { x: 0, y: PIVOT_Y, z: PIVOT_X })).toBeLessThan(0.05);
      }
      expect(rig.problems).toEqual([]);
    }
  });

  it.each(['neutral jab', 'forward tilt'])('cannon %s: a shot points the barrel down the line of fire at its natural length, never live', (label) => {
    const rig = new Rig(lab('cannon'));
    rig.run(30);
    rig.step(attacks(1).find((a) => a.label === label)!.input);
    const p = rig.player;
    const move = p.attack!.move!;
    expect(move.behavior).toBe('cannon');
    let settled = 0;
    while (p.state === 'attack') {
      const frame = rig.frames.at(-1)!;
      const held = frame.held!;
      expect(held.live).toBe(false);
      if (p.attack!.elapsed >= 0.1) {
        settled++;
        const c = p.attack!.collision!.capsule;
        const a = worldToRig(p, frame.yaw, c.a), b = worldToRig(p, frame.yaw, c.b); // prettier-ignore
        const shot = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
        const barrel = { x: held.b.x - held.a.x, y: held.b.y - held.a.y, z: held.b.z - held.a.z };
        const ls = Math.hypot(shot.x, shot.y, shot.z), lb = Math.hypot(barrel.x, barrel.y, barrel.z); // prettier-ignore
        expect(Math.abs(lb - WEAPON_REST.cannon.length), rig.labels.at(-1)).toBeLessThan(1e-6);
        expect(distance({ x: shot.x / ls, y: shot.y / ls, z: shot.z / ls }, { x: barrel.x / lb, y: barrel.y / lb, z: barrel.z / lb }), rig.labels.at(-1)).toBeLessThan(1e-6);
      }
      rig.step();
    }
    expect(settled).toBeGreaterThan(20);
    rig.run(20);
    expectSound(rig);
  });

  it.each(WEAPONS)('%s: armed in every state (idle, run, jump, fall, dodge, charge, attack, throw, hurt)', (weapon) => {
    const rig = new Rig(lab(weapon));
    const g = rig.g;
    const p = rig.player;
    const seen = new Set<string>();
    const step = (input: Partial<InputFrame> = {}) => {
      rig.step(input);
      seen.add(p.state);
    };
    for (let i = 0; i < 30; i++) step();
    for (let i = 0; i < 20; i++) step({ moveX: 1 });
    step({ jump: true, jumpHeld: true });
    for (let i = 0; i < 80 && (p.y > 0 || i < 5); i++) step();
    for (let i = 0; i < 10; i++) step();
    step({ dodge: true });
    for (let i = 0; i < 40; i++) step();
    // Charge a smash, then release it.
    step({ smash: true, smashHeld: true });
    for (let i = 0; i < 20; i++) step({ smashHeld: true });
    for (let i = 0; i < 120 && p.state !== 'idle'; i++) step();
    // A grab with nobody in reach whiffs as a throw-kind attack.
    step({ grab: true });
    for (let i = 0; i < 60 && p.state !== 'idle'; i++) step();
    // Knocked back by an enemy (the engine's own hit routine), then recovering.
    const source: Actor = { ...p, id: 'test-enemy', kind: 'scout', x: p.x - 1, facing: 1, attack: null, state: 'attack' };
    expect(g['hit'](p, source, 12, 9, 0.1, 0.9, 1, 'enemy')).toBe(true);
    rig.observe();
    seen.add(p.state);
    for (let i = 0; i < 150 && p.state !== 'idle'; i++) step();
    for (let i = 0; i < 20; i++) step();
    for (const state of ['idle', 'run', 'jump', 'fall', 'dodge', 'charge', 'attack', 'hurt']) expect([...seen], state).toContain(state);
    expectSound(rig);
  });
});

describe('RigAnimator trunk after a strike', () => {
  /** Heading of the hips about +Y in rig space (0 = facing forward), wrapped to (−π, π]. */
  const hipsHeading = (f: RigFrame) => {
    const forward = rotate(f.rig.hips.q, { x: 0, y: 0, z: 1 });
    return Math.atan2(forward.x, forward.z);
  };

  it.each(WEAPONS)('%s: every strike hands the body back facing forward (no whirl round once it is over)', (weapon) => {
    const failures: string[] = [];
    const inputs: [string, Partial<InputFrame>][] = [
      ['neutral jab', { attack: true }], ['forward tilt', { attack: true, moveX: 1 }], ['up tilt', { attack: true, moveZ: -1 }],
      ['down tilt', { attack: true, moveZ: 1 }], ['back tilt', { attack: true, moveX: -1 }], ['forward smash', { smash: true, moveX: 1 }],
    ]; // prettier-ignore
    for (const [label, input] of inputs) {
      const rig = new Rig(lab(weapon));
      rig.run(30);
      rig.step(input);
      for (let i = 0; i < 40 && rig.player.state !== 'attack'; i++) rig.step(); // a smash charges first
      expect(rig.player.state, label).toBe('attack');
      rig.finishAttack();
      // The attack's last frame: its weapon is back at rest, in front.
      let last = rig.keys.length - 1;
      while (last > 0 && !rig.keys[last]!.startsWith('attack')) last--;
      const heading = hipsHeading(rig.frames[last]!);
      if (!(Math.abs(heading) < 0.35)) failures.push(`${label}: ${rig.labels[last]} hips face ${heading.toFixed(2)} rad from forward`);
    }
    expect(failures).toEqual([]);
  });

  /** Heading of the solved chest about +Y in rig space: the hips' yaw and the chest's own yaw together. */
  const chestHeading = (f: RigFrame) => {
    const forward = rotate(f.rig.chest.q, { x: 0, y: 0, z: 1 });
    return Math.atan2(forward.x, forward.z);
  };

  for (const facing of [1, -1] as const)
    it.each(WEAPONS)(`%s facing ${facing}: a vertical-plane up attack (tilt, smash, aerial) swings over and behind the head without yawing the trunk round`, (weapon) => {
      const failures: string[] = [];
      for (const attack of attacks(facing).filter((a) => a.direction === 'up')) {
        const rig = new Rig(lab(weapon, facing));
        const pin = attack.air ? { y: 3 } : undefined;
        rig.run(20, {}, pin);
        startAttack(rig, attack, pin);
        expect(rig.player.attack?.move?.shape.arc?.plane, attack.label).toBe('vertical');
        const first = rig.frames.length - 1;
        rig.finishAttack(0, {}, pin);
        const during = rig.frames.slice(first).filter((_, i) => rig.keys[first + i]!.startsWith('attack'));
        expect(during.length, attack.label).toBeGreaterThan(10);
        // The weapon really does pass behind and above the head…
        const behind = during.filter((f) => f.held && f.held.b.z < f.rig.head.p.z && f.held.b.y > f.rig.head.p.y);
        if (!behind.length) failures.push(`${attack.label}: the weapon never passed behind and above the head`);
        // …and the trunk stays facing forward all the same.
        const worstChest = Math.max(...during.map((f) => Math.abs(chestHeading(f))));
        const hips = during.map((f) => {
          const forward = rotate(f.rig.hips.q, { x: 0, y: 0, z: 1 });
          return Math.abs(Math.atan2(forward.x, forward.z));
        });
        if (!(worstChest < 0.35)) failures.push(`${attack.label}: hips + chest yaw reached ${worstChest.toFixed(3)} rad`);
        if (!(Math.max(...hips) < 0.35)) failures.push(`${attack.label}: hips yaw reached ${Math.max(...hips).toFixed(3)} rad`);
        failures.push(...rig.problems.map((m) => `${attack.label}: ${m}`));
      }
      expect(failures).toEqual([]);
    });
});

describe('RigAnimator continuity', () => {
  /** Asserts the measured frames never jump, and that no frame was non-finite or stretched. */
  function expectSmooth(rig: Rig, only?: (i: number) => boolean) {
    expectSound(rig);
    const t = rig.travel(only);
    expect(t.hands.d, t.hands.at).toBeLessThan(MAX_HAND_STEP);
    expect(t.hips.d, t.hips.at).toBeLessThan(MAX_HIPS_STEP);
    expect(t.any.d, t.any.at).toBeLessThan(MAX_JOINT_STEP);
  }

  it.each(WEAPONS)('%s: idle → run → jump → land → turn → idle', (weapon) => {
    const rig = new Rig(lab(weapon));
    rig.run(30);
    rig.run(40, { moveX: 1 });
    expect(rig.player.state).toBe('run');
    rig.step({ moveX: 1, jump: true, jumpHeld: true });
    rig.run(8, { moveX: 1, jumpHeld: true });
    expect(rig.player.y).toBeGreaterThan(0.2);
    for (let i = 0; i < 120 && rig.player.y > 0; i++) rig.step({ moveX: 1 });
    expect(rig.player.y).toBe(0);
    rig.run(20);
    rig.run(30, { moveX: -1 });
    rig.run(40);
    expectSmooth(rig);
  });

  it.each(WEAPONS)('%s: idle → attack → idle and chained attacks', (weapon) => {
    const rig = new Rig(lab(weapon));
    rig.run(30);
    // Single attacks separated by idle.
    for (const input of [{ attack: true }, { attack: true, moveZ: -1 }, { attack: true, moveX: 1 }]) {
      rig.step(input);
      rig.finishAttack(25);
    }
    // Mashed attack presses: buffered chains and jab combos.
    const seen = new Set<string>();
    for (let i = 0; i < 150; i++) {
      rig.step(i % 5 === 0 ? { attack: true, moveZ: i % 15 === 10 ? -1 : 0 } : {});
      if (rig.player.attack?.move) seen.add(rig.player.attack.move.id);
    }
    rig.run(60);
    expect(seen.size).toBeGreaterThanOrEqual(2);
    expectSound(rig);
    // Inside a move the authoritative weapon drives the hands (a scythe orbits a full turn in a few
    // frames, and its spin takes the trunk round with it), so arms and shoulders may move fast; the
    // weapon checks above cover them. The hips and legs must still not jump across the state changes.
    const transitions = rig.transitions();
    expect(transitions.size).toBeGreaterThan(10);
    const t = rig.travel((i) => transitions.has(i));
    expect(t.hips.d, t.hips.at).toBeLessThan(MAX_HIPS_STEP);
    expect(t.body.d, t.body.at).toBeLessThan(MAX_JOINT_STEP);
  });

  it.each(WEAPONS)('%s: attack → run, and jump → aerial → land', (weapon) => {
    const rig = new Rig(lab(weapon));
    rig.run(30);
    // Run out of an attack's recovery.
    rig.step({ attack: true, moveX: 1 });
    rig.finishAttack(40, { moveX: 1 });
    expect(rig.player.state).toBe('run');
    rig.run(30);
    // Jump, attack at the apex, fall and land.
    rig.step({ jump: true, jumpHeld: true });
    rig.run(6, { jumpHeld: true });
    rig.step({ attack: true });
    expect(rig.player.attack?.kind).toBe('aerial');
    for (let i = 0; i < 150 && (rig.player.y > 0 || rig.player.state === 'attack'); i++) rig.step();
    rig.run(30);
    expectSound(rig);
    const transitions = rig.transitions();
    const t = rig.travel((i) => transitions.has(i));
    expect(t.hips.d, t.hips.at).toBeLessThan(MAX_HIPS_STEP);
    expect(t.body.d, t.body.at).toBeLessThan(MAX_JOINT_STEP);
  });

  it.each(WEAPONS)('%s: second combo hit (razor leads with the left) → idle, and an aerial on the same combo stage → fall → land', (weapon) => {
    const rig = new Rig(lab(weapon));
    rig.run(30);
    rig.step({ attack: true });
    rig.finishAttack();
    rig.step({ attack: true });
    expect(rig.player.attack?.combo).toBe(1);
    rig.finishAttack(30);
    // The combo stage persists, so this aerial is thrown on stage 1 as well.
    rig.step({ jump: true, jumpHeld: true });
    rig.run(4, { jumpHeld: true });
    rig.step({ attack: true });
    expect(rig.player.attack?.kind).toBe('aerial');
    expect(rig.player.attack?.combo).toBe(1);
    rig.finishAttack();
    for (let i = 0; i < 150 && rig.player.y > 0; i++) rig.step();
    rig.run(30);
    expectSound(rig);
  });

  it('holds the pose on a paused clock', () => {
    const g = lab('lance');
    const rig = new Rig(g);
    const checkpoints: (() => void)[] = [
      () => rig.run(30),
      () => rig.run(20, { moveX: 1 }),
      () => {
        rig.step({ attack: true });
        rig.run(6);
      },
      () => rig.run(4, { moveX: -1 }),
    ];
    for (const advance of checkpoints) {
      advance();
      const p = g.world.player;
      const again = rig.animator.update(p, g.world.time, g.world.loadout.weapon, p.attack?.collision?.capsule ?? null);
      expect(again).toEqual(rig.frames.at(-1));
      const thrice = rig.animator.update(p, g.world.time, g.world.loadout.weapon, p.attack?.collision?.capsule ?? null);
      expect(thrice).toEqual(again);
    }
  });
});

describe('RigAnimator turning', () => {
  it.each([
    [1, -1],
    [-1, 1],
  ] as const)('eases yaw through the camera side when facing flips %s → %s', (from, to) => {
    const rig = new Rig(lab('arc', from));
    rig.run(30);
    const start = rig.frames.at(-1)!.yaw;
    expect(start).toBe((from * Math.PI) / 2);
    const yaws: number[] = [];
    for (let i = 0; i < 60; i++) {
      rig.step(i < 3 ? { moveX: to } : {});
      if (i === 0) expect(rig.player.facing).toBe(to);
      yaws.push(rig.frames.at(-1)!.yaw);
    }
    const target = (to * Math.PI) / 2;
    // Not a snap: the first frame is only part of the way, and it takes several frames.
    expect(Math.abs(yaws[0]! - start)).toBeGreaterThan(0);
    expect(Math.abs(yaws[0]! - start)).toBeLessThan(Math.PI * 0.75);
    const settled = yaws.findIndex((y) => y === target);
    expect(settled).toBeGreaterThanOrEqual(4);
    expect(settled).toBeLessThan(40);
    // Monotonic from start to target, crossing 0 (facing the camera) rather than going round the back.
    let previous = start;
    for (const yaw of yaws) {
      expect((yaw - previous) * to).toBeGreaterThanOrEqual(0);
      expect(Math.abs(yaw)).toBeLessThanOrEqual(Math.PI / 2);
      previous = yaw;
    }
    expect(yaws.some((y) => Math.abs(y) < 0.6)).toBe(true);
    expect(yaws.slice(settled).every((y) => y === target)).toBe(true);
    expect(rig.problems).toEqual([]);
  });
});

describe('RigAnimator on enemy rigs', () => {
  const KINDS: ActorKind[] = ['scout', 'bruiser', 'gunner', 'sentinel', 'charger', 'leaper', 'artillery', 'rider', 'captain', 'minion', 'sniper', 'sapper', 'warden', 'boss'];
  const SCALE: Partial<Record<ActorKind, number>> = { boss: 2.65, warden: 1.85, bruiser: 1.25, minion: 0.58 };
  const enemy = (kind: ActorKind): Actor => ({
    bossPhase: kind === 'boss' ? 'armored' : null, phaseChanges: 0, form: 'default', tactic: '', id: `${kind}-1`, kind,
    x: 4, y: 0, z: 0.5, vx: 0, vy: 0, vz: 0, facing: -1, damage: 0, armor: 0,
    guard: kind === 'sentinel' ? 40 : 0, mount: kind === 'rider' ? 30 : 0, leaderId: null, alive: true,
    state: 'idle', stateTime: 0, invulnerable: 0, scale: SCALE[kind] ?? 1, attack: null, telegraph: 0, aim: null,
  }); // prettier-ignore

  for (const kind of KINDS)
    it(`${kind}: finite rigid frames while idle, walking, attacking (melee and ranged) and hurt`, () => {
      const actor = enemy(kind);
      const animator = new RigAnimator(kind);
      let time = 10;
      const problems: string[] = [];
      const frame = (label: string) => {
        time += 1 / 60;
        actor.stateTime += 1 / 60;
        const capsule = actor.attack?.move ? sampleWeapon(actor, actor.attack.move, actor.attack.elapsed * 60) : null;
        const out = animator.update(actor, time, 'arc', capsule);
        for (const bad of [...nonFinite(out), ...stretchedBones(animator.spec, out.rig)]) problems.push(`${label} t=${time.toFixed(3)}: ${bad}`);
        if (out.weapon !== null || out.held !== null) problems.push(`${label}: an enemy rig claimed a held weapon`);
        return out;
      };
      for (let i = 0; i < 30; i++) frame('idle');
      Object.assign(actor, { state: 'run', vx: -3 });
      for (let i = 0; i < 30; i++) {
        actor.x += actor.vx / 60;
        frame('run');
      }
      Object.assign(actor, { vx: 0 });
      for (const behavior of ['melee', 'projectile'] as const) {
        const move = utilityMove(`enemy.${behavior}`, behavior.toUpperCase(), 'enemy', 'forward', 0.6, 2.2, { startup: 12, end: 21, behavior });
        actor.state = 'attack';
        actor.aim = behavior === 'projectile' ? { x: actor.x - 6, y: 0, z: 0 } : null;
        actor.attack = {
          move, name: move.name, kind: 'enemy', direction: 'forward', elapsed: 0, duration: 0.6, range: 2.2,
          charge: 0, activeStart: 12 / 60, activeEnd: 21 / 60, combo: 0,
        }; // prettier-ignore
        for (let i = 0; i < 36; i++) {
          frame(`${behavior} attack`);
          actor.attack.elapsed += 1 / 60;
        }
        Object.assign(actor, { state: 'idle', attack: null, aim: null });
        for (let i = 0; i < 20; i++) frame('recover');
      }
      Object.assign(actor, { state: 'hurt', vx: 6, vy: 4, y: 0.5 });
      for (let i = 0; i < 20; i++) {
        actor.x += actor.vx / 60;
        actor.y = Math.max(0, actor.y + actor.vy / 60);
        actor.vy -= 30 / 60;
        frame('hurt');
      }
      expect(problems.slice(0, 8)).toEqual([]);
    });
});
