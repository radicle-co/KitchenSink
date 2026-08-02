# Revalidation Log: Feature 004 — Recipe Importing

**Branch**: `004-recipe-importing`
**Status**: ✅ **Approved — revalidation complete**
**Milestone**: `M1` Rivendell · **Public launch**: Beta (end of `M4`)
**Launch plan**: [`v1-launch-plan.md`](../v1-launch-plan.md)

---

## Purpose

Records the revalidation cycle for feature 004: feedback, corrections applied, and explicit approval markers.

---

## Revision Log

### Revision 0 — Initial bootstrap (2026-05-09)

Product Forge artefacts were retroactively layered onto pre-existing `spec.md`, `plan.md`, `tasks.md`, and
`v-model/requirements.md`. Three findings were raised and three human decisions requested. **None were
answered, and the gate stayed open for three months** while downstream artefacts continued to be generated on
top of the unresolved questions.

### Revision 1 — Reconciliation and revalidation (2026-08-02)

**Trigger**: owner request to review 004 against latest `main` and validate readiness for implementation.

**What the review found.** The document set was internally coherent but had drifted badly from the codebase.
Nine issues were material:

1. **~40% of 004's stated scope had already shipped in 001** (PR #73, merged 2026-07-30) — the attribution
   columns, `source_type` domain, clone endpoint, and the entire C-004 visibility policy. The plan proposed
   re-adding four existing columns under rival names and rebuilding two shipped services.
2. **Every file path in `tasks.md` was wrong** — targeting `packages/api/recipe/` (contains only `.gitkeep`)
   and `packages/shared/db/` (does not exist).
3. **The plan's primary extraction dependency did not exist** — `schema-org-js` returns 404 from the registry.
4. **The Instagram assumption was factually wrong** — the public unauthenticated oEmbed endpoint was withdrawn
   in 2020; a Meta credential and App Review are prerequisites, not a later enhancement.
5. **No SSRF control anywhere in the plan or tasks**, while the hazard analysis rated it Catastrophic.
6. **No k6, Maestro, or per-state component tests** — a violation of the absolute test mandate.
7. **Requirements text was corrupt** and its counts disagreed three ways; all nine peer reviews reported zero
   findings.
8. **The shipped schema makes direct import impossible** — `servings`, times, ≥1 ingredient and ≥1 step are
   NOT NULL with CHECKs, and ingredient quantities are numeric, while extraction yields free text and frequent
   omissions. Nothing in the document set acknowledged this.
9. **Cross-platform parity was violated** — attribution had no mobile counterpart and mobile import was a P2
   dependent on the web P1.

**Owner decisions recorded (2026-08-02)** — these resolve the three inputs pending since May, plus one raised
by the review:

| ID    | Question                        | Decision                                                                                                                                       |
| ----- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| D-001 | OCR launch scope (P1 vs P3)     | **Ships at launch at P1.** Provider: AWS Textract, behind an `OcrProvider` port.                                                               |
| D-002 | Instagram, given the Meta gate  | **Specify fully, gate behind approval.** Ships disabled; release does not depend on it.                                                        |
| D-003 | FR-014a paid-source enforcement | **Attestation + citation + advisory heuristics.** A non-public cited source forces private. Heuristics flag for review only, never adjudicate. |
| D-004 | Blocklist governance            | **Database table + admin endpoint** with an audit trail. Updating it is an operational action, not a release.                                  |

**Corrections applied**: all 26 documents in this feature were regenerated or revised. The architecture now
consumes 001's shipped capabilities instead of duplicating them; a draft-and-confirm model was introduced
because the shipped schema forces it; the library survey was verified against the npm registry; SSRF,
sanitization, idempotency, and SLOs became requirements with tasks and tests; traceability went from 43 missing
cells to zero; and every user-facing task now pairs web and mobile.

**Residual risk, stated plainly**:

- FR-009 cannot be verified against the real provider until the Meta credential exists.
- Two chosen libraries are dormant (`microdata-node`, `gray-matter`) — accepted with rationale, open as MIN-006.
- The SC-002 corpus size is a judgement, not a derivation (MIN-007).
- OCR at P1 concentrates the release's privacy exposure (MAJ-002, controlled but real).
- `REQ-CN-007` (no second recipe-write path) is enforced by review and inspection, not by a compile-time
  constraint. `trace.md` names this as the chain's most fragile point.

---

## Approval Gate

**Decision**: ✅ **Approved for implementation**
**Reviewer**: Owner (webb.c.brandon@gmail.com)
**Date**: 2026-08-02

**Conditions carried into implementation**:

1. Implement test-first in the `tasks.md` dependency order. T-010 (SSRF) has its security tests written before
   the fetcher exists.
2. The SC-002 corpus (T-027) must exist and gate CI before REQ-NF-003 may be claimed.
3. No waiver is permitted for ATP-012 (the Catastrophic-hazard procedures).
4. Re-evaluate MIN-006 (dormant dependencies) at implementation time.
5. Regenerate `release-audit-report.md` **only** after real execution evidence exists.
