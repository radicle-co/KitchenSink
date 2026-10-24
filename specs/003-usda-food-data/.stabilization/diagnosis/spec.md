# Stabilization Diagnosis — "spec" cluster (Feature 003)

**Cluster docs reviewed:** `spec.md`, `checklists/requirements.md`
**Cross-checked against:** `.stabilization/inputs/staff-review.md`, `.stabilization/inputs/autoresolutions.md`, `plan.md` (§2 canonical data model + §4), `v-model/*`, `product-spec/*`, and the implemented CDK (`packages/services/food-service/infra/lib/FoodServiceStack.ts`).
**Scope:** STABILIZE-AND-COMPLETE the design docs. plan.md §2 (+`food_candidates`) is canonical; all findings resolve to an autoresolution default unless marked **needs decision**.

Legend for severity: **C** critical, **H** high, **M** medium, **L** low.

---

## A. Contradictions (cross-layer)

### A1. [C] Completion event name: `FoodDataReceived` (spec) vs `FoodFetchCompleted` (canonical/CDK)

- **Location — spec.md:** US-0 scenario 8 (line 86), US-9 scenario 1 (line 265), FR-011 (line 355), FR-024 (line 390), FR-034 (line 417), FoodDataEvent entity (line 479).
- **Location — checklists/requirements.md:** item 10 evidence (line 127, line 129), item 16 evidence (line 203).
- **Problem:** spec.md and the checklist exclusively use `FoodDataReceived`. The **implemented CDK already uses `FoodFetchCompleted`** (`FoodServiceStack.ts:291` `FoodFetchCompletedRule`, `:296` `detailType: ['FoodFetchCompleted']`), and plan §4 / tasks `FU-EVENTNAME` (tasks.md:615) flag the name as needing harmonization. plan.md, v-model (`module-design.md` 15×, `system-test.md` 13×, `integration-test.md` 15×, etc.), and product-spec also still say `FoodDataReceived`. The CDK is the load-bearing anchor, so the rest is drift.
- **Resolved by:** **D-EVENT** — canonical name = `FoodFetchCompleted`. Replace every `FoodDataReceived` in spec.md (6 occurrences) and in the checklist's evidence text; reconcile the FoodDataEvent entity's type list.

### A2. [C] Demand counting: raw `+1` (FR-014 / US-5) vs distinct-requester (FR-044 / plan)

- **Location — spec.md:** FR-014 SQL `... DO UPDATE SET request_count = fetch_queue.request_count + 1 ...` (line 361); US-5 narrative "increment a counter" (line 185); US-5 Independent Test `request_count=50` (line 189); US-5 scenarios 1 & 3 (lines 193, 195: "the existing row's `request_count` increments by 1"); FetchQueueRow entity `request_count` (line 477). This directly contradicts FR-044 (line 433: "MUST count **distinct authenticated `sub`s** … MUST NOT increment priority more than once … priority contribution MUST be capped").
- **Cross-layer:** plan.md uses the distinct-requester model via `fetch_requesters(food_id, sub, requested_at)` (plan.md:253, 387: "a `sub` cannot inflate priority by repeating"). So spec FR-014/US-5 are the divergent ones.
- **Problem:** the canonical enqueue cannot both "`+1` raw count" and "capped distinct-`sub` count (PRIORITY_CAP=1)". US-5's test asserts the raw model.
- **Resolved by:** **D-DEMAND** — enqueue demand = distinct-requester: upsert `(food_id, sub)` into `fetch_requesters`, set `fetch_queue.request_count` to the capped distinct-`sub` count (PRIORITY*CAP=1), never raw `+1`. Rewrite FR-014, US-5 narrative (line 185), US-5 Independent Test (line 189), and US-5 scenarios 1/3 (lines 193, 195). Note US-5 scenario 1's "`request_count=50`" example must become 50 \_distinct* `sub`s, not 50 repeats by one `sub`.

### A3. [C] SC-005 throughput vs SC-002 / USDA budget

