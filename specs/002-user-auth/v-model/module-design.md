# Module Design: User Authentication

**Feature Branch**: `002-user-auth`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/002-user-auth/v-model/architecture-design.md`

> **Identity-key note (Feature 002 implementation update)**: Module details in this draft that mention generated UUID user IDs, `app_metadata.userId`, `identity_id`, `internal_id`, or `legacy_id` are historical and superseded by the implemented sub-keyed model. Current implementation uses the IdP `sub` as `users.sub VARCHAR(255) COLLATE "C" PRIMARY KEY`, with M2M-gated post-login upsert and no generated user UUID.

## Overview

The User Authentication module design decomposes 33 architecture modules (ARCH-001 through ARCH-033) into 33 low-level module specifications (MOD-001 through MOD-033). Each MOD is a single-responsibility unit documented with four mandatory views — Algorithmic/Logic, State Machine, Internal Data Structures, and Error Handling & Return Codes — at a level of detail where writing the actual TypeScript source code is a direct translation exercise requiring no further design decisions. Cross-cutting infrastructure (ARCH-027 through ARCH-033) is fully decomposed into focused utility modules. Every module is traceable to its parent ARCH-NNN.

## ID Schema

- **Module Design**: `MOD-NNN` — sequential identifier for each module (3-digit zero-padded)
- **Parent Architecture Modules**: Comma-separated `ARCH-NNN` list per module (many-to-many, authoritative for traceability)
- **Target Source File(s)**: Comma-separated file paths mapping to the repository codebase
- Example: `MOD-003` with Parent Architecture Modules `ARCH-001, ARCH-004` — module serves both architecture components
- Example: `MOD-007 [EXTERNAL]` — third-party library wrapper, documents interface only

## Module Designs

---

### Module: MOD-001 (Web Auth Route Handler)

**Parent Architecture Modules**: ARCH-001
**Target Source File(s)**: `packages/apps/commise/web/app/api/auth/[...idp]/route.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handleAuthRoute(param: string, request: NextRequest):
    SWITCH param:
        CASE "login":
            RETURN Response.redirect(idpLoginUrl(), 302)
        CASE "logout":
            CALL clearSession()
            RETURN Response.redirect(idpLogoutUrl(), 302)
        CASE "callback":
            code = request.query.code
            state = request.query.state
            storedState = getCookie("auth_state")
            IF state !== storedState:
                THROW AuthCallbackError("State mismatch")
            tokens = exchangeCodeForTokens(code)
            session = buildSession(tokens)
            setSessionCookie(session)
            RETURN Response.redirect("/dashboard", 302)
        DEFAULT:
            THROW AuthCallbackError("Unknown auth route: " + param)

FUNCTION exchangeCodeForTokens(code: string) -> Tokens:
    response = POST to idpTokenEndpoint with:
        grant_type = "authorization_code"
        code = code
        redirect_uri = IDP_REDIRECT_URI
        client_id = IDP_CLIENT_ID
        client_secret = IDP_CLIENT_SECRET
    RETURN parseTokenResponse(response)

FUNCTION buildSession(tokens: Tokens) -> Session:
    user = decodeJWT(tokens.accessToken)
    RETURN { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, user: user }

FUNCTION setSessionCookie(session: Session):
    cookie = createCookie("session", session, {
        httpOnly: true,
        secure: true,
        sameSite: "strict",
        maxAge: 86400
    })
    SET-COOKIE header with cookie
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field          | Type            | Size/Constraints | Initialization                           | Lifecycle                            |
| -------------- | --------------- | ---------------- | ---------------------------------------- | ------------------------------------ |
| `accessToken`  | string (JWT)    | ~500 bytes       | From IdP token exchange                  | Session-scoped, refreshed by MOD-008 |
| `refreshToken` | string (opaque) | ~200 bytes       | From IdP token exchange                  | Long-lived, rotated on use           |
| `user.sub`     | string (UUID)   | 36 chars         | From JWT `sub` claim                     | Stable across sessions               |
| `user.email`   | string          | RFC 5321         | From JWT `email` claim                   | Updated on IdP profile change        |
| `auth_state`   | string (CSRF)   | 32 bytes         | `crypto.randomBytes(32).toString('hex')` | Per-request, validated once          |

#### Error Handling & Return Codes

| Error               | Code | Trigger                             | Recovery Action                  |
| ------------------- | ---- | ----------------------------------- | -------------------------------- |
| `AuthCallbackError` | 400  | Invalid or missing `code` parameter | Show error page, link to login   |
| `AuthCallbackError` | 400  | State mismatch (CSRF)               | Log suspected attack, show error |
| `AuthCallbackError` | 500  | Token exchange fails (network/IdP)  | Show generic error, retry link   |
| `AuthCallbackError` | 500  | JWT decode fails                    | Clear session, redirect to login |

---

### Module: MOD-002 (Web Auth Middleware Guard)

**Parent Architecture Modules**: ARCH-002
**Target Source File(s)**: `packages/apps/commise/web/middleware.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION middleware(request: NextRequest):
    IF request.url matches publicRoutePattern(request.url):
        RETURN NextResponse.next()

    session = getSessionFromCookie(request)
    IF session IS NULL:
        url = request.url
        redirectUrl = "/api/auth/login?returnTo=" + encodeURIComponent(url)
        RETURN Response.redirect(redirectUrl, 302)

    userId = session.user.sub
    IF userId IS NULL:
        RETURN Response.redirect("/api/auth/login", 302)

    request.headers.set("x-user-id", userId)
    RETURN NextResponse.next()

FUNCTION publicRoutePattern(url: string) -> boolean:
    PUBLIC_PATHS = ["/api/auth/", "/_next/", "/favicon", "/health"]
    FOR EACH path IN PUBLIC_PATHS:
        IF url.startsWith(path):
            RETURN true
    RETURN false
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field          | Type           | Size/Constraints                    | Initialization | Lifecycle   |
| -------------- | -------------- | ----------------------------------- | -------------- | ----------- |
| `PUBLIC_PATHS` | string[]       | 4 entries                           | Static array   | Immutable   |
| `returnTo`     | string         | Max 2048 chars                      | Query param    | Per-request |
| `session`      | Session object | `{accessToken, refreshToken, user}` | From cookie    | Per-request |

#### Error Handling & Return Codes

| Error             | Code | Trigger                     | Recovery Action         |
| ----------------- | ---- | --------------------------- | ----------------------- |
| `MiddlewareError` | 500  | getSessionFromCookie throws | Show 500 page           |
| `Redirect`        | 302  | No valid session            | Redirect to login       |
| `Continue`        | 200  | Valid session               | Pass request to handler |

---

### Module: MOD-003 (Web Session Cookie Manager)

**Parent Architecture Modules**: ARCH-003
**Target Source File(s)**: `packages/apps/commise/web/lib/auth/session-manager.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION getSession() -> Session | null:
    cookieValue = getCookie("session")
    IF cookieValue IS NULL:
        RETURN null
    TRY:
        session = decryptCookie(cookieValue)
        IF session.expiry < NOW():
            THROW SessionError("Session expired")
        RETURN session
    CATCH:
        clearSession()
        RETURN null

FUNCTION updateSession(session: Session):
    cookieValue = encryptCookie(session)
    SET-COOKIE with httpOnly, secure, sameSite=strict, maxAge=86400

FUNCTION clearSession():
    DELETE-COOKIE "session"

FUNCTION encryptCookie(session: Session) -> string:
    payload = JSON.stringify(session)
    iv = crypto.randomBytes(12)
    cipher = createCipheriv('aes-256-gcm', SESSION_KEY, iv)
    encrypted = cipher.update(payload, 'utf8', 'hex') + cipher.final('hex')
    tag = cipher.getAuthTag().toString('hex')
    RETURN base64url(iv) + '.' + base64url(tag) + '.' + encrypted

FUNCTION decryptCookie(value: string) -> Session:
    [ivB64, tagB64, encrypted] = value.split('.')
    iv = base64urlDecode(ivB64)
    tag = base64urlDecode(tagB64)
    decipher = createDecipheriv('aes-256-gcm', SESSION_KEY, iv)
    decipher.setAuthTag(tag)
    decrypted = decipher.update(encrypted, 'hex', 'utf8') + decipher.final('utf8')
    RETURN JSON.parse(decrypted)
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field         | Type   | Size/Constraints   | Initialization           | Lifecycle        |
| ------------- | ------ | ------------------ | ------------------------ | ---------------- |
| `SESSION_KEY` | Buffer | 32 bytes (AES-256) | Env var AUTH_SESSION_KEY | Process-scoped   |
| `iv`          | Buffer | 12 bytes           | `crypto.randomBytes(12)` | Per cookie write |
| `authTag`     | Buffer | 16 bytes (GCM)     | `cipher.getAuthTag()`    | Per cookie write |
| `cookie`      | object | `{value, options}` | Built per operation      | Transient        |

#### Error Handling & Return Codes

| Error                     | Code | Trigger                        | Recovery Action                 |
| ------------------------- | ---- | ------------------------------ | ------------------------------- |
| `SessionError`            | —    | Cookie missing or decode fails | clearSession(), return null     |
| `AuthSessionExpiredError` | 401  | Session timestamp < now        | Clear cookie, redirect to login |

---

### Module: MOD-004 (Mobile Auth Provider)

**Parent Architecture Modules**: ARCH-004
**Target Source File(s)**: `packages/apps/commise/mobile/contexts/AuthProvider.tsx`

#### Algorithmic / Logic View

```pseudocode
FUNCTION AuthProvider(props: { children: ReactNode }):
    [user, setUser] = useState<User | null>(null)
    [isLoading, setIsLoading] = useState(true)

    TRY:
        accessToken = await SecureStore.getToken("access_token")
        IF accessToken IS NOT NULL:
            user = decodeJWT(accessToken)
            setUser(user)
    CATCH:
        clearTokens()
        navigateToLogin()

    isAuthenticated = user IS NOT NULL

    login = async ():
        TRY:
            result = await idp.webAuth.authorize({
                scope: "openid profile email",
                audience: IDP_AUDIENCE
            })
            await SecureStore.setToken("access_token", result.accessToken)
            await SecureStore.setToken("refresh_token", result.refreshToken)
            user = decodeJWT(result.accessToken)
            setUser(user)
        CATCH err:
            throw AuthError(err)

    logout = async ():
        TRY:
            await idp.webAuth.clearSession()
        CATCH:
            PASS
        await SecureStore.clearTokens()
        setUser(null)

    RETURN (
        <AuthContext.Provider value={{ user, isAuthenticated, isLoading, login, logout }}>
            {props.children}
        </AuthContext.Provider>
    )
```

