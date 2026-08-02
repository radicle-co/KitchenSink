# Integration Test Plan: AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/005-ai-integration/v-model/architecture-design.md`

## Overview

This document defines the Integration Test Plan for AI Integration (Commise). Every architecture module in `architecture-design.md` has one or more Test Cases (ITP), and every Test Case has one or more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

Integration tests verify **seams and handshakes between modules**, not internal logic or user journeys. Language is module-boundary-oriented throughout. The feature covers two runtime paths: (1) BYOK in-app recipe generation and (2) external agent OAuth 2.0 API access.

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

## Integration Tests

---

### Module Verification: ARCH-001 (ByokKeyRepository)

**Parent System Components**: SYS-001

> **Revised 2026-08-02.** These cases previously verified that ARCH-001 "encrypts the key, persists it"
> and returns a "decrypted `{ provider, apiKey }` … with the plaintext key intact". That contract was
> rejected (see `module-design.md` MOD-001 and `plan.md` §2.2): ARCH-001 never receives, stores, or
> returns key material. The ARCH-002 → ARCH-001 interface now carries a Secrets Manager **ARN**.

#### Test Case: ITP-001-A (ByokKeyRepository persists and retrieves an ARN reference, never key material)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-001 accepts a `{ userId, provider, secretArn }` payload from ARCH-002, persists it against the composite `(user_id, provider)` key, and returns a record carrying no credential.

- **Integration Scenario: ITS-001-A1**
    - **Given** ARCH-002 ByokService has written the raw key to Secrets Manager and holds `{ userId: ULID, provider: 'openai', secretArn: 'arn:aws:secretsmanager:…' }`
    - **When** ARCH-002 sends the payload to ARCH-001 via `upsertByokKeyRef()`
    - **Then** ARCH-001 returns `{ id, userId, provider: 'openai', secretArn, keyVersion: 1, isActive: true }`, and the returned object contains **no** `apiKey` field

- **Integration Scenario: ITS-001-A2**
    - **Given** ARCH-002 requests the reference for a `userId` that has a stored record
    - **When** ARCH-002 calls ARCH-001 `getByokKeyRef(userId, provider)`
    - **Then** ARCH-001 returns the ARN reference only — resolving it to a key is ARCH-002's responsibility, and ARCH-001 makes no AWS call

- **Integration Scenario: ITS-001-A3**
    - **Given** a record already exists for `(userId, 'openai')`
    - **When** ARCH-002 upserts a new ARN for the **same** provider, then upserts an ARN for `'anthropic'`
    - **Then** the openai row is replaced with `keyVersion` incremented, and the anthropic row is created **alongside** it — proving decision D-005 (one key per provider, up to three concurrently) against the real composite constraint

#### Test Case: ITP-001-B (ByokKeyRepository propagates DatabaseError to ByokService on persistence failure)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-001 surfaces a `DatabaseError` to ARCH-002 when the PostgreSQL write fails, and does not silently swallow it. ARCH-002 depends on this signal to trigger its compensating secret-delete.

- **Integration Scenario: ITS-001-B1**
    - **Given** ARCH-001's PostgreSQL connection is unavailable (simulated connection drop)
    - **When** ARCH-002 sends an `upsertByokKeyRef()` call to ARCH-001
    - **Then** ARCH-001 propagates a `DatabaseError` to ARCH-002 and no partial record is committed

- **Integration Scenario: ITS-001-B2**
    - **Given** the same failure, and ARCH-002 has already written the secret to Secrets Manager
    - **When** ARCH-002 receives the `DatabaseError`
    - **Then** ARCH-002 deletes the just-written secret before rethrowing, leaving **no orphaned key material** that nothing references
    - _Rationale_: without this, every transient DB fault permanently leaks a billable, unreferenced secret.

---

### Module Verification: ARCH-002 (ByokService)

**Parent System Components**: SYS-001

#### Test Case: ITP-002-A (ByokService resolves a key just-in-time from Secrets Manager for RecipeGenerationService)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the credential retrieval chain: ARCH-005 requests credentials from ARCH-002, which reads the ARN via ARCH-001, fetches the key from Secrets Manager, and returns `{ provider, apiKey }` to ARCH-005.

