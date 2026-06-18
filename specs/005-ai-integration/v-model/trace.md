# V-Model Traceability Matrix: AI Integration

**Feature Branch**: `005-ai-integration`
**Generated**: 2026-05-09
**Baseline Status**: Draft — Pending Execution
**Traceability Standard**: ISO 29119 / V-Model bidirectional coverage

---

## Artifact Information

| Artifact                   | File                                                  | Created    | Status     | Scope                                              |
| -------------------------- | ----------------------------------------------------- | ---------- | ---------- | -------------------------------------------------- |
| Requirements Specification | `specs/005-ai-integration/v-model/requirements.md`    | 2026-05-09 | Draft      | 15 FR + 5 NF + 3 IF + 3 CN = 26 total requirements |
| Acceptance Test Plan       | `specs/005-ai-integration/v-model/acceptance-plan.md` | 2026-05-09 | Draft      | AT cases for all 15 FR + selected NF/IF/CN         |
| Unit Test Plan             | `specs/005-ai-integration/v-model/unit-test.md`       | 2026-05-09 | Draft      | 20 MODs, 22 UTP cases, 58 UTS scenarios            |
| System Design              | `specs/005-ai-integration/v-model/system-design.md`   | —          | Referenced | ARCH modules (ARCH-001 through ARCH-020)           |
| Module Design              | `specs/005-ai-integration/v-model/module-design.md`   | —          | Referenced | MOD-001 through MOD-020                            |

**Legend**:

- ⬜ Pending Execution — test defined, not yet run
- ✅ Passed — test executed and passed
- ❌ Failed — test executed and failed
- ⚠️ Partially Passed — test executed with partial pass

---

## Matrix A: Forward Traceability (REQ → ATP)

> Maps every requirement to its acceptance test case(s). Gaps indicate requirements with no acceptance coverage.

### Functional Requirements

| REQ-ID  | Requirement (Summary)                                                                          | Priority | ATP-ID             | Acceptance Test (Summary)                                                            | Verification Method                | Status |
| ------- | ---------------------------------------------------------------------------------------------- | -------- | ------------------ | ------------------------------------------------------------------------------------ | ---------------------------------- | ------ |
| REQ-001 | Users configure preferred AI provider by storing own API credentials (BYOK)                    | P2       | AT-005-A, AT-005-F | BYOK provider save; provider list/delete; priority fallback                          | Scenario-Based Testing             | ⬜     |
| REQ-002 | System calls user's configured AI provider to generate recipes based on criteria               | P2       | AT-005-B           | In-app AI recipe generation success and error paths                                  | Scenario-Based Testing             | ⬜     |
| REQ-003 | AI-generated recipe results returned within 15 seconds                                         | P2       | AT-005-B           | Generation timeout (>15 s) returns 504 ProviderTimeoutError                          | Boundary Value Analysis            | ⬜     |
| REQ-004 | Users can preview AI-generated recipes before optionally saving                                | P2       | AT-005-B           | Preview shown with accept/reject options; draft cached with TTL                      | State Transition Testing           | ⬜     |
| REQ-005 | AI-generated recipes accepted by user saved as private, user-owned recipes                     | P2       | AT-005-B           | User accepts draft → recipe persisted with isPrivate: true, source: 'ai'             | Scenario-Based Testing             | ⬜     |
| REQ-006 | System MUST NOT store recipe when user declines AI-generated recipe                            | P2       | AT-005-B           | User rejects draft → no recipe persisted; draft removed from cache                   | Branch Coverage                    | ⬜     |
| REQ-007 | System guides users through AI provider setup when no credentials configured                   | P2       | AT-005-A           | No provider configured → 422 with setup guide payload                                | Equivalence Partitioning           | ⬜     |
| REQ-008 | System exposes OAuth 2.0-protected API for external agents to read recipe collection           | P2       | AT-005-C, AT-005-D | Agent OAuth flow; agent reads recipes with valid token                               | Scenario-Based Testing             | ⬜     |
| REQ-009 | System exposes OAuth 2.0-protected API for external agents to create recipes on behalf of user | P2       | AT-005-C, AT-005-D | Agent creates recipe with recipes:create scope                                       | Scenario-Based Testing             | ⬜     |
| REQ-010 | Users must explicitly grant consent via OAuth authorization flow before agent access           | P2       | AT-005-C           | User grants/denies consent; consent stored with scope and expiry                     | Scenario-Based Testing             | ⬜     |
| REQ-011 | System rejects unauthorized external agent requests with authorization error                   | P2       | AT-005-D           | Expired token, revoked consent, missing token → 401/403                              | Branch Coverage                    | ⬜     |
| REQ-012 | All AI-generated recipes saved as private, user-owned regardless of generation path            | P2       | AT-005-B           | isPrivate: true, source: 'ai'/'agent', ownerId set on all AI-generated recipes       | Scenario-Based Testing             | ⬜     |
| REQ-013 | Users can revoke external agent authorizations at any time from account settings               | P2       | AT-005-E           | Revocation marks consent; subsequent agent calls return 403; re-auth restores access | State Transition Testing           | ⬜     |
| REQ-014 | Recipe owners can request AI-powered optimization of recipe instructions (Premium)             | P2       | AT-005-B           | Premium user requests instruction optimization; result shown for accept/reject       | Branch Coverage + State Transition | ⬜     |
| REQ-015 | Users can accept or reject AI-optimized recipe instructions before changes applied             | P2       | AT-005-B           | Accept → persists optimized instructions; reject → original unchanged                | Scenario-Based Testing             | ⬜     |

