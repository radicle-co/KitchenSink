# Feature 003 — Remediation Plan (source-agnostic food data + USDA sync)

**Created**: 2026-06-28
**Status**: Proposed — awaiting approval
**Goal**: After running Product Forge end-to-end, have a working `kitchensink_food` database
and a NestJS food service over it that **syncs with USDA properly** (bulk corpus + on-demand
API), with auth, search, add-by-name, candidate resolution, change-driven refresh, tests, and
web+mobile parity.

**Inputs**: three staff reviews (DB engineer, backend engineer, architect) of the re-baselined
product-spec, spec, plan, v-model architecture, and the reworked `food.ts` schema. This plan
reconciles all of them to ONE design and maps every finding to the Product Forge phase that fixes it.

---

## Part A — Design decisions (the forks the reviews surfaced)

These are resolved with staff-level recommendations. They change downstream artifacts, so they are
the approval gate. Veto/adjust any before execution.

### D1 — USDA sync model: **keep demand-driven on-request ingestion; fix the contradictory SLO** (NOT bulk-mirror)

- **Premise (unchanged, per the feature vision)**: ingest a food from USDA **when it is requested**,
  and re-fetch it when it needs refreshing. Coverage grows from real demand via the event-driven,
  rate-limited backfill queue. We do **not** bulk-mirror USDA's monthly dataset dumps — that would
  defeat the demand-weighted queue, store foods nobody wants, and change the feature's nature.
- **The real problem (architect C1)**: SC-005 promises ≥5,000 foods/hr, but USDA's cap is 1,000
  req/hr and name-search is ~1 (non-batchable) call per NEW food — so the metric, not the model, is
  wrong. SC-002 and SC-005 cannot both hold.
- **Decision**:
    1. **Restate SC-005** to separate two rates: _first-time resolution of NEW foods_ is bounded by the
       USDA budget (~500–900/hr at the cap, since each add ≈ 1 search + a batched `fetchByKey`), and
       _read/serve throughput_ of already-resolved foods is local and high (no API call on a resolved
       read). Drop the contradiction; pin SC-005 to the read rate (or lower the resolution target to the
       real budget-bound ceiling).
    2. **Refresh stays demand/age-driven** (H3 answer within the demand model): detect change by
       **re-fetching a stored item via the API and hash-comparing** (`item_version` = content hash;
       USDA has no cheap per-item etag), run as **low-priority background work that yields to live user
       demand** (idle-drain, never blocks adds). A full-store refresh takes as long as the spare budget
       allows — acceptable because it never starves user requests.
- **Effect**: resolves SC-002↔SC-005 without changing the ingestion model. The demand-driven queue /
  fan-out / rate-limiter is the core path, exactly as designed.

### D2 — Schema: **the rich architecture model is the single source of truth** (was: my reduced `food.ts`)

- **Why**: my `food.ts` can't store what the merge engine must merge (no nutrient dictionary,
  no `description`/`brand`/`barcode`/`basis`/`food_category`, free-text instead of pgEnums,
  pg_trgm dropped). [architect C2, DB, BE]
- **Decision**: Rebuild `food.ts` + migration to the architecture/plan's richer model AND keep
  `food_candidates` (add it to architecture + plan). Reconcile architecture ⇄ plan ⇄ schema so all
  three agree.

### D3 — Merge: **single-source pass-through for launch** (structure retained)

- **Why**: the cross-source field-blend never fires with one wired source (USDA) and will be reworked
  once a real source #2 reveals its quirks — building/testing it now is speculative. [architect M1, M6]
- **Decision**: keep identity / crosswalk / candidates / provenance (all cheap and correct now); ship
  `GoldenRecordMergeEngine` as a single-source pass-through; defer field-level blend rules and
  re-validate the adapter interface against a concrete hypothetical source #2 before declaring it stable.

### D4 — Auto-RESOLVE threshold: **defined, not deferred**

- **Why**: the ≥90%-auto-resolve metric depends entirely on a threshold that was "deferred to
  planning"; for common names a conservative matcher makes candidate-pick the default path. [architect H4]
- **Decision**: auto-RESOLVE when exactly **one** candidate survives normalized-name exact match
  (after corpus + adapter dedup); >1 survivor → UNRESOLVED. With the bulk corpus (D1) exact matches
  are usually unique. Validate the ≥90% target against a real USDA sample during implement.

