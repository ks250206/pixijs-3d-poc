import { describe, expect, it } from 'vite-plus/test';
import type { AttackDirection, AttackKind, WeaponId } from '../src/game/types';
import { strikePose, track, type Strike } from '../src/render/rig/choreography';
import { CHANNELS, restPose, rigSpec, type Channel, type CorePose } from '../src/render/rig/skeleton';
import { rng } from './helpers/rig';

const STYLES: WeaponId[] = ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'];
const KINDS: AttackKind[] = ['jab', 'tilt', 'smash', 'dash', 'aerial', 'throw', 'special', 'enemy'];
const DIRECTIONS: AttackDirection[] = ['neutral', 'forward', 'back', 'up', 'down'];
const TRAJECTORIES: Strike['trajectory'][] = ['slash', 'thrust', 'orbit', 'burst'];
const NON_SPIN: Strike['trajectory'][] = ['slash', 'thrust'];
const PLANES: Strike['plane'][] = [null, 'vertical', 'level'];
const STANCE = restPose(rigSpec('player'));
/** Clock 0 … 3 in 0.05 steps, computed without accumulating error. */
const CLOCKS = Array.from({ length: 61 }, (_, i) => i / 20);

/** A grounded forward tilt with a level forward aim and no turn, unless overridden. */
const STRIKE: Strike = {
  style: 'arc', kind: 'tilt', direction: 'forward', trajectory: 'slash', plane: null, clock: 0, combo: 0,
  aim: { x: 0, y: 0, z: 1 }, turn: 0, extension: 0.75, duration: 0.4, charge: 0,
  airborne: false, main: 'R', ranged: false, travelling: false,
}; // prettier-ignore
const strike = (over: Partial<Strike> = {}): Strike => Object.assign({ ...STRIKE }, over);
const posed = (s: Strike, stance: CorePose = STANCE): CorePose => {
  const pose = { ...stance };
  strikePose(pose, s);
  return pose;
};

// ---------------------------------------------------------------------------------------------
// D. track
// ---------------------------------------------------------------------------------------------
describe('track: keyframe curve', () => {
  const r = rng(99);
  /** Random ascending key sets, including flat segments and negative values. */
  const keySets = Array.from({ length: 40 }, () => {
    const keys: [number, number][] = [];
    let t = r.range(-2, 1);
    for (let i = 0, n = 2 + Math.floor(r.range(0, 6)); i < n; i++) {
      keys.push([t, r.chance(0.15) && keys.length ? keys.at(-1)![1] : r.range(-3, 3)]);
      t += r.range(0.05, 1.5);
    }
    return keys;
  });
  keySets.push([[0, 0], [0.6, -0.07], [1, -0.021], [1.5, 0.13], [2.2, 0.091], [3, 0]]); // prettier-ignore
  keySets.push([[1, 5]]);

  it('holds the first value before the first key and the last value after the last', () => {
    for (const keys of keySets) {
      const first = keys[0]!,
        last = keys.at(-1)!;
      for (const before of [first[0] - 1e-9, first[0] - 1, -1e9]) expect(track(before, keys)).toBe(first[1]);
      for (const after of [last[0] + 1e-9, last[0] + 1, 1e9]) expect(track(after, keys)).toBe(last[1]);
    }
  });

  it('passes through every key', () => {
    for (const keys of keySets)
      for (const [t, v] of keys) expect(Math.abs(track(t, keys) - v), `key (${t}, ${v})`).toBeLessThanOrEqual(1e-15 * Math.max(1, Math.abs(v)));
  });

  it('is monotone between two consecutive keys and continuous at every key', () => {
    for (const keys of keySets)
      for (let i = 1; i < keys.length; i++) {
        const [t0, v0] = keys[i - 1]!,
          [t1, v1] = keys[i]!;
        const direction = Math.sign(v1 - v0);
        let previous = track(t0, keys);
        for (let k = 1; k <= 50; k++) {
          const value = track(t0 + ((t1 - t0) * k) / 50, keys);
          expect((value - previous) * direction, `segment ${i} step ${k}`).toBeGreaterThanOrEqual(-1e-15);
          if (direction === 0) expect(value).toBe(v0);
          expect(Math.min(v0, v1) - 1e-15 <= value && value <= Math.max(v0, v1) + 1e-15, `segment ${i} overshoots`).toBe(true);
          previous = value;
        }
      }
    for (const keys of keySets)
      for (const [t, v] of keys)
        for (const side of [-1e-9, 1e-9]) expect(Math.abs(track(t + side, keys) - v), `no jump at key ${t}`).toBeLessThan(1e-6);
  });
});

