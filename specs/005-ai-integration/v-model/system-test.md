# System Test Plan: AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-05-09
**Status**: Draft
**Standard**: ISO/IEC/IEEE 29119-3
**Source**: `specs/005-ai-integration/v-model/system-design.md`

---

## Overview

This System Test Plan verifies that every system component (`SYS-NNN`) defined in `system-design.md` behaves as architecturally designed. Unlike acceptance tests (which verify user stories), these tests target the IEEE 1016 design views — Decomposition, Dependency, Interface, and Data Design — using named ISO 29119 techniques.

**Total System Components**: 8 (SYS-001 through SYS-008)
**Total Test Cases (STP)**: 24
**Total Test Scenarios (STS)**: 48

---

## ID Schema

- **STP-NNN**: System Test Plan item — one per test case
- **STS-NNN-X**: System Test Scenario — executable scenario within a test case
- **Technique**: Named ISO 29119-4 technique applied

---

## Technique Legend

| Code | ISO 29119-4 Technique      |
| ---- | -------------------------- |
| EP   | Equivalence Partitioning   |
| BVA  | Boundary Value Analysis    |
| DT   | Decision Table Testing     |
| ST   | State Transition Testing   |
| FI   | Fault Injection            |
| IC   | Interface Contract Testing |
| PT   | Performance Testing        |
| SC   | Security Testing           |

---

## SYS-001 — AI Provider Config Manager

> Stores, retrieves, and deletes user BYOK AI provider credentials. Persists only an AWS Secrets Manager ARN — the raw key never enters Postgres. Guides users through setup when no provider is configured.

#### Test Case: STP-001-A (Provider CRUD Operations)

**Technique**: Equivalence Partitioning + Decision Table Testing
**Parent Requirements**: REQ-001, REQ-007, REQ-NF-005
**Design View**: Decomposition View, Interface View (Provider Config CRUD)

| Condition                   | STS-001-A1  | STS-001-A2      | STS-001-A3      | STS-001-A4   |
| --------------------------- | ----------- | --------------- | --------------- | ------------ |
| Provider type valid         | Y           | N               | Y               | Y            |
| API key non-empty           | Y           | Y               | N               | Y            |
| Provider already configured | N           | N               | N               | Y            |
| **Expected**                | 201 Created | 400 Bad Request | 400 Bad Request | 409 Conflict |

**STS-001-A1**: POST `/api/v1/ai/byok/keys` with `{ provider: "openai", apiKey: "sk-valid-key" }` for a user with no existing config → expect HTTP 201, response `{ providerId, provider: "openai", maskedKey: "sk-***" }`.

**STS-001-A2**: POST `/api/v1/ai/byok/keys` with `{ provider: "", apiKey: "sk-valid-key" }` → expect HTTP 400 with validation error body.

**STS-001-A3**: POST `/api/v1/ai/byok/keys` with `{ provider: "gemini", apiKey: "" }` → expect HTTP 400 with validation error body.

**STS-001-A4**: POST `/api/v1/ai/byok/keys` with valid payload for a user who already has a provider configured → expect HTTP 409 Conflict.

---

#### Test Case: STP-001-B (Credential Custody: No Key Material in the Application Database)

**Technique**: Security Testing
**Parent Requirements**: REQ-NF-005
**Design View**: Data Design View (`user_byok_keys` — Secrets Manager ARN reference only)

> **Revised 2026-08-02.** This test previously asserted that the stored value was an **AES-256
> ciphertext blob** in an `ai_provider_configs.api_key` column — a table name that appears nowhere else
> in the artifact set, and a design rejected by `plan.md` §2.2 / FR-015. The requirement is stronger
> than "encrypted at rest": the raw key must **never be in Postgres in any form**, ciphertext included.
> Asserting "is ciphertext" would have PASSED against the rejected design and FAILED against the
> approved one.

**STS-001-B1**: Store a BYOK key via `POST /api/v1/ai/byok/keys`. Query the `user_byok_keys` table directly (test DB connection). Assert: the row contains a `secret_arn` matching `^arn:aws:secretsmanager:`; the table has **no** `encrypted_api_key` or `api_key` column at all; and no column value in the row contains the submitted key as a substring.

