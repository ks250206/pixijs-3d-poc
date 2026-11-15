import type { Actor, WorldState } from "./types";
export type CombatRole = "ranged" | "support" | "defender" | "flanker" | "boss";
export interface Coordination {
  beat: "screen" | "flank" | "recover";
  sequence: number;
  reservations: { ownerId: string; role: CombatRole; lane: number; until: number }[];
}
export const emptyCoordination = (): Coordination => ({
  beat: "screen",
  sequence: 0,
  reservations: [],
});
export function combatRole(a: Actor): CombatRole {
  if (a.kind === "boss" || a.kind === "warden") return "boss";
  if (["gunner", "sniper", "artillery"].includes(a.kind)) return "ranged";
  if (["captain", "sapper"].includes(a.kind)) return "support";
  if (["sentinel", "bruiser"].includes(a.kind)) return "defender";
  return "flanker";
}
/** Shared danger budget. Screen/fire -> flank pressure -> recovery, with committed lanes. */
export class EncounterDirector {
  private state = emptyCoordination();
  private elapsed = 0;
  private gap = 0;
  reset(): void {
    this.state = emptyCoordination();
    this.elapsed = 0;
    this.gap = 0;
  }
  update(w: WorldState, dt: number): void {
    this.elapsed += dt;
    this.gap = Math.max(0, this.gap - dt);
    const old = this.state.reservations.length;
    this.state.reservations = this.state.reservations.filter((r) => {
      const owner = w.enemies.find((e) => e.id === r.ownerId && e.alive);
      const danger =
        w.hazards.some((h) => h.ownerId === r.ownerId) ||
        w.projectiles.some((p) => p.ownerId === r.ownerId);
      return danger || (!!owner && owner.state === "attack" && r.until > w.time);
    });
    if (old && !this.state.reservations.length) {
      this.gap = 0.4;
      this.state.sequence++;
      this.elapsed = 0;
      this.state.beat =
        this.state.sequence % 3 === 1
          ? "flank"
          : this.state.sequence % 3 === 2
            ? "recover"
            : "screen";
    }
    if (
      !this.state.reservations.length &&
      this.elapsed > (this.state.beat === "recover" ? 0.8 : 1.6)
    ) {
      this.state.sequence++;
      this.elapsed = 0;
      this.state.beat =
        this.state.sequence % 3 === 1
          ? "flank"
          : this.state.sequence % 3 === 2
            ? "recover"
            : "screen";
    }
    w.coordination = this.state;
  }
  plan(a: Actor, w: WorldState): { role: CombatRole; lane: number; action: string } {
    const role = combatRole(a),
      slot = w.enemies.indexOf(a),
      sign = slot % 2 ? 1 : -1;
    const lane = Math.max(
      -3,
      Math.min(
        3,
        w.player.z +
          (role === "flanker" && this.state.beat !== "flank"
            ? sign * 2
            : role === "support"
              ? sign * 1.6
              : 0),
      ),
    );
    const action =
      this.state.beat === "recover"
        ? "REGROUP"
        : role === "defender"
          ? "SCREEN"
          : role === "flanker"
            ? this.state.beat === "flank"
              ? "FLANK / GO"
              : "FLANK / WAIT"
            : "COVER / AIM";
    return { role, lane, action };
  }
  reserve(a: Actor, w: WorldState, duration: number): boolean {
    if (this.gap > 0 || this.state.reservations.length || this.state.beat === "recover")
      return false;
    const role = combatRole(a);
    const wanted =
      this.state.beat === "screen"
        ? ["ranged", "support", "defender", "boss"]
        : ["flanker", "boss"];
    const available = wanted.filter((role) =>
      w.enemies.some((e) => e.alive && e.state !== "hurt" && combatRole(e) === role),
    );
    const preferred = available.includes("boss")
      ? "boss"
      : available[Math.floor(this.state.sequence / 3) % Math.max(1, available.length)];
    if (preferred && role !== preferred) return false;
    this.state.reservations.push({ ownerId: a.id, role, lane: a.z, until: w.time + duration });
    return true;
  }
}
