# Unit Test Plan: Subscriptions & Monetization

**Feature Branch**: `010-subscriptions`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/010-subscriptions/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for the Subscriptions & Monetization feature. Every module design (`MOD-NNN`) in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state transitions, and variable boundaries. They do NOT test module boundaries (integration), user journeys (acceptance), or system-level behavior (system tests).

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix (A, B, C...)
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3...)

## ISO 29119-4 White-Box Techniques

| Technique                       | Source View                   | What It Tests                                           |
| ------------------------------- | ----------------------------- | ------------------------------------------------------- |
| **Statement & Branch Coverage** | Algorithmic/Logic View        | Every line and every True/False branch outcome          |
| **Boundary Value Analysis**     | Internal Data Structures      | Scalar variable boundaries: min-1, min, mid, max, max+1 |
| **Equivalence Partitioning**    | Internal Data Structures      | Discrete non-scalar types: Booleans, Enums              |
| **Strict Isolation**            | Architecture Interface View   | Every external dependency mocked/stubbed                |
| **Error Guessing**              | Error Handling & Return Codes | Negative paths, invalid inputs, dependency exceptions   |
| **State Transition Testing**    | State Machine View            | Every transition including invalid ones                 |

---

## Unit Tests

---

### Module: MOD-001 (UserTierRepository)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `src/subscriptions/repositories/user-tier.repository.ts`

---

#### Test Case: UTP-001-A (getUserTier + setUserTier)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies getUserTier queries with RLS and returns default 'free' tier if no row; setUserTier validates inputs and upserts with transaction.

**Scenarios:**

**UTS-001-A1** — getUserTier: row found → UserSubscriptionRecord returned

- Arrange: mock db.select().from().where().limit(1) → [{ userId: 'uid', tier: 'premium', updatedAt: 'ts' }]
- Act: result = await repo.getUserTier('valid-uuid')
- Assert: result.tier === 'premium'; result.userId === 'uid'
- Mock isolation: DrizzleDb stubbed

**UTS-001-A2** — getUserTier: no row found → default free tier returned

- Arrange: mock db.select().from().where().limit(1) → []
- Act: result = await repo.getUserTier('unknown-uuid')
- Assert: result.tier === 'free'; result.updatedAt === null
- Mock isolation: DrizzleDb stubbed

**UTS-001-A3** — getUserTier: invalid UUID → TierUpdateError thrown

- Arrange: userId = 'not-a-uuid'
- Act/Assert: repo.getUserTier('not-a-uuid') throws TierUpdateError with code 'TIER_UPDATE_FAILED'
- Mock isolation: none

**UTS-001-A4** — setUserTier: valid upsert → record returned with new tier

- Arrange: mock db.transaction() → mock tx; mock tx.insert().values().returning() → [{ userId: 'uid', tier: 'premium', updatedAt: 'ts' }]; mock tx.insert().values() → void
- Act: result = await repo.setUserTier('valid-uuid', 'premium', 'upgrade')
- Assert: result.tier === 'premium'; verify transaction started
- Mock isolation: DrizzleDb stubbed

**UTS-001-A5** — setUserTier: invalid tier value → TierUpdateError

- Act/Assert: repo.setUserTier('valid-uuid', 'platinum', 'x') throws TierUpdateError; verify transaction NOT started
- Mock isolation: none

---

### Module: MOD-002 (TierAssignmentService)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `src/subscriptions/services/tier-assignment.service.ts`

---

#### Test Case: UTP-002-A (assignTier + getEffectiveTier)

**Technique**: Statement Coverage + Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies assignTier persists tier change and emits event; getEffectiveTier returns active tier.

**Scenarios:**

**UTS-002-A1** — assignTier → repo updated + event published

- Arrange: mock repo.setUserTier() → { userId: 'uid', tier: 'premium' }; mock eventBus.publish = jest.fn()
- Act: result = await service.assignTier('uid', 'premium', 'upgrade')
- Assert: result.tier === 'premium'; verify eventBus.publish called with event name 'user.tier.changed'
- Mock isolation: UserTierRepository stubbed; EventBus stubbed

