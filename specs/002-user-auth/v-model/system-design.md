# System Design: User Authentication

**Feature Branch**: `002-user-auth`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/002-user-auth/v-model/requirements.md`

## Overview

The User Authentication system decomposes into platform-specific authentication clients (web/mobile), a shared API Gateway authorizer Lambda, an IdP user.created webhook server-side handler, backend account management handlers, and cross-cutting observability/infrastructure components. The system bridges the IdP with the Commise PostgreSQL database, ensuring every IdP user has a corresponding User and Account record.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier for each component
- **Parent Requirements**: Comma-separated `REQ-NNN` list per component (many-to-many)
- Example: `SYS-003` with Parent Requirements `REQ-001, REQ-005` — component satisfies both requirements

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                                      | Description                                                                                                                                                                                                                     | Parent Requirements                                                                      | Type      |
| ------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------- |
| SYS-001 | Web Auth Client (Next.js)                 | Implements IdP Authorization Code Flow with PKCE for the Next.js web app using `@clerk/nextjs`. Handles login redirect to Clerk Hosted UI, session cookies via the Clerk `__session` cookie, and logout.                        | REQ-001, REQ-003, REQ-005, REQ-006, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012          | Subsystem |
| SYS-002 | Mobile Auth Client (Expo)                 | Implements IdP Authorization Code Flow with PKCE for the Expo mobile app using `@clerk/expo` and `expo-secure-store`. Handles auto-display of auth screen, callback, secure token storage, and logout.                          | REQ-001, REQ-002, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012 | Subsystem |
| SYS-003 | Social Login Provider                     | Configures and surfaces IdP social login connections (Google, etc.) on both platforms. Delegates to the IdP for the actual OAuth flow.                                                                                          | REQ-004                                                                                  | Module    |
| SYS-004 | Token Refresh Handler                     | Silently refreshes access tokens using refresh tokens on both platforms. Triggers re-authentication when refresh token is expired or revoked.                                                                                   | REQ-007, REQ-008                                                                         | Module    |
| SYS-005 | Post-Registration IdP Server-Side Handler | IdP server-side handler that fires after user registration. Generates UUIDv4 user ID, writes it to `app_metadata`, and calls the Commise backend to create User and Account records. Implements retry with exponential backoff. | REQ-013, REQ-014, REQ-015, REQ-016, REQ-IF-008                                           | Service   |
| SYS-006 | User/Account Provisioning Service         | Backend service (Lambda or NestJS handler) that receives calls from the user.created webhook action and creates User + Account records in the Commise PostgreSQL database.                                                      | REQ-013, REQ-014, REQ-016, REQ-IF-008                                                    | Service   |
| SYS-007 | Reconciliation Job                        | Scheduled job or API endpoint that compares IdP user list with Commise database records and creates any missing User/Account records.                                                                                           | REQ-017, REQ-IF-010                                                                      | Service   |
| SYS-008 | Profile View                              | UI component (web + mobile) that displays authenticated user's display name, email, avatar, and account creation date sourced from the Commise database.                                                                        | REQ-018                                                                                  | Module    |
| SYS-009 | Account Edit Handler                      | UI + backend for editing display name and avatar. Persists changes to the Commise database. Validates display name is non-empty. Email field is read-only.                                                                      | REQ-019, REQ-020, REQ-021, REQ-022                                                       | Module    |
| SYS-010 | Account Deletion Handler                  | UI + backend for account deletion. Requires explicit confirmation ("DELETE"). Deletes User/Account records from Commise DB, cascades to user-owned data, deletes user from the IdP, then logs out.                              | REQ-023, REQ-024, REQ-025, REQ-026                                                       | Module    |
| SYS-011 | Password Reset Flow                       | Surfaces the IdP's hosted password reset flow via a "Forgot Password" link. All password management delegated to the IdPed to the IdP; backend never handles passwords.                                                         | REQ-027, REQ-028, REQ-CN-002                                                             | Module    |
| SYS-012 | MFA Enrollment Flow                       | Surfaces the IdP's MFA enrollment (TOTP) from account settings. IdP enforces second factor on subsequent logins when enrolled.                                                                                                  | REQ-029, REQ-030, REQ-031                                                                | Module    |
| SYS-013 | Social Account Linking                    | Allows logged-in users to link/unlink social provider accounts via IdP Backend API. Preserves canonical Commise user ID; no new User/Account records created.                                                                   | REQ-032, REQ-033, REQ-034                                                                | Module    |
| SYS-014 | User Impersonation                        | Supports authorized personnel impersonating users via the IdP token exchange. Impersonation sessions are flagged; destructive actions are blocked.                                                                              | REQ-035, REQ-036, REQ-037                                                                | Service   |
| SYS-015 | API Gateway JWT Authorizer                | Lambda authorizer that validates IdP JWT tokens (signature, expiry, audience, issuer) using `jwks-rsa` and `jose`. Returns IAM policy. Denies suspended users (403).                                                            | REQ-038, REQ-039, REQ-040, REQ-042, REQ-IF-004, REQ-IF-009                               | Service   |
| SYS-016 | User Suspension/Reactivation              | Backend operations to block/unblock users in the IdP (Management API) and set `status` field in Commise database. Suspended users see a clear message on login attempt.                                                         | REQ-041, REQ-043, REQ-044                                                                | Service   |
| SYS-017 | Observability & Logging                   | Cross-cutting: structured JSON logging with correlation IDs (`@aws-lambda-powertools/logger`), CloudWatch metrics for auth flows, Sentry integration (`@sentry/aws-serverless`), distributed tracing (X-Ray/OpenTelemetry).     | REQ-NF-012, REQ-NF-013, REQ-NF-014, REQ-NF-015, REQ-NF-016, REQ-NF-017                   | Utility   |
| SYS-018 | CDK Infrastructure Stack                  | AWS CDK v2 definitions for all Lambda functions, API Gateway, SQS queues, IAM roles, CloudWatch log groups, and alarms.                                                                                                         | REQ-IF-007, REQ-NF-006                                                                   | Subsystem |
| SYS-019 | Shared Auth Types & Error Classes         | Cross-cutting: TypeScript strict-mode interfaces, type aliases, custom error classes (`AuthSessionExpiredError`, `UserNotFoundError`, etc.) with type guards. Shared across all auth workspaces.                                | REQ-NF-001, REQ-NF-009, REQ-NF-010                                                       | Library   |
| SYS-020 | Auth UI Design System Integration         | Cross-cutting: login/signup UI components consuming design system tokens. Accessible names for all auth UI elements. Status indicators with text labels (not color-only).                                                       | REQ-NF-004, REQ-NF-005, REQ-NF-011                                                       | Library   |

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                         |
| ------- | ------- | ------------ | ---------------------------------------------------------------------- |
| SYS-001 | SYS-004 | Uses         | Web sessions cannot be silently refreshed; users forced to re-login    |
| SYS-001 | SYS-019 | Uses         | Type safety lost; runtime errors possible in web auth flows            |
| SYS-001 | SYS-020 | Uses         | Auth UI loses design system styling and accessibility                  |
| SYS-002 | SYS-004 | Uses         | Mobile sessions cannot be silently refreshed; users forced to re-login |
| SYS-002 | SYS-019 | Uses         | Type safety lost; runtime errors possible in mobile auth flows         |
| SYS-002 | SYS-020 | Uses         | Auth UI loses design system styling and accessibility                  |
| SYS-003 | SYS-001 | Calls        | Social login unavailable on web                                        |
| SYS-003 | SYS-002 | Calls        | Social login unavailable on mobile                                     |
| SYS-004 | SYS-019 | Uses         | Token refresh type safety lost                                         |
| SYS-005 | SYS-006 | Calls        | User/Account records not created; orphaned IdP users                   |
| SYS-005 | SYS-019 | Uses         | Type safety lost in user.created webhook action                        |
| SYS-006 | SYS-017 | Uses         | Provisioning failures not logged or tracked                            |
| SYS-006 | SYS-019 | Uses         | Type safety lost in provisioning service                               |
| SYS-007 | SYS-006 | Calls        | Reconciliation cannot create missing records                           |
| SYS-007 | SYS-017 | Uses         | Reconciliation runs not observable                                     |
| SYS-008 | SYS-015 | Reads        | Profile data inaccessible (API calls unauthorized)                     |
| SYS-009 | SYS-015 | Calls        | Account edits cannot be persisted (API calls unauthorized)             |
| SYS-009 | SYS-019 | Uses         | Validation type safety lost                                            |
| SYS-010 | SYS-015 | Calls        | Account deletion cannot proceed (API calls unauthorized)               |
| SYS-010 | SYS-017 | Uses         | Deletion failures not logged                                           |
| SYS-013 | SYS-015 | Calls        | Social linking/unlinking cannot be authorized                          |
| SYS-014 | SYS-015 | Uses         | Impersonation tokens cannot be validated                               |
| SYS-014 | SYS-017 | Uses         | Impersonation audit trail lost                                         |
| SYS-015 | SYS-017 | Uses         | Authorizer failures not observable                                     |
| SYS-015 | SYS-019 | Uses         | JWT type safety lost                                                   |
| SYS-016 | SYS-015 | Calls        | Suspension status cannot be enforced at API level                      |
| SYS-016 | SYS-017 | Uses         | Suspension operations not logged                                       |
| SYS-018 | SYS-015 | Deploys      | Authorizer Lambda not deployed                                         |
| SYS-018 | SYS-005 | Deploys      | Post-registration action infrastructure not provisioned                |
| SYS-018 | SYS-006 | Deploys      | Provisioning service not deployed                                      |
| SYS-018 | SYS-007 | Deploys      | Reconciliation job not deployed                                        |

### Dependency Diagram

```text
IdP (External Identity Provider)
  │
  ├──► SYS-001 (Web Auth Client)
  │       └── SYS-004 (Token Refresh)
  │       └── SYS-003 (Social Login)
  │       └── SYS-020 (UI Design)
  │       └── SYS-019 (Types/Errors)
  │
  ├──► SYS-002 (Mobile Auth Client)
  │       └── SYS-004 (Token Refresh)
  │       └── SYS-003 (Social Login)
  │       └── SYS-020 (UI Design)
  │       └── SYS-019 (Types/Errors)
  │
  ├──► SYS-005 (Post-Registration Action)
  │       └──► SYS-006 (Provisioning Service) ──► PostgreSQL DB
  │
  └──► SYS-015 (API Gateway JWT Authorizer)
          └── SYS-017 (Observability)
          └── SYS-019 (Types/Errors)

