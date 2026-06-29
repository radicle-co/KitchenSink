# Traceability Matrix

**Generated**: 2026-05-10
**Re-baselined**: 2026-06-22 — source-agnostic food data model
**Source**: `specs/003-usda-food-data/v-model/`
**Execution Status**: Pre-implementation — mapped scenarios remain `⬜ Untested` until real test-result ingestion.

> **Re-baseline note (2026-06-22).** This integrative artifact — the V-Model V&V chain stitched
> end-to-end (FR → REQ → SYS → ARCH → MOD → UTP/ITP/STP/ATP, plus HAZ → mitigation → verification) —
> was fully regenerated against the re-baselined upstream artifacts (`spec.md` 2026-06-21;
> `requirements.md`, `system-design.md`, `architecture-design.md`, `module-design.md`, the four test
> plans, and `hazard-analysis.md`, all re-baselined 2026-06-22 to the **source-agnostic** redesign).
> A food is keyed by an internal surrogate `id` (ULID); **USDA is one pluggable source adapter**; foods
> are assembled into a **cross-source golden record** with per-field provenance; users add foods **by
> name** through a `PENDING → (UNRESOLVED) → RESOLVED` lifecycle (terminal `NOT_FOUND` / `FAILED`).
>
> **What changed in this matrix.** Every per-layer matrix was rebuilt from the regenerated artifacts.
> New rows were added for all new elements: REQ-045..055 / REQ-IF-009..012 / REQ-CN-007 and the
> stabilization sub-IDs REQ-050a (survivor-count auto-resolve boundary), REQ-025a (UNRESOLVED
> candidate-set TTL), REQ-028a (legal lifecycle transition set) + the new non-functional REQ-NF-019
> (first-time NEW-food resolution rate, SC-014); the spec FR additions FR-MRG-5 / FR-025a / FR-028a / FR-043a / FR-043b;
> SYS-014..020; ARCH-013..019; MOD-015..021; HAZ-042..049 (incl. HAZ-048 candidate-set integrity and
> HAZ-049 stale candidate-set expiry); and the new tests (UTP-015..021 + UTP-014, ITP-013..019,
> STP-014..020, AT-046..055 / AT-048..052 + AT-005-B/008-B/049-B/050-B/051-B + AT-018-A, AT-MRG5-A/B/C,
> AT-025a-A/B). The canonical schema is **13 tables** (adds `food_candidates`).
> The preserved layers were re-keyed `fdcId → id` and generalized USDA-only → per-source. **`fdcId` is
> confined to the adapter-boundary rows only** (SYS-009/SYS-014, ARCH-008/ARCH-013, MOD-008/MOD-015,
> and the USDA-adapter test cases); it appears in no canonical REQ/SYS/ARCH/MOD or DTO row.
>
> **Auth trace slice — fully connected (preserved verbatim-in-intent):**
> REQ-035 / REQ-037a–d / REQ-038a–c / REQ-039 / REQ-040a–b / REQ-041 / REQ-042 / REQ-043 / REQ-044a–d /
> REQ-IF-007 / REQ-IF-008 → **SYS-013** → **ARCH-012** → **MOD-012 / MOD-013 / MOD-014** →
> UTP-012-A..J + UTP-014-A..E → ITP-012-A..H → STP-013-A..F (+ STP-005-G for FR-048 async provenance) →
> **ATP-008-A..I** → HAZ-036..041.

---

## ID inventory (final, post-re-baseline)

| Layer            | Range                                                                                        | Count                                          | New this re-baseline                                                                               |
| ---------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Spec FR          | FR-001..053 + FR-IDN-1..3 + FR-RES-1..3 + FR-MRG-1..5 + FR-ADP-1..3 + FR-025a/028a/043a/043b | 71                                             | FR-IDN/RES/MRG/ADP families, FR-043..053, + stabilization FR-MRG-5/FR-025a/FR-028a/FR-043a/FR-043b |
| REQ (functional) | REQ-001..055 (+ REQ-025a, REQ-028a, REQ-050a)                                                | 55 base / 63 incl. a–d + stabilization sub-IDs | REQ-045..055, REQ-025a, REQ-028a, REQ-050a                                                         |
| REQ-IF           | REQ-IF-001..012                                                                              | 12                                             | REQ-IF-009..012                                                                                    |
| REQ-NF           | REQ-NF-001..019                                                                              | 19                                             | REQ-NF-019 (SC-014 first-time NEW-food resolution rate)                                            |
| REQ-CN           | REQ-CN-001..007                                                                              | 7                                              | REQ-CN-007                                                                                         |
| SYS              | SYS-001..020                                                                                 | 20                                             | SYS-014..020                                                                                       |
| ARCH             | ARCH-001..019                                                                                | 19                                             | ARCH-013..019                                                                                      |
| MOD              | MOD-001..021                                                                                 | 21                                             | MOD-015..021                                                                                       |
| UTP              | 72 cases                                                                                     | 72                                             | UTP-014-A..E, UTP-015..021                                                                         |
| ITP              | 56 cases                                                                                     | 56                                             | ITP-013..019                                                                                       |
| STP              | 71 cases                                                                                     | 71                                             | STP-014..020                                                                                       |
| AT / ATP         | 58 cases (43 capability AT + ATP-008-A..I auth + 6 AT-NF)                                    | 58                                             | AT-046..055, AT-048..052, \*-B variants                                                            |
| ATS              | 74 scenarios                                                                                 | 74                                             | ATS-036..044 (auth), candidate/merge/provenance                                                    |
| HAZ              | HAZ-001..049                                                                                 | 49                                             | HAZ-042..049                                                                                       |

---

## Matrix Ø — Specification Anchor (FR → REQ)

Every spec FR anchors to ≥1 V-Model REQ. (`requirements.md` REQ rows cite their FR anchors; this is the
inverse view.) **Result: 71 / 71 FRs traced — no FR gap.** `fdcId` appears only at FR-023 / FR-IDN-2
(the USDA-adapter boundary).

