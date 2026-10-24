# User Journeys: User Authentication

**Branch**: `002-user-auth`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [product-spec.md](./product-spec.md), [spec.md](../spec.md)

---

## Journey Notation

Each journey covers one end-to-end flow per persona. Steps reference FR IDs in brackets. P1/P2/P3 markers correspond to story priority from spec.md.

---

## Persona 1: New User (Avery) — Journey A: Signup to First Authenticated Session

**Scenario**: Avery opens the app (mobile) and the website (web), signs up via the IdP, and is provisioned into Commise with a canonical user identity.

```mermaid
sequenceDiagram
    participant U as Avery (Web/Mobile)
    participant A0 as IdP
    participant WH as Post-Registration Action/Webhook
    participant DB as Commise DB
    participant API as Auth API

    Note over U, A0: P1 — Auth Entry
    U->>A0: Launch login/signup (mobile auto-screen or web redirect)
    Note right: FR-001, FR-002, FR-003, FR-004

    U->>A0: Complete signup + callback
    A0-->>U: Authorization code
    U->>API: Exchange callback for tokens
    Note right: FR-005

    Note over A0, DB: P1 — Signup Sync
    A0->>WH: Trigger user.created webhook action
    WH->>DB: Create User + Account + UUID linkage
    Note right: FR-013, FR-014, FR-015

    alt transient DB failure
        WH->>WH: Retry with exponential backoff
        Note right: FR-016
    end

    API-->>U: Authenticated app session established
    Note right: FR-006, FR-009

    Note over WH, DB: Reconciliation fallback if needed
    WH-->>DB: Nightly drift repair
    Note right: FR-017
```

---

## Persona 2: Returning User (Riley) — Journey B: Session Continuity, Expiry, and Account Lifecycle

**Scenario**: Riley reopens the app with existing refresh token, later encounters session expiration, updates profile, and initiates account deletion.

```mermaid
sequenceDiagram
    participant U as Riley
    participant APP as Web/Mobile App
    participant A0 as IdP
    participant API as Auth API
    participant DB as Commise DB
    participant SQS as Deletion Queue

    Note over U, APP: P1 — Session Continuity
    APP->>APP: Load secure tokens from storage
    Note right: FR-006
    APP->>A0: Refresh access token silently
    Note right: FR-007
    alt refresh valid
        APP->>API: Authorized request with bearer token
        Note right: FR-009
        API-->>APP: 200 OK
    else refresh expired/revoked
        APP->>APP: Clear local session and route to login
        Note right: FR-008
    end

    Note over U, DB: P2 — Profile and Account Edit
    U->>APP: Open profile/account screens
    APP->>API: GET/PATCH /users/me
    Note right: FR-018, FR-019, FR-020, FR-021

    Note over U, A0: P2/P3 — Security Actions
    U->>A0: Trigger forgot password or MFA enrollment flows
    Note right: FR-027, FR-028, FR-029, FR-030, FR-031

    Note over U, DB: P2 — Account Deletion
    U->>APP: Confirm deletion by typing DELETE
    Note right: FR-022
    APP->>API: DELETE /users/me
    API->>DB: Delete User + Account + cascades
    Note right: FR-023, FR-025
    API->>A0: Delete IdP user
    alt IdP delete succeeds
        API-->>APP: Complete deletion + logout
    else IdP delete fails
        API->>SQS: Enqueue retry job (non-blocking to user)
        Note right: FR-024
        API-->>APP: Complete local deletion + logout
    end
    APP->>APP: Clear tokens and route to auth screen
    Note right: FR-026
```

---

## Persona 3: Support/Admin Operator (Jordan) — Journey C: Suspension, Reactivation, and Impersonation Controls

**Scenario**: Jordan suspends a user, validates enforced denial behavior, and later reactivates the user. _The impersonation step was withdrawn on 2026-10-15 (owner ruling "Delete the impersonation then"); an impersonated Clerk `act` session is now refused on web and mobile._

```mermaid
sequenceDiagram
    participant OPS as Operator
    participant API as Admin/Auth API
    participant A0 as IdP
    participant AUTHZ as API Gateway Authorizer
    participant USER as End User Session

    Note over OPS, A0: P2 — Suspension
    OPS->>API: Suspend user command
    API->>A0: Set block=true
    API->>API: Set User.status=suspended
    Note right: FR-041

    USER->>AUTHZ: Call protected API with token
    AUTHZ-->>USER: 403 Forbidden (suspended)
    Note right: FR-042, FR-043

    Note over OPS, A0: P2 — Reactivation
    OPS->>API: Reactivate user
    API->>A0: Set block=false
    API->>API: Set User.status=active
    Note right: FR-044
```

---

## Cross-Persona Edge Journeys

### 1. Session-Expired Recovery

- Trigger: refresh token invalid/revoked.
- Behavior: clear local state, route to login, retain explicit reason messaging.
- FR coverage: FR-008, FR-012.

### 2. Async IdP Deletion Retry

- Trigger: local DB deletion successful, IdP Backend API failure.
- Behavior: queue retry with backoff + DLQ alarms; user flow still completes.
- FR coverage: FR-024, FR-026.

### 3. Suspended Session Denial

- Trigger: user suspended while active session exists.
- Behavior: authorizer denies protected calls with 403; client renders suspension message.
- FR coverage: FR-041, FR-042, FR-043.

---

## Coverage Matrix (Journey → Story)

| Journey                  | Story Coverage                                 |
| ------------------------ | ---------------------------------------------- |
| Journey A (Avery)        | US-001, US-004                                 |
| Journey B (Riley)        | US-002, US-003, US-006, US-007, US-008, US-011 |
| Journey C (Jordan)       | US-010, US-012                                 |
| Cross-persona edge flows | US-002, US-007, US-010                         |
