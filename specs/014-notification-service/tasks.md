# Feature 014 — Notification Service — Task Breakdown

**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md) | **Branch**: `014-notification-service`

---

## User Story Reference

| US ID | Description | Priority |
|-------|-------------|----------|
| US-001 | Direct User Notification | P1 |
| US-002 | Group Recipient Routing | P1 |
| US-003 | Global Broadcast | P1 |
| US-004 | Client Dispatches by `messageType` | P1 |
| US-005 | Catch-Up After Disconnect | P1 |
| US-006 | Operational Counters | P1 |
| US-007 | Authenticated Subscription | P2 |
| US-008 | Envelope Schema Validation | P2 |
| US-009 | `messageType` Registry Enforcement | P2 |
| US-010 | Producer-Defined Idempotency Key | P3 |
| US-011 | Per-Feature Publish Quotas | P3 |

---

## Dependency Graph

> Updated 2026-08-05. Task ids are **not** contiguous: T-021…T-033 were appended by
> the sync-verify reconciliation and slot into the graph by dependency, not by number.

```text
Identity groups (Q-002 — prerequisite for group routing)
T-023 ──► T-024 ──► T-025 ──┐
                            │
Notification service        │
T-001 ──► T-002 ──► T-003 ──┼─► T-004 ──► T-005 ──► T-006
                     │      │      (T-005 also needs T-025)
                     ├─► T-007 ──► T-008 ──► T-012
                     ├─► T-009 ──► T-010
                     ├─► T-013 ──► T-014
                     ├─► T-015          (also needs T-009)
                     └─► T-031

T-026 ◄── T-001                         (SQS FIFO + global queue)
T-027 ◄── T-026 + T-009                 (per-recipient sequence authority)
T-011 ◄── T-003 + T-009
T-016 ◄── T-011 + T-014
T-032 ◄── T-011 + T-026

Client surface
T-028 ◄── T-010 + T-012
T-029 ◄── T-028                         (web bell)
T-030 ◄── T-028                         (mobile bell)

Producer integrations
T-017 ◄── T-003 + T-005 + T-007         (003 — the only producer that exists)
T-018 ◄── T-007 + T-009 + T-011         (005/008/009 — blocked, spec-only)
T-021 ◄── T-007 + T-009 + T-011         (012 — blocked, spec-only)
T-022 ◄── T-007 + T-009 + T-011         (013 — blocked, spec-only)
T-033 ◄── T-017 + T-018 + T-021 + T-022 (GR-011 ownership proof)

Verification
T-019 ◄── all implementation tasks above
T-020 ◄── T-019
```

**Critical path to a demonstrable end-to-end flow (003 only):**
`T-001 → T-002 → T-003 → T-026 → T-009 → T-027 → T-004 → T-010/T-012 → T-028 → T-029/T-030 → T-017`.
Group routing (`T-023…T-025`, `T-005`) and the four blocked producer integrations sit
off this path.

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

> **Q-002 resolved 2026-08-05 (owner):** groups are owned by the **identity service**
> and are **not** Clerk Organizations. 014 builds them. T-005 previously called a
> "002 group membership API" that does not exist (sync-report DRIFT-003); the tasks
> below build it first.

- [ ] **T-023** [P] [US-002] Add the `group` + `group_membership` Drizzle schema and migration to the identity service (identity DB, alongside users/accounts/profiles). — `packages/services/identity/src/database/schema/groups.schema.ts`
  - **Depends on**: —
  - **Implements**: FR-006, FR-022 (prerequisite); Q-002 resolution
  - **Acceptance**: Migration applies and rolls back cleanly against a scratch DB; `group_membership` enforces uniqueness on `(group_id, user_id)` and cascades on group delete.

- [ ] **T-024** [P] [US-002] Implement the identity-service groups DAO + service: create group, add/remove member, list members, list a user's groups. — `packages/services/identity/src/groups/groups.service.ts`
  - **Depends on**: T-023
  - **Implements**: FR-006, FR-022 (prerequisite)
  - **Acceptance**: Unit + integration tests cover membership add/remove/list, non-existent group, and empty group; group membership is the single source of truth (no duplicate model in 014).

- [ ] **T-025** [P] [US-002] Expose `/api/v1/groups/*` on the identity service behind the existing Clerk `AuthMiddleware`, with authorization scoped to the authenticated identity. — `packages/services/identity/src/groups/groups.controller.ts`
  - **Depends on**: T-024
  - **Implements**: FR-006, GR-002 (URL prefix)
  - **Acceptance**: Unauthenticated → 401; a caller cannot read or mutate membership of a group they are not a member of; e2e covers create → add member → list.

