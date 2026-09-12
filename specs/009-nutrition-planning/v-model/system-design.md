# System Design: Nutrition Planning

**Feature Branch**: `009-nutrition-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/009-nutrition-planning/v-model/requirements.md`

## Overview

The Nutrition Planning system decomposes into components covering plan management, compliance analysis, trainer-client workflows, AI-powered recipe swap suggestions, external integrations, and cross-cutting concerns (auth, subscription gating, type safety). Every requirement from `requirements.md` is satisfied by at least one system component.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                               | Description                                                                                                                                                                    | Parent Requirements       | Type      |
| ------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------- | --------- |
| SYS-001 | Nutrition Plan Manager             | Creates, persists, and retrieves nutrition plans with daily/weekly caloric and macronutrient targets (protein, carbs, fat). Exposes CRUD operations for plans.                 | REQ-001, REQ-004          | Service   |
| SYS-002 | Meal Plan Linker                   | Associates meal plans with nutrition plans. Manages the link lifecycle (create, update, remove). Validates that referenced meal plans exist via the Meal Planning integration. | REQ-002, REQ-IF-001       | Module    |
| SYS-003 | Compliance Analyser                | Computes the gap/excess between a linked meal plan's nutritional totals and the nutrition plan's targets. Produces structured compliance results with gap/excess indicators.   | REQ-003, REQ-NF-005       | Service   |
| SYS-004 | Dashboard Visibility Controller    | Ensures created nutrition plans appear on the user's dashboard. Manages plan listing, ordering, and visibility state.                                                          | REQ-004                   | Module    |
| SYS-005 | Trainer-Client Plan Controller     | Allows users with the trainer role to create and manage nutrition plans on behalf of consenting clients. Enforces role checks and consent state before any write.              | REQ-005, REQ-006, REQ-008 | Subsystem |
| SYS-006 | Consent Manager                    | Records and enforces explicit client consent for trainer-managed nutrition plans. Provides consent grant/revoke operations and consent-state queries.                          | REQ-008                   | Module    |
| SYS-007 | AI Recipe Swap Suggester           | Analyses compliance gaps and suggests recipe swaps or adjustments to bring a meal plan into alignment with its linked nutrition targets. Premium-gated.                        | REQ-007                   | Service   |
| SYS-008 | Meal Planning Integration Adapter  | Wraps the 006-meal-planning API to retrieve meal plan nutritional totals for compliance analysis.                                                                              | REQ-IF-001, REQ-CN-001    | Subsystem |
| SYS-009 | USDA Food Data Integration Adapter | Wraps the 003-usda-food-data API to obtain per-food nutritional values used in compliance calculations.                                                                        | REQ-IF-002, REQ-CN-001    | Subsystem |
| SYS-010 | Recipe App Integration Adapter     | Wraps the 001-commise-recipe-app API to obtain recipe-level nutritional data as the basis for compliance calculations.                                                         | REQ-IF-003, REQ-CN-001    | Subsystem |
| SYS-011 | Auth Integration Adapter           | Wraps the 002-user-auth service to authenticate all requests and resolve trainer-client user relationships.                                                                    | REQ-IF-004, REQ-CN-001    | Subsystem |
| SYS-012 | Subscription Gate                  | Checks active premium subscription status via the 010-subscriptions feature before allowing access to trainer plan creation and AI recipe swap suggestions.                    | REQ-IF-005, REQ-CN-002    | Module    |
| SYS-013 | TypeScript Strict Compliance Layer | Cross-cutting enforcement of `strict: true` compilation, prohibition of `any`, and JSDoc documentation on all exported symbols.                                                | REQ-NF-001, REQ-NF-002    | Utility   |
| SYS-014 | Accessibility Compliance Layer     | Cross-cutting enforcement of accessible UI component names (queryable via `getByRole`/`getByLabel`) and non-color-only compliance indicators (icon/text pairing).              | REQ-NF-003, REQ-NF-004    | Utility   |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                                |
| ------- | ------- | ------------ | ----------------------------------------------------------------------------- |
| SYS-002 | SYS-001 | Calls        | Cannot link meal plans; link operations fail                                  |
| SYS-002 | SYS-008 | Calls        | Cannot validate meal plan existence; link creation blocked                    |
| SYS-003 | SYS-002 | Reads        | Cannot retrieve linked meal plan; compliance analysis unavailable             |
| SYS-003 | SYS-008 | Calls        | Cannot obtain meal plan nutritional totals; compliance analysis fails         |
| SYS-003 | SYS-009 | Calls        | Cannot obtain per-food nutritional values; calculation accuracy degraded      |
| SYS-003 | SYS-010 | Calls        | Cannot obtain recipe nutritional data; compliance analysis incomplete         |
| SYS-004 | SYS-001 | Reads        | Dashboard shows no plans; user cannot discover created plans                  |
| SYS-005 | SYS-001 | Calls        | Trainer cannot create plans on behalf of clients                              |
| SYS-005 | SYS-006 | Calls        | Consent state unavailable; trainer plan creation blocked (safe failure)       |
| SYS-005 | SYS-011 | Calls        | Cannot resolve trainer-client relationships; trainer operations blocked       |
| SYS-005 | SYS-012 | Calls        | Cannot verify premium subscription; trainer operations blocked (safe failure) |
| SYS-007 | SYS-003 | Reads        | No compliance gap data; swap suggestions unavailable                          |
| SYS-007 | SYS-010 | Calls        | Cannot retrieve recipe alternatives; swap suggestions unavailable             |
| SYS-007 | SYS-012 | Calls        | Cannot verify premium subscription; AI swaps blocked (safe failure)           |
| SYS-001 | SYS-011 | Calls        | Cannot authenticate user; all plan operations blocked                         |
| SYS-008 | SYS-011 | Calls        | Cannot authenticate outbound requests to meal planning service                |
| SYS-009 | SYS-011 | Calls        | Cannot authenticate outbound requests to USDA food data service               |
| SYS-010 | SYS-011 | Calls        | Cannot authenticate outbound requests to recipe app service                   |