- **Location — spec.md:** SC-005 "at least 5,000 foods per hour" (line 491) vs SC-002 "≤1,000 USDA API calls in ANY rolling 60-minute window" (line 488) and A-001 (line 503).
- **Location — checklists/requirements.md:** item 5 evidence accepts "SC-005: 5,000 foods/hour, batch fill 5+ IDs/call" without flagging the contradiction (line 69).
- **Problem:** a NEW-food name-search is ~1 non-batchable USDA call per food; with a 1,000/hr cap (pause at 900) the real first-time-resolution ceiling is ~500–900/hr, so 5,000 foods/hr of _new_ resolution is impossible. The two criteria can't both hold.
- **Resolved by:** **D-SC005** — restate SC-005 to separate **read/serve throughput** (local golden-record reads, no source call — keep a high target) from **first-time resolution rate of NEW foods** (bounded by USDA budget, ~500–900/hr). Keep SC-002 as-is. Update the checklist item-5 evidence accordingly.

### A4. [H] Auth component name: `AuthMiddleware` (spec) vs `FoodAuthGuard` (every other layer + autoresolution)

- **Location — spec.md:** `AuthMiddleware` in clarification (line 31), FR-050 (line 439), AuthenticatedCaller entity (line 481), A-011 (line 512). spec.md contains **zero** occurrences of `FoodAuthGuard`.
- **Cross-layer:** `FoodAuthGuard` is the name used in plan.md, plan/digest.md, v-model (`architecture-design.md`, `module-design.md`, `system-design.md`, `system-test.md`, `integration-test.md`, `unit-test.md`, `trace.md`, `traceability-matrix.md`), product-spec/product-spec.md, tasks.md, and the checklist (1×, line 7). The autoresolution explicitly says "keep the specified `FoodAuthGuard`."
- **Problem:** the spec borrows the identity service's `AuthMiddleware` name while the entire downstream design names the food-service auth component `FoodAuthGuard`. This is a cross-layer naming contradiction: traceability rows binding FR-035–FR-053 to a "named component" (FR-053, line 442) point at a component name absent from the spec.
- **Resolved by:** **D-AUTH** ("keep the specified `FoodAuthGuard`"). Reconcile spec.md to the canonical `FoodAuthGuard` name (a NestJS guard) used by plan/v-model/product-spec/tasks; if the design intends both an `AuthMiddleware` and a `FoodAuthGuard`, state the relationship explicitly so FR-050/FR-053/A-011/AuthenticatedCaller all reference the same named component. (No design change — naming reconciliation only.)

---

## B. Gaps / missing requirements

### B1. [C] No `food_candidates` storage in spec

- **Location — spec.md:** FR-028 schema table list (lines 397–405) enumerates `food`, `food_sources`, `nutrient`, `food_nutrients`, `food_portions`, `food_field_provenance`, `food_category` — **no `food_candidates` table**. The "Candidate" entity (line 471) and FR-RES-1/FR-RES-2 (lines 343–344) describe a candidate set that must be persisted and validated against (`GET /candidates` → `PATCH`-resolve), but there is no backing table for `UNRESOLVED`/US-2a. spec.md has **0** occurrences of `food_candidates`.
- **Cross-layer:** plan.md §2 also currently has **0** occurrences of `food_candidates` (only `fetch_requesters`, `source_call_log`, `source_sync_metadata` are listed) — so this gap is shared with the canonical model and must be added there too per the autoresolution.
- **Resolved by:** **D-CANDIDATES** — add `food_candidates` table (`id, food_id, source, external_key, name, summary, created_at; UNIQUE(food_id, source, external_key)`) to spec FR-028's table list (and to the FR-029 index/access-path list as needed). Wire FR-RES-1/FR-RES-2 and the Candidate entity to that table.

### B2. [H] Auto-RESOLVE vs UNRESOLVED boundary undefined

