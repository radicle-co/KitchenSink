# Product Spec: Cooking Mode

**Branch**: `008-cooking-mode`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains the Product Forge v1.3.0 product specification artifacts for the Cooking Mode feature.

| Artifact      | File                                  | Description                                                                                                                                                                                               |
| ------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md)  | Vision, personas, epics, MoSCoW story map with FR traceability, and out-of-scope list for cooking mode scope.                                                                                             |
| User Journeys | [user-journey.md](./user-journey.md)  | End-to-end flow for active cooking, plus interruption/offline/timer edge paths. Includes Mermaid sequence diagram and coverage matrix.                                                                    |
| Wireframes    | [wireframes/](./wireframes/README.md) | ASCII conceptual wireframes for five requested key screens: cook-step, cook-timer, cook-ingredients-panel, cook-voice-control, cook-completed. Each wireframe annotates FR links and warning-scope items. |
| Metrics       | [metrics.md](./metrics.md)            | Per-story measurable outcomes for Must Have stories. Distinct from `research/metrics-roi.md` (feature-level portfolio and ROI framing).                                                                   |

---

## Quick Links

- [product-spec.md](./product-spec.md) — canonical story/scope framing
- [user-journey.md](./user-journey.md) — main end-to-end user path
- [wireframes/](./wireframes/README.md) — requested cooking-mode screen set
- [metrics.md](./metrics.md) — story-level success measures
- [../spec.md](../spec.md) — canonical FR IDs (FR-032..FR-035)
- [../plan.md](../plan.md) — implementation architecture and open questions

---

## Artifact Cross-Reference

```
product-spec.md
    |
    +-- MoSCoW stories (US-001..US-007)
    |       Each story references FR-032..FR-035 where applicable
    |
    +-- Personas (Primary home cook + secondary accessibility-sensitive users)
    |
    v
user-journey.md
    |
    +-- Core cooking flow (enter -> navigate -> timer -> complete)
    +-- Edge flows (offline drop, interruption/resume, timer completion)
    |
    v
wireframes/
    |
    +-- cook-step.md
    +-- cook-timer.md
    +-- cook-ingredients-panel.md
    +-- cook-voice-control.md
    +-- cook-completed.md
    |
    v
metrics.md
    |
    +-- Story-level metric targets and instrumentation notes
```

---

## Scope Discipline

- Stories in this directory MUST trace to canonical FRs from `spec.md`.
- Requested domain additions (ingredient checkoff, cook-time scaling, expanded voice controls) are documented as candidate scope and flagged until canonical FRs are extended.
