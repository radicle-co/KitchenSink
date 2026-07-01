# Acceptance Test Plan: Source-Agnostic Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft — **re-baselined 2026-06-22 to the source-agnostic food data model**
**Source**: `specs/003-usda-food-data/spec.md` (re-baselined 2026-06-21), `specs/003-usda-food-data/v-model/requirements.md` (re-baselined 2026-06-22), `specs/003-usda-food-data/v-model/system-test.md`

> **Re-baseline note (2026-06-22).** This plan was regenerated to match the **source-agnostic food data
> redesign**. Acceptance tests now exercise the new user journeys: **add food by name** (`POST /v1/foods`
> → `202` + internal `id`, US-2), **read by `id`** (`200` `RESOLVED` / `202` `PENDING`-or-`UNRESOLVED` /
> `404` `NOT_FOUND`-or-`FAILED`, US-1/US-8), **candidate disambiguation + `PATCH` resolve** with
> candidate-set validation (US-2a), **multi-source golden-record merge correctness** (per-100g
> normalization, identity-by-source-priority, no nutritionally-incoherent blends — US-2/US-2a), **bulk
> recipe resolution** (US-4), **demand-weighted queue + failure recovery** (US-5), **search-by-name
> returning `id`s + barcode/`external_key` lookup** (US-6), **change-driven refresh** (US-7), and
> **resolution-status polling** (US-8). A food is keyed by an internal `id` (ULID); **USDA is one
> pluggable source adapter** and `fdcId` is confined to USDA-adapter-boundary acceptance criteria only.
>
> **Stripped** from the prior (USDA-coupled) plan: the `fdcId`-keyed cache-hit/miss read path, the
> `fetch_status` (`pending`/`fetched`/`not_found`/`stale`) enum, denormalized-nutrient-column fidelity
> checks, and stale-while-revalidate-by-age. These are replaced by the `id`-keyed lifecycle, the
> normalized provenance-bearing model, and change-driven refresh. The **US-0 auth slice**
> (`ATP-008` / `ATS-036`–`ATS-044`) is **preserved** — its scenarios are re-keyed `fdcId → id` and its
> six-endpoint sweep updated to the new endpoint set (`POST /v1/foods`, `GET /v1/foods/{id}`,
> `/v1/foods/{id}/status`, `/v1/foods/{id}/candidates`, `PATCH /v1/foods/{id}`, `/v1/foods/search`,
> `POST /v1/foods/batch`, WebSocket `$connect`). ATP/ATS ids are stable where the test survived;
> new ids were appended.

---

## Overview

This plan maps BDD acceptance scenarios to the user-observable contracts of the source-agnostic food data
feature. Each scenario is written from the perspective of an authenticated Commise client (a user session
token, or a machine/M2M service token) interacting with the public API surface — **never** from the
perspective of internal components. Internal component behavior (the fan-out/merge worker mechanics, the
per-source rolling-window limiter internals, the verifier load-shed) is covered by the System Test Plan
(`system-test.md`).

Acceptance tests verify that the system satisfies user-observable contracts: correct HTTP status codes
keyed on the internal `id`, the correct `PENDING → (UNRESOLVED) → RESOLVED` lifecycle with terminal
`NOT_FOUND`/`FAILED`, correct async add-by-name behavior, correct candidate disambiguation and resolve,
**correct cross-source golden-record merge** (per-100g normalization, identity-by-source-priority, no
incoherent blends), change-driven refresh that preserves human picks, correct search results (returning
`id`s, with barcode/`external_key` lookup), and correct authentication/authorization enforcement.
Non-functional acceptance criteria (latency, per-source rate-limit compliance, data fidelity) are verified
through targeted load probes and metric assertions.

Coverage is complete: every P1 and P2 functional, non-functional, interface, and constraint requirement in
`requirements.md` has at least one acceptance test case and one BDD scenario, or is covered by an explicit
trace. P3 requirements (REQ-034 WebSocket push) are noted but excluded from the shippable exit gate, except
where the US-0 auth contract reaches the (deferred) WebSocket `$connect`.

**`fdcId` confinement.** Per REQ-046 / SC-013, `fdcId` and USDA-specific terms appear in this plan **only**
inside USDA-adapter-boundary acceptance criteria (AT-023, AT-024, AT-NF018). Every other test is keyed on
the internal `id` and source-agnostic terms; one dedicated test (AT-046) asserts that no public response
field exposes `fdcId` or any source-native identifier.

---

## ID Schema

| Identifier               | Pattern      | Meaning                                                                    |
| ------------------------ | ------------ | -------------------------------------------------------------------------- |
| Acceptance Test Case     | `AT-NNN-X`   | NNN = three-digit requirement group number; X = letter suffix (A, B, C...) |
| Auth Acceptance Plan     | `ATP-008-X`  | The US-0 auth epic case family; X = letter suffix                          |
| Acceptance Test Scenario | `ATS-NNN-X#` | Nested BDD scenario under a parent AT/ATP; # = numeric suffix              |

Examples:

- `AT-002-A` — first acceptance test case for the REQ-002 group (read `RESOLVED` → `200`)
- `ATS-002-A1` — first BDD scenario within `AT-002-A`
- `ATP-008-A` / `ATS-036-A1` — the US-0 auth epic case and its first scenario

---

## Acceptance Test Cases (Tier 1-3 Structure)

---

### Tier 1 — Feature/Epic: Single Food Read by `id` (US-1, US-8)

**User Goal**: As a Commise client, I want to look up a food by its internal `id` and receive either its
complete golden-record nutrition data or a clear async/terminal status, so that I can display accurate
nutritional information in recipes. Maps to spec US-1 (resolved hit) and US-8 (status polling).

---

#### Tier 2 — REQ-001: Local-store-only serving; no external source called in the request path

**AT-001-A** — The local store is the exclusive data source for food reads; no source call in the request path

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-001-A1**

- **Given** a food exists locally with a known `id` and `status = 'RESOLVED'`
- **When** an authenticated client sends `GET /v1/foods/{id}`
- **Then** the response is `200 OK` with the golden-record payload; **zero** outbound calls to any external
  source are observed during the request lifecycle (the read is served from PostgreSQL / optional in-process
  LRU)

**ATS-001-A2** _(deferred Redis variant)_

- **Given** the deferred Redis read-through cache is enabled and holds the `RESOLVED` food under key
  `food:{id}`
