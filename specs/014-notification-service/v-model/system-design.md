# System Design: Notification Service

**Feature Branch**: `014-notification-service`
**Created**: 2026-05-10
**Status**: Draft
**Source**: `specs/014-notification-service/v-model/requirements.md`

## Overview

The system decomposition maps all 41 requirements to independently testable service components, keeping producer ingress, recipient routing, subscriber delivery, observability, and governance concerns explicit. This feature is non-regulated (`domain: ''`), so design uses general software reliability and privacy controls.

**Amended 2026-08-10.** SYS-032…SYS-041 decompose REQ-032…REQ-041. The structural change is that producer ingress is no longer one component: SYS-001 (HTTP) and SYS-033 (EventBridge) are **adapters** over SYS-032, the ingress **core**. Everything that was previously described as a step of the publish API is now a step of the core, reached identically from either adapter. An implementer reading only the 2026-05-13 decomposition would build the rules into the HTTP controller, which is precisely the defect REQ-032 names.

## ID Schema

- **System Component**: `SYS-NNN` — sequential identifier, never renumbered.
- **Parent Requirements**: comma-separated `REQ-NNN` list per component (many-to-many).
- Example: `SYS-013` maps to `REQ-013, REQ-026` for counters and observability latency.

## Design Constraints (from FROZEN-PENDING-RESOLUTION markers)

| Constraint ID | Affected Scope | Constraint Summary                                                                                    |
| ------------- | -------------- | ----------------------------------------------------------------------------------------------------- |
| None          | N/A            | No `FROZEN-PENDING-RESOLUTION` markers are declared in feature 014 source artifacts as of 2026-05-10. |

## Decomposition View (IEEE 1016 §5.1)

