# Product Specification: Commise - User Authentication

**Branch**: `002-user-auth`
**Date**: 2026-05-09
**Status**: Draft
**Source**: [spec.md](../spec.md)

---

## Vision

Commise authentication should feel invisible when healthy and explicit when security boundaries are crossed. Users should get fast, predictable access across web and mobile, while account lifecycle actions (profile updates, deletion, suspension, MFA, and provider linking) remain understandable, auditable, and safe.

**Tagline**: "Secure access, zero friction, full lifecycle control."

**Core principles**:

- Access is default-deny at API boundaries; every protected call is authenticated and policy-checked.
- Session continuity is optimized, but revocation and suspension take precedence over convenience.
- Account identity is canonical and stable across the IdP and local database synchronization.
- Destructive and privileged actions are explicit, reversible where possible, and observable.

---

## Personas

### Persona 1 (Primary): P1 Casey — Beginner Cook

**Canonical ID**: P1
**Archetype**: Beginner Cook
**Core Motivation**: Build confidence, guided cooking, accessible UX

**Auth-specific goals and pain points**:

- Wants social login (Google, Apple) so signup takes seconds with no password to remember.
- Expects a single tap to get into the app; any multi-step friction causes drop-off.
- Confused by error messages that don't explain what went wrong or what to do next.
- Needs a clear, low-stakes password reset flow when they inevitably forget credentials.
- Frustrated by being logged out unexpectedly mid-session while following a recipe.

---

### Persona 2 (Secondary): P8 Alex — Power Cook

**Canonical ID**: P8
**Archetype**: Commise Power User
**Core Motivation**: Multi-feature daily power use, integrations, automation

**Auth-specific goals and pain points**:

- Relies on persistent sessions across web and mobile simultaneously; silent token refresh must be seamless.
- Switches devices mid-cook and expects the same authenticated state on each without re-logging in.
- Wants MFA enabled for account security without it adding friction to daily logins.
- Needs social provider linking (e.g., adding Apple ID to an existing email account) to work without creating duplicate identities.
- Expects clear feedback when a session is revoked or a device is removed, not a silent failure.

---

### Persona 3 (Tertiary): P9 Drew — Pro Chef

**Canonical ID**: P9
**Archetype**: Professional Chef
**Core Motivation**: Restaurant prep, scaled batches, brand presence

**Auth-specific goals and pain points**:

- Cares about account integrity; any unauthorized access to their profile or recipes is a brand risk.
- Wants MFA enforced and visible as a trust signal, not buried in settings.
- Expects account deletion and data export to be explicit, documented, and auditable.
- Needs profile identity (name, handle) to remain stable and canonical across all auth providers linked to the account.
- Sensitive to any public-facing auth errors that could expose account state to third parties.

---

## Internal Stakeholders

### Support/Admin Operator

**Role**: Authorized support and engineering personnel who manage account lifecycle outside the normal user flow.

**Responsibilities**:

- **Account recovery**: Trigger password resets and unblock locked accounts on behalf of users who cannot self-serve.
- **Suspension and reactivation**: Enforce account suspension quickly and consistently via backend/admin APIs; reactivate deterministically when the underlying issue resolves.
- **Audit log review**: Inspect privileged-action logs (impersonation sessions, suspension events, deletion requests) to attribute actions and satisfy compliance requirements.
- **Impersonation diagnostics** _(withdrawn 2026-10-15)_: Perform impersonation-backed debugging with explicit audit identity recorded; no anonymous privileged sessions permitted.

---

## Epic Breakdown

### Epic A: Authentication Entry and Session Foundation

Covers signup/login/callback/session refresh/logout across web and mobile, including secure storage and token propagation.

### Epic B: Identity Synchronization and Account Lifecycle

Covers user.created webhook sync, profile and account editing, destructive deletion with async retry, and consistency reconciliation.

### Epic C: Security Controls and Privileged Operations

Covers password reset delegation, MFA enrollment, social provider linking, impersonation safeguards, API authorization, and suspension/reactivation.

---

## MoSCoW Story Map (FR-Traceable)

### Must Have (P1)

#### US-001 — Cross-platform Auth Entry and Callback

As a new user, I can authenticate on web/mobile and complete callback token exchange so I can enter Commise securely.

**FRs**: FR-001, FR-002, FR-003, FR-004, FR-005

---

#### US-002 — Secure Session Persistence and Refresh

As a returning user, my tokens are securely stored and silently refreshed so I can keep using the app without repeated login interruption.

**FRs**: FR-006, FR-007, FR-008, FR-009

---

#### US-003 — Deterministic Logout

As an authenticated user, I can logout and fully invalidate local/remote session continuity so no stale authenticated state remains.

**FRs**: FR-010, FR-011, FR-012

---

#### US-004 — Signup-to-Database Identity Synchronization

As a newly registered user, my identity is synchronized to Commise User/Account records with stable canonical ID, retry protection, and reconciliation fallback.

**FRs**: FR-013, FR-014, FR-015, FR-016, FR-017

---

#### US-005 — API Authorization Gate

As a platform owner, every protected API call must pass token and claim validation so unauthorized traffic is always rejected.

**FRs**: FR-038, FR-039, FR-040

---

### Should Have (P2)

#### US-006 — Profile Visibility and Account Editing

As a user, I can view profile data and update mutable account fields while immutable identity fields are clearly constrained.

**FRs**: FR-018, FR-019, FR-020, FR-021

---

#### US-007 — Account Deletion with Eventual IdP Consistency

As a user, I can permanently delete my account with explicit confirmation, immediate local data removal, and resilient IdP deletion retry behavior.

**FRs**: FR-022, FR-023, FR-024, FR-025, FR-026

---

#### US-008 — Password Reset Entry

As a locked-out user, I can launch password reset through the IdP without exposing password handling to Commise backend services.

**FRs**: FR-027, FR-028

---

#### US-009 — Social Provider Linking Lifecycle

As a user, I can link/unlink social providers without identity duplication and while preserving at least one valid login method.

**FRs**: FR-032, FR-033, FR-034

---

#### US-010 — Suspended Account Enforcement and Reactivation

As an operator, I can suspend/reactivate users with consistent deny-path behavior and clear user-facing suspension messaging.

**FRs**: FR-041, FR-042, FR-043, FR-044

---

### Could Have (P3)

#### US-011 — MFA Enrollment and Enforcement

As a security-conscious user, I can enroll MFA (TOTP) and receive second-factor prompts on future login attempts.

**FRs**: FR-029, FR-030, FR-031

---

#### US-012 — Operator Impersonation with Audit Safety — **WITHDRAWN (2026-10-15)**

> Owner ruling 2026-10-15: "Delete the impersonation then". The stub routes granted nothing, so they are deleted. FR-035/FR-036/FR-037 are withdrawn. What remains: an impersonated (Clerk `act`) session is refused on web and mobile.

As an authorized support operator, I can impersonate users for diagnostics with explicit session marking and restricted destructive actions.

**FRs**: FR-035, FR-036, FR-037

---

## Out of Scope

Inherited from `spec.md` and unchanged in this product-spec layer:

- Email change flow in Commise UI (IdP-managed outside this feature)
- Admin dashboard for user management

---

## Traceability Matrix (Story → FR)

| Story ID | FR Coverage    |
| -------- | -------------- |
| US-001   | FR-001..FR-005 |
| US-002   | FR-006..FR-009 |
| US-003   | FR-010..FR-012 |
| US-004   | FR-013..FR-017 |
| US-005   | FR-038..FR-040 |
| US-006   | FR-018..FR-021 |
| US-007   | FR-022..FR-026 |
| US-008   | FR-027..FR-028 |
| US-009   | FR-032..FR-034 |
| US-010   | FR-041..FR-044 |
| US-011   | FR-029..FR-031 |
| US-012   | FR-035..FR-037 |

All functional requirements FR-001..FR-044 are covered exactly once or more by the story map.