- **Integration Scenario: ITS-002-A1**
    - **Given** ARCH-001 holds an ARN reference for `userId` and Secrets Manager holds the corresponding key
    - **When** ARCH-005 RecipeGenerationService calls ARCH-002 `resolvePreferredProvider(userId)`
    - **Then** ARCH-002 returns `{ provider: 'openai', apiKey: '<fetched from Secrets Manager>' }` to ARCH-005, having made exactly **one** `getSecretValue` call, and retains the key on no field after returning

- **Integration Scenario: ITS-002-A2**
    - **Given** the ARN row exists but the secret has been deleted out-of-band
    - **When** ARCH-005 calls ARCH-002 `resolvePreferredProvider(userId)`
    - **Then** ARCH-002 raises `ByokSecretMissingError` (a data-integrity fault), **not** `NoProviderConfiguredError`
    - _Rationale_: conflating the two would route a real inconsistency into the "please configure a provider" flow, hiding it permanently.

#### Test Case: ITP-002-B (ByokService emits NoProviderConfiguredError to RecipeGenerationService when no key is set)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-002 emits `NoProviderConfiguredError` to ARCH-005 when no credential record exists, triggering the setup-required path via ARCH-003.

- **Integration Scenario: ITS-002-B1**
    - **Given** ARCH-001 has no credential record for the requesting `userId`
    - **When** ARCH-005 calls ARCH-002 `resolvePreferredProvider(userId)`
    - **Then** ARCH-002 emits `NoProviderConfiguredError` to ARCH-005, which routes the error to ARCH-003 ProviderSetupGuide, and **no** Secrets Manager call is made

---

### Module Verification: ARCH-003 (ProviderSetupGuide)

**Parent System Components**: SYS-001

#### Test Case: ITP-003-A (ProviderSetupGuide returns structured setup-required payload to RecipeGenerationService)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-003 receives a `NoProviderConfiguredError` from ARCH-005 and returns a structured `422 + setup-required` payload conforming to the defined output contract.

- **Integration Scenario: ITS-003-A1**
    - **Given** ARCH-005 RecipeGenerationService has received `NoProviderConfiguredError` from ARCH-002
    - **When** ARCH-005 forwards the error to ARCH-003 ProviderSetupGuide
    - **Then** ARCH-003 returns `{ status: 422, body: { type: 'setup-required', providers: [...] } }` to ARCH-005 for propagation to the client

- **Integration Scenario: ITS-003-A2**
    - **Given** ARCH-003 is invoked with a valid `userId` context
    - **When** ARCH-005 requests the setup-required response from ARCH-003
    - **Then** ARCH-003 returns a payload listing all supported provider types (`openai`, `gemini`, `anthropic`) without any credential data

---

### Module Verification: ARCH-004 (AIProviderAdapter)

**Parent System Components**: SYS-002

#### Test Case: ITP-004-A (AIProviderAdapter maps GenerationRequest to provider-specific payload and returns RecipeDraft to RecipeGenerationService)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-004 accepts a normalized `GenerationRequest` from ARCH-005, maps it to the provider-specific HTTP payload, and returns a `RecipeDraft` conforming to `{ title, ingredients[], instructions[] }`.

- **Integration Scenario: ITS-004-A1**
    - **Given** ARCH-005 holds `{ provider: 'openai', apiKey: '<key>', criteria: GenerationRequest }` and the external OpenAI endpoint is stubbed to return a valid response
    - **When** ARCH-005 sends the payload to ARCH-004 `dispatch(GenerationRequest)`
    - **Then** ARCH-004 returns `RecipeDraft { title: string, ingredients: string[], instructions: string[] }` to ARCH-005 within 15 seconds

#### Test Case: ITP-004-B (AIProviderAdapter enforces 15-second timeout and propagates TimeoutError to RecipeGenerationService)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-004 enforces the 15-second timeout and propagates a `TimeoutError` to ARCH-005 when the external provider does not respond in time.