#### State Machine View

```
N/A — Stateless (React component)
```

#### Internal Data Structures

| Field             | Type        | Size/Constraints                               | Initialization             | Lifecycle                   |
| ----------------- | ----------- | ---------------------------------------------- | -------------------------- | --------------------------- |
| `user`            | User object | `{ sub: string, email: string, name: string }` | From JWT decode            | App session-scoped          |
| `isLoading`       | boolean     | —                                              | true initially             | Set false after first check |
| `isAuthenticated` | boolean     | —                                              | Derived from user !== null | Updated on user change      |

#### Error Handling & Return Codes

| Error                     | Code | Trigger                       | Recovery Action                |
| ------------------------- | ---- | ----------------------------- | ------------------------------ |
| `AuthError`               | —    | `webAuth.authorize()` fails   | Show error toast, retry option |
| `AuthSessionExpiredError` | —    | Token decode fails or expired | Clear tokens, call logout()    |

---

### Module: MOD-005 (Mobile Secure Token Store)

**Parent Architecture Modules**: ARCH-005
**Target Source File(s)**: `packages/apps/commise/mobile/utils/secure-token-store.ts`

#### Algorithmic / Logic View

```pseudocode
CONSTANTS = {
    KEYS: { ACCESS_TOKEN: "access_token", REFRESH_TOKEN: "refresh_token" },
    SERVICE: "com.ourcommise.auth"
}

FUNCTION getToken(key: "access_token" | "refresh_token") -> Promise<string | null>:
    TRY:
        value = await SecureStore.getItemAsync(key, { service: SERVICE })
        RETURN value
    CATCH err:
        THROW SecureStoreError("Failed to read token: " + key, err)

FUNCTION setToken(key: "access_token" | "refresh_token", value: string):
    TRY:
        await SecureStore.setItemAsync(key, value, { service: SERVICE })
    CATCH err:
        THROW SecureStoreError("Failed to write token: " + key, err)

FUNCTION clearTokens():
    TRY:
        await SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN, { service: SERVICE })
        await SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN, { service: SERVICE })
    CATCH err:
        PASS  // Best-effort cleanup
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field                | Type   | Size/Constraints            | Initialization    | Lifecycle              |
| -------------------- | ------ | --------------------------- | ----------------- | ---------------------- |
| `KEYS.ACCESS_TOKEN`  | string | const "access_token"        | Static            | Immutable              |
| `KEYS.REFRESH_TOKEN` | string | const "refresh_token"       | Static            | Immutable              |
| `SERVICE`            | string | const "com.ourcommise.auth" | Static            | Immutable              |
| `value`              | string | JWT (variable)              | From IdP callback | Written once per login |

#### Error Handling & Return Codes

| Error              | Code | Trigger                                  | Recovery Action                   |
| ------------------ | ---- | ---------------------------------------- | --------------------------------- |
| `SecureStoreError` | —    | iOS Keychain or Android Keystore failure | Retry, fallback to memory session |
| `SecureStoreError` | —    | Item not found                           | Return null, treat as logged out  |

---

### Module: MOD-006 (Mobile Auth Callback Handler)

**Parent Architecture Modules**: ARCH-006
**Target Source File(s)**: `packages/apps/commise/mobile/utils/auth-callback.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handleAuthCallback(url: string) -> Promise<Session>:
    params = parseIdpCallbackUrl(url)
    IF params.error:
        THROW AuthError("IdP error: " + params.error + ": " + params.error_description)

    code = params.code
    state = params.state
    storedState = await SecureStore.getToken("auth_state")
    IF state !== storedState:
        THROW AuthError("State mismatch CSRF")

    tokens = await exchangeCodeForTokens(code)
    await SecureStore.setToken("access_token", tokens.accessToken)
    await SecureStore.setToken("refresh_token", tokens.refreshToken)
    await SecureStore.deleteItemAsync("auth_state")

    RETURN { accessToken: tokens.accessToken, user: decodeJWT(tokens.accessToken) }

FUNCTION exchangeCodeForTokens(code: string) -> Tokens:
    TRY:
        result = await idp.auth.authenticate({
            code: code,
            redirectUri: IDP_REDIRECT_URI
        })
        RETURN result
    CATCH err:
        THROW AuthError("Token exchange failed", err)
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field    | Type            | Size/Constraints                | Initialization            | Lifecycle          |
| -------- | --------------- | ------------------------------- | ------------------------- | ------------------ |
| `params` | URLSearchParams | Parsed from callback URL        | Per callback              | Transient          |
| `code`   | string          | IdP authorization code          | From callback URL         | Single-use         |
| `state`  | string          | 32 bytes hex                    | Generated before redirect | Validated once     |
| `tokens` | Tokens object   | `{ accessToken, refreshToken }` | From IdP exchange         | Stored in Keychain |

#### Error Handling & Return Codes

| Error       | Code | Trigger                          | Recovery Action                 |
| ----------- | ---- | -------------------------------- | ------------------------------- |
| `AuthError` | 400  | IdP returns `error` param in URL | Show error, allow retry         |
| `AuthError` | 400  | State mismatch                   | Log CSRF attempt, show error    |
| `AuthError` | 500  | Token exchange fails             | Show error, link to retry login |

---

### Module: MOD-007 (Social Connection Configurator)

**Parent Architecture Modules**: ARCH-007
**Target Source File(s)**: `packages/apps/commise/web/components/auth/SocialConnections.tsx`, `packages/apps/commise/mobile/screens/SocialConnectionsScreen.tsx`

#### Algorithmic / Logic View

```pseudocode
FUNCTION SocialLoginButtons(props: { onProvider: (p: string) => void }):
    providers = [
        { id: "google", name: "Google", icon: "google-icon" },
        { id: "apple", name: "Apple", icon: "apple-icon" }
    ]
    RETURN (
        <div className="social-buttons">
            FOR EACH provider IN providers:
                <button onClick={() => props.onProvider(provider.id)}>
                    <Icon name={provider.icon} />
                    Continue with {provider.name}
                </button>
        </div>
    )

FUNCTION initiateSocialLogin(provider: string):
    idpLoginUrl = buildIdpUrl({
        connection: provider,
        redirectUri: IDP_REDIRECT_URI,
        scope: "openid profile email"
    })
    SET "auth_state" cookie with CSRF token
    NAVIGATE to idpLoginUrl
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field         | Type       | Size/Constraints            | Initialization             | Lifecycle      |
| ------------- | ---------- | --------------------------- | -------------------------- | -------------- |
| `providers`   | Provider[] | Array of { id, name, icon } | Static config              | Immutable      |
| `idpLoginUrl` | string     | IdP hosted login URL        | Built per request          | One-time use   |
| `auth_state`  | string     | 32-byte hex CSRF            | Generated per social login | Validated once |

#### Error Handling & Return Codes

| Error       | Code | Trigger                           | Recovery Action                      |
| ----------- | ---- | --------------------------------- | ------------------------------------ |
| `AuthError` | —    | IdP returns error in callback     | Show error message                   |
| `AuthError` | —    | Provider not configured in tenant | Log config issue, show generic error |

---

### Module: MOD-008 (Token Refresh Service — Web)

**Parent Architecture Modules**: ARCH-008
**Target Source File(s)**: `packages/apps/commise/web/lib/auth/token-refresh.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION refreshAccessToken(refreshToken: string) -> Promise<Tokens>:
    TRY:
        response = await fetch(IDP_TOKEN_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                grant_type: "refresh_token",
                refresh_token: refreshToken,
                client_id: IDP_CLIENT_ID
            })
        })
        IF response.status === 401:
            THROW AuthSessionExpiredError("Refresh token revoked")
        IF response.ok IS false:
            THROW AuthError("Refresh failed: " + response.status)
        newTokens = await response.json()
        session = buildSession(newTokens)
        updateSession(session)
        RETURN newTokens
    CATCH err:
        clearSession()
        NAVIGATE to "/api/auth/login"

FUNCTION scheduleRefresh(token: Tokens):
    expiresIn = decodeJWT(token.accessToken).exp - NOW()
    delayMs = (expiresIn - 300) * 1000  // 5 min before expiry
    SET-TIMEOUT(refreshAccessToken, delayMs)
```

#### State Machine View

```
stateDiagram-v2
[*] --> Idle
Idle --> Refreshing: accessToken near expiry
Refreshing --> Idle: refresh success, new token stored
Refreshing --> LoggedOut: refresh fails (401)
LoggedOut --> [*]
```

#### Internal Data Structures

| Field          | Type     | Size/Constraints           | Initialization       | Lifecycle            |
| -------------- | -------- | -------------------------- | -------------------- | -------------------- |
| `refreshTimer` | Timer ID | Node.js Timer              | `setTimeout` ID      | Cancelled on logout  |
| `expiresIn`    | number   | Seconds until token expiry | From JWT `exp` claim | Decoded per token    |
| `delayMs`      | number   | Milliseconds               | `(exp - 300) * 1000` | Per refresh schedule |

#### Error Handling & Return Codes

| Error                     | Code | Trigger                            | Recovery Action                   |
| ------------------------- | ---- | ---------------------------------- | --------------------------------- |
| `AuthSessionExpiredError` | 401  | Refresh token revoked or expired   | clearSession(), redirect to login |
| `AuthError`               | —    | IdP token endpoint fails (non-401) | Retry with backoff (max 3)        |
| `TypeError`               | —    | Network failure                    | Retry with exponential backoff    |

---

---

### Module: MOD-009 (Token Refresh Service — Mobile)

**Parent Architecture Modules**: ARCH-009
**Target Source File(s)**: `packages/apps/commise/mobile/utils/token-refresh.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION refreshAccessToken() -> Promise<Tokens>:
    refreshToken = await SecureStore.getToken("refresh_token")
    IF refreshToken IS NULL:
        THROW AuthSessionExpiredError("No refresh token")

    TRY:
        result = await idp.auth.refreshToken({ refreshToken: refreshToken })
        newTokens = { accessToken: result.accessToken, refreshToken: result.refreshToken || refreshToken }
        await SecureStore.setToken("access_token", newTokens.accessToken)
        IF newTokens.refreshToken !== refreshToken:
            await SecureStore.setToken("refresh_token", newTokens.refreshToken)
        RETURN newTokens
    CATCH err:
        IF err.code === "invalid_grant":
            await clearTokens()
            NAVIGATE to login screen
            THROW AuthSessionExpiredError("Refresh token expired")
        THROW err
