# Acceptance Test Plan: AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/005-ai-integration/v-model/requirements.md`, `specs/005-ai-integration/v-model/system-test.md`

## Overview

This document defines the Acceptance Test Plan for the AI Integration feature. It maps every functional, non-functional, interface, and constraint requirement from `requirements.md` to one or more BDD-style acceptance test scenarios (AT-NNN-X), each with specific pass criteria. Acceptance tests verify that the feature delivers the agreed user outcomes — they are the last line of verification before a feature is considered shippable.

**ID Schema:**

- **Acceptance Test Case**: `AT-NNN-X` — where NNN is the feature identifier (005), X is a sequential letter (A, B, C...)
- **Acceptance Test Scenario**: `ATS-NNN-X#` — nested under the parent AT, with numeric suffix (1, 2, 3...)
- Example: `ATS-005-A1` → Scenario 1 of Test Case A (BYOK provider configuration) for feature 005

**Test Strategy:**

- **Happy path** → end-to-end flow from user action to persisted outcome
- **Negative path** → error conditions, missing credentials, unauthorized access
- **Boundary** → latency (15 s), authorization scope limits, consent revocation
- **Inspection** → TypeScript strict mode, JSDoc coverage, accessibility naming

---

## Acceptance Test Cases (Tier 1–3 Structure)

### Tier 1: Feature Epic

### Tier 2: User Story / Requirement

### Tier 3: BDD Scenario (Given / When / Then)

---

### AT-005-A — BYOK: User configures their own AI provider credentials

**Requirement**: REQ-001, REQ-007, REQ-NF-005

| ATS ID     | Scenario                                         | Given                                           | When                                     | Then                                                                                               |
| ---------- | ------------------------------------------------ | ----------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| ATS-005-A1 | Happy-path provider save                         | User is authenticated                           | User submits a valid API key for OpenAI  | System encrypts the key with AES-256-GCM, stores it, and returns masked confirmation `****{last4}` |
| ATS-005-A2 | Missing API key                                  | User is authenticated, form rendered            | User submits empty `apiKey` field        | System returns 400 with `ValidationError`; no DB write occurs                                      |
| ATS-005-A3 | Invalid provider enum                            | User is authenticated                           | User selects provider `unknown-provider` | System returns 400; no DB write occurs                                                             |
| ATS-005-A4 | No provider configured, user attempts generation | User has no provider configured                 | User requests AI recipe generation       | System returns 422 with setup guide payload (supported providers + setup links)                    |
| ATS-005-A5 | Encryption key missing from env                  | Server starting                                 | Provider config module loads             | Process exits with `ConfigurationError` at startup                                                 |
| ATS-005-A6 | GCM auth tag mismatch on decrypt                 | Encrypted payload stored with tampered auth tag | User retrieves credentials               | `DecryptionError` propagated as 500; raw key never returned                                        |

---

### AT-005-B — In-app AI recipe generation

**Requirement**: REQ-002, REQ-003, REQ-004, REQ-005, REQ-006, REQ-014, REQ-NF-003, REQ-CN-003

