# Acceptance Test Plan: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/007-grocery-lists/v-model/requirements.md`

---

## Overview

This document defines the Acceptance Test Plan for the Grocery Lists & Online Ordering feature. Acceptance tests verify that the system satisfies user-facing requirements from the perspective of an end user or product stakeholder. They are written in BDD format (Given/When/Then) and map directly to REQ-\* identifiers from `requirements.md`.

Acceptance tests sit at the top of the V-Model verification chain. They complement system tests (which verify architectural behavior) and unit tests (which verify module logic) by confirming that the assembled system delivers the outcomes users actually care about.

**Scope**: All P1 and P2 functional, non-functional, interface, and constraint requirements from `requirements.md`.

**Out of scope**: Internal component wiring, database schema correctness, and infrastructure provisioning. Those are covered by system and unit tests.

---

## ID Schema

| Identifier               | Pattern      | Meaning                                                                                         |
| ------------------------ | ------------ | ----------------------------------------------------------------------------------------------- |
| Acceptance Test Case     | `AT-NNN-X`   | NNN matches the parent REQ number; X is a letter suffix (A, B, C...) for multiple cases per REQ |
| Acceptance Test Scenario | `ATS-NNN-X#` | Nested under the parent AT; numeric suffix (1, 2, 3...) for multiple scenarios per case         |

**Examples**:

- `AT-001-A` — first acceptance test case for REQ-001
- `ATS-001-A1` — first scenario within AT-001-A
- `AT-NF-003-A` — acceptance test case for REQ-NF-003
- `ATS-CN-001-A2` — second scenario within the first acceptance test case for REQ-CN-001

---

## Acceptance Test Cases (Tier 1–3 Structure)

The three tiers map to: **Feature/Epic → User Story / REQ → BDD Scenario**.

---

### Tier 1 — Feature: Grocery List Generation

---

#### Tier 2 — User Story: As a user, I want a consolidated grocery list generated from my meal plan

---

##### AT-001-A: Consolidated list is generated from a 7-day meal plan

**Requirement**: REQ-001
**Technique**: Equivalence Partitioning
**Priority**: P1

- **ATS-001-A1**
    - **Given** I am authenticated and have a 7-day meal plan with 14 recipes containing distinct ingredients
    - **When** I tap "Generate Grocery List" for that meal plan
    - **Then** a single grocery list is created containing all ingredients from all 14 recipes, and no recipe-level sub-lists are shown

- **ATS-001-A2**
    - **Given** I am authenticated and have a meal plan with only 1 recipe
    - **When** I generate a grocery list
    - **Then** the list contains exactly the ingredients from that recipe with no duplication or omission

---

##### AT-002-A: Duplicate ingredients are merged into a single line item

**Requirement**: REQ-002
**Technique**: Equivalence Partitioning
**Priority**: P1

- **ATS-002-A1**
    - **Given** my meal plan contains two recipes that both require "chicken breast" (one calls for 200 g, the other for 300 g)
    - **When** I generate a grocery list
    - **Then** "chicken breast" appears exactly once on the list with a quantity of 500 g

- **ATS-002-A2**
    - **Given** my meal plan contains ingredients measured in different but compatible units (e.g., "2 cups milk" and "500 ml milk")
    - **When** I generate a grocery list
    - **Then** "milk" appears once with quantities normalized and summed to a canonical unit

---

##### AT-003-A: Grocery list generation completes within 5 seconds for a 7-day plan

**Requirement**: REQ-003
**Technique**: Boundary Value Analysis
**Priority**: P1

- **ATS-003-A1**
    - **Given** I have a 7-day meal plan with the maximum expected number of recipes and ingredients
    - **When** I trigger grocery list generation
    - **Then** the list is fully rendered and interactive within 5 seconds of my action

- **ATS-003-A2**
    - **Given** I have a 7-day meal plan with a single recipe
    - **When** I trigger grocery list generation
    - **Then** the list appears well within the 5-second threshold

---

##### AT-009-A: Empty meal plan surfaces guidance rather than a blank list

**Requirement**: REQ-009
**Technique**: Equivalence Partitioning
**Priority**: P2

- **ATS-009-A1**
    - **Given** I have a meal plan with no recipes added
    - **When** I attempt to generate a grocery list
    - **Then** I see a clear message explaining that the meal plan is empty and prompting me to add recipes before generating a list

