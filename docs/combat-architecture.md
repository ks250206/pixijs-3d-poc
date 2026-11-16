# Combat data and motion

The engine is a CPU-only simulation. `src/game/combat/moves.ts` owns the typed `MoveDefinition`: stable ID, behavior ID, pose identity, integer 60 Hz startup/active/recovery, shape trajectory and dimensions, damage/knockback, and cancel windows. `playerMove` resolves all six weapon styles, combo stage, charge and rolled normal module. `specialMove` resolves every advertised special slot. Labels are display text; neither simulation nor rendering dispatches on `attack.name`.

`update` prepares attack timing and velocities, integrates actors, resolves floor/props/grabs/depth rails, then checks collisions. `AttackVisual.collision` stores the exact checked world capsule, and rendering consumes that snapshot. Moving phase/dash/falling aerial browser regressions compare it to the actual mesh rather than recomputing a render-only pose.

`beginMove` creates one swing record with a per-target hit set. The engine and renderer consume the same resolved definition. Projectiles have separate ownership, hit memory, lifetime and pierce budgets; they do not reuse the melee capsule. A projectile confirms only its originating swing while that exact swing is still current; a delayed old shot cannot grant the next move a hit cancel. A missed grab is an explicit non-hitting `none` behavior with zero active frames, never a distant timing sentinel.

## Coordinate and geometry contract

World +X is stage right, +Y is up, +Z is the front lane. Facing mirrors only X. `sampleWeapon` returns world-space capsule endpoints for the selected frame. Up and down attacks change elevation, never silently repurpose depth Z. The lance has a narrow shaft/tip capsule, extends and retracts with the motion, and cannot hit a rear fighter on a forward thrust. Its 1.35 multiplier requires contact on the final 24% of the capsule, including vertical attacks; horizontal distance alone is insufficient.

`geometry.ts` measures exact segment-to-body-box distance. Body bounds include the full scaled torso/head height of the boss. Sweeps clamp to the active interval, sample adaptively according to endpoint travel / capsule radius, and check endpoint edges. Prior actor transforms refresh before every integration step, including windup. Collision is independent of the GPU. The shape is an authored gameplay approximation, not per-triangle skeletal collision.

