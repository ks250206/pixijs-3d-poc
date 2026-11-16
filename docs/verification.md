# Verification record

## Combat reach and arcs

Baseline: `feat/weapon-animation` **`b730c5d`** (the weapon animation below). Four changes asked for together: player attacks are easier to land across lanes; dodges are fast, positional and never invulnerable, with no wavedash; up and down attacks sweep arcs instead of poking a line; and the route map and reward screens are wider with no scrolling on desktop.

Local verification of the whole change: TypeScript and lint pass; all 579 logic tests pass (2 `todo` entries record that the pile and cannon slams do not themselves reach the side lanes); the production build passes; all 48 Playwright cases pass against the production build in local Chromium (SwiftShader), with no retries; `git diff --check` passes.

CI: not green. The GitHub Actions job stops at its 12-minute limit while still running browser tests — it already did on the pull request this stack sits on (31 browser cases; cancelled during the 23rd), before any of the motion or combat changes. The cases that ran passed. The suite takes about 4 minutes locally and several times longer on the CI runner's software renderer, so the full 48 cases have never completed there.

### Lane assist and ground dodge

Player attacks are forgiving across lanes, the ground dash is a fast burst with a longer lane dash, the air dash moves along lanes instead of up/down, the wavedash is removed and no dodge grants invulnerability. See [Coordinate and geometry contract](combat-architecture.md#coordinate-and-geometry-contract) and [Movement invariants](combat-architecture.md#movement-invariants).

Lane assist (`tests/lane-assist.test.ts`). A forward tilt through ordinary input against a scout, the largest hitting lane offset measured at 0.01 resolution with the assist set to 0 and then at 0.45:

| Weapon (target x) | Before | After | X reach on the lane |
| --- | --- | --- | --- |
| arc (1.4) | ±1.29 | ±1.74 | 3.54, unchanged |
| pile (1.4) | ±1.46 | ±1.91 | 3.30, unchanged |
| razor (1.4) | ±0.58 | ±1.03 | 2.87, unchanged |
| lance (1.4) | ±0.42 | ±0.87 | 5.27, unchanged |
| cannon bolt (1.4) | ±0.71 | ±1.16 | beyond the arena |
| scythe (3.75) | +1.63 / −1.20 | +2.00 / −1.65 | 4.07, unchanged |

- Every weapon connects at z = 0, ±0.5 and ±0.8; each connects 0.3 past its old tolerance (where the unpadded geometry misses) and misses 0.08 past old tolerance + assist; razor, lance and cannon miss at ±1.8.
- X reach is unchanged on the lane and at z = 0.5 (a lane offset no longer shortens it). A body just above the highest point of the live capsule is missed on and off the lane.
- A lance tilt damages a barrel 0.95 off its lane that the unpadded box misses; cannon bolts hit at |Δz| 0.9 / 1.1 and miss at 1.25 / 1.8.
- Enemy attacks are not assisted: for a real scout SERVO STRIKE, the player at an offset the strike misses — but would hit if the player were padded — takes no damage, on either side; inside the strike's depth the same strike lands.
- The Training HITBOX overlay draws enemy body panels with the assisted depth and the player's unpadded; the readability band and rings use `SAME_LANE_DISTANCE` = body half-depth + assist = 0.73 (was 0.65). Not re-checked visually in a browser.

Ground and air dash (`tests/dodge.test.ts`), measured per 60 Hz step from a standing start with loadout speed 1 (run 6.2, dash-run 10.4), Shift tapped once with the direction:

| Dash | Before: travel / peak / first 55% | After: travel / peak / first 55% |
| --- | --- | --- |
| Ground neutral, forward, back (X) | 1.68 (1.71 incl. glide) / 8.0 / 70% | 1.68 / 17.2 / 90% |
| Ground far / near lane (Z) | 1.12 (1.14) / 5.3 / 70% | 1.93 / 19.7 / 90% |
| Ground diagonal (X, Z) | 1.19, 0.79 / 6.8 / 70% | 1.19, 1.36 / 18.5 / 90% |
| Air left/right (X) | 3.76 in the dash (5.36 total) / 12 | unchanged |
| Air up / down | vertical ±12 (no Z) | lane −Z / +Z: 2.04 / 21 / 89%, no vertical velocity |
| Air neutral | hang | hang |

- Ground dash: duration 22 steps (0.36 s) and air dash 20 steps (0.32 s) unchanged; X travel 1.00× the previous dash, lane travel 1.72× (1.69× including the old glide); peak ≥ 1.4× dash-run and above the fastest starting chassis; ≥ 80% of travel in the first 55%, in X and Z; under 2% left after the dash; stops exactly at the ±3.8 rails (ground and air) with outward velocity removed; deterministic.
- Invulnerability is never set by a dodge (ground or air); dashing into a scout's strike is hit.
- Escapes, measured as the latest dodge start that avoids all damage (frames before the first hit frame; enemy 2–5 units ahead on the player's lane):

| Attack (telegraph) | Back, tapped | Far lane, tapped | Near lane, tapped | Before the retune, back / lanes (no invulnerability) |
| --- | --- | --- | --- | --- |
| Scout SERVO STRIKE (22 f) | 4 | 7 | 1 | 10 / none, none |
| Sentinel SHIELD BASH (35 f) | 3 | 6 | 0 | 9 / none, none |
| Bruiser HAMMER SLAM (40 f) | 10 | none | none | 17 / none, none |
| Charger RAIL CHARGE (39 f) | none | 0 | 0 | none / 6, 0 |
| Gunner PULSE SHOT (37 f) | none | 0 | 0 | none / 0, 0 |

  The bruiser's radial slam cannot be left by a lane dash alone; a lane dash held into a run escapes when started 25 (far) / 28 (near) frames before it lands, and a back dash 10 frames before. Backing away from a charger or a shot needs a held run (14 / 17 frames before). A boss lane pattern is left by a far-lane dash 8 frames before it fires; staying, or dashing into the other live lane, is hit.
- Wavedash removed: a low diagonal-down air dash lands in `idle` with no `wavedash` event, keeps the `AIR DODGE` label and stops under normal ground control; no state, event, sound, help or README text remains.
- Seeded campaign bot (`tests/engine.test.ts`, `tests/campaign.test.ts`) and roguelite balance tests pass unchanged; the bot's dead `"wavedash"` entry in its can-act state list was removed.

### Up and down attack arcs

The owner found up attacks hard to land because they poked one vertical line, and wanted down attacks to mow low and lead into up attacks. Every up/down tilt, smash and aerial of the six weapons now sweeps an authored `shape.arc` (`ARCS` in `src/game/combat/moves.ts`): up attacks a rising crescent from low in front, over the head and on behind it; grounded down attacks a low sweep across both lanes (arc, razor, lance), a full low spin (scythe) or an overhead slam (pile, cannon), launching upward with a `POP_STUN` hold; down aerials a crescent or wheel under the fighter, still a spike. The body follows the arc's plane and the dodge poses lean into the direction of travel. See [Coordinate and geometry contract](combat-architecture.md#coordinate-and-geometry-contract) and [Weapon trajectory and body motion](combat-architecture.md#weapon-trajectory-and-body-motion).

What is verified:

- Boundary and golden (`tests/weapon-trajectory.test.ts`): exactly the up/down tilt, smash (charge 0 and 1) and aerial normals of six weapons × both modules carry an arc, ground kinds sharing one slot and aerials another, up slots being vertical sweeps through overhead; no other move has one (neutral/forward/back normals, jab and dash, every special, every utility/enemy move). Every arc-less move still matches the frozen pre-change sampler bit for bit. `pile-launch` and `lance-sweep` drop the arc at every rank and are the original trajectories again; other upgrades keep it.
- Arc wind-up and follow-through: before the hit the weapon is wound back beyond `from` against the sweep and after it carried on beyond `to`; the pivot holds `pivotY[0]` through the late wind-up and `pivotY[1]` into the follow-through, blending from and to the rest pivot. Arc-less vertical strikes keep their old swing.
- Hit-frame geometry (`tests/attack-arcs.test.ts`): the pivot is at `actor.x + facing·0.3`, `actor.z`, its height travelling `pivotY[0] → pivotY[1]`; a vertical arc's tip stays exactly in the fighter's lane at length `reach·(0.75 + 0.25·sin πt)` and the authored elevation; a level arc's aim.y is its tilt and its heading sweeps with Z compressed by `min(1, depth/reach)`; facing mirrors X only. A thin target on the swept surface between two whole frames is still hit (the moving pivot does not tunnel), checked on more than 1000 candidates.
- Coverage, with the game's own `sweptContact` against standard scout bodies (attacker at the origin facing +X): every grounded up tilt and smash hits a scout in front at x = 1.6 in the same lane (the old vertical line missed it), one directly overhead (feet 2.2 up) and one above-and-behind; every up aerial hits one directly above. Level down sweeps hit in front and at z = ±1.0 (the old line missed both lanes) with the blade below 0.5; slams hit in front and end on the floor; the scythe spin also hits behind, in its lane and the near lane; every down aerial hits a scout directly below (the old line missed it).
- Launch data: grounded down tilts and smashes launch at an angle above 1 rad and below vertical, with less growth than the same kind's forward attack; down aerials still spike; up normals keep 1.28.
- Through the real engine: for each weapon × both modules an up tilt hits a scout in front and one held overhead; a grounded down tilt pops its target upward, steeper than 45°; and, the owner's combo, after a grounded down tilt connects on a fresh scout, an up tilt buffered at the first legal frame comes out at the hit cancel and connects while the scout is still in `hurt`. Before `POP_STUN` the breaker lance, cannon and scythe (startup 11–13) landed 1–4 frames after a 15–16 frame hitstun had ended.
- Body (`tests/choreography.test.ts`, `tests/rig-animator.test.ts`): arcs leave no residue in the stance; a vertical arc yaws neither hips, chest nor head and bends the trunk back overhead/behind and forward underneath; a level grounded down sweep sinks the hips lower than the forward tilt and the slam; an orbit weapon swung vertically is not a spin (feet planted, stance does not pivot); driven by the engine, every weapon's vertical up tilt, smash and aerial passes over and behind the head at both facings without yawing the trunk round.

Up tilt, same lane: the range of target feet x that is hit, and the highest target feet height hit at x = 0 (geometry level, without the engine's lane assist; before the change in brackets):

| Weapon | Feet x hit | Max overhead feet height |
| --- | --- | --- |
| arc | −0.6 … 2.8 (−0.2 … 1.0) | 3.8 (2.2) |
| pile | −0.8 … 2.4 (−0.4 … 1.2) | 3.6 (3.0) |
| razor | −0.4 … 2.4 (−0.2 … 1.0) | 3.2 (2.4) |
| lance | −0.2 … 3.6 (0 … 1.0) | ≥ 4 (1.8) |
| cannon | −0.6 … 2.6 (−0.4 … 1.2) | 3.6 (2.8) |
| scythe | −1.2 … 3.4 (−0.4 … 1.2) | ≥ 4 (2.8) |

All six also hit a target above-and-behind.

Grounded down tilt, lanes reached (target |z|, geometry level; the engine's lane assist adds 0.45 on each side):

| Weapon | Shape | Lanes reached (before) |
| --- | --- | --- |
| arc | level sweep | ±1.6 (±0.5) |
| razor | level sweep | ±1.5 (±0.5) |
| lance | level sweep | ±0.4 point blank, growing to ±1.2 at range |
| scythe | full low spin | −2.5 … +3.0, and behind |
| pile | overhead slam | ±0.69, front only |
| cannon | overhead slam | ±0.67, front only |

Limits:

- The pile and cannon slams do not themselves cover the side lanes: they are vertical arcs in the fighter's own lane, so only the lane assist widens them. Two `it.todo` entries in `tests/attack-arcs.test.ts` record this.
- The razor's up tilt covers only a little behind (its arc ends at 110°).
- The coverage ranges in the tables were measured while tuning; the unit tests pin the contract points listed above (front at x = 1.6, overhead 2.2, above-and-behind, lanes ±1.0, behind, below), not each range.
- Arcs are authored gameplay shapes (the hit segment), so blades still visibly extend during a strike.
- Tuned from staged screenshots and numeric coverage, not long play sessions.

### Map and reward layout

Request: make the route map modal wider, and stop reward choices from needing a scroll.

**What changed (UI only: `src/ui/styles.css`, `src/ui/roguelite.ts`; no game or render logic)**

- Roguelite route panel is `min(96vw, 1400px)` wide (it was capped at 1200px). On screens 780px tall or less it starts 12px from the top, over the toolbar, which is inert while the panel is open. The route guide and the legend now sit in a side rail next to the map instead of a bar under it. The graph grows to fill up to 880px of width and the full height, so at 1024×768 and larger the whole act is visible without scrolling the map.
- Decision phases (post-battle reward, shop, event, rest, treasure) split the panel about 32/68. The map becomes a compact overview: node captions are hidden by a container query when the graph is under 480px tall. The destination is shown as one summary row (icon, name and place, reward), and the generic "what this stop is" copy is hidden because the action heading repeats it. Choices are laid out in up to three columns in a `.rogue-choices` grid. Shop stock shows `title | price` above its effect line, split from the stock name at the first `": "`. The departure bar is a single horizontal row.
- Landscape phones (≥761px wide, ≤600px tall): the legend and guide are hidden, and decisions use the full width with no map. When the choices would not fit, the panel opens with the decision area scrolled to the choices (`.rogue-actions`). Portrait phones keep the sticky departure bar. The layout scrolls to the choices, not the destination heading, only when the choices would not otherwise fit above that bar. `scroll-padding-bottom` keeps focused controls clear of the bar.
- Classic stage-clear dialog (`.reward-dialog`) is `min(1400px, 100%)` wide. Each upgrade card puts kind and rank on one line through a CSS grid, with no markup change. The supply copy sits beside its three options. The footer is `sticky; bottom: 0` with a 44px button. On short landscape screens the spacing is tighter. The classic route overview uses 7 columns at ≥1200px.
- Text in choices, descriptions, supply options and footers is now 13px or larger, up from 10–12px. Choice buttons are at least 44px tall.

**Measurements** (Playwright, same fixtures as the specs, fresh render at each size). Each cell shows: dialog width (% of viewport) / scroll containers that overflowed, as scrollHeight/clientHeight / choices fully visible and uncovered.

| Screen | Viewport | Before | After |
| --- | --- | --- | --- |
| route map (3 branches) | 1440×900 | 1200 (83%) / none / 3/3, graph 580px wide | 1382 (96%) / none / 3/3, graph 872px wide |
| route map | 1280×720 | 1200 (94%) / map 440/321, detail 388/318 | 1229 (96%) / none, graph 718×483 |
| route map | 1024×768 | 976 / map 440/369 | 983 / none |
| post-battle reward | 1440×900 | detail 841/444 / 0/4 | none / 4/4 |
| post-battle reward | 1280×720 | map 440/321, detail 841/318 / 0/4 | none / 4/4 |
| shop (6 items) | 1280×720 | detail 1132/318 / 0/6 | none / 6/6 |
| event | 1280×720 | detail 752/318 / 0/3 | none / 3/3 |
| rest | 1280×720 | detail 683/318 / 0/2 | none / 2/2 |
| treasure | 1280×720 | detail 514/318 / 0/1 | none / 1/1 |
| classic stage clear | 1440×900 | 980 (68%) / dialog 868/848 | 1390 (97%) / none / 6/6 |
| classic stage clear | 1280×720 | 980 (77%) / dialog 868/668 / 3/6 (supply under footer) | 1230 (96%) / none / 6/6 |
| classic stage clear | 1024×768 | dialog 864/716 / 3/6 | none / 6/6 |
| post-battle reward | 390×844 | layout 1095/681 | layout 983/681, 3 upgrades + skip in view, departure sticky |
| classic stage clear | 390×844 | dialog 1404/810 / 2/6 | dialog 1074/810 / 3 upgrades in view, departure sticky |
| classic stage clear | 844×390 | dialog 856/338 / 0/6 | dialog 561/368 / 3 upgrades in view |
| post-battle reward | 844×390 | detail 902/93 / 0/4 | detail 385/188 / 3 upgrades in view |

Scrolling remains on phones (390×844 shop, 320×568, landscape shop): there it is unavoidable. The departure control stays visible in every measured case.

**Regression coverage**

- `tests/browser/roguelite.spec.ts`
  - `wide route map uses most of a {1440x900,1280x720} screen and shows the whole act`: the panel is at least 85% of the viewport width and inside it. The graph is at least 700px wide, with the destination panel beside it. The map does not overflow. Floors 1 and 8 are visible, and the departure works from the keyboard.
  - `{reward,shop,event,rest,treasure} choices and departure fit a {1440x900,1280x720} screen without scrolling`: there is no vertical or horizontal overflow in `.rogue-panel`, `.rogue-layout` or `.rogue-detail`. Every choice and `[data-rogue=complete]` is fully in the viewport and not covered (checked with `elementFromPoint`). After choosing a reward, nothing overflows and the departure is still uncovered.
  - `390px reward opens on the three upgrades with the departure reachable` and `390px shop keeps its departure reachable after scrolling to the last item`.
- `tests/browser/game.spec.ts`
  - `stage-clear reward dialog shows every choice and its departure without scrolling on wide screens`: at 1440×900 and 1280×720 the dialog is at least 85% wide with no overflow, and all upgrades, supplies and the departure are uncovered. At 390×844 the three upgrades and the departure are visible and every button is at least 44px tall. Choosing an upgrade still enables travel once.
- Screenshots:
  - roguelite: `test-results/screenshots/map-wide-1440.png`, `reward-wide-{1440,1280}.png`, `shop-wide-{1440,1280}.png`, `reward-mobile-390.png`
  - classic: `classic-reward-wide-1280.png`, `classic-reward-mobile-390.png`

**Limits**

Measured in headless Chromium with SwiftShader only. This was not checked on Safari or Firefox, or on real phones with notches or on-screen keyboards. Shop stock names come from game data. A future stock without `": "` falls back to a single title line. Much longer event or upgrade text could bring back overflow at 1280×720. The tests above would catch that.

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
