# Controlled Cross-Platform Migration Skill

A platform-neutral Agent Skill for controlled, incremental migrations between source and target projects.

## Contents

- `SKILL.md`: core workflow and safety rules
- `config/projects.example.yaml`: project roots, test commands, authorization policy
- `templates/migration-plan.md`: required pre-write plan
- `templates/migration-report.md`: verification and completion report

## Quick setup

1. Put this skill folder in a location your agent supports.
2. Copy `config/projects.example.yaml` to a private project configuration and fill in the actual absolute paths, branches, versions, and commands.
3. Keep the source and target roots separate and verify them before the first migration.
4. Start with `authorization_mode: safe_default`.
5. Ask the agent to configure the project pair first; do not ask it to migrate a feature in the same setup step.
6. For a migration, ask the agent to prepare a plan first. Review the plan and explicitly approve before target writes.

## Portability notes

The `SKILL.md` follows the open Agent Skills folder convention. Discovery paths and supported tools differ among hosts, so use the host's documented skill directory or import mechanism. An agent must have repository/file access, shell access for Git and tests, and web access to perform the full workflow. A skill cannot grant missing capabilities by itself.

The YAML config is a human-readable template, not guaranteed to be automatically parsed by every agent host. The agent should read it as project configuration; for stricter enforcement, add host-specific scripts/hooks that validate repository roots and branch state before writes.