- **When** an authenticated client sends `GET /v1/foods/{id}`
- **Then** the response is `200 OK` served from cache; no external source call is made. _(Under the lean
  Postgres default this read is served by ATS-001-A1's indexed `food.id` `SELECT` instead.)_

---

#### Tier 2 — REQ-002 / REQ-IF-001: `200 OK` with complete golden-record data only when `status = 'RESOLVED'` (US-1 AS-1)

**AT-002-A** — Complete golden-record payload on a `RESOLVED` read

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-002-A1**

- **Given** a food exists locally with a known `id`, `status = 'RESOLVED'`, and a fully-assembled golden
  record
- **When** an authenticated client sends `GET /v1/foods/{id}`
- **Then** the response is `200 OK`; the body contains `id`, `name`/`description`, normalized `calories`,
  `protein`, `carbs`, `fat`, available micronutrients, and **per-field provenance** (which source supplied
  each value); the body contains **no** `fdcId` or any source-native identifier (REQ-046)

---

#### Tier 2 — REQ-003 / REQ-IF-002: `202 Accepted` when the food is `PENDING` or `UNRESOLVED` (US-8 AS-1, AS-2)

**AT-003-A** — In-flight lifecycle states return `202` on read/poll

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-003-A1**

- **Given** a food exists locally with a known `id` and `status = 'PENDING'`
- **When** an authenticated client sends `GET /v1/foods/{id}` (or `GET /v1/foods/{id}/status`)
- **Then** the response is `202 Accepted` with `{"status": "PENDING", "id": "<ulid>", "estimatedWaitSeconds": <positive integer>}`;
  no nutrition payload is returned

**ATS-003-A2**

- **Given** a food exists locally with a known `id` and `status = 'UNRESOLVED'` (multiple candidates need a
  human pick)
- **When** an authenticated client polls `GET /v1/foods/{id}`
- **Then** the response is `202 Accepted` with `{"status": "UNRESOLVED", "id": "<ulid>"}`; the client is
  expected to follow up via `GET /v1/foods/{id}/candidates` (US-2a)

---

#### Tier 2 — REQ-004 / REQ-IF-001: `404 Not Found` when the food is `NOT_FOUND`, `FAILED`, or absent; `status` still retrievable (US-1 AS-4, US-8 AS-4)

**AT-004-A** — Terminal/absent states return `404` without queuing; lifecycle `status` remains retrievable

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-004-A1**

- **Given** a food exists locally with a known `id` and `status = 'NOT_FOUND'` (terminal tombstone, no
  source has it)
- **When** an authenticated client sends `GET /v1/foods/{id}`
- **Then** the response is `404 Not Found`; **no** fetch is enqueued; the lifecycle `status` is still
  retrievable via `GET /v1/foods/{id}/status` so the held `id` is recognized, not treated as bogus

**ATS-004-A2**

- **Given** a food exists locally with a known `id` and `status = 'FAILED'` (sources errored after the retry
  budget)
- **When** an authenticated client sends `GET /v1/foods/{id}`
- **Then** the response is `404 Not Found`; the `status` remains retrievable, and a `FAILED` status message
  indicates the food is re-fetchable / suggests trying again later; no fetch is enqueued by the read

**ATS-004-A3**

- **Given** no row exists for a well-formed but unknown `id`
- **When** an authenticated client sends `GET /v1/foods/{id}`
- **Then** the response is `404 Not Found`; nothing is enqueued

---

#### Tier 2 — REQ-006: `400 Bad Request` for a malformed `id` path param

**AT-006-A** — Input validation rejects non-ULID `id` values before any business logic

**Technique**: Boundary Value Analysis

##### Tier 3 — BDD Scenarios

**ATS-006-A1**

- **Given** the API is running
- **When** an authenticated client sends `GET /v1/foods/not-a-ulid`
- **Then** the response is `400 Bad Request`; no downstream processing or queuing occurs

**ATS-006-A2**

- **Given** the API is running
- **When** an authenticated client sends `GET /v1/foods/` with an empty / whitespace-only id segment, or an
  id of the wrong length/alphabet for a ULID
- **Then** the response is `400 Bad Request`

---

#### Tier 2 — REQ-007 / REQ-033 / REQ-IF-002: `GET /v1/foods/{id}/status` lifecycle endpoint (US-8 AS-1..AS-4)

**AT-007-A** — Status endpoint returns the current lifecycle `status` for every partition; full data when `RESOLVED`

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-007-A1**

- **Given** a food with a known `id` and `status = 'RESOLVED'`
- **When** an authenticated client sends `GET /v1/foods/{id}/status`
- **Then** the response is `200 OK` with `{"id": "<ulid>", "status": "RESOLVED"}` plus the full golden-record
  payload

**ATS-007-A2**

- **Given** foods with `status` `PENDING`, then `UNRESOLVED`, then `NOT_FOUND`, then `FAILED`
- **When** an authenticated client sends `GET /v1/foods/{id}/status` for each
- **Then** each response returns the correct `status` string (`PENDING` and `UNRESOLVED` carry
  `estimatedWaitSeconds` where applicable; `NOT_FOUND`/`FAILED` carry the terminal status with no nutrition
  payload), so a client holding any `id` can always see _why_ a read is not `200`

---

### Tier 1 — Feature/Epic: Add Food By Name (US-2)

**User Goal**: As a Commise client, I want to add a food we don't have yet **by name** and get back an `id`
immediately, so the system can resolve it from external sources asynchronously without my request blocking.
Maps to spec US-2 acceptance scenarios.

---

#### Tier 2 — REQ-005 / REQ-047 / REQ-IF-009: `POST /v1/foods` creates the canonical row + `id` and returns `202` (US-2 AS-1)

**AT-005-A** — Add-by-name creates the canonical row + `id` and returns `202` within the latency budget

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-005-A1**

- **Given** no food exists for the name "broccoli"
- **When** an authenticated client sends `POST /v1/foods` with `{"name": "broccoli"}`
- **Then** the response is `202 Accepted` with `{"status": "PENDING", "id": "<ulid>", "estimatedWaitSeconds": 30}`
  within 100ms; a canonical row keyed on the new `id` is created and a `fetch_queue` row keyed on that `id`
  is enqueued

**ATS-005-A2** _(input validation — REQ-006)_

- **Given** the API is running
- **When** an authenticated client sends `POST /v1/foods` with an empty or whitespace-only `name`
- **Then** the response is `400 Bad Request`; no canonical row is created and nothing is enqueued

---

#### Tier 2 — REQ-005 / REQ-013 / REQ-047: Normalized-name dedup — concurrent adds collapse to one `id` (US-2 AS-4)

**AT-005-B** — Concurrent adds for the same normalized name collapse to a single canonical row + `id`

**Technique**: Fault Injection / Concurrency

##### Tier 3 — BDD Scenarios

**ATS-005-B1**

- **Given** an add for "Broccoli" is in flight (canonical row created and queued, not yet resolved)
- **When** five authenticated clients concurrently send `POST /v1/foods` with names that normalize equally
  (`"broccoli"`, `" Broccoli "`, `"BROCCOLI"`, ...)
- **Then** every caller receives `202 Accepted` with the **same** `id`; exactly **one** canonical row and
  exactly **one** `fetch_queue` row exist (normalized-name dedup key + short lock, plus `ON CONFLICT` on the
  queue) — no duplicate row or duplicate fetch is created

---

#### Tier 2 — REQ-005 / REQ-025 / REQ-028a: Legal lifecycle transitions — terminal-row reactivation, no `23505` (US-2)

**AT-028a-A** — Re-adding a terminal-state food past its TTL reactivates it to `PENDING` rather than colliding on the normalized-name unique key

**Technique**: State Transition / Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-028a-A1** (AT-LC-B — `NOT_FOUND` → `PENDING` after TTL)

- **Given** a food in `status = 'NOT_FOUND'` whose tombstone age exceeds the 30-day TTL
- **When** an authenticated client re-adds that normalized name
- **Then** the existing row is **reactivated in place** to `status = 'PENDING'` and re-enqueued — **no** new row
  and **no** `23505` unique-name violation; the lifecycle follows `NOT_FOUND → PENDING` (FR-028a)

**ATS-028a-A2** (AT-LC-A / AT-LC-E — `FAILED` → `PENDING` retry on re-add)

- **Given** a food in `status = 'FAILED'` (its source fan-out exhausted the retry budget)
- **When** an authenticated client re-adds that normalized name
- **Then** the existing row is **reactivated in place** to `status = 'PENDING'` and re-enqueued — `FAILED → PENDING`,
  no duplicate row, no `23505` (FR-028a)

---

#### Tier 2 — REQ-050 / REQ-050a / REQ-024 / REQ-IF-005: Background fan-out auto-resolves a single-survivor add to `RESOLVED` (US-2 AS-2, AS-3)

**AT-050-A** (AT-MRG5-A) — The worker fans out by name, and when exactly one candidate survives normalized-name exact match it assembles a golden record and the food becomes readable as `200`

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-050-A1**

- **Given** a `202 Accepted` + `id` was returned for an add-by-name, and after pre-merge dedup **exactly one**
  candidate survives normalized-name exact match (one source hit, or duplicates of the same logical item)
- **When** the Fargate consumer worker drains the `fetch_queue` row keyed on that `id`
- **Then** it fans out across all wired source adapters by name, fetches from each source that has the item,
  assembles the golden record, stores it in PostgreSQL, sets `status = 'RESOLVED'`, records the
  `food_sources` crosswalk row, removes the row from the pending set, and emits a `FoodFetchCompleted` event
  carrying the `id`

**ATS-050-A2**

- **Given** the worker assembled a confident golden record for the `id`
- **When** the API subsequently receives `GET /v1/foods/{id}`
- **Then** it returns `200 OK` with the complete golden-record food data (US-2 AS-3)

---

#### Tier 2 — REQ-025 / REQ-050a / REQ-016: Fan-out with 0 surviving candidates → `NOT_FOUND` tombstone (US-2 AS-5, US-5 AS-6)

**AT-025-A** (AT-MRG5-C) — Confirmed-absent food (0 survivors) is tombstoned `NOT_FOUND`, then re-attemptable after the TTL

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-025-A1**

- **Given** an add-by-name whose fan-out finds the item in **no** wired source
- **When** the worker finishes
- **Then** it sets the food `status = 'NOT_FOUND'` and the `fetch_queue` row `status = 'tombstone'` (a durable
  audit row, not a delete); no immediate retry occurs; a subsequent `GET /v1/foods/{id}` within the TTL
  returns `404` without re-enqueueing

**ATS-025-A2**

- **Given** a `NOT_FOUND` food whose tombstone age now exceeds the configured TTL (default 30 days)
- **When** an authenticated client re-adds that food by name after the TTL has lapsed
- **Then** a re-attempt fan-out is enqueued (a source may have since added the food); the re-attempt counts
  against the normal per-source rolling-window budgets so it cannot bypass any rate limit (REQ-019)

---

#### Tier 2 — REQ-050 / REQ-050a / REQ-048: Fan-out with >1 surviving candidate → `UNRESOLVED` (US-2 AS-6)

**AT-050-B** (AT-MRG5-B) — Ambiguous fan-out sets `UNRESOLVED` and persists the surviving candidate set

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-050-B1**

- **Given** an add-by-name whose fan-out returns **more than one** candidate surviving normalized-name exact
  match (no nutrient tolerance; bias toward `UNRESOLVED`)
- **When** the worker finishes (having merged as far as it is confident, REQ-048)
- **Then** it sets the food `status = 'UNRESOLVED'` and persists the surviving candidates into the
  `food_candidates` table (`UNIQUE(food_id, source, external_key)`) for the user to pick (handed off to US-2a);
  the food is **not** auto-blended across the ambiguous candidates

---

### Tier 1 — Feature/Epic: Disambiguate Candidates and Resolve (US-2a)

**User Goal**: As a Commise client, when an add-by-name is `UNRESOLVED`, I want to fetch the candidate list,
pick the one(s) that match what I meant, and have the system assemble the golden record — with the system
rejecting any pick that doesn't belong to my food. Maps to spec US-2a acceptance scenarios.

---

#### Tier 2 — REQ-048 / REQ-IF-010: `GET /v1/foods/{id}/candidates` returns the per-source candidate list (US-2a AS-1)

**AT-048-A** — Candidate list is returned for an `UNRESOLVED` food, each candidate carrying its source + item key

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-048-A1**

- **Given** a food with `status = 'UNRESOLVED'` whose surviving candidates are persisted in the
  `food_candidates` table (`UNIQUE(food_id, source, external_key)`)
- **When** an authenticated client sends `GET /v1/foods/{id}/candidates`
- **Then** the response is `200 OK` with the candidate list read from `food_candidates`; each candidate carries
  its `source` and that source's item key (`externalKey`) — and **no** raw source payload and no `fdcId` field
  is exposed (REQ-046)

---

#### Tier 2 — REQ-049 / REQ-IF-011: `PATCH /v1/foods/{id}` resolves from a valid candidate selection (US-2a AS-2)

**AT-049-A** — A valid candidate pick merges into the golden record and moves the food to `RESOLVED`

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-049-A1**

- **Given** an `UNRESOLVED` food and a candidate drawn from **its own** candidate set (whose `food_candidates`
  row carries only `source`/`external_key`/`name`/`summary` — no nutrient/portion payload)
- **When** an authenticated client sends `PATCH /v1/foods/{id}` with `{"candidateIds": ["<candidate>"]}`
- **Then** the system validates the candidate belongs to this food's `food_candidates` set, **re-fetches the
  picked candidate's full payload from its source by `external_key`** (a budgeted per-source call recorded
  against the rolling-window ledger), merges the re-fetched `CanonicalCandidate` into the golden record per the
  REQ-051 merge rules, moves the food to `status = 'RESOLVED'`, stores the user's pick as ordinary provenance,
  and **clears** the `food_candidates` rows; a subsequent `GET /v1/foods/{id}` returns `200 OK` with the merged
  nutrients/portions present

**ATS-049-A3** (re-fetch is required and budgeted — golden record carries source-fetched nutrients)

