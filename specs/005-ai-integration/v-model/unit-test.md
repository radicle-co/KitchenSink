# Unit Test Plan: AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/005-ai-integration/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for the AI Integration feature. Every module design (`MOD-NNN`) in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

Unit tests verify **internal module logic** — control flow, data transformations, state transitions, and variable boundaries. They do NOT test module boundaries (integration), user journeys (acceptance), or system-level behavior (system tests).

## ID Schema

- **Unit Test Case**: `UTP-{NNN}-{X}` — where NNN matches the parent MOD, X is a letter suffix (A, B, C...)
- **Unit Test Scenario**: `UTS-{NNN}-{X}{#}` — nested under the parent UTP, with numeric suffix (1, 2, 3...)
- Example: `UTS-001-A1` → Scenario 1 of Test Case A verifying MOD-001
- ID lineage: from `UTS-001-A1`, a regex extracts `UTP-001-A` and `MOD-001`. To find the `ARCH-NNN` ancestor, consult the "Parent Architecture Modules" field in `module-design.md`.

## ISO 29119-4 White-Box Techniques

Each test case MUST identify its technique by name and anchor to a specific module design view:

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

### Module: MOD-001 (ProviderConfigRepository — CRUD Operations)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `src/ai/provider-config/provider-config.repository.ts`

---

#### Test Case: UTP-001-A (upsertProviderConfig — encryption + DB upsert)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis
**Target View**: Algorithmic/Logic View
**Description**: Verifies upsertProviderConfig encrypts the API key with AES-256-GCM (unique IV per write), executes the upsert SQL, and returns the full record. Also verifies validation errors are thrown before any I/O.

**Scenarios:**

**UTS-001-A1** — Valid upsert → encrypted payload stored, record returned with masked key in response

- Arrange: mock db.query() → { userId: 'uid', provider: 'openai', encryptedApiKey: 'iv:tag:cipher', updatedAt: 'ts' }; mock crypto.randomBytes(12) → Buffer.alloc(12)
- Act: result = await repo.upsertProviderConfig('uid', 'openai', 'sk-test-key-123')
- Assert: result.provider === 'openai'; verify db.query called once with SQL containing 'INSERT INTO provider_configs'; verify encrypt called
- Mock isolation: db.query, crypto stubbed

**UTS-001-A2** — userId null → ValidationError thrown before DB call

- Arrange: userId = null; provider = 'openai'; apiKey = 'key'
- Act/Assert: upsertProviderConfig(null, 'openai', 'key') throws ValidationError with message 'userId required'; verify db.query NOT called
- Mock isolation: none

**UTS-001-A3** — Invalid provider enum → ValidationError thrown before DB call

- Arrange: provider = 'unknown-provider'
- Act/Assert: upsertProviderConfig('uid', 'unknown-provider', 'key') throws ValidationError; verify db.query NOT called
- Mock isolation: none

**UTS-001-A4** — Empty apiKey → ValidationError thrown before DB call

- Arrange: apiKey = ''
- Act/Assert: upsertProviderConfig('uid', 'openai', '') throws ValidationError; verify db.query NOT called
- Mock isolation: none

---

#### Test Case: UTP-001-B (getProviderConfig — decryption + get, or null)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies getProviderConfig queries DB, decrypts the stored payload using the stored IV/authTag, and returns decrypted apiKey alongside row data. Returns null if no row found.

**Scenarios:**

**UTS-001-B1** — Row found → decrypted apiKey returned

- Arrange: mockDbRow = { userId: 'uid', provider: 'openai', encrypted_api_key: 'ivHex:tagHex:cipherText', updatedAt: 'ts' }; mock db.query() → mockDbRow
- Act: result = await repo.getProviderConfig('uid', 'openai')
- Assert: result !== null; result.apiKey === 'decrypted-key'; verify decipher.setAuthTag called
- Mock isolation: db.query stubbed

**UTS-001-B2** — Row not found → null returned

- Arrange: mock db.query() → null
- Act: result = await repo.getProviderConfig('uid', 'openai')
- Assert: result === null; verify decrypt NOT called
- Mock isolation: db.query stubbed

**UTS-001-B3** — GCM auth tag mismatch → DecryptionError propagated

- Arrange: mockDbRow = { encrypted_api_key: 'ivHex:badTagHex:cipherText' }; mock db.query() → mockDbRow; mock createDecipheriv().setAuthTag() → throws
- Act/Assert: getProviderConfig('uid', 'openai') throws DecryptionError; verify db.query called
- Mock isolation: db.query, crypto stubbed

---

### Module: MOD-002 (ProviderConfigService — Credential Lifecycle Orchestrator)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `src/ai/provider-config/provider-config.service.ts`

---

#### Test Case: UTP-002-A (saveProviderCredentials + listProviderCredentials — masking)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies saveProviderCredentials calls repository and returns masked config (never raw key). listProviderCredentials returns all configs with fully masked keys.

**Scenarios:**

