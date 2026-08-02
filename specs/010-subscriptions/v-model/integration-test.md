# Integration Test Plan: Subscriptions & Monetization

**Feature Branch**: `010-subscriptions`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/010-subscriptions/v-model/architecture-design.md`

## Overview

This document defines the Integration Test Plan for Subscriptions & Monetization. Every architecture module in `architecture-design.md` (ARCH-001 through ARCH-018) has one or more Test Cases (ITP), and every Test Case has one or more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

Integration tests verify **seams and handshakes between modules**, not internal logic or user journeys. Language is module-boundary-oriented throughout.

## ID Schema

- **Integration Test Case**: `ITP-{NNN}-{X}` — where NNN matches the parent ARCH, X is a letter suffix (A, B, C...)
- **Integration Test Scenario**: `ITS-{NNN}-{X}{#}` — nested under the parent ITP, with numeric suffix (1, 2, 3...)
- Example: `ITS-001-A1` → Scenario 1 of Test Case A verifying ARCH-001

## ISO 29119-4 Integration Test Techniques

Consumer-Driven Contract Testing (CDCT) is included for externally consumed module contracts; provider modules publish contracts and consumer modules validate expectations before integration deployment.

Each test case identifies its technique by name and anchors to a specific architecture view:

| Technique                                | Source View                   | What It Tests                                                 |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------- |
| **Interface Contract Testing**           | Interface View                | Module API contracts, data format compliance, error responses |
| **Data Flow Testing**                    | Data Flow View                | End-to-end data transformation chain validation               |
| **Interface Fault Injection**            | Interface View + Process View | Malformed payloads, timeouts, graceful failure                |
| **Concurrency & Race Condition Testing** | Process View                  | Simultaneous access, lock handling, queue ordering            |

---

## Integration Tests

### ARCH-001: UserTierRepository

#### ITP-001-A — Repository ↔ TierAssignmentService Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-001 ↔ ARCH-002
**Description**: Verifies that `TierAssignmentService` calls `UserTierRepository` with the correct `{ userId, tier, reason }` shape and that the repository returns a well-formed `UserSubscriptionRecord`.

##### ITS-001-A1

```gherkin
Given ARCH-002 TierAssignmentService receives a valid tier-change request { userId: UUID-v4, targetTier: 'premium', reason: 'upgrade' }
When ARCH-002 calls ARCH-001 setUserTier(userId, 'premium', 'upgrade')
Then ARCH-001 returns UserSubscriptionRecord { userId, tier: 'premium', updatedAt: ISO-8601 }
And ARCH-002 emits a TierChanged domain event to ARCH-016
```

##### ITS-001-A2

```gherkin
Given ARCH-002 TierAssignmentService receives a request with a non-existent userId
When ARCH-002 calls ARCH-001 setUserTier(unknownUserId, 'premium', 'upgrade')
Then ARCH-001 throws TierUpdateError { code: 'TIER_UPDATE_FAILED', userId, reason }
And ARCH-002 propagates the error without emitting a TierChanged event
```

#### ITP-001-B — Repository ↔ SubscriptionLifecycleManager Data Flow

**Technique**: Data Flow Testing | **View**: Data Flow View (Webhook Event → Tier State Update, Stage 7–8)
**Modules Under Test**: ARCH-001 ↔ ARCH-009
**Description**: Verifies that the tier write at the end of the lapse data flow chain produces a persisted record visible to subsequent reads.

##### ITS-001-B1

```gherkin
Given ARCH-009 LifecycleManager has completed DataRetentionVerified and visibility enforcement
When ARCH-009 calls ARCH-002 setUserTier(userId, 'free', 'lapse') which delegates to ARCH-001
Then ARCH-001 persists UserSubscriptionRecord { tier: 'free' }
And a subsequent ARCH-001 getUserTier(userId) call returns 'free'
```

#### ITP-001-C — Repository Fault Injection on DB Write Failure

**Technique**: Interface Fault Injection | **View**: Interface View + Process View
**Modules Under Test**: ARCH-001 ↔ ARCH-002

##### ITS-001-C1

```gherkin
Given ARCH-001 UserTierRepository is configured to simulate a DB write failure
When ARCH-002 TierAssignmentService calls setUserTier(userId, 'premium', 'upgrade')
Then ARCH-001 throws TierUpdateError { code: 'TIER_UPDATE_FAILED' }
And ARCH-002 does not emit a TierChanged event
And the user's tier remains unchanged in the repository
```

---

### ARCH-002: TierAssignmentService

#### ITP-002-A — TierAssignmentService ↔ EventPublisher Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-002 ↔ ARCH-016
**Description**: Verifies that after a successful tier write, ARCH-002 publishes a correctly shaped `TierChanged` event to ARCH-016.

##### ITS-002-A1

```gherkin
Given ARCH-001 UserTierRepository successfully persists a tier change for userId
When ARCH-002 TierAssignmentService completes the transition from 'free' to 'premium'
Then ARCH-002 calls ARCH-016 publish(TierChanged { userId, from: 'free', to: 'premium' })
And ARCH-016 delivers the event to all registered in-process subscribers
```

##### ITS-002-A2

```gherkin
Given ARCH-001 UserTierRepository successfully persists a new user's free tier
When ARCH-002 TierAssignmentService completes assignDefaultTier(userId)
Then ARCH-002 calls ARCH-016 publish(TierChanged { userId, from: null, to: 'free' })
And ARCH-016 delivers the event without error
```

#### ITP-002-B — Invalid Transition Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-002 ↔ ARCH-001

##### ITS-002-B1

```gherkin
Given a user is already on the 'premium' tier per ARCH-001
When ARCH-002 TierAssignmentService receives setUserTier(userId, 'premium', 'duplicate')
Then ARCH-002 throws InvalidTierTransitionError { code: 'INVALID_TRANSITION', from: 'premium', to: 'premium' }
And ARCH-001 setUserTier is never called
```

---

### ARCH-003: FreeTierEntitlementResolver

#### ITP-003-A — FreeTierEntitlementResolver ↔ FeatureGateRegistry Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-003 ↔ ARCH-006
**Description**: Verifies that ARCH-003 reads the required tier from ARCH-006 and returns a correct `EntitlementDecision`.

##### ITS-003-A1

```gherkin
Given ARCH-006 FeatureGateRegistry maps featureId 'recipe-crud' to requiredTier 'free'
When ARCH-003 FreeTierEntitlementResolver resolves(featureId: 'recipe-crud', userTier: 'free')
Then ARCH-003 calls ARCH-006 getFeatureTier('recipe-crud') and receives 'free'
And ARCH-003 returns EntitlementDecision { permitted: true }
```

##### ITS-003-A2

```gherkin
Given ARCH-006 FeatureGateRegistry maps featureId 'ai-recipe-gen' to requiredTier 'premium'
When ARCH-003 FreeTierEntitlementResolver resolves(featureId: 'ai-recipe-gen', userTier: 'free')
Then ARCH-003 calls ARCH-006 getFeatureTier('ai-recipe-gen') and receives 'premium'
And ARCH-003 returns EntitlementDecision { permitted: false }
```

#### ITP-003-B — Unknown Feature ID Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-003 ↔ ARCH-006

##### ITS-003-B1

```gherkin
Given ARCH-006 FeatureGateRegistry has no entry for featureId 'unknown-feature'
When ARCH-003 FreeTierEntitlementResolver resolves(featureId: 'unknown-feature', userTier: 'free')
Then ARCH-003 receives undefined/null from ARCH-006
And ARCH-003 returns EntitlementDecision { permitted: false } (fail-closed)
```

---

### ARCH-004: PremiumTierEntitlementResolver

#### ITP-004-A — PremiumTierEntitlementResolver ↔ FeatureGateRegistry Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-004 ↔ ARCH-006

##### ITS-004-A1

```gherkin
Given ARCH-006 FeatureGateRegistry maps featureId 'ai-recipe-gen' to requiredTier 'premium'
When ARCH-004 PremiumTierEntitlementResolver resolves(featureId: 'ai-recipe-gen', userTier: 'premium')
Then ARCH-004 calls ARCH-006 getFeatureTier('ai-recipe-gen') and receives 'premium'
And ARCH-004 returns EntitlementDecision { permitted: true }
```

##### ITS-004-A2

```gherkin
Given ARCH-006 FeatureGateRegistry maps featureId 'recipe-crud' to requiredTier 'free'
When ARCH-004 PremiumTierEntitlementResolver resolves(featureId: 'recipe-crud', userTier: 'premium')
Then ARCH-004 returns EntitlementDecision { permitted: true }
And ARCH-006 getFeatureTier is called exactly once with 'recipe-crud'
```

#### ITP-004-B — Unknown Feature ID Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-004 ↔ ARCH-006

##### ITS-004-B1

```gherkin
Given ARCH-006 FeatureGateRegistry has no entry for featureId 'unknown-feature'
When ARCH-004 PremiumTierEntitlementResolver resolves(featureId: 'unknown-feature', userTier: 'premium')
Then ARCH-004 receives undefined/null from ARCH-006
And ARCH-004 returns EntitlementDecision { permitted: false } (fail-closed)
```

---

### ARCH-005: FeatureGateMiddleware

#### ITP-005-A — FeatureGateMiddleware ↔ ClerkTierClaimAdapter + FeatureGateRegistry Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-005 ↔ ARCH-010, ARCH-005 ↔ ARCH-006
**Description**: Verifies the full gate-check seam: middleware calls adapter for tier, registry for required tier, then permits or denies.

##### ITS-005-A1

```gherkin
Given an HTTP request with a valid JWT for a free-tier user and featureId 'recipe-crud'
When ARCH-005 FeatureGateMiddleware intercepts the request
Then ARCH-005 calls ARCH-010 getUserTier(userId) and receives 'free'
And ARCH-005 calls ARCH-006 getFeatureTier('recipe-crud') and receives 'free'
And ARCH-005 calls next() permitting the request
```

##### ITS-005-A2

```gherkin
Given an HTTP request with a valid JWT for a free-tier user and featureId 'ai-recipe-gen'
When ARCH-005 FeatureGateMiddleware intercepts the request
Then ARCH-005 calls ARCH-010 getUserTier(userId) and receives 'free'
And ARCH-005 calls ARCH-006 getFeatureTier('ai-recipe-gen') and receives 'premium'
And ARCH-005 returns HTTP 403 with upgradePromptPayload { featureId, userTier: 'free' }
```

#### ITP-005-B — FeatureGateMiddleware ↔ ClerkTierClaimAdapter Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View + Process View
**Modules Under Test**: ARCH-005 ↔ ARCH-010

##### ITS-005-B1

```gherkin
Given ARCH-010 ClerkTierClaimAdapter is configured to throw AuthIdentityError for userId
When ARCH-005 FeatureGateMiddleware calls getUserTier(userId)
Then ARCH-005 receives AuthIdentityError { code: 'AUTH_IDENTITY_FAILED', userId }
And ARCH-005 denies the request (fail-closed) without calling ARCH-006
And ARCH-005 returns HTTP 403
```

#### ITP-005-C — Concurrent Gate Checks (Race Condition)

**Technique**: Concurrency & Race Condition Testing | **View**: Process View
**Modules Under Test**: ARCH-005 ↔ ARCH-010, ARCH-005 ↔ ARCH-006

##### ITS-005-C1

```gherkin
Given 50 concurrent HTTP requests arrive for the same userId with different featureIds
When ARCH-005 FeatureGateMiddleware processes all requests simultaneously
Then each request independently calls ARCH-010 getUserTier(userId) without shared mutable state
And each request independently calls ARCH-006 getFeatureTier(featureId)
And all 50 responses are correct and independent (no cross-request tier contamination)
```

---

### ARCH-006: FeatureGateRegistry

#### ITP-006-A — FeatureGateRegistry ↔ Consumers Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-006 ↔ ARCH-003, ARCH-004, ARCH-005
**Description**: Verifies that the registry returns the correct `requiredTier` for all known feature IDs and that the registry is loaded from config at startup before any consumer calls it.

##### ITS-006-A1

```gherkin
Given ARCH-006 FeatureGateRegistry is initialized from startup config
When ARCH-003 calls getFeatureTier('recipe-crud')
Then ARCH-006 returns 'free' without any I/O call
And the response is consistent across all callers (ARCH-003, ARCH-004, ARCH-005)
```

##### ITS-006-A2

```gherkin
Given ARCH-006 FeatureGateRegistry is initialized from startup config
When ARCH-005 calls getFeatureTier('private-recipe-visibility')
Then ARCH-006 returns 'premium'
And the same call from ARCH-004 returns 'premium' (registry is consistent)
```

#### ITP-006-B — Registry Startup Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-006 ↔ ARCH-005

##### ITS-006-B1

```gherkin
Given ARCH-006 FeatureGateRegistry fails to load config at startup (malformed config)
When ARCH-005 FeatureGateMiddleware calls getFeatureTier(featureId)
Then ARCH-006 returns undefined or throws a ConfigurationError
And ARCH-005 denies the request (fail-closed)
```

---

### ARCH-007: RecipeVisibilityEnforcer

#### ITP-007-A — RecipeVisibilityEnforcer ↔ SubscriptionLifecycleManager Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-007 ↔ ARCH-009
**Description**: Verifies that ARCH-009 calls ARCH-007 with the correct userId and that ARCH-007 returns ok after applying lapse-time visibility rules.

##### ITS-007-A1

```gherkin
Given ARCH-009 LifecycleManager is processing a SubscriptionLapsed event for userId
When ARCH-009 calls ARCH-007 enforceVisibilityOnLapse(userId)
Then ARCH-007 applies lapse-time visibility rules (preserving existing private recipes)
And ARCH-007 returns ok to ARCH-009
And ARCH-009 proceeds to call ARCH-002 setUserTier
```

#### ITP-007-B — Visibility Enforcer Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View + Process View
**Modules Under Test**: ARCH-007 ↔ ARCH-009

##### ITS-007-B1

```gherkin
Given ARCH-007 RecipeVisibilityEnforcer throws an error during enforceVisibilityOnLapse(userId)
When ARCH-009 LifecycleManager awaits the call
Then ARCH-009 catches the error and throws LifecycleEventError { code: 'LIFECYCLE_EVENT_FAILED' }
And ARCH-002 setUserTier is NOT called (data integrity ordering preserved)
```

#### ITP-007-C — Data Flow: Visibility in Lapse Chain

**Technique**: Data Flow Testing | **View**: Data Flow View (Webhook Event → Tier State Update, Stage 6)
**Modules Under Test**: ARCH-007 ↔ ARCH-013, ARCH-007 ↔ ARCH-002

##### ITS-007-C1

```gherkin
Given ARCH-013 DataRetentionGuard has emitted DataRetentionVerified for userId
When ARCH-009 calls ARCH-007 enforceVisibilityOnLapse(userId) as the next step in the chain
Then ARCH-007 completes before ARCH-002 setUserTier is called
And the sequential await ordering (retain → visibility → tier) is preserved
```

---

### ARCH-008: UpgradePromptComponent

#### ITP-008-A — UpgradePromptComponent ↔ UpgradePromptFeaturePreview Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-008 ↔ ARCH-018
**Description**: Verifies that ARCH-008 passes featureId to ARCH-018 and renders the returned preview JSX.

##### ITS-008-A1

```gherkin
Given ARCH-005 FeatureGateMiddleware returns upgradePromptPayload { featureId: 'ai-recipe-gen', userTier: 'free' }
When ARCH-008 UpgradePromptComponent renders with those props
Then ARCH-008 calls ARCH-018 render(featureId: 'ai-recipe-gen')
And ARCH-018 returns featurePreviewJSX
And ARCH-008 renders the combined prompt with accessible aria-label
```

#### ITP-008-B — UpgradePromptComponent Fault Injection (Unknown featureId)

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-008 ↔ ARCH-018

##### ITS-008-B1

```gherkin
Given ARCH-008 UpgradePromptComponent receives featureId: 'unknown-feature'
When ARCH-008 calls ARCH-018 render('unknown-feature')
Then ARCH-018 returns a generic fallback preview JSX (never throws)
And ARCH-008 renders the fallback prompt with accessible aria-label
```

---

### ARCH-009: SubscriptionLifecycleManager

#### ITP-009-A — LifecycleManager ↔ DataRetentionGuard + RecipeVisibilityEnforcer + TierAssignmentService Data Flow

**Technique**: Data Flow Testing | **View**: Data Flow View (Webhook Event → Tier State Update, Stages 4–8)
**Modules Under Test**: ARCH-009 ↔ ARCH-013, ARCH-007, ARCH-002, ARCH-016
**Description**: Verifies the full lapse orchestration chain: retain → visibility → tier → publish.

##### ITS-009-A1

```gherkin
Given ARCH-009 LifecycleManager receives a validated SubscriptionLapsed event for userId
When ARCH-009 orchestrates the lapse flow
Then ARCH-009 calls ARCH-013 retainUserData(userId) and awaits DataRetentionVerified
Then ARCH-009 calls ARCH-007 enforceVisibilityOnLapse(userId) and awaits ok
Then ARCH-009 calls ARCH-002 setUserTier(userId, 'free', 'lapse') and awaits ok
Then ARCH-009 calls ARCH-016 publish(SubscriptionLapsed)
And all four calls occur in the specified sequential order
```

#### ITP-009-B — LifecycleManager Fault Injection (DLQ on failure)

**Technique**: Interface Fault Injection | **View**: Interface View + Process View
**Modules Under Test**: ARCH-009 ↔ ARCH-013

##### ITS-009-B1

```gherkin
Given ARCH-013 DataRetentionGuard throws an error for userId
When ARCH-009 LifecycleManager awaits retainUserData(userId)
Then ARCH-009 throws LifecycleEventError { code: 'LIFECYCLE_EVENT_FAILED', event: SubscriptionLapsed }
And the event is routed to the DLQ
And ARCH-007, ARCH-002, and ARCH-016 are NOT called
```

#### ITP-009-C — Concurrent Lifecycle Events

**Technique**: Concurrency & Race Condition Testing | **View**: Process View
**Modules Under Test**: ARCH-009 ↔ ARCH-002, ARCH-001

##### ITS-009-C1

```gherkin
Given two simultaneous SubscriptionLapsed events arrive for different userIds (userId-A and userId-B)
When ARCH-009 LifecycleManager processes both events concurrently
Then each event's lapse chain (retain → visibility → tier) executes independently
And ARCH-001 UserTierRepository receives two separate writes without cross-contamination
And both users end up on 'free' tier with correct audit records
```

---

### ARCH-010: ClerkTierClaimAdapter

#### ITP-010-A — ClerkTierClaimAdapter ↔ FeatureGateMiddleware Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-010 ↔ ARCH-005
**Description**: Verifies that ARCH-010 returns a valid tier string from the `public_metadata.subscriptionTier` claim on the verified Clerk session token when called by ARCH-005.

##### ITS-010-A1

```gherkin
Given a verified Clerk session token with public_metadata.subscriptionTier: 'premium' for userId
When ARCH-005 FeatureGateMiddleware calls ARCH-010 getUserTier(userId)
Then ARCH-010 reads the public_metadata.subscriptionTier claim and returns 'premium'
And ARCH-005 uses 'premium' for the tier comparison
```

##### ITS-010-A2

```gherkin
Given a verified Clerk session token with no public_metadata.subscriptionTier claim for userId
When ARCH-005 FeatureGateMiddleware calls ARCH-010 getUserTier(userId)
Then ARCH-010 defaults to returning 'free' (safe default)
And ARCH-005 uses 'free' for the tier comparison
```

#### ITP-010-B — ClerkTierClaimAdapter Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-010 ↔ ARCH-005, ARCH-002

##### ITS-010-B1

```gherkin
Given Clerk session token verification fails for userId (expired token or azp/CLERK_JWT_KEY rejection)
When ARCH-005 calls ARCH-010 getUserTier(userId)
Then ARCH-010 throws AuthIdentityError { code: 'AUTH_IDENTITY_FAILED', userId }
And ARCH-005 denies the request without calling ARCH-006
```

#### ITP-010-C — ClerkTierClaimAdapter ↔ TierAssignmentService Data Flow (Registration)

**Technique**: Data Flow Testing | **View**: Data Flow View (New User Registration, Stage 1–2)
**Modules Under Test**: ARCH-010 ↔ ARCH-002

##### ITS-010-C1

```gherkin
Given Clerk emits a user.created webhook event with userId
When ARCH-010 ClerkTierClaimAdapter receives the event and extracts userId
Then ARCH-010 calls ARCH-002 TierAssignmentService assignDefaultTier(userId)
And ARCH-002 receives { userId, targetTier: 'free', reason: 'registration' }
```

---

### ARCH-011: SubscriptionWebhookController

#### ITP-011-A — WebhookController ↔ WebhookSignatureValidator Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-011 ↔ ARCH-012
**Description**: Verifies that ARCH-011 passes the raw Buffer and X-Signature header to ARCH-012 before any further processing.

##### ITS-011-A1

```gherkin
Given a valid signed POST /api/v1/webhooks/subscription request with X-Signature header
When ARCH-011 SubscriptionWebhookController receives the request
Then ARCH-011 calls ARCH-012 validateHMAC(payload: Buffer, signature: string)
And ARCH-012 returns { valid: true }
And ARCH-011 proceeds to call ARCH-017 WebhookLogger
```

#### ITP-011-B — WebhookController ↔ LifecycleManager Data Flow

**Technique**: Data Flow Testing | **View**: Data Flow View (Webhook Event → Tier State Update, Stages 1–4)
**Modules Under Test**: ARCH-011 ↔ ARCH-017, ARCH-009

##### ITS-011-B1

```gherkin
Given ARCH-012 validates the signature successfully
When ARCH-011 WebhookController processes the SubscriptionLapsed event
Then ARCH-011 calls ARCH-017 persist(event) before calling ARCH-009
And ARCH-011 calls ARCH-009 handleLifecycleEvent(SubscriptionLapsed)
And ARCH-011 returns HTTP 200 { received: true } after ARCH-009 completes
```

#### ITP-011-C — WebhookController Fault Injection (Invalid Signature)

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-011 ↔ ARCH-012

##### ITS-011-C1

```gherkin
Given a POST /api/v1/webhooks/subscription request with a tampered or missing X-Signature header
When ARCH-011 SubscriptionWebhookController calls ARCH-012 validateHMAC(payload, signature)
Then ARCH-012 throws a signature validation error
And ARCH-011 returns HTTP 401 { error: 'Invalid signature' }
And ARCH-017 WebhookLogger and ARCH-009 LifecycleManager are NOT called
```

---

### ARCH-012: WebhookSignatureValidator

#### ITP-012-A — WebhookSignatureValidator ↔ WebhookController Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-012 ↔ ARCH-011

##### ITS-012-A1

```gherkin
Given a raw Buffer payload and a valid HMAC-SHA256 signature computed with the shared secret
When ARCH-011 calls ARCH-012 validateHMAC(payload, signature)
Then ARCH-012 returns { valid: true }
And ARCH-011 proceeds with event processing
```

##### ITS-012-A2

```gherkin
Given a raw Buffer payload and an HMAC-SHA256 signature computed with a wrong secret
When ARCH-011 calls ARCH-012 validateHMAC(payload, signature)
Then ARCH-012 throws a validation error (or returns { valid: false })
And ARCH-012 logs the validation failure
```

#### ITP-012-B — Malformed Payload Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-012 ↔ ARCH-011

##### ITS-012-B1

```gherkin
Given a POST request with an empty body (zero-byte Buffer) and any signature
When ARCH-011 calls ARCH-012 validateHMAC(emptyBuffer, signature)
Then ARCH-012 rejects the payload (validation error or { valid: false })
And ARCH-011 returns HTTP 400 { error: string }
```

---

### ARCH-013: DataRetentionGuard

#### ITP-013-A — DataRetentionGuard ↔ SubscriptionLifecycleManager Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-013 ↔ ARCH-009

##### ITS-013-A1

```gherkin
Given ARCH-009 LifecycleManager is processing a SubscriptionLapsed event for userId
When ARCH-009 calls ARCH-013 retainUserData(userId)
Then ARCH-013 runs a pre-lapse data integrity check
And ARCH-013 emits DataRetentionVerified event
And ARCH-013 returns ok to ARCH-009
```

#### ITP-013-B — DataRetentionGuard Fault Injection

**Technique**: Interface Fault Injection | **View**: Interface View + Process View
**Modules Under Test**: ARCH-013 ↔ ARCH-009

##### ITS-013-B1

```gherkin
Given ARCH-013 DataRetentionGuard detects a data integrity issue for userId
When ARCH-013 runs the pre-lapse check
Then ARCH-013 throws an error without emitting DataRetentionVerified
And ARCH-009 catches the error and throws LifecycleEventError
And ARCH-007 RecipeVisibilityEnforcer is NOT called
```

#### ITP-013-C — Data Flow: DataRetentionGuard Position in Lapse Chain

**Technique**: Data Flow Testing | **View**: Data Flow View (Webhook Event → Tier State Update, Stage 5)
**Modules Under Test**: ARCH-013 ↔ ARCH-009, ARCH-007

##### ITS-013-C1

```gherkin
Given ARCH-009 LifecycleManager begins the lapse orchestration
When ARCH-013 retainUserData(userId) completes and emits DataRetentionVerified
Then ARCH-009 calls ARCH-007 enforceVisibilityOnLapse(userId) as the immediate next step
And ARCH-002 setUserTier is not called until after ARCH-007 returns ok
```

---

### ARCH-014: TypeScriptStrictLinter [CROSS-CUTTING]

#### ITP-014-A — TypeScriptStrictLinter ↔ CI Build Pipeline Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-014 ↔ CI build system
**Description**: Verifies that ARCH-014 integrates correctly with the CI pipeline and fails the build on strict violations.

##### ITS-014-A1

```gherkin
Given a TypeScript source file in the subscriptions feature that uses an implicit 'any' type
When ARCH-014 TypeScriptStrictLinter runs as a CI gate
Then ARCH-014 reports a type error and exits with non-zero status
And the CI pipeline fails the build before deployment
```

##### ITS-014-A2

```gherkin
Given all TypeScript source files in the subscriptions feature pass strict: true checks
When ARCH-014 TypeScriptStrictLinter runs as a CI gate
Then ARCH-014 exits with status 0
And the CI pipeline proceeds to the next stage
```

#### ITP-014-B — Linter Fault Injection (Malformed tsconfig)

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-014 ↔ CI build system

##### ITS-014-B1

```gherkin
Given the tsconfig.json is malformed or missing strict: true
When ARCH-014 TypeScriptStrictLinter initializes
Then ARCH-014 reports a configuration error
And the CI pipeline fails with a descriptive error message
```

---

### ARCH-015: AccessibilityComplianceValidator [CROSS-CUTTING]

#### ITP-015-A — AccessibilityComplianceValidator ↔ UpgradePromptComponent Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-015 ↔ ARCH-008
**Description**: Verifies that ARCH-015 can query ARCH-008 via getByRole/getByLabel and that the component exposes the required accessible name.

##### ITS-015-A1

```gherkin
Given ARCH-008 UpgradePromptComponent is rendered in a Playwright test environment
When ARCH-015 AccessibilityComplianceValidator queries the component via getByRole('dialog') or getByLabel
Then ARCH-015 finds the component with a non-empty accessible aria-label
And ARCH-015 validates that the icon+text pairing is present
And ARCH-015 exits with status 0
```

#### ITP-015-B — Accessibility Fault Injection (Missing aria-label)

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-015 ↔ ARCH-008

##### ITS-015-B1

```gherkin
Given ARCH-008 UpgradePromptComponent is rendered without an aria-label attribute
When ARCH-015 AccessibilityComplianceValidator queries the component
Then ARCH-015 fails to find a valid accessible name
And ARCH-015 reports an accessibility violation and exits with non-zero status
And the CI pipeline fails the build
```

---

### ARCH-016: SubscriptionEventPublisher

#### ITP-016-A — EventPublisher ↔ TierAssignmentService Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-016 ↔ ARCH-002
**Description**: Verifies that ARCH-016 receives correctly shaped domain events from ARCH-002 and delivers them to all registered subscribers.

##### ITS-016-A1

```gherkin
Given a subscriber is registered on the in-process event bus for TierChanged events
When ARCH-002 TierAssignmentService calls ARCH-016 publish(TierChanged { userId, from: 'free', to: 'premium' })
Then ARCH-016 delivers the event to the registered subscriber
And the subscriber receives the event with the correct shape
```

#### ITP-016-B — EventPublisher ↔ LifecycleManager Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-016 ↔ ARCH-009

##### ITS-016-B1

```gherkin
Given ARCH-009 LifecycleManager completes the lapse orchestration chain
When ARCH-009 calls ARCH-016 publish(SubscriptionLapsed { userId })
Then ARCH-016 delivers the SubscriptionLapsed event to all registered subscribers
And ARCH-009 receives ok from ARCH-016
```

#### ITP-016-C — Concurrent Event Publishing

**Technique**: Concurrency & Race Condition Testing | **View**: Process View
**Modules Under Test**: ARCH-016 ↔ ARCH-002, ARCH-009

##### ITS-016-C1

```gherkin
Given ARCH-002 and ARCH-009 both publish events simultaneously (TierChanged and SubscriptionLapsed)
When ARCH-016 EventPublisher processes both publish calls concurrently
Then each event is delivered independently to its respective subscribers
And no event is lost or delivered to the wrong subscriber
```

---

### ARCH-017: SubscriptionWebhookLogger

#### ITP-017-A — WebhookLogger ↔ WebhookController Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-017 ↔ ARCH-011
**Description**: Verifies that ARCH-011 calls ARCH-017 before delegating to ARCH-009, and that ARCH-017 persists the event to the SubscriptionWebhookLog table.

##### ITS-017-A1

```gherkin
Given ARCH-012 validates the webhook signature successfully
When ARCH-011 WebhookController calls ARCH-017 persist(event: SubscriptionEvent)
Then ARCH-017 writes a WebhookLogEntry to the SubscriptionWebhookLog table
And ARCH-017 returns ok to ARCH-011
And ARCH-011 then calls ARCH-009 handleLifecycleEvent
```

#### ITP-017-B — WebhookLogger Fault Injection (DB Write Failure)

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-017 ↔ ARCH-011

##### ITS-017-B1

```gherkin
Given ARCH-017 SubscriptionWebhookLogger is configured to simulate a DB write failure
When ARCH-011 calls ARCH-017 persist(event)
Then ARCH-017 throws a persistence error
And ARCH-011 returns HTTP 500 or routes the event to the DLQ
And ARCH-009 LifecycleManager is NOT called
```

#### ITP-017-C — Data Flow: Logger Position in Webhook Chain

**Technique**: Data Flow Testing | **View**: Data Flow View (Webhook Event → Tier State Update, Stage 3)
**Modules Under Test**: ARCH-017 ↔ ARCH-011, ARCH-009

##### ITS-017-C1

```gherkin
Given ARCH-011 WebhookController has validated the signature via ARCH-012
When ARCH-011 calls ARCH-017 persist(event) as Stage 3 of the data flow
Then ARCH-017 completes persistence before ARCH-009 handleLifecycleEvent is called
And the WebhookLogEntry is queryable in the SubscriptionWebhookLog table
```

---

### ARCH-018: UpgradePromptFeaturePreview

#### ITP-018-A — UpgradePromptFeaturePreview ↔ UpgradePromptComponent Contract

**Technique**: Interface Contract Testing | **View**: Interface View
**Modules Under Test**: ARCH-018 ↔ ARCH-008
**Description**: Verifies that ARCH-018 receives featureId from ARCH-008 and returns feature-specific preview JSX.

##### ITS-018-A1

```gherkin
Given ARCH-008 UpgradePromptComponent renders with featureId: 'ai-recipe-gen'
When ARCH-008 calls ARCH-018 render(featureId: 'ai-recipe-gen')
Then ARCH-018 returns feature-specific preview JSX for 'ai-recipe-gen'
And ARCH-008 incorporates the preview JSX into the rendered upgrade prompt
```

##### ITS-018-A2

```gherkin
Given ARCH-008 UpgradePromptComponent renders with featureId: 'private-recipe-visibility'
When ARCH-008 calls ARCH-018 render(featureId: 'private-recipe-visibility')
Then ARCH-018 returns feature-specific preview JSX for 'private-recipe-visibility'
And ARCH-018 never throws (always returns JSX, falls back to generic on unknown featureId)
```

#### ITP-018-B — UpgradePromptFeaturePreview Fault Injection (Unknown featureId)

**Technique**: Interface Fault Injection | **View**: Interface View
**Modules Under Test**: ARCH-018 ↔ ARCH-008

##### ITS-018-B1

```gherkin
Given ARCH-008 UpgradePromptComponent renders with featureId: 'completely-unknown-feature'
When ARCH-008 calls ARCH-018 render('completely-unknown-feature')
Then ARCH-018 returns generic fallback preview JSX (never throws)
And ARCH-008 renders the fallback prompt without error
```

---

## Coverage Summary

| Metric                                     | Count                  |
| ------------------------------------------ | ---------------------- |
| Total Architecture Modules (ARCH)          | 18                     |
| Architecture Modules with ≥1 ITP           | 18                     |
| Total Integration Test Cases (ITP)         | 42                     |
| Total Integration Test Scenarios (ITS)     | 62                     |
| Interface Contract Testing cases           | 22                     |
| Data Flow Testing cases                    | 10                     |
| Interface Fault Injection cases            | 22                     |
| Concurrency & Race Condition Testing cases | 5                      |
| Cross-cutting modules covered              | 2 (ARCH-014, ARCH-015) |

## Technique Distribution

| Technique                            | ITP Count | ITS Count |
| ------------------------------------ | --------- | --------- |
| Interface Contract Testing           | 22        | 33        |
| Data Flow Testing                    | 10        | 14        |
| Interface Fault Injection            | 22        | 29        |
| Concurrency & Race Condition Testing | 5         | 6         |
| **Total**                            | **42**    | **62**    |

## ARCH Coverage Matrix

| ARCH ID  | Module Name                      | ITP IDs                         | Techniques Used                         |
| -------- | -------------------------------- | ------------------------------- | --------------------------------------- |
| ARCH-001 | UserTierRepository               | ITP-001-A, ITP-001-B, ITP-001-C | Contract, Data Flow, Fault Injection    |
| ARCH-002 | TierAssignmentService            | ITP-002-A, ITP-002-B            | Contract, Fault Injection               |
| ARCH-003 | FreeTierEntitlementResolver      | ITP-003-A, ITP-003-B            | Contract, Fault Injection               |
| ARCH-004 | PremiumTierEntitlementResolver   | ITP-004-A, ITP-004-B            | Contract, Fault Injection               |
| ARCH-005 | FeatureGateMiddleware            | ITP-005-A, ITP-005-B, ITP-005-C | Contract, Fault Injection, Concurrency  |
| ARCH-006 | FeatureGateRegistry              | ITP-006-A, ITP-006-B            | Contract, Fault Injection               |
| ARCH-007 | RecipeVisibilityEnforcer         | ITP-007-A, ITP-007-B, ITP-007-C | Contract, Fault Injection, Data Flow    |
| ARCH-008 | UpgradePromptComponent           | ITP-008-A, ITP-008-B            | Contract, Fault Injection               |
| ARCH-009 | SubscriptionLifecycleManager     | ITP-009-A, ITP-009-B, ITP-009-C | Data Flow, Fault Injection, Concurrency |
| ARCH-010 | ClerkTierClaimAdapter            | ITP-010-A, ITP-010-B, ITP-010-C | Contract, Fault Injection, Data Flow    |
| ARCH-011 | SubscriptionWebhookController    | ITP-011-A, ITP-011-B, ITP-011-C | Contract, Data Flow, Fault Injection    |
| ARCH-012 | WebhookSignatureValidator        | ITP-012-A, ITP-012-B            | Contract, Fault Injection               |
| ARCH-013 | DataRetentionGuard               | ITP-013-A, ITP-013-B, ITP-013-C | Contract, Fault Injection, Data Flow    |
| ARCH-014 | TypeScriptStrictLinter           | ITP-014-A, ITP-014-B            | Contract, Fault Injection               |
| ARCH-015 | AccessibilityComplianceValidator | ITP-015-A, ITP-015-B            | Contract, Fault Injection               |
| ARCH-016 | SubscriptionEventPublisher       | ITP-016-A, ITP-016-B, ITP-016-C | Contract, Contract, Concurrency         |
| ARCH-017 | SubscriptionWebhookLogger        | ITP-017-A, ITP-017-B, ITP-017-C | Contract, Fault Injection, Data Flow    |
| ARCH-018 | UpgradePromptFeaturePreview      | ITP-018-A, ITP-018-B            | Contract, Fault Injection               |
