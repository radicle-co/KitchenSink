# Product Spec: Public Creator Profiles

**Branch**: `012-creator-profiles`
**Date**: 2026-05-09
**Status**: Bootstrapped / pending revalidation
**Source**: [product-spec.md](./product-spec.md)

---

## Index

This directory contains Product Forge product specification artifacts for feature 012.

| Artifact      | File                                 | Description                                                                                                                     |
| ------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md) | Vision, Must/Should/Won't stories, creator/discovery personas, detailed FRs, constraints, and monetization boundaries.          |
| User Journeys | [user-journey.md](./user-journey.md) | End-to-end journeys for handle claim, public browsing/following, creator analytics, and embed publishing.                       |
| Metrics       | [metrics.md](./metrics.md)           | Story-level metrics for handle activation, profile discovery, follow graph health, analytics usefulness, and embed adoption.    |
| Wireframes    | _not generated_                      | Profile, collection, follow/feed, analytics, and embed configuration wireframes remain to be authored before UI implementation. |

---

## Quick Links

- [product-spec.md](./product-spec.md) — product scope and story map
- [user-journey.md](./user-journey.md) — primary user flows
- [metrics.md](./metrics.md) — product execution metrics
- [../research.md](../research.md) — consolidated research source
- [../spec.md](../spec.md) — canonical feature specification
- [../plan.md](../plan.md) — implementation plan

---

## Artifact Cross-Reference

```text
research.md
    |
    v
product-spec.md
    |
    +-- Must Have: handle, collections, follow, public profile, embed, analytics
    +-- Should Have: monetization hooks delegated to 010
    |
    v
user-journey.md
    |
    +-- Robin claims and curates
    +-- Morgan discovers and follows
    +-- Drew embeds recipes externally
    |
    v
metrics.md
    |
    +-- creator activation, visitor-to-follow, feed engagement, analytics usage, embed health
```

---

## Traceability Rules Applied

1. Monetization mechanics remain owned by feature 010; 012 documents delegation points only.
2. Metrics are product validation targets and do not imply implementation or execution evidence.
3. Wireframes are explicitly absent and should be generated before visual implementation work begins.
