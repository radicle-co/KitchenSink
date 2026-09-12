# System Test Plan: IdP User Authentication

**Feature Branch**: `002-user-auth`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/002-user-auth/v-model/system-design.md`

> **Identity-key note (Feature 002 implementation update)**: Scenarios in this draft that mention generated UUID user IDs, `app_metadata.userId`, `identity_id`, `internal_id`, or `legacy_id` are historical and superseded by the implemented sub-keyed model. Current verification uses IdP `sub` as `users.sub VARCHAR(255) COLLATE "C" PRIMARY KEY`, with M2M-gated post-login upsert and no generated user UUID.

## Overview

This document defines the System Test Plan for IdP User Authentication. Every system component
in `system-design.md` has one or more Test Cases (STP), and every Test Case has one or
more executable System Scenarios (STS) in technical BDD format (Given/When/Then).

System tests verify **architectural behavior**, not user journeys. Language must be
technical and component-oriented.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}` — where NNN matches the parent SYS, X is a letter suffix (A, B, C...)
- **System Test Scenario**: `STS-{NNN}-{X}{#}` — nested under the parent STP, with numeric suffix (1, 2, 3...)
- Example: `STS-001-A1` → Scenario 1 of Test Case A verifying SYS-001

## ISO 29119 Test Techniques

Each test case MUST identify its technique by name:

- **Interface Contract Testing** — Verifies API contracts from the Interface View
- **Boundary Value Analysis** — Tests data limits from the Data Design View
- **Equivalence Partitioning** — Tests representative data classes
- **Fault Injection** — Tests failure propagation from the Dependency View

## System Tests

---

### Component Verification: SYS-001 (Web Auth Client — Next.js)

**Parent Requirements**: REQ-001, REQ-003, REQ-005, REQ-006, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012

#### Test Case: STP-001-A (PKCE Authorization Code Flow — Login Redirect)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Next.js web client initiates Authorization Code Flow with PKCE and issues a 302 redirect to the IdP login page when an unauthenticated request hits a protected route.

- **System Scenario: STS-001-A1**
    - **Given** the Next.js app is running and no session cookie is present in the request
    - **When** an HTTP GET request is made to a protected route (e.g., `/dashboard`)
    - **Then** the response is HTTP 302 with `Location` header pointing to the IdP `/authorize` endpoint, including `response_type=code`, `code_challenge`, `code_challenge_method=S256`, and `state` parameters

- **System Scenario: STS-001-A2**
    - **Given** the IdP `/authorize` endpoint returns an error response (e.g., `access_denied`)
    - **When** the callback handler receives the error redirect
    - **Then** the system responds with an error page (HTTP 400 or redirect to `/error`) and does not set a session cookie

#### Test Case: STP-001-B (Callback Handler — Token Exchange and Session Cookie)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the callback handler exchanges the authorization code for tokens and sets a secure httpOnly session cookie.

- **System Scenario: STS-001-B1**
    - **Given** the IdP has issued a valid authorization code and state parameter
    - **When** the callback handler receives `GET /api/auth/callback?code=<code>&state=<state>`
    - **Then** the handler exchanges the code for access and refresh tokens, sets an `httpOnly; Secure; SameSite=Strict` session cookie, and redirects to the originally requested route (HTTP 302)

- **System Scenario: STS-001-B2**
    - **Given** the callback receives a replayed or tampered `state` parameter
    - **When** the handler validates the state against the stored PKCE verifier
    - **Then** the handler rejects the request with HTTP 400 and does not set any session cookie

#### Test Case: STP-001-C (Secure Token Storage — Cookie Attributes)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that access and refresh tokens stored in cookies carry all required security attributes.

- **System Scenario: STS-001-C1**
    - **Given** a successful IdP callback has been processed
    - **When** the `Set-Cookie` response header is inspected
    - **Then** the cookie contains `HttpOnly`, `Secure`, `SameSite=Strict` attributes and the token payload is not readable from JavaScript (`document.cookie` returns empty for the auth cookie)

---

### Component Verification: SYS-002 (Mobile Auth Client — Expo)

**Parent Requirements**: REQ-001, REQ-002, REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010, REQ-011, REQ-012

