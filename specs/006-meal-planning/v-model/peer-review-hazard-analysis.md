# Peer Review — hazard-analysis

**Reviewer**: AI Peer Review (spec-kit V-Model)
**Date**: 2026-05-10 | **Re-reviewed**: 2026-08-02
**Artifact**: `hazard-analysis.md` (43 hazard ids allocated; 26 active, 17 superseded)
**Standard**: ISO 14971 / ISO 26262 (commercial software FMEA profile, non-regulated)

## Summary

| Severity           | Count |
| ------------------ | ----- |
| Critical           | 0     |
| Major              | 0     |
| Minor              | 1     |
| Observation        | 3     |
| **Total Findings** | **4** |

**Verdict**: ✅ Pass (post-fix).

## Findings

### PRF-006-19 · MINOR — Hazard-id collision, found and fixed during this review

The SYS-009 row was authored as `HAZ-034b · HAZ-037`, duplicating `HAZ-034` (already allocated to the socket-leak hazard
under SYS-007) and breaching the document's own "unique, never renumbered" rule. Two consequential errors followed:
`HAZ-014`'s forward reference pointed at `HAZ-034` rather than the template hazard, and `HAZ-007` was annotated
"re-scoped — see HAZ-030", where HAZ-030 concerns idempotency transactions and has nothing to do with slot mapping.

**Disposition: RESOLVED.** The id is now `HAZ-037`; the `HAZ-014` reference is corrected; `HAZ-007` is restated as an
active hazard with its own mitigation and residual rating. A uniqueness check over all `HAZ-` ids passes.

This is exactly the class of defect the May review should have caught in its own artifact and reported zero of.

### OBSERVATION — Hazards eliminated by simplification are tabulated separately, and should be

Four hazards vanish because their components do (cache, stored rollup, recurrence, ingredient manifest). ISO 14971 §7
treats risk _reduction by design_ as preferable to risk _control by mitigation_; the document makes that argument
explicitly rather than leaving the reader to notice four missing rows. This belongs in the release audit.

### OBSERVATION — Superseded hazards retain their reasoning, including one whose mitigation was wrong

`HAZ-012` (premium guard bypass) is deferred **and** annotated that its May mitigation — "ARCH-018 token tier
extraction" — was factually wrong, because `tier` is not a token claim. Recording _why a mitigation was invalid_ is more
useful than deleting the row, and it directly warns whoever reinstates the hazard when 010 ships.

### OBSERVATION — The new hazards concentrate where the May analysis was structurally blind

Nine of the fifteen new hazards (HAZ-030..HAZ-037, HAZ-043) concern degradation, transactional atomicity and
database-enforced bounds. The May analysis could not see these because it modelled a dependency as either working or
absent, with no partial state — the same conceptual gap that produced a boolean availability flag in the architecture.

## Verification performed

- All 9 Phase-1 SYS components have ≥ 1 hazard (100%).
- **Uniqueness check over all `HAZ-` ids: passes** (post-fix).
- Every active hazard cites at least one real `REQ-*` / `MOD-*` / ADR id — no dangling references.
- Every active hazard has ≥ 1 mitigating test in Matrix H (26/26).
- Every `Undesirable` hazard has tests at ≥ 2 tiers.
- No hazard remains at `Unacceptable`.
- Both `Catastrophic × Improbable` hazards (HAZ-020, HAZ-041) carry explicit residual-risk acceptance with named
  compensating controls, as the disposition rule requires.
