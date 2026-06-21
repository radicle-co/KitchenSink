<!--
SYNC IMPACT REPORT
==================
Version change: 1.2.0 → 1.3.0

Modified principles: N/A

Added sections:
  - Quality Gates → Release Readiness Gate (Non-Negotiable)
    (three-condition rule: all Test Case IDs mapped, all scenarios executed or
     waived with justification, waivers.md present; supersedes auto-generated
     audit report status; enforced by specs/governance-rules.md GR-001)

Removed sections: N/A

Templates updated:
  ⚠ v-model/release-audit-report.md (all features) — MUST carry AUDIT INTEGRITY
     NOTICE and BLOCKED status until all three release readiness conditions are met.

Follow-up TODOs:
  - Update plan/tasks templates to include Release Readiness Gate check.
  - Audit all existing release-audit-report.md files for RELEASE READY claims
    (completed 2026-05-10 — all corrected to BLOCKED).
  - Create docs/api-conventions.md (GR-002 prerequisite).
  - Create docs/offline-strategy.md (GR-005 prerequisite).
  - Create specs/cross-feature-FR-index.md (GR-003 prerequisite).

Version change: 1.1.0 → 1.2.0

Modified principles: N/A

Added sections:
  - Principle VIII. Cross-Platform Parity and Code Sharing
    (lockstep web+mobile release, parallel development, shared-code-first,
     `.native.*` colocation as the single canonical convention)

Removed sections: N/A

Templates updated:
  ⚠ .specify/templates/plan-template.md  — Constitution Check gate SHOULD be
     updated to reference Principle VIII (web/mobile parity + `.native.*`).
  ⚠ .specify/templates/tasks-template.md — Task generation SHOULD enforce paired
     web + mobile tasks for every user-facing requirement.
  ✅ docs/CODING_STANDARDS.md — §14 Cross-Platform File Conventions added; codifies
     `.native.ts(x)` suffix, prohibits `.mobile.*`, mandates shared-code-first.

Follow-up TODOs:
  - Update plan/tasks templates to enforce Principle VIII at gate time.
  - Audit existing `specs/**/tasks.md` for missing mobile counterparts.
-->

# KitchenSink Constitution

## Core Principles

### I. Correctness and Type Safety

All code MUST be written in strict TypeScript with zero use of `any` (outside test
doubles) and no suppressed compiler errors. The shared `@kitchensink/typescript` base
config (`strict: true`, `isolatedModules`, `declaration`, `declarationMap`) MUST be
extended by every workspace without weakening its flags.

- Use `interface` for data shapes and public contracts; `type` for unions, aliases,
  and mapped types.
- All custom errors MUST extend `Error` and MUST expose a type guard
  (`isXxxError(e: unknown): e is XxxError`).
- Dates in interfaces MUST be ISO 8601 strings (`string`), never `Date` objects, to
  guarantee cross-platform serialization.
- Prefer constants and enums over raw string/number literals; the `Platform` enum
  pattern is the canonical model.
- Functions MUST be pure unless they perform I/O, mutations, or external calls.
  Impure functions MUST be explicitly isolated and documented with a `@sideEffect`
  JSDoc tag. This is not a preference — it is a requirement.
- Unused parameters MUST be prefixed with `_`; never delete a required parameter
  solely to silence a lint warning.

**Rationale**: Strict typing is the primary defence against runtime errors in a
multi-platform monorepo that shares logic across web, mobile, and serverless
workspaces. Weak typing at one boundary leaks unsafety to every consumer.

### II. Code Readability and JSDoc Documentation

Every exported function, class, interface, type alias, and interface field MUST
carry a JSDoc block comment. Every source file MUST open with a module-level JSDoc
summary. Inline comments MUST explain non-obvious logic or business rules — never
restate obvious code.

- Non-trivial functions MUST include `@param`, `@returns`, and `@throws` tags.
- Simple, self-explanatory functions MAY use a single-line `/** … */` comment.
- Always use braces for control structures, even single-statement bodies (enforced
  by the `curly: 'all'` ESLint rule).
- Add a blank line after block statements (`if`, `for`, `try`, `switch`) and before
  `return` statements (enforced by `padding-line-between-statements`).
