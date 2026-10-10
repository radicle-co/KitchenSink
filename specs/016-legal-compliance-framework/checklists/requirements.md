# Specification Quality Checklist: Legal Compliance Framework

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-22
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

## Validation record

### Iteration 1 — issues found and fixed

| Item                                 | Issue                                                                                                                                                                   | Fix                                                                                                                                         |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Technology-agnostic success criteria | `SC-005` and `SC-006` asserted "fails the build", and `SC-004` said "in a single query" — all three named the verification or storage mechanism rather than the outcome | Reworded to "automated, continuously-run assertion", "enforced automatically rather than by review", and "produced on demand as one record" |
| Testable and unambiguous             | `FR-034` required an export "within the stated period" without stating one                                                                                              | Bounded at no longer than one month from request                                                                                            |
| Testable and unambiguous             | `FR-020` required termination at "a defined repeat-infringer threshold" with no definition and no owner                                                                 | Requirement restated as _one_ threshold applied without exception; the value routed to Owner decisions #2                                   |
| All FRs have acceptance criteria     | Group E (corpus rights, `FR-030`–`FR-033`) had no scenario and no measurable outcome                                                                                    | Added `SC-011` — zero surfaces asserting recipe ownership or an unheld database right, corpus under no open licence                         |
| All FRs have acceptance criteria     | `FR-011`'s plain-language licence statement at the point of publication was unasserted                                                                                  | Added acceptance scenario 5 to User Story 1                                                                                                 |
| Ambiguity                            | The licence-duration requirement was introduced as `FR-014a`, colliding by name with `004-FR-014a` (per-item attestation), which this spec cites four times             | Renumbered to `FR-012a`, beside the licence requirements it belongs with                                                                    |
| Misplaced marker                     | The Q3 clarification marker sat on `FR-015` (consumer indemnity), which Q3 does not decide                                                                              | Moved onto `FR-012a`, the requirement it actually blocks                                                                                    |

### Iteration 2 — re-validation

All items passed except `No [NEEDS CLARIFICATION] markers remain`. Three markers were presented as questions:
Q1 market scope (`FR-048`), Q2 import photographs (`FR-027`), Q3 clone survival (`FR-012a`). None had a
defensible default — a market-entry decision, a visible product regression traded against an indefensible
reproduction, and a term users react strongly to in both directions.

### Iteration 3 — clarifications resolved, re-validated

All three answered one at a time by the owner on 2026-08-22. **All 16 checklist items now pass.**

| Marker         | Resolution                                                                                                                                                                                 | Requirements added or changed                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1 → C-016-001 | US-only at v1, **global is the target** — which makes other markets a _known_ requirement, not a presumed one. Build the boundary to the strictest regime; build the capability for nobody | `FR-048` resolved; `FR-048a`–`FR-048c` added (fail-closed unserved markets; the seam-vs-capability rule; the deferred list)                          |
| Q2 → C-016-002 | Reference the source photograph, offer a one-tap replacement                                                                                                                               | `FR-027` resolved; `FR-027a`–`FR-027e` added; `SC-005` widened, `SC-005a` added                                                                      |
| Q3 → C-016-003 | The owner **replaced the model** rather than choosing: a clone must be modified and references its source, so it is not a carbon copy and survives the original's deletion                 | `FR-012a` resolved; `FR-015a`–`FR-015f` added; `SC-012`, `SC-013` added; three edge cases added; a new **Cross-spec amendments** section (A-1 … A-8) |

**One correction was made to the owner's framing rather than transcribed.** `FR-015d` states explicitly that
requiring a modification is **not** a copyright defence — a derivative of a protected work still infringes.
The rule is kept for corpus quality and its secondary evidentiary value; what actually makes cloning
defensible is `FR-015a` (provenance-gated cloneability) and the user licence. Recording the rule without this
would have left a false defence in the spec.

**Two decisions in C-016-003 are derived, not stated**, and are flagged in place for confirmation:

- `FR-015b` — the enforcement shape of "modify before you clone": an unmodified clone exists as a private,
  unpublishable draft, because a thing must exist before it can be edited.
- `FR-015f` — erasure strips identity from surviving clones and keeps a non-identifying lineage marker,
  reasoning that the recipe text is generally not personal data while the attribution is.

**One accepted risk is recorded, not solved**: a clone of a public recipe defaulting to public repeats the
public-by-default pattern `FR-038` and feature `015` exist to remove. Weaker here — the content was already
public, so what is newly exposed is the cloner's association with it — but not nothing.

### Iteration 4 — governance de-duplication (2026-08-22)

Applying the cross-spec amendments surfaced that **two governance rules already owned ground this feature was
restating**, which `GR-014` `AC-014-b` and the project's DRY rule both forbid.

