# System Design: Grocery Lists & Online Ordering

**Feature Branch**: `007-grocery-lists`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/007-grocery-lists/v-model/requirements.md`

## Overview

The Grocery Lists & Online Ordering system is decomposed into six system components spanning ingredient aggregation, list state management, store integration, authentication enforcement, subscription gating, and external dependency adapters. The decomposition follows a layered approach: domain logic (aggregation, deduplication) is isolated from infrastructure concerns (store APIs, auth, subscriptions) to enable independent testing and future provider substitution.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                         | Description                                                                                                                                                                                                                                                                                                     | Parent Requirements                                                                | Type      |
| ------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------- |
| SYS-001 | Grocery List Generator       | Consumes meal plan data and recipe ingredient lists to produce a consolidated, deduplicated grocery list. Aggregates quantities across recipes, normalises units via USDA Food Data, and returns a structured list of canonical ingredient items.                                                               | REQ-001, REQ-002, REQ-003, REQ-009, REQ-IF-002, REQ-IF-003, REQ-IF-004             | Subsystem |
| SYS-002 | List State Manager           | Persists grocery list state per user, tracks "already have" item flags, and enforces exclusion of flagged items from shopping view and order submission. Provides CRUD operations on list items.                                                                                                                | REQ-004, REQ-005, REQ-011                                                          | Module    |
| SYS-003 | Online Ordering Orchestrator | Maps grocery list items to store product SKUs, constructs and submits orders to the configured grocery store API, and handles API outage scenarios with graceful degradation and state preservation.                                                                                                            | REQ-008, REQ-010, REQ-IF-001                                                       | Subsystem |
| SYS-004 | Store Configuration Manager  | Allows users to configure, connect, and manage grocery store integrations. Guides unconfigured users through store setup when they attempt online ordering without a configured store.                                                                                                                          | REQ-006, REQ-007                                                                   | Module    |
| SYS-005 | Auth & Subscription Enforcer | Verifies the Clerk session token networklessly (`CLERK_JWT_KEY` + `azp`) on all grocery list and ordering endpoints. Enforces the premium subscription gate (from the token's `public_metadata` claim) for online ordering. Rejects unauthenticated and unauthorised requests before any domain logic executes. | REQ-CN-001, REQ-CN-002, REQ-IF-005, REQ-IF-006                                     | Service   |
| SYS-006 | External Dependency Adapters | Provides typed adapter interfaces for upstream systems: MealPlan API (006), Recipe API (001), USDA Food Data (003), Clerk (002), Subscriptions (010), and Grocery Store APIs. Isolates domain logic from third-party contracts.                                                                                 | REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004, REQ-IF-005, REQ-IF-006, REQ-CN-003 | Library   |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                                                   |
| ------- | ------- | ------------ | ------------------------------------------------------------------------------------------------ |
| SYS-001 | SYS-006 | Calls        | Generator cannot fetch meal plan or recipe data; list generation fails with upstream error.      |
| SYS-001 | SYS-005 | Calls        | Generator cannot validate caller identity; request rejected before processing.                   |
| SYS-002 | SYS-005 | Calls        | State manager cannot validate caller; CRUD operations rejected.                                  |
| SYS-003 | SYS-002 | Reads        | Orchestrator cannot read list items or "already have" flags; order may include excluded items.   |
| SYS-003 | SYS-004 | Reads        | Orchestrator cannot determine configured store; ordering fails with configuration error.         |
| SYS-003 | SYS-005 | Calls        | Orchestrator cannot validate subscription tier; premium gate cannot be enforced.                 |
| SYS-003 | SYS-006 | Calls        | Orchestrator cannot reach grocery store API adapter; order submission fails gracefully.          |
| SYS-004 | SYS-005 | Calls        | Store config manager cannot validate caller; configuration changes rejected.                     |
| SYS-006 | SYS-001 | Subscribes   | Adapters provide data to generator; upstream outage propagates as structured error to generator. |

### Dependency Diagram

```text
                    ┌─────────────────────────────────────────────────────┐
                    │              SYS-005: Auth & Subscription Enforcer   │
                    └──────────────────────┬──────────────────────────────┘
                                           │ validates (all inbound)
              ┌────────────────────────────┼────────────────────────────┐
              ▼                            ▼                            ▼
┌─────────────────────┐    ┌──────────────────────────┐   ┌────────────────────────┐
│ SYS-001: Generator  │    │ SYS-002: State Manager   │   │ SYS-004: Store Config  │
│                     │    │                          │   │       Manager          │
└──────────┬──────────┘    └────────────┬─────────────┘   └────────────┬───────────┘
           │ calls                      │ reads                         │ reads
           ▼                            ▼                               │