**UTS-002-A2** — getEffectiveTier → returns current tier from repo

- Arrange: mock repo.getUserTier() → { userId: 'uid', tier: 'free' }
- Act: result = await service.getEffectiveTier('uid')
- Assert: result === 'free'
- Mock isolation: UserTierRepository stubbed

---

### Module: MOD-003 (FreeTierEntitlementResolver)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `src/subscriptions/services/free-tier-entitlement-resolver.ts`

---

#### Test Case: UTP-003-A (resolve — entitlement boundary check)

**Technique**: Boundary Value Analysis + Equivalence Partitioning
**Target View**: Internal Data Structures View
**Description**: Verifies free tier limits: recipe count ≤ 10, no AI generation, no premium features.

**Scenarios:**

**UTS-003-A1** — 10 recipes (boundary) → allowed

- Arrange: userId = 'uid'; mock repo.getUserTier() → { tier: 'free' }; mock countRepo.countRecipes('uid') → 10
- Act: result = service.resolve(userId, { feature: 'recipe_create' })
- Assert: result.allowed === true
- Mock isolation: UserTierRepository stubbed; countRepo stubbed

**UTS-003-A2** — 11 recipes → denied with upgradeRequired

- Arrange: mock countRepo.countRecipes('uid') → 11
- Act: result = service.resolve(userId, { feature: 'recipe_create' })
- Assert: result.allowed === false; result.upgradeRequired === true
- Mock isolation: countRepo stubbed

**UTS-003-A3** — AI generation requested → denied for free tier

- Arrange: mock repo.getUserTier() → { tier: 'free' }
- Act: result = service.resolve(userId, { feature: 'ai_generate' })
- Assert: result.allowed === false; result.reason === 'ai_generation_not_included'
- Mock isolation: UserTierRepository stubbed

---

### Module: MOD-004 (PremiumTierEntitlementResolver)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `src/subscriptions/services/premium-tier-entitlement-resolver.ts`

---

#### Test Case: UTP-004-A (resolve — premium feature access)

**Technique**: Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies all premium features enabled for premium users; no limits on recipe count or AI generation.

**Scenarios:**

**UTS-004-A1** — Premium user requests AI generation → allowed

- Arrange: mock repo.getUserTier() → { tier: 'premium' }
- Act: result = service.resolve(userId, { feature: 'ai_generate' })
- Assert: result.allowed === true
- Mock isolation: UserTierRepository stubbed

**UTS-004-A2** — Premium user requests unlimited recipes → allowed

- Arrange: mock countRepo.countRecipes('uid') → 9999
- Act: result = service.resolve(userId, { feature: 'recipe_create' })
- Assert: result.allowed === true; no count limit
- Mock isolation: UserTierRepository stubbed; countRepo stubbed

---

### Module: MOD-005 (FeatureGateMiddleware)

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `src/subscriptions/middleware/feature-gate.middleware.ts`

---

#### Test Case: UTP-005-A (canActivate — fail-closed enforcement)

**Technique**: Statement & Branch Coverage + State Transition Testing
**Target View**: State Machine View
**Description**: Verifies middleware intercepts requests to gated features, resolves entitlement, and returns 402 for denied, passes through for allowed.

**Scenarios:**

**UTS-005-A1** — Free user hits AI generation → 402 Upgrade Required

- Arrange: mock authAdapter.getUserId() → 'uid'; mock entitlementResolver.resolve() → { allowed: false, reason: 'ai_generation_not_included', upgradeRequired: true }
- Act: result = await middleware.canActivate(mockContext)
- Assert: result.status === 402; result.body.error === 'Upgrade required to access this feature'
- Mock isolation: AuthAdapter stubbed; EntitlementResolver stubbed

**UTS-005-A2** — Premium user hits AI generation → passes through

- Arrange: mock authAdapter.getUserId() → 'uid'; mock entitlementResolver.resolve() → { allowed: true }
- Act: result = await middleware.canActivate(mockContext)
- Assert: result === true (passes to next middleware)
- Mock isolation: AuthAdapter stubbed; EntitlementResolver stubbed

