# Integration Test Plan: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09 | **Regenerated**: 2026-08-02
**Status**: Draft
**Source**: [`v-model/architecture-design.md`](./architecture-design.md)

## Overview

Every Phase-1 architecture module has one or more Integration Test Cases (`ITP`), each with executable Integration
Scenarios (`ITS`) in module-boundary BDD form.

Integration tests verify **seams and handshakes**, not internal logic (unit) or user journeys (acceptance).

> **Regeneration note — the binding rule.** `ENGINEERING_EXCELLENCE.md` → QSE §6: _"At the integration layer, test
> against REAL dependencies, not mocks. Mocks encode your assumptions about a dependency; real containers test the
> dependency itself — SQL, constraints, isolation."_ Every database scenario below runs against **Docker PostgreSQL with
> the real migrations applied**, never an in-memory double. That matters concretely here: several of this feature's
> invariants (span ≤ 90 days, servings 1–99, slot membership, cascade delete, the idempotency primary key) are enforced
> by **database `CHECK`s and constraints** and are therefore invisible to a mocked repository.
>
> Cases for deleted modules — the Redis cache (`ITP-009`), the USDA adapter (`ITP-017`), the AI/waste modules
> (`ITP-010`..`ITP-015`), the premium guard (`ITP-021`) — have no successors. New cases cover the seams the reconciled
> design actually has: a degrading gateway, transactional idempotency, and cross-service contract drift.

## ID Schema

- **Integration Test Case**: `ITP-{NNN}-{X}` — NNN matches the parent ARCH.
- **Integration Test Scenario**: `ITS-{NNN}-{X}{#}`.

## Techniques (ISO 29119-4)

| Technique                                | Source View              | What it tests                                                     |
| ---------------------------------------- | ------------------------ | ----------------------------------------------------------------- |
| **Interface Contract Testing**           | Interface View           | API contracts, data formats, error responses                      |
| **Data Flow Testing**                    | Data Flow View           | The full transformation chain across module boundaries            |
| **Interface Fault Injection**            | Interface + Process View | Malformed payloads, timeouts, 5xx, partial responses              |
| **Concurrency & Race Condition Testing** | Process View             | Simultaneous access, transactional atomicity, retry storms        |
| **Consumer-Driven Contract Testing**     | Interface View           | The 006 ↔ 001 batch-nutrition contract, from both sides           |
| **Persistence Constraint Testing**       | Data View                | **New.** Database-enforced invariants, exercised against real SQL |

## Environment

| Dependency     | Integration tier                                                                                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL     | **Real** — Docker `postgres:16-alpine`, migrations applied, per-suite database                                                                                                                   |
| Recipe service | **Stubbed at the HTTP boundary** (a local server), never at the client object — so timeouts, 5xx, malformed bodies and slow responses are genuinely exercised through `ky` and the `AbortSignal` |
| Clerk          | Locally minted tokens against a test key; verification is networkless                                                                                                                            |
| LocalStack     | Available in the harness; **this feature uses no AWS services**, so no bucket or queue is provisioned                                                                                            |

File convention (matching the shipped recipe service):
`packages/services/meal-plan-service/__tests__/integration/**/*.integration.test.ts`.

---

## ARCH-009 / ARCH-010 / ARCH-011 — Plans (controller ↔ service ↔ repository ↔ database)

### ITP-009-A — Interface Contract Testing: create and read

| Scenario   | Given / When / Then                                                                                                                                                                  |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ITS-009-A1 | **Given** an authenticated principal, **when** a valid plan is POSTed, **then** `201` is returned **and** a row exists in `meal_plans` with `owner_id` equal to the token's app ULID |
| ITS-009-A2 | **Given** a persisted plan, **when** it is fetched, **then** the response carries its entries and per-day nutrition **in one round trip**                                            |
| ITS-009-A3 | **Given** an invalid range, **when** POSTed, **then** `422` with `details` naming the offending field **and** no row is created                                                      |
| ITS-009-A4 | **Given** no Authorization header, **when** any route but `/health` is called, **then** `401`                                                                                        |

