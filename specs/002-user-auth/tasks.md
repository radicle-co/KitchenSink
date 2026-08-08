# Tasks: User Authentication

**Feature**: `002-user-auth`
**Updated**: 2026-06-01
**Source**: `spec.md`, `plan.md`, `product-spec/product-spec.md`, `v-model/requirements.md`, `v-model/architecture-design.md`, `v-model/module-design.md`
**Design reference**: [`docs/mockups/`](../../docs/mockups/) — pixel mockups + design system tokens. Per-task `Visual reference:` links point to the matching mockup HTML. Auth flow screens (login/signup/MFA/session-expired/callback) are rendered by **Clerk's hosted UI** and have no app-side mockup.

---

## User Story Reference

| US     | Title                                              | FR Coverage    | Priority |
| ------ | -------------------------------------------------- | -------------- | -------- |
| US-001 | Cross-platform Auth Entry and Callback             | FR-001..FR-005 | P0       |
| US-002 | Secure Session Persistence and Refresh             | FR-006..FR-009 | P1       |
| US-003 | Deterministic Logout                               | FR-010..FR-012 | P1       |
| US-004 | Signup-to-Database Identity Synchronization        | FR-013..FR-017 | P0       |
| US-005 | API Authorization Gate                             | FR-038..FR-040 | P0       |
| US-006 | Profile Visibility and Account Editing             | FR-018..FR-021 | P1       |
| US-007 | Account Deletion with Eventual IdP Consistency     | FR-022..FR-026 | P2       |
| US-008 | Password Reset Entry                               | FR-027..FR-028 | P2       |
| US-009 | Social Provider Linking Lifecycle                  | FR-032..FR-034 | P2       |
| US-010 | Suspended Account Enforcement and Reactivation     | FR-041..FR-044 | P2       |
| US-011 | MFA Enrollment _(OUT OF SCOPE — see spec.md §OOS)_ | FR-029..FR-031 | —        |
| US-012 | Operator Impersonation with Audit Safety           | FR-035..FR-037 | P2       |

---

## Dependency Graph (topology-aligned)

```text
[Phase 0 — Shared Contracts]
T-001 → T-002
  |
  +-→ [Phase 1 — Infra Foundation]
        T-010 → T-011 → T-012 → T-013 → T-014 → T-015
                    |        |        |        |
                    |        |        |        +-→ T-020..T-024 (identity-webhooks lambdas)
                    |        |        +----------→ T-030..T-041 (identity service modules)
                    |        +------------------→ T-050..T-056 (web integration)
                    +-------------------------→ T-060..T-066 (mobile integration)

[Phase 6 — Local Runtime + E2E]
T-070 → T-071 → T-072 → T-073 → T-074 → T-075

[Phase 7 — Hardening + Traceability Closure]
T-080 → T-081 → T-082 → T-083 → T-088 → T-090

[Pre-Impl Review Conditions (parallel after gate)]
T-053 → T-084[P] → T-085[P]
T-053 → T-086[P]
T-021 → T-087[P]
T-030 → T-089[P]
```

**Parallelizable tasks ([P])**: T-001, T-010, T-020, T-024, T-030, T-039, T-040, T-050, T-055, T-060, T-064, T-070, T-081, T-084, T-085, T-086, T-087, T-089

---

## US-001 — Cross-platform Auth Entry and Callback

> Covers FR-001..FR-005: PKCE auth flows, mobile auto-display, web redirect, social login, login redirect preservation.

- [x] **T-001** [P] [US-001] Create shared auth contracts package — `packages/services/identity/src/types/`
    - **Depends on**: —
    - **Implements**: REQ-001, REQ-005, REQ-006, REQ-009, REQ-039, REQ-040, REQ-CN-008, FR-001, FR-005, FR-006, FR-009, FR-039, FR-040, ARCH-001, ARCH-003, ARCH-024, MOD-001, MOD-003, MOD-024
    - Consolidate canonical auth/identity TypeScript types under `packages/services/identity/src/types/`: JWT claims (including custom `app_user_id` claim), authorizer context, session payload contracts. Add `User`, `Account`, `Profile` read/write DTOs used across service + lambdas. Add deletion queue message shape, reconciliation diff payload shape. All consumers import through `@kitchensink/identity-service` (or subpath `@kitchensink/identity-service/types`).
    - **Acceptance**: All dependent packages import shared contracts from `@kitchensink/identity-service`; no duplicated identity contract types.

- [x] **T-050** [P] [US-001] Implement web protected-route middleware and login redirect — `packages/apps/commise/web/src/middleware.ts`
    - **Depends on**: T-030
    - **Implements**: REQ-001, REQ-003, REQ-005, REQ-IF-001, FR-001, FR-003, FR-005, ARCH-001, ARCH-002, MOD-001, MOD-002
    - Configure Next.js IdP middleware/handlers for protected routes. Redirect unauthenticated requests to IdP login.
    - **Acceptance**: Protected web routes always gate through IdP session.

- [x] **T-060** [P] [US-001] Implement mobile auto-auth gate and callback — `packages/apps/commise/mobile/App.tsx`
    - **Depends on**: T-030
    - **Implements**: REQ-001, REQ-002, REQ-005, REQ-IF-002, FR-001, FR-002, FR-005, ARCH-004, ARCH-006, MOD-004, MOD-006
    - Show auth screen automatically when no valid mobile session exists. Handle callback/deeplink token exchange path.
    - **Architecture note (2026-06-02)**: Uses React Navigation (not Expo Router) with `App.tsx` as single entry. `<ClerkProvider>` wraps `<AuthGate>` which conditionally renders `<LoginScreen>` or `<ProfileScreen>` based on authentication state. This satisfies the functional requirement (auto-auth gate + callback) without requiring Expo Router migration. Expo Router migration deferred to future architecture cycle if needed.
    - **Acceptance**: Unauthenticated mobile launch always goes through IdP login.