| SYS ID  | Name                                          | Description                                                                                                                                                                                                            | Parent Requirements | Type    |
| ------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------- |
| SYS-001 | Publish API Contract Gateway                  | The system SHALL expose a single publish API at `/api/v1/notifications/publish` accepting `{ recipient, messageType, payload, occurredAt, idempotencyKey? }`.                                                          | REQ-001             | Service |
| SYS-002 | Producer Auth Verifier                        | The publish API SHALL authenticate producer calls using the shared service-to-service mechanism aligned with feature 002.                                                                                              | REQ-002             | Service |
| SYS-003 | Durable Publish Commit Manager                | The publish API SHALL return success only after durable acceptance that survives single-instance restart.                                                                                                              | REQ-003             | Service |
| SYS-004 | Recipient Descriptor Validator                | The service SHALL validate `RecipientDescriptor` (`user` \| `group` \| `global`) and required/forbidden `id` presence by kind.                                                                                         | REQ-004             | Service |
| SYS-005 | User Recipient Router                         | The service SHALL route `recipient.kind=user` only to subscribers whose authenticated identity equals `recipient.id`.                                                                                                  | REQ-005             | Service |
| SYS-006 | Group Recipient Router                        | The service SHALL route `recipient.kind=group` to all users in group membership resolved at delivery time.                                                                                                             | REQ-006             | Service |
| SYS-007 | Global Broadcast Router                       | The service SHALL route `recipient.kind=global` to all authenticated subscribers currently in application scope.                                                                                                       | REQ-007             | Service |
| SYS-008 | Per-Recipient FIFO Sequencer                  | The service SHALL preserve FIFO ordering per recipient for user/group deliveries and SHALL NOT promise cross-recipient ordering.                                                                                       | REQ-008             | Service |
| SYS-009 | Global Ordering Policy Guard                  | The service SHALL treat global ordering as best-effort and SHALL document global broadcasts as non-FIFO.                                                                                                               | REQ-009             | Service |
| SYS-010 | Subscription API Gateway                      | The service SHALL expose authenticated subscription capability under `/api/v1/notifications/subscribe` (or transport-equivalent under `/api/v1/notifications/*`).                                                      | REQ-010             | Service |
| SYS-011 | Client Dispatch Compatibility Contract        | Clients SHALL dispatch by `messageType`; unknown keywords SHALL be logged and ignored without crash.                                                                                                                   | REQ-011             | Module  |
| SYS-012 | Offline Catch-Up Retention Service            | The service SHALL retain undelivered user/group messages for a configurable catch-up window of at least 24 hours.                                                                                                      | REQ-012             | Service |
| SYS-013 | Operational Counters Aggregator               | The service SHALL expose operational counters for producer publishes, delivered-by-recipient-kind, undelivered-after-retention, active subscribers, and per-messageType publishes.                                     | REQ-013             | Service |
| SYS-014 | Global Broadcast Counter Channel              | The service SHALL emit a distinct global-broadcast counter separable from user/group traffic.                                                                                                                          | REQ-014             | Service |
| SYS-015 | Envelope Schema Validation Pipeline           | Publish envelope schema validation SHALL occur before durable storage; malformed envelopes SHALL return structured error responses.                                                                                    | REQ-015             | Service |
| SYS-016 | MessageType Registry Store                    | The platform SHALL maintain a version-controlled messageType registry with owner feature and description metadata.                                                                                                     | REQ-016             | Service |
| SYS-017 | Registry Enforcement Switch                   | The service SHALL support per-environment registry enforcement mode that rejects unregistered messageType publishes.                                                                                                   | REQ-017             | Service |
| SYS-018 | Idempotency Dedup Engine                      | The publish contract SHALL support optional producer idempotencyKey deduplication within configured window (producer,key).                                                                                             | REQ-018             | Service |
| SYS-019 | Per-Producer Quota Enforcer                   | The platform SHALL enforce per-producer publish quotas and emit throttled-publish counters on rejection.                                                                                                               | REQ-019             | Service |
| SYS-020 | Unauthenticated Access Rejector               | The service SHALL reject all unauthenticated subscribe/delivery attempts.                                                                                                                                              | REQ-020             | Service |
| SYS-021 | Cross-User Subscription Guard                 | The service SHALL block cross-user subscription attempts that do not match the authenticated identity.                                                                                                                 | REQ-021             | Service |
| SYS-022 | Opaque Payload Preservation Layer             | Publish processing SHALL treat payload as opaque JSON and SHALL NOT semantically validate domain payload fields.                                                                                                       | REQ-022             | Service |
| SYS-023 | Unknown Recipient / Empty Group Counter Path  | Publish for unknown user or empty group recipients SHALL succeed with zero-delivery behavior and explicit undeliverable/zero-fanout counters.                                                                          | REQ-023             | Service |
| SYS-024 | Publish Availability SLO Monitor              | Publish API availability SHALL be at least 99.9% over the reporting window.                                                                                                                                            | REQ-024             | Service |
| SYS-025 | Delivery Latency SLO Evaluator                | Connected publish-to-delivery latency p95 SHALL be at most 2 seconds under nominal load.                                                                                                                               | REQ-025             | Service |
| SYS-026 | Structured Logging and Counter Query Pipeline | Every accepted publish and delivery event SHALL be observable via structured logs and queryable counters within one minute.                                                                                            | REQ-026             | Service |
| SYS-027 | Producer Fairness Backpressure Controller     | Backpressure controls SHALL ensure a misbehaving producer does not increase unrelated producer latency by more than 10%.                                                                                               | REQ-027             | Service |
| SYS-028 | Node Runtime Conformance Gate                 | The runtime target SHALL be Node.js 24.x in alignment with monorepo engine constraints.                                                                                                                                | REQ-028             | Utility |
| SYS-029 | Package Naming Governance Check               | Package naming for any notification-service packages SHALL follow `@kitchensink/{group}-{name}`.                                                                                                                       | REQ-029             | Utility |
| SYS-030 | Launch Registry Coverage Readiness Gate       | At launch, at least five messageType registry entries SHALL exist spanning 003 plus reserved namespaces for 001/005/008/009.                                                                                           | REQ-030             | Module  |
| SYS-031 | WA-004 Ownership Evidence Publisher           | The feature SHALL explicitly close WA-004 by documenting notification-service ownership in cross-feature consistency outcomes.                                                                                         | REQ-031             | Utility |
| SYS-032 | Ingress Core Pipeline                         | The single validate → registry → authorize → dedupe → durably accept → route pipeline. Both ingress adapters call it and neither reimplements any step of it.                                                          | REQ-032             | Service |
| SYS-033 | EventBridge Ingress Adapter                   | Consumes the reserved `detailType` from the notification bus, unwraps the envelope, and calls SYS-032. Holds transport concerns only; ignores every other `detailType` on the bus.                                     | REQ-032, REQ-033    | Service |
| SYS-034 | Minimum Envelope Contract Validator           | Enforces the FR-026 field set per ingress path — `schemaVersion`, `recipient`, `messageType`, `occurredAt`, `payload` always; `idempotencyKey` and `producer` additionally on the event path. Rejects; never defaults. | REQ-034             | Service |
| SYS-035 | Event-Path Trust Boundary                     | The two required controls on the credential-less path: the bus resource policy restricting `PutEvents` principals, and `source` allowlist validation against registered producers.                                     | REQ-035             | Service |
| SYS-036 | Event-Path Rejection Dead-Letter Path         | Routes every event-path rejection to the ingress DLQ with a reason code, increments a counter per reason, and exposes DLQ depth for alarming.                                                                          | REQ-036             | Service |
| SYS-037 | Cross-Path Ordering Resolver                  | Orders event-path arrivals by producer-assigned `occurredAt` with a deterministic tiebreaker before or as they are enqueued on the FIFO ingest queue.                                                                  | REQ-037             | Service |
| SYS-038 | Idempotency Key Derivation Contract           | The rule that an `idempotencyKey` is derived from durable domain state, published to producers and asserted by replay; not a runtime component that generates keys.                                                    | REQ-038             | Module  |
| SYS-039 | No-Aggregation Guarantee                      | The absence of any batching, correlation or collapsing stage between accept and delivery. Verified by counting deliveries against publishes, and by the absence of such a stage.                                       | REQ-039             | Module  |
| SYS-040 | Ed25519 Service-Principal Verifier            | Verifies the producer token on the HTTP path against a configured public key with no outbound network call. Replaces SYS-002's undecided "mechanism aligned with 002".                                                 | REQ-040, REQ-002    | Service |
| SYS-041 | Declared Producer Quota Configuration         | Reads each producer's publish quota from its registry entry, declared at registration, and alarms every quota rejection.                                                                                               | REQ-041, REQ-019    | Service |