- Use named exports exclusively; default exports are permitted only where a
  framework mandates them (Next.js `page.tsx` / `layout.tsx`, Expo entry).

**Rationale**: Consistent documentation and readable formatting reduce onboarding
friction and prevent silent misuse of complex APIs across workspace boundaries.

### III. Code Organization and Import Conventions

Files MUST be organized by feature domain, not by generic type. Utilities MUST live
in a `utils/` directory co-located with their consumers; library wrappers in `lib/`;
server-only data access in `dal/`; `helpers/` directories are banned.

- **Imports MUST be aliased** (`@kitchensink/*`, `@kitchensink/*`, `@kitchensink/<pkg>`) except in
  `e2e/`, `__fixtures__/`, and `__testing__/` directories where no alias exists.
- Import order: (1) external packages, (2) aliased internal imports.
- Aliased imports MUST use `.js` / `.jsx` extensions; relative imports use `.ts` /
  `.tsx`.
- Component folders MUST follow the canonical structure: `ComponentName.tsx`,
  `types.ts`, `styles.ts`, `index.ts` (barrel only), `__tests__/`.
- Barrel `index.ts` files MUST use named re-exports only and MUST NOT contain
  implementation code.
- React components MUST NOT use boolean flag props to switch between fundamentally
  different render trees — composition via parent is required instead.

**Rationale**: Consistent import and directory conventions make navigation
predictable across 20+ workspaces. Aliased imports decouple code from physical
paths, preventing brittle refactors.

### IV. Testing Discipline with Pyramid Enforcement

Tests MUST conform to the testing pyramid: ≥70 % unit, ≤20 % integration,
≤10 % E2E. Every test file MUST open with a block comment mapping requirement
IDs to test case descriptions (traceability plan).

- **Unit tests** (`*.test.ts` in `__tests__/`): isolated, fast, no external services.
  Run via `vitest.config.ts` extending `@kitchensink/vitest` base config.
- **Integration tests** (`*.integration.test.ts`): use real adapters; run via a
  separate `vitest.integration.config.ts`; MUST NOT bleed into the default `test`
  task.
- **Service E2E** (`*.e2e.test.ts`): Lambda handlers against containerised databases;
  run via `vitest.e2e.config.ts`; `fileParallelism: false`.
- **Browser E2E** (`*.spec.ts`): Playwright only; `getByRole` and `getByLabel`
  selectors MUST be used exclusively — `data-testid` is prohibited.
- `page.waitForTimeout()` is banned in Playwright tests; use `waitForURL`,
  `waitForSelector`, or `expect(locator).toBeVisible()`.
- Global registries (codec, hydration, schema) MUST be cleared in `beforeEach` to
  prevent cross-test state leakage.
- Fixture factories MUST follow the `make*` naming convention and live in
  `__fixtures__/` with a barrel `index.ts`.
- Coverage targets: business-logic layers ≥75 %; generated files, config, barrel
  files, and test helpers are excluded from measurement.

**Rationale**: The pyramid enforces fast feedback loops. Accessible selectors keep
E2E tests resilient to DOM restructuring while simultaneously verifying that the UI
is operable without a pointing device.

### V. Monorepo Architecture and Workspace Governance

Every workspace MUST be registered in the root `package.json` workspaces array and
MUST declare `@kitchensink/eslint`, `@kitchensink/prettier`, `@kitchensink/typescript`, and
`@kitchensink/vitest` as dev dependencies. All tooling packages are private, ESM-only,
configuration-only, and MUST NOT ship runtime code.

- New workspaces MUST extend `@kitchensink/typescript/base.json` in `tsconfig.json`,
  import `@kitchensink/eslint` in `eslint.config.js`, import `@kitchensink/prettier` in
  `prettier.config.js`, and merge `@kitchensink/vitest` base config in
  `vitest.config.ts`.
- Turbo task dependencies MUST be declared explicitly: `build` depends on `^build`;
  `test` / `typecheck` depend on `^build`; `test:e2e` sets `"cache": false`.
- Per-PR schema isolation is REQUIRED for all services using Aurora DSQL: PR schemas
  follow the `pr_<number>` naming pattern and MUST be torn down on PR close.
- The `public` schema MUST never be dropped by any automated script.
- CDK manages long-lived database infrastructure; service pipelines MUST NOT
  provision or destroy clusters directly.
