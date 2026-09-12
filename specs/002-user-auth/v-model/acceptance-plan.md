# Acceptance Test Plan: User Authentication

**Feature Branch**: `002-user-auth`
**Created**: 2026-05-09
**Status**: Draft
**Source**: `specs/002-user-auth/v-model/requirements.md`, `specs/002-user-auth/v-model/system-test.md`

---

## Overview

This plan maps BDD acceptance scenarios to every REQ-\* requirement in `requirements.md`. Each scenario is written from the end-user or operator perspective (not the component perspective — that is covered by the system test plan). Acceptance tests confirm that the feature satisfies its stated requirements as a whole, across both the web (Next.js) and mobile (Expo) platforms.

System tests (STP/STS) verify architectural behavior at the component boundary. Acceptance tests (AT/ATS) verify observable outcomes from the user's point of view. Where a system test already covers a behavior mechanically, the acceptance test confirms the same behavior through the product surface (UI, API response, or audit log).

Coverage: all 44 functional requirements (REQ-001 through REQ-044), 17 non-functional requirements (REQ-NF-001 through REQ-NF-017), 10 interface requirements (REQ-IF-001 through REQ-IF-010), and 7 constraint requirements (REQ-CN-001 through REQ-CN-007).

---

## ID Schema

| Identifier               | Pattern      | Meaning                                                                                                 |
| ------------------------ | ------------ | ------------------------------------------------------------------------------------------------------- |
| Acceptance Test Case     | `AT-NNN-X`   | NNN matches the parent REQ number; X is a letter suffix (A, B, C...) for multiple cases per requirement |
| Acceptance Test Scenario | `ATS-NNN-X#` | Nested under the parent AT; # is a numeric suffix (1, 2, 3...) for multiple scenarios per case          |

**Example**: `ATS-001-A1` is Scenario 1 of Test Case A verifying REQ-001.

Non-functional, interface, and constraint requirements use the full ID prefix in the case identifier:

| Identifier               | Pattern       | Example       |
| ------------------------ | ------------- | ------------- |
| Non-functional test case | `AT-NF-NNN-X` | `AT-NF-001-A` |
| Interface test case      | `AT-IF-NNN-X` | `AT-IF-001-A` |
| Constraint test case     | `AT-CN-NNN-X` | `AT-CN-001-A` |

---

## Acceptance Test Cases (Tier 1-3 Structure)

---

### Tier 1 — Epic: User Authenticates via the IdP

---

#### Tier 2 — REQ-001: PKCE Authorization Code Flow (Web + Mobile)

**AT-001-A** — Web login initiates PKCE flow

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web (Next.js)          |

**ATS-001-A1**

- **Given** a user has no active session and navigates to a protected web route
- **When** the browser follows the redirect chain
- **Then** the user lands on the IdP login page and the URL contains `code_challenge` and `code_challenge_method=S256`

**ATS-001-A2**

- **Given** the IdP login page is displayed
- **When** the user completes login with valid credentials
- **Then** the user is redirected back to the originally requested route and is authenticated

---

**AT-001-B** — Mobile login initiates PKCE flow

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Mobile (Expo)          |

**ATS-001-B1**

- **Given** the mobile app has no stored session tokens
- **When** the app launches
- **Then** the IdP login UI appears and the underlying authorization request includes `code_challenge` and `code_challenge_method=S256`

---

#### Tier 2 — REQ-002: Mobile auto-displays auth screen before app content

**AT-002-A** — No app content visible before authentication on mobile

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Mobile (Expo)          |

**ATS-002-A1**

- **Given** the mobile app is freshly installed with no stored tokens
- **When** the app launches
- **Then** the IdP login screen is the first screen the user sees; no recipe or app content is visible

**ATS-002-A2**

- **Given** the user has previously logged out (tokens cleared)
- **When** the app is reopened
- **Then** the IdP login screen appears immediately, before any app content renders

---

#### Tier 2 — REQ-003: Web redirects unauthenticated users to IdP login

**AT-003-A** — Protected web routes redirect to IdP

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web (Next.js)          |

**ATS-003-A1**

- **Given** a user is not authenticated
- **When** they navigate directly to any protected route (e.g., `/dashboard`, `/recipes`)
- **Then** the browser redirects to the IdP login page; the protected page content is not rendered

**ATS-003-A2**

- **Given** a user is not authenticated
- **When** they navigate to a public route (e.g., `/`)
- **Then** the page renders without redirecting to the IdP

---

#### Tier 2 — REQ-004: Social login (Google) supported

**AT-004-A** — Google social login completes successfully

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-004-A1**

- **Given** the IdP login page is displayed
- **When** the user clicks "Continue with Google" and completes Google OAuth consent
- **Then** the user is authenticated and returned to the app as a logged-in user

**ATS-004-A2**

- **Given** the user cancels the Google OAuth consent screen
- **When** the callback is received
- **Then** the user is returned to the login page with no session created and an appropriate message is shown

---

#### Tier 2 — REQ-005: IdP callback exchanges code for tokens

**AT-005-A** — Callback handler completes token exchange

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-005-A1**

- **Given** the user has completed IdP login
- **When** the IdP redirects to the app callback URI
- **Then** the app exchanges the authorization code for tokens and the user is fully authenticated (no additional login prompt)

**ATS-005-A2**

- **Given** the callback URI receives a tampered or replayed state parameter
- **When** the callback handler processes the request
- **Then** authentication fails, no session is created, and the user sees an error message

---

#### Tier 2 — REQ-006: Tokens stored securely

**AT-006-A** — Web tokens stored in httpOnly cookies

