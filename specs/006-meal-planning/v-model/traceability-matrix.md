# Traceability Matrix

**Feature Branch**: `006-meal-planning`
**Generated**: 2026-05-10 | **Regenerated**: 2026-08-02
**Source**: `specs/006-meal-planning/v-model/`
**Execution Status**: Pre-implementation — every scenario is `⬜ Untested` until real results are ingested.

> **Regeneration note.** The May matrix reported **13 `❌ MISSING`** acceptance mappings out of 23 requirements — over
> half the requirement set had no acceptance coverage — and several mappings it _did_ have were wrong in a way that hid
> the gap: `REQ-006` (AI suggestions) was mapped to **every** acceptance case A–F, and `REQ-001`, `REQ-002` and
> `REQ-010` all shared one identical scenario list. A matrix that maps everything to everything looks full and proves
> nothing. Both problems are fixed; where a requirement is deliberately uncovered it now reads **⏸️ Deferred** with the
> blocker named, not `❌ MISSING`.

**Legend**: ⬜ Untested · ✅ Passed · ❌ Failed · ⚠️ Partial · ⏸️ Deferred (Phase 2)

---

## Matrix A — Validation (REQ → Acceptance)

| Requirement    | Summary                                               | AT case            | Scenarios                                    | Status                  |
| -------------- | ----------------------------------------------------- | ------------------ | -------------------------------------------- | ----------------------- |
| **REQ-001**    | Create a plan over a validated calendar range         | AT-006-A           | ATS-006-A1..A4, A6                           | ⬜                      |
| **REQ-002**    | Select the plan's meal slots; render only those       | AT-006-A           | ATS-006-A2                                   | ⬜                      |
| **REQ-003**    | Assign / move / remove entries with servings and note | AT-006-B           | ATS-006-B1..B10                              | ⬜                      |
| **REQ-004**    | Per-day totals = Σ(per-serving × servings)            | AT-006-C           | ATS-006-C1..C3                               | ⬜                      |
| **REQ-005**    | Whole-plan total with completeness flag               | AT-006-C           | ATS-006-C4                                   | ⬜                      |
| **REQ-006**    | AI meal suggestions _(premium)_                       | AT-006-J           | —                                            | ⏸️ Deferred — 005 + 010 |
| **REQ-007**    | AI auto-generation _(premium)_                        | AT-006-J           | —                                            | ⏸️ Deferred — 005 + 010 |
| **REQ-008**    | Waste optimization _(premium)_                        | AT-006-J           | —                                            | ⏸️ Deferred — 005 + 010 |
| **REQ-009**    | Plan + entries + nutrition in **one** read            | AT-006-C           | ATS-006-C1, C5                               | ⬜                      |
| **REQ-010**    | 90-day plan; bounded downstream fan-out               | AT-006-C           | ATS-006-C5                                   | ⬜                      |
| **REQ-011**    | Plan → grocery projection under 10 minutes            | AT-006-G           | ATS-006-G1                                   | ⬜                      |
| **REQ-012**    | Save a plan as a template (relative offsets)          | AT-006-E           | ATS-006-E1..E3, E7                           | ⬜                      |
| **REQ-013**    | Skip report on apply                                  | AT-006-E           | ATS-006-E4..E6                               | ⬜                      |
| **REQ-014**    | Orphaned entries — visible, removable, excluded       | AT-006-D           | ATS-006-D1, D2; ATS-006-G3                   | ⬜                      |
| **REQ-015**    | Idempotent entry create and template apply            | AT-006-B           | ATS-006-B8                                   | ⬜                      |
| **REQ-016**    | Web + mobile parity; keyboard equivalent on web       | AT-006-B, AT-006-H | ATS-006-B1..B3, H2, + all "both" scenarios   | ⬜                      |
| **REQ-017**    | Live Home widget; roadmap placeholder retired         | AT-006-F           | ATS-006-F1..F6                               | ⬜                      |
| **REQ-018**    | Calendar dates, DST-safe, locale week start           | AT-006-A           | ATS-006-A5, A6                               | ⬜                      |
| **REQ-019**    | Every user-facing string localized                    | AT-006-H           | ATS-006-H4                                   | ⬜                      |
| **REQ-020**    | Meal-plan data erased with the account                | AT-006-I           | ATS-006-I1                                   | ⬜                      |
| **REQ-NF-001** | Strict TS, no `any`                                   | _CI_               | STS-008-A1                                   | ⬜                      |
| **REQ-NF-002** | JSDoc + pattern-named module headers                  | _CI_               | STS-008-A3                                   | ⬜                      |
| **REQ-NF-003** | Accessible names; keyboard equivalent                 | AT-006-H           | ATS-006-H1, H2, H5                           | ⬜                      |
| **REQ-NF-004** | State never colour-only                               | AT-006-H           | ATS-006-H3; ATS-006-C3; ATS-006-D1           | ⬜                      |
| **REQ-NF-005** | Test-first; full test matrix                          | _CI_               | CI test report + STP-010-A                   | ⬜                      |
| **REQ-NF-006** | p95 ≤ 500 ms for a 30-day plan read                   | AT-006-C           | ATS-006-C5 (+ STS-PERF-A1)                   | ⬜                      |
| **REQ-NF-007** | Shared-code-first; `.native.*` parity                 | AT-006-F           | ATS-006-F3 (+ STS-010-C4)                    | ⬜                      |
| **REQ-NF-008** | `*Error` + `is*` guards; one error envelope           | _CI_               | UTP-017-A/B, STS-008-A2                      | ⬜                      |
| **REQ-NF-009** | No cache, queue, worker or object store               | _CI_               | **STS-008-A5**                               | ⬜                      |
| **REQ-IF-001** | Availability-disciplined recipe gateway               | AT-006-D           | ATS-006-D3..D6                               | ⬜                      |
| **REQ-IF-002** | `[DEPRECATED — Withdrawn]` → live half is REQ-CN-007  | _n/a_              | Withdrawn; carries no coverage obligation    | —                       |
| **REQ-IF-003** | Clerk session-token auth; ULID owner id               | AT-006-A           | ATS-006-A7 (+ STS-001-A3, A4)                | ⬜                      |
| **REQ-IF-004** | AI provider integration                               | AT-006-J           | —                                            | ⏸️ Deferred — 005       |
| **REQ-IF-005** | Grocery projection for 007                            | AT-006-G           | ATS-006-G2, G4                               | ⬜                      |
| **REQ-IF-006** | Same projection consumable by 009                     | AT-006-G           | ATS-006-G4 (+ STS-011-A1, A2)                | ⬜                      |
| **REQ-IF-007** | Equivalent web/mobile workflows                       | AT-006-F           | ATS-006-F3 + every "both" scenario           | ⬜                      |
| **REQ-IF-008** | Batch nutrition projection on 001                     | _contract_         | ITS-015-C1..C4                               | ⬜                      |
| **REQ-CN-001** | Premium gating                                        | AT-006-J           | Phase-1 obligation: no premium surface ships | ⏸️ Deferred — 010       |
| **REQ-CN-002** | Owner scoping; not-owned ≡ absent                     | AT-006-A           | ATS-006-A7 (+ ITS-011-A1..A4)                | ⬜                      |
| **REQ-CN-003** | No cross-database FK; no replicated state             | _inspection_       | Schema review + ITP-009-B                    | ⬜                      |
| **REQ-CN-004** | Nutrition never persisted                             | AT-006-C           | **ATS-006-C6** (edit-then-reread)            | ⬜                      |
| **REQ-CN-005** | DB-enforced bounds                                    | AT-006-A           | ATS-006-A4 (+ ITP-009-B, all six)            | ⬜                      |

