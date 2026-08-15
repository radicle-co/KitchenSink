# Diagnosis — "plan" cluster (plan.md + plan/digest.md)

Feature 003 source-agnostic food data, doc-stabilization. Cluster docs read in full:

- `specs/003-usda-food-data/plan.md`
- `specs/003-usda-food-data/plan/digest.md`

Cross-checked against the canonical inputs (`.stabilization/inputs/staff-review.md`,
`.stabilization/inputs/autoresolutions.md`), `spec.md`, `v-model/architecture-design.md`, `tasks.md`,
`.forge-status.yml`, and the deployed CDK (`packages/services/food-service/infra/lib/FoodServiceStack.ts`).

Severity: C=critical, H=high, M=medium. Each finding cites doc:location, the problem, and the
autoresolution default that resolves it (or "needs decision").

---

## 1. Contradictions

### C-1 [C] — plan §4 enqueue SQL still does raw `request_count + 1` (violates distinct-requester)

- **Where**: `plan.md` §4 "Fetch Queue (Postgres)", lines 614-619:
    ```sql
    INSERT INTO fetch_queue (food_id) VALUES ($1)
    ON CONFLICT (food_id) DO UPDATE
      SET request_count = fetch_queue.request_count + 1, last_requested = now()
      WHERE fetch_queue.status = 'pending';
    ```
- **Problem**: This is the raw-count model. It directly contradicts (a) plan.md's own §2 DDL comment
  (`request_count int … -- distinct-requester demand (FR-044)`, line 239), (b) plan §2A.4 FR-044 prose
  (line 388: "counts **distinct `sub`s** via `fetch_requesters`"), and (c) the v-model
  `architecture-design.md` ARCH-003 (line 59) / Interaction 0 / Data Flow 2, which all set
  `request_count` to the **capped distinct-`sub` count (PRIORITY_CAP=1)** via an upsert into
  `fetch_requesters` and explicitly say "never a raw `+1` increment." This is the staff-review
  `[C] FR-014 vs FR-044` defect; the canonical enqueue SQL is the half-applied side. The SQL header
  also mislabels it "Idempotent enqueue (FR-014)" while the body is the FR-044 demand path.
- **Resolves via**: **D-DEMAND** — rewrite the §4 SQL to: upsert `(food_id, sub)` into
  `fetch_requesters` `ON CONFLICT (food_id, sub) DO NOTHING`, then set `fetch_queue.request_count` to
  the capped distinct-`sub` count (PRIORITY_CAP=1), paired with `pg_notify('fetch_queued', food_id)`.
  Match ARCH-003 verbatim.

### C-2 [C] — completion event named `FoodDataReceived` in plan, but canonical name is `FoodFetchCompleted`

- **Where**: `plan.md` uses `FoodDataReceived` in 6 places — §1 ASCII context (line 48), §2A.5 (line 408),
  §4 event-taxonomy note (line 548), §4 event payload definition (line 591), §5 worker step 6
  (line 673), §5 food-search-indexer (line 721).
- **Problem**: The deployed CDK (`FoodServiceStack.ts` lines 290-296) defines
  `FoodFetchCompletedRule` with `detailType: ['FoodFetchCompleted']`; `tasks.md` and `.forge-status.yml`
  use `FoodFetchCompleted`. So the worker will emit `FoodFetchCompleted` while plan.md documents
  `FoodDataReceived` — a direct contradiction with shipped infrastructure. Note: `.forge-status.yml`
  (lines 156-157) _claims_ "plan §4 now annotates `FoodFetchCompleted` as an alias of v-model
  `FoodDataReceived`" and the autoresolution parenthetical claims the canonical name "matches plan §4"
  — but **no occurrence of `FoodFetchCompleted` exists anywhere in plan.md** (grep = 0). That status note
  is false / the re-baseline was never applied to plan.md.
- **Resolves via**: **D-EVENT** — canonical = `FoodFetchCompleted`. Replace all 6 `FoodDataReceived`
  occurrences in plan.md (the autoresolution names spec.md + v-model explicitly, but plan.md is itself
  on the wrong side of the canonical name and must change too for one-name-everywhere).