**STS-001-B2**: Retrieve the key list via `GET /api/v1/ai/byok/keys`. Assert the response contains provider metadata only — no plaintext key, no ciphertext, and **no `secretArn`** in any field.

**STS-001-B3**: Assert the raw key is retrievable **only** from Secrets Manager under `byok/{userId}/{provider}`, and that the value there equals the submitted key. This is the positive half — without it, a service that silently discarded the key would pass STS-001-B1 and STS-001-B2.

**STS-001-B4**: Delete the key via `DELETE /api/v1/ai/byok/keys/openai`. Assert the `user_byok_keys` row is gone **and** the Secrets Manager secret is deleted — no orphaned key material survives teardown.

---

#### Test Case: STP-001-C (Provider Deletion and Retrieval After Delete)

**Technique**: State Transition Testing
**Parent Requirements**: REQ-001
**Design View**: Decomposition View (SYS-001 lifecycle states: absent → configured → deleted)

**STS-001-C1**: State: no provider configured. GET `/api/v1/ai/byok/keys` → expect HTTP 404 or empty response indicating no provider.

**STS-001-C2**: State: provider configured. DELETE `/api/v1/ai/byok/keys` → expect HTTP 204 No Content.

**STS-001-C3**: State: after deletion. GET `/api/v1/ai/byok/keys` → expect HTTP 404 or empty response (same as initial state).

---

#### Test Case: STP-001-D (Setup Guidance When No Provider Configured)

**Technique**: Equivalence Partitioning
**Parent Requirements**: REQ-007
**Design View**: Decomposition View (SYS-001 guides users through setup)

**STS-001-D1**: Authenticated user with no provider configured attempts GET `/api/v1/ai/generate/recipe` (recipe generation). Assert response is HTTP 422 with error code `NO_PROVIDER_CONFIGURED` and a body containing a setup guidance URL or message.

**STS-001-D2**: Authenticated user with a valid provider configured attempts GET `/api/v1/ai/generate/recipe`. Assert response is NOT 422 `NO_PROVIDER_CONFIGURED` (generation proceeds normally).

---

## SYS-002 — AI Recipe Generator

> Accepts recipe generation criteria, dispatches to the user's configured AI provider, and returns a structured recipe result within 15 seconds.

#### Test Case: STP-002-A (Recipe Generation Happy Path)

**Technique**: Interface Contract Testing
**Parent Requirements**: REQ-002, REQ-003
**Design View**: Interface View (Recipe Generation Request — REST)

**STS-002-A1**: POST `/api/v1/ai/generate/recipe` with `{ ingredients: ["chicken", "lemon"], dietaryRestrictions: ["gluten-free"], cuisine: "Mediterranean", calorieTarget: 500 }` for a user with a valid provider config. Assert HTTP 200 and response body matches `{ recipe: { title: string, ingredients: [], instructions: [], ... } }` (RecipeDraft schema).

**STS-002-A2**: POST `/api/v1/ai/generate/recipe` with minimal valid payload `{ ingredients: ["pasta"] }` (all optional fields omitted). Assert HTTP 200 and a valid RecipeDraft is returned.

---

#### Test Case: STP-002-B (Recipe Generation Latency Constraint)

**Technique**: Performance Testing
**Parent Requirements**: REQ-003, REQ-CN-003
**Design View**: Decomposition View (SYS-002 — 15-second SLA)

**STS-002-B1**: POST `/api/v1/ai/generate/recipe` with a valid payload. Measure wall-clock time from request send to response received. Assert total elapsed time ≤ 15,000 ms. Run 5 consecutive requests; all must pass.

**STS-002-B2**: Simulate AI provider response latency of exactly 14,900 ms (via test stub). Assert the system returns a valid response (not a timeout error).

---

#### Test Case: STP-002-C (Generation Timeout Handling)

**Technique**: Fault Injection
**Parent Requirements**: REQ-003
**Design View**: Dependency View (SYS-002 → SYS-001 failure: "no provider configured")

**STS-002-C1**: Inject a 16-second delay in the AI provider stub. POST `/api/v1/ai/generate/recipe`. Assert HTTP 504 Gateway Timeout is returned and no partial recipe is persisted.

