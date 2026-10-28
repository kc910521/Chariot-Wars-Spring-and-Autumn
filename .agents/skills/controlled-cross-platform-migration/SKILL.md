---
name: controlled-cross-platform-migration
description: Plan and execute controlled incremental migrations between software projects, platforms, frameworks, languages, or runtimes. Use when porting a feature or branch from a source project to a target project, synchronizing platform implementations, or reviewing migration readiness. Prevents unauthorized migration, protects feature-branch scope, requires a migration plan, official documentation research, behavior and presentation parity, and verification.
---

# Controlled Cross-Platform Migration

## Mission

Migrate only the explicitly authorized scope from a source project to a target project. Preserve intended behavior, architecture, business logic, and presentation as closely as each platform permits. Never silently omit, weaken, or redesign functionality to make a migration easier.

This workflow is platform-neutral. Do not assume H5, WeChat Mini Games, Godot, Cocos Creator, JavaScript, or any particular repository layout.

## Non-negotiable rules

1. **No implicit migration.** Editing the source project does not authorize editing the target project. Do not migrate merely because a feature was implemented, a source branch changed, or migration seems useful.
2. **Separate source and target paths.** Load and confirm both absolute paths from project configuration. Never infer one path from the other or run commands in an unconfirmed repository. Before any write, verify the current working directory/repository root.
3. **Plan before target writes.** Produce a migration plan containing files, purpose, source/target differences, risks, documentation sources, test strategy, and branch strategy before changing target files.
4. **Respect authorization.** Wait for explicit user approval after presenting the plan unless the user has previously configured automatic migration for features that have passed the required readiness and validation gates. A plan is not approval.
5. **Source readiness gate.** A feature is not eligible for migration until the user confirms it is ready, or a configured automatic-readiness policy explicitly permits migration after all source tests and validation pass. Do not infer readiness from a successful build alone.
6. **Tiny-change exception.** If the complete migration scope is no more than 20 changed non-test lines, ask whether the user wants to migrate immediately without a separate manual source-verification wait. This is an offer, not automatic authorization. Tests, risk checks, branch isolation, and target verification are still required. If the user has already authorized automatic migration, follow that policy.
7. **No silent behavioral compromise.** If equivalent behavior, architecture, logic, or presentation cannot be preserved, stop and explain the exact trade-off. Ask the user before implementing a materially different result. Never silently drop a feature, change user-visible text/layout/animation/controls, or replace behavior with a placeholder.
8. **Research current technical facts.** For platform APIs, runtime constraints, build pipelines, packaging, store requirements, or framework-specific migration behavior, search current official documentation first. Prefer vendor-maintained docs and release notes. Cite URLs and state the access date in the plan. Community sources may supplement but must not replace official docs for critical claims. If web access is unavailable, say so and mark the relevant assumptions unverified.
9. **Verify, do not claim.** Run relevant tests/builds where available. Report commands and actual outcomes. Never say a test passed if it was not run. If execution is blocked, state the blocker and remaining verification.
10. **Protect user work.** Inspect Git status before changes. Do not discard, reset, stash, overwrite, commit, push, merge, rebase, or delete user work/branches unless the user explicitly authorizes that specific action. Never overwrite an existing target feature branch.
11. **Keep scope narrow.** Do not scan or inspect the target repository during routine source-only feature development unless needed for an explicitly requested migration or a specific blocker. This saves context and reduces accidental edits.
12. **Do not confuse textual similarity with parity.** Platform-specific syntax and APIs may differ. Compare behavior, contracts, state transitions, architecture, edge cases, accessibility/input, and visible output—not just line-by-line code.

## Configuration and initial discovery

Read `config/projects.example.yaml` as a template. If a real project configuration exists, use it. Otherwise, discover paths only from the user, current workspace, or unambiguous repository metadata. Do not guess absolute paths.

Record:
- source project absolute path and repository root;
- target project absolute path and repository root;
- source and target technology/platform/runtime versions when discoverable;
- default/base branch names;
- install, lint, test, build, run, and visual-test commands;
- source-to-target file mappings or exclusions, if known;
- feature readiness policy and migration authorization mode;
- how the target can be tested (simulator, emulator, browser, device, screenshot, or automated tests).

If a required path, branch, or repository identity is ambiguous, ask one concise question before any write. Confirm the two project roots separately in your response.


## Project Context Resolution — Mandatory

Before interpreting a development request or modifying any files, determine which project the user is referring to.

### 1. Project selection priority

Resolve the target project using the following priority:

1. **Explicit project reference in the current user message.**
   Examples: "modify the H5 version", "fix the WeChat Mini Game version", or an explicitly named repository.