- [x] **T-080** [US-001] IdP tenant rollout plan (dev/staging/prod) + existing server-side handlers reuse — `specs/002-user-auth/quickstart.md`
    - **Depends on**: T-021, T-014
    - **Implements**: REQ-001, REQ-004, REQ-013..REQ-017, FR-001, FR-004, FR-013..FR-017, ARCH-010, MOD-010
    - Document and apply tenant strategy (`kitchensink-dev/staging/prod`). Confirm existing IdP server-side handlers (vendor webhook triggers) reused from tenant-template and no new handlers authored.
    - **Acceptance**: Tenant config checklist passes for all environments.

- [x] **T-084** [P] [US-001] Create mobile profile wireframe — `specs/002-user-auth/product-spec/wireframes/`
    - **Depends on**: T-053
    - **Implements**: NFR-004, NFR-005, NFR-016
    - Wireframe the mobile profile screen (read + edit + delete). Ensure touch target sizes ≥44×44px, color contrast WCAG 2.1 AA, and screen reader landmarks. Visual reference: [`docs/mockups/screens/screen-profile.html`](../../docs/mockups/screens/screen-profile.html).
    - **Scope note**: Login, signup, MFA, session-expired, and OAuth callback are rendered by Clerk's hosted UI — no app-side wireframe needed.
    - **Acceptance**: Mobile profile wireframe documents happy, loading, error, and empty states with accessibility annotations.

- [x] **T-085** ~~Add loading states to login and signup wireframes~~ — **REMOVED**
    - **Reason**: Login and signup are rendered by Clerk's hosted UI; loading states are owned by Clerk. No app-side work required.
    - **Replacement**: For Clerk theming/branding alignment, use design tokens from [`docs/mockups/README.md`](../../docs/mockups/README.md).

---

## US-002 — Secure Session Persistence and Refresh

> Covers FR-006..FR-009: httpOnly cookie (web), Keychain/Keystore (mobile), silent refresh, expired-session fallback.

- [x] **T-051** [US-002] Implement secure web session persistence and refresh — `packages/apps/commise/web/src/`
    - **Depends on**: T-050
    - **Implements**: REQ-006, REQ-007, REQ-008, REQ-009, FR-006, FR-007, FR-008, FR-009, ARCH-003, ARCH-008, MOD-003, MOD-008
    - Enforce httpOnly/Secure/SameSite cookies. Implement silent refresh behavior and expired-session fallback to login. Implement session expiry warning banner (5 min before expiry) with "Keep me signed in" button triggering silent refresh. Preserve unsaved form state in `localStorage` as a draft before redirecting to login; auto-restore after re-authentication.
    - **Acceptance**: Valid refresh token keeps user signed in without UX interruption.

- [x] **T-061** [US-002] Implement secure mobile token storage and refresh — `packages/apps/commise/mobile/src/storage/tokenCache.ts` + `mobile/src/services/`
    - **Depends on**: T-060
    - **Implements**: REQ-006, REQ-007, REQ-008, REQ-009, REQ-IF-003, FR-006, FR-007, FR-008, FR-009, ARCH-005, ARCH-009, MOD-005, MOD-009
    - Persist tokens in platform secure storage (Keychain/Keystore via `expo-secure-store`). Implement silent refresh and invalid-refresh fallback.
    - **Acceptance**: Tokens persist securely across app restarts; expired refresh forces login.

---

## US-003 — Deterministic Logout

> Covers FR-010..FR-012: local session clear, IdP revocation, return to auth screen.

- [x] **T-052** [US-003] Implement web logout and refresh token revocation — `packages/apps/commise/web/src/`
    - **Depends on**: T-051
    - **Implements**: REQ-010, REQ-011, REQ-012, FR-010, FR-011, FR-012, ARCH-001, MOD-001
    - Clear session cookies and trigger IdP token revocation/logout flow.
    - **Acceptance**: Post-logout requests require re-authentication.

- [x] **T-062** [US-003] Implement mobile logout and revocation — `packages/apps/commise/mobile/src/` (services + hooks)
    - **Depends on**: T-061
    - **Implements**: REQ-010, REQ-011, REQ-012, FR-010, FR-011, FR-012, ARCH-004, MOD-004
    - Clear secure storage and trigger IdP revocation/logout semantics.
    - **Acceptance**: Logout ends session and shows auth screen again.

---

## US-004 — Signup-to-Database Identity Synchronization

> Covers FR-013..FR-017: `user.created` webhook, User/Account/Profile creation, ULID generation, nightly reconciliation.

