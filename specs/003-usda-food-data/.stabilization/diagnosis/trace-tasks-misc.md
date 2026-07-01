# Stabilization diagnosis — cluster: trace-tasks-misc

**Feature**: 003-usda-food-data (source-agnostic food data integration)
**Scope of this cluster**: `v-model/trace.md`, `v-model/traceability-matrix.md`, `v-model/hazard-analysis.md`,
`v-model/release-audit-report.md`, `tasks.md`, `sync-report.md`, `verify-report.md`,
`red-team-findings-2026-06-19.md`, `research/*`.
**Cross-checked against**: `.stabilization/inputs/staff-review.md`, `.stabilization/inputs/autoresolutions.md`,
and the other layers (`spec.md`, `plan.md`, `plan/digest.md`, `remediation-plan.md`, the rest of `v-model/`).
**Mode**: stabilize-and-complete the design docs. Each finding cites doc + location, the problem, and the
autoresolution default that resolves it (or "needs decision").

> **Headline.** Two systemic defects dominate this cluster:
> (1) **the completion-event rename to `FoodFetchCompleted` (D-EVENT) was never applied anywhere** — every
> artifact still says `FoodDataReceived`, and the premise in the inputs that "plan §4 annotates
> `FoodFetchCompleted`" is **false** (plan.md contains zero occurrences); and
> (2) **`trace.md`'s Hazard matrix (Matrix H) is a stale pre-re-baseline register** that disagrees, row by
> row (HAZ-003..HAZ-015), with the authoritative `hazard-analysis.md` and with `traceability-matrix.md`'s
> Matrix H — i.e. the "regenerated end-to-end" claim in `trace.md` is half-applied.
> A third systemic defect: **`food_candidates` (D-CANDIDATES) does not exist in any artifact** in this cluster
> (or in plan.md); it is only named as a TODO in `remediation-plan.md`.

---

## 1. Contradictions

### C1 — `trace.md` Matrix H is stale and contradicts the authoritative FMEA (half-applied re-baseline)

- **Doc/location**: `v-model/trace.md` § "Matrix H: Hazard Traceability (HAZ → REQ → Mitigation → Test)",
  rows HAZ-003 through HAZ-015 (lines ~473–488).
- **Problem**: The hazard _definitions_ in `trace.md` Matrix H do not match `hazard-analysis.md` (the
  declared authoritative FMEA) nor `traceability-matrix.md` Matrix H, which agree with each other. Examples:
    - HAZ-004: `trace.md` = "Thundering-herd duplicate fetches for the same food" (SYS-003); authoritative =
      "Demand-path `fetch_queue` insert / `pg_notify` fails" (SYS-002).
    - HAZ-005: `trace.md` = "Poison-pill `fetch_queue` row blocks the queue"; authoritative = "Demand-weight /
      aging miscompute starves user demand."
    - HAZ-006: `trace.md` = "Nutrient data silently rounded/transformed at ingestion" (SYS-020); authoritative =
      "`IngestionScheduled`/`FoodDataReceived` event payload schema drift" (SYS-002).
    - HAZ-008: `trace.md` = "Source 429 causes continued calls/account sanctions"; authoritative = "single 30s
      `in_flight` lease too short for slow source."
    - HAZ-010: `trace.md` = "Canonical-store integrity error causes silent data loss" (SYS-007); authoritative =
      "Batch add exceeds 100-name cap, partially enqueued" (SYS-001).
    - HAZ-012: `trace.md` = "WebSocket stale connections accumulate" (SYS-010); authoritative = "Source 429
      despite per-source limiter" (SYS-006).
    - HAZ-013/014/015 likewise diverge. The mitigation REQ-sets and SYS owners drift with them (e.g. `trace.md`
      HAZ-013 → REQ-NF-017/REQ-001; authoritative HAZ-013 → REQ-024/REQ-055).
      These `trace.md` rows are the **old USDA-coupled hazard wording** (WebSocket-stale, thundering-herd,
      poison-pill, API-unavailability) that the 2026-06-22 re-baseline was supposed to recast. The artifact's own
      re-baseline note (lines 8–10) and `release-audit-report.md` §2 claim `trace.md` was "regenerated
      end-to-end / no orphans," which is **not true for Matrix H**.
