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

### Validation record — iteration 6 (2026-08-22, second `/speckit-clarify` pass)

**1 question asked, 1 answered** (session total 4 of 5). The second pass was run deliberately rather than
declared unnecessary, and re-examined the categories iteration 5 had marked **Clear** — which is where the
finding was.

- `C-015-024` — **new `FR-010b`: an owed grant must survive a transient failure.** This was an
  **unrecoverable** hole and iteration 5 rated Edge Cases & Failure Handling "Clear" on the strength of the
  Edge Cases list. `FR-005` permits one grant per recipe lifetime, so a grant lost when the publication
  committed but the grant write failed was lost **permanently** — republishing cannot re-trigger it and
  `FR-012` forbids re-issue. Publication now always commits; the obligation plus its frozen eligibility
  decision is durable and retried idempotently.
  **Atomicity was rejected on the spec's own evidence**: `FR-007c`, `FR-010` and `FR-011` each state that
  publication succeeds even when no grant is made, so binding the grant into the publication transaction
  would let a reward outage block publishing outright.
- `C-015-025` — **`FR-010c`, DERIVED not asked**: a failed read of reward state surfaces as _unavailable_,
  never as a zero balance, because "0 slots" is a false denial of an earned benefit. Taken from `plan.md` §8.
  **Flagged for owner confirmation**, same standing as `C-015-005`.
- **New edge case**: erasure cancels any pending `FR-010b` obligation. A retry landing after erasure would
  recreate records for an erased user and breach `FR-021` — durability must not outlive the account. Recorded
  rather than asked, because resurrecting erased data has no defensible alternative.

**Downstream propagation done**: `TC042b` (fault-injection durability test), `TC042c` (read-failure render),
`SC-017`, and both new FRs in `traceability.yml`. Counts now 50 FRs, 17 SCs, 52 tasks.

**Checklist state: 16/16 → 16/16.** No item changed state.

⚠️ **Two requirements are now derived rather than owner-stated** and both are flagged in the spec:
`C-015-005` (provenance-mandated privacy never consumes a slot) and `C-015-025` (`FR-010c`). Neither is a
checklist failure — they are recorded, attributed, and awaiting confirmation — but they should be confirmed
before implementation, not discovered during it.

---

### Validation record — iteration 5 (2026-08-22, `/speckit-clarify` pass)

**Run out of order, deliberately.** Clarify is designed to precede `/speckit-plan`; here it ran after plan,
tasks and the migration plan already existed. Every answer was therefore checked for downstream rework and the
impact recorded inline in the spec's Clarifications.

**3 questions asked, 3 answered** (quota is 5; stopped early because the remaining candidates — a latency
target for the reward read, and observability signals — are plan-level and change neither architecture nor
acceptance tests).

- `C-015-021` — **`FR-006` near-duplicate is now defined**: normalized-title equality OR identical resolved
  ingredient set, deterministic, explainable. Fuzzy similarity explicitly rejected, because a false positive
  denies a legitimate grant and cannot be explained to the user.
- `C-015-022` — **`FR-007c` scope corrected**. This was a genuine **contradiction**, not a gap: "MUST NOT
  hold more than 50" read literally required force-publishing a downgraded premium user's private recipes.
  Now gates the _transition_ to private and never touches existing state, matching the shipped C-004 rule.
- `C-015-023` — **new `FR-010a`**: grant issuance is atomic and serialized per account, and the bound must
  hold under arbitrary concurrency. The spec previously said nothing about concurrency, so a read-then-write
  implementation would have been _conforming and wrong_ — and `FR-007b` makes an over-grant permanent and
  uncorrectable.

**⚠️ An item was wrongly checked in iteration 4.** "Requirements are testable and unambiguous" was marked
passing, yet this pass found one untestable requirement (`FR-006`), one self-contradictory one (`FR-007c`),
and one missing entirely (concurrency). It passes **now**; it did not then. Recorded because a checklist that
is marked green by the same pass that wrote the spec is worth exactly nothing — the failure mode is the
checklist agreeing with its author.

**One self-correction inside this pass**: `FR-010a` was first written as "evaluated in the same conditional
write", which prescribes a mechanism and leaks implementation into a spec-level requirement. Reworded to lead
with the guarantee (atomicity, bound holds under arbitrary concurrency) with the ADR-0024 pattern demoted to
an explicit implementation note.

**Downstream propagation done, not deferred**: `tasks.md` gained `TC042a` (a real concurrency test — a
sequential loop cannot detect the race) and `E048` gained the atomicity constraint; `traceability.yml` gained
`FR-010a`. Counts now 48 FRs, 16 SCs, 50 tasks.

**Checklist state: 16/16 → 16/16.** No item changed state. That is the honest result, and it is also why the
note above matters.

---

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
