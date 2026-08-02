# User Journeys: Nutrition Planning

**Branch**: `009-nutrition-planning`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)

---

## Journey Notation

Steps reference FR IDs where available. When no direct FR exists, references point to REQ IDs or are marked warning-level augmentation.

---

## Persona 1: Diet-Conscious User (Riley) — Journey A: Create Plan and Track Daily Compliance

**Scenario**: Riley creates a macro target plan, links it to a meal plan, and checks whether the day is on track.

```mermaid
sequenceDiagram
    participant U as Riley (Web/Mobile)
    participant API as Nutrition API
    participant MP as Meal Planning (006)
    participant DB as Nutrition DB

    U->>API: POST /api/v1/nutrition-plans (targets)
    Note right: FR-036
    API->>DB: Insert nutrition_plans row
    DB-->>API: plan_id
    API-->>U: 201 Created

    U->>API: POST /api/v1/nutrition-plans/{id}/link (meal_plan_id)
    Note right: FR-037
    API->>DB: Insert meal_plan_nutrition_link
    API-->>U: 200 Linked

    U->>API: GET /api/v1/nutrition-plans/{id}/compliance
    API->>MP: Fetch daily rollups (actuals)
    MP-->>API: calories/protein/carbs/fat by day
    API->>DB: Compute + persist compliance snapshot
    API-->>U: planned vs actual + delta + status
    Note right: FR-037, SC-010
```

---

## Persona 2: Personal Trainer (Sam) — Journey B: Assign and Monitor Client Plan (Premium)

**Scenario**: Sam creates a nutrition plan for a client after consent and monitors compliance trend.

```mermaid
sequenceDiagram
    participant T as Trainer Sam
    participant API as Nutrition API
    participant C as Client Jordan
    participant DB as Nutrition DB

    C->>API: Provide explicit consent for trainer nutrition management
    API->>DB: Store consent timestamp + status
    Note right: REQ-008 (assumption-derived)

    T->>API: POST /api/v1/trainer/clients/{clientId}/nutrition-plan
    Note right: FR-038
    API->>DB: Insert nutrition_plan (trainer-owned for client)
    API-->>T: 201 Created

    C->>API: GET /api/v1/nutrition-plans
    API-->>C: Includes trainer-assigned plan
    Note right: FR-038

    T->>API: GET /api/v1/trainer/clients/{clientId}/compliance
    API-->>T: Weekly adherence summary
```

---

## Persona 3: Coached Client (Jordan) — Journey C: Receive Swap Guidance (Premium)

**Scenario**: Jordan’s meal plan misses macro targets; system suggests better-fitting recipe alternatives.

```mermaid
sequenceDiagram
    participant C as Client Jordan
    participant API as Nutrition API
    participant R as Recipe Service

    C->>API: GET /api/v1/nutrition-plans/{id}/compliance
    API-->>C: Status = under protein, over carbs

    C->>API: Request guidance
    API->>R: Query candidate recipe swaps
    R-->>API: Ranked alternatives by macro fit
    API-->>C: Suggested swaps + projected delta improvement
    Note right: FR-039
```

---

## Edge Journey: Deficiency Alert Surface (Warning-Level Augmentation)

If deficiency alerts are enabled in future scope, the journey should show:

1. Alert trigger with confidence context
2. Link to contributing meal/nutrient breakdown
3. Non-prescriptive guidance copy and professional escalation note

**WARNING**: Not covered by explicit FR IDs in current `spec.md`.

---

## Coverage Matrix

| Journey | Covered IDs                                   |
| ------- | --------------------------------------------- |
| A       | FR-036, FR-037, SC-010                        |
| B       | FR-038, REQ-008                               |
| C       | FR-039                                        |
| Edge    | Warning-level augmentation (deficiency alert) |