- **Resolution**: General **quality bar** in `autoresolutions.md` ("No contradictions … consistent
  terminology"). Regenerate `trace.md` Matrix H to mirror `hazard-analysis.md` (the authoritative FMEA) /
  `traceability-matrix.md` Matrix H verbatim-in-intent. No new design — pure reconciliation.

### C2 — Completion-event name: `FoodDataReceived` everywhere vs canonical `FoodFetchCompleted`

- **Doc/location**: cluster occurrences — `v-model/trace.md` REQ-024 (line 163), REQ-043 (line 181),
  REQ-IF-005 (line 226); `v-model/hazard-analysis.md` SYS-002 header (line 123), HAZ-006 (line 128), HAZ-026
  (line 191); `v-model/traceability-matrix.md` HAZ-026 (line 414); `tasks.md` T-154 (line 344), T-165
  (line 379), T-180 (line 471), T-186 (line 491), FU-EVENTNAME (line 615); `research/tech-stack.md` (line 76),
  `research/codebase-analysis.md` (lines 55, 115). (Also pervasive in the non-cluster layers: `spec.md`,
  `plan.md` lines 48/408/548/591/673/721, all four other `v-model/*` test plans.)
- **Problem**: D-EVENT fixes the canonical name to **`FoodFetchCompleted`**. The premise stated in
  `staff-review.md` / `autoresolutions.md` and in `.forge-status.yml` (lines 154–157) that "plan §4 now
  annotates `FoodFetchCompleted` as an alias … CDK rule matches detailType `FoodFetchCompleted`" is
  **contradicted by the actual files**: `plan.md` contains **zero** occurrences of `FoodFetchCompleted`
  (verified by grep), and so does every doc in this cluster except the `.forge-status.yml` note and the
  `tasks.md` FU-EVENTNAME follow-up. So the rename was never started — not even the alias.
- **Resolution**: **D-EVENT** — replace every `FoodDataReceived` with `FoodFetchCompleted` across spec.md and
  the v-model (and, for consistency, plan.md/tasks.md/research, since they all still carry the old name).
  Then close `tasks.md` FU-EVENTNAME (line 615).

### C3 — REQ census is reported with two different functional counts; release-audit total does not add up

- **Doc/location**: `v-model/trace.md` line 41 ("**63 FR** + 18 NF + 12 IF + 7 CN = 100 total") and Coverage
  Audit line 519 ("Functional (REQ-001..055) **63**"); vs `v-model/traceability-matrix.md` ID inventory line
  38 ("REQ (functional) REQ-001..055 = **55**"); vs `v-model/release-audit-report.md` §3 census (lines 89–93:
  Functional **55**, NF 18, IF 12, CN 7) which is also labelled "**100 total**" (line 86).
- **Problem**: The functional-REQ count is stated as **63** in `trace.md` and **55** in `traceability-matrix.md`
  and `release-audit-report.md`. `trace.md`'s 63+18+12+7=100 only closes if functional=63 (sub-letter IDs
  counted). `release-audit-report.md`'s own table sums to 55+18+12+7 = **92**, yet it claims **100 total** —
  an internal arithmetic inconsistency. The three docs disagree on the same census.
- **Resolution**: **Quality bar** (consistent counts, no contradictions). Pick one counting convention
  (recommend: state both "55 base IDs / 63 incl. a–d sub-IDs" explicitly) and make `trace.md`,
  `traceability-matrix.md`, and `release-audit-report.md` agree; fix the 92-vs-100 arithmetic in release-audit.

### C4 — `trace.md` describes the System-Test plan as STP-001..010, but it is STP-001..020

- **Doc/location**: `v-model/trace.md` artifact-info line 47 ("STP-001-_ .. STP-010-_ end-to-end scenarios")
  and Coverage rollup line 546 ("System | STP-001-_ .. STP-010-_"). Contradicted by `v-model/system-test.md`
  (cases run through **STP-020**), by `traceability-matrix.md` ID inventory line 47 ("STP … STP-014..020"),
  and by `trace.md`'s own Matrix B/H rows which cite STP-013..STP-020.