**UTS-005-A3** — Unauthenticated request → passes through (handled by auth middleware)

- Arrange: mock authAdapter.getUserId() → null
- Act: result = await middleware.canActivate(mockContext)
- Assert: result === true; verify entitlementResolver NOT called
- Mock isolation: AuthAdapter stubbed

---

### Module: MOD-006 (FeatureGateRegistry)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `src/subscriptions/services/feature-gate-registry.ts`

---

#### Test Case: UTP-006-A (registerFeature + isFeatureEnabled + getGatedFeatures)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Internal Data Structures View
**Description**: Verifies feature registration, enabled/disabled state toggle, and listing of all gated features.

**Scenarios:**

**UTS-006-A1** — Register feature → stored and returned in list

- Arrange: feature = { key: 'ai_generate', requiredTier: 'premium', description: 'AI recipe generation' }
- Act: service.registerFeature(feature); result = service.getGatedFeatures()
- Assert: result.some(f => f.key === 'ai_generate')
- Mock isolation: none (pure registry)

**UTS-006-A2** — Feature enabled → isFeatureEnabled returns true

- Arrange: service.registerFeature({ key: 'beta_feature', requiredTier: 'free' })
- act: result = service.isFeatureEnabled('beta_feature', 'free')
- Assert: result === true
- Mock isolation: none

**UTS-006-A3** — Feature disabled at runtime → isFeatureEnabled returns false

- Arrange: service.registerFeature({ key: 'feature_x', requiredTier: 'free' }); service.setFeatureEnabled('feature_x', false)
- Act: result = service.isFeatureEnabled('feature_x', 'free')
- Assert: result === false
- Mock isolation: none

---

### Module: MOD-007 (RecipeVisibilityEnforcer)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `src/subscriptions/services/recipe-visibility-enforcer.ts`

---

#### Test Case: UTP-007-A (enforceVisibility — public/private filter)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies public recipes visible to all, private recipes visible only to owner.

**Scenarios:**

**UTS-007-A1** — Public recipe → returned to any user

- Arrange: recipe = { id: 'r1', visibility: 'public', ownerId: 'other-user' }
- Act: result = enforcer.enforceVisibility(recipe, 'any-user-id')
- Assert: result !== null; result.id === 'r1'
- Mock isolation: none

**UTS-007-A2** — Private recipe, owner requesting → returned

- Arrange: recipe = { id: 'r1', visibility: 'private', ownerId: 'uid' }
- Act: result = enforcer.enforceVisibility(recipe, 'uid')
- Assert: result !== null
- Mock isolation: none

**UTS-007-A3** — Private recipe, non-owner requesting → null returned (not throw)

- Arrange: recipe = { id: 'r1', visibility: 'private', ownerId: 'other-uid' }
- Act: result = enforcer.enforceVisibility(recipe, 'uid')
- Assert: result === null; no exception thrown
- Mock isolation: none

---

### Module: MOD-008 (UpgradePromptComponent)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `src/subscriptions/components/upgrade-prompt.component.ts`

---

#### Test Case: UTP-008-A (renderPrompt — upsell message generation)

**Technique**: Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies renderPrompt returns correct upgrade CTA based on triggered feature.

**Scenarios:**

**UTS-008-A1** — Render AI generation upgrade prompt

- Act: result = component.renderPrompt('ai_generate')
- Assert: result.title.includes('Premium'); result.ctaText === 'Upgrade Now'; result.featureFlag === 'ai_generation'
- Mock isolation: none (pure function)

**UTS-008-A2** — Render recipe limit upgrade prompt

- act: result = component.renderPrompt('recipe_limit_reached')
- Assert: result.title.includes('recipe'); result.upgradeRequired === true
- Mock isolation: none

---

### Module: MOD-009 (SubscriptionLifecycleManager)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `src/subscriptions/webhooks/subscription-lifecycle.manager.ts`

---

