# System Test Plan: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09 | **Regenerated**: 2026-08-02
**Status**: Draft
**Source**: [`v-model/system-design.md`](./system-design.md)

## Overview

Every Phase-1 system component has one or more System Test Cases (`STP`), each with executable System Scenarios (`STS`)
in technical BDD form. System tests verify **architectural behaviour** — the deployed service driven over HTTP, the
client surfaces driven as a browser or device would — not user journeys (acceptance).

> **Regeneration note.** Three additions the May plan lacked entirely:
>
> 1. **A component-test state matrix.** `CODING_STANDARDS §7.1` requires a vitest component test for **every** UI
>    path/state on **each** platform — "not a representative sample; every single path". The May plan had no
>    component-test tier at all, so the requirement was unmet by omission.
> 2. **Mobile.** No Maestro flows existed. `§14.1` makes that a rejection criterion.
> 3. **Infrastructure system tests.** CDK synth assertions for the listener-priority band, tagging and the
>    database-name parity test — the controls for HAZ-041 and HAZ-042, which no other tier can reach.
>
> Cases for deleted components (cache, USDA adapter, AI services, premium guard) have no successors.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — NNN matches the parent SYS.
- **System Test Scenario**: `STS-{NNN}-{X}{#}`.

## Techniques (ISO 29119)

Interface Contract Testing · Boundary Value Analysis · Equivalence Partitioning · Fault Injection ·
**Performance/Load** (k6) · **Accessibility Verification** (new) · **Infrastructure Synthesis Assertion** (new).

## Environments

| Tier             | Environment                                                                  |
| ---------------- | ---------------------------------------------------------------------------- |
| Service e2e      | The Nest app booted against Docker PostgreSQL + LocalStack, driven over HTTP |
| k6               | `packages/tools/loadtest`, against a deployed preview or the local e2e stack |
| Web component    | vitest + React Testing Library, jsdom                                        |
| Mobile component | vitest + RTL with the repo's native stubs (`*.native.test.tsx`)              |
| Web E2E          | Playwright against a running web app + service                               |
| Mobile E2E       | Maestro against an Expo dev build (CI-gated behind the `heavy-e2e` label)    |
| Infrastructure   | CDK synth assertions in `infra/__tests__`                                    |

---

## SYS-001 — Meal Plan Manager

### STP-001-A — Interface Contract Testing: lifecycle over HTTP

| Scenario   | Given / When / Then                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STS-001-A1 | **Given** a booted service and a valid token, **when** the full create→read→update→delete cycle runs, **then** each response matches the OpenAPI contract |
| STS-001-A2 | **When** the OpenAPI document is validated against live responses, **then** there is no drift                                                             |
| STS-001-A3 | **When** `/health` is called without a token, **then** `200` — the only unauthenticated route                                                             |
| STS-001-A4 | **When** any other route is called without a token, **then** `401`                                                                                        |

### STP-001-B — Boundary Value Analysis over the wire

| Scenario   | Input            | Then  |
| ---------- | ---------------- | ----- |
| STS-001-B1 | 1-day plan       | `201` |
| STS-001-B2 | 90-day plan      | `201` |
| STS-001-B3 | 91-day plan      | `422` |
| STS-001-B4 | end before start | `422` |
| STS-001-B5 | zero slots       | `422` |
| STS-001-B6 | all four slots   | `201` |

---

## SYS-002 — Entry Assignment

### STP-002-A — Equivalence Partitioning: assignment outcomes

| Scenario   | Given / When / Then                                                                                      |
| ---------- | -------------------------------------------------------------------------------------------------------- |
| STS-002-A1 | **Given** a readable recipe and a valid cell, **then** `201` and the entry appears on the next plan read |
| STS-002-A2 | **Given** an unreadable recipe, **then** `404` matching the absent-recipe response exactly               |
| STS-002-A3 | **Given** a date outside the range, **then** `422`                                                       |
| STS-002-A4 | **Given** a slot outside the plan's set, **then** `422`                                                  |
| STS-002-A5 | **Given** a duplicate `Idempotency-Key`, **then** the original entry is returned and the plan holds one  |

---

## SYS-003 — Nutrition Rollup

