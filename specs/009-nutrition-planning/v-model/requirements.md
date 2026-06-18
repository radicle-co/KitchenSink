# V-Model Requirements Specification: Nutrition Planning

**Feature Branch**: `009-nutrition-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/009-nutrition-planning/spec.md`

## Overview

The Nutrition Planning feature enables users (including personal trainers and diet-conscious individuals) to create nutrition plans that define daily or weekly caloric and macronutrient targets. Plans can be linked to meal plans for compliance tracking, with the system highlighting gaps or excesses. A trainer-client model allows trainers to create plans on behalf of clients (premium). AI-powered recipe swap suggestions help users align meal plans with nutrition targets (premium).

## Requirements

### Functional Requirements

| ID      | Description                                                                                                                                                                                     | Priority | Rationale                                                                                                               | Verification Method |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------- |
| REQ-001 | The system MUST allow users to create nutrition plans with daily caloric, macronutrient targets (protein, carbs, fat).                                                                          | P3       | Core capability enabling users to define nutritional goals; derived from FR-036 and User Story 1 acceptance scenario 1. | Test                |
| REQ-002 | The system MUST allow users to link meal plans to nutrition plans.                                                                                                                              | P3       | Enables compliance analysis between planned meals and nutritional targets; derived from FR-037.                         | Test                |
| REQ-003 | The system MUST display a compliance analysis comparing planned nutrition against targets, with clear indicators for gaps / excesses, when a user views a nutrition plan linked to a meal plan. | P3       | Provides actionable feedback to users; derived from FR-037 and User Story 1 acceptance scenario 2.                      | Test                |
| REQ-004 | The system MUST save a created nutrition plan, make it visible on the user's dashboard.                                                                                                         | P3       | Ensures persistence and discoverability of plans; derived from User Story 1 acceptance scenario 1.                      | Test                |
| REQ-005 | The system MUST allow users with appropriate permissions (trainer role) to create nutrition plans for other users (trainer-client model). _(Premium)_                                           | P3       | Supports the trainer-client workflow; derived from FR-038 and User Story 1 acceptance scenario 3.                       | Test                |
| REQ-006 | The system MUST allow clients to view nutrition plans created for them by a trainer, use those plans to guide their meal planning. _(Premium)_                                                  | P3       | Completes the trainer-client loop; derived from User Story 1 acceptance scenario 3.                                     | Test                |
| REQ-007 | The system MUST suggest recipe swaps / adjustments to better align a meal plan with its linked nutrition targets when the meal plan does not meet those targets. _(Premium)_                    | P3       | Provides proactive guidance to close nutritional gaps; derived from FR-039 and User Story 1 acceptance scenario 4.      | Demonstration       |
| REQ-008 | The system MUST require explicit client consent before a trainer can create / manage a nutrition plan on behalf of that client.                                                                 | P3       | Enforces privacy and consent; derived from the Assumptions section of spec.md.                                          | Test                |

### Non-Functional Requirements

| ID         | Description                                                                                                                                         | Priority | Rationale                                                                                           | Verification Method |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| REQ-NF-001 | All TypeScript code for this feature MUST compile with `strict: true`; `any` MUST NOT be used outside explicitly marked test doubles.               | P1       | Enforces type safety across the codebase; derived from NFR-001 (Constitution Principle I).          | Inspection          |
| REQ-NF-002 | All exported functions, interfaces introduced by this feature MUST carry JSDoc documentation.                                                       | P1       | Ensures maintainability and developer experience; derived from NFR-002 (Constitution Principle II). | Inspection          |
| REQ-NF-003 | Any UI component introduced by this feature MUST expose an accessible name queryable via `getByRole` / `getByLabel` in Playwright tests.            | P1       | Ensures accessibility compliance; derived from NFR-003 (Constitution Principles IV & VII).          | Test                |
| REQ-NF-004 | Color MUST NOT be the sole conveyor of compliance state (gap/excess indicators); an icon / text label pairing MUST accompany any color-coded state. | P1       | Ensures accessibility for color-blind users; derived from NFR-004 (Constitution Principle VII).     | Inspection          |
| REQ-NF-005 | Nutritional calculations for meal plans linked to nutrition plans MUST be accurate to within 5% of the source food database values.                 | P1       | Ensures data integrity and user trust; derived from SC-010.                                         | Analysis            |

### Interface Requirements