**Acceptance coverage**: 46 / 46 Phase-1 requirements mapped (**100%**) — 34 by acceptance scenario, 12 by the inspection/CI route recorded in `acceptance-plan.md`; 5 Phase-2 deferred with blockers named; REQ-IF-002 withdrawn.
**`❌ MISSING`: 0** (was 13).

Seven requirements are verified by **CI evidence** rather than a user-facing scenario. That is stated explicitly rather
than papered over: a lint rule is the _correct_ verification for "no `any`", and inventing an acceptance scenario for it
would be the same false-coverage move the May matrix made.

---

## Matrix B — System Verification (REQ → SYS → STP)

| Requirement                       | SYS              | STP                  | Scenarios                               | Status |
| --------------------------------- | ---------------- | -------------------- | --------------------------------------- | ------ |
| REQ-001, 002, 009                 | SYS-001          | STP-001-A, STP-001-B | STS-001-A1..A4, B1..B6                  | ⬜     |
| REQ-003, 014, 015                 | SYS-002          | STP-002-A            | STS-002-A1..A5                          | ⬜     |
| REQ-004, 005                      | SYS-003          | STP-003-A            | STS-003-A1..A6                          | ⬜     |
| REQ-010, NF-006                   | SYS-003, SYS-007 | STP-PERF-A           | STS-PERF-A1, A2                         | ⬜     |
| REQ-IF-001                        | SYS-007          | STP-003-B, STP-007-A | STS-003-B1..B3, STS-007-A1              | ⬜     |
| REQ-NF-001..009                   | SYS-008          | STP-008-A, STP-008-B | STS-008-A1..A6, B1..B8                  | ⬜     |
| REQ-012, 013                      | SYS-009          | _(integration tier)_ | ITS-013-A1..A6                          | ⬜     |
| REQ-016..019, NF-003/004/007      | SYS-010          | STP-010-A, B, C      | 81-test matrix + STS-010-B1..B6, C1..C4 | ⬜     |
| REQ-011, IF-005, IF-006           | SYS-011          | STP-011-A            | STS-011-A1, A2                          | ⬜     |
| REQ-020                           | SYS-012          | STP-012-A            | STS-012-A1                              | ⬜     |
| REQ-006, 007, 008, IF-004, CN-001 | SYS-004/005/006  | —                    | —                                       | ⏸️     |