### Non-Functional Requirements

| REQ-ID     | Requirement (Summary)                                                         | Priority | ATP-ID                            | Acceptance Test (Summary)                                                   | Verification Method | Status |
| ---------- | ----------------------------------------------------------------------------- | -------- | --------------------------------- | --------------------------------------------------------------------------- | ------------------- | ------ |
| REQ-NF-001 | All TypeScript code compiles with strict: true; no any outside test doubles   | P1       | AT-005-G (ATS-005-G1)             | tsc --strict exits 0; zero type errors                                      | Inspection          | ⬜     |
| REQ-NF-002 | All exported functions and interfaces carry JSDoc documentation               | P1       | AT-005-G (ATS-005-G2)             | Zero JSDoc violations reported by lint                                      | Inspection          | ⬜     |
| REQ-NF-003 | UI components expose accessible name queryable via getByRole/getByLabel       | P1       | AT-005-G (ATS-005-G3)             | Playwright getByRole finds element without aria-label workaround            | Test                | ⬜     |
| REQ-NF-004 | Color MUST NOT be sole conveyor of state; icon or text label pairing required | P1       | AT-005-G (ATS-005-G4)             | Accessibility linter finds icon + text pairing; zero WCAG contrast failures | Inspection          | ⬜     |
| REQ-NF-005 | AI provider credentials (BYOK API keys) encrypted at rest                     | P1       | AT-005-A (ATS-005-A1, ATS-005-A6) | AES-256-GCM encryption confirmed; GCM auth tag mismatch → DecryptionError   | Inspection          | ⬜     |

### Interface Requirements

| REQ-ID     | Requirement (Summary)                                                              | Priority | ATP-ID   | Acceptance Test (Summary)                                                               | Verification Method | Status |
| ---------- | ---------------------------------------------------------------------------------- | -------- | -------- | --------------------------------------------------------------------------------------- | ------------------- | ------ |
| REQ-IF-001 | Expose OAuth 2.0 authorization code flow endpoint for external agent platforms     | P2       | AT-005-C | Agent initiates OAuth flow; Clerk redirect with code_challenge, state, nonce            | Test                | ⬜     |
| REQ-IF-002 | OAuth 2.0 API supports scopes recipes:read and recipes:create                      | P2       | AT-005-C | Consent with recipes:read only → create calls return 403; both scopes → create succeeds | Test                | ⬜     |
| REQ-IF-003 | System returns recipe collection in structured format to authorized external agent | P2       | AT-005-D | Agent with valid token receives structured recipe collection                            | Test                | ⬜     |

### Constraint Requirements

| REQ-ID     | Requirement (Summary)                                                               | Priority | ATP-ID                         | Acceptance Test (Summary)                                                  | Verification Method | Status |
| ---------- | ----------------------------------------------------------------------------------- | -------- | ------------------------------ | -------------------------------------------------------------------------- | ------------------- | ------ |
| REQ-CN-001 | AI Integration depends on Recipe entities from spec 001-commise-recipe-app          | P1       | _(Inspection — no AT defined)_ | —                                                                          | Inspection          | ⬜     |
| REQ-CN-002 | All AI features require user authentication from spec 002-user-auth                 | P1       | AT-005-D (ATS-005-D5)          | Unauthenticated user calling /ai/recipes/generate → 401                    | Test                | ⬜     |
| REQ-CN-003 | AI recipe generation and instruction optimization restricted to premium subscribers | P2       | AT-005-B (ATS-005-B7)          | Free-tier user requests generation → 402 Upgrade required; no AI call made | Test                | ⬜     |

---

## Matrix B: Backward Traceability (ATP → REQ)

> Maps every acceptance test case back to its parent requirement. Orphan ATs (no REQ) are flagged.