| Field     | Detail                  |
| --------- | ----------------------- |
| Technique | Boundary Value Analysis |
| Platform  | Web (Next.js)           |

**ATS-006-A1**

- **Given** a user has successfully authenticated on the web
- **When** the browser's cookie storage is inspected via JavaScript (`document.cookie`)
- **Then** the auth session cookie is not readable from JavaScript (httpOnly enforced)

---

**AT-006-B** — Mobile tokens stored in secure storage

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Mobile (Expo)          |

**ATS-006-B1**

- **Given** a user has successfully authenticated on mobile
- **When** the device's app data directory is inspected (non-root access)
- **Then** no plaintext tokens are found in accessible storage locations

---

#### Tier 2 — REQ-007: Silent token refresh on expiry

**AT-007-A** — Access token refreshes silently

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-007-A1**

- **Given** a user is authenticated and their access token has expired
- **When** the user performs any action that triggers an API call
- **Then** the app silently refreshes the access token and the action completes without prompting the user to log in again

**ATS-007-A2**

- **Given** both the access token and refresh token have expired
- **When** the user performs any action that triggers an API call
- **Then** the user is redirected to the login screen (web) or the IdP login UI is shown (mobile)

---

#### Tier 2 — REQ-008: Session persists across app restarts

**AT-008-A** — Session survives app restart

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-008-A1**

- **Given** a user is authenticated with a valid refresh token
- **When** the app is closed and reopened (mobile) or the browser tab is closed and reopened (web)
- **Then** the user remains authenticated without being prompted to log in again

---

#### Tier 2 — REQ-009: Session invalidated on token expiry with no valid refresh token

**AT-009-A** — Expired session forces re-authentication

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-009-A1**

- **Given** a user's refresh token has expired or been revoked
- **When** the app attempts to refresh the access token
- **Then** the session is cleared and the user is presented with the login screen

---

#### Tier 2 — REQ-010: Logout clears all local tokens

**AT-010-A** — Logout removes tokens from local storage

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-010-A1**

- **Given** a user is authenticated
- **When** the user triggers logout
- **Then** all local tokens are cleared; subsequent API calls from the same client receive `401 Unauthorized`

---

#### Tier 2 — REQ-011: Logout revokes refresh token in IdP

**AT-011-A** — Refresh token revoked server-side on logout

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-011-A1**

- **Given** a user has logged out
- **When** the previously issued refresh token is used to request a new access token
- **Then** the IdP rejects the request (token revoked) and no new access token is issued

---

#### Tier 2 — REQ-012: Post-logout navigation

**AT-012-A** — User lands on correct screen after logout

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-012-A1**

- **Given** a user is authenticated on the web
- **When** they log out
- **Then** the browser redirects to the IdP login page

**ATS-012-A2**

- **Given** a user is authenticated on mobile
- **When** they log out
- **Then** the IdP login screen is displayed

---

### Tier 1 — Epic: User Account Created on Signup

---

#### Tier 2 — REQ-013: Post-registration action creates User record

**AT-013-A** — New signup creates a User record in the database

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-013-A1**

- **Given** a new user completes IdP signup for the first time
- **When** the user.created webhook post-registration handler runs
- **Then** a User record with a UUIDv4 ID exists in the Commise database linked to the IdP `sub`

---

#### Tier 2 — REQ-014: Post-registration action creates Account record

**AT-014-A** — New signup creates an Account record

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-014-A1**

- **Given** a new user completes IdP signup
- **When** the user.created webhook action completes
- **Then** an Account record associated with the new User exists in the Commise database

---

#### Tier 2 — REQ-015: User ID stored in IdP app_metadata

**AT-015-A** — UUIDv4 user ID present in access token claims

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-015-A1**

- **Given** a user has completed signup and logs in
- **When** the access token is decoded
- **Then** the token contains the Commise UUIDv4 user ID as a custom claim sourced from `app_metadata`

---

#### Tier 2 — REQ-016: Post-registration action retries on transient failure

**AT-016-A** — Transient DB failure does not orphan IdP user

| Field     | Detail          |
| --------- | --------------- |
| Technique | Fault Injection |
| Platform  | Backend         |

**ATS-016-A1**

- **Given** the Commise database is temporarily unavailable during signup
- **When** the user.created webhook action runs and encounters a transient error
- **Then** the action retries up to 3 times with exponential backoff and ultimately creates the User and Account records once the database recovers

**ATS-016-A2**

- **Given** the database remains unavailable for all 3 retry attempts
- **When** the user.created webhook action exhausts retries
- **Then** the failure is logged and the IdP user exists without a Commise record (to be resolved by reconciliation — REQ-017)

---

#### Tier 2 — REQ-017: Reconciliation mechanism detects and repairs missing records

**AT-017-A** — Reconciliation creates missing User/Account records

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend                |

**ATS-017-A1**

- **Given** an IdP user exists without a corresponding Commise User record
- **When** the reconciliation job or endpoint runs
- **Then** the missing User and Account records are created and the IdP user's `app_metadata` is updated with the generated UUIDv4

---

### Tier 1 — Epic: User Manages Their Profile

---

#### Tier 2 — REQ-018: Profile page displays user data

**AT-018-A** — Profile page shows correct user information

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-018-A1**

- **Given** a user is authenticated
- **When** they navigate to their profile page
- **Then** the page displays their display name, email, avatar, and account creation date sourced from the Commise database

---

#### Tier 2 — REQ-019: Account edit page allows display name and avatar changes

**AT-019-A** — User can edit display name and avatar

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-019-A1**

- **Given** a user is on the account edit page
- **When** they update their display name and avatar and save
- **Then** the changes are accepted and the profile page reflects the updated values