- [x] **T-002** [US-004] Consolidate identity types + Drizzle schemas into identity service — `packages/services/identity/src/types/` + `packages/services/identity/src/database/schema/`
    - **Depends on**: T-001
    - **Implements**: REQ-013, REQ-014, REQ-015, REQ-017, REQ-018, REQ-019, REQ-025, REQ-CN-003, FR-013, FR-014, FR-015, FR-017, FR-018, FR-019, FR-025, ARCH-011, ARCH-012, ARCH-015, MOD-011, MOD-012, MOD-015
    - **Architecture (revised 2026-06-02 per refactor commits `2064357`, `6a9570c`, `ee1d4d1`)**: `packages/services/identity/src/types/` owns canonical TypeScript types — `User`, `Account`, `Profile` DTOs, JWT/session claim shapes, deletion-queue and reconciliation-diff payload contracts. **Drizzle schemas, DAOs, and `ulid` generation are also owned by `packages/services/identity/src/database/`** as the single source-of-truth for the data layer. Webhook lambdas import schemas from `@kitchensink/identity-service/database/schema` (or `@kitchensink/identity-service/database/dao`). Canonical ID and status enums (`active`/`suspended`) live in `identity/src/types/`. Consumers import everything through `@kitchensink/identity-service` (or subpaths `./types`, `./database/schema`, `./database/dao`).
    - **Acceptance**: Identity service and webhook lambdas compile against `@kitchensink/identity-service` schemas and types; no separate shared types package exists; no Drizzle table definitions duplicated anywhere else.

- [x] **T-021** [US-004] Implement user.created webhook sync Lambda (reuse existing IdP server-side handlers) — `packages/services/identity-webhooks/src/handlers/identityWebhook.ts`
    - **Depends on**: T-002, T-012
    - **Implements**: REQ-013, REQ-014, REQ-015, REQ-016, REQ-IF-008, REQ-CN-003, FR-013, FR-014, FR-015, FR-016, FR-016a, FR-017a, ARCH-010, ARCH-011, MOD-010, MOD-011
    - Implement raw Lambda in `packages/services/identity-webhooks/` as a single svix-verified dispatcher (`identityWebhook.ts`) that routes `user.created`, `user.updated`, `user.deleted`, and session events. Create User (ULID), Account, and Profile rows atomically on `user.created`. Update IdP user metadata with `app_user_id` custom claim. Reuse existing IdP server-side handler vendor triggers from tenant-template; no new per-event handler files.
    - **Acceptance**: Signup creates canonical DB rows and updates IdP metadata once.

- [x] **T-023** [US-004] Implement nightly reconciliation Lambda (EventBridge Scheduler) — `packages/services/identity-webhooks/src/handlers/reconciliation.ts`
    - **Depends on**: T-002, T-012, T-014
    - **Implements**: REQ-017, REQ-IF-010, FR-017, ARCH-012, MOD-012
    - Build scheduled raw Lambda to diff IdP users vs DB users (`identity_id` key). Create missing rows (users/accounts/profiles) via shared schema. Emit reconciliation counters (scanned/repaired/skipped/errors).
    - **Acceptance**: Nightly run creates only missing rows and is idempotent on repeated runs.

- [x] **T-087** [P] [US-004] Define IdP Backend API retry strategy — `specs/002-user-auth/plan.md` §Integration Points
    - **Depends on**: T-021
    - **Implements**: FR-016a, NFR-001
    - Document exponential backoff: base 1s, max 30s, 5 attempts, jitter ±20%. Apply to deletion worker (T-022), reconciliation (T-023), and suspension/reactivation (T-038). Emit CloudWatch metric `IdpApiRetryExhausted` on final failure.
    - **Acceptance**: Retry parameters documented in `plan.md` §Integration Points; all IdP API consumers implement it.

---

## US-005 — API Authorization Gate

> Covers FR-038..FR-040: JWT validation on every request, `app_user_id` claim injection, REQUEST authorizer Lambda.

- [x] **T-020** [P] [US-005] Implement REQUEST authorizer Lambda — `packages/services/identity-webhooks/src/handlers/authorizer.ts`
    - **Depends on**: T-002, T-014
    - **Implements**: REQ-038, REQ-039, REQ-040, REQ-041, REQ-042, REQ-IF-004, REQ-CN-001, FR-038, FR-039, FR-040, FR-041, FR-042, ARCH-024, ARCH-025, MOD-024, MOD-025
    - Build Node 24.x Lambda handler (no NestJS) for API Gateway REQUEST authorizer. Validate JWT signature/issuer/audience/expiry via JWKS. Inject canonical `userId` into authorizer context. Enforce suspension by returning deny policy for blocked/suspended users.
    - **Acceptance**: Valid token ⇒ allow+context; invalid/missing token ⇒ 401; suspended ⇒ 403.

- [x] **T-089** [P] [US-005] Generate OpenAPI 3.1 contract for identity API — `contracts/identity-api.openapi.json`
    - **Depends on**: T-030
    - **Implements**: FR-038, FR-039, NFR-001
    - Generate OpenAPI 3.1 spec from NestJS controllers + Zod schemas. Validate all endpoints have request/response schemas, error codes, and auth requirements. Publish to `contracts/identity-api.openapi.json`.
    - **Acceptance**: Contract covers all public endpoints; validated against spec.md FR-038..FR-040.

---

## US-006 — Profile Visibility and Account Editing

> Covers FR-018..FR-021: profile read, display name + avatar update, avatar validation.

- [x] **T-031** [US-006] Implement `GET /v1/users/me` profile read path — `packages/services/identity/src/users/users.controller.ts`
    - **Depends on**: T-030, T-020
    - **Implements**: REQ-018, FR-018, ARCH-013, ARCH-015, MOD-013, MOD-015
    - Resolve caller identity from authorizer context (`userId`). Fetch and return profile/account read model.
    - **Acceptance**: Authenticated user gets own profile payload; no anonymous access.