### ITP-009-B — Persistence Constraint Testing (database-enforced invariants)

These bypass the service layer and write directly to the database, proving the constraint exists in SQL rather than only
in TypeScript (REQ-CN-005, HAZ-043).

| Scenario   | Given / When / Then                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------- |
| ITS-009-B1 | **When** a row with `end_date < start_date` is inserted directly, **then** the database rejects it               |
| ITS-009-B2 | **When** a 91-day span is inserted directly, **then** the database rejects it                                    |
| ITS-009-B3 | **When** an empty `meal_slots` array is inserted directly, **then** the database rejects it                      |
| ITS-009-B4 | **When** `meal_slots` contains `'brunch'`, **then** the database rejects it                                      |
| ITS-009-B5 | **When** `servings = 0` or `100` is inserted directly into `meal_plan_entries`, **then** the database rejects it |
| ITS-009-B6 | **When** a 501-character note is inserted directly, **then** the database rejects it                             |

### ITP-011-A — Owner scoping (HAZ-020)

| Scenario   | Given / When / Then                                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-011-A1 | **Given** a plan owned by user A, **when** user B fetches it by id, **then** `404` with a body **byte-identical** to that of a genuinely absent id |
| ITS-011-A2 | **Given** plans owned by A and B, **when** A lists plans, **then** only A's appear                                                                 |
| ITS-011-A3 | **Given** a plan owned by A, **when** B attempts to delete it, **then** `204` **and** the row still exists                                         |
| ITS-011-A4 | **Given** a plan owned by A, **when** B adds an entry to it, **then** `404` **and** no entry row is created                                        |

ITS-011-A1 asserting **byte-identical** bodies is deliberate: a differing `message` is an existence oracle.

**ITS-011-A3 corrected 2026-08-07 (T029) — it said `404`, which defeated the very property this section exists to protect.** `DELETE` answers `204` for a plan that is absent, and `204` for one owned by somebody else; the two are indistinguishable, exactly as the `GET` in ITS-011-A1 is. Under the old `404`, the status code itself became the existence oracle — B could enumerate which plan ids exist by deleting them and reading `404` (foreign, therefore real) versus `204` (absent). It also contradicted ITS-010-B2 (a repeat delete is success-shaped) and `contracts/openapi.yaml`, whose `deleteMealPlan` publishes only `204` and `401`. The load-bearing half of the assertion is unchanged and is what actually proves scoping: **the row still exists.** A `204` that quietly deleted another owner's plan would be catastrophic and silent, so the row-survives assertion — not the status code — is the test.

### ITP-011-B — Keyset pagination

| Scenario   | Given / When / Then                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ITS-011-B1 | **Given** 25 plans, **when** paged with `limit=10`, **then** three pages return 10/10/5 with no duplicates and no omissions                                                                            |
| ITS-011-B2 | **Given** a page-1 cursor, **when** a new plan is inserted **before** page 2 is fetched, **then** page 2 still returns the expected rows with no shifted duplicates — the property offset paging lacks |
| ITS-011-B3 | **Given** `limit=500`, **when** requested, **then** it is clamped to 100                                                                                                                               |

### ITP-010-A — Range narrowing (HAZ-029)

| Scenario   | Given / When / Then                                                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-010-A1 | **Given** a 7-day plan with an entry on day 7, **when** the range is narrowed to 5 days, **then** `409` with the affected count **and** the entry still exists |
| ITS-010-A2 | **Given** the same plan with no entries past day 5, **when** narrowed, **then** `200` and the range is updated                                                 |

### ITP-010-B — Cascade delete

| Scenario   | Given / When / Then                                                                                                                                                                      |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-010-B1 | **Given** a plan with 10 entries, **when** the plan is deleted, **then** zero `meal_plan_entries` rows remain for it — asserted by direct SQL, since the cascade is a database behaviour |
| ITS-010-B2 | **When** the same plan is deleted again, **then** the response is success-shaped                                                                                                         |

---

## ARCH-012 — Entries ↔ Gateway ↔ Idempotency ↔ database

### ITP-012-A — Data Flow Testing: assignment chain