Client Requests ──► API Gateway ──► SYS-015 ──► Backend Handlers
                                                  ├── SYS-008 (Profile View)
                                                  ├── SYS-009 (Account Edit)
                                                  ├── SYS-010 (Account Deletion)
                                                  ├── SYS-013 (Social Linking)
                                                  ├── SYS-014 (Impersonation)
                                                  └── SYS-016 (Suspension)

SYS-018 (CDK Stack) ──► Deploys all Lambda/API Gateway/SQS resources
SYS-007 (Reconciliation) ──► Scheduled/on-demand ──► SYS-006
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Component | Interface Name                | Protocol                             | Input                                                                                         | Output                                             | Error Handling                                     |
| --------- | ----------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------- |
| SYS-001   | IdP Login Redirect            | HTTPS redirect                       | Derived — supports cross-cutting implementation constraints for traced parent system behavior | 302 redirect to the IdP login page (Derived)       | Redirect to error page on IdP failure              |
| SYS-001   | IdP Callback Handler          | HTTPS POST                           | Derived — supports cross-cutting implementation constraints for traced parent system behavior | httpOnly session cookie; redirect to app (Derived) | 400/500 with error message                         |
| SYS-002   | IdP Mobile Auth Screen        | @IdP/expo SDK                        | Derived — supports cross-cutting implementation constraints for traced parent system behavior | IdP login UI presented; tokens stored (Derived)    | Error state shown; retry available                 |
| SYS-005   | IdP Post-Registration Webhook | HTTPS POST (IdP server-side handler) | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `app_metadata.userId` set; 200 OK (Derived)        | Retry up to 3x; log failure; return 500 to the IdP |
| SYS-007   | Reconciliation API Endpoint   | HTTPS GET/POST                       | Derived — supports cross-cutting implementation constraints for traced parent system behavior | JSON: `{repaired: N, failed: N}` (Derived)         | 500 with error details; Sentry alert               |
| SYS-015   | API Gateway Lambda Authorizer | Lambda invocation                    | Derived — supports cross-cutting implementation constraints for traced parent system behavior | IAM policy document (Allow/Deny) (Derived)         | Deny policy on any validation failure              |