- [x] **T-032** [US-006] Implement `PATCH /v1/users/me` account/profile update path — `packages/services/identity/src/users/users.controller.ts`
    - **Depends on**: T-031
    - **Implements**: REQ-019, REQ-020, REQ-021, REQ-CN-005, FR-019, FR-020, FR-021, ARCH-014, ARCH-015, MOD-014, MOD-015
    - Support display name and avatar URL updates with validation. Return updated representation with consistent timestamps.
    - **Acceptance**: Valid updates persist; invalid payloads return deterministic 4xx errors.

- [x] **T-032b** [P] [US-006] Implement avatar upload validation endpoint — `packages/services/identity/src/users/avatar-upload.controller.ts`
    - **Depends on**: T-030
    - **Implements**: FR-022, REQ-021
    - Accept multipart/form-data avatar uploads with MIME-type validation (JPEG, PNG, WebP). Enforce 5 MB file-size limit and virus scan stub. Return deterministic 4xx errors for invalid uploads.
    - **Acceptance**: Valid images accepted; invalid MIME types and oversized files rejected before processing.

- [x] **T-053** [US-006] Build web profile page integration (read-only) — `packages/apps/commise/web/src/app/profile/page.tsx`
    - **Depends on**: T-031, T-051
    - **Implements**: FR-018, REQ-018, ARCH-013, MOD-013
    - **Visual reference**: [`docs/mockups/screens/screen-profile.html`](../../docs/mockups/screens/screen-profile.html) · design tokens from [`docs/mockups/README.md`](../../docs/mockups/README.md)
    - Wire UI route to `GET /v1/users/me`. Display read-only profile data (no edit form).
    - **Acceptance**: Profile page renders canonical API response.

- [x] **T-054** [US-006] Build web account edit + deletion integration — `apps/web/src/app/(protected)/account/`
    - **Depends on**: T-032, T-033
    - **Implements**: REQ-019, REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, FR-019..FR-026, ARCH-014, ARCH-016, MOD-014, MOD-016
    - **Visual reference**: [`docs/mockups/screens/screen-profile.html`](../../docs/mockups/screens/screen-profile.html) · [`docs/mockups/screens/screen-auth.html`](../../docs/mockups/screens/screen-auth.html)
    - Integrate account edit form and deletion confirmation UX to identity API. _(Also covers US-007 deletion flow.)_
    - **Acceptance**: Edit and delete flows complete with expected API outcomes.

- [x] **T-063** [US-006] Build mobile profile/account integration (read + edit + delete) — `apps/mobile/app/(protected)/profile/`
    - **Depends on**: T-031, T-032, T-032b, T-033, T-061
    - **Implements**: REQ-018..REQ-026, FR-018..FR-026, ARCH-013, ARCH-014, ARCH-016, MOD-013, MOD-014, MOD-016
    - **Visual reference**: [`docs/mockups/screens/screen-profile.html`](../../docs/mockups/screens/screen-profile.html) · wireframe: [`product-spec/wireframes/mobile-profile.md`](./product-spec/wireframes/mobile-profile.md)
    - Bind mobile screens to profile read/update/delete endpoints. _(Also covers US-007 deletion flow.)_
    - **Acceptance**: Mobile profile/account flows match API behavior.

- [x] **T-086** [P] [US-006] Verify design system tokens exist for auth UI — design token source
    - **Depends on**: T-053
    - **Implements**: NFR-011
    - Confirm shared token set contains `--accent-primary`, `--accent-secondary`, and semantic status colors. Verify no hard-coded color values exist in planned auth component styles. Document token-to-usage mapping for login, profile, account edit, and deletion confirmation screens.
    - **Acceptance**: All auth UI colors sourced from shared tokens; zero hard-coded hex/rgb values.

---

## US-007 — Account Deletion with Eventual IdP Consistency

> Covers FR-022..FR-026: DB cascade delete, async IdP deletion via SQS, retry/DLQ, cascade to user-owned data.

- [x] **T-022** [US-007] Implement async deletion-worker Lambda (SQS consumer) — `packages/services/identity-webhooks/src/handlers/deletion-worker.ts`
    - **Depends on**: T-012
    - **Implements**: REQ-025, REQ-026, REQ-IF-005, REQ-CN-001, FR-025, FR-026, ARCH-017, MOD-017
    - Consume deletion messages from SQS queue. Retry IdP delete with exponential backoff policy; move to DLQ after 5 receives.
    - **Acceptance**: Transient IdP failures retry correctly; permanent failures land in DLQ.

- [x] **T-033** [US-007] Implement `DELETE /v1/users/me` with cascade + async delete enqueue — `packages/services/identity/src/users/users.controller.ts`
    - **Depends on**: T-030, T-022
    - **Implements**: REQ-022, REQ-023, REQ-024, REQ-025, REQ-026, REQ-CN-004, REQ-IF-005, FR-022, FR-023, FR-024, FR-025, FR-026, ARCH-016, ARCH-017, MOD-016, MOD-017
    - Execute DB deletion transaction (user-owned cascades). Publish deletion job to SQS for IdP delete worker. Return safe completion response and revoke local session contract.
    - **Acceptance**: DB rows removed immediately; IdP deletion happens async with retry semantics.

---

## US-008 — Password Reset Entry

> Covers FR-027..FR-028: IdP-hosted password reset flow; Commise initiates redirect only.

- [x] **T-034** [US-008] Implement password reset integration endpoints/links support — `packages/services/identity/src/auth/auth.controller.ts`
    - **Depends on**: T-030
    - **Implements**: REQ-027, REQ-028, FR-027, FR-028, ARCH-018, MOD-018
    - Provide backend contract(s) needed by web/mobile for reset initiation links and responses. Keep actual reset execution in IdP-hosted flow.
    - **Acceptance**: Clients can trigger IdP password reset journey from supported entry points.

- [x] **T-055** [P] [US-008] Build web password reset / social-link UI hooks — `apps/web/src/app/(protected)/account/settings/`
    - **Depends on**: T-034, T-036
    - **Implements**: REQ-027..REQ-034, FR-027..FR-034, ARCH-018, ARCH-019, ARCH-021, MOD-018, MOD-019, MOD-021
    - Add account settings actions for reset password and social link/unlink. _(Also covers US-009 social linking.)_
    - **Acceptance**: All auth account-management links and callbacks work from web UX.

- [x] **T-064** [P] [US-008] Build mobile password reset / social-link entry points — `apps/mobile/app/(protected)/account/`
    - **Depends on**: T-034, T-036
    - **Implements**: REQ-027..REQ-028, REQ-032..REQ-034, FR-027, FR-028, FR-032..FR-034, ARCH-018, ARCH-021, MOD-018, MOD-021
    - Add mobile account actions for reset password and social linking. _(Also covers US-009 social linking.)_
    - **Acceptance**: Supported entry points open IdP-hosted flows correctly.

---

## US-009 — Social Provider Linking Lifecycle

> Covers FR-032..FR-034: link/unlink social providers via IdP Backend API; no credentials stored locally.

- [x] **T-036** [US-009] Implement social account linking/unlinking APIs — `packages/services/identity/src/auth/social.controller.ts`
    - **Depends on**: T-030
    - **Implements**: REQ-032, REQ-033, REQ-034, FR-032, FR-033, FR-034, ARCH-020, ARCH-021, MOD-020, MOD-021
    - Integrate with IdP Backend API for link/unlink operations. Enforce invariant: never create duplicate User/Account rows during linking changes.
    - **Acceptance**: Link/unlink operations succeed with canonical local user ID preserved.

---

## US-010 — Suspended Account Enforcement and Reactivation

> Covers FR-041..FR-044: admin suspend/reactivate, authorizer 403 on suspended, clear UX messaging.

- [x] **T-038** [US-010] Implement admin suspension/reactivation APIs — `packages/services/identity/src/admin/admin.controller.ts`
    - **Depends on**: T-030, T-020
    - **Implements**: REQ-041, REQ-042, REQ-043, REQ-044, REQ-CN-006, FR-041, FR-042, FR-043, FR-044, ARCH-025, ARCH-026, MOD-025, MOD-026
    - Admin endpoints to set user suspended/active status. Sync IdP block/unblock state with DB status changes.
    - **Acceptance**: Suspended users are denied by authorizer; reactivated users regain access.

- [x] **T-066** [US-010] Validate impersonation/suspension UX messaging on mobile — `apps/mobile/app/(protected)/`
    - **Depends on**: T-037, T-038, T-064
    - **Implements**: REQ-036, REQ-037, REQ-042, REQ-043, FR-036, FR-037, FR-042, FR-043, ARCH-023, ARCH-025, MOD-023, MOD-025
    - Ensure suspended and impersonated states produce explicit, user-safe messaging. _(Also covers US-012 impersonation UX.)_
    - **Acceptance**: Blocked/suspended scenarios are handled with clear UX states.

---

## US-011 — MFA Enrollment _(OUT OF SCOPE)_

> Covers FR-029..FR-031 — explicitly excluded per spec.md §Out of Scope. Task retained for dependency chain numbering only.

- [x] ~~**T-035**~~ [US-011] ~~MFA enrollment/management support endpoints~~ **[CLOSED — OUT OF SCOPE, no work owed]** — `packages/services/identity/src/`
    - **Closed 2026-08-08.** Ticked to mean _resolved_, not _implemented_: MFA is excluded by `spec.md`
      §Out of Scope, and this entry exists only to keep the dependency-chain numbering contiguous. It was left
      unchecked, which made feature 002 read as 56/57 complete and invited someone to "finish" a task that has
      no deliverable.
    - **Depends on**: T-030
    - **Implements**: _(None — MFA is out of scope per spec.md §Out of Scope)_
    - > Do not implement. Retained for dependency chain numbering only.
    - **Acceptance**: N/A.

---

## US-012 — Operator Impersonation with Audit Safety

> Covers FR-035..FR-037: immutable audit log, admin-only initiation, restricted operations during sessions.

- [x] **T-037** [US-012] Implement impersonation guardrails and audit logging — `packages/services/identity/src/admin/impersonation.controller.ts`
    - **Depends on**: T-030, T-020
    - **Implements**: REQ-035, REQ-036, REQ-037, FR-036, FR-037, ARCH-022, ARCH-023, MOD-022, MOD-023
    - Accept impersonation context for authorized roles only. Emit audit fields (`impersonatorId`, `impersonatedUserId`, flags) on all impersonated requests. Block restricted operations during impersonation sessions.
    - **Acceptance**: Impersonation requests are auditable and restricted per requirement.

---

## Infrastructure Foundation

> CDK stacks, NestJS scaffold, and shared infra wiring. These tasks are not user-story-bounded; they are prerequisites that unblock all US phases.

