# Competitor Analysis: Food and Nutrition Data Providers

**Branch**: `003-usda-food-data` | **Date**: 2026-05-09
**Status**: Complete | **Source**: [research.md](../research.md), domain constraints from [spec.md](../spec.md)

_Updated 2026-06-20: synced to the clarified design (Postgres-as-queue / rolling-window / demotion)._

---

## Competitive Landscape Overview

USDA integration competes less on frontend polish and more on data coverage, licensing terms, update cadence, and operational constraints under rate limits. The key decision axis is whether Commise should be USDA-first with local persistence (chosen), or API-aggregation first with external pass-through (rejected for this feature).

---

## Competitor Profiles

### 1. USDA FoodData Central (FDC)

| Attribute      | Detail                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| **Type**       | Public government dataset + API                                        |
| **Pricing**    | Free                                                                   |
| **Rate limit** | 1,000 requests/hour/API key                                            |
| **Strengths**  | Authoritative nutrient data, broad canonical records, no licensing fee |
| **Weaknesses** | Strict rate limit; async architecture required at scale                |
| **Data types** | Foundation, SR Legacy, Branded                                         |
| **Best fit**   | Primary source-of-truth for nutrition                                  |

---

### 2. Edamam Food Database API

| Attribute              | Detail                                                           |
| ---------------------- | ---------------------------------------------------------------- |
| **Type**               | Commercial API                                                   |
| **Pricing**            | Tiered paid plans after free quota                               |
| **Strengths**          | Search ergonomics, API-first onboarding                          |
| **Weaknesses**         | Cost scales with usage; licensing and redistribution constraints |
| **Data trust profile** | Mixed proprietary + partner data                                 |
| **Best fit**           | Fast-prototype enrichment; not chosen for canonical backing      |

---

### 3. Spoonacular

| Attribute            | Detail                                                          |
| -------------------- | --------------------------------------------------------------- |
| **Type**             | Commercial recipe + nutrition API suite                         |
| **Pricing**          | Credit-based usage model                                        |
| **Strengths**        | Rich recipe-adjacent endpoints                                  |
| **Weaknesses**       | Expensive at sustained high-volume lookup                       |
| **Data granularity** | Good for recipe workflows; mixed provenance                     |
| **Best fit**         | Recipe productivity tooling, not authoritative nutrition source |

---

### 4. Open Food Facts

| Attribute              | Detail                                                             |
| ---------------------- | ------------------------------------------------------------------ |
| **Type**               | Community open dataset                                             |
| **Pricing**            | Free                                                               |
| **Strengths**          | Broad branded catalog and barcode richness                         |
| **Weaknesses**         | Data quality variance by contributor/region                        |
| **Best fit**           | Supplemental branded coverage                                      |
| **Launch role in 003** | Candidate future fallback; not selected for v1 canonical ingestion |

---

### 5. Nutritionix

| Attribute      | Detail                                                             |
| -------------- | ------------------------------------------------------------------ |
| **Type**       | Commercial nutrition API                                           |
| **Pricing**    | Paid                                                               |
| **Strengths**  | Strong branded and natural language lookup                         |
| **Weaknesses** | Cost and contract lock-in risk                                     |
| **Best fit**   | Commercial consumer apps optimizing speed over source transparency |

---

### 6. Hybrid app pattern (Cronometer-style sourcing)

| Attribute            | Detail                                                          |
| -------------------- | --------------------------------------------------------------- |
| **Type**             | Product pattern, not a single API                               |
| **Strengths**        | Clear source trust hierarchy (USDA/NCCDB first, branded second) |
| **Weaknesses**       | Requires complex source governance and curation workflows       |
| **Relevance to 003** | Supports our USDA-first + brand-aware disambiguation direction  |

---

## Feature Parity Matrix

| Capability                        | USDA FDC     | Edamam | Spoonacular | Open Food Facts | 003 Direction                                          |
| --------------------------------- | ------------ | ------ | ----------- | --------------- | ------------------------------------------------------ |
| Authoritative nutrient baseline   | ✅           | ⚠️     | ⚠️          | ⚠️              | ✅ USDA-first                                          |
| Free at launch scale              | ✅           | ❌     | ❌          | ✅              | ✅                                                     |
| Brand vs generic distinction      | ✅           | ✅     | ✅          | ✅              | ✅ (explicit UX disambiguation)                        |
| Hard external rate limit pressure | ⚠️           | ⚠️     | ⚠️          | ⚠️              | Managed via Postgres-as-queue + rolling-window limiter |
| Search-as-you-type ergonomics     | Raw API only | ✅     | ✅          | ⚠️              | ✅ local pg_trgm search                                |
| Licensing simplicity              | ✅           | ⚠️     | ⚠️          | ✅              | ✅                                                     |

---

## Pricing Comparison (2026)

| Provider        | Launch Cost             | Scaling Risk                            |
| --------------- | ----------------------- | --------------------------------------- |
| USDA FDC        | $0 API cost             | Operational complexity from rate limits |
| Edamam          | Paid tiers              | Request-volume billing                  |
| Spoonacular     | Credit-based paid tiers | Cost spikes with feature growth         |
| Open Food Facts | $0 API cost             | Quality/normalization burden            |

---

## Market Gaps 003 Targets

1. **Queue-native nutrition lookup**: Most integrations still do synchronous pass-through calls.
2. **Deterministic pending-state UX**: Explicit pending/polled lifecycle for first-time lookups.
3. **Brand-vs-generic disambiguation at ingredient pick time**: Better recipe-quality nutrition outcomes.
4. **Cost-resilient architecture**: No per-request API vendor spend for core nutrition source.

---

## Differentiation Thesis

Feature 003 differentiates by combining authoritative USDA sourcing with an event-driven local-cache architecture that protects user latency and cost profile. The strategic advantage is not “another nutrition API client” — it is predictable recipe-time UX under hard external rate limits, with explicit disambiguation and ingredient-level linking semantics that compound in downstream features (meal planning, grocery lists, nutrition planning).

---

## Sources

- [research.md](../research.md)
- [spec.md](../spec.md)
- [plan.md](../plan.md)