**STS-002-C2**: Inject a network error (connection refused) in the AI provider stub. POST `/api/v1/ai/generate/recipe`. Assert HTTP 502 or 503 is returned with an appropriate error body; no recipe is persisted.

---

#### Test Case: STP-002-D (Premium Subscription Gate)

**Technique**: Decision Table Testing
**Parent Requirements**: REQ-CN-003
**Design View**: Decomposition View (SYS-002 — premium constraint)

| User has premium subscription | Expected                     |
| ----------------------------- | ---------------------------- |
| Yes                           | 200 OK — generation proceeds |
| No                            | 402 Payment Required         |

**STS-002-D1**: Authenticated user WITH active premium subscription. POST `/api/v1/ai/generate/recipe` with valid payload → expect HTTP 200 and a RecipeDraft.

**STS-002-D2**: Authenticated user WITHOUT premium subscription. POST `/api/v1/ai/generate/recipe` → expect HTTP 402 with error code `PREMIUM_REQUIRED`.

---

## SYS-003 — AI Recipe Preview & Save Flow

> Presents AI-generated recipe results for user review. Allows accept (save) or decline (discard). No recipe persisted without explicit user acceptance.

#### Test Case: STP-003-A (Accept Flow Persists Recipe)

**Technique**: Interface Contract Testing
**Parent Requirements**: REQ-004, REQ-005, REQ-012
**Design View**: Interface View (SYS-003 ← SYS-002 ReceiveGeneratedRecipe)

**STS-003-A1**: After a successful generation (SYS-002), POST `/api/v1/ai/generate/recipe/{jobId}/accept` with the `draftId` returned. Assert HTTP 201 and a new Recipe entity exists in the database owned by the requesting user, with `visibility: "private"`.

**STS-003-A2**: Accepted recipe is retrievable via the standard recipe GET endpoint (`GET /api/v1/recipes/:id`) by the owning user. Assert HTTP 200 and recipe data matches the accepted draft.

---

#### Test Case: STP-003-B (Decline Flow Discards Recipe)

**Technique**: Equivalence Partitioning
**Parent Requirements**: REQ-006
**Design View**: Decomposition View (SYS-003 — no persistence on decline)

**STS-003-B1**: After a successful generation, POST `/api/v1/ai/generate/recipe/{jobId}/decline` with the `draftId`. Assert HTTP 204 No Content.

**STS-003-B2**: After decline, attempt GET `/api/v1/recipes/:id` for the declined draft's ID. Assert HTTP 404 — no recipe was persisted.

**STS-003-B3**: After decline, query the database directly for any recipe row matching the draft content. Assert zero rows found.

---

#### Test Case: STP-003-C (Recipe Ownership Enforcement)

**Technique**: Security Testing
**Parent Requirements**: REQ-012
**Design View**: Data Design View (AI-Generated Recipe — user-owned, private)

**STS-003-C1**: User A generates and accepts a recipe. User B (different authenticated user) attempts GET `/api/v1/recipes/:id` for User A's recipe. Assert HTTP 403 or 404 — cross-user access is denied.

**STS-003-C2**: Accepted AI-generated recipe has `ownerId` matching the requesting user's ID and `visibility: "private"` in the database row.

#### Test Case: STP-003-D (Sanity validation surfaces warnings without blocking)

**Technique**: Decision Table Testing
**Parent Requirements**: REQ-016
**Design View**: Decomposition View (SYS-003 preview gate)

**STS-003-D1**: Submit a draft with an implausible quantity. Assert the preview response carries a warning entry AND that a subsequent save succeeds — warnings must never gate persistence.

**STS-003-D2**: Submit a clean draft. Assert zero warnings and that the confidence indicator reports a clean validation result.

---

#### Test Case: STP-003-E (Regenerate from preview)

**Technique**: State Transition Testing
**Parent Requirements**: REQ-017
**Design View**: Decomposition View (SYS-003 preview lifecycle: draft → regenerated → accepted/declined)

**STS-003-E1**: From a displayed preview, trigger regenerate. Assert a new draft is produced from the original criteria and the prior draft is discarded unpersisted.

**STS-003-E2**: Trigger regenerate while one is in flight. Assert `429` — the same per-user concurrency limit as an initial generation.

---

## SYS-004 — OAuth 2.0 Authorization Server

> Implements OAuth 2.0 authorization code flow for external agents. Issues scoped access tokens. Manages user consent grants and revocations.

#### Test Case: STP-004-A (Authorization Code Flow Happy Path)

**Technique**: Interface Contract Testing
**Parent Requirements**: REQ-010, REQ-013, REQ-IF-001, REQ-IF-002
**Design View**: Interface View (OAuth Authorization Endpoint)

**STS-004-A1**: GET `/oauth/authorize?client_id=test-agent&redirect_uri=https://agent.example.com/callback&scope=recipes:read&state=abc123&response_type=code`. Assert HTTP 302 redirect to the consent UI (or directly to `redirect_uri` with `code` param in test mode).

**STS-004-A2**: Exchange authorization code via POST `/oauth/token` with `{ grant_type: "authorization_code", code, redirect_uri, client_id, client_secret }`. Assert HTTP 200 with `{ access_token, token_type: "Bearer", expires_in, scope: "recipes:read" }`.

---

#### Test Case: STP-004-B (Scope Enforcement)

**Technique**: Decision Table Testing
**Parent Requirements**: REQ-IF-002
**Design View**: Interface View (OAuth scopes: `recipes:read`, `recipes:create`)

| Requested Scope               | Granted Scope      | Expected Token Scope          |
| ----------------------------- | ------------------ | ----------------------------- |
| `recipes:read`                | User approves      | `recipes:read`                |
| `recipes:create`              | User approves      | `recipes:create`              |
| `recipes:read recipes:create` | User approves both | `recipes:read recipes:create` |
| `admin:all`                   | N/A                | 400 invalid_scope             |

**STS-004-B1**: Request token with `scope=recipes:read` → token introspection returns `scope: "recipes:read"` only.

**STS-004-B2**: Request token with `scope=recipes:create` → token introspection returns `scope: "recipes:create"` only.

**STS-004-B3**: Request token with `scope=recipes:read recipes:create` → token introspection returns both scopes.

**STS-004-B4**: Request token with `scope=admin:all` → HTTP 400 `{ error: "invalid_scope" }`.

---

#### Test Case: STP-004-C (Consent Revocation)

**Technique**: State Transition Testing
**Parent Requirements**: REQ-013
**Design View**: Decomposition View (SYS-004 — consent lifecycle: granted → revoked)

**STS-004-C1**: State: active grant. DELETE `/oauth/grants/:grantId` (user revokes). Assert HTTP 204.

**STS-004-C2**: State: after revocation. Use the previously issued access token to call `POST /api/v1/ai/mcp` (agent tools). Assert HTTP 401 Unauthorized — token is no longer valid.

**STS-004-C3**: State: after revocation. Attempt to exchange the refresh token (if issued). Assert HTTP 400 `{ error: "invalid_grant" }`.

---

#### Test Case: STP-004-D (Invalid OAuth Requests)

**Technique**: Boundary Value Analysis
**Parent Requirements**: REQ-010, REQ-IF-001
**Design View**: Interface View (OAuth Authorization Endpoint — error handling)

**STS-004-D1**: GET `/oauth/authorize` with missing `client_id` → HTTP 400 `{ error: "invalid_request" }`.

**STS-004-D2**: GET `/oauth/authorize` with `redirect_uri` not matching registered URIs → HTTP 400 `{ error: "invalid_request" }`.

**STS-004-D3**: POST `/oauth/token` with expired authorization code (> 10 minutes old) → HTTP 400 `{ error: "invalid_grant" }`.

---

## SYS-005 — External Agent API

> Exposes OAuth 2.0-protected REST endpoints for authorized agents to read and create recipes. Rejects unauthorized requests.

#### Test Case: STP-005-A (Agent Recipe Read)

**Technique**: Interface Contract Testing
**Parent Requirements**: REQ-008, REQ-IF-003
**Design View**: Interface View (Agent Recipes Read)

**STS-005-A1**: GET `POST /api/v1/ai/mcp` (agent tools) with valid Bearer token (scope: `recipes:read`). Assert HTTP 200 and response body `{ recipes: Recipe[] }` where each recipe is a structured JSON object matching the Recipe schema.

