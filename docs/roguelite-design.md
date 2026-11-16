# Roguelite design and integration contract

## Plan 11 — routes and encounters (#9)

Stack base: unmerged PR #8, `b543cda`. Classic STAGES/nextSector and training remain separate modes. Roguelite generates three Acts, each with eight rows (one start, five rows of3–4 nodes, one rest, one boss), at most three forward choices, merges, a guaranteed shop opportunity, initial battle, preboss rest, and boss. Elite/shop rows alternate with ordinary rows so neither repeats consecutively. All nodes have incoming and outgoing paths except the start/boss endpoints. Theme and roster selection reuse all seven themes; one selected wave is an encounter, not the classic campaign.

`GameEngine.run` owns the graph, current/selected/visited/completed nodes and between-encounter resources. `world` remains the authoritative live combat state. On travel the engine validates adjacency; completion is guarded once. First two bosses are Warden variants; only completing Act 3 ends the run. Noncombat nodes use the economy and event transactions described below.

### Motion integration

No changes to render/motion.ts, render/robot.ts, render/weapon.ts or combat/geometry.ts/moves.ts. The fixed 60Hz loop and swept collision order remain intact. Engine additions are run lifecycle methods, an alternate spawn roster and a roguelite wave-completion branch; classic last-sector guards never govern roguelite completion. Encounters reset director, action buffer, actor memories, shots, hazards, bursts and physics actors. Props use node-prefixed IDs so consecutive identical themes recreate their views without a scene hook. Restart uses the original starting loadout, including original module choices.

### Verification

`tests/roguelite-map.test.ts` checks 1000 deterministic seeds, incoming edges, forward choices and boss reachability, full three-Act completion, forged travel, once-only completion, consecutive core-theme ordinary battles and original-loadout restart. Ring-out fixtures intentionally accelerate encounter completion; they are progression tests, not long-session balance evidence. Browser rendering uses the existing software WebGL test configuration; GPU and physical gamepad validation are separate and unclaimed.

## Plan 12 — elite modifiers and SCRAP (#10)

SCRAP is independent of score: battle 30, elite 60, boss 90, once per node. Rewards offer the existing weapon mechanics/module exchanges and an explicit skip; a fully capped pool continues safely. Seeded shops sell upgrades/modules (40–55), repair (25, −40% damage), stock (75, cap4), and relics (60–80). Items are sold once; engine rejects invalid IDs, insufficient balance and ineffective capped purchases without charging. Treasure grants a distinct relic and20 SCRAP (all-owned fallback30 more). Rest offers −50% repair or a usable upgrade (fully capped fallback20 SCRAP).

Ten data-defined relics affect outgoing/incoming damage, ordinary movement, special recovery, salvage rewards, future shop prices, postcombat repair, stock, launch force and treasure yield. They reset on a new run. Elite selection is keyed per node and previewed: +25% damage, +25% ordinary movement, +50% roster reinforcements, +40% shield/armor/mount, threshold60 berserk, or commander cohort. The single `hit` boundary scales applicable melee/projectile/hazard damage once; emitters retain unscaled data. No attack/telegraph/cooldown timings or director reservations are accelerated. Staged arrivals retain the14 active enemy cap.


## Plan 13 — unknown stops and events (#11)

Unknown base weights are event60 / battle20 / shop12 / treasure8. Each missed category accumulates +8 weight per unknown, capped at6 misses (+48). This is bounded weight pity, not a guaranteed arrival deadline. Resolution is keyed to seed/node and recorded on entry. Event history exhausts all16 before reuse. Opening/reopening never draws again.

Sixteen original rebellion encounters cover donations, salvage injuries, repairs at power cost, stock exchange, all six weapon swaps, special changes, all module slots, upgrades, relic sacrifice, a keyed lottery and optional elite rescue combat. Costs/eligibility are dry-run on copied resources/economy; a rejected option never partly spends resources. Every event includes a safe leave. Chosen result and before/after resources/SCRAP are recorded; the whole choice applies once. All-owned relic and fully-capped upgrade options have explicit SCRAP fallbacks. Weapon switching retains dormant incompatible upgrades, which become active again if that weapon is reequipped. Rescue combat checkpoints the selected choice and uses elite reward, then ordinary reward/map return.

Validation adds every option of all16 events, constraints/atomic rejection, once-only selection, rescue return, 2000 unknown resolutions and event-history exhaustion. Browser tests exercise disabled costs and selected results. Long-session human balance remains unmeasured.

