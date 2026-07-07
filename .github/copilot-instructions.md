# Copilot Instructions

## Monorepo Structure

This is a **Turborepo + npm workspaces** monorepo hosting multiple apps and packages with mixed tech stacks.

```
packages/               # All apps and shared packages
  <group>/              # Optional semantic grouping (e.g., apps/, libs/, tools/)
    <name>/             # Individual package with its own package.json
.specify/               # SpecKit AI workflow tooling
.opencode/              # OpenCode AI assistant commands
```

Packages may be organized flat (`packages/<name>/`) or grouped by domain/type (`packages/<group>/<name>/`). Each package is independently deployable with its own `package.json`.

## Build, Test, and Lint

Run from the repo root via Turborepo:

```bash
npm run build          # Build all packages
npm run test           # Test all packages
npm run lint           # Lint all packages

# Scoped to a single package
npm run build --workspace=packages/<name>
npm run test --workspace=packages/<name>
```

Each package may use a different test runner — check the package's own `package.json` for the exact scripts and how to run a single test file.

Shared packages are referenced as workspace dependencies:
```json
"@commise/<name>": "*"
```

## AI-Driven Development Workflow (SpecKit)

Features are developed using SpecKit's spec-driven workflow via OpenCode slash commands:

```
/speckit.specify <description>  →  creates branch + specs/<branch>/spec.md
/speckit.plan                   →  generates specs/<branch>/plan.md
/speckit.tasks                  →  generates specs/<branch>/tasks.md
/speckit.analyze                →  read-only cross-artifact consistency check
/speckit.implement              →  executes tasks phase by phase
```

Feature artifacts live in `specs/<branch-name>/`. Branch naming: `001-feature-name` (sequential) or `20260319-143022-feature-name` (timestamp).

The **Product Forge** extension (`/speckit.product-forge.*`) adds a full product discovery pipeline (problem discovery → research → product spec → bridge to SpecKit) for features that need it before the spec step.

Project-wide principles are in `.specify/memory/constitution.md`. During `/speckit.analyze`, constitution violations are always **CRITICAL** and must be resolved in the artifacts — not by reinterpreting the constitution.
