# Product Spec: Source-Agnostic Food Data Integration

**Branch**: `003-usda-food-data`
**Date**: 2026-05-09 (re-baselined 2026-06-22 to the source-agnostic model)
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains the Product Forge v1.7.0 product specification artifacts for the USDA Food Data Integration feature.

| Artifact      | File                                  | Description                                                                                                                                                                                                   |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md)  | Vision, personas, epics, MoSCoW story map with FR traceability, and out-of-scope list. The single source of truth for v1 product scope interpretation.                                                        |
| User Journeys | [user-journey.md](./user-journey.md)  | End-to-end flows for three personas covering P1/P2/P3 stories, plus cross-persona edge cases for pending status, queue delay, and not-found handling. Includes Mermaid sequence diagrams and coverage matrix. |
| Wireframes    | [wireframes/](./wireframes/README.md) | ASCII conceptual wireframes for six domain screens: food search, food detail, ingredient picker, candidate resolution, nutrition panel, and food substitution. Each wireframe annotates FR coverage.          |
| Metrics       | [metrics.md](./metrics.md)            | Per-story measurable outcomes for Must Have stories. Distinct from `research/metrics-roi.md`, which covers portfolio-level ROI and system-level SLO framing.                                                  |

---

## Quick Links

- [product-spec.md](./product-spec.md) — scope and priority decisions
- [user-journey.md](./user-journey.md) — end-to-end persona flows
- [wireframes/](./wireframes/README.md) — conceptual UI structure
- [metrics.md](./metrics.md) — per-story product outcomes
- [../spec.md](../spec.md) — canonical FR ID reference (FR-001..FR-053 + FR-IDN/RES/MRG/ADP groups)
- [../plan.md](../plan.md) — architecture and implementation sequencing
- [../v-model/requirements.md](../v-model/requirements.md) — REQ-NNN atomic decomposition

---

## Artifact Cross-Reference

```
product-spec.md
    |
    +-- MoSCoW stories (US-0..US-10, incl. US-2a)
    |       Each story references FR-XXX from spec.md
    |
    +-- Personas (Recipe Author / Nutrition-Conscious Planner / Operations Engineer)
    |
    v
user-journey.md
    |
    +-- Three persona journeys (Mermaid sequence diagrams)
    |       Each step annotates the FR it exercises
    |
    +-- Cross-persona flows (pending->resolved, unresolved->resolved, not_found, rate-limit delay)
    |
    v
wireframes/
    |
    +-- food-search.md           (FR-008, FR-009, FR-010)
    +-- candidate-resolution.md  (FR-RES-1, FR-RES-2, FR-RES-3, FR-MRG-2, FR-MRG-3; US-2a)
    +-- food-detail.md           (FR-002, FR-007, FR-028)
    +-- ingredient-picker.md     (FR-003, FR-004, FR-011, FR-013, FR-033)
    +-- nutrition-panel.md       (FR-002, FR-028, SC-008)
    +-- food-substitution.md     (FR-008, FR-010, FR-033; warning-tracked)
    |
    v
metrics.md
    |
    +-- Story-level success metrics for Must Have stories
```
