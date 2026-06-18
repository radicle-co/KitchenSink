# System Design: Meal Planning

**Feature Branch**: `006-meal-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/006-meal-planning/v-model/requirements.md`

## Overview

The Meal Planning system is decomposed into eight system components spanning meal plan lifecycle management, nutritional computation, AI-powered premium features, external service adapters, and cross-cutting infrastructure. The decomposition follows a layered architecture: a REST API layer handles client requests, a domain service layer enforces business rules, adapter components integrate external dependencies (Recipe API, USDA food data, Clerk, AI provider), and a persistence layer manages durable state. Cross-cutting concerns (type safety, documentation, accessibility) are addressed by a dedicated quality-assurance component.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                          | Description                                                                                                                                                                                                                    | Parent Requirements                                                    | Type      |
| ------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- | --------- |
| SYS-001 | Meal Plan Manager             | Creates, reads, updates, and deletes meal plans. Manages date-range configuration, meal-slot definitions (breakfast, lunch, dinner, snacks), and plan lifecycle state. Enforces the 30-day+ scalability constraint.            | REQ-001, REQ-002, REQ-009, REQ-010                                     | Subsystem |
| SYS-002 | Recipe Assignment Service     | Handles assignment and removal of recipes from meal slots within a plan. Validates that assigned recipes belong to the authenticated user's collection via the Recipe API adapter.                                             | REQ-003, REQ-009                                                       | Module    |
| SYS-003 | Nutritional Summary Engine    | Computes daily and weekly nutritional summaries by aggregating ingredient data from assigned recipes via the USDA food data adapter. Caches computed summaries to meet the 10-minute workflow SLA.                             | REQ-004, REQ-005, REQ-011                                              | Service   |
| SYS-004 | AI Meal Suggestion Service    | Provides AI-powered recipe recommendations for premium users. Invokes the AI provider adapter with user dietary preferences and available recipe collection to generate ranked suggestions.                                    | REQ-006                                                                | Service   |
| SYS-005 | Meal Plan Auto-Generator      | Generates a complete meal plan for premium users based on user-defined preferences and constraints. Produces a reviewable, modifiable plan by orchestrating the AI provider adapter and Recipe Assignment Service.             | REQ-007                                                                | Service   |
| SYS-006 | Food Waste Optimizer          | Analyzes ingredient overlap across assigned recipes within a plan and suggests rearrangements or swaps to maximize shared ingredient usage. Premium-only feature.                                                              | REQ-008                                                                | Service   |
| SYS-007 | External Integration Adapters | Encapsulates all outbound integrations: Recipe API (001), USDA food data (003), Clerk authentication (002), AI provider (005). Exposes meal plan data for downstream consumers: grocery lists (007) and nutrition plans (009). | REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004, REQ-IF-005, REQ-IF-006 | Subsystem |
| SYS-008 | Quality & Compliance Layer    | Cross-cutting component enforcing TypeScript strict-mode compilation, JSDoc documentation coverage, accessible UI component contracts, and color-state accessibility rules across all modules.                                 | REQ-NF-001, REQ-NF-002, REQ-NF-003, REQ-NF-004                         | Utility   |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                                          |
| ------- | ------- | ------------ | --------------------------------------------------------------------------------------- |
| SYS-002 | SYS-001 | Calls        | Recipe assignment fails; meal slots cannot be populated                                 |
| SYS-002 | SYS-007 | Calls        | Cannot validate recipe ownership; assignment blocked                                    |
| SYS-003 | SYS-001 | Reads        | Nutritional summaries unavailable; plan view degrades to recipe-only display            |
| SYS-003 | SYS-007 | Calls        | USDA food data unavailable; nutritional computation fails with partial/empty summaries  |
| SYS-004 | SYS-007 | Calls        | AI suggestions unavailable; premium feature degrades gracefully with error message      |
| SYS-005 | SYS-004 | Calls        | Auto-generation cannot produce AI-ranked plan; falls back to error or manual assignment |
| SYS-005 | SYS-002 | Calls        | Auto-generated assignments cannot be persisted; plan generation fails                   |
| SYS-006 | SYS-001 | Reads        | Optimizer cannot read plan; food waste analysis unavailable                             |
| SYS-006 | SYS-007 | Calls        | Ingredient overlap data unavailable; optimization suggestions cannot be generated       |
| SYS-001 | SYS-007 | Calls        | Clerk authentication unavailable; all meal planning operations blocked                  |

### Dependency Diagram