### C-3 [C] — plan §9.2 sweeps abandoned UNRESOLVED → NOT_FOUND; canonical rule keeps UNRESOLVED

- **Where**: `plan.md` §9 item 2 (lines 846-849): "give `UNRESOLVED` a soft TTL (default 30 days)…
  an expired `UNRESOLVED` is **swept to `NOT_FOUND`** (re-addable) by the change-refresh cron."
- **Problem**: Contradicts the canonical UNRESOLVED-TTL behavior, which keeps the food `UNRESOLVED`
  (a human may still pick) and instead expires only the **candidate set**, re-fanning out on the next
  request. Sweeping the whole food to `NOT_FOUND` is a different state transition and would lose the
  UNRESOLVED status the lifecycle/§5 promised.
- **Resolves via**: **D-UNRESOLVED-TTL** — UNRESOLVED is kept until a human picks; its candidate set
  expires after 30 days and re-fan-out occurs on the next request (mirrors the NOT_FOUND 30-day TTL).
  Rewrite §9.2 to this; also affects the absent `food_candidates` storage (see G-1).

### C-4 [H] — plan §9.1 auto-RESOLVE rule adds a nutrient-tolerance test beyond the canonical rule

- **Where**: `plan.md` §9 item 1 (lines 838-844): auto-`RESOLVED` iff "exactly one surviving candidate
  after pre-merge dedup (single source hit, **or multiple source hits that collapse to one via
  normalized-name exact match + nutrient agreement within a tolerance, e.g. ±10% on energy/protein**)…
  **Needs your judgment** — the tolerance is a product call."
- **Problem**: The canonical auto-resolve rule is purely normalized-name exact match (after dedup);
  it does not include a nutrient-agreement tolerance. The "±10% on energy/protein" tolerance and the
  "Needs your judgment" escalation invent a matcher dimension the autoresolution does not authorize and
  leave the decision open.
- **Resolves via**: **D-AUTORESOLVE** — auto-RESOLVE when **exactly one** candidate survives
  normalized-name exact match (after dedup); **>1 → UNRESOLVED**; **0 → NOT_FOUND**. Remove the nutrient
  tolerance and the "needs your judgment" language; bias toward UNRESOLVED over a wrong auto-pick.

### C-5 [H] — plan/digest.md contradicts the settled fairness model (per-`sub` quota → `429`)