- **Location — spec.md:** US-2 narrative & scenario 2 say `RESOLVED` = "confident single merge" (lines 113, 122); FR-MRG-1 (line 369) and FR-RES-3 (line 345, "as far as is confident … need not be perfect") never define the concrete decision rule. Yet the product metric depends on it (e.g. the ≥90%-auto-resolve target referenced in staff review).
- **Problem:** "confident" is unquantified; there is no FR or acceptance test pinning when the worker auto-resolves vs. leaves `UNRESOLVED` vs. tombstones `NOT_FOUND`.
- **Resolved by:** **D-AUTORESOLVE** — add an explicit FR (and acceptance scenarios): auto-`RESOLVED` when **exactly one** candidate survives normalized-name exact match after dedup; **>1 → UNRESOLVED**; **0 → NOT_FOUND**; bias toward `UNRESOLVED` over a wrong auto-pick. Add the matching acceptance tests under US-2/US-2a.

### B3. [H] Worker lease has no `leased_at` column / reaper in the data model

- **Location — spec.md:** FR-018 (line 365) and edge case (line 296) assert "stale `in_flight` rows older than 30s MUST be reverted to `pending`", but the FetchQueueRow entity (line 477) lists only `food_id, request_count, status, attempts, last_error, first_requested, last_requested, priority` — **no `leased_at`**. There is no column that records when the lease was taken, and no named reaper. Without it the "older than 30s" rule is not index-serviceable and a crashed worker orphans the row (priority index is `WHERE status='pending'`, so an `in_flight` orphan is invisible).
- **Cross-layer:** plan.md §2 also lacks `leased_at`/reaper (plan grep returned nothing for `leased_at`/`reaper`), so the canonical model needs it too.
- **Resolved by:** **D-LEASE** — document a `leased_at` column on `fetch_queue` + a reaper that reclaims `in_flight` rows whose lease is older than the lease window (30s); add `leased_at` to the FetchQueueRow entity and reference the reaper in FR-018. Single drainer is already covered (FR-022 advisory lock, line 385) — keep it.

### B4. [H] UNRESOLVED-TTL left as an open "deferred to planning" placeholder

- **Location — spec.md:** Edge case "How does the system handle an `UNRESOLVED` food that nobody ever picks? (**Deferred to planning** — either a TTL/expiry or it stays until a human acts; see Outstanding Questions…)" (line 302).
- **Problem:** a half-decided open question persists in a doc that is supposed to be implementation-ready.
- **Resolved by:** **D-UNRESOLVED-TTL** — an `UNRESOLVED` food is kept until a human picks; its candidate set expires after **30 days** and re-fan-out occurs on the next request (mirrors the NOT_FOUND 30-day TTL). Replace the "deferred to planning" prose with this rule and add a supporting FR/acceptance note.

### B5. [H] Provenance composite-FK "same-food" invariant not specified

- **Location — spec.md:** FR-028 `food_sources` carries only `UNIQUE(source, external_key)` (line 399); `food_nutrients`/`food_portions`/`food_field_provenance` reference `source_id` (lines 401–403) but the schema only guarantees existence, not same-`food_id`. SC-013 (line 499) asserts a "resolvable `source_id` … into `food_sources`" but not the same-food constraint.
- **Problem:** a `source_id` can point at a `food_sources` row belonging to a _different_ food — provenance can cross foods.
- **Resolved by:** **D-PROVENANCE-FK** — document `UNIQUE(food_id, id)` on `food_sources` and composite `(food_id, source_id)` FKs on `food_nutrients`/`food_portions`/`food_field_provenance` in FR-028; tighten SC-013 to assert the structural same-food invariant.

### B6. [M] Explicit lifecycle transition set not documented