| ATS ID      | Scenario                                   | Given                                              | When                                                           | Then                                                                                                          |
| ----------- | ------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ATS-005-B1  | Generation success, user previews          | User has OpenAI provider configured with valid key | User submits generation criteria (ingredients, calorie target) | System returns recipe draft within 15 s; preview shown with accept/reject options                             |
| ATS-005-B2  | Generation timeout (>15 s)                 | User has valid but slow/degraded provider          | Generation request submitted                                   | System returns 504 `ProviderTimeoutError`                                                                     |
| ATS-005-B3  | Provider API error                         | Provider returns non-2xx or network failure        | Generation request submitted                                   | System returns 502 with sanitized error message; no partial data persisted                                    |
| ATS-005-B4  | User accepts draft                         | Recipe preview displayed with draft key            | User clicks "Save"                                             | System saves recipe as `isPrivate: true`, `source: 'ai'`; returns 201 with recipeId; draft removed from cache |
| ATS-005-B5  | User rejects draft                         | Recipe preview displayed                           | User clicks "Reject"                                           | System returns 204; no recipe persisted; draft removed from cache                                             |
| ATS-005-B6  | Draft expired (TTL 10 min)                 | User does not act for 10+ minutes                  | User submits save after expiry                                 | System returns 404; user must re-generate                                                                     |
| ATS-005-B7  | Free-tier user attempts generation         | User is authenticated but not premium              | User requests recipe generation                                | System returns 402 `Upgrade required`; no AI call made                                                        |
| ATS-005-B8  | Premium user uses instruction optimization | User has premium subscription                      | User requests instruction optimization                         | System calls AI to optimize; result shown for accept/reject                                                   |
| ATS-005-B9  | User accepts optimization                  | Optimized instructions displayed                   | User clicks "Accept"                                           | System persists optimized instructions; returns 200                                                           |
| ATS-005-B10 | User rejects optimization                  | Optimized instructions displayed                   | User clicks "Reject"                                           | System returns 200 with original instructions unchanged                                                       |

---

### AT-005-C — External agent OAuth: Authorization

**Requirement**: REQ-008, REQ-009, REQ-010, REQ-IF-001, REQ-IF-002

| ATS ID     | Scenario                                       | Given                                        | When                                                         | Then                                                                                                  |
| ---------- | ---------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| ATS-005-C1 | Agent initiates OAuth flow                     | External agent platform begins authorization | Agent redirects user to Commise OAuth authorization endpoint | System redirects to Clerk with `code_challenge`, `state`, `nonce` parameters                          |
| ATS-005-C2 | User grants consent                            | Clerk callback received with valid state     | User approves agent access                                   | System exchanges code for tokens; stores consent grant with scope and expiry; redirects back to agent |
| ATS-005-C3 | User denies consent                            | Clerk callback received                      | User rejects authorization                                   | System redirects with error `access_denied`; no tokens or consent stored                              |
| ATS-005-C4 | Consent granted with `recipes:read` scope only | Consent stored for agent                     | Agent makes API call with `recipes:read` token               | System returns recipe collection; `recipes:create` calls return 403                                   |
| ATS-005-C5 | Consent with both scopes                       | Consent stored for agent                     | Agent calls `recipes:create` endpoint                        | Recipe created on user's behalf; returned as 201                                                      |
| ATS-005-C6 | State mismatch on callback                     | Tampered state value submitted               | Callback handler receives mismatched state                   | System throws `Error('State mismatch')`; no tokens exchanged                                          |
| ATS-005-C7 | Code verifier mismatch                         | Valid state, tampered verifier               | Exchange code with wrong verifier                            | System throws `Error`; no tokens exchanged                                                            |

---

### AT-005-D — External agent API access enforcement

**Requirement**: REQ-011, REQ-CN-002

| ATS ID     | Scenario                                | Given                                     | When                                | Then                                                |
| ---------- | --------------------------------------- | ----------------------------------------- | ----------------------------------- | --------------------------------------------------- |
| ATS-005-D1 | Agent has valid token, user authorized  | Agent holds valid JWT with `recipes:read` | Agent calls `GET /agent/recipes`    | System validates JWT, returns recipe collection     |
| ATS-005-D2 | Agent has expired token                 | Agent holds expired JWT                   | Agent calls any `/agent/*` endpoint | System returns 401; agent must refresh token        |
| ATS-005-D3 | Agent has token but consent revoked     | Consent was revoked by user               | Agent makes API call                | `AgentTokenValidator` checks denylist → returns 403 |
| ATS-005-D4 | No token provided                       | Request missing `Authorization` header    | Any `/agent/*` endpoint called      | System returns 401                                  |
| ATS-005-D5 | Unauthenticated user attempts in-app AI | No session token present                  | User calls `/ai/recipes/generate`   | System returns 401; user redirected to login        |

