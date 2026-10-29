# Project Guidelines

## Build and Test

- Run the game from the repository root with `node scripts/serve.mjs 8000` (zero-dependency static server added for this repo), then open `http://localhost:8000`. `python3 -m http.server 8000` also works but its listen backlog is 5, so a cold load can occasionally drop one of the ~30 parallel module requests; a refresh recovers. ES modules are served over HTTP; opening `index.html` directly is not the documented workflow.
- There is no build step, package manifest, or lint command. Tests run directly through Node.
- Check one edited module with `node --check src/game/game.js` (replace the path as needed). Check all source modules with `find src -name '*.js' -exec node --check {} \;`.
- `node scripts/unit-test.mjs` covers the pure rules: derived stats, campaign pacing, collision, ballistics, blood caps, and the seeded PRNG. Extend it when changing those modules.
- `node scripts/smoke-test.mjs` boots the real `src/main.js` against a stub DOM, runs several hundred frames with movement and fire input, and fails on the first uncaught error or missing HUD update. The harness pins `?seed=1` so the run is frame-for-frame reproducible (`H5_SEED=<n> node scripts/smoke-test.mjs` explores another run), and asserts on live battle state through the `globalThis.__h5game` handle the game publishes. Use it for wiring regressions; still verify rendering and feel in a real browser over HTTP.
- Add `?seed=<number>` to any URL to replay a battle deterministically; the same seed produces the same battlefield, formations, and drops. `?rings=10,40,30,20` replaces the battlefield's four band ratios for one boot (`src/data/rings.js`), so a shape can be tried without editing the table.
- `.github/workflows/checks.yml` runs the syntax check, unit tests, and smoke test on every push and pull request. Add new automated checks there rather than introducing a package manifest.

## Architecture