| ATP-ID   | Acceptance Test (Summary)                         | REQ-ID                                                                                         | Requirement (Summary)                                                              | Justification                                                                            |
| -------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| AT-005-A | BYOK: User configures own AI provider credentials | REQ-001, REQ-007, REQ-NF-005                                                                   | BYOK provider configuration; setup guide; encryption at rest                       | Covers provider save, validation errors, encryption, setup guide, startup config failure |
| AT-005-B | In-app AI recipe generation                       | REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-012, REQ-014, REQ-015, REQ-NF-003, REQ-CN-003 | Generation, latency, preview, accept/reject, ownership, optimization, premium gate | Covers full generation lifecycle from request to persistence or rejection                |
| AT-005-C | External agent OAuth: Authorization               | REQ-008, REQ-009, REQ-010, REQ-IF-001, REQ-IF-002                                              | Agent OAuth flow; consent grant; scope enforcement                                 | Covers authorization code flow, consent grant/deny, scope-based access control           |
| AT-005-D | External agent API access enforcement             | REQ-011, REQ-CN-002, REQ-IF-003                                                                | Unauthorized agent rejection; auth requirement; structured response                | Covers valid/expired/revoked/missing token scenarios and unauthenticated user rejection  |
| AT-005-E | Consent revocation                                | REQ-013                                                                                        | Users can revoke agent authorizations at any time                                  | Covers revocation, denylist enforcement, and re-authorization after revocation           |
| AT-005-F | Provider credential management                    | REQ-001, REQ-NF-005                                                                            | BYOK credential list, delete, priority fallback                                    | Covers list (masked keys), delete, fallback order, and no-provider error                 |
| AT-005-G | Accessibility & Type Safety                       | REQ-NF-001, REQ-NF-002, REQ-NF-003, REQ-NF-004                                                 | TypeScript strict, JSDoc, accessible names, color pairing                          | Covers compile-time and lint-time enforcement of constitution principles                 |

---

## Matrix C: Integration Verification

> Integration-level requirements verified at module boundaries (ARCH-level). Unit tests (UTP) verify internal module logic; integration tests verify cross-module contracts.

| Integration Point                                                              | REQ-IDs             | MOD Boundary                                    | UTP Coverage                                      | Integration Test Status | Notes                                                                                                              |
| ------------------------------------------------------------------------------ | ------------------- | ----------------------------------------------- | ------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------ |
| ProviderConfigController → ProviderConfigService → ProviderConfigRepository    | REQ-001, REQ-007    | MOD-019 ↔ MOD-002 ↔ MOD-001                     | UTP-019-A, UTP-002-A, UTP-001-A (all mocked)      | ⬜                      | Integration test needed: real DB upsert with AES-256-GCM encryption round-trip                                     |
| ProviderConfigService → AES-256-GCM crypto                                     | REQ-NF-005          | MOD-001 internal                                | UTP-001-A (crypto stubbed)                        | ⬜                      | Integration test needed: real encrypt/decrypt round-trip with IV uniqueness verification                           |
| RecipeGenerationService → AIProviderAdapter → External AI Provider SDK         | REQ-002, REQ-003    | MOD-005 ↔ MOD-004 ↔ OpenAI/Gemini/Anthropic SDK | UTP-005-A, UTP-004-A (adapters stubbed)           | ⬜                      | Integration test needed: real SDK call with timeout enforcement (15 s boundary)                                    |
| RecipePreviewController → SessionCache (draft TTL)                             | REQ-004, REQ-006    | MOD-006 ↔ SessionCache                          | UTP-006-A, UTP-006-B (cache stubbed)              | ⬜                      | Integration test needed: real cache with 10-min TTL expiry verification                                            |
| RecipePersistenceAdapter → RecipeRepository (spec 001)                         | REQ-005, REQ-012    | MOD-007 ↔ RecipeRepository                      | UTP-007-A (repo stubbed)                          | ⬜                      | Integration test needed: real DB write with isPrivate=true, source='ai'/'agent'                                    |
| OAuthAuthorizationServer → Clerk token endpoint                                | REQ-010, REQ-IF-001 | MOD-008 ↔ Clerk /oauth/token                    | UTP-008-A, UTP-008-B (Clerk OAuth client stubbed) | ⬜                      | Integration test needed: real Clerk sandbox authorization code exchange with PKCE                                  |
| AgentConsentManager → TokenDenylist (revocation enforcement)                   | REQ-011, REQ-013    | MOD-009 ↔ MOD-020                               | UTP-009-B, UTP-020-A (db stubbed)                 | ⬜                      | Integration test needed: revoke consent → denylist populated → subsequent token rejected                           |
| AgentTokenValidator → app-issued RS256 agent-token verification                | REQ-011, REQ-IF-001 | MOD-010 ↔ `jwt.verify` (OAUTH_RS256_PUBLIC_KEY) | UTP-010-A (jwt.verify + denylist stubbed)         | ⬜                      | Integration test needed: real verification of an MOD-008-issued RS256 JWT (issuer 'commise') + denylist revocation |
| AgentRecipeReadController → AgentTokenValidator → RecipeRepository             | REQ-008, REQ-IF-003 | MOD-011 ↔ MOD-010 ↔ RecipeRepository            | UTP-011-A (all stubbed)                           | ⬜                      | Integration test needed: end-to-end agent read with real JWT and DB query                                          |
| AgentRecipeCreateController → AgentTokenValidator → RecipePersistenceAdapter   | REQ-009, REQ-012    | MOD-012 ↔ MOD-010 ↔ MOD-007                     | UTP-012-A (all stubbed)                           | ⬜                      | Integration test needed: end-to-end agent create with scope enforcement                                            |
| InstructionOptimizerService → AIProviderAdapter → OptimizationReviewController | REQ-014, REQ-015    | MOD-013 ↔ MOD-004 ↔ MOD-014                     | UTP-013-A, UTP-014-A (all stubbed)                | ⬜                      | Integration test needed: optimization request → AI call → accept/reject persistence                                |
| AuthGuardMiddleware → all AI endpoints                                         | REQ-CN-002          | MOD-015 ↔ all controllers                       | No UTP (external middleware)                      | ⬜                      | Integration test needed: unauthenticated requests to all /ai/_ and /agent/_ endpoints return 401                   |
| PremiumEntitlementGuard → generation and optimization endpoints                | REQ-CN-003          | MOD-016 ↔ MOD-006, MOD-013                      | No UTP (external guard)                           | ⬜                      | Integration test needed: free-tier user blocked at guard; premium user passes through                              |