- [x] **T-010** [P] [INFRA] Bootstrap infra package and workspace wiring — `packages/services/identity/infra/` + `packages/services/identity-webhooks/infra/`
    - **Depends on**: T-001
    - **Implements**: REQ-049, REQ-050, REQ-CN-008, FR-044, ARCH-027, ARCH-031, ARCH-032, MOD-027, MOD-031, MOD-032
    - Initialize `packages/services/identity/infra/` with CDK app entrypoint for ECS service + domain stacks. Initialize `packages/services/identity-webhooks/infra/` with CDK app entrypoint for Lambda/API Gateway stacks. Register npm workspace scripts and Turbo tasks for synth/deploy/dev-local flows. Add environment contract docs for dev/staging/prod IdP tenants and AWS accounts.
    - **Acceptance**: `npm run turbo -- filter infra/identity` targets resolve; package is self-contained in this repo.

- [x] **T-011** [INFRA] Implement NetworkStack (VPC, subnets, SGs, routing) — `packages/services/identity/infra/lib/network-stack.ts`
    - **Depends on**: T-010
    - **Implements**: REQ-050, REQ-IF-007, REQ-CN-007, FR-038, ARCH-031, MOD-031
    - CDK `NetworkStack` with VPC/subnets/security groups for ECS service + DB connectivity. Define ingress path ALB → ECS and controlled egress for IdP Backend API calls. Export stack outputs consumed by `IdentityServiceStack` and `DataStack`.
    - **Acceptance**: `cdk synth` emits NetworkStack resources and cross-stack exports with no unresolved refs.

- [x] **T-012** [INFRA] Implement DataStack (RDS, SQS+DLQ, S3, secrets) — `packages/services/identity/infra/lib/data-stack.ts`
    - **Depends on**: T-011
    - **Implements**: REQ-013, REQ-014, REQ-017, REQ-025, REQ-026, REQ-050, REQ-IF-007, REQ-CN-007, FR-013, FR-014, FR-017, FR-025, FR-026, ARCH-017, ARCH-031, MOD-017, MOD-031
    - CDK `DataStack` resources: RDS PostgreSQL 16 (`db.t4g.micro`), SQS deletion queue + DLQ (`maxReceiveCount=5`), S3 bucket(s) required by feature boundary, Secrets Manager entries for DB/IdP credentials. Enable `pg_trgm` extension bootstrap migration hooks in deployment plan.
    - **Acceptance**: Synth shows RDS/SQS/DLQ/S3/secrets defined; queue redrive policy correct.

- [x] **T-013** [INFRA] Implement IdentityServiceStack (ECR, ECS/Fargate, ALB, IAM) — `packages/services/identity/infra/lib/identity-service-stack.ts`
    - **Depends on**: T-011, T-012
    - **Implements**: REQ-018, REQ-019, REQ-020, REQ-021, REQ-022, REQ-023, REQ-024, REQ-035, REQ-036, REQ-037, REQ-038, REQ-050, FR-018..FR-024, FR-036..FR-040, ARCH-015, ARCH-016, ARCH-026, ARCH-031, MOD-015, MOD-016, MOD-026, MOD-031
    - CDK `IdentityServiceStack`: ECR repo and image deployment pipeline hooks, ECS task/service (Fargate) for NestJS identity API (Node 24), ALB + target group + health checks, IAM role policies for DB/SQS/secrets access, CloudWatch log group and alarm wiring.
    - **Acceptance**: Synth includes ECS service reachable through ALB; IAM least-privilege policies in place.

- [x] **T-014** [INFRA] Implement WebhooksStack boundary (CDK owns Lambda + REST API + authorizer) — `packages/services/identity-webhooks/infra/lib/webhooks-stack.ts`
    - **Depends on**: T-012, T-013
    - **Implements**: REQ-039, REQ-040, REQ-042, REQ-050, REQ-IF-007, REQ-IF-009, FR-038, FR-039, FR-040, FR-042, ARCH-024, ARCH-031, MOD-024, MOD-031
    - In CDK `WebhooksStack`, define Lambda functions and API Gateway REST resources. Wire REQUEST authorizer Lambda to protected routes. Ensure ALB-backed identity API routes are integrated through API Gateway mapping. All infrastructure is CDK-owned; no Serverless Framework or `serverless.yml` references.
    - **Acceptance**: `cdk synth` includes all Lambda + API Gateway resources; REQUEST authorizer attached to protected endpoints.

- [x] **T-015** [INFRA] LocalStack local infrastructure plan (docker-compose + health checks) — `packages/services/identity/infra/docker/` + `packages/services/identity-webhooks/infra/docker/`
    - **Depends on**: T-010, T-012, T-014
    - **Implements**: REQ-049, REQ-050, REQ-017, REQ-025, REQ-026, FR-017, FR-025, FR-026, ARCH-012, ARCH-017, ARCH-031, MOD-012, MOD-017, MOD-031
    - Add `docker-compose.yml` plan in `packages/services/{identity,identity-webhooks}/infra/` with: LocalStack Community service (SQS, S3, EventBridge), sibling Postgres container. Add LocalStack readiness and Postgres health check scripts. Add local seed/migration script wiring for test bootstrap. Add `npm run dev:local` turbo target orchestrating local infra + service + lambdas.
    - **Acceptance**: Local runtime bootstrap sequence documented and executable end-to-end.

- [x] **T-030** [P] [INFRA] Scaffold NestJS identity service and module boundaries — `packages/services/identity/src/`
    - **Depends on**: T-001, T-002, T-013
    - **Implements**: REQ-018..REQ-024, REQ-035..REQ-038, REQ-CN-002, FR-018..FR-024, FR-036..FR-040, ARCH-015, ARCH-016, ARCH-026, MOD-015, MOD-016, MOD-026
    - Create `AuthModule`, `UsersModule`, `AccountsModule`, `ProfileModule`, `AdminModule`. Wire DB layer via Drizzle + `pg` using shared schema contracts. Add REST controller scaffolds with request validation pipeline.
    - **Acceptance**: Service boots locally and exposes versioned API routes with module isolation.

---

## Quality, Observability & CI

> Observability, integration/E2E testing, local dev runtime, traceability, and CI hardening. These tasks gate ship confidence across all user stories.

- [x] **T-024** [P] [QUALITY] Implement webhook package observability and error envelope — `packages/services/identity-webhooks/src/observability/`
    - **Depends on**: T-020, T-021, T-022, T-023
    - **Implements**: REQ-IF-006, NFR-012, NFR-013, NFR-014, NFR-016, NFR-017, ARCH-027, ARCH-028, ARCH-029, MOD-027, MOD-028, MOD-029
    - Standardize structured logging and correlation IDs across all lambdas. Add Sentry integration and CloudWatch custom metric emission. Ensure trace headers propagate from API Gateway through handlers.
    - **Acceptance**: All lambdas emit structured logs/metrics/traces and surface unhandled errors to Sentry.

- [x] **T-039** [P] [QUALITY] Service-level observability baseline — `packages/services/identity/src/observability/`
    - **Depends on**: T-030
    - **Implements**: NFR-012, NFR-013, NFR-014, NFR-015, NFR-016, NFR-017, ARCH-027, ARCH-028, ARCH-029, ARCH-030, MOD-027, MOD-028, MOD-029, MOD-030
    - Structured logs, metrics, tracing, and Sentry in NestJS service. Ensure request correlation from API Gateway through ECS handlers.
    - **Acceptance**: Dashboards/alerts can correlate API traffic, auth failures, and downstream errors.

- [x] **T-040** [P] [QUALITY] Integration tests for service modules — `packages/services/identity/tests/**/*.integration.test.ts`
    - **Depends on**: T-031..T-039
    - **Implements**: REQ-018..REQ-044, FR-018..FR-044, ARCH-013..ARCH-030, MOD-013..MOD-030
    - Add module integration tests for users/accounts/profile/admin/impersonation flows. Include suspension and deletion edge cases.
    - **Acceptance**: Integration suite passes against local Postgres and mocked external dependencies.

- [x] **T-041** [QUALITY] Align API contracts with downstream specs (001/003/005/010) — `contracts/` + `specs/002-user-auth/`
    - **Depends on**: T-031..T-038
    - **Implements**: REQ-045, REQ-046, REQ-047, REQ-048
    - Verify auth layer contract compatibility with dependent features: 001 authentication gate and account tier linkage, 003 shared authorizer expectations, 005 OAuth integration dependency, 010 account tier storage assumptions.
    - **Acceptance**: No contract drift for downstream feature assumptions.

- [x] **T-056** [QUALITY] Web integration tests and accessibility assertions — `apps/web/src/**/*.spec.ts` + `tests/e2e/web/`
    - **Depends on**: T-050..T-055
    - **Implements**: REQ-001..REQ-026, FR-001..FR-026, NFR-004, NFR-005, NFR-008, NFR-011
    - Add Playwright/Vitest coverage for login/session/logout/profile/account scenarios. Enforce role/label selectors (no `data-testid`) for auth UIs.
    - **Acceptance**: Web auth integration tests pass and satisfy accessibility selector constraints.

- [x] **T-065** [QUALITY] Mobile integration tests and secure-storage assertions — `apps/mobile/src/**/*.spec.ts` + `tests/e2e/mobile/`
    - **Depends on**: T-060..T-064
    - **Implements**: REQ-001..REQ-034, FR-001..FR-034, NFR-004, NFR-005, NFR-008
    - Add mobile auth flow test coverage including launch/login/logout/refresh behavior.
    - **Acceptance**: Mobile integration suite passes with secure storage and redirect invariants proven.

- [x] **T-070** [P] [QUALITY] Author `docker-compose.yml` for LocalStack Community + Postgres — `packages/services/identity/infra/docker/docker-compose.yml`
    - **Depends on**: T-015
    - **Implements**: REQ-049, FR-017, FR-025, FR-026, ARCH-031, MOD-031
    - Define compose services, networks, and startup ordering for LocalStack + Postgres.
    - **Acceptance**: Single compose command starts both services deterministically.

- [x] **T-071** [QUALITY] Implement LocalStack bootstrap + health checks — `packages/services/identity/infra/scripts/localstack-bootstrap.sh`
    - **Depends on**: T-070
    - **Implements**: REQ-049, REQ-050, ARCH-031, MOD-031
    - Provision local SQS/S3/EventBridge resources and verify readiness.
    - **Acceptance**: Health script fails fast on missing local resources.

- [x] **T-072** [QUALITY] Implement Postgres seed/migration local scripts — `packages/services/identity/infra/scripts/seed.ts`
    - **Depends on**: T-070, T-002
    - **Implements**: REQ-013, REQ-014, REQ-018, REQ-019, REQ-049, FR-013, FR-014, FR-018, FR-019, ARCH-015, MOD-015
    - Add migration + seed scripts for local DB reset and baseline fixtures.
    - **Acceptance**: Local DB can be reset and seeded repeatedly for e2e runs.

- [x] **T-073** [QUALITY] Implement `npm run dev:local` turbo target — `turbo.json` + `package.json` (root + infra packages)
    - **Depends on**: T-071, T-072
    - **Implements**: REQ-049, REQ-050, ARCH-032, MOD-032
    - Orchestrate LocalStack, Postgres, NestJS service, and lambda local invocation workflows.
    - **Acceptance**: One command starts complete local development topology.

- [x] **T-074** [QUALITY] E2E: local API + authorizer + ECS-local service path — `tests/e2e/auth/`
    - **Depends on**: T-073, T-056, T-065
    - **Implements**: REQ-001..REQ-044, FR-001..FR-044, ARCH-024, ARCH-015, MOD-024, MOD-015
    - Execute end-to-end tests against LocalStack API Gateway/authorizer path and local identity service.
    - **Acceptance**: Auth-protected route tests pass against local emulated infrastructure.

- [x] **T-075** [QUALITY] E2E: local deletion-worker + reconciliation scheduled flows — `tests/e2e/auth/deletion.e2e.test.ts`
    - **Depends on**: T-073, T-022, T-023
    - **Implements**: REQ-017, REQ-025, REQ-026, FR-017, FR-025, FR-026, ARCH-012, ARCH-017, MOD-012, MOD-017
    - Verify local queue-driven deletion retries and scheduled reconciliation behavior.
    - **Acceptance**: Local e2e confirms deletion retry/DLQ and reconciliation repair workflows.

- [x] **T-081** [P] [QUALITY] Performance + reliability checks for authorizer and async workers — `tests/perf/`
    - **Depends on**: T-020, T-022, T-023, T-039
    - **Implements**: SC-003, SC-004, SC-006, REQ-039, REQ-042, REQ-025, REQ-026, FR-039, FR-042, FR-025, FR-026, NFR-011a, ARCH-024, ARCH-017, MOD-024, MOD-017
    - Validate authorizer latency/error targets and deletion worker retry behavior under failure injection. Validate performance targets: token refresh endpoint ≤500ms P99, profile endpoint ≤1s P99, webhook processing ≤2s P99.
    - **Acceptance**: Observed metrics remain within target thresholds.

- [x] **T-082** [QUALITY] Traceability pass: requirements-to-implementation matrix refresh — `specs/002-user-auth/v-model/`
    - **Depends on**: T-041, T-074, T-075
    - **Implements**: REQ-001..REQ-050, FR-001..FR-044, ARCH-001..ARCH-033, MOD-001..MOD-033
    - Update feature trace matrix to ensure no dropped REQ/FR/ARCH/MOD IDs. _(Status: Pending — requires refresh after spec changes; FR-032..037, FR-016a, FR-017a, NFR-011a added post-matrix creation.)_
    - **Acceptance**: Every requirement/module ID has at least one implementing task and test reference.

- [x] **T-083** [QUALITY] CI gates for lint/typecheck/tests on updated topology — `.github/workflows/002-user-auth.yml`
    - **Depends on**: T-056, T-065, T-074, T-075
    - **Implements**: NFR-001, NFR-002, NFR-003, NFR-006, NFR-007, NFR-008, ARCH-032, MOD-032
    - Wire CI jobs for all new workspaces and localstack-backed e2e stage. Add performance benchmark gates (NFR-011a): CI MUST fail if token refresh >500ms P99, profile endpoint >1s P99, or webhook processing >2s P99. Test split: `@kitchensink/identity-service` exposes `npm test` (unit/integration, Vitest, excluding LocalStack e2e); `@kitchensink/identity-webhooks` exposes `npm test` (unit); root e2e target exercises LocalStack stack.
    - **Acceptance**: CI validates strict typing/lint/tests across shared, infra, webhook, service, web, and mobile packages.

- [x] **T-088** [QUALITY] Add feature flag for staged rollout — `packages/services/identity/src/config/feature-flags.ts`
    - **Depends on**: T-083
    - **Implements**: NFR-001, NFR-014
    - Implement feature flag `auth-v2-rollout` with percentage-based traffic split. Staged rollout: 10% → 50% → 100% over 2-week period. Fallback to legacy auth path if flag disabled or error.
    - **Acceptance**: Flag controls auth feature visibility; rollback to 0% completes within 5 minutes.

- [x] **T-090** [QUALITY] Add test distribution metric gate to CI — `.github/workflows/002-user-auth.yml`
    - **Depends on**: T-083
    - **Implements**: NFR-008
    - CI MUST collect test counts by type (unit/integration/e2e) and fail if distribution violates 70/20/10 pyramid. Allow ±5% tolerance per category. Output coverage report with category breakdown.
    - **Acceptance**: CI fails if unit <65%, integration >25%, or e2e >15%.

---

## Coverage Summary

- **Total tasks**: 57 (T-001, T-002, T-010..T-015, T-020..T-024, T-030..T-041, T-050..T-056, T-060..T-066, T-070..T-075, T-080..T-090)
- **Deprecated**: T-035 (MFA — out of scope)
- **REQ coverage**: REQ-001..REQ-050 addressed across phases.
- **FR coverage**: FR-001..FR-044 addressed across phases.
- **Architecture coverage**: ARCH-001..ARCH-033 referenced.
- **Module coverage**: MOD-001..MOD-033 referenced.

> No task introduces Terraform, Pulumi, SAM, hand-written CloudFormation templates, Aurora DSQL, or new IdP server-side handler authoring.