### STP-003-A — Contract and correctness over HTTP

| Scenario   | Given / When / Then                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STS-003-A1 | **Given** entries with known recipe macros, **when** the plan is read, **then** each day's totals equal Σ(per-serving × servings)                         |
| STS-003-A2 | **Given** a day with no entries, **then** that day carries **no** `totals` field — asserted on the raw JSON, not a rendered value                         |
| STS-003-A3 | **Given** any entry with incomplete recipe nutrition, **then** the day and the plan report `isComplete: false`                                            |
| STS-003-A4 | **Given** an orphaned entry, **then** it is excluded from totals and its day is incomplete                                                                |
| STS-003-A5 | **When** a plan is read twice with no intervening change, **then** the totals are identical (determinism)                                                 |
| STS-003-A6 | **Given** a recipe is edited between two reads, **then** the second read reflects the **new** nutrition — proving totals are not snapshotted (REQ-CN-004) |

STS-003-A6 is the standing guard against a nutrition cache or rollup table reappearing.

### STP-003-B — Fault Injection

| Scenario   | Given / When / Then                                                                                                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| STS-003-B1 | **Given** the recipe service is stopped, **when** a plan is read, **then** `200` with entries present and nutrition marked unavailable |
| STS-003-B2 | **Given** the recipe service is slow beyond the timeout, **then** the plan read still completes within its own budget                  |
| STS-003-B3 | **Given** the recipe service returns 500 for one chunk only, **then** partial totals with `isComplete: false`                          |

---

## SYS-007 — Recipe Gateway · SYS-011 — Projection · SYS-012 — Erasure

| Test case | Scenario   | Given / When / Then                                                                                                                                                                                                               |
| --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STP-007-A | STS-007-A1 | **Given** a deployed preview, **when** the smoke runs, **then** the running task's `RECIPE_SERVICE_URL` is this stage's recipe origin and that origin answers, where `401`/`403`/`429` is the **PASS** (ADR-0010 ecosystem smoke) |
| STP-011-A | STS-011-A1 | **When** the projection is fetched over HTTP, **then** it validates against the published `v1` schema                                                                                                                             |
|           | STS-011-A2 | **When** an optional field is added by the provider, **then** an existing consumer contract still validates (additive evolution)                                                                                                  |
| STP-012-A | STS-012-A1 | **Given** an erasure request for a user with plan data, **when** it completes, **then** subsequent reads for that user return no plans and direct SQL finds zero rows                                                             |

---

## SYS-008 — Quality & Compliance (CI-verified)

### STP-008-A — Build and lint gates

| Scenario   | Then                                                                                                                                     |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| STS-008-A1 | `npm run typecheck` passes with zero `any`, `@ts-ignore` or `@ts-expect-error` outside test doubles                                      |
| STS-008-A2 | `eslint-plugin-check-file` passes: kebab `name.type.ts` in the service, camelCase/PascalCase in shared and product packages              |
| STS-008-A3 | Every exported symbol carries JSDoc; every module has a header naming its pattern                                                        |
| STS-008-A4 | **No user-visible string literal exists outside `messages.ts`** (FR-038)                                                                 |
| STS-008-A5 | **REQ-NF-009 dependency assertion**: no cache client, queue client, worker runtime or object-store SDK appears in any 006 `package.json` |
| STS-008-A6 | No `data-testid` and no `page.waitForTimeout()` in any Playwright spec                                                                   |
| STS-008-A7 | **No error envelope `message` reaches a rendered surface** — user copy for a failure is selected from `code` (FR-038a, REQ-023)          |

STS-008-A5 turns "we removed Redis and SQS" from a claim in a document into a check that fails a build.

> **Added 2026-08-07 — STS-008-A7.** STS-008-A4 audits _literals_, which is a different property from _rendering
> a string the server sent_. The wire envelope's `message` is operator-facing English (`contracts/openapi.yaml`
> → `ApiError.message`, and `packages/clients/meal-plan-service/src/errors.ts` gives every typed client error an
> English default), so a component that renders `error.message` passes STS-008-A4 with a clean sheet while showing
> untranslated developer text to a French user. Before this row nothing forbade it — the rule was asserted in the
> contract and the client's JSDoc and attributed to FR-038, which never said it (see FR-038a).