```

#### State Machine View

```
stateDiagram-v2
[*] --> Idle
Idle --> Refreshing: accessToken near expiry
Refreshing --> Idle: success, new tokens stored
Refreshing --> LoggedOut: invalid_grant (refresh token revoked)
LoggedOut --> [*]
```

#### Internal Data Structures

| Field          | Type   | Size/Constraints                | Initialization     | Lifecycle               |
| -------------- | ------ | ------------------------------- | ------------------ | ----------------------- |
| `refreshToken` | string | Opaque token from IdP           | Stored in Keychain | Rotated on each refresh |
| `newTokens`    | Tokens | `{ accessToken, refreshToken }` | From IdP response  | Stored in Keychain      |

#### Error Handling & Return Codes

| Error                     | Code | Trigger                  | Recovery Action                        |
| ------------------------- | ---- | ------------------------ | -------------------------------------- |
| `AuthSessionExpiredError` | —    | `invalid_grant` from IdP | clearTokens(), navigate to login       |
| `AuthError`               | —    | Network failure          | Retry with exponential backoff (max 3) |

---

### Module: MOD-010 (Post-Registration Handler)

**Parent Architecture Modules**: ARCH-010
**Target Source File(s)**: `packages/services/identity-webhooks/src/handlers/user-created.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION onPostRegistration(event):
    user = event.user
    identityUserId = user.id
    email = user.email

    TRY:
        appMetadata = user.app_metadata || {}
        IF appMetadata.userId IS NOT NULL:
            RETURN  // Already provisioned, idempotent

        userId = crypto.randomUUID()  // UUIDv4

        // Write to IdP app_metadata first (synchronous)
        CALL event.api.users.updateAppMetadata({
            id: identityUserId,
            app_metadata: { userId: userId }
        })

        // Call ARCH-011 (User Provisioning Lambda) asynchronously
        CALL provisionCommiseUser({
            identityUserId: identityUserId,
            userId: userId,
            email: email
        })

    CATCH err:
        THROW ActionError("Post-registration failed: " + err.message)

FUNCTION provisionCommiseUser(payload):
    RETRY(3, EXPONENTIAL_BACKOFF(1000)):
        response = POST TO USER_PROVISIONING_LAMBDA_URL with payload
        IF response.status === 200:
            RETURN
        IF response.status >= 500:
            THROW RetryableError("Lambda unavailable")
        THROW NonRetryableError("Lambda rejected: " + response.status)
```

#### State Machine View

```
stateDiagram-v2
[*] --> AwaitingEvent
AwaitingEvent --> UpdatingAppMetadata: post-user-registration event fires
UpdatingAppMetadata --> CallingLambda: app_metadata.userId written
CallingLambda --> [*]: Lambda returns 200 (idempotent success path)
UpdatingAppMetadata --> [*]: Error — logged to Sentry, IdP retries handler
```

#### Internal Data Structures

| Field            | Type   | Size/Constraints        | Initialization         | Lifecycle               |
| ---------------- | ------ | ----------------------- | ---------------------- | ----------------------- |
| `identityUserId` | string | IdP user ID (sub claim) | From `event.user.id`   | Immutable               |
| `userId`         | string | UUIDv4                  | `crypto.randomUUID()`  | Written to app_metadata |
| `app_metadata`   | object | `{ userId: string }`    | Set on IdP user record | Persisted to IdP        |

#### Error Handling & Return Codes

| Error         | Code | Trigger                            | Recovery Action                |
| ------------- | ---- | ---------------------------------- | ------------------------------ |
| `ActionError` | —    | Lambda unreachable after 3 retries | IdP retries handler (built-in) |
| `ActionError` | —    | Lambda returns non-200 non-5xx     | Sentry capture, no retry       |
| `ActionError` | —    | UUID write to app_metadata fails   | IdP retries handler            |

---

### Module: MOD-011 (User Provisioning Lambda)

**Parent Architecture Modules**: ARCH-011
**Target Source File(s)**: `packages/lambda/user-provisioning/index.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handler(event: APIGatewayProxyEvent):
    body = JSON.parse(event.body)
    identityUserId = body.identityUserId
    userId = body.userId
    email = body.email

    IF NOT validateUUID(userId):
        RETURN { statusCode: 400, body: JSON.stringify({ error: "Invalid userId" }) }

    TRY:
        // Insert into users table
        db.query("INSERT INTO users (id, identity_id, email, created_at) VALUES ($1, $2, $3, NOW())", [userId, identityUserId, email])

        // Insert into accounts table (primary account for now)
        accountId = crypto.randomUUID()
        db.query("INSERT INTO accounts (id, user_id, provider, provider_account_id, created_at) VALUES ($1, $2, 'idp', $3, NOW())", [accountId, userId, identityUserId])

        userRecord = db.query("SELECT * FROM users WHERE id = $1", [userId])

        RETURN { statusCode: 200, body: JSON.stringify({ userId: userId, accountId: accountId }) }

    CATCH err:
        IF err.code === "23505"  // Unique violation — idempotent
            userId = db.query("SELECT id FROM users WHERE identity_id = $1", [identityUserId]).rows[0].id
            RETURN { statusCode: 200, body: JSON.stringify({ userId: userId, accountId: null }) }
        RETURN { statusCode: 500, body: JSON.stringify({ error: "Provisioning failed" }) }
```

#### State Machine View

```
N/A — Stateless (Lambda invocation model)
```

#### Internal Data Structures

| Field               | Type   | Size/Constraints     | Initialization        | Lifecycle          |
| ------------------- | ------ | -------------------- | --------------------- | ------------------ |
| `users.id`          | UUIDv4 | Primary key          | Generated by Lambda   | Permanent          |
| `users.identity_id` | string | Unique constraint    | From event payload    | Maps IdP ↔ Commise |
| `accounts.id`       | UUIDv4 | Primary key          | Generated per account | Permanent          |
| `accounts.user_id`  | UUIDv4 | Foreign key to users | Set on insert         | Immutable          |

#### Error Handling & Return Codes

| Error                  | Code | Trigger                         | Recovery Action                     |
| ---------------------- | ---- | ------------------------------- | ----------------------------------- |
| `ValidationError`      | 400  | `userId` is not valid UUID      | Reject immediately                  |
| `UniqueViolationError` | 200  | `identity_id` already exists    | Return existing userId (idempotent) |
| `ProvisionError`       | 500  | DB connection or other DB error | Lambda retries via SQS DLQ          |

---

### Module: MOD-012 (Reconciliation Lambda)

**Parent Architecture Modules**: ARCH-012
**Target Source File(s)**: `packages/lambda/reconciliation/index.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handler(event: EventBridgeEvent | APIGatewayProxyEvent):
    TRY:
        idpUsers = await fetchAllIdpUsers()
        dbUserIds = await db.query("SELECT id, identity_id FROM users")

        idpIdSet = new Set(idpUsers.map(u => u.id))
        dbIdentityIdSet = new Set(dbUserIds.rows.map(r => r.identity_id))

        // Find IdP users not in DB (missing provisioning)
        missingInDb = idpUsers.filter(u => NOT dbIdentityIdSet.has(u.id))
        repaired = 0
        FOR EACH idpUser IN missingInDb:
            result = await CALL MOD-011(idpUser)
            IF result.statusCode === 200:
                repaired++

        // Find DB users whose IdP account no longer exists
        orphanedInDb = dbUserIds.rows.filter(r => NOT idpIdSet.has(r.identity_id))
        // Log orphans for manual review — do NOT auto-delete

        report = { repaired: repaired, failed: missingInDb.length - repaired, orphans: orphanedInDb.length }
        LOG.info("Reconciliation complete", report)

        RETURN { statusCode: 200, body: JSON.stringify(report) }

    CATCH err:
        LOG.error("Reconciliation failed", { error: err })
        RETURN { statusCode: 500, body: JSON.stringify({ error: "Reconciliation failed" }) }

FUNCTION fetchAllIdpUsers() -> Promise<IdpUser[]>:
    users = []
    page = 0
    pageSize = 100
    LOOP:
        response = await idp.users.getAll({ page: page, per_page: pageSize, include_fields: true, fields: "id,email" })
        users = users.concat(response.users)
        IF response.users.length < pageSize:
            BREAK
        page++
    RETURN users
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field             | Type        | Size/Constraints            | Initialization              | Lifecycle |
| ----------------- | ----------- | --------------------------- | --------------------------- | --------- |
| `idpIdSet`        | Set<string> | IdP user IDs                | Built from IdP API response | Per run   |
| `dbIdentityIdSet` | Set<string> | DB identity_id values       | Built from PostgreSQL query | Per run   |
| `missingInDb`     | IdpUser[]   | IdP users without DB record | Computed set difference     | Per run   |

#### Error Handling & Return Codes

| Error   | Code | Trigger                       | Recovery Action                                       |
| ------- | ---- | ----------------------------- | ----------------------------------------------------- |
| `Error` | 500  | IdP API unreachable           | Lambda retries via EventBridge retry policy           |
| `Error` | 500  | PostgreSQL unreachable        | Lambda retries via EventBridge retry policy           |
| `Error` | 500  | Individual provisioning fails | Logged, counted in `failed`, reconciliation continues |

---

### Module: MOD-013 (Profile View Component)

**Parent Architecture Modules**: ARCH-013
**Target Source File(s)**: `packages/apps/commise/web/components/profile/ProfileView.tsx`, `packages/apps/commise/mobile/screens/ProfileScreen.tsx`

#### Algorithmic / Logic View