**STS-005-A2**: GET `POST /api/v1/ai/mcp` (agent tools) with valid Bearer token (scope: `recipes:read`) for a user with zero recipes. Assert HTTP 200 and `{ recipes: [] }`.

---

#### Test Case: STP-005-B (Agent Recipe Create)

**Technique**: Interface Contract Testing
**Parent Requirements**: REQ-009, REQ-012
**Design View**: Interface View (Agent Recipe Create)

**STS-005-B1**: POST `POST /api/v1/ai/mcp` (agent tools) with valid Bearer token (scope: `recipes:create`) and `{ recipe: { title: "Agent Pasta", ingredients: [...], instructions: [...] } }`. Assert HTTP 201 and `{ recipeId: string }`. Verify recipe exists in DB with `ownerId` = token's user and `visibility: "private"`.

**STS-005-B2**: POST `POST /api/v1/ai/mcp` (agent tools) with valid Bearer token (scope: `recipes:create`) and invalid recipe body (missing `title`). Assert HTTP 422 Unprocessable Entity.

---

#### Test Case: STP-005-C (Unauthorized Agent Requests)

**Technique**: Security Testing + Fault Injection
**Parent Requirements**: REQ-011
**Design View**: Dependency View (SYS-005 → SYS-004: ValidateAgentToken failure)

**STS-005-C1**: GET `POST /api/v1/ai/mcp` (agent tools) with no Authorization header → HTTP 401 Unauthorized.

**STS-005-C2**: GET `POST /api/v1/ai/mcp` (agent tools) with a malformed Bearer token (`Bearer not-a-jwt`) → HTTP 401 Unauthorized.

**STS-005-C3**: GET `POST /api/v1/ai/mcp` (agent tools) with a valid JWT signed by a different key (forged token) → HTTP 401 Unauthorized.

**STS-005-C4**: POST `POST /api/v1/ai/mcp` (agent tools) with a token scoped only to `recipes:read` (wrong scope for create) → HTTP 403 Forbidden.

---

## SYS-006 — AI Instruction Optimizer

> Accepts a recipe and optimization mode (simplify/streamline). Calls the user's configured AI provider. Returns optimized instructions for user review.

#### Test Case: STP-006-A (Optimization Happy Path)

**Technique**: Interface Contract Testing
**Parent Requirements**: REQ-014, REQ-015
**Design View**: Interface View (Instruction Optimization Request)

**STS-006-A1**: POST `/api/v1/ai/recipes/{id}/optimize` with `{ recipeId: "<owned-recipe-id>", mode: "simplify" }` for a premium user with a valid provider config. Assert HTTP 200 and `{ optimizedInstructions: string[] }` where the array is non-empty.

**STS-006-A2**: POST `/api/v1/ai/recipes/{id}/optimize` with `{ recipeId: "<owned-recipe-id>", mode: "streamline" }`. Assert HTTP 200 and `{ optimizedInstructions: string[] }`.

---

#### Test Case: STP-006-B (Optimization Mode Boundary)

**Technique**: Boundary Value Analysis + Equivalence Partitioning
**Parent Requirements**: REQ-014
**Design View**: Interface View (mode: `'simplify' | 'streamline'`)

**STS-006-B1**: POST `/api/v1/ai/recipes/{id}/optimize` with `mode: "simplify"` → HTTP 200 (valid partition).

**STS-006-B2**: POST `/api/v1/ai/recipes/{id}/optimize` with `mode: "streamline"` → HTTP 200 (valid partition).

**STS-006-B3**: POST `/api/v1/ai/recipes/{id}/optimize` with `mode: "rewrite"` (invalid value) → HTTP 422 Unprocessable Entity.

**STS-006-B4**: POST `/api/v1/ai/recipes/{id}/optimize` with `mode: ""` (empty string) → HTTP 422 Unprocessable Entity.

---

#### Test Case: STP-006-C (Optimization Ownership and Premium Gate)

**Technique**: Decision Table Testing
**Parent Requirements**: REQ-014, REQ-CN-003
**Design View**: Decomposition View (SYS-006 — premium + ownership constraints)