- **Integration Scenario: ITS-004-B1**
    - **Given** the external AI provider endpoint is stubbed to delay response beyond 15 seconds
    - **When** ARCH-005 sends a `dispatch(GenerationRequest)` call to ARCH-004
    - **Then** ARCH-004 propagates a `TimeoutError` to ARCH-005 after exactly 15 seconds, with no partial `RecipeDraft` returned

- **Integration Scenario: ITS-004-B2**
    - **Given** the external AI provider returns a malformed response (missing `instructions` field)
    - **When** ARCH-004 receives the malformed payload from the provider
    - **Then** ARCH-004 propagates a structured `ProviderResponseError` to ARCH-005 rather than returning an incomplete `RecipeDraft`

---

### Module Verification: ARCH-005 (RecipeGenerationService)

**Parent System Components**: SYS-002

#### Test Case: ITP-005-A (RecipeGenerationService orchestrates the full BYOK generation chain: ARCH-016 → ARCH-002 → ARCH-004 → ARCH-006)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the end-to-end data flow through ARCH-005: premium check via ARCH-016, credential fetch via ARCH-002, provider dispatch via ARCH-004, and `RecipeDraft` delivery to ARCH-006.

- **Integration Scenario: ITS-005-A1**
    - **Given** ARCH-016 returns `isPremium: true` for the `userId`, ARCH-002 returns valid credentials, and ARCH-004 returns a valid `RecipeDraft`
    - **When** ARCH-015 delivers `{ userId, criteria }` to ARCH-005
    - **Then** ARCH-005 passes `RecipeDraft` to ARCH-006 RecipePreviewController with no data loss or transformation

#### Test Case: ITP-005-B (RecipeGenerationService halts and propagates NotPremiumError when ARCH-016 denies entitlement)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-005 does not proceed to credential fetch or provider dispatch when ARCH-016 returns `NotPremiumError`.

- **Integration Scenario: ITS-005-B1**
    - **Given** ARCH-016 PremiumEntitlementGuard returns `NotPremiumError` for the `userId`
    - **When** ARCH-015 delivers `{ userId, criteria }` to ARCH-005
    - **Then** ARCH-005 propagates `NotPremiumError` (HTTP 402) to the client without calling ARCH-002 or ARCH-004

---

### Module Verification: ARCH-006 (RecipePreviewController)

**Parent System Components**: SYS-003

#### Test Case: ITP-006-A (RecipePreviewController routes accepted RecipeDraft to RecipePersistenceAdapter)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-006 forwards `{ userId, recipeDraft, source: 'ai' }` to ARCH-007 when the user action is `accept`, and that ARCH-007 returns a `recipeId`.

- **Integration Scenario: ITS-006-A1**
    - **Given** ARCH-005 has delivered a `RecipeDraft` to ARCH-006 and the user action resolves to `accept`
    - **When** ARCH-006 sends `{ userId, recipeDraft, source: 'ai' }` to ARCH-007
    - **Then** ARCH-007 returns `{ recipeId: UUID }` to ARCH-006, which propagates it to the client

#### Test Case: ITP-006-B (RecipePreviewController discards RecipeDraft without calling RecipePersistenceAdapter on decline)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-006 does not invoke ARCH-007 when the user action is `decline`, ensuring no unintended persistence.

- **Integration Scenario: ITS-006-B1**
    - **Given** ARCH-005 has delivered a `RecipeDraft` to ARCH-006 and the user action resolves to `decline`
    - **When** ARCH-006 processes the decline action
    - **Then** ARCH-006 does not send any payload to ARCH-007 and returns a discard confirmation to the client

---

### Module Verification: ARCH-007 (RecipePersistenceAdapter)

**Parent System Components**: SYS-003, SYS-005

#### Test Case: ITP-007-A (RecipePersistenceAdapter persists AI-sourced recipe with correct ownership metadata)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-007 maps `{ userId, recipeDraft, source: 'ai' }` to a Recipe entity with `ownerId = userId`, `isPrivate: true`, `source: 'ai'`, and returns a valid `recipeId`.

