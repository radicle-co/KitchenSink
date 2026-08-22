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

All Content Quality, Feature Readiness and Requirement Completeness items pass **except** the
[NEEDS CLARIFICATION] item, which is the designed state of the specification rather than a defect.

Three markers remain, each with a question presented to the owner:

| Marker | Requirement                                                                        | Question                                                                                                                 |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Q1     | `FR-048` — per-market variation of publication, discovery and feature availability | Which markets are served at launch? Determines whether roughly a third of the obligations here are live at v1 or dormant |
| Q2     | `FR-027` — third-party photographs obtained on import                              | Reference the source image, omit images entirely, or reference-with-replace?                                             |
| Q3     | `FR-012a` — what already-distributed copies do when the author deletes or erases   | Do clones survive? Determines the licence's duration clause and the erasure promise                                      |

None can be resolved by a reasonable default: Q1 is a market-entry decision, Q2 trades a visible product
regression against a reproduction we cannot defend, and Q3 sets a term users react to strongly in both
directions.

## Notes

- **The three markers block `/speckit-plan`, not the spec.** Everything else is settled.
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