| User owns recipe | User has premium | Expected               |
| ---------------- | ---------------- | ---------------------- |
| Yes              | Yes              | 200 OK                 |
| Yes              | No               | 402 Payment Required   |
| No               | Yes              | 422 (recipe not owned) |
| No               | No               | 402 Payment Required   |

**STS-006-C1**: Premium user, owned recipe → HTTP 200 with optimized instructions.

**STS-006-C2**: Non-premium user, owned recipe → HTTP 402 `PREMIUM_REQUIRED`.

**STS-006-C3**: Premium user, recipe owned by another user → HTTP 422 with error code `RECIPE_NOT_OWNED`.

**STS-006-C4**: Non-premium user, recipe owned by another user → HTTP 402 `PREMIUM_REQUIRED` (premium check fires first).

---

#### Test Case: STP-006-D (Optimization Provider Failure)

**Technique**: Fault Injection
**Parent Requirements**: REQ-014
**Design View**: Dependency View (SYS-006 → SYS-001: NoProviderConfiguredError)

**STS-006-D1**: Premium user with NO provider configured. POST `/api/v1/ai/recipes/{id}/optimize` → HTTP 422 with error code `NO_PROVIDER_CONFIGURED`.

**STS-006-D2**: Premium user with valid provider. Inject AI provider timeout (> 15 s). POST `/api/v1/ai/recipes/{id}/optimize` → HTTP 504 Gateway Timeout. Assert no changes applied to the original recipe.

---

## SYS-007 — Cross-Cutting: Auth Guard

> Enforces authentication on all AI and agent endpoints. Delegates to `002-user-auth`. Rejects unauthenticated requests before they reach any AI subsystem.

#### Test Case: STP-007-A (Auth Guard Blocks Unauthenticated Access)

**Technique**: Security Testing + Fault Injection
**Parent Requirements**: REQ-CN-002, REQ-NF-001, REQ-NF-002
**Design View**: Dependency View (SYS-002/SYS-005/SYS-004/SYS-006/SYS-001 → SYS-007)

**STS-007-A1**: POST `/api/v1/ai/generate/recipe` with no session cookie / no Authorization header → HTTP 401. Assert the AI generator (SYS-002) is never invoked (no provider lookup occurs).

**STS-007-A2**: POST `/api/v1/ai/recipes/{id}/optimize` with no auth → HTTP 401. Assert SYS-006 is never invoked.

**STS-007-A3**: GET `/oauth/authorize` with no auth → HTTP 401 or redirect to login. Assert SYS-004 consent flow is not initiated.

**STS-007-A4**: GET `POST /api/v1/ai/mcp` (agent tools) with no auth → HTTP 401. Assert SYS-005 is never invoked.

**STS-007-A5**: POST `/api/v1/ai/byok/keys` with no auth → HTTP 401. Assert SYS-001 is never invoked.

---

## SYS-008 — Cross-Cutting: Type Safety & Accessibility

> Enforces TypeScript strict mode, JSDoc coverage, accessible UI component contracts, and color-independent state indicators.

#### Test Case: STP-008-A (Accessible UI Component Contracts)

**Technique**: Interface Contract Testing + Equivalence Partitioning
**Parent Requirements**: REQ-NF-001, REQ-NF-002, REQ-NF-003, REQ-NF-004
**Design View**: Decomposition View (SYS-008 — accessible UI contracts)

**STS-008-A1**: Render the AI provider setup UI component in a Playwright test. Assert `getByRole('form')` or `getByLabel('AI Provider Setup')` resolves without error — accessible name is queryable.

**STS-008-A2**: Render the recipe generation result preview component. Assert all interactive controls (Accept / Decline buttons) are queryable via `getByRole('button', { name: /accept/i })` and `getByRole('button', { name: /decline/i })`.

**STS-008-A3**: Render the OAuth consent screen component. Assert the consent grant/deny controls are queryable via `getByRole`. Assert that the provider status indicator (configured / not configured) uses an icon or text label in addition to any color change — color is not the sole state conveyor.

**STS-008-A4**: Run `tsc --noEmit --strict` on all TypeScript files introduced by this feature. Assert zero type errors. Assert no `any` usage outside explicitly marked test doubles (grep for undecorated `any`).

---

## Traceability Matrix

