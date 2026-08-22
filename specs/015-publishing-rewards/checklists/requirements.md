# Specification Quality Checklist: Publishing Rewards

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-21
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

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`

### Validation record — iteration 1 (2026-08-21)

**Issues found and fixed in-place before this checklist was finalised:**

1. **Implementation leak (Content Quality).** Draft FR-003 read "decided by a single pure policy function,
   mirroring `evaluateVisibility`". Rewritten as a behavioural requirement — the eligibility shown, applied and
   reported can never disagree — with no reference to how that is achieved.
2. **Untestable success criterion (Requirement Completeness).** Draft SC-005 read "the corpus grows with
   willing contributors". Replaced with a directional pair that can actually be measured: share contributed
   voluntarily rises, and reports of unintended publication fall to zero.
3. **Missing reversal semantics (Feature Readiness).** The draft granted rewards but never said what happens to
   a grant when the recipe is edited or deleted. Both are now stated in Edge Cases: the grant stands in both
   cases, because neither is a violation.
4. **Ambiguous scope boundary.** "Publishing" was used to mean both _making public_ and _earning_. FR-001 now
   states explicitly that this feature restricts **earning**, not publication — publication remains governed by
   001's C-004 visibility policy.

**Deliberately open — 3 [NEEDS CLARIFICATION] markers remain**, at the documented maximum, all in the
"Clarifications Needed" section:

| Q   | Topic                                                    | Why it has no reasonable default                                                                                                          |
| --- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Replace or coexist with the privacy paywall              | Scope-level. Owner decision (D4a) not yet made; the answer changes whether this feature is a fix or an aggravation of the Art. 25(2) risk |
| Q2  | Eligibility floor for earning                            | Determines corpus quality vs. farming resistance; three defensible answers with materially different UX and cost                          |
| Q3  | Whether unpublished-but-rewarded recipes consume the cap | Directly trades off against FR-012's non-coercion intent; either answer is defensible and they cannot both hold                           |

Q1 is **blocking for planning** — the feature's premise depends on it. Q2 and Q3 are blocking for
implementation but not for `/speckit-plan`.