---

#### Tier 2 — REQ-020: Account edits persisted to database

**AT-020-A** — Edits survive session restart

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-020-A1**

- **Given** a user has saved changes to their display name and avatar
- **When** they log out and log back in
- **Then** the profile page still shows the updated display name and avatar

---

#### Tier 2 — REQ-021: Email field is read-only on account edit page

**AT-021-A** — Email cannot be edited in the app

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-021-A1**

- **Given** a user is on the account edit page
- **When** they view the email field
- **Then** the field is read-only and a note directs them to the IdP for email changes

---

#### Tier 2 — REQ-022: Empty display name is rejected

**AT-022-A** — Validation prevents empty display name

| Field     | Detail                  |
| --------- | ----------------------- |
| Technique | Boundary Value Analysis |
| Platform  | Web + Mobile            |

**ATS-022-A1**

- **Given** a user is on the account edit page
- **When** they clear the display name field and attempt to save
- **Then** the save is blocked and a validation error message is displayed

---

### Tier 1 — Epic: User Deletes Their Account

---

#### Tier 2 — REQ-023: Account deletion requires explicit confirmation

**AT-023-A** — Deletion confirmation gate enforced

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-023-A1**

- **Given** a user initiates account deletion
- **When** the confirmation dialog appears
- **Then** the delete action is not available until the user types "DELETE" in the confirmation field

**ATS-023-A2**

- **Given** the confirmation dialog is shown
- **When** the user types anything other than "DELETE"
- **Then** the confirm button remains disabled

---

#### Tier 2 — REQ-024: Confirmed deletion removes records from database and IdP

**AT-024-A** — Account deletion removes all records

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-024-A1**

- **Given** a user has confirmed account deletion
- **When** the deletion completes
- **Then** the User and Account records no longer exist in the Commise database AND the user no longer exists in the IdP

---

#### Tier 2 — REQ-025: Deletion cascades to all user-owned data

**AT-025-A** — User-owned data removed on account deletion

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend                |

**ATS-025-A1**

- **Given** a user has recipes and meal plans in the database
- **When** their account is deleted
- **Then** all recipes, meal plans, and other user-owned records are also deleted from the database

---

#### Tier 2 — REQ-026: Post-deletion navigation

**AT-026-A** — User returned to unauthenticated state after deletion

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-026-A1**

- **Given** a user's account deletion has completed
- **When** the deletion flow finishes
- **Then** the user is logged out and returned to the authentication screen (mobile) or IdP login page (web)

---

### Tier 1 — Epic: User Resets Password

---

#### Tier 2 — REQ-027: Password reset accessible from login screen

**AT-027-A** — "Forgot Password" link present and functional

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-027-A1**

- **Given** the IdP login screen is displayed
- **When** the user clicks "Forgot Password"
- **Then** the IdP password reset flow is initiated and the user receives a reset email

---

#### Tier 2 — REQ-028: Passwords never handled by Commise backend

**AT-028-A** — No password data in Commise API traffic

| Field     | Detail     |
| --------- | ---------- |
| Technique | Inspection |
| Platform  | Backend    |

**ATS-028-A1**

- **Given** a user completes the password reset flow
- **When** all network traffic to the Commise backend is inspected
- **Then** no password or password-related data appears in any request or response to Commise endpoints

---

### Tier 1 — Epic: User Enrolls in MFA

---

#### Tier 2 — REQ-029: MFA enrollment accessible from account settings

**AT-029-A** — MFA enrollment entry point present

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-029-A1**

- **Given** a user is on the account settings page
- **When** they look for MFA options
- **Then** an option to enroll in MFA is visible and navigates to the IdP MFA enrollment flow

---

#### Tier 2 — REQ-030: TOTP supported as MFA method

**AT-030-A** — TOTP enrollment completes successfully

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-030-A1**

- **Given** a user initiates MFA enrollment
- **When** they select TOTP (authenticator app) and scan the QR code
- **Then** enrollment completes and the authenticator app generates valid TOTP codes for the account

---

#### Tier 2 — REQ-031: MFA required on all subsequent logins after enrollment

**AT-031-A** — MFA challenge appears on login after enrollment

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-031-A1**

- **Given** a user has enrolled in MFA
- **When** they log out and attempt to log in again
- **Then** the IdP prompts for the second factor before granting access

---

### Tier 1 — Epic: User Links Social Accounts

---

#### Tier 2 — REQ-032: User can link additional social providers

**AT-032-A** — Social account linking from account settings

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-032-A1**

- **Given** a user is on the account settings page and has not linked Google
- **When** they initiate "Link Google account" and complete the Google OAuth flow
- **Then** Google is listed as a linked provider on their account settings page

---

#### Tier 2 — REQ-033: User can unlink a social provider (with at least one remaining)

**AT-033-A** — Social account unlinking enforces minimum login method

| Field     | Detail                  |
| --------- | ----------------------- |
| Technique | Boundary Value Analysis |
| Platform  | Web + Mobile            |

**ATS-033-A1**

- **Given** a user has two linked login methods (e.g., email/password and Google)
- **When** they unlink Google
- **Then** Google is removed from their linked providers and they can still log in with email/password

**ATS-033-A2**

- **Given** a user has only one linked login method
- **When** they attempt to unlink it
- **Then** the action is blocked and an error message explains that at least one login method must remain

---

#### Tier 2 — REQ-034: Linking/unlinking does not create new database records

**AT-034-A** — Canonical user ID unchanged after social linking

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend                |

**ATS-034-A1**

- **Given** a user links a Google account to their existing identity
- **When** the database is queried for User records matching their IdP `sub`
- **Then** exactly one User record exists with the same UUIDv4 as before linking

---

### Tier 1 — Epic: Support Personnel Impersonate Users

---

#### Tier 2 — REQ-035: Impersonation available to authorized personnel

**AT-035-A** — Authorized personnel can initiate impersonation

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend / API          |

**ATS-035-A1**

- **Given** an authorized support engineer has the required permissions
- **When** they initiate impersonation of a target user via the impersonation mechanism
- **Then** they receive a session token scoped to the target user's identity

---

#### Tier 2 — REQ-036: Impersonation sessions flagged in audit logs

**AT-036-A** — Impersonation flag and impersonator identity in logs

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend                |

**ATS-036-A1**

- **Given** a support engineer is impersonating a user
- **When** any API request is made during the impersonation session
- **Then** the audit log entry includes an impersonation flag and the impersonator's identity

---

#### Tier 2 — REQ-037: Impersonation cannot perform destructive actions

**AT-037-A** — Destructive actions blocked during impersonation

| Field     | Detail                   |
| --------- | ------------------------ |
| Technique | Equivalence Partitioning |
| Platform  | Backend / API            |

**ATS-037-A1**

- **Given** a support engineer is impersonating a user
- **When** they attempt to change the impersonated user's password
- **Then** the request is rejected with an appropriate error

**ATS-037-A2**

- **Given** a support engineer is impersonating a user
- **When** they attempt to delete the impersonated user's account
- **Then** the request is rejected with an appropriate error

**ATS-037-A3**

- **Given** a support engineer is impersonating a user
- **When** they attempt to modify the impersonated user's MFA settings
- **Then** the request is rejected with an appropriate error

---

### Tier 1 — Epic: API Access Requires Valid Auth

---

#### Tier 2 — REQ-038: All API endpoints require a valid access token

**AT-038-A** — Unauthenticated API requests receive 401

| Field     | Detail                   |
| --------- | ------------------------ |
| Technique | Equivalence Partitioning |
| Platform  | API                      |

**ATS-038-A1**

- **Given** a request is made to any Commise API endpoint without an Authorization header
- **When** the API Gateway processes the request
- **Then** the response is `401 Unauthorized`

**ATS-038-A2**

- **Given** a request is made with an expired access token
- **When** the API Gateway authorizer validates the token
- **Then** the response is `401 Unauthorized`

---

#### Tier 2 — REQ-039: API Gateway authorizer validates JWT claims

**AT-039-A** — JWT validation covers signature, expiry, audience, and issuer

| Field     | Detail                  |
| --------- | ----------------------- |
| Technique | Boundary Value Analysis |
| Platform  | API                     |

**ATS-039-A1**

- **Given** a request is made with a JWT signed by an unknown key
- **When** the authorizer validates the token
- **Then** the response is `401 Unauthorized`

**ATS-039-A2**

- **Given** a request is made with a JWT with an incorrect audience claim
- **When** the authorizer validates the token
- **Then** the response is `401 Unauthorized`

---

#### Tier 2 — REQ-040: Access token includes Commise user ID as custom claim

**AT-040-A** — User ID claim present in access token

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | API                    |

**ATS-040-A1**

- **Given** a user is authenticated and makes an API request
- **When** the API handler reads the decoded token
- **Then** the Commise UUIDv4 user ID is available as a custom claim without an additional database lookup

---

### Tier 1 — Epic: User Suspension and Reactivation

---

#### Tier 2 — REQ-041: Suspending a user blocks them in IdP and the database

**AT-041-A** — Suspension applied in both systems

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend / API          |

**ATS-041-A1**

- **Given** an admin triggers user suspension via the backend API
- **When** the suspension completes
- **Then** the user is blocked in the IdP AND the User entity `status` is `suspended` in the Commise database

---

#### Tier 2 — REQ-042: Suspended user denied access even with a valid token

**AT-042-A** — API returns 403 for suspended users

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | API                    |

**ATS-042-A1**

- **Given** a user has been suspended and holds a currently valid access token
- **When** they make an API request with that token
- **Then** the API Gateway authorizer returns `403 Forbidden`

---

#### Tier 2 — REQ-043: Suspended user sees a clear message on login attempt

**AT-043-A** — Suspension message shown on login

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile           |

**ATS-043-A1**

- **Given** a user's account is suspended
- **When** they attempt to log in
- **Then** they see a clear message indicating their account has been suspended (not a generic error)

---

#### Tier 2 — REQ-044: Reactivation restores access

**AT-044-A** — Reactivated user can log in and access the API

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Web + Mobile + API     |

**ATS-044-A1**

- **Given** a suspended user has been reactivated via the backend API
- **When** they attempt to log in
- **Then** login succeeds and API requests return `200 OK` (not `403`)

---

### Tier 1 — Epic: Non-Functional Quality Gates

---

#### Tier 2 — REQ-NF-004: Auth UI accessible via role/label queries

**AT-NF-004-A** — Auth UI elements queryable without data-testid

| Field     | Detail                            |
| --------- | --------------------------------- |
| Technique | Inspection / Automated Playwright |
| Platform  | Web + Mobile                      |

**ATS-NF-004-A1**

- **Given** the login, profile, account edit, and deletion confirmation screens are rendered
- **When** Playwright queries elements using `getByRole` or `getByLabel`
- **Then** all interactive elements are found without using `data-testid` selectors

---

#### Tier 2 — REQ-NF-007: CI quality gates pass

**AT-NF-007-A** — Typecheck, lint, and format pass with zero errors

| Field     | Detail    |
| --------- | --------- |
| Technique | Test (CI) |
| Platform  | All       |

**ATS-NF-007-A1**

- **Given** all auth-related code is committed
- **When** `turbo run typecheck`, `turbo run lint`, and `turbo run format:check` are executed
- **Then** all three commands exit with code 0 and zero errors

---

#### Tier 2 — REQ-NF-012: Structured logs emitted with correlation IDs

**AT-NF-012-A** — Backend functions emit JSON logs to CloudWatch

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend                |

**ATS-NF-012-A1**

- **Given** a login callback, token refresh, or user.created webhook action executes
- **When** CloudWatch Logs are queried for the corresponding log group
- **Then** log entries are valid JSON containing a correlation ID and an ISO 8601 timestamp

---

#### Tier 2 — REQ-NF-013: Unhandled exceptions surface in Sentry

**AT-NF-013-A** — Auth flow errors appear as Sentry issues

| Field     | Detail          |
| --------- | --------------- |
| Technique | Fault Injection |
| Platform  | Backend         |

**ATS-NF-013-A1**

- **Given** an unhandled exception occurs in an auth flow (e.g., user.created webhook action)
- **When** the Sentry dashboard is checked
- **Then** a Sentry issue exists with a full stack trace and request context for the exception

---

#### Tier 2 — REQ-NF-014: CloudWatch custom metrics emitted

**AT-NF-014-A** — Auth metrics visible in CloudWatch

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend                |

**ATS-NF-014-A1**

- **Given** login, token refresh, signup, account deletion, and reconciliation flows have executed
- **When** CloudWatch Metrics are queried for the auth namespace
- **Then** success and failure counts for each flow are present with correct environment and platform dimensions

---

#### Tier 2 — REQ-NF-015: Client-side auth errors captured by Sentry

**AT-NF-015-A** — Client Sentry captures failed login and token refresh events

| Field     | Detail          |
| --------- | --------------- |
| Technique | Fault Injection |
| Platform  | Web + Mobile    |

**ATS-NF-015-A1**

- **Given** a token refresh failure occurs on the client
- **When** the Sentry dashboard is checked
- **Then** a Sentry event exists with breadcrumbs showing the preceding auth state transitions

---

#### Tier 2 — REQ-NF-016: Distributed tracing across auth flows

**AT-NF-016-A** — Trace IDs propagate from client to backend

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | All                    |

**ATS-NF-016-A1**

- **Given** a user makes an authenticated API request
- **When** the trace is inspected in AWS X-Ray or the OpenTelemetry backend
- **Then** a single trace spans from the client request through the API Gateway authorizer to the backend handler

---

### Tier 1 — Epic: Interface and Constraint Compliance

---

#### Tier 2 — REQ-IF-008: Post-registration action creates records via backend API

**AT-IF-008-A** — Post-registration action calls Commise backend

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend                |

**ATS-IF-008-A1**

- **Given** a new user completes IdP signup
- **When** the user.created webhook post-registration handler runs
- **Then** the Commise backend receives a call containing the IdP `sub` claim and the generated UUIDv4, and creates the User and Account records

---

#### Tier 2 — REQ-IF-009: API Gateway authorizer returns standard IAM policy

**AT-IF-009-A** — Authorizer response is a valid IAM policy document

| Field     | Detail                     |
| --------- | -------------------------- |
| Technique | Interface Contract Testing |
| Platform  | API                        |

**ATS-IF-009-A1**

- **Given** a valid JWT is presented to the API Gateway authorizer
- **When** the authorizer Lambda returns its response
- **Then** the response is a valid IAM policy document with `Allow` effect for the requested resource

**ATS-IF-009-A2**

- **Given** an invalid or expired JWT is presented
- **When** the authorizer Lambda returns its response
- **Then** the response is a valid IAM policy document with `Deny` effect

---

#### Tier 2 — REQ-IF-010: Reconciliation endpoint accepts IdP user list

**AT-IF-010-A** — Reconciliation endpoint processes IdP user data

| Field     | Detail                 |
| --------- | ---------------------- |
| Technique | Scenario-Based Testing |
| Platform  | Backend                |

**ATS-IF-010-A1**

- **Given** the reconciliation endpoint or scheduled job receives a list of IdP users
- **When** it identifies users without Commise records
- **Then** it creates the missing records and returns a summary of repairs made

---

#### Tier 2 — REQ-CN-002: Passwords never handled by Commise backend

**AT-CN-002-A** — No password data in Commise API or database

| Field     | Detail     |
| --------- | ---------- |
| Technique | Inspection |
| Platform  | Backend    |

**ATS-CN-002-A1**

- **Given** all Commise API endpoints and database schemas are reviewed
- **When** inspected for any password storage, processing, or transmission
- **Then** no password fields, password hashes, or password-related logic exist in any Commise component

---

#### Tier 2 — REQ-CN-003: UUIDv4 is the canonical user identifier

**AT-CN-003-A** — IdP sub not used as primary key in database

| Field     | Detail     |
| --------- | ---------- |
| Technique | Inspection |
| Platform  | Backend    |

**ATS-CN-003-A1**

- **Given** the Commise database schema and application logic are reviewed
- **When** inspected for use of the IdP `sub` claim as a primary identifier
- **Then** the `sub` is used only for IdP API calls; all internal references use the UUIDv4 user ID

---

## Acceptance Criteria per REQ