- **Problem**: Stale range description; the body of the same file references STP-011..020.
- **Resolution**: **Quality bar** — correct the two range descriptions in `trace.md` to STP-001..020.

### C5 — Auto-resolve rule: canonical normalized-name-exact-match vs tasks/plan ±10% nutrient tolerance

- **Doc/location**: `tasks.md` T-162 (lines 366–369) + "Gate items" §1 (lines 623–626) + T-002
  `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE` (line 141), keyed to plan §9-1; vs **D-AUTORESOLVE**.
- **Problem**: D-AUTORESOLVE defines auto-RESOLVE as "exactly one candidate survives **normalized-name exact
  match** (after dedup); >1 → UNRESOLVED; 0 → NOT_FOUND." `tasks.md`/plan §9-1 add a second collapse
  criterion — "nutrient agreement within ±10% on energy/protein" (`FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE=0.10`)
  — which is **not** in the canonical default. This is a divergence (an extra, more aggressive collapse lever)
  that also risks _more_ auto-merges, contrary to D-AUTORESOLVE's "bias toward UNRESOLVED."
- **Resolution**: **D-AUTORESOLVE** (apply exactly). Reconcile to the canonical rule: collapse on
  normalized-name exact match; treat the ±10% nutrient tolerance as out of the canonical scope unless it is
  re-expressed as part of "confident dedup" and explicitly kept. Recommend dropping the nutrient-tolerance
  criterion to match the default; **flag to user** only if the team wants to keep the tolerance knob
  (genuinely ambiguous, low-stakes).

### C6 — Worker-lease column: three inconsistent stories (`leased_at` vs `lease_expires_at` vs none)

