# Project Guidelines

## Build and Test

- Run the game from the repository root with `node scripts/serve.mjs 8000` (zero-dependency static server added for this repo), then open `http://localhost:8000`. `python3 -m http.server 8000` also works but its listen backlog is 5, so a cold load can occasionally drop one of the ~30 parallel module requests; a refresh recovers. ES modules are served over HTTP; opening `index.html` directly is not the documented workflow.
- There is no build step, package manifest, or lint command. Tests run directly through Node.
- Check one edited module with `node --check src/game/game.js` (replace the path as needed). Check all source modules with `find src -name '*.js' -exec node --check {} \;`.
- `node scripts/unit-test.mjs` covers the pure rules: derived stats, campaign pacing, collision, ballistics, blood caps, and the seeded PRNG. Extend it when changing those modules.
- `node scripts/smoke-test.mjs` boots the real `src/main.js` against a stub DOM, runs several hundred frames with movement and fire input, and fails on the first uncaught error or missing HUD update. The harness pins `?seed=1` so the run is frame-for-frame reproducible (`H5_SEED=<n> node scripts/smoke-test.mjs` explores another run), and asserts on live battle state through the `globalThis.__h5game` handle the game publishes. Use it for wiring regressions; still verify rendering and feel in a real browser over HTTP.
- Add `?seed=<number>` to any URL to replay a battle deterministically; the same seed produces the same battlefield, formations, and drops.
- `.github/workflows/checks.yml` runs the syntax check, unit tests, and smoke test on every push and pull request. Add new automated checks there rather than introducing a package manifest.

## Architecture

- `src/main.js` loads `src/game/game.js`, which is the composition root: it creates state, wires rendering, HUD, controls, screens, stage, shop, collision, combat, and projectile systems together, and starts `src/game/loop.js`.
- `src/game/loop.js` owns the `requestAnimationFrame` loop: it clamps delta time, isolates update/render failures, stops on the first error, and reports through the fatal-error banner (`#fatal-error` in `index.html`, wired in `game.js`).
- `src/game/state.js` separates persistent campaign data (equipment, horses, roster, gold, stage, seeded RNG) from per-battle state (enemies, projectiles, score, objectives). `src/game/stages.js` resets battle state while preserving campaign progression; a new run resets both.
- Keep balance data in `src/data/` and consume it in gameplay systems: `rules.js` holds numeric balance constants (base stats, damage conversions, projectile speeds, boss/objective cadence, spawn pacing, plus `effectRules` for impact effects), `equipment.js` defines item, horse, and personnel values plus the derived-stat helpers, `formations.js` defines enemy/boss data and formations, and `battlefields.js` defines battlefield data.
- Gameplay systems are split by responsibility: `collision.js` owns obstacle/terrain geometry, movement clamping, and line of sight; `player.js` handles steering and movement; `combat.js` handles player fire, crew attacks, damage, and dismounting; `units/enemies.js` handles enemy AI, collision, and the particle/dust helpers; `projectiles.js` handles ballistic flight and hit resolution; `blood.js` accumulates decals; `map.js` generates battlefields; `stages.js` handles campaign progression. `game.js` coordinates these systems and passes explicit callbacks.
- Projectile lifetime is solved from the arc (`solveTimeToGround`), never from `range / horizontalSpeed`: the old budget expired 10–30px short of the ground and silently culled arrows and stones in mid air with no impact. `range` only caps gravity-less legacy bullets. Every exit path of a shot must end in an effect — arrows run `burst()` and drop a `groundArrows` decal, stones call the wired `dust()` on ground, obstacle, and body impacts alike.
- Dust is tuned against the `#929d6d` ground fill: keep the palette light (`effectRules.dust.colors`) and give each particle a `maxLife`, because the renderer computes alpha as `life / (maxLife ?? effectRules.particleFadeSeconds)` and clamps it to 1 (an out-of-range `globalAlpha` is rejected by the canvas and freezes the fade instead).
- `src/render/renderer.js` draws the Canvas world and culls off-camera work; `src/ui/` binds static markup from `index.html` and manages DOM UI. `styles/game.css` owns presentation.

## Codebase Conventions

- Use browser-native JavaScript ES modules with explicit relative imports; there is no bundler or transpilation.
- Systems are composed through factory functions that receive shared state and callbacks. Follow that wiring pattern instead of adding new global state or importing the game composition root into a subsystem.
- Cross-system callbacks (combat ↔ enemies ↔ projectiles) are late-bound in `game.js` through `defer()`, which throws a descriptive error if a system is used before initialization. Add new wiring in the composition root rather than reintroducing hoisting-dependent helpers.
- Consume balance values from `src/data/rules.js` and the derived helpers in `src/data/equipment.js` (`calculateHullHealth`, `calculateMobilityMultiplier`, `calculateProtectionChance`, `calculateArrowDamage`, `calculateChariotCollisionDamage`, `calculateCrewSlots`, `getPlayerArrowCount`). Do not re-derive stat conversions inline in gameplay, HUD, or shop code.
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