#### Test Case: STP-002-A (Auto-Display Auth Screen on No Valid Session)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that the Expo mobile client presents the IdP authentication screen automatically when `expo-secure-store` contains no valid session tokens.

- **System Scenario: STS-002-A1**
    - **Given** `expo-secure-store` returns `null` for both access token and refresh token keys
    - **When** the app root component mounts and evaluates session state
    - **Then** the `@clerk/expo` SDK's `useSSO()` (or `useSignIn()`) method is invoked and the Clerk Hosted UI login screen is presented before any app content renders

- **System Scenario: STS-002-A2**
    - **Given** `expo-secure-store` contains an expired access token and a valid refresh token
    - **When** the app root component evaluates session state
    - **Then** the SDK silently refreshes the access token (no auth screen shown) and app content renders with the refreshed token

#### Test Case: STP-002-B (Secure Token Storage — Keychain/Keystore)

**Technique**: Interface Contract Testing
**Target View**: Data Design View
**Description**: Verifies that tokens are stored in `expo-secure-store` (iOS Keychain / Android Keystore) after successful authentication.

- **System Scenario: STS-002-B1**
    - **Given** the IdP authorization code flow completes successfully on mobile
    - **When** the SDK callback delivers access and refresh tokens
    - **Then** both tokens are written to `expo-secure-store` with appropriate keys and are not stored in `AsyncStorage` or any unencrypted location

---

### Component Verification: SYS-003 (Social Login Provider)

**Parent Requirements**: REQ-004

#### Test Case: STP-003-A (Social Login Connection — Google OAuth Delegation)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the IdP social login connection for Google is surfaced on both platforms and that the actual OAuth flow is delegated to the IdP.

- **System Scenario: STS-003-A1**
    - **Given** the IdP tenant has the Google social connection enabled
    - **When** the web client initiates login with `connection=google-oauth2` parameter in the `/authorize` request
    - **Then** the IdP redirects to Google's OAuth consent screen; the Commise backend receives no Google credentials directly

- **System Scenario: STS-003-A2**
    - **Given** the IdP tenant has the Google social connection enabled
    - **When** the mobile client calls `startSSOFlow({ strategy: 'oauth_google' })` via `@clerk/expo`
    - **Then** the Google OAuth consent screen is presented within the in-app browser; tokens are returned to the mobile client via the IdP callback

#### Test Case: STP-003-B (Social Login Unavailability — Fault Propagation)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies behavior when the IdP social connection is disabled or returns an error.

- **System Scenario: STS-003-B1**
    - **Given** the Google social connection is disabled in the IdP tenant
    - **When** a login attempt is made with `connection=google-oauth2`
    - **Then** the IdP returns an `access_denied` error; the client displays an error state and does not crash

---

### Component Verification: SYS-004 (Token Refresh Handler)

**Parent Requirements**: REQ-007, REQ-008

#### Test Case: STP-004-A (Silent Token Refresh — Valid Refresh Token)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the token refresh handler silently obtains a new access token using a valid refresh token without user interaction.

- **System Scenario: STS-004-A1**
    - **Given** the access token has expired and a valid refresh token is present in secure storage
    - **When** an API call is attempted and the access token is found to be expired
    - **Then** the refresh handler calls the IdP token endpoint with `grant_type=refresh_token`, receives a new access token, stores it in secure storage, and retries the original API call — all without presenting an auth screen

#### Test Case: STP-004-B (Re-Authentication Trigger — Expired/Revoked Refresh Token)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the system triggers re-authentication when the refresh token is expired or revoked.

- **System Scenario: STS-004-B1**
    - **Given** the refresh token has been revoked in the IdP (e.g., via logout on another device)
    - **When** the token refresh handler calls the IdP token endpoint with the revoked refresh token
    - **Then** the IdP returns HTTP 400 with `error=invalid_grant`; the handler clears all tokens from secure storage and triggers the platform-appropriate re-authentication flow (auth screen on mobile, login redirect on web)

- **System Scenario: STS-004-B2**
    - **Given** the refresh token has expired per IdP configuration
    - **When** the token refresh handler attempts to use the expired refresh token
    - **Then** the handler receives `invalid_grant`, clears stored tokens, and initiates re-authentication

---

