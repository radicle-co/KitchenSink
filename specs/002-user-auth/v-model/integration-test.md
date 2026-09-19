# Integration Test Plan: User Authentication

**Feature Branch**: `002-user-auth`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/002-user-auth/v-model/architecture-design.md`

> **Identity-key note (Feature 002 implementation update)**: Scenarios in this draft that mention generated UUID user IDs, `app_metadata.userId`, `identity_id`, `internal_id`, or `legacy_id` are historical and superseded by the implemented sub-keyed model. Current verification uses IdP `sub` as `users.sub VARCHAR(255) COLLATE "C" PRIMARY KEY`, with M2M-gated post-login upsert and no generated user UUID.

## Overview

This document defines the Integration Test Plan for User Authentication. Every architecture module in `architecture-design.md` (ARCH-001 through ARCH-033) has one or more Test Cases (ITP), and every Test Case has one or more executable Integration Scenarios (ITS) in module-boundary BDD format (Given/When/Then).

Integration tests verify **seams and handshakes between modules**, not internal logic or user journeys. Language is module-boundary-oriented throughout.

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

---

## Integration Tests

---

### Module Verification: ARCH-001 (Web Auth Route Handler)

**Parent System Components**: SYS-001

#### Test Case: ITP-001-A (IdP Callback Code Exchange → Session Cookie Handshake)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-001 correctly receives the OAuth authorization code from the IdP and delivers a valid session cookie to ARCH-003, conforming to the `{code, state}` → `{session cookie}` contract.

- **Integration Scenario: ITS-001-A1**
    - **Given** the IdP delivers a `GET /api/auth/callback?code=<valid_code>&state=<valid_state>` request to ARCH-001
    - **When** ARCH-001 exchanges the code with the IdP's `/oauth/token` endpoint and receives `{access_token, refresh_token, id_token}`
    - **Then** ARCH-001 passes the token set to ARCH-003, which responds with a Set-Cookie header containing an httpOnly, Secure, SameSite=Strict session cookie, and ARCH-001 returns HTTP 302 to the protected route

- **Integration Scenario: ITS-001-A2**
    - **Given** the IdP delivers a callback with a mismatched `state` parameter to ARCH-001
    - **When** ARCH-001 validates the state against the session-stored CSRF token
    - **Then** ARCH-001 returns HTTP 400 with `{error: "state_mismatch", message: string}` and no session cookie is issued by ARCH-003

#### Test Case: ITP-001-B (IdP Token Exchange Failure Propagation)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-001 correctly propagates IdP token exchange failures to the caller without leaking internal state.

- **Integration Scenario: ITS-001-B1**
    - **Given** the IdP's `/oauth/token` endpoint returns HTTP 400 `{error: "invalid_grant"}` to ARCH-001
    - **When** ARCH-001 receives the error response from the IdP
    - **Then** ARCH-001 returns HTTP 500 with `{error: "AuthCallbackError", message: string}` and ARCH-003 is not invoked

---

### Module Verification: ARCH-002 (Web Auth Middleware Guard)

**Parent System Components**: SYS-001

#### Test Case: ITP-002-A (Session Cookie Presence → Route Pass-Through Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the handshake between ARCH-002 and ARCH-003: ARCH-002 calls ARCH-003's `getSession()` and routes the request based on the returned session state.

- **Integration Scenario: ITS-002-A1**
    - **Given** ARCH-002 intercepts a `GET /protected-route` request carrying a valid session cookie
    - **When** ARCH-002 invokes ARCH-003's `getSession()` and receives a non-null session object
    - **Then** ARCH-002 calls `next()` and the request proceeds to the downstream handler without redirect

- **Integration Scenario: ITS-002-A2**
    - **Given** ARCH-002 intercepts a `GET /protected-route` request with no session cookie
    - **When** ARCH-002 invokes ARCH-003's `getSession()` and receives `null`
    - **Then** ARCH-002 returns HTTP 302 with `Location: /api/auth/login`

#### Test Case: ITP-002-B (Expired Token → Refresh Delegation)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-002 correctly delegates to ARCH-008 when the session cookie contains an expired access token.

- **Integration Scenario: ITS-002-B1**
    - **Given** ARCH-002 intercepts a request with a session cookie containing an expired access token
    - **When** ARCH-002 detects token expiry and delegates to ARCH-008 (Token Refresh Service)
    - **Then** ARCH-008 returns a refreshed token set, ARCH-003 updates the session cookie, and ARCH-002 calls `next()` with the refreshed session

---

### Module Verification: ARCH-003 (Web Session Cookie Manager)

**Parent System Components**: SYS-001

#### Test Case: ITP-003-A (Token Set → Encrypted Cookie Serialization)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-003 correctly serializes the `{access_token, refresh_token, id_token}` token set from ARCH-001 into an encrypted httpOnly cookie and that the cookie format is accepted by ARCH-002's `getSession()`.

- **Integration Scenario: ITS-003-A1**
    - **Given** ARCH-001 passes `{access_token: JWT, refresh_token: JWT, id_token: JWT, expires_in: number}` to ARCH-003's `setSession()`
    - **When** ARCH-003 serializes and encrypts the token set into a session cookie
    - **Then** the resulting cookie is httpOnly, Secure, SameSite=Strict, and ARCH-002's subsequent `getSession()` call deserializes it to the original token structure

#### Test Case: ITP-003-B (Cookie Tamper → Rejection)

**Technique**: Interface Fault Injection
**Target View**: Interface View
**Description**: Verifies that ARCH-003 rejects tampered or malformed session cookies and does not expose decryption errors to callers.

- **Integration Scenario: ITS-003-B1**
    - **Given** ARCH-002 passes a request with a tampered session cookie to ARCH-003's `getSession()`
    - **When** ARCH-003 attempts to decrypt and deserialize the cookie
    - **Then** ARCH-003 returns `null` (not an exception) and ARCH-002 treats the session as absent

---

### Module Verification: ARCH-004 (Mobile Auth Provider)

**Parent System Components**: SYS-002

#### Test Case: ITP-004-A (Secure Store Miss → IdP Login Trigger)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the handshake between ARCH-004 and ARCH-005: on app launch, ARCH-004 calls ARCH-005's `getToken()` and triggers the IdP login flow when no token is found.

- **Integration Scenario: ITS-004-A1**
    - **Given** ARCH-004 initializes on app launch and calls ARCH-005's `getToken()`
    - **When** ARCH-005 returns `null` (no stored token)
    - **Then** ARCH-004 triggers the IdP login screen via the mobile auth SDK and the React context state is set to `{isAuthenticated: false}`

- **Integration Scenario: ITS-004-A2**
    - **Given** ARCH-004 initializes and calls ARCH-005's `getToken()`
    - **When** ARCH-005 returns a valid `{access_token, refresh_token}` pair
    - **Then** ARCH-004 sets React context state to `{isAuthenticated: true}` without triggering the IdP login screen

#### Test Case: ITP-004-B (Auth State Update from ARCH-006)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-006 correctly signals ARCH-004 after successful token storage, updating the React context.

- **Integration Scenario: ITS-004-B1**
    - **Given** ARCH-006 has successfully stored tokens via ARCH-005 after a callback
    - **When** ARCH-006 dispatches the auth state update to ARCH-004
    - **Then** ARCH-004's React context transitions to `{isAuthenticated: true}` and protected content is rendered

---

### Module Verification: ARCH-005 (Mobile Secure Token Store)

**Parent System Components**: SYS-002

#### Test Case: ITP-005-A (Token Write → Read Round-Trip Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-005's `setToken()` output is correctly readable by `getToken()` and that the token format matches what ARCH-006 writes and ARCH-009 reads.

- **Integration Scenario: ITS-005-A1**
    - **Given** ARCH-006 calls ARCH-005's `setToken(access_token, refresh_token)` with valid JWT strings
    - **When** ARCH-004 subsequently calls ARCH-005's `getToken()`
    - **Then** ARCH-005 returns the exact `{access_token, refresh_token}` pair that was stored, with no transformation

#### Test Case: ITP-005-B (Clear Tokens → Subsequent Read Returns Null)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that `clearTokens()` correctly removes all stored tokens so that subsequent `getToken()` calls return null.

- **Integration Scenario: ITS-005-B1**
    - **Given** ARCH-005 holds a stored `{access_token, refresh_token}` pair
    - **When** ARCH-009 (or ARCH-004 on logout) calls ARCH-005's `clearTokens()`
    - **Then** a subsequent `getToken()` call returns `null`

---

### Module Verification: ARCH-006 (Mobile Auth Callback Handler)

**Parent System Components**: SYS-002

#### Test Case: ITP-006-A (Deep-Link Code → Token Store → Auth Provider Update)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the full data flow: ARCH-006 receives the deep-link authorization code, exchanges it with the IdP, stores tokens via ARCH-005, and signals ARCH-004.

- **Integration Scenario: ITS-006-A1**
    - **Given** ARCH-006 receives a deep-link `commise://auth/callback?code=<valid_code>&state=<valid_state>`
    - **When** ARCH-006 exchanges the code with the IdP's `/oauth/token` and receives `{access_token, refresh_token}`
    - **Then** ARCH-006 calls ARCH-005's `setToken()` with the received tokens, then dispatches auth state update to ARCH-004

