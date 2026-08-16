# Feature 014 — Notification Service — Task Breakdown

**Spec**: [`spec.md`](./spec.md) | **Plan**: [`plan.md`](./plan.md) | **Branch**: `014-notification-service`

---

## User Story Reference

| US ID  | Description                         | Priority |
| ------ | ----------------------------------- | -------- |
| US-001 | Direct User Notification            | P1       |
| US-002 | Group Recipient Routing             | P1       |
| US-003 | Global Broadcast                    | P1       |
| US-004 | Client Dispatches by `messageType`  | P1       |
| US-005 | Catch-Up After Disconnect           | P1       |
| US-006 | Operational Counters                | P1       |
| US-007 | Authenticated Subscription          | P2       |
| US-008 | Envelope Schema Validation          | P2       |
| US-009 | `messageType` Registry Enforcement  | P2       |
| US-010 | Producer-Defined Idempotency Key    | P3       |
| US-011 | Per-Feature Publish Quotas          | P3       |
| US-012 | Client Acknowledges Consumption     | **P1**   |
| US-013 | Identical Pending Payloads Collapse | **P1**   |

> US-012 and US-013 were added to `spec.md` on 2026-08-12 on the owner's retention/dedup directive, both at
> **P1**. They are not enhancements to US-001: without an ack the service cannot tell "delivered" from
> "consumed". Reasoning:
> [ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md).

---

## Dependency Graph

> Updated 2026-08-12. Task ids are **not** contiguous in meaning: T-021…T-033 were appended by the sync-verify
> reconciliation, T-034…T-048 by the 2026-08-10 dual-ingress amendment, and **T-049…T-076 by the 2026-08-12
> retention / dedup / store / contract amendment**. They slot into the graph by dependency, not by number. Total:
> **76 tasks**, of which one (T-048) is done.

```text
Identity groups (Q-002 — prerequisite for group routing)
T-023 ──► T-024 ──► T-025 ──┐
                            │
Notification service        │
T-001 ──► T-002 ──► T-003 ──┼─► T-004 ──► T-005 ──► T-006
                     │      │      (T-005 also needs T-025)
                     ├─► T-007 ──► T-008 ──► T-012
                     ├─► T-053 ──► T-010     (T-009 SUPERSEDED — see T-053/T-054/T-057)
                     ├─► T-013 ──► T-014
                     ├─► T-015          (also needs T-054)
                     └─► T-031

T-026 ◄── T-001                         (SQS FIFO + global queue)
T-027 ◄── T-026 + T-053 + T-054         (per-recipient-USER sequence, assigned atomically)
T-011 ◄── T-003 + T-053
T-016 ◄── T-011 + T-014 + T-066
T-032 ◄── T-011 + T-026

Client surface
T-028 ◄── T-010 + T-012
T-029 ◄── T-028                         (web bell)
T-030 ◄── T-028                         (mobile bell)

Producer integrations
T-017 ◄── T-003 + T-005 + T-007         (003 — the only producer that exists)
T-018 ◄── T-007 + T-053 + T-011         (005/008/009 — blocked, spec-only)
T-021 ◄── T-007 + T-053 + T-011         (012 — blocked, spec-only)
T-022 ◄── T-007 + T-053 + T-011         (013 — blocked, spec-only)
T-033 ◄── T-017 + T-018 + T-021 + T-022 (GR-011 ownership proof)

Retained-notification store (added 2026-08-12 — FR-040)
T-049 ──► T-051 ──► T-053 ──► T-054      (durability answer gates provisioning)
T-050 ◄── T-067                          (size bounds are numbers in the zod)
T-052 ◄── T-051                          (per-PR key reclamation in CI teardown)

US-012 — ack and the 72h clock
T-055 ──► T-056 ──► T-072                (ack zod ► ack endpoint ► the ONE shared client command)
T-057 ◄── T-053 + T-011                  (expiry sweep; counter BEFORE release)
T-058 ◄── T-053 + T-012                  (redelivery + poison alarm)

US-013 — payload dedup
T-059 ──► T-060                          (RFC 8785 canonicalizer ► number-representability rejection)
T-061 ◄── T-054 + T-059                  (payload-identity claim, pending-scoped)
T-062 ◄── T-015 + T-054                  (the idempotency claim SURVIVES an ack)

Producer identity, rejection path, quota (rulings 2026-08-12)
T-063 ──► T-064                          (registry file + boot injectivity ► dual-signal cross-check)
T-065 ◄── T-064 + T-036                  (ONE rejection shape, per-reason counters)
T-066 ◄── T-053 + T-063                  (token bucket in the shared store)

Contract & client deliverables (GR-017 §17-e.12)
T-067 ──► T-068 ──► T-069                (schema package ► generate + drift gate ► boot assertion)
T-070 ◄── T-067                          (typed client, receipt validation)
T-071 ◄── T-070                          (contract-skew guard)
T-072 ◄── T-056 + T-070                  (ONE shared ack command, both platforms)
T-073 ◄── T-072 + T-029                  (web ack UI)
T-074 ◄── T-072 + T-030                  (mobile ack UI)

Cross-cutting proofs
T-075 ◄── T-034 + T-063 + T-067          (one envelope valid on BOTH paths — SC-008)
T-076 ◄── T-065                          (invalid payload: not retried, not a row — SC-016)

Verification
T-019 ◄── all implementation tasks above
T-020 ◄── T-019
```

**Critical path to a demonstrable end-to-end flow (003 only):**
`T-049 → T-051 → T-053 → T-001 → T-067 → T-002 → T-003 → T-026 → T-054 → T-027 → T-004 → T-010/T-012 → T-055/T-056 → T-070 → T-072 → T-028 → T-029/T-030 → T-017`.
⚠️ **T-049 → T-051 → T-053 is now at the head of the critical path**, because publish-accept, replay, ack and the
quota bucket are all writes against the store, and T-049's durability answer decides which store is provisioned.
Group routing (`T-023…T-025`, `T-005`) and the four blocked producer integrations sit off this path.

---

## US-001 — Direct User Notification

- [ ] **T-001** [P] [US-001] Scaffold NestJS package `packages/services/notification-service` with module, controller, service stubs, and root tsconfig entry. — `packages/services/notification-service/src/notification.module.ts`
    - **Depends on**: —
    - **Implements**: FR-001, FR-004
    - **Acceptance**: Package compiles; `npm run build` passes for the package.

