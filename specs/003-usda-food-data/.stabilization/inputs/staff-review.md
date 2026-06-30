# Staff review findings (DB + backend + architect) — feature 003 source-agnostic food data

Condensed from three independent staff-level reviews. These are the known defects/gaps the
stabilization must resolve. (Severity: C=critical, H=high, M=medium.)

## Cross-layer contradictions

- **[C] SC-002 vs SC-005**: SC-005 promises ≥5,000 foods/hr but USDA cap is 1,000 req/hr and
  name-search is ~1 non-batchable call per NEW food → ~500–900/hr real ceiling. The two criteria
  can't both hold. (Model is fine — the metric is wrong.)
- **[C] FR-014 vs FR-044**: canonical enqueue SQL does `request_count + 1` (raw count) while FR-044 /
  ARCH-003 mandate **distinct-requester** counting (PRIORITY_CAP=1). US-005's test asserts the raw model.
- **Naming drift**: completion event is `FoodFetchCompleted` (plan §4 + CDK rule) vs `FoodDataReceived`
  (spec.md + v-model). Pick one canonical name everywhere.
- Schema-as-documented vs architecture: ensure plan §2 data model, ARCH-006, module-design, and
  spec FR-028 describe the SAME tables/columns/enums.

## Gaps / missing requirements

- **[C] No `food_candidates` storage**: `food_status` includes `UNRESOLVED` and US-005a needs the
  candidate set persisted (`GET /candidates` → `PATCH`-resolve), but plan §2's table list + ARCH-006
  have no table for it. (Already added to the schema; must be added to plan/architecture/module-design/
  spec/tasks/traceability.)
- **[H] Auto-RESOLVE vs UNRESOLVED boundary undefined** yet the ≥90%-auto-resolve metric depends on
  it. Needs a concrete rule + FR + acceptance tests.
- **[H] Change-driven refresh has no cheap change signal** (USDA has no per-item etag). Detection =
  re-fetch + hash compare (`item_version`), run low-priority/idle so it never starves live demand.
- **[H] Fairness-by-demotion bounds order, not volume**: one authenticated `sub` adding ~10k names
  trips the global 503 ceiling for everyone. Demotion key (`pending-count>50`) is also undefined for
  multi-requester foods and not index-serviceable.
- **UNRESOLVED-TTL** for a food nobody ever picks is deferred — decide it.
- 8 residual acceptance-test gaps noted in forge status (REQ-038a, REQ-044b, + auto-resolve, etc.).
- Residual `fdcId` / cache-hit framing left over from the pre-re-baseline design in some docs.

## Data-model integrity / quality (design-doc level)

- **[C] Provenance `source_id` can cross foods**: `food_nutrients/portions/field_provenance.source_id
→ food_sources(id)` only checks existence, not same-`food_id`. A composite `(food_id, source_id)`
  FK (with `UNIQUE(food_id,id)` on `food_sources`) makes "same-food" a structural invariant.
- **[H] Worker lease has no expiry/reclaim**: `fetch_queue` has `in_flight` but no `leased_at`; a
  worker crash mid-lease orphans the row forever (priority index is `WHERE status='pending'`). Need a
  lease column + reaper described in plan/architecture.
- **[H] Rate-limiter "zero 429 in any window" is only safe under a strictly-enforced single drainer**
  (read-committed count race); make single-drainer an explicit invariant (advisory lock) and/or make
  the check-and-record atomic. (Rate-limiting design itself is settled — only the concurrency
  invariant needs stating.)
- `source` should be the `food_source` enum everywhere (no free-text drift) — already in plan §2.
- `ON DELETE` for `source_id` should not cascade-delete golden values on source-row removal.
- `source_call_log` needs a documented pruning/retention story.
- `normalized_name` unique: `createByName` must REACTIVATE a terminal (NOT_FOUND/FAILED) row, not 23505.

## Lifecycle / behavior (state-machine level — document, don't implement here)

- Lifecycle transitions are only value-CHECK'd; document the explicit legal transition set
  (PENDING→{RESOLVED,UNRESOLVED,NOT_FOUND,FAILED}; UNRESOLVED→RESOLVED; FAILED→PENDING retry;
  NOT_FOUND→PENDING after TTL) and that refresh must not clobber a user's manual pick.
- PATCH-resolve must be UNRESOLVED-only + idempotent + candidate-in-set validated.
- Auth: a real `FoodAuthGuard` (networkless Clerk verify) is specified; the forgeable `x-debug-sub`
  path must be removed. (Spec/plan already intend this — ensure it's stated, no design change.)

## Out of scope for stabilization (do NOT redesign)

- The rate-limiting / rolling-60-min-window / pause-at-90% design is settled and stays.
- The demand-driven on-request ingestion model stays (NO bulk-mirror of USDA).
- Single-source (USDA) launch; multi-source blend is structural-only (pass-through) for v1.
