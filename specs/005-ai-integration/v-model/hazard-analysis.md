# Hazard Analysis (FMEA): AI Integration

**Feature Branch**: `005-ai-integration`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/005-ai-integration/v-model/system-design.md`
**Standard**: General-Purpose FMEA (non-regulated software; `domain: ''`)

## Overview

This document presents the Failure Mode and Effects Analysis (FMEA) for the **AI Integration** feature. Every canonical system component (`SYS-001`..`SYS-008`) from `system-design.md` is assessed for realistic failure modes. Each hazard receives a unique `HAZ-NNN` identifier and is linked to risk-control measures (`REQ-NNN` / `SYS-NNN` / `ARCH-NNN`), enabling the traceability chain: Hazard → Mitigation → Requirement → Test Case (Matrix H in `traceability-matrix.md`).

**Non-regulated context.** Commise is a consumer recipe-management application. There are no life-safety, vehicle-control, medical-device, or aviation-control concerns. Severity is measured against **user trust, data integrity, privacy, availability, and platform cost** — not personal injury. Safety-critical taxonomies (ISO 26262 ASIL, DO-178C DAL, IEC 62304) are intentionally **not** applied.

## ID Schema

- **Hazard ID**: `HAZ-{NNN}` — 3-digit zero-padded, sequential (HAZ-001, HAZ-002, ...). Never renumbered.
- **Lineage**: From any `HAZ-NNN`, the Mitigation column lists `REQ-*`, `SYS-*`, and `ARCH-*` references. The full chain to verification test cases (`ATP-*`, `STP-*`, `ITP-*`, `UTP-*`) lives in `traceability-matrix.md` (Matrix H — Hazard Traceability).

## Risk Matrix Definition

### Severity Scale (consumer SaaS — recipe app)

| Level        | Definition                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| Catastrophic | Cross-tenant data leak, broad unauthorized access, persistent user recipe loss, or platform-wide outage.     |
| Critical     | Individual-user data loss without recovery, authorization bypass, or sustained core-flow outage (≥1 hour).   |
| Serious      | Recoverable degradation: failed AI actions with retry path, transient endpoint 5xx, or stale-state workflow. |
| Minor        | Annoyance: degraded response quality, retryable timeout, temporary UX friction.                              |
| Negligible   | Cosmetic only: log noise, telemetry drift, copy/wording inconsistency.                                       |

### Likelihood Scale

| Level      | Definition                                                      |
| ---------- | --------------------------------------------------------------- |
| Frequent   | Expected regularly under normal load (≥1× per day).             |
| Probable   | Expected occasionally (≥1× per week per 1k MAU).                |
| Occasional | Expected rarely (≥1× per month per 1k MAU).                     |
| Remote     | Possible under unusual conditions (≥1× per quarter).            |
| Improbable | Conceivable only under stacked failure or adversarial behavior. |

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

`system-design.md` does not define a formal operational-state taxonomy. For state-dependent hazards, this analysis uses the following practical operating modes:

| State             | Definition                                                                    | Source                    |
| ----------------- | ----------------------------------------------------------------------------- | ------------------------- |
| NORMAL            | Steady-state operation under expected load and provider availability.         | Implicit                  |
| DEGRADED-PROVIDER | AI provider elevated errors/latency, fallback/retry and timeout paths active. | SYS-002, SYS-006          |
| AUTH-EXCHANGE     | OAuth authorization code + token exchange in progress.                        | SYS-004                   |
| RATE-LIMITED      | Upstream/downstream quota or rate-limit responses active.                     | SYS-002, SYS-005, SYS-006 |
| RECOVERY          | Service restart/deployment window with token/cache warmup in progress.        | SYS-004, SYS-005          |

## Hazard Register (FMEA)

> One or more `HAZ-NNN` per `SYS-NNN`. Mitigations cite existing `REQ-*`, `SYS-*`, and `ARCH-*` identifiers only.

### SYS-001 — AI Provider Config Manager

| HAZ ID  | Component | Failure Mode                                                                                            | Operational State | Effect                                                                       | Severity     | Likelihood | Risk Level  | Mitigation                                                                                                                                                             | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------------------------- | ------------ | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-001 | SYS-001   | Raw API key written to the application database instead of Secrets Manager (code or config regression). | NORMAL            | Credential disclosure risk; provider-account takeover.                       | Catastrophic | Remote     | Undesirable | REQ-001, REQ-NF-005; ARCH-001 handles ARNs ONLY and performs no crypto; UTS-001-A5 + STS-002-1 fail the build if key material or a crypto call reaches the DAL writes. | Tolerable     |
| HAZ-002 | SYS-001   | Wrong provider key bound to user profile during update race.                                            | NORMAL            | Requests fail or hit wrong provider tenant; degraded trust and availability. | Serious      | Occasional | Undesirable | REQ-001, REQ-007; ARCH-001 upsert by `(userId, provider)`; ARCH-002 ownership checks before save.                                                                      | Tolerable     |
| HAZ-003 | SYS-001   | Setup-guidance not triggered when no provider exists.                                                   | NORMAL            | Generation path fails without clear remediation; user drop-off.              | Minor        | Probable   | Tolerable   | REQ-007; ARCH-003 setup-required response contract; SYS-001 setup pathway.                                                                                             | Acceptable    |
| HAZ-004 | SYS-001   | Provider delete operation leaves stale decrypted key in cache.                                          | RECOVERY          | Subsequent calls use revoked key; unauthorized provider spend.               | Critical     | Remote     | Undesirable | REQ-001, REQ-NF-005; ARCH-002 cache invalidation on delete; SYS-001 credential lifecycle controls.                                                                     | Tolerable     |

### SYS-002 — AI Recipe Generator

| HAZ ID  | Component | Failure Mode                                                              | Operational State | Effect                                                          | Severity | Likelihood | Risk Level  | Mitigation                                                                                               | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-005 | SYS-002   | Prompt injection in user-provided ingredients manipulates model behavior. | NORMAL            | Malicious/unrelated output, trust erosion, unsafe instructions. | Critical | Occasional | Undesirable | REQ-002, REQ-003; ARCH-005 prompt shaping + input constraints; ARCH-004 request normalization.           | Tolerable     |
| HAZ-006 | SYS-002   | Hallucinated recipe references impossible steps/ingredients.              | NORMAL            | User receives invalid recipe; cooking failure.                  | Serious  | Probable   | Undesirable | REQ-002, REQ-004; ARCH-006 preview-before-save; SYS-003 accept/reject gate prevents auto-persist.        | Tolerable     |
| HAZ-007 | SYS-002   | Unsafe ingredient suggestion (toxicity/contamination risk) not filtered.  | NORMAL            | Harmful suggestion appears in generated draft.                  | Critical | Remote     | Undesirable | REQ-004, REQ-005; ARCH-005 validation rules + safe-prompt templates; SYS-003 manual acceptance required. | Tolerable     |
| HAZ-008 | SYS-002   | Allergy false-negative in generated substitutions.                        | NORMAL            | User with allergen sensitivity receives unsafe recommendation.  | Critical | Remote     | Undesirable | REQ-002, REQ-004; ARCH-005 dietary-restriction enforcement; SYS-003 explicit review before save.         | Tolerable     |
| HAZ-009 | SYS-002   | Model timeout exceeds 15-second response objective.                       | DEGRADED-PROVIDER | UX breach; generation abandoned/retried.                        | Serious  | Occasional | Undesirable | REQ-003; ARCH-004 hard 15s timeout; ARCH-005 timeout handling with actionable error response.            | Tolerable     |
| HAZ-010 | SYS-002   | Token cost overrun from unconstrained prompt/response size.               | RATE-LIMITED      | Unexpected user/provider charges, feature abandonment.          | Serious  | Occasional | Undesirable | REQ-002; ARCH-005 token-budget guards; SYS-002 request shaping and truncation rules.                     | Tolerable     |
| HAZ-011 | SYS-002   | Model deprecation or API version sunset breaks dispatch path.             | RECOVERY          | Generation unavailable until adapter update.                    | Serious  | Remote     | Tolerable   | REQ-003; ARCH-004 provider adapter abstraction; SYS-002 fallback error surfaced to client.               | Acceptable    |

### SYS-003 — AI Recipe Preview & Save Flow

| HAZ ID  | Component | Failure Mode                                                      | Operational State | Effect                                                     | Severity     | Likelihood | Risk Level  | Mitigation                                                                                     | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------- | ----------------- | ---------------------------------------------------------- | ------------ | ---------- | ----------- | ---------------------------------------------------------------------------------------------- | ------------- |
| HAZ-012 | SYS-003   | User declines draft but recipe still persisted due to branch bug. | NORMAL            | Violation of user intent; unwanted private data persisted. | Critical     | Remote     | Undesirable | REQ-006, REQ-012; ARCH-006 explicit decline path (no write); ARCH-007 write only on accept.    | Tolerable     |
| HAZ-013 | SYS-003   | Accept action persists draft under wrong ownerId.                 | NORMAL            | Cross-user data integrity breach.                          | Catastrophic | Improbable | Undesirable | REQ-005, REQ-012; ARCH-007 enforce `ownerId` from authenticated context; SYS-007 auth binding. | Tolerable     |
| HAZ-014 | SYS-003   | Double-submit on accept creates duplicate recipes.                | NORMAL            | Data duplication and user confusion.                       | Minor        | Probable   | Tolerable   | REQ-005; ARCH-006 idempotent accept handling; ARCH-007 dedupe constraint on save path.         | Acceptable    |
| HAZ-015 | SYS-003   | Preview payload omits generated warnings/limitations.             | NORMAL            | User saves low-quality output without informed review.     | Minor        | Occasional | Tolerable   | REQ-004, REQ-015; ARCH-006 structured preview contract with metadata and warnings.             | Acceptable    |

### SYS-004 — OAuth 2.0 Authorization Server

| HAZ ID  | Component | Failure Mode                                                          | Operational State | Effect                                              | Severity     | Likelihood | Risk Level  | Mitigation                                                                                           | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------- | ----------------- | --------------------------------------------------- | ------------ | ---------- | ----------- | ---------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-016 | SYS-004   | Authorization code replay accepted.                                   | AUTH-EXCHANGE     | Unauthorized token issuance for external agent.     | Catastrophic | Improbable | Undesirable | REQ-010, REQ-IF-001; ARCH-008 one-time code use + expiry; ARCH-010 token validation.                 | Tolerable     |
| HAZ-017 | SYS-004   | Scope escalation (`recipes:create` granted when only read requested). | AUTH-EXCHANGE     | Agent performs writes beyond user consent.          | Critical     | Remote     | Undesirable | REQ-IF-002, REQ-013; ARCH-008 strict scope intersection and consent persistence in ARCH-009.         | Tolerable     |
| HAZ-018 | SYS-004   | Revoked consent does not invalidate active tokens promptly.           | RECOVERY          | Agent retains access after user revocation.         | Critical     | Remote     | Undesirable | REQ-013; ARCH-009 revocation records + token invalidation; ARCH-010 introspection/revocation checks. | Tolerable     |
| HAZ-019 | SYS-004   | Redirect URI validation bypass during auth flow.                      | AUTH-EXCHANGE     | Code/token leakage to attacker-controlled endpoint. | Catastrophic | Improbable | Undesirable | REQ-IF-001; ARCH-008 exact-match `redirect_uri` allowlist validation.                                | Tolerable     |

### SYS-005 — External Agent API

| HAZ ID  | Component | Failure Mode                                                  | Operational State | Effect                                                         | Severity     | Likelihood | Risk Level  | Mitigation                                                                                             | Residual Risk |
| ------- | --------- | ------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- | ------------ | ---------- | ----------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| HAZ-020 | SYS-005   | Endpoint serves recipes without valid bearer token.           | NORMAL            | Unauthorized recipe disclosure.                                | Catastrophic | Improbable | Undesirable | REQ-008, REQ-011; ARCH-010 token validator enforced on ARCH-011/ARCH-012; SYS-007 guard chain.         | Tolerable     |
| HAZ-021 | SYS-005   | `recipes:create` endpoint accepts token with read-only scope. | NORMAL            | Unauthorized recipe creation by over-privileged path.          | Critical     | Remote     | Undesirable | REQ-009, REQ-IF-002; ARCH-012 scope check against ARCH-010 extracted claims.                           | Tolerable     |
| HAZ-022 | SYS-005   | PII leak via prompt/context reflected in agent API responses. | NORMAL            | User privacy breach to third-party platform logs.              | Critical     | Occasional | Undesirable | REQ-008, REQ-012; ARCH-011/ARCH-012 response shaping and redaction; SYS-005 contract-minimal payloads. | Tolerable     |
| HAZ-023 | SYS-005   | Rate-limit cascade from agent retries amplifies backend load. | RATE-LIMITED      | API instability and increased 5xx for all users.               | Serious      | Occasional | Undesirable | REQ-011; ARCH-011/ARCH-012 bounded retries and 429 semantics; SYS-005 backpressure policy.             | Tolerable     |
| HAZ-024 | SYS-005   | Created recipe not marked private/user-owned from agent path. | NORMAL            | Ownership/privacy model breach for externally created content. | Critical     | Remote     | Undesirable | REQ-009, REQ-012; ARCH-007 enforces `isPrivate: true` and authenticated `ownerId` on write.            | Tolerable     |

### SYS-006 — AI Instruction Optimizer

| HAZ ID  | Component | Failure Mode                                                                               | Operational State | Effect                                           | Severity | Likelihood | Risk Level  | Mitigation                                                                                             | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------ | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------ | ------------- |
| HAZ-025 | SYS-006   | Optimizer modifies semantics (ingredient amounts/times) beyond instruction rewrite intent. | NORMAL            | Recipe correctness degraded after acceptance.    | Serious  | Occasional | Undesirable | REQ-014, REQ-015; ARCH-013 constrained optimization mode; ARCH-014 user review before patch.           | Tolerable     |
| HAZ-026 | SYS-006   | Unauthorized optimization of recipe not owned by requester.                                | NORMAL            | Cross-user data tampering risk.                  | Critical | Improbable | Tolerable   | REQ-014, REQ-015; ARCH-013 ownership check before provider dispatch; SYS-007 auth binding.             | Acceptable    |
| HAZ-027 | SYS-006   | Timeout in optimization path causes partial patch to recipe.                               | DEGRADED-PROVIDER | Inconsistent instruction state in stored recipe. | Critical | Remote     | Undesirable | REQ-015; ARCH-014 apply-on-accept only; ARCH-007 atomic persistence operations.                        | Tolerable     |
| HAZ-028 | SYS-006   | Prompt payload includes sensitive note fields and leaks to provider logs.                  | NORMAL            | PII/privacy exposure to third-party provider.    | Critical | Remote     | Undesirable | REQ-014, REQ-NF-005; ARCH-013 payload minimization and field allowlist; SYS-006 strict request schema. | Tolerable     |

### SYS-007 — Cross-Cutting: Auth Guard

| HAZ ID  | Component | Failure Mode                                                          | Operational State | Effect                                          | Severity     | Likelihood | Risk Level  | Mitigation                                                                                  | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------- | ----------------- | ----------------------------------------------- | ------------ | ---------- | ----------- | ------------------------------------------------------------------------------------------- | ------------- |
| HAZ-029 | SYS-007   | Guard bypass via unprotected route registration.                      | NORMAL            | Unauthenticated access to AI/agent endpoints.   | Catastrophic | Improbable | Undesirable | REQ-CN-002, REQ-NF-001; ARCH-015 mandatory middleware on all AI and agent routes.           | Tolerable     |
| HAZ-030 | SYS-007   | Expired JWT treated as valid due to clock-skew misconfiguration.      | NORMAL            | Session extension beyond intended validity.     | Critical     | Remote     | Undesirable | REQ-CN-002; ARCH-015 strict exp/nbf checks with bounded skew and fail-closed behavior.      | Tolerable     |
| HAZ-031 | SYS-007   | Guard returns ambiguous error and upstream retries unsafe operations. | RATE-LIMITED      | Elevated retry storm and degraded availability. | Serious      | Occasional | Undesirable | REQ-NF-002; ARCH-015 consistent 401 contract; SYS-005 retry policies keyed by status class. | Tolerable     |

### SYS-008 — Cross-Cutting: Type Safety & Accessibility

| HAZ ID  | Component | Failure Mode                                                                        | Operational State | Effect                                                               | Severity | Likelihood | Risk Level  | Mitigation                                                                       | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------------------- | ------------- |
| HAZ-032 | SYS-008   | `any`-typed boundary admits malformed provider payload to business logic.           | NORMAL            | Runtime faults and unsafe branching.                                 | Serious  | Occasional | Undesirable | REQ-NF-001; ARCH-017 strict TypeScript and lint enforcement for AI modules.      | Tolerable     |
| HAZ-033 | SYS-008   | Missing accessible names on preview/consent controls causes wrong action selection. | NORMAL            | User may accept unwanted AI result or grant unintended consent.      | Serious  | Remote     | Tolerable   | REQ-NF-003, REQ-NF-004; ARCH-017 accessibility assertions and UI lint contracts. | Acceptable    |
| HAZ-034 | SYS-008   | Premium gating indicator conveyed only by color.                                    | NORMAL            | Accessibility failure; users misunderstand gated states and actions. | Minor    | Occasional | Tolerable   | REQ-NF-004; ARCH-017 icon/text pairing enforcement and test coverage.            | Acceptable    |

## Safety Requirements Mapping

| Safety Goal | Requirement IDs                                | Covered Hazards  | Primary Components | Status |
| ----------- | ---------------------------------------------- | ---------------- | ------------------ | ------ |
| G1          | REQ-001, REQ-NF-005                            | HAZ-001, HAZ-004 | SYS-001            | OPEN   |
| G2          | REQ-002, REQ-003, REQ-004                      | HAZ-005..HAZ-011 | SYS-002            | OPEN   |
| G3          | REQ-004, REQ-005, REQ-006, REQ-012             | HAZ-012..HAZ-015 | SYS-003            | OPEN   |
| G4          | REQ-010, REQ-013, REQ-IF-001, REQ-IF-002       | HAZ-016..HAZ-019 | SYS-004            | OPEN   |
| G5          | REQ-008, REQ-009, REQ-011, REQ-012, REQ-IF-003 | HAZ-020..HAZ-024 | SYS-005            | OPEN   |
| G6          | REQ-014, REQ-015                               | HAZ-025..HAZ-028 | SYS-006            | OPEN   |
| G7          | REQ-CN-002, REQ-NF-001, REQ-NF-002             | HAZ-029..HAZ-031 | SYS-007            | OPEN   |
| G8          | REQ-NF-001, REQ-NF-003, REQ-NF-004             | HAZ-032..HAZ-034 | SYS-008            | OPEN   |

## Domain Note (non-regulated)

This analysis intentionally omits regulated-domain artifacts (ASIL classification, DAL assignment, MC/DC obligations, IEC 62304 software safety classification). This feature is non-regulated consumer SaaS; severity is framed against user trust, data integrity, privacy, availability, and platform cost.

## Glossary

| Term              | Definition                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| FMEA              | Failure Mode and Effects Analysis — structured enumeration of failure modes, effects, and mitigations per component.             |
| Hazard            | A realistic failure mode whose effect, if unmitigated, would breach a system invariant (privacy, integrity, availability, cost). |
| Operational state | Named system mode where severity/likelihood may differ (NORMAL, DEGRADED-PROVIDER, AUTH-EXCHANGE, RATE-LIMITED, RECOVERY).       |
| Risk level        | Composite of severity × likelihood per the matrix above.                                                                         |
| Residual risk     | Risk level remaining after stated mitigation is in place.                                                                        |

---

> **Status**: Hazard analysis complete. 34 hazards (`HAZ-001`..`HAZ-034`) across all canonical SYS components (`SYS-001`..`SYS-008`). 0 `Unacceptable`; all `Undesirable` entries have explicit mitigations and residual-risk disposition.