- **Given** an `UNRESOLVED` food whose `food_candidates` rows hold no nutrient/portion data
- **When** an authenticated client resolves it with a valid in-set candidate pick
- **Then** the source adapter's `fetchByKey` is invoked for the picked candidate and the call is counted against
  the per-source rolling-window budget (the resolve is never `429`'d / shed, but it does consume budget); if the
  re-fetch fails the resolve aborts with `SourceApiError` and the food remains `UNRESOLVED` (status unchanged,
  the user may retry the pick)

**ATS-049-A2** (AT-LC-C — idempotent no-op on an already-RESOLVED food)

- **Given** the food is already `status = 'RESOLVED'` (its `food_candidates` set already cleared)
- **When** an authenticated client re-sends `PATCH /v1/foods/{id}` with a candidate selection
- **Then** the response is `200 OK` returning the current `RESOLVED` state as an **idempotent no-op** — no
  re-merge, no provenance rewrite, and the prior (possibly manual) pick is preserved (resolve is
  UNRESOLVED-only + idempotent, FR-028a)

---

#### Tier 2 — REQ-049 / REQ-IF-011: Out-of-set candidate pick is rejected; `status` unchanged (US-2a AS-3)

**AT-049-B** — A `PATCH` referencing a candidate not in the food's own candidate set is rejected

**Technique**: Equivalence Partitioning / Negative Testing

##### Tier 3 — BDD Scenarios

**ATS-049-B1**

- **Given** an `UNRESOLVED` food `A` and a candidate id that belongs to a **different** food `B` (or to no
  food)
- **When** an authenticated client sends `PATCH /v1/foods/{A}` selecting that candidate
- **Then** the request is rejected with `400`/`409`; food `A`'s `status` is unchanged (still `UNRESOLVED`);
  no cross-food contamination occurs and no golden record is mutated

---

#### Tier 2 — REQ-025a: `UNRESOLVED` candidate-set 30-day TTL — food kept, re-fan-out after expiry (US-2a)

**AT-025a-A** — An `UNRESOLVED` food is kept until a human picks; its candidate set expires after 30 days and the next add-by-name re-fans-out

**Technique**: Fault Injection / Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-025a-A1** (candidate set past TTL → re-fan-out, food kept)

- **Given** an `UNRESOLVED` food whose `food_candidates` set is older than the 30-day TTL (`created_at` past
  expiry)
- **When** an authenticated client re-adds that food by name
- **Then** the food **stays `UNRESOLVED`** (it is **not** swept to `NOT_FOUND`) and exactly one re-fan-out is
  enqueued against the normal per-source rolling-window budget, refreshing the candidate set (mirrors the
  NOT_FOUND 30-day TTL pattern)

**ATS-025a-A2** (human pick before expiry wins)

- **Given** the same `UNRESOLVED` food **within** the candidate-set TTL
- **When** the client `PATCH`-resolves an in-set candidate before expiry
- **Then** the food moves to `RESOLVED` and **no** re-fan-out occurs — a human pick before expiry wins (REQ-025a)

---

### Tier 1 — Feature/Epic: Golden-Record Merge Correctness (US-2, US-2a)

**User Goal**: As a Commise operator, I want cross-source assembly to produce a single coherent golden
record — presence beats absence, identity/short fields take the higher-priority source (not the longest),
free-text takes the longer value, nutrients are normalized to per-100g before any blend, and no
nutritionally-incoherent blend is ever stored. Maps to spec US-2 AS-2 and US-2a AS-4, REQ-051/REQ-052.

---

#### Tier 2 — REQ-051: Identity/short fields take the higher-priority source; free-text takes the longer value

**AT-051-A** — Field-level merge precedence is deterministic and source-priority-driven

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-051-A1** (presence beats absence)

- **Given** two sources back one food, where source `S1` supplies `fat` and source `S2` omits it
- **When** the merge assembles the golden record
- **Then** the food's `fat` is present (sourced from `S1`); a missing value from one source never blanks a
  value another source provides

**ATS-051-A2** (identity/short fields → higher-priority source, NOT longest)

- **Given** the higher-priority source supplies a **shorter** `name` (e.g. "Egg") and a lower-priority
  source supplies a **longer** `name` (e.g. "Egg, whole, raw, fresh, brand X")
- **When** the merge runs for an identity/short field (`name`, `brand`)
- **Then** the **higher-priority** source's value wins (USDA is the default highest priority until an
  explicit ranking is configured) — the longer value does **not** win for identity/short fields

**ATS-051-A3** (free-text → longer value wins)

- **Given** two sources supply different-length `description`/`ingredients` free-text
- **When** the merge runs for a free-text field
- **Then** the **longer** value wins (the free-text rule is the documented exception to the source-priority
  rule)

---

#### Tier 2 — REQ-051 / REQ-NF-018: Per-100g normalization before any blend; higher-priority source wins nutrient conflicts; no incoherent blend

**AT-051-B** — Nutrients are normalized to a common per-100g basis before blending and conflicts resolve by source priority

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-051-B1** (per-100g normalization precedes any cross-source blend)

- **Given** source `S1` reports a nutrient per-serving (e.g. per 28g) and source `S2` reports the same
  nutrient per-100g
- **When** the merge assembles `food_nutrients`
- **Then** both values are normalized to the **per-100g basis** (recorded via `basis`) **before** any
  comparison or blend; the stored value is a coherent per-100g figure, never a raw mix of incompatible bases

**ATS-051-B2** (conflict → higher-priority source wins, recorded on `food_nutrients.source_id`)

- **Given** two sources supply **different** per-100g values for the **same** nutrient
- **When** the merge resolves the conflict
- **Then** the **higher-priority** source's value is kept and `food_nutrients.source_id` records which
  source won; the two values are **not** averaged/blended into a synthetic figure

**ATS-051-B3** (no nutritionally-incoherent blend across fields)

- **Given** a food assembled from multiple sources
- **When** the golden record is read via `GET /v1/foods/{id}`
- **Then** each nutrient value is wholly attributable to a single source (via its `source_id`) on a
  consistent per-100g basis — the record never contains a field-by-field blend that produces a
  nutritionally-incoherent macro/calorie profile

---

#### Tier 2 — REQ-052 / REQ-029: Per-field provenance is single-query answerable; user picks stored as ordinary provenance (US-2a AS-4)

**AT-052-A** — Every stored scalar field, nutrient, and portion carries resolvable provenance

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-052-A1**

- **Given** a `RESOLVED` food whose `name` came from the higher-priority source by priority and whose `fat`
  came from another source, including a user's manual `PATCH` pick (US-2a)
- **When** "which fields came from source X for this food" is queried
- **Then** it is answerable by a **single** query across `food_field_provenance` (scalar fields) and the
  `source_id` columns on `food_nutrients`/`food_portions`; the user's manual pick is stored as **ordinary
  provenance**, indistinguishable in mechanism from a source-supplied value (REQ-052, SC-013)

---

### Tier 1 — Feature/Epic: Bulk Ingredient Resolution for Recipe Import (US-4)

**User Goal**: As a Commise client importing a recipe, I want known ingredients resolved immediately and
unknown ingredient names enqueued for background add-by-name resolution, in one partial response. Maps to
spec US-4 and REQ-012 / REQ-040a.

---

#### Tier 2 — REQ-012 / REQ-040a / REQ-IF-009: Batch add returns a per-item partial result (US-4 AS-1, AS-2)

**AT-012-A** — `POST /v1/foods/batch` mixing known and unknown names returns resolved foods inline + `PENDING` per miss

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-012-A1**

- **Given** an authenticated client submits `POST /v1/foods/batch` with 15 ingredient names where 10 resolve
  locally and 5 are unknown (size within the REQ-040a limit of 100)
- **When** the request is processed
- **Then** the response is a single body returning the 10 resolved foods inline (each with its `id` and full
  golden-record data) and each of the 5 misses as a `{"status": "PENDING", "id": "<ulid>"}` entry whose row
  was created and fetch enqueued — the caller gets available data immediately and polls only the pending
  `id`s (no all-or-nothing withholding); enqueued misses are subject to the REQ-039 demotion fairness, not a
  per-user quota

**ATS-012-A2** (per-`id` rows, deduped — US-4 AS-2, AS-4)

- **Given** the 5 unknown names are processed, where 3 are already in flight
- **When** the system enqueues
- **Then** it creates one canonical row + `id` per **truly new** name (2 rows) and collapses the 3 in-flight
  names to their existing `id`s (normalized-name dedup); each enqueue is one `fetch_queue` row keyed on the
  `id` (deduped via `ON CONFLICT`), never one undifferentiated blob

---

### Tier 1 — Feature/Epic: Demand-Weighted Queue Priority and Failure Recovery (US-5)

**User Goal**: As a Commise operator, I want a viral, much-requested missing food to naturally rise above a
one-off add, no request silently dropped, and source errors recovered with bounded retries before a durable
tombstone. Maps to spec US-5 and REQ-014/REQ-015/REQ-016/REQ-027.

---

#### Tier 2 — REQ-014 / REQ-015 / REQ-044a: Demand-weighted ordering by distinct-requester count, with FIFO tie-break (US-5 AS-1, AS-2, AS-3)

**AT-015-A** — Higher distinct-requester demand drains first; ties break FIFO; a single `sub` counts once

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-015-A1**

- **Given** `id=A` has demand from many distinct `sub`s (`request_count` reflecting the capped
  distinct-requester count) and `id=B` has `request_count = 1`
- **When** the consumer selects the next item
- **Then** it processes `A` before `B`, per `ORDER BY request_count DESC, first_requested ASC` with the
  REQ-039 demotion overlay applied at drain time

**ATS-015-A2**

- **Given** two rows tie at `request_count = 1`
- **When** the consumer selects
- **Then** the row with the earlier `first_requested` timestamp processes first (FIFO tie-break)

**ATS-015-A3** (distinct-requester counting — REQ-044a)

- **Given** a single `sub` sends repeated adds resolving to the same `id`
- **When** the rows are enqueued via `ON CONFLICT`
- **Then** that `sub` contributes **at most once** to `request_count` (`PRIORITY_CAP = 1`); raw repeat
  volume does not inflate priority, and aging via `first_requested` prevents any `id` being pinned to the
  front indefinitely

---

#### Tier 2 — REQ-027 / REQ-016: Source `5xx` cycles with backoff, then `FAILED` tombstone (US-5 AS-5)

**AT-027-A** — Transient source errors retry with backoff and land the food in `FAILED` after the budget

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-027-A1**

- **Given** an add whose fan-out hits a source returning `503 Service Unavailable` on every attempt
- **When** the consumer processes the row
- **Then** it sets `status = 'pending'`, increments `attempts`, and applies exponential backoff to
  `last_requested`; after 5 cumulative attempts the food is set to `FAILED` and the row to
  `status = 'tombstone'` with `last_error` populated. A `FAILED` food is itself re-fetchable

---

#### Tier 2 — REQ-016 / REQ-NF-016: Tombstone rows are the durable audit record; no silent drops (US-5 AS-6, AS-7)

**AT-016-A** — Persistently failing foods are captured as tombstone rows, fully auditable via SQL

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-016-A1**

- **Given** 10 add-by-name rows are injected and the consumer is configured so every fan-out errors on every
  attempt
- **When** each row exhausts its 5 retry attempts (with backoff)
- **Then** all 10 foods are set to `FAILED` and their `fetch_queue` rows to `status = 'tombstone'`; none are
  silently dropped; `SELECT * FROM fetch_queue WHERE status='tombstone'` returns each row with full
  `attempts`, `last_error`, and `last_requested`; the CloudWatch tombstone-row alarm fires

---

#### Tier 2 — REQ-040b: Queue backpressure / circuit breaker → `503` (US-5 backpressure, REQ-040b)

**AT-040-B** — Enqueue fails closed with `503` at the queue-depth ceiling or open circuit breaker

**Technique**: Boundary Value Analysis / Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-040-B1**

- **Given** the `fetch_queue` pending depth is at the configured ceiling (`MAX_QUEUE_DEPTH = 10000`), or a
  source's circuit breaker is open
- **When** an authenticated client submits an add that would enqueue a new fetch
- **Then** the enqueue fails closed with `503 Service Unavailable` (evaluated at admission, before the
  drain-time demotion fairness); the queue does not grow unbounded; circuit-breaker recovery drains with
  jitter (no thundering herd)

---

### Tier 1 — Feature/Epic: Food Search by Name (US-6)

**User Goal**: As a Commise client, I want to search foods by name (fuzzy-tolerant) and look up by barcode /
a source's `external_key`, getting back canonical `id`s — without triggering any external source call. Maps
to spec US-6 and REQ-008/REQ-009/REQ-010/REQ-IF-003.

---

