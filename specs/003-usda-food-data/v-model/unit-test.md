# Unit Test Plan: Source-Agnostic Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Created**: 2026-05-09
**Status**: Draft — **re-baselined 2026-06-22 to the source-agnostic food data model**
**Source**: `specs/003-usda-food-data/v-model/module-design.md`

> **Re-baseline note (2026-06-22).** This Unit Test Plan (V-Model Layer 4, traces to `module-design.md`
> MOD-_ ids and through them to `requirements.md` REQ-_ ids) was regenerated to match the **source-agnostic
> food data redesign**. A food is keyed by an internal ULID `id`; **USDA is one pluggable source adapter**;
> foods are assembled into a **cross-source golden record** with per-field provenance; users add foods **by
> name** through a `PENDING → (UNRESOLVED) → RESOLVED` lifecycle. The lifecycle status enum is
> `PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED` (the old `fetch_status` enum
> `pending|fetched|not_found|stale` is removed). Old method names (`findByFdcId`/`upsertFood`/
> `updateFetchStatus`/`markPending`/`isStale`), the denormalized JSONB-nutrient assumptions, and the
> stale-while-revalidate / tombstone-TTL read branches are removed from the canonical UTP slice. **`fdcId`
> appears in this plan ONLY inside the MOD-008 adapter test cases** (`searchByName`/`fetchByKey`/
> `mapToCanonical`, which map `fdcId → external_key`). Every other UTP is keyed on the internal `id` and the
> source-agnostic `external_key`.
>
> - **MOD-001..MOD-011** UTPs rewritten/re-keyed to the new design (add-by-name + read-by-`id`; lifecycle
>   enum; per-source rolling window; normalized provenance-bearing store; DAO seam).
> - **MOD-012 / MOD-013 / MOD-014** auth slice **preserved** (networkless verify, fail-closed `401`, `403`
>   scope, M2M, fairness-by-demotion, batch cap, backpressure, async-producer provenance) — re-keyed
>   `fdcId → id` only.
> - **MOD-015..MOD-021** UTPs are **new** (registry, DAO advisory-lock dedup, merge engine, candidate-set
>   validation, value-grain provenance, change-driven refresh, adapter-boundary validation + HTTPS).

## Overview

This document defines the Unit Test Plan for the Source-Agnostic Food Data Integration feature. Every module
design (`MOD-NNN`) in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one
or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state transitions, and
variable boundaries. They do NOT test module boundaries (integration), user journeys (acceptance), or
system-level behavior (system tests).

## ID Schema

- **Unit Test Case (TC marker)**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix
  (A, B, C...). **`UTP-*` is the test-case marker** that `tasks.md` Test-first tasks map to (via the shared
  MOD + REQ/FR trace). See the **Test-first task → UTP map** at the end of this document.
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3...)
- Example: `UTS-001-A1` → Scenario 1 of Test Case A verifying MOD-001
- ID lineage: from `UTS-001-A1`, a regex extracts `UTP-001-A` and `MOD-001`. To find the `ARCH-NNN` ancestor,
  consult the "Parent Architecture Modules" field in `module-design.md`; to find the `REQ-*` requirement,
  consult each UTP's **REQ trace**.
- **Re-baseline (2026-06-22):** UTP ids are kept stable where the test survives; new UTP ids are added for
  new tests; every UTP traces to a valid MOD + REQ. `fdcId` is confined to the MOD-008 UTPs.

## ISO 29119-4 White-Box Techniques

Each test case MUST identify its technique by name and anchor to a specific module design view:

| Technique                       | Source View                   | What It Tests                                           |
| ------------------------------- | ----------------------------- | ------------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View        | Every line and every True/False branch outcome          |
| **Boundary Value Analysis**     | Internal Data Structures      | Scalar variable boundaries: min-1, min, mid, max, max+1 |
| **Equivalence Partitioning**    | Internal Data Structures      | Discrete non-scalar types: Booleans, Enums              |
| **Strict Isolation**            | Architecture Interface View   | Every external dependency mocked/stubbed                |
| **Error Guessing**              | Error Handling & Return Codes | Negative paths, invalid inputs, dependency exceptions   |
| **State Transition Testing**    | State Machine View            | Every transition including invalid ones                 |

---

## Unit Tests

---

### Module: MOD-001 (FoodApiController — Request Handler)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `packages/services/food-service/src/foods/foods.controller.ts`
**REQ trace**: REQ-002..007, REQ-IF-001/002, REQ-045..049, REQ-IF-009..011

---

#### Test Case: UTP-001-A (isValidUlid — ULID format branch coverage)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View + Internal Data Structures
**Description**: Verifies every branch of `isValidUlid()` across the path-param `id` boundary: well-formed
26-char Crockford base32 accepted; wrong length, lowercase/invalid alphabet, and non-string rejected
(REQ-006). The internal `id` replaces the old integer `fdcId`; there is no `fdcId` route.

**Dependency & Mock Registry:** None — `isValidUlid` is a pure function with no external dependencies.

- **Unit Scenario: UTS-001-A1**
    - **Arrange**: `id = "01J9Z3K7Q9ABCDEFGHJKMNPQRS"` (a valid 26-char Crockford base32 ULID)
    - **Act**: Call `isValidUlid("01J9Z3K7Q9ABCDEFGHJKMNPQRS")`
    - **Assert**: Returns `true` (boundary: exactly 26 valid Crockford base32 chars)

- **Unit Scenario: UTS-001-A2**
    - **Arrange**: `id = "01J9Z3K7Q9ABCDEFGHJKMNPQR"` (25 chars, min-1)
    - **Act**: Call `isValidUlid(...)`
    - **Assert**: Returns `false` (boundary: one char short of a ULID)

- **Unit Scenario: UTS-001-A3**
    - **Arrange**: `id = "01J9Z3K7Q9ABCDEFGHJKMNPQRST"` (27 chars, max+1)
    - **Act**: Call `isValidUlid(...)`
    - **Assert**: Returns `false` (boundary: one char too long)

- **Unit Scenario: UTS-001-A4**
    - **Arrange**: `id = "01j9z3k7q9abcdefghjkmnpqrs"` (lowercase / contains excluded letters I,L,O,U)
    - **Act**: Call `isValidUlid(...)`
    - **Assert**: Returns `false` (Crockford base32 excludes I/L/O/U and is upper-case)

- **Unit Scenario: UTS-001-A5**
    - **Arrange**: `id = 12345` (a number, not a string — the old integer-`fdcId` shape)
    - **Act**: Call `isValidUlid(12345)`
    - **Assert**: Returns `false` (non-string input; the id is never an integer)

---

#### Test Case: UTP-001-B (handleGetFood — lifecycle status-code branch coverage)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View
**Description**: Verifies every branch of `handleGetFood()` keyed on the internal `id` and the lifecycle enum:
invalid id → `400`; no row → `404`; `RESOLVED` → `200` golden record; `PENDING`/`UNRESOLVED` → `202`;
`NOT_FOUND`/`FAILED` → `404` with status retrievable (REQ-002/003/004/006). No cache/stale/tombstone-TTL
branch — the read serves the held lifecycle state directly via the DAO seam (MOD-016).

**Dependency & Mock Registry:**

| Dependency          | Source  | Mock/Stub Strategy                                                                    | Rationale                                  |
| ------------------- | ------- | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| `FoodDaoRepository` | MOD-016 | Mock: `findById(id)` returns `null` or a golden-record row with a controlled `status` | Isolate the DAO seam from controller logic |
| `MonitoringLogger`  | MOD-011 | Stub: no-op                                                                           | Prevent CloudWatch side-effects            |

- **Unit Scenario: UTS-001-B1**
    - **Arrange**: `req.params.id = "not-a-ulid"`; `isValidUlid` returns `false`
    - **Act**: Call `handleGetFood(req)`
    - **Assert**: Returns `{ statusCode: 400, body: { error: "Invalid id format" } }`; `FoodDaoRepository.findById` NOT called (REQ-006)

- **Unit Scenario: UTS-001-B2**
    - **Arrange**: valid `id`; `FoodDaoRepository.findById` returns `null`
    - **Act**: Call `handleGetFood(req)`
    - **Assert**: Returns `{ statusCode: 404, body: { error: "Not found" } }`

- **Unit Scenario: UTS-001-B3**
    - **Arrange**: valid `id`; `findById` returns `{ id, status: "RESOLVED", name: "Apple", nutrients: [...], portions: [...], provenance: {...} }`
    - **Act**: Call `handleGetFood(req)`
    - **Assert**: Returns `{ statusCode: 200, body: { food: <GoldenRecordDto> } }`; the body carries `id` (never `fdcId`) and the assembled golden record (REQ-002)

- **Unit Scenario: UTS-001-B4**
    - **Arrange**: valid `id`; `findById` returns `{ id, status: "PENDING" }`
    - **Act**: Call `handleGetFood(req)`
    - **Assert**: Returns `{ statusCode: 202, body: { id, status: "PENDING", estimatedWaitSeconds: 30 } }` (REQ-003)

- **Unit Scenario: UTS-001-B5**
    - **Arrange**: valid `id`; `findById` returns `{ id, status: "UNRESOLVED" }`
    - **Act**: Call `handleGetFood(req)`
    - **Assert**: Returns `{ statusCode: 202, body: { id, status: "UNRESOLVED", estimatedWaitSeconds: 30 } }` — held but ambiguous (disambiguate via MOD-018) (REQ-003)

- **Unit Scenario: UTS-001-B6**
    - **Arrange**: valid `id`; `findById` returns `{ id, status: "NOT_FOUND" }`
    - **Act**: Call `handleGetFood(req)`
    - **Assert**: Returns `{ statusCode: 404, body: { id, status: "NOT_FOUND" } }` — `404` but the lifecycle status is retrievable (REQ-004)

- **Unit Scenario: UTS-001-B7**
    - **Arrange**: valid `id`; `findById` returns `{ id, status: "FAILED" }`
    - **Act**: Call `handleGetFood(req)`
    - **Assert**: Returns `{ statusCode: 404, body: { id, status: "FAILED" } }` (REQ-004)

---

#### Test Case: UTP-001-C (handleAddByName — empty-name reject + dedup enqueue)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View
**Description**: Verifies `handleAddByName()` (`POST /v1/foods`): empty/whitespace-only name → `400` with
**nothing created and nothing enqueued**; a valid name is normalized, `createByName` collapses concurrent
adds to one `id` (advisory-lock dedup, MOD-016), the request is admitted (MOD-013), enqueued (MOD-002), and
`202 { id, status: "PENDING" }` returned (REQ-005/006/047/IF-009).

**Dependency & Mock Registry:**

| Dependency            | Source  | Mock/Stub Strategy                                                  | Rationale                                |
| --------------------- | ------- | ------------------------------------------------------------------- | ---------------------------------------- |
| `FoodDaoRepository`   | MOD-016 | Mock: `createByName(normalized, display)` returns `{ id, created }` | Isolate advisory-lock dedup from handler |
| `DemotionAndFairness` | MOD-013 | Mock: `admitEnqueue()` resolves `{ admitted: true }`                | Isolate fairness/backpressure gate       |
| `EnqueueEmitter`      | MOD-002 | Spy: `publishFoodRequested()` records args                          | Verify the `fetch_queue` enqueue         |

- **Unit Scenario: UTS-001-C1**
    - **Arrange**: `req.body.name = "   "` (whitespace-only)
    - **Act**: Call `handleAddByName(req)`
    - **Assert**: Returns `{ statusCode: 400, body: { error: "Name must not be empty" } }`; `createByName` NOT called; `publishFoodRequested` NOT called (REQ-006 — nothing created/enqueued)

- **Unit Scenario: UTS-001-C2**
    - **Arrange**: `req.body.name = ""` (empty)
    - **Act**: Call `handleAddByName(req)`
    - **Assert**: Returns `{ statusCode: 400 }`; `createByName` NOT called

- **Unit Scenario: UTS-001-C3**
    - **Arrange**: `req.body.name = "  Granny Smith Apple  "`; `req.user.sub = "user_abc"`; `createByName` returns `{ id: "01J...ULID", created: true }`
    - **Act**: Call `handleAddByName(req)`
    - **Assert**: `createByName` called with the normalized key `"granny smith apple"` (lowercased + collapsed whitespace) and the display name; `DemotionAndFairness.admitEnqueue` called with `(req.user, ["01J...ULID"])`; `publishFoodRequested` called with `{ id: "01J...ULID", requestedBy: "user_abc" }`; returns `{ statusCode: 202, body: { id: "01J...ULID", status: "PENDING", estimatedWaitSeconds: 30 } }`

- **Unit Scenario: UTS-001-C4**
    - **Arrange**: As C3, but a concurrent add already created the row — `createByName` returns `{ id: "01J...EXISTING", created: false }`
    - **Act**: Call `handleAddByName(req)`
    - **Assert**: Returns `202` with the **existing** `id` (concurrent adds of the same normalized name collapse to one row + id, REQ-005); the request is still admitted + enqueued (idempotent `ON CONFLICT` in MOD-002/003)

---

#### Test Case: UTP-001-D (handleGetStatus — lifecycle poll)

**Technique**: State Transition Testing + Equivalence Partitioning
**Target View**: Algorithmic/Logic View (lifecycle enum)
**Description**: Verifies `handleGetStatus()` (`GET /v1/foods/{id}/status`, REQ-007): invalid id → `400`; no
row → `404`; otherwise `200 { id, status }` for every lifecycle value, with the golden record inlined **only**
when `RESOLVED`.

**Dependency & Mock Registry:**

| Dependency          | Source  | Mock/Stub Strategy                                           | Rationale                |
| ------------------- | ------- | ------------------------------------------------------------ | ------------------------ |
| `FoodDaoRepository` | MOD-016 | Mock: `findById(id)` returns `null` or a row with a `status` | Isolate DAO from handler |

- **Unit Scenario: UTS-001-D1**
    - **Arrange**: `id = "bad"`; `isValidUlid` returns `false`
    - **Act**: Call `handleGetStatus(req)`
    - **Assert**: Returns `{ statusCode: 400 }`; `findById` NOT called

- **Unit Scenario: UTS-001-D2**
    - **Arrange**: valid id; `findById` returns `null`
    - **Act**: Call `handleGetStatus(req)`
    - **Assert**: Returns `{ statusCode: 404, body: { error: "Not found" } }`

- **Unit Scenario: UTS-001-D3**
    - **Arrange**: valid id; `findById` returns `{ id, status: "PENDING" }`
    - **Act**: Call `handleGetStatus(req)`
    - **Assert**: Returns `{ statusCode: 200, body: { id, status: "PENDING" } }`; `food` field absent (not RESOLVED)

- **Unit Scenario: UTS-001-D4**
    - **Arrange**: valid id; `findById` returns `{ id, status: "RESOLVED", name: "Apple", nutrients: [...] }`
    - **Act**: Call `handleGetStatus(req)`
    - **Assert**: Returns `{ statusCode: 200, body: { id, status: "RESOLVED", food: <GoldenRecordDto> } }` (golden record inlined only on RESOLVED)

- **Unit Scenario: UTS-001-D5**
    - **Arrange**: valid id; `findById` returns `{ id, status: "NOT_FOUND" }`
    - **Act**: Call `handleGetStatus(req)`
    - **Assert**: Returns `{ statusCode: 200, body: { id, status: "NOT_FOUND" } }`; `food` field absent — status remains pollable after a not-found tombstone (REQ-007)

---

#### Test Case: UTP-001-E (handleSearch — query length boundary, local store only)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View + Internal Data Structures
**Description**: Verifies `handleSearch()` rejects queries shorter than 2 characters (`400`) and otherwise
delegates to the DAO's local `pg_trgm` search (`searchByName`) — **never a source call** (REQ-008/009/IF-002).

**Dependency & Mock Registry:**

| Dependency          | Source  | Mock/Stub Strategy                                              | Rationale                    |
| ------------------- | ------- | --------------------------------------------------------------- | ---------------------------- |
| `FoodDaoRepository` | MOD-016 | Mock: `searchByName(query)` returns `[]` or `{id,name,score}[]` | Isolate DB from search logic |

- **Unit Scenario: UTS-001-E1**
    - **Arrange**: `req.query.query = "a"` (length 1, min-1)
    - **Act**: Call `handleSearch(req)`
    - **Assert**: Returns `{ statusCode: 400, body: { error: "Query too short" } }`; `searchByName` NOT called

- **Unit Scenario: UTS-001-E2**
    - **Arrange**: `req.query.query = ""` (length 0)
    - **Act**: Call `handleSearch(req)`
    - **Assert**: Returns `{ statusCode: 400 }`; `searchByName` NOT called

- **Unit Scenario: UTS-001-E3**
    - **Arrange**: `req.query.query = "ap"` (length 2, min valid); `searchByName` returns `[{ id: "01J...", name: "Apple", score: 0.9 }]`
    - **Act**: Call `handleSearch(req)`
    - **Assert**: Returns `{ statusCode: 200, body: { results: [{ id, name, score }] } }`; `searchByName` called with `"ap"` — id-keyed results, never a source/`fdcId` call (REQ-009)

---

#### Test Case: UTP-001-F (handleBatch — per-item partial: resolved inline + pending per miss)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View (per-item partial assembly)
**Description**: Verifies `handleBatch()` (`POST /v1/foods/batch`, REQ-045/IF-009): over-cap (>100) → `400`
with **no rows created and nothing enqueued**; blanks skipped without failing the batch; for an accepted batch,
`RESOLVED` foods returned inline and each non-resolved id enqueued and returned as a `pending` entry — one
response body, no all-or-nothing withholding. A single `admitEnqueue` gate covers the batch (MOD-013).

**Dependency & Mock Registry:**

| Dependency            | Source  | Mock/Stub Strategy                                                                             | Rationale                           |
| --------------------- | ------- | ---------------------------------------------------------------------------------------------- | ----------------------------------- |
| `FoodDaoRepository`   | MOD-016 | Mock: `createByName()` returns `{ id }`; `findById()` returns a row with a controlled `status` | Drive the mixed resolved/miss split |
| `DemotionAndFairness` | MOD-013 | Mock: `admitEnqueue()` resolves `{ admitted: true }`                                           | Single backpressure/demotion gate   |
| `EnqueueEmitter`      | MOD-002 | Spy: `publishFoodRequested()` — assert one enqueue per non-resolved id                         | Verify each miss is enqueued        |

- **Unit Scenario: UTS-001-F1**
    - **Arrange**: `req.body.names` array of length `101` (over the cap)
    - **Act**: Call `handleBatch(req)`
    - **Assert**: Returns `{ statusCode: 400, body: { error: "names must be 1–100 items" } }`; `createByName` NOT called; `publishFoodRequested` NOT called (REQ-045, boundary max+1)

- **Unit Scenario: UTS-001-F2**
    - **Arrange**: `req.body.names = ["apple", "  ", "banana"]`; `createByName` returns distinct ids for `"apple"`/`"banana"`; `findById("apple"→id)` → `{ status: "RESOLVED", ... }`, `findById("banana"→id)` → `{ status: "PENDING" }`
    - **Act**: Call `handleBatch(req)`
    - **Assert**: The blank `"  "` is skipped (no row, no failure); `admitEnqueue` called once with both real ids; returns `{ statusCode: 200, body: { resolved: [{ id: <apple>, food }], pending: [{ id: <banana>, status: "PENDING" }] } }`; `publishFoodRequested` called once (for the banana miss only) — per-item partial (REQ-045)

- **Unit Scenario: UTS-001-F3**
    - **Arrange**: `req.body.names = ["apple", "pear"]`; both `findById` calls return `{ status: "RESOLVED" }`
    - **Act**: Call `handleBatch(req)`
    - **Assert**: Returns `{ statusCode: 200, body: { resolved: [...2 items...], pending: [] } }`; `publishFoodRequested` called **zero** times (no misses → no enqueue)

---

#### Test Case: UTP-001-G (handleResolve — out-of-set candidate delegated reject)

**Technique**: Error Guessing + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (PATCH delegation)
**Description**: Verifies `handleResolve()` (`PATCH /v1/foods/{id}`, REQ-049/IF-011) delegates to
`CandidateResolutionService.resolve` and surfaces its outcome: a successful in-set pick → `200 { id, status }`;
an out-of-set pick propagates the `400`/`409` thrown by MOD-018 with the food status unchanged. (The
membership logic itself is unit-tested under UTP-018.)

**Dependency & Mock Registry:**

| Dependency                   | Source  | Mock/Stub Strategy                                                                                 | Rationale                     |
| ---------------------------- | ------- | -------------------------------------------------------------------------------------------------- | ----------------------------- |
| `CandidateResolutionService` | MOD-018 | Mock: `resolve(id, ids)` resolves `{ status: "RESOLVED" }` or throws `CandidateMismatchError(409)` | Isolate controller delegation |

- **Unit Scenario: UTS-001-G1**
    - **Arrange**: valid id; `req.body.candidateIds = ["c1"]`; `resolve` resolves `{ id, status: "RESOLVED" }`
    - **Act**: Call `handleResolve(req)`
    - **Assert**: Returns `{ statusCode: 200, body: { id, status: "RESOLVED" } }`; `resolve` called with `(id, ["c1"])`

