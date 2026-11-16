# Combat data and motion

The engine is a CPU-only simulation. `src/game/combat/moves.ts` owns the typed `MoveDefinition`: stable ID, behavior ID, pose identity, integer 60 Hz startup/active/recovery, shape trajectory and dimensions, damage/knockback, and cancel windows. `playerMove` resolves all six weapon styles, combo stage, charge and rolled normal module. `specialMove` resolves every advertised special slot. Labels are display text; neither simulation nor rendering dispatches on `attack.name`.

`update` prepares attack timing and velocities, integrates actors, resolves floor/props/grabs/depth rails, then checks collisions. `AttackVisual.collision` stores the exact checked world capsule, and rendering consumes that snapshot. Moving phase/dash/falling aerial browser regressions compare it to the actual mesh rather than recomputing a render-only pose.

`beginMove` creates one swing record with a per-target hit set. The engine and renderer consume the same resolved definition. Projectiles have separate ownership, hit memory, lifetime and pierce budgets; they do not reuse the melee capsule. A projectile confirms only its originating swing while that exact swing is still current; a delayed old shot cannot grant the next move a hit cancel. A missed grab is an explicit non-hitting `none` behavior with zero active frames, never a distant timing sentinel.

## Coordinate and geometry contract

World +X is stage right, +Y is up, +Z is the front lane. Facing mirrors only X. `sampleWeapon` returns world-space capsule endpoints for the selected frame. Up and down attacks change elevation, never silently repurpose depth Z. The lance has a narrow shaft/tip capsule, extends and retracts with the motion, and cannot hit a rear fighter on a forward thrust. Its 1.35 multiplier requires contact on the final 24% of the capsule, including vertical attacks; horizontal distance alone is insufficient.

`geometry.ts` measures exact segment-to-body-box distance. Body bounds include the full scaled torso/head height of the boss. Sweeps clamp to the active interval, sample adaptively according to endpoint travel / capsule radius, and check endpoint edges. Prior actor transforms refresh before every integration step, including windup. Collision is independent of the GPU. The shape is an authored gameplay approximation, not per-triangle skeletal collision.

`render/weapon.ts` draws a unit +Y weapon whose tip is exactly local `(0,1,0)`. Its transform comes from the authoritative world segment; the arm uses a CPU grip solve to stay connected. Melee weapons and trails use these endpoints. Centered debug/trail cubes are positioned at the segment midpoint. Browser tests compare the actual Pixi world matrix of the tip, trail and debug endpoints against numerical simulation samples for mirrored forward/back/up/down lance aerials. The test measures geometry, not just timing or shared function calls.

Training's **HITBOX / 判定表示** button shows active weapon segments/endpoints and body heights in every graphics preset. The green thick line represents the capsule axis/radius; it is not a full translucent body hull. Startup/recovery have no live weapon overlay.

## Cancels

Normals permit attack/special/jump/dodge cancels after a confirmed fighter hit and the authored frame threshold. Whiffs permit only a late recovery dodge when enough recovery remains; very short quick jabs have no whiff cancel. Empty/reversed windows are omitted. Smashes retain their recovery unless an acquired weapon upgrade explicitly adds a hit-confirmed cancel. Utility/enemy moves retain their recovery. Cancel eligibility is checked before discarding the old move, including offensive special cooldown, remaining jumps, one air dodge per airtime, and used up-special recovery. Up-special checks its own airtime allowance, independently of offensive cooldown. Hurt/grab states cannot bypass those gates. Only the single approved cancel action is routed to execution, even with simultaneous buttons. Every new swing gets a fresh hit set; every projectile retains its own hit set.

## Input and aerial control

`input.ts` records a direction-bearing `ActionPress` at each keyboard, touch or gamepad edge. The main loop merges these presses across render frames and consumes each edge once. Optional `InputFrame.aimX/aimZ` separates right-stick aim from left-stick movement; callers that omit aim retain movement-direction fallback. Releasing a direction before the next physics step does not erase the direction of an already-recorded press.