### Internal Interfaces

| Source | Target | Interface Name | Protocol | Data Format | Error Handling |
| ------- | ------- | --------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------- | ---------------------------------------------- |
| SYS-005 | SYS-006 | Provision User | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{identity_id: string, userId: string, email: string}` (Derived) | Retry 3x exponential backoff; throw on exhaustion |
| SYS-007 | SYS-006 | Reconcile User | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{identity_id: string, email: string}` (Derived) | Log error; continue to next user |
| SYS-009 | SYS-015 | Update Account | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{displayName: string, avatarUrl?: string}` (Derived) | 400 validation error; 401/403 from authorizer |
| SYS-010 | SYS-015 | Delete Account | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{confirmation: "DELETE"}` (Derived) | 400 if confirmation missing; 401/403 from auth |
| SYS-013 | SYS-015 | Link/Unlink Social Provider | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{provider: string, connection: string}` (Derived) | 400 if last provider; 401/403 from authorizer |
| SYS-016 | SYS-015 | Suspend/Reactivate User | Derived — supports cross-cutting implementation constraints for traced parent system behavior | `{userId: string, action: "suspend" \ (Derived)              | "reactivate"}` | 404 if user not found; 401/403 from authorizer |

## Data Design View (IEEE 1016 §5.4)

| Entity          | Component | Storage            | Protection at Rest               | Protection in Transit | Retention                                 |
| --------------- | --------- | ------------------ | -------------------------------- | --------------------- | ----------------------------------------- |
| Access Token    | SYS-001   | httpOnly cookie    | SameSite=Strict; Secure flag     | TLS 1.2+              | Expires per IdP token lifetime            |
| Access Token    | SYS-002   | expo-secure-store  | iOS Keychain / Android Keystore  | TLS 1.2+              | Cleared on logout or expiry               |
| Refresh Token   | SYS-001   | httpOnly cookie    | SameSite=Strict; Secure flag     | TLS 1.2+              | Revoked on logout; expires per IdP config |
| Refresh Token   | SYS-002   | expo-secure-store  | iOS Keychain / Android Keystore  | TLS 1.2+              | Revoked on logout; expires per IdP config |
| User Record     | SYS-006   | PostgreSQL (RDS)   | RDS encryption at rest (AES-256) | TLS 1.2+ (pg SSL)     | Deleted on account deletion (cascade)     |
| Account Record  | SYS-006   | PostgreSQL (RDS)   | RDS encryption at rest (AES-256) | TLS 1.2+ (pg SSL)     | Deleted on account deletion (cascade)     |
| IdP User        | SYS-005   | IdP tenant         | IdP managed                      | TLS 1.2+              | Deleted on account deletion               |
| app_metadata    | SYS-005   | IdP user profile   | IdP managed                      | TLS 1.2+              | Deleted with IdP user                     |
| JWT Claims      | SYS-015   | In-memory (Lambda) | Not persisted                    | TLS 1.2+              | Discarded after request                   |
| Audit Log       | SYS-014   | CloudWatch Logs    | CloudWatch encryption            | TLS 1.2+              | 90-day retention (CloudWatch log group)   |
| Structured Logs | SYS-017   | CloudWatch Logs    | CloudWatch encryption            | TLS 1.2+              | 30-day retention (configurable)           |

---

## Coverage Summary

| Metric                        | Count                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Total System Components (SYS) | 20                                                                                                                       |
| Total Requirements Covered    | 44 functional + 17 non-functional + 10 interface + 5 constraint = 76                                                     |
| Requirements with SYS mapping | All REQ-001 through REQ-044, REQ-NF-001 through REQ-NF-017, REQ-IF-001 through REQ-IF-010, REQ-CN-001 through REQ-CN-005 |
| Derived Requirements          | 0                                                                                                                        |