### D5 — Fairness: **bound volume, not just order**

- **Why**: demotion only reorders; one authenticated `sub` adding ~10k names trips the global 503
  ceiling for everyone. [architect H2]; and the demotion sort key isn't indexable / is undefined for
  multi-requester foods [all three].
- **Decision**: maintain a **per-`sub` pending counter** (incremented at enqueue, decremented at
  resolve/tombstone). Use it to (a) shed a flooding sub's _new_ enqueues with 503 first near the
  ceiling, and (b) make demotion indexable and defined (demote a food only when **all** its
  requesters exceed threshold).

---

## Part B — Schema hardening (folded into D2's rewrite)

All from the DB/BE reviews; applied when `food.ts` + migration are rebuilt:

1. **Composite same-food FKs** — `UNIQUE (food_id, id)` on `food_sources`; `food_nutrients`,
   `food_portions`, `food_field_provenance` carry composite FK `(food_id, source_id) → food_sources(food_id, id)`.
   Closes the cross-food provenance hole. [DB CRITICAL]
2. **`pg_trgm` GIN index** on `name` (`gin_trgm_ops`) for typo-tolerant search; make `search_vector`
   a `GENERATED ALWAYS … STORED` column (self-maintaining) or drop it in favor of trgm. [DB CRITICAL/HIGH]
3. **`fetch_queue.leased_at`** + reaper (lease query reclaims `in_flight` older than 30s); FKs on
   `fetch_queue.food_id` and `fetch_requesters.food_id → foods(id)` with cascade. [DB/BE CRITICAL/HIGH]
4. **`source_id` ON DELETE NO ACTION** (force explicit re-merge; never cascade-delete golden values). [DB HIGH]
5. **pgEnums** for `source`, `food_field`, `nutrient_basis`, `food_status`, `fetch_queue_status`,
   `food_kind` (repo convention; stops `usda`/`USDA` fragmenting provenance + rate windows). [DB/architect]
6. **Atomic per-source limiter** — token-bucket row (`UPDATE … SET tokens = tokens-1 WHERE tokens>0
RETURNING`) or advisory-lock-per-source around check-and-record; single-drainer made an **explicit
   enforced invariant** (worker holds `pg_advisory_lock(drain-key)`; ≥2 tasks for warm failover).
   `source_call_log` gets a pruning job or time partitioning. [BE CRITICAL, architect H1]
7. **Nutrient dictionary** (`nutrients`: code/name/`unit`/external_code); `food_nutrients` references
   it + carries `amount` + `basis` + `source_id` (no unit on value row). `foods` gains
   `description`/`brand_owner`/`brand_name`/`barcode`; add `food_category` + assignment. [architect C2]
8. **`numeric(p,s)`** for nutrient amounts; ISO-8601 at DTO boundary; multi-table golden-record
   persistence in **one transaction**. [DB/BE]

---

## Part C — Behavior hardening (DAO seam + service)

1. **Guarded lifecycle transitions** — every status write is conditional on the legal prior set,
   asserts `rowCount=1`; protects user manual picks from refresh clobber. [BE H3]
2. **`createByName`** — `INSERT … ON CONFLICT (normalized_name) DO UPDATE … RETURNING id` (always
   returns a row); **reactivates** a terminal (NOT_FOUND/FAILED) row to PENDING + re-enqueue. [DB/BE]
3. **PATCH-resolve** — `WHERE id=$1 AND status='UNRESOLVED'` (409 otherwise); candidate-in-set
   validation; idempotent repeat. [BE H4]
4. **NOT_FOUND/FAILED 30-day TTL revival** — scheduled/read-triggered transition; enqueue `ON CONFLICT`
   must allow reviving a tombstone. [BE H7]
5. **Real `FoodAuthGuard`** — port identity `AuthMiddleware` (networkless Clerk verify + `azp`,
   fail-closed 401, scopes from `public_metadata`); **delete the forgeable `x-debug-sub` path**. [BE H5]
6. **Distinct-requester enqueue** — replace raw `request_count+1` with the `fetch_requesters` upsert +
   recompute-only-on-insert; fix the US-005 test expectation. [architect C3]