---

## Matrix D: Implementation Verification

> Maps module designs (MOD) to unit test cases (UTP) and their scenarios (UTS). Verifies implementation completeness at the code level.

| MOD-ID  | Module Name                          | Source File                                              | ARCH Parent | UTP Cases                           | UTS Scenarios                                          | Implementation Status |
| ------- | ------------------------------------ | -------------------------------------------------------- | ----------- | ----------------------------------- | ------------------------------------------------------ | --------------------- |
| MOD-001 | ProviderConfigRepository             | `src/ai/provider-config/provider-config.repository.ts`   | ARCH-001    | UTP-001-A, UTP-001-B                | UTS-001-A1 through A4, UTS-001-B1 through B3 (7 total) | ⬜                    |
| MOD-002 | ProviderConfigService                | `src/ai/provider-config/provider-config.service.ts`      | ARCH-002    | UTP-002-A, UTP-002-B                | UTS-002-A1 through A3, UTS-002-B1 through B3 (6 total) | ⬜                    |
| MOD-003 | ProviderSetupGuide                   | `src/ai/provider-config/provider-setup-guide.service.ts` | ARCH-003    | UTP-003-A                           | UTS-003-A1 through A2 (2 total)                        | ⬜                    |
| MOD-004 | AIProviderAdapter                    | `src/ai/provider-adapter.ts`                             | ARCH-004    | UTP-004-A                           | UTS-004-A1 through A5 (5 total)                        | ⬜                    |
| MOD-005 | RecipeGenerationService              | `src/ai/generation/recipe-generation.service.ts`         | ARCH-005    | UTP-005-A                           | UTS-005-A1 through A2 (2 total)                        | ⬜                    |
| MOD-006 | RecipePreviewController              | `src/ai/generation/recipe-preview.controller.ts`         | ARCH-006    | UTP-006-A, UTP-006-B                | UTS-006-A1 through A4, UTS-006-B1 through B3 (7 total) | ⬜                    |
| MOD-007 | RecipePersistenceAdapter             | `src/ai/generation/recipe-persistence.adapter.ts`        | ARCH-007    | UTP-007-A                           | UTS-007-A1 through A3 (3 total)                        | ⬜                    |
| MOD-008 | OAuthAuthorizationServer             | `src/ai/auth/oauth-authorization-server.ts`              | ARCH-008    | UTP-008-A, UTP-008-B                | UTS-008-A1 through A2, UTS-008-B1 through B2 (4 total) | ⬜                    |
| MOD-009 | AgentConsentManager                  | `src/ai/auth/agent-consent-manager.ts`                   | ARCH-009    | UTP-009-A, UTP-009-B                | UTS-009-A1 through A3, UTS-009-B1 through B2 (5 total) | ⬜                    |
| MOD-010 | AgentTokenValidator                  | `src/ai/auth/agent-token-validator.ts`                   | ARCH-010    | UTP-010-A                           | UTS-010-A1 through A3 (3 total)                        | ⬜                    |
| MOD-011 | AgentRecipeReadController            | `src/ai/agent/agent-recipe-read.controller.ts`           | ARCH-011    | UTP-011-A                           | UTS-011-A1 through A2 (2 total)                        | ⬜                    |
| MOD-012 | AgentRecipeCreateController          | `src/ai/agent/agent-recipe-create.controller.ts`         | ARCH-012    | UTP-012-A                           | UTS-012-A1 through A2 (2 total)                        | ⬜                    |
| MOD-013 | InstructionOptimizerService          | `src/ai/optimization/instruction-optimizer.service.ts`   | ARCH-013    | UTP-013-A                           | UTS-013-A1 through A3 (3 total)                        | ⬜                    |
| MOD-014 | OptimizationReviewController         | `src/ai/optimization/optimization-review.controller.ts`  | ARCH-014    | UTP-014-A                           | UTS-014-A1 through A3 (3 total)                        | ⬜                    |
| MOD-015 | AuthGuardMiddleware [EXTERNAL]       | `src/shared/middleware/auth-guard.middleware.ts`         | ARCH-015    | _(No UTP — external middleware)_    | —                                                      | ⬜                    |
| MOD-016 | PremiumEntitlementGuard [EXTERNAL]   | `src/shared/middleware/premium-entitlement-guard.ts`     | ARCH-016    | _(No UTP — external guard)_         | —                                                      | ⬜                    |
| MOD-017 | TypeSafetyAndA11yEnforcer [EXTERNAL] | `src/shared/middleware/type-safety-middleware.ts`        | ARCH-017    | _(No UTP — build/lint enforcement)_ | —                                                      | ⬜                    |
| MOD-018 | OAuthClientRegistry                  | `src/ai/auth/oauth-client-registry.ts`                   | ARCH-018    | UTP-018-A                           | UTS-018-A1 through A3 (3 total)                        | ⬜                    |
| MOD-019 | ProviderConfigController             | `src/ai/provider-config/provider-config.controller.ts`   | ARCH-019    | UTP-019-A                           | UTS-019-A1 through A3 (3 total)                        | ⬜                    |
| MOD-020 | TokenDenylist                        | `src/ai/auth/token-denylist.ts`                          | ARCH-020    | UTP-020-A                           | UTS-020-A1 through A4 (4 total)                        | ⬜                    |

