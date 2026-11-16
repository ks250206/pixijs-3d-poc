import { describe, expect, it } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { createUpgradeChoices, UPGRADE_DEFINITIONS, upgradeRank, type RunUpgrade, type UpgradeId } from '../src/game/upgrades';
import { EMPTY_INPUT, type WeaponId } from '../src/game/types';
import { STAGES } from '../src/game/campaign';
import { runCampaignInputs } from './helpers/play';

const tick = (g: GameEngine, frames = 1) => { for (let i = 0; i < frames; i++) g.update(1 / 60); };
function lab(weapon: WeaponId, id?: UpgradeId) {
  const g = new GameEngine(73);
  g.start({ ...createCandidates(73).find((c) => c.weapon === weapon)!, power: 1 }, 'training');
  tick(g, 100); g.world.props = [];
  Object.assign(g.world.player, { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, facing: 1, invulnerable: 100 });
  g.world.enemies = g.world.enemies.slice(0, 2);
  g.world.enemies.forEach((enemy, i) => Object.assign(enemy, { x: 1.5, z: i ? 3.5 : 0, y: 0, vx: 0, vy: 0, vz: 0, invulnerable: 0, armor: 0, guard: 0 }));
  if (id) g.world.upgrades.push({ id, rank: 1 });
  return g;
}

describe('deterministic run build rewards', () => {
  it('can offer every module exchange alongside two weapon choices at the first reward', () => {
    const loadout = createCandidates(73)[0]!;
    const offered = new Set<UpgradeId>();
    for (let seed = 1; seed <= 60; seed++) {
      const choices = createUpgradeChoices(seed, 0, loadout, []);
      expect(choices.filter(choice => choice.weapon === loadout.weapon)).toHaveLength(2);
      offered.add(choices.find(choice => choice.weapon === 'all')!.id);
    }
    expect([...offered].sort()).toEqual(['neutral-tune', 'side-tune', 'weapon-tune']);
  });

  it('offers three usable deterministic choices at every real reward, even after repeatedly taking one path', () => {
    for (const loadout of createCandidates(73)) {
      const upgrades: RunUpgrade[] = [];
      for (let sector = 0; sector < 6; sector++) {
        const choices = createUpgradeChoices(73, sector, loadout, upgrades);
        expect(choices).toEqual(createUpgradeChoices(73, sector, loadout, upgrades));
        expect(choices).toHaveLength(3);
        expect(new Set(choices.map((choice) => choice.id)).size).toBe(3);
        expect(choices.every((choice) => choice.rank < choice.maxRank && choice.description.length > 10)).toBe(true);
        const chosen = choices[0]!, previous = upgrades.find((u) => u.id === chosen.id);
        if (previous) previous.rank++; else upgrades.push({ id: chosen.id, rank: 1 });
      }
    }
  });

  it('gates travel until a choice, grants once, preserves the build and resets both ranks and rewired modules on retry', () => {
    const g = new GameEngine(73), loadout = createCandidates(73).find((c) => c.weapon === 'pile')!;
    g.start(loadout);
    expect(g.claimUpgrade('pile-quake')).toBe(false);
    runCampaignInputs(g, 60 * 180, () => g.world.phase === 'sector-clear');
    expect(g.world.phase).toBe('sector-clear');
    expect(g.world.upgradeChoices).toHaveLength(3);
    g.nextSector(); expect(g.world.sector).toBe(0);
    g.pause();
    const choice = g.world.upgradeChoices.find((entry) => entry.weapon === 'all')!;
    expect(g.claimUpgrade(choice.id)).toBe(true);
    expect(g.claimUpgrade(choice.id)).toBe(false);
    expect(upgradeRank(g.world.upgrades, choice.id)).toBe(1);
    expect(g.world.loadout.modules).not.toEqual(loadout.modules);
    g.resume(); g.nextSector();
    expect(g.world.sector).toBe(1);
    expect(upgradeRank(g.world.upgrades, choice.id)).toBe(1);
    g.restart();
    expect(g.world.upgrades).toEqual([]);
    expect(g.world.upgradeChoices).toEqual([]);
    expect(g.world.loadout.modules).toEqual(loadout.modules);
  });

  it('does not spend ineffective supplies and chooses useful automatic supply at zero damage', () => {
    const g = lab('arc'); g.world.mode = 'campaign'; g.world.phase = 'sector-clear';
    g.world.player.damage = 0; g.world.stocks = 4;
    expect(g.claimSupply('repair')).toBe(false); expect(g.claimSupply('stock')).toBe(false);
    expect(g.world.supplyClaimed).toBe(false);
    const power = g.world.loadout.power;
    g.nextSector(); expect(g.world.loadout.power).toBeCloseTo(power + .08);
  });

  it('keeps upgrade caps finite and each weapon has three distinct mechanics', () => {
    for (const weapon of ['arc', 'pile', 'razor', 'lance', 'cannon', 'scythe'] as const) {
      const choices = UPGRADE_DEFINITIONS.filter((choice) => choice.weapon === weapon);
      expect(choices).toHaveLength(3);
      expect(choices.every((choice) => choice.maxRank === 2)).toBe(true);
    }
  });
});

