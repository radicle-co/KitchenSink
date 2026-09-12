# V-Model Peer Review: Meal Planning (006)

**Feature Branch**: `006-meal-planning`
**Review Date**: 2026-05-09 | **Re-reviewed**: 2026-08-02
**Reviewer**: AI Peer Review (speckit.v-model.peer-review)
**Artifacts Reviewed**: all ten `v-model/` artifacts, plus `spec.md`, `plan.md` and the `product-spec/` layer for
cross-artifact consistency
**Review Standard**: ISO 29119 / V-Model bidirectional traceability; INCOSE Guide for Writing Requirements;
`docs/engineering/ENGINEERING_EXCELLENCE.md`
**Finding ID Schema**: `PRF-006-{N}` — sequential, never renumbered

---

## Summary

| Severity    | Raised | Open  |
| ----------- | ------ | ----- |
| CRITICAL    | 0      | 0     |
| MAJOR       | 3      | **0** |
| MINOR       | 6      | **0** |
| OBSERVATION | 4      | —     |
| **Total**   | **13** | **0** |

**Overall Verdict**: ✅ **PASS — cleared to begin implementation (2026-08-02).**

All three MAJOR findings are closed by owner ruling on 2026-08-02:

| ID         | Resolution                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| PRF-006-11 | **Residual accepted** — plan span is not a concern; the 90-day maximum stands with no separate latency target. Residual recorded. |
| PRF-006-12 | **Premise invalid** — the same owner owns 006 **and** the recipe service. No cross-party gate exists.                             |
| PRF-006-13 | **Resolved** — the index rows are now `Deferred`, with status definitions, a deferral note and a new review rule.                 |

PRF-006-16 (endpoint path) is also closed: as owner of the recipe service, the path is settled on the platform's plain-
segment convention, **`POST /api/v1/recipes/nutrition-batch`**, and applied across all ten references.

**All six MINOR findings are also now closed** (2026-08-02). PRF-006-14 and -15 are resolved by actual enumeration
rather than deferred to implementation; PRF-006-17 is resolved by specifying retention and a mechanism; PRF-006-18 by
adding the missing scenarios. **Nothing is outstanding on this artifact set.**

> **Note on the previous review.** The May review recorded **3 CRITICAL and 7 WARNING** findings here, while all nine
> per-artifact reviews recorded **0 findings each**. That is not a credible outcome: nine independent reviews of
> documents that the consolidated review found three critical defects in cannot all be clean. Those nine files were
> rubber stamps and have been rewritten with real findings.

### Disposition of the May findings

| ID         | May severity | Status                                                                                                                   |
| ---------- | ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| PRF-006-1  | CRITICAL     | **RESOLVED** — `REQ-CN-003` is now a defined requirement (no cross-DB FK / no replicated state), consistently referenced |
| PRF-006-2  | CRITICAL     | **RESOLVED** — accessibility now has AT-006-H (5 scenarios) plus STP-010-B (6 scenarios)                                 |
| PRF-006-3  | CRITICAL     | **RESOLVED** — REQ-IF-005/006 are Test-verified with named scenarios; the contradiction is gone                          |
| PRF-006-4  | WARNING      | **RESOLVED** — the malformed double-comma requirement text was rewritten                                                 |
| PRF-006-5  | WARNING      | **RESOLVED** — REQ-009 restated as a testable single-round-trip contract                                                 |
| PRF-006-6  | WARNING      | **RESOLVED** — backward trace corrected                                                                                  |
| PRF-006-7  | WARNING      | **RESOLVED** — UTP-002-A covers 1-day, 90-day and 91-day boundaries; ATS-006-A4 covers the acceptance side               |
| PRF-006-8  | WARNING      | **RESOLVED** — ATS-006-C5, STS-PERF-A2 cover large plans, though see **PRF-006-11**                                      |
| PRF-006-9  | WARNING      | **SUPERSEDED** — the premium guard no longer exists                                                                      |
| PRF-006-10 | WARNING      | **RESOLVED** — REQ-011 is Demonstration with a defined timed-session procedure in ATS-006-G1                             |

---

## MAJOR Findings

### PRF-006-11 · MAJOR — The performance requirement does not cover the maximum supported plan size

**Artifacts**: `requirements.md` (REQ-NF-006, REQ-010), `system-test.md` (STS-PERF-A1/A2), `spec.md` (SC-006-003)

**Evidence**: `REQ-001` bounds a plan at **90 days**. `REQ-NF-006` and `SC-006-003` state the latency target for a
**30-day** plan. `REQ-010` requires a 90-day plan to have bounded fan-out but states **no latency target**. `STS-PERF-A2`
consequently asserts request-count at 90 days while reusing the 30-day p95 that no requirement extends to that size.