- **Integration Scenario: ITS-007-A1**
    - **Given** ARCH-006 sends `{ userId: UUID, recipeDraft: RecipeDraft, source: 'ai' }` to ARCH-007
    - **When** ARCH-007 persists the entity to the Recipe repository
    - **Then** ARCH-007 returns `{ recipeId: UUID }` to ARCH-006 and the stored entity has `ownerId = userId`, `isPrivate: true`, `source: 'ai'`

#### Test Case: ITP-007-B (RecipePersistenceAdapter persists agent-sourced recipe with correct source metadata)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-007 correctly handles `source: 'agent'` payloads from ARCH-012, setting the correct `source` field on the persisted entity.

- **Integration Scenario: ITS-007-B1**
    - **Given** ARCH-012 AgentRecipeCreateController sends `{ userId: UUID, recipeDraft: RecipeDraft, source: 'agent' }` to ARCH-007
    - **When** ARCH-007 persists the entity
    - **Then** ARCH-007 returns `{ recipeId: UUID }` to ARCH-012 and the stored entity has `source: 'agent'`

#### Test Case: ITP-007-C (RecipePersistenceAdapter propagates DatabaseError to calling module on write failure)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-007 propagates `DatabaseError` to the calling module (ARCH-006 or ARCH-012) when the PostgreSQL write fails.

- **Integration Scenario: ITS-007-C1**
    - **Given** the Recipe repository's PostgreSQL connection is unavailable
    - **When** ARCH-006 sends a persist request to ARCH-007
    - **Then** ARCH-007 propagates `DatabaseError` to ARCH-006 and no partial entity is committed

---

### Module Verification: ARCH-008 (OAuthAuthorizationServer)

**Parent System Components**: SYS-004

#### Test Case: ITP-008-A (OAuthAuthorizationServer issues authorization code and exchanges it for RS256 JWT access token)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the two-step OAuth 2.0 handshake: ARCH-008 issues an authorization code after consent, then exchanges it for an RS256 JWT access token with the correct scopes.

- **Integration Scenario: ITS-008-A1**
    - **Given** ARCH-009 AgentConsentManager has stored a consent grant for `{ userId, clientId, scopes: ['recipes:create'] }`
    - **When** an external agent sends `POST /oauth/token { code, client_secret }` to ARCH-008
    - **Then** ARCH-008 returns `{ access_token: RS256JWT, token_type: 'Bearer', expires_in: number, scope: 'recipes:create' }` to the agent

- **Integration Scenario: ITS-008-A2**
    - **Given** an external agent presents an authorization code that has expired (TTL > 60 seconds)
    - **When** the agent sends `POST /oauth/token { code, client_secret }` to ARCH-008
    - **Then** ARCH-008 returns HTTP 400 `{ error: 'invalid_grant' }` and does not issue an access token

#### Test Case: ITP-008-B (OAuthAuthorizationServer rejects mismatched redirect_uri)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-008 rejects authorization requests where `redirect_uri` does not match the pre-registered URI.

- **Integration Scenario: ITS-008-B1**
    - **Given** an external agent sends `GET /oauth/authorize` with a `redirect_uri` that does not match the registered URI for `client_id`
    - **When** ARCH-008 processes the authorization request
    - **Then** ARCH-008 returns HTTP 400 `{ error: 'invalid_redirect_uri' }` without issuing an authorization code

---

### Module Verification: ARCH-009 (AgentConsentManager)

**Parent System Components**: SYS-004

#### Test Case: ITP-009-A (AgentConsentManager stores consent grant and makes it retrievable by OAuthAuthorizationServer)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-009 persists a consent grant when ARCH-008 calls `StoreConsentGrant()`, and that the grant is retrievable for subsequent token operations.

- **Integration Scenario: ITS-009-A1**
    - **Given** a user has approved the consent screen for `{ clientId, scopes: ['recipes:read', 'recipes:create'] }`
    - **When** ARCH-008 calls ARCH-009 `StoreConsentGrant(userId, clientId, scopes)`
    - **Then** ARCH-009 persists the grant and returns a success acknowledgment to ARCH-008

#### Test Case: ITP-009-B (AgentConsentManager revocation invalidates all tokens for the agent authorization)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-009 revocation causes ARCH-010 to reject subsequent token validations for the revoked agent.