### STP-008-B — Infrastructure Synthesis Assertion

| Scenario   | Then                                                                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| STS-008-B1 | CDK synth for a base stage yields listener priority **400**                                                                                  |
| STS-008-B2 | Synth for `pr-73` yields **50073**, inside 006's band and colliding with no other service's band (HAZ-042)                                   |
| STS-008-B3 | Synth for a named ephemeral stage lands in 60000–69999                                                                                       |
| STS-008-B4 | A PR number ≥ 10000 raises the documented error rather than silently colliding                                                               |
| STS-008-B5 | Synth for a `pr-{N}` stage tags every taggable resource `Environment=pr-{N}`; base stages tag `Environment=global`                           |
| STS-008-B6 | **Cross-stack database-name parity**: every construct that resolves the logical DB name resolves it identically for the same stage (HAZ-041) |
| STS-008-B7 | Synth creates **no** ALB, cache cluster, queue or bucket                                                                                     |
| STS-008-B8 | Non-prod synth uses `FARGATE_SPOT`; prod uses on-demand `FARGATE` (ADR-0008)                                                                 |

---

## SYS-010 — Planner Client Surface

### STP-010-A — Component state matrix (`CODING_STANDARDS §7.1`)

**Every cell is a required, separately-named component test on that platform.** Web tests are `*.test.tsx`; mobile are
`*.native.test.tsx`.

| #   | State                     | Plans list (both) | Week grid (web) | Day list (mobile) | Month (both) | Create (both) | Templates (both) | Handoff (both) | Widget (both) |
| --- | ------------------------- | :---------------: | :-------------: | :---------------: | :----------: | :-----------: | :--------------: | :------------: | :-----------: |
| 1   | Loading                   |         ✔         |        ✔        |         ✔         |      ✔       |       —       |        ✔         |       ✔        |       ✔       |
| 2   | Empty / no data           |         ✔         |        ✔        |         ✔         |      ✔       |       ✔       |        ✔         |       ✔        |       ✔       |
| 3   | Populated                 |         ✔         |        ✔        |         ✔         |      ✔       |       —       |        ✔         |       ✔        |       ✔       |
| 4   | Saving (optimistic)       |         —         |        ✔        |         ✔         |      —       |       ✔       |        ✔         |       —        |       —       |
| 5   | Save / submit failed      |         —         |        ✔        |         ✔         |      —       |       ✔       |        ✔         |       ✔        |       —       |
| 6   | Validation error          |         —         |        —        |         —         |      —       |       ✔       |        —         |       —        |       —       |
| 7   | Orphaned entry            |         —         |        ✔        |         ✔         |      ✔       |       —       | ✔ (skip report)  |       ✔        |       ✔       |
| 8   | Partial nutrition         |         —         |        ✔        |         ✔         |      ✔       |       —       |        —         |       —        |       ✔       |
| 9   | Day with no entries       |         —         |        ✔        |         ✔         |      ✔       |       —       |        —         |       —        |       —       |
| 10  | Dependency unavailable    |         ✔         |        ✔        |         ✔         |      ✔       |       —       |        ✔         |       ✔        |       ✔       |
| 11  | Offline                   |         —         |        —        |         ✔         |      —       |       —       |        —         |       —        |       —       |
| 12  | Feature not yet available |         —         |        —        |         —         |      —       |       —       |        —         |       ✔        |       —       |
| 13  | Loading the next page     |         ✔         |        —        |         —         |      —       |       —       |        —         |       —        |       —       |

| Scenario   | Then                                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------- |
| STS-010-A1 | Every ticked cell above has a passing, separately-named component test on that platform — 100% of them (SC-006-004), no sampling |

**Total: 91 required component tests** (45 web, 46 mobile), from **55 ticked cells** — every `(both)` column is two
tests, one per platform, and the two single-platform columns are one each. SC-006-004 requires 100% of these passing.

Derivation, so the next reader can re-check it in one pass rather than trusting the number: per-column ticks are
Plans list 5, Week grid 9, Day list 10, Month 7, Create 4, Templates 7, Handoff 7, Widget 6 = **55**; tests are
`5×2 + 9 + 10 + 7×2 + 4×2 + 7×2 + 7×2 + 6×2` = **91**, of which web = `5+9+7+4+7+7+6` = 45 and mobile =
`5+10+7+4+7+7+6` = 46.

