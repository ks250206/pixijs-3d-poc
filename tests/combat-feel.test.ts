import { describe, expect, it } from 'vite-plus/test';
import { mergeInputFrames, clearInputEdges } from '../src/game/action-buffer';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { EMPTY_INPUT, type InputFrame, type WeaponId } from '../src/game/types';

const frame = (input: Partial<InputFrame> = {}): InputFrame => ({ ...EMPTY_INPUT, ...input });
const tick = (g: GameEngine, count = 1, input: Partial<InputFrame> = {}) => {
  for (let i = 0; i < count; i++) g.update(1 / 60, frame(input));
};
function lab(weapon: WeaponId = 'arc') {
  const g = new GameEngine(41);
  g.start(createCandidates(41).find(l => l.weapon === weapon)!, 'training');
  g.world.enemies = [];
  g.world.props = [];
  g.world.loadout.modules.weapon = 'quick';
  g.world.player.invulnerable = 0;
  return g;
}

describe('air control during normal attacks', () => {
  it.each<WeaponId>(['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'])('%s keeps the same four-frame short hop with an aerial', weapon => {
    const heights = [false, true].map(attack => {
      const g = lab(weapon);
      tick(g, 1, { jump: true, jumpHeld: true, attack });
      tick(g, 3, { jumpHeld: true });
      tick(g);
      const releasedVelocity = g.world.player.vy;
      let maximum = g.world.player.y;
      for (let i = 0; i < 45; i++) { tick(g); maximum = Math.max(maximum, g.world.player.y); }
      return { releasedVelocity, maximum };
    });
    expect(heights[1]!.releasedVelocity).toBeCloseTo(heights[0]!.releasedVelocity);
    expect(heights[1]!.maximum).toBeCloseTo(heights[0]!.maximum);
  });

  it('steers on both axes and fast-falls without interrupting an aerial', () => {
    const g = lab(), p = g.world.player;
    Object.assign(p, { y: 4, vy: -1 });
    tick(g, 1, { attack: true });
    const attack = p.attack, vy = p.vy;
    tick(g, 1, { moveX: 1, moveZ: 1 });
    expect(p.attack).toBe(attack);
    expect(p.state).toBe('attack');
    expect(p.vx).toBeGreaterThan(0);
    expect(p.vz).toBeGreaterThan(0);
    expect(p.vy).toBeLessThan(vy - 1);
  });

  it.each(['phase', 'recovery', 'emp', 'airdodge'] as const)('preserves forced %s motion under opposing steering', kind => {
    const velocities = [false, true].map(steer => {
      const g = lab(), p = g.world.player;
      Object.assign(p, { y: 4, vy: 0 });
      if (kind === 'airdodge') tick(g, 1, { dodge: true, dodgeHeld: true, moveZ: -1, jumpHeld: true });
      else tick(g, 1, { special: true, moveX: kind === 'phase' ? 1 : 0, moveZ: kind === 'recovery' ? -1 : kind === 'emp' ? 1 : 0, jumpHeld: true });
      tick(g, 3, { moveX: steer ? -1 : 0, moveZ: steer ? 1 : 0, dodgeHeld: true });
      return [p.vx, p.vy, p.vz];
    });
    expect(velocities[1]).toEqual(velocities[0]);
  });
});