- **Integration Scenario: ITS-009-B1**
    - **Given** a consent grant exists for `{ userId, clientId }` and a valid access token has been issued
    - **When** ARCH-009 processes a revocation request for `{ userId, clientId }`
    - **Then** ARCH-009 invalidates the grant and subsequent calls from ARCH-010 `ValidateToken()` for that token return `UnauthorizedError`

---

### Module Verification: ARCH-010 (AgentTokenValidator)

**Parent System Components**: SYS-004, SYS-005

#### Test Case: ITP-010-A (AgentTokenValidator extracts userId and scopes from valid RS256 JWT and delivers them to AgentRecipeReadController and AgentRecipeCreateController)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-010 validates a Bearer token and returns `{ userId, scopes[] }` to ARCH-011 or ARCH-012 in the correct format.

- **Integration Scenario: ITS-010-A1**
    - **Given** ARCH-011 AgentRecipeReadController receives a request with a valid RS256 Bearer token containing `scopes: ['recipes:read']`
    - **When** ARCH-011 calls ARCH-010 `ValidateToken(bearerToken)`
    - **Then** ARCH-010 returns `{ userId: UUID, scopes: ['recipes:read'] }` to ARCH-011

#### Test Case: ITP-010-B (AgentTokenValidator returns UnauthorizedError to calling controller for invalid or expired tokens)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-010 returns `UnauthorizedError` to ARCH-011 or ARCH-012 for expired, malformed, or revoked tokens.

- **Integration Scenario: ITS-010-B1**
    - **Given** ARCH-012 receives a request with an expired RS256 Bearer token
    - **When** ARCH-012 calls ARCH-010 `ValidateToken(expiredToken)`
    - **Then** ARCH-010 returns `UnauthorizedError` to ARCH-012, which propagates HTTP 401 to the agent

- **Integration Scenario: ITS-010-B2**
    - **Given** ARCH-011 receives a request with a token whose consent has been revoked via ARCH-009
    - **When** ARCH-011 calls ARCH-010 `ValidateToken(revokedToken)`
    - **Then** ARCH-010 returns `UnauthorizedError` to ARCH-011

---

### Module Verification: ARCH-011 (AgentRecipeReadController)

**Parent System Components**: SYS-005

#### Test Case: ITP-011-A (AgentRecipeReadController validates recipes:read scope via AgentTokenValidator before returning recipe collection)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-011 calls ARCH-010 for token validation, and only proceeds to fetch the recipe collection when `recipes:read` scope is confirmed.

- **Integration Scenario: ITS-011-A1**
    - **Given** an external agent sends `POST /api/v1/ai/mcp` → `recipes_list` with a valid token containing `scopes: ['recipes:read']`
    - **When** ARCH-011 calls ARCH-010 `ValidateToken()` and receives `{ userId, scopes: ['recipes:read'] }`
    - **Then** ARCH-011 fetches the user's recipe collection and returns structured JSON to the agent

#### Test Case: ITP-011-B (AgentRecipeReadController rejects request when token lacks recipes:read scope)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-011 returns HTTP 403 when ARCH-010 confirms the token is valid but lacks `recipes:read` scope.

- **Integration Scenario: ITS-011-B1**
    - **Given** an external agent sends `POST /api/v1/ai/mcp` → `recipes_list` with a token containing only `scopes: ['recipes:create']`
    - **When** ARCH-011 calls ARCH-010 and receives `{ userId, scopes: ['recipes:create'] }`
    - **Then** ARCH-011 returns HTTP 403 `{ error: 'insufficient_scope' }` to the agent without fetching any recipe data

---

### Module Verification: ARCH-012 (AgentRecipeCreateController)

**Parent System Components**: SYS-005

#### Test Case: ITP-012-A (AgentRecipeCreateController validates recipes:create scope and delegates persistence to RecipePersistenceAdapter)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the agent recipe creation data flow: ARCH-010 validates scope, ARCH-012 validates the `RecipeDraft` schema, and ARCH-007 persists the entity, returning `recipeId`.

