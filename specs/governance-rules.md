# KitchenSink Cross-Feature Governance Rules

**Version**: 3.2.0
**Ratified**: 2026-05-10 | **Last amended**: 2026-08-12
**Authority**: Senior Product Owner, cross-feature governance
**Scope**: All features 001–014 and any future feature in this portfolio
**Status**: Active — enforced from this date forward

This document converts the findings in [`cross-feature-consistency-report.md`](./cross-feature-consistency-report.md) into concrete, enforceable governance requirements. Each rule has a unique ID, a severity, an acceptance criterion, and a clear statement of what constitutes a violation. V-Model evidence closure is defined in [`v-model-closure-checklist.md`](./v-model-closure-checklist.md).

Engineering handoff is blocked until every CRITICAL rule is satisfied for the feature being handed off. WARNING rules must be satisfied or explicitly downgraded with documented justification before Phase 3 (implementation) begins.

---

## Table of Contents

1. [Release Readiness Gate (GR-001)](#gr-001-release-readiness-gate)
2. [API URL Prefix Standard (GR-002)](#gr-002-api-url-prefix-standard)
3. [FR Identifier Namespace (GR-003)](#gr-003-fr-identifier-namespace)
4. [Data Model Naming Convention (GR-004)](#gr-004-data-model-naming-convention)
5. [Offline and Sync Strategy (GR-005)](#gr-005-offline-and-sync-strategy)
6. [Dependency Sequencing (GR-006)](#gr-006-dependency-sequencing)
7. [Shared Type Library Ownership (GR-007)](#gr-007-shared-type-library-ownership)
8. [Node.js Runtime Version (GR-008)](#gr-008-nodejs-runtime-version)
9. [Package Naming Convention (GR-009)](#gr-009-package-naming-convention)
10. [EU AI Act Compliance Propagation (GR-010)](#gr-010-eu-ai-act-compliance-propagation)
11. [Notification System Ownership (GR-011)](#gr-011-notification-system-ownership)
12. [Subscription Gating Mechanism (GR-012)](#gr-012-subscription-gating-mechanism)
13. [Persona Library Compliance (GR-013)](#gr-013-persona-library-compliance)
14. [Audience and Sharing Model (GR-014)](#gr-014-audience-and-sharing-model)
15. [API Contract Ownership (GR-015)](#gr-015-api-contract-ownership)
16. [Input Validation at Every Boundary (GR-016)](#gr-016-input-validation-at-every-boundary)
17. [Governance Amendment Process](#governance-amendment-process)

---

## GR-001: Release Readiness Gate

**Severity**: CRITICAL
**Resolves**: Director rejection — release audits contradicted their own data
**Source**: `cross-feature-consistency-report.md` §6 (all CRITICAL/WARNING findings)

### Rule

A release audit report (`v-model/release-audit-report.md`) **MUST NOT** claim `RELEASE READY` unless all three conditions are simultaneously true:

1. Every requirement row in every traceability matrix carries a mapped Test Case ID (ATP). No row may show `❌ MISSING` in the Test Case ID column.
2. Every mapped test scenario has a non-zero executed result: `passed`, `failed`, or `waived`. A result of `⬜ Untested` is not acceptable for any row.
3. Every waived scenario carries a written justification approved by the product owner. Waivers without justification are treated as failures.

### Acceptance Criteria

- **AC-001-a**: `grep "RELEASE READY" v-model/release-audit-report.md` returns no match unless the above three conditions are verified and documented.
- **AC-001-b**: The audit report's Executive Summary shows `0 untested` scenarios.
- **AC-001-c**: The audit report's Executive Summary shows `0 anomalies` only after all anomalies are either resolved or waived with justification.
- **AC-001-d**: The `waivers.md` artifact exists and is non-empty if any scenario is waived.

### Violation

Any release audit report that claims `RELEASE READY` while showing untested scenarios, missing Test Case IDs, or a missing `waivers.md` is **invalid**. The report must be corrected to `❌ BLOCKED` before it can be used in any handoff, review, or gate decision.

### Current State (2026-05-10)

All features 001–014 are pre-implementation. All release audit reports have been corrected to `❌ BLOCKED`. No feature may advance to `release-readiness: complete` in its `.forge-status.yml` until this rule and the closure definition in [`v-model-closure-checklist.md`](./v-model-closure-checklist.md) are satisfied.

---

## GR-002: API URL Prefix Standard

**Severity**: CRITICAL
**Resolves**: CR-001 (API prefix collision), S-001 (portfolio standard)
**Source**: `cross-feature-consistency-report.md` §8 S-001; `002-user-auth/review.md` Revision 1

### Rule

All API endpoints across the entire portfolio **MUST** follow the pattern:

```
{protocol}://{host}:{port}/api/v{N}/{resource-path}
```

Both the `/api` segment and the `/v{N}` version segment are required. Neither may be omitted.

**Canonical examples**:

- `/api/v1/recipes`
- `/api/v1/auth/callback`
- `/api/v1/grocery-lists/{id}`
- `/api/v1/foods/{fdcId}`
- `/api/v1/meal-plans/{id}/entries`

### Acceptance Criteria

- **AC-002-a**: Every `spec.md`, `plan.md`, and OpenAPI contract in every feature uses `/api/v1/*` (or `/api/v2/*` for future versions). No endpoint uses bare `/api/*` or bare `/v1/*`.
- **AC-002-b**: Feature 001's `contracts/api.openapi.yaml` is updated from `/api/*` to `/api/v1/*` before any Phase 2 implementation begins.
- **AC-002-c**: Features 002–014 are updated from `/v1/*` to `/api/v1/*` before their respective Phase 2 implementations begin.
- **AC-002-d**: A shared `docs/api-conventions.md` document exists and references this rule before any feature enters implementation.

### Violation

Any spec, plan, or contract that uses `/api/*` without a version segment, or `/v1/*` without the `/api` prefix, is non-conformant and blocks engineering handoff for that feature.

### Current State (2026-08-02) — SATISFIED

- **Implemented in code, not just in specs.** All three deployable services (identity, food, recipe) serve
  every versioned endpoint at the canonical `/api/v1/*`. Route-path contract tests per service pin it.
- Feature 001: `contracts/api.openapi.yaml` now uses `/api/v1/*` for every path key — ✅.
- Feature 002: `contracts/identity-api.openapi.json` server base path is `/api/v1` — ✅.
- Features 011 and 014 were authored against `/api/v1/*` and needed no change — ✅.
- **Features 007–010, 012, 013: normalized in the 2026-08-02 spec sweep** — 82 bare `/v1/*` references
  plus every unprefixed shorthand endpoint. The only paths deliberately left alone are third-party URLs
  the platform does not own (Instacart's `/idp/api/v1/products/*`) — ✅.
- ⚠️ **Feature 006 is the last holdout.** Its branch still carries bare `/v1/*`, and its `review.md` closes
  PRF-006-16 on "the platform's plain-segment convention, `POST /v1/recipes/nutrition-batch`". **That
  finding is superseded** — and its stated rationale misattributed ownership: a feature spec does not own a
  service. The recipe service is owned by the repository owner, not by feature 006, so PRF-006-16 was never
  an ownership-backed exemption from a portfolio rule. Correct it before 006 merges.
- `docs/api-conventions.md` now exists and references this rule (AC-002-d) — ✅.
- **One deliberate, documented exception to "no bare `/v1/*`":** every endpoint ALSO answers on its original
  bare `/v1/*` path as a DEPRECATED ALIAS, because consumers outside this repository hold those URLs — the
  Clerk dashboard webhook endpoint, plus already-shipped mobile builds and cached web bundles with
  build-time-inlined endpoints. This is not a violation of GR-002: the canonical path is `/api/v1/*` and all
  new code targets it. Retiring the alias has an ordered prerequisite list (Clerk dashboard first). See
  [ADR-0011](../docs/architecture/decisions/0011-api-version-prefix.md).
- **`/health` and `/health/ready` are exempt by design** — operational probes, not API surface. They stay at
  the origin root because the shared-ALB target-group health check and the deploy smoke steps dial them
  there; CDK assertions pin `HealthCheckPath: '/health'` per service.

---

## GR-003: FR Identifier Namespace

**Severity**: WARNING
**Resolves**: WA-003 (FR number ambiguity)
**Source**: `cross-feature-consistency-report.md` §2.1, §6 WA-003

### Rule

Functional requirement IDs are local to each feature spec. Cross-feature references **MUST** qualify the source feature number:

- Within a feature's own spec: `FR-001`, `FR-045` (unqualified is fine)
- In any other feature's spec, plan, or artifact: `001-FR-045`, `003-FR-035` (feature number prefix required)

No cross-feature FR reference may use an unqualified `FR-NNN` ID.

### Acceptance Criteria

- **AC-003-a**: Every cross-feature FR citation in `spec.md`, `plan.md`, `tasks.md`, and `v-model/` artifacts uses the `{feature}-FR-{NNN}` format.
- **AC-003-b**: A `specs/cross-feature-FR-index.md` artifact exists that lists all cross-feature FR citations, the source feature, and the target feature. This index is updated whenever a cross-feature FR reference is added or removed.
- **AC-003-c**: The FR index is reviewed during each feature's revalidation pass.

### Violation

An unqualified `FR-NNN` reference in a feature's artifact that refers to a requirement in a different feature is a documentation defect. It does not block handoff but must be corrected before the referencing feature enters implementation.

### Current State (2026-08-02)

The [`cross-feature-FR-index.md`](./cross-feature-FR-index.md) registry exists and records active
cross-feature citations. The normalized value is `{feature}-FR-{NNN}`; legacy prose may still show spaced
forms such as `001 FR-045`.

**Features 007–014 are conformant as of the 2026-08-02 sweep** — 62 unqualified cross-feature references
were qualified (61 in 010's gating tables and v-model, 2 in 007). Verified mechanically: for every feature,
zero bare `FR-NNN` references remain that fall outside that feature's own defined set.

**Numbering is deliberately NOT 1-based per feature.** This rule requires _locality_ and _qualified
cross-references_; it does not mandate a starting number. Features carry overlapping ranges by design —
001 owns FR-001…046, 004 FR-008…028, 005 FR-015…022, 006 FR-022…041, 007 FR-028…033, 008 FR-032…035,
009 FR-036…039, 010 FR-040…043, while 003, 011, 012, 013, and 014 number from 001. Numeric collision across
features is therefore expected and accepted (004's `verify-report.md` records it as INFO I-002, "mitigated
by the mandatory `004-` prefix"); the qualifier, not the number, carries the meaning.

Two genuine defects of this class were fixed in the sweep, both of which the collision-tolerant model relies
on qualifiers to prevent:

- **007 ↔ 008 both defined FR-032 and FR-033 with different meanings** (007: Shopping Lists page and
  meal-plan back-link; 008: Cooking Mode step display and step navigation), in the same milestone `M3`.
- **Two abbreviated ranges in 010 cited FRs their named owner does not define** — `008 | FR-032–037`
  (008 defines only FR-032…035; 036–037 belong to 009) and `006 | FR-020–024` (006 starts at FR-022).
  Both were narrowed to the owner's real set and enumerated rather than abbreviated, per the precedent
  006 set in PRF-006-14.

⚠️ **Registry not updated by this sweep — deliberate hand-off.** `cross-feature-FR-index.md` has
**uncommitted in-flight edits in both the 005 and 006 worktrees**. Editing it here would have produced a
three-way conflict and risked clobbering that work. The rows the sweep newly qualified (007's `001-FR-045`,
and 010's `plan.md` / `research.md` citations of 001, 004, 005, 006, 007, 008, 009) must be registered once
005's and 006's changes land. Tracked in `spec-sweep-2026-08-02.md`.

---

## GR-004: Data Model Naming Convention

**Severity**: WARNING
**Resolves**: IN-001 (fdcId naming inconsistency), IN-002 (meal_plan_nutrition table name)
**Source**: `cross-feature-consistency-report.md` §2.4, §6 IN-001, IN-002

### Rule

Database column names that reference another feature's primary key **MUST** use the owning feature's canonical column name as the foreign key column name. The `usda_` prefix is not permitted as a disambiguation strategy — use the canonical name from the owning feature's schema.

**Canonical decisions**:

| Concept              | Canonical column name                  | Owner                  |
| -------------------- | -------------------------------------- | ---------------------- |
| USDA food identifier | `fdc_id`                               | 003-usda-food-data     |
| Meal plan reference  | `meal_plan_id`                         | 006-meal-planning      |
| Recipe reference     | `recipe_id`                            | 001-commise-recipe-app |
| User reference       | `user_id`                              | 002-user-auth          |
| Subscription tier    | `plan` (values: `'free'`, `'premium'`) | 010-subscriptions      |

**Table naming**:

- Feature 006's aggregated nutrition table **MUST** be named `meal_plan_daily_nutrition`, not `meal_plan_nutrition`, to avoid confusion with per-recipe nutrition fields in feature 001.
- Feature 007's grocery list item column referencing USDA food data **MUST** use `fdc_id`, not `usda_fdc_id`.

### Acceptance Criteria

- **AC-004-a**: Feature 007's `plan.md` uses `fdc_id` (not `usda_fdc_id`) for the USDA food reference column.
- **AC-004-b**: Feature 006's `plan.md` uses `meal_plan_daily_nutrition` as the table name for aggregated nutritional totals.
- **AC-004-c**: All features that reference another feature's primary key use the canonical column name from the table above.
- **AC-004-d**: The `@kitchensink/shared-recipe-core` package (GR-007) defines canonical TypeScript field names that map to these column names, preventing camelCase/snake_case drift.

### Violation

A feature plan that uses a non-canonical column name for a cross-feature foreign key is a documentation defect. It must be corrected before the feature's database migration is written.

### Current State (2026-05-10)

- Feature 007 `plan.md:55` uses `usda_fdc_id` — **correction required**.
- Feature 006 `plan.md:67` uses `meal_plan_nutrition` — **correction required**.
- Both corrections are deferred to each feature's pre-implementation review, not blocking current handoff of 001/002.

---

## GR-005: Offline and Sync Strategy

**Severity**: WARNING
**Resolves**: WA-005 (offline strategy isolated to 008)
**Source**: `cross-feature-consistency-report.md` §5.4, §6 WA-005

### Rule

Any feature that has a mobile user-facing component and operates on data that a user may need while offline (grocery lists, meal plans, cooking sessions) **MUST** declare its offline behavior explicitly in its `spec.md` and `plan.md` before entering implementation.

The declaration must answer:

1. **Offline scope**: Which operations are available offline (read-only, read-write, none)?
2. **Persistence layer**: Which storage mechanism is used (IndexedDB for web, AsyncStorage for mobile)?
3. **Sync strategy**: How are offline changes reconciled when connectivity is restored (last-write-wins, server-wins, conflict UI)?
4. **Conflict handling**: What happens when the same record is modified offline on two devices?

Features that are server-only (no mobile client) are exempt from this rule and must state "offline: not applicable — server-only feature" in their spec.

### Acceptance Criteria

- **AC-005-a**: Feature 006 (meal planning) `spec.md` includes an "Offline Behavior" section before implementation begins.
- **AC-005-b**: Feature 007 (grocery lists) `spec.md` includes an "Offline Behavior" section before implementation begins. Given that a user standing in a grocery store with poor connectivity is a primary use case, offline read access to the current list is a **Must Have**.
- **AC-005-c**: Feature 008 (cooking mode) already has a concrete offline architecture (`CookingSession` device storage). Its pattern is the reference implementation for other features.
- **AC-005-d**: A shared `docs/offline-strategy.md` document exists that defines the canonical persistence adapters (IndexedDB/AsyncStorage) and sync reconciliation policy before any feature with offline requirements enters implementation.

### Violation

A feature with mobile user-facing components that enters implementation without a declared offline strategy is non-conformant. The implementation team must not invent an ad-hoc offline approach — they must wait for the cross-feature offline strategy document.

### Current State (2026-05-10)

- Feature 008: offline strategy defined (reference implementation).
- Features 006, 007: no offline strategy declared — **required before implementation**.
- `docs/offline-strategy.md`: does not exist — **must be created before 006/007 enter implementation**.

---

## GR-006: Dependency Sequencing

**Severity**: WARNING
**Resolves**: WA-002 (006→007 dependency not flagged as blocking)
**Source**: `cross-feature-consistency-report.md` §3.2, §6 WA-002

### Rule

The following implementation phase order is mandatory. A feature in a later phase **MUST NOT** begin database migration or API implementation until all features in earlier phases have completed their database migrations.

| Phase | Features           | Hard prerequisite                                                                      |
| ----- | ------------------ | -------------------------------------------------------------------------------------- |
| 1     | 001, 002           | None — foundational                                                                    |
| 2     | 003, 004, 005, 008 | Phase 1 migrations complete                                                            |
| 3     | 006, 009           | Phase 1 + Phase 2 (003) migrations complete                                            |
| 4     | 007                | Phase 3 (006 `meal_plans` table) migration complete                                    |
| 5     | 010                | Can begin in parallel with Phase 2; must be live before any premium feature is enabled |

**Specific hard constraint**: Feature 007's `grocery_lists` table has a foreign key `meal_plan_id UUID REFERENCES meal_plans(id)`. The `meal_plans` table (owned by 006) must exist in the target database before 007's migration can run. This is a **blocking** constraint, not merely a "Required" dependency.

### Acceptance Criteria

- **AC-006-a**: Feature 007's `spec.md` dependency table explicitly marks 006 as a **blocking** dependency (not just "Required"), with the note: "006's `meal_plans` table must be migrated before 007's migration can run."
- **AC-006-b**: The CI/CD pipeline enforces migration ordering: 007's migration job declares a `depends_on: [006-migration]` constraint.
- **AC-006-c**: No feature in Phase 3 or later begins implementation until Phase 1 and Phase 2 (where applicable) are complete and verified.

### Violation

Running 007's database migration before 006's `meal_plans` table exists will cause a foreign key constraint failure. This is a deployment blocker, not a documentation issue.

### Current State (2026-05-10)

- Feature 007 `spec.md:10-12` marks 006 as "Required" but not "blocking". **Correction required before 007 enters implementation.**
- No CI/CD pipeline exists yet — migration ordering must be enforced when pipelines are created.

---

## GR-007: Shared Type Library Ownership

**Severity**: CRITICAL
**Resolves**: CR-002 (missing shared/recipe-core)
**Source**: `cross-feature-consistency-report.md` §5.1, §6 CR-002; S-002

### Rule

The `@kitchensink/shared-recipe-core` package **MUST** be created as part of Feature 001's implementation, before any other feature (002–014) implements code that references `Recipe`, `Ingredient`, `Step`, `Collection`, `User`, `Account`, `Food`, `MealPlan`, `NutritionPlan`, or `GroceryList` types.

All features that define or consume these entity types **MUST** import from `@kitchensink/shared-recipe-core`. Defining a local copy of any of these types is prohibited.

The package lives at `packages/shared/recipe-core/` and is published as `@kitchensink/shared-recipe-core` following the S-002 naming convention.

### Acceptance Criteria

- **AC-007-a**: Feature 001's `tasks.md` includes a task to create and publish `@kitchensink/shared-recipe-core` as the first implementation task, before any API or UI work.
- **AC-007-b**: The package exports at minimum: `Recipe`, `Ingredient`, `Step`, `Collection`, `User`, `Account`, `Food`, `MealPlan`, `NutritionPlan`, `GroceryList` interfaces.
- **AC-007-c**: Features 002–014 declare `@kitchensink/shared-recipe-core` as a dependency in their `package.json` before implementing any code that references these types.
- **AC-007-d**: No feature's implementation code defines a local `Recipe`, `User`, or `Account` interface that duplicates the shared type.

### Violation

Any feature that defines its own local copy of a shared entity type is in violation. The local type must be removed and replaced with the import from `@kitchensink/shared-recipe-core`.

### Current State (2026-08-02)

Superseded the 2026-05-10 entry. **The blocking constraint is cleared.**

- The package **exists and ships** at `packages/shared/recipe-core/`, as required.
- ⚠️ **It is published as `@kitchensink/recipe-core`, not `@kitchensink/shared-recipe-core`.** The shipped
  name is authoritative; the eight downstream features were corrected to it in the 2026-08-02 sweep.
  The `shared-` prefix in this rule's body is a GR-009 artifact — see the GR-009 note below, which records
  that no shipped package follows the `{group}-{name}` pattern.
- `packages/shared/*` also ships `clerk-verify`, `identity-core`, and `identity-db`.

---

## GR-008: Node.js Runtime Version

**Severity**: WARNING (downgraded from CRITICAL after S-003 decision)
**Resolves**: WA-001 (Node version mismatch), S-003
**Source**: `cross-feature-consistency-report.md` §2.3, §8 S-003; `002-user-auth/review.md` Revision 1

### Rule

All workspaces, including AWS Lambda functions, **MUST** target Node.js 24.x. The monorepo root `package.json` enforces `>=24.0.0`. No feature may specify a lower runtime version without a documented constitutional waiver.

Lambda Node.js 24.x runtime is available in all commercial AWS regions. The "Lambda only supports 22.x" justification is no longer valid.

### Acceptance Criteria

- **AC-008-a**: Feature 002's `plan.md` and `tech-stack.md` specify Node.js 24.x for Lambda runtime (not 22.x).
- **AC-008-b**: All CDK stack definitions in feature 002 use `Runtime.NODEJS_24_X`.
- **AC-008-c**: No feature spec or plan specifies a Node.js version below 24.x without a written waiver approved by the product owner.

### Violation

A feature plan or CDK definition that specifies Node.js 22.x or lower is non-conformant. It must be corrected before the feature's infrastructure code is written.

### Current State (2026-05-10)

- Feature 002 `plan.md:22` still says "Node.js 22.x (Lambda runtime)". **Correction required** (tracked as deferred follow-up in `002/review.md` Revision 1).
- All other features inherit the root `>=24.0.0` constraint and are conformant.

---

## GR-009: Package Naming Convention

**Severity**: WARNING
**Resolves**: S-002 (package naming standard)
**Source**: `cross-feature-consistency-report.md` §8 S-002; `002-user-auth/review.md` Revision 1

### Rule

**Amended 2026-08-02** — see [Change Log](#change-log) v2.0.0. The original `@kitchensink/{group}-{name}`
pattern was ratified when no implementation packages existed. Twenty-six now do and **none** follow it, so
the rule is restated to describe the two scopes actually in use. The superseded pattern is preserved at the
end of this section.

Package **scope** is determined by what consumes the package, and **placement** determines the name:

| Scope           | Contains                                                 | Directory                                                     | Name                  |
| --------------- | -------------------------------------------------------- | ------------------------------------------------------------- | --------------------- |
| `@kitchensink/` | Platform: services, workers, clients, shared libs, tools | `packages/{services,shared,clients,tools,utils,infra}/{name}` | `@kitchensink/{name}` |
| `@commise/`     | The Commise product's apps and UI-facing packages        | `packages/apps/commise/{name}`                                | `@commise/{name}`     |

Within `@kitchensink/`, the **name carries the role as a suffix**, not a group as a prefix:

| Role                       | Suffix            | Example                              | Directory                           |
| -------------------------- | ----------------- | ------------------------------------ | ----------------------------------- |
| Deployable HTTP service    | `-service`        | `@kitchensink/recipe-service`        | `packages/services/recipe-service/` |
| Lambda / background worker | `-workers`        | `@kitchensink/recipe-workers`        | `packages/services/recipe-workers/` |
| Typed client for a service | `-service-client` | `@kitchensink/recipe-service-client` | `packages/clients/recipe-service/`  |
| Shared library             | _(none)_          | `@kitchensink/recipe-core`           | `packages/shared/recipe-core/`      |
| Tooling config             | _(none)_          | `@kitchensink/eslint`                | `packages/tools/eslint/`            |

Within `@commise/`, a front-end feature package is `@commise/features-{domain}` in
`packages/apps/commise/features/{domain}/`.

**Canonical examples** (all shipped):

- `@kitchensink/recipe-core`, `@kitchensink/identity-service`, `@kitchensink/recipe-workers`,
  `@kitchensink/food-service-client`, `@kitchensink/clerk-verify`
- `@commise/web`, `@commise/mobile`, `@commise/ui`, `@commise/features-recipes`

> **Superseded (v1.0.0, 2026-05-10)**: `@kitchensink/{group}-{name}` with group examples `data`, `shared`,
> `auth`, `ui`, `apps`, `tools`, and canonical examples `@kitchensink/shared-recipe-core`,
> `@kitchensink/data-usda`, `@kitchensink/auth-client`, `@kitchensink/auth-server`,
> `@kitchensink/ui-components`. **No package was ever published under this pattern.** It is recorded here
> rather than deleted, per the amendment process's "no rule may be silently removed".

### Acceptance Criteria

- **AC-009-a**: Every `package.json` under `packages/` uses `@kitchensink/{name}` or `@commise/{name}`,
  with the scope chosen per the table above.
- **AC-009-b**: Feature plans that reference package names use this convention, and place each package in
  the directory its scope and role dictate.
- **AC-009-c**: A deployable HTTP service is named `-service` and a worker bundle `-workers`. A shared
  library takes no role suffix. No package invents a third scope.
- **AC-009-d**: A new package's name and directory are checked against this rule at plan time, not after
  it is published — renaming a published workspace package breaks every importer.

### Violation

A package whose scope, directory, or role suffix disagrees with the table above is non-conformant and must
be corrected **before it is first published**. Renaming after publication is a breaking change to every
importer and requires its own migration.

### Current State (2026-08-02)

**Conformant.** The amendment restated the rule to match the 26 shipped packages, so the portfolio is
conformant by construction rather than by 26 renames.

- `@kitchensink/`: `recipe-core`, `identity-core`, `identity-db`, `clerk-verify`, `identity-service`,
  `identity-webhooks`, `food-service`, `recipe-service`, `recipe-workers`, `food-service-client`,
  `recipe-service-client`, `usda-client`, `identity-utils`, `infra-global`, `service-test-harness`,
  `loadtest`, `eslint`, `prettier`, `typescript`, `vitest`, `esbuild`.
- `@commise/`: `web`, `mobile`, `ui`, `i18n`, `features-recipes`, `features-account`, `features-core`,
  `test-utils`.
- Features 007–014 were corrected to these forms in the 2026-08-02 sweep, and to
  `@kitchensink/{domain}-service` / `-workers` for new packages, matching feature 005's `ai-service`.
- ⚠️ **One inconsistency the amendment does not paper over**: `@commise/test-utils` sits in
  `packages/tools/test-utils/`, which is a `@kitchensink/` directory by the table above. Every other
  tooling package (`eslint`, `prettier`, `typescript`, `vitest`, `esbuild`) is `@kitchensink/`. This is
  either a mis-scoped package or a deliberate exception; it is **not** resolved here because renaming it
  is a code change, not a spec change. Tracked in `spec-sweep-2026-08-02.md`.

---

## GR-010: EU AI Act Compliance Propagation

**Severity**: WARNING
**Resolves**: WA-006 (EU AI Act not propagated to 006/009)
**Source**: `cross-feature-consistency-report.md` §5.6, §6 WA-006

### Rule

Any feature that displays or delivers AI-generated content to end users **MUST** implement the EU AI Act transparency disclosure defined in Feature 005. The disclosure is not optional for EU users and takes effect August 2, 2026.

Features 006 (AI meal suggestions) and 009 (AI recipe swaps) generate AI content via Feature 005's provider. They are subject to the same disclosure requirement as Feature 005.

### Acceptance Criteria

- **AC-010-a**: Feature 006's `spec.md` includes an explicit reference to Feature 005's EU AI Act compliance requirement and states that AI-generated meal suggestions must carry the same transparency disclosure.
- **AC-010-b**: Feature 009's `spec.md` includes the same reference for AI recipe swaps.
- **AC-010-c**: The disclosure UI component is implemented in `@kitchensink/shared-recipe-core` or a shared UI package, not duplicated per feature.
- **AC-010-d**: The disclosure is live before August 2, 2026 for all features that generate AI content.

### Violation

A feature that delivers AI-generated content without the EU AI Act disclosure after August 2, 2026 is a legal compliance failure. This is not a documentation issue — it is a release blocker.

### Current State (2026-05-10)

- Feature 005: EU AI Act compliance defined in `spec.md:18`.
- Features 006, 009: no EU AI Act mention. **Correction required before implementation.**

---

## GR-011: Notification System Ownership

**Severity**: WARNING
**Resolves**: WA-004 (notification system has no owner)
**Source**: `cross-feature-consistency-report.md` §5.3, §6 WA-004

### Rule

Push, email, and in-app notification delivery infrastructure must have a single owning feature. Features that need to send notifications must publish events to the notification system — they must not implement their own delivery mechanism.

**Decision (2026-05-10)**: Feature 014 (Notification Service) owns notification delivery infrastructure. Features 001, 003, 005, 008, and 009 that reference notification behavior must declare a dependency on 014 and publish notification events via 014's API.

### Acceptance Criteria

- **AC-011-a**: Feature 014's `spec.md` defines the notification delivery contract (event schema, delivery channels, retry policy).
- **AC-011-b**: Features 001, 003, 005, 008, 009 update their `spec.md` dependency tables to list 014 as a dependency for notification delivery.
- **AC-011-c**: No feature other than 014 implements push, email, or in-app notification delivery code.

### Current State (2026-05-10)

- Feature 014 exists in the portfolio. Its spec must define the notification contract before any other feature implements notification behavior.
- Features 001, 003, 005, 008, 009 must update their dependency tables once 014's contract is defined.

---

## GR-012: Subscription Gating Mechanism

**Severity**: INFO (elevated from INFO — shared decorator must be available before consumers implement)
**Resolves**: IN-003 (010 gating mechanism defined in isolation)
**Source**: `cross-feature-consistency-report.md` §6 IN-003

### Rule

The `@RequirePremium()` decorator and `PlanGuard` defined in Feature 010 **MUST** be published to a shared package before any other feature implements premium feature gating. Features 004, 005, 006, 007, and 009 must import the decorator from the shared package — they must not implement their own gating logic.

The shared package is `@kitchensink/auth-server` or a dedicated `@kitchensink/shared-subscription` package (to be decided during Feature 010's implementation planning).

### Acceptance Criteria

- **AC-012-a**: Feature 010's `tasks.md` includes a task to publish `@RequirePremium()` and `PlanGuard` to a shared package before any consumer feature implements premium gating.
- **AC-012-b**: Features 004, 005, 006, 007, 009 declare the shared subscription package as a dependency.
- **AC-012-c**: No feature other than 010 defines its own subscription tier check logic.

### Current State (2026-05-10)

- Feature 010 defines the gating mechanism in isolation. No shared package exists.
- This rule applies when Feature 010 enters implementation.

---

## GR-013: Persona Library Compliance

**Severity**: WARNING
**Resolves**: §12 per-feature persona remap
**Source**: `cross-feature-consistency-report.md` §9, §12

### Rule

All feature `product-spec/product-spec.md` files **MUST** source personas exclusively from the canonical persona library defined in `cross-feature-consistency-report.md` §9. Per-feature one-off personas are prohibited.

Internal/operational roles (Support Operator, Operations Engineer, Coach/Trainer, Compliance Reviewer) **MUST** be moved to a separate `## Internal Stakeholders` section and must not appear in the primary persona slots.

The following persona names are banned from user-facing persona sections: `Jordan` (moved to Internal Stakeholders), unnamed roles such as "Active Home Cook" or "Accessibility-Sensitive Cook" (must be remapped to canonical IDs).

### Acceptance Criteria

- **AC-013-a**: Every feature's `product-spec/product-spec.md` uses only canonical persona IDs (P1–P13) in its primary/secondary/tertiary persona slots.
- **AC-013-b**: Internal stakeholder roles appear only in a separate `## Internal Stakeholders` section.
- **AC-013-c**: Feature 008's unnamed personas ("Active Home Cook", "Accessibility-Sensitive Cook") are remapped to P1 Casey and P2 Taylor respectively.
- **AC-013-d**: The persona remap table in `cross-feature-consistency-report.md` §12 is the authoritative assignment for all features.

### Current State (2026-05-10)

- Features 001, 002 have been revalidated with canonical personas.
- Features 003–014 require persona remap during their revalidation passes.

---

## GR-014: Audience and Sharing Model

**Severity**: WARNING
**Resolves**: S-004 (sharing and audience model)
**Source**: `cross-feature-consistency-report.md` §10

### Rule

All shareable entities (recipes, collections, meal plans, lessons, profiles) **MUST** use the unified audience model defined in `cross-feature-consistency-report.md` §10. Ad-hoc per-feature sharing concepts are prohibited.

**Canonical audience scopes**: `private`, `circle`, `public`, `public-profile`, `published-lesson`.

**Amended 2026-08-02** — see [Change Log](#change-log) v3.0.0.

**Recipe visibility is binary.** A recipe is `private` or `public`. There is **no premium, paywalled, or
purchasable recipe state**, and no feature may introduce one.

- `private` — owner only. It MAY be shared with contacts **read-only** via `circle`; sharing grants read
  access, never write access, and is never a sale.
- `public` — readable by any authenticated user (`001-FR-004`).
- `public-profile` — a **surfacing** concern only: displaying a creator's already-`public` content on their
  `@handle` page. It is **not** a third visibility state, and a recipe does not need a `CreatorProfile` to
  be publicly readable.

The `Circle` entity is owned by Feature 011. The `CreatorProfile` entity is owned by Feature 012. Features that need these entities must declare a dependency on the owning feature.

### Acceptance Criteria

- **AC-014-a**: Features 001, 004, 006, 007, 010, 011, 012, 013 use the `audience` field with
  `{ scope, ref_id? }` shape on all shareable entities.
- **AC-014-b**: No feature defines its own sharing primitive that duplicates `Circle` or `CreatorProfile`.
- **AC-014-c**: Every audience change is audit-logged (compliance requirement).
- **AC-014-d**: `price_cents` appears **only** on a `published-lesson` audience. Courses are purchasable
  (`013-FR-003`); recipes and collections are not. A priced recipe audience is a violation.
- **AC-014-e**: **Ingestion provenance sets the initial scope, and there is exactly ONE implementation of
  the rule.** A recipe created from an external source is `public` only when that source is **publicly and
  freely available and not otherwise marked or licensed** against republication — paywall, subscription,
  explicit reservation, or a licence forbidding redistribution or derivatives. Otherwise it is created
  `private`, and the system MUST NOT auto-publish it.

    The decision is made by the **shipped pure policy** `evaluateVisibility`
    (`packages/services/recipe-service/src/recipes/domain/visibility-policy.ts`), keyed on the shipped
    `sourceType` taxonomy — `imported_public`, `imported_physical`, `imported_paid`, `user_created`. No
    feature may reimplement it: `004-FR-011` states this explicitly, and `011` calls it rather than deciding
    visibility itself. `imported_paid` may **never** be public; `imported_physical` is private-only.

- **AC-014-f**: **Attribution and source linking are required** for every ingested recipe, whichever scope
  it lands in, and a recipe MUST NOT be publishable while attribution is absent.

### Violation

Introducing a paywalled or purchasable recipe state — by any name — is a violation of this rule, as is
carrying `price_cents` on a recipe audience or auto-publishing an ingested recipe whose source was marked,
licensed, or paywalled against republication.

### Current State (2026-08-02)

- The unified audience model is defined in `cross-feature-consistency-report.md` §10, amended in step with
  this rule.
- **`011`** records the model and owns the primitives: `011-FR-021a` (a photo-digitized recipe is created
  `private` — its source is not publicly available) and `011-FR-021b` (attribution required, and required
  before publishing). The `circle` scope with member read-only access is `011` US-006.
- **`012`** carried a `premium recipe` / `paid follow` model in both its spec and its v-model. **Withdrawn**
  2026-08-02; `012` now keeps a Retired Requirement IDs register so the withdrawn IDs are never reused.
- ✅ **`004` conforms — the carve-out landed on `main` while this sweep was open** (PRs #80, #82).
  `004-FR-011` no longer says imports are always public: it classifies by provenance into the four
  `sourceType` values and delegates enforcement to 001's shipped `evaluateVisibility`. `004-FR-013` creates
  physical-copy imports private; `004-FR-014` rejects known paywalled sources before any outbound request;
  `004-FR-014a` requires attestation plus a source citation for pasted content; `004-FR-028` gates every
  non-public import channel behind premium. An earlier revision of this sweep flagged the carve-out as
  missing — it is not.

---

## GR-015: API Contract Ownership

**Severity**: CRITICAL
**Ratified**: 2026-08-11
**Normative source**: [`docs/CODING_STANDARDS.md` §15](../docs/CODING_STANDARDS.md) — **§15 wins on any
detail this rule summarizes.** Reasoning and rejected alternatives:
[`docs/architecture/decisions/0014-service-owned-api-contracts.md`](../docs/architecture/decisions/0014-service-owned-api-contracts.md).
**Resolves**: silent wire-contract drift between services and their clients (measured 2026-08-11: 276 + 144
lines of independently declared client wire types, agreeing with nothing)

### Rule

For every HTTP service in this portfolio, **the service is the single authoritative author of its wire
contract**, and every consumer imports types the service owns. The rule has a service half and a client
half, and **both halves are mandatory**.

#### 15-a. The service's obligation

1. Zod schemas are **AUTHORED IN THE SERVICE** at `packages/services/<service>/src/**/*.schema.ts`, beside
   the controller they serve.
2. The service **validates its own requests with that same zod**, via `nestjs-zod`'s `createZodDto`. Server
   and clients therefore check against one authored definition, not two that agree by convention.
3. A generated, **committed** package `packages/schemas/<service>` (`@kitchensink/schema-<service>`) exports
   the zod (`schemas.ts`), the `z.infer` types (`types.ts`), a `contract-hash.ts`, a barrel (`index.ts`), and
   a **derived** `openapi.yaml`.
4. `openapi.yaml` is derived **from the zod**, and exists for `oasdiff`, docs, and external integrators. It
   is **NOT a codegen input** — deriving types through it is rejected (ADR-0014, alternative 1).
5. A `*.schema.ts` file may import **only `zod` and other `*.schema.ts` files**. This is enforced in code,
   not by convention.
6. The schema package carries **no runtime dependency on the service graph** (no NestJS, no drizzle, no
   aws-sdk). An `import type` dependency on a shared domain package such as `@kitchensink/recipe-core` is
   fine — it erases at compile time.
7. **One contract document per service, and it REPLACES any hand-written predecessor.** A generated document
   added alongside a hand-maintained one makes the problem worse.

#### 15-b. The client's obligation — separately mandatory

**A feature that mandates only 15-a has not satisfied this rule.** Mandating only the service side is
exactly how the client half got skipped, and it is why the drift survived behind green builds.

1. Every client imports its wire types **and** its runtime zod from `@kitchensink/schema-<service>`.
2. **A `packages/clients/*` package MUST NOT declare a type describing a request or response body of a
   service in `packages/services/*`.** A client's own `types.ts` holds only genuinely client-side types —
   config, options, its own error shapes — never a wire shape.
3. Where a consumer's shape **genuinely differs** from the wire shape (a view model, a form model, a
   narrowed projection), it is **DERIVED** from the wire type with `Pick` / `Omit` / `Partial` / mapped
   types — **never independently declared**. Reference implementation:
   `packages/apps/commise/features/recipes/src/filters/model.ts`.
4. App and feature packages (`packages/apps/commise/**`) are bound by 15-b.2 and 15-b.3 identically. The rule
   is about who authors a wire shape, not about which directory it lives in.
5. **A new endpoint is not complete until its types are reachable from the schema package.** "The client will
   add the type" is a contract fork, not a task.

#### 15-c. Drift gates — a new feature inherits these rather than reinventing them

All three are required; each catches what the others cannot.

| Layer                     | Mechanism                                                                                                                   | Catches                                                                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **Rebuild** (turbo)       | `schema-<service>#build` `dependsOn` `<service>#build`, with `inputs` covering the service's `*.schema.ts`                  | a stale schema package after a service edit                                               |
| **Correctness** (CI)      | regenerate and fail on any diff against the committed artifacts                                                             | generated output someone hand-edited; a contract changed without regenerating             |
| **Skew** (runtime)        | `CONTRACT_HASH` over the service's `*.schema.ts`, embedded in **both** the service and the schema package, asserted at boot | a **deployed** service running ahead of a consumer's pinned schema — the live mobile case |
| _(additionally worth it)_ | `oasdiff breaking` against the base branch                                                                                  | breaking contract changes, **with a stated blind spot** — see the honest limit below      |

The `oasdiff` blind spot must be stated, not glossed: `@nestjs/swagger` emits **no response schema** for a
handler returning an `interface`, so until every response type is zod-derived or a decorated class, that
check cannot see response changes — which is most of what actually breaks a client.

#### 15-d. THE EXCEPTION — a third-party API is the OPPOSITE case, and converging it deletes a security boundary

For an API the platform does **not** serve — **USDA FoodData Central, Clerk, Vercel, Stripe, an OCR
provider, an LLM provider, a grocery-retailer API** — there is **no service of ours to own the type** and the
upstream contract **cannot be trusted**.

- Those clients **MUST validate the raw upstream wire shape at the boundary with zod**, the moment a body
  arrives.
- Those clients **MAY declare their own types**, and the normalized type they return **may deliberately
  differ** from the raw upstream shape.
- **No OpenAPI document is written for an API we do not serve.**
- `packages/clients/usda` is the **reference implementation**. Its `schemas.ts` **must never be
  "converged"** under 15-b.

15-b's reasoning does not reach this case: duplication is only wrong when one side could have been derived
from the other, and here it could not — the other side belongs to someone else and can change without
telling us. **Applying 15-b mechanically to a third-party client replaces a checked parse with unchecked
trust in a remote party's JSON.** That is a security regression, not a consistency win.

### Relationship to GR-007

GR-007 governs **domain** types (`Recipe`, `Collection`, `User`, `PaginatedResponse`) and puts them in
`@kitchensink/recipe-core`. GR-015 governs **wire** types — the endpoint envelopes. Different axes; neither
replaces the other. A schema package **reuses `recipe-core` type-only and never re-declares its types**:
re-declaring `Recipe` or `PaginatedResponse` to make a schema package literally dependency-free would
manufacture the exact drift GR-015 exists to prevent.

### Acceptance Criteria

- **AC-015-a**: Every feature that owns or extends an HTTP service names, in its API-contract section, the
  **owning service**, the **schema package**, and **every consuming client/app package**.
- **AC-015-b**: Every such feature states the client obligation (15-b) explicitly, not by implication.
- **AC-015-c**: No `packages/clients/*` or `packages/apps/**` file declares a request/response body type of a
  `packages/services/*` service. Divergent consumer shapes are `Pick`/`Omit`/`Partial` derivations.
- **AC-015-d**: All three drift gates (15-c) are wired for every service that has a schema package.
- **AC-015-e**: Every feature that consumes a third-party API records the 15-d exception prominently in its
  own spec, so a contributor applying 15-b mechanically is stopped before deleting a boundary.
- **AC-015-f**: No feature introduces a second contract artifact for a service that already has one, and no
  hand-written OpenAPI document is treated as normative once a generated one exists for that service.

### Violation

- A client, app, or feature package that declares a wire shape of one of our services is in violation; **the
  client is the one that changes.**
- A feature spec that mandates 15-a without 15-b is in violation even if the shipped service is correct — the
  spec is the artifact that lets the next contributor skip the client half.
- Deleting a third-party client's boundary schemas in the name of this rule is a violation of **15-d**, and
  is treated as a security regression rather than a style disagreement.
- Hand-editing a generated schema package is a violation; CI discards it rather than shipping it.

### Current State (2026-08-11) — IN PROGRESS, NOT SATISFIED

This rule is being propagated into the specs at the same time the code is being converged. Nothing below
should be read as a completed migration.

- ✅ `@kitchensink/schema-recipe` exists at `packages/schemas/recipe` with `schemas.ts`, `types.ts`,
  `contract-hash.ts` and a barrel. **Converged so far: the search / photos / ratings vertical only.**
- 🔄 **Food and identity are being converged now.** Neither has a schema package yet.
- ❌ **`openapi.yaml` does not exist for any service.** `@kitchensink/schema-recipe`'s `package.json` already
  declares the `./openapi.yaml` export, so that export currently names a file that has not been generated.
- ❌ `specs/001-commise-recipe-app/contracts/api.openapi.yaml` — 2810 hand-written lines cited as authority
  by 57 source files, verified by nothing — is **superseded in principle** by recipe's generated document,
  but the generated document does not exist yet, so the citations have **not** been repointed.
- ⚠️ Features **006–010** do not identify an owning service package for their endpoints at all. Each carries
  an **OPEN** marker to that effect; the obligation applies to whichever service ends up owning the paths.
- ⚠️ **Feature 013** specified `packages/shared/cooking-school-contracts`, which predates this rule.
  Corrected in its plan to `packages/schemas/cooking-school`.

---

## GR-016: Input Validation at Every Boundary

**Severity**: CRITICAL
**Ratified**: 2026-08-12
**Normative source**: [`docs/CODING_STANDARDS.md` §15.4](../docs/CODING_STANDARDS.md) — **§15.4 wins on any
detail this rule summarizes.** Reasoning and rejected alternatives:
[`docs/architecture/decisions/0015-input-validation-at-every-boundary.md`](../docs/architecture/decisions/0015-input-validation-at-every-boundary.md).
**Relates to**: [GR-015](#gr-015-api-contract-ownership) — GR-015 decides **who authors** the zod; GR-016
decides **where that zod must run**. Neither is satisfied by the other.
**Resolves**: owner directive 2026-08-12 — _"all services and specs must be updated to require input
validation"_, clarified as _"the database schema is the minimum level of validation we should use for all
input"_. Measured 2026-08-11: input validation is **three different mechanisms** across three services and
**one service has no validation pipe at all**.

### Rule

**Every input a service accepts is parsed at the boundary against the service's own authored zod, before any
branch, any write, and any outbound call.** Downstream code receives a parsed type; it never re-checks an
`unknown`, and it never hand-writes its own error path.

#### 16-a. One mechanism per service, and it is the service's authored zod

1. Request bodies, path parameters, query parameters and headers a handler reads are validated by the
   **same** `*.schema.ts` zod GR-015 §15-a already requires the service to author — via `nestjs-zod`'s
   `createZodDto` plus `nestjs-zod`'s `ZodValidationPipe`. There is no second DTO, no `class-validator`
   decorator set, and no per-method `safeParse` that agrees with the schema by convention.
2. **A service has exactly one validation mechanism.** Two mechanisms in one service means two error
   contracts, two sets of edge cases and two things to keep in step; the mechanism a route uses must not be
   a per-file accident.
3. **Validation failure has ONE path per service**, producing a `400` that names the offending field(s).
   Hand-written per-method messages are prohibited because they lose the distinction between the failures
   they are reporting. Measured on `@kitchensink/food-service`, which takes `@Body() body: unknown` and
   hand-writes `safeParse` per method: a **wrong-typed field**, a **missing field** and an **unknown key**
   all report `{ error: 'Empty name' }`.
4. **`unknown` is not a validation strategy.** A handler signature of `@Body() body: unknown` moves the
   parse into the method body, where it is optional by construction and gets skipped on the next endpoint.

#### 16-b. The surfaces a pipe never sees are in scope — queues, events, and webhooks

A NestJS pipe covers HTTP only. These ingress points carry attacker- or transport-influenced data and are
**equally in scope**:

- **Queue and event consumers** — `packages/services/recipe-workers/src/handlers/*` (erasure worker, archive
  and erasure sweepers, handle-sync, version-archive) and food's change-refresh / SQS consumers
  (`packages/services/food-service/src/worker/**`, `src/events/**`). An SQS message body is a string the
  producer chose; it is parsed against an authored zod before it becomes a job.
- **Webhooks** — `packages/services/identity-webhooks/src/handlers/*`. `identityWebhook.ts` verifies the
  **svix signature**, and that verification is required and stays. ⚠️ **But a signature proves ORIGIN, not
  SHAPE.** A correctly signed Clerk payload whose fields moved, went null, or gained a member is still an
  unvalidated body, and it is being written to the identity database. The body is schema-validated **after**
  signature verification — both, in that order, never one instead of the other.
- **Scheduled/self-triggered invocations** are the one case where the payload is ours end to end; they still
  parse their event, because "ours" is an assumption about a deploy that has already drifted once.

#### 16-c. No data reaches a database or another service unvalidated

1. **Inbound to storage**: the value written to a column has been through the boundary parse. A DAL is not
   where input first meets a constraint.
2. **Outbound to another service**: the request body is validated against the **callee's** schema package
   zod (GR-015 §15-b) before the call is made, so a malformed outbound payload fails in the caller with a
   usable stack rather than as a remote `400`.
3. **Inbound responses are validated on receipt** by the calling client, at the moment the body arrives.
4. The service-to-service edges in this portfolio are named so none is treated as internal-and-therefore-
   trusted:
    - **recipe → food** — the ingredient/catalog reads via `@kitchensink/food-service-client`.
    - **identity's erasure fan-out Lambda → recipe and food** —
      `POST /api/v1/internal/account/erasure` on both, from
      `packages/services/identity-webhooks/src/common/erasure-fanout.ts`.

    ⚠️ **16-c.3 is NOT response validation on the service side** — see 16-g. The receiving **consumer**
    parsing what it got is required; the **producing service** validating what it emits is deliberately
    deferred. The distinction is the point: a consumer that parses is defending itself, which it may do
    unilaterally.

#### 16-d. The database schema is the FLOOR — and this is an ASSERTION, never a derivation

**Every input field that writes a bounded column MUST be validated at least as strictly as that column can
store.** Numeric range, string length, numeric precision/scale, enum domain and nullability are the floor;
a value the column cannot hold is rejected as a **`400` at the boundary**, never as a failed `INSERT`.

The live defect this comes from (measured 2026-08-11, recipe): five int-backed wire fields — `servings`,
`prepTimeMinutes`, `cookTimeMinutes`, `totalTimeMinutes`, `timerSeconds` — carried **no upper bound** while
writing `integer` (`int4`) columns capped at **2,147,483,647**. So `servings: 9999999999` **passed
validation** and failed at the `INSERT`: **a 500 that should have been a 400**, on a plain user input.

⚠️ **The floor is an ASSERTION about two independently authored artifacts, NOT a derivation between them.**

- **Zod is never generated from drizzle**, and a **wire type never imports a storage type.** That coupling is
  precisely what ADR-0014 removed: `RecipeSearchResponse.facets` took its wire type from
  `../dal/search.dal.js`, and that was the disease, not the cure. GR-015 §15-a.5 (a `*.schema.ts` imports
  only `zod` and other `*.schema.ts` files) is not weakened by this rule — it is unchanged.
- The two artifacts stay independent and are **required to agree in one direction only**: the wire bound is
  at least as tight as the column. A schema may be **stricter** than storage, and usually should be.
- **The floor is a floor, not a target.** Recipe's text columns are `text()` — **unbounded** in PostgreSQL —
  so a character limit on a title, a step or a note is a **product decision with no storage floor to derive
  from**. "The column allows it" is not an argument for accepting it.

#### 16-e. Two mechanism hazards that are invisible by construction

Both are recorded here because a reviewer cannot see either one by reading the route.

1. **`createZodDto` requires `nestjs-zod`'s `ZodValidationPipe`.** Under Nest's own built-in
   `ValidationPipe`, a `createZodDto` DTO **validates nothing while looking correctly wired** — the schema is
   present, the DTO is referenced, the route reads as validated, and no input is checked. This already bit
   identity on **`PATCH /users/me`**, a route that writes user data. A service therefore states which pipe is
   registered, and the only way to observe the failure is a test that posts a known-bad body to a real route
   and asserts the `400`.
2. **`z.object()` strips unknown keys silently; `z.strictObject()` rejects them.** A requirement that says
   "validate the input" without naming which one **permits silent data loss** — a client that misspells a
   field gets a `200` and no write. Each request surface names its choice explicitly rather than inheriting
   zod's default by accident.

#### 16-f. No request-derived value may reach `sql.raw()`

`sql.raw` **bypasses parameterisation by design** — that is what it is for. Measured 2026-08-11, only three
sites pass it a non-literal argument, and **all three take a config value or a module constant, so none is
currently reachable from user input**: the recipe search DAL
(`packages/services/recipe-service/src/search/dal/search.dal.ts`) and two recipe workers
(`erasure-sweeper.ts`, `erasure-orphan-sweeper.ts`).

That is the state to preserve, not a clean bill of health: the rule is that a **request-derived value must
never reach `sql.raw()`**, directly or through a variable. Where a request legitimately selects an
identifier (a sort column, a partition, an index hint), the validated **enum maps to a closed allowlist of
literals in code** — the request supplies the key, never the SQL fragment. Every other query is
parameterised.

#### 16-g. ⛔ Response validation is DEFERRED — deliberately. Do NOT "complete" it.

**Zero of the three services validates its own responses, and that is an owner decision, not an oversight.**
TypeScript at the boundary plus client-side validation on receipt (16-c.3) were judged sufficient for now.
A contributor who "finishes the job" by adding server-side response parsing is **undoing a decision**, not
closing a gap.

This rule therefore requires **INPUT** validation and **MUST NOT** be read as requiring response
validation. The known cost is recorded rather than hidden: GR-015 §15-c's `oasdiff` blind spot means
response changes are weakly gated. That is an argument about the drift gates, not a licence to reverse this
deferral. Reversing it needs its own proposal under the [amendment process](#governance-amendment-process).

### Acceptance Criteria

- **AC-016-a**: Every feature that owns or extends a service names, in its contract section, the **single**
  validation mechanism that service uses, and states that the validating zod is the same authored zod
  GR-015 requires.
- **AC-016-b**: Every feature enumerates its **non-HTTP ingress** — queue consumers, event consumers,
  webhooks, scheduled invocations — and states that each parses its payload against an authored zod. A
  feature with no such ingress says so.
- **AC-016-c**: Every feature with a service-to-service call names the edge and states both halves:
  outbound body validated before send, inbound response validated on receipt.
- **AC-016-d**: Every feature that writes to a bounded column states the **storage floor** obligation, and
  states that it is an assertion rather than a derivation (no zod generated from drizzle; no wire type
  importing a storage type).
- **AC-016-e**: Every feature whose service uses `createZodDto` states that `nestjs-zod`'s
  `ZodValidationPipe` is the registered pipe, and that a bad-body route test is what proves it.
- **AC-016-f**: Every request surface's unknown-key behaviour (`z.object` vs `z.strictObject`) is named
  explicitly in the feature that owns it.
- **AC-016-g**: No feature requires, plans, or tasks **server-side response validation** while the 16-g
  deferral stands, and every feature that discusses validation records the deferral so it is not "fixed".
- **AC-016-h**: No feature introduces a code path where a request-derived value can reach `sql.raw()`.

### Violation

- A handler that accepts `unknown` and parses inside the method body is in violation, even if the parse is
  correct today — the obligation is that the parse cannot be skipped, not that it happened once.
- A second validation mechanism added to a service that already has one is a violation, and so is a
  `createZodDto` DTO served by Nest's built-in `ValidationPipe` — the latter is a violation that **passes
  review by looking right**.
- A queue, event or webhook handler that trusts its payload's shape is in violation. For a signed webhook,
  verifying the signature and stopping there is the specific violation: it proves origin, not shape.
- An input that writes a bounded column without at least that column's bound is a violation, and the symptom
  is a `500` where the contract owed a `400`.
- **Deriving zod from drizzle — or importing a storage type into a wire schema — is ALSO a violation**, of
  this rule and of GR-015 §15-a.5. Satisfying 16-d that way is not compliance.
- Adding server-side response validation while 16-g stands is a violation of 16-g.

### Current State (2026-08-12) — IN PROGRESS, NOT SATISFIED

Measured 2026-08-11, while two convergence efforts were live in the code. **Nothing below describes a
finished migration.**

| Service                         | `ZodValidationPipe` | `createZodDto` | Notes                                                                                                                                                  |
| ------------------------------- | ------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@kitchensink/recipe-service`   | 18                  | 26             | furthest along, but **19 files are still on `class-validator`** — two mechanisms in one service                                                        |
| `@kitchensink/food-service`     | **0**               | **0**          | **no validation pipe at all**; `@Body() body: unknown` + per-method `safeParse`, which is why three distinct failures report `{ error: 'Empty name' }` |
| `@kitchensink/identity-service` | 3                   | 4              | smallest surface; `PATCH /users/me` is the `createZodDto`-under-the-wrong-pipe case (16-e.1)                                                           |

- ❌ **Response validation: none, in any service — and that is the deferred state (16-g), not a gap to close.**
- 🔄 Recipe's `class-validator` residue and food's missing pipe are both being converged now.
- ⚠️ Features **006–010** still do not identify an owning service package for their endpoints (GR-015 Current
  State). GR-016 binds whichever service ends up owning those paths; the obligation does not wait on the
  answer.

**OPEN items — recorded, not resolved. No ruling has been made on either.**

- 🟠 **OPEN-GR-016-A — what mechanically enforces the storage floor (16-d)?** The obligation is clear; the
  thing that keeps it from rotting is not. **Question for the owner: is the floor enforced by a per-service
  parity test that enumerates bounded columns and asserts each writing wire field rejects an out-of-range
  value, or is it a review-checklist item?** A test is the only option that survives a later migration
  widening or narrowing a column, but it must not be built by importing drizzle types into the wire schemas,
  which 16-d forbids — so the shape of a conforming test is itself part of the question.
- 🟠 **OPEN-GR-016-B — is `z.strictObject()` the portfolio default for request bodies?** 16-e.2 requires the
  choice to be explicit per surface; it does not pick one, because the trade-off is real in both directions
  (rejecting unknown keys catches client typos; accepting them lets a newer client talk to an older
  service). **Question for the owner: is `strictObject` required for all mutating request bodies, with plain
  `z.object` permitted only where a forward-compatibility reason is documented at the schema?**

---

## Governance Amendment Process

Amendments to these rules require:

1. A written proposal in a PR description or linked issue documenting: the rule being changed, the rationale, and the impact on features already in implementation.
2. Approval by the senior product owner, documented in the PR or issue.
3. A version increment to this document following semantic versioning:
    - **MAJOR**: removal or incompatible redefinition of an existing rule.
    - **MINOR**: new rule added or existing rule materially expanded.
    - **PATCH**: clarification, wording correction, or non-semantic refinement.
4. An update to the `cross-feature-consistency-report.md` if the amendment resolves or changes the severity of a finding.

Downgrading a CRITICAL rule to WARNING requires explicit product owner approval and a documented justification. Downgrading a WARNING to INFO requires the same. No rule may be silently removed.

---

## Change Log

| Version | Date       | Author                                          | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------- | ---------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.2.0   | 2026-08-12 | Repository owner                                | **GR-016 added** (MINOR — new rule): Input Validation at Every Boundary. Every input is parsed at the boundary against the service's own authored zod (the GR-015 zod), through **one** mechanism per service with **one** `400` path — measured state was three mechanisms across three services and `@kitchensink/food-service` with **no pipe at all** (`@Body() body: unknown` + per-method `safeParse`, so a bad type, a missing field and an unknown key all report `{ error: 'Empty name' }`). Extends the obligation to the surfaces a pipe never sees — **queue/event consumers and webhooks**, where a svix signature proves **origin, not shape** — and to the service-to-service edges (recipe → food; identity's erasure fan-out → recipe/food `POST /api/v1/internal/account/erasure`): outbound validated before send, inbound validated on receipt. Makes **the database schema the validation FLOOR** (grounded in five int-backed recipe fields with no upper bound writing `int4`, so `servings: 9999999999` was a **500 that owed a 400**) while stating that the floor is an **assertion, never a derivation** — no zod generated from drizzle, no wire type importing a storage type, GR-015 §15-a.5 unchanged. Records the two invisible hazards (`createZodDto` under Nest's own `ValidationPipe` validates nothing while looking wired — it already bit identity's `PATCH /users/me`; `z.object` strips unknown keys where `z.strictObject` rejects) and forbids a request-derived value reaching `sql.raw()`. **Response validation is explicitly DEFERRED** by owner decision and must not be "completed". Normative source `docs/CODING_STANDARDS.md` §15.4; reasoning and rejected alternatives in ADR-0015. Two OPEN items recorded unresolved (GR-016-A floor enforcement mechanism, GR-016-B `strictObject` default). |
| 3.1.0   | 2026-08-11 | Repository owner                                | **GR-015 added** (MINOR — new rule): API Contract Ownership. The service authors its wire contract in zod at `src/**/*.schema.ts`, validates its own requests with it, and generates a committed `packages/schemas/<service>` package that clients import; `openapi.yaml` is derived and outbound-only, never a codegen input. **The client half (15-b) is separately mandatory** — a client declares no wire types and derives divergent consumer shapes with `Pick`/`Omit`/`Partial` — because mandating only the service side is how the client half got skipped. Records the three drift gates (15-c) and, prominently, the third-party exception (15-d): USDA/Clerk/Vercel/Stripe/OCR/LLM clients validate the raw upstream shape at the boundary and MAY declare their own types, so "converging" them deletes a security boundary. Normative source is `docs/CODING_STANDARDS.md` §15; reasoning and rejected alternatives in ADR-0014.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 1.0.0   | 2026-05-10 | Senior Product Owner (cross-feature governance) | Initial ratification. Converts all CRITICAL and WARNING findings from `cross-feature-consistency-report.md` into enforceable rules with acceptance criteria. Corrects all release audit reports to BLOCKED status. Establishes release readiness gate (GR-001) as the primary blocker for engineering handoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 3.0.0   | 2026-08-02 | Repository owner                                | **GR-014 amended** (MAJOR — incompatible redefinition): recipe visibility declared **binary** (`private` \| `public`); the missing `public` scope added, and `public-profile` demoted to a surfacing concern rather than a third visibility state; `circle` clarified as read-only; `price_cents` removed from the audience shape and restricted to `published-lesson`; ingestion-provenance and attribution criteria added (AC-014-d/e/f). Withdraws the premium-recipe and paid-follow model portfolio-wide. `cross-feature-consistency-report.md` S-004 amended to match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 2.0.0   | 2026-08-02 | Repository owner                                | **GR-009 amended** (MAJOR — incompatible redefinition): the `@kitchensink/{group}-{name}` pattern was ratified when no packages existed and none of the 26 shipped packages follow it. Restated to the two scopes actually in use, `@kitchensink/{name}` and `@commise/{name}`, with role suffixes (`-service`, `-workers`, `-service-client`) replacing group prefixes. Superseded pattern preserved in-section. **GR-002/GR-003/GR-007 Current State** refreshed against shipped `main`; GR-002 confirmed portfolio-wide with no exceptions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
