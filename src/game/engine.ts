import { createCandidates, seededRandom } from './loadouts';
import { createArena, insideProp } from './arena';
import { STAGES, TRAINING_WAVES } from './campaign';
import { EMPTY_INPUT, type Actor, type ActorKind, type ArenaProp, type AttackDirection, type AttackKind, type Effect, type GameMode, type InputFrame, type Loadout, type Projectile, type SupplyChoice, type WorldState } from './types';

const GRAVITY = 27;
const PLATFORM_DEPTH = 4.5;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const approach = (value: number, target: number, amount: number) => value < target ? Math.min(value + amount, target) : Math.max(value - amount, target);

interface Strike {
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
  fired: boolean;
  source: string;
}

interface ActorMemory {
  actionTimer: number;
  forced: number;
  jumps: number;
  airDodgeUsed: boolean;
  airDodgeDown: boolean;
  recoveryUsed: boolean;
  lastJumpHeld: boolean;
  charge: number;
  chargeSource: 'smash' | 'attack';
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
}

interface ProjectileMemory {
  damage: number;
  force: number;
  growth: number;
  facing: 1 | -1;
}

/** Pure simulation: rendering, audio and input devices are independent adapters. */
export class GameEngine {
  world: WorldState;
  private memories = new Map<string, ActorMemory>();
  private shots = new Map<string, ProjectileMemory>();
  private random: () => number;
  private serial = 0;
  private comboAge = 0;
  private sectorCleared = false;
  private startingLoadout: Loadout;

  constructor(seed = 1) {
    this.random = seededRandom(seed);
    const loadout = createCandidates(seed)[0]!;
    this.startingLoadout = { ...loadout };
    const player = this.makeActor('player', -4, 0);
    this.world = {
      phase: 'ready', mode: 'campaign', time: 0, seed: seed >>> 0,
      sector: 0, completedSectors: 0, supplyClaimed: false, supply: null, wave: 1, player,
      enemies: [this.makeActor('scout', 2, -1), this.makeActor('bruiser', 6, 0.8), this.makeActor('drone', 8, -2)],
      projectiles: [], effects: [], props: createArena(0), loadout,
      stocks: 3, kills: 0, combo: 0, bestCombo: 0, score: 0,
      lastMove: 'SYSTEM READY', message: 'BREAK THE DIRECTIVE', messageTime: 0,
      shake: 0, hitstop: 0, specialCooldown: 0, waveTimer: 0,
      cameraX: 0, arenaMin: -11, arenaMax: 11, events: [],
    };
  }

  start(loadout: Loadout, mode: GameMode = 'campaign'): void {
    const seed = this.world.seed;
    this.startingLoadout = { ...loadout };
    this.random = seededRandom(seed ^ 0x1f842b);
    this.memories.clear();
    this.shots.clear();
    this.serial = 0;
    this.comboAge = 0;
    this.sectorCleared = false;
    const player = this.makeActor('player', -5, 0);
    this.world = {
      phase: 'playing', mode, time: 0, seed, sector: 0, completedSectors: 0, supplyClaimed: false, supply: null, wave: 1,
      player, enemies: [], projectiles: [], effects: [], props: createArena(0), loadout,
      stocks: 3, kills: 0, combo: 0, bestCombo: 0, score: 0,
      lastMove: 'SYSTEM ONLINE', message: mode === 'training' ? 'TRAINING // 機体を試そう' : '01 // THE FOUNDRY', messageTime: 3,
      shake: 0, hitstop: 0, specialCooldown: 0, waveTimer: 0,
      cameraX: 0, arenaMin: -11, arenaMax: 11, events: [],
    };
    player.invulnerable = 1.8;
    this.spawnWave();
    this.effect('spawn', player.x, 0, player.z, 0.8, 2.2, loadout.color);
  }

  pause(): void {
    if (this.world.phase === 'playing' || this.world.phase === 'sector-clear') this.world.phase = 'paused';
  }

  resume(): void {
    if (this.world.phase === 'paused') this.world.phase = this.sectorCleared ? 'sector-clear' : 'playing';
  }

  restart(): void { this.start(this.startingLoadout, this.world.mode); }

  claimSupply(choice: SupplyChoice): boolean {
    const w = this.world;
    if (w.mode !== 'campaign' || w.supplyClaimed || !(w.phase === 'sector-clear' || (w.phase === 'paused' && this.sectorCleared))) return false;
    if (choice === 'repair') w.player.damage = Math.max(0, w.player.damage - 40);
    else if (choice === 'power') w.loadout = { ...w.loadout, power: w.loadout.power + 0.08 };
    else if (choice === 'stock') w.stocks = Math.min(4, w.stocks + 1);
    else return false;
    w.supplyClaimed = true; w.supply = choice;
    return true;
  }

  nextSector(): void {
    const w = this.world;
    if (w.phase !== 'sector-clear' || w.sector >= STAGES.length - 1) return;
    if (!w.supplyClaimed) this.claimSupply('repair');
    w.sector++;
    w.supplyClaimed = false; w.supply = null;
    w.wave = 1;
    w.arenaMin = w.sector * 28 - 11;
    w.arenaMax = w.sector * 28 + 11;
    w.cameraX = w.sector * 28;
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
    w.effects = [];
    w.projectiles = [];
    w.enemies = [];
    w.props = createArena(w.sector);
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
    const realDt = clamp(delta, 0, 0.05);
    if (input.pause) {
      if (w.phase === 'paused') this.resume(); else this.pause();
      return;
    }
    if (w.phase === 'paused') return;
    w.time += realDt;
    this.updateEffects(realDt);
    w.shake = approach(w.shake, 0, realDt * 2.2);
    w.messageTime = Math.max(0, w.messageTime - realDt);
    if (w.phase === 'ready' || w.phase === 'lost' || w.phase === 'won') return;

    if (w.hitstop > 0) {
      w.hitstop = Math.max(0, w.hitstop - realDt);
      return;
    }
    const dt = realDt;
    w.specialCooldown = Math.max(0, w.specialCooldown - dt);
    this.comboAge += dt;
    if (this.comboAge > 2.3) w.combo = 0;

    for (const actor of [w.player, ...w.enemies]) {
      const mem = this.memory(actor);
      actor.stateTime += dt;
      actor.invulnerable = Math.max(0, actor.invulnerable - dt);
      mem.forced = Math.max(0, mem.forced - dt);
      mem.cooldown = Math.max(0, mem.cooldown - dt);
      mem.hazardCooldown = Math.max(0, mem.hazardCooldown - dt);
      mem.dashTimer = Math.max(0, mem.dashTimer - dt);
      mem.comboTimer = Math.max(0, mem.comboTimer - dt);
      if (!actor.alive) continue;
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
    if (w.phase !== 'sector-clear') for (const enemy of w.enemies) this.updateEnemy(enemy, dt);
    for (const actor of [w.player, ...w.enemies]) if (actor.alive) this.updateAttack(actor, dt);
    this.updateProjectiles(dt);
    for (const actor of [w.player, ...w.enemies]) if (actor.alive) this.integrate(actor, dt, actor.kind === 'player' ? input : EMPTY_INPUT);
    this.updateArena(dt);
    this.updateGrabPositions(dt);

    for (const actor of [w.player, ...w.enemies]) {
      if (actor.alive && (actor.x < w.arenaMin - 5 || actor.x > w.arenaMax + 5 || Math.abs(actor.z) > 7 || actor.y > 18 || actor.y < -7)) this.ringOut(actor);
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
    if (w.phase === 'sector-clear') {
      if (w.player.x > w.arenaMax - 2) this.nextSector();
    } else if (w.phase === 'playing' && !w.enemies.some((enemy) => enemy.alive)) {
      w.waveTimer += dt;
      if (w.waveTimer > 1.35) this.completeWave();
    }
    const targetCamera = w.sector * 28 + clamp(w.player.x - w.sector * 28, -4, 4) * 0.28;
    w.cameraX += (targetCamera - w.cameraX) * Math.min(1, dt * 3.5);
  }

  private makeActor(kind: ActorKind, x: number, z: number): Actor {
    const actor: Actor = {
      id: `${kind}-${this.serial++}`, kind, x, y: kind === 'drone' ? 1.5 : 0, z,
      vx: 0, vy: 0, vz: 0, facing: kind === 'player' ? 1 : -1,
      damage: 0, armor: kind === 'boss' ? 135 : kind === 'warden' ? 70 : 0, mount: kind === 'rider' ? 30 : 0, leaderId: null, guard: kind === 'sentinel' ? 40 : 0, alive: true,
      state: 'idle', stateTime: 0, invulnerable: 0, scale: kind === 'boss' ? 2.65 : kind === 'warden' ? 1.85 : kind === 'bruiser' ? 1.25 : kind === 'minion' ? 0.58 : kind === 'drone' ? 0.8 : 1,
      attack: null, telegraph: 0, aim: null,
    };
    this.resetMemory(actor);
    return actor;
  }

  private resetMemory(actor: Actor): void {
    this.memories.set(actor.id, {
      actionTimer: 0, forced: 0, jumps: 0, airDodgeUsed: false, airDodgeDown: false, recoveryUsed: false, lastJumpHeld: false,
      charge: 0, chargeSource: 'smash', chargeDirection: 'forward', strike: null,
      comboStage: 0, comboTimer: 0, dashTimer: 0,
      cooldown: 0.7 + this.random() * 1.5, pattern: 0, grabTarget: null, grabbedBy: null,
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
    const free = m.actionTimer <= 0 || (p.state === 'wavedash' && p.stateTime > 0.09);
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
      if (input.attack || input.smash || input.grab || Math.abs(input.moveX) > 0.4 || Math.abs(input.moveZ) > 0.4) {
        this.throwTarget(p, target, this.direction(input, p.facing));
      }
      return;
    }
    if (p.state === 'charge') {
      m.charge = Math.min(1, m.charge + dt / 0.85);
      if (p.attack) p.attack.charge = m.charge;
      p.vx *= Math.exp(-dt * 18);
      p.vz *= Math.exp(-dt * 18);
      const held = m.chargeSource === 'smash' ? input.smashHeld : input.attackHeld;
      if (!held || m.charge >= 1) this.releaseSmash();
      return;
    }
    if (input.dash && ground) m.dashTimer = 0.25;

    if (free && input.dodge) {
      if (ground) {
        const magnitude = Math.hypot(input.moveX, input.moveZ);
        p.state = 'dodge'; p.stateTime = 0;
        m.actionTimer = 0.36;
        p.invulnerable = 0.25;
        p.vx = magnitude > 0.3 ? input.moveX / magnitude * 12 : 0;
        p.vz = magnitude > 0.3 ? input.moveZ / magnitude * 8 : 0;
        w.lastMove = magnitude > 0.3 ? 'ROLL DODGE' : 'SPOT DODGE';
        w.events.push({ type: 'dodge' });
      } else if (!m.airDodgeUsed) {
        const magnitude = Math.hypot(input.moveX, input.moveZ);
        p.state = 'airdodge'; p.stateTime = 0;
        m.actionTimer = 0.32;
        m.airDodgeUsed = true;
        m.airDodgeDown = input.moveZ > 0.3;
        p.invulnerable = 0.23;
        p.vx = magnitude > 0.3 ? input.moveX / magnitude * 18 : 0;
        p.vy = magnitude > 0.3 ? -input.moveZ / magnitude * 18 : 0;
        p.vz = 0;
        w.lastMove = 'AIR DODGE';
        w.events.push({ type: 'dodge' });
      }
      if (p.state === 'dodge' || p.state === 'airdodge') {
        this.effect('trail', p.x, p.y + 0.8, p.z, 0.35, 1.3, w.loadout.color);
        return;
      }
    }

    if (free && input.jump && (ground || m.jumps < 2)) {
      m.jumps = ground ? 1 : m.jumps + 1;
      p.vy = m.jumps === 1 ? 11 : 10.5;
      p.state = 'jump'; p.stateTime = 0;
      m.actionTimer = 0;
      w.lastMove = m.jumps === 1 ? 'JUMP' : 'DOUBLE JUMP';
      w.events.push({ type: 'jump' });
      this.effect('shockwave', p.x, Math.max(0.02, p.y), p.z, 0.28, 0.8, w.loadout.color);
    }
    if (m.lastJumpHeld && !input.jumpHeld && p.vy > 5.2 && p.state !== 'attack' && p.state !== 'airdodge') p.vy = 5.2;
    m.lastJumpHeld = input.jumpHeld;

    // A jump changes vertical velocity before position integration. Re-evaluate
    // contact so simultaneous jump + attack inputs select an aerial immediately.
    const actionGround = this.isGrounded(p);
    if (free && input.special && w.specialCooldown <= 0) { this.special(input); return; }
    if (free && input.grab && actionGround) { this.grab(); return; }
    if (free && (input.smash || (input.attack && (Math.abs(input.flickX) > 0.4 || Math.abs(input.flickZ) > 0.4))) && actionGround) {
      const facing = input.moveX > 0.3 ? 1 : input.moveX < -0.3 ? -1 : p.facing;
      p.facing = facing;
      m.charge = 0;
      m.chargeSource = input.smash ? 'smash' : 'attack';
      m.chargeDirection = this.direction(input, facing);
      if (m.chargeDirection === 'neutral') m.chargeDirection = 'forward';
      p.state = 'charge'; p.stateTime = 0;
      p.attack = { name: 'CHARGING', kind: 'smash', direction: m.chargeDirection, elapsed: 0, duration: 1, range: 3, charge: 0, activeStart: 1, activeEnd: 1, combo: 0 };
      w.lastMove = `${m.chargeDirection.toUpperCase()} SMASH // CHARGE`;
      return;
    }
    if (free && (input.attack || input.smash)) {
      const direction = this.direction(input, p.facing);
      if (!actionGround) {
        this.playerAttack('aerial', direction);
      } else if (m.dashTimer > 0 || Math.abs(p.vx) > 8.2 * w.loadout.speed) {
        this.playerAttack('dash', 'forward');
      } else if (direction !== 'neutral') {
        if (Math.abs(input.moveX) > 0.3) p.facing = input.moveX > 0 ? 1 : -1;
        this.playerAttack('tilt', direction === 'back' ? 'forward' : direction);
      } else this.playerAttack('jab', 'neutral');
      return;
    }

    if (free && p.state !== 'airdodge' && p.state !== 'dodge') {
      if (actionGround && Math.abs(input.moveX) > 0.15) p.facing = input.moveX > 0 ? 1 : -1;
      const speed = (m.dashTimer > 0 ? 10.4 : 6.2) * w.loadout.speed;
      const sliding = p.state === 'wavedash';
      const targetX = input.moveX * speed;
      if (!sliding) p.vx = approach(p.vx, targetX, dt * (actionGround ? 46 : 17));
      else if (Math.abs(input.moveX) > 0.1 && Math.sign(input.moveX) !== Math.sign(p.vx)) p.vx = approach(p.vx, targetX, dt * 24);
      p.vz = approach(p.vz, input.moveZ * 4.4 * w.loadout.speed, dt * (actionGround ? 35 : 14));
      if (!sliding) p.state = !actionGround ? p.vy > 0 ? 'jump' : 'fall' : Math.hypot(p.vx, p.vz) > 0.4 ? 'run' : 'idle';
      if (!actionGround && input.moveZ > 0.65 && p.vy < 0) p.vy = Math.max(-22, p.vy - dt * 55);
    }
  }

  private direction(input: InputFrame, facing: number): AttackDirection {
    if (Math.abs(input.moveZ) > 0.5 && Math.abs(input.moveZ) >= Math.abs(input.moveX) * 0.8) return input.moveZ < 0 ? 'up' : 'down';
    if (Math.abs(input.moveX) > 0.3) return Math.sign(input.moveX) === facing ? 'forward' : 'back';
    return 'neutral';
  }

  private playerAttack(kind: AttackKind, direction: AttackDirection, charge = 0): void {
    const w = this.world;
    const p = w.player;
    const m = this.memory(p);
    let damage = 10, force = 4.6, growth = 0.1, range = 2.25, angle = 0.5, duration = 0.42, windup = 0.1;
    if (kind === 'jab') {
      m.comboStage = m.comboTimer > 0 ? (m.comboStage + 1) % 3 : 0;
      m.comboTimer = 0.85;
      damage = 5 + m.comboStage * 2;
      force = m.comboStage === 2 ? 7 : 2.5;
      growth = m.comboStage === 2 ? 0.09 : 0.035;
      range = 1.95; duration = 0.22; windup = 0.055;
    }
    if (kind === 'tilt') { damage = 11; force = 5; duration = 0.39; }
    if (kind === 'dash') { damage = 12; force = 7; range = 2.55; p.vx = p.facing * 9; duration = 0.49; }
    if (kind === 'smash') { damage = 18 * (1 + charge * 0.8); force = 10 * (1 + charge * 0.55); growth = 0.155; range = 2.9; duration = 0.64; windup = 0.13; }
    if (kind === 'aerial') { damage = direction === 'back' ? 14 : 11; force = direction === 'back' ? 7 : 5; range = 2.25; duration = 0.4; }
    if (direction === 'up') { angle = 1.28; range *= 0.85; }
    if (direction === 'down') { angle = kind === 'aerial' ? -1.15 : 0.28; }
    if (w.loadout.weapon === 'arc') range *= 1.18;
    if (w.loadout.weapon === 'pile') { duration *= 1.13; windup *= 1.3; force *= 1.1; }
    if (w.loadout.weapon === 'razor') { duration *= 0.78; windup *= 0.7; }
    const name = kind === 'jab' ? `JAB ${m.comboStage + 1}` : `${direction.toUpperCase()} ${kind === 'aerial' ? 'AIR' : kind.toUpperCase()}`;
    this.beginAttack(p, kind, direction, name, duration, range, charge, {
      damage: damage * w.loadout.power, force: force * w.loadout.power, growth: growth * w.loadout.power, angle,
      activeStart: windup, activeEnd: windup + (kind === 'smash' ? 0.17 : 0.13), depth: direction === 'down' && kind === 'smash' ? 2.2 : 1.35,
      height: direction === 'up' ? 3.5 : 1.85, radial: (kind === 'aerial' && direction === 'neutral') || (kind === 'smash' && direction === 'down'),
    });
    w.lastMove = name;
    if (kind === 'smash') w.events.push({ type: 'smash', intensity: charge });
  }

  private releaseSmash(): void {
    const m = this.memory(this.world.player);
    this.playerAttack('smash', m.chargeDirection, m.charge);
  }

  private beginAttack(actor: Actor, kind: AttackKind, direction: AttackDirection, name: string, duration: number, range: number, charge: number, options: Partial<Strike>): void {
    const m = this.memory(actor);
    actor.state = 'attack'; actor.stateTime = 0;
    m.actionTimer = duration;
    m.strike = {
      damage: 8, force: 6, growth: 0.065, angle: 0.55, depth: 1.2, height: 1.9,
      activeStart: 0.2, activeEnd: 0.35, hit: new Set(), radial: false, projectile: false, fired: false,
      source: actor.id, ...options,
    };
    actor.attack = { name, kind, direction, elapsed: 0, duration, range, charge,
      activeStart: m.strike.activeStart, activeEnd: m.strike.activeEnd, combo: m.comboStage };
    actor.aim = actor.kind === 'player' ? null : { x: this.world.player.x, y: this.world.player.y, z: this.world.player.z };
  }

  private updateAttack(actor: Actor, dt: number): void {
    const attack = actor.attack;
    const strike = this.memory(actor).strike;
    if (attack && !strike && actor.state === 'attack') attack.elapsed += dt;
    if (!attack || !strike || actor.state !== 'attack') return;
    attack.elapsed += dt;
    actor.telegraph = attack.elapsed < strike.activeStart ? 1 - attack.elapsed / strike.activeStart : 0;
    if (attack.name === 'LEAP STRIKE' && attack.elapsed > strike.activeEnd) {
      actor.vx = approach(actor.vx, 0, dt * 24);
      actor.vz = approach(actor.vz, 0, dt * 24);
    }
    if (attack.name === 'RAIL CHARGE' || attack.name === 'SHOCK DIVE' || attack.name === 'RIDER PASS') {
      if (attack.elapsed >= strike.activeStart && attack.elapsed <= strike.activeEnd) {
        actor.vx = actor.facing * (actor.kind === 'rider' ? 14 : actor.kind === 'charger' ? 13 : 9);
        actor.vz = 0;
        if (actor.kind === 'drone' && actor.y > 0.1) actor.vy = -4;
        this.memory(actor).forced = 0.08;
      } else { actor.vx = 0; actor.vz = 0; }
    }
    if (attack.elapsed < strike.activeStart || attack.elapsed - dt > strike.activeEnd) return;
    if (strike.projectile && !strike.fired) {
      strike.fired = true;
      this.fireAttack(actor, strike);
      return;
    }
    if (strike.projectile) return;
    if (!strike.fired) {
      strike.fired = true;
      if (attack.name === 'LEAP STRIKE' && actor.aim) {
        actor.vy = 10;
        actor.vx = clamp((actor.aim.x - actor.x) / 0.75, -7, 7);
        actor.vz = clamp((actor.aim.z - actor.z) / 0.75, -4, 4);
        this.memory(actor).forced = 0.85;
      }
      const color = actor.kind === 'player' ? this.world.loadout.color : 0xff6b67;
      this.effect(attack.direction === 'down' || strike.radial ? 'shockwave' : 'trail', actor.x + actor.facing * attack.range * 0.4, actor.y + 0.9, actor.z, 0.25, attack.range, color);
      if (actor.kind === 'boss' && attack.name.includes('SLAM')) {
        this.effect('shockwave', actor.x, 0.08, actor.z, 0.7, 5, 0xff624e);
        this.world.shake = Math.max(this.world.shake, 0.35);
      }
    }
    // A swing touches each piece of machinery only once, just like a fighter.
    for (const prop of this.world.props) {
      if (!prop.alive || prop.hp <= 0 || strike.hit.has(prop.id)) continue;
      const dx = prop.x - actor.x;
      const facing = attack.direction === 'back' ? -actor.facing : actor.facing;
      const xHits = strike.radial || attack.direction === 'up' ? Math.abs(dx) < attack.range + prop.width / 2 : dx * facing > -prop.width / 2 && dx * facing < attack.range + prop.width / 2;
      if (xHits && Math.abs(prop.z - actor.z) < strike.depth + prop.depth / 2 && actor.y < prop.height && actor.y + strike.height > 0) {
        strike.hit.add(prop.id);
        this.damageProp(prop, strike.damage);
      }
    }
    const targets = actor.kind === 'player' ? this.world.enemies : [this.world.player];
    for (const target of targets) {
      if (!target.alive || target.invulnerable > 0 || strike.hit.has(target.id) || target.state === 'grabbed') continue;
      const dx = target.x - actor.x;
      const dz = target.z - actor.z;
      const dy = target.y - actor.y;
      const facing = attack.direction === 'back' ? -actor.facing : actor.facing;
      const reach = attack.range + target.scale * 0.3;
      const xHits = strike.radial || attack.direction === 'up' ? Math.abs(dx) < reach : dx * facing > -0.6 && dx * facing < reach;
      // Check the target's body interval too: a jumping fighter can strike the
      // upper body of a tall boss even when their feet are several units apart.
      const heightHits = attack.direction === 'up'
        ? dy > -target.scale * 1.7 && dy < strike.height
        : dy < strike.height && dy + target.scale * 1.7 > -0.15;
      if (xHits && Math.abs(dz) < strike.depth + target.scale * 0.3 && heightHits) {
        strike.hit.add(target.id);
        const hitFacing = strike.radial ? (dx >= 0 ? 1 : -1) : facing;
        this.hit(target, actor, strike.damage, strike.force, strike.growth, strike.angle, hitFacing as 1 | -1, attack.kind);
      }
    }
  }

  private special(input: InputFrame): void {
    const w = this.world, p = w.player, m = this.memory(p);
    const direction = this.direction(input, p.facing);
    if (direction === 'up' && p.y > 0.05 && m.recoveryUsed) return;
    if (Math.abs(input.moveX) > 0.3) p.facing = input.moveX > 0 ? 1 : -1;
    w.specialCooldown = (w.loadout.special === 'vortex' ? 2.6 : 1.45) * (w.loadout.trait === 'overclocked' ? 0.65 : 1);
    if (direction === 'up') {
      m.recoveryUsed = true;
      p.vy = 14.5; p.vx = input.moveX * 5;
      m.jumps = Math.max(m.jumps, 1);
      this.beginAttack(p, 'special', 'up', 'RISING CIRCUIT', 0.58, 2.3, 0, { damage: 14 * w.loadout.power, force: 7, growth: 0.11, angle: 1.3, activeStart: 0.04, activeEnd: 0.4, height: 3, depth: 1.5, radial: true });
      w.lastMove = 'UP SPECIAL // RISING CIRCUIT';
    } else if (direction === 'down') {
      this.beginAttack(p, 'special', 'down', 'EMP BURST', 0.62, 3.4, 0, { damage: 14 * w.loadout.power, force: 8, growth: 0.11, angle: 0.65, activeStart: 0.18, activeEnd: 0.38, depth: 3.4, height: 2.8, radial: true });
      p.vy = p.y > 0.2 ? -14 : p.vy;
      w.lastMove = 'DOWN SPECIAL // EMP BURST';
    } else if (w.loadout.special === 'pulse') {
      this.beginAttack(p, 'special', direction, 'ION PULSE', 0.45, 2, 0, { damage: 15 * w.loadout.power, force: 7, growth: 0.09, projectile: true, activeStart: 0.14, activeEnd: 0.2 });
      w.lastMove = 'SPECIAL // ION PULSE';
    } else if (w.loadout.special === 'blink') {
      p.vx = p.facing * 21;
      p.invulnerable = 0.22;
      m.forced = 0.28;
      this.beginAttack(p, 'special', 'forward', 'PHASE SHIFT', 0.36, 2.2, 0, { damage: 17 * w.loadout.power, force: 9, growth: 0.1, activeStart: 0.025, activeEnd: 0.3, depth: 1.6 });
      w.lastMove = 'SPECIAL // PHASE SHIFT';
      this.effect('trail', p.x, p.y + 0.9, p.z, 0.55, 3, w.loadout.color);
    } else {
      for (const enemy of w.enemies) {
        const distance = Math.hypot(enemy.x - p.x, enemy.z - p.z);
        if (enemy.alive && distance < 6 && enemy.armor <= 0) {
          enemy.vx = (p.x - enemy.x) * 3.2;
          enemy.vz = (p.z - enemy.z) * 3.2;
          enemy.state = 'hurt'; enemy.stateTime = 0;
          this.memory(enemy).actionTimer = 0.23;
        }
      }
      this.beginAttack(p, 'special', 'neutral', 'GRAVITY WELL', 0.8, 4, 0, { damage: 19 * w.loadout.power, force: 11, growth: 0.12, angle: 0.85, radial: true, activeStart: 0.35, activeEnd: 0.55, depth: 4, height: 3 });
      w.lastMove = 'SPECIAL // GRAVITY WELL';
      this.effect('shockwave', p.x, p.y + 0.2, p.z, 0.8, 4.5, 0xa18bff);
    }
    w.events.push({ type: 'special' });
  }

  private grab(): void {
    const w = this.world, p = w.player, m = this.memory(p);
    const target = w.enemies.filter((enemy) => enemy.alive && enemy.invulnerable <= 0 && enemy.armor <= 0 && Math.abs(enemy.z - p.z) < 1.3 && Math.abs(enemy.y - p.y) < 1.6 && (enemy.x - p.x) * p.facing > -0.4 && (enemy.x - p.x) * p.facing < 2.15).sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
    p.vx = 0; p.vz = 0;
    if (!target) {
      this.beginAttack(p, 'throw', 'forward', 'GRAB / MISS', 0.36, 1.7, 0, { activeStart: 99 });
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
    source.attack = { name: `${direction.toUpperCase()} THROW`, kind: 'throw', direction, elapsed: 0, duration: 0.32, range: 2, charge: 0, activeStart: 0, activeEnd: 0.16, combo: 0 };
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

  private updateEnemy(enemy: Actor, dt: number): void {
    const w = this.world, p = w.player;
    if (!enemy.alive || !p.alive) return;
    const m = this.memory(enemy);
    if (enemy.state === 'grabbed' || enemy.state === 'hurt' || enemy.state === 'attack') return;
    enemy.telegraph = 0;
    enemy.aim = null;
    const dx = p.x - enemy.x, dz = p.z - enemy.z;
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
    const boss = enemy.kind === 'boss' || enemy.kind === 'warden';
    const ranged = enemy.kind === 'gunner' || enemy.kind === 'artillery' || enemy.kind === 'captain';
    const mounted = enemy.kind === 'rider' && enemy.mount > 0;
    const rush = enemy.kind === 'charger' || enemy.kind === 'drone' || mounted;
    const reach = boss ? 3.4 : enemy.kind === 'artillery' ? 10 : enemy.kind === 'captain' ? 4.5 : ranged ? 6.8 : rush ? 5.5 : enemy.kind === 'leaper' ? 4.8 : 2;
    const speed = mounted ? 4.4 : enemy.kind === 'minion' ? 4.1 : enemy.kind === 'artillery' ? 1.6 : enemy.kind === 'bruiser' ? 2 : boss ? 1.65 : enemy.kind === 'sentinel' ? 2.2 : enemy.kind === 'scout' ? 3.8 : 3.1;
    const slot = w.enemies.indexOf(enemy);
    // Scouts approach different flanks; support units maintain firing distance.
    const flank = enemy.kind === 'scout' && Math.abs(dx) > 3 ? (slot % 2 ? 1 : -1) * 1.4 : 0;
    let targetVX = Math.abs(dx) > reach ? Math.sign(dx) * speed : 0;
    let targetVZ = Math.abs(dz + flank) > 0.45 ? Math.sign(dz + flank) * speed * 0.75 : 0;
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
    // At most two simultaneous attacks, leaving openings in a crowded wave.
    const attackers = w.enemies.filter((other) => other.alive && other !== enemy && other.state === 'attack').length;
    const canReach = Math.abs(dx) <= (boss ? 9 : reach + 0.3) && Math.abs(dz) < (enemy.kind === 'artillery' ? 7 : boss ? 2.4 : ranged ? 1.8 : 1.15);
    if (!canReach || m.cooldown > 0 || (!boss && attackers >= 2)) return;
    enemy.vx = 0; enemy.vz = 0;
    m.pattern++;
    m.cooldown = boss ? (enemy.armor > 0 ? 2.3 : 1.8) : enemy.kind === 'charger' ? 3.1 : 1.8 + this.random() * 0.9;
    if (boss) {
      const pattern = m.pattern % 3;
      const windup = enemy.armor > 0 ? 1 : 0.85;
      if (Math.abs(dx) > 5 || pattern === 0) this.beginAttack(enemy, 'enemy', 'forward', 'MAINFRAME / LASER', 1.2, 9, 0, { damage: 16, force: 9, growth: 0.07, projectile: true, activeStart: 0.72 * windup, activeEnd: 0.8 });
      else if (pattern === 1) this.beginAttack(enemy, 'enemy', 'down', 'MAINFRAME / SLAM', 1.25, 4.6, 0, { damage: 21, force: 10, growth: 0.075, radial: true, depth: 3.5, height: 1.4, activeStart: 0.75 * windup, activeEnd: 0.96, angle: 0.85 });
      else this.beginAttack(enemy, 'enemy', 'forward', 'MAINFRAME / SWEEP', 1.1, 5.1, 0, { damage: 18, force: 11, growth: 0.07, depth: 2.9, height: 4, activeStart: 0.62 * windup, activeEnd: 0.86 });
    } else if (enemy.kind === 'artillery') {
      m.cooldown = 3.8;
      this.beginAttack(enemy, 'enemy', 'up', 'MORTAR SALVO', 1.55, 12, 0, { projectile: true, activeStart: 0.7, activeEnd: 0.8, damage: 12, force: 7 });
    } else if (enemy.kind === 'leaper') {
      m.cooldown = 2.8;
      this.beginAttack(enemy, 'enemy', 'down', 'LEAP STRIKE', 1.75, 1.8, 0, { damage: 10, force: 6, activeStart: 0.45, activeEnd: 1.28, depth: 1.1 });
    } else if (mounted) {
      m.cooldown = 3.4;
      this.beginAttack(enemy, 'enemy', 'forward', 'RIDER PASS', 1.65, 2.4, 0, { damage: 14, force: 8, activeStart: 0.7, activeEnd: 1.15, depth: 0.9 });
    } else if (ranged) {
      this.beginAttack(enemy, 'enemy', 'forward', 'PULSE SHOT', 1.05, 7, 0, { projectile: true, activeStart: 0.62, activeEnd: 0.7, damage: 8, force: 5.5 });
    } else if (enemy.kind === 'charger') {
      this.beginAttack(enemy, 'enemy', 'forward', 'RAIL CHARGE', 1.5, 1.8, 0, { damage: 13, force: 8.5, growth: 0.06, activeStart: 0.65, activeEnd: 1.08, depth: 0.8 });
    } else if (enemy.kind === 'drone') {
      this.beginAttack(enemy, 'enemy', 'forward', 'SHOCK DIVE', 1.25, 1.9, 0, { damage: 8, force: 6, activeStart: 0.5, activeEnd: 0.9, depth: 0.9 });
    } else if (enemy.kind === 'sentinel') {
      this.beginAttack(enemy, 'enemy', 'forward', 'SHIELD BASH', 1.1, 2.5, 0, { damage: 10, force: 7, activeStart: 0.58, activeEnd: 0.76 });
    } else if (enemy.kind === 'bruiser') {
      this.beginAttack(enemy, 'enemy', 'down', 'HAMMER SLAM', 1.2, 2.9, 0, { damage: 16, force: 8, growth: 0.06, radial: true, depth: 2, height: 1.15, activeStart: 0.66, activeEnd: 0.86 });
    } else {
      this.beginAttack(enemy, 'enemy', 'forward', 'SERVO STRIKE', 0.8, 2.2, 0, { damage: enemy.kind === 'minion' ? 4 : 7, force: enemy.kind === 'minion' ? 3.5 : 5, growth: 0.055, activeStart: 0.36, activeEnd: 0.5 });
    }
  }

  private fireAttack(actor: Actor, strike: Strike): void {
    const w = this.world;
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
      this.shots.set(shot.id, { damage: strike.damage, force: strike.force, growth: strike.growth, facing: actor.facing });
      return;
    }
    const count = actor.kind === 'boss' ? 3 : 1;
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
      this.shots.set(projectile.id, { damage: strike.damage, force: strike.force, growth: strike.growth, facing: actor.facing });
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
          // An already-launched shell survives its owner's defeat. Neutral
          // attribution prevents a missing owner from cancelling the impact.
          const attacker = source ?? { ...p, id: shot.ownerId, kind: 'artillery' as const, x: shot.x, z: shot.z };
          if (data && Math.hypot(p.x - shot.x, p.z - shot.z) < 2.1 && p.y >= 0 && p.y < 1.4) this.hit(p, attacker, data.damage, data.force, data.growth, 0.8, p.x > shot.x ? 1 : -1, 'enemy');
          for (const prop of w.props) if (prop.hp > 0 && Math.hypot(prop.x - shot.x, prop.z - shot.z) < 2.1) this.damageProp(prop, 12);
          shot.life = 0;
        }
        continue;
      }
      if (!source) { shot.life = 0; continue; }
      for (const prop of w.props) {
        if (!prop.alive || prop.hp <= 0 || shot.life <= 0 || shot.y < 0 || shot.y > prop.height) continue;
        if (insideProp(prop, shot.x, shot.z, shot.radius)) {
          const data = this.shots.get(shot.id);
          if (data) this.damageProp(prop, data.damage);
          shot.life = 0;
        }
      }
      const targets = source.kind === 'player' ? w.enemies : [w.player];
      for (const target of targets) {
        if (!target.alive || target.invulnerable > 0 || shot.life <= 0) continue;
        if (Math.abs(shot.x - target.x) < 0.55 * target.scale + shot.radius && Math.abs(shot.z - target.z) < 0.5 * target.scale + shot.radius && shot.y > target.y - 0.1 && shot.y < target.y + 1.85 * target.scale) {
          const data = this.shots.get(shot.id);
          if (data) this.hit(target, source, data.damage, data.force, data.growth, 0.45, data.facing, 'special', shot);
          shot.life = 0;
        }
      }
    }
    w.projectiles = w.projectiles.filter((shot) => {
      if (shot.life <= 0) { this.shots.delete(shot.id); return false; }
      return true;
    });
  }

  private hit(target: Actor, source: Actor, damage: number, force: number, growth: number, angle: number, facing: 1 | -1, kind: AttackKind, projectile?: Pick<Projectile, 'vx'>): void {
    if (!target.alive || target.invulnerable > 0) return;
    const w = this.world, m = this.memory(target);
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
        return;
      }
      this.effect('text', target.x, target.y + 2, target.z, 1.1, 1, 0x6bbfff, 'GUARD BREAK');
      this.effect('shockwave', target.x, target.y + 1, target.z, 0.5, 2.5, 0x6bbfff);
    }
    target.damage = Math.min(999, target.damage + damage);
    let armored = target.armor > 0;
    if (armored) {
      target.armor = Math.max(0, target.armor - damage * (kind === 'smash' ? 1.65 : 1));
      if (target.armor <= 0 && !m.bossBroken) {
        armored = false; m.bossBroken = true;
        w.message = 'CORE EXPOSED // 吹っ飛ばせ'; w.messageTime = 3.2;
        this.effect('shockwave', target.x, 1.3, target.z, 1, 5, 0xffd17c);
        w.events.push({ type: 'boss' });
        w.shake = 0.75;
      }
    }
    const weight = target.kind === 'player' ? w.loadout.weight : target.kind === 'boss' ? 1.85 : target.kind === 'warden' ? 1.5 : target.mount > 0 ? 1.4 : target.kind === 'minion' ? 0.6 : target.kind === 'bruiser' ? 1.45 : target.kind === 'drone' ? 0.78 : 1;
    const impulse = (force + target.damage * growth) / weight * (armored ? 0.16 : 1);
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
    target.invulnerable = 0.065;
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
  }

  private damageProp(prop: ArenaProp, damage: number): void {
    if (!prop.alive || prop.hp <= 0) return;
    prop.hp = Math.max(0, prop.hp - damage);
    this.effect('hit', prop.x, prop.height * 0.7, prop.z, 0.25, 0.8, prop.kind === 'crate' ? 0x65f0b1 : 0xffaa55);
    if (prop.hp > 0) return;
    prop.alive = false;
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
        if (other !== prop && other.alive && other.hp > 0 && Math.hypot(other.x - prop.x, other.z - prop.z) < 3) this.damageProp(other, 24);
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
        prop.phase = w.mode === 'training' || w.phase !== 'playing' ? 'idle' : prop.timer < 3.8 ? 'idle' : prop.timer < 5 ? 'warning' : 'active';
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
          if (px < pz) { actor.x += (dx >= 0 ? 1 : -1) * px; actor.vx = 0; }
          else { actor.z += (dz >= 0 ? 1 : -1) * pz; actor.vz = 0; }
        }
      }
    }
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
    if (!isDroneHovering && !(actor.state === 'airdodge' && actor.stateTime < 0.13)) actor.vy -= GRAVITY * dt;
    actor.x += actor.vx * dt; actor.y += actor.vy * dt; actor.z += actor.vz * dt;
    if (wasGrounded && m.forced <= 0 && actor.state !== 'hurt' && actor.state !== 'airdodge' && beforeX >= this.world.arenaMin && beforeX <= this.world.arenaMax && Math.abs(beforeZ) <= PLATFORM_DEPTH) {
      actor.x = clamp(actor.x, this.world.arenaMin + 0.35, this.world.arenaMax - 0.35);
      actor.z = clamp(actor.z, -3.8, 3.8);
    }
    // Only a downward crossing from the top can land. Moving underneath the
    // platform after falling off must not teleport a fighter back onto it.
    if (this.onPlatform(actor) && beforeY >= 0 && actor.y <= 0 && actor.vy <= 0) {
      if (actor.state === 'airdodge' && m.airDodgeDown && Math.abs(actor.vx) > 3) {
        actor.state = 'wavedash'; actor.stateTime = 0;
        m.actionTimer = 0.4;
        actor.vx *= 1.08;
        if (actor.kind === 'player') {
          this.world.lastMove = 'WAVEDASH';
          this.world.events.push({ type: 'wavedash' });
          this.effect('text', actor.x, 1.6, actor.z, 0.9, 1, this.world.loadout.color, 'WAVEDASH');
          this.effect('trail', actor.x, 0.12, actor.z, 0.5, 2.5, this.world.loadout.color);
        }
      } else if (actor.state === 'jump' || actor.state === 'fall' || actor.state === 'airdodge') {
        actor.state = 'idle'; actor.stateTime = 0; m.actionTimer = 0;
      }
      actor.y = 0; actor.vy = 0;
      m.jumps = 0; m.airDodgeUsed = false; m.airDodgeDown = false; m.recoveryUsed = false;
    }
    const grounded = actor.y === 0 && this.onPlatform(actor);
    if (actor.state === 'wavedash') actor.vx *= Math.exp(-dt * 2.5);
    else if (actor.state === 'hurt') {
      const drag = grounded ? 2.2 : 0.12;
      actor.vx *= Math.exp(-dt * drag); actor.vz *= Math.exp(-dt * drag);
    } else if (actor.state === 'dodge') {
      actor.vx *= Math.exp(-dt * 3.6); actor.vz *= Math.exp(-dt * 3.6);
    } else if (actor.state === 'attack' && !['PHASE SHIFT', 'RAIL CHARGE', 'SHOCK DIVE', 'RIDER PASS', 'LEAP STRIKE'].includes(actor.attack?.name ?? '') && actor.attack?.kind !== 'dash') {
      actor.vx *= Math.exp(-dt * (grounded ? 14 : 0.8));
      actor.vz *= Math.exp(-dt * (grounded ? 14 : 0.8));
    }
    if (actor.kind === 'player' && actor.state === 'airdodge' && !input.dodgeHeld && actor.stateTime > 0.2) {
      actor.vx *= Math.exp(-dt * 4);
    }
  }

  private ringOut(actor: Actor): void {
    if (!actor.alive) return;
    const w = this.world;
    actor.alive = false; actor.state = 'dead'; actor.stateTime = 0; actor.attack = null; actor.telegraph = 0;
    const m = this.memory(actor);
    if (m.grabTarget) this.releaseGrab(actor);
    if (m.grabbedBy) this.releaseGrab(w.player);
    this.effect('ringout', clamp(actor.x, w.arenaMin - 3, w.arenaMax + 3), clamp(actor.y, 1, 8), clamp(actor.z, -5, 5), 1.15, actor.kind === 'boss' ? 7 : 3.8, actor.kind === 'player' ? 0xff646a : w.loadout.color);
    w.events.push({ type: 'ko', intensity: actor.kind === 'boss' ? 1 : 0.7 });
    w.shake = Math.max(w.shake, actor.kind === 'boss' ? 1 : 0.45);
    if (actor.kind === 'player') {
      w.stocks--;
      w.combo = 0;
      m.respawnTimer = 1.15;
      w.message = w.stocks > 0 ? 'CHASSIS LOST // REBOOTING' : 'SIGNAL LOST';
      w.messageTime = 2;
      if (w.stocks <= 0 && w.mode !== 'training') {
        w.phase = 'lost';
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
      if (actor.kind === 'boss') {
        w.completedSectors = STAGES.length; w.phase = 'won'; w.message = 'DIRECTIVE BROKEN'; w.messageTime = 99;
        w.score += w.stocks * 500;
        w.events.push({ type: 'win' });
      }
    }
  }

  private respawn(): void {
    const w = this.world, p = w.player;
    p.alive = true; p.x = w.sector * 28 - 4; p.y = 3; p.z = 0;
    p.vx = 0; p.vy = 0; p.vz = 0; p.damage = 0;
    p.invulnerable = 3; p.state = 'fall'; p.stateTime = 0; p.attack = null;
    this.resetMemory(p);
    this.effect('spawn', p.x, 0.03, p.z, 1, 2.5, w.loadout.color);
  }

  private spawnWave(): void {
    const w = this.world;
    w.waveTimer = 0;
    const kinds = w.mode === 'training' ? TRAINING_WAVES[(w.wave - 1) % TRAINING_WAVES.length]! : STAGES[w.sector]!.waves[w.wave - 1]!.enemies;
    for (let index = 0; index < kinds.length; index++) {
      const kind = kinds[index]!;
      const x = w.sector * 28 + (kind === 'boss' || kind === 'warden' ? 5 : 1.5 + index * 2.1);
      const z = kind === 'boss' ? 0 : [-1.7, 1.7, 0, -2.4][index % 4]!;
      const enemy = this.makeActor(kind, x, z);
      this.memory(enemy).spawnTime = w.time + index;
      enemy.invulnerable = 0.6 + index * 0.1;
      w.enemies.push(enemy);
      this.effect('spawn', x, 0, z, 0.8, enemy.scale * 1.4, kind === 'boss' ? 0xff6e55 : 0xffb35c);
      if (kind === 'captain') {
        for (const side of [-1, 1]) {
          const minion = this.makeActor('minion', clamp(x - 1.4, w.arenaMin + 1, w.arenaMax - 1), clamp(z + side * 1.2, -3.4, 3.4));
          minion.leaderId = enemy.id; minion.invulnerable = 0.9;
          w.enemies.push(minion);
          this.effect('spawn', minion.x, 0, minion.z, 0.8, 0.8, 0xc9ed6a);
        }
      }
      if (kind === 'boss' || kind === 'warden') {
        w.message = kind === 'boss' ? 'WARNING // THE ARCHITECT' : 'MIDBOSS // THE WARDEN'; w.messageTime = 4;
        w.events.push({ type: 'boss' });
      }
    }
    if (w.mode !== 'training') w.events.push({ type: 'wave' });
  }

  private completeWave(): void {
    const w = this.world;
    if (w.mode === 'training') {
      w.wave++;
      w.player.damage = 0;
      this.spawnWave();
    } else if (w.wave < STAGES[w.sector]!.waves.length) {
      w.wave++;
      w.message = `WAVE ${w.wave} // ${STAGES[w.sector]!.waves[w.wave - 1]!.name}`; w.messageTime = 2.5;
      this.spawnWave();
    } else if (w.sector < STAGES.length - 1) {
      w.completedSectors = w.sector + 1;
      w.phase = 'sector-clear'; this.sectorCleared = true;
      w.message = 'SECTOR CLEAR // 補給を選び、次の戦場へ'; w.messageTime = 99;
      w.player.damage = Math.max(0, w.player.damage - 10);
      w.score += 600;
      w.projectiles = [];
      this.shots.clear();
    }
  }

  private effect(type: Effect['type'], x: number, y: number, z: number, duration: number, size: number, color: number, text?: string): void {
    this.world.effects.push({ id: `fx-${this.serial++}`, type, x, y, z, life: duration, duration, size, color, ...(text ? { text } : {}) });
  }

  private updateEffects(dt: number): void {
    for (const effect of this.world.effects) effect.life -= dt;
    this.world.effects = this.world.effects.filter((effect) => effect.life > 0).slice(-100);
  }
}
