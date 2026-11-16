import { Container3D, Mesh3D, type Material3D } from "@pixi/3d";
import { WEAPON_REST } from "../game/combat/trajectory";
import type { WeaponId } from "../game/types";
import type { RobotAssets } from "./robot";

/**
 * One weapon drawn along local +Y in metres, from the pivot (y = 0) to the tip (y = length).
 * Solid parts — hilts, heads, housings — keep their size; only the marked blade or shaft section
 * changes length, so a longer strike reads as the weapon extending rather than the model scaling.
 * The tip mesh always ends exactly at y = length.
 */
export interface WeaponModel {
  root: Container3D;
  /** The mesh whose local top face centre `(0, 0.5, 0)` is the weapon tip. */
  tip: Mesh3D;
  /** Lays the parts out for a segment of `length` held `grip` metres from the pivot. */
  layout(length: number, grip: number): void;
}

type Part = (x: number, y: number, z: number, w: number, h: number, d: number, material: Material3D) => Mesh3D;

/** Sets a box to span `[from, to]` along the weapon. */
function span(mesh: Mesh3D, from: number, to: number): void {
  const length = Math.max(0.02, to - from);
  mesh.scale.y = length;
  mesh.position.y = to - length / 2;
}

export function buildWeapon(style: WeaponId, assets: RobotAssets): WeaponModel {
  const root = new Container3D();
  root.label = `weapon-${style}`;
  const glow = assets.glow.player;
  const box: Part = (x, y, z, w, h, d, material) => {
    const mesh = new Mesh3D({ geometry: assets.cube, material, castShadow: false });
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    root.addChild(mesh);
    return mesh;
  };
  /** A group of fixed-size parts that rides at one point of the shaft. */
  const group = (): { node: Container3D; box: Part } => {
    const node = new Container3D();
    root.addChild(node);
    return {
      node,
      box: (x, y, z, w, h, d, material) => {
        const mesh = box(x, y, z, w, h, d, material);
        node.addChild(mesh);
        return mesh;
      },
    };
  };
  const natural = WEAPON_REST[style].length;

  if (style === "arc") {
    // Hilt and guard ride the hand; the blade runs from the guard to the tip.
    const hilt = group();
    hilt.box(0, -0.02, 0, 0.07, 0.3, 0.07, assets.joint);
    hilt.box(0, -0.19, 0, 0.1, 0.06, 0.1, assets.trim);
    hilt.box(0, 0.15, 0, 0.07, 0.05, 0.34, assets.trim);
    const core = box(0, 0, 0, 0.045, 1, 0.13, assets.white);
    const edge = box(0, 0, 0.075, 0.02, 1, 0.05, glow);
    return {
      root, tip: core,
      layout(length, grip) {
        hilt.node.y = grip;
        span(core, grip + 0.17, length);
        span(edge, grip + 0.2, length - 0.04);
      },
    }; // prettier-ignore
  }

  if (style === "pile") {
    const shaft = box(0, 0, 0, 0.09, 1, 0.09, assets.joint);
    const pommel = group();
    pommel.box(0, 0, 0, 0.13, 0.1, 0.13, assets.trim);
    const head = group();
    const block = head.box(0, -0.2, 0, 0.36, 0.4, 0.6, assets.white);
    head.box(0, -0.2, 0.31, 0.26, 0.26, 0.04, glow);
    head.box(0, -0.2, -0.31, 0.26, 0.26, 0.04, glow);
    head.box(0, -0.43, 0, 0.16, 0.06, 0.2, assets.trim);
    return {
      root, tip: block,
      layout(length) {
        const butt = Math.min(0, length - natural);
        pommel.node.y = butt;
        head.node.y = length;
        span(shaft, butt, length - 0.4);
      },
    }; // prettier-ignore
  }

  if (style === "razor") {
    // The fist is the robot's own gauntlet; the weapon is the claw that shoots out of it.
    const centre = box(0, 0, 0, 0.035, 1, 0.07, glow);
    const sides = [-0.1, 0.1].map((x) => box(x, 0, 0, 0.03, 1, 0.06, glow));
    return {
      root, tip: centre,
      layout(length, grip) {
        span(centre, grip + 0.08, length);
        for (const claw of sides) span(claw, grip + 0.08, length - Math.min(0.12, (length - grip) * 0.25));
      },
    }; // prettier-ignore
  }

  if (style === "lance") {
    const shaft = box(0, 0, 0, 0.07, 1, 0.07, assets.trim);
    const butt = group();
    butt.box(0, 0.05, 0, 0.11, 0.14, 0.11, assets.joint);
    const head = group();
    head.box(0, -0.36, 0, 0.16, 0.5, 0.08, assets.white);
    head.box(0, -0.68, 0, 0.4, 0.05, 0.12, glow);
    const point = head.box(0, -0.16, 0, 0.07, 0.32, 0.12, glow);
    return {
      root, tip: point,
      layout(length) {
        // Shorter than its natural length the lance slides back through the hands; longer, the shaft extends.
        const end = Math.min(0, length - natural);
        butt.node.y = end;
        head.node.y = length;
        span(shaft, end, length - 0.6);
      },
    }; // prettier-ignore
  }

  if (style === "cannon") {
    const body = group();
    body.box(0, 0.1, 0, 0.46, 0.84, 0.5, assets.trim);
    body.box(0, 0.68, 0, 0.32, 0.4, 0.36, assets.white);
    for (const y of [-0.12, 0.06, 0.24]) body.box(0.24, y, 0, 0.03, 0.06, 0.36, glow);
    body.box(0, 0.9, 0, 0.24, 0.05, 0.26, glow);
    // Bashing drives a ram of charge out of the muzzle; shots and carrying leave it retracted.
    const ram = box(0, 0, 0, 0.2, 1, 0.22, glow);
    return {
      root, tip: ram,
      layout(length, grip) {
        body.node.y = grip;
        const muzzle = grip + 0.9;
        ram.visible = length > muzzle + 0.04;
        span(ram, Math.min(muzzle, length - 0.04), length);
      },
    }; // prettier-ignore
  }

  // Scythe: the edge sweeps toward local +Z, the side the weapon is travelling to.
  const shaft = box(0, 0, 0, 0.08, 1, 0.08, assets.trim);
  const butt = group();
  butt.box(0, 0.04, 0, 0.12, 0.1, 0.12, assets.joint);
  const head = group();
  for (let i = 0; i < 5; i++) {
    const blade = head.box(0, -0.1 - i * i * 0.035, 0.2 + i * 0.22, 0.06, 0.2 - i * 0.025, 0.4 - i * 0.04, i < 3 ? assets.white : glow);
    blade.rotation.x = i * 0.16;
  }
  head.box(0, -0.2, 0.62, 0.025, 0.05, 1.1, glow);
  return {
    root, tip: shaft,
    layout(length) {
      const end = Math.min(0, length - natural);
      butt.node.y = end;
      head.node.y = length;
      span(shaft, end, length);
    },
  }; // prettier-ignore
}
