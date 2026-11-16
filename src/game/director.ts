import type { Actor, WorldState } from "./types";
import { DEPTH_LIMIT } from "./movement";

export type CombatRole = "ranged" | "support" | "defender" | "flanker" | "boss";
type ThreatKind = "shot" | "melee" | "exclusive";
interface Corridor {
  min: number;
  max: number;
}
export interface AttackReservation {
  ownerId: string;
  role: CombatRole;
  lane: number;
  until: number;
  startedAt: number;
  threat: ThreatKind;
  corridor: Corridor;
}
export interface Coordination {
  beat: "screen" | "flank" | "recover";
  sequence: number;
  reservations: AttackReservation[];
  readyCount: number;
  maxThreats: number;
  recoveryRemaining: number;
  escapeLane: number | null;
}
export const emptyCoordination = (): Coordination => ({
  beat: "screen",
  sequence: 0,
  reservations: [],
  readyCount: 0,
  maxThreats: 2,
  recoveryRemaining: 0,
  escapeLane: null,
});
export function combatRole(a: Actor): CombatRole {
  if (a.kind === "boss" || a.kind === "warden") return "boss";
  if (["gunner", "sniper", "artillery"].includes(a.kind)) return "ranged";
  if (["captain", "sapper"].includes(a.kind)) return "support";
  if (["sentinel", "bruiser"].includes(a.kind)) return "defender";
  return "flanker";
}

const clamp = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
const actionable = (a: Actor) =>
  a.alive && a.bossPhase !== "transition" && ["idle", "run", "jump", "fall"].includes(a.state);

/** Conservative depth envelope of a bolt's entire remaining path inside the arena. */
function shotCorridor(
  w: WorldState,
  x: number,
  z: number,
  vx: number,
  vz: number,
  life: number,
  padding: number,
): Corridor {
  const exit =
    Math.abs(vx) < 0.001
      ? life
      : Math.max(0, ((vx > 0 ? w.arenaMax + 1 : w.arenaMin - 1) - x) / vx);
  const end = z + vz * Math.min(life, exit);
  return { min: Math.min(z, end) - padding, max: Math.max(z, end) + padding };
}

function intent(a: Actor, w: WorldState, duration: number): AttackReservation {
  let threat: ThreatKind = "exclusive",
    corridor = { min: -DEPTH_LIMIT, max: DEPTH_LIMIT };
  if (a.kind === "gunner") {
    threat = "shot";
    const facing = w.player.x >= a.x ? 1 : -1;
    const x = a.x + facing * a.scale * 0.9;
    const dx = w.player.x - x,
      dz = clamp(w.player.z - a.z, -2.5, 2.5);
    const length = Math.hypot(dx, dz) || 1;
    corridor = shotCorridor(w, x, a.z, (dx / length) * 9, (dz / length) * 9, 2.4, 0.8);
  } else if (a.kind === "scout" || a.kind === "minion") {
    threat = "melee";
    // SERVO STRIKE's sweep, capsule radius and player body fit inside this band.
    corridor = { min: a.z - 1.55, max: a.z + 1.55 };
  }
  return {
    ownerId: a.id,
    role: combatRole(a),
    lane: a.z,
    until: w.time + duration,
    startedAt: w.time,
    threat,
    corridor,
  };
}

/** Ready actors compete fairly; at most two compatible threats share a readable attack beat. */
export class EncounterDirector {
  private state = emptyCoordination();
  private elapsed = 0;
  private gap = 0;
  private ready: readonly Actor[] = [];
  private lastServed = new Map<string, number>();
  private turn = 0;
  private groupStarts = 0;

  reset(): void {
    this.state = emptyCoordination();
    this.elapsed = 0;
    this.gap = 0;
    this.ready = [];
    this.lastServed.clear();
    this.turn = 0;
    this.groupStarts = 0;
  }

  /** The engine supplies only actors whose range, cooldown and action state permit a move. */
  update(w: WorldState, dt: number, ready: readonly Actor[] = []): void {
    this.elapsed += dt;
    this.gap = Math.max(0, this.gap - dt);
    const old = this.state.reservations.length;
    this.state.reservations = this.state.reservations.filter((r) => {
      const owner = w.enemies.find((e) => e.id === r.ownerId && e.alive);
      const projectiles = w.projectiles.filter((p) => p.ownerId === r.ownerId && p.life > 0);
      const hazards = w.hazards.filter(
        (h) => h.ownerId === r.ownerId && h.elapsed < h.delay + h.duration,
      );
      for (const p of projectiles) {
        const band = shotCorridor(w, p.x, p.z, p.vx, p.vz, p.life, p.radius + 0.58);
        r.corridor.min = Math.min(r.corridor.min, band.min);
        r.corridor.max = Math.max(r.corridor.max, band.max);
      }
      // Attack state includes the move's recovery. Hitstop must not expire a live reservation.
      return projectiles.length > 0 || hazards.length > 0 || (!!owner && owner.state === "attack");
    });
    // A wave reset must not forget an already-fired shell whose owner has disappeared.
    for (const p of w.projectiles) {
      if (
        p.ownerId === w.player.id ||
        p.life <= 0 ||
        this.state.reservations.some((r) => r.ownerId === p.ownerId)
      )
        continue;
      const owner = w.enemies.find((e) => e.id === p.ownerId);
      this.state.reservations.push({
        ownerId: p.ownerId,
        role: owner ? combatRole(owner) : "ranged",
        lane: p.z,
        until: w.time + p.life,
        startedAt: w.time,
        threat: "exclusive",
        corridor: { min: -DEPTH_LIMIT, max: DEPTH_LIMIT },
      });
      this.groupStarts = Math.max(this.groupStarts, 1);
    }
    if (old && !this.state.reservations.length) {
      // Ready-only selection removes accidental idle stalls; keep an explicit counterattack window.
      this.gap = this.groupStarts > 1 ? 0.95 : 0.65;
      this.groupStarts = 0;
      this.advanceBeat();
    }
    if (
      !this.state.reservations.length &&
      this.elapsed > (this.state.beat === "recover" ? 0.8 : 1.6)
    )
      this.advanceBeat();
    this.ready = ready.filter(
      (a) => actionable(a) && !this.state.reservations.some((r) => r.ownerId === a.id),
    );
    const ids = new Set(w.enemies.map((a) => a.id));
    for (const id of this.lastServed.keys()) if (!ids.has(id)) this.lastServed.delete(id);
    this.state.readyCount = this.ready.length;
    this.state.recoveryRemaining = Math.max(
      this.gap,
      this.state.beat === "recover" ? 0.8 - this.elapsed : 0,
    );
    if (this.state.reservations.length < 2) this.state.escapeLane = null;
    w.coordination = this.state;
  }