7. **Batch** — lexical ULID sort, ≤100 validation before any write, per-item partial-result DTO. [BE M6]
8. **Change-refresh = Fargate scheduled task** (not a VPC Lambda — ADR-0004): re-fetch stored items
   via the API + hash-compare (`item_version`), enqueued as **low-priority** work that yields to live
   demand; field-surgical writes that pin user resolutions. [architect M3, M2, H3; D1]
9. **Alarms** — fire on `FAILED` tombstones only; `NOT_FOUND` is informational. [architect M5]

---

## Part D — Execution mapped to Product Forge phases

The order that makes `product-forge` produce a working service:

| Phase                 | Skill        | Work                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3. Revalidation (now) | `revalidate` | Revise `product-spec.md` (+journeys/metrics/wireframes) to encode **D1–D5**: bulk-USDA-corpus epic/story, SC-002↔SC-005 fix, FR-014→distinct-requester, auto-resolve threshold, per-sub volume fairness, single-source merge descope. Log this review + revisions in `review.md`. **Approve → lock.**                                                                         |
| 4. Bridge             | `bridge`     | Regenerate `spec.md` from the revised product-spec.                                                                                                                                                                                                                                                                                                                           |
| 5. Plan               | `plan`       | Reconcile `v-model/architecture-design.md` + `plan.md` to the **rich schema (D2)** + the **USDA bulk-dataset ingester** component (Fargate scheduled task) + all **Part B/C hardening**. Rewrite `food.ts` + `0000_food_schema.sql` to the rich, hardened schema.                                                                                                             |
| 6. Tasks              | `tasks`      | Regenerate `tasks.md` + v-model V&V: dependency-ordered build steps — DB/migration, DAO seam, repository (golden-record assembly), add-by-name, worker (lease+reaper+atomic limiter+single-drainer), USDA adapter (bulk ingester + API client), candidate/resolve, auth, trgm search, batch, change-refresh, notification publish, observability, tests, web+mobile UI (§14). |
| 7. Implement          | `implement`  | Build it. **Definition of done** below.                                                                                                                                                                                                                                                                                                                                       |

### Definition of done (Phase 7 exit)

- `0000_food_schema.sql` applies cleanly to `kitchensink_food`; `food.ts` matches it (no drift).
- Service boots; `/health` green; all routes behind `FoodAuthGuard` (no `x-debug-sub`).
- USDA monthly datasets ingested into the corpus; local trgm search returns typo-tolerant hits.
- Add-by-name → 202 + ULID; corpus hit resolves locally; corpus miss → rate-limited API gap-fill →
  RESOLVED or UNRESOLVED; candidate pick → RESOLVED with provenance.
- Per-source budget never exceeded under concurrency; worker crash mid-lease is reclaimed.
- `npm run typecheck`, `lint`, unit + integration (LocalStack + Docker Postgres) + e2e green.
- Web + mobile ship the candidate-picker / status surfaces in the same PR (§14).

---

## Part E — Findings → resolution traceability (nothing dropped)

- Schema↔spec divergence (architect C2) → D2 + Part B.7
- Provenance cross-food hole (DB C1) → B.1
- pg_trgm missing / FTS unmaintained (DB C2/H, architect) → B.2
- Worker lease orphan (BE C2, DB) → B.3, C (reaper)
- Rate-limiter TOCTOU / zero-429 (BE C3, architect H1) → B.6
- SC-002↔SC-005 (architect C1) → D1 (restate SLO; keep demand-driven, no bulk mirror)
- Change-refresh no cheap signal (architect H3) → D1 (re-fetch + hash, low-priority idle drain)
- FR-014↔FR-044 (architect C3) → C.6
- Auth absent / forgeable header (BE H5) → C.5
- Queue FKs / cascade safety (DB/BE) → B.3, B.4
- Lifecycle unguarded / TTL revival (BE H3/H4/H7) → C.1, C.3, C.4
- Auto-resolve undefined (architect H4) → D4
- Fairness volume hole + demotion indexability (architect H2/H5, DB/BE) → D5
- Multi-source YAGNI (architect M1/M6) → D3
- source_call_log unbounded (DB/BE) → B.6
- normalized_name reactivation (DB) → C.2
- shared global DB / per-PR isolation, instance size (architect M4) → resolve in Phase 5
- consumer layer won't compile (all three) → Phase 7 rewrite