### UTP → REQ Traceability (Implementation → Requirement)

| UTP-ID    | Module                               | Technique                                              | REQ-IDs Covered                    | UTS Count | Status |
| --------- | ------------------------------------ | ------------------------------------------------------ | ---------------------------------- | --------- | ------ |
| UTP-001-A | MOD-001 ProviderConfigRepository     | Statement & Branch Coverage + Boundary Value Analysis  | REQ-001, REQ-NF-005                | 4         | ⬜     |
| UTP-001-B | MOD-001 ProviderConfigRepository     | Statement Coverage + Equivalence Partitioning          | REQ-001, REQ-NF-005                | 3         | ⬜     |
| UTP-002-A | MOD-002 ProviderConfigService        | Statement Coverage + Equivalence Partitioning          | REQ-001                            | 3         | ⬜     |
| UTP-002-B | MOD-002 ProviderConfigService        | Statement & Branch Coverage                            | REQ-007                            | 3         | ⬜     |
| UTP-003-A | MOD-003 ProviderSetupGuide           | Strict Isolation                                       | REQ-007                            | 2         | ⬜     |
| UTP-004-A | MOD-004 AIProviderAdapter            | Statement & Branch Coverage + Equivalence Partitioning | REQ-002, REQ-003                   | 5         | ⬜     |
| UTP-005-A | MOD-005 RecipeGenerationService      | Statement & Branch Coverage                            | REQ-002, REQ-007                   | 2         | ⬜     |
| UTP-006-A | MOD-006 RecipePreviewController      | Statement & Branch Coverage                            | REQ-002, REQ-003, REQ-004, REQ-007 | 4         | ⬜     |
| UTP-006-B | MOD-006 RecipePreviewController      | State Transition Testing + Equivalence Partitioning    | REQ-004, REQ-005, REQ-006          | 3         | ⬜     |
| UTP-007-A | MOD-007 RecipePersistenceAdapter     | Statement Coverage + Equivalence Partitioning          | REQ-005, REQ-012                   | 3         | ⬜     |
| UTP-008-A | MOD-008 OAuthAuthorizationServer     | Statement Coverage                                     | REQ-010, REQ-IF-001                | 2         | ⬜     |
| UTP-008-B | MOD-008 OAuthAuthorizationServer     | Statement & Branch Coverage                            | REQ-010, REQ-IF-001                | 2         | ⬜     |
| UTP-009-A | MOD-009 AgentConsentManager          | Statement Coverage + Equivalence Partitioning          | REQ-010, REQ-013                   | 3         | ⬜     |
| UTP-009-B | MOD-009 AgentConsentManager          | Statement Coverage + Equivalence Partitioning          | REQ-013                            | 2         | ⬜     |
| UTP-010-A | MOD-010 AgentTokenValidator          | Statement & Branch Coverage                            | REQ-011, REQ-IF-001                | 3         | ⬜     |
| UTP-011-A | MOD-011 AgentRecipeReadController    | Statement & Branch Coverage                            | REQ-008, REQ-IF-003                | 2         | ⬜     |
| UTP-012-A | MOD-012 AgentRecipeCreateController  | Statement & Branch Coverage + Equivalence Partitioning | REQ-009, REQ-012                   | 2         | ⬜     |
| UTP-013-A | MOD-013 InstructionOptimizerService  | Statement & Branch Coverage                            | REQ-014                            | 3         | ⬜     |
| UTP-014-A | MOD-014 OptimizationReviewController | Branch Coverage + State Transition Testing             | REQ-014, REQ-015                   | 3         | ⬜     |
| UTP-018-A | MOD-018 OAuthClientRegistry          | Statement Coverage + Equivalence Partitioning          | REQ-010, REQ-IF-001                | 3         | ⬜     |
| UTP-019-A | MOD-019 ProviderConfigController     | Statement & Branch Coverage                            | REQ-001, REQ-007                   | 3         | ⬜     |
| UTP-020-A | MOD-020 TokenDenylist                | Statement Coverage + Equivalence Partitioning          | REQ-011, REQ-013                   | 4         | ⬜     |

