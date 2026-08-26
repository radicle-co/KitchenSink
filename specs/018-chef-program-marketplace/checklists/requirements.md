# Specification Quality Checklist: Chef Program & Marketplace Monetization

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain — **3 open** (`C-018-001`, `C-018-002`, `C-018-003`)
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined — US7's are deferred **by decision**, not omission
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

**Iteration 1 (2026-08-26)** — two defects found and fixed before this pass was recorded:

1. **Mis-cited cross-feature FRs.** `002-FR-035` (suspension) and `002-FR-042` (impersonation) were both
   wrong — `002-FR-042` is the suspended-user `403`, and impersonation is `002-FR-036`/`002-FR-037`.
   `002`'s own Out-of-Scope prose carries the same mis-citation, which is how it propagated. Corrected at
   every site. This is exactly the class `GR-003` AC-003-a and `cross-feature-FR-index.md` Review Rule 2
   exist to catch.
2. **Implementation detail leaked into `FR-027`** — it named a shipped source module by symbol. Rewritten as
   a governance citation (`GR-014` AC-014-e, `ADR-0023`) that carries the same binding without instructing
   the implementation.

**The three open markers are deliberate and each occupies a slot on merit:**

- `C-018-001` (what may be sold) — **scope**. Collides head-on with a ratified governance rule (`GR-014`,
  `AC-014-d`) and with `012`'s explicit withdrawal of the paid-recipe model. No defensible default exists.
- `C-018-002` (seller of record) — **one-way door**. Determines tax, refund liability, licensing posture and
  the consumer contract. Nothing in Section E, F or G can be written before it.
- `C-018-003` (free-visitor revenue) — **scope + product identity**. The recorded business model names
  commerce, not advertising; the two differ by an order of magnitude in consent surface.

Per the `/speckit-specify` limit of three, a fourth candidate — **chef eligibility and vetting** — was
resolved by informed default instead (Assumption 1: application + human review), on the grounds that
self-declaration would make "chef" a synonym for `012`'s existing free `@handle`, and that human review is
what makes `FR-053`'s seller-identity collection meaningful.

**Blocking status**: `/speckit-clarify` or an owner ruling on the three questions is required before
`/speckit-plan`. Sections A, B, C, F, G, I, J and K are unblocked and complete.