- **Location — spec.md:** transitions are scattered — outcomes in FR-MRG-1 (line 369), NOT_FOUND TTL re-attempt in FR-025 (line 391), FAILED re-fetchable in FR-027 (line 393), UNRESOLVED→RESOLVED in FR-RES-2 (line 344) — but there is no single legal-transition table, and `FAILED→PENDING` retry / `NOT_FOUND→PENDING` after TTL are implied, not stated as transitions. The "refresh must not clobber a manual pick" rule is in FR-031 (line 411) but not tied to the transition set.
- **Resolved by:** **D-LIFECYCLE** — document the explicit legal transition set (`PENDING→{RESOLVED,UNRESOLVED,NOT_FOUND,FAILED}`; `UNRESOLVED→RESOLVED`; `FAILED→PENDING` retry; `NOT_FOUND→PENDING` after TTL) and that refresh never overwrites a user's manual pick; that PATCH-resolve is UNRESOLVED-only, idempotent, candidate-in-set validated (FR-RES-2 already covers the last; consolidate).

### B7. [M] `createByName` reactivation of a terminal row not specified

- **Location — spec.md:** FR-005 (line 337) keys "the same food" on a normalized name guarded by a short lock, but says nothing about what happens when that normalized-name row already exists in a terminal state (`NOT_FOUND`/`FAILED`). FR-025 (line 391) allows a re-attempt after the NOT_FOUND TTL but does not state how the unique-name constraint is honored.
- **Problem:** with a unique `normalized_name`, a re-add after TTL would hit a `23505` unique violation instead of reactivating the existing row.
- **Resolved by:** staff-review item ("`createByName` must REACTIVATE a terminal (NOT_FOUND/FAILED) row, not 23505"); fits within **D-UNRESOLVED-TTL** / **D-LIFECYCLE** intent. Add to FR-005/FR-025 that an add for an existing terminal-state normalized-name row reactivates it (→ `PENDING`) rather than failing on the unique key.

### B8. [M] `x-debug-sub` removal not stated

- **Location — spec.md:** FR-038 (line 424) and the clarification (line 31) name `x-authorizer-context`/`x-user-id` as forbidden client-supplied identity headers, but the specific forgeable **`x-debug-sub`** path called out by the staff review is never mentioned (spec has 0 occurrences).
- **Resolved by:** **D-AUTH** — state that the forgeable `x-debug-sub` path is removed (no design change). Add it to FR-038's ignored-header list.

### B9. [M] `source_call_log` retention/pruning not a requirement

- **Location — spec.md:** the RateLimitWindow entity (line 475) mentions a `source_call_log` "pruned/filtered to the trailing 60 min", but FR-019/FR-020 (lines 382–383) state no explicit pruning/retention requirement.
- **Resolved by:** within the settled rate-limiting design (autoresolution principle 2 — "only complete underspecified semantics"). Add a one-line retention/pruning requirement to FR-020 so the call log doesn't grow unbounded. **(No redesign.)**

### B10. [M] `ON DELETE` semantics for `source_id` unspecified

- **Location — spec.md:** FR-028 (lines 397–405) does not state the `ON DELETE` behavior for the `source_id` provenance references.
- **Problem:** staff review notes removing a `food_sources` row must not cascade-delete the golden values.
- **Resolved by:** **D-PROVENANCE-FK** scope (document the FK behavior). State that `source_id` FKs do **not** cascade-delete value rows on source-row removal. (Largely a plan §2 concern; surface the intent in spec FR-028.)

---

## C. Naming drift (additional to A1/A4)

### C1. [H] NFR-009 error name drift: `SourceApiError` (spec) vs `UsdaApiError` (checklist)

- **Location — spec.md:** NFR-009 names `SourceApiError`, `RateLimitWindowFullError`, `FoodNotFoundError`, `CandidateMismatchError` (line 454) — correctly source-agnostic post re-baseline.
- **Location — checklists/requirements.md:** item 16 evidence still lists "`UsdaApiError`, `RateLimitWindowFullError`, `FoodNotFoundError`" (line 203) — the USDA-coupled name the re-baseline removed.
- **Resolved by:** **D-CLEANUP** + **D-EVENT/consistency** — the checklist is stale; `UsdaApiError` must become `SourceApiError`. (`UsdaApiError` may exist only inside the USDA adapter boundary per D-CLEANUP.)

