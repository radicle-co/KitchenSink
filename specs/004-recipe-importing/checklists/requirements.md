# Specification Quality Checklist: Recipe Importing

**Purpose**: validate specification completeness and quality before implementation
**Created**: 2026-04-15 · **Revalidated**: 2026-08-02
**Feature**: [spec.md](../spec.md)

> **Revalidation note.** The 2026-04-15 run marked 15 of 16 items passed. On re-examination several of those
> ticks were not defensible: "Requirements are testable and unambiguous" was checked against a requirements
> document containing corrupt, ambiguous sentences; "Success criteria are measurable" was checked against an
> 85% accuracy target with no corpus, no sample size, and no measurement method; and "No implementation details"
> was checked against a spec that named a specific third-party API. A checklist that passes a document with
> those defects is not measuring anything. Each item below is re-answered against evidence.

## Content quality

- [x] **No unnecessary implementation detail** — the spec names Instagram's oEmbed API and AWS Textract only
      where the choice is itself a requirement constraint (an externally gated credential; an owner decision),
      and says so explicitly. Mechanism otherwise stays in `plan.md`.
- [x] **Focused on user value and business need** — every FR traces to a user story or a legal/compliance need.
- [x] **Written for non-technical stakeholders** — with one deliberate exception: the draft-and-confirm section
      explains a _database constraint_, because the product consequence is unintelligible without it.
- [x] **All mandatory sections complete.**

## Requirement completeness

- [x] **No `[NEEDS CLARIFICATION]` markers remain** — the four that persisted for three months are resolved as
      owner decisions D-001..D-004.
- [x] **Requirements are testable and unambiguous** — verified mechanically: zero `,,` or `, SHALL` corruption
      patterns; 41 of 54 requirements carry verification method _Test_ with named acceptance scenarios.
- [x] **Success criteria are measurable** — SC-002 now has a defined 50-page stratified corpus, a stated
      measurement method, and a CI gate. It was previously unmeasurable and therefore unclaimable.
- [x] **Success criteria are technology-agnostic** — SC-002..SC-005 measure accuracy, completeness, latency,
      and duplicate count, not implementation.
- [x] **All acceptance scenarios defined** — 13 procedures / 58 scenarios in `v-model/acceptance-plan.md`.
      Previously **zero**.
- [x] **Edge cases identified** — including the ones the previous revision missed: concurrent import of the
      same URL, redirect to a blocked or private host, extraction succeeding with required fields missing, and
      an unparseable ingredient line.
- [x] **Scope clearly bounded** — an explicit _out of scope_ list, and an explicit statement of what 001
      already ships that 004 must not rebuild.
- [x] **Dependencies and assumptions identified** — including the external Meta credential, called out as the
      only gated item.

## Feature readiness

- [x] **Every FR has clear acceptance criteria** — 52 of 54 requirements have acceptance coverage; the other
      two declare _inspection_ as their verification method.
- [x] **User scenarios cover all primary flows** — six journeys covering four channels plus conflict and error
      recovery, on both platforms.
- [x] **Measurable outcomes are achievable and gated** — SC-002/SC-003 fail the build below threshold;
      SC-004 is k6-enforced; SC-005 is a database invariant.
- [x] **Cross-platform parity satisfied** (`§14.1`) — every user-facing task pairs web and mobile; no waiver
      claimed.
- [x] **Test mandate satisfiable** (`§7.1`) — unit, integration, e2e, k6, component, Playwright, and Maestro
      all planned with named tasks. Previously k6, Maestro, and per-state component tests were absent entirely.
- [x] **Hazards controlled** — 55 hazards, each tracing to a requirement, a design element, an implementing
      task, and a test. Zero residual risk above Tolerable.
- [x] **FR-014a resolved** — was the single blocking item in the 2026-04-15 run; resolved by owner decision
      D-003 into an operable rule that does not depend on legal review to be implementable.

## Result

**16 of 16 items pass.** The one item that blocked the previous run (FR-014a) is closed.

**Specification is ready for implementation.**
