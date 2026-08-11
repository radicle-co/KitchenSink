# Implementation Plan: Notification Service

**Branch**: `014-notification-service` | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-notification-service/spec.md`

---

## Summary

Feature 014 is the platform-owned notification delivery interface for KitchenSink. It provides a single publish contract and authenticated subscriber delivery for `user`, `group`, and `global` recipients, with client-side behavior keyed by `messageType`.

Producers reach it over **two ingress paths** — an authenticated HTTP endpoint and an EventBridge
subscription — which are adapters over **one** core (FR-024). See _Producer ingress_ below; a rule enforced
in only one of them is a defect, not a variation.

This plan is milestone-aware for `M8` and explicitly inventories cross-feature trigger ownership (`001`–`013`) so integration can be coordinated as the final v1 deliverable.

**Must Have stories addressed**: US-001 – US-006 (`spec.md` numbering: publish +
user routing, group routing, global broadcast, client dispatch, catch-up,
operational counters). US-007 – US-009 are Should Have and US-010 / US-011 are
Could Have; all are planned below.

> The previous revision of this line read _"US-001 … US-007"_, which resolved to a
> different story set depending on whether the reader used product-spec or `spec.md`
> numbering (sync-report DRIFT-001). Both artifacts now use `spec.md` ids.

---

## Milestone Context (`M8` Mordor)

Source of truth: [`../v1-launch-plan.md`](../v1-launch-plan.md) (§3.9).

- Artifact remediation required by M8: `plan.md`, `tasks.md`, `review.md`, `verify-report.md`.
- This artifact covers planning remediation and integration sequencing.
- Remaining M8 exit gates (verification evidence, release-audit unblock, full surface integration) are tracked in [`tasks.md`](./tasks.md).

---

## Governance Alignment

Source of truth: [`../governance-rules.md`](../governance-rules.md).

- **GR-002 (CRITICAL)**: All APIs constrained to `/api/v1/notifications/*`. The EventBridge ingress
  (FR-024) exposes no URL, so GR-002 does not reach it; its equivalent constraint is the reserved
  `detailType` plus the `source` allowlist (FR-025, FR-027).
- **GR-007 (CRITICAL)**: Shared core entities must come from `@kitchensink/recipe-core`; no local duplicate shared domain types.
- **GR-011 (WARNING)**: 014 is owner of notification transport/delivery; producer features publish through 014.
- **GR-008 (WARNING)**: Node runtime remains Node 24.x.
- **GR-009 (WARNING)**: New package naming follows `@kitchensink/{group}-{name}`.

---

## Transport and Queue Architecture Choice (from research + spec constraints)

### Chosen v1 architecture

**Hybrid in-app model**:

1. **Durable ingest + routing queue (required)**
    - Producer publish requests are validated and durably accepted before success response (FR-003).
    - Routing jobs are processed asynchronously so producer latency is stable under burst.

2. **Realtime push delivery (primary online path)**
    - Authenticated subscribers receive low-latency in-app delivery (aligned with timer-alert latency constraints from 008 references).

3. **Catch-up pull/replay (required offline path)**
    - User/group undelivered messages are retained for reconnect replay (FR-012, min 24h).

### Why this choice

- `research/codebase-analysis.md` identifies **time-sensitive timer events (008)** and **offline catch-up need (003/general reconnect)**.
- Product spec keeps transport implementation-open (Q-001), while feature requirements force both low-latency and durable catch-up.
- Hybrid push + replay satisfies both without constraining producers to transport details.

### Deferred transports

- Email, mobile push, and external webhook delivery are explicitly deferred as post-launch expansions.

---

## Ordering & Partitioning (FR-008, FR-009, SC-002)

> Added 2026-08-05. The previous revision of this plan chose a three-path hybrid
> without stating how per-recipient FIFO survives it — the feature's hardest
> guarantee was unplanned (sync-report DRIFT-002).

### The problem this section exists to solve

A message can reach a client by two different routes: **live push** (queue →
consumer → open connection) and **replay** (store → reconnect pull). If those two
routes each decide order independently, FR-008 is violated the moment a client
reconnects mid-stream — which for mobile is constantly. There must be exactly one
authority for "what order did messages for recipient R occur in".

### Decision: SQS FIFO is the ordering authority; the store records its verdict

**Ordering authority**: an SQS **FIFO** queue with `MessageGroupId = recipient.id`
(for `kind ∈ {user, group}`). SQS guarantees strict FIFO **per message group**,
which is exactly per-recipient FIFO, and no ordering across groups — precisely what
FR-008 promises and FR-008's second sentence disclaims.

**The queue preserves ENQUEUE order, which equals publish order on the HTTP path only
(FR-029).** EventBridge does not preserve ordering, so two envelopes for one recipient
can arrive at the adapter in either order regardless of when their producers published
them. Envelopes arriving that way MUST therefore be ordered by the producer-assigned
`occurredAt`, with a deterministic tiebreaker (`producer`, then `idempotencyKey`), before
or as they are enqueued — otherwise the FIFO queue faithfully preserves an arrival order
that is not publish order, and FR-008 becomes silently untrue for every event-path
producer. `occurredAt` is why FR-026 makes it required and producer-assigned rather than
stamped on receipt. If cross-path FIFO for a single recipient proves unachievable in
implementation, FR-008 is narrowed explicitly rather than left to imply a guarantee the
transport does not provide.

**Sequence assignment happens once, at consume time.** The routing consumer, on
dequeue, assigns a monotonically increasing `sequence` per `recipient.id` and
persists the message with it in the same transaction as the delivery record. The
store therefore **records** the order SQS produced; it never computes its own.

**Both delivery paths read the same `sequence`:**

| Path          | Order source                                                      |
| ------------- | ----------------------------------------------------------------- |
| Live push     | consumer emits in dequeue order — the order it just persisted     |
| Replay / pull | `ORDER BY sequence ASC` over the store                            |
| Client        | dedupes and orders by `(recipient, sequence)`; ignores duplicates |

Because a single writer assigns `sequence` in dequeue order, live and replay cannot
disagree. A client that reconnects mid-stream sees a contiguous, gap-free sequence
and can detect a gap and re-pull.

**`recipient.kind = "global"`** does **not** use a FIFO group. Globals publish to a
standard queue and are best-effort ordered (FR-009), live-only (Q-009), and carry no
`sequence`.

### Consequences of choosing SQS FIFO — accept these deliberately

1. **Throughput ceiling.** SQS FIFO is limited per `MessageGroupId`, and the
   account-level FIFO limits (300 TPS without batching, 3 000 with) are a hard cap on
   publish rate. Fan-out to a large group must not become one message per member on
   the ingest queue — publish once addressed to the **group**, and expand membership
   in the consumer, so group size costs consumer work, not queue throughput.
2. **SQS's own dedup window is 5 minutes, and that is NOT FR-018.** FR-018 requires a
   _configurable_ `idempotencyKey` window. Content-based dedup on the queue cannot
   implement it. FR-018 needs its own dedup record keyed on
   `(producerFeature, idempotencyKey)` with its own TTL — the queue's 5-minute window
   is at best a coincidental first line of defence. See T-015.
3. **In-flight cap.** FIFO queues cap in-flight messages; a stuck consumer for one
   recipient blocks that recipient's group only, which is the desired blast radius,
   but it must be alarmed (see NFR budgets).
4. **Delivery is at-least-once.** SQS does not promise exactly-once delivery to the
   consumer. This is why `spec.md` US-010 says consumers MUST treat handlers as
   idempotent, and why the client dedupes on `sequence`.

---

## Group Model (identity service) — Q-002 resolution

> Added 2026-08-05 (owner decision). `spec.md` A-002 required this plan to define the
> group-membership lookup and the previous revision never did; `tasks.md` T-005
> meanwhile assumed a "002 group membership API" that does not exist
> (sync-report DRIFT-003).

**Groups belong to the identity service, and this feature builds them.** They are
**not** Clerk Organizations — the group concept here is a KitchenSink domain concept
(a household, a shared collection's audience), and binding it to an external vendor's
tenancy model would couple an application concept to Clerk's billing/tenancy
semantics.

Feature 002 is shipped, so this lands as an **extension to
`packages/services/identity`** delivered under 014:

| Element         | Detail                                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tables          | `group` (id ULID, name, created_at), `group_membership` (group_id, user_id, joined_at) — Drizzle, in the identity DB alongside users/accounts/profiles                                 |
| Ownership       | identity service — the single source of truth for "who is in group X"                                                                                                                  |
| API             | `/api/v1/groups/*` (GR-002 prefix), Clerk-authenticated per the existing `AuthMiddleware`                                                                                              |
| 014's use       | membership resolved at **delivery time** in the routing consumer (FR-022), never at publish time                                                                                       |
| Failure posture | identity unavailable at delivery → the message stays on the queue and retries; it is **not** dropped and **not** failed back to the producer (whose publish already succeeded, FR-003) |

**Cross-feature note:** groups are useful well beyond notifications (001 shared
collections, 006/007 household planning). Building them in identity rather than
inside 014 is what keeps them reusable. Their API surface is owned by the identity
service and must be specced there, not left implicit in 014 — see the open item in
[`./review.md`](./review.md).

---

## Data Model (FR-012, FR-018, retention)

> Added 2026-08-05. The plan previously had no Data Model section while `tasks.md`
> T-009 specified persistence down to the ORM (sync-report DRIFT-012). Its absence
> also suppressed the Phase 5.5 migration-plan trigger, whose condition is exactly
> "plan.md has a non-empty Data Model section".

Owned by the notification service (its own schema; **not** the identity DB):

| Table                   | Key columns                                                                                                                                                                                   | Purpose                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `notification`          | `id` ULID, `schema_version`, `producer`, `recipient_kind`, `recipient_id`, `sequence` (per-recipient monotonic), `message_type`, `payload` jsonb, `occurred_at`, `published_at`, `expires_at` | durable record + replay source               |
| `delivery`              | `notification_id`, `subscriber_id`, `delivered_at`                                                                                                                                            | per-client delivery record; drives counters  |
| `publish_idempotency`   | `producer_feature`, `idempotency_key`, `notification_id`, `expires_at`                                                                                                                        | FR-018 dedup, TTL independent of SQS's 5 min |
| `message_type_registry` | version-controlled file, **not** a table                                                                                                                                                      | FR-016 — reviewable in git                   |

- **Replay index**: `(recipient_kind, recipient_id, sequence)` — serves the
  `ORDER BY sequence` replay query directly.
- **Retention**: `expires_at = published_at + 24h` (Q-003). Eviction by scheduled
  sweep; a row past `expires_at` that was never delivered increments the
  undelivered-after-retention counter **before** deletion, or the counter can never
  be emitted (FR-013).
- **`schema_version`** and **`producer`** are persisted, not just validated: the first
  makes a stored envelope interpretable when the wire contract moves (FR-026), the second
  is the only record of who published on the event path, where there is no token to
  attribute after the fact (FR-027).
- **`payload`** is stored opaque and never indexed or inspected (FR-023). Size limit
  enforced at validation, before storage.
- **Event-path rejections are not rows.** A rejected envelope never reaches these tables;
  it lands on the ingress DLQ with a reason code (FR-028). The DLQ is the record, so its
  depth is alarmed rather than swept.
- Migrations follow the identity service's existing Drizzle migration convention.
  The group tables above are a **separate** migration against the identity DB.

---

## Non-Functional Budgets (NFR-001, NFR-003, NFR-006)

> Added 2026-08-05. NFR-001 and NFR-003 previously had no plan coverage
> (sync-report DRIFT-010); "low-latency" was asserted without a number, leaving
> SC-004 and the k6 tier nothing to assert against.

| NFR     | Budget                                             | Measurement point                                                                                                                |
| ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| NFR-001 | ≥ 99.9 % availability, publish API                 | ALB 5xx rate on `/api/v1/notifications/publish`, 30-day window                                                                   |
| NFR-003 | p95 ≤ 2 s, publish-accept → client-receive         | timestamp at publish acceptance vs client receipt ack; "nominal load" = 50 publishes/s sustained with 500 concurrent subscribers |
| NFR-006 | ≤ 10 % latency degradation for unrelated producers | same p95 measured per producer while one producer is driven to its quota ceiling (FR-019)                                        |

Alarms: publish 5xx rate, consumer age on the FIFO queue (the ordering path's
liveness signal), in-flight cap approach, undelivered-after-retention rate, **event-path
DLQ depth** (FR-028 — the only signal a rejection on the credential-less path produces),
and quota rejections per producer (FR-033 — a silent rejection is a lost notification).

## Notification Ownership Contract (GR-011)

### Producer ingress — two adapters, one core (FR-024)

| Ingress         | Surface                                       | Producer identity from                                | Requirement trace              |
| --------------- | --------------------------------------------- | ----------------------------------------------------- | ------------------------------ |
| HTTP            | `POST /api/v1/notifications/publish`          | Ed25519 service-principal token, verified networkless | FR-001..FR-004, FR-015, FR-032 |
| **EventBridge** | reserved `detailType` on the notification bus | validated event `source` + bus resource policy        | FR-024..FR-030                 |

Both adapters delegate to the **same** core: validate → registry check → producer authorization →
idempotency dedupe → durable accept → enqueue routing. A rule enforced in only one adapter is a defect
(FR-024), so the adapters own transport concerns only and hold no business logic.

The EventBridge path exists because the platform's async producers already emit domain events; forcing them
into a synchronous publish inside a database transaction would make this service a runtime dependency of
their hot paths and hard-code a dual write. It ingests **notification envelopes, never domain events**
(FR-025) — a domain event carries no recipient, and deriving one would require inspecting `payload`
(forbidden, FR-023) or calling back into the producer.

The HTTP path's `FR-002` mechanism is now decided: the platform's **Ed25519 service-principal token**,
verified networklessly against a public key (the scheme already deployed as `FOOD_SERVICE_PRINCIPAL_JWT_KEY`,
minted and verified by `packages/shared/recipe-core/src/serviceErasureToken.ts`). Verification performs no
outbound call, so no third-party round trip sits on the publish path (FR-032). Per-producer quotas are read
from that producer's registry entry, declared at registration, never inferred (FR-033).

Envelope shape (contract source: `spec.md` FR-026 — normative, both paths):

```text
{
  schemaVersion:  <integer>,             // REQUIRED — two doors make this a versioned wire contract
  recipient:      { kind: "user" | "group" | "global", id?: string },
  messageType:    string,                // REQUIRED — registry-checked
  payload:        <opaque producer-defined>,
  occurredAt:     ISO-8601,              // REQUIRED, producer-assigned — the FIFO ordering key (FR-029)
  idempotencyKey: string,                // REQUIRED on EventBridge (at-least-once); optional on HTTP
  producer:       string                 // REQUIRED on EventBridge (no bearer token to derive it from)
}
```

An envelope missing a required field is rejected outright — never partially routed, never defaulted. On the
EventBridge path a rejection has no caller to receive a structured error, so it dead-letters and alarms
(FR-028), with a counter per rejection reason: malformed (FR-015), unregistered under enforcement (FR-017),
quota-exceeded (FR-019), or `source` not allowlisted (FR-027).

### Event-path trust boundary (FR-027)

The event path carries **no credential**. Its trust boundary is therefore two controls, both required:

| Control                     | Enforced at                                            | Fails to                                                        |
| --------------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| EventBridge resource policy | the bus — which principals may `PutEvents`             | reject at the AWS API before the envelope is ever seen          |
| `source` allowlist          | the adapter — the event's `source` vs registry entries | dead-letter with reason `source_not_allowlisted`, never deliver |

Neither substitutes for the other. Without both, this path is an unauthenticated publish channel through
which any principal with bus access can address a notification to any user, defeating FR-005, FR-020 and
FR-021. `idempotencyKey` must be derived from durable domain state — a job identity plus terminal status —
so it is stable across producer retries (FR-030); a key derived from a transport id or a clock changes on
retry and deduplicates nothing.

### Producer-side correlation (FR-031)

This service does not aggregate. A producer whose work fans out publishes **one** envelope per
user-meaningful outcome, correlating its own fan-out first — typically via a feature-owned **translator**
that subscribes to its own domain events, resolves recipients, and publishes once. 004's recipe import is
the sizing case: up to 100 ingredient resolutions (004 FR-020 × 003 FR-045) must become one notification.
One envelope per underlying completion is a publisher defect, not a gap here.

### Subscriber API

| Method       | Path                              | Purpose                                                                                 | Requirement trace              |
| ------------ | --------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------ |
| `GET`/stream | `/api/v1/notifications/subscribe` | Authenticated realtime subscription scoped to authenticated identity/group/global match | FR-010, FR-020, FR-021, FR-022 |
| `GET`        | `/api/v1/notifications/replay`    | Retrieve retained undelivered notifications for reconnect catch-up                      | FR-012                         |

---

## Cross-Feature Notification Trigger Inventory (`001`–`013`)

Legend:

- **Firm**: explicitly defined in current artifacts.
- **Implied**: referenced by feature docs but event contract not finalized.
- **Coordination**: producer team dependency for final trigger schema/ownership sign-off.

| Feature                   | Candidate trigger(s) / messageType namespace                                    | Recipient kind(s)                   | Priority in M8 integration | Ownership status                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------- |
| `001` Commise Recipe App  | Recipe lifecycle notifications (create/update/share-style lifecycle references) | user, group                         | Medium                     | **Implied** — requires 001 contract finalization (**coordination required**)                            |
| `002` Clerk User Auth     | Security/session/admin notices (optional for v1)                                | user, global                        | Low                        | Not explicitly required by 014 launch contract                                                          |
| `003` USDA Food Data      | `food.resolution.completed` (003 decision register); failure notice unnamed     | user (fan-out list), optional group | **High**                   | **Firm** — published by the recipe service, not the food service (T-044)                                |
| `004` Recipe Importing    | Import completion/failure notices (optional)                                    | user                                | Low                        | Not currently required by 014 launch goals                                                              |
| `005` AI Integration      | AI-generation disclosure/compliance events                                      | user                                | High                       | **Implied/Firm-in-principle** — disclosure required; event taxonomy pending (**coordination required**) |
| `006` Meal Planning       | Plan-change reminders / schedule nudges                                         | user, group                         | Medium                     | Implied via M8 launch integration requirement (**coordination required**)                               |
| `007` Grocery Lists       | Collaboration/list-change events                                                | group, user                         | Medium                     | Implied by 007 collaboration hazard references (**coordination required**)                              |
| `008` Cooking Mode        | Timer started/completed/expired alerts                                          | user                                | **High**                   | **Firm-in-spirit** time-sensitive alerts; concrete message contract pending (**coordination required**) |
| `009` Nutrition Planning  | Compliance-gap / deficiency-related informational notices                       | user                                | High                       | **Implied** and partially open in 009 artifacts (**coordination required**)                             |
| `010` Subscriptions       | Trial ending, past-due, entitlement-change notices                              | user                                | Medium                     | Present in 010 planning language; integration scope decision pending (**coordination required**)        |
| `011` Recipe Digitization | OCR job completed/failed, circle/invite workflow informational events           | user, group                         | Low/Medium                 | Optional in v1; not hard M8 gate                                                                        |
| `012` Creator Profiles    | Moderation/action-result notifications to creators                              | user                                | Medium                     | Present in 012 requirement narratives; integration contract pending (**coordination required**)         |
| `013` Cooking School      | Publish/enroll milestone events to learners/creators                            | user, group                         | Medium                     | 013 plan explicitly defers full notification ownership to 014 (**coordination required**)               |

### M8 required integration subset (per launch plan + current evidence)

Minimum must-wire in M8 execution backlog:

- `003`, `005`, `008`, `009`, `012`, `013` (and validate whether `006`, `007`, `010` are mandatory-at-exit or “hook-ready” per Director decision).

#### Which of these actually exist in code (checked 2026-08-05)

The owner confirmed on 2026-08-05 that full M8 scope stands. Recording the standing
constraint that comes with it:

| Producer | Exists in code?                     | Integration task                                      |
| -------- | ----------------------------------- | ----------------------------------------------------- |
| `003`    | ✅ `packages/services/food-service` | T-042 – T-044 (publisher lands in the recipe service) |
| `005`    | ❌ specification only               | T-018                                                 |
| `008`    | ❌ specification only               | T-018                                                 |
| `009`    | ❌ specification only               | T-018                                                 |
| `012`    | ❌ specification only               | T-021 (added 2026-08-05)                              |
| `013`    | ❌ specification only               | T-022 (added 2026-08-05)                              |

Only **003** can be integrated end-to-end today, and its notification is published by the
**recipe service**, not the food service: `FetchQueueDao.resolve` deletes every
`fetch_requesters` row in the same transaction that completes a food, so the food service
cannot name the recipients after the fact (T-044). The five remaining integration tasks are
blocked on those features shipping, independently of any work on 014 — 014 cannot reach M8
exit before they do. Previously 012 and 013 were named mandatory here with no task at all in
`tasks.md` (sync-report DRIFT-004).

**`SC-001` no longer depends on any consumer** (amended 2026-08-10). It is proven against a
**synthetic reference producer owned by this feature** (T-041) exercising both ingress paths,
so this feature's own launch criterion never waits on a producer's schedule. The remaining
upstream dependency is one 014 builds itself — the identity groups model, T-023 – T-025. It
is the M8 _milestone_ gate, not `SC-001`, that needs all six producers.

---

## Delivery Channels and Client Behavior

### Launch channels

- **In-app realtime stream** (web/mobile authenticated clients).
- **In-app catch-up replay** after reconnect.

### Deferred channels

- Email, mobile push provider integration, webhook callbacks.

### Client dispatch contract

- Clients dispatch by `messageType`.
- Unknown `messageType` values must be logged/ignored without crash (FR-011).
- Registry enforcement mode can reject unregistered `messageType` in selected environments (FR-016, FR-017).
- Clients order and dedupe by `(recipient, sequence)` — see _Ordering & Partitioning_.

### Client attachment point (added 2026-08-05)

The plan previously specified a transport with **no client surface to attach to**,
while both apps already ship the surface (sync-report DRIFT-007):

- `packages/apps/commise/web/src/components/home/chrome/HomeTopBar.tsx` — a
  notifications icon button, no `onClick`, no `href`, no badge. Its comment reads:
  _"No count badge — there is no notifications service in v1, and a fabricated number
  is exactly what this surface refuses to show."_
- The mobile `HomeTopBar` counterpart, same shape, same `chrome.notifications` label.

Launch work for this epic: an unread count on the existing bell, driven by the
subscribe/replay data, and a feed surface the bell opens. Both platforms ship together
per the repo's cross-platform rule; shared logic goes in a shared package, with
`.native.tsx` only where the platforms genuinely diverge. This also completes
`user-journey.md` Journey B step 5 ("Sam opens the notification and lands on the
relevant context"), which had no implementing surface.

---

## Preferences / Opt-Out Strategy

### v1 baseline

- No user-facing preference center in initial launch baseline.
- Operationally, producers can control emission and target scope; recipients are auth-scoped.

### Planned extension path

- Add per-user category preferences and delivery-channel preferences in follow-on milestone work.
- Preserve backwards compatibility by keeping envelope contract stable and moving preference logic into routing policy.

---

## Dependencies and External Coordination

### Hard dependencies

- **002** for identity/authenticated subscription boundary.
- The platform Ed25519 service-principal token scheme for producer authentication on the
  HTTP path (FR-032).
- An EventBridge bus owned by this service, with a resource policy and a reserved
  `detailType`, for the event ingress (FR-024, FR-027). This is the first shared bus in the
  repo; 003 already publishes `FoodFetchCompleted` to EventBridge, so the substrate is in
  use but no cross-feature bus convention exists yet.
- Shared package conventions/governance across monorepo.

### Cross-team contracts required in M8

For each integrated producer feature, confirm:

1. `messageType` namespace owner,
2. Trigger event semantics,
3. Recipient mapping rules (`user`/`group`/`global`),
4. SLA/latency expectation,
5. Failure and retry semantics.

These are explicitly tracked as coordination tasks in [`tasks.md`](./tasks.md).

---

## Rollout and Risk-Control Plan

### Rollout phases

1. **Phase A — Contract hardening**
    - Finalize shared envelope types + registry + validation, including the FR-026 minimum
      on both ingress paths.
2. **Phase B — Core delivery path**
    - Publish, route, subscribe, replay, counters. Both adapters land against one core, and
      the paired per-rule equivalence tests (SC-008) are what prove it.
3. **Phase C — Producer integrations**
    - Progressive enablement by feature behind environment flags.
4. **Phase D — Verification closeout**
    - Traceability/test result ingestion, governance closure, release-audit unblock.

### Rollout controls

- Environment-level enforcement toggles for unregistered `messageType` rejection.
- Per-producer quotas and idempotency windows to limit storm/retry amplification. Quota
  values come from the producer's registry entry (FR-033).
- Counter-based canary checks: publish volume, delivery success, undelivered-after-retention, active subscribers.
- The event ingress is enabled per producer by adding that producer's `source` to the
  allowlist and to the bus resource policy. Removing a producer from the allowlist is the
  kill switch for its event path; the HTTP path is gated separately by its token.

---

## Exit Evidence Required for M8

Aligned to [`../v1-launch-plan.md`](../v1-launch-plan.md) and [`../governance-rules.md`](../governance-rules.md):

- `verify-report.md` at `0 CRITICAL, 0 WARNING`.
- `v-model/release-audit-report.md` unblocked with ingested execution results.
- Demonstrable integrated notification flow across required producer set.
- Ingress parity proven: a paired test per rule showing identical acceptance and identical rejection over
  HTTP and EventBridge (SC-008), and 100% of non-allowlisted `source` values dead-lettered (SC-009).
- GR-011 ownership proven by removal of producer-local delivery implementations in integrated features.