### C2. [M] Event-type list drift: `FoodBatchRequested`

- **Location — checklists/requirements.md:** item 10 evidence lists event names including `FoodBatchRequested` (line 127), but the spec's FoodDataEvent entity (line 479) defines only `IngestionScheduled`, `FoodDataReceived` (→`FoodFetchCompleted`), `FetchFailed`, and `FoodRequested`. `FoodBatchRequested` is an orphan name not defined in the spec.
- **Resolved by:** consistency requirement in the autoresolution quality bar ("no orphan ids … consistent terminology"). Drop `FoodBatchRequested` from the checklist or define it in the spec; recommend dropping (the demand path is one in-process `FoodRequested`-equivalent enqueue).

---

## D. Orphan / dangling ids & broken cross-references

### D1. [H] Checklist ignores the lettered FR families (FR-IDN-/FR-RES-/FR-MRG-/FR-ADP-)

- **Location — checklists/requirements.md:** item 2 (lines 31–33) asserts "FR numbering is sequential (FR-001 through FR-053) with no gaps" and item 10 (line 124) repeats it. The spec, however, also defines **FR-IDN-1/2/3, FR-RES-1/2/3, FR-MRG-1/2/3/4, FR-ADP-1/2/3** (spec.md lines 327–378) which are _not_ in the FR-001..053 sequence and are **never traced** by the checklist.
- **Problem:** the checklist's traceability/completeness claims (items 2, 10, 15) are incomplete — 13 functional requirements are unaccounted for. This is a half-applied re-baseline: the checklist was written against the numeric-only FR set.
- **Resolved by:** quality bar ("every FR/SYS/ARCH/MOD/REQ id traces end-to-end … no orphan ids"). Regenerate the checklist to cover the lettered FR families, or renumber/cross-map them; either way the "sequential, no gaps" claim must be corrected.

### D2. [M] Checklist references a non-present external architecture doc as the blocker

- **Location — checklists/requirements.md:** item 13 (lines 162–168) and the Summary (line 245) FAIL the spec because the architecture parameters "must be cross-checked against the external architecture doc (`docs/architecture/usda/05-event-driven-queue-based.md`), which is not part of this spec folder."
- **Problem:** the V-Model architecture now lives at `v-model/architecture-design.md` (present in-folder). The checklist's blocking rationale points at a stale/dangling external reference and never consults the in-folder architecture layer.
- **Resolved by:** regenerate item 13 against `v-model/architecture-design.md` (and confirm the rolling-window 900/1,000 parameters there); the FAIL is based on a dangling cross-reference, not a real spec defect.

### D3. [M] Checklist entity count/list is stale vs the re-baselined spec

- **Location — checklists/requirements.md:** item 4 (line 57) states "6 entities defined: Food, FetchRequest, RateLimitWindow, FetchQueueRow, FoodDataEvent, AuthenticatedCaller." The re-baselined spec defines **12**: adds FoodSource, Nutrient, FoodNutrient, FoodPortion, FoodFieldProvenance, and Candidate (spec.md lines 461–471). The checklist also still calls `RateLimitWindow` "formerly TokenBucketState" but never mentions the source-agnostic data-model entities, and there is no `food_candidates`/Candidate coverage.
- **Resolved by:** regenerate item 4 against the current entity set; tie Candidate to the `food_candidates` table (**D-CANDIDATES**).

---

## E. Residual `fdcId` / cache-hit framing

### E1. [H] Residual cache-hit/cache-miss framing in spec.md

