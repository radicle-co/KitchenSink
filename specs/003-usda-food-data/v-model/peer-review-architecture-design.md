# Peer Review — architecture-design

> **⚠️ Historical record — partially superseded (doc-stabilization 2026-06-28).** Findings citing raw
> `request_count = request_count + 1` enqueue or inconsistent `'queued'/'leased'` queue status are
> resolved: `architecture-design.md` ARCH-003 is now distinct-requester (`fetch_requesters` upsert,
> PRIORITY_CAP=1, `leased_at`) per **D-DEMAND**/**D-LEASE** in `decision-register.md`. No design change implied.

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-06-20
**Artifact**: architecture-design.md (12 architecture modules, ARCH-001…ARCH-012)
**Standard**: IEEE 42010 / Kruchten 4+1
**Source of truth**: `../spec.md` (FR-011/014/015/016/018/019/020/023/025/031/032/035–053, SC-006/011/012, A-005/010/012), `../v-model/module-design.md` (MOD-001…MOD-014), `../plan.md` §2A
**Scope**: full-document review against the reconciled + clarified locked design — Postgres-as-queue + Fargate worker (no SQS), MOD-005 `RollingWindowLimiter` rolling-60-min window (not token bucket), MOD-013 `DemotionAndFairness` (DEMOTE*THRESHOLD=50, dynamic re-promotion, no `429`; quota tables dropped), SWR serve-stale-indefinitely, tombstone TTL 30d, batch per-item partial, ARCH-012 in-process auth. Checks: stale-vocabulary purge (token-bucket / per-`sub` quota / SQS as \_live* design), ARCH↔MOD name agreement, 4+1 view completeness, traceability, and design correctness of the demand/demotion path.

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 2     |
| Minor              | 3     |
| Observation        | 1     |
| **Total Findings** | **6** |

> ⚠️ **Verdict superseded** — the counts and verdict in this Summary predate doc-stabilization; read them through the **Stabilization reconciliation (decision register, 2026-06-28)** appendix at the foot of this file, which is the controlling record.

Overall assessment: **PASS WITH MAJORS**. The document is cleanly reconciled to the locked design at the prose/overview level: the rolling-window limiter is named `RollingWindowLimiter` (ARCH-005) and described as a windowed count+record over `usda_call_log` with a 90%/900 pause and "treat the window as full" on USDA `429` (no token/refill language survives); the demand path is Postgres-as-queue (`INSERT … ON CONFLICT` + `pg_notify`, no SQS/consumer Lambda); fairness is described everywhere as **demotion, not `429`** (DEMOTE_THRESHOLD=50, dynamic at drain time); SWR / tombstone-TTL-30d / batch-per-item-partial are all present on ARCH-001; and ARCH-012 is a first-class in-process `AuthMiddleware` component with the WS `$connect` authorizer as the sole Lambda surface (FR-053). The prior Scenarios "+1" Major remains resolved (Scenario A/B load-bearing).

Two **Majors** remain and are load-bearing against the locked design: (1) the demand-priority mechanism shown in ARCH-003 / Interaction 2 / Data Flow 2 still increments a **raw per-request `request_count`** (`ON CONFLICT … DO UPDATE SET request_count = request_count + 1`), which **contradicts** the locked **distinct-requester** demand model (FR-044, MOD-013 `recordDemand` capped at `PRIORITY_CAP = 1`); and (2) the `fetch_queue` status vocabulary is internally and cross-artifact **inconsistent** (`'pending'` / `'done'` in ARCH vs `'queued'`/`'leased'` in MOD-003/004 vs spec's `'pending'`/`'in_flight'`), which matters because MOD-013's demotion pending-count query keys on a specific status literal. Minors cover the ARCH-012 interface op name (`scoreEnqueue` vs MOD-013 `admitEnqueue`/`isDemoted`), residual "Redis-first" depiction in two diagrams, and the carried Interaction-0 call-direction note.

## Findings

---

### PRF-ARCH-001 — Demand priority still increments raw per-request `request_count`, contradicting the locked distinct-requester (FR-044) model

**Severity**: Major
**Defect type**: Consistency with spec.md + ARCH↔MOD disagreement
**Location**: architecture-design.md ARCH-003 row (line 25); Interaction 2 (line 110); Data Flow 2 (line 291); ARCH-001 (implicit enqueue)

**Description**: ARCH-003 and the demand-path diagrams describe the enqueue as `INSERT … ON CONFLICT (fdc_id) DO UPDATE SET request_count = request_count + 1`, and demand priority as `ORDER BY request_count DESC, first_requested ASC`. That increments demand **once per request** — i.e. raw request volume. The locked design (FR-044, and MOD-013 `recordDemand`) requires demand to count **distinct authenticated `sub`s** per `fdcId`, recorded via a `fetch_requesters` (PK `fdc_id+sub`) upsert with a per-`sub` contribution **capped at `PRIORITY_CAP = 1`** — a single `sub`'s repeat requests must NOT bump priority more than once. As written, ARCH-003 lets one caller inflate `request_count` arbitrarily by re-requesting, which is precisely the priority-inversion starvation FR-044 closes. The architecture also never mentions the `fetch_requesters` table that MOD-013 and FR-041/FR-044 depend on.

**Recommendation**: Change the ARCH-003 / Interaction 2 / Data Flow 2 enqueue depiction to the distinct-requester model: `fetch_requesters` upsert on `(fdc_id, sub)` + a capped demand bump (delta = `PRIORITY_CAP`), with demand priority computed from distinct-`sub` count, and add `fetch_requesters` to the Logical/Physical views so the architecture matches FR-044 and MOD-013.

---

### PRF-ARCH-002 — `fetch_queue` status vocabulary is inconsistent within ARCH and against MOD/spec (`pending`/`done` vs `queued`/`leased` vs `in_flight`)

**Severity**: Major
**Defect type**: Internal consistency / cross-artifact data-model agreement
**Location**: architecture-design.md Interaction 1 (line 87 `fetch_status:'fetched'`), Interaction 2/4 (`status:'pending'`, lines 113, 151, 327), Interaction 3 / Data Flow 3 (`UPDATE … SET status='done'`, lines 136, 315); cross-check MOD-003/MOD-004 (`'queued'`/`'leased'`/`'tombstone'`), MOD-013 `pendingCountForSub` (`q.status = 'queued'`), spec.md FetchQueueRow (`pending` | `in_flight` | `tombstone`)

**Description**: Three different status enums are in play for the same `fetch_queue` row. ARCH uses `'pending'` (queued state) and `'done'` (completion). MOD-003/MOD-004 use `'queued'` / `'leased'` / `'tombstone'` and **ack by `DELETE`** (no `'done'` state at all — MOD-004 calls `FetchQueue.delete(row.fdc_id)`). spec.md's FetchQueueRow defines `'pending'` | `'in_flight'` | `'tombstone'`. This is load-bearing rather than cosmetic: MOD-013's demotion pending-count query (`WHERE … q.status = 'queued'`) and the FR-043/SC-012 fairness guarantee depend on a single agreed "currently pending" status literal; if the demand-path INSERT writes `'pending'` (ARCH) while the demotion query filters `'queued'` (MOD-013), the per-`sub` pending count silently returns 0 and demotion never engages.

**Recommendation**: Pick one canonical `fetch_queue.status` enum across spec.md, architecture-design.md, and module-design.md (and decide ack-by-`DELETE` vs `status='done'`), then reconcile Interaction 3 / Data Flow 3 and MOD-013's `pendingCountForSub` filter to it.

---

### PRF-ARCH-003 — ARCH-012 interface op `scoreEnqueue(sub)` does not match the locked MOD-013 surface (`admitEnqueue` / `isDemoted` / `drainPriorityTier`)

**Severity**: Minor
**Defect type**: ARCH↔MOD name agreement
**Location**: architecture-design.md ARCH-012 interface table (line 260); module-design.md MOD-013 §1 (`admitEnqueue`, `isDemoted`, `drainPriorityTier`, `recordDemand`, `checkBackpressure`, `enforceBatchCap`)

**Description**: The ARCH-012 interface table exposes `scoreEnqueue(sub) → { demote: boolean }` as the fairness operation. MOD-013 (`DemotionAndFairness`) does not define `scoreEnqueue`; its admission orchestrator is `admitEnqueue(reqUser, fdcIds)` and the demotion decision is `isDemoted(sub)` / `drainPriorityTier(row)`. The names are close enough to read as the same concept, but the audit criterion is exact ARCH↔MOD name agreement, and `scoreEnqueue` appears in no MOD. (`checkBackpressure` on the same ARCH table _does_ match MOD-013 — so the table is half-aligned.)

**Recommendation**: Rename the ARCH-012 row to the MOD-013 surface (`admitEnqueue` for the admit path, `isDemoted`/`drainPriorityTier` for the drain-time decision), or add a one-line note that `scoreEnqueue` is the architecture-level alias for MOD-013 `isDemoted`/`drainPriorityTier`.

---

### PRF-ARCH-004 — Two diagrams still depict Redis as the primary lookup tier, against the lean-launch Postgres default

**Severity**: Minor
**Defect type**: Consistency (lean-launch default)
**Location**: architecture-design.md Interaction 1 (lines 84–89), Interaction 2 (lines 104–107), Scenario A Logical row + diagram (lines 376, 393)

**Description**: ARCH-007's row, the Overview, and the Physical view all correctly state Redis is an **optional, deferred post-launch** cache and the lean-launch default is Postgres. But Interaction 1 ("Redis GET food:12345 → HIT"), Interaction 2 ("Redis GET … MISS"), and Scenario A's Logical row ("ARCH-007 (Redis)") present Redis as the first lookup tier without the "(optional)" qualifier that Interaction 2's own arrow carries. A reader of the Process/Scenarios views alone would conclude Redis is required at launch.

**Recommendation**: Annotate these arrows/rows as "cache tier (lean-launch = Postgres; Redis deferred)" consistent with ARCH-007 and the Physical view, so the default deployment topology is unambiguous.

---

### PRF-ARCH-005 — Interaction 0 / Scenario A model ARCH-001 calling back into the auth guard for the post-auth fairness/backpressure gate

**Severity**: Minor (carried from prior review)
**Defect type**: Process-view precision
**Location**: architecture-design.md Interaction 0 (lines 60–68), Scenario A diagram (line 395)

**Description**: In the success branch the Process View shows `A->>AG: pre-enqueue fairness/backpressure check (per-sub)` — i.e. the handler (ARCH-001) calling back into the guard (ARCH-012) after `next()` already transferred control. This muddles admission-control ordering ("after authentication and before `INSERT INTO fetch_queue`"). The locked decomposition has the handler invoke MOD-013 `admitEnqueue` (batch cap → `400`, backpressure → `503`, demand recording) synchronously before the enqueue; demotion itself is computed at **drain time** by ARCH-004, not "checked" at enqueue. The diagram conflates the enqueue-time admit with the drain-time demotion.

**Recommendation**: Redraw so ARCH-001 invokes MOD-013 `admitEnqueue` (admit/backpressure/demand) before the `INSERT`, and depict demotion as a drain-time scorer step in Interaction 3 (it is partly there already, line 128) rather than an enqueue-time call back into the guard.

---

### PRF-ARCH-006 — ARCH-012 is not tagged CROSS-CUTTING despite fronting every entry point

**Severity**: Observation (carried from prior review)
**Defect type**: Classification consistency
**Location**: architecture-design.md ARCH-012 Logical row (line 34); ID Schema CROSS-CUTTING convention (lines 16–17)

**Description**: ARCH-005/009/010/011 carry `[CROSS-CUTTING; …]` because they support multiple SYS components. ARCH-012 maps 1:1 to SYS-013, so the strict rule does not apply, yet it fronts every HTTP route + the WS `$connect` and reuses the shared `@kitchensink/clerk-verify` package — functionally the most cross-cutting module. The classification is defensible (dedicated parent SYS per FR-053) but the asymmetry invites the misread "auth is not cross-cutting."

**Recommendation**: No change required. Optionally add a one-line rationale on ARCH-012 that it is intentionally a first-class Component (1:1 with SYS-013 per FR-053) even though its concern is cross-cutting.

---

_End of Peer Review — architecture-design, 003-usda-food-data_

---

## Remediation Status (2026-06-20, round 4)

All **Critical and Major** findings in this review were **remediated in the same session**. The artifacts now reflect the canonical model — Postgres demand-weighted `fetch_queue` (single queue, no high/low tier), rolling-60-min window limiter (`usda_call_log`), dynamic queue **demotion** wired on every enqueue path (incl. single-food), distinct-requester demand via `fetch_requesters` (FR-044), `status` enum `pending | in_flight | tombstone`, single 30s lease, rolling-window state-loss hazard (HAZ-041), and in-process NestJS auth. Reconciled across spec/plan/tasks + the full v-model. This record documents the findings **as reviewed**; the gate (`.forge-status.yml → peer_review_gate`) reflects the post-remediation state. An independent re-review is the optional final confirmation.

---

## Stabilization reconciliation (decision register, 2026-06-28)

> This section supersedes the "Remediation Status (round 4)" note above wherever they differ. The
> stabilization **decision register** (`../decision-register.md`), with `../.stabilization/inputs/`, is the
> single canonical resolution. The findings above are retained verbatim as the review record; read every
> term in them through the canonical mapping below. The only in-place body edit applied by stabilization is
> the mandated completion-event rename to **`FoodFetchCompleted`** (the retired `FoodData*` completion-event names; D-EVENT).

**Canonical names (§1; D-EVENT / D-CLEANUP / D-AUTH).**

- Completion event = **`FoodFetchCompleted`** (EventBridge `DetailType`; publisher `publishFoodFetchCompleted`). `FoodRequested`/`FoodBatchRequested` are in-process enqueue markers, **not** EventBridge types; `IngestionScheduled`/`FetchFailed` keep their names.
- `food.status` lifecycle enum = **`PENDING | UNRESOLVED | RESOLVED | NOT_FOUND | FAILED`** (replaces the old `fetch_status` = `pending/fetched/failed/not_found/stale`). `fetch_queue.status` stays **`pending | in_flight | tombstone`**.
- USDA native id = **`external_key`**; the public/PK id is the internal **ULID `id`**. `fdcId`/`fdc_id` is **adapter-only** and must not appear on schema/DTO/API/DAO. Source = the **`food_source`** enum (no free-text). Errors: **`SourceApiError`** (not `UsdaApiError`), plus `RateLimitWindowFullError`/`FoodNotFoundError`/`CandidateMismatchError`.
- Read framing = **local-store read (RESOLVED) / local-store serve rate / add-by-name miss**; "cache hit/miss/hit-rate" is reserved for the deferred Redis variant (ARCH-007) only.
- Auth = **`FoodAuthGuard`** (food service; networkless Clerk verify, fail-closed, scopes from `public_metadata`); the forgeable **`x-debug-sub`** / trusted-identity-header path is removed (identity = the verified Clerk `sub` only). The auth slice is unchanged in scope.

**Canonical schema (§2; D-CANDIDATES / D-LEASE / D-PROVENANCE-FK).** plan.md §2 = **13 tables** (the 12 there **plus `food_candidates`** — `id, food_id, source, external_key, name, summary, created_at`; `UNIQUE(food_id, source, external_key)`, backing `UNRESOLVED`/US-2a). `fetch_queue` gains **`leased_at timestamptz`** with a reaper reverting `in_flight` rows older than 30s (single-drainer = FR-022 advisory lock). `food_sources` gains `UNIQUE(food_id, id)`; nutrients/portions/field-provenance/category-assignment use composite **`(food_id, source_id)` FKs**, `ON DELETE NO ACTION`. `source_call_log` rows beyond the trailing 60-min window are pruned on a periodic sweep.

**Canonical behaviour (D-AUTORESOLVE / D-UNRESOLVED-TTL / D-LIFECYCLE / D-DEMAND / D-FAIRNESS / D-REFRESH / D-SC005).**

- Auto-resolve: after pre-merge dedup, **1 survivor of normalized-name exact match → `RESOLVED`; >1 → `UNRESOLVED`** (persist survivors to `food_candidates`); **0 → `NOT_FOUND`**. No nutrient tolerance.
- `UNRESOLVED` is kept until a human picks; its candidate set expires 30 days after `created_at` and re-fans-out on the next request (never swept to `NOT_FOUND`). The **30-day TTL is `NOT_FOUND`-only**; `FAILED→PENDING` is bounded-backoff retry (no 30-day gate).
- Legal transitions: `PENDING→{RESOLVED,UNRESOLVED,NOT_FOUND,FAILED}`; `UNRESOLVED→RESOLVED`; `FAILED→PENDING`; `NOT_FOUND→PENDING` (post-TTL). `PATCH`-resolve is UNRESOLVED-only, idempotent, candidate-in-set validated (`CandidateMismatchError`). `createByName` reactivates a terminal-state row (no `23505`). Refresh never overwrites a manual pick.
- Demand = distinct-requester: upsert `(food_id, sub)` into `fetch_requesters` `ON CONFLICT DO NOTHING`, then set `request_count` to the **capped distinct-`sub` count (`PRIORITY_CAP = 1`)** — never raw `+1`. One demand-weighted `fetch_queue` ordered `request_count DESC, first_requested ASC`; demotion is **drain-time live compute** (no `drain_priority_tier` column, no `enqueueLowPriority`). No per-user quota, no `429`; near-ceiling NEW-enqueue flood-shed = `503`. Change-refresh runs as a **Fargate scheduled task** that yields to live demand, re-enqueuing via the ordinary path.
- SC-005 splits into **read/serve throughput** (local reads, high target) vs **first-time NEW-food resolution rate** (~500–900/hr, bounded by SC-002 ≤1,000 calls/rolling-60-min — new **SC-014**).

**Finding dispositions for this artifact.**

- **PRF-ARCH-001** (raw per-request `request_count`) — **closed by D-DEMAND**: ARCH-003 / Interaction 2 / Data Flow 2 enqueue is a `fetch_requesters` upsert on `(food_id, sub)` + a capped bump (`PRIORITY_CAP=1`), never raw `+1`; add `fetch_requesters` to the Logical/Physical views. `fdc_id` → `food_id`/`external_key`.
- **PRF-ARCH-002** (status vocabulary) — canonical `fetch_queue.status = pending | in_flight | tombstone` (+ the new **`leased_at`** column); the `food.status` lifecycle enum is the separate `PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED` set; reconcile `pendingCountForSub` to the queue status literal.
- **PRF-ARCH-003** (`scoreEnqueue` vs MOD-013) — align ARCH-012 to `admitEnqueue` / `isDemoted`; demotion is **drain-time live compute**, so there is **no `drain_priority_tier` column** (drop that name).
- **PRF-ARCH-004** (Redis-first diagrams) — the canonical read tier is the **local store (Postgres)**; cache framing is deferred-Redis-only.
- **PRF-ARCH-005 / PRF-ARCH-006** — carried (admission-control ordering; ARCH-012 cross-cutting classification).
- **Architecture to add** (per §3.4/§3.7/§3.11/§3.13): ARCH-006 / Physical view enumerate **13 tables incl. `food_candidates`** and the composite `(food_id, source_id)` provenance FKs; **MOD-018 `CandidateStore`** backs `food_candidates`; ARCH-012 is **`FoodAuthGuard`** (`x-debug-sub` removed); add **ARCH-018** change-refresh **Fargate scheduled task** + a Physical-view row (D-REFRESH; egress/compute-placement rationale per ADR-0004 — Fargate in public subnets uses the IGW, not NAT).
