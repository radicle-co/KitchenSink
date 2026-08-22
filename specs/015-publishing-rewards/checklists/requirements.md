# Specification Quality Checklist: Publishing Rewards

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Status**: ✅ VALIDATED — ready for `/speckit-plan` (launch still blocked on D4a/D5/D24/ToS licence)
**Created**: 2026-08-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain _(all three answered by the owner 2026-08-22 — `C-015-017` zero start re-affirmed, `C-015-018` standing public, `C-015-019` cook counter hidden until first cook)_
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

### Validation record — iteration 4 (2026-08-22, clarifications + owner correction)

**Three questions answered, three markers cleared.** `C-015-017` (zero start **re-affirmed** with the
endowed-progress counter-evidence in hand — the argument has been made and declined, and must not be re-opened
on that basis), `C-015-018` (standing public on the 012 profile, no rank), `C-015-019` (cook counter hidden
until the first cook, with a view count explicitly rejected as a substitute).

**One substantive defect found by the owner, mid-pass, and fixed.** The spec incentivised users who _need_
privacy and quietly failed the users who already _have_ it. Recognition was specified to reach both tiers, but
it is keyed on **impact**, and impact requires an audience a first-time publisher has not got — so a premium
account had a reward available in principle with no route to it, and the free tier's on-ramp (front-loaded
slots) is worth nothing to them. The research dossier held the evidence and drew the boundary in the wrong
place; it is corrected in place rather than quietly patched, with the provenance of the correction recorded.

Closed by `FR-007l` (first-publication milestone — a deliberately narrow carve-out from `FR-007g`, safe only
because a threshold of one cannot be farmed), `FR-007m` (reciprocity signal, bounded hard against
debt/deficit/obligation framing), and `FR-007n` (recognition parity across tiers). Covered by **User Story 6**,
tested by `SC-013`–`SC-015`, recorded as `C-015-020`.

**Final counts**: 47 functional requirements, 15 success criteria, 6 user stories, 20 clarifications, 2
recorded risks (both accepted with mitigations and tests, neither outstanding).

---

### Validation record — iteration 3 (2026-08-22, research pass)

**All four open sections closed with evidence.** `research/reward-psychology.md` was written from primary and
well-attributed sources and consumed directly by the spec: the reward schedule (`FR-007a`) and rate limit
(`FR-010`) are now concrete, `FR-007e` is replaced by four implementable requirements (`FR-007f`–`FR-007i`)
plus a handoff rule (`FR-007j`), premium reach is answered (`FR-007k`), and seven anti-manipulation
requirements (`FR-025`–`FR-031`) plus the 012 boundary (`FR-032`) were added. **No UNDEFINED markers remain.**

**Issues found and fixed during this iteration:**

1. **A brief that outlived its accuracy.** `research-brief.md` still presented §1/§2/§4 as open after they were
   decided. Left in place (it holds the reasoning that produced the questions) but banner-marked SUPERSEDED per
   section, with the resolution stated inline. A stale entry-point document is worse than no entry point.
2. **An unverifiable citation caught before it was written down.** A machine summary of the Anderson et al.
   badge paper produced specific post-badge decay figures and quoted phrases that could not be confirmed
   against the text. They are **excluded**; only the paper's robust steering-and-substitution result is cited,
   and the exclusion is noted in the dossier so nobody re-adds them.
3. **A legal constraint asserted in conversation that does not hold.** EU AI Act Art. 5 was named as binding on
   this feature. It is scoped to **AI systems** and does not apply. Corrected in `C-015-015`; `FR-025`–`FR-031`
   are written against DSA Art. 25 and the Digital Fairness Act, which do apply.
4. **The `FR-007c` ceiling was vestigial again.** Nothing tied the schedule to 50, so the two could drift. The
   schedule now terminates at exactly 50 — one fact, not two.
5. **A cliff nobody had named.** The finite slot currency terminates by design, which makes the ceiling a
   scheduled withdrawal of the free tier's primary incentive. Recorded as a risk, mitigated by `FR-007j`, and
   tested by `SC-011`.

**Requirements-completeness note.** The three remaining markers are deliberate. Q1 reverses a stated owner
decision and so cannot be taken unilaterally; Q2 determines a public surface and is expensive to reverse; Q3 is
small but genuinely has no default that is obviously right. Everything else was decided from evidence and
documented rather than escalated.

**Still outstanding from iteration 2**: C-015-005 remains derived-not-stated and awaits owner confirmation.
The inducement gap logged in iteration 2 is now **closed** to the level a spec can carry (`C-015-016`), with
counsel review recorded as a launch prerequisite.

---

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