- **Location — spec.md:** US-2 title "Add Food By Name (**Cache Miss** / Async Resolution)" (line 111); clarification "only calls an external source on a **cache miss**" (line 37); US-0 scenario 9 "another **cache-miss** add" (line 87); US-10 metrics "**cache hit rate**" (lines 273, 277); SC-004 "**Cache hit rate**" (line 490); SC-011 "**cache-hit** reads" (line 497); SC-012 "floods **cache-miss** adds" (line 498); FR-043 "authenticated **cache-miss** requests" (line 432); FR-001/US-1 "Redis read-through cache … deferred" (line 106, fine) and US-1 title "(**Resolved Hit**)" (line 94).
- **Problem:** the re-baseline (line 38, line 53) makes the local store the source of truth, replacing the USDA-cache "hit/miss" mental model. "Cache miss" should read as "first-time add / not-yet-resolved"; "cache hit rate" should read as "local-store serve rate / reads served without a source call." (References to an actual deferred _Redis_ cache are legitimate and may stay.)
- **Resolved by:** **D-CLEANUP** — purge cache-hit/miss framing; reframe SC-004 as the local-serve metric (and align with the **D-SC005** read/serve-throughput restatement). Note SC-004 + SC-005 + US-10 together should express "served-from-local-store" not "cache hit."

### E2. [M] Residual cache-hit framing carried into the checklist

- **Location — checklists/requirements.md:** item 5 "80% cache hit rate" (line 69), item 16 "cache hit rate" (line 203), item 13/Summary token-bucket-vs-cache discussion.
- **Resolved by:** **D-CLEANUP** — same reframing on regeneration.

### E3. [M] `fdcId` framing in the checklist's edge-case/consistency evidence

- **Location — checklists/requirements.md:** item 7 "non-numeric / out-of-range `fdcId` → `400`" (line 93) — but the spec's edge case is **ULID** validation (`GET /v1/foods/{id}` with a non-ULID → 400, spec.md line 290), not `fdcId`. item 11 promotes "`fdcId, fetch_status`" as terms "used consistently" (line 139) and item 11 evidence repeats `fdcId`/`fetch_status` as canonical (line 141).
- **Problem:** post re-baseline, `fdcId` may appear **only** inside the USDA adapter boundary; the public surface keys on ULID `id`. The checklist still treats `fdcId` as a first-class spec term.
- **Resolved by:** **D-CLEANUP** — `fdcId` confined to the adapter ("USDA's `external_key`, inside the adapter boundary"); checklist evidence must use ULID `id` and source-agnostic names. (spec.md body is already correct: FR-023/FR-024 confine `fdcId` to the USDA adapter, lines 389–390.)

---

## F. Quality / completeness (TODOs, placeholders, half-applied re-baseline)

### F1. [C] `checklists/requirements.md` is a pre-re-baseline / pre-stabilization artifact and must be regenerated

- **Location:** header "**Date**: 2026-06-20" (line 4) — **predates** the 2026-06-21 source-agnostic re-baseline. Consequences observed throughout:
    - **F1a [C] Stale `fetch_status` enum.** Item 10 (line 129) asserts "`fetch_status` values in FR-028 (`pending`/`fetched`/`failed`/`not_found`/`stale`) match the Food entity" and "FR-028's Food `fetch_status` enum includes `failed`." The re-baselined spec's Food entity has **`status` = `PENDING|UNRESOLVED|RESOLVED|NOT_FOUND|FAILED`** (spec.md FR-028 line 398, entity line 459) — the old `fetch_status`/`stale` enum was explicitly removed (spec.md line 5, line 52). The checklist validates a schema that no longer exists.
    - **F1b [H] Stale "stale-while-revalidate" claim.** Item header (line 7), item 13 evidence (line 166), item 16 evidence (line 203) credit the spec with "stale-while-revalidate reads." The re-baseline **replaced** stale-by-age with **change-driven refresh** (spec.md line 38, line 53, FR-031 line 411). The checklist asserts a superseded behavior.
    - **F1c [H] Stale tombstone TTL.** Item 7 (line 93) says "tombstone re-check after ~**90 days**." The spec's TTL is **30 days** (spec.md FR-025 line 391, edge case line 301).
    - **F1d [M] Stale data-quality claim.** Item 7 (line 93) says "missing nutrient fields stored as `null`." The spec represents absence as **missing `food_nutrients` rows** ("presence beats absence"), not null columns (spec.md edge case line 297, FR-MRG-2 line 370).
    - **F1e [M] Stale entity & error names** — see D3 and C1.
    - **F1f [M] Stale FR set** — see D1 (lettered FRs ignored).