| ID         | Description                                                                                                                                                                      | Priority | Rationale                                                                                                                                               | Verification Method |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| REQ-IF-001 | The system SHALL integrate with the Meal Planning feature (006-meal-planning) to retrieve meal plan data for compliance analysis.                                                | P1       | Nutrition plans depend on meal plan data; derived from the Dependencies section (006-meal-planning: Required).                                          | Test                |
| REQ-IF-002 | The system SHALL integrate with the USDA Food Data feature (003-usda-food-data) to obtain nutritional values used in compliance calculations.                                    | P1       | Nutritional calculations depend on food data; derived from the Dependencies section (003-usda-food-data: Required).                                     | Test                |
| REQ-IF-003 | The system SHALL integrate with the Recipe App feature (001-commise-recipe-app) to obtain recipe nutritional data as the basis for compliance calculations.                      | P1       | Recipe nutritional data underpins compliance; derived from the Dependencies section (001-commise-recipe-app: Required).                                 | Test                |
| REQ-IF-004 | The system SHALL integrate with the Clerk User Auth feature (002-user-auth) to authenticate all users, enforce trainer-client user relationships.                                | P1       | All features require authentication; trainer-client model requires user relationships; derived from the Dependencies section (002-user-auth: Required). | Test                |
| REQ-IF-005 | The system SHALL integrate with the Subscriptions feature (010-subscriptions) to gate trainer nutrition planning, AI recipe swap suggestions behind premium subscription checks. | P2       | Trainer planning and AI swaps are premium features; derived from the Dependencies section (010-subscriptions: Referenced).                              | Test                |

| REQ-IF-006 | The system SHALL provide equivalent web and mobile user-facing workflows for Nutrition Planning, including the same core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths unless an explicit V-Model parity exception is recorded. | P1 | KitchenSink Constitution Principle VIII requires web/mobile lockstep for every user-facing capability. | Test |

### Constraint Requirements

| ID         | Description                                                                                                                                                                                             | Priority | Rationale                                                                                           | Verification Method |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------- | ------------------- |
| REQ-CN-001 | The Nutrition Planning feature MUST NOT be deployed independently of the Meal Planning (006), USDA Food Data (003), Recipe App (001),, User Auth (002) features, as all four are required dependencies. | P1       | Prevents runtime failures due to missing dependent services; derived from the Dependencies section. | Inspection          |
| REQ-CN-002 | Premium capabilities (trainer-client plan creation, AI recipe swaps) MUST be restricted to users with an active premium subscription as defined by the Subscriptions feature (010-subscriptions).       | P1       | Enforces business model constraints; derived from FR-038, FR-039, and the Dependencies section.     | Test                |

## Assumptions

- The trainer-client relationship for nutrition planning requires explicit consent from the client user.
- Nutritional calculations are derived from the USDA Food Data (003) and Recipe App (001) features; this feature does not independently source or store raw nutritional data.
- Premium feature gating is handled by the Subscriptions feature (010); this feature only consumes the subscription status.

## Dependencies

- **006-meal-planning** (Required): Nutrition plans link to meal plans for compliance analysis.
- **003-usda-food-data** (Required): Nutritional calculations depend on food data from this feature.
- **001-commise-recipe-app** (Required): Recipe nutritional data is the basis for compliance calculations.
- **002-user-auth** (Required): All features require authentication; trainer-client model requires user relationships.
- **010-subscriptions** (Referenced): Trainer nutrition planning and AI recipe swaps are premium features gated by subscription status.

## Glossary

| Term                 | Definition                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Nutrition Plan       | A user-defined plan specifying daily or weekly caloric and macronutrient targets (protein, carbs, fat). Can be linked to one or more meal plans.             |
| Macronutrient        | A primary nutritional category: protein, carbohydrates, or fat.                                                                                              |
| Compliance Analysis  | A comparison of the nutritional content of a linked meal plan against the targets defined in a nutrition plan, highlighting gaps or excesses.                |
| Trainer-Client Model | A relationship where a user with trainer permissions creates and manages nutrition plans on behalf of another user (the client), with client consent.        |
| Recipe Swap          | A system-suggested substitution of one recipe for another within a meal plan to better align the plan's nutritional profile with the nutrition plan targets. |
| Premium Feature      | A capability restricted to users with an active premium subscription as managed by the Subscriptions feature (010-subscriptions).                            |

---

**Total Requirements**: 20
**By Priority**: P1: 10 | P2: 1 | P3: 9
**By Verification Method**: Test: 13 | Inspection: 4 | Analysis: 1 | Demonstration: 1 | Review: 0
