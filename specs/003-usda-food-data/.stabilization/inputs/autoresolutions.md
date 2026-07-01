# Autoresolution defaults — feature 003 stabilization

The user authorized: "autoresolve what you can with best decisions." Resolve every contradiction/gap
to ONE canonical answer using these defaults. Stay within the EXISTING design intent — this is
stabilize-and-complete, NOT redesign. Only escalate to the user a decision that is genuinely
high-stakes AND ambiguous (put those in a short "Open for user" list); resolve everything else.

## Guiding principles

1. **Demand-driven on-request ingestion stays.** No bulk-mirror of USDA datasets.
2. **The rate-limiting / rolling-60-min / pause-at-90% design is settled.** Don't change it; only
   complete underspecified semantics (e.g. single-drainer invariant, demotion for multi-requester).
3. **Single source (USDA) at launch.** Multi-source merge is structural pass-through only for v1.
4. **plan.md §2 is the canonical data model** (+ `food_candidates`). All other docs conform to it.
5. **Internal ULID `id` identity; no source-native key as PK/FK; no raw payload; no EAV.**

## Canonical decisions (apply everywhere)

- **D-EVENT**: completion event name = **`FoodFetchCompleted`** (matches plan §4 + the CDK rule).
  Replace every `FoodDataReceived` with it across spec.md and the v-model.
- **D-CANDIDATES**: add the **`food_candidates`** table (id, food_id, source, external_key, name,
  summary, created_at; UNIQUE(food_id,source,external_key)) to plan §2 table list, ARCH-006,
  module-design, spec FR-028, tasks, and the traceability matrices. It backs `UNRESOLVED`/US-005a.
- **D-SC005**: restate SC-005 — separate **read/serve throughput** (local golden-record reads, no
  source call: keep a high target) from **first-time resolution rate of NEW foods** (bounded by the
  USDA budget, ~500–900/hr). Remove the SC-002 contradiction; keep SC-002 as-is.
- **D-DEMAND**: enqueue demand = **distinct-requester** (FR-044): upsert `(food_id, sub)` into
  `fetch_requesters`, set `fetch_queue.request_count` to the capped distinct-`sub` count
  (PRIORITY_CAP=1) — never raw `+1`. Rewrite FR-014/plan §4 to this; fix the US-005 test expectation.
- **D-AUTORESOLVE**: auto-RESOLVE when **exactly one** candidate survives normalized-name exact match
  (after dedup); **>1 → UNRESOLVED**; **0 → NOT_FOUND**. Add the FR + acceptance tests. The matcher
  need not be perfect (human is final arbiter), so bias toward UNRESOLVED over a wrong auto-pick.
- **D-REFRESH**: change detection = **re-fetch + hash compare** (`item_version`); refresh runs as
  **low-priority background work that yields to live demand** (idle-drain), as a **Fargate scheduled
  task** (ADR-0004, not a VPC Lambda). Cadence is budget-bounded, not a fixed promise.
- **D-FAIRNESS**: complete (don't redesign) demotion — maintain a per-`sub` pending count; a food is
  demoted only when **all** its requesters exceed the threshold (50); near the global ceiling, shed a
  flooding `sub`'s NEW enqueues first (503) to preserve headroom. No per-user quota, no 429 on
  reads/resolves.
- **D-UNRESOLVED-TTL**: an `UNRESOLVED` food is kept until a human picks; its candidate set expires
  after **30 days** and re-fan-out occurs on the next request (mirrors the NOT_FOUND 30-day TTL).
- **D-PROVENANCE-FK**: document the composite same-food integrity rule — `UNIQUE(food_id, id)` on
  `food_sources` and composite `(food_id, source_id)` FKs on nutrients/portions/field-provenance.
- **D-LEASE**: document a `leased_at` column on `fetch_queue` + a reaper that reclaims `in_flight`
  rows whose lease is older than the lease window (30s). Single drainer enforced via advisory lock.
- **D-LIFECYCLE**: document the explicit legal transition set and that refresh never overwrites a
  user's manual pick; PATCH-resolve is UNRESOLVED-only, idempotent, candidate-in-set validated.
- **D-AUTH**: keep the specified `FoodAuthGuard` (networkless Clerk verify, fail-closed, scopes from
  public_metadata); state that the forgeable `x-debug-sub` path is removed. No design change.
- **D-CLEANUP**: purge all residual `fdcId` / cache-hit/miss framing from every doc; `fdcId` may
  appear ONLY as "USDA's `external_key`, inside the adapter boundary."
- **D-STATUS**: correct `.forge-status.yml` — `implement` → not-started (design is being stabilized;
  no implementation this phase); revalidation reflects the stabilized product-spec.

## Quality bar for the reconciled docs

- Every FR/SYS/ARCH/MOD/REQ id traces end-to-end (spec ↔ plan ↔ v-model ↔ tasks ↔ traceability).
- No contradictions, no orphan ids, no dangling cross-references, no TODO/placeholder text.
- Consistent terminology + the canonical names above. Seamless, complete, implementation-ready DESIGN
  (not implemented — design baseline only).