- **Unit Scenario: UTS-001-G2**
    - **Arrange**: valid id; `req.body.candidateIds = ["c-from-other-food"]`; `resolve` throws `CandidateMismatchError(409, "Candidate not in this food's set")`
    - **Act**: Call `handleResolve(req)`
    - **Assert**: Propagates `{ statusCode: 409 }` (or `400` per the error map); the controller does not mutate status itself (REQ-049 — status unchanged on out-of-set)

---

#### Test Case: UTP-001-H (handleGetCandidates — delegation + 404)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `handleGetCandidates()` (`GET /v1/foods/{id}/candidates`, REQ-048/IF-010) validates
the id then returns `CandidateResolutionService.getCandidates(id)`; a missing row surfaces `404` from MOD-018.

**Dependency & Mock Registry:**

| Dependency                   | Source  | Mock/Stub Strategy                                                                       | Rationale          |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------- | ------------------ |
| `CandidateResolutionService` | MOD-018 | Mock: `getCandidates(id)` returns a candidate list, `[]`, or throws `NotFoundError(404)` | Isolate delegation |

- **Unit Scenario: UTS-001-H1**
    - **Arrange**: `id = "bad"`; `isValidUlid` false
    - **Act**: Call `handleGetCandidates(req)`
    - **Assert**: Returns `{ statusCode: 400 }`; `getCandidates` NOT called

- **Unit Scenario: UTS-001-H2**
    - **Arrange**: valid id; `getCandidates` returns `[{ candidateId: "c1", source: "usda", externalKey: "534358", name: "Apple, raw" }]`
    - **Act**: Call `handleGetCandidates(req)`
    - **Assert**: Returns `{ statusCode: 200, body: { id, candidates: [...] } }` — each candidate carries `source` + that source's item key (the only place `external_key` surfaces in the API; never `fdcId`)

- **Unit Scenario: UTS-001-H3**
    - **Arrange**: valid id; `getCandidates` throws `NotFoundError(404)` (no such row)
    - **Act**: Call `handleGetCandidates(req)`
    - **Assert**: Propagates `{ statusCode: 404 }`

---

### Module: MOD-002 (EnqueueEmitter — enqueue + scheduled/completion fan-out)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `packages/services/food-service/src/queue/enqueue-emitter.service.ts`
**REQ trace**: REQ-011, REQ-014, REQ-017, REQ-032, REQ-034, REQ-042

---

#### Test Case: UTP-002-A (publishFoodRequested — provenance validation + Postgres-as-queue enqueue)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `publishFoodRequested()` rejects an invalid `id` or a missing `requestedBy`
(`ValidationError`, no enqueue) and, on valid input, performs the Postgres-as-queue enqueue via
`FetchQueueRouter.enqueue(id, requestedBy)` (INSERT ON CONFLICT on `food_id` + distinct-requester upsert) then
`Postgres.notify('fetch_queued', id)` — keyed on the food `id`, never `fdcId` (REQ-011/014/042).

**Dependency & Mock Registry:**

| Dependency         | Source  | Mock/Stub Strategy                                     | Rationale                       |
| ------------------ | ------- | ------------------------------------------------------ | ------------------------------- |
| `FetchQueueRouter` | MOD-003 | Mock: `enqueue(id, sub)` resolves `{ enqueued: true }` | Prevent real Postgres writes    |
| `Postgres`         | pg      | Mock: `notify('fetch_queued', id)` records args        | Verify NOTIFY without a real DB |

- **Unit Scenario: UTS-002-A1**
    - **Arrange**: `payload = { id: "not-a-ulid", requestedBy: "user_abc" }`
    - **Act**: Call `publishFoodRequested(payload)`
    - **Assert**: Throws `ValidationError("Invalid food id")`; `FetchQueueRouter.enqueue` and `Postgres.notify` NOT called

- **Unit Scenario: UTS-002-A2**
    - **Arrange**: `payload = { id: <valid ULID>, requestedBy: "" }` (missing provenance)
    - **Act**: Call `publishFoodRequested(payload)`
    - **Assert**: Throws `ValidationError("Missing requestedBy provenance")`; nothing enqueued — no enqueue without authenticated provenance (REQ-042)

- **Unit Scenario: UTS-002-A3**
    - **Arrange**: `payload = { id: "01J...ULID", requestedBy: "user_abc" }`; `enqueue` resolves `{ enqueued: true }`
    - **Act**: Call `publishFoodRequested(payload)`
    - **Assert**: Returns `{ enqueued: true }`; `FetchQueueRouter.enqueue` called with `("01J...ULID", "user_abc")`, then `Postgres.notify` called with `("fetch_queued", "01J...ULID")`

- **Unit Scenario: UTS-002-A4**
    - **Arrange**: valid payload; `FetchQueueRouter.enqueue` rejects with a connection error
    - **Act**: Call `publishFoodRequested(payload)`
    - **Assert**: Throws `EnqueueError`; `Postgres.notify` NOT called (caller returns 503)

---

#### Test Case: UTP-002-B (publishFoodBatchRequested — batch size boundary)

**Technique**: Boundary Value Analysis
**Target View**: Internal Data Structures (`ids` array length)
**Description**: Verifies `publishFoodBatchRequested()` enforces the 1–100 batch cap (REQ-045) at the
boundaries and fans out to `publishFoodRequested` per id on valid input.

**Dependency & Mock Registry:**

| Dependency             | Source   | Mock/Stub Strategy        | Rationale                      |
| ---------------------- | -------- | ------------------------- | ------------------------------ |
| `publishFoodRequested` | Internal | Spy: records per-id calls | Verify fan-out without real DB |

- **Unit Scenario: UTS-002-B1**
    - **Arrange**: `payload.ids = []` (length 0, min-1)
    - **Act**: Call `publishFoodBatchRequested(payload)`
    - **Assert**: Throws `ValidationError("ids must be 1–100 items")`; `publishFoodRequested` NOT called

- **Unit Scenario: UTS-002-B2**
    - **Arrange**: `payload.ids = [<one ULID>]`, `requestedBy = "user_abc"` (min valid)
    - **Act**: Call `publishFoodBatchRequested(payload)`
    - **Assert**: Returns `{ enqueued: 1 }`; `publishFoodRequested` called once

- **Unit Scenario: UTS-002-B3**
    - **Arrange**: `payload.ids` = 100 distinct ULIDs (max valid)
    - **Act**: Call `publishFoodBatchRequested(payload)`
    - **Assert**: Returns `{ enqueued: 100 }`; `publishFoodRequested` called 100 times

- **Unit Scenario: UTS-002-B4**
    - **Arrange**: `payload.ids` = 101 distinct ULIDs (max+1)
    - **Act**: Call `publishFoodBatchRequested(payload)`
    - **Assert**: Throws `ValidationError("ids must be 1–100 items")`; `publishFoodRequested` NOT called

---

#### Test Case: UTP-002-C (publishFoodDataReceived — fire-and-forget EventBridge completion)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (fire-and-forget branch)
**Description**: Verifies `publishFoodDataReceived()` carries the food `id` + lifecycle `status` on the
`FoodDataReceived` EventBridge event and **logs but does NOT throw** on a partial PutEvents failure (REQ-034).

**Dependency & Mock Registry:**

| Dependency          | Source             | Mock/Stub Strategy                                                                 | Rationale                |
| ------------------- | ------------------ | ---------------------------------------------------------------------------------- | ------------------------ |
| `EventBridgeClient` | AWS SDK (external) | Mock: `putEvents()` returns `{ FailedEntryCount: 1 }` or `{ FailedEntryCount: 0 }` | Simulate partial failure |
| `MonitoringLogger`  | MOD-011            | Mock: `logRequest()` records args                                                  | Verify log call          |

- **Unit Scenario: UTS-002-C1**
    - **Arrange**: `payload = { id: "01J...ULID", status: "RESOLVED" }`; `putEvents` returns `{ FailedEntryCount: 1, Entries: [{ ErrorCode: "ThrottlingException" }] }`
    - **Act**: Call `publishFoodDataReceived(payload)`
    - **Assert**: Does NOT throw; `MonitoringLogger.logRequest` called with `"eb-publish-fail"` and `{ id: "01J...ULID" }`; the event Detail carries `{ id, status }`, never `fdcId`

- **Unit Scenario: UTS-002-C2**
    - **Arrange**: valid payload; `putEvents` returns `{ FailedEntryCount: 0 }`
    - **Act**: Call `publishFoodDataReceived(payload)`
    - **Assert**: Does NOT throw; `logRequest` NOT called with `"eb-publish-fail"`

---

#### Test Case: UTP-002-D (publishIngestionScheduled — scheduled producer)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `publishIngestionScheduled()` emits the `IngestionScheduled` EventBridge event that
drives change-driven refresh (MOD-020) and returns the event id (REQ-032).

**Dependency & Mock Registry:**

| Dependency          | Source  | Mock/Stub Strategy                                             | Rationale            |
| ------------------- | ------- | -------------------------------------------------------------- | -------------------- |
| `EventBridgeClient` | AWS SDK | Mock: `putEvents()` returns `{ Entries: [{ EventId: "e1" }] }` | Prevent real EB call |

- **Unit Scenario: UTS-002-D1**
    - **Arrange**: `putEvents` returns `{ Entries: [{ EventId: "e1" }] }`
    - **Act**: Call `publishIngestionScheduled()`
    - **Assert**: Returns `{ eventId: "e1" }`; `putEvents` called with `DetailType: "IngestionScheduled"` and a `scheduledAt` ISO-8601 detail (drives MOD-020, REQ-032)

---

### Module: MOD-003 (FetchQueueRouter — Postgres-as-Queue Demand-Weighted Router)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `packages/services/food-service/src/queue/fetch-queue.router.ts`
**REQ trace**: REQ-014, REQ-015, REQ-016, REQ-018, REQ-022, REQ-044

---

#### Test Case: UTP-003-A (enqueue — distinct-requester upsert + capped demand)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View (`enqueue`)
**Description**: Verifies `enqueue(foodId, sub)` records the distinct requester (`fetch_requesters` PK makes
repeats idempotent) then upserts the `fetch_queue` row keyed on `food_id` with `request_count` set to the
**capped distinct-requester count** (PRIORITY_CAP=1) — never a raw `+1` (REQ-014/044).

**Dependency & Mock Registry:**

| Dependency | Source | Mock/Stub Strategy                                              | Rationale              |
| ---------- | ------ | --------------------------------------------------------------- | ---------------------- |
| `Postgres` | pg     | Mock: `query()` records SQL + params, returns `{ rowCount: 1 }` | Prevent real DB writes |

- **Unit Scenario: UTS-003-A1**
    - **Arrange**: `foodId = "01J...ULID"`, `sub = "user_abc"`
    - **Act**: Call `enqueue("01J...ULID", "user_abc")`
    - **Assert**: First `query` is the `fetch_requesters` upsert `INSERT ... ON CONFLICT DO NOTHING` with `(food_id, sub)`; second is the `fetch_queue` upsert keyed `ON CONFLICT (food_id)` setting `request_count = LEAST((SELECT count(*) FROM fetch_requesters WHERE food_id=$1), <cap>)`; returns `{ enqueued: true }`

- **Unit Scenario: UTS-003-A2**
    - **Arrange**: same `foodId`, same `sub` enqueued twice (repeat add by the same requester)
    - **Act**: Call `enqueue` twice
    - **Assert**: The `fetch_requesters` `ON CONFLICT DO NOTHING` makes the second a no-op for demand; `request_count` recomputed from the distinct count stays at 1 — repeat adds by one sub do not inflate demand (REQ-044)

---

#### Test Case: UTP-003-B (leaseNext — demand-weighted + demotion-tier ordering, lease reclaim)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View
**Description**: Verifies `leaseNext(leaseSeconds)` issues the claim `UPDATE ... FOR UPDATE SKIP LOCKED` whose
ordering is `drain_priority_tier ASC, request_count DESC, first_requested ASC` (demand weight + FIFO with the
demotion tier prepended, REQ-015/043) and whose `WHERE` reclaims expired `in_flight` leases
(`lease_expires_at < now()`, REQ-018).

**Dependency & Mock Registry:**

| Dependency | Source | Mock/Stub Strategy                                                        | Rationale                      |
| ---------- | ------ | ------------------------------------------------------------------------- | ------------------------------ |
| `Postgres` | pg     | Mock: `query()` captures SQL; returns `{ rows: [row] }` or `{ rows: [] }` | Inspect claim SQL without a DB |

- **Unit Scenario: UTS-003-B1**
    - **Arrange**: `Postgres.query` returns one leased row
    - **Act**: Call `leaseNext(30)`
    - **Assert**: The SQL sets `status='in_flight'`, `lease_expires_at = now() + 30s`, `attempts = attempts + 1`; the inner `ORDER BY` is `drain_priority_tier(q.food_id) ASC, q.request_count DESC, q.first_requested ASC`; the `WHERE` includes `(q.status='in_flight' AND q.lease_expires_at < now())` (lease reclaim, REQ-018)

- **Unit Scenario: UTS-003-B2**
    - **Arrange**: `Postgres.query` returns `{ rows: [] }` (no eligible row)
    - **Act**: Call `leaseNext(30)`
    - **Assert**: Returns `null`/empty — the worker idles until the next NOTIFY/poll (no row claimed)

---

#### Test Case: UTP-003-C (resolve / tombstone / requeueWithBackoff — disposition SQL)

**Technique**: Equivalence Partitioning + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View + Error Handling Return Codes
**Description**: Verifies the three terminal/retry dispositions: `resolve(foodId)` deletes the row (ack);
`tombstone(foodId, lastError)` sets `status='tombstone'` with `last_error` (DLQ analog, REQ-016/025/027);
`requeueWithBackoff(foodId, _, attempts)` sets `status='pending'` and `last_requested = now() + 2^attempts s`
(exponential backoff, REQ-016).

**Dependency & Mock Registry:**

| Dependency | Source | Mock/Stub Strategy                  | Rationale                    |
| ---------- | ------ | ----------------------------------- | ---------------------------- |
| `Postgres` | pg     | Mock: `query()` captures SQL+params | Inspect each disposition SQL |

- **Unit Scenario: UTS-003-C1**
    - **Arrange**: `foodId = "01J...ULID"`
    - **Act**: Call `resolve("01J...ULID")`
    - **Assert**: Executes `DELETE FROM fetch_queue WHERE food_id = $1` (ack on RESOLVED/UNRESOLVED — no `done` status)

- **Unit Scenario: UTS-003-C2**
    - **Arrange**: `foodId`, `lastError = "no_source_has_item"`
    - **Act**: Call `tombstone(foodId, "no_source_has_item")`
    - **Assert**: Executes `UPDATE fetch_queue SET status='tombstone', last_error=$2 WHERE food_id=$1` (REQ-016/025)

- **Unit Scenario: UTS-003-C3**
    - **Arrange**: `foodId`, `attempts = 3`
    - **Act**: Call `requeueWithBackoff(foodId, 5, 3)`
    - **Assert**: Executes an `UPDATE ... SET status='pending', last_requested = now() + (power(2, attempts) || ' seconds')::interval` — `2^3 = 8s` backoff (REQ-016)

---

#### Test Case: UTP-003-D (acquireWorkerLock — single-instance advisory lock)

**Technique**: Equivalence Partitioning + Error Guessing
**Target View**: Error Handling Return Codes (single-worker guard)
**Description**: Verifies `acquireWorkerLock()` returns the `pg_try_advisory_lock` result so exactly one worker
drains the queue (REQ-022): `true` → this instance drains; `false` → this instance idles.

**Dependency & Mock Registry:**

| Dependency | Source | Mock/Stub Strategy                                                      | Rationale                |
| ---------- | ------ | ----------------------------------------------------------------------- | ------------------------ |
| `Postgres` | pg     | Mock: `query("SELECT pg_try_advisory_lock($1)")` returns `true`/`false` | Drive both lock outcomes |

- **Unit Scenario: UTS-003-D1**
    - **Arrange**: `pg_try_advisory_lock` returns `true`
    - **Act**: Call `acquireWorkerLock()`
    - **Assert**: Returns `true` (this instance holds the drain lock)

- **Unit Scenario: UTS-003-D2**
    - **Arrange**: `pg_try_advisory_lock` returns `false` (held elsewhere)
    - **Act**: Call `acquireWorkerLock()`
    - **Assert**: Returns `false` — this instance idles; the single holder drains (REQ-022)

---

### Module: MOD-004 (FoodConsumerService — Fan-Out / Merge Worker)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `packages/services/food-service/src/worker/food-consumer.service.ts` (Fargate consumer worker — single instance, advisory lock)
**REQ trace**: REQ-016, REQ-018, REQ-025..027, REQ-050, REQ-MRG-1, REQ-042

---

#### Test Case: UTP-004-A (processRow — provenance gate + per-source window-pause defer)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (CheckingProvenance → FanningOut → DeferringLease)
**Description**: Verifies `processRow()` first validates async-producer provenance (MOD-014) and, when a wired
adapter's per-source rolling window is paused (≥90%) or full, **defers the row** via `requeueWithBackoff` and
does NOT call the adapter — the source contributes nothing this pass and the row is re-claimed later
(REQ-019/REQ-018/REQ-042).

**Dependency & Mock Registry:**

| Dependency              | Source  | Mock/Stub Strategy                                                         | Rationale                                   |
| ----------------------- | ------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| `AsyncProducerAuthz`    | MOD-014 | Mock: `assertEnqueueProvenance()` resolves                                 | Provenance gate must pass before fetch      |
| `SourceAdapterRegistry` | MOD-015 | Mock: `adapters()` returns `[usdaAdapter]`                                 | Iterate the wired registry                  |
| `RollingWindowLimiter`  | MOD-005 | Mock: `shouldPauseDraining('usda')` → `true`; `getWaitTime('usda')` → `25` | Drive the paused-window defer branch        |
| `FetchQueueRouter`      | MOD-003 | Spy: `requeueWithBackoff()` records args                                   | Verify deferral, not a fetch                |
| `usdaAdapter`           | MOD-008 | Mock: `searchByName` — assert NOT called                                   | Verify the source is not called when paused |

- **Unit Scenario: UTS-004-A1**
    - **Arrange**: `row = { food_id: "01J...ULID", attempts: 0, requested_by: "user_abc" }`; `getName` → `"apple"`; `shouldPauseDraining('usda')` returns `true`; `getWaitTime('usda')` returns `25`
    - **Act**: Call `processRow(row)`
    - **Assert**: `assertEnqueueProvenance` called first; `RollingWindowLimiter.checkAndRecordCall` and `usdaAdapter.searchByName` NOT called; `FetchQueueRouter.requeueWithBackoff` called with `("01J...ULID", 30, 0)` (waitTime 25 + 5); the row stays `pending` for later re-claim (REQ-019)

---

#### Test Case: UTP-004-B (processRow — source error branches: 429 / 5xx / no-source / all-errored)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View (CATCH branches) + Error Handling Return Codes
**Description**: Verifies `processRow()` source-outcome branches against the lifecycle enum: a source `429`
marks the window full + backs off (REQ-026); no candidates and no failed sources → `NOT_FOUND` tombstone
(REQ-025); all sources errored after the retry budget (attempts ≥ 5) → `FAILED` tombstone (REQ-027); below the
budget → exponential backoff (REQ-016). Status is written via the DAO seam, never the old `updateFetchStatus`.

**Dependency & Mock Registry:**

| Dependency              | Source  | Mock/Stub Strategy                                                                | Rationale                          |
| ----------------------- | ------- | --------------------------------------------------------------------------------- | ---------------------------------- |
| `AsyncProducerAuthz`    | MOD-014 | Mock: provenance passes                                                           | Reach the fan-out                  |
| `SourceAdapterRegistry` | MOD-015 | Mock: `adapters()` returns `[usdaAdapter]`                                        | One wired adapter                  |
| `RollingWindowLimiter`  | MOD-005 | Mock: `shouldPauseDraining` → `false`; `checkAndRecordCall` → `{ allowed: true }` | Window admits the call             |
| `usdaAdapter`           | MOD-008 | Mock: `searchByName` throws `SourceApiError(status)` or returns `[]`              | Simulate each source outcome       |
| `FoodDaoRepository`     | MOD-016 | Spy: `updateStatus(id, status, tombstonedAt)` records args                        | Verify lifecycle write via the DAO |
| `FetchQueueRouter`      | MOD-003 | Spy: `tombstone` / `requeueWithBackoff` / `markWindowFull` paths                  | Verify queue disposition           |
| `EnqueueEmitter`        | MOD-002 | Spy: `publishFoodDataReceived()` records args                                     | Verify completion fan-out          |

- **Unit Scenario: UTS-004-B1**
    - **Arrange**: `usdaAdapter.searchByName` throws `SourceApiError(status=429)`; `row.attempts = 0`
    - **Act**: Call `processRow(row)`
    - **Assert**: `RollingWindowLimiter.markWindowFull('usda')` called; `FetchQueueRouter.requeueWithBackoff(foodId, 60, 0)` called; the row is re-queued (not dropped) — back off that source rather than reset the window (REQ-026)

