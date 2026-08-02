# Traceability Narrative: Recipe Importing

**Feature Branch**: `004-recipe-importing`
**Regenerated**: 2026-08-02
**Purpose**: the human-readable companion to `traceability-matrix.md` — it explains _why_ the chain holds,
where it is weakest, and what would break it. The matrix proves coverage; this document argues it.

## The chain

```
Business need  →  spec.md FR  →  v-model REQ  →  SYS  →  ARCH  →  MOD  →  code
                                     ↓            ↓       ↓        ↓
                                    ATP          STP     ITP      UTP
                                     ↑____________↑_______↑________↑
                                          hazard controls (HAZ)
```

Every link is bidirectional: no requirement without a business need, no design element without a requirement,
no test without something to verify, and — the direction most often skipped — **no hazard control without a
task that implements it**. That last link is the one the previous document set lacked entirely.

## Forward trace — from need to verification

### Need 1: "Bring recipes I already have into Commise"

`FR-008` (URL), `FR-009` (Instagram), `FR-012` (photo), `FR-019` (file) → `REQ-001`..`REQ-007` → `SYS-001`
(fetch), `SYS-002` (extract), `SYS-003` (Instagram), `SYS-004` (OCR), `SYS-005` (file) → `ARCH-005`..`ARCH-017`
→ `MOD-005`..`MOD-017` → `ATP-001`, `ATP-005`, `ATP-008`, `ATP-010`.

**Weakest link**: `FR-009`. It depends on a credential we do not control (D-002). The chain is complete but
its terminal test runs against a contract fake, so the requirement is _verified in structure, not against the
real provider_, until the credential exists. This is stated rather than hidden.

### Need 2: "Don't make me retype what the page already says — but don't invent what it doesn't"

`FR-015`, `FR-020`, `FR-021` → `REQ-008`..`REQ-013` → `SYS-006` (normalize), `SYS-010` (drafts) →
`ARCH-018`..`ARCH-021`, `ARCH-025` → `MOD-018`..`MOD-021`, `MOD-025` → `ATP-002`.

**This need did not exist in the previous document set.** It was discovered by reading the shipped schema:
`recipes` requires servings, three times, ≥1 ingredient, and ≥1 step as NOT NULL with CHECK constraints, while
schema.org guarantees none of them and delivers ingredients as free text against a
`numeric(10,3) CHECK (> 0)` column. Without this branch of the tree, the feature could not have been built as
specified — it would have had to fabricate values.

**Strongest link**: `HAZ-040` → `REQ-011` → `MOD-020` → `UTS-020-a3`/`c1` → `ATS-002-d`. The prohibition on
defaulting an absent value is asserted at the unit, system, and acceptance levels, because a fabricated `0`
would pass every database constraint and be indistinguishable from a real one downstream.

### Need 3: "Credit the source, and respect what may not be republished"

`FR-010`, `FR-011`, `FR-013`, `FR-014`, `FR-014a` → `REQ-014`..`REQ-023` → `SYS-007` (provenance), `SYS-008`
(blocklist), `SYS-013` (attribution UI) → `ARCH-022`, `ARCH-023`, `ARCH-030` → `MOD-022`, `MOD-023`, `MOD-030`
→ `ATP-003`, `ATP-004`, `ATP-006`, `ATP-009`.

**Deliberately short link**: visibility _enforcement_ terminates at 001's shipped `evaluateVisibility` rather
than continuing into 004. `REQ-015` and `REQ-CN-007` make that termination a requirement, and `ITS-006-c1`
asserts it. A longer chain here would be a _defect_, not better coverage — it would mean two authorities for
one rule.

### Need 4: "Don't let this feature hurt us"

No user asked for this; it comes from the architecture. Importing is the first surface that performs outbound
HTTP to arbitrary user-supplied hosts and then persists third-party content.

`NFR-006`..`NFR-010` → `REQ-NF-007`..`REQ-NF-012`, `REQ-018`, `REQ-027`, `REQ-028` → `SYS-001`, `SYS-010`,
`SYS-011` → `ARCH-005`, `ARCH-006` → `MOD-005`, `MOD-006` → `UTP-005`, `UTP-006` → `ATP-012`.

**Strongest link in the document set**: `HAZ-003` (SSRF, Catastrophic) → `REQ-NF-009` → `ARCH-006` → `MOD-006`
→ `UTS-006-a1..c1` **and** `UTS-005-f1` (a mutation test that fails if the guard is removed) → `ITS-003-b1..b3`
→ `STS-001-d1..d5` → `ATS-012-a`/`b`, which permits no waiver.

For contrast, in the previous document set this same hazard traced to `REQ-014` — a requirement about 404
handling — and to **no task at all**. The control existed only as a sentence in the FMEA.

## Backward trace — nothing orphaned

| Question                                          | Answer                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Any REQ without a business need?                  | No. All 54 trace to an FR, an NFR, a constitution principle, or a hazard control.           |
| Any SYS without a REQ?                            | No. All 13 carry parent requirements.                                                       |
| Any ARCH without a SYS?                           | Two by design — `ARCH-033`/`ARCH-034`, tagged cross-cutting with rationale.                 |
| Any MOD without an ARCH?                          | No. 34 ↔ 34.                                                                                |
| Any test without something to verify?             | No.                                                                                         |
| Any hazard without a control, a task, and a test? | No — 55/55. **This was the previous set's largest gap.**                                    |
| Any requirement with no acceptance coverage?      | Two (`REQ-NF-001`, `REQ-NF-002`), both declared verification method _inspection_, not test. |
| Any 004 component duplicating shipped 001 code?   | No — verified by inspection against `main` and asserted by `REQ-CN-007`.                    |

## What would break this chain

1. **Adding a recipe-write path outside `MOD-026`.** Every attribution, provenance, and visibility guarantee is
   downstream of the single confirmation bridge. A second write path silently voids `REQ-014`..`REQ-016` and
   `REQ-CN-003`, and no existing test would catch it — the tests assert the bridge behaves, not that it is
   unique. `ITS-006-c1` is an inspection, not a runtime assertion. **This is the chain's most fragile point.**
2. **Skipping normalization on a new channel.** Sanitization (`MOD-021`) and the missing-field computation
   (`MOD-018`) are enforced by _placement_ — every channel traverses them. A channel wired directly to the
   draft store bypasses both. `ITS-005-b2` exists to catch this and must be maintained as channels are added.
3. **Weakening the dedup index to a plain unique constraint.** Dropping the `deleted_at IS NULL` predicate
   permanently blocks re-import after deletion (`HAZ-045`); dropping the index altogether reduces dedup to a
   racy read-then-write (`HAZ-018`).
4. **Treating the heuristic confidence score as calibrated.** It is ordinal. Using it as a numeric auto-accept
   threshold would silently bypass the draft review that the whole model depends on.
5. **Letting the SC-002 corpus rot.** It is a static snapshot of a moving target. An unrefreshed corpus will
   keep reporting 85% long after real-world accuracy has drifted.

## Chain health

| Metric                                 | Value   | Previous |
| -------------------------------------- | ------- | -------- |
| Traceability rows                      | 253     | 56       |
| Missing mapping cells                  | **0**   | 43       |
| Hazards traced to an implementing task | 61 / 61 | 0 / 30   |
| Requirements with acceptance coverage  | 53 / 55 | 0 / 28   |
| Orphaned design elements               | 0       | unknown  |
| Scenarios executed                     | 0 / 253 | 0 / 93   |

Coverage is complete; execution has not started. Those are separate claims, and this document asserts only the
first.