- `src/main.js` loads `src/game/game.js`, which is the composition root: it creates state, wires rendering, HUD, controls, screens, stage, shop, collision, combat, and projectile systems together, and starts `src/game/loop.js`.
- `src/game/loop.js` owns the `requestAnimationFrame` loop: it clamps delta time, isolates update/render failures, stops on the first error, and reports through the fatal-error banner (`#fatal-error` in `index.html`, wired in `game.js`).
- `src/game/state.js` separates persistent campaign data (equipment, horses, roster, gold, stage, seeded RNG) from per-battle state (enemies, projectiles, score, objectives). `src/game/stages.js` resets battle state while preserving campaign progression; a new run resets both.
- Keep balance data in `src/data/` and consume it in gameplay systems: `rules.js` holds numeric balance constants (base stats, damage conversions, projectile speeds, boss/objective cadence, spawn pacing, plus `effectRules` for impact effects), `equipment.js` defines item, horse, and personnel values plus the derived-stat helpers, `formations.js` defines enemy/boss data and formations, and `battlefields.js` defines battlefield data.
- Gameplay systems are split by responsibility: `collision.js` owns obstacle/terrain geometry, movement clamping, and line of sight; `player.js` handles steering and movement; `combat.js` handles player fire, crew attacks, damage, and dismounting; `aim.js` picks the tap shot's target; `units/enemies.js` handles enemy AI and collision; `particles.js` owns the particle lifecycle (build, advance, prune, count) that every emitter shares, and `trails.js` owns the speed-scaled ground dust behind anything travelling; `projectiles.js` handles ballistic flight and hit resolution; `blood.js` accumulates decals; `map.js` generates battlefields; `stages.js` handles campaign progression. `game.js` coordinates these systems and passes explicit callbacks.
- Projectile lifetime is solved from the arc (`solveTimeToGround`), never from `range / horizontalSpeed`: the old budget expired 10–30px short of the ground and silently culled arrows and stones in mid air with no impact. `range` only caps gravity-less legacy bullets. Every exit path of a shot must end in an effect — arrows run `burst()` and drop a `groundArrows` decal, stones call the wired `dust()` on ground, obstacle, and body impacts alike.
- The player's bow has two releases, both driven by the same `updatePlayerFire(delta, held)` call from the frame loop (`controls.js` in the browser, `touch.js` in the 小游戏): holding accrues `state.fireHold`, releasing at `>= playerVolley.holdSeconds` looses the fixed long arc, and anything shorter is a tap. A tap asks `src/game/aim.js` (`selectAimTarget`) for the nearest enemy inside `tapConeCosine` of the nose, within `tapRange`, with a clear line, then `firePlayerVolley({ aimX, aimY })` turns the fan onto that bearing and solves the elevation for the distance — the fixed 0.42 rad arc overshot a close target by ~200px. The helper only picks a bearing (no homing), an empty cone still fires unassisted so a tap never wastes an arrow, and `tapRange` stays below the drawn arc's ~400px so a tap can never outrange a drawn shot. Do not fire on the press: `state.fireHold > 0` with `player.cooldown === 0` is the expected state of a drawn bow, and the foot branch must keep swinging on press and clear the meter.
- Dust is tuned against the floor's `groundVisual.base` (a dry olive in `data/elements.js`), not against a literal: keep the palette light (`effectRules.dust.colors`) and give each particle a `maxLife`, because the renderer computes alpha as `life / (maxLife ?? effectRules.particleFadeSeconds)` and clamps it to 1 (an out-of-range `globalAlpha` is rejected by the canvas and freezes the fade instead).
- The ground trail (`trails.js`, `effectRules.trail`) is decoration and must not steer the fight: no `random()` or `Math.random()` draws at all (the lateral offset and the palette step alternate), speed is measured from the unit's own displacement (`distance / delta`, accepted only when `dot(displacement, nose) > 0`, so standing still, reversing and being knocked back leave no wake), a single frame's `maxStep` jump is treated as a teleport, and `maxLive` plus the off-screen cull bound the list. New emitters call `spawnParticle()` from `game/particles.js` instead of pushing a literal, and every particle carries its own `kind` and `maxLife`.
- Chariot steering keeps a single facing: `player.angle` is authoritative for firing, crew placement, and ramming, while the travel vector rides the rear axle (`player.angle + Math.PI`) inside the reverse lane. That lane (`isReverseWithoutTurning` in `player.js`) is gated by `CHARIOT_CONTROL_CONFIG`: below `reverseLowSpeedThreshold`, a stick magnitude at most `reverseMaxInputMagnitude` pointing at least `reverseAngleThreshold` behind the nose backs the chariot up at no more than `reverseMaxSpeed`, and the nose yaws toward the bearing opposite the stick at `reverseSteerFactor` × `maxTurnRate`, so a diagonal push curves in over ~1.1s instead of snapping. Keep `reverseLowSpeedThreshold` above `reverseMaxSpeed` (otherwise the lane flickers into turning) and `reverseMaxSpeed` below the 85 px/s ram threshold. Tail-steering can never push the chariot out of the lane because aligning the nose *increases* `|angleDifference|`; a stick exactly behind the nose leaves a sub-ulp gap and the angle write is skipped, so straight reversing keeps `player.angle` bit-identical. Keyboard input always contributes magnitude 1, so the lane is joystick-only by construction.
- `src/render/renderer.js` draws the Canvas world and culls off-camera work; the floor under it is its own painter (`src/render/ground.js`, palette in `groundVisual`), and that floor carries no grid: its mottling and grass flecks are hashed from world coordinates with `hashNoise` (never `Math.random`), so a frame repaints identically and a `H5_TRACE_DRAW` digest stays comparable. The world pass paints floor → terrain → stains/stumps/obstacles → bodies → effects → clouds **last** (`drawSky()`): a cloud is translucent by design, so it can cross the field without hiding anything, while a body painted after it would put a canopy in front of the sky. Nothing in the world is drawn after the sky — a new layer belongs before it, and a unit test asserts exactly two paint calls follow the cloud's own fill (its body and its rim). `src/ui/` binds static markup from `index.html` and manages DOM UI. `styles/game.css` owns presentation.
- The shop is layered like the battlefield but is now one page on one canvas: `ui/shop-screen.js` owns the host (backing store, `min(devicePixelRatio, 2)`, one transform onto 960-wide view units, the page's own animation frame, and the pointer router that turns client pixels into view units), `ui/shop.js` paints a whole frame from campaign data (header, tabs, info block, rows, buy buttons, notice, footer) and registers every hit rect with that router, `ui/shop-dossier.js` paints the left column (five-axis chart, team, and the crew tab's camp fire), and `ui/shop-scene.js` draws the rig and the camp fire inside a rect, returning the pixels it covered. Pure geometry (rows, buy buttons, radar axes, the rotated extent the rig is fitted into, the seats around the fire) lives in `ui/shop-layout.js` so the paint, the hit test and the tests read one set of numbers; `ui/theme.js` holds the palette and font stacks and `ui/widgets.js` the shared canvas primitives. Team colours come from `spritePalette` in `render/sprites.js`, never from a local literal. Nothing in the page holds a copy of the team: every frame is derived from `campaign` plus `pressedId`/`pinnedId`, which is what makes a preview unable to outlive the frame that drew it, and a tap is delivered only to the target whose key was under the finger when it went down. The roster keeps its dead, but the dossier draws only the living (`alive !== false`). Item descriptions are never repeated per row: the shop has one info block (standing rule, then the pressed or pinned item's copy), the pin is recorded before the purchase runs so the next frame can paint it, and a tab switch clears it. A notice is both painted above the footer and announced once through the `#shop-live` `aria-live` region.

## Codebase Conventions

- Use browser-native JavaScript ES modules with explicit relative imports; there is no bundler or transpilation.
- Systems are composed through factory functions that receive shared state and callbacks. Follow that wiring pattern instead of adding new global state or importing the game composition root into a subsystem.
- Cross-system callbacks (combat ↔ enemies ↔ projectiles) are late-bound in `game.js` through `defer()`, which throws a descriptive error if a system is used before initialization. Add new wiring in the composition root rather than reintroducing hoisting-dependent helpers.
- Consume balance values from `src/data/rules.js` and the derived helpers in `src/data/equipment.js` (`calculateHullHealth`, `calculateMobilityMultiplier`, `calculateProtectionChance`, `calculateArrowDamage`, `calculateChariotCollisionDamage`, `calculateCrewSlots`, `getPlayerArrowCount`, `calculateChariotKit`, `hasMaxedAxleCap`). Do not re-derive stat conversions inline in gameplay, HUD, or shop code.
- Use `campaign.random` (seeded Mulberry32 from `src/utils/random.js`) for anything that affects gameplay, so battles remain reproducible. `Math.random()` is only acceptable for purely cosmetic jitter. `createRandomSeed()` honours a `?seed=<number>` URL parameter, so never hard-code a seed in gameplay code.
- Wire path-dependent randomness late-bound: `game.js` passes `random: () => campaign.random()` to `createEnemies` because `createBattle()` re-seeds the stream for every battle, and a generator captured at wiring time would replay the previous battle.
- `globalThis.__h5game` (set in `game.js`) exposes `state`, `player`, `campaign`, `world`, and `view` for QA scripts and browser probes. It is read-only by convention: gameplay code must never read from it.
- Keep game rules and configurable prices in data modules, then use those values in both UI descriptions/previews and gameplay calculations. Avoid duplicating balance constants in the renderer or event handlers.
- Treat `campaign` as run-persistent and `state` as battle-scoped. When adding a field, decide explicitly whether it resets on stage restart, persists between stages, or resets for a new run; update the stage reset and new-run paths consistently.
- Keep Canvas drawing in the renderer and DOM structure in `index.html`/`src/ui/`; `src/ui/elements.js` is the selector registry for static DOM elements and throws when a required element is missing. Cull off-camera drawing in the renderer instead of skipping simulation.
- Keep all user-facing copy in `src/i18n/locales.js` for both `zh-CN` and `en`; use stable translation keys from HTML, DOM UI, and Canvas rendering. Use `translate()` for dynamic text, and refresh locale-dependent UI without resetting game state.
- Keep shared pure helpers in focused modules under `src/utils/` only when reused; use descriptive names that state the domain and behavior (for example, `calculateChariotStats` and `circleIntersectsObstacle`).
- Enemy damage and defeat effects are centralized in `createEnemies`'s `damageEnemy`; route weapon and collision damage through it so immunity, score, blood, loot, and defeat handling remain consistent.
- Follow the existing formatting: two-space indentation, semicolons, and double-quoted JavaScript strings.

## Coding Principles
1. **Keep it simple.** Choose the simplest solution that meets the requirements. Avoid unnecessary complexity and premature optimization.

2. **Prioritize readability.** Use descriptive names, clear control flow, consistent formatting, and straightforward logic.

3. **Abstract appropriately.** Extract reusable logic when it improves clarity and maintainability. Avoid speculative abstractions and unnecessary design patterns.

4. **Follow single responsibility.** Each function and module should have one clear, cohesive purpose.

5. **Avoid duplication.** Reuse existing implementations and maintain a single authoritative implementation of each business rule.

6. **Separate concerns.** Keep game logic, state management, rendering, UI, input handling, and persistence appropriately separated.

7. **Maintain a single source of truth.** Each piece of game state must have a clear authoritative owner. Avoid duplicated or independently synchronized state.

8. **Keep dependencies explicit.** Avoid hidden global state, unnecessary coupling, and implicit dependencies between modules.

9. **Make focused changes.** Implement one well-defined task at a time. Avoid modifying unrelated code or rewriting working systems without justification.

10. **Preserve existing behavior.** Understand the affected code and its dependencies before making changes. Maintain backward compatibility unless a change is intentional.

11. **Follow existing conventions.** Reuse the project's established architecture, naming, formatting, and module patterns.

12. **Handle errors and edge cases.** Validate external inputs, handle expected failures, and provide useful diagnostics for unexpected errors.

13. **Test behavior.** Verify new functionality, important edge cases, and existing behavior affected by changes.

14. **Refactor incrementally.** Improve code structure when necessary, keeping refactoring small and behavior-preserving.

15. **Optimize based on evidence.** Prioritize correctness and clarity. Optimize performance when measurements or concrete requirements justify it.

16. **Document intent.** Explain non-obvious decisions, constraints, and invariants. Avoid redundant comments.

**Decision rule:** When choosing between two solutions that satisfy the requirements, prefer the one that is easier to understand, test, debug, and modify.

## Git Workflow

- **Never push to `main` or `master`.** Creating commits is fine; publishing them is the repository owner's action. This holds for this repo and for the 小游戏 port in `~/WeChatProjects/chariot-wars`, which carries the same gameplay code under a `main` branch.
- Never `git push` without being asked, on any branch. Finish by reporting the new commit hash and the branch's ahead/behind state, so the owner can decide when to publish.
- Stage only the files the change is actually about; leave unrelated working-tree edits out instead of sweeping them in with `git commit -a`. Keep the existing commit style: a lowercase subject with a `prefix:` when it applies, then short body paragraphs explaining why.
- Do not rewrite published history (`reset --hard`, `commit --amend`, force-push) on a branch that has an upstream.
