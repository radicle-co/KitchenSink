# Product Spec: AI Integration

**Branch**: `005-ai-integration`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Index

This directory contains the Product Forge v1.3.0 product specification artifacts for the AI Integration feature.

| Artifact      | File                                  | Description                                                                                                                |
| ------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Product Spec  | [product-spec.md](./product-spec.md)  | Vision, personas, epics, MoSCoW story map with explicit FR traceability (`FR-015..FR-021`).                                |
| User Journeys | [user-journey.md](./user-journey.md)  | End-to-end journeys for in-app AI generation and external-agent OAuth interactions, including fallback and revoke paths.   |
| Wireframes    | [wireframes/](./wireframes/README.md) | Conceptual wireframes for ai-chat, ai-suggestion-card, ai-generation-flow, ai-confidence-indicator, and ai-error-fallback. |
| Metrics       | [metrics.md](./metrics.md)            | Story-level measurable outcomes for Must Have stories. Distinct from research-level ROI framing.                           |

---

## Quick Links

- [product-spec.md](./product-spec.md) — scope and story map
- [user-journey.md](./user-journey.md) — end-to-end behavioral flows
- [wireframes/](./wireframes/README.md) — interaction structure
- [metrics.md](./metrics.md) — measurable story outcomes
- [../spec.md](../spec.md) — canonical FR reference (`FR-015..FR-021`)
- [../plan.md](../plan.md) — technical architecture and endpoint model

---

## Artifact Cross-Reference

```
product-spec.md
    |
    +-- MoSCoW stories (US-001..US-009)
    |       Each story references FR-015..FR-021
    |
    +-- Personas (AI Home Cook / Power Planner / External-Agent Integrator)
    |
    v
user-journey.md
    |
    +-- In-app generation journey
    +-- External-agent OAuth + read/write journey
    +-- Cross-persona fallback/revocation flows
    |
    v
wireframes/
    |
    +-- ai-chat.md
    +-- ai-suggestion-card.md
    +-- ai-generation-flow.md
    +-- ai-confidence-indicator.md
    +-- ai-error-fallback.md
    |
    v
metrics.md
    |
    +-- Must Have story-level metrics
    +-- Targets + measurement signals
```
