import { expect, test, type Page } from '@playwright/test';
import type { WorldState } from '../../src/game/types';
import type { GameEngine } from '../../src/game/engine';

// A visible canvas can still contain only the 2D labels if the 3D render pass fails.
// Sample the actual drawing buffer so that this cannot silently pass the smoke test.
async function expectRenderedArena(page: Page) {
  const litFraction = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
    requestAnimationFrame(() => {
      try {
        const app = (window as unknown as { __UPRISING__: { scene: { app: { render: () => void } } } }).__UPRISING__.scene.app;
        app.render();
        const source = document.querySelector<HTMLCanvasElement>('#scene canvas')!;
        const sample = document.createElement('canvas');
        sample.width = 160;
        sample.height = 100;
        const context = sample.getContext('2d')!;
        context.drawImage(source, 0, 0, 160, 100);
        const pixels = context.getImageData(0, 0, 160, 100).data;
        let lit = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 90) lit++;
        }
        resolve(lit / (160 * 100));
      } catch (error) { reject(error); }
    });
  }));
  expect(litFraction, 'The 3D arena must occupy a visible part of the canvas').toBeGreaterThan(0.08);
}

async function snapshot(page: Page): Promise<WorldState> {
  return page.evaluate(() => (window as unknown as { __UPRISING__: { snapshot: () => WorldState } }).__UPRISING__.snapshot());
}

async function boot(page: Page) {
  await page.goto('./?seed=73&debug=1');
  await expect(page.locator('#boot')).toHaveCount(0);
  await expect(page.locator('#scene canvas')).toBeVisible();
  await expect(page.locator('[data-candidate]')).toHaveCount(6);
}

async function training(page: Page) {
  await boot(page);
  await page.locator('[data-mode=training]').click();
  await page.locator('[data-action=start]').click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  await expect(page.locator('.game-ui')).not.toHaveClass(/is-ready/);
}

test('boots real 3D, selects randomized chassis, and shows a working combat guide', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  await expect(page).toHaveTitle(/NULL.*UPRISING/);
  const first = await page.locator('[data-candidate="0"]').innerText();
  await page.locator('[data-action=reroll]').click();
  await expect(page.locator('[data-candidate="0"]')).not.toHaveText(first);
  await page.locator('[data-candidate="1"]').click();
  await expect(page.locator('[data-candidate="1"]')).toHaveAttribute('aria-pressed', 'true');
  await expectRenderedArena(page);
  await page.screenshot({ path: 'test-results/screenshots/01-title.png' });
  await page.locator('.top-actions [data-action=help]').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByText('WAVEDASH / 絶', { exact: true })).toBeVisible();
  await expect(page.getByText('05 / ENEMY TACTICS', { exact: true })).toBeVisible();
  await expect(page.getByText('06 / ARENA SYSTEMS', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await snapshot(page)).phase).toBe('ready');
  expect(errors).toEqual([]);
});

test('renders specialist enemies and interactive equipment across sector transitions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await training(page);
  await expect(page.locator('[data-hud=arenaHint]')).toContainText('危険床は停止');
  // Controlled fixture: verify new models, arena rebuild and resource cleanup;
  // ordinary-input campaign completion is covered by the simulation test.
  await page.evaluate(() => {
    const engine = (window as unknown as { __UPRISING__: { engine: { world: WorldState; nextSector: () => void } } }).__UPRISING__.engine;
    engine.world.phase = 'sector-clear';
    engine.nextSector();
    engine.world.enemies[0]!.kind = 'sentinel';
    engine.world.enemies[0]!.guard = 40;
    engine.world.enemies[1]!.kind = 'charger';
  });
  await expect.poll(async () => (await snapshot(page)).sector).toBe(1);
  await expectRenderedArena(page);
  const props = (await snapshot(page)).props;
  expect(props.filter((prop) => prop.kind === 'conveyor')).toHaveLength(2);
  await page.screenshot({ path: 'test-results/screenshots/05-transit-specialists.png' });
  await page.evaluate(() => {
    const engine = (window as unknown as { __UPRISING__: { engine: { world: WorldState; restart: () => void } } }).__UPRISING__.engine;
    engine.restart();
  });
  await expect.poll(async () => (await snapshot(page)).sector).toBe(0);
  await expectRenderedArena(page);
  expect(errors).toEqual([]);
});

test('compatibility mode renders the arena without floating-point environment lighting', async ({ page }) => {
  await page.goto('./?seed=73&debug=1&quality=compat');
  await expect(page.locator('#boot')).toHaveCount(0);
  await expect(page.locator('[data-candidate]')).toHaveCount(6);
  await expectRenderedArena(page);
});

test('world map pauses combat, shows seven stages, and resumes with Escape', async ({ page }) => {
  await boot(page);
  await page.locator('[data-action=start]').click();
  await page.locator('.top-actions [data-action=map]').click();
  await expect(page.getByRole('dialog', { name: 'REBELLION ROUTE' })).toBeVisible();
  await expect(page.locator('.route-node')).toHaveCount(7);
  expect((await snapshot(page)).phase).toBe('paused');
  const time = (await snapshot(page)).time;
  await page.waitForTimeout(120);
  expect((await snapshot(page)).time).toBe(time);
  await page.screenshot({ path: 'test-results/screenshots/06-world-map.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
});

test('graphics controls apply while paused and persist across reloads', async ({ page }) => {
  await page.goto('./?seed=73&debug=1&play=training');
  await expect(page.locator('#boot')).toHaveCount(0);
  await page.locator('.top-actions [data-action=graphics]').click();
  await expect(page.getByRole('dialog', { name: 'GRAPHICS' })).toBeVisible();
  expect((await snapshot(page)).phase).toBe('paused');
  const time = (await snapshot(page)).time;
  await page.locator('[data-preset=low]').click();
  await page.locator('[data-graphics=resolution]').selectOption('50');
  const diagnostics = () => page.evaluate(() => (window as unknown as { __UPRISING__: { scene: { getDiagnostics: () => Record<string, unknown> } } }).__UPRISING__.scene.getDiagnostics());
  await expect.poll(async () => (await diagnostics()).viewResolution).toBe(0.5);
  await expect.poll(async () => (await diagnostics()).shadowsEnabled).toBe(false);
  expect((await diagnostics()).environmentEnabled).toBe(false);
  expect((await snapshot(page)).time).toBe(time);
  await expectRenderedArena(page);
  await page.screenshot({ path: 'test-results/screenshots/08-graphics.png' });
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  await page.reload();
  await expect(page.locator('#boot')).toHaveCount(0);
  expect((await diagnostics()).viewResolution).toBe(0.5);
  await page.locator('.top-actions [data-action=graphics]').click();
  await page.locator('[data-preset=high]').click();
  await expect.poll(async () => (await diagnostics()).viewResolution).toBe(1);
  expect((await diagnostics()).shadowsEnabled).toBe(true);
  expect((await diagnostics()).environmentEnabled).toBe(true);
  await page.locator('[data-graphics=effects]').selectOption('reduced');
  await page.locator('[data-graphics=shake]').uncheck();
  await expectRenderedArena(page);
  await page.getByRole('button', { name: 'グラフィック設定を閉じる' }).click();
  await page.locator('[data-action=pause]').click();
  await page.locator('.pause-dialog [data-action=graphics]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.pause-dialog')).toBeVisible();
  expect((await snapshot(page)).phase).toBe('paused');
});

test('cleared-stage supplies apply once and route departure enters the next stage', async ({ page }) => {
  await boot(page);
  await page.locator('[data-action=start]').click();
  await page.evaluate(() => {
    const engine = (window as unknown as { __UPRISING__: { engine: { world: WorldState; update: (dt: number) => void } } }).__UPRISING__.engine;
    for (let wave = 0; wave < 3; wave++) {
      engine.world.enemies.forEach((enemy) => { enemy.x = engine.world.arenaMax + 6; });
      for (let i = 0; i < 100; i++) engine.update(1 / 60);
    }
  });
  await expect.poll(async () => (await snapshot(page)).phase).toBe('sector-clear');
  const power = (await snapshot(page)).loadout.power;
  await page.locator('[data-hud=sectorClear] [data-action=map]').click();
  await page.locator('[data-supply=power]').click();
  await expect(page.locator('[data-supply=stock]')).toBeDisabled();
  expect((await snapshot(page)).loadout.power).toBeCloseTo(power + 0.08);
  await page.locator('[data-action=travel]').click();
  await expect.poll(async () => (await snapshot(page)).sector).toBe(1);
  await expect(page.getByRole('dialog')).toBeHidden();
  expect((await snapshot(page)).phase).toBe('playing');
});

test('renders the expanded roster and distinct stage scenery', async ({ page }) => {
  // Bound software rasterization work across the extended route and roster.
  if (process.env.CI) {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1120, height: 700 });
  }
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await training(page);
  for (const sector of [1, 2, 3, 4, 5, 6]) {
    await page.evaluate(() => {
      const engine = (window as unknown as { __UPRISING__: { engine: { world: WorldState; nextSector: () => void } } }).__UPRISING__.engine;
      engine.world.mode = 'campaign'; engine.world.phase = 'sector-clear'; engine.nextSector();
      engine.world.mode = 'training';
      engine.world.enemies.forEach((enemy) => { enemy.invulnerable = 0; });
      engine.world.player.invulnerable = 0;
    });
    await expect.poll(async () => (await snapshot(page)).sector).toBe(sector);
    await expectRenderedArena(page);
    await page.screenshot({ path: `test-results/screenshots/stage-${sector + 1}.png` });
  }
  for (let wave = 2; wave <= 5; wave++) {
    await page.evaluate(() => {
      const engine = (window as unknown as { __UPRISING__: { engine: { world: WorldState; update: (dt: number) => void } } }).__UPRISING__.engine;
      engine.world.enemies.forEach((enemy) => { enemy.x = engine.world.arenaMax + 6; });
      for (let i = 0; i < 100; i++) engine.update(1 / 60);
      engine.world.enemies.forEach((enemy) => { enemy.invulnerable = 0; });
    });
    await expect.poll(async () => (await snapshot(page)).wave).toBe(wave);
    await expectRenderedArena(page);
    if (wave > 2) await page.screenshot({ path: `test-results/screenshots/roster-${wave}.png` });
  }
  expect(errors).toEqual([]);
});

test('selects and plays each new fighting style with its own attack', async ({ page }) => {
  // Three complete flows need a smaller desktop viewport on CI's software GPU.
  if (process.env.CI) {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: 1120, height: 700 });
  }
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await boot(page);
  for (const [weapon, move] of [['lance', 'LANCE'], ['cannon', 'CANNON SHOT'], ['scythe', 'ORBIT']]) {
    await page.locator(`[data-weapon=${weapon}]`).click();
    await expect(page.locator(`[data-weapon=${weapon}]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-hud=selectedDescription]')).not.toBeEmpty();
    await page.locator('[data-mode=training]').click();
    await page.locator('[data-action=start]').click();
    await expect.poll(async () => (await snapshot(page)).loadout.weapon).toBe(weapon);
    await expect.poll(async () => (await snapshot(page)).player.invulnerable).toBe(0);
    await page.keyboard.press('j');
    await expect.poll(async () => (await snapshot(page)).lastMove).toContain(move);
    await expectRenderedArena(page);
    await page.screenshot({ path: `test-results/screenshots/player-${weapon}.png` });
    await expect.poll(async () => (await snapshot(page)).player.state).toBe('idle');
    await page.screenshot({ path: `test-results/screenshots/player-${weapon}-ready.png` });
    await page.keyboard.press('Escape');
    await page.locator('[data-action=new-run]').click();
    await expect(page.locator('[data-candidate]')).toHaveCount(6);
  }
  expect(errors).toEqual([]);
});

test('renders boss floor warnings even with reduced graphics', async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 700 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await training(page);
  // Rendering fixture: reach the real final boss and freeze its first warning.
  await page.evaluate(() => {
    const engine = (window as unknown as { __UPRISING__: { engine: GameEngine } }).__UPRISING__.engine;
    engine.world.mode = 'campaign';
    for (let sector = 0; sector < 6; sector++) { engine.world.phase = 'sector-clear'; engine.nextSector(); }
    engine.world.player.invulnerable = 100;
    for (let wave = 0; wave < 3; wave++) {
      engine.world.enemies.forEach(e => { e.x = engine.world.arenaMax + 6; });
      for (let i = 0; i < 100; i++) engine.update(1 / 60);
    }
    engine.world.player.x = (engine.world.arenaMin + engine.world.arenaMax) / 2 - 2;
    for (let i = 0; i < 240 && !engine.world.hazards.length; i++) engine.update(1 / 60);
    // Freeze combat without the pause dialog obscuring the floor markers.
    engine.world.hitstop = 100;
    engine.world.player.invulnerable = 0;
    engine.world.messageTime = 0;
  });
  expect((await snapshot(page)).hazards.length).toBeGreaterThan(0);
  await expect(page.locator('[data-hud=boss]')).toBeVisible();
  await expectRenderedArena(page);
  await page.screenshot({ path: 'test-results/screenshots/boss-warning.png' });
  await page.locator('.top-actions [data-action=graphics]').click();
  await page.locator('[data-preset=low]').click();
  await page.getByRole('button', { name: '設定を閉じる →' }).click();
  expect((await snapshot(page)).hazards.length).toBeGreaterThan(0);
  await expectRenderedArena(page);
  await page.screenshot({ path: 'test-results/screenshots/boss-warning-low.png' });
  expect(errors).toEqual([]);
});

test('shows a clear requirement when the browser has no GPU rendering backend', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      if (['webgl', 'webgl2', 'experimental-webgl'].includes(type)) return null;
      return Reflect.apply(original, this, [type, options]);
    } as typeof original;
    Object.defineProperty(navigator, 'gpu', { value: undefined, configurable: true });
  });
  await page.goto('./?seed=73');
  await expect(page.locator('#boot')).toHaveClass(/boot-error/);
  await expect(page.locator('#boot-detail')).toContainText('Canvas 2D');
  await expect(page.locator('#boot-detail')).toContainText('WebGL 2');
  await expect(page.locator('[data-action=start]')).toHaveCount(0);
});

test('keyboard movement, jumping, charging, pausing and recovery work in the rendered game', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await training(page);
  const start = await snapshot(page);
  await page.keyboard.down('d');
  await expect.poll(async () => (await snapshot(page)).player.x).toBeGreaterThan(start.player.x + 1.2);
  await page.keyboard.up('d');
  await page.keyboard.down('Space');
  await expect.poll(async () => (await snapshot(page)).player.y, { intervals: [30, 50, 80] }).toBeGreaterThan(0.15);
  await page.keyboard.up('Space');
  await expect.poll(async () => (await snapshot(page)).player.y).toBe(0);
  // Same-frame direction + J used to accidentally enter a smash charge.
  await page.evaluate(() => {
    for (const code of ['KeyW', 'KeyJ']) window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
  });
  await expect.poll(async () => (await snapshot(page)).lastMove).toBe('UP TILT');
  await page.evaluate(() => {
    for (const code of ['KeyW', 'KeyJ']) window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
  });
  await expect.poll(async () => (await snapshot(page)).player.state).toBe('idle');
  await page.keyboard.down('k');
  await expect.poll(async () => (await snapshot(page)).player.state).toBe('charge');
  await expect.poll(async () => (await snapshot(page)).player.attack?.charge ?? 0).toBeGreaterThan(0.3);
  await page.keyboard.up('k');
  await expect.poll(async () => (await snapshot(page)).lastMove).toBe('FORWARD SMASH');
  await expect.poll(async () => (await snapshot(page)).player.state).toBe('attack');
  await expect.poll(async () => (await snapshot(page)).player.state).toBe('idle');
  await page.keyboard.press('l');
  await expect.poll(async () => (await snapshot(page)).specialCooldown).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snapshot(page)).phase).toBe('paused');
  const pausedTime = (await snapshot(page)).time;
  await page.waitForTimeout(180);
  expect((await snapshot(page)).time).toBe(pausedTime);
  await page.locator('[data-action=resume]').click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  await page.locator('.top-actions [data-action=help]').click();
  expect((await snapshot(page)).phase).toBe('paused');
  await page.getByRole('button', { name: '操作ガイドを閉じる' }).click();
  await expect.poll(async () => (await snapshot(page)).phase).toBe('playing');
  await page.screenshot({ path: 'test-results/screenshots/02-gameplay.png' });
  expect(errors).toEqual([]);
});

test('touch controls work in landscape and menu fits portrait', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL, viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await training(page);
  await expect(page.locator('[data-touch=jump]')).toBeVisible();
  await page.locator('[data-touch=jump]').tap();
  await expect.poll(async () => (await snapshot(page)).lastMove).toBe('JUMP');
  await page.screenshot({ path: 'test-results/screenshots/03-mobile-landscape.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.top-actions [data-action=map]').click();
  await expect(page.getByRole('dialog', { name: 'REBELLION ROUTE' })).toBeVisible();
  expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  await page.screenshot({ path: 'test-results/screenshots/07-mobile-map.png' });
  await page.getByRole('button', { name: 'ワールドマップを閉じる' }).click();
  await page.locator('.top-actions [data-action=graphics]').click();
  await expect(page.getByRole('dialog', { name: 'GRAPHICS' })).toBeVisible();
  expect(await page.getByRole('dialog').evaluate((element) => element.scrollWidth <= element.clientWidth + 2)).toBe(true);
  await page.screenshot({ path: 'test-results/screenshots/09-mobile-graphics.png' });
  await page.getByRole('button', { name: 'グラフィック設定を閉じる' }).click();
  await page.locator('[data-action=pause]').click();
  await page.locator('[data-action=new-run]').click();
  await expect(page.locator('[data-action=start]')).toBeVisible();
  const horizontalOverflow = await page.evaluate(() => document.body.scrollWidth > window.innerWidth + 2);
  expect(horizontalOverflow).toBe(false);
  await page.screenshot({ path: 'test-results/screenshots/04-mobile-portrait.png' });
  expect(errors).toEqual([]);
  await context.close();
});