### Component Verification: SYS-005 (Post-Registration IdP Handler)

**Parent Requirements**: REQ-013, REQ-014, REQ-015, REQ-016, REQ-IF-008

#### Test Case: STP-005-A (UUIDv4 Generation and app_metadata Write)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the user.created webhook post-registration IdP handler generates a UUIDv4 user ID and writes it to `app_metadata` on the IdP user object.

- **System Scenario: STS-005-A1**
    - **Given** a new user completes IdP registration (email/password or social)
    - **When** the user.created webhook handler fires with the IdP user object
    - **Then** the handler generates a UUIDv4 ID, calls the IdP management API to set `app_metadata.userId`, and the IdP user's `app_metadata.userId` is set to the generated UUID

#### Test Case: STP-005-B (Provisioning Service Call — Success Path)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Action calls the Commise provisioning service with the correct payload after setting `app_metadata`.

- **System Scenario: STS-005-B1**
    - **Given** `app_metadata.userId` has been set on the IdP user
    - **When** the handler calls the provisioning endpoint
    - **Then** the HTTP POST to the provisioning service includes `{ identityId, userId, email }` in the request body and the service responds HTTP 201; the handler returns HTTP 200 to the IdP

#### Test Case: STP-005-C (Retry with Exponential Backoff — Transient Failure)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the Action retries the provisioning call up to 3 times with exponential backoff on transient failures.

- **System Scenario: STS-005-C1**
    - **Given** the provisioning service returns HTTP 503 on the first two attempts
    - **When** the handler executes its retry loop
    - **Then** the handler retries with delays of ~1s and ~2s (exponential backoff), succeeds on the third attempt, and returns HTTP 200 to the IdP

- **System Scenario: STS-005-C2**
    - **Given** the provisioning service returns HTTP 503 on all three attempts
    - **When** the retry loop is exhausted
    - **Then** the handler logs the failure with structured context and returns HTTP 500 to the IdP (causing the IdP to block the registration flow)

---

### Component Verification: SYS-006 (User/Account Provisioning Service)

**Parent Requirements**: REQ-013, REQ-014, REQ-016, REQ-IF-008

#### Test Case: STP-006-A (User and Account Record Creation)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the provisioning service creates both a User record and an associated Account record in the PostgreSQL database.

- **System Scenario: STS-006-A1**
    - **Given** the provisioning service receives `POST /internal/provision-user` with `{ identityId, userId, email }`
    - **When** the handler executes the database transaction
    - **Then** a `users` row is inserted with `id = userId`, `identity_id = identityId`, `email = email`; an `accounts` row is inserted with `user_id = userId`; the response is HTTP 201 with `{ userId }`

#### Test Case: STP-006-B (Idempotency — Duplicate Provisioning Request)

**Technique**: Equivalence Partitioning
**Target View**: Data Design View
**Description**: Verifies that a duplicate provisioning call (same `identityId`) does not create duplicate records.

- **System Scenario: STS-006-B1**
    - **Given** a User record with `identity_id = identityId` already exists in the database
    - **When** the provisioning service receives a second `POST /internal/provision-user` with the same `identityId`
    - **Then** the service returns HTTP 200 (or 409 with idempotent semantics) without inserting duplicate rows; the existing records are unchanged

---

### Component Verification: SYS-007 (Reconciliation Job)

**Parent Requirements**: REQ-017, REQ-IF-010

#### Test Case: STP-007-A (Detect and Repair Missing Records)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the reconciliation job identifies IdP users without Commise database records and creates the missing User/Account records.

- **System Scenario: STS-007-A1**
    - **Given** the IdP contains 3 users and the Commise database contains records for only 2 of them
    - **When** the reconciliation job runs (scheduled or triggered via API endpoint)
    - **Then** the job calls the provisioning service for the missing user, the response includes `{ repaired: 1, failed: 0 }`, and the database now contains records for all 3 users

#### Test Case: STP-007-B (Reconciliation — Provisioning Failure Handling)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that the reconciliation job continues processing remaining users when one provisioning call fails.

- **System Scenario: STS-007-B1**
    - **Given** 2 users are missing from the database and the provisioning service fails for the first user
    - **When** the reconciliation job processes both users
    - **Then** the job logs the failure for the first user, continues to the second user, successfully provisions it, and returns `{ repaired: 1, failed: 1 }`; a Sentry alert is triggered for the failed user