┌─────────────────────────────────────────────────────────────────────┐│
│                    SYS-006: External Dependency Adapters             ││
│  (MealPlan, Recipe, USDA, Clerk, Subscriptions, Grocery Store APIs) │◄┘
└─────────────────────────────────────────────────────────────────────┘
                                           ▲
                    ┌──────────────────────┘
                    │ calls
        ┌───────────────────────────┐
        │ SYS-003: Online Ordering  │
        │      Orchestrator         │
        └───────────────────────────┘
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Interface ID | Name                                   | Direction         | Protocol                                                  | Format | Consumers           |
| ------------ | -------------------------------------- | ----------------- | --------------------------------------------------------- | ------ | ------------------- |
| IF-EXT-001   | Grocery List REST API                  | Inbound           | HTTPS/REST                                                | JSON   | Web, Mobile         |
| IF-EXT-002   | Online Ordering REST API               | Inbound           | HTTPS/REST                                                | JSON   | Web, Mobile         |
| IF-EXT-003   | Store Config REST API                  | Inbound           | HTTPS/REST                                                | JSON   | Web, Mobile         |
| IF-EXT-004   | Grocery Store Provider APIs            | Outbound          | HTTPS/REST                                                | JSON   | SYS-003 via SYS-006 |
| IF-EXT-005   | MealPlan API (006)                     | Outbound          | HTTPS/REST                                                | JSON   | SYS-001 via SYS-006 |
| IF-EXT-006   | Recipe API (001)                       | Outbound          | HTTPS/REST                                                | JSON   | SYS-001 via SYS-006 |
| IF-EXT-007   | USDA Food Data API (003)               | Outbound          | HTTPS/REST                                                | JSON   | SYS-001 via SYS-006 |
| IF-EXT-008   | Clerk session-token verification (002) | Local/networkless | None (in-process; `CLERK_JWT_KEY` + `azp`, no round trip) | JWT    | SYS-005             |
| IF-EXT-009   | Subscriptions API (010)                | Outbound          | HTTPS/REST                                                | JSON   | SYS-005 via SYS-006 |

### Internal Interfaces

| Interface ID | Name                             | Source  | Target  | Protocol | Format |
| ------------ | -------------------------------- | ------- | ------- | -------- | ------ |
| IF-INT-001   | GenerateList(mealPlanId, userId) | SYS-001 | SYS-006 | In-proc  | TS     |
| IF-INT-002   | GetListItems(listId, userId)     | SYS-002 | SYS-003 | In-proc  | TS     |
| IF-INT-003   | MarkAlreadyHave(itemId, userId)  | SYS-002 | SYS-005 | In-proc  | TS     |
| IF-INT-004   | SubmitOrder(listId, storeId)     | SYS-003 | SYS-006 | In-proc  | TS     |
| IF-INT-005   | GetStoreConfig(userId)           | SYS-004 | SYS-005 | In-proc  | TS     |
| IF-INT-006   | ValidateJWT(token)               | SYS-005 | SYS-006 | In-proc  | TS     |
| IF-INT-007   | CheckSubscription(userId, tier)  | SYS-005 | SYS-006 | In-proc  | TS     |

## Data View (IEEE 1016 §5.4)

### Key Entities

| Entity            | Owner   | Description                                                                                |
| ----------------- | ------- | ------------------------------------------------------------------------------------------ |
| GroceryList       | SYS-002 | Aggregate root: id, userId, mealPlanId, createdAt, status                                  |
| GroceryListItem   | SYS-002 | id, listId, ingredientId, canonicalName, quantity, unit, alreadyHave: boolean              |
| StoreConfig       | SYS-004 | id, userId, provider (enum), credentials (encrypted), region, active: boolean              |
| OrderSubmission   | SYS-003 | id, listId, storeConfigId, status (pending/submitted/failed), providerOrderId, submittedAt |
| IngredientMapping | SYS-003 | ingredientId, storeConfigId, providerSku, lastVerifiedAt                                   |

### Data Flow Summary

```text
MealPlan (006) ──► SYS-001 ──► SYS-002 (persist GroceryList)
Recipe (001)   ──►    │
USDA (003)     ──►    │ (unit normalisation)
                      │
                      ▼
              GroceryListItem[] (with alreadyHave flags via SYS-002)
                      │
                      ▼
              SYS-003 (filter excluded items) ──► Grocery Store API (via SYS-006)
                      │
                      ▼
              OrderSubmission (persisted by SYS-003)
```

## Component Traceability Detail

### Component: SYS-001 (Grocery List Generator)

**Parent Requirements**: REQ-001, REQ-002, REQ-003, REQ-009, REQ-IF-002, REQ-IF-003, REQ-IF-004

**Traceability Rationale**: SYS-001 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-002 (List State Manager)

**Parent Requirements**: REQ-004, REQ-005, REQ-011

**Traceability Rationale**: SYS-002 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-003 (Online Ordering Orchestrator)

**Parent Requirements**: REQ-008, REQ-010, REQ-IF-001

**Traceability Rationale**: SYS-003 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-004 (Store Configuration Manager)

**Parent Requirements**: REQ-006, REQ-007

**Traceability Rationale**: SYS-004 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-005 (Auth & Subscription Enforcer)

**Parent Requirements**: REQ-CN-001, REQ-CN-002, REQ-IF-005, REQ-IF-006

**Traceability Rationale**: SYS-005 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.

### Component: SYS-006 (External Dependency Adapters)

**Parent Requirements**: REQ-IF-001, REQ-IF-002, REQ-IF-003, REQ-IF-004, REQ-IF-005, REQ-IF-006, REQ-CN-003

**Traceability Rationale**: SYS-006 implements the listed parent requirements through the behavior defined in the Decomposition, Dependency, Interface, and Data Design views.
