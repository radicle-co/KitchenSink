<!--
SYNC IMPACT REPORT
==================
Version change: 1.3.0 → 2.0.0 (MAJOR)

Why MAJOR (Governance: "removal or incompatible redefinition of an existing principle"):
  - Principle IV: integration tests MOCK their dependencies (was: "use real adapters").
    Owner ruling 2026-09-20; CODING_STANDARDS §7.1a.
  - Principle III: a relative import MUST NEVER end in `.ts`/`.tsx` (was: "relative imports
    use `.ts` / `.tsx`"). CODING_STANDARDS §4 (error TS5097).
  - Principle III: a barrel exists only as a package `exports` target (was: barrels allowed
    anywhere). Owner directive; CODING_STANDARDS §4.
  - Principle VII: all native UI styling is Tamagui; React Native `StyleSheet` and inline RN
    style objects are prohibited (owner rulings 2026-10-31).
  - Principle VII: the "faction-agnostic imagery" rule is REMOVED. It was copied from another
    project, and Commise has no imagery rule (owner, 2026-10-31).
  - Governance: this constitution no longer prevails over CODING_STANDARDS. It summarises the
    owner's rulings, CLAUDE.md, the ADRs and CODING_STANDARDS (owner, 2026-10-31).
  Precedent for a MAJOR restatement: specs/governance-rules.md v2.0.0 (GR-009).

Added principle:
  - IX. Architecture: Design Patterns, Seams and Modules, React Component Architecture
    (NON-NEGOTIABLE). Owner ruling 2026-10-31, verbatim: "Enforce with the strictest law that
    design patterns MUST be used, that seam-and-module architecture MUST be used, that best
    practices and proper component architecture for react MUST be used."

Modified principles:
  - I. Correctness and Type Safety: custom errors call Object.setPrototypeOf; CODING_STANDARDS §6
    wording for constants (there is no `Platform` enum); service-owned wire contracts (ADR-0014).
  - II. Code Readability and JSDoc: a block where it carries what the name does not
    (owner ruling 2026-08-12; CODING_STANDARDS §8).
  - III. Code Organization and Imports: `common/`; aliases for cross-workspace imports and
    `@commise/*`; relative-import extensions; barrels. No fixed component folder layout
    (owner, 2026-10-31).
  - IV. Testing Discipline: test-first; the tier matrix; integration mocks; LOCAL vs DEPLOYED
    e2e; Playwright + Maestro; a skip is never a pass (owner rulings 2026-09-05, 2026-09-13,
    2026-09-20, 2026-10-03; ADR-0032; CODING_STANDARDS §7.1, §7.1a). `fileParallelism: false`
    only for database-backed LOCAL suites. Coverage target kept (owner, 2026-10-31).
  - V. Monorepo Governance: CDK packages sit outside the workspace on purpose; config and
    generated schema packages are exempt from the tooling devDependencies; root Prettier config;
    per-PR logical database on RDS PostgreSQL (ADR-0006, ADR-0031, ADR-0039, ADR-0060);
    schema stacks (ADR-0035).
  - VI. Formatting and Tooling: pre-commit runs Prettier + oxlint + typecheck; the CI gate adds
    integration, guards and Python; contract regenerate-and-diff replaces the non-existent
    `generate:types` task; Playwright artifact rule.
  - VII. Accessibility and UX: colour roles; even type scale (owner rulings 2026-10-25/26);
    figure roles, not monospace; motion; domain grouping; layout translated per platform;
    Tamagui only for native UI styling; localisation; deceptive patterns refused.
  - VIII. Cross-Platform Parity: layout is translated, not ported.
  - Quality Gates: merge gate is unit + integration + guards (owner ruling 2026-10-03); e2e tiers
    are not merge gates and nothing e2e gates a production deploy (owner, 2026-10-31); k6 never
    runs automatically. Principle IX admits no Complexity Tracking deviation.
  - Governance: precedence (owner rulings, then CLAUDE.md, the ADRs and CODING_STANDARDS
    together; this constitution is their summary).

Removed sections: N/A (one bullet removed from Principle VII; one gate line removed).

Templates requiring updates:
  ⚠ .specify/templates/plan-template.md: Constitution Check rows II, III, IV, V
     ("per-PR schema isolation"), VI (`generate:types` runs first) and VII are stale; there is no
     row for Principle VIII or Principle IX.
  ⚠ .specify/templates/tasks-template.md: T003b lists a per-workspace `prettier.config.js`;
     TXXX-II (JSDoc on all exports); TXXX-III ("All imports are aliased"); TXXX-IV (tiers);
     TXXX-VI (add `test:integration` and the guards); TXXX-VII (colour roles, type roles,
     Tamagui); no checklist line for Principle IX.
  ✅ docs/CODING_STANDARDS.md: §3 and §10 now match §4's barrel directive; its header defers to
     the Governance order below.
  ✅ CLAUDE.md: the `@commise/ui` row and the cross-platform rule state the Tamagui ruling.
  ✅ turbo.json: the base `test:e2e` task sets `"cache": false`, as Principle V requires.

Migration plan (Governance item 3): code and tooling that do not yet meet the amended text.
  1. Tamagui (Principle VII). Every React Native `StyleSheet` and inline RN style object in
     native UI moves to Tamagui. Measured at b98cc5202: 224 non-test source files under
     `packages/apps` reference `StyleSheet` (225 `StyleSheet.create` calls). `@commise/ui` does not
     yet depend on Tamagui; only `@commise/mobile` does. Enforcement: a repoGuards ratchet whose
     `StyleSheet` count may only fall, built and owned by the Tamagui migration, which is under way
     in another session. Not built in this change.
  2. Coverage (Principle IV). The 75 % business-logic target is configured nowhere: no vitest
     config sets `coverage.thresholds`. Roll out vitest coverage thresholds. Not built here.
  3. Tooling devDependencies (Principle V). @kitchensink/repo-guards lacks @kitchensink/prettier;
     @kitchensink/local-sandbox lacks @kitchensink/prettier and @kitchensink/typescript;
     @kitchensink/remote-search-service lacks @kitchensink/vitest.
  4. Module-level dependency cycles (Principle IX(b)). Nothing in the repository or in CI checks
     them: there is no dependency-cruiser config and no `import-x/no-cycle` rule. Turbo refuses
     only package-level cycles, and the staff-code-quality GATE runs its scanners only on a
     developer's machine. Add a cycle check.
  5. Undeclared package dependencies (Principle IX(b)). The `turbo boundaries` ratchet runs only
     in the local staff-code-quality GATE, not in CI (owner decision 2026-09-14, recorded in
     `.github/workflows/_ci.yml`). Gap recorded, not changed here.
  6. Port ownership and dependency direction (Principle IX(b)), presentational purity and the
     effects rule (Principle IX(c)). No mechanical check exists; they are enforced by review only.

Follow-up TODOs:
  - Create docs/offline-strategy.md (GR-005 prerequisite). Still missing.
  - Done since 1.3.0: docs/api-conventions.md (GR-002) and specs/cross-feature-FR-index.md (GR-003).
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
- All custom errors MUST extend `Error`, MUST call `Object.setPrototypeOf(this, Xxx.prototype)`
  in the constructor, and MUST expose a type guard (`isXxxError(e: unknown): e is XxxError`).
- Dates in interfaces MUST be ISO 8601 strings (`string`), never `Date` objects, to
  guarantee cross-platform serialization.
- Prefer `const` enums and string literal unions over raw strings/numbers
  (CODING_STANDARDS §6).
- Functions MUST be pure unless they perform I/O, mutations, or external calls.
  Impure functions MUST be explicitly isolated and documented with a `@sideEffect`
  JSDoc tag. This is not a preference — it is a requirement.
- Unused parameters MUST be prefixed with `_`; never delete a required parameter
  solely to silence a lint warning.
- **The service owns its wire types.** Every HTTP service authors its contract as zod in
  `src/**/*.schema.ts`; a committed copy lives in `packages/schemas/<svc>`; clients import
  from that package and MUST NOT redeclare a wire shape. A third-party API we do not serve is
  the opposite case: its client validates the raw upstream shape with zod at the boundary
  (ADR-0014, CODING_STANDARDS §15).

**Rationale**: Strict typing is the primary defence against runtime errors in a
multi-platform monorepo that shares logic across web, mobile, and serverless
workspaces. Weak typing at one boundary leaks unsafety to every consumer.

### II. Code Readability and JSDoc Documentation

A JSDoc block is REQUIRED wherever it carries what the name does not: on every exported
function, method, class and type; on an exported constant whose unit, consequence or
provenance is not in its name; and on anything deliberate that looks wrong. A constant
whose name fully states its meaning takes no block, and if a name needs a comment to be
understood, rename it (owner ruling 2026-08-12, CODING_STANDARDS §8). Every source file
MUST open with a module-level JSDoc summary of at most about 25 lines. Inline comments
MUST explain non-obvious logic or business rules — never restate obvious code.

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
in a `utils/` directory co-located with their consumers, or in `common/` when they are
cross-cutting; library wrappers in `lib/`; server-only data access in `dal/`;
`helpers/` directories are banned.

- **Imports that cross a workspace boundary MUST use the package alias**
  (`@kitchensink/<pkg>`, `@commise/<pkg>`); a relative import MUST NOT cross a workspace
  boundary. The exceptions are `e2e/`, `__fixtures__/`, and `__testing__/` directories
  where no alias exists.
- Import order: (1) external packages, (2) aliased internal imports.
- Aliased imports MUST use `.js` / `.jsx` extensions. A relative import follows the
  package's `moduleResolution`: `.js` / `.jsx` under `NodeNext` (the base-config default),
  extensionless under `bundler` (`@commise/web`). A relative import MUST NEVER end in
  `.ts` / `.tsx` (`error TS5097`).
- A barrel (a file whose whole body is re-exports) is permitted ONLY as the target of a
  `package.json` `exports` entry — the public surface of a workspace package. Everywhere
  else, import the module that declares the thing; do not create an intra-package barrel,
  and remove one rather than extend it (owner directive; CODING_STANDARDS §4).
- React components MUST NOT use boolean flag props to switch between fundamentally
  different render trees — composition via parent is required instead.

**Rationale**: Consistent import and directory conventions make navigation
predictable across every workspace. Aliased imports decouple code from physical
paths, preventing brittle refactors.

### IV. Testing Discipline with Pyramid Enforcement

Tests are written FIRST, from the spec and the plan, and are seen to FAIL before the
code they cover exists (TDD red → green). Tests written after the code are a violation
even when they pass (CODING_STANDARDS §7.1). Tests MUST conform to the testing pyramid:
≥70 % unit, ≤20 % integration, ≤10 % E2E, where "E2E" is the DEPLOYED-target tier; k6 is
a separate gate outside the pyramid. Every test file MUST open with a block comment
mapping requirement IDs to test case descriptions (traceability plan).

- **Unit tests** (`*.test.ts` in `__tests__/`): isolated, fast, no external services.
  Run via `vitest.config.ts` extending `@kitchensink/vitest` base config.
- **Integration tests** (`*.integration.test.ts`, in `tests/` for backend packages and
  `tests/__integration__/` for frontend packages): MOCK their dependencies — no real
  database, no LocalStack, no live service. Run via a separate
  `vitest.integration.config.ts`; MUST NOT bleed into the default `test` task.
  Integration is part of the merge gate.
- **End-to-end tests** (`*.e2e.test.ts`) use the REAL dependency and declare their
  TARGET. **LOCAL** (`tests/e2e/`, `vitest.e2e.config.ts`): a real Docker Postgres
  and/or LocalStack on a developer's machine, run by `npm run test:e2e`, never in a CI
  workflow; a database-backed LOCAL suite sets `fileParallelism: false`; a LOCAL suite
  never skips — with no `DATABASE_ADMIN_URL` its setup throws. **DEPLOYED**
  (`tests/deployed/`, `vitest.deployed.config.ts`): a real deployed origin (this PR's
  sandbox, or prod); it runs when the sandbox is up and skips when it is not. A LOCAL
  suite is NEVER evidence that anything is deployed (ADR-0032; CODING_STANDARDS §7.1a).
- **Playwright** (`tests/e2e/*.spec.ts`; the bare `.spec.ts` suffix is reserved for
  Playwright): the UI's integration test, one per happy path / user story, with a
  **Maestro** flow (`.maestro/`) for the same story on mobile. `getByRole` and
  `getByLabel` selectors MUST be used exclusively — `data-testid` is prohibited.
- `page.waitForTimeout()` is banned in Playwright tests; use `waitForURL`,
  `waitForSelector`, or `expect(locator).toBeVisible()`.
- Any global registry or module-level store a test touches MUST be cleared in
  `beforeEach` to prevent cross-test state leakage.
- Fixture factories MUST follow the `make*` naming convention, accept `Partial<T>`
  overrides, and live in `__fixtures__/`.
- Coverage targets: business-logic layers ≥75 %; generated files, config, barrel
  files, and test helpers are excluded from measurement.
- **Every tier the change touches gets its failing test first.** UI code: a vitest
  component test for every path and state (loading, empty, populated, error, gated,
  disabled), plus Playwright and Maestro per user story. Non-UI code: unit AND
  integration tests, always. Services: also LOCAL e2e, DEPLOYED e2e and k6. Schema or
  migration changes: a LOCAL e2e test against a real database. A feature is not done
  until every required tier is written and passing where its tier runs (CLAUDE.md;
  CODING_STANDARDS §7.1).
- A skip is never reported as a pass. Deleting or weakening a test is a decision that
  must be argued: rewrite it to prove the new behaviour, or delete it and say where the
  coverage went.

**Rationale**: The pyramid enforces fast feedback loops. Accessible selectors keep
E2E tests resilient to DOM restructuring while simultaneously verifying that the UI
is operable without a pointing device. A suite that supplies its own dependency proves
the code and cannot prove a deploy: a stale build served `pr-73` for fifteen days behind
green checks (ADR-0032).

### V. Monorepo Architecture and Workspace Governance

Every workspace MUST be registered in the root `package.json` workspaces array and
MUST declare `@kitchensink/eslint`, `@kitchensink/prettier`, `@kitchensink/typescript`, and
`@kitchensink/vitest` as dev dependencies. The shared configuration packages
(`@kitchensink/{eslint,prettier,typescript,vitest,esbuild}`) are private, ESM-only,
configuration-only, and MUST NOT ship production runtime code; they, and the generated
contract packages (`packages/schemas/*`), are exempt from that devDependency list.

- The CDK app packages (`packages/infra/global` and each service's `infra/`) sit OUTSIDE
  the workspaces array on purpose, each with its own install, so `aws-cdk-lib` stays out of
  the root tree and out of every image built from it (`.github/actions/infra-package/action.yml`,
  `.github/workflows/prod-deploy.yml`; ADR-0066 records that `packages/infra/global` is not a
  workspace). They declare no `@kitchensink/*` tooling and resolve it from the root install.
- New workspaces MUST extend `@kitchensink/typescript/base.json` in `tsconfig.json`,
  import `@kitchensink/eslint` in `eslint.config.js`, and merge `@kitchensink/vitest`
  base config in `vitest.config.ts`. Prettier is configured once, by the root
  `prettier.config.js`, which imports `@kitchensink/prettier`.
- Turbo task dependencies MUST be declared explicitly: `build` depends on `^build`;
  `test` / `typecheck` depend on `^build`; `test:e2e` sets `"cache": false`.
- Per-PR database isolation is REQUIRED for every per-PR service deploy: each preview
  gets its own logical database on the shared sandbox RDS PostgreSQL instance, named
  `kitchensink_<db>_pr_<N>` (ADR-0006), and it MUST be dropped on PR close — or, when the
  sandbox is down, recorded as owed and dropped by the next Sandbox Up (ADR-0060).
- Only the non-prod per-PR database reaper may issue `DROP DATABASE`; it does not exist
  in prod, and prod has no per-PR databases (ADR-0031, ADR-0039).
- CDK manages long-lived database infrastructure (`DataStack` owns the RDS instance);
  service pipelines MUST NOT provision or destroy the instance directly. Each database's
  schema is its own stack, deployed and migrated ahead of everything that reads it, with
  expand-first migrations (ADR-0035).
- Peer dependencies for shared tooling MUST be satisfied at the monorepo root, not
  duplicated in individual workspaces.

**Rationale**: Centralised tooling configuration eliminates drift between workspaces.
Explicit Turbo dependencies ensure correct build ordering and prevent stale
artifact caching. Per-PR database isolation keeps sandbox environments reproducible
and independent.

### VI. Shared Formatting and Tooling Standards

All code MUST be formatted with the shared Prettier config (`@kitchensink/prettier`):
4-space indentation, spaces not tabs, semicolons always, trailing commas everywhere,
single quotes, 120-character print width. ESLint MUST run with the shared
`@kitchensink/eslint` flat config using `typescript-eslint` recommended rules.

- The `pre-commit` hook (`husky` + `lint-staged`) MUST run Prettier on every staged file
  and `oxlint` on staged JS/TS, and MUST typecheck when TypeScript is staged, before a
  commit lands. Type-aware ESLint runs in CI and the editor, not in the hook.
- The `commit-msg` hook MUST enforce Conventional Commits via `commitlint`.
- CI MUST run, for every PR: `typecheck`, `lint`, `format:check`, the unit tests
  (`test`), the mocked integration tests (`test:integration`), the repo guards, and the
  Python `lint:python`, `format:check:python` and `typecheck:python` steps. All MUST pass
  before merge (owner ruling 2026-10-03).
- TypeScript test files (`**/__tests__/**/*.ts`, `**/*.test.ts`) are exempted from
  `no-explicit-any` and `no-non-null-assertion` ESLint rules to allow test doubles.
- Generated contract packages (`packages/schemas/*`) are committed, and CI MUST fail on
  any difference from a fresh `contract:generate` (ADR-0014, CODING_STANDARDS §15). Task
  ordering comes from the `^build` edges in Principle V.
- Playwright browser binaries MUST be cached by a key of the OS and the locked
  Playwright version. Playwright traces MUST be uploaded on failure only; per-shard blob
  reports are uploaded on every run that is not cancelled, so the merged report can be
  built.

**Rationale**: Uniform formatting removes style debates from code review. Enforced
commit conventions keep the history machine-readable. Deterministic CI ordering
(`^build` before typecheck and test) and the contract regenerate-and-diff check prevent
false results from stale built or generated code.

### VII. Accessibility and User Experience Consistency

All interactive UI elements MUST be operable and identifiable through accessible
names — either visible text, `aria-label`, or `aria-labelledby`. Icon-only buttons
MUST carry an `aria-label`. Color MUST never be the sole conveyor of information;
pair every color signal with an icon or text label.

- Colour MUST come from the colour roles in `@commise/ui` (`role` / `roleDark` in
  `ui/src/tokens/colors.ts`), which web reads as `--color-{role}` custom properties and
  native reads from the same record. A screen names a role (`ink`, `action`, `danger`, …),
  never a palette name; hard-coded colour values in component styles are prohibited.
  Light and dark themes come from the same role set.
- Typography MUST follow the type scale in `@commise/ui`: a screen names a type role
  (`typeRole` in `ui/src/tokens/typography.ts`), never a size. Every size is an even px
  value from `TYPE_SIZES`, the one place the list lives (today 14, 16, 18, 28); nothing is
  smaller than 14 or larger than 28; every line height is a whole px on a 4 px grid; and
  no role tracks its letters (owner rulings 2026-10-25 and 2026-10-26; held by
  `typeScale.test.ts`). Numbers — amounts, times, counts, kcal, servings — use the figure
  roles: the body face with `tabular-nums lining-nums`. The display face sets names only,
  never a number.
- Motion MUST be purposeful and minimal: only the moments the design system defines
  animate (`ui/src/tokens/motion.ts`), and each one has a reduced-motion form that
  honours the operating system's reduced-motion setting.
- Feature UI MUST be grouped by domain (`features/recipes/…`, `features/account/…`;
  inside a feature, `card/`, `editor/`, `collections/`), not by type (`/buttons/`,
  `/modals/`). UI primitives used across domains live in the design-system package
  `@commise/ui`, one folder per primitive.
- Platform parity is REQUIRED: the same visual language applies to web (Next.js +
  Radix + Tailwind v4) and mobile (Expo + Tamagui). Layout and interaction MAY differ by
  platform and screen size — translate the job, not the layout; give every hover,
  right-click and drag affordance a touch equivalent; place the primary action by reach —
  but the visual language (colour roles, type roles, spacing, shape, motion) MUST NOT
  (CLAUDE.md, `staff-ux-engineer` rule 5).
- **All native UI styling is Tamagui.** The native components of `@commise/ui`, the shared
  native UI and every mobile screen MUST be styled with Tamagui. React Native `StyleSheet`
  and inline React Native style objects are PROHIBITED in new code from 2026-10-31, and every
  existing use MUST be migrated (owner rulings 2026-10-31: "Tamagui should have been used -
  including for the native shared ui components"; "Make sure all React Native styling is
  replaced by tamagui"). A repoGuards ratchet, whose `StyleSheet` count may only fall, holds
  the migration; it is built by the Tamagui migration (see the migration plan).
- Every string a user reads goes through the localisation path, never a hard-coded
  literal, and every UI state (empty, loading, partial, error, offline,
  permission-denied, success, first-run) is designed with its copy and its localisation
  key.
- Deceptive patterns are refused, not weighed (EU DSA Article 25, EDPB Guidelines 03/2022,
  the FTC's 2022 report; CLAUDE.md, `staff-ux-engineer` rule 3).

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
- **Shared visual language**: Per Principle VII, the design system, tokens, typography
  and motion rules apply equally to both platforms. Layout and interaction are
  translated per platform and screen size, not ported 1:1; visual identity is not
  adapted. Parity of existence (CODING_STANDARDS §14) does not prove parity of quality.

**Rationale**: Treating mobile as a second-class deliverable causes platform
drift, duplicated bugs, and inconsistent UX. Lockstep parity, shared code, and a
single colocation convention (`.native.*`) keep both platforms genuinely
equivalent and minimize the maintenance tax of supporting two runtimes.

### IX. Architecture: Design Patterns, Seams and Modules, React Component Architecture (NON-NEGOTIABLE)

The owner ruled on 2026-10-31: "Enforce with the strictest law that design patterns MUST be
used, that seam-and-module architecture MUST be used, that best practices and proper component
architecture for react MUST be used." This principle states those three MUSTs. A pull request
that violates any of them is REJECTED. No Complexity Tracking entry, reviewer approval or
deadline waives it; only a dated owner ruling can.

**(a) Design patterns MUST be used** (CLAUDE.md "Design-pattern-first development").

- When a use-case is what a named pattern solves, that pattern is the design, used alone or
  composed. Where a language or library feature already satisfies a pattern's intent, say so
  instead of adding machinery. Forcing a pattern onto a shape it does not fit is the only misuse.
- Pull requests and reviews lead with the patterns involved, in pattern vocabulary. A feature's
  plan carries its pattern register.
- A unit's JSDoc names its pattern with a `@pattern` tag. The tag is REQUIRED, at 100 %, on the
  four component classes of CODING_STANDARDS §11.2 (design system; any ref use; a boolean prop
  selecting a subtree; a declared orchestration component) and on every ref-using module under
  `packages/apps/commise`. A tag that only restates the layer is rejected.
- Enforced by: `packages/tools/repoGuards/__tests__/patternRegister.test.ts` (the `@pattern`
  register and the ref register); the `staff-architect` agent at PLANNING, BLUEPRINT and REVIEW;
  the `staff-code-quality` GATE, which a user-level hook requires before `git push` (CLAUDE.md).
  Not mechanical: whether a claimed pattern is TRUE, and pattern use outside the four classes.
  Review is the only check (CODING_STANDARDS §11.2).

**(b) Seam-and-module architecture MUST be used.**

- **Deep modules, narrow doors.** A module hides a powerful implementation behind a small
  interface (ENGINEERING_EXCELLENCE.md, "Design Patterns, Principles & Code Quality" §2). A
  workspace package's `package.json` `exports` are its only door: nothing imports another
  package's internals, and no relative path crosses a package boundary.
- **Dependencies cross modules only through explicit seams.** A port is owned by the
  higher-level side and adapters implement it ("invert dependencies at architectural seams
  (domain defines the port, infra implements it)", ENGINEERING_EXCELLENCE.md, "Design Patterns,
  Principles & Code Quality" §3). Dependency-injection tokens are seams too: the ditox
  Discovery / Composition / Render seam of the Home widget surface
  (`specs/001-commise-recipe-app/research/home-widget-architecture.md`). So are loader seams: a
  registration carries a loader, `() => import(…)`, not a component (same source).
- **Dependencies point toward stability, and there are no cycles.** Volatile modules depend on
  stable abstractions, never the reverse; shared → feature → app, never the reverse
  (ENGINEERING_EXCELLENCE.md, "Design Patterns, Principles & Code Quality" §3 and
  "Frontend Engineering Excellence" §1).
- Enforced by: the shared ESLint config (`packages/tools/eslint`): `no-restricted-imports`
  blocks another package's internals except its declared exports, `subpathExports.test.js`
  keeps that allow-list equal to the manifests, and `restrictedImportsOverride.test.ts` stops a
  package switching it off; `import-x/no-relative-packages` refuses a relative path into
  another package; an app may import only types from a deployable service. Seam guards in
  `packages/tools/repoGuards/__tests__/` hold named seams by discovery, for example
  `featurePackagesDoNotImportQuery`, `modalAdapterImports`, `textInputAdapterImports`,
  `iconImportBoundary` and `databaseHandleSeam`. Turbo refuses a package-level dependency
  cycle. The `staff-architect` REVIEW and the `staff-code-quality` GATE judge the rest; the
  GATE's `turbo boundaries` ratchet runs only on a developer's machine, not in CI.
  Not mechanical: module-level cycles, port ownership and dependency direction (see the
  migration plan).

**(c) React best practice and proper component architecture MUST be used** (CLAUDE.md
"Design-pattern-first development" item 3; CODING_STANDARDS §11; ENGINEERING_EXCELLENCE.md,
"Frontend Engineering Excellence" §1 and §2).

- **Orchestration / render split.** Orchestration components decide (data, mutations, effects,
  which subtree to show); render components are pure `props → JSX` with ONE responsibility, no
  data fetching, no mutations and no side effects.
- **A boolean or mode prop that switches BEHAVIOUR belongs in the orchestration layer**, which
  selects the right render component (CODING_STANDARDS §11.1). A prop that only derives display
  is not a switch.
- **Refs are near-forbidden**: permitted only to wrap a genuinely external, non-declarative
  system with no alternative.
- **Effects only synchronise with an external system.** Derive, do not store: a value
  computable from existing state is computed during render, never held in state and synced by
  an effect. Server data lives in the query cache, not in `useState` + `useEffect`.
- **Every state is designed**: empty, loading, partial, error, offline, permission-denied,
  success and first-run (CLAUDE.md, `staff-ux-engineer` rule 6), and every state has a
  component test (Principle IV).
- Enforced by: `patternRegister.test.ts` (the ref register: every ref site carries a verdict
  and a reason; a component with a boolean prop selecting a subtree must name its pattern);
  `eslint-plugin-react-hooks`, every recommended rule raised to `error` (`packages/tools/eslint`);
  `oneHookPerFile.test.ts`; `serverComponentClientApis.test.ts`; the `staff-ux-engineer` agent
  for every user-facing surface (SPECIFY and EVALUATE); the `staff-architect` REVIEW; the
  `staff-code-quality` GATE (refs, effects and other escape hatches). Not mechanical:
  presentational purity, the effects rule beyond the hooks rules, and whether every state was
  designed (see the migration plan).

**Rationale**: Patterns give the codebase one vocabulary; seams and deep modules keep each
change local; a pure render layer under a thin orchestration layer keeps components testable
and replaceable. The owner set this at the strictest level because an agent left to itself
codes the locally plausible shape, and the cost of that shape lands on every later change.

## Quality Gates

Every pull request MUST satisfy all of the following before merge:

1. **Type check** — `turbo run typecheck` exits 0 across all affected workspaces.
2. **Lint** — `turbo run lint` exits 0; no suppressed ESLint disable comments added
   without an explanatory inline note.
3. **Format** — `turbo run format:check` exits 0; formatting MUST NOT be bypassed
   by excluding files from `.prettierignore` without justification.
4. **Unit tests** — `turbo run test` exits 0 for all affected workspaces.
5. **Integration tests** — every `test:integration` step exits 0; integration MOCKS its
   dependencies.
6. **Repo guards and Python checks** — the repo-guard suites and `lint:python`,
   `format:check:python` and `typecheck:python` exit 0.
7. **Constitution compliance** — the PR author MUST confirm in the PR description
   that each principle has been considered, or explicitly document any justified
   deviation in the Complexity Tracking table of `plan.md`. Principle IX admits no
   such deviation.

End-to-end tiers are not merge gates. A LOCAL e2e suite runs only on a developer's
machine (`npm run test:e2e`) and is run before claiming a change done. A DEPLOYED e2e
suite runs automatically when the PR's sandbox is up and skips when it is not; a PR
whose sandbox is down is green having run no DEPLOYED e2e tests, and a skip MUST NEVER
be reported as a pass. k6 never runs automatically; it is a manually dispatched job
(owner rulings 2026-09-13, 2026-09-20, 2026-10-03; ADR-0032).

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
style guides that conflict with it. It is the SUMMARY of the project's rules, not their
highest source. The order of authority is: (1) the owner's dated rulings; then (2)
`CLAUDE.md`, the accepted ADRs in `docs/architecture/decisions/` and
[`docs/CODING_STANDARDS.md`](../../docs/CODING_STANDARDS.md), together (owner, 2026-10-31).
CODING_STANDARDS is the authoritative reference for tactical coding conventions (file
naming, folder structure, import ordering, naming patterns). Where this constitution
disagrees with a higher source, the constitution is out of date: the higher source wins,
and this document MUST be amended to match.

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

**Version**: 2.0.0 | **Ratified**: 2026-04-06 | **Last Amended**: 2026-10-31