- **Unit Scenario: UTS-004-B2**
    - **Arrange**: `usdaAdapter.searchByName` returns `[]` (no hits) and no source errored
    - **Act**: Call `processRow(row)`
    - **Assert**: `FoodDaoRepository.updateStatus(foodId, "NOT_FOUND", <tombstonedAt>)` called (30-day TTL); `FetchQueueRouter.tombstone(foodId, "no_source_has_item")` called; `publishFoodDataReceived({ id: foodId, status: "NOT_FOUND" })` emitted — no retry (REQ-025)

- **Unit Scenario: UTS-004-B3**
    - **Arrange**: `usdaAdapter.searchByName` throws `SourceApiError(status=503)`; `row.attempts = 5` (budget exhausted)
    - **Act**: Call `processRow(row)`
    - **Assert**: `FoodDaoRepository.updateStatus(foodId, "FAILED", <tombstonedAt>)` called; `FetchQueueRouter.tombstone(foodId, "all_sources_errored")` called; `publishFoodDataReceived({ id: foodId, status: "FAILED" })` emitted (REQ-027)

- **Unit Scenario: UTS-004-B4**
    - **Arrange**: `usdaAdapter.searchByName` throws `SourceApiError(status=503)`; `row.attempts = 2` (under budget)
    - **Act**: Call `processRow(row)`
    - **Assert**: `FetchQueueRouter.requeueWithBackoff(foodId, 5, 2)` called; `updateStatus(FAILED)` NOT called — retry under the budget (REQ-016)

---

#### Test Case: UTP-004-C (processRow — successful merge → persist golden record → RESOLVED/UNRESOLVED)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (Merging → Persisting → Resolving)
**Description**: Verifies the success path: collected candidates are pre-merge-deduped, merged by MOD-017,
persisted atomically with provenance via `upsertGoldenRecord` (MOD-016), the `fetch_queue` row acked
(`resolve`), and `FoodDataReceived` emitted with the merge outcome (`RESOLVED` or `UNRESOLVED`)
(REQ-050/REQ-MRG-1). A reject-not-store candidate (MOD-021 `ValidationError`) is dropped without failing the
food.

**Dependency & Mock Registry:**

| Dependency                | Source  | Mock/Stub Strategy                                                                                                  | Rationale                          |
| ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `usdaAdapter`             | MOD-008 | Mock: `searchByName` → 1 hit; `fetchByKey` → a `CanonicalCandidate` (or throws `ValidationError` for the drop case) | Provide candidates                 |
| `GoldenRecordMergeEngine` | MOD-017 | Mock: `merge(candidates)` returns `{ goldenRecord, outcome }`                                                       | Isolate merge from the worker      |
| `FoodDaoRepository`       | MOD-016 | Spy: `upsertGoldenRecord(foodId, golden, outcome)` records args                                                     | Verify atomic persist + provenance |
| `FetchQueueRouter`        | MOD-003 | Spy: `resolve(foodId)` records args                                                                                 | Verify the row is acked            |
| `EnqueueEmitter`          | MOD-002 | Spy: `publishFoodDataReceived()` records args                                                                       | Verify completion fan-out          |

- **Unit Scenario: UTS-004-C1**
    - **Arrange**: one valid `CanonicalCandidate`; `merge` returns `{ goldenRecord, outcome: "RESOLVED" }`
    - **Act**: Call `processRow(row)`
    - **Assert**: `FoodDaoRepository.upsertGoldenRecord(foodId, goldenRecord, "RESOLVED")` called; `FetchQueueRouter.resolve(foodId)` called (row cleared); `publishFoodDataReceived({ id: foodId, status: "RESOLVED" })` emitted; `MonitoringLogger.incrementMetric("consumer.resolved", 1)`

- **Unit Scenario: UTS-004-C2**
    - **Arrange**: two non-collapsible candidates; `merge` returns `{ goldenRecord: partial, outcome: "UNRESOLVED", candidateSet }`
    - **Act**: Call `processRow(row)`
    - **Assert**: `upsertGoldenRecord(foodId, partial, "UNRESOLVED")` called; the food becomes `UNRESOLVED` (surfaced via MOD-018 `/candidates`); the row is acked, not tombstoned (REQ-048)

- **Unit Scenario: UTS-004-C3**
    - **Arrange**: two hits; `fetchByKey` for the first throws `ValidationError` (MOD-021 reject-not-store), the second returns a valid candidate; `merge` returns `{ outcome: "RESOLVED" }`
    - **Act**: Call `processRow(row)`
    - **Assert**: The invalid candidate is dropped (not stored); the food still resolves from the remaining valid candidate (REQ-055); `upsertGoldenRecord(..., "RESOLVED")` called

---

### Module: MOD-005 (RollingWindowLimiter — Per-Source Atomic Rolling 60-Minute Window)

**Parent Architecture Modules**: ARCH-005 [CROSS-CUTTING]
**Target Source File(s)**: `packages/services/food-service/src/worker/rolling-window.limiter.ts`
**REQ trace**: REQ-019, REQ-020, REQ-021, REQ-026

---

#### Test Case: UTP-005-A (checkAndRecordCall / shouldPauseDraining — per-source trailing window, 90% pause, hard cap)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View (atomic count-and-record over the trailing 60 minutes, keyed by `source`)
**Description**: Verifies the **per-source** rolling-window count-and-record at its boundaries against the
USDA caps (hardCap 1000, pauseThreshold 900): admits below the pause threshold; pauses at 90%; the atomic
`source_call_log` insert is refused at the hard cap so a source's window can never be overshot
(REQ-019/020). The limiter is now keyed by `source`, not a single global USDA window.

**Dependency & Mock Registry:**

| Dependency      | Source                                                          | Mock/Stub Strategy                                                                                                                         | Rationale                                 |
| --------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| `SourceCallLog` | Postgres `source_call_log` (default; deferred Redis sorted-set) | Mock: executes the atomic count+insert in-process (`INSERT ... WHERE count < hardCap RETURNING`) at a controlled trailing count per source | Isolate from real call-log infrastructure |

- **Unit Scenario: UTS-005-A1**
    - **Arrange**: `SOURCE_CAPS.usda = { hardCap: 1000, pauseThreshold: 900 }`; trailing-60-min count for `'usda'` is `0`
    - **Act**: Call `checkAndRecordCall('usda')`
    - **Assert**: Returns `{ allowed: true, windowCount: 1 }`; a timestamp row is recorded for source `'usda'` (boundary: empty window admits)

- **Unit Scenario: UTS-005-A2**
    - **Arrange**: trailing count for `'usda'` is `899` (max-1, under pause)
    - **Act**: Call `checkAndRecordCall('usda')`
    - **Assert**: Returns `{ allowed: true, windowCount: 900 }`; the call is recorded

- **Unit Scenario: UTS-005-A3**
    - **Arrange**: trailing count for `'usda'` is `900` (at the 90% pause threshold)
    - **Act**: Call `shouldPauseDraining('usda')`
    - **Assert**: Returns `true` — the worker pauses draining that source at 90% before the hard cap (REQ-019)

- **Unit Scenario: UTS-005-A4**
    - **Arrange**: trailing count for `'usda'` is `1000` (the call would be the 1,001st)
    - **Act**: Call `checkAndRecordCall('usda')`
    - **Assert**: Returns `{ allowed: false, windowCount: 1000 }`; no timestamp recorded — the hard cap of ≤1,000/60min is never breached for that source (REQ-019/020)

- **Unit Scenario: UTS-005-A5**
    - **Arrange**: a second source `'opf'` (hypothetical) has its own cap entry; `'usda'` is at `1000`, `'opf'` at `0`
    - **Act**: Call `checkAndRecordCall('opf')`
    - **Assert**: Returns `{ allowed: true }` — windows are per-source; one source being full does not block another (additive per-source caps)

---

#### Test Case: UTP-005-B (checkAndRecordCall — store unavailability fails closed)

**Technique**: Error Guessing + Statement & Branch Coverage
**Target View**: Error Handling Return Codes
**Description**: Verifies the count-and-record throws `RateLimitWindowFullError` when the per-source call-log
store is unavailable or times out — the limiter **fails closed** (no source call proceeds) rather than
assuming the window is empty; the worker re-queues the row (REQ-020).

**Dependency & Mock Registry:**

| Dependency      | Source                     | Mock/Stub Strategy                                                      | Rationale                     |
| --------------- | -------------------------- | ----------------------------------------------------------------------- | ----------------------------- |
| `SourceCallLog` | Postgres `source_call_log` | Mock: count-and-record throws `ConnectionRefusedError` / `TimeoutError` | Simulate store unavailability |

- **Unit Scenario: UTS-005-B1**
    - **Arrange**: store throws `ConnectionRefusedError`
    - **Act**: Call `checkAndRecordCall('usda')`
    - **Assert**: Throws `RateLimitWindowFullError`; the worker treats this as not-allowed and re-queues the row (fail closed)

- **Unit Scenario: UTS-005-B2**
    - **Arrange**: store throws `TimeoutError` after 100ms
    - **Act**: Call `checkAndRecordCall('usda')`
    - **Assert**: Throws `RateLimitWindowFullError`

---

#### Test Case: UTP-005-C (state transitions — WindowOpen ↔ DrainPaused/WindowFull as calls age out)

**Technique**: State Transition Testing
**Target View**: State Machine View
**Description**: Verifies the per-source window state machine: `WindowOpen → DrainPaused` at the 90% threshold,
`WindowOpen → WindowFull` at the hard cap, and the reverse transitions as earlier calls age out of the
trailing 60 minutes (REQ-019/021).

**Dependency & Mock Registry:**

| Dependency      | Source                     | Mock/Stub Strategy                                            | Rationale                                 |
| --------------- | -------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| `SourceCallLog` | Postgres `source_call_log` | Mock: returns controlled trailing counts to drive transitions | Drive the state machine deterministically |

- **Unit Scenario: UTS-005-C1**
    - **Arrange**: trailing count for `'usda'` is `500`
    - **Act**: Call `checkAndRecordCall('usda')`
    - **Assert**: Returns `{ allowed: true, windowCount: 501 }` (state: WindowOpen)

- **Unit Scenario: UTS-005-C2**
    - **Arrange**: trailing count rises to `900`
    - **Act**: Call `shouldPauseDraining('usda')`
    - **Assert**: Returns `true` (transition: WindowOpen → DrainPaused at 90%)

- **Unit Scenario: UTS-005-C3**
    - **Arrange**: after the window was paused, enough calls age out so the trailing count is now `850`
    - **Act**: Call `shouldPauseDraining('usda')` then `checkAndRecordCall('usda')`
    - **Assert**: `shouldPauseDraining` returns `false` and `checkAndRecordCall` returns `{ allowed: true, windowCount: 851 }` (transition: DrainPaused → WindowOpen — the worker resumes draining, REQ-021)

---

### Module: MOD-006 (FoodPostgresRepository — Canonical Normalized Store)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `packages/services/food-service/src/database/schema/*.ts` + low-level query builders
**REQ trace**: REQ-028, REQ-029, REQ-008, REQ-CN-007

---

#### Test Case: UTP-006-A (findGoldenRecord — assembly across normalized tables, null on no row)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `findGoldenRecord(id)` returns `null` when the `food` row is absent and otherwise
assembles scalars + nutrients + portions + provenance into a `GoldenRecord` keyed on the internal `id` (no
`fdcId`, no JSONB-nutrient column) (REQ-028/CN-007).

**Dependency & Mock Registry:**

| Dependency | Source     | Mock/Stub Strategy                                                                                                      | Rationale                   |
| ---------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `query`    | Drizzle/pg | Mock: returns `null` for `food`, or a `food` row + joined `food_nutrients`/`food_portions`/`food_field_provenance` rows | Prevent real DB connections |

- **Unit Scenario: UTS-006-A1**
    - **Arrange**: `food` lookup for `id` returns `null`
    - **Act**: Call `findGoldenRecord("01J...ULID")`
    - **Assert**: Returns `null`; no nutrient/portion/provenance queries issued

- **Unit Scenario: UTS-006-A2**
    - **Arrange**: `food` returns `{ id: "01J...ULID", name: "Apple", description: "Raw apple", kind: "generic", status: "RESOLVED" }`; `food_nutrients` returns `[{ nutrient_id, amount: 0.3, basis: "per_100g", source_id }]` joined to `nutrient`; `food_portions` returns one row; `food_field_provenance` returns `[{ field: "name", source_id }]`
    - **Act**: Call `findGoldenRecord("01J...ULID")`
    - **Assert**: Returns a `GoldenRecord` with `id`, `name`, `kind`, `nutrients[0].amount = 0.3` / `basis = "per_100g"`, `portions`, and `provenance` mapping `field → source` — assembled from normalized tables, no JSONB-nutrient blob, no `fetch_status`

---

#### Test Case: UTP-006-B (updateStatus — lifecycle enum guard)

**Technique**: Equivalence Partitioning
**Target View**: Internal Data Structures (`food_status` enum)
**Description**: Verifies `updateStatus(id, status, tombstonedAt?)` rejects any value outside the lifecycle enum
`PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED` (`ValidationError`, no query) and executes the UPDATE for valid
values — the old `fetch_status` values (`fetched`/`stale`) are gone (REQ-028).

**Dependency & Mock Registry:**

| Dependency | Source     | Mock/Stub Strategy              | Rationale              |
| ---------- | ---------- | ------------------------------- | ---------------------- |
| `query`    | Drizzle/pg | Mock: returns `{ rowCount: 1 }` | Prevent real DB writes |

- **Unit Scenario: UTS-006-B1**
    - **Arrange**: `status = "fetched"` (a removed legacy value)
    - **Act**: Call `updateStatus("01J...ULID", "fetched")`
    - **Assert**: Throws `ValidationError`; `query` NOT called — `fetched` is no longer a valid lifecycle value

- **Unit Scenario: UTS-006-B2**
    - **Arrange**: `status = "NOT_FOUND"`, `tombstonedAt = "2026-06-22T00:00:00Z"`
    - **Act**: Call `updateStatus("01J...ULID", "NOT_FOUND", "2026-06-22T00:00:00Z")`
    - **Assert**: `query` called with `UPDATE food SET status=$1, tombstoned_at=$3, updated_at=now() WHERE id=$2` and params `["NOT_FOUND", "01J...ULID", "2026-06-22T00:00:00Z"]`

- **Unit Scenario: UTS-006-B3**
    - **Arrange**: `status = "RESOLVED"`
    - **Act**: Call `updateStatus("01J...ULID", "RESOLVED")`
    - **Assert**: `query` called; returns `{ success: true }`

---

#### Test Case: UTP-006-C (findByExternalKey / searchFoods — crosswalk + pg_trgm, id-keyed)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `findByExternalKey(source, externalKey)` resolves to the internal `id` via the
`UNIQUE(source, external_key)` crosswalk (barcode/external-key lookup, REQ-008) and `searchFoods(query)` runs
the local `pg_trgm` similarity query returning `{ id, name, score }` — never a source call. **`external_key`
(not `fdcId`) is the crosswalk term outside MOD-008.**

**Dependency & Mock Registry:**

| Dependency | Source     | Mock/Stub Strategy                                          | Rationale             |
| ---------- | ---------- | ----------------------------------------------------------- | --------------------- |
| `query`    | Drizzle/pg | Mock: returns a crosswalk row or a ranked search result set | Prevent real DB calls |

- **Unit Scenario: UTS-006-C1**
    - **Arrange**: `query` returns `{ id: "01J...ULID" }` for `source='usda', external_key='534358'`
    - **Act**: Call `findByExternalKey("usda", "534358")`
    - **Assert**: Returns `{ id: "01J...ULID" }`; SQL targets `food_sources WHERE source=$1 AND external_key=$2` (the crosswalk resolves a source key to the internal `id`)

- **Unit Scenario: UTS-006-C2**
    - **Arrange**: `query` returns `[{ id, name: "Apple", score: 0.82 }]` for `searchFoods("appl")`
    - **Act**: Call `searchFoods("appl")`
    - **Assert**: Returns `[{ id, name, score }]`; SQL uses `similarity(name, $1)` / `name % $1` (pg_trgm) ordered by score — local store only (REQ-008/010)

---

#### Test Case: UTP-006-D (upsertCrosswalk — UNIQUE(source, external_key) conflict handling)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View + Error Handling Return Codes
**Description**: Verifies `upsertCrosswalk(foodId, source, externalKey, itemVersion)` issues the
`INSERT ... ON CONFLICT (source, external_key) DO UPDATE SET item_version=..., fetched_at=now()` and returns
the crosswalk row id (the `source_id` later referenced by per-value provenance). **No payload is stored.**

**Dependency & Mock Registry:**

| Dependency | Source     | Mock/Stub Strategy              | Rationale          |
| ---------- | ---------- | ------------------------------- | ------------------ |
| `query`    | Drizzle/pg | Mock: returns `{ id: "src-1" }` | Inspect upsert SQL |

- **Unit Scenario: UTS-006-D1**
    - **Arrange**: `foodId`, `source='usda'`, `externalKey='534358'`, `itemVersion='2024-10-31'`
    - **Act**: Call `upsertCrosswalk(foodId, "usda", "534358", "2024-10-31")`
    - **Assert**: SQL is `INSERT INTO food_sources (...) VALUES (...) ON CONFLICT (source, external_key) DO UPDATE SET item_version=$5, fetched_at=now() RETURNING id`; returns `{ sourceId: "src-1" }`; no nutrient/payload column written

---

### Module: MOD-007 (FoodCacheService — Optional Hot Cache)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `packages/services/food-service/src/cache/food-cache.service.ts`
**REQ trace**: REQ-030, REQ-001

> The cache is **optional** (lean-launch default is the Postgres canonical store; Redis read-through is a
> deferred variant). It is re-keyed `food:{fdcId}` → `food:{id}` and the old `pending_fetch` set is removed —
> **pending-fetch dedup is the `fetch_queue` ON CONFLICT row (MOD-003), not a cache set**. There is therefore
> no `isPending`/`markPending`/`clearPending` UTP.

---

#### Test Case: UTP-007-A (get — hit, miss, JSON parse error)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `get(id)` returns a parsed `GoldenRecord` on hit (key `food:{id}`), `null` on miss,
and `null` (with a logged error) on a JSON parse failure (REQ-030). Keyed on the internal ULID `id`.

**Dependency & Mock Registry:**

| Dependency         | Source                                              | Mock/Stub Strategy                                             | Rationale                      |
| ------------------ | --------------------------------------------------- | -------------------------------------------------------------- | ------------------------------ |
| `Cache`            | in-process LRU / Postgres (default; deferred Redis) | Mock: `get()` returns `null`, a JSON string, or malformed text | Prevent real cache-store calls |
| `MonitoringLogger` | MOD-011                                             | Mock: `logError()` records args                                | Verify error logging           |

- **Unit Scenario: UTS-007-A1**
    - **Arrange**: `Cache.get("food:01J...ULID")` returns `null`
    - **Act**: Call `get("01J...ULID")`
    - **Assert**: Returns `null`

- **Unit Scenario: UTS-007-A2**
    - **Arrange**: `Cache.get("food:01J...ULID")` returns `'{"id":"01J...ULID","name":"Apple"}'`
    - **Act**: Call `get("01J...ULID")`
    - **Assert**: Returns `{ id: "01J...ULID", name: "Apple" }` (parsed `GoldenRecord`, id-keyed)

- **Unit Scenario: UTS-007-A3**
    - **Arrange**: `Cache.get` returns `"INVALID_JSON{"`
    - **Act**: Call `get("01J...ULID")`
    - **Assert**: Returns `null`; `MonitoringLogger.logError` called (cache treated as a miss; canonical store consulted)

---

#### Test Case: UTP-007-B (set / invalidate — key schema, TTL, invalidation)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `set(id, data, ttl)` writes the `food:{id}` key with a JSON value and 24h default TTL
and `invalidate(id)` deletes that key (called by MOD-004 after a merge upsert) (REQ-030).

**Dependency & Mock Registry:**

| Dependency | Source                                              | Mock/Stub Strategy                     | Rationale               |
| ---------- | --------------------------------------------------- | -------------------------------------- | ----------------------- |
| `Cache`    | in-process LRU / Postgres (default; deferred Redis) | Mock: `set()`/`del()` record call args | Verify key/TTL contract |

- **Unit Scenario: UTS-007-B1**
    - **Arrange**: `id = "01J...ULID"`, `data = { id, name: "Apple" }`
    - **Act**: Call `set("01J...ULID", data)`
    - **Assert**: `Cache.set` called with `("food:01J...ULID", JSON.stringify(data), "EX", 86400)` (24h default; deferred Redis variant maps to `SET ... EX`)

- **Unit Scenario: UTS-007-B2**
    - **Arrange**: `id = "01J...ULID"`
    - **Act**: Call `invalidate("01J...ULID")`
    - **Assert**: `Cache.del("food:01J...ULID")` called (post-merge invalidation by MOD-004)

---

### Module: MOD-008 (UsdaApiClient — USDA Source Adapter — the _only_ `fdcId` boundary)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `packages/clients/usda/src/usda-api.client.ts` (`@kitchensink/usda-client`)
**REQ trace**: REQ-023, REQ-024, REQ-046, REQ-IF-005, REQ-IF-012