- **Integration Scenario: ITS-012-A1**
    - **Given** an external agent sends `POST /api/v1/ai/mcp` → `recipe_save` with a valid token (`scopes: ['recipes:create']`) and a well-formed `RecipeDraft`
    - **When** ARCH-012 calls ARCH-010 for validation and receives `{ userId, scopes: ['recipes:create'] }`, then sends `{ userId, recipeDraft, source: 'agent' }` to ARCH-007
    - **Then** ARCH-007 returns `{ recipeId: UUID }` to ARCH-012, which returns HTTP 201 `{ recipeId }` to the agent

#### Test Case: ITP-012-B (AgentRecipeCreateController rejects malformed RecipeDraft before calling RecipePersistenceAdapter)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-012 validates the `RecipeDraft` schema and does not forward malformed payloads to ARCH-007.

- **Integration Scenario: ITS-012-B1**
    - **Given** an external agent sends `POST /api/v1/ai/mcp` → `recipe_save` with a valid token but a `RecipeDraft` missing the required `title` field
    - **When** ARCH-012 validates the payload schema
    - **Then** ARCH-012 returns HTTP 400 `{ error: 'invalid_recipe_draft' }` to the agent without calling ARCH-007

---

### Module Verification: ARCH-013 (InstructionOptimizerService)

**Parent System Components**: SYS-006

#### Test Case: ITP-013-A (InstructionOptimizerService orchestrates optimization chain: ARCH-016 → ARCH-002 → ARCH-004 → ARCH-014)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the optimization data flow: ARCH-013 checks premium entitlement via ARCH-016, fetches credentials via ARCH-002, dispatches to ARCH-004 in optimization mode, and delivers `optimizedInstructions[]` to ARCH-014.

- **Integration Scenario: ITS-013-A1**
    - **Given** ARCH-016 returns `isPremium: true`, ARCH-002 returns valid credentials, and ARCH-004 returns `optimizedInstructions[]`
    - **When** ARCH-015 delivers `{ userId, recipeId }` to ARCH-013
    - **Then** ARCH-013 passes `optimizedInstructions[]` to ARCH-014 OptimizationReviewController with no data loss

#### Test Case: ITP-013-B (InstructionOptimizerService halts and propagates NotPremiumError when ARCH-016 denies entitlement)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-013 does not proceed to credential fetch or provider dispatch when ARCH-016 returns `NotPremiumError`.

- **Integration Scenario: ITS-013-B1**
    - **Given** ARCH-016 returns `NotPremiumError` for the `userId`
    - **When** ARCH-015 delivers `{ userId, recipeId }` to ARCH-013
    - **Then** ARCH-013 propagates HTTP 402 to the client without calling ARCH-002 or ARCH-004

---

### Module Verification: ARCH-014 (OptimizationReviewController)

**Parent System Components**: SYS-006

#### Test Case: ITP-014-A (OptimizationReviewController routes accepted optimizedInstructions to RecipePersistenceAdapter as a patch)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-014 sends a patch request to ARCH-007 with `optimizedInstructions[]` when the user action is `accept`, and ARCH-007 returns the updated `recipeId`.

- **Integration Scenario: ITS-014-A1**
    - **Given** ARCH-013 has delivered `optimizedInstructions[]` to ARCH-014 and the user action resolves to `accept`
    - **When** ARCH-014 sends `{ userId, recipeId, optimizedInstructions, source: 'ai' }` to ARCH-007 as a patch
    - **Then** ARCH-007 returns `{ recipeId: UUID }` to ARCH-014, confirming the instructions were updated

#### Test Case: ITP-014-B (OptimizationReviewController discards optimizedInstructions without calling RecipePersistenceAdapter on reject)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-014 does not invoke ARCH-007 when the user action is `reject`.

- **Integration Scenario: ITS-014-B1**
    - **Given** ARCH-013 has delivered `optimizedInstructions[]` to ARCH-014 and the user action resolves to `reject`
    - **When** ARCH-014 processes the reject action
    - **Then** ARCH-014 does not send any payload to ARCH-007 and returns a discard confirmation to the client

---

### Module Verification: ARCH-015 (AuthGuardMiddleware) [CROSS-CUTTING]

**Parent System Components**: SYS-007