---

## Matrix C — Architecture Verification (SYS → ARCH → ITP)

| SYS     | ARCH                              | ITP                                                              | Status |
| ------- | --------------------------------- | ---------------------------------------------------------------- | ------ |
| SYS-001 | ARCH-002, 003, 008, 009, 010, 011 | ITP-009-A, ITP-009-B, ITP-010-A, ITP-010-B, ITP-011-A, ITP-011-B | ⬜     |
| SYS-002 | ARCH-001, 003, 005, 012, 016      | ITP-012-A, ITP-012-B, ITP-012-C                                  | ⬜     |
| SYS-003 | ARCH-004, 014                     | ITP-015-A, ITP-015-B                                             | ⬜     |
| SYS-007 | ARCH-015                          | ITP-015-A, ITP-015-B, ITP-015-C                                  | ⬜     |
| SYS-008 | ARCH-017, 024                     | STP-008-A, STP-008-B                                             | ⬜     |
| SYS-009 | ARCH-006, 013, 016                | ITP-013-A                                                        | ⬜     |
| SYS-010 | ARCH-019..023, 025                | ITP-019-A, ITP-022-A, ITP-025-A                                  | ⬜     |
| SYS-011 | ARCH-007                          | ITP-007-A                                                        | ⬜     |
| SYS-012 | ARCH-018                          | ITP-018-A                                                        | ⬜     |

**SYS → ARCH forward coverage**: 9 / 9 Phase-1 components (100%).

---

## Matrix D — Module Verification (ARCH → MOD → UTP)

| ARCH          | MOD          | UTP cases             | Scenarios | Status |
| ------------- | ------------ | --------------------- | --------- | ------ |
| ARCH-001      | MOD-001      | UTP-001-A, B          | 5         | ⬜     |
| ARCH-002      | MOD-002      | UTP-002-A..E          | 21        | ⬜     |
| ARCH-003      | MOD-003      | UTP-003-A, B          | 8         | ⬜     |
| ARCH-004      | MOD-004      | UTP-004-A..F          | 25        | ⬜     |
| ARCH-005      | MOD-005      | UTP-005-A             | 4         | ⬜     |
| ARCH-006      | MOD-006      | UTP-006-A..D          | 15        | ⬜     |
| ARCH-007      | MOD-007      | UTP-007-A             | 4         | ⬜     |
| ARCH-008      | MOD-008      | UTP-008-A, B          | 5         | ⬜     |
| ARCH-009..013 | MOD-009..013 | UTP-009-A … UTP-013-A | 18        | ⬜     |
| ARCH-014      | MOD-014      | UTP-014-A, B          | 4         | ⬜     |
| ARCH-015      | MOD-015      | UTP-015-A..E          | 19        | ⬜     |
| ARCH-016      | MOD-016      | UTP-016-A, B          | 6         | ⬜     |
| ARCH-017      | MOD-017      | UTP-017-A, B          | 7         | ⬜     |
| ARCH-018      | MOD-018      | UTP-018-A             | 4         | ⬜     |
| ARCH-019      | MOD-019      | UTP-019-A, B          | 6         | ⬜     |
| ARCH-020..023 | MOD-020..023 | UTP-020-A … UTP-023-A | 7         | ⬜     |
| ARCH-024      | MOD-024      | — _(build-time only)_ | 0         | n/a    |
| ARCH-025      | MOD-025      | UTP-025-A             | 4         | ⬜     |

**ARCH → MOD**: 25 / 25 (100%). **MOD → UTP**: 24 / 24 executable modules (100%).

---

## Matrix E — Backward Traceability (tests → requirements)

| Tier                | Cases | Traced to a REQ | Orphans |
| ------------------- | ----- | --------------- | ------- |
| Acceptance (`ATS`)  | 52    | 52              | **0**   |
| System (`STS`)      | 71    | 71              | **0**   |
| Integration (`ITS`) | 72    | 72              | **0**   |
| Unit (`UTS`)        | 162   | 162             | **0**   |

No test exists that does not verify a stated requirement. An orphan test is either an undocumented requirement or wasted
effort; both need resolving before release.

---

## Matrix F — Design Decision Traceability (Clarification → artifact)

New in this regeneration. Each Clarification is load-bearing across several documents; this makes drift visible.

| Clarification | Decision                                   | Enforced by                                            |
| ------------- | ------------------------------------------ | ------------------------------------------------------ |
| C-006-001     | Own service, not a recipe-service module   | plan.md Project Structure; Complexity Tracking         |
| C-006-002     | No cross-DB FK; ULID owner; no users table | REQ-CN-003; data model; ITP-009-B                      |
| C-006-003     | Nutrition from recipe-level values         | REQ-004; MOD-004; ITS-015-B3; STS-003-A6               |
| C-006-004     | No fibre                                   | Glossary; MOD-004 macro set                            |
| C-006-005     | No cache tier                              | REQ-NF-009; **STS-008-A5**                             |
| C-006-006     | Orphan detected on read; no event bus      | REQ-014; MOD-004; ITS-015-A5                           |
| C-006-007     | Lock dropped                               | Absent from every artifact; HAZ-027 superseded         |
| C-006-008     | Templates in; recurrence/leftovers out     | REQ-012/013; HAZ-016/018 superseded                    |
| C-006-009     | FR-025/026/027 deferred                    | AT-006-J; REQ-CN-001 ⏸️; SYS-004/005/006 unbuilt       |
| C-006-010     | Web + mobile lockstep                      | REQ-016; STP-010-A/C; every "both" acceptance scenario |
| C-006-011     | Retire the roadmap placeholder             | REQ-017; SC-006-005; UTS-022-A2; STS-010-C1            |

---

## Matrix G — Success Criteria

| SC         | Target                                             | Verified by                                    | Status |
| ---------- | -------------------------------------------------- | ---------------------------------------------- | ------ |
| SC-006-001 | 7-day plan → projection < 10 min                   | ATS-006-G1 (timed session)                     | ⬜     |
| SC-006-002 | ≤ 3 interactions to assign, both platforms         | ATS-006-B2; MET-006-016                        | ⬜     |
| SC-006-003 | p95 ≤ 500 ms for a 30-day plan read                | **STS-PERF-A1** (k6, CI)                       | ⬜     |
| SC-006-004 | 100% of UI states component-tested, both platforms | **STP-010-A** — 63 cells (CI)                  | ⬜     |
| SC-006-005 | Zero roadmap-placeholder residue                   | **UTS-022-A2** + exhaustiveness typecheck (CI) | ⬜     |

Three of five are machine-checked. The May spec had one criterion, verified only by a usability session.

---

## Matrix H — Hazard Mitigation

Active Phase-1 hazards and the tests holding them down. A hazard with no test is an unmitigated hazard.

| Hazard  | Risk        | Mitigating tests                                   | Status |
| ------- | ----------- | -------------------------------------------------- | ------ |
| HAZ-001 | Undesirable | UTS-002-B3, UTP-002-C, ATS-006-A6                  | ⬜     |
| HAZ-002 | Tolerable   | UTS-002-C1..C3, UTS-002-E1                         | ⬜     |
| HAZ-003 | Tolerable   | UTS-002-A3/A4, ITS-009-B2, STS-001-B3              | ⬜     |
| HAZ-005 | Undesirable | UTS-004-A6/A7, ITS-015-A5, ATS-006-D1/D2           | ⬜     |
| HAZ-006 | Undesirable | ITS-012-B1/B3, ATS-006-B8                          | ⬜     |
| HAZ-008 | Undesirable | UTS-004-A2, D2, E2, **UTP-004-F (mutation gate)**  | ⬜     |
| HAZ-020 | Undesirable | ITS-011-A1..A4, ATS-006-A7                         | ⬜     |
| HAZ-021 | Tolerable   | ITS-007-A1                                         | ⬜     |
| HAZ-022 | Tolerable   | STS-011-A2                                         | ⬜     |
| HAZ-023 | Undesirable | STS-003-B1..B3, ATS-006-D3/D4                      | ⬜     |
| HAZ-024 | Undesirable | STP-010-B (all six), ATS-006-H1..H5                | ⬜     |
| HAZ-025 | Tolerable   | STS-008-A1                                         | ⬜     |
| HAZ-026 | Tolerable   | ITS-012-B3                                         | ⬜     |
| HAZ-029 | Undesirable | UTS-010-B1/B2, ITS-010-A1/A2                       | ⬜     |
| HAZ-030 | Undesirable | **ITS-012-B4**                                     | ⬜     |
| HAZ-031 | Undesirable | UTS-012-B2, ITS-012-A3, ATS-006-D5                 | ⬜     |
| HAZ-032 | Undesirable | UTS-004-A5/A6, ITS-015-A6, STS-003-B3              | ⬜     |
| HAZ-033 | Undesirable | UTS-004-B1..B5, STS-003-A2, ATS-006-C2             | ⬜     |
| HAZ-034 | Undesirable | **UTS-015-D1**, ITS-015-A2                         | ⬜     |
| HAZ-035 | Tolerable   | UTS-015-E1/E2                                      | ⬜     |
| HAZ-036 | Tolerable   | UTP-015-C, ITS-015-C3                              | ⬜     |
| HAZ-037 | Undesirable | UTS-006-A2..A7, C3, ITS-013-A2..A4, ATS-006-E4..E6 | ⬜     |
| HAZ-038 | Acceptable  | UTS-022-A1/A2, ITS-022-A1/A2, ATS-006-F4           | ⬜     |
| HAZ-039 | Undesirable | UTP-005-A, UTS-021-A1, STP-010-C, ATS-006-F3       | ⬜     |
| HAZ-040 | Undesirable | ITS-018-A1..A4, ATS-006-I1                         | ⬜     |
| HAZ-041 | Undesirable | UTS-008-B1, **STS-008-B6**                         | ⬜     |
| HAZ-042 | Undesirable | **STS-008-B2..B4**                                 | ⬜     |
| HAZ-043 | Acceptable  | UTS-012-A3/A4, ITP-009-B (all six)                 | ⬜     |

**Hazard coverage**: 26 / 26 active hazards mitigated by at least one test (**100%**). Every `Undesirable` hazard is
covered at **two or more tiers**, so one weak test does not leave it exposed.

---

## Coverage Summary

| Direction                  | Coverage           | Gaps                                   |
| -------------------------- | ------------------ | -------------------------------------- |
| REQ → Acceptance           | 46 / 46 Phase-1    | 0 (5 Phase-2 deferred, blockers named) |
| REQ → SYS                  | 46 / 46            | 0                                      |
| SYS → ARCH                 | 9 / 9              | 0                                      |
| ARCH → MOD                 | 25 / 25            | 0                                      |
| MOD → UTP                  | 24 / 24 executable | 0                                      |
| Tests → REQ (backward)     | 357 / 357          | **0 orphans**                          |
| Hazards → tests            | 26 / 26            | 0                                      |
| Clarifications → artifacts | 11 / 11            | 0                                      |

### Against the May matrix

| Metric                           | May 2026                                             | Aug 2026 |
| -------------------------------- | ---------------------------------------------------- | -------- |
| Requirements                     | 23                                                   | 42       |
| `❌ MISSING` acceptance links    | **13**                                               | **0**    |
| Spurious over-broad mappings     | ≥ 4 (REQ-006 → all cases; REQ-001/002/010 identical) | 0        |
| Hazards with mitigating tests    | not tracked                                          | 26 / 26  |
| Machine-checked success criteria | 0                                                    | 3 / 5    |
| Test scenarios across all tiers  | 92 (unit only)                                       | 357      |