describe('six weapon upgrades change actual combat', () => {
  it.each([1, -1] as const)('grants tip refunds on a sentinel body hit, but not a shield block (facing %i)', facing => {
    const attack = (upgrade: boolean) => {
      const g = lab('lance', upgrade ? 'lance-capacitor' : undefined), target = g.world.enemies[0]!;
      Object.assign(target, { kind: 'sentinel', x: 4, facing, guard: 40 });
      g.world.specialCooldown = 1.5;
      g.update(1 / 60, { ...EMPTY_INPUT, attack: true }); tick(g, 25);
      expect(target.damage).toBeGreaterThan(0);
      if (facing === 1) expect(target.guard).toBe(40); else expect(target.guard).toBeLessThan(40);
      return g.world.specialCooldown;
    };
    expect(attack(false) - attack(true)).toBeCloseTo(facing === 1 ? .35 : 0, 2);
  });

  it('recharges the lance special only after a real tip hit, not a close hit', () => {
    const refund = (upgrade: boolean, x: number) => {
      const g = lab('lance', upgrade ? 'lance-capacitor' : undefined);
      g.world.enemies[0]!.x = x; g.world.specialCooldown = 1.5;
      g.update(1 / 60, { ...EMPTY_INPUT, attack: true }); tick(g, 25);
      expect(g.world.enemies[0]!.damage).toBeGreaterThan(0);
      return g.world.specialCooldown;
    };
    expect(refund(false, 4) - refund(true, 4)).toBeCloseTo(.35, 2);
    expect(refund(false, 1.4) - refund(true, 1.4)).toBeCloseTo(0, 2);
  });

  it('gives the blade one air-jump refresh after an aerial connects', () => {
    const jump = (upgrade: boolean) => {
      const g = lab('arc', upgrade ? 'arc-skyhook' : undefined);
      g.update(1 / 60, { ...EMPTY_INPUT, jump: true, jumpHeld: true }); tick(g, 8);
      g.update(1 / 60, { ...EMPTY_INPUT, jump: true, jumpHeld: true });
      Object.assign(g.world.player, { y: 2, vy: -3 });
      Object.assign(g.world.enemies[0]!, { x: 1.5, y: 2, z: 0 });
      g.update(1 / 60, { ...EMPTY_INPUT, attack: true });
      for (let i = 0; i < 30 && (g.world.player.attack?.elapsed ?? 0) * 60 < 10; i++) tick(g);
      expect(g.world.enemies[0]!.damage).toBeGreaterThan(0);
      g.update(1 / 60, { ...EMPTY_INPUT, jump: true, jumpHeld: true });
      return g.world.player.state;
    };
    expect(jump(true)).toBe('jump'); expect(jump(false)).not.toBe('jump');
  });

  it('adds a delayed pile shockwave that hits outside the forward weapon lane', () => {
    const damage = (upgrade: boolean) => {
      const g = lab('pile', upgrade ? 'pile-quake' : undefined);
      Object.assign(g.world.enemies[0]!, { x: 0, z: 2.6 });
      g.update(1 / 60, { ...EMPTY_INPUT, smash: true }); tick(g, 60);
      return g.world.enemies[0]!.damage;
    };
    expect(damage(false)).toBe(0); expect(damage(true)).toBeGreaterThan(0);
  });

  it('rewards three connected razor strikes with a temporary movement burst', () => {
    const speed = (upgrade: boolean) => {
      const g = lab('razor', upgrade ? 'razor-flow' : undefined);
      for (let hit = 0; hit < 3; hit++) {
        const target = g.world.enemies[0]!;
        Object.assign(target, { x: .9, y: 0, z: 0, vx: 0, vy: 0, vz: 0, invulnerable: 0 });
        const old = target.damage;
        g.update(1 / 60, { ...EMPTY_INPUT, attack: true }); tick(g, 25);
        expect(target.damage).toBeGreaterThan(old);
      }
      for (let i = 0; i < 20; i++) g.update(1 / 60, { ...EMPTY_INPUT, moveX: 1 });
      return g.world.player.vx;
    };
    expect(speed(true)).toBeGreaterThan(speed(false) * 1.1);
  });

  it('splits a cannon smash into actual differently directed rounds', () => {
    const g = lab('cannon', 'cannon-split');
    g.world.enemies.forEach((enemy) => { enemy.x = 9; });
    g.update(1 / 60, { ...EMPTY_INPUT, smash: true });
    for (let i = 0; i < 80 && !g.world.projectiles.length; i++) tick(g);
    expect(g.world.projectiles).toHaveLength(3);
    expect(new Set(g.world.projectiles.map((shot) => Math.sign(shot.vz))).size).toBe(3);
  });

  it('ricochets a cannon round to a second lane only after the first impact', () => {
    const damage = (upgrade: boolean) => {
      const g = lab('cannon', upgrade ? 'cannon-bounce' : undefined);
      Object.assign(g.world.enemies[0]!, { x: 4, z: 0 });
      Object.assign(g.world.enemies[1]!, { x: 6, z: 1.8 });
      g.update(1 / 60, { ...EMPTY_INPUT, attack: true }); tick(g, 80);
      expect(g.world.enemies[0]!.damage).toBeGreaterThan(0);
      return g.world.enemies[1]!.damage;
    };
    expect(damage(false)).toBe(0); expect(damage(true)).toBeGreaterThan(0);
  });

  it('triggers the scythe finisher after two enemies, and never on one target', () => {
    const damage = (upgrade: boolean, count: number) => {
      const g = lab('scythe', upgrade ? 'scythe-chain' : undefined);
      g.world.enemies = g.world.enemies.slice(0, count);
      g.world.enemies.forEach((enemy, i) => Object.assign(enemy, { x: i ? -1.5 : 1.5, z: i ? -1.7 : 1.7 }));
      g.update(1 / 60, { ...EMPTY_INPUT, attack: true }); tick(g, 45);
      return g.world.enemies.reduce((sum, enemy) => sum + enemy.damage, 0);
    };
    expect(damage(true, 1)).toBeCloseTo(damage(false, 1));
    expect(damage(true, 2)).toBeGreaterThan(damage(false, 2));
  });
});

