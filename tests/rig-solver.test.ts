import { describe, expect, it } from 'vite-plus/test';
import { MAX_EXTENSION, boneQuat, gripOnSegment, solveTwoBone } from '../src/render/rig/ik';
import {
  IDENTITY, add, angleDelta, cross, damp, distance, dot, length, normalize, quatFromBasis, quatMul, rotate, scale, sub,
  type Quat, type V3,
} from '../src/render/rig/math'; // prettier-ignore
import {
  CHANNELS, blendPose, restPose, rigSpec, solveRig,
  type CorePose, type Feet, type RigSpec, type WeaponConstraint,
} from '../src/render/rig/skeleton'; // prettier-ignore
import { nonFinite, rng, segmentDistance, stretchedBones } from './helpers/rig';

const near = (a: V3, b: V3) => distance(a, b);
const quatLength = (q: Quat) => Math.hypot(q.x, q.y, q.z, q.w);
/** Uniformly random rotation (Shoemake). */
const randomQuat = (r: ReturnType<typeof rng>): Quat => {
  const u1 = r.next(), u2 = r.next() * Math.PI * 2, u3 = r.next() * Math.PI * 2;
  const a = Math.sqrt(1 - u1), b = Math.sqrt(u1);
  return { x: a * Math.sin(u2), y: a * Math.cos(u2), z: b * Math.sin(u3), w: b * Math.cos(u3) };
}; // prettier-ignore
const EX = { x: 1, y: 0, z: 0 }, EY = { x: 0, y: 1, z: 0 }, EZ = { x: 0, y: 0, z: 1 }; // prettier-ignore

/** Where solveRig must put a planted, unpitched ankle. */
const ankleTarget = (spec: RigSpec, sole: V3): V3 => ({ x: sole.x, y: sole.y + spec.ankle, z: sole.z });
const restFeet = (spec: RigSpec, planted: boolean): Feet => {
  const pose = restPose(spec);
  return {
    L: { x: pose.footLX, y: pose.footLY, z: pose.footLZ },
    R: { x: pose.footRX, y: pose.footRY, z: pose.footRZ },
    plantedL: planted,
    plantedR: planted,
  };
};

describe('rig math', () => {
  it('composes quaternions so quatMul(a, b) applies b first', () => {
    const r = rng(1);
    for (let i = 0; i < 200; i++) {
      const a = randomQuat(r), b = randomQuat(r), v = r.vec(2); // prettier-ignore
      expect(near(rotate(quatMul(a, b), v), rotate(a, rotate(b, v)))).toBeLessThan(1e-12);
    }
  });

  it('quatFromBasis reproduces any proper rotation, in every trace branch', () => {
    const r = rng(2);
    const s = Math.SQRT1_2;
    // Half-turns hit the three negative-trace branches that random rotations rarely reach.
    const fixed: Quat[] = [
      IDENTITY, { x: 1, y: 0, z: 0, w: 0 }, { x: 0, y: 1, z: 0, w: 0 }, { x: 0, y: 0, z: 1, w: 0 },
      { x: s, y: s, z: 0, w: 0 }, { x: 0, y: s, z: s, w: 0 }, { x: s, y: 0, z: s, w: 0 },
    ]; // prettier-ignore
    for (const q of [...fixed, ...Array.from({ length: 300 }, () => randomQuat(r))]) {
      const out = quatFromBasis(rotate(q, EX), rotate(q, EY), rotate(q, EZ));
      expect(quatLength(out)).toBeCloseTo(1, 12);
      for (const axis of [EX, EY, EZ]) expect(near(rotate(out, axis), rotate(q, axis))).toBeLessThan(1e-9);
    }
  });

  it('angleDelta is the shortest signed difference in (-π, π]', () => {
    const r = rng(3);
    for (let i = 0; i < 500; i++) {
      const from = r.range(-20, 20), to = r.range(-20, 20); // prettier-ignore
      const d = angleDelta(from, to);
      expect(d).toBeGreaterThan(-Math.PI);
      expect(d).toBeLessThanOrEqual(Math.PI);
      expect(Math.cos(from + d - to)).toBeCloseTo(1, 9);
    }
    expect(angleDelta(3, -3)).toBeCloseTo(Math.PI * 2 - 6, 12);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - Math.PI * 2, 12);
  });

  it('damp is frame-rate independent and converges on the target', () => {
    const twoSteps = damp(damp(4, 1, 12, 1 / 120), 1, 12, 1 / 120);
    expect(twoSteps).toBeCloseTo(damp(4, 1, 12, 1 / 60), 12);
    expect(damp(4, 1, 12, 0)).toBe(4);
    expect(damp(4, 1, 12, 10)).toBeCloseTo(1, 12);
  });
});