  private advanceBeat(): void {
    this.state.sequence++;
    this.elapsed = 0;
    this.state.beat =
      this.state.sequence % 3 === 1
        ? "flank"
        : this.state.sequence % 3 === 2
          ? "recover"
          : "screen";
  }

  plan(a: Actor, w: WorldState): { role: CombatRole; lane: number; action: string } {
    const role = combatRole(a),
      slot = w.enemies.indexOf(a),
      sign = slot % 2 ? 1 : -1;
    const lane = clamp(
      w.player.z +
        (role === "flanker" && this.state.beat !== "flank"
          ? sign * 2
          : role === "support"
            ? sign * 1.6
            : 0),
      -3,
      3,
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

  /** Find an accessible escape corridor; existing shots may never lie across the escape route. */
  private pairEscape(candidate: AttackReservation, w: WorldState): number | null {
    const active = this.state.reservations[0];
    if (!active || this.state.reservations.length !== 1 || w.time - active.startedAt < 0.35)
      return null;
    if (
      !(
        (active.threat === "shot" && candidate.threat === "melee") ||
        (active.threat === "melee" && candidate.threat === "shot")
      )
    )
      return null;
    if (w.hazards.some((h) => h.elapsed < h.delay + h.duration)) return null;
    const a = active.corridor,
      b = candidate.corridor;
    if (Math.min(a.max, b.max) + 0.25 >= Math.max(a.min, b.min)) return null;
    const obstacles = w.props
      .filter(
        (p) =>
          p.alive &&
          (p.hp > 0 || (p.kind === "vent" && p.phase !== "idle")) &&
          Math.abs(p.x - w.player.x) < p.width / 2 + 0.6,
      )
      .map((p) => ({ min: p.z - p.depth / 2 - 0.4, max: p.z + p.depth / 2 + 0.4 }));
    const bands = [a, b, ...obstacles].sort((x, y) => x.min - y.min);
    let low = -DEPTH_LIMIT + 0.35;
    for (const band of [...bands, { min: DEPTH_LIMIT - 0.35, max: DEPTH_LIMIT }]) {
      const high = Math.min(band.min, DEPTH_LIMIT - 0.35);
      if (high - low >= 0.9) {
        const escape = clamp(w.player.z, low + 0.12, high - 0.12);
        const travelLow = Math.min(escape, w.player.z),
          travelHigh = Math.max(escape, w.player.z);
        if (
          Math.abs(escape - w.player.z) <= 1.8 &&
          [a, ...obstacles].every(
            (occupied) => travelHigh < occupied.min || travelLow > occupied.max,
          )
        )
          return escape;
      }
      low = Math.max(low, band.max);
    }
    return null;
  }

  reserve(a: Actor, w: WorldState, duration: number): boolean {
    if (
      this.gap > 0 ||
      this.state.beat === "recover" ||
      this.groupStarts >= this.state.maxThreats ||
      this.state.reservations.length >= this.state.maxThreats
    )
      return false;
    const wanted: CombatRole[] =
      this.state.beat === "screen"
        ? ["ranged", "support", "defender", "boss", "flanker"]
        : ["flanker", "boss", "ranged", "support", "defender"];
    const eligible = this.ready
      .filter((e) => actionable(e) && !this.state.reservations.some((r) => r.ownerId === e.id))
      .map((e) => ({ actor: e, reservation: intent(e, w, duration) }))
      .filter(
        ({ reservation }) =>
          !this.state.reservations.length || this.pairEscape(reservation, w) !== null,
      )
      .sort(
        (x, y) =>
          (this.lastServed.get(x.actor.id) ?? -1) - (this.lastServed.get(y.actor.id) ?? -1) ||
          wanted.indexOf(x.reservation.role) - wanted.indexOf(y.reservation.role) ||
          w.enemies.indexOf(x.actor) - w.enemies.indexOf(y.actor),
      );
    const selected = eligible[0];
    if (selected?.actor !== a) return false;
    this.state.escapeLane = this.state.reservations.length
      ? this.pairEscape(selected.reservation, w)
      : null;
    this.state.reservations.push(selected.reservation);
    this.groupStarts++;
    this.lastServed.set(a.id, this.turn++);
    this.state.readyCount = Math.max(0, this.state.readyCount - 1);
    return true;
  }
}