---

## Matrix H: Hazard Traceability

> Security and safety hazards linked to requirements and their mitigations. Derived from the security-critical nature of BYOK credential storage and OAuth agent authorization.

| HAZ-ID  | Hazard Description                                       | Severity | REQ-IDs                      | Mitigation                                                                                                   | Verification                                            | Status |
| ------- | -------------------------------------------------------- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- | ------ |
| HAZ-001 | BYOK API key stored in plaintext                         | Critical | REQ-001, REQ-NF-005          | AES-256-GCM encryption with unique IV per write; key never returned raw                                      | AT-005-A (ATS-005-A1), UTP-001-A                        | ⬜     |
| HAZ-002 | GCM auth tag mismatch exposes tampered credential        | Critical | REQ-NF-005                   | DecryptionError propagated as 500; raw key never returned on auth tag failure                                | AT-005-A (ATS-005-A6), UTS-001-B3                       | ⬜     |
| HAZ-003 | Encryption key missing from environment at startup       | High     | REQ-NF-005                   | Process exits with ConfigurationError at startup; no degraded mode                                           | AT-005-A (ATS-005-A5)                                   | ⬜     |
| HAZ-004 | External agent accesses user data without consent        | Critical | REQ-010, REQ-011             | OAuth 2.0 authorization code flow with explicit user consent required before any agent access                | AT-005-C (ATS-005-C3), AT-005-D (ATS-005-D4)            | ⬜     |
| HAZ-005 | OAuth state parameter tampering (CSRF)                   | High     | REQ-010, REQ-IF-001          | State parameter validated on callback; mismatch throws Error('State mismatch'); no tokens exchanged          | AT-005-C (ATS-005-C6), UTS-008-A2                       | ⬜     |
| HAZ-006 | PKCE code verifier mismatch allows token theft           | High     | REQ-010, REQ-IF-001          | Code verifier validated on exchange; mismatch throws Error; no tokens exchanged                              | AT-005-C (ATS-005-C7), UTS-008-B2                       | ⬜     |
| HAZ-007 | Revoked agent retains access via previously issued token | High     | REQ-011, REQ-013             | TokenDenylist checked on every agent request; revoked JTI rejected even if JWT is cryptographically valid    | AT-005-D (ATS-005-D3), AT-005-E (ATS-005-E2), UTP-020-A | ⬜     |
| HAZ-008 | Agent exceeds authorized scope (scope escalation)        | High     | REQ-008, REQ-009, REQ-IF-002 | Scope enforced per-request; recipes:read token rejected on recipes:create endpoint with 403                  | AT-005-C (ATS-005-C4)                                   | ⬜     |
| HAZ-009 | Unauthenticated user accesses AI generation endpoints    | Critical | REQ-CN-002                   | AuthMiddleware enforces the Clerk session token on all /ai/_ and /agent/_ routes; returns 401                | AT-005-D (ATS-005-D5)                                   | ⬜     |
| HAZ-010 | Free-tier user bypasses premium gate for AI generation   | Medium   | REQ-CN-003                   | PremiumEntitlementGuard checks subscription status before any AI provider call; returns 402                  | AT-005-B (ATS-005-B7)                                   | ⬜     |
| HAZ-011 | AI provider error leaks internal details to client       | Medium   | REQ-002                      | ProviderAPIError sanitized before propagation; raw provider error message never returned                     | AT-005-B (ATS-005-B3), UTS-004-A5                       | ⬜     |
| HAZ-012 | AI-generated recipe persisted without user acceptance    | High     | REQ-004, REQ-005, REQ-006    | Draft stored in session cache with TTL; persistence only triggered by explicit accept action                 | AT-005-B (ATS-005-B4, ATS-005-B5), UTP-006-B            | ⬜     |
| HAZ-013 | Draft cache poisoning via crafted draftKey               | Medium   | REQ-004, REQ-006             | draftKey namespaced as draft:{userId}:{uuid}; userId validated against session before cache lookup           | UTS-006-B3                                              | ⬜     |
| HAZ-014 | Agent creates recipe on behalf of wrong user (IDOR)      | Critical | REQ-009, REQ-012             | ownerId derived from validated JWT sub, not from request body; request body ownerId ignored                  | UTP-012-A (UTS-012-A1)                                  | ⬜     |
| HAZ-015 | Instruction optimization applied without user review     | High     | REQ-014, REQ-015             | Optimized instructions shown for accept/reject; recipeRepo.updateInstructions only called on explicit accept | AT-005-B (ATS-005-B9, ATS-005-B10), UTP-014-A           | ⬜     |