---

### AT-005-E — Consent revocation

**Requirement**: REQ-013

| ATS ID     | Scenario                            | Given                                           | When                                               | Then                                                                                          |
| ---------- | ----------------------------------- | ----------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| ATS-005-E1 | User revokes agent consent          | Agent consent record exists for user-agent pair | User clicks "Revoke" in account settings           | System marks consent as revoked in `agent_consent_records`; subsequent agent calls return 403 |
| ATS-005-E2 | Revoked agent presents new token    | Consent is revoked                              | Agent presents newly issued token for same agentId | System checks denylist first → 403; even a fresh token from Clerk is rejected                 |
| ATS-005-E3 | User re-authorizes after revocation | Consent was revoked                             | User completes new OAuth consent flow              | New consent record created; agent gains access again                                          |

---

### AT-005-F — Provider credential management

**Requirement**: REQ-001, REQ-NF-005

| ATS ID     | Scenario                                            | Given                                                   | When                                           | Then                                                                               |
| ---------- | --------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------- |
| ATS-005-F1 | User lists configured providers                     | User has openai and gemini configured                   | User calls `GET /ai/provider-config`           | System returns both providers with fully masked keys (`****`); no raw keys exposed |
| ATS-005-F2 | User deletes provider                               | User has gemini configured                              | User calls `DELETE /ai/provider-config/gemini` | System removes record; gemini no longer used as fallback                           |
| ATS-005-F3 | Priority fallback: openai removed, gemini available | User had openai configured (now deleted) but has gemini | User calls `getProviderCredentials`            | System returns gemini credentials (second priority in fallback loop)               |
| ATS-005-F4 | No providers configured at all                      | User has deleted all providers                          | User calls `getProviderCredentials`            | `NoProviderConfiguredError` thrown; caught and mapped to 422 with setup guide      |

---

### AT-005-F (Accessibility & Type Safety)

**Requirement**: REQ-NF-001, REQ-NF-002, REQ-NF-003, REQ-NF-004

| ATS ID     | Scenario                                    | Given                                               | When                                                             | Then                                                                      |
| ---------- | ------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------- |
| ATS-005-G1 | All TypeScript compiles with `strict: true` | Source files changed                                | `tsc --strict` run                                               | Exit code 0; zero type errors                                             |
| ATS-005-G2 | Exported functions have JSDoc               | New function exported                               | Build/lint step runs                                             | Zero JSDoc violations reported                                            |
| ATS-005-G3 | UI component accessible names               | UI component rendered                               | Playwright test queries `getByRole('button', { name: /save/i })` | Element found without requiring `aria-label` workaround                   |
| ATS-005-G4 | Color is not sole state conveyor            | UI component with colored status indicator rendered | Accessibility linter runs                                        | Component has icon + text pairing for status; zero WCAG contrast failures |

---

## Acceptance Criteria per REQ