---

### Tier 1 — Feature: Grocery List Item Management

---

#### Tier 2 — User Story: As a user, I want to mark items I already own so they're excluded from my shopping

---

##### AT-004-A: User can mark an item as "already have"

**Requirement**: REQ-004
**Technique**: Equivalence Partitioning
**Priority**: P1

- **ATS-004-A1**
    - **Given** I have a generated grocery list with multiple items
    - **When** I tap the "already have" toggle on "olive oil"
    - **Then** "olive oil" is visually marked as owned (e.g., checked, greyed out, or labelled) and the change persists if I leave and return to the list

- **ATS-004-A2**
    - **Given** I have previously marked "olive oil" as "already have"
    - **When** I tap the toggle again to unmark it
    - **Then** "olive oil" returns to the active shopping list and is included in any subsequent order

---

##### AT-005-A: Items marked "already have" are excluded from the shopping view and online orders

**Requirement**: REQ-005
**Technique**: Equivalence Partitioning
**Priority**: P1

- **ATS-005-A1**
    - **Given** I have marked "olive oil" as "already have" on my grocery list
    - **When** I view the active shopping list
    - **Then** "olive oil" does not appear in the shopping list view

- **ATS-005-A2**
    - **Given** I have marked several items as "already have" and I am a premium subscriber with a configured grocery store
    - **When** I submit an online order
    - **Then** none of the "already have" items appear in the order sent to the grocery store API

---

### Tier 1 — Feature: Online Ordering

---

#### Tier 2 — User Story: As a premium user, I want to order my grocery list online from a connected store

---

##### AT-006-A: User can configure a grocery store integration

**Requirement**: REQ-006
**Technique**: Equivalence Partitioning
**Priority**: P2

- **ATS-006-A1**
    - **Given** I am a premium subscriber and have not yet connected a grocery store
    - **When** I navigate to the grocery store settings
    - **Then** I can select from available stores for my location and complete the connection flow

- **ATS-006-A2**
    - **Given** I have already connected a grocery store
    - **When** I return to grocery store settings
    - **Then** I can see my connected store and have the option to disconnect or switch to a different store

---

##### AT-007-A: User without a configured store is guided through setup when attempting to order

**Requirement**: REQ-007
**Technique**: Equivalence Partitioning
**Priority**: P2

- **ATS-007-A1**
    - **Given** I am a premium subscriber with no grocery store configured
    - **When** I tap "Order Online" from my grocery list
    - **Then** I am guided to the store setup flow with a clear explanation of why setup is needed, and I can complete setup without losing my grocery list

---

##### AT-008-A: Grocery list ingredients are mapped to store products and an order is created

**Requirement**: REQ-008
**Technique**: Equivalence Partitioning
**Priority**: P2

- **ATS-008-A1**
    - **Given** I am a premium subscriber with a configured grocery store and an active grocery list
    - **When** I tap "Order Online" and confirm the order
    - **Then** each active (non-"already have") ingredient is matched to a store product, and an order is submitted to the grocery store API

- **ATS-008-A2**
    - **Given** one ingredient on my list has no matching store product
    - **When** I review the order before submitting
    - **Then** I am shown which items could not be matched and can choose to proceed without them or cancel

---

##### AT-010-A: Grocery store API outage is handled gracefully

**Requirement**: REQ-010
**Technique**: Fault Injection
**Priority**: P2

- **ATS-010-A1**
    - **Given** the grocery store API is unavailable when I attempt to submit an order
    - **When** I tap "Order Online" and confirm
    - **Then** I see a user-facing error message explaining the outage, my grocery list is unchanged, and no partial order is submitted

---

##### AT-011-A: Full meal-plan-to-grocery-list workflow completes in under 10 minutes

**Requirement**: REQ-011
**Technique**: Equivalence Partitioning
**Priority**: P2

- **ATS-011-A1**
    - **Given** I start from a completed 7-day meal plan
    - **When** I generate a grocery list, review it, mark owned items, and optionally initiate an online order
    - **Then** the entire workflow from list generation to order confirmation takes under 10 minutes

---

### Tier 1 — Feature: Non-Functional Acceptance

---

#### Tier 2 — User Story: As a user, I expect the grocery list UI to be accessible and type-safe

---

##### AT-NF-003-A: All UI components expose accessible names queryable by role or label