- **Problem:** the checklist's "16/17 PASS" verdict is not trustworthy against the current spec; multiple PASS items rest on superseded facts.
- **Resolved by:** the autoresolution quality bar ("no TODO/placeholder, consistent terminology, half-applied re-baseline must be completed") + **D-STATUS** (docs reflect the stabilized product-spec). Regenerate `checklists/requirements.md` against the re-baselined + stabilized spec, applying D-EVENT, D-CANDIDATES, D-DEMAND, D-SC005, D-CLEANUP, D-AUTORESOLVE, D-LEASE, D-UNRESOLVED-TTL, D-AUTH, D-PROVENANCE-FK, D-LIFECYCLE.

### F2. [M] Item 13 verdict (FAIL) is stale once stabilized

- **Location — checklists/requirements.md:** Summary line 239 ("Item 13 … FAIL") and line 245.
- **Problem:** the FAIL is premised on the missing external architecture doc (D2) and a misread "residual token-bucket" concern; the spec body has no token-bucket FR (confirmed — spec.md FR-019–FR-021 are rolling-window only). After regeneration against `v-model/architecture-design.md`, item 13 should flip to PASS (assuming the 900/1,000 params match).
- **Resolved by:** D2 fix + regeneration; settled rate-limiting design stays (autoresolution principle 2).

### F3. [M] FR-014 SQL block is now internally inconsistent with FR-044 — will read as a placeholder once D-DEMAND lands

- **Location — spec.md:** FR-014 (line 361) embeds a concrete `request_count + 1` SQL statement that D-DEMAND overrides. Leaving the literal SQL while FR-044 mandates distinct-requester counting is a half-applied state.
- **Resolved by:** **D-DEMAND** — rewrite the FR-014 SQL to the `fetch_requesters` upsert + capped distinct-`sub` count (mirror plan §4), so the canonical statement and FR-044 agree.

### F4. [L] `.forge-status.yml` not in this cluster but flagged by inputs

- **Location:** `.forge-status.yml` (present in feature dir; not a spec-cluster doc).
- **Note:** **D-STATUS** (`implement` → not-started; revalidation reflects the stabilized product-spec) applies, but the file is owned by the status/forge cluster, not spec. Flagged here only for cross-cluster awareness; no action in this cluster.

---

## G. Items confirmed OK (no action)

- spec.md body is **SQS-free** and correctly describes Postgres-as-queue + Fargate worker + rolling-window limiter (FR-011/FR-014/FR-015/FR-017/FR-018/FR-022) — consistent with the settled design.
- spec.md correctly confines `fdcId` to the USDA adapter in the requirement text (FR-023/FR-024, FR-IDN-2, SC-013) — the residual framing is in _titles/metrics/clarifications_ (E1) and the checklist (E2/E3), not the canonical FRs.
- Single-drainer advisory lock (FR-022) and 30s lease intent (FR-018) are present; only the `leased_at` column + reaper naming is missing (B3).
- Auth model (FR-035–FR-053) is substantively complete and matches **D-AUTH** intent; only the component name (A4) and the `x-debug-sub` mention (B8) need reconciliation.

---

## H. Open for user (genuinely high-stakes AND ambiguous)

- **None identified in this cluster.** Every finding maps to an existing autoresolution default (D-EVENT, D-DEMAND, D-SC005, D-CANDIDATES, D-AUTORESOLVE, D-LEASE, D-UNRESOLVED-TTL, D-PROVENANCE-FK, D-LIFECYCLE, D-AUTH, D-CLEANUP, D-STATUS) or to the autoresolution quality bar. B9 (`source_call_log` retention value) and B7 (reactivation mechanics) are completion details within settled designs, not decisions requiring escalation.