**Why it matters**: the system permits a plan three times larger than any performance requirement covers. A 90-day plan
taking 1.4 s would violate no stated requirement while plainly failing the user. This is the gap between "the maximum we
allow" and "the maximum we promised to be fast at".

**Recommendation**: either state a latency target at the maximum supported size (e.g. p95 ≤ 800 ms at 90 days) and test
it, or reduce the maximum span to the size actually performance-tested. Do not leave the two numbers unrelated.

**Disposition**: ✅ **CLOSED — RESIDUAL ACCEPTED BY OWNER (2026-08-02).** The owner's ruling is that plan span is not a
concern worth a separate performance target. The 90-day maximum stands and `REQ-NF-006`/`SC-006-003` continue to target
30 days.

**Recorded residual**: a 90-day plan has **no stated latency target**. `STS-PERF-A2` therefore asserts only the
_bounded-fan-out_ property at that size — which is the property that actually protects the design (it fails if an N+1
regresses) — and does **not** assert a p95. Accepted knowingly: the bounded-fan-out guarantee means a 90-day read is
one database query plus one chunked gateway call, so its cost scales with distinct recipes rather than with entries, and
the realistic worst case sits close to the 30-day figure. If plan sizes near the maximum become common in production,
revisit via `MET-006-020`.

---

### PRF-006-12 · MAJOR — A requirement here obliges another feature's package, with no acceptance on that side

**Artifacts**: `requirements.md` (REQ-IF-008), `plan.md` (Cross-feature dependency), `integration-test.md` (ITP-015-C)

**Evidence**: `REQ-IF-008` requires the **recipe service** to expose a batch nutrition projection. It was verified only
by consumer-driven contract scenarios living in 006's plan, with no obliging requirement on the provider side.

**Disposition**: ✅ **CLOSED — PREMISE INVALID (2026-08-02).** The finding assumed the recipe service is owned by a
different party whose acceptance is needed. It is not: **the same owner owns both 006 and the recipe service.** There is
no cross-party gate, and `cross-feature-FR-index.md` needs no `006 → 001` row, because that registry records references
between **specs**, not a change one owner makes to their own service.

**What remains true, and is retained**: T001–T003 modify a **shipped, deployed** service. That is a sequencing and
blast-radius fact regardless of ownership, so the safeguards stay — the change is strictly additive (no existing route
altered), it is covered by consumer-driven contract tests that fail in the recipe service's own CI (ITS-015-C4), and it
must land before 006's nutrition tasks. It is now an ordinary internal prerequisite rather than a gate.

---

### PRF-006-13 · MAJOR — The cross-feature FR index still marks deferred requirements as Active

**Artifacts**: [`cross-feature-FR-index.md`](../../cross-feature-FR-index.md), `spec.md` (C-006-009)

**Evidence**: the index registered three references from `010-subscriptions` to `006-FR-025`, `006-FR-026` and
`006-FR-027` ("Premium entitlement gates …"), each with Status **Active**. All three are now **Phase 2, deferred**.

**Why it mattered**: the index is the authoritative cross-feature registry. Three `Active` rows against deferred
requirements read to 010's planning as live commitments — and the circularity (006 waits on 010's entitlement while
010's index says 006 gates on it) was invisible from either side.

**Disposition**: ✅ **RESOLVED (2026-08-02).** Applied to `specs/cross-feature-FR-index.md`:

1. The three rows now read **`Deferred`**.
2. A **Status Values** section defines `Active` vs. `Deferred`, which the registry previously left implicit — every row
   said `Active`, so the column carried no information.
3. A **Deferral Notes** entry records the reason, points at C-006-009, and states the mutual dependency explicitly:
   whichever of 006 or 010 is planned first must resolve the entitlement mechanism rather than assume the other side
   has.
4. **Review Rule 5** added, so a future deferral flips its rows in the same change set instead of leaving a stale
   `Active`. This is the durable fix — the other three are one-off corrections.

---

## MINOR Findings

### PRF-006-14 · MINOR — Scenario counts are derived, not enumerated · ✅ RESOLVED

**Artifacts**: `unit-test.md`, `integration-test.md`, `system-test.md`, `traceability-matrix.md`, `trace.md`

Several tables abbreviated scenario ranges, so the headline totals were internally consistent but never verified
id-by-id.

**Disposition (2026-08-02)**: **resolved by enumerating every id**, not by deferring to implementation. Each document's
scenario ids were extracted and de-duplicated. Every published figure was wrong:

| Tier        | Published | Actual               |
| ----------- | --------- | -------------------- |
| Unit        | 47 / 168  | **50 UTP / 162 UTS** |
| Integration | 18 / 63   | **18 ITP / 72 ITS**  |
| System      | 14 / 57   | **16 STP / 71 STS**  |
| Acceptance  | 9 / 53    | **9 AT / 52 ATS**    |
| **Total**   | 341       | **357**              |

No dangling references: every id cited in a coverage table is defined in its document body. Corrected across all eight
documents that carried a derived figure. The release audit additionally **double-counted 19 tests** by listing
Playwright/Maestro/k6 as separate rows on top of the System total that already contains them (423 → **438** once the
component matrix is corrected too).

### PRF-006-15 · MINOR — The component-state matrix split is unverified arithmetic

**Artifact**: `system-test.md` (STP-010-A)

The 12 × 7 matrix was stated to total **63 tests (34 web, 29 mobile)**, with `(both)` columns making the split ambiguous
and the arithmetic never recomputed.

**Disposition**: ✅ **RESOLVED (2026-08-02) — recounted cell-by-cell.** The matrix has **50 ticked cells**; each of the
five `(both)` columns is **two** tests (one per platform), the web-only and mobile-only columns one each. The true total
is **81 component tests — 40 web, 41 mobile**, not 63/34/29. SC-006-004's denominator is corrected accordingly.

The published figure was low by 29%, which matters: SC-006-004 requires 100% of these passing, so a coverage percentage
computed against the wrong denominator would have read as complete while 18 tests were missing.

### PRF-006-16 · MINOR — The batch endpoint path uses a style absent from the platform

**Artifacts**: `plan.md`, `requirements.md` (REQ-IF-008)

As originally specified, the path was `POST /api/v1/recipes/nutrition:batch` — a colon action suffix. Every shipped route
uses plain segments (`/api/v1/recipes/{id}/clone`, `/api/v1/foods/search`, `/api/v1/recipes/{id}/visibility`).

**Disposition**: ✅ **RESOLVED (2026-08-02).** Settled by the recipe service's owner on the platform convention:
**`POST /api/v1/recipes/nutrition-batch`**. Applied across all ten references (plan, requirements, architecture, module
design, system design, integration test, user journey, tasks). A URL is a wire contract and this one has no clients
yet, so it was the cheapest possible moment to fix it.

### PRF-006-17 · MINOR — Idempotency-key retention is unspecified · ✅ RESOLVED

**Artifacts**: `plan.md` (data model), `module-design.md` (MOD-016), `spec.md` (FR-032), `requirements.md` (REQ-015)

`meal_plan_idempotency_keys` grew without bound. The design said rows were "pruned by age; the pruning is a scheduled DB
task, not a worker Lambda" — but named no retention period, no schedule and no mechanism, and no test covered pruning.

**Disposition**: ✅ **RESOLVED (2026-08-02) — concrete mechanism specified.** Retention is **24 hours**. Pruning is
**opportunistic and bounded**: a `LIMIT 50`, owner-scoped `DELETE` inside the same transaction as each idempotency
write.

That shape was chosen because the obvious answers do not fit this platform. `pg_cron` is not enabled, and every other
scheduled task here is an EventBridge rule driving a Lambda or ECS task — which **REQ-NF-009 forbids for this feature**.
Opportunistic pruning needs no infrastructure, is self-limiting (the table only accumulates while it is being written
to, which is exactly when the prune runs), and is capped so one owner's backlog cannot slow an unrelated request. The
interaction with REQ-020 is now stated explicitly: erasure deletes a user's keys immediately regardless of age, so
retention can never hold data past an erasure.

Covered by UTS-016-C1/C2 and ITS-012-B5..B8; FR-032 and REQ-015 now carry the retention window.

### PRF-006-18 · MINOR — GDPR erasure has thin acceptance coverage for its severity · ✅ RESOLVED

**Artifacts**: `acceptance-plan.md` (AT-006-I), `requirements.md` (REQ-020), `hazard-analysis.md` (HAZ-040)

`REQ-020` carries a Critical hazard (HAZ-040, a right-to-erasure violation) but had one acceptance scenario, web-only.

**Disposition (2026-08-02)**: **resolved.** Added **ATS-006-I2** (mobile erasure entry point reaching the _same_
mechanism, not a second one — the parity risk the single web scenario could not catch) and **ATS-006-I3** (a
re-driven partial erasure completes). AT-006-I now has three scenarios across both platforms, and T038 is tagged
`[BOTH]` for its entry points.

### PRF-006-19 · MINOR — A hazard-id collision was found and fixed during this review

**Artifact**: `hazard-analysis.md`