`action-buffer.ts` retains action presses for five 60 Hz simulation frames, including the press frame. The engine attempts them at the first legal recovery, landing or cancel frame. Hitstop freezes the buffer clock; holding a button does not generate repeated attacks. Pause/resume, nonplaying phases, restart, sector change, death/respawn and an actual player hit clear stale inputs. New presses during late hitstun may still execute when that hitstun ends. This is simulation state, not a render-frame delay.

Normal aerial attacks call the same `movePlayer` control as free movement. Jump-release cuts and downward fast-fall input also apply during a normal aerial. Authored phase/up-special/down-special and air-dodge motion stays locked to its own behavior. `WorldState.recoveryAvailable` exposes the living player's remaining up-special allowance; it is restored on landing. It is an allowance indicator, not permission to bypass hitstun or move recovery.

## Run upgrades

`upgrades.ts` owns stable upgrade IDs, weapon eligibility, bounded ranks, deterministic reward choices and the pure `upgradeMove` transformation. Resolved move geometry and cancel windows are shared by collision and rendering. Additional hit/projectile effects live in the simulation and use per-swing or per-projectile hit memory, so repeated collision samples do not repeatedly grant jumps, cooldown refunds or waves. Mutable per-run counters reset on restart and sector transition.

Stage-clear rewards are independent of the existing repair/power/stock supply. The engine, not just the UI, requires one offered upgrade before a normal completed-stage departure. The initial loadout remains a deep-copied restart baseline, so module exchanges and acquired upgrades cannot leak into the next run.

## Combat readability

The screen overlay keeps a P1 beacon and ground ring visible, adds an approximate silhouette when a foreground fighter/prop overlaps the player's screen bounds, and clamps a directional beacon to the viewport when the player is offscreen. A projected band and enemy rings indicate nearby depth (±0.65), not a guaranteed hit: reach, height, motion and hurtboxes still matter. These guides do not depend on 3D shadows or the full-effects setting.

Normal enemy labels prioritize telegraphs, bosses and nearby/hit actors, cap the visible set at six and use bounded screen-space placement to avoid each other. Full names and AI tactics are opt-in in Training. `GameScene.getReadability()` returns diagnostic state for browser regression tests; it does not control combat.

## Add a move

1. Add/adjust the pure definition in `playerMove` or `specialMove`. Use a stable ID and behavior ID; never a label condition. Every timing is a nonnegative integer, active intervals must fit the total duration. `utilityMove` rejects invalid intervals.
2. Select an existing trajectory or add a deterministic sampler in `geometry.ts`. Specify axes, grip, endpoint and radius. Keep body/prop collision on the CPU.
3. For a new behavior, implement its simulation side effect by ID and its pose presentation. Add all selectable slots to `moduleGuide`.
4. Add active-only, facing, lane/height/reach, swept-motion, per-target and cancel tests, plus a rendered matrix comparison when geometry changes. Run typecheck, logic tests, lint, production build and Playwright.

## Movement invariants

`movement.ts` centralizes dodge scale 2/3: ground X 8, Z 16/3; air vector 12. Durations remain .36/.32 seconds, invulnerability .25/.23 seconds. Neutral ground dodge chooses facing; directional ground dodge uses the input direction. Ground pose is a forward dash with afterimage, with no roll. Air direction, gravity, downward wavedash conversion and once-per-airtime limits remain. Horizontal travel scales exactly before action recovery; total vertical travel is approximate because gravity is unchanged.

Living actors clamp to Z ±3.8 immediately after displacement **before floor crossing**, and again after props and grabs. Outward velocity is removed. Rail-adjacent obstacle resolution selects a legal side rather than pushing through a rail. There is no depth ring-out. X ring-outs, downward crossing from above, under-platform falling, vertical blast zones and enemy/player recovery remain separate.