| Scenario   | Given / When / Then                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-012-A1 | **Given** the recipe stub answers `readable`, **when** an entry is POSTed, **then** `201` **and** the row is persisted with the submitted servings and note |
| ITS-012-A2 | **Given** the stub answers `404`, **when** an entry is POSTed, **then** `404` **and** no row is persisted                                                   |
| ITS-012-A3 | **Given** the stub times out, **when** an entry is POSTed, **then** `503` **and** no row is persisted — **fail closed** (HAZ-031)                           |
| ITS-012-A4 | **Given** a date outside the plan range, **when** POSTed, **then** `422` and no row                                                                         |
| ITS-012-A5 | **Given** a slot not in the plan's slot set, **when** POSTed, **then** `422` and no row                                                                     |
| ITS-012-A6 | **Given** an existing entry, **when** the same recipe is assigned to a **different** cell, **then** `201` and **two** rows exist                            |

### ITP-012-B — Idempotency across a real transaction (HAZ-006, HAZ-030)

| Scenario   | Given / When / Then                                                                                                                                                                                                   |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-012-B1 | **Given** a POST with key `K` succeeded, **when** an identical POST with `K` arrives, **then** the **same** entry id is returned and exactly one row exists                                                           |
| ITS-012-B2 | **Given** key `K` used by user A, **when** user B POSTs with key `K`, **then** B's request executes normally and creates its own row                                                                                  |
| ITS-012-B3 | **Given** two identical POSTs issued **concurrently** with key `K`, **then** exactly one row exists and both responses carry the same entry id                                                                        |
| ITS-012-B4 | **Given** the transaction is aborted after the entry insert but before commit, **then** **neither** the entry **nor** the idempotency row exists — a subsequent retry genuinely creates the entry (HAZ-030)           |
| ITS-012-B5 | **Given** an idempotency row older than 24 h, **when** the same key is replayed, **then** the request executes as **new** — the expired key does not replay a stale response                                          |
| ITS-012-B6 | **Given** 200 expired rows for an owner, **when** that owner performs one write, **then** at most **50** are pruned in that transaction and the rest drain over subsequent writes — the prune is bounded (PRF-006-17) |
| ITS-012-B7 | **Given** expired rows belonging to **another** owner, **when** this owner writes, **then** the other owner's rows are untouched — pruning is owner-scoped                                                            |
| ITS-012-B8 | **Given** an owner with no expired rows, **when** they write, **then** the prune deletes nothing and adds no measurable latency                                                                                       |

ITS-012-B4 is the scenario that cannot be written with a mocked repository, and the one that catches a silent lost
write. It is the clearest justification for the real-dependency rule.

### ITP-012-C — Move and remove

| Scenario   | Given / When / Then                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| ITS-012-C1 | **When** an entry is moved to another cell, **then** one row exists at the new cell and none at the old |
| ITS-012-C2 | **When** an entry is moved outside the plan range, **then** `422` and the entry is unmoved              |
| ITS-012-C3 | **When** an entry is removed twice, **then** both responses are success-shaped and the row is gone      |

---

## ARCH-014 / ARCH-015 — Nutrition ↔ Gateway (fault injection)

### ITP-015-A — Interface Fault Injection against a real HTTP stub

| Scenario   | Stub behaviour                   | Then                                                                                                  |
| ---------- | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| ITS-015-A1 | 200, valid payload               | `200`; per-day totals correct; `isComplete: true`                                                     |
| ITS-015-A2 | Delay beyond the gateway timeout | `200`; entries present; nutrition marked unavailable; **the request is observably aborted** (HAZ-034) |
| ITS-015-A3 | 500                              | `200`; nutrition unavailable; **the plan still renders**                                              |
| ITS-015-A4 | Malformed JSON body              | `200`; nutrition unavailable; no malformed data surfaces in the response                              |
| ITS-015-A5 | Rows with `nutrition: null`      | `200`; those entries flagged orphaned; day `isComplete: false`; totals exclude them (HAZ-005)         |
| ITS-015-A6 | Chunk 1 OK, chunk 2 500          | `200`; partial totals; `isComplete: false` — the `degraded` path end-to-end (HAZ-032)                 |
| ITS-015-A7 | 401 from the recipe service      | `200`; nutrition unavailable; **not** surfaced to the caller as their own auth failure                |