- **Where**: `plan/digest.md` line 11 ("**Auth ≠ rate limiting:** per-`sub` enqueue quota → `429`
  (FR-043)…"), line 33 ("per-`sub` quota + `429`"), line 36 ("auth tests (401/403/**429**…)").
- **Problem**: Directly contradicts the settled model in plan.md §2A.4 (line 385: "no enqueue is ever
  rejected with `429`"), §3 (line 440: "There is **no** per-`sub` `429`"), the Session-2026-06-20
  spec clarification, and ARCH-012 (fairness by demotion, no `429`). The digest is a pre-clarification
  (dated 2026-06-19) snapshot whose FR-043 semantics were superseded.
- **Resolves via**: **D-FAIRNESS** / **D-DEMAND** — fairness is by demotion (per-`sub` >50-pending →
  ranked to back, dynamic at drain time); no `429`. The digest must be reconciled to this or marked
  superseded (see Q-1).

### C-6 [H] — plan/digest.md references removed quota tables (`user_fetch_quota`)

- **Where**: `plan/digest.md` line 13 ("New data: `user_fetch_quota` (or Redis)…"), line 28
  ("Quota store — Redis vs Postgres `user_fetch_quota`"), line 34 ("Add migration tasks for
  `user_fetch_quota` and `fetch_requesters`").
- **Problem**: `user_fetch_quota` (and `global_fetch_quota`) are **explicitly removed** in plan.md §2
  "Final table list" (lines 292-294: "**Removed** … `user_fetch_quota`, `global_fetch_quota`…").
  The digest still treats them as new data and demands migration tasks for them — orphan-table
  references that contradict the canonical data model.
- **Resolves via**: **D-DEMAND** (no quota tables — operational data is `fetch_requesters` +
  `source_call_log`) + **D-STATUS**/digest reconciliation. Strike the quota-table references.

### C-7 [M] — plan/digest.md "Open risks" still lists the spec↔plan API-Gateway+SQS+Redis divergence as live

- **Where**: `plan/digest.md` line 29 ("The spec↔plan async architecture divergence (spec: API
  Gateway+SQS+Redis; plan: Fargate+Postgres-queue)… remains").
- **Problem**: spec.md has since been re-baselined to the Postgres `fetch_queue` + Fargate worker model
  (spec.md Input note line 6; US-2/US-3/US-5 throughout). The divergence is closed; the digest reports
  it as an open risk — stale.
- **Resolves via**: digest reconciliation under **D-STATUS** (record the divergence as resolved, or
  mark the digest superseded).

---

## 2. Gaps / missing requirements

### G-1 [C] — `food_candidates` table is absent from plan §2 (no storage for UNRESOLVED candidates)

- **Where**: `plan.md` §2 "Final table list" (lines 290-294) lists 12 tables and does **not** include
  `food_candidates`. Yet §1 Disambiguation path (lines 69-71), §3 `/candidates` + `PATCH` (lines
  448-449, 488-501), and §5 step 6 (line 672) all depend on a persisted candidate set, and the
  candidate ids shown in §3 (`"candidateId": "c1"`, line 493) are ephemeral placeholders with no
  backing table or ULID scheme. The v-model `architecture-design.md` ARCH-016 likewise references
  `getCandidates(id)` but enumerates the same 12-table schema (no candidate table), and the arch doc
  asserts a "12-table canonical schema" (lines 528, 540).
- **Problem**: `UNRESOLVED`/US-2a and `GET /candidates` → `PATCH`-resolve cannot be implemented without
  candidate persistence. This is the staff-review `[C] No food_candidates storage`.
- **Resolves via**: **D-CANDIDATES** — add `food_candidates (id, food_id, source, external_key, name,
summary, created_at; UNIQUE(food_id, source, external_key))` to plan §2 DDL + the §2 "Final table
  list" + the §7 migration DDL block. (Consequence: the "12-table" count in plan §2 prose and in
  arch-design lines 528/540 + ARCH-006 becomes 13 — flag for the arch cluster.)

### G-2 [C] — provenance `source_id` FKs do not enforce same-food (cross-food leak possible)

- **Where**: `plan.md` §2 DDL — `food_nutrients.source_id text NOT NULL REFERENCES food_sources(id)`
  (line 190), `food_portions.source_id … REFERENCES food_sources(id)` (line 202),
  `food_field_provenance.source_id … REFERENCES food_sources(id)` (line 210),
  `food_category_assignment.source_id … REFERENCES food_sources(id)` (line 223). Grep confirms the only
  composite UNIQUE in §2 is `UNIQUE (food_id, nutrient_id)` (line 191); there is no
  `UNIQUE(food_id, id)` on `food_sources` and no composite `(food_id, source_id)` FK anywhere.
- **Problem**: Existence-only FKs let a value row reference a `food_sources` row belonging to a
  **different** food, so "same-food provenance" is not a structural invariant. Staff-review
  `[C] Provenance source_id can cross foods`.
- **Resolves via**: **D-PROVENANCE-FK** — document `UNIQUE(food_id, id)` on `food_sources` and composite
  `(food_id, source_id)` FKs on `food_nutrients`, `food_portions`, `food_field_provenance` (and
  `food_category_assignment`). Update §2 DDL and §7 migration.

### G-3 [H] — `fetch_queue` has no `leased_at` column; the documented watchdog cannot compute "older than 30s"

- **Where**: `plan.md` §2 `fetch_queue` DDL (lines 237-247) has `status` (pending|in_flight|tombstone)
  but **no `leased_at`** column. §4 "Lease timeout" (line 635) and §5 "Lease recovery" (line 688)
  describe reverting `in_flight` rows "older than 30s" — but there is no timestamp column to age against,
  and the priority index is `WHERE status='pending'` (line 250), so an orphaned `in_flight` row is never
  re-selected.
- **Problem**: A worker crash mid-lease orphans the row forever; the reaper described in §4/§5 is
  unimplementable as written. Staff-review `[H] Worker lease has no expiry/reclaim`.
- **Resolves via**: **D-LEASE** — add a `leased_at timestamptz` column to `fetch_queue`; document the
  reaper that reclaims `in_flight` rows whose `leased_at` is older than the 30s lease window; state the
  single-drainer advisory-lock invariant (the latter is already in §4 line 624 — keep and cross-link).

### G-4 [H] — change-driven refresh compute substrate unspecified (Lambda vs Fargate)

- **Where**: `plan.md` §1 (line 48 "EventBridge … cron"), §5 "change-refresh consumer (EventBridge
  scheduled)" (lines 710-716); arch-design ARCH-018 ("EventBridge-scheduled handler"). The §5 consumer
  itself performs adapter re-fetches (network) and DB compares — it needs both egress and private-RDS
  access — but no compute substrate is named.
- **Problem**: As written it reads as a VPC Lambda, which per the worktree ADRs would need the NAT path;
  the canonical decision is a Fargate scheduled task (uses the IGW egress path, not NAT).
- **Resolves via**: **D-REFRESH** — state the refresh runs as a **Fargate scheduled task (ADR-0004)**,
  not a VPC Lambda; low-priority background work that yields to live demand (idle-drain); cadence is
  budget-bounded, not a fixed promise. Update §1, §5, and the §9.4 framing.

### G-5 [H] — no FR / acceptance criteria for the auto-RESOLVE boundary

- **Where**: `plan.md` — auto-resolve appears only as a §9.1 "Recommendation" (lines 838-844); §5 step 6
  (lines 671-673) describes RESOLVED/UNRESOLVED outcomes prose-only, with no normative rule or FR id.
- **Problem**: The ≥90%-auto-resolve metric depends on a concrete, testable boundary that does not exist
  as a requirement. Staff-review `[H] Auto-RESOLVE vs UNRESOLVED boundary undefined`.
- **Resolves via**: **D-AUTORESOLVE** — state the rule normatively in §5 (and reference the new FR added
  to spec): exactly-one-survivor → RESOLVED; >1 → UNRESOLVED; 0 → NOT_FOUND; add matching acceptance
  tests in the v-model.

### G-6 [M] — SC-005 throughput split not reflected where plan cites SC-005

- **Where**: `plan.md` §5 (line 705) cites `SC-005` for the USDA batch optimization; §1 (line 26) and
  §4 (line 632) describe the ≤1,000/hr USDA budget. The SC-002 vs SC-005 contradiction itself lives in
  spec.md, but plan is the doc that frames the budget mechanics.
- **Problem**: Plan does not distinguish local read/serve throughput (no source call, high target) from
  first-time NEW-food resolution rate (bounded by the USDA budget, ~500-900/hr). Staff-review
  `[C] SC-002 vs SC-005`.
- **Resolves via**: **D-SC005** — where plan references throughput, keep the two metrics separate;
  the substantive restatement is in spec.md (note for the spec cluster), but plan's USDA-budget framing
  should not imply a ≥5,000/hr fetch ceiling.

---

## 3. Naming drift

### N-1 [C] — `FoodDataReceived` vs `FoodFetchCompleted` (see C-2 for full detail)

- Same finding as C-2; flagged here as the canonical naming-drift item. Canonical = `FoodFetchCompleted`
  per **D-EVENT**. Plan.md (6 sites) + plan/digest.md (implicit via FR-041/049 references on line 13)
  diverge from the CDK/tasks/forge-status name.

### N-2 [M] — "demand path" event names `FoodRequested`/`FoodBatchRequested` are consistent — verify, not drift

- **Where**: `plan.md` §4 (lines 553-577), arch-design ARCH-002/ARCH-003. These match
  (`publishFoodRequested`/`publishFoodBatchRequested`, in-process enqueue, not EventBridge). No drift;
  recorded so the stabilizer does not "fix" them. No autoresolution change required.

---

## 4. Orphan / dangling ids and broken cross-references

### O-1 [H] — digest.md cites `user_fetch_quota` (removed table) — orphan reference (see C-6)

- Resolved by **D-DEMAND** (no quota tables). Listed here as a dangling schema reference.

### O-2 [M] — spec.md cites FR-018 for UNRESOLVED candidate surfacing; FR-018 is the lease/watchdog requirement

- **Where**: `spec.md` US-2 scenario 6 (line 126: "surfaces the candidate list… (US-2a / **FR-018**)").
  Elsewhere FR-018 = the in-flight lease re-eligibility / watchdog recovery (plan §5 line 688
  "(FR-018)"; spec US-3 scenario 2 line 158). Candidate surfacing should trace to FR-RES-1.
- **Problem**: Dangling/incorrect cross-reference — the same FR-018 id is used for two unrelated
  requirements; the candidate-surfacing citation is wrong.
- **Resolves via**: needs alignment in the spec cluster (re-point spec US-2 scenario 6 to FR-RES-1).
  No autoresolution default covers this id slip directly — **flag for spec cluster** (mechanical fix,
  not a design change).

### O-3 [M] — digest "Artifacts produced" claims §3 response shapes added `429`; current plan has no `429` shape

- **Where**: `plan/digest.md` line 23 ("§3 endpoints table + auth response shapes (401/403/**429**/400/503)").
- **Problem**: plan.md §3 response shapes (lines 521-531) contain 401/403/400/503 but **no** `429`
  (correct per the settled model). The digest's artifact record is stale/inaccurate.
- **Resolves via**: digest reconciliation under **D-STATUS**.

---

## 5. Residual fdcId / cache-hit framing

### R-1 [M] — `fdcId` usage in plan.md is compliant (confined to adapter boundary) — no change needed

- **Where**: all `fdcId` mentions in plan.md (lines 13, 14, 16, 55, 94, 120, 165, 312, 409, 455, 549,
  698, 702-703, 882) are either (a) the adapter-boundary mapping `fdcId → external_key`, (b) historical
  re-baseline notes describing what was removed, or (c) the removed-design callout. None leak `fdcId`
  into the canonical schema, DTOs, API paths, or DAOs.
- **Status**: **Compliant with D-CLEANUP** ("`fdcId` may appear ONLY as USDA's `external_key`, inside the
  adapter boundary"). Recorded so the stabilizer does not over-purge legitimate adapter-boundary text.

### R-2 [M] — residual "cache miss / cached / cache-hit" framing for the demand-driven model

- **Where**: `plan.md` §2A.4 (line 376: "the food service only calls a source on a **cache miss**"),
  §2A.4 (line 391: "A mixed **cached+miss** batch"), §3 endpoints (line 451: "per-item partial
  (**cached** inline + `PENDING` per miss)"), §4 (line 559: "**Cache miss** — single food"; line 569
  comment "**Cache miss**"), §8 metric `food-cache-hit-rate` (line 822).
- **Problem**: The model is demand-driven add-by-name against a local canonical store of record, not a
  cache. "cache miss/hit" is residual pre-re-baseline framing. Staff-review notes "residual fdcId /
  cache-hit framing left over from the pre-re-baseline design."
- **Resolves via**: **D-CLEANUP** — reframe to local-store terms (e.g., "not in the local store" /
  "miss in the local store" / "local-store hit"; rename the metric to a store-hit/resolution metric).
  The optional in-process LRU (§6) is real and may keep a precise LRU-hit name.

---

## 6. Quality / completeness (TODOs, placeholders, half-applied re-baseline)

### Q-1 [H] — plan/digest.md is a stale, pre-re-baseline snapshot (half-applied re-baseline)

- **Where**: entire `plan/digest.md` (dated 2026-06-19, "Phase 5 (Plan) Digest").
- **Problem**: The digest predates both the Session-2026-06-20 fairness clarification and the
  Session/2026-06-21–22 source-agnostic re-baseline. It still describes per-`sub` quota + `429` (C-5),
  `user_fetch_quota` (C-6), the spec↔plan SQS/Redis divergence as live (C-7), a stale `429` artifact
  claim (O-3), and contains **zero** mention of the source-agnostic model, golden record, fan-out/merge,
  `food_candidates`, distinct-requester demand, or `FoodFetchCompleted`. As the cluster's summary
  artifact it now misrepresents the plan.
- **Resolves via**: **D-STATUS** + apply all canonical decisions — regenerate/reconcile the digest to
  the stabilized plan (or explicitly mark it superseded with a pointer to the current plan.md). Open for
  user only if a digest rewrite is considered out of stabilization scope (see "Open for user").

### Q-2 [H] — §9 "Planning Decisions & Open Questions" left as open recommendations

- **Where**: `plan.md` §9 (lines 834-866) frames five items as "Recommendation / Needs your judgment /
  Confirm the default" — §9.1 (auto-resolve, "Needs your judgment"), §9.2 (UNRESOLVED TTL, "Confirm the
  default"), §9.3 (sync vs async, resolved), §9.4 (change detection, resolved), §9.5 (source priority,
  resolved).