**UTS-002-A1** — saveProviderCredentials → masked response with '\*\*\*\*' prefix + last 4 chars

- Arrange: mock repo.upsertProviderConfig() → { userId: 'uid', provider: 'openai', updatedAt: 'ts' }
- Act: result = await service.saveProviderCredentials('uid', 'openai', 'sk-real-key-abcdef')
- Assert: result.apiKeyMasked === '\*\*\*\*cdef'; result.provider === 'openai'; raw key not in result
- Mock isolation: ProviderConfigRepository stubbed

**UTS-002-A2** — Unsupported provider → ValidationError thrown

- Arrange: provider = 'unknown'
- Act/Assert: saveProviderCredentials('uid', 'unknown', 'key') throws ValidationError
- Mock isolation: none

**UTS-002-A3** — listProviderCredentials → all configs masked, apiKey fully redacted

- Arrange: mock repo.listProviderConfigs() → [{ userId: 'uid', provider: 'openai', updatedAt: 'ts' }, { userId: 'uid', provider: 'gemini', updatedAt: 'ts' }]
- Act: result = await service.listProviderCredentials('uid')
- Assert: result.length === 2; result[0].apiKeyMasked === '\***\*'; result[1].apiKeyMasked === '\*\***'
- Mock isolation: ProviderConfigRepository stubbed

---

#### Test Case: UTP-002-B (getProviderCredentials — priority fallback)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies getProviderCredentials iterates providers in priority order (openai → gemini → anthropic) and returns first found. Throws NoProviderConfiguredError if none configured.

**Scenarios:**

**UTS-002-B1** — openai configured → returns openai credentials immediately

- Arrange: mock repo.getProviderConfig('uid', 'openai') → { provider: 'openai', apiKey: 'openai-key' }
- Act: result = await service.getProviderCredentials('uid')
- Assert: result.provider === 'openai'; result.apiKey === 'openai-key'; verify repo.getProviderConfig called only for 'openai'
- Mock isolation: ProviderConfigRepository stubbed

**UTS-002-B2** — openai not configured, gemini is → returns gemini credentials

- Arrange: mock repo.getProviderConfig('uid', 'openai') → null; mock repo.getProviderConfig('uid', 'gemini') → { provider: 'gemini', apiKey: 'gemini-key' }
- Act: result = await service.getProviderCredentials('uid')
- Assert: result.provider === 'gemini'; verify repo.getProviderConfig called for both 'openai' and 'gemini' (not 'anthropic')
- Mock isolation: ProviderConfigRepository stubbed

**UTS-002-B3** — No provider configured for user → NoProviderConfiguredError

- Arrange: mock repo.getProviderConfig('uid', 'openai') → null; mock repo.getProviderConfig('uid', 'gemini') → null; mock repo.getProviderConfig('uid', 'anthropic') → null
- Act/Assert: service.getProviderCredentials('uid') throws NoProviderConfiguredError
- Mock isolation: ProviderConfigRepository stubbed

---

### Module: MOD-003 (ProviderSetupGuide — Setup Payload Generator)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `src/ai/provider-config/provider-setup-guide.service.ts`

---

#### Test Case: UTP-003-A (generateSetupPayload — always succeeds, no I/O)

**Technique**: Strict Isolation
**Target View**: Algorithmic/Logic View
**Description**: Verifies generateSetupPayload always succeeds and returns a structured payload with all three providers and their setup links.

**Scenarios:**

**UTS-003-A1** — generateSetupPayload returns correct structure and providers

- Act: result = generateSetupPayload('any-user-id')
- Assert: result.setupRequired === true; result.supportedProviders.includes('openai'); result.supportedProviders.includes('gemini'); result.supportedProviders.includes('anthropic'); result.setupLinks.openai === 'https://platform.openai.com/api-keys'
- Mock isolation: none (pure function, no I/O)

**UTS-003-A2** — Returns string message (not empty)

- Assert: result.message.length > 0; result.message includes 'AI provider'
- Mock isolation: none

---

### Module: MOD-004 (AIProviderAdapter — Provider Dispatch & Response Normalization)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `src/ai/provider-adapter.ts`

---

#### Test Case: UTP-004-A (dispatch — routes to correct provider and normalizes response)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies dispatch routes to the correct provider SDK based on provider enum, calls the appropriate API, and normalizes the RecipeDraft response.

**Scenarios:**

**UTS-004-A1** — openai dispatch → OpenAI SDK called, response normalized to RecipeDraft

- Arrange: mock openaiClient.createChatCompletion() → { title: 'Test Recipe', ingredients: ['1 cup flour'], instructions: ['Mix'], estimatedCalories: 450 }; mock normalizeOpenAIResponse() → mockDraft
- Act: result = await adapter.dispatch('openai', 'sk-test', mockCriteria)
- Assert: result.title === 'Test Recipe'; result.ingredients.length === 1; verify openaiClient.createChatCompletion called once
- Mock isolation: OpenAI client stubbed; normalizeOpenAIResponse stubbed