ITS-015-A3 and A7 together assert the core promise: **a dependency failure never becomes the planner's failure.**

### ITP-015-B — Bounded fan-out (REQ-010, NFR-006)

| Scenario   | Given / When / Then                                                                                                                                           |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-015-B1 | **Given** a 90-day plan with 360 entries over 40 distinct recipes, **when** it is read, **then** the stub receives exactly **one** request (40 ≤ batch limit) |
| ITS-015-B2 | **Given** 250 distinct recipes, **then** the stub receives exactly **three** requests                                                                         |
| ITS-015-B3 | **Given** 360 entries sharing 3 recipes, **then** the stub receives **3** ids, not 360 — deduplication at the boundary                                        |
| ITS-015-B4 | **Given** any plan, **then** the number of requests is independent of entry count — the N+1 regression guard                                                  |

ITS-015-B4 is the standing guard against the May design's per-entry read pattern quietly returning.

### ITP-015-C — Consumer-Driven Contract with the recipe service (REQ-IF-008)

| Scenario   | Given / When / Then                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ITS-015-C1 | **Given** the published contract for `POST /api/v1/recipes/nutrition-batch`, **when** the **real** recipe service is run against it, **then** the response satisfies the consumer's schema |
| ITS-015-C2 | **Given** a recipe the caller cannot read, **then** the provider returns `nutrition: null` — **not** a 403, and not an omitted row (which would be ambiguous with a lost id)               |
| ITS-015-C3 | **Given** a request exceeding the provider's batch limit, **then** the provider returns a documented error the gateway handles as a chunking bug, not as data                              |
| ITS-015-C4 | **Given** a provider change removing a field, **then** the consumer contract test **fails in the provider's CI**                                                                           |

ITS-015-C4 is the point of CDCT: 006's expectation breaks 001's build, not 006's production.

---

## ARCH-013 — Templates

### ITP-013-A — Transactional apply (HAZ-037)

| Scenario   | Given / When / Then                                                                                                                                                                |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-013-A1 | **Given** a 7-day template of 18 entries all readable, **when** applied, **then** a new plan with 18 entries exists and the skip report is all-zero                                |
| ITS-013-A2 | **Given** two recipes unreadable, **when** applied, **then** 16 entries exist and the response reports `unreadableRecipe: 2`                                                       |
| ITS-013-A3 | **Given** the insert fails partway, **then** **no** plan row and **no** entry rows exist — all-or-nothing                                                                          |
| ITS-013-A4 | **Given** the gateway is unavailable, **when** applied, **then** the new plan is created empty with a skip report accounting for every entry — never a plan silently missing meals |
| ITS-013-A5 | **Given** an apply with key `K` succeeded, **when** replayed with `K`, **then** the same plan id is returned and only one plan exists                                              |
| ITS-013-A6 | **Given** the source plan is later edited, **then** the template is unchanged — independence                                                                                       |

---

## ARCH-007 / ARCH-018 — Projection and erasure

### ITP-007-A — Grocery projection contract

| Scenario   | Given / When / Then                                                                                               |
| ---------- | ----------------------------------------------------------------------------------------------------------------- |
| ITS-007-A1 | **When** the projection is fetched, **then** it carries `version: 'v1'` and only the four documented entry fields |
| ITS-007-A2 | **Given** an orphaned entry, **then** it is **absent** from the projection                                        |
| ITS-007-A3 | **Given** an empty plan, **then** `entries: []`                                                                   |
| ITS-007-A4 | **Given** another user's plan, **then** `404`                                                                     |

### ITP-018-A — Account erasure (HAZ-040, REQ-020)

