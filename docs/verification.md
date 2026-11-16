# Verification record

## Combat and campaign improvements

Baseline: `origin/main` **`7f6472f6ca9cb74adeaaf6b98641282729ea246d`**. The change implements five areas: aerial/input feel, combat readability, ready/fair enemy scheduling, per-run weapon builds, and objectives that change encounters. The seven stages and 23 authored encounters remain.

Environment: Node **26.13.1**, pnpm **12.21.0**, Vite+ **1.6.0**, Pixi **8.23.0** / `@pixi/3d` **0.1.0**. Dependency pins and the existing Pages workflow are unchanged.

### Local verification

- TypeScript: passed after integration.
- Logic: the integrated suite passes, including all seven sectors completed using ordinary combat inputs and the public reward actions. No progress flags, damage overrides, invincibility or teleports are used by that campaign bot.
- Lint: passed with no warnings.
- Production build: passed.
- `git diff --check`: passed.

The campaign helper now deliberately releases movement before neutral special, so it does not accidentally select the universal side dash. It reads the independent recovery allowance when deciding whether it can recover. Structural/render fixtures remain separate from this ordinary-input completion test.

### Regression coverage

- Identical short-hop height with/without a normal aerial for every weapon; aerial steering and fast-fall; forced special and air-dodge motion retained.
- Five-frame buffer expiry, first legal recovery/landing/cancel frame, frozen hitstop clock, direction snapshots across render frames, reversed dash attacks, one-time edges and lifecycle reset.
- Up-special during offensive cooldown, one use per airtime, landing reset, and no hitstun/startup bypass.
- Ready candidates, cooldown/range filtering, per-actor fairness, safe two-enemy pairing, forbidden boss/AOE combinations, retained shells and counterattack gaps.
- Deterministic three-choice rewards across six sector clears, real effects for all six weapons, module exchanges, mandatory/single-use rewards, invalid supplies and restart reset.
- Relay reinforcements stopped on destruction; independent artillery/vent nodes; final-wave-only lockdown and survival departure; bounded staged arrivals and pause/reset cleanup.
- Priority-based label placement stays within the viewport and avoids other enemy labels.

### Browser verification

The unchanged GitHub Actions workflow runs the 16-test Playwright suite against the production build. The associated pull request's checks are the authoritative run result. The suite includes actual WebGL2 canvas pixel checks, six weapon styles, stage/roster rendering, keyboard/touch menus, GPU fallback errors, graphics presets, weapon-matrix comparisons and scene resource replacement.

Updated browser regressions additionally exercise automatic three-choice rewards, mandatory selection before travel, single-use supply, a 390px reward dialog, same-lane boss occlusion at low graphics settings, an offscreen P1 indicator, and Pause → Esc → Space without focus stealing the jump. Staged-wave fixtures wait for the announced arrivals instead of assuming every enemy appears immediately.

Local Chromium could not launch in this managed workspace: its process-singleton socket failed with `Operation not permitted` before a page opened. This is recorded as an environment limitation, not a successful local browser run. Browser validation and screenshots therefore come from the repository's normal CI environment.

Screenshots are uploaded by the existing `gameplay-screenshots` artifact step. New captures include `upgrade-choices.png`, `upgrade-mobile.png` and `player-occluded-low.png`; the existing title, gameplay, stage, mobile, floor-warning and geometry captures remain.

### Review and limits

Independent source reviews cover input/combat, UI/render and progression. Findings addressed include a same-lane occlusion gap, pause-resume keyboard focus and buffered reverse-dash direction. Review comments are resolved in code with targeted regressions.

The browser tests use Chromium's WebGL2 via SwiftShader. Physical GPU performance, WebGPU and a physical gamepad are not claimed as verified. Collision uses authored capsules and body bounds. The seeded campaign bot demonstrates reachability; it does not replace extended human difficulty testing across every seed and build.