---

### Component Verification: SYS-008 (Profile View)

**Parent Requirements**: REQ-018

#### Test Case: STP-008-A (Profile Data Retrieval via Authorized API Call)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the profile view component fetches user data from the Commise database via an authorized API call and renders the correct fields.

- **System Scenario: STS-008-A1**
    - **Given** a valid JWT is present in the request (web: session cookie; mobile: Authorization header)
    - **When** the profile view component calls `GET /api/users/me`
    - **Then** the API Gateway authorizer (SYS-015) validates the JWT, the handler queries the database for `display_name`, `email`, `avatar_url`, `created_at`, and the response is HTTP 200 with those fields populated

- **System Scenario: STS-008-A2**
    - **Given** the JWT is absent or invalid
    - **When** the profile view component calls `GET /api/users/me`
    - **Then** the API Gateway authorizer returns a Deny policy; the client receives HTTP 401 and the profile view displays an error state

---

### Component Verification: SYS-009 (Account Edit Handler)

**Parent Requirements**: REQ-019, REQ-020, REQ-021, REQ-022

#### Test Case: STP-009-A (Display Name Update — Valid Input)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that a valid display name update is persisted to the database.

- **System Scenario: STS-009-A1**
    - **Given** a valid JWT and a non-empty `displayName` value
    - **When** the client sends `PATCH /api/users/me` with `{ displayName: "Alice" }`
    - **Then** the handler updates the `users.display_name` column in the database and returns HTTP 200 with the updated user object

#### Test Case: STP-009-B (Display Name Validation — Empty Value Rejection)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that an empty display name is rejected with a validation error.

- **System Scenario: STS-009-B1**
    - **Given** a valid JWT and an empty string `displayName`
    - **When** the client sends `PATCH /api/users/me` with `{ displayName: "" }`
    - **Then** the handler returns HTTP 400 with a validation error message; the database record is not modified

- **System Scenario: STS-009-B2**
    - **Given** a valid JWT and a `displayName` consisting only of whitespace
    - **When** the client sends `PATCH /api/users/me` with `{ displayName: "   " }`
    - **Then** the handler returns HTTP 400 with a validation error; the database record is not modified

---

### Component Verification: SYS-010 (Account Deletion Handler)

**Parent Requirements**: REQ-023, REQ-024, REQ-025, REQ-026

#### Test Case: STP-010-A (Account Deletion — Confirmation Required)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that account deletion requires the exact confirmation string "DELETE" and rejects any other value.

- **System Scenario: STS-010-A1**
    - **Given** a valid JWT and `{ confirmation: "DELETE" }` in the request body
    - **When** the client sends `DELETE /api/users/me`
    - **Then** the handler proceeds with deletion: removes User and Account records (cascading to user-owned data), calls IdP Backend API to delete the IdP user, and returns HTTP 204

- **System Scenario: STS-010-A2**
    - **Given** a valid JWT and `{ confirmation: "delete" }` (wrong case) in the request body
    - **When** the client sends `DELETE /api/users/me`
    - **Then** the handler returns HTTP 400 with an error indicating the confirmation string is incorrect; no deletion occurs

#### Test Case: STP-010-B (Cascade Deletion — User-Owned Data)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that account deletion cascades to all user-owned data in the database.

- **System Scenario: STS-010-B1**
    - **Given** a user has associated recipes and meal plans in the database
    - **When** account deletion is confirmed and the handler executes the deletion transaction
    - **Then** the `users` row, `accounts` row, and all rows in related tables (recipes, meal_plans, etc.) with `user_id` FK are deleted within the same transaction; the IdP user is deleted after the DB transaction commits

---

### Component Verification: SYS-011 (Password Reset Flow)

**Parent Requirements**: REQ-027, REQ-028, REQ-CN-002

#### Test Case: STP-011-A (Password Reset Delegation to IdP)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the password reset flow is fully delegated to the IdP and the Commise backend never handles password data.

- **System Scenario: STS-011-A1**
    - **Given** a user requests password reset via the "Forgot Password" link
    - **When** the client initiates the password reset flow
    - **Then** the client redirects to the IdP's hosted password reset page; no password data is sent to or processed by any Commise backend endpoint