// ---------------------------------------------------------------------------------------------
// E. strikePose
// ---------------------------------------------------------------------------------------------
describe('strikePose: body motion laid over a stance', () => {
  it('every channel is finite for every style, kind, direction, trajectory, clock and flag', () => {
    const r = rng(5);
    const failures: string[] = [];
    let count = 0;
    const combos = new Set<string>();
    // Every style × direction × trajectory gets all 16 flag combinations (airborne, main hand,
    // ranged, travelling); the kind rotates with them, so every style × kind × direction ×
    // trajectory is covered twice. (The full 16 × 8 product is ~1 M poses and too slow for the suite.)
    for (const style of STYLES)
      for (const [d, direction] of DIRECTIONS.entries())
        for (const trajectory of TRAJECTORIES)
          for (let flags = 0; flags < 16; flags++) {
            const kind = KINDS[(flags + d) % KINDS.length]!;
            combos.add(`${style} ${kind} ${direction} ${trajectory}`);
            // Aims include straight up/down (no heading) and large unwrapped turns from spins.
            const aim = [{ x: 0, y: 0, z: 1 }, { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }, r.unit()][Math.floor(r.range(0, 4))]!;
            const base = strike({
              style, kind, direction, trajectory, aim, plane: PLANES[(flags + d) % PLANES.length] ?? null,
              turn: [0, Math.PI, -Math.PI * 2.5, r.range(-7, 7)][Math.floor(r.range(0, 4))]!,
              extension: r.range(0, 1.3), duration: r.range(0.03, 1.5), charge: r.range(0, 1),
              airborne: !!(flags & 1), main: flags & 2 ? 'L' : 'R', ranged: !!(flags & 4), travelling: !!(flags & 8),
            }); // prettier-ignore
            for (const clock of CLOCKS) {
              count++;
              const pose = posed({ ...base, clock });
              const bad = CHANNELS.filter((c) => !Number.isFinite(pose[c]));
              if (bad.length) failures.push(`${style} ${kind} ${direction} ${trajectory} flags ${flags} clock ${clock}: ${bad.join(', ')}`);
            }
          }
    expect(count).toBe(6 * 5 * 4 * 16 * 61);
    expect(combos.size).toBe(6 * 8 * 5 * 4);
    expect(failures.slice(0, 8)).toEqual([]);
  });

  /** Channels a strike must hand back untouched at its very start and end. */
  const BODY: Channel[] = [
    'hipX', 'hipY', 'hipZ', 'hipYaw', 'hipPitch', 'hipRoll', 'chestYaw', 'chestPitch', 'chestRoll',
    'footLX', 'footLY', 'footLZ', 'footRX', 'footRY', 'footRZ', 'footLPitch', 'footRPitch', 'plant',
  ]; // prettier-ignore
  /** A stance that is not the rest pose, so "unchanged" cannot pass by coincidence. */
  const OFF_REST: CorePose = (() => {
    const r = rng(11);
    const pose = { ...STANCE };
    for (const c of CHANNELS) if (c !== 'plant') pose[c] += r.range(-0.1, 0.1);
    return pose;
  })();

  function residue(trajectories: Strike['trajectory'][], skip: Channel[] = [], over: Partial<Strike> = {}) {
    const failures: string[] = [];
    for (const stance of [STANCE, OFF_REST])
      for (const style of STYLES)
        for (const trajectory of trajectories)
          for (const main of ['L', 'R'] as const)
            for (const clock of [0, 3]) {
              const pose = posed(strike({ style, trajectory, main, clock, ...over }), stance);
              for (const channel of BODY)
                if (!skip.includes(channel) && !(Math.abs(pose[channel] - stance[channel]) <= 1e-9))
                  failures.push(`${style} ${trajectory} main ${main} clock ${clock}: ${channel} ${pose[channel]} vs stance ${stance[channel]} (Δ ${(pose[channel] - stance[channel]).toExponential(2)})`);
            }
    return failures;
  }

  it('a grounded forward tilt (slash/thrust) leaves no residue: trunk, hips and feet are the stance at clock 0 and 3', () => {
    expect(residue(NON_SPIN).slice(0, 12)).toEqual([]);
  });

  it('a grounded spin (orbit/burst) leaves no residue either (its feet are released throughout, so `plant` is exempt)', () => {
    expect(residue(['orbit', 'burst'], ['plant']).slice(0, 12)).toEqual([]);
  });

  it('authored up/down arcs leave no residue: a vertical arc of any trajectory (it is never a spin) and a level low sweep', () => {
    const overhead = { x: 0, y: 0.6, z: -0.8 };
    for (const direction of ['up', 'down'] as const)
      expect(residue(TRAJECTORIES, [], { plane: 'vertical', direction, aim: overhead }).slice(0, 12), `vertical ${direction}`).toEqual([]);
    expect(residue(NON_SPIN, [], { plane: 'level', direction: 'down' }).slice(0, 12)).toEqual([]);
    expect(residue(['orbit', 'burst'], ['plant'], { plane: 'level', direction: 'down' }).slice(0, 12)).toEqual([]);
  });

  it('hips load back onto the rear foot around clock 0.6 and drive forward around clock 1.5, for every style', () => {
    for (const style of STYLES)
      for (const trajectory of NON_SPIN)
        for (const main of ['L', 'R'] as const) {
          const hipZ = (clock: number) => posed(strike({ style, trajectory, main, clock })).hipZ - STANCE.hipZ;
          const label = `${style} ${trajectory} main ${main}`;
          const load = Math.min(...[0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75].map(hipZ));
          const drive = Math.max(...[1.3, 1.4, 1.5, 1.6, 1.7].map(hipZ));
          expect(load, `${label}: loads back`).toBeLessThan(-0.01);
          expect(drive, `${label}: drives forward`).toBeGreaterThan(0.01);
        }
  });

  it('steps into the strike: the lead foot (opposite the main hand) is ahead of the rear foot through the hit', () => {
    for (const style of STYLES)
      for (const trajectory of NON_SPIN)
        for (const main of ['L', 'R'] as const) {
          const lead = main === 'R' ? 'L' : 'R';
          for (const clock of [1, 1.25, 1.5, 1.75, 2]) {
            const pose = posed(strike({ style, trajectory, main, clock }));
            expect(pose[`foot${lead}Z`] - pose[`foot${main}Z`], `${style} ${trajectory} main ${main} clock ${clock}`).toBeGreaterThan(0.05);
          }
        }
  });

  it('heavier weapons rebound more: pile recoils more than razor after the hit', () => {
    /**
     * Rebound measured as the chest pitch's excess travel over clock 2…3: total variation minus
     * net change. A monotone settle (the trend without recoil) contributes exactly 0, so whatever
     * remains is the bounce, without assuming the trend's shape.
     */
    const rebound = (style: WeaponId, trajectory: Strike['trajectory']) => {
      const values = Array.from({ length: 401 }, (_, i) => posed(strike({ style, trajectory, clock: 2 + i / 400 })).chestPitch);
      let travel = 0;
      for (let i = 1; i < values.length; i++) travel += Math.abs(values[i]! - values[i - 1]!);
      return travel - Math.abs(values.at(-1)! - values[0]!);
    };
    // Same trajectory for both, so only the weapon's weight differs.
    for (const trajectory of NON_SPIN) {
      const pile = rebound('pile', trajectory),
        razor = rebound('razor', trajectory);
      expect(pile, `pile rebounds visibly (${trajectory})`).toBeGreaterThan(0.005);
      expect(pile, `pile vs razor (${trajectory})`).toBeGreaterThan(razor);
    }
  });

  it('travelling strikes and spins release the feet', () => {
    for (const style of STYLES)
      for (const clock of CLOCKS)
        for (const airborne of [false, true]) {
          expect(posed(strike({ style, clock, airborne, travelling: true })).plant, `${style} travelling clock ${clock}`).toBe(0);
          if (!airborne)
            for (const trajectory of ['orbit', 'burst'] as const)
              expect(posed(strike({ style, clock, trajectory })).plant, `${style} ${trajectory} clock ${clock}`).toBe(0);
        }
    // And an ordinary grounded strike keeps them planted.
    for (const clock of CLOCKS) expect(posed(strike({ clock })).plant).toBe(STANCE.plant);
  });

  it('a ranged strike kicks the hips back after clock 1', () => {
    for (const style of STYLES)
      for (const trajectory of NON_SPIN) {
        const kick = (clock: number) => posed(strike({ style, trajectory, clock, ranged: true })).hipZ - posed(strike({ style, trajectory, clock })).hipZ;
        for (const clock of [0, 0.3, 0.6, 0.9, 0.99]) expect(Math.abs(kick(clock)), `${style} before the shot, clock ${clock}`).toBeLessThan(1e-12);
        expect(kick(1.05), `${style} ${trajectory}: kick right after the shot`).toBeLessThan(-0.05);
        for (const clock of [1.05, 1.2, 1.5, 2, 2.5]) expect(kick(clock), `${style} ${trajectory} clock ${clock}`).toBeLessThan(0);
      }
  });
});