#### Test Case: ITP-006-B (Token Exchange Failure → Secure Store Not Written)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-006 does not write to ARCH-005 when IdP token exchange fails.

- **Integration Scenario: ITS-006-B1**
    - **Given** the IdP's `/oauth/token` returns HTTP 400 to ARCH-006
    - **When** ARCH-006 receives the error
    - **Then** ARCH-006 does not call ARCH-005's `setToken()`, ARCH-004 remains in `{isAuthenticated: false}` state, and the error is reported to ARCH-029 (Sentry)

---

### Module Verification: ARCH-007 (Social Connection Configurator)

**Parent System Components**: SYS-003

#### Test Case: ITP-007-A (Social Provider Config → IdP Tenant Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-007's social connection configuration is correctly consumed by ARCH-001 (web) and ARCH-004 (mobile) login flows, surfacing the social login option.

- **Integration Scenario: ITS-007-A1**
    - **Given** ARCH-007 has configured the Google social connection in the IdP tenant
    - **When** ARCH-001 initiates the IdP login redirect
    - **Then** the IdP authorization URL includes the `connection=google-oauth2` parameter and the IdP login page presents the Google login option

- **Integration Scenario: ITS-007-A2**
    - **Given** ARCH-007 has configured the Google social connection
    - **When** ARCH-004 opens the IdP login screen on mobile
    - **Then** the IdP login screen presents the Google login option alongside email/password

---

### Module Verification: ARCH-008 (Token Refresh Service — Web)

**Parent System Components**: SYS-004, SYS-001

#### Test Case: ITP-008-A (Expired Access Token → Refresh → Cookie Update)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the data flow: ARCH-008 receives an expired token from ARCH-003, exchanges it with the IdP, and delivers the refreshed token set back to ARCH-003 for cookie update.

