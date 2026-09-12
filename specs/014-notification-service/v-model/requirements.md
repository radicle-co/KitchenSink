# V-Model Requirements Specification: Notification Service

**Feature Branch**: `014-notification-service`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/014-notification-service/spec.md`, `specs/014-notification-service/README.md`, `specs/014-notification-service/product-spec/product-spec.md`, `specs/014-notification-service/research/codebase-analysis.md`

## Overview

Feature 014 defines a shared in-app notification routing service for KitchenSink producers and clients. This baseline converts product stories, FR/NFR clauses, clarifications, and success criteria into atomic `REQ-NNN` items suitable for full V-Model traceability.

**Amended 2026-08-10.** REQ-032…REQ-041 carry `spec.md` FR-024…FR-033 (dual ingress, event-path trust boundary, the minimum envelope, cross-path ordering, idempotency-key derivation, fan-in ownership, named producer auth, declared quotas) and the four new success criteria SC-008…SC-011. The 31-requirement baseline dated 2026-05-13 remains valid as far as it went; it did not cover the EventBridge path at all. This chain still owes coverage of the 2026-08-05 scope additions — see `review.md` → Outstanding.

## Requirements

### Functional Requirements

| ID      | Description                                                                                                                                                                        | Priority | Rationale                                                  | Verification Method | Source Traceability      |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------- | ------------------- | ------------------------ |
| REQ-001 | The system SHALL expose a single publish API at `/api/v1/notifications/publish` accepting `{ recipient, messageType, payload, occurredAt, idempotencyKey? }`.                      | P1       | Establishes one producer contract across all features.     | Test                | FR-001, US-001           |
| REQ-002 | The publish API SHALL authenticate producer calls using the shared service-to-service mechanism aligned with feature 002.                                                          | P1       | Prevents unauthorized producer writes.                     | Test                | FR-002, NFR-004          |
| REQ-003 | The publish API SHALL return success only after durable acceptance that survives single-instance restart.                                                                          | P1       | Prevents acknowledged-message loss.                        | Test                | FR-003, NFR-002          |
| REQ-004 | The service SHALL validate `RecipientDescriptor` (`user` \| `group` \| `global`) and required/forbidden `id` presence by kind.                                                     | P1       | Guarantees deterministic routing semantics.                | Test                | FR-004, US-001           |
| REQ-005 | The service SHALL route `recipient.kind=user` only to subscribers whose authenticated identity equals `recipient.id`.                                                              | P1       | Core privacy boundary for direct notifications.            | Test                | FR-005, US-001           |
| REQ-006 | The service SHALL route `recipient.kind=group` to all users in group membership resolved at delivery time.                                                                         | P1       | Enables shared-feature fanout with current membership.     | Test                | FR-006, FR-022, US-002   |
| REQ-007 | The service SHALL route `recipient.kind=global` to all authenticated subscribers currently in application scope.                                                                   | P1       | Supports operations broadcast capability.                  | Test                | FR-007, US-003           |
| REQ-008 | The service SHALL preserve FIFO ordering per recipient for user/group deliveries and SHALL NOT promise cross-recipient ordering.                                                   | P1       | Maintains correctness for stateful recipient flows.        | Test                | FR-008, Clarification Q2 |
| REQ-009 | The service SHALL treat global ordering as best-effort and SHALL document global broadcasts as non-FIFO.                                                                           | P1       | Avoids false consistency assumptions for global traffic.   | Inspection          | FR-009, US-003           |
| REQ-010 | The service SHALL expose authenticated subscription capability under `/api/v1/notifications/subscribe` (or transport-equivalent under `/api/v1/notifications/*`).                  | P1       | Defines receiver entry point.                              | Test                | FR-010, US-007           |
| REQ-011 | Clients SHALL dispatch by `messageType`; unknown keywords SHALL be logged and ignored without crash.                                                                               | P1       | Ensures forward compatibility across producer evolution.   | Demonstration       | FR-011, US-004           |
| REQ-012 | The service SHALL retain undelivered user/group messages for a configurable catch-up window of at least 24 hours.                                                                  | P1       | Supports reconnect reliability on mobile/web.              | Test                | FR-012, US-005           |
| REQ-013 | The service SHALL expose operational counters for producer publishes, delivered-by-recipient-kind, undelivered-after-retention, active subscribers, and per-messageType publishes. | P1       | Provides minimum production operability signals.           | Test                | FR-013, US-006           |
| REQ-014 | The service SHALL emit a distinct global-broadcast counter separable from user/group traffic.                                                                                      | P1       | Provides privileged-action observability.                  | Test                | FR-014, US-003, US-006   |
| REQ-015 | Publish envelope schema validation SHALL occur before durable storage; malformed envelopes SHALL return structured error responses.                                                | P2       | Prevents bad writes and integration drift.                 | Test                | FR-015, US-008           |
| REQ-016 | The platform SHALL maintain a version-controlled messageType registry with owner feature and description metadata.                                                                 | P2       | Prevents namespace collisions and enables discoverability. | Inspection          | FR-016, Clarification Q1 |
| REQ-017 | The service SHALL support per-environment registry enforcement mode that rejects unregistered messageType publishes.                                                               | P2       | Allows phased rollout from observe to enforce.             | Test                | FR-017, US-009           |
| REQ-018 | The publish contract SHALL support optional producer idempotencyKey deduplication within configured window (producer,key).                                                         | P3       | Reduces duplicate delivery from retries.                   | Test                | FR-018, US-010           |
| REQ-019 | The platform SHALL enforce per-producer publish quotas and emit throttled-publish counters on rejection.                                                                           | P3       | Protects shared infrastructure from noisy producers.       | Test                | FR-019, US-011           |
| REQ-020 | The service SHALL reject all unauthenticated subscribe/delivery attempts.                                                                                                          | P1       | Baseline access control.                                   | Test                | FR-020, US-007           |
| REQ-021 | The service SHALL block cross-user subscription attempts that do not match the authenticated identity.                                                                             | P1       | Prevents horizontal privilege abuse.                       | Test                | FR-021, US-007           |
| REQ-022 | Publish processing SHALL treat payload as opaque JSON and SHALL NOT semantically validate domain payload fields.                                                                   | P2       | Preserves producer ownership of message semantics.         | Inspection          | FR-023, Clarification Q4 |
| REQ-023 | Publish for unknown user or empty group recipients SHALL succeed with zero-delivery behavior and explicit undeliverable/zero-fanout counters.                                      | P2       | Prevents producer coupling to recipient existence checks.  | Test                | Edge Cases, US-002       |

#### Dual ingress (added 2026-08-10 — `spec.md` FR-024…FR-033)

`spec.md` gained ten functional requirements and four success criteria on 2026-08-10. They are converted here on the same 1:1 basis as REQ-001…REQ-023. Their ids continue after REQ-031, the last id issued to the non-functional block below, because `REQ-NNN` ids are never renumbered — so this functional table is numerically out of order with respect to the next section by design.

| ID      | Description                                                                                                                                                                                                                                                                                                            | Priority | Rationale                                                                                                              | Verification Method | Source Traceability          |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------------------- |
| REQ-032 | The service SHALL accept publishes over both the authenticated HTTP endpoint and an EventBridge subscription, and both SHALL execute the same validation, registry check, producer authorization, idempotency, durability and routing logic. A rule enforced in only one ingress adapter SHALL be treated as a defect. | P1       | One core with two adapters is the only shape in which the two paths cannot diverge.                                    | Test                | FR-024, SC-008, US-001       |
| REQ-033 | The EventBridge path SHALL ingest notification envelopes only, on a `detailType` reserved by this service, and SHALL NOT subscribe to producers' domain events.                                                                                                                                                        | P1       | A domain event carries no recipient; deriving one requires inspecting `payload` (forbidden, REQ-022).                  | Test                | FR-025, FR-023               |
| REQ-034 | Every envelope on either path SHALL carry `schemaVersion`, `recipient`, `messageType`, `occurredAt` and `payload`; `idempotencyKey` and `producer` SHALL additionally be required on the EventBridge path. An envelope missing a required field SHALL be rejected, never defaulted and never partially routed.         | P1       | Two ingress doors make the envelope a versioned wire contract; a defaulted field corrupts ordering or deduplication.   | Test                | FR-026, SC-011               |
| REQ-035 | The EventBridge path SHALL be bounded by both an EventBridge resource policy restricting which principals may put events on the notification bus and validation of the event's `source` against an allowlist of registered producers.                                                                                  | P1       | The path carries no credential; without both controls any principal with bus access can address any user.              | Test                | FR-027, SC-009, FR-005/20/21 |
| REQ-036 | An envelope rejected on the EventBridge path SHALL be dead-lettered and counted by reason, and DLQ depth SHALL be observable and alarmed.                                                                                                                                                                              | P1       | There is no caller to receive a structured error, so a dropped rejection is indistinguishable from a delivery.         | Test                | FR-028, SC-009               |
| REQ-037 | Envelopes arriving over EventBridge SHALL be ordered by the producer-assigned `occurredAt` with a deterministic tiebreaker before or as they are enqueued on the FIFO ingest queue.                                                                                                                                    | P1       | The FIFO queue preserves enqueue order, which equals publish order only on the HTTP path; REQ-008 otherwise misleads.  | Test                | FR-029, FR-008, SC-002       |
| REQ-038 | An `idempotencyKey` SHALL be derived from durable domain state so that it is stable across producer retries, and SHALL NOT be derived from a transport identifier or a clock.                                                                                                                                          | P1       | A key that changes on retry deduplicates nothing, and EventBridge delivery is at-least-once.                           | Test                | FR-030, FR-018, SC-011       |
| REQ-039 | The service SHALL NOT aggregate, batch, correlate or collapse envelopes; a publisher whose work fans out SHALL correlate its own fan-out and publish one envelope per user-meaningful outcome.                                                                                                                         | P1       | "User-meaningful outcome" is knowledge only the publisher holds, and correlating here would require reading `payload`. | Test                | FR-031, SC-010               |
| REQ-040 | Producer authentication on the HTTP path SHALL be the platform Ed25519 service-principal token, verified networklessly against a public key, performing no outbound network call per publish.                                                                                                                          | P1       | Resolves REQ-002's open mechanism; a per-publish third-party round trip is disqualified on the publish hot path.       | Test                | FR-032, FR-002, NFR-004      |
| REQ-041 | The per-producer publish quota SHALL be configurable per registered producer and declared by that producer at registration, SHALL NOT be inferred from a producer's internals, and a quota rejection SHALL be alarmed.                                                                                                 | P3       | An inferred bound drifts from the producer it describes, and a silent rejection is a lost notification.                | Test                | FR-033, FR-019               |

### Non-Functional Requirements

| ID      | Description                                                                                                                    | Priority | Rationale                                                | Verification Method | Source Traceability             |
| ------- | ------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------- | ------------------- | ------------------------------- |
| REQ-024 | Publish API availability SHALL be at least 99.9% over the reporting window.                                                    | P1       | Supports feature-wide dependency reliability.            | Analysis            | NFR-001                         |
| REQ-025 | Connected publish-to-delivery latency p95 SHALL be at most 2 seconds under nominal load.                                       | P1       | Timer and alert flows require low latency.               | Test                | NFR-003, research(timer alerts) |
| REQ-026 | Every accepted publish and delivery event SHALL be observable via structured logs and queryable counters within one minute.    | P1       | Needed for operational diagnosis and SLA validation.     | Test                | NFR-005, SC-004                 |
| REQ-027 | Backpressure controls SHALL ensure a misbehaving producer does not increase unrelated producer latency by more than 10%.       | P2       | Protects multi-producer fairness.                        | Analysis            | NFR-006, FR-019                 |
| REQ-028 | The runtime target SHALL be Node.js 24.x in alignment with monorepo engine constraints.                                        | P1       | Platform consistency and deployment parity.              | Inspection          | NFR-007, product-spec runtime   |
| REQ-029 | Package naming for any notification-service packages SHALL follow `@kitchensink/{group}-{name}`.                               | P2       | Maintains repository governance conventions.             | Inspection          | NFR-008                         |
| REQ-030 | At launch, at least five messageType registry entries SHALL exist spanning 003 plus reserved namespaces for 001/005/008/009.   | P2       | Ensures launch readiness of registry process.            | Demonstration       | SC-006                          |
| REQ-031 | The feature SHALL explicitly close WA-004 by documenting notification-service ownership in cross-feature consistency outcomes. | P1       | Portfolio-level ownership resolution is mandatory scope. | Inspection          | SC-007, README rationale        |

### Interface Requirements

| Interface Concern                                                      | Bound Requirements                                                              | Notes                                                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Publish contract (`/api/v1/notifications/publish`)                     | REQ-001, REQ-002, REQ-003, REQ-004, REQ-015, REQ-022, REQ-034, REQ-040          | Producer-facing envelope + auth + durability + schema behavior.                                         |
| Event ingress contract (reserved `detailType` on the notification bus) | REQ-032, REQ-033, REQ-034, REQ-035, REQ-036, REQ-037, REQ-038                   | Credential-less ingress; identity is the validated `source`, rejection is a dead-letter.                |
| Subscribe contract (`/api/v1/notifications/subscribe`)                 | REQ-010, REQ-020, REQ-021                                                       | Subscriber identity is auth-derived and cannot be spoofed.                                              |
| Delivery envelope contract                                             | REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-011, REQ-012, REQ-037, REQ-039 | Recipient match + ordering + reconnect semantics; one delivery per published envelope.                  |
| Registry and operations interfaces                                     | REQ-013, REQ-014, REQ-016, REQ-017, REQ-030, REQ-036, REQ-041                   | Counters and registry lifecycle controls; per-producer quota and `source` allowlist are registry state. |

### Constraint Requirements

| Constraint                             | Bound Requirements                          | Notes                                                                                                               |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Shared auth dependency (feature 002)   | REQ-002, REQ-010, REQ-020, REQ-021, REQ-040 | Notification service does not own auth primitives; the producer token scheme is the platform's, not this feature's. |
| Launch transport scope (in-app only)   | REQ-007, REQ-010, REQ-012                   | Email/mobile push deferred by product scope.                                                                        |
| Runtime/package governance             | REQ-028, REQ-029                            | Aligns with monorepo standards.                                                                                     |
| WA-004 ownership closure               | REQ-031                                     | Cross-feature ownership is mandatory deliverable.                                                                   |
| EventBridge does not preserve ordering | REQ-037, REQ-008                            | An external transport property, not a design choice; the ordering key is producer-assigned because of it.           |
| EventBridge delivery is at-least-once  | REQ-034, REQ-038                            | Why `idempotencyKey` is required on that path and why its derivation is constrained.                                |
| Correlation is publisher-owned         | REQ-039                                     | This service holds no knowledge of what constitutes one user-meaningful outcome.                                    |

## Source Coverage Index

### FR Coverage (FR-001…FR-033)

- FR-001…FR-023 fully mapped by REQ-001…REQ-023.
- FR-024…FR-033 fully mapped by REQ-032…REQ-041, in order.

### NFR Coverage (NFR-001…NFR-008)

- Fully mapped by REQ-024…REQ-029.

### User Story / Success Criteria Coverage

- User Stories US-001…US-011 mapped across REQ-001…REQ-023 and REQ-032…REQ-041.
- Success Criteria SC-001…SC-007 mapped by REQ-013, REQ-025, REQ-026, REQ-030, REQ-031.
- SC-008 → REQ-032. SC-009 → REQ-035 + REQ-036. SC-010 → REQ-039. SC-011 → REQ-034 + REQ-038.
- SC-001 was amended on 2026-08-10 to require both ingress paths and a synthetic reference producer owned by this feature, so it now also traces to REQ-032.

## Assumptions

- Transport mechanism selection for the **subscriber** side remains implementation-time (push/pull/webhook/hybrid), while contracts remain mechanism-agnostic. The **producer** side is no longer open: the two ingress paths are named by REQ-032.
- Group membership source-of-truth is the identity service, and this feature builds it there (`spec.md` A-002, resolved 2026-08-05); routing resolves membership against that API at delivery time. The earlier form of this assumption — that the source-of-truth remains external to 014 — was superseded on 2026-08-05 and is corrected here.
- Launch enforcement for registry may begin in observe mode before hard rejection mode. Observe mode does not weaken REQ-035: `source` allowlisting is a trust boundary, not a registry-enforcement mode, and is on from the first event-path publish.
- Producers are internal services holding a platform service-principal keypair or a bus-publish grant. No third-party principal is admitted to either path.

## Dependencies

- `002-user-auth` for producer and subscriber authentication/identity binding.
- The platform Ed25519 service-principal token scheme (`FOOD_SERVICE_PRINCIPAL_JWT_KEY`, minted and verified by `packages/shared/recipe-core`) for REQ-040.
- An EventBridge bus owned by this service, its resource policy, and a reserved `detailType`, for REQ-032/REQ-035.
- Downstream producer features `001/003/005/008/009` for messageType namespaces and launch traffic. REQ-032's ingress equivalence and SC-001 are proven against a synthetic reference producer owned by this feature, so neither waits on them.
- `specs/cross-feature-consistency-report.md` WA-004 as ownership closure target.

## Glossary

| Term                 | Definition                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PublishEnvelope      | Producer-submitted message contract carrying schemaVersion/recipient/messageType/payload/occurredAt, plus idempotencyKey and producer (required on the event path, optional on HTTP). Normative shape in REQ-034. |
| DeliveryEnvelope     | Service-emitted envelope delivered to subscribers.                                                                                                                                                                |
| RecipientDescriptor  | User/group/global routing descriptor.                                                                                                                                                                             |
| MessageType Registry | Version-controlled catalog of allowed messageType keywords, ownership metadata, per-producer quota (REQ-041) and allowlisted event `source` (REQ-035).                                                            |
| Catch-up Window      | Retention period for undelivered user/group messages during disconnects.                                                                                                                                          |
| Ingress adapter      | A transport-specific entry point (HTTP or EventBridge) holding no business logic. REQ-032.                                                                                                                        |
| Ingress core         | The single validate → registry → authorize → dedupe → durably accept → route pipeline both adapters call.                                                                                                         |
| Notification bus     | The EventBridge bus owned by this service, carrying envelopes on a reserved `detailType` and nothing else.                                                                                                        |

---

**Total Requirements**: 41
**By Priority**: P1: 29 | P2: 9 | P3: 3
**By Verification Method**: Test: 29 | Inspection: 7 | Analysis: 2 | Demonstration: 3