| REQ        | Pre-condition                                                 | Success Condition                                                                                      | Technique                  |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------- |
| REQ-001    | IdP tenant configured; PKCE enabled for both clients          | User authenticates on web and mobile; decoded auth request contains `code_challenge` and `S256`        | Scenario-Based Testing     |
| REQ-002    | Mobile app installed with no stored tokens                    | IdP login screen is the first rendered screen; no app content visible before auth                      | Scenario-Based Testing     |
| REQ-003    | Next.js app running; no session cookie present                | Browser redirects to IdP login on any protected route; public routes unaffected                        | Scenario-Based Testing     |
| REQ-004    | Google social connection enabled in IdP tenant                | User completes Google OAuth and is authenticated in the app                                            | Scenario-Based Testing     |
| REQ-005    | IdP has issued a valid authorization code                     | App exchanges code for tokens; user is fully authenticated                                             | Scenario-Based Testing     |
| REQ-006    | User has completed authentication on web and mobile           | Web: auth cookie not readable via `document.cookie`; Mobile: no plaintext tokens in accessible storage | Boundary Value Analysis    |
| REQ-007    | User authenticated; access token expired; refresh token valid | API call succeeds without login prompt; new access token issued silently                               | Scenario-Based Testing     |
| REQ-008    | User authenticated with valid refresh token                   | User remains authenticated after app restart / tab reopen                                              | Scenario-Based Testing     |
| REQ-009    | Refresh token expired or revoked                              | Session cleared; user presented with login screen                                                      | Scenario-Based Testing     |
| REQ-010    | User is authenticated                                         | After logout, API calls return `401`; no tokens in local storage                                       | Scenario-Based Testing     |
| REQ-011    | User has logged out                                           | Previously issued refresh token rejected by IdP                                                        | Scenario-Based Testing     |
| REQ-012    | User has logged out                                           | Web: redirected to IdP login; Mobile: IdP login screen shown                                           | Scenario-Based Testing     |
| REQ-013    | New user completes IdP signup                                 | User record with UUIDv4 exists in Commise database                                                     | Scenario-Based Testing     |
| REQ-014    | New user completes IdP signup                                 | Account record associated with User exists in database                                                 | Scenario-Based Testing     |
| REQ-015    | User has signed up and logged in                              | Decoded access token contains Commise UUIDv4 as custom claim                                           | Scenario-Based Testing     |
| REQ-016    | Database temporarily unavailable during signup                | User and Account records created after database recovers; no orphaned IdP user                         | Fault Injection            |
| REQ-017    | IdP user exists without Commise records                       | Reconciliation creates missing records; `app_metadata` updated                                         | Scenario-Based Testing     |
| REQ-018    | User is authenticated                                         | Profile page displays display name, email, avatar, and creation date from database                     | Scenario-Based Testing     |
| REQ-019    | User is on account edit page                                  | Display name and avatar fields are editable and changes are accepted                                   | Scenario-Based Testing     |
| REQ-020    | User has saved profile edits                                  | Edits persist after logout and re-login                                                                | Scenario-Based Testing     |
| REQ-021    | User is on account edit page                                  | Email field is read-only; note directs to IdP for changes                                              | Inspection                 |
| REQ-022    | User is on account edit page                                  | Save blocked when display name is empty; validation error shown                                        | Boundary Value Analysis    |
| REQ-023    | User initiates account deletion                               | Delete action unavailable until "DELETE" is typed; button disabled otherwise                           | Scenario-Based Testing     |
| REQ-024    | User has confirmed deletion                                   | User and Account records absent from database; user absent from IdP                                    | Scenario-Based Testing     |
| REQ-025    | User with recipes/meal plans confirms deletion                | All user-owned records removed from database                                                           | Scenario-Based Testing     |
| REQ-026    | Account deletion completed                                    | User logged out and returned to auth screen                                                            | Scenario-Based Testing     |
| REQ-027    | IdP login screen displayed                                    | "Forgot Password" link initiates IdP reset flow; user receives reset email                             | Scenario-Based Testing     |
| REQ-028    | User completes password reset                                 | No password data in any Commise API request or response                                                | Inspection                 |
| REQ-029    | User is on account settings page                              | MFA enrollment option visible and navigates to IdP MFA flow                                            | Scenario-Based Testing     |
| REQ-030    | User initiates MFA enrollment                                 | TOTP enrollment completes; authenticator app generates valid codes                                     | Scenario-Based Testing     |
| REQ-031    | User has enrolled in MFA                                      | IdP prompts for second factor on every subsequent login                                                | Scenario-Based Testing     |
| REQ-032    | User on account settings; Google not linked                   | Google listed as linked provider after completing OAuth flow                                           | Scenario-Based Testing     |
| REQ-033    | User has two linked login methods                             | Unlinking one succeeds; unlinking the last is blocked with error                                       | Boundary Value Analysis    |
| REQ-034    | User links or unlinks a social provider                       | Exactly one User record with unchanged UUIDv4 exists in database                                       | Scenario-Based Testing     |
| REQ-035    | Authorized support engineer with required permissions         | Impersonation session token issued scoped to target user                                               | Scenario-Based Testing     |
| REQ-036    | Support engineer is impersonating a user                      | Audit log entries contain impersonation flag and impersonator identity                                 | Scenario-Based Testing     |
| REQ-037    | Support engineer is impersonating a user                      | Password change, account deletion, and MFA modification requests rejected                              | Equivalence Partitioning   |
| REQ-038    | API endpoint exists                                           | Requests without token return `401`; requests with expired token return `401`                          | Equivalence Partitioning   |
| REQ-039    | API Gateway authorizer deployed                               | Requests with wrong key or audience return `401`                                                       | Boundary Value Analysis    |
| REQ-040    | User is authenticated and makes API request                   | Decoded token contains Commise UUIDv4 as custom claim                                                  | Scenario-Based Testing     |
| REQ-041    | Admin triggers suspension via backend API                     | User blocked in IdP; User entity `status` = `suspended` in database                                    | Scenario-Based Testing     |
| REQ-042    | User is suspended; holds valid access token                   | API Gateway returns `403 Forbidden`                                                                    | Scenario-Based Testing     |
| REQ-043    | User account is suspended                                     | Login attempt shows suspension message (not generic error)                                             | Scenario-Based Testing     |
| REQ-044    | Suspended user has been reactivated                           | Login succeeds; API requests return `200 OK`                                                           | Scenario-Based Testing     |
| REQ-NF-004 | Auth UI screens rendered                                      | All interactive elements found via `getByRole`/`getByLabel`; no `data-testid` needed                   | Inspection / Automated     |
| REQ-NF-007 | All auth code committed                                       | `turbo run typecheck`, `lint`, `format:check` exit 0 with zero errors                                  | Test (CI)                  |
| REQ-NF-012 | Auth backend functions executed                               | CloudWatch log entries are valid JSON with correlation ID and ISO 8601 timestamp                       | Scenario-Based Testing     |
| REQ-NF-013 | Unhandled exception triggered in auth flow                    | Sentry issue exists with full stack trace and request context                                          | Fault Injection            |
| REQ-NF-014 | Auth flows executed across environments                       | CloudWatch custom metrics present for all flow types with correct dimensions                           | Scenario-Based Testing     |
| REQ-NF-015 | Client-side token refresh failure triggered                   | Sentry event exists with breadcrumbs for preceding auth state transitions                              | Fault Injection            |
| REQ-NF-016 | Authenticated API request made                                | Single trace spans client through API Gateway to backend in X-Ray / OTel                               | Scenario-Based Testing     |
| REQ-IF-008 | New user completes IdP signup                                 | Commise backend receives call with `sub` and UUIDv4; records created                                   | Scenario-Based Testing     |
| REQ-IF-009 | JWT presented to API Gateway authorizer                       | Valid JWT returns Allow policy; invalid JWT returns Deny policy                                        | Interface Contract Testing |
| REQ-IF-010 | IdP user list provided to reconciliation endpoint             | Missing records created; repair summary returned                                                       | Scenario-Based Testing     |
| REQ-CN-002 | All Commise API endpoints and schemas reviewed                | No password fields, hashes, or password logic in any Commise component                                 | Inspection                 |
| REQ-CN-003 | Database schema and application logic reviewed                | IdP `sub` used only for IdP API calls; UUIDv4 used for all internal references                         | Inspection                 |