**Requirement**: REQ-NF-003
**Technique**: Equivalence Partitioning
**Priority**: P1

- **ATS-NF-003-A1**
    - **Given** I am using a screen reader or Playwright's accessibility queries
    - **When** I navigate the grocery list screen
    - **Then** every interactive element (buttons, toggles, list items) is reachable via `getByRole` or `getByLabel` without relying on test IDs or CSS selectors

---

##### AT-NF-004-A: Color is never the sole conveyor of state in grocery list UI

**Requirement**: REQ-NF-004
**Technique**: Equivalence Partitioning
**Priority**: P1

- **ATS-NF-004-A1**
    - **Given** I view a grocery list with items in different states (active, "already have", unavailable)
    - **When** I inspect each state indicator
    - **Then** every state is communicated by an icon or text label in addition to any color change, so the state is distinguishable without color perception

---

### Tier 1 — Feature: Interface & Authentication

---

#### Tier 2 — User Story: As the system, I must enforce authentication and subscription gates on all grocery endpoints

---

##### AT-IF-005-A: Unauthenticated requests to grocery endpoints are rejected

**Requirement**: REQ-IF-005
**Technique**: Equivalence Partitioning
**Priority**: P1

- **ATS-IF-005-A1**
    - **Given** I am not logged in (no valid Clerk session)
    - **When** I attempt to access the grocery list screen or call any grocery API endpoint directly
    - **Then** I am redirected to the login screen (web) or shown an authentication prompt (mobile), and no grocery data is returned

---

##### AT-IF-006-A: Online ordering is blocked for free-tier users

**Requirement**: REQ-IF-006
**Technique**: Equivalence Partitioning
**Priority**: P2

- **ATS-IF-006-A1**
    - **Given** I am authenticated as a free-tier user
    - **When** I attempt to access the "Order Online" feature
    - **Then** I see a paywall or upgrade prompt and the order is not submitted

---

### Tier 1 — Feature: Constraint Enforcement

---

#### Tier 2 — User Story: As the system, I must enforce security and scope constraints

---

##### AT-CN-001-A: All grocery API routes require a valid Clerk session token

**Requirement**: REQ-CN-001
**Technique**: Fault Injection
**Priority**: P1

- **ATS-CN-001-A1**
    - **Given** a request is made to any grocery list or ordering API route with an expired or missing JWT
    - **When** the server processes the request
    - **Then** the server returns HTTP 401 and no grocery data is exposed

- **ATS-CN-001-A2**
    - **Given** a request is made with a structurally valid but tampered JWT
    - **When** the server validates the token
    - **Then** the server returns HTTP 401 and logs the failed validation attempt

---

##### AT-CN-002-A: Online ordering is gated behind the premium subscription tier

**Requirement**: REQ-CN-002
**Technique**: Equivalence Partitioning
**Priority**: P2

- **ATS-CN-002-A1**
    - **Given** I am authenticated as a free-tier user with a valid JWT
    - **When** I call the online ordering API endpoint directly
    - **Then** the server returns HTTP 403 with a message indicating the feature requires a premium subscription

---

## Acceptance Criteria per REQ

