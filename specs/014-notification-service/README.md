# Feature 014: Notification Service

**Branch**: `014-notification-service`
**Status**: Planning complete, reconciled — **not implemented**
**Created**: 2026-05-10 · **Last reconciled**: 2026-08-10

---

## Why this feature exists

Multiple features publish events that should reach users (or systems acting on behalf of users):

- **003 — USDA Food Data**: `food.resolution.completed` (the keyword named by 003's decision register), plus fetch-failure notices. The envelope is published by the **recipe service**, not the food service — see `spec.md` → Dependencies.
- **001 — Commise**: recipe lifecycle events referenced in product-spec.
- **005 — AI Integration**: AI-generated content disclosures.
- **008 — Cooking Mode**: timer alerts.
- **009 — Nutrition Planning**: compliance-gap notifications.

Per `specs/cross-feature-consistency-report.md` §5.3 and warning **WA-004**, no existing feature owns notification delivery. Five features reference notifications with no owner — every feature would otherwise reinvent transport, recipient targeting, and dispatch.

This feature owns that infrastructure.

---

## Scope at a glance

**In scope (launch)**

- Generic publish contract reachable over **two ingress paths** — an authenticated HTTP endpoint and an
  EventBridge subscription on a reserved `detailType` — implemented as adapters over one core, so a rule
  cannot hold on one path and not the other (`spec.md` FR-024).
- Recipient descriptor model: single user, group, or global.
- Subscription model for clients to receive messages whose recipient matches their identity / group membership.
- `messageType` keyword on every message; receiving clients dispatch behavior based on that keyword.
- In-app surface only.

**Deferred**

- Email and push (mobile) transports.
- User-facing notification preferences and opt-out.
- Templating / localization.
- Read receipts, delivery receipts, retry policy beyond a basic default.
- Cross-organization or multi-tenant routing semantics.

**Explicit non-goals**

- Owning the events themselves. Producers define their own `messageType` namespace.
- **Aggregating, batching or correlating messages.** A publisher whose work fans out correlates its own
  fan-out and publishes one envelope per user-meaningful outcome; one envelope per underlying completion is
  a publisher defect (`spec.md` FR-031). This service cannot do it without reading `payload`, which FR-023
  forbids, and "user-meaningful outcome" is knowledge only the publisher has.
- Ingesting producers' **domain events**. The event path takes notification envelopes only (FR-025).
- Replacing transactional email (USDA confirmation, auth flows, etc.).

---

## Index

| Artifact            | File                                                             | Description                                                   |
| ------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------- |
| Product Spec        | [product-spec/product-spec.md](./product-spec/product-spec.md)   | Vision, personas, story map, contract sketch, open questions. |
| Product Spec README | [product-spec/README.md](./product-spec/README.md)               | Index into the product-spec subfolder.                        |
| Research            | [research/README.md](./research/README.md)                       | Index into the research subfolder.                            |
| Codebase analysis   | [research/codebase-analysis.md](./research/codebase-analysis.md) | Snapshot of consuming features and existing infra references. |
| Review log          | [review.md](./review.md)                                         | Iterative revalidation log.                                   |

---

## Status

> The previous version of this section claimed `spec.md`, `plan.md`, `tasks.md` and
> `v-model/` did not exist. All four have existed since the 007–014 reconciliation
> commit; the section was never updated.

**Planning complete and reconciled. No code has been written.**

Present:

- `spec.md` — 33 FR, 8 NFR, 11 SC, 11 user stories
- `plan.md` — dual-ingress contract, ordering/partitioning, data model, group model, NFR budgets
- `tasks.md` — 48 dependency-ordered tasks, **1 complete** (T-048)
- `v-model/` — 21 artifacts incl. peer reviews; 41 `REQ-NNN` mapped, **all scenarios untested**
- `product-spec/` (4 docs), `research/` (2 docs), `review.md`, `sync-report.md`

Still thin or outstanding:

- `research/competitors.md`, `ux-patterns.md`, `tech-stack.md`, `metrics-roi.md` — unauthored
- `contracts/` — no OpenAPI/AsyncAPI yet, so contract-drift checking cannot run. The 2026-08-10 amendment
  makes this more consequential: FR-026 is a **normative wire contract** on two ingress paths, and
  `payload-reference.md` (T-046) does not exist yet.
- The `v-model/` chain was extended by hand on 2026-08-10 for FR-024 – FR-033. It still does not cover the
  2026-08-05 scope additions (identity groups, the sequence authority, the client bell) and still owes
  regeneration (see `review.md` → Outstanding).
- `sync-report.{md,json}` and `verify-report.md` are **generated and stale** — they describe the
  23-requirement, 33-task version. Do not read them as current.
- Revalidation gate is **pending**.

One open question blocks implementation start: the realtime subscribe protocol, SSE vs WebSocket (blocks
T-012). **Q-004 producer authentication is now closed** — FR-032 names the platform Ed25519
service-principal token, verified networklessly. Q-001, Q-002, Q-003, Q-005, Q-007 and Q-008 are resolved.

---

## Source decisions

This feature was created in response to the resolution of [feature 003 Q-001](../003-usda-food-data/product-spec/product-spec.md#open-questions). See [feature 003 Revision 1](../003-usda-food-data/review.md) for the decision trail.
