# Sync & Verify Report: 010-subscriptions

> Feature: `010-subscriptions` | Date: 2026-08-07
> Layers checked: 8 full + 1 partial / 10 | Skipped: Layer 8 (no `contracts/`), Layer 5 forward (0 completed tasks)
> Phase: `implement: pending` (feature_mode `v-model`, schema v3)
> Supersedes the 2026-06-02 run, which returned **PASS** — that verdict predates the 2026-08-02 spec rewrite and checked only FR-040..FR-043.

## Summary

| Severity    | Count        |
| ----------- | ------------ |
| ❌ CRITICAL | 9            |
| ⚠️ WARNING  | 9            |
| ℹ️ INFO     | 2            |
| ✅ CLEAN    | 1 layer (L7) |

**Category split:** structural 19 · cosmetic 1
**Drift budget:** `structural: 0` (default) — **19 structural findings exceed it.**

**Verdict:** ❌ **CRITICAL DRIFT**

The dominant cause is temporal: `spec.md` was substantially rewritten on 2026-08-02 by the
007–014 spec sweep (adding FR-044) while `plan.md`, the V-Model corpus, and both prior
reports were last reasoned about in May 2026. The sweep normalized paths and naming in
those files but did not re-derive their content. Meanwhile `main` shipped a premium-gating
mechanism under features 001/004 that no 010 artifact mentions.

---

## Layer Results

### Layer 1: research/ ↔ product-spec/ — ⚠️ 2 findings

### Layer 2: product-spec/ ↔ spec.md — ❌ 1 critical, ⚠️ 2 warnings

### Layer 3: spec.md ↔ plan.md — ❌ 3 critical, ⚠️ 2 warnings

### Layer 4: plan.md ↔ tasks.md — ❌ 2 critical, ⚠️ 1 warning, ℹ️ 1 info

### Layer 5: tasks.md ↔ Code — ⏭️ forward N/A (0 `[x]` tasks); backward ✅ clean (worktree diff vs `origin/main` is empty)

### Layer 6: spec.md ↔ Code — ❌ 1 critical, ⚠️ 1 warning

### Layer 7: Cross-link integrity — ✅ CLEAN (47 markdown files scanned, 0 broken links)

### Layer 8: FE ↔ BE contract drift — ⏭️ SKIPPED (no `contracts/openapi.yaml`); see DRIFT-017

### Layer 9: Doc ↔ Code reconciliation — ⚠️ forward gap expected pre-impl; 1 attributed orphan (DRIFT-016)

### Layer 10: Constitution ↔ Code — ❌ 2 critical, ⚠️ 1 warning

> ✅ **Release Readiness Gate is honored.** `v-model/release-audit-report.md` correctly
> reports `❌ BLOCKED — 125 test scenarios untested`, and `v-model/waivers.md` is present
> declaring no approved waivers. All three constitution conditions are respected.

---

## All Drift Items

### DRIFT-001: Research prescribes a single-service gating model that FR-044 contradicts

| Field         | Value                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 1: research ↔ product-spec                                                                                                  |
| **Direction** | Backward (later decision not reflected in earlier artifact)                                                                 |
| **Severity**  | ⚠️ WARNING                                                                                                                  |
| **Category**  | structural                                                                                                                  |
| **Source**    | `spec.md` FR-044 (added 2026-08-02)                                                                                         |
| **Target**    | `research/codebase-analysis.md` (dated 2026-05-09)                                                                          |
| **Evidence**  | Internal dependency graph: `AuthMiddleware (Clerk session token) -> PlanGuard -> account.plan + account.subscriptionStatus` |
| **Expected**  | A cross-service entitlement path — the tier reaching services that cannot read identity's database                          |
| **Actual**    | An in-process guard reading account columns off `req.user`                                                                  |

**Proposed resolution:** Re-run the codebase-analysis dimension against shipped `main` and
record the multi-service topology plus the token-claim path FR-044 introduces.

**Auto-resolvable:** false

---

### DRIFT-002: Research reports a `PREIMUM_REQUIRED` typo that no longer exists

| Field         | Value                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------ |
| **Layer**     | 1: research ↔ product-spec                                                                                   |
| **Direction** | Backward                                                                                                     |
| **Severity**  | ℹ️ INFO                                                                                                      |
| **Category**  | cosmetic                                                                                                     |
| **Source**    | `tasks.md` (typo corrected)                                                                                  |
| **Target**    | `research/codebase-analysis.md` §G-3                                                                         |
| **Evidence**  | "`tasks.md` references `PREIMUM_REQUIRED` at one location." — grep across the feature returns only this line |
| **Actual**    | Stale open finding                                                                                           |

