# Feature 014 — Notification Service — Task Breakdown

**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md) | **Branch**: `014-notification-service`

---

## User Story Reference

| US ID  | Description                        | Priority |
| ------ | ---------------------------------- | -------- |
| US-001 | Direct User Notification           | P1       |
| US-002 | Group Recipient Routing            | P1       |
| US-003 | Global Broadcast                   | P1       |
| US-004 | Client Dispatches by `messageType` | P1       |
| US-005 | Catch-Up After Disconnect          | P1       |
| US-006 | Operational Counters               | P1       |
| US-007 | Authenticated Subscription         | P2       |
| US-008 | Envelope Schema Validation         | P2       |
| US-009 | `messageType` Registry Enforcement | P2       |
| US-010 | Producer-Defined Idempotency Key   | P3       |
| US-011 | Per-Feature Publish Quotas         | P3       |

---

## Dependency Graph

```text
T-001 ──► T-002 ──► T-003 ──► T-004 ──► T-005 ──► T-006
                          │
                          └─► T-007 ──► T-008 ──► T-012
                          │
                          └─► T-009 ──► T-010
                          │
                          └─► T-013 ──► T-014
                          │
                          └─► T-015
                          │
                          └─► T-016

T-011 ◄── T-003 + T-009
T-017 ◄── T-003 + T-005 + T-007
T-018 ◄── T-007 + T-009 + T-011
T-019 ◄── T-001..T-018
T-020 ◄── T-019
```

---

## US-001 — Direct User Notification

- [ ] **T-001** [P] [US-001] Scaffold NestJS package `packages/services/notification-service` with module, controller, service stubs, and root tsconfig entry. — `packages/services/notification-service/src/notification.module.ts`
    - **Depends on**: —
    - **Implements**: FR-001, FR-004
    - **Acceptance**: Package compiles; `npm run build` passes for the package.

- [ ] **T-002** [P] [US-001] Define shared envelope types (`NotificationEnvelope`, `RecipientDescriptor`, `RecipientKind`) in `@kitchensink/notification-types`. — `packages/shared/notification-types/src/envelope.types.ts`
    - **Depends on**: T-001
    - **Implements**: FR-001, FR-004
    - **Acceptance**: Types imported cleanly by `notification-service` tests.

- [ ] **T-003** [P] [US-001] Implement `POST /api/v1/notifications/publish` with producer authentication (service-to-service aligned with 002). — `packages/services/notification-service/src/publish/publish.controller.ts`
    - **Depends on**: T-001, T-002
    - **Implements**: FR-002, US-001
    - **Acceptance**: Authenticated call returns 202; unauthenticated returns 401.

- [ ] **T-004** [P] [US-001] Implement user-addressed routing: persist envelope and resolve to active subscribers for `kind: "user"`. — `packages/services/notification-service/src/routing/user-router.service.ts`
    - **Depends on**: T-003
    - **Implements**: US-001, FR-005
    - **Acceptance**: Unit test: message to user U is routed only to U's subscriber records.

## US-002 — Group Recipient Routing

- [ ] **T-005** [P] [US-002] Implement group-addressed routing: expand group members at delivery time via 002 group membership API. — `packages/services/notification-service/src/routing/group-router.service.ts`
    - **Depends on**: T-003, T-004
    - **Implements**: US-002, FR-006
    - **Acceptance**: Unit test: group G with members {U,V} delivers to both; non-member W excluded.

- [ ] **T-006** [P] [US-002] Handle empty-group edge case: publish succeeds, zero deliveries, counters increment. — `packages/services/notification-service/src/routing/group-router.service.ts`
    - **Depends on**: T-005
    - **Implements**: US-002 edge case
    - **Acceptance**: Publish to empty group returns 202; no delivery attempts; `delivered_count` stays 0.

## US-003 — Global Broadcast

- [ ] **T-007** [P] [US-003] Implement global broadcast routing: deliver to all authenticated subscriber connections. — `packages/services/notification-service/src/routing/global-router.service.ts`
    - **Depends on**: T-003
    - **Implements**: US-003, FR-007
    - **Acceptance**: Unit test: 3 subscribers across 2 users all receive global message; order not asserted.

## US-004 — Client Dispatches by `messageType`

- [ ] **T-008** [P] [US-004] Implement client dispatch contract: deliver envelope with `messageType` to subscriber transport; unknown types logged/ignored. — `packages/services/notification-service/src/delivery/delivery.service.ts`
    - **Depends on**: T-007
    - **Implements**: FR-011, US-004
    - **Acceptance**: E2E: known type reaches client; unknown type produces structured log, client continues.

## US-005 — Catch-Up After Disconnect

- [ ] **T-009** [P] [US-005] Implement durable message store with per-recipient FIFO ordering and 24h retention (Drizzle ORM + PostgreSQL). — `packages/services/notification-service/src/persistence/message.store.ts`
    - **Depends on**: T-004, T-005
    - **Implements**: FR-012, FR-003, US-005
    - **Acceptance**: 2 messages published while offline replay in T1-before-T2 order; message >24h is not replayed.

