# System Test Plan: Notification Service

**Feature Branch**: `014-notification-service`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/014-notification-service/v-model/system-design.md`

## Overview

System-level verification covers every `SYS-001..SYS-041` with named ISO 29119 techniques and technical scenarios.

**Amended 2026-08-10.** STP-032…STP-041 cover the dual-ingress components SYS-032…SYS-041 and are where SC-008…SC-011 are verified at system level.

## ID Schema

- **System Test Case**: `STP-{NNN}-{X}`
- **System Test Scenario**: `STS-{NNN}-{X}{#}`

## System Tests

### System Component Validation: SYS-001 (The system SHALL expose a single publish API at `/api/v1/notifications/publish` )

**Parent Requirements**: REQ-001

#### Test Case: STP-001-A (Interface Contract Testing for SYS-001)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-001 behavior for nominal and degraded operation paths.

- **System Scenario: STS-001-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-001-B (Fault Injection for SYS-001)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-001 behavior for nominal and degraded operation paths.

- **System Scenario: STS-001-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-002 (The publish API SHALL authenticate producer calls using the shared service-to-se)

**Parent Requirements**: REQ-002

#### Test Case: STP-002-A (Interface Contract Testing for SYS-002)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-002 behavior for nominal and degraded operation paths.

- **System Scenario: STS-002-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-002-B (Fault Injection for SYS-002)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-002 behavior for nominal and degraded operation paths.

- **System Scenario: STS-002-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-003 (The publish API SHALL return success only after durable acceptance that survives)

**Parent Requirements**: REQ-003

#### Test Case: STP-003-A (Interface Contract Testing for SYS-003)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-003 behavior for nominal and degraded operation paths.

- **System Scenario: STS-003-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-003-B (Fault Injection for SYS-003)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-003 behavior for nominal and degraded operation paths.

- **System Scenario: STS-003-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-004 (The service SHALL validate `RecipientDescriptor` (`user/group/global`) and requi)

**Parent Requirements**: REQ-004

#### Test Case: STP-004-A (Interface Contract Testing for SYS-004)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-004 behavior for nominal and degraded operation paths.

- **System Scenario: STS-004-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-004-B (Fault Injection for SYS-004)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-004 behavior for nominal and degraded operation paths.

- **System Scenario: STS-004-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-005 (The service SHALL route `recipient.kind=user` only to subscribers whose authenti)

**Parent Requirements**: REQ-005

#### Test Case: STP-005-A (Interface Contract Testing for SYS-005)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-005 behavior for nominal and degraded operation paths.

- **System Scenario: STS-005-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-005-B (Fault Injection for SYS-005)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-005 behavior for nominal and degraded operation paths.

- **System Scenario: STS-005-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-006 (The service SHALL route `recipient.kind=group` to all users in group membership )

**Parent Requirements**: REQ-006

#### Test Case: STP-006-A (Interface Contract Testing for SYS-006)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-006 behavior for nominal and degraded operation paths.

- **System Scenario: STS-006-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-006-B (Fault Injection for SYS-006)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-006 behavior for nominal and degraded operation paths.

- **System Scenario: STS-006-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-007 (The service SHALL route `recipient.kind=global` to all authenticated subscribers)

**Parent Requirements**: REQ-007

#### Test Case: STP-007-A (Interface Contract Testing for SYS-007)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-007 behavior for nominal and degraded operation paths.

- **System Scenario: STS-007-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-007-B (Fault Injection for SYS-007)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-007 behavior for nominal and degraded operation paths.

- **System Scenario: STS-007-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-008 (The service SHALL preserve FIFO ordering per recipient for user/group deliveries)

**Parent Requirements**: REQ-008

#### Test Case: STP-008-A (Interface Contract Testing for SYS-008)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-008 behavior for nominal and degraded operation paths.

- **System Scenario: STS-008-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-008-B (Fault Injection for SYS-008)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-008 behavior for nominal and degraded operation paths.

- **System Scenario: STS-008-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-009 (The service SHALL treat global ordering as best-effort and SHALL document global)

**Parent Requirements**: REQ-009

#### Test Case: STP-009-A (Interface Contract Testing for SYS-009)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-009 behavior for nominal and degraded operation paths.

- **System Scenario: STS-009-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-009-B (Fault Injection for SYS-009)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-009 behavior for nominal and degraded operation paths.

- **System Scenario: STS-009-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-010 (The service SHALL expose authenticated subscription capability under `/api/v1/no)

**Parent Requirements**: REQ-010

#### Test Case: STP-010-A (Interface Contract Testing for SYS-010)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-010 behavior for nominal and degraded operation paths.

- **System Scenario: STS-010-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-010-B (Fault Injection for SYS-010)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-010 behavior for nominal and degraded operation paths.

- **System Scenario: STS-010-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-011 (Clients SHALL dispatch by `messageType`; unknown keywords SHALL be logged and ig)

**Parent Requirements**: REQ-011

#### Test Case: STP-011-A (Interface Contract Testing for SYS-011)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-011 behavior for nominal and degraded operation paths.

- **System Scenario: STS-011-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-011-B (Fault Injection for SYS-011)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-011 behavior for nominal and degraded operation paths.

- **System Scenario: STS-011-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-012 (The service SHALL retain undelivered user/group messages for a configurable catc)

**Parent Requirements**: REQ-012

#### Test Case: STP-012-A (Interface Contract Testing for SYS-012)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-012 behavior for nominal and degraded operation paths.

- **System Scenario: STS-012-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-012-B (Fault Injection for SYS-012)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-012 behavior for nominal and degraded operation paths.

- **System Scenario: STS-012-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-013 (The service SHALL expose operational counters for producer publishes, delivered-)

**Parent Requirements**: REQ-013

#### Test Case: STP-013-A (Interface Contract Testing for SYS-013)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-013 behavior for nominal and degraded operation paths.

- **System Scenario: STS-013-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-013-B (Fault Injection for SYS-013)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-013 behavior for nominal and degraded operation paths.

- **System Scenario: STS-013-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-014 (The service SHALL emit a distinct global-broadcast counter separable from user/g)

**Parent Requirements**: REQ-014

#### Test Case: STP-014-A (Interface Contract Testing for SYS-014)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-014 behavior for nominal and degraded operation paths.

- **System Scenario: STS-014-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-014-B (Fault Injection for SYS-014)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-014 behavior for nominal and degraded operation paths.

- **System Scenario: STS-014-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-015 (Publish envelope schema validation SHALL occur before durable storage; malformed)

**Parent Requirements**: REQ-015

#### Test Case: STP-015-A (Interface Contract Testing for SYS-015)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-015 behavior for nominal and degraded operation paths.

- **System Scenario: STS-015-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-015-B (Fault Injection for SYS-015)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-015 behavior for nominal and degraded operation paths.

- **System Scenario: STS-015-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-016 (The platform SHALL maintain a version-controlled messageType registry with owner)

**Parent Requirements**: REQ-016

#### Test Case: STP-016-A (Interface Contract Testing for SYS-016)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-016 behavior for nominal and degraded operation paths.

- **System Scenario: STS-016-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-016-B (Fault Injection for SYS-016)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-016 behavior for nominal and degraded operation paths.

- **System Scenario: STS-016-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-017 (The service SHALL support per-environment registry enforcement mode that rejects)

**Parent Requirements**: REQ-017

#### Test Case: STP-017-A (Interface Contract Testing for SYS-017)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-017 behavior for nominal and degraded operation paths.

- **System Scenario: STS-017-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-017-B (Fault Injection for SYS-017)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-017 behavior for nominal and degraded operation paths.

- **System Scenario: STS-017-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-018 (The publish contract SHALL support optional producer idempotencyKey deduplicatio)

**Parent Requirements**: REQ-018

#### Test Case: STP-018-A (Interface Contract Testing for SYS-018)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-018 behavior for nominal and degraded operation paths.

- **System Scenario: STS-018-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-018-B (Fault Injection for SYS-018)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-018 behavior for nominal and degraded operation paths.

- **System Scenario: STS-018-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-019 (The platform SHALL enforce per-producer publish quotas and emit throttled-publis)

**Parent Requirements**: REQ-019

#### Test Case: STP-019-A (Interface Contract Testing for SYS-019)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-019 behavior for nominal and degraded operation paths.

- **System Scenario: STS-019-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-019-B (Fault Injection for SYS-019)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-019 behavior for nominal and degraded operation paths.

- **System Scenario: STS-019-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-020 (The service SHALL reject all unauthenticated subscribe/delivery attempts.)

**Parent Requirements**: REQ-020

#### Test Case: STP-020-A (Interface Contract Testing for SYS-020)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-020 behavior for nominal and degraded operation paths.

- **System Scenario: STS-020-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-020-B (Fault Injection for SYS-020)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-020 behavior for nominal and degraded operation paths.

- **System Scenario: STS-020-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-021 (The service SHALL block cross-user subscription attempts that do not match the a)

**Parent Requirements**: REQ-021

#### Test Case: STP-021-A (Interface Contract Testing for SYS-021)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-021 behavior for nominal and degraded operation paths.

- **System Scenario: STS-021-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-021-B (Fault Injection for SYS-021)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-021 behavior for nominal and degraded operation paths.

- **System Scenario: STS-021-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-022 (Publish processing SHALL treat payload as opaque JSON and SHALL NOT semantically)

**Parent Requirements**: REQ-022

#### Test Case: STP-022-A (Interface Contract Testing for SYS-022)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-022 behavior for nominal and degraded operation paths.

- **System Scenario: STS-022-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-022-B (Fault Injection for SYS-022)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-022 behavior for nominal and degraded operation paths.

- **System Scenario: STS-022-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-023 (Publish for unknown user or empty group recipients SHALL succeed with zero-deliv)

**Parent Requirements**: REQ-023

#### Test Case: STP-023-A (Interface Contract Testing for SYS-023)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-023 behavior for nominal and degraded operation paths.

- **System Scenario: STS-023-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-023-B (Fault Injection for SYS-023)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-023 behavior for nominal and degraded operation paths.

- **System Scenario: STS-023-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-024 (Publish API availability SHALL be at least 99.9% over the reporting window.)

**Parent Requirements**: REQ-024

#### Test Case: STP-024-A (Interface Contract Testing for SYS-024)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-024 behavior for nominal and degraded operation paths.

- **System Scenario: STS-024-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-024-B (Fault Injection for SYS-024)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-024 behavior for nominal and degraded operation paths.

- **System Scenario: STS-024-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-025 (Connected publish-to-delivery latency p95 SHALL be at most 2 seconds under nomin)

**Parent Requirements**: REQ-025

#### Test Case: STP-025-A (Interface Contract Testing for SYS-025)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-025 behavior for nominal and degraded operation paths.

- **System Scenario: STS-025-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-025-B (Fault Injection for SYS-025)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-025 behavior for nominal and degraded operation paths.

- **System Scenario: STS-025-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-026 (Every accepted publish and delivery event SHALL be observable via structured log)

**Parent Requirements**: REQ-026

#### Test Case: STP-026-A (Interface Contract Testing for SYS-026)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-026 behavior for nominal and degraded operation paths.

- **System Scenario: STS-026-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-026-B (Fault Injection for SYS-026)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-026 behavior for nominal and degraded operation paths.

- **System Scenario: STS-026-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-027 (Backpressure controls SHALL ensure a misbehaving producer does not increase unre)

**Parent Requirements**: REQ-027

#### Test Case: STP-027-A (Interface Contract Testing for SYS-027)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-027 behavior for nominal and degraded operation paths.

- **System Scenario: STS-027-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-027-B (Fault Injection for SYS-027)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-027 behavior for nominal and degraded operation paths.

- **System Scenario: STS-027-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-028 (The runtime target SHALL be Node.js 24.x in alignment with monorepo engine const)

**Parent Requirements**: REQ-028

#### Test Case: STP-028-A (Interface Contract Testing for SYS-028)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-028 behavior for nominal and degraded operation paths.

- **System Scenario: STS-028-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-028-B (Fault Injection for SYS-028)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-028 behavior for nominal and degraded operation paths.

- **System Scenario: STS-028-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-029 (Package naming for any notification-service packages SHALL follow `@kitchensink/)

**Parent Requirements**: REQ-029

#### Test Case: STP-029-A (Interface Contract Testing for SYS-029)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-029 behavior for nominal and degraded operation paths.

- **System Scenario: STS-029-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-029-B (Fault Injection for SYS-029)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-029 behavior for nominal and degraded operation paths.

- **System Scenario: STS-029-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-030 (At launch, at least five messageType registry entries SHALL exist spanning 003 p)

**Parent Requirements**: REQ-030

#### Test Case: STP-030-A (Interface Contract Testing for SYS-030)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-030 behavior for nominal and degraded operation paths.

- **System Scenario: STS-030-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-030-B (Fault Injection for SYS-030)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-030 behavior for nominal and degraded operation paths.

- **System Scenario: STS-030-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

### System Component Validation: SYS-031 (The feature SHALL explicitly close WA-004 by documenting notification-service ow)

**Parent Requirements**: REQ-031

#### Test Case: STP-031-A (Interface Contract Testing for SYS-031)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies SYS-031 behavior for nominal and degraded operation paths.

- **System Scenario: STS-031-A1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

#### Test Case: STP-031-B (Fault Injection for SYS-031)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies SYS-031 behavior for nominal and degraded operation paths.

- **System Scenario: STS-031-B1**
    - **Given** the system component is initialized with deterministic test data
    - **When** the component receives a representative request/event sequence
    - **Then** output contract and observable state transitions satisfy the expected requirement intent

---

## System Tests — dual ingress (added 2026-08-10)

These cover SYS-032…SYS-041. Unlike the blocks above they name concrete inputs and falsifiable assertions, because every rule here can be satisfied on one ingress path and missed on the other, and a scenario that would still pass in that state verifies nothing.

Shared fixture vocabulary: producer `recipe-service`, registry entry `eventSource = "kitchensink.recipe"` and `publishQuotaPerSecond = 10`; unregistered `source = "kitchensink.rogue"`; recipient `U1 = { kind: "user", id: "U1" }`; envelope `E1 = { schemaVersion: 1, recipient: U1, messageType: "recipe.import.completed", occurredAt: "2026-08-10T12:00:00.000Z", payload: { jobId: "job-7" }, idempotencyKey: "import:job-7:completed", producer: "recipe-service" }`; `RESERVED_DETAIL_TYPE = "kitchensink.notification.envelope.v1"`.

### System Component Validation: SYS-032 (The single validate → registry → authorize → dedupe → durably accept → route pip)

**Parent Requirements**: REQ-032

#### Test Case: STP-032-A (Interface Contract Testing for SYS-032)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Proves ingress equivalence by paired submission of one envelope and one violating envelope per rule over both adapters (SC-008).

- **System Scenario: STS-032-A1**
    - **Given** `E1`, a connected subscriber for `U1`, and one violating variant of `E1` per rule — `payload` omitted, `messageType` unregistered under enforcement, an 11th publish inside one second, `payload` one byte over `PAYLOAD_SIZE_LIMIT`, and `recipient.id` present on `kind = "global"`
    - **When** `E1` and each violating variant are submitted over `POST /api/v1/notifications/publish` and, separately, put on the notification bus under `RESERVED_DETAIL_TYPE`
    - **Then** the two delivered messages for `E1` are equal field for field except the service-assigned `id`, `sequence` and `publishedAt`, and each violating variant yields the same `reasonCode` on both paths — five paired assertions, each failing if either path's verdict differs

#### Test Case: STP-032-B (Fault Injection for SYS-032)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Injects the defect FR-024 names — a rule present in one adapter only — and requires STS-032-A1 to go red, since an equivalence test insensitive to divergence is theater.

- **System Scenario: STS-032-B1**
    - **Given** five mutant builds, each removing exactly one of the five rules from exactly one adapter by short-circuiting that adapter ahead of the core
    - **When** STS-032-A1 is executed against each mutant
    - **Then** every mutant fails STS-032-A1 on the paired assertion for the removed rule, and any mutant that passes marks STS-032-A1 as non-verifying and fails this case

### System Component Validation: SYS-033 (Consumes the reserved `detailType` from the notification bus, unwraps the envelo)

**Parent Requirements**: REQ-032, REQ-033

#### Test Case: STP-033-A (Interface Contract Testing for SYS-033)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies that the adapter ingests envelopes on the reserved `detailType` and that a producer's own domain event on the same bus is ignored rather than interpreted (FR-025).

- **System Scenario: STS-033-A1**
    - **Given** the notification bus carrying `E1` under `RESERVED_DETAIL_TYPE` and a `RecipeImportCompleted` domain event from the same producer under its own `detailType`, whose detail body names user `U1`
    - **When** both events are put on the bus and the adapter runs to completion
    - **Then** `E1` produces one `notification` row and one delivery to `U1`, the rule's `MatchedEvents` equals 1, and the domain event produces no row, no delivery and no DLQ record — ignored is neither delivered nor rejected

#### Test Case: STP-033-B (Fault Injection for SYS-033)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Injects a widened bus rule and an unreadable `detail`, checking that no recipient is ever inferred and that the ignore path reads nothing.

- **System Scenario: STS-033-B1**
    - **Given** a mutant stack whose rule pattern matches every `detailType`, and a `detail` wrapped in a proxy that throws on any property read
    - **When** the `RecipeImportCompleted` domain event is put on the bus against both the correct and the mutant stack
    - **Then** against the correct stack the proxy is never touched, proving the ignore path reads nothing; against the mutant the domain event becomes a DLQ record with `missing_required_field` and never a delivery, so no recipient is derived from a domain event under any configuration

### System Component Validation: SYS-034 (Enforces the FR-026 field set per ingress path — `schemaVersion`, `recipient`,)

**Parent Requirements**: REQ-034

#### Test Case: STP-034-A (Interface Contract Testing for SYS-034)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Walks the per-path required field set one omission at a time and asserts rejection rather than substitution.

- **System Scenario: STS-034-A1**
    - **Given** seven variants of `E1`, each omitting exactly one of `schemaVersion`, `recipient`, `messageType`, `occurredAt`, `payload`, `idempotencyKey` and `producer`
    - **When** each variant is submitted over both adapters
    - **Then** the five always-required omissions are rejected with `missing_required_field` naming that field on both paths, and the `idempotencyKey` and `producer` omissions are rejected on the EventBridge path while being accepted on HTTP — fourteen assertions, of which any collapsed pair fails the case

#### Test Case: STP-034-B (Fault Injection for SYS-034)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Attacks the "never defaulted" half of FR-026, which no rejection test can observe: a defaulted field produces a success, not an error.

- **System Scenario: STS-034-B1**
    - **Given** the service clock advanced to `2026-08-10T13:30:00.000Z` while `E1.occurredAt` stays `2026-08-10T12:00:00.000Z`, and a mutant build that stamps `occurredAt` on receipt when absent
    - **When** `E1` is accepted on both paths, and the `occurredAt`-omitted variant is submitted to the mutant build
    - **Then** the persisted `occurred_at` equals `2026-08-10T12:00:00.000Z` and never the receipt time, the accepted row carries no value for any omitted optional field, and the mutant build fails this case because it accepted an envelope that must have been rejected

### System Component Validation: SYS-035 (The two required controls on the credential-less path: the bus resource policy r)

**Parent Requirements**: REQ-035

#### Test Case: STP-035-A (Interface Contract Testing for SYS-035)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the second control alone — `source` allowlist validation — with the resource policy permitting the caller, so the allowlist is the only thing under test (SC-009).

- **System Scenario: STS-035-A1**
    - **Given** a principal permitted by the bus resource policy, a subscriber for `U1`, and two envelopes: `E1` put with `source = "kitchensink.recipe"`, and `E1` put with `source = "kitchensink.rogue"` while its `producer` field still claims `recipe-service`
    - **When** both are put on the bus under `RESERVED_DETAIL_TYPE`
    - **Then** the allowlisted put is delivered with `producer` recorded as `recipe-service` resolved from `source`, and the rogue put is dead-lettered with `source_not_allowlisted`, produces zero `notification` rows and zero deliveries to `U1`, and its self-declared `producer` field changes nothing

#### Test Case: STP-035-B (Fault Injection for SYS-035)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Verifies the first control alone and the fail-closed posture, establishing that neither control substitutes for the other.

- **System Scenario: STS-035-B1**
    - **Given** a principal absent from the bus resource policy, and separately a build whose allowlist source is stubbed to return an empty list and one whose registry read throws
    - **When** the unlisted principal calls `PutEvents`, and allowlisted traffic is submitted against each stubbed build
    - **Then** `PutEvents` fails `AccessDenied` with no bus event and no change to `MatchedEvents`, and both stubbed builds deny every event-path envelope — an empty or unreadable allowlist is deny-all, never allow-all, so removing either control leaves the path closed rather than open

### System Component Validation: SYS-036 (Routes every event-path rejection to the ingress DLQ with a reason code, increme)

**Parent Requirements**: REQ-036

#### Test Case: STP-036-A (Interface Contract Testing for SYS-036)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Produces each rejection reason in isolation and asserts one DLQ record, one labelled increment and an alarmed depth per reason.

- **System Scenario: STS-036-A1**
    - **Given** four event-path envelopes, one per reason code — `source_not_allowlisted`, `missing_required_field`, `unregistered_message_type` under enforcement, and `quota_exceeded` — and a DLQ at depth 0
    - **When** each is put on the bus in turn
    - **Then** each produces exactly one DLQ record whose `reasonCode` attribute equals its own code and whose body is the envelope verbatim, increments `ingress_rejected{reason}` for that reason only by 1, and after the fourth the DLQ depth is 4 with the depth-above-zero alarm in ALARM

#### Test Case: STP-036-B (Fault Injection for SYS-036)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Fails the DLQ dependency and injects a silently-dropping rejection, the failure mode FR-028 exists to prevent.

- **System Scenario: STS-036-B1**
    - **Given** SQS `SendMessage` failing for the ingress DLQ, and separately a mutant build that returns from a rejection without calling the dead-letter path
    - **When** a rejectable envelope is put on the bus against each
    - **Then** under the SQS failure the source event is not acknowledged and is redelivered until the write succeeds, so no rejection is lost; and the mutant build leaves DLQ depth at 0 with a flat counter, which fails this case because a dropped rejection is indistinguishable from a delivery

### System Component Validation: SYS-037 (Orders event-path arrivals by producer-assigned `occurredAt` with a deterministi)

**Parent Requirements**: REQ-037

#### Test Case: STP-037-A (Interface Contract Testing for SYS-037)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies per-recipient FIFO across both paths under adversarial arrival order, plus deterministic tiebreaking on equal `occurredAt`.

- **System Scenario: STS-037-A1**
    - **Given** 100 envelopes for `U1` with `occurredAt` monotonically increasing in publish order, 50 published over HTTP and 50 put on the bus in reverse `occurredAt` order, plus two extra envelopes sharing `occurredAt = "2026-08-10T12:00:00.000Z"` from producers `a-service` and `b-service`
    - **When** all are ingested and the subscriber for `U1` consumes its stream, repeated over 10 runs
    - **Then** the 100 deliveries arrive in `occurredAt` order with contiguous `sequence` values and zero inversions in every run, and the tied pair is delivered `a-service` before `b-service` in all 10 runs, since the tiebreaker is `(occurredAt, producer, idempotencyKey)`

#### Test Case: STP-037-B (Fault Injection for SYS-037)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Removes the sorter and removes the ordering key, checking that STS-037-A1 is sensitive to arrival order and that an unorderable envelope is never enqueued at a guessed position.

- **System Scenario: STS-037-B1**
    - **Given** a mutant build whose event-path sort is the identity function, and an event-path envelope whose `occurredAt` is absent and another whose `occurredAt` is `"2026-02-30T00:00:00Z"`
    - **When** the reversed 50-envelope half of STS-037-A1 is replayed against the mutant, and the two unorderable envelopes are put on the bus against the correct build
    - **Then** the mutant produces inversions and fails STS-037-A1, proving that scenario tests ordering rather than a pre-sorted fixture; and both unorderable envelopes are rejected with `ordering_key_missing` and appear at no position in the FIFO queue

### System Component Validation: SYS-038 (The rule that an `idempotencyKey` is derived from durable domain state, publishe)

**Parent Requirements**: REQ-038

#### Test Case: STP-038-A (Interface Contract Testing for SYS-038)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Replays a transport redelivery with an unchanged key and asserts exactly-once delivery (SC-011).

- **System Scenario: STS-038-A1**
    - **Given** `E1` with `idempotencyKey = "import:job-7:completed"` derived from the job identity plus its terminal status, and a subscriber for `U1`
    - **When** the same event is put on the bus twice — once as an exact re-put and once with a fresh EventBridge event `id` but the unchanged key
    - **Then** `U1` receives exactly one delivery, exactly one `notification` row exists for `("recipe-service", "import:job-7:completed")`, and the dedup-hit counter increments once per redelivery

#### Test Case: STP-038-B (Fault Injection for SYS-038)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Demonstrates that the forbidden derivations deduplicate nothing — the negative result is the point of FR-030 — and that a dedup-store outage does not admit a duplicate.

- **System Scenario: STS-038-B1**
    - **Given** two producer variants deriving `idempotencyKey` from the EventBridge event `id` and from `now()` respectively, and separately a dedup store that throws on read
    - **When** each variant publishes the same domain outcome twice, and `E1` is replayed while the dedup store is throwing and again after it recovers
    - **Then** both forbidden variants produce two distinct keys and two deliveries for one outcome, confirming they provide no deduplication; and the dedup-store outage yields `runtime_failure` with the event unacknowledged, after which `U1` has exactly one delivery — never two

### System Component Validation: SYS-039 (The absence of any batching, correlation or collapsing stage between accept and )

**Parent Requirements**: REQ-039

#### Test Case: STP-039-A (Interface Contract Testing for SYS-039)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies the observable form of the no-aggregation contract: N in, N out, nothing merged (SC-010).

- **System Scenario: STS-039-A1**
    - **Given** 25 envelopes for `U1`, each with `idempotencyKey = "probe-{i}"`, 13 published over HTTP and 12 over the bus, all inside 100 ms
    - **When** the subscriber for `U1` consumes its stream to completion
    - **Then** exactly 25 deliveries arrive, each carrying one distinct `notificationId`, one `sequence` and exactly one envelope's `payload`, and the per-producer publish counter equals the delivered counter at 25

#### Test Case: STP-039-B (Fault Injection for SYS-039)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Injects a collapsing stage and a delivery backlog, distinguishing an architectural regression from a transport delay.

- **System Scenario: STS-039-B1**
    - **Given** a mutant build inserting a 5-second digest stage that merges consecutive envelopes for one recipient, and separately the routing consumer stalled for 30 seconds with all 25 envelopes queued
    - **When** STS-039-A1 is executed against each
    - **Then** the mutant delivers fewer than 25 messages or one message carrying two payloads, and fails this case as an architectural regression; and the stalled build delivers all 25 unmerged after recovery, so a backlog is never treated as an aggregation trigger

### System Component Validation: SYS-040 (Verifies the producer token on the HTTP path against a configured public key wit)

**Parent Requirements**: REQ-040, REQ-002

#### Test Case: STP-040-A (Interface Contract Testing for SYS-040)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Verifies a valid Ed25519 service-principal token and proves verification is networkless by removing the network (FR-032).

- **System Scenario: STS-040-A1**
    - **Given** a token signed by the fixture Ed25519 private key with the platform issuer and `exp` in the future, the matching public key configured, and all outbound egress blocked with DNS resolution nulled and socket creation instrumented
    - **When** `E1` is published over `POST /api/v1/notifications/publish`
    - **Then** the publish is accepted with `producerIdentity` equal to the token's verified subject, and zero outbound sockets are opened during verification — an implementation fetching a JWKS document fails this case

#### Test Case: STP-040-B (Fault Injection for SYS-040)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Attacks the signature, the algorithm and the key dependency, requiring closed failure in every case.

- **System Scenario: STS-040-B1**
    - **Given** four bad credentials — a valid token with its final signature byte flipped, a token expired by one second, a token from an unknown issuer, and an `alg: none` token plus an HS256 token signed with the public key as its HMAC secret — and separately a deployment with the public key unset
    - **When** each is used to publish `E1`
    - **Then** every bad credential is rejected with `signature_invalid` before validation, dedup or any durable write, leaving zero `notification` rows; and with the key unset the service fails closed by rejecting every publish rather than accepting it unverified

### System Component Validation: SYS-041 (Reads each producer's publish quota from its registry entry, declared at registr)

**Parent Requirements**: REQ-041, REQ-019

#### Test Case: STP-041-A (Interface Contract Testing for SYS-041)

**Technique**: Interface Contract Testing
**Target View**: Interface View
**Description**: Proves the enforced limit is the value read from the producer's registry entry, not a global default or an inferred bound (FR-033).

- **System Scenario: STS-041-A1**
    - **Given** `recipe-service` declaring `publishQuotaPerSecond = 10` and a second producer `plan-service` declaring 3, both registered, with a traffic-history fixture implying a different rate for each
    - **When** each producer publishes 11 envelopes inside one second, and `recipe-service`'s entry is then edited to 3 and reloaded
    - **Then** `recipe-service` has 10 accepted and the 11th rejected `quota_exceeded` while `plan-service` has 3 accepted and the 4th rejected in the same run, the traffic history changes neither limit, and after the reload `recipe-service`'s 4th publish is rejected — so the effective limit tracks the declared value per producer

#### Test Case: STP-041-B (Fault Injection for SYS-041)

**Technique**: Fault Injection
**Target View**: Dependency View
**Description**: Removes the declaration and the registry, and injects a silent rejection — the failure FR-033's alarm requirement exists to prevent.

- **System Scenario: STS-041-B1**
    - **Given** a registered producer whose entry declares no quota, a registry read that throws, and a mutant build whose `quota_exceeded` path emits neither counter nor alarm
    - **When** each configuration receives a publish over both adapters
    - **Then** the undeclared producer and the unreadable registry both fail closed by rejecting rather than defaulting to unlimited, an event-path rejection leaves a DLQ record with `quota_exceeded`, and the mutant build fails this case because a quota rejection with no alarm-grade signal is a silently lost notification