**Proposed resolution:** Mark G-3 resolved.

**Auto-resolvable:** false (`sync_verify.auto_resolve.cosmetic` defaults to `false`)

---

### DRIFT-003: FR-044 has no product-spec representation

| Field         | Value                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 2: product-spec ↔ spec.md                                                                                       |
| **Direction** | Backward (spec.md requirement absent upstream)                                                                  |
| **Severity**  | ❌ CRITICAL                                                                                                     |
| **Category**  | structural                                                                                                      |
| **Source**    | `spec.md` FR-044                                                                                                |
| **Target**    | `product-spec/product-spec.md`                                                                                  |
| **Evidence**  | Requirement Coverage Matrix rows stop at `FR-043`, `NFR-003`, `NFR-004`. No `US-010-*` story references FR-044. |
| **Expected**  | A user story (or explicit infrastructure-requirement note) plus a coverage-matrix row                           |
| **Actual**    | Missing                                                                                                         |

**Proposed resolution:** Add a coverage row and either a story or an explicit
"platform requirement, no user-facing story" annotation, matching how US-010-008/009
carry scope notes.

**Auto-resolvable:** false

---

### DRIFT-004: NFR-001 and NFR-002 are unmapped in the coverage matrix

| Field         | Value                                                      |
| ------------- | ---------------------------------------------------------- |
| **Layer**     | 2                                                          |
| **Direction** | Backward                                                   |
| **Severity**  | ⚠️ WARNING                                                 |
| **Category**  | structural                                                 |
| **Source**    | `spec.md` NFR-001 (strict TS), NFR-002 (JSDoc on exports)  |
| **Target**    | `product-spec/product-spec.md` Requirement Coverage Matrix |
| **Evidence**  | Matrix maps only NFR-003 and NFR-004                       |
| **Actual**    | NFR-001, NFR-002 absent                                    |

**Proposed resolution:** Add rows, or state that constitution-derived NFRs are covered by
the repo-wide Quality Gates rather than per-feature artifacts.

**Auto-resolvable:** false

---

### DRIFT-005: Persona needs assert out-of-scope monetization with no scope note

| Field         | Value                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 2                                                                                                                                                                                                                                                           |
| **Direction** | Backward                                                                                                                                                                                                                                                    |
| **Severity**  | ⚠️ WARNING                                                                                                                                                                                                                                                  |
| **Category**  | structural                                                                                                                                                                                                                                                  |
| **Source**    | `spec.md` Assumptions — "Marketplace payments are out of scope for v1"; "**Do not plan creator compensation against 010 as it stands.**"; D-5 family plan out of scope                                                                                      |
| **Target**    | `product-spec/product-spec.md` Personas                                                                                                                                                                                                                     |
| **Evidence**  | P11 Robin: "Needs a creator-tier or Pro plan that enables **tip-jar payments and paid-follow revenue**"; "Expects the platform to handle **payout mechanics**". P3 Riley: "Wants a **family plan** that covers multiple household accounts under one bill." |
| **Expected**  | The same explicit scope note that US-010-008 and US-010-009 carry                                                                                                                                                                                           |
| **Actual**    | Stated as unqualified product expectations                                                                                                                                                                                                                  |

**Proposed resolution:** Annotate both persona blocks with the governing exclusion. This is
the exact misreading spec.md warns against, and 012/013 already depend on 010 for payouts.

**Auto-resolvable:** false

---

### DRIFT-006: FR-044 has no plan coverage

| Field         | Value                                                                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 3: spec.md ↔ plan.md                                                                                            |
| **Direction** | Forward                                                                                                         |
| **Severity**  | ❌ CRITICAL                                                                                                     |
| **Category**  | structural                                                                                                      |
| **Source**    | `spec.md` FR-044 (MUST)                                                                                         |
| **Target**    | `plan.md`                                                                                                       |
| **Evidence**  | grep for `FR-044`, `public_metadata`, `clerk-verify` across `plan.md` returns zero hits                         |
| **Expected**  | An architecture section for publishing/refreshing the tier claim, its staleness bound, and downgrade revocation |
| **Actual**    | Missing                                                                                                         |

