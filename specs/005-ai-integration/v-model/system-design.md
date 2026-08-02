# System Design: AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/005-ai-integration/v-model/requirements.md`

## Overview

The AI Integration feature decomposes into two primary subsystems: (1) **BYOK In-App AI** — a credential management and provider-dispatch pipeline that stores encrypted user API keys and calls external AI providers to generate and optimize recipes; (2) **External Agent Platform** — an OAuth 2.0 authorization server and scoped API layer that allows third-party agents (ChatGPT GPT Actions, Gemini Extensions) to read and write recipes on behalf of authorized users. Both subsystems produce private, user-owned Recipe entities that integrate with the existing `001-commise-recipe-app` data model and require authentication from `002-user-auth`.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                                       | Description                                                                                                                                                                                                          | Parent Requirements                                              | Type      |
| ------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------- |
| SYS-001 | AI Provider Config Manager                 | Stores, retrieves, and deletes user BYOK AI provider credentials. The raw key is written to AWS Secrets Manager; only the ARN is persisted in PostgreSQL. Guides users through setup when no provider is configured. | REQ-001, REQ-007, REQ-NF-005                                     | Service   |
| SYS-002 | AI Recipe Generator                        | Accepts recipe generation criteria (ingredients, dietary restrictions, cuisine, calorie targets), dispatches to the user's configured AI provider, and returns a structured recipe result within 15 seconds.         | REQ-002, REQ-003, REQ-CN-003                                     | Subsystem |
| SYS-003 | AI Recipe Preview & Save Flow              | Presents AI-generated recipe results to the user for review. Allows the user to accept (save to collection) or decline (discard). Ensures no recipe is persisted without explicit user acceptance.                   | REQ-004, REQ-005, REQ-006, REQ-012, REQ-016, REQ-017, REQ-CN-001 | Module    |
| SYS-004 | OAuth 2.0 Authorization Server             | Implements the OAuth 2.0 authorization code flow for external agent platforms. Issues access tokens scoped to `recipes:read` and/or `recipes:create`. Manages user consent grants and revocations.                   | REQ-010, REQ-013, REQ-IF-001, REQ-IF-002                         | Service   |
| SYS-005 | External Agent API                         | Exposes OAuth 2.0-protected REST endpoints for authorized external agents to read the user's recipe collection and create recipes on their behalf. Rejects unauthorized requests with an authorization error.        | REQ-008, REQ-009, REQ-011, REQ-012, REQ-IF-003                   | Service   |
| SYS-006 | AI Instruction Optimizer                   | Accepts a recipe owned by the user and an optimization mode (simplify language / streamline steps). Calls the user's configured AI provider and returns optimized instructions for user review.                      | REQ-014, REQ-015, REQ-CN-003                                     | Module    |
| SYS-007 | Cross-Cutting: Auth Guard                  | Enforces authentication on all AI and agent endpoints. Delegates to `002-user-auth`. Rejects unauthenticated requests before they reach any AI subsystem.                                                            | REQ-CN-002, REQ-NF-001, REQ-NF-002                               | Utility   |
| SYS-008 | Cross-Cutting: Type Safety & Accessibility | Enforces TypeScript strict mode, JSDoc coverage, accessible UI component contracts, and color-independent state indicators across all AI feature UI components.                                                      | REQ-NF-001, REQ-NF-002, REQ-NF-003, REQ-NF-004, REQ-IF-004       | Utility   |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                                 |
| ------- | ------- | ------------ | ------------------------------------------------------------------------------ |
| SYS-002 | SYS-001 | Reads        | Cannot dispatch to AI provider; generation fails with "no provider configured" |
| SYS-003 | SYS-002 | Calls        | No recipe to preview; generation flow cannot complete                          |
| SYS-005 | SYS-004 | Reads        | Cannot validate agent tokens; all external agent requests rejected             |
| SYS-006 | SYS-001 | Reads        | Cannot call AI provider; optimization fails with "no provider configured"      |
| SYS-002 | SYS-007 | Uses         | Unauthenticated requests reach generator; security violation                   |
| SYS-005 | SYS-007 | Uses         | Unauthenticated requests reach agent API; security violation                   |
| SYS-004 | SYS-007 | Uses         | Unauthenticated users can initiate OAuth flows; security violation             |
| SYS-006 | SYS-007 | Uses         | Unauthenticated requests reach optimizer; security violation                   |
| SYS-001 | SYS-007 | Uses         | Unauthenticated users can read/write credentials; security violation           |

### Dependency Diagram

