# Gate Review: 004 — Recipe Importing

**Feature**: `004-recipe-importing` · **Mode**: `v-model`
**Last updated**: 2026-08-02
**Risk class**: `high` → routing `block` (explicit approval required; never auto-approved)
**Reviewed SHA**: _uncommitted_ — stamp `gates[].reviewed_sha` on the first commit

> Single consolidated gate surface (`F-NNN` namespace). Findings from the V-model peer reviews and the
> pre-implementation review land here rather than in three documents the reviewer must read in turn.
> Collapse-by-default: the summary is the surface; detail lives in the linked artefacts.

---

## Summary

| Severity          | Total  | Open   |
| ----------------- | ------ | ------ |
| CRITICAL          | 0      | 0      |
| HIGH (Major)      | 3      | 0      |
| MEDIUM (Minor)    | 13     | 2      |
| LOW (Observation) | 12     | 12     |
| **Total**         | **28** | **14** |

**No open finding exceeds MEDIUM.** Nothing blocks implementation.

## Deterministic gate evidence

| Check                                            | Result                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `build-matrix.sh` — traceability `MISSING` cells | **0**                                                                             |
| `validate-requirement-coverage.sh`               | **63 requirements · REQ→ATP 100% · ATP→SCN 100% · `has_gaps: false` · 0 orphans** |
| Matrix A / B / C / D / H coverage                | **100% each**                                                                     |
| Prettier                                         | clean                                                                             |
| `gate-risk.js`                                   | `risk: high`, `routing: block`                                                    |

`risk: high` is expected and correct for this feature: it carries a cross-feature change to shipped 001 code
(T-029), a security-critical egress path (T-010), and a premium entitlement gate (T-031). It routes **how much
is shown**, and never auto-approves.

---

## Open findings

| ID    | Sev    | Source                    | Finding                                                            | Disposition                                                                                                                       |
| ----- | ------ | ------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| F-001 | MEDIUM | peer-review/plan          | `microdata-node` (2022) and `gray-matter` (2023) are dormant       | Accepted with rationale — frozen formats, behind ports, output sanitized + Zod-validated. **Re-evaluate at implementation time.** |
| F-002 | MEDIUM | peer-review/acceptance    | SC-002 corpus size (50) is a judgement, not a derivation           | Held at 50 with a quarterly refresh cadence added instead (D-009) — staleness, not sample size, is the live risk.                 |
| F-003 | LOW    | verify                    | Service OpenAPI contract lives under feature 001's folder          | Deliberate for now (D-016); relocation bundled with the D-015 prefix migration.                                                   |
| F-004 | LOW    | verify                    | FR numbering still collides with shipped 001                       | Mitigated by the mandatory `004-` prefix (D-017); renumber deliberately deferred.                                                 |
| F-005 | LOW    | peer-review/module-design | `import_channel` vs `source_type` distinction is subtle            | Needs a schema-level comment at implementation, not only a design note.                                                           |
| F-006 | LOW    | peer-review/architecture  | Heuristic confidence score is ordinal, not calibrated              | Safe for ordering/flagging; **must not** be used as a numeric auto-accept threshold.                                              |
| F-007 | LOW    | peer-review/hazard        | `robots.txt` interpretation encodes our reading of intent          | D-007 records the reasoning and counts every block so it is revisitable on evidence.                                              |
| F-008 | LOW    | peer-review/system-design | "Consumed, not built" is a convention, not a compile-time boundary | `REQ-CN-007` + `ITS-006-C1` assert it; enforcement is review-time.                                                                |
| F-009 | LOW    | peer-review/module-design | `MOD-026` is deliberately anaemic                                  | Intentional (`REQ-CN-007`); its JSDoc must say why, or it reads as pointless indirection.                                         |
| F-010 | LOW    | peer-review/acceptance    | Non-waivable procedures must survive schedule pressure             | **Ratified as D-018** — deviation is now visibly a decision reversal.                                                             |
| F-011 | LOW    | peer-review/system-test   | Third-party sources are faked; the corpus is a static snapshot     | Compensating control is the D-009 refresh cadence.                                                                                |
| F-012 | LOW    | peer-review/integration   | Two vendors faked even at the integration tier                     | Pinning contract tests catch shape drift, not semantic drift.                                                                     |
| F-013 | LOW    | plan                      | D-015 prefix migration is scoped but **not done**                  | Three deployed services, two clients, both apps, ALB rules. Own change.                                                           |
| F-014 | LOW    | plan                      | 004 requires an additive change to shipped 001 code (T-029)        | Called out in the spec as a cross-feature dependency; `POST /v1/recipes` behaviour unchanged.                                     |

## Resolved findings (14)

Three HIGH and eleven MEDIUM, all closed during the 2026-08-02 reconciliation. Full detail in
[`v-model/peer-review.md`](./v-model/peer-review.md).

Highlights worth carrying into implementation:

- **F-101 (HIGH)** — draft-and-confirm is **forced by the shipped schema**, not a UX preference. Resolved by
  stating the constraint explicitly and recording it in Complexity Tracking.
- **F-102 (HIGH)** — OCR at P1 concentrates the release's privacy exposure. Resolved with `HAZ-035`/`HAZ-036`
  and image-lifetime controls bound to tasks.
- **F-103 (HIGH)** — a gated P1 requirement is contradictory without stated release semantics. Resolved by the
  Gating section (D-002).
- **F-110 (MEDIUM)** — the SSRF hazard cited a 404-handling requirement and reached **no task at all**. Now
  `REQ-NF-009` → `ARCH-006` → `MOD-006` → `T-010`, with a mutation test that fails if the guard is removed.
- **F-111 (MEDIUM)** — the acceptance plan was unparseable by the deterministic builder; the 100% coverage
  claim was an assertion no tool could confirm. Now generated output.

---

## Conditions carried into implementation

1. Implement test-first in `tasks.md` dependency order. Every task now declares `Test-first: true` with the
   specific tests that must be **confirmed failing** first.
2. **No waiver for the Catastrophic-hazard procedures** (`REQ-NF-009`, `REQ-027`, `REQ-IF-004`) — D-018.
3. The SC-002 corpus (T-027) must exist and gate CI before `REQ-NF-003` may be claimed.
4. Re-evaluate F-001 (dormant dependencies) when the extractors are built.
5. Regenerate `v-model/release-audit-report.md` **only** after real execution evidence exists.