**UTS-004-A2** — gemini dispatch → Gemini SDK called

- Arrange: mock geminiClient.generateContent() → mockResponse; mock normalizeGeminiResponse() → mockDraft
- Act: result = await adapter.dispatch('gemini', 'gemini-key', mockCriteria)
- Assert: result.title === mockDraft.title; verify geminiClient.generateContent called once
- Mock isolation: Gemini client stubbed

**UTS-004-A3** — anthropic dispatch → Anthropic SDK called

- Arrange: mock anthropicClient.complete() → mockResponse; mock normalizeAnthropicResponse() → mockDraft
- Act: result = await adapter.dispatch('anthropic', 'anthropic-key', mockCriteria)
- Assert: result.title === mockDraft.title; verify anthropicClient.complete called once
- Mock isolation: Anthropic client stubbed

**UTS-004-A4** — Provider timeout (>30s) → ProviderTimeoutError

- Arrange: mock openaiClient.createChatCompletion() → throws Error('timeout')
- Act/Assert: adapter.dispatch('openai', 'key', criteria) throws ProviderTimeoutError
- Mock isolation: OpenAI client stubbed

**UTS-004-A5** — Provider API error → ProviderAPIError

- Arrange: mock openaiClient.createChatCompletion() → throws Error('rate limit')
- Act/Assert: adapter.dispatch('openai', 'key', criteria) throws ProviderAPIError
- Mock isolation: OpenAI client stubbed

---

### Module: MOD-005 (RecipeGenerationService — Generation Orchestrator)

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `src/ai/generation/recipe-generation.service.ts`

---

#### Test Case: UTP-005-A (generateRecipe — credential retrieval + dispatch)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies generateRecipe fetches credentials via ProviderConfigService, dispatches to AIProviderAdapter, and returns the raw draft (not persisted).

**Scenarios:**

**UTS-005-A1** — Generation succeeds → RecipeDraft returned

- Arrange: mock service.getProviderCredentials('uid') → { provider: 'openai', apiKey: 'key' }; mock adapter.dispatch('openai', 'key', criteria) → { title: 'Generated Recipe', ingredients: ['item'], instructions: ['step'], estimatedCalories: 200 }
- Act: result = await service.generateRecipe('uid', criteria)
- Assert: result.title === 'Generated Recipe'; result.estimatedCalories === 200
- Mock isolation: ProviderConfigService stubbed; AIProviderAdapter stubbed

**UTS-005-A2** — NoProviderConfiguredError → propagated to caller

- Arrange: mock service.getProviderCredentials('uid') → throws NoProviderConfiguredError
- Act/Assert: service.generateRecipe('uid', criteria) throws NoProviderConfiguredError
- Mock isolation: ProviderConfigService stubbed

---

### Module: MOD-006 (RecipePreviewController — Preview & Accept/Reject Handler)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `src/ai/generation/recipe-preview.controller.ts`

---

#### Test Case: UTP-006-A (handleGenerateRequest — dispatch, cache, error mapping)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies handleGenerateRequest calls generation service, stores draft in session cache with 10-min TTL, and maps errors to correct HTTP statuses.

**Scenarios:**

**UTS-006-A1** — Success → 200 with recipeDraft and draftKey

- Arrange: mock generationService.generateRecipe() → mockDraft; mock sessionCache.set = jest.fn()
- Act: result = await controller.handleGenerateRequest('uid', criteria)
- Assert: result.status === 200; result.body.recipeDraft !== undefined; result.body.draftKey.startsWith('draft:uid:'); verify sessionCache.set called once with TTL 600
- Mock isolation: RecipeGenerationService stubbed; SessionCache stubbed

**UTS-006-A2** — NoProviderConfiguredError → 422 with setupPayload

- Arrange: mock generationService.generateRecipe() → throws NoProviderConfiguredError; mock setupGuide.generateSetupPayload() → { setupRequired: true, supportedProviders: ['openai'] }
- Act: result = await controller.handleGenerateRequest('uid', criteria)
- Assert: result.status === 422; result.body.setupRequired === true
- Mock isolation: RecipeGenerationService stubbed; ProviderSetupGuide stubbed

**UTS-006-A3** — ProviderTimeoutError → 504

- Arrange: mock generationService.generateRecipe() → throws ProviderTimeoutError
- Act: result = await controller.handleGenerateRequest('uid', criteria)
- Assert: result.status === 504; result.body.error === 'AI provider timed out'
- Mock isolation: RecipeGenerationService stubbed

**UTS-006-A4** — ProviderAPIError → 502

- Arrange: mock generationService.generateRecipe() → throws ProviderAPIError with message 'Invalid API key'
- Act: result = await controller.handleGenerateRequest('uid', criteria)
- Assert: result.status === 502; result.body.error === 'Invalid API key'
- Mock isolation: RecipeGenerationService stubbed

---

