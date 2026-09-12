# V-Model Traceability Matrix: IdP User Authentication

**Feature Branch**: `002-user-auth`
**Generated**: 2026-05-09
**Baseline Status**: Draft — Pending Execution
**Traceability Standard**: ISO 29119 / V-Model bidirectional coverage

---

## Artifact Information

| Artifact                   | File                                             | Created    | Status     | Scope                                                           |
| -------------------------- | ------------------------------------------------ | ---------- | ---------- | --------------------------------------------------------------- |
| Requirements Specification | `specs/002-user-auth/v-model/requirements.md`    | 2026-05-09 | Draft      | 44 FR + 17 NF + 10 IF + 7 CN + 1 CN-008 = 79 total requirements |
| Acceptance Test Plan       | `specs/002-user-auth/v-model/acceptance-plan.md` | 2026-05-09 | Draft      | AT cases for all 44 FR + selected NF/IF/CN                      |
| Unit Test Plan             | `specs/002-user-auth/v-model/unit-test.md`       | 2026-05-09 | Draft      | 6 MODs, 8 UTP cases, 30 UTS scenarios                           |
| System Design              | `specs/002-user-auth/v-model/system-design.md`   | —          | Referenced | ARCH modules (ARCH-001 through ARCH-006+)                       |
| Module Design              | `specs/002-user-auth/v-model/module-design.md`   | —          | Referenced | MOD-001 through MOD-006                                         |

**Legend**:

- ⬜ Pending Execution — test defined, not yet run
- ✅ Passed — test executed and passed
- ❌ Failed — test executed and failed
- ⚠️ Partially Passed — test executed with partial pass

---

## Matrix A: Forward Traceability (REQ → ATP)

> Maps every requirement to its acceptance test case(s). Gaps indicate requirements with no acceptance coverage.

### Functional Requirements