describe('solveTwoBone', () => {
  it('keeps both bones rigid, reaches reachable targets and stops on the ray at max extension', () => {
    const r = rng(10);
    let reached = 0, overreached = 0; // prettier-ignore
    for (let i = 0; i < 2000; i++) {
      const root = r.vec(2), upper = r.range(0.2, 0.6), lower = r.range(0.2, 0.6); // prettier-ignore
      const total = upper + lower;
      const wanted = r.range(0, 1.6) * total;
      const target = add(root, scale(r.unit(), wanted));
      const pole = r.chance(0.05) ? { x: 0, y: 0, z: 0 } : r.vec(1);
      const out = solveTwoBone(root, target, upper, lower, pole);

      expect(nonFinite(out)).toEqual([]);
      expect(Math.abs(distance(root, out.mid) - upper)).toBeLessThan(1e-9);
      expect(Math.abs(distance(out.mid, out.end) - lower)).toBeLessThan(1e-9);
      const min = Math.abs(upper - lower) + total * (1 - MAX_EXTENSION);
      const max = total * MAX_EXTENSION;
      if (wanted >= min + 1e-9 && wanted <= max - 1e-9) {
        reached++;
        expect(near(out.end, target)).toBeLessThan(1e-9);
        expect(out.reached).toBe(true);
      } else if (wanted > max + 1e-9) {
        overreached++;
        expect(out.reached).toBe(false);
        expect(distance(root, out.end)).toBeCloseTo(max, 9);
        // Same direction as the target: on the root→target ray, not merely at the right distance.
        expect(near(normalize(sub(out.end, root)), normalize(sub(target, root)))).toBeLessThan(1e-9);
      }
    }
    expect(reached).toBeGreaterThan(500);
    expect(overreached).toBeGreaterThan(300);
  });

  it('bends the middle joint toward the pole, inside the root/target/pole plane', () => {
    const r = rng(11);
    for (let i = 0; i < 1000; i++) {
      const root = r.vec(1), target = add(root, scale(r.unit(), r.range(0.1, 0.7))); // prettier-ignore
      const pole = r.vec(1);
      const axis = normalize(sub(target, root));
      const polePerp = sub(pole, scale(axis, dot(pole, axis)));
      if (length(polePerp) < 1e-3) continue;
      const out = solveTwoBone(root, target, 0.37, 0.39, pole);
      const rel = sub(out.mid, root);
      const midPerp = sub(rel, scale(axis, dot(rel, axis)));
      expect(dot(midPerp, polePerp)).toBeGreaterThan(0);
      expect(length(cross(normalize(midPerp), normalize(polePerp)))).toBeLessThan(1e-9);
      expect(near(out.bend, normalize(polePerp))).toBeLessThan(1e-9);
    }
  });
});

describe('boneQuat', () => {
  it('maps the rest bone (hanging down, facing +Z) to the identity', () => {
    const q = boneQuat({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }, EZ);
    expect(Math.abs(q.w)).toBeCloseTo(1, 12);
    expect(Math.hypot(q.x, q.y, q.z)).toBeLessThan(1e-12);
    const shoulder = { x: 0.48, y: 1.42, z: 0 };
    const elbow = boneQuat(shoulder, sub(shoulder, { x: 0, y: 0.37, z: 0 }), EZ);
    expect(Math.abs(elbow.w)).toBeCloseTo(1, 12);
  });

  it('carries local -Y·length from `from` to `to` and faces local +Z toward `front`', () => {
    const r = rng(20);
    for (let i = 0; i < 1000; i++) {
      const from = r.vec(2), to = add(from, scale(r.unit(), r.range(0.05, 1.5))); // prettier-ignore
      const front = r.vec(1);
      const q = boneQuat(from, to, front);
      expect(quatLength(q)).toBeCloseTo(1, 12);
      const bone = distance(from, to);
      expect(near(add(from, rotate(q, { x: 0, y: -bone, z: 0 })), to)).toBeLessThan(1e-9);
      const along = normalize(sub(to, from));
      const frontPerp = sub(front, scale(along, dot(front, along)));
      if (length(frontPerp) > 1e-3) expect(near(rotate(q, EZ), normalize(frontPerp))).toBeLessThan(1e-9);
      // A proper rotation: local +X is +Y × +Z, never a mirror.
      expect(near(rotate(q, EX), cross(rotate(q, EY), rotate(q, EZ)))).toBeLessThan(1e-9);
    }
  });
});

