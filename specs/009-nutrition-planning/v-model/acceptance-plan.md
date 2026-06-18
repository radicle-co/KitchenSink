# V-Model Acceptance Test Plan: Nutrition Planning

**Feature Branch**: `009-nutrition-planning`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/009-nutrition-planning/v-model/requirements.md`

## Overview

The Nutrition Planning feature enables users to create nutrition plans with caloric and macronutrient targets, link meal plans for compliance analysis, and supports trainer-client relationships with AI-powered recipe swap suggestions for premium users. The acceptance test plan defines three-tier criteria and verification methods per requirements.

## Acceptance Criteria

### P1 — Mandatory

| ID     | Criterion                                                                                                           | Scenario                              | Pass Condition                                                                           |
| ------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| AC-001 | Nutrition plan can be created with daily caloric and macronutrient targets (protein, carbs, fat)                    | Create nutrition plan with targets    | Plan saved; targets appear in plan detail view with correct numeric values               |
| AC-002 | Meal plan can be linked to a nutrition plan                                                                         | Link meal plan to nutrition plan      | Link association saved; compliance view shows both plan data                             |
| AC-003 | Compliance analysis displays gap/excess indicators when viewing a nutrition plan linked to a meal plan              | View linked compliance                | Indicators shown for each macronutrient; gap or excess labeled with icon AND text        |
| AC-004 | Created nutrition plan appears on user dashboard                                                                    | View dashboard after creating plan    | Plan card visible on dashboard with correct name and target summary                      |
| AC-005 | Color is not the sole conveyor of compliance state; icon or text label accompanies color-coded indicators           | Inspect compliance indicators         | Every color-coded state (gap/excess/meet) has an accompanying icon or text label         |
| AC-006 | Nutritional calculations are accurate within 5% of source food database values                                      | Compare calculated totals vs source   | Calculated totals for linked meal plan differ from USDA source values by < 5%            |
| AC-007 | Meal Planning integration retrieves and displays correct meal plan data in nutrition compliance view                | View nutrition compliance             | Meal plan data (meals, recipes, portions) matches actual meal plan entries               |
| AC-008 | USDA Food Data integration provides nutritional values used in compliance calculations                              | Verify calculation source             | Compliance calculations use USDA-sourced values; values match food database entries      |
| AC-009 | Recipe nutritional data from Recipe App is used as basis for compliance calculations                                | Verify recipe data usage              | Per-recipe nutritional totals in compliance match the recipe's stored nutritional data   |
| AC-010 | Clerk authentication is required to access nutrition planning feature                                               | Attempt without auth                  | Unauthenticated request returns 401; nutrition features inaccessible                     |
| AC-011 | Trainer-client model enforces subscription check; only premium trainers can create plans for clients                | Premium trainer creates for client    | Plan created and visible to client; free-tier trainer sees upgrade prompt                |
| AC-012 | Client can view nutrition plans created for them by a trainer                                                       | Client views trainer plan             | Trainer-created plans appear in client's nutrition plan list                             |
| AC-013 | Explicit client consent is required before a trainer can create or manage a nutrition plan on behalf of that client | Trainer attempts to create for client | Consent prompt appears; without consent, plan creation is rejected with message          |
| AC-014 | Recipe swap suggestions appear when linked meal plan does not meet nutrition targets                                | Meal plan under/over targets          | Swap suggestions displayed with rationale; suggestions align with closing the gap/excess |
| AC-015 | Trainer nutrition planning is behind premium subscription check                                                     | Access as free user                   | Upgrade prompt appears; feature not accessible without active premium subscription       |
| AC-016 | AI recipe swap suggestions are behind premium subscription check                                                    | Access as free user                   | Upgrade prompt appears; feature not accessible without active premium subscription       |
| AC-017 | TypeScript compiles with `strict: true`; no `any` used outside explicitly marked test doubles                       | Run `npx tsc --strict`                | Compilation succeeds with exit code 0; zero type errors                                  |
| AC-018 | All exported functions and interfaces have JSDoc documentation                                                      | Inspect source files                  | Every exported function and interface has a JSDoc comment block                          |
| AC-019 | UI components expose an accessible name queryable via `getByRole` or `getByLabel` in Playwright                     | Run accessibility audit               | All interactive components have accessible name; `getByRole` queries succeed             |
| AC-020 | Feature does not deploy independently of required dependencies (Meal Planning, USDA Food Data, Recipe App, Clerk)   | Attempt isolated deployment           | Deployment blocked with error message listing required co-deployed features              |

### P2 — Recommended

| ID     | Criterion                                                                            | Scenario                       | Pass Condition                                                             |
| ------ | ------------------------------------------------------------------------------------ | ------------------------------ | -------------------------------------------------------------------------- |
| AC-021 | Trainer nutrition planning and AI swap suggestions are gated by premium subscription | Premium-gated feature access   | Feature accessible with active premium; upgrade prompt shown to free users |
| AC-022 | Integration with Subscriptions feature correctly gates premium features              | Check subscription enforcement | Premium features inaccessible to free users; accessible to premium users   |

### P3 — Optional

| ID     | Criterion                                                 | Scenario           | Pass Condition                                                            |
| ------ | --------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------- |
| AC-023 | Nutrition plan targets can be updated after creation      | Edit plan targets  | Updated targets saved and reflected in compliance analysis                |
| AC-024 | Nutrition plan can be deleted, removing it from dashboard | Delete plan        | Plan removed from dashboard; compliance view no longer shows the plan     |
| AC-025 | Multiple nutrition plans can exist for a single user      | Create second plan | Both plans visible on dashboard; each has independent compliance analysis |

---

### AT-PARITY — Cross-platform parity for Nutrition Planning

**Requirement**: REQ-IF-006

| ATS ID       | Scenario                     | Given                                                                      | When                                                                          | Then                                                                                                                                                                               |
| ------------ | ---------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATS-PARITY-1 | Web/mobile capability parity | A user-facing Nutrition Planning workflow is implemented on web and mobile | Product QA compares the web and mobile flows against the same requirement set | Both platforms expose the same core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths, or a documented V-Model parity exception exists |
| ATS-PARITY-2 | Parity regression gate       | A change modifies a Nutrition Planning user-facing workflow                | The feature test plan is reviewed                                             | The change includes paired web and mobile acceptance coverage or a documented exception approved by product governance                                                             |