## Plan 14 — checkpoints, UX and balance verification (#12)

`checkpoint.ts` stores a version1 envelope in `null-uprising-run`. It validates primitive bounds, loadouts/modules/upgrades, the forward reachable graph, visited/completed path, current/selected phase, inventories, event definitions/results, category pity and reward claims before restore. Unreadable/incompatible data stays intact until explicit discard or a successful new-run save. Continue is click-only. Writes are atomic `localStorage.setItem` calls from successful transaction notifications, deduplicated by run identity/revision; there is no physics/frame save loop.

Encounter-start resources remain frozen while combat runs. Reload restarts enemies, props, director and keyed combat RNG from that boundary; no actors, shots or half-updated physics are serialized. Reward/shop/event/map transactions synchronize resources and save their committed revision. Rescue combat is recognized through its recorded `combat` flag even though the effective node kind is event. Its cost is preserved without applying the choice twice. Completed, dead and explicitly abandoned runs write terminal markers and cannot continue. If storage is unavailable or full, a visible warning states that the previous checkpoint may be older; a browser that refuses writes cannot guarantee durable progress or a durable terminal marker.

### Review corrections and final parameters

Topology now varies both row widths (3–4 interior columns) and seeded edge choices, with2–3 successors except merges into rest/boss. Every Act guarantees a reachable shop and treasure opportunity. Act I uses foundry/transit/skybridge, Act II hive/barracks, Act III gauntlet/core; the initial battle is the easy foundry scout/scout/gunner encounter. Tests intentionally override core themes to cover the historical last-sector regression.

FORTIFIED adds a sentinel if necessary so it always has an actual shield/armor effect. Elite and boss completion also grants one unowned relic, or30 SCRAP if all eligible relics are owned, in the same once-only reward transaction. Mortars retain an owner snapshot after defeat so their damage modifier persists. Ballast reduces the full launch impulse, including damage growth. Shops share the engine's purchase eligibility/reason with the UI; the next rank and rest upgrade identity/effect are visible before commitment. New Run advances to a fresh reproducible seed; Restart retains that run's seed and original loadout.

Keyboard M and the toolbar use one roguelite map hook; the classic route dialog never opens for this mode. Escape closes inspection. Inspection resets with run identity. Device-neutral input blocking covers the whole route panel, including simulated gamepad START; held input is released on travel/close. Arrows/Tab navigate controls and Enter confirms a selected node separately from travel. Responsive390px layout scrolls the map and transaction details vertically.

### Independent review and limits

A separate noninteractive `codex exec --sandbox read-only` reviewer used gpt-6.1-terra. Its static review found input behind an open route, missing-shop save validation, and combo carryover; these were fixed with targeted regressions. Its initial rescue-reload concern was explicitly unconfirmed and is covered by unit/browser reload tests. The reviewer could not run its own checks because of its sandbox/pnpm mismatch; the main agent ran the configured pnpm12.21.0 tests independently. No independent browser pass is attributed to the reviewer.

No human long-run difficulty tuning, physical gamepad, real GPU or WebGPU acceptance is claimed. Automated progression uses documented controlled ring-out/debug fixtures; local Playwright runs actual Chromium with SwiftShader. Desktop/mobile screenshots for route, shop and events are emitted under `test-results/screenshots/`, already uploaded by the existing CI workflow. No dependencies or workflow/security policy were changed.

Final-layer logic snapshot: `npx --yes pnpm@12.21.0 typecheck`, `test` (264 tests in18 files), `lint`, and `build` pass. Full final browser validation is tracked separately in the PR; the earlier final-layer run passed24/25 with only an ambiguous MAP locator failure. That locator is fixed, and the exact final snapshot is rerun, including the additional simulated-gamepad regression. The original215 logic and16 browser tests were retained.

These are stacked implementation changes intended to merge together in dependency order: Plan11 map → Plan12 economy → Plan13 events → Plan14 persistence/UX. Corrections to earlier layers identified by parent/independent review live in the final PR. None of PR8, main or the concurrent motion branches was merged here.

Roguelite combat HUD reports the single encounter (1/1), theme and actual clear objective rather than classic wave/relay metadata. Reward restoration regenerates concrete next-rank/module descriptions using `upgradeDescription`; unit/browser assertions cover both display regressions.