function stage(sector: number) {
  const g = new GameEngine(73);
  g.start({ ...createCandidates(73).find((c) => c.weapon === 'lance')!, power: 4 });
  for (let i = 0; i < sector; i++) { g.world.phase = 'sector-clear'; g.nextSector(); }
  g.world.player.invulnerable = 1000;
  return g;
}
function destroy(g: GameEngine, id: string) {
  const prop = g.world.props.find((entry) => entry.id === id)!;
  Object.assign(g.world.player, { x: prop.x - 3.9, z: prop.z, y: 0, vx: 0, vy: 0, vz: 0, facing: 1 });
  for (let i = 0; i < 150 && prop.alive; i++) g.update(1 / 60, { ...EMPTY_INPUT, attack: i % 25 === 0 });
  expect(prop.alive).toBe(false);
}

describe('objectives change battlefield danger and staged arrivals', () => {
  it('shows bounded relay arrivals and destroying one cancels its warning and future reinforcement pulses', () => {
    const g = stage(0); tick(g, 490);
    expect(g.world.pendingSpawns.filter((spawn) => spawn.source === 'relay')).toHaveLength(2);
    expect(g.world.pendingSpawns.every((spawn) => spawn.remaining <= spawn.duration)).toBe(true);
    destroy(g, 'objective-0-0');
    expect(g.world.pendingSpawns.some((spawn) => spawn.sourceId === 'objective-0-0')).toBe(false);
    tick(g, 60 * 30);
    expect(g.world.objective.reinforcements).toBe(4);
    expect(g.world.pendingSpawns).toHaveLength(0);
    expect(g.world.enemies.filter((enemy) => enemy.alive).length).toBeLessThanOrEqual(14);
  });

  it('node A cancels artillery while node B independently shuts down vents', () => {
    const g = stage(5); tick(g, 390);
    expect(g.world.hazards.some((hazard) => hazard.ownerId === 'objective-5-0')).toBe(true);
    destroy(g, 'objective-5-0');
    expect(g.world.hazards.some((hazard) => hazard.ownerId === 'objective-5-0')).toBe(false);
    const vent = g.world.props.find((prop) => prop.kind === 'vent')!;
    vent.timer = 5.2; tick(g);
    expect(vent.phase).toBe('active');
    destroy(g, 'objective-5-1'); vent.timer = 5.2; tick(g);
    expect(vent.phase).toBe('idle');
    tick(g, 420);
    expect(g.world.hazards.some((hazard) => hazard.ownerId.startsWith('objective-'))).toBe(false);
    expect(g.world.message).not.toContain('GATE ENABLED');
  });

  it('starts lockdown only at the final wave and opens a safe exit after survival even with enemies left', () => {
    const g = stage(2); tick(g, 1200);
    expect(g.world.objective.activated).toBe(false); expect(g.world.objective.progress).toBe(0);
    for (let wave = 0; wave < STAGES[2]!.waves.length - 1; wave++) {
      g.world.enemies.forEach((enemy) => { enemy.x = g.world.arenaMax + 6; }); tick(g, 100);
    }
    expect(g.world.objective.activated).toBe(true);
    expect(g.world.enemies.some((enemy) => enemy.alive)).toBe(true);
    const kills = g.world.kills;
    tick(g, 1200);
    expect(g.world.phase).toBe('sector-clear'); expect(g.world.objective.complete).toBe(true);
    expect(g.world.kills).toBe(kills);
    expect(g.world.hazards).toHaveLength(0); expect(g.world.pendingSpawns).toHaveLength(0);
    expect(g.world.upgradeChoices).toHaveLength(3);
  });

  it('keeps a horde wave alive during staggered reinforcements, freezes warnings on pause and clears them on retry', () => {
    const g = stage(4);
    expect(g.world.enemies.filter((enemy) => enemy.alive)).toHaveLength(4);
    expect(g.world.pendingSpawns).toHaveLength(4);
    g.pause(); const countdown = g.world.pendingSpawns[0]!.remaining; tick(g, 120);
    expect(g.world.pendingSpawns[0]!.remaining).toBe(countdown); g.resume();
    g.world.enemies.forEach((enemy) => { enemy.x = g.world.arenaMax + 6; }); tick(g, 100);
    expect(g.world.wave).toBe(1);
    tick(g, 120);
    expect(g.world.pendingSpawns).toHaveLength(0);
    expect(g.world.enemies.filter((enemy) => enemy.alive)).toHaveLength(4);
    g.restart(); expect(g.world.pendingSpawns).toHaveLength(0); expect(g.world.upgrades).toHaveLength(0);
  });
});
