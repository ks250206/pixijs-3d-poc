import { it, expect, describe } from 'vite-plus/test';
import { GameEngine } from '../src/game/engine';
import { createCandidates } from '../src/game/loadouts';
import { availableNodes, encounterRoster } from '../src/game/roguelite/map';
import { createShop, eliteModifiers, ELITE_MODIFIERS, RELICS, type EliteModifier } from '../src/game/roguelite/economy';
import { UPGRADE_DEFINITIONS } from '../src/game/upgrades';
import { clearEncounter } from './helpers/roguelite';
function node(kind: 'shop'|'rest'|'treasure'|'elite'|'battle', modifier?: EliteModifier) {
  let g = new GameEngine(1);
  for(let seed=1;seed<100;seed++) {
    g=new GameEngine(seed);g.start(createCandidates(seed)[0]!, 'roguelite');
    const n=g.run!.map[0]!;n.kind=kind;
    if (!modifier || eliteModifiers(g.run!,n).includes(modifier)) break;
  }
  g.selectNode(availableNodes(g.run!)[0]!); g.travelNode();return g;
}
describe('scrap transactions and reusable build',()=>{
  it('seeds shops, rejects insufficient/forged/ineffective/sold purchases without spending',()=>{
    const g=node('shop'), r=g.run!, stock=r.economy.shops[r.current!]!;
    expect(stock).toEqual(createShop(r,r.map[0]!));
    expect(g.buyStock('missing')).toBe(false);expect(g.buyStock(stock[0]!.id)).toBe(false);
    r.economy.scrap=1000;g.world.stocks=4;
    expect(g.buyStock('stock')).toBe(false);expect(g.buyStock('repair')).toBe(false);
    const before=r.economy.scrap;expect(g.buyStock(stock[0]!.id)).toBe(true);
    expect(r.economy.scrap).toBe(before-stock[0]!.price);expect(g.buyStock(stock[0]!.id)).toBe(false);
    expect(g.world.upgrades.length).toBe(1);
  });
  it('grants per-node rewards once, separate from score, with stronger elite and boss rewards',()=>{
    for(const kind of ['battle','elite'] as const) {
      const g=node(kind);clearEncounter(g);const amount=g.run!.economy.scrap;
      expect(amount).toBe(kind==='elite'?60:30);expect(g.run!.economy.rewards.length).toBe(1);
      for(let i=0;i<100;i++)g.update(1/60);
      expect(g.run!.economy.scrap).toBe(amount);g.completeNode();expect(g.completeNode()).toBe(false);
      g.restart();expect(g.run!.economy.scrap).toBe(0);
    }
  });
  it('caps every weapon and relic pool without softlocks or useless purchases',()=>{
    for(const loadout of createCandidates(32)) {
      const g=node('rest');g.world.loadout=loadout;g.world.upgrades=UPGRADE_DEFINITIONS.filter(u=>u.weapon==='all'||u.weapon===loadout.weapon).map(u=>({id:u.id,rank:u.maxRank}));
      expect(g.claimNodeBenefit('upgrade')).toBe(true);expect(g.run!.economy.scrap).toBe(20);expect(g.claimNodeBenefit('upgrade')).toBe(false);
    }
    const g=node('treasure');g.run!.economy.relics=RELICS.map(r=>r.id);
    expect(g.claimNodeBenefit('treasure')).toBe(true);expect(g.run!.economy.scrap).toBe(70);expect(g.claimNodeBenefit('treasure')).toBe(false);
  });
  it('repairs or upgrades once at rest',()=>{
    const g=node('rest');g.world.player.damage=80;
    expect(g.claimNodeBenefit('repair')).toBe(true);expect(g.world.player.damage).toBe(30);expect(g.claimNodeBenefit('upgrade')).toBe(false);
  });
});
describe('elite simulation modifiers',()=>{
  it.each(Object.keys(ELITE_MODIFIERS) as EliteModifier[])('%s preserves director/timings and changes simulation',modifier=>{
    const g=node('elite',modifier), r=g.run!, n=r.map[0]!;
    expect(eliteModifiers(r,n)).toContain(modifier);
    // Inspect internal simulation boundary deliberately, not a production bypass API.
    const lab=g as unknown as {enemyCombatProfile:(e:GameEngine['world']['player'])=>{speed:number};hit:(...a:unknown[])=>boolean;modifiers:EliteModifier[]};
    const e=g.world.enemies[0]!,p=g.world.player;
    if(modifier==='haste'||modifier==='berserk') {
      const base=lab.enemyCombatProfile(e).speed;e.damage=70;
      const active=lab.enemyCombatProfile(e).speed;lab.modifiers=[];
      expect(active/lab.enemyCombatProfile(e).speed).toBeCloseTo(1.25);if(modifier==='berserk')expect(active).toBeGreaterThan(base);lab.modifiers=[modifier];
    }
    if(modifier==='damage'||modifier==='berserk') {
      e.damage=70;p.invulnerable=0;lab.hit(p,e,10,0,0,0,1,'enemy');expect(p.damage).toBeCloseTo(12.5);
    }
    if(modifier==='armor'||modifier==='commander') expect(g.world.enemies.some(a=>a.guard>=56||a.mount>=42||a.armor>=98)).toBe(true);
    if(modifier==='swarm') expect(g.world.enemies.length+g.world.pendingSpawns.length).toBeGreaterThan(encounterRoster(r,n).length);
    if(modifier==='commander')expect(g.world.enemies.some(a=>a.kind==='captain')).toBe(true);
    expect(g.world.enemies.filter(a=>a.alive).length).toBeLessThanOrEqual(14);
    g.restart();expect(lab.modifiers).toEqual([]);
  });
});