> **Corrected 2026-08-07 — the matrix gained a surface, and the compliance table's cell count was wrong.**
>
> 1. **`Plans list (both)` and state 13 are new.** The client ships `listMealPlans` with keyset pagination
>    (`packages/clients/meal-plan-service/src/MealPlanServiceClient.ts`) and the service serves `GET /api/v1/meal-plans`
>    (`packages/services/meal-plan-service/src/plans/meal-plans.controller.ts`), but no surface in this matrix
>    consumed either — so the one screen a user reaches every other screen _through_ had zero required component
>    tests. It is now FR-022a / REQ-025. State 13 exists because keyset pagination has a distinct in-flight state
>    that none of states 1–12 describes, and `§7.1` says every path, not every path we happened to list.
> 2. **The compliance table below used to read "STP-010-A — 63 cells".** No count in this document has ever been 63:
>    the pre-correction matrix held **50** ticked cells yielding **81** tests, exactly as the paragraph above it said.
>    Nothing appears to have been derived from 63 — it was a stale figure contradicting the authority two paragraphs
>    up. Left alone it invites the opposite repair (someone "fixing" the correct 81 to match the wrong 63) and a
>    silently under-built test suite.
> 3. **STS-010-A1 is new.** STP-010-A was the one test case in this plan with no `STS` id at all, which
>    `validate-system-coverage.sh` reports as a gap; enumerating 55 ids would only restate the matrix, so the
>    obligation gets one scenario id and the matrix stays the specification.

### STP-010-B — Accessibility Verification (NFR-003, NFR-004, HAZ-024)

| Scenario   | Then                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| STS-010-B1 | Every interactive planner element is reachable by `getByRole` or `getByLabel`                                 |
| STS-010-B2 | **A recipe can be assigned using the keyboard alone** — Tab, Space to lift, arrows to traverse, Space to drop |
| STS-010-B3 | Each drag transition emits a live-region announcement                                                         |
| STS-010-B4 | Orphaned and partial-nutrition states each carry a text label, verified with colour rendering disabled        |
| STS-010-B5 | The disabled handoff action exposes its reason via `aria-describedby`, not styling alone                      |
| STS-010-B6 | An automated axe scan of each planner surface reports no violations                                           |

STS-010-B2 is the requirement-level justification for choosing `@dnd-kit`; if it fails, the library choice has failed.

### STP-010-C — Cross-platform parity (REQ-IF-007, HAZ-039)

| Scenario   | Then                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| STS-010-C1 | For each of the 13 states, web and mobile expose the **same** accessible names, sourced from the same message keys   |
| STS-010-C2 | The same operation set is available on both platforms                                                                |
| STS-010-C3 | Given identical server data, both platforms derive the **same** board view model (shared selector, asserted on both) |
| STS-010-C4 | Every `.native.tsx` module has a same-named non-native sibling with a matching public API (type-level)               |

---

## End-to-End Flows

### STP-E2E-A — Playwright (web) — one per user story

| Scenario   | Flow                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------- |
| STS-E2E-A1 | US-006-001 — create a 7-day plan with three slots; reload; the grid persists                       |
| STS-E2E-A2 | US-006-002 — assign by **drag**; move; remove                                                      |
| STS-E2E-A3 | US-006-002 — assign by **keyboard only**                                                           |
| STS-E2E-A4 | US-006-003 — totals appear and update as entries change; an empty day shows no totals              |
| STS-E2E-A5 | US-006-007 — save a template, apply it, read the skip report                                       |
| STS-E2E-A6 | US-006-005 — Home shows the live widget; clicking it opens the planner                             |
| STS-E2E-A7 | US-006-004 — plan → grocery projection                                                             |
| STS-E2E-A8 | Degraded — with the recipe service stopped, the plan still renders and nutrition reads unavailable |
| STS-E2E-A9 | US-006-001 — open the plans list, open one plan, switch to a second without going back via Home    |

### STP-E2E-B — Maestro (mobile) — one per user story