### Dependency Diagram

```text
SYS-011 (Auth) ◄─── SYS-001 (Plan Manager) ◄─── SYS-004 (Dashboard)
                          ▲
SYS-012 (Sub Gate) ◄─┬───┤
                      │   └─── SYS-002 (Linker) ──► SYS-008 (Meal Planning Adapter)
SYS-006 (Consent) ◄──┤              │
                      │             ▼
SYS-011 ◄─────────── SYS-005 (Trainer-Client) ──► SYS-012

SYS-003 (Compliance) ◄── SYS-002
    │ ──► SYS-008
    │ ──► SYS-009 (USDA Adapter)
    │ ──► SYS-010 (Recipe Adapter)
    ▼
SYS-007 (AI Swaps) ──► SYS-012
    └──► SYS-010
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Component | Interface Name                   | Protocol | Input                                                                                         | Output                                                                         | Error Handling                                            |
| --------- | -------------------------------- | -------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| SYS-001   | Create Nutrition Plan            | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `NutritionPlan` object with `id`, `userId`, timestamps (Derived)               | 400 validation error; 401 unauthenticated                 |
| SYS-001   | Get Nutrition Plan               | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `NutritionPlan` object (Derived)                                               | 404 not found; 403 forbidden                              |
| SYS-002   | Link Meal Plan                   | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Updated `NutritionPlan` with linked meal plan reference (Derived)              | 404 if either plan not found; 409 already linked          |
| SYS-003   | Get Compliance Analysis          | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `ComplianceResult { calories, protein, carbs, fat }` with gap/excess (Derived) | 404 if no linked meal plan                                |
| SYS-005   | Create Plan for Client (Trainer) | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `NutritionPlan` object owned by client (Derived)                               | 403 if not trainer; 403 if no consent; 402 if not premium |
| SYS-007   | Get Recipe Swap Suggestions      | REST     | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `SwapSuggestion[]` with recipe alternatives (Derived)                          | 402 if not premium; 404 if no compliance gap              |

### Internal Interfaces

| Source  | Target  | Interface Name              | Protocol                                                                                      | Data Format                                         | Error Handling                      |
| ------- | ------- | --------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------- |
| SYS-002 | SYS-008 | Fetch Meal Plan Totals      | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `MealPlanId → MealPlanNutritionTotals` (Derived)    | Throws `MealPlanNotFoundError`      |
| SYS-003 | SYS-009 | Fetch Food Nutritional Data | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `FoodId[] → FoodNutritionMap` (Derived)             | Throws `FoodDataUnavailableError`   |
| SYS-003 | SYS-010 | Fetch Recipe Nutrition      | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `RecipeId[] → RecipeNutritionMap` (Derived)         | Throws `RecipeDataUnavailableError` |
| SYS-005 | SYS-006 | Check/Grant Consent         | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ trainerId, clientId } → ConsentStatus` (Derived) | Throws `ConsentNotGrantedError`     |
| SYS-005 | SYS-012 | Check Premium Subscription  | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `userId → SubscriptionStatus` (Derived)             | Throws `SubscriptionRequiredError`  |
| SYS-007 | SYS-003 | Read Compliance Gap         | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `NutritionPlanId → ComplianceResult` (Derived)      | Throws `ComplianceUnavailableError` |
| SYS-001 | SYS-011 | Authenticate Request        | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `JWT → AuthenticatedUser` (Derived)                 | Throws `UnauthorizedError`          |

