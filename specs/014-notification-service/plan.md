# Implementation Plan: Notification Service

**Branch**: `014-notification-service` | **Date**: 2026-05-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-notification-service/spec.md`

---

## Summary

Feature 014 is the platform-owned notification delivery interface for KitchenSink. It provides a single publish contract and authenticated subscriber delivery for `user`, `group`, and `global` recipients, with client-side behavior keyed by `messageType`.

This plan is milestone-aware for `M8` and explicitly inventories cross-feature trigger ownership (`001`–`013`) so integration can be coordinated as the final v1 deliverable.

**Must Have stories addressed**: US-001, US-002, US-003, US-004, US-005, US-006, US-007.

---

## Milestone Context (`M8` Mordor)

Source of truth: [`../v1-launch-plan.md`](../v1-launch-plan.md) (§3.9).

- Artifact remediation required by M8: `plan.md`, `tasks.md`, `review.md`, `verify-report.md`.
- This artifact covers planning remediation and integration sequencing.
- Remaining M8 exit gates (verification evidence, release-audit unblock, full surface integration) are tracked in [`tasks.md`](./tasks.md).

---

## Governance Alignment

Source of truth: [`../governance-rules.md`](../governance-rules.md).

- **GR-002 (CRITICAL)**: All APIs constrained to `/api/v1/notifications/*`.
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

## Notification Ownership Contract (GR-011)

### Producer API

| Method | Path                            | Purpose                                         | Requirement trace      |
| ------ | ------------------------------- | ----------------------------------------------- | ---------------------- |
| `POST` | `/api/v1/notifications/publish` | Validate + durably accept notification envelope | FR-001..FR-004, FR-015 |

Envelope shape (contract source: `spec.md`):

```text
{
  recipient: { kind: "user" | "group" | "global", id?: string },
  messageType: string,
  payload: <opaque producer-defined>,
  occurredAt: ISO-8601,
  idempotencyKey?: string
}
```

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
| `003` USDA Food Data      | `food.backfill.completed`, `food.fetch.failed`                                  | user (fan-out list), optional group | **High**                   | **Firm** in 003/014 artifacts                                                                           |
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
    - Finalize shared envelope types + registry + validation.
2. **Phase B — Core delivery path**
    - Publish, route, subscribe, replay, counters.
3. **Phase C — Producer integrations**
    - Progressive enablement by feature behind environment flags.
4. **Phase D — Verification closeout**
    - Traceability/test result ingestion, governance closure, release-audit unblock.

### Rollout controls

- Environment-level enforcement toggles for unregistered `messageType` rejection.
- Per-producer quotas and idempotency windows to limit storm/retry amplification.
- Counter-based canary checks: publish volume, delivery success, undelivered-after-retention, active subscribers.

---

## Exit Evidence Required for M8

Aligned to [`../v1-launch-plan.md`](../v1-launch-plan.md) and [`../governance-rules.md`](../governance-rules.md):

- `verify-report.md` at `0 CRITICAL, 0 WARNING`.
- `v-model/release-audit-report.md` unblocked with ingested execution results.
- Demonstrable integrated notification flow across required producer set.
- GR-011 ownership proven by removal of producer-local delivery implementations in integrated features.
