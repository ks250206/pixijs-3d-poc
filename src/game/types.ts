import type { Capsule } from './combat/geometry';
import type { Coordination } from './director';
import type { ObjectiveState } from './objectives';
import type { MoveDefinition } from './combat/moves';
import type { RunUpgrade, UpgradeChoice } from './upgrades';
export type ActorKind = 'player' | 'scout' | 'bruiser' | 'gunner' | 'drone' | 'sentinel' | 'charger' | 'leaper' | 'artillery' | 'rider' | 'captain' | 'minion' | 'sniper' | 'sapper' | 'warden' | 'boss';
export type SupplyChoice = 'repair' | 'power' | 'stock';
export type ActionState = 'idle' | 'run' | 'jump' | 'fall' | 'recover' | 'attack' | 'charge' | 'dodge' | 'airdodge' | 'wavedash' | 'hurt' | 'grab' | 'grabbed' | 'dead' | 'shield';
export type AttackDirection = 'neutral' | 'forward' | 'back' | 'up' | 'down';
export type AttackKind = 'jab' | 'tilt' | 'smash' | 'dash' | 'aerial' | 'throw' | 'special' | 'enemy';
export type GamePhase = 'ready' | 'playing' | 'paused' | 'sector-clear' | 'won' | 'lost';
export type GameMode = 'campaign' | 'training';
export type WeaponId = 'arc' | 'pile' | 'razor' | 'lance' | 'cannon' | 'scythe';
export type SpecialId = 'pulse' | 'blink' | 'vortex';
export type TraitId = 'lightweight' | 'heavy-duty' | 'overclocked' | 'vampiric' | 'volatile' | 'stable';

export interface Loadout {
  id: string;
  name: string;
  subtitle: string;
  weapon: WeaponId;
  special: SpecialId;
  trait: TraitId;
  color: number;
  power: number;
  speed: number;
  weight: number;
  description: string;
  modules: { weapon: 'quick' | 'breaker'; neutral: 'focused' | 'split'; side: 'cross' | 'push'; down: 'launch' | 'stagger' };
}

export type BufferedAction = 'attack' | 'smash' | 'special' | 'jump' | 'dodge' | 'grab';
export interface ActionPress {
  action: BufferedAction;
  moveX: number;
  moveZ: number;
  aimX: number;
  aimZ: number;
  dash: boolean;
}

export interface InputFrame {
  moveX: number;
  moveZ: number;
  // Omitted aiming axes retain the keyboard/legacy movement-direction mapping.
  aimX?: number;
  aimZ?: number;
  // Device adapters preserve directions at the press, including between render frames.
  presses?: readonly ActionPress[];
  attack: boolean;
  attackHeld: boolean;
  smash: boolean;
  smashHeld: boolean;
  special: boolean;
  jump: boolean;
  jumpHeld: boolean;
  dodge: boolean;
  dodgeHeld: boolean;
  grab: boolean;
  dash: boolean;
  pause: boolean;
  // Direction pulses are independent of the dedicated smash action.
  flickX: number;
  flickZ: number;
}

export const EMPTY_INPUT: InputFrame = {
  moveX: 0, moveZ: 0, attack: false, attackHeld: false, smash: false,
  smashHeld: false, special: false, jump: false, jumpHeld: false,
  dodge: false, dodgeHeld: false, grab: false, dash: false, pause: false,
  flickX: 0, flickZ: 0,
};

export interface AttackVisual {
  move?: MoveDefinition;
  collision?: { capsule: Capsule; frame: number; active: boolean };
  name: string;
  kind: AttackKind;
  direction: AttackDirection;
  elapsed: number;
  duration: number;
  range: number;
  charge: number;
  activeStart: number;
  activeEnd: number;
  combo: number;
}

export interface Actor {
  bossPhase: 'armored' | 'transition' | 'overdrive' | null;
  phaseChanges: number;
  tactic: string;
  id: string;
  kind: ActorKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  facing: 1 | -1;
  damage: number;
  armor: number;
  guard: number;
  mount: number;
  leaderId: string | null;
  alive: boolean;
  state: ActionState;
  stateTime: number;
  invulnerable: number;
  scale: number;
  attack: AttackVisual | null;
  telegraph: number;
  aim: { x: number; y: number; z: number } | null;
  // Extra mechanics live on the engine's internal actor records.
}

export interface Projectile {
  kind: 'bolt' | 'mortar';
  target?: { x: number; z: number };
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  radius: number;
  life: number;
  color: number;
}

/** Authoritative floor footprint: the renderer uses these exact collision bounds. */
export interface AreaHazard {
  id: string;
  group: string;
  ownerId: string;
  pattern: 'lanes' | 'cross' | 'sweep' | 'snipe' | 'mine' | 'pincer' | 'overload';
  x: number;
  z: number;
  width: number;
  depth: number;
  elapsed: number;
  delay: number;
  duration: number;
  height: number;
  damage: number;
  force: number;
  hit: boolean;
}

export interface Effect {
  id: string;
  type: 'hit' | 'ringout' | 'trail' | 'shockwave' | 'spawn' | 'text' | 'telegraph' | 'heal';
  x: number;
  y: number;
  z: number;
  life: number;
  duration: number;
  size: number;
  color: number;
  text?: string;
}

export interface GameEvent {
  type: 'hit' | 'ko' | 'jump' | 'dodge' | 'smash' | 'special' | 'wave' | 'boss' | 'win' | 'lose' | 'wavedash' | 'grab' | 'throw';
  intensity?: number;
}

export interface ArenaProp {
  id: string;
  kind: 'crate' | 'barrel' | 'vent' | 'conveyor' | 'repair' | 'relay' | 'node';
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  hp: number;
  alive: boolean;
  phase: 'idle' | 'warning' | 'active';
  timer: number;
  direction: 1 | -1;
}

/** Arrival countdown; render the floor marker only inside the warning duration. */
export interface SpawnWarning {
  id: string;
  kind: ActorKind;
  x: number;
  z: number;
  remaining: number;
  duration: number;
  source: 'wave' | 'relay' | 'lockdown';
  sourceId?: string;
}

export interface WorldState {
  objective: ObjectiveState;
  coordination: Coordination;
  phase: GamePhase;
  mode: GameMode;
  time: number;
  seed: number;
  sector: number;
  completedSectors: number;
  supplyClaimed: boolean;
  supply: SupplyChoice | null;
  upgrades: RunUpgrade[];
  upgradeChoices: UpgradeChoice[];
  upgradeClaimed: boolean;
  pendingSpawns: SpawnWarning[];
  wave: number;
  player: Actor;
  enemies: Actor[];
  projectiles: Projectile[];
  hazards: AreaHazard[];
  effects: Effect[];
  props: ArenaProp[];
  loadout: Loadout;
  stocks: number;
  kills: number;
  combo: number;
  bestCombo: number;
  score: number;
  lastMove: string;
  message: string;
  messageTime: number;
  shake: number;
  hitstop: number;
  specialCooldown: number;
  recoveryAvailable: boolean;
  waveTimer: number;
  cameraX: number;
  arenaMin: number;
  arenaMax: number;
  events: GameEvent[];
}

export const ENEMY_NAMES: Record<ActorKind, string> = { player: 'YOU', scout: 'SCOUT', bruiser: 'BRUISER', gunner: 'GUNNER', drone: 'DRONE', sentinel: 'SENTINEL', charger: 'CHARGER', leaper: 'LEAPER', artillery: 'ARTILLERY', rider: 'STRIDER', captain: 'COMMANDER', minion: 'MINION', sniper: 'DEADEYE', sapper: 'SAPPER', warden: 'THE WARDEN', boss: 'THE ARCHITECT' };
export const WEAPON_NAMES: Record<WeaponId, string> = { arc: 'ARC BLADE', pile: 'PILE DRIVER', razor: 'RAZOR FISTS', lance: 'VOLT LANCE', cannon: 'SIEGE CANNON', scythe: 'ORBIT SCYTHE' };
export const SPECIAL_NAMES: Record<SpecialId, string> = { pulse: 'ION PULSE', blink: 'PHASE SHIFT', vortex: 'GRAVITY WELL' };
export const TRAIT_NAMES: Record<TraitId, string> = { lightweight: 'LIGHTWEIGHT', 'heavy-duty': 'HEAVY DUTY', overclocked: 'OVERCLOCKED', vampiric: 'SELF REPAIR', volatile: 'VOLATILE', stable: 'STABILIZED' };
