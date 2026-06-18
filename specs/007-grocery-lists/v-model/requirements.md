# V-Model Requirements Specification: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Created**: 2026-05-09
**Status**: Approved — reviewed and aligned with spec.md pre-handoff pass (2026-05-10)
**Source**: `specs/007-grocery-lists/spec.md`

## Overview

Grocery list generation from meal plans with ingredient aggregation, deduplication, and online ordering integration. This feature is a natural extension of meal planning (006) that delivers tangible time savings and drives subscription value through premium online ordering capabilities.

## Requirements

### Functional Requirements

| ID      | Description                                                                                                                                                                     | Priority | Rationale                                                                                        | Verification Method |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------ | ------------------- |
| REQ-001 | The system MUST generate a consolidated grocery list from a meal plan, aggregating all ingredients across all planned recipes.                                                  | P1       | FR-028 — Core feature; users need a single unified list rather than per-recipe lists.            | Test                |
| REQ-002 | The system MUST deduplicate ingredients that appear in two / more recipes, summing their quantities into a single line item.                                                    | P1       | FR-028 — Prevents users from purchasing duplicate items; core correctness requirement.           | Test                |
| REQ-003 | The system MUST complete grocery list generation from a 7-day meal plan within 5 seconds.                                                                                       | P1       | SC-004 — Measurable performance outcome; ensures usable response time.                           | Test                |
| REQ-004 | The system MUST allow users to mark individual grocery list items as "already have" to exclude them from the active shopping list.                                              | P1       | FR-029 — Reduces unnecessary purchases; core usability requirement.                              | Test                |
| REQ-005 | The system MUST exclude items marked as "already have" from the shopping list view, any online order submission.                                                                | P1       | FR-029 / Acceptance Scenario 3 — Ensures marked items do not appear in the final order.          | Test                |
| REQ-006 | The system MUST allow users to configure supported grocery store integrations for online ordering.                                                                              | P2       | FR-030 — Prerequisite for online ordering; users must be able to connect their preferred store.  | Demonstration       |
| REQ-007 | The system MUST guide users through store setup, connection when they attempt online ordering without a configured grocery store.                                               | P2       | Acceptance Scenario 5 — Prevents dead-end UX; ensures discoverability of the configuration flow. | Demonstration       |
| REQ-008 | The system MUST map grocery list ingredients to store products, facilitate online order creation for users with a configured grocery store. _(Premium feature)_                 | P2       | FR-031 — Core premium capability; drives subscription value.                                     | Test                |
| REQ-009 | The system MUST handle the case where a user attempts to generate a grocery list from an empty meal plan by surfacing an appropriate error / guidance message.                  | P2       | Edge case — prevents silent failures and confusing empty-list states.                            | Test                |
| REQ-010 | The system MUST handle grocery store API outages gracefully during online ordering, surfacing a user-facing error message, preserving the grocery list state without data loss. | P2       | Edge case — ensures resilience against third-party API failures.                                 | Test                |
| REQ-011 | The system SHOULD enable users to complete a full meal-plan-to-grocery-list workflow in under 10 minutes for a 7-day plan.                                                      | P2       | SC-008 — Measurable usability outcome; validates end-to-end workflow efficiency.                 | Demonstration       |

### Non-Functional Requirements

| ID         | Description                                                                                                                                           | Priority | Rationale                                                                                                      | Verification Method |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------- | ------------------- |
| REQ-NF-001 | All TypeScript code for this feature MUST compile with `strict: true`; `any` MUST NOT be used outside explicitly marked test doubles.                 | P1       | NFR-001 / Constitution Principle I — Type safety prevents runtime errors and maintains codebase integrity.     | Inspection          |
| REQ-NF-002 | All exported functions, interfaces introduced by this feature MUST carry JSDoc documentation.                                                         | P1       | NFR-002 / Constitution Principle II — Ensures maintainability and discoverability of the public API.           | Inspection          |
| REQ-NF-003 | All UI components introduced by this feature MUST expose an accessible name queryable via `getByRole` / `getByLabel` in Playwright tests.             | P1       | NFR-003 / Constitution Principles IV & VII — Ensures screen-reader compatibility and testability.              | Test                |
| REQ-NF-004 | Color MUST NOT be the sole conveyor of state in any UI component for this feature; an icon / text label pairing MUST accompany any color-coded state. | P1       | NFR-004 / Constitution Principle VII — Accessibility requirement; supports users with color vision deficiency. | Inspection          |

### Interface Requirements