- **System Scenario: STS-011-A2**
    - **Given** the IdP's password reset flow completes successfully
    - **When** the IdP redirects back to the application
    - **Then** the application receives no password or credential data in the redirect; the user is returned to the login screen

---

### Component Verification: SYS-012 (MFA Enrollment Flow)

**Parent Requirements**: REQ-029, REQ-030, REQ-031

#### Test Case: STP-012-A (MFA Enrollment via IdP — TOTP)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that MFA enrollment is surfaced from account settings and delegated to the IdP's MFA enrollment flow.

- **System Scenario: STS-012-A1**
    - **Given** an authenticated user navigates to account settings
    - **When** the user initiates MFA enrollment
    - **Then** the client redirects to the IdP's MFA enrollment UI; the Commise backend does not receive or store TOTP secrets

#### Test Case: STP-012-B (MFA Enforcement on Subsequent Login)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that the IdP enforces the second factor on login after MFA enrollment.

- **System Scenario: STS-012-B1**
    - **Given** a user has completed MFA enrollment in the IdP
    - **When** the user initiates a new login via the Authorization Code Flow
    - **Then** the IdP challenges the user for the TOTP second factor before issuing tokens; the Commise client receives tokens only after successful MFA verification

---

### Component Verification: SYS-013 (Social Account Linking)

**Parent Requirements**: REQ-032, REQ-033, REQ-034

#### Test Case: STP-013-A (Link Social Provider — Canonical User ID Preserved)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that linking a social provider via IdP Backend API does not create new User/Account records and preserves the canonical Commise user ID.

- **System Scenario: STS-013-A1**
    - **Given** an authenticated user with `app_metadata.userId = <uuid>` initiates social account linking
    - **When** the client sends `POST /api/users/me/social-links` with `{ provider: "google", connection: "google-oauth2" }`
    - **Then** the handler calls IdP Backend API to link the social identity to the existing IdP user; no new `users` or `accounts` rows are created; `app_metadata.userId` remains unchanged

#### Test Case: STP-013-B (Unlink Social Provider — Last Provider Guard)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that unlinking the last authentication provider is rejected.

- **System Scenario: STS-013-B1**
    - **Given** a user has only one linked authentication provider (e.g., email/password)
    - **When** the client sends `DELETE /api/users/me/social-links/google-oauth2`
    - **Then** the handler returns HTTP 400 indicating the last provider cannot be unlinked; the IdP identity is not modified

---

### Component Verification: SYS-014 (User Impersonation)

**Parent Requirements**: REQ-035, REQ-036, REQ-037

#### Test Case: STP-014-A (Impersonation Token Exchange — Authorized Personnel)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that impersonation sessions are established via IdP token exchange and flagged in the token claims.

- **System Scenario: STS-014-A1**
    - **Given** an authorized admin user with the `impersonate` permission in their JWT
    - **When** the admin calls the impersonation endpoint with a target `userId`
    - **Then** the system exchanges for an impersonation token via the IdP; the resulting token contains a claim indicating impersonation (e.g., `impersonating: true`, `impersonated_user_id: <userId>`); the audit log records the impersonation event

#### Test Case: STP-014-B (Destructive Action Block During Impersonation)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that destructive actions (account deletion, password reset) are blocked during an impersonation session.

- **System Scenario: STS-014-B1**
    - **Given** an active impersonation session token with `impersonating: true`
    - **When** the client sends `DELETE /api/users/me` (account deletion)
    - **Then** the handler detects the impersonation flag in the JWT claims and returns HTTP 403 with an error indicating the action is blocked during impersonation

---

### Component Verification: SYS-015 (API Gateway JWT Authorizer)

**Parent Requirements**: REQ-038, REQ-039, REQ-040, REQ-042, REQ-IF-004, REQ-IF-009

#### Test Case: STP-015-A (JWT Validation — Valid Token)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the Lambda authorizer validates a well-formed JWT and returns an Allow IAM policy.

- **System Scenario: STS-015-A1**
    - **Given** a valid, unexpired JWT signed by the IdP tenant's JWKS, with correct `aud` and `iss` claims
    - **When** API Gateway invokes the Lambda authorizer with the Bearer token
    - **Then** the authorizer fetches the JWKS (or uses cached keys), verifies the signature, validates `exp`, `aud`, and `iss`, and returns an IAM policy with `Effect: Allow` for the requested resource

#### Test Case: STP-015-B (JWT Validation — Invalid/Expired Token)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that the authorizer returns a Deny policy for invalid, expired, or tampered tokens.

- **System Scenario: STS-015-B1**
    - **Given** an expired JWT (past `exp` claim)
    - **When** API Gateway invokes the Lambda authorizer
    - **Then** the authorizer returns an IAM policy with `Effect: Deny`; the API Gateway returns HTTP 401 to the caller

- **System Scenario: STS-015-B2**
    - **Given** a JWT with a tampered signature
    - **When** API Gateway invokes the Lambda authorizer
    - **Then** the authorizer fails JWKS signature verification and returns `Effect: Deny`

#### Test Case: STP-015-C (Suspended User — 403 Denial)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that the authorizer denies access for users with `status = suspended` in the Commise database.

- **System Scenario: STS-015-C1**
    - **Given** a valid JWT for a user whose `status` field in the database is `suspended`
    - **When** API Gateway invokes the Lambda authorizer
    - **Then** the authorizer checks the user's status (via database lookup or token claim), returns `Effect: Deny`, and API Gateway returns HTTP 403 to the caller

---

### Component Verification: SYS-016 (User Suspension/Reactivation)

**Parent Requirements**: REQ-041, REQ-043, REQ-044

#### Test Case: STP-016-A (Suspend User — IdP Block and DB Status Update)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that suspending a user blocks them in the IdP and sets `status = suspended` in the database.

- **System Scenario: STS-016-A1**
    - **Given** an admin with the `suspend_users` permission sends `POST /api/admin/users/:userId/suspend`
    - **When** the suspension handler executes
    - **Then** the handler calls IdP Backend API to block the user (`blocked: true`), updates `users.status = 'suspended'` in the database, and returns HTTP 200; subsequent login attempts by the user are rejected by the IdP

#### Test Case: STP-016-B (Reactivate User — IdP Unblock and DB Status Update)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that reactivating a user unblocks them in the IdP and sets `status = active` in the database.

- **System Scenario: STS-016-B1**
    - **Given** a suspended user and an admin with the `suspend_users` permission
    - **When** the admin sends `POST /api/admin/users/:userId/reactivate`
    - **Then** the handler calls IdP Backend API to unblock the user (`blocked: false`), updates `users.status = 'active'` in the database, and returns HTTP 200; the user can subsequently authenticate successfully

---

### Component Verification: SYS-017 (Observability & Logging)

**Parent Requirements**: REQ-NF-012, REQ-NF-013, REQ-NF-014, REQ-NF-015, REQ-NF-016, REQ-NF-017

#### Test Case: STP-017-A (Structured JSON Logging with Correlation IDs)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that all Lambda functions emit structured JSON logs with correlation IDs via `@aws-lambda-powertools/logger`.

- **System Scenario: STS-017-A1**
    - **Given** a Lambda function (e.g., SYS-015 authorizer) processes a request
    - **When** the function logs an event using `@aws-lambda-powertools/logger`
    - **Then** the CloudWatch log entry is valid JSON containing `level`, `message`, `correlation_id`, `service`, and `timestamp` fields; the `correlation_id` matches the `X-Correlation-ID` header from the originating request

#### Test Case: STP-017-B (Sentry Error Capture — Unhandled Exceptions)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies that unhandled exceptions in Lambda functions are captured and reported to Sentry via `@sentry/aws-serverless`.

- **System Scenario: STS-017-B1**
    - **Given** the `@sentry/aws-serverless` SDK is initialized with a valid DSN
    - **When** a Lambda function throws an unhandled exception
    - **Then** the Sentry SDK captures the exception with stack trace and context, sends it to the Sentry project, and the Lambda function returns an appropriate error response (HTTP 500)

---

### Component Verification: SYS-018 (CDK Infrastructure Stack)

**Parent Requirements**: REQ-IF-007, REQ-NF-006

