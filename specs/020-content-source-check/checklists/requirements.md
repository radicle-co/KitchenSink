# Specification Quality Checklist: Content Source Check

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-26
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
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

- Both markers are resolved by the owner (2026-10-26). Q1: photos are in scope, and any photo signal goes to a person.
  Q2: a person decides the unsure case.
- A second round of owner answers (2026-10-26) confirmed that a spent budget waits for a person, overruled the curator
  grant, generalised the skip rule to "every part green", dropped review time targets for now, and made reviewers
  employees. A third ruling added the lookup in our own database (section J). A fourth round answered the
  staff-architect REVIEW's four questions (match precedence, the same-items rule, private-recipe non-disclosure, and
  donation at erasure). Every High and Medium finding of that REVIEW is applied, and ADR-0074 records the decision.
- A fifth round of owner answers (2026-10-26) closed the open items: a recipe in review uses no slot and a
  not-approved one becomes private, the donation deadline is 14 days, there is no random sampling for now, and the
  strict text rule stands. Only counsel items remain (FR-041).
- Some names of existing artefacts appear because the spec amends them: `004-FR-014a`, `016-FR-018`,
  `visibilityPolicy.ts`, `isRecipeViewableBy`, ADR-0024's grantee rule, ADR-0073's slots, `pg_trgm`,
  `normalize-url`, `lambda:SourceFunctionArn`, `first_published_at` and `cloned_from_id`. They name the contract being
  changed or reused, or a library the library-first rule requires, not a free design choice, so they are kept.