| ID         | Description                                                                                                                                                                    | Priority | Rationale                                                                                                          | Verification Method |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------- |
| REQ-IF-001 | The system SHALL integrate with third-party grocery store APIs (e.g., Instacart, Kroger, Amazon Fresh) for online order creation; available stores MUST vary by user location. | P2       | Assumption — online ordering is implemented via third-party APIs; interface contract must be defined per provider. | Test                |
| REQ-IF-002 | The system SHALL consume ingredient data from Recipe entities as defined in the `001-commise-recipe-app` specification.                                                        | P1       | Dependency — ingredient identity and quantity data originates from the Recipe domain.                              | Inspection          |
| REQ-IF-003 | The system SHALL use USDA Food Data (`003-usda-food-data`) for ingredient identity resolution, unit normalization during aggregation, deduplication.                           | P1       | Dependency — correct deduplication requires canonical ingredient identity and unit normalization.                  | Test                |
| REQ-IF-004 | The system SHALL consume meal plan data from the `006-meal-planning` feature as the source for grocery list generation.                                                        | P1       | Dependency — grocery lists are derived from meal plans; no meal plan data means no grocery list.                   | Test                |
| REQ-IF-005 | The system SHALL enforce authentication via `002-user-auth` for all grocery list, online ordering endpoints.                                                                   | P1       | Dependency — all grocery features require authentication; unauthenticated access MUST be rejected.                 | Test                |
| REQ-IF-006 | Online ordering SHALL be restricted to users with an active premium subscription as defined in `010-subscriptions`.                                                            | P2       | Dependency — online ordering is a premium feature; subscription gate must be enforced at the interface layer.      | Test                |

| REQ-IF-007 | The system SHALL provide equivalent web and mobile user-facing workflows for Grocery Lists & Online Ordering, including the same core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths unless an explicit V-Model parity exception is recorded. | P1 | KitchenSink Constitution Principle VIII requires web/mobile lockstep for every user-facing capability. | Test |

### Constraint Requirements

| ID         | Description                                                                                                                                                | Priority | Rationale                                                                                | Verification Method |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- | ------------------- |
| REQ-CN-001 | The feature MUST NOT be accessible without a valid Clerk session token; all API routes MUST verify the token before processing any request.                | P1       | Security constraint — grocery data is user-specific and must be protected.               | Test                |
| REQ-CN-002 | Online ordering functionality MUST be gated behind the premium subscription tier; free-tier users MUST NOT be able to submit orders to grocery store APIs. | P2       | Business constraint — online ordering is a premium feature driving subscription revenue. | Test                |
| REQ-CN-003 | Grocery list generation MUST derive ingredient data exclusively from the meal plan, recipe entities; no manual ingredient entry is in scope for this spec. | P1       | Scope constraint — manual entry is not described in spec.md; prevents scope creep.       | Inspection          |

## Assumptions

- Grocery store integrations will be implemented via third-party APIs (e.g., Instacart, Kroger, Amazon Fresh); available stores will vary by user location.
- Unit normalization (e.g., "2 cups" + "500 ml" of the same ingredient) is handled by the USDA Food Data integration (`003-usda-food-data`).
- The premium subscription gate for online ordering is enforced by the `010-subscriptions` feature; this spec assumes that gate exists and is callable.

## Dependencies

| Spec                                                           | Relationship                                                                   |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [006-meal-planning](../../006-meal-planning/spec.md)           | **Required** — grocery lists are generated from meal plans (REQ-IF-004)        |
| [001-commise-recipe-app](../../001-commise-recipe-app/spec.md) | **Required** — ingredient data comes from Recipe entities (REQ-IF-002)         |
| [003-usda-food-data](../../003-usda-food-data/spec.md)         | **Required** — ingredient identity and unit normalization (REQ-IF-003)         |
| [002-user-auth](../../002-user-auth/spec.md)                   | **Required** — all grocery features require authentication (REQ-IF-005)        |
| [010-subscriptions](../../010-subscriptions/spec.md)           | **Referenced** — online ordering is a premium feature (REQ-IF-006, REQ-CN-002) |

## Glossary

| Term              | Definition                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grocery List      | An aggregated, deduplicated list of ingredients derived from a meal plan. Items can be marked as "already have" or mapped to store products for online ordering. |
| Aggregation       | The process of combining all ingredient quantities across all recipes in a meal plan into a single unified list.                                                 |
| Deduplication     | The process of merging multiple occurrences of the same ingredient (across recipes) into a single line item with summed quantities.                              |
| "Already Have"    | A user-applied flag on a grocery list item indicating the ingredient is already in stock and should be excluded from the shopping list and any online order.     |
| Online Ordering   | A premium feature that maps grocery list items to products in a connected grocery store and submits an order via the store's API.                                |
| Store Integration | A configured connection between the user's account and a supported third-party grocery store API (e.g., Instacart, Kroger, Amazon Fresh).                        |
| Premium Feature   | Functionality restricted to users with an active paid subscription as defined in `010-subscriptions`.                                                            |

---

**Total Requirements**: 24
**By Priority**: P1: 16 | P2: 8 | P3: 0
**By Verification Method**: Test: 16 | Inspection: 6 | Analysis: 0 | Demonstration: 2