```pseudocode
FUNCTION ProfileView(props: { userId: string }):
    [profile, setProfile] = useState<Profile | null>(null)
    [isLoading, setIsLoading] = useState(true)
    [error, setError] = useState<string | null>(null)

    TRY:
        user = await getSession()  // MOD-003 / MOD-004
        IF user IS NULL:
            NAVIGATE to login
            RETURN

        response = await fetch("/api/users/" + user.sub)
        IF response.status === 200:
            profile = await response.json()
            setProfile(profile)
        ELSE:
            setError("Failed to load profile")
    CATCH err:
        setError("Network error")
    FINALLY:
        setIsLoading(false)

    IF isLoading: RETURN <Skeleton />
    IF error: RETURN <ErrorMessage message={error} onRetry={() => window.location.reload()} />
    RETURN (
        <div>
            <img src={profile.avatarUrl} alt={profile.displayName} />
            <h1>{profile.displayName}</h1>
            <p>{profile.email}</p>
            <p>Member since {formatDate(profile.createdAt)}</p>
        </div>
    )
```

#### State Machine View

```
N/A — Stateless (React component)
```

#### Internal Data Structures

| Field       | Type                                           | Size/Constraints       | Initialization   | Lifecycle                    |
| ----------- | ---------------------------------------------- | ---------------------- | ---------------- | ---------------------------- |
| `profile`   | `{ displayName, email, avatarUrl, createdAt }` | All strings            | Fetched from API | Per mount                    |
| `isLoading` | boolean                                        | —                      | `true`           | Set `false` on data or error |
| `error`     | string                                         | Human-readable message | `null`           | Set on fetch failure         |

#### Error Handling & Return Codes

| Error   | Code | Trigger                    | Recovery Action                |
| ------- | ---- | -------------------------- | ------------------------------ |
| `Error` | —    | API fetch throws           | Show error with retry button   |
| `Error` | 404  | User has no profile record | Show "Profile not found" state |

---

### Module: MOD-014 (Account Edit Component)

**Parent Architecture Modules**: ARCH-014
**Target Source File(s)**: `packages/apps/commise/web/components/account/AccountEdit.tsx`, `packages/apps/commise/mobile/screens/AccountEditScreen.tsx`

#### Algorithmic / Logic View

```pseudocode
FUNCTION AccountEdit(props: { initialProfile: Profile }):
    [displayName, setDisplayName] = useState(props.initialProfile.displayName)
    [avatarUrl, setAvatarUrl] = useState(props.initialProfile.avatarUrl || "")
    [isSaving, setIsSaving] = useState(false)
    [error, setError] = useState<string | null>(null)

    onSave = async ():
        IF displayName.trim() IS EMPTY:
            setError("Display name is required")
            RETURN

        setIsSaving(true)
        setError(null)
        TRY:
            response = await fetch("/api/account", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName: displayName.trim(), avatarUrl })
            })
            IF response.ok:
                ON_SUCCESS("Profile updated")
                NAVIGATE back
            ELSE:
                errorData = await response.json()
                setError(errorData.error || "Update failed")
        CATCH err:
            setError("Network error")
        FINALLY:
            setIsSaving(false)

    RETURN (
        <form onSubmit={onSave}>
            <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                aria-label="Display name"
            />
            <input
                type="url"
                value={avatarUrl}
                onChange={e => setAvatarUrl(e.target.value)}
                aria-label="Avatar URL"
            />
            <p>Email: {props.initialProfile.email} <em>(managed via identity provider)</em></p>
            {error && <ErrorMessage message={error} />}
            <button type="submit" disabled={isSaving}>
                {isSaving ? "Saving..." : "Save Changes"}
            </button>
        </form>
    )
```

#### State Machine View

```
N/A — Stateless (React component)
```

#### Internal Data Structures

| Field         | Type    | Size/Constraints         | Initialization            | Lifecycle                   |
| ------------- | ------- | ------------------------ | ------------------------- | --------------------------- |
| `displayName` | string  | Max 100 chars, non-empty | From props.initialProfile | Updated on user input       |
| `avatarUrl`   | string  | Valid URL or empty       | From props.initialProfile | Updated on user input       |
| `isSaving`    | boolean | —                        | `false`                   | `true` during PATCH request |

#### Error Handling & Return Codes

| Error             | Code | Trigger                        | Recovery Action           |
| ----------------- | ---- | ------------------------------ | ------------------------- |
| `ValidationError` | —    | displayName is empty on submit | Inline validation message |
| `Error`           | —    | PATCH request fails            | Error banner above form   |
| `Error`           | 401  | Session expired during save    | Redirect to login         |

---

### Module: MOD-015 (Account Edit API Handler)

**Parent Architecture Modules**: ARCH-015
**Target Source File(s)**: `packages/api/handlers/account-edit.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handler(event: APIGatewayProxyEvent):
    IF event.httpMethod !== "PATCH":
        RETURN { statusCode: 405, body: '"Method not allowed"' }

    userId = event.requestContext.authorizer.claims.sub
    body = JSON.parse(event.body)

    displayName = body.displayName?.trim()
    avatarUrl = body.avatarUrl?.trim()

    IF displayName IS NULL OR displayName IS EMPTY:
        RETURN { statusCode: 400, body: JSON.stringify({ error: "displayName is required" }) }
    IF displayName.length > 100:
        RETURN { statusCode: 400, body: JSON.stringify({ error: "displayName must be <= 100 chars" }) }

    TRY:
        account = db.query("SELECT * FROM accounts WHERE user_id = $1", [userId])
        IF account.rows.length === 0:
            RETURN { statusCode: 404, body: JSON.stringify({ error: "Account not found" }) }

        db.query("UPDATE users SET display_name = $1, avatar_url = $2, updated_at = NOW() WHERE id = $3", [displayName, avatarUrl || null, userId])

        updatedUser = db.query("SELECT display_name, avatar_url FROM users WHERE id = $1", [userId])

        RETURN { statusCode: 200, body: JSON.stringify(updatedUser.rows[0]) }
    CATCH err:
        LOG.error("Account edit failed", { userId, error: err })
        RETURN { statusCode: 500, body: JSON.stringify({ error: "Internal server error" }) }
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field         | Type      | Size/Constraints             | Initialization                     | Lifecycle       |
| ------------- | --------- | ---------------------------- | ---------------------------------- | --------------- |
| `userId`      | string    | UUIDv4, from JWT `sub` claim | Injected by API Gateway authorizer | Per request     |
| `displayName` | string    | Max 100 chars, non-empty     | From request body                  | Written to DB   |
| `avatarUrl`   | string    | Valid URL or null            | From request body                  | Written to DB   |
| `updated_at`  | timestamp | ISO 8601                     | Set to `NOW()`                     | Updated on edit |

#### Error Handling & Return Codes

| Error             | Code | Trigger                            | Recovery Action               |
| ----------------- | ---- | ---------------------------------- | ----------------------------- |
| `ValidationError` | 400  | `displayName` empty or > 100 chars | Return validation error       |
| `NotFoundError`   | 404  | No account for `userId`            | Return 404                    |
| `Error`           | 500  | DB query fails                     | Log to CloudWatch, return 500 |

---

### Module: MOD-016 (Account Deletion Component)

**Parent Architecture Modules**: ARCH-016
**Target Source File(s)**: `packages/apps/commise/web/components/account/AccountDelete.tsx`, `packages/apps/commise/mobile/screens/AccountDeleteScreen.tsx`

#### Algorithmic / Logic View

```pseudocode
FUNCTION AccountDelete(props: { userId: string }):
    [confirmationText, setConfirmationText] = useState("")
    [isDeleting, setIsDeleting] = useState(false)
    [step, setStep] = useState<"confirm" | "deleting" | "done">("confirm")

    CONFIRM_TEXT = "DELETE"

    onConfirm = async ():
        IF confirmationText !== CONFIRM_TEXT:
            RETURN  // Button stays disabled

        setIsDeleting(true)
        setStep("deleting")

        TRY:
            response = await fetch("/api/account", { method: "DELETE" })
            IF response.ok:
                setStep("done")
                // Log out on all devices
                CALL logoutAllDevices()
                NAVIGATE to "/goodbye"
            ELSE:
                errorData = await response.json()
                setError(errorData.error || "Deletion failed")
                setStep("confirm")
        CATCH err:
            setError("Network error")
        FINALLY:
            setIsDeleting(false)

    RETURN (
        <div>
            {step === "confirm" && (
                <>
                    <h2>Delete Account</h2>
                    <p>This action is permanent and cannot be undone.</p>
                    <p>All your recipes, meal plans, and data will be deleted.</p>
                    <p>Type <strong>DELETE</strong> to confirm:</p>
                    <input
                        type="text"
                        value={confirmationText}
                        onChange={e => setConfirmationText(e.target.value)}
                        aria-label="Type DELETE to confirm"
                    />
                    <button
                        onClick={onConfirm}
                        disabled={confirmationText !== CONFIRM_TEXT || isDeleting}
                    >
                        Permanently Delete My Account
                    </button>
                </>
            )}
            {step === "deleting" && <p>Deleting your account...</p>}
            {step === "done" && <p>Your account has been deleted.</p>}
        </div>
    )