describe('gripOnSegment', () => {
  it('stays on the allowed stretch and picks the reachable point nearest the wanted grip', () => {
    const r = rng(30);
    let reachable = 0, unreachable = 0; // prettier-ignore
    for (let i = 0; i < 1500; i++) {
      const a = r.vec(1), u = r.unit(), shoulder = r.vec(1.2); // prettier-ignore
      const reach = r.range(0.3, 1);
      const min = r.range(0, 1), max = min + r.range(0.05, 1.5); // prettier-ignore
      const wanted = r.range(-1, 3);
      const grip = gripOnSegment(a, u, shoulder, reach, wanted, min, max);

      expect(grip.s).toBeGreaterThanOrEqual(min);
      expect(grip.s).toBeLessThanOrEqual(max);
      expect(near(grip.point, add(a, scale(u, grip.s)))).toBeLessThan(1e-12);
      // The allowed point nearest the shoulder decides whether anything is reachable (convexity).
      const closest = Math.max(min, Math.min(max, dot(sub(shoulder, a), u)));
      const closestDistance = distance(add(a, scale(u, closest)), shoulder);
      if (closestDistance <= reach - 1e-9) {
        reachable++;
        expect(grip.miss, `case ${i}`).toBe(0);
        expect(distance(grip.point, shoulder)).toBeLessThanOrEqual(reach + 1e-12);
        for (let k = 0; k <= 400; k++) {
          const s = min + ((max - min) * k) / 400;
          if (distance(add(a, scale(u, s)), shoulder) <= reach)
            expect(Math.abs(grip.s - wanted)).toBeLessThanOrEqual(Math.abs(s - wanted) + 1e-9);
        }
      } else if (closestDistance > reach + 1e-9) {
        unreachable++;
        expect(grip.s).toBeCloseTo(closest, 9);
        expect(grip.miss).toBeCloseTo(closestDistance - reach, 9);
      }
    }
    expect(reachable).toBeGreaterThan(100);
    expect(unreachable).toBeGreaterThan(100);
  });
});

/** A pose anywhere in (and well beyond) the authored range: rigidity must hold for all of it. */
function wildPose(r: ReturnType<typeof rng>, spec: RigSpec): CorePose {
  const pose = restPose(spec);
  for (const channel of CHANNELS) pose[channel] += r.range(-1.5, 1.5);
  pose.plant = r.chance(0.5) ? 1 : 0;
  if (r.chance(0.1)) pose.elbowLX = pose.elbowLY = pose.elbowLZ = 0;
  return pose;
}
/** Plausible authored ranges: small trunk rotations, hands near the body. */
function plausiblePose(r: ReturnType<typeof rng>, spec: RigSpec): CorePose {
  const pose = restPose(spec);
  for (const c of ['hipYaw', 'hipPitch', 'hipRoll', 'chestYaw', 'chestPitch', 'chestRoll'] as const) pose[c] += r.range(-0.35, 0.35);
  pose.hipY += r.range(-0.15, 0.1);
  for (const c of ['handLX', 'handLY', 'handLZ', 'handRX', 'handRY', 'handRZ'] as const) pose[c] += r.range(-0.3, 0.3);
  return pose;
}

describe('solveRig', () => {
  it('never stretches a bone, for any pose, feet, weapon, aim or hand bias', () => {
    const r = rng(40);
    for (const kind of ['player', 'boss'] as const) {
      const spec = rigSpec(kind);
      for (let i = 0; i < 600; i++) {
        const pose = wildPose(r, spec);
        const feet: Feet = { L: r.vec(1.5), R: r.vec(1.5), plantedL: r.chance(0.6), plantedR: r.chance(0.6) };
        const a = r.vec(2);
        const weapon: WeaponConstraint | null = r.chance(0.5)
          ? {
              a, b: r.chance(0.05) ? { ...a } : add(a, scale(r.unit(), r.range(0, 4))),
              main: r.chance(0.5) ? 'R' : 'L', mainMin: r.range(0, 0.5), mainMax: r.range(0.4, 1.2),
              offSpacing: r.chance(0.5) ? r.range(-0.5, 0.5) : undefined,
            }
          : null; // prettier-ignore
        const aim = r.chance(0.3) ? { hand: r.chance(0.5) ? ('R' as const) : ('L' as const), toward: r.vec(3), extend: r.range(0, 1.3) } : null;
        const bias = r.chance(0.3) ? { L: r.vec(1), R: r.vec(1) } : null;
        const rig = solveRig(spec, pose, feet, weapon, aim, bias);
        expect(nonFinite(rig), `${kind} case ${i}`).toEqual([]);
        expect(stretchedBones(spec, rig), `${kind} case ${i}`).toEqual([]);
      }
    }
  });

  /**
   * Solves against a weapon and lists every way the main and off hands fail to hold it.
   * `short` is the solver's own report that the shaft is beyond what the body can reach
   * (`grip.miss > 0`): then the hand must be at full stretch, straight at the grip, exactly
   * that far from it — never silently somewhere else.
   */
  function holdFailures(spec: RigSpec, pose: CorePose, feet: Feet, weapon: WeaponConstraint) {
    const rig = solveRig(spec, pose, feet, weapon);
    const main: string[] = [], off: string[] = []; // prettier-ignore
    const mainHand = weapon.main === 'R' ? rig.handR : rig.handL;
    const offHand = weapon.main === 'R' ? rig.handL : rig.handR;
    const short = (rig.grip?.miss ?? 0) > 0;
    if (short) {
      const u = normalize(sub(weapon.b, weapon.a));
      const gripPoint = add(weapon.a, scale(u, rig.grip!.main));
      const shoulder = weapon.main === 'R' ? rig.upperArmR.p : rig.upperArmL.p;
      const reach = (spec.upperArm + spec.forearm) * MAX_EXTENSION;
      if (Math.abs(distance(mainHand, gripPoint) - rig.grip!.miss) > 1e-6) main.push(`hand is ${distance(mainHand, gripPoint).toFixed(4)} from the grip but miss reports ${rig.grip!.miss.toFixed(4)}`);
      if (Math.abs(distance(mainHand, shoulder) - reach) > 1e-6) main.push('short of the shaft without reaching at full stretch');
    } else {
      const hold = segmentDistance(mainHand, weapon.a, weapon.b);
      if (!(hold.distance < 1e-6)) main.push(`main hand ${hold.distance.toFixed(4)} off the shaft`);
      if (!(hold.along >= weapon.mainMin - 1e-6 && hold.along <= weapon.mainMax + 1e-6))
        main.push(`main grip ${hold.along.toFixed(4)} outside [${weapon.mainMin.toFixed(3)}, ${weapon.mainMax.toFixed(3)}]`);
    }
    if (!rig.grip || rig.grip.main < weapon.mainMin || rig.grip.main > weapon.mainMax) main.push(`grip.main ${rig.grip?.main}`);
    if (rig.grip?.off != null) {
      if (weapon.offSpacing === undefined) off.push('off grip without offSpacing');
      const offHold = segmentDistance(offHand, weapon.a, weapon.b);
      if (!(offHold.distance < 1e-6)) off.push(`off hand ${offHold.distance.toFixed(4)} off the shaft though grip.off = ${rig.grip.off.toFixed(4)}`);
    }
    main.push(...stretchedBones(spec, rig));
    return { rig, main, off, short };
  }

  /** Shafts that start around sampleWeapon's origin (0.3 in front, 1.15 high) with a margin, pointing anywhere. */
  function originCases() {
    const r = rng(50);
    const spec = rigSpec('player');
    return Array.from({ length: 800 }, () => {
      const pose = plausiblePose(r, spec);
      const feet = restFeet(spec, r.chance(0.7));
      const a = { x: r.range(-0.25, 0.25), y: r.range(0.95, 1.35), z: r.range(0.15, 0.55) };
      const b = add(a, scale(r.unit(), r.range(1, 3)));
      const mainMin = r.range(0.05, 0.4);
      const weapon: WeaponConstraint = {
        a, b, main: r.chance(0.5) ? 'R' : 'L', mainMin, mainMax: mainMin + r.range(0.2, 0.6),
        offSpacing: r.chance(0.6) ? (r.chance(0.5) ? 1 : -1) * r.range(0.2, 0.35) : undefined,
      }; // prettier-ignore
      return { spec, pose, feet, weapon, ...holdFailures(spec, pose, feet, weapon) };
    });
  }

  it('puts the main hand on a weapon shaft that starts at the weapon origin, shifting the trunk when needed', () => {
    const cases = originCases();
    const failures = cases.flatMap((c, i) => c.main.map((f) => `case ${i} planted=${c.feet.plantedL}: ${f}`));
    expect(failures.slice(0, 10)).toEqual([]);
    // With the feet free the trunk can always follow. Planted legs may make a contorted trunk
    // physically unable to reach; that must stay a rare, reported exception.
    expect(cases.filter((c) => c.short && !c.feet.plantedL)).toEqual([]);
    expect(cases.filter((c) => c.short).length).toBeLessThan(cases.length * 0.02);
    const shifted = cases.filter((c) => Math.abs(c.rig.hips.p.x - c.pose.hipX) + Math.abs(c.rig.hips.p.z - c.pose.hipZ) > 1e-9);
    expect(shifted.length).toBeGreaterThan(20);
  });

  it('puts the off hand exactly on the shaft whenever it reports an off grip', () => {
    const cases = originCases();
    const failures = cases.flatMap((c, i) => c.off.map((f) => `case ${i}: ${f}`));
    expect(failures.slice(0, 10)).toEqual([]);
    expect(cases.filter((c) => c.rig.grip?.off != null).length).toBeGreaterThan(100);
  });

  it('holds a shaft starting well in front at shoulder height when the feet are free, and reports the shortfall when planted legs cannot follow', () => {
    const spec = rigSpec('player');
    const r = rng(51);
    const failures: string[] = [];
    for (const planted of [false, true])
      for (let i = 0; i < 300; i++) {
        const a = { x: 0, y: 1.45, z: r.range(0.6, 0.9) };
        const u = r.unit();
        const weapon: WeaponConstraint = { a, b: add(a, scale(u, 2)), main: 'R', mainMin: 0.36, mainMax: 0.9 };
        const held = holdFailures(spec, restPose(spec), restFeet(spec, planted), weapon);
        const found = held.short && !planted ? ['short of the shaft although the feet are free'] : held.main;
        if (found.length)
          failures.push(`planted=${planted} a=(0, 1.45, ${a.z.toFixed(3)}) u=(${u.x.toFixed(3)}, ${u.y.toFixed(3)}, ${u.z.toFixed(3)}): ${found.join('; ')}`);
      }
    expect(failures.slice(0, 6)).toEqual([]);
  });

  it('does not move the trunk when the shaft is already within reach', () => {
    const spec = rigSpec('player');
    const r = rng(52);
    const moved: string[] = [];
    for (let i = 0; i < 200; i++) {
      const pose = restPose(spec);
      // The free hand asks for a grip beyond reach, so the grip lands on the reach boundary.
      pose.handRZ = r.range(1, 2);
      const a = { x: 0.48 + r.range(-0.1, 0.1), y: 1.2 + r.range(-0.1, 0.1), z: 0.2 };
      const weapon: WeaponConstraint = { a, b: add(a, { x: 0, y: 0, z: 3 }), main: 'R', mainMin: 0, mainMax: 3 };
      const rig = solveRig(spec, pose, restFeet(spec, false), weapon);
      const shift = distance(rig.hips.p, { x: pose.hipX, y: spec.hipsY + pose.hipY, z: pose.hipZ });
      if (shift > 1e-9) moved.push(`handRZ=${pose.handRZ} a=(${a.x}, ${a.y}, 0.2): hips moved ${shift.toFixed(4)}`);
      expect(segmentDistance(rig.handR, weapon.a, weapon.b).distance).toBeLessThan(1e-6);
    }
    expect(moved.slice(0, 4)).toEqual([]);
  });

  it('sinks the hips so planted ankles sit exactly on their soles instead of stretching the legs', () => {
    const r = rng(60);
    for (const kind of ['player', 'bruiser', 'boss'] as const) {
      const spec = rigSpec(kind);
      for (let i = 0; i < 400; i++) {
        const pose = restPose(spec);
        pose.hipY = r.range(-0.1, 0.5);
        for (const c of ['hipYaw', 'hipPitch', 'hipRoll'] as const) pose[c] = r.range(-0.3, 0.3);
        pose.hipX = r.range(-0.1, 0.1);
        pose.hipZ = r.range(-0.1, 0.1);
        const feet: Feet = {
          L: { x: r.range(-0.5, 0), y: r.range(0, 0.12), z: r.range(-0.35, 0.35) },
          R: { x: r.range(0, 0.5), y: r.range(0, 0.12), z: r.range(-0.35, 0.35) },
          plantedL: true,
          plantedR: true,
        };
        const rig = solveRig(spec, pose, feet);
        expect(near(rig.footL.p, ankleTarget(spec, feet.L)), `${kind} case ${i}`).toBeLessThan(1e-9);
        expect(near(rig.footR.p, ankleTarget(spec, feet.R)), `${kind} case ${i}`).toBeLessThan(1e-9);
        expect(rig.hips.p.y).toBeLessThanOrEqual(spec.hipsY + pose.hipY + 1e-12);
        expect(stretchedBones(spec, rig)).toEqual([]);
      }
    }
  });

  it('leaves the authored hip height alone when the legs already reach or the feet are not planted', () => {
    const spec = rigSpec('player');
    const pose = restPose(spec);
    pose.hipY = -0.1;
    const low = solveRig(spec, pose, restFeet(spec, true));
    expect(low.hips.p.y).toBe(spec.hipsY + pose.hipY);
    pose.hipY = 0.6;
    const free = solveRig(spec, pose, restFeet(spec, false));
    expect(free.hips.p.y).toBe(spec.hipsY + pose.hipY);
    // The dangling foot is simply out of reach; the leg stays rigid.
    expect(near(free.footL.p, ankleTarget(spec, restFeet(spec, false).L))).toBeGreaterThan(0.05);
    expect(stretchedBones(spec, free)).toEqual([]);
    const planted = solveRig(spec, pose, restFeet(spec, true));
    expect(planted.hips.p.y).toBeLessThan(spec.hipsY + pose.hipY - 0.1);
  });
});

describe('blendPose', () => {
  const r = rng(70);
  const randomPose = (): CorePose => {
    const pose = restPose(rigSpec('player'));
    for (const channel of CHANNELS) pose[channel] += r.range(-1, 1);
    return pose;
  };

  it('returns a at t=0 and b at t=1', () => {
    for (let i = 0; i < 50; i++) {
      const a = randomPose(), b = randomPose(); // prettier-ignore
      expect(blendPose(a, b, 0)).toEqual(a);
      const end = blendPose(a, b, 1);
      for (const channel of CHANNELS) {
        if (channel === 'hipYaw') expect(angleDelta(end.hipYaw, b.hipYaw)).toBeCloseTo(0, 12);
        else expect(end[channel]).toBeCloseTo(b[channel], 12);
      }
    }
  });

  it('writes into the provided output and leaves the inputs untouched', () => {
    const a = randomPose(), b = randomPose(), out = randomPose(); // prettier-ignore
    const before = { ...a };
    expect(blendPose(a, b, 0.5, out)).toBe(out);
    expect(a).toEqual(before);
    expect(out.hipX).toBeCloseTo((a.hipX + b.hipX) / 2, 12);
  });

  it('turns hip yaw the short way round, through π rather than 0', () => {
    for (const [from, to, via] of [[3, -3, Math.PI], [-3, 3, -Math.PI]] as const) {
      const a = { ...restPose(rigSpec('player')), hipYaw: from };
      const b = { ...a, hipYaw: to };
      let previous: number = from;
      for (let k = 0; k <= 20; k++) {
        const yaw = blendPose(a, b, k / 20).hipYaw;
        // Monotonic along the short arc, and never anywhere near facing 0.
        expect(Math.sign(yaw - previous) * Math.sign(via) >= 0).toBe(true);
        expect(Math.abs(angleDelta(0, yaw))).toBeGreaterThan(2.9);
        previous = yaw;
      }
      expect(angleDelta(blendPose(a, b, 0.5).hipYaw, via)).toBeCloseTo(0, 12);
    }
  });
});
