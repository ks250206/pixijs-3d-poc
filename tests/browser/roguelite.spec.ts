import { test, expect } from "@playwright/test";
import type { GameEngine } from "../../src/game/engine";
import type { GameScene } from "../../src/render/scene";
declare global {
  interface Window {
    __UPRISING__: { engine: GameEngine; scene: GameScene };
  }
}
async function boot(page: import("@playwright/test").Page) {
  await page.goto("?seed=91&renderer=webgl&debug=1");
  await page.locator("[data-mode=roguelite]").click();
  await page.locator("[data-action=start]").click();
  await expect(page.locator(".rogue-panel")).toBeVisible();
}
test("route selection is confirmed separately and core theme resets across encounters", async ({
  page,
}) => {
  await boot(page);
  await page.locator('[data-node="1-0-0"]').click();
  await expect(page.locator("[data-rogue=travel]")).toBeEnabled();
  await page.locator("[data-rogue=travel]").click();
  await expect(page.locator(".rogue-panel")).toBeHidden();
  const result = await page.evaluate(() => {
    const { engine: g, scene } = window.__UPRISING__;
    const counts = [];
    for (let step = 0; step < 2; step++) {
      if (step === 0) {
        for (const e of g.world.enemies) e.alive = false;
        g.world.pendingSpawns = [];
        for (let i = 0; i < 100; i++) g.update(1 / 60);
        g.skipUpgrade();
        g.completeNode();
      }
      const r = g.run!,
        id = r.map.find((n) => n.id === r.current)!.next[0]!;
      const n = r.map.find((n) => n.id === id)!;
      n.theme = 6;
      n.kind = "battle";
      g.selectNode(id);
      g.travelNode();
      scene.update(g.world, 0);
      const props = g.world.props.map((p) => p.id);
      counts.push({
        props,
        count: (scene.getDiagnostics() as { actorViewCount: number }).actorViewCount,
      });
      for (const e of g.world.enemies) e.alive = false;
      g.world.pendingSpawns = [];
      for (let i = 0; i < 100; i++) g.update(1 / 60);
      g.skipUpgrade();
      g.completeNode();
    }
    return counts;
  });
  expect(result[0]!.props).not.toEqual(result[1]!.props);
  expect(result.every((r) => r.count > 1)).toBe(true);
});
test("390px map stays within viewport and supports keyboard selection and confirmation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.locator('[data-node="1-0-0"]').focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-rogue=travel]").focus();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.locator(".rogue-panel")).toBeHidden();
  expect(await page.evaluate(() => window.__UPRISING__.engine.world.player.attack)).toBeNull();
});
test("shop purchase and treasure are once-only through the run UI", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.__UPRISING__.engine,
      r = g.run!;
    r.map[0]!.kind = "shop";
    r.economy.scrap = 200;
    g.selectNode("1-0-0");
    g.travelNode();
  });
  const buy = page.locator("[data-buy]").first();
  await expect(buy).toBeEnabled();
  await buy.click();
  await expect(buy).toBeDisabled();
  expect(await page.evaluate(() => window.__UPRISING__.engine.world.upgrades.length)).toBe(1);
  await page.locator("[data-rogue=complete]").click();
  await page.evaluate(() => {
    const g = window.__UPRISING__.engine,
      r = g.run!,
      id = r.map[0]!.next[0]!;
    r.map.find((n) => n.id === id)!.kind = "treasure";
    g.selectNode(id);
    g.travelNode();
  });
  await page.locator("[data-benefit=treasure]").click();
  await expect(page.locator("[data-benefit=treasure]")).toBeDisabled();
  expect(await page.evaluate(() => window.__UPRISING__.engine.run!.economy.relics.length)).toBe(1);
});
test("event shows validated choices and a stable selected result", async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.__UPRISING__.engine,
      r = g.run!;
    r.map[0]!.kind = "unknown";
    r.events.resolved["1-0-0"] = { kind: "event", eventId: "foundry-union" };
    g.selectNode("1-0-0");
    g.travelNode();
  });
  await expect(page.locator("[data-event=fund]")).toBeDisabled();
  await page.locator("[data-event=salvage]").click();
  await expect(page.locator(".rogue-detail [role=status]")).toContainText("SCRAP 0 → 30");
  await expect(page.locator("[data-event]")).toHaveCount(0);
  await page.locator("[data-rogue=complete]").click();
  await expect(page.locator("[data-rogue=travel]")).toBeVisible();
});
async function continueRun(page: import("@playwright/test").Page) {
  await page.reload();
  await expect(page.locator("[data-save-continue]")).toBeEnabled();
  await page.locator("[data-save-continue]").click();
}
for (const width of [1200, 390])
  test(`route/shop/event screenshots and transactional refresh at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await boot(page);
    await page.screenshot({ path: `test-results/screenshots/rogue-route-${width}.png` });
    await page.locator('[data-node="1-0-0"]').click();
    await continueRun(page);
    await expect(page.locator("[data-rogue=travel]")).toBeEnabled();
    await page.evaluate(() => {
      const g = window.__UPRISING__.engine,
        r = g.run!;
      r.map[0]!.kind = "shop";
      r.economy.scrap = 200;
      g.travelNode();
    });
    await expect(page.locator("[data-buy]")).not.toHaveCount(0);
    await page.locator("[data-buy]").first().click();
    await page.locator(".rogue-panel").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.screenshot({ path: `test-results/screenshots/rogue-shop-${width}.png` });
    const scrap = await page.evaluate(() => window.__UPRISING__.engine.run!.economy.scrap);
    await continueRun(page);
    await expect(page.locator("[data-buy]").first()).toBeDisabled();
    expect(await page.evaluate(() => window.__UPRISING__.engine.run!.economy.scrap)).toBe(scrap);
    await page.locator("[data-rogue=complete]").click();
    await page.evaluate(() => {
      const g = window.__UPRISING__.engine,
        r = g.run!,
        id = r.map[0]!.next[0]!;
      r.map.find((n) => n.id === id)!.kind = "unknown";
      r.events.resolved[id] = { kind: "event", eventId: "foundry-union" };
      g.selectNode(id);
      g.travelNode();
    });
    await page.locator(".rogue-panel").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.screenshot({ path: `test-results/screenshots/rogue-event-${width}.png` });
    await page.locator("[data-event=salvage]").click();
    await continueRun(page);
    await expect(page.locator("[data-event]")).toHaveCount(0);
    await expect(page.locator(".rogue-detail [role=status]")).toContainText("Take exposed copper");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
test("M and toolbar share roguelite route, Escape resumes, restart resets inspection and new run seed reproduces", async ({
  page,
}) => {
  await boot(page);
  await page.locator('[data-node="1-0-0"]').click();
  await page.locator("[data-rogue=travel]").click();
  await page.keyboard.press("m");
  await expect(page.locator(".rogue-panel")).toBeVisible();
  await expect(page.locator(".modal-backdrop")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.locator(".rogue-panel")).toBeHidden();
  await page.locator(".map-button").click();
  await expect(page.locator(".rogue-panel")).toBeVisible();
  await page.evaluate(() => window.__UPRISING__.engine.restart());
  await page.locator('[data-node="1-0-0"]').click();
  await page.locator("[data-rogue=travel]").click();
  await expect(page.locator(".rogue-panel")).toBeHidden();
  await page.keyboard.press("m");
  await page.locator("[data-rogue=abandon]").click();
  await page.locator("[data-mode=roguelite]").click();
  await page.locator("[data-action=start]").click();
  const snapshot = await page.evaluate(() => ({
    seed: window.__UPRISING__.engine.run!.seed,
    map: window.__UPRISING__.engine.run!.map,
  }));
  expect(snapshot.seed).not.toBe(91);
  await page.goto(`?seed=${snapshot.seed}&renderer=webgl&debug=1`);
  await page.locator("[data-mode=roguelite]").click();
  await page.locator("[data-action=start]").click();
  expect(await page.evaluate(() => window.__UPRISING__.engine.run!.map)).toEqual(snapshot.map);
});
test("combat and reward reload use checkpoint boundaries including rescue combat", async ({
  page,
}) => {
  await boot(page);
  await page.evaluate(() => {
    const g = window.__UPRISING__.engine,
      r = g.run!;
    r.map[0]!.kind = "unknown";
    r.events.resolved["1-0-0"] = { kind: "event", eventId: "rescue-beacon" };
    g.selectNode("1-0-0");
    g.travelNode();
  });
  await page.locator("[data-event=fight]").click();
  await expect(page.locator(".rogue-panel")).toBeHidden();
  await page.evaluate(() => {
    window.__UPRISING__.engine.world.player.damage = 170;
  });
  await continueRun(page);
  expect(await page.evaluate(() => window.__UPRISING__.engine.world.player.damage)).toBe(10);
  expect(
    await page.evaluate(() => window.__UPRISING__.engine.run!.events.resolved["1-0-0"]!.choice),
  ).toBe("fight");
  await page.evaluate(() => {
    const g = window.__UPRISING__.engine;
    g.world.player.invulnerable = 100;
    for (let i = 0; i < 900 && g.run!.phase === "combat"; i++) {
      g.world.enemies.forEach((e) => {
        e.x = g.world.arenaMax + 8;
      });
      g.update(1 / 60);
    }
  });
  await expect(page.locator("[data-upgrade]")).not.toHaveCount(0);
  await page.locator("[data-upgrade]").first().click();
  const money = await page.evaluate(() => window.__UPRISING__.engine.run!.economy.scrap);
  await continueRun(page);
  await expect(page.locator("[data-upgrade]")).toHaveCount(0);
  expect(await page.evaluate(() => window.__UPRISING__.engine.run!.economy.scrap)).toBe(money);
  await page.locator("[data-rogue=complete]").click();
});
test("corrupt/denied storage is explicit and failed load retains bytes", async ({ page }) => {
  await page.goto("?seed=91&renderer=webgl&debug=1");
  await page.evaluate(() => localStorage.setItem("null-uprising-run", "broken"));
  await page.reload();
  await expect(page.locator("[data-save-info]")).toContainText("Invalid saved run");
  await expect(page.locator("[data-save-continue]")).toBeDisabled();
  expect(await page.evaluate(() => localStorage.getItem("null-uprising-run"))).toBe("broken");
  await page.locator("[data-save-discard]").click();
  await expect(page.locator("[data-save-info]")).toContainText("discarded");
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw Error("denied");
      },
    });
  });
  await page.reload();
  await expect(page.locator("[data-save-info]")).toContainText("denied");
  await page.locator("[data-mode=roguelite]").click();
  await page.locator("[data-action=start]").click();
  await expect(page.locator(".rogue-warning")).toContainText("SAVE FAILED");
});
test("route blocks simulated gamepad START and attack input across render ticks", async ({
  page,
}) => {
  await boot(page);
  await page.locator('[data-node="1-0-0"]').click();
  await page.locator("[data-rogue=travel]").click();
  await page.keyboard.press("m");
  const result = await page.evaluate(async () => {
    const g = window.__UPRISING__.engine;
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        {
          connected: true,
          index: 0,
          mapping: "standard",
          axes: [1, 0, 0, 0],
          buttons: Array.from({ length: 17 }, (_, i) => ({
            pressed: i === 9 || i === 2,
            value: i === 9 || i === 2 ? 1 : 0,
            touched: false,
          })),
        },
      ],
    });
    const before = g.world.time;
    for (let i = 0; i < 5; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    return { before, after: g.world.time, phase: g.world.phase, attack: g.world.player.attack };
  });
  expect(result.phase).toBe("paused");
  expect(result.after).toBe(result.before);
  expect(result.attack).toBeNull();
  await page.evaluate(() => {
    Object.defineProperty(navigator, "getGamepads", { value: () => [] });
  });
  await page.keyboard.press("Escape");
  await expect(page.locator(".rogue-panel")).toBeHidden();
});