| Spec FR      | Anchored REQ id(s)                                                                                                               | Status |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **FR-001**   | REQ-001                                                                                                                          | ✅     |
| **FR-002**   | REQ-002, REQ-IF-001                                                                                                              | ✅     |
| **FR-003**   | REQ-003, REQ-IF-002                                                                                                              | ✅     |
| **FR-004**   | REQ-004, REQ-IF-001                                                                                                              | ✅     |
| **FR-005**   | REQ-005, REQ-047, REQ-IF-009                                                                                                     | ✅     |
| **FR-006**   | REQ-006                                                                                                                          | ✅     |
| **FR-007**   | REQ-007, REQ-033, REQ-IF-002                                                                                                     | ✅     |
| **FR-008**   | REQ-008, REQ-IF-003                                                                                                              | ✅     |
| **FR-009**   | REQ-009                                                                                                                          | ✅     |
| **FR-010**   | REQ-010                                                                                                                          | ✅     |
| **FR-011**   | REQ-011, REQ-IF-005                                                                                                              | ✅     |
| **FR-012**   | REQ-012, REQ-IF-009                                                                                                              | ✅     |
| **FR-013**   | REQ-013, REQ-047                                                                                                                 | ✅     |
| **FR-014**   | REQ-014, REQ-039                                                                                                                 | ✅     |
| **FR-015**   | REQ-015                                                                                                                          | ✅     |
| **FR-016**   | REQ-016, REQ-018                                                                                                                 | ✅     |
| **FR-017**   | REQ-IF-005 (LISTEN/NOTIFY wake; enqueue per REQ-011/014)                                                                         | ✅     |
| **FR-018**   | REQ-017, REQ-019                                                                                                                 | ✅     |
| **FR-019**   | REQ-019, REQ-NF-012                                                                                                              | ✅     |
| **FR-020**   | REQ-020                                                                                                                          | ✅     |
| **FR-021**   | REQ-021                                                                                                                          | ✅     |
| **FR-022**   | REQ-022, REQ-CN-003                                                                                                              | ✅     |
| **FR-023**   | REQ-023, REQ-IF-004 _(fdcId boundary)_                                                                                           | ✅     |
| **FR-024**   | REQ-024                                                                                                                          | ✅     |
| **FR-025**   | REQ-025, REQ-018                                                                                                                 | ✅     |
| **FR-026**   | REQ-026                                                                                                                          | ✅     |
| **FR-027**   | REQ-027                                                                                                                          | ✅     |
| **FR-028**   | REQ-028, REQ-052                                                                                                                 | ✅     |
| **FR-029**   | REQ-029, REQ-052                                                                                                                 | ✅     |
| **FR-030**   | REQ-030                                                                                                                          | ✅     |
| **FR-031**   | REQ-031, REQ-053                                                                                                                 | ✅     |
| **FR-032**   | REQ-032, REQ-053                                                                                                                 | ✅     |
| **FR-033**   | REQ-033                                                                                                                          | ✅     |
| **FR-034**   | REQ-034, REQ-IF-005                                                                                                              | ✅     |
| **FR-035**   | REQ-035, REQ-037a, REQ-037d, REQ-IF-007                                                                                          | ✅     |
| **FR-036**   | REQ-037a, REQ-IF-007                                                                                                             | ✅     |
| **FR-037**   | REQ-037b                                                                                                                         | ✅     |
| **FR-038**   | REQ-037c, REQ-IF-008                                                                                                             | ✅     |
| **FR-039**   | REQ-038a, REQ-038b                                                                                                               | ✅     |
| **FR-040**   | REQ-037d                                                                                                                         | ✅     |
| **FR-041**   | REQ-043                                                                                                                          | ✅     |
| **FR-042**   | REQ-044c, REQ-IF-008                                                                                                             | ✅     |
| **FR-043**   | REQ-039                                                                                                                          | ✅     |
| **FR-044**   | REQ-014, REQ-039                                                                                                                 | ✅     |
| **FR-045**   | REQ-040a                                                                                                                         | ✅     |
| **FR-046**   | REQ-040b                                                                                                                         | ✅     |
| **FR-047**   | REQ-041, REQ-IF-008                                                                                                              | ✅     |
| **FR-048**   | REQ-042                                                                                                                          | ✅     |
| **FR-049**   | REQ-043                                                                                                                          | ✅     |
| **FR-050**   | REQ-035, REQ-043                                                                                                                 | ✅     |
| **FR-051**   | REQ-038c                                                                                                                         | ✅     |
| **FR-052**   | REQ-044a, REQ-044b                                                                                                               | ✅     |
| **FR-053**   | REQ-044d                                                                                                                         | ✅     |
| **FR-IDN-1** | REQ-045, REQ-CN-007                                                                                                              | ✅     |
| **FR-IDN-2** | REQ-046 _(fdcId → external_key boundary)_                                                                                        | ✅     |
| **FR-IDN-3** | REQ-045                                                                                                                          | ✅     |
| **FR-RES-1** | REQ-048, REQ-IF-010                                                                                                              | ✅     |
| **FR-RES-2** | REQ-049, REQ-IF-011                                                                                                              | ✅     |
| **FR-RES-3** | REQ-048                                                                                                                          | ✅     |
| **FR-MRG-1** | REQ-050                                                                                                                          | ✅     |
| **FR-MRG-2** | REQ-051                                                                                                                          | ✅     |
| **FR-MRG-3** | REQ-051                                                                                                                          | ✅     |
| **FR-MRG-4** | REQ-050, REQ-054                                                                                                                 | ✅     |
| **FR-ADP-1** | REQ-054, REQ-IF-012                                                                                                              | ✅     |
| **FR-ADP-2** | REQ-055, REQ-IF-012                                                                                                              | ✅     |
| **FR-ADP-3** | REQ-055                                                                                                                          | ✅     |
| **FR-MRG-5** | REQ-050a _(D-AUTORESOLVE: survivor-count boundary)_                                                                              | ✅     |
| **FR-025a**  | REQ-025a _(D-UNRESOLVED-TTL: candidate-set TTL)_                                                                                 | ✅     |
| **FR-028a**  | REQ-028a _(D-LIFECYCLE: legal transition set; new standalone sub-id, anchored alongside the lifecycle REQs REQ-002/003/016/025)_ | ✅     |
| **FR-043a**  | REQ-039 _(D-FAIRNESS: multi-requester demotion extension)_                                                                       | ✅     |
| **FR-043b**  | REQ-040b _(D-FAIRNESS: near-ceiling flood-shed extension)_                                                                       | ✅     |