- [ ] **T-010** [P] [US-005] Implement `GET /api/v1/notifications/replay` endpoint for reconnect catch-up scoped to authenticated user. — `packages/services/notification-service/src/replay/replay.controller.ts`
    - **Depends on**: T-009
    - **Implements**: FR-012, US-005
    - **Acceptance**: Replay returns only undelivered messages for auth user within retention window.

## US-006 — Operational Counters

- [ ] **T-011** [P] [US-006] Implement operational counters: publish rate per producer, delivered count, undelivered-after-retention count, active subscriber gauge. — `packages/services/notification-service/src/metrics/metrics.service.ts`
    - **Depends on**: T-003, T-009
    - **Implements**: FR-013, FR-014, US-006
    - **Acceptance**: Integration test: counters move by expected deltas after mixed publish/subscribe/retention events.

## US-007 — Authenticated Subscription

- [ ] **T-012** [P] [US-007] Implement `GET /api/v1/notifications/subscribe` (SSE/WebSocket) with 002 auth boundary; reject cross-user subscription. — `packages/services/notification-service/src/subscribe/subscribe.controller.ts`
    - **Depends on**: T-008, T-010
    - **Implements**: FR-010, FR-020, FR-021, US-007
    - **Acceptance**: Unauthenticated rejected (401); auth as U subscribing to V rejected (403); auth as U receives U's messages.

## US-008 — Envelope Schema Validation

- [ ] **T-013** [P] [US-008] Add envelope schema validation (class-validator): reject missing `recipient`, `messageType`, malformed `recipient.kind`, missing `occurredAt` before durable storage. — `packages/services/notification-service/src/publish/publish-validation.pipe.ts`
    - **Depends on**: T-003
    - **Implements**: FR-015, US-008
    - **Acceptance**: 10 malformed envelopes all rejected with structured errors; none stored.

## US-009 — `messageType` Registry Enforcement

- [ ] **T-014** [P] [US-009] Implement version-controlled `messageType` registry (JSON config) and enforcement toggle; tolerated mode counts unregistered, enforced mode rejects. — `packages/services/notification-service/src/registry/message-type.registry.ts`
    - **Depends on**: T-013
    - **Implements**: FR-016, FR-017, US-009
    - **Acceptance**: Registered type succeeds; unregistered in tolerated mode succeeds with counter; enforced mode rejects.

## US-010 — Producer-Defined Idempotency Key

- [ ] **T-015** [P] [US-010] Implement idempotency deduplication: `(producerFeature, idempotencyKey)` collapses to one delivery per recipient inside a configurable window. — `packages/services/notification-service/src/publish/idempotency.service.ts`
    - **Depends on**: T-003, T-009
    - **Implements**: FR-018, US-010
    - **Acceptance**: Duplicate publish within window delivers once; after window delivers twice.

## US-011 — Per-Feature Publish Quotas

- [ ] **T-016** [P] [US-011] Implement per-feature publish quota/rate-limit with structured rejection and throttled-publish counter. — `packages/services/notification-service/src/publish/quota.guard.ts`
    - **Depends on**: T-011, T-014
    - **Implements**: FR-019, US-011
    - **Acceptance**: Excess publishes rejected (429); counter reflects throttled count.

## Integration & Cross-Feature

- [ ] **T-017** [P] [US-001..US-006] Publish a **producer integration guide** in this feature's docs: the envelope contract, the two ingress paths, the registration steps (messageType keywords, `source` allowlisting, declared quota), and the correlation obligation of FR-031. — `specs/014-notification-service/README.md`
    - **Depends on**: T-021, T-022, T-024, T-026
    - **Implements**: FR-024..FR-033
    - **Acceptance**: a producer feature can integrate from this document alone, without reading this service's source. This service ships NO per-producer adapter and NO code that names another feature's domain — that is the property the guide exists to preserve.
    - **Note**: per-feature integration work (translators, event names, recipient resolution) belongs to each producer's own task list, not here.

## Dual ingress, event-path trust, and fan-in (added 2026-08-10)

- [ ] **T-021** [P] [US-001] EventBridge ingress adapter delegating to the SAME core as the HTTP controller (validate → registry → authz → idempotency → durable accept → route). Adapters carry transport concerns only. — `packages/services/notification-service/src/ingress/eventbridge.consumer.ts`
    - **Depends on**: T-003, T-013
    - **Implements**: FR-024, FR-025
    - **Acceptance**: the same envelope published over HTTP and over EventBridge produces byte-identical delivered messages, asserted by a paired test per validation rule (SC-008). Ingests only the reserved `detailType`; a producer domain event on the bus is ignored, not interpreted.

- [ ] **T-022** [P] [US-007] Notification bus + reserved `detailType`, with an EventBridge **resource policy** restricting which principals may put events, AND `source` allowlist validation of registered producers. — `packages/services/notification-service/infra/lib/notification-bus.ts`
    - **Depends on**: T-021
    - **Implements**: FR-027
    - **Acceptance**: an envelope whose `source` is not allowlisted is rejected and dead-lettered, never delivered (SC-009). **Security-critical**: without both controls the event path is an unauthenticated channel that can address any user, defeating FR-005/FR-020/FR-021.