#### Test Case: ITP-015-A (AuthMiddleware attaches userId to request context and passes to downstream modules on valid Clerk session token)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-015 verifies a Clerk session token networklessly (via `verifyToken` with the public `CLERK_JWT_KEY`, enforcing `azp`), extracts `userId`, attaches it to the request context, and passes the enriched context to the downstream module (e.g., ARCH-005, ARCH-013).

- **Integration Scenario: ITS-015-A1**
    - **Given** an inbound HTTP request carries a valid Clerk session token in the Authorization header
    - **When** ARCH-015 processes the request before forwarding to ARCH-005 RecipeGenerationService
    - **Then** ARCH-015 attaches `{ userId: UUID }` to the request context and passes the request to ARCH-005

#### Test Case: ITP-015-B (AuthGuardMiddleware returns HTTP 401 and halts request propagation for unauthenticated requests)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-015 returns HTTP 401 and does not forward the request to any downstream module when the JWT is absent or invalid.

- **Integration Scenario: ITS-015-B1**
    - **Given** an inbound HTTP request has no Authorization header
    - **When** ARCH-015 processes the request
    - **Then** ARCH-015 returns HTTP 401 `UnauthorizedError` to the client and does not invoke ARCH-005, ARCH-013, or any other downstream module

- **Integration Scenario: ITS-015-B2**
    - **Given** an inbound HTTP request carries a malformed or expired Clerk session token
    - **When** ARCH-015 validates the token
    - **Then** ARCH-015 returns HTTP 401 and halts request propagation

#### Test Case: ITP-015-C (AuthGuardMiddleware handles concurrent requests without userId cross-contamination)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-015 correctly isolates `userId` per request context under concurrent load, preventing cross-contamination between simultaneous requests.

- **Integration Scenario: ITS-015-C1**
    - **Given** two concurrent HTTP requests arrive simultaneously, each carrying a different valid Clerk session token for different users (userId-A and userId-B)
    - **When** ARCH-015 processes both requests concurrently
    - **Then** each downstream module receives the correct `userId` for its respective request, with no cross-contamination between userId-A and userId-B

---

### Module Verification: ARCH-016 (PremiumEntitlementGuard) [CROSS-CUTTING]

**Parent System Components**: SYS-002, SYS-006, SYS-008

#### Test Case: ITP-016-A (PremiumEntitlementGuard returns isPremium: true to RecipeGenerationService and InstructionOptimizerService for premium users)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-016 returns `isPremium: true` to ARCH-005 and ARCH-013 when the `010-subscriptions` integration confirms an active premium subscription.

- **Integration Scenario: ITS-016-A1**
    - **Given** the `010-subscriptions` integration returns an active premium subscription for `userId`
    - **When** ARCH-005 calls ARCH-016 `CheckPremium(userId)`
    - **Then** ARCH-016 returns `{ isPremium: true }` to ARCH-005, allowing generation to proceed

#### Test Case: ITP-016-B (PremiumEntitlementGuard propagates NotPremiumError to calling module for non-premium users)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-016 propagates `NotPremiumError` (HTTP 402) to ARCH-005 or ARCH-013 when the user does not hold an active premium subscription.

- **Integration Scenario: ITS-016-B1**
    - **Given** the `010-subscriptions` integration returns no active premium subscription for `userId`
    - **When** ARCH-013 calls ARCH-016 `CheckPremium(userId)`
    - **Then** ARCH-016 propagates `NotPremiumError` to ARCH-013, which returns HTTP 402 to the client

#### Test Case: ITP-016-C (PremiumEntitlementGuard handles concurrent entitlement checks without race conditions)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that ARCH-016 correctly handles simultaneous entitlement checks from ARCH-005 and ARCH-013 for the same `userId` without returning inconsistent results.

- **Integration Scenario: ITS-016-C1**
    - **Given** ARCH-005 and ARCH-013 simultaneously call ARCH-016 `CheckPremium(userId)` for the same user
    - **When** both calls are processed concurrently
    - **Then** both calls receive the same consistent `isPremium` result and neither call blocks or corrupts the other's response

---