- **Problem**: Stabilization requires settled, implementation-ready design with no open/placeholder
  decisions. §9.1 and §9.2 are not just open — their recommendations contradict the canonical defaults
  (C-4, C-3).
- **Resolves via**: convert §9 to settled decisions — **D-AUTORESOLVE** (§9.1), **D-UNRESOLVED-TTL**
  (§9.2), **D-REFRESH** (§9.4). §9.3 and §9.5 are already consistent with intent and can stay as recorded
  decisions (drop the "deferred/recommendation" hedging language).

### Q-3 [M] — `.forge-status.yml` records a re-baseline claim that was never applied to plan.md

- **Where**: `.forge-status.yml` lines 156-157 assert "plan §4 now annotates `FoodFetchCompleted` as an
  alias of v-model `FoodDataReceived`; the CDK rule matches detailType `FoodFetchCompleted`." Grep of
  plan.md returns **0** `FoodFetchCompleted`.
- **Problem**: Status overstates completion (half-applied re-baseline / inaccurate status).
- **Resolves via**: **D-EVENT** (apply the rename to plan.md, making the status true) + **D-STATUS**
  (correct the forge status; `implement` → not-started for this phase).

### Q-4 [M] — arch-design "12-table canonical schema" count will drift once `food_candidates` is added

- **Where**: `v-model/architecture-design.md` lines 528 and 540 ("12-table canonical schema"),
  ARCH-006 enumeration; plan.md §2 "Final table list" (12 tables).
- **Problem**: Adding `food_candidates` (G-1) makes the canonical schema 13 tables; the "12" prose will
  be stale across plan + arch.
- **Resolves via**: **D-CANDIDATES** — update the table count wherever stated (flag for the arch cluster
  as the downstream consequence of the plan-side table addition).

---

## Open for user (genuinely high-stakes AND ambiguous; everything else is auto-resolved above)

- **None required for the plan cluster.** All findings map to a canonical autoresolution default. The
  one judgment call — whether reconciling vs. marking-superseded the stale `plan/digest.md` (Q-1) — is a
  low-stakes editorial choice; default to reconciling the digest to the stabilized plan under D-STATUS.

## Cross-cluster hand-offs (not plan-owned, surfaced during cross-check)

- **O-2** (spec FR-018 mis-citation for candidate surfacing) → spec cluster.
- **G-6 / D-SC005** restatement of SC-002 vs SC-005 → spec cluster (plan only needs to avoid implying a
  ≥5,000/hr fetch ceiling).
- **G-1 consequence / Q-4** ("12-table" → 13, ARCH-006 + ARCH-016 candidate-table) → arch cluster.
- **D-EVENT** rename also required in spec.md + v-model (plan-side covered by C-2/N-1).
