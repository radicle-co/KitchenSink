# V-Model Traceability Matrix: Source-Agnostic Food Data Integration

**Feature Branch**: `003-usda-food-data`
**Generated**: 2026-05-09
**Status**: Draft — Pending Execution — **re-baselined 2026-06-22 to the source-agnostic food data model**
**Traceability Standard**: ISO 29119 / V-Model bidirectional coverage

> **Re-baseline note (2026-06-22).** This artifact — the **closing leg of the V-Model V&V chain** — was
> regenerated end-to-end after every upstream layer was re-baselined to the **source-agnostic food data
> redesign** (spec.md / plan.md re-baselined 2026-06-21). The full chain it now traces is:
>
> ```
> requirements.md (REQ-001..055 + NF/IF/CN)
>   ↕ system-design.md (SYS-001..020)
>     ↕ architecture-design.md (ARCH-001..019)
>       ↕ module-design.md (MOD-001..021)
>         ↕ unit-test.md (UTP) / integration-test.md (ITP) / system-test.md (STP) / acceptance-plan.md (AT/ATP)
>           ↕ hazard-analysis.md (HAZ-001..047)
> ```
>
> A food is now keyed by an internal surrogate `id` (ULID-valued, named `id`); **USDA is one pluggable
> source adapter** among many; foods are assembled into a **cross-source golden record** with per-field
> provenance; users add foods **by name** through a `PENDING → (UNRESOLVED) → RESOLVED` lifecycle (terminal
> `NOT_FOUND` / `FAILED`). **`fdcId` / `fetch_status` / denormalized-nutrient-column references are removed
> from the canonical chain and confined to the USDA-adapter boundary** — they survive in this matrix **only**
> on the adapter-boundary rows (SYS-009/SYS-014 ↔ ARCH-008/ARCH-013 ↔ MOD-008 ↔ UTP-008-_ / ITP-008-_ /
> ITP-013-B; REQ-023/REQ-IF-004). Every other row is keyed on the internal `id`.
>
> **Preserved (re-keyed) vs new.** REQ-001..044/NF/IF/CN preserved (re-keyed); **REQ-045..055, REQ-IF-009..012,
> REQ-CN-007 are new**. SYS-001..013 / ARCH-001..012 / MOD-001..014 preserved (re-keyed); **SYS-014..020,
> ARCH-013..019, MOD-015..021 are new**. The auth slice (REQ-035/037a–d/038a–c/039/040a–b/041/042/043/044a–d,
> REQ-IF-007/008 ↔ SYS-013 ↔ ARCH-012 ↔ MOD-012/013/014) is **fully connected and preserved verbatim-in-intent**.
> No existing id was renumbered.

---

## Artifact Information

| Artifact                   | File                                                      | Re-baselined | Status     | Scope                                                                                                                           |
| -------------------------- | --------------------------------------------------------- | ------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Requirements Specification | `specs/003-usda-food-data/v-model/requirements.md`        | 2026-06-22   | Draft      | 63 FR + 18 NF + 12 IF + 7 CN = 100 total (new REQ-045..055, REQ-IF-009..012, REQ-CN-007; auth slice preserved)                  |
| System Design              | `specs/003-usda-food-data/v-model/system-design.md`       | 2026-06-22   | Referenced | SYS-001..020 (new SYS-014..020: adapter registry, merge engine, candidate/resolve, provenance, DAO, change-refresh, validation) |
| Architecture Design        | `specs/003-usda-food-data/v-model/architecture-design.md` | 2026-06-22   | Referenced | ARCH-001..019 (new ARCH-013..019; ARCH-012 = FoodAuthGuard → MOD-012/013/014)                                                   |
| Module Design              | `specs/003-usda-food-data/v-model/module-design.md`       | 2026-06-22   | Referenced | MOD-001..021 (new MOD-015..021; ARCH-012 decomposes into MOD-012/013/014)                                                       |
| Unit Test Plan             | `specs/003-usda-food-data/v-model/unit-test.md`           | 2026-06-22   | Draft      | 21 MODs, 72 UTP cases (UTP-001-A..H … UTP-021-A..C); auth UTP-012-A..J + UTP-014-A..E                                           |
| Integration Test Plan      | `specs/003-usda-food-data/v-model/integration-test.md`    | 2026-06-22   | Draft      | ITP-001-_ .. ITP-019-_ at the MOD/ARCH boundaries (incl. ITP-013-B `fdcId`-confinement, ITP-012-\_ auth)                        |
| System Test Plan           | `specs/003-usda-food-data/v-model/system-test.md`         | 2026-06-22   | Draft      | STP-001-_ .. STP-010-_ end-to-end scenarios                                                                                     |
| Acceptance Test Plan       | `specs/003-usda-food-data/v-model/acceptance-plan.md`     | 2026-06-22   | Draft      | AT-\_ functional + ATP-008-A..I auth (US-0) + AT-NF\* cases for all P1/P2 REQ                                                   |
| Hazard Analysis (FMEA)     | `specs/003-usda-food-data/v-model/hazard-analysis.md`     | 2026-06-22   | Referenced | HAZ-001..047 (new HAZ-042..047: merge coherence/poisoning/wrong-merge, add-race, refresh-clobber, untrusted-data)               |

**Legend**: ⬜ Pending Execution — defined, not yet run · ✅ Passed · ❌ Failed · ⚠️ Partially Passed

---

## V-Model Level-Pair Trace Checkpoints

> Each adjacent V-Model layer pair is checked for **forward** completeness (every parent element decomposes
> downward) and **backward** completeness (every child traces up to a parent). A checkpoint passes only when
> both directions hold with **no orphans on either side**.

### Checkpoint REQ ↔ SYS (requirements.md ↔ system-design.md)

- **Forward (REQ → SYS):** every REQ is claimed by at least one SYS `Parent Requirements` cell. The new
  capability requirements land cleanly: add-by-name + dedup REQ-005/REQ-013/REQ-047 → SYS-001/SYS-018;
  candidates/resolve REQ-048/REQ-049 → SYS-016; fan-out + golden-record merge REQ-050/REQ-051 →
  SYS-005/SYS-015; provenance REQ-052 → SYS-017; change-driven refresh REQ-031/REQ-032/REQ-053 → SYS-019
  (+ SYS-002 scheduler); adapter interface + `fdcId` confinement REQ-046/REQ-054/REQ-CN-007 → SYS-014;
  input validation REQ-055/REQ-NF-018 → SYS-020; identity REQ-045 → SYS-007/SYS-014 (canonical `id` PK,
  `external_key` crosswalk). Auth REQ-035..044/IF-007/IF-008 → SYS-013.
- **Backward (SYS → REQ):** every SYS-001..020 lists ≥1 `REQ-*` parent (system-design Decomposition View).
  New SYS-014..020 each cite their originating new REQ. **No orphan SYS component.**
- **Result: PASS.** 100 REQ → 20 SYS; 20 SYS → REQ. `fdcId` appears in a SYS cell **only** at SYS-009
  (UsdaSourceApi) and SYS-014 (SourceAdapterRegistry, as the confinement boundary).

### Checkpoint SYS ↔ ARCH (system-design.md ↔ architecture-design.md)

- **Forward (SYS → ARCH):** the architecture's _SYS → ARCH Coverage Summary_ maps all 20 SYS to 19 ARCH
  modules (SYS-002 is covered by ARCH-002 + ARCH-003 + ARCH-018; SYS-014 by ARCH-013 + ARCH-008). New
  SYS-014..020 → new ARCH-013..019 one-to-one.
- **Backward (ARCH → SYS):** every ARCH-001..019 lists `Parent System Components`. Cross-cutting modules
  (ARCH-005/009/010/011/012/019) carry an explicit `[CROSS-CUTTING]` tag with rationale rather than a bare SYS.
- **Result: PASS.** No orphan ARCH module; no SYS left uncovered. `fdcId` confined to ARCH-008/ARCH-013.

### Checkpoint ARCH ↔ MOD (architecture-design.md ↔ module-design.md)

- **Forward (ARCH → MOD):** every ARCH-001..019 decomposes to ≥1 MOD. ARCH-012 (FoodAuthGuard) fans out to
  **three** modules — MOD-012 (`ClerkAuthMiddleware`), MOD-013 (`DemotionAndFairness`), MOD-014
  (`AsyncProducerAuthz`); every other ARCH maps to exactly one MOD. New ARCH-013..019 → MOD-015..021.
- **Backward (MOD → ARCH):** every MOD-001..021 declares one `Parent ARCH`. The prior SYS-parent skew
  (MODs that had mapped ARCH-006→SYS-006, ARCH-007→SYS-007) is corrected per the architecture coverage table
  (ARCH-006→SYS-007, ARCH-007→SYS-008, ARCH-008→SYS-009, ARCH-009→SYS-010, ARCH-010→SYS-011,
  ARCH-011→SYS-012).
- **Result: PASS.** 19 ARCH → 21 MOD; 21 MOD → 19 ARCH. No orphan MOD.

### Checkpoint MOD ↔ UTP (module-design.md ↔ unit-test.md)

- **Forward (MOD → UTP):** every MOD-001..021 has ≥1 UTP case (see Matrix D). MOD-013's tests live under the
  combined "MOD-012 + MOD-013" unit-test section as **UTP-012-E..J**; MOD-014 is **UTP-014-A..E**.
- **Backward (UTP → MOD):** every UTP case derives its MOD from its id (`UTP-0NN-X → MOD-0NN`), except the
  auth-family `UTP-012-E..J` which test MOD-013 and `UTP-014-*` which test MOD-014 — both explicitly anchored
  by their unit-test section headers.
- **Result: PASS.** No orphan UTP; every MOD covered.

### Checkpoint MOD/ARCH ↔ ITP (module-design.md / architecture-design.md ↔ integration-test.md)

- **Forward:** each MOD-boundary in the architecture Dependency View has an ITP case (Matrix C). New
  boundaries are covered: registry fan-out ITP-013-A + `fdcId`-confinement ITP-013-B; DAO seam ITP-014-A/B;
  merge ITP-015-A/B; candidate/resolve ITP-016-A/B/C; provenance ITP-017-A/B; change-refresh ITP-018-A/B;
  adapter validation ITP-019-A/B.
- **Backward:** every ITP-0NN-X names its source/target ARCH/MOD boundary in its title. **No orphan ITP.**
- **Result: PASS.**

### Checkpoint REQ ↔ AT/STP (requirements.md ↔ acceptance-plan.md / system-test.md)

- **Forward (REQ → AT/STP):** every P1/P2 REQ with verification method _Test_ has an AT case (Matrix A) or
  an STP scenario; Inspection/Analysis/Demonstration REQ are flagged (Coverage Audit) and not gaps.
