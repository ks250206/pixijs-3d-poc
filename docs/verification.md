# Verification record

## Weapon animation: authored wind-up, strike and follow-through

Baseline: `feat/motion-foundation` **`9d2edb4`** (the jointed skeleton below, on the roguelite route map stack). The change authors each weapon's wind-up (予備動作) and follow-through (振り抜き) around the unchanged strike arc (`src/game/combat/trajectory.ts`), gives the player one always-visible weapon model that the hands always hold (`src/render/armory.ts`, `WeaponView`, `RigFrame.held`), and replaces the attack body poses derived from `attackMotion` with per-weapon choreography: trunk turn, weight transfer, lunge step and rebound (`src/render/rig/choreography.ts`). Hit frames, timing, cancels and move data are unchanged. See [Weapon trajectory and body motion](combat-architecture.md#weapon-trajectory-and-body-motion).

Environment: unchanged from the previous record (Node 26.13.1, Vite+ 1.6.0, Pixi 8.23.0 / `@pixi/3d` 0.1.0). No dependency changed.

### Local verification

- TypeScript: passed.
- Logic: all 400 tests pass. The 334 tests of the previous record still pass; `tests/weapon-trajectory.test.ts` adds 17, `tests/choreography.test.ts` adds 11, and `tests/rig-animator.test.ts` grows from 41 to 79 for the always-held weapon.
- Lint: passed with no warnings.
- Production build: passed.
- Playwright: all 33 cases pass against the production build in local Chromium (SwiftShader), with no retries: the 32 previous cases plus the new weapon case.
- `git diff --check`: passed.

### Regression coverage

- Unchanged hits: a golden test keeps a frozen copy of the previous `sampleWeapon` and requires the new one to be bit-identical (`Object.is` on every coordinate) on integer and fractional frames of the hit window, for six weapons × both modules × jab stages, tilt, smash (uncharged and charged), dash and aerial × five directions (480 moves), every special slot, enemy and utility moves, and 400 seeded random moves, at both facings. `sweptContact` results match an oracle built on the frozen sampler, including a tick landing a rounding error past the last hit frame.
- Trajectory continuity and endpoints: approaching the hit window from either side meets its endpoints within 1e-4; frame 0 and every frame from the end of the move on are the `WEAPON_REST` pose at natural length; every frame is finite and facing mirrors X only.
- Shape per trajectory: slashes swing behind before the arc and carry on past it; the pile rises overhead and ends lower than its last hit frame; thrusts are drawn back shorter than their carry; the scythe winds back against its spin; vertical strikes swing onto their line; back attacks move the pivot behind and return it; the six weapons wind up differently, and the three hits of a jab combo share their hit frames while winding up at different heights.
- Choreography: every channel is finite for all styles, kinds, directions, trajectories and flags; a strike leaves no residue in the stance at its first and last frame; hips load back in the wind-up and drive forward at the strike; the lead foot is the one opposite the leading hand; the pile rebounds more than the razor; travelling strikes and spins release the feet; a shot kicks the hips back.
- Animator, driven by a real `GameEngine`: the player holds a weapon in every state; idle carries it at rest on the chest; on every hit frame `held.live` is true and the held segment is the checked capsule within 1e-9, and `held.live` is false on every other frame; cannon shots point down the line of fire at natural length and are never live; the weapon tip never teleports across carry → strike → carry, chained strikes, attack → run or jump → aerial → land; a hand that is not easing is on the weapon within 1e-6; every strike hands the body back facing forward.

### Browser verification

`one weapon model is carried, wound up, lands on the checked capsule and follows through` reads `GameScene.combatGeometry` and `rigDiagnostics` — weapon pivot and tip from real Pixi world matrices:

- carried, each of the six weapons is visible in its own style at its natural length within 2e-3;
- for five melee weapons × both facings through a forward tilt, on every hit tick the rendered pivot and tip equal `attack.collision.capsule` within 1e-4 per axis, and `held.live` equals `collision.active` on every tick;
- the tip does not teleport when the attack starts, when the hit frames end or when the move ends; the weapon draws away before it strikes (the scythe turns back against its spin); for wind-ups of eight frames or more the tip enters the first hit tick no faster than 1.5× its fastest hit tick;
- after the move the weapon stays within 0.02 m of its natural length while settling and is back to it within 5e-3;
- a cannon shot never stretches the model and is never `live`.

It saves wind-up, strike and follow-through frames per weapon (`weapon-<style>-1-windup.png`, `-2-strike.png`, `-3-follow.png`, plus the arc's three jab wind-ups) to the existing `gameplay-screenshots` artifact. The existing weapon-matrix comparisons and the jointed-skeleton case pass unchanged.

The tests and a frame-by-frame review of those screenshots found defects that were fixed in the code, not by loosening an assertion: vertical strikes jumped 1–3 mm entering the hit window; a zero-recovery move could read the rest pose on a tick a rounding error past its last hit frame; after a scythe orbit the body unwound about 190° and the shaft telescoped while settling; the razor had no draw-back; the wind-up was released two to four times faster than the hit frames it led into; and `held.live` stayed set through the recovery.

### Limits

Reaches are gameplay values far longer than a physical weapon, so blades and shafts visibly extend during a strike; the displayed weapon must equal the hit segment. There is no wrist joint, and the weapon's roll about its shaft is cosmetic and smoothed — after a scythe orbit the blade still rolls about a quarter turn over a few frames as its edge returns to face forward. Wind-ups of two or three frames (quick jabs, razor) have no time to read as a draw-back and have to hurry into the hit. From the fixed camera a slash is cocked into the far lane and a mid-orbit scythe points at the camera, so those frames are foreshortened. Motion was tuned from staged screenshots and numeric checks, not motion capture or extended play. Wind-up and follow-through are presentation: they deliberately do not change timing, cancels or hitboxes.

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
