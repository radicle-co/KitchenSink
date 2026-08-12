# Feature Specification: User Authentication

**Feature Branch**: `002-user-auth`
**Created**: 2026-04-14
**Updated**: 2026-06-01
**Status**: Complete
**Input**: User description: "Implement identity-provider-based user authentication for the Commise app across web (Next.js) and mobile (Expo) platforms. Users must log in via the identity provider (IdP), with platform-specific flows (mobile shows auth screen automatically, web redirects to login page). Session persistence via session tokens. Users identified by app-generated ULIDs synced to our database on signup (IdP `user.id` stored as secondary key `identity_id`). Profile page, account edit page, account deletion (cascading to IdP), and password reset via IdP."

**Design reference**: [`docs/mockups/`](../../docs/mockups/) — HTML pixel mockups and extracted design system. Login, signup, MFA, session-expired, and OAuth callback are rendered by **Clerk's hosted UI** (no app-side mockups for those flows); app-rendered profile/account screens have mockups under [`docs/mockups/screens/`](../../docs/mockups/screens/).

## Dependencies

| Spec                                                        | Relationship                                                                             |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [001-commise-recipe-app](../001-commise-recipe-app/spec.md) | **Downstream** — 001 FR-045 requires authentication provided by this spec                |
| [003-usda-food-data](../003-usda-food-data/spec.md)         | **Downstream** — 003 FR-035 uses the shared API Gateway authorizer provided by this spec |
| [005-ai-integration](../005-ai-integration/spec.md)         | **Downstream** — external agent OAuth (FR-018) builds on the auth layer                  |
| [010-subscriptions](../010-subscriptions/spec.md)           | **Downstream** — subscription tier is stored on the Account entity (FR-040–043)          |

## User Scenarios & Testing _(mandatory)_

<!--
  Integration references:
  - specs/001-commise-recipe-app/spec.md (FR-045: authentication required, FR-040/FR-041: subscription tiers)
  - specs/003-usda-food-data/spec.md (FR-035: shared API Gateway authorizer)

  IMPORTANT: User stories should be PRIORITIZED as user journeys ordered by importance.
  Each user story/journey must be INDEPENDENTLY TESTABLE - meaning if you implement just ONE of them,
  you should still have a viable MVP (Minimum Viable Product) that delivers value.
-->

### Out of Scope

The following are explicitly **not** part of this feature and will be addressed as separate features if needed:

- **Email change flow**: Users cannot change their email address through Commise. Email changes require a separate feature that coordinates with the IdP's email verification.
- **Admin dashboard for user management**: No admin UI for viewing, searching, editing, or bulk-managing users. Suspension/reactivation (FR-035/FR-038) and impersonation (FR-042) are backend/API operations only; admin UI is a separate feature.
- **MFA**: Multi-factor authentication is out of scope for this feature.
- **Passkeys**: Passkey authentication is out of scope for this feature.
- **Custom sign-in UI**: The IdP-hosted sign-in UI is used; no custom sign-in components are built.
- **IdP Organizations**: Organization-level access control is out of scope.

### User Story 1 - Sign Up (Priority: P0)

A new user opens Commise for the first time and creates an account. On the mobile app, the identity provider (IdP) authentication screen is displayed automatically. On the web app, the user is redirected to the IdP sign-up page. The user provides their email and password (or uses a social provider). After successful signup, the IdP fires a `user.created` webhook that creates a User and Account record in the Commise database. The user is then authenticated and lands on the home screen.

**Why this priority**: Without signup, no other feature is accessible. This is the entry point for all new users.

**Independent Test**: Can be fully tested by completing the signup flow end-to-end, verifying the user lands on the home screen, and confirming a User and Account record exist in the database with the correct `identity_id` and a ULID primary key.

**Acceptance Scenarios**:

1. **Given** a new user on the mobile app, **When** the app launches with no active session, **Then** the IdP authentication screen is displayed automatically.
2. **Given** a new user on the web app, **When** they navigate to any protected route, **Then** they are redirected to the IdP sign-up/login page.
3. **Given** a user completes signup with email and password, **When** the IdP fires the `user.created` webhook, **Then** the Commise backend creates a User record (ULID primary key, `identity_id` set to the IdP's `user.id`) and an Account record atomically.
4. **Given** the `user.created` webhook fires, **When** the database write succeeds, **Then** the user is authenticated and lands on the home screen.
5. **Given** a user signs up with a social provider (e.g., Google), **When** the `user.created` webhook fires, **Then** the same User and Account creation flow applies — the social identity is linked within the IdP, and our database stores the app-generated ULID as the canonical user ID.

---

### User Story 2 - Login and Session Persistence (Priority: P1)

A returning user opens Commise and is either already logged in (valid session token) or presented with the IdP login screen. On the mobile app, the auth screen appears automatically. On the web app, the user is redirected to the IdP login page. After successful authentication, the user receives an access token. The session persists as long as the session token is valid — the user does not need to re-authenticate on every app open.

**Why this priority**: Login and session persistence are the gateway to the entire app. Without a working login flow with persistent sessions, users would need to re-authenticate on every visit, making the app unusable. This satisfies Commise FR-045 (authentication required for all features).

**Independent Test**: Can be fully tested by logging in, closing the app, reopening it, and verifying the user is still authenticated without seeing the login screen. Then force-expire the session token and verify the user is prompted to re-authenticate.

**Acceptance Scenarios**:

1. **Given** a registered user on the mobile app with no active session, **When** the app launches, **Then** the IdP login screen is displayed automatically.
2. **Given** a registered user on the web app with no active session, **When** they navigate to any route, **Then** they are redirected to the IdP login page.
3. **Given** a user successfully authenticates, **When** the IdP callback completes, **Then** the system stores an access token securely (Keychain/Keystore on mobile, httpOnly cookie on web).
4. **Given** a user has a valid session token, **When** they reopen the app after closing it, **Then** the system silently refreshes the access token and the user enters the app without seeing the login screen.
5. **Given** a user's access token has expired but the session token is still valid, **When** the user makes an API request, **Then** the system transparently refreshes the access token and retries the request without user intervention.
6. **Given** a user's session token has expired or been revoked, **When** the user attempts any action, **Then** the system redirects them to the IdP login screen to re-authenticate.

---

### User Story 3 - Logout (Priority: P1)

A logged-in user chooses to log out from the app. The system clears the local session (access token, session token) and signs the user out of the identity provider (IdP). After logout, the user is returned to the authentication screen (mobile) or the IdP login page (web).

**Why this priority**: Logout is a fundamental security requirement. Users must be able to end their session, especially on shared devices.

**Independent Test**: Can be fully tested by logging in, logging out, and verifying the user is returned to the authentication screen and cannot access protected routes without re-authenticating.

**Acceptance Scenarios**:

1. **Given** a logged-in user, **When** they trigger the logout action, **Then** all local tokens are cleared from secure storage.
2. **Given** a user logs out, **When** the logout completes, **Then** the system signs the user out of the IdP and returns them to the authentication screen (mobile) or IdP login page (web).
3. **Given** a logged-out user, **When** they attempt to access a protected route, **Then** they are redirected to the login screen.

---

### User Story 4 - View Profile (Priority: P1)

A logged-in user navigates to the profile page. The system displays their display name, email, avatar, and account creation date sourced from the Commise database.

**Why this priority**: The profile page is the primary way users verify their identity and account details within the app.

**Independent Test**: Can be fully tested by navigating to the profile page and verifying all user data is displayed correctly.

**Acceptance Scenarios**:

1. **Given** a logged-in user, **When** they navigate to the profile page, **Then** the system displays their display name, email, avatar, and account creation date sourced from the Commise database.
2. **Given** a user whose database record has no avatar set, **When** they view the profile page, **Then** a default avatar placeholder is displayed.
3. **Given** an unauthenticated request to the profile page, **When** the system receives the request, **Then** it redirects to the login flow (mobile: auth screen; web: IdP login page).

---

### User Story 5 - Edit Account Details (Priority: P2)

A logged-in user navigates to the account edit page where they can modify their account details — display name, avatar, and any other editable account fields. Changes are saved to the Commise database. Fields managed by the identity provider (IdP) (email, password) are not editable from this page — those use dedicated IdP flows (password reset, email change via IdP).

**Why this priority**: Account editing extends the profile experience and allows users to personalize their identity. It is P2 because the app is fully functional with the default account created at signup; personalization enhances but does not gate core functionality.

**Independent Test**: Can be fully tested by navigating to the account edit page, changing the display name and avatar, saving, and verifying the profile page reflects the updated values.

**Acceptance Scenarios**:

1. **Given** a logged-in user on the account edit page, **When** they update their display name and save, **Then** the change is persisted to the Commise database and reflected on the profile page.
2. **Given** a logged-in user on the account edit page, **When** they upload a new avatar image, **Then** the image is stored and displayed on the profile page.
3. **Given** a logged-in user on the account edit page, **When** they attempt to submit with an empty display name, **Then** the system prevents the save and displays a validation error.
4. **Given** a logged-in user on the account edit page, **When** they view the email field, **Then** it is displayed as read-only with a note directing them to the IdP for email changes.

---

### User Story 6 - Delete Account and User (Priority: P2)

A logged-in user decides to delete their account. They initiate deletion from the account settings page. The system requires explicit confirmation (e.g., type "DELETE" to confirm). On confirmation, the system deletes the User and Account records from the Commise database AND deletes the user from the identity provider (IdP). This is a permanent, irreversible action. The user is logged out and returned to the authentication screen.

**Why this priority**: Account deletion is a regulatory and trust requirement. Users must be able to permanently remove their data.

**Independent Test**: Can be fully tested by creating a user, initiating account deletion, confirming the action, and verifying the user no longer exists in both the Commise database and the IdP. Attempting to log in with the deleted credentials should fail.

**Acceptance Scenarios**:

1. **Given** a logged-in user on the account settings page, **When** they initiate account deletion, **Then** the system displays a confirmation dialog requiring them to type "DELETE" to proceed.
2. **Given** a user confirms account deletion, **When** the system processes the request, **Then** it deletes the User record and the associated Account record from the Commise database.
3. **Given** a user confirms account deletion, **When** the system processes the request, **Then** it deletes the user from the IdP via the Backend API.
4. **Given** the Commise database deletion succeeds but the IdP deletion fails, **When** the system encounters the error, **Then** it proceeds with the local deletion, queues the IdP deletion for automatic async retry (exponential backoff, max 5 attempts), and logs the failure. The user is logged out and returned to the authentication screen without being blocked.
5. **Given** account deletion completes, **When** the user is returned to the authentication screen, **Then** attempting to log in with the deleted credentials fails with an appropriate message.
6. **Given** a user has recipes, meal plans, or other data, **When** they delete their account, **Then** all user-owned data is cascade-deleted from the Commise database.

---

### User Story 7 - Password Reset via IdP (Priority: P2)

A user who has forgotten their password or wants to change it triggers the IdP password reset flow. On the login screen, they click "Forgot Password" which directs them to the IdP's password reset page. The IdP sends a reset email; the user follows the link to set a new password. The entire flow is handled by the IdP — the Commise backend is not involved in password management.

**Independent Test**: Can be fully tested by clicking "Forgot Password" on the login screen, verifying the IdP reset email is received, following the reset link, setting a new password, and logging in with the new password.

**Acceptance Criteria**:

1. **Given** a user on the IdP login screen, **When** they click "Forgot Password", **Then** the IdP displays the password reset request form.
2. **Given** a user submits their email for password reset, **When** the IdP processes the request, **Then** a password reset email is sent to the user's registered email address.
3. **Given** a user follows the password reset link, **When** they set a new password, **Then** the IdP updates the password and the user can log in with the new credentials.
4. **Given** the password reset flow, **When** it completes, **Then** the Commise backend has not stored, processed, or had access to the user's password at any point.

---

## Architecture Notes

The authentication layer consists of:

- **Identity provider (IdP)**: Handles credential management, social login, session tokens, and the hosted sign-in/sign-up UI.
- **`user.created` webhook**: The IdP fires this webhook on signup. The Commise backend creates User + Account + Profile records atomically. The app-generated ULID is the canonical user ID; the IdP's `user.id` is stored as `identity_id` (secondary key).
- **API Gateway Lambda REQUEST authorizer**: Validates IdP JWTs on every API request. Injects `userId` (ULID), `identityUserId`, `email`, and `status` into the API Gateway request context for downstream handlers.
- **Identity Service (ECS)**: Owns the `users`, `accounts`, `profiles`, and `webhook_events` tables. Handles profile/account lifecycle writes.
- **Deletion worker Lambda**: Retries IdP user deletion asynchronously via SQS when the initial deletion fails after database records are removed.
- **Reconciliation Lambda**: Nightly job that detects IdP users without a corresponding Commise database record and creates the missing records.

**Trust boundary rule**: The Lambda authorizer is the sole JWT verification point. The ECS service trusts only the `AuthorizerContext` headers it receives from API Gateway — it never decodes or trusts client-supplied JWT claims directly.

## Requirements _(mandatory)_

<!--
  Constitution reminders (Principles I-VII):
  - All interfaces/types MUST use strict TypeScript; no `any` outside test doubles (Principle I)
  - All exported symbols MUST carry JSDoc; braces required on all control structures (Principle II)
  - New code MUST use aliased imports with .js extensions; no `helpers/` directories (Principle III)
  - New UI elements MUST be queryable by role/label; no `data-testid` (Principles IV & VII)
  - Any new workspace MUST extend shared tooling configs and be declared in Turbo (Principle V)
  - Formatting and lint gates MUST remain green (Principle VI)
  - Interactive elements MUST have accessible names; design tokens MUST be used for color (Principle VII)
-->

### Functional Requirements

**Authentication Flows**

- **FR-001**: System MUST authenticate users via the identity provider (IdP) using the Authorization Code Flow with PKCE for both web (Next.js) and mobile (Expo) platforms.
- **FR-002**: On the mobile app, the system MUST display the IdP authentication screen automatically when no valid session exists, before any app content is accessible.
- **FR-003**: On the web app, the system MUST redirect unauthenticated users to the IdP login page when they attempt to access any protected route.
- **FR-004**: System MUST support IdP social login providers (at minimum: Google) in addition to email/password authentication.
- **FR-005**: System MUST handle the IdP callback (redirect URI) on both platforms, exchanging the authorization code for access and session tokens.

**Session Management**

- **FR-006**: System MUST store access tokens and session tokens securely: Keychain (iOS) / Keystore (Android) on mobile; httpOnly, Secure, SameSite cookies on web. _(See also NFR-003 for OAuth 2.1 token storage compliance.)_
- **FR-007**: System MUST silently refresh the access token using the session token when an API call returns `401 Unauthorized` due to token expiry, without requiring user interaction. The client request interceptor MUST automatically retry the original failed request after successful refresh. Proactive refresh before expiry is NOT required.
- **FR-008**: System MUST show a non-blocking session expiry warning banner when the session token is within 5 minutes of expiry, with a "Keep me signed in" button that triggers a silent token refresh. If the user ignores the warning and the session expires, the system MUST preserve any unsaved form state in `localStorage` as a draft, redirect to the IdP login screen, and automatically restore the draft after successful re-authentication.
- **FR-009**: System MUST attach a valid access token to all API requests as a Bearer token in the Authorization header. _(See also NFR-003 for OAuth 2.1 compliance.)_

**Logout**

- **FR-010**: System MUST provide a logout action that clears all local tokens (access token, session token) from secure storage.
- **FR-011**: System MUST sign the user out of the IdP on logout via the IdP SDK sign-out method.
- **FR-012**: After logout, the system MUST return the user to the authentication screen (mobile) or redirect to the IdP login page (web).

**User Registration and Database Sync**

- **FR-013**: On user signup, the IdP MUST fire a `user.created` webhook that upserts a User record in the Commise database. The User record uses an app-generated ULID as the primary key (`id`); the IdP's `user.id` is stored as `identity_id` (secondary key, unique).
- **FR-014**: The `user.created` webhook handler MUST also create an Account record and a Profile record associated with the new User, atomically.
- **FR-015**: The app-generated ULID is the canonical Commise user identifier. It is available in all IdP access tokens via the `app_user_id` custom claim (injected by the authorizer after resolving the user from the database). No `app_metadata` writeback is required for the `identity_id` — it is stored in the database and injected by the authorizer.
- **FR-016**: The `user.created` webhook handler MUST retry database writes on transient failures (up to 3 attempts with exponential backoff).
- **FR-016a**: All webhook handlers MUST validate the incoming payload against a Zod schema at the entry point, before any business logic or database operations. Invalid payloads MUST receive a `400 Bad Request` response (not 500), and the handler MUST log the validation error with the full payload (sanitized of PII such as email addresses and phone numbers). A CloudWatch metric MUST be emitted for each validation failure to alert the ops team of potential IdP contract drift.
- **FR-017**: A reconciliation mechanism MUST exist to detect IdP users without corresponding Commise database records and create the missing records.
- **FR-017a**: Webhook handlers MUST be idempotent and resilient to out-of-order delivery. The `user.updated` handler MUST use upsert semantics — create the User record if it does not exist before applying the update. The `user.deleted` handler MUST be a no-op if the User record does not exist (idempotent deletion).

**Profile and Account Management**

- **FR-018**: System MUST provide a profile page that displays the authenticated user's information (display name, email, avatar, account creation date) sourced from the Commise database.
- **FR-019**: System MUST provide an account edit page where users can update their display name and avatar. Changes MUST be persisted to the Commise database.
- **FR-020**: The account edit page MUST display email as read-only. Email changes MUST be handled through the IdP's email change flow.
- **FR-021**: System MUST validate account edit inputs: display name MUST NOT be empty, MUST be between 1 and 50 characters, and MUST NOT contain only whitespace; avatar uploads MUST be limited to JPEG, PNG, or WebP formats and a maximum file size of 5 MB.

**Account Deletion**

- **FR-022**: System MUST provide an account deletion flow that requires explicit user confirmation (typing "DELETE" to confirm).
- **FR-023**: On confirmed deletion, the system MUST delete the User record and associated Account record from the Commise database.
- **FR-024**: On confirmed deletion, the system MUST delete the user from the IdP via the IdP Backend API. If the IdP deletion fails, the system MUST proceed with the local database deletion and queue the IdP deletion for automatic async retry (exponential backoff, maximum 5 attempts). The user MUST NOT be blocked by IdP API failures.
- **FR-025**: Account deletion MUST hard-delete purely private data (meal plans, grocery lists, nutrition plans, AI provider configs, agent authorizations). Collaborative content (recipes, comments on other users' content, shared meal plans) MUST be anonymized rather than deleted — the user's display name becomes "[deleted]", avatar is removed, email is scrubbed, but the content remains visible to preserve community integrity. If a recipe has no collaborative value (zero comments, zero bookmarks, never shared), it MAY be hard-deleted at the application's discretion.
- **FR-026**: After successful deletion, the system MUST clear all local tokens and return the user to the authentication screen.

**Password Reset**

- **FR-027**: System MUST provide access to the IdP's password reset flow from the login screen via a "Forgot Password" link.
- **FR-028**: The password reset flow MUST be handled entirely by the IdP — the Commise backend MUST NOT store, process, or have access to user passwords.

**Social Account Linking**

- **FR-032**: System MUST provide APIs for linking a social identity provider account (e.g., Google) to an existing Commise user account.
- **FR-033**: System MUST provide APIs for unlinking a previously linked social identity provider account from a Commise user account.
- **FR-034**: Linking/unlinking operations MUST be handled via the IdP Backend API. The Commise backend MUST NOT store social provider credentials or tokens.

**API Authorization**

- **FR-038**: All Commise API endpoints MUST require a valid IdP access token. Requests without a valid token MUST receive `401 Unauthorized`.
- **FR-039**: The API Gateway authorizer MUST validate IdP JWT tokens (signature, expiration, audience, issuer) on every request.
- **FR-040**: The access token MUST include the `app_user_id` custom claim (app-generated ULID), enabling the API to identify the requesting user without an additional database lookup.

**User Suspension**

- **FR-041**: The system MUST support suspending a user by both blocking the user in the IdP (via the Backend API) and setting the User entity `status` to `suspended` in the Commise database.
- **FR-042**: The API Gateway authorizer MUST deny access (return `403 Forbidden`) to users whose `status` is `suspended`, even if the access token is otherwise valid.
- **FR-043**: A suspended user who attempts to log in MUST be shown a clear message indicating their account has been suspended.
- **FR-044**: The system MUST support reactivating a suspended user by unblocking them in the IdP and setting the User entity `status` back to `active`.

**Impersonation Guardrails**

- **FR-036**: System MUST log all impersonation actions (who initiated, target user, timestamp, action taken) to an immutable audit log.
- **FR-037**: System MUST restrict impersonation initiation to users with explicit admin role permissions. Non-admin users MUST receive `403 Forbidden` when attempting impersonation.

### Non-Functional Requirements _(constitution-derived)_

- **NFR-001**: All TypeScript code in auth-related workspaces MUST compile with `strict: true`; no `any` used outside explicitly marked test doubles. IdP SDK types, token interfaces, and API response types MUST use strict typing with `interface` for data shapes and `type` for unions/aliases. (Constitution Principle I)
- **NFR-002**: All exported functions, classes, interfaces, type aliases, and interface fields in auth-related code MUST carry JSDoc block comments. Auth middleware, token refresh handlers, and webhook handlers MUST include `@param`, `@returns`, and `@throws` tags. (Principle II)
- **NFR-003**: All imports within auth-related workspaces MUST use aliased paths (`@kitchensink/*`, `@kitchensink/*`, `@kitchensink/<pkg>`) with `.js`/`.jsx` extensions. No `helpers/` directories. (Principle III)
- **NFR-004**: All auth-related UI components (login screens, profile page, account edit page, deletion confirmation dialog) MUST expose accessible names queryable via `getByRole`/`getByLabel` in Playwright tests. `data-testid` is prohibited. (Principles IV & VII)
- **NFR-005**: Auth status indicators (logged in, logged out, session expired) MUST NOT rely on color alone. Each status MUST be paired with a text label or icon. (Principle VII)
- **NFR-006**: Any new auth-related workspace MUST be registered in the root `package.json` workspaces array and MUST extend `@kitchensink/typescript`, `@kitchensink/eslint`, `@kitchensink/prettier`, and `@kitchensink/vitest` configs. (Principle V)
- **NFR-007**: All auth-related code MUST pass `turbo run typecheck`, `turbo run lint`, and `turbo run format:check` with zero errors before merge. (Principle VI)
- **NFR-008**: Tests MUST conform to the testing pyramid: >= 70% unit, <= 20% integration, <= 10% E2E. Each test file MUST open with a block comment mapping requirement IDs (FR-xxx) to test case descriptions. (Principle IV)
- **NFR-009**: Custom errors (e.g., `AuthSessionExpiredError`, `UserNotFoundError`, `AccountDeletionFailedError`) MUST extend `Error` and MUST expose a type guard (`isXxxError(e: unknown): e is XxxError`). (Principle I)
- **NFR-010**: All date fields in auth-related interfaces (e.g., `createdAt`, `lastLoginAt`, `tokenExpiresAt`) MUST be ISO 8601 strings, never `Date` objects. (Principle I)
- **NFR-011**: The login/signup UI MUST consume design system tokens (`--accent-primary`, `--accent-secondary`, semantic status colors) from the shared token set. Hard-coded color values in component styles are prohibited. (Principle VII)

**Performance Targets**

- **NFR-011a**: Commise's own auth-related API operations MUST meet the following latency targets: silent token refresh endpoint ≤ 500ms P99, profile data endpoint ≤ 1s P99, webhook processing (from API Gateway receipt to database write) ≤ 2s P99. These targets apply only to Commise-controlled operations; IdP-hosted login page load times are explicitly out of scope.

**Observability**

- **NFR-012**: All auth-related backend functions (login callback, token refresh, `user.created` webhook handler, account deletion, reconciliation job) MUST emit structured logs following standard AWS logging patterns (JSON format, correlation IDs, ISO 8601 timestamps). CloudWatch Logs MUST be configured as the log sink. No IdP-proprietary logging SDKs should be used for backend log shipping.
- **NFR-013**: CloudWatch Logs MUST drain to Sentry for centralized error tracking and alerting. All unhandled exceptions and explicit error events in auth flows MUST surface as Sentry issues with full stack traces and request context.
- **NFR-014**: Auth flows MUST emit CloudWatch custom metrics: login success/failure count, token refresh success/failure count, signup success/failure count, account deletion success/failure count, reconciliation job runs/repairs/failures. Metrics MUST use standard CloudWatch namespaces and dimensions (per-environment, per-platform).
- **NFR-015**: Client-side auth errors (failed login attempts, token refresh failures, session expiry events) MUST be captured by the Sentry client SDK with breadcrumbs for the preceding auth state transitions.
- **NFR-016**: Distributed tracing MUST be enabled across auth flows — from client request through API Gateway authorizer to backend handlers. Trace IDs MUST propagate via standard AWS X-Ray or OpenTelemetry headers.
- **NFR-017**: The observability architecture MUST allow future integration of LogRocket (session replay) and NewRelic (or equivalent APM) without requiring changes to application logging or metrics instrumentation.

### Key Entities

- **User**: Represents a registered Commise user stored in our database. Key attributes: `id` (ULID, e.g., `01ARZ3NDEKTSV4RRFFQ69G5FAV` — the canonical identifier across all Commise systems, app-generated at signup), `identity_id` (the IdP's `user.id`, e.g., `user_abc123` — secondary key, unique, used only for IdP Backend API calls), `email` (synced from the IdP via `user.created` webhook), `name` (display name, nullable), `picture` (avatar URL, nullable), `status` (enum: `active` | `suspended` — default: `active`; suspended users are blocked in the IdP and denied API access; status is managed by backend admin operations), `createdAt` (ISO 8601), `updatedAt` (ISO 8601), `deletedAt` (ISO 8601, nullable — soft-delete marker). The User entity is the owner of all user-generated content (recipes, meal plans, etc.) and is the target of the cascade delete on account deletion. This entity fulfills Commise FR-045 ("System MUST require user authentication for all features").

- **Account**: Represents the account/profile details associated with a User. Key attributes: `id` (UUIDv4), `userId` (foreign key to User — stores the User's ULID `id`), `subscriptionTier` (free | premium — default: free, managed by subscription feature), `createdAt` (ISO 8601), `updatedAt` (ISO 8601). The Account entity is created alongside the User during signup and deleted alongside the User during account deletion. It provides the extension point for subscription management (Commise FR-040/FR-041) without overloading the User entity.

- **Profile**: Represents the user's public-facing profile. Key attributes: `id` (UUIDv4), `userId` (foreign key to User — stores the User's ULID `id`), `displayName` (user-editable), `avatarUrl` (nullable — pre-signed S3 URL to the media bucket; updated after successful upload via T-032b), `bio` (nullable), `updatedAt` (ISO 8601). Created alongside User and Account during signup.

- **AuthSession**: Represents the client-side authentication state (not a database entity). Key attributes: `accessToken` (JWT), `sessionToken` (opaque string for silent renewal), `expiresAt` (ISO 8601 — when the access token expires), `userId` (the app-generated ULID, extracted from the `app_user_id` custom claim by the server/API layer). Stored in platform-specific secure storage (Keychain/Keystore on mobile, httpOnly cookies on web). Lifecycle: created on login, refreshed transparently on access token expiry, destroyed on logout or session token expiry.

- **WebhookEvent**: Idempotency record for processed IdP webhook events. Key attributes: `svixId` (Svix delivery ID — primary key, used to deduplicate retried webhook deliveries), `receivedAt` (ISO 8601).

## API Contract & Input Validation (GR-015 / GR-016)

> This section **applies existing portfolio rules to 002's own packages** and **mints no new FR numbers**
> (GR-003), the way 011/012/013/014 do. 002 already carries GR-016-adjacent requirements — **FR-016a** (webhook
> payload zod validation), **FR-021** (account-edit validation), **FR-039** (authorizer token validation) — so
> this section **cites** them rather than duplicating them. Where [`plan.md`](./plan.md) already decided
> something, the decision is cited, not re-made; where the plan carries an unresolved 🟠 OPEN, it is **carried
> forward unanswered**. Every count was measured against the tree on **2026-08-12**.

### Contract ownership (GR-015)

_The service authors it; clients declare nothing._

**Normative sources**: [`docs/CODING_STANDARDS.md` §15](../../docs/CODING_STANDARDS.md) ·
[`GR-015`](../governance-rules.md#gr-015-api-contract-ownership) ·
[`GR-017`](../governance-rules.md#gr-017-contract--validation-conformance-for-every-new-service-client-and-app) ·
[ADR-0014](../../docs/architecture/decisions/0014-service-owned-api-contracts.md). Full bindings:
[`plan.md` → _API Contracts — ownership and drift_](./plan.md#api-contracts--ownership-and-drift-gr-015).

| Role                                                            | Binding for 002                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Owning service (**authors** the zod)                            | `@kitchensink/identity-service` — `packages/services/identity/src/**/*.schema.ts` (5 wire files: users, avatar, admin, api-error, health)                                                                                                                                                                                                                    |
| Second deployable in scope                                      | `@kitchensink/identity-webhooks` — the Lambda handlers; the **inbound** Clerk payload is third-party (§15-d below), the webhook's own **response** is ours                                                                                                                                                                                                   |
| Schema package (**GENERATED and committed; never hand-edited**) | `@kitchensink/schema-identity` — `packages/schemas/identity`. ⚠️ **It now EXISTS** (5 copied schema files; `openapi.yaml` **760 lines, 10 paths** — re-measured 2026-08-12, correcting **716** from the day before; a generated document's line count moves, so `wc -l` it rather than quoting), so the plan's "does not exist yet" status note is **stale** |
| Consuming app / feature packages                                | `ProfileServiceClient` in `@commise/features-account` (`src/profileServiceClient.ts`); `@commise/web` (`src/lib/identityServiceClient.ts`); `@commise/mobile` (`src/services/api.ts`)                                                                                                                                                                        |
| Domain types (a **different** axis, GR-007)                     | `@kitchensink/identity-core` — reused `import type`, **never re-declared** inside the schema package                                                                                                                                                                                                                                                         |

**The service MUST** author every request/response shape of `/api/v1/users/*`, `/api/v1/profile/*`,
`/api/v1/accounts/*` and `/api/v1/admin/*` as **zod in the identity service**, at `src/**/*.schema.ts` beside
the controller it serves; **validate its own requests with that same zod** via `nestjs-zod`'s `createZodDto`;
and keep every `*.schema.ts` importing **only `zod` and other `*.schema.ts` files** — no drizzle schema, no DAO
type, no Nest symbol. `@kitchensink/schema-identity` is a committed **COPY** of that zod — not a
transformation, because zod schemas are runtime values and cannot be derived from themselves, and every package
here exports raw `./src/*.ts` so there is no bundle-into-`dist` path. It exports the **zod**, the **`z.infer`
types**, a **`CONTRACT_HASH`**, a **barrel**, and a **DERIVED `openapi.yaml`** — outbound only, for `oasdiff`,
docs and integrators, and **never a codegen input** (routing types through JSON Schema loses `readonly`,
branded and template-literal types and flattens discriminated unions).

⚠️ **`packages/services/identity/src/types` is NOT the contract package and must not become one.** A consumer
reaching into the service package is ADR-0014's rejected alternative 2 — it drags NestJS, drizzle and the AWS
SDK into web and mobile, inverts the build order, and hands a client a legitimate-looking path to a DAO type.

**The CLIENT's obligation — separately mandatory.** Mandating only the service half is exactly how the client
half got skipped portfolio-wide, behind green builds. 002's consumer is an **app-feature** package rather than
a `packages/clients/*` leaf, and GR-015 §15-b.4 binds it **identically** — the rule is about who authors a wire
shape, not which directory it lives in.

- Every consumer imports its wire **types AND its runtime zod** from `@kitchensink/schema-identity` and
  **declares no request or response body shape of the identity service** — including **type-only**, and
  including inside `packages/apps/**` (GR-017 §17-b.1). `DeleteAccountResult` and every profile/account
  response shape are **wire** shapes and belong to the schema package; what may remain in the consumer is
  genuinely client-side — base URL and fetch config, `TokenSource`, request options, its own error shapes.
- A divergent consumer shape (a settings form model, a redacted profile view) is **DERIVED** with
  `Pick` / `Omit` / `Partial`, never independently declared. Reference implementation:
  `packages/apps/commise/features/recipes/src/filters/model.ts`.
- **Responses are validated ON RECEIPT by the consumer**, at the moment the body arrives (GR-016 §16-c.3).
- **A new identity endpoint is not complete until its types are reachable from the schema package.** "The
  settings screen will add the type" is a **contract fork**, not a task.

🟠 **OPEN — carried forward from [`plan.md`](./plan.md), NOT answered here: where does the identity consumer
live?** GR-015 assumes a `packages/clients/<service>` leaf and 002 has none (verified 2026-08-12:
`packages/clients/` holds `food-service`, `recipe-service`, `usda` only). Two shapes satisfy §15-b:
**(a)** introduce `packages/clients/identity` and have `@commise/features-account` wrap it, or
**(b)** have the app-feature packages import `@kitchensink/schema-identity` directly and remain the only
consumers. Neither §15 nor an ADR decides it and it is not derivable, so it stays an owner question. Note the
measured consequence of leaving it open: the consumer surface is currently **three packages**, not one, so
option (b) is the status quo by default rather than by decision.

**CLIENT WORK IS ITS OWN DELIVERABLE, with its own tasks** (GR-017 §17-e.12): the schema package, the typed
consumer, response validation **on receipt**, and a **contract-skew guard** are tasks in
[`tasks.md`](./tasks.md) — not consequences of finishing the service. ⚠️ Measured 2026-08-12, identity's skew
guard lives on the **service** side (`src/contract/contract-skew.ts`); the **client-side** guard pattern exists
only at `packages/clients/{food-service,recipe-service}/src/contractSkew.ts`, so 002's consumer half of §17-b.5
is unbuilt and depends on the OPEN above.

**Drift gates** — inherited from GR-015 §15-c, all three required, none reinvented here:

1. **Rebuild (turbo):** `$TURBO_ROOT$`-anchored **`inputs`** covering
   `packages/services/identity/src/**/*.schema.ts`. ⚠️ **`inputs`, NOT `dependsOn`** — a `dependsOn` edge closes
   the cycle `client → schema → service → client` (`recipe-service` devDepends on its own client) and turbo
   rejects the graph. Ordering was never the requirement: the generated files are committed, so `build` only
   compiles what is on disk. What is needed is **cache invalidation** when an authored schema changes.
2. **Correctness (CI):** regenerate and fail on any diff against the committed artifacts — the strong gate, and
   the only one that catches a hand-edited generated file.
3. **Skew (runtime):** the `CONTRACT_HASH` **boot assertion** (`src/main.ts` + `src/contract/contract-skew.ts`,
   ordered by `src/contract/__tests__/main-boot-order.test.ts`). This is the gate that matters most on 002:
   identity is the one service every **already-shipped mobile binary** must keep talking to, and neither the
   turbo layer nor CI can see a deployed service running ahead of a released binary's pinned schema.

⚠️ `oasdiff breaking` is worth adding with its blind spot stated: `@nestjs/swagger` emits **no response
schema** for a handler returning an `interface`, so until every response type is zod-derived that check cannot
see response changes — most of what actually breaks a client.

⛔ **THE THIRD-PARTY EXCEPTION (GR-015 §15-d) — Clerk is the opposite case, and converging it deletes 002's
most exposed boundary.** Clerk is **not one of ours**: we do not serve its API, we cannot author its types, and
its contract can change without telling us. So **all four** of these are governed by §15-d, not §15-b:

- **Session-token claims** verified in `@kitchensink/clerk-verify` / `ClerkAuthService` (FR-039's surface).
- **`azp`**, checked against `CLERK_AUTHORIZED_PARTIES` / the anchored `CLERK_AZP_PATTERN`.
- **`public_metadata`** scope/permission extraction, which feeds **authorization** decisions.
- **The inbound svix-verified webhook payload** at `POST /api/v1/webhooks/users`
  (`user.created` / `user.updated` / `user.deleted`) — **Clerk's** shape, not ours.

Each **validates the raw upstream shape at the boundary with its own zod** (identity-webhooks authors
`src/common/idp-payload.schema.ts` for exactly this), **MAY declare its own types**, and **gets NO OpenAPI
document**. None of those shapes enters `@kitchensink/schema-identity` as though we owned it. `packages/clients/usda`
is the portfolio's reference implementation and its `schemas.ts` must **never** be "converged" — doing so
replaces a checked parse with unchecked trust in a remote party's JSON, which is a **security regression, not a
cleanup**. On this feature that parse stands between an **unauthenticated public endpoint** and the identity
database.

### Input validation — where that zod RUNS (GR-016 / GR-018 / GR-019)

**Normative sources**: [`docs/CODING_STANDARDS.md` §15.4](../../docs/CODING_STANDARDS.md) ·
[`GR-016`](../governance-rules.md#gr-016-input-validation-at-every-boundary) ·
[`GR-018`](../governance-rules.md#gr-018-one-rejection-path-and-invalid-input-is-never-retried) ·
[`GR-019`](../governance-rules.md#gr-019-identifier-integrity--no-sentinels) ·
[ADR-0015](../../docs/architecture/decisions/0015-input-validation-at-every-boundary.md). Full bindings:
[`plan.md` → _Input validation_](./plan.md#input-validation--where-the-authored-zod-runs-gr-016). The section
above decides **who authors** the contract; this one is where it **runs**. It adds no FR (GR-003) — FR-016a,
FR-021 and FR-039 already state the requirements; GR-016 states where they execute.

- **⛔ 002 holds the case that proves why this rule exists: a route that looked validated and validated
  nothing.** Under Nest's **own** built-in `ValidationPipe`, a `createZodDto` DTO **validates nothing while every
  visible signal says it does** — the schema is present, the DTO is referenced, the route reads as validated. It
  happened on **`PATCH /users/me`**, a route that **writes user data** (FR-021's surface). The identity service
  registers **`nestjs-zod`'s** pipe, and because the failure is invisible in review the **only** proof is a test
  that posts a **known-bad body to the real route** and asserts the `400`.
- **One mechanism, one `400`.** ⚠️ **Re-measured 2026-08-12: identity has 11 `ZodValidationPipe` references and
  **10** classes extending `createZodDto` across **6** files, with ZERO `class-validator` imports** — correcting the
  "6 / 6 (8 `extends`) … up from 3/4" this bullet carried, which has now been superseded twice in two days.
  ⛔ **Stop quoting the number and run the count** — adoption is still climbing, and `ZodValidationPipe` coverage over
  every controller is asserted repo-wide by **G5** in
  `packages/infra/global/__tests__/service-security-invariants.test.ts`, which is the durable statement. Identity is
  genuinely on **one** mechanism, and ✅ so is `recipe-service` now — the "still has one `class-validator` importer"
  clause here is **corrected**: that importer is converged and the dependency is removed from its `package.json`
  and `prod.package.json`. Every `/api/v1/users/*`, `/api/v1/profile/*`, `/api/v1/accounts/*` and
  `/api/v1/admin/*` input —
  body, path params, query params and any header a handler reads — goes through it. No second DTO framework, no
  per-method `safeParse`.
- **`z.strictObject()` for every mutating request body** — the portfolio default, ruled 2026-08-12 in GR-017
  §17-c, which **closes OPEN-GR-016-B** (the plan still records it as OPEN; it is not). Plain `z.object()`
  survives only on a **read** surface with a **documented forward-compatibility reason at the schema**. The
  ruling picks the failure that is **visible**: on a profile update, a silently stripped misspelled field
  returns `200` for a write that never happened. ✅ Measured 2026-08-12 this is already true where it matters —
  `patchUserMeRequestSchema` (`src/users/users.schema.ts`) is `z.strictObject`, and it is the one mutating body
  identity serves.
- **⛔ THE STORAGE FLOOR.** Every input field writing a bounded column is validated at least as strictly as that
  column can store — FR-021's 1–50-character display name, the avatar's JPEG/PNG/WebP + 5 MB limits,
  `status` (`active` | `suspended`) as an enum domain, and nullability on `name` / `picture` / `bio`.
    - ⚠️ **This is an ASSERTION between two independently authored artifacts, NEVER a derivation.** Zod is
      **not** generated from drizzle and a `*.schema.ts` **never imports a storage type** — GR-015 §15-a.5 is
      unchanged by this rule. Enforcement is the per-service parity test GR-017 §17-d requires, and it **exists**:
      `packages/services/identity/src/types/schema/__tests__/storage-capacity.test.ts`, over shared machinery in
      `@kitchensink/contract-gen` (`src/storage-capacity.ts`). It **may** import both artifacts because a test is
      not a wire schema; it **derives** the bounded-column set from the drizzle tables via
      `collectBoundedColumns` rather than typing it out, and requires a stated `why` for each exemption — which is
      what makes it exhaustive over **columns** rather than over today's known defects.
    - ⚠️ **A floor is not a target.** Identity's one bounded column is `users.email` (`varchar(320)`), and it is
      populated from a **verified** token claim or the signed webhook, never from a request body — so it is
      exempted **with that reason recorded**, not silently. Everything else is PostgreSQL `text()`, i.e.
      **unbounded**, so FR-021's 1–50 display-name limit is a **product decision 002 owns** with no floor to
      derive from. "The column allows it" is not an argument.
- **Non-HTTP ingress this feature owns, enumerated** (a Nest pipe reaches none of them): the **svix webhook**
  `POST /api/v1/webhooks/users`, plus `deletion-worker` (SQS retry payload, authored zod at
  `src/common/deletion-queue.schema.ts`), `reconciliation`, `erasure-reconciliation`, `tombstone-sweep`,
  `log-forwarder` and `migrate`. Each parses its event against an authored zod before acting on it — a
  **scheduled** invocation included, because "ours" is an assumption about a deploy that has already drifted
  once.
- **⚠️ The svix signature proves ORIGIN, not SHAPE — both checks, in that order, never one instead of the
  other.** FR-016a already requires the payload parse; GR-016 §16-b is why the signature does not substitute for
  it. A correctly signed Clerk payload whose fields moved, went null, or gained a member is still an
  **unvalidated body being written to the identity database**.
- **⛔ ONE rejection path, and an invalid payload is NEVER retried (GR-018) — and for svix that means answering
  `2xx`.** This is the half a contributor gets backwards on instinct, so it is stated explicitly rather than
  left to FR-016a's `400`:
    - **One path, one shape, the cause in a `reason` field.** A signature failure and a shape failure are
      **equally invalid**; they differ only in `reason`. Two behaviours means two error contracts and — measured
      repeatedly in this repo — one of the two ends up without a counter. ✅ Implemented:
      `rejectInvalidWebhook` in `packages/services/identity-webhooks/src/common/handler-pipeline.ts` is a single
      function taking `reason: 'shape' | 'signature'`, with a per-`reason` metric dimension
      (`IdentityWebhookRejected`).
    - **svix retries on ANY non-2xx**, so returning `400` for an invalid body **requests** exactly the retry
      storm GR-018 §18-b forbids: each attempt fails identically, forever. A **shape** rejection is therefore
      answered **`2xx`**, with the rejection recorded in the **response body**, in **structured logs** with its
      `reason`, in a **per-`reason` counter**, and **alarmed** on that counter — because a rejection nobody sees
      is indistinguishable from success. **Reject the content, accept the delivery.**
    - ⚠️ **This does NOT generalize to our own callers.** Identity's own HTTP API returns the `400`/`403` GR-016
      §16-a.3 requires, and the erasure fan-out's callees do too: those callers do not blind-retry, and a `2xx`
      would hide a real integration bug from the party able to fix it.
    - ✅ **Both of the "measured gaps" this bullet recorded are CLOSED — re-measured 2026-08-12.** Kept rather
      than deleted, because each was a real reading of the tree and the resolution is the useful part.
        - **(i) The `shape → 200` / `signature → 401` tension is RULED, not open.** GR-018 §18-a now carries the
          reason→status table outright: "one behaviour" means one **PATH** and one **shape**, **not** one status,
          and the status comes from a **single complete lookup** so adding a reason cannot compile until its retry
          disposition is decided. `WEBHOOK_REJECTION_STATUS` is that lookup and is the rule's own **reference
          implementation** — ⛔ so do **not** "align" it in either direction. §18-a's Violation list is explicit
          that two statuses from one complete lookup is **not** a violation, while returning `2xx` for a
          **signature** failure is the more expensive one of the two inversions.
        - **(ii) The `IdentityWebhookRejected` counter IS alarmed.** This bullet previously said "no alarm is
          defined on it … alarms only on `ErasureIncomplete`", which was true when measured and is not now:
          `packages/services/identity-webhooks/infra/lib/webhooks-stack.ts` defines
          **`WebhookShapeRejectionAlarm`** and **`WebhookSignatureRejectionAlarm`**, both dimensioned per
          `reason`, alongside `ErasureIncompleteAlarm`. §18-c.4 / AC-018-f are **met**. ⚠️ Two alarms, not one
          dimensionless one, is the point — a signature-rejection threshold has to be set independently, because
          this endpoint is public and receives internet background scanning.
- **⛔ A rejected event is NOT recorded as a row (GR-018 §18-d), and that is GR-019's doing.** An invalid payload
  has **no trustworthy identifier**, and `webhook_events.identity_id` is `text NOT NULL` (migration
  `0006_webhook_idempotency.sql`, made `NOT NULL` by `0007_webhook_events_ttl.sql` after backfilling
  `'unknown'`). Recording a rejected event there would force a **sentinel** — which **GR-019 forbids
  outright**. This is not hypothetical on this feature: a former `?? 'unknown'` **did** write that string into
  `identity_id`, a column other code joins on. The rejection lives in **logs, counters and the DLQ**, which are
  therefore **load-bearing**, not a consolation prize.
- **Identifiers are never sentinels (GR-019).** `id` (ULID), `identity_id` (Clerk `sub`) and `svixId` are typed
  **required** wherever consumed — never optional-with-a-default, never `'unknown'`, `''`, `'none'` or `0`,
  including as a map key, a metrics dimension or a branch condition. The **only** paths where an absent id is
  permitted are **create/upsert**: signup's read-through provisioning and the `user.updated` upsert (FR-017a),
  where the app `id` is **generated** as a ULID. An unresolvable principal is a **rejection**, never a default —
  and when the id is a principal, defaulting it means the **authorization decision was made by a string
  literal**.
- **Service-to-service, both directions — identity is the CALLER on the erasure fan-out.**
  `packages/services/identity-webhooks/src/common/erasure-fanout.ts` posts
  `POST /api/v1/internal/account/erasure` to **recipe and food**. The outbound body is validated against the
  **callee's** schema-package zod **before the call** (GR-016 §16-c.2), and each response is validated **on
  receipt** — a fan-out that silently mis-reads a partial failure is how an erasure is reported complete when it
  is not.
- **⛔ Server-side RESPONSE validation is DEFERRED by owner decision (GR-016 §16-g) and MUST NOT be
  "completed".** Identity validates none of the bodies it **emits**, deliberately. Say which one you mean
  (GR-017 §17-f): a **consumer** parsing what it **received** is REQUIRED and is what the client half above
  mandates; a **producing service** parsing what it **emits** is the deferred one. Reversing the deferral needs
  its own proposal under the governance amendment process.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can complete the signup flow (from app launch to authenticated home screen) in under 60 seconds on both mobile and web.
- **SC-002**: Returning users with a valid session token are authenticated and see app content within 3 seconds of app launch (no login screen displayed).
- **SC-003**: Token refresh succeeds transparently (no user-visible interruption) for 99.9% of refresh attempts when the session token is valid.
- **SC-004**: Account deletion completes (both Commise database and IdP) within 30 seconds of user confirmation.
- **SC-005**: The profile page loads and displays all user data within 2 seconds of navigation.
- **SC-006**: 100% of API requests without a valid access token receive `401 Unauthorized` — zero unauthenticated access to protected endpoints.
- **SC-007**: The authentication system supports 10,000 concurrent authenticated users without performance degradation (aligns with Commise SC-009).
- **SC-008**: Password reset emails are delivered by the IdP within 60 seconds of the user's request.

## Assumptions

- **A-001**: The identity provider (IdP) is the sole authentication authority. All credential management (password storage, social identity linking) is handled by the IdP. The Commise backend never stores or processes passwords.
- **A-002**: The IdP application is pre-configured with the required application settings, API audience, social connections (Google at minimum), and webhook endpoints before this feature is implemented.
- **A-003**: The mobile app uses `@clerk/expo` (with `expo-secure-store` for token caching) for the native auth flow. The web app uses `@clerk/nextjs` for session management.
- **A-004**: The app-generated ULID is the canonical identifier used across all Commise systems. The IdP's `user.id` is stored as `identity_id` (secondary key) and is used only for IdP Backend API calls.
- **A-005**: The IdP's free or Pro tier provides sufficient capacity for initial development and launch. Rate limits on the Backend API (e.g., for account deletion) are handled with retry logic.
- **A-006**: The Commise database (PostgreSQL, per the USDA spec's architecture) stores User, Account, Profile, and WebhookEvent records. No separate auth database is required.
- **A-007**: IdP `user.created` webhooks are delivered with at-least-once semantics. The `webhook_events` table (keyed on Svix delivery ID) provides idempotency.
- **A-008**: Session persistence relies on IdP session tokens. The Commise backend does not maintain its own session store.
- **A-009**: The shared API Gateway authorizer referenced in USDA spec FR-035 is the IdP JWT authorizer implemented by this feature. This feature provides the authentication layer that both Commise and USDA food data endpoints depend on.
- **A-010**: Account deletion is a hard delete, not a soft delete. All user data is permanently removed from the Commise database. IdP user deletion is permanent and irreversible.

## Clarifications

### Session 2026-05-29

- Q: How should duplicate and concurrent IdP webhook events be handled? → A: Optimistic locking + deduplication — use `webhook_events` table (keyed on Svix delivery ID) to deduplicate, and DB unique constraints on `identity_id` to prevent duplicate user creation. Concurrent `user.updated` events are last-write-wins.
- Q: Where should avatar uploads be persisted? → A: S3 media bucket with pre-signed URL access.
- Q: What JWT custom claim key carries the canonical Commise user ID? → A: `app_user_id` (flat top-level claim) — used by the authorizer and injected into all downstream requests.
- Q: How should public webhook endpoints be protected against abuse? → A: API Gateway request throttling is active immediately. AWS WAF WebACL with rate-based rules is provisioned in the CDK but not associated (count-only mode) until traffic justifies the ~$6–10/mo cost. Svix signature verification remains the primary authentication mechanism.
- Q: How should brute force protection be handled for login attempts? → A: Delegate entirely to the IdP's native brute force protection (bot detection, per-email rate limiting, CAPTCHA escalation, lockouts). Application layer does not implement its own login attempt rate limiting or lockout logic.
- Q: What happens to active sessions when a user is suspended or deleted? → A: On suspension, all active IdP sessions are revoked immediately via the IdP session revocation API. On deletion, the IdP removes the user so all tokens become invalid naturally. The backend returns `403 Forbidden` with a `TokenRevoked` error code for API calls from suspended users, and client SDKs intercept this to force re-authentication.
- Q: What should happen to collaborative content (recipes, comments, shared data) when a user deletes their account? → A: Collaborative content is anonymized, not deleted — display name becomes "[deleted]", avatar removed, email scrubbed, but content remains visible. Purely private data (meal plans, grocery lists, etc.) is hard-deleted.
- Q: Should performance targets be set for auth flows? → A: Yes — targets apply only to Commise-controlled operations: token refresh API ≤ 500ms P99, profile API ≤ 1s P99, webhook processing ≤ 2s P99. IdP-hosted login page load times are out of scope.
- Q: How should the silent token refresh be triggered? → A: Reactive — refresh only when an API call returns `401 Unauthorized` due to token expiry. The client request interceptor MUST retry the original failed request after successful refresh. Proactive refresh before expiry is NOT required.
- Q: What should happen when a user's session expires during active use (e.g., typing a recipe)? → A: Show a non-blocking warning banner 5 min before expiry with a "Keep me signed in" button that triggers silent refresh. If ignored, preserve unsaved form state in `localStorage` as a draft, redirect to login, and auto-restore after re-authentication.
- Q: How should out-of-order webhook delivery be handled (e.g., `user.updated` arriving before `user.created`)? → A: `user.updated` handler uses upsert semantics — creates User if missing before applying update. `user.deleted` is idempotent no-op if User doesn't exist. All handlers must be order-agnostic.
- Q: How should webhook payload schema validation be handled? → A: Strict Zod schema validation at the entry point. Invalid payloads → `400 Bad Request` (not 500) + logging + CloudWatch metric alert. Valid payloads proceed to handler logic.
- Q: What are the startup capacity and autoscaling guidelines for the auth infrastructure? → A: **Day-one**: 100 DAU, peak 10 req/s, 1 webhook/s. Infrastructure = single `db.t4g.micro` RDS, 256MB Lambda, 1 ECS task (`t4g.micro`). Monthly cost target ≤ $75. **Day-30**: 500 DAU, peak 50 req/s, 5 webhooks/s. Trigger: avg CPU > 70% for 10 min. **Day-90**: 1,500 DAU, peak 200 req/s, 20 webhooks/s. ECS to `t4g.medium`, RDS to `db.t4g.small`, Lambda to 512MB. No blue/green deploys; database migrations happen during low-traffic windows. All infrastructure changes are applied via code-first CDK, not manual Console changes. The `db.t4g.micro` → `db.t4g.small` migration is a `terraform plan` equivalent (CDK diff) reviewed and approved before apply.
- Q: What is the data retention policy for user PII in the Commise database? → A: User PII (email, name, avatar URL) is retained for the lifetime of the account plus a 30-day grace period after hard deletion (de-anonymization window). After 30 days, the data is permanently deleted. Webhook event logs (for debugging) are retained for 90 days then purged. Identity IDs (secondary keys) are permanently retained (anonymized) for referential integrity.

### Session 2026-04-14

- Q: When DB deletion succeeds but IdP deletion fails, what should happen? → A: Proceed with local deletion, queue IdP deletion for automatic async retry (Option B — eventual consistency).
- Q: What level of observability should auth flows have? → A: Full — structured logging + CloudWatch metrics + distributed tracing + Sentry (error tracking via CloudWatch log drain + client SDK). Future LogRocket/NewRelic integration must be supported without app changes. Follow standard AWS logging/monitoring patterns.
- Q: Should the user lifecycle support a "suspended" state? → A: Yes, dual mechanism — IdP native "block user" for immediate enforcement + custom `status` field (active/suspended) on User entity for backend tracking and admin tooling.
- Q: What should be explicitly out of scope? → A: Email change flow and admin dashboard for user management. MFA, passkeys, custom sign-in UI, and IdP Organizations are also out of scope.
