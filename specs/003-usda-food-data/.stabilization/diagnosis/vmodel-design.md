# Diagnosis — cluster `vmodel-design`

**Scope:** `v-model/requirements.md`, `v-model/system-design.md`, `v-model/architecture-design.md`,
`v-model/module-design.md` (the four V-Model design layers, L1–L4), cross-checked against the canonical
inputs (`staff-review.md`, `autoresolutions.md`), `plan.md` §2 (canonical data model), and `spec.md`.

**Headline:** the four design docs were re-baselined to the source-agnostic model and are internally
coherent on the _big_ re-baseline (internal `id`, USDA-as-adapter, golden record, distinct-requester
demand FR-044, demotion-not-quota). But several **late autoresolution decisions were never applied** to
these docs. Two are pervasive and load-bearing: (1) the completion event is still named
`FoodDataReceived` everywhere (D-EVENT wants `FoodFetchCompleted`), and (2) the `food_candidates` table
does not exist in any schema enumeration even though all four docs describe candidate persistence and
US-005a depends on it (D-CANDIDATES). Both make the docs _not_ implementation-ready as written.

Legend: **[C]** contradiction · **[G]** gap/missing · severity in brackets. Each finding cites
doc:line(s), the problem, and the resolving autoresolution default (or "needs decision").

---

## A. Contradictions / drift

### C1 — [C, critical] Completion event still `FoodDataReceived`, not `FoodFetchCompleted` (D-EVENT)

**Where (design cluster):**

- `requirements.md`: L38, L39 (Overview); L57 (REQ-011), L70 (REQ-024), L80 (REQ-034), L94 (REQ-043);
  L142 (REQ-IF-005, the canonical event-type list); glossary L214 (`FoodDataEvent`).
- `system-design.md`: L46–L48 (Overview), L66 (SYS-005), L71 (SYS-010), L113/L118 (Dependency view),
  L159 (External Interfaces), L214 (Path 0), L286–L287 (Path 4), L387 (SYS-005 trace), L417 (SYS-010 trace).
- `architecture-design.md`: L40 (Overview), L58 (ARCH-002), L60 (ARCH-004), L193 (Interaction 3),
  L287 (`publishFoodDataReceived`), L471 (Data Flow 3), L514 (ARCH-009 note), L526 (Physical view).
- `module-design.md`: L238, L269–L272, L287, L289 (MOD-002 `publishFoodDataReceived` + data structures);
  L474, L482, L494 (MOD-004 emits); plus MOD traceability rows.

**Problem:** `grep` finds **122** occurrences of `FoodDataReceived` and **zero** of `FoodFetchCompleted`
across the spec/plan/v-model corpus. D-EVENT fixes the canonical name as `FoodFetchCompleted` (matches
plan §4 + the CDK rule). The design docs are entirely on the old name — a verbatim naming-drift the
staff review called out explicitly.
**Resolves via:** **D-EVENT** — replace every `FoodDataReceived` with `FoodFetchCompleted` across all four
design docs (and the rest of the corpus). Keep `IngestionScheduled`, `FoodRequested`/`FoodBatchRequested`,
`FetchFailed` as-is; only the completion event is renamed.

### C2 — [C, critical] SC-005 throughput contradicts SC-002 / USDA hourly cap (D-SC005)

**Where:** `requirements.md` L129 (REQ-NF-015 / SC-005) "effective resolution throughput of at least
**5,000 foods per hour**" vs L126 (REQ-NF-012 / SC-002) "never exceed … USDA: ≤1,000 [in any trailing
60 min]" and L159 (REQ-CN-005) "USDA: 1,000 requests per hour … hard constraint." Also surfaces in
`system-design.md` is fine (no throughput claim) but the contradiction is rooted in requirements.
**Problem:** name-search is ~1 non-batchable call per NEW food, so the real first-time-resolution ceiling
is ~500–900/hr. 5,000/hr first-time resolutions and a ≤1,000/hr USDA budget cannot both hold. The model
is right; the metric is wrong.
**Resolves via:** **D-SC005** — restate SC-005 (REQ-NF-015) to separate **read/serve throughput**
(local golden-record reads, no source call — keep a high target) from **first-time resolution rate of
NEW foods** (bounded by the USDA budget, ~500–900/hr). Keep SC-002/REQ-CN-005 unchanged.

