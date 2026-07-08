# Product Spec: Commise Recipe Management Core

**Branch**: `001-commise-recipe-app`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains the Product Forge v1.3.0 product specification artifacts for the Commise Recipe Management Core feature.

| Artifact      | File                                  | Description                                                                                                                                                                                                                                                |
| ------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md)  | Vision, personas, epics, MoSCoW story map with FR traceability, and out-of-scope list. The single source of truth for what is and is not in v1.                                                                                                            |
| User Journeys | [user-journey.md](./user-journey.md)  | End-to-end flows for three personas (Home Cook, Meal Planner, Recipe Sharer) covering all P1/P2/P3 stories plus cross-persona edge cases (conflict resolution, photo failure, S3 archive failure). Includes Mermaid sequence diagrams and coverage matrix. |
| Wireframes    | [wireframes/](./wireframes/README.md) | ASCII conceptual wireframes for seven key UI screens: recipe list, recipe detail, recipe edit (multi-step), recipe search, collection view, version history, and HTTP 409 conflict resolution. Each wireframe annotates the FRs it satisfies.              |
| Metrics       | [metrics.md](./metrics.md)            | Per-story measurable outcomes for the six Must Have stories (25 metrics total). Distinguish from `research/metrics-roi.md` which covers portfolio-level ROI; this file covers story-level product-team signals.                                            |

---

## Quick Links

- [product-spec.md](./product-spec.md) — start here for scope decisions
- [user-journey.md](./user-journey.md) — end-to-end flows for each persona
- [wireframes/](./wireframes/README.md) — visual structure for all key screens
- [metrics.md](./metrics.md) — how we measure success per story
- [../spec.md](../spec.md) — canonical FR ID reference (all stories traceable back to FR-001..FR-012, C-004..C-007)
- [../plan.md](../plan.md) — implementation plan with technical architecture
- [../v-model/requirements.md](../v-model/requirements.md) — REQ-NNN atomic requirements derived from spec.md

---

## Artifact Cross-Reference

```
product-spec.md
    |
    +-- MoSCoW stories (US-001..US-015)
    |       Each story references FR-XXX from spec.md
    |
    +-- Personas (Home Cook / Meal Planner / Recipe Sharer)
    |
    v
user-journey.md
    |
    +-- Three persona journeys (Mermaid sequence diagrams)
    |       Each step annotates the FR it exercises
    |
    +-- Cross-persona flows (conflict, photo failure, S3 DLQ)
    |
    v
wireframes/
    |
    +-- recipe-list.md         (FR-006, FR-004)
    +-- recipe-detail.md       (FR-001, FR-007, FR-007a, FR-007b)
    +-- recipe-edit.md         (FR-001, FR-001a, FR-007b, FR-007c)
    +-- recipe-search.md        (FR-006, FR-004)
    +-- collection-view.md     (FR-008, FR-009, FR-010, FR-011)
    +-- version-history.md     (FR-007b, FR-007c)
    +-- conflict-resolution.md (FR-007c, C-005)
    |
    v
metrics.md
    |
    +-- MET-US001-01..05 (Create Recipe)
    +-- MET-US002-01..04 (Edit / Version)
    +-- MET-US003-01..04 (Delete / Soft)
    +-- MET-US004-01..03 (Visibility)
    +-- MET-US005-01..04 (Conflict Resolution)
    +-- MET-US006-01..05 (Search & Discovery)
```

---

## Traceability Summary

| MoSCoW tier | Story count        | FR coverage                                                                                                                                                            |
| ----------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Must Have   | 7 (US-000..US-006) | 100% — all mapped to FR-001, FR-001a, FR-002, FR-003, FR-004, FR-006, FR-007, FR-007a, FR-007b, FR-007b-i, FR-007c, FR-044, FR-045, FR-046, C-004, C-005, C-006, C-007 |
| Should Have | 3 (US-007..US-009) | FR-005, FR-008, FR-009, FR-010, C-004                                                                                                                                  |
| Could Have  | 2 (US-010, US-016) | FR-007b, FR-011                                                                                                                                                        |
| Won't Have  | 4 (US-012..US-015) | Out of scope — deferred or covered by other specs                                                                                                                      |

All Must Have stories are mapped to specific FR and C IDs from `spec.md`. Should Have and Could Have stories that are Net-new (no matching FR in spec.md) are marked as such in `product-spec.md`.