| Scenario   | Given / When / Then                                                                                                                                                                               |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-018-A1 | **Given** user A with 3 plans, 40 entries, 2 templates and idempotency rows, **when** erasure runs, **then** **zero** rows remain for A across **all four** tables — asserted by direct SQL count |
| ITS-018-A2 | **Given** user B's data alongside, **then** B's rows are untouched                                                                                                                                |
| ITS-018-A3 | **When** erasure is re-driven after completion, **then** it succeeds (idempotent)                                                                                                                 |
| ITS-018-A4 | **Given** erasure interrupted mid-way, **when** re-driven, **then** it completes to zero residual rows                                                                                            |

---

## ARCH-025 — Typed client ↔ service

### ITP-025-A — Client contract against the running service

`packages/clients/meal-plan-service/src/__integration__/client.integration.test.ts`, mirroring the shipped recipe
client's arrangement.

| Scenario   | Given / When / Then                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| ITS-025-A1 | **When** each client method is exercised against the real service, **then** the parsed result matches the declared TypeScript type at runtime |
| ITS-025-A2 | **Given** a `422`, **then** the client raises its typed validation error carrying `details`                                                   |
| ITS-025-A3 | **Given** a `404`, **then** the client raises a not-found error indistinguishable between absent and not-owned                                |
| ITS-025-A4 | **When** an entry is created twice with one key, **then** the client surfaces one entry                                                       |

---

## ARCH-019 / ARCH-022 — Client integration

| Test case | Scenario   | Given / When / Then                                                                                                                                                               |
| --------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ITP-019-A | ITS-019-A1 | **Given** the board hook against a mock service worker, **when** `assign` is called, **then** the board shows the entry optimistically and reconciles to the server value         |
|           | ITS-019-A2 | **Given** the request fails, **then** the optimistic entry rolls back and an error state is exposed                                                                               |
| ITP-022-A | ITS-022-A1 | **Given** the capability is enabled, **when** Home composes widgets, **then** the meal-plan widget appears **once**, at weight 1200, and **no** skeleton for it renders (HAZ-038) |
|           | ITS-022-A2 | **Given** the capability is disabled, **then** the widget is **absent** — not a skeleton                                                                                          |
|           | ITS-022-A3 | **Given** the widget's data request fails, **then** its error boundary renders and the rest of Home still renders                                                                 |

---

## Coverage Summary

| Metric                                                     | Count                                                                |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| Phase-1 ARCH modules with integration cases                | 14 / 18 (pure domain modules are unit-tier by nature; MOD-024 is CI) |
| Integration test cases (`ITP`)                             | 18                                                                   |
| Integration scenarios (`ITS`)                              | 72                                                                   |
| Scenarios against a **real** database                      | 46                                                                   |
| Scenarios against a **real HTTP** stub (not a mock object) | 21                                                                   |
| Consumer-driven contract scenarios                         | 4                                                                    |
| Concurrency / transactional-atomicity scenarios            | 5                                                                    |
| Database-enforced-constraint scenarios                     | 6                                                                    |

### Hazard coverage from the integration tier

| Hazard  | Covering scenarios     |
| ------- | ---------------------- |
| HAZ-003 | ITS-009-B2             |
| HAZ-005 | ITS-015-A5             |
| HAZ-006 | ITS-012-B1, B3         |
| HAZ-020 | ITS-011-A1..A4         |
| HAZ-021 | ITS-007-A1             |
| HAZ-026 | ITS-012-B3             |
| HAZ-029 | ITS-010-A1/A2          |
| HAZ-030 | **ITS-012-B4**         |
| HAZ-031 | ITS-012-A3             |
| HAZ-032 | ITS-015-A6             |
| HAZ-034 | ITS-015-A2             |
| HAZ-036 | ITS-015-B2, ITS-015-C3 |
| HAZ-037 | ITS-013-A2..A4         |
| HAZ-038 | ITS-022-A1/A2          |
| HAZ-040 | ITS-018-A1..A4         |
| HAZ-043 | ITP-009-B (all six)    |

HAZ-041 (database-name derivation) and HAZ-042 (listener priority) are infrastructure hazards verified by CDK synth
tests and the cross-stack parity test, recorded in [`system-test.md`](./system-test.md) — not reachable from this tier.