- Peer dependencies for shared tooling MUST be satisfied at the monorepo root, not
  duplicated in individual workspaces.

**Rationale**: Centralised tooling configuration eliminates drift between workspaces.
Explicit Turbo dependencies ensure correct build ordering and prevent stale
artifact caching. Per-PR schema isolation keeps sandbox environments reproducible
and independent.

### VI. Shared Formatting and Tooling Standards

All code MUST be formatted with the shared Prettier config (`@kitchensink/prettier`):
4-space indentation, spaces not tabs, semicolons always, trailing commas everywhere,
single quotes, 120-character print width. ESLint MUST run with the shared
`@kitchensink/eslint` flat config using `typescript-eslint` recommended rules.

- The `pre-commit` hook (`husky` + `lint-staged`) MUST run ESLint auto-fix and
  Prettier on every staged file before a commit lands.
- The `commit-msg` hook MUST enforce Conventional Commits via `commitlint`.
- CI MUST run `typecheck`, `lint`, `format:check`, and `test` for every PR; all
  four MUST pass before merge.
- TypeScript test files (`**/__tests__/**/*.ts`, `**/*.test.ts`) are exempted from
  `no-explicit-any` and `no-non-null-assertion` ESLint rules to allow test doubles.
- The `generate:types` Turbo task MUST complete before any `test`, `test:integration`,
  or `test:e2e` task runs.
- Playwright browser binaries MUST be cached by version+OS key; E2E artifacts
  (reports, traces) MUST be uploaded on failure only.

**Rationale**: Uniform formatting removes style debates from code review. Enforced
commit conventions enable automated changelogs and semantic release tooling.
Deterministic CI ordering (types → test) prevents false negatives from stale
generated code.

### VII. Accessibility and User Experience Consistency

All interactive UI elements MUST be operable and identifiable through accessible
names — either visible text, `aria-label`, or `aria-labelledby`. Icon-only buttons
MUST carry an `aria-label`. Color MUST never be the sole conveyor of information;
pair every color signal with an icon or text label.

- The design system tokens (`--accent-primary`, `--accent-secondary`,
  `--accent-highlight`, semantic status colors) MUST be consumed from the shared
  token set; hard-coded color values in component styles are prohibited.
- Typography MUST follow the major-third scale; numeric/stat data MUST use the
  monospace stack (JetBrains Mono / Fira Code).
- Motion MUST be purposeful and minimal — no decorative animations during active
  data entry or match play flows.
- Component organization MUST follow domain grouping, not type grouping
  (`/armies/`, `/matches/`, not `/buttons/`, `/modals/`); cross-domain components
  live in `/shared/`.
- Platform parity is REQUIRED: the same visual language applies to web (Next.js +
  Radix + Tailwind v4) and mobile (Expo + Tamagui); platform-specific adaptations
  are permitted for interaction patterns (hover → press + haptics) but not for
  visual language.
- All AI-generated imagery MUST use original faction-agnostic archetypes; any use
  of copyrighted or trademarked game faction names, symbols, or silhouettes in
  prompts or shipped assets is prohibited.

**Rationale**: Accessible, role-queryable UI elements are a prerequisite for
Playwright's exclusive `getByRole`/`getByLabel` selector policy (Principle IV).
Consistent visual language across platforms reduces cognitive load and accelerates
feature delivery across workspaces.

### VIII. Cross-Platform Parity and Code Sharing

Web (Next.js) and mobile (Expo) are first-class peers. Every user-facing feature
MUST ship to both platforms together, and platform-specific code MUST be the
exception, not the default.

- **Lockstep release**: No user-facing feature MAY ship to one platform before the
  other. A feature is "shipped" only when it is enabled and verified on both web
  and mobile in the same release. Phased single-platform rollouts are prohibited
  unless an explicit constitutional waiver is recorded in the feature's `plan.md`
  Complexity Tracking table and approved in the PR.
- **Parallel development**: Web and mobile implementations of a feature MUST be
  planned, tracked, and merged together. `tasks.md` MUST include both web and
  mobile tasks for any user-facing requirement; a feature branch MAY NOT be
  merged with only one platform completed.