### C3 — [C, high] Worker-lease column is drifting three ways (D-LEASE)

**Where:**

- `requirements.md` L63 (REQ-017) + glossary L213 (`QueueMessage` column list: `food_id, request_count,
first_requested/last_requested, attempts, last_error, status`) — **no lease column**; lease is described
  only as "stale `in_flight` row older than 30s reverts to `pending`."
- `system-design.md` L45, L271 (Path 4) — leases by setting `last_requested=now()` ("single 30s
  `in_flight` lease; stale >30s reverts").
- `module-design.md` L353, L357, L391, L400, L522, L539 — introduces a dedicated `lease_expires_at`
  column and reclaims `WHERE status='in_flight' AND lease_expires_at < now()`.

**Problem:** three inconsistent representations of the same lease (no column / `last_requested` / a new
`lease_expires_at`), none of which is the canonical `leased_at`. The L1/L2 schema/glossary do not even
list a lease column, so an implementer reading requirements would orphan crashed `in_flight` rows
(staff-review HAZ-021).
**Resolves via:** **D-LEASE** — document a single `leased_at` column on `fetch_queue` and a reaper that
reverts `in_flight` rows whose lease is older than the 30s window; single drainer enforced via advisory
lock (already in REQ-022/REQ-CN-003). Reconcile REQ-017, the `QueueMessage` glossary entry, system-design
Path 4, and MOD-003/MOD-004 to the one `leased_at` name. (MOD-003's inline reclaim is acceptable as the
reaper; just rename `lease_expires_at` → derive from `leased_at`.)

### C4 — [C, high] Canonical schema described as "12-table"; must be 13 with `food_candidates` (D-CANDIDATES)

**Where:** `system-design.md` L332 (Physical view "12-table source-agnostic schema");
`architecture-design.md` L528, L540 ("12-table canonical schema"); `module-design.md` L644, L1978
("12-table normalized provenance-bearing schema"). `plan.md` L288–L294 "Final table list" enumerates the
same 12 tables and **does not** include `food_candidates` either.
**Problem:** the table count and table lists are authoritative and they omit `food_candidates`, directly
contradicting the canonical data model that D-CANDIDATES mandates.
**Resolves via:** **D-CANDIDATES** — add `food_candidates` and update every "12-table" reference to
"13-table"; add it to plan §2 final table list, SYS-007 (system-design L68), ARCH-006 (architecture-design
L62), and MOD-006 (module-design L640–L656) schema enumerations.

### C5 — [C, high] `CandidateStore` is referenced but has no backing table (dangling abstraction) (D-CANDIDATES)

**Where:** `module-design.md` MOD-018 L1679 (`CandidateStore.forFood`), L1685 (`idsForFood`), L1692
(`fetch`), L1696 (`clear`); MOD-006 schema (L640–L702) lists no candidate table; MOD-018 prose L1668
hand-waves "the candidate set is the per-source candidates retained for the `UNRESOLVED` food" with no
persistence. SYS-016 (`system-design.md` L77) and ARCH-016 (`architecture-design.md` L72) likewise assert
"the food's own candidate set" with no store.
**Problem:** `GET /candidates` and `PATCH`-resolve are specified against a `CandidateStore` that maps to no
table in the canonical schema. Candidate-set membership validation (REQ-049) is therefore unimplementable
as documented — the orphan abstraction is the symptom of the missing `food_candidates` table.
**Resolves via:** **D-CANDIDATES** — back `CandidateStore` with the new `food_candidates(id, food_id,
source, external_key, name, summary, created_at; UNIQUE(food_id, source, external_key))` table; have the
worker persist surviving per-source candidates on an `UNRESOLVED` outcome and `PATCH`-resolve read/clear
from it.

### C6 — [C, medium] Residual cache-hit / cache-miss framing throughout (D-CLEANUP)

**Where:** `requirements.md` L36 ("add-by-name (cache miss)"), L57 (REQ-011 "cache miss"), L60 (REQ-014
"Each cache-miss admission"), L82 (REQ-037a "the 50ms **cache-hit** budget"), L89 (REQ-039 "authenticated
cache-miss request"), L125 (REQ-NF-011 "(cache hit)"), L128 (REQ-NF-014 "**Cache hit rate**");
`system-design.md` L247 (Path 3 heading "Add By Name (Cache Miss …)"); `architecture-design.md` L57
(ARCH-001 "On add-by-name (cache miss)"), L144 (Interaction 2 heading "Cache Miss").
**Problem:** the lean-launch default is the Postgres canonical store, **not** a cache (Redis is a deferred
variant). "Cache hit/miss" is left-over pre-re-baseline framing that misdescribes the architecture and
keeps a stale mental model alive. (Note: `module-design.md` L1014 "cache HIT" for the Secrets Manager key
cache is legitimate and out of scope.)
**Resolves via:** **D-CLEANUP** — purge cache-hit/miss framing: recast as "local-store read (RESOLVED)"
and "add-by-name for a food not in the local store." Reword REQ-037a's "50ms cache-hit budget" and
REQ-NF-011/REQ-NF-014 accordingly (REQ-NF-014's "cache hit rate" should become "local-store serve rate").

---

## B. Gaps / missing requirements

### G1 — [C, critical] No `food_candidates` storage in any design doc (D-CANDIDATES)

**Where:** absent from `requirements.md` REQ-028 (L74, schema), REQ-052 (L106, provenance), REQ-048/REQ-049
(L102–L103); SYS-007 (`system-design.md` L68); ARCH-006 (`architecture-design.md` L62); MOD-006
(`module-design.md` L640–L702). `grep food_candidates` across the whole corpus = **0 hits**.
**Problem:** `food_status` includes `UNRESOLVED` and US-005a needs the candidate set persisted
(`GET /candidates` → `PATCH`-resolve), but there is no table for it anywhere in the design layers. This is
the structural root of C5.
**Resolves via:** **D-CANDIDATES** — add the table (columns + `UNIQUE(food_id, source, external_key)`) to
REQ-028's schema, SYS-007, ARCH-006, MOD-006, and a new MOD/REQ trace; add the supporting acceptance/test
hooks in the test layers (out of this cluster but flag for traceability).

### G2 — [H] Auto-RESOLVE vs UNRESOLVED boundary not stated as a requirement (D-AUTORESOLVE)

**Where:** `requirements.md` REQ-050 (L104) only says "RESOLVED (confident single merge), UNRESOLVED
(multiple candidates …)"; `system-design.md` Path 4 L279–L281 says "exactly one confident survivor →
RESOLVED; ≥2 → UNRESOLVED; no source → NOT_FOUND"; `module-design.md` MOD-004 L487–L489 / MOD-017 L1583.
The concrete rule lives only as a _recommendation_ in `plan.md` §9 L839–L843, not as an FR or acceptance
criterion in the v-model. The ≥90%-auto-resolve metric depends on this boundary.
**Problem:** "confident single merge" is undefined — no normative rule, no FR, no acceptance test in the
design layers.
**Resolves via:** **D-AUTORESOLVE** — add an explicit FR (and trace it through SYS/ARCH/MOD): auto-RESOLVE
when **exactly one** candidate survives normalized-name exact match after dedup; **>1 → UNRESOLVED**;
**0 → NOT_FOUND**; bias toward UNRESOLVED (human is final arbiter). Add the matching acceptance tests.

### G3 — [H] UNRESOLVED-TTL undocumented (D-UNRESOLVED-TTL)

**Where:** `requirements.md` REQ-018/REQ-025 (L64, L71) define the 30-day tombstone TTL for
`NOT_FOUND`/`FAILED` only; nothing covers an `UNRESOLVED` food nobody picks. `spec.md` L302 explicitly
defers it; `plan.md` §9 L846–L848 _recommends_ a 30-day soft TTL but the v-model has no requirement.
**Problem:** an `UNRESOLVED` food's candidate set has no expiry/refresh policy anywhere in the design layers.
**Resolves via:** **D-UNRESOLVED-TTL** — document that an `UNRESOLVED` food is kept until a human picks; its
**candidate set expires after 30 days** and re-fan-out occurs on the next request (mirrors the NOT_FOUND
30-day TTL). Note a _divergence to reconcile_: plan §9 says "swept to NOT_FOUND by the change-refresh cron
via `food.updated_at`," whereas D-UNRESOLVED-TTL says "candidate set expires + re-fan-out on next request."
Apply D-UNRESOLVED-TTL as canonical and align plan §9 to it.

### G4 — [C, high] Composite same-food provenance FK not documented (D-PROVENANCE-FK)

**Where:** `requirements.md` REQ-028 (L74) / REQ-052 (L106) and REQ-029 (L75) only specify a `source_id`
reference column and `UNIQUE(source, external_key)`; SYS-007/SYS-017 (`system-design.md` L68, L78),
ARCH-006/ARCH-017 (`architecture-design.md` L62, L73), MOD-006 (`module-design.md` L696–L702) and MOD-019
(L1759, joins `fs.id = ffp.source_id`) all check `source_id` existence only — never same-`food_id`.
`grep "UNIQUE(food_id"` / `"(food_id, source_id)"` = 0 hits.
**Problem:** `food_nutrients/food_portions/food_field_provenance.source_id → food_sources(id)` only enforces
existence, so a provenance row can point at a `food_sources` row belonging to a **different** food. The
"same-food" invariant is not structural.
**Resolves via:** **D-PROVENANCE-FK** — document `UNIQUE(food_id, id)` on `food_sources` and composite
`(food_id, source_id)` FKs on `food_nutrients`/`food_portions`/`food_field_provenance` in REQ-028/REQ-029,
SYS-007, ARCH-006, and MOD-006.

### G5 — [H] No explicit legal lifecycle-transition set (D-LIFECYCLE)

**Where:** `requirements.md` glossary L208 narrates the lifecycle but there is **no** transition table;
MOD-001/MOD-004 state machines are per-module request/worker FSMs, not the food-status legal-transition
set. `grep` for transition phrasing (`FAILED→PENDING`, `NOT_FOUND→PENDING after TTL`, "legal transition")
= 0 hits in the design layers.
**Problem:** transitions are only value-CHECK'd (enum membership). The legal set and the "refresh must not
clobber a manual pick" / "PATCH-resolve is UNRESOLVED-only, idempotent, candidate-in-set" invariants are
not documented as a transition spec.
**Resolves via:** **D-LIFECYCLE** — document the explicit legal set: PENDING→{RESOLVED, UNRESOLVED,
NOT_FOUND, FAILED}; UNRESOLVED→RESOLVED; FAILED→PENDING (retry); NOT_FOUND→PENDING (after TTL); refresh
never overwrites a user's manual pick; PATCH-resolve UNRESOLVED-only + idempotent + candidate-in-set.

### G6 — [H] Reaper / lease column absent from L1–L2 (D-LEASE)

**Where:** see C3. Specifically the _requirement-level_ description (REQ-017, glossary `QueueMessage`
L213) and system-design Path 4 do not introduce a lease column or a reaper; only MOD-003 does, under a
non-canonical name.
**Problem:** a worker crash mid-lease orphans the `in_flight` row at the requirement level as written
(staff-review HAZ-021). The reaper only "exists" in L4.
**Resolves via:** **D-LEASE** — surface the `leased_at` column + 30s reaper in REQ-017, the glossary, and
system-design Path 4, not just module-design. (Single-drainer advisory lock already covered by REQ-022.)

### G7 — [H] Fairness incomplete for multi-requester foods and global-ceiling shedding (D-FAIRNESS)

**Where:** `requirements.md` REQ-039 (L89) and SYS-013/SYS-004 (`system-design.md` L74, L65),
ARCH-012 (`architecture-design.md` L68), MOD-013 (referenced `unit-test.md` L1352) define per-`sub`
demotion when a single `sub` has >50 pending. Two pieces are missing:

1. **Multi-requester demotion key** — when a food has several requesters, REQ-039 does not say a food is
   demoted only when **all** its requesters exceed the threshold (staff-review: "Demotion key
   (`pending-count>50`) is undefined for multi-requester foods").
2. **Near-ceiling shedding** — REQ-040b (L91) gives a global `503` backpressure, but nothing says to shed a
   flooding `sub`'s **NEW** enqueues first to preserve headroom (staff-review: a single `sub` adding ~10k
   names trips the global 503 for everyone).
   **Resolves via:** **D-FAIRNESS** — document: a food is demoted only when **all** its requesters exceed the
   threshold (50); near the global ceiling, shed a flooding `sub`'s NEW enqueues first (503) to preserve
   headroom. No per-user quota, no 429 on reads/resolves. (Demotion design itself stays.)

### G8 — [H] Change-driven refresh compute substrate unspecified (D-REFRESH)

**Where:** `system-design.md` Physical view L323–L337 has **no** row for SYS-019 ChangeDrivenRefresh;
`architecture-design.md` Physical view L552 lists ARCH-018 only as "EventBridge-scheduled handler
(re-enqueues into `fetch_queue`)" — runtime (Lambda vs Fargate) left open; `module-design.md` MOD-020
likewise unspecified.
**Problem:** D-REFRESH requires the refresh to run as a **Fargate scheduled task** (idle-drain, yields to
live demand), explicitly **not** a VPC Lambda. As written the refresh executor's compute is undefined and
could be implemented as a VPC Lambda, conflicting with the NAT/egress topology. (Note: the autoresolution
cites "ADR-0004" for this, but ADR-0004 in this worktree is _minimize-NAT-egress_; the ADR pointer should
be corrected when applied — flag, do not silently follow.)
**Resolves via:** **D-REFRESH** — state change-detection = re-fetch + hash compare (`item_version`, already
in REQ-032/REQ-053/SYS-019/ARCH-018), and pin the executor to a **Fargate scheduled task** doing
low-priority idle-drain; add the physical-view rows for SYS-019/ARCH-018/MOD-020. Cadence is
budget-bounded, not a fixed promise.

### G9 — [M] `source_call_log` pruning/retention story undocumented (needs decision)

**Where:** `requirements.md` REQ-020 (L66) / SYS-006 (`system-design.md` L67, L393) /
ARCH-005 (`architecture-design.md` L61, L244 "old rows pruned/ignored beyond the window") /
MOD-005 (`module-design.md` L543–L636) describe the rolling-window count but never define when
`source_call_log` rows are pruned or retained.
**Problem:** the table grows unbounded without a documented prune; "pruned/ignored beyond the window" is
asserted in one mermaid note but never specified as a behavior.
**Resolves via:** **needs decision** — no autoresolution default explicitly covers retention. Reasonable
default consistent with the settled limiter design: prune rows older than the 60-min window on a periodic
sweep (or on each check). Flag for the user only if a longer audit-retention is desired; otherwise resolve
to "prune beyond the trailing window."

### G10 — [M] `ON DELETE` semantics for `source_id` undocumented (needs decision)

**Where:** `module-design.md` MOD-006 L696–L702 (`food_sources` upsert) and MOD-019 L1759–L1763 reference
`source_id` FKs; no doc states the `ON DELETE` behavior.
**Problem:** staff review: deleting a `food_sources` row must **not** cascade-delete golden values that a
user may have manually resolved.
**Resolves via:** **needs decision** (adjacent to **D-PROVENANCE-FK**) — recommend `ON DELETE RESTRICT`
(or `SET NULL`) so source-row removal cannot silently erase golden/manual values. Document alongside the
composite-FK rule.

### G11 — [M] `createByName` reactivation of terminal rows undocumented (D-LIFECYCLE-adjacent)

**Where:** `requirements.md` REQ-005 (L51) / REQ-013 (L59); `module-design.md` MOD-001 L104,
MOD-016 (DAO `createByName`) and MOD-006 L728 ("normalized-name unique conflict … advisory lock collapses
to the existing `id`").
**Problem:** with a unique `normalized_name`, a re-add of a name whose row is terminal (`NOT_FOUND`/`FAILED`
past TTL) must **reactivate** that row (set `PENDING`, re-enqueue), not raise a `23505` unique violation or
collapse silently to a dead row. This is implied by the lifecycle (NOT_FOUND→PENDING after TTL,
FAILED→PENDING) but not stated for the add path.
**Resolves via:** **D-LIFECYCLE** — document that `createByName` reactivates a terminal row (per the legal
transitions) rather than erroring on the unique key.

### G12 — [M] Single-drainer concurrency invariant stated but not tied to the limiter race

**Where:** `requirements.md` REQ-020 (L66, atomic check-and-record) + REQ-022/REQ-CN-003 (L68, L157,
single instance via advisory lock); SYS-005 (`system-design.md` L66) / ARCH-004.
**Problem:** the pieces exist but the docs don't explicitly state that "zero 429 in any window" is only
safe **because** a single advisory-locked drainer makes the read-committed count+insert effectively
serial. Staff review asked for this invariant to be explicit. (Largely covered — minor.)
**Resolves via:** **D-LEASE / settled-design** — add one sentence to SYS-006/REQ-019 linking the
single-drainer invariant (REQ-022) to the atomicity guarantee (REQ-020). No design change.

### G13 — [low] `x-debug-sub` removal not explicitly stated (D-AUTH)

**Where:** `requirements.md` REQ-037c (L84) mandates identity from the verified `sub` only, never a
client-suppliable header; `grep x-debug-sub` across the corpus = 0 hits.
**Problem:** D-AUTH asks the docs to _state_ that the forgeable `x-debug-sub` path is removed. The intent
is present (REQ-037c) but the specific bypass is never named, so a reviewer can't confirm it was considered.
**Resolves via:** **D-AUTH** — add an explicit note (REQ-037c / SYS-013 / ARCH-012) that the forgeable
`x-debug-sub` (and any trusted-header identity) path is removed; no design change.

---

## C. Things that are already correct (do not "fix")

- **Distinct-requester demand (FR-044)** is fully applied: REQ-014 (L60), SYS-003/SYS-004 (L64–L65),
  ARCH-003 (L59), MOD-003 (L330–L342) all use `fetch_requesters` upsert + capped distinct-`sub`
  `request_count` (PRIORITY_CAP=1), never raw `+1`. **D-DEMAND already satisfied** in this cluster.
  (Caveat: the staff-review note that the US-005 _test_ asserts the raw model lives in the test layer, not
  here.)
- **EventBridge off the demand path** (REQ-011/REQ-IF-005, SYS-002, ARCH-002, MOD-002) is consistent.
- **`fdcId` confined to the adapter** (REQ-046, REQ-023, glossary L203–L204; SYS-009/SYS-014; ARCH-008/013;
  MOD-008) — all remaining `fdcId` references are inside the USDA adapter boundary, which D-CLEANUP permits
  ("`fdcId` may appear ONLY as USDA's `external_key`, inside the adapter boundary"). No canonical-side leak
  found.
- **Auth slice** (REQ-035, REQ-037a–d, REQ-038a–c, REQ-039..044d) is coherent and matches the locked
  fail-closed/networkless/no-429-demotion design.

---

## D. Cross-layer notes (outside the four design docs, flagged for the owning clusters)

- `plan.md` L288–L294 "Final table list" also omits `food_candidates` (D-CANDIDATES applies to plan §2 too).
- `plan.md` and `spec.md` also carry `FoodDataReceived` (D-EVENT) and cache-hit framing (D-CLEANUP).
- The peer-review/test artifacts (`peer-review-*.md`, `system-test.md`, `acceptance-plan.md`,
  `unit-test.md`, `trace.md`, `traceability-matrix.md`, `hazard-analysis.md`) still carry `FoodDataReceived`
  and cache-hit references; they will need the same D-EVENT / D-CLEANUP sweep and new traces for
  `food_candidates` / auto-resolve / UNRESOLVED-TTL once the design layers are corrected.
- `.forge-status.yml` correction (D-STATUS: `implement` → not-started) is out of this cluster.