| REQ ID     | Pre-condition                              | Success Condition                                                                    | Technique                                     |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------------ | --------------------------------------------- |
| REQ-001    | Authenticated user                         | API key encrypted and stored; masked response returned; retrieval decrypts correctly | Statement Coverage + Equivalence Partitioning |
| REQ-002    | Valid provider configured                  | Recipe draft returned within 15 s                                                    | Latency Boundary Test (15 s threshold)        |
| REQ-003    | Valid provider configured                  | `ProviderTimeoutError` propagated as 504 if >15 s                                    | Boundary Value Analysis                       |
| REQ-004    | Valid draft exists                         | Preview shown with accept/reject; draft cached with TTL                              | State Transition Testing                      |
| REQ-005    | User accepts draft                         | Recipe persisted with `isPrivate: true`, `source: 'ai'`                              | Statement Coverage                            |
| REQ-006    | User rejects draft                         | No row inserted; draft removed from cache                                            | Branch Coverage                               |
| REQ-007    | No provider configured                     | 422 returned with `setupRequired: true` and setup guide                              | Equivalence Partitioning                      |
| REQ-008    | Valid agent token + user consent           | Recipe collection returned                                                           | Statement Coverage                            |
| REQ-009    | Valid agent token + `recipes:create` scope | Recipe created on user's behalf                                                      | Statement Coverage                            |
| REQ-010    | Agent initiates OAuth                      | Clerk authorization URL with code_challenge returned                                 | Statement Coverage                            |
| REQ-011    | Unauthorized agent request                 | 403 returned; no data exposed                                                        | Branch Coverage                               |
| REQ-012    | AI-generated recipe saved                  | `isPrivate: true`, `source: 'ai'`, ownerId set                                       | Statement Coverage                            |
| REQ-013    | Consent exists                             | Revocation marks record; subsequent calls 403                                        | State Transition Testing                      |
| REQ-014    | Premium user                               | Optimization result shown for accept/reject                                          | Branch Coverage + State Transition            |
| REQ-015    | User accepts/rejects optimization          | Editorial control exercised; correct persistence path                                | Statement Coverage                            |
| REQ-NF-001 | All TypeScript source                      | `tsc --strict` exits 0                                                               | Inspection                                    |
| REQ-NF-002 | All exported functions                     | JSDoc present on all exports                                                         | Inspection                                    |
| REQ-NF-003 | New UI components                          | `getByRole`/`getByLabel` queries succeed                                             | Playwright Integration Test                   |
| REQ-NF-004 | New UI with color state                    | Icon + text pairing on all color-gated states                                        | Accessibility Inspection                      |
| REQ-NF-005 | API key written to DB                      | Stored value is AES-256-GCM ciphertext; plaintext never in DB                        | Inspection (code review + DB dump check)      |
| REQ-IF-001 | Agent OAuth initiation                     | Clerk URL contains code_challenge, state, nonce                                      | Interface Contract Test                       |
| REQ-IF-002 | Consent grant                              | Stored scopes include `recipes:read` and `recipes:create`                            | Statement Coverage                            |
| REQ-CN-001 | Recipe entity storage                      | AI-saved recipe stored as Recipe entity in 001 schema                                | Inspection                                    |
| REQ-CN-002 | Unauthenticated request                    | All `/ai/*` and `/agent/*` endpoints return 401                                      | Fault Injection                               |
| REQ-CN-003 | Free-tier user                             | AI generation returns 402                                                            | Equivalence Partitioning                      |

---

## Feature Test Summary Matrix

