# Hazard Analysis (FMEA): Notification Service

**Feature Branch**: `014-notification-service`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/014-notification-service/v-model/system-design.md`
**Standard**: General-Purpose FMEA (non-regulated software; `domain: ''`)

## Overview

This FMEA evaluates each `SYS-NNN` component for realistic failure modes impacting trust, privacy, availability, routing correctness, and operational resilience in a shared notification platform.

**Amended 2026-08-10.** HAZ-032…HAZ-041 cover SYS-032…SYS-041, the dual-ingress decomposition (`spec.md` FR-024…FR-033). The 2026-05-13 register contained no hazard for EventBridge, envelope spoofing, `source` allowlisting or bus resource policies, because the design it analysed had one authenticated door. Adding a second, **credential-less** ingress moves the feature's largest security hazard from "cross-tenant leak through a routing bug" (HAZ-006) to "arbitrary recipient addressing through an unauthenticated publish channel" (HAZ-035) — a different failure mode with a different control, so it is registered separately rather than folded into HAZ-006. Two of the new hazards are silence hazards (HAZ-036, HAZ-037): the system continues to look healthy while it is wrong, which is why both are alarmed rather than merely counted.

## ID Schema

- **Hazard ID**: `HAZ-{NNN}` sequential and never renumbered.
- **Mitigation** references `REQ-NNN` / `SYS-NNN` controls for matrix lineage.

## Risk Matrix Definition

### Severity Scale (consumer SaaS)

| Level        | Definition                                                       |
| ------------ | ---------------------------------------------------------------- |
| Catastrophic | Broad cross-tenant leak or prolonged platform outage.            |
| Critical     | Severe privacy/security/availability degradation for many users. |
| Serious      | Significant but recoverable delivery or operability degradation. |
| Minor        | Limited user-impacting defect with workaround.                   |
| Negligible   | Cosmetic or low-impact operational noise.                        |

### Likelihood Scale

| Level      | Definition                                   |
| ---------- | -------------------------------------------- |
| Frequent   | Expected repeatedly under normal operations. |
| Probable   | Likely to occur occasionally.                |
| Occasional | Plausible but intermittent.                  |
| Remote     | Unlikely with current controls.              |
| Improbable | Highly unlikely edge condition.              |

### Risk Level Matrix

| Severity \ Likelihood | Frequent    | Probable    | Occasional  | Remote      | Improbable |
| --------------------- | ----------- | ----------- | ----------- | ----------- | ---------- |
| Catastrophic          | Intolerable | Intolerable | Undesirable | Undesirable | Tolerable  |
| Critical              | Intolerable | Undesirable | Undesirable | Tolerable   | Tolerable  |
| Serious               | Undesirable | Undesirable | Tolerable   | Tolerable   | Acceptable |
| Minor                 | Tolerable   | Tolerable   | Acceptable  | Acceptable  | Acceptable |
| Negligible            | Acceptable  | Acceptable  | Acceptable  | Acceptable  | Acceptable |

## Operational States

- `NORMAL` — steady publish/subscribe operations.
- `RECONNECT` — subscriber reconnect and backlog replay.
- `DEGRADED` — partial dependency outage or elevated retries.
- `INCIDENT` — high-risk security/privacy or systemic failure condition.

## Hazard Register (FMEA)

> One or more hazards per SYS. Required notification-service themes are explicitly included.

### SYS-001 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                      | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation                         | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------------------------- | ------------- |
| HAZ-001 | SYS-001   | Notification storm/DoS overwhelms publish ingress and degrades unrelated traffic. | INCIDENT          | Delivery privacy/integrity/availability objective is violated for affected audience. | Critical | Occasional | Undesirable | REQ-019, REQ-027, SYS-019, SYS-027 | Tolerable     |

### SYS-002 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                     | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-002 | SYS-002   | Opt-out/policy bypass causes delivery where suppression should apply in future preference modes. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-002, SYS-002 | Tolerable     |

### SYS-003 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                       | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-003 | SYS-003   | Push-token/session token leak exposes recipient endpoint metadata. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-003, SYS-003 | Tolerable     |

### SYS-004 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                        | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation       | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------- | ------------- |
| HAZ-004 | SYS-004   | Quiet-hours violation delivers time-sensitive notifications during blocked windows. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Serious  | Occasional | Undesirable | REQ-004, SYS-004 | Tolerable     |

### SYS-005 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                         | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation       | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------- | ------------- |
| HAZ-005 | SYS-005   | Deduplication failure causes duplicate deliveries and user distrust. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Serious  | Occasional | Undesirable | REQ-005, SYS-005 | Tolerable     |

### SYS-006 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation                | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ------------------------- | ------------- |
| HAZ-006 | SYS-006   | Cross-tenant message leak routes payload to unauthorized tenant/user scope. | INCIDENT          | Delivery privacy/integrity/availability objective is violated for affected audience. | Critical | Occasional | Undesirable | REQ-005, REQ-021, SYS-006 | Tolerable     |

### SYS-007 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                             | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation       | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------- | ------------- |
| HAZ-007 | SYS-007   | Retry amplification creates cascading queue pressure and repeated sends. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Serious  | Occasional | Undesirable | REQ-007, SYS-007 | Tolerable     |

### SYS-008 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                 | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation       | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------- | ------------- |
| HAZ-008 | SYS-008   | Expired-token cascade triggers broad subscribe failures after auth rotation. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Serious  | Occasional | Undesirable | REQ-008, SYS-008 | Tolerable     |

### SYS-009 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                               | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation       | Residual Risk |
| ------- | --------- | -------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------- | ------------- |
| HAZ-009 | SYS-009   | Locale fallback corruption renders malformed/misleading localized content. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Serious  | Occasional | Undesirable | REQ-009, SYS-009 | Tolerable     |

### SYS-010 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                        | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation       | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------- | ------------- |
| HAZ-010 | SYS-010   | Time-zone scheduling drift delivers at wrong local wall-clock time. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Serious  | Occasional | Undesirable | REQ-010, SYS-010 | Tolerable     |

### SYS-011 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                  | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation                         | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------------------------- | ------------- |
| HAZ-011 | SYS-011   | GDPR erasure miss leaves notification history artifacts after delete request. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Serious  | Occasional | Undesirable | REQ-012, REQ-031, SYS-012, SYS-031 | Tolerable     |

### SYS-012 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------- | ------------- |
| HAZ-012 | SYS-012   | APNs/FCM/SES/SNS vendor outage cascades into prolonged undelivered backlog. | INCIDENT          | Delivery privacy/integrity/availability objective is violated for affected audience. | Critical | Occasional | Undesirable | REQ-012, SYS-012 | Tolerable     |

### SYS-013 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                            | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level  | Mitigation                         | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------------------------- | ------------- |
| HAZ-013 | SYS-013   | End-to-end latency SLO breach exceeds 2s p95 for connected subscribers. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Serious  | Occasional | Undesirable | REQ-025, REQ-026, SYS-025, SYS-026 | Tolerable     |

### SYS-014 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-014 | SYS-014   | SYS-014 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-014, SYS-014 | Tolerable     |

### SYS-015 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-015 | SYS-015   | SYS-015 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-015, SYS-015 | Tolerable     |

### SYS-016 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-016 | SYS-016   | SYS-016 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-016, SYS-016 | Tolerable     |

### SYS-017 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-017 | SYS-017   | SYS-017 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-017, SYS-017 | Tolerable     |

### SYS-018 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-018 | SYS-018   | SYS-018 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-018, SYS-018 | Tolerable     |

### SYS-019 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-019 | SYS-019   | SYS-019 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-019, SYS-019 | Tolerable     |

### SYS-020 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-020 | SYS-020   | SYS-020 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-020, SYS-020 | Tolerable     |

### SYS-021 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-021 | SYS-021   | SYS-021 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-021, SYS-021 | Tolerable     |

### SYS-022 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-022 | SYS-022   | SYS-022 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-022, SYS-022 | Tolerable     |

### SYS-023 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-023 | SYS-023   | SYS-023 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-023, SYS-023 | Tolerable     |

### SYS-024 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-024 | SYS-024   | SYS-024 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-024, SYS-024 | Tolerable     |

### SYS-025 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-025 | SYS-025   | SYS-025 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-025, SYS-025 | Tolerable     |

### SYS-026 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-026 | SYS-026   | SYS-026 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-026, SYS-026 | Tolerable     |

### SYS-027 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-027 | SYS-027   | SYS-027 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-027, SYS-027 | Tolerable     |

### SYS-028 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-028 | SYS-028   | SYS-028 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-028, SYS-028 | Tolerable     |

### SYS-029 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-029 | SYS-029   | SYS-029 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-029, SYS-029 | Tolerable     |

### SYS-030 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-030 | SYS-030   | SYS-030 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-030, SYS-030 | Tolerable     |

### SYS-031 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                | Operational State | Effect                                                                               | Severity | Likelihood | Risk Level | Mitigation       | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------- | ------------- |
| HAZ-031 | SYS-031   | SYS-031 control path fails open/closed causing requirement non-conformance. | DEGRADED          | Delivery privacy/integrity/availability objective is violated for affected audience. | Minor    | Remote     | Tolerable  | REQ-031, SYS-031 | Tolerable     |

### SYS-032 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                                                            | Operational State | Effect                                                                                                                   | Severity | Likelihood | Risk Level  | Mitigation                                     | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------ | -------- | ---------- | ----------- | ---------------------------------------------- | ------------- |
| HAZ-032 | SYS-032   | A rule is implemented in one ingress adapter and not the other, so the second path silently bypasses validation, registry enforcement, quota or dedupe. | NORMAL            | Every guarantee the bypassed rule provides is void for one class of producer, with no error and no counter to reveal it. | Critical | Probable   | Undesirable | REQ-032, SYS-032, SYS-033, SC-008 paired tests | Tolerable     |

> **Why Probable, not Remote.** Two adapters over one core is a discipline, not a mechanism: nothing in the type system stops a maintainer adding a check to the HTTP controller alone, and the event path has no caller to complain. The control is the paired per-rule test of SC-008, which fails when a rule exists on only one path. Without those tests the residual risk is **Undesirable**, not Tolerable.

### SYS-033 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                                          | Operational State | Effect                                                                                                                              | Severity | Likelihood | Risk Level | Mitigation                         | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ---------- | ---------------------------------- | ------------- |
| HAZ-033 | SYS-033   | The bus rule is widened past the reserved `detailType`, so a producer's domain event is ingested and a recipient is inferred from it. | DEGRADED          | A notification is addressed by guesswork rather than by a publisher's decision, and `payload` is inspected in violation of REQ-022. | Serious  | Occasional | Tolerable  | REQ-033, REQ-022, SYS-033, SYS-034 | Tolerable     |

### SYS-034 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                                              | Operational State | Effect                                                                                                                                                                              | Severity | Likelihood | Risk Level  | Mitigation                         | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------- | ------------- |
| HAZ-034 | SYS-034   | A missing required field is defaulted instead of rejected — `occurredAt` stamped at receipt, `schemaVersion` assumed, `producer` guessed. | NORMAL            | The envelope is durably accepted and delivered while its ordering key, its dedupe key or its attribution is fabricated. Every downstream guarantee built on those fields is untrue. | Critical | Occasional | Undesirable | REQ-034, SYS-034, REQ-037, REQ-038 | Tolerable     |

### SYS-035 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                                                                                                  | Operational State | Effect                                                                                                                                                                                                                                  | Severity     | Likelihood | Risk Level  | Mitigation                                        | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------- | ----------- | ------------------------------------------------- | ------------- |
| HAZ-035 | SYS-035   | Envelope spoofing on the credential-less event path: the bus resource policy is absent or over-broad, or the `source` allowlist is not validated, or one of the two is treated as sufficient. | INCIDENT          | Any principal with bus access addresses a notification to any user, with a `messageType` and `payload` of its choosing. REQ-005, REQ-020 and REQ-021 are defeated at once, and the delivery is indistinguishable from a legitimate one. | Catastrophic | Occasional | Undesirable | REQ-035 (both controls), REQ-036, SYS-035, SC-009 | Tolerable     |

> **This is the feature's highest-severity hazard, and it is a two-control hazard.** The resource policy fails the attempt at the AWS API; the `source` allowlist fails it at the adapter. Each covers what the other cannot: the policy cannot distinguish which `source` an authorised principal claims, and the allowlist cannot stop an unauthorised principal from filling the bus. Residual risk is **Tolerable only with both present**. With either one alone it is **Intolerable**, because a single missing control converts the event path into an open publish channel and no counter distinguishes the resulting deliveries from real ones. Verified by SC-009 — 100% of non-allowlisted `source` values rejected and dead-lettered, none ever delivered.

### SYS-036 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                | Operational State | Effect                                                                                                                                                                                                                  | Severity | Likelihood | Risk Level  | Mitigation                                 | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------- | ------------------------------------------ | ------------- |
| HAZ-036 | SYS-036   | An event-path rejection is dropped without a dead-letter record, a reason code or an alarm. | DEGRADED          | A dropped rejection is indistinguishable from a successful delivery. The publisher's `PutEvents` succeeded, so it believes the user was told; the user was never told; nothing anywhere records that a message existed. | Critical | Probable   | Undesirable | REQ-036, SYS-036, SYS-013, DLQ depth alarm | Tolerable     |

> **Why this is a hazard and not merely missing telemetry.** On the HTTP path a rejection returns a structured error and the producer can react. The event path has no caller. The DLQ is therefore not an observability nicety, it is the only record that the rejection happened, and its depth is the only signal an operator gets. An unalarmed DLQ has the same operational value as no DLQ.

### SYS-037 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                                  | Operational State | Effect                                                                                                                                                                                                  | Severity | Likelihood | Risk Level  | Mitigation                               | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------- | ---------------------------------------- | ------------- |
| HAZ-037 | SYS-037   | Event-path arrivals are enqueued in arrival order, so the FIFO queue faithfully preserves an order that is not publish order. | NORMAL            | Per-recipient FIFO (REQ-008) becomes silently untrue for every event-path producer. The queue reports healthy, the sequence is gap-free, the client detects no gap — and the messages are out of order. | Serious  | Probable   | Undesirable | REQ-037, SYS-037, SC-002 cross-path runs | Tolerable     |

> EventBridge does not preserve ordering; this hazard is a property of the transport, not a defect that might not occur. The control is ordering by producer-assigned `occurredAt` with a deterministic tiebreaker before enqueue, exercised by a cross-path SC-002 run. If that proves unachievable, REQ-008 is narrowed explicitly — an honestly narrowed guarantee is not a hazard, a silently false one is.

### SYS-038 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                                  | Operational State | Effect                                                                                                                                      | Severity | Likelihood | Risk Level  | Mitigation                        | Residual Risk |
| ------- | --------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------- | --------------------------------- | ------------- |
| HAZ-038 | SYS-038   | An `idempotencyKey` is derived from a transport identifier or a clock, so it changes on every retry and matches no prior key. | NORMAL            | Deduplication is present but inert. At-least-once redelivery produces a duplicate user-visible notification, and REQ-018 appears satisfied. | Serious  | Probable   | Undesirable | REQ-038, REQ-034, SYS-018, SC-011 | Tolerable     |

### SYS-039 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                                                         | Operational State | Effect                                                                                                                                                                                | Severity | Likelihood | Risk Level  | Mitigation                              | Residual Risk |
| ------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ----------- | --------------------------------------- | ------------- |
| HAZ-039 | SYS-039   | A publisher publishes one envelope per underlying completion instead of one per user-meaningful outcome, or this service grows an aggregation stage. | DEGRADED          | Either the user receives a storm — 30 notifications for one import — or this service inspects `payload` to collapse them, violating REQ-022 and taking on knowledge it does not have. | Serious  | Probable   | Undesirable | REQ-039, REQ-022, SC-010, REQ-041 quota | Tolerable     |

> The quota of REQ-041 bounds the blast radius of a mis-correlating publisher but does not fix it: a throttled storm is still a storm minus the throttled tail. The control is the publisher-side translator, plus SC-010 asserting that N publishes for one recipient arrive as N deliveries — which is deliberately a test that this service does **not** help.

### SYS-040 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                                            | Operational State | Effect                                                                                                                              | Severity | Likelihood | Risk Level | Mitigation                         | Residual Risk |
| ------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------- | ---------- | ---------------------------------- | ------------- |
| HAZ-040 | SYS-040   | Token verification fails open when the public key is unavailable, or falls back to a network round trip that then times out under load. | INCIDENT          | Either an unauthenticated caller publishes on the HTTP path, or publish availability collapses to that of a third-party dependency. | Critical | Remote     | Tolerable  | REQ-040, REQ-002, SYS-040, NFR-001 | Tolerable     |

### SYS-041 — Component Hazard Analysis

| HAZ ID  | Component | Failure Mode                                                                                                             | Operational State | Effect                                                                                                                                     | Severity | Likelihood | Risk Level | Mitigation                         | Residual Risk |
| ------- | --------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- | ---------- | ---------- | ---------------------------------- | ------------- |
| HAZ-041 | SYS-041   | The quota is inferred from a producer's internals or hard-coded, and a quota rejection is counted without being alarmed. | DEGRADED          | The bound drifts from the producer it describes, and a rejected notification is a message the user never receives with no operator signal. | Serious  | Occasional | Tolerable  | REQ-041, REQ-019, SYS-013, SYS-041 | Tolerable     |

## Progressive Deepening (Architecture-Level)

| Deepening Target               | Trigger                                                             | Planned Follow-up                                                                                                              |
| ------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| ARCH-level retry topology      | Repeated retry-amplification incidents                              | Add architecture-level throttling and retry budget hazard decomposition.                                                       |
| Registry governance controls   | High unregistered messageType rates                                 | Extend controls around registry ownership enforcement workflow.                                                                |
| Dependency outage choreography | Multi-vendor outage simulation findings                             | Expand degraded-mode delivery policies and failover narratives.                                                                |
| Bus resource-policy drift      | Any change to the notification bus policy or the `source` allowlist | Decompose HAZ-035 per principal; assert the two controls independently in infra tests, since either alone is Intolerable.      |
| Cross-path ordering under load | An SC-002 cross-path run failing, or a narrowing of REQ-008         | Decompose HAZ-037 by clock skew between producers, since `occurredAt` is producer-assigned and producers do not share a clock. |
| Publisher fan-in correctness   | A storm reaching a user from a mis-correlating publisher            | Decompose HAZ-039 per publisher; the control lives in the publisher, so this service can only detect it, not prevent it.       |

## Coverage Summary

| Metric                  | Value          |
| ----------------------- | -------------- |
| Total SYS Components    | 41             |
| Total Hazards           | 41             |
| SYS with ≥1 Hazard      | 41 / 41 (100%) |
| Hazards with Mitigation | 41 / 41 (100%) |

### Risk profile of the 2026-08-10 additions

| Risk Level  | Hazards                                                       |
| ----------- | ------------------------------------------------------------- |
| Undesirable | HAZ-032, HAZ-034, HAZ-035, HAZ-036, HAZ-037, HAZ-038, HAZ-039 |
| Tolerable   | HAZ-033, HAZ-040, HAZ-041                                     |

HAZ-035 is the only Catastrophic-severity hazard in the register. **Seven of the ten new hazards are Undesirable before mitigation — a 70% rate against 35% (11 of 31) for the original register.** Adding a credential-less ingress is the single largest increase in this feature's risk surface, which is why FR-027's two controls are stated as requirements rather than left to implementation.

## Frozen-Pending-Resolution Tracker

- None declared in 014 upstream sources.
- **Conditional, not frozen:** REQ-037 permits REQ-008 to be narrowed if cross-path per-recipient FIFO proves unachievable. That is a decision owed at implementation, tracked on `tasks.md` T-038. Until it is taken, HAZ-037's mitigation is assumed effective; if REQ-008 is narrowed instead, HAZ-037 is downgraded and the narrowing is recorded here.

## Domain Note (non-regulated)

General-purpose software FMEA is applied. No ISO 26262 / IEC 62304 / DO-178C safety sections are used.

## Glossary

| Term          | Definition                                                                            |
| ------------- | ------------------------------------------------------------------------------------- |
| Hazard        | Potential failure mode affecting platform trust, privacy, integrity, or availability. |
| Residual Risk | Remaining risk after mapped controls are applied.                                     |