describe('five-frame action buffering', () => {
  it.each([4, 5])('keeps a press %i ticks before unlock only within the five-frame window', ticksBefore => {
    const probe = lab();
    tick(probe, 1, { attack: true });
    let unlock = 1;
    while (probe.world.player.attack) { tick(probe); unlock++; }
    const g = lab();
    tick(g, 1, { attack: true });
    const pressedAt = unlock - ticksBefore;
    for (let frame = 2; frame <= unlock; frame++) tick(g, 1, frame === pressedAt ? { attack: true, moveZ: -1 } : {});
    expect(g.world.player.attack?.direction ?? null).toBe(ticksBefore === 4 ? 'up' : null);
  });

  it('uses the original direction at the first legal recovery frame and executes once', () => {
    const g = lab(), p = g.world.player;
    tick(g, 1, { attack: true });
    const first = p.attack;
    while (p.attack!.duration - p.attack!.elapsed > 2 / 60 + 1e-7) tick(g);
    tick(g, 1, { attack: true, attackHeld: true, moveZ: -1 });
    expect(p.attack).toBe(first);
    for (let i = 0; i < 5 && p.attack === first; i++) tick(g, 1, { attackHeld: true, moveX: 1 });
    expect(p.attack).not.toBe(first);
    expect(p.attack?.direction).toBe('up');
    expect(p.attack?.kind).toBe('tilt');
    tick(g, 45, { attackHeld: true });
    expect(p.attack).toBeNull();
  });

  it('expires an early press rather than replaying it after a long recovery', () => {
    const g = lab(), p = g.world.player;
    tick(g, 1, { attack: true });
    const first = p.attack;
    tick(g, 1, { attack: true, moveZ: -1 });
    for (let i = 0; i < 40; i++) {
      tick(g, 1, { attackHeld: true });
      if (p.attack) expect(p.attack).toBe(first);
    }
    expect(p.attack).toBeNull();
  });

  it.each(['recovery', 'render'] as const)('preserves a reversed dash-attack direction across %s buffering', source => {
    const g = lab(), p = g.world.player;
    p.facing = 1;
    if (source === 'recovery') {
      tick(g, 1, { attack: true });
      const first = p.attack;
      while (p.attack!.duration - p.attack!.elapsed > 2 / 60 + 1e-7) tick(g);
      tick(g, 1, { attack: true, dash: true, moveX: -1 });
      for (let i = 0; i < 5 && p.attack === first; i++) tick(g);
    } else {
      const pressed = mergeInputFrames(frame(), frame({ attack: true, dash: true, moveX: -1 }));
      g.update(1 / 60, mergeInputFrames(pressed, frame()));
    }
    expect(p.attack?.kind).toBe('dash');
    expect(p.facing).toBe(-1);
    expect(p.vx).toBeLessThan(0);
  });

  it('retains a press through hitstop without refreshing it or replacing its aim', () => {
    const g = lab(), p = g.world.player;
    g.world.hitstop = 0.2;
    tick(g, 1, { attack: true, moveZ: -1 });
    while (g.world.hitstop > 0) tick(g, 1, { moveX: 1, attackHeld: true });
    expect(p.attack).toBeNull();
    tick(g, 1, { moveX: 1, attackHeld: true });
    expect(p.attack?.direction).toBe('up');
    tick(g, 45, { attackHeld: true });
    expect(p.attack).toBeNull();
  });

  it('accepts a jump at the first hit-confirm cancel frame', () => {
    const g = new GameEngine(41);
    g.start(createCandidates(41).find(l => l.weapon === 'arc')!, 'training');
    const p = g.world.player, target = g.world.enemies[0]!;
    g.world.props = [];
    g.world.enemies = [target];
    g.world.loadout.modules.weapon = 'quick';
    Object.assign(target, { x: p.x + 1.4, y: 0, z: p.z, invulnerable: 0 });
    tick(g, 1, { attack: true });
    for (let i = 0; i < 12 && g.world.hitstop <= 0; i++) tick(g);
    expect(target.damage).toBeGreaterThan(0);
    expect(g.world.hitstop).toBeGreaterThan(0);
    tick(g, 1, { jump: true, jumpHeld: true });
    let jumps = 0;
    for (let i = 0; i < 20; i++) {
      tick(g, 1, { jumpHeld: true });
      jumps += g.world.events.filter(e => e.type === 'jump').length;
    }
    expect(jumps).toBe(1);
    expect(p.y).toBeGreaterThan(0);
  });

  it('buffers a spent-airtime jump across landing and respects a released jump button', () => {
    const g = lab(), p = g.world.player;
    tick(g, 1, { jump: true, jumpHeld: true });
    tick(g, 1, { jump: true, jumpHeld: true });
    Object.assign(p, { y: 0.04, vy: -3, state: 'fall' });
    tick(g, 1, { jump: true, jumpHeld: true });
    expect(p.y).toBe(0);
    tick(g);
    expect(g.world.lastMove).toBe('JUMP');
    expect(p.y).toBeGreaterThan(0);
    expect(p.vy).toBeCloseTo(4.75);
    tick(g, 15);
    expect(g.world.events.some(e => e.type === 'jump')).toBe(false);
  });

  it.each(['pause', 'menu', 'death', 'restart'] as const)('clears pending input on %s', transition => {
    const g = lab();
    g.world.hitstop = 0.2;
    tick(g, 1, { attack: true });
    if (transition === 'pause') { g.pause(); g.resume(); }
    else if (transition === 'menu') { g.world.phase = 'ready'; tick(g); g.world.phase = 'playing'; }
    else if (transition === 'death') { g.world.player.alive = false; tick(g); g.world.player.alive = true; }
    else g.restart();
    g.world.hitstop = 0;
    tick(g);
    expect(g.world.player.attack).toBeNull();
  });

  it('preserves a short directional press across render frames without altering live movement', () => {
    const g = lab();
    let pending = mergeInputFrames(frame(), frame({ attack: true, moveZ: -1 }));
    pending = mergeInputFrames(pending, frame({ moveX: 1 }));
    expect(pending.moveX).toBe(1);
    expect(pending.moveZ).toBe(0);
    g.update(1 / 60, pending);
    expect(g.world.player.attack?.direction).toBe('up');
    g.update(1 / 60, clearInputEdges(pending));
    tick(g, 40);
    expect(g.world.player.attack).toBeNull();
  });
});