- **Doc/location**: D-LEASE says document a **`leased_at`** column + reaper; `v-model/hazard-analysis.md`
  HAZ-021 (line 137) and HAZ-008 mitigation reference **`lease_expires_at`** ("`leaseNext` reclaims rows where
  `lease_expires_at < now()`"); `tasks.md` schema task T-101 (lines 162–167) defines `fetch_queue` with **no
  lease column at all**; `plan.md` §4 (lines 635, 688) describes only a watchdog reverting `in_flight` >30s
  with **no column named**.
- **Problem**: The lease/reaper behavior is referenced but the backing column is (a) missing from the schema
  tasks and plan §2, and (b) named differently where it does appear. The reaper has nothing to read.
- **Resolution**: **D-LEASE** — document one `leased_at` (or `lease_expires_at`) column on `fetch_queue` in
  plan §2 + `tasks.md` T-101 schema, plus the reaper + single-drainer advisory lock; harmonize the column name
  used by HAZ-008/HAZ-021.

### C7 — `red-team-findings-2026-06-19.md` resolution log mandates a per-user `429` quota the final design rejects

- **Doc/location**: `red-team-findings-2026-06-19.md` F-001 / F-011 / F-004 and Resolutions Log lines 47, 50,
  57 ("FR-043 per-`sub` enqueue quota + `429`; ≤20% global-budget share").
- **Problem**: The final design (D-FAIRNESS, spec FR-043, `tasks.md` T-049) is **fairness by demotion, no
  per-user `429`, no quota**. The red-team resolution text still describes a `429`/quota model. A reader
  treating the resolution log as current would re-introduce a rejected design.
- **Resolution**: **D-FAIRNESS** (don't redesign; complete). This is a dated historical artifact; add a
  one-line note that F-001/F-004/F-011 were ultimately resolved by **demotion, not `429`/quota** (per spec
  FR-043/FR-044), or leave it as a point-in-time record with that caveat. Low stakes.

---

## 2. Gaps / missing requirements

### G1 — `food_candidates` table is absent from every artifact in this cluster (and from plan.md)

- **Doc/location**: `v-model/trace.md` REQ-028 (line 167) lists the canonical tables as `food`,
  `food_sources`, `nutrient`, `food_nutrients`, `food_portions`, `food_field_provenance`, `food_category` —
  **no `food_candidates`**; `tasks.md` "Canonical table set (12)" (lines 74–78) and schema tasks T-100/T-101
  omit it; `GET /candidates` (T-133) and `PATCH`-resolve (T-142) operate on a candidate set with **no
  persistence table**; `v-model/hazard-analysis.md` has no hazard for candidate-set persistence/expiry;
  `traceability-matrix.md` has no candidate-table row; `plan.md` §2 has **zero** `food_candidates` (grep);
  the only mention in the whole feature is `remediation-plan.md` line 48 ("`food_candidates` (add it to
  architecture + plan)").
- **Problem**: `food_status` includes `UNRESOLVED` and US-2a (`/candidates` → `PATCH`-resolve) requires the
  candidate set persisted, but no table backs it anywhere. This is the staff-review [C] gap, still open.
- **Resolution**: **D-CANDIDATES** — add `food_candidates` (id, food_id, source, external_key, name, summary,
  created_at; UNIQUE(food_id,source,external_key)) to plan §2, ARCH-006/module-design, spec FR-028, **and in
  this cluster**: `tasks.md` (new schema + migration + DAO task; bump "12 tables" → 13; wire T-133/T-142),
  `trace.md` REQ-028 table list + a MOD/SYS/ARCH/test row for candidate persistence, `traceability-matrix.md`
  (Matrix rows), and a `hazard-analysis.md` hazard for candidate-set integrity/expiry.

### G2 — No auto-resolve FR / acceptance test in the v-model chain

- **Doc/location**: `v-model/trace.md` and `traceability-matrix.md` — REQ-050 only says the worker "sets
  `RESOLVED`/`UNRESOLVED`/`NOT_FOUND`/`FAILED`"; there is **no dedicated REQ or AT** stating the
  one-survivor→RESOLVED / >1→UNRESOLVED / 0→NOT_FOUND boundary. `tasks.md` T-162 implements it, but it traces
  only to FR-RES-3/FR-MRG-1/§9-1, with no first-class auto-resolve REQ/AT.
- **Problem**: D-AUTORESOLVE requires "Add the FR + acceptance tests"; the ≥90%-auto-resolve metric depends on
  a concrete rule that the v-model never states.
- **Resolution**: **D-AUTORESOLVE** — add the auto-resolve FR + REQ + AT (and trace rows) for the canonical
  rule; reconcile the matcher per C5.

### G3 — No `UNRESOLVED`-TTL requirement / test / hazard in the v-model

- **Doc/location**: `v-model/trace.md` REQ-018/REQ-025 cover only the `NOT_FOUND`/tombstone 30-day TTL; there
  is **no** `UNRESOLVED`-TTL REQ/AT. `hazard-analysis.md` lists an `UNRESOLVED-BACKLOG` operational state but
  no expiry hazard. Only `tasks.md` T-172 (lines 400–402, keyed to §9-2) implements the 30-day sweep.
- **Problem**: D-UNRESOLVED-TTL specifies a 30-day candidate-set/UNRESOLVED expiry mirroring the NOT_FOUND TTL,
  but the v-model has no requirement for it.
- **Resolution**: **D-UNRESOLVED-TTL** — add the 30-day `UNRESOLVED` TTL as a REQ/AT (and a hazard for
  stale-candidate handling) so the v-model matches `tasks.md` T-172.

### G4 — Provenance same-food composite FK invariant not documented

- **Doc/location**: `v-model/hazard-analysis.md` HAZ-017 (line 160) mitigates crosswalk-key drift only with
  `UNIQUE(source, external_key)`; `tasks.md` T-102/T-106/T-107/T-108 reference `UNIQUE(source, external_key)`
  and `food_*.source_id` but **not** the composite same-food FK. Nothing documents `UNIQUE(food_id, id)` on
  `food_sources` or composite `(food_id, source_id)` FKs on nutrients/portions/field-provenance.
- **Problem**: Staff-review [C] — `source_id` can cross foods because the FK only checks existence, not
  same-`food_id`.
- **Resolution**: **D-PROVENANCE-FK** — document the composite-FK invariant in plan §2 and propagate the
  control into `tasks.md` (schema/migration tasks) and the HAZ-017 mitigation in `hazard-analysis.md`.

### G5 — Lease reaper column missing from schema layer

- See **C6**. The reaper behavior exists (HAZ-021, T-153, plan §4 watchdog) but the `leased_at` column is
  absent from plan §2 / `tasks.md` T-101. Resolution: **D-LEASE**.

### G6 — Eight open acceptance-test (AT) coverage gaps remain

- **Doc/location**: `v-model/traceability-matrix.md` § "Genuine coverage gaps" (lines 487–503) and
  `v-model/release-audit-report.md` Open-2 (lines 227–231): REQ-011, REQ-017, REQ-018, REQ-028, REQ-038a,
  REQ-042, REQ-044b, REQ-IF-006 lack a dedicated AT (each has STP/UTP/ITP).
- **Problem**: The autoresolution quality bar wants "Every FR/SYS/ARCH/MOD/REQ id traces end-to-end … no
  gaps." Two (REQ-038a authed-users-may-read, REQ-044b flood-latency) are called out as worth closing; REQ-028
  ties into D-CANDIDATES (schema must grow first).
- **Resolution**: **Quality bar** (no specific D- covers the 6 inspection/deferred ones). Recommend adding ATs
  for REQ-038a and REQ-044b; the rest are Inspection/Analysis/deferred-variant and may stay method-covered
  with an explicit note. **REQ-028's** AT should be (re)written once `food_candidates` lands (D-CANDIDATES).

### G7 — SC-005 throughput claim not restated; `≥5,000 foods/hr` survives in the v-model

- **Doc/location**: `v-model/trace.md` REQ-NF-015 (line 213, "Fan-out/merge throughput **≥5,000 foods/hour**
  using batch capability"); `tasks.md` SC-005 coverage (line 600, T-152/T-155) and T-155 (line 347).
- **Problem**: Staff-review [C] SC-002-vs-SC-005 contradiction — USDA's 1,000 req/hr cap and ~1 non-batchable
  name-search per NEW food bound first-time resolution to ~500–900/hr, so `≥5,000 foods/hr` for _new_ foods is
  impossible. REQ-NF-015 still asserts it.
- **Resolution**: **D-SC005** — restate so REQ-NF-015 / SC-005 separates **read/serve throughput** (local
  golden-record reads, high target) from **first-time NEW-food resolution rate** (~500–900/hr, USDA-bounded).
  Keep SC-002 as-is.

---

## 3. Naming drift

- **Completion event** — `FoodDataReceived` → `FoodFetchCompleted` (D-EVENT). See **C2** (the dominant drift;
  pervasive across this cluster and the rest of the feature).
- **Lease column** — `leased_at` (D-LEASE) vs `lease_expires_at` (hazard-analysis). See **C6**.
- Other event names (`IngestionScheduled`, `FetchFailed`, `FoodRequested`/`FoodBatchRequested` as in-process
  enqueue markers) are **consistent** across trace/tasks/hazard/spec/plan — no drift; do not rename.

---

## 4. Orphan / dangling IDs & broken cross-references

- **C4** — `trace.md` STP-001..010 description vs actual STP-001..020 (dangling/under-counted range).
- **C1** — `trace.md` Matrix H rows point HAZ-003..015 at the wrong SYS owners and wrong REQ-sets relative to
  the authoritative FMEA (effectively broken hazard→mitigation cross-references).
- **trace.md HAZ-020..035 collapse** (lines 492, 506–509): a deliberate presentation collapse, _not_ an
  orphan — but because the enumerated HAZ-003..015 above it are stale (C1), the collapse currently hides the
  fact that the visible rows are wrong. Acceptable only after C1 is fixed.
- No genuinely dangling REQ/SYS/ARCH/MOD IDs were found in `traceability-matrix.md` — its forward/backward
  coverage and the auth slice trace are internally consistent and agree with `hazard-analysis.md`.

---

## 5. Residual `fdcId` / cache-hit framing

### R1 — Residual "cache-hit / cache-hit-rate" framing (D-CLEANUP)

- **Doc/location**: `v-model/trace.md` REQ-NF-011 (line 209, "Cache-hit (`RESOLVED`) lookups"), REQ-NF-014
  (line 212, "Cache hit rate >80%"), AT-NF011-A (line 313, "cache-hit (`RESOLVED`) path"), Coverage Audit
  line 594 ("Cache-hit rate"); `tasks.md` T-181 metric `food-cache-hit-rate` (line 475), T-195 "cache-hit p95
  / cache-hit rate" (line 515); `research/metrics-roi.md` SC-001/SC-004 (lines 53, 56).
- **Problem**: Redis is deferred (FR-030; lean launch has no cache layer), so "cache-hit" for a local
  golden-record `RESOLVED` read is the pre-re-baseline framing D-CLEANUP says to purge.
- **Resolution**: **D-CLEANUP** — restate as "RESOLVED-record (local-store) read latency / hit ratio"; rename
  the `food-cache-hit-rate` metric accordingly. (The genuine deferred-Redis `FoodCacheService` rows
  ITP-007/UTP-007/HAZ-020/HAZ-032 may keep cache vocabulary as they are explicitly the deferred Redis variant.)

### R2 — `fdcId` usage (mostly compliant; one historical exception)

- **Doc/location**: `fdcId` counts — `trace.md` 23, `hazard-analysis.md` 17, `tasks.md` 16,
  `traceability-matrix.md` 12, all annotated as **adapter-boundary confinement** (SYS-009/014, ARCH-008/013,
  MOD-008/015, REQ-023/046/IF-004 and their tests). This matches D-CLEANUP's allowance ("`fdcId` may appear
  ONLY as USDA's `external_key`, inside the adapter boundary").
- **Problem**: Acceptable as-is for the v-model/tasks; the **exception** is `red-team-findings-2026-06-19.md`
  (6 occurrences, e.g. F-011/F-012) which use `fdcId` in the _old_ canonical sense (queue key, event payload),
  pre-re-baseline.
- **Resolution**: **D-CLEANUP** — no change needed to the adapter-boundary annotations; the red-team doc is a
  dated artifact — note it predates the `id`/`external_key` re-key (see C7/Q4) rather than rewriting it.

---

## 6. Quality / completeness (TODOs, placeholders, half-applied re-baseline)

### Q1 — `sync-report.md` is stale: never re-run after the 2026-06-22 source-agnostic re-baseline

- **Doc/location**: `sync-report.md` latest entry "Run #3 | 2026-06-19" (lines 3–24); earlier runs (lines
  30–185) reference the superseded design — "High/Low **SQS** priority queues" (line 118, 165), "Redis sorted
  set keyed by **fdcId** (`ZINCRBY`)" (line 117), FR-001..FR-035 numbering.
- **Problem**: Run #3 predates the 2026-06-21/22 re-baseline (spec/plan/v-model), so the report's "all drift
  closed" verdict does not cover the source-agnostic redesign. Its "Remaining items" (line 17–19) say
  `release-audit-report.md` "needs regeneration (REQ-035 still says shared API Gateway authorizer)" — but
  `release-audit-report.md` **was** regenerated 2026-06-22 and now states the in-process `AuthMiddleware`
  model; the note is itself stale.
- **Resolution**: **Quality bar** + **D-CLEANUP**. Either add a Run #4 reflecting the re-baselined chain (and
  drop the obsolete "remaining items"), or annotate Run #3 as superseded. No design change.

### Q2 — `verify-report.md` is badly stale (pre-auth, pre-re-baseline)

- **Doc/location**: `verify-report.md` header "Run date: 2026-05-12 / Mode: Retroactive bootstrap"; "plan ↔
  spec.md PASS … stale-refresh" (line 15).
- **Problem**: Dated 2026-05-12 — predates both the auth slice (US-0/FR-035..053, added 2026-06-18) **and** the
  source-agnostic re-baseline (2026-06-21/22). It still describes the old **age-based "stale-refresh"** model
  (now change-driven) and reports a clean PASS that no longer reflects reality.
- **Resolution**: **Quality bar** — regenerate or explicitly mark superseded; align with the change-driven
  refresh model and the re-baselined chain.

### Q3 — Open follow-up FU-EVENTNAME still tracked in `tasks.md`

- **Doc/location**: `tasks.md` line 615 (and T-165 line 379 "canonical name harmonized — see FU-EVENTNAME").
- **Problem**: An unresolved follow-up that D-EVENT now resolves.
- **Resolution**: **D-EVENT** — apply the rename and remove/close FU-EVENTNAME.

### Q4 — `red-team-findings-2026-06-19.md` is a pre-re-baseline artifact with superseded resolutions

- **Doc/location**: whole file (old framing: `fdcId`, SQS consumer, per-user `429` quota resolutions).
- **Problem**: Useful history, but its resolution log (per-user quota/`429`, see C7) and `fdcId` usage (R2)
  describe designs the final spec replaced (demotion; `id`/`external_key`).
- **Resolution**: **Quality bar** — keep as historical record with a dated "superseded by the 2026-06-22
  source-agnostic re-baseline; F-001/F-004/F-011 resolved via demotion not `429`" note.

### Q5 — `trace.md` re-baseline note over-claims completeness

- **Doc/location**: `v-model/trace.md` lines 8–10 ("regenerated end-to-end … no orphans on either side") and
  the per-checkpoint "Result: PASS" lines; `release-audit-report.md` §2 row "`trace.md` … Present — no
  orphans."
- **Problem**: Contradicted by the stale Matrix H (C1), the STP range error (C4), and the census mismatch (C3).
  The "regenerated end-to-end" claim is not borne out.
- **Resolution**: **Quality bar** — after C1/C3/C4 are fixed, the claim becomes true; until then the note is a
  placeholder-grade overstatement.

### Q6 — `tasks.md` "12 canonical tables" will be wrong after D-CANDIDATES

- **Doc/location**: `tasks.md` lines 7, 74 ("12 canonical tables"), Design Reference "plan.md §2 (12 canonical
  tables)".
- **Problem**: Adding `food_candidates` (G1/D-CANDIDATES) makes it 13; the count is a hard-coded literal in
  several places.
- **Resolution**: **D-CANDIDATES** — update the table-count literal to 13 wherever it appears once the table is
  added.

---

## Cross-reference: autoresolution defaults exercised by this cluster

| Default                          | Where it bites in this cluster                                       |
| -------------------------------- | -------------------------------------------------------------------- |
| **D-EVENT**                      | C2, Q3 (FoodDataReceived → FoodFetchCompleted; close FU-EVENTNAME)   |
| **D-CANDIDATES**                 | G1, Q6 (add `food_candidates`; 12→13 tables)                         |
| **D-SC005**                      | G7 (REQ-NF-015 ≥5,000/hr restated)                                   |
| **D-AUTORESOLVE**                | C5, G2 (canonical rule; add FR/AT; reconcile ±10% tolerance)         |
| **D-UNRESOLVED-TTL**             | G3 (add 30-day UNRESOLVED TTL REQ/AT/HAZ)                            |
| **D-LEASE**                      | C6, G5 (`leased_at` column + reaper + advisory lock; harmonize name) |
| **D-PROVENANCE-FK**              | G4 (composite same-food FK invariant)                                |
| **D-FAIRNESS**                   | C7 (red-team 429/quota resolutions are superseded by demotion)       |
| **D-CLEANUP**                    | R1, R2, Q1, Q4 (cache-hit framing; fdcId; stale reports)             |
| **Quality bar (no specific D-)** | C1, C3, C4, G6, Q1, Q2, Q5                                           |

## Items potentially needing a user decision (low confidence)

- **C5 (±10% nutrient tolerance):** D-AUTORESOLVE specifies normalized-name exact match only. Dropping the
  `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE` knob is the by-the-book resolution, but if the team values the
  tolerance lever it is a genuine (low-stakes) product choice. Everything else is resolvable by an existing
  default.
