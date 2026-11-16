# Roguelite design and integration contract

## Plan 11 — routes and encounters (#9)

Stack base: unmerged PR #8, `b543cda`. Classic STAGES/nextSector and training remain separate modes. Roguelite generates three Acts, each with eight rows (1/3/4/3/4/3/1/1 nodes), at most three forward choices, merges, a guaranteed shop opportunity, initial battle, preboss rest, and boss. Elite/shop rows alternate with ordinary rows so neither repeats consecutively. All nodes have incoming and outgoing paths except the start/boss endpoints. Theme and roster selection reuse all seven themes; one selected wave is an encounter, not the classic campaign.

`GameEngine.run` owns the graph, current/selected/visited/completed nodes and between-encounter resources. `world` remains the authoritative live combat state. On travel the engine validates adjacency; completion is guarded once. First two bosses are Warden variants; only completing Act 3 ends the run. Noncombat nodes initially have safe continue placeholders, replaced in the next stack layers.

### Motion integration

No changes to render/motion.ts, render/robot.ts, render/weapon.ts or combat/geometry.ts/moves.ts. The fixed 60Hz loop and swept collision order remain intact. Engine additions are run lifecycle methods, an alternate spawn roster and a roguelite wave-completion branch; classic last-sector guards never govern roguelite completion. Encounters reset director, action buffer, actor memories, shots, hazards, bursts and physics actors. Props use node-prefixed IDs so consecutive identical themes recreate their views without a scene hook. Restart uses the original starting loadout, including original module choices.

### Verification

`tests/roguelite-map.test.ts` checks 1000 deterministic seeds, incoming edges, forward choices and boss reachability, full three-Act completion, forged travel, once-only completion, consecutive core-theme ordinary battles and original-loadout restart. Ring-out fixtures intentionally accelerate encounter completion; they are progression tests, not long-session balance evidence. Browser rendering uses the existing software WebGL test configuration; GPU and physical gamepad validation are separate and unclaimed.

## Plan 12 — elite modifiers and SCRAP (#10)

SCRAP is independent of score: battle 30, elite 60, boss 90, once per node. Rewards offer the existing weapon mechanics/module exchanges and an explicit skip; a fully capped pool continues safely. Seeded shops sell upgrades/modules (40–55), repair (25, −40% damage), stock (75, cap4), and relics (60–80). Items are sold once; engine rejects invalid IDs, insufficient balance and ineffective capped purchases without charging. Treasure grants a distinct relic and20 SCRAP (all-owned fallback30 more). Rest offers −50% repair or a usable upgrade (fully capped fallback20 SCRAP).

Ten data-defined relics affect outgoing/incoming damage, ordinary movement, special recovery, salvage rewards, future shop prices, postcombat repair, stock, launch force and treasure yield. They reset on a new run. Elite selection is keyed per node and previewed: +25% damage, +25% ordinary movement, +50% roster reinforcements, +40% shield/armor/mount, threshold60 berserk, or commander cohort. The single `hit` boundary scales applicable melee/projectile/hazard damage once; emitters retain unscaled data. No attack/telegraph/cooldown timings or director reservations are accelerated. Staged arrivals retain the14 active enemy cap.

Parent review follow-ups for final UX layer: vary map topology by seed; use Act-specific biome pools with an easy opener; unify keyboard/toolbar route entry and clear inspection state on reset. These are recorded rather than claimed as already verified in this layer.