`render/weapon.ts` draws a unit +Y weapon whose tip is exactly local `(0,1,0)`. Its transform comes from the authoritative world segment. The skeleton follows that segment: IK places the gripping hand on it, and no arm or weapon mesh is scaled to stay connected (see [Skeleton and motion](#skeleton-and-motion)). Melee weapons and trails use these endpoints. Centered debug/trail cubes are positioned at the segment midpoint. Browser tests compare the actual Pixi world matrix of the tip, trail and debug endpoints against numerical simulation samples for mirrored forward/back/up/down lance aerials. The test measures geometry, not just timing or shared function calls.

Training's **HITBOX / 判定表示** button shows active weapon segments/endpoints and body heights in every graphics preset. The green thick line represents the capsule axis/radius; it is not a full translucent body hull. Startup/recovery have no live weapon overlay.

## Skeleton and motion

Each humanoid `RobotView` is a set of rigid bones: hips, chest, head, upper arms, forearms, thighs, shins and feet. The bones are direct children of the robot root; every frame the CPU-solved skeleton sets each bone's position and quaternion in rig space. Bone lengths are constant and no mesh is scaled to reach a target. Drones keep their simple non-skeletal bob and rotor animation.

The rig layer, `src/render/rig/`, is renderer-free TypeScript and runs in Node unit tests. Rig space is the actor's own unscaled space: +Z forward, +Y up, +X the robot's right hand, with `rig = Ry(−yaw)·(world − actor)/scale` (Y is measured from `actor.y`). `RigSpec` (`skeleton.ts`) holds the joint layout and mirrors the box meshes in `RobotView`; heavy and boss kinds are wider.

`RigAnimator.update` runs once per frame per actor:

1. **Authored pose** (`poses.ts`). `statePose` returns named scalar channels (`CHANNELS`). Hands are offsets from their shoulder in the chest frame; feet are rig-space sole targets; `plant` says whether the feet should be anchored. Attack poses still come from the existing `attackMotion` channels in `motion.ts`, mapped onto hand targets by `armDirection`.
2. **Blending.** A new state, a different move, an airborne change or a restarted attack inertializes from the previous output: the difference to the new pose decays over a short state-dependent time (`blendTime`, about 0.03–0.16 s). Hip yaw takes the short way round. `plant` is never blended. The chest's turn rate and a free hand's target speed are bounded, so a two-frame wind-up cannot snap them.
3. **Foot planting** (`gait.ts`). `FootPlanter` measures real displacement, so knockback, dashes and conveyors all count as movement; a teleport-sized jump releases the anchors instead of producing a stride. Standing feet stay anchored in world space and take corrective steps one at a time when they drift from the pose. Moving feet follow a phased run cycle whose cadence and duty follow measured speed; each foot lands ahead so it passes under the hip in mid-stance. Airborne, sliding (dash, rush, phase, leap), dodge, hurt, spin and mounted poses drive the feet directly. A pitched foot rolls about its ground contact — the heel at strike, the toe at push-off — so the contact point never slides; a stance foot left out of the leg's reach lifts early.
4. **Solve** (`skeleton.ts`). `solveRig` applies FK for hips, chest and head, sinks the hips until planted legs can reach their anchors, then solves arms and legs with analytic two-bone IK (`ik.ts`) and pole vectors from the pose. An out-of-reach target moves the end joint along the root→target ray; it never stretches a bone. Chains stop at 99.5% extension.

`RobotView` applies the result with `root.quaternion = Ry(yaw)·Rx(tumble)`. The displayed yaw eases toward the facing heading, so turning round passes through the camera-facing side instead of snapping 180°.

### Weapon follows the capsule

`AttackVisual.collision.capsule` from `sampleWeapon` remains the only source of weapon geometry. The weapon mesh, trail and debug overlay use it unchanged; the skeleton is never used to position the weapon. During a player weapon attack, the capsule is converted to rig space and becomes a `WeaponConstraint`:

- The main hand holds a point on the segment chosen by `gripOnSegment`. The grip slides along the shaft within the per-weapon range (`GRIPS` in `animator.ts`) to stay within arm reach. If the shaft is still out of reach, the trunk is carried toward it and planted legs re-sink; when the legs take the lift back it steps in under the shaft instead. A shaft the body truly cannot reach leaves the hand at full stretch toward the grip and is reported as `grip.miss`.
- Two-handed weapons (pile, lance, cannon, scythe) add an off hand at a fixed spacing along the shaft. It releases smoothly when the shaft swings out of its reach, and `grip.off` is set only while it is exactly on the shaft. Razor combo hits alternate the leading hand.
- Hands entering or leaving a constraint ease across with a decaying offset. Catching a weapon — including the next one in a chained attack — is an S-curve timed against the wind-up and is exactly finished when the hit frames begin; letting go is a gentle decay.
- Ranged and unarmed player behaviors (`none`, `area`, `projectile`, `cannon`, `mortar`) use no constraint.

Enemies have no weapon mesh. Their right arm aims at the capsule tip, or at their aim point for ranged attacks, extending through the windup. Between attacks, the player's idle weapon props ride the forearms and are hidden while the authoritative weapon is shown. Collision code and move data are untouched by the rig, so gameplay is unchanged.

### Diagnostics

`RobotView.rigDiagnostics()` and `GameScene.rigDiagnostics(actorId)` return joint world positions (shoulders, elbows, hands, hips, knees, ankles, soles) read back from Pixi's real transforms, together with the solved `RigFrame` and `RigSpec`. Browser tests compare those against bone lengths, the authoritative capsule and planted anchors. They are read-only and do not drive animation.

### Add or change a pose

1. Edit the channels in `poses.ts` (`statePose`, `carry`, `locomotion`, `attack`). Express hands relative to the shoulder in the chest frame and feet as rig-space soles; set `plant = 0` only when the feet must leave their anchors.
2. Never position the weapon from the skeleton. Change weapon geometry in `geometry.ts`; change only the grip range in `GRIPS` if the hands hold it badly.
3. Add invariants to the rig tests (`tests/rig-solver.test.ts`, `tests/rig-gait.test.ts`, `tests/rig-animator.test.ts`): rigid bone lengths, hand on the segment, no foot sliding while planted, continuity across the blend, every enemy kind.

### Limits

Robots are rigid-part hierarchies: no skinning or glTF. There is no wrist joint; the hand is part of the forearm. Foot planting assumes the flat `y = 0` arena floor. Collision still uses authored capsules and body boxes, not the skeleton. Per-weapon authored windup, follow-through and weight shift are planned for the next change; this foundation reuses the existing attack channels.

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
