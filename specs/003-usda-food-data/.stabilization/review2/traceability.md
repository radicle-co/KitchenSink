# Pre-Implementation Adversarial Review — Lens: Traceability

Feature 003 (source-agnostic food data integration). Reviewer goal: verify end-to-end
FR → SYS → ARCH → MOD → REQ → UTP/ITP/STP/ATP → HAZ traceability with no orphans or
dangling refs, and confirm every decision-register item landed in the artifacts that
carry it. Authoritative baseline: `decision-register.md` + `plan.md §2` + the in-folder
`v-model/*` chain, with `hazard-analysis.md` as the authoritative FMEA.

Verdict: **ISSUES** (one critical, two medium, two low).

---

## What is correct (verified, not assumed)

- **FR → REQ anchor is complete.** `spec.md` defines exactly **71 unique FR ids**
  (FR-001..053, FR-IDN-1..3, FR-RES-1..3, FR-MRG-1..5, FR-ADP-1..3, FR-025a/028a/043a/043b).
  `traceability-matrix.md` Matrix Ø anchors all 71 to ≥1 REQ. No FR is unanchored, none is
  referenced-but-undefined.
- **All five stabilization FRs are defined in `spec.md`** (FR-MRG-5 L388, FR-025a L408,
  FR-028a L424, FR-043a L458, FR-043b L459) and all three new sub-REQs are defined in
  `v-model/requirements.md` (REQ-050a L119, REQ-025a L84, REQ-028a L88) plus REQ-NF-019 (L145).
  The decision-register §4 "requirements to ADD" all landed.
- **New acceptance tests exist** in `acceptance-plan.md`: AT-MRG5-A/B/C, AT-025a-A/B,
  AT-028a-A, AT-018-A, AT-LC-A/B/C/E, ATS-028a-A1/A2, ATS-049-A2. The composite REQ-028a
  coverage in the matrices ("AT-LC-A..E via ATS-…") resolves to real scenarios; AT-LC-D is
  explicitly mapped to AT-031-B (not a dangling id).
- **New tests exist** for the new boundaries (ITP-013-B confinement, ITP-016/018/019,
  UTP-017-A..D survivor-count, UTP-018/020/021, reaper assertions in UTP under `leased_at`).
- **`tasks.md` carries every stabilization decision** — T-111 (`food_candidates` 13th table),
  T-153 (lease reaper on `leased_at`), T-162 (survivor-count auto-resolve, tolerance knob
  removed), T-172 (UNRESOLVED candidate-set 30-day expiry, never sweep-to-NOT_FOUND),
  T-165 (`FoodFetchCompleted`/`publishFoodFetchCompleted`, FU-EVENTNAME closed). tasks.md
  traces by FR; the FR↔REQ map closes the loop.
- **Banned vocabulary purged** — `enqueueLowPriority`, `drain_priority_tier`,
  `lease_expires_at`, `FOOD_AUTORESOLVE_NUTRIENT_TOLERANCE` appear in `unit-test.md` /
  `integration-test.md` only as explicit negations ("there is no …"), per D-FAIRNESS / D-LEASE / D-AUTORESOLVE.
- **`traceability-matrix.md` Matrix H is correct** — its HAZ-001..049 rows match the
  authoritative `hazard-analysis.md` FMEA (failure modes, SYS parents, REQ mitigations).
- `spec.md` defines SC-013 (structural same-food provenance invariant) and SC-014
  (NEW-food resolution rate) — the D-SC005 split landed.

---

## Findings

### 1. [CRITICAL] `trace.md` Matrix H is a stale, contradictory hazard taxonomy — the same HAZ ids mean different things than the authoritative FMEA