> **This is the ONLY module in the unit-test plan where `fdcId` and USDA-native terms appear** (REQ-046). It
> implements `FoodSourceAdapter` (`source='usda'`, `searchByName`, `fetchByKey`); `mapToCanonical` performs the
> inbound **`fdcId → external_key`** mapping. Everything past this boundary is keyed on `external_key`.

---

#### Test Case: UTP-008-A (searchByName — fdcId surfaced as externalKey)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `searchByName(name)` enforces HTTPS (MOD-021 `assertHttps`), calls USDA
`/foods/search`, and maps each hit to a `SourceCandidate` carrying `source: 'usda'` and
`externalKey: String(fdcId)` — the `fdcId → external_key` confinement (REQ-046/IF-005).

**Dependency & Mock Registry:**

| Dependency              | Source       | Mock/Stub Strategy                                                                               | Rationale                            |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------ |
| `HTTP.GET`              | undici/fetch | Mock: returns `{ status: 200, body: '{"foods":[{"fdcId":534358,"description":"Apple, raw"}]}' }` | Prevent real HTTP calls              |
| `SecretManager`         | MOD-010      | Mock: `getSourceApiKey('usda')` returns `"test-api-key"`                                         | Prevent Secrets Manager call         |
| `AdapterInputValidator` | MOD-021      | Mock: `assertHttps()` resolves                                                                   | Isolate transport-security assertion |

- **Unit Scenario: UTS-008-A1**
    - **Arrange**: `HTTP.GET` returns one USDA hit `{ fdcId: 534358, description: "Apple, raw" }`
    - **Act**: Call `searchByName("apple")`
    - **Assert**: `assertHttps(USDA_BASE_URL)` called; returns `[{ source: "usda", externalKey: "534358", name: "Apple, raw" }]` — the `fdcId` is surfaced as a string `externalKey`, never leaked as `fdcId` to the caller

---

#### Test Case: UTP-008-B (fetchByKey + mapToCanonical — fdcId→external_key + validate)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (`fetchByKey` → `mapToCanonical` → MOD-021)
**Description**: Verifies `fetchByKey(externalKey)` fetches one item by its USDA key, maps it to a
source-agnostic `CanonicalCandidate` (USDA `dataType → kind`, nutrients `per_100g`, `publicationDate →
itemVersion`), and passes it through `AdapterInputValidator.validateAndSanitize` (reject-not-store). The
inbound `externalKey` is the `fdcId` — the only place it is named (REQ-046/024).

**Dependency & Mock Registry:**

| Dependency              | Source       | Mock/Stub Strategy                                                                                            | Rationale            |
| ----------------------- | ------------ | ------------------------------------------------------------------------------------------------------------- | -------------------- |
| `HTTP.GET`              | undici/fetch | Mock: returns a USDA `/food/{fdcId}` item with `dataType`, `foodNutrients`, `foodPortions`, `publicationDate` | Prevent real HTTP    |
| `SecretManager`         | MOD-010      | Mock: `getSourceApiKey('usda')` → `"test-api-key"`                                                            | Prevent Secrets call |
| `AdapterInputValidator` | MOD-021      | Mock: `validateAndSanitize(mapped)` returns the cleaned candidate (or throws for the reject case)             | Isolate validation   |

- **Unit Scenario: UTS-008-B1**
    - **Arrange**: `HTTP.GET("/food/534358")` returns `{ fdcId: 534358, description: "Apple, raw", dataType: "Branded", brandOwner: "Acme", foodNutrients: [{ nutrient: { number: "203", name: "Protein", unitName: "g" }, amount: 0.3 }], foodPortions: [{ modifier: "1 cup", gramWeight: 125 }], publicationDate: "2024-10-31" }`
    - **Act**: Call `fetchByKey("534358")`
    - **Assert**: `mapToCanonical` produces `{ source: "usda", externalKey: "534358", name: "Apple, raw", kind: "branded", brandOwner: "Acme", nutrients: [{ code: "203", ..., basis: "per_100g" }], portions: [{ label: "1 cup", gramWeight: 125 }], itemVersion: "2024-10-31" }`; `validateAndSanitize` is called with this mapping and its result returned — `fdcId` appears only as the inbound key, mapped to `externalKey`

- **Unit Scenario: UTS-008-B2**
    - **Arrange**: as B1 but `dataType: "Foundation"` (not `"Branded"`)
    - **Act**: Call `fetchByKey("534358")`
    - **Assert**: `kind` maps to `"generic"` (USDA data-type → canonical kind, REQ-IDN-3)

---

#### Test Case: UTP-008-C (classifyErrors + fetchManyByKeys cap — HTTP status branches & batch boundary)

**Technique**: Equivalence Partitioning + Boundary Value Analysis + Error Guessing
**Target View**: Error Handling Return Codes + Internal Data Structures (`MAX_BATCH_SIZE = 20`)
**Description**: Verifies `classifyErrors()` throws the correct `SourceApiError` per HTTP status (401/404/429/5xx)
and `fetchManyByKeys()` rejects a batch over USDA's 20-key cap before any HTTP call (REQ-023/024).

**Dependency & Mock Registry:**

| Dependency      | Source       | Mock/Stub Strategy                                 | Rationale               |
| --------------- | ------------ | -------------------------------------------------- | ----------------------- |
| `HTTP.GET/POST` | undici/fetch | Mock: returns varying `{ status }`                 | Simulate USDA responses |
| `SecretManager` | MOD-010      | Mock: `getSourceApiKey('usda')` → `"test-api-key"` | Prevent Secrets call    |

- **Unit Scenario: UTS-008-C1**
    - **Arrange**: `HTTP.GET` returns `{ status: 401 }`
    - **Act**: Call `fetchByKey("534358")`
    - **Assert**: Throws `SourceApiError` with `statusCode = 401` and message containing "Invalid USDA API key"

- **Unit Scenario: UTS-008-C2**
    - **Arrange**: `HTTP.GET` returns `{ status: 429 }`
    - **Act**: Call `fetchByKey("534358")`
    - **Assert**: Throws `SourceApiError` with `statusCode = 429` (worker marks window full + backs off, REQ-026)

- **Unit Scenario: UTS-008-C3**
    - **Arrange**: `HTTP.GET` returns `{ status: 404 }`
    - **Act**: Call `fetchByKey("534358")`
    - **Assert**: Throws `SourceApiError` with `statusCode = 404` (this source contributes nothing)

- **Unit Scenario: UTS-008-C4**
    - **Arrange**: `externalKeys` of length 20 (max valid)
    - **Act**: Call `fetchManyByKeys(externalKeys)`
    - **Assert**: `HTTP.POST` called once; does NOT throw (boundary: 20-key batch = 1 windowed call, REQ-023)

- **Unit Scenario: UTS-008-C5**
    - **Arrange**: `externalKeys` of length 21 (max+1)
    - **Act**: Call `fetchManyByKeys(externalKeys)`
    - **Assert**: Throws `SourceApiError("Batch exceeds USDA cap of 20", 400)`; `HTTP.POST` NOT called

---

### Module: MOD-009 (WebSocketNotifier — Real-Time Notification — deferred)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `packages/services/food-service/src/ws/websocket-notifier.handler.ts`
**REQ trace**: REQ-034, REQ-041, REQ-049

> ARCH-009 is launch-deferred (US-9); scaffolded only. Re-keyed `fdcId → id`; recipients resolved from the
> authenticated subscription set (`fetch_requesters`, `sub → id`).

---

#### Test Case: UTP-009-A (notifyClients — per-recipient delivery, GoneException cleanup)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (Connected → Disconnected via GoneException)
**Description**: Verifies `notifyClients(id, status)` delivers only to connections whose authenticated `sub`
requested this food `id` (via `fetch_requesters`, REQ-041), deletes stale connections on `GoneException`, logs
but continues on other errors, and returns the notified count. The message carries the food `id`, never `fdcId`
(REQ-034).

**Dependency & Mock Registry:**

| Dependency                   | Source      | Mock/Stub Strategy                                                                     | Rationale                |
| ---------------------------- | ----------- | -------------------------------------------------------------------------------------- | ------------------------ |
| `FetchRequesters`            | MOD-013/003 | Mock: `subsFor(id)` returns the subscribing `sub`s                                     | Per-recipient resolution |
| `ConnectionStore`            | DynamoDB    | Mock: `connectionsForSubs()` returns connection ids; `deleteConnection()` records args | Prevent real DynamoDB    |
| `ApiGatewayManagementClient` | AWS SDK     | Mock: `postToConnection()` succeeds, throws `GoneException`, or throws generic `Error` | Simulate WS states       |
| `MonitoringLogger`           | MOD-011     | Mock: `logRequest()` records args                                                      | Verify error logging     |

- **Unit Scenario: UTS-009-A1**
    - **Arrange**: `subsFor("01J...ULID")` → `["user_a"]`; `connectionsForSubs(["user_a"])` → `["conn-1"]`; `postToConnection` succeeds
    - **Act**: Call `notifyClients("01J...ULID", "RESOLVED")`
    - **Assert**: Returns `1`; `postToConnection` called with `Data` containing `{ type: "food_ready", id: "01J...ULID", status: "RESOLVED" }` (id, not `fdcId`); `deleteConnection` NOT called

- **Unit Scenario: UTS-009-A2**
    - **Arrange**: `connectionsForSubs` → `["conn-1"]`; `postToConnection` throws `GoneException`
    - **Act**: Call `notifyClients("01J...ULID", "RESOLVED")`
    - **Assert**: Returns `0`; `ConnectionStore.deleteConnection("conn-1")` called (stale cleanup); no `ws-notify-fail` log

- **Unit Scenario: UTS-009-A3**
    - **Arrange**: `connectionsForSubs` → `["conn-1"]`; `postToConnection` throws generic `Error("network")`
    - **Act**: Call `notifyClients("01J...ULID", "RESOLVED")`
    - **Assert**: Returns `0`; `deleteConnection` NOT called; `MonitoringLogger.logRequest("ws-notify-fail", { connectionId: "conn-1", id: "01J...ULID" }, 0)` called

- **Unit Scenario: UTS-009-A4**
    - **Arrange**: `subsFor("01J...ULID")` → `[]` (no subscribers)
    - **Act**: Call `notifyClients("01J...ULID", "RESOLVED")`
    - **Assert**: Returns `0`; `postToConnection` NOT called

---

#### Test Case: UTP-009-B (onConnect / enforceTokenExpiry — subscription persist + mid-connection expiry close)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View + State Machine View (Connected → Disconnected on `exp`)
**Description**: Verifies `onConnect()` persists the subscription with a `tokenExp` and `enforceTokenExpiry()`
server-side closes the connection once `exp` passes mid-connection (REQ-049b), but leaves a still-valid
connection open (boundary).

**Dependency & Mock Registry:**

| Dependency                   | Source   | Mock/Stub Strategy                                         | Rationale                 |
| ---------------------------- | -------- | ---------------------------------------------------------- | ------------------------- |
| `ConnectionStore`            | DynamoDB | Mock: `putConnection()` / `deleteConnection()` record args | Prevent real DynamoDB     |
| `ApiGatewayManagementClient` | AWS SDK  | Mock: `deleteConnection()` records args                    | Verify server-side close  |
| `now`                        | Internal | Mock: controlled epoch                                     | Drive the expiry boundary |

- **Unit Scenario: UTS-009-B1**
    - **Arrange**: `now()` → `1000`; `onConnect("conn-1", "user_a", tokenExp = 1600)`
    - **Act**: Call `onConnect(...)`
    - **Assert**: `ConnectionStore.putConnection` called with `{ connectionId: "conn-1", sub: "user_a", tokenExp: 1600, ttl: 4600 }` (now + 3600)

- **Unit Scenario: UTS-009-B2**
    - **Arrange**: `now()` → `1601`; connection `tokenExp = 1600` (expired)
    - **Act**: Call `enforceTokenExpiry("conn-1", 1600)`
    - **Assert**: `ApiGatewayManagementClient.deleteConnection("conn-1")` (server-side close) + `ConnectionStore.deleteConnection("conn-1")` called; `incrementMetric("ws.closed.token_expired", 1)` (REQ-049b)

- **Unit Scenario: UTS-009-B3**
    - **Arrange**: `now()` → `1599`; connection `tokenExp = 1600` (still valid, max-1)
    - **Act**: Call `enforceTokenExpiry("conn-1", 1600)`
    - **Assert**: No close; `deleteConnection` NOT called — the close branch is gated on actual expiry (boundary `exp - 1` still authorizes)

---

### Module: MOD-010 (SecretManager — Per-Source API Key Wrapper)

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `packages/services/food-service/src/secrets/secret-manager.service.ts`
**REQ trace**: REQ-042

> Generalized `getUsdaApiKey()` → **per-source** `getSourceApiKey(source)`.

---

#### Test Case: UTP-010-A (getSourceApiKey — per-source cache hit / miss / expiry)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (CacheEmpty → CachePopulated → CacheExpired)
**Description**: Verifies `getSourceApiKey(source)` returns the per-source cached value on a fresh HIT without
calling Secrets Manager, and fetches + caches on a MISS or after TTL expiry — keyed per `source` (REQ-042).

**Dependency & Mock Registry:**

| Dependency             | Source   | Mock/Stub Strategy                                                          | Rationale                          |
| ---------------------- | -------- | --------------------------------------------------------------------------- | ---------------------------------- |
| `SecretsManagerClient` | AWS SDK  | Mock: `getSecretValue()` returns `{ SecretString: '{"apiKey":"key-123"}' }` | Prevent real Secrets Manager calls |
| `SECRET_CACHE`         | Internal | Direct manipulation: set/clear per-source entries                           | Control cache state                |

- **Unit Scenario: UTS-010-A1**
    - **Arrange**: `SECRET_CACHE['usda'] = { value: "cached-key", expiresAt: now() + 60000 }` (fresh HIT)
    - **Act**: Call `getSourceApiKey("usda")`
    - **Assert**: Returns `"cached-key"`; `SecretsManagerClient.getSecretValue` NOT called

- **Unit Scenario: UTS-010-A2**
    - **Arrange**: `SECRET_CACHE = {}` (MISS); `getSecretValue` returns `{ SecretString: '{"apiKey":"key-123"}' }`
    - **Act**: Call `getSourceApiKey("usda")`
    - **Assert**: Returns `"key-123"`; `getSecretValue` called once with the per-source secret name; `SECRET_CACHE['usda'].value === "key-123"`, `expiresAt ≈ now() + 300000`

- **Unit Scenario: UTS-010-A3**
    - **Arrange**: `SECRET_CACHE['usda'] = { value: "old-key", expiresAt: now() - 1 }` (EXPIRED); `getSecretValue` returns `{ SecretString: '{"apiKey":"new-key"}' }`
    - **Act**: Call `getSourceApiKey("usda")`
    - **Assert**: Returns `"new-key"`; `getSecretValue` called once (miss on expiry)

---

#### Test Case: UTP-010-B (getSourceApiKey — Secrets Manager error propagation)

**Technique**: Error Guessing + Statement & Branch Coverage
**Target View**: Error Handling Return Codes
**Description**: Verifies `getSourceApiKey()` maps Secrets Manager failures to the typed errors
(`SecretNotFoundError`, `SecretAccessError`) (REQ-042).

**Dependency & Mock Registry:**

| Dependency             | Source  | Mock/Stub Strategy                                                                     | Rationale                  |
| ---------------------- | ------- | -------------------------------------------------------------------------------------- | -------------------------- |
| `SecretsManagerClient` | AWS SDK | Mock: `getSecretValue()` throws `ResourceNotFoundException` or `AccessDeniedException` | Simulate IAM/config errors |

- **Unit Scenario: UTS-010-B1**
    - **Arrange**: `SECRET_CACHE = {}`; `getSecretValue` throws `ResourceNotFoundException`
    - **Act**: Call `getSourceApiKey("usda")`
    - **Assert**: Throws `SecretNotFoundError`

- **Unit Scenario: UTS-010-B2**
    - **Arrange**: `SECRET_CACHE = {}`; `getSecretValue` throws `AccessDeniedException`
    - **Act**: Call `getSourceApiKey("usda")`
    - **Assert**: Throws `SecretAccessError`

---

#### Test Case: UTP-010-C (rotateKey — per-source cache invalidation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `rotateKey(source)` calls `rotateSecret` and clears the per-source cache entry.

**Dependency & Mock Registry:**

| Dependency             | Source   | Mock/Stub Strategy                  | Rationale                  |
| ---------------------- | -------- | ----------------------------------- | -------------------------- |
| `SecretsManagerClient` | AWS SDK  | Mock: `rotateSecret()` returns `{}` | Prevent real rotation call |
| `SECRET_CACHE`         | Internal | Pre-populate the `usda` entry       | Verify cache is cleared    |

- **Unit Scenario: UTS-010-C1**
    - **Arrange**: `SECRET_CACHE['usda'] = { value: "old-key", expiresAt: now() + 60000 }`
    - **Act**: Call `rotateKey("usda")`
    - **Assert**: Returns `{ success: true }`; `rotateSecret` called with the `usda` secret id; `SECRET_CACHE['usda']` is `undefined`

---

### Module: MOD-011 (MonitoringLogger — Structured Logging & Metrics)

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `packages/services/food-service/src/observability/monitoring-logger.service.ts`
**REQ trace**: REQ-NF (observability), SC-002

---

#### Test Case: UTP-011-A (logRequest / logError — structured payload shape)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `logRequest()` and `logError()` emit the structured payloads with the required fields
(the event context now carries the internal `id`, never `fdcId`).

**Dependency & Mock Registry:**

| Dependency | Source                        | Mock/Stub Strategy                   | Rationale                          |
| ---------- | ----------------------------- | ------------------------------------ | ---------------------------------- |
| `logger`   | @aws-lambda-powertools/logger | Mock: `info()`/`error()` record args | Prevent real CloudWatch log writes |

- **Unit Scenario: UTS-011-A1**
    - **Arrange**: `requestId = "req-1"`, `event = { id: "01J...ULID" }`, `durationMs = 42`
    - **Act**: Call `logRequest("req-1", { id: "01J...ULID" }, 42)`
    - **Assert**: `logger.info` called with `"request"` and `{ requestId: "req-1", event: { id: "01J...ULID" }, durationMs: 42, timestamp: <ISO8601> }`

- **Unit Scenario: UTS-011-A2**
    - **Arrange**: `error = new Error("Something failed")`; `error.name = "ValidationError"`; `context = { id: "01J...ULID" }`
    - **Act**: Call `logError("req-1", error, { id: "01J...ULID" })`
    - **Assert**: `logger.error` called with `"error"` and `{ requestId: "req-1", errorName: "ValidationError", errorMessage: "Something failed", stackTrace: error.stack, context: { id: "01J...ULID" }, timestamp: <ISO8601> }`

---

#### Test Case: UTP-011-B (incrementMetric — EMF payload, FoodData namespace)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (EMF metric format)
**Description**: Verifies `incrementMetric()` emits a CloudWatch EMF payload with the **source-agnostic
`FoodData` namespace** (was `UsdaFoodData`) and the correct metric name/unit (SC-002).

**Dependency & Mock Registry:**

| Dependency | Source                        | Mock/Stub Strategy          | Rationale                      |
| ---------- | ----------------------------- | --------------------------- | ------------------------------ |
| `logger`   | @aws-lambda-powertools/logger | Mock: `info()` records args | Prevent real CloudWatch writes |

- **Unit Scenario: UTS-011-B1**
    - **Arrange**: `name = "consumer.resolved"`, `value = 1`
    - **Act**: Call `incrementMetric("consumer.resolved", 1)`
    - **Assert**: `logger.info` called with `"metric"` where `_aws.CloudWatchMetrics[0].Namespace === "FoodData"`, `Metrics[0].Name === "consumer.resolved"`, `Metrics[0].Unit === "Count"`, `["consumer.resolved"] === 1`, `service === "food-service"`

---

### Module: MOD-012 (ClerkAuthMiddleware — Networkless Token Verification & Authorization) + MOD-013 (DemotionAndFairness — Per-`sub` Demotion, Distinct-Requester Demand & Backpressure)

**Parent Architecture Modules**: ARCH-012 (FoodAuthGuard)
**Requirements Under Test**: REQ-035..042, REQ-043, REQ-044, REQ-045, REQ-046, REQ-047, REQ-050, REQ-051, REQ-052, REQ-053
**Target Source File(s)**: `packages/services/food-service/src/auth/clerk-auth.middleware.ts` (MOD-012, uses shared `@kitchensink/clerk-verify`), `packages/services/food-service/src/auth/demotion-and-fairness.service.ts` (MOD-013)

> **Auth slice preserved (re-keyed `fdcId → id`).** MOD-012 verifies the Clerk session/M2M token networklessly (signature/`exp`/`nbf`/`azp` via the public `CLERK_JWT_KEY`), fails closed to `401`, derives the `AuthenticatedCaller` solely from the verified `sub`, and gates operational scopes (`403`) from `public_metadata`. MOD-013 enforces **fairness by demotion, not rejection** (REQ-043): there is **no per-user quota and no `429`** — when a single `sub` has **more than 50 items currently pending** in the `fetch_queue` (counted live from `fetch_queue` + `fetch_requesters`), that requester's queued items are ranked to the **back** of the priority order, with dynamic re-promotion once the pending count falls back below 50. It also enforces the batch-size cap (`400`, REQ-045) and distinct-requester demand counting (REQ-044) before any fetch is enqueued; no authenticated cache-miss request is ever rejected for a personal limit (work-conserving). The only change from the prior baseline is the work-unit key: a **food `id`** (ULID), never `fdcId`. Unit scenarios isolate `@clerk/backend` `verifyToken` and all I/O behind mocks; only the module's internal control flow, boundaries, and state are exercised.

