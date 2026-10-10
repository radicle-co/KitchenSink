# Unit Test Plan: User Authentication

**Feature Branch**: `002-user-auth`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/002-user-auth/v-model/module-design.md`

## Overview

This document defines the Unit Test Plan for the User Authentication feature. Every module design (`MOD-NNN`) in `module-design.md` has one or more Test Cases (`UTP-NNN-X`), and every Test Case has one or more executable Unit Scenarios (`UTS-NNN-X#`) in white-box Arrange/Act/Assert format.

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

### Module: MOD-001 (Web Auth Route Handler)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `packages/apps/commise/web/app/api/auth/[...clerk]/route.ts`

---

#### Test Case: UTP-001-A (handleAuthRoute — login/logout/callback routing)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies the route handler dispatches correctly on login, logout, callback, and unknown params.

**Scenarios:**

**UTS-001-A1** — login param → 302 redirect to the IdP login URL

- Arrange: request = mock NextRequest with url containing "?param=login"
- Act: result = await handleAuthRoute("login", request)
- Assert: result.status === 302; verify redirect destination includes IDP_DOMAIN + '/authorize'
- Mock isolation: idpLoginUrl, clearSession stubbed

**UTS-001-A2** — logout param → session cleared, redirect to the IdP logout URL

- Arrange: request = mock NextRequest with "?param=logout"; mock clearSession = jest.fn()
- Act: result = await handleAuthRoute("logout", request)
- Assert: result.status === 302; verify clearSession called once; redirect includes IDP_DOMAIN + '/v2/logout'
- Mock isolation: clearSession, idpLogoutUrl stubbed

**UTS-001-A3** — callback param, state matches → token exchange, session set, redirect to /dashboard

- Arrange: request = mock NextRequest with "?param=callback&code=auth-code-123&state=valid-state"; mock getCookie("auth_state") → "valid-state"; mock exchangeCodeForTokens("auth-code-123") → { accessToken: 'at', refreshToken: 'rt' }; mock buildSession() → mockSession; mock setSessionCookie() → void
- Act: result = await handleAuthRoute("callback", request)
- Assert: result.status === 302; verify exchangeCodeForTokens called with "auth-code-123"; verify setSessionCookie called; redirect destination === '/dashboard'
- Mock isolation: exchangeCodeForTokens, buildSession, setSessionCookie, getCookie stubbed

**UTS-001-A4** — callback param, state mismatch → AuthCallbackError thrown

- Arrange: request = mock NextRequest with "?param=callback&code=auth-code&state=wrong-state"; mock getCookie("auth_state") → "correct-state"
- Act/Assert: handleAuthRoute("callback", request) throws AuthCallbackError with message containing "State mismatch"
- Mock isolation: getCookie stubbed

**UTS-001-A5** — unknown param → AuthCallbackError "Unknown IdP route"

- Arrange: request = mock NextRequest with "?param=register"
- Act/Assert: handleAuthRoute("register", request) throws AuthCallbackError with message containing "Unknown IdP route"
- Mock isolation: none

---

#### Test Case: UTP-001-B (exchangeCodeForTokens — token response parsing)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies token exchange POST body construction and parseTokenResponse handles valid, malformed, and error responses.

**Scenarios:**

**UTS-001-B1** — Valid token response → Tokens object returned

- Arrange: mock fetch() → { ok: true, json: () => Promise.resolve({ access_token: 'eyJ...', refresh_token: 'rt_abc', token_type: 'Bearer', expires_in: 86400 }) }
- Act: result = await exchangeCodeForTokens('valid-code')
- Assert: result.accessToken === 'eyJ...'; result.refreshToken === 'rt_abc'; result.tokenType === 'Bearer'
- Mock isolation: fetch stubbed

**UTS-001-B2** — Network error on token endpoint → AuthCallbackError 500

- Arrange: mock fetch() → Promise.reject(new Error('ENOTFOUND'))
- Act/Assert: exchangeCodeForTokens('code') throws AuthCallbackError with code 500
- Mock isolation: fetch stubbed

**UTS-001-B3** — IdP returns error_description → AuthCallbackError 400

- Arrange: mock fetch() → { ok: false, status: 400, json: () => Promise.resolve({ error: 'invalid_grant', error_description: 'Invalid authorization code' }) }
- Act/Assert: exchangeCodeForTokens('bad-code') throws AuthCallbackError with code 400
- Mock isolation: fetch stubbed

---

### Module: MOD-002 (Web Auth Middleware Guard)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `packages/apps/commise/web/middleware.ts`

---

#### Test Case: UTP-002-A (middleware — route classification and redirect logic)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies public path passthrough, unauthenticated redirect to login, and authenticated request header injection.

**Scenarios:**

**UTS-002-A1** — Public path /api/auth/login → NextResponse.next(), no redirect

- Arrange: request = mock NextRequest with url "https://app.com/api/auth/login?returnTo=/dashboard"; mock getSessionFromCookie() → null
- Act: result = await middleware(request)
- Assert: result.status === 200; verify getSessionFromCookie NOT called (public path short-circuit)
- Mock isolation: getSessionFromCookie stubbed (should not be called)

**UTS-002-A2** — Private path, no session → 302 redirect to /api/auth/login with returnTo

- Arrange: request = mock NextRequest with url "https://app.com/recipes"; mock getSessionFromCookie() → null
- Act: result = await middleware(request)
- Assert: result.status === 302; verify redirect destination starts with '/api/auth/login'; redirect includes returnTo encoded
- Mock isolation: getSessionFromCookie stubbed

**UTS-002-A3** — Private path, session present but user.sub is null → 302 to /api/auth/login

- Arrange: mockSession = { accessToken: 'at', refreshToken: 'rt', user: { sub: null } }; mock getSessionFromCookie() → mockSession
- Act: result = await middleware(request)
- Assert: result.status === 302; redirect destination === '/api/auth/login'
- Mock isolation: getSessionFromCookie stubbed

**UTS-002-A4** — Private path, valid session → NextResponse.next() with x-user-id header set

- Arrange: mockSession = { accessToken: 'at', refreshToken: 'rt', user: { sub: 'user-uuid-123', email: 'test@example.com' } }; mock getSessionFromCookie() → mockSession
- Act: result = await middleware(request)
- Assert: result.status === 200; request.headers.get('x-user-id') === 'user-uuid-123'
- Mock isolation: getSessionFromCookie stubbed

**UTS-002-A5** — Static assets /\_next/... → passthrough without auth check

- Arrange: request = mock NextRequest with url "https://app.com/_next/static/chunk.js"
- Act: result = await middleware(request)
- Assert: result.status === 200; verify getSessionFromCookie NOT called
- Mock isolation: getSessionFromCookie stubbed

---

### Module: MOD-003 (Web Session Cookie Manager)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `packages/apps/commise/web/lib/auth/session-manager.ts`

---

#### Test Case: UTP-003-A (getSession + clearSession)

**Technique**: Statement Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies getSession decryption, expiry check, and clearSession deletion. Also verifies that decryption failures trigger clearSession.

**Scenarios:**

**UTS-003-A1** — Valid unexpired cookie → session returned

- Arrange: mock getCookie("session") → mockEncryptedCookie; mock decryptCookie() → { expiry: Date.now() + 3600_000, accessToken: 'at', user: { sub: 'uid' } }; mockCookie = mockEncryptedCookie
- Act: result = getSession()
- Assert: result !== null; result.accessToken === 'at'; verify clearSession NOT called
- Mock isolation: getCookie, decryptCookie stubbed

**UTS-003-A2** — Expired session → clearSession called, null returned

- Arrange: mock getCookie("session") → mockEncryptedCookie; mock decryptCookie() → { expiry: Date.now() - 1000, accessToken: 'old', user: {} }; mock clearSession = jest.fn()
- Act: result = getSession()
- Assert: result === null; verify clearSession called once
- Mock isolation: getCookie, decryptCookie, clearSession stubbed

**UTS-003-A3** — No session cookie → null returned, clearSession not called

- Arrange: mock getCookie("session") → null
- Act: result = getSession()
- Assert: result === null; verify clearSession NOT called
- Mock isolation: getCookie stubbed

**UTS-003-A4** — DecryptCookie throws → clearSession called, null returned

- Arrange: mock getCookie("session") → 'tampered-cookie'; mock decryptCookie() → throws new Error('bad MAC'); mock clearSession = jest.fn()
- Act: result = getSession()
- Assert: result === null; verify clearSession called once
- Mock isolation: getCookie, decryptCookie, clearSession stubbed

---

#### Test Case: UTP-003-B (encryptCookie / decryptCookie — AES-256-GCM round-trip)

**Technique**: Boundary Value Analysis + Statement Coverage
**Target View**: Internal Data Structures View
**Description**: Verifies encryptCookie produces base64url-encoded AES-256-GCM ciphertext, and decryptCookie recovers the original session exactly.

**Scenarios:**

**UTS-003-B1** — Round-trip: encrypt then decrypt recovers original session

- Arrange: session = { accessToken: 'token-abc', refreshToken: 'refresh-xyz', user: { sub: 'user-123', email: 'a@b.com' }, expiry: Date.now() + 86400_000 }
- Act: encrypted = encryptCookie(session); decrypted = decryptCookie(encrypted)
- Assert: decrypted.accessToken === session.accessToken; decrypted.refreshToken === session.refreshToken; decrypted.user.sub === 'user-123'
- Mock isolation: none (uses real crypto via Node.js crypto module)

**UTS-003-B2** — Tampered ciphertext (wrong last 8 bytes flipped) → decryptCookie throws

- Arrange: encrypted = encryptCookie(mockSession); tampered = encrypted.slice(0, -8) + 'ffffffffffffffff'
- Act/Assert: decryptCookie(tampered) throws Error (auth tag mismatch)
- Mock isolation: none

**UTS-003-B3** — Cookie value missing parts → decryptCookie throws

- Arrange: corrupted = 'abc123.def456' (only 2 parts, needs 3)
- Act/Assert: decryptCookie(corrupted) throws Error
- Mock isolation: none

---

### Module: MOD-004 (Web JWT Decoder)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `packages/apps/commise/web/lib/auth/jwt-decoder.ts`

---

#### Test Case: UTP-004-A (decodeJWT — valid and invalid JWT structures)

**Technique**: Statement & Branch Coverage + Equivalence Partitioning
**Target View**: Algorithmic/Logic View
**Description**: Verifies header parsing, payload extraction, and error handling for malformed tokens.

**Scenarios:**

**UTS-004-A1** — Valid 3-part JWT → payload sub and email extracted

- Arrange: jwt = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTEyMyIsImVtYWlsIjoidGVzdEBleGFtcGxlLmNvbSIsImlhdCI6MTcwOTk5OTk5OX0.signature'
- Act: result = decodeJWT(jwt)
- Assert: result.sub === 'user-123'; result.email === 'test@example.com'
- Mock isolation: none (uses jose library directly)

**UTS-004-A2** — JWT missing payload part → Error thrown

- Arrange: jwt = 'header.signature' (no payload)
- Act/Assert: decodeJWT(jwt) throws Error with message containing 'Invalid JWT format'
- Mock isolation: none

**UTS-004-A3** — Base64 decode error in payload → Error thrown

- Arrange: jwt = 'valid-header.!!!invalid-base64!!.signature'
- Act/Assert: decodeJWT(jwt) throws Error
- Mock isolation: none

---

### Module: MOD-005 (Web Route Protector)

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `packages/apps/commise/web/lib/auth/route-protector.ts`

---

#### Test Case: UTP-005-A (requireAuth — session validation and redirect)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies requireAuth returns user when valid session present, throws when no session.

**Scenarios:**

**UTS-005-A1** — Valid session → user object returned

- Arrange: mockSession = { user: { sub: 'user-456', email: 'cook@example.com' } }; mock getSession() → mockSession
- Act: result = requireAuth()
- Assert: result.sub === 'user-456'; result.email === 'cook@example.com'
- Mock isolation: getSession stubbed

**UTS-005-A2** — No session → Error thrown with auth required message

- Arrange: mock getSession() → null
- Act/Assert: requireAuth() throws Error with message 'Authentication required'
- Mock isolation: getSession stubbed

**UTS-005-A3** — Session missing user.sub → Error thrown

- Arrange: mock getSession() → { user: { email: 'no-sub@example.com' } }
- Act/Assert: requireAuth() throws Error
- Mock isolation: getSession stubbed

---

### Module: MOD-006 (Mobile IdP Client SDK Wrapper)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `packages/apps/commise/mobile/lib/auth/idp-client.ts`

---

#### Test Case: UTP-006-A (getAccessToken — token retrieval and caching)

**Technique**: Statement & Branch Coverage
**Target View**: Algorithmic/Logic View
**Description**: Verifies getAccessToken returns cached token if valid, refreshes if expired, and handles refresh failure.

**Scenarios:**

**UTS-006-A1** — Valid cached token (not expired) → token returned without network call

- Arrange: cachedToken = 'valid-access-token'; expiryMs = Date.now() + 300_000; mock idpClient.getCachedCredentials() → { accessToken: cachedToken, expiry: expiryMs }
- Act: result = await idpClient.getAccessToken()
- Assert: result === cachedToken; verify idpClient.getTokenSilently NOT called
- Mock isolation: IdpClient stubbed

**UTS-006-A2** — No cached token → getTokenSilently called, token returned

- Arrange: mock idpClient.getCachedCredentials() → null; mock idpClient.getTokenSilently() → 'fresh-token'
- Act: result = await idpClient.getAccessToken()
- Assert: result === 'fresh-token'; verify getTokenSilently called once
- Mock isolation: IdpClient stubbed

**UTS-006-A3** — Cached token expired → getTokenSilently called for refresh

- Arrange: expiredExpiry = Date.now() - 1000; mock idpClient.getCachedCredentials() → { accessToken: 'old', expiry: expiredExpiry }; mock idpClient.getTokenSilently() → 'refreshed-token'
- Act: result = await idpClient.getAccessToken()
- Assert: result === 'refreshed-token'; verify getTokenSilently called once
- Mock isolation: IdpClient stubbed

**UTS-006-A4** — getTokenSilently throws → error propagated

- Arrange: mock idpClient.getCachedCredentials() → null; mock idpClient.getTokenSilently() → throws new Error('network error')
- Act/Assert: idpClient.getAccessToken() throws Error('network error')
- Mock isolation: IdpClient stubbed

---

## ARCH↔MOD↔UTP Traceability

| MOD ID  | MOD Name                      | UTP Count | UTS Count        |
| ------- | ----------------------------- | --------- | ---------------- |
| MOD-001 | Web Auth Route Handler        | 2 (A, B)  | 8 (A1-A5, B1-B3) |
| MOD-002 | Web Auth Middleware Guard     | 1 (A)     | 5 (A1-A5)        |
| MOD-003 | Web Session Cookie Manager    | 2 (A, B)  | 7 (A1-A4, B1-B3) |
| MOD-004 | Web JWT Decoder               | 1 (A)     | 3 (A1-A3)        |
| MOD-005 | Web Route Protector           | 1 (A)     | 3 (A1-A3)        |
| MOD-006 | Mobile IdP Client SDK Wrapper | 1 (A)     | 4 (A1-A4)        |

## Mock Registry

Each UTP that touches an external dependency MUST list the dependency mock in its setup. Mock entries identify the dependency name, mock type (stub, fake, spy, or in-memory adapter), owning MOD-NNN, and reset behavior between scenarios.

## Coverage Completion Unit Tests

### Module: MOD-007 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-007.

#### Test Case: UTP-007-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-007 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-007-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-007
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-007-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-007
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-008 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-008.

#### Test Case: UTP-008-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-008 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-008-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-008
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-008-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-008
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-009 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-009.

#### Test Case: UTP-009-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-009 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-009-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-009
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-009-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-009
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-010 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-010.

#### Test Case: UTP-010-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-010 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-010-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-010
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-010-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-010
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-011 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-011.

#### Test Case: UTP-011-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-011 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-011-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-011
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-011-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-011
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-012 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-012.

#### Test Case: UTP-012-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-012 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-012-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-012
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-012-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-012
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-013 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-013.

#### Test Case: UTP-013-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-013 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-013-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-013
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-013-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-013
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-014 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-014.

#### Test Case: UTP-014-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-014 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-014-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-014
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-014-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-014
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

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

### Module: MOD-018 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-018.

#### Test Case: UTP-018-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-018 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-018-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-018
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-018-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-018
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-019 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-019.

#### Test Case: UTP-019-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-019 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-019-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-019
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-019-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-019
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-020 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-020.

#### Test Case: UTP-020-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-020 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-020-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-020
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-020-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-020
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-021 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-021.

#### Test Case: UTP-021-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-021 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-021-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-021
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-021-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-021
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-022 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-022.

#### Test Case: UTP-022-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-022 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-022-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-022
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-022-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-022
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-023 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-023.

#### Test Case: UTP-023-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-023 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-023-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-023
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-023-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-023
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-024 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-024.

#### Test Case: UTP-024-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-024 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-024-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-024
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-024-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-024
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-025 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-025.

#### Test Case: UTP-025-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-025 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-025-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-025
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-025-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-025
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-026 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-026.

#### Test Case: UTP-026-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-026 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-026-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-026
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-026-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-026
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-027 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-027.

#### Test Case: UTP-027-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-027 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-027-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-027
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-027-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-027
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-028 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-028.

#### Test Case: UTP-028-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-028 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-028-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-028
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-028-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-028
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-029 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-029.

#### Test Case: UTP-029-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-029 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-029-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-029
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-029-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-029
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-030 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-030.

#### Test Case: UTP-030-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-030 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-030-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-030
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-030-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-030
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-031 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-031.

#### Test Case: UTP-031-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-031 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-031-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-031
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-031-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-031
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-032 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-032.

#### Test Case: UTP-032-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-032 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-032-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-032
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-032-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-032
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping

### Module: MOD-033 (Coverage Completion)

**Parent Architecture Modules**: See `module-design.md` for MOD-033.

#### Test Case: UTP-033-A (core logic and error handling coverage)

**Technique**: Statement & Branch Coverage + Boundary Value Analysis + Error Guessing
**Target View**: Algorithmic/Logic View + Error Handling & Return Codes
**Description**: Verifies MOD-033 nominal branch behavior, boundary inputs (min-1, min, nominal, max, max+1 where bounded variables exist), and invalid-input/error branches.

- **Unit Scenario: UTS-033-A1**
    - **Arrange** valid module inputs and mocked dependencies from the Mock Registry
    - **Act** by invoking the primary exported function or method for MOD-033
    - **Assert** expected return value, state transition, and dependency interaction outcomes

- **Unit Scenario: UTS-033-A2**
    - **Arrange** invalid input, dependency exception, or boundary value for MOD-033
    - **Act** by invoking the same module entrypoint
    - **Assert** documented error handling, return code, or exception mapping
