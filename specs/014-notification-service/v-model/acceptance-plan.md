# Acceptance Test Plan: Notification Service

**Feature Branch**: `014-notification-service`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/014-notification-service/v-model/requirements.md`

## Overview

Acceptance coverage maps every requirement (`REQ-001..REQ-041`) to ATP/SCN artifacts with full bidirectional traceability.

**Amended 2026-08-10.** ATP-032…ATP-041 cover REQ-032…REQ-041 (dual ingress) and are where SC-008…SC-011 are validated. See _Acceptance Tests — dual ingress_ and _Success Criteria Coverage_ below.

## ID Schema

- **Test Case**: `ATP-{NNN}-{X}`
- **Scenario**: `SCN-{NNN}-{X}{#}`

## Acceptance Tests

### Requirement Validation: REQ-001 (The system SHALL expose a single publish API at `/api/v1/notifications/publish` accepting )

#### Test Case: ATP-001-A (Nominal validation for REQ-001)

**Description:** Validates via **Test** that REQ-001 is satisfied on the expected success path.

- **User Scenario: SCN-001-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-001-B (Error/edge validation for REQ-001)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-001-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-002 (The publish API SHALL authenticate producer calls using the shared service-to-service mech)

#### Test Case: ATP-002-A (Nominal validation for REQ-002)

**Description:** Validates via **Test** that REQ-002 is satisfied on the expected success path.

- **User Scenario: SCN-002-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-002-B (Error/edge validation for REQ-002)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-002-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-003 (The publish API SHALL return success only after durable acceptance that survives single-in)

#### Test Case: ATP-003-A (Nominal validation for REQ-003)

**Description:** Validates via **Test** that REQ-003 is satisfied on the expected success path.

- **User Scenario: SCN-003-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-003-B (Error/edge validation for REQ-003)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-003-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-004 (The service SHALL validate `RecipientDescriptor` (`user|group|global`) and required/forbid)

#### Test Case: ATP-004-A (Nominal validation for REQ-004)

**Description:** Validates via **Test** that REQ-004 is satisfied on the expected success path.

- **User Scenario: SCN-004-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-004-B (Error/edge validation for REQ-004)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-004-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-005 (The service SHALL route `recipient.kind=user` only to subscribers whose authenticated iden)

#### Test Case: ATP-005-A (Nominal validation for REQ-005)

**Description:** Validates via **Test** that REQ-005 is satisfied on the expected success path.

- **User Scenario: SCN-005-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-005-B (Error/edge validation for REQ-005)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-005-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-006 (The service SHALL route `recipient.kind=group` to all users in group membership resolved a)

#### Test Case: ATP-006-A (Nominal validation for REQ-006)

**Description:** Validates via **Test** that REQ-006 is satisfied on the expected success path.

- **User Scenario: SCN-006-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-006-B (Error/edge validation for REQ-006)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-006-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-007 (The service SHALL route `recipient.kind=global` to all authenticated subscribers currently)

#### Test Case: ATP-007-A (Nominal validation for REQ-007)

**Description:** Validates via **Test** that REQ-007 is satisfied on the expected success path.

- **User Scenario: SCN-007-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-007-B (Error/edge validation for REQ-007)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-007-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-008 (The service SHALL preserve FIFO ordering per recipient for user/group deliveries and SHALL)

#### Test Case: ATP-008-A (Nominal validation for REQ-008)

**Description:** Validates via **Test** that REQ-008 is satisfied on the expected success path.

- **User Scenario: SCN-008-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-008-B (Error/edge validation for REQ-008)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-008-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-009 (The service SHALL treat global ordering as best-effort and SHALL document global broadcast)

#### Test Case: ATP-009-A (Nominal validation for REQ-009)

**Description:** Validates via **Inspection** that REQ-009 is satisfied on the expected success path.

- **User Scenario: SCN-009-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-009-B (Error/edge validation for REQ-009)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-009-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-010 (The service SHALL expose authenticated subscription capability under `/api/v1/notification)

#### Test Case: ATP-010-A (Nominal validation for REQ-010)

**Description:** Validates via **Test** that REQ-010 is satisfied on the expected success path.

- **User Scenario: SCN-010-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-010-B (Error/edge validation for REQ-010)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-010-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-011 (Clients SHALL dispatch by `messageType`; unknown keywords SHALL be logged and ignored with)

#### Test Case: ATP-011-A (Nominal validation for REQ-011)

**Description:** Validates via **Demonstration** that REQ-011 is satisfied on the expected success path.

- **User Scenario: SCN-011-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-011-B (Error/edge validation for REQ-011)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-011-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-012 (The service SHALL retain undelivered user/group messages for a configurable catch-up windo)

#### Test Case: ATP-012-A (Nominal validation for REQ-012)

**Description:** Validates via **Test** that REQ-012 is satisfied on the expected success path.

- **User Scenario: SCN-012-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-012-B (Error/edge validation for REQ-012)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-012-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-013 (The service SHALL expose operational counters for producer publishes, delivered-by-recipie)

#### Test Case: ATP-013-A (Nominal validation for REQ-013)

**Description:** Validates via **Test** that REQ-013 is satisfied on the expected success path.

- **User Scenario: SCN-013-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-013-B (Error/edge validation for REQ-013)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-013-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-014 (The service SHALL emit a distinct global-broadcast counter separable from user/group traff)

#### Test Case: ATP-014-A (Nominal validation for REQ-014)

**Description:** Validates via **Test** that REQ-014 is satisfied on the expected success path.

- **User Scenario: SCN-014-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-014-B (Error/edge validation for REQ-014)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-014-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-015 (Publish envelope schema validation SHALL occur before durable storage; malformed envelopes)

#### Test Case: ATP-015-A (Nominal validation for REQ-015)

**Description:** Validates via **Test** that REQ-015 is satisfied on the expected success path.

- **User Scenario: SCN-015-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-015-B (Error/edge validation for REQ-015)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-015-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-016 (The platform SHALL maintain a version-controlled messageType registry with owner feature a)

#### Test Case: ATP-016-A (Nominal validation for REQ-016)

**Description:** Validates via **Inspection** that REQ-016 is satisfied on the expected success path.

- **User Scenario: SCN-016-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-016-B (Error/edge validation for REQ-016)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-016-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-017 (The service SHALL support per-environment registry enforcement mode that rejects unregiste)

#### Test Case: ATP-017-A (Nominal validation for REQ-017)

**Description:** Validates via **Test** that REQ-017 is satisfied on the expected success path.

- **User Scenario: SCN-017-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-017-B (Error/edge validation for REQ-017)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-017-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-018 (The publish contract SHALL support optional producer idempotencyKey deduplication within c)

#### Test Case: ATP-018-A (Nominal validation for REQ-018)

**Description:** Validates via **Test** that REQ-018 is satisfied on the expected success path.

- **User Scenario: SCN-018-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-018-B (Error/edge validation for REQ-018)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-018-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-019 (The platform SHALL enforce per-producer publish quotas and emit throttled-publish counters)

#### Test Case: ATP-019-A (Nominal validation for REQ-019)

**Description:** Validates via **Test** that REQ-019 is satisfied on the expected success path.

- **User Scenario: SCN-019-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-019-B (Error/edge validation for REQ-019)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-019-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-020 (The service SHALL reject all unauthenticated subscribe/delivery attempts.)

#### Test Case: ATP-020-A (Nominal validation for REQ-020)

**Description:** Validates via **Test** that REQ-020 is satisfied on the expected success path.

- **User Scenario: SCN-020-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-020-B (Error/edge validation for REQ-020)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-020-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-021 (The service SHALL block cross-user subscription attempts that do not match the authenticat)

#### Test Case: ATP-021-A (Nominal validation for REQ-021)

**Description:** Validates via **Test** that REQ-021 is satisfied on the expected success path.

- **User Scenario: SCN-021-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-021-B (Error/edge validation for REQ-021)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-021-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-022 (Publish processing SHALL treat payload as opaque JSON and SHALL NOT semantically validate )

#### Test Case: ATP-022-A (Nominal validation for REQ-022)

**Description:** Validates via **Inspection** that REQ-022 is satisfied on the expected success path.

- **User Scenario: SCN-022-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-022-B (Error/edge validation for REQ-022)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-022-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-023 (Publish for unknown user or empty group recipients SHALL succeed with zero-delivery behavi)

#### Test Case: ATP-023-A (Nominal validation for REQ-023)

**Description:** Validates via **Test** that REQ-023 is satisfied on the expected success path.

- **User Scenario: SCN-023-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-023-B (Error/edge validation for REQ-023)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-023-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-024 (Publish API availability SHALL be at least 99.9% over the reporting window.)

#### Test Case: ATP-024-A (Nominal validation for REQ-024)

**Description:** Validates via **Analysis** that REQ-024 is satisfied on the expected success path.

- **User Scenario: SCN-024-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-024-B (Error/edge validation for REQ-024)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-024-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-025 (Connected publish-to-delivery latency p95 SHALL be at most 2 seconds under nominal load.)

#### Test Case: ATP-025-A (Nominal validation for REQ-025)

**Description:** Validates via **Test** that REQ-025 is satisfied on the expected success path.

- **User Scenario: SCN-025-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-025-B (Error/edge validation for REQ-025)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-025-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-026 (Every accepted publish and delivery event SHALL be observable via structured logs and quer)

#### Test Case: ATP-026-A (Nominal validation for REQ-026)

**Description:** Validates via **Test** that REQ-026 is satisfied on the expected success path.

- **User Scenario: SCN-026-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-026-B (Error/edge validation for REQ-026)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-026-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-027 (Backpressure controls SHALL ensure a misbehaving producer does not increase unrelated prod)

#### Test Case: ATP-027-A (Nominal validation for REQ-027)

**Description:** Validates via **Analysis** that REQ-027 is satisfied on the expected success path.

- **User Scenario: SCN-027-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-027-B (Error/edge validation for REQ-027)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-027-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-028 (The runtime target SHALL be Node.js 24.x in alignment with monorepo engine constraints.)

#### Test Case: ATP-028-A (Nominal validation for REQ-028)

**Description:** Validates via **Inspection** that REQ-028 is satisfied on the expected success path.

- **User Scenario: SCN-028-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-028-B (Error/edge validation for REQ-028)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-028-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-029 (Package naming for any notification-service packages SHALL follow `@kitchensink/{group}-{n)

#### Test Case: ATP-029-A (Nominal validation for REQ-029)

**Description:** Validates via **Inspection** that REQ-029 is satisfied on the expected success path.

- **User Scenario: SCN-029-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-029-B (Error/edge validation for REQ-029)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-029-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-030 (At launch, at least five messageType registry entries SHALL exist spanning 003 plus reserv)

#### Test Case: ATP-030-A (Nominal validation for REQ-030)

**Description:** Validates via **Demonstration** that REQ-030 is satisfied on the expected success path.

- **User Scenario: SCN-030-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-030-B (Error/edge validation for REQ-030)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-030-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

### Requirement Validation: REQ-031 (The feature SHALL explicitly close WA-004 by documenting notification-service ownership in)

#### Test Case: ATP-031-A (Nominal validation for REQ-031)

**Description:** Validates via **Inspection** that REQ-031 is satisfied on the expected success path.

- **User Scenario: SCN-031-A1**
    - **Given** prerequisite identities/configuration are set for the requirement
    - **When** the relevant publish/subscribe/operation behavior is executed
    - **Then** observed outputs satisfy the requirement acceptance condition

#### Test Case: ATP-031-B (Error/edge validation for REQ-031)

**Description:** Validates negative-path and boundary behavior with structured failure or guardrail outcomes.

- **User Scenario: SCN-031-B1**
    - **Given** malformed, unauthorized, or boundary-stressing input for this requirement
    - **When** the operation is attempted
    - **Then** the system rejects/degrades according to the requirement-defined constraints

---

## Acceptance Tests — dual ingress (added 2026-08-10)

These cover REQ-032…REQ-041 and are where SC-008…SC-011 are validated. Unlike the blocks above they state concrete inputs and falsifiable outcomes, because every one of them is a rule that can be satisfied on one ingress path and missed on the other.

### Requirement Validation: REQ-032 (Both ingress paths execute the same core logic; a rule enforced in only one adapter is a defect)

#### Test Case: ATP-032-A (Ingress equivalence for REQ-032 — validates SC-008)

**Description:** Validates via **Test** that one envelope produces one identical outcome regardless of which adapter accepted it.

- **User Scenario: SCN-032-A1**
    - **Given** one envelope E, a registered producer, and a subscriber for `E.recipient`
    - **When** E is published over `POST /api/v1/notifications/publish` and, separately, put on the notification bus under the reserved `detailType`
    - **Then** the two delivered messages are identical field for field, excluding only the service-assigned `id`, `sequence` and `publishedAt`

#### Test Case: ATP-032-B (Paired rule rejection for REQ-032 — validates SC-008)

**Description:** Validates that each rejection rule fires identically on both paths, and that a rule present on only one path fails the suite.

- **User Scenario: SCN-032-B1**
    - **Given** the rule set of REQ-034, REQ-015, REQ-017, REQ-019 and REQ-035, one violating envelope per rule
    - **When** each violating envelope is submitted over both adapters
    - **Then** both adapters reject it for the same reason, and a build in which any one rule is removed from a single adapter fails this test case

---

### Requirement Validation: REQ-033 (The event path ingests envelopes only, on a reserved `detailType`)

#### Test Case: ATP-033-A (Reserved `detailType` ingest for REQ-033)

**Description:** Validates via **Test** that the adapter consumes envelopes and nothing else.

- **User Scenario: SCN-033-A1**
    - **Given** the notification bus carrying both an envelope on the reserved `detailType` and a producer domain event on its own `detailType`
    - **When** the adapter runs
    - **Then** the envelope is ingested and the domain event is ignored — not parsed, not interpreted, not dead-lettered

#### Test Case: ATP-033-B (No recipient inference for REQ-033)

**Description:** Validates that no recipient is ever derived from a domain event or from `payload`.

- **User Scenario: SCN-033-B1**
    - **Given** a domain event that names a user inside its detail body
    - **When** it is placed on the bus
    - **Then** no notification is created, and no code path reads the event's body to infer a recipient (REQ-022)

---

### Requirement Validation: REQ-034 (Minimum envelope, per ingress path, rejected not defaulted)

#### Test Case: ATP-034-A (Complete envelope accepted on both paths for REQ-034)

**Description:** Validates via **Test** that the FR-026 field set is accepted and persisted intact on both adapters.

- **User Scenario: SCN-034-A1**
    - **Given** an envelope carrying `schemaVersion`, `recipient`, `messageType`, `occurredAt`, `payload`, `idempotencyKey` and `producer`
    - **When** it is published over each adapter
    - **Then** it is accepted, and `schemaVersion`, `producer` and `occurredAt` are persisted as submitted

#### Test Case: ATP-034-B (Per-field rejection, no defaulting, for REQ-034)

**Description:** Validates that each required field omitted individually is rejected on the paths that require it, and never substituted.

- **User Scenario: SCN-034-B1**
    - **Given** `schemaVersion`, `recipient`, `messageType`, `occurredAt` and `payload` each omitted in turn, plus `idempotencyKey` and `producer` each omitted in turn
    - **When** each variant is submitted over both adapters
    - **Then** the first five are rejected on both paths and the last two on the EventBridge path, no partially-routed record exists, and `occurredAt` is never stamped with receipt time

---

### Requirement Validation: REQ-035 (Event-path trust boundary — resource policy AND `source` allowlist)

#### Test Case: ATP-035-A (Allowlisted producer accepted for REQ-035)

**Description:** Validates via **Test** that a registered producer publishing from an allowlisted `source` is accepted.

- **User Scenario: SCN-035-A1**
    - **Given** a producer whose registry entry allowlists its event `source`, and a principal permitted by the bus resource policy
    - **When** it puts an envelope on the bus
    - **Then** the envelope is accepted and delivered to `recipient`

#### Test Case: ATP-035-B (Spoofing rejected, both controls, for REQ-035 — validates SC-009)

**Description:** Validates that each control fails the attack independently, so that neither can be dropped.

- **User Scenario: SCN-035-B1**
    - **Given** an envelope addressed to user U whose `source` is not on the allowlist
    - **When** it is put on the bus by a permitted principal
    - **Then** it is rejected, dead-lettered with reason `source_not_allowlisted`, and never delivered to U or to any subscriber
- **User Scenario: SCN-035-B2**
    - **Given** a principal not named in the bus resource policy
    - **When** it attempts `PutEvents` with a well-formed envelope claiming an allowlisted `source`
    - **Then** the AWS API denies the call, so the envelope never reaches the adapter — proving the allowlist is not the only barrier

---

### Requirement Validation: REQ-036 (Event-path rejections dead-letter, count by reason, and alarm)

#### Test Case: ATP-036-A (Reason-coded dead-lettering for REQ-036 — validates SC-009)

**Description:** Validates via **Test** that every rejection reason produces a DLQ record and its own counter.

- **User Scenario: SCN-036-A1**
    - **Given** one rejecting envelope per reason — malformed, unregistered under enforcement, quota-exceeded, `source` not allowlisted
    - **When** each is put on the bus
    - **Then** each lands on the DLQ carrying its reason code and increments the counter for that reason alone

#### Test Case: ATP-036-B (No silent drop, and DLQ depth alarms, for REQ-036)

**Description:** Validates that a rejection cannot be discarded without a record, and that depth is alarmed rather than merely recorded.

- **User Scenario: SCN-036-B1**
    - **Given** the DLQ at zero depth
    - **When** a rejecting envelope is put on the bus
    - **Then** DLQ depth becomes one, the alarm on depth transitions, and a build that drops the rejection without a DLQ record fails this test case

---

### Requirement Validation: REQ-037 (Cross-path ordering by producer-assigned `occurredAt`)

#### Test Case: ATP-037-A (Out-of-order arrivals delivered in publish order for REQ-037)

**Description:** Validates via **Test** that ordering follows `occurredAt`, not arrival.

- **User Scenario: SCN-037-A1**
    - **Given** 100 envelopes for one recipient with strictly increasing `occurredAt`, published across both adapters and made to arrive in shuffled order
    - **When** the recipient's client receives them
    - **Then** they are delivered in `occurredAt` order with a gap-free `sequence`

#### Test Case: ATP-037-B (Tie and degradation behavior for REQ-037)

**Description:** Validates the tiebreaker and the honest-narrowing path.

- **User Scenario: SCN-037-B1**
    - **Given** two envelopes for one recipient with identical `occurredAt`
    - **When** both are ingested
    - **Then** their relative order is decided by the deterministic tiebreaker and is stable across repeated runs
- **User Scenario: SCN-037-B2**
    - **Given** an implementation that cannot guarantee cross-path FIFO for one recipient
    - **When** the acceptance gate is evaluated
    - **Then** REQ-008 is narrowed explicitly in `spec.md` and here, rather than this test case being waived

---

### Requirement Validation: REQ-038 (`idempotencyKey` derived from durable domain state)

#### Test Case: ATP-038-A (Transport replay delivers once for REQ-038 — validates SC-011)

**Description:** Validates via **Test** that at-least-once redelivery collapses to one delivery.

- **User Scenario: SCN-038-A1**
    - **Given** an envelope whose `idempotencyKey` is derived from a job identity plus its terminal status
    - **When** the identical event is replayed on the bus with that key unchanged
    - **Then** exactly one `notification` row exists and the recipient observes exactly one delivery

> **What "exactly once" means here.** SC-011's wording is stronger than the transport: SQS delivery to the
> routing consumer is at-least-once, which is why US-010 requires idempotent handlers and the client dedupes
> on `(recipient, sequence)`. What this test case proves is the **publish-side collapse** — a replayed event
> yields one notification and one delivery per client, not zero duplicates at every layer. The SC wording is
> flagged for narrowing in `peer-review-requirements.md` PRF-REQ-007.

#### Test Case: ATP-038-B (Transport-derived key does not deduplicate for REQ-038)

**Description:** Validates the negative case, which is the one a producer gets wrong.

- **User Scenario: SCN-038-B1**
    - **Given** an envelope whose `idempotencyKey` is derived from an event id or a clock
    - **When** the producer retries the publish
    - **Then** two deliveries occur, demonstrating that such a key satisfies REQ-018 in form only

---

### Requirement Validation: REQ-039 (No aggregation; correlation is publisher-owned)

#### Test Case: ATP-039-A (N publishes yield N deliveries for REQ-039 — validates SC-010)

**Description:** Validates via **Test** that this service never merges envelopes.

- **User Scenario: SCN-039-A1**
    - **Given** N distinct envelopes addressed to one recipient within one second
    - **When** the recipient's client receives them
    - **Then** exactly N deliveries arrive and none is merged, batched or summarised

#### Test Case: ATP-039-B (Fan-in is the publisher's job for REQ-039)

**Description:** Validates that the reference fan-in producer collapses its own fan-out before publishing.

- **User Scenario: SCN-039-B1**
    - **Given** a publisher whose single unit of work fans out into 30 independent completions
    - **When** it correlates them against its own durable job identity and publishes
    - **Then** one envelope is published and one notification is delivered, and a redelivered underlying completion yields no second envelope

---

### Requirement Validation: REQ-040 (Ed25519 service-principal token, verified networklessly)

#### Test Case: ATP-040-A (Networkless verification for REQ-040)

**Description:** Validates via **Test** that a valid token is accepted with no outbound call.

- **User Scenario: SCN-040-A1**
    - **Given** a valid Ed25519 service-principal token and the configured public key, with outbound network access blocked
    - **When** the producer publishes
    - **Then** verification succeeds and the publish is accepted

#### Test Case: ATP-040-B (Invalid token and missing key fail closed for REQ-040)

**Description:** Validates that neither a bad signature nor an absent key admits a caller.

- **User Scenario: SCN-040-B1**
    - **Given** a token with an invalid signature, an expired token, and separately an unconfigured public key
    - **When** each publish is attempted
    - **Then** each is rejected, and no path falls back to an outbound verification call

---

### Requirement Validation: REQ-041 (Quota declared per producer at registration, rejections alarmed)

#### Test Case: ATP-041-A (Declared quota is the effective quota for REQ-041)

**Description:** Validates via **Test** that the enforced bound is the registered one.

- **User Scenario: SCN-041-A1**
    - **Given** two producers whose registry entries declare different quotas
    - **When** each publishes at its own declared ceiling
    - **Then** both are accepted, and neither is bounded by the other's value or by a global default

#### Test Case: ATP-041-B (Rejection is alarmed, not silent, for REQ-041)

**Description:** Validates that exceeding the quota is visible to an operator.

- **User Scenario: SCN-041-B1**
    - **Given** a producer publishing above its declared quota
    - **When** the excess publishes are rejected
    - **Then** each rejection returns a structured rate-limit error on the HTTP path, dead-letters on the event path, increments the per-producer throttled counter, and raises an alarm

---

## Success Criteria Coverage (SC-001…SC-011)

| SC     | Statement (abbreviated)                                                      | Acceptance coverage      |
| ------ | ---------------------------------------------------------------------------- | ------------------------ |
| SC-001 | End-to-end publish → dispatch, over BOTH paths, synthetic reference producer | ATP-032-A, ATP-011-A     |
| SC-002 | Per-recipient FIFO over 100 messages, 10 runs                                | ATP-008-A, ATP-037-A     |
| SC-003 | Catch-up window                                                              | ATP-012-A, ATP-012-B     |
| SC-004 | Counters reflect ground truth within one minute                              | ATP-013-A, ATP-026-A     |
| SC-005 | Cross-user subscription rejected                                             | ATP-021-A, ATP-021-B     |
| SC-006 | ≥ 5 registered `messageType` keywords at launch                              | ATP-030-A                |
| SC-007 | WA-004 closed                                                                | ATP-031-A                |
| SC-008 | Both ingress paths proven equivalent, per-rule paired tests                  | **ATP-032-A, ATP-032-B** |
| SC-009 | Event path rejects spoofing; 100% dead-lettered, none delivered              | **ATP-035-B, ATP-036-A** |
| SC-010 | No-aggregation contract observable                                           | **ATP-039-A**            |
| SC-011 | Transport-redelivered envelope delivered exactly once                        | **ATP-038-A**            |

## Coverage Summary

| Metric                   | Count          |
| ------------------------ | -------------- |
| Total Requirements (REQ) | 41             |
| Total Test Cases (ATP)   | 82             |
| Total Scenarios (SCN)    | 84             |
| Requirements with ≥1 ATP | 41 / 41 (100%) |
| Test Cases with ≥1 SCN   | 82 / 82 (100%) |
| **Overall Coverage**     | **100%**       |

Two test cases carry a second scenario — SCN-035-B2 and SCN-037-B2 — which is why scenarios exceed test cases. Each exists because one assertion cannot express the requirement: REQ-035 needs its two controls proven independently, since either alone passing would let the other be dropped, and REQ-037 needs the explicit-narrowing outcome stated as a scenario so it cannot be reached by waiver.