## Data Design View (IEEE 1016 §5.4)

| Entity             | Component | Storage     | Protection at Rest       | Protection in Transit | Retention                                     |
| ------------------ | --------- | ----------- | ------------------------ | --------------------- | --------------------------------------------- |
| NutritionPlan      | SYS-001   | PostgreSQL  | Row-level security (RLS) | TLS 1.2+              | Retained until user deletes or account closed |
| MealPlanLink       | SYS-002   | PostgreSQL  | RLS (owner + trainer)    | TLS 1.2+              | Retained until unlinked or plan deleted       |
| ComplianceResult   | SYS-003   | In-memory   | N/A (computed on demand) | TLS 1.2+              | Not persisted; recomputed per request         |
| ConsentRecord      | SYS-006   | PostgreSQL  | RLS (trainer + client)   | TLS 1.2+              | Retained until revoked or account closed      |
| SwapSuggestion     | SYS-007   | In-memory   | N/A (computed on demand) | TLS 1.2+              | Not persisted; recomputed per request         |
| SubscriptionStatus | SYS-012   | Cache (TTL) | N/A (read-only from 010) | TLS 1.2+              | TTL 60s; refreshed on expiry                  |

---

## Coverage Summary

| Metric                            | Count    |
| --------------------------------- | -------- |
| Total REQ-NNN (functional)        | 8        |
| Total REQ-NF-NNN (non-functional) | 5        |
| Total REQ-IF-NNN (interface)      | 5        |
| Total REQ-CN-NNN (constraint)     | 2        |
| **Total Requirements**            | **20**   |
| Total SYS-NNN components          | 14       |
| Requirements with ≥1 SYS mapping  | 20       |
| **Coverage**                      | **100%** |

### Requirement → Component Mapping

| Requirement | Mapped SYS Components              |
| ----------- | ---------------------------------- |
| REQ-001     | SYS-001                            |
| REQ-002     | SYS-002                            |
| REQ-003     | SYS-003                            |
| REQ-004     | SYS-001, SYS-004                   |
| REQ-005     | SYS-005                            |
| REQ-006     | SYS-005                            |
| REQ-007     | SYS-007                            |
| REQ-008     | SYS-005, SYS-006                   |
| REQ-NF-001  | SYS-013                            |
| REQ-NF-002  | SYS-013                            |
| REQ-NF-003  | SYS-014                            |
| REQ-NF-004  | SYS-014                            |
| REQ-NF-005  | SYS-003                            |
| REQ-IF-001  | SYS-002, SYS-008                   |
| REQ-IF-002  | SYS-009                            |
| REQ-IF-003  | SYS-010                            |
| REQ-IF-004  | SYS-011                            |
| REQ-IF-005  | SYS-012                            |
| REQ-CN-001  | SYS-008, SYS-009, SYS-010, SYS-011 |
| REQ-CN-002  | SYS-012                            |
