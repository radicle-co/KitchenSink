# Product Spec: Cooking School

**Branch**: `013-cooking-school`
**Date**: 2026-05-09
**Status**: Bootstrapped / pending revalidation
**Source**: [product-spec.md](./product-spec.md)

---

## Index

This directory contains Product Forge product specification artifacts for feature 013.

| Artifact      | File                                 | Description                                                                                                                                  |
| ------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md) | Executive summary, personas, user journey, story map, FRs, dependencies, risks, and open questions for the async video learning marketplace. |
| User Journeys | [user-journey.md](./user-journey.md) | Learner discovery/purchase/progress, educator publish/analytics, and AI-assisted lesson drafting flows.                                      |
| Metrics       | [metrics.md](./metrics.md)           | Story-level metrics for course conversion, educator publishing, progress tracking, analytics use, and AI draft quality.                      |
| Wireframes    | _not generated_                      | Course catalog, lesson player, educator upload, course builder, and analytics screens remain to be authored before UI implementation.        |

---

## Quick Links

- [product-spec.md](./product-spec.md) — product scope and marketplace boundary
- [user-journey.md](./user-journey.md) — learner and educator flows
- [metrics.md](./metrics.md) — measurable product outcomes
- [../research.md](../research.md) — consolidated research source
- [../spec.md](../spec.md) — canonical feature specification
- [../plan.md](../plan.md) — M7 technical plan

---

## Artifact Cross-Reference

```text
research.md
    |
    v
product-spec.md
    |
    +-- Must Have: catalog, preview/purchase, enrollment, progress, educator publish, analytics
    +-- Should Have: recipe links, AI script draft, follow-feed integration, revenue share
    |
    v
user-journey.md
    |
    +-- learner purchases and learns
    +-- educator uploads and publishes
    +-- educator drafts lessons with AI assistance
    |
    v
metrics.md
    |
    +-- conversion, activation, completion, publish success, revenue and analytics quality
```

---

## Traceability Rules Applied

1. Live classes are explicitly out of v1 scope; async video is the launch boundary.
2. Purchase and revenue mechanics depend on feature 010; creator identity and follow surfaces depend on feature 012.
3. Metrics are product validation targets and do not imply implementation or executed test evidence.
4. Wireframes are explicitly absent and should be generated before visual implementation work begins.
