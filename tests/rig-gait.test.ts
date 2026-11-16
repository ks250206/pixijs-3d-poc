import { describe, expect, it } from 'vite-plus/test';
import { FootPlanter, GAIT, toRig, toWorld, type RootFrame } from '../src/render/rig/gait';
import { distance, type V3 } from '../src/render/rig/math';
import { restPose, rigSpec } from '../src/render/rig/skeleton';
import { nonFinite, rng } from './helpers/rig';

const DT = 1 / 60;
const pose = restPose(rigSpec('player'));
const HOME_L: V3 = { x: pose.footLX, y: pose.footLY, z: pose.footLZ };
const HOME_R: V3 = { x: pose.footRX, y: pose.footRY, z: pose.footRZ };

interface Sample {
  root: RootFrame;
  L: V3;
  R: V3;
  plantedL: boolean;
  plantedR: boolean;
  moving: boolean;
}

/** Drives a planter frame by frame; `frame(i)` gives the root, homes and plant flag for frame i. */
function drive(
  frames: number,
  frame: (i: number) => { root: RootFrame; homeL?: V3; homeR?: V3; plant?: boolean },
  planter = new FootPlanter(GAIT.light),
): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < frames; i++) {
    const { root, homeL = HOME_L, homeR = HOME_R, plant = true } = frame(i);
    planter.advance(i === 0 ? 0 : DT, root);
    const feet = planter.place(root, homeL, homeR, plant);
    out.push({ root: { ...root }, L: { ...feet.L }, R: { ...feet.R }, plantedL: feet.plantedL, plantedR: feet.plantedR, moving: planter.moving });
  }
  return out;
}

/** World position of a rig-space sole. */
const world = (s: Sample, foot: V3) => toWorld(s.root, foot.x, foot.z);

/** Every planted stretch of a foot must keep one world position; returns violations and the stance count. */
function slides(samples: Sample[], side: 'L' | 'R') {
  const errors: string[] = [];
  let anchor: { x: number; z: number } | null = null;
  let stances = 0;
  samples.forEach((s, i) => {
    const planted = side === 'L' ? s.plantedL : s.plantedR;
    if (!planted) return void (anchor = null);
    const w = world(s, s[side]);
    if (!anchor) {
      anchor = w;
      stances++;
    } else {
      const slip = Math.hypot(w.x - anchor.x, w.z - anchor.z);
      if (slip > 1e-9) errors.push(`frame ${i}: ${side} slid ${slip}`);
    }
  });
  return { errors, stances };
}

describe('root frame conversion', () => {
  it('toRig and toWorld are inverses and match rig = Ry(-yaw)·(world − origin)/scale', () => {
    const r = rng(80);
    for (let i = 0; i < 200; i++) {
      const root = { x: r.range(-20, 20), z: r.range(-4, 4), yaw: r.range(-4, 4), scale: r.range(0.5, 3) };
      const x = r.range(-20, 20), z = r.range(-4, 4); // prettier-ignore
      const rig = toRig(root, x, z);
      const back = toWorld(root, rig.x, rig.z);
      expect(back.x).toBeCloseTo(x, 9);
      expect(back.z).toBeCloseTo(z, 9);
      // Facing +X (yaw π/2) puts world +X on rig +Z (forward).
      const ahead = toRig({ ...root, yaw: Math.PI / 2 }, root.x + root.scale, root.z);
      expect(ahead.z).toBeCloseTo(1, 12);
      expect(ahead.x).toBeCloseTo(0, 12);
    }
  });
});

describe('FootPlanter', () => {
  it('keeps both soles exactly at their homes while standing still', () => {
    for (const root of [{ x: 0, z: 0, yaw: Math.PI / 2, scale: 1 }, { x: 13.7, z: -2.1, yaw: -Math.PI / 2, scale: 2.65 }]) {
      const samples = drive(240, () => ({ root }));
      for (const s of samples) {
        expect(distance(s.L, HOME_L)).toBeLessThan(1e-12);
        expect(distance(s.R, HOME_R)).toBeLessThan(1e-12);
        expect(s.plantedL && s.plantedR).toBe(true);
      }
    }
  });

  it.each([
    ['forward at run speed', Math.PI / 2, 1, 6.2],
    ['facing left', -Math.PI / 2, 1, 6.2],
    ['a scaled heavy body walking', Math.PI / 2, 1.85, 2.5],
  ] as const)('never slides a planted foot while the root travels %s', (_, yaw, scale, speed) => {
    // Heading yaw ±π/2 travels along world ±X, i.e. straight ahead in the rig.
    const samples = drive(180, (i) => ({ root: { x: Math.sin(yaw) * speed * i * DT, z: 0, yaw, scale } }));
    expect(samples.some((s) => s.moving)).toBe(true);
    for (const side of ['L', 'R'] as const) {
      const { errors, stances } = slides(samples, side);
      expect(errors.slice(0, 5)).toEqual([]);
      expect(stances).toBeGreaterThanOrEqual(3);
    }
    expect(nonFinite(samples)).toEqual([]);
  });

  it('alternates the feet through the run cycle', () => {
    const samples = drive(180, (i) => ({ root: { x: 6.2 * i * DT, z: 0, yaw: Math.PI / 2, scale: 1 } }));
    // Touch-down order once the cycle is established.
    const landings: string[] = [];
    for (let i = 61; i < samples.length; i++)
      for (const side of ['L', 'R'] as const) {
        const key = side === 'L' ? 'plantedL' : 'plantedR';
        if (samples[i]![key] && !samples[i - 1]![key]) landings.push(side);
      }
    expect(landings.length).toBeGreaterThanOrEqual(4);
    for (let i = 1; i < landings.length; i++) expect(landings[i]).not.toBe(landings[i - 1]);
    for (const side of ['L', 'R'] as const) {
      const key = side === 'L' ? 'plantedL' : 'plantedR';
      expect(samples.slice(60).some((s) => s[key])).toBe(true);
      expect(samples.slice(60).some((s) => !s[key])).toBe(true);
    }
  });

  it.each([
    ['drifting slowly', (i: number) => ({ x: 0.6 * i * DT, z: 0.2 * i * DT, yaw: Math.PI / 2, scale: 1 })],
    ['turning slowly in place', (i: number) => ({ x: 0, z: 0, yaw: Math.PI / 2 - Math.min(1, i / 120) * (Math.PI / 2), scale: 1 })],
  ] as const)('steps one foot at a time while %s, without sliding', (_, root) => {
    const samples = drive(240, (i) => ({ root: root(i) }));
    expect(samples.every((s) => !s.moving)).toBe(true);
    for (const [i, s] of samples.entries()) expect(s.plantedL || s.plantedR, `frame ${i}`).toBe(true);
    for (const side of ['L', 'R'] as const) {
      const { errors, stances } = slides(samples, side);
      expect(errors.slice(0, 5)).toEqual([]);
      // Both feet actually stepped: the test is not vacuous.
      expect(stances).toBeGreaterThanOrEqual(2);
    }
    // Corrective steps keep the stance close to the pose.
    const last = samples.at(-1)!;
    expect(distance(last.L, HOME_L)).toBeLessThan(0.12);
    expect(distance(last.R, HOME_R)).toBeLessThan(0.12);
  });

  it('eases unplanted feet to the pose homes and back without popping', () => {
    const root = { x: 0, z: 0, yaw: Math.PI / 2, scale: 1 };
    const airL = { x: HOME_L.x, y: 0.34, z: 0.24 }, airR = { x: HOME_R.x, y: 0.16, z: -0.2 }; // prettier-ignore
    const phases = (i: number) => (i < 30 ? 'ground' : i < 90 ? 'air' : 'ground');
    const samples = drive(180, (i) => phases(i) === 'air' ? { root, homeL: airL, homeR: airR, plant: false } : { root }); // prettier-ignore
    const gap = Math.max(distance(HOME_L, airL), distance(HOME_R, airR));
    let largest = 0;
    for (let i = 1; i < samples.length; i++)
      for (const side of ['L', 'R'] as const) largest = Math.max(largest, distance(samples[i]![side], samples[i - 1]![side]));
    // No single-frame jump: a switch takes several frames (here at most ~45% of the gap per frame).
    expect(largest).toBeLessThan(0.45 * gap);
    expect(largest).toBeGreaterThan(0);
    // The take-off frame moves, but only part of the way.
    expect(distance(samples[30]!.L, HOME_L)).toBeGreaterThan(0);
    expect(distance(samples[30]!.L, airL)).toBeGreaterThan(0.5 * distance(HOME_L, airL));
    // Following converges on the homes...
    expect(distance(samples[89]!.L, airL)).toBeLessThan(1e-3);
    expect(distance(samples[89]!.R, airR)).toBeLessThan(1e-3);
    expect(samples[89]!.plantedL || samples[89]!.plantedR).toBe(false);
    // ...and landing re-plants both feet on the ground homes.
    const last = samples.at(-1)!;
    expect(last.plantedL && last.plantedR).toBe(true);
    expect(distance(last.L, HOME_L)).toBeLessThan(1e-9);
    expect(distance(last.R, HOME_R)).toBeLessThan(1e-9);
  });

  it('treats a teleport as a release, not a giant stride', () => {
    /** Farthest a sole gets from its home, and its largest per-frame move, from frame `from` on. */
    const extent = (samples: Sample[], from: number) => {
      let reach = 0, step = 0; // prettier-ignore
      for (let i = from; i < samples.length; i++)
        for (const side of ['L', 'R'] as const) {
          reach = Math.max(reach, distance(samples[i]![side], side === 'L' ? HOME_L : HOME_R));
          step = Math.max(step, distance(samples[i]![side], samples[i - 1]![side]));
        }
      return { reach, step };
    };
    for (const before of [0, 6.2]) {
      const steady = extent(drive(150, (i) => ({ root: { x: before * i * DT, z: 0, yaw: Math.PI / 2, scale: 1 } })), 60);
      const samples = drive(150, (i) => ({ root: { x: before * i * DT + (i >= 80 ? 100 : 0), z: 0, yaw: Math.PI / 2, scale: 1 } }));
      expect(nonFinite(samples)).toEqual([]);
      const jumped = extent(samples, 60);
      // No farther from the hips than ordinary running takes a foot, and no snap across the floor.
      expect(jumped.reach).toBeLessThanOrEqual(steady.reach + 0.05);
      expect(jumped.step).toBeLessThan(Math.max(0.25, steady.step * 2));
      if (before === 0) {
        // Standing: the feet re-plant where they were in the rig, at the new place.
        const s = samples.at(-1)!;
        expect(distance(s.L, HOME_L)).toBeLessThan(1e-9);
        expect(distance(s.R, HOME_R)).toBeLessThan(1e-9);
      }
    }
  });
});