- [ ] **T-023** [P] [US-006] Dead-letter queue + alarm for every event-path rejection (malformed, unregistered under enforcement, quota-exceeded, failed authz), with a counter per reason. — `packages/services/notification-service/infra/lib/notification-bus.ts`
    - **Depends on**: T-021, T-022
    - **Implements**: FR-028, FR-033
    - **Acceptance**: each rejection reason lands in the DLQ and increments its counter; DLQ depth is alarmed. A rejection that is merely dropped is indistinguishable from a delivery, so a silent drop fails this task.

- [ ] **T-024** [P] [US-008] Extend envelope validation to the FR-026 minimum: `schemaVersion`, `producer` and `idempotencyKey` required on the EventBridge path; `occurredAt` required and producer-assigned on both. — `packages/shared/notification-types/src/envelope.types.ts`
    - **Depends on**: T-002, T-013
    - **Implements**: FR-026, FR-030
    - **Acceptance**: each required field, omitted individually, is rejected on both paths — never defaulted, never partially routed. An `idempotencyKey` derived from a transport id or a clock is rejected by review, not by code; document the derivation rule beside the type.

- [ ] **T-025** [P] [US-005] Define per-recipient FIFO over the producer-assigned `occurredAt` with a deterministic tiebreaker, since EventBridge does not preserve arrival order. — `packages/services/notification-service/src/routing/ordering.ts`
    - **Depends on**: T-009, T-021
    - **Implements**: FR-008, FR-029
    - **Acceptance**: 100 envelopes for one recipient, delivered across BOTH ingress paths and arriving out of order, are delivered in `occurredAt` order (SC-002 extended to the event path).

- [ ] **T-026** [P] [US-001] Replace T-003's "aligned with 002" producer auth with the concrete mechanism: Ed25519 service-principal token verified **networklessly** against a public key (the scheme deployed as `FOOD_SERVICE_PRINCIPAL_JWT_KEY`). — `packages/services/notification-service/src/auth/producer.guard.ts`
    - **Depends on**: T-003
    - **Implements**: FR-002, FR-032
    - **Acceptance**: verification performs no outbound network call. Explicitly NOT Clerk machine tokens — 003 FR-042 records those need a networked Clerk Backend API call with the secret key, which at the FR-031 fan-out bound is up to 100 third-party round trips behind one user action.

- [ ] **T-027** [P] [US-011] Size the per-producer quota at or above each registered producer's documented fan-out bound, and alarm rejections. — `packages/services/notification-service/src/quota/quota.service.ts`
    - **Depends on**: T-016, T-023
    - **Implements**: FR-033
    - **Acceptance**: a burst at 003's documented bound (100 names/request, FR-045) is accepted in full; a quota rejection alarms rather than silently dropping a user's notification.

- [ ] **T-028** [P] [US-001] **Synthetic reference producer** — a test-only publisher owned by this feature, exercising both ingress paths and the full envelope, so 014 is provable end-to-end without any consumer feature existing. — `packages/services/notification-service/tests/support/reference-producer.ts`
    - **Depends on**: T-021, T-024
    - **Implements**: FR-024, FR-026, SC-001
    - **Acceptance**: satisfies SC-001 over HTTP **and** EventBridge with no dependency on 003, 004 or any other feature. It also publishes N envelopes for one recipient to prove this service never merges them (SC-010).
    - **Note**: a real producer's fan-in translator is NOT a task here — correlation is publisher-owned (FR-031), so it belongs in that feature's task list. 004's is tracked as `specs/004-recipe-importing/tasks.md` T-032.

- [ ] **T-018** [P] [US-001..US-006] Register the launch `messageType` keyword namespaces and `source` allowlist entries as **configuration**, one entry per producer that has declared itself. — `packages/services/notification-service/src/registry/message-type.registry.ts`
    - **Depends on**: T-014, T-022, T-027
    - **Implements**: FR-016, FR-027, FR-033
    - **Acceptance**: adding a producer is a config change plus that producer's own declaration — no code change here. Registry entries are DATA; this service still contains no per-producer adapter and no code naming another feature's domain.

## Verification & Exit

- [ ] **T-019** [P] [ALL] Write unit + integration tests for routing, delivery, replay, counters, auth, validation, registry, idempotency, quotas. — `packages/services/notification-service/tests/`
    - **Depends on**: T-001..T-018
    - **Implements**: All FR items, US-001..US-011
    - **Acceptance**: `npm test` passes with >80% branch coverage for `packages/services/notification-service`.

- [ ] **T-020** [P] [ALL] Update `verify-report.md` and `v-model/release-audit-report.md` with execution evidence; confirm 0 CRITICAL / 0 WARNING. — `specs/014-notification-service/verify-report.md`
    - **Depends on**: T-019
    - **Implements**: M8 exit gate
    - **Acceptance**: `verify-report.md` updated; governance closure signed off.