#### Test Case: STP-018-A (CDK Stack Synthesis — All Resources Defined)

**Technique**: Interface Contract Testing
**Target View**: Decomposition View
**Description**: Verifies that the CDK stack synthesizes without errors and defines all required Lambda functions, API Gateway, SQS queues, IAM roles, and CloudWatch log groups.

- **System Scenario: STS-018-A1**
    - **Given** the CDK app is configured with valid environment variables (account, region)
    - **When** `cdk synth` is executed
    - **Then** the CloudFormation template is generated without errors and contains resource definitions for: the JWT Authorizer Lambda, the Provisioning Service Lambda, the Reconciliation Lambda, the API Gateway with the authorizer attached, SQS queues (if applicable), IAM roles with least-privilege policies, and CloudWatch log groups

#### Test Case: STP-018-B (IAM Role — Least Privilege Verification)

**Technique**: Boundary Value Analysis
**Target View**: Data Design View
**Description**: Verifies that IAM roles defined in the CDK stack grant only the minimum required permissions.

- **System Scenario: STS-018-B1**
    - **Given** the synthesized CloudFormation template for the JWT Authorizer Lambda's execution role
    - **When** the IAM policy statements are inspected
    - **Then** the policy grants only `logs:CreateLogGroup`, `logs:CreateLogStream`, `logs:PutLogEvents`, and any explicitly required service permissions; no wildcard `*` actions or resources are present

---

### Component Verification: SYS-019 (Shared Auth Types & Error Classes)

**Parent Requirements**: REQ-NF-001, REQ-NF-009, REQ-NF-010

#### Test Case: STP-019-A (TypeScript Strict-Mode Compilation)

**Technique**: Interface Contract Testing
**Target View**: Decomposition View
**Description**: Verifies that all shared auth types and error classes compile without errors under TypeScript strict mode.

- **System Scenario: STS-019-A1**
    - **Given** the shared auth types package is configured with `"strict": true` in `tsconfig.json`
    - **When** `tsc --noEmit` is executed on the shared package
    - **Then** the compiler reports zero errors; all interfaces, type aliases, and custom error classes (`AuthSessionExpiredError`, `UserNotFoundError`, etc.) are valid TypeScript

#### Test Case: STP-019-B (Custom Error Classes — Type Guard Correctness)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that type guards for custom error classes correctly discriminate between error types.

- **System Scenario: STS-019-B1**
    - **Given** an instance of `AuthSessionExpiredError` is thrown
    - **When** the `isAuthSessionExpiredError(err)` type guard is evaluated
    - **Then** the guard returns `true` for `AuthSessionExpiredError` instances and `false` for generic `Error` instances and other custom error types

---

### Component Verification: SYS-020 (Auth UI Design System Integration)

**Parent Requirements**: REQ-NF-004, REQ-NF-005, REQ-NF-011

#### Test Case: STP-020-A (Design Token Application — Auth UI Components)

**Technique**: Interface Contract Testing
**Target View**: Decomposition View
**Description**: Verifies that auth UI components consume design system tokens and do not use hardcoded color or spacing values.

- **System Scenario: STS-020-A1**
    - **Given** the auth UI components (login form, error states, loading indicators) are rendered
    - **When** the component styles are inspected
    - **Then** all color, spacing, and typography values reference design system tokens (CSS custom properties or theme variables); no hardcoded hex colors or pixel values are present in component style definitions

#### Test Case: STP-020-B (Accessibility — Status Indicators with Text Labels)

**Technique**: Equivalence Partitioning
**Target View**: Decomposition View
**Description**: Verifies that auth UI status indicators use text labels in addition to color, satisfying WCAG 1.4.1 (Use of Color).

- **System Scenario: STS-020-B1**
    - **Given** an auth UI component displays a status indicator (e.g., error state, loading state)
    - **When** the rendered output is inspected for accessible names and text content
    - **Then** each status indicator includes a visible text label or `aria-label` that conveys the status without relying solely on color; the indicator passes WCAG 1.4.1 (Use of Color: Level AA)

---

## Test Case Summary

