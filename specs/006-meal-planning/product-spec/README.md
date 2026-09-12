# Product Spec: Meal Planning

**Branch**: `006-meal-planning`
**Date**: 2026-05-09 | **Reconciled**: 2026-08-02
**Status**: Draft — Phase 1 ready for planning; Phase 2 deferred
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains the Product Forge product-spec layer for feature 006.

| Artifact      | File                                  | Description                                                                                                                         |
| ------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md)  | Vision, personas, epics, MoSCoW story map with FR traceability, the cross-platform commitment, and the out-of-scope list.           |
| User Journeys | [user-journey.md](./user-journey.md)  | Six journeys: core planning, **degraded/orphaned states**, templates, Home entry point, shopping handoff, and the deferred AI path. |
| Wireframes    | [wireframes/](./wireframes/README.md) | Six frames covering web **and** mobile, with a per-frame state matrix.                                                              |
| Metrics       | [metrics.md](./metrics.md)            | Story-level metrics, including operational signals for degraded states.                                                             |

---

## Quick Links

- [product-spec.md](./product-spec.md) — scope and story prioritization
- [user-journey.md](./user-journey.md) — flows, including failure and degraded paths
- [wireframes/](./wireframes/README.md) — UI structures and the state-coverage matrix
- [metrics.md](./metrics.md) — per-story measurement model
- [../spec.md](../spec.md) — canonical FR/NFR/SC ids **and the Clarifications that resolve every open question**
- [../plan.md](../plan.md) — architecture, pattern register, data model, API contracts
- [../research/codebase-analysis.md](../research/codebase-analysis.md) — what `main` already provides
- [../v-model/requirements.md](../v-model/requirements.md) — REQ-NNN decomposition

---

## Artifact Cross-Reference

```
spec.md  (FR-022..FR-039, NFR-001..007, SC-006-001..005, Clarifications C-006-001..011)
    |
    v
product-spec.md
    |
    +-- Epics E1..E6  (E6 = premium AI, Phase 2 deferred)
    +-- MoSCoW stories US-006-001..007
    +-- Personas: Riley (served), Sam (partly — targets are 009's), Avery (Phase 2 only)
    |
    v
user-journey.md
    |
    +-- A  Weekly planning and assignment      (web + mobile)
    +-- B  Degraded and orphaned states        (new — the May set had no failure journey)
    +-- C  Reuse a week (templates)
    +-- D  Home entry point
    +-- E  Handoff to shopping (projection only)
    +-- F  AI-assisted planning                (Phase 2, deferred — not diagrammed)
    |
    v
wireframes/
    |
    +-- planner-week.md            (web)
    +-- planner-day-mobile.md      (mobile — new)
    +-- planner-month.md           (web + mobile)
    +-- plan-create.md             (web + mobile)
    +-- plan-templates.md          (web + mobile)
    +-- plan-shopping-handoff.md   (web + mobile)
    |
    v
metrics.md  (MET-006-001..028)
```

---

## Traceability Summary

- **Functional coverage — Phase 1**: FR-022, FR-023, FR-024, FR-028, FR-029, FR-030, FR-031, FR-032, FR-033, FR-034,
  FR-035, FR-036, FR-037, FR-038, FR-039.
- **Functional coverage — Phase 2 (deferred)**: FR-025, FR-026, FR-027.
- **Quality constraints reflected**: NFR-001..NFR-007 (NFR-005 test mandate, NFR-006 latency and NFR-007 parity are new
  in this reconciliation).
- **Outcome targets reflected**: SC-006-001 through SC-006-005.

---

## Reconciliation summary (2026-08-02)

What changed in this layer, and why:

| Change                                                              | Reason                                                                                                                   |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Mobile added to every story, journey and frame                      | `CODING_STANDARDS §14.1` is a hard rule; the May layer was web-only, which would be rejected in review                   |
| Templates promoted from "inferred" to **FR-028**                    | Resolves W-001, open since 2026-05-12                                                                                    |
| Family sizing resolved to entry `servings` (**FR-030**)             | Resolves W-002; a plan-level household number would duplicate the same idea in a second place                            |
| Recurrence and leftovers moved to explicit **out of scope**         | Both need machinery no requirement drives (C-006-008)                                                                    |
| Premium AI stories marked **Phase 2, deferred** with named blockers | 005 does not exist, and the premium entitlement is unenforceable today (C-006-009)                                       |
| A **degraded-states journey** (B) and per-frame state matrix added  | The May layer specified only happy paths; `§7.1` requires a test for every state, so every state must first be specified |
| Lock/finalize removed from every artifact                           | C-006-007                                                                                                                |
| Ingredient manifest removed from the handoff                        | 006 hands over entries; 007 owns aggregation (research R-8)                                                              |
| Goal/target readouts removed                                        | Owned by 009; a second definition of "on target" would diverge                                                           |
| `SC-008` renumbered `SC-006-001`; four more success criteria added  | Namespace consistency, and one measurable outcome was not enough to gate a release                                       |

## Open items

**None blocking.** The May `WARNING` — that templates, recurring meals, family sizing and leftovers appeared in this
layer without canonical FRs — is **closed**: two were promoted to requirements, two were explicitly ruled out of scope,
and all four decisions are recorded in [spec.md](../spec.md) Clarifications rather than left as a warning for a future
reader to resolve.

Genuinely open, and deliberately not guessed at: the AI provider contract (005) and the premium entitlement mechanism
(010). The previous version of this layer guessed both, and was wrong about where the subscription tier is stored.