| REQ        | Pre-condition                                                                 | Success Condition                                                                  | Technique                | AT Reference |
| ---------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------ | ------------ |
| REQ-001    | Authenticated user with a 7-day meal plan containing at least one recipe      | Single consolidated grocery list returned with all ingredients from all recipes    | Equivalence Partitioning | AT-001-A     |
| REQ-002    | Meal plan contains two or more recipes sharing at least one ingredient        | Shared ingredient appears exactly once with quantities summed and units normalized | Equivalence Partitioning | AT-002-A     |
| REQ-003    | Authenticated user with a 7-day meal plan at maximum expected scale           | Grocery list fully rendered within 5 seconds of triggering generation              | Boundary Value Analysis  | AT-003-A     |
| REQ-004    | Generated grocery list with at least one active item                          | Item can be toggled to "already have" and the state persists across sessions       | Equivalence Partitioning | AT-004-A     |
| REQ-005    | Grocery list with at least one item marked "already have"                     | Marked items absent from shopping view and excluded from any online order payload  | Equivalence Partitioning | AT-005-A     |
| REQ-006    | Premium subscriber with no grocery store configured                           | User can select, connect, and later manage a grocery store integration             | Equivalence Partitioning | AT-006-A     |
| REQ-007    | Premium subscriber with no grocery store configured, tapping "Order Online"   | User is guided to store setup without losing grocery list state                    | Equivalence Partitioning | AT-007-A     |
| REQ-008    | Premium subscriber with configured store and active grocery list              | All active ingredients mapped to store products and order submitted successfully   | Equivalence Partitioning | AT-008-A     |
| REQ-009    | Authenticated user with a meal plan containing zero recipes                   | Clear guidance message shown; no empty list rendered                               | Equivalence Partitioning | AT-009-A     |
| REQ-010    | Premium subscriber attempting to order while grocery store API is unavailable | User-facing error shown; grocery list state preserved; no partial order submitted  | Fault Injection          | AT-010-A     |
| REQ-011    | Authenticated user starting from a completed 7-day meal plan                  | Full workflow (generate, review, mark, order) completed in under 10 minutes        | Equivalence Partitioning | AT-011-A     |
| REQ-NF-003 | Grocery list UI rendered in browser or mobile app                             | All interactive elements reachable via `getByRole` or `getByLabel`                 | Equivalence Partitioning | AT-NF-003-A  |
| REQ-NF-004 | Grocery list UI with items in multiple states                                 | Every state indicator uses icon or text label alongside any color change           | Equivalence Partitioning | AT-NF-004-A  |
| REQ-IF-005 | Unauthenticated request to any grocery endpoint                               | HTTP 401 returned; no grocery data exposed                                         | Equivalence Partitioning | AT-IF-005-A  |
| REQ-IF-006 | Free-tier authenticated user accessing online ordering                        | HTTP 403 or paywall shown; order not submitted                                     | Equivalence Partitioning | AT-IF-006-A  |
| REQ-CN-001 | Request with expired, missing, or tampered JWT to any grocery route           | HTTP 401 returned; no data exposed; failed validation logged                       | Fault Injection          | AT-CN-001-A  |
| REQ-CN-002 | Free-tier authenticated user calling online ordering API directly             | HTTP 403 returned with premium-required message                                    | Equivalence Partitioning | AT-CN-002-A  |

**Inspection-only requirements** (verified by code review, not acceptance tests):

| REQ        | Verification Method | Notes                                                                      |
| ---------- | ------------------- | -------------------------------------------------------------------------- |
| REQ-NF-001 | Inspection          | TypeScript `strict: true` enforced; no `any` outside test doubles          |
| REQ-NF-002 | Inspection          | All exported functions and interfaces carry JSDoc                          |
| REQ-CN-003 | Inspection          | Ingredient data sourced exclusively from meal plan and recipe entities     |
| REQ-IF-002 | Inspection          | Ingredient data consumed from Recipe entities per `001-commise-recipe-app` |

---

## Feature Test Summary Matrix

| REQ        | Description (short)                           | BDD Scenario Count | Test Method                              | Pass Criteria                                        |
| ---------- | --------------------------------------------- | ------------------ | ---------------------------------------- | ---------------------------------------------------- |
| REQ-001    | Consolidated list from meal plan              | 2                  | Automated E2E (Playwright)               | All scenarios pass; list contains all ingredients    |
| REQ-002    | Ingredient deduplication and quantity summing | 2                  | Automated E2E (Playwright)               | Duplicate ingredients merged; quantities correct     |
| REQ-003    | Generation within 5 seconds                   | 2                  | Automated E2E with timing assertion      | p95 generation time ≤ 5 s across both scenarios      |
| REQ-004    | Mark items as "already have"                  | 2                  | Automated E2E (Playwright)               | Toggle persists; state survives navigation           |
| REQ-005    | Exclude "already have" from view and orders   | 2                  | Automated E2E (Playwright)               | Marked items absent from list view and order payload |
| REQ-006    | Configure grocery store integration           | 2                  | Manual demonstration + automated smoke   | Store connected and manageable                       |
| REQ-007    | Guide user through store setup on first order | 1                  | Manual demonstration                     | Setup flow reachable; list state preserved           |
| REQ-008    | Map ingredients to products and submit order  | 2                  | Automated E2E (Playwright) + manual      | Order submitted; unmatched items surfaced            |
| REQ-009    | Empty meal plan guidance                      | 1                  | Automated E2E (Playwright)               | Guidance message shown; no blank list                |
| REQ-010    | Graceful handling of store API outage         | 1                  | Automated E2E with fault injection       | Error shown; list unchanged; no partial order        |
| REQ-011    | Full workflow under 10 minutes                | 1                  | Manual timed walkthrough                 | Workflow completes within 10 minutes                 |
| REQ-NF-003 | Accessible UI component names                 | 1                  | Automated Playwright accessibility query | All elements reachable by role or label              |
| REQ-NF-004 | Color not sole state conveyor                 | 1                  | Manual inspection + automated snapshot   | Every state has icon or text label                   |
| REQ-IF-005 | Auth enforcement on all endpoints             | 1                  | Automated API test                       | HTTP 401 for unauthenticated requests                |
| REQ-IF-006 | Online ordering blocked for free tier         | 1                  | Automated API test                       | HTTP 403 or paywall for free-tier users              |
| REQ-CN-001 | JWT validation on all grocery routes          | 2                  | Automated API test                       | HTTP 401 for invalid/missing/tampered JWT            |
| REQ-CN-002 | Premium gate on ordering API                  | 1                  | Automated API test                       | HTTP 403 for free-tier direct API call               |

