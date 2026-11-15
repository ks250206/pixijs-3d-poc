# Verification record

Baseline: fresh `origin/main` `2108f94608e2054f8d68c5b879d4a32af4728412` (7 stages, 23 authored encounters, stage span 34, half width 14). Work was isolated from the root checkout. Node 26.13.1, pnpm 12.21.0, Vite+ 1.6.0, Pixi 8.23.0 / @pixi/3d 0.1.0. Dependency pins and the #6 single-worker, bounded CI viewport and 12-minute job limit are retained.

- Typecheck: passed.
- Logic: **134 tests / 9 files**, including ordinary-input completion of all seven stages and objective sectors 0/2/5. The finite bot budget is 15 simulated minutes to include the longer coordinated danger/recovery windows; the complete logic suite takes approximately one second locally.
- Lint: passed with no warnings.
- Production build: passed.
- Playwright: **16 tests**, including actual WebGL2 canvas pixel checks, graphics presets, desktop and mobile touch/menu layouts, all six weapon selections, keyboard actions, objectives/phase indicators, and scene resource replacement.
- Lance numerical evidence: both facings × forward/back/up/down aerial × three active samples. The actual visible tip primitive, trail endpoints and debug endpoints are transformed with Pixi matrices and compared against the **capsule used by collision**, not a second render-only calculation. Further phase cross/dash/falling-aerial comparisons cover both facings under translation.
- Independent Claude Opus 5.5 read-only review and focused recheck: findings addressed; reviewer reported 45/45 focused combat/diversity tests and confirmed transition immunity, cancel routing, player-attributed objective destruction and zero phase-motion tip drift. A final small contract fix omits reversed quick-jab whiff windows; emitted windows are tested for valid bounds.

Generated screenshots are local ignored artifacts under `test-results/screenshots/` and are also uploaded by the unchanged screenshot artifact step in CI:

- `lance-forward-capsule.png`
- `lance-mirrored-up.png`
- `lance-down-air.png`
- `relay-objective.png`
- `boss-overdrive.png`
- `boss-warning-low.png`
- Existing title, campaign scenery and mobile interaction screenshots.

These runs use Chromium's WebGL2 via SwiftShader. Physical GPU performance, WebGPU rendering and a physical gamepad are not claimed as verified. The engine uses authored capsule/body bounds rather than per-triangle skeletal collision. Every seeded chassis retains the same up-special recovery; exhaustive human balance testing of all seeds is outside this verification.

## Changed files

- `README.md`
- `docs/campaign-design.md`
- `docs/combat-architecture.md`
- `docs/verification.md`
- `src/game/combat/geometry.ts`
- `src/game/combat/moves.ts`
- `src/game/director.ts`
- `src/game/engine.ts`
- `src/game/loadouts.ts`
- `src/game/movement.ts`
- `src/game/objectives.ts`
- `src/game/patterns.ts`
- `src/game/types.ts`
- `src/main.ts`
- `src/render/motion.ts`
- `src/render/robot.ts`
- `src/render/scene.ts`
- `src/render/weapon.ts`
- `src/ui/hud.ts`
- `src/ui/styles.css`
- `tests/browser/game.spec.ts`
- `tests/campaign.test.ts`
- `tests/combat-architecture.test.ts`
- `tests/diversity.test.ts`
- `tests/encounters.test.ts`
- `tests/engine.test.ts`
- `tests/helpers/play.ts`
- `tests/weapons.test.ts`