The SYS-009 row was authored as `HAZ-034b · HAZ-037`, duplicating `HAZ-034` (already allocated to the socket-leak hazard
under SYS-007) and violating the document's own uniqueness rule. `HAZ-014`'s cross-reference pointed at `HAZ-034`
instead of `HAZ-037`, and `HAZ-007` was marked "re-scoped — see HAZ-030", where HAZ-030 concerns idempotency
transactions, not slot mapping.

**Disposition**: **RESOLVED** — the id is now `HAZ-037`, the cross-reference is corrected, `HAZ-007` is restated as an
active hazard with its own mitigation, and a uniqueness check over all `HAZ-` ids passes.

---

## OBSERVATIONS

### PRF-006-20 · OBSERVATION — Removing components removed hazards

Four hazards (HAZ-009, HAZ-010, HAZ-016, HAZ-018) are eliminated outright because the cache, the stored rollup,
recurrence and the ingredient manifest no longer exist. This is the strongest available argument for the reconciled
design and should be carried into the release audit rather than left in the FMEA.

### PRF-006-21 · OBSERVATION — The cost estimate is by analogy, not measurement

`plan.md` estimates ≈ $8/mo per open PR preview by analogy with the food service's measured figure. This service's task
sizing is not yet set. Given ADR-0008's account budget is a real constraint, re-derive once the task definition exists.

### PRF-006-22 · OBSERVATION — Phase-2 deferral creates a mutual block

006 waits on 010 for entitlement; 010's index references 006 as a gated consumer. Neither document is wrong, but the
circularity should be surfaced to whoever plans either feature next. See PRF-006-13.

### PRF-006-23 · OBSERVATION — Degraded-state coverage is unusually strong

Six acceptance scenarios (AT-006-D), seven gateway fault-injection scenarios and a degraded k6 profile cover behaviour
under dependency failure — most specs at this stage cover only the happy path. These are the first tests dropped under
schedule pressure and the ones protecting against confidently-wrong nutrition (HAZ-032). Preserve them.

---

## Per-Artifact Verdicts

| Artifact                 | Findings                        | Verdict |
| ------------------------ | ------------------------------- | ------- |
| Artifact                 | Findings                        | Verdict |
| ------------------------ | ------------------------------- | ------- |
| `requirements.md`        | PRF-006-11, -12 — closed        | ✅ Pass |
| `system-design.md`       | —                               | ✅ Pass |
| `architecture-design.md` | PRF-006-16 — resolved           | ✅ Pass |
| `module-design.md`       | PRF-006-17 — resolved           | ✅ Pass |
| `hazard-analysis.md`     | PRF-006-19 — resolved; -20      | ✅ Pass |
| `unit-test.md`           | PRF-006-14 — resolved           | ✅ Pass |
| `integration-test.md`    | PRF-006-14 — resolved           | ✅ Pass |
| `system-test.md`         | PRF-006-11, -14, -15 — resolved | ✅ Pass |
| `acceptance-plan.md`     | PRF-006-18 — resolved           | ✅ Pass |
| `traceability-matrix.md` | PRF-006-14 — resolved           | ✅ Pass |
| `trace.md`               | —                               | ✅ Pass |

---

## Required Actions Summary

| PRF-ID     | Severity | Action                                                                           | Owner    | When            |
| ---------- | -------- | -------------------------------------------------------------------------------- | -------- | --------------- |
| PRF-006-11 | MAJOR    | ✅ Closed — residual accepted; 90-day span stands                                | Owner    | Done 2026-08-02 |
| PRF-006-12 | MAJOR    | ✅ Closed — premise invalid; same owner owns both                                | Owner    | Done 2026-08-02 |
| PRF-006-13 | MAJOR    | ✅ Resolved — index rows `Deferred` + rule 5 added                               | Owner    | Done 2026-08-02 |
| PRF-006-16 | MINOR    | ✅ Resolved — path settled on `/nutrition-batch`                                 | Owner    | Done 2026-08-02 |
| PRF-006-19 | MINOR    | ✅ Resolved during review — hazard-id collision                                  | —        | Done            |
| PRF-006-14 | MINOR    | ✅ Resolved — every id enumerated; 341 → 357, and a 19-test double-count removed | Reviewer | Done 2026-08-02 |
| PRF-006-15 | MINOR    | ✅ Resolved — matrix recounted; 63 → **81** (40 web, 41 mobile)                  | Reviewer | Done 2026-08-02 |
| PRF-006-17 | MINOR    | ✅ Resolved — 24 h retention, bounded owner-scoped opportunistic prune           | Reviewer | Done 2026-08-02 |
| PRF-006-18 | MINOR    | ✅ Resolved — ATS-006-I2 (mobile) and I3 (re-drive) added                        | Reviewer | Done 2026-08-02 |

**Every finding on this artifact set is closed. Nothing gates the start of implementation, and nothing is deferred into
it.**