- **Integration Scenario: ITS-008-A1**
    - **Given** ARCH-002 delegates to ARCH-008 with an expired access token from ARCH-003
    - **When** ARCH-008 calls the IdP's `/oauth/token` with `grant_type=refresh_token` and receives a new `{access_token, refresh_token}`
    - **Then** ARCH-008 passes the new token set to ARCH-003's `updateSession()`, which updates the session cookie atomically

#### Test Case: ITP-008-B (Revoked Refresh Token → Re-Auth Redirect)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-008 correctly signals ARCH-002 to redirect to login when the IdP returns `invalid_grant`.

- **Integration Scenario: ITS-008-B1**
    - **Given** ARCH-008 calls the IdP's `/oauth/token` with a revoked refresh token
    - **When** the IdP returns HTTP 400 `{error: "invalid_grant"}`
    - **Then** ARCH-008 signals ARCH-002 with a refresh failure, ARCH-002 returns HTTP 302 to `/api/auth/login`, and ARCH-003 clears the session cookie

#### Test Case: ITP-008-C (Concurrent Refresh Requests — Lock Behavior)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that concurrent requests with the same expired token do not trigger multiple simultaneous refresh calls to the IdP.

- **Integration Scenario: ITS-008-C1**
    - **Given** two concurrent requests arrive at ARCH-002 with the same expired access token
    - **When** both requests delegate to ARCH-008 simultaneously
    - **Then** only one refresh call is made to the IdP (the second waits for the first), and both requests receive the same refreshed session cookie from ARCH-003

---

### Module Verification: ARCH-009 (Token Refresh Service — Mobile)

**Parent System Components**: SYS-004, SYS-002

#### Test Case: ITP-009-A (Expired Mobile Token → Refresh → Secure Store Update)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-009 reads the refresh token from ARCH-005, exchanges it with the IdP, and writes the new token set back to ARCH-005.

- **Integration Scenario: ITS-009-A1**
    - **Given** ARCH-004 detects an expired access token and delegates to ARCH-009
    - **When** ARCH-009 reads the refresh token from ARCH-005's `getToken()` and calls the IdP's `/oauth/token`
    - **Then** ARCH-009 receives a new `{access_token, refresh_token}` and calls ARCH-005's `setToken()` with the updated values

#### Test Case: ITP-009-B (Revoked Mobile Refresh Token → Clear Store → Re-Auth)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-009 clears ARCH-005 and triggers re-authentication via ARCH-004 when the refresh token is revoked.

- **Integration Scenario: ITS-009-B1**
    - **Given** ARCH-009 calls the IdP's `/oauth/token` with a revoked refresh token
    - **When** the IdP returns HTTP 400 `{error: "invalid_grant"}`
    - **Then** ARCH-009 calls ARCH-005's `clearTokens()` and signals ARCH-004 to trigger the IdP login screen

---

### Module Verification: ARCH-010 (Post-Registration IdP Handler)

**Parent System Components**: SYS-005

#### Test Case: ITP-010-A (IdP Registration Event → UUIDv4 → Provisioning Lambda Call)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the data flow from the IdP's `post-user-registration` event through ARCH-010 to ARCH-011, including the `app_metadata.userId` write.

- **Integration Scenario: ITS-010-A1**
    - **Given** the IdP fires a `post-user-registration` event to ARCH-010 with `{user: {user_id, email}}`
    - **When** ARCH-010 generates a UUIDv4 `userId`, writes it to IdP `app_metadata.userId` via the Management API, and calls ARCH-011 with `{identityUserId, userId, email}`
    - **Then** ARCH-011 receives the provisioning request with a valid UUIDv4 `userId` and returns HTTP 200

#### Test Case: ITP-010-B (Provisioning Lambda Failure → Action Failure Propagation)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-010 correctly handles ARCH-011 returning HTTP 500 after all retries are exhausted.

- **Integration Scenario: ITS-010-B1**
    - **Given** ARCH-011 returns HTTP 500 on all 3 retry attempts
    - **When** ARCH-010 exhausts its retry loop
    - **Then** ARCH-010 reports a handler failure to the IdP and the error is captured by ARCH-029 (Sentry)

---

### Module Verification: ARCH-011 (User Provisioning Lambda)

**Parent System Components**: SYS-005, SYS-006

#### Test Case: ITP-011-A (Provisioning Request → Transactional DB Write)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-011 correctly receives `{identityUserId, userId, email}` from ARCH-010 and writes both `users` and `accounts` records in a single PostgreSQL transaction.

- **Integration Scenario: ITS-011-A1**
    - **Given** ARCH-010 calls ARCH-011's `POST /internal/provision-user` with `{identityUserId: string, userId: UUIDv4, email: string}`
    - **When** ARCH-011 executes the transactional INSERT into `users` and `accounts`
    - **Then** ARCH-011 returns HTTP 200 and both records exist in PostgreSQL with matching `user_id` foreign key

#### Test Case: ITP-011-B (Transient DB Failure → Retry → Success)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-011 retries with exponential backoff on transient DB errors and succeeds on a subsequent attempt.

- **Integration Scenario: ITS-011-B1**
    - **Given** the PostgreSQL connection fails on the first INSERT attempt
    - **When** ARCH-011 applies exponential backoff and retries (up to 3 attempts)
    - **Then** ARCH-011 succeeds on the second attempt and returns HTTP 200 to ARCH-010

#### Test Case: ITP-011-C (Duplicate Registration — Idempotency)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-011 handles duplicate provisioning calls (same `userId`) without creating duplicate records.