- [ ] **T-005** [P] [US-002] Implement group-addressed routing in the notification consumer: resolve members at **delivery time** via the identity groups API, then fan out per member. — `packages/services/notification-service/src/routing/group-router.service.ts`
  - **Depends on**: T-003, T-004, T-025
  - **Implements**: US-002, FR-006, FR-022
  - **Acceptance**: Unit test: group G with members {U,V} delivers to both; non-member W excluded. Membership change between publish and delivery is honoured (removed member does not receive). Identity unavailable → message remains on the queue and retries; it is **not** dropped and **not** failed back to the producer.

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

- [ ] **T-026** [P] [US-001..US-005] Provision the SQS **FIFO** ingest/routing queue with `MessageGroupId = recipient.id`, plus a standard queue for `global`, in CDK. — `packages/services/notification-service/infra/lib/notification-queues.ts`
  - **Depends on**: T-001
  - **Implements**: FR-008, FR-009 (transport substrate)
  - **Acceptance**: Synth produces a FIFO queue with content-based dedup **off** (FR-018 owns dedup, see T-015) and a DLQ; `global` routes to the standard queue.

- [ ] **T-027** [P] [US-005] Implement the routing consumer's per-recipient `sequence` assignment: on dequeue, assign a monotonic `sequence` per `recipient.id` and persist it in the same transaction as the notification row. — `packages/services/notification-service/src/routing/sequencer.service.ts`
  - **Depends on**: T-026, T-009
  - **Implements**: FR-008, SC-002
  - **Acceptance**: 100 messages to one recipient carry gap-free ascending `sequence`; concurrent consumers never assign a duplicate `sequence` for the same recipient (proven under contention, not just single-threaded); `global` messages carry no `sequence`.

- [ ] **T-009** [P] [US-005] Implement the durable message store and 24h retention (Drizzle ORM + PostgreSQL) per plan.md → Data Model: `notification`, `delivery`, `publish_idempotency` tables with the `(recipient_kind, recipient_id, sequence)` replay index. — `packages/services/notification-service/src/persistence/message.store.ts`
  - **Depends on**: T-004, T-005
  - **Implements**: FR-012, FR-003, US-005
  - **Acceptance**: 2 messages published while offline replay in T1-before-T2 order; message >24h is not replayed; a row expiring undelivered increments the undelivered-after-retention counter **before** deletion (else FR-013 can never be emitted).

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

- [ ] **T-015** [P] [US-010] Implement idempotency deduplication against the `publish_idempotency` table: `(producerFeature, idempotencyKey)` collapses to one delivery per recipient inside a **configurable** window. — `packages/services/notification-service/src/publish/idempotency.service.ts`
  - **Depends on**: T-003, T-009
  - **Implements**: FR-018, US-010
  - **Acceptance**: Duplicate publish within window delivers once; after window delivers twice; the window is configurable and a value **greater than 5 minutes** is proven to work — SQS FIFO's own dedup window is fixed at 5 min and cannot implement FR-018 (plan.md → Ordering & Partitioning, consequence 2).

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
  - **⚠️ Blocked**: 005, 008 and 009 are specification-only — no code exists to integrate (plan.md → "Which of these actually exist in code").

- [ ] **T-021** [P] [US-001] Integrate 012 producer contract: publish creator moderation / action-result notifications through 014. — `packages/services/notification-service/src/integration/feature-012.adapter.ts`
  - **Depends on**: T-007, T-009, T-011
  - **Implements**: FR-001, cross-feature contract (012)
  - **Acceptance**: 012 moderation outcome emits event → 014 publishes → creator's client receives.
  - **⚠️ Blocked**: 012 is specification-only. Added 2026-08-05 — plan.md named 012 mandatory for M8 with no task (sync-report DRIFT-004).

- [ ] **T-022** [P] [US-001, US-002] Integrate 013 producer contract: publish/enroll milestone notifications to learners and creators through 014. — `packages/services/notification-service/src/integration/feature-013.adapter.ts`
  - **Depends on**: T-007, T-009, T-011
  - **Implements**: FR-001, cross-feature contract (013)
  - **Acceptance**: 013 publish and enroll milestones emit events → 014 publishes → learner/creator clients receive.
  - **⚠️ Blocked**: 013 is specification-only. Added 2026-08-05 (sync-report DRIFT-004).

## Client Surface — In-App Notification Bell

> Added 2026-08-05. Both apps already ship an inert notifications control in the home
> chrome; no artifact referenced it and no task wired it (sync-report DRIFT-007).
> Cross-platform rule: web and mobile ship in the same release.

- [ ] **T-028** [P] [US-004] Implement the shared client notification store: subscribe + replay ingestion, order/dedupe by `(recipient, sequence)`, gap detection with re-pull, unread count derivation. — `packages/apps/commise/features/notifications/src/store.ts`
  - **Depends on**: T-010, T-012
  - **Implements**: FR-011, US-004, US-005
  - **Acceptance**: Unit tests cover ordered arrival, out-of-order arrival, duplicate delivery, sequence gap → re-pull, and unknown `messageType` (logged, ignored, no crash).

