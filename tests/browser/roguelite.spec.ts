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
  await expect(page.locator("[data-hud=wave]")).toHaveText("ENCOUNTER 1 / 1");
  await expect(page.locator("[data-hud=objective]")).toContainText("敵と増援を全滅");
  await expect(page.locator("[data-hud=objective]")).not.toContainText("リレー");
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
    // Three reloads and three full-page captures at desktop size: under CI's software WebGL this
    // sits right at the default per-test limit (2.0–2.1 min), so it gets the slow-test allowance.
    test.slow(width === 1200);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await boot(page);
    if (width === 1200) {
      await expect(page.locator('[data-node="1-7-0"]')).toBeInViewport({ ratio: 1 });
      await expect(page.locator('[data-node="1-0-0"]')).toBeInViewport({ ratio: 1 });
    }
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
    await expect(page.locator("[data-event=leave]")).toBeAttached();
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

test("map selection keeps keyboard focus and exposes the selected destination", async ({
  page,
}) => {
  await boot(page);
  const first = page.locator('[data-node="1-0-0"]');
  await first.focus();
  await page.keyboard.press("Enter");
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".rogue-destination")).toContainText("THE FOUNDRY");
  await expect(page.locator(".rogue-destination")).toContainText("SCRAP・武器強化");
  await expect(page.locator(".game-ui")).toHaveAttribute("inert", "");
  // Future nodes carry readable labels, but cannot be activated.
  await expect(page.locator('[data-node="1-1-0"]')).toBeDisabled();
  await expect(page.locator('[data-node="1-1-0"]')).toHaveAccessibleName(/2階.*未到達/);
  await page.locator("[data-rogue=travel]").click();
  await expect(page.locator(".game-ui")).not.toHaveAttribute("inert", "");
  await page.keyboard.press("m");
  await expect(first).toHaveAttribute("aria-current", "step");
  await page.keyboard.press("Escape");
  await expect(page.locator(".rogue-panel")).toBeHidden();
});

for (const width of [390, 320])
  test(`mobile destination and departure stay usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await boot(page);
    const first = page.locator('[data-node="1-0-0"]');
    await expect(first).toBeInViewport();
    const box = await first.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await first.click();
    await expect(first).toBeFocused();
    await expect(page.locator(".rogue-destination h3")).toBeInViewport();
    await expect(page.locator("[data-rogue=travel]")).toBeInViewport({ ratio: 1 });
    expect(
      await page.locator(".rogue-panel").evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.locator(".rogue-layout").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(page.locator("[data-rogue=travel]")).toBeInViewport({ ratio: 1 });
    await page.locator("[data-rogue=travel]").click();
    await expect(page.locator(".rogue-panel")).toBeHidden();
  });

test("completed route and available branches are distinct and choosing a branch retains scroll", async ({
  page,
}) => {
  await boot(page);
  // Use the existing deterministic completion fixture, without waiting for real combat.
  await page.evaluate(() => {
    const g = window.__UPRISING__.engine;
    g.selectNode("1-0-0");
    g.travelNode();
    g.world.enemies.forEach((e) => {
      e.alive = false;
    });
    g.world.pendingSpawns = [];
    for (let i = 0; i < 100; i++) g.update(1 / 60);
    g.skipUpgrade();
    g.completeNode();
  });
  const choices = page.locator(".rogue-map-node.available");
  await expect(choices).toHaveCount(3);
  await expect(page.locator('[data-node="1-0-0"]')).toHaveClass(/visited/);
  await expect(page.locator(".rogue-edge.available")).toHaveCount(3);
  await choices.nth(1).focus();
  await page.keyboard.press("Enter");
  await expect(choices.nth(1)).toBeFocused();
  await expect(page.locator(".rogue-edge.selected")).toHaveCount(1);
  const before = await page.locator(".rogue-map-scroll").evaluate((el) => el.scrollTop);
  await page.keyboard.press("ArrowRight");
  await expect(choices.nth(2)).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(choices.nth(2)).toHaveAttribute("aria-pressed", "true");
  expect(await page.locator(".rogue-map-scroll").evaluate((el) => el.scrollTop)).toBe(before);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('[data-node="1-0-0"]')).toBeInViewport({ ratio: 1 });
  await expect(choices.nth(2)).toBeInViewport({ ratio: 1 });
});

test("landscape route keeps its departure action visible", async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await boot(page);
  await expect(page.locator('[data-node="1-0-0"]')).toBeInViewport({ ratio: 1 });
  await page.locator('[data-node="1-0-0"]').click();
  await expect(page.locator('[data-rogue="travel"]')).toBeInViewport({ ratio: 1 });
  await page.locator('[data-rogue="travel"]').click();
  await expect(page.locator(".rogue-panel")).toBeHidden();
});

// Wide map and reward layout: the route uses most of the screen, and every
// decision screen shows all its choices and its departure without scrolling.
async function expectUncovered(page: import("@playwright/test").Page, selector: string) {
  const locator = page.locator(selector);
  const count = await locator.count();
  expect(count, selector).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    await expect(locator.nth(i)).toBeInViewport({ ratio: 1 });
    // Nothing (e.g. a sticky departure bar) may sit on top of the control.
    const covered = await locator.nth(i).evaluate((el) => {
      const b = el.getBoundingClientRect();
      return [
        [b.left + 4, b.top + 4],
        [b.right - 4, b.bottom - 4],
        [(b.left + b.right) / 2, (b.top + b.bottom) / 2],
      ].some(([x, y]) => {
        const hit = document.elementFromPoint(x!, y!);
        return !hit || !(hit === el || el.contains(hit));
      });
    });
    expect(covered, `${selector} #${i} is covered`).toBe(false);
  }
}
async function expectNoScroll(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() =>
    [".rogue-panel", ".rogue-layout", ".rogue-detail"].map((s) => {
      const el = document.querySelector<HTMLElement>(s)!;
      return { s, scroll: el.scrollHeight, client: el.clientHeight, w: el.scrollWidth - el.clientWidth };
    }),
  );
  for (const o of overflow) {
    expect(o.scroll, `${o.s} vertical overflow`).toBeLessThanOrEqual(o.client + 1);
    expect(o.w, `${o.s} horizontal overflow`).toBeLessThanOrEqual(1);
  }
}
async function enterDecision(
  page: import("@playwright/test").Page,
  kind: "reward" | "shop" | "event" | "rest" | "treasure",
) {
  await page.evaluate((kind) => {
    const g = window.__UPRISING__.engine,
      r = g.run!;
    if (kind === "reward") {
      g.selectNode("1-0-0");
      g.travelNode();
      g.world.enemies.forEach((e) => {
        e.alive = false;
      });
      g.world.pendingSpawns = [];
      for (let i = 0; i < 100; i++) g.update(1 / 60);
      return;
    }
    r.map[0]!.kind = kind === "event" ? "unknown" : kind;
    if (kind === "event") r.events.resolved["1-0-0"] = { kind: "event", eventId: "foundry-union" };
    r.economy.scrap = 400;
    g.world.player.damage = 60;
    g.selectNode("1-0-0");
    g.travelNode();
  }, kind);
}
const DECISIONS = {
  reward: "[data-upgrade], [data-rogue=skip]",
  shop: "[data-buy]",
  event: "[data-event]",
  rest: "[data-benefit]",
  treasure: "[data-benefit]",
} as const;