```text
SYS-007 (External Adapters)
  ├── Clerk ← SYS-001 (auth gate for all operations)
  ├── Recipe API ← SYS-002
  ├── USDA Food Data ← SYS-003
  ├── AI Provider ← SYS-004
  └── Downstream (007, 009) ← exposed by SYS-001

SYS-001 (Meal Plan Manager)
  └── SYS-002 (Recipe Assignment)
        └── SYS-007

SYS-003 (Nutritional Engine)
  ├── SYS-001
  └── SYS-007

SYS-004 (AI Suggestions)
  └── SYS-007

SYS-005 (Auto-Generator)
  ├── SYS-004
  └── SYS-002

SYS-006 (Waste Optimizer)
  ├── SYS-001
  └── SYS-007

SYS-008 (Quality Layer) — cross-cutting, no runtime dependencies
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Component | Interface Name               | Protocol  | Input                                                                                         | Output                                                | Error Handling                                |
| --------- | ---------------------------- | --------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------- |
| SYS-001   | Meal Plan REST API           | REST/JSON | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `MealPlanDTO`, `MealPlanListDTO` (Derived)            | HTTP 400 validation, 401 auth, 404 not found  |
| SYS-002   | Recipe Assignment REST API   | REST/JSON | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `MealSlotDTO` (Derived)                               | HTTP 400, 404 slot/recipe not found           |
| SYS-003   | Nutritional Summary REST API | REST/JSON | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `NutritionalSummaryDTO { daily[], weekly }` (Derived) | HTTP 404, 503 if USDA unavailable             |
| SYS-004   | AI Suggestions REST API      | REST/JSON | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `SuggestionListDTO { recipes[] }` (Derived)           | HTTP 402 premium required, 503 AI unavailable |
| SYS-005   | Auto-Generate REST API       | REST/JSON | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `MealPlanDTO` (draft) (Derived)                       | HTTP 402 premium required, 503 AI unavailable |
| SYS-006   | Waste Optimize REST API      | REST/JSON | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `OptimizationSuggestionsDTO { swaps[] }` (Derived)    | HTTP 402 premium required, 404 plan not found |

### Internal Interfaces

| Source  | Target  | Interface Name                   | Protocol                                                                                      | Data Format                                               | Error Handling                           |
| ------- | ------- | -------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| SYS-001 | SYS-007 | Clerk session-token verification | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Bearer token → `AuthContext { userId, tier }` (Derived)   | Throw `UnauthorizedException`            |
| SYS-002 | SYS-007 | Recipe API Fetch                 | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `recipeId` → `RecipeDTO { ingredients[] }` (Derived)      | Throw `RecipeNotFoundException`          |
| SYS-003 | SYS-007 | USDA Food Data Lookup            | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `ingredientIds[]` → `NutrientDataDTO[]` (Derived)         | Throw `NutrientDataUnavailableException` |
| SYS-004 | SYS-007 | AI Provider Invoke               | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `PromptDTO` → `AIResponseDTO { suggestions[] }` (Derived) | Throw `AIProviderException`              |
| SYS-005 | SYS-004 | Suggestion Orchestration         | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `preferences` → `SuggestionListDTO` (Derived)             | Propagate `AIProviderException`          |
| SYS-005 | SYS-002 | Bulk Assignment                  | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `AssignRecipeDTO[]` → `MealSlotDTO[]` (Derived)           | Rollback on partial failure              |
| SYS-006 | SYS-007 | Ingredient Overlap Analysis      | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `ingredientIds[][]` → `OverlapMatrixDTO` (Derived)        | Throw `NutrientDataUnavailableException` |

## Data Design View (IEEE 1016 §5.4)

| Entity             | Component | Storage     | Protection at Rest           | Protection in Transit | Retention                              |
| ------------------ | --------- | ----------- | ---------------------------- | --------------------- | -------------------------------------- |
| MealPlan           | SYS-001   | PostgreSQL  | Row-level security (userId)  | TLS 1.3               | Until user deletion or explicit delete |
| MealSlot           | SYS-001   | PostgreSQL  | Row-level security (userId)  | TLS 1.3               | Cascade delete with MealPlan           |
| RecipeAssignment   | SYS-002   | PostgreSQL  | Row-level security (userId)  | TLS 1.3               | Cascade delete with MealSlot           |
| NutritionalSummary | SYS-003   | Redis cache | N/A (derived, non-sensitive) | TLS 1.3               | TTL 1 hour; invalidated on plan change |
| AISuggestionCache  | SYS-004   | Redis cache | N/A (non-sensitive)          | TLS 1.3               | TTL 15 minutes                         |
| OptimizationResult | SYS-006   | In-memory   | N/A (ephemeral)              | TLS 1.3               | Request-scoped; not persisted          |

---

## Coverage Summary

| Metric                            | Count                                                 |
| --------------------------------- | ----------------------------------------------------- |
| Total System Components (SYS)     | 8                                                     |
| Total Parent Requirements Covered | 22 / 22 (100%)                                        |
| Components per Type               | Subsystem: 2 \| Module: 1 \| Service: 4 \| Utility: 1 |
| **Forward Coverage (REQ→SYS)**    | **100%**                                              |

## Derived Requirements

None — all components trace to existing requirements.

## Glossary

| Term                 | Definition                                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Meal Plan            | A collection of meal slots organized by date and meal type spanning a configurable date range               |
| Meal Slot            | An atomic unit within a meal plan representing a specific meal type (breakfast/lunch/dinner/snack) on a day |
| Recipe Assignment    | The association of a Recipe entity to a Meal Slot                                                           |
| Nutritional Summary  | Aggregated macro/micronutrient data computed from ingredient data of all recipes assigned to a plan         |
| Premium Feature      | Functionality gated behind a paid subscription tier (AI suggestions, auto-generation, waste optimization)   |
| Food Waste Optimizer | Algorithm that maximizes shared ingredient usage across meals to reduce grocery waste                       |