- [ ] **T-029** [P] [US-004] Wire the **web** notification bell: unread count badge on the existing `HomeTopBar` control and the feed surface it opens. — `packages/apps/commise/web/src/components/home/chrome/HomeTopBar.tsx`
  - **Depends on**: T-028
  - **Implements**: US-004, Epic 4
  - **Acceptance**: Vitest component tests cover **every** state — zero unread (no badge), unread count, loading, error, and disconnected. Playwright covers the happy path: receive → badge appears → open feed → dispatch to context. Count is real; the "no fabricated number" invariant in the existing source comment must survive.

- [ ] **T-030** [P] [US-004] Wire the **mobile** notification bell: same count + feed surface on the mobile `HomeTopBar`. — `packages/apps/commise/mobile/src/components/home/chrome/HomeTopBar.tsx`
  - **Depends on**: T-028
  - **Implements**: US-004, Epic 4
  - **Acceptance**: `.native.test.tsx` covers the same five states as T-029; a Maestro flow covers receive → badge → open feed. Localized strings only — no hard-coded copy.

## Rollout Controls

> Added 2026-08-05. Three plan.md commitments had no task (sync-report DRIFT-008).

- [ ] **T-031** [P] [ALL] Add per-producer environment flags gating progressive producer enablement (plan.md Rollout Phase C). — `packages/services/notification-service/src/config/producer-flags.ts`
  - **Depends on**: T-003
  - **Implements**: plan.md Rollout Phase C
  - **Acceptance**: A disabled producer's publish is rejected with a structured, distinguishable error and counted; flags are per-environment.

- [ ] **T-032** [P] [US-006] Implement counter-based canary checks: publish volume, delivery success, undelivered-after-retention, active subscribers — with alarms on publish 5xx rate, FIFO consumer age, in-flight cap approach. — `packages/services/notification-service/infra/lib/notification-alarms.ts`
  - **Depends on**: T-011, T-026
  - **Implements**: plan.md Rollout controls, NFR-005, NFR budgets
  - **Acceptance**: Alarms synth in CDK and fire against synthetic breach; FIFO consumer age is alarmed (it is the ordering path's liveness signal).

- [ ] **T-033** [P] [ALL] Prove GR-011 ownership: remove producer-local delivery implementations from every integrated producer feature and route them through 014. — producer feature packages
  - **Depends on**: T-017, T-018, T-021, T-022
  - **Implements**: GR-011, plan.md Exit Evidence
  - **Acceptance**: No integrated producer retains its own delivery path; the governance claim in `review.md` is backed by a diff, not an assertion.
  - **⚠️ Scope note**: only 003 has an implementation to migrate today.

## Verification & Exit

- [ ] **T-019** [P] [ALL] Write the full test set for routing, ordering, delivery, replay, counters, auth, validation, registry, idempotency, quotas, and the identity groups API. — `packages/services/notification-service/tests/`, `packages/services/identity/tests/`
  - **Depends on**: all implementation tasks
  - **Implements**: All FR items, US-001..US-011
  - **Acceptance**: Per the repo testing policy, **every** tier this feature touches: unit **and** integration for services/DALs/domain logic; e2e **and** k6 for the deployable HTTP surfaces; vitest component tests for every UI state and Playwright (web) + Maestro (mobile) for every happy path — the client tasks T-029/T-030 carry their own. Tests are written **before** the code they cover (TDD red→green). `npm test` passes; >80% branch coverage on `packages/services/notification-service`.
  - **Ordering proof (SC-002)**: 100 messages to one recipient arrive in publish order across 10 runs, including a run where the subscriber disconnects and reconnects mid-stream — the live/replay boundary is the case FIFO is most likely to break.

- [ ] **T-020** [P] [ALL] Regenerate `verify-report.md` and `v-model/release-audit-report.md` with execution evidence; confirm 0 CRITICAL / 0 WARNING. — `specs/014-notification-service/verify-report.md`
  - **Depends on**: T-019
  - **Implements**: M8 exit gate
  - **Acceptance**: `verify-report.md` **regenerated, not edited** — the 2026-05-12 report measured a task graph that never existed (sync-report DRIFT-005) and is marked superseded. Release-audit ingests real results for all mapped scenarios (186 as of 2026-05-13, plus the scenarios the reconciliation added). Constitution v1.3.0 Release Readiness Gate: all Test Case IDs mapped ✅, all scenarios executed or waived, `waivers.md` present ✅.
  - **Prerequisite**: the `v-model/` chain must first be regenerated to cover the scope added on 2026-08-05 (identity groups, ordering/sequence, client bell) — its 31 `REQ-NNN` rows predate all of it. See `review.md` → Outstanding.
