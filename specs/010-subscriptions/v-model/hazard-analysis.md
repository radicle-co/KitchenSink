# Hazard Analysis (FMEA): Subscriptions & Monetization

**Feature Branch**: `010-subscriptions`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/010-subscriptions/v-model/system-design.md`
**Standard**: General-Purpose FMEA (non-regulated software; `domain: ''` in `v-model-config.yml`)

## Overview

This document presents the Failure Mode and Effects Analysis (FMEA) for the **Subscriptions & Monetization** feature. Every system component (`SYS-001`..`SYS-013`) from `system-design.md` is assessed for realistic subscription, entitlement, and billing-adjacent failure modes. Each hazard receives a unique `HAZ-NNN` identifier and is linked to risk-control measures (`REQ-NNN` / `SYS-NNN` / `ARCH-NNN`), enabling the traceability chain: Hazard → Mitigation → Requirement → Test Case (Matrix H in `traceability-matrix.md`).

**Non-regulated context.** Commise is a consumer recipe management application. There are no life-safety, vehicle-control, medical-device, or aviation-control concerns. Severity is measured against **user trust, data integrity, privacy, availability, compliance posture, and platform revenue/cost** — not personal injury. Safety-critical taxonomies (ISO 26262 ASIL, DO-178C DAL, IEC 62304) are intentionally **not** applied.

## ID Schema

- **Hazard ID**: `HAZ-{NNN}` — 3-digit zero-padded, sequential (HAZ-001, HAZ-002, ...). Never renumbered.
- **Lineage**: From any `HAZ-NNN`, the Mitigation column lists `REQ-NNN`, `SYS-NNN`, and (where useful) `ARCH-NNN` references. The full chain to verification test cases (`ATP-NNN`, `STP-NNN`, `ITP-NNN`, `UTP-NNN`) lives in `traceability-matrix.md` (Matrix H — Hazard Traceability).

## Risk Matrix Definition

### Severity Scale (consumer SaaS — subscriptions)

| Level        | Definition                                                                                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catastrophic | Cross-tenant entitlement leak, sustained unauthorized premium access at scale, or severe privacy breach of subscription/user data.                                |
| Critical     | Individual-user security/privacy breach, incorrect billing state causing prolonged lockout or unauthorized access, or unrecoverable subscription data corruption. |
| Serious      | Recoverable but user-impacting monetization error (temporary entitlement mismatch, incorrect lapse timing, failed renewal processing with manual recovery).       |
| Minor        | Conversion/UX degradation (misleading prompt, stale plan copy, transient checkout mismatch) without lasting entitlement corruption.                               |
| Negligible   | Cosmetic/telemetry-only defect with no user-visible entitlement or billing impact.                                                                                |

### Likelihood Scale

| Level      | Definition                                                         |
| ---------- | ------------------------------------------------------------------ |
| Frequent   | Expected to occur repeatedly under normal usage if unmitigated.    |
| Probable   | Likely to occur at least occasionally in production.               |
| Occasional | Plausible but sporadic; requires specific timing or conditions.    |
| Remote     | Uncommon; requires uncommon fault combinations.                    |
| Improbable | Conceivable only under stacked failures or adversarial conditions. |

### Risk Level Matrix

|              | Frequent     | Probable     | Occasional   | Remote      | Improbable  |
| ------------ | ------------ | ------------ | ------------ | ----------- | ----------- |
| Catastrophic | Unacceptable | Unacceptable | Unacceptable | Undesirable | Undesirable |
| Critical     | Unacceptable | Unacceptable | Undesirable  | Undesirable | Tolerable   |
| Serious      | Unacceptable | Undesirable  | Undesirable  | Tolerable   | Tolerable   |
| Minor        | Undesirable  | Tolerable    | Tolerable    | Tolerable   | Acceptable  |
| Negligible   | Tolerable    | Tolerable    | Acceptable   | Acceptable  | Acceptable  |

**Disposition rule**: `Unacceptable` MUST be mitigated to `Undesirable` or lower before release. `Undesirable` MUST have explicit residual-risk acceptance in this document. `Tolerable`/`Acceptable` are accepted as-is.

## Operational States

`system-design.md` does not define a formal subscription state taxonomy. For state-dependent hazards, the following operating modes are used:

| State            | Definition                                                                           | Source           |
| ---------------- | ------------------------------------------------------------------------------------ | ---------------- |
| NORMAL           | Steady-state operation for active/lapsed users with healthy dependencies.            | Implicit         |
| CHECKOUT         | User is upgrading/renewing; payment provider session active.                         | SYS-001, SYS-007 |
| WEBHOOK-INGEST   | Provider event receipt, signature verification, and lifecycle transition processing. | SYS-009, SYS-007 |
| LAPSE-GRACE      | Failed payment / grace-period countdown window before hard downgrade.                | SYS-007, SYS-010 |
| RENEWAL          | Re-activation path after lapse/refund/plan change reconciliation.                    | SYS-001, SYS-007 |
| DEGRADED-BILLING | Payment provider errors/timeouts/retries elevated; idempotency paths stressed.       | SYS-009, SYS-011 |

## Hazard Register (FMEA)

> One or more `HAZ-NNN` per `SYS-NNN`. Mitigations cite existing `REQ-NNN`, `SYS-NNN`, and `ARCH-NNN` identifiers from this feature.

### SYS-001 — Tier Assignment Service

| HAZ ID  | Component | Failure Mode                                                                       | Operational State | Effect                                                                                     | Severity | Likelihood | Risk Level  | Mitigation                                                                                                                                         | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-001 | SYS-001   | Gift subscription routed to wrong account due to stale recipient identity mapping. | CHECKOUT          | Unauthorized premium access for unintended user; paying user does not receive entitlement. | Critical | Remote     | Undesirable | REQ-020, REQ-023, REQ-IF-001; SYS-001, SYS-008; ARCH-002 transition validation + ARCH-010 claim adapter consistency + ARCH-001 tier history audit. | Tolerable     |
| HAZ-002 | SYS-001   | Trial/promo abuse via multi-account signups bypasses intended conversion controls. | CHECKOUT          | Revenue leakage and unfair premium access at scale.                                        | Serious  | Probable   | Undesirable | REQ-001, REQ-CN-002; SYS-001, SYS-008; ARCH-002 legal-transition checks + ARCH-016 event stream for abuse detection.                               | Tolerable     |

### SYS-002 — Free-Tier Entitlement Module

| HAZ ID  | Component | Failure Mode                                                                                      | Operational State | Effect                                                              | Severity | Likelihood | Risk Level  | Mitigation                                                                                                            | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-003 | SYS-002   | Free-tier resolver incorrectly grants premium capability due to malformed feature classification. | NORMAL            | Premium feature exposure without subscription.                      | Critical | Occasional | Undesirable | REQ-002..REQ-007, REQ-IF-002; SYS-002, SYS-013; ARCH-003 + ARCH-006 strict feature→tier mapping.                      | Tolerable     |
| HAZ-004 | SYS-002   | Downgraded user retains cached premium entitlement decision after lapse event.                    | LAPSE-GRACE       | Plan downgrade entitlement leak (premium content still accessible). | Critical | Occasional | Undesirable | REQ-023, REQ-025; SYS-002, SYS-004, SYS-007; ARCH-003 resolver cache invalidation + ARCH-009 lifecycle event fan-out. | Tolerable     |

### SYS-003 — Premium-Tier Entitlement Module

| HAZ ID  | Component | Failure Mode                                                                                             | Operational State | Effect                                                                   | Severity     | Likelihood | Risk Level  | Mitigation                                                                                                                         | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------ | ------------ | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-005 | SYS-003   | Family-share style entitlement inheritance accidentally grants premium access across unrelated accounts. | NORMAL            | Cross-account entitlement leak.                                          | Catastrophic | Remote     | Undesirable | REQ-009..REQ-017, REQ-IF-001; SYS-003, SYS-008; ARCH-004 entitlement resolution tied to per-user tier claim (ARCH-010).            | Tolerable     |
| HAZ-006 | SYS-003   | Refund leaves partial state where some premium flags remain enabled.                                     | RENEWAL           | Refund partial state; inconsistent access, support burden, trust damage. | Serious      | Occasional | Undesirable | REQ-023, REQ-024, REQ-025; SYS-003, SYS-007, SYS-010; ARCH-004 + ARCH-009 + ARCH-013 reconciliation on refund-derived transitions. | Tolerable     |

### SYS-004 — Feature Gate Middleware

| HAZ ID  | Component | Failure Mode                                                                                    | Operational State | Effect                                                                                            | Severity | Likelihood | Risk Level  | Mitigation                                                                                                                                 | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| HAZ-007 | SYS-004   | Pricing race during checkout: stale gate decision uses pre-upgrade/pre-downgrade tier snapshot. | CHECKOUT          | User sees incorrect access outcome, potentially receives unearned premium access or false denial. | Serious  | Occasional | Undesirable | REQ-018, REQ-020, REQ-023, REQ-IF-002; SYS-004, SYS-007; ARCH-005 gate reads fresh tier from ARCH-001 and retries on transition in-flight. | Tolerable     |
| HAZ-008 | SYS-004   | Fail-open path on unknown feature identifier grants access by default.                          | NORMAL            | Unauthorized premium feature access.                                                              | Critical | Remote     | Undesirable | REQ-IF-002, REQ-CN-002; SYS-004, SYS-013; ARCH-005 + ARCH-006 fail-closed null handling.                                                   | Tolerable     |

### SYS-005 — Recipe Visibility Enforcement

| HAZ ID  | Component | Failure Mode                                                               | Operational State | Effect                                                         | Severity | Likelihood | Risk Level  | Mitigation                                                                                                                         | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-009 | SYS-005   | Downgrade migration marks previously private premium recipes as public.    | LAPSE-GRACE       | Privacy breach and trust loss.                                 | Critical | Remote     | Undesirable | REQ-024, REQ-025, REQ-CN-001; SYS-005, SYS-007; ARCH-007 explicit visibility-preservation rules + ARCH-013 retention guard checks. | Tolerable     |
| HAZ-010 | SYS-005   | Imported attributed recipes incorrectly set private during premium window. | NORMAL            | Terms-of-service non-compliance for source-attributed recipes. | Serious  | Remote     | Tolerable   | REQ-CN-001, REQ-008; SYS-005; ARCH-007 imported/attributed override enforcement.                                                   | Acceptable    |

### SYS-006 — Upgrade Prompt Component

| HAZ ID  | Component | Failure Mode                                                                 | Operational State | Effect                                                               | Severity | Likelihood | Risk Level  | Mitigation                                                                                                                   | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-011 | SYS-006   | Upgrade prompt references stale/incorrect plan price or currency conversion. | CHECKOUT          | Currency conversion drift confusion; conversion drop; support churn. | Minor    | Probable   | Tolerable   | REQ-018, REQ-019, REQ-NF-003, REQ-NF-004; SYS-006; ARCH-008 + ARCH-018 pull plan metadata from canonical source each render. | Acceptable    |
| HAZ-012 | SYS-006   | Prompt loops repeatedly after deny event and traps navigation focus.         | NORMAL            | Dunning-like UX loop; unusable flow and accessibility regression.    | Serious  | Occasional | Undesirable | REQ-018, REQ-NF-003, REQ-NF-004; SYS-006, SYS-012; ARCH-008 a11y focus management + ARCH-015 validator gates release.        | Tolerable     |

### SYS-007 — Subscription Lifecycle Manager

| HAZ ID  | Component | Failure Mode                                                                              | Operational State | Effect                                                                        | Severity | Likelihood | Risk Level  | Mitigation                                                                                                                                  | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-013 | SYS-007   | Failed-payment grace period miscount triggers early downgrade or delayed lock.            | LAPSE-GRACE       | Legitimate premium user lockout or prolonged unauthorized premium access.     | Critical | Occasional | Undesirable | REQ-021, REQ-022, REQ-023, REQ-025; SYS-007, SYS-010; ARCH-009 deterministic state machine + ARCH-013 timestamp integrity checks.           | Tolerable     |
| HAZ-014 | SYS-007   | Stripe/DB state desynchronization leaves lifecycle in wrong terminal state after retries. | WEBHOOK-INGEST    | Subscription state desync between provider and DB; inconsistent entitlements. | Critical | Occasional | Undesirable | REQ-020, REQ-023; SYS-007, SYS-009; ARCH-009 reconciliation + ARCH-001 source-of-truth persistence + ARCH-016 replay-safe event publishing. | Tolerable     |

### SYS-008 — Clerk Identity Integration

| HAZ ID  | Component | Failure Mode                                                                   | Operational State | Effect                                         | Severity | Likelihood | Risk Level  | Mitigation                                                                                               | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------ | ----------------- | ---------------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-015 | SYS-008   | Tier claim stale in token after upgrade/renewal event.                         | RENEWAL           | User denied paid features until token refresh. | Serious  | Occasional | Undesirable | REQ-IF-001, REQ-020; SYS-008, SYS-001; ARCH-010 claim refresh contract + ARCH-002 transition event hook. | Tolerable     |
| HAZ-016 | SYS-008   | Tier claim omitted/invalid and middleware defaults to premium instead of free. | NORMAL            | Privilege escalation to premium features.      | Critical | Remote     | Undesirable | REQ-IF-001, REQ-IF-002; SYS-008, SYS-004; ARCH-010 + ARCH-005 enforce fail-closed default tier.          | Tolerable     |

### SYS-009 — Subscription Webhook Receiver

| HAZ ID  | Component | Failure Mode                                                                                                      | Operational State | Effect                                                                           | Severity     | Likelihood | Risk Level  | Mitigation                                                                                                                                            | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------- | ------------ | ---------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-017 | SYS-009   | Stripe webhook replay accepted without idempotency guard.                                                         | WEBHOOK-INGEST    | Duplicate state transitions and potential double-charge on retry side effects.   | Critical     | Occasional | Undesirable | REQ-IF-003, REQ-020, REQ-023; SYS-009, SYS-007; ARCH-011 idempotency key enforcement + ARCH-012 signature/nonce validation + ARCH-017 replay logging. | Tolerable     |
| HAZ-018 | SYS-009   | Webhook signature verification failure path bypassed for alternate provider payload (Apple/Google receipt spoof). | WEBHOOK-INGEST    | In-app-purchase receipt validation bypass grants unauthorized premium access.    | Catastrophic | Remote     | Undesirable | REQ-IF-003, REQ-023; SYS-009; ARCH-012 mandatory signature verification for all provider adapters + ARCH-011 reject-on-verify-failure.                | Tolerable     |
| HAZ-019 | SYS-009   | Tax or currency metadata drift from provider parsed incorrectly (VAT/sales-tax rounding mismatch).                | CHECKOUT          | Wrong net amount classification causes incorrect activation/downgrade decisions. | Serious      | Occasional | Undesirable | REQ-020, REQ-023, REQ-CN-002; SYS-009, SYS-007; ARCH-011 strict schema validation + ARCH-009 amount-state reconciliation rules.                       | Tolerable     |

### SYS-010 — Data Retention Guard

| HAZ ID  | Component | Failure Mode                                                                                  | Operational State | Effect                                                     | Severity | Likelihood | Risk Level  | Mitigation                                                                                                                 | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------------- | -------- | ---------- | ----------- | -------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-020 | SYS-010   | Retention guard deletes premium-only metadata during lapse instead of preserving for renewal. | LAPSE-GRACE       | User data loss and irreversible downgrade side effects.    | Critical | Remote     | Undesirable | REQ-021, REQ-024; SYS-010, SYS-007; ARCH-013 preserve-on-lapse policy + ARCH-001 audit trail.                              | Tolerable     |
| HAZ-021 | SYS-010   | Refund handling applies partial rollback without synchronized entitlement snapshot.           | RENEWAL           | Refund partial state with inconsistent feature visibility. | Serious  | Occasional | Undesirable | REQ-022, REQ-023, REQ-024; SYS-010, SYS-007; ARCH-013 transactional retention + ARCH-009 single-state transition boundary. | Tolerable     |

### SYS-011 — TypeScript Strict Compliance Layer

| HAZ ID  | Component | Failure Mode                                                                                               | Operational State | Effect                                               | Severity | Likelihood | Risk Level | Mitigation                                                                                     | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------- | ----------------- | ---------------------------------------------------- | -------- | ---------- | ---------- | ---------------------------------------------------------------------------------------------- | ------------- |
| HAZ-022 | SYS-011   | `any`-typed webhook payload field bypasses compile-time validation and misroutes subscription transitions. | WEBHOOK-INGEST    | Silent state corruption and entitlement drift.       | Serious  | Remote     | Tolerable  | REQ-NF-001, REQ-NF-002; SYS-011, SYS-009; ARCH-014 strict lint/type gates block unsafe merges. | Acceptable    |
| HAZ-023 | SYS-011   | Missing JSDoc on exported gate contract causes incorrect downstream integration assumptions.               | NORMAL            | Integration misuse and latent authorization defects. | Minor    | Occasional | Tolerable  | REQ-NF-002, REQ-IF-002; SYS-011, SYS-004; ARCH-014 doc-lint and CI contract enforcement.       | Acceptable    |

### SYS-012 — Accessibility Compliance Layer

| HAZ ID  | Component | Failure Mode                                                   | Operational State | Effect                                                                    | Severity | Likelihood | Risk Level  | Mitigation                                                                                            | Residual Risk |
| ------- | --------- | -------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- | -------- | ---------- | ----------- | ----------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-024 | SYS-012   | Upgrade CTA lacks accessible name in premium-gated flow.       | NORMAL            | Screen-reader users cannot complete upgrade/renew actions.                | Serious  | Occasional | Undesirable | REQ-NF-003, REQ-NF-004, REQ-018; SYS-012, SYS-006; ARCH-015 validator + ARCH-008 component semantics. | Tolerable     |
| HAZ-025 | SYS-012   | Color-only tier status indicator used in lapse warning banner. | LAPSE-GRACE       | Users miss critical lapse state, causing avoidable access loss confusion. | Minor    | Probable   | Tolerable   | REQ-NF-004, REQ-023; SYS-012; ARCH-015 enforces icon/text pairing in review gates.                    | Acceptable    |

### SYS-013 — Cross-Feature Gate Registry

| HAZ ID  | Component | Failure Mode                                                           | Operational State | Effect                                                                    | Severity | Likelihood | Risk Level  | Mitigation                                                                                                                                                                              | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------- | -------- | ---------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| HAZ-026 | SYS-013   | Registry omits newly premium feature or maps wrong tier after release. | NORMAL            | Premium feature exposed to free users or free feature incorrectly locked. | Critical | Occasional | Undesirable | REQ-IF-002, REQ-CN-001, REQ-CN-002; SYS-013, SYS-004; ARCH-006 canonical registry governance + ARCH-005 fail-closed unknown-feature behavior + ARCH-003/ARCH-004 resolver parity tests. | Tolerable     |

## Progressive Deepening (Architecture-Level)

The hazard register is system-centric (SYS-level) by design; architecture-level controls are cited in mitigations. Deepened, architecture-specific risk concentration appears around:

- **ARCH-012 WebhookSignatureValidator / ARCH-011 SubscriptionWebhookController**: replay, signature bypass, idempotency, and provider payload schema drift (HAZ-017..HAZ-019).
- **ARCH-009 SubscriptionLifecycleManager / ARCH-013 DataRetentionGuard**: grace-period correctness, refund partial-state handling, and downgrade/renewal consistency (HAZ-013, HAZ-014, HAZ-020, HAZ-021).
- **ARCH-005 FeatureGateMiddleware / ARCH-006 FeatureGateRegistry**: fail-closed authorization and tier mapping integrity (HAZ-007, HAZ-008, HAZ-026).

## Coverage Summary

| Metric                        | Value |
| ----------------------------- | ----- |
| Total System Components (SYS) | 13    |
| Components with ≥1 Hazard     | 13    |
| Total Hazards (HAZ)           | 26    |
| Catastrophic                  | 2     |
| Critical                      | 9     |
| Serious                       | 10    |
| Minor                         | 4     |
| Negligible                    | 0     |
| Undesirable (initial risk)    | 18    |
| Tolerable (initial risk)      | 8     |
| Unacceptable (initial risk)   | 0     |

Residual-risk posture after specified controls is `Tolerable` or `Acceptable` for all hazards.

## Frozen-Pending-Resolution Tracker

No `[FROZEN-PENDING-RESOLUTION]` markers are present in `specs/010-subscriptions/v-model/system-design.md` as of 2026-05-10.

## Domain Note (non-regulated)

This artifact intentionally uses general software FMEA semantics for a consumer SaaS subscription feature. No regulated-domain hazard taxonomy is used.

## Glossary

| Term             | Definition                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------------- |
| Webhook replay   | Duplicate delivery of the same provider event, requiring idempotent handling.                |
| Grace period     | Temporary interval after failed payment before premium lock is enforced.                     |
| Entitlement leak | Unauthorized premium access due to gate/claim/registry mismatch.                             |
| Partial state    | Subscription/access model where only a subset of expected fields or transitions are applied. |