| REQ-ID  | Requirement (Summary)                                                           | Priority | ATP-ID             | Acceptance Test (Summary)                                        | Verification Method      | Status |
| ------- | ------------------------------------------------------------------------------- | -------- | ------------------ | ---------------------------------------------------------------- | ------------------------ | ------ |
| REQ-001 | PKCE Authorization Code Flow (Web + Mobile)                                     | P1       | AT-001-A, AT-001-B | Web PKCE flow; Mobile PKCE flow                                  | Scenario-Based Testing   | ⬜     |
| REQ-002 | Mobile auto-displays auth screen before app content                             | P1       | AT-002-A           | No app content visible before auth on mobile                     | Scenario-Based Testing   | ⬜     |
| REQ-003 | Web redirects unauthenticated users to IdP login                                | P1       | AT-003-A           | Protected routes redirect; public routes unaffected              | Scenario-Based Testing   | ⬜     |
| REQ-004 | Social login (Google) supported                                                 | P1       | AT-004-A           | Google OAuth completes; cancel handled                           | Scenario-Based Testing   | ⬜     |
| REQ-005 | IdP callback exchanges code for tokens                                          | P1       | AT-005-A           | Token exchange completes; tampered state rejected                | Scenario-Based Testing   | ⬜     |
| REQ-006 | Tokens stored securely (httpOnly cookie / Keychain/Keystore)                    | P1       | AT-006-A, AT-006-B | Web httpOnly enforced; Mobile no plaintext tokens                | Boundary Value Analysis  | ⬜     |
| REQ-007 | Silent token refresh on access token expiry                                     | P1       | AT-007-A           | Silent refresh succeeds; expired refresh forces login            | Scenario-Based Testing   | ⬜     |
| REQ-008 | Session persists across app restarts                                            | P1       | AT-008-A           | Session survives app restart / tab reopen                        | Scenario-Based Testing   | ⬜     |
| REQ-009 | Bearer token attached to all API requests                                       | P1       | AT-009-A           | Expired session forces re-authentication                         | Scenario-Based Testing   | ⬜     |
| REQ-010 | Logout clears all local tokens                                                  | P1       | AT-010-A           | Logout removes tokens; subsequent calls return 401               | Scenario-Based Testing   | ⬜     |
| REQ-011 | Logout revokes refresh token in the IdP                                         | P1       | AT-011-A           | Revoked refresh token rejected by the IdP                        | Scenario-Based Testing   | ⬜     |
| REQ-012 | Post-logout navigation to auth screen / login page                              | P1       | AT-012-A           | Web → IdP login page; Mobile → IdP login UI                      | Scenario-Based Testing   | ⬜     |
| REQ-013 | Post-registration action creates User record (UUIDv4)                           | P1       | AT-013-A           | User record with UUIDv4 exists after signup                      | Scenario-Based Testing   | ⬜     |
| REQ-014 | Post-registration action creates Account record                                 | P1       | AT-014-A           | Account record associated with new User exists                   | Scenario-Based Testing   | ⬜     |
| REQ-015 | User ID stored in IdP app_metadata                                              | P1       | AT-015-A           | UUIDv4 present as custom claim in access token                   | Scenario-Based Testing   | ⬜     |
| REQ-016 | Post-registration action retries on transient failure (3x, exponential backoff) | P1       | AT-016-A           | Retry succeeds on recovery; failure logged after exhaustion      | Fault Injection          | ⬜     |
| REQ-017 | Reconciliation mechanism detects and repairs missing records                    | P1       | AT-017-A           | Missing records created; app_metadata updated                    | Scenario-Based Testing   | ⬜     |
| REQ-018 | Profile page displays user data from database                                   | P2       | AT-018-A           | Profile shows display name, email, avatar, creation date         | Scenario-Based Testing   | ⬜     |
| REQ-019 | Account edit page allows display name and avatar changes                        | P2       | AT-019-A           | Changes accepted; profile reflects updated values                | Scenario-Based Testing   | ⬜     |
| REQ-020 | Account edits persisted to database                                             | P2       | AT-020-A           | Edits survive logout/login cycle                                 | Scenario-Based Testing   | ⬜     |
| REQ-021 | Email field read-only on account edit page                                      | P2       | AT-021-A           | Email field is read-only with IdP redirect note                  | Scenario-Based Testing   | ⬜     |
| REQ-022 | Empty display name rejected with validation error                               | P2       | AT-022-A           | Save blocked; validation error displayed                         | Boundary Value Analysis  | ⬜     |
| REQ-023 | Account deletion requires explicit "DELETE" confirmation                        | P2       | AT-023-A           | Delete unavailable until "DELETE" typed; partial input blocked   | Scenario-Based Testing   | ⬜     |
| REQ-024 | Confirmed deletion removes User/Account from DB and the IdP                     | P2       | AT-024-A           | Records absent from DB and IdP after deletion                    | Scenario-Based Testing   | ⬜     |
| REQ-025 | Deletion cascades to all user-owned data                                        | P2       | AT-025-A           | Recipes, meal plans, etc. deleted with account                   | Scenario-Based Testing   | ⬜     |
| REQ-026 | Post-deletion navigation to unauthenticated state                               | P2       | AT-026-A           | User logged out and returned to auth screen                      | Scenario-Based Testing   | ⬜     |
| REQ-027 | Password reset accessible from login screen                                     | P2       | AT-027-A           | "Forgot Password" initiates IdP reset flow                       | Scenario-Based Testing   | ⬜     |
| REQ-028 | Passwords never handled by Commise backend                                      | P1       | AT-028-A           | No password data in Commise API traffic                          | Inspection               | ⬜     |
| REQ-029 | MFA enrollment accessible from account settings                                 | P3       | AT-029-A           | MFA enrollment entry point present and functional                | Scenario-Based Testing   | ⬜     |
| REQ-030 | TOTP supported as MFA method                                                    | P3       | AT-030-A           | TOTP enrollment completes; valid codes generated                 | Scenario-Based Testing   | ⬜     |
| REQ-031 | MFA required on all logins after enrollment                                     | P3       | AT-031-A           | Second factor prompted on login after enrollment                 | Scenario-Based Testing   | ⬜     |
| REQ-032 | User can link additional social providers                                       | P2       | AT-032-A           | Google linked; appears in account settings                       | Scenario-Based Testing   | ⬜     |
| REQ-033 | User can unlink social provider (min 1 method remains)                          | P2       | AT-033-A           | Unlink succeeds with 2 methods; blocked with 1                   | Boundary Value Analysis  | ⬜     |
| REQ-034 | Linking/unlinking does not create new database records                          | P2       | AT-034-A           | Exactly one User record; UUIDv4 unchanged after linking          | Scenario-Based Testing   | ⬜     |
| REQ-035 | Impersonation available to authorized personnel                                 | P2       | AT-035-A           | Authorized engineer receives scoped session token                | Scenario-Based Testing   | ⬜     |
| REQ-036 | Impersonation sessions flagged in audit logs                                    | P2       | AT-036-A           | Impersonation flag and impersonator identity in logs             | Scenario-Based Testing   | ⬜     |
| REQ-037 | Impersonation cannot perform destructive actions                                | P2       | AT-037-A           | Password change, account deletion, MFA modification all rejected | Equivalence Partitioning | ⬜     |
| REQ-038 | All API endpoints require valid access token                                    | P1       | AT-038-A           | No-token → 401; expired token → 401                              | Equivalence Partitioning | ⬜     |
| REQ-039 | API Gateway authorizer validates JWT claims                                     | P1       | AT-039-A           | Unknown key → 401; wrong audience → 401                          | Boundary Value Analysis  | ⬜     |
| REQ-040 | Access token includes Commise user ID as custom claim                           | P1       | AT-040-A           | UUIDv4 user ID available in decoded token without DB lookup      | Scenario-Based Testing   | ⬜     |
| REQ-041 | Suspension blocks user in the IdP and sets DB status                            | P2       | AT-041-A           | User blocked in IdP; DB status = suspended                       | Scenario-Based Testing   | ⬜     |
| REQ-042 | Suspended user denied access even with valid token                              | P2       | AT-042-A           | API returns 403 for suspended user with valid token              | Scenario-Based Testing   | ⬜     |
| REQ-043 | Suspended user sees clear suspension message on login                           | P2       | AT-043-A           | Suspension message shown (not generic error)                     | Scenario-Based Testing   | ⬜     |
| REQ-044 | Reactivation restores access                                                    | P2       | AT-044-A           | Reactivated user can log in; API returns 200                     | Scenario-Based Testing   | ⬜     |

### Non-Functional Requirements

