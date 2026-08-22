# Specification Quality Checklist: Publishing Rewards

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Status**: ⏸️ PAUSED — see [`../research-brief.md`](../research-brief.md)
**Created**: 2026-08-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain _(all three resolved 2026-08-22; four new open items are tracked as UNDEFINED markers in the research brief, not as clarifications)_
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

### Validation record — iteration 2 (2026-08-22)

**Owner answered all three questions.** Q1 = replace (free users get privacy; both tiers rewarded, never
monetary). Q2 = structural completeness. Q3 = moot — a slot grant is permanent, so nothing is consumed. Four
further decisions were added: zero starting slots, permanent grants, a 50-recipe ceiling for free accounts, and
two reward currencies rather than one.

**Status changed to PAUSED.** The spec is **not** ready for `/speckit-plan`. Resolving the three questions
opened four new ones, which are recorded in [`../research-brief.md`](../research-brief.md):

| §   | Open question                                                 | Blocks                                       |
| --- | ------------------------------------------------------------- | -------------------------------------------- |
| 1   | Reward schedule — slots per publication, earn-rate limit      | `FR-007a`, `FR-010` carry UNDEFINED          |
| 2   | What status & recognition concretely is, and who sees it      | `FR-007e` is a non-implementable placeholder |
| 3   | Mitigating the zero-slot start's first-publication toll       | Recorded risk, deliberately unpriced         |
| 4   | Incentives that reach premium; whether two currencies suffice | Owner: "we might need more incentives"       |

**One derived decision needs owner confirmation.** C-015-005 (privacy mandated by provenance never consumes a
slot) was reasoned by this spec from C-015-004, not stated by the owner. It is flagged in both documents.

**One gap found in our own prior legal analysis, now logged.** Every legal question examined so far concerned
_hosting_ third-party content. A reward programme moves the analysis toward **inducement**, and §512(c)(1)(B)'s
"direct financial benefit … right and ability to control" prong deserves a fresh look now that uploads are
being deliberately incentivised. This was not considered when the spec was written. Research agenda item 4.

---

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