---

#### Test Case: UTP-012-A (verify — valid token → AuthenticatedCaller principal)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + Architecture Interface View
**Description**: Verifies that on a syntactically valid Clerk token with a matching `azp`, MOD-012 returns the verified claims and builds an `AuthenticatedCaller` whose `sub`/`azp`/scopes are sourced **only** from the `verifyToken` result — covering the success branch of the verification control flow (REQ-036/037/039). `verifyToken` is mocked; no network call is made.

**Dependency & Mock Registry:**

| Dependency         | Source         | Mock/Stub Strategy                                                                                    | Rationale                                           |
| ------------------ | -------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `verifyToken`      | @clerk/backend | Mock: resolves `{ sub: 'user_abc', azp: 'https://app.commise.app', public_metadata: { scopes: [] } }` | Networkless verification; no IdP round trip in unit |
| `MonitoringLogger` | MOD-011        | Stub: no-op                                                                                           | Prevent CloudWatch side-effects                     |

- **Unit Scenario: UTS-012-A1**
    - **Arrange**: Set `Authorization = 'Bearer good.jwt.token'`; configure `CLERK_AUTHORIZED_PARTIES = ['https://app.commise.app']`; mock `verifyToken` to resolve `{ sub: 'user_abc', azp: 'https://app.commise.app', public_metadata: { scopes: [] } }`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: `verifyToken` called exactly once with `{ jwtKey: <CLERK_JWT_KEY>, authorizedParties: ['https://app.commise.app'] }` (networkless — no `secretKey`, no fetch); `req.user` equals `{ sub: 'user_abc', azp: 'https://app.commise.app', scopes: [], permissions: [], tokenClass: 'user' }`; `next()` called with no error

- **Unit Scenario: UTS-012-A2**
    - **Arrange**: As A1 but `verifyToken` resolves with `public_metadata: { scopes: ['foods:refetch'] }`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: `req.user.scopes` deep-equals `['foods:refetch']` — scopes are read solely from the verified token's `public_metadata`, not from any request field

- **Unit Scenario: UTS-012-A3**
    - **Arrange**: As A1 but `verifyToken` resolves `{ sub: 'svc_nightly_sync', azp: 'https://app.commise.app', public_metadata: {} }`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: `req.user.tokenClass === 'm2m'` (the `svc_` prefix classifies the M2M service identity, REQ-047)

---

#### Test Case: UTP-012-B (verify — no / malformed / invalid / expired / wrong-`azp` token → 401, fail closed)

**Technique**: Error Guessing + Statement & Branch Coverage + Strict Isolation
**Target View**: Error Handling & Return Codes + Algorithmic/Logic View
**Description**: Verifies every fail-closed branch yields `401` networklessly and never produces an `AuthenticatedCaller` or calls downstream logic (REQ-035/037/040). Each rejection path is driven by mocking `verifyToken` to throw, or by omitting the header — no real signature math, no IdP call.

**Dependency & Mock Registry:**

| Dependency    | Source         | Mock/Stub Strategy                                 | Rationale                                             |
| ------------- | -------------- | -------------------------------------------------- | ----------------------------------------------------- |
| `verifyToken` | @clerk/backend | Mock: throws `TokenVerificationError` per scenario | Drive each fail-closed branch without real crypto/IdP |
| `next`        | NestJS         | Spy                                                | Assert downstream handler is never reached            |

- **Unit Scenario: UTS-012-B1**
    - **Arrange**: `req.headers` has no `Authorization` header
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Responds `401`; `verifyToken` **not** called; `req.user` is `undefined`; `next()` not called — the request never reaches business logic (REQ-035)

- **Unit Scenario: UTS-012-B2**
    - **Arrange**: `Authorization = 'Bearer not-a-jwt'`; mock `verifyToken` to throw `new Error('malformed token')`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Responds `401`; `req.user` is `undefined` (malformed token rejected)

- **Unit Scenario: UTS-012-B3**
    - **Arrange**: `Authorization = 'Bearer expired.jwt'`; mock `verifyToken` to throw a verification error with reason `token-expired`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Responds `401` (expiry rejected, fail closed, REQ-040)

- **Unit Scenario: UTS-012-B4**
    - **Arrange**: `Authorization = 'Bearer wrong.azp.jwt'`; `CLERK_AUTHORIZED_PARTIES = ['https://app.commise.app']`; mock `verifyToken` to throw `azp-mismatch` (token `azp = 'https://evil.example'`)
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Responds `401`; `verifyToken` was called with `authorizedParties: ['https://app.commise.app']` (the `azp` allowlist is enforced by the verifier, REQ-037)

- **Unit Scenario: UTS-012-B5**
    - **Arrange**: `Authorization = 'Bearer good.jwt'`; `CLERK_JWT_KEY` config empty/undefined so `verifyToken` throws a configuration error
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Responds `401` (missing key config fails closed — never proceeds unauthenticated, REQ-040)

---

#### Test Case: UTP-012-C (verify — client-supplied identity header is ignored)