#### Tier 2 — REQ-008 / REQ-IF-003: Search returns relevance-ranked `id`s; fuzzy matching; empty set for no match (US-6 AS-1, AS-2, AS-3)

**AT-008-A** — Search returns canonical `id`s ranked by relevance, with `pg_trgm` fuzzy tolerance

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-008-A1**

- **Given** the local store contains foods including "Chicken Breast, raw" and "Chicken Thigh, raw"
- **When** an authenticated client sends `GET /v1/foods/search?query=chicken breast`
- **Then** the response is `200 OK` with a relevance-ranked array of canonical **`id`s** (not source ids);
  the matching chicken records appear, ordered by match relevance

**ATS-008-A2** (fuzzy match)

- **Given** a food "Avocado, raw" exists locally
- **When** an authenticated client sends `GET /v1/foods/search?query=avacado`
- **Then** the response is `200 OK` and the avocado's `id` is returned (`pg_trgm` fuzzy matching tolerates
  the typo)

**ATS-008-A3** (no match → empty set, no source call)

- **Given** no local food matches "xyzzy"
- **When** an authenticated client sends `GET /v1/foods/search?query=xyzzy`
- **Then** the response is `200 OK` with an empty array; **no** external source is queried (to bring in a
  missing food the client adds it by name via `POST /v1/foods`, US-2)

---

#### Tier 2 — REQ-008 / REQ-IF-003: Barcode / `external_key` lookup resolves to a canonical `id` (US-6 AS-5)

**AT-008-B** — Lookup by barcode / a source's `external_key` resolves to the food's canonical `id`

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-008-B1**

- **Given** a food backed by a known barcode / a source's `external_key` recorded in the `food_sources`
  crosswalk
- **When** an authenticated client looks it up by that key
- **Then** the system resolves it to the food's canonical `id` via the `food_sources` crosswalk and returns
  `200 OK`; the response is keyed on the internal `id`, not the source key

---

#### Tier 2 — REQ-009: Search never calls an external source (US-6 AS-3)

**AT-009-A** — Search operates exclusively on the local store

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-009-A1**

- **Given** the local store contains foods matching "apple"
- **When** an authenticated client sends `GET /v1/foods/search?query=apple`
- **Then** the response is `200 OK` with local `id`s; **zero** external source calls are observed during the
  request lifecycle

---

#### Tier 2 — REQ-010 / REQ-IF-003: Search latency under load (US-6 AS-4)

**AT-010-A** — Search returns within 200ms at scale

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-010-A1**

- **Given** the local store contains 50,000 food records with the GIN trigram/full-text index on
  `food.name`/`food.description`
- **When** an authenticated client sends `GET /v1/foods/search?query=chicken`
- **Then** the response is `200 OK` and p95 server-side processing time is under 200ms across 100 sequential
  requests

---

### Tier 1 — Feature/Epic: Rate-Limited Per-Source Consumption (US-3)

**User Goal**: As a Commise operator, I want each external source's rate limit enforced by a per-source
rolling 60-minute window so we never breach a source's cap (USDA: 1,000 req/hr) and never get the key
banned. Maps to spec US-3 and REQ-019/REQ-020/REQ-021/REQ-026.

---

#### Tier 2 — REQ-019 / REQ-NF-012: Per-source rolling-window cap; worker pauses at 90% (US-3 AS-1, AS-2, AS-3)

**AT-019-A** — At most the source's cap in any trailing 60 minutes; the worker pauses that source at 90%

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-019-A1**

- **Given** USDA's trailing-60-min call count starts at 0 and the worker is draining USDA-backed fan-outs in
  rapid succession
- **When** the consumer processes rows needing USDA
- **Then** at most **1,000** USDA calls occur within any trailing 60-minute window; the consumer pauses
  draining USDA-backed work once USDA's trailing count reaches **900 (90%)** and resumes only as earlier
  calls age out of the window (deferred rows keep their lease released for later retry); no `429` is received
  from USDA

---

#### Tier 2 — REQ-021: Window at cap → defer the row, make no source call (US-3 AS-3)

**AT-021-A** — A would-be over-cap call is not made; the row is re-deferred

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-021-A1**

- **Given** USDA's trailing-60-min count is at the 1,000/hr cap (the next call would be the 1,001st)
- **When** the consumer considers a row needing USDA
- **Then** no USDA call is made; the `fetch_queue` row lease is released so it reverts to `pending`; the row
  stays eligible for retry once earlier calls age out and the count drops below the threshold

---

#### Tier 2 — REQ-026: Source `429` triggers immediate back-off (US-3 AS-4)

**AT-026-A** — A source's `429` is treated as window-full; the consumer backs off

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-026-A1**

- **Given** the consumer is draining USDA-backed rows and USDA returns `429 Too Many Requests` despite the
  limiter
- **When** the consumer receives the `429`
- **Then** it treats USDA's rolling window as full and backs off (pauses draining USDA-backed work); the
  current `fetch_queue` row is left `pending` (lease released for retry after the backoff gate); no further
  USDA-needing rows are processed for now; no additional USDA calls are made

---

#### Tier 2 — REQ-020: Per-source check-and-record is atomic (US-3 AS-5)

**AT-020-A** — The count-and-record limiter operation is race-free under concurrency

**Technique**: Fault Injection / Concurrency

##### Tier 3 — BDD Scenarios

**ATS-020-A1**

- **Given** the per-source rolling-window state is the Postgres `source_call_log` (lean launch) or a Redis
  sorted set (deferred)
- **When** the worker performs a check-and-record (count that source's trailing-60-min calls and record the
  new call) under concurrent access
- **Then** the operation is **atomic** — no race lets the trailing count exceed the source's cap; per-source
  keying isolates each source's window

---

### Tier 1 — Feature/Epic: Change-Driven Data Refresh (US-7)

**User Goal**: As a Commise operator, I want refresh to update a field **only** when its originating source
item changed upstream — never blindly re-blending and never overwriting a human's manual pick. Refresh runs as
a **low-priority Fargate scheduled task** (idle-drain, yields to live demand; ADR-0004 keeps it off the NAT
path — not a VPC Lambda), re-enqueuing affected foods via the ordinary `enqueue(food_id, 'svc_change_refresh')`
path on a budget-bounded cadence. Maps to spec US-7 and REQ-031/REQ-032/REQ-053.

---

#### Tier 2 — REQ-031 / REQ-053: Refresh updates only fields whose source item changed upstream (US-7 AS-1, AS-2)

**AT-031-A** — A changed source item re-pulls only its fields; unchanged items leave the record intact

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-031-A1**

- **Given** a `RESOLVED` food whose `protein` came from source item `X` and `fat` from source item `Y`,
  where `X` is unchanged upstream but `Y` changed (detected via `food_sources.item_version` /etag/hash)
- **When** the scheduled change-driven refresh runs
- **Then** only the field(s) pulled from `Y` (`fat`) are re-pulled and updated (with refreshed `source_id`
  provenance); `protein` and every other field are left intact — the refresh does **not** blindly re-blend

**ATS-031-A2** (no change → no write)

- **Given** a `RESOLVED` food whose backing source items are **all** unchanged upstream
- **When** the scheduled refresh runs
- **Then** no field is updated and no value is overwritten

---

#### Tier 2 — REQ-031 / REQ-053 / REQ-052: Refresh preserves the user's manual resolution (US-7 AS-3, AS-4)

**AT-031-B** — A user-resolved field is preserved unless its originating source item changes; re-pulls pass validation

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-031-B1** (AT-LC-D — refresh does not clobber a manual pick)

- **Given** a field the user manually resolved via US-2a (stored as ordinary provenance), whose originating
  external item is unchanged upstream
- **When** the refresh runs
- **Then** the user's value is preserved — it is just a stored value, and only its originating external item
  changing can move it (the manual-pick preservation invariant of FR-028a; verified at the unit/integration
  tiers by UTP-006-E and ITP-014-D)

**ATS-031-B2**

- **Given** a backing source item changed upstream and the refresh re-pulls the affected field
- **When** the re-pulled value is processed
- **Then** it passes the adapter's input validation (REQ-055) **before** it is stored, and its `source_id`
  provenance is updated to the re-fetched item; a value failing validation is rejected, not stored

---

### Tier 1 — Feature/Epic (US-0): Authenticated & Authorized Access to the Food Data API

**User Goal**: As a Commise client (or a backend Commise service), I want every food data entry point to
authenticate my Clerk token networklessly and authorize my request before any business logic runs, so that
no unauthenticated or unfair caller can read food data or drive external source consumption. Maps to spec
US-0 acceptance scenarios AS-1..AS-12.

**Acceptance Test Plan**: `ATP-008` — verifies the end-to-end auth contract from the client's perspective:
`401` on missing/expired/wrong-instance tokens, `200`/`202`/`404` on valid tokens (keyed on the internal
`id`), no broadcast leakage on WebSocket push, per-`sub` fairness by demotion (accepted `202`, demoted to
back — no `429`), `403` scope, M2M service-token acceptance, and oversized-batch `400`. (Internal verifier
mechanics — networkless verify, load-shed — are covered by the System Test Plan STP-013.)

---

#### Tier 2 — REQ-035 / REQ-037a–d: No token → `401` at every entry point; no row, no enqueue, no source call (US-0 AS-1)

**ATP-008-A** — Unauthenticated requests are rejected before any business logic, row creation, enqueue, or source call

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-036-A1**

- **Given** no `Authorization` header is present
- **When** a client calls each food data entry point in turn — `POST /v1/foods`, `GET /v1/foods/{id}`,
  `GET /v1/foods/{id}/status`, `GET /v1/foods/{id}/candidates`, `PATCH /v1/foods/{id}`,
  `GET /v1/foods/search?query=chicken`, and `POST /v1/foods/batch`
- **Then** every endpoint returns `401 Unauthorized`; **no** canonical row is created, no fetch is enqueued,
  and no external source call is made for any of them (matching STS-013-A1's endpoint sweep, so SC-010's
  "each endpoint" is discharged literally)

---

#### Tier 2 — REQ-037a–d / REQ-IF-008: Valid Clerk session token → normal `200`/`202`/`404` handling (US-0 AS-2, AS-5)

**ATP-008-B** — A valid Bearer token authenticates the caller and normal handling applies, networklessly

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-037-B1** (AS-2 — client-observable valid-token handling)

- **Given** a valid Clerk session token is presented as a Bearer credential and a food with a known `id`
  exists locally as `RESOLVED`
- **When** the client sends `GET /v1/foods/{id}`
- **Then** the response is `200 OK`; the caller identity carried into response correlation (the
  request-scoped `sub`, or the per-`sub` demand bucket charged) is the verified Clerk `sub`

**ATS-037-B2** (AS-5 — networkless verification, measured at the network boundary)

- **Given** the API is deployed in a network-isolation harness whose egress policy **denies all outbound
  traffic to every Clerk/IdP host** (the Clerk frontend/instance domains and any IdP JWKS endpoint are
  blackholed), and a valid Clerk session token is presented for a `RESOLVED` food `id`
- **When** the client sends `GET /v1/foods/{id}` and the harness records all outbound connection attempts
  crossing the service network boundary for the request
