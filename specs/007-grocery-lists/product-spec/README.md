# Product Spec: Grocery Lists & Online Ordering

**Branch**: `007-grocery-lists`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains the Product Forge v1.3.0 product specification artifacts for feature 007.

| Artifact      | File                                  | Description                                                                                                                                                                                  |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md)  | Vision, personas, epics, MoSCoW story map with FR traceability, and out-of-scope list for grocery-list generation, pantry handling, store setup, and premium ordering.                       |
| User Journeys | [user-journey.md](./user-journey.md)  | End-to-end flows for shopper personas across list generation, aisle-grouped execution, manual add/check-off, sharing context, and order handoff. Includes sequence diagrams and FR coverage. |
| Wireframes    | [wireframes/](./wireframes/README.md) | ASCII conceptual wireframes for required grocery list screens: list view, grouped-by-aisle, share, add item, and from-meal-plan generation flow.                                             |
| Metrics       | [metrics.md](./metrics.md)            | Per-story measurable outcomes tied to FR-028..FR-031. Distinct from `research/metrics-roi.md` (portfolio-level ROI).                                                                         |

---

## Quick Links

- [product-spec.md](./product-spec.md) — source of truth for feature scope framing
- [user-journey.md](./user-journey.md) — end-to-end behavior per persona
- [wireframes/](./wireframes/README.md) — screen-level interaction reference
- [metrics.md](./metrics.md) — story-level product metrics
- [../spec.md](../spec.md) — canonical FR/NFR/SC IDs
- [../plan.md](../plan.md) — technical architecture and service boundaries

---

## Artifact Cross-Reference

```
product-spec.md
    |
    +-- MoSCoW stories (US-001..US-010)
    |       Each story references FR-028..FR-031
    |
    +-- Personas (Weekly Planner / Household Shopper / Premium Optimizer)
    |
    v
user-journey.md
    |
    +-- Three persona journeys (Mermaid sequence diagrams)
    |       Each step annotates FR IDs where applicable
    |
    +-- Edge flows (unmapped items, setup-required order attempt)
    |
    v
wireframes/
    |
    +-- list-view.md                (FR-028, FR-029)
    +-- list-grouped-by-aisle.md    (FR-028, FR-029)
    +-- list-share.md               (domain request; warning-level until explicit FR)
    +-- list-add-item.md            (FR-028/FR-029 support pattern)
    +-- list-from-meal-plan.md      (FR-028, FR-030, FR-031)
    |
    v
metrics.md
    |
    +-- Story-level success metrics for each Must Have story
```
