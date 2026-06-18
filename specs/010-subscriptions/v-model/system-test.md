# System Test Plan: Subscriptions & Monetization

**Feature Branch**: `010-subscriptions`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/010-subscriptions/v-model/system-design.md`

## Overview

This document defines the System Test Plan for the Subscriptions & Monetization feature. Every system component in `system-design.md` has one or more Test Cases (STP), and every Test Case has one or more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **architectural behavior**, not user journeys. Language is technical and component-oriented.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001

## ISO 29119 Test Techniques

Each test case identifies its technique by name:

- **Interface Contract Testing** — Verifies API contracts from the Interface View
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data classes
- **Fault Injection** — Tests failure propagation from the Dependency View

## System Tests

---

### Component Verification: SYS-001 (Tier Assignment Service)

**Parent Requirements**: REQ-001, REQ-020, REQ-023

#### Test Case: STP-001-A (Default Free-Tier Assignment on Registration)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `setUserTier(userId, tier)` write path
**Description**: Verifies that SYS-001 writes `tier: 'free'` to `UserSubscriptionRecord` in PostgreSQL upon account creation, and that the Clerk identity integration (SYS-008) reflects the new tier.

- **System Scenario: STS-001-A1**
    - **Given** a new `userId` with no existing `UserSubscriptionRecord` row
    - **When** `TierAssignmentService.assignDefaultTier(userId)` is invoked
    - **Then** a `UserSubscriptionRecord` row is inserted with `tier = 'free'` and `createdAt` set to the current timestamp

- **System Scenario: STS-001-A2**
    - **Given** a `UserSubscriptionRecord` row with `tier = 'free'` exists for `userId`
    - **When** `TierAssignmentService.assignDefaultTier(userId)` is invoked again
    - **Then** the service throws `DuplicateTierAssignmentError` and no duplicate row is inserted

#### Test Case: STP-001-B (Tier State Transition: Free → Premium)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View — tier state machine (free→premium)
**Description**: Verifies that SYS-001 correctly transitions a user from `free` to `premium` and propagates the change to SYS-008.

- **System Scenario: STS-001-B1**
    - **Given** a `UserSubscriptionRecord` with `tier = 'free'` for `userId`
    - **When** `TierAssignmentService.setUserTier(userId, 'premium', 'upgrade')` is called
    - **Then** the `UserSubscriptionRecord` row is updated to `tier = 'premium'` and `updatedAt` reflects the transition timestamp

- **System Scenario: STS-001-B2**
    - **Given** a `UserSubscriptionRecord` with `tier = 'premium'` for `userId`
    - **When** `TierAssignmentService.setUserTier(userId, 'free', 'lapse')` is called
    - **Then** the `UserSubscriptionRecord` row is updated to `tier = 'free'` and the previous `tier = 'premium'` value is no longer present

#### Test Case: STP-001-C (Tier Update Failure Rollback)

**Technique**: Fault Injection
**Target View**: Dependency View — SYS-001 → SYS-008 write failure
**Description**: Verifies that SYS-001 rolls back the `UserSubscriptionRecord` update when the downstream Clerk sync fails.

- **System Scenario: STS-001-C1**
    - **Given** a `UserSubscriptionRecord` with `tier = 'free'` and SYS-008 Clerk sync is configured to throw `AuthIdentityError`
    - **When** `TierAssignmentService.setUserTier(userId, 'premium', 'upgrade')` is called
    - **Then** the `UserSubscriptionRecord` row retains `tier = 'free'` (rollback applied) and `TierUpdateError` is propagated to the caller

---

### Component Verification: SYS-002 (Free-Tier Entitlement Module)

**Parent Requirements**: REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-007

#### Test Case: STP-002-A (Free-Tier Entitlement Resolution)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View — free-tier access rights
**Description**: Verifies that SYS-002 returns `allowed: true` for all six free-tier feature identifiers when queried for a `free`-tier user.

- **System Scenario: STS-002-A1**
    - **Given** a user with `tier = 'free'`
    - **When** `FreeTierEntitlementModule.isEntitled(userId, 'recipe:crud')` is called
    - **Then** the function returns `{ allowed: true, tier: 'free' }`

- **System Scenario: STS-002-A2**
    - **Given** a user with `tier = 'free'`
    - **When** `FreeTierEntitlementModule.isEntitled(userId, 'grocery:list-generation')` is called
    - **Then** the function returns `{ allowed: true, tier: 'free' }` and does NOT include `grocery:ordering` in the allowed set

#### Test Case: STP-002-B (Free-Tier Boundary: Grocery Ordering Denied)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View — FeatureGateRegistry free/premium boundary
**Description**: Verifies that SYS-002 explicitly denies `grocery:ordering` (a premium feature) for free-tier users, distinguishing it from the allowed `grocery:list-generation`.

- **System Scenario: STS-002-B1**
    - **Given** a user with `tier = 'free'`
    - **When** `FreeTierEntitlementModule.isEntitled(userId, 'grocery:ordering')` is called
    - **Then** the function returns `{ allowed: false, tier: 'free', requiredTier: 'premium' }`

---

### Component Verification: SYS-003 (Premium-Tier Entitlement Module)

**Parent Requirements**: REQ-009, REQ-010, REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017

#### Test Case: STP-003-A (Premium Entitlement Resolution for All Premium Features)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View — premium-tier access rights
**Description**: Verifies that SYS-003 returns `allowed: true` for all nine premium feature identifiers when queried for a `premium`-tier user.

- **System Scenario: STS-003-A1**
    - **Given** a user with `tier = 'premium'`
    - **When** `PremiumTierEntitlementModule.isEntitled(userId, 'recipe:private-visibility')` is called
    - **Then** the function returns `{ allowed: true, tier: 'premium' }`

- **System Scenario: STS-003-A2**
    - **Given** a user with `tier = 'premium'`
    - **When** `PremiumTierEntitlementModule.isEntitled(userId, 'trainer:nutrition-planning')` is called
    - **Then** the function returns `{ allowed: true, tier: 'premium' }`

#### Test Case: STP-003-B (Premium Features Denied for Free-Tier User)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View — FeatureGateRegistry premium boundary
**Description**: Verifies that SYS-003 returns `allowed: false` for premium features when the requesting user has `tier = 'free'`.

- **System Scenario: STS-003-B1**
    - **Given** a user with `tier = 'free'`
    - **When** `PremiumTierEntitlementModule.isEntitled(userId, 'ai:recipe-generation')` is called
    - **Then** the function returns `{ allowed: false, tier: 'free', requiredTier: 'premium' }`

---

### Component Verification: SYS-004 (Feature Gate Middleware)

**Parent Requirements**: REQ-IF-002, REQ-018, REQ-023, REQ-025

#### Test Case: STP-004-A (Gate Permits Access for Entitled User)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `getUserTier(userId)` + `getFeatureTier(featureId)` composition
**Description**: Verifies that SYS-004 calls SYS-008 for user tier and SYS-013 for feature tier, then permits access when both resolve and the user tier satisfies the feature requirement.

- **System Scenario: STS-004-A1**
    - **Given** SYS-008 returns `'premium'` for `userId` and SYS-013 returns `'free'` for `featureId = 'recipe:crud'`
    - **When** `FeatureGateMiddleware.checkAccess(userId, 'recipe:crud')` is called
    - **Then** the middleware returns `{ access: 'granted' }` without invoking SYS-006

- **System Scenario: STS-004-A2**
    - **Given** SYS-008 returns `'free'` for `userId` and SYS-013 returns `'free'` for `featureId = 'cooking:mode'`
    - **When** `FeatureGateMiddleware.checkAccess(userId, 'cooking:mode')` is called
    - **Then** the middleware returns `{ access: 'granted' }` without invoking SYS-006

#### Test Case: STP-004-B (Gate Denies Access and Triggers Upgrade Prompt)

**Technique**: Interface Contract Testing
**Target View**: Interface View — gate → SYS-006 call path
**Description**: Verifies that SYS-004 calls SYS-006 with the feature identifier when a free-tier user attempts to access a premium-gated feature.

- **System Scenario: STS-004-B1**
    - **Given** SYS-008 returns `'free'` for `userId` and SYS-013 returns `'premium'` for `featureId = 'ai:recipe-generation'`
    - **When** `FeatureGateMiddleware.checkAccess(userId, 'ai:recipe-generation')` is called
    - **Then** the middleware returns `{ access: 'denied', reason: 'tier-insufficient' }` and invokes `UpgradePromptComponent.show('ai:recipe-generation', 'free')`

#### Test Case: STP-004-C (Fail-Closed on SYS-008 Unavailability)

**Technique**: Fault Injection
**Target View**: Dependency View — SYS-004 → SYS-008 failure
**Description**: Verifies that SYS-004 defaults to deny when SYS-008 throws `TierResolutionError`.

- **System Scenario: STS-004-C1**
    - **Given** SYS-008 is configured to throw `TierResolutionError` for all `getUserTier` calls
    - **When** `FeatureGateMiddleware.checkAccess(userId, 'recipe:crud')` is called
    - **Then** the middleware returns `{ access: 'denied', reason: 'tier-resolution-failure' }` and does not propagate the exception to the caller

#### Test Case: STP-004-D (Fail-Closed on SYS-013 Unavailability)

**Technique**: Fault Injection
**Target View**: Dependency View — SYS-004 → SYS-013 failure
**Description**: Verifies that SYS-004 defaults to deny when SYS-013 throws `FeatureNotRegisteredError`.

- **System Scenario: STS-004-D1**
    - **Given** SYS-013 is configured to throw `FeatureNotRegisteredError` for `featureId = 'unknown:feature'`
    - **When** `FeatureGateMiddleware.checkAccess(userId, 'unknown:feature')` is called
    - **Then** the middleware returns `{ access: 'denied', reason: 'feature-not-registered' }` and does not propagate the exception

---

### Component Verification: SYS-005 (Recipe Visibility Enforcement)

**Parent Requirements**: REQ-008, REQ-024, REQ-025

#### Test Case: STP-005-A (Free-Tier Recipe Forced Public on Creation)

**Technique**: Interface Contract Testing
**Target View**: Interface View — SYS-007 → SYS-005 `enforceVisibilityOnLapse` call path
**Description**: Verifies that SYS-005 prevents a free-tier user from setting `visibility = 'private'` on a recipe, overriding the requested value to `'public'`.

- **System Scenario: STS-005-A1**
    - **Given** a user with `tier = 'free'` attempts to create a recipe with `visibility = 'private'`
    - **When** `RecipeVisibilityEnforcement.enforceOnCreate(userId, { visibility: 'private' })` is called
    - **Then** the returned recipe record has `visibility = 'public'` and the original `'private'` value is discarded

#### Test Case: STP-005-B (Lapse Preserves Existing Private Recipes)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View — visibility state preservation on lapse
**Description**: Verifies that SYS-005 retains `visibility = 'private'` for existing premium-created recipes when a subscription lapses, except for imported/attributed recipes.

- **System Scenario: STS-005-B1**
    - **Given** a `RecipeVisibilityState` row with `visibility = 'private'` and `source = 'user-created'` for `userId`
    - **When** `RecipeVisibilityEnforcement.enforceVisibilityOnLapse(userId)` is called
    - **Then** the `RecipeVisibilityState` row retains `visibility = 'private'`

- **System Scenario: STS-005-B2**
    - **Given** a `RecipeVisibilityState` row with `visibility = 'private'` and `source = 'imported'` for `userId`
    - **When** `RecipeVisibilityEnforcement.enforceVisibilityOnLapse(userId)` is called
    - **Then** the `RecipeVisibilityState` row is updated to `visibility = 'public'` (TOS constraint)

#### Test Case: STP-005-C (Lapsed User Cannot Set New Recipes Private)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View — RecipeVisibilityState tier boundary
**Description**: Verifies that SYS-005 blocks a lapsed-premium (now free-tier) user from setting new recipes to private.

- **System Scenario: STS-005-C1**
    - **Given** a user with `tier = 'free'` (post-lapse) attempts to create a recipe with `visibility = 'private'`
    - **When** `RecipeVisibilityEnforcement.enforceOnCreate(userId, { visibility: 'private' })` is called
    - **Then** the function returns `{ visibility: 'public', overridden: true }` and logs a visibility override event

---

### Component Verification: SYS-006 (Upgrade Prompt Component)

**Parent Requirements**: REQ-018, REQ-019, REQ-NF-003, REQ-NF-004

#### Test Case: STP-006-A (Upgrade Prompt Renders with Feature Preview)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `UpgradePromptUI` React component contract
**Description**: Verifies that SYS-006 renders an upgrade prompt containing the feature identifier and a preview/tease element when invoked with a valid feature identifier and `tier = 'free'`.

- **System Scenario: STS-006-A1**
    - **Given** `UpgradePromptComponent` is mounted with `{ featureId: 'ai:recipe-generation', userTier: 'free' }`
    - **When** the component renders
    - **Then** the rendered output contains a node queryable via `getByRole('dialog')` with an accessible name, and a child element containing feature preview text for `'ai:recipe-generation'`

- **System Scenario: STS-006-A2**
    - **Given** `UpgradePromptComponent` is mounted with `{ featureId: 'grocery:ordering', userTier: 'free' }`
    - **When** the component renders
    - **Then** the rendered output contains both a text label and an icon element (not color alone) conveying the upgrade requirement

#### Test Case: STP-006-B (Fallback to Generic CTA on Unknown Feature)

**Technique**: Fault Injection
**Target View**: Dependency View — SYS-006 fallback path
**Description**: Verifies that SYS-006 renders a generic upgrade CTA when the feature identifier is not recognized.

- **System Scenario: STS-006-B1**
    - **Given** `UpgradePromptComponent` is mounted with `{ featureId: 'unknown:feature', userTier: 'free' }`
    - **When** the component renders
    - **Then** the rendered output contains a generic upgrade CTA element queryable via `getByRole('button', { name: /upgrade/i })` and no feature-specific preview text

---

### Component Verification: SYS-007 (Subscription Lifecycle Manager)

**Parent Requirements**: REQ-021, REQ-022, REQ-023, REQ-024, REQ-025

#### Test Case: STP-007-A (Lapse Event Locks Premium Features)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `handleLifecycleEvent(event)` lapse path
**Description**: Verifies that SYS-007 calls SYS-001 to set tier to `'free'`, SYS-010 to retain data, and SYS-005 to enforce visibility when a `lapse` lifecycle event is received.

- **System Scenario: STS-007-A1**
    - **Given** a `SubscriptionEvent` of type `'lapse'` for `userId` with `tier = 'premium'`
    - **When** `SubscriptionLifecycleManager.handleLifecycleEvent({ type: 'lapse', userId })` is called
    - **Then** `TierAssignmentService.setUserTier(userId, 'free', 'lapse')` is called, `DataRetentionGuard.retainUserData(userId)` is called, and `RecipeVisibilityEnforcement.enforceVisibilityOnLapse(userId)` is called — all in sequence

#### Test Case: STP-007-B (Renewal Event Re-Enables Premium Features)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `handleLifecycleEvent(event)` renewal path
**Description**: Verifies that SYS-007 calls SYS-001 to set tier to `'premium'` when a `renewal` lifecycle event is received.

- **System Scenario: STS-007-B1**
    - **Given** a `SubscriptionEvent` of type `'renewal'` for `userId` with current `tier = 'free'`
    - **When** `SubscriptionLifecycleManager.handleLifecycleEvent({ type: 'renewal', userId })` is called
    - **Then** `TierAssignmentService.setUserTier(userId, 'premium', 'renewal')` is called and the `UserSubscriptionRecord` reflects `tier = 'premium'`

#### Test Case: STP-007-C (Data Retention Failure Blocks Lapse Completion)

**Technique**: Fault Injection
**Target View**: Dependency View — SYS-007 → SYS-010 failure
**Description**: Verifies that SYS-007 does not complete the lapse state transition when SYS-010 throws `DataRetentionError`.

- **System Scenario: STS-007-C1**
    - **Given** a `SubscriptionEvent` of type `'lapse'` for `userId` and SYS-010 is configured to throw `DataRetentionError`
    - **When** `SubscriptionLifecycleManager.handleLifecycleEvent({ type: 'lapse', userId })` is called
    - **Then** `LifecycleEventError` is thrown, the `UserSubscriptionRecord` retains `tier = 'premium'`, and an alert is emitted

---

### Component Verification: SYS-008 (Clerk Identity Integration)

**Parent Requirements**: REQ-IF-001

#### Test Case: STP-008-A (Tier Property Exposed on User Identity Object)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `Clerk User Identity` external interface
**Description**: Verifies that SYS-008 returns a user object with `subscriptionTier: 'free' | 'premium'` when given a valid Clerk session token.

- **System Scenario: STS-008-A1**
    - **Given** a valid Clerk session token for a user with `tier = 'premium'` stored in `UserSubscriptionRecord`
    - **When** `ClerkAuthService.getUserWithTier(sessionToken)` is called
    - **Then** the returned user object contains `subscriptionTier: 'premium'`

- **System Scenario: STS-008-A2**
    - **Given** a valid Clerk session token for a user with `tier = 'free'` stored in `UserSubscriptionRecord`
    - **When** `ClerkAuthService.getUserWithTier(sessionToken)` is called
    - **Then** the returned user object contains `subscriptionTier: 'free'`

#### Test Case: STP-008-B (AuthIdentityError on Invalid Token)

**Technique**: Fault Injection
**Target View**: Interface View — Clerk error handling
**Description**: Verifies that SYS-008 throws `AuthIdentityError` and denies access when the Clerk session token fails networkless verification (`CLERK_JWT_KEY` / `azp`) or is expired.

- **System Scenario: STS-008-B1**
    - **Given** an expired or malformed Clerk session token
    - **When** `ClerkAuthService.getUserWithTier(invalidToken)` is called
    - **Then** `AuthIdentityError` is thrown and no user object is returned

---

### Component Verification: SYS-009 (Subscription Webhook Receiver)

**Parent Requirements**: REQ-IF-003

#### Test Case: STP-009-A (Valid Signed Webhook Triggers Lifecycle Event)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `Subscription Webhook` HTTPS POST external interface
**Description**: Verifies that SYS-009 validates the webhook signature, parses the `SubscriptionEvent` payload, and calls `SubscriptionLifecycleManager.handleLifecycleEvent`.

- **System Scenario: STS-009-A1**
    - **Given** an HTTPS POST request with a valid HMAC signature and payload `{ type: 'upgrade', userId, tier: 'premium' }`
    - **When** `SubscriptionWebhookReceiver.handleWebhook(request)` is called
    - **Then** the handler returns HTTP 200, a `SubscriptionWebhookLog` row is inserted, and `SubscriptionLifecycleManager.handleLifecycleEvent({ type: 'upgrade', userId })` is called

#### Test Case: STP-009-B (Invalid Signature Returns 4xx)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View — SubscriptionWebhookLog signature boundary
**Description**: Verifies that SYS-009 rejects webhook payloads with invalid or missing HMAC signatures.

- **System Scenario: STS-009-B1**
    - **Given** an HTTPS POST request with an invalid HMAC signature
    - **When** `SubscriptionWebhookReceiver.handleWebhook(request)` is called
    - **Then** the handler returns HTTP 401, no `SubscriptionWebhookLog` row is inserted, and `handleLifecycleEvent` is NOT called

#### Test Case: STP-009-C (Lifecycle Event Failure Routes to DLQ)

**Technique**: Fault Injection
**Target View**: Dependency View — SYS-009 → SYS-007 failure
**Description**: Verifies that SYS-009 routes the event to the DLQ when SYS-007 throws `LifecycleEventError`.

- **System Scenario: STS-009-C1**
    - **Given** a valid signed webhook payload and SYS-007 configured to throw `LifecycleEventError`
    - **When** `SubscriptionWebhookReceiver.handleWebhook(request)` is called
    - **Then** the handler returns HTTP 500, the event is enqueued to the DLQ, and exponential backoff retry is scheduled

---

### Component Verification: SYS-010 (Data Retention Guard)

**Parent Requirements**: REQ-021, REQ-022

#### Test Case: STP-010-A (All User Data Retained on Lapse)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `retainUserData(userId)` call
**Description**: Verifies that SYS-010 does not delete or archive any user data rows when called with a valid `userId` during a lapse event.

- **System Scenario: STS-010-A1**
    - **Given** a `userId` with associated `UserSubscriptionRecord`, `RecipeVisibilityState`, and `SubscriptionWebhookLog` rows
    - **When** `DataRetentionGuard.retainUserData(userId)` is called
    - **Then** all associated rows remain present in PostgreSQL with no deletions or archival mutations

#### Test Case: STP-010-B (DataRetentionError Propagated on Storage Failure)

**Technique**: Fault Injection
**Target View**: Dependency View — SYS-010 storage failure
**Description**: Verifies that SYS-010 throws `DataRetentionError` and emits an alert when the PostgreSQL retention check fails.

- **System Scenario: STS-010-B1**
    - **Given** the PostgreSQL connection is unavailable during `retainUserData` execution
    - **When** `DataRetentionGuard.retainUserData(userId)` is called
    - **Then** `DataRetentionError` is thrown and an alert event is emitted to the monitoring system

---

### Component Verification: SYS-011 (TypeScript Strict Compliance Layer)

**Parent Requirements**: REQ-NF-001, REQ-NF-002

#### Test Case: STP-011-A (Strict TypeScript Compilation Enforced)

**Technique**: Interface Contract Testing
**Target View**: Decomposition View — cross-cutting TypeScript enforcement
**Description**: Verifies that the TypeScript compiler rejects any `any` usage outside explicitly marked test doubles in SYS-001, SYS-004, SYS-007, and SYS-009 source files.

- **System Scenario: STS-011-A1**
    - **Given** the TypeScript compiler is configured with `strict: true` and `noImplicitAny: true`
    - **When** `tsc --noEmit` is executed against the feature source files
    - **Then** the compiler exits with code 0 and emits no `TS2304` or `TS7006` errors in non-test-double files

#### Test Case: STP-011-B (JSDoc Present on All Exported Symbols)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View — JSDoc mandate
**Description**: Verifies that all exported functions and interfaces in the feature source carry JSDoc documentation blocks.

- **System Scenario: STS-011-B1**
    - **Given** the feature source files for SYS-001, SYS-004, SYS-007, and SYS-009
    - **When** a static analysis tool (e.g., `eslint` with `jsdoc/require-jsdoc`) is run
    - **Then** no exported function or interface is reported as missing a JSDoc block

---

### Component Verification: SYS-012 (Accessibility Compliance Layer)

**Parent Requirements**: REQ-NF-003, REQ-NF-004

#### Test Case: STP-012-A (UI Components Expose Accessible Names)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `UpgradePromptUI` accessible name contract
**Description**: Verifies that all UI components introduced by this feature expose accessible names queryable via `getByRole` or `getByLabel`.

- **System Scenario: STS-012-A1**
    - **Given** the `UpgradePromptComponent` is rendered in a Playwright test environment
    - **When** `page.getByRole('dialog')` is queried
    - **Then** the element is found and has a non-empty accessible name attribute

#### Test Case: STP-012-B (Tier Status Not Conveyed by Color Alone)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View — icon+text pairing requirement
**Description**: Verifies that the tier status display and upgrade prompt status use icon+text pairing, not color alone.

- **System Scenario: STS-012-B1**
    - **Given** the tier status indicator component is rendered for a `free`-tier user
    - **When** the rendered output is inspected for accessible text content
    - **Then** the component contains both a visible text label (e.g., "Free Plan") and an icon element with an `aria-label` or `alt` attribute — color is not the sole differentiator

---

### Component Verification: SYS-013 (Cross-Feature Gate Registry)

**Parent Requirements**: REQ-CN-001, REQ-CN-002, REQ-IF-002

#### Test Case: STP-013-A (Registry Resolves Feature Tier for All Registered Features)

**Technique**: Interface Contract Testing
**Target View**: Interface View — `getFeatureTier(featureId)` contract
**Description**: Verifies that SYS-013 returns the correct required tier for all registered feature identifiers across specs 001, 004–007, and 009.

- **System Scenario: STS-013-A1**
    - **Given** the `CrossFeatureGateRegistry` is initialized with the full feature configuration
    - **When** `CrossFeatureGateRegistry.getFeatureTier('recipe:crud')` is called
    - **Then** the function returns `'free'`

- **System Scenario: STS-013-A2**
    - **Given** the `CrossFeatureGateRegistry` is initialized with the full feature configuration
    - **When** `CrossFeatureGateRegistry.getFeatureTier('ai:recipe-generation')` is called
    - **Then** the function returns `'premium'`

#### Test Case: STP-013-B (FeatureNotRegisteredError for Unknown Feature)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View — FeatureGateRegistry boundary (registered vs. unregistered)
**Description**: Verifies that SYS-013 throws `FeatureNotRegisteredError` when queried for a feature identifier not present in the registry.

- **System Scenario: STS-013-B1**
    - **Given** the `CrossFeatureGateRegistry` is initialized with the full feature configuration
    - **When** `CrossFeatureGateRegistry.getFeatureTier('nonexistent:feature')` is called
    - **Then** `FeatureNotRegisteredError` is thrown with the unrecognized `featureId` in the error message

#### Test Case: STP-013-C (Registry Reloads on Deploy Without Stale State)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View — FeatureGateRegistry in-memory storage, reloaded on deploy
**Description**: Verifies that the registry reflects the latest configuration after a simulated deploy reload, with no stale entries from the previous configuration.

- **System Scenario: STS-013-C1**
    - **Given** the `CrossFeatureGateRegistry` is loaded with configuration version 1 containing `featureId = 'legacy:feature'`
    - **When** the registry is reloaded with configuration version 2 that omits `'legacy:feature'`
    - **Then** `CrossFeatureGateRegistry.getFeatureTier('legacy:feature')` throws `FeatureNotRegisteredError` (stale entry purged)

---

### Component Verification: SYS-014 (Stripe Billing Configuration)

#### Test Case: STP-014-A (Configured Prices and Trial Policy)

**Target View**: Interface View — Stripe product/price configuration contract
**Description**: Verifies that configured Stripe product/price IDs expose the monthly $6.99 plan, annual $59.99 plan, and 14-day trial required by REQ-026 and REQ-027.

- **Scenario: STS-014-A1**
    - **Given** billing configuration is loaded
    - **When** the pricing surface requests available premium plans
    - **Then** monthly, annual, and trial metadata match REQ-026 and REQ-027.

#### Test Case: STP-014-B (Grace Period Configuration)

**Target View**: Dependency View — SYS-014 consumed by SYS-007
**Description**: Verifies that failed-payment lifecycle handling reads the 7-day grace period required by REQ-028.

- **Scenario: STS-014-B1**
    - **Given** Stripe marks an invoice payment as failed
    - **When** SYS-007 requests billing lifecycle configuration
    - **Then** premium access remains in grace for 7 days before downgrade.

### Component Verification: SYS-015 (Mobile Billing Deep-Link Handler)

#### Test Case: STP-015-A (Mobile CTA Opens Web Checkout)

**Target View**: Interface View — mobile upgrade CTA contract
**Description**: Verifies that mobile clients deep-link to web Stripe Checkout and do not invoke native IAP for v1, satisfying REQ-030.

- **Scenario: STS-015-A1**
    - **Given** a mobile free-tier user taps an upgrade CTA
    - **When** the billing handler resolves the upgrade action
    - **Then** it opens the web checkout URL and no native IAP sheet appears.

#### Test Case: STP-015-B (Portal Deep-Link for Existing Subscribers)

**Target View**: Interface View — mobile billing portal contract
**Description**: Verifies that mobile subscription-management actions deep-link to the web customer portal for v1 billing changes.

- **Scenario: STS-015-B1**
    - **Given** a mobile premium user opens subscription management
    - **When** the portal action is selected
    - **Then** the web Stripe Customer Portal URL opens in the browser.

## Coverage Summary

| Metric                           | Count |
| -------------------------------- | ----- |
| Total System Components (SYS)    | 13    |
| Total Test Cases (STP)           | 26    |
| Total System Scenarios (STS)     | 44    |
| Components with ≥1 STP           | 13/13 |
| Test Cases with ≥1 STS           | 26/26 |
| Interface Contract Testing cases | 16    |
| Equivalence Partitioning cases   | 5     |
| Boundary Value Analysis cases    | 6     |
| Fault Injection cases            | 9     |

## SYS → STP Traceability

| SYS ID  | Component Name                     | STP IDs                                    |
| ------- | ---------------------------------- | ------------------------------------------ |
| SYS-001 | Tier Assignment Service            | STP-001-A, STP-001-B, STP-001-C            |
| SYS-002 | Free-Tier Entitlement Module       | STP-002-A, STP-002-B                       |
| SYS-003 | Premium-Tier Entitlement Module    | STP-003-A, STP-003-B                       |
| SYS-004 | Feature Gate Middleware            | STP-004-A, STP-004-B, STP-004-C, STP-004-D |
| SYS-005 | Recipe Visibility Enforcement      | STP-005-A, STP-005-B, STP-005-C            |
| SYS-006 | Upgrade Prompt Component           | STP-006-A, STP-006-B                       |
| SYS-007 | Subscription Lifecycle Manager     | STP-007-A, STP-007-B, STP-007-C            |
| SYS-008 | Clerk Identity Integration         | STP-008-A, STP-008-B                       |
| SYS-009 | Subscription Webhook Receiver      | STP-009-A, STP-009-B, STP-009-C            |
| SYS-010 | Data Retention Guard               | STP-010-A, STP-010-B                       |
| SYS-011 | TypeScript Strict Compliance Layer | STP-011-A, STP-011-B                       |
| SYS-012 | Accessibility Compliance Layer     | STP-012-A, STP-012-B                       |
| SYS-013 | Cross-Feature Gate Registry        | STP-013-A, STP-013-B, STP-013-C            |
| SYS-014 | Stripe Billing Configuration       | STP-014-A, STP-014-B                       |
| SYS-015 | Mobile Billing Deep-Link Handler   | STP-015-A, STP-015-B                       |
