# Specification Quality Checklist: Public Discovery and Sharing

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-27
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Two markers are open, both owner questions. Q1: the robots rules for AI crawlers (recommended: block training-only
  crawlers, allow search and answer crawlers). Q2: whether 018's chef directory or 012's collection pages are open
  signed out (recommended: neither, for now). Neither blocks planning. FR-008 and FR-028 hold the default until the
  owner answers.
- Readings of the ruling are recorded in Clarifications: clones open by link but are never indexed, Public means on
  the web, every non-open address gets one `404`, and "ping" means IndexNow plus sitemap removal. The 2026-10-27
  reading that `imported_public` stays signed-in only is replaced (Session 2026-11-03, ADR-0082).
- 2026-11-03 (owner rulings, ADR-0082): the rights label, not the source type, decides what opens. Facts cards (the
  linked card and the book card) are readable signed out and indexable under the public rule (owner ruling O2, amended 2026-11-03, ADR-0082). Family recipes and gated public domain
  text open to the web. Cooks get an opt-in CC BY choice. The source card is kept only for an opted-out, capped or
  excluded site. Counsel's list grows (FR-095). GR-014 is amended in the same change (FR-096). No `plan.md` or
  `tasks.md` exists yet, so the spec lists the plan work owed under Dependencies.
- Section J names existing artefacts on purpose: ADR-0047's `bearerOnlyPrecondition` guard, ADR-0020's edge
  passthrough, `isRecipeViewableBy`, `safeReturnPath`, `analyticsRedaction.ts` and ADR-0064's avatar keys. Each is a
  contract this feature must keep or amend, not a free design choice. The read-path shape itself is left to
  `staff-architect` at PLANNING (FR-106).
- Amendments applied in this change: 001 (FR-004, FR-045, FR-045a, C-004, User Story 2, Dependencies, Clarifications)
  and 012 (audience scope, FR-006, FR-007, FR-008, FR-022, FR-026, Dependencies). Listed and not applied: 016,
  ADR-0020, ADR-0064 and `018-FR-017` (FR-092 to FR-097). GR-014 was applied on 2026-11-03 (FR-096).
- `staff-ux-engineer` DESIGN and SPECIFY, `staff-architect` PLANNING, counsel (FR-095) and `ts-1` are plan-time
  dependencies. None has run.