2. **Unambiguous project reference in the current task context.**
   Use recent conversation context only when it clearly identifies the project the user is discussing.
3. **Ask the user when the intended project remains ambiguous.**

Never assume that the most recently modified, inspected, or migrated project is the intended project for the next request.

### 2. Mandatory clarification rule

If a request could reasonably refer to either the source project or the target project, and the intended project cannot be determined confidently from explicit instructions or unambiguous context, STOP and ask the user which project they mean.

For example, after migrating a feature from H5 to WeChat Mini Game, the user says:
"The movement speed is still wrong. Please fix it."

If both projects have a movement-speed implementation and the user has not identified which one to change, ask:

"Do you want me to fix the movement speed in the H5 source project or the WeChat Mini Game target project?"

Do not inspect or modify either project to guess the user's intent.

### 3. Project context is task-scoped

- Project context from a completed task does not automatically carry over as the target of a new task.
- Completing a migration does not make the target project the default project for subsequent development.
- A request to modify one project does not authorize changes to the other project.
- When the user explicitly establishes a project context for a continuing task, retain it while the task remains clearly continuous.
- If a later request introduces ambiguity, ask again rather than relying solely on the previous project selection.

### 4. Separate project selection from migration authorization

Knowing which project the user means does not authorize cross-project migration.

- A source-project request authorizes work on the source project only.
- A target-project request authorizes work on the target project only.
- A request to synchronize, port, or migrate changes across projects must follow the migration workflow, including planning, readiness checks, and required approval.
- Never automatically propagate a fix from one project to the other.

### 5. Minimize unnecessary questions

Do not ask when the current message explicitly identifies the project or the ongoing task unambiguously establishes it.

When clarification is necessary, ask one concise question naming the available projects. Wait for the answer before reading files, running project-specific commands, or making changes.


## Modes

Choose the mode that matches the user's request:

- **Source-only work:** Work only in the source project. Do not inspect or modify the target project unless necessary to answer a specific question.
- **Migration plan:** Inspect the authorized source scope and enough target context to produce a reliable plan. Do not write target files.
- **Migration execution:** Execute only after readiness and authorization gates pass.
- **Migration review:** Compare an existing target implementation with the authorized source scope and report parity gaps. Do not modify unless requested.
- **Configuration setup:** Establish project paths, branch/test commands, platform adapters, and policies. Do not migrate product features as a side effect.

## Required workflow

### Phase 0 — Resolve intent and readiness

Determine:
- What source feature, commit, or branch is in scope?
- Which target project and target platform?
- Is this source-only development, a plan, or an approved migration?
- Has the feature been manually accepted by the user?
- Is automatic migration explicitly enabled?
- What tests and visible behavior must remain equivalent?

If the user asks only to develop or fix the source project, stay source-only. Do not turn that task into a migration.

If readiness is unknown, ask whether the feature is ready for migration; do not assume. For a tiny change of at most 20 non-test changed lines, offer the documented shortcut to migrate without a separate manual source-verification wait, while retaining all other gates.

### Phase 1 — Inspect the source safely

1. Confirm the source repository root and current branch.
2. Inspect `git status --short`, current branch, and relevant diffs before editing or migration.
3. Do not overwrite uncommitted work. Distinguish user changes from changes created by the current task.
4. Identify the migration scope using the relevant branch diff or explicitly named commits/files. Do not use the entire source repository as the scope by default.
5. For a feature branch, identify its base branch and merge base. Use a source diff equivalent to `git diff <merge-base>...<feature-branch>` to identify the branch's changes. Also inspect relevant history when needed to understand intent.
6. If the branch base is unclear, the feature includes unrelated changes, or the diff contains uncommitted changes whose ownership is unclear, stop and ask before expanding scope.
7. Run the source tests/build relevant to the feature when readiness depends on technical validation. Report missing or failing checks honestly.

### Phase 2 — Research official documentation

Research only the technical questions that affect this migration, but research them before deciding implementation details.

Check relevant official documentation for:
- supported runtime/language/API features and version constraints;
- input, rendering, lifecycle, storage, networking, audio, assets, permissions, threading/async behavior, and platform APIs as applicable;
- project structure, build/export/package process, and deployment/store requirements;
- known incompatibilities, migration guides, deprecations, and relevant release notes.

Use exact official URLs, page titles, relevant findings, and access date in the plan. Prefer documentation for the target's actual configured version; if the version is unknown, state that and verify the current version. Do not claim to have browsed if browsing tools are unavailable.

### Phase 3 — Build the migration plan (no target writes)