```text
External User / Agent Platform
        │
        ▼
  [SYS-007: Auth Guard] ──────────────────────────────────────────┐
        │                                                          │
        ├──► [SYS-001: AI Provider Config Manager]                 │
        │           │                                              │
        │           ▼                                              │
        ├──► [SYS-002: AI Recipe Generator] ──► [SYS-003: Preview & Save]
        │                                                          │
        ├──► [SYS-006: AI Instruction Optimizer]                   │
        │                                                          │
        ├──► [SYS-004: OAuth 2.0 Authorization Server]             │
        │           │                                              │
        └──► [SYS-005: External Agent API] ◄──────────────────────┘
                    │
                    ▼
          [001: Recipe Entities / Storage]
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Component | Interface Name                   | Protocol         | Input                                                                                         | Output                                                                  | Error Handling                                                 |
| --------- | -------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| SYS-001   | Provider Config CRUD             | REST             | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ providerId: string, provider: string, maskedKey: string }` (Derived) | 400 validation error; 409 conflict if provider already set     |
| SYS-002   | Recipe Generation Request        | REST             | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ recipe: RecipeDraft }` within 15 s (Derived)                         | 504 timeout; 422 if no provider configured; 402 if not premium |
| SYS-004   | OAuth Authorization Endpoint     | OAuth 2.0 / REST | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Authorization code → access token exchange (Derived)                    | 400 invalid_request; 401 unauthorized; 403 access_denied       |
| SYS-005   | Agent Recipes Read               | REST             | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ recipes: Recipe[] }` structured JSON (Derived)                       | 401 unauthorized; 403 forbidden (wrong scope)                  |
| SYS-005   | Agent Recipe Create              | REST             | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ recipeId: string }` of created recipe (Derived)                      | 401 unauthorized; 403 forbidden; 422 validation error          |
| SYS-006   | Instruction Optimization Request | REST             | Derived — supports cross-cutting implementation constraints for traced parent system behavior | 'streamline' }` (Derived)                                               | `{ optimizedInstructions: string[] }`                          | 402 if not premium; 422 if recipe not owned by user; 504 timeout |

### Internal Interfaces

| Source  | Target  | Interface Name            | Protocol                                                                                      | Data Format                                                                                             | Error Handling                                      |
| ------- | ------- | ------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| SYS-002 | SYS-001 | ResolveProviderCredential | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ userId: string }` → `{ provider, apiKey }` — key fetched just-in-time from Secrets Manager (Derived) | Throws `NoProviderConfiguredError` if not set       |
| SYS-003 | SYS-002 | ReceiveGeneratedRecipe    | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `RecipeDraft` object (Derived)                                                                          | Propagates generation errors to UI                  |
| SYS-005 | SYS-004 | ValidateAgentToken        | Derived — supports cross-cutting implementation constraints for traced parent system behavior | Bearer token string → `{ userId, scopes[] }` (Derived)                                                  | Throws `UnauthorizedError` on invalid/expired token |
| SYS-006 | SYS-001 | ResolveProviderCredential | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{ userId: string }` → `{ provider, apiKey }` — key fetched just-in-time from Secrets Manager (Derived) | Throws `NoProviderConfiguredError` if not set       |
| SYS-002 | SYS-007 | AssertAuthenticated       | Derived — supports cross-cutting implementation constraints for traced parent system behavior | HTTP request context → `{ userId: string }` (Derived)                                                   | Returns 401 if unauthenticated                      |
| SYS-005 | SYS-007 | AssertAuthenticated       | Derived — supports cross-cutting implementation constraints for traced parent system behavior | HTTP request context → `{ userId: string }` (Derived)                                                   | Returns 401 if unauthenticated                      |

## Data Design View (IEEE 1016 §5.4)

| Entity                | Component        | Storage                                          | Protection at Rest                                                                             | Protection in Transit | Retention                                      |
| --------------------- | ---------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------- |
| BYOK Key Reference    | SYS-001          | AWS Secrets Manager (key); PostgreSQL (ARN only) | Secrets Manager KMS envelope encryption; the raw key is NEVER in Postgres, ciphertext included | TLS 1.2+              | Deleted on user account deletion or key revoke |
| Agent Authorization   | SYS-004          | PostgreSQL                                       | Standard DB access controls                                                                    | TLS 1.2+              | Deleted on user revocation or account deletion |
| OAuth Access Token    | SYS-004          | In-memory / JWT                                  | JWT signed with RS256 private key                                                              | TLS 1.2+              | Short-lived (1 hour); refresh token 30 days    |
| AI-Generated Recipe   | SYS-003, SYS-005 | PostgreSQL (via 001 Recipe entity)               | Standard DB access controls                                                                    | TLS 1.2+              | Follows Recipe retention policy from 001       |
| Recipe Generation Log | SYS-002          | None (ephemeral)                                 | N/A                                                                                            | TLS 1.2+              | Not persisted; request/response in-flight only |

---

## Coverage Summary

| Metric                              | Count                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| Total System Components (SYS)       | 8                                                                                     |
| Total Requirements Covered          | 29 / 29 (100%)                                                                        |
| Functional Requirements Covered     | 17 / 17 (100%)                                                                        |
| Non-Functional Requirements Covered | 5 / 5 (100%)                                                                          |
| Interface Requirements Covered      | 4 / 4 (100%)                                                                          |
| Constraint Requirements Covered     | 3 / 3 (100%) — via SYS-007 (auth), SYS-002/SYS-006 (premium), SYS-003 (recipe entity) |
| Components per Type                 | Subsystem: 1 \| Service: 3 \| Module: 2 \| Utility: 2                                 |
| **Forward Coverage (REQ→SYS)**      | **100%**                                                                              |

## Derived Requirements

None — all system components trace to existing requirements.