#### Test Case: UTP-009-A (handleSubscriptionCreated + handleSubscriptionUpdated + handleSubscriptionDeleted)

**Technique**: State Transition Testing + Statement Coverage
**Target View**: State Machine View
**Description**: Verifies webhook events transition user tier correctly: created → premium, updated → tier change, deleted → free.

**Scenarios:**

**UTS-009-A1** — subscription.created event → user tier set to premium

- Arrange: mock tierService.assignTier() → { userId: 'uid', tier: 'premium' }
- Act: result = await manager.handleSubscriptionCreated({ userId: 'uid', subscriptionId: 'sub-123' })
- Assert: result.newTier === 'premium'; verify tierService.assignTier called with 'premium'
- Mock isolation: TierAssignmentService stubbed

**UTS-009-A2** — subscription.updated with downgrade → tier set to free

- Arrange: mock tierService.assignTier() → { userId: 'uid', tier: 'free' }
- act: result = await manager.handleSubscriptionUpdated({ userId: 'uid', status: 'canceled' })
- Assert: result.newTier === 'free'; verify assignTier called with reason 'subscription_canceled'
- Mock isolation: TierAssignmentService stubbed

**UTS-009-A3** — subscription.deleted → tier set to free

- Arrange: mock tierService.assignTier() → { userId: 'uid', tier: 'free' }
- act: result = await manager.handleSubscriptionDeleted({ userId: 'uid' })
- Assert: result.newTier === 'free'
- Mock isolation: TierAssignmentService stubbed

**UTS-009-B1** — Unknown event type → Error thrown

- Act/Assert: manager.handleEvent({ eventType: 'unknown', payload: {} }) throws Error with message 'Unknown subscription event type'
- Mock isolation: none

---

### Module: MOD-010 (ClerkTierClaimAdapter)

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `src/subscriptions/adapters/clerk-tier-claim.adapter.ts`

---

#### Test Case: UTP-010-A (getUserTierFromToken + setTierClaimInToken)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies reading the `public_metadata.subscriptionTier` tier claim from the verified Clerk session token and resolving the user's tier.

**Scenarios:**

**UTS-010-A1** — Token has tier claim → returned

- Arrange: mock jwtDecode() → { sub: 'uid', 'https://kitchensink.app/tier': 'premium' }
- Act: result = adapter.getUserTierFromToken('access-token')
- Assert: result === 'premium'
- Mock isolation: jwtDecode stubbed

**UTS-010-A2** — Token has no tier claim → 'free' returned as default

- Arrange: mock jwtDecode() → { sub: 'uid' }
- Act: result = adapter.getUserTierFromToken('access-token')
- Assert: result === 'free'
- Mock isolation: jwtDecode stubbed

---

### Module: MOD-011 (SubscriptionWebhookController)

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `src/subscriptions/webhooks/subscription-webhook.controller.ts`

---

#### Test Case: UTP-011-A (handleWebhook — signature validation + event dispatch)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies webhook controller validates the webhook signing key (HMAC-SHA256), dispatches to lifecycle manager.

**Scenarios:**

**UTS-011-A1** — Valid signature + valid payload → 200, event dispatched

- Arrange: mock validator.validateSignature() → true; mock lifecycle.handleSubscriptionCreated() → { newTier: 'premium' }
- Act: result = await controller.handleWebhook(mockReq, { type: 'subscription.created', data: { userId: 'uid' } })
- Assert: result.status === 200; verify lifecycle.handleSubscriptionCreated called
- Mock isolation: WebhookSignatureValidator stubbed; SubscriptionLifecycleManager stubbed

**UTS-011-A2** — Invalid signature → 401 returned, lifecycle NOT called

- Arrange: mock validator.validateSignature() → false
- Act/Assert: controller.handleWebhook(mockReq, payload) returns 401; verify lifecycle NOT called
- Mock isolation: WebhookSignatureValidator stubbed

---

### Module: MOD-012 (WebhookSignatureValidator)

**Parent Architecture Modules**: ARCH-012
**Target Source File(s)**: `src/subscriptions/webhooks/webhook-signature-validator.ts`