| STP ID    | Component                             | Technique                  | STS Count |
| --------- | ------------------------------------- | -------------------------- | --------- |
| STP-001-A | SYS-001 Web Auth Client               | Interface Contract Testing | 2         |
| STP-001-B | SYS-001 Web Auth Client               | Interface Contract Testing | 2         |
| STP-001-C | SYS-001 Web Auth Client               | Boundary Value Analysis    | 1         |
| STP-002-A | SYS-002 Mobile Auth Client            | Equivalence Partitioning   | 2         |
| STP-002-B | SYS-002 Mobile Auth Client            | Interface Contract Testing | 1         |
| STP-003-A | SYS-003 Social Login Provider         | Interface Contract Testing | 2         |
| STP-003-B | SYS-003 Social Login Provider         | Fault Injection            | 1         |
| STP-004-A | SYS-004 Token Refresh Handler         | Interface Contract Testing | 1         |
| STP-004-B | SYS-004 Token Refresh Handler         | Fault Injection            | 2         |
| STP-005-A | SYS-005 Post-Registration IdP Handler | Interface Contract Testing | 1         |
| STP-005-B | SYS-005 Post-Registration IdP Handler | Interface Contract Testing | 1         |
| STP-005-C | SYS-005 Post-Registration IdP Handler | Fault Injection            | 2         |
| STP-006-A | SYS-006 Provisioning Service          | Interface Contract Testing | 1         |
| STP-006-B | SYS-006 Provisioning Service          | Equivalence Partitioning   | 1         |
| STP-007-A | SYS-007 Reconciliation Job            | Interface Contract Testing | 1         |
| STP-007-B | SYS-007 Reconciliation Job            | Fault Injection            | 1         |
| STP-008-A | SYS-008 Profile View                  | Interface Contract Testing | 2         |
| STP-009-A | SYS-009 Account Edit Handler          | Interface Contract Testing | 1         |
| STP-009-B | SYS-009 Account Edit Handler          | Boundary Value Analysis    | 2         |
| STP-010-A | SYS-010 Account Deletion Handler      | Boundary Value Analysis    | 2         |
| STP-010-B | SYS-010 Account Deletion Handler      | Interface Contract Testing | 1         |
| STP-011-A | SYS-011 Password Reset Flow           | Interface Contract Testing | 2         |
| STP-012-A | SYS-012 MFA Enrollment Flow           | Interface Contract Testing | 1         |
| STP-012-B | SYS-012 MFA Enrollment Flow           | Equivalence Partitioning   | 1         |
| STP-013-A | SYS-013 Social Account Linking        | Interface Contract Testing | 1         |
| STP-013-B | SYS-013 Social Account Linking        | Boundary Value Analysis    | 1         |
| STP-014-A | SYS-014 User Impersonation            | Interface Contract Testing | 1         |
| STP-014-B | SYS-014 User Impersonation            | Equivalence Partitioning   | 1         |
| STP-015-A | SYS-015 API Gateway JWT Authorizer    | Interface Contract Testing | 1         |
| STP-015-B | SYS-015 API Gateway JWT Authorizer    | Equivalence Partitioning   | 2         |
| STP-015-C | SYS-015 API Gateway JWT Authorizer    | Equivalence Partitioning   | 1         |
| STP-016-A | SYS-016 User Suspension               | Interface Contract Testing | 1         |
| STP-016-B | SYS-016 User Suspension               | Interface Contract Testing | 1         |
| STP-017-A | SYS-017 Observability & Logging       | Interface Contract Testing | 1         |
| STP-017-B | SYS-017 Observability & Logging       | Fault Injection            | 1         |
| STP-018-A | SYS-018 CDK Infrastructure Stack      | Interface Contract Testing | 1         |
| STP-018-B | SYS-018 CDK Infrastructure Stack      | Boundary Value Analysis    | 1         |
| STP-019-A | SYS-019 Shared Auth Types             | Interface Contract Testing | 1         |
| STP-019-B | SYS-019 Shared Auth Types             | Equivalence Partitioning   | 1         |
| STP-020-A | SYS-020 Auth UI Design System         | Interface Contract Testing | 1         |
| STP-020-B | SYS-020 Auth UI Design System         | Equivalence Partitioning   | 1         |

**Total Test Cases (STP)**: 41
**Total Test Scenarios (STS)**: 47
**System Components Covered**: 20 / 20 (100%)
