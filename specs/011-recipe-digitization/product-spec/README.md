# Product Spec: Recipe Digitization & Family Circles

**Branch**: `011-recipe-digitization`
**Date**: 2026-05-09
**Status**: Bootstrapped / awaiting implementation-time decisions
**Source**: [product-spec.md](./product-spec.md)

---

## Index

This directory contains Product Forge product specification artifacts for feature 011.

| Artifact      | File                                 | Description                                                                                                                                                |
| ------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md) | Vision, personas, story map, functional requirements, constraints, risks, and open decisions for OCR-based recipe digitization and private Family Circles. |
| User Journeys | [user-journey.md](./user-journey.md) | End-to-end flows for Sage digitizing paper recipes, Riley joining a Circle, and Alex running bulk imports.                                                 |
| Metrics       | [metrics.md](./metrics.md)           | Story-level metrics for OCR accuracy, correction efficiency, Circle activation, invite conversion, and bulk import reliability.                            |
| Wireframes    | _not generated_                      | Correction UI, Circle invite, and bulk queue screens still need visual decomposition before implementation.                                                |

---

## Quick Links

- [product-spec.md](./product-spec.md) — product scope and decision record
- [user-journey.md](./user-journey.md) — persona-level flows
- [metrics.md](./metrics.md) — measurable product outcomes
- [../research.md](../research.md) — consolidated research source
- [../spec.md](../spec.md) — canonical SpecKit feature specification
- [../plan.md](../plan.md) — technical plan

---

## Artifact Cross-Reference

```text
research.md
    |
    v
product-spec.md
    |
    +-- Must Have: OCR capture, correction, save, Circle create/invite/join, Circle browsing
    +-- Should Have: bulk import, confidence indicators, meal-planning integration
    |
    v
user-journey.md
    |
    +-- Sage digitizes and corrects
    +-- Riley joins and browses
    +-- Alex bulk-imports
    |
    v
metrics.md
    |
    +-- OCR quality, correction speed, Circle activation, invite conversion, queue reliability
```

---

## Traceability Rules Applied

1. This product layer is bootstrapped from `research.md`, `spec.md`, and `product-spec.md`; unresolved provider, entitlement, and OCR-threshold questions remain implementation-time decisions per `review.md`.
2. Metrics are product execution targets, not evidence that implementation or test execution has occurred.
3. Wireframes are explicitly absent rather than silently implied.