#### Test Case: UTP-006-B (handleSaveRequest — accept/reject + draft expiry)

**Technique**: State Transition Testing + Equivalence Partitioning
**Target View**: State Machine View
**Description**: Verifies accept → persists recipe and deletes draft; reject → deletes draft; expired/missing draft → 404.

**Scenarios:**

**UTS-006-B1** — Accept → 201 with recipeId, draft deleted from cache

- Arrange: mock sessionCache.get('draft:uid:uuid') → mockDraft; mock persistenceAdapter.saveRecipe() → { id: 'new-recipe-id' }; mock sessionCache.delete = jest.fn()
- Act: result = await controller.handleSaveRequest('uid', 'draft:uid:uuid', true)
- Assert: result.status === 201; result.body.recipeId === 'new-recipe-id'; verify sessionCache.delete called once
- Mock isolation: SessionCache stubbed; RecipePersistenceAdapter stubbed

**UTS-006-B2** — Reject → 204, draft deleted, no persistence

- Arrange: mock sessionCache.get('draft:uid:uuid') → mockDraft; mock sessionCache.delete = jest.fn()
- Act: result = await controller.handleSaveRequest('uid', 'draft:uid:uuid', false)
- Assert: result.status === 204; verify persistenceAdapter.saveRecipe NOT called; verify sessionCache.delete called once
- Mock isolation: SessionCache stubbed; RecipePersistenceAdapter stubbed

**UTS-006-B3** — Draft not found (expired or wrong key) → 404

- Arrange: mock sessionCache.get('draft:uid:wrong') → null
- Act: result = await controller.handleSaveRequest('uid', 'draft:uid:wrong', true)
- Assert: result.status === 404; verify persistenceAdapter.saveRecipe NOT called
- Mock isolation: SessionCache stubbed

---

### Module: MOD-007 (RecipePersistenceAdapter — AI Recipe Save)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `src/ai/generation/recipe-persistence.adapter.ts`

---

#### Test Case: UTP-007-A (saveRecipe — mapping, delegation, isPrivate=true)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies saveRecipe maps RecipeDraft to Recipe entity (isPrivate=true, source='ai'), delegates to RecipeRepository.create, and returns persisted entity with generated ID.

**Scenarios:**

**UTS-007-A1** — Happy path → entity saved with isPrivate=true

- Arrange: mock draft = { title: 'AI Recipe', ingredients: ['i1'], instructions: ['s1'], estimatedCalories: 300 }; mock repo.create() → { id: 'gen-id', title: 'AI Recipe', isPrivate: true }
- Act: result = await adapter.saveRecipe('uid', draft, 'ai')
- Assert: result.isPrivate === true; verify repo.create called with source === 'ai'
- Mock isolation: RecipeRepository stubbed

**UTS-007-A2** — source='agent' passed → repo.create called with source='agent'

- Arrange: mock draft = { title: 'Agent Recipe', ingredients: [], instructions: [] }
- Act: await adapter.saveRecipe('uid', draft, 'agent')
- Assert: verify repo.create called with source === 'agent'
- Mock isolation: RecipeRepository stubbed

**UTS-007-A3** — estimatedCalories null → saved with null

- Arrange: mock draft = { title: 'No Calories', ingredients: [], instructions: [], estimatedCalories: null }
- Act: result = await adapter.saveRecipe('uid', draft, 'ai')
- Assert: verify repo.create called with estimatedCalories === null
- Mock isolation: RecipeRepository stubbed

---

### Module: MOD-008 (OAuthAuthorizationServer — Authorization Code Flow)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `src/ai/auth/oauth-authorization-server.ts`

---

#### Test Case: UTP-008-A (initiateAuthorization — build Clerk authorization URL, store state)

**Technique**: Statement Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies initiateAuthorization builds correct Clerk authorization URL with code_challenge, state, and nonce; stores state in memory for callback verification.

**Scenarios:**

**UTS-008-A1** — Authorization URL includes code_challenge and state

- Arrange: mock crypto.randomBytes(32) → Buffer.alloc(32).fill(1)
- Act: result = await server.initiateAuthorization('uid', 'http://localhost/callback')
- Assert: result.authorizationUrl includes 'https://clerk.commise.app/oauth/authorize'; verify result.authorizationUrl includes 'code_challenge='; verify result.state is 64-char hex string; verify state stored in server.stateStore
- Mock isolation: crypto stubbed; Clerk OAuth client stubbed

**UTS-008-A2** — State mismatch in callback → Error thrown

- Arrange: storedState = 'correct-state'; receivedState = 'wrong-state'; codeVerifier = 'test-verifier'
- Act/Assert: server.handleCallback('wrong-state', 'auth-code', 'test-verifier') throws Error with message containing 'State mismatch'
- Mock isolation: none

---

#### Test Case: UTP-008-B (handleCallback — code exchange, token storage)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies handleCallback exchanges auth code for tokens using the stored code_verifier, stores tokens, and returns user info.