- **Backward (AT → REQ):** every AT/ATP case maps to a REQ by the `AT-NNN-X → REQ-NNN` convention or an
  explicit Tier-2 REQ heading (Matrix B). **No orphan AT.**
- **Result: PASS** (with the documented Inspection/Analysis/Demonstration set carried as non-gaps).

### Checkpoint HAZ ↔ REQ ↔ Test (hazard-analysis.md ↔ requirements/tests)

- Every HAZ-001..047 carries a `REQ` mitigation set and a `MOD`/test control (Matrix H). New HAZ-042..047
  cover the new failure surface (merge basis-incoherence, source-data poisoning, wrong-merge, add-by-name
  race, refresh clobbering a human pick, untrusted source data) and each traces to a new REQ + new MOD + new
  test. **No orphan hazard, no unmitigated hazard.**
- **Result: PASS.**

---

## Matrix A: Forward Traceability (REQ → Acceptance Test)

> Maps every requirement to its acceptance test case(s). Gaps indicate requirements with no acceptance coverage
> (flagged as Inspection/Analysis non-gaps in the Coverage Audit).

### Functional Requirements

| REQ-ID     | Requirement (Summary)                                                                                                                                                                            | Priority | AT/ATP-ID                                           | Verification Method           | Status |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------- | ----------------------------- | ------ |
| REQ-001    | Local-store-only serving; no external source called in the request path                                                                                                                          | P1       | AT-001-A                                            | Interface Contract Testing    | ⬜     |
| REQ-002    | `200 OK` with complete golden-record data only when `status='RESOLVED'`                                                                                                                          | P1       | AT-002-A                                            | Equivalence Partitioning      | ⬜     |
| REQ-003    | `202 Accepted` when food is `PENDING` or `UNRESOLVED`                                                                                                                                            | P1       | AT-003-A                                            | Equivalence Partitioning      | ⬜     |
| REQ-004    | `404 Not Found` when `NOT_FOUND`/`FAILED`/absent; `status` still retrievable, no enqueue                                                                                                         | P1       | AT-004-A                                            | Equivalence Partitioning      | ⬜     |
| REQ-005    | `POST /v1/foods` add-by-name → create row + `id`, `202`; normalized-name dedup under a short lock                                                                                                | P1       | AT-005-A, AT-005-B                                  | Equivalence Partitioning      | ⬜     |
| REQ-006    | `400` for malformed ULID `id` / empty-or-whitespace name; nothing reaches `fetch_queue`                                                                                                          | P1       | AT-006-A                                            | Boundary Value Analysis       | ⬜     |
| REQ-007    | `GET /v1/foods/{id}/status` returns lifecycle `status` (+ full data when `RESOLVED`)                                                                                                             | P2       | AT-007-A                                            | Equivalence Partitioning      | ⬜     |
| REQ-008    | `GET /v1/foods/search` (pg_trgm) returns canonical `id`s; barcode / `external_key` lookup via crosswalk                                                                                          | P1       | AT-008-A, AT-008-B                                  | Equivalence Partitioning      | ⬜     |
| REQ-009    | Search never calls an external source; local store only                                                                                                                                          | P1       | AT-009-A                                            | Interface Contract Testing    | ⬜     |
| REQ-010    | Search ranked + within 200ms for up to 50,000 foods                                                                                                                                              | P1       | AT-010-A                                            | Performance Measurement       | ⬜     |
| REQ-011    | Single add-by-name miss enqueues directly into `fetch_queue` (`INSERT … ON CONFLICT` + `pg_notify`); not EventBridge                                                                             | P1       | AT-005-A (enqueue handshake)                        | Interface Contract Testing    | ⬜     |
| REQ-012    | Multi-food add → one row + `id` per unknown name, each enqueued; per-item partial result                                                                                                         | P1       | AT-012-A                                            | Interface Contract Testing    | ⬜     |
| REQ-013    | Dedup at two grains: normalized-name collapse (lock) + queue-grain `ON CONFLICT`                                                                                                                 | P1       | AT-005-B                                            | Fault Injection / Concurrency | ⬜     |
| REQ-014    | Single demand-weighted `fetch_queue` keyed on `id`; atomic admission (backpressure + distinct-requester + `ON CONFLICT` + notify)                                                                | P1       | AT-015-A, AT-040-B                                  | Interface Contract Testing    | ⬜     |
| REQ-015    | Worker drains by capped distinct-requester demand (`request_count` DESC, `first_requested` ASC) + dynamic demotion                                                                               | P1       | AT-015-A                                            | Equivalence Partitioning      | ⬜     |
| REQ-016    | Up to 5 attempts w/ backoff → `FAILED` + tombstone; no-source fan-out → `NOT_FOUND` immediately                                                                                                  | P1       | AT-027-A, AT-016-A, AT-025-A                        | Fault Injection               | ⬜     |
| REQ-017    | Single shared 30s `in_flight` lease; stale `in_flight` reverts to `pending`                                                                                                                      | P1       | _(Inspection — covered by STP-005 lease reclaim)_   | Inspection                    | ⬜     |
| REQ-018    | Tombstone rows + `NOT_FOUND` records retained for a configurable 30-day TTL                                                                                                                      | P1       | AT-025-A (TTL re-attempt)                           | Inspection                    | ⬜     |
| REQ-019    | Per-source rolling 60-min window (USDA ≤1,000); worker pauses that source at 90% (900)                                                                                                           | P1       | AT-019-A                                            | Performance Measurement       | ⬜     |
| REQ-020    | Per-source check-and-record is atomic                                                                                                                                                            | P1       | AT-020-A (+ unit UTP-005-A)                         | Test                          | ⬜     |
| REQ-021    | Worker defers the row when a source's window is at cap; makes no source call                                                                                                                     | P1       | AT-021-A                                            | Fault Injection               | ⬜     |
| REQ-022    | Single active Fargate consumer (Postgres advisory lock)                                                                                                                                          | P1       | _(Inspection — covered by UTP-003-D)_               | Inspection                    | ⬜     |
| REQ-023    | **USDA adapter** uses `GET /v1/food/{fdcId}` single + `POST /v1/foods` ≤20 batch; 1 windowed call/call; `fdcId → external_key`                                                                   | P1       | AT-023-A                                            | Interface Contract Testing    | ⬜     |
| REQ-024    | Source `200` → map to canonical (validated), confident merge → `RESOLVED`, crosswalk row, emit `FoodDataReceived`; no payload retained                                                           | P1       | AT-024-A, AT-050-A                                  | Interface Contract Testing    | ⬜     |
| REQ-025    | No source has it → `NOT_FOUND` + tombstone (30-day TTL); re-attempt after TTL, `404` within TTL                                                                                                  | P1       | AT-025-A                                            | Fault Injection               | ⬜     |
| REQ-026    | Source `429` → treat that source's window full, back off, leave row pending                                                                                                                      | P1       | AT-026-A                                            | Fault Injection               | ⬜     |
| REQ-027    | Source `5xx`/timeout → backoff retry; `FAILED` + tombstone after the budget                                                                                                                      | P1       | AT-027-A                                            | Fault Injection               | ⬜     |
| REQ-028    | Normalized, provenance-bearing canonical schema (`food`, `food_sources`, `nutrient`, `food_nutrients`, `food_portions`, `food_field_provenance`, `food_category`); no `fdcId`/`fetch_status`/EAV | P1       | AT-052-A (provenance answerable)                    | Inspection                    | ⬜     |
| REQ-029    | Index canonical tables for `id`, `status`, `normalized_name` (unique), `(source, external_key)`, FK columns, trigram GIN; provenance answerable in one query                                     | P1       | AT-052-A, AT-010-A (latency probe)                  | Test                          | ⬜     |
| REQ-030    | Redis cache (deferred) key `food:{id}`, TTL 24h, `allkeys-lfu`                                                                                                                                   | P2       | _(Inspection — deferred variant)_                   | Inspection                    | ⬜     |
| REQ-031    | Change-driven refresh: update a field only when its source item changed upstream; preserve user/unchanged values; no max-staleness cutoff                                                        | P2       | AT-031-A, AT-031-B                                  | Equivalence Partitioning      | ⬜     |
| REQ-032    | Scheduled `IngestionScheduled` rule triggers change-driven refresh; changed fields re-enqueued low-priority                                                                                      | P2       | AT-031-A                                            | Equivalence Partitioning      | ⬜     |
| REQ-033    | Client polling via `GET /v1/foods/{id}` / `/status` as primary notification                                                                                                                      | P2       | AT-007-A                                            | Equivalence Partitioning      | ⬜     |
| REQ-034    | Optional WebSocket push via API Gateway WebSocket API (deferred)                                                                                                                                 | P3       | _(Demonstration — deferred US-9)_                   | Demonstration                 | ⬜     |
| REQ-035    | All `/v1/foods/*` require in-process NestJS `AuthMiddleware`/`FoodAuthGuard`; `401` unauthenticated                                                                                              | P1       | ATP-008-A                                           | Interface Contract Testing    | ⬜     |
| REQ-037a–d | Every entry point requires a networklessly-verified Clerk token (`azp`); identity from verified `sub`; fail-closed `401`, no enqueue/source call                                                 | P1       | ATP-008-A, ATP-008-B, ATP-008-C, ATP-008-D          | Interface Contract Testing    | ⬜     |
| REQ-038a–c | All authed users read shared data; operational endpoints need elevated scope (`403`); precedence `401→403→400→404/202/200`                                                                       | P1       | ATP-008-G                                           | Equivalence Partitioning      | ⬜     |
| REQ-039    | Fairness by demotion, not rejection: `sub` with >50 pending ranked to back (dynamic, drain-time); no per-user `429`                                                                              | P1       | ATP-008-F                                           | Performance Measurement       | ⬜     |
| REQ-040a–b | Batch ≤100 names → `400` over limit, per-item partial accepted; queue-depth/circuit-breaker → `503` fail-closed                                                                                  | P1       | ATP-008-I (400), AT-040-B (503), AT-012-A (partial) | Boundary Value Analysis       | ⬜     |
| REQ-041    | Server-initiated callers authenticate via Clerk M2M token (azp-allowlisted); endpoints classified user/service/both                                                                              | P1       | ATP-008-H                                           | Interface Contract Testing    | ⬜     |
| REQ-042    | Only named least-privilege principals publish events / insert into `fetch_queue`; consumer validates provenance                                                                                  | P1       | ATP-008-A (async leg)                               | Interface Contract Testing    | ⬜     |
| REQ-043    | WebSocket `$connect` authenticates (pinned `403`); `FoodDataReceived` delivered only to requesters (`fetch_requesters`), never broadcast                                                         | P1       | ATP-008-E                                           | State Transition Testing      | ⬜     |
| REQ-044a–d | Auth bounds verification concurrency + per-source `401`-rate cap; SC-011 ≤10ms p95 under invalid-token flood; named first-class component                                                        | P1       | ATP-008-B, ATP-008-C (+ unit UTP-012-I)             | Performance Measurement       | ⬜     |
| REQ-045    | **(New.)** Internal `id` (ULID) primary key; no source-native id is ever a PK/FK in the canonical schema                                                                                         | P1       | AT-046-A                                            | Inspection / Test             | ⬜     |
| REQ-046    | **(New.)** `fdcId`/USDA terms appear only inside the USDA adapter; `fdcId → external_key` inbound; no leak past the boundary                                                                     | P1       | AT-046-A (+ ITP-013-B)                              | Test                          | ⬜     |
| REQ-047    | **(New.)** Add-by-name is the primary path into sources; `id` = queue key + poll handle + canonical identity                                                                                     | P1       | AT-005-A, AT-005-B                                  | Test                          | ⬜     |
| REQ-048    | **(New.)** `GET /v1/foods/{id}/candidates` for an `UNRESOLVED` food; pre-merge dedup, residual ambiguity left for the user                                                                       | P1       | AT-048-A, AT-050-B                                  | Test                          | ⬜     |
| REQ-049    | **(New.)** `PATCH /v1/foods/{id}` resolves from a candidate pick (validated to the food's own set) → merge → `RESOLVED`                                                                          | P1       | AT-049-A, AT-049-B                                  | Test                          | ⬜     |
| REQ-050    | **(New.)** Worker fans out across all wired adapters, normalizes, assembles golden record; sets `RESOLVED`/`UNRESOLVED`/`NOT_FOUND`/`FAILED`                                                     | P1       | AT-050-A, AT-050-B                                  | Test                          | ⬜     |
| REQ-051    | **(New.)** Field-level merge: presence>absence, identity/short → higher-priority source, free-text → longer-wins, nutrients per-100g before blend                                                | P1       | AT-051-A, AT-051-B                                  | Test                          | ⬜     |
| REQ-052    | **(New.)** Per-field/value-grain provenance (`source_id` columns + `food_field_provenance`); single-query answerable; user pick = ordinary provenance                                            | P1       | AT-052-A                                            | Test                          | ⬜     |
| REQ-053    | **(New.)** Change-driven refresh preserves stored/user values; only a changed originating item moves a field                                                                                     | P2       | AT-031-A, AT-031-B                                  | Test                          | ⬜     |
| REQ-054    | **(New.)** Each source is an adapter behind a common interface; no source structure leaks; all persistence via DAO; adding a source is additive                                                  | P1       | AT-046-A (+ ITP-013-A/B, ITP-014-B)                 | Inspection / Test             | ⬜     |
| REQ-055    | **(New.)** Adapter validates/sanitizes mapped values before the store; HTTPS + cert validation; reject-not-store on failure                                                                      | P1       | AT-055-A                                            | Test                          | ⬜     |

### Non-Functional Requirements

| REQ-ID     | Requirement (Summary)                                                                       | Priority | AT-ID                     | Verification Method      | Status |
| ---------- | ------------------------------------------------------------------------------------------- | -------- | ------------------------- | ------------------------ | ------ |
| REQ-NF-001 | TypeScript strict; no `any`; strict interfaces                                              | P1       | _(Inspection)_            | Inspection               | ⬜     |
| REQ-NF-002 | JSDoc on all exports; `@param`/`@returns`/`@throws` on handlers/adapters/merge              | P1       | _(Inspection)_            | Inspection               | ⬜     |
| REQ-NF-003 | Aliased imports; no `helpers/` directories                                                  | P1       | _(Inspection)_            | Inspection               | ⬜     |
| REQ-NF-004 | Food UI components expose accessible names (getByRole/getByLabel)                           | P2       | _(Inspection — UI phase)_ | Test                     | ⬜     |
| REQ-NF-005 | Color not sole conveyor of lifecycle `status`; paired with text/icon                        | P2       | _(Inspection — UI phase)_ | Inspection               | ⬜     |
| REQ-NF-006 | New workspaces registered + extend shared configs; Turbo deps declared                      | P1       | _(Inspection)_            | Inspection               | ⬜     |
| REQ-NF-007 | All code passes turbo typecheck/lint/format:check                                           | P1       | AT-NF007-A                | Static Analysis          | ⬜     |
| REQ-NF-008 | Testing pyramid ≥70% unit / ≤20% integration / ≤10% E2E; files map REQ IDs                  | P1       | _(Inspection)_            | Inspection               | ⬜     |
| REQ-NF-009 | Custom errors extend `Error` + type guards                                                  | P1       | _(Inspection)_            | Inspection               | ⬜     |
| REQ-NF-010 | Dates are ISO 8601 strings, never `Date`                                                    | P1       | _(Inspection)_            | Inspection               | ⬜     |
| REQ-NF-011 | Cache-hit (`RESOLVED`) lookups within 50ms p95                                              | P1       | AT-NF011-A                | Performance Measurement  | ⬜     |
| REQ-NF-012 | Never exceed each source's hourly cap in any trailing 60 min (USDA ≤1,000)                  | P1       | AT-NF012-A, AT-019-A      | Performance Measurement  | ⬜     |
| REQ-NF-013 | Background resolutions (`202`→`RESOLVED`) within 60s p95 (queue depth <100)                 | P1       | AT-NF013-A                | Performance Measurement  | ⬜     |
| REQ-NF-014 | Cache hit rate >80% once 5,000+ `RESOLVED` foods                                            | P2       | _(Analysis)_              | Analysis                 | ⬜     |
| REQ-NF-015 | Fan-out/merge throughput ≥5,000 foods/hour using batch capability                           | P2       | _(Analysis)_              | Analysis                 | ⬜     |
| REQ-NF-016 | Zero data loss; all persistently failing foods tombstoned                                   | P1       | AT-NF016-A, AT-016-A      | Fault Injection          | ⬜     |
| REQ-NF-017 | Food data API 99.9% availability monthly (single-AZ target, A-013)                          | P1       | _(Analysis)_              | Analysis                 | ⬜     |
| REQ-NF-018 | Stored nutrient values faithful after documented per-100g normalization; no lossy transform | P1       | AT-NF018-A, AT-051-B      | Equivalence Partitioning | ⬜     |

### Interface Requirements

| REQ-ID     | Requirement (Summary)                                                                                                                             | Priority | AT/ATP-ID                              | Verification Method | Status |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------- | ------------------- | ------ |
| REQ-IF-001 | `GET /v1/foods/{id}` golden-record/status keyed on internal `id`; `/v1/` versioning                                                               | P1       | AT-001-A, AT-002-A, AT-003-A, AT-004-A | Test                | ⬜     |
| REQ-IF-002 | `GET /v1/foods/{id}/status` returns `id`, lifecycle `status`, data when `RESOLVED`                                                                | P2       | AT-007-A                               | Test                | ⬜     |
| REQ-IF-003 | `GET /v1/foods/search` returns relevance-ranked `id`s; barcode/`external_key` lookup                                                              | P1       | AT-008-A, AT-008-B, AT-009-A, AT-010-A | Test                | ⬜     |
| REQ-IF-004 | **USDA adapter** calls `GET /v1/food/{fdcId}` + `POST /v1/foods` ≤20; `fdcId`/batch confined to adapter                                           | P1       | AT-023-A                               | Test                | ⬜     |
| REQ-IF-005 | EventBridge carries `IngestionScheduled` + `FoodDataReceived` only; `FoodRequested`/`FoodBatchRequested` are `fetch_queue` enqueues               | P1       | _(Inspection)_                         | Inspection          | ⬜     |
| REQ-IF-006 | Each source's API key in Secrets Manager; never exposed in responses/logs                                                                         | P1       | _(Inspection)_                         | Inspection          | ⬜     |
| REQ-IF-007 | Reuse shared Clerk `AuthMiddleware`/`ClerkAuthService` (in-process, ALB-fronted); no separate auth                                                | P1       | ATP-008-A                              | Test                | ⬜     |
| REQ-IF-008 | Token-in → verified `AuthenticatedCaller`-out (`{sub, azp, scopes}`); no client header trusted; failures → `401`                                  | P1       | ATP-008-A, ATP-008-B                   | Test                | ⬜     |
| REQ-IF-009 | **(New.)** `POST /v1/foods` (by name) + `POST /v1/foods/batch` (≤100, per-item partial); empty name → `400`                                       | P1       | AT-005-A, AT-012-A, ATP-008-I          | Test                | ⬜     |
| REQ-IF-010 | **(New.)** `GET /v1/foods/{id}/candidates` returns candidates (each with `source` + `externalKey`)                                                | P1       | AT-048-A                               | Test                | ⬜     |
| REQ-IF-011 | **(New.)** `PATCH /v1/foods/{id}` accepts candidate selection validated to the food's set; out-of-set → `400`/`409`                               | P1       | AT-049-A, AT-049-B                     | Test                | ⬜     |
| REQ-IF-012 | **(New.)** `FoodSourceAdapter` interface (`searchByName`/`fetchByKey`/`mapToCanonical`); only canonical shapes past the boundary; no `fdcId` leak | P1       | AT-046-A, AT-055-A (+ ITP-013-B)       | Inspection / Test   | ⬜     |

### Constraint Requirements

| REQ-ID     | Requirement (Summary)                                                                             | Priority | AT-ID          | Verification Method | Status |
| ---------- | ------------------------------------------------------------------------------------------------- | -------- | -------------- | ------------------- | ------ |
| REQ-CN-001 | Deploy as AWS-hosted backend services in us-east-1                                                | P1       | _(Inspection)_ | Inspection          | ⬜     |
| REQ-CN-002 | Lean launch variant (no Redis; shared DB) is the default starting configuration                   | P1       | _(Inspection)_ | Inspection          | ⬜     |
| REQ-CN-003 | Single active Fargate consumer (advisory lock)                                                    | P1       | _(Inspection)_ | Inspection          | ⬜     |
| REQ-CN-004 | Canonical schema purpose-built; `ingredients` linkage is a downstream concern                     | P1       | _(Inspection)_ | Inspection          | ⬜     |
| REQ-CN-005 | Each source's rate limit a hard constraint (USDA 1,000/hr); per-source rolling window             | P1       | _(Inspection)_ | Inspection          | ⬜     |
| REQ-CN-006 | New monorepo packages extending all `@kitchensink/*` configs                                      | P1       | _(Inspection)_ | Inspection          | ⬜     |
| REQ-CN-007 | **(New.)** Identity is the internal surrogate `id`; no source-native id ever a PK/FK (locked now) | P1       | AT-046-A       | Inspection          | ⬜     |

---

## Matrix B: Backward Traceability (Acceptance Test → REQ)

> Maps every acceptance test case back to its parent requirement. Orphan ATs (no REQ) are flagged.

### Functional / Capability ATs

| AT-ID    | Acceptance Test (Summary)                                                            | REQ-ID(s)                                         | Justification                                                                |
| -------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------- |
| AT-001-A | Local store is the exclusive read source; no source call in the request path         | REQ-001, REQ-IF-001                               | Verifies no outbound source call during the request lifecycle                |
| AT-002-A | Complete golden-record payload on a `RESOLVED` read                                  | REQ-002, REQ-IF-001                               | `200` reserved for a confidently assembled golden record                     |
| AT-003-A | `PENDING`/`UNRESOLVED` lifecycle states return `202` on read/poll                    | REQ-003, REQ-IF-002                               | Async add-by-name/resolution body shape                                      |
| AT-004-A | Terminal/absent states return `404`; `status` retrievable, no enqueue                | REQ-004, REQ-IF-001                               | Distinguishes terminal/absent from in-flight; held `id` stays meaningful     |
| AT-005-A | Add-by-name creates the row + `id` and returns `202` within budget                   | REQ-005, REQ-011, REQ-047, REQ-IF-009             | Primary entry path; create-then-enqueue handshake                            |
| AT-005-B | Concurrent same-name adds collapse to one row + `id`                                 | REQ-005, REQ-013, REQ-047                         | Normalized-name dedup under the advisory lock                                |
| AT-006-A | Non-ULID `id` rejected `400` before business logic                                   | REQ-006                                           | Input-validation gate; nothing enqueued                                      |
| AT-007-A | Status endpoint returns the current lifecycle `status` per partition                 | REQ-007, REQ-033, REQ-IF-002                      | Polling contract across all lifecycle states                                 |
| AT-008-A | Search returns canonical `id`s ranked by relevance (pg_trgm fuzzy)                   | REQ-008, REQ-IF-003                               | Ranked local-store search                                                    |
| AT-008-B | Barcode / `external_key` lookup resolves to the canonical `id`                       | REQ-008, REQ-IF-003                               | Crosswalk lookup path                                                        |
| AT-009-A | Search makes no external source call                                                 | REQ-009                                           | Local-only invariant for search                                              |
| AT-010-A | Search returns within 200ms at scale                                                 | REQ-010, REQ-029                                  | p95 latency with the trigram GIN index                                       |
| AT-012-A | Batch add mixing known/unknown returns resolved inline + `PENDING` per miss          | REQ-012, REQ-040a, REQ-IF-009                     | Per-item partial result                                                      |
| AT-015-A | Higher distinct-requester demand drains first; FIFO tie-break; a `sub` counts once   | REQ-014, REQ-015, REQ-039                         | Capped distinct-requester demand ordering                                    |
| AT-016-A | Persistently failing foods captured as auditable tombstone rows                      | REQ-016, REQ-NF-016                               | Tombstone audit row after the retry budget                                   |
| AT-019-A | ≤ source cap in any trailing 60 min; worker pauses that source at 90%                | REQ-019, REQ-NF-012                               | Per-source rolling-window enforcement                                        |
| AT-020-A | Count-and-record limiter operation is race-free under concurrency                    | REQ-020                                           | Atomic per-source check-and-record                                           |
| AT-021-A | A would-be over-cap call is not made; row re-deferred                                | REQ-021                                           | Window-at-cap deferral                                                       |
| AT-023-A | USDA adapter selects single GET vs batch POST; 1 windowed call/call                  | REQ-023, REQ-IF-004                               | **Adapter-boundary row** — `fdcId → external_key`, batching adapter-internal |
| AT-024-A | Full USDA success path maps into the golden record + provenance + crosswalk          | REQ-024, REQ-055                                  | **Adapter-boundary row** — map+validate, no payload retained                 |
| AT-025-A | Confirmed-absent food tombstoned `NOT_FOUND`, re-attemptable after TTL               | REQ-025, REQ-016, REQ-018                         | No-source disposition + TTL recovery                                         |
| AT-026-A | A source `429` treated as window-full; consumer backs off                            | REQ-026                                           | Immediate per-source back-off                                                |
| AT-027-A | Transient source errors retry with backoff → `FAILED` after the budget               | REQ-027, REQ-016                                  | Row-lease retry then tombstone                                               |
| AT-031-A | A changed source item re-pulls only its fields; unchanged items left intact          | REQ-031, REQ-032, REQ-053                         | Change-driven refresh by `item_version`                                      |
| AT-031-B | A user-resolved field is preserved unless its source item changes; re-pull validated | REQ-031, REQ-052, REQ-053                         | Human pick preserved as ordinary provenance                                  |
| AT-040-B | Enqueue fails closed with `503` at the queue ceiling / open circuit breaker          | REQ-040b, REQ-014                                 | Backpressure at admission (before demotion)                                  |
| AT-046-A | The public API surface exposes only the internal `id` and source-agnostic fields     | REQ-045, REQ-046, REQ-054, REQ-CN-007, REQ-IF-012 | **`fdcId`-confinement assertion** at the public boundary (SC-013)            |
| AT-048-A | Candidate list returned for an `UNRESOLVED` food, each carrying `source` + item key  | REQ-048, REQ-IF-010                               | Cross-source disambiguation list                                             |
| AT-049-A | A valid candidate pick merges into the golden record → `RESOLVED`                    | REQ-049, REQ-IF-011                               | Human-in-the-loop resolve                                                    |
| AT-049-B | An out-of-set `PATCH` candidate is rejected; `status` unchanged                      | REQ-049, REQ-IF-011                               | Candidate-set membership validation                                          |
| AT-050-A | Worker fans out by name, assembles a golden record, food readable as `200`           | REQ-050, REQ-024, REQ-IF-005                      | Confident single-merge → `RESOLVED`                                          |
| AT-050-B | Ambiguous fan-out sets `UNRESOLVED` + surfaces a candidate list                      | REQ-050, REQ-048                                  | Residual-ambiguity disposition                                               |
| AT-051-A | Field-level merge precedence is deterministic and source-priority-driven             | REQ-051                                           | Presence>absence / higher-priority / longer-wins rules                       |
| AT-051-B | Nutrients normalized to per-100g before any blend; conflicts by source priority      | REQ-051, REQ-NF-018                               | Per-100g basis normalization                                                 |
| AT-052-A | Every stored scalar/nutrient/portion carries resolvable provenance                   | REQ-052, REQ-028, REQ-029                         | Value-grain provenance, single-query answerable                              |
| AT-055-A | A response failing adapter validation is rejected, not stored                        | REQ-055, REQ-IF-012                               | **Adapter-boundary** input safety + HTTPS                                    |

### Auth ATs (US-0 — `ATP-008-*`, scenarios `ATS-036..044-*`)

| ATP-ID    | Acceptance Test (Summary)                                                                   | REQ-ID(s)                                            | Justification                                            |
| --------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| ATP-008-A | Unauthenticated request rejected `401` before any create/enqueue/source call (sync + async) | REQ-035, REQ-037a–d, REQ-042, REQ-IF-007, REQ-IF-008 | US-0 — no unauthenticated path drives source consumption |
| ATP-008-B | A valid Clerk session token authenticates the caller; networkless verification              | REQ-037a–d, REQ-044a–d, REQ-IF-008                   | Happy-path verify + ≤10ms p95 budget                     |
| ATP-008-C | Expired / malformed token rejected `401` fail-closed                                        | REQ-037a–d, REQ-044a–d                               | Fail-closed on bad credential                            |
| ATP-008-D | Wrong-`azp`/wrong-instance token or forged identity header → `401`                          | REQ-037a–d                                           | `azp` allowlist + identity from verified `sub` only      |
| ATP-008-E | WebSocket `$connect` auth + per-recipient push (never broadcast)                            | REQ-043, REQ-IF-008                                  | Per-recipient delivery via `fetch_requesters`            |
| ATP-008-F | One `sub` (>50 pending) demoted to back, not rejected; no `429`                             | REQ-039                                              | Denial-of-wallet fairness by demotion (SC-012)           |
| ATP-008-G | Authenticated-but-unauthorized is `403`, not `401`; precedence enforced                     | REQ-038a–c                                           | Scope `403` vs unauth `401`; `401→403→400` ordering      |
| ATP-008-H | A backend M2M token is accepted (not `401`)                                                 | REQ-041                                              | Service-token class accepted on classified endpoints     |
| ATP-008-I | Oversized batch → `400`, enqueues nothing                                                   | REQ-040a                                             | Hard batch cap before any enqueue                        |

### Non-Functional ATs

| AT-ID      | Acceptance Test (Summary)                               | REQ-ID     | Justification                          |
| ---------- | ------------------------------------------------------- | ---------- | -------------------------------------- |
| AT-NF007-A | CI gate passes before merge                             | REQ-NF-007 | Zero errors from typecheck/lint/format |
| AT-NF011-A | Latency probe for cache-hit (`RESOLVED`) path           | REQ-NF-011 | p95 <50ms                              |
| AT-NF012-A | Per-source rate-limit compliance under load             | REQ-NF-012 | ≤ cap, zero `429`s over the window     |
| AT-NF013-A | End-to-end async resolution latency                     | REQ-NF-013 | `202`→`RESOLVED` within 60s p95        |
| AT-NF016-A | Tombstone rows capture every food that exhausts retries | REQ-NF-016 | Zero-data-loss audit                   |
| AT-NF018-A | Data fidelity vs source after documented normalization  | REQ-NF-018 | No lossy transform beyond per-100g     |

> **Orphan AT check:** none. Every AT/ATP/AT-NF case above resolves to ≥1 REQ via the `AT-NNN-X → REQ-NNN`
> convention or its acceptance-plan Tier-2 REQ heading. The auth `ATP-008-*` family maps to the US-0 REQ slice;
> the `fdcId` appears only on the adapter-boundary ATs (AT-023-A, AT-024-A, AT-055-A) and the confinement
> assertion (AT-046-A).

---

## Matrix C: Integration Verification (MOD/ARCH boundary → ITP)

> Cross-module contracts verified at the architecture Dependency-View boundaries. Unit tests (UTP) verify
> internal module logic; integration tests (ITP) verify cross-module contracts. Each row names the boundary,
> the governing REQ-IDs, the MOD/ARCH boundary, and the supporting unit + integration coverage.

| Integration Boundary                                                    | REQ-IDs                                  | MOD / ARCH Boundary                  | UTP Coverage                               | ITP Case(s)                     | Status |
| ----------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------ | ------------------------------------------ | ------------------------------- | ------ |
| FoodApiController → FoodDaoRepository (read-by-`id`, RESOLVED hit)      | REQ-001, REQ-002, REQ-003, REQ-004       | MOD-001 ↔ MOD-016 (ARCH-001↔014)     | UTP-001-B, UTP-016-C                       | ITP-001-A                       | ⬜     |
| FoodApiController input-validation gate (no invalid input enqueued)     | REQ-006                                  | MOD-001 (ARCH-001)                   | UTP-001-A                                  | ITP-001-B                       | ⬜     |
| FoodApiController add-by-name → create+dedup → enqueue handshake        | REQ-005, REQ-011, REQ-013, REQ-047       | MOD-001 ↔ MOD-016 ↔ MOD-002/003      | UTP-001-C, UTP-016-A                       | ITP-001-C                       | ⬜     |
| FoodApiController status mapping (202 / 404-with-status)                | REQ-003, REQ-004                         | MOD-001 ↔ MOD-016 (ARCH-001↔014)     | UTP-001-B, UTP-001-D                       | ITP-001-D                       | ⬜     |
| `NOT_FOUND` tombstone-TTL re-attempt seam                               | REQ-025, REQ-018                         | MOD-001 ↔ MOD-016/003                | UTP-001-B                                  | ITP-001-E                       | ⬜     |
| EnqueueEmitter → Postgres `fetch_queue` (demand-path enqueue)           | REQ-011, REQ-014                         | MOD-002 ↔ MOD-003 (ARCH-002↔003)     | UTP-002-A                                  | ITP-002-A                       | ⬜     |
| EnqueueEmitter rejects malformed/unprovenanced payloads                 | REQ-006, REQ-042                         | MOD-002 (ARCH-002)                   | UTP-002-A                                  | ITP-002-B                       | ⬜     |
| EnqueueEmitter → EventBridge (scheduled + completion only)              | REQ-032, REQ-034, REQ-IF-005             | MOD-002 ↔ EventBridge (ARCH-002)     | UTP-002-C, UTP-002-D                       | ITP-002-C                       | ⬜     |
| FetchQueueRouter → demand-weighted `fetch_queue` (keyed on `food_id`)   | REQ-014, REQ-015, REQ-044                | MOD-003 ↔ Postgres `fetch_queue`     | UTP-003-A, UTP-003-B                       | ITP-003-A                       | ⬜     |
| FetchQueueRouter tombstone handshake on persistent failure              | REQ-016, REQ-025, REQ-027                | MOD-003 ↔ Postgres                   | UTP-003-C                                  | ITP-003-B                       | ⬜     |
| FetchQueueRouter distinct-requester dedup under concurrent adds         | REQ-013, REQ-014                         | MOD-003 ↔ `fetch_requesters`         | UTP-003-A                                  | ITP-003-C                       | ⬜     |
| FoodConsumerService → RollingWindowLimiter (per-source gate)            | REQ-019, REQ-020, REQ-021                | MOD-004 ↔ MOD-005 (ARCH-004↔005)     | UTP-004-A, UTP-005-A                       | ITP-004-A                       | ⬜     |
| FoodConsumerService fan-out → merge → persist → provenance              | REQ-024, REQ-050, REQ-051, REQ-052       | MOD-004 ↔ MOD-015/017/016/019        | UTP-004-C, UTP-017-A                       | ITP-004-B                       | ⬜     |
| FoodConsumerService retry/backoff on a single-source error              | REQ-016, REQ-027                         | MOD-004 ↔ MOD-003                    | UTP-004-B                                  | ITP-004-C                       | ⬜     |
| FoodConsumerService terminal disposition (NOT_FOUND vs FAILED)          | REQ-025, REQ-027                         | MOD-004 ↔ MOD-003/016                | UTP-004-B                                  | ITP-004-D                       | ⬜     |
| FoodConsumerService async-producer provenance gate                      | REQ-042                                  | MOD-004 ↔ MOD-014 (ARCH-004↔012)     | UTP-014-A, UTP-014-B                       | ITP-004-E, ITP-012-E            | ⬜     |
| RollingWindowLimiter atomic per-source count-and-record                 | REQ-019, REQ-020                         | MOD-005 ↔ Postgres `source_call_log` | UTP-005-A, UTP-005-C                       | ITP-005-A                       | ⬜     |
| RollingWindowLimiter store fault → fail closed                          | REQ-019                                  | MOD-005 ↔ store                      | UTP-005-B                                  | ITP-005-B                       | ⬜     |
| RollingWindowLimiter per-source pause/resume seam                       | REQ-019, REQ-021                         | MOD-005 ↔ MOD-004                    | UTP-005-C                                  | ITP-005-C                       | ⬜     |
| FoodPostgresRepository golden-record upsert + read (via DAO)            | REQ-024, REQ-028, REQ-052                | MOD-006 ↔ MOD-016 (ARCH-006↔014)     | UTP-006-A, UTP-016-B                       | ITP-006-A                       | ⬜     |
| FoodPostgresRepository search (pg_trgm, local-only)                     | REQ-008, REQ-010                         | MOD-006 ↔ RDS PostgreSQL             | UTP-006-C                                  | ITP-006-B                       | ⬜     |
| FoodPostgresRepository connection-error propagation                     | REQ-028                                  | MOD-006 ↔ RDS                        | UTP-006-A                                  | ITP-006-C                       | ⬜     |
| FoodCacheService cache-through (deferred variant)                       | REQ-001, REQ-030                         | MOD-007 ↔ Redis (ARCH-007)           | UTP-007-A                                  | ITP-007-A                       | ⬜     |
| FoodCacheService unavailability → fall through, no `503`                | REQ-001                                  | MOD-007 ↔ MOD-006                    | UTP-007-B                                  | ITP-007-B                       | ⬜     |
| **UsdaApiClient → USDA API (adapter contract; `fdcId → external_key`)** | REQ-023, REQ-024, REQ-IF-004             | **MOD-008 ↔ SYS-009 (ARCH-008)**     | UTP-008-A, UTP-008-B                       | ITP-008-A                       | ⬜     |
| **UsdaApiClient error classification / propagation**                    | REQ-025, REQ-026, REQ-027                | **MOD-008 (ARCH-008)**               | UTP-008-C                                  | ITP-008-B                       | ⬜     |
| WebSocketNotifier → API Gateway WebSocket (deferred)                    | REQ-034, REQ-043                         | MOD-009 ↔ API GW (ARCH-009)          | UTP-009-A                                  | ITP-009-A                       | ⬜     |
| WebSocketNotifier graceful disconnect handling                          | REQ-034                                  | MOD-009                              | UTP-009-A                                  | ITP-009-B                       | ⬜     |
| SecretManager → Secrets Manager (per-source key)                        | REQ-IF-006                               | MOD-010 ↔ Secrets Manager (ARCH-010) | UTP-010-A                                  | ITP-010-A                       | ⬜     |
| SecretManager fault on secret-not-found                                 | REQ-IF-006                               | MOD-010                              | UTP-010-B                                  | ITP-010-B                       | ⬜     |
| MonitoringLogger structured-log / metric / trace contract               | REQ-NF-012, REQ-NF-016                   | MOD-011 ↔ CloudWatch (ARCH-011)      | UTP-011-A, UTP-011-B                       | ITP-011-A, ITP-011-B, ITP-011-C | ⬜     |
| **FoodAuthGuard rejects unauthenticated before any work**               | REQ-035, REQ-037a–d, REQ-IF-007/008      | **MOD-012 ↔ MOD-001/009 (ARCH-012)** | UTP-012-A, UTP-012-B, UTP-012-C            | ITP-012-A                       | ⬜     |
| **FoodAuthGuard accepts a Clerk M2M token**                             | REQ-041                                  | **MOD-012 (ARCH-012)**               | UTP-012-A                                  | ITP-012-B                       | ⬜     |
| **DemotionAndFairness — `sub` demoted, not rejected**                   | REQ-039                                  | **MOD-013 ↔ MOD-003/004**            | UTP-012-E, UTP-012-G                       | ITP-012-C                       | ⬜     |
| **FoodAuthGuard 503 on backpressure / open circuit**                    | REQ-040b                                 | **MOD-013 ↔ MOD-003**                | UTP-012-H                                  | ITP-012-D                       | ⬜     |
| **Async-path provenance — only authorized producers**                   | REQ-042                                  | **MOD-014 (ARCH-012)**               | UTP-014-A, UTP-014-B, UTP-014-C            | ITP-012-E                       | ⬜     |
| **FoodAuthGuard scope gate + 401→403→400 precedence**                   | REQ-038a–c                               | **MOD-012 (ARCH-012)**               | UTP-012-D                                  | ITP-012-F                       | ⬜     |
| **DemotionAndFairness — oversized batch → 400; accepted → partial**     | REQ-040a                                 | **MOD-013 (ARCH-012)**               | UTP-012-F                                  | ITP-012-G                       | ⬜     |
| **Auth consumer-driven contract (M2M + provenance seams)**              | REQ-041, REQ-042, REQ-IF-008             | **MOD-012/014 (ARCH-012)**           | UTP-012-A, UTP-014-D                       | ITP-012-H                       | ⬜     |
| **SourceAdapterRegistry fan-out (worker iterates wired registry)**      | REQ-050, REQ-054, REQ-IF-012             | **MOD-015 ↔ MOD-004 (ARCH-013↔004)** | UTP-015-A, UTP-015-B                       | ITP-013-A                       | ⬜     |
| **SourceAdapterRegistry confines `fdcId` (no source-native key leaks)** | REQ-046, REQ-054, REQ-IF-012, REQ-CN-007 | **MOD-015 ↔ MOD-008 (ARCH-013↔008)** | UTP-015-A, UTP-008-B                       | ITP-013-B                       | ⬜     |
| FoodDaoRepository add-by-name dedup under concurrent adds (lock)        | REQ-005, REQ-013, REQ-047                | MOD-016 ↔ MOD-006 (ARCH-014↔006)     | UTP-016-A                                  | ITP-014-A                       | ⬜     |
| FoodDaoRepository golden-record persistence (sole persistence path)     | REQ-024, REQ-052, REQ-054                | MOD-016 ↔ MOD-006/019                | UTP-016-B                                  | ITP-014-B                       | ⬜     |
| GoldenRecordMergeEngine field-level merge → RESOLVED                    | REQ-050, REQ-051                         | MOD-017 ↔ MOD-004 (ARCH-015↔004)     | UTP-017-A, UTP-017-B, UTP-017-C, UTP-017-D | ITP-015-A                       | ⬜     |
| GoldenRecordMergeEngine non-collapsible → UNRESOLVED                    | REQ-050, REQ-048                         | MOD-017 ↔ MOD-018                    | UTP-017-A                                  | ITP-015-B                       | ⬜     |
| CandidateResolutionService getCandidates (UNRESOLVED)                   | REQ-048, REQ-IF-010                      | MOD-018 ↔ MOD-001 (ARCH-016↔001)     | UTP-018-A                                  | ITP-016-A                       | ⬜     |
| CandidateResolutionService PATCH-resolve (in-set → RESOLVED)            | REQ-049, REQ-IF-011                      | MOD-018 ↔ MOD-017/019                | UTP-018-C                                  | ITP-016-B                       | ⬜     |
| CandidateResolutionService out-of-set pick → 400/409                    | REQ-049, REQ-IF-011                      | MOD-018                              | UTP-018-B                                  | ITP-016-C                       | ⬜     |
| ProvenanceStore per-field provenance at the value grain                 | REQ-052, REQ-028                         | MOD-019 ↔ MOD-006 (ARCH-017↔006)     | UTP-019-A                                  | ITP-017-A                       | ⬜     |
| ProvenanceStore "which fields from source X" single-query               | REQ-052, REQ-029                         | MOD-019 ↔ MOD-006                    | UTP-019-B                                  | ITP-017-B                       | ⬜     |
| ChangeRefreshConsumer re-enqueues only changed items                    | REQ-031, REQ-032, REQ-053                | MOD-020 ↔ MOD-015/003 (ARCH-018)     | UTP-020-A, UTP-020-B                       | ITP-018-A                       | ⬜     |
| ChangeRefreshConsumer leaves unchanged + user-resolved intact           | REQ-031, REQ-053                         | MOD-020 ↔ MOD-018/019                | UTP-020-B                                  | ITP-018-B                       | ⬜     |
| AdapterInputValidator reject-not-store on malformed candidate           | REQ-055, REQ-NF-018                      | MOD-021 ↔ MOD-008 (ARCH-019↔008)     | UTP-021-B, UTP-021-C                       | ITP-019-A                       | ⬜     |
| AdapterInputValidator HTTPS + cert validation on outbound fetch         | REQ-055                                  | MOD-021                              | UTP-021-A                                  | ITP-019-B                       | ⬜     |

---

## Matrix D: Implementation Verification (MOD → UTP / UTS)

> Maps module designs (MOD) to unit test cases (UTP) and their REQ coverage. Verifies implementation
> completeness at the code level. ARCH-012 (FoodAuthGuard) decomposes into MOD-012/013/014.

| MOD-ID  | Module Name                                   | Source File                                                                                      | ARCH Parent | SYS Parent      | UTP Cases                | REQ Trace                                                        | Impl Status |
| ------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- | --------------- | ------------------------ | ---------------------------------------------------------------- | ----------- |
| MOD-001 | FoodApiController                             | `packages/services/food-service/src/foods/foods.controller.ts`                                   | ARCH-001    | SYS-001         | UTP-001-A..H             | REQ-002..007, REQ-IF-001/002, REQ-045..049, REQ-IF-009..011      | ⬜          |
| MOD-002 | EnqueueEmitter                                | `packages/services/food-service/src/queue/enqueue-emitter.service.ts`                            | ARCH-002    | SYS-002         | UTP-002-A..D             | REQ-011, REQ-014, REQ-017, REQ-032, REQ-034, REQ-042             | ⬜          |
| MOD-003 | FetchQueueRouter                              | `packages/services/food-service/src/queue/fetch-queue.router.ts`                                 | ARCH-003    | SYS-002/003/004 | UTP-003-A..D             | REQ-014, REQ-015, REQ-016, REQ-018, REQ-022, REQ-044             | ⬜          |
| MOD-004 | FoodConsumerService (Fan-Out/Merge)           | `packages/services/food-service/src/worker/...`                                                  | ARCH-004    | SYS-005         | UTP-004-A..C             | REQ-016, REQ-018, REQ-025..027, REQ-050, REQ-042                 | ⬜          |
| MOD-005 | RollingWindowLimiter (per-source)             | `packages/services/food-service/src/worker/rolling-window.limiter.ts`                            | ARCH-005    | SYS-006         | UTP-005-A..C             | REQ-019, REQ-020, REQ-021, REQ-026                               | ⬜          |
| MOD-006 | FoodPostgresRepository (canonical store)      | `packages/services/food-service/src/database/schema/*.ts`                                        | ARCH-006    | SYS-007         | UTP-006-A..D             | REQ-028, REQ-029, REQ-008, REQ-CN-007                            | ⬜          |
| MOD-007 | FoodCacheService (optional)                   | `packages/services/food-service/src/cache/food-cache.service.ts`                                 | ARCH-007    | SYS-008         | UTP-007-A..B             | REQ-030, REQ-001                                                 | ⬜          |
| MOD-008 | **UsdaApiClient (the only `fdcId` boundary)** | `packages/clients/usda/src/usda-api.client.ts` (`@kitchensink/usda-client`)                      | ARCH-008    | SYS-009         | UTP-008-A..C             | REQ-023, REQ-024, REQ-046, REQ-IF-005, REQ-IF-012                | ⬜          |
| MOD-009 | WebSocketNotifier (deferred)                  | `packages/services/food-service/src/websocket/websocket-notifier.ts`                             | ARCH-009    | SYS-010         | UTP-009-A..B             | REQ-034, REQ-041, REQ-049                                        | ⬜          |
| MOD-010 | SecretManager (per-source key)                | `packages/services/food-service/src/secrets/secret-manager.ts`                                   | ARCH-010    | SYS-011         | UTP-010-A..C             | REQ-IF-006, REQ-042, REQ-044c                                    | ⬜          |
| MOD-011 | MonitoringLogger                              | `packages/services/food-service/src/monitoring/monitoring-logger.ts`                             | ARCH-011    | SYS-012         | UTP-011-A..B             | REQ-NF-012, REQ-NF-016 (observability)                           | ⬜          |
| MOD-012 | ClerkAuthMiddleware (verify + authz)          | `packages/services/food-service/src/auth/clerk-auth.middleware.ts` (`@kitchensink/clerk-verify`) | ARCH-012    | SYS-013         | UTP-012-A, B, C, D, I, J | REQ-037a–d, REQ-038a–c, REQ-041, REQ-043, REQ-044a–d, REQ-IF-008 | ⬜          |
| MOD-013 | DemotionAndFairness                           | `packages/services/food-service/src/auth/demotion-and-fairness.service.ts`                       | ARCH-012    | SYS-013         | UTP-012-E, F, G, H       | REQ-039, REQ-040a–b, REQ-044a–d                                  | ⬜          |
| MOD-014 | AsyncProducerAuthz                            | `packages/services/food-service/src/auth/async-producer-authz.service.ts`                        | ARCH-012    | SYS-013         | UTP-014-A..E             | REQ-042                                                          | ⬜          |
| MOD-015 | **SourceAdapterRegistry (New)**               | `packages/services/food-service/src/sources/source-adapter.registry.ts`                          | ARCH-013    | SYS-014         | UTP-015-A..B             | REQ-046, REQ-050, REQ-054, REQ-CN-007, REQ-IF-012                | ⬜          |
| MOD-016 | **FoodDaoRepository (New)**                   | `packages/services/food-service/src/database/foods.repository.ts`                                | ARCH-014    | SYS-018         | UTP-016-A..C             | REQ-005, REQ-013, REQ-054, REQ-028                               | ⬜          |
| MOD-017 | **GoldenRecordMergeEngine (New)**             | `packages/services/food-service/src/worker/merge-engine.ts`                                      | ARCH-015    | SYS-015         | UTP-017-A..D             | REQ-050, REQ-051                                                 | ⬜          |
| MOD-018 | **CandidateResolutionService (New)**          | `packages/services/food-service/src/foods/candidate-resolution.service.ts`                       | ARCH-016    | SYS-016         | UTP-018-A..C             | REQ-048, REQ-049, REQ-IF-010, REQ-IF-011, REQ-052                | ⬜          |
| MOD-019 | **ProvenanceStore (New)**                     | `packages/services/food-service/src/database/provenance.store.ts`                                | ARCH-017    | SYS-017         | UTP-019-A..B             | REQ-052, REQ-029                                                 | ⬜          |
| MOD-020 | **ChangeRefreshConsumer (New)**               | `packages/services/food-service/src/worker/change-refresh.consumer.ts`                           | ARCH-018    | SYS-019         | UTP-020-A..B             | REQ-031, REQ-032, REQ-053                                        | ⬜          |
| MOD-021 | **AdapterInputValidator (New)**               | `packages/services/food-service/src/sources/adapter-input.validator.ts`                          | ARCH-019    | SYS-020         | UTP-021-A..C             | REQ-055, REQ-024, REQ-032                                        | ⬜          |

### UTP → REQ Traceability (Implementation → Requirement) — auth slice + new modules

| UTP-ID    | Module (MOD)                       | Technique (ISO 29119-4)                       | REQ-IDs Covered                                  | Status |
| --------- | ---------------------------------- | --------------------------------------------- | ------------------------------------------------ | ------ |
| UTP-012-A | MOD-012 ClerkAuthMiddleware        | Statement & Branch + Equivalence Partitioning | REQ-037a–d, REQ-041, REQ-IF-008                  | ⬜     |
| UTP-012-B | MOD-012 ClerkAuthMiddleware        | Boundary Value + State Transition             | REQ-037a–d (401 fail-closed)                     | ⬜     |
| UTP-012-C | MOD-012 ClerkAuthMiddleware        | Equivalence Partitioning                      | REQ-037c (forged identity header ignored)        | ⬜     |
| UTP-012-D | MOD-012 ClerkAuthMiddleware        | State Transition                              | REQ-038a–c (scope 403 + precedence)              | ⬜     |
| UTP-012-E | MOD-013 DemotionAndFairness        | Boundary Value + State Transition             | REQ-039 (per-`sub` demotion, dynamic)            | ⬜     |
| UTP-012-F | MOD-013 DemotionAndFairness        | Boundary Value Analysis                       | REQ-040a (batch cap 400, no enqueue)             | ⬜     |
| UTP-012-G | MOD-013 DemotionAndFairness        | Equivalence Partitioning                      | REQ-039 (distinct-requester demand)              | ⬜     |
| UTP-012-H | MOD-013 DemotionAndFairness        | Statement & Branch                            | REQ-040b (503 fail-closed family)                | ⬜     |
| UTP-012-I | MOD-012 ClerkAuthMiddleware        | Performance / Load-shed                       | REQ-044a–d (invalid-token flood, SC-011)         | ⬜     |
| UTP-012-J | MOD-012 ClerkAuthMiddleware        | State Transition                              | REQ-043 (`$connect` auth + mid-conn expiry)      | ⬜     |
| UTP-014-A | MOD-014 AsyncProducerAuthz         | Equivalence Partitioning                      | REQ-042 (allowlisted principal + provenance)     | ⬜     |
| UTP-014-B | MOD-014 AsyncProducerAuthz         | Statement & Branch                            | REQ-042 (non-allowlisted → fail closed)          | ⬜     |
| UTP-014-C | MOD-014 AsyncProducerAuthz         | Boundary Value Analysis                       | REQ-042 (missing/empty provenance → fail closed) | ⬜     |
| UTP-014-D | MOD-014 AsyncProducerAuthz         | Equivalence Partitioning                      | REQ-041, REQ-042 (`svc_` service class)          | ⬜     |
| UTP-014-E | MOD-014 AsyncProducerAuthz         | Statement & Branch                            | REQ-042 (missing allowlist config → fail closed) | ⬜     |
| UTP-015-A | MOD-015 SourceAdapterRegistry      | Statement & Branch                            | REQ-054, REQ-050, REQ-IF-012                     | ⬜     |
| UTP-015-B | MOD-015 SourceAdapterRegistry      | Equivalence Partitioning                      | REQ-051 (priority), REQ-054                      | ⬜     |
| UTP-016-A | MOD-016 FoodDaoRepository          | Statement & Branch + Concurrency              | REQ-005, REQ-013, REQ-047                        | ⬜     |
| UTP-016-B | MOD-016 FoodDaoRepository          | Statement & Branch                            | REQ-024, REQ-052, REQ-054                        | ⬜     |
| UTP-016-C | MOD-016 FoodDaoRepository          | Equivalence Partitioning                      | REQ-002, REQ-004, REQ-028                        | ⬜     |
| UTP-017-A | MOD-017 GoldenRecordMergeEngine    | Equivalence Partitioning                      | REQ-050 (RESOLVED/UNRESOLVED outcome)            | ⬜     |
| UTP-017-B | MOD-017 GoldenRecordMergeEngine    | Boundary Value Analysis                       | REQ-051 (identity/short → higher-priority)       | ⬜     |
| UTP-017-C | MOD-017 GoldenRecordMergeEngine    | Boundary Value Analysis                       | REQ-051 (free-text → longer-wins)                | ⬜     |
| UTP-017-D | MOD-017 GoldenRecordMergeEngine    | Equivalence Partitioning                      | REQ-051, REQ-NF-018 (per-100g normalization)     | ⬜     |
| UTP-018-A | MOD-018 CandidateResolutionService | State Transition                              | REQ-048, REQ-IF-010                              | ⬜     |
| UTP-018-B | MOD-018 CandidateResolutionService | Boundary Value Analysis                       | REQ-049, REQ-IF-011 (out-of-set → 409)           | ⬜     |
| UTP-018-C | MOD-018 CandidateResolutionService | State Transition                              | REQ-049, REQ-052 (in-set → RESOLVED, provenance) | ⬜     |
| UTP-019-A | MOD-019 ProvenanceStore            | Statement & Branch                            | REQ-052 (value-grain provenance)                 | ⬜     |
| UTP-019-B | MOD-019 ProvenanceStore            | Equivalence Partitioning                      | REQ-052, REQ-029 (single-query, no payload)      | ⬜     |
| UTP-020-A | MOD-020 ChangeRefreshConsumer      | Equivalence Partitioning                      | REQ-053 (`item_version` change detection)        | ⬜     |
| UTP-020-B | MOD-020 ChangeRefreshConsumer      | State Transition                              | REQ-031, REQ-032 (re-enqueue changed only)       | ⬜     |
| UTP-021-A | MOD-021 AdapterInputValidator      | Boundary Value Analysis                       | REQ-055 (HTTPS reject)                           | ⬜     |
| UTP-021-B | MOD-021 AdapterInputValidator      | Boundary Value Analysis                       | REQ-055 (reject-not-store out-of-bounds)         | ⬜     |
| UTP-021-C | MOD-021 AdapterInputValidator      | Equivalence Partitioning                      | REQ-055, REQ-NF-018 (sanitize, fidelity)         | ⬜     |

> The preserved MOD-001..011 UTP→REQ rows (UTP-001-A..H, UTP-002-A..D, UTP-003-A..D, UTP-004-A..C,
> UTP-005-A..C, UTP-006-A..D, UTP-007-A..B, UTP-008-A..C, UTP-009-A..B, UTP-010-A..C, UTP-011-A..B) trace to
> the module-level REQ traces in Matrix D above; `fdcId` appears in a UTP only at UTP-008-A/B (the adapter).

---

## Matrix H: Hazard Traceability (HAZ → REQ → Mitigation → Test)

> FMEA hazards (`hazard-analysis.md`, HAZ-001..047) linked to the requirements that mitigate them and the
> verification that confirms the mitigation. Severity and residual risk are carried from the FMEA. New
> HAZ-042..047 cover the source-agnostic failure surface.

| HAZ-ID      | Hazard (Summary)                                                                                   | SYS         | Severity  | REQ-IDs                                                    | Verification                                                   | Status |
| ----------- | -------------------------------------------------------------------------------------------------- | ----------- | --------- | ---------------------------------------------------------- | -------------------------------------------------------------- | ------ |
| HAZ-001     | Malformed `id` / empty name reaches the create/enqueue path                                        | SYS-001     | Serious   | REQ-006                                                    | UTP-001-A, ITP-001-B, AT-006-A                                 | ⬜     |
| HAZ-002     | API read path accidentally calls a source on a local-store miss                                    | SYS-001     | Critical  | REQ-001, REQ-009                                           | UTP-001-B, AT-001-A, AT-009-A                                  | ⬜     |
| HAZ-003     | Add-by-name dedup race / pending-set leak floods the queue                                         | SYS-001     | High      | REQ-005, REQ-013                                           | UTP-016-A, ITP-014-A, AT-005-B                                 | ⬜     |
| HAZ-004     | Thundering-herd duplicate fetches for the same food                                                | SYS-003     | High      | REQ-013, REQ-014                                           | UTP-003-A, ITP-003-C, AT-005-B                                 | ⬜     |
| HAZ-005     | Poison-pill `fetch_queue` row blocks the queue                                                     | SYS-003     | High      | REQ-016, REQ-027                                           | UTP-003-C, AT-016-A, AT-027-A                                  | ⬜     |
| HAZ-006     | Nutrient data silently rounded/transformed at ingestion                                            | SYS-020     | High      | REQ-NF-018, REQ-055                                        | UTP-021-C, AT-NF018-A, AT-051-B                                | ⬜     |
| HAZ-007     | `RESOLVED` food ages without refresh / refresh keeps failing                                       | SYS-019     | Medium    | REQ-031, REQ-053                                           | AT-031-A, ITP-018-A                                            | ⬜     |
| HAZ-008     | Source `429` causes continued calls / account sanctions                                            | SYS-006     | Critical  | REQ-026                                                    | UTP-004-B, UTP-005-C, AT-026-A                                 | ⬜     |
| HAZ-009     | Invalid `id` reaches the `fetch_queue` and triggers a source call                                  | SYS-001     | Medium    | REQ-006                                                    | UTP-001-A, ITP-001-B, AT-006-A                                 | ⬜     |
| HAZ-010     | Canonical-store integrity error causes silent data loss                                            | SYS-007     | Medium    | REQ-028                                                    | UTP-006-A, UTP-006-D                                           | ⬜     |
| HAZ-011     | Consumer concurrency >1 splits the rolling-window / pending state                                  | SYS-005     | Critical  | REQ-022, REQ-CN-003                                        | UTP-003-D _(Inspection)_                                       | ⬜     |
| HAZ-012     | WebSocket stale connections accumulate                                                             | SYS-010     | Low       | REQ-034                                                    | UTP-009-A                                                      | ⬜     |
| HAZ-013     | Food data API unavailability blocks recipe authoring                                               | SYS-007     | High      | REQ-NF-017, REQ-001                                        | AT-001-A, AT-NF011-A                                           | ⬜     |
| HAZ-014     | Tombstone-row overflow / silent loss beyond the TTL                                                | SYS-003     | Medium    | REQ-NF-016, REQ-018                                        | AT-NF016-A, AT-016-A                                           | ⬜     |
| HAZ-015     | Per-source API key rotation leaves the adapter unable to fetch                                     | SYS-011     | Medium    | REQ-IF-006                                                 | UTP-010-C, ITP-010-A                                           | ⬜     |
| HAZ-016     | Atomic per-source count+record race overshoots a source's cap                                      | SYS-006     | Critical  | REQ-019, REQ-020                                           | UTP-005-A, ITP-005-A, AT-020-A                                 | ⬜     |
| HAZ-017     | Crosswalk key drift attaches the wrong food `id` to a source item                                  | SYS-007     | Critical  | REQ-028, REQ-029, REQ-045, REQ-CN-007                      | UTP-006-D, ITP-006-A, AT-024-A                                 | ⬜     |
| HAZ-018     | Branded vs generic `kind` collision overwrites golden scalars                                      | SYS-007     | Serious   | REQ-028                                                    | UTP-006-A, UTP-017-B                                           | ⬜     |
| HAZ-019     | A tombstoned food's `external_key` stays unresolved past the TTL                                   | SYS-007     | Serious   | REQ-018, REQ-025                                           | UTP-006-B, AT-025-A                                            | ⬜     |
| HAZ-020–035 | Preserved re-keyed hazards (queue/worker/limiter/store/auth-adjacent) per `hazard-analysis.md`     | (per row)   | (per row) | (per FMEA row)                                             | (per FMEA controls)                                            | ⬜     |
| HAZ-036     | Unauthenticated / auth-bypass access (sync or async producer)                                      | SYS-013     | Critical  | REQ-035, REQ-037a–d, REQ-041, REQ-042, REQ-043, REQ-IF-008 | UTP-012-A/B, UTP-014-A/B, ITP-012-A/E, ATP-008-A               | ⬜     |
| HAZ-037     | Insider denial-of-wallet — a valid `sub` exhausts a source budget / starves the queue              | SYS-013     | Critical  | REQ-039, REQ-040a–b, REQ-019, REQ-044a–d                   | UTP-012-E/F/H, ITP-012-C, ATP-008-F                            | ⬜     |
| HAZ-038     | Demotion-scorer demand-state unavailable — fail-open vs fail-closed                                | SYS-013     | Critical  | REQ-039, REQ-040a–b, REQ-019                               | UTP-012-E/H, ITP-012-C                                         | ⬜     |
| HAZ-039     | Token-class confusion (user vs M2M) accepted on the wrong surface                                  | SYS-013     | Critical  | REQ-038a–c, REQ-041, REQ-IF-008                            | UTP-012-A/D, UTP-014-D, ITP-012-A/B/H, ATP-008-G/H             | ⬜     |
| HAZ-040     | WebSocket `$connect` authorizer cache falls open (replays once-valid policy)                       | SYS-013     | Critical  | REQ-043, REQ-IF-008                                        | UTP-012-J, ITP-012-A, ATP-008-E                                | ⬜     |
| HAZ-041     | Per-source rolling-window **state loss** restarts a source's count at 0                            | SYS-006     | Critical  | REQ-019, REQ-020 (+ REQ-018)                               | UTP-005-A, UTP-005-C, AT-019-A                                 | ⬜     |
| HAZ-042     | **(New.)** Nutritionally-incoherent merge — blends mismatched bases without per-100g normalization | SYS-015     | Critical  | REQ-051, REQ-NF-018                                        | UTP-017-D, ITP-015-A, AT-051-B                                 | ⬜     |
| HAZ-043     | **(New.)** Wrong-merge — distinct foods auto-unified / out-of-set candidate pick                   | SYS-015+016 | Critical  | REQ-050, REQ-048, REQ-049, REQ-051                         | UTP-017-A, UTP-018-B, ITP-015-B, ITP-016-C, AT-049-B, AT-050-B | ⬜     |
| HAZ-044     | **(New.)** Source-data poisoning / "longer-wins" amplification of free-text/identity fields        | SYS-015     | Serious   | REQ-051, REQ-055                                           | UTP-017-B, UTP-021-B, ITP-019-A, AT-051-A                      | ⬜     |
| HAZ-045     | **(New.)** Untrusted external data stored unvalidated (malformed/oversized/non-HTTPS)              | SYS-020     | Critical  | REQ-055, REQ-024, REQ-NF-018                               | UTP-021-A, UTP-021-B, ITP-019-A, ITP-019-B, AT-055-A           | ⬜     |
| HAZ-046     | **(New.)** Concurrent add-by-name duplicate-food race (two rows for one logical food)              | SYS-018     | Serious   | REQ-005, REQ-013, REQ-047                                  | UTP-016-A, ITP-014-A, AT-005-B                                 | ⬜     |
| HAZ-047     | **(New.)** User-resolution clobbered by a blind refresh                                            | SYS-019     | Serious   | REQ-031, REQ-053 (+ REQ-049, REQ-052)                      | UTP-020-B, ITP-018-B, AT-031-B                                 | ⬜     |

> HAZ-020..035 are the preserved/re-keyed FMEA rows between the early adapter/store hazards and the auth
> slice; each carries its own SYS, REQ-set, and MOD/test control in `hazard-analysis.md` (the FMEA is the
> authoritative source). They are collapsed to a single summary row here only to keep this matrix readable —
> none is an orphan: every HAZ-001..047 has a REQ mitigation and a test/inspection control.

---

## Coverage Audit

### Requirements Coverage by Category

| Category                         | Total REQs | REQs with AT/ATP            | Inspection-Only                                      | Analysis-Only          | Unit/Indirect-Only                         | Coverage % |
| -------------------------------- | ---------- | --------------------------- | ---------------------------------------------------- | ---------------------- | ------------------------------------------ | ---------- |
| Functional (REQ-001..055)        | 63         | 56                          | 4 (REQ-017, REQ-022, REQ-030, REQ-IF-005-adjacent)\* | 0                      | 2 (REQ-020 + AT-020-A/UTP-005, REQ-034 P3) | **97%**    |
| Non-Functional (REQ-NF-001..018) | 18         | 7                           | 8                                                    | 3 (REQ-NF-014/015/017) | 0                                          | **100%**   |
| Interface (REQ-IF-001..012)      | 12         | 10                          | 2 (REQ-IF-005, REQ-IF-006)                           | 0                      | 0                                          | **100%**   |
| Constraint (REQ-CN-001..007)     | 7          | 1 (REQ-CN-007 via AT-046-A) | 6                                                    | 0                      | 0                                          | **100%**   |
| **Total**                        | **100**    | **74**                      | **20**                                               | **3**                  | **3**                                      | **98%**    |

> \*REQ-017 (30s lease) and REQ-022 (single-instance worker) are verified by inspection + unit/integration
> (UTP-003-D lease/lock, STP-005 lease reclaim) rather than a dedicated AT. REQ-020 (atomic check-and-record)
> has both AT-020-A and unit UTP-005-A. REQ-034 (WebSocket) is P3, excluded from the shippable exit gate.

### Unit Test Coverage Summary

| MOD range    | Modules                                                                                                | UTP cases | Notes                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------ | --------- | -------------------------------------------------------- |
| MOD-001..011 | Preserved/re-keyed (request, queue, worker, limiter, store, cache, USDA adapter, WS, secrets, logging) | 36        | UTP-001-A..H … UTP-011-A..B; `fdcId` only at UTP-008-A/B |
| MOD-012..014 | Auth slice (verify+authz, demotion, async provenance)                                                  | 15        | UTP-012-A..J + UTP-014-A..E                              |
| MOD-015..021 | New (registry, DAO, merge, candidate, provenance, refresh, validator)                                  | 21        | UTP-015-A..B … UTP-021-A..C                              |
| **Total**    | **21 MODs**                                                                                            | **72**    | All 5 ISO 29119-4 techniques represented                 |

### Acceptance + Integration + System Coverage

| Tier                        | Cases                                  | Scope                                                                                          |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Acceptance — functional     | AT-001-A .. AT-055-A (35 cases)        | Read, add-by-name, candidates/resolve, merge, search, rate-limit, refresh, `fdcId`-confinement |
| Acceptance — auth (US-0)    | ATP-008-A .. ATP-008-I (9 cases)       | 401/403/400/503 + demotion + M2M + WS across every entry point                                 |
| Acceptance — non-functional | AT-NF007/011/012/013/016/018 (6 cases) | CI gate, latency, rate-limit, async latency, zero-loss, data fidelity                          |
| Integration                 | ITP-001-_ .. ITP-019-_                 | Every MOD/ARCH boundary in the Dependency View (incl. ITP-013-B confinement)                   |
| System                      | STP-001-_ .. STP-010-_                 | End-to-end add→resolve→read, rate-limit, auth edge, refresh                                    |

---

## Orphan & Gap Report

### Orphan Analysis

**Orphan REQs** (requirements with no downward trace):

> **None.** All 100 requirements decompose to ≥1 SYS → ARCH → MOD and carry a verification method (Test,
> Inspection, Analysis, or Demonstration). The new REQ-045..055 / REQ-IF-009..012 / REQ-CN-007 each trace to
> a new SYS/ARCH/MOD and a new test (see Matrices A/C/D).

**Orphan design elements** (SYS / ARCH / MOD with no parent above or child below):

> **None.** Every SYS-001..020 lists a REQ parent; every ARCH-001..019 lists a SYS parent; every MOD-001..021
> lists an ARCH parent **and** ≥1 UTP. The prior MOD SYS-parent skew (ARCH-006/007 → wrong SYS) is corrected.
> ARCH-012 → three MODs (MOD-012/013/014) is intentional, not an orphan.

**Orphan tests** (UTP / ITP / STP / AT with no upward trace to a REQ):

> **None.** Every UTP derives its MOD from its id (auth `UTP-012-E..J` → MOD-013, `UTP-014-*` → MOD-014 via
> the unit-test section headers); every ITP names its MOD/ARCH boundary; every AT/ATP maps to a REQ via the
> `AT-NNN-X → REQ-NNN` convention or its Tier-2 heading; every HAZ carries a REQ + test control.

**Genuine orphans / honest caveats (called out, not hidden):**

1. **REQ-034 (WebSocket) is P3 and deferred (US-9).** It has MOD-009 + UTP-009-A/B + ITP-009-A/B + ATP-008-E
   defined, but is **excluded from the shippable exit gate**. Not an orphan (it traces both ways) — flagged as
   not-required-for-launch.
2. **`fdcId` rows are deliberately confined, not orphaned.** `fdcId` appears in this matrix **only** on
   adapter-boundary rows: REQ-023/REQ-IF-004 ↔ SYS-009/SYS-014 ↔ ARCH-008/ARCH-013 ↔ MOD-008 ↔
   UTP-008-A/B / ITP-008-A/B / ITP-013-B / AT-023-A / AT-024-A. AT-046-A and ITP-013-B exist specifically to
   **assert** the confinement (no `fdcId` past the boundary, SC-013). This is a control, not a gap.
3. **HAZ-020..035 collapsed for readability.** They are fully enumerated in `hazard-analysis.md` with
   individual REQ + MOD + test controls; the single summary row here is a presentation choice, not a missing
   trace. The FMEA remains the authoritative hazard source.

### Gap Analysis — Inspection / Analysis / Demonstration REQs (non-gaps)

These are verified by code review, static analysis, architectural analysis, or demonstration rather than an
executable acceptance test. They are **not coverage gaps** — they are covered by their stated method.

| REQ-ID(s)                             | Method          | Risk | Notes                                                                                      |
| ------------------------------------- | --------------- | ---- | ------------------------------------------------------------------------------------------ |
| REQ-NF-001/002/003/006/008/009/010    | Inspection      | Low  | Strict TS / JSDoc / import / workspace / pyramid / error / date conventions; CI-checked    |
| REQ-NF-004/005                        | Inspection      | Med  | UI accessibility; deferred to the UI implementation phase                                  |
| REQ-NF-014/015/017                    | Analysis        | Low  | Cache-hit rate / throughput / availability tracked via CloudWatch post-production          |
| REQ-017, REQ-022, REQ-CN-003          | Inspection      | High | 30s lease + single-instance worker; CDK/advisory-lock review (HAZ-011); UTP-003-D          |
| REQ-018, REQ-030                      | Inspection      | Low  | Tombstone TTL / Redis key format (deferred variant)                                        |
| REQ-IF-005                            | Inspection      | Low  | EventBridge carries scheduled + completion only; CDK rule + event-schema review            |
| REQ-IF-006                            | Inspection      | High | Per-source key in Secrets Manager; HAZ-001/015 mitigations via UTP-010-\*                  |
| REQ-CN-001/002/004/005/006            | Inspection      | Low  | Region / lean-launch / scope / rate-limit / workspace constraints; CDK + schema review     |
| REQ-045, REQ-046, REQ-054, REQ-CN-007 | Inspection+Test | High | Identity / `fdcId`-confinement / adapter-boundary; **also** tested by AT-046-A + ITP-013-B |
| REQ-034                               | Demonstration   | Low  | P3 WebSocket; excluded from the exit gate                                                  |

| Unit/indirect-only | Coverage                       | Risk | Notes                                                                     |
| ------------------ | ------------------------------ | ---- | ------------------------------------------------------------------------- |
| REQ-020            | AT-020-A + UTP-005-A/B/C       | Low  | Atomic check-and-record has both an AT and unit coverage                  |
| REQ-029            | AT-052-A + AT-010-A (indirect) | Low  | Index presence verified by provenance single-query + 200ms latency probes |

---

_End of Traceability Matrix — 003-usda-food-data (re-baselined 2026-06-22, source-agnostic food data model)_