| Scenario   | Flow                                                         |
| ---------- | ------------------------------------------------------------ |
| STS-E2E-B1 | US-006-001 — create a plan                                   |
| STS-E2E-B2 | US-006-002 — tap-to-assign, long-press to move and remove    |
| STS-E2E-B3 | US-006-003 — per-day totals and the partial-estimate label   |
| STS-E2E-B4 | US-006-007 — save and apply a template, read the skip report |
| STS-E2E-B5 | US-006-005 — Home widget renders and navigates               |
| STS-E2E-B6 | US-006-004 — grocery projection entry point                  |
| STS-E2E-B7 | US-006-001 — plans list → open a plan → switch to another    |

Maestro flows run in CI behind the `heavy-e2e` label, matching the existing arrangement for mobile flows.

### STP-PERF-A — k6 (SC-006-003, NFR-006, REQ-010)

| Scenario    | Profile                                        | Threshold                                                                                                                                                                                     |
| ----------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STS-PERF-A1 | Read a 30-day plan at full entry density       | **p95 ≤ 500 ms** server-side                                                                                                                                                                  |
| STS-PERF-A2 | Read a 90-day plan (360 entries)               | Downstream request count ≤ 4 and **independent of entry count**. **No p95 assertion** — per PRF-006-11 the owner accepted that the maximum supported span carries no separate latency target. |
| STS-PERF-A3 | Assignment burst — 50 concurrent creates       | No duplicate entries; p95 ≤ 300 ms                                                                                                                                                            |
| STS-PERF-A4 | Degraded profile — recipe service at 50% error | Plan reads still return `200` within budget; no error-rate amplification                                                                                                                      |
| STS-PERF-A5 | List pagination over 500 plans                 | p95 stable across deep pages (the keyset property)                                                                                                                                            |

STS-PERF-A2 deliberately asserts request count and **not** latency: bounded fan-out is the property that protects the design (it goes red the moment an N+1 regresses), whereas a p95 at 90 days would be a threshold no requirement states. STS-PERF-A4 proves the gateway's degradation is real
under load, not only in a unit stub.

---

## Coverage Summary

| Metric                                   | Count                                     |
| ---------------------------------------- | ----------------------------------------- |
| Phase-1 SYS components with system tests | 9 / 9 (100%)                              |
| System test cases (`STP`)                | 16                                        |
| System scenarios (`STS`)                 | 75 (incl. 16 E2E flows and 5 k6 profiles) |
| **Required component tests**             | **91** (45 web, 46 mobile)                |
| Playwright flows                         | 9                                         |
| Maestro flows                            | 7                                         |
| k6 profiles                              | 5                                         |
| Infrastructure synth assertions          | 8                                         |
| Accessibility scenarios                  | 6                                         |

### Test-mandate compliance (`CODING_STANDARDS §7.1`)

| Required category                        | Present | Where                                  |
| ---------------------------------------- | ------- | -------------------------------------- |
| Component test for **every** UI state    | ✔       | STP-010-A — 55 ticked cells → 91 tests |
| Playwright per web user story            | ✔       | STP-E2E-A — 9 flows                    |
| Maestro per mobile user story            | ✔       | STP-E2E-B — 7 flows                    |
| Unit **and** integration for non-UI code | ✔       | `unit-test.md`, `integration-test.md`  |
| e2e for the deployable service           | ✔       | STP-001-A, STP-003-A/B                 |
| k6 for the deployable service            | ✔       | STP-PERF-A — 5 profiles                |

All six categories present. The May plan satisfied two.

### Hazard coverage from the system tier

| Hazard  | Covering scenarios     |
| ------- | ---------------------- |
| HAZ-023 | STS-003-B1..B3         |
| HAZ-024 | STP-010-B (all)        |
| HAZ-025 | STS-008-A1             |
| HAZ-032 | STS-003-B3             |
| HAZ-033 | STS-003-A2             |
| HAZ-038 | STS-010-C1, ITS-022-A1 |
| HAZ-039 | STP-010-C (all)        |
| HAZ-041 | **STS-008-B6**         |
| HAZ-042 | **STS-008-B2..B4**     |
| HAZ-043 | STS-001-B1..B6         |