Compare the authorized source diff with the target's current implementation and architecture. Read only the target files needed to understand corresponding code and integration points.

Use `templates/migration-plan.md`. The plan must include:

- source/target project roots and branch names;
- feature scope and source branch base/merge base;
- source readiness evidence and explicit authorization status;
- each expected changed/added/deleted target file, its purpose, and intended changes;
- key source/target differences, including APIs, syntax, lifecycle, input, state, rendering, asset loading, and build constraints where relevant;
- risks classified separately as **technical**, **logical/behavioral**, and **visual/presentation**;
- behavior and UI parity criteria;
- official documentation links and version assumptions;
- test/build/visual verification commands and expected evidence;
- branch creation strategy and rollback/safety considerations;
- unresolved questions or compromises requiring user decisions.

Do not start modifying target files until the plan is shown and authorization requirements are satisfied. If the user explicitly asked for plan-only, stop after the plan.

### Phase 4 — Authorization gate

Proceed only if one of the following is true:
- the user approves the displayed plan/scope; or
- the user has explicitly enabled automatic migration for this category of ready features, and the configured readiness gate has passed.

Automatic migration is not permission to:
- migrate an unverified or not-yet-accepted source feature;
- expand scope beyond the identified feature branch diff;
- overwrite existing branches or unrelated work;
- accept a material behavior or presentation change without asking;
- skip tests, review, or required official-documentation research.

If a required decision is unresolved, ask before continuing.

### Phase 5 — Create and verify the target branch

For incremental migration from a source feature branch:

1. Create a target feature branch with the **same name** as the source feature branch, based on the target project's configured base branch, unless the user explicitly requests a different mapping.
2. Check whether the branch already exists locally or remotely before creating it. If it exists, do not reset, overwrite, or silently reuse it. Inspect its status and ask how to proceed.
3. Confirm the target repository root and branch after checkout/creation.
4. Keep the source branch and target branch independent. Do not merge source code wholesale into the target repository.
5. Migrate only the authorized branch changes and their necessary dependencies. Do not import unrelated commits, unfinished features, or unrelated formatting/refactors.
6. If the source is on the default/base branch, define the exact migration boundary from the user request or a specific commit/range. Do not treat every change on the base branch as approved for migration.

If branch creation is unavailable or the environment cannot safely isolate changes, stop and explain the blocker.

### Phase 6 — Implement target changes

1. Apply the approved plan narrowly.
2. Preserve target-native conventions while retaining source behavior and architecture where practical.
3. Map platform-specific APIs explicitly. Do not perform blind text substitutions for lifecycle, input, async, rendering, storage, or networking differences.
4. Keep a traceable mapping between source changes and target changes. Explain necessary deviations.
5. Add or update target tests where practical, including edge cases and regression tests.
6. Do not edit source files as a side effect of target migration unless separately requested.
7. If implementation reveals a new material risk, missing dependency, or necessary behavior/presentation compromise not covered by the approved plan, stop and ask. Do not silently expand scope.

### Phase 7 — Verify parity and quality

Run applicable checks in the target project:
- formatting/lint/type checks;
- unit/integration tests;
- build/export/package;
- simulator/emulator/device checks;
- visual comparison using screenshots or a documented manual checklist;
- regression checks for neighboring features and platform-specific lifecycle/input cases.

Compare outcomes against the plan and parity criteria. Review the final target diff and ensure:
- no unrelated files or changes were included;
- no feature was omitted without approval;
- no visible UI/text/animation/control behavior changed silently;
- source and target branches and paths are correct;
- generated assets/configuration are intentional;
- no test is reported as passing without execution.

If a check fails, fix within the approved scope and rerun. If it cannot be fixed without a scope or behavior decision, stop and ask.

### Phase 8 — Final report

Use `templates/migration-report.md`. Report:
- source and target roots, branches, and migrated scope;
- changed files and purpose;
- necessary platform-specific differences and their justification;
- technical, behavioral, and visual parity status;
- official documentation consulted;
- tests/builds/visual checks with exact outcomes;
- unresolved issues, unrun checks, and user decisions needed;
- whether any commit/push occurred (normally neither unless explicitly requested).

Do not imply that the migration is complete if required verification remains outstanding.

## Efficiency rules

- During source-only work, do not scan the target project just to keep it synchronized.
- During migration planning, inspect the smallest target surface that can support a reliable plan.
- Reuse existing test commands and mapping documents; do not reread unrelated files.
- Load platform-specific references only when the current source/target pair requires them.
- Prefer a small explicit mapping table over repeated broad repository searches.
- Never sacrifice correctness or user approval merely to reduce context usage.