**Scenarios:**

**UTS-008-B1** — Valid callback → tokens stored, user returned

- Arrange: storedState = 'valid-state'; codeVerifier = 'correct-verifier'; mock clerkOAuthClient.exchangeCode() → { accessToken: 'at', refreshToken: 'rt', idToken: 'idt' }; mock jwtDecode() → { sub: 'user_2abc123', email: 'test@example.com' }
- Act: result = await server.handleCallback('valid-state', 'auth-code', 'correct-verifier')
- Assert: result.sub === 'user_2abc123'; verify tokens stored in tokenStore under result.sub
- Mock isolation: Clerk OAuth client stubbed; jwtDecode stubbed

**UTS-008-B2** — Code verifier mismatch → Error thrown

- Arrange: storedState = 'state'; codeVerifier = 'correct'; receivedVerifier = 'wrong'
- Act/Assert: server.handleCallback('state', 'auth-code', 'wrong') throws Error
- Mock isolation: none

---

### Module: MOD-009 (AgentConsentManager — Consent Grant Storage & Revocation)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `src/ai/auth/agent-consent-manager.ts`

---

#### Test Case: UTP-009-A (storeConsentGrant — write + read consent record)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies storeConsentGrant writes consent record with userId, agentId, scope, expiry, and revocation function; readConsentGrant returns record or null.

**Scenarios:**

**UTS-009-A1** — Store consent, then read back → consent record returned

- Arrange: mock db.query() (insert) → { insertedId: 'consent-1' }; mock db.query() (select) → { userId: 'uid', agentId: 'agent-1', scope: ['read:recipes'], expiresAt: futureDate }
- Act: await manager.storeConsentGrant('uid', 'agent-1', ['read:recipes'], futureDate); result = await manager.readConsentGrant('uid', 'agent-1')
- Assert: result.scope includes 'read:recipes'; result.expiresAt === futureDate
- Mock isolation: db.query stubbed

**UTS-009-A2** — Consent expired → readConsentGrant returns null

- Arrange: mock db.query() → { expiresAt: pastDate }
- Act: result = await manager.readConsentGrant('uid', 'agent-1')
- Assert: result === null
- Mock isolation: db.query stubbed

**UTS-009-A3** — Consent not found → null returned

- Arrange: mock db.query() → null
- Act: result = await manager.readConsentGrant('uid', 'unknown-agent')
- Assert: result === null
- Mock isolation: db.query stubbed

---

#### Test Case: UTP-009-B (revokeConsent — marks consent as revoked)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies revokeConsent updates the consent record's revoked flag; subsequent readConsentGrant returns null for revoked consent.

**Scenarios:**

**UTS-009-B1** — Revoke existing consent → revoked flag set

- Arrange: mock db.query() (update) → { updatedId: 'consent-1' }
- Act: await manager.revokeConsent('uid', 'agent-1')
- Assert: verify db.query called with UPDATE ... SET revoked=true; result === 'success'
- Mock isolation: db.query stubbed

**UTS-009-B2** — Revoke non-existent consent → no error (idempotent)

- Arrange: mock db.query() (update) → { updatedId: null }
- Act: result = await manager.revokeConsent('uid', 'unknown-agent')
- Assert: result === 'success'; no exception thrown
- Mock isolation: db.query stubbed

---

### Module: MOD-010 (AgentTokenValidator — app-issued RS256 JWT verification)

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `src/ai/auth/agent-token-validator.ts`

---

#### Test Case: UTP-010-A (validateToken — app-issued RS256 agent-token verification)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies validateToken verifies the app-issued OAuth 2.1 agent access token (signed by MOD-008 OAuthAuthorizationServer with the app's own RS256 key pair) using the local public key `OAUTH_RS256_PUBLIC_KEY`, enforces the app's own issuer (`commise`), checks the shared revocation denylist, and returns `{ userId, scopes }` or throws. No Clerk involvement — these are the app's own authorization-server tokens, not Clerk session tokens (those are MOD-015).

**Scenarios:**

**UTS-010-A1** — Valid agent token → decoded agent identity returned

- Arrange: mock jwt.verify() → { sub: 'agent-id', scopes: ['recipes:read'], iss: 'commise' }; TokenDenylist.contains() → false
- Act: result = await validator.validateToken('Bearer valid-agent-jwt')
- Assert: result.userId === 'agent-id'; result.scopes === ['recipes:read']; verify jwt.verify called with the public OAUTH_RS256_PUBLIC_KEY, algorithms: ['RS256'], issuer: 'commise'
- Mock isolation: jwt.verify stubbed; TokenDenylist stubbed

**UTS-010-A2** — Expired token → Error thrown

- Arrange: mock jwt.verify() → throws TokenExpiredError('Token expired')
- Act/Assert: validator.validateToken('Bearer expired-jwt') throws UnauthorizedError
- Mock isolation: jwt.verify stubbed; TokenDenylist stubbed