- **Integration Scenario: ITS-011-C1**
    - **Given** ARCH-010 calls ARCH-011 twice with the same `{identityUserId, userId, email}` (e.g., due to retry)
    - **When** ARCH-011 processes the second call
    - **Then** ARCH-011 returns HTTP 200 (idempotent) and only one `users` record exists in PostgreSQL

---

### Module Verification: ARCH-012 (Reconciliation Lambda)

**Parent System Components**: SYS-007

#### Test Case: ITP-012-A (IdP User List → DB Comparison → Provisioning Delegation)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-012 correctly fetches the IdP user list, compares it with the Commise DB, and delegates missing records to ARCH-011.

- **Integration Scenario: ITS-012-A1**
    - **Given** the IdP Backend API returns a user list containing `user_A` and `user_B`, but only `user_A` exists in the Commise DB
    - **When** ARCH-012 compares the IdP list with the DB
    - **Then** ARCH-012 calls ARCH-011's `POST /internal/provision-user` for `user_B` only

#### Test Case: ITP-012-B (IdP Backend API Failure → Graceful Abort)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-012 aborts reconciliation and logs the error when the IdP Backend API is unavailable.

- **Integration Scenario: ITS-012-B1**
    - **Given** the IdP Backend API returns HTTP 503 to ARCH-012
    - **When** ARCH-012 attempts to fetch the user list
    - **Then** ARCH-012 aborts without calling ARCH-011, emits an error log via ARCH-027, and reports the failure to ARCH-029

---

### Module Verification: ARCH-013 (Profile View Component)

**Parent System Components**: SYS-008

#### Test Case: ITP-013-A (JWT → API Gateway → Profile Data Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-013 sends a correctly formatted Bearer JWT to the API Gateway, which routes through ARCH-024 and returns the profile data in the expected shape.

- **Integration Scenario: ITS-013-A1**
    - **Given** ARCH-013 holds a valid access token from ARCH-003 (web) or ARCH-005 (mobile)
    - **When** ARCH-013 sends `GET /account/profile` with `Authorization: Bearer <JWT>` to the API Gateway
    - **Then** ARCH-024 validates the JWT and the backend handler returns `{displayName, email, avatarUrl, createdAt}` in ISO 8601 format

---

### Module Verification: ARCH-014 (Account Edit Component)

**Parent System Components**: SYS-009

#### Test Case: ITP-014-A (Edit Form → ARCH-015 API Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-014 sends a correctly structured `PATCH /account` request to ARCH-015 with the edited fields.

- **Integration Scenario: ITS-014-A1**
    - **Given** ARCH-014 holds a valid `{displayName: string, avatarUrl?: string}` edit payload
    - **When** ARCH-014 sends `PATCH /account` with `Authorization: Bearer <JWT>` and the payload
    - **Then** ARCH-015 receives the request, validates the payload, and returns HTTP 200 with the updated account record

- **Integration Scenario: ITS-014-A2**
    - **Given** ARCH-014 sends a `PATCH /account` with an empty `displayName`
    - **When** ARCH-015 validates the input
    - **Then** ARCH-015 returns HTTP 400 `{error: "ValidationError", message: "displayName must not be empty"}`

---

### Module Verification: ARCH-015 (Account Edit API Handler)

**Parent System Components**: SYS-009

#### Test Case: ITP-015-A (JWT Authorizer → Edit Handler → DB Write)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the data flow from ARCH-024's authorization context through ARCH-015 to the PostgreSQL `accounts` table.

- **Integration Scenario: ITS-015-A1**
    - **Given** ARCH-024 passes `{userId: UUIDv4}` in the request context to ARCH-015
    - **When** ARCH-015 receives `PATCH /account` with `{displayName: "New Name"}`
    - **Then** ARCH-015 updates the `accounts` record for `userId` in PostgreSQL and returns HTTP 200 with the updated record

#### Test Case: ITP-015-B (Unauthorized Edit → 401 from Authorizer)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-015 is never reached when ARCH-024 denies the request.

- **Integration Scenario: ITS-015-B1**
    - **Given** ARCH-014 sends `PATCH /account` with an expired JWT
    - **When** ARCH-024 validates the token and finds it expired
    - **Then** API Gateway returns HTTP 401 and ARCH-015 is not invoked

---

### Module Verification: ARCH-016 (Account Deletion Component)

**Parent System Components**: SYS-010

#### Test Case: ITP-016-A (Confirmation Payload → ARCH-017 Delete Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-016 sends the correct `{confirmation: "DELETE"}` payload to ARCH-017 and handles the response.

- **Integration Scenario: ITS-016-A1**
    - **Given** ARCH-016 has received the user's "DELETE" confirmation input
    - **When** ARCH-016 sends `DELETE /account` with `Authorization: Bearer <JWT>` and `{confirmation: "DELETE"}`
    - **Then** ARCH-017 receives the request, validates the confirmation string, and returns HTTP 200

- **Integration Scenario: ITS-016-A2**
    - **Given** ARCH-016 sends `DELETE /account` with `{confirmation: "delete"}` (wrong case)
    - **When** ARCH-017 validates the confirmation
    - **Then** ARCH-017 returns HTTP 400 and ARCH-016 displays an error state

---

### Module Verification: ARCH-017 (Account Deletion API Handler)

**Parent System Components**: SYS-010

#### Test Case: ITP-017-A (Delete Request → DB Cascade → IdP Deletion)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the full deletion data flow: ARCH-017 cascades DB deletion and then calls the IdP Backend API to delete the user.

- **Integration Scenario: ITS-017-A1**
    - **Given** ARCH-024 passes `{userId: UUIDv4, identityUserId: string}` to ARCH-017 via request context
    - **When** ARCH-017 executes `DELETE FROM accounts WHERE user_id = userId` (cascade) and `DELETE FROM users WHERE id = userId`
    - **Then** ARCH-017 calls IdP Backend API `DELETE /api/v2/users/{identityUserId}` and returns HTTP 200 on success

#### Test Case: ITP-017-B (IdP Deletion Failure → DB Rollback)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-017 rolls back DB changes if the IdP Backend API deletion fails.

- **Integration Scenario: ITS-017-B1**
    - **Given** ARCH-017 has successfully deleted DB records but the IdP Backend API returns HTTP 500
    - **When** ARCH-017 receives the IdP error
    - **Then** ARCH-017 rolls back the DB transaction, returns HTTP 500 to ARCH-016, and reports the failure to ARCH-029

---

### Module Verification: ARCH-018 (Password Reset Link Component)

**Parent System Components**: SYS-011

#### Test Case: ITP-018-A (Password Reset Redirect → IdP Hosted Page Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-018 produces a correctly formatted redirect to the IdP's hosted password reset page.

- **Integration Scenario: ITS-018-A1**
    - **Given** ARCH-018 is rendered on the login screen
    - **When** the "Forgot Password" link is activated
    - **Then** ARCH-018 redirects to the IdP's hosted password reset URL with the correct `client_id` and `connection` parameters, and no backend module is invoked

---

### Module Verification: ARCH-019 (MFA Enrollment Component)

**Parent System Components**: SYS-012

#### Test Case: ITP-019-A (MFA Enrollment Redirect → IdP Backend API Link Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-019 correctly constructs the IdP MFA enrollment redirect URL using the Management API link.

- **Integration Scenario: ITS-019-A1**
    - **Given** ARCH-019 is rendered in account settings with a valid access token from ARCH-003/ARCH-005
    - **When** the MFA enrollment action is triggered
    - **Then** ARCH-019 redirects to the IdP MFA enrollment page URL obtained via the Management API, with the correct `user_id` parameter

---

### Module Verification: ARCH-020 (Social Account Linking API Handler)

**Parent System Components**: SYS-013

#### Test Case: ITP-020-A (Link Request → IdP Backend API → DB Update)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-020 correctly calls IdP Backend API to link a social provider and reflects the change.

- **Integration Scenario: ITS-020-A1**
    - **Given** ARCH-021 sends `POST /account/social-link` with `{provider: "google-oauth2", connection_token: string}` and a valid JWT
    - **When** ARCH-024 authorizes the request and ARCH-020 calls IdP Backend API `POST /api/v2/users/{identityUserId}/identities`
    - **Then** the IdP returns the updated identities array and ARCH-020 returns HTTP 200 with the linked provider list

#### Test Case: ITP-020-B (Unlink Last Provider → Rejection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-020 rejects an unlink request that would leave the user with no authentication provider.

- **Integration Scenario: ITS-020-B1**
    - **Given** the user has only one linked provider (e.g., Google)
    - **When** ARCH-021 sends `DELETE /account/social-link` with `{provider: "google-oauth2"}`
    - **Then** ARCH-020 returns HTTP 400 `{error: "LastProviderError", message: "At least one provider must remain"}` without calling IdP Backend API

---

### Module Verification: ARCH-021 (Social Account Linking Component)

**Parent System Components**: SYS-013

#### Test Case: ITP-021-A (Link/Unlink UI → ARCH-020 API Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-021 sends correctly structured requests to ARCH-020 for both link and unlink operations.

- **Integration Scenario: ITS-021-A1**
    - **Given** ARCH-021 displays the current linked providers and the user initiates a link action
    - **When** ARCH-021 sends `POST /account/social-link` with the provider and connection token
    - **Then** ARCH-020 processes the request and ARCH-021 updates the displayed provider list on HTTP 200

- **Integration Scenario: ITS-021-A2**
    - **Given** ARCH-021 displays a linked provider and the user initiates an unlink action
    - **When** ARCH-021 sends `DELETE /account/social-link` with the provider identifier
    - **Then** ARCH-020 processes the request and ARCH-021 removes the provider from the displayed list on HTTP 200

---

### Module Verification: ARCH-022 (Impersonation Token Exchange Service)

**Parent System Components**: SYS-014

#### Test Case: ITP-022-A (Impersonation Request → IdP Token Exchange → Claims Injection)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-022 correctly exchanges for an impersonation token and injects the required claims before returning.

- **Integration Scenario: ITS-022-A1**
    - **Given** an authorized admin calls ARCH-022 with `{targetUserId: UUIDv4, impersonatorId: UUIDv4}`
    - **When** ARCH-022 calls the IdP's token exchange endpoint
    - **Then** ARCH-022 returns a JWT containing `{impersonation: true, impersonatorId: UUIDv4, sub: targetUserId}` claims

#### Test Case: ITP-022-B (Unauthorized Impersonation → Rejection)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-022 rejects impersonation requests from non-admin callers.

- **Integration Scenario: ITS-022-B1**
    - **Given** a non-admin caller sends an impersonation request to ARCH-022
    - **When** ARCH-022 validates the caller's authorization
    - **Then** ARCH-022 returns HTTP 403 without calling the IdP's token exchange endpoint

---

### Module Verification: ARCH-023 (Impersonation Audit Logger)

**Parent System Components**: SYS-014

#### Test Case: ITP-023-A (Impersonation JWT → Audit Log Emission)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-023 correctly detects the impersonation flag in JWT claims and emits a structured audit log entry via ARCH-027.

- **Integration Scenario: ITS-023-A1**
    - **Given** a request arrives at a backend handler with a JWT containing `{impersonation: true, impersonatorId: string}`
    - **When** ARCH-023 middleware inspects the JWT claims
    - **Then** ARCH-023 calls ARCH-027's structured logger with `{impersonatorId, impersonatedUserId, action, timestamp: ISO8601}` and the request proceeds normally

- **Integration Scenario: ITS-023-A2**
    - **Given** a request arrives with a JWT that does not contain the impersonation flag
    - **When** ARCH-023 inspects the JWT claims
    - **Then** ARCH-023 does not emit an audit log entry and the request proceeds without modification

---

### Module Verification: ARCH-024 (API Gateway JWT Authorizer Lambda)

**Parent System Components**: SYS-015

#### Test Case: ITP-024-A (Valid JWT → JWKS Validation → IAM Allow Policy)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies the full data flow: ARCH-024 fetches JWKS from the IdP, validates the JWT, extracts `app_metadata.userId`, delegates to ARCH-025, and returns an IAM Allow policy.

- **Integration Scenario: ITS-024-A1**
    - **Given** API Gateway invokes ARCH-024 with a valid Bearer JWT
    - **When** ARCH-024 fetches the JWKS from the IdP (or uses the cached set), validates signature/expiry/audience/issuer, and extracts `app_metadata.userId`
    - **Then** ARCH-024 calls ARCH-025 with `userId`, receives `{status: "active"}`, and returns `{Effect: "Allow", Action: "execute-api:Invoke", Resource: "*", context: {userId}}` to API Gateway

#### Test Case: ITP-024-B (Expired JWT → IAM Deny Policy)

**Technique**: Interface Fault Injection
**Target View**: Interface View + Process View
**Description**: Verifies that ARCH-024 returns an IAM Deny policy for expired JWTs without invoking ARCH-025.

- **Integration Scenario: ITS-024-B1**
    - **Given** API Gateway invokes ARCH-024 with an expired JWT
    - **When** ARCH-024 validates the token expiry claim
    - **Then** ARCH-024 returns `{Effect: "Deny"}` to API Gateway without calling ARCH-025

#### Test Case: ITP-024-C (JWKS Cache — Warm Invocation Reuse)

**Technique**: Concurrency & Race Condition Testing
**Target View**: Process View
**Description**: Verifies that concurrent Lambda invocations reuse the in-memory JWKS cache rather than making redundant IdP JWKS fetches.

- **Integration Scenario: ITS-024-C1**
    - **Given** ARCH-024 has a warm Lambda instance with a cached JWKS
    - **When** two concurrent authorization requests arrive
    - **Then** both requests use the cached JWKS without making additional calls to the IdP's JWKS endpoint

---

### Module Verification: ARCH-025 (Suspension Status Checker)

**Parent System Components**: SYS-015, SYS-016

#### Test Case: ITP-025-A (Active User → Allow Signal to ARCH-024)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-025 returns an active status to ARCH-024 for non-suspended users.

- **Integration Scenario: ITS-025-A1**
    - **Given** ARCH-024 calls ARCH-025 with a `userId` that is not suspended in the IdP or the Commise DB
    - **When** ARCH-025 checks the `blocked` flag in the IdP and the `status` field in the DB
    - **Then** ARCH-025 returns `{status: "active"}` to ARCH-024

#### Test Case: ITP-025-B (Suspended User → Deny Signal to ARCH-024)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-025 returns a suspended status to ARCH-024 for blocked users.

- **Integration Scenario: ITS-025-B1**
    - **Given** ARCH-024 calls ARCH-025 with a `userId` that has `blocked: true` in the IdP
    - **When** ARCH-025 checks the suspension status
    - **Then** ARCH-025 returns `{status: "suspended"}` to ARCH-024, which returns an IAM Deny policy

---

### Module Verification: ARCH-026 (User Suspension API Handler)

**Parent System Components**: SYS-016

#### Test Case: ITP-026-A (Suspend Request → IdP Block + DB Status Update)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-026 correctly calls IdP Backend API to block the user and updates the Commise DB `status` field.

- **Integration Scenario: ITS-026-A1**
    - **Given** an admin sends `POST /admin/users/{id}/suspend` with a valid admin JWT
    - **When** ARCH-024 authorizes the request and ARCH-026 calls IdP Backend API `PATCH /api/v2/users/{identityUserId}` with `{blocked: true}`
    - **Then** the IdP returns HTTP 200, ARCH-026 updates `users.status = "suspended"` in PostgreSQL, and returns HTTP 200

#### Test Case: ITP-026-B (Reactivation → IdP Unblock + DB Status Update)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-026 correctly unblocks the user in the IdP and updates the DB status to active.

- **Integration Scenario: ITS-026-B1**
    - **Given** an admin sends `POST /admin/users/{id}/reactivate` with a valid admin JWT
    - **When** ARCH-026 calls IdP Backend API with `{blocked: false}`
    - **Then** the IdP returns HTTP 200, ARCH-026 updates `users.status = "active"` in PostgreSQL, and returns HTTP 200

---

### Module Verification: ARCH-027 (Structured Logger)

**Parent System Components**: SYS-017 [CROSS-CUTTING]

#### Test Case: ITP-027-A (Lambda Invocation → Structured Log Emission Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-027 correctly receives log payloads from calling Lambda modules and emits JSON-structured log entries with required fields.

- **Integration Scenario: ITS-027-A1**
    - **Given** ARCH-011 calls ARCH-027's logger with `{level: "info", message: "User provisioned", userId: UUIDv4, correlationId: string}`
    - **When** ARCH-027 processes the log call
    - **Then** ARCH-027 emits a CloudWatch log entry with `{level, message, userId, correlationId, timestamp: ISO8601}` in JSON format

#### Test Case: ITP-027-B (Correlation ID Propagation Across Module Boundaries)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that the correlation ID set by ARCH-027 in one module is correctly propagated to log entries in downstream modules within the same request.

- **Integration Scenario: ITS-027-B1**
    - **Given** ARCH-024 sets a `correlationId` in the request context and calls ARCH-027
    - **When** ARCH-025 subsequently calls ARCH-027 within the same invocation
    - **Then** both log entries share the same `correlationId` value

---

### Module Verification: ARCH-028 (CloudWatch Metrics Emitter)

**Parent System Components**: SYS-017 [CROSS-CUTTING]

#### Test Case: ITP-028-A (Auth Event → Custom Metric Emission Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-028 correctly receives auth event signals from backend modules and emits the corresponding CloudWatch custom metrics.

- **Integration Scenario: ITS-028-A1**
    - **Given** ARCH-001 signals a successful login event to ARCH-028
    - **When** ARCH-028 processes the signal
    - **Then** ARCH-028 emits a CloudWatch custom metric `AuthLoginSuccess` with the correct namespace, dimensions, and value

- **Integration Scenario: ITS-028-A2**
    - **Given** ARCH-024 signals a JWT validation failure to ARCH-028
    - **When** ARCH-028 processes the signal
    - **Then** ARCH-028 emits a CloudWatch custom metric `AuthTokenValidationFailure` with the correct namespace and dimensions

---

### Module Verification: ARCH-029 (Sentry Integration Wrapper)

**Parent System Components**: SYS-017 [CROSS-CUTTING]

#### Test Case: ITP-029-A (Lambda Error → Sentry Capture Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-029 correctly receives error objects from Lambda modules and forwards them to Sentry with the required context.

- **Integration Scenario: ITS-029-A1**
    - **Given** ARCH-011 catches an unhandled error and calls ARCH-029's `captureException(error, {userId, correlationId})`
    - **When** ARCH-029 processes the capture call
    - **Then** ARCH-029 forwards the error to Sentry with `{userId, correlationId, environment, release}` context attached

#### Test Case: ITP-029-B (Client-Side Error → Sentry Breadcrumb Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-029's React/React Native wrapper correctly captures client-side breadcrumbs and error events.

- **Integration Scenario: ITS-029-B1**
    - **Given** ARCH-004 encounters an unhandled error during the mobile auth flow
    - **When** ARCH-029's `@sentry/react-native` wrapper captures the error
    - **Then** Sentry receives the error event with the preceding breadcrumb trail from the mobile auth flow

---

### Module Verification: ARCH-030 (CDK Auth Stack)

**Parent System Components**: SYS-018 [CROSS-CUTTING]

#### Test Case: ITP-030-A (CDK Stack → Lambda Deployment Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-030 correctly provisions all required Lambda functions with the expected IAM roles, environment variables, and API Gateway integrations.

- **Integration Scenario: ITS-030-A1**
    - **Given** ARCH-030's CDK stack is synthesized and deployed
    - **When** the deployed API Gateway receives a `POST /internal/provision-user` request
    - **Then** the request is routed to ARCH-011's Lambda function with the correct IAM execution role and environment variables (`DB_HOST`, `DB_PORT`, etc.)

#### Test Case: ITP-030-B (SQS Queue → Lambda Trigger Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-030 correctly wires SQS queues to their Lambda consumers.

- **Integration Scenario: ITS-030-B1**
    - **Given** ARCH-030 has provisioned an SQS queue with a Lambda event source mapping
    - **When** a message is published to the SQS queue
    - **Then** the target Lambda function is invoked with the SQS message payload within the configured batch window

---

### Module Verification: ARCH-031 (Shared Auth Types Library)

**Parent System Components**: SYS-019 [CROSS-CUTTING]

#### Test Case: ITP-031-A (Type Contract — Producer/Consumer Compatibility)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that types defined in ARCH-031 are correctly consumed by both producer modules (e.g., ARCH-024) and consumer modules (e.g., ARCH-011, ARCH-015) without shape mismatches.

- **Integration Scenario: ITS-031-A1**
    - **Given** ARCH-024 produces a `JWTClaims` object conforming to ARCH-031's type definition
    - **When** ARCH-025 consumes the `JWTClaims` object via the shared type
    - **Then** TypeScript compilation succeeds with no type errors and the `userId` field is correctly typed as `UUIDv4`

#### Test Case: ITP-031-B (API Request/Response Shape — Cross-Module Compatibility)

**Technique**: Data Flow Testing
**Target View**: Data Flow View
**Description**: Verifies that ARCH-031's API request/response types correctly describe the data flowing between frontend components and backend handlers.

- **Integration Scenario: ITS-031-B1**
    - **Given** ARCH-014 constructs a `PatchAccountRequest` conforming to ARCH-031's type
    - **When** ARCH-015 receives and deserializes the request body
    - **Then** the deserialized object matches the `PatchAccountRequest` type definition with no runtime shape errors

---

### Module Verification: ARCH-032 (Custom Auth Error Classes)

**Parent System Components**: SYS-019 [CROSS-CUTTING]

#### Test Case: ITP-032-A (Error Throw → Type Guard → Caller Handling Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-032's custom error classes are correctly thrown by producer modules and identified by type guards in consumer modules.

- **Integration Scenario: ITS-032-A1**
    - **Given** ARCH-008 throws an `AuthSessionExpiredError` (from ARCH-032) when the refresh token is revoked
    - **When** ARCH-002 catches the error and calls `isAuthSessionExpiredError(error)`
    - **Then** the type guard returns `true` and ARCH-002 redirects to the IdP login page

- **Integration Scenario: ITS-032-A2**
    - **Given** ARCH-017 throws an `AccountDeletionFailedError` (from ARCH-032) when IdP deletion fails
    - **When** ARCH-016 catches the error and calls `isAccountDeletionFailedError(error)`
    - **Then** the type guard returns `true` and ARCH-016 displays the appropriate error state

---

### Module Verification: ARCH-033 (Auth UI Design Tokens Integration)

**Parent System Components**: SYS-020 [CROSS-CUTTING]

#### Test Case: ITP-033-A (Design Token → Auth Component Rendering Contract)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-033's design tokens are correctly applied to auth UI components (ARCH-001, ARCH-004, ARCH-013, ARCH-014, ARCH-016, ARCH-019, ARCH-021) and that accessible names are present.

- **Integration Scenario: ITS-033-A1**
    - **Given** ARCH-033 provides `--accent-primary` and semantic status color tokens
    - **When** ARCH-013 (Profile View) renders using the design token system
    - **Then** the rendered component uses `--accent-primary` for interactive elements and all interactive elements have accessible names queryable via `getByRole`/`getByLabel`

#### Test Case: ITP-033-B (Non-Color-Only Status Indicators)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that ARCH-033 enforces non-color-only status indicators across auth UI components.

- **Integration Scenario: ITS-033-B1**
    - **Given** ARCH-033 applies status color tokens to an error state in ARCH-014 (Account Edit)
    - **When** the error state is rendered
    - **Then** the error indicator includes both a color change (via design token) and a non-color indicator (icon or text label), satisfying WCAG 1.4.1

---

## Test Harness & Mocking Strategy

| Test Case | External Dependency            | Mock/Stub Strategy                                   | Rationale                                                         |
| --------- | ------------------------------ | ---------------------------------------------------- | ----------------------------------------------------------------- |
| ITP-001-A | IdP `/oauth/token`             | HTTP stub returning valid token response             | Isolate ARCH-001↔ARCH-003 boundary from IdP availability          |
| ITP-001-B | IdP `/oauth/token`             | HTTP stub returning 400 `invalid_grant`              | Test error propagation without live IdP                           |
| ITP-002-B | ARCH-008 Token Refresh Service | Spy on ARCH-008 delegation call                      | Verify ARCH-002 correctly delegates on token expiry               |
| ITP-003-B | Cookie decryption              | Inject tampered cookie bytes                         | Verify ARCH-003 returns null without throwing                     |
| ITP-006-B | IdP `/oauth/token`             | HTTP stub returning 400                              | Verify ARCH-006 does not write to ARCH-005 on failure             |
| ITP-008-C | IdP `/oauth/token`             | HTTP stub with 200ms delay                           | Simulate concurrent refresh race; verify single IdP call          |
| ITP-010-A | IdP Backend API                | HTTP stub for `PATCH /api/v2/users/{id}`             | Isolate ARCH-010 from live IdP Backend API                        |
| ITP-011-B | PostgreSQL (RDS)               | Fault-injecting DB proxy (first call fails)          | Simulate transient DB failure for retry verification              |
| ITP-011-C | PostgreSQL (RDS)               | Real DB with unique constraint on `identity_id`      | Verify idempotency via DB constraint                              |
| ITP-012-A | IdP Backend API + DB           | HTTP stub for user list; seeded test DB              | Control reconciliation inputs precisely                           |
| ITP-017-B | IdP Backend API                | HTTP stub returning 500 on DELETE                    | Verify DB rollback on IdP deletion failure                        |
| ITP-022-B | IdP token exchange             | Stub not called; verify via spy                      | Confirm IdP is not called for unauthorized impersonation requests |
| ITP-024-C | IdP JWKS endpoint              | Spy on JWKS fetch; warm Lambda instance              | Verify cache reuse across concurrent invocations                  |
| ITP-026-A | IdP Backend API + DB           | HTTP stub for PATCH; real test DB                    | Verify both IdP block and DB status update                        |
| ITP-030-A | AWS CDK deployment             | CDK integration test (CDK Assertions or real deploy) | Verify Lambda routing and IAM role assignment post-deploy         |
| ITP-030-B | AWS SQS + Lambda               | LocalStack or real AWS test environment              | Verify SQS→Lambda event source mapping                            |
| ITP-031-A | TypeScript compiler            | `tsc --noEmit` in CI                                 | Type compatibility verified at compile time                       |
| ITP-033-A | DOM / React Native renderer    | Jest + Testing Library render                        | Verify accessible names via `getByRole`/`getByLabel`              |

---

## Coverage Summary

| Metric                            | Count          |
| --------------------------------- | -------------- |
| Total Architecture Modules (ARCH) | 33             |
| Total Test Cases (ITP)            | 59             |
| Total Scenarios (ITS)             | 69             |
| Modules with ≥1 ITP               | 33 / 33 (100%) |
| Test Cases with ≥1 ITS            | 59 / 59 (100%) |
| **Overall Coverage (ARCH→ITP)**   | **100%**       |

### Technique Distribution

| Technique                            | Test Cases | Percentage |
| ------------------------------------ | ---------- | ---------- |
| Interface Contract Testing           | 33         | 56%        |
| Data Flow Testing                    | 17         | 29%        |
| Interface Fault Injection            | 7          | 12%        |
| Concurrency & Race Condition Testing | 2          | 3%         |

## Uncovered Modules

None — full coverage achieved.