**Coverage: 71 / 71 FR → ≥1 REQ (100%).** No spec FR is unanchored. The five stabilization FRs (FR-MRG-5,
FR-025a, FR-028a, FR-043a, FR-043b) anchor to REQ-050a / REQ-025a / REQ-028a / REQ-039 / REQ-040b
respectively; FR-043a/FR-043b are extensions that reuse existing REQ ids (REQ-039 / REQ-040b, no new REQ),
while FR-MRG-5, FR-025a, and FR-028a introduce the three stabilization sub-IDs REQ-050a, REQ-025a, and
REQ-028a. (Count: 66 re-baseline FRs —
FR-001..053 + FR-IDN-1..3 + FR-RES-1..3 + FR-MRG-1..4 + FR-ADP-1..3 — plus the 5 stabilization FRs = **71**;
the prior inventory's "65" undercounted the re-baseline set by one and is corrected here.)

---

## Matrix A — Validation (User View: REQ → Acceptance Test)

Every functional + interface REQ maps to ≥1 acceptance test (`AT-*` / `ATP-008-*`). NF/CN REQs are
verified by Inspection/Analysis/CI gate per their `Verification Method`; rows below mark those
`(method)` where no `AT` exists by design. Genuine acceptance gaps are flagged `⚠️ GAP`.

| Requirement ID                                    | Acceptance Test (AT/ATP)                                     | Scenario ID (ATS)                                | Status      |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------ | ----------- |
| **REQ-001**                                       | AT-001-A                                                     | ATS-001-A1, ATS-001-A2                           | ⬜ Untested |
| **REQ-002**                                       | AT-002-A                                                     | ATS-002-A1                                       | ⬜ Untested |
| **REQ-003**                                       | AT-003-A                                                     | ATS-003-A1, ATS-003-A2                           | ⬜ Untested |
| **REQ-004**                                       | AT-004-A                                                     | ATS-004-A1, ATS-004-A2, ATS-004-A3               | ⬜ Untested |
| **REQ-005**                                       | AT-005-A, AT-005-B                                           | ATS-005-A1, ATS-005-A2, ATS-005-B1               | ⬜ Untested |
| **REQ-006**                                       | AT-006-A                                                     | ATS-006-A1, ATS-006-A2, ATS-005-A2               | ⬜ Untested |
| **REQ-007**                                       | AT-007-A                                                     | ATS-007-A1, ATS-007-A2                           | ⬜ Untested |
| **REQ-008**                                       | AT-008-A, AT-008-B                                           | ATS-008-A1, ATS-008-A2, ATS-008-A3, ATS-008-B1   | ⬜ Untested |
| **REQ-009**                                       | AT-009-A                                                     | ATS-009-A1                                       | ⬜ Untested |
| **REQ-010**                                       | AT-010-A                                                     | ATS-010-A1                                       | ⬜ Untested |
| **REQ-011**                                       | ⚠️ GAP — no AT (STP-002-A/C only)                            | —                                                | ⬜ Untested |
| **REQ-012**                                       | AT-012-A                                                     | ATS-012-A1, ATS-012-A2                           | ⬜ Untested |
| **REQ-013**                                       | AT-005-B, AT-012-A                                           | ATS-005-B1, ATS-012-A2                           | ⬜ Untested |
| **REQ-014**                                       | AT-015-A                                                     | ATS-015-A1, ATS-015-A2, ATS-015-A3               | ⬜ Untested |
| **REQ-015**                                       | AT-015-A                                                     | ATS-015-A1, ATS-015-A2                           | ⬜ Untested |
| **REQ-016**                                       | AT-016-A, AT-027-A                                           | ATS-016-A1, ATS-027-A1                           | ⬜ Untested |
| **REQ-017**                                       | AT-018-A                                                     | ATS-018-A1                                       | ⬜ Untested |
| **REQ-018**                                       | ⚠️ GAP — no standalone AT (covered indirectly in ATS-025-A2) | —                                                | ⬜ Untested |
| **REQ-019**                                       | AT-019-A                                                     | ATS-019-A1                                       | ⬜ Untested |
| **REQ-020**                                       | AT-020-A                                                     | ATS-020-A1                                       | ⬜ Untested |
| **REQ-021**                                       | AT-021-A                                                     | ATS-021-A1                                       | ⬜ Untested |
| **REQ-022**                                       | (Inspection — REQ-CN-003)                                    | —                                                | ⬜ Untested |
| **REQ-023**                                       | AT-023-A                                                     | ATS-023-A1, ATS-023-A2                           | ⬜ Untested |
| **REQ-024**                                       | AT-024-A                                                     | ATS-024-A1                                       | ⬜ Untested |
| **REQ-025**                                       | AT-025-A                                                     | ATS-025-A1, ATS-025-A2                           | ⬜ Untested |
| **REQ-026**                                       | AT-026-A                                                     | ATS-026-A1                                       | ⬜ Untested |
| **REQ-027**                                       | AT-027-A                                                     | ATS-027-A1                                       | ⬜ Untested |
| **REQ-028**                                       | ⚠️ GAP — no AT (STP-007-A/017-A/018-B only)                  | —                                                | ⬜ Untested |
| **REQ-029**                                       | AT-052-A (co-cited)                                          | ATS-052-A1                                       | ⬜ Untested |
| **REQ-030**                                       | (deferred Redis — out of lean-launch scope)                  | —                                                | ⬜ Untested |
| **REQ-031**                                       | AT-031-A, AT-031-B                                           | ATS-031-A1, ATS-031-B1                           | ⬜ Untested |
| **REQ-032**                                       | AT-031-A                                                     | ATS-031-A1                                       | ⬜ Untested |
| **REQ-033**                                       | AT-007-A                                                     | ATS-007-A1, ATS-007-A2                           | ⬜ Untested |
| **REQ-034**                                       | (Demonstration — deferred WebSocket; STP-010)                | —                                                | ⬜ Untested |
| **REQ-035**                                       | ATP-008-A                                                    | ATS-036-A1                                       | ⬜ Untested |
| **REQ-037a**                                      | ATP-008-A, ATP-008-B                                         | ATS-036-A1, ATS-037-B1                           | ⬜ Untested |
| **REQ-037b**                                      | ATP-008-D                                                    | ATS-039-D1                                       | ⬜ Untested |
| **REQ-037c**                                      | ATP-008-A, ATP-008-D                                         | ATS-036-A1, ATS-039-D1                           | ⬜ Untested |
| **REQ-037d**                                      | ATP-008-C                                                    | ATS-038-C1                                       | ⬜ Untested |
| **REQ-038a**                                      | ⚠️ GAP — no AT (ATP-008-G covers 038b–c only; STP-013-D/E)   | —                                                | ⬜ Untested |
| **REQ-038b**                                      | ATP-008-G                                                    | ATS-042-G1                                       | ⬜ Untested |
| **REQ-038c**                                      | ATP-008-G                                                    | ATS-042-G1                                       | ⬜ Untested |
| **REQ-039**                                       | ATP-008-F                                                    | ATS-041-F1                                       | ⬜ Untested |
| **REQ-040a**                                      | ATP-008-I, AT-012-A                                          | ATS-044-I1, ATS-012-A1                           | ⬜ Untested |
| **REQ-040b**                                      | AT-040-B                                                     | ATS-040-B1                                       | ⬜ Untested |
| **REQ-041**                                       | ATP-008-H                                                    | ATS-043-H1                                       | ⬜ Untested |
| **REQ-042**                                       | ⚠️ GAP — no AT (STP-005-G only)                              | —                                                | ⬜ Untested |
| **REQ-043**                                       | ATP-008-E                                                    | ATS-040-E1, ATS-040-E2                           | ⬜ Untested |
| **REQ-044a**                                      | AT-015-A                                                     | ATS-015-A1                                       | ⬜ Untested |
| **REQ-044b**                                      | ⚠️ GAP — no AT (Test method; STP-013-C)                      | —                                                | ⬜ Untested |
| **REQ-044c**                                      | (Inspection — non-secret config; STP-011)                    | —                                                | ⬜ Untested |
| **REQ-044d**                                      | (Inspection — named component; SYS-013/ARCH-012)             | —                                                | ⬜ Untested |
| **REQ-045**                                       | AT-046-A                                                     | ATS-046-A1                                       | ⬜ Untested |
| **REQ-046**                                       | AT-046-A                                                     | ATS-046-A1                                       | ⬜ Untested |
| **REQ-047**                                       | AT-005-A, AT-005-B                                           | ATS-005-A1, ATS-005-B1                           | ⬜ Untested |
| **REQ-048**                                       | AT-048-A                                                     | ATS-048-A1                                       | ⬜ Untested |
| **REQ-049**                                       | AT-049-A, AT-049-B                                           | ATS-049-A1, ATS-049-B1                           | ⬜ Untested |
| **REQ-050**                                       | AT-050-A, AT-050-B                                           | ATS-050-A1, ATS-050-A2, ATS-050-B1               | ⬜ Untested |
| **REQ-051**                                       | AT-051-A, AT-051-B                                           | ATS-051-A1, ATS-051-A2, ATS-051-A3, ATS-051-B1   | ⬜ Untested |
| **REQ-052**                                       | AT-052-A                                                     | ATS-052-A1                                       | ⬜ Untested |
| **REQ-053**                                       | AT-031-A, AT-031-B                                           | ATS-031-A1, ATS-031-B1                           | ⬜ Untested |
| **REQ-054**                                       | AT-046-A                                                     | ATS-046-A1                                       | ⬜ Untested |
| **REQ-055**                                       | AT-055-A, AT-024-A                                           | ATS-055-A1, ATS-024-A1                           | ⬜ Untested |
| **REQ-050a**                                      | AT-MRG5-A, AT-MRG5-B, AT-MRG5-C                              | ATS-MRG5-A1, ATS-MRG5-B1, ATS-MRG5-C1            | ⬜ Untested |
| **REQ-025a**                                      | AT-025a-A, AT-025a-B                                         | ATS-025a-A1, ATS-025a-B1                         | ⬜ Untested |
| **REQ-028a**                                      | AT-028a-A, ATS-049-A2, AT-031-B (AT-LC-A/B/C/D/E)            | ATS-028a-A1, ATS-028a-A2, ATS-049-A2, ATS-031-B1 | ⬜ Untested |
| **REQ-IF-001**                                    | AT-002-A, AT-004-A                                           | ATS-002-A1, ATS-004-A1                           | ⬜ Untested |
| **REQ-IF-002**                                    | AT-003-A, AT-007-A                                           | ATS-003-A1, ATS-007-A1                           | ⬜ Untested |
| **REQ-IF-003**                                    | AT-008-A                                                     | ATS-008-A1                                       | ⬜ Untested |
| **REQ-IF-004**                                    | AT-023-A _(fdcId boundary)_                                  | ATS-023-A1                                       | ⬜ Untested |
| **REQ-IF-005**                                    | (trace via AT-024-A / AT-050-A)                              | ATS-024-A1                                       | ⬜ Untested |
| **REQ-IF-006**                                    | ⚠️ GAP — no AT (STP-009-B/011 only; security-gate checklist) | —                                                | ⬜ Untested |
| **REQ-IF-007**                                    | ATP-008-A                                                    | ATS-036-A1                                       | ⬜ Untested |
| **REQ-IF-008**                                    | ATP-008-B                                                    | ATS-037-B1                                       | ⬜ Untested |
| **REQ-IF-009**                                    | AT-005-A, AT-012-A                                           | ATS-005-A1, ATS-012-A1                           | ⬜ Untested |
| **REQ-IF-010**                                    | AT-048-A                                                     | ATS-048-A1                                       | ⬜ Untested |
| **REQ-IF-011**                                    | AT-049-A                                                     | ATS-049-A1                                       | ⬜ Untested |
| **REQ-IF-012**                                    | AT-046-A, AT-055-A                                           | ATS-046-A1, ATS-055-A1                           | ⬜ Untested |
| **REQ-NF-007**                                    | AT-NF007-A                                                   | ATS-NF007-A1                                     | ⬜ Untested |
| **REQ-NF-011**                                    | AT-NF011-A                                                   | ATS-NF011-A1                                     | ⬜ Untested |
| **REQ-NF-012**                                    | AT-NF012-A                                                   | ATS-NF012-A1                                     | ⬜ Untested |
| **REQ-NF-013**                                    | AT-NF013-A                                                   | ATS-NF013-A1                                     | ⬜ Untested |
| **REQ-NF-016**                                    | AT-NF016-A                                                   | ATS-NF016-A1                                     | ⬜ Untested |
| **REQ-NF-018**                                    | AT-NF018-A, AT-051-A                                         | ATS-NF018-A1, ATS-051-A1                         | ⬜ Untested |
| **REQ-NF-001..006, 008..010, 014, 015, 017, 019** | (Inspection / Analysis per Verification Method — no AT)      | —                                                | ⬜ Untested |
| **REQ-CN-001..007**                               | (Inspection per Verification Method — no AT)                 | —                                                | ⬜ Untested |

---

## Matrix B — System Verification (REQ → SYS component → System Test)

SYS membership is taken verbatim from `system-design.md` "Parent Requirements" headers. Each STP family
`STP-{NNN}` exercises `SYS-{NNN}`. Every functional + interface REQ has ≥1 SYS and ≥1 STP.

| Requirement ID                                    | System Component(s)                                   | System Test (STP)                                                           | Status      |
| ------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- | ----------- |
| **REQ-001**                                       | SYS-001, SYS-007, SYS-008, SYS-018                    | STP-001-A, STP-007-D, STP-008-A                                             | ⬜ Untested |
| **REQ-002**                                       | SYS-001, SYS-007                                      | STP-001-B, STP-007-A, STP-007-B                                             | ⬜ Untested |
| **REQ-003**                                       | SYS-001, SYS-007                                      | STP-001-B, STP-007-B                                                        | ⬜ Untested |
| **REQ-004**                                       | SYS-001, SYS-007                                      | STP-001-B, STP-007-B                                                        | ⬜ Untested |
| **REQ-005**                                       | SYS-001, SYS-018                                      | STP-001-E, STP-018-A                                                        | ⬜ Untested |
| **REQ-006**                                       | SYS-001, SYS-020                                      | STP-001-C, STP-020-A                                                        | ⬜ Untested |
| **REQ-007**                                       | SYS-001                                               | STP-001-B                                                                   | ⬜ Untested |
| **REQ-008**                                       | SYS-001, SYS-007                                      | STP-001-D                                                                   | ⬜ Untested |
| **REQ-009**                                       | SYS-001                                               | STP-001-A, STP-001-D                                                        | ⬜ Untested |
| **REQ-010**                                       | SYS-001, SYS-007                                      | STP-001-D                                                                   | ⬜ Untested |
| **REQ-011**                                       | SYS-002, SYS-003                                      | STP-002-A, STP-002-C                                                        | ⬜ Untested |
| **REQ-012**                                       | SYS-003                                               | STP-003-A, STP-003-B                                                        | ⬜ Untested |
| **REQ-013**                                       | SYS-003, SYS-018                                      | STP-003-B, STP-008-B, STP-018-A, STP-018-C                                  | ⬜ Untested |
| **REQ-014**                                       | SYS-003, SYS-004                                      | STP-002-A, STP-003-B, STP-004-A                                             | ⬜ Untested |
| **REQ-015**                                       | SYS-003, SYS-005                                      | STP-003-A, STP-005-A                                                        | ⬜ Untested |
| **REQ-016**                                       | SYS-003, SYS-005                                      | STP-003-C, STP-005-F                                                        | ⬜ Untested |
| **REQ-017**                                       | SYS-003, SYS-005                                      | STP-003-A, STP-005-A                                                        | ⬜ Untested |
| **REQ-018**                                       | SYS-003                                               | STP-003-C                                                                   | ⬜ Untested |
| **REQ-019**                                       | SYS-006, SYS-009                                      | STP-005-E, STP-006-A, STP-006-B, STP-006-C, STP-006-D, STP-009-A            | ⬜ Untested |
| **REQ-020**                                       | SYS-006                                               | STP-006-A                                                                   | ⬜ Untested |
| **REQ-021**                                       | SYS-006                                               | STP-006-A, STP-006-B, STP-006-C                                             | ⬜ Untested |
| **REQ-022**                                       | SYS-005                                               | STP-005-A                                                                   | ⬜ Untested |
| **REQ-023**                                       | SYS-009, SYS-014                                      | STP-009-A                                                                   | ⬜ Untested |
| **REQ-024**                                       | SYS-005, SYS-014, SYS-018                             | STP-005-B, STP-007-A, STP-014-B                                             | ⬜ Untested |
| **REQ-025**                                       | SYS-005                                               | STP-003-C, STP-005-D                                                        | ⬜ Untested |
| **REQ-026**                                       | SYS-006                                               | STP-005-E, STP-006-A                                                        | ⬜ Untested |
| **REQ-027**                                       | SYS-005                                               | STP-003-C, STP-005-F                                                        | ⬜ Untested |
| **REQ-028**                                       | SYS-007, SYS-017, SYS-018                             | STP-007-A, STP-017-A, STP-018-B                                             | ⬜ Untested |
| **REQ-029**                                       | SYS-007, SYS-017, SYS-018                             | STP-007-A, STP-017-B                                                        | ⬜ Untested |
| **REQ-030**                                       | SYS-008                                               | STP-008-A, STP-008-B, STP-008-C, STP-008-D                                  | ⬜ Untested |
| **REQ-031**                                       | SYS-019                                               | STP-019-A, STP-019-B, STP-019-C                                             | ⬜ Untested |
| **REQ-032**                                       | SYS-002, SYS-019                                      | STP-002-B, STP-019-D                                                        | ⬜ Untested |
| **REQ-033**                                       | SYS-001                                               | STP-001-B                                                                   | ⬜ Untested |
| **REQ-034**                                       | SYS-010                                               | STP-010-A, STP-010-B                                                        | ⬜ Untested |
| **REQ-035**                                       | SYS-013                                               | STP-013-A                                                                   | ⬜ Untested |
| **REQ-037a**                                      | SYS-013                                               | STP-013-A                                                                   | ⬜ Untested |
| **REQ-037b**                                      | SYS-013                                               | STP-013-A                                                                   | ⬜ Untested |
| **REQ-037c**                                      | SYS-013                                               | STP-013-A                                                                   | ⬜ Untested |
| **REQ-037d**                                      | SYS-013                                               | STP-013-A                                                                   | ⬜ Untested |
| **REQ-038a**                                      | SYS-013                                               | STP-013-D                                                                   | ⬜ Untested |
| **REQ-038b**                                      | SYS-013                                               | STP-013-D                                                                   | ⬜ Untested |
| **REQ-038c**                                      | SYS-013                                               | STP-013-E                                                                   | ⬜ Untested |
| **REQ-039**                                       | SYS-003, SYS-004, SYS-013                             | STP-003-A, STP-013-C                                                        | ⬜ Untested |
| **REQ-040a**                                      | SYS-013                                               | STP-001-F, STP-013-F                                                        | ⬜ Untested |
| **REQ-040b**                                      | SYS-013                                               | STP-013-F                                                                   | ⬜ Untested |
| **REQ-041**                                       | SYS-013                                               | STP-013-D                                                                   | ⬜ Untested |
| **REQ-042**                                       | SYS-005, SYS-013                                      | STP-005-G, STP-013-A                                                        | ⬜ Untested |
| **REQ-043**                                       | SYS-010, SYS-013                                      | STP-010-B, STP-013-A                                                        | ⬜ Untested |
| **REQ-044a**                                      | SYS-013                                               | STP-004-A, STP-013-C                                                        | ⬜ Untested |
| **REQ-044b**                                      | SYS-013                                               | STP-013-C                                                                   | ⬜ Untested |
| **REQ-044c**                                      | SYS-011, SYS-013                                      | STP-011-A, STP-013-A                                                        | ⬜ Untested |
| **REQ-044d**                                      | SYS-013                                               | STP-013-A                                                                   | ⬜ Untested |
| **REQ-045**                                       | SYS-007, SYS-014, SYS-018                             | STP-014-B, STP-018-A, STP-018-B                                             | ⬜ Untested |
| **REQ-046**                                       | SYS-009, SYS-014                                      | STP-009-A, STP-014-B                                                        | ⬜ Untested |
| **REQ-047**                                       | SYS-001, SYS-018                                      | STP-001-E, STP-018-A                                                        | ⬜ Untested |
| **REQ-048**                                       | SYS-015, SYS-016                                      | STP-005-C, STP-016-A                                                        | ⬜ Untested |
| **REQ-049**                                       | SYS-016                                               | STP-016-B, STP-016-C                                                        | ⬜ Untested |
| **REQ-050**                                       | SYS-005, SYS-014, SYS-015                             | STP-005-B, STP-005-C, STP-005-D, STP-014-A, STP-014-C, STP-014-D, STP-015-C | ⬜ Untested |
| **REQ-051**                                       | SYS-015                                               | STP-015-A, STP-015-B, STP-015-C                                             | ⬜ Untested |
| **REQ-052**                                       | SYS-015, SYS-017                                      | STP-017-A, STP-017-B, STP-017-C                                             | ⬜ Untested |
| **REQ-053**                                       | SYS-019                                               | STP-019-A, STP-019-B, STP-019-C, STP-019-D                                  | ⬜ Untested |
| **REQ-054**                                       | SYS-014, SYS-018                                      | STP-014-A, STP-014-C, STP-018-B                                             | ⬜ Untested |
| **REQ-055**                                       | SYS-020                                               | STP-020-A, STP-020-B, STP-020-C                                             | ⬜ Untested |
| **REQ-050a**                                      | SYS-005, SYS-015, SYS-016                             | STP-015-A, STP-015-C, STP-016-A                                             | ⬜ Untested |
| **REQ-025a**                                      | SYS-016, SYS-019                                      | STP-016-A, STP-019-A                                                        | ⬜ Untested |
| **REQ-028a**                                      | SYS-007, SYS-005, SYS-016                             | STP-005-A, STP-005-E, STP-016-B                                             | ⬜ Untested |
| **REQ-IF-001**                                    | SYS-001                                               | STP-001-A, STP-001-B                                                        | ⬜ Untested |
| **REQ-IF-002**                                    | SYS-001                                               | STP-001-B                                                                   | ⬜ Untested |
| **REQ-IF-003**                                    | SYS-001                                               | STP-001-D                                                                   | ⬜ Untested |
| **REQ-IF-004**                                    | SYS-009, SYS-014 _(fdcId boundary)_                   | STP-009-A, STP-014-B                                                        | ⬜ Untested |
| **REQ-IF-005**                                    | SYS-002, SYS-003                                      | STP-002-A, STP-002-B, STP-002-C                                             | ⬜ Untested |
| **REQ-IF-006**                                    | SYS-009, SYS-011                                      | STP-009-B, STP-011-A, STP-011-B                                             | ⬜ Untested |
| **REQ-IF-007**                                    | SYS-013                                               | STP-013-A                                                                   | ⬜ Untested |
| **REQ-IF-008**                                    | SYS-010, SYS-013                                      | STP-010-B, STP-013-A                                                        | ⬜ Untested |
| **REQ-IF-009**                                    | SYS-001                                               | STP-001-E, STP-001-F                                                        | ⬜ Untested |
| **REQ-IF-010**                                    | SYS-016                                               | STP-016-A                                                                   | ⬜ Untested |
| **REQ-IF-011**                                    | SYS-016                                               | STP-016-B, STP-016-C                                                        | ⬜ Untested |
| **REQ-IF-012**                                    | SYS-014, SYS-018, SYS-020                             | STP-014-A, STP-014-C, STP-018-B, STP-020-A                                  | ⬜ Untested |
| **REQ-NF-012**                                    | SYS-012                                               | STP-012-A, STP-012-B, STP-012-C                                             | ⬜ Untested |
| **REQ-NF-016**                                    | SYS-012                                               | STP-012-C                                                                   | ⬜ Untested |
| **REQ-NF-018**                                    | SYS-007, SYS-020                                      | STP-007-C, STP-020-B                                                        | ⬜ Untested |
| **REQ-NF-007, 011, 013**                          | (CI/perf gates — acceptance only, no STP by design)   | —                                                                           | ⬜ Untested |
| **REQ-NF-001..006, 008..010, 014, 015, 017, 019** | (Inspection/Analysis — no SYS test)                   | —                                                                           | ⬜ Untested |
| **REQ-CN-001..006**                               | (Inspection — constraints on SYS-005/007/011, no STP) | —                                                                           | ⬜ Untested |
| **REQ-CN-007**                                    | SYS-007, SYS-014, SYS-018                             | STP-014-B, STP-018-A, STP-018-B                                             | ⬜ Untested |

---

## Matrix C — Integration Verification (SYS → ARCH module → Integration Test)

ARCH→SYS membership verbatim from `architecture-design.md`; ITP family `ITP-{NNN}` covers `ARCH-{NNN}`.
**All 19 ARCH modules have ≥1 ITP** (the prior `ARCH-007/010/011/012` integration gaps are closed).

| ARCH ID      | Module Name                              | Parent SYS                | Integration Test (ITP)                                                                 | Scenario ID (ITS)                                                                                                                                                                                          | Status      |
| ------------ | ---------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **ARCH-001** | FoodApiController                        | SYS-001                   | ITP-001-A, ITP-001-B, ITP-001-C, ITP-001-D, ITP-001-E                                  | ITS-001-A1, ITS-001-A2, ITS-001-B1, ITS-001-B2, ITS-001-C1, ITS-001-D1, ITS-001-D2, ITS-001-E1, ITS-001-E2                                                                                                 | ⬜ Untested |
| **ARCH-002** | EnqueueEmitter                           | SYS-002                   | ITP-002-A, ITP-002-B, ITP-002-C                                                        | ITS-002-A1, ITS-002-A2, ITS-002-B1, ITS-002-B2, ITS-002-C1                                                                                                                                                 | ⬜ Untested |
| **ARCH-003** | FetchQueueRouter                         | SYS-002, SYS-003, SYS-004 | ITP-003-A, ITP-003-B, ITP-003-C                                                        | ITS-003-A1, ITS-003-A2, ITS-003-B1, ITS-003-C1                                                                                                                                                             | ⬜ Untested |
| **ARCH-004** | FoodConsumerService                      | SYS-005                   | ITP-004-A, ITP-004-B, ITP-004-C, ITP-004-D, ITP-004-E                                  | ITS-004-A1, ITS-004-A2, ITS-004-B1, ITS-004-C1, ITS-004-C2, ITS-004-D1, ITS-004-D2, ITS-004-E1, ITS-004-E2                                                                                                 | ⬜ Untested |
| **ARCH-005** | RollingWindowLimiter                     | SYS-006                   | ITP-005-A, ITP-005-B, ITP-005-C                                                        | ITS-005-A1, ITS-005-A2, ITS-005-B1, ITS-005-C1, ITS-005-C2                                                                                                                                                 | ⬜ Untested |
| **ARCH-006** | FoodPostgresRepository                   | SYS-007                   | ITP-006-A, ITP-006-B, ITP-006-C                                                        | ITS-006-A1, ITS-006-A2, ITS-006-B1, ITS-006-B2, ITS-006-C1                                                                                                                                                 | ⬜ Untested |
| **ARCH-007** | FoodCacheService                         | SYS-008                   | ITP-007-A, ITP-007-B                                                                   | ITS-007-A1, ITS-007-B1                                                                                                                                                                                     | ⬜ Untested |
| **ARCH-008** | UsdaApiClient _(fdcId boundary)_         | SYS-009                   | ITP-008-A, ITP-008-B                                                                   | ITS-008-A1, ITS-008-B1, ITS-008-B2                                                                                                                                                                         | ⬜ Untested |
| **ARCH-009** | WebSocketNotifier                        | SYS-010                   | ITP-009-A, ITP-009-B                                                                   | ITS-009-A1, ITS-009-B1                                                                                                                                                                                     | ⬜ Untested |
| **ARCH-010** | SecretManager                            | SYS-011                   | ITP-010-A, ITP-010-B                                                                   | ITS-010-A1, ITS-010-B1                                                                                                                                                                                     | ⬜ Untested |
| **ARCH-011** | MonitoringLogger                         | SYS-012                   | ITP-011-A, ITP-011-B, ITP-011-C                                                        | ITS-011-A1, ITS-011-B1, ITS-011-C1                                                                                                                                                                         | ⬜ Untested |
| **ARCH-012** | FoodAuthGuard                            | SYS-013                   | ITP-012-A, ITP-012-B, ITP-012-C, ITP-012-D, ITP-012-E, ITP-012-F, ITP-012-G, ITP-012-H | ITS-012-A1, ITS-012-A2, ITS-012-B1, ITS-012-C1, ITS-012-C2, ITS-012-C3, ITS-012-D1, ITS-012-E1, ITS-012-E2, ITS-012-F1, ITS-012-F2, ITS-012-F3, ITS-012-F4, ITS-012-G1, ITS-012-G2, ITS-012-H1, ITS-012-H2 | ⬜ Untested |
| **ARCH-013** | SourceAdapterRegistry _(fdcId boundary)_ | SYS-014                   | ITP-013-A, ITP-013-B                                                                   | ITS-013-A1, ITS-013-A2, ITS-013-B1                                                                                                                                                                         | ⬜ Untested |
| **ARCH-014** | FoodDaoRepository                        | SYS-018                   | ITP-014-A, ITP-014-B                                                                   | ITS-014-A1, ITS-014-B1, ITS-014-B2                                                                                                                                                                         | ⬜ Untested |
| **ARCH-015** | GoldenRecordMergeEngine                  | SYS-015                   | ITP-015-A, ITP-015-B                                                                   | ITS-015-A1, ITS-015-B1                                                                                                                                                                                     | ⬜ Untested |
| **ARCH-016** | CandidateResolutionService               | SYS-016                   | ITP-016-A, ITP-016-B, ITP-016-C                                                        | ITS-016-A1, ITS-016-B1, ITS-016-C1                                                                                                                                                                         | ⬜ Untested |
| **ARCH-017** | ProvenanceStore                          | SYS-017                   | ITP-017-A, ITP-017-B                                                                   | ITS-017-A1, ITS-017-B1                                                                                                                                                                                     | ⬜ Untested |
| **ARCH-018** | ChangeRefreshConsumer                    | SYS-019                   | ITP-018-A, ITP-018-B                                                                   | ITS-018-A1, ITS-018-B1                                                                                                                                                                                     | ⬜ Untested |
| **ARCH-019** | AdapterInputValidator                    | SYS-020                   | ITP-019-A, ITP-019-B                                                                   | ITS-019-A1, ITS-019-A2, ITS-019-B1                                                                                                                                                                         | ⬜ Untested |

---

## Matrix D — Implementation Verification (ARCH → MOD module → Unit Test)

ARCH→MOD is 1:1 for every ARCH **except ARCH-012** (auth), which decomposes into MOD-012 / MOD-013 /
MOD-014. UTP family numbering: MOD-013's cases are numbered under the ARCH-012 group as `UTP-012-E/F/G/H`
(there is no `UTP-013-*` prefix); MOD-014 uses `UTP-014-*`. **All 21 MOD modules have ≥1 UTP.**

| MOD ID      | Module Name                              | Parent ARCH | Unit Test (UTP)                                                                        | Status      |
| ----------- | ---------------------------------------- | ----------- | -------------------------------------------------------------------------------------- | ----------- |
| **MOD-001** | FoodApiController                        | ARCH-001    | UTP-001-A, UTP-001-B, UTP-001-C, UTP-001-D, UTP-001-E, UTP-001-F, UTP-001-G, UTP-001-H | ⬜ Untested |
| **MOD-002** | EnqueueEmitter                           | ARCH-002    | UTP-002-A, UTP-002-B, UTP-002-C, UTP-002-D                                             | ⬜ Untested |
| **MOD-003** | FetchQueueRouter                         | ARCH-003    | UTP-003-A, UTP-003-B, UTP-003-C, UTP-003-D                                             | ⬜ Untested |
| **MOD-004** | FoodConsumerService                      | ARCH-004    | UTP-004-A, UTP-004-B, UTP-004-C                                                        | ⬜ Untested |
| **MOD-005** | RollingWindowLimiter                     | ARCH-005    | UTP-005-A, UTP-005-B, UTP-005-C                                                        | ⬜ Untested |
| **MOD-006** | FoodPostgresRepository                   | ARCH-006    | UTP-006-A, UTP-006-B, UTP-006-C, UTP-006-D                                             | ⬜ Untested |
| **MOD-007** | FoodCacheService                         | ARCH-007    | UTP-007-A, UTP-007-B                                                                   | ⬜ Untested |
| **MOD-008** | UsdaApiClient _(fdcId boundary)_         | ARCH-008    | UTP-008-A, UTP-008-B, UTP-008-C                                                        | ⬜ Untested |
| **MOD-009** | WebSocketNotifier                        | ARCH-009    | UTP-009-A, UTP-009-B                                                                   | ⬜ Untested |
| **MOD-010** | SecretManager                            | ARCH-010    | UTP-010-A, UTP-010-B, UTP-010-C                                                        | ⬜ Untested |
| **MOD-011** | MonitoringLogger                         | ARCH-011    | UTP-011-A, UTP-011-B                                                                   | ⬜ Untested |
| **MOD-012** | ClerkAuthMiddleware                      | ARCH-012    | UTP-012-A, UTP-012-B, UTP-012-C, UTP-012-D, UTP-012-I, UTP-012-J                       | ⬜ Untested |
| **MOD-013** | DemotionAndFairness                      | ARCH-012    | UTP-012-E, UTP-012-F, UTP-012-G, UTP-012-H                                             | ⬜ Untested |
| **MOD-014** | AsyncProducerAuthz                       | ARCH-012    | UTP-014-A, UTP-014-B, UTP-014-C, UTP-014-D, UTP-014-E                                  | ⬜ Untested |
| **MOD-015** | SourceAdapterRegistry _(fdcId boundary)_ | ARCH-013    | UTP-015-A, UTP-015-B                                                                   | ⬜ Untested |
| **MOD-016** | FoodDaoRepository                        | ARCH-014    | UTP-016-A, UTP-016-B, UTP-016-C                                                        | ⬜ Untested |
| **MOD-017** | GoldenRecordMergeEngine                  | ARCH-015    | UTP-017-A, UTP-017-B, UTP-017-C, UTP-017-D                                             | ⬜ Untested |
| **MOD-018** | CandidateResolutionService               | ARCH-016    | UTP-018-A, UTP-018-B, UTP-018-C                                                        | ⬜ Untested |
| **MOD-019** | ProvenanceStore                          | ARCH-017    | UTP-019-A, UTP-019-B                                                                   | ⬜ Untested |
| **MOD-020** | ChangeRefreshConsumer                    | ARCH-018    | UTP-020-A, UTP-020-B                                                                   | ⬜ Untested |
| **MOD-021** | AdapterInputValidator                    | ARCH-019    | UTP-021-A, UTP-021-B, UTP-021-C                                                        | ⬜ Untested |

---

## Matrix H — Hazard Traceability (HAZ → mitigation → verification test)

Each hazard maps to a mitigation (REQ + MOD/SYS control) and a verification test. The `hazard-analysis.md`
register names mitigations only; this matrix binds the verification test ids (the test layer that
exercises each mitigating control). **Every HAZ has a mitigation AND ≥1 verification test.** New hazards
HAZ-042..049 (merge/provenance/dedup/refresh + `food_candidates` candidate-set integrity and the
UNRESOLVED candidate-set TTL) and the auth slice HAZ-036..041 are fully connected.

| Hazard ID   | Hazard (one-line)                                                                                     | Mitigation (REQ / MOD)                                                         | Verification Test(s)                                                                                                    | Status      |
| ----------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ----------- |
| **HAZ-001** | Malformed `id` / empty name reaches create/enqueue                                                    | REQ-006; MOD-001, MOD-021                                                      | UTP-001-C, UTP-021-A, STP-001-C, STP-020-A, AT-006-A                                                                    | ⬜ Untested |
| **HAZ-002** | API read path calls an external source on a miss                                                      | REQ-001, REQ-009; MOD-001, MOD-016                                             | UTP-001-A, ITP-001-A, STP-001-A, AT-001-A, AT-009-A                                                                     | ⬜ Untested |
| **HAZ-003** | Queue-grain dedup bypassed under concurrent `id` enqueues                                             | REQ-013, REQ-014; MOD-003                                                      | UTP-003-B, ITP-003-A, STP-003-B, AT-012-A                                                                               | ⬜ Untested |
| **HAZ-004** | Demand-path `fetch_queue` insert / `pg_notify` fails                                                  | REQ-011, REQ-014; MOD-002, MOD-003                                             | UTP-002-A, ITP-002-A, STP-002-A                                                                                         | ⬜ Untested |
| **HAZ-005** | Demand-weight / aging miscompute starves user demand                                                  | REQ-015, REQ-039; MOD-003                                                      | UTP-003-C, ITP-003-B, STP-003-A, STP-013-C                                                                              | ⬜ Untested |
| **HAZ-006** | EventBridge payload schema drift (food `id` dropped)                                                  | REQ-IF-005; MOD-002                                                            | UTP-002-D, ITP-002-C, STP-002-B                                                                                         | ⬜ Untested |
| **HAZ-007** | `food_id` `ON CONFLICT` collision drops a distinct lookup                                             | REQ-013, REQ-014; MOD-003                                                      | UTP-003-B, ITP-003-A, STP-003-B                                                                                         | ⬜ Untested |
| **HAZ-008** | Single 30s `in_flight` lease too short for slow source                                                | REQ-017; MOD-003, MOD-004                                                      | UTP-003-D, ITP-004-D, STP-003-A, STP-005-A                                                                              | ⬜ Untested |
| **HAZ-009** | Change-refresh re-enqueues accumulate, never drain                                                    | REQ-031, REQ-053, REQ-015; MOD-020                                             | UTP-020-B, ITP-018-B, STP-019-D                                                                                         | ⬜ Untested |
| **HAZ-010** | Batch over 100-name cap partially enqueued vs rejected                                                | REQ-040a; MOD-001                                                              | UTP-001-F, ITP-012-G, STP-013-F, ATP-008-I                                                                              | ⬜ Untested |
| **HAZ-011** | Wired source outage / sustained 5xx collapses fan-out                                                 | REQ-016, REQ-027, REQ-050; MOD-004                                             | UTP-004-B, ITP-004-C, STP-005-F, AT-027-A                                                                               | ⬜ Untested |
| **HAZ-012** | Source `429` despite per-source limiter (window edge)                                                 | REQ-019, REQ-026; MOD-004, MOD-005                                             | UTP-005-C, ITP-005-C, STP-006-A, AT-026-A                                                                               | ⬜ Untested |
| **HAZ-013** | Malformed source nutrition payload writes bad macros                                                  | REQ-024, REQ-055; MOD-008, MOD-021                                             | UTP-008-C, UTP-021-B, ITP-019-A, STP-020-B, AT-055-A                                                                    | ⬜ Untested |
| **HAZ-014** | Fan-out succeeds but persist+resolve txn fails pre-commit                                             | REQ-024; MOD-004, MOD-016                                                      | UTP-004-C, UTP-016-B, ITP-014-A, STP-005-B                                                                              | ⬜ Untested |
| **HAZ-015** | Trailing-window count math over-/under-counts                                                         | REQ-019, REQ-020; MOD-005                                                      | UTP-005-A, UTP-005-B, ITP-005-A, STP-006-A                                                                              | ⬜ Untested |
| **HAZ-016** | Atomic per-source count+record race overshoots cap                                                    | REQ-018, REQ-020, REQ-022; MOD-005                                             | UTP-005-A, ITP-005-A, STP-006-A, AT-020-A                                                                               | ⬜ Untested |
| **HAZ-017** | Crosswalk key drift attaches wrong food `id` to source item                                           | REQ-028, REQ-029; MOD-006 (+ MOD-015)                                          | UTP-006-B, UTP-015-B, ITP-006-A, ITP-013-B, STP-014-B                                                                   | ⬜ Untested |
| **HAZ-018** | Branded/generic `kind` collision overwrites golden scalars                                            | REQ-028; MOD-006, MOD-016, MOD-017                                             | UTP-006-C, UTP-017-A, ITP-015-A, STP-015-A                                                                              | ⬜ Untested |
| **HAZ-019** | Tombstoned food's `external_key` unresolved past 30d TTL                                              | REQ-018, REQ-025; MOD-006                                                      | UTP-006-A, ITP-006-B, STP-003-C, AT-025-A                                                                               | ⬜ Untested |
| **HAZ-020** | Cache invalidation missed after upsert (deferred Redis)                                               | REQ-030; MOD-007                                                               | UTP-007-B, ITP-007-A, STP-008-B                                                                                         | ⬜ Untested |
| **HAZ-021** | `in_flight` row lease orphaned after worker crash                                                     | REQ-017; MOD-003                                                               | UTP-003-D, ITP-004-D, STP-003-A                                                                                         | ⬜ Untested |
| **HAZ-022** | USDA schema drift renames/removes fields at adapter                                                   | REQ-023, REQ-055; MOD-008, MOD-021                                             | UTP-008-C, UTP-021-B, ITP-008-B, STP-009-A                                                                              | ⬜ Untested |
| **HAZ-023** | Upstream metadata inverts a source item's `kind`                                                      | REQ-024, REQ-055; MOD-008, MOD-017, MOD-021                                    | UTP-008-B, UTP-017-A, ITP-008-A, STP-014-B                                                                              | ⬜ Untested |
| **HAZ-024** | Source API key revoked without timely rotation pickup                                                 | REQ-IF-006, REQ-050; MOD-010                                                   | UTP-010-B, UTP-010-C, ITP-010-B, STP-011-A                                                                              | ⬜ Untested |
| **HAZ-025** | WebSocket disabled but clients assume push-only completion                                            | REQ-033, REQ-034; MOD-001, MOD-009                                             | UTP-001-B, UTP-009-A, STP-001-B, AT-007-A                                                                               | ⬜ Untested |
| **HAZ-026** | `FoodFetchCompleted` push routed to wrong connection                                                  | REQ-043; MOD-009 (+ SYS-004 subscription set)                                  | UTP-009-B, ITP-009-A, STP-010-B, ATP-008-E                                                                              | ⬜ Untested |
| **HAZ-027** | Source secret logged/exposed via error path                                                           | REQ-IF-006, REQ-044c; MOD-010, MOD-011                                         | UTP-010-A, UTP-011-B, ITP-010-A, STP-011-B                                                                              | ⬜ Untested |
| **HAZ-028** | Rotation done but stale cached key in long-lived worker                                               | REQ-IF-006; MOD-010                                                            | UTP-010-C, ITP-010-B, STP-011-A                                                                                         | ⬜ Untested |
| **HAZ-029** | Queue-depth / window / backlog alarms misconfigured                                                   | REQ-NF-012, REQ-NF-016; MOD-011                                                | UTP-011-A, ITP-011-A, STP-012-A, AT-NF016-A                                                                             | ⬜ Untested |
| **HAZ-030** | Metrics cardinality explosion from unbounded labels                                                   | REQ-NF-012; MOD-011                                                            | UTP-011-B, ITP-011-B, STP-012-B                                                                                         | ⬜ Untested |
| **HAZ-031** | Golden-record upsert OK but lifecycle status write skipped                                            | REQ-002, REQ-003; MOD-004, MOD-016                                             | UTP-004-A, UTP-016-B, ITP-014-A, STP-001-B                                                                              | ⬜ Untested |
| **HAZ-032** | Cache/DB key serialization mismatch for `id` (deferred Redis)                                         | REQ-030; MOD-007                                                               | UTP-007-A, ITP-007-B, STP-008-A                                                                                         | ⬜ Untested |
| **HAZ-033** | Fuzzy name-normalization collision pre-merges distinct foods                                          | REQ-050, REQ-008; MOD-017, MOD-021                                             | UTP-017-B, UTP-021-A, ITP-015-B, STP-005-C, AT-050-B                                                                    | ⬜ Untested |
| **HAZ-034** | Search-ranking poisoning via adversarial query distribution                                           | REQ-010; MOD-006 (+ SYS-012 monitoring)                                        | UTP-006-B, ITP-006-C, STP-001-D, AT-010-A                                                                               | ⬜ Untested |
| **HAZ-035** | Logging records secret-bearing upstream headers                                                       | REQ-IF-006, REQ-044c; MOD-010, MOD-011                                         | UTP-010-A, UTP-011-B, ITP-011-C, STP-011-B                                                                              | ⬜ Untested |
| **HAZ-036** | Unauthenticated / auth-bypass reaches endpoints or producers                                          | REQ-035, REQ-037a/c/d, REQ-041, REQ-042, REQ-043, REQ-IF-008; MOD-012, MOD-014 | UTP-012-A, UTP-012-B, UTP-012-C, UTP-014-C, ITP-012-A, ITP-012-E, STP-013-A, STP-005-G, ATP-008-A, ATP-008-C, ATP-008-D | ⬜ Untested |
| **HAZ-037** | Insider denial-of-wallet — `sub` exhausts source budget                                               | REQ-039, REQ-019, REQ-040a, REQ-040b, REQ-044a; MOD-013                        | UTP-012-E, UTP-012-F, UTP-012-G, UTP-012-H, ITP-012-C, ITP-012-D, STP-013-C, ATP-008-F, AT-015-A                        | ⬜ Untested |
| **HAZ-038** | Demotion-scorer demand-state unavailable → wrong default                                              | REQ-039; MOD-013 (fail-open-to-availability)                                   | UTP-012-H, ITP-012-C, STP-013-C                                                                                         | ⬜ Untested |
| **HAZ-039** | Token-class confusion (user vs M2M) on wrong surface                                                  | REQ-041, REQ-038b, REQ-038c, REQ-IF-008; MOD-012                               | UTP-012-D, UTP-012-J, ITP-012-B, STP-013-D, ATP-008-G, ATP-008-H                                                        | ⬜ Untested |
| **HAZ-040** | WebSocket `$connect` authorizer cache falls open (replay)                                             | REQ-043, REQ-IF-008; MOD-012                                                   | UTP-012-J, ITP-012-B, STP-013-A, ATP-008-E                                                                              | ⬜ Untested |
| **HAZ-041** | Per-source rolling-window state loss → bounded burst over cap                                         | REQ-019, REQ-020; MOD-005 (+ SYS-012 SC-002 alarm)                             | UTP-005-A, ITP-005-B, STP-006-A, AT-019-A                                                                               | ⬜ Untested |
| **HAZ-042** | Nutritionally-incoherent merge (mismatched bases blended)                                             | REQ-051, REQ-NF-018; MOD-017                                                   | UTP-017-C, ITP-015-A, STP-015-B, AT-051-A                                                                               | ⬜ Untested |
| **HAZ-043** | Wrong-merge — distinct foods unified / out-of-set pick                                                | REQ-048, REQ-049, REQ-050, REQ-050a, REQ-051; MOD-017, MOD-018                 | UTP-017-D, UTP-018-B, ITP-016-B, STP-016-B, AT-MRG5-B, AT-049-B                                                         | ⬜ Untested |
| **HAZ-044** | Source-data poisoning / "longer-wins" amplification                                                   | REQ-051, REQ-055; MOD-015, MOD-017, MOD-021                                    | UTP-017-B, UTP-021-B, ITP-019-A, STP-015-C, AT-051-B                                                                    | ⬜ Untested |
| **HAZ-045** | Untrusted external data stored unvalidated (non-HTTPS/injected)                                       | REQ-055, REQ-024, REQ-NF-018; MOD-008, MOD-021                                 | UTP-021-B, UTP-021-C, ITP-019-A, ITP-019-B, STP-020-A, AT-055-A                                                         | ⬜ Untested |
| **HAZ-046** | Concurrent add-by-name race creates two rows for one food                                             | REQ-005, REQ-013, REQ-047; MOD-016                                             | UTP-016-A, ITP-014-B, STP-018-A, AT-005-B                                                                               | ⬜ Untested |
| **HAZ-047** | User-resolution clobbered by refresh (re-blend overwrite)                                             | REQ-031, REQ-053; MOD-018, MOD-019, MOD-020                                    | UTP-020-A, UTP-019-A, ITP-018-A, STP-019-B, AT-031-B                                                                    | ⬜ Untested |
| **HAZ-048** | `food_candidates` candidate-set integrity loss (duplicate/cross-food candidate, wrong set on resolve) | REQ-048, REQ-049, REQ-050a; MOD-018                                            | UTP-018-B, ITP-016-C, STP-016-B, AT-MRG5-B, AT-049-B                                                                    | ⬜ Untested |
| **HAZ-049** | Stale `UNRESOLVED` candidate set past 30-day expiry / swept to `NOT_FOUND`                            | REQ-025a, REQ-048, REQ-049; MOD-018, MOD-020                                   | UTP-018-A, ITP-016-A, STP-016-A, AT-025a-A, AT-025a-B                                                                   | ⬜ Untested |

---

## Coverage Summary

### Per-matrix coverage

| Matrix | Relation                | Source count         | Covered | %    | Gaps                      |
| ------ | ----------------------- | -------------------- | ------- | ---- | ------------------------- |
| **Ø**  | FR → REQ                | 71 FR                | 71      | 100% | none                      |
| **A**  | REQ → AT/ATP            | 69 functional+IF REQ | 62      | 90%  | 7 acceptance gaps (below) |
| **B**  | REQ → SYS               | 69 functional+IF REQ | 69      | 100% | none                      |
| **B**  | REQ → STP               | 69 functional+IF REQ | 69      | 100% | none                      |
| **C**  | ARCH → SYS              | 19 ARCH              | 19      | 100% | none                      |
| **C**  | ARCH → ITP              | 19 ARCH              | 19      | 100% | none                      |
| **D**  | MOD → ARCH              | 21 MOD               | 21      | 100% | none                      |
| **D**  | MOD → UTP               | 21 MOD               | 21      | 100% | none                      |
| **H**  | HAZ → mitigation        | 49 HAZ               | 49      | 100% | none                      |
| **H**  | HAZ → verification test | 49 HAZ               | 49      | 100% | none                      |

### Chain-completeness checks (per task acceptance criteria)

| Check                                        | Result                                                                                                           |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Every spec FR → ≥1 REQ                       | ✅ 71/71                                                                                                         |
| Every REQ → ≥1 SYS                           | ✅ all functional/IF REQ; NF/CN by Verification Method                                                           |
| Every SYS → ≥1 ARCH                          | ✅ 20/20 (SYS-001..020 each parent ≥1 ARCH)                                                                      |
| Every ARCH → ≥1 MOD                          | ✅ 19/19 (ARCH-012 → MOD-012/013/014)                                                                            |
| Every MOD → ≥1 UTP                           | ✅ 21/21                                                                                                         |
| Every functional REQ → ≥1 STP                | ✅ all functional/IF REQ                                                                                         |
| Every functional REQ → ≥1 ATP                | ⚠️ 7 acceptance gaps (below) — all have STP coverage                                                             |
| Every HAZ → mitigation AND verification test | ✅ 49/49                                                                                                         |
| Auth slice fully connected                   | ✅ REQ-035..044d → SYS-013 → ARCH-012 → MOD-012/13/14 → UTP-012/014 → ITP-012 → STP-013 → ATP-008 → HAZ-036..041 |
| `fdcId` confined to adapter boundary         | ✅ only SYS-009/014, ARCH-008/013, MOD-008/015, REQ-023/046/IF-004, and USDA-adapter test cases                  |

### Test inventory rollup

| Test layer                 | Count | ARCH/MOD/REQ coverage   |
| -------------------------- | ----- | ----------------------- |
| UTP (unit)                 | 72    | 21/21 MOD               |
| ITP (integration)          | 56    | 19/19 ARCH              |
| STP (system)               | 71    | 20/20 SYS               |
| AT / ATP (acceptance)      | 58    | 62/69 functional+IF REQ |
| ATS (acceptance scenarios) | 80    | —                       |

### Genuine coverage gaps (honest disclosure — do NOT paper over)

These are **acceptance-test (AT/ATP) gaps only**; each listed REQ **does** have system-test (STP) and,
where applicable, unit/integration coverage. They are real and should be closed before the V&V gate signs
off, or explicitly waived with rationale.

1. **REQ-011** (demand-path `fetch_queue` INSERT + `pg_notify`) — no `AT-*`. Covered by STP-002-A/C,
   UTP-002-A, ITP-002-A. _Gap: acceptance._
2. **REQ-018** (tombstone / `NOT_FOUND` 30-day TTL retention) — no standalone `AT-*`; touched only inside
   ATS-025-A2. Verification Method _Inspection_; STP-003-C covers it. _Gap: acceptance._
3. **REQ-028** (canonical normalized provenance-bearing schema) — no `AT-*`. Verification Method
   _Inspection_; STP-007-A/017-A/018-B, UTP-006-_, UTP-016-_, UTP-019-* cover it. *Gap: acceptance.\*
4. **REQ-038a** (all authenticated users may read shared food data) — no `AT-*`; ATP-008-G validates only
   REQ-038b–c. STP-013-D covers the read-authz path. _Gap: acceptance (auth slice — should add an AT)._
5. **REQ-042** (async-producer provenance / named IAM principals) — no `AT-*`. STP-005-G, UTP-014-C,
   ITP-012-E cover it. _Gap: acceptance._
6. **REQ-044b/c/d** (load-shed latency under flood / non-secret config / named component) — no `AT-*`;
   Verification Methods are _Test (044b)_ and _Inspection (044c/d)_. STP-013-C/STP-011 cover them.
   _Gap: acceptance — 044b warrants a flood-latency AT._
7. **REQ-IF-006** (per-source API key in Secrets Manager, never exposed) — no `AT-*`. Verification Method
   _Inspection_; STP-009-B/011-A/B cover it; appears in the security-gate checklist. _Gap: acceptance._

> **Closed this stabilization:** REQ-017 (worker lease) now has **AT-018-A** (orphaned `in_flight` row with
> `leased_at` older than 30s reclaimed to `pending`), so it is no longer an acceptance gap — the gap count
> dropped from 8 to 7. The new stabilization sub-IDs REQ-050a (AT-MRG5-A/B/C) and REQ-025a (AT-025a-A/B)
> ship with dedicated ATs and add no gap.

**Intentional non-gaps (documented, not silent):**

- **REQ-030, REQ-032 (Redis-cache portions), HAZ-020/032** — deferred Redis variant, out of the
  lean-launch build (REQ-CN-002); tests exist (STP-008-\*) but are not lean-launch exit criteria.
- **REQ-034 / SYS-010 / ARCH-009 (WebSocket)** — deferred to US-9; Verification Method _Demonstration_;
  ITP-009/STP-010 exist for when it ships. The auth `$connect` contract (REQ-043) is still tested now.
- **REQ-NF-007/011/013** — CI/perf gates verified in the acceptance plan (AT-NF\*), deliberately have no
  STP (not system-behaviour tests).
- **REQ-NF-001..006, 008..010, 014, 015, 017, 019 and REQ-CN-001..006** — Verification Method _Inspection_ or
  _Analysis_; no AT/STP by design.

### Judgment calls made in regeneration

1. **Matrix lettering.** The prior file's "Matrix A" was REQ→AT (validation). To satisfy the task's
   "every spec FR traces to ≥1 REQ" requirement without breaking the established structure, an explicit
   **Matrix Ø (FR→REQ)** was prepended and Matrix A kept as the REQ→AT validation view. Matrices B/C/D/H
   preserve their prior roles (B = REQ→SYS+STP, C = SYS/ARCH→ITP, D = ARCH/MOD→UTP, H = hazards).
2. **MOD-013 UTP numbering.** MOD-013's unit cases are numbered `UTP-012-E/F/G/H` (under the ARCH-012
   group), not `UTP-013-*`. The matrix assigns them to MOD-013 per the unit plan's own coverage summary
   and the test-first task map (a naive `UTP-012-*→MOD-012` regex would mis-assign these four).
3. **Hazard verification-test binding.** `hazard-analysis.md` names mitigations (REQ+MOD) but defers test
   ids to this matrix. Each HAZ's verification column was synthesized by mapping its mitigating MOD/REQ to
   the UTP/ITP/STP/AT case(s) that exercise that control. Where the only credible detection is an alarm
   (e.g. HAZ-029/030/041 → SYS-012/SC-002), the closest behavioural test is cited and the monitoring
   control noted in-row.
4. **`fdcId` confinement.** `fdcId` is annotated _(fdcId boundary)_ on exactly the adapter rows
   (SYS-009/014, ARCH-008/013, MOD-008/015, REQ-023/046/IF-004 and their tests) and appears nowhere in a
   canonical/DTO/API row — verifying REQ-046 / SC-013 at the matrix level.
5. **NF/CN rows.** Non-functional and constraint REQs whose Verification Method is Inspection/Analysis are
   shown with `(method)` rather than a fabricated AT/STP, to avoid asserting coverage that does not exist.