for (const [width, height] of [
  [1440, 900],
  [1280, 720],
] as const) {
  test(`wide route map uses most of a ${width}x${height} screen and shows the whole act`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await boot(page);
    const box = (await page.locator(".rogue-panel").boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(width * 0.85);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(height);
    // The graph spreads into the extra width, beside a full destination panel.
    const graph = (await page.locator(".route-map").boundingBox())!;
    const detail = (await page.locator(".rogue-detail").boundingBox())!;
    expect(graph.width).toBeGreaterThanOrEqual(700);
    expect(detail.x).toBeGreaterThanOrEqual(graph.x + graph.width);
    expect(
      await page.locator(".rogue-map-scroll").evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
    ).toBe(true);
    await expect(page.locator('[data-node="1-7-0"]')).toBeInViewport({ ratio: 1 });
    await page.locator('[data-node="1-0-0"]').click();
    await expectUncovered(page, '[data-node="1-0-0"]');
    await expectUncovered(page, "[data-rogue=travel]");
    if (width === 1440) await page.screenshot({ path: "test-results/screenshots/map-wide-1440.png" });
    await page.locator("[data-rogue=travel]").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".rogue-panel")).toBeHidden();
  });

  for (const kind of Object.keys(DECISIONS) as (keyof typeof DECISIONS)[])
    test(`${kind} choices and departure fit a ${width}x${height} screen without scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await boot(page);
      await enterDecision(page, kind);
      await expect(page.locator(DECISIONS[kind]).first()).toBeVisible();
      expect((await page.locator(".rogue-panel").boundingBox())!.width).toBeGreaterThanOrEqual(
        width * 0.85,
      );
      await expectNoScroll(page);
      await expectUncovered(page, DECISIONS[kind]);
      await expectUncovered(page, "[data-rogue=complete]");
      if (kind === "reward" || kind === "shop")
        await page.screenshot({ path: `test-results/screenshots/${kind}-wide-${width}.png` });
      if (kind === "reward") {
        // Choosing keeps the departure on screen and enables it.
        await page.locator("[data-upgrade]").first().click();
        await expect(page.locator("[data-rogue=complete]")).toBeEnabled();
        await expectNoScroll(page);
        await expectUncovered(page, "[data-rogue=complete]");
      }
    });
}

test("390px reward opens on the three upgrades with the departure reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await enterDecision(page, "reward");
  await expect(page.locator("[data-upgrade]")).toHaveCount(3);
  await expectUncovered(page, "[data-upgrade]");
  await expectUncovered(page, "[data-rogue=complete]");
  for (const button of await page.locator("[data-upgrade], [data-rogue=skip]").all())
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/screenshots/reward-mobile-390.png" });
  await page.locator("[data-upgrade]").first().click();
  await expectUncovered(page, "[data-rogue=complete]");
  await page.locator("[data-rogue=complete]").click();
  await expect(page.locator("[data-rogue=travel]")).toBeVisible();
});

test("390px shop keeps its departure reachable after scrolling to the last item", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await enterDecision(page, "shop");
  await expect(page.locator("[data-buy]").first()).toBeVisible();
  await expectUncovered(page, "[data-rogue=complete]");
  await page.locator("[data-buy]").last().scrollIntoViewIfNeeded();
  await expectUncovered(page, "[data-buy] >> nth=-1");
  await expectUncovered(page, "[data-rogue=complete]");
});
