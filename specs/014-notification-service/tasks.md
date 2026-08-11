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

- [ ] **T-017** [P] [US-001..US-006] Integrate 003 producer contract: publish `food.backfill.completed` and `food.fetch.failed` through 014. — `packages/services/notification-service/src/integration/feature-003.adapter.ts`
    - **Depends on**: T-003, T-005, T-007
    - **Implements**: FR-001, cross-feature contract (003)
    - **Acceptance**: 003 backfill completion triggers 014 publish; 014 delivers to subscribed user.

- [ ] **T-018** [P] [US-001..US-006] Integrate 005, 008, 009 producer contracts: publish AI disclosure, timer alert, compliance-gap events through 014. — `packages/services/notification-service/src/integration/feature-005-008-009.adapter.ts`
    - **Depends on**: T-007, T-009, T-011
    - **Implements**: FR-001, cross-feature contracts (005/008/009)
    - **Acceptance**: End-to-end trace: each producer feature emits event → 014 publishes → client receives.

## Verification & Exit

- [ ] **T-019** [P] [ALL] Write unit + integration tests for routing, delivery, replay, counters, auth, validation, registry, idempotency, quotas. — `packages/services/notification-service/tests/`
    - **Depends on**: T-001..T-018
    - **Implements**: All FR items, US-001..US-011
    - **Acceptance**: `npm test` passes with >80% branch coverage for `packages/services/notification-service`.

- [ ] **T-020** [P] [ALL] Update `verify-report.md` and `v-model/release-audit-report.md` with execution evidence; confirm 0 CRITICAL / 0 WARNING. — `specs/014-notification-service/verify-report.md`
    - **Depends on**: T-019
    - **Implements**: M8 exit gate
    - **Acceptance**: `verify-report.md` updated; governance closure signed off.