**Technique**: Error Guessing + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies that a forged identity header (`x-authorizer-context` / `x-user-id`) is never read; the `AuthenticatedCaller.sub` comes solely from the verified token, even when the header claims a different `sub` (REQ-038, mirrors PR #39 decision).

**Dependency & Mock Registry:**

| Dependency    | Source         | Mock/Stub Strategy                                                    | Rationale                     |
| ------------- | -------------- | --------------------------------------------------------------------- | ----------------------------- |
| `verifyToken` | @clerk/backend | Mock: resolves `{ sub: 'user_real', azp: 'https://app.commise.app' }` | Isolate verified-claim source |

- **Unit Scenario: UTS-012-C1**
    - **Arrange**: `Authorization = 'Bearer good.jwt'`; also set `req.headers['x-authorizer-context'] = JSON.stringify({ sub: 'user_admin_forged' })` and `req.headers['x-user-id'] = 'user_admin_forged'`; mock `verifyToken` to resolve `{ sub: 'user_real', azp: 'https://app.commise.app', public_metadata: {} }`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: `req.user.sub === 'user_real'` (the verified token wins); the `x-authorizer-context` / `x-user-id` headers are deleted and never parsed into `req.user` (REQ-038)

---

#### Test Case: UTP-012-D (requireScope — missing operational scope → 403; precedence after 401)

**Technique**: Equivalence Partitioning + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View + State Machine View (status precedence)
**Description**: Verifies the scope gate on an operational endpoint: an authenticated caller lacking the required scope receives `403` (distinct from the `401` unauthenticated case), and a caller holding the scope passes — covering both branches of the authorization check (REQ-039, REQ-051 precedence `401 → 403 → 400`).

**Dependency & Mock Registry:**

| Dependency            | Source  | Mock/Stub Strategy                         | Rationale                                          |
| --------------------- | ------- | ------------------------------------------ | -------------------------------------------------- |
| `AuthenticatedCaller` | MOD-012 | Stub principal built from a verified token | Scope gate runs on an already-authenticated caller |

- **Unit Scenario: UTS-012-D1**
    - **Arrange**: `req.user = { sub: 'user_abc', scopes: [], permissions: [], tokenClass: 'user' }`; route requires scope `'foods:refetch'`
    - **Act**: Invoke `requireScope('foods:refetch')(req, res, next)`
    - **Assert**: Responds `403 Forbidden` (authenticated but unauthorized — not `401`); downstream handler not reached (REQ-051)

- **Unit Scenario: UTS-012-D2**
    - **Arrange**: `req.user = { sub: 'user_abc', scopes: ['foods:refetch'], permissions: [], tokenClass: 'user' }`; route requires scope `'foods:refetch'`
    - **Act**: Invoke `requireScope('foods:refetch')(req, res, next)`
    - **Assert**: Passes (no `403`); `next()` called — scope present authorizes the operational route

- **Unit Scenario: UTS-012-D3**
    - **Arrange**: A read endpoint (`GET /v1/foods/{id}`) requiring no operational scope; `req.user = { sub: 'user_abc', scopes: [] }`
    - **Act**: Invoke the read route (no `requireScope`)
    - **Assert**: Passes — all authenticated users may read shared food reference data (no per-record ownership), per REQ-039

---

#### Test Case: UTP-012-E (drainPriorityTier — per-`sub` pending-count demotion, dynamic re-promotion, never rejected)

**Technique**: Boundary Value Analysis + State Transition Testing + Strict Isolation
**Target View**: Internal Data Structures + State Machine View
**Description**: Verifies fairness-by-demotion in MOD-013 (REQ-043): the drain-time priority scorer computes a `sub`'s rank from its **current pending count** read live from `fetch_queue` + `fetch_requesters`. A request from a `sub` with **more than 50 items currently pending** is **still admitted** (no `429`, never rejected for a personal limit) but its queued items are ranked to the **back**; once the `sub`'s pending count falls back below 50 the scorer **dynamically re-promotes** to normal priority (it reads live state, not a frozen flag). Demotion is work-conserving. The pending-count source is mocked so only the demotion decision logic is tested. The work unit is a food `id`, never `fdcId`.

**Dependency & Mock Registry:**

| Dependency           | Source                                        | Mock/Stub Strategy                                      | Rationale                                                |
| -------------------- | --------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------- |
| `pendingCountForSub` | ARCH-003 (`fetch_queue` + `fetch_requesters`) | Mock: returns a controlled live pending count per `sub` | Isolate the demotion decision from the real queue tables |
| `FetchQueue`         | ARCH-003 (Postgres `fetch_queue`)             | Spy: `requestedBy(foodId)` — supply the owning sub      | Resolve the food's requester for the tier computation    |

- **Unit Scenario: UTS-012-E1**
    - **Arrange**: Demotion threshold `T = 50`; mock `pendingCountForSub('user_abc')` → `50` (at the boundary, not yet over); `FetchQueue.requestedBy('01J...ULID')` → `'user_abc'`
    - **Act**: Invoke `drainPriorityTier('01J...ULID')`
    - **Assert**: Returns `0` (front tier, non-demoted) — at exactly 50 pending the `sub` is **not** demoted (boundary: == 50 is not "more than 50", REQ-043)

- **Unit Scenario: UTS-012-E2**
    - **Arrange**: `pendingCountForSub('user_abc')` → `51` (more than 50)
    - **Act**: Invoke `drainPriorityTier('01J...ULID')`
    - **Assert**: Returns `1` (back tier) — the request was still admitted (no `429`); only its drain rank is demoted (boundary: 51 → demoted, REQ-043)

- **Unit Scenario: UTS-012-E3**
    - **Arrange**: `sub='user_abc'` was demoted at `pending = 80`; its pending count later drops to `49` as items drain
    - **Act**: Invoke `drainPriorityTier('01J...ULID')` again at the new live count
    - **Assert**: Returns `0` (normal) — the scorer **dynamically re-promotes** from live state once pending falls below 50, with no frozen demotion flag (work-conserving, REQ-043)

---

#### Test Case: UTP-012-F (enforceBatchCap — oversized batch → 400, no enqueue)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage
**Target View**: Internal Data Structures + Algorithmic/Logic View
**Description**: Verifies the hard batch-size cap (≤ 100 `id`s) across the boundary: at-limit accepted, over-limit rejected with `400` before any enqueue (REQ-045). (There is no per-user quota to debit — fairness is by demotion, UTP-012-E.) Work units are food `id`s, never `fdcId`s.

**Dependency & Mock Registry:**

| Dependency   | Source   | Mock/Stub Strategy                      | Rationale                                  |
| ------------ | -------- | --------------------------------------- | ------------------------------------------ |
| `FetchQueue` | ARCH-003 | Spy: `enqueue()` — assert zero on `400` | Verify nothing enqueues on oversized batch |

- **Unit Scenario: UTS-012-F1**
    - **Arrange**: `MAX_BATCH_IDS = 100`; `ids` array of length `100` (ULIDs)
    - **Act**: Invoke `enforceBatchCap(ids)`
    - **Assert**: Does not throw (boundary: max accepted)

- **Unit Scenario: UTS-012-F2**
    - **Arrange**: `MAX_BATCH_IDS = 100`; `ids` array of length `101`
    - **Act**: Invoke `enforceBatchCap(ids)`
    - **Assert**: Throws `BatchTooLargeError(400)`; `FetchQueue.enqueue` called zero times (boundary: max+1 — rejected, no enqueue, REQ-045)

---

#### Test Case: UTP-012-G (recordDemand — distinct-requester demand counts distinct subs only)

**Technique**: Equivalence Partitioning + Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + Internal Data Structures
**Description**: Verifies demand-weighting counts **distinct authenticated `sub`s** per food `id` (via the `fetch_requesters` PK), so a single `sub`'s repeated requests do not inflate priority more than once — each distinct `sub` contributes exactly `PRIORITY_CAP = 1` (REQ-044).

**Dependency & Mock Registry:**

| Dependency        | Source                                                  | Mock/Stub Strategy                                   | Rationale                                               |
| ----------------- | ------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| `FetchRequesters` | ARCH-003 (Postgres `fetch_requesters`, PK(food_id,sub)) | Mock: backed by an in-memory `Set` keyed `id → subs` | Isolate distinct-counting from the real requester store |
| `FetchQueue`      | ARCH-003                                                | Spy: `bumpDemand(id, cap)` — assert call count       | Verify demand bumps only on a newly-distinct requester  |

- **Unit Scenario: UTS-012-G1**
    - **Arrange**: For food `id = "01J...ULID"`, `sub='user_a'` records a request 5 times in a row
    - **Act**: Invoke `recordDemand('user_a', '01J...ULID')` five times
    - **Assert**: `FetchRequesters.upsert` is idempotent (`ON CONFLICT DO NOTHING`); `FetchQueue.bumpDemand` called **once** — repeated requests by the same `sub` count once, not 5 (REQ-044)

- **Unit Scenario: UTS-012-G2**
    - **Arrange**: For `id = "01J...ULID"`, three distinct subs `user_a`, `user_b`, `user_c` each request once
    - **Act**: Record each
    - **Assert**: `bumpDemand` called 3 times (one per newly-distinct requester); the capped distinct count for the row is 3 — distinct requesters each contribute exactly one (REQ-044)

---

#### Test Case: UTP-012-H (checkBackpressure — 503 fail-closed family: queue depth, open circuit, store unavailable)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage + Error Guessing
**Target View**: Internal Data Structures + Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies the `503` decision branches of MOD-013's backpressure gate for an authenticated caller (there is no per-user quota — fairness is by demotion per UTP-012-E, not by `429`): (a) `fetch_queue` depth at/over `MAX_QUEUE_DEPTH` → `503`, no enqueue; (b) the source circuit breaker is `OPEN` → `503`, no enqueue; (c) the queue/requesters store used by the gate is unavailable → **fail closed** to `503` (never fail open to unbounded enqueue) (REQ-046). The depth probe, breaker, and store are mocked so only the gate's decision logic is exercised. The global `MAX_QUEUE_DEPTH` backstop is distinct from per-`sub` demotion: demotion never rejects, but the global ceiling can `503`.

**Dependency & Mock Registry:**

| Dependency       | Source   | Mock/Stub Strategy                                                                                                 | Rationale                                   |
| ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `FetchQueue`     | ARCH-003 | Mock: `depth()` returns a controlled integer at/over/under the bound; Spy: `enqueue()` asserts zero on every `503` | Drive the depth boundary; verify no enqueue |
| `CircuitBreaker` | ARCH-008 | Mock: `state` is `'closed'` or `'open'`                                                                            | Drive the open-circuit branch               |

- **Unit Scenario: UTS-012-H1**
    - **Arrange**: `MAX_QUEUE_DEPTH = 10000`; `FetchQueue.depth()` → `10000` (at the ceiling); `CircuitBreaker.state = 'closed'`
    - **Act**: Invoke `checkBackpressure()`
    - **Assert**: Throws `BackpressureError(503, "Fetch queue saturated")`; `FetchQueue.enqueue` called **zero** times (boundary: depth == max is over-full — the global backstop, not a per-user limit, REQ-046)

- **Unit Scenario: UTS-012-H2**
    - **Arrange**: `FetchQueue.depth()` → `9999` (max-1); `CircuitBreaker.state = 'closed'`
    - **Act**: Invoke `checkBackpressure()`
    - **Assert**: Does not throw (boundary: max-1 admitted — confirms the `503` branch is the depth ceiling, not an always-reject)

- **Unit Scenario: UTS-012-H3**
    - **Arrange**: `FetchQueue.depth()` → `10` (well under); `CircuitBreaker.state = 'open'`
    - **Act**: Invoke `checkBackpressure()`
    - **Assert**: Throws `BackpressureError(503, "source circuit open")`; `enqueue` called **zero** times (open circuit fails closed independently of depth, REQ-046)

- **Unit Scenario: UTS-012-H4**
    - **Arrange**: `FetchQueue.depth()` **throws** `ConnectionRefusedError` (queue store unavailable)
    - **Act**: Invoke `checkBackpressure()`
    - **Assert**: Throws `BackpressureError(503)` — **fail closed**: an unavailable store rejects rather than failing open to unbounded enqueue; `enqueue` called **zero** times

---

#### Test Case: UTP-012-I (use — invalid-token flood load-shed: per-source `401`-rate cap + concurrency cap, SC-011 holds)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage + Error Guessing
**Target View**: Internal Data Structures + Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-012's DoS-protection branch (REQ-052, SC-011): under a flood of well-formed-but-invalid tokens — each of which would otherwise force a CPU-bound `verifyToken` signature check before the fail-closed `401` — the verifier **load-sheds** rather than saturating. Two independent guards are exercised at their boundaries: (a) a **per-source `401`-rate cap** that short-circuits to `429` **without** invoking `verifyToken` once a source crosses its rolling `401` budget; and (b) a **bounded verification concurrency** semaphore that sheds `503` (without a signature check) when in-flight verifications are at the ceiling, so a single flooding source cannot pin every worker and breach SC-011. The rate-counter store, the semaphore, and `verifyToken` are mocked so only the load-shed decision logic is tested. The source key is the **ALB-attested client IP**, never a client-suppliable header (REQ-038).

**Dependency & Mock Registry:**

| Dependency             | Source         | Mock/Stub Strategy                                                                                      | Rationale                                               |
| ---------------------- | -------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `verifyToken`          | @clerk/backend | Spy: throws `TokenVerificationError`; assert **call count** to prove the cap short-circuits ahead of it | Prove load-shed bypasses the CPU-bound signature check  |
| `Source401RateLimiter` | MOD-012        | Mock: `isOverCap(src, max, window)` returns `true`/`false` at/over/under the cap                        | Drive the per-source `401`-rate-cap boundary            |
| `verifySemaphore`      | MOD-012        | Mock: `tryAcquire()` returns `true`/`false`                                                             | Drive the concurrency-cap shed branch deterministically |
| `MonitoringLogger`     | MOD-011        | Mock: `incrementMetric()` records args                                                                  | Verify the `auth.load_shed` metric is emitted           |

- **Unit Scenario: UTS-012-I1**
    - **Arrange**: `SOURCE_401_RATE_MAX = 20`; mock `Source401RateLimiter.isOverCap` returns `false` (under cap); `Authorization = 'Bearer well-formed.but.invalid'`; spy `verifyToken` throws `TokenVerificationError`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Responds `401`; `verifyToken` **called exactly once** (under the cap → the signature check still runs, then fails closed); `Source401RateLimiter.record(src, ...)` called; `req.user` is `undefined`

- **Unit Scenario: UTS-012-I2**
    - **Arrange**: `Source401RateLimiter.isOverCap` returns `true` (at/over the cap); same invalid token; spy `verifyToken`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Responds `429` (pinned per-source 401-rate-cap shed status, module-design.md §error map); `verifyToken` **called zero times** — the per-source cap short-circuits ahead of the CPU-bound verify; `req.user` is `undefined` (REQ-052)

- **Unit Scenario: UTS-012-I3**
    - **Arrange**: `isOverCap` returns `false`; mock `verifySemaphore.tryAcquire()` returns `false` (concurrency at ceiling); spy `verifyToken`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Sheds without a signature check — responds `503` (pinned `VerifySemaphore`-exhausted shed status); `verifyToken` **called zero times** (boundary: in-flight == max → shed, REQ-052)

- **Unit Scenario: UTS-012-I4**
    - **Arrange**: `isOverCap` returns `false`; `verifySemaphore.tryAcquire()` returns `true` (a slot free); mock `verifyToken` to **resolve** a valid `{ sub: 'user_legit', azp: <authorized>, public_metadata: { scopes: [] } }`
    - **Act**: Invoke `middleware.use(req, res, next)`
    - **Assert**: Admitted — `verifyToken` called once and `req.user.sub === 'user_legit'`; **not** shed; `verifySemaphore.release()` called in `finally` — a free slot admits the legitimate caller even while invalid traffic is shed elsewhere (SC-011 path stays open)

---

#### Test Case: UTP-012-J (authorizeConnect — WebSocket `$connect` auth + mid-connection `exp` → close)

**Technique**: State Transition Testing + Statement & Branch Coverage + Strict Isolation
**Target View**: State Machine View (Unauthenticated → Connected → Expired/Closed) + Algorithmic/Logic View
**Description**: Verifies the WebSocket auth path (REQ-041/049): MOD-012's shared Clerk verification, reused by the `$connect` REQUEST authorizer, (a) extracts the token from the subprotocol/query param, (b) admits a valid token and emits an `Allow` policy whose principal/`sub` is sourced solely from the verified claims, (c) **pins `$connect` rejection to `403`** for a missing/invalid token, and (d) on a **mid-connection token expiry** transitions Connected → Closed. `verifyToken` and the clock are mocked.

**Dependency & Mock Registry:**

| Dependency        | Source         | Mock/Stub Strategy                                                                            | Rationale                                                              |
| ----------------- | -------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `verifyToken`     | @clerk/backend | Mock: resolves a valid claim set, or throws a `token-expired` verification error per scenario | Networkless `$connect` verification; drive expiry without a real clock |
| `now`             | Internal       | Mock: controlled epoch                                                                        | Drive the mid-connection expiry transition                             |
| `ConnectionStore` | DynamoDB       | Mock: `putConnection()` / `deleteConnection()` record args                                    | Verify subscription row written on connect, removed on close           |

- **Unit Scenario: UTS-012-J1**
    - **Arrange**: `$connect` event carries the token via `Sec-WebSocket-Protocol`; `CLERK_AUTHORIZED_PARTIES = ['https://app.commise.app']`; mock `verifyToken` to resolve `{ sub: 'user_ws', azp: 'https://app.commise.app', exp: now() + 600, public_metadata: {} }`
    - **Act**: Invoke `authorizeConnect(connectEvent)`
    - **Assert**: Returns an `Allow` IAM policy whose `principalId`/`context.sub === 'user_ws'` (from the verified token); `verifyToken` called once with `authorizedParties: ['https://app.commise.app']`; `context.tokenExp` carried for the subscription set

- **Unit Scenario: UTS-012-J2**
    - **Arrange**: `$connect` event with **no** token in the subprotocol or query param
    - **Act**: Invoke `authorizeConnect(connectEvent)`
    - **Assert**: Rejects with the pinned `403` `$connect` status (NOT `401`); `verifyToken` not called; no `Allow` policy (REQ-049d)

- **Unit Scenario: UTS-012-J3**
    - **Arrange**: `$connect` event with a well-formed but invalid token; mock `verifyToken` to throw `TokenVerificationError`
    - **Act**: Invoke `authorizeConnect(connectEvent)`
    - **Assert**: Rejects with the pinned `403` (fail closed); no `Allow` policy; connection never established

- **Unit Scenario: UTS-012-J4**
    - **Arrange**: A connection admitted at `now() = 1000` with `exp = 1300`; the clock advances to `now() = 1301`
    - **Act**: Invoke `enforceTokenExpiry(connectionId, 1300)` at `now() = 1301`
    - **Assert**: Connected → Closed — `ApiGatewayManagementClient.deleteConnection` and `ConnectionStore.deleteConnection(connectionId)` called; the expired token does NOT continue to authorize traffic (REQ-049b)

- **Unit Scenario: UTS-012-J5**
    - **Arrange**: A connection admitted at `now() = 1000` with `exp = 1300`; the clock is at `now() = 1299` (max-1)
    - **Act**: Invoke `enforceTokenExpiry(connectionId, 1300)` at `now() = 1299`
    - **Assert**: Remains Connected (no close); `deleteConnection` NOT called — the close branch is gated on actual expiry (boundary `exp - 1` still authorizes)

---

### Module: MOD-014 (AsyncProducerAuthz — Async-Producer Provenance & Least-Privilege Enforcement)

**Parent Architecture Modules**: ARCH-012 (FoodAuthGuard)
**Requirements Under Test**: REQ-042 (async leg), REQ-032/REQ-048-analog provenance
**Target Source File(s)**: `packages/services/food-service/src/auth/async-producer-authz.service.ts` (MOD-014)

> **Auth slice preserved (generalized USDA → external source).** US-0's guarantee — _"no unauthenticated path may drive external source consumption"_ — must also hold on the **async/internal** producer leg (EventBridge events, cron, bulk-sync, recipe import), not only the synchronous HTTP edge that MOD-012 fronts. MOD-014 enforces two layers before any source fetch or `INSERT INTO fetch_queue`: **(1)** the delivering IAM principal — from the AWS-attested invocation context, never a forgeable event-body field — must be on the least-privilege producer allowlist; and **(2)** the event's `requestedBy` provenance must be an authenticated human `sub` (carried from MOD-012) or a named `svc_` service principal — never empty, never `'system'`. Every deny path is **fail-closed**: the event is dropped, nothing fetched or enqueued. Unit scenarios mock the invocation context, the allowlist config, and `MonitoringLogger`; no real bus, no DB.

---

#### Test Case: UTP-014-A (admitAsyncEvent — allowlisted principal + valid provenance → admitted)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + State Machine View (ReceivingAsyncEvent → CheckingProducerPrincipal → CheckingProvenance → Admitted)
**Description**: Verifies the happy-path admit branch of `admitAsyncEvent`: when the AWS-attested delivering principal is on the least-privilege allowlist **and** the event's `requestedBy` is an authenticated human `sub`, the gate admits and returns the carried provenance with `requesterClass: 'user'` — covering both enforcement layers before any fetch/enqueue.

**Dependency & Mock Registry:**

| Dependency          | Source         | Mock/Stub Strategy                                                                    | Rationale                                                              |
| ------------------- | -------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `InvocationContext` | AWS (attested) | Stub: `{ callerArn: 'arn:aws:iam::…:role/food-consumer', eventSource: 'aws.events' }` | Delivery identity is AWS-attested, never client-suppliable             |
| `ProducerAllowlist` | Config (IaC)   | Stub: `Set(['arn:aws:iam::…:role/food-consumer', 'arn:aws:iam::…:role/import-job'])`  | Least-privilege allowlist is config, not request input                 |
| `isClerkSub`        | MOD-012        | Stub: returns `true` for `'user_async'`                                               | Shape-validate the carried authenticated sub without real verification |
| `MonitoringLogger`  | MOD-011        | Spy: records `incrementMetric` calls                                                  | Assert the `async.producer.admitted` metric                            |

- **Unit Scenario: UTS-014-A1**
    - **Arrange**: `invocationContext.callerArn = 'arn:aws:iam::…:role/food-consumer'` (allowlisted); `event = { DetailType: 'FoodRequested', Detail: JSON.stringify({ requestedBy: 'user_async' }) }`; `isClerkSub('user_async')` → `true`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Returns `{ admitted: true, requestedBy: 'user_async', requesterClass: 'user' }`; `MonitoringLogger.incrementMetric('async.producer.admitted', 1)` called once; no error thrown — both layers passed

---

#### Test Case: UTP-014-B (assertProducerPrincipal — non-allowlisted IAM principal → UnauthorizedProducerError, fail closed)

**Technique**: Equivalence Partitioning + Error Guessing + Strict Isolation
**Target View**: Error Handling & Return Codes + State Machine View (CheckingProducerPrincipal → RejectedUnauthorizedProducer)
**Description**: Verifies the layer-1 deny branch: a delivering IAM principal **not** on the least-privilege allowlist is rejected with `UnauthorizedProducerError` **before** provenance is evaluated — event dropped, no fetch, no enqueue. The principal ARN is read from the AWS-attested context, never an event-body field, so a forged `Detail` cannot bypass this.

**Dependency & Mock Registry:**

| Dependency          | Source         | Mock/Stub Strategy                                                            | Rationale                                   |
| ------------------- | -------------- | ----------------------------------------------------------------------------- | ------------------------------------------- |
| `InvocationContext` | AWS (attested) | Stub: `{ callerArn: 'arn:aws:iam::…:role/rogue', eventSource: 'aws.events' }` | Drive a principal absent from the allowlist |
| `ProducerAllowlist` | Config (IaC)   | Stub: `Set(['arn:aws:iam::…:role/food-consumer'])`                            | Rogue ARN is not a member                   |
| `FetchQueue`        | MOD-016        | Spy: `enqueue()`                                                              | Assert nothing enqueued on the deny path    |

- **Unit Scenario: UTS-014-B1**
    - **Arrange**: `callerArn = 'arn:aws:iam::…:role/rogue'` (not allowlisted); `event` provenance would otherwise be valid
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `UnauthorizedProducerError` (with the offending `principalArn`); `assertProvenance` never reached (layer-1 short-circuits); `FetchQueue.enqueue` NOT called; `async.producer.admitted` NOT incremented — fail-closed
    - **`isUnauthorizedProducerError(err)` type guard returns `true`** for the thrown error

- **Unit Scenario: UTS-014-B2**
    - **Arrange**: `assertEnqueueProvenance(dbSessionRole = 'arn:aws:iam::…:role/rogue-db', requestedBy = 'user_async')`; that role is not allowlisted
    - **Act**: Invoke `assertEnqueueProvenance(dbSessionRole, requestedBy)`
    - **Assert**: Throws `UnauthorizedProducerError` (non-allowlisted DB session role) — defense-in-depth behind the least-privilege DB grant (REQ-042)

---

#### Test Case: UTP-014-C (assertProvenance — requestedBy missing / empty / 'system' → ProvenanceError, fail closed)

**Technique**: Equivalence Partitioning + Boundary Value Analysis + Error Guessing
**Target View**: Error Handling & Return Codes + Algorithmic/Logic View
**Description**: Verifies the layer-2 anonymous-origin deny branch — the one that closes the unauthenticated async path: for an **allowlisted** principal, an event whose `requestedBy` is `null`, `''`, or `'system'` is rejected with `ProvenanceError`; event dropped, nothing fetched/enqueued. The three anonymous inputs form one equivalence class with `'system'` the named boundary.

**Dependency & Mock Registry:**

| Dependency          | Source         | Mock/Stub Strategy                                  | Rationale                                               |
| ------------------- | -------------- | --------------------------------------------------- | ------------------------------------------------------- |
| `InvocationContext` | AWS (attested) | Stub: `callerArn` on the allowlist (layer-1 passes) | Isolate the layer-2 provenance branch                   |
| `ProducerAllowlist` | Config (IaC)   | Stub: contains the stubbed `callerArn`              | Ensure the principal check does not short-circuit first |
| `FetchQueue`        | MOD-016        | Spy: `enqueue()`                                    | Assert no enqueue on every reject                       |

- **Unit Scenario: UTS-014-C1**
    - **Arrange**: Allowlisted principal; `event.Detail = JSON.stringify({ requestedBy: null })`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProvenanceError` ("Missing/anonymous requestedBy"); `FetchQueue.enqueue` NOT called; no admit metric

- **Unit Scenario: UTS-014-C2**
    - **Arrange**: Allowlisted principal; `event.Detail = JSON.stringify({ requestedBy: '' })`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProvenanceError`; nothing fetched/enqueued — empty `requestedBy` rejected identically to `null`

- **Unit Scenario: UTS-014-C3**
    - **Arrange**: Allowlisted principal; `event.Detail = JSON.stringify({ requestedBy: 'system' })`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProvenanceError` — the generic `'system'` string is explicitly rejected (no unauthenticated `'system'` shortcut); event dropped, fail closed

- **Unit Scenario: UTS-014-C4**
    - **Arrange**: Allowlisted principal; `requestedBy: 'unknown_token_42'`; `isClerkSub('unknown_token_42')` → `false` and it lacks the `svc_` prefix
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProvenanceError` ("neither an authenticated sub nor a named service principal")

---

#### Test Case: UTP-014-D (assertProvenance — named svc\_ service principal → admitted as requesterClass 'service')

**Technique**: Equivalence Partitioning + Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + State Machine View (CheckingProvenance → Admitted)
**Description**: Verifies the second admit equivalence class of layer-2: an allowlisted principal carrying a `requestedBy` beginning with `svc_` is admitted and classified `requesterClass: 'service'` (distinct from the human-`sub` class of UTP-014-A); and that an unrecognized detail-type is dropped even with valid service provenance.

**Dependency & Mock Registry:**

| Dependency          | Source         | Mock/Stub Strategy                                           | Rationale                                                            |
| ------------------- | -------------- | ------------------------------------------------------------ | -------------------------------------------------------------------- |
| `InvocationContext` | AWS (attested) | Stub: `callerArn` on the allowlist (e.g. the scheduler role) | Layer-1 passes so the service-prefix branch is isolated              |
| `ProducerAllowlist` | Config (IaC)   | Stub: contains the stubbed `callerArn`                       | Allow the principal through to provenance                            |
| `isClerkSub`        | MOD-012        | Stub: returns `false`                                        | Prove admit is via the `svc_` prefix branch, not the human-`sub` one |
| `MonitoringLogger`  | MOD-011        | Spy: records `incrementMetric`                               | Assert the admit metric on the service path                          |

- **Unit Scenario: UTS-014-D1**
    - **Arrange**: Allowlisted scheduler principal; `event = { DetailType: 'IngestionScheduled', Detail: JSON.stringify({ requestedBy: 'svc_nightly_sync' }) }`; `SERVICE_PRINCIPAL_PREFIX = 'svc_'`; `isClerkSub('svc_nightly_sync')` → `false`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Returns `{ admitted: true, requestedBy: 'svc_nightly_sync', requesterClass: 'service' }`; `incrementMetric('async.producer.admitted', 1)` called once

- **Unit Scenario: UTS-014-D2**
    - **Arrange**: Allowlisted principal; `event.DetailType = 'PaymentSettled'` (not in `ALLOWED_DETAIL_TYPES`); `Detail` carries a valid `svc_` `requestedBy`
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `UnauthorizedProducerError` ("Unrecognized detail-type") — even valid service provenance is dropped on an unrecognized detail-type; no work performed

---

#### Test Case: UTP-014-E (admitAsyncEvent — missing/empty allowlist config at boot → ProducerConfigError, fail closed)

**Technique**: Error Guessing + Statement & Branch Coverage
**Target View**: Error Handling & Return Codes
**Description**: Verifies the boot-time fail-closed posture: if the least-privilege allowlist config is missing or empty when async processing starts, the module **refuses to process async events** (`ProducerConfigError`) rather than defaulting open — an empty allowlist must never be read as "allow all".

**Dependency & Mock Registry:**

| Dependency          | Source       | Mock/Stub Strategy                | Rationale                                         |
| ------------------- | ------------ | --------------------------------- | ------------------------------------------------- |
| `ProducerAllowlist` | Config (IaC) | Stub: empty `Set()` / `undefined` | Drive the missing/empty-config fail-closed branch |

- **Unit Scenario: UTS-014-E1**
    - **Arrange**: `ALLOWED_PRODUCER_PRINCIPAL_ARNS` resolves to an empty set (or undefined) at construction; a well-formed event with an allowlisted-looking principal and valid `svc_` provenance
    - **Act**: Invoke `admitAsyncEvent(invocationContext, event)`
    - **Assert**: Throws `ProducerConfigError` — the module fails closed rather than treating an empty allowlist as allow-all; no fetch, no enqueue

---

### Module: MOD-015 (SourceAdapterRegistry — Pluggable Source-Adapter Registry & Interface)

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `packages/services/food-service/src/sources/source-adapter.registry.ts`
**REQ trace**: REQ-054, REQ-IF-012, REQ-050, REQ-CN-007

> **(New.)** The pluggable registry + `FoodSourceAdapter` interface. ARCH-004 iterates it to fan out by name; it holds the static source-priority order the merge engine (MOD-017) consults. USDA (MOD-008) is the only registered adapter today.

---

#### Test Case: UTP-015-A (register / allAdapters — additive wiring, priority order, duplicate reject)

**Technique**: Statement & Branch Coverage + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling Return Codes
**Description**: Verifies `register(adapter)` wires an adapter additively and rejects a duplicate `source` (`DuplicateSourceError`); `allAdapters()` returns the wired adapters in priority order (REQ-054).

**Dependency & Mock Registry:**

| Dependency    | Source  | Mock/Stub Strategy                                   | Rationale                |
| ------------- | ------- | ---------------------------------------------------- | ------------------------ |
| `usdaAdapter` | MOD-008 | Stub: `{ source: 'usda', searchByName, fetchByKey }` | A wired adapter instance |

- **Unit Scenario: UTS-015-A1**
    - **Arrange**: a fresh registry; register the `usda` adapter
    - **Act**: Call `register(usdaAdapter)` then `allAdapters()`
    - **Assert**: `allAdapters()` returns `[usdaAdapter]` — the single wired adapter, in `PRIORITY_ORDER` order

- **Unit Scenario: UTS-015-A2**
    - **Arrange**: the `usda` adapter already registered
    - **Act**: Call `register(usdaAdapter)` again
    - **Assert**: Throws `DuplicateSourceError('usda')` at bootstrap — misconfiguration surfaced before serving

- **Unit Scenario: UTS-015-A3**
    - **Arrange**: a registry where `PRIORITY_ORDER = ['usda']` but only a non-`usda` adapter is registered (simulating partial wiring)
    - **Act**: Call `allAdapters()`
    - **Assert**: Returns `[]` — `allAdapters` filters to wired sources present in `PRIORITY_ORDER` (a source must be both registered and in the priority order to participate)

---

#### Test Case: UTP-015-B (priorityOf / adapterFor — priority lookup + unknown-source reject)

**Technique**: Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View (priority computation) + Error Handling Return Codes
**Description**: Verifies `priorityOf(source)` returns a higher number for earlier (higher-priority) sources and throws `UnknownSourceError` for a source not in `PRIORITY_ORDER`; `adapterFor(source)` returns the registered adapter (consumed by MOD-017 merge + MOD-020 refresh) (REQ-051).

**Dependency & Mock Registry:**

| Dependency    | Source  | Mock/Stub Strategy                         | Rationale            |
| ------------- | ------- | ------------------------------------------ | -------------------- |
| `usdaAdapter` | MOD-008 | Stub: `{ source: 'usda', ... }` registered | Resolve `adapterFor` |

- **Unit Scenario: UTS-015-B1**
    - **Arrange**: `PRIORITY_ORDER = ['usda']`
    - **Act**: Call `priorityOf('usda')`
    - **Assert**: Returns `1` (`PRIORITY_ORDER.length - indexOf = 1 - 0`) — USDA is the default highest priority

- **Unit Scenario: UTS-015-B2**
    - **Arrange**: `PRIORITY_ORDER = ['usda']` (no `'opf'` source configured)
    - **Act**: Call `priorityOf('opf')`
    - **Assert**: Throws `UnknownSourceError('opf')` — a source must be in `PRIORITY_ORDER` to participate

- **Unit Scenario: UTS-015-B3**
    - **Arrange**: the `usda` adapter registered
    - **Act**: Call `adapterFor('usda')`
    - **Assert**: Returns the registered `usdaAdapter` instance (used by the merge engine and change-refresh consumer)

---

### Module: MOD-016 (FoodDaoRepository — DAO / Repository Persistence Seam)

**Parent Architecture Modules**: ARCH-014
**Target Source File(s)**: `packages/services/food-service/src/database/foods.repository.ts` (+ per-aggregate DAOs)
**REQ trace**: REQ-005, REQ-013, REQ-054, REQ-028

> **(New.)** The sole persistence seam (REQ-054). Owns **add-by-name dedup** (normalized-name unique key + a short `pg_advisory_xact_lock` so concurrent adds collapse to one row + `id`) and the atomic golden-record upsert with provenance (MOD-019).

---

#### Test Case: UTP-016-A (createByName — advisory-lock dedup collapse to one id)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View (advisory-lock transaction)
**Description**: Verifies `createByName(normalizedName, displayName)` takes the per-name advisory lock, and — on a first add — inserts a new `food` row with a fresh ULID `id` and `status='PENDING'` returning `{ created: true }`; on a concurrent/repeat add of the **same normalized name** it finds the existing row under the lock and **collapses to the existing `id`** returning `{ created: false }` (REQ-005/013).

**Dependency & Mock Registry:**

| Dependency  | Source      | Mock/Stub Strategy                                                                                                               | Rationale                                  |
| ----------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `tx`        | Drizzle txn | Mock: `execute(advisory lock)`; `query(SELECT id WHERE normalized_name)` returns `null` then a row; `query(INSERT)` records args | Drive both first-add and collapse branches |
| `newFoodId` | platform    | Stub: returns a deterministic ULID                                                                                               | Make the new `id` assertable               |

- **Unit Scenario: UTS-016-A1**
    - **Arrange**: `normalizedName = "granny smith apple"`; the `SELECT ... WHERE normalized_name` returns `null` (no existing row); `newFoodId()` returns `"01J...NEW"`
    - **Act**: Call `createByName("granny smith apple", "Granny Smith Apple")`
    - **Assert**: `tx.execute("SELECT pg_advisory_xact_lock($1)", [hashToBigint("granny smith apple")])` called first; then `INSERT INTO food (id, name, normalized_name, status) VALUES ('01J...NEW', 'Granny Smith Apple', 'granny smith apple', 'PENDING')`; returns `{ id: "01J...NEW", created: true }`

- **Unit Scenario: UTS-016-A2**
    - **Arrange**: same `normalizedName`; under the lock the `SELECT ... WHERE normalized_name` returns `{ id: "01J...EXISTING" }` (a concurrent add already created it)
    - **Act**: Call `createByName("granny smith apple", "Granny Smith Apple")`
    - **Assert**: No `INSERT` issued; returns `{ id: "01J...EXISTING", created: false }` — concurrent adds of the same normalized name collapse to one row + `id` (REQ-005); `newFoodId` NOT used for a second row

- **Unit Scenario: UTS-016-A3**
    - **Arrange**: the advisory lock is skipped (race) and the `INSERT` hits the `UNIQUE(normalized_name)` index conflict
    - **Act**: Call `createByName(...)`
    - **Assert**: The conflict is handled by re-selecting the existing row; returns `{ created: false }` — the unique index is the durable backstop behind the advisory lock

---

#### Test Case: UTP-016-B (upsertGoldenRecord — atomic multi-table persist + provenance + status)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View (transactional upsert)
**Description**: Verifies `upsertGoldenRecord(foodId, golden, outcome)` writes the golden scalars, upserts each contributing source crosswalk (capturing each `source_id`), replaces nutrients/portions with per-value `source_id`, records scalar-field provenance via MOD-019, assigns categories, and sets the lifecycle status from the merge outcome (`UNRESOLVED` → `'UNRESOLVED'`, else `'RESOLVED'`) — all in one transaction (REQ-054/028).

**Dependency & Mock Registry:**

| Dependency        | Source      | Mock/Stub Strategy                                                      | Rationale                            |
| ----------------- | ----------- | ----------------------------------------------------------------------- | ------------------------------------ |
| `tx`              | Drizzle txn | Mock: each DAO call records args                                        | Verify the ordered atomic writes     |
| `FoodSourcesDao`  | MOD-006     | Mock: `upsertCrosswalk()` returns a `source_id` per contributing source | Anchor per-value provenance          |
| `ProvenanceStore` | MOD-019     | Spy: `recordScalarFields()` records args                                | Verify scalar-field provenance write |

- **Unit Scenario: UTS-016-B1**
    - **Arrange**: `golden` has scalars + 2 contributing sources + nutrients + portions + `fieldProvenance`; `outcome = 'RESOLVED'`; `upsertCrosswalk` returns `"src-1"`/`"src-2"`
    - **Act**: Call `upsertGoldenRecord(foodId, golden, 'RESOLVED')`
    - **Assert**: `FoodDao.updateScalars` called; `upsertCrosswalk` called per contributing source; `FoodNutrientsDao.replaceForFood` / `FoodPortionsDao.replaceForFood` called with `source_id` set; `ProvenanceStore.recordScalarFields(tx, foodId, golden.fieldProvenance)` called; `FoodDao.updateStatus(tx, foodId, 'RESOLVED')` called; returns `{ success: true, status: 'RESOLVED' }`

- **Unit Scenario: UTS-016-B2**
    - **Arrange**: as B1 but `outcome = 'UNRESOLVED'`
    - **Act**: Call `upsertGoldenRecord(foodId, golden, 'UNRESOLVED')`
    - **Assert**: `FoodDao.updateStatus(tx, foodId, 'UNRESOLVED')` called; returns `{ status: 'UNRESOLVED' }` — the food is held as UNRESOLVED for disambiguation

- **Unit Scenario: UTS-016-B3**
    - **Arrange**: `FoodNutrientsDao.replaceForFood` throws a connection error mid-transaction
    - **Act**: Call `upsertGoldenRecord(foodId, golden, 'RESOLVED')`
    - **Assert**: The whole transaction rolls back (no partial scalars/crosswalk persisted); the error propagates so MOD-004 re-queues with backoff

---

#### Test Case: UTP-016-C (findById / getName / updateStatus — read + status delegation)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies `findById(id)` delegates to MOD-006 `findGoldenRecord` (returns `null` for a missing row), `getName(id)` returns the add-by-name string the worker fans out on, and `updateStatus(id, status)` accepts the lifecycle enum (REQ-028).

**Dependency & Mock Registry:**

| Dependency               | Source  | Mock/Stub Strategy                                                                               | Rationale              |
| ------------------------ | ------- | ------------------------------------------------------------------------------------------------ | ---------------------- |
| `FoodPostgresRepository` | MOD-006 | Mock: `findGoldenRecord(id)` returns a record/`null`; `FoodDao.selectName` returns a name/`null` | Isolate DAO from store |

- **Unit Scenario: UTS-016-C1**
    - **Arrange**: `findGoldenRecord("01J...ULID")` returns `null`
    - **Act**: Call `findById("01J...ULID")`
    - **Assert**: Returns `null` (not an error)

- **Unit Scenario: UTS-016-C2**
    - **Arrange**: `FoodDao.selectName("01J...ULID")` returns `"granny smith apple"`
    - **Act**: Call `getName("01J...ULID")`
    - **Assert**: Returns `"granny smith apple"` — the name the worker fans out across adapters (MOD-004)

- **Unit Scenario: UTS-016-C3**
    - **Arrange**: `status = "NOT_FOUND"`, `tombstonedAt` provided
    - **Act**: Call `updateStatus("01J...ULID", "NOT_FOUND", tombstonedAt)`
    - **Assert**: Delegates to `FoodDao.updateStatus` with the lifecycle value + tombstone timestamp; a value outside the enum is rejected at MOD-006 (UTP-006-B)

---

### Module: MOD-017 (GoldenRecordMergeEngine — Field-Level Cross-Source Merge)

**Parent Architecture Modules**: ARCH-015
**Target Source File(s)**: `packages/services/food-service/src/merge/golden-record-merge.engine.ts`
**REQ trace**: REQ-051, REQ-MRG-2, REQ-MRG-3, REQ-050

> **(New.)** Deterministic pure-function merge. Rules: presence beats absence; identity/short fields → higher-priority source (NOT longest); free-text → longer-wins; nutrients normalized to **per-100g** before any blend, conflicts → higher-priority source. Emits the golden record + `RESOLVED`/`UNRESOLVED`/`NOT_FOUND` outcome.

---

#### Test Case: UTP-017-A (merge — empty / non-collapsible / collapsible outcome branches)

**Technique**: Equivalence Partitioning + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (outcome selection)
**Description**: Verifies the three outcome branches of `merge(candidates)`: empty set → `NOT_FOUND`; a non-confidently-collapsible multi-candidate set → `UNRESOLVED` (with the candidate set carried); a confidently collapsible set → `RESOLVED` with an assembled golden record (REQ-050/REQ-RES-3).

**Dependency & Mock Registry:**

| Dependency               | Source   | Mock/Stub Strategy                                          | Rationale                          |
| ------------------------ | -------- | ----------------------------------------------------------- | ---------------------------------- |
| `SourceAdapterRegistry`  | MOD-015  | Mock: `priorityOf(source)` returns a deterministic priority | Drive priority-based field winners |
| `confidentlyCollapsible` | Internal | Spy/real pure function                                      | Drive the collapsible branch       |

- **Unit Scenario: UTS-017-A1**
    - **Arrange**: `candidates = []`
    - **Act**: Call `merge([])`
    - **Assert**: Returns `{ goldenRecord: null, outcome: 'NOT_FOUND' }` (worker tombstones, REQ-025)

- **Unit Scenario: UTS-017-A2**
    - **Arrange**: two candidates that are NOT confidently collapsible (distinct logical items)
    - **Act**: Call `merge(candidates)`
    - **Assert**: Returns `{ outcome: 'UNRESOLVED', candidateSet: candidates }` — surfaced via MOD-018 `/candidates` (REQ-048)

- **Unit Scenario: UTS-017-A3**
    - **Arrange**: two candidates that ARE confidently collapsible (same logical item)
    - **Act**: Call `merge(candidates)`
    - **Assert**: Returns `{ outcome: 'RESOLVED', goldenRecord: <assembled> }`

---

#### Test Case: UTP-017-B (highestPriorityWithValue — identity/short fields → higher-priority source, presence>absence)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View (`highestPriorityWithValue`)
**Description**: Verifies identity/short scalar fields (`name`, `brand_owner`, `brand_name`, `kind`) resolve to the **higher-priority source's** value (NOT the longest), and that a source with no value for the field is skipped (presence beats absence) (REQ-051).

**Dependency & Mock Registry:**

| Dependency              | Source  | Mock/Stub Strategy                                                        | Rationale                  |
| ----------------------- | ------- | ------------------------------------------------------------------------- | -------------------------- |
| `SourceAdapterRegistry` | MOD-015 | Mock: `priorityOf('usda')` → `2`, `priorityOf('opf')` → `1` (usda higher) | Make the winner assertable |

- **Unit Scenario: UTS-017-B1**
    - **Arrange**: candidate A `{ source: 'usda', brand_owner: 'Acme' }` (priority 2), candidate B `{ source: 'opf', brand_owner: 'Acme Foods International Corp' }` (priority 1, longer value)
    - **Act**: Call `highestPriorityWithValue([A, B], 'brand_owner')`
    - **Assert**: Returns A (`'Acme'`) — the **higher-priority** source wins for an identity field even though B's value is longer (REQ-051, NOT longest-wins)

- **Unit Scenario: UTS-017-B2**
    - **Arrange**: candidate A `{ source: 'usda', brand_owner: null }` (higher priority but no value), candidate B `{ source: 'opf', brand_owner: 'Acme' }`
    - **Act**: Call `highestPriorityWithValue([A, B], 'brand_owner')`
    - **Assert**: Returns B (`'Acme'`) — presence beats absence; the higher-priority source is skipped because it has no value

---

#### Test Case: UTP-017-C (longestWithValue — free-text fields → longer-wins)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (`longestWithValue`)
**Description**: Verifies free-text fields (`description`, `ingredients`) resolve to the **longest** value, ties broken by higher priority, and an empty/absent value is skipped (REQ-051).

**Dependency & Mock Registry:**

| Dependency              | Source  | Mock/Stub Strategy               | Rationale    |
| ----------------------- | ------- | -------------------------------- | ------------ |
| `SourceAdapterRegistry` | MOD-015 | Mock: `priorityOf` for tie-break | Resolve ties |

- **Unit Scenario: UTS-017-C1**
    - **Arrange**: A `{ source: 'usda', description: 'Apple' }` (5 chars), B `{ source: 'opf', description: 'Raw red apple, with skin' }` (longer)
    - **Act**: Call `longestWithValue([A, B], 'description')`
    - **Assert**: Returns B — the longer free-text value wins (REQ-051)

- **Unit Scenario: UTS-017-C2**
    - **Arrange**: A and B have **equal-length** descriptions; `priorityOf('usda') > priorityOf('opf')`
    - **Act**: Call `longestWithValue([A(usda), B(opf)], 'description')`
    - **Assert**: Returns A — ties broken by higher priority

---

#### Test Case: UTP-017-D (normalizeToPer100g — basis normalization before nutrient blend)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (`normalizeToPer100g` + nutrient winner)
**Description**: Verifies nutrients are normalized to **per-100g** before any blend and the higher-priority source wins per nutrient code; a `per_serving` value with no serving grams cannot be normalized and is treated as absent (SC-008/REQ-051).

**Dependency & Mock Registry:**

| Dependency              | Source  | Mock/Stub Strategy            | Rationale                   |
| ----------------------- | ------- | ----------------------------- | --------------------------- |
| `SourceAdapterRegistry` | MOD-015 | Mock: `priorityOf` per source | Resolve the nutrient winner |

- **Unit Scenario: UTS-017-D1**
    - **Arrange**: a nutrient with `{ amount: 5, basis: 'per_serving', servingGrams: 50 }`
    - **Act**: Call `normalizeToPer100g(nutrient)`
    - **Assert**: Returns `{ amount: 10, basis: 'per_100g' }` (5 × 100/50) — normalized before blend (SC-008)

- **Unit Scenario: UTS-017-D2**
    - **Arrange**: a nutrient already `{ amount: 0.3, basis: 'per_100g' }`
    - **Act**: Call `normalizeToPer100g(nutrient)`
    - **Assert**: Returns the value unchanged (already per-100g)

- **Unit Scenario: UTS-017-D3**
    - **Arrange**: two candidates with the same nutrient code post-normalization; `priorityOf('usda') > priorityOf('opf')`; usda `amount: 0.3`, opf `amount: 0.4`
    - **Act**: Call `merge(...)` and inspect the nutrient winner
    - **Assert**: `golden.nutrients[code] = { amount: 0.3, basis: 'per_100g', source: 'usda' }` — conflict resolved to the higher-priority source, recorded with its `source` (REQ-051)

- **Unit Scenario: UTS-017-D4**
    - **Arrange**: a `per_serving` nutrient with `servingGrams` missing/0 (cannot normalize)
    - **Act**: Call `merge(...)`
    - **Assert**: That value is treated as absent (presence-as-absence) and does not enter the golden record (SC-008)

---

### Module: MOD-018 (CandidateResolutionService — `/candidates` + PATCH-Resolve)

**Parent Architecture Modules**: ARCH-016
**Target Source File(s)**: `packages/services/food-service/src/candidates/candidate-resolution.service.ts`
**REQ trace**: REQ-048, REQ-049, REQ-IF-010, REQ-IF-011, REQ-052

> **(New.)** Cross-source disambiguation. `getCandidates(id)` lists candidates for an `UNRESOLVED` food; `resolve(id, candidateIds)` **validates each pick belongs to the food's own candidate set** (out-of-set → `409`, status unchanged), drives the merge, stores the pick as ordinary provenance, and moves the food to `RESOLVED`.

---

#### Test Case: UTP-018-A (getCandidates — UNRESOLVED list, empty for non-UNRESOLVED, 404 no row)

**Technique**: Equivalence Partitioning + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies `getCandidates(id)` throws `404` for no row, returns `[]` for a food not in `UNRESOLVED`, and lists the retained per-source candidates (each carrying `source` + that source's item key) for an `UNRESOLVED` food (REQ-048/IF-010).

**Dependency & Mock Registry:**

| Dependency          | Source  | Mock/Stub Strategy                                                         | Rationale                |
| ------------------- | ------- | -------------------------------------------------------------------------- | ------------------------ |
| `FoodDaoRepository` | MOD-016 | Mock: `findById(id)` returns `null`, a `RESOLVED`, or an `UNRESOLVED` food | Drive status branches    |
| `CandidateStore`    | MOD-018 | Mock: `forFood(id)` returns retained candidate rows                        | Supply the candidate set |

- **Unit Scenario: UTS-018-A1**
    - **Arrange**: `findById(id)` returns `null`
    - **Act**: Call `getCandidates(id)`
    - **Assert**: Throws `NotFoundError(404)`

- **Unit Scenario: UTS-018-A2**
    - **Arrange**: `findById(id)` returns `{ status: 'RESOLVED' }`
    - **Act**: Call `getCandidates(id)`
    - **Assert**: Returns `[]` — candidates are only meaningful while `UNRESOLVED`

- **Unit Scenario: UTS-018-A3**
    - **Arrange**: `findById(id)` returns `{ status: 'UNRESOLVED' }`; `forFood(id)` returns `[{ candidateId: 'c1', source: 'usda', externalKey: '534358', name: 'Apple, raw' }]`
    - **Act**: Call `getCandidates(id)`
    - **Assert**: Returns `[{ candidateId: 'c1', source: 'usda', externalKey: '534358', name: 'Apple, raw', summary: undefined }]` — each candidate carries `source` + that source's item key (never `fdcId`)

---

#### Test Case: UTP-018-B (resolve — candidate-set membership rejection (out-of-set → 409, status unchanged))

**Technique**: Error Guessing + Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View + State Machine View (Resolving → Rejected409)
**Description**: Verifies the **candidate-set membership** guard of `resolve(id, candidateIds)` (REQ-049): every pick MUST belong to **this food's own** candidate set; a pick from another food (or unknown) throws `CandidateMismatchError(409)` with the food `status` **unchanged** — preventing cross-food contamination. No merge or persist occurs on the reject path.

**Dependency & Mock Registry:**

| Dependency                | Source  | Mock/Stub Strategy                                                                              | Rationale                         |
| ------------------------- | ------- | ----------------------------------------------------------------------------------------------- | --------------------------------- |
| `FoodDaoRepository`       | MOD-016 | Mock: `findById(id)` returns an `UNRESOLVED` food; Spy: `upsertGoldenRecord` asserts NOT called | Verify status unchanged on reject |
| `CandidateStore`          | MOD-018 | Mock: `idsForFood(id)` returns this food's own candidate id set (`{c1, c2}`)                    | Drive the membership check        |
| `GoldenRecordMergeEngine` | MOD-017 | Spy: `merge()` — assert NOT called on reject                                                    | Verify no merge on out-of-set     |

- **Unit Scenario: UTS-018-B1**
    - **Arrange**: `findById(id)` returns `{ status: 'UNRESOLVED' }`; `idsForFood(id)` returns `Set(['c1', 'c2'])`; `candidateIds = ['c-from-other-food']`
    - **Act**: Call `resolve(id, ['c-from-other-food'])`
    - **Assert**: Throws `CandidateMismatchError(409, "Candidate not in this food's set")`; `GoldenRecordMergeEngine.merge` NOT called; `FoodDaoRepository.upsertGoldenRecord` NOT called — the food `status` is unchanged (REQ-049)

- **Unit Scenario: UTS-018-B2**
    - **Arrange**: `idsForFood(id)` returns `Set(['c1', 'c2'])`; `candidateIds = ['c1', 'c3']` (one in-set, one out-of-set)
    - **Act**: Call `resolve(id, ['c1', 'c3'])`
    - **Assert**: Throws `CandidateMismatchError(409)` — a single out-of-set pick rejects the whole resolve (status unchanged); partial in-set membership does not bypass the guard

- **Unit Scenario: UTS-018-B3**
    - **Arrange**: `findById(id)` returns `null`
    - **Act**: Call `resolve(id, ['c1'])`
    - **Assert**: Throws `NotFoundError(404)` (no row to resolve)

---

#### Test Case: UTP-018-C (resolve — in-set pick drives merge → RESOLVED, user pick = ordinary provenance)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (Merging → Resolved)
**Description**: Verifies that when every pick is in-set, `resolve` fetches the chosen candidates, drives the merge (MOD-017), persists via `upsertGoldenRecord` with `'RESOLVED'` (the user's manual pick stored as **ordinary** provenance, no special-casing), clears the consumed candidate set, and returns `{ status: 'RESOLVED' }` (REQ-049/052).

**Dependency & Mock Registry:**

| Dependency                | Source  | Mock/Stub Strategy                                                      | Rationale                          |
| ------------------------- | ------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `FoodDaoRepository`       | MOD-016 | Spy: `upsertGoldenRecord(id, golden, 'RESOLVED')` records args          | Verify resolve persists RESOLVED   |
| `CandidateStore`          | MOD-018 | Mock: `idsForFood`/`fetch`/`clear`                                      | Supply + consume the candidate set |
| `GoldenRecordMergeEngine` | MOD-017 | Mock: `merge(selected)` returns `{ goldenRecord, outcome: 'RESOLVED' }` | Isolate the merge                  |

- **Unit Scenario: UTS-018-C1**
    - **Arrange**: `findById(id)` returns `{ status: 'UNRESOLVED' }`; `idsForFood(id)` returns `Set(['c1'])`; `candidateIds = ['c1']`; `fetch(id, ['c1'])` returns the chosen `CanonicalCandidate`; `merge` returns `{ goldenRecord, outcome: 'RESOLVED' }`
    - **Act**: Call `resolve(id, ['c1'])`
    - **Assert**: `GoldenRecordMergeEngine.merge` called with the chosen candidate; `FoodDaoRepository.upsertGoldenRecord(id, goldenRecord, 'RESOLVED')` called (the user pick flows through MOD-019 as ordinary provenance, no special flag); `CandidateStore.clear(id)` called; returns `{ id, status: 'RESOLVED' }`

---

### Module: MOD-019 (ProvenanceStore — Per-Field / Value-Grain Provenance)

**Parent Architecture Modules**: ARCH-017
**Target Source File(s)**: `packages/services/food-service/src/provenance/provenance-store.service.ts`
**REQ trace**: REQ-052, REQ-029

> **(New.)** Per-field provenance at the value grain: `source_id` columns on `food_nutrients`/`food_portions`/`food_category_assignment` and the thin `food_field_provenance(food_id, field, source_id)` side-table for scalar fields (controlled `field` enum). "Which fields came from source X" is one query. **No verbatim payload, no EAV.**

---

#### Test Case: UTP-019-A (recordScalarFields — controlled-enum upsert, source_id resolution)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View + Error Handling Return Codes
**Description**: Verifies `recordScalarFields(tx, foodId, fieldProvenance)` resolves each field's winning source to its crosswalk `source_id` and upserts `food_field_provenance` (`ON CONFLICT (food_id, field) DO UPDATE`); a `field` outside the controlled enum is rejected (`ValidationError`) — no EAV/free-form fields (REQ-052).

**Dependency & Mock Registry:**

| Dependency       | Source      | Mock/Stub Strategy                                        | Rationale                     |
| ---------------- | ----------- | --------------------------------------------------------- | ----------------------------- |
| `FoodSourcesDao` | MOD-006     | Mock: `idFor(tx, foodId, source)` returns the `source_id` | Resolve the crosswalk row id  |
| `tx`             | Drizzle txn | Mock: `query(INSERT ... ON CONFLICT)` records args        | Inspect the provenance upsert |

- **Unit Scenario: UTS-019-A1**
    - **Arrange**: `fieldProvenance = { name: 'usda', description: 'usda' }`; `idFor(tx, foodId, 'usda')` returns `"src-1"`
    - **Act**: Call `recordScalarFields(tx, foodId, fieldProvenance)`
    - **Assert**: For each field, `INSERT INTO food_field_provenance (food_id, field, source_id) VALUES ($1, $2, 'src-1') ON CONFLICT (food_id, field) DO UPDATE SET source_id = EXCLUDED.source_id` issued — one provenance row per scalar field, no value column (no EAV)

- **Unit Scenario: UTS-019-A2**
    - **Arrange**: `fieldProvenance = { nonsense_field: 'usda' }` (not in the controlled enum `name|description|kind|brand_owner|brand_name|barcode`)
    - **Act**: Call `recordScalarFields(tx, foodId, fieldProvenance)`
    - **Assert**: Throws `ValidationError` before any write — free-form field names are rejected (no EAV)

- **Unit Scenario: UTS-019-A3**
    - **Arrange**: `idFor(tx, foodId, 'usda')` returns `null` (no crosswalk row for the source)
    - **Act**: Call `recordScalarFields(tx, foodId, { name: 'usda' })`
    - **Assert**: Surfaces a `DataIntegrityError`/FK violation — a provenance write must reference a real `food_sources` row

---

#### Test Case: UTP-019-B (fieldsFromSource — single-query "which fields came from source X", no payload)

**Technique**: Statement & Branch Coverage + Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies `fieldsFromSource(foodId, source)` answers "which fields came from source X" in **one** `UNION` query across scalar field provenance + nutrient `source_id` + portion `source_id`, reading **no payload** (none is retained) (REQ-029).

**Dependency & Mock Registry:**

| Dependency | Source | Mock/Stub Strategy                                              | Rationale                |
| ---------- | ------ | --------------------------------------------------------------- | ------------------------ |
| `Postgres` | pg     | Mock: `query()` returns the unioned field/nutrient/portion rows | Inspect the single query |

- **Unit Scenario: UTS-019-B1**
    - **Arrange**: `foodId`, `source = 'usda'`; `query` returns `[{ field: 'field:name' }, { field: 'nutrient:203' }, { field: 'portion:p1' }]`
    - **Act**: Call `fieldsFromSource(foodId, 'usda')`
    - **Assert**: Issues a single `UNION ALL` query joining `food_field_provenance`/`food_nutrients`/`food_portions` to `food_sources` on `source = $2`; returns the combined `{ field }[]` — one query, no payload read (REQ-029)

---

### Module: MOD-020 (ChangeRefreshConsumer — Change-Driven Refresh)

**Parent Architecture Modules**: ARCH-018
**Target Source File(s)**: `packages/services/food-service/src/refresh/change-refresh.consumer.ts`
**REQ trace**: REQ-031, REQ-032, REQ-053

> **(New.)** EventBridge-scheduled change-driven refresh. For `RESOLVED` foods, re-fetches each backing source item via its adapter and compares `food_sources.item_version`; re-pulls a field **only** when its originating external item changed upstream, never blindly re-blending. Re-enqueues affected foods as **low-priority** `fetch_queue` work (deduped via `ON CONFLICT`).

---

#### Test Case: UTP-020-A (itemChanged — item_version change detection)

**Technique**: Boundary Value Analysis + Statement & Branch Coverage
**Target View**: Algorithmic/Logic View (`itemChanged`)
**Description**: Verifies `itemChanged(source, externalKey, knownVersion)` re-fetches the current item via the adapter (validated by MOD-021) and compares **`itemVersion`** (etag/hash/publicationDate — not a stored raw payload, none is retained): a differing version → `true` (changed), an identical version → `false` (unchanged) (REQ-032/053).

**Dependency & Mock Registry:**

| Dependency              | Source  | Mock/Stub Strategy                                                                  | Rationale                  |
| ----------------------- | ------- | ----------------------------------------------------------------------------------- | -------------------------- |
| `SourceAdapterRegistry` | MOD-015 | Mock: `adapterFor(source)` returns the adapter                                      | Resolve the source adapter |
| `usdaAdapter`           | MOD-008 | Mock: `fetchByKey(externalKey)` returns a candidate with a controlled `itemVersion` | Drive the version compare  |

- **Unit Scenario: UTS-020-A1**
    - **Arrange**: `knownVersion = "2024-10-31"`; `fetchByKey("534358")` returns `{ itemVersion: "2025-01-15" }` (changed upstream)
    - **Act**: Call `itemChanged("usda", "534358", "2024-10-31")`
    - **Assert**: Returns `true` — the external item changed; the food is eligible for re-enqueue (REQ-032)

- **Unit Scenario: UTS-020-A2**
    - **Arrange**: `knownVersion = "2024-10-31"`; `fetchByKey("534358")` returns `{ itemVersion: "2024-10-31" }` (identical)
    - **Act**: Call `itemChanged("usda", "534358", "2024-10-31")`
    - **Assert**: Returns `false` — unchanged upstream; the field is left intact, no re-pull (REQ-031)

---

#### Test Case: UTP-020-B (onScheduled — re-enqueue only changed items as low-priority, preserve unchanged)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: Algorithmic/Logic View + State Machine View (ComparingVersion → ReEnqueuing / LeavingIntact)
**Description**: Verifies `onScheduled()` iterates `RESOLVED` foods' backing items and, for each, re-enqueues a **low-priority** `fetch_queue` row (deduped via `ON CONFLICT`) **only** when `itemChanged` is true — leaving unchanged items (including user-resolved fields) intact with no overwrite (REQ-031/032/053).

**Dependency & Mock Registry:**

| Dependency         | Source   | Mock/Stub Strategy                                                             | Rationale                                |
| ------------------ | -------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| `FoodSourcesDao`   | MOD-006  | Mock: `resolvedBackingItems()` returns 2 crosswalk rows (one changed, one not) | Drive both refresh decisions             |
| `itemChanged`      | Internal | Spy: returns `true` for the first, `false` for the second                      | Control the per-item decision            |
| `FetchQueueRouter` | MOD-003  | Spy: `enqueueLowPriority(foodId, requestedBy)` records args                    | Verify only the changed item re-enqueues |

- **Unit Scenario: UTS-020-B1**
    - **Arrange**: `resolvedBackingItems()` returns `[{ foodId: 'f1', source: 'usda', external_key: 'k1', item_version: 'v1' }, { foodId: 'f2', source: 'usda', external_key: 'k2', item_version: 'v2' }]`; `itemChanged` → `true` for f1, `false` for f2
    - **Act**: Call `onScheduled(event)`
    - **Assert**: `FetchQueueRouter.enqueueLowPriority('f1', 'svc_change_refresh')` called exactly once (changed item, ON CONFLICT dedup); NOT called for `f2` — unchanged item left intact, no overwrite of user-resolved fields (REQ-031/032)

- **Unit Scenario: UTS-020-B2**
    - **Arrange**: `resolvedBackingItems()` returns one item; `usdaAdapter.fetchByKey` throws during the compare (transient source error)
    - **Act**: Call `onScheduled(event)`
    - **Assert**: That item is skipped this cycle (no enqueue, field left intact); the scan continues — retried on the next scheduled run (idempotent, no overwrite)

---

### Module: MOD-021 (AdapterInputValidator — Source-Boundary Validation & Transport Security)

**Parent Architecture Modules**: ARCH-019
**Target Source File(s)**: `packages/services/food-service/src/sources/adapter-input-validator.ts`
**REQ trace**: REQ-055, REQ-024, REQ-032 (refresh validation)

> **(New.)** Source-boundary validation + transport security used inside each adapter's `mapToCanonical`: type/range/length checks + text sanitization before any value enters the canonical store; HTTPS with cert validation on outbound fetches; **reject-not-store** on a response that fails validation. Preserves nutrient fidelity beyond per-100g basis normalization.

---

#### Test Case: UTP-021-A (assertHttps — HTTPS reject on non-HTTPS / cert failure)

**Technique**: Equivalence Partitioning + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling Return Codes
**Description**: Verifies `assertHttps(url)` throws `TransportSecurityError` for a non-HTTPS URL and accepts an `https://` URL (cert validation is delegated to the platform `fetch`/undici, which rejects on cert failure) (REQ-055).

**Dependency & Mock Registry:** None — `assertHttps` is a pure scheme check (no I/O beyond inspecting the URL).

- **Unit Scenario: UTS-021-A1**
    - **Arrange**: `url = "http://api.nal.usda.gov/fdc/v1"` (plain HTTP)
    - **Act**: Call `assertHttps("http://api.nal.usda.gov/fdc/v1")`
    - **Assert**: Throws `TransportSecurityError("Non-HTTPS source URL refused")` — the fetch is refused; the candidate is dropped (REQ-055)

- **Unit Scenario: UTS-021-A2**
    - **Arrange**: `url = "https://api.nal.usda.gov/fdc/v1"`
    - **Act**: Call `assertHttps("https://api.nal.usda.gov/fdc/v1")`
    - **Assert**: Does not throw (HTTPS scheme accepted; platform `fetch` enforces cert validation)

---

#### Test Case: UTP-021-B (validateAndSanitize — reject-not-store on out-of-bounds values)

**Technique**: Boundary Value Analysis + Equivalence Partitioning + Error Guessing
**Target View**: Algorithmic/Logic View + Internal Data Structures (length/range caps)
**Description**: Verifies `validateAndSanitize(mapped)` accepts an in-bounds candidate (returning the cleaned `CanonicalCandidate`) and **rejects-not-stores** (`ValidationError`) on each out-of-bounds class: empty/over-length name, non-finite/negative/over-range nutrient amount, invalid `kind`/`basis`, and a non-positive portion gram weight (REQ-055).

**Dependency & Mock Registry:** None — `validateAndSanitize` is a pure validation/sanitization function.

- **Unit Scenario: UTS-021-B1**
    - **Arrange**: a fully valid `mapped` candidate (`name` "Apple, raw", `kind` "generic", one finite per-100g nutrient `amount: 0.3`, one portion `gramWeight: 125`)
    - **Act**: Call `validateAndSanitize(mapped)`
    - **Assert**: Returns the cleaned `CanonicalCandidate` (sanitized text, all fields preserved); no throw

- **Unit Scenario: UTS-021-B2**
    - **Arrange**: `mapped.name = ""` (empty, min boundary)
    - **Act**: Call `validateAndSanitize(mapped)`
    - **Assert**: Throws `ValidationError("name out of bounds")` — reject-not-store; the food may still resolve from other candidates

- **Unit Scenario: UTS-021-B3**
    - **Arrange**: `mapped.name` of length `513` (over `MAX_NAME_LEN = 512`, max+1)
    - **Act**: Call `validateAndSanitize(mapped)`
    - **Assert**: Throws `ValidationError` — over-length name rejected (boundary max+1)

- **Unit Scenario: UTS-021-B4**
    - **Arrange**: a nutrient with `amount = -1` (negative)
    - **Act**: Call `validateAndSanitize(mapped)`
    - **Assert**: Throws `ValidationError("nutrient amount out of range: ...")` — no malformed value enters the store (REQ-055)

- **Unit Scenario: UTS-021-B5**
    - **Arrange**: a nutrient with `amount = 1e6 + 1` (over `NUTRIENT_AMOUNT_MAX = 1e6`, max+1) or `amount = NaN` (non-finite)
    - **Act**: Call `validateAndSanitize(mapped)`
    - **Assert**: Throws `ValidationError` — out-of-range / non-finite rejected

- **Unit Scenario: UTS-021-B6**
    - **Arrange**: `mapped.kind = "unknown"` (not in `['generic','branded']`)
    - **Act**: Call `validateAndSanitize(mapped)`
    - **Assert**: Throws `ValidationError("invalid kind")`

- **Unit Scenario: UTS-021-B7**
    - **Arrange**: a portion with `gramWeight = 0` (non-positive)
    - **Act**: Call `validateAndSanitize(mapped)`
    - **Assert**: Throws `ValidationError("invalid portion gram weight")`

---

#### Test Case: UTP-021-C (sanitizeText — control-char/whitespace sanitization, fidelity preserved)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View (`sanitizeText`)
**Description**: Verifies `sanitizeText(s)` strips control chars / null bytes and normalizes whitespace (sanitize, not reject) while preserving the meaningful content — no lossy rounding of nutrient values beyond the basis normalization done in the merge (SC-008).

**Dependency & Mock Registry:** None — `sanitizeText` is a pure function.

- **Unit Scenario: UTS-021-C1**
    - **Arrange**: `s` contains a null byte, a tab, and repeated newlines around `"Apple ,  raw"`
    - **Act**: Call `sanitizeText(s)`
    - **Assert**: Returns `"Apple, raw"` — control chars/null bytes stripped, whitespace normalized; the value is sanitized in place (not rejected) and its content preserved

- **Unit Scenario: UTS-021-C2**
    - **Arrange**: a sanitized candidate flows through to `validateAndSanitize`; a finite per-100g nutrient `amount: 0.30003`
    - **Act**: Call `validateAndSanitize(mapped)`
    - **Assert**: The nutrient `amount` is carried through **unrounded** (`0.30003`) — no lossy rounding at the validation boundary; fidelity preserved beyond basis normalization (SC-008)

---

## Coverage Summary

| Metric                                                                 | Count                                                                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total MOD modules                                                      | 21 (MOD-001..MOD-021)                                                                                                                                         |
| MOD modules requiring unit coverage                                    | 21 (MOD-009 is launch-deferred but scaffolded — covered)                                                                                                      |
| MODs with at least one UTP                                             | 21 / 21 (100%)                                                                                                                                                |
| Total Unit Test Cases (UTP)                                            | 72                                                                                                                                                            |
| Total Unit Test Scenarios (UTS)                                        | 201                                                                                                                                                           |
| UTPs preserved (auth slice MOD-012/013/014, re-keyed `fdcId → id`)     | 15 (UTP-012-A..J + UTP-014-A..E)                                                                                                                              |
| UTPs rewritten/re-keyed (MOD-001..011 to the new design)               | 36 (UTP-001-A..H, UTP-002-A..D, UTP-003-A..D, UTP-004-A..C, UTP-005-A..C, UTP-006-A..D, UTP-007-A..B, UTP-008-A..C, UTP-009-A..B, UTP-010-A..C, UTP-011-A..B) |
| UTPs added (new modules MOD-015..021)                                  | 21 (UTP-015-A..B, UTP-016-A..C, UTP-017-A..D, UTP-018-A..C, UTP-019-A..B, UTP-020-A..B, UTP-021-A..C)                                                         |
| Modules where `fdcId` appears as a live data key (must be exactly one) | 1 (MOD-008 only — REQ-046/SC-013)                                                                                                                             |
| Techniques applied                                                     | Statement & Branch Coverage, Boundary Value Analysis, Equivalence Partitioning, Strict Isolation, State Transition Testing, Error Guessing                    |

## Technique Distribution

| Technique                   | UTP Count |
| --------------------------- | --------- |
| Statement & Branch Coverage | 59        |
| Boundary Value Analysis     | 18        |
| Equivalence Partitioning    | 20        |
| Strict Isolation            | 20        |
| State Transition Testing    | 13        |
| Error Guessing              | 17        |

> Note: Many UTPs apply multiple techniques simultaneously; counts reflect primary + secondary technique pairings (a UTP is counted once per technique it names).

## Test-first task → UTP map (TC markers)

`tasks.md` does not use literal `TC-*` strings; its **`[Test-first: true]` TDD tasks** are the red-gate tests,
and each maps to one or more `UTP-*` test-case markers in this plan (via the shared MOD + REQ/FR trace). This
table is the authoritative map an implementer follows to write the failing unit test first.

| tasks.md Test-first task                                   | MOD               | UTP markers (write these failing first)                          |
| ---------------------------------------------------------- | ----------------- | ---------------------------------------------------------------- |
| T-003 (`@kitchensink/usda-client`) / T-121 (USDA adapter)  | MOD-008           | UTP-008-A, UTP-008-B, UTP-008-C                                  |
| T-100 / T-102 (canonical schema + migration)               | MOD-006           | UTP-006-A, UTP-006-B, UTP-006-D                                  |
| T-101 / T-103 (operational tables)                         | MOD-003           | UTP-003-A, UTP-003-B, UTP-003-C                                  |
| T-104 (indexes — search/lifecycle/queue)                   | MOD-006           | UTP-006-C                                                        |
| T-105 (`FoodDao`)                                          | MOD-016           | UTP-016-A, UTP-016-C                                             |
| T-106 (`FoodSourcesDao` crosswalk)                         | MOD-006           | UTP-006-C, UTP-006-D                                             |
| T-107 (`NutrientDao`/`FoodNutrientsDao` per-100g)          | MOD-017           | UTP-017-D                                                        |
| T-108 (`FoodFieldProvenanceDao` "which fields from X")     | MOD-019           | UTP-019-A, UTP-019-B                                             |
| T-109 (`FetchQueueDao`/`FetchRequestersDao` drain/demand)  | MOD-003 / MOD-013 | UTP-003-B, UTP-003-D, UTP-012-G                                  |
| T-110 (`SourceCallLogDao` rolling window)                  | MOD-005           | UTP-005-A, UTP-005-B                                             |
| T-120 (`FoodSourceAdapter` interface + registry)           | MOD-015           | UTP-015-A, UTP-015-B                                             |
| T-122 (per-source rolling-window limiter)                  | MOD-005           | UTP-005-A, UTP-005-C                                             |
| T-130 / T-131 (`FoodsController` + `GET /v1/foods/{id}`)   | MOD-001           | UTP-001-A, UTP-001-B                                             |
| T-132 (`GET /v1/foods/{id}/status`)                        | MOD-001           | UTP-001-D                                                        |
| T-133 (`GET /v1/foods/{id}/candidates`)                    | MOD-001 / MOD-018 | UTP-001-H, UTP-018-A                                             |
| T-134 (`GET /v1/foods/search`)                             | MOD-001 / MOD-006 | UTP-001-E, UTP-006-C                                             |
| T-140 (`POST /v1/foods` add-by-name + advisory-lock dedup) | MOD-001 / MOD-016 | UTP-001-C, UTP-016-A                                             |
| T-141 (`EnqueueEmitter`)                                   | MOD-002           | UTP-002-A, UTP-002-B, UTP-002-C                                  |
| T-142 (`PATCH /v1/foods/{id}` resolve)                     | MOD-001 / MOD-018 | UTP-001-G, UTP-018-B, UTP-018-C                                  |
| T-143 (`POST /v1/foods/batch` per-item partial)            | MOD-001           | UTP-001-F                                                        |
| T-144 (queue backpressure + circuit breaker)               | MOD-013           | UTP-012-H                                                        |
| T-151 (drain loop + demotion)                              | MOD-013 / MOD-003 | UTP-012-E, UTP-003-B                                             |
| T-152 (fan-out across adapter registry)                    | MOD-004 / MOD-015 | UTP-004-A, UTP-004-B, UTP-015-A                                  |
| T-153 (lease watchdog + tombstone/backoff)                 | MOD-003 / MOD-004 | UTP-003-C, UTP-004-B                                             |
| T-160 (merge engine field-level)                           | MOD-017           | UTP-017-A, UTP-017-B, UTP-017-C, UTP-017-D                       |
| T-161 (provenance writer)                                  | MOD-019           | UTP-019-A, UTP-019-B                                             |
| T-162 (pre-merge dedup + auto-resolve)                     | MOD-017 / MOD-004 | UTP-017-A, UTP-004-C                                             |
| T-163 (manual-resolution merge path)                       | MOD-018           | UTP-018-C                                                        |
| T-164 (input validation + HTTPS at boundary)               | MOD-021           | UTP-021-A, UTP-021-B, UTP-021-C                                  |
| T-171 (change detection on refresh)                        | MOD-020           | UTP-020-A, UTP-020-B                                             |
| T-172 (`UNRESOLVED` 30-day TTL sweep)                      | MOD-020 / MOD-006 | UTP-020-B, UTP-006-B                                             |
| T-033 (`FoodAuthGuard` networkless verify)                 | MOD-012           | UTP-012-A, UTP-012-B, UTP-012-C, UTP-012-D, UTP-012-I, UTP-012-J |
| (async-producer provenance leg)                            | MOD-014           | UTP-014-A, UTP-014-B, UTP-014-C, UTP-014-D, UTP-014-E            |

> Tasks marked `[Test-first: false]` (e.g. T-145 admin refetch, T-150/T-154/T-155 worker scaffold/success-path,
> T-165 event emission, T-170 refresh scheduler) are exercised by the listed UTPs of their parent MOD but do not
> gate on a red unit test of their own; their behavior is covered at the integration/system layer.

---

_End of Unit Test Plan — 003-usda-food-data (re-baselined 2026-06-22 to the source-agnostic food data model)_