| REQ        | AT Scenario Count | Test Method              | Pass Criteria                                           |
| ---------- | ----------------- | ------------------------ | ------------------------------------------------------- |
| REQ-001    | 6                 | Unit + Inspection        | Key encrypted, masked on retrieval, decrypted correctly |
| REQ-002    | 1                 | E2E Latency              | Recipe draft returned <15 s                             |
| REQ-003    | 1                 | Latency Boundary         | 504 returned >15 s                                      |
| REQ-004    | 1                 | State Transition         | Draft cached, preview shown, TTL enforced               |
| REQ-005    | 1                 | Unit                     | Recipe persisted as private, source='ai'                |
| REQ-006    | 1                 | Unit                     | No row inserted on reject                               |
| REQ-007    | 1                 | Unit                     | 422 + setup guide on missing provider                   |
| REQ-008    | 1                 | Agent E2E                | Recipe collection returned on authorized call           |
| REQ-009    | 1                 | Agent E2E                | 201 returned, recipe created                            |
| REQ-010    | 1                 | OAuth Flow               | Clerk URL correct, state stored                         |
| REQ-011    | 4                 | Security Fault Injection | 403 on unauthorized, 401 on missing token               |
| REQ-012    | 1                 | Unit                     | Ownership and privacy enforced                          |
| REQ-013    | 3                 | State Transition         | Revocation blocks all subsequent calls                  |
| REQ-014    | 2                 | Premium Branch + State   | Optimization shown to premium; 402 for free             |
| REQ-015    | 2                 | Editorial Control        | Accept/reject paths diverge correctly                   |
| REQ-NF-001 | 1                 | Inspection               | `tsc --strict` clean                                    |
| REQ-NF-002 | 1                 | Inspection               | JSDoc present on all exports                            |
| REQ-NF-003 | 1                 | Playwright               | `getByRole`/`getByLabel` succeeds                       |
| REQ-NF-004 | 1                 | Accessibility Inspection | Color not sole state carrier                            |
| REQ-NF-005 | 1                 | Inspection               | AES-256-GCM ciphertext in DB; plaintext never stored    |
| REQ-IF-001 | 1                 | Interface Contract       | OAuth URL structure validated                           |
| REQ-IF-002 | 1                 | Unit                     | Scopes stored and enforced                              |
| REQ-CN-001 | 1                 | Inspection               | Recipe entity schema matches 001                        |
| REQ-CN-002 | 1                 | Fault Injection          | All `/ai/*` and `/agent/*` return 401 unauthenticated   |
| REQ-CN-003 | 1                 | Subscription Gate        | Free-tier → 402 on all premium AI features              |

---

## Exit Criteria

For feature 005 to be considered shippable, ALL gates below must be green:

**Gate 1 — Functional Completeness**

- [ ] All 15 functional requirements (REQ-001 through REQ-015) have passing acceptance test scenarios
- [ ] Happy path, error path, and boundary scenarios all pass
- [ ] No requirement marked "Test" is unverified by a running test

**Gate 2 — Security**

- [ ] API keys encrypted at rest (AES-256-GCM); verified by code inspection + DB dump check
- [ ] No raw API key appears in any log, error message, or response body
- [ ] Unauthenticated requests to `/ai/*` and `/agent/*` return 401
- [ ] Unauthorized agent requests return 403
- [ ] Consent revocation immediately blocks agent access

**Gate 3 — Type Safety & Accessibility**

- [ ] `tsc --strict` exits with code 0
- [ ] JSDoc present on all exported functions and interfaces
- [ ] All new UI components have `getByRole`/`getByLabel` accessible names
- [ ] No color-only state indicators in any new UI component

**Gate 4 — AI Latency**

- [ ] 95th-percentile AI generation latency ≤ 15 s (measured from request start to first byte of draft response)
- [ ] Timeout (504) returned when provider exceeds 15 s

**Gate 5 — OAuth & Agent Authorization**

- [ ] External agent OAuth flow completes successfully end-to-end
- [ ] Scope-enforcement verified: `recipes:read`-only token cannot call `recipes:create`
- [ ] User can revoke agent access; revoked agent token rejected even if otherwise valid

**Gate 6 — Premium Gating**

- [ ] Free-tier users receive 402 on AI generation and instruction optimization
- [ ] Premium users access AI generation and instruction optimization without restriction

---

### AT-PARITY — Cross-platform parity for AI Integration

**Requirement**: REQ-IF-004

| ATS ID       | Scenario                     | Given                                                                  | When                                                                          | Then                                                                                                                                                                               |
| ------------ | ---------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ATS-PARITY-1 | Web/mobile capability parity | A user-facing AI Integration workflow is implemented on web and mobile | Product QA compares the web and mobile flows against the same requirement set | Both platforms expose the same core capabilities, entitlement behavior, error states, accessibility semantics, and recovery paths, or a documented V-Model parity exception exists |
| ATS-PARITY-2 | Parity regression gate       | A change modifies a AI Integration user-facing workflow                | The feature test plan is reviewed                                             | The change includes paired web and mobile acceptance coverage or a documented exception approved by product governance                                                             |