> **SYS-002 and SYS-040.** SYS-002 remains the producer-authentication component; SYS-040 is the concrete verifier it is now required to be (REQ-040). SYS-002 is not deleted, because REQ-002 still exists and the two ingress paths authorize differently — SYS-040 on HTTP, SYS-035 on the bus.
>
> **`producer` (envelope field) versus `source` (event attribute) — design decision, owner ruling owed.** REQ-034 requires a `producer` field on the event path "because that path has no bearer token", while REQ-035 makes the validated `source` the trust boundary. Those are two claims about the same fact and `spec.md` does not say which is authoritative. This decomposition resolves it the only safe way: **`producerIdentity` is always the registry `producer` mapped from the allowlisted `source`; the envelope's own `producer` field is persisted for the record and is never trusted for authorization or quota.** The alternative — trusting the field — lets an allowlisted principal attribute a publish to another producer and inherit that producer's quota, which is HAZ-035 with extra steps. Recorded in `review.md` → Open Questions; `spec.md` FR-026 should be amended to say the field is record-only.

## Dependency View (IEEE 1016 §5.2)

| Source  | Target  | Relationship | Failure Impact                                                                                               |
| ------- | ------- | ------------ | ------------------------------------------------------------------------------------------------------------ |
| SYS-001 | SYS-002 | Calls        | Unauthorized producers could publish if auth path fails open.                                                |
| SYS-001 | SYS-003 | Calls        | Publish success could be returned without durable safety.                                                    |
| SYS-001 | SYS-015 | Calls        | Malformed envelopes could contaminate durable queue.                                                         |
| SYS-001 | SYS-018 | Calls        | Duplicate retries inflate delivery volume.                                                                   |
| SYS-001 | SYS-019 | Calls        | Noisy producer can starve shared channel.                                                                    |
| SYS-005 | SYS-008 | Calls        | User-target ordering would become non-deterministic.                                                         |
| SYS-006 | SYS-008 | Calls        | Group fanout ordering could drift across reconnect.                                                          |
| SYS-006 | SYS-023 | Calls        | Empty groups not visible in counters.                                                                        |
| SYS-007 | SYS-014 | Calls        | Global operational actions lose auditability.                                                                |
| SYS-010 | SYS-020 | Calls        | Unauthenticated subscription paths may remain reachable.                                                     |
| SYS-010 | SYS-021 | Calls        | Cross-user leakage possible if identity mismatch checks fail.                                                |
| SYS-010 | SYS-012 | Reads        | Reconnect backlog not delivered.                                                                             |
| SYS-011 | SYS-022 | Uses         | Unknown messageType can crash clients instead of tolerant behavior.                                          |
| SYS-013 | SYS-026 | Writes       | Counter integrity and queryability decay.                                                                    |
| SYS-016 | SYS-017 | Uses         | Registry observe/enforce progression breaks.                                                                 |
| SYS-017 | SYS-001 | Controls     | Enforcement mode not applied at publish boundary.                                                            |
| SYS-024 | SYS-026 | Reads        | Availability SLO cannot be proven.                                                                           |
| SYS-025 | SYS-026 | Reads        | Latency breach detection unavailable.                                                                        |
| SYS-027 | SYS-019 | Controls     | Fairness objective cannot be enforced.                                                                       |
| SYS-030 | SYS-016 | Reads        | Launch readiness for messageType coverage is unverifiable.                                                   |
| SYS-031 | SYS-030 | Reads        | WA-004 closure evidence cannot be published confidently.                                                     |
| SYS-001 | SYS-032 | Calls        | The HTTP adapter would hold its own copy of the rules, and the two paths would diverge.                      |
| SYS-033 | SYS-032 | Calls        | Same, from the event side — and this is the direction in which a missed rule is silent (no caller to error). |
| SYS-032 | SYS-034 | Calls        | A defaulted or absent required field is durably accepted and corrupts ordering or deduplication.             |
| SYS-033 | SYS-035 | Calls        | The event path becomes an unauthenticated publish channel able to address any user.                          |
| SYS-035 | SYS-016 | Reads        | The `source` allowlist has no source of truth, so it cannot be validated.                                    |
| SYS-033 | SYS-036 | Calls        | A rejection on the credential-less path is dropped and indistinguishable from a delivery.                    |
| SYS-036 | SYS-013 | Writes       | DLQ depth and per-reason rejection counts are unobservable, so nothing can alarm.                            |
| SYS-033 | SYS-037 | Calls        | The FIFO queue preserves arrival order and REQ-008 becomes silently untrue for event-path producers.         |
| SYS-037 | SYS-008 | Feeds        | Sequence assignment records an order that is not publish order.                                              |
| SYS-032 | SYS-018 | Calls        | An at-least-once redelivery duplicates a user-visible notification.                                          |
| SYS-018 | SYS-038 | Uses         | Deduplication is attempted against keys that change on retry, so it never matches.                           |
| SYS-001 | SYS-040 | Calls        | Producer identity on the HTTP path is unverified, or verified via a network round trip on the hot path.      |
| SYS-019 | SYS-041 | Reads        | The quota is inferred rather than declared, and drifts from the producer it bounds.                          |
| SYS-041 | SYS-013 | Writes       | A quota rejection is silent, which is a lost notification with no operator signal.                           |