`v-model/trace.md` "Matrix H: Hazard Traceability" (lines 484–524) **claims** to link
"FMEA hazards (`hazard-analysis.md`, HAZ-001..049)". It does not. For HAZ-003 through
HAZ-015 it carries the **pre-re-baseline** hazard register — different failure modes,
different SYS parents, different REQ mitigations, and therefore different verification
tests than both the authoritative `hazard-analysis.md` and the (correct)
`traceability-matrix.md` Matrix H. Concrete divergences:

| HAZ     | `hazard-analysis.md` (authoritative)                            | `trace.md` Matrix H (wrong)                               |
| ------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| HAZ-003 | SYS-003 queue-grain dedup bypassed (REQ-013/014)                | "Add-by-name dedup race / pending-set leak" (REQ-005/013) |
| HAZ-004 | SYS-002 demand-path insert/`pg_notify` fails (REQ-011/014)      | "Thundering-herd duplicate fetches" SYS-003 (REQ-013/014) |
| HAZ-005 | SYS-003 demand-weight/aging miscompute (REQ-015/039)            | "Poison-pill `fetch_queue` row" (REQ-016/027)             |
| HAZ-006 | SYS-002 event payload schema drift (REQ-IF-005)                 | "Nutrient data silently rounded" SYS-020 (REQ-NF-018/055) |
| HAZ-007 | SYS-003 `food_id` `ON CONFLICT` collision (REQ-013/014)         | "RESOLVED food ages without refresh" (REQ-031/053)        |
| HAZ-008 | SYS-005 30s lease too short for slow source (**REQ-017**)       | "Source 429 causes continued calls" SYS-006 (**REQ-026**) |
| HAZ-009 | SYS-019 change-refresh re-enqueues accumulate (REQ-031/053)     | "Invalid id reaches `fetch_queue`" SYS-001 (REQ-006)      |
| HAZ-010 | SYS-001 batch >100-name cap (REQ-040a)                          | "Canonical-store integrity error" (REQ-028)               |
| HAZ-011 | SYS-005 wired-source outage collapses fan-out (REQ-016/027/050) | "Consumer concurrency >1 splits window" (REQ-022/CN-003)  |
| HAZ-012 | SYS-006 source 429 despite limiter (REQ-019/026)                | "WebSocket stale connections" SYS-010 (REQ-034)           |
| HAZ-013 | adapter-boundary `fdcId` hazard                                 | "Food data API unavailability" SYS-007 (REQ-NF-017)       |
| HAZ-014 | SYS-005 fan-out persist txn fails (REQ-024)                     | "Tombstone-row overflow" (REQ-NF-016/018)                 |
| HAZ-015 | SYS-006 trailing-window count math bug (REQ-019/020)            | "Per-source API key rotation" SYS-011 (REQ-IF-006)        |

Effect: a developer/test author who consults `trace.md` (a primary deliverable this lens
must validate) for hazard mitigations and verification will wire the **wrong** REQ controls
and **wrong** tests for 13 of 49 hazards. Two trace artifacts disagree on the meaning of the
same id — a textbook traceability-integrity failure. The decision-register §3.14 explicitly
required: _"Regenerate `trace.md` Matrix H to mirror the authoritative `hazard-analysis.md`
FMEA."_ That mandated stabilization deliverable was **not completed**.

Fix: regenerate `trace.md` Matrix H from `hazard-analysis.md` so HAZ-001..049 failure modes,
SYS parents, REQ mitigations, and verification-test bindings match the FMEA and the
already-correct `traceability-matrix.md` Matrix H (lines 410–460). Correct the false header
claim until it is true.

### 2. [MEDIUM] `trace.md` Matrix H collapses HAZ-020..035 into one summary row — 16 hazards have no individual trace in this artifact

