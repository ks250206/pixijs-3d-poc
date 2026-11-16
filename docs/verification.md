# Verification record

## Motion foundation: jointed skeleton

Baseline: `codex/roguelite-map-ui` **`94aa0768`** (the roguelite route map stack on top of the combat and campaign improvements below). The change replaces each humanoid robot's five rigid blocks with rigid jointed bones placed by a CPU-solved skeleton (`src/render/rig/`): authored state poses, inertialized blending, world-anchored foot planting, and two-bone IK for arms and legs. The player's hands now follow the simulation's weapon capsule instead of a rotated, length-scaled arm. Collision code and move data are untouched. See [Skeleton and motion](combat-architecture.md#skeleton-and-motion).

Environment: unchanged from the previous record (Node 26.13.1, Vite+ 1.6.0, Pixi 8.23.0 / `@pixi/3d` 0.1.0). No dependency changed.

### Local verification

- TypeScript: passed.
- Logic: all 334 tests pass — the 264 existing tests unchanged, plus 70 new rig tests in `tests/rig-solver.test.ts`, `tests/rig-gait.test.ts` and `tests/rig-animator.test.ts`.
- Lint: passed with no warnings.
- Production build: passed.
- Playwright: all 32 cases pass against the production build in local Chromium (SwiftShader), with no retries: the 31 existing cases (16 in `game.spec.ts`, 15 in `roguelite.spec.ts`) plus the new skeleton case.
- `git diff --check`: passed.

### Regression coverage

The rig tests exercise the renderer-free skeleton in Node:

- Rigid bones: every solved joint pair is exactly one bone length apart, for random poses, feet, weapons, aims and hand offsets, and for every non-drone enemy kind.
- IK reach: in-range targets are reached exactly; out-of-range targets pull the end joint along the ray instead of stretching a bone; the middle joint bends toward its pole.
- Grip on segment: the main hand lies on the weapon segment within its per-weapon range, and the trunk follows a shaft that is out of reach. With the feet free it always holds. When planted legs make a contorted trunk physically unable to reach, `grip.miss` reports the shortfall and the hand is at full stretch straight toward the grip. An off hand is reported only while exactly on the shaft.
- Live attacks: for six weapons, both facings and six attacks each, driven by a real `GameEngine`, the main hand is on the capsule the simulation checked on every hit frame.
- Foot planting: a planted foot keeps its world position while the body travels (running, facing left, a scaled heavy body); the feet alternate; standing correction moves one foot at a time; a teleport releases the anchors instead of striding.
- Continuity: idle → run → jump → land → turn → idle, and idle → attack → idle with chained attacks, never jump a hand, the hips or any joint beyond a per-frame bound; a paused clock holds the pose; turning round eases the heading through the camera side.

### Browser verification

`jointed skeleton keeps rigid bones, grips the authoritative weapon and plants its feet` reads `GameScene.rigDiagnostics` — joints taken from real Pixi world matrices — for five melee weapons × both facings through a whole forward tilt, and through a run:

- every rendered upper arm, forearm, thigh and shin equals its spec length within 1e-4 on every tick;
- on every hit frame the main hand is within 1e-3 of `attack.collision.capsule`, and so is the off hand whenever it reports a grip;
- no heel or toe goes below the floor, and while a foot is planted its ground contact (heel at strike, toe at push-off) stays on the floor and does not move in world space.

The existing weapon-matrix comparisons still check the weapon mesh, trail and debug overlay against simulation samples, unchanged.

The tests found real defects before this record was written, all fixed in the rig rather than by loosening an assertion: a hand still 2 cm off the weapon on the first hit frame of a two-frame wind-up; feet rolling about the ankle instead of the ground contact; hips popping when a stance foot was left out of reach at a run start or turn; a hand teleporting between chained attacks; and a rounding-error "miss" that shifted the trunk by a centimetre.

### Limits

Robots are rigid-part hierarchies with no skinning or glTF. There is no wrist joint. Foot planting assumes the flat `y = 0` arena floor. Collision uses authored capsules and body boxes, not the skeleton. Motion quality was judged from staged screenshots and numeric diagnostics, not from extended human play. Per-weapon authored windup, follow-through and weight-shift motion is the next change; attack body poses here still derive from the existing `attackMotion` channels.

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