### Dependency Diagram

```text
Producer(HTTP)        -> SYS-001 -> SYS-040 -> SYS-032
Producer(EventBridge) -> SYS-033 -> SYS-035 -> SYS-032
SYS-032 -> {SYS-034,SYS-015,SYS-016/017,SYS-019/041,SYS-018/038,SYS-003} -> SYS-037 -> SYS-008
SYS-033 -> SYS-036 -> SYS-013                      (rejections: DLQ + per-reason counters)
Subscriber -> SYS-010 -> {SYS-020,SYS-021,SYS-012} -> {SYS-005,SYS-006,SYS-007}
Routing -> SYS-008 -> Delivery                     (SYS-039: no aggregation stage exists here)
Observability -> SYS-013 -> SYS-026 -> {SYS-024,SYS-025,SYS-027,SYS-030,SYS-031}
Registry -> SYS-016 -> SYS-017 -> SYS-032
```

## Interface View (IEEE 1016 §5.3)

### External Interfaces

| Interface                                                   | Producer/Consumer                                | Components                                                                                                 | Contract                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/notifications/publish`                        | Producer services (001/003/005/008/009)          | SYS-001, SYS-002, SYS-040, SYS-032, SYS-034, SYS-003, SYS-015, SYS-016, SYS-017, SYS-018, SYS-019, SYS-041 | PublishEnvelope ingress with token auth, validation, durability, dedup, quota, registry policy.                                                       |
| Notification bus, reserved `detailType`                     | Producer services publishing envelopes as events | SYS-033, SYS-035, SYS-032, SYS-034, SYS-036, SYS-037                                                       | Same envelope, same core, no credential: identity is the validated `source` plus the bus resource policy; rejection is a dead-letter, not a response. |
| `/api/v1/notifications/subscribe` (or transport-equivalent) | Authenticated web/mobile clients                 | SYS-010, SYS-020, SYS-021, SYS-012                                                                         | Identity-bound subscription and reconnect catch-up.                                                                                                   |
| Operator counters endpoint/query plane                      | Ops engineer                                     | SYS-013, SYS-014, SYS-023, SYS-024, SYS-025, SYS-026, SYS-027, SYS-030, SYS-031                            | Counter, SLO, readiness, ownership evidence reporting.                                                                                                |

### Internal Interfaces

| Interface                     | Components                                  | Contract Summary                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Recipient routing contract    | SYS-004, SYS-005, SYS-006, SYS-007, SYS-008 | Normalized recipient descriptor -> recipient-scoped sequence/delivery stream.                                                                                                                                               |
| Registry enforcement contract | SYS-016, SYS-017, SYS-032                   | messageType lookup + enforcement mode -> allow/reject + counter side effects.                                                                                                                                               |
| Catch-up retention contract   | SYS-012, SYS-010                            | Retained undelivered backlog keyed by authenticated subscriber identity.                                                                                                                                                    |
| Payload opacity contract      | SYS-022 with SYS-032/SYS-015                | Envelope fields validated while payload remains opaque passthrough JSON.                                                                                                                                                    |
| Adapter → core contract       | SYS-001 and SYS-033 into SYS-032            | Transport-neutral `(envelope, producerIdentity, ingressKind)` -> accepted-or-rejected. `ingressKind` selects the rejection channel (response vs dead-letter) and the two extra required fields, never a different rule set. |
| Registry → trust contract     | SYS-016 with SYS-035, SYS-041               | A producer's registry entry carries its allowlisted event `source` and its declared quota; both are read, never inferred.                                                                                                   |
| Ordering key contract         | SYS-037 with SYS-008                        | `(occurredAt, producer, idempotencyKey)` -> enqueue order for one `MessageGroupId`.                                                                                                                                         |

## Data Design View (IEEE 1016 §5.4)

| Data Entity              | Owned By                | Key Fields                                                                           | Lifecycle                                                                                     |
| ------------------------ | ----------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| PublishEnvelope          | SYS-032/SYS-034         | schemaVersion, recipient, messageType, payload, occurredAt, idempotencyKey, producer | Ingested over either adapter, validated against the per-path required set, durably committed. |
| ProducerRegistryEntry    | SYS-016/SYS-035/SYS-041 | producer, allowlisted event `source`, declared quota, owned messageTypes             | Version-controlled; read at authorize and quota time.                                         |
| DeadLetterRecord         | SYS-036                 | envelope-as-received, reasonCode, ingressKind, receivedAt                            | Written on every event-path rejection; the only artefact a credential-less rejection leaves.  |
| DeliveryEnvelope         | SYS-005/006/007/008     | id, messageType, payload, occurredAt, publishedAt                                    | Routed, sequenced, delivered/retried/expired.                                                 |
| MessageTypeRegistryEntry | SYS-016/017/030         | messageType, ownerFeature, description, registeredAt, enforcementState               | Versioned configuration and runtime policy input.                                             |
| CounterRecord            | SYS-013/014/023/026     | metricName, labels, value, timestamp                                                 | Aggregated and queryable within one minute.                                                   |
| SubscriberSession        | SYS-010/020/021         | subscriberId, authSubject, connectionState                                           | Authenticated session boundary for routing.                                                   |

## Coverage Summary

| Metric                  | Value        |
| ----------------------- | ------------ |
| Total Requirements      | 41           |
| Total System Components | 41           |
| REQ → SYS Coverage      | 41/41 (100%) |

### REQ → SYS Coverage Index (verifies 100%)

- REQ-001 → SYS-001
- REQ-002 → SYS-002
- REQ-003 → SYS-003
- REQ-004 → SYS-004
- REQ-005 → SYS-005
- REQ-006 → SYS-006
- REQ-007 → SYS-007
- REQ-008 → SYS-008
- REQ-009 → SYS-009
- REQ-010 → SYS-010
- REQ-011 → SYS-011
- REQ-012 → SYS-012
- REQ-013 → SYS-013
- REQ-014 → SYS-014
- REQ-015 → SYS-015
- REQ-016 → SYS-016
- REQ-017 → SYS-017
- REQ-018 → SYS-018
- REQ-019 → SYS-019
- REQ-020 → SYS-020
- REQ-021 → SYS-021
- REQ-022 → SYS-022
- REQ-023 → SYS-023
- REQ-024 → SYS-024
- REQ-025 → SYS-025
- REQ-026 → SYS-026
- REQ-027 → SYS-027
- REQ-028 → SYS-028
- REQ-029 → SYS-029
- REQ-030 → SYS-030
- REQ-031 → SYS-031
- REQ-032 → SYS-032, SYS-033
- REQ-033 → SYS-033
- REQ-034 → SYS-034
- REQ-035 → SYS-035
- REQ-036 → SYS-036
- REQ-037 → SYS-037
- REQ-038 → SYS-038
- REQ-039 → SYS-039
- REQ-040 → SYS-040
- REQ-041 → SYS-041

## Derived Requirements

- None. System decomposition remains within the 41 requirement baseline.

## Glossary

| Term               | Definition                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| SYS-NNN            | System component identifier in this design layer.                                                                                        |
| Recipient scope    | User/group/global routing domain for a publish event.                                                                                    |
| Catch-up retention | Offline window for undelivered user/group messages.                                                                                      |
| Ingress adapter    | Transport-specific entry point (SYS-001 HTTP, SYS-033 EventBridge) holding no business logic.                                            |
| Ingress core       | SYS-032 — the one pipeline both adapters call.                                                                                           |
| `ingressKind`      | The adapter's identity, passed to the core. Selects the rejection channel and the two extra required fields; never a different rule set. |
| Reason code        | The classification written to the DLQ on an event-path rejection, and the label on its counter.                                          |