**Total BDD scenarios**: 27
**Automated**: 23 (Playwright E2E + API tests)
**Manual / demonstration**: 4 (REQ-006, REQ-007, REQ-011, REQ-NF-004 partial)

---

## Exit Criteria

All of the following conditions must be met before the feature is considered accepted:

### Mandatory (P1 requirements)

1. **All P1 acceptance test scenarios pass** — ATS-001-A1, ATS-001-A2, ATS-002-A1, ATS-002-A2, ATS-003-A1, ATS-003-A2, ATS-004-A1, ATS-004-A2, ATS-005-A1, ATS-005-A2, ATS-009-A1, ATS-NF-003-A1, ATS-NF-004-A1, ATS-IF-005-A1, ATS-CN-001-A1, ATS-CN-001-A2 must all pass with no failures.

2. **Performance threshold met** — Grocery list generation for a 7-day plan completes within 5 seconds at p95 across at least 10 consecutive test runs.

3. **Authentication gate verified** — HTTP 401 is returned for every unauthenticated or invalid-JWT request to every grocery endpoint; no data leaks.

4. **Accessibility verified** — All interactive grocery list UI elements are reachable via `getByRole` or `getByLabel` in Playwright; no element requires a test ID or CSS selector fallback.

5. **Inspection sign-off** — A reviewer has confirmed that REQ-NF-001 (strict TypeScript), REQ-NF-002 (JSDoc), REQ-CN-003 (no manual ingredient entry), and REQ-IF-002 (Recipe entity sourcing) are satisfied in the merged code.

### Conditional (P2 requirements)

6. **P2 automated scenarios pass** — ATS-008-A1, ATS-008-A2, ATS-009-A1, ATS-010-A1, ATS-IF-006-A1, ATS-CN-002-A1 must pass before the online ordering sub-feature ships.

7. **Manual demonstrations accepted** — A product stakeholder has signed off on REQ-006 (store configuration), REQ-007 (setup guidance flow), and REQ-011 (10-minute workflow) via a recorded or live demonstration session.

### Blocking conditions

The feature MUST NOT be merged to `main` if any of the following are true:

- Any P1 acceptance scenario is failing or skipped.
- The authentication gate (REQ-CN-001 / REQ-IF-005) has any known bypass.
- The performance threshold (REQ-003) is not met in CI.
- The TypeScript strict-mode inspection (REQ-NF-001) has open violations.

---

### AT-PARITY — Cross-platform parity for Grocery Lists & Online Ordering

**Requirement**: REQ-IF-007

| ATS ID       | Scenario                     | Given                                                                                   | When                                                                          | Then                                                                                                                                                                               |
| ------------ | ---------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATS-PARITY-1 | Web/mobile capability parity | A user-facing Grocery Lists & Online Ordering workflow is implemented on web and mobile | Product QA compares the web and mobile flows against the same requirement set | Both platforms expose the same core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths, or a documented V-Model parity exception exists |
| ATS-PARITY-2 | Parity regression gate       | A change modifies a Grocery Lists & Online Ordering user-facing workflow                | The feature test plan is reviewed                                             | The change includes paired web and mobile acceptance coverage or a documented exception approved by product governance                                                             |