---

## Coverage Audit

### Functional Requirements Coverage

| Category                                  | Total REQs | REQs with AT | REQs Inspection-Only                    | REQs with No Coverage | Coverage % |
| ----------------------------------------- | ---------- | ------------ | --------------------------------------- | --------------------- | ---------- |
| Functional (REQ-001 to REQ-015)           | 15         | 15           | 0                                       | 0                     | **100%**   |
| Non-Functional (REQ-NF-001 to REQ-NF-005) | 5          | 3            | 2 (REQ-NF-001, REQ-NF-002 via AT-005-G) | 0                     | **100%**   |
| Interface (REQ-IF-001 to REQ-IF-003)      | 3          | 3            | 0                                       | 0                     | **100%**   |
| Constraint (REQ-CN-001 to REQ-CN-003)     | 3          | 2            | 1 (REQ-CN-001 Inspection)               | 0                     | **100%**   |
| **Total**                                 | **26**     | **23**       | **3**                                   | **0**                 | **100%**   |

> Note: "Inspection-Only" requirements are verified by code review and static analysis, not by executable tests. They are fully covered by their stated verification method. REQ-NF-001 and REQ-NF-002 are Inspection-primary but also covered by AT-005-G scenarios.

### Unit Test Coverage

| MOD-ID    | Module                               | UTP Cases | UTS Scenarios | Techniques Applied                                                                      |
| --------- | ------------------------------------ | --------- | ------------- | --------------------------------------------------------------------------------------- |
| MOD-001   | ProviderConfigRepository             | 2         | 7             | Statement & Branch, Boundary Value Analysis, Equivalence Partitioning, Strict Isolation |
| MOD-002   | ProviderConfigService                | 2         | 6             | Statement & Branch, Equivalence Partitioning, Strict Isolation                          |
| MOD-003   | ProviderSetupGuide                   | 1         | 2             | Strict Isolation                                                                        |
| MOD-004   | AIProviderAdapter                    | 1         | 5             | Statement & Branch, Equivalence Partitioning, Strict Isolation                          |
| MOD-005   | RecipeGenerationService              | 1         | 2             | Statement & Branch, Strict Isolation                                                    |
| MOD-006   | RecipePreviewController              | 2         | 7             | Statement & Branch, State Transition, Equivalence Partitioning, Strict Isolation        |
| MOD-007   | RecipePersistenceAdapter             | 1         | 3             | Statement, Equivalence Partitioning, Strict Isolation                                   |
| MOD-008   | OAuthAuthorizationServer             | 2         | 4             | Statement & Branch, Strict Isolation                                                    |
| MOD-009   | AgentConsentManager                  | 2         | 5             | Statement, Equivalence Partitioning, Strict Isolation                                   |
| MOD-010   | AgentTokenValidator                  | 1         | 3             | Statement & Branch, Strict Isolation                                                    |
| MOD-011   | AgentRecipeReadController            | 1         | 2             | Statement & Branch, Strict Isolation                                                    |
| MOD-012   | AgentRecipeCreateController          | 1         | 2             | Statement & Branch, Equivalence Partitioning, Strict Isolation                          |
| MOD-013   | InstructionOptimizerService          | 1         | 3             | Statement & Branch, Strict Isolation                                                    |
| MOD-014   | OptimizationReviewController         | 1         | 3             | Branch, State Transition, Strict Isolation                                              |
| MOD-015   | AuthGuardMiddleware [EXTERNAL]       | 0         | —             | _(Integration tests only)_                                                              |
| MOD-016   | PremiumEntitlementGuard [EXTERNAL]   | 0         | —             | _(Integration tests only)_                                                              |
| MOD-017   | TypeSafetyAndA11yEnforcer [EXTERNAL] | 0         | —             | _(Build/lint enforcement only)_                                                         |
| MOD-018   | OAuthClientRegistry                  | 1         | 3             | Statement, Equivalence Partitioning, Strict Isolation                                   |
| MOD-019   | ProviderConfigController             | 1         | 3             | Statement & Branch, Strict Isolation                                                    |
| MOD-020   | TokenDenylist                        | 1         | 4             | Statement, Equivalence Partitioning, Strict Isolation                                   |
| **Total** | —                                    | **22**    | **58**        | All 5 ISO 29119-4 techniques represented                                                |

