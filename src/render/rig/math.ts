/** Renderer-free vector/quaternion helpers for the CPU rig. Right-handed, +Y up. */
export interface V3 {
  x: number;
  y: number;
  z: number;
}
export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export const v3 = (x = 0, y = 0, z = 0): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a: V3, b: V3): V3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a: V3, s: number): V3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a: V3, b: V3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: V3, b: V3): V3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const length = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const distance = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerp = (a: V3, b: V3, t: number): V3 => ({
  x: mix(a.x, b.x, t),
  y: mix(a.y, b.y, t),
  z: mix(a.z, b.z, t),
});
export const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value));
export const clamp01 = (value: number): number => clamp(value, 0, 1);
export const smooth = (value: number): number => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

/** Unit vector, or `fallback` when the input is too short to have a direction. */
export function normalize(a: V3, fallback: V3 = { x: 0, y: 1, z: 0 }): V3 {
  const l = length(a);
  return l > 1e-9 ? scale(a, 1 / l) : { ...fallback };
}

/** Component of `a` perpendicular to unit `axis`, normalized; `fallback` covers the parallel case. */
export function reject(a: V3, axis: V3, fallback: V3): V3 {
  const r = sub(a, scale(axis, dot(a, axis)));
  if (length(r) > 1e-6) return normalize(r);
  const f = sub(fallback, scale(axis, dot(fallback, axis)));
  if (length(f) > 1e-6) return normalize(f);
  // Both hints are parallel to the axis: any perpendicular is as good as another.
  return normalize(cross(axis, Math.abs(axis.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 0, z: 1 }));
}

export const IDENTITY: Quat = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export function quatAxis(axis: V3, angle: number): Quat {
  const half = angle / 2,
    s = Math.sin(half);
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(half) };
}
export const quatX = (angle: number): Quat => quatAxis({ x: 1, y: 0, z: 0 }, angle);
export const quatY = (angle: number): Quat => quatAxis({ x: 0, y: 1, z: 0 }, angle);
export const quatZ = (angle: number): Quat => quatAxis({ x: 0, y: 0, z: 1 }, angle);

/** Hamilton product: applying the result rotates by `b` first, then by `a`. */
export function quatMul(a: Quat, b: Quat): Quat {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function rotate(q: Quat, v: V3): V3 {
  // v + 2w(q × v) + 2 q × (q × v)
  const tx = 2 * (q.y * v.z - q.z * v.y),
    ty = 2 * (q.z * v.x - q.x * v.z),
    tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Yaw (about +Y), then pitch (about the yawed X), then roll (about the resulting Z). */
export function quatYawPitchRoll(yaw: number, pitch: number, roll: number): Quat {
  return quatMul(quatMul(quatY(yaw), quatX(pitch)), quatZ(roll));
}

/** Rotation whose columns are the given orthonormal, right-handed basis. */
export function quatFromBasis(x: V3, y: V3, z: V3): Quat {
  const trace = x.x + y.y + z.z;
  let q: Quat;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = { w: s / 4, x: (y.z - z.y) / s, y: (z.x - x.z) / s, z: (x.y - y.x) / s };
  } else if (x.x > y.y && x.x > z.z) {
    const s = Math.sqrt(1 + x.x - y.y - z.z) * 2;
    q = { w: (y.z - z.y) / s, x: s / 4, y: (y.x + x.y) / s, z: (z.x + x.z) / s };
  } else if (y.y > z.z) {
    const s = Math.sqrt(1 + y.y - x.x - z.z) * 2;
    q = { w: (z.x - x.z) / s, x: (y.x + x.y) / s, y: s / 4, z: (z.y + y.z) / s };
  } else {
    const s = Math.sqrt(1 + z.z - x.x - y.y) * 2;
    q = { w: (x.y - y.x) / s, x: (z.x + x.z) / s, y: (z.y + y.z) / s, z: s / 4 };
  }
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Turns unit `a` toward unit `b` along the great arc; opposed directions go round a level axis. */
export function slerpUnit(a: V3, b: V3, t: number): V3 {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const cos = clamp(dot(a, b), -1, 1);
  const angle = Math.acos(cos);
  if (angle < 1e-5) return normalize(lerp(a, b, t), b);
  if (Math.PI - angle < 1e-3) {
    const axis = reject({ x: 0, y: 1, z: 0 }, a, { x: 1, y: 0, z: 0 });
    return rotate(quatAxis(axis, Math.PI * t), a);
  }
  const sin = Math.sin(angle);
  return add(scale(a, Math.sin((1 - t) * angle) / sin), scale(b, Math.sin(t * angle) / sin));
}

/** Shortest signed difference between two angles, in (-π, π]. */
export function angleDelta(from: number, to: number): number {
  const d = (to - from) % (Math.PI * 2);
  return d > Math.PI ? d - Math.PI * 2 : d <= -Math.PI ? d + Math.PI * 2 : d;
}
export const mixAngle = (a: number, b: number, t: number): number => a + angleDelta(a, b) * t;

/** Frame-rate independent exponential approach; `rate` is 1 / time-constant. */
export const damp = (current: number, target: number, rate: number, dt: number): number =>
  target + (current - target) * Math.exp(-rate * dt);
