export type ActorKind = 'player' | 'scout' | 'bruiser' | 'gunner' | 'drone' | 'sentinel' | 'charger' | 'boss';
export type ActionState = 'idle' | 'run' | 'jump' | 'fall' | 'attack' | 'charge' | 'dodge' | 'airdodge' | 'wavedash' | 'hurt' | 'grab' | 'grabbed' | 'dead' | 'shield';
export type AttackDirection = 'neutral' | 'forward' | 'back' | 'up' | 'down';
export type AttackKind = 'jab' | 'tilt' | 'smash' | 'dash' | 'aerial' | 'throw' | 'special' | 'enemy';
export type GamePhase = 'ready' | 'playing' | 'paused' | 'sector-clear' | 'won' | 'lost';
export type GameMode = 'campaign' | 'training';
export type WeaponId = 'arc' | 'pile' | 'razor';
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
}

export interface InputFrame {
  moveX: number;
  moveZ: number;
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
  // A short direction flick also turns a simultaneous basic attack into a smash.
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
  kind: 'crate' | 'barrel' | 'vent' | 'conveyor' | 'repair';
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

export interface WorldState {
  phase: GamePhase;
  mode: GameMode;
  time: number;
  seed: number;
  sector: number;
  wave: number;
  player: Actor;
  enemies: Actor[];
  projectiles: Projectile[];
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
  waveTimer: number;
  cameraX: number;
  arenaMin: number;
  arenaMax: number;
  events: GameEvent[];
}

export const SECTOR_NAMES = ['THE FOUNDRY', 'NEURAL TRANSIT', 'THE MAINFRAME'] as const;
export const SECTOR_SUBTITLES = ['製造区画を突破', '輸送ネットワークを遮断', '統制AIを停止'] as const;
export const SECTOR_HINTS = ['赤い床は噴出の予告。緑の箱を壊すと25%修復。', '矢印の床は搬送ベルト。跳んで流れをかわそう。', '危険床と盾兵に注意。つかみや背後から崩そう。'] as const;
export const ENEMY_NAMES: Record<ActorKind, string> = { player: 'YOU', scout: 'SCOUT', bruiser: 'BRUISER', gunner: 'GUNNER', drone: 'DRONE', sentinel: 'SENTINEL', charger: 'CHARGER', boss: 'THE ARCHITECT' };
export const WEAPON_NAMES: Record<WeaponId, string> = { arc: 'ARC BLADE', pile: 'PILE DRIVER', razor: 'RAZOR FISTS' };
export const SPECIAL_NAMES: Record<SpecialId, string> = { pulse: 'ION PULSE', blink: 'PHASE SHIFT', vortex: 'GRAVITY WELL' };
export const TRAIT_NAMES: Record<TraitId, string> = { lightweight: 'LIGHTWEIGHT', 'heavy-duty': 'HEAVY DUTY', overclocked: 'OVERCLOCKED', vampiric: 'SELF REPAIR', volatile: 'VOLATILE', stable: 'STABILIZED' };
