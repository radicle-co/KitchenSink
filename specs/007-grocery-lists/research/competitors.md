# Competitor Analysis: Grocery Lists & Ordering Assistants

**Branch**: `007-grocery-lists` | **Date**: 2026-05-09
**Status**: Complete | **Sources**: [research.md](./research.md) (RQ-1), user-specified competitor set

---

## Competitive Landscape Overview

Feature 007 sits between meal-planning execution and purchase execution. Competitors split into two buckets:

1. **Dedicated grocery list tools** (AnyList, Out of Milk, Bring)
2. **General-purpose task/list tools** (Apple Reminders)

None of the benchmarked tools natively combine all four target capabilities as one flow:

- meal-plan-derived auto-generation (dependency on feature 006)
- robust unit-aware ingredient aggregation
- pantry subtraction / check-off UX
- premium store API ordering handoff with product mapping

---

## Competitor Profiles

### 1. AnyList

| Attribute                           | Detail                                                                                  |
| ----------------------------------- | --------------------------------------------------------------------------------------- |
| **Positioning**                     | Family shopping list + meal planning assistant                                          |
| **Strengths**                       | Fast shared list sync, strong category sorting, reliable item suggestions               |
| **Weaknesses**                      | Limited deep integration with structured recipe ingredient normalization                |
| **Auto-generation from meal plans** | Partial (recipe-to-list workflows exist, but cross-unit normalization depth is limited) |
| **Aisle grouping**                  | Strong (category-first organization)                                                    |
| **Sharing**                         | Strong (household collaboration)                                                        |
| **Ordering integration**            | Limited/region-dependent                                                                |

### 2. Out of Milk

| Attribute                           | Detail                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------ |
| **Positioning**                     | Shopping list + pantry + to-do manager                                   |
| **Strengths**                       | Simple pantry awareness, low-friction list editing                       |
| **Weaknesses**                      | Weaker premium checkout orchestration and product-level mapping fidelity |
| **Auto-generation from meal plans** | Weak                                                                     |
| **Aisle grouping**                  | Moderate                                                                 |
| **Sharing**                         | Moderate                                                                 |
| **Ordering integration**            | Weak                                                                     |

### 3. Bring

| Attribute                           | Detail                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------- |
| **Positioning**                     | Visual shared shopping lists for households                                      |
| **Strengths**                       | Excellent mobile-first UX, quick item add, strong family synchronization         |
| **Weaknesses**                      | Recipe/meal-plan derivation is not core; less deterministic aggregation behavior |
| **Auto-generation from meal plans** | Weak                                                                             |
| **Aisle grouping**                  | Moderate                                                                         |
| **Sharing**                         | Strong                                                                           |
| **Ordering integration**            | Weak                                                                             |

### 4. Apple Reminders

| Attribute                           | Detail                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| **Positioning**                     | General task/reminder utility with grocery templates                          |
| **Strengths**                       | Ubiquity in Apple ecosystem, Siri voice-add convenience                       |
| **Weaknesses**                      | Not domain-specific for ingredient normalization, pantry, or ordering handoff |
| **Auto-generation from meal plans** | None                                                                          |
| **Aisle grouping**                  | Basic (category grouping possible, less domain aware)                         |
| **Sharing**                         | Strong (iCloud list sharing)                                                  |
| **Ordering integration**            | None                                                                          |

---

## Feature Parity Matrix (vs Feature 007 Scope)

| Capability                                | FR Mapping                 | AnyList | Out of Milk | Bring | Apple Reminders | Commise 007 Target |
| ----------------------------------------- | -------------------------- | ------- | ----------- | ----- | --------------- | ------------------ |
| Meal-plan auto generation                 | FR-028                     | ◑       | ○           | ○     | ○               | ●                  |
| Cross-recipe dedupe + quantity sum        | FR-028                     | ◑       | ◑           | ◑     | ○               | ●                  |
| Pantry exclusion in active list           | FR-029                     | ◑       | ●           | ◑     | ○               | ●                  |
| Store integration setup                   | FR-030                     | ◑       | ○           | ○     | ○               | ●                  |
| Product mapping + order handoff (premium) | FR-031                     | ○       | ○           | ○     | ○               | ●                  |
| Fast household collaboration              | (warning: not explicit FR) | ●       | ◑           | ●     | ●               | ◑                  |
| Aisle/store grouping clarity              | FR-028/FR-029 UX           | ●       | ◑           | ◑     | ◑               | ●                  |

Legend: ● strong, ◑ partial, ○ weak/none.

---

## Differentiation Thesis for 007

1. **Deterministic upstream grounding**: Lists are generated from structured meal plans (006) and recipe ingredients (001), not ad-hoc text only.
2. **Higher-fidelity aggregation path**: Shared culinary-unit conversion plus USDA-backed normalization path yields better dedupe than name-only merging.
3. **Premium checkout architecture**: Store setup + SKU mapping + order handoff is explicit in FR-030/FR-031 and plan/tasks.
4. **Store-specific execution UX**: Aisle grouping and list views can be tuned for in-store speed, not only list maintenance.

---

## Risk Notes

- **Sharing gap**: Collaboration/sharing is a requested domain expectation but not yet formalized as explicit FR in `spec.md`.
- **API dependency risk**: Ordering value depends on integration reliability and product mapping freshness.
- **Conversion trust risk**: Incorrect unit conversion degrades user trust quickly; quality must be measurable.
