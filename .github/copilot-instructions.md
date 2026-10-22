# Project Guidelines

## Build and Test

- Run the game from the repository root with `python3 -m http.server 8000`, then open `http://localhost:8000`. ES modules are served over HTTP; opening `index.html` directly is not the documented workflow.
- There is no build step, package manifest, lint command, or automated test suite.
- Check one edited module with `node --check src/game/game.js` (replace the path as needed). Check all source modules with `find src -name '*.js' -exec node --check {} \;`.

## Architecture

- `src/main.js` loads `src/game/game.js`, which is the composition root and frame loop. It creates state and wires game, rendering, HUD, controls, screens, stage, and shop systems together.
- `src/game/state.js` separates persistent campaign data (equipment, horses, roster, gold, stage) from per-battle state (enemies, projectiles, score, objectives). `src/game/stages.js` resets battle state while preserving campaign progression; a new run resets both.
- Keep balance data in `src/data/` and consume it in gameplay systems: `equipment.js` defines stat, cost, horse, crew-slot, and personnel rules; `formations.js` defines enemy/boss data and formations; `battlefields.js` defines battlefield data.
- Gameplay systems are split by responsibility: `player.js` handles movement, `units/enemies.js` handles enemy AI and collision, `projectiles.js` handles ballistic movement and hit resolution, `map.js` generates battlefields, and `stages.js` handles campaign progression. `game.js` coordinates these systems.
- `src/render/renderer.js` draws the Canvas world; `src/ui/` binds static markup from `index.html` and manages DOM UI. `styles/game.css` owns presentation.

## Codebase Conventions

- Use browser-native JavaScript ES modules with explicit relative imports; there is no bundler or transpilation.
- Systems are composed through factory functions that receive shared state and callbacks. Follow that wiring pattern instead of adding new global state or importing the game composition root into a subsystem.
- Keep game rules and configurable prices in data modules, then use those values in both UI descriptions/previews and gameplay calculations. Avoid duplicating balance constants in the renderer or event handlers.
- Treat `campaign` as run-persistent and `state` as battle-scoped. When adding a field, decide explicitly whether it resets on stage restart, persists between stages, or resets for a new run; update the stage reset and new-run paths consistently.
- Keep Canvas drawing in the renderer and DOM structure in `index.html`/`src/ui/`; `src/ui/elements.js` is the selector registry for static DOM elements.
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