- **Then** the response is still `200 OK` (the egress deny does **not** change the outcome, proving no
  request-path IdP dependency); **and** the harness observes **zero** outbound connection attempts to any
  Clerk/IdP host during verification — making the networkless guarantee measurable at the boundary, not
  merely asserted. _(Internal verifier mechanics — `@clerk/backend` `verifyToken` against the non-secret
  `CLERK_JWT_KEY` — are exercised at system level by STP-013-A / STS-013-A3.)_

---

#### Tier 2 — REQ-037a–d: Expired or malformed token → `401` (US-0 AS-3)

**ATP-008-C** — Expired and malformed tokens are rejected fail-closed

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-038-C1**

- **Given** a token whose `exp` is in the past (and, separately, a malformed/garbage Bearer string)
- **When** the client calls `GET /v1/foods/{id}`
- **Then** each request returns `401 Unauthorized`; no canonical row is created, no fetch is enqueued, and no
  source call is made

---

#### Tier 2 — REQ-037a–d: Wrong-`azp` or wrong-instance token, or forged identity header → `401` (US-0 AS-4, AS-6)

**ATP-008-D** — Tokens failing the `azp` allowlist or instance signature, or supplying a forged identity header, are rejected

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-039-D1**

- **Given** a well-formed Clerk token whose `azp` is not in `CLERK_AUTHORIZED_PARTIES` (and, separately, a
  token signed for a different Clerk instance, and a request with no valid token but a forged
  `x-authorizer-context`/`x-user-id` header)
- **When** the client calls `GET /v1/foods/{id}`
- **Then** each request returns `401 Unauthorized`; identity is taken **only** from the verified token, never
  from a client-supplied header; no row is created, no fetch enqueued, no source call made

---

#### Tier 2 — REQ-043: WebSocket `$connect` requires a token; pushes are not broadcast (US-0 AS-7, AS-8)

**ATP-008-E** — WebSocket auth at `$connect` and per-recipient push targeting

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-040-E1**

- **Given** a WebSocket `$connect` is attempted without a valid Clerk token
- **When** the connection is initiated
- **Then** it is rejected with the pinned `403` before the connection is established

**ATS-040-E2**

- **Given** two authenticated WebSocket connections, where only `sub` `A` requested food `id` (recorded in
  the `fetch_requesters` subscription set) and `sub` `B` did not
- **When** a `FoodFetchCompleted` notification for that `id` is pushed
- **Then** the notification is delivered only to `A`'s connection; `B`'s connection receives nothing (no
  broadcast to connections that did not request that food `id`)

---

#### Tier 2 — REQ-039 / REQ-040b: Per-`sub` fairness by demotion + near-ceiling flood-shed — no `429` (US-0 AS-9)

**ATP-008-F** — One user cannot starve the shared per-source budget for others (multi-requester demotion + near-ceiling `503` flood-shed, not `429`)

**Technique**: Boundary Value Analysis

##### Tier 3 — BDD Scenarios

**ATS-041-F1**

- **Given** an authenticated user all of whose pending foods have more than 50 items already pending in the `fetch_queue`
- **When** they trigger another add-by-name for an unknown food
- **Then** the request is still **accepted** (`202 Accepted`, **no `429`** and no rejection); the fetch is
  enqueued but the requester's queued items are ranked to the **back** of the priority order; concurrently a
  different authenticated user's add continues to be served from spare capacity (demotion protects users from
  each other); when the heavy user's pending count later drops below 50, their items are dynamically
  re-promoted to normal priority (priority is computed at drain time from live state)

**ATS-041-F2** (AT-043a-A — multi-requester food with one under-threshold requester is not demoted)

- **Given** a food requested by two distinct `sub`s — a heavy `sub` (pending > 50) and a light `sub` (pending < 50)
- **When** the drain-time scorer evaluates that food
- **Then** the food is **not** demoted — a food is demoted only when **every** one of its requesters exceeds the
  50-pending threshold; one under-threshold requester keeps it at normal priority (FR-043a)

**ATS-041-F3** (AT-044b-A — near-ceiling flood-shed with `503`, never `429`)

- **Given** the global rolling-window budget is near its ceiling and one `sub` is flooding **NEW** add-by-name enqueues
- **When** that `sub` submits further NEW enqueues near the ceiling
- **Then** its NEW enqueues are shed first with `503` (Retry-After) to preserve headroom for other users, while
  reads and `PATCH`-resolves from any user are **never** shed and **never** `429` (FR-043b)

---

#### Tier 2 — REQ-038b / REQ-038c: Insufficient operational scope → `403`, distinct from `401` (US-0 AS-10)

**ATP-008-G** — Authenticated-but-unauthorized is `403`, not `401`

**Technique**: Equivalence Partitioning

##### Tier 3 — BDD Scenarios

**ATS-042-G1**

- **Given** an authenticated user whose verified token `public_metadata` lacks the required operational scope
- **When** they call an admin/operational endpoint (e.g. a manual re-fetch or refresh trigger)
- **Then** the response is `403 Forbidden` (authenticated but unauthorized), distinct from the `401`
  unauthenticated case, per the response precedence `401 → 403 → 400 → business logic` (REQ-038c)

---

#### Tier 2 — REQ-041: Backend service M2M token is accepted (US-0 AS-11)

**ATP-008-H** — Server-to-server callers authenticate with a Clerk M2M token, not forced to `401`

**Technique**: Interface Contract Testing

##### Tier 3 — BDD Scenarios

**ATS-043-H1**

- **Given** a backend Commise service (e.g. 006 meal-planning) with no end-user session token, presenting a
  Clerk machine (M2M) token whose `azp` is in the authorized-parties allowlist
- **When** it calls `GET /v1/foods/{id}`
- **Then** the request is accepted (the M2M token is verified networklessly); the server-to-server call is
  not forced to `401`

---

#### Tier 2 — REQ-040a: Oversized batch → `400`, enqueues nothing (US-0 AS-12)

**ATP-008-I** — Batch hard-limit is enforced before any row creation or enqueue

**Technique**: Boundary Value Analysis

##### Tier 3 — BDD Scenarios

**ATS-044-I1**

- **Given** an authenticated client submits `POST /v1/foods/batch` with a name/`id` count exceeding the
  maximum allowed (e.g. > 100)
- **When** the request is processed
- **Then** the response is `400 Bad Request`; **no** canonical row is created and **nothing** is enqueued for
  any item in the batch

---

### Tier 1 — Feature/Epic: Source-Agnostic Identity & `fdcId` Confinement

**User Goal**: As a Commise operator, I want the canonical model and public API keyed on the internal `id`
with no source-native identifier leaking past the USDA adapter boundary. Maps to REQ-045/REQ-046/REQ-054 and
SC-013.

---

#### Tier 2 — REQ-046 / REQ-054 / REQ-IF-012: No `fdcId` or source-native id in the public surface (SC-013)

**AT-046-A** — The public API surface exposes only the internal `id` and source-agnostic fields

**Technique**: Interface Contract Testing / Static Analysis

##### Tier 3 — BDD Scenarios

**ATS-046-A1**

- **Given** a `RESOLVED` food backed by USDA (whose adapter mapped `fdcId → external_key` inbound)
- **When** an authenticated client reads it via `GET /v1/foods/{id}`, lists candidates via
  `GET /v1/foods/{id}/candidates`, and searches via `GET /v1/foods/search`
- **Then** **no** response field exposes `fdcId` or any USDA-specific identifier; a source's native key
  appears only as a generic `externalKey` attribute on the crosswalk/candidate, never as the food's identity
  — confirming source coupling is confined to the adapter (REQ-046, SC-013)

---

### Tier 1 — Feature/Epic: USDA Adapter Boundary (Source Adapter)

**User Goal**: As a Commise operator, I want the USDA adapter to fetch correctly against USDA's API and map
`fdcId → external_key` inbound, with `fdcId` confined to this boundary. Maps to REQ-023/REQ-024/REQ-IF-004
and US-4 AS-3.

---

#### Tier 2 — REQ-023 / REQ-IF-004: USDA adapter selects single vs batch endpoint correctly; 1 call per API call (US-4 AS-3)

**AT-023-A** — The USDA adapter uses single-item GET and batch POST correctly; batching is 1 rolling-window call

**Technique**: Interface Contract Testing

> **`fdcId` boundary note**: `fdcId` appears in this test **only** because it is the USDA-adapter boundary;
> the canonical model and public API use the internal `id` / `external_key` (REQ-046).

##### Tier 3 — BDD Scenarios

**ATS-023-A1**

- **Given** the USDA adapter must fetch one resolved item
- **When** it fetches from USDA
- **Then** it calls `GET /v1/food/{fdcId}` on the USDA API; 1 call is recorded against USDA's rolling window;
  the response is mapped `fdcId → external_key` inbound

**ATS-023-A2**

- **Given** the USDA adapter has resolved which USDA source items back several queued foods (≤20 keys)
- **When** it fetches from USDA
- **Then** it MAY use `POST /v1/foods` with up to 20 `fdcIds` in a single request, counting as exactly **1**
  call against USDA's rolling window — an adapter-internal optimization invisible to the canonical API

---

#### Tier 2 — REQ-024 / REQ-055: USDA `200` maps + validates into the canonical model; crosswalk recorded; no payload retained

**AT-024-A** — Full USDA success path maps into the golden record with provenance and a crosswalk row

**Technique**: Interface Contract Testing

> **`fdcId` boundary note**: confined to the USDA adapter (REQ-046).

##### Tier 3 — BDD Scenarios

**ATS-024-A1**

- **Given** the USDA adapter receives `200 OK` for a resolved item with nutrient data
- **When** it processes the response
- **Then** it maps `fdcId → external_key`, USDA nutrients → `food_nutrients` at per-100g basis, USDA portions
  → `food_portions`; validates/sanitizes the mapped values (REQ-055); on a confident merge the food is
  upserted `status = 'RESOLVED'`, the `food_sources` crosswalk row is recorded (`UNIQUE(source, external_key)`),
  the `fetch_queue` row is resolved, and a `FoodFetchCompleted` event is emitted — with **no verbatim source
  payload retained**

---

#### Tier 2 — REQ-055 / REQ-IF-012: Source adapter validates/sanitizes and uses HTTPS; invalid responses rejected

**AT-055-A** — Adapter input safety: a response failing validation is rejected, not stored

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-055-A1**

- **Given** a source returns a value that fails the adapter's type/range/length checks (e.g. a negative
  nutrient amount or an over-length name)
- **When** the adapter maps the response
- **Then** the failing value is **rejected** before it enters the canonical store; the food may still resolve
  from the remaining valid values or other sources; outbound fetches use HTTPS with certificate validation

---

### Tier 1 — Feature/Epic: Non-Functional Acceptance

**User Goal**: As a Commise operator, I want the food data system to meet its latency, per-source
rate-limit, data fidelity, and reliability targets so the feature is safe to ship.

---

#### Tier 2 — REQ-NF-011: `RESOLVED` reads return within 50ms at p95 (SC-001)

**AT-NF011-A** — Latency probe for the `RESOLVED`-read path

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-NF011-A1**