### Acceptance Test Coverage

| Tier                                    | AT Cases       | ATS Scenarios        | Platforms Covered            |
| --------------------------------------- | -------------- | -------------------- | ---------------------------- |
| Functional (AT-005-A through AT-005-F)  | 6 AT cases     | 34 ATS scenarios     | Backend API, Web UI          |
| Non-Functional / Type Safety (AT-005-G) | 1 AT case      | 4 ATS scenarios      | All                          |
| **Total**                               | **7 AT cases** | **38 ATS scenarios** | Backend, Web, Agent Platform |

---

## Orphan & Gap Report

### Orphan Analysis

**Orphan ATs** (acceptance tests with no corresponding REQ):

> None identified. All AT cases in `acceptance-plan.md` map to one or more REQ-\* identifiers via the requirement field on each AT section.

**Orphan UTPs** (unit test cases with no corresponding MOD):

> None identified. All UTP cases in `unit-test.md` map to a MOD-NNN identifier via the "Parent Architecture Modules" field.

**Orphan REQs** (requirements with no verification path):

> None identified. All 26 requirements have at least one verification method (Test, Inspection, or Analysis).

### Gap Analysis

**Requirements with no executable acceptance test (Inspection only)**:

These requirements are verified by code review, static analysis, or architectural analysis — not by executable test scenarios. They are **not gaps** but are flagged for completeness:

| REQ-ID     | Verification Method              | Risk Level | Mitigation                                                                                          |
| ---------- | -------------------------------- | ---------- | --------------------------------------------------------------------------------------------------- |
| REQ-NF-001 | Inspection (+ AT-005-G1 partial) | Low        | TypeScript strict mode enforced by CI (`tsc --strict`); AT-005-G1 provides executable coverage      |
| REQ-NF-002 | Inspection (+ AT-005-G2 partial) | Low        | JSDoc coverage reviewable via ESLint JSDoc plugin; AT-005-G2 provides executable coverage           |
| REQ-NF-004 | Inspection (+ AT-005-G4 partial) | Medium     | WCAG color contrast requires manual or automated a11y audit; AT-005-G4 provides lint-based coverage |
| REQ-CN-001 | Inspection                       | Low        | Hard dependency on spec 001 Recipe entities; verifiable by schema review and import analysis        |

**Modules with no unit test coverage (external/cross-cutting)**:

| Gap                               | Description                                      | Risk   | Recommendation                                                                                                          |
| --------------------------------- | ------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------- |
| MOD-015 AuthMiddleware            | No UTP defined — thin `ClerkAuthService` wrapper | High   | Integration tests cover end-to-end token validation; define integration test cases for all /ai/_ and /agent/_ endpoints |
| MOD-016 PremiumEntitlementGuard   | No UTP defined — subscription service wrapper    | Medium | Integration tests cover entitlement checks; define integration test cases for premium-gated endpoints                   |
| MOD-017 TypeSafetyAndA11yEnforcer | No UTP defined — build/lint enforcement          | Low    | Build step verifies compliance; AT-005-G provides executable coverage                                                   |

**Integration test gaps**:

All 13 integration points identified in Matrix C lack defined integration test cases. Integration tests are required to verify cross-module contracts and are not covered by the current unit test plan or acceptance test plan.

**Recommendation**: Create an integration test plan (`integration-test.md`) covering the 13 integration points in Matrix C before implementation begins. Priority order:

1. **Critical**: ProviderConfigRepository AES-256-GCM round-trip (HAZ-001, HAZ-002)
2. **Critical**: AuthGuardMiddleware enforcement on all AI/agent endpoints (HAZ-009)
3. **High**: OAuthAuthorizationServer → Clerk PKCE flow (HAZ-005, HAZ-006)
4. **High**: AgentConsentManager → TokenDenylist revocation chain (HAZ-007)
5. **Medium**: RecipeGenerationService → AIProviderAdapter latency boundary (REQ-003)

---

_Traceability matrix generated from source artifacts dated 2026-05-09. Re-baseline required after any requirement change, acceptance plan update, or unit test plan amendment._
