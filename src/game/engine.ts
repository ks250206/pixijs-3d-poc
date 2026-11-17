import { resolveUnknown, effectiveNode, eventPreview } from './roguelite/events';
import { eliteModifiers, relicEffect, createShop, RELICS, type RelicId, type EliteModifier } from './roguelite/economy';
import { createRun, availableNodes, encounterRoster, nodeSeed, type RunState, type MapNode } from './roguelite/map';
import { EncounterDirector, emptyCoordination } from './director';
import { ActionBuffer } from './action-buffer';
import { createObjective, objectiveProps } from './objectives';
import { createUpgradeChoices, getUpgradeDefinition, upgradeDescription, upgradeMove, upgradeRank, type UpgradeId } from './upgrades';
import { playerMove, specialMove, utilityMove, totalFrames, canCancel, popsUp, POP_STUN, type MoveDefinition, type BehaviorId, type CancelAction } from './combat/moves';
import { sweptContact, sampleWeapon, bodyHurtbox, type Vec3 } from './combat/geometry';
import { assistedBy, laneAssist } from './combat/assist';
import { DODGE, DEPTH_LIMIT, PLATFORM_DEPTH } from './movement';
import { createCandidates, seededRandom } from './loadouts';
import { createArena, insideProp } from './arena';
import { ARENA_HALF_WIDTH, SECTOR_SPAN, STAGES, TRAINING_WAVES } from './campaign';
import { createPattern, insideHazard } from './patterns';
import { EMPTY_INPUT, type Actor, type ActorKind, type AreaHazard, type ArenaProp, type AttackDirection, type AttackKind, type BufferedAction, type Effect, type GameMode, type InputFrame, type Loadout, type Projectile, type SpawnWarning, type SupplyChoice, type WorldState } from './types';

const GRAVITY = 27;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const approach = (value: number, target: number, amount: number) => value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);

interface Strike {
  move: MoveDefinition;
  connected: boolean;
  previous: Vec3 & { facing: 1 | -1 };
  id?: string;
  behavior?: BehaviorId;
  damage: number;
  force: number;
  growth: number;
  angle: number;
  depth: number;
  height: number;
  activeStart: number;
  activeEnd: number;
  hit: Set<string>;
  radial: boolean;
  projectile: boolean;
  tip: boolean;
  fired: boolean;
  motionStarted?: boolean;
  source: string;
  upgradeTargets?: Set<string>;
  upgradeTriggered?: boolean;
  tipRefunded?: boolean;
}

interface ActorMemory {
  phaseTimer: number;
  actionTimer: number;
  forced: number;
  jumps: number;
  airDodgeUsed: boolean;
  recoveryUsed: boolean;
  lastJumpHeld: boolean;
  charge: number;
  chargeDirection: AttackDirection;
  strike: Strike | null;
  comboStage: number;
  comboTimer: number;
  dashTimer: number;
  cooldown: number;
  pattern: number;
  grabTarget: string | null;
  grabbedBy: string | null;
  grabTimer: number;
  respawnTimer: number;
  spawnTime: number;
  bossBroken: boolean;
  hazardCooldown: number;
  upgradeAirUsed: boolean;
  upgradeNormalHits: number;
  upgradeFlow: number;
}

interface ProjectileMemory {
  originStrike?: Strike;
  hit?: Set<string>;
  pierce?: number;
  bounces?: number;
  kind: AttackKind;
  damage: number;
  force: number;
  growth: number;
  facing: 1 | -1;
  owner?: Actor;
}

/** Pure simulation: rendering, audio and input devices are independent adapters. */
export class GameEngine {
  onRunChange: (() => void) | null = null;
  world: WorldState;
  run: RunState | null = null;
  private encounter: ActorKind[] = [];
  private modifiers: EliteModifier[] = [];
  private memories = new Map<string, ActorMemory>();
  private shots = new Map<string, ProjectileMemory>();
  private random: () => number;
  private serial = 0;
  private comboAge = 0;
  private sectorCleared = false;
  private director = new EncounterDirector();
  private actions = new ActionBuffer();
  private startingLoadout: Loadout;
  private upgradeBursts: { x: number; y: number; z: number; delay: number; radius: number; damage: number; force: number }[] = [];

  constructor(seed = 1) {
    this.random = seededRandom(seed);
    const loadout = createCandidates(seed)[0]!;
    this.startingLoadout = structuredClone(loadout);
    const player = this.makeActor('player', -4, 0);
    this.world = {
      objective: createObjective(0, 'campaign'), coordination: emptyCoordination(),
      phase: 'ready', mode: 'campaign', time: 0, seed: seed >>> 0,
      sector: 0, completedSectors: 0, supplyClaimed: false, supply: null, wave: 1, player,
      upgrades: [], upgradeChoices: [], upgradeClaimed: false, pendingSpawns: [],
      enemies: [this.makeActor('scout', 2, -1), this.makeActor('bruiser', 6, 0.8), this.makeActor('drone', 8, -2)],
      projectiles: [], hazards: [], effects: [], props: createArena(0), loadout: structuredClone(loadout),
      stocks: 3, kills: 0, combo: 0, bestCombo: 0, score: 0,
      lastMove: 'SYSTEM READY', message: 'BREAK THE DIRECTIVE', messageTime: 0,
      shake: 0, hitstop: 0, specialCooldown: 0, recoveryAvailable: true, waveTimer: 0,
      cameraX: 0, arenaMin: -ARENA_HALF_WIDTH, arenaMax: ARENA_HALF_WIDTH, events: [],
    };
  }

  start(loadout: Loadout, mode: GameMode = 'campaign'): void {
    this.run = null; this.modifiers = [];
    const seed = this.world.seed;
    this.startingLoadout = structuredClone(loadout);
    this.random = seededRandom(seed ^ 0x1f842b);
    this.memories.clear();
    this.shots.clear();
    this.serial = 0;
    this.comboAge = 0;
    this.sectorCleared = false;
    this.director.reset();
    this.actions.reset();
    this.upgradeBursts = [];
    const player = this.makeActor('player', -5, 0);
    this.world = {
      objective: createObjective(0, mode), coordination: emptyCoordination(),
      phase: 'playing', mode, time: 0, seed, sector: 0, completedSectors: 0, supplyClaimed: false, supply: null, wave: 1,
      upgrades: [], upgradeChoices: [], upgradeClaimed: false, pendingSpawns: [],
      player, enemies: [], projectiles: [], hazards: [], effects: [], props: createArena(0), loadout: structuredClone(loadout),
      stocks: 3, kills: 0, combo: 0, bestCombo: 0, score: 0,
      lastMove: 'SYSTEM ONLINE', message: mode === 'training' ? 'TRAINING // 機体を試そう' : '01 // THE FOUNDRY', messageTime: 3,
      shake: 0, hitstop: 0, specialCooldown: 0, recoveryAvailable: true, waveTimer: 0,
      cameraX: 0, arenaMin: -ARENA_HALF_WIDTH, arenaMax: ARENA_HALF_WIDTH, events: [],
    };
    if (mode === 'roguelite') {
      this.run = createRun(seed, loadout);
      this.world.phase = 'sector-clear';
      this.world.enemies = []; this.world.props = [];
      this.touchRun(); return;
    }
    this.world.props.push(...objectiveProps(0, this.world.objective));
    player.invulnerable = 1.8;
    this.spawnWave();
    this.effect('spawn', player.x, 0, player.z, 0.8, 2.2, loadout.color);
  }

  private touchRun(): void {
    if (!this.run) return;
    if (this.run.phase !== 'combat') this.syncRunResources();
    this.run.revision++; this.onRunChange?.();
  }

  exportCheckpoint(): { run: RunState; reward: { ids: UpgradeId[]; claimed: boolean } } | null {
    if (!this.run || this.run.phase === 'finished' || this.world.phase === 'lost' || this.world.phase === 'won') return null;
    return structuredClone({run:this.run,reward:{ids:this.world.upgradeChoices.map(c=>c.id),claimed:this.world.upgradeClaimed}});
  }

  restoreCheckpoint(checkpoint: {run: RunState; reward:{ids:UpgradeId[];claimed:boolean}}): void {
    const r=structuredClone(checkpoint.run);
    const notify=this.onRunChange; this.onRunChange=null;
    this.world.seed=r.seed; this.start(r.originalLoadout,'roguelite'); this.onRunChange=notify;
    this.run=r; this.startingLoadout=structuredClone(r.originalLoadout);
    const w=this.world;
    w.loadout=structuredClone(r.resources.loadout);w.upgrades=structuredClone(r.resources.upgrades);
    w.player.damage=r.resources.damage;w.stocks=r.resources.stocks;w.score=r.resources.score;w.kills=r.resources.kills;
    if(r.phase==='combat') {
      const n=effectiveNode(r,r.map.find(n=>n.id===r.current)!);
      this.beginEncounter(r.events.resolved[n.id]?.combat?{...n,kind:'elite'}:n);
    } else {
      w.phase='sector-clear';
      w.upgradeChoices=checkpoint.reward.ids.map(id=>{const d=getUpgradeDefinition(id);const rank=upgradeRank(w.upgrades,id);return {...d,rank,nextRank:rank+1,description:upgradeDescription(id,rank+1,w.loadout)};});
      w.upgradeClaimed=checkpoint.reward.claimed;
    }
    this.touchRun();
  }

  selectNode(id: string): boolean {
    if (!this.run || !availableNodes(this.run).includes(id)) return false;
    this.run.selected = id; this.touchRun(); return true;
  }

  travelNode(): boolean {
    const r = this.run;
    if (!r || !r.selected || !availableNodes(r).includes(r.selected)) return false;
    let node = r.map.find(n => n.id === r.selected)!;
    if (node.kind === 'unknown') resolveUnknown(r, node);
    node = effectiveNode(r,node);
    r.current = node.id; r.visited.push(node.id); r.selected = null;
    if (['battle', 'elite', 'boss'].includes(node.kind)) this.beginEncounter(node);
    else { r.phase = 'node'; this.world.phase = 'sector-clear'; if (node.kind === 'shop') r.economy.shops[node.id] ??= createShop(r, node); }
    this.touchRun(); return true;
  }

  private beginEncounter(node: MapNode): void {
    const w = this.world, r = this.run!;
    r.phase = 'combat';
    this.modifiers = eliteModifiers(r, node);
    this.encounter = encounterRoster(r, node);
    if (this.modifiers.includes('armor') && !this.encounter.some(k=>['sentinel','warden','boss','rider'].includes(k))) this.encounter.push('sentinel');
    if (this.modifiers.includes('commander')) this.encounter = ['captain', 'sentinel', 'rider', ...this.encounter.slice(0, 3)];
    if (this.modifiers.includes('swarm')) this.encounter.push(...Array.from({length: Math.ceil(this.encounter.length / 2)}, () => 'minion' as const));
    this.random = seededRandom(nodeSeed(r.seed, `combat:${node.id}`));
    this.memories.clear(); this.shots.clear(); this.actions.reset(); this.director.reset();
    this.upgradeBursts = []; this.comboAge = 0; this.sectorCleared = false;
    w.combo = 0;
    w.sector = node.theme; w.wave = 1; w.waveTimer = 0; w.hitstop = 0; w.specialCooldown = 0;
    w.arenaMin = node.theme * SECTOR_SPAN - ARENA_HALF_WIDTH; w.arenaMax = node.theme * SECTOR_SPAN + ARENA_HALF_WIDTH; w.cameraX = node.theme * SECTOR_SPAN;
    w.player = this.makeActor('player', w.cameraX - 5, 0); w.player.damage = r.resources.damage; w.player.invulnerable = 1.8;
    w.stocks = r.resources.stocks; w.score = r.resources.score; w.kills = r.resources.kills; w.loadout = structuredClone(r.resources.loadout); w.upgrades = structuredClone(r.resources.upgrades);
    w.enemies = []; w.projectiles = []; w.hazards = []; w.effects = []; w.pendingSpawns = [];
    w.objective = createObjective(node.theme, 'training'); w.objective.label = `ACT ${node.act} / ${node.kind.toUpperCase()} — 敵と増援を全滅して突破`;
    w.props = createArena(node.theme).map(prop => ({ ...prop, id: `${node.id}:${prop.id}` })); w.coordination = emptyCoordination();
    w.upgradeChoices = []; w.upgradeClaimed = false; w.phase = 'playing';
    this.spawnWave();
  }

  private syncRunResources(): void {
    if (!this.run) return;
    const w = this.world;
    this.run.resources = { damage: w.player.damage, stocks: w.stocks, loadout: structuredClone(w.loadout), upgrades: structuredClone(w.upgrades), score: w.score, kills: w.kills };
  }

  completeNode(): boolean {
    const r = this.run;
    if (!r || !r.current || !['node', 'reward'].includes(r.phase) || r.completed.includes(r.current) || r.phase === 'reward' && !this.world.upgradeClaimed || r.phase === 'node' && r.events.resolved[r.current]?.kind === 'event' && !r.events.resolved[r.current]?.choice) return false;
    const node = effectiveNode(r,r.map.find(n => n.id === r.current)!);
    r.completed.push(node.id); this.syncRunResources();
    if (node.kind === 'boss') {
      if (r.act === 3) { r.phase = 'finished'; this.world.phase = 'won'; this.touchRun(); return true; }
      r.act++;
    }
    r.phase = 'map'; this.world.phase = 'sector-clear';
    this.touchRun(); return true;
  }

  chooseEvent(choice: string): boolean {
    const r = this.run;
    if (!r || r.phase !== 'node' || !r.current) return false;
    const record = r.events.resolved[r.current];
    if (!record || record.kind !== 'event') return false;
    this.syncRunResources();
    const preview = eventPreview(r,record,choice);
    if (!preview) return false;
    record.scrapBefore = r.economy.scrap; record.scrapAfter = preview.economy.scrap;
    record.before = structuredClone(r.resources); record.after = structuredClone(preview.resources);
    record.choice = choice; record.result = preview.result; record.combat = preview.combat;
    r.resources = preview.resources; r.economy = preview.economy;
    const w=this.world;
    w.player.damage=r.resources.damage; w.stocks=r.resources.stocks;
    w.loadout=structuredClone(r.resources.loadout);w.upgrades=structuredClone(r.resources.upgrades);
    if (preview.combat) this.beginEncounter({...r.map.find(n=>n.id===r.current)!,kind:'elite'});
    this.touchRun(); return true;
  }

