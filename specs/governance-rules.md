# KitchenSink Cross-Feature Governance Rules

**Version**: 1.0.0
**Ratified**: 2026-05-10
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
15. [Governance Amendment Process](#governance-amendment-process)

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

### Current State (2026-08-02)

Superseded the 2026-05-10 entry.

- **Features 007–014: conformant.** Normalized to `/api/v1/*` in the 2026-08-02 spec sweep — 82 bare
  `/v1/*` references plus every unprefixed shorthand endpoint. The only paths deliberately left
  unprefixed are third-party URLs the platform does not own (Instacart's `/idp/api/v1/products/*`).
- **`docs/api-conventions.md` now exists**, authored under feature 005. AC-002-d is satisfied.
- **Feature 005: conformant** — adopts `app.setGlobalPrefix('api/v1', { exclude: ['health'] })`.
- **Features 004 and 006: being corrected.** Both were reconciled against shipped `main` and still carry
  bare `/v1/*`; both will be updated to `/api/v1/*` in their own branches (owner direction, 2026-08-02).
  006's `review.md` closes PRF-006-16 on "the platform's plain-segment convention,
  `POST /v1/recipes/nutrition-batch`" — **that finding is superseded.** Its stated rationale also
  misattributed ownership: a feature spec does not own a service. The recipe service is owned by the
  repository owner, not by feature 006, so PRF-006-16 was never an ownership-backed exemption from a
  portfolio rule.
- **Shipped services: migration in progress.** `identity-service`, `food-service`, `recipe-service`, and
  `identity-webhooks` serve `v1/*` today; `main` is being migrated to `/api/v1/*` under separate work
  (owner direction, 2026-08-02). Until that lands, this rule is **aspirational for shipped code and
  binding for specs**. Migration surface is enumerated in `docs/api-conventions.md` §6 (that file lands
  with feature 005); its highest-risk step is Playwright's `page.route('**/v1/**')` globs, which fail
  silently rather than loudly.

**Disposition: `/api/v1/*` is the portfolio-wide target with no standing exceptions.** Every feature spec
and every shipped service converges on it. No feature holds an exemption.

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

All npm packages in this monorepo **MUST** follow the naming pattern:

```
@kitchensink/{group}-{name}
```

Group examples: `data`, `shared`, `auth`, `ui`, `apps`, `tools`.

**Canonical examples**:

- `@kitchensink/shared-recipe-core`
- `@kitchensink/data-usda`
- `@kitchensink/auth-client`
- `@kitchensink/auth-server`
- `@kitchensink/ui-components`

### Acceptance Criteria

- **AC-009-a**: Every `package.json` in `packages/` uses the `@kitchensink/{group}-{name}` naming pattern.
- **AC-009-b**: Feature plans that reference package names use this convention.
- **AC-009-c**: No package uses a bare `@kitchensink/{name}` pattern without a group segment.

### Current State (2026-08-02)

Superseded the 2026-05-10 entry, which said "no implementation packages exist yet". Twenty-six now do.

⚠️ **This rule is contradicted by every shipped package and needs ratification against reality.** It is
recorded here rather than silently rewritten, because amending a ratified rule is the Director of Product's
call, not a sweep's.

- **No** shipped package uses `@kitchensink/{group}-{name}`. The actual forms are `@kitchensink/{name}`
  (`recipe-core`, `identity-service`, `clerk-verify`, `food-service-client`, …) and a second scope the rule
  does not contemplate at all, `@commise/{name}` (`web`, `mobile`, `ui`, `i18n`, `features-recipes`,
  `features-account`, `features-core`).
- Conforming would mean renaming 26 published workspace packages and every import of them.
- **What the 2026-08-02 sweep did**: corrected features 007–014 to the _shipped_ names, and to the
  `@kitchensink/{domain}-service` / `@kitchensink/{domain}-workers` / `@commise/features-{domain}` forms
  that feature 005 uses for new packages. It did **not** rewrite this rule.
- **Decision needed**: either amend GR-009 to describe the two real scopes, or schedule a rename. Until
  then, treat shipped package names as authoritative and this rule as unenforced.

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

**Canonical audience scopes**: `private`, `circle`, `public-profile`, `published-lesson`.

The `Circle` entity is owned by Feature 011. The `CreatorProfile` entity is owned by Feature 012. Features that need these entities must declare a dependency on the owning feature.

### Acceptance Criteria

- **AC-014-a**: Features 001, 004, 006, 007, 010, 011, 012, 013 use the `audience` field with `{ scope, ref_id?, price_cents? }` shape on all shareable entities.
- **AC-014-b**: No feature defines its own sharing primitive that duplicates `Circle` or `CreatorProfile`.
- **AC-014-c**: Every audience change is audit-logged (compliance requirement).

### Current State (2026-05-10)

- The unified audience model is defined in `cross-feature-consistency-report.md` §10.
- No feature has implemented it yet. This rule applies when features enter implementation.

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

| Version | Date       | Author                                          | Summary                                                                                                                                                                                                                                                                                                        |
| ------- | ---------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.0.0   | 2026-05-10 | Senior Product Owner (cross-feature governance) | Initial ratification. Converts all CRITICAL and WARNING findings from `cross-feature-consistency-report.md` into enforceable rules with acceptance criteria. Corrects all release audit reports to BLOCKED status. Establishes release readiness gate (GR-001) as the primary blocker for engineering handoff. |