// ---------------------------------------------------------------------------------------------
// F. strikePose for authored up/down arcs (`Strike.plane`)
// ---------------------------------------------------------------------------------------------
describe('strikePose: authored up/down arcs', () => {
  /** Rig-space aim at angle `theta` in the fighter's vertical plane: 0 forward (+Z), π/2 up, π behind. */
  const inPlane = (theta: number) => ({ x: 0, y: Math.sin(theta), z: Math.cos(theta) });
  /** The weapon style's own trajectory, as playerMove gives it. */
  const OWN: Record<WeaponId, Strike['trajectory']> = { arc: 'slash', pile: 'slash', razor: 'thrust', lance: 'thrust', cannon: 'thrust', scythe: 'orbit' };

  it('vertical plane with the turn of 0 the animator passes: no hip, chest or head yaw at any clock, for any trajectory, aim or hand', () => {
    const failures: string[] = [];
    for (const style of STYLES)
      for (const trajectory of TRAJECTORIES)
        for (const [direction, airborne] of [['up', false], ['up', true], ['down', true], ['down', false]] as const)
          for (const main of ['L', 'R'] as const)
            for (const theta of [-1.2, 0, 1, Math.PI / 2, 2.4, 3])
              for (const clock of CLOCKS) {
                const pose = posed(strike({ style, trajectory, plane: 'vertical', direction, airborne, main, kind: airborne ? 'aerial' : 'tilt', aim: inPlane(theta), turn: 0, clock }));
                for (const channel of ['hipYaw', 'chestYaw', 'headYaw'] as const)
                  if (pose[channel] !== STANCE[channel]) failures.push(`${style} ${trajectory} ${direction}${airborne ? ' air' : ''} main ${main} θ ${theta} clock ${clock}: ${channel} ${pose[channel]}`);
              }
    expect(failures.slice(0, 8)).toEqual([]);
  });

  it('vertical plane: the trunk bends back as the aim passes overhead and behind, forward as it sweeps underneath (monotone within the clamp)', () => {
    for (const style of STYLES)
      for (const kind of ['tilt', 'smash', 'aerial'] as const)
        for (const clock of [0.6, 1, 1.5, 2]) {
          const label = `${style} ${kind} clock ${clock}`;
          const at = (theta: number) => posed(strike({ style, kind, plane: 'vertical', direction: 'up', airborne: kind === 'aerial', aim: inPlane(theta), clock }));
          // Monotone across the clamp's range (−1.3 … 2.7 rad): further round, further back.
          const thetas = Array.from({ length: 41 }, (_, i) => -1.3 + (4 * i) / 40);
          const chest = thetas.map((t) => at(t).chestPitch),
            hips = thetas.map((t) => at(t).hipPitch);
          for (let i = 1; i < thetas.length; i++) {
            expect(chest[i]!, `${label}: chest at θ ${thetas[i]!.toFixed(2)}`).toBeLessThan(chest[i - 1]!);
            expect(hips[i]!, `${label}: hips at θ ${thetas[i]!.toFixed(2)}`).toBeLessThan(hips[i - 1]!);
          }
          // Against the same strike with a level forward aim (θ = 0, the null plane's neutral): back overhead, forward below.
          const level = at(0).chestPitch;
          expect(at(Math.PI / 2).chestPitch, `${label}: overhead`).toBeLessThan(level - 0.05);
          expect(at(2.5).chestPitch, `${label}: behind`).toBeLessThan(at(Math.PI / 2).chestPitch);
          expect(at(-1).chestPitch, `${label}: underneath`).toBeGreaterThan(level + 0.05);
          expect(level, `${label}: θ 0 is the plain strike`).toBeCloseTo(posed(strike({ style, kind, direction: 'up', airborne: kind === 'aerial', aim: inPlane(0), clock })).chestPitch, 12);
        }
  });

  it('level plane: a grounded down sweep sinks the hips lower than the same style\'s forward tilt (and than a grounded down slam)', () => {
    for (const style of STYLES) {
      const trajectory = OWN[style];
      const hipY = (over: Partial<Strike>, clock: number) => posed(strike({ style, trajectory, clock, ...over })).hipY;
      for (const clock of [1.2, 1.5, 1.8, 2.2]) {
        const sweep = hipY({ plane: 'level', direction: 'down', aim: { x: 0.6, y: -0.1, z: 0.8 } }, clock);
        const forward = hipY({ direction: 'forward' }, clock);
        const slam = hipY({ plane: 'vertical', direction: 'down', aim: inPlane(-0.5) }, clock);
        expect(sweep, `${style} clock ${clock}: sweep vs forward tilt`).toBeLessThan(forward - 0.03);
        expect(sweep, `${style} clock ${clock}: sweep vs slam`).toBeLessThan(slam - 0.03);
      }
      // An aerial down arc is not a mowing sweep: no extra sink in the air.
      expect(hipY({ plane: 'level', direction: 'down', airborne: true, kind: 'aerial' }, 1.5)).toBe(hipY({ plane: 'vertical', direction: 'down', airborne: true, kind: 'aerial' }, 1.5));
    }
  });

  it('an orbit (or burst) weapon swung in the vertical plane is not a spin: feet stay planted, the stance does not pivot, the body is posed exactly as a slash in that plane', () => {
    const failures: string[] = [];
    for (const style of STYLES)
      for (const trajectory of ['orbit', 'burst'] as const)
        for (const direction of ['up', 'down'] as const)
          for (const main of ['L', 'R'] as const)
            for (const clock of CLOCKS) {
              const over = { style, direction, main, clock, plane: 'vertical' as const, aim: inPlane(2), turn: 0 };
              const wheel = posed(strike({ ...over, trajectory }));
              const slash = posed(strike({ ...over, trajectory: 'slash' }));
              const where = `${style} ${trajectory} ${direction} main ${main} clock ${clock}`;
              if (wheel.plant !== STANCE.plant) failures.push(`${where}: plant ${wheel.plant}`);
              const differ = CHANNELS.filter((c) => !Object.is(wheel[c], slash[c]));
              if (differ.length) failures.push(`${where}: differs from a vertical slash in ${differ.join(', ')}`);
            }
    expect(failures.slice(0, 8)).toEqual([]);
    // The same weapon spun level (no plane) still is a spin: that is what the plane switches off.
    for (const style of STYLES) expect(posed(strike({ style, trajectory: 'orbit', clock: 1.5, turn: 2 })).plant, style).toBe(0);
  });
});