  skipUpgrade(): boolean {
    if (!this.run || this.run.phase !== 'reward' || this.world.upgradeClaimed) return false;
    this.world.upgradeClaimed = true; this.touchRun(); return true;
  }

  private applyUpgrade(id: UpgradeId): boolean {
    const w = this.world, definition = getUpgradeDefinition(id);
    if (!definition || definition.weapon !== 'all' && definition.weapon !== w.loadout.weapon || upgradeRank(w.upgrades, id) >= definition.maxRank) return false;
    const existing = w.upgrades.find(u => u.id === id);
    if (existing) existing.rank++; else w.upgrades.push({id, rank: 1});
    if (id === 'weapon-tune') w.loadout.modules.weapon = w.loadout.modules.weapon === 'quick' ? 'breaker' : 'quick';
    if (id === 'neutral-tune') w.loadout.modules.neutral = w.loadout.modules.neutral === 'focused' ? 'split' : 'focused';
    if (id === 'side-tune') w.loadout.modules.side = w.loadout.modules.side === 'cross' ? 'push' : 'cross';
    return true;
  }

  private grantRelic(id: RelicId): boolean {
    const r = this.run, w = this.world;
    if (!r || r.economy.relics.includes(id) || id === 'reserve' && w.stocks >= 4) return false;
    r.economy.relics.push(id);
    if (id === 'reserve') w.stocks++;
    return true;
  }

  purchaseReason(id: string): string | null {
    const r=this.run,w=this.world;
    if(!r||r.phase!=='node'||!r.current)return 'Not in a shop';
    const item=r.economy.shops[r.current]?.find(i=>i.id===id);
    if(!item)return 'Unknown stock';if(item.sold)return 'SOLD OUT';
    if(r.economy.scrap<item.price)return 'Insufficient SCRAP';
    if(item.kind==='repair'&&w.player.damage<=0)return 'No damage to repair';
    if(item.kind==='stock'&&w.stocks>=4)return 'Stock cap 4';
    if(item.relic&&(r.economy.relics.includes(item.relic)||item.relic==='reserve'&&w.stocks>=4))return 'Relic owned / stock cap';
    if(item.upgrade){const d=getUpgradeDefinition(item.upgrade);if(d.weapon!=='all'&&d.weapon!==w.loadout.weapon||upgradeRank(w.upgrades,item.upgrade)>=d.maxRank)return 'Incompatible / upgrade capped';}
    return null;
  }

  restUpgrade() {
    const r=this.run;if(!r||!r.current)return null;
    return createUpgradeChoices(nodeSeed(r.seed,'rest'),nodeSeed(0,r.current),this.world.loadout,this.world.upgrades)[0]??null;
  }

  buyStock(id: string): boolean {
    const r = this.run, w = this.world;
    if (!r || r.phase !== 'node' || !r.current || this.purchaseReason(id)) return false;
    const stock = r.economy.shops[r.current]?.find(item => item.id === id);
    if (!stock || stock.sold || r.economy.scrap < stock.price) return false;
    let applied = false;
    if (stock.kind === 'upgrade' && stock.upgrade) applied = this.applyUpgrade(stock.upgrade);
    if (stock.kind === 'repair' && w.player.damage > 0) { w.player.damage = Math.max(0,w.player.damage - 40); applied = true; }
    if (stock.kind === 'stock' && w.stocks < 4) { w.stocks++; applied = true; }
    if (stock.kind === 'relic' && stock.relic) applied = this.grantRelic(stock.relic);
    if (!applied) return false;
    stock.sold = true; r.economy.scrap -= stock.price; this.syncRunResources(); this.touchRun(); return true;
  }

  claimNodeBenefit(choice: 'treasure' | 'repair' | 'upgrade'): boolean {
    const r = this.run, w = this.world;
    if (!r || r.phase !== 'node' || !r.current || r.economy.nodeClaims.includes(r.current)) return false;
    const node = effectiveNode(r,r.map.find(n => n.id === r.current)!);
    if (node.kind === 'treasure' && choice === 'treasure') {
      const available = RELICS.filter(v => !r.economy.relics.includes(v.id) && (v.id !== 'reserve' || w.stocks < 4));
      const relic = available[nodeSeed(r.seed,`treasure:${node.id}`) % available.length];
      if (relic) this.grantRelic(relic.id); else r.economy.scrap += 30; // Explicit full-pool fallback.
      r.economy.scrap += 20 + (r.economy.relics.includes('magnet') ? 20 : 0);
    } else if (node.kind === 'rest' && choice === 'repair' && w.player.damage > 0) w.player.damage = Math.max(0, w.player.damage - 50);
    else if (node.kind === 'rest' && choice === 'upgrade') {
      const upgrade = this.restUpgrade();
      if (upgrade) this.applyUpgrade(upgrade.id); else r.economy.scrap += 20;
    } else return false;
    r.economy.nodeClaims.push(node.id); this.syncRunResources(); this.touchRun(); return true;
  }

  pause(): void {
    this.actions.reset();
    if (this.world.phase === 'playing' || this.world.phase === 'sector-clear') this.world.phase = 'paused';
  }

  resume(): void {
    this.actions.reset();
    if (this.world.phase === 'paused') this.world.phase = this.sectorCleared ? 'sector-clear' : 'playing';
  }

  restart(): void { this.start(this.startingLoadout, this.world.mode); }

  claimSupply(choice: SupplyChoice): boolean {
    const w = this.world;
    if (w.mode !== 'campaign' || w.supplyClaimed || !(w.phase === 'sector-clear' || (w.phase === 'paused' && this.sectorCleared))) return false;
    if (choice === 'repair' && w.player.damage <= 0 || choice === 'stock' && w.stocks >= 4) return false;
    if (choice === 'repair') w.player.damage = Math.max(0, w.player.damage - 40);
    else if (choice === 'power') w.loadout = { ...w.loadout, power: w.loadout.power + 0.08 };
    else if (choice === 'stock') w.stocks = Math.min(4, w.stocks + 1);
    else return false;
    w.supplyClaimed = true; w.supply = choice;
    return true;
  }

  claimUpgrade(id: UpgradeId): boolean {
    const w = this.world;
    if ((w.mode !== 'campaign' && !(this.run?.phase === 'reward')) || w.upgradeClaimed || !(w.phase === 'sector-clear' || w.phase === 'paused' && this.sectorCleared)) return false;
    const choice = w.upgradeChoices.find((entry) => entry.id === id);
    if (!choice || upgradeRank(w.upgrades, id) >= choice.maxRank) return false;
    if (!this.applyUpgrade(id)) return false;
    w.upgradeClaimed = true;
    w.message = `BUILD UPDATED // ${getUpgradeDefinition(id).name}`; w.messageTime = 3;
    this.touchRun(); return true;
  }

  nextSector(): void {
    const w = this.world;
    if (this.run || w.phase !== 'sector-clear' || w.sector >= STAGES.length - 1) return;
    if (w.upgradeChoices.length && !w.upgradeClaimed) return;
    if (!w.supplyClaimed) this.claimSupply(w.player.damage > 0 ? 'repair' : 'power');
    w.sector++;
    w.supplyClaimed = false; w.supply = null;
    w.upgradeClaimed = false; w.upgradeChoices = []; w.pendingSpawns = []; this.upgradeBursts = [];
    w.wave = 1;
    w.arenaMin = w.sector * SECTOR_SPAN - ARENA_HALF_WIDTH;
    w.arenaMax = w.sector * SECTOR_SPAN + ARENA_HALF_WIDTH;
    w.cameraX = w.sector * SECTOR_SPAN;
    w.player.x = w.arenaMin + 3;
    w.player.z = 0;
    w.player.y = 0;
    w.player.vx = 0;
    w.player.vy = 0;
    w.player.vz = 0;
    w.player.invulnerable = 2;
    w.player.damage = Math.max(0, w.player.damage - 18);
    w.player.state = 'idle';
    w.player.attack = null;
    this.resetMemory(w.player);
    this.actions.reset(); w.recoveryAvailable = true;
    w.effects = [];
    w.projectiles = []; w.hazards = [];
    w.enemies = [];
    w.objective = createObjective(w.sector, w.mode);
    w.props = [...createArena(w.sector), ...objectiveProps(w.sector, w.objective)];
    this.director.reset(); w.coordination = emptyCoordination();
    this.shots.clear();
    w.phase = 'playing';
    this.sectorCleared = false;
    w.message = `0${w.sector + 1} // ${STAGES[w.sector]!.name}`;
    w.messageTime = 3;
    this.spawnWave();
  }

  update(delta: number, input: InputFrame = EMPTY_INPUT): void {
    const w = this.world;
    w.events = [];
    if (this.run && this.run.phase !== 'combat') { this.actions.reset(); return; }
    const realDt = clamp(delta, 0, 0.05);
    if (input.pause) {
      if (w.phase === 'paused') this.resume(); else this.pause();
      return;
    }
    if (w.phase === 'paused') { this.actions.reset(); return; }
    w.time += realDt;
    this.updateEffects(realDt);
    w.shake = approach(w.shake, 0, realDt * 2.2);
    w.messageTime = Math.max(0, w.messageTime - realDt);
    if (w.phase === 'ready' || w.phase === 'lost' || w.phase === 'won') { this.actions.reset(); return; }

    if (w.player.alive) this.actions.capture(input);
    else this.actions.reset();

    if (w.hitstop > 0) {
      w.hitstop = Math.max(0, w.hitstop - realDt);
      return;
    }
    const dt = realDt;
    w.specialCooldown = Math.max(0, w.specialCooldown - dt * relicEffect(this.run?.economy.relics ?? [], 'recovery'));
    this.updateUpgradeBursts(dt);
    this.updatePendingSpawns(dt);
    this.comboAge += dt;
    if (this.comboAge > 2.3) { w.combo = 0; this.memory(w.player).upgradeNormalHits = 0; }

    for (const actor of [w.player, ...w.enemies]) {
      const mem = this.memory(actor);
      actor.stateTime += dt;
      actor.invulnerable = Math.max(0, actor.invulnerable - dt);
      mem.forced = Math.max(0, mem.forced - dt);
      mem.cooldown = Math.max(0, mem.cooldown - dt);
      mem.hazardCooldown = Math.max(0, mem.hazardCooldown - dt);
      mem.dashTimer = Math.max(0, mem.dashTimer - dt);
      mem.comboTimer = Math.max(0, mem.comboTimer - dt);
      mem.upgradeFlow = Math.max(0, mem.upgradeFlow - dt);
      if (actor.kind === 'player' && this.isGrounded(actor)) mem.upgradeAirUsed = false;
      if (!actor.alive) continue;
      if (actor.bossPhase === 'transition') {
        mem.phaseTimer = Math.max(0, mem.phaseTimer - dt);
        if (mem.phaseTimer === 0) { actor.bossPhase = 'overdrive'; actor.state = 'idle'; mem.actionTimer = 0; mem.cooldown = 0.3; mem.pattern = 0; w.message = 'OVERDRIVE // Pincer・Pulse・Overload'; w.messageTime = 3; }
      }
      if (mem.actionTimer > 0) mem.actionTimer = Math.max(0, mem.actionTimer - dt);
      if (actor.state !== 'charge' && actor.state !== 'grab' && actor.state !== 'grabbed' && mem.actionTimer <= 0 && actor.state !== 'idle' && actor.state !== 'run' && actor.state !== 'jump' && actor.state !== 'fall') {
        actor.state = actor.y > 0.02 ? 'fall' : 'idle';
        actor.stateTime = 0;
        actor.attack = null;
        actor.aim = null;
        actor.telegraph = 0;
        mem.strike = null;
      }
    }

    this.updatePlayer(dt, input);
    this.actions.advance(dt);
    if (w.mode !== 'training') this.director.update(w, dt, w.enemies.filter(enemy => this.enemyCanAttack(enemy)));
    if (w.phase !== 'sector-clear') for (const enemy of w.enemies) this.updateEnemy(enemy, dt);
    // Prepare action velocities/timing, resolve all movement, then test the pose rendered this tick.
    for (const actor of [w.player, ...w.enemies]) if (actor.alive) this.prepareAttack(actor, dt);
    for (const actor of [w.player, ...w.enemies]) if (actor.alive) this.integrate(actor, dt, actor.kind === 'player' ? input : EMPTY_INPUT);
    this.updateArena(dt);
    this.updateGrabPositions(dt);
    for (const actor of [w.player, ...w.enemies]) if (actor.alive) this.constrainDepth(actor);
    for (const actor of [w.player, ...w.enemies]) if (actor.alive) this.updateAttack(actor, dt);
    this.updateProjectiles(dt);
    this.updateHazards(dt);

    for (const actor of [w.player, ...w.enemies]) {
      if (actor.alive && (actor.x < w.arenaMin - 5 || actor.x > w.arenaMax + 5 || actor.y > 18 || actor.y < -7)) this.ringOut(actor);
    }
    w.enemies = w.enemies.filter((enemy) => {
      if (!enemy.alive && enemy.stateTime > 1) { this.memories.delete(enemy.id); return false; }
      return true;
    });

    if (!w.player.alive && (w.stocks > 0 || w.mode === 'training')) {
      const mem = this.memory(w.player);
      mem.respawnTimer -= dt;
      if (mem.respawnTimer <= 0) this.respawn();
    }
    w.recoveryAvailable = w.player.alive && !this.memory(w.player).recoveryUsed;
    this.updateObjective(dt);
    if (w.phase === 'sector-clear') {
      if (w.player.x > w.arenaMax - 2) this.nextSector();
    } else if (w.phase === 'playing' && !w.enemies.some((enemy) => enemy.alive) && !w.pendingSpawns.length) {
      w.waveTimer += dt;
      if (w.waveTimer > 1.35) this.completeWave();
    } else w.waveTimer = 0;
    const targetCamera = w.sector * SECTOR_SPAN + clamp(w.player.x - w.sector * SECTOR_SPAN, -8, 8) * 0.55;
    w.cameraX += (targetCamera - w.cameraX) * Math.min(1, dt * 3.5);
  }

  private makeActor(kind: ActorKind, x: number, z: number): Actor {
    const actor: Actor = {
      id: `${kind}-${this.serial++}`, kind, x, y: kind === 'drone' ? 1.5 : 0, z,
      vx: 0, vy: 0, vz: 0, facing: kind === 'player' ? 1 : -1,
      damage: 0, armor: kind === 'boss' ? 405 : kind === 'warden' ? 210 : 0, mount: kind === 'rider' ? 30 : 0, leaderId: null, guard: kind === 'sentinel' ? 40 : 0, alive: true,
      state: 'idle', stateTime: 0, invulnerable: 0, scale: kind === 'boss' ? 2.65 : kind === 'warden' ? 1.85 : kind === 'bruiser' ? 1.25 : kind === 'minion' ? 0.58 : kind === 'drone' ? 0.8 : 1,
      bossPhase: kind === 'boss' ? 'armored' : null, phaseChanges: 0, tactic: '',
      attack: null, telegraph: 0, aim: null,
    };
    if (kind !== 'player' && (this.modifiers.includes('armor') || this.modifiers.includes('commander'))) { actor.armor *= 1.4; actor.guard *= 1.4; actor.mount *= 1.4; }
    this.resetMemory(actor);
    return actor;
  }

  private resetMemory(actor: Actor): void {
    this.memories.set(actor.id, {
      phaseTimer: 0, actionTimer: 0, forced: 0, jumps: 0, airDodgeUsed: false, recoveryUsed: false, lastJumpHeld: false,
      upgradeAirUsed: false, upgradeNormalHits: 0, upgradeFlow: 0,
      charge: 0, chargeDirection: 'forward', strike: null,
      comboStage: 0, comboTimer: 0, dashTimer: 0,
      cooldown: 0.5 + this.random() * 1.0, pattern: 0, grabTarget: null, grabbedBy: null,
      grabTimer: 0, respawnTimer: 0, spawnTime: 0, bossBroken: false, hazardCooldown: 0,
    });
  }

  private memory(actor: Actor): ActorMemory {
    let memory = this.memories.get(actor.id);
    if (!memory) { this.resetMemory(actor); memory = this.memories.get(actor.id); }
    return memory!;
  }

  private updatePlayer(dt: number, input: InputFrame): void {
    const w = this.world;
    const p = w.player;
    if (!p.alive) return;
    const m = this.memory(p);
    const ground = this.isGrounded(p);
    const wasJumpHeld = m.lastJumpHeld;
    m.lastJumpHeld = input.jumpHeld;
    let free = m.actionTimer <= 0;
    let cancelled: CancelAction | undefined;
    if (!free && p.state === 'attack' && p.attack?.move && m.strike) {
      const requests: CancelAction[] = [];
      if (this.actions.peek('dodge') && (ground || !m.airDodgeUsed)) requests.push('dodge');
      if (this.actions.peek('jump') && (ground || m.jumps < 2)) requests.push('jump');
      const special = this.actions.peek('special');
      if (special && this.canUseSpecial(special)) requests.push('special');
      if (this.actions.peek('attack')) requests.push('attack');
      cancelled = requests.find(action => canCancel(p.attack!.move!, p.attack!.elapsed * 60, m.strike!.connected, action));
      if (cancelled) {
        // Only the approved action can run this tick; other presses remain bounded by their expiry.
        free = true; m.actionTimer = 0; m.strike = null; p.attack = null; p.state = ground ? 'idle' : 'fall';
      }
    }
    const requested = (action: BufferedAction) => free && (!cancelled || cancelled === action) && this.actions.peek(action);
    if (p.state === 'grabbed') return;
    if (p.state === 'hurt') {
      // Directional influence: a modest adjustment during hitstun, not an escape.
      p.vx += input.moveX * dt * 4;
      p.vz += input.moveZ * dt * 2;
      return;
    }
    if (p.state === 'grab') {
      const target = w.enemies.find((enemy) => enemy.id === m.grabTarget && enemy.alive);
      m.grabTimer -= dt;
      if (!target || m.grabTimer <= 0) { this.releaseGrab(p); return; }
      const action = (['attack', 'smash', 'grab'] as const).find(key => this.actions.peek(key));
      if (action || Math.abs(input.moveX) > 0.4 || Math.abs(input.moveZ) > 0.4) {
        const throwing = action ? this.actions.consume(action, input) : input;
        this.throwTarget(p, target, this.direction(throwing, p.facing));
      }
      return;
    }
    if (p.state === 'charge') {
      m.charge = Math.min(1, m.charge + dt / 0.85);
      if (p.attack) p.attack.charge = m.charge;
      p.vx *= Math.exp(-dt * 18);
      p.vz *= Math.exp(-dt * 18);
      if (!input.smashHeld || m.charge >= 1) this.releaseSmash();
      return;
    }
    if (input.dash && ground && free && !cancelled) m.dashTimer = 0.25;

    if (requested('dodge') && (ground || !m.airDodgeUsed)) {
      const dodge = this.actions.consume('dodge', input);
      const magnitude = Math.hypot(dodge.moveX, dodge.moveZ);
      // Dodges grant no invulnerability: they avoid attacks only by moving out of them.
      // Up (moveZ < 0) is the far lane (−Z) and down the near lane (+Z), on the ground and in the air.
      const dirX = magnitude > 0.3 ? dodge.moveX / magnitude : 0, dirZ = magnitude > 0.3 ? dodge.moveZ / magnitude : 0;
      if (ground) {
        p.state = 'dodge'; p.stateTime = 0;
        m.actionTimer = DODGE.groundDuration;
        p.vx = magnitude > 0.3 ? dirX * DODGE.groundX : p.facing * DODGE.groundX;
        p.vz = dirZ * DODGE.groundZ;
        w.lastMove = 'GROUND DASH';
      } else {
        p.state = 'airdodge'; p.stateTime = 0;
        m.actionTimer = DODGE.airDuration;
        m.airDodgeUsed = true;
        p.vx = dirX * DODGE.air;
        p.vy = 0;
        p.vz = dirZ * DODGE.airZ;
        w.lastMove = 'AIR DODGE';
      }
      w.events.push({ type: 'dodge' });
      this.effect('trail', p.x, p.y + 0.8, p.z, 0.35, 1.3, w.loadout.color);
      return;
    }

    let jumped = false;
    if (requested('jump') && (ground || m.jumps < 2)) {
      this.actions.consume('jump', input);
      m.jumps = ground ? 1 : m.jumps + 1;
      p.vy = m.jumps === 1 ? 11 : 10.5;
      p.state = 'jump'; p.stateTime = 0;
      m.actionTimer = 0;
      jumped = true;
      w.lastMove = m.jumps === 1 ? 'JUMP' : 'DOUBLE JUMP';
      w.events.push({ type: 'jump' });
      this.effect('shockwave', p.x, Math.max(0.02, p.y), p.z, 0.28, 0.8, w.loadout.color);
    }
    const ordinaryAerial = p.state === 'attack' && p.attack?.kind === 'aerial';
    if ((wasJumpHeld || jumped) && !input.jumpHeld && p.vy > 5.2 && p.state !== 'airdodge' && (p.state !== 'attack' || ordinaryAerial)) p.vy = 5.2;

    // A jump changes velocity before integration; a simultaneous attack is already aerial.
    const actionGround = this.isGrounded(p);
    const special = requested('special');
    if (special && this.canUseSpecial(special)) { this.special(this.actions.consume('special', input)); return; }
    if (requested('grab') && actionGround) { this.actions.consume('grab', input); this.grab(); return; }
    if (requested('smash') && actionGround) {
      const smash = this.actions.consume('smash', input);
      const aimX = smash.aimX ?? smash.moveX;
      const facing = aimX > 0.3 ? 1 : aimX < -0.3 ? -1 : p.facing;
      p.facing = facing;
      m.charge = 0;
      m.chargeDirection = this.direction(smash, facing);
      if (m.chargeDirection === 'neutral') m.chargeDirection = 'forward';
      p.state = 'charge'; p.stateTime = 0;
      p.attack = { name: 'CHARGING', kind: 'smash', direction: m.chargeDirection, elapsed: 0, duration: 1, range: 3, charge: 0, activeStart: 1, activeEnd: 1, combo: 0 };
      w.lastMove = `${m.chargeDirection.toUpperCase()} SMASH // CHARGE`;
      return;
    }
    const attackAction = requested('attack') ? 'attack' : requested('smash') ? 'smash' : null;
    if (attackAction) {
      const attack = this.actions.consume(attackAction, input);
      const direction = this.direction(attack, p.facing);
      if (!actionGround) {
        this.playerAttack('aerial', direction);
        this.movePlayer(dt, input, false);
      } else if (!cancelled && (attack.dash || m.dashTimer > 0 || Math.abs(p.vx) > 8.2 * w.loadout.speed)) {
        if (Math.abs(attack.moveX) > 0.3) p.facing = attack.moveX > 0 ? 1 : -1;
        this.playerAttack('dash', 'forward');
      } else if (direction !== 'neutral') {
        const aimX = attack.aimX ?? attack.moveX;
        if (Math.abs(aimX) > 0.3) p.facing = aimX > 0 ? 1 : -1;
        this.playerAttack('tilt', direction === 'back' ? 'forward' : direction);
      } else this.playerAttack('jab', 'neutral');
      return;
    }
    this.movePlayer(dt, input, free);
  }

  private movePlayer(dt: number, input: InputFrame, free: boolean): void {
    const w = this.world, p = w.player, m = this.memory(p);
    const ground = this.isGrounded(p);
    const ordinaryAerial = !ground && p.state === 'attack' && p.attack?.kind === 'aerial';
    if ((!free && !ordinaryAerial) || p.state === 'airdodge' || p.state === 'dodge') return;
    if (ground && Math.abs(input.moveX) > 0.15) p.facing = input.moveX > 0 ? 1 : -1;
    const speed = (m.dashTimer > 0 ? 10.4 : 6.2) * w.loadout.speed * this.upgradeMovementScale() * relicEffect(this.run?.economy.relics ?? [], 'movement');
    const targetX = input.moveX * speed;
    p.vx = approach(p.vx, targetX, dt * (ground ? 46 : 17));
    p.vz = approach(p.vz, input.moveZ * 4.4 * w.loadout.speed * this.upgradeMovementScale() * relicEffect(this.run?.economy.relics ?? [], 'movement'), dt * (ground ? 35 : 14));
    if (!ordinaryAerial) p.state = !ground ? p.vy > 0 ? 'jump' : 'fall' : Math.hypot(p.vx, p.vz) > 0.4 ? 'run' : 'idle';
    if (!ground && input.moveZ > 0.65 && p.vy < 0) p.vy = Math.max(-22, p.vy - dt * 55);
  }

  private direction(input: Pick<InputFrame, 'moveX' | 'moveZ' | 'aimX' | 'aimZ'>, facing: number): AttackDirection {
    const x = input.aimX ?? input.moveX, z = input.aimZ ?? input.moveZ;
    if (Math.abs(z) > 0.5 && Math.abs(z) >= Math.abs(x) * 0.8) return z < 0 ? 'up' : 'down';
    if (Math.abs(x) > 0.3) return Math.sign(x) === facing ? 'forward' : 'back';
    return 'neutral';
  }

  private canUseSpecial(input: Pick<InputFrame, 'moveX' | 'moveZ' | 'aimX' | 'aimZ'>): boolean {
    return this.direction(input, this.world.player.facing) === 'up'
      ? !this.memory(this.world.player).recoveryUsed
      : this.world.specialCooldown <= 0;
  }

  private playerAttack(kind: AttackKind, direction: AttackDirection, charge = 0): void {
    const w = this.world;
    const p = w.player;
    const m = this.memory(p);
    if (kind === 'jab') {
      m.comboStage = m.comboTimer > 0 ? (m.comboStage + 1) % 3 : 0;
      m.comboTimer = 0.85;
    }
    const move = playerMove(w.loadout, kind, direction, m.comboStage, charge);
    if (kind === 'dash') { p.vx = p.facing * 9; m.dashTimer = 0; }
    this.beginMove(p, move);
    w.lastMove = move.name;
    if (kind === 'smash') w.events.push({ type: 'smash', intensity: charge });
  }

  private releaseSmash(): void {
    const m = this.memory(this.world.player);
    this.playerAttack('smash', m.chargeDirection, m.charge);
  }

  private beginMove(actor: Actor, move: MoveDefinition): void {
    if (actor.kind === 'player') move = upgradeMove(move, this.world.upgrades);
    const m = this.memory(actor);
    actor.state = 'attack'; actor.stateTime = 0;
    m.actionTimer = totalFrames(move) / 60;
    m.strike = {
      move, connected: false, previous: { x: actor.x, y: actor.y, z: actor.z, facing: actor.facing },
      damage: move.damage, force: move.force, growth: move.growth, angle: move.angle,
      activeStart: move.frames.startup / 60, activeEnd: (move.frames.startup + move.frames.active) / 60,
      depth: move.shape.depth, height: move.shape.height, hit: new Set(),
      radial: move.shape.trajectory === 'orbit' || move.shape.trajectory === 'burst',
      projectile: ['projectile', 'cannon', 'mortar'].includes(move.behavior), tip: move.shape.tip, fired: false, source: actor.id,
    };
    actor.attack = { move, name: move.name, kind: move.kind, direction: move.direction, elapsed: 0,
      duration: m.actionTimer, range: move.shape.reach, charge: move.charge,
      activeStart: m.strike.activeStart, activeEnd: m.strike.activeEnd, combo: move.combo };
    actor.aim = actor.kind === 'player' ? null : { x: this.world.player.x, y: this.world.player.y, z: this.world.player.z };
  }

  private beginAttack(actor: Actor, kind: AttackKind, direction: AttackDirection, name: string, duration: number, range: number, charge: number, options: Partial<Strike>): void {
    this.beginMove(actor, utilityMove(options.id ?? 'enemy.strike', name, kind, direction, duration, range, {
      behavior: options.behavior ?? (options.projectile ? 'projectile' : 'melee'),
      pose: actor.kind === 'player' ? this.world.loadout.weapon : ['boss', 'warden', 'bruiser'].includes(actor.kind) ? 'pile' : 'arc',
      startup: (options.activeStart ?? 0.2) * 60, end: (options.activeEnd ?? 0.35) * 60,
      radial: options.radial, depth: options.depth, height: options.height, charge,
      damage: options.damage ?? 8, force: options.force ?? 6, growth: options.growth ?? 0.065, angle: options.angle ?? 0.55,
    }));
  }

  private prepareAttack(actor: Actor, dt: number): void {
    const attack = actor.attack;
    const strike = this.memory(actor).strike;
    if (attack && !strike && actor.state === 'attack') attack.elapsed += dt;
    if (!attack || !strike || actor.state !== 'attack') return;
    strike.previous = { x: actor.x, y: actor.y, z: actor.z, facing: actor.facing };
    attack.elapsed += dt;
    actor.telegraph = attack.elapsed < strike.activeStart ? 1 - attack.elapsed / strike.activeStart : 0;
    if (strike.move.behavior === 'leap' && attack.elapsed > strike.activeEnd) {
      actor.vx = approach(actor.vx, 0, dt * 24);
      actor.vz = approach(actor.vz, 0, dt * 24);
    }
    if (strike.move.behavior === 'rush') {
      if (attack.elapsed >= strike.activeStart && attack.elapsed <= strike.activeEnd) {
        actor.vx = actor.facing * (actor.kind === 'rider' ? 14 : actor.kind === 'charger' ? 13 : 9);
        actor.vz = 0;
        if (actor.kind === 'drone' && actor.y > 0.1) actor.vy = -4;
        this.memory(actor).forced = 0.08;
      } else { actor.vx = 0; actor.vz = 0; }
    }
    if (!strike.motionStarted && attack.elapsed >= strike.activeStart && strike.move.behavior === 'leap' && actor.aim) {
      strike.motionStarted = true;
      actor.vy = 10;
      actor.vx = clamp((actor.aim.x - actor.x) / .75, -7, 7);
      actor.vz = clamp((actor.aim.z - actor.z) / .75, -4, 4);
      this.memory(actor).forced = .85;
    }
  }

  private updateAttack(actor: Actor, dt: number): void {
    const attack = actor.attack, strike = this.memory(actor).strike;
    if (!attack || !strike || actor.state !== 'attack') return;
    const previous = strike.previous;
    const frame = attack.elapsed * 60;
    const checkedPose = sampleWeapon(actor, strike.move, frame);
    attack.collision = { capsule: checkedPose, frame, active: !['none','area','projectile','cannon','mortar'].includes(strike.move.behavior) && strike.move.frames.active > 0 && frame >= strike.move.frames.startup && frame <= strike.move.frames.startup + strike.move.frames.active };
    if (strike.move.behavior === 'area') return;
    if (attack.elapsed < strike.activeStart || attack.elapsed - dt > strike.activeEnd) return;
    if (strike.projectile && !strike.fired) {
      strike.fired = true;
      this.fireAttack(actor, strike);
      return;
    }
    if (strike.projectile) return;
    if (!strike.fired) {
      strike.fired = true;
      const color = actor.kind === 'player' ? this.world.loadout.color : 0xff6b67;
      this.effect(attack.direction === 'down' || strike.radial ? 'shockwave' : 'trail', actor.x + actor.facing * attack.range * 0.4, actor.y + 0.9, actor.z, 0.25, attack.range, color);
      if (actor.kind === 'player') this.emitUpgradeAttack(actor, strike);
      if (actor.kind === 'boss' && strike.move.id === 'boss.slam') {
        this.effect('shockwave', actor.x, 0.08, actor.z, 0.7, 5, 0xff624e);
        this.world.shake = Math.max(this.world.shake, 0.35);
      }
    }
    const from = (attack.elapsed - dt) * 60, to = attack.elapsed * 60;
    for (const prop of this.world.props) {
      if (!prop.alive || prop.hp <= 0 || strike.hit.has(prop.id)) continue;
      const box = laneAssist({ min: { x: prop.x - prop.width / 2, y: 0, z: prop.z - prop.depth / 2 }, max: { x: prop.x + prop.width / 2, y: prop.height, z: prop.z + prop.depth / 2 } }, assistedBy(actor.kind));
      if (sweptContact(actor, strike.move, from, to, box, previous, checkedPose) !== null) {
        strike.hit.add(prop.id); this.damageProp(prop, strike.damage, actor);
      }
    }
    const targets = actor.kind === 'player' ? this.world.enemies : [this.world.player];
    for (const target of targets) {
      if (!target.alive || target.invulnerable > 0 || strike.hit.has(target.id) || target.state === 'grabbed') continue;
      // Player strikes get the Z-only lane assist; enemy strikes test the player's exact body box.
      const multiplier = sweptContact(actor, strike.move, from, to, laneAssist(bodyHurtbox(target), assistedBy(actor.kind)), previous, checkedPose);
      if (multiplier !== null) {
        strike.hit.add(target.id); strike.connected = true;
        const facing = strike.radial ? (target.x >= actor.x ? 1 : -1) : attack.direction === 'back' ? -actor.facing : actor.facing;
        const vault = actor.kind === 'player' && multiplier > 1 && ['jab', 'tilt', 'aerial'].includes(attack.kind) && !['up', 'down'].includes(attack.direction) ? upgradeRank(this.world.upgrades, 'lance-vault') : 0;
        const landed = this.hit(target, actor, strike.damage * multiplier, vault ? 6 + vault * 2 : strike.force * multiplier, strike.growth, vault ? 1.25 : strike.angle, facing as 1 | -1, attack.kind);
        if (actor.kind === 'player' && landed) this.applyWeaponUpgrade(actor, target, strike, multiplier > 1);
        // A down-normal launcher holds its target long enough for any weapon's up attack to follow.
        if (actor.kind === 'player' && landed && popsUp(strike.move) && target.state === 'hurt') {
          const stunned = this.memory(target);
          stunned.actionTimer = Math.max(stunned.actionTimer, POP_STUN);
        }
        if (multiplier > 1) this.effect('text', target.x, target.y + 2.3, target.z, 0.5, 1, 0x79cfff, 'TIP HIT');
      }
    }
    strike.previous = { x: actor.x, y: actor.y, z: actor.z, facing: actor.facing };
  }

  private upgradeMovementScale(): number {
    return this.memory(this.world.player).upgradeFlow > 0 ? 1 + upgradeRank(this.world.upgrades, 'razor-flow') * .16 : 1;
  }

  private emitUpgradeAttack(actor: Actor, strike: Strike): void {
    const w = this.world, quake = upgradeRank(w.upgrades, 'pile-quake'), echo = upgradeRank(w.upgrades, 'arc-echo');
    if (w.loadout.weapon === 'pile' && quake && strike.move.kind === 'smash' && this.isGrounded(actor)) {
      this.upgradeBursts.push({ x: actor.x, y: actor.y, z: actor.z, delay: .18, radius: 2.6 + quake * .5, damage: (5 + quake * 3) * w.loadout.power, force: 5 + quake * 2 });
    }
    if (w.loadout.weapon === 'arc' && echo && strike.move.kind === 'jab' && strike.move.combo === 2) {
      const shot: Projectile = { id: `echo-${this.serial++}`, kind: 'bolt', ownerId: actor.id, x: actor.x + actor.facing * .8, y: actor.y + 1, z: actor.z, vx: actor.facing * 12, vy: 0, vz: 0, radius: .3, life: .55, color: w.loadout.color };
      w.projectiles.push(shot);
      this.shots.set(shot.id, { originStrike: strike, kind: 'jab', damage: (4 + echo * 3) * w.loadout.power, force: 4, growth: .04, facing: actor.facing, hit: new Set(), pierce: 1 });
    }
  }

  private applyWeaponUpgrade(actor: Actor, target: Actor, strike: Strike, tip: boolean): void {
    const w = this.world, m = this.memory(actor), rank = (id: UpgradeId) => upgradeRank(w.upgrades, id);
    if (['special', 'enemy', 'throw'].includes(strike.move.kind)) return;
    if (w.loadout.weapon === 'lance' && tip && rank('lance-capacitor') && !strike.tipRefunded) {
      strike.tipRefunded = true;
      w.specialCooldown = Math.max(0, w.specialCooldown - rank('lance-capacitor') * .35);
      this.effect('text', actor.x, actor.y + 2, actor.z, .6, 1, w.loadout.color, 'TIP CHARGE');
    }
    if (w.loadout.weapon === 'arc' && rank('arc-skyhook') && strike.move.kind === 'aerial' && actor.y > .05 && !m.upgradeAirUsed) {
      m.upgradeAirUsed = true; m.jumps = Math.min(m.jumps, 1); actor.vy = Math.max(actor.vy, 4.5 + rank('arc-skyhook') * 1.5);
      this.effect('text', actor.x, actor.y + 2, actor.z, .7, 1, w.loadout.color, 'SKY LINK');
    }
    if (w.loadout.weapon === 'razor' && rank('razor-flow')) {
      m.upgradeNormalHits++;
      if (m.upgradeNormalHits % 3 === 0) { m.upgradeFlow = 2; this.effect('text', actor.x, actor.y + 2, actor.z, .7, 1, w.loadout.color, 'COMBO DRIVE'); }
    }
    if (w.loadout.weapon === 'scythe') {
      if (rank('scythe-pull') && ['jab', 'tilt'].includes(strike.move.kind) && target.armor <= 0 && target.bossPhase !== 'transition') {
        target.vx = clamp((actor.x - target.x) * (2 + rank('scythe-pull')), -8, 8);
        target.vz = clamp((actor.z - target.z) * (2 + rank('scythe-pull')), -5, 5);
        target.vy = Math.min(target.vy, 2);
      }
      strike.upgradeTargets ??= new Set(); strike.upgradeTargets.add(target.id);
      if (rank('scythe-chain') && strike.upgradeTargets.size >= 2 && !strike.upgradeTriggered) {
        strike.upgradeTriggered = true;
        this.upgradeBursts.push({ x: actor.x, y: actor.y, z: actor.z, delay: .18, radius: 3 + rank('scythe-chain') * .4, damage: (4 + rank('scythe-chain') * 3) * w.loadout.power, force: 7 + rank('scythe-chain') * 2 });
      }
    }
  }

  private updateUpgradeBursts(dt: number): void {
    const w = this.world;
    if (!w.player.alive || w.phase !== 'playing') { this.upgradeBursts = []; return; }
    for (const burst of this.upgradeBursts) {
      burst.delay -= dt;
      if (burst.delay > 0) continue;
      this.effect('shockwave', burst.x, burst.y + .15, burst.z, .45, burst.radius * 2, w.loadout.color);
      const origin = { ...w.player, x: burst.x, y: burst.y, z: burst.z };
      for (const enemy of w.enemies) if (enemy.alive && enemy.invulnerable <= 0 && Math.abs(enemy.y - burst.y) < 1.6 && Math.hypot(enemy.x - burst.x, enemy.z - burst.z) < burst.radius) {
        this.hit(enemy, origin, burst.damage, burst.force, .06, .6, enemy.x >= burst.x ? 1 : -1, 'smash');
      }
    }
    this.upgradeBursts = this.upgradeBursts.filter((burst) => burst.delay > 0).slice(-16);
  }

  private special(input: InputFrame): void {
    const w = this.world, p = w.player, m = this.memory(p);
    const direction = this.direction(input, p.facing);
    if (!this.canUseSpecial(input)) return;
    const aimX = input.aimX ?? input.moveX;
    if (Math.abs(aimX) > 0.3) p.facing = aimX > 0 ? 1 : -1;
    const move = specialMove(w.loadout, direction);
    if (direction !== 'up') w.specialCooldown = (w.loadout.special === 'vortex' ? 2.6 : 1.45) * (w.loadout.trait === 'overclocked' ? 0.65 : 1);
    if (direction === 'up') {
      m.recoveryUsed = true; w.recoveryAvailable = false;
      p.vy = 14.5; p.vx = input.moveX * 5; m.jumps = Math.max(m.jumps, 1);
    } else if (direction === 'down') p.vy = p.y > 0.2 ? -14 : p.vy;
    else if (move.behavior === 'phase') {
      const cross = direction === 'neutral' ? w.loadout.modules.neutral === 'focused' : w.loadout.modules.side === 'cross';
      p.vx = p.facing * (cross ? 12 : 8); p.invulnerable = cross ? 0.22 : 0.12; m.forced = 0.28;
      this.effect('trail', p.x, p.y + 0.9, p.z, 0.55, 3, w.loadout.color);
    } else if (w.loadout.special === 'vortex') {
      const radius = w.loadout.modules.neutral === 'split' ? 8 : 6;
      for (const enemy of w.enemies) if (enemy.alive && enemy.invulnerable <= 0 && enemy.bossPhase !== 'transition' && Math.hypot(enemy.x - p.x, enemy.z - p.z) < radius && enemy.armor <= 0) {
        enemy.vx = (p.x - enemy.x) * 3.2; enemy.vz = (p.z - enemy.z) * 3.2;
        enemy.state = 'hurt'; enemy.stateTime = 0; enemy.attack = null;
        this.memory(enemy).strike = null; this.memory(enemy).actionTimer = 0.23;
      }
      this.effect('shockwave', p.x, p.y + 0.2, p.z, .8, move.shape.reach, 0xa18bff);
    }
    this.beginMove(p, move); w.lastMove = `SPECIAL // ${move.name}`;
    w.events.push({ type: 'special' });
  }

  private grab(): void {
    const w = this.world, p = w.player, m = this.memory(p);
    const target = w.enemies.filter((enemy) => enemy.alive && enemy.invulnerable <= 0 && enemy.armor <= 0 && Math.abs(enemy.z - p.z) < 1.3 && Math.abs(enemy.y - p.y) < 1.6 && (enemy.x - p.x) * p.facing > -0.4 && (enemy.x - p.x) * p.facing < 2.15).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    p.vx = 0; p.vz = 0;
    if (!target) {
      this.beginAttack(p, 'throw', 'forward', 'GRAB / MISS', 0.36, 1.7, 0, { id: 'utility.grab-miss', behavior: 'none', activeStart: 0, activeEnd: 0 });
      w.lastMove = 'GRAB / MISS';
      return;
    }
    p.state = 'grab'; p.stateTime = 0; p.attack = null;
    m.grabTarget = target.id; m.grabTimer = 1.4; m.strike = null;
    target.state = 'grabbed'; target.stateTime = 0; target.attack = null;
    const tm = this.memory(target);
    tm.grabbedBy = p.id; tm.actionTimer = 2; tm.strike = null;
    target.vx = 0; target.vy = 0; target.vz = 0;
    w.lastMove = 'GRAB // DIRECTION TO THROW';
    w.events.push({ type: 'grab' });
  }

  private throwTarget(source: Actor, target: Actor, direction: AttackDirection): void {
    this.releaseGrab(source);
    const facing = direction === 'back' ? -source.facing : source.facing;
    const angle = direction === 'up' ? 1.35 : direction === 'down' ? -0.8 : 0.45;
    this.hit(target, source, 13 * this.world.loadout.power, direction === 'up' ? 11 : 10, 0.13, angle, facing as 1 | -1, 'throw');
    source.state = 'attack'; source.stateTime = 0;
    source.attack = { move: utilityMove(`throw.${direction}`, `${direction.toUpperCase()} THROW`, 'throw', direction, .32, 2, { behavior: 'none', startup: 0, end: 0 }), name: `${direction.toUpperCase()} THROW`, kind: 'throw', direction, elapsed: 0, duration: 0.32, range: 2, charge: 0, activeStart: 0, activeEnd: 0.16, combo: 0 };
    this.memory(source).actionTimer = 0.32;
    this.world.lastMove = `${direction.toUpperCase()} THROW`;
    this.world.events.push({ type: 'throw' });
  }

  private releaseGrab(source: Actor): void {
    const m = this.memory(source);
    const target = this.world.enemies.find((enemy) => enemy.id === m.grabTarget);
    if (target) { this.memory(target).grabbedBy = null; target.state = target.y > 0.1 ? 'fall' : 'idle'; this.memory(target).actionTimer = 0; }
    m.grabTarget = null; m.grabTimer = 0;
    if (source.state === 'grab') source.state = 'idle';
  }

  private updateGrabPositions(dt: number): void {
    const p = this.world.player, m = this.memory(p);
    if (p.state !== 'grab' || !m.grabTarget) return;
    const target = this.world.enemies.find((enemy) => enemy.id === m.grabTarget);
    if (!target) return;
    target.x = p.x + p.facing * 1.1;
    target.y = p.y + 0.25 + Math.sin(this.world.time * 22) * 0.025;
    target.z = p.z;
    target.stateTime += dt;
  }

  private enemyCombatProfile(enemy: Actor) {
    const boss = enemy.kind === 'boss' || enemy.kind === 'warden';
    const ranged = ['gunner', 'artillery', 'captain', 'sniper', 'sapper'].includes(enemy.kind);
    const mounted = enemy.kind === 'rider' && enemy.mount > 0;
    const rush = enemy.kind === 'charger' || enemy.kind === 'drone' || mounted;
    const reach = boss ? 3.4 : enemy.kind === 'sniper' ? 12 : enemy.kind === 'sapper' ? 5 : enemy.kind === 'artillery' ? 10 : enemy.kind === 'captain' ? 4.5 : ranged ? 6.8 : rush ? 5.5 : enemy.kind === 'leaper' ? 4.8 : 2;
    const speed = mounted ? 4.4 : enemy.kind === 'minion' ? 4.1 : enemy.kind === 'artillery' ? 1.6 : enemy.kind === 'bruiser' ? 2 : boss ? 1.65 : enemy.kind === 'sentinel' ? 2.2 : enemy.kind === 'scout' ? 3.8 : 3.1;
    return { boss, ranged, mounted, rush, reach, speed: speed * (this.modifiers.includes('haste') || this.modifiers.includes('berserk') && enemy.damage >= 60 ? 1.25 : 1) };
  }

  /** This same gate feeds arbitration and execution: unavailable roles cannot block ready actors. */
  private enemyCanAttack(enemy: Actor): boolean {
    const w = this.world, p = w.player, m = this.memory(enemy);
    if (!p.alive || !enemy.alive || enemy.bossPhase === 'transition' || enemy.invulnerable > 0
      || !['idle', 'run', 'jump', 'fall'].includes(enemy.state) || m.cooldown > 0 || m.actionTimer > 0 || m.forced > 0
      || !this.onPlatform(enemy) || enemy.y < 0) return false;
    const { boss, ranged, reach } = this.enemyCombatProfile(enemy);
    const dx = p.x - enemy.x, dz = p.z - enemy.z;
    return boss || (Math.abs(dx) <= reach + 0.3
      && Math.abs(dz) < (['artillery', 'sniper', 'sapper'].includes(enemy.kind) ? 7 : ranged ? 1.8 : 1.15)
      && (ranged || Math.abs(p.y - enemy.y) < 2.6));
  }

  private updateEnemy(enemy: Actor, dt: number): void {
    const w = this.world, p = w.player;
    if (!enemy.alive) return;
    const m = this.memory(enemy);
    if (enemy.state === 'recover') {
      enemy.vx = approach(enemy.vx, clamp((clamp(enemy.x, w.arenaMin + 2, w.arenaMax - 2) - enemy.x) * 4, -8, 8), dt * 12);
      enemy.vz = approach(enemy.vz, clamp(-enemy.z * 3, -6, 6), dt * 12);
      return;
    }
    if (enemy.state === 'grabbed' || enemy.state === 'hurt' || enemy.bossPhase === 'transition') return;
    if (w.mode !== 'training' && !this.onPlatform(enemy) && !m.recoveryUsed && m.forced <= 0 && enemy.y > -3.5 && enemy.y < 5
      && enemy.x > w.arenaMin - 5 && enemy.x < w.arenaMax + 5 && Math.abs(enemy.z) < 7) {
      m.recoveryUsed = true; m.actionTimer = 0.75; m.forced = 0.75;
      m.strike = null;
      enemy.state = 'recover'; enemy.stateTime = 0;
      enemy.attack = null; enemy.telegraph = 0; enemy.aim = null;
      enemy.vx = clamp((clamp(enemy.x, w.arenaMin + 2, w.arenaMax - 2) - enemy.x) * 4, -8, 8);
      enemy.vz = clamp(-enemy.z * 3, -6, 6); enemy.vy = enemy.kind === 'drone' ? 17 : 15.5;
      this.effect('trail', enemy.x, enemy.y, enemy.z, 0.6, 2, 0x70dfff);
      this.effect('text', enemy.x, enemy.y + 1.8, enemy.z, 0.8, 1, 0x70dfff, 'BOOST RECOVERY');
      return;
    }
    if (!p.alive || enemy.state === 'attack') return;
    enemy.telegraph = 0;
    enemy.aim = null;
    const dx = p.x - enemy.x;
    if (enemy.kind === 'drone' && m.forced <= 0 && this.onPlatform(enemy)) {
      enemy.y += (1.5 + Math.sin(w.time * 2.7 + m.spawnTime) * 0.18 - enemy.y) * Math.min(1, dt * 8);
      enemy.vy = 0;
    }
    if (w.mode === 'training') {
      enemy.vx = approach(enemy.vx, 0, dt * 16);
      enemy.vz = approach(enemy.vz, 0, dt * 16);
      enemy.state = 'idle';
      return;
    }
    enemy.facing = dx >= 0 ? 1 : -1;
    const { boss, ranged, mounted, reach, speed } = this.enemyCombatProfile(enemy);
    const plan = this.director.plan(enemy, w);
    enemy.tactic = plan.action;
    const slot = w.enemies.indexOf(enemy);
    // Scouts approach different flanks; support units maintain firing distance.
    const flank = enemy.kind === 'scout' && Math.abs(dx) > 3 ? (slot % 2 ? 1 : -1) * 1.4 : 0;
    let targetVX = Math.abs(dx) > reach ? Math.sign(dx) * speed : 0;
    let targetVZ = Math.abs(plan.lane - enemy.z + flank) > 0.45 ? Math.sign(plan.lane - enemy.z + flank) * speed * 0.75 : 0;
    if (ranged && Math.abs(dx) < 3.6) targetVX = -Math.sign(dx) * 2.8;
    // Brief disengagement makes a scout's strike/recovery rhythm readable.
    if (enemy.kind === 'scout' && m.pattern > 0 && m.cooldown > 1.3 && Math.abs(dx) < 2.8) targetVX = -Math.sign(dx) * 2;
    if (enemy.kind === 'minion' && enemy.leaderId && Math.abs(dx) > 5) {
      const leader = w.enemies.find((ally) => ally.id === enemy.leaderId && ally.alive);
      if (leader) {
        const offset = slot % 2 ? 1.2 : -1.2;
        targetVX = clamp((leader.x + enemy.facing * 1.5 - enemy.x) * 2, -speed, speed);
        targetVZ = clamp((leader.z + offset - enemy.z) * 2, -speed, speed);
      }
    }
    for (const ally of w.enemies) {
      if (ally === enemy || !ally.alive || ally.state === 'grabbed') continue;
      const ax = enemy.x - ally.x, az = enemy.z - ally.z;
      const distance = Math.hypot(ax, az);
      if (distance < 1.4) {
        const away = distance > 0.05 ? az / distance : slot > w.enemies.indexOf(ally) ? 1 : -1;
        targetVZ += away * (1.4 - distance) * 2.5;
      }
    }
    for (const prop of w.props) {
      if (!prop.alive) continue;
      const dangerous = prop.kind === 'vent' && prop.phase !== 'idle';
      if ((prop.hp > 0 || dangerous) && insideProp(prop, enemy.x + targetVX * 0.3, enemy.z + targetVZ * 0.3, 0.55)) {
        // Go around machinery toward the open central lane.
        targetVZ += (enemy.z === prop.z ? prop.z > 0 ? -1 : 1 : Math.sign(enemy.z - prop.z)) * speed;
      }
    }
    if ((enemy.x < w.arenaMin + 1 && targetVX < 0) || (enemy.x > w.arenaMax - 1 && targetVX > 0)) targetVX = 0;
    if ((enemy.z < -3.5 && targetVZ < 0) || (enemy.z > 3.5 && targetVZ > 0)) targetVZ = -Math.sign(enemy.z) * speed;
    enemy.vx = approach(enemy.vx, targetVX, dt * 14);
    enemy.vz = approach(enemy.vz, clamp(targetVZ, -speed, speed), dt * 12);
    enemy.state = Math.hypot(enemy.vx, enemy.vz) > 0.3 ? 'run' : 'idle';
    // The shared director reserves the whole telegraph, action, projectile and recovery window.
    if (!this.enemyCanAttack(enemy) || !this.director.reserve(enemy, w, 7)) return;
    enemy.tactic = 'COMMITTED';
    enemy.vx = 0; enemy.vz = 0;
    m.pattern++;
    m.cooldown = boss ? (enemy.armor > 0 ? 1.85 : 1.45) : enemy.kind === 'charger' ? 2.4 : 1.25 + this.random() * 0.65;
    if (enemy.kind === 'boss' && enemy.bossPhase === 'overdrive') {
      const pattern = (m.pattern - 1) % 3;
      if (pattern === 1) this.beginAttack(enemy, 'enemy', 'forward', 'OVERDRIVE / PULSE FAN', 1.15, 11, 0, { id: 'overdrive.pulse', behavior: 'projectile', damage: 18, force: 10, activeStart: .58, activeEnd: .75 });
      else this.castArea(enemy, pattern === 0 ? 'pincer' : 'overload');
      m.cooldown = Math.max(m.cooldown, 2);
    } else if (boss) {
      const pattern = (m.pattern - 1) % 4;
      if (pattern !== 1) this.castArea(enemy, pattern === 0 ? 'lanes' : pattern === 2 ? 'cross' : 'sweep');
      else {
        const windup = enemy.armor > 0 ? 1 : 0.85;
        if (Math.abs(dx) > 5) this.beginAttack(enemy, 'enemy', 'forward', 'MAINFRAME / LASER', 1.2, 9, 0, { id: 'boss.laser', damage: 16, force: 9, growth: 0.07, projectile: true, activeStart: 0.72 * windup, activeEnd: 0.8 });
        else if (Math.floor(m.pattern / 4) % 2 === 0) this.beginAttack(enemy, 'enemy', 'down', 'MAINFRAME / SLAM', 1.25, 4.6, 0, { id: 'boss.slam', behavior: 'melee', damage: 21, force: 10, growth: 0.075, radial: true, depth: 3.5, height: 1.4, activeStart: 0.75 * windup, activeEnd: 0.96, angle: 0.85 });
        else this.beginAttack(enemy, 'enemy', 'forward', 'MAINFRAME / SWEEP', 1.1, 5.1, 0, { id: 'boss.sweep', damage: 18, force: 11, growth: 0.07, depth: 2.9, height: 4, activeStart: 0.62 * windup, activeEnd: 0.86 });
      }
    } else if (enemy.kind === 'sniper' || enemy.kind === 'sapper') {
      this.castArea(enemy, enemy.kind === 'sniper' ? 'snipe' : 'mine');
    } else if (enemy.kind === 'artillery') {
      m.cooldown = 3.0;
      this.beginAttack(enemy, 'enemy', 'up', 'MORTAR SALVO', 1.55, 12, 0, { id: 'enemy.mortar', behavior: 'mortar', projectile: true, activeStart: 0.7, activeEnd: 0.8, damage: 12, force: 7 });
    } else if (enemy.kind === 'leaper') {
      m.cooldown = 2.2;
      this.beginAttack(enemy, 'enemy', 'down', 'LEAP STRIKE', 1.75, 1.8, 0, { id: 'enemy.leap', behavior: 'leap', damage: 10, force: 6, activeStart: 0.45, activeEnd: 1.28, depth: 1.1 });
    } else if (mounted) {
      m.cooldown = 2.65;
      this.beginAttack(enemy, 'enemy', 'forward', 'RIDER PASS', 1.65, 2.4, 0, { id: 'enemy.rider', behavior: 'rush', damage: 14, force: 8, activeStart: 0.7, activeEnd: 1.15, depth: 0.9 });
    } else if (ranged) {
      this.beginAttack(enemy, 'enemy', 'forward', 'PULSE SHOT', 1.05, 7, 0, { id: 'enemy.shot', projectile: true, activeStart: 0.62, activeEnd: 0.7, damage: 8, force: 5.5 });
    } else if (enemy.kind === 'charger') {
      this.beginAttack(enemy, 'enemy', 'forward', 'RAIL CHARGE', 1.5, 1.8, 0, { id: 'enemy.charge', behavior: 'rush', damage: 13, force: 8.5, growth: 0.06, activeStart: 0.65, activeEnd: 1.08, depth: 0.8 });
    } else if (enemy.kind === 'drone') {
      this.beginAttack(enemy, 'enemy', 'forward', 'SHOCK DIVE', 1.25, 1.9, 0, { id: 'enemy.dive', behavior: 'rush', damage: 8, force: 6, activeStart: 0.5, activeEnd: 0.9, depth: 0.9 });
    } else if (enemy.kind === 'sentinel') {
      this.beginAttack(enemy, 'enemy', 'forward', 'SHIELD BASH', 1.1, 2.5, 0, { id: 'enemy.bash', damage: 10, force: 7, activeStart: 0.58, activeEnd: 0.76 });
    } else if (enemy.kind === 'bruiser') {
      this.beginAttack(enemy, 'enemy', 'down', 'HAMMER SLAM', 1.2, 2.9, 0, { id: 'enemy.slam', damage: 16, force: 8, growth: 0.06, radial: true, depth: 2, height: 1.15, activeStart: 0.66, activeEnd: 0.86 });
    } else {
      this.beginAttack(enemy, 'enemy', 'forward', 'SERVO STRIKE', 0.8, 2.2, 0, { id: 'enemy.servo', damage: enemy.kind === 'minion' ? 4 : 7, force: enemy.kind === 'minion' ? 3.5 : 5, growth: 0.055, activeStart: 0.36, activeEnd: 0.5 });
    }
  }

  private castArea(enemy: Actor, pattern: AreaHazard['pattern']): void {
    const w = this.world, m = this.memory(enemy);
    const enraged = (enemy.kind === 'boss' || enemy.kind === 'warden') && enemy.armor <= 0;
    const zones = createPattern(pattern, `area-${this.serial++}`, enemy.id, w.arenaMin, w.arenaMax, w.player, Math.floor((m.pattern - 1) / 4), enraged);
    w.hazards.push(...zones);
    const duration = Math.max(...zones.map(h => h.delay + h.duration)) + 0.7;
    m.cooldown = duration + (enraged ? 0.45 : 0.8);
    this.beginAttack(enemy, 'enemy', 'down', `GRID / ${pattern.toUpperCase()}`, duration, 0, 0, { id: `${enemy.bossPhase === 'overdrive' ? 'overdrive' : 'grid'}.${pattern}`, behavior: 'area', activeStart: zones[0]!.delay, activeEnd: duration - 0.7, damage: 0, force: 0 });
  }

  private updateHazards(dt: number): void {
    const w = this.world, p = w.player;
    w.hazards = w.hazards.filter(h => w.enemies.some(e => e.id === h.ownerId && e.alive) || w.props.some(prop => prop.id === h.ownerId && prop.kind === 'node' && prop.alive));
    for (const zone of w.hazards) {
      zone.elapsed += dt;
      if (zone.hit || zone.elapsed < zone.delay || zone.elapsed >= zone.delay + zone.duration) continue;
      if (!p.alive || p.invulnerable > 0 || p.y < 0 || p.y >= zone.height || !insideHazard(zone, p.x, p.z)) continue;
      const node = w.props.find(prop => prop.id === zone.ownerId && prop.alive);
      const owner = w.enemies.find(e => e.id === zone.ownerId) ?? { ...p, id: zone.ownerId, kind: 'artillery' as const, x: node?.x ?? zone.x, z: node?.z ?? zone.z };
      this.hit(p, owner, zone.damage, zone.force, 0.055, 0.8, p.x > owner.x ? 1 : -1, 'enemy');
      // Intersecting arms of one cross/salvo cannot stack damage on one fighter.
      for (const sibling of w.hazards) if (sibling.group === zone.group) sibling.hit = true;
    }
    w.hazards = w.hazards.filter(h => h.elapsed < h.delay + h.duration);
  }

  private fireAttack(actor: Actor, strike: Strike): void {
    const w = this.world;
    if (actor.kind === 'player' && strike.move.behavior === 'cannon') {
      const facing = actor.attack!.direction === 'back' ? -actor.facing : actor.facing;
      const speed = 14, charged = actor.attack!.kind === 'smash';
      const split = charged ? upgradeRank(w.upgrades, 'cannon-split') : 0;
      for (const angle of split ? [-.27, 0, .27] : [0]) {
      const shot: Projectile = { id: `shot-${this.serial++}`, kind: 'bolt', ownerId: actor.id,
        x: actor.x + facing * 0.7, y: actor.y + 1, z: actor.z,
        vx: facing * speed * Math.cos(angle), vy: 0, vz: speed * Math.sin(angle), radius: charged ? 0.38 : 0.22,
        life: actor.attack!.range / speed, color: w.loadout.color };
      w.projectiles.push(shot);
      this.shots.set(shot.id, { originStrike: strike, kind: actor.attack!.kind, damage: strike.damage * (split ? split === 1 ? .6 : .75 : 1), force: strike.force, growth: strike.growth, facing: facing as 1 | -1, hit: new Set(), pierce: 1 + upgradeRank(w.upgrades, 'cannon-pierce'), bounces: upgradeRank(w.upgrades, 'cannon-bounce') });
      this.effect('hit', shot.x, shot.y, shot.z, 0.18, charged ? 1 : 0.5, w.loadout.color);
      }
      return;
    }
    const target = actor.kind === 'player' ? w.enemies.filter((e) => e.alive && (e.x - actor.x) * actor.facing > 0).sort((a, b) => Math.abs(a.z - actor.z) - Math.abs(b.z - actor.z))[0] : actor.aim;
    if (actor.kind === 'artillery' && target) {
      const travel = 1.15, y = actor.y + 2;
      const shot: Projectile = {
        id: `shot-${this.serial++}`, kind: 'mortar', ownerId: actor.id,
        x: actor.x, y, z: actor.z, vx: (target.x - actor.x) / travel,
        vy: (6 * travel * travel - y) / travel, vz: (target.z - actor.z) / travel,
        target: { x: target.x, z: target.z }, radius: 0.3, life: 2, color: 0xffcf65,
      };
      w.projectiles.push(shot);
      this.shots.set(shot.id, { owner: structuredClone(actor), kind: 'enemy', damage: strike.damage, force: strike.force, growth: strike.growth, facing: actor.facing });
      return;
    }
    const spread = actor.kind === 'player' && strike.move.id === 'special.pulse.split';
    const count = actor.kind === 'boss' || spread ? 3 : 1;
    for (let index = 0; index < count; index++) {
      const speed = actor.kind === 'player' ? 17 : actor.kind === 'boss' ? 13 : 9;
      const angle = count === 3 ? (index - 1) * 0.25 : 0;
      const x = actor.x + actor.facing * actor.scale * 0.9;
      const y = actor.y + (actor.kind === 'boss' ? 1.8 : 0.95);
      const dx = target ? target.x - x : actor.facing * 10;
      const dz = target ? clamp(target.z - actor.z, -2.5, 2.5) : 0;
      const magnitude = Math.hypot(dx, dz) || 1;
      const projectile: Projectile = {
        id: `shot-${this.serial++}`, kind: 'bolt', ownerId: actor.id, x, y, z: actor.z,
        vx: Math.cos(angle) * dx / magnitude * speed - Math.sin(angle) * dz / magnitude * speed,
        vy: target ? clamp((target.y + 0.8 - y) / Math.max(1, Math.abs(dx)) * speed, -2, 2) : 0,
        vz: Math.sin(angle) * dx / magnitude * speed + Math.cos(angle) * dz / magnitude * speed,
        radius: actor.kind === 'boss' ? 0.36 : 0.22, life: 2.4,
        color: actor.kind === 'player' ? w.loadout.color : 0xff6b56,
      };
      w.projectiles.push(projectile);
      this.shots.set(projectile.id, { originStrike: strike, kind: actor.attack?.kind ?? 'special', damage: strike.damage, force: strike.force, growth: strike.growth, facing: actor.facing, hit: new Set(), pierce: strike.move.id === 'special.pulse.focused' ? 2 : 1 });
    }
  }

  private updateProjectiles(dt: number): void {
    const w = this.world;
    for (const shot of w.projectiles) {
      if (shot.kind === 'mortar') shot.vy -= 12 * dt;
      shot.x += shot.vx * dt; shot.y += shot.vy * dt; shot.z += shot.vz * dt; shot.life -= dt;
      const source = shot.ownerId === w.player.id ? w.player : w.enemies.find((enemy) => enemy.id === shot.ownerId);
      if (shot.kind === 'mortar') {
        if (shot.y <= 0.08) {
          const data = this.shots.get(shot.id), p = w.player;
          this.effect('shockwave', shot.x, 0.06, shot.z, 0.5, 2.1, shot.color);
          // A launched shell retains its owner snapshot after defeat/removal.
          // Damage modifiers still pass through the one hit boundary.
          const attacker = source ?? data?.owner ?? { ...p, id: shot.ownerId, kind: 'artillery' as const, x: shot.x, z: shot.z };
          if (data && Math.hypot(p.x - shot.x, p.z - shot.z) < 2.1 && p.y >= 0 && p.y < 1.4) this.hit(p, attacker, data.damage, data.force, data.growth, 0.8, p.x > shot.x ? 1 : -1, 'enemy');
          for (const prop of w.props) if (prop.hp > 0 && Math.hypot(prop.x - shot.x, prop.z - shot.z) < 2.1) this.damageProp(prop, 12, attacker);
          shot.life = 0;
        }
        continue;
      }
      if (!source) { shot.life = 0; continue; }
      for (const prop of w.props) {
        if (!prop.alive || prop.hp <= 0 || shot.life <= 0 || shot.y < 0 || shot.y > prop.height) continue;
        if (insideProp(prop, shot.x, shot.z, shot.radius)) {
          const data = this.shots.get(shot.id);
          if (data) this.damageProp(prop, data.damage, source);
          shot.life = 0;
        }
      }
      const targets = source.kind === 'player' ? w.enemies : [w.player];
      for (const target of targets) {
        const data = this.shots.get(shot.id);
        if (!target.alive || target.invulnerable > 0 || shot.life <= 0 || data?.hit?.has(target.id)) continue;
        if (Math.abs(shot.x - target.x) < 0.55 * target.scale + shot.radius && Math.abs(shot.z - target.z) < 0.5 * target.scale + shot.radius + assistedBy(source.kind) && shot.y > target.y - 0.1 && shot.y < target.y + 1.85 * target.scale) {
          const data = this.shots.get(shot.id);
          if (data) {
            // A late projectile can confirm only the exact swing that fired it.
            if (data.originStrike && source.state === 'attack' && this.memory(source).strike === data.originStrike) data.originStrike.connected = true;
            this.hit(target, source, data.damage, data.force, data.growth, 0.45, data.facing, data.kind, shot); data.hit?.add(target.id); data.pierce = (data.pierce ?? 1) - 1;
            const bounceTarget = (data.bounces ?? 0) > 0 ? targets.filter((other) => other.alive && other.invulnerable <= 0 && !data.hit?.has(other.id) && Math.hypot(other.x - shot.x, other.z - shot.z) < 6).sort((a, b) => Math.hypot(a.x - shot.x, a.z - shot.z) - Math.hypot(b.x - shot.x, b.z - shot.z))[0] : undefined;
            if (bounceTarget) {
              const dx = bounceTarget.x - shot.x, dz = bounceTarget.z - shot.z, distance = Math.hypot(dx, dz) || 1;
              data.bounces = (data.bounces ?? 0) - 1; data.pierce = Math.max(1, data.pierce); data.facing = dx >= 0 ? 1 : -1;
              shot.vx = dx / distance * 14; shot.vz = dz / distance * 14; shot.vy = clamp((bounceTarget.y + .9 - shot.y) / distance * 14, -4, 4);
              // Give the chosen target enough travel time even when the first hit was at maximum range.
              shot.life = Math.min(1.2, Math.max(shot.life + .3, distance / 14 + .1));
              this.effect('hit', shot.x, shot.y, shot.z, .2, .8, shot.color);
              break;
            }
            if (data.pierce <= 0) shot.life = 0; }
          else shot.life = 0;
        }
      }
    }
    w.projectiles = w.projectiles.filter((shot) => {
      if (shot.life <= 0) { this.shots.delete(shot.id); return false; }
      return true;
    });
  }

  /** True only for an unblocked body hit; shield chip must not grant on-hit upgrades. */
  private hit(target: Actor, source: Actor, damage: number, force: number, growth: number, angle: number, facing: 1 | -1, kind: AttackKind, projectile?: Pick<Projectile, 'vx'>): boolean {
    if (!target.alive || target.invulnerable > 0) return false;
    if (target.kind === 'player') this.actions.reset();
    const w = this.world, m = this.memory(target);
    // One damage boundary for melee, shots and floor hazards. Never pre-scale emitters.
    if (source.kind === 'player') damage *= 0.9;
    if (this.run) {
      if (target.kind === 'player') {
        const enemySource = !w.props.some(p => p.id === source.id) && source.kind !== 'player';
        damage *= relicEffect(this.run.economy.relics, 'incoming') * (enemySource && (this.modifiers.includes('damage') || this.modifiers.includes('berserk') && source.damage >= 60) ? 1.25 : 1);
        // Ballast is applied to the complete impulse below, including growth.
      } else if (source.kind === 'player') damage *= relicEffect(this.run.economy.relics, 'damage');
    }
    if (m.grabTarget) this.releaseGrab(target);
    const guarding = target.kind === 'sentinel' && target.guard > 0 && target.state !== 'attack' && target.state !== 'hurt' && target.state !== 'grabbed';
    if (target.mount > 0) {
      target.mount = Math.max(0, target.mount - damage);
      if (target.mount === 0) {
        this.effect('text', target.x, target.y + 2.5, target.z, 1.3, 1, 0xffbf70, 'DISMOUNT');
        this.effect('shockwave', target.x, 0.3, target.z, 0.6, 2, 0xffbf70);
      }
    }
    // Shots retain their owner for scoring, but guard against their incoming
    // direction: the owner can move independently while the shot is in flight.
    const hitsShieldFront = projectile
      ? projectile.vx * target.facing < 0
      : (source.x - target.x) * target.facing > 0 && Math.abs(source.z - target.z) < 1.5;
    if (guarding && kind !== 'throw' && !source.id.startsWith('arena-') && hitsShieldFront) {
      target.guard = Math.max(0, target.guard - damage * (kind === 'smash' ? 2.5 : 1));
      if (target.guard > 0) {
        target.damage = Math.min(999, target.damage + damage * 0.12);
        target.invulnerable = 0.08;
        this.effect('hit', target.x + target.facing * 0.6, target.y + 1, target.z, 0.25, 1.2, 0x6bbfff);
        this.effect('text', target.x, target.y + 2, target.z, 0.6, 1, 0x6bbfff, 'BLOCK');
        w.events.push({ type: 'hit', intensity: 0.2 });
        w.hitstop = Math.max(w.hitstop, 0.03);
        return false;
      }
      this.effect('text', target.x, target.y + 2, target.z, 1.1, 1, 0x6bbfff, 'GUARD BREAK');
      this.effect('shockwave', target.x, target.y + 1, target.z, 0.5, 2.5, 0x6bbfff);
    }
    // Give fresh enemies a clearer launch, with a gentler ramp toward finishers.
    // Resistance uses pre-hit damage; enemy growth is reduced separately below.
    const launchScale = target.kind === 'player' ? 1 : 0.5 + 0.5 * clamp(target.damage / 200, 0, 1);
    target.damage = Math.min(999, target.damage + damage);
    let armored = target.armor > 0;
    if (armored) {
      target.armor = Math.max(0, target.armor - damage * (kind === 'smash' ? 1.65 : 1));
      if (target.armor <= 0 && !m.bossBroken) {
        armored = false; m.bossBroken = true;
        if (target.kind === 'boss') {
          target.bossPhase = 'transition'; target.phaseChanges++; m.phaseTimer = 1.4;
          w.hazards = []; w.projectiles = []; this.shots.clear(); this.director.reset();
          target.invulnerable = 1.4;
        }
        w.message = target.kind === 'boss' ? 'OVERDRIVE BOOT // 1.4s SAFE WINDOW' : 'CORE EXPOSED // 吹っ飛ばせ'; w.messageTime = 3.2;
        this.effect('shockwave', target.x, 1.3, target.z, 1, 5, 0xffd17c);
        w.events.push({ type: 'boss' });
        w.shake = 0.75;
      }
    }
    const weight = target.kind === 'player' ? w.loadout.weight : target.kind === 'boss' ? 3.6 : target.kind === 'warden' ? 2.6 : target.mount > 0 ? 1.4 : target.kind === 'minion' ? 0.6 : target.kind === 'bruiser' ? 1.45 : target.kind === 'drone' ? 0.78 : 1;
    const impulse = (target.kind === 'player' ? relicEffect(this.run?.economy.relics ?? [], 'force') : 1) * (force + target.damage * growth * (target.kind === 'player' ? 1 : 0.65)) / weight * (armored ? 0.16 : 1) * launchScale;
    target.vx = facing * Math.cos(angle) * impulse;
    target.vy = Math.sin(angle) * impulse;
    if (target.y <= 0.05 && target.vy < 0) target.vy = Math.abs(target.vy) * 0.6 + 4;
    target.vz = clamp((target.z - source.z) * impulse * 0.1, -3.5, 3.5);
    if (!armored || target.state !== 'attack') {
      target.state = 'hurt'; target.stateTime = 0; target.attack = null; target.telegraph = 0; target.aim = null;
      m.strike = null;
      m.actionTimer = armored ? 0.07 : clamp(0.16 + impulse * 0.022, 0.18, 0.85);
    }
    m.forced = armored ? 0.1 : clamp(0.35 + impulse * 0.02, 0.4, 1.2);
    if (target.bossPhase === 'transition') { target.state = 'shield'; target.attack = null; m.strike = null; m.actionTimer = 1.4; m.forced = 0; target.vx = target.vy = target.vz = 0; }
    else target.invulnerable = 0.065;
    this.effect('hit', target.x, target.y + target.scale * 0.85, target.z, 0.32, 0.6 + impulse * 0.045, source.kind === 'player' ? w.loadout.color : 0xff6c65);
    this.effect('text', target.x, target.y + target.scale * 1.8, target.z, 0.8, 1, 0xffffff, `${Math.round(damage)}`);
    w.shake = Math.max(w.shake, Math.min(0.6, impulse * 0.018));
    w.hitstop = Math.max(w.hitstop, kind === 'smash' ? 0.075 : 0.035);
    w.events.push({ type: 'hit', intensity: clamp(impulse / 25, 0.15, 1) });
    if (source.kind === 'player') {
      w.combo = this.comboAge < 2.3 ? w.combo + 1 : 1;
      this.comboAge = 0;
      w.bestCombo = Math.max(w.bestCombo, w.combo);
      w.score += Math.round(damage * 5);
    } else {
      w.combo = 0;
      if (m.grabTarget) this.releaseGrab(target);
    }
    return true;
  }

  private damageProp(prop: ArenaProp, damage: number, owner: Actor): void {
    if ((prop.kind === 'relay' || prop.kind === 'node') && owner.kind !== 'player') return;
    if (!prop.alive || prop.hp <= 0) return;
    prop.hp = Math.max(0, prop.hp - damage);
    this.effect('hit', prop.x, prop.height * 0.7, prop.z, 0.25, 0.8, prop.kind === 'crate' ? 0x65f0b1 : 0xffaa55);
    if (prop.hp > 0) return;
    prop.alive = false;
    if (prop.kind === 'relay' || prop.kind === 'node') {
      this.world.pendingSpawns = this.world.pendingSpawns.filter((spawn) => spawn.sourceId !== prop.id);
      this.world.hazards = this.world.hazards.filter((hazard) => hazard.ownerId !== prop.id);
      this.effect('text', prop.x, prop.height + .5, prop.z, 1.4, 1, 0x65f0b1, prop.kind === 'relay' ? 'REINFORCEMENTS OFFLINE' : prop.id.endsWith('-0') ? 'ARTILLERY OFFLINE' : 'VENTS OFFLINE');
    }
    if (prop.kind === 'crate') {
      this.world.props.push({ ...prop, id: `${prop.id}-repair`, kind: 'repair', alive: true, height: 0.5, width: 0.7, depth: 0.7 });
      this.effect('text', prop.x, 1.8, prop.z, 1.1, 1, 0x65f0b1, 'REPAIR +25');
    } else if (prop.kind === 'barrel') {
      this.effect('ringout', prop.x, 0.7, prop.z, 0.65, 3, 0xffac55);
      this.effect('shockwave', prop.x, 0.05, prop.z, 0.6, 3.2, 0xff6b50);
      this.world.events.push({ type: 'smash', intensity: 0.8 });
      this.world.shake = Math.max(this.world.shake, 0.45);
      for (const actor of [this.world.player, ...this.world.enemies]) {
        if (Math.hypot(actor.x - prop.x, actor.z - prop.z) < 3.2 && actor.y >= -0.1 && actor.y < 2.8) this.hitEnvironment(actor, prop, 24, 9);
      }
      for (const other of this.world.props) {
        if (other !== prop && other.alive && other.hp > 0 && Math.hypot(other.x - prop.x, other.z - prop.z) < 3) this.damageProp(other, 24, owner);
      }
    }
  }

  private hitEnvironment(actor: Actor, prop: ArenaProp, damage: number, force: number): void {
    // Environmental damage is neutral, so it never builds the player's combo.
    const source: Actor = { ...this.world.player, id: prop.id, kind: 'scout', x: prop.x, y: 0, z: prop.z };
    this.hit(actor, source, damage, force, 0.07, 0.85, actor.x >= prop.x ? 1 : -1, 'enemy');
  }

  private updateArena(dt: number): void {
    const w = this.world;
    for (const prop of w.props) {
      if (!prop.alive) continue;
      if (prop.kind === 'vent') {
        prop.timer = (prop.timer + dt) % 6;
        const ventControl = w.props.find((entry) => entry.kind === 'node' && entry.id.endsWith('-1'));
        prop.phase = w.mode === 'training' || w.phase !== 'playing' || ventControl && !ventControl.alive ? 'idle' : prop.timer < 3.8 ? 'idle' : prop.timer < 5 ? 'warning' : 'active';
      }
      if (prop.kind === 'repair') {
        const p = w.player;
        if (p.alive && p.y >= 0 && p.y < 1.2 && insideProp(prop, p.x, p.z, 0.4)) {
          p.damage = Math.max(0, p.damage - 25);
          prop.alive = false;
          this.effect('heal', p.x, p.y + 1, p.z, 0.9, 1.7, 0x65f0b1, '-25%');
        }
        continue;
      }
      for (const actor of [w.player, ...w.enemies]) {
        if (!actor.alive || actor.state === 'grabbed' || actor.y < -0.05) continue;
        if (prop.kind === 'vent' && prop.phase === 'active' && actor.y < 1.2 && insideProp(prop, actor.x, actor.z)) {
          const memory = this.memory(actor);
          if (memory.hazardCooldown <= 0 && actor.invulnerable <= 0) {
            this.hitEnvironment(actor, prop, 12, 6);
            memory.hazardCooldown = 1.1;
          }
        } else if (prop.kind === 'conveyor' && this.isGrounded(actor) && insideProp(prop, actor.x, actor.z)) {
          actor.x = clamp(actor.x + prop.direction * 1.8 * dt, w.arenaMin + 0.35, w.arenaMax - 0.35);
        } else if (prop.hp > 0 && actor.y < prop.height && insideProp(prop, actor.x, actor.z, 0.3 * actor.scale)) {
          const dx = actor.x - prop.x, dz = actor.z - prop.z;
          const px = prop.width / 2 + 0.3 * actor.scale - Math.abs(dx);
          const pz = prop.depth / 2 + 0.3 * actor.scale - Math.abs(dz);
          if (px < pz || Math.abs(actor.z + (dz >= 0 ? 1 : -1) * pz) > DEPTH_LIMIT) { actor.x += (dx >= 0 ? 1 : -1) * px; actor.vx = 0; }
          else { actor.z += (dz >= 0 ? 1 : -1) * pz; actor.vz = 0; }
        }
      }
    }
  }

  private constrainDepth(actor: Actor): void {
    actor.z = clamp(actor.z, -DEPTH_LIMIT, DEPTH_LIMIT);
    if (actor.z >= DEPTH_LIMIT && actor.vz > 0 || actor.z <= -DEPTH_LIMIT && actor.vz < 0) actor.vz = 0;
  }

  private onPlatform(actor: Actor): boolean {
    return actor.x >= this.world.arenaMin && actor.x <= this.world.arenaMax && Math.abs(actor.z) <= PLATFORM_DEPTH;
  }

  private isGrounded(actor: Actor): boolean {
    return actor.y >= -0.00001 && actor.y <= 0.02 && actor.vy <= 0 && this.onPlatform(actor);
  }

  private integrate(actor: Actor, dt: number, input: InputFrame): void {
    const m = this.memory(actor);
    if (actor.state === 'grabbed') return;
    const wasGrounded = this.isGrounded(actor);
    const beforeX = actor.x, beforeY = actor.y, beforeZ = actor.z;
    const isDroneHovering = actor.kind === 'drone' && m.forced <= 0 && actor.state !== 'hurt' && this.onPlatform(actor);
    if (!isDroneHovering && !(actor.state === 'airdodge' && actor.stateTime < DODGE.airHang)) actor.vy -= GRAVITY * dt;
    actor.x += actor.vx * dt; actor.y += actor.vy * dt; actor.z += actor.vz * dt;
    this.constrainDepth(actor);
    if (wasGrounded && m.forced <= 0 && actor.state !== 'hurt' && actor.state !== 'airdodge' && beforeX >= this.world.arenaMin && beforeX <= this.world.arenaMax && Math.abs(beforeZ) <= PLATFORM_DEPTH) {
      actor.x = clamp(actor.x, this.world.arenaMin + 0.35, this.world.arenaMax - 0.35);
      this.constrainDepth(actor);
    }
    // Only a downward crossing from the top can land. Moving underneath the
    // platform after falling off must not teleport a fighter back onto it.
    if (this.onPlatform(actor) && beforeY >= 0 && actor.y <= 0 && actor.vy <= 0) {
      // An air dash that reaches the floor simply lands: there is no slide.
      if (actor.state === 'jump' || actor.state === 'fall' || actor.state === 'airdodge') {
        actor.state = 'idle'; actor.stateTime = 0; m.actionTimer = 0;
      }
      actor.y = 0; actor.vy = 0;
      m.jumps = 0; m.airDodgeUsed = false; m.recoveryUsed = false;
    }
    const grounded = actor.y === 0 && this.onPlatform(actor);
    if (actor.state === 'hurt') {
      const drag = grounded ? 2.2 : 0.12;
      actor.vx *= Math.exp(-dt * drag); actor.vz *= Math.exp(-dt * drag);
    } else if (actor.state === 'dodge') {
      // Ground dash burst: v(t) = v0 · exp(−burstDecay · t).
      const decay = Math.exp(-dt * DODGE.burstDecay);
      actor.vx *= decay; actor.vz *= decay;
    } else if (actor.state === 'airdodge') {
      // The air lane dash shares the ground burst profile; air X keeps its constant speed.
      actor.vz *= Math.exp(-dt * DODGE.burstDecay);
    } else if (actor.state === 'attack' && !['rush', 'leap'].includes(actor.attack?.move?.behavior ?? '') && (actor.attack?.move?.behavior !== 'phase' || m.forced <= 0)) {
      // Dash strikes spend their initial burst instead of carrying it into every follow-up.
      // Phase motion brakes after its authored travel window, including in the air.
      const drag = actor.attack?.kind === 'dash' ? 8 : actor.attack?.move?.behavior === 'phase' || grounded ? 14 : 0.8;
      actor.vx *= Math.exp(-dt * drag);
      actor.vz *= Math.exp(-dt * drag);
    }
    if (actor.kind === 'player' && actor.state === 'airdodge' && !input.dodgeHeld && actor.stateTime > 0.2) {
      actor.vx *= Math.exp(-dt * 4);
    }
  }

  private ringOut(actor: Actor): void {
    if (!actor.alive) return;
    const w = this.world;
    actor.alive = false; actor.state = 'dead'; actor.stateTime = 0; actor.attack = null; actor.telegraph = 0;
    w.hazards = w.hazards.filter(h => h.ownerId !== actor.id);
    const m = this.memory(actor);
    if (m.grabTarget) this.releaseGrab(actor);
    if (m.grabbedBy) this.releaseGrab(w.player);
    this.effect('ringout', clamp(actor.x, w.arenaMin - 3, w.arenaMax + 3), clamp(actor.y, 1, 8), clamp(actor.z, -5, 5), 1.15, actor.kind === 'boss' ? 7 : 3.8, actor.kind === 'player' ? 0xff646a : w.loadout.color);
    w.events.push({ type: 'ko', intensity: actor.kind === 'boss' ? 1 : 0.7 });
    w.shake = Math.max(w.shake, actor.kind === 'boss' ? 1 : 0.45);
    if (actor.kind === 'player') {
      this.actions.reset(); w.recoveryAvailable = false;
      w.stocks--;
      w.combo = 0;
      m.respawnTimer = 1.15;
      w.message = w.stocks > 0 ? 'CHASSIS LOST // REBOOTING' : 'SIGNAL LOST';
      w.messageTime = 2;
      if (w.stocks <= 0 && w.mode !== 'training') {
        w.phase = 'lost';
        if (this.run) { this.run.phase = 'finished'; this.touchRun(); }
        w.events.push({ type: 'lose' });
      } else if (w.mode === 'training') w.stocks = 3;
    } else {
      if (actor.kind === 'captain') {
        for (const minion of w.enemies.filter((enemy) => enemy.alive && enemy.leaderId === actor.id)) {
          minion.leaderId = null; minion.state = 'hurt'; minion.stateTime = 0;
          minion.attack = null; minion.aim = null; minion.telegraph = 0;
          minion.vx = 0; minion.vz = 0;
          this.memory(minion).strike = null; this.memory(minion).actionTimer = 1.2;
          this.effect('text', minion.x, minion.y + 1.4, minion.z, 1, 1, 0xc9ed6a, 'LINK LOST');
        }
      }
      w.kills++;
      w.score += actor.kind === 'boss' ? 3000 : 300 + w.combo * 30;
      if (w.loadout.trait === 'vampiric') {
        w.player.damage = Math.max(0, w.player.damage - 10);
        this.effect('heal', w.player.x, 1, w.player.z, 0.7, 2, w.loadout.color, '-10%');
      }
      if (actor.kind === 'boss' && !this.run) {
        w.completedSectors = STAGES.length; w.phase = 'won'; w.message = 'DIRECTIVE BROKEN'; w.messageTime = 99;
        w.score += w.stocks * 500;
        w.events.push({ type: 'win' });
      }
    }
  }

  private respawn(): void {
    const w = this.world, p = w.player;
    p.alive = true; p.x = w.sector * SECTOR_SPAN - 4; p.y = 3; p.z = 0;
    p.vx = 0; p.vy = 0; p.vz = 0; p.damage = 0;
    p.invulnerable = 3; p.state = 'fall'; p.stateTime = 0; p.attack = null;
    this.resetMemory(p);
    this.actions.reset(); w.recoveryAvailable = true;
    this.effect('spawn', p.x, 0.03, p.z, 1, 2.5, w.loadout.color);
  }

  private spawnEnemy(kind: ActorKind, x: number, z: number): void {
    const w = this.world, enemy = this.makeActor(kind, x, z);
    this.memory(enemy).spawnTime = w.time;
    enemy.invulnerable = .65;
    w.enemies.push(enemy);
    this.effect('spawn', x, 0, z, .8, enemy.scale * 1.4, kind === 'boss' ? 0xff6e55 : 0xffb35c);
    if (kind === 'captain') {
      for (const side of [-1, 1]) {
        if (w.enemies.filter((actor) => actor.alive).length >= 14) break;
        const minion = this.makeActor('minion', clamp(x - 1.4, w.arenaMin + 1, w.arenaMax - 1), clamp(z + side * 1.2, -3.4, 3.4));
        minion.leaderId = enemy.id; minion.invulnerable = .9;
        w.enemies.push(minion);
        this.effect('spawn', minion.x, 0, minion.z, .8, .8, 0xc9ed6a);
      }
    }
    if (kind === 'boss' || kind === 'warden') {
      w.message = kind === 'boss' ? 'WARNING // THE ARCHITECT' : 'MIDBOSS // THE WARDEN'; w.messageTime = 4;
      w.events.push({ type: 'boss' });
    }
  }

  private queueSpawn(kind: ActorKind, x: number, z: number, delay: number, source: SpawnWarning['source'], sourceId?: string): void {
    const w = this.world;
    if (w.pendingSpawns.length + w.enemies.filter((enemy) => enemy.alive).length >= 14 && source !== 'wave') return;
    w.pendingSpawns.push({ id: `arrival-${this.serial++}`, kind, x: clamp(x, w.arenaMin + 1.5, w.arenaMax - 1.5), z: clamp(z, -3.2, 3.2), remaining: delay, duration: 1.1, source, ...(sourceId ? { sourceId } : {}) });
  }

  private updatePendingSpawns(dt: number): void {
    const w = this.world;
    if (w.phase !== 'playing' || w.mode === 'training') return;
    w.pendingSpawns = w.pendingSpawns.filter((spawn) => !spawn.sourceId || w.props.some((prop) => prop.id === spawn.sourceId && prop.alive));
    const remaining: SpawnWarning[] = [];
    for (const spawn of w.pendingSpawns) {
      spawn.remaining -= dt;
      if (spawn.remaining > 0) { remaining.push(spawn); continue; }
      if (w.enemies.filter((enemy) => enemy.alive).length >= 14) {
        if (spawn.source === 'wave') { spawn.remaining = .2; remaining.push(spawn); }
        continue;
      }
      this.spawnEnemy(spawn.kind, spawn.x, spawn.z);
    }
    w.pendingSpawns = remaining;
  }

  private spawnWave(): void {
    const w = this.world;
    w.waveTimer = 0;
    this.director.reset(); w.coordination = emptyCoordination();
    const kinds = this.run ? this.encounter : w.mode === 'training' ? TRAINING_WAVES[(w.wave - 1) % TRAINING_WAVES.length]! : STAGES[w.sector]!.waves[w.wave - 1]!.enemies;
    const staged = w.mode !== 'training' && kinds.length >= 8;
    for (let index = 0; index < kinds.length; index++) {
      const kind = kinds[index]!;
      const batch = Math.floor(index / 4), side = batch % 2 ? -1 : 1;
      const x = w.sector * SECTOR_SPAN + (kind === 'boss' || kind === 'warden' ? 5 : staged && batch > 0 ? side * (8 + index % 2) : 1.5 + Math.floor(index / 4) * 2.6);
      const z = kind === 'boss' ? 0 : [-2.7, 2.7, -.9, .9][index % 4]!;
      if (staged && batch > 0) this.queueSpawn(kind, x, z, 2 + batch * 1.5, 'wave');
      else this.spawnEnemy(kind, x, z);
    }
    if (w.objective.kind === 'lockdown' && w.wave === STAGES[w.sector]!.waves.length && !w.objective.activated) {
      w.objective.activated = true; w.objective.elapsed = 0; w.objective.progress = 0;
      w.message = 'LOCKDOWN // 18秒生存で離脱。全滅させなくても突破可能'; w.messageTime = 4;
    }
    if (w.mode !== 'training') w.events.push({ type: 'wave' });
  }

  private updateObjective(dt: number): void {
    const w = this.world, o = w.objective;
    if (w.mode === 'training' || w.phase !== 'playing' || o.complete) return;
    if (o.kind === 'relay' || o.kind === 'nodes') {
      o.progress = w.props.filter((prop) => prop.id.startsWith('objective-') && !prop.alive).length;
      if (o.kind === 'relay' && w.player.alive) {
        o.elapsed += dt;
        const due = Math.min(3, Math.floor(o.elapsed / 8));
        for (const index of [0, 1] as const) {
          const relay = w.props.find((prop) => prop.id === `objective-${w.sector}-${index}`);
          while (o.relayPulses[index] < due) {
            o.relayPulses[index]++;
            if (relay?.alive) {
              this.queueSpawn('minion', relay.x, relay.z, 1.1, 'relay', relay.id);
              o.reinforcements++;
            }
          }
        }
      }
      if (o.kind === 'nodes') {
        const artillery = w.props.find((prop) => prop.id === `objective-${w.sector}-0` && prop.alive);
        o.hazardTimer += dt;
        if (artillery && o.hazardTimer >= 6 && w.player.alive) {
          o.hazardTimer = 0;
          w.hazards.push({ id: `node-shot-${this.serial++}`, group: `node-salvo-${this.serial++}`, ownerId: artillery.id, pattern: 'snipe', x: w.sector * SECTOR_SPAN, z: clamp(w.player.z, -3, 3), width: w.arenaMax - w.arenaMin, depth: 1.2, elapsed: 0, delay: 1.5, duration: .35, height: 3.5, damage: 10, force: 6, hit: false });
        }
      }
    } else if (o.kind === 'lockdown' && o.activated && w.player.alive) {
      o.elapsed += dt; o.progress = Math.min(o.target, o.elapsed);
      const pulses = Math.min(2, Math.floor(o.elapsed / 6));
      while (o.reinforcements < pulses) {
        o.reinforcements++;
        for (const sign of [-1, 1]) this.queueSpawn('minion', w.sector * SECTOR_SPAN + sign * 8, sign * 2.5, 1.1, 'lockdown');
      }
    }
    o.complete = o.activated && o.progress >= o.target;
    if (o.complete && !o.rewarded) {
      o.rewarded = true; w.score += 250;
      w.message = 'OBJECTIVE COMPLETE // 残りの迎撃部隊を突破'; w.messageTime = 3;
      if (o.kind === 'lockdown') this.clearSector();
    }
  }

  private clearSector(): void {
    const w = this.world;
    if (this.sectorCleared || w.sector >= STAGES.length - 1) return;
    w.completedSectors = w.sector + 1;
    w.phase = 'sector-clear'; this.sectorCleared = true;
    w.message = 'SECTOR CLEAR // 強化を選び、補給して次へ'; w.messageTime = 99;
    w.player.damage = Math.max(0, w.player.damage - 10);
    w.score += 600;
    w.projectiles = []; w.hazards = []; w.pendingSpawns = []; this.upgradeBursts = [];
    for (const enemy of w.enemies) this.memories.delete(enemy.id);
    w.enemies = []; this.shots.clear();
    w.upgradeChoices = createUpgradeChoices(w.seed, w.sector, w.loadout, w.upgrades);
    w.upgradeClaimed = w.upgradeChoices.length === 0;
  }

  private completeWave(): void {
    const w = this.world;
    if (this.run) {
      if (this.run.phase !== 'combat') return;
      this.run.phase = 'reward';
      const r = this.run, node = effectiveNode(r,r.map.find(n => n.id === r.current)!);
      if (!r.economy.rewards.includes(node.id)) {
        r.economy.rewards.push(node.id);
        r.economy.scrap += Math.round((node.kind === 'boss' ? 90 : node.kind === 'elite' || r.events.resolved[node.id]?.combat ? 60 : 30) * relicEffect(r.economy.relics, 'reward'));
        if (node.kind === 'elite' || node.kind === 'boss' || r.events.resolved[node.id]?.combat) {
          const pool=RELICS.filter(v=>!r.economy.relics.includes(v.id)&&(v.id!=='reserve'||w.stocks<4));
          const relic=pool[nodeSeed(r.seed,`elite-relic:${node.id}`)%pool.length];
          if(relic)this.grantRelic(relic.id);else r.economy.scrap+=30;
        }
        if (r.economy.relics.includes('solder')) w.player.damage = Math.max(0,w.player.damage - 15);
      }
      w.upgradeChoices = createUpgradeChoices(nodeSeed(r.seed,'reward'), nodeSeed(0,node.id),w.loadout,w.upgrades);
      w.upgradeClaimed = w.upgradeChoices.length === 0;
      this.syncRunResources();
      w.phase = 'sector-clear'; w.projectiles = []; w.hazards = [];
      this.touchRun(); return;
    }
    if (w.mode === 'training') {
      w.wave++;
      w.player.damage = 0;
      this.spawnWave();
    } else if (w.wave < STAGES[w.sector]!.waves.length) {
      w.wave++;
      w.message = `WAVE ${w.wave} // ${STAGES[w.sector]!.waves[w.wave - 1]!.name}`; w.messageTime = 2.5;
      this.spawnWave();
    } else if (w.sector < STAGES.length - 1 && w.objective.complete) this.clearSector();
  }

  private effect(type: Effect['type'], x: number, y: number, z: number, duration: number, size: number, color: number, text?: string): void {
    this.world.effects.push({ id: `fx-${this.serial++}`, type, x, y, z, life: duration, duration, size, color, ...(text ? { text } : {}) });
  }

  private updateEffects(dt: number): void {
    for (const effect of this.world.effects) effect.life -= dt;
    this.world.effects = this.world.effects.filter((effect) => effect.life > 0).slice(-100);
  }
}