| REQ-ID     | Requirement (Summary)                                         | Priority | ATP-ID                         | Acceptance Test (Summary)                                            | Verification Method     | Status |
| ---------- | ------------------------------------------------------------- | -------- | ------------------------------ | -------------------------------------------------------------------- | ----------------------- | ------ |
| REQ-NF-001 | Strict TypeScript; no `any` outside test doubles              | P1       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-002 | JSDoc on all exported symbols                                 | P2       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-003 | Aliased imports; no `helpers/` directories                    | P2       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-004 | Auth UI accessible via role/label queries                     | P1       | AT-NF-004-A                    | All interactive elements found via getByRole/getByLabel              | Inspection / Playwright | ⬜     |
| REQ-NF-005 | Auth status indicators not color-only                         | P1       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-006 | Workspaces registered and extend shared configs               | P1       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-007 | CI quality gates pass (typecheck, lint, format)               | P1       | AT-NF-007-A                    | All three turbo commands exit 0                                      | Test (CI)               | ⬜     |
| REQ-NF-008 | Testing pyramid ≥70% unit / ≤20% integration / ≤10% E2E       | P1       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-009 | Custom errors extend Error with type guards                   | P1       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-010 | Date fields as ISO 8601 strings                               | P1       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-011 | Login/signup UI uses design system tokens                     | P2       | _(Inspection — no AT defined)_ | —                                                                    | Inspection              | ⬜     |
| REQ-NF-012 | Structured JSON logs with correlation IDs to CloudWatch       | P1       | AT-NF-012-A                    | CloudWatch log entries are valid JSON with correlation ID + ISO 8601 | Scenario-Based Testing  | ⬜     |
| REQ-NF-013 | Unhandled exceptions surface in Sentry                        | P1       | AT-NF-013-A                    | Sentry issue with stack trace and request context                    | Fault Injection         | ⬜     |
| REQ-NF-014 | CloudWatch custom metrics emitted for all auth flows          | P1       | AT-NF-014-A                    | Success/failure counts present with correct dimensions               | Scenario-Based Testing  | ⬜     |
| REQ-NF-015 | Client-side auth errors captured by Sentry                    | P2       | AT-NF-015-A                    | Sentry event with breadcrumbs on token refresh failure               | Fault Injection         | ⬜     |
| REQ-NF-016 | Distributed tracing across auth flows                         | P2       | AT-NF-016-A                    | Single trace spans client → API Gateway → backend                    | Scenario-Based Testing  | ⬜     |
| REQ-NF-017 | Observability architecture supports future LogRocket/NewRelic | P3       | _(Analysis — no AT defined)_   | —                                                                    | Analysis                | ⬜     |

### Interface Requirements

| REQ-ID     | Requirement (Summary)                                                   | Priority | ATP-ID                         | Acceptance Test (Summary)                                       | Verification Method        | Status |
| ---------- | ----------------------------------------------------------------------- | -------- | ------------------------------ | --------------------------------------------------------------- | -------------------------- | ------ |
| REQ-IF-001 | Integrate with the IdP via `@clerk/nextjs` (web)                        | P1       | _(Inspection — no AT defined)_ | —                                                               | Inspection                 | ⬜     |
| REQ-IF-002 | Integrate with the IdP via `@clerk/expo` (mobile)                       | P1       | _(Inspection — no AT defined)_ | —                                                               | Inspection                 | ⬜     |
| REQ-IF-003 | Mobile uses `expo-secure-store` for token storage                       | P1       | _(Inspection — no AT defined)_ | —                                                               | Inspection                 | ⬜     |
| REQ-IF-004 | API Gateway authorizer uses `jwks-rsa` and `jose`                       | P1       | _(Inspection — no AT defined)_ | —                                                               | Inspection                 | ⬜     |
| REQ-IF-005 | Post-registration action uses `@aws-sdk/client-sqs`                     | P1       | _(Inspection — no AT defined)_ | —                                                               | Inspection                 | ⬜     |
| REQ-IF-006 | Backend uses `@sentry/aws-serverless` + `@aws-lambda-powertools/logger` | P1       | _(Inspection — no AT defined)_ | —                                                               | Inspection                 | ⬜     |
| REQ-IF-007 | Infrastructure defined using AWS CDK v2                                 | P1       | _(Inspection — no AT defined)_ | —                                                               | Inspection                 | ⬜     |
| REQ-IF-008 | Post-registration action calls Commise backend API                      | P1       | AT-IF-008-A                    | Backend receives sub + UUIDv4; creates User and Account records | Scenario-Based Testing     | ⬜     |
| REQ-IF-009 | API Gateway authorizer returns standard IAM policy document             | P1       | AT-IF-009-A                    | Valid IAM Allow/Deny policy returned for valid/invalid JWT      | Interface Contract Testing | ⬜     |
| REQ-IF-010 | Reconciliation endpoint accepts IdP user list                           | P1       | AT-IF-010-A                    | Missing records created; repair summary returned                | Scenario-Based Testing     | ⬜     |

### Constraint Requirements

| REQ-ID     | Requirement (Summary)                                           | Priority | ATP-ID                         | Acceptance Test (Summary)                                | Verification Method | Status |
| ---------- | --------------------------------------------------------------- | -------- | ------------------------------ | -------------------------------------------------------- | ------------------- | ------ |
| REQ-CN-001 | Node.js 22.x for Lambda runtime                                 | P1       | _(Inspection — no AT defined)_ | —                                                        | Inspection          | ⬜     |
| REQ-CN-002 | Passwords never handled by Commise backend                      | P1       | AT-CN-002-A                    | No password fields/hashes/logic in any Commise component | Inspection          | ⬜     |
| REQ-CN-003 | UUIDv4 is canonical user identifier; IdP sub for IdP calls only | P1       | AT-CN-003-A                    | IdP sub not used as primary key in DB or app logic       | Inspection          | ⬜     |
| REQ-CN-004 | Account deletion is permanent; no soft-delete                   | P2       | _(Inspection — no AT defined)_ | —                                                        | Inspection          | ⬜     |
| REQ-CN-005 | Email change is out of scope                                    | P2       | _(Inspection — no AT defined)_ | —                                                        | Inspection          | ⬜     |
| REQ-CN-006 | Admin UI is out of scope                                        | P2       | _(Inspection — no AT defined)_ | —                                                        | Inspection          | ⬜     |
| REQ-CN-007 | Deploy to AWS using CDK v2 only                                 | P1       | _(Inspection — no AT defined)_ | —                                                        | Inspection          | ⬜     |
| REQ-CN-008 | All workspaces extend shared kitchensink configs                | P1       | _(Inspection — no AT defined)_ | —                                                        | Inspection          | ⬜     |

---

## Matrix B: Backward Traceability (ATP → REQ)

> Maps every acceptance test case back to its parent requirement. Orphan ATs (no REQ) are flagged.

| ATP-ID      | Acceptance Test (Summary)                                 | REQ-ID     | Requirement (Summary)                                    | Justification                                                         |
| ----------- | --------------------------------------------------------- | ---------- | -------------------------------------------------------- | --------------------------------------------------------------------- |
| AT-001-A    | Web login initiates PKCE flow                             | REQ-001    | PKCE Authorization Code Flow                             | Direct verification of PKCE parameters in web auth redirect           |
| AT-001-B    | Mobile login initiates PKCE flow                          | REQ-001    | PKCE Authorization Code Flow                             | Direct verification of PKCE parameters in mobile auth request         |
| AT-002-A    | No app content visible before auth on mobile              | REQ-002    | Mobile auto-displays auth screen                         | Confirms auth screen is first rendered screen on mobile               |
| AT-003-A    | Protected web routes redirect to IdP login                | REQ-003    | Web redirects unauthenticated users                      | Confirms redirect behavior for protected and public routes            |
| AT-004-A    | Google social login completes successfully                | REQ-004    | Social login (Google) supported                          | Confirms Google OAuth flow and cancel handling                        |
| AT-005-A    | Callback handler completes token exchange                 | REQ-005    | IdP callback exchanges code for tokens                   | Confirms code exchange and tampered state rejection                   |
| AT-006-A    | Web tokens stored in httpOnly cookies                     | REQ-006    | Tokens stored securely                                   | Confirms httpOnly enforcement on web                                  |
| AT-006-B    | Mobile tokens stored in secure storage                    | REQ-006    | Tokens stored securely                                   | Confirms no plaintext tokens in accessible mobile storage             |
| AT-007-A    | Access token refreshes silently                           | REQ-007    | Silent token refresh on expiry                           | Confirms silent refresh and fallback to login on refresh token expiry |
| AT-008-A    | Session survives app restart                              | REQ-008    | Session persists across app restarts                     | Confirms session persistence via refresh token                        |
| AT-009-A    | Expired session forces re-authentication                  | REQ-009    | Bearer token attached to all API requests                | Confirms session invalidation when refresh token expired/revoked      |
| AT-010-A    | Logout removes tokens from local storage                  | REQ-010    | Logout clears all local tokens                           | Confirms all tokens cleared; subsequent calls return 401              |
| AT-011-A    | Refresh token revoked server-side on logout               | REQ-011    | Logout revokes refresh token in the IdP                  | Confirms IdP rejects revoked refresh token                            |
| AT-012-A    | User lands on correct screen after logout                 | REQ-012    | Post-logout navigation                                   | Confirms web → IdP login page; mobile → IdP login UI                  |
| AT-013-A    | New signup creates a User record                          | REQ-013    | Post-registration action creates User record             | Confirms UUIDv4 User record linked to IdP sub                         |
| AT-014-A    | New signup creates an Account record                      | REQ-014    | Post-registration action creates Account record          | Confirms Account record associated with new User                      |
| AT-015-A    | UUIDv4 user ID present in access token claims             | REQ-015    | User ID stored in IdP app_metadata                       | Confirms custom claim in decoded access token                         |
| AT-016-A    | Transient DB failure does not orphan IdP user             | REQ-016    | Post-registration action retries on transient failure    | Confirms retry logic and failure logging                              |
| AT-017-A    | Reconciliation creates missing User/Account records       | REQ-017    | Reconciliation mechanism detects and repairs             | Confirms records created and app_metadata updated                     |
| AT-018-A    | Profile page shows correct user information               | REQ-018    | Profile page displays user data                          | Confirms display name, email, avatar, creation date from DB           |
| AT-019-A    | User can edit display name and avatar                     | REQ-019    | Account edit page allows changes                         | Confirms changes accepted and reflected on profile                    |
| AT-020-A    | Edits survive session restart                             | REQ-020    | Account edits persisted to database                      | Confirms persistence across logout/login cycle                        |
| AT-021-A    | Email cannot be edited in the app                         | REQ-021    | Email field read-only                                    | Confirms read-only field with IdP redirect note                       |
| AT-022-A    | Validation prevents empty display name                    | REQ-022    | Empty display name rejected                              | Confirms save blocked and validation error shown                      |
| AT-023-A    | Deletion confirmation gate enforced                       | REQ-023    | Account deletion requires explicit confirmation          | Confirms "DELETE" typing required; partial input blocked              |
| AT-024-A    | Account deletion removes all records                      | REQ-024    | Confirmed deletion removes records from DB and the IdP   | Confirms User/Account absent from both systems                        |
| AT-025-A    | User-owned data removed on account deletion               | REQ-025    | Deletion cascades to all user-owned data                 | Confirms recipes, meal plans, etc. deleted                            |
| AT-026-A    | User returned to unauthenticated state after deletion     | REQ-026    | Post-deletion navigation                                 | Confirms logout and return to auth screen                             |
| AT-027-A    | "Forgot Password" link present and functional             | REQ-027    | Password reset accessible from login screen              | Confirms IdP reset flow initiated                                     |
| AT-028-A    | No password data in Commise API traffic                   | REQ-028    | Passwords never handled by Commise backend               | Confirms no password data in any Commise request/response             |
| AT-029-A    | MFA enrollment entry point present                        | REQ-029    | MFA enrollment accessible from account settings          | Confirms MFA option visible and navigates to IdP flow                 |
| AT-030-A    | TOTP enrollment completes successfully                    | REQ-030    | TOTP supported as MFA method                             | Confirms TOTP enrollment and valid code generation                    |
| AT-031-A    | MFA challenge appears on login after enrollment           | REQ-031    | MFA required on all logins after enrollment              | Confirms second factor prompted on subsequent login                   |
| AT-032-A    | Social account linking from account settings              | REQ-032    | User can link additional social providers                | Confirms Google linked and listed in account settings                 |
| AT-033-A    | Social account unlinking enforces minimum login method    | REQ-033    | User can unlink social provider                          | Confirms unlink with 2 methods; blocked with 1                        |
| AT-034-A    | Canonical user ID unchanged after social linking          | REQ-034    | Linking/unlinking does not create new DB records         | Confirms exactly one User record; UUIDv4 unchanged                    |
| AT-035-A    | Authorized personnel can initiate impersonation           | REQ-035    | Impersonation available to authorized personnel          | Confirms scoped session token issued                                  |
| AT-036-A    | Impersonation flag and impersonator identity in logs      | REQ-036    | Impersonation sessions flagged in audit logs             | Confirms audit log entries during impersonation                       |
| AT-037-A    | Destructive actions blocked during impersonation          | REQ-037    | Impersonation cannot perform destructive actions         | Confirms password change, deletion, MFA modification rejected         |
| AT-038-A    | Unauthenticated API requests receive 401                  | REQ-038    | All API endpoints require valid access token             | Confirms 401 for missing and expired tokens                           |
| AT-039-A    | JWT validation covers signature, expiry, audience, issuer | REQ-039    | API Gateway authorizer validates JWT claims              | Confirms 401 for unknown key and wrong audience                       |
| AT-040-A    | User ID claim present in access token                     | REQ-040    | Access token includes Commise user ID                    | Confirms UUIDv4 available without DB lookup                           |
| AT-041-A    | Suspension applied in both systems                        | REQ-041    | Suspension blocks user in IdP and DB                     | Confirms IdP blocked + DB status = suspended                          |
| AT-042-A    | API returns 403 for suspended users                       | REQ-042    | Suspended user denied access with valid token            | Confirms 403 for suspended user with valid token                      |
| AT-043-A    | Suspension message shown on login                         | REQ-043    | Suspended user sees clear message                        | Confirms specific suspension message (not generic error)              |
| AT-044-A    | Reactivated user can log in and access API                | REQ-044    | Reactivation restores access                             | Confirms login succeeds and API returns 200                           |
| AT-NF-004-A | Auth UI elements queryable without data-testid            | REQ-NF-004 | Auth UI accessible via role/label queries                | Confirms getByRole/getByLabel finds all interactive elements          |
| AT-NF-007-A | Typecheck, lint, and format pass with zero errors         | REQ-NF-007 | CI quality gates pass                                    | Confirms all three turbo commands exit 0                              |
| AT-NF-012-A | Backend functions emit JSON logs to CloudWatch            | REQ-NF-012 | Structured JSON logs with correlation IDs                | Confirms valid JSON with correlation ID and ISO 8601 timestamp        |
| AT-NF-013-A | Auth flow errors appear as Sentry issues                  | REQ-NF-013 | Unhandled exceptions surface in Sentry                   | Confirms Sentry issue with stack trace and request context            |
| AT-NF-014-A | Auth metrics visible in CloudWatch                        | REQ-NF-014 | CloudWatch custom metrics emitted                        | Confirms success/failure counts with correct dimensions               |
| AT-NF-015-A | Client Sentry captures failed login and token refresh     | REQ-NF-015 | Client-side auth errors captured by Sentry               | Confirms Sentry event with breadcrumbs                                |
| AT-NF-016-A | Trace IDs propagate from client to backend                | REQ-NF-016 | Distributed tracing across auth flows                    | Confirms single trace spans client → API GW → backend                 |
| AT-IF-008-A | Post-registration action calls Commise backend            | REQ-IF-008 | Post-registration action creates records via backend API | Confirms backend receives sub + UUIDv4 and creates records            |
| AT-IF-009-A | Authorizer response is a valid IAM policy document        | REQ-IF-009 | API Gateway authorizer returns standard IAM policy       | Confirms Allow/Deny IAM policy for valid/invalid JWT                  |
| AT-IF-010-A | Reconciliation endpoint processes IdP user data           | REQ-IF-010 | Reconciliation endpoint accepts IdP user list            | Confirms missing records created and repair summary returned          |
| AT-CN-002-A | No password data in Commise API or database               | REQ-CN-002 | Passwords never handled by Commise backend               | Confirms no password fields/hashes/logic in any component             |
| AT-CN-003-A | IdP sub not used as primary key in database               | REQ-CN-003 | UUIDv4 is canonical user identifier                      | Confirms sub used only for IdP API calls                              |

---

## Matrix C: Integration Verification

> Integration-level requirements verified at module boundaries (ARCH-level). Unit tests (UTP) verify internal module logic; integration tests verify cross-module contracts.

| Integration Point                                      | REQ-IDs                            | MOD Boundary                          | UTP Coverage                            | Integration Test Status | Notes                                                                        |
| ------------------------------------------------------ | ---------------------------------- | ------------------------------------- | --------------------------------------- | ----------------------- | ---------------------------------------------------------------------------- |
| Web Auth Route Handler → IdP token endpoint            | REQ-001, REQ-005                   | MOD-001 ↔ IdP `/oauth/token`          | UTP-001-B (exchangeCodeForTokens)       | ⬜                      | Integration test needed: real IdP sandbox token exchange                     |
| Web Middleware → Session Cookie Manager                | REQ-003, REQ-007, REQ-009          | MOD-002 ↔ MOD-003                     | UTP-002-A (getSessionFromCookie mocked) | ⬜                      | Integration test needed: middleware reads real encrypted cookie              |
| Web Session Cookie Manager → AES-256-GCM crypto        | REQ-006                            | MOD-003 internal                      | UTP-003-B (round-trip, no mocks)        | ⬜                      | Covered by unit test with real crypto; no additional integration test needed |
| Web JWT Decoder → jose library                         | REQ-039, REQ-040                   | MOD-004 ↔ jose                        | UTP-004-A (jose used directly)          | ⬜                      | Integration test needed: validate against real IdP JWKS                      |
| Web Route Protector → Session Cookie Manager           | REQ-003, REQ-009                   | MOD-005 ↔ MOD-003                     | UTP-005-A (getSession mocked)           | ⬜                      | Integration test needed: requireAuth with real session                       |
| Mobile IdP Client → IdP SDK                            | REQ-001, REQ-007                   | MOD-006 ↔ IdP SDK                     | UTP-006-A (IdpClient mocked)            | ⬜                      | Integration test needed: real SDK token refresh flow                         |
| Post-Registration IdP server-side handler → Commise DB | REQ-013, REQ-014, REQ-015, REQ-016 | IdP server-side handler ↔ DB          | No UTP (backend action)                 | ⬜                      | Integration test needed: action → DB write with retry                        |
| API Gateway Authorizer → IdP JWKS                      | REQ-038, REQ-039, REQ-042          | Lambda Authorizer ↔ IdP JWKS endpoint | No UTP (authorizer module)              | ⬜                      | Integration test needed: authorizer validates real JWT                       |
| Account Deletion → IdP Backend API                     | REQ-024                            | Backend handler ↔ IdP Backend API     | No UTP (deletion handler)               | ⬜                      | Integration test needed: deletion cascades to IdP                            |
| Reconciliation Job → IdP Backend API + DB              | REQ-017, REQ-IF-010                | Reconciliation ↔ IdP + DB             | No UTP (reconciliation module)          | ⬜                      | Integration test needed: reconciliation creates missing records              |

---

## Matrix D: Implementation Verification

> Maps module designs (MOD) to unit test cases (UTP) and their scenarios (UTS). Verifies implementation completeness at the code level.

| MOD-ID  | Module Name                   | Source File                                                  | ARCH Parent | UTP Cases            | UTS Scenarios                                          | Implementation Status |
| ------- | ----------------------------- | ------------------------------------------------------------ | ----------- | -------------------- | ------------------------------------------------------ | --------------------- |
| MOD-001 | Web Auth Route Handler        | `packages/apps/commise/web/app/api/auth/[...clerk]/route.ts` | ARCH-001    | UTP-001-A, UTP-001-B | UTS-001-A1 through A5, UTS-001-B1 through B3 (8 total) | ⬜                    |
| MOD-002 | Web Auth Middleware Guard     | `packages/apps/commise/web/middleware.ts`                    | ARCH-002    | UTP-002-A            | UTS-002-A1 through A5 (5 total)                        | ⬜                    |
| MOD-003 | Web Session Cookie Manager    | `packages/apps/commise/web/lib/auth/session-manager.ts`      | ARCH-003    | UTP-003-A, UTP-003-B | UTS-003-A1 through A4, UTS-003-B1 through B3 (7 total) | ⬜                    |
| MOD-004 | Web JWT Decoder               | `packages/apps/commise/web/lib/auth/jwt-decoder.ts`          | ARCH-004    | UTP-004-A            | UTS-004-A1 through A3 (3 total)                        | ⬜                    |
| MOD-005 | Web Route Protector           | `packages/apps/commise/web/lib/auth/route-protector.ts`      | ARCH-005    | UTP-005-A            | UTS-005-A1 through A3 (3 total)                        | ⬜                    |
| MOD-006 | Mobile IdP Client SDK Wrapper | `packages/apps/commise/mobile/lib/auth/idp-client.ts`        | ARCH-006    | UTP-006-A            | UTS-006-A1 through A4 (4 total)                        | ⬜                    |

### UTP → REQ Traceability (Implementation → Requirement)

| UTP-ID    | Module                                | Technique                                              | REQ-IDs Covered                             | UTS Count | Status |
| --------- | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------- | --------- | ------ |
| UTP-001-A | MOD-001 Web Auth Route Handler        | Statement & Branch Coverage                            | REQ-001, REQ-005, REQ-010, REQ-011, REQ-012 | 5         | ⬜     |
| UTP-001-B | MOD-001 Web Auth Route Handler        | Statement Coverage + Equivalence Partitioning          | REQ-005                                     | 3         | ⬜     |
| UTP-002-A | MOD-002 Web Auth Middleware Guard     | Statement & Branch Coverage                            | REQ-003, REQ-009                            | 5         | ⬜     |
| UTP-003-A | MOD-003 Web Session Cookie Manager    | Statement Coverage + Equivalence Partitioning          | REQ-006, REQ-007, REQ-008                   | 4         | ⬜     |
| UTP-003-B | MOD-003 Web Session Cookie Manager    | Boundary Value Analysis + Statement Coverage           | REQ-006                                     | 3         | ⬜     |
| UTP-004-A | MOD-004 Web JWT Decoder               | Statement & Branch Coverage + Equivalence Partitioning | REQ-039, REQ-040                            | 3         | ⬜     |
| UTP-005-A | MOD-005 Web Route Protector           | Statement & Branch Coverage                            | REQ-003, REQ-009                            | 3         | ⬜     |
| UTP-006-A | MOD-006 Mobile IdP Client SDK Wrapper | Statement & Branch Coverage                            | REQ-001, REQ-007                            | 4         | ⬜     |

---

## Matrix H: Hazard Traceability

> Security and safety hazards linked to requirements and their mitigations. Derived from the security-critical nature of the auth feature.

| HAZ-ID  | Hazard Description                                     | Severity | REQ-IDs                      | Mitigation                                                                                    | Verification                      | Status |
| ------- | ------------------------------------------------------ | -------- | ---------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------- | ------ |
| HAZ-001 | Authorization code interception (PKCE bypass)          | Critical | REQ-001                      | PKCE with S256 code challenge enforced on all clients                                         | AT-001-A, AT-001-B                | ⬜     |
| HAZ-002 | Token theft via XSS (web)                              | Critical | REQ-006                      | httpOnly, Secure, SameSite cookies; no JS-accessible token storage                            | AT-006-A                          | ⬜     |
| HAZ-003 | Token theft via app data extraction (mobile)           | Critical | REQ-006                      | Keychain (iOS) / Keystore (Android) via expo-secure-store                                     | AT-006-B                          | ⬜     |
| HAZ-004 | Session fixation / state parameter tampering           | High     | REQ-005                      | State parameter validated on callback; mismatch throws AuthCallbackError                      | AT-005-A (ATS-005-A2), UTS-001-A4 | ⬜     |
| HAZ-005 | Refresh token reuse after logout                       | High     | REQ-011                      | Refresh token revoked via IdP revocation endpoint on logout                                   | AT-011-A                          | ⬜     |
| HAZ-006 | Orphaned IdP user without Commise record               | Medium   | REQ-016, REQ-017             | Retry with exponential backoff; reconciliation job as safety net                              | AT-016-A, AT-017-A                | ⬜     |
| HAZ-007 | Password exposure through Commise backend              | Critical | REQ-028, REQ-CN-002          | All password management delegated to the IdP; no password fields in Commise                   | AT-028-A, AT-CN-002-A             | ⬜     |
| HAZ-008 | Unauthorized API access with expired/invalid JWT       | Critical | REQ-038, REQ-039             | API Gateway authorizer validates signature, expiry, audience, issuer on every request         | AT-038-A, AT-039-A                | ⬜     |
| HAZ-009 | Suspended user retains API access via valid token      | High     | REQ-042                      | Authorizer checks suspension status in addition to JWT validity; returns 403                  | AT-042-A                          | ⬜     |
| HAZ-010 | Impersonation used for destructive actions             | High     | REQ-037                      | Impersonation scope explicitly excludes password change, deletion, MFA modification           | AT-037-A                          | ⬜     |
| HAZ-011 | Impersonation actions not attributable to impersonator | Medium   | REQ-036                      | All impersonation requests include impersonation flag and impersonator identity in audit logs | AT-036-A                          | ⬜     |
| HAZ-012 | Accidental account deletion (no confirmation)          | Medium   | REQ-023                      | Explicit "DELETE" confirmation required before deletion proceeds                              | AT-023-A                          | ⬜     |
| HAZ-013 | IdP vendor lock-in via sub as primary identifier       | Low      | REQ-CN-003                   | UUIDv4 is canonical identifier; IdP sub used only for IdP API calls                           | AT-CN-003-A                       | ⬜     |
| HAZ-014 | Cookie decryption failure exposes stale session        | High     | REQ-006                      | AES-256-GCM auth tag mismatch triggers clearSession; tampered cookies rejected                | UTS-003-B2, UTS-003-A4            | ⬜     |
| HAZ-015 | Missing GDPR compliance on account deletion            | High     | REQ-024, REQ-025, REQ-CN-004 | Hard delete of User, Account, and all owned data from DB and IdP; no soft-delete              | AT-024-A, AT-025-A                | ⬜     |

---

## Coverage Audit

### Functional Requirements Coverage

| Category                                  | Total REQs | REQs with AT | REQs Inspection-Only | REQs with No Coverage   | Coverage % |
| ----------------------------------------- | ---------- | ------------ | -------------------- | ----------------------- | ---------- |
| Functional (REQ-001 to REQ-044)           | 44         | 44           | 0                    | 0                       | **100%**   |
| Non-Functional (REQ-NF-001 to REQ-NF-017) | 17         | 7            | 9                    | 1 (REQ-NF-017 Analysis) | **94%**    |
| Interface (REQ-IF-001 to REQ-IF-010)      | 10         | 3            | 7                    | 0                       | **100%**   |
| Constraint (REQ-CN-001 to REQ-CN-008)     | 8          | 2            | 6                    | 0                       | **100%**   |
| **Total**                                 | **79**     | **56**       | **22**               | **1**                   | **98.7%**  |

> Note: "Inspection-Only" requirements are verified by code review and static analysis, not by executable tests. They are fully covered by their stated verification method.

### Unit Test Coverage

| MOD-ID    | Module                        | UTP Cases | UTS Scenarios | Techniques Applied                                             |
| --------- | ----------------------------- | --------- | ------------- | -------------------------------------------------------------- |
| MOD-001   | Web Auth Route Handler        | 2         | 8             | Statement & Branch, Equivalence Partitioning, Strict Isolation |
| MOD-002   | Web Auth Middleware Guard     | 1         | 5             | Statement & Branch, Strict Isolation                           |
| MOD-003   | Web Session Cookie Manager    | 2         | 7             | Statement, Equivalence Partitioning, Boundary Value Analysis   |
| MOD-004   | Web JWT Decoder               | 1         | 3             | Statement & Branch, Equivalence Partitioning                   |
| MOD-005   | Web Route Protector           | 1         | 3             | Statement & Branch, Strict Isolation                           |
| MOD-006   | Mobile IdP Client SDK Wrapper | 1         | 4             | Statement & Branch, Strict Isolation                           |
| **Total** | —                             | **8**     | **30**        | All 5 ISO 29119-4 techniques represented                       |

### Acceptance Test Coverage

| Tier                               | AT Cases         | ATS Scenarios         | Platforms Covered         |
| ---------------------------------- | ---------------- | --------------------- | ------------------------- |
| Functional (AT-001 through AT-044) | 47 AT cases      | ~80 ATS scenarios     | Web, Mobile, Backend, API |
| Non-Functional (AT-NF-\*)          | 6 AT cases       | 6 ATS scenarios       | All                       |
| Interface (AT-IF-\*)               | 3 AT cases       | 4 ATS scenarios       | Backend, API              |
| Constraint (AT-CN-\*)              | 2 AT cases       | 2 ATS scenarios       | Backend                   |
| **Total**                          | **~58 AT cases** | **~92 ATS scenarios** | All platforms             |

---

## Orphan & Gap Report

### Orphan Analysis

**Orphan ATs** (acceptance tests with no corresponding REQ):

> None identified. All AT cases in `acceptance-plan.md` map to a REQ-\* identifier via the naming convention (AT-NNN-X → REQ-NNN).

**Orphan UTPs** (unit test cases with no corresponding MOD):

> None identified. All UTP cases in `unit-test.md` map to a MOD-NNN identifier.

**Orphan REQs** (requirements with no verification path):

> None identified. All 79 requirements have at least one verification method (Test, Inspection, or Analysis).

### Gap Analysis

**Requirements with no executable acceptance test (Inspection/Analysis only)**:

These requirements are verified by code review, static analysis, or architectural analysis — not by executable test scenarios. They are **not gaps** but are flagged for completeness:

| REQ-ID     | Verification Method | Risk Level | Mitigation                                                                                       |
| ---------- | ------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| REQ-NF-001 | Inspection          | Low        | TypeScript strict mode enforced by CI (`turbo run typecheck`) — partially covered by AT-NF-007-A |
| REQ-NF-002 | Inspection          | Low        | JSDoc coverage reviewable via linting rules                                                      |
| REQ-NF-003 | Inspection          | Low        | Import paths enforced by ESLint rules — partially covered by AT-NF-007-A                         |
| REQ-NF-005 | Inspection          | Medium     | WCAG color contrast requires manual or automated a11y audit                                      |
| REQ-NF-006 | Inspection          | Low        | Workspace config verifiable by CI                                                                |
| REQ-NF-008 | Inspection          | Medium     | Test pyramid ratio requires coverage reporting tooling                                           |
| REQ-NF-009 | Inspection          | Low        | Custom error patterns verifiable by code review                                                  |
| REQ-NF-010 | Inspection          | Low        | ISO 8601 date types verifiable by TypeScript strict mode                                         |
| REQ-NF-011 | Inspection          | Low        | Design token usage verifiable by linting                                                         |
| REQ-NF-017 | Analysis            | Low        | Architectural constraint; no executable test possible                                            |
| REQ-IF-001 | Inspection          | Low        | SDK version pinned in package.json                                                               |
| REQ-IF-002 | Inspection          | Low        | SDK version pinned in package.json                                                               |
| REQ-IF-003 | Inspection          | Low        | expo-secure-store usage verifiable by code review                                                |
| REQ-IF-004 | Inspection          | Low        | Library usage verifiable by code review                                                          |
| REQ-IF-005 | Inspection          | Low        | SQS SDK usage verifiable by code review                                                          |
| REQ-IF-006 | Inspection          | Low        | Sentry + Powertools usage verifiable by code review                                              |
| REQ-IF-007 | Inspection          | Low        | CDK v2 usage verifiable by code review                                                           |
| REQ-CN-001 | Inspection          | Low        | Node.js version pinned in `.nvmrc` and `package.json` engines                                    |
| REQ-CN-004 | Inspection          | Low        | No soft-delete verifiable by schema review                                                       |
| REQ-CN-005 | Inspection          | Low        | Out-of-scope constraint; no test needed                                                          |
| REQ-CN-006 | Inspection          | Low        | Out-of-scope constraint; no test needed                                                          |
| REQ-CN-007 | Inspection          | Low        | CDK-only constraint verifiable by IaC review                                                     |
| REQ-CN-008 | Inspection          | Low        | Workspace config verifiable by CI                                                                |

**Modules with no unit test coverage** (implementation gaps):

| Gap                                       | Description                                                                             | Risk   | Recommendation                                                                                                               |
| ----------------------------------------- | --------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Post-Registration IdP server-side handler | No MOD or UTP defined for the IdP server-side handler that creates User/Account records | High   | Define MOD-007 and UTP-007 covering retry logic (REQ-016), UUIDv4 generation (REQ-013, REQ-015), and DB write                |
| API Gateway Lambda Authorizer             | No MOD or UTP defined for the JWT validation authorizer                                 | High   | Define MOD-008 and UTP-008 covering JWT validation (REQ-039), suspension check (REQ-042), IAM policy generation (REQ-IF-009) |
| Account Deletion Handler                  | No MOD or UTP defined for the deletion backend handler                                  | Medium | Define MOD-009 and UTP-009 covering DB cascade (REQ-025) and IdP Backend API call (REQ-024)                                  |
| Reconciliation Job                        | No MOD or UTP defined for the reconciliation mechanism                                  | Medium | Define MOD-010 and UTP-010 covering IdP user list processing (REQ-017, REQ-IF-010)                                           |
| Social Linking Handler                    | No MOD or UTP defined for social account link/unlink                                    | Medium | Define MOD-011 and UTP-011 covering Management API calls (REQ-032, REQ-033, REQ-034)                                         |
| Impersonation Handler                     | No MOD or UTP defined for impersonation mechanism                                       | Medium | Define MOD-012 and UTP-012 covering scope restrictions (REQ-037) and audit logging (REQ-036)                                 |

**Integration test gaps**:

All 10 integration points identified in Matrix C lack defined integration test cases. Integration tests are required to verify cross-module contracts and are not covered by the current unit test plan or acceptance test plan.

**Recommendation**: Create an integration test plan (`integration-test.md`) covering the 10 integration points in Matrix C before implementation begins.

---

_Traceability matrix generated from source artifacts dated 2026-05-09. Re-baseline required after any requirement change, acceptance plan update, or unit test plan amendment._
