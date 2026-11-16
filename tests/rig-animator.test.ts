import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { sampleWeapon } from '../src/game/combat/geometry';
import { utilityMove } from '../src/game/combat/moves';
import { EMPTY_INPUT, type Actor, type ActorKind, type InputFrame, type WeaponId } from '../src/game/types';
import { RigAnimator, type RigFrame } from '../src/render/rig/animator';
import { distance } from '../src/render/rig/math';
import { joints, nonFinite, segmentDistance, stretchedBones, worldToRig } from './helpers/rig';

const WEAPONS: WeaponId[] = ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'];
/** How close the main hand must be to the authoritative shaft once the hit is live (rig units). */
const ON_WEAPON = 0.02;
/**
 * Per-frame joint travel limits (rig units) across state changes, from observed maxima plus headroom.
 * Any joint gets more room than the hands because world-anchored feet swing through rig space while
 * the body turns round (about 0.44 per frame on the first frame of a turn).
 */
const MAX_HAND_STEP = 0.45;
const MAX_HIPS_STEP = 0.2;
const MAX_JOINT_STEP = 0.6;

function lab(weapon: WeaponId, facing: 1 | -1 = 1) {
  const g = new GameEngine(41);
  g.start(createCandidates(41).find((l) => l.weapon === weapon)!, 'training');
  g.world.enemies = [];
  g.world.props = [];
  g.world.pendingSpawns = [];
  Object.assign(g.world.player, { invulnerable: 0, facing });
  return g;
}