---

## Feature Test Summary Matrix

| Requirement | BDD Scenario Count | Test Method                | Pass Criteria                                                      |
| ----------- | ------------------ | -------------------------- | ------------------------------------------------------------------ |
| REQ-001     | 3                  | Scenario-Based Testing     | PKCE params present in auth request on both platforms              |
| REQ-002     | 2                  | Scenario-Based Testing     | Auth screen shown before any app content on mobile                 |
| REQ-003     | 2                  | Scenario-Based Testing     | Protected routes redirect; public routes do not                    |
| REQ-004     | 2                  | Scenario-Based Testing     | Google login completes; cancellation handled gracefully            |
| REQ-005     | 2                  | Scenario-Based Testing     | Code exchanged for tokens; tampered state rejected                 |
| REQ-006     | 2                  | Boundary Value Analysis    | httpOnly enforced on web; no plaintext tokens on mobile            |
| REQ-007     | 2                  | Scenario-Based Testing     | Silent refresh succeeds; expired refresh forces re-auth            |
| REQ-008     | 1                  | Scenario-Based Testing     | Session survives restart                                           |
| REQ-009     | 1                  | Scenario-Based Testing     | Expired refresh clears session                                     |
| REQ-010     | 1                  | Scenario-Based Testing     | Tokens cleared; subsequent calls return 401                        |
| REQ-011     | 1                  | Scenario-Based Testing     | Revoked refresh token rejected by IdP                              |
| REQ-012     | 2                  | Scenario-Based Testing     | Correct post-logout destination on each platform                   |
| REQ-013     | 1                  | Scenario-Based Testing     | User record with UUIDv4 created in database                        |
| REQ-014     | 1                  | Scenario-Based Testing     | Account record created and associated with User                    |
| REQ-015     | 1                  | Scenario-Based Testing     | UUIDv4 present as custom claim in access token                     |
| REQ-016     | 2                  | Fault Injection            | Records created after recovery; failure logged on exhaustion       |
| REQ-017     | 1                  | Scenario-Based Testing     | Missing records created by reconciliation                          |
| REQ-018     | 1                  | Scenario-Based Testing     | Profile page shows correct data from database                      |
| REQ-019     | 1                  | Scenario-Based Testing     | Display name and avatar editable and accepted                      |
| REQ-020     | 1                  | Scenario-Based Testing     | Edits persist after logout and re-login                            |
| REQ-021     | 1                  | Inspection                 | Email field read-only with IdP redirect note                       |
| REQ-022     | 1                  | Boundary Value Analysis    | Empty display name blocked with validation error                   |
| REQ-023     | 2                  | Scenario-Based Testing     | Delete gated on "DELETE" confirmation; button disabled otherwise   |
| REQ-024     | 1                  | Scenario-Based Testing     | Records absent from database and IdP after deletion                |
| REQ-025     | 1                  | Scenario-Based Testing     | All user-owned data removed on deletion                            |
| REQ-026     | 1                  | Scenario-Based Testing     | User returned to auth screen after deletion                        |
| REQ-027     | 1                  | Scenario-Based Testing     | Password reset flow initiated; reset email received                |
| REQ-028     | 1                  | Inspection                 | No password data in Commise API traffic                            |
| REQ-029     | 1                  | Scenario-Based Testing     | MFA enrollment option present and functional                       |
| REQ-030     | 1                  | Scenario-Based Testing     | TOTP enrollment completes; valid codes generated                   |
| REQ-031     | 1                  | Scenario-Based Testing     | Second factor required on every login after enrollment             |
| REQ-032     | 1                  | Scenario-Based Testing     | Google listed as linked provider after OAuth flow                  |
| REQ-033     | 2                  | Boundary Value Analysis    | Unlink succeeds with 2+ methods; blocked with 1 method             |
| REQ-034     | 1                  | Scenario-Based Testing     | One User record with unchanged UUIDv4 after linking                |
| REQ-035     | 1                  | Scenario-Based Testing     | Impersonation token issued to authorized personnel                 |
| REQ-036     | 1                  | Scenario-Based Testing     | Impersonation flag and impersonator identity in audit logs         |
| REQ-037     | 3                  | Equivalence Partitioning   | Password change, deletion, MFA modification all rejected           |
| REQ-038     | 2                  | Equivalence Partitioning   | No token returns 401; expired token returns 401                    |
| REQ-039     | 2                  | Boundary Value Analysis    | Wrong key returns 401; wrong audience returns 401                  |
| REQ-040     | 1                  | Scenario-Based Testing     | UUIDv4 present as custom claim in decoded token                    |
| REQ-041     | 1                  | Scenario-Based Testing     | User blocked in IdP and status = suspended in database             |
| REQ-042     | 1                  | Scenario-Based Testing     | Valid token from suspended user returns 403                        |
| REQ-043     | 1                  | Scenario-Based Testing     | Suspension message shown (not generic error)                       |
| REQ-044     | 1                  | Scenario-Based Testing     | Login succeeds; API returns 200 after reactivation                 |
| REQ-NF-004  | 1                  | Inspection / Automated     | All auth UI elements queryable via role/label                      |
| REQ-NF-007  | 1                  | Test (CI)                  | typecheck, lint, format:check all exit 0                           |
| REQ-NF-012  | 1                  | Scenario-Based Testing     | JSON logs with correlation ID and ISO 8601 timestamp in CloudWatch |
| REQ-NF-013  | 1                  | Fault Injection            | Sentry issue with stack trace on unhandled exception               |
| REQ-NF-014  | 1                  | Scenario-Based Testing     | Custom metrics present for all flow types in CloudWatch            |
| REQ-NF-015  | 1                  | Fault Injection            | Sentry event with breadcrumbs on client-side auth failure          |
| REQ-NF-016  | 1                  | Scenario-Based Testing     | Single trace spans client to backend in X-Ray / OTel               |
| REQ-IF-008  | 1                  | Scenario-Based Testing     | Backend receives call with sub and UUIDv4; records created         |
| REQ-IF-009  | 2                  | Interface Contract Testing | Valid JWT returns Allow; invalid JWT returns Deny                  |
| REQ-IF-010  | 1                  | Scenario-Based Testing     | Missing records created; repair summary returned                   |
| REQ-CN-002  | 1                  | Inspection                 | No password data in any Commise component                          |
| REQ-CN-003  | 1                  | Inspection                 | IdP sub used only for IdP calls; UUIDv4 used internally            |
| **Total**   | **~70**            |                            |                                                                    |