`trace.md` line 505 represents HAZ-020..035 as a single "Preserved re-keyed hazards" row,
deferring to `hazard-analysis.md`. But the FMEA has **distinct** hazards there (e.g. HAZ-024
source-key revoked, HAZ-025 WS-disabled, HAZ-026 wrong-connection push, HAZ-027 secret
logged, HAZ-029 alarms misconfigured, HAZ-030 cardinality, HAZ-031..035 deepening), each with
its own REQ + MOD + test — all of which `traceability-matrix.md` Matrix H enumerates
(lines 431–446). In `trace.md` these 16 HAZ→REQ→test rows are absent. Defended as a
"presentation choice", but combined with Finding 1 it means `trace.md` Matrix H is not a
faithful mirror of the FMEA it claims to reproduce.

Fix: enumerate HAZ-020..035 individually in `trace.md` Matrix H (mirror
`traceability-matrix.md` lines 431–446), or drop `trace.md` Matrix H entirely and point to
`traceability-matrix.md` as the single hazard-trace surface to avoid two divergent copies.

### 3. [MEDIUM] `trace.md` internal REQ-census arithmetic is inconsistent (18 NF / 100 vs 19 NF / 101)

`trace.md` Artifact Information (line 41) states the requirements census as
"63 FR + **18 NF** + 12 IF + 7 CN = **100 total**". Its own Coverage Audit (lines 535/538)
states Non-Functional = **19** and Total = **101**. 63 + 19 + 12 + 7 = 101, so line 41 is
stale — it never absorbed the new REQ-NF-019 (SC-014). This is the same census-arithmetic
class of defect the decision-register §3.14 flagged ("fix the 92-vs-100 arithmetic").

Fix: update `trace.md` line 41 to "63 FR + 19 NF + 12 IF + 7 CN = 101 total".

### 4. [LOW] AT/ATP coverage count drifts across artifacts (51 vs 57 vs 56)

`traceability-matrix.md` ID inventory (line 53) claims "AT / ATP — 51 cases (42 AT +
ATP-008-A..I)", while its own Test-inventory rollup (line 503) claims "AT / ATP
(acceptance) — 57", and `trace.md` (line 563) describes "AT-001-A .. AT-055-A + AT-018-A,
AT-MRG5-A/B/C, AT-025a-A/B (41 cases)" + 9 ATP + 6 AT-NF = 56. Three different totals for
the same acceptance-test population. No id is itself orphaned/dangling, but the
coverage-count claims are not reconciled.

Fix: recount the AT/ATP/AT-NF population once and use a single number in both files'
inventory and rollup tables.

### 5. [LOW] `trace.md` orphan report asserts a SYS/ARCH trace for REQ-NF-019/REQ-NF-015 that does not exist in the design docs

`trace.md` orphan report (lines 582–584) states REQ-NF-019 "(→ SYS-012/ARCH-005; Analysis)".
Neither REQ-NF-019 nor REQ-NF-015 appears in `system-design.md` or `architecture-design.md`.
Because both are Analysis-only (verified by CloudWatch post-prod), the matrices' own rules do
not require a SYS/ARCH trace — so this is **not** a hard coverage gap. But the specific
"→ SYS-012/ARCH-005" claim is unsupported (a dangling forward-reference into design layers
that don't carry it).

Fix: either add REQ-NF-019/REQ-NF-015 as Parent Requirements on SYS-012/ARCH-005, or drop
the SYS/ARCH citation and describe them as Analysis-only with no SYS/ARCH decomposition
(consistent with `traceability-matrix.md` Matrix B line 335, which already lists REQ-NF-019
as "Inspection/Analysis — no SYS test").

---

## Blocks-implementation assessment

Only Finding 1 blocks: a core, task-named trace artifact (`trace.md`) actively contradicts
the authoritative FMEA on 13 of 49 hazards, and the contradiction was a mandated-but-undone
stabilization deliverable. Implementation/test authoring driven from `trace.md` Matrix H
would build the wrong hazard controls and tests. Findings 2–5 are integrity/consistency
defects in derived/summary tables that do not block a developer working from
`hazard-analysis.md` + `requirements.md` + `traceability-matrix.md` + `tasks.md`, but should
be fixed to keep the baseline clean.