**UTS-010-A3** — Wrong issuer (not the app's own AS) → Error thrown

- Arrange: mock jwt.verify() → throws JsonWebTokenError('jwt issuer invalid')
- Act/Assert: validator.validateToken('Bearer bad-iss-jwt') throws UnauthorizedError
- Mock isolation: jwt.verify stubbed; TokenDenylist stubbed

---

### Module: MOD-011 (AgentRecipeReadController — GET /agent/recipes)

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `src/ai/agent/agent-recipe-read.controller.ts`

---

#### Test Case: UTP-011-A (listAgentRecipes — authorization + query + response mapping)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies listAgentRecipes validates agent identity, queries recipes with correct ownerId filter, and maps to response DTOs.

**Scenarios:**

**UTS-011-A1** — Agent with valid token → recipes returned

- Arrange: mock tokenValidator.validateToken('agent-jwt') → { sub: 'agent-123' }; mock recipeRepo.findByOwnerId() → [{ id: 'r1', title: 'Recipe 1' }]
- Act: result = await controller.listAgentRecipes('agent-jwt', { limit: 20, offset: 0 })
- Assert: result.length === 1; result[0].id === 'r1'; verify recipeRepo.findByOwnerId called with ownerId from agent identity
- Mock isolation: AgentTokenValidator stubbed; RecipeRepository stubbed

**UTS-011-A2** — No recipes found → empty array returned

- Arrange: mock recipeRepo.findByOwnerId() → []
- Act: result = await controller.listAgentRecipes('agent-jwt', { limit: 20 })
- Assert: result.length === 0; result.status === 200
- Mock isolation: RecipeRepository stubbed

---

### Module: MOD-012 (AgentRecipeCreateController — POST /agent/recipes)

**Parent Architecture Modules**: ARCH-012
**Target Source File(s)**: `src/ai/agent/agent-recipe-create.controller.ts`

---

#### Test Case: UTP-012-A (createAgentRecipe — authorization + validation + persistence)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies createAgentRecipe validates input, creates recipe with agent as owner, and returns 201 with recipe ID.

**Scenarios:**

**UTS-012-A1** — Valid recipe payload → 201 returned with recipe ID

- Arrange: mock tokenValidator.validateToken('agent-jwt') → { sub: 'agent-123' }; mock recipeRepo.create() → { id: 'new-recipe', ownerId: 'agent-123', title: 'New Recipe' }
- Act: result = await controller.createAgentRecipe('agent-jwt', { title: 'New Recipe', ingredients: ['a'], instructions: ['b'] })
- Assert: result.status === 201; result.body.recipeId === 'new-recipe'; verify recipeRepo.create called with ownerId === 'agent-123'
- Mock isolation: AgentTokenValidator stubbed; RecipeRepository stubbed

**UTS-012-A2** — Missing required fields → 400 returned

- Arrange: payload = { title: '' } // missing ingredients, instructions
- Act: result = await controller.createAgentRecipe('agent-jwt', payload)
- Assert: result.status === 400; verify recipeRepo.create NOT called
- Mock isolation: none

---

### Module: MOD-013 (InstructionOptimizerService — Optimization Orchestrator)

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `src/ai/optimization/instruction-optimizer.service.ts`

---

#### Test Case: UTP-013-A (optimizeInstructions — LLM call + parsing + fallback)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies optimizeInstructions calls AI to optimize recipe instructions, parses the structured response, and falls back to identity optimization if parsing fails.

**Scenarios:**

**UTS-013-A1** — Successful optimization → optimized steps returned

- Arrange: mock adapter.dispatch('openai', 'key', criteria) → { instructions: ['Step 1: Preheat oven', 'Step 2: Mix ingredients'] }
- Act: result = await service.optimizeInstructions('uid', { recipeId: 'r1', instructions: ['Mix things'] }, 'openai', 'key')
- Assert: result[0].includes('Preheat'); verify result.length >= input.instructions.length
- Mock isolation: AIProviderAdapter stubbed

**UTS-013-A2** — LLM returns malformed JSON → fallback to identity (original instructions returned)

- Arrange: mock adapter.dispatch() → { instructions: null } // or throws
- Act: result = await service.optimizeInstructions('uid', { recipeId: 'r1', instructions: ['Original step'] }, 'openai', 'key')
- Assert: result[0] === 'Original step'; no exception thrown
- Mock isolation: AIProviderAdapter stubbed

**UTS-013-A3** — No credentials → ProviderAPIError propagated

- Arrange: mock adapter.dispatch() → throws ProviderAPIError
- Act/Assert: service.optimizeInstructions('uid', criteria, 'openai', 'bad-key') throws ProviderAPIError
- Mock isolation: AIProviderAdapter stubbed

---

### Module: MOD-014 (OptimizationReviewController — Accept/Reject Optimized Instructions)

**Parent Architecture Modules**: ARCH-014
**Target Source File(s)**: `src/ai/optimization/optimization-review.controller.ts`

---

#### Test Case: UTP-014-A (handleReview — accept/reject routing)

**Technique**: Branch Coverage + State Transition Testing
**Target View**: State Machine View
**Description**: Verifies accept → persists optimized instructions and returns 200; reject → returns 200 with original instructions; invalid recipeId → 404.

**Scenarios:**

**UTS-014-A1** — Accept → optimized instructions persisted

- Arrange: mock recipeRepo.updateInstructions() → { id: 'r1', instructions: ['Optimized step 1', 'Optimized step 2'] }
- Act: result = await controller.handleReview('uid', 'r1', { accept: true, optimizedInstructions: ['Opt 1', 'Opt 2'] })
- Assert: result.status === 200; verify recipeRepo.updateInstructions called with ['Opt 1', 'Opt 2']
- Mock isolation: RecipeRepository stubbed

**UTS-014-A2** — Reject → original instructions retained, 200 returned

- Arrange: mock recipeRepo.findById() → { id: 'r1', instructions: ['Original step'] }
- Act: result = await controller.handleReview('uid', 'r1', { accept: false, optimizedInstructions: ['Opt 1'] })
- Assert: result.status === 200; verify recipeRepo.updateInstructions NOT called
- Mock isolation: RecipeRepository stubbed

**UTS-014-A3** — Recipe not found → 404

- Arrange: mock recipeRepo.findById() → null
- Act: result = await controller.handleReview('uid', 'nonexistent', { accept: true, optimizedInstructions: [] })
- Assert: result.status === 404
- Mock isolation: RecipeRepository stubbed

---

### Module: MOD-015 (AuthMiddleware — Clerk Session-Token Enforcement) [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-015
**Target Source File(s)**: `src/auth/middleware/auth.middleware.ts` [EXTERNAL]

No unit tests — thin wrapper over `ClerkAuthService` (`@clerk/backend` `verifyToken`). Integration tests cover end-to-end token validation.

---

### Module: MOD-016 (PremiumEntitlementGuard — Subscription Check) [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-016
**Target Source File(s)**: `src/shared/middleware/premium-entitlement-guard.ts` [EXTERNAL]

No unit tests — subscription service wrapper. Integration tests cover entitlement checks.

---

### Module: MOD-017 (TypeSafetyAndA11yEnforcer — Compile-Time & Lint-Time Enforcement) [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-017
**Target Source File(s)**: `src/shared/middleware/type-safety-middleware.ts` [EXTERNAL]

No unit tests — TypeScript compiler and ESLint enforcement. Build step verifies compliance.

---

### Module: MOD-018 (OAuthClientRegistry — Client Registration Store)

**Parent Architecture Modules**: ARCH-018
**Target Source File(s)**: `src/ai/auth/oauth-client-registry.ts`

---

#### Test Case: UTP-018-A (registerClient + getClient — CRUD)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies registerClient stores client metadata; getClient retrieves it; duplicate client_id is rejected.

**Scenarios:**

**UTS-018-A1** — Register new client → stored and returned

- Arrange: mock db.query() → { insertedId: 'client-1' }
- Act: result = await registry.registerClient({ clientId: 'my-app', clientSecretHash: 'hash', redirectUris: ['https://app.com/callback'] })
- Assert: result.clientId === 'my-app'; verify db.query called with INSERT
- Mock isolation: db.query stubbed

**UTS-018-A2** — Get registered client → client metadata returned

- Arrange: mock db.query() → { clientId: 'my-app', redirectUris: ['https://app.com/callback'] }
- Act: result = await registry.getClient('my-app')
- Assert: result !== null; result.clientId === 'my-app'
- Mock isolation: db.query stubbed

**UTS-018-A3** — Get unregistered client → null returned

- Arrange: mock db.query() → null
- Act: result = await registry.getClient('unknown-client')
- Assert: result === null
- Mock isolation: db.query stubbed

---

### Module: MOD-019 (ProviderConfigController — HTTP Endpoint Handler)

**Parent Architecture Modules**: ARCH-019
**Target Source File(s)**: `src/ai/provider-config/provider-config.controller.ts`

---

#### Test Case: UTP-019-A (handleSaveProviderConfig — DTO validation + service delegation)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies POST /ai/provider-config saves provider credentials and returns masked config; validates DTO; maps errors to correct HTTP codes.

**Scenarios:**

**UTS-019-A1** — Valid request → 200 with masked config

- Arrange: mock service.saveProviderCredentials() → { userId: 'uid', provider: 'openai', apiKeyMasked: '\*\*\*\*1234', updatedAt: 'ts' }
- Act: result = await controller.handleSaveProviderConfig({ userId: 'uid', provider: 'openai', apiKey: 'sk-real-key' })
- Assert: result.status === 200; result.body.apiKeyMasked === '\*\*\*\*1234'; raw key not in response
- Mock isolation: ProviderConfigService stubbed

**UTS-019-A2** — Invalid provider → 400

- Arrange: payload = { userId: 'uid', provider: 'invalid', apiKey: 'key' }
- Act: result = await controller.handleSaveProviderConfig(payload)
- Assert: result.status === 400; verify service NOT called
- Mock isolation: none

**UTS-019-A3** — Database error → 503

- Arrange: mock service.saveProviderCredentials() → throws DatabaseError
- Act: result = await controller.handleSaveProviderConfig({ userId: 'uid', provider: 'openai', apiKey: 'key' })
- Assert: result.status === 503
- Mock isolation: ProviderConfigService stubbed

---

### Module: MOD-020 (TokenDenylist — Revocation Store) [CROSS-CUTTING]

**Parent Architecture Modules**: ARCH-020
**Target Source File(s)**: `src/ai/auth/token-denylist.ts`

---

#### Test Case: UTP-020-A (addToDenylist + isOnDenylist — revocation check)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies addToDenylist stores token hash + expiry; isOnDenylist returns true for revoked tokens, false for active ones.

**Scenarios:**

**UTS-020-A1** — Add token to denylist → stored with expiry

- Arrange: mock db.query() → { insertedId: 'entry-1' }
- Act: await denylist.addToDenylist('jti-123', '2026-06-01T00:00:00Z')
- Assert: verify db.query called with INSERT ... ON CONFLICT DO NOTHING (idempotent)
- Mock isolation: db.query stubbed

**UTS-020-A2** — Token on denylist → true returned

- Arrange: mock db.query() → { jti: 'jti-123', expiresAt: futureDate }
- Act: result = await denylist.isOnDenylist('jti-123')
- Assert: result === true
- Mock isolation: db.query stubbed

**UTS-020-A3** — Token not on denylist → false returned

- Arrange: mock db.query() → null
- Act: result = await denylist.isOnDenylist('active-jti')
- Assert: result === false
- Mock isolation: db.query stubbed

**UTS-020-A4** — Expired entry auto-cleanup (query returns null despite stored entry)

- Arrange: mock db.query() → null (entry expired and cleaned up)
- Act: result = await denylist.isOnDenylist('old-jti')
- Assert: result === false
- Mock isolation: db.query stubbed

---

## ARCH↔MOD↔UTP Traceability

| MOD ID  | MOD Name                     | UTP Count  | UTS Count        |
| ------- | ---------------------------- | ---------- | ---------------- |
| MOD-001 | ProviderConfigRepository     | 2 (A, B)   | 7 (A1-A4, B1-B3) |
| MOD-002 | ProviderConfigService        | 2 (A, B)   | 7 (A1-A3, B1-B3) |
| MOD-003 | ProviderSetupGuide           | 1 (A)      | 2 (A1-A2)        |
| MOD-004 | AIProviderAdapter            | 1 (A)      | 5 (A1-A5)        |
| MOD-005 | RecipeGenerationService      | 1 (A)      | 2 (A1-A2)        |
| MOD-006 | RecipePreviewController      | 2 (A, B)   | 7 (A1-A4, B1-B3) |
| MOD-007 | RecipePersistenceAdapter     | 1 (A)      | 3 (A1-A3)        |
| MOD-008 | OAuthAuthorizationServer     | 2 (A, B)   | 3 (A1-A2, B1-B2) |
| MOD-009 | AgentConsentManager          | 2 (A, B)   | 5 (A1-A3, B1-B2) |
| MOD-010 | AgentTokenValidator          | 1 (A)      | 3 (A1-A3)        |
| MOD-011 | AgentRecipeReadController    | 1 (A)      | 2 (A1-A2)        |
| MOD-012 | AgentRecipeCreateController  | 1 (A)      | 2 (A1-A2)        |
| MOD-013 | InstructionOptimizerService  | 1 (A)      | 3 (A1-A3)        |
| MOD-014 | OptimizationReviewController | 1 (A)      | 3 (A1-A3)        |
| MOD-015 | AuthGuardMiddleware          | [EXTERNAL] | —                |
| MOD-016 | PremiumEntitlementGuard      | [EXTERNAL] | —                |
| MOD-017 | TypeSafetyAndA11yEnforcer    | [EXTERNAL] | —                |
| MOD-018 | OAuthClientRegistry          | 1 (A)      | 3 (A1-A3)        |
| MOD-019 | ProviderConfigController     | 1 (A)      | 3 (A1-A3)        |
| MOD-020 | TokenDenylist                | 1 (A)      | 4 (A1-A4)        |

## Mock Registry

Each UTP that touches an external dependency MUST list the dependency mock in its setup. Mock entries identify the dependency name, mock type (stub, fake, spy, or in-memory adapter), owning MOD-NNN, and reset behavior between scenarios.

## Coverage Completion Unit Tests

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

### Module: MOD-016 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-016.

#### Test Case: UTP-016-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-016 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-016-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-016
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-016-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-016
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-017 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-017.

#### Test Case: UTP-017-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-017 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-017-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-017
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-017-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-017
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping
