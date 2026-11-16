import { test, expect } from '@playwright/test';
import type { GameEngine } from '../../src/game/engine';
import type { GameScene } from '../../src/render/scene';
declare global { interface Window { __UPRISING__: { engine: GameEngine; scene: GameScene } } }
async function boot(page: import('@playwright/test').Page) {
  await page.goto('?seed=91&renderer=webgl&debug=1');
  await page.locator('[data-mode=roguelite]').click(); await page.locator('[data-action=start]').click();
  await expect(page.locator('.rogue-panel')).toBeVisible();
}
test('route selection is confirmed separately and core theme resets across encounters', async ({ page }) => {
  await boot(page);
  await page.locator('[data-node="1-0-0"]').click();
  await expect(page.locator('[data-rogue=travel]')).toBeEnabled();
  await page.locator('[data-rogue=travel]').click();
  await expect(page.locator('.rogue-panel')).toBeHidden();
  const result = await page.evaluate(() => {
    const {engine:g, scene}=window.__UPRISING__;
    const counts=[];
    for (let step=0;step<2;step++) {
      if (step===0) { for (const e of g.world.enemies) e.alive=false; g.world.pendingSpawns=[]; for(let i=0;i<100;i++)g.update(1/60); g.skipUpgrade(); g.completeNode(); }
      const r=g.run!, id=r.map.find(n=>n.id===r.current)!.next[0]!;
      const n=r.map.find(n=>n.id===id)!; n.theme=6; n.kind='battle';
      g.selectNode(id); g.travelNode(); scene.update(g.world,0);
      const props=g.world.props.map(p=>p.id);
      counts.push({props,count:(scene.getDiagnostics() as {actorViewCount:number}).actorViewCount});
      for (const e of g.world.enemies) e.alive=false; g.world.pendingSpawns=[]; for(let i=0;i<100;i++)g.update(1/60); g.skipUpgrade(); g.completeNode();
    }
    return counts;
  });
  expect(result[0]!.props).not.toEqual(result[1]!.props);
  expect(result.every(r=>r.count>1)).toBe(true);
});
test('390px map stays within viewport and supports keyboard selection and confirmation', async ({ page }) => {
  await page.setViewportSize({width:390,height:844}); await boot(page);
  await page.locator('[data-node="1-0-0"]').focus(); await page.keyboard.press('Enter');
  await page.locator('[data-rogue=travel]').focus();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Enter'); await expect(page.locator('.rogue-panel')).toBeHidden();
  expect(await page.evaluate(()=>window.__UPRISING__.engine.world.player.attack)).toBeNull();
});
test('shop purchase and treasure are once-only through the run UI', async ({page})=>{
  await boot(page);
  await page.evaluate(()=>{
    const g=window.__UPRISING__.engine,r=g.run!;r.map[0]!.kind='shop';r.economy.scrap=200;
    g.selectNode('1-0-0');g.travelNode();
  });
  const buy=page.locator('[data-buy]').first();await expect(buy).toBeEnabled();await buy.click();await expect(buy).toBeDisabled();
  expect(await page.evaluate(()=>window.__UPRISING__.engine.world.upgrades.length)).toBe(1);
  await page.locator('[data-rogue=complete]').click();
  await page.evaluate(()=>{const g=window.__UPRISING__.engine,r=g.run!,id=r.map[0]!.next[0]!;r.map.find(n=>n.id===id)!.kind='treasure';g.selectNode(id);g.travelNode();});
  await page.locator('[data-benefit=treasure]').click();await expect(page.locator('[data-benefit=treasure]')).toBeDisabled();
  expect(await page.evaluate(()=>window.__UPRISING__.engine.run!.economy.relics.length)).toBe(1);
});
test('event shows validated choices and a stable selected result',async({page})=>{
 await boot(page);await page.evaluate(()=>{const g=window.__UPRISING__.engine,r=g.run!;r.map[0]!.kind='unknown';r.events.resolved['1-0-0']={kind:'event',eventId:'foundry-union'};g.selectNode('1-0-0');g.travelNode();});
 await expect(page.locator('[data-event=fund]')).toBeDisabled();await page.locator('[data-event=salvage]').click();
 await expect(page.locator('.rogue-detail [role=status]')).toContainText('SCRAP 0 → 30');await expect(page.locator('[data-event]')).toHaveCount(0);
 await page.locator('[data-rogue=complete]').click();await expect(page.locator('[data-rogue=travel]')).toBeVisible();
});
