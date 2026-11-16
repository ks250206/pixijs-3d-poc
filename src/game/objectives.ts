import type { ArenaProp, GameMode } from "./types";
import { SECTOR_SPAN } from "./campaign";
export interface ObjectiveState {
  kind: "clear" | "relay" | "lockdown" | "nodes";
  label: string;
  progress: number;
  target: number;
  complete: boolean;
  elapsed: number;
  reinforcements: number;
  rewarded: boolean;
  activated: boolean;
  relayPulses: [number, number];
  hazardTimer: number;
}
export function createObjective(sector: number, mode: GameMode): ObjectiveState {
  const kind =
    mode === "training"
      ? "clear"
      : sector === 0
        ? "relay"
        : sector === 2
          ? "lockdown"
          : sector === 5
            ? "nodes"
            : "clear";
  return {
    kind,
    label:
      kind === "relay"
        ? "通信リレー2基を破壊し増援を停止"
        : kind === "nodes"
          ? "砲撃制御A・噴出制御Bを停止"
          : kind === "lockdown"
            ? "最終波のロックダウンを生存して離脱"
            : "敵の全ウェーブを突破",
    progress: 0,
    target: kind === "lockdown" ? 18 : kind === "clear" ? 0 : 2,
    complete: kind === "clear",
    elapsed: 0,
    reinforcements: 0,
    rewarded: false,
    activated: kind !== 'lockdown',
    relayPulses: [0, 0],
    hazardTimer: 0,
  };
}
export function objectiveProps(sector: number, objective: ObjectiveState): ArenaProp[] {
  if (objective.kind !== "relay" && objective.kind !== "nodes") return [];
  return [-1, 1].map((sign, i) => ({
    id: `objective-${sector}-${i}`,
    kind: objective.kind === "relay" ? "relay" : "node",
    x: sector * SECTOR_SPAN + sign * 8,
    z: sign * 1.5,
    width: 0.9,
    depth: 0.9,
    height: 1.7,
    hp: objective.kind === "nodes" ? 32 : 18,
    alive: true,
    phase: "idle",
    timer: 0,
    direction: 1,
  }));
}
export function objectiveText(o: ObjectiveState): string {
  if (o.kind === "clear") return o.label;
  if (o.kind === 'lockdown' && !o.activated) return '最終波で18秒のロックダウン / 現在は迎撃部隊を突破';
  return `${o.complete ? "✓ " : ""}${o.label} ${Math.min(o.target, Math.floor(o.progress))}/${o.target}${o.kind === "lockdown" ? "s" : ""}`;
}