### Module Verification: ARCH-017 (TypeSafetyAndA11yEnforcer) [CROSS-CUTTING]

**Parent System Components**: SYS-008

#### Test Case: ITP-017-A (TypeSafetyAndA11yEnforcer compile-time enforcement rejects TypeScript strict violations at module boundaries)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-017's `tsc --strict` enforcement catches type mismatches at module boundaries (e.g., `any`-typed payloads crossing ARCH boundaries) at compile time.

- **Integration Scenario: ITS-017-A1**
    - **Given** a module boundary call (e.g., ARCH-005 → ARCH-004) uses an `any`-typed `GenerationRequest` parameter instead of the typed interface
    - **When** ARCH-017 runs `tsc --strict` across the source files
    - **Then** ARCH-017 emits a `TSError` identifying the boundary violation, and the build fails with a non-zero exit code

#### Test Case: ITP-017-B (TypeSafetyAndA11yEnforcer lint-time enforcement rejects no-any violations in module interface files)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-017's ESLint `no-any` rule rejects `any` usage in module interface definitions, preventing type-unsafe contracts from reaching runtime.

- **Integration Scenario: ITS-017-B1**
    - **Given** a module interface file introduces an `any`-typed parameter in a public method signature
    - **When** ARCH-017 runs ESLint with the `no-any` rule enabled
    - **Then** ARCH-017 reports a lint error for the offending interface file and the CI check fails

---

## Test Harness & Mocking Strategy

| Test Case | External Dependency                | Mock/Stub Strategy                                        | Rationale                                                         |
| --------- | ---------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| ITP-001-A | PostgreSQL (ByokKeyRepository)     | In-memory test database (pg-mem or testcontainers)        | Isolates ARCH-001↔ARCH-002 boundary from production DB            |
| ITP-001-B | PostgreSQL connection              | Stub: connection pool throws `DatabaseError`              | Simulates DB failure without infrastructure dependency            |
| ITP-004-A | External AI provider HTTP endpoint | HTTP stub (nock / msw): returns valid provider response   | Isolates ARCH-004 from live provider; deterministic response      |
| ITP-004-B | External AI provider HTTP endpoint | HTTP stub: delays response > 15 s                         | Triggers timeout path without real network dependency             |
| ITP-008-A | RS256 key pair                     | Test key pair generated at test setup                     | Enables JWT signing/verification without production secrets       |
| ITP-009-B | Token store / consent grant store  | In-memory store with revocation flag                      | Simulates revocation without persistent storage                   |
| ITP-010-B | RS256 key pair + consent store     | Expired test JWT + revoked grant stub                     | Covers both expiry and revocation paths                           |
| ITP-015-C | Clerk session-token validation     | Spy on request context assignment; concurrent test runner | Verifies per-request isolation under concurrency                  |
| ITP-016-C | `010-subscriptions` integration    | Fake: returns consistent `isPremium` for concurrent calls | Verifies no race condition in entitlement check                   |
| ITP-017-A | TypeScript compiler (`tsc`)        | Real compiler invoked in CI; no mock needed               | Compile-time enforcement requires actual `tsc --strict` execution |
| ITP-017-B | ESLint                             | Real ESLint invoked in CI; no mock needed                 | Lint-time enforcement requires actual ESLint run                  |

---

## Coverage Summary

| Metric                            | Count          |
| --------------------------------- | -------------- |
| Total Architecture Modules (ARCH) | 17             |
| Total Test Cases (ITP)            | 36             |
| Total Scenarios (ITS)             | 42             |
| Modules with ≥1 ITP               | 17 / 17 (100%) |
| Test Cases with ≥1 ITS            | 36 / 36 (100%) |
| **Overall Coverage (ARCH→ITP)**   | **100%**       |

### Technique Distribution

| Technique                            | Test Cases | Percentage |
| ------------------------------------ | ---------- | ---------- |
| Interface Contract Testing           | 13         | 36%        |
| Data Flow Testing                    | 5          | 14%        |
| Interface Fault Injection            | 16         | 44%        |
| Concurrency & Race Condition Testing | 2          | 6%         |

## Uncovered Modules

None — full coverage achieved.