**Proposed resolution:** Per the 2026-08-07 owner ruling, plan a distinct
`subscription_tier` claim in `public_metadata`, taught to `@kitchensink/clerk-verify`, and
plan the retirement of the interim `permissions: ['premium']` carrier in the same change.

**Auto-resolvable:** false

---

### DRIFT-007: plan.md specifies the data model in TypeORM; the repo uses Drizzle

| Field         | Value                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 3                                                                                                                                                                                                                         |
| **Direction** | Backward (plan ↔ shipped reality)                                                                                                                                                                                         |
| **Severity**  | ❌ CRITICAL                                                                                                                                                                                                               |
| **Category**  | structural                                                                                                                                                                                                                |
| **Source**    | shipped `packages/services/identity/src/types/dao/account.dao.ts`                                                                                                                                                         |
| **Target**    | `plan.md` §2 Data Model                                                                                                                                                                                                   |
| **Evidence**  | plan.md: `@Column({ type: 'varchar', default: 'free' }) plan: 'free' \| 'premium';` — TypeORM decorators. Shipped: Drizzle `AccountRow` with `subscriptionTier` and an `updateSubscriptionTier(userId, tier)` DAO method. |
| **Expected**  | Drizzle schema additions extending the existing `accounts` table                                                                                                                                                          |
| **Actual**    | TypeORM entity decorators, plus a **new** `plan` column duplicating the shipped `subscription_tier`                                                                                                                       |

**Proposed resolution:** Rewrite §2 as Drizzle column additions on the existing `accounts`
table; reuse `subscriptionTier` as the tier column rather than introducing `plan`.

**Auto-resolvable:** false

---

### DRIFT-008: plan.md gates nine endpoints with one in-process guard across separate services

| Field         | Value                                                                                                                                                                                                                                                                                              |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 3                                                                                                                                                                                                                                                                                                  |
| **Direction** | Backward                                                                                                                                                                                                                                                                                           |
| **Severity**  | ❌ CRITICAL                                                                                                                                                                                                                                                                                        |
| **Category**  | structural                                                                                                                                                                                                                                                                                         |
| **Source**    | shipped monorepo topology (`identity`, `recipe-service`, `food-service` are separately deployed)                                                                                                                                                                                                   |
| **Target**    | `plan.md` §4 Feature Gating Map + PlanGuard implementation                                                                                                                                                                                                                                         |
| **Evidence**  | `PlanGuard.canActivate` reads `const { user } = context.switchToHttp().getRequest()` then `user.plan` / `user.subscriptionStatus`, and is applied to `/api/v1/recipes/:id/visibility`, `/api/v1/ai/*`, `/api/v1/meal-plans/*`, `/api/v1/grocery-lists/:id/order`, `/api/v1/nutrition/client-plans` |
| **Expected**  | An entitlement signal every service can read without identity's database                                                                                                                                                                                                                           |
| **Actual**    | A guard that only works inside the service owning the `accounts` table                                                                                                                                                                                                                             |

**Proposed resolution:** Rebuild §4 on the FR-044 token claim. This is the gap FR-044 was
written to close; the plan predates it.

**Auto-resolvable:** false

---

### DRIFT-009: plan.md composes with `jwt-auth.guard.ts`, which never existed

| Field         | Value                                                                                                    |
| ------------- | -------------------------------------------------------------------------------------------------------- |
| **Layer**     | 3                                                                                                        |
| **Direction** | Backward                                                                                                 |
| **Severity**  | ⚠️ WARNING                                                                                               |
| **Category**  | structural                                                                                               |
| **Source**    | shipped `packages/services/identity/src/auth/middleware/auth.middleware.ts`                              |
| **Target**    | `plan.md` §5 Module Structure                                                                            |
| **Evidence**  | plan.md: `├── auth/ │   └── jwt-auth.guard.ts  -- from 002; composed with PlanGuard`                     |
| **Actual**    | The real mechanism is `AuthMiddleware` + `ClerkAuthService`; PR #39 removed the authorizer path entirely |

**Proposed resolution:** Replace with `AuthMiddleware`. Note that the 2026-08-02 sweep
claims it made this exact substitution repo-wide — 010 was missed.

**Auto-resolvable:** false

---

### DRIFT-010: NFR-001..NFR-004 have no plan.md section

| Field         | Value                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------- |
| **Layer**     | 3                                                                                        |
| **Direction** | Forward                                                                                  |
| **Severity**  | ⚠️ WARNING                                                                               |
| **Category**  | structural                                                                               |
| **Source**    | `spec.md` Non-Functional Requirements                                                    |
| **Target**    | `plan.md`                                                                                |
| **Evidence**  | No section addresses strict typing, JSDoc, accessible names, or the color-plus-icon rule |

**Proposed resolution:** Fold into the Constitution Check section that DRIFT-019 requires.

**Auto-resolvable:** false

---

### DRIFT-011: plan.md and tasks.md disagree on the data model

| Field         | Value                                                                                                                                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 4: plan.md ↔ tasks.md                                                                                                                                                        |
| **Direction** | Forward                                                                                                                                                                      |
| **Severity**  | ❌ CRITICAL                                                                                                                                                                  |
| **Category**  | structural                                                                                                                                                                   |
| **Source**    | `plan.md` §2                                                                                                                                                                 |
| **Target**    | `tasks.md` T-002                                                                                                                                                             |
| **Evidence**  | plan.md adds a TypeORM `plan` column. T-002: "Extend `accounts` **Drizzle** schema… existing accounts default to `subscriptionTier='free'`, `subscriptionStatus='inactive'`" |
| **Actual**    | Two different column names and two different ORMs for the same fact                                                                                                          |

**Proposed resolution:** Make plan.md follow tasks.md (which matches shipped reality), not
the reverse. Note the 2026-06-02 run recorded this layer as **PASS**.

**Auto-resolvable:** false

---

### DRIFT-012: No task implements FR-044

| Field         | Value                                                                    |
| ------------- | ------------------------------------------------------------------------ |
| **Layer**     | 4                                                                        |
| **Direction** | Forward                                                                  |
| **Severity**  | ❌ CRITICAL                                                              |
| **Category**  | structural                                                               |
| **Source**    | `spec.md` FR-044                                                         |
| **Target**    | `tasks.md` (28 tasks, T-001..T-028)                                      |
| **Evidence**  | No task references the token claim, `public_metadata`, or `clerk-verify` |

**Proposed resolution:** Add tasks for (a) writing the claim on tier change, (b) teaching
`@kitchensink/clerk-verify` to read it fail-closed, (c) migrating consumers off
`PREMIUM_PERMISSION`, (d) the staleness/revocation behavior.

**Auto-resolvable:** false

---

### DRIFT-013: The shared-subscription package required by IN-003 is unplanned

| Field         | Value                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Layer**     | 4                                                                                                                                                                                    |
| **Direction** | Forward                                                                                                                                                                              |
| **Severity**  | ⚠️ WARNING                                                                                                                                                                           |
| **Category**  | structural                                                                                                                                                                           |
| **Source**    | `specs/cross-feature-burndown.md` IN-003 — "Extract `@RequirePremium()` decorator + `PlanGuard` to `packages/shared/subscription/` early in `010` work so beta features can import." |
| **Target**    | `plan.md`, `tasks.md`                                                                                                                                                                |
| **Evidence**  | No plan section, no task, no workspace registration                                                                                                                                  |
| **Expected**  | A shared workspace registered per Constitution Principle V (root `workspaces` entry + the four `@kitchensink/*` tooling devDeps)                                                     |

**Proposed resolution:** Add the package to the plan and task it before the consuming
services' gating tasks.

**Auto-resolvable:** false

---

### DRIFT-014: TASK-020 integration-vs-E2E label drift (carried forward)

| Field         | Value                                                     |
| ------------- | --------------------------------------------------------- |
| **Layer**     | 4                                                         |
| **Direction** | Forward                                                   |
| **Severity**  | ℹ️ INFO                                                   |
| **Category**  | structural                                                |
| **Source**    | `plan.md` §9 (E2E upgrade flow only)                      |
| **Target**    | `tasks.md` T-020 "Integration tests for webhook handlers" |
| **Evidence**  | Reported as W-001 on the 2026-06-02 run; still unresolved |

**Proposed resolution:** Decide the tier and align the label. Note the repo requires a
distinct config, script, and CI step per non-unit tier.

**Auto-resolvable:** false

---

### DRIFT-015: spec.md's "imported recipes are always public" is contradicted three ways by shipped code

| Field         | Value                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 6: spec.md ↔ Code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Direction** | Backward                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **Severity**  | ❌ CRITICAL                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Category**  | structural                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Source**    | shipped `packages/services/recipe-service/src/recipes/domain/visibility-policy.ts` → `evaluateVisibility`                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Target**    | `spec.md` Assumptions + FR-043 acceptance scenario 6                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Evidence**  | spec.md: "Imported, attributed recipes are **always public** regardless of subscription tier"; FR-043 §6: "except imported/attributed recipes, which **MUST remain public**". Shipped policy: `IMPORTED_PHYSICAL` → `deny('An imported physical-book recipe is private-only and may not be made public.')`; `IMPORTED_PAID` → `deny('… may never be made public.')`; `IMPORTED_PUBLIC` + premium + `hasSubstantiveEdit` → `allow('A substantively-edited imported public recipe may be made private by a premium user.')` |
| **Expected**  | spec.md language matching the shipped four-way `sourceType` taxonomy                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Actual**    | A blanket "always public" rule that is false for three of the four source types                                                                                                                                                                                                                                                                                                                                                                                                                                           |

**Impact:** FR-043's lapse behavior is **unimplementable against `main` as written** —
forcing an `imported_physical` recipe public on subscription lapse would violate the shipped
policy and the source TOS the sentence invokes. This survived every prior report because
Layer 6 was always skipped as "no code yet", while the gating code shipped under 001/004.

**Proposed resolution:** Rewrite the assumption and FR-043 §6 against the shipped
`sourceType` taxonomy, and re-derive V-Model `REQ-017` ("unlock clone-to-private for
imported recipes"), which restates the same error without the substantive-edit condition.

**Auto-resolvable:** false

---

### DRIFT-016: Shipped premium gating is an attributed orphan with no 010 trace

| Field           | Value                                                                                                                                                                                                                                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**       | 6 / 9                                                                                                                                                                                                                                                                                                                                    |
| **Direction**   | Backward                                                                                                                                                                                                                                                                                                                                 |
| **Severity**    | ⚠️ WARNING                                                                                                                                                                                                                                                                                                                               |
| **Category**    | structural                                                                                                                                                                                                                                                                                                                               |
| **Source**      | `packages/services/recipe-service/src/recipes/recipes.service.ts`, `.../domain/visibility-policy.ts`                                                                                                                                                                                                                                     |
| **Target**      | `plan.md`, `tasks.md`, `v-model/`                                                                                                                                                                                                                                                                                                        |
| **Evidence**    | `export const PREMIUM_PERMISSION = 'premium';` — "There is deliberately NO tier field on the Principal (subscriptions are a future feature, 010), so premium is derived from the signed session token's `permissions` claim… **Centralized here so the C-004 policy has a single tier source until 010 introduces real subscriptions.**" |
| **Attribution** | commit `9658ed05` (Brandon, 2026-08-02)                                                                                                                                                                                                                                                                                                  |
| **Actual**      | 010-scoped entitlement gating already shipped under features 001/004; no 010 artifact mentions it                                                                                                                                                                                                                                        |

**Proposed resolution:** Record it as 010's inherited starting point. The owner ruling of
2026-08-07 retires this carrier in favor of the FR-044 `subscription_tier` claim — that
retirement needs its own task so the repo does not end up with two tier sources.

**Auto-resolvable:** false

---

### DRIFT-017: No `contracts/` artifacts, so Layer 8 can never run

| Field         | Value                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| **Layer**     | 8                                                                       |
| **Direction** | Forward                                                                 |
| **Severity**  | ⚠️ WARNING                                                              |
| **Category**  | structural                                                              |
| **Source**    | `plan.md` §3 API Contracts (4 endpoints defined in prose + inline JSON) |
| **Target**    | `{FEATURE_DIR}/contracts/openapi.yaml`                                  |
| **Actual**    | Absent — the directory does not exist                                   |

**Proposed resolution:** Emit `contracts/openapi.yaml` for the four billing endpoints. Until
then FE↔BE contract drift is unverifiable and the `oasdiff` differ path is unavailable.

**Auto-resolvable:** false

---

### DRIFT-018: Web-only billing violates Principle VIII with no recorded waiver

| Field         | Value                                                                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 10: Constitution ↔ Code                                                                                                                                                                                                                                                                                     |
| **Direction** | Forward                                                                                                                                                                                                                                                                                                     |
| **Severity**  | ❌ CRITICAL                                                                                                                                                                                                                                                                                                 |
| **Category**  | structural                                                                                                                                                                                                                                                                                                  |
| **Source**    | `.specify/memory/constitution.md` Principle VIII — "No user-facing feature MAY ship to one platform before the other… Phased single-platform rollouts are **prohibited unless an explicit constitutional waiver is recorded in the feature's `plan.md` Complexity Tracking table** and approved in the PR." |
| **Target**    | `plan.md`                                                                                                                                                                                                                                                                                                   |
| **Evidence**  | D-6 / spec.md: "Web is the primary billing surface. Stripe Checkout and the Stripe Customer Portal are **web-only**." US-010-006 (Billing Self-Service) is user-facing.                                                                                                                                     |
| **Actual**    | `plan.md` contains no Complexity Tracking table and no waiver                                                                                                                                                                                                                                               |

**Proposed resolution:** Record the waiver with its justification (Stripe Checkout/Portal
are hosted web surfaces; native IAP is out of v1 scope) and get it approved, or bring mobile
to parity. The decision is already made — it is the _record_ that is missing.

**Auto-resolvable:** false

---

### DRIFT-019: plan.md has no Constitution Check gate

| Field         | Value                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Layer**     | 10                                                                                                                                                                              |
| **Direction** | Forward                                                                                                                                                                         |
| **Severity**  | ❌ CRITICAL                                                                                                                                                                     |
| **Category**  | structural                                                                                                                                                                      |
| **Source**    | `.specify/memory/constitution.md` Governance — "The plan template's **Constitution Check** gate MUST be completed before Phase 0 research and re-checked after Phase 1 design." |
| **Target**    | `plan.md`                                                                                                                                                                       |
| **Actual**    | No Constitution Check section exists anywhere in the 312-line plan                                                                                                              |

**Proposed resolution:** Add the gate, covering all eight principles. It is also the natural
home for DRIFT-010 (NFR coverage) and DRIFT-018 (the Principle VIII waiver).

**Auto-resolvable:** false

---

### DRIFT-020: Entity interface uses `Date` where the constitution mandates ISO 8601 strings

| Field          | Value                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Layer**      | 10                                                                                                                                                     |
| **Direction**  | Forward                                                                                                                                                |
| **Severity**   | ⚠️ WARNING                                                                                                                                             |
| **Category**   | structural                                                                                                                                             |
| **Source**     | Constitution Principle I — "Dates in interfaces MUST be ISO 8601 strings (`string`), never `Date` objects, to guarantee cross-platform serialization." |
| **Target**     | `plan.md` §2                                                                                                                                           |
| **Evidence**   | `currentPeriodEnd: Date \| null;` and `trialEndsAt: Date \| null;`                                                                                     |
| **Mitigating** | The `GET /api/v1/billing/subscription` response shape does use ISO strings                                                                             |

**Proposed resolution:** Keep `Date` only inside the Drizzle row type; expose ISO strings on
every interface that crosses a boundary, and say so explicitly in §2.

**Auto-resolvable:** false

---

## Proposed Actions

Ordered by dependency — later items are unsafe to do before earlier ones.

1. **Correct `spec.md` first** (DRIFT-015, 005): the imported-recipe visibility rule and the
   persona scope notes. Everything downstream inherits these.
2. **Rewrite `plan.md`** (DRIFT-006, 007, 008, 009, 010, 013, 017, 018, 019, 020): FR-044
   architecture, Drizzle data model, cross-service gating, shared package, contracts,
   Constitution Check + Principle VIII waiver.
3. **Re-derive `tasks.md`** (DRIFT-011, 012, 013, 014, 016) from the corrected plan.
4. **Regenerate the V-Model chain** — `REQ-017` carries the DRIFT-015 error; requirements,
   architecture, module design, hazard analysis, the three test plans, and the traceability
   matrix all need FR-044 rows.
5. **Backfill `product-spec/`** (DRIFT-003, 004) and refresh `research/codebase-analysis.md`
   (DRIFT-001, 002).

## Sync History

| Run | Date       | Layers        | CRITICAL | WARNING | Verdict        |
| --- | ---------- | ------------- | -------- | ------- | -------------- |
| #1  | 2026-06-02 | 5/7 (L5 skip) | 0        | 1       | PASS           |
| #2  | 2026-08-07 | 8+1/10        | 9        | 9       | CRITICAL DRIFT |

---

**END OF REPORT**