- [ ] **T-002** [P] [US-001] Author the envelope contract **as zod, in the service**, at `src/**/*.schema.ts` beside the ingress it validates: `PublishEnvelope` (FR-026's normative field set), `RecipientDescriptor`, `RecipientKind`, `DeliveryEnvelope`. — `packages/services/notification-service/src/ingress/publish-envelope.schema.ts`
    - **Depends on**: T-001
    - **Implements**: FR-001, FR-004, FR-026, GR-015 §15-a, GR-017 §17-a.1
    - **Acceptance**: `z.strictObject()` on the publish envelope (a mutating body — GR-017 §17-c); `payload` modelled as opaque **with a size bound only** (FR-023, bound from T-050); `producer` REQUIRED (FR-026 as amended); every `*.schema.ts` imports **only** `zod` and other `*.schema.ts` — no AWS SDK type, no cache-client type, no Nest symbol, because this schema is imported by **web and mobile** and one SDK import would drag the server graph into both apps. Unit tests: each required field, omitted individually, is rejected; an unknown key is rejected.
    - **Amended 2026-08-12.** It previously created a hand-written type package `@kitchensink/notification-types` at `packages/shared/notification-types/src/envelope.types.ts`. That is a **GR-015 violation on day one**: the wire contract is authored as zod **in the owning service** and distributed as the generated, committed `packages/schemas/notifications` (T-067). A shared `*-types` package is a third representation nobody validates against — and a `type`-only package cannot perform FR-015's pre-durability validation at all.

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

- [ ] **T-027** [P] [US-005] Implement the routing consumer's `sequence` assignment: on dequeue, assign a monotonic `sequence` **per recipient USER** (`INCR notif:seq:{u:<userId>}`) and insert the pending entry carrying it **atomically**, in that user's slot. — `packages/services/notification-service/src/routing/sequencer.service.ts`
    - **Depends on**: T-026, T-053, T-054
    - **Implements**: FR-008, SC-002
    - **Acceptance**: 100 messages to one recipient carry gap-free ascending `sequence`; concurrent consumers never assign a duplicate `sequence` for the same recipient (proven under contention, not just single-threaded); a **redelivered** fan-out neither adds a second entry for a member who already has one nor burns a counter value it fails to use (no gaps — a gap makes the client's gap detection re-pull forever); `global` messages carry no `sequence`. Unit + integration.
    - **Amended 2026-08-12.** Two changes. (1) "persist it in the same transaction as the notification row" — there is no SQL transaction any more; atomicity is a Lua script in one hash-tag slot (T-054, plan.md → _Atomicity_). (2) The counter is scoped to the recipient **user**, not to `recipient.id`: FR-035 settles a group notification per member, so a member's pending set holds entries from every group they belong to **plus** their direct notifications, and a `recipient.id`-scoped counter would put three independent counters into one ordered set and collide inside it. The FIFO group (`MessageGroupId = recipient.id`) stays the **ordering authority**; the counter is only the score.

- [ ] **T-009** [P] [US-005] ⛔ **SUPERSEDED 2026-08-12 — do NOT build this.** Split into T-053 (the pending-set repository module over ElastiCache Serverless Valkey), T-054 (the atomic publish-accept), T-057 (the 72-hour expiry sweep) and T-010 (replay). Kept as a row rather than deleted so nobody rediscovers it from a stale artifact and builds it. — ~~`packages/services/notification-service/src/persistence/message.store.ts`~~
    - **What it said**: "Implement the durable message store and 24h retention (Drizzle ORM + PostgreSQL) per plan.md → Data Model: `notification`, `delivery`, `publish_idempotency` tables with the `(recipient_kind, recipient_id, sequence)` replay index."
    - **Why it is superseded**: the owner's 2026-08-12 directive replaces the 24-hour clock with **ack OR 72 h, whichever first** (FR-012, FR-034) and moves the retained set out of PostgreSQL entirely (FR-040). All three tables are named as superseded in plan.md → _Data Model_, with what each was for. In particular the `delivery` table is **not** to be reintroduced under another name: a per-**subscriber** delivery row is the per-device retention ADR-0016 rejected, and FR-035 makes ack per **user**.
    - **What survives from it**: the counter-before-release ordering (now T-057) and the ordered-replay guarantee (now T-010 over T-053's sorted set).

- [ ] **T-010** [P] [US-005] Implement `GET /api/v1/notifications/replay` endpoint for reconnect catch-up scoped to authenticated user, reading the ascending `sequence` range from that user's pending sorted set. — `packages/services/notification-service/src/replay/replay.controller.ts`
    - **Depends on**: T-053
    - **Implements**: FR-012, FR-039, US-005, SC-003
    - **Acceptance**: Replay returns every notification still **pending** for the authenticated user, in `sequence` order — **acked ones are absent and unacked ones are present** (that is the whole difference from the superseded "undelivered" wording, which could not distinguish delivered-but-unconsumed from consumed). The cursor/window input is parsed at the boundary by an authored zod (GR-016); a request-supplied identity is **never** the authority for what is returned (FR-020, FR-021). Unit + integration + e2e.
    - **Amended 2026-08-12**: "only undelivered messages … within retention window" → pending-scoped, 72 h, ack-terminated.

## US-006 — Operational Counters

- [ ] **T-011** [P] [US-006] Implement operational counters: publish rate per producer, delivered count, undelivered-after-retention count, active subscriber gauge, per-`messageType` publish count. — `packages/services/notification-service/src/metrics/metrics.service.ts`
    - **Depends on**: T-003, T-053
    - **Implements**: FR-013, FR-014, US-006
    - **Acceptance**: Integration test: counters move by expected deltas after mixed publish/subscribe/retention events. **Every counter is dimensioned by a resolved producer name — never by a sentinel** (FR-043, GR-019): an unattributable publish is a rejection, not a `'unknown'` bucket, because one sentinel bucket makes every per-producer aggregate a large fiction that still _looks_ populated. Unit + integration.

## US-007 — Authenticated Subscription

- [ ] **T-012** [P] [US-007] Implement `GET /api/v1/notifications/subscribe` (SSE/WebSocket) with 002 auth boundary; reject cross-user subscription. — `packages/services/notification-service/src/subscribe/subscribe.controller.ts`
    - **Depends on**: T-008, T-010
    - **Implements**: FR-010, FR-020, FR-021, US-007
    - **Acceptance**: Unauthenticated rejected (401); auth as U subscribing to V rejected (403); auth as U receives U's messages.

## US-008 — Envelope Schema Validation

- [ ] **T-013** [P] [US-008] Wire FR-015's pre-durability validation to **the authored zod from T-002** — `createZodDto` plus **`nestjs-zod`'s** `ZodValidationPipe` on the HTTP path, and the **same schema called explicitly** by the EventBridge adapter (which has no pipe available). — `packages/services/notification-service/src/ingress/publish-envelope.schema.ts` + `src/notification.module.ts`
    - **Depends on**: T-002, T-003
    - **Implements**: FR-015, FR-024, US-008, GR-016 §16-a, GR-017 §17-a.5
    - **Acceptance**: 10 malformed envelopes all rejected with structured errors; none stored. ⚠️ **A route test proves a known-bad body is rejected — inspection of the module wiring is NOT acceptance.** `createZodDto` under Nest's own built-in `ValidationPipe` validates **nothing while looking correctly wired** (a live case in this repo: identity's `PATCH /users/me`), and on this surface that failure admits **arbitrary envelopes into the retained store** with every visible signal saying they were checked. Paired with the same envelope over the bus (SC-008, T-075). Unit + integration + e2e.
    - **Amended 2026-08-12.** It previously said **class-validator**. That is two mechanisms in one service (a GR-016 §16-a.2 violation) and it would make FR-015's enforced contract a _different artifact_ from the published one, so a producer could be surprised by a rule it could not see. There is also no `publish-validation.pipe.ts` to write: the pipe is `nestjs-zod`'s, registered, not authored.
    - ⚠️ **Correction to the cautionary aside this note carried**: it cited "the state `recipe-service` is currently in mid-convergence with **19 remaining `class-validator` files**". Re-measured 2026-08-12, that is **wrong twice** — the 19 was a **mention** count (JSDoc narrating the migration), and the single real importer is now converged with `class-validator` / `class-transformer` **removed from recipe-service's `package.json` and `prod.package.json`**. **No service in `packages/services/**`has a`class-validator`importer.** 014 would therefore not be joining an existing residue; it would be **starting** one in a brand-new service, and would fail repo-wide gate **G5** in`packages/infra/global/**tests**/serviceSecurityInvariants.test.ts` (no exception list) on its first controller.

## US-009 — `messageType` Registry Enforcement

- [ ] **T-014** [P] [US-009] Implement the `messageType` registry **check** and the enforcement toggle against the entries **nested under each `ProducerRegistryEntry`** (T-063): tolerated mode counts unregistered, enforced mode rejects. — `packages/services/notification-service/src/registry/message-type.registry.ts`
    - **Depends on**: T-013, T-063
    - **Implements**: FR-016, FR-017, US-009
    - **Acceptance**: Registered type succeeds and increments its per-type counter; unregistered in tolerated mode succeeds with the "unregistered" counter; enforced mode rejects on FR-042's single path with `reason: 'messageType.unregistered'`. Enforcement state is configurable **per environment** (A-004: non-enforcing at launch). Unit + integration.
    - **Amended 2026-08-12.** "JSON config" and a standalone `messageType` registry are both superseded: the registry is a **TypeScript data file validated by zod at module load** and there is exactly **ONE** of them (FR-041). Two registries would let a keyword be registered to a producer the FR-027 allowlist does not know, and the FR-016 check and the FR-027 check would then disagree about who exists. This task now owns the **check and the toggle**; T-063 owns the **file and its schema**.

## US-010 — Producer-Defined Idempotency Key

- [ ] **T-015** [P] [US-010] Implement the producer-scoped idempotency claim as a `SET NX` on `notif:dedup:key:{p:<producer>}:<idempotencyKey>` with its own configurable window (default 24 h), taken **AFTER** the notification is created (T-054). — `packages/services/notification-service/src/publish/idempotency.service.ts`
    - **Depends on**: T-003, T-054
    - **Implements**: FR-018, FR-038, US-010
    - **Acceptance**: Duplicate publish within the window returns the **original's** id marked `deduplicated` and delivers once; after the window, both deliver; the window is configurable and a value **greater than 5 minutes** is proven to work — SQS FIFO's own dedup window is fixed at 5 min and cannot implement FR-018 (plan.md → _Ordering & Partitioning_, consequence 2). ⛔ **`SET NX` only — never `SET` with a fresh TTL and never `EXPIRE` on a hit**: a duplicate must not extend anything (FR-036). Unit + integration.
    - **Amended 2026-08-12**: the `publish_idempotency` **table** is superseded (see T-009); this is now the **second** of two dedup indexes, and payload identity (T-061) is the primary one. Its distinguishing property — that it **survives an ack** — is T-062.

## US-011 — Per-Feature Publish Quotas

- [ ] **T-016** [P] [US-011] Wire the publish path to the quota decision on **both** ingress adapters: structured rejection on FR-042's single path plus the per-producer throttled-publish counter. — `packages/services/notification-service/src/publish/quota.guard.ts`
    - **Depends on**: T-011, T-014, T-066
    - **Implements**: FR-019, US-011
    - **Acceptance**: Excess publishes rejected (`429` on HTTP with `reason: 'quota.exceeded'`; dead-lettered with the same `reason` on the bus); counter reflects the throttled count and the rejection **alarms** rather than dropping silently (FR-033). Unit + integration.
    - **Amended 2026-08-12**: the bucket itself is T-066 (a token bucket in the shared store, service-fixed unit). This task is the enforcement point, not the algorithm — the split matters because a guard holding its own in-memory bucket grants N× the quota across N tasks (FR-044).

## US-012 / US-013 — see the 2026-08-12 amendment below

> `spec.md`'s two new **P1** stories — **US-012** (the client acknowledges consumption) and **US-013** (identical
> pending payloads collapse) — carry their tasks in the dated amendment sections at the end of this file, with
> the store work they both depend on: [_Retained-Notification Store_](#retained-notification-store-added-2026-08-12--fr-040),
> [_US-012_](#us-012--client-acknowledges-consumption-added-2026-08-12),
> [_US-013_](#us-013--identical-pending-payloads-collapse-added-2026-08-12). They are appended rather than
> inserted here because their prerequisite (T-049 – T-054) is infrastructure that did not previously exist, and
> the file's convention is to append a dated amendment block rather than renumber.

## Integration & Cross-Feature

- [ ] **T-017** [P] [US-001..US-006] Publish the **producer integration guide** so a producer can integrate without reading this service's source: the envelope contract, both ingress paths, registration (keyword, `source` allowlisting, declared quota), and the FR-031 correlation obligation. — `specs/014-notification-service/README.md`
    - **Depends on**: T-034, T-035, T-037, T-039
    - **Implements**: FR-024..FR-033
    - **Acceptance**: this service ships NO per-producer adapter and contains no code naming another feature's domain — that is the property the guide exists to preserve (FR-025). The 003 leg itself is producer-side work, tracked as T-044.
    - **Rewritten 2026-08-11.** It previously created `src/integration/feature-003.adapter.ts` — a per-producer adapter inside the generic service, the exact coupling FR-025 forbids — and told the implementer to publish `food.backfill.completed` / `food.fetch.failed`, **neither of which exists**: 003's real event is `FoodFetchCompleted`. Anyone building it as written would have subscribed to nothing and found no bug, because the code would simply never fire.

- [ ] **T-018** [P] [US-001..US-006] Register 005, 008, 009's `messageType` keywords, `source` allowlist entries and declared quotas as **configuration** — the AI disclosure, timer alert and compliance-gap notifications. — `packages/services/notification-service/src/registry/message-type.registry.ts`
    - **Depends on**: T-014, T-018, T-035, T-046
    - **Implements**: FR-016, FR-027, FR-031, FR-033
    - **Acceptance**: onboarding a producer is a config change plus that producer's own declaration — **no code change in this service**. Registry entries are DATA; the publishing and correlation are that feature's own work (FR-031).
    - **Rewritten 2026-08-11**: previously created a per-producer adapter in `src/integration/`, which FR-025 forbids.
    - **⚠️ Blocked**: 005, 008 and 009 are specification-only — no code exists to integrate (plan.md → "Which of these actually exist in code").

- [ ] **T-021** [P] [US-001..US-006] Register 012's `messageType` keywords, `source` allowlist entries and declared quotas as **configuration** — the creator moderation / action-result notifications. — `packages/services/notification-service/src/registry/message-type.registry.ts`
    - **Depends on**: T-014, T-018, T-035, T-046
    - **Implements**: FR-016, FR-027, FR-031, FR-033
    - **Acceptance**: onboarding a producer is a config change plus that producer's own declaration — **no code change in this service**. Registry entries are DATA; the publishing and correlation are that feature's own work (FR-031).
    - **Rewritten 2026-08-11**: previously created a per-producer adapter in `src/integration/`, which FR-025 forbids.
    - **⚠️ Blocked**: 012 is specification-only. Added 2026-08-05 — plan.md named 012 mandatory for M8 with no task (sync-report DRIFT-004).

- [ ] **T-022** [P] [US-001..US-006] Register 013's `messageType` keywords, `source` allowlist entries and declared quotas as **configuration** — the publish/enroll milestone notifications. — `packages/services/notification-service/src/registry/message-type.registry.ts`
    - **Depends on**: T-014, T-018, T-035, T-046
    - **Implements**: FR-016, FR-027, FR-031, FR-033
    - **Acceptance**: onboarding a producer is a config change plus that producer's own declaration — **no code change in this service**. Registry entries are DATA; the publishing and correlation are that feature's own work (FR-031).
    - **Rewritten 2026-08-11**: previously created a per-producer adapter in `src/integration/`, which FR-025 forbids.
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

- [ ] **T-019** [P] [ALL] Write the full test set for routing, ordering, delivery, replay, **ack**, **retention/expiry**, **payload dedup**, counters, auth, validation, registry, **producer identity**, **the rejection path**, quotas, and the identity groups API. — `packages/services/notification-service/tests/`, `packages/services/identity/tests/`
    - **Depends on**: all implementation tasks
    - **Implements**: All FR items, US-001..US-013
    - **Acceptance**: Per the repo testing policy, **every** tier this feature touches: unit **and** integration for services/DALs/domain logic; e2e **and** k6 for the deployable HTTP surfaces; vitest component tests for every UI state and Playwright (web) + Maestro (mobile) for every happy path — the client tasks T-029/T-030/T-073/T-074 carry their own. Tests are written **before** the code they cover (TDD red→green). `npm test` passes; >80% branch coverage on `packages/services/notification-service`.
    - **Mutation lens, not coverage (added 2026-08-12)**: for each of SC-012 – SC-016, the test must **fail if the logic is broken** — flip the create-then-claim order (T-054), drop the counter-before-release ordering (T-057), sort an array in the canonicalizer (T-059), prefer one producer signal over the other (T-064), redrive an invalid payload (T-076) — and confirm the suite goes red. A test that still passes under those mutations is coverage theater and does not count toward the mandate.
    - **New tiers this amendment adds**: **k6** on `POST /ack` (a reconnecting client batch-acks, so the burst shape is the point) and a **cluster-mode integration tier** for the Lua script (a cross-slot script is a runtime error on ElastiCache Serverless, and a single-node local Redis will not catch it).
    - **Ordering proof (SC-002)**: 100 messages to one recipient arrive in publish order across 10 runs, including a run where the subscriber disconnects and reconnects mid-stream — the live/replay boundary is the case FIFO is most likely to break.

- [ ] **T-020** [P] [ALL] Regenerate `verify-report.md` and `v-model/release-audit-report.md` with execution evidence; confirm 0 CRITICAL / 0 WARNING. — `specs/014-notification-service/verify-report.md`
    - **Depends on**: T-019
    - **Implements**: M8 exit gate
    - **Acceptance**: `verify-report.md` **regenerated, not edited** — the 2026-05-12 report measured a task graph that never existed (sync-report DRIFT-005) and is marked superseded. Release-audit ingests real results for all mapped scenarios (186 as of 2026-05-13, plus the scenarios the reconciliation added). Constitution v1.3.0 Release Readiness Gate: all Test Case IDs mapped ✅, all scenarios executed or waived, `waivers.md` present ✅.
    - **Prerequisite**: the `v-model/` chain must first be regenerated to cover the scope added on 2026-08-05 (identity groups, ordering/sequence, client bell) **and on 2026-08-12** (ack + US-012, payload dedup + US-013, the Valkey store, the producer registry and dual-signal binding, the single rejection path, and the contract/client deliverables) — its 31 `REQ-NNN` rows predate all of it, and FR-034 – FR-044 plus SC-012 – SC-016 have no `REQ`/`ATP` rows at all. See `review.md` → Outstanding.

## Dual ingress, event-path trust, and producer onboarding (added 2026-08-10)

- [ ] **T-034** [P] [US-001] EventBridge ingress adapter delegating to the SAME core as the HTTP controller. **The core is `src/ingress/publish-core.service.ts`** — validate → registry → authz → idempotency → durable accept → route — and both adapters (`src/ingress/eventbridge.consumer.ts`, the existing `publish.controller.ts`) hold transport concerns ONLY. Naming the core matters: it is the single most consequential file in this amendment, and an unnamed shared core is how a rule ends up enforced in one adapter and not the other. — `packages/services/notification-service/src/ingress/publish-core.service.ts` + `src/ingress/eventbridge.consumer.ts`
    - **Depends on**: T-003, T-013, T-026
    - **Implements**: FR-024, FR-025
    - **Acceptance**: the same envelope over HTTP and over EventBridge produces byte-identical deliveries, asserted by a paired test per validation rule (SC-008). Only the reserved `detailType` is ingested; a producer domain event on the bus is ignored, not interpreted.

- [ ] **T-035** [P] [US-007] Notification bus + reserved `detailType`, with an EventBridge **resource policy** restricting which principals may put events, AND `source` allowlist validation. — `packages/services/notification-service/infra/lib/notification-bus.ts`
    - **Depends on**: T-034
    - **Implements**: FR-027
    - **Acceptance**: an envelope whose `source` is not allowlisted is rejected and dead-lettered, never delivered (SC-009). **Security-critical** — without both controls the event path can address any user, defeating FR-005/FR-020/FR-021.

- [ ] **T-036** [P] [US-006] Dead-letter queue + alarm for every event-path rejection, with a counter per reason. — `packages/services/notification-service/infra/lib/notification-bus.ts`
    - **Depends on**: T-034, T-035
    - **Implements**: FR-028
    - **Acceptance**: each rejection reason lands in the DLQ and increments its counter; DLQ depth is alarmed. A silently dropped rejection fails this task.

- [ ] **T-037** [P] [US-008] Extend the authored zod to the FR-026 minimum: `schemaVersion`, **`producer` REQUIRED on BOTH paths**, and `idempotencyKey` required on the EventBridge path / optional on HTTP. — `packages/services/notification-service/src/ingress/publish-envelope.schema.ts`
    - **Depends on**: T-002, T-013
    - **Implements**: FR-026, FR-030, FR-043
    - **Acceptance**: each required field, omitted individually, is rejected on both paths — never defaulted, never defaulted to a **sentinel** (FR-043, GR-019). Document the idempotency-key derivation rule beside the schema: durable domain state, never a transport id or a clock. Unit + integration, paired per path (T-075).
    - **Amended 2026-08-12.** Two corrections. (1) `producer` is REQUIRED on **both** paths, not EventBridge-only — its old rationale ("no bearer token to derive identity from") was already contradicted by FR-027, and OPEN-014-A ruled that **both signals are required and a mismatch rejects** (FR-041). This is also what keeps **one** envelope shape valid on both ingresses, so FR-024's two adapters can share literally one zod; path-specific requiredness would have made SC-008's paired tests compare two different shapes. (2) The file path moved from the deleted `packages/shared/notification-types` to the in-service schema (see T-002).

- [ ] **T-038** [P] [US-005] Reconcile ordering across ingress paths: the SQS FIFO queue (T-026) preserves ENQUEUE order, which equals publish order only over HTTP, so EventBridge arrivals must be ordered by `occurredAt` before enqueue. — `packages/services/notification-service/src/routing/ordering.ts`
    - **Depends on**: T-026, T-034, T-053
    - **Implements**: FR-008, FR-029
    - **Acceptance**: 100 envelopes for one recipient, published across BOTH paths and arriving out of order, are delivered in `occurredAt` order. If cross-path FIFO proves unachievable, FR-008 is narrowed explicitly rather than left implying a guarantee the transport does not give.

- [ ] **T-039** [P] [US-001] Replace T-003's "aligned with 002" producer auth with the concrete mechanism: Ed25519 service-principal token verified networklessly. — `packages/services/notification-service/src/auth/producer.guard.ts`
    - **Depends on**: T-003
    - **Implements**: FR-002, FR-032
    - **Acceptance**: verification performs no outbound network call. The guard's output is the token **principal**, which is an input to T-064's registry resolution — ⛔ it is **not** itself the producer name, and it is never compared directly against the envelope's `producer` (the registry is what maps one to the other, GR-020 §2). Unit + integration.

- [ ] **T-040** [P] [US-011] Make the per-producer quota configurable and declared at registration; alarm rejections. — `packages/services/notification-service/src/quota/quota.service.ts`
    - **Depends on**: T-016, T-036, T-063, T-066
    - **Implements**: FR-033, FR-044
    - **Acceptance**: the quota **magnitudes** are read from that producer's registry entry, not inferred from its internals — and the **unit is fixed by this service** and not declared by the producer (FR-044: two entries declaring different units are not comparable, and a `z.strictObject` cannot type a value whose dimension varies). This service **caps** both magnitudes. A rejection alarms rather than silently dropping a notification. Unit + integration.

- [ ] **T-041** [P] [US-001] **Synthetic reference producer** (test-only, owned by this feature) exercising both ingress paths and the full envelope, plus a producer integration guide. — `packages/services/notification-service/tests/support/reference-producer.ts`
    - **Depends on**: T-034, T-037
    - **Implements**: FR-024, FR-026, SC-001, SC-010
    - **Acceptance**: satisfies SC-001 over HTTP and EventBridge with no dependency on any consumer feature, and publishes N envelopes for one recipient to prove this service never merges them. A producer can integrate from the guide alone without reading this service's source.
    - **Note**: a real producer's fan-in translator is NOT a task here — correlation is publisher-owned (FR-031). 004's is tracked as `specs/004-recipe-importing/tasks.md` T-032.

## Producer legs — the work that makes this service load-bearing (added 2026-08-10)

These land code in `packages/services/recipe-service` and the two apps, not in the notification service. That
is the same shape as T-023..T-025, which put the groups model in `packages/services/identity`: this feature's
REQUIREMENTS stay producer-agnostic (FR-025, FR-031, FR-033), while its TASK LIST carries whatever wiring is
needed to actually ship it. A notification service with a synthetic producer and no real one is not delivered.

- [ ] **T-042** [P] [US-001] Consume `FoodFetchCompleted` (EventBridge) in the recipe service and update the ingredient's stored `foodResolutionStatus` — no client poll required to trigger it. — `packages/services/recipe-service/src/notifications/food-completion.consumer.ts`
    - **Depends on**: —
    - **Implements**: cross-feature (003 → 001/004), prerequisite for T-044
    - **Acceptance**: `IngredientsService.refreshStatus` no longer calls the food service on every poll. **Independently valuable and independently landable:** today the client polls every 2.5s and each poll makes a fresh authenticated cross-service call forwarding the end user's own bearer, so this removes a synchronous two-hop dependency from a timer loop whether or not any notification is ever published. The food event is already published and has zero consumers.

- [ ] **T-043** [P] [US-010] Idempotency and precedence for applied completions. — `packages/services/recipe-service/src/notifications/food-completion.consumer.ts`
    - **Depends on**: T-042
    - **Implements**: FR-030, and the 001/003 disambiguation contract
    - **Acceptance**: applying the same completion twice is indistinguishable from once (EventBridge is at-least-once). A **late** completion MUST NOT overwrite a value the user resolved manually through the US-2a disambiguation flow — the user's manual choice wins. Both cases have tests; the second is a correctness rule, not a nicety, and it is the one a naive "last write wins" consumer gets wrong.

- [ ] **T-044** [P] [US-001] The 003 leg — resolve the requesting user(s) for a resolved food and publish **one** envelope per outcome, keyed on the identifier the clients hold (the ingredient), not the food id. — `packages/services/recipe-service/src/notifications/food-resolution.publisher.ts`
    - **Depends on**: T-034, T-037, T-042
    - **Implements**: FR-026, FR-031
    - **Acceptance**: a resolution reaches the requesting user's client as one delivery. Note the food service **cannot** be the recipient source: `FetchQueueDao.resolve` deletes every `fetch_requesters` row for a food in the same transaction that completes it, so reading recipients from there is a race by construction — the recipe service owns its own subscription set.

- [ ] **T-045** [P] [US-001] The 004 leg — the import-completion translator: correlate the ingredient resolutions belonging to one import against that import's own job identity and publish **exactly one** envelope per user-meaningful outcome. — `packages/services/recipe-service/src/notifications/import-translator.ts`
    - **Depends on**: T-034, T-037, T-042, T-043
    - **Implements**: FR-031
    - **Acceptance**: an import of 30 unknown ingredient names yields exactly ONE delivered notification, not 30 (004 FR-020 submits every parsed name to 003, bounded at 100/request by 003 FR-045). A redelivered underlying completion does not yield a second. `idempotencyKey` derived from the import's durable job identity plus terminal status — never a transport id or a clock (FR-030). **This is the fan-in reference implementation every other fan-out producer copies.**
    - **Note**: this is the task previously drafted as 004 T-032 and reverted from PR 91; it lands here because 014 is the delivery vehicle. 004's V-Model trace (a REQ + ATP for "the user is told once when an import completes") is still owed on the 004 branch — the obligation is new and no existing 004 requirement covers it.

- [ ] **T-046** [P] [US-009] Register both producers' `messageType` keywords AND **write the payload reference documentation**, as configuration plus a durable document. — `packages/services/notification-service/src/registry/message-type.registry.ts` + `specs/014-notification-service/payload-reference.md`
    - **Depends on**: T-014, T-018, T-035
    - **Implements**: FR-016, FR-023, FR-026, FR-027
    - **DOCUMENT IT HEAVILY — this is the deliverable, not a side effect.** A schema file alone does not satisfy this task. The documentation MUST cover, for the envelope: every field, its type, whether it is required on each ingress path and **why**, size limits, the `schemaVersion` policy (what a consumer does with a version it does not recognise), and the exact error shape a producer receives per path — a structured error on HTTP, a dead-letter with a reason code on EventBridge (FR-028). And for **each registered `messageType`**: the payload's shape with every field explained, at least one **worked example** of a real envelope, what a consumer is expected to DO on receipt, and what the consumer must NOT assume (notably: delivery is not exactly-once from the producer's side without an `idempotencyKey`, and a message may arrive after the state it describes has changed again).
    - **Acceptance**: a client author unfamiliar with this platform can write a correct consumer for any registered `messageType` from this document alone — without reading a producer's source, this service's source, or asking anyone. Reviewed by someone who did not write it, against that standard.
    - **Why this is a task and not a footnote**: FR-023 makes `payload` opaque to this service and producers own their own keyword namespaces, so nothing structurally requires a producer to publish a payload schema anywhere discoverable. Without this, a consumer dispatching on `messageType` has a documented envelope wrapped around undocumented contents, and every client author reverse-engineers the same thing from a producer's source. Registration is not complete until the payload is documented.
- [ ] **T-047** [P] [US-004] Client subscription and dispatch on **both** platforms, with polling retained as the documented fallback. — `packages/apps/commise/web` + `packages/apps/commise/mobile` (+ the shared client seam)
    - **Depends on**: T-012, T-046, T-070
    - **Implements**: FR-010, FR-011, FR-021, US-004
    - **Acceptance**: web and mobile both subscribe, dispatch by `messageType`, tolerate unknown types (log and ignore, never crash), and reconcile on reconnect rather than trusting that no message was missed. Ships to both platforms in the same release (`docs/CODING_STANDARDS.md` §14). The existing self-limiting poll stays: push is a latency optimisation and MUST NOT become load-bearing for correctness, so a lost notification degrades to the poll rather than stranding the user.
    - **Amended 2026-08-12**: both platforms consume through `packages/clients/notifications` (T-070) and **declare no envelope shape of their own** — including in feature packages (GR-015 §15-b.4). Every arriving `DeliveryEnvelope` is **parsed on receipt** with the schema package's zod (GR-016 §16-c.3); a hand-written "notification" interface in web and another in mobile is two independent beliefs about one contract on two platforms that ship on different schedules. The **ack** is T-072/T-073/T-074 and is a separate obligation from dispatch: dispatch without ack is a client that receives the same notification on every reconnect for three days.

- [x] **T-048** **[DONE 2026-08-10 — owner ruling given and executed]** [P] [ALL] Retire 003's own transport design, which contradicts GR-011. — `specs/003-usda-food-data/{spec,tasks}.md`
    - **Depends on**: T-044
    - **Implements**: GR-011, and closes the 014↔003 contradiction
    - **Acceptance**: 003's US-9, T-185 and T-186 plus the WebSocket halves of its FR-041/FR-049/FR-050 are dispositioned — the requirements are satisfied by publishing through this service, so the spec text specifying an API Gateway WebSocket on the food service is wrong and must not stand. Also fixes 014's own dependency row, which cites a `003 US-005 / FR-NOTIF` that does not exist. **Cross-spec: amends another feature's requirement set, so it needs an explicit owner ruling before it lands.**

## Retained-Notification Store (added 2026-08-12 — FR-040)

> Owner directive 2026-08-12: _"use redis"_. Design record:
> [ADR-0016](../../docs/architecture/decisions/0016-notification-retention-payload-dedup-and-valkey.md);
> layout, cost arithmetic and the durability risk: [`plan.md`](./plan.md) → _Data Model_ and _Store Choice_.
> These six tasks replace the superseded T-009 and sit at the **head of the critical path** — publish-accept,
> replay, ack and the quota bucket are all writes against this store.

- [ ] **T-049** [P] [ALL] ⚠️ **GATE — answer the durability question IN WRITING before any cache is provisioned.** Confirm against current AWS documentation whether the ElastiCache-for-Valkey **durability** option (Multi-AZ transactional log; **synchronous** = designed for zero loss, **asynchronous** ≈ up to 10 s of acknowledged writes lost) is available on ElastiCache **Serverless** at the engine version we are given, and record the answer in `plan.md` → _Store Choice_. — `specs/014-notification-service/plan.md`
    - **Depends on**: —
    - **Implements**: FR-040 mitigation 1
    - **Acceptance**: the answer is recorded **with a citation to the AWS documentation page and the date it was read**, not from memory. If durability is **available on serverless**, synchronous mode is enabled in T-051 (a publish-accept is not a hot path and FR-003 already promises durability). If it is **node-only**, the recorded decision is an explicit choice between a `cache.t4g.micro` node **with** durability (≈ $9.34/mo) and a non-durable serverless cache (≈ $6.13/mo) — a **$3.21/mo** trade, taken as a decision rather than inherited as a default.
    - **Why this is a task and not a footnote**: with durability off, a node replacement can drop retained notifications this service already told a producer it **accepted** (FR-003), producers keep **no copy** (FR-031), and the loss is therefore **unrecoverable and silent**. Provisioning first and asking later means the question gets answered by an incident.
    - **Not a code task** — no test tier. Its output is a recorded answer and a decision.

- [ ] **T-050** [P] [US-008] Decide the concrete **`payload` size bound and envelope size bound**, and encode them as **numbers in the authored zod**. — `packages/services/notification-service/src/ingress/publish-envelope.schema.ts`
    - **Depends on**: T-002
    - **Implements**: FR-023, FR-037, FR-040, GR-016 §16-d
    - **Acceptance**: both bounds are explicit literals in the schema with the reasoning recorded beside them; an over-bound `payload` and an over-bound envelope are **rejected at ingress on both paths**, never a failed write after the caller was told it succeeded (the producer has no other record — FR-031). ⛔ A bound inherited from a transport limit is **not a decision**. Note there is no column to derive a floor from here: the retained set is a **metered cache**, so an unbounded payload is not a `500`, it is a **bill** and a fan-out amplifier. Unit (schema rejects) + integration (both ingresses reject).
    - ⚠️ **Blocks T-067**: the schema package cannot be generated with an undecided bound. This is the one item `spec.md` still records as genuinely open.

- [ ] **T-051** [P] [ALL] Provision **one ElastiCache Serverless for Valkey cache per STAGE** (`kitchensink-notifications-{stage}`) in CDK, in `packages/infra/global` alongside the other shared platform stacks, with a security group admitting the notification service's task SG and `CfnOutput` exports the service imports by **`baseStage`**. — `packages/infra/global/lib/platform/notification-cache-stack.ts` + `packages/infra/global/lib/platform/GlobalStack.ts`
    - **Depends on**: T-049
    - **Implements**: FR-040, A-008
    - **Acceptance**: synth produces exactly **one** cache per stage; the stack is tagged **`Environment=global`** (inherited from `bin/app.ts`'s app-level tag) and **never `Environment=pr-{N}`** — a `pr-{N}`-tagged cache would be deleted by the PR-close cleanup, taking the shared sandbox pending set with it (ADR-0005). Export names follow the existing `${stackName}:Name` convention. A `pr-{N}` deploy creates **no** cache and imports the `baseStage` one (ADR-0006). The Valkey **port ingress is from the service SG only**, not `0.0.0.0/0`. ⛔ **No NAT consumer is added** — a VPC-internal cache needs none (ADR-0004). Synth/unit tests in `packages/infra/global/__tests__/`, plus an assertion that **prod's synthesized template gains exactly one new stack and no existing prod template changes**.
    - **Key prefix**: every key a preview writes is prefixed **`pr-{N}:`**, so two open PRs cannot read each other's notifications and a teardown can find a preview's keys (T-052). The prefix is applied in **one** place — T-053's repository module — never at call sites.
    - **Cost note for the reviewer**: **$0 additional per open PR**, versus ≈ $6.13/mo per open PR had each preview been given its own cache. 🟠 Residual: a serverless cache at the 100 MB floor has **no instance to stop**, so it is **not** in ADR-0007's nightly-shutdown selector (which stops RDS, ECS and the NAT instance) — the same shape of exclusion ADR-0010 records for per-PR ECS.

- [ ] **T-052** [P] [ALL] Reclaim a closed PR's **`pr-{N}:` keys** in the CI teardown path, before any stack delete. — `.github/scripts/teardown-sandbox-pr.sh` (+ a scoped helper in the style of `packages/apps/commise/web/scripts/teardownPreviewDomain.ts`)
    - **Depends on**: T-051
    - **Implements**: FR-040, ADR-0005 (the CI-owned half of teardown)
    - **Acceptance**: closing a PR deletes exactly that preview's keys and **nothing else** — the scope match is `pr-{N}` **exactly** or `pr-{N}:…`, reusing the delimiter-aware matcher in `.github/scripts/pr-scope.sh` rather than adding a second one (pr-1 must never match pr-15). An **absent** key set is **success** (idempotent). Regression-tested in `packages/infra/global/__tests__/` against the real shell function, the way `prScope.test.ts` already tests the matcher. ⛔ Never `FLUSHALL`, never a bare prefix scan without the delimiter — the same cache holds **the shared sandbox stage's own keys**.
    - **Why this is a task**: the cleanup script deletes by **tag or name**, and a _key inside_ a shared cache is neither, so nothing reclaims these today. Without it a closed PR's keys sit in the shared cache until their 72-hour TTL expires — bounded, but metered memory nobody is using.

- [ ] **T-053** [P] [US-001, US-005, US-012, US-013] Implement the **ONE** pending-set repository module — the only code in the service that speaks to the store. — `packages/services/notification-service/src/persistence/pending-set.repository.ts`
    - **Depends on**: T-051
    - **Implements**: FR-040, FR-012, FR-035, FR-039
    - **Acceptance**: every read and write of the retained set goes through this module — envelope get/put, pending insert/range/remove, `sequence` increment, attempt increment, dedup claim/release, quota bucket. The **hash-tag construction** (`{u:<userId>}` / `{g:<groupId>}` / `{p:<producer>}`) and the **`pr-{N}:` prefix** live here and **nowhere else**. A **structural test asserts no other module imports the cache client** (model it on the discovery-based `packages/infra/global/__tests__/appServiceDependency.test.ts` pattern), because "one module" is only true if it is enforced. Unit tests against a real Valkey in Docker; integration tests for the ordered range and cross-slot envelope read.
    - **Why "one module" is a requirement and not tidiness**: FR-040's escalation path is **MemoryDB or DynamoDB+TTL** if the durability risk is ever judged unacceptable, and in DynamoDB the ordered pending set becomes a range query on a sort key and the Lua atomicity becomes a conditional write plus a transaction. That is a store swap **only** if the access is behind one interface; spread across handlers it is a rewrite.

- [ ] **T-054** [P] [US-001, US-013] Implement **publish-accept as ONE Lua script in ONE slot** — payload-dedup claim, `sequence` assignment, envelope write, pending insert — and take the producer-scoped idempotency claim as a **separate, SECOND** command. — `packages/services/notification-service/src/persistence/publish-accept.lua` + `pending-set.repository.ts`
    - **Depends on**: T-053
    - **Implements**: FR-003, FR-018, FR-036, FR-037, FR-038, ADR-0016 decision 6
    - **Acceptance**: the script is atomic under concurrent identical publishes — exactly one wins, the loser returns the **winner's** id marked `deduplicated`, and the winner's `expiresAt`, `sequence` and delivery state are **byte-identical before and after** (SC-014). A cluster-mode integration test proves the script does **not** span slots (ElastiCache Serverless runs in cluster mode, so a cross-slot script is a runtime error, not a style problem). Unit + integration.
    - ⚠️ **DELIBERATE — create the notification FIRST, take the idempotency claim SECOND. Do not "tidy" the two into one order for symmetry.** A crash between them in this order leaves a notification with **no claim** — a possible **visible duplicate** on redelivery, which is recoverable. The reverse leaves a claim with **no notification**, which **silently suppresses a notification that was never created**, and nothing anywhere can detect it. Same mirrored-order reasoning as ADR-0005's preview-domain create/teardown pair. **A test asserts the order**, with a fault injected between the two steps, and a `// ⚠️ DELIBERATE` comment at the call site records why (this ADR directory's README owes such a guard at exactly three sites: here, the ack handler, and the dedup key derivation).

## US-012 — Client Acknowledges Consumption (added 2026-08-12)

> `spec.md` US-012 (P1). Retention ends on an explicit ack **or** at 72 hours, whichever comes first — and a
> notification nobody can consume is an **alarm**, not a silent drop.

- [ ] **T-055** [P] [US-012] Author the ack contract as zod in the service: `AckRequest` (`{ notificationIds: string[] }`, **1–100**, each a well-formed ULID) and `AckResponse` (per-id `settled` / `alreadySettled`). — `packages/services/notification-service/src/ack/ack.schema.ts`
    - **Depends on**: T-002
    - **Implements**: FR-034, GR-016, GR-017 §17-a.6, §17-c
    - **Acceptance**: **`z.strictObject()`** — it is a mutating body (GR-017 §17-c). The array cap is **load-bearing, not decorative**: an unbounded `notificationIds` is an unbounded multi-key store operation available to any authenticated client. Ids are **REQUIRED and never optional or sentinel** (FR-043, GR-019). Unit tests: empty array rejected, 101 ids rejected, 100 accepted, a malformed id rejected, an unknown key rejected.

- [ ] **T-056** [P] [US-012] Implement `POST /api/v1/notifications/ack`: settle each named notification **for the authenticated user**, releasing its pending entry, its attempt count and its payload-identity claim — while leaving the `(producer, idempotencyKey)` claim alone. — `packages/services/notification-service/src/ack/ack.controller.ts` + `src/ack/ack.service.ts`
    - **Depends on**: T-053, T-055
    - **Implements**: FR-034, FR-035, FR-038, US-012
    - **Acceptance**, and every clause is its own test (SC-013 requires **per case, not in aggregate**):
        - a second ack for the same id → `200`, `alreadySettled`, **not** an error;
        - an **expired** id → `200`, `alreadySettled`;
        - an **unknown** id → `200`, `alreadySettled`;
        - an id belonging to **another user** → `200`, `alreadySettled` — ⚠️ and the response is **indistinguishable** from the three above, or the endpoint is an **existence oracle** for other users' notifications;
        - a **group** notification acked by member A is still pending for member B (FR-035 — per-member entries over one stored envelope);
        - acking on one device settles it for the **user**, so a web tab opened afterwards does not receive it (an **accepted consequence**, asserted so nobody "fixes" it into per-device retention);
        - the payload-identity claim **is** released (so the same payload published afterwards is a **new** notification), and the `(producer, idempotencyKey)` claim **is not** (T-062).
    - ⚠️ **Parsing is not authorization.** The other-user case is an **authorization** outcome, not a validation one (FR-035) — the two checks must not be collapsed into one, or a validation refactor silently changes a security behaviour.
    - **Tiers**: unit + integration + **e2e** + **k6** (it is a deployable HTTP surface, and a reconnecting client batch-acks — the burst shape is exactly what k6 is for).

- [ ] **T-057** [P] [US-005, US-012] Implement the **72-hour expiry sweep**, which increments the undelivered-after-retention counter **BEFORE** releasing any key. — `packages/services/notification-service/src/retention/expiry-sweep.service.ts`
    - **Depends on**: T-011, T-053
    - **Implements**: FR-012, FR-013, FR-036, SC-003
    - **Acceptance**: an unacked notification at `publishedAt + 72h` is not redelivered, and the counter moved **first** — ⚠️ **a passive TTL cannot satisfy this task.** When a TTL fires, the key ceases to exist with **no application code running**, so there is nothing left to count and nothing to count it; the counter would then be permanently unemittable and FR-013 unsatisfiable. So expiry is driven by a **sweep** that reads entries whose stored `expiresAt` has passed, counts, and **then** releases the pending entry, the attempt field, the payload-identity claim and (when no referent remains) the envelope. TTLs stay on the keys as a **backstop against unbounded growth if the sweep is down**, accepting that a TTL-reclaimed key is one uncounted notification. ⛔ Keyspace notifications are **not** a substitute — Valkey delivers them best-effort and at-most-once.
    - **Also asserted**: `expiresAt` is **never** refreshed — a duplicate publish, a delivery attempt, a reconnect and a partial ack all leave it byte-identical (FR-036, SC-014). Unit + integration (with a clock the test controls, not a 72-hour wait).

- [ ] **T-058** [P] [US-005, US-012] Redeliver every still-pending notification on reconnect/replay in `sequence` order, increment its per-notification **attempt count**, and **count + alarm** a poison notification. — `packages/services/notification-service/src/delivery/redelivery.service.ts` + `infra/lib/notification-alarms.ts`
    - **Depends on**: T-012, T-053
    - **Implements**: FR-039, US-012, SC-012
    - **Acceptance**: of 100 delivered notifications, the acked ones are **0 %** redelivered and the unacked ones **100 %** redelivered, in `sequence` order (SC-012). Each attempt increments `attempts` for **that member**. A notification with a high `attempts` and no ack raises the **poison-notification alarm**. ⛔ **It is NOT capped or dropped early** — dropping it would discard a notification the service promised to keep, and the 72-hour clock (T-057) is already the backstop. Unit + integration + e2e (disconnect → publish → reconnect → assert redelivery, then ack → reconnect → assert silence).

## US-013 — Identical Pending Payloads Collapse (added 2026-08-12)

> `spec.md` US-013 (P1). Owner directive: _"Dedup messages based on payload so we don't have messages with
> identical payload waiting to be consumed."_ This index is **always on** and needs **no producer cooperation** —
> which is the point: US-010's `idempotencyKey` outsources the guarantee to the least-supervised party.

- [ ] **T-059** [P] [US-013] Derive the payload-identity hash: **SHA-256 over the RFC 8785 (JCS) canonical serialization** of `{ schemaVersion, recipient, messageType, producer, payload }`, using the **maintained `canonicalize` library**. — `packages/services/notification-service/src/dedup/payload-identity.ts`
    - **Depends on**: T-002
    - **Implements**: FR-037, FR-023 (as amended)
    - ⛔ **NOT hand-rolled.** The repo's library-first pre-write gate applies verbatim: check for a stable, well-maintained, widely-used library first and use it unless there is a specific concrete reason not to — and "writing an exhaustive test for a reinvention does not redeem the reinvention". `canonicalize` on npm is the intended dependency: **zero runtime dependencies**, published by RFC 8785's own authors (Samuel Erdtman, Anders Rundgren), actively maintained (4.0.0), ESM-only — which is fine, this repo's services are already `"type": "module"`. ⚠️ **Verify the licence before adding it**: `npm view canonicalize license` reports **Apache-2.0**, whereas ADR-0016 and `spec.md` describe it as MIT. Apache-2.0 is permissive and almost certainly acceptable, but the discrepancy must be resolved rather than propagated.
    - **Acceptance** — four properties, each a way a naive serializer silently produces the **wrong** hash, each its own test:
        - **key order is normalized** (`{"a":1,"b":2}` and `{"b":2,"a":1}` hash alike — SC-014) by lexicographic sort on **UTF-16 code units at every depth**, and numbers use **ECMAScript shortest-round-trip** form so `1`, `1.0` and `1e0` are identical;
        - **array order is PRESERVED** — an array is ordered data, and sorting it would collide two different payloads;
        - **an absent key and an explicit `null` stay DIFFERENT** — normalizing `{"a":null}` to `{}` would collide two payloads whose difference belongs to a producer this service does not speak for;
        - **strings are byte-exact, no Unicode normalization** — NFC folding would decide that two different producer strings mean the same thing, which is not ours to decide.
    - **Also asserted**: `occurredAt` and `idempotencyKey` are **excluded** from the identity (`occurredAt` changes on a producer retry — precisely the case dedup exists to collapse, so including it would make the index useless _while looking correct_), and the **recipient is included** (the same payload to two users is two notifications — SC-014, US-013 scenario 6). Unit + integration.
    - **A `// ⚠️ DELIBERATE` comment records all of the above at the derivation site** — one of the three guard sites this ADR directory's README owes when the service lands.

- [ ] **T-060** [P] [US-013, US-008] Reject a payload containing a number that does **not** survive an IEEE-754 round trip, with a `reason` naming the offending path. — `packages/services/notification-service/src/dedup/payload-identity.ts` + the ingress core
    - **Depends on**: T-059
    - **Implements**: FR-037, FR-023, FR-042
    - **Acceptance**: `10000000000000001` in a payload is **rejected at ingress on both paths** with `reason: 'payload.number-not-representable'` and the offending JSON path named — never silently canonicalized. **The test asserts the WHY, not just the rejection**: `10000000000000001` parses to `10000000000000000`, so canonicalizing the parsed value would make two **different** payloads hash **identically** and collapse them into one notification. This is the one place FR-023's "opaque payload" rule yields a real constraint, and `spec.md` states it there rather than smuggling it in. Unit + integration.

- [ ] **T-061** [P] [US-013] Implement the **pending-scoped** payload-identity claim: `SET NX notif:dedup:payload:{<recipientTag>}:<h>` inside T-054's script, released on ack or by the expiry sweep. — `packages/services/notification-service/src/dedup/payload-claim.ts` + `publish-accept.lua`
    - **Depends on**: T-054, T-059
    - **Implements**: FR-037, FR-038, US-013, SC-014
    - **Acceptance**: two back-to-back publishes of the same payload with **no `idempotencyKey`**, differing only in `payload` key order and in `occurredAt`, produce **ONE** notification; the second call **succeeds** (never an error — a producer told a normal condition is a failure will retry into it) returning the **original's** id with a `deduplicated` indicator **naming which index matched**; the original's `expiresAt`, `sequence` and delivery state are **unchanged**; and the **same payload published after an ack produces a SECOND notification** (that is the directive, not a bug — "you have 3 new followers" arriving again tomorrow is correct). Publishing the same payload to two **different** recipients delivers to both. Unit + integration + e2e.
    - ⛔ **`SET NX` only.** Never `SET` with a fresh TTL, never `EXPIRE` on a hit — a producer in a retry loop would otherwise hold one notification pending forever, growing a metered store on a schedule nobody chose (FR-036).

- [ ] **T-062** [P] [US-010, US-013] Prove and preserve the one asymmetry between the two dedup indexes: the `(producer, idempotencyKey)` claim **SURVIVES an ack**, while payload identity does **not**. — `packages/services/notification-service/src/publish/idempotency.service.ts`
    - **Depends on**: T-015, T-054, T-061
    - **Implements**: FR-018, FR-038, SC-011
    - **Acceptance**: replaying the same EventBridge event with an unchanged `idempotencyKey` produces **one** notification **both before and after** an ack (SC-011) — this is the case payload identity structurally cannot cover, because a fast user can ack seconds before an at-least-once transport redelivers. The guarantee is stated as **effectively-once within the claim window** ("at most one per `(producer, idempotencyKey)`, and never zero"); ⛔ **"exactly-once" is not to be reinstated** in any client-facing material or test name (SC-011 was narrowed for exactly this reason). Unit + integration.
    - ⛔ **A contributor will want to merge the two indexes. Do not.** They have different scopes and different lifetimes on purpose: merging them either loses this post-ack replay guard or breaks the pending-only rule. ADR-0016 decision 3's table is the answer to "why two?" — cite it in the code comment.

## Producer Identity, One Rejection Path, and the Quota Unit (added 2026-08-12)

> The three owner rulings that closed OPEN-014-A / -B / -C, plus GR-018 – GR-020, which 014 is the first feature
> in the portfolio to specify end to end.

- [ ] **T-063** [P] [US-009, US-011] Author the **producer registry** as version-controlled data in the service, with its own zod, and **assert the mapping injective at boot**. — `packages/services/notification-service/src/registry/producers.registry.ts` + `src/registry/producer-registry.schema.ts`
    - **Depends on**: T-001
    - **Implements**: FR-041, FR-016, FR-027, FR-033, FR-044, GR-020
    - **Acceptance**: one `ProducerRegistryEntry` per producer carrying `{ producer, httpPrincipals[], eventSources[], quota: { sustainedPublishesPerSecond, burstPublishes }, messageTypes[], ownerFeature, registeredAt }`, validated at **module load** by a `z.strictObject` in the same service. **A duplicate principal or a duplicate `source` fails at BOOT, not at first use** (GR-020 §4, AC-020-b) — overlapping mappings make attribution ambiguous, which silently misattributes both the FR-013 counter and the FR-044 quota bucket. Unit + integration (boot-order test in the style of `packages/services/recipe-service/src/__tests__/mainBootOrder.test.ts`).
    - ⛔ **ONE file, and these three things it must not be**: **not a database table** (a runtime write would change a trust boundary with no review and no deploy); **not a second file** beside a separate `messageType` registry (split, a keyword could be registered to a producer the FR-027 allowlist does not know, and the two checks would disagree about who exists); **not assembled from the producer packages it constrains** (that inverts the dependency and hands the constrained party its own quota and its own authority to address any user). It is **copied into the schema package by the same generator that copies the zod** (T-067) and is **never hand-edited there**.
    - **Onboarding a producer is a PR against this service, and that is the point rather than friction** — the registry is where a producer's quota and its authority to address **any** user are declared, so both are cross-producer concerns that must be reviewed by the shared service's owners.

- [ ] **T-064** [P] [US-001, US-007] Implement **dual-signal producer resolution and mismatch rejection on BOTH ingress paths**, in the shared core. — `packages/services/notification-service/src/ingress/producer-identity.service.ts` (called from `publish-core.service.ts`)
    - **Depends on**: T-034, T-039, T-063
    - **Implements**: FR-041, FR-027, FR-026, FR-043, GR-020, SC-015
    - **Acceptance**: the transport signal — the Ed25519 token **principal** on HTTP, the **validated** event `source` on the bus — is resolved **through the registry to a NAME**, and that name must **equal** the envelope's `producer`. **100 % of publishes that fail either step are rejected on BOTH paths with the mismatch `reason` recorded, and none is ever delivered** (SC-015). Three failure classes, each its own test **on each path**:
        - transport signal resolves to **nothing** → `reason: 'producer.unresolvable'`. ⛔ **A rejection, never a default** (FR-043, GR-019 — an identity that resolves to `'unknown'` and is then used for attribution, quota or authorization has had its authorization decision made by a string literal);
        - envelope `producer` **missing** → rejected (it is REQUIRED on both paths, FR-026);
        - resolved name ≠ envelope `producer` → `reason: 'producer.mismatch'`. ⛔ **Never** resolved by preferring one signal, and **never** by logging a warning and continuing — a warning is not a rejection (GR-020 violation).
    - **Ordering on the bus path**: the **AWS event wrapper is parsed FIRST** (`source`, `detail-type`, `detail` — AWS's shape, validated at the boundary, **not** added to our schema package), and only then is `source` read. That ordering is the **control**: FR-027 makes the validated `source` a trust decision, so reading it off an unvalidated payload is trusting a field to authorise the record that carries it.
    - **Why both signals** (record it in the code comment): the transport signal proves **origin**, the envelope field states **intent**, and a disagreement is real evidence of a real fault — a misconfigured producer, an envelope copied between environments, a replay onto the wrong bus, or an attempt to spend another producer's quota. The self-asserted field's only permitted outcomes are **"agrees"** and **"rejected"**. Unit + integration + e2e.

- [ ] **T-065** [P] [US-008, US-006] Implement **ONE rejection path per adapter**, carrying the cause as a **`reason`** on a single structured shape, with a **counter per `reason`** and an alarm. — `packages/services/notification-service/src/ingress/rejection.schema.ts` + `src/ingress/publish-core.service.ts`
    - **Depends on**: T-036, T-064
    - **Implements**: FR-042, FR-028, GR-018, SC-016
    - **Acceptance**: **a credential/signature failure and a shape failure produce the SAME rejection shape, differing only in `reason`** (AC-018-a) — they are equally invalid, and two rejection behaviours means two places to keep in step, one of which historically ends up without a counter. Every `reason` has its own counter and its own alarm: `envelope.malformed` (FR-015), `messageType.unregistered` (FR-017), `quota.exceeded` (FR-019, FR-044), `producer.unresolvable` / `producer.mismatch` (FR-027, FR-041), `payload.number-not-representable` (FR-037), `wrapper.malformed`. Delivery of the verdict differs by adapter and only by adapter: HTTP returns `400` (shape) / `403` (attribution); the bus **dead-letters once** with the `reason` and alarms on DLQ depth.
    - ⛔ **An invalid payload is NEVER retried** (GR-018 §18-b) — it cannot become valid by being sent again, and retrying converts a producer bug into sustained load that buries the real signal. A transient-dependency failure (a store timeout) is a **different** condition with a different `reason` and **may** retry; the rule is about **invalidity**, not failure.
    - ⚠️ **The `2xx` inversion does NOT apply to 014's own HTTP publish path**, and a contributor reading only GR-018 §18-c will get this backwards. Our own producers call it and do not blind-retry, so it keeps the `400`/`403` GR-016 §16-a.3 requires; returning `2xx` to our own caller would hide a fixable bug. **If this feature ever accepts a signature-verifying third-party sender** (svix, Stripe — it has none today), that ingress answers **`2xx`** with the rejection in the body plus the log line, the counter and the alarm, because those senders retry on **any** non-2xx (SC-016's second sentence). Unit + integration + e2e.

- [ ] **T-066** [P] [US-011] Implement the FR-044 **token bucket in the shared store**, plus the **separate service-owned `global` bound**. — `packages/services/notification-service/src/quota/token-bucket.ts` (over T-053's repository)
    - **Depends on**: T-053, T-063
    - **Implements**: FR-044, FR-019, FR-033, NFR-006
    - **Acceptance**: the unit is **fixed by this service** — a sustained rate in **publishes/second** plus a **burst allowance in publishes** — and the producer's registry entry declares **magnitudes only**, which this service **caps**. Tests prove: (1) the bucket is **shared state**, so **N API tasks do not grant N× the quota** (asserted with concurrent consumers against one store, not with a single instance); (2) **one budget per producer spans BOTH ingress paths**, so a producer cannot double its allowance by splitting traffic; (3) a **burst** is bounded as well as the sustained rate — ⚠️ a **fixed window would permit the entire budget in its first millisecond** and therefore cannot bound the instantaneous contention NFR-006 is about, which is the whole reason the unit is a bucket; (4) **`global` broadcasts draw on a separate bound owned by this service, not the producer's** — one `global` publish fans out to every subscriber and is not commensurable with a `user`-addressed publish, and a producer permitted to declare its own global quota could declare a large one (US-003 makes global publishing an operator action, so its bound is a service constant). Unit + integration + **k6** (the sustained-vs-burst distinction is only observable under load).

## Contract & Client Deliverables (GR-017 §17-e.12 — added 2026-08-12)

> ⛔ **CLIENT WORK IS ITS OWN DELIVERABLE, and these are the tasks that make it one.** GR-017 §17-e.12 records
> this as the portfolio's most common violation. ✅ ⚠️ **RE-MEASURED 2026-08-12 — the figure this block opened with
> is stale, and it understated the portfolio badly.** It read: _"not one of the fourteen `tasks.md` files in this
> portfolio contained a schema-package, `CONTRACT_HASH` or receipt-validation task, while nine `plan.md` files
> stated the obligation in prose."_ Counted today: **14 of 14 `tasks.md` reference `CONTRACT_HASH`, 14 of 14
> reference contract **skew**, and 14 of 14 `plan.md` state the obligation**; **11 of 14** carry it as a real
> **checkbox task** rather than prose (attributing each line to the checkbox block it sits under — a file-level grep
> cannot tell a task from a paragraph, which is precisely how the original "not one" reading was produced).
> **006, 008 and 009 are the three still carrying it in prose only.** An obligation with no task is still an
> obligation that does not ship, so T-067 onward stay exactly as they are — 014 is one of the eleven **because**
> these tasks exist. Reference implementations to copy, all of which exist today:
> `packages/schemas/{recipe,food,identity}`, `packages/clients/{food-service,recipe-service}`,
> `packages/tools/contract-gen`.

- [ ] **T-067** [P] [ALL] Create the generated, committed **`packages/schemas/notifications`** (`@kitchensink/schema-notifications`) via the existing **`@kitchensink/contract-gen`** copy step. — `packages/schemas/notifications/*`
    - **Depends on**: T-002, T-050, T-055, T-063, T-065
    - **Implements**: GR-015 §15-a, GR-017 §17-a.3
    - **Acceptance**: the package exports the zod, the `z.infer` **types**, a **`contractHash.ts`**, a barrel **and a derived `openapi.yaml`**, matching the shape `packages/infra/global/__tests__/generatedSchemaPackages.test.ts` already asserts (that gate discovers `packages/schemas/*`, so this package is in scope **the day it is created** — no list to remember to extend). Everything in it is **generated; nothing is hand-edited** — including the copied `producers.registry.ts` (T-063). Contents: `PublishEnvelope`, `RecipientDescriptor`, `DeliveryEnvelope`, `AckRequest`/`AckResponse`, the single rejection shape, and `ProducerRegistryEntry` (with `MessageTypeRegistryEntry` nested).
    - ⛔ **Three things NOT to "correct" here.** (1) The schema package is a literal **file COPY**, not a transformation — zod schemas are runtime values, so they cannot be derived from themselves, and every package exports raw `./src/*.ts`, so there is no bundle-into-`dist` path. (2) Turbo uses **`$TURBO_ROOT$` `inputs`**, **not `dependsOn`** — that edge is what closes the cycle `client → schema → service → client`, and ordering was never the requirement because the generated files are **committed**. (3) `openapi.yaml` is **DERIVED output** for `oasdiff`, docs and integrators and is **NEVER a codegen input** — deriving types back through JSON Schema loses `readonly`, branded and template-literal types and flattens discriminated unions.
    - ⚠️ **`oasdiff` sees only the HTTP path** — the EventBridge ingress exposes no URL, so an envelope change on the bus is invisible to an OpenAPI-diff gate. The regenerate-and-diff gate over the authored zod (T-068) is what covers it.

- [ ] **T-068** [P] [ALL] Declare the service's **`contract:generate`** script and wire both drift layers: turbo `$TURBO_ROOT$` **`inputs`** and the **regenerate-and-diff CI gate**. — `packages/services/notification-service/package.json`, `packages/services/notification-service/contract/generate.ts`, `turbo.json`
    - **Depends on**: T-067
    - **Implements**: GR-015 §15-c, GR-017 §17-a.2
    - **Acceptance**: `npm run contract:verify` regenerates and finds **no diff**; editing an authored `*.schema.ts` without regenerating **fails CI**. The existing discovery-based gates cover this the day the package lands — `scripts/contractOwners.mjs`'s `discoverContractOwners` reads `packages/services/*/package.json`, and `packages/infra/global/__tests__/{contract-drift-gate,turbo-build-graph,contract-generation-runner}.test.ts` assert the wiring. Follow `packages/services/recipe-service`'s `"contract:generate": "tsx contract/generate.ts"` and its `src/__tests__/buildInputs.test.ts`.

- [ ] **T-069** [P] [ALL] Assert **`CONTRACT_HASH` equality at BOOT** against the schema package, and fail to boot on mismatch. — `packages/services/notification-service/src/main.ts` + `src/contract/contractHash.ts`
    - **Depends on**: T-068
    - **Implements**: GR-017 §17-a.4
    - **Acceptance**: a deployed service pinned to a stale schema package **does not start**; modelled on `packages/services/recipe-service/src/main.ts` (`assertContractHashesAgree(CONTRACT_HASH, SCHEMA_PACKAGE_CONTRACT_HASH)`) and its `src/__tests__/mainBootOrder.test.ts`. Fail-closed is correct **here** because the check compares two stamps baked into **one** artifact: an image that boots once boots always, so refusing costs no availability. Unit (boot-order test).
    - ⚠️ **`CONTRACT_HASH` and `schemaVersion` are different mechanisms and 014 needs BOTH.** `CONTRACT_HASH` is a **build-time** fingerprint failing a **service boot**; `schemaVersion` is a **runtime wire field** letting a **receiver** handle an envelope minted by another version. A released **mobile binary** cannot be redeployed in step with a backend deploy — the exact case GR-015 §15-c cites as invisible to the turbo and CI layers.

- [ ] **T-070** [P] [ALL] Create **`packages/clients/notifications`** — subscribe, replay and **ack** — declaring **zero** wire types and **validating every response on receipt**. — `packages/clients/notifications/src/*`
    - **Depends on**: T-067
    - **Implements**: GR-015 §15-b, GR-016 §16-c.2, §16-c.3, GR-017 §17-b.1–17-b.4
    - **Acceptance**: the client declares **no** request or response shape of the notification service **in any file, including type-only** (GR-017 §17-b.1); it imports its types **and its runtime zod** from `@kitchensink/schema-notifications`; it **parses every `DeliveryEnvelope` and every `AckResponse` at the moment the body arrives**; and it **validates the outbound `AckRequest` against the callee's zod before the call**. Any divergent consumer shape (a notification-list row model, a toast view model) is **DERIVED** with `Pick`/`Omit`/`Partial` — reference `packages/apps/commise/features/recipes/src/filters/model.ts` — never independently declared. Unit + integration.
    - ⛔ **Do NOT add server-side response validation** anywhere as a result of this task. GR-016 §16-g's deferral is an **owner decision**, not an unfinished one, and GR-017 §17-f exists because the two are routinely conflated: **a consumer parsing what it received is REQUIRED; a service parsing what it emits is FORBIDDEN while the deferral stands.**

- [ ] **T-071** [P] [ALL] Add a **contract-skew guard** to `packages/clients/notifications`, modelled on the existing pair. — `packages/clients/notifications/src/contractSkew.ts`
    - **Depends on**: T-070
    - **Implements**: GR-017 §17-b.5
    - **Acceptance**: modelled on `packages/clients/{food-service,recipe-service}/src/contractSkew.ts`, and it must preserve **all four** of that reference's rulings, each of which is a decision rather than a detail: (1) **a mismatch WARNS, it does not refuse** — unlike the fail-closed boot check, this compares two **independently deployed** artifacts, so refusing would brick every client that had not shipped in lockstep, and on **mobile** it would brick the app until an App Store release cleared it; (2) **absence is silence, not skew** — a service deployed before publication serves no `contractHash`, and reporting that as a mismatch is how a real warning gets muted; (3) it **never throws, never blocks, never retries and never alters a response the caller sees**, not even if the `warn` callback itself throws; (4) it warns **once per origin per process**, latched at module scope, and fires **after** a response rather than from the constructor. Unit tests per clause.

- [ ] **T-072** [P] [US-012] Implement **ONE shared ack command** used by **BOTH** web and mobile, with thin per-platform adapters. — `packages/apps/commise/features/notifications/src/ack/ackAndSettle.ts`
    - **Depends on**: T-056, T-070
    - **Implements**: FR-034, US-012, GR-015 §15-b.4
    - **Acceptance**: the ordering and the post-condition live in **exactly one** module — ack **after** the `messageType` handler has run to completion (never on receipt), batched, retried safely because the endpoint is idempotent, and the local pending state cleared **only** on a successful response. Web and mobile each hold a **thin adapter** over it and **neither reimplements it**. Unit tests on the shared command; the platform tasks assert the adapters call it.
    - **Why one command, cited rather than asserted**: this is the lesson [ADR-0009](../../docs/architecture/decisions/0009-clerk-signout-load-gate.md) records for sign-out — **two platforms independently implementing a post-condition is how one of them ships without it** (mobile's two controls were `void signOut()`, fire-and-forget with no error path, while web had the verified command). The fix there was one shared `signOutAndVerify` in `@commise/features-account/src/session` with per-platform adapters, and the ack takes the same shape. Here the failure is **worse because it is silent**: retention simply never ends, so notifications reappear on every reconnect for three days and **nothing is red**.

- [ ] **T-073** [P] [US-012, US-004] Wire the **web** ack: the feed marks a notification consumed through the shared command, with every UI state covered. — `packages/apps/commise/web/src/components/notifications/*`
    - **Depends on**: T-029, T-072
    - **Implements**: FR-034, US-012
    - **Acceptance**: **vitest component tests cover EVERY state, not just the happy path** — unacked, acking (busy), acked, ack **failed** (localized message, retryable), offline, and empty. A **Playwright** test covers receive → handler runs → ack → reconnect → **not** redelivered. Selectors are `getByRole` / `getByLabel` only. All copy is **localized** — no hard-coded strings. Ships in the same release as T-074 (`docs/CODING_STANDARDS.md` §14.1).

- [ ] **T-074** [P] [US-012, US-004] Wire the **mobile** ack: same shared command, same states. — `packages/apps/commise/mobile/src/components/notifications/*`
    - **Depends on**: T-030, T-072
    - **Implements**: FR-034, US-012
    - **Acceptance**: `.native.test.tsx` covers the **same six states** as T-073, and a **Maestro** flow covers receive → ack → reconnect → not redelivered. The control issues the **shared** command (T-072) — ⛔ not its own ack call, which is the precise shape of the ADR-0009 failure. Localized strings only. Ships in the same release as T-073.

## Cross-Cutting Proofs the Amendment Would Otherwise Miss (added 2026-08-12)

> Two tests that no other task owns, each closing a gap the 2026-08-12 amendment **created**.

- [ ] **T-075** [P] [US-008, US-001] Prove **one envelope shape is valid on BOTH ingress paths** now that `producer` is required on both. — `packages/services/notification-service/tests/ingress-parity.integration.test.ts`
    - **Depends on**: T-034, T-063, T-067
    - **Implements**: SC-008, FR-024, FR-026, FR-041
    - **Acceptance**: **the byte-identical envelope** is accepted over HTTP and over EventBridge and produces an **identical delivered message**, and a rule violated on one path is rejected **identically** on the other — asserted **per rule**, not once in aggregate. The test imports **one** schema from `@kitchensink/schema-notifications`; if it needs two fixtures to satisfy the two paths, **the amendment has failed** and the task is not done. **Why this test is new**: before 2026-08-12 `producer` was EventBridge-only, so SC-008's paired tests would have been comparing **two different shapes** while reporting parity — the requirement was unfalsifiable, and making it falsifiable is what this task is for.

- [ ] **T-076** [P] [US-008, US-006] Prove an **invalid payload is neither retried nor recorded as a row**. — `packages/services/notification-service/tests/rejection.integration.test.ts`
    - **Depends on**: T-065
    - **Implements**: SC-016, FR-042, GR-018 §18-b, §18-d, GR-019
    - **Acceptance**, three independent assertions:
        - **not retried** — a shape-invalid envelope on the bus is **not redriven** to the consumer (AC-018-b): it is recorded and completed, or dead-lettered **once**, with its `reason`;
        - **not a row** — **no** store write occurs for a rejected envelope, and nothing anywhere invents an identifier for one. ⚠️ An invalid payload has **no trustworthy identifier**, and a store whose identity field is required would force the writer to fabricate one — the exact sentinel FR-043 / GR-019 forbid. The precedent is live in this repo: identity's `webhook_events.identity_id` is `text NOT NULL`, so "just record the rejected event" there means writing `'unknown'` into a column other code joins on. **The log line, the counter and the DLQ entry ARE the record**;
        - **same shape, different `reason`** — a malformed envelope and a credential/signature failure produce the **same** rejection shape differing **only** in `reason`, and the per-`reason` counters both move (AC-018-a).

## Substrate consumer — the doorbell contract (added 2026-08-16 — `spec.md` amendment C-1…C-10)

> **Why this section exists, and what it replaces.** PR 91 built the **producer** half of the DynamoDB message
> substrate (plan U4–U6): `PK = <groupType>#<groupId>`, `SK = <ISO-8601 ms>#<ULID>`, a 3-day TTL, and a
> `KEYS_ONLY` stream that is **enabled and deliberately unattached**. 014 owns the consumer, and until now
> this file had **no task for it at all** — every task here plans the SQS-FIFO ingress, which is a different
> transport that also survives.
>
> ⛔ **`supersedes` / FR-045 coverage accounting, stated because the rule is that a scenario is never silently
> dropped.** FR-045 and the `supersedes` field were withdrawn on 2026-08-16 (`spec.md` §C-8). They never
> propagated past `spec.md`: **no task in this file and no row in `v-model/` ever referenced them**, so there
> was no scenario here to rewrite and none was deleted. The behaviour FR-045 was buying — "a redelivered
> `processing` must not revert a terminal `succeeded`" — **still needs proving**, and it is proven by
> **T-077** below, which asserts it against the re-query contract instead of against a producer sequence.
> The scenario moved tiers; it did not vanish.
>
> Every behaviour in C-1…C-10 becomes a test scenario. Each task below names the one it discharges.

- [ ] **T-077** [P] [US-001, US-012] **C-1 — the stream record is a DOORBELL.** On trigger, re-`Query` the message's group and act on what the query returns; never treat the record as the data. — `packages/services/notification-service/src/substrate/doorbell.consumer.ts`
    - **Depends on**: T-053
    - **Implements**: `spec.md` C-1, C-8; GR-017
    - **Why re-query and not read the record**: AWS orders stream records **per item (`PK` _and_ `SK`)**, not per partition key, so "a group arrives in order for free" is false. A group's `Query` **is** ordered, because `SK` leads with an ISO-8601 instant that sorts lexicographically in chronological order.
    - **Acceptance**: ordering is correct **by construction** — duplicate deliveries are harmless, `parallelizationFactor` is safe to raise, and `KEYS_ONLY` is sufficient because the record only has to say _which group changed_.
    - **⛔ This task carries the withdrawn FR-045's hazard.** **Acceptance**: given a group holding `processing@T1` then `succeeded@T2`, redelivering the `T1` stream record **does not** revert the consumer's view to `processing` — because the consumer re-queries and selects most-recent-by-timestamp, never reading `T1` alone.
    - **Tests**: **unit** (the consumer's selection function over an ordered group: two messages, out-of-order arrival, a redelivered older record, an empty group) **AND** **integration** against a real DynamoDB (LocalStack) asserting the redelivery scenario end to end — a mocked table cannot prove the query returns in sort-key order, which is the whole premise.

- [ ] **T-078** [P] [US-001] **C-2 — every read carries a TTL filter expression.** — `packages/services/notification-service/src/substrate/query.ts`
    - **Depends on**: T-077
    - **Implements**: `spec.md` C-2
    - **Why**: expired-but-unreaped items **still return from `Query`**. DynamoDB's TTL deletion is asynchronous and best-effort — typically within 48 hours of expiry, never guaranteed. A consumer that trusts the TTL as a read boundary delivers messages it believes cannot exist, and the bug is invisible until a reap runs late, i.e. under exactly the load where it matters.
    - **Acceptance**: a hand-written item whose TTL is in the past is **not** returned to the caller, and the filter is present on every read path without exception.
    - **Tests**: **unit** (the filter expression is built for every query shape) **AND** **integration** writing an already-expired item and asserting it is filtered — the only tier that can observe the unreaped-but-expired state at all.

- [ ] **T-079** [P] [US-001] **C-3 — paginate on `LastEvaluatedKey`, never on an empty page.** — `packages/services/notification-service/src/substrate/query.ts`
    - **Depends on**: T-078
    - **Implements**: `spec.md` C-3
    - **Why**: with a filter expression in play, DynamoDB filters **after** reading, so a page can legitimately return **zero items and still carry a `LastEvaluatedKey`**. Stopping on an empty page silently truncates a group.
    - **Acceptance**: a group whose first page filters to empty but carries a continuation token is read **to completion**.
    - **Tests**: **unit** (a faked pager emitting empty-page-then-items; ⚠️ mutation lens — reverting to "stop on empty" must turn this red) **AND** **integration** over a group large enough to page for real.

- [ ] **T-080** [P] [US-006] **C-4 — set `retryAttempts` and `maxRecordAge` EXPLICITLY**, plus `bisectBatchOnError` and `reportBatchItemFailures`. — `packages/infra/global/lib/messaging/*` (event-source mapping)
    - **Depends on**: T-077
    - **Implements**: `spec.md` C-4
    - **Why**: both default to `-1` (infinite). Left at the defaults, **one poison record blocks its shard for the full 24-hour stream retention**, and every group hashing to that shard goes dark with no alarm and no DLQ entry.
    - **Acceptance**: a synth assertion that all four properties are set on the mapping — and that one bad record fails **alone** rather than condemning its batch.
    - **Tests**: **unit** (CDK template assertion on the four properties — a synth test is the tier that can see an infrastructure default) **AND** **integration** driving a poison record and asserting the batch's other records still succeed.

- [ ] **T-081** [P] [US-006] **C-5 — the on-failure destination MUST be S3.** — `packages/infra/global/lib/messaging/*`
    - **Depends on**: T-080
    - **Implements**: `spec.md` C-5
    - **Why**: SQS and SNS on-failure destinations carry **metadata only** — record identifiers, not the payload. For a substrate whose items expire in **three days**, a metadata-only failure record points at data that is **gone before anyone reads the alarm**.
    - **Acceptance**: a synth assertion that the destination is an S3 bucket, and an assertion that a failed batch's captured object contains enough to diagnose after the item has expired.

- [ ] **T-082** [P] [US-008] **C-6 — parse every substrate record with zod at the boundary (GR-017).** — `packages/services/notification-service/src/substrate/record.schema.ts`
    - **Depends on**: T-077
    - **Implements**: `spec.md` C-6; GR-016, GR-017
    - **Why**: the consumer reads a store **other services write to**. Trusting its shape is the same class of mistake as trusting an HTTP body.
    - **Acceptance**: a renamed, missing, wrong-typed or null-valued field is rejected at the boundary, and rejection follows the existing shape (T-076) — recorded and completed or dead-lettered **once**, never redriven, never written as a row with a fabricated identifier.

- [ ] **T-083** [P] [US-001] **C-7 — ⛔ NEVER put a group id or an entity id in an EMF dimension.** — `packages/services/notification-service/src/substrate/metrics.ts`
    - **Depends on**: T-077
    - **Implements**: `spec.md` C-7
    - **Why**: the repo's cardinality gate rejects it, and moving the id to a metric **property** fixes only the **cost** half of the problem. Emit a scrubbed structured log line instead and keep metrics dimensionless, or dimensioned only on `service` / `metric`, matching the existing emitters.
    - **Acceptance**: the repo's existing `emfIdentifierDimensionRepoGate` passes over the new emitter, and the group id appears in a **log line**, never a dimension.

- [ ] **T-084** [P] [US-001, US-012] **C-9 + C-10 — 014 starts from an EMPTY pending set, and the two stores stay two.** — `packages/services/notification-service/tests/substrate-not-a-backfill.integration.test.ts`
    - **Depends on**: T-077
    - **Implements**: `spec.md` C-9, C-10
    - **Why C-9**: anything published before this consumer exists is **gone** before it could be read — the substrate's 3-day reaper outruns 014's delivery window, and PR 91 ships the producer half with **no consumer at all**. 014 MUST NOT be specified, planned or tested as though it can replay history.
    - **Why C-10**: the substrate is a **log a consumer reads**; 014's pending set is **state a consumer mutates** (ack deletes it, dedup compares against what is pending). Merging them would put ack-and-dedup semantics onto a table whose producers must stay ignorant of consumers — the property R1.1 exists to protect.
    - **Acceptance**: no code path acks, deletes or mutates a substrate item; no code path reads the pending set to answer "what happened before I existed"; a consumer started against a substrate holding pre-existing items delivers **nothing** from them beyond what its own trigger woke it for.
    - **⚠️ Mutation lens**: pointing the pending-set reader at the substrate table must turn this test **red**. If it stays green, the test is asserting nothing.
