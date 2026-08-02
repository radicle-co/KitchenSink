# Tech Stack Rationale: Grocery Lists & Online Ordering

**Branch**: `007-grocery-lists` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [plan.md](../plan.md), [research.md](./research.md), [spec.md](../spec.md)

---

## Overview

Feature 007 extends existing Commise architecture with grocery-specific aggregation and optional ordering handoff. The stack is anchored in TypeScript/NestJS/PostgreSQL and augmented by store partner APIs.

---

## Backend and Data Layer

### NestJS + TypeScript (strict)

Why:

- Existing service conventions and tooling already align to strict TypeScript requirements (NFR-001)
- Task breakdown expects service-oriented modules (`aggregator.service.ts`, `pantry.service.ts`, store clients)

### PostgreSQL (Drizzle-managed schema)

Why:

- New relational entities (`grocery_lists`, `grocery_list_items`, `user_pantry_items`, `grocery_product_map`) fit naturally in RDBMS model
- Query patterns (user lists, grouped items, mapping cache freshness) are straightforward SQL workloads

---

## Shared Conversion and Aggregation Stack

### Shared utility: `culinary-units`

Why:

- Avoids duplicate conversion logic across features 003/006/007
- Provides deterministic parsing and normalization contract for aggregation correctness (SC-004)

Research-backed considerations:

- Existing parse/convert libraries help with unit parsing and same-type conversions
- Volume↔mass conversions require density context and should degrade gracefully when unknown

---

## Store Integration Stack

### Walmart + Instacart client adapters

Why:

- FR-030/FR-031 require configurable store integrations and order facilitation
- Adapter pattern isolates provider-specific auth/search/cart flows

Operational design choices from tasks:

- Timeout and retry policies
- Circuit breaker behavior for resilience
- Local SKU mapping cache (`grocery_product_map`) to reduce partner API churn

---

## Premium Gating Path

Ordering flow is feature-gated through subscription dependency (010).

Why:

- Keeps core grocery generation broadly useful
- Preserves monetization boundary around partner ordering handoff

---

## Frontend Stack Fit

### Next.js web UI + mobile parity considerations

Why:

- Existing workspace structure already supports web and mobile apps
- Grocery interactions (swipe/check, grouped sections, add flow, review/handoff) are UI-heavy and benefit from shared design patterns in `packages/apps/commise/ui`

Accessibility implications:

- Interactive controls must remain role/label queryable (NFR-003)
- State signals require icon/text pairing beyond color (NFR-004)

---

## Trade-Off Summary

| Decision                   | Benefit                           | Trade-off                                      |
| -------------------------- | --------------------------------- | ---------------------------------------------- |
| Shared conversion utility  | Consistent aggregation behavior   | Requires governance for cross-feature changes  |
| Store adapter model        | Clean abstraction and testability | More upfront interface design work             |
| Cache-first mapping lookup | Faster UX and lower API costs     | Staleness/refresh policy must be maintained    |
| Premium ordering gate      | Clear monetization path           | Additional branch/testing complexity in UI/API |

---

## Recommendation

Proceed with staged delivery exactly as tasks sequence specifies: aggregation correctness first, pantry semantics second, store setup/mapping third, ordering handoff fourth. This minimizes compounding uncertainty and aligns with FR priority structure.