| SYS ID  | SYS Name                                   | STP IDs                                    | Techniques Used     |
| ------- | ------------------------------------------ | ------------------------------------------ | ------------------- |
| SYS-001 | AI Provider Config Manager                 | STP-001-A, STP-001-B, STP-001-C, STP-001-D | EP, DT, SC, ST      |
| SYS-002 | AI Recipe Generator                        | STP-002-A, STP-002-B, STP-002-C, STP-002-D | IC, PT, FI, DT      |
| SYS-003 | AI Recipe Preview & Save Flow              | STP-003-A, STP-003-B, STP-003-C            | IC, EP, SC          |
| SYS-004 | OAuth 2.0 Authorization Server             | STP-004-A, STP-004-B, STP-004-C, STP-004-D | IC, DT, ST, BVA     |
| SYS-005 | External Agent API                         | STP-005-A, STP-005-B, STP-005-C            | IC, SC, FI          |
| SYS-006 | AI Instruction Optimizer                   | STP-006-A, STP-006-B, STP-006-C, STP-006-D | IC, BVA, EP, DT, FI |
| SYS-007 | Cross-Cutting: Auth Guard                  | STP-007-A                                  | SC, FI              |
| SYS-008 | Cross-Cutting: Type Safety & Accessibility | STP-008-A                                  | IC, EP              |

---

## Requirements Coverage

| REQ ID     | Description (abbreviated)                                                      | STP IDs                                    |
| ---------- | ------------------------------------------------------------------------------ | ------------------------------------------ |
| REQ-001    | BYOK provider configuration                                                    | STP-001-A, STP-001-C                       |
| REQ-002    | AI recipe generation                                                           | STP-002-A                                  |
| REQ-003    | 15-second latency SLA                                                          | STP-002-B, STP-002-C                       |
| REQ-004    | Preview before save                                                            | STP-003-A                                  |
| REQ-005    | Save accepted recipes                                                          | STP-003-A                                  |
| REQ-006    | No persistence on decline                                                      | STP-003-B                                  |
| REQ-007    | Setup guidance when no provider                                                | STP-001-D                                  |
| REQ-008    | Agent read API                                                                 | STP-005-A                                  |
| REQ-009    | Agent create API                                                               | STP-005-B                                  |
| REQ-010    | OAuth consent required                                                         | STP-004-A, STP-004-D                       |
| REQ-011    | Reject unauthorized agents                                                     | STP-005-C                                  |
| REQ-012    | AI recipes are private, user-owned                                             | STP-003-A, STP-003-C, STP-005-B            |
| REQ-013    | Revoke agent authorization                                                     | STP-004-C                                  |
| REQ-014    | AI instruction optimization                                                    | STP-006-A, STP-006-B, STP-006-C, STP-006-D |
| REQ-015    | Accept/reject optimized instructions                                           | STP-006-A                                  |
| REQ-NF-001 | TypeScript strict mode                                                         | STP-008-A                                  |
| REQ-NF-002 | JSDoc coverage                                                                 | STP-008-A                                  |
| REQ-NF-003 | Accessible UI components                                                       | STP-008-A                                  |
| REQ-NF-004 | Color not sole state conveyor                                                  | STP-008-A                                  |
| REQ-NF-005 | Credentials encrypted at rest (Secrets Manager; no key material in the app DB) | STP-001-B                                  |
| REQ-IF-001 | OAuth 2.0 authorization code flow                                              | STP-004-A, STP-004-D                       |
| REQ-IF-002 | `recipes:read` and `recipes:create` scopes                                     | STP-004-B                                  |
| REQ-IF-003 | Structured recipe format for agents                                            | STP-005-A                                  |
| REQ-CN-002 | Auth required for all AI endpoints                                             | STP-007-A                                  |
| REQ-CN-003 | Premium subscription gate                                                      | STP-002-D, STP-006-C, STP-006-D            |

---

## Coverage Summary

| Metric                          | Count                           |
| ------------------------------- | ------------------------------- |
| System Components (SYS) covered | 8 / 8 (100%)                    |
| Test Cases (STP)                | 24                              |
| Test Scenarios (STS)            | 48                              |
| Requirements covered            | 25 / 25 (100%)                  |
| ISO 29119-4 Techniques applied  | EP, BVA, DT, ST, FI, IC, PT, SC |