describe('independent aerial recovery', () => {
  it('does not bypass enemy hitstun even when the recovery right remains unused', () => {
    const g = new GameEngine(41);
    g.start(createCandidates(41)[0]!, 'campaign');
    const p = g.world.player, enemy = g.world.enemies[0]!;
    Object.assign(p, { x: 0, z: 0, invulnerable: 0 });
    Object.assign(enemy, { kind: 'gunner', x: 6, y: 0, z: 0, invulnerable: 0 });
    g.world.enemies = [enemy]; g.world.props = [];
    for (let i = 0; i < 900 && p.state !== 'hurt'; i++) tick(g);
    expect(p.state).toBe('hurt');
    while (g.world.hitstop > 0) tick(g);
    g.world.specialCooldown = 2;
    tick(g, 1, { special: true, moveZ: -1 });
    expect(p.state).toBe('hurt');
    expect(p.attack).toBeNull();
    expect(g.world.recoveryAvailable).toBe(true);
  });

  it('uses the unused recovery during offensive cooldown and restores it only on landing', () => {
    const g = lab(), p = g.world.player;
    g.world.loadout.special = 'vortex';
    tick(g, 1, { special: true, moveZ: 1 });
    while (p.attack) tick(g);
    expect(g.world.specialCooldown).toBeGreaterThan(1);
    expect(g.world.recoveryAvailable).toBe(true);
    const cooldown = g.world.specialCooldown;
    Object.assign(p, { y: 2, vy: -1, state: 'fall' });
    tick(g, 1, { special: true, moveZ: -1 });
    expect(g.world.player.attack?.move?.id).toBe('special.recovery');
    expect(p.vy).toBeGreaterThan(13);
    expect(g.world.specialCooldown).toBeCloseTo(cooldown - 1 / 60);
    expect(g.world.recoveryAvailable).toBe(false);
    while (p.attack) tick(g);
    g.world.specialCooldown = 0;
    tick(g, 1, { special: true, moveZ: -1 });
    expect(p.attack).toBeNull();
    tick(g, 5);
    Object.assign(p, { y: 0.04, vy: -3, state: 'fall' });
    tick(g);
    expect(p.y).toBe(0);
    expect(g.world.recoveryAvailable).toBe(true);
    tick(g, 1, { special: true, moveZ: -1 });
    expect(g.world.player.attack?.move?.id).toBe('special.recovery');
  });

  it('does not turn recovery into a whiff cancel through attack startup', () => {
    const g = lab(), p = g.world.player;
    tick(g, 1, { attack: true });
    const attack = p.attack;
    tick(g, 1, { special: true, moveZ: -1 });
    expect(p.attack).toBe(attack);
    tick(g, 25);
    expect(g.world.recoveryAvailable).toBe(true);
    expect(p.y).toBe(0);
  });
});