| Was in 016                                                          | Moved to                           | Result                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FR-015a`–`FR-015f` — cloning, derived copies, deletion and erasure | **`GR-014` AC-014-g/h/i** (v3.5.0) | GR-014 owns the audience and sharing model. 016 keeps only two requirements that are legal posture rather than sharing model: the licence must cover surviving derived copies, and the modification rule must never be cited as a copyright defence   |
| `FR-045`–`FR-047` — AI transparency                                 | **`GR-010` AC-010-e/f** (v3.5.0)   | GR-010 already mandated the disclosure and put the component in Feature 005. 016 now cites it and contributes what GR-010 predated — Art. 50(2) machine-readable marking, and the correction that Art. 50 has been applicable since **2 August 2026** |

Consequences: 69 FRs → **65**; two new amendments **A-9** and **A-10**; every `FR-015x` citation in 016, 001
and 004 repointed, because those IDs now mean different things.

**A correction to iteration 3's blocker #1.** It claimed `001-FR-005a` was unimplementable because no field
records that a source restricts redistribution. That was wrong: `GR-014` AC-014-e already governs sources
licensed against "redistribution **or derivatives**" and expresses it by classifying them into a private-only
`sourceType` at ingestion, after which AC-014-h makes them unclonable. The real gap is one narrow case — a
source that is public and freely available but forbids **derivatives** specifically, which a modified clone is.
Corrected in both `016/spec.md` and `001/spec.md`.

`GR-003` `AC-003-b` discharged: `specs/cross-feature-FR-index.md` updated to v0.2.0 with the seven new
cross-feature citation rows.

### Iteration 5 — the video conflict 017 raised (2026-08-22)

`017-recime-parity` blocked its US1 on a conflict with this feature and was right to. `FR-027c` read "no
derived renditions … a thumbnail is a copy", and a **sampled video frame is a reproduction of a protected
audiovisual work** — so read literally, 016 forbade the video-import wedge 017 is built on. C-016-002 had
reasoned entirely about photographs and never considered video.

**Resolved here, because it is 016's rule.** The line is not photo-versus-video; it is **persisted or served**
versus **transient and extractive**. `FR-027c` restated on that axis; `FR-027f` permits transient extraction
under four guardrails; `FR-027g` forbids the tempting shortcut of promoting an extracted frame to the recipe
image; `FR-027h` forbids retaining the source media. `SC-005` widened to cover frames, stills, audio and
source media.

**The basis is recorded as TDM, not the transient-copy exception**, and that was a correction to my first
instinct: InfoSoc Art. 5(1) looks like the fit but _Infopaq_ reads it narrowly and "no independent economic
significance" fails for a commercial extraction pipeline. DSM Art. 4 TDM is purpose-built and reaches
commercial actors. Its machine-readable-reservation condition is the **same** open question `004-FR-023`
already carries — escalated in `FR-050` because it is now load-bearing for video, not just URL import.

FR count 65 → **68**.

### Iteration 6 — `/speckit-clarify` pass (2026-08-22)

Five questions asked, five answered, all integrated. **Checkbox state unchanged: 16/16 → 16/16** — no
regressions and nothing newly passing, because the spec already passed. What changed is depth, not validity.

| #   | Question                              | Answer                                              | Requirements touched                                      |
| --- | ------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- |
| 1   | Statement-of-reasons delivery channel | **Both in-app and email**                           | `FR-018a`, `FR-018b`, `SC-003`                            |
| 2   | Reviewer surface                      | **Full admin dashboard**                            | **User Story 8 (new)**, `FR-053a`–`FR-053g`, `SC-014`     |
| 3   | Repeat-infringer threshold            | **3 live strikes / rolling 12 months**              | `FR-020`, `FR-020a`, `FR-020b` — closes Owner decision #2 |
| 4   | Decision timeliness target            | **24h copyright + illegal, 7d others**              | `FR-017a`–`FR-017c`, `FR-053a`, `SC-015`                  |
| 5   | Retention of surviving legal records  | **3 years; reporter contact pseudonymised earlier** | `FR-052a`–`FR-052c`, `SC-016`                             |

Counts: 68 → **85** functional requirements, 14 → **17** success criteria, 7 → **8** user stories.

**Two answers created scope this feature did not previously carry, and both are recorded rather than absorbed
quietly.** Q1 brought a transactional email sender into scope — no notification or email capability exists in
the tree, and `014-notification-service` is specified but unbuilt. Q2's dashboard is now the single largest
item in the feature and **reverses `002`'s recorded exclusion of an admin UI**, logged as amendment **A-11**,
NOT applied.

**One answer removed an unquantified adjective**, which is the class of defect the taxonomy scan exists to
find: `FR-017` carried the DSA's "timely, diligent" with nothing measurable behind it, and `FR-017a` now
tiers it.

**Q5 was answered with a question — "what do laws say about this?" — and that was the right challenge.** The
recommendation had been offered without its basis. The basis: no statute sets a retention minimum; 17 U.S.C.
§507(b) sets the 3-year floor; GDPR Art. 17(3)(e) is what permits survival past erasure and its scope is the
claim period, which sets the ceiling; and DSA Art. 24(5)'s database duty does not reach us under Art. 19(1).

## Notes

- **The spec is READY for `/speckit-plan`.** Zero markers remain; **85** functional requirements, 7 non-functional,
  **17** success criteria, **8** user stories.
- ⚠️ **The cross-spec amendments A-1 … A-10 are APPLIED (documents only; code untouched).** `001-FR-005`, the C-004 matrix in
  `001/data-model.md`, and `evaluateVisibility(sourceType, isPremium, hasSubstantiveEdit, requested)` encode
  the same rule in three places. Amending one and not the others is the drift failure the project's DRY rule
  exists to prevent, so they are a single unit of work.
- **Two prerequisites live outside software** and no requirement here can satisfy them: a registered
  designated agent (`FR-025`) and counsel-drafted documents. `FR-050` carries the list of items needing
  counsel's confirmation, each naming what breaks if the assumption is wrong.
- **One assumption is load-bearing and is stated, not proven**: that the operator is a US-formed entity with
  no EU establishment. It is what makes the EU sui generis database right unavailable (Directive 96/9/EC
  Art. 11) and it is the basis of `FR-031`. If an EU entity is ever created, Layer 3 of the research section
  reopens and `FR-031` changes.
- **Research provenance is marked in the spec.** Layers 2–5 of the corpus-ownership research were verified
  against sources on 2026-08-22. The findings carried forward from the 2026-08-21 session — _Publications
  Int'l v. Meredith_, moral rights under Berne Art. 6bis and Australia's Copyright Act Part IX, and the DSM
  Art. 4 TDM reservation — were reasoned from and **not re-verified**. That distinction is stated in the spec
  and must not be flattened.