---

#### Test Case: UTP-012-A (validateSignature — HMAC SHA-256 verification)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies HMAC-SHA256 signature of webhook payload using shared secret.

**Scenarios:**

**UTS-012-A1** — Valid signature → true returned

- Arrange: mock crypto.timingSafeEqual(Buffer.from('expected-hash'), Buffer.from('received-hash')) → true
- Act: result = validator.validateSignature(payload, 'received-signature', 'webhook-secret')
- Assert: result === true
- Mock isolation: crypto stubbed

**UTS-012-A2** — Signature mismatch → false returned

- Arrange: mock crypto.timingSafeEqual() → false
- Act: result = validator.validateSignature(payload, 'wrong-signature', 'secret')
- Assert: result === false; verify lifecycle NOT called (caller checks this)
- Mock isolation: crypto stubbed

---

### Module: MOD-013 (DataRetentionGuard)

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `src/subscriptions/services/data-retention-guard.ts`

---

#### Test Case: UTP-013-A (canPersistData + enforceRetentionPolicy)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies data retention rules based on subscription tier and age.

**Scenarios:**

**UTS-013-A1** — Premium user → no retention limit

- Arrange: mock userTierRepo.getUserTier() → { tier: 'premium' }; recipeAgeDays = 365
- Act: result = guard.canPersistData('uid', recipeAgeDays)
- Assert: result === true
- Mock isolation: UserTierRepository stubbed

**UTS-013-A2** — Free user, data older than 90 days → false

- Arrange: mock userTierRepo.getUserTier() → { tier: 'free' }; recipeAgeDays = 91
- Act: result = guard.canPersistData('uid', 91)
- Assert: result === false; reason includes 'retention_policy'
- Mock isolation: UserTierRepository stubbed

---

### Module: MOD-014 (TypeScriptStrictLinter)

**Parent Architecture Modules**: ARCH-014
**Target Source File(s)**: `src/shared/linter/typescript-strict.linter.ts` [EXTERNAL]

No unit tests — TypeScript compiler enforcement. Build step verifies strict mode compliance.

---

### Module: MOD-015 (AccessibilityComplianceValidator)

**Parent Architecture Modules**: ARCH-015
**Target Source File(s)**: `src/shared/linter/a11y-compliance-validator.ts` [EXTERNAL]

No unit tests — automated axe-core accessibility scanning. Integration tests cover.

---

### Module: MOD-016 (SubscriptionEventPublisher)

**Parent Architecture Modules**: ARCH-016
**Target Source File(s)**: `src/subscriptions/events/subscription-event.publisher.ts`

---

#### Test Case: UTP-016-A (publishEvent + getRecentEvents)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies events are published to event bus and recent events are queryable.

**Scenarios:**

**UTS-016-A1** — publishEvent → published to bus with correct topic

- Arrange: mock eventBus.publish() → { topic: 'subscription.tier.changed', partition: 0 }
- act: result = await publisher.publishEvent('user.tier.changed', { userId: 'uid', newTier: 'premium' })
- Assert: result.published === true; verify eventBus.publish called with topic 'subscription.tier.changed'
- Mock isolation: EventBus stubbed

**UTS-016-B1** — getRecentEvents for user → returns last N events

- Arrange: mock eventStore.findByUserId() → [{ event: 'tier.changed', createdAt: 'ts' }]
- act: result = await publisher.getRecentEvents('uid', 10)
- Assert: Array.isArray(result); result.length >= 0
- Mock isolation: EventStore stubbed

---

### Module: MOD-017 (SubscriptionWebhookLogger)

**Parent Architecture Modules**: ARCH-017
**Target Source File(s)**: `src/subscriptions/webhooks/subscription-webhook-logger.ts`

---

#### Test Case: UTP-017-A (logWebhookEvent + getWebhookLogs)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies webhook events are logged with correlation ID and queryable by time range.

**Scenarios:**

**UTS-017-A1** — logWebhookEvent → stored with timestamp and correlationId