```

#### State Machine View

```
stateDiagram-v2
[*] --> Confirm
Confirm --> Deleting: user types DELETE and clicks confirm
Deleting --> Done: DELETE /api/account returns 200
Deleting --> Confirm: DELETE /api/account fails
Done --> [*]
```

#### Internal Data Structures

| Field              | Type                              | Size/Constraints            | Initialization | Lifecycle                  |
| ------------------ | --------------------------------- | --------------------------- | -------------- | -------------------------- |
| `confirmationText` | string                            | Must exactly equal "DELETE" | Empty string   | Updated on keystroke       |
| `step`             | "confirm" \| "deleting" \| "done" | —                           | "confirm"      | Transitions on user action |

#### Error Handling & Return Codes

| Error   | Code | Trigger                                     | Recovery Action                    |
| ------- | ---- | ------------------------------------------- | ---------------------------------- |
| `Error` | —    | DELETE fetch fails                          | Show error, return to confirm step |
| `Error` | 400  | Backend rejects (e.g., active subscription) | Show specific error message        |
| `Error` | 401  | Session expired                             | Redirect to login                  |

---

---

### Module: MOD-017 (Account Deletion API Handler)

**Parent Architecture Modules**: ARCH-017
**Target Source File(s)**: `packages/api/handlers/account-delete.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handler(event: APIGatewayProxyEvent):
    IF event.httpMethod !== "DELETE":
        RETURN { statusCode: 405 }

    userId = event.requestContext.authorizer.claims.sub

    TRY:
        // Delete from Commise DB (cascading deletes user-owned data)
        db.query("DELETE FROM accounts WHERE user_id = $1", [userId])
        db.query("DELETE FROM users WHERE id = $1", [userId])

        // Delete from IdP via Management API
        idpToken = await getIdpManagementToken()
        DELETE https://IDP_DOMAIN/api/v2/users/{userId}
            Authorization: Bearer idpToken

        LOG.info("Account deleted", { userId, timestamp: NOW().toISOString() })
        RETURN { statusCode: 204, body: "" }

    CATCH err:
        LOG.error("Account deletion failed", { userId, error: err })
        RETURN { statusCode: 500, body: JSON.stringify({ error: "Account deletion failed" }) }

FUNCTION getIdpManagementToken() -> Promise<string>:
    response = await fetch(IDP_TOKEN_URL, {
        method: "POST",
        body: new URLSearchParams({
            grant_type: "client_credentials",
            client_id: IDP_MGMT_CLIENT_ID,
            client_secret: IDP_MGMT_CLIENT_SECRET,
            audience: "https://IDP_DOMAIN/api/v2/"
        })
    })
    result = await response.json()
    RETURN result.access_token
```

#### State Machine View

```
stateDiagram-v2
[*] --> Deleting
Deleting --> Deleted: DB delete + IdP delete succeed
Deleting --> Failed: DB or IdP error
Deleted --> [*]
Failed --> [*]
```

#### Internal Data Structures

| Field      | Type   | Size/Constraints                | Initialization       | Lifecycle                |
| ---------- | ------ | ------------------------------- | -------------------- | ------------------------ |
| `userId`   | string | UUIDv4                          | From JWT `sub` claim | Permanent record         |
| `idpToken` | string | OAuth2 client credentials token | Fetched per request  | Cached until near-expiry |

#### Error Handling & Return Codes

| Error           | Code | Trigger                 | Recovery Action                                        |
| --------------- | ---- | ----------------------- | ------------------------------------------------------ |
| `DeletionError` | 500  | PostgreSQL delete fails | Return 500, data may be partially deleted              |
| `DeletionError` | 500  | IdP Backend API fails   | Log to Sentry, return 500. IdP may have orphaned user. |
| `Error`         | 500  | Network failure         | Lambda retries via SQS DLQ                             |

---

### Module: MOD-018 (Password Reset Link Component)

**Parent Architecture Modules**: ARCH-018
**Target Source File(s)**: `packages/apps/commise/web/components/auth/PasswordResetLink.tsx`, `packages/apps/commise/mobile/components/PasswordResetLink.tsx`

#### Algorithmic / Logic View

```pseudocode
FUNCTION PasswordResetLink():
    idpResetUrl = "https://IDP_DOMAIN/usernamecode-enter"
    RETURN (
        <a href={idpResetUrl} className="forgot-password-link">
            Forgot password?
        </a>
    )
```

#### State Machine View

```
N/A — Stateless (static component, no state)
```

#### Internal Data Structures

| Field         | Type   | Size/Constraints     | Initialization | Lifecycle |
| ------------- | ------ | -------------------- | -------------- | --------- |
| `idpResetUrl` | string | IdP hosted reset URL | Static const   | Immutable |

#### Error Handling & Return Codes

| Error | Code | Trigger                     | Recovery Action |
| ----- | ---- | --------------------------- | --------------- |
| —     | —    | No exceptions (static link) | —               |

---

### Module: MOD-019 (MFA Enrollment Component)

**Parent Architecture Modules**: ARCH-019
**Target Source File(s)**: `packages/apps/commise/web/components/security/MFAEnrollment.tsx`, `packages/apps/commise/mobile/screens/MFAScreen.tsx`

#### Algorithmic / Logic View

```pseudocode
FUNCTION MFAEnrollment(props: { userId: string }):
    [mfaUrl, setMfaUrl] = useState<string | null>(null)
    [isLoading, setIsLoading] = useState(true)
    [error, setError] = useState<string | null>(null)

    TRY:
        response = await fetch("/api/security/mfa-enrollment-link", {
            headers: { Authorization: "Bearer " + getAccessToken() }
        })
        IF response.ok:
            data = await response.json()
            setMfaUrl(data.mfaUrl)
        ELSE:
            setError("Failed to generate MFA enrollment link")
    CATCH err:
        setError("Network error")
    FINALLY:
        setIsLoading(false)

    IF isLoading: RETURN <Spinner />
    IF error: RETURN <ErrorMessage message={error} />
    RETURN (
        <div>
            <h2>Enable Two-Factor Authentication</h2>
            <p>Protect your account with an authenticator app.</p>
            <a href={mfaUrl} target="_blank" rel="noopener noreferrer">
                Set up Authenticator App
            </a>
        </div>
    )
```

#### State Machine View

```
N/A — Stateless (React component)
```

#### Internal Data Structures

| Field    | Type   | Size/Constraints       | Initialization   | Lifecycle                |
| -------- | ------ | ---------------------- | ---------------- | ------------------------ |
| `mfaUrl` | string | IdP MFA enrollment URL | Fetched from API | Used once per enrollment |

#### Error Handling & Return Codes

| Error       | Code | Trigger                     | Recovery Action             |
| ----------- | ---- | --------------------------- | --------------------------- |
| `LinkError` | —    | API fails to return MFA URL | Show error state with retry |
| `Error`     | 401  | Access token expired        | Redirect to login           |

---

### Module: MOD-020 (Social Account Linking API Handler)

**Parent Architecture Modules**: ARCH-020
**Target Source File(s)**: `packages/api/handlers/social-link.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handler(event: APIGatewayProxyEvent):
    userId = event.requestContext.authorizer.claims.sub
    body = JSON.parse(event.body)
    action = event.httpMethod === "POST" ? "link" : "unlink"
    provider = body.provider
    connection = body.connection

    idpToken = await getIdpManagementToken()
    idpUserId = getIdpUserId(userId)  // From users table

    TRY:
        currentProviders = db.query("SELECT provider FROM accounts WHERE user_id = $1", [userId])
        linkedProviders = currentProviders.rows.map(r => r.provider)

        IF action === "unlink" AND linkedProviders.length <= 1:
            RETURN { statusCode: 400, body: JSON.stringify({ error: "Cannot remove last login method" }) }

        IF action === "link":
            // Call IdP Backend API to link accounts
            CALL idp.users.linkAccount(idpUserId, { provider, connection })

        IF action === "unlink":
            // Call IdP Backend API to unlink secondary account
            CALL idp.users.unlinkAccount(idpUserId, { provider, connection })

        updatedProviders = db.query("SELECT provider FROM accounts WHERE user_id = $1", [userId])
        RETURN { statusCode: 200, body: JSON.stringify({ linkedProviders: updatedProviders.rows.map(r => r.provider) }) }

    CATCH err:
        LOG.error("Social link operation failed", { userId, action, error: err })
        RETURN { statusCode: 500, body: JSON.stringify({ error: "Social account operation failed" }) }
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field             | Type     | Size/Constraints | Initialization                       | Lifecycle                 |
| ----------------- | -------- | ---------------- | ------------------------------------ | ------------------------- |
| `linkedProviders` | string[] | From DB          | Fetched per request                  | Updated after link/unlink |
| `idpUserId`       | string   | IdP user ID      | Looked up from users table by userId | Immutable                 |

#### Error Handling & Return Codes

| Error               | Code | Trigger                              | Recovery Action       |
| ------------------- | ---- | ------------------------------------ | --------------------- |
| `LastProviderError` | 400  | Unlinking would leave zero providers | Return 400 with error |
| `Error`             | 500  | IdP Backend API failure              | Log and return 500    |

---

### Module: MOD-021 (Social Account Linking Component)

**Parent Architecture Modules**: ARCH-021
**Target Source File(s)**: `packages/apps/commise/web/components/account/SocialLinking.tsx`, `packages/apps/commise/mobile/screens/SocialLinkingScreen.tsx`

#### Algorithmic / Logic View

```pseudocode
FUNCTION SocialLinking(props: { linkedProviders: string[] }):
    [providers, setProviders] = useState(props.linkedProviders)
    [isLoading, setIsLoading] = useState(false)
    [error, setError] = useState<string | null>(null)

    onLink = async (provider: string):
        setIsLoading(true)
        TRY:
            response = await fetch("/api/account/social-link", {
                method: "POST",
                body: JSON.stringify({ provider, connection: provider }),
                headers: { "Content-Type": "application/json" }
            })
            data = await response.json()
            setProviders(data.linkedProviders)
        CATCH err:
            setError("Failed to link " + provider)
        FINALLY:
            setIsLoading(false)

    onUnlink = async (provider: string):
        TRY:
            response = await fetch("/api/account/social-link", {
                method: "DELETE",
                body: JSON.stringify({ provider })
            })
            IF response.status === 400:
                errorData = await response.json()
                setError(errorData.error)
                RETURN
            data = await response.json()
            setProviders(data.linkedProviders)
        CATCH err:
            setError("Failed to unlink " + provider)

    allProviders = ["google", "apple", "github"]
    unlinked = allProviders.filter(p => NOT providers.includes(p))

    RETURN (
        <div>
            <h3>Linked Accounts</h3>
            <ul>
                {providers.map(p => (
                    <li key={p}>
                        {p} <button onClick={() => onUnlink(p)} disabled={isLoading}>Unlink</button>
                    </li>
                ))}
            </ul>
            {unlinked.length > 0 && (
                <>
                    <h3>Link New Account</h3>
                    {unlinked.map(p => (
                        <button key={p} onClick={() => onLink(p)} disabled={isLoading}>
                            Link {p}
                        </button>
                    ))}
                </>
            )}
            {error && <ErrorMessage message={error} onDismiss={() => setError(null)} />}
        </div>
    )
```

#### State Machine View

```
N/A — Stateless (React component)
```

#### Internal Data Structures

| Field       | Type     | Size/Constraints                   | Initialization          | Lifecycle              |
| ----------- | -------- | ---------------------------------- | ----------------------- | ---------------------- |
| `providers` | string[] | All linked providers for this user | From props or API fetch | Updated on link/unlink |
| `unlinked`  | string[] | Available providers not yet linked | Computed on render      | Updated on link/unlink |

#### Error Handling & Return Codes

| Error               | Code | Trigger                                     | Recovery Action          |
| ------------------- | ---- | ------------------------------------------- | ------------------------ |
| `LinkError`         | —    | API fetch fails                             | Error message above list |
| `LastProviderError` | —    | Backend returns 400 on last-provider unlink | Inline error message     |

---

### Module: MOD-022 (Impersonation Token Exchange Service)

**Parent Architecture Modules**: ARCH-022
**Target Source File(s)**: `packages/lambda/impersonation-exchange/index.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handler(event: APIGatewayProxyEvent):
    body = JSON.parse(event.body)
    targetUserId = body.targetUserId
    impersonatorId = event.requestContext.authorizer.claims.sub

    // Verify impersonator has IMPERSONATOR role
    impersonatorRoles = getRoles(impersonatorId)
    IF NOT impersonatorRoles.includes("IMPERSONATOR"):
        RETURN { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) }

    TRY:
        // Exchange via IdP token exchange
        response = await fetch(IDP_TOKEN_URL, {
            method: "POST",
            body: JSON.stringify({
                grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
                subject_token: getImpersonatorToken(impersonatorId),
                subject_token_type: "urn:ietf:params:oauth:token-type:access-token",
                target: targetUserId,
                metadata: JSON.stringify({
                    impersonator_id: impersonatorId,
                    impersonated_at: NOW().toISOString()
                })
            })
        })
        tokens = await response.json()

        // Inject impersonation flag into access token claims
        signedToken = signJWT({
            sub: targetUserId,
            impersonator: impersonatorId,
            imp: true,  // Impersonation flag
            iat: NOW(),
            exp: NOW() + 3600
        })

        RETURN { statusCode: 200, body: JSON.stringify({ accessToken: signedToken }) }
    CATCH err:
        LOG.error("Impersonation exchange failed", { impersonatorId, targetUserId, err })
        RETURN { statusCode: 500, body: JSON.stringify({ error: "Token exchange failed" }) }
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field            | Type    | Size/Constraints        | Initialization      | Lifecycle                 |
| ---------------- | ------- | ----------------------- | ------------------- | ------------------------- |
| `targetUserId`   | string  | UUIDv4                  | From request body   | Used in token claims      |
| `impersonatorId` | string  | UUIDv4                  | From JWT authorizer | Written to token metadata |
| `imp`            | boolean | true when impersonating | Set to true         | Injected into JWT         |

#### Error Handling & Return Codes

| Error                | Code | Trigger                        | Recovery Action               |
| -------------------- | ---- | ------------------------------ | ----------------------------- |
| `ForbiddenError`     | 403  | Caller lacks IMPERSONATOR role | Return 403 immediately        |
| `TokenExchangeError` | 500  | IdP token exchange fails       | Log to CloudWatch, return 500 |

---

### Module: MOD-023 (Impersonation Audit Logger)

**Parent Architecture Modules**: ARCH-023
**Target Source File(s)**: `packages/api/middleware/impersonation-audit.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION impersonationAuditMiddleware(request: NextRequest):
    claims = request.headers.get("x-jwt-claims")
    IF claims IS NULL:
        RETURN NextResponse.next()

    decoded = decodeJWT(claims)
    IF decoded.imp !== true:
        RETURN NextResponse.next()

    auditEntry = {
        timestamp: NOW().toISOString(),
        impersonatorId: decoded.impersonator,
        impersonatedUserId: decoded.sub,
        action: request.method + " " + request.url,
        ip: request.headers.get("x-forwarded-for"),
        userAgent: request.headers.get("user-agent")
    }
    LOG.info("IMPERSONATION_AUDIT", auditEntry)

    // Add to CloudWatch custom metric
    emitMetric("ImpersonationAudit", 1, [metric_dimension: decoded.impersonator])

    RETURN NextResponse.next()
```

#### State Machine View

```
N/A — Stateless (middleware)
```

#### Internal Data Structures

| Field         | Type    | Size/Constraints                           | Initialization    | Lifecycle                  |
| ------------- | ------- | ------------------------------------------ | ----------------- | -------------------------- |
| `auditEntry`  | object  | ISO 8601 timestamp, UUIDs, HTTP method/URL | Built per request | Written to CloudWatch Logs |
| `decoded.imp` | boolean | Must be `true` to trigger audit            | From JWT claims   | Per request                |

#### Error Handling & Return Codes

| Error   | Code | Trigger                | Recovery Action                      |
| ------- | ---- | ---------------------- | ------------------------------------ |
| `Error` | —    | JWT decode fails       | Let request pass (logged separately) |
| `Error` | —    | CloudWatch write fails | Log to fallback (console.error)      |

---

### Module: MOD-024 (API Gateway JWT Authorizer Lambda)

**Parent Architecture Modules**: ARCH-024
**Target Source File(s)**: `packages/lambda/jwt-authorizer/index.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handler(event: APIGatewayRequest):
    token = event.queryStringParameters.authorization
    IF token IS NULL OR token STARTS WITH "Bearer " IS FALSE:
        RETURN { statusCode: 401, body: '"Unauthorized"' }

    TRY:
        decoded = await verifyJWT(token, {
            algorithms: ["RS256"],
            issuer: IDP_ISSUER,
            audience: IDP_AUDIENCE
        })

        // MOD-025: Check suspension
        suspensionCheck = CALL checkSuspensionStatus(decoded.sub)
        IF suspensionCheck.isSuspended:
            RETURN generateDenyPolicy("User account suspended")

        policy = {
            principalId: decoded.sub,
            policyDocument: {
                Version: "2012-10-17",
                Statement: [{
                    Action: "execute-api:Invoke",
                    Effect: "Allow",
                    Resource: event.methodArn
                }]
            },
            context: {
                userId: decoded.sub,
                email: decoded.email,
                app_metadata: decoded.app_metadata
            }
        }
        RETURN policy

    CATCH err:
        IF err.name === "TokenExpiredError":
            RETURN { statusCode: 401, body: '"Token expired"' }
        RETURN { statusCode: 401, body: '"Unauthorized"' }
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field     | Type      | Size/Constraints                    | Initialization       | Lifecycle               |
| --------- | --------- | ----------------------------------- | -------------------- | ----------------------- |
| `decoded` | JWTClaims | `{ sub, email, app_metadata, ... }` | From `verifyJWT()`   | Per invocation          |
| `policy`  | object    | API Gateway IAM policy              | Built per request    | Returned to API Gateway |
| `context` | object    | Extra claims passed to Lambda       | From JWT + DB lookup | Per invocation          |

#### Error Handling & Return Codes

| Error               | Code | Trigger                        | Recovery Action      |
| ------------------- | ---- | ------------------------------ | -------------------- |
| `TokenExpiredError` | 401  | JWT `exp` claim is in the past | Return 401 to client |
| `JsonWebTokenError` | 401  | Signature verification fails   | Return 401           |
| `Error`             | 401  | Any other verification failure | Return 401           |

---

---

### Module: MOD-025 (Suspension Status Checker)

**Parent Architecture Modules**: ARCH-025
**Target Source File(s)**: `packages/lambda/jwt-authorizer/suspension-check.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION checkSuspensionStatus(userId: string) -> SuspensionStatus:
    TRY:
        // Check IdP blocked flag first (fast path)
        idpUser = await idp.users.get({ id: getIdentityId(userId) })
        IF idpUser.blocked === true:
            RETURN { isSuspended: true, reason: "idp_blocked" }

        // Fallback: check Commise DB status field
        dbStatus = db.query("SELECT status FROM users WHERE id = $1", [userId])
        IF dbStatus.rows.length > 0 AND dbStatus.rows[0].status === "suspended":
            RETURN { isSuspended: true, reason: "db_suspended" }

        RETURN { isSuspended: false, reason: null }

    CATCH err:
        // On any error, default to Deny (fail secure)
        LOG.warn("Suspension check failed, defaulting to suspended", { userId, err })
        RETURN { isSuspended: true, reason: "check_failed" }

FUNCTION getIdentityId(userId: string) -> string:
    result = db.query("SELECT identity_id FROM users WHERE id = $1", [userId])
    RETURN result.rows[0].identity_id
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field             | Type    | Size/Constraints                                | Initialization              | Lifecycle          |
| ----------------- | ------- | ----------------------------------------------- | --------------------------- | ------------------ |
| `idpUser.blocked` | boolean | From IdP Backend API                            | Fetched per check           | Real-time          |
| `dbStatus`        | string  | "active" \| "suspended"                         | From users table            | Cached at DB level |
| `reason`          | string  | One of: idp_blocked, db_suspended, check_failed | Set on suspension detection | Per check          |

#### Error Handling & Return Codes

| Error   | Code | Trigger                     | Recovery Action                         |
| ------- | ---- | --------------------------- | --------------------------------------- |
| `Error` | —    | IdP Backend API unreachable | Fail-secure: return `isSuspended: true` |
| `Error` | —    | PostgreSQL unreachable      | Fail-secure: return `isSuspended: true` |
| `Error` | —    | User not found in DB        | Fail-secure: return `isSuspended: true` |

---

### Module: MOD-026 (User Suspension API Handler)

**Parent Architecture Modules**: ARCH-026
**Target Source File(s)**: `packages/api/handlers/user-suspension.ts`

#### Algorithmic / Logic View

```pseudocode
FUNCTION handler(event: APIGatewayProxyEvent):
    IF event.httpMethod NOT IN ["POST"]:
        RETURN { statusCode: 405 }

    userId = event.pathParameters.userId
    action = event.pathParameters.action  // "suspend" or "reactivate"

    // Admin authorization check
    callerRoles = event.requestContext.authorizer.claims.roles
    IF NOT callerRoles.includes("ADMIN"):
        RETURN { statusCode: 403, body: JSON.stringify({ error: "Forbidden" }) }

    TRY:
        identityId = db.query("SELECT identity_id FROM users WHERE id = $1", [userId])
        IF identityId.rows.length === 0:
            RETURN { statusCode: 404, body: JSON.stringify({ error: "User not found" }) }

        idpUserId = identityId.rows[0].identity_id

        IF action === "suspend":
            // Block in IdP
            await idp.users.update({ id: idpUserId, data: { blocked: true } })
            // Update DB status
            db.query("UPDATE users SET status = 'suspended', updated_at = NOW() WHERE id = $1", [userId])
            LOG.info("User suspended", { userId, adminId: event.requestContext.authorizer.claims.sub })

        IF action === "reactivate":
            await idp.users.update({ id: idpUserId, data: { blocked: false } })
            db.query("UPDATE users SET status = 'active', updated_at = NOW() WHERE id = $1", [userId])
            LOG.info("User reactivated", { userId, adminId: event.requestContext.authorizer.claims.sub })

        RETURN { statusCode: 200, body: JSON.stringify({ userId, status: action === "suspend" ? "suspended" : "active" }) }

    CATCH err:
        LOG.error("Suspension operation failed", { userId, action, error: err })
        RETURN { statusCode: 500, body: JSON.stringify({ error: "Operation failed" }) }
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field       | Type   | Size/Constraints          | Initialization             | Lifecycle                  |
| ----------- | ------ | ------------------------- | -------------------------- | -------------------------- |
| `userId`    | string | UUIDv4                    | From path parameter        | Looked up in DB            |
| `action`    | string | "suspend" \| "reactivate" | From path parameter        | Determines IdP + DB update |
| `idpUserId` | string | IdP user ID               | Looked up from users table | Immutable                  |

#### Error Handling & Return Codes

| Error            | Code | Trigger                 | Recovery Action                    |
| ---------------- | ---- | ----------------------- | ---------------------------------- |
| `ForbiddenError` | 403  | Caller lacks ADMIN role | Return 403 immediately             |
| `NotFoundError`  | 404  | userId not found in DB  | Return 404                         |
| `Error`          | 500  | IdP or DB failure       | Return 500, partial state possible |

---

### Module: MOD-027 (Structured Logger)

**Parent Architecture Modules**: ARCH-027
**Target Source File(s)**: `packages/logger/index.ts`

#### Algorithmic / Logic View

```pseudocode
CONST logger = new Logger({
    serviceName: "auth-service",
    logLevel: process.env.LOG_LEVEL || "info"
})

FUNCTION log(message: string, context: object):
    enrichedContext = {
        ...context,
        timestamp: new Date().toISOString(),
        correlationId: context.correlationId || getCorrelationId()
    }
    TRY:
        logger.info(message, enrichedContext)
    CATCH:
        console.error("[LOGGER_FAILSAFE]", message, enrichedContext)

FUNCTION getCorrelationId() -> string:
    IF requestContext.headers["x-correlation-id"]:
        RETURN requestContext.headers["x-correlation-id"]
    RETURN crypto.randomUUID()
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field           | Type   | Size/Constraints     | Initialization                 | Lifecycle   |
| --------------- | ------ | -------------------- | ------------------------------ | ----------- |
| `correlationId` | string | UUIDv4               | Generated if absent in request | Per request |
| `serviceName`   | string | const "auth-service" | Static                         | Immutable   |
| `timestamp`     | string | ISO 8601             | Set at log call time           | Per entry   |

#### Error Handling & Return Codes

| Error      | Code | Trigger                   | Recovery Action           |
| ---------- | ---- | ------------------------- | ------------------------- |
| `LogError` | —    | CloudWatch Logs SDK fails | Fallback to console.error |

---

### Module: MOD-028 (CloudWatch Metrics Emitter)

**Parent Architecture Modules**: ARCH-028
**Target Source File(s)**: `packages/metrics/index.ts`

#### Algorithmic / Logic View

```pseudocode
CONST METRIC_NAMES = {
    LoginSuccess: "Auth/LoginSuccess",
    LoginFailure: "Auth/LoginFailure",
    TokenRefresh: "Auth/TokenRefresh",
    TokenRefreshFailure: "Auth/TokenRefreshFailure",
    Signup: "Auth/Signup",
    AccountDeletion: "Auth/AccountDeletion",
    Reconciliation: "Auth/Reconciliation"
}

FUNCTION emitMetric(metricName: string, value: number, dimensions?: Dimensions):
    TRY:
        cloudwatch.putMetricData({
            Namespace: "Commise/Auth",
            MetricData: [{
                MetricName: METRIC_NAMES[metricName],
                Value: value,
                Unit: "Count",
                Dimensions: dimensions || { Environment: process.env.STAGE }
            }]
        })
    CATCH err:
        logger.warn("CloudWatch metric emit failed", { metricName, err })

FUNCTION emitLoginSuccess(userId: string):
    emitMetric("LoginSuccess", 1, { Platform: detectPlatform(userId) })
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field          | Type   | Size/Constraints                                    | Initialization | Lifecycle  |
| -------------- | ------ | --------------------------------------------------- | -------------- | ---------- |
| `METRIC_NAMES` | Record | Keys are logical names, values are CloudWatch paths | Static const   | Immutable  |
| `Dimensions`   | object | `{ Environment: string, Platform?: string }`        | Per emit call  | Per metric |

#### Error Handling & Return Codes

| Error         | Code | Trigger                | Recovery Action                |
| ------------- | ---- | ---------------------- | ------------------------------ |
| `MetricError` | —    | CloudWatch API failure | Logged to MOD-027, no blocking |

---

### Module: MOD-029 (Sentry Integration Wrapper)

**Parent Architecture Modules**: ARCH-029
**Target Source File(s)**: `packages/sentry/index.ts`

#### Algorithmic / Logic View

```pseudocode
// Server-side initialization
FUNCTION initSentry():
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.STAGE,
        integrations: [new Sentry.Integration.ContextLines()]
    })

// Client-side React
FUNCTION initReactSentry():
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        integrations: [new Sentry.Integrations.Breadcrumbs()]
    })

FUNCTION captureError(error: Error, context?: { userId?: string, correlationId?: string, breadcrumbs?: Breadcrumb[] }):
    TRY:
        scope = new Sentry.Scope()
        IF context.userId:
            scope.setUser({ id: context.userId })
        IF context.correlationId:
            scope.setTag("correlationId", context.correlationId)
        IF context.breadcrumbs:
            scope.addBreadcrumb(context.breadcrumbs)
        Sentry.captureException(error, scope)
    CATCH:
        console.error("Sentry capture failed", error)

FUNCTION isAuthError(err: Error) -> boolean:
    RETURN err instanceof AuthSessionExpiredError
        OR err instanceof UserNotFoundError
        OR err instanceof AccountDeletionFailedError
```

#### State Machine View

```
N/A — Stateless
```

#### Internal Data Structures

| Field        | Type         | Size/Constraints | Initialization    | Lifecycle |
| ------------ | ------------ | ---------------- | ----------------- | --------- |
| `scope`      | Sentry.Scope | Per capture call | Created per error | Transient |
| `SENTRY_DSN` | string       | From env var     | Read at init      | Immutable |

#### Error Handling & Return Codes

| Error         | Code | Trigger            | Recovery Action           |
| ------------- | ---- | ------------------ | ------------------------- |
| `SentryError` | —    | Sentry SDK failure | Fallback to console.error |

---

### Module: MOD-030 (CDK Auth Stack)

**Parent Architecture Modules**: ARCH-030
**Target Source File(s)**: `infra/cdk/auth-stack.ts`

#### Algorithmic / Logic View

```pseudocode
CLASS AuthStack extends Stack:
    CONSTRUCTOR(scope: Construct, id: string, props: AuthStackProps):
        super(scope, id, props)
        idpDomain = StringParameter.valueFromLookup(this, "IdpDomain")
        IDP_CLIENT_ID = StringParameter.valueFromLookup(this, "IdpClientId")

        // API Gateway
        api = new RestApi(this, "AuthApi", { description: "Commise Auth API" })

        // Lambdas (ARCH-010, ARCH-011, ARCH-012, ARCH-015, ARCH-017, ARCH-020, ARCH-022, ARCH-024, ARCH-026)
        userProvisioningLambda = new Function(this, "UserProvisioning", {
            runtime: Runtime.NODEJS_22_X,
            handler: "index.handler",
            code: Code.fromAsset("packages/lambda/user-provisioning"),
            environment: { IDP_DOMAIN: idpDomain }
        })

        // IAM roles for Lambdas
        userProvisioningLambda.role.addToPolicy(new PolicyStatement({
            actions: ["secretsmanager:GetSecretValue"],
            resources: ["arn:aws:secretsmanager:us-east-1:ACCOUNT:secret:IDP_MGMT/*"]
        }))

        // SQS queues for reconciliation
        reconciliationQueue = new Queue(this, "ReconciliationQueue", {
            visibilityTimeout: Duration.minutes(5)
        })

        // EventBridge rule for scheduled reconciliation
        new Rule(this, "ReconciliationSchedule", {
            schedule: Schedule.rate(Duration.hours(1)),
            targets: [new LambdaFunction(reconciliationLambda)]
        })
```

#### State Machine View

```
N/A — Stateless (CDK synthesis, not runtime)
```

#### Internal Data Structures

| Field                 | Type    | Size/Constraints    | Initialization          | Lifecycle             |
| --------------------- | ------- | ------------------- | ----------------------- | --------------------- |
| `idpDomain`           | string  | SSM Parameter Store | Looked up at synth time | Immutable per deploy  |
| `api`                 | RestApi | API Gateway         | Created in constructor  | Immutable after synth |
| `reconciliationQueue` | Queue   | SQS FIFO            | Created in constructor  | Immutable             |

#### Error Handling & Return Codes

| Error        | Code | Trigger                                | Recovery Action                       |
| ------------ | ---- | -------------------------------------- | ------------------------------------- |
| `SynthError` | —    | Missing SSM param or invalid construct | CDK synth fails with full stack trace |

---

### Module: MOD-031 (Shared Auth Types Library)

**Parent Architecture Modules**: ARCH-031
**Target Source File(s)**: `packages/types/auth.ts`

#### Algorithmic / Logic View

```pseudocode
// All exports are TypeScript compile-time only — no runtime code

INTERFACE AccessTokenClaims {
    sub: string           // UUIDv4 user ID
    email: string         // RFC 5321 email
    email_verified: boolean
    app_metadata: {
        userId: string    // UUIDv4 — same as sub
    }
    iss: string           // "https://IDP_DOMAIN/"
    aud: string           // "https://api.ourcommise.com"
    iat: number           // Unix timestamp
    exp: number           // Unix timestamp
    scope: string
}

INTERFACE Session {
    accessToken: string   // JWT Access token
    refreshToken: string   // Opaque refresh token
    user: {
        sub: string
        email: string
        displayName?: string
    }
    expiresAt: number      // Unix timestamp
}

INTERFACE Tokens {
    accessToken: string
    refreshToken: string
    idToken?: string
    expiresIn: number
}

TYPE AuthErrorType = "AuthSessionExpired" | "UserNotFound" | "AccountDeletionFailed" | "InvalidToken" | "TokenRefreshFailed"

INTERFACE AuthApiResponse {
    error?: string
    message?: string
    statusCode?: number
}
```

#### State Machine View

```
N/A — TypeScript compile-time only (no runtime state)
```

#### Internal Data Structures

| Field                   | Type   | Size/Constraints | Initialization      | Lifecycle        |
| ----------------------- | ------ | ---------------- | ------------------- | ---------------- |
| `AccessTokenClaims.sub` | string | UUIDv4 format    | From IdP JWT        | Per token decode |
| `app_metadata.userId`   | string | UUIDv4           | Must match sub      | Enforced in type |
| `expiresAt`             | number | Unix timestamp   | Computed from `exp` | Per session      |

#### Error Handling & Return Codes

| Error                    | Code | Trigger                             | Recovery Action    |
| ------------------------ | ---- | ----------------------------------- | ------------------ |
| TypeScript compile error | —    | Assigning wrong type to typed field | Compile-time catch |
| `strict: true` enforced  | —    | Any `any` usage                     | Compile-time error |

---

### Module: MOD-032 (Custom Auth Error Classes)

**Parent Architecture Modules**: ARCH-032
**Target Source File(s)**: `packages/errors/auth-errors.ts`

#### Algorithmic / Logic View

```pseudocode
CLASS AuthSessionExpiredError extends Error:
    CONSTRUCTOR(message = "Session expired or revoked"):
        super(message)
        this.name = "AuthSessionExpiredError"
        this.type = "AuthSessionExpired"

CLASS UserNotFoundError extends Error:
    CONSTRUCTOR(userId: string):
        super("User not found: " + userId)
        this.name = "UserNotFoundError"
        this.type = "UserNotFound"

CLASS AccountDeletionFailedError extends Error:
    CONSTRUCTOR(cause?: Error):
        super("Account deletion failed" + (cause ? ": " + cause.message : ""))
        this.name = "AccountDeletionFailedError"
        this.type = "AccountDeletionFailed"
        this.cause = cause

CLASS InvalidTokenError extends Error:
    CONSTRUCTOR(reason: string):
        super("Invalid token: " + reason)
        this.name = "InvalidTokenError"
        this.type = "InvalidToken"

CLASS TokenRefreshFailedError extends Error:
    CONSTRUCTOR(cause?: Error):
        super("Token refresh failed")
        this.name = "TokenRefreshFailedError"
        this.type = "TokenRefreshFailed"
        this.cause = cause

// Type guards
FUNCTION isAuthSessionExpiredError(err: Error): boolean:
    RETURN err.type === "AuthSessionExpired"

FUNCTION isUserNotFoundError(err: Error): boolean:
    RETURN err.type === "UserNotFound"

FUNCTION isAccountDeletionFailedError(err: Error): boolean:
    RETURN err.type === "AccountDeletionFailed"
```

#### State Machine View

```
N/A — Stateless (error class definitions)
```

#### Internal Data Structures

| Field        | Type   | Size/Constraints            | Initialization              | Lifecycle    |
| ------------ | ------ | --------------------------- | --------------------------- | ------------ |
| `this.type`  | string | One of AuthErrorType values | Set in constructor          | Per instance |
| `this.cause` | Error  | Optional error chain        | Passed to constructor       | Per instance |
| `this.stack` | string | Error stack trace           | `Error.captureStackTrace()` | Per instance |

#### Error Handling & Return Codes

| Error                        | Code | Trigger                        | Recovery Action   |
| ---------------------------- | ---- | ------------------------------ | ----------------- |
| `AuthSessionExpiredError`    | 401  | Token expired or revoked       | Redirect to login |
| `UserNotFoundError`          | 404  | User ID not found in DB        | Return 404        |
| `AccountDeletionFailedError` | 500  | Deletion operation failed      | Return 500        |
| `InvalidTokenError`          | 401  | JWT signature/claim validation | Return 401        |
| `TokenRefreshFailedError`    | 401  | Refresh token fails            | Redirect to login |

---

### Module: MOD-033 (Auth UI Design Tokens Integration)

**Parent Architecture Modules**: ARCH-033
**Target Source File(s)**: `packages/apps/commise/web/styles/auth-tokens.css`, `packages/apps/commise/mobile/theme/auth-tokens.ts`

#### Algorithmic / Logic View

```pseudocode
// CSS Custom Properties (compile-time)
:root {
    /* Accent colors */
    --accent-primary: #2D7DD2;
    --accent-secondary: #1B4F72;

    /* Semantic status */
    --status-success: #28A745;
    --status-error: #DC3545;
    --status-warning: #FFC107;
    --status-info: #17A2B8;

    /* Auth-specific */
    --auth-bg: #F8F9FA;
    --auth-card-border: #DEE2E6;
    --auth-input-focus: #2D7DD2;

    /* Spacing scale */
    --space-xs: 4px;
    --space-sm: 8px;
    --space-md: 16px;
    --space-lg: 24px;
    --space-xl: 32px;
}

// Component usage — must use design tokens, not hard-coded values
FUNCTION AuthButton(props: ButtonProps):
    RETURN (
        <button
            className="auth-button"
            style={{ backgroundColor: "var(--accent-primary)" }}
            aria-label={props.label}  // Enforced — no icon-only buttons
        >
            {props.children}
        </button>
    )

// Status indicator — never color alone (WCAG 2.1)
FUNCTION StatusBadge(props: { status: "active" | "suspended" }):
    label = props.status === "active" ? "Active" : "Suspended"
    icon = props.status === "active" ? "✓" : "✗"
    RETURN (
        <span aria-label={label}>
            <span aria-hidden="true" style={{ color: `var(--status-${props.status})` }}>{icon}</span>
            <span>{label}</span>
        </span>
    )
```

#### State Machine View

```
N/A — Stateless (CSS/React compile-time)
```

#### Internal Data Structures

| Field          | Type                  | Size/Constraints                       | Initialization | Lifecycle |
| -------------- | --------------------- | -------------------------------------- | -------------- | --------- |
| `designTokens` | CSS custom properties | All design tokens as CSS vars          | Static         | Immutable |
| `statusBadge`  | React component       | Enforces icon + text, never color-only | Per render     | Stateless |

#### Error Handling & Return Codes

| Error        | Code | Trigger                                              | Recovery Action            |
| ------------ | ---- | ---------------------------------------------------- | -------------------------- |
| `LintError`  | —    | ESLint rule `no-hardcoded-colors` catches violations | Build fails on violations  |
| `a11y_error` | —    | `getByRole`/`getByLabel` missing — enforce tests     | Playwright a11y tests fail |

---

## ARCH↔MOD Traceability (Complete)

| MOD ID  | MOD Name                             | Parent ARCH(s) |
| ------- | ------------------------------------ | -------------- |
| MOD-001 | Web Auth Route Handler               | ARCH-001       |
| MOD-002 | Web Auth Middleware Guard            | ARCH-002       |
| MOD-003 | Web Session Cookie Manager           | ARCH-003       |
| MOD-004 | Mobile Auth Provider                 | ARCH-004       |
| MOD-005 | Mobile Secure Token Store            | ARCH-005       |
| MOD-006 | Mobile Auth Callback Handler         | ARCH-006       |
| MOD-007 | Social Connection Configurator       | ARCH-007       |
| MOD-008 | Token Refresh Service (Web)          | ARCH-008       |
| MOD-009 | Token Refresh Service (Mobile)       | ARCH-009       |
| MOD-010 | Post-Registration IdP Handler        | ARCH-010       |
| MOD-011 | User Provisioning Lambda             | ARCH-011       |
| MOD-012 | Reconciliation Lambda                | ARCH-012       |
| MOD-013 | Profile View Component               | ARCH-013       |
| MOD-014 | Account Edit Component               | ARCH-014       |
| MOD-015 | Account Edit API Handler             | ARCH-015       |
| MOD-016 | Account Deletion Component           | ARCH-016       |
| MOD-017 | Account Deletion API Handler         | ARCH-017       |
| MOD-018 | Password Reset Link Component        | ARCH-018       |
| MOD-019 | MFA Enrollment Component             | ARCH-019       |
| MOD-020 | Social Account Linking API Handler   | ARCH-020       |
| MOD-021 | Social Account Linking Component     | ARCH-021       |
| MOD-022 | Impersonation Token Exchange Service | ARCH-022       |
| MOD-023 | Impersonation Audit Logger           | ARCH-023       |
| MOD-024 | API Gateway JWT Authorizer Lambda    | ARCH-024       |
| MOD-025 | Suspension Status Checker            | ARCH-025       |
| MOD-026 | User Suspension API Handler          | ARCH-026       |
| MOD-027 | Structured Logger                    | ARCH-027       |
| MOD-028 | CloudWatch Metrics Emitter           | ARCH-028       |
| MOD-029 | Sentry Integration Wrapper           | ARCH-029       |
| MOD-030 | CDK Auth Stack                       | ARCH-030       |
| MOD-031 | Shared Auth Types Library            | ARCH-031       |
| MOD-032 | Custom Auth Error Classes            | ARCH-032       |
| MOD-033 | Auth UI Design Tokens Integration    | ARCH-033       |