- **Given** the local store contains 1,000+ `RESOLVED` foods _(deferred variant: served from the Redis
  `food:{id}` cache)_
- **When** 200 sequential authenticated `GET /v1/foods/{id}` requests are made for locally-`RESOLVED` foods
- **Then** p95 response time is under 50ms as measured at the ALB / food read service ingress

---

#### Tier 2 — REQ-NF-012: Per-source rolling-window compliance under sustained load (SC-002)

**AT-NF012-A** — No rolling 60-min window ever exceeds a source's cap under sustained load

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-NF012-A1**

- **Given** the consumer is processing a sustained stream of add-by-name resolutions that fan out to USDA
- **When** CloudWatch metrics are reviewed using a sliding trailing-60-minute count across the run
- **Then** no rolling-60-min window ever exceeds **1,000** USDA calls (and ≤ each additional source's cap,
  per source); zero `429` responses are recorded in CloudWatch

---

#### Tier 2 — REQ-NF-013: Background resolution completes within 60s at p95 (SC-003)

**AT-NF013-A** — End-to-end add-by-name resolution latency

**Technique**: Performance Measurement

##### Tier 3 — BDD Scenarios

**ATS-NF013-A1**

- **Given** the `fetch_queue` pending-row depth is under 100 rows
- **When** an authenticated client adds an unknown food (`202` + `id`) and polls `GET /v1/foods/{id}/status`
  every 5 seconds
- **Then** the status transitions from `PENDING` to `RESOLVED` within 60 seconds at p95 across 20 runs
  (excluding `UNRESOLVED` foods awaiting a human pick)

---

#### Tier 2 — REQ-NF-016: Zero data loss; tombstone rows capture all persistently failing foods (SC-006)

**AT-NF016-A** — Tombstone rows capture every food that exhausts retries

**Technique**: Fault Injection

##### Tier 3 — BDD Scenarios

**ATS-NF016-A1**

- **Given** 10 add-by-name rows are injected and the consumer is configured to fail every fan-out on every
  attempt
- **When** each row exhausts its 5 retry attempts (with backoff)
- **Then** all 10 foods are set to `FAILED` with `status = 'tombstone'` rows; none are silently dropped; the
  CloudWatch tombstone-row-count alarm fires _(See also AT-016-A for the operator-auditability slice.)_

---

#### Tier 2 — REQ-NF-018 / REQ-051 / SC-008: Stored nutrient values faithful to source after per-100g normalization

**AT-NF018-A** — Data fidelity check against the source after documented normalization

**Technique**: Equivalence Partitioning

> **`fdcId` boundary note**: the source item is identified by `fdcId` inside the USDA adapter only; the
> stored/served food is keyed on the internal `id`.

##### Tier 3 — BDD Scenarios

**ATS-NF018-A1**