/** Steps the engine and the animator together exactly as the renderer does, checking every frame. */
class Rig {
  readonly animator = new RigAnimator('player');
  readonly frames: RigFrame[] = [];
  readonly problems: string[] = [];
  /** Per frame: a readable context, and a key that changes whenever the animated state does. */
  readonly labels: string[] = [];
  readonly keys: string[] = [];
  private attackSerial = 0;
  private lastAttack: { ref: object | null; elapsed: number } = { ref: null, elapsed: 0 };
  /** Ticks on which the main hand was required to be (and was checked) on the shaft. */
  activeChecks = 0;
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
    const capsule = p.attack?.collision?.capsule ?? null;
    const frame = this.animator.update(p, g.world.time, g.world.loadout.weapon, capsule);
    const tick = this.frames.length;
    const where = `tick ${tick} ${p.state}${p.attack ? ` ${p.attack.move?.id ?? p.attack.name} f${(p.attack.elapsed * 60).toFixed(1)}` : ''}`;
    for (const bad of nonFinite(frame)) this.problems.push(`${where}: ${bad}`);
    for (const bad of stretchedBones(this.animator.spec, frame.rig)) this.problems.push(`${where}: ${bad}`);
    if (p.attack?.collision?.active) {
      if (!frame.weapon) this.problems.push(`${where}: active hit without a held weapon`);
      else {
        this.activeChecks++;
        const hand = frame.weapon.main === 'R' ? frame.rig.handR : frame.rig.handL;
        // Independent world → rig conversion of the authoritative capsule.
        const a = worldToRig(p, frame.yaw, p.attack.collision.capsule.a);
        const b = worldToRig(p, frame.yaw, p.attack.collision.capsule.b);
        const off = segmentDistance(hand, a, b).distance;
        if (!(off < ON_WEAPON)) this.problems.push(`${where}: main hand ${off.toFixed(4)} from the weapon`);
      }
    }
    // A new attack object, or the same one restarted, is a new state.
    if (p.attack && (p.attack !== this.lastAttack.ref || p.attack.elapsed < this.lastAttack.elapsed)) this.attackSerial++;
    this.lastAttack = { ref: p.attack, elapsed: p.attack?.elapsed ?? 0 };
    this.labels.push(where);
    this.keys.push(`${p.state}:${p.attack ? this.attackSerial : ''}:${p.y > 0.02 ? 'air' : 'ground'}`);
    this.frames.push(frame);
    return frame;
  }

  run(count: number, input: Partial<InputFrame> = {}, pin?: { y: number }) {
    for (let i = 0; i < count; i++) this.step(input, pin);
  }

  /**
   * Largest per-frame travel of the hands, the hips and any joint, with where it happened.
   * `only` restricts which frame indices are measured (the step into frame i is measured at i).
   */
  travel(only: (i: number) => boolean = () => true) {
    const worst = { hands: { d: 0, at: '' }, hips: { d: 0, at: '' }, any: { d: 0, at: '' } };
    for (let i = 1; i < this.frames.length; i++) {
      if (!only(i)) continue;
      const before = joints(this.frames[i - 1]!.rig), after = joints(this.frames[i]!.rig); // prettier-ignore
      for (const name of Object.keys(after)) {
        const d = distance(before[name]!, after[name]!);
        const at = `${name} ${d.toFixed(3)} into frame ${i} [${this.labels[i - 1]} → ${this.labels[i]}]`;
        if ((name === 'handL' || name === 'handR') && d > worst.hands.d) worst.hands = { d, at };
        if (name === 'hips' && d > worst.hips.d) worst.hips = { d, at };
        if (d > worst.any.d) worst.any = { d, at };
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
}

type Attack = { label: string; input: Partial<InputFrame>; air?: boolean; kind: string; direction: string };
const attacks = (facing: 1 | -1): Attack[] => [
  { label: 'neutral jab', input: { attack: true }, kind: 'jab', direction: 'neutral' },
  { label: 'forward tilt', input: { attack: true, moveX: facing }, kind: 'tilt', direction: 'forward' },
  { label: 'up tilt', input: { attack: true, moveZ: -1 }, kind: 'tilt', direction: 'up' },
  { label: 'down tilt', input: { attack: true, moveZ: 1 }, kind: 'tilt', direction: 'down' },
  { label: 'neutral aerial', input: { attack: true }, air: true, kind: 'aerial', direction: 'neutral' },
  { label: 'down aerial', input: { attack: true, moveZ: 1 }, air: true, kind: 'aerial', direction: 'down' },
];

describe('RigAnimator on live player attacks', () => {
  for (const weapon of WEAPONS)
    for (const facing of [1, -1] as const)
      it(`${weapon} facing ${facing}: rigid, finite, and the main hand rides the live weapon`, () => {
        const failures: string[] = [];
        for (const attack of attacks(facing)) {
          const rig = new Rig(lab(weapon, facing));
          const pin = attack.air ? { y: 3 } : undefined;
          rig.run(20, {}, pin);
          rig.step(attack.input, pin);
          const p = rig.player;
          expect(p.attack?.kind, attack.label).toBe(attack.kind);
          expect(p.attack?.direction, attack.label).toBe(attack.direction);
          const move = p.attack!.move!;
          for (let i = 0; i < 120 && p.state === 'attack'; i++) rig.step({}, pin);
          expect(p.state, attack.label).not.toBe('attack');
          rig.run(10, {}, pin);
          failures.push(...rig.problems.map((m) => `${attack.label}: ${m}`));
          // Every melee move has a live window that was actually checked; ranged cannon shots hold nothing.
          if (move.behavior === 'melee') expect(rig.activeChecks, attack.label).toBeGreaterThan(0);
          else expect(rig.frames.every((f) => f.weapon === null), attack.label).toBe(true);
        }
        expect(failures.slice(0, 8)).toEqual([]);
      });
});

describe('RigAnimator continuity', () => {
  /** Asserts the measured frames never jump, and that no frame was non-finite or stretched. */
  function expectSmooth(rig: Rig, only?: (i: number) => boolean) {
    expect(rig.problems.slice(0, 8)).toEqual([]);
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
      for (let i = 0; i < 120 && rig.player.state === 'attack'; i++) rig.step();
      rig.run(25);
    }
    // Mashed attack presses: buffered chains and jab combos.
    const seen = new Set<string>();
    for (let i = 0; i < 150; i++) {
      rig.step(i % 5 === 0 ? { attack: true, moveZ: i % 15 === 10 ? -1 : 0 } : {});
      if (rig.player.attack?.move) seen.add(rig.player.attack.move.id);
    }
    rig.run(60);
    expect(seen.size).toBeGreaterThanOrEqual(2);
    // Inside a move the authoritative weapon drives the hands (a scythe orbits a full turn in a few
    // frames), so continuity is measured across the state changes themselves.
    const transitions = rig.transitions();
    expect(transitions.size).toBeGreaterThan(10);
    expectSmooth(rig, (i) => transitions.has(i));
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
    bossPhase: kind === 'boss' ? 'armored' : null, phaseChanges: 0, tactic: '', id: `${kind}-1`, kind,
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
        if (out.weapon !== null) problems.push(`${label}: an enemy rig claimed a held weapon`);
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
