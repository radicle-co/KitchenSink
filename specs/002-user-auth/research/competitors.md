# Competitor Analysis: Authentication Platforms

**Branch**: `002-user-auth` | **Date**: 2026-05-09
**Status**: Complete | **Source**: [research.md](../research.md), [plan.md](../plan.md), architecture requirements in [spec.md](../spec.md)

---

## Competitive Landscape Overview

The authentication platform space for SaaS/mobile products is dominated by managed identity providers plus two alternatives: backend-as-a-service auth and fully custom in-house auth. For this feature, the decision surface is shaped by explicit requirements for cross-platform UX, secure token lifecycle, social linking, MFA, suspension enforcement, and reconciliation handling.

---

## Competitor Profiles

### 1. Clerk

| Attribute           | Detail                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Platform Model**  | Managed identity provider with extensible Actions, Universal Login, and Management API                       |
| **Core Strengths**  | Mature web/mobile SDKs, social login breadth, MFA support, lifecycle APIs (block/unblock/link/unlink/delete) |
| **Core Weaknesses** | Vendor dependency and Management API rate-limit handling complexity                                          |
| **Session Model**   | OAuth/OIDC with refresh token rotation options                                                               |
| **Custom Claims**   | Strong support via Actions (`app_metadata` and namespaced claims)                                            |
| **Fit to Feature**  | High — directly aligns with FR-001..FR-044, especially FR-013..FR-017 and FR-041..FR-044                     |

---

### 2. Amazon Cognito

| Attribute           | Detail                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| **Platform Model**  | AWS-native identity provider (User Pools + Identity Pools)                                                          |
| **Core Strengths**  | Tight AWS integration, native JWT flows, competitive cost profile at scale                                          |
| **Core Weaknesses** | UX customization and lifecycle ergonomics generally heavier; social/provider flows can require more platform wiring |
| **Session Model**   | OAuth/OIDC + JWTs with configurable token TTLs                                                                      |
| **Custom Claims**   | Supported via triggers, but customization model differs from Clerk Actions ergonomics                               |
| **Fit to Feature**  | Medium — feasible technically, but would require migration of planned Clerk-centric flow and implementation plan    |

---

### 3. Clerk

| Attribute           | Detail                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Platform Model**  | Developer-first auth with prebuilt UI components and APIs                                                              |
| **Core Strengths**  | Fast frontend integration and polished auth UI primitives                                                              |
| **Core Weaknesses** | Lifecycle controls for advanced backend policies may require additional adaptation in AWS-specific authorizer strategy |
| **Session Model**   | Managed sessions with token support                                                                                    |
| **Custom Claims**   | Supported, but architecture conventions differ from existing plan assumptions                                          |
| **Fit to Feature**  | Medium — strong UX velocity, weaker alignment with existing Clerk user.created webhook and management workflows        |

---

### 4. Supabase Auth

| Attribute           | Detail                                                                                |
| ------------------- | ------------------------------------------------------------------------------------- |
| **Platform Model**  | Auth as part of Supabase BaaS ecosystem                                               |
| **Core Strengths**  | Integrated auth+data stack for teams already standardized on Supabase                 |
| **Core Weaknesses** | Less aligned with AWS/Lambda/API Gateway-first architecture in the current plan       |
| **Session Model**   | JWT-based sessions and refresh flows                                                  |
| **Custom Claims**   | Supported through Supabase mechanisms, not Clerk Actions conventions                  |
| **Fit to Feature**  | Low-Medium — capable, but misaligned with chosen AWS + Clerk operational architecture |

---

### 5. Custom In-House Auth

| Attribute           | Detail                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------- |
| **Platform Model**  | Fully custom auth stack (credential handling, OAuth integrations, MFA, account lifecycle)    |
| **Core Strengths**  | Maximum control and vendor independence                                                      |
| **Core Weaknesses** | Highest implementation and security burden; large surface for compliance and incident risk   |
| **Session Model**   | Fully self-owned; requires complete secure token/key management                              |
| **Custom Claims**   | Fully customizable but entirely self-maintained                                              |
| **Fit to Feature**  | Low — conflicts with timeline and introduces unnecessary risk for an auth foundation feature |

---

## Capability Parity Matrix (Feature 002 Requirements)

| Capability                                               | Clerk | Cognito                  | Clerk                    | Supabase Auth            | Custom   |
| -------------------------------------------------------- | ----- | ------------------------ | ------------------------ | ------------------------ | -------- |
| Web + mobile PKCE flows (FR-001..FR-005)                 | ✅    | ✅                       | ✅                       | ✅                       | ⚠️ build |
| Secure token storage conventions (FR-006)                | ✅    | ✅                       | ✅                       | ✅                       | ⚠️ build |
| Silent refresh + reauth handling (FR-007..FR-009)        | ✅    | ✅                       | ✅                       | ✅                       | ⚠️ build |
| Logout + token revocation (FR-010..FR-012)               | ✅    | ✅                       | ✅                       | ✅                       | ⚠️ build |
| Post-signup ID sync workflow (FR-013..FR-017)            | ✅    | ⚠️ custom trigger model  | ⚠️ adapter needed        | ⚠️ adapter needed        | ⚠️ build |
| Account profile/edit/deletion lifecycle (FR-018..FR-026) | ✅    | ✅                       | ✅                       | ✅                       | ⚠️ build |
| Password reset and MFA (FR-027..FR-031)                  | ✅    | ✅                       | ✅                       | ✅                       | ⚠️ build |
| Social link/unlink semantics (FR-032..FR-034)            | ✅    | ⚠️ more integration work | ✅                       | ⚠️ integration-specific  | ⚠️ build |
| Impersonation and audit controls (FR-035..FR-037)        | ✅    | ⚠️ custom implementation | ⚠️ custom implementation | ⚠️ custom implementation | ⚠️ build |
| Suspension + authorizer deny path (FR-041..FR-044)       | ✅    | ✅                       | ⚠️ mixed                 | ⚠️ mixed                 | ⚠️ build |

---

## Decision Fit

The existing source artifacts (`spec.md`, `research.md`, `plan.md`) are coherent with Clerk as the primary identity provider:

- `spec.md` encodes Clerk-specific lifecycle requirements (Actions, Management API, social link/unlink, block/unblock).
- `plan.md` defines implementation paths that rely on Clerk SDKs and APIs across web/mobile and Lambda services.
- `research.md` resolves core architecture concerns (authorizer behavior, JWKS caching posture, retry/reconciliation strategy) in an Clerk-centered model.

Given those constraints, Clerk remains the best-fit platform for this feature.

---

## Risks and Mitigations

| Risk                                                  | Impact                                  | Mitigation                                                                   |
| ----------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| Clerk Backend API rate limits during deletion/linking | Delayed lifecycle completion            | Async retry via SQS + DLQ + alarming (plan and FR-024 alignment)             |
| Token/caching lag for suspension enforcement          | Short-lived authorization inconsistency | Short authorizer cache TTL + explicit 403 policy for suspended/blocked users |
| Post-registration sync failures                       | Clerk-only user without local record    | Retry policy + nightly reconciliation (FR-016, FR-017)                       |
| Vendor lock-in concerns                               | Future migration cost                   | Preserve canonical local `User.id` and clear contract boundaries in services |

---

## Bottom Line

For feature `002-user-auth`, Clerk is the most aligned choice across required capabilities, implementation feasibility, and existing architectural decisions. Alternative providers remain technically viable but would introduce migration churn or increased custom-auth burden relative to the current source-of-truth artifacts.