- **Given** the USDA source returns a known food record (e.g. "Chicken, broilers or fryers, breast, meat
  only, raw") with documented nutrient values
- **When** the adapter ingests the record and a client retrieves the resulting food via `GET /v1/foods/{id}`
- **Then** all nutrient values in the response are faithful to the source after the **documented per-100g
  basis normalization** (recorded via `basis`); no lossy rounding or transformation is applied beyond basis
  normalization (SC-008)

---

#### Tier 2 — REQ-NF-007: All code passes turbo typecheck, lint, and format:check with zero errors

**AT-NF007-A** — CI gate passes before merge

**Technique**: Static Analysis

##### Tier 3 — BDD Scenarios

**ATS-NF007-A1**

- **Given** the feature branch contains all implementation code
- **When** `turbo run typecheck lint format:check` is executed in CI
- **Then** all three commands exit with code 0; zero errors or warnings are reported

---

## Acceptance Criteria per REQ

| REQ                  | Pre-condition                                                                         | Success Condition                                                                                                                                                                          | Acceptance Test Technique     |
| -------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| REQ-001              | Food exists locally; read by `id`                                                     | `200 OK`/`202`/`404` per `status`; zero outbound calls to any external source during the request                                                                                           | Interface Contract Testing    |
| REQ-002              | Food exists locally with `status = 'RESOLVED'`                                        | `200 OK`; body contains `id`, `name`/`description`, normalized calories/protein/carbs/fat, micronutrients, per-field provenance; no `fdcId`                                                | Equivalence Partitioning      |
| REQ-003              | Food exists locally with `status = 'PENDING'` or `'UNRESOLVED'`                       | `202 Accepted` with `{"status": <PENDING\|UNRESOLVED>, "id": <id>, "estimatedWaitSeconds": <n>}`                                                                                           | Equivalence Partitioning      |
| REQ-004              | Food is `NOT_FOUND`/`FAILED`, or no row exists                                        | `404 Not Found`; lifecycle `status` still retrievable for an existing row; no fetch enqueued                                                                                               | Equivalence Partitioning      |
| REQ-005              | `POST /v1/foods` with a new name / a name in flight                                   | `202 Accepted` + new `id` (≤100ms); concurrent same-normalized-name adds collapse to one row + `id`; empty/whitespace name → `400`                                                         | Equivalence / Concurrency     |
| REQ-006              | API receives a malformed `id` or empty `POST` name                                    | `400 Bad Request`; no row created, nothing enqueued                                                                                                                                        | Boundary Value Analysis       |
| REQ-007 / REQ-033    | Food in any lifecycle `status`                                                        | `GET /v1/foods/{id}/status` returns the correct `status`; full golden record when `RESOLVED`                                                                                               | Equivalence Partitioning      |
| REQ-008              | Local store contains matching foods / a barcode/`external_key`                        | `200 OK` with relevance-ranked canonical `id`s; fuzzy match via `pg_trgm`; barcode/`external_key` resolves via crosswalk                                                                   | Equivalence / Interface       |
| REQ-009              | Search query issued against local store                                               | Zero external source calls during search                                                                                                                                                   | Interface Contract Testing    |
| REQ-010              | Local store of 50,000 foods with GIN index                                            | p95 search latency under 200ms across 100 requests                                                                                                                                         | Performance Measurement       |
| REQ-011              | Single add-by-name miss                                                               | One `fetch_queue` row keyed on the `id` enqueued via `INSERT … ON CONFLICT` + `pg_notify`; not via EventBridge                                                                             | Interface Contract Testing    |
| REQ-012              | Multi-food add (recipe import) with unknown names                                     | One canonical row + `id` per unknown name; per-`id` `fetch_queue` rows (deduped); per-item partial response (REQ-040a)                                                                     | Equivalence Partitioning      |
| REQ-013              | Concurrent adds for the same normalized name / duplicate enqueues                     | One canonical row + `id` (name dedup); one `fetch_queue` row (`ON CONFLICT`)                                                                                                               | Concurrency / Fault Injection |
| REQ-014 / REQ-044a   | Add-by-name miss admissions resolved                                                  | Single demand-weighted `fetch_queue`; `request_count` = capped distinct-requester count (`PRIORITY_CAP=1`); backpressure `503` at admission                                                | Interface / Boundary          |
| REQ-015              | Queue contains rows with differing distinct-requester demand                          | Drains higher `request_count` first, FIFO tie-break, demotion overlay applied at drain time                                                                                                | Equivalence Partitioning      |
| REQ-016 / REQ-027    | Fan-out source `5xx`/timeout on every attempt                                         | ≤5 attempts with backoff, then food `FAILED` + row `status='tombstone'` with `last_error`; re-fetchable                                                                                    | Fault Injection               |
| REQ-019              | Per-source rolling window; sustained drain                                            | ≤ source cap (USDA: 1,000) in any trailing 60 min; worker pauses that source at 90% (USDA: 900); zero `429`                                                                                | Performance Measurement       |
| REQ-020              | Concurrent check-and-record on the per-source window                                  | Atomic count+record; no race exceeds the source cap; per-source keying                                                                                                                     | Fault Injection / Concurrency |
| REQ-021              | Source window at cap                                                                  | No source call; `fetch_queue` row lease released → `pending`; waits for ageing-out                                                                                                         | Fault Injection               |
| REQ-023              | USDA single vs batch fetch (USDA-adapter boundary)                                    | `GET /v1/food/{fdcId}` single; `POST /v1/foods` ≤20 `fdcIds` batch; 1 rolling-window call per API call; `fdcId → external_key`                                                             | Interface Contract Testing    |
| REQ-024              | USDA returns `200 OK` (USDA-adapter boundary)                                         | Mapped + validated into canonical model; `food_sources` crosswalk recorded; `RESOLVED`; `FoodFetchCompleted` emitted; no payload retained                                                  | Interface Contract Testing    |
| REQ-025              | Fan-out finds no source has the item                                                  | Food `NOT_FOUND` + row `status='tombstone'`; within TTL → `404` no re-enqueue; after 30-day TTL re-attempt counts against the budget                                                       | Fault Injection               |
| REQ-026              | Source returns `429`                                                                  | Consumer backs off that source; row left `pending`; no further source calls                                                                                                                | Fault Injection               |
| REQ-031 / REQ-053    | `RESOLVED` food; scheduled refresh; one backing item changed / unchanged              | Only fields whose source item changed are re-pulled (validated, provenance updated); unchanged + user-resolved fields preserved; never blindly re-blends                                   | Equivalence Partitioning      |
| REQ-032              | Scheduled rule fires                                                                  | Change-driven refresh enqueues affected fields as low-priority deduped work; change detected via `food_sources.item_version`                                                               | Equivalence Partitioning      |
| REQ-035 / REQ-IF-007 | Request without a valid token to any `/v1/foods/*` endpoint                           | `401 Unauthorized` in-process via `FoodAuthGuard`; no row, enqueue, or source call                                                                                                         | Interface Contract Testing    |
| REQ-040a             | Batch with mixed resolved/unresolved; over-limit batch                                | Per-item partial result (resolved inline + `PENDING` per miss); >100 → `400`, nothing enqueued                                                                                             | Boundary Value Analysis       |
| REQ-040b             | Queue at `MAX_QUEUE_DEPTH` / circuit breaker open                                     | Enqueue fails closed with `503` at admission; jittered recovery                                                                                                                            | Boundary / Fault Injection    |
| REQ-046              | `RESOLVED` food backed by USDA; read/candidates/search                                | No `fdcId` or source-native id in any public response field; source key only as `externalKey` attribute                                                                                    | Interface / Static Analysis   |
| REQ-047              | `POST /v1/foods` add-by-name                                                          | Canonical row + `id` created (normalized-name dedup); `202` + `id`; `id` is the queue key, poll handle, identity                                                                           | Equivalence Partitioning      |
| REQ-048 / REQ-IF-010 | `UNRESOLVED` food                                                                     | `GET /v1/foods/{id}/candidates` returns each candidate's source + item key; pre-merged as far as confident                                                                                 | Interface Contract Testing    |
| REQ-049 / REQ-IF-011 | `UNRESOLVED` food; in-set vs out-of-set candidate                                     | In-set pick merges → `RESOLVED`; out-of-set candidate → `400`/`409`, `status` unchanged                                                                                                    | Interface / Negative          |
| REQ-050              | Add-by-name fan-out across wired adapters                                             | Confident → `RESOLVED`; ambiguous → `UNRESOLVED`; no source → `NOT_FOUND`; errored → `FAILED`                                                                                              | Interface / Equivalence       |
| REQ-050a             | Pre-merge dedup; survivor count after normalized-name exact match                     | Exactly 1 survivor → `RESOLVED`; >1 → `UNRESOLVED` (set persisted to `food_candidates`); 0 → `NOT_FOUND`; no nutrient tolerance, bias to `UNRESOLVED`                                      | Equivalence Partitioning      |
| REQ-025a             | `UNRESOLVED` food; candidate set within / past the 30-day TTL                         | Food kept until a human picks (never swept to `NOT_FOUND`); set expires at 30 days → next add re-fans-out; pick before expiry wins                                                         | Fault Injection               |
| REQ-028a             | Re-add of a terminal-state (`NOT_FOUND`/`FAILED`) row past TTL; `PATCH` on `RESOLVED` | Terminal row reactivated to `PENDING` (no `23505`); `PATCH`-resolve is UNRESOLVED-only + idempotent; refresh never clobbers a manual pick                                                  | State Transition              |
| REQ-051              | Multi-source merge                                                                    | Presence beats absence; identity/short → higher-priority source (not longest); free-text → longer; nutrients per-100g before blend; conflict → higher-priority source; no incoherent blend | Equivalence Partitioning      |
| REQ-052              | `RESOLVED` food incl. a user pick                                                     | Per-value `source_id` + scalar `food_field_provenance`; "which fields from source X" single-query answerable; user pick stored as ordinary provenance                                      | Interface Contract Testing    |
| REQ-054 / REQ-IF-012 | USDA-backed food across the API surface                                               | Source-agnostic canonical shapes only past the adapter boundary; no source-specific structure leaks                                                                                        | Interface / Inspection        |
| REQ-055              | Source returns a value failing validation                                             | Failing value rejected, not stored; HTTPS with cert validation; food may still resolve from valid values/sources                                                                           | Fault Injection               |
| REQ-037a–d (US-0)    | No/expired/malformed/wrong-`azp`/wrong-instance token + forged header                 | `401`; valid token → `200`/`202`/`404` keyed on `id`; AS-5 networkless verified via egress-deny harness; no row/enqueue/source call on reject                                              | Interface / Equivalence       |
| REQ-038b–c (US-0)    | Authenticated, insufficient operational scope                                         | `403` (distinct from `401`), per the `401 → 403 → 400 → business logic` precedence                                                                                                         | Equivalence Partitioning      |
| REQ-039 (US-0)       | Per-`sub` >50 pending                                                                 | Accepted (`202`, no `429`); items demoted to back; one user cannot starve others; dynamic re-promotion below 50                                                                            | Boundary Value Analysis       |
| REQ-040a (US-0)      | Oversized batch                                                                       | `400`; nothing enqueued / no row created                                                                                                                                                   | Boundary Value Analysis       |
| REQ-041 (US-0)       | Backend M2M token                                                                     | Accepted; server-to-server not forced to `401`                                                                                                                                             | Interface Contract Testing    |
| REQ-043 (US-0)       | WebSocket `$connect`; `FoodFetchCompleted` push                                       | `$connect` rejected (`403`) without token; push delivered only to the requesting `sub` (no broadcast)                                                                                      | Interface Contract Testing    |
| REQ-IF-001           | Client sends `GET /v1/foods/{id}`                                                     | Correct response per `status`; URL versioning (`/v1/`) honored; keyed on internal `id`                                                                                                     | Interface Contract Testing    |
| REQ-IF-002           | Client sends `GET /v1/foods/{id}/status`                                              | Response matches documented lifecycle schema                                                                                                                                               | Interface Contract Testing    |
| REQ-IF-003           | Client sends `GET /v1/foods/search?query=<string>`                                    | Relevance-ranked array of `id`s; barcode/`external_key` lookup                                                                                                                             | Interface Contract Testing    |
| REQ-IF-004           | USDA adapter single/batch fetch (USDA-adapter boundary)                               | Correct USDA endpoint per fetch type; `fdcId` + batch size confined to the adapter                                                                                                         | Interface Contract Testing    |
| REQ-IF-007           | Request to any `/v1/foods/*` endpoint                                                 | Reuses the shared in-process Clerk verify via `FoodAuthGuard`; no Lambda authorizer for the HTTP API                                                                                       | Interface Contract Testing    |
| REQ-IF-008           | Token in at any entry point                                                           | Verified `AuthenticatedCaller` (`sub`/`azp`/scopes) out, derived solely from the token; failures → `401`                                                                                   | Interface Contract Testing    |
| REQ-IF-009           | `POST /v1/foods` / `POST /v1/foods/batch`                                             | `202` + `id` for a new name; ≤100-name batch per-item partial; empty name → `400`                                                                                                          | Interface Contract Testing    |
| REQ-IF-010           | `UNRESOLVED` food                                                                     | Candidate list with each candidate's `source` + `externalKey`                                                                                                                              | Interface Contract Testing    |
| REQ-IF-011           | `PATCH /v1/foods/{id}` candidate selection                                            | In-set pick → `200` + `RESOLVED`; out-of-set → `400`/`409`, `status` unchanged                                                                                                             | Interface Contract Testing    |
| REQ-IF-012           | Source adapter across the boundary                                                    | Implements `searchByName`/`fetchByKey`/`mapToCanonical`; only source-agnostic shapes leak; no `fdcId` through                                                                              | Interface / Inspection        |
| REQ-NF-007           | Feature branch code complete                                                          | `turbo run typecheck lint format:check` exits 0 with zero errors                                                                                                                           | Static Analysis               |
| REQ-NF-011           | Local store contains `RESOLVED` foods                                                 | p95 read latency under 50ms                                                                                                                                                                | Performance Measurement       |
| REQ-NF-012           | Consumer processing sustained add stream                                              | No rolling-60-min window over a source's cap (USDA: 1,000); zero `429` in CloudWatch                                                                                                       | Performance Measurement       |
| REQ-NF-013           | `fetch_queue` pending-row depth under 100                                             | `PENDING` → `RESOLVED` within 60 seconds at p95                                                                                                                                            | Performance Measurement       |
| REQ-NF-016           | Consumer fails every fan-out for 10 add rows                                          | All 10 foods `FAILED` with `status='tombstone'`; none silently dropped                                                                                                                     | Fault Injection               |
| REQ-NF-018           | USDA returns a known record with documented nutrient values (USDA-adapter boundary)   | Stored/served values faithful to source after per-100g normalization (recorded via `basis`); no lossy rounding beyond basis                                                                | Equivalence Partitioning      |

---

## Feature Test Summary Matrix

| Requirement                  | BDD Scenario Count                      | Test Method                   | Pass Criteria                                                                                                                                                                                             |
| ---------------------------- | --------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REQ-001                      | 2                                       | Interface Contract Testing    | Zero external source calls in the read path across all scenarios                                                                                                                                          |
| REQ-002                      | 1                                       | Equivalence Partitioning      | Golden-record fields present + per-field provenance; no `fdcId` in `200 OK` body                                                                                                                          |
| REQ-003                      | 2                                       | Equivalence Partitioning      | `202` with correct `PENDING`/`UNRESOLVED` body                                                                                                                                                            |
| REQ-004                      | 3                                       | Equivalence Partitioning      | `404` for `NOT_FOUND`/`FAILED`/absent; `status` still retrievable; no enqueue                                                                                                                             |
| REQ-006                      | 2 (+ ATS-005-A2)                        | Boundary Value Analysis       | `400` for malformed `id` / empty `POST` name; nothing reaches the queue                                                                                                                                   |
| REQ-007 / REQ-033            | 2                                       | Equivalence Partitioning      | Status endpoint returns correct schema for each lifecycle partition                                                                                                                                       |
| REQ-005 / REQ-047            | 2 (A) + 1 (B)                           | Equivalence / Concurrency     | `202` + `id` ≤100ms; concurrent same-name adds collapse to one row + `id`                                                                                                                                 |
| REQ-050                      | 2 (A) + 1 (B)                           | Interface / Equivalence       | Confident → `RESOLVED`; ambiguous → `UNRESOLVED`; correct side effects                                                                                                                                    |
| REQ-050a                     | covered by AT-050-A/B + AT-025-A        | Equivalence Partitioning      | Survivor count after normalized-name exact match: 1 → `RESOLVED`; >1 → `UNRESOLVED` (persisted); 0 → `NOT_FOUND`; no nutrient tolerance                                                                   |
| REQ-025a                     | 2 (AT-025a-A)                           | Fault Injection               | `UNRESOLVED` food kept (not swept); candidate set 30-day TTL → re-fan-out; pick before expiry wins                                                                                                        |
| REQ-028a                     | 2 (AT-028a-A) + ATS-049-A2              | State Transition              | Terminal-row reactivation to `PENDING` (no `23505`); `PATCH`-resolve UNRESOLVED-only + idempotent                                                                                                         |
| REQ-025                      | 2                                       | Fault Injection               | No source → `NOT_FOUND` tombstone; re-attempt after 30-day TTL counts against the budget                                                                                                                  |
| REQ-048 / REQ-IF-010         | 1                                       | Interface Contract Testing    | Candidate list with each candidate's source + item key; no `fdcId`                                                                                                                                        |
| REQ-049 / REQ-IF-011         | 1 (A) + 1 (B)                           | Interface / Negative          | In-set pick → `RESOLVED`; out-of-set → `400`/`409`, `status` unchanged                                                                                                                                    |
| REQ-051                      | 3 (A) + 3 (B)                           | Equivalence Partitioning      | Merge precedence; per-100g before blend; conflict → higher-priority source; no incoherent blend                                                                                                           |
| REQ-052                      | 1                                       | Interface Contract Testing    | Per-field provenance single-query answerable; user pick = ordinary provenance                                                                                                                             |
| REQ-012 / REQ-040a           | 2                                       | Equivalence Partitioning      | Per-item partial result; per-`id` deduped rows                                                                                                                                                            |
| REQ-014 / REQ-015 / REQ-044a | 3                                       | Equivalence Partitioning      | Demand-weighted by distinct-requester count; FIFO tie-break; `sub` counts once                                                                                                                            |
| REQ-027 / REQ-016            | 1                                       | Fault Injection               | `5xx` retries with backoff → `FAILED` tombstone; re-fetchable                                                                                                                                             |
| REQ-016 / REQ-NF-016         | 1                                       | Fault Injection               | Tombstone rows audit every failed food; nothing silently dropped                                                                                                                                          |
| REQ-040b                     | 1                                       | Boundary / Fault Injection    | `503` at queue ceiling / open breaker; admission-time; jittered recovery                                                                                                                                  |
| REQ-008 / REQ-IF-003         | 3 (A) + 1 (B)                           | Equivalence / Interface       | Ranked `id`s; fuzzy match; empty set no-match; barcode/`external_key` → `id`                                                                                                                              |
| REQ-009                      | 1                                       | Interface Contract Testing    | Zero external source calls during search                                                                                                                                                                  |
| REQ-010                      | 1                                       | Performance Measurement       | p95 search latency under 200ms at 50,000 records                                                                                                                                                          |
| REQ-019 / REQ-NF-012         | 1                                       | Performance Measurement       | ≤ source cap in any trailing 60 min; worker pauses at 90%; zero `429`                                                                                                                                     |
| REQ-021                      | 1                                       | Fault Injection               | No source call at cap; row re-deferred to `pending`                                                                                                                                                       |
| REQ-026                      | 1                                       | Fault Injection               | Source `429` → back off that source; row left `pending`                                                                                                                                                   |
| REQ-020                      | 1                                       | Fault Injection / Concurrency | Atomic per-source check-and-record; no race over the cap                                                                                                                                                  |
| REQ-031 / REQ-053            | 2 (A) + 2 (B)                           | Equivalence Partitioning      | Changed item re-pulled; unchanged + user-resolved preserved; re-pull validated                                                                                                                            |
| REQ-046                      | 1                                       | Interface / Static Analysis   | No `fdcId`/source-native id in any public response field                                                                                                                                                  |
| REQ-023 / REQ-IF-004         | 2                                       | Interface Contract Testing    | Correct USDA single/batch endpoint; 1 rolling-window call per API call (USDA-adapter boundary)                                                                                                            |
| REQ-024                      | 1                                       | Interface Contract Testing    | USDA `200` mapped/validated; crosswalk recorded; no payload retained (USDA-adapter boundary)                                                                                                              |
| REQ-055 / REQ-IF-012         | 1                                       | Fault Injection               | Invalid source value rejected, not stored; HTTPS cert validation                                                                                                                                          |
| REQ-035 / REQ-037a–d (US-0)  | 5 (ATP-008-A..D; B has B1+B2)           | Interface / Equivalence       | `401` on no/expired/malformed/wrong-`azp`/wrong-instance + forged header; valid → `200`/`202`/`404`; AS-5 networkless via egress-deny; no side effects on reject                                          |
| REQ-038b–c (US-0)            | 1 (ATP-008-G)                           | Equivalence Partitioning      | Insufficient scope → `403`, distinct from `401`                                                                                                                                                           |
| REQ-039 / REQ-040b (US-0)    | 3 (ATP-008-F: F1/F2/F3)                 | Boundary Value Analysis       | >50 pending (all requesters) → `202`, demoted to back (no `429`); one under-threshold requester not demoted (FR-043a); near-ceiling NEW enqueues shed with `503` (FR-043b); dynamic re-promotion below 50 |
| REQ-040a (US-0)              | 1 (ATP-008-I)                           | Boundary Value Analysis       | Oversized batch → `400`; nothing enqueued / no row created                                                                                                                                                |
| REQ-041 (US-0)               | 1 (ATP-008-H)                           | Interface Contract Testing    | Backend M2M token accepted; not forced to `401`                                                                                                                                                           |
| REQ-043 (US-0)               | 2 (ATP-008-E)                           | Interface Contract Testing    | `$connect` rejected (`403`) without token; `FoodFetchCompleted` delivered only to the requesting `sub`                                                                                                    |
| REQ-IF-001                   | Covered by REQ-002..REQ-004             | Interface Contract Testing    | Correct response per `status`; `/v1/` honored; keyed on `id`                                                                                                                                              |
| REQ-IF-002                   | Covered by REQ-007                      | Interface Contract Testing    | Status response matches documented lifecycle schema                                                                                                                                                       |
| REQ-IF-005                   | Covered by REQ-050 / REQ-024            | Inspection                    | Lifecycle events carry the food `id`; demand path is `fetch_queue` + `NOTIFY`, not EventBridge                                                                                                            |
| REQ-IF-007 / REQ-IF-008      | Covered by ATP-008-A..D                 | Interface Contract Testing    | Shared in-process Clerk middleware; verified `AuthenticatedCaller` out                                                                                                                                    |
| REQ-IF-009                   | Covered by REQ-005 / REQ-012 / REQ-040a | Interface Contract Testing    | Add-by-name + batch contract                                                                                                                                                                              |
| REQ-NF-007                   | 1                                       | Static Analysis               | `turbo run typecheck lint format:check` exits 0                                                                                                                                                           |
| REQ-NF-011                   | 1                                       | Performance Measurement       | p95 `RESOLVED`-read latency under 50ms                                                                                                                                                                    |
| REQ-NF-012                   | 1                                       | Performance Measurement       | No rolling-60-min window over a source's cap; zero `429` in CloudWatch                                                                                                                                    |
| REQ-NF-013                   | 1                                       | Performance Measurement       | `PENDING` → `RESOLVED` within 60 seconds at p95                                                                                                                                                           |
| REQ-NF-016                   | 1                                       | Fault Injection               | All failed foods captured as tombstone rows; none silently dropped                                                                                                                                        |
| REQ-NF-018                   | 1                                       | Equivalence Partitioning      | Stored nutrient values faithful to source after per-100g normalization                                                                                                                                    |

**Total BDD Scenarios**: 81 _(68 base + 13 US-0 auth scenarios under ATP-008: ATS-036-A1, ATS-037-B1, ATS-037-B2, ATS-038-C1, ATS-039-D1, ATS-040-E1, ATS-040-E2, ATS-041-F1, ATS-041-F2, ATS-041-F3, ATS-042-G1, ATS-043-H1, ATS-044-I1)_

> Base scenario count (68) = ATS-001-A1/A2, ATS-002-A1, ATS-003-A1/A2, ATS-004-A1/A2/A3, ATS-006-A1/A2,
> ATS-007-A1/A2, ATS-005-A1/A2/B1, ATS-028a-A1/A2, ATS-050-A1/A2/B1, ATS-025-A1/A2, ATS-048-A1,
> ATS-049-A1/A2/B1, ATS-025a-A1/A2, ATS-051-A1/A2/A3/B1/B2/B3, ATS-052-A1, ATS-012-A1/A2, ATS-015-A1/A2/A3,
> ATS-027-A1, ATS-016-A1, ATS-040-B1, ATS-008-A1/A2/A3/B1, ATS-009-A1, ATS-010-A1, ATS-019-A1, ATS-021-A1,
> ATS-026-A1, ATS-020-A1, ATS-031-A1/A2/B1/B2, ATS-046-A1, ATS-023-A1/A2, ATS-024-A1, ATS-055-A1,
> ATS-NF011-A1, ATS-NF012-A1, ATS-NF013-A1, ATS-NF016-A1, ATS-NF018-A1, ATS-NF007-A1.

---

## Exit Criteria

The feature is considered shippable when **all** of the following conditions are true:

### Functional Gate

- [ ] All 68 base BDD acceptance scenarios (plus the 13 US-0 auth scenarios under ATP-008) pass in a staging
      environment connected to a real USDA FoodData Central API key
- [ ] Zero unexpected `400`/`401`/`404`/`500` responses observed for valid authenticated reads of locally-`RESOLVED` foods
- [ ] Add-by-name lifecycle confirmed: `POST /v1/foods` → `202` + `id`; background fan-out → `RESOLVED` (or `UNRESOLVED` with a candidate list) within the SLA window
- [ ] Normalized-name dedup confirmed: concurrent same-name adds collapse to exactly one canonical row + `id` and one `fetch_queue` row
- [ ] Candidate resolve confirmed: an in-set `PATCH` pick → `RESOLVED`; an out-of-set candidate → `400`/`409` with `status` unchanged
- [ ] Merge correctness confirmed: presence beats absence; identity/short fields take the higher-priority source (not the longest); free-text takes the longer value; nutrients normalized to per-100g before any blend; conflicts resolve by source priority with `food_nutrients.source_id` recorded — no nutritionally-incoherent blend stored
- [ ] Per-field provenance confirmed: "which fields came from source X" is single-query answerable; a user's manual pick is stored as ordinary provenance
- [ ] Tombstone routing confirmed: foods that exhaust their ≤5 retry attempts land in `FAILED` with `status='tombstone'`; foods with no source land in `NOT_FOUND`

### Performance Gate

- [ ] p95 `RESOLVED`-read latency is under 50ms (REQ-NF-011)
- [ ] p95 search latency is under 200ms at 50,000 local records (REQ-010)
- [ ] p95 add-by-name resolution latency is under 60 seconds with `fetch_queue` pending-row depth under 100 (REQ-NF-013)
- [ ] Per-source rolling-window compliance confirmed: no rolling 60-minute window ever exceeds a source's cap (USDA: 1,000); the worker pauses that source at 90% (USDA: 900); zero `429` responses in CloudWatch (REQ-NF-012, SC-002)

### Data Integrity Gate

- [ ] Nutrient values for at least 5 spot-checked foods are faithful to their source after the documented per-100g normalization (REQ-NF-018, SC-008)
- [ ] Zero fetches silently dropped under fault injection; all persistently failing foods appear as `FAILED`/`NOT_FOUND` tombstone rows (REQ-NF-016, SC-006)
- [ ] Source-agnostic identity confirmed: no canonical row, DAO, public DTO, or API field outside the USDA adapter exposes `fdcId` or any source-native identifier (REQ-046, SC-013)

### CI Gate

- [ ] `turbo run typecheck lint format:check` exits 0 with zero errors on the feature branch (REQ-NF-007)
- [ ] Test pyramid ratios met: ≥70% unit, ≤20% integration, ≤10% E2E (REQ-NF-008)

### Security Gate

- [ ] All `/v1/foods/*` endpoints return `401 Unauthorized` for unauthenticated requests (REQ-035)
- [ ] US-0 auth contract green (ATP-008): every entry point + WebSocket `$connect` rejects no/expired/malformed/wrong-`azp`/wrong-instance tokens (`401`/`403`) with no row, enqueue, or source call; valid token → `200`/`202`/`404` keyed on `id`; per-`sub` >50 pending → accepted (`202`) with items demoted to the back (no `429`); insufficient scope → `403`; M2M token accepted; oversized batch → `400`; `FoodFetchCompleted` not broadcast (REQ-037a–d..REQ-043)
- [ ] Each external source's API key (e.g. the USDA key) is not present in any client-facing response body or application log (REQ-IF-006)

### Out of Scope for This Gate

- REQ-034 (WebSocket push notifications) is P3 and optional; it is excluded from the shippable exit gate (its auth contract is still verified at `$connect` via ATP-008-E)
- REQ-NF-014 (local-store serve rate — the share of reads served from the local golden-record store with no source call) and REQ-NF-015 (local-store read/serve throughput) are P2 analysis targets measured post-launch once the local store reaches 5,000+ `RESOLVED` foods; the **first-time NEW-food resolution rate** (SC-014, ~500–900/hr, bounded by the per-source budget per SC-002) is tracked separately; none of these block the initial ship
- REQ-NF-017 (99.9% monthly availability) is measured over a rolling calendar month and is a target contingent on the deferred multi-AZ DB upgrade (A-013); it cannot be verified pre-launch and is tracked via CloudWatch SLA dashboard post-deploy
- REQ-030 (deferred Redis cache) is not part of the lean-launch build
