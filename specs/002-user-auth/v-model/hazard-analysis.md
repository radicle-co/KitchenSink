# Hazard Analysis (FMEA): User Authentication

**Feature Branch**: `002-user-auth`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/002-user-auth/v-model/system-design.md`
**Standard**: General-Purpose FMEA (non-regulated software; `domain: ''` in `v-model-config.yml`)

## Overview

This document presents the Failure Mode and Effects Analysis (FMEA) for the **User Authentication** feature. Every system component (`SYS-001`..`SYS-020`) from `system-design.md` is assessed for realistic failure modes in authentication, authorization, account lifecycle management, and infrastructure support. Each hazard receives a unique `HAZ-NNN` identifier and is linked to risk-control measures (`REQ-NNN` / `SYS-NNN` / `ARCH-NNN` / `MOD-NNN`), enabling the traceability chain: Hazard → Mitigation → Requirement → Test Case (Matrix H in `traceability-matrix.md`).

**Non-regulated context.** Commise is a consumer recipe management application. There are no life-safety, vehicle-control, medical-device, or aviation-control concerns. Severity is measured against **user trust, data integrity, privacy, availability, and platform cost** — not personal injury. Safety-critical taxonomies (ISO 26262 ASIL, DO-178C DAL, IEC 62304) are intentionally **not** applied; `v-model-config.yml` sets `domain: ''`.

## ID Schema

- **Hazard ID**: `HAZ-{NNN}` — 3-digit zero-padded, sequential (HAZ-001, HAZ-002, ...). Never renumbered.
- **Lineage**: From any `HAZ-NNN`, the Mitigation column lists `REQ-NNN`, `SYS-NNN`, `ARCH-NNN`, and where useful `MOD-NNN` references. The full chain to verification test cases (`ATP-NNN`, `STP-NNN`, `ITP-NNN`, `UTP-NNN`) lives in `traceability-matrix.md` (Matrix H — Hazard Traceability).

## Risk Matrix Definition

### Severity Scale (consumer SaaS — recipe app)

| Level        | Definition                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catastrophic | Cross-tenant data leak, broad unauthorized access, persistent loss of user-owned recipe data, or platform-wide outage.                                                 |
| Critical     | Individual-user data loss without recovery, sustained sharing-circle audience misroute, security control bypass for one user, or sustained core-flow outage (≥1 hour). |
| Serious      | Recoverable degradation: failed digitization batch with retry path, single-job audience-state stalled, transient endpoint 5xx with idempotent retry.                   |
| Minor        | Annoyance: slow OCR turnaround, suboptimal parse quality, transient UI error with self-recovery.                                                                       |
| Negligible   | Cosmetic only: log noise, telemetry drift, copy/wording inconsistency.                                                                                                 |

### Likelihood Scale

| Level      | Definition                                                                   |
| ---------- | ---------------------------------------------------------------------------- |
| Frequent   | Expected on a regular cadence under normal load (≥1× per day in production). |
| Probable   | Expected occasionally (≥1× per week per 1k MAU).                             |
| Occasional | Expected rarely (≥1× per month per 1k MAU).                                  |
| Remote     | Possible under unusual conditions (≥1× per quarter at small scale).          |
| Improbable | Conceivable only under stacked failure or adversarial conditions.            |

### Risk Level Matrix

|              | Frequent     | Probable     | Occasional   | Remote      | Improbable  |
| ------------ | ------------ | ------------ | ------------ | ----------- | ----------- |
| Catastrophic | Unacceptable | Unacceptable | Unacceptable | Undesirable | Undesirable |
| Critical     | Unacceptable | Unacceptable | Undesirable  | Undesirable | Tolerable   |
| Serious      | Unacceptable | Undesirable  | Undesirable  | Tolerable   | Tolerable   |
| Minor        | Undesirable  | Tolerable    | Tolerable    | Tolerable   | Acceptable  |
| Negligible   | Tolerable    | Tolerable    | Acceptable   | Acceptable  | Acceptable  |

**Disposition rule**: `Unacceptable` MUST be mitigated to `Undesirable` or lower before release. `Undesirable` MUST have explicit residual-risk acceptance recorded in this document. `Tolerable`/`Acceptable` are accepted as-is.

## Operational States

`system-design.md` does not define formal operational states for the authentication subsystem; the implicit state is **NORMAL** (steady-state production). The following modes are referenced where hazards are state-dependent:

| State                  | Definition                                                                 | Source                    |
| ---------------------- | -------------------------------------------------------------------------- | ------------------------- |
| NORMAL                 | Steady-state authentication and API authorization under expected load.     | Implicit                  |
| -DEGRADED              | IdP tenant/API degradation, timeout, or regional outage conditions.        | SYS-001, SYS-002, SYS-005 |
| KEY-ROTATION-WINDOW    | Active signing key/client secret rotation period with mixed key validity.  | SYS-015, SYS-018          |
| SUSPENSION-ENFORCEMENT | User/account status transition (suspend/reactivate) in propagation window. | SYS-016, SYS-015          |

⚠️ No formally enumerated operational states exist in `system-design.md`. State-dependent severity is captured with the implicit modes above; if `system-design.md` later introduces a formal state taxonomy, this section MUST be reconciled.

## Hazard Register (FMEA)

> One or more `HAZ-NNN` per `SYS-NNN`. Mitigations cite existing `REQ-NNN`, `SYS-NNN`, `ARCH-NNN`, or `MOD-NNN` identifiers only.

### SYS-001 — Web Auth Client (Next.js)

| HAZ ID  | Component | Failure Mode                                                          | Operational State | Effect                                                         | Severity | Likelihood | Risk Level  | Mitigation                                                                 | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------------- | ------------- |
| HAZ-001 | SYS-001   | Callback `state` parameter tampering (callback CSRF) accepted.        | NORMAL            | Attacker binds victim session to attacker-controlled identity. | Critical | Occasional | Undesirable | REQ-005; ARCH-001; MOD-001 validates callback state cookie.                | Tolerable     |
| HAZ-002 | SYS-001   | Session fixation via reused/unchanged web session cookie after login. | NORMAL            | Unauthorized continuation of authenticated session.            | Critical | Remote     | Undesirable | REQ-006; REQ-010; ARCH-003 rotates session identifiers on auth transition. | Tolerable     |

### SYS-002 — Mobile Auth Client (Expo)

| HAZ ID  | Component | Failure Mode                                                              | Operational State | Effect                                               | Severity | Likelihood | Risk Level  | Mitigation                                                            | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------- | ------------- |
| HAZ-003 | SYS-002   | PKCE verifier/challenge not enforced in mobile authorization flow.        | NORMAL            | Authorization code interception enables token theft. | Critical | Remote     | Undesirable | REQ-001; ARCH-004; ARCH-006; MOD-004/MOD-006 enforce PKCE end-to-end. | Tolerable     |
| HAZ-004 | SYS-002   | Tokens persisted outside secure store (debug log/plain storage fallback). | NORMAL            | Device compromise exposes refresh/access tokens.     | Critical | Remote     | Undesirable | REQ-006; ARCH-005; MOD-005 enforces Keychain/Keystore-only storage.   | Tolerable     |

### SYS-003 — Social Login Provider

| HAZ ID  | Component | Failure Mode                                                           | Operational State | Effect                                                   | Severity | Likelihood | Risk Level  | Mitigation                                                       | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------------------------------- | ------------- |
| HAZ-005 | SYS-003   | Social connection misconfigured with permissive callback/redirect URI. | NORMAL            | Tokens/codes can be redirected to unauthorized endpoint. | Critical | Remote     | Undesirable | REQ-004; ARCH-007; SYS-018 restricts allowed callback origins.   | Tolerable     |
| HAZ-006 | SYS-003   | Provider outage path not handled; login surface loops indefinitely.    | -DEGRADED         | Users cannot authenticate; elevated support load.        | Serious  | Occasional | Undesirable | REQ-004; SYS-017 outage telemetry; ARCH-029 incident visibility. | Tolerable     |

### SYS-004 — Token Refresh Handler

| HAZ ID  | Component | Failure Mode                                                          | Operational State | Effect                                                   | Severity | Likelihood | Risk Level  | Mitigation                                                               | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------- | ----------------- | -------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------ | ------------- |
| HAZ-007 | SYS-004   | Refresh token theft/replay not detected; stolen token remains usable. | NORMAL            | Unauthorized API access until token rotation/revocation. | Critical | Remote     | Undesirable | REQ-007, REQ-008, REQ-011; ARCH-008/009 enforce revoke-on-failure paths. | Tolerable     |
| HAZ-008 | SYS-004   | Refresh failure handled as silent success (stale token reused).       | NORMAL            | API calls fail unpredictably; inconsistent auth state.   | Serious  | Occasional | Undesirable | REQ-008; ARCH-008/009 force re-authentication on refresh failure.        | Tolerable     |

### SYS-005 — Post-Registration IdP server-side handler

| HAZ ID  | Component | Failure Mode                                                                 | Operational State   | Effect                                                  | Severity | Likelihood | Risk Level  | Mitigation                                                            | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------- | ------------- |
| HAZ-009 | SYS-005   | Action fails during IdP outage; user created in the IdP but not provisioned. | -DEGRADED           | Partial account state; new user cannot access app data. | Serious  | Occasional | Undesirable | REQ-016, REQ-017; SYS-007 reconciliation repairs drift.               | Tolerable     |
| HAZ-010 | SYS-005   | Client secret rotation failure leaves Action using expired secret.           | KEY-ROTATION-WINDOW | Post-registration provisioning consistently fails.      | Critical | Remote     | Undesirable | REQ-IF-007; SYS-018/ARCH-030 manage secret rotation rollout controls. | Tolerable     |

### SYS-006 — User/Account Provisioning Service

| HAZ ID  | Component | Failure Mode                                                 | Operational State | Effect                                                 | Severity | Likelihood | Risk Level  | Mitigation                                                          | Residual Risk |
| ------- | --------- | ------------------------------------------------------------ | ----------------- | ------------------------------------------------------ | -------- | ---------- | ----------- | ------------------------------------------------------------------- | ------------- |
| HAZ-011 | SYS-006   | Non-idempotent create causes duplicate user/account records. | NORMAL            | Data integrity corruption; identity mapping ambiguity. | Critical | Remote     | Undesirable | REQ-013, REQ-014, REQ-016; ARCH-011/MOD-011 idempotency checks.     | Tolerable     |
| HAZ-012 | SYS-006   | Provisioning endpoint accepts unsigned/unauthorized calls.   | NORMAL            | Unauthorized account creation or tampering.            | Critical | Improbable | Tolerable   | REQ-IF-008; SYS-015 authorizer enforcement before backend handlers. | Acceptable    |

### SYS-007 — Reconciliation Job

| HAZ ID  | Component | Failure Mode                                                                  | Operational State | Effect                                             | Severity | Likelihood | Risk Level  | Mitigation                                                         | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------- | ----------------- | -------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------ | ------------- |
| HAZ-013 | SYS-007   | Reconciliation disabled/scheduler drift leaves account mismatches unresolved. | NORMAL            | Persistent onboarding failures for affected users. | Serious  | Occasional | Undesirable | REQ-017; ARCH-012 periodic reconciliation with alerts via SYS-017. | Tolerable     |
| HAZ-014 | SYS-007   | Reconciliation logic links wrong IdP identity to local account.               | NORMAL            | Cross-user data exposure risk.                     | Critical | Improbable | Tolerable   | REQ-IF-010; MOD-012 strict subject/UUID mapping constraints.       | Acceptable    |

### SYS-008 — Profile View

| HAZ ID  | Component | Failure Mode                                                         | Operational State | Effect                            | Severity | Likelihood | Risk Level  | Mitigation                                                         | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------- | ----------------- | --------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------ | ------------- |
| HAZ-015 | SYS-008   | API response caching misconfiguration returns another user profile.  | NORMAL            | Privacy breach (PII disclosure).  | Critical | Remote     | Undesirable | REQ-018; REQ-IF-004; ARCH-013 with per-user auth context checks.   | Tolerable     |
| HAZ-016 | SYS-008   | Profile endpoint served without valid token after authorizer bypass. | NORMAL            | Unauthorized profile data access. | Critical | Improbable | Tolerable   | REQ-038, REQ-039; SYS-015 + ARCH-024 enforce JWT validation gates. | Acceptable    |

### SYS-009 — Account Edit Handler

| HAZ ID  | Component | Failure Mode                                                           | Operational State | Effect                                                | Severity | Likelihood | Risk Level  | Mitigation                                                             | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------- | ----------------- | ----------------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------------------------------------- | ------------- |
| HAZ-017 | SYS-009   | Display-name validation bypass allows empty/invalid values to persist. | NORMAL            | User-facing data quality degradation; support burden. | Minor    | Occasional | Tolerable   | REQ-022; ARCH-014/015 input validation; MOD-014/MOD-015 guards.        | Acceptable    |
| HAZ-018 | SYS-009   | Edit endpoint lacks ownership check and updates another account.       | NORMAL            | Unauthorized profile modification.                    | Critical | Remote     | Undesirable | REQ-020, REQ-IF-004; SYS-015 authorization + ARCH-015 ownership check. | Tolerable     |

### SYS-010 — Account Deletion Handler

| HAZ ID  | Component | Failure Mode                                                             | Operational State | Effect                                                        | Severity | Likelihood | Risk Level  | Mitigation                                                               | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------ | ------------- |
| HAZ-019 | SYS-010   | Deletion confirmation control bypassed (no explicit `DELETE` challenge). | NORMAL            | Accidental account removal and user lockout.                  | Serious  | Remote     | Tolerable   | REQ-023; ARCH-016/MOD-016 enforce explicit confirmation workflow.        | Acceptable    |
| HAZ-020 | SYS-010   | Local deletion succeeds but IdP account deletion fails.                  | NORMAL            | Orphaned identity; re-registration conflict and privacy risk. | Critical | Remote     | Undesirable | REQ-024, REQ-025, REQ-026; ARCH-017/MOD-017 transactional compensations. | Tolerable     |

### SYS-011 — Password Reset Flow

| HAZ ID  | Component | Failure Mode                                                             | Operational State | Effect                                                    | Severity | Likelihood | Risk Level  | Mitigation                                                         | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------ | ----------------- | --------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------ | ------------- |
| HAZ-021 | SYS-011   | Password reset link sent over insecure/misconfigured transport.          | NORMAL            | Credential reset token interception.                      | Critical | Remote     | Undesirable | REQ-027, REQ-028; ARCH-018 enforces IdP-managed secure reset flow. | Tolerable     |
| HAZ-022 | SYS-011   | Reset flow permits user enumeration through differential error messages. | NORMAL            | Attackers discover valid accounts for credential attacks. | Serious  | Occasional | Undesirable | REQ-CN-002; MOD-018 standardized opaque error responses.           | Tolerable     |

### SYS-012 — MFA Enrollment Flow

| HAZ ID  | Component | Failure Mode                                                       | Operational State | Effect                                               | Severity | Likelihood | Risk Level  | Mitigation                                                       | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------ | ----------------- | ---------------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------------------------------- | ------------- |
| HAZ-023 | SYS-012   | MFA enrollment can be skipped despite policy requiring enrollment. | NORMAL            | Reduced account protection for high-risk operations. | Critical | Occasional | Undesirable | REQ-029, REQ-030; ARCH-019 enrollment gate and policy checks.    | Tolerable     |
| HAZ-024 | SYS-012   | Enrollment state desync causes false “MFA enabled” UI status.      | NORMAL            | Users assume protection that is not active.          | Serious  | Occasional | Undesirable | REQ-031; MOD-019 synchronizes IdP MFA state before confirmation. | Tolerable     |

### SYS-013 — Social Account Linking

| HAZ ID  | Component | Failure Mode                                                   | Operational State | Effect                                                         | Severity | Likelihood | Risk Level  | Mitigation                                                          | Residual Risk |
| ------- | --------- | -------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------- | ------------- |
| HAZ-025 | SYS-013   | Account linking performed without re-authentication challenge. | NORMAL            | Session hijacker can bind attacker identity to victim account. | Critical | Remote     | Undesirable | REQ-032, REQ-033; ARCH-020 requires fresh auth context for linking. | Tolerable     |
| HAZ-026 | SYS-013   | Provider identity collision links wrong social account.        | NORMAL            | Unauthorized account takeover path.                            | Critical | Improbable | Tolerable   | REQ-034; MOD-020 strict subject/provider tuple validation.          | Acceptable    |

### SYS-014 — User Impersonation

| HAZ ID  | Component | Failure Mode                                                         | Operational State | Effect                                            | Severity     | Likelihood | Risk Level  | Mitigation                                                          | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------- | ----------------- | ------------------------------------------------- | ------------ | ---------- | ----------- | ------------------------------------------------------------------- | ------------- |
| HAZ-027 | SYS-014   | Impersonation permitted for non-admin actor due to role check bug.   | NORMAL            | Broad unauthorized access to user data/actions.   | Catastrophic | Improbable | Undesirable | REQ-035, REQ-036; ARCH-022 strict RBAC + SYS-015 claim enforcement. | Tolerable     |
| HAZ-028 | SYS-014   | Impersonation events not logged or missing target identity metadata. | NORMAL            | Forensics/compliance gap; abuse not attributable. | Serious      | Occasional | Undesirable | REQ-037; ARCH-023 with SYS-017 structured audit logging pipeline.   | Tolerable     |

### SYS-015 — API Gateway JWT Authorizer

| HAZ ID  | Component | Failure Mode                                                                     | Operational State   | Effect                                                  | Severity     | Likelihood | Risk Level  | Mitigation                                                                  | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------- | ------------ | ---------- | ----------- | --------------------------------------------------------------------------- | ------------- |
| HAZ-029 | SYS-015   | JWT validator accepts `alg=none` or unsupported algorithm confusion.             | NORMAL              | Unsigned token grants unauthorized API access.          | Catastrophic | Improbable | Undesirable | REQ-039; ARCH-024/MOD-024 enforce algorithm allowlist and signature check.  | Tolerable     |
| HAZ-030 | SYS-015   | JWKS rotation not handled (stale key cache rejects valid tokens).                | KEY-ROTATION-WINDOW | Widespread authentication failures/outage.              | Critical     | Occasional | Undesirable | REQ-042, REQ-IF-009; ARCH-024 key refresh strategy with cache invalidation. | Tolerable     |
| HAZ-031 | SYS-015   | Token replay accepted due to missing `jti`/nonce replay controls where required. | NORMAL              | Reused stolen token extends unauthorized access window. | Critical     | Remote     | Undesirable | REQ-038, REQ-040; SYS-017 replay anomaly detection + claim validation.      | Tolerable     |

### SYS-016 — User Suspension/Reactivation

| HAZ ID  | Component | Failure Mode                                                             | Operational State      | Effect                                             | Severity | Likelihood | Risk Level  | Mitigation                                                           | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------ | ---------------------- | -------------------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------- | ------------- |
| HAZ-032 | SYS-016   | Suspension status change not propagated to authorizer in time.           | SUSPENSION-ENFORCEMENT | Suspended users retain temporary access.           | Critical | Occasional | Undesirable | REQ-041, REQ-043; ARCH-025 status checks on every protected request. | Tolerable     |
| HAZ-033 | SYS-016   | Reactivation path restores access without full account integrity checks. | SUSPENSION-ENFORCEMENT | Reactivated account remains in inconsistent state. | Serious  | Remote     | Tolerable   | REQ-044; ARCH-026/MOD-026 perform pre-reactivation validations.      | Acceptable    |

### SYS-017 — Observability & Logging

| HAZ ID  | Component | Failure Mode                                                      | Operational State | Effect                                            | Severity | Likelihood | Risk Level  | Mitigation                                                                  | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------- | ----------------- | ------------------------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------------- | ------------- |
| HAZ-034 | SYS-017   | Access/refresh tokens or secrets written to logs/Sentry payloads. | NORMAL            | Credential leakage through telemetry systems.     | Critical | Remote     | Undesirable | REQ-NF-012..REQ-NF-017; ARCH-027/029 redaction and sensitive-field filters. | Tolerable     |
| HAZ-035 | SYS-017   | IdP outage/error spikes not instrumented with actionable alerts.  | -DEGRADED         | Prolonged incident MTTR and extended user impact. | Serious  | Occasional | Undesirable | REQ-NF-013, REQ-NF-014; ARCH-028/029 dashboards and alarm thresholds.       | Tolerable     |

### SYS-018 — CDK Infrastructure Stack

| HAZ ID  | Component | Failure Mode                                                           | Operational State   | Effect                                 | Severity | Likelihood | Risk Level  | Mitigation                                                             | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------- | ------------------- | -------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------------------------------------- | ------------- |
| HAZ-036 | SYS-018   | Callback URL/environment configuration mismatch across web/mobile/IdP. | NORMAL              | Login/callback failures in production. | Serious  | Occasional | Undesirable | REQ-IF-007; ARCH-030 centralized env config and deployment validation. | Tolerable     |
| HAZ-037 | SYS-018   | Secret rotation rollout incomplete between Lambda env and IdP tenants. | KEY-ROTATION-WINDOW | Widespread auth/provisioning failures. | Critical | Remote     | Undesirable | REQ-IF-007; MOD-030 staged secret rotation with rollback guardrails.   | Tolerable     |

### SYS-019 — Shared Auth Types & Error Classes

| HAZ ID  | Component | Failure Mode                                                               | Operational State | Effect                                               | Severity | Likelihood | Risk Level | Mitigation                                                                | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------- | -------- | ---------- | ---------- | ------------------------------------------------------------------------- | ------------- |
| HAZ-038 | SYS-019   | Type mismatch on JWT claims parsing defaults to permissive/fail-open path. | NORMAL            | Authorization bypass under malformed token claims.   | Critical | Improbable | Tolerable  | REQ-NF-001, REQ-NF-010; ARCH-031/032 strict schema validation and errors. | Acceptable    |
| HAZ-039 | SYS-019   | Error-class mapping loses auth failure semantics (401 mapped to 500).      | NORMAL            | Incorrect retries, noisy incidents, and degraded UX. | Minor    | Occasional | Tolerable  | REQ-NF-009; MOD-031/MOD-032 canonical auth error taxonomy.                | Acceptable    |

### SYS-020 — Auth UI Design System Integration

| HAZ ID  | Component | Failure Mode                                                                    | Operational State | Effect                                                       | Severity | Likelihood | Risk Level | Mitigation                                                                   | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------------------------------------------------------------------- | ------------- |
| HAZ-040 | SYS-020   | Auth-screen component regression hides security-critical prompts (MFA/consent). | NORMAL            | Users proceed without understanding security action context. | Serious  | Remote     | Tolerable  | REQ-NF-004, REQ-NF-005, REQ-NF-011; ARCH-033 design-token conformance tests. | Acceptable    |
