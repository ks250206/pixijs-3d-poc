# Combat data and motion

The engine is a CPU-only simulation. `src/game/combat/moves.ts` owns the typed `MoveDefinition`: stable ID, behavior ID, pose identity, integer 60 Hz startup/active/recovery, shape trajectory and dimensions, damage/knockback, and cancel windows. `playerMove` resolves all six weapon styles, combo stage, charge and rolled normal module. `specialMove` resolves every advertised special slot. Labels are display text; neither simulation nor rendering dispatches on `attack.name`.

`update` prepares attack timing and velocities, integrates actors, resolves floor/props/grabs/depth rails, then checks collisions. `AttackVisual.collision` stores the exact checked world capsule, and rendering consumes that snapshot. Moving phase/dash/falling aerial browser regressions compare it to the actual mesh rather than recomputing a render-only pose.

`beginMove` creates one swing record with a per-target hit set. The engine and renderer consume the same resolved definition. Projectiles have separate ownership, hit memory, lifetime and pierce budgets; they do not reuse the melee capsule. A missed grab is an explicit non-hitting `none` behavior with zero active frames, never a distant timing sentinel.

## Coordinate and geometry contract

World +X is stage right, +Y is up, +Z is the front lane. Facing mirrors only X. `sampleWeapon` returns world-space capsule endpoints for the selected frame. Up and down attacks change elevation, never silently repurpose depth Z. The lance has a narrow shaft/tip capsule, extends and retracts with the motion, and cannot hit a rear fighter on a forward thrust. Its 1.35 multiplier requires contact on the final 24% of the capsule, including vertical attacks; horizontal distance alone is insufficient.

`geometry.ts` measures exact segment-to-body-box distance. Body bounds include the full scaled torso/head height of the boss. Sweeps clamp to the active interval, sample adaptively according to endpoint travel / capsule radius, and check endpoint edges. Prior actor transforms refresh before every integration step, including windup. Collision is independent of the GPU. The shape is an authored gameplay approximation, not per-triangle skeletal collision.

`render/weapon.ts` draws a unit +Y weapon whose tip is exactly local `(0,1,0)`. Its transform comes from the authoritative world segment; the arm uses a CPU grip solve to stay connected. Melee weapons and trails use these endpoints. Centered debug/trail cubes are positioned at the segment midpoint. Browser tests compare the actual Pixi world matrix of the tip, trail and debug endpoints against numerical simulation samples for mirrored forward/back/up/down lance aerials. The test measures geometry, not just timing or shared function calls.

Training's **HITBOX / 判定表示** button shows active weapon segments/endpoints and body heights in every graphics preset. The green thick line represents the capsule axis/radius; it is not a full translucent body hull. Startup/recovery have no live weapon overlay.

## Cancels

Normals permit attack/special/jump/dodge cancels after a confirmed fighter hit and the authored frame threshold. Whiffs permit only a late recovery dodge when enough recovery remains; very short quick jabs have no whiff cancel. Empty/reversed windows are omitted. Smashes and utility/enemy moves retain their recovery. Cancel eligibility is checked before discarding the old move, including special cooldown, remaining jumps, one air dodge per airtime, and used up-special recovery. Hurt/grab states cannot bypass those gates. Only the single approved cancel action is routed to execution, even with simultaneous buttons. Every new swing gets a fresh hit set; every projectile retains its own hit set.

## Add a move

1. Add/adjust the pure definition in `playerMove` or `specialMove`. Use a stable ID and behavior ID; never a label condition. Every timing is a nonnegative integer, active intervals must fit the total duration. `utilityMove` rejects invalid intervals.
2. Select an existing trajectory or add a deterministic sampler in `geometry.ts`. Specify axes, grip, endpoint and radius. Keep body/prop collision on the CPU.
3. For a new behavior, implement its simulation side effect by ID and its pose presentation. Add all selectable slots to `moduleGuide`.
4. Add active-only, facing, lane/height/reach, swept-motion, per-target and cancel tests, plus a rendered matrix comparison when geometry changes. Run typecheck, logic tests, lint, production build and Playwright.

## Movement invariants

`movement.ts` centralizes dodge scale 2/3: ground X 8, Z 16/3; air vector 12. Durations remain .36/.32 seconds, invulnerability .25/.23 seconds. Neutral ground dodge chooses facing; directional ground dodge uses the input direction. Ground pose is a forward dash with afterimage, with no roll. Air direction, gravity, downward wavedash conversion and once-per-airtime limits remain. Horizontal travel scales exactly before action recovery; total vertical travel is approximate because gravity is unchanged.

Living actors clamp to Z ±3.8 immediately after displacement **before floor crossing**, and again after props and grabs. Outward velocity is removed. Rail-adjacent obstacle resolution selects a legal side rather than pushing through a rail. There is no depth ring-out. X ring-outs, downward crossing from above, under-platform falling, vertical blast zones and enemy/player recovery remain separate.
