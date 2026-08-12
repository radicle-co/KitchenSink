# KitchenSink Cross-Feature Governance Rules

**Version**: 3.3.0
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
17. [Contract & Validation Conformance for Every NEW Service, Client and App (GR-017)](#gr-017-contract--validation-conformance-for-every-new-service-client-and-app)
18. [One Rejection Path, and Invalid Input Is Never Retried (GR-018)](#gr-018-one-rejection-path-and-invalid-input-is-never-retried)
19. [Identifier Integrity — No Sentinels (GR-019)](#gr-019-identifier-integrity--no-sentinels)
20. [Dual-Signal Principal Binding (GR-020)](#gr-020-dual-signal-principal-binding)
21. [Governance Amendment Process](#governance-amendment-process)

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

### Current State (refreshed 2026-08-12) — IN PROGRESS, NOT SATISFIED

This rule is being propagated into the specs at the same time the code is being converged. Nothing below
should be read as a completed migration. **Every figure here was re-measured against the tree on 2026-08-12**;
the previous revision's claims about `openapi.yaml` and about food/identity had gone stale within a day.

- ✅ **Three schema packages exist**, each with `schemas.ts`, `types.ts`, `contract-hash.ts`, a barrel **and a
  generated `openapi.yaml`**: `packages/schemas/recipe` (**8** published wire-schema files, `openapi.yaml`
  4,945 lines, 34 paths), `packages/schemas/food` (**5**, 922 lines, 12 paths), `packages/schemas/identity`
  (**5**, 716 lines, 10 paths) — all measured 2026-08-12.
    - ⚠️ **Note for anyone re-counting**: food and identity each hold **6** files matching `*.schema.ts` in the
      service, but only **5** are wire schemas. The sixth is `src/config/env.schema.ts`, the Zod **environment**
      schema, which is correctly **not** published. The `*.schema.ts` suffix is therefore overloaded — it does
      not by itself mean "wire contract". This is already handled deliberately rather than by accident:
      `@kitchensink/contract-gen`'s `discoverAuthoredSchemas` takes an `excludeFiles` list of **exact** relative
      paths each carrying a reason, fails on a **stale** exclusion, and separately rejects an authored wire
      schema that imports an excluded sibling — which would otherwise generate cleanly and ship a leaf package
      with a dangling import. **A new gate that globs the suffix must use that same exclusion list**, not its own.
- ✅ **`openapi.yaml` now exists for all three services.** The previous revision recorded "does not exist for
  any service"; that is **no longer true**, and `@kitchensink/schema-recipe`'s `./openapi.yaml` export now
  names a real file.
- 🔄 `specs/001-commise-recipe-app/contracts/api.openapi.yaml` — 2,827 hand-written lines (2,810 of body plus a
  17-line superseded-notice header) — is now **genuinely superseded**: recipe's derived document exists and
  covers **34 paths against the hand-written 32**. Citations, counted over **`git ls-files` only**: **12 files
  under `packages/`**, 26 under `specs/`, 5 under `docs/`. The **citations have not been repointed**, so two
  OpenAPI documents describe the recipe service and only one of them is verified. The hand-written file's own
  header still says "the replacement has NOT been generated yet" and is stale.
    - ⚠️ **Correction to an earlier figure in this document, and to ADR-0014.** A previous revision said "57
      source files" and a first pass at this refresh said "31 files under `packages/`". Both counted **build
      output** — `.next/standalone/`, `dist/` — because they globbed the worktree instead of the index. **Count
      citations with `git ls-files | xargs grep -l`.** An inflated count here is not harmless: it is the number
      someone will use to decide whether repointing is a small job or a large one.
- ✅ **Features 006–010 now identify an owning service package.**
  [ADR-0017](../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md) rules
  006 / 007 / 009 into `@kitchensink/recipe-service` (`@kitchensink/schema-recipe`) and 010 into
  `@kitchensink/identity-service` (`@kitchensink/schema-identity`), with 010's Stripe webhook in
  `@kitchensink/identity-webhooks`. **No new deployable service is created.** The four 🟠 OPEN markers are
  closed; a **schema package is per SERVICE, not per feature**, so none of these four gets its own.
- ⚠️ **Feature 013** specified `packages/shared/cooking-school-contracts`, which predates this rule. Corrected
  in its plan to `packages/schemas/cooking-school` — but its `tasks.md` **still creates the rejected location**
  (T-002, and T-015 which points event schemas at it), which is the 17-e.12 failure mode: the plan was amended
  and the task list was not.
- ⚠️ **`@kitchensink/schema-notifications` (014) does not exist and cannot yet be generated** — it is now
  unblocked, though: 014's three OPEN contract items were ruled on 2026-08-12 (see its _Resolved Questions_).

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

**Re-measured 2026-08-12** — two of those three rows have moved, and the one that has not is the one that
matters most:

| Service                         | `ZodValidationPipe` | `createZodDto`  | Change since 2026-08-11                                                                                    |
| ------------------------------- | ------------------- | --------------- | ---------------------------------------------------------------------------------------------------------- |
| `@kitchensink/recipe-service`   | 18                  | 26              | pipe counts unchanged, but the `class-validator` figure was **wrong by an order of magnitude** — see below |
| `@kitchensink/food-service`     | **0** committed     | **0** committed | 🔄 **5 / 3 in the working tree, uncommitted.** The committed state is still the violation                  |
| `@kitchensink/identity-service` | **6**               | **6**           | ✅ up from 3 / 4                                                                                           |

⛔ **CORRECTION — "19 `class-validator` files" was a MENTION count, not an importer count.** Measured
2026-08-12 with `grep -rl "from 'class-validator'"` over service sources, excluding `dist`: **exactly ONE file
imports it** — `packages/services/recipe-service/src/search/dto/search-recipes.query.dto.ts`. The 19 is the
number of files that mention the string, and almost all of those mentions are JSDoc **about migrating away from
it**. This figure appears in ADR-0015, in §15.4 and in earlier revisions of this rule, and it materially
misstates the size of the remaining work: recipe is **one file** away from one mechanism, not nineteen. Count
importers, not mentions.

⛔ **Food is still the live proof that GR-015 and GR-016 are separate obligations** — with a caveat that must be
stated rather than smoothed over. In **committed** `main` it satisfies GR-015 in full (5 published wire-schema
files, a committed `@kitchensink/schema-food`, a 922-line derived `openapi.yaml`) and **validates nothing**: a
reviewer looking only at the contract artifacts would see a conformant service. A fix is **in the working tree
and not yet committed** (5 `ZodValidationPipe` / 3 `createZodDto` sites, plus an untracked `foods.dto.ts`), so
this row will need one more pass once it lands. The argument the row makes does not depend on the fix being
absent — it depends on the two obligations having been independently satisfiable, which they were.

- ❌ **Response validation: none, in any service — and that is the deferred state (16-g), not a gap to close.**
- 🔄 Recipe's `class-validator` residue and food's missing pipe are both mid-convergence.
- ✅ Features **006–010** now identify an owning service package
  ([ADR-0017](../docs/architecture/decisions/0017-service-ownership-for-features-006-007-009-010.md)); GR-016
  binds `@kitchensink/recipe-service` (006, 007, 009) and `@kitchensink/identity-service` +
  `@kitchensink/identity-webhooks` (010).
- ⚠️ **006's and 009's `tasks.md` still specify `class-validator` DTOs**, which their own plans forbid. A task
  list is where a validation mechanism actually gets chosen, so a plan that says `nestjs-zod` while the tasks
  say `class-validator` will ship `class-validator`.

**OPEN items — BOTH RULED 2026-08-12.**

- ✅ **OPEN-GR-016-A — the storage floor is enforced by a per-service parity TEST**, not a review-checklist
  item, because a checklist cannot survive a later migration that widens or narrows a column. ✅ **And it is
  already BUILT**: `@kitchensink/contract-gen`'s `auditStorageCapacity` is wired by a `storage-capacity.test.ts`
  in **all three** services. The shape — which was itself part of the question, since 16-d forbids importing a
  storage type into a wire schema — is recorded in
  [GR-017 §17-d](#gr-017-contract--validation-conformance-for-every-new-service-client-and-app): it reads
  drizzle **structurally** via `Symbol.for('drizzle:Columns')` (so `contract-gen` needs no `drizzle-orm`
  dependency) and reads zod bounds via the **public** `z.toJSONSchema`; the field→column mapping is supplied per
  service; and the audit is **exhaustive over columns**, with `stale-account` and `duplicate-account` findings
  keeping the bookkeeping honest in the other direction. A new bounded column therefore fails the gate the day
  it is added.
- ✅ **OPEN-GR-016-B — `z.strictObject()` IS the portfolio default for mutating request bodies**, ruled in
  [GR-017 §17-c](#gr-017-contract--validation-conformance-for-every-new-service-client-and-app). Plain
  `z.object()` is permitted only where a forward-compatibility reason is documented at the schema, which in
  practice means a **read** surface. The trade is real in both directions and the ruling picks the one whose
  failure is **visible**: on a mutating body a silently stripped unknown key is a `200` plus a partial write the
  caller was told succeeded.

---

## GR-017: Contract & Validation Conformance for Every NEW Service, Client and App

**Severity**: CRITICAL
**Ratified**: 2026-08-12
**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../docs/CODING_STANDARDS.md) (contract ownership),
**§15.4** (input validation), **§15.5** (this rule's mechanical conformance list).
Reasoning: [ADR-0014](../docs/architecture/decisions/0014-service-owned-api-contracts.md),
[ADR-0015](../docs/architecture/decisions/0015-input-validation-at-every-boundary.md).
**Relates to**: [GR-015](#gr-015-api-contract-ownership) (who authors the contract),
[GR-016](#gr-016-input-validation-at-every-boundary) (where it runs). GR-017 adds **nothing new about what is
required** — it makes the two existing rules **checkable on a package that does not exist yet**.
**Resolves**: owner directive 2026-08-12 — the conformance posture must hold _"on all existing servers and
future servers as well as existing clients and future clients"_, and prose in fourteen feature specs will not
hold it.

### Why this rule exists separately from GR-015 and GR-016

GR-015 and GR-016 are stated as obligations on **features**. A feature is a document; a document cannot be
green. Every propagation of those two rules so far has been a paragraph added to a spec — which is necessary
(a contributor who never reads the rule cannot follow it) and **insufficient**, because the next service will
be created by someone who did not read the spec, or by an agent working from a task list.

The measured evidence that prose alone fails is in this repository's own history: GR-015 §15-b exists at all
because **mandating only the service side is how the client half got skipped**, and it got skipped behind green
builds. The same mechanism will skip a **new** service's obligations unless the gate is **discovery-based** —
enumerating packages from the filesystem rather than from a list someone must remember to extend.

**A hardcoded list of services in a conformance test is itself the defect.** A list is a thing to forget. Every
gate this rule cites discovers its subjects from `packages/services/*/package.json`,
`packages/clients/*/package.json`, `packages/schemas/*/package.json` or `git ls-files`, so a package created
tomorrow is in scope the day it is created — not the day someone remembers to add it.

### Rule

#### 17-a. Every NEW deployable HTTP service, on the day its package is created

1. Authors its wire contract as zod at `src/**/*.schema.ts`, beside the controller it serves (GR-015 §15-a.1).
2. Declares a `contract:generate` script, so `npm run contract:verify` regenerates it (GR-015 §15-c).
3. Has a committed `packages/schemas/<service>` (`@kitchensink/schema-<service>`) exporting the zod, the
   `z.infer` types, a `CONTRACT_HASH`, a barrel, **and a derived `openapi.yaml`**.
4. Asserts `CONTRACT_HASH` equality **at boot** against its schema package, and fails to boot on mismatch.
5. Registers **`nestjs-zod`'s** `ZodValidationPipe` — never Nest's own `ValidationPipe` — and states so in its
   feature spec (GR-016 §16-e.1).
6. Uses **`z.strictObject()` for every mutating request body** (see 17-c).
7. Validates every non-HTTP ingress it owns — queue, event, webhook, scheduled invocation — against an authored
   zod, and its feature spec **enumerates** them or states that it has none (GR-016 §16-b).
8. Wires the **storage-capacity audit** (`@kitchensink/contract-gen`'s `auditStorageCapacity`) in its own
   `storage-capacity.test.ts`, copying the pattern the three existing services already use — see 17-d. This is
   not optional for a service with a bounded column, and it is not something to reinvent.
9. Carries the four test tiers a deployable owes (`docs/CODING_STANDARDS.md` §7.1): unit, integration, e2e, k6.

#### 17-b. Every NEW client and app package

1. Declares **no** request or response shape of any `packages/services/*` service, in any file, including
   type-only (GR-015 §15-b.2). Divergent consumer shapes are `Pick`/`Omit`/`Partial` derivations.
2. Imports its wire types **and** its runtime zod from `@kitchensink/schema-<service>`.
3. **Validates every response on receipt** with that zod, at the moment the body arrives (GR-016 §16-c.3).
4. **Validates every outbound body against the callee's schema-package zod before the call** (GR-016 §16-c.2).
5. Carries a **contract-skew guard** so a client pinned to a stale schema package is detected rather than
   inferred (`packages/clients/{food-service,recipe-service}/src/contractSkew.ts` is the reference pattern).
6. ⛔ **Is the OPPOSITE case if it speaks to an API we do not serve.** A third-party client (USDA, Clerk,
   Vercel, Stripe, an OCR provider, an LLM provider, a grocery-retailer API) **validates the raw upstream shape
   at the boundary with its own zod**, **MAY declare its own types**, and **gets no OpenAPI document**. Rules
   17-b.1–17-b.5 do **not** apply to it, and applying them **deletes a validation boundary** — a security
   regression, not a consistency win (GR-015 §15-d). `packages/clients/usda` is the reference implementation
   and must never be "converged".

#### 17-c. `z.strictObject()` is the portfolio default for mutating request bodies — OPEN-GR-016-B CLOSED

**Ruled 2026-08-12.** Every **mutating** request body (`POST`, `PUT`, `PATCH`, `DELETE` with a body) uses
`z.strictObject()`. Plain `z.object()` is permitted only where a **forward-compatibility reason is documented
at the schema**, and in practice that means a **read** surface — a query string an older service may receive
from a newer client.

The trade is real in both directions and the ruling picks the one whose failure is **visible**: rejecting
unknown keys turns a client's misspelled field into a `400` the client can fix, while stripping them turns it
into a `200` and a **silent partial write**. On a mutating body, silence is the worse failure — the caller is
told it succeeded and the data is not what it sent. GR-016 §16-e.2 required the choice to be explicit; this
makes it explicit **once**, portfolio-wide, instead of per endpoint.

#### 17-d. The storage floor is enforced by a per-service parity test — OPEN-GR-016-A CLOSED, and ALREADY BUILT

**Ruled 2026-08-12: a per-service parity TEST, not a review-checklist item.** A checklist rots; a migration
that widens or narrows a column six months from now will not consult it.

✅ **This is the one obligation in GR-017 that is already implemented, and the implementation is the
specification.** `@kitchensink/contract-gen`'s `auditStorageCapacity` / `collectBoundedColumns` /
`formatStorageCapacityFindings` (`packages/tools/contract-gen/src/storage-capacity.ts`) are wired by a
`storage-capacity.test.ts` in **all three** services:
`packages/services/recipe-service/src/database/__tests__/`,
`packages/services/food-service/src/db/schema/__tests__/`,
`packages/services/identity/src/types/schema/__tests__/`. A new service copies that pattern; it does not invent
one. Four properties of it are load-bearing and must not be "simplified":

1. **It lives in the SERVICE**, not in the schema package and not in the wire schemas.
2. **It is an assertion over two independently parsed models, not a derivation.** It takes the drizzle tables as
   `unknown` and reads them **structurally**, through drizzle's own registered symbols
   (`Symbol.for('drizzle:Columns')`), so `@kitchensink/contract-gen` needs **no `drizzle-orm` dependency** —
   which matters because that package is imported by all three services and must not drag an ORM behind it. It
   reads the zod bounds through the **public** `z.toJSONSchema` rather than zod internals, which is also what
   makes `.optional()` / `.nullable()` / `.default()` / `z.coerce` unwrap without a hand-rolled walker. ⛔ Do
   **not** "clean this up" by adding a `drizzle-orm` dependency or by reaching into zod's internals.
3. **The field→column mapping is supplied per service by the caller**, because that knowledge genuinely is the
   service's and cannot be inferred: two wire fields may write one column, and a column may be written by none.
4. **The audit is EXHAUSTIVE OVER COLUMNS, which is where its teeth are.** Every bounded column must be either
   bound to the wire fields that write it or declared not-client-writable **with a reason**, so a new
   `varchar(n)` or `smallint` fails the gate the day it is added — the only version of this check that catches
   the **next** instance instead of re-litigating the last one. Two symmetrical failures keep the bookkeeping
   honest in the other direction: a **`stale-account`** entry (a column that is no longer bounded, was renamed,
   or never existed) and a **`duplicate-account`** entry (two entries that could disagree about one column).

The defect class it exists for, measured: `servings: 9999999999` passed request validation, Postgres answered
`22003 value "9999999999" is out of range for type integer`, and `ApiExceptionFilter` collapsed the
unrecognised throwable into a **500 that owed a 400**. Five int-backed recipe fields shared that shape and four
`numeric(8,2)` nutrition overrides had it too — and the same `22003` reaches a `WHERE` clause, not only an
`INSERT`.

#### 17-e. What a feature spec must say — the checkable list

Every feature spec that introduces or extends a service, a client, or an app states, in its own words but
covering every item:

| #   | The spec must state                                                                                                                        | Mechanically checkable?                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| 1   | the **owning service package** by name (no "TBD", no OPEN marker)                                                                          | ✅ (grep for the package name; the package resolves)        |
| 2   | the **schema package** by name, and that it is GENERATED and never hand-edited                                                             | ✅                                                          |
| 3   | that zod is **authored in the service** at `src/**/*.schema.ts`, beside its controller                                                     | ✅ (file glob)                                              |
| 4   | that the schema package exports zod + `z.infer` types + `CONTRACT_HASH` + a **derived** `openapi.yaml`                                     | ✅                                                          |
| 5   | **every** consuming client / app / feature package by name                                                                                 | ⚠️ partly — the list can be short without being wrong       |
| 6   | that clients declare **no** wire types and derive divergent shapes with `Pick`/`Omit`/`Partial`                                            | ✅ (17-b.1's parser-based guard)                            |
| 7   | that **requests AND responses** are validated with that zod (requests in the service, responses **on receipt in the consumer** — see 17-f) | ⚠️ partly                                                   |
| 8   | that **`z.strictObject()`** is used for mutating bodies (17-c)                                                                             | ✅ (grep the authored schemas)                              |
| 9   | the **single** validation mechanism and that the registered pipe is **`nestjs-zod`'s**                                                     | ✅ (a bad-body route test)                                  |
| 10  | every **non-HTTP ingress**, or an explicit "this feature has none"                                                                         | ❌ — a spec cannot be proven to have enumerated all of them |
| 11  | the **storage floor** obligation, as an assertion never a derivation (17-d)                                                                | ✅ (the parity test)                                        |
| 12  | **CLIENT WORK AS ITS OWN DELIVERABLE, with tasks** — schema package, typed client, receipt validation, contract-skew guard                 | ✅ (the tasks exist or they do not)                         |
| 13  | the **third-party exception** (17-b.6) wherever an external API is consumed                                                                | ⚠️ partly                                                   |
| 14  | that server-side **response validation is DEFERRED** and must not be "completed" (GR-016 §16-g)                                            | ✅ (grep)                                                   |

**Item 12 is the one that has been skipped every time.** Measured 2026-08-12 across all fourteen feature
specs: **not one `tasks.md` in the portfolio contained a task to create a schema package, wire `CONTRACT_HASH`,
or validate a response on receipt** — while nine `plan.md` files stated the client obligation in prose. An
obligation with no task is an obligation that does not ship.

#### 17-f. Response validation — say which one you mean

Two different things are both called "response validation", and conflating them causes a contributor to either
skip the required one or add the forbidden one:

- **Required (17-b.3, GR-016 §16-c.3):** a **consumer** parses what it **received**. It is defending itself and
  may do so unilaterally.
- ⛔ **Deferred (GR-016 §16-g):** a **producing service** parses what it **emits**. This is an owner decision,
  not an unfinished task. **Do not add it.**

### Acceptance Criteria

- **AC-017-a**: For every directory under `packages/services/`, a discovery-based test asserts 17-a.1–17-a.5.
- **AC-017-b**: For every directory under `packages/clients/` and every app/feature package, a parser-based
  test asserts 17-b.1 (type-only imports count as violations), with third-party clients (17-b.6) excluded by an
  **explicit, reasoned allowlist** — not by silence.
- **AC-017-c**: Every mutating request body in every authored `*.schema.ts` uses `z.strictObject()`, or carries
  a documented forward-compatibility exemption at the schema (17-c).
- **AC-017-d**: Every service with a bounded column has a storage-floor parity test whose mapping completeness
  is asserted in both directions (17-d).
- **AC-017-e**: Every feature spec that introduces or extends a service, client or app covers all fourteen
  items in 17-e, and its `tasks.md` contains the item-12 client tasks.
- **AC-017-f**: No feature adds server-side response validation while GR-016 §16-g stands (17-f).

### Violation

- **A new service package that lands without its schema package, its `CONTRACT_HASH` boot assertion, or
  `nestjs-zod`'s pipe is in violation on day one** — the obligation is not deferred to "when it has clients".
- A conformance test that enumerates services or clients from a **hardcoded list** is in violation of this rule
  even when its assertions are correct, because it will not see the next package.
- A feature spec whose `plan.md` states the client obligation while its `tasks.md` has no client task is in
  violation of 17-e.12. This is the portfolio's most common violation, not a hypothetical.
- "Converging" a third-party client under 17-b is a violation of **17-b.6** and is treated as a security
  regression.
- A `z.object()` on a mutating body with no documented reason is a violation of 17-c.

### Enforcement — what actually exists, and what does not

⚠️ **This table is the honest state on 2026-08-12, not an aspiration.** A rule that implies coverage it does
not have is worse than an unenforced rule, because it stops people looking.

| Obligation                                                  | Enforced by                                                                                                           | Discovery-based?                                                                                                   | State                                                                                                                                                                              |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Schema package shape, scripts, lint/format posture (17-a.3) | `packages/infra/global/__tests__/generated-schema-packages.test.ts`                                                   | ✅ reads `packages/schemas/*`                                                                                      | **exists**                                                                                                                                                                         |
| Regenerate-and-diff drift gate (GR-015 §15-c layer 2)       | `scripts/contractDriftGate.mjs` + `packages/infra/global/__tests__/contract-drift-gate.test.ts`                       | ✅                                                                                                                 | **exists**                                                                                                                                                                         |
| Every contract owner is actually regenerated (17-a.2)       | `scripts/contractOwners.mjs` `discoverContractOwners` + `contract-generation-runner.test.ts`                          | ✅ reads `packages/services/*/package.json`                                                                        | **exists**                                                                                                                                                                         |
| No app depends on a service package                         | `packages/infra/global/__tests__/app-service-dependency.test.ts`                                                      | ✅ discovers services + `git ls-files`                                                                             | **exists**                                                                                                                                                                         |
| Turbo `inputs` wiring for the copy (GR-015 §15-c layer 1)   | `packages/infra/global/__tests__/turbo-build-graph.test.ts`, `packages/services/*/src/__tests__/build-inputs.test.ts` | ✅ / per-service                                                                                                   | **exists**                                                                                                                                                                         |
| `CONTRACT_HASH` boot assertion (17-a.4)                     | `packages/services/*/src/__tests__/main-boot-order.test.ts`; client side `packages/clients/*/src/contractSkew.ts`     | per-service / per-client                                                                                           | **partial** — present for identity, food, recipe; **not** a repo-wide discovery gate                                                                                               |
| `nestjs-zod` pipe registered, bad body ⇒ `400` (17-a.5)     | `packages/services/identity/tests/app-validation.test.ts`                                                             | ❌ per-service only                                                                                                | **partial** — identity has it; **no repo-wide gate**                                                                                                                               |
| Contract test tier per service                              | `packages/services/{identity,food-service}/contract/__tests__/contract.test.ts`                                       | ❌                                                                                                                 | **partial** — `recipe-service` has **no** such tier                                                                                                                                |
| Clients declare no wire types (17-b.1)                      | `packages/infra/global/__tests__/wire-contract-consumers.{ts,test.ts}`                                                | ✅ AST-based                                                                                                       | 🔄 **LANDING — present in the working tree, UNTRACKED as of 2026-08-12.** Until it is committed, treat 17-b.1 as ungated; do not cite it as coverage in a feature spec before then |
| `z.strictObject()` on mutating bodies (17-c)                | —                                                                                                                     | —                                                                                                                  | ❌ **no gate yet** — greppable, so cheap to add                                                                                                                                    |
| Storage-floor parity (17-d)                                 | `@kitchensink/contract-gen` `auditStorageCapacity` + `storage-capacity.test.ts` in **all three** services             | per-service, but **exhaustive over columns** within each — a new bounded column fails the gate the day it is added | ✅ **exists, and is the strongest gate in this table.** Bidirectional bookkeeping via `stale-account` / `duplicate-account` findings                                               |
| Non-HTTP ingress enumerated (17-e.10)                       | —                                                                                                                     | —                                                                                                                  | ❌ **NOT MECHANIZABLE.** Nothing can prove a spec listed every consumer it will ever have; this one rests on review, and saying so is more useful than pretending otherwise        |
| Spec content (17-e items 1–14)                              | —                                                                                                                     | —                                                                                                                  | ❌ **not mechanized.** Items 1, 2, 8 and 14 are greppable per spec and worth a gate; the rest are judgement                                                                        |

### Current State (2026-08-12) — the rule is NEW; conformance is PARTIAL

- ✅ **Three schema packages exist and are complete in shape**: `packages/schemas/{recipe,food,identity}`, each
  with `schemas.ts`, `types.ts`, `contract-hash.ts`, a barrel — **and `openapi.yaml`, which now exists for all
  three** (4,945 / 922 / 716 lines). GR-015's Current State previously recorded "`openapi.yaml` does not exist
  for any service"; that is **no longer true** and has been corrected.
- ✅ **`packages/clients/{food-service,recipe-service}` carry contract-skew guards** and validate responses on
  receipt.
- 🔄 **`@kitchensink/recipe-service` is ONE file away from one mechanism** — `src/search/dto/search-recipes.query.dto.ts`
  is the only remaining `class-validator` **importer** (measured 2026-08-12). The "19 files" figure repeated
  elsewhere in this document, in ADR-0015 and in §15.4 is a **mention** count and overstates the work by ~19×.
- ❌ **`@kitchensink/food-service` registers no validation pipe in committed `main`** (`ZodValidationPipe`: 0,
  `createZodDto`: 0), despite having a schema package and a derived OpenAPI document. **A service can satisfy
  GR-015 in full and still accept anything** — that is the sharpest argument for 17-a.5 being its own numbered
  obligation. 🔄 A fix is **uncommitted in the working tree** (5 / 3 sites); this bullet describes `HEAD`.
- ✅ **`@kitchensink/identity-service`** now has 6 `ZodValidationPipe` and 6 `createZodDto` sites, up from 3/4.
- ✅ **17-d is already fully enforced** — `@kitchensink/contract-gen`'s `auditStorageCapacity` is wired by a
  `storage-capacity.test.ts` in **all three** services, exhaustive over bounded columns in both directions. The
  ruling that closed OPEN-GR-016-A describes shipped code, not a plan.
- 🔄 **A gate for 17-b.1 is LANDING**: `packages/infra/global/__tests__/wire-contract-consumers.{ts,test.ts}`
  (AST-based) exists in the working tree but is **untracked**. It is not coverage until it is committed.
- ❌ **No gate exists for 17-c (`z.strictObject()` on mutating bodies)** — and it is the cheapest one left, since
  it is greppable over the authored schemas. The gap it would close is measurable right now: **`recipe-service`
  declares ZERO `z.strictObject()` against 36 `z.object()`** (identity 1, food 4, measured 2026-08-12), so the
  portfolio default ruled in 17-c is currently unmet in the largest service. `PATCH /api/v1/recipes/:id` is the
  case that matters — a misspelled field there is a `200` plus a partial write.

---

## GR-018: One Rejection Path, and Invalid Input Is Never Retried

**Severity**: CRITICAL
**Ratified**: 2026-08-12
**Normative source**: [`docs/CODING_STANDARDS.md` §15.4](../docs/CODING_STANDARDS.md) (the boundary parse this
rule governs the **failure** side of) and **§15.5**.
**Relates to**: [GR-016](#gr-016-input-validation-at-every-boundary) — GR-016 says every input is parsed;
GR-018 says what happens when the parse fails. [GR-019](#gr-019-identifier-integrity--no-sentinels) — the
reason a rejected payload is not recorded as a row.
**Resolves**: owner rulings 2026-08-12 — _"invalid payloads are not retried"_, and signature failure and shape
failure are _"equally invalid"_ with the cause carried as a `reason` field, one rejection path, and the
rejected event **not** recorded.

### Rule

#### 18-a. One rejection path per ingress, with the cause in a `reason` field

Every boundary rejection — malformed shape, failed signature, unresolvable principal, quota exceeded,
unregistered type, un-canonicalizable payload — takes **one** code path per ingress and produces **one**
structured rejection shape whose `reason` names the cause.

**A credential/signature failure and a shape failure are EQUALLY invalid: one path, one shape, one `reason`, one
counter, one alarm.** Two _code paths_ means two places to keep in step, two error contracts, and — measured
repeatedly in this repo — one of the two ends up without a counter.

⚠️ **"One behaviour" means one PATH, not necessarily one response STATUS — and this distinction is
incident-grounded, not a loophole.** The status is derived from the `reason` by a **single complete lookup**
(so adding a reason fails to compile until its retry disposition is decided, with no silent default), because
the question a status must answer is **"would a redelivery ever succeed?"** and for a signed webhook the two
reasons genuinely answer it differently:

| `reason`    | Status  | Would a redelivery ever succeed?                                                                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shape`     | `2xx`   | **No.** The signature already verified, so the sender is who it claims and the payload is what they sent. A body we cannot parse parses identically forever; retrying replays one permanent failure on a schedule.                                                                                                                                                                                          |
| `signature` | non-2xx | **Yes, possibly.** Two causes, and both argue against `2xx`: a `2xx` tells a forger their forgery was accepted on an endpoint where the signature is the _only_ trust boundary; and if the caller **is** the real sender and **our** signing secret is stale (a rotation not yet propagated), the condition is **transient and operator-fixable** — the sender's retry window is precisely what rescues it. |

**Reference implementation:** `packages/services/identity-webhooks/src/common/handler-pipeline.ts` —
`rejectInvalidWebhook` is one function with a `reason: 'shape' | 'signature'`, one `IdentityWebhookRejected`
metric dimensioned by `reason`, and `WEBHOOK_REJECTION_STATUS` as the complete `Record` that maps reason to
status. An earlier revision of that module returned `2xx` for **both**, reasoning that a wrong secret
"reproduces on every retry". **That was the half that was wrong**: it treats an operator-fixable
misconfiguration as permanent and pays for the mistake with irrecoverable data loss instead of a retry. The
incident is on record — a dropped `user.created` left Clerk holding a user the database did not have.

⚠️ **This refines the 2026-08-12 ruling as literally worded** ("signature failure and shape failure are equally
invalid … not two different behaviours"), and the refinement is flagged rather than applied silently:
**collapsing the two onto one status breaks something in either direction** — `2xx` for both discards real
events during a secret rotation, and non-2xx for both requests an endless retry of an unparseable body. The
ruling's intent (no second code path, no second error contract, no uncounted rejection) is satisfied in full.
**If the owner intends one literal status for both, that is a different decision and needs to be stated as
one**, because it reverses a fix made in response to a production incident.

#### 18-b. An invalid payload is NEVER retried

An invalid payload cannot become valid by being sent again. Retrying it converts a producer's bug into
sustained load and buries the signal that would have found it.

- **A queue/event consumer** that rejects a payload on shape does **not** return it to the queue for redrive.
  It records the rejection and **completes** the message (or dead-letters it once, with the `reason`).
- **A scheduled or self-triggered invocation** that rejects its event does not reschedule itself.
- **The retry that IS legitimate** is a **transient-dependency** failure — a database timeout, a 5xx from a
  callee. That is a different condition with a different `reason` and it MAY retry. The rule is about
  **invalidity**, not about failure.

#### 18-c. ⚠️ For a signature-verifying third-party sender, "not retried" means answering `2xx`

This is the half a contributor gets backwards on instinct, so it is stated as its own numbered rule.

**svix (Clerk) and Stripe — and webhook senders generally — retry on ANY non-2xx.** Returning `400` for an
invalid body therefore **requests** exactly the retry storm 18-b forbids: Stripe retries for 72 hours, svix on
its own schedule, and each attempt fails identically.

So for such a sender, a payload that is **invalid in a way no redelivery can fix — a SHAPE failure behind a
valid signature** — is answered **`2xx`**, with:

1. the rejection recorded in the **response body** (so the sender's dashboard shows what was wrong),
2. the rejection recorded in **structured logs** with its `reason`,
3. a **per-`reason` counter**, and
4. an **alarm** on that counter — because a rejection nobody sees is indistinguishable from success.

**Reject the content, accept the delivery.**

⚠️ **But a SIGNATURE failure is answered non-2xx, deliberately** (18-a's table). "Not retried" applies to input
that **cannot become valid**; a stale signing secret on our side **can** be fixed, and the sender's retry window
is the recovery mechanism. Answering `2xx` there says "delivered" and discards every real event permanently,
behind a green check — and on a public endpoint it also tells a forger their forgery was accepted. Getting this
backwards in **either** direction has already cost this repository a dropped `user.created`.

⚠️ **This does NOT generalize to our own callers.** An endpoint called by our own services or our own clients
returns the `400`/`403` GR-016 §16-a.3 requires: those callers do not blind-retry, and a `2xx` would hide a
real integration bug from the party able to fix it. An ingress with **no caller at all** (an EventBridge or SQS
consumer) dead-letters. So the decision is: **who is on the other end, and do they retry on status?**

| Ingress                                                                                               | Invalid payload ⇒                                                    | Why                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Our HTTP API, called by our own service/client                                                        | `400` (shape) / `403` (attribution)                                  | the caller can fix it and does not blind-retry                                                                                                                                   |
| A signature-verifying third-party webhook (svix, Stripe) — **shape** failure behind a valid signature | **`2xx`** + recorded rejection + counter + alarm                     | any non-2xx triggers vendor retries of a body that can never parse                                                                                                               |
| The same webhook — **signature** failure                                                              | **non-2xx** + recorded rejection + counter + alarm                   | the cause may be OUR stale secret, which is transient and operator-fixable; the retry window is the recovery. And on a public endpoint a `2xx` tells a forger the forgery landed |
| A queue / event / bus consumer (no caller)                                                            | complete or dead-letter **once**, with the `reason`; alarm DLQ depth | there is nobody to receive a status                                                                                                                                              |

#### 18-d. A rejected event is NOT recorded as a row

The rejection is recorded in **logs, counters and (where applicable) the DLQ** — not as a row in a domain or
audit table.

**An invalid payload has no trustworthy identifier.** A table whose identity column is `NOT NULL` forces the
writer to invent one, which is exactly the sentinel [GR-019](#gr-019-identifier-integrity--no-sentinels)
forbids. This is not hypothetical: `webhook_events.identity_id` in the identity database is `text NOT NULL`, so
"just record the rejected event" there means writing `'unknown'` into a column other code joins on.

The corollary is that **the log line and the counter are load-bearing**, not a consolation prize. A rejection
that is merely dropped is indistinguishable from a successful delivery — which is the failure mode 014's FR-028
exists to prevent on its credential-less ingress.

### Acceptance Criteria

- **AC-018-a**: Each service has **one** rejection path producing **one** shape carrying a `reason`, and a test
  asserts that a shape failure and a credential failure produce that same shape differing only in `reason` (and,
  where the statuses differ, that the status comes from **one complete lookup** rather than a second branch).
- **AC-018-b**: For every queue/event consumer, a test asserts an invalid payload is **not** redriven.
- **AC-018-c**: For every third-party webhook, tests assert **all three** dispositions, because any two of them
  pass on a handler that always returns the same thing: a **shape** failure behind a valid signature yields
  **`2xx`** with the rejection in the body, a `reason` in the log and the counter incremented; a **signature**
  failure yields **non-2xx** with the same shape and counter; and a **valid** body still yields its normal
  success.
- **AC-018-d**: No code path writes a row keyed on an identifier taken from a payload that failed validation.
- **AC-018-e**: Every feature spec with a third-party webhook states the 18-c disposition table explicitly —
  **both** rows — because a contributor reading only GR-016 will return a `400` for everything, and a
  contributor reading only 18-c's headline will return `2xx` for everything.
- **AC-018-f**: Every per-`reason` rejection counter has an **alarm**. A counter with no alarm satisfies the
  letter of 18-c.3 and none of its purpose.

### Violation

- Two rejection **code paths** in one service — typically a signature check and a schema check that can drift
  apart, with only one of them counted — is a violation of 18-a. Two **statuses** derived from one complete
  reason→status lookup is **not** a violation; it is 18-a's required shape for a signed webhook.
- Returning a non-2xx for a **shape** failure behind a valid signature is a violation of 18-c: no redelivery can
  parse a body that does not parse.
- Returning **`2xx`** for a **signature** failure is also a violation of 18-c, and the more expensive one — it
  discards every real event during a signing-secret rotation, behind a green check, and on a public endpoint it
  confirms a forgery to its author.
- Returning `2xx` to **our own** caller for an invalid payload is a violation of 18-c — over-applying the webhook
  rule hides a fixable bug from the party able to fix it.
- Persisting a rejected payload's synthesized id is a violation of 18-d **and** of GR-019.
- Emitting a rejection counter with no alarm is a violation of AC-018-f.

### Current State (2026-08-12) — NEW rule, PARTIALLY conformant in one service

- ✅ **The reference implementation exists and is better than the rule's first draft.**
  `packages/services/identity-webhooks/src/common/handler-pipeline.ts` verifies the svix signature **and** then
  validates the Clerk payload shape (`be0530a1`, hardened for an unrecognised deletion event by `c18a1765`), and
  it already has: **one** `rejectInvalidWebhook` function, **one** rejection shape, a
  `reason: 'shape' | 'signature'`, an `IdentityWebhookRejected` metric dimensioned by `reason`, and
  `WEBHOOK_REJECTION_STATUS` as a **complete `Record`** mapping `shape → 200`, `signature → 401`. 18-a's
  refinement was written **from** that code rather than against it.
- ❌ **`IdentityWebhookRejected` has NO ALARM.** The counter is emitted; `identity-webhooks/infra/lib/webhooks-stack.ts`
  alarms only on `ErasureIncomplete`. So **AC-018-f is unmet on the one ingress that implements everything else**,
  which is precisely the "a rejection nobody sees is indistinguishable from success" failure. This is the
  cheapest outstanding item in this rule and it is a **code** change, not a doc one.
- ❌ **No repo-wide gate exists for any part of GR-018.** Every acceptance criterion above is a review obligation
  today. Stated plainly rather than implied: AC-018-c is a single handler test per webhook and AC-018-f is one
  CDK alarm, so the cost of closing this is low — the rule is documentation until they land.
- ⚠️ 014's FR-042 is the first **feature** to specify this rule end to end. 014 has no signature-verifying
  ingress today, so its `2xx` clause is forward-looking; its live cases are the HTTP `400`/`403` and the bus
  dead-letter.
- ⚠️ **010's `tasks.md` currently asserts "invalid signatures return `400`"** — which is neither disposition: it
  splits signature from shape into two behaviours **and** picks the wrong status for a shape failure. Flagged for
  repointing.

---

## GR-019: Identifier Integrity — No Sentinels

**Severity**: CRITICAL
**Ratified**: 2026-08-12
**Normative source**: [`docs/CODING_STANDARDS.md` §15.5](../docs/CODING_STANDARDS.md).
**Relates to**: [GR-004](#gr-004-data-model-naming-convention) (how identifiers are named),
[GR-018](#gr-018-one-rejection-path-and-invalid-input-is-never-retried) (why a rejected payload is not stored).
**Resolves**: owner ruling 2026-08-12 — _"Ids: never a sentinel string like `'unknown'`. An id is REQUIRED
except on create/upsert, where it is generated if absent."_

### Rule

1. **No identifier may ever be a sentinel.** Not `'unknown'`, not `'none'`, not `''`, not `'n/a'`, not `'-'`,
   not `0`, not a synthesized `'pending-…'`. This binds identifiers **written to storage**, **placed on a
   wire**, **used as a map or cache key**, **used as a metrics dimension**, and **compared in a branch**. A
   sentinel in a log _message_ (`user not found`) is prose and is fine; a sentinel in a structured log _field_
   is data and is not.
2. **An id is REQUIRED wherever one is consumed.** Its schema types it as required — not optional-with-a-default.
3. **The sole exception is a create or upsert**, where an absent id is **generated by the system** (a ULID, per
   this repo's convention) rather than defaulted to a placeholder.
4. **An identifier that cannot be resolved is a REJECTION** (GR-018 §18-a), never a placeholder. "Reject" may
   mean a `4xx`, a dead-letter, or a recorded-and-completed message — never a written row.
5. **A nullable relationship is modelled as NULL, not as a sentinel row or a sentinel string.** If "no owner" is
   a legitimate state, the column is nullable and the wire type is `| null` — which is checkable. A magic string
   is not.

### Why this is CRITICAL rather than a style preference

A sentinel identifier is **silently wrong in every aggregate it touches, and it cannot be undone later**:

- **Aggregates fuse.** Every unattributable event lands in one bucket, so a per-producer counter, a per-user
  quota and a per-tenant rate limit all report one large fictitious subject. Worse, they _look_ populated.
- **It is indistinguishable from a real value after the fact.** A `NOT NULL` column holding `'unknown'` cannot
  be told apart from a column holding a genuine id, so the repair requires knowledge that no longer exists.
- **It defeats joins and foreign keys.** A sentinel either has no matching row (a broken join that returns
  nothing, quietly) or acquires one (a sentinel row that every orphan now belongs to).
- **It converts a rejection into a write.** The whole point of the boundary parse (GR-016) is that bad input
  does not reach storage. A sentinel is the code path that lets it reach storage anyway, wearing a valid shape.
- **It is a security control failure when the id is a principal.** An identity that resolves to `'unknown'` and
  is then used for attribution, quota, or authorization has had its authorization decision made by a string
  literal. 014's FR-041 dual-signal binding rejects rather than defaults for exactly this reason.

### Acceptance Criteria

- **AC-019-a**: No `*.schema.ts` gives an identifier field a default, and no identifier field is optional
  except on a create/upsert body.
- **AC-019-b**: A repo-wide grep-level gate rejects the sentinel literals in identifier positions
  (`'unknown'`, `'none'`, `'n/a'`, `''`) in service and client sources. ⚠️ Grep is **necessary and not
  sufficient** — it cannot see a sentinel built at runtime (`id ?? \`unknown-${Date.now()}\``), so it is a
  tripwire, not a proof.
- **AC-019-c**: Every create/upsert path that generates an id has a test asserting the generated id is a valid
  ULID and that no two calls collide.
- **AC-019-d**: Every feature spec that models an identifier states this rule, and states which of its paths
  are create/upsert (i.e. where generation is permitted).

### Violation

- Writing, wiring, keying or branching on a sentinel identifier is a violation, **including** when it is done
  to satisfy a `NOT NULL` constraint. The constraint is not the justification; it is the trap.
- Typing an identifier as optional on a non-create path is a violation even if every current caller supplies
  it — the obligation is that it _cannot_ be omitted.
- Defaulting an unresolvable principal to a sentinel and continuing is a violation of this rule **and** of
  GR-018 §18-a, and is treated as a security defect rather than a data-quality one.

### Current State (2026-08-12) — NEW rule, conformance UNMEASURED

- ⚠️ **`webhook_events.identity_id` is `text NOT NULL` in the identity database**, which is precisely the shape
  that pressures a writer into a sentinel when it wants to record a rejected event. GR-018 §18-d resolves that
  pressure by **not recording the row**; the column itself is unchanged and is not a violation on its own.
- ❌ **No gate exists.** AC-019-b's grep tripwire does not exist yet and is the cheapest of the four to add.
- ✅ 014's FR-043 is the first feature to state the rule normatively.

---

## GR-020: Dual-Signal Principal Binding

**Severity**: CRITICAL
**Ratified**: 2026-08-12
**Normative source**: [`docs/CODING_STANDARDS.md` §15.5](../docs/CODING_STANDARDS.md).
**Relates to**: [GR-016](#gr-016-input-validation-at-every-boundary) §16-b (a signature proves origin, not
shape), [GR-018](#gr-018-one-rejection-path-and-invalid-input-is-never-retried) (the rejection path a mismatch
takes), [GR-019](#gr-019-identifier-integrity--no-sentinels) (why the mismatch is not resolved by defaulting).
**Resolves**: owner ruling 2026-08-12 on 014's OPEN-014-A — require **both** the transport signal and the
payload's self-asserted principal, and **reject on mismatch**.

### Rule

Where a request carries **both** a transport-asserted principal and a payload-asserted principal:

1. **Both are REQUIRED.** Neither may be dropped as redundant, and the payload field stays required.
2. **The transport signal MUST resolve, through a version-controlled registry, to a principal name.** An
   allowlist that only answers yes/no is insufficient — attribution needs a _name_, because the per-principal
   counter, quota and audit trail all key on one.
3. **The two MUST be equal, and a mismatch is a REJECTION** on the single rejection path (GR-018 §18-a) with
   the cause in `reason`. A mismatch is **never** resolved by preferring one signal, and the payload-asserted
   value is **never** trusted on its own.
4. **The registry mapping MUST be injective and that MUST be asserted at boot**: a transport signal maps to
   **at most one** principal. Overlapping mappings make attribution ambiguous, which silently misattributes
   quota and counters.
5. **The registry is version-controlled data, not a table**, and it is **not** assembled from the packages it
   constrains. A runtime write to a table would change a trust boundary with no review and no deploy;
   assembling it from the constrained party hands them the constraint.
6. **An unresolvable transport signal is a rejection, not a default** (GR-019).

### Why require both, when the transport signal alone identifies the caller

The two signals answer different questions and the disagreement is the value:

- The **transport signal** proves **origin** — who the infrastructure says sent this.
- The **payload field** states **intent** — who the sender says it is acting as.
- A **disagreement is real evidence of a real fault**: a misconfigured producer, a payload copied between
  environments, a replay onto the wrong bus, or an attempt to spend another principal's quota. Silently
  preferring one signal discards that evidence and converts a detectable misconfiguration into a subtle,
  long-lived misattribution.

There is also a contract reason, which is what makes the rule cheap rather than merely careful: requiring the
field on **every** ingress keeps **one** payload shape valid on all of them. 014's two adapters can share
literally one zod (GR-015 §15-a) only because `producer` is required on both paths; had it been
transport-path-only, the "one core, two adapters" equivalence tests would have been comparing two shapes.

**The payload field is never the authority.** Its only two permitted outcomes are **"agrees"** and
**"rejected"**. That is what closes the hole a self-asserted principal otherwise opens: without the
cross-check, any party with transport access can attribute its traffic to another principal and spend that
principal's budget.

### Where this rule applies today

| Edge                                                                             | Transport signal                               | Payload signal                | Status                                                                                                                                                                      |
| -------------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 014 HTTP publish                                                                 | Ed25519 service-principal token `sub`          | envelope `producer`           | **specified** (014 FR-041)                                                                                                                                                  |
| 014 EventBridge publish                                                          | validated event `source` + bus resource policy | envelope `producer`           | **specified** (014 FR-027, FR-041)                                                                                                                                          |
| identity's erasure fan-out → recipe/food `POST /api/v1/internal/account/erasure` | Ed25519 service-principal token                | the body's account identifier | ⚠️ **not currently a dual-signal binding** — the body names the _subject_, not the _caller_, so this rule does not bind it as written. Recorded so nobody assumes coverage. |
| Clerk svix webhook → identity                                                    | svix signature                                 | payload `data.id`             | ⚠️ **not a dual-signal binding either** — one principal (Clerk) with no second assertion of _who is calling_. GR-016 §16-b already binds it (signature **then** shape).     |

**So GR-020 binds one feature today.** It is ratified now rather than later because the next
service-to-service or bus ingress will face the same choice, and the wrong answer — "the envelope says who it
is, so use that" — is the intuitive one.

### Acceptance Criteria

- **AC-020-a**: For every ingress carrying two principal assertions, a test asserts that a **mismatch** is
  rejected on **every** path that ingress supports, with the mismatch `reason` recorded.
- **AC-020-b**: A test asserts the registry mapping is **injective**, and that a duplicate mapping fails at
  boot rather than at first use.
- **AC-020-c**: A test asserts an **unresolvable** transport signal is rejected and never defaulted.
- **AC-020-d**: The registry is a committed file, reviewed in the pull request that changes it; no runtime write
  path to it exists.

### Violation

- Accepting the payload-asserted principal because the transport signal is absent, unresolvable, or
  inconvenient is a violation, and is a **security** violation rather than a correctness one.
- Dropping the payload field as "redundant self-assertion" is a violation of 20-a.1 — it also breaks the
  one-shape property in the reasoning above.
- Storing the registry in a database table is a violation of 20-a.5.
- Resolving a mismatch by logging a warning and continuing is a violation of 20-a.3. A warning is not a
  rejection.

### Current State (2026-08-12) — NEW rule, one feature bound

- ✅ 014 FR-041 specifies the rule in full: both signals, registry resolution, injectivity asserted at boot,
  rejection on mismatch, registry authored in the service and copied to the schema package.
- ❌ **No implementation exists** — 014 is a spec, and no other edge in the portfolio is currently a
  dual-signal binding (see the table above). Nothing is enforced yet.
- ⚠️ Historical precedent worth citing when this rule is questioned: PR #39 removed a trusted
  `x-authorizer-context` header from the identity service because a client-suppliable header behind a public
  ALB is forgeable. GR-020 is the same lesson applied to a payload field — a value the sender controls cannot
  be the authority for what the sender is allowed to do.

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

| Version | Date       | Author                                          | Summary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------- | ---------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.3.0   | 2026-08-12 | Repository owner                                | **GR-017, GR-018, GR-019, GR-020 added** (MINOR — four new rules) and **both GR-016 OPEN items ruled**. **GR-017** makes GR-015/GR-016 checkable on a package that does not exist yet: a NEW service owes its authored zod, a `contract:generate` script, a committed schema package with a derived `openapi.yaml`, a `CONTRACT_HASH` boot assertion, **`nestjs-zod`'s** `ZodValidationPipe`, `z.strictObject()` on mutating bodies, and validated non-HTTP ingress **on the day its package is created**; a NEW client owes zero wire types, receipt validation, outbound validation against the callee's zod, and a contract-skew guard — with the third-party inverse (17-b.6) preserved. Every conformance gate must be **discovery-based** (`packages/services/*`, `packages/clients/*`, `git ls-files`), because a hardcoded list is the defect. **17-c closes OPEN-GR-016-B**: `z.strictObject()` is the portfolio default for mutating bodies. **17-d closes OPEN-GR-016-A**: the storage floor is a per-service parity test — and, uniquely among these obligations, it is **already built and wired in all three services** (`@kitchensink/contract-gen`'s `auditStorageCapacity`, reading drizzle **structurally** via `Symbol.for('drizzle:Columns')` so `contract-gen` needs no ORM dependency, reading zod bounds via the **public** `z.toJSONSchema`, and **exhaustive over bounded columns** with `stale-account`/`duplicate-account` findings in the other direction), so the ruling records shipped code rather than a plan. 17-e lists the fourteen things a feature spec must state and marks which are mechanically checkable; **17-e.12 (client work as its own deliverable, with tasks)** is recorded as the portfolio's most common violation — measured 2026-08-12, **not one of the fourteen `tasks.md` files contained a schema-package, `CONTRACT_HASH` or receipt-validation task** while nine plans stated the obligation in prose. **GR-018** — one rejection path per ingress with the cause in a `reason`, signature failure and shape failure equally invalid, an invalid payload **never retried**, and ⚠️ for a signature-verifying third-party sender (svix, Stripe) that means answering **`2xx`** because any non-2xx triggers vendor retries; a rejected event is **not recorded as a row** (an invalid payload has no trustworthy id, and `webhook_events.identity_id` is `text NOT NULL`). **GR-019** — no sentinel identifiers (`'unknown'`, `''`, `0`) anywhere an id is stored, wired, keyed, dimensioned or branched; an id is REQUIRED except on create/upsert, where it is generated. **GR-020** — where a request carries both a transport-asserted and a payload-asserted principal, both are required, the transport signal resolves through a version-controlled registry, the mapping is injective and asserted at boot, and a mismatch is a **rejection**. GR-015's Current State refreshed against the tree (three schema packages **and** `openapi.yaml` now exist; food still has **zero** validation sites); GR-016's re-measured. Reasoning: ADR-0014, ADR-0015, and the new **ADR-0016** (014's retention/dedup/Valkey) and **ADR-0017** (service ownership for 006/007/009/010 — no new deployable). |
| 3.2.0   | 2026-08-12 | Repository owner                                | **GR-016 added** (MINOR — new rule): Input Validation at Every Boundary. Every input is parsed at the boundary against the service's own authored zod (the GR-015 zod), through **one** mechanism per service with **one** `400` path — measured state was three mechanisms across three services and `@kitchensink/food-service` with **no pipe at all** (`@Body() body: unknown` + per-method `safeParse`, so a bad type, a missing field and an unknown key all report `{ error: 'Empty name' }`). Extends the obligation to the surfaces a pipe never sees — **queue/event consumers and webhooks**, where a svix signature proves **origin, not shape** — and to the service-to-service edges (recipe → food; identity's erasure fan-out → recipe/food `POST /api/v1/internal/account/erasure`): outbound validated before send, inbound validated on receipt. Makes **the database schema the validation FLOOR** (grounded in five int-backed recipe fields with no upper bound writing `int4`, so `servings: 9999999999` was a **500 that owed a 400**) while stating that the floor is an **assertion, never a derivation** — no zod generated from drizzle, no wire type importing a storage type, GR-015 §15-a.5 unchanged. Records the two invisible hazards (`createZodDto` under Nest's own `ValidationPipe` validates nothing while looking wired — it already bit identity's `PATCH /users/me`; `z.object` strips unknown keys where `z.strictObject` rejects) and forbids a request-derived value reaching `sql.raw()`. **Response validation is explicitly DEFERRED** by owner decision and must not be "completed". Normative source `docs/CODING_STANDARDS.md` §15.4; reasoning and rejected alternatives in ADR-0015. Two OPEN items recorded unresolved (GR-016-A floor enforcement mechanism, GR-016-B `strictObject` default).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 3.1.0   | 2026-08-11 | Repository owner                                | **GR-015 added** (MINOR — new rule): API Contract Ownership. The service authors its wire contract in zod at `src/**/*.schema.ts`, validates its own requests with it, and generates a committed `packages/schemas/<service>` package that clients import; `openapi.yaml` is derived and outbound-only, never a codegen input. **The client half (15-b) is separately mandatory** — a client declares no wire types and derives divergent consumer shapes with `Pick`/`Omit`/`Partial` — because mandating only the service side is how the client half got skipped. Records the three drift gates (15-c) and, prominently, the third-party exception (15-d): USDA/Clerk/Vercel/Stripe/OCR/LLM clients validate the raw upstream shape at the boundary and MAY declare their own types, so "converging" them deletes a security boundary. Normative source is `docs/CODING_STANDARDS.md` §15; reasoning and rejected alternatives in ADR-0014.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 1.0.0   | 2026-05-10 | Senior Product Owner (cross-feature governance) | Initial ratification. Converts all CRITICAL and WARNING findings from `cross-feature-consistency-report.md` into enforceable rules with acceptance criteria. Corrects all release audit reports to BLOCKED status. Establishes release readiness gate (GR-001) as the primary blocker for engineering handoff.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 3.0.0   | 2026-08-02 | Repository owner                                | **GR-014 amended** (MAJOR — incompatible redefinition): recipe visibility declared **binary** (`private` \| `public`); the missing `public` scope added, and `public-profile` demoted to a surfacing concern rather than a third visibility state; `circle` clarified as read-only; `price_cents` removed from the audience shape and restricted to `published-lesson`; ingestion-provenance and attribution criteria added (AC-014-d/e/f). Withdraws the premium-recipe and paid-follow model portfolio-wide. `cross-feature-consistency-report.md` S-004 amended to match.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2.0.0   | 2026-08-02 | Repository owner                                | **GR-009 amended** (MAJOR — incompatible redefinition): the `@kitchensink/{group}-{name}` pattern was ratified when no packages existed and none of the 26 shipped packages follow it. Restated to the two scopes actually in use, `@kitchensink/{name}` and `@commise/{name}`, with role suffixes (`-service`, `-workers`, `-service-client`) replacing group prefixes. Superseded pattern preserved in-section. **GR-002/GR-003/GR-007 Current State** refreshed against shipped `main`; GR-002 confirmed portfolio-wide with no exceptions.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
