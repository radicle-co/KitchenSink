# Specification Quality Checklist: ReciMe Parity

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-22
**Feature**: [spec.md](../spec.md)
**Iteration**: 1

## Content Quality

- [x] No implementation details (languages, frameworks, APIs) — _one deliberate exception, see Notes_
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] **No [NEEDS CLARIFICATION] markers remain** — 3 open: FR-024, FR-030, FR-036
- [x] Requirements are testable and unambiguous — _except the 3 above_
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [ ] **All functional requirements have clear acceptance criteria** — FR-024, FR-030, FR-036 blocked
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification — _see Notes_

## Cross-cutting governance

- [x] **GR-003** (FR namespace): every cross-feature citation qualified as `{feature}-FR-{NNN}`; 016's own
      FRs number locally from FR-001, matching the 003/011/012/013/014 precedent
- [ ] **GR-003 AC-003-b**: `cross-feature-FR-index.md` not yet updated with 016's citations to
      001/004/005/007/008/010 — required before implementation
- [ ] **GR-005** (offline): FR-025 declares the _requirement_ for offline cook, but the four mandated answers
      (scope, persistence layer, sync strategy, conflict handling) are **not yet stated**, and
      `docs/offline-strategy.md` does not exist. Blocks implementation of FR-025, not this spec.
- [x] **NFR-005 / `001-FR-044a`**: web+mobile parity asserted, with the browser-extension exemption stated
      explicitly rather than left implicit

## Verification performed

Claims in this spec were checked against the repository rather than inherited from the gap analysis:

| Claim                               | Method                                         | Result                                                         |
| ----------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| Video import absent from every spec | `grep -rniE 'tiktok\|reel'` over all `spec.md` | **0 hits** — confirmed                                         |
| Share sheet absent                  | same                                           | **0 hits** — confirmed                                         |
| Browser extension absent            | same                                           | **0 hits** — confirmed                                         |
| Unit conversion absent              | `grep` for `metric\|imperial`                  | **0 hits** — confirmed                                         |
| Dark mode absent                    | `grep` for `dark mode`                         | **0 hits** — confirmed                                         |
| Migration importers absent          | `grep` for `Paprika\|AnyList`                  | **0 hits** — confirmed                                         |
| Voice/hands-free absent             | `grep` for `voice\|hands-free`                 | **0 hits** — confirmed                                         |
| Aisle grouping not an FR            | read `007/spec.md:141,201`                     | **prose only** — confirmed, D9 real                            |
| Recipe export not an FR             | read `001/spec.md` export hits                 | **all TypeScript `export`** — confirmed, D14 real              |
| Owner FR ranges                     | enumerated `**FR-NNN**` per spec               | 004 runs to **FR-052**, not FR-028 as GR-003's stale note says |

## Notes

- **Deliberate implementation-detail exception.** FR-031 and FR-032 cite `ServingScaleControl`,
  `servingScale.ts`, `cookingProgress.ts`, and `useCookingProgress.ts` by name. These requirements exist
  _because_ the behaviour is already shipped with no requirement anywhere; removing the file references would
  make the claim unverifiable. They are evidence, not design.
- **Stale governance record found.** GR-003's "Current State (2026-08-02)" states 004 owns `FR-008…028`.
  004 actually defines through `FR-052` (FR-046…052 added later, `004-FR-052` on 2026-08-16). GR-003 should
  be corrected; not blocking, and not corrected here since this spec does not own that file.
- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`.