- **Shared-code-first**: All reasonable attempts MUST be made to share TypeScript
  code, UI primitives, data-flow, and state-management patterns across web and
  mobile. Domain logic, types, validation, API clients, and hooks MUST live in a
  shared workspace (e.g., `packages/`) and be consumed by both platform apps.
  Duplicating logic per platform requires a documented justification.
- **Platform forks via `.native.` suffix**: When a module genuinely requires
  platform-specific implementations, the mobile variant MUST live next to the
  shared/web file using the `.native.ts` or `.native.tsx` suffix (e.g.,
  `RecipeCard.tsx` + `RecipeCard.native.tsx`, `storage.ts` + `storage.native.ts`).
  The `.mobile.` suffix is prohibited; `.native.` is the single canonical
  convention. Metro/Expo resolves `.native.*` automatically on mobile; web
  bundlers MUST NOT include `.native.*` files.
- **Shared visual language**: Per Principle VII, the design system, tokens,
  typography, and motion rules apply equally to both platforms; platform-specific
  adaptations are limited to interaction patterns (hover → press + haptics), not
  visual identity.

**Rationale**: Treating mobile as a second-class deliverable causes platform
drift, duplicated bugs, and inconsistent UX. Lockstep parity, shared code, and a
single colocation convention (`.native.*`) keep both platforms genuinely
equivalent and minimize the maintenance tax of supporting two runtimes.

## Quality Gates

Every pull request MUST satisfy all of the following before merge:

1. **Type check** — `turbo run typecheck` exits 0 across all affected workspaces.
2. **Lint** — `turbo run lint` exits 0; no suppressed ESLint disable comments added
   without an explanatory inline note.
3. **Format** — `turbo run format:check` exits 0; formatting MUST NOT be bypassed
   by excluding files from `.prettierignore` without justification.
4. **Unit tests** — `turbo run test` exits 0 for all affected workspaces.
5. **Constitution compliance** — the PR author MUST confirm in the PR description
   that each principle has been considered, or explicitly document any justified
   deviation in the Complexity Tracking table of `plan.md`.

Integration and E2E test results are informational for PRs but MUST pass on `main`
before a production deploy proceeds.

### Release Readiness Gate (Non-Negotiable)

A V-Model release audit report (`v-model/release-audit-report.md`) MUST NOT claim
`RELEASE READY` unless all three conditions are simultaneously true:

1. Every requirement row in every traceability matrix carries a mapped Test Case ID
   (ATP). No row may show `❌ MISSING` in the Test Case ID column.
2. Every mapped test scenario has a non-zero executed result: `passed`, `failed`, or
   `waived`. A result of `⬜ Untested` is not acceptable for any row.
3. Every waived scenario carries a written justification approved by the product
   owner, recorded in `v-model/waivers.md`. Waivers without justification are
   treated as failures.

A report that claims `RELEASE READY` while any scenario is untested, any Test Case
ID is missing, or `waivers.md` is absent is **invalid** and must be corrected to
`❌ BLOCKED` before it can be used in any handoff, review, or gate decision.

This rule is enforced by `specs/governance-rules.md` GR-001 and supersedes any
auto-generated audit report status.

## Governance

This constitution supersedes all prior informal conventions and any workspace-local
style guides that conflict with it. The companion document
[`docs/CODING_STANDARDS.md`](../../docs/CODING_STANDARDS.md) is the authoritative
reference for tactical coding conventions (file naming, folder structure, import
ordering, naming patterns). The constitution defines _what_ and _why_; Coding
Standards defines _how_. Where they conflict, this constitution prevails.

Amendments require:

1. A written proposal documenting the principle being changed, the rationale, and
   the impact on existing code.
2. Approval documented in the PR description or a linked issue.
3. A migration plan for any existing code that violates the new constraint.
4. A version increment following semantic versioning:
    - **MAJOR**: removal or incompatible redefinition of an existing principle.
    - **MINOR**: new principle or materially expanded guidance added.
    - **PATCH**: clarification, wording correction, or non-semantic refinement.

All agents and reviewers MUST check this constitution before beginning any
implementation. The plan template's **Constitution Check** gate MUST be completed
before Phase 0 research and re-checked after Phase 1 design.

**Version**: 1.3.0 | **Ratified**: 2026-04-06 | **Last Amended**: 2026-05-10