- Arrange: mock logger.info = jest.fn()
- act: await logger.logWebhookEvent({ eventType: 'subscription.created', receivedAt: 'ts', correlationId: 'corr-123' })
- Assert: verify logger.info called; verify correlationId preserved in log entry
- Mock isolation: Logger stubbed

**UTS-017-A2** — getWebhookLogs with date range → filtered results

- Arrange: mock db.select().from().where() → [{ eventType: 'subscription.created', receivedAt: 'ts' }]
- act: result = await logger.getWebhookLogs('2026-05-01', '2026-05-09')
- Assert: Array.isArray(result); result.length >= 0
- Mock isolation: DrizzleDb stubbed

---

### Module: MOD-018 (UpgradePromptFeaturePreview)

**Parent Architecture Modules**: ARCH-018
**Target Source File(s)**: `src/subscriptions/components/upgrade-prompt-feature-preview.ts`

---

#### Test Case: UTP-018-A (isPreviewEnabled + getPreviewFeatures)

**Technique**: Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies feature preview flags can be toggled per environment.

**Scenarios:**

**UTS-018-A1** — Preview enabled for premium tier users → true returned

- act: result = preview.isPreviewEnabled('ai_generate', 'premium')
- Assert: result === true
- Mock isolation: none

**UTS-018-A2** — Preview disabled for free tier → false returned

- act: result = preview.isPreviewEnabled('ai_generate', 'free')
- Assert: result === false
- Mock isolation: none

---

## ARCH↔MOD↔UTP Traceability

| MOD ID  | MOD Name                         | UTP Count  | UTS Count        |
| ------- | -------------------------------- | ---------- | ---------------- |
| MOD-001 | UserTierRepository               | 1 (A)      | 5 (A1-A5)        |
| MOD-002 | TierAssignmentService            | 1 (A)      | 2 (A1-A2)        |
| MOD-003 | FreeTierEntitlementResolver      | 1 (A)      | 3 (A1-A3)        |
| MOD-004 | PremiumTierEntitlementResolver   | 1 (A)      | 2 (A1-A2)        |
| MOD-005 | FeatureGateMiddleware            | 1 (A)      | 3 (A1-A3)        |
| MOD-006 | FeatureGateRegistry              | 1 (A)      | 3 (A1-A3)        |
| MOD-007 | RecipeVisibilityEnforcer         | 1 (A)      | 3 (A1-A3)        |
| MOD-008 | UpgradePromptComponent           | 1 (A)      | 2 (A1-A2)        |
| MOD-009 | SubscriptionLifecycleManager     | 2 (A, B)   | 4 (A1-A3, B1-B1) |
| MOD-010 | ClerkTierClaimAdapter            | 1 (A)      | 2 (A1-A2)        |
| MOD-011 | SubscriptionWebhookController    | 1 (A)      | 2 (A1-A2)        |
| MOD-012 | WebhookSignatureValidator        | 1 (A)      | 2 (A1-A2)        |
| MOD-013 | DataRetentionGuard               | 1 (A)      | 2 (A1-A2)        |
| MOD-014 | TypeScriptStrictLinter           | [EXTERNAL] | —                |
| MOD-015 | AccessibilityComplianceValidator | [EXTERNAL] | —                |
| MOD-016 | SubscriptionEventPublisher       | 2 (A, B)   | 3 (A1-A1, B1-B1) |
| MOD-017 | SubscriptionWebhookLogger        | 1 (A)      | 2 (A1-A2)        |
| MOD-018 | UpgradePromptFeaturePreview      | 1 (A)      | 2 (A1-A2)        |

## Mock Registry

Each UTP that touches an external dependency MUST list the dependency mock in its setup. Mock entries identify the dependency name, mock type (stub, fake, spy, or in-memory adapter), owning MOD-NNN, and reset behavior between scenarios.

## Coverage Completion Unit Tests

### Module: MOD-014 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-014.

#### Test Case: UTP-014-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-014 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-014-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-014
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-014-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-014
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-015 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-015.

#### Test Case: UTP-015-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-015 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-015-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-015
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-015-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-015
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping
