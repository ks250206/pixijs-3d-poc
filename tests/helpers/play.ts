import type { GameEngine } from "../../src/game/engine";
import { EMPTY_INPUT } from "../../src/game/types";
import { insideHazard } from "../../src/game/patterns";
const frame = () => ({ ...EMPTY_INPUT });
/** Reads public state; combat, objectives and travel use the same actions as UI players. */
export function runCampaignInputs(
  game: GameEngine,
  maxFrames: number,
  stop: () => boolean = () => false,
): number[] {
  const completedObjectives = new Set<number>();
  let lastAction = -99;
  let nextDodge = 0;
  // This player has no world writes, damage overrides, teleports or invincibility.
  // It builds damage with quick strikes before charging finishers, jumps telegraphed attacks and
  // uses aerials/recovery and visible floor warnings. Supplies use the same
  // public action as the map buttons; combat still uses ordinary input frames.
  for (let tick = 0; tick < maxFrames; tick++) {
    const w = game.world,
      p = w.player;
    if (w.objective.complete && w.objective.kind !== "clear") completedObjectives.add(w.sector);
    if (stop() || w.phase === "won" || w.phase === "lost") break;
    const input = frame();
    const recoveryReady = w.recoveryAvailable;
    if (w.phase === "sector-clear") {
      if (!w.upgradeClaimed && w.upgradeChoices[0]) game.claimUpgrade(w.upgradeChoices[0].id);
      game.claimSupply(w.stocks < 3 ? "stock" : "repair");
      input.moveX = 1;
    } else if (p.alive) {
      const targets = w.enemies
        .filter((enemy) => enemy.alive)
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const target = targets[0];
      const prop = w.props
        .filter((prop) => prop.alive && prop.id.startsWith("objective-"))
        .sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0];
      if (!target && prop) {
        const dx = prop.x - p.x,
          dz = prop.z - p.z;
        input.moveX = Math.abs(dx) > 1.35 ? Math.sign(dx) : 0;
        input.moveZ = Math.abs(dz) > 0.25 ? Math.sign(dz) : 0;
        if (Math.abs(dx) < 1.8 && Math.abs(dz) < 0.45 && ["idle", "run"].includes(p.state)) {
          if (p.facing !== Math.sign(dx) && Math.abs(dx) > 0.2) input.moveX = Math.sign(dx);
          else input.attack = true;
        }
      } else if (!target && (p.x < w.arenaMin || p.x > w.arenaMax) && recoveryReady) {
        input.moveZ = -1;
        input.moveX = Math.sign((w.arenaMin + w.arenaMax) / 2 - p.x);
        input.special = true;
      }
      if (target) {
        const dx = target.x - p.x,
          dz = target.z - p.z;
        const outside = p.x < w.arenaMin || p.x > w.arenaMax;
        if (outside && p.y < 2 && recoveryReady) {
          input.moveZ = -1;
          input.moveX = Math.sign((w.arenaMin + w.arenaMax) / 2 - p.x);
          input.special = true;
        } else if (p.state === "charge")
          input.smashHeld =
            (p.attack?.charge ?? 0) < 0.6 &&
            !w.hazards.some((h) => !h.hit && insideHazard(h, p.x, p.z));
        else if (p.state === "hurt") input.moveX = Math.sign((w.arenaMin + w.arenaMax) / 2 - p.x);
        else {
          const approachX = Math.max(w.arenaMin + 2.5, Math.min(w.arenaMax - 2.5, target.x)) - p.x;
          input.moveX = Math.abs(approachX) > 2.1 ? Math.sign(approachX) : 0;
          input.moveZ = Math.abs(dz) > 0.6 ? Math.sign(dz) : 0;
          const canAct = ["idle", "run", "jump", "fall", "wavedash"].includes(p.state);
          const danger = w.hazards.filter((h) => !h.hit && h.delay - h.elapsed < 1.2);
          if (canAct && danger.some((h) => insideHazard(h, p.x, p.z))) {
            const safe = [] as { x: number; z: number; distance: number }[];
            for (let x = w.arenaMin + 2; x <= w.arenaMax - 2; x += 1.5)
              for (const z of [-3.4, -1.5, 0, 1.5, 3.4]) {
                if (
                  danger.every(
                    (h) =>
                      !insideHazard({ ...h, width: h.width + 0.7, depth: h.depth + 0.7 }, x, z),
                  )
                )
                  safe.push({ x, z, distance: Math.hypot(x - p.x, (z - p.z) * 1.3) });
              }
            safe.sort((a, b) => a.distance - b.distance);
            if (safe[0]) {
              input.moveX = Math.abs(safe[0].x - p.x) > 0.2 ? Math.sign(safe[0].x - p.x) : 0;
              input.moveZ = Math.abs(safe[0].z - p.z) > 0.2 ? Math.sign(safe[0].z - p.z) : 0;
              if (danger.some((h) => insideHazard(h, p.x, p.z) && h.delay - h.elapsed < 0.25))
                input.dodge = true;
              game.update(1 / 60, input);
              continue;
            }
          }
          const threat = targets.find(
            (enemy) =>
              enemy.attack &&
              enemy.telegraph > 0 &&
              enemy.telegraph < 0.4 &&
              Math.abs(enemy.x - p.x) < (enemy.kind === "boss" ? 6 : 3) &&
              Math.abs(enemy.z - p.z) < 2.7,
          );
          if (canAct && threat && tick > nextDodge && p.y <= 0.1) {
            input.jump = true;
            input.jumpHeld = true;
            nextDodge = tick + 30;
          } else if (
            canAct &&
            p.y <= 0.1 &&
            Math.abs(dx) < 1.7 &&
            Math.abs(dz) < 0.7 &&
            (target.guard > 0 || target.damage > 110)
          ) {
            input.grab = true;
            input.moveX = 0;
            input.moveZ = 0;
          } else if (p.state === "grab") {
            input.attack = true;
            input.moveX = target.x < (w.arenaMin + w.arenaMax) / 2 ? -1 : 1;
            input.moveZ = 0;
          } else if (
            canAct &&
            p.y <= 0.1 &&
            w.specialCooldown <= 0 &&
            targets.filter((e) => Math.hypot(e.x - p.x, e.z - p.z) < 3.4).length >= 3
          ) {
            input.moveX = 0;
            input.moveZ = 1;
            input.special = true;
          } else if (canAct && p.y > 0.1 && Math.hypot(dx, dz) < 2.5 && Math.abs(dz) < 1) {
            input.attack = true;
            input.moveX = Math.sign(dx);
            input.moveZ = 0;
            lastAction = tick;
          } else if (canAct && Math.abs(dx) < 2.4 && Math.abs(dz) < 0.8 && tick - lastAction > 10) {
            if (p.facing !== Math.sign(dx) && Math.abs(dx) > 0.2) input.moveX = Math.sign(dx);
            else if (target.damage < 50 && target.armor <= 0 && target.guard <= 0) {
              input.moveX = Math.sign(dx);
              input.moveZ = 0;
              input.attack = true;
              lastAction = tick;
            } else {
              input.moveX = 0;
              input.moveZ = 0;
              input.smash = true;
              input.smashHeld = true;
              lastAction = tick;
            }
          } else if (
            canAct &&
            Math.abs(dx) > 4 &&
            Math.abs(dx) < 8 &&
            Math.abs(dz) < 1 &&
            w.specialCooldown <= 0 &&
            w.loadout.special === "pulse"
          ) {
            input.moveZ = 0;
            // A direction held with L selects PHASE CROSS for every chassis.
            // Turn first, then fire the neutral pulse with no movement held.
            // This also prevents a long dash from carrying the bot over an edge.
            input.moveX = p.facing === Math.sign(dx) ? 0 : Math.sign(dx);
            input.special = input.moveX === 0;
            lastAction = tick;
          }
        }
      }
    }
    game.update(1 / 60, input);
  }
  return [...completedObjectives];
}
