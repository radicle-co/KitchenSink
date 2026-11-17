# Product Spec: Nutrition Planning

**Branch**: `009-nutrition-planning`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains the Product Forge v1.3.0 product specification artifacts for the Nutrition Planning feature.

| Artifact      | File                                  | Description                                                                                                              |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Product Spec  | [product-spec.md](./product-spec.md)  | Vision, personas, epics, MoSCoW story map with FR traceability, and out-of-scope list for nutrition planning.            |
| User Journeys | [user-journey.md](./user-journey.md)  | End-to-end journeys for nutrition user and trainer-client collaboration, including premium swap path and consent gating. |
| Wireframes    | [wireframes/](./wireframes/README.md) | Conceptual wireframes for nutrition-dashboard, goal setup, meal breakdown, weekly view, and deficiency alerts.           |
| Metrics       | [metrics.md](./metrics.md)            | Story-level measurable outcomes for Must Have nutrition stories.                                                         |

---

## Quick Links

- [product-spec.md](./product-spec.md) — scope and prioritization source
- [user-journey.md](./user-journey.md) — persona-level end-to-end flows
- [wireframes/](./wireframes/README.md) — visual structure for key nutrition screens
- [metrics.md](./metrics.md) — story-level measurable signals
- [../spec.md](../spec.md) — canonical FR/NFR reference (`FR-036..FR-039`)
- [../plan.md](../plan.md) — implementation architecture and contracts

---

## Artifact Cross-Reference

```
product-spec.md
    |
    +-- MoSCoW stories (US-001..US-009)
    |       Each story references FR-XXX from spec.md when available
    |
    +-- Personas (Diet-Conscious User / Personal Trainer / Client)
    |
    v
user-journey.md
    |
    +-- Nutrition self-management journey
    +-- Trainer-client assignment journey
    +-- Premium recipe swap intervention path
    |
    v
wireframes/
    |
    +-- nutrition-dashboard.md
    +-- nutrition-goal-setup.md
    +-- nutrition-meal-breakdown.md
    +-- nutrition-weekly.md
    +-- nutrition-deficiency-alert.md
    +-- README.md
    |
    v
metrics.md
    |
    +-- MET-US001-* (create plan)
    +-- MET-US002-* (link + compliance)
    +-- MET-US003-* (trainer-client)
    +-- MET-US004-* (recipe swap guidance)
```

---

## Traceability Summary

| MoSCoW tier | Story count        | FR coverage                                                                           |
| ----------- | ------------------ | ------------------------------------------------------------------------------------- |
| Must Have   | 4 (US-001..US-004) | FR-036, FR-037, FR-038, FR-039 + NFR-001..NFR-004 + SC-010                            |
| Should Have | 3 (US-005..US-007) | Derived from acceptance scenarios/REQs; explicit WARNING where no direct FR ID exists |
| Could Have  | 2 (US-008..US-009) | Augmentation candidates (dietary profile depth, deficiency insights)                  |
| Won't Have  | 3                  | Deferred to future specs unless promoted upstream                                     |

All Must Have stories are mapped to explicit FR IDs from `spec.md`.