---

## Exit Criteria

The feature is considered shippable when all of the following conditions are met:

### Functional Completeness

- All 44 functional acceptance test cases (AT-001 through AT-044) have been executed and passed.
- Zero P1 or P2 acceptance test cases are failing or blocked.
- P3 test cases (REQ-029, REQ-030, REQ-031) may be deferred to a follow-up release with explicit sign-off from the product owner.

### Non-Functional Completeness

- REQ-NF-007: `turbo run typecheck`, `turbo run lint`, and `turbo run format:check` all pass with zero errors in CI.
- REQ-NF-004: All auth UI screens pass Playwright accessibility queries (`getByRole`/`getByLabel`) with no `data-testid` usage.
- REQ-NF-012: Structured JSON logs with correlation IDs confirmed in CloudWatch for at least one successful execution of each auth flow.
- REQ-NF-013: Sentry integration confirmed by triggering a test exception and verifying the issue appears in the Sentry dashboard.
- REQ-NF-014: CloudWatch custom metrics confirmed present for login, signup, token refresh, account deletion, and reconciliation flows.

### Security Gates

- REQ-CN-002: Inspection confirms no password data exists in any Commise component.
- REQ-CN-003: Inspection confirms IdP `sub` is not used as a primary identifier in the database or application logic.
- REQ-006: Token storage security confirmed on both platforms (httpOnly cookies on web; Keychain/Keystore on mobile).
- REQ-028: Inspection confirms no password data passes through Commise API traffic.

### Regression

- No existing passing tests in the repository have been broken by this feature's changes.
- `turbo run test` passes with zero failures across all workspaces.

### Documentation and Traceability

- All test files include a block comment mapping requirement IDs to test case descriptions (REQ-NF-008).
- This acceptance plan is up to date and all AT/ATS IDs are traceable to a REQ in `requirements.md`.

### Deployment Readiness

- Infrastructure defined in CDK v2 deploys successfully to the staging environment.
- IdP tenant configuration (user.created webhook post-registration handler, social connections, PKCE settings) is applied and verified in staging.
- Reconciliation job or endpoint is deployed and has executed at least one successful run in staging.
